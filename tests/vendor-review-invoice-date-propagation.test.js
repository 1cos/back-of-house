// ══════════════════════════════════════════════════════════════════
// vendor-documents-review.js — invoice_date propagation regression
// Plain Node, no framework: `node tests/vendor-review-invoice-date-propagation.test.js`
//
// js/vendor-documents-review.js è codice browser dentro una funzione async
// molto grande (vdrPreflight), non isolabile con require(). Come già negli
// altri test di questa serie (vendor-documents-reconciliation.test.js), il
// test legge il sorgente reale ed estrae il calcolo esatto di `invoiceDate`
// — non una riscrittura della logica.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const VDR_JS = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

const src = fs.readFileSync(VDR_JS, 'utf8');

// Extract the exact single line that computes invoiceDate inside vdrPreflight.
const lineMatch = src.match(/const invoiceDate = ([^;]+);/);
assert.ok(lineMatch, 'could not find the invoiceDate computation line in the real source — file may have changed');
const invoiceDateExpr = lineMatch[1];

console.log('\ninvoice_date propagation — regression tests\n');
console.log('  Extracted expression: const invoiceDate = ' + invoiceDateExpr + ';\n');

function computeInvoiceDate(doc) {
  // eslint-disable-next-line no-new-func
  return new Function('doc', 'return (' + invoiceDateExpr + ');')(doc);
}

test('T1: normal invoice — document_date already resolved from order_date', () => {
  // doc.document_date is what the header logic already wrote for this
  // document (order_date was 2026-08-24 in this scenario).
  const doc = { document_date: '2026-08-24', parsed_json: { order_date: '2026-08-24', invoice_date: undefined } };
  assert.strictEqual(computeInvoiceDate(doc), '2026-08-24');
});

test('T2: credit document — document_date resolved from credit_date (order_date was null)', () => {
  const doc = { document_date: '2026-08-20', parsed_json: { order_date: null, credit_date: '2026-08-20' } };
  assert.strictEqual(computeInvoiceDate(doc), '2026-08-20');
});

test('T3: delivery fallback — document_date resolved from delivery_date', () => {
  const doc = { document_date: '2026-08-19', parsed_json: { order_date: null, credit_date: null, delivery_date: '2026-08-19' } };
  assert.strictEqual(computeInvoiceDate(doc), '2026-08-19');
});

test('T4: no date anywhere — stays null, no today-fallback', () => {
  const doc = { document_date: null, parsed_json: {} };
  assert.strictEqual(computeInvoiceDate(doc), null);
});

test('Proves the OLD behavior would have failed T1 (pj.invoice_date never exists)', () => {
  const doc = { document_date: '2026-08-24', parsed_json: { order_date: '2026-08-24' } };
  const oldBehavior = doc.parsed_json.invoice_date || null; // the exact old expression
  assert.strictEqual(oldBehavior, null, 'documents that the old code always produced null here');
  assert.notStrictEqual(computeInvoiceDate(doc), oldBehavior, 'new behavior must differ from the old one for this case');
});

test('Never falls back to created_at or new Date()', () => {
  assert.ok(!invoiceDateExpr.includes('created_at'), 'expression must not reference created_at');
  assert.ok(!invoiceDateExpr.includes('new Date'), 'expression must not reference new Date()');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail > 0 ? 1 : 0);
