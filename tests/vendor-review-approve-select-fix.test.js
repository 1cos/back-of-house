// ══════════════════════════════════════════════════════════════════
// vdrApprove() — invoice_date select-bug regression test
// Plain Node, no framework: `node tests/vendor-review-approve-select-fix.test.js`
//
// The previous test (vendor-review-invoice-date-propagation.test.js)
// mocked `doc.document_date` as already present — it never reproduced
// the REAL refetch query inside vdrApprove(), which is exactly where
// the bug lived. This test extracts that exact select() string from
// the live source and evaluates it against a fake Supabase client that
// only returns the columns actually listed in the select — the same
// discipline a real Postgrest client would enforce. If document_date
// isn't in the select string, this fake client won't return it either,
// so the bug (and the fix) show up exactly as they do in production.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// MICRO-TASK 42: i blocchi estratti da vendor-documents-review.js delegano
// la regola "questo documento genera un acquisto?" al modulo canonico.
// Iniettata QUI IN TESTA: alcuni test girano a livello top-level e devono
// trovarla gia definita. E la REGOLA VERA, non uno stub.
global.vdrIsPurchasableDocument = require('../js/vendor-parsers/ben-e-keith-order-confirmation').isPurchasableDocument;




const SRC_PATH = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

// Extract the real select() string used by vdrApprove's own refetch —
// not a copy, the literal substring from the live file.
const selectMatch = src.match(/from\('vendor_documents'\)\.select\('([^']+)'\)\.eq\('id', docId\)\.single\(\)/);
assert.ok(selectMatch, 'could not find vdrApprove\'s refetch select in the real source');
const selectedColumns = selectMatch[1].split(',');

console.log('\nvdrApprove() refetch select-bug regression\n');
console.log('  Extracted select columns:', selectedColumns.join(', '));

// Extract the real invoiceDate assignment line too.
const invoiceDateMatch = src.match(/const invoiceDate = ([^;]+);/);
assert.ok(invoiceDateMatch, 'could not find the invoiceDate assignment in the real source');
const invoiceDateExpr = invoiceDateMatch[1];

// A fake row exactly as the real vendor_documents row would look —
// with a real, non-null document_date on the underlying record.
const REAL_ROW = {
  parsed_json: { document_type: 'invoice', items: [] },
  vendor: "Hardie's Fresh Foods / Dairyland Produce",
  warnings: [],
  status: 'pending',
  document_number: '07092195',
  document_date: '2026-08-24', // the true value on the DB row
};

// Simulate a real Postgrest .select(cols) — only returns the requested columns.
function simulateSelect(row, cols) {
  const out = {};
  for (const c of cols) out[c] = row[c];
  return out;
}

test('T1: document_date present on the DB row AND in the select → propagates correctly (post-fix)', () => {
  assert.ok(selectedColumns.includes('document_date'), 'FIX NOT PRESENT: document_date missing from vdrApprove\'s select — this is exactly the bug');
  const doc = simulateSelect(REAL_ROW, selectedColumns);
  const invoiceDate = new Function('doc', 'return (' + invoiceDateExpr + ');')(doc);
  assert.strictEqual(invoiceDate, '2026-08-24');
});

test('T2: document_date genuinely NULL on the DB row → invoiceDate stays null, nothing invented', () => {
  const nullRow = { ...REAL_ROW, document_date: null };
  const doc = simulateSelect(nullRow, selectedColumns);
  const invoiceDate = new Function('doc', 'return (' + invoiceDateExpr + ');')(doc);
  assert.strictEqual(invoiceDate, null);
});

test('T3: invoiceDate expression never references created_at or new Date()', () => {
  assert.ok(!invoiceDateExpr.includes('created_at'));
  assert.ok(!/new Date/.test(invoiceDateExpr));
});

test('T4: the v825 canonical SKU guard still decides the four original cases the same way', () => {
  // Riscritto in GG09 (29/09/2026). L'intento resta quello di sempre:
  // il fix del select non deve cambiare questa guardia. Prima lo
  // verificava sul TESTO, congelando la firma a due argomenti e la forma
  // a quattro rami. GG09 ha aggiunto un quinto caso — identita' da
  // ingredient_links confermato, nessuno SKU da nessuna parte — quindi
  // il testo e' cambiato per una ragione autorizzata e documentata.
  //
  // Adesso si verifica il COMPORTAMENTO, che e' cio' che il test voleva
  // davvero proteggere: i quattro casi originali rispondono esattamente
  // come prima, e il caso nuovo NON si attiva se non glielo si chiede.
  const m = src.match(/function vdrDecideCanonicalUpdate\([\s\S]*?\n\}/);
  assert.ok(m, 'la guardia deve esistere');
  const decide = new Function(m[0] + '\nreturn vdrDecideCanonicalUpdate;')();

  // I quattro casi originali, chiamati come li chiamava il codice di
  // allora: due soli argomenti.
  assert.strictEqual(decide(null,  null), 'skip',          'Caso D');
  assert.strictEqual(decide(null,  'ABC'), 'populate_sku', 'Caso C');
  assert.strictEqual(decide('XYZ', 'XYZ'), 'update',       'Caso A');
  assert.strictEqual(decide('XYZ', 'ABC'), 'skip',         'Caso B');

  // Il caso E e' additivo e richiede un consenso esplicito.
  assert.strictEqual(decide(null, null, true), 'update', 'Caso E, richiesto');
  assert.strictEqual(decide('XYZ', null, true), 'skip',
    'SKU memorizzato ma non in arrivo: resta ambiguo, resta skip');
});

test('T5: vdrAutoImportCleanHardiesInvoices (v830) is untouched by this fix', () => {
  assert.ok(src.includes('async function vdrAutoImportCleanHardiesInvoices()'));
  assert.ok(src.includes("doc.status === 'pending'"));
  assert.ok(src.includes('window.vdrApprove(doc.id, noopBtn)'));
});

// ── Proves the OLD behavior (pre-fix) would have failed T1 ─────────
test('Proves pre-fix select (without document_date) always produced NULL, even with a real date on the row', () => {
  const preFixColumns = ['parsed_json', 'vendor', 'warnings', 'status', 'document_number']; // the exact old select
  const doc = simulateSelect(REAL_ROW, preFixColumns); // document_date silently dropped, like real Postgrest would
  const invoiceDate = new Function('doc', 'return (' + invoiceDateExpr + ');')(doc);
  assert.strictEqual(invoiceDate, null, 'documents the exact bug: real date on the row, but NULL written because the select omitted the column');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail > 0 ? 1 : 0);
