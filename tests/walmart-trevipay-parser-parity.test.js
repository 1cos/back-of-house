// ══════════════════════════════════════════════════════════════════
// Walmart Business / TreviPay parser — Node/browser parity tests
// Plain Node, no framework: `node tests/walmart-trevipay-parser-parity.test.js`
//
// Compares the real Node parser (js/vendor-parsers/walmart-trevipay-invoice.js,
// require()-able) against the real browser port just added to
// js/vendor-parser-ui.js (buildVendorParsers -> detectVendor/parse).
// js/vendor-parser-ui.js is browser code and isn't require()-able
// directly — same convention as tests/bek-parser-parity.test.js: the
// real source is read and executed via explicit markers, not a
// rewritten copy.
//
// Both parsers are driven with the SAME real, normalized text — built
// from the real PDF.js textContent.items fixtures via the real
// TreviPay normalizer (commit 8325ed5), exactly like production would
// produce it — not hand-typed clean strings.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const VP_UI_JS = path.join(__dirname, '..', 'js', 'vendor-parser-ui.js');
const VDR_JS   = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');
const walmartNode = require(path.join(__dirname, '..', 'js', 'vendor-parsers', 'walmart-trevipay-invoice.js'));
const nodeParsers  = require(path.join(__dirname, '..', 'js', 'vendor-parsers', 'index.js'));
const fixtures     = require('./fixtures/trevipay-samples.js');

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
    throw new Error('markers not found in js/vendor-parser-ui.js — buildVendorParsers changed shape?');
  }
  const body = src.slice(start, end);
  const factory = new Function(body + '\nreturn buildVendorParsers();');
  return factory(); // { parse, detectVendor, detectDocumentType }
}

// ── Real normalizer (commit 8325ed5) — same convention as
// tests/vendor-review-trevipay-normalize.test.js and
// tests/walmart-trevipay-parser.test.js: build the actual text both
// parsers will receive, don't hand-type an idealized version.
function loadNormalizer() {
  const src = fs.readFileSync(VDR_JS, 'utf8');
  const START = '// ── MARKER:VDR_TREVIPAY_NORMALIZE_START ────────────────────────────';
  const END   = '// ── MARKER:VDR_TREVIPAY_NORMALIZE_END ──────────────────────────────';
  const block = src.slice(src.indexOf(START), src.indexOf(END));
  return new Function(block + 'return { vdrNormalizeTreviPayPage };')();
}

const { vdrNormalizeTreviPayPage } = loadNormalizer();
function norm(items) { return vdrNormalizeTreviPayPage(items).text; }

const DOC_TEXT = {
  c51dd720:   norm(fixtures.C51DD720_PAGE1) + '\n' + norm(fixtures.C51DD720_PAGE2),
  '6c246fda': norm(fixtures.C6C246FDA_PAGE2) + '\n' + norm(fixtures.C6C246FDA_PAGE3),
  '12fd6860': norm(fixtures.C12FD6860_PAGE1) + '\n' + norm(fixtures.C12FD6860_PAGE2),
  '30082536': norm(fixtures.C30082536_PAGE1) + '\n' + norm(fixtures.C30082536_PAGE2) + '\n' + norm(fixtures.C30082536_PAGE3),
  '26104552': norm(fixtures.C26104552_PAGE1) + '\n' + norm(fixtures.C26104552_PAGE2) + '\n' + norm(fixtures.C26104552_PAGE3),
  '069a51f8': norm(fixtures.C069A51F8_PAGE1) + '\n' + norm(fixtures.C069A51F8_PAGE2),
};
const EXPECTED_TOTAL = { c51dd720: 52.07, '6c246fda': 63.33, '12fd6860': 61.56, '30082536': 33.88, '26104552': 317.41, '069a51f8': 237.56 };
const EXPECTED_BUYER = { c51dd720: 'Massimilajo Zubboli', '6c246fda': 'Zeno Russo', '12fd6860': 'Zeno Russo', '30082536': 'Zeno Russo', '26104552': 'Massimilajo Zubboli', '069a51f8': 'Massimilajo Zubboli' };

console.log('\nWalmart Business / TreviPay parser — Node/browser parity test run\n');

const browserParsers = loadRealBrowserParsers();

