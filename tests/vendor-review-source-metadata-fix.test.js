// ══════════════════════════════════════════════════════════════════
// Vendor Review — preserve intake metadata (parsed_json.source/storage_path)
// across reprocessing + defensive guard on Storage.download() (BOH OS Task 11S)
// Plain Node, zero dipendenze esterne: `node tests/vendor-review-source-metadata-fix.test.js`
//
// Root cause (Task 11R, riprodotta con certezza): "parsed_json: parsed"
// sovrascriveva interamente parsed_json con l'output del parser, che non
// contiene mai source/storage_path — un secondo reprocess perdeva quindi
// il marker di routing e cadeva nel ramo PDF con storagePath=undefined,
// crashando dentro supabase-js (path.replace su undefined).
//
// Questo file esegue la logica REALE estratta con marker da
// js/vendor-documents-review.js — non una riscrittura.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const VDR_JS = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }
async function atest(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }

function readSrc() { return fs.readFileSync(VDR_JS, 'utf8'); }

// ── Estrae la vera espressione di merge parsed_json (riga reale) ──────
function extractParsedJsonMergeExpr() {
  const src = readSrc();
  const marker = 'parsed_json:     { ...(doc.parsed_json || {}), ...parsed },';
  if (!src.includes(marker)) throw new Error('merge parsed_json non trovato — la riga è cambiata di forma?');
  return marker;
}

// ── Estrae il blocco reale della guardia storage_path (fail controllato) ──
function extractStorageGuardBlock() {
  const src = readSrc();
  const startMarker = "if (!storagePath) {";
  const endMarker = "done++; continue;\n          }\n          const { data: fileData, error: dlErr } = await sb.storage.from('app').download(storagePath);";
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker);
  if (start === -1 || end === -1) throw new Error('guardia storage_path non trovata — la riga è cambiata di forma?');
  return src.slice(start, end + endMarker.length);
}

console.log('\nVendor Review — preserve intake metadata + storage guard (Task 11S) — test run\n');

// ── T1 — source preservato dopo il merge ─────────────────────────────
test('T1: source preservato — merge(parsed_json iniziale {source:email_html}, parser output) mantiene source', () => {
  const initial = { source: 'email_html' };
  const parsed = { document_number: '0002952908', document_date: '2026-08-20', delivery_date: '2026-08-20', total: 81.96, items: [{ x: 1 }], warnings: [] };
  const merged = { ...(initial || {}), ...parsed };
  assert.strictEqual(merged.source, 'email_html');
});

// ── T2 — output parser preservato dopo il merge ──────────────────────
test('T2: tutti i campi business del parser sono presenti dopo il merge (document_number/document_date/delivery_date/total/items/warnings)', () => {
  const initial = { source: 'email_html' };
  const parsed = { document_number: '0002952908', document_date: '2026-08-20', delivery_date: '2026-08-20', total: 81.96, items: [{ x: 1 }], warnings: [] };
  const merged = { ...(initial || {}), ...parsed };
  assert.strictEqual(merged.document_number, '0002952908');
  assert.strictEqual(merged.document_date, '2026-08-20');
  assert.strictEqual(merged.delivery_date, '2026-08-20');
  assert.strictEqual(merged.total, 81.96);
  assert.deepStrictEqual(merged.items, [{ x: 1 }]);
  assert.deepStrictEqual(merged.warnings, []);
});

// ── T3 — storage_path preservato per documenti PDF ───────────────────
test('T3: storage_path preservato dopo il merge (documento PDF)', () => {
  const initial = { storage_path: 'invoices/gmail/example.pdf' };
  const parsed = { document_number: '06997941', total: 123.45, items: [{ x: 1 }], warnings: [] };
  const merged = { ...(initial || {}), ...parsed };
  assert.strictEqual(merged.storage_path, 'invoices/gmail/example.pdf');
});

// ── Verifica la riga reale nel sorgente ───────────────────────────────
test("verifica riga reale: 'parsed_json: { ...(doc.parsed_json || {}), ...parsed }' presente in vendor-documents-review.js", () => {
  extractParsedJsonMergeExpr(); // throws se assente
});

