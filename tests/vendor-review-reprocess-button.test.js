// ══════════════════════════════════════════════════════════════════
// Vendor Review — bottone "Reprocess" per un singolo documento pending
// (BOH OS Task 11N)
// Plain Node, zero dipendenze esterne: `node tests/vendor-review-reprocess-button.test.js`
//
// Esegue il codice reale (renderer HTML e handler) estratto da
// js/vendor-documents-review.js con marker espliciti, non una riscrittura.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const VDR_JS = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); } }
async function atest(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); } }

function readSrc() { return fs.readFileSync(VDR_JS, 'utf8'); }

// ── Estrae la porzione HTML del footer sticky (bottom sheet, il path reale
// usato al tap su una card — onclick="vdrToggle(...)") per verificarne la
// visibilità condizionale senza reimplementarla.
function renderStickyFooter(doc) {
  const src = readSrc();
  const marker = "${doc.status === 'pending' ? `<button id=\"vdrReprocessBtn-${doc.id}\" onclick=\"vdrReprocessOne('${doc.id}',this)\"";
  if (!src.includes(marker)) throw new Error('riga del bottone Reprocess (sticky footer) non trovata o cambiata');
  const start = src.indexOf('${doc.status === \'pending\' ?', src.indexOf(marker));
  const lineEnd = src.indexOf('\n', start);
  const line = src.slice(start, lineEnd);
  // Valuta la sola espressione ternaria come template literal reale.
  const exprSrc = line.replace(/^\$\{/, '').replace(/\}$/, '');
  const fn = new Function('doc', 'return ' + exprSrc + ';');
  return fn(doc);
}

// ── Estrae vdrReprocessOne (JS puro, esegue il codice reale) ────────
function extractReprocessHandler() {
  const src = readSrc();
  const startMarker = 'window.vdrReprocessOne = async function(docId, btn) {';
  const start = src.indexOf(startMarker);
  if (start === -1) throw new Error('vdrReprocessOne non trovato');
  const bodyStart = start + startMarker.length;
  const end = src.indexOf('\n};\n', bodyStart) + 3;
  return src.slice(bodyStart, end - 3); // esclude il "};" finale, lo aggiunge new Function
}

console.log('\nVendor Review — bottone Reprocess single-document — test run\n');

// ── T1 — pending → Reprocess visibile ────────────────────────────────
test('T1: status=pending -> il bottone Reprocess è presente nel footer sticky', () => {
  const html = renderStickyFooter({ id: 'doc-A', status: 'pending' });
  assert.ok(html.includes('vdrReprocessOne'), 'bottone Reprocess assente per status=pending');
  assert.ok(html.includes("'doc-A'"), "l'id reale del documento deve comparire nell'onclick, non hardcoded");
});

// ── T2 — imported/error/ignored → Reprocess assente ──────────────────
test('T2: status=imported/error/ignored -> il bottone Reprocess è assente', () => {
  for (const status of ['imported', 'error', 'ignored']) {
    const html = renderStickyFooter({ id: 'doc-A', status });
    assert.strictEqual(html, '', `bottone Reprocess non deve comparire per status=${status}`);
  }
});

// ── T3 — tap su A -> vdrProcessAllPdf('A'), mai batch senza argomento ──
// ── T4 — due documenti pending A/B: tap su A non passa mai B ─────────
// ── T5 — protezione doppio tap ────────────────────────────────────────
(async () => {

  await atest("T3: vdrReprocessOne('A', btn) chiama vdrProcessAllPdf('A') — mai vdrProcessAllPdf() senza argomento", async () => {
    const handlerBody = extractReprocessHandler();
    const calls = [];
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction('docId', 'btn', 'vdrProcessAllPdf', handlerBody);
    const btn = { disabled: false, textContent: '🔄 Reprocess', dataset: {} };
    await fn('A', btn, async (docId) => { calls.push(docId); });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0], 'A');
    assert.notStrictEqual(calls[0], undefined, 'non deve mai essere chiamato senza argomento');
  });

  await atest("T4: due bottoni Reprocess indipendenti (A e B) passano sempre il proprio id, mai quello dell'altro", async () => {
    const handlerBody = extractReprocessHandler();
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction('docId', 'btn', 'vdrProcessAllPdf', handlerBody);

    const callsA = []; const callsB = [];
    const btnA = { disabled: false, textContent: '🔄 Reprocess', dataset: {} };
    const btnB = { disabled: false, textContent: '🔄 Reprocess', dataset: {} };

    await fn('A', btnA, async (id) => callsA.push(id));
    await fn('B', btnB, async (id) => callsB.push(id));

    assert.deepStrictEqual(callsA, ['A']);
    assert.deepStrictEqual(callsB, ['B']);
  });

  await atest('T5: doppio tap rapido su Reprocess -> vdrProcessAllPdf chiamato una sola volta', async () => {
    const handlerBody = extractReprocessHandler();
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction('docId', 'btn', 'vdrProcessAllPdf', handlerBody);

    let calls = 0;
    let resolveProcessing;
    const slowProcess = () => new Promise(resolve => { resolveProcessing = resolve; calls++; });
    const btn = { disabled: false, textContent: '🔄 Reprocess', dataset: {} };

    const firstTap = fn('A', btn, slowProcess);
    // Il bottone deve essere già disabilitato in modo sincrono prima che la
    // prima chiamata risolva — un secondo tap immediato deve essere ignorato.
    assert.strictEqual(btn.disabled, true, 'il bottone deve disabilitarsi immediatamente al primo tap');
    const secondTap = fn('A', btn, slowProcess); // deve fare no-op per via di btn.disabled

    resolveProcessing();
    await Promise.all([firstTap, secondTap]);

    assert.strictEqual(calls, 1, 'un doppio tap rapido non deve avviare due processing paralleli');
    assert.strictEqual(btn.disabled, false, 'il bottone deve riabilitarsi al termine');
  });

  // ── T6 — pulsante batch esistente invariato ───────────────────────────
  test('T6: il pulsante batch esistente (Processa tutti) e i suoi call-site restano invariati', () => {
    const src = readSrc();
    assert.ok(src.includes('window.vdrProcessAllPdf = async function(docId) {'), 'firma di vdrProcessAllPdf invariata');
    const calls = src.match(/onclick="vdrProcessAllPdf\([^)]*\)"/g) || [];
    assert.ok(calls.length >= 2, 'attesi almeno i 2 call-site esistenti del pulsante batch');
    calls.forEach(c => assert.strictEqual(c, 'onclick="vdrProcessAllPdf()"', 'i call-site del pulsante batch devono continuare a chiamare senza argomenti'));
  });

  // ── Verifica: il fix al log-null non blocca più il reprocess quando il
  // banner pdf_received non è renderizzato (bug scoperto durante questo task) ──
  test("il loop di vdrProcessAllPdf non si interrompe più se vdrProcessLog non esiste nel DOM (necessario per il reprocess da pending)", () => {
    const src = readSrc();
    assert.ok(!src.includes('if (!log) break;'), 'il break bloccante su log assente deve essere stato rimosso');
    assert.ok(src.includes('if (log) log.textContent = `Processing'), 'il log deve restare best-effort, mai bloccante');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