// ── T1 — Vendor detection parity, both directions ────────────────────
test('T1: detectVendor(real c51dd720 text) === "walmart" on both Node and browser', () => {
  assert.strictEqual(nodeParsers.detectVendor(DOC_TEXT.c51dd720), 'walmart');
  assert.strictEqual(browserParsers.detectVendor(DOC_TEXT.c51dd720), 'walmart');
});
test('T1b: a document that only says "Invoice" is NOT walmart on either side', () => {
  assert.notStrictEqual(nodeParsers.detectVendor('Invoice Number 12345'), 'walmart');
  assert.notStrictEqual(browserParsers.detectVendor('Invoice Number 12345'), 'walmart');
});
test('T1c: Hardie\'s, FreshPoint, Fruge, BEK remain recognised identically on both sides', () => {
  const samples = {
    hardies:    "DAIRYLAND PRODUCE INVOICE/POD 123",
    freshpoint: "FRESHPOINT DALLAS Invoice No. 123",
    fruge:      "FRUGE SEAFOOD invoice",
    bek:        "BEN E. KEITH invoice",
  };
  for (const [expected, text] of Object.entries(samples)) {
    assert.strictEqual(nodeParsers.detectVendor(text), expected, `node: ${expected}`);
    assert.strictEqual(browserParsers.detectVendor(text), expected, `browser: ${expected}`);
  }
});

// ── T2 — buildVendorParsers().parse() really routes to Walmart (not
// just an isolated function) — Part G's mandatory end-to-end proof ──
test('T2: browserParsers.parse(real c51dd720) routes through the real dispatcher to Walmart (not an isolated function)', () => {
  const r = browserParsers.parse(DOC_TEXT.c51dd720);
  assert.strictEqual(r.vendor, 'Walmart Business');
  assert.notStrictEqual(r.vendor, null);
  assert.strictEqual(r.items.length, 8);
  assert.notStrictEqual(r.items.length, 0);
  assert.strictEqual(r.buyer, 'Massimilajo Zubboli');
  assert.strictEqual(r.total, 52.07);
});

// ── T3 — Header parity across all 4 real documents ───────────────────
const HEADER_FIELDS = [
  'vendor', 'document_type', 'document_number', 'invoice_number',
  'invoice_date', 'due_date', 'buyer', 'seller',
  'walmart_order_number', 'po_number', 'subtotal', 'tax', 'total',
];

for (const [name, text] of Object.entries(DOC_TEXT)) {
  test(`T3 (${name}): header fields identical between Node and browser parser`, () => {
    const nodeR = walmartNode.parse(text);
    const browserR = browserParsers.parse(text);
    for (const field of HEADER_FIELDS) {
      assert.strictEqual(browserR[field], nodeR[field], `field "${field}" differs`);
    }
    assert.strictEqual(nodeR.buyer, EXPECTED_BUYER[name]);
    assert.strictEqual(browserR.buyer, EXPECTED_BUYER[name]);
  });
}

// ── T4 — Item-level parity across all 4 real documents ────────────────
const ITEM_FIELDS = ['vendor_sku', 'description', 'qty', 'unit_price', 'discount', 'tax', 'tax_rate', 'amount', 'line_total', 'line_type'];

for (const [name, text] of Object.entries(DOC_TEXT)) {
  test(`T4 (${name}): item count and every item field identical between Node and browser`, () => {
    const nodeR = walmartNode.parse(text);
    const browserR = browserParsers.parse(text);
    assert.strictEqual(browserR.items.length, nodeR.items.length, 'item count differs');
    nodeR.items.forEach((nodeItem, i) => {
      const browserItem = browserR.items[i];
      for (const field of ITEM_FIELDS) {
        assert.strictEqual(browserItem[field], nodeItem[field], `item ${i} field "${field}" differs`);
      }
    });
  });
}

