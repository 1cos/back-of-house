// ══════════════════════════════════════════════════════════════════
// Vendor Review — vdrProcessAllPdf(docId) single-document scoping tests
// (BOH OS Task 11J, esteso in Task 11M per il reprocess di documenti pending)
// Plain Node, zero dipendenze esterne: `node tests/vendor-documents-single-processing.test.js`
//
// Esegue la logica reale di costruzione query estratta da
// js/vendor-documents-review.js (marker espliciti) contro un mock Supabase
// che si comporta come un vero DB: contiene TUTTE le righe e applica i
// filtri .eq()/.in() realmente chiamati dal codice — se il codice non
// chiamasse .eq('id', docId) o .in('status', [...]), il mock restituirebbe
// più righe di quelle attese e il test lo scoprirebbe. Non è un mock che
// "sa già" cosa filtrare.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const VDR_JS = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');
const VP_UI_JS = path.join(__dirname, '..', 'js', 'vendor-parser-ui.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); } }
async function atest(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); } }

function readSrc() { return fs.readFileSync(VDR_JS, 'utf8'); }

// Estrae il blocco reale di costruzione/esecuzione della query (Task 11J/11M).
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

// Mock Supabase "come un vero DB": contiene l'intera tabella e applica
// DAVVERO sia .eq() che .in() così come chiamati dal codice reale.
function makeMockSb(allRows) {
  const calls = { eqs: [], ins: [] };
  const sb = {
    from(_table) {
      const c = {
        _eqs: [], _ins: [],
        select() { return c; },
        eq(k, v) { c._eqs.push([k, v]); calls.eqs.push([k, v]); return c; },
        in(k, values) { c._ins.push([k, values]); calls.ins.push([k, values]); return c; },
        order() {
          const matched = allRows.filter(row =>
            c._eqs.every(([k, v]) => row[k] === v) &&
            c._ins.every(([k, values]) => values.includes(row[k]))
          );
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

console.log('\nVendor Review — vdrProcessAllPdf(docId) single-document scoping — test run\n');

// ── Fixture per T1-T6: copre pdf_received, pending, imported, error ────
const ALL_ROWS_STATUSES = [
  { id: 'A-pdf-received', status: 'pdf_received', parsed_json: { source: 'email_html' } },
  { id: 'B-pending',      status: 'pending',      parsed_json: { source: 'email_html' } },
  { id: 'C-imported',     status: 'imported',     parsed_json: { source: 'email_html' } },
  { id: 'D-error',        status: 'error',        parsed_json: null },
];

(async () => {

  // ── T1 — Pending single document: A(pending) riprocessato via docId ──
  await atest("T1: vdrProcessAllPdf('B-pending') con status=pending -> il documento viene incluso nella queue (riprocessabile)", async () => {
    const { sb } = makeMockSb(ALL_ROWS_STATUSES);
    const queue = await runQuery(sb, 'B-pending');
    assert.strictEqual(queue.length, 1);
    assert.strictEqual(queue[0].id, 'B-pending');
  });

  // ── T2 — Batch non include pending: solo pdf_received processato ────
  await atest('T2: vdrProcessAllPdf() (batch, nessun docId) include SOLO pdf_received, MAI pending', async () => {
    const { sb, calls } = makeMockSb(ALL_ROWS_STATUSES);
    const queue = await runQuery(sb, undefined);
    assert.strictEqual(queue.length, 1);
    assert.strictEqual(queue[0].id, 'A-pdf-received');
    assert.ok(!queue.some(d => d.status === 'pending'), 'il batch non deve mai includere documenti pending');
    assert.ok(!calls.ins.length, 'il batch non deve mai usare .in() sullo status — solo .eq(status,pdf_received)');
  });

  // ── T3 — Scoped: due pending, solo quello richiesto viene selezionato ──
  await atest("T3: due documenti pending nella tabella, vdrProcessAllPdf('B-pending') seleziona SOLO quello richiesto", async () => {
    const rows = [
      { id: 'B-pending', status: 'pending', parsed_json: { source: 'email_html' } },
      { id: 'E-pending-other', status: 'pending', parsed_json: { source: 'email_html' } },
    ];
    const { sb } = makeMockSb(rows);
    const queue = await runQuery(sb, 'B-pending');
    assert.strictEqual(queue.length, 1);
    assert.strictEqual(queue[0].id, 'B-pending');
  });

  // ── T4 — Imported protetto: 0 risultati, mai selezionabile ──────────
  await atest("T4: vdrProcessAllPdf('C-imported') -> 0 documenti (status imported non è mai riprocessabile)", async () => {
    const { sb } = makeMockSb(ALL_ROWS_STATUSES);
    const queue = await runQuery(sb, 'C-imported');
    assert.strictEqual(queue.length, 0);
  });

  // ── T5 — Error protetto: 0 risultati ─────────────────────────────────
  await atest("T5: vdrProcessAllPdf('D-error') -> 1 documento (status error è ora riprocessabile — fix task)", async () => {
    const { sb } = makeMockSb(ALL_ROWS_STATUSES);
    const queue = await runQuery(sb, 'D-error');
    assert.strictEqual(queue.length, 1);
    assert.strictEqual(queue[0].id, 'D-error');
  });

  // ── T6 — Comportamento pdf_received single-document invariato (Task 11J) ──
  await atest("T6: vdrProcessAllPdf('A-pdf-received') continua a funzionare come nel Task 11J", async () => {
    const { sb, calls } = makeMockSb(ALL_ROWS_STATUSES);
    const queue = await runQuery(sb, 'A-pdf-received');
    assert.strictEqual(queue.length, 1);
    assert.strictEqual(queue[0].id, 'A-pdf-received');
    assert.ok(calls.ins.some(([k, values]) => k === 'status' && values.includes('pdf_received') && values.includes('pending')));
  });

  // ── T7 — Integrazione: BEK pending riprocessato + fix data (Task 11L) ──
  // Combina, sul codice reale: (a) la query ammette un documento pending
  // scoped per docId (T1/T3 sopra), e (b) il parser + la logica di mapping
  // data reali (stessa tecnica di tests/bek-date-mapping-fix.test.js)
  // producono document_date/delivery_date corretti per quel documento.
  await atest('T7: documento BEK pending, riprocessato via docId, ottiene document_date e delivery_date corretti (integrazione col fix Task 11L)', async () => {
    // 7a — il documento pending è selezionabile dalla query reale
    const rows = [{ id: 'bek-pending', status: 'pending', parsed_json: { source: 'email_html' } }];
    const { sb } = makeMockSb(rows);
    const queue = await runQuery(sb, 'bek-pending');
    assert.strictEqual(queue.length, 1, 'il documento BEK pending deve essere selezionabile via docId');

    // 7b — il parser reale + la logica reale di mapping data (Task 11L)
    // producono i valori attesi per "Delivery Date 08/20/2026"
    const vpSrc = fs.readFileSync(VP_UI_JS, 'utf8');
    const vpStart = vpSrc.indexOf('function buildVendorParsers() {');
    const vpEnd = vpSrc.indexOf('// ── BRIDGE: Parser result → Invoice Import pipeline ───────────');
    global.DOMParser = function () {
      return {
        parseFromString(html) {
          const bodyText = String(html).replace(/<[^>]+>/g, ' ');
          return { body: { textContent: bodyText }, querySelectorAll: () => [] };
        },
      };
    };
    global.window = global.window || {};
    const parsers = new Function(vpSrc.slice(vpStart, vpEnd) + '\nreturn buildVendorParsers();')();
    const html = '<p>Sales Order # 0002952908</p><p>Delivery Date 08/20/2026</p><p>Order Total $81.96</p>';
    const parsed = parsers.parseBekOrderConfirmationHtml(html);

    const vdrSrc = readSrc();
    const docDateLine = "const docDate   = parsed.order_date   || parsed.credit_date   || parsed.delivery_date || null;";
    assert.ok(vdrSrc.includes(docDateLine), 'riga reale di calcolo docDate non trovata');
    const computeDocDate = new Function('parsed', docDateLine + '\nreturn docDate;');
    const document_date = computeDocDate(parsed);
    const delivery_date = parsed.delivery_date || null;

    assert.strictEqual(document_date, '2026-08-20');
    assert.strictEqual(delivery_date, '2026-08-20');
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