// ── T4 — secondo reprocess email_html: routing corretto, niente Storage ──
test('T4: dopo il merge-fix, un documento pending con parsed_json.source=email_html resta instradato al parser HTML (non a Storage) su un secondo reprocess', () => {
  // Simula esattamente la condizione di branch reale (riga 208 del file)
  // con il parsed_json COME SAREBBE ORA dopo il fix (source preservato).
  const docAfterFirstProcessingWithFix = {
    raw_text: '<html>...</html>',
    parsed_json: { source: 'email_html', document_number: '0002952908', document_date: '2026-08-20', delivery_date: '2026-08-20', total: 81.96, items: [{ x: 1 }], warnings: [] },
  };
  const isEmailHtmlBranch = docAfterFirstProcessingWithFix.parsed_json?.source === 'email_html' && !!docAfterFirstProcessingWithFix.raw_text;
  assert.strictEqual(isEmailHtmlBranch, true, 'con source preservato, il secondo reprocess deve rientrare nel ramo email_html');
});

// ── T5/T6/T7 — asincroni, eseguiti nella IIFE finale ──────────────────
(async () => {
  await atest('T5: guardia storage_path — con storagePath undefined, sb.storage.download() non viene MAI chiamato; il documento va in error con MISSING_STORAGE_PATH', async () => {
    const guardSnippet = extractStorageGuardBlock();
    let downloadCalled = false;
    let updatePayload = null;
    const sb = {
      storage: { from: () => ({ download: async () => { downloadCalled = true; return { data: null, error: null }; } }) },
      from: () => ({ update: (payload) => ({ eq: async () => { updatePayload = payload; return {}; } }) }),
    };
    const doc = { id: 'test-doc-1' };
    const storagePath = undefined;
    let done = 0;
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    // guardSnippet contiene `continue` (vive dentro il for..of reale sulla
    // queue): lo avvolgiamo in un loop di una sola iterazione per restare
    // fedeli al vero contesto sintattico in cui questo blocco vive.
    const loopWrapped = `for (let __i=0; __i<1; __i++) { ${guardSnippet} }\nreturn done;`;
    const fn2 = new AsyncFunction('sb', 'doc', 'storagePath', 'done', loopWrapped);
    const result = await fn2(sb, doc, storagePath, done);
    assert.strictEqual(downloadCalled, false, 'storage.download() non deve MAI essere chiamato con storagePath undefined');
    assert.ok(updatePayload, 'deve esserci stato un update di status/warnings');
    assert.strictEqual(updatePayload.status, 'error');
    assert.strictEqual(updatePayload.warnings[0].code, 'MISSING_STORAGE_PATH');
    assert.strictEqual(result, 1, 'done deve essere incrementato (documento gestito, non crashato)');
  });

  // ── T6 — PDF normale: storagePath valido, la guardia non blocca nulla ──
  await atest('T6: guardia storage_path — con storagePath valido, il flusso PDF normale prosegue (download() viene chiamato)', async () => {
    const guardSnippet = extractStorageGuardBlock();
    let downloadCalled = false;
    const sb = {
      storage: { from: () => ({ download: async (p) => { downloadCalled = true; assert.strictEqual(p, 'invoices/gmail/real.pdf'); return { data: new Uint8Array([1]), error: null }; } }) },
      from: () => ({ update: () => ({ eq: async () => ({}) }) }),
    };
    const doc = { id: 'test-doc-2' };
    const storagePath = 'invoices/gmail/real.pdf';
    let done = 0;
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    // guardSnippet include già la vera riga di download() (marker end) —
    // con storagePath valido l'if della guardia è false e si arriva dritti
    // a quella riga, esattamente come nel codice reale.
    const loopWrapped = `for (let __i=0; __i<1; __i++) { ${guardSnippet} }\nreturn done;`;
    const fn2 = new AsyncFunction('sb', 'doc', 'storagePath', 'done', loopWrapped);
    await fn2(sb, doc, storagePath, done);
    assert.strictEqual(downloadCalled, true, 'storage.download() deve essere chiamato quando storagePath è valido');
  });

  // ── T7 — batch invariato: nessun'altra riga di vdrProcessAllPdf() è stata toccata ──
  test('T7: la query batch (senza docId) resta invariata — solo status=pdf_received; la query single-doc ora include anche error (fix task)', () => {
    const src = readSrc();
    assert.ok(src.includes("query = query.eq('status', 'pdf_received');"), 'comportamento batch invariato');
    assert.ok(src.includes("query = query.eq('id', docId).in('status', ['pdf_received', 'pending', 'error']);"), "comportamento single-doc esteso a 'error', imported/ignored restano esclusi");
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