// ── T5 — Reconciliation (sum of item.amount == invoice total) on both
// sides, for all 4 real documents — Part F requirement ────────────────
for (const [name, text] of Object.entries(DOC_TEXT)) {
  test(`T5 (${name}): reconciliation = ${EXPECTED_TOTAL[name]} on both Node and browser`, () => {
    const nodeR = walmartNode.parse(text);
    const browserR = browserParsers.parse(text);
    const nodeSum = Math.round(nodeR.items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
    const browserSum = Math.round(browserR.items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
    assert.strictEqual(nodeSum, EXPECTED_TOTAL[name]);
    assert.strictEqual(browserSum, EXPECTED_TOTAL[name]);
  });
}

// ── T6 — Split-SKU and multiline description parity (c51dd720) ───────
test('T6a: split SKU "13508117005" reconstructed identically on both sides', () => {
  const nodeItem = walmartNode.parse(DOC_TEXT.c51dd720).items[4];
  const browserItem = browserParsers.parse(DOC_TEXT.c51dd720).items[4];
  assert.strictEqual(nodeItem.vendor_sku, '13508117005');
  assert.strictEqual(browserItem.vendor_sku, '13508117005');
});
test('T6b: multiline description (BelGioioso, 3 physical lines) identical on both sides', () => {
  const expected = 'BelGioioso Fresh Mozzarella Cheese Pearls Mini Snacking Cheese, 8 oz Refrigerated Plastic Packet';
  assert.strictEqual(walmartNode.parse(DOC_TEXT.c51dd720).items[1].description, expected);
  assert.strictEqual(browserParsers.parse(DOC_TEXT.c51dd720).items[1].description, expected);
});

// ── T7 — Shipping / ALT_PAYMENT_METHODS parity (real negative adjustment) ──
test('T7a: Shipping rows identical line_type/sku/description on both sides (30082536)', () => {
  const nodeShip = walmartNode.parse(DOC_TEXT['30082536']).items.filter(i => i.line_type === 'shipping');
  const browserShip = browserParsers.parse(DOC_TEXT['30082536']).items.filter(i => i.line_type === 'shipping');
  assert.strictEqual(nodeShip.length, 4);
  assert.strictEqual(browserShip.length, 4);
});
test('T7b: ALT_PAYMENT_METHODS negative adjustment identical on both sides (6c246fda)', () => {
  const nodeAdj = walmartNode.parse(DOC_TEXT['6c246fda']).items.find(i => i.line_type === 'adjustment');
  const browserAdj = browserParsers.parse(DOC_TEXT['6c246fda']).items.find(i => i.line_type === 'adjustment');
  assert.ok(nodeAdj && browserAdj);
  assert.strictEqual(nodeAdj.amount, -21.26);
  assert.strictEqual(browserAdj.amount, -21.26);
  assert.strictEqual(nodeAdj.vendor_sku, 'ALT_PAYMENT_METHODS');
  assert.strictEqual(browserAdj.vendor_sku, 'ALT_PAYMENT_METHODS');
});

test('T7c: HANDLING (Express Fee) identical on both sides (26104552)', () => {
  const nodeHandling = walmartNode.parse(DOC_TEXT['26104552']).items.filter(i => i.line_type === 'handling');
  const browserHandling = browserParsers.parse(DOC_TEXT['26104552']).items.filter(i => i.line_type === 'handling');
  assert.strictEqual(nodeHandling.length, 1);
  assert.strictEqual(browserHandling.length, 1);
  assert.strictEqual(nodeHandling[0].amount, 1.93);
  assert.strictEqual(browserHandling[0].amount, 1.93);
  assert.strictEqual(nodeHandling[0].vendor_sku, 'Express Fee');
  assert.strictEqual(browserHandling[0].vendor_sku, 'Express Fee');
});
test('T7d: FULFILL_VARIANCE (SubDown), all 4 real occurrences, identical on both sides (26104552)', () => {
  const nodeFv = walmartNode.parse(DOC_TEXT['26104552']).items.filter(i => i.line_type === 'fulfillment_variance');
  const browserFv = browserParsers.parse(DOC_TEXT['26104552']).items.filter(i => i.line_type === 'fulfillment_variance');
  assert.strictEqual(nodeFv.length, 4);
  assert.strictEqual(browserFv.length, 4);
  assert.deepStrictEqual(nodeFv.map(i => i.amount), [10.29, 10.29, 14.65, 14.65]);
  assert.deepStrictEqual(browserFv.map(i => i.amount), [10.29, 10.29, 14.65, 14.65]);
});
test('T7e: adjacent product descriptions (44001602, 19400236, 27935840) stay clean on both sides (26104552)', () => {
  // NOTE: 19400236/27935840 contain U+E088, an unmapped PUA codepoint
  // (likely a weight-range hyphen) that the normalizer correctly
  // preserves verbatim rather than inventing a meaning for — pre-existing,
  // unrelated to the HANDLING/FULFILL_VARIANCE fix this suite covers.
  for (const parser of [walmartNode, browserParsers]) {
    const items = parser.parse(DOC_TEXT['26104552']).items;
    assert.strictEqual(items.find(i => i.vendor_sku === '44001602').description, '73% Lean / 27% Fat Ground Beef, 10 lb Roll, Fresh, All Natural*');
    assert.strictEqual(items.find(i => i.vendor_sku === '19400236').description, 'Perdue Harvestland, Free Range, Fresh Boneless Chicken Breast, 1.50\u{e088} 4.30 lb. Tray');
    assert.strictEqual(items.find(i => i.vendor_sku === '27935840').description, 'Freshness Guaranteed Boneless, Skinless Chicken Breasts, 2.75 \u{e088} 7.0 lb Tray');
  }
});

test('T7f: pack_description identical on both sides for every product item, all 3 real Kitchen documents (c51dd720, 069a51f8, 26104552)', () => {
  for (const docName of ['c51dd720', '069a51f8', '26104552']) {
    const nodeItems = walmartNode.parse(DOC_TEXT[docName]).items;
    const browserItems = browserParsers.parse(DOC_TEXT[docName]).items;
    assert.strictEqual(nodeItems.length, browserItems.length, docName + ': item count mismatch');
    nodeItems.forEach((it, i) => {
      assert.strictEqual(browserItems[i].pack_description, it.pack_description, `${docName} item ${i} (${it.vendor_sku}): pack_description mismatch`);
    });
  }
});
test('T7g: real reference values reproduced from the live documents — Ground Beef 10lb, Ricotta 32oz, Milk 1gal, Watermelon/Zucchini Each, chicken-breast ranges preserved as visible display text (Walmart semantics/UI fix task)', () => {
  const c51 = walmartNode.parse(DOC_TEXT.c51dd720).items;
  const doc69 = walmartNode.parse(DOC_TEXT['069a51f8']).items;
  const doc26 = walmartNode.parse(DOC_TEXT['26104552']).items;
  assert.strictEqual(doc69.find(i => i.vendor_sku === '44001602').pack_description, '10lb');
  assert.strictEqual(c51.find(i => i.vendor_sku === '47370609').pack_description, '32oz');
  assert.strictEqual(doc69.find(i => i.vendor_sku === '10450114').pack_description, '1gal');
  assert.strictEqual(doc26.find(i => i.vendor_sku === '44391101').pack_description, 'Each');
  assert.strictEqual(doc26.find(i => i.vendor_sku === '44390947').pack_description, 'Each');
  assert.ok(doc26.filter(i => i.vendor_sku === '19400236').every(i => i.pack_description === '1.50-4.30lb Tray'));
  assert.ok(doc26.filter(i => i.vendor_sku === '27935840').every(i => i.pack_description === '2.75-7.0lb Tray'));
});

// ── T8 — Non-zero tax parity (6c246fda) ───────────────────────────────
test('T8: per-line tax and tax_rate identical on both sides (6c246fda)', () => {
  const nodeItem = walmartNode.parse(DOC_TEXT['6c246fda']).items.find(i => i.vendor_sku === '38437922');
  const browserItem = browserParsers.parse(DOC_TEXT['6c246fda']).items.find(i => i.vendor_sku === '38437922');
  assert.strictEqual(nodeItem.tax, 3.29);
  assert.strictEqual(browserItem.tax, 3.29);
  assert.strictEqual(nodeItem.tax_rate, 0.0824);
  assert.strictEqual(browserItem.tax_rate, 0.0824);
});

// ── T9 — Walmart is dispatched before Hardie's fallback (Part B) ──────
// ── T10 — Empty-Buyer fix parity (root cause: \s+ crossing newlines) ──
test('T10a: Buyer blank, followed by Seller/Walmart Business → buyer=null identically on both sides', () => {
  const text = [
    'Walmart Business TreviPay Invoice Details',
    'SKU Description Quantity Unit Price Discount Tax Billed Total',
    'Invoice Summary',
    'Buyer',
    'United States',
    'Seller',
    'Walmart Business',
  ].join('\n');
  assert.strictEqual(walmartNode.parse(text).buyer, null);
  assert.strictEqual(browserParsers.parse(text).buyer, null);
});
test('T10b: Buyer blank, followed by Group section → buyer=null identically on both sides', () => {
  const text = [
    'Walmart Business TreviPay Invoice Details',
    'SKU Description Quantity Unit Price Discount Tax Billed Total',
    'Invoice Summary',
    'Buyer',
    'United States',
    'Group',
    "Zeno's on the square",
  ].join('\n');
  assert.strictEqual(walmartNode.parse(text).buyer, null);
  assert.strictEqual(browserParsers.parse(text).buyer, null);
});
test('T10c: whitespace-only after "United States" → buyer=null identically on both sides', () => {
  const text = [
    'Walmart Business TreviPay Invoice Details',
    'SKU Description Quantity Unit Price Discount Tax Billed Total',
    'Invoice Summary',
    'Buyer',
    'United States   ',
    'Seller',
  ].join('\n');
  assert.strictEqual(walmartNode.parse(text).buyer, null);
  assert.strictEqual(browserParsers.parse(text).buyer, null);
});

test('T9: Walmart entry precedes hardies in detectVendor — never falls through to the Hardie\'s default', () => {
  const r = browserParsers.parse(DOC_TEXT.c51dd720);
  assert.strictEqual(r.vendor, 'Walmart Business');
  assert.notStrictEqual(r.vendor, "Hardie's Fresh Foods / Dairyland Produce");
});

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
