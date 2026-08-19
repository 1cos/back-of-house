// ══════════════════════════════════════════════════════════════════
// Vendor Review — vdrProcessAllPdf(docId) single-document scoping tests
// (BOH OS Task 11J)
// Plain Node, zero dipendenze esterne: `node tests/vendor-documents-single-processing.test.js`
//
// Esegue la logica reale di costruzione query estratta da
// js/vendor-documents-review.js (marker espliciti, come negli altri test di
// questa serie) contro un mock Supabase che si comporta come un vero DB:
// contiene TUTTE le righe e applica i filtri .eq() realmente — se il codice
// non chiamasse .eq('id', docId), il mock restituirebbe più righe di quelle
// attese e il test lo scoprirebbe. Non è un mock che "sa già" cosa filtrare.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const VDR_JS = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); } }
async function atest(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); } }

function readSrc() { return fs.readFileSync(VDR_JS, 'utf8'); }

// Estrae il blocco reale di costruzione/esecuzione della query (STEP 2/3).
function extractQuerySnippet() {
  const src = readSrc();
  const startMarker = 'let query = sb';
  const endMarker = "const { data: queue } = await query.order('created_at', { ascending: true });";
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker) + endMarker.length;
  if (start === -1 || end === -1 + endMarker.length - 1) {
    throw new Error('marker non trovati — la costruzione della query in vdrProcessAllPdf è cambiata di forma?');
  }
  return src.slice(start, end);
}

// Mock Supabase "come un vero DB": contiene l'intera tabella e applica i
// filtri .eq() realmente chiamati dal codice. Registra ogni chiamata.
function makeMockSb(allRows) {
  const calls = { eqs: [] };
  const sb = {
    from(_table) {
      const c = {
        _eqs: [],
        select() { return c; },
        eq(k, v) { c._eqs.push([k, v]); calls.eqs.push([k, v]); return c; },
        order() {
          const matched = allRows.filter(row => c._eqs.every(([k, v]) => row[k] === v));
          return Promise.resolve({ data: matched });
        },
      };
      return c;
    },
  };
  return { sb, calls };
}

async function runQuery(sb, docId) {
  const snippet = extractQuerySnippet();
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction('sb', 'docId', snippet + '\nreturn queue;');
  return fn(sb, docId);
}

// Fixture: l'intera "tabella" con cui i test lavorano — include il
// documento target BEK HTML e il record protetto 383764dd-... nella stessa
// coda pdf_received, esattamente la situazione reale verificata nel Task 11I.
const ALL_ROWS = [
  { id: '383764dd-f12e-458d-960e-656a2347894a', status: 'pdf_received', parsed_json: { source: 'email_body' } },
  { id: '7aa702b1-510b-4ba9-9e32-0b67e9c9ab81', status: 'pdf_received', parsed_json: { source: 'email_html' } },
  { id: 'some-other-pending-doc', status: 'pending', parsed_json: null },
];

console.log('\nVendor Review — vdrProcessAllPdf(docId) single-document scoping — test run\n');

(async () => {

  // ── T1 — Single target: A processato, B invariato/mai letto ─────
  await atest("T1: vdrProcessAllPdf('7aa...') restituisce SOLO quel documento, non 383764dd-...", async () => {
    const { sb, calls } = makeMockSb(ALL_ROWS);
    const queue = await runQuery(sb, '7aa702b1-510b-4ba9-9e32-0b67e9c9ab81');
    assert.strictEqual(queue.length, 1);
    assert.strictEqual(queue[0].id, '7aa702b1-510b-4ba9-9e32-0b67e9c9ab81');
    assert.ok(calls.eqs.some(([k, v]) => k === 'id' && v === '7aa702b1-510b-4ba9-9e32-0b67e9c9ab81'), 'la query deve filtrare per id a livello DB');
  });

  // ── T2 — Target BEK HTML: la riga restituita ha davvero source=email_html ──
  await atest('T2: il documento scoped è quello con parsed_json.source=email_html (routing verificato altrove, qui solo lo scoping)', async () => {
    const { sb } = makeMockSb(ALL_ROWS);
    const queue = await runQuery(sb, '7aa702b1-510b-4ba9-9e32-0b67e9c9ab81');
    assert.strictEqual(queue[0].parsed_json.source, 'email_html');
  });

  // ── T3 — Il record protetto non è mai letto durante il processing scoped ──
  await atest('T3: 383764dd-... (record protetto) non compare mai nel risultato quando si processa solo 7aa...', async () => {
    const { sb } = makeMockSb(ALL_ROWS);
    const queue = await runQuery(sb, '7aa702b1-510b-4ba9-9e32-0b67e9c9ab81');
    assert.ok(!queue.some(d => d.id === '383764dd-f12e-458d-960e-656a2347894a'), '383764dd-... non deve mai apparire nella queue scoped');
  });

  // ── T4 — Batch invariato: nessun docId -> tutta la coda pdf_received ──
  await atest('T4: vdrProcessAllPdf() senza docId restituisce ancora tutta la coda pdf_received (comportamento batch invariato)', async () => {
    const { sb, calls } = makeMockSb(ALL_ROWS);
    const queue = await runQuery(sb, undefined);
    assert.strictEqual(queue.length, 2, 'entrambi i pdf_received attesi, nessuno scoping');
    assert.ok(queue.some(d => d.id === '383764dd-f12e-458d-960e-656a2347894a'));
    assert.ok(queue.some(d => d.id === '7aa702b1-510b-4ba9-9e32-0b67e9c9ab81'));
    assert.ok(!calls.eqs.some(([k]) => k === 'id'), 'senza docId non deve mai filtrare per id');
  });

  // ── T5 — ID inesistente: 0 documenti ──────────────────────────────
  await atest('T5: docId inesistente -> 0 documenti nella queue', async () => {
    const { sb } = makeMockSb(ALL_ROWS);
    const queue = await runQuery(sb, 'uuid-che-non-esiste-nel-db');
    assert.strictEqual(queue.length, 0);
  });

  // ── T6 — Status non valido: documento esiste ma non è pdf_received ──
  await atest("T6: docId esistente ma status!='pdf_received' -> 0 documenti (non processato)", async () => {
    const { sb } = makeMockSb(ALL_ROWS);
    const queue = await runQuery(sb, 'some-other-pending-doc');
    assert.strictEqual(queue.length, 0);
  });

  // ── Verifica di collegamento: la firma della funzione accetta docId ──
  test('la firma di vdrProcessAllPdf accetta un parametro docId opzionale', () => {
    const src = readSrc();
    assert.ok(src.includes('window.vdrProcessAllPdf = async function(docId) {'));
  });

  // ── Backward compatibility: i call-site esistenti non cambiano ──────
  test('i call-site esistenti (onclick="vdrProcessAllPdf()") restano invariati — nessuna modifica UI richiesta', () => {
    const src = readSrc();
    const calls = src.match(/onclick="vdrProcessAllPdf\([^)]*\)"/g) || [];
    assert.ok(calls.length >= 2, 'attesi almeno i 2 call-site esistenti (banner + pulsante Processa tutti)');
    calls.forEach(c => assert.strictEqual(c, 'onclick="vdrProcessAllPdf()"', 'ogni call-site esistente deve continuare a chiamare senza argomenti'));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
