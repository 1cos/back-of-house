// ══════════════════════════════════════════════════════════════════
// Ben E. Keith parser — Node/browser parity tests (BOH OS Task 9)
// Plain Node, no framework: `node tests/bek-parser-parity.test.js`
//
// Confronta il parser Node reale (js/vendor-parsers/bek-invoice.js,
// require()-abile) con la porta browser reale appena aggiunta a
// js/vendor-parser-ui.js (buildVendorParsers -> detectVendor/parse).
// js/vendor-parser-ui.js è codice browser e non è require()-abile
// direttamente (window.VendorParsers = buildVendorParsers() a livello
// top-level); come negli altri test di questa serie, il sorgente reale
// viene letto ed eseguito via marker espliciti — non è una riscrittura
// della logica.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const VP_UI_JS = path.join(__dirname, '..', 'js', 'vendor-parser-ui.js');
const bekNode = require(path.join(__dirname, '..', 'js', 'vendor-parsers', 'bek-invoice.js'));
const { BEK_FIXTURE_INVOICE, NOT_BEK_TEXT } = require('./fixtures/bek-sample.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); }
}

function loadRealBrowserParsers() {
  const src = fs.readFileSync(VP_UI_JS, 'utf8');
  const startMarker = 'function buildVendorParsers() {';
  const endMarker = '// ── BRIDGE: Parser result → Invoice Import pipeline ───────────';
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    throw new Error('marker non trovati in js/vendor-parser-ui.js — buildVendorParsers è cambiata di forma?');
  }
  // Include fino alla chiusura della funzione (subito prima del commento BRIDGE)
  const body = src.slice(start, end);
  const factory = new Function(body + '\nreturn buildVendorParsers();');
  return factory(); // { parse, detectVendor, detectDocumentType }
}

console.log('\nBen E. Keith parser — Node/browser parity test run\n');

const browserParsers = loadRealBrowserParsers();
const nodeResult = bekNode.parse(BEK_FIXTURE_INVOICE);
const browserResult = browserParsers.parse(BEK_FIXTURE_INVOICE);

// ── T1 — Vendor detection ────────────────────────────────────────
test("T1: detectVendor(testo BEK reale) === 'bek'", () => {
  assert.strictEqual(browserParsers.detectVendor(BEK_FIXTURE_INVOICE), 'bek');
});

// ── T2 — Non false positive ──────────────────────────────────────
test('T2: un testo che menziona solo la parola "Keith" NON viene classificato come bek', () => {
  assert.notStrictEqual(browserParsers.detectVendor(NOT_BEK_TEXT), 'bek');
});

// ── T3 — Invoice number ──────────────────────────────────────────
test('T3: il parser browser estrae lo stesso invoice number del parser Node', () => {
  assert.ok(nodeResult.invoice_number, 'fixture non valida — Node non ha estratto nessun invoice_number');
  assert.strictEqual(browserResult.document_number, nodeResult.invoice_number);
});

// ── T4 — Items ────────────────────────────────────────────────────
test('T4: stesso numero di line items tra Node e browser', () => {
  assert.strictEqual(nodeResult.items.length, 4, 'fixture non valida — attesi 4 item dal parser Node');
  assert.strictEqual(browserResult.items.length, nodeResult.items.length);
});

// ── T5 — Quantità/prezzi (almeno 2 righe rappresentative) ────────
test('T5: quantity/pack/unit_price/extended_price equivalenti su almeno 2 righe', () => {
  for (const idx of [0, 2]) { // Chicken Breast (2/10 LB) e Olive Oil (3/1 GAL)
    const n = nodeResult.items[idx];
    const b = browserResult.items[idx];
    assert.strictEqual(b.vendor_sku, n.vendor_sku, `riga ${idx}: sku`);
    assert.strictEqual(b.qty_ordered, n.qty_ordered, `riga ${idx}: quantity`);
    assert.strictEqual(b.pack_description, n.pack_description, `riga ${idx}: pack`);
    assert.strictEqual(b.unit_price, n.unit_price, `riga ${idx}: unit_price`);
    assert.strictEqual(b.amount, n.amount, `riga ${idx}: extended_price`);
    assert.strictEqual(b.conversion_to_base, n.conversion_to_base, `riga ${idx}: conversione peso`);
  }
});

// ── T6 — Total ─────────────────────────────────────────────────────
test('T6: il total documento coincide tra Node e browser', () => {
  assert.strictEqual(nodeResult.total, 286);
  assert.strictEqual(browserResult.total, nodeResult.total);
});

// ── T7 — Dispatcher: raggiungibile dal path reale usato da Vendor Review ──
test('T7: buildVendorParsers().parse() instrada davvero al parser BEK (non solo funzione isolata)', () => {
  // parse() fa detectVendor() + detectDocumentType() + routing interno — è
  // esattamente la funzione chiamata da vdrProcessAllPdf() in
  // js/vendor-documents-review.js ("const parsers = buildVendorParsers(); ...
  // parsers.parse(rawText)").
  assert.strictEqual(browserResult.vendor, 'Ben E. Keith');
  assert.strictEqual(browserResult.document_type, 'invoice');
  assert.ok(browserResult.items.length > 0);
  // Non deve più finire in UNKNOWN_VENDOR
  const hasUnknownVendorWarning = (browserResult.warnings || []).some(w => w.code === 'UNKNOWN_VENDOR');
  assert.strictEqual(hasUnknownVendorWarning, false);
});

// ── T8 — Existing vendors invariati ──────────────────────────────
test("T8: Hardie's, FreshPoint e Fruge restano riconosciuti come prima", () => {
  assert.strictEqual(browserParsers.detectVendor("Dairyland Produce, LLC (dba Hardie's Fresh Foods)"), 'hardies');
  assert.strictEqual(browserParsers.detectVendor('FRESHPOINT DALLAS order confirmation'), 'freshpoint');
  assert.strictEqual(browserParsers.detectVendor('FRUGE SEAFOOD invoice'), 'fruge');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
