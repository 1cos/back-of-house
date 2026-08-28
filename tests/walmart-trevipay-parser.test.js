// ══════════════════════════════════════════════════════════════════
// js/vendor-parsers/walmart-trevipay-invoice.js — regression tests
// Plain Node, zero external deps: `node tests/walmart-trevipay-parser.test.js`
//
// This parser's INPUT contract is text already normalized by the
// TreviPay preprocessing committed in 8325ed5 (vdrNormalizeTreviPayPage
// in vendor-documents-review.js) — so these tests build that same real
// normalized text from real PDF.js textContent.items fixtures
// (tests/fixtures/trevipay-samples.js), exactly like production does,
// rather than hand-typing "clean" strings the parser will never
// actually see.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const fixtures = require('./fixtures/trevipay-samples.js');

const VDR_SRC_PATH = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');
const vdrSrc = fs.readFileSync(VDR_SRC_PATH, 'utf8');
const NORM_START = '// ── MARKER:VDR_TREVIPAY_NORMALIZE_START ────────────────────────────';
const NORM_END   = '// ── MARKER:VDR_TREVIPAY_NORMALIZE_END ──────────────────────────────';
const normBlock = vdrSrc.slice(vdrSrc.indexOf(NORM_START), vdrSrc.indexOf(NORM_END));
const { vdrNormalizeTreviPayPage } = new Function(normBlock + 'return { vdrNormalizeTreviPayPage };')();

function norm(items) { return vdrNormalizeTreviPayPage(items).text; }

const parsers = require('../js/vendor-parsers/index.js');
const walmartParser = require('../js/vendor-parsers/walmart-trevipay-invoice.js');

// ── Real, full documents built exactly like production would ──────────
const DOC_TEXT = {
  c51dd720:   norm(fixtures.C51DD720_PAGE1) + '\n' + norm(fixtures.C51DD720_PAGE2),
  '6c246fda': norm(fixtures.C6C246FDA_PAGE2) + '\n' + norm(fixtures.C6C246FDA_PAGE3),
  '12fd6860': norm(fixtures.C12FD6860_PAGE1) + '\n' + norm(fixtures.C12FD6860_PAGE2),
  '30082536': norm(fixtures.C30082536_PAGE1) + '\n' + norm(fixtures.C30082536_PAGE2) + '\n' + norm(fixtures.C30082536_PAGE3),
};

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); }
}

console.log('\nWalmart Business / TreviPay invoice parser — regression tests\n');

// ── 1. Detection ────────────────────────────────────────────────────
test('1. detects Walmart/TreviPay via parsers.detectVendor on real text', () => {
  assert.strictEqual(parsers.detectVendor(DOC_TEXT.c51dd720), 'walmart');
});
test('1b. buildVendorParsers routes to the real walmart parser (parsers.parse), not just an isolated function', () => {
  const result = parsers.parse(DOC_TEXT.c51dd720);
  assert.strictEqual(result.vendor, 'Walmart Business');
  assert.strictEqual(result.document_type, 'invoice');
});

// ── 2. Rejection of non-Walmart documents (non-regression) ──────────
test('2. non-Walmart document still detected correctly (Hardie\'s unaffected)', () => {
  const hardiesText = "HARDIE'S FRESH FOODS / DAIRYLAND PRODUCE\nINVOICE/POD 06991299\nCustomer: ZENOS ON THE SQUARE";
  assert.strictEqual(parsers.detectVendor(hardiesText), 'hardies');
});
test('2b. Walmart vendor never fires on a document that only says the generic word "Invoice"', () => {
  assert.notStrictEqual(parsers.detectVendor('Invoice Number 12345 Total Due $10.00'), 'walmart');
});
test('2c. Walmart vendor requires the combined signal, not "Walmart Business" alone', () => {
  assert.notStrictEqual(parsers.detectVendor('Walmart Business weekly ad flyer'), 'walmart');
});

// ── 3. document_number ────────────────────────────────────────────────
test('3. document_number = c51dd720', () => {
  assert.strictEqual(walmartParser.parse(DOC_TEXT.c51dd720).document_number, 'c51dd720');
});

// ── 4. invoice_date ────────────────────────────────────────────────────
test('4. invoice_date = 2026-08-26', () => {
  assert.strictEqual(walmartParser.parse(DOC_TEXT.c51dd720).invoice_date, '2026-08-26');
});

// ── 5. due_date ────────────────────────────────────────────────────────
test('5. due_date = 2026-09-24', () => {
  assert.strictEqual(walmartParser.parse(DOC_TEXT.c51dd720).due_date, '2026-09-24');
});

// ── 6/7. Buyer extraction, both real people ─────────────────────────
test('6. buyer = Massimilajo Zubboli (Kitchen, c51dd720)', () => {
  assert.strictEqual(walmartParser.parse(DOC_TEXT.c51dd720).buyer, 'Massimilajo Zubboli');
});
test('7. buyer = Zeno Russo (Bar, 6c246fda) — extracted faithfully, no routing decision made', () => {
  const p = walmartParser.parse(DOC_TEXT['6c246fda']);
  assert.strictEqual(p.buyer, 'Zeno Russo');
  // Explicit non-goal for this task: no KITCHEN_ACCEPT/BAR_IGNORE, no
  // status field of any kind is produced by this parser at all.
  assert.strictEqual('status' in p, false);
});
test('7b. buyer extracted for all 4 real documents', () => {
  assert.strictEqual(walmartParser.parse(DOC_TEXT.c51dd720).buyer, 'Massimilajo Zubboli');
  assert.strictEqual(walmartParser.parse(DOC_TEXT['6c246fda']).buyer, 'Zeno Russo');
  assert.strictEqual(walmartParser.parse(DOC_TEXT['12fd6860']).buyer, 'Zeno Russo');
  assert.strictEqual(walmartParser.parse(DOC_TEXT['30082536']).buyer, 'Zeno Russo');
});

// ── 7c-7g. Empty-Buyer fix (regex must never cross into the next line) ──
// Root cause: extractBuyer's original regex used \s+ between "United
// States" and the value, and \s matches newlines too — so a genuinely
// blank Buyer field (nothing after "United States" on its own line) let
// the match walk forward across the line break and grab whatever
// non-blank text came next, instead of failing to match. Fixed to
// [ \t]+ (horizontal whitespace only). These fixtures reproduce the
// exact real document shape (Buyer label, then the Bill-To's "United
// States" line, then Seller/Group), not hand-picked to fit the fix.
test('7c. Buyer label present but value row genuinely blank, followed by Seller/Walmart Business → buyer stays null', () => {
  const text = [
    'SKU Description Quantity Unit Price Discount Tax Billed Total',
    'Invoice Summary',
    'Buyer',
    'United States',
    'Seller',
    'Walmart Business',
  ].join('\n');
  assert.strictEqual(walmartParser.parse(text).buyer, null);
});
test('7d. Buyer label present but value row blank, followed by Group section → buyer stays null (never infers Group)', () => {
  const text = [
    'SKU Description Quantity Unit Price Discount Tax Billed Total',
    'Invoice Summary',
    'Buyer',
    'United States',
    'Group',
    "Zeno's on the square",
  ].join('\n');
  assert.strictEqual(walmartParser.parse(text).buyer, null);
});
test('7e. whitespace-only content after "United States" → buyer stays null', () => {
  const text = [
    'SKU Description Quantity Unit Price Discount Tax Billed Total',
    'Invoice Summary',
    'Buyer',
    'United States   ',
    'Seller',
  ].join('\n');
  assert.strictEqual(walmartParser.parse(text).buyer, null);
});
test('7f. buyer never falls back to "Seller", "Walmart Business", or "Group" literal strings', () => {
  const text = [
    'SKU Description Quantity Unit Price Discount Tax Billed Total',
    'Invoice Summary',
    'Buyer',
    'United States',
    'Seller',
    'Walmart Business',
  ].join('\n');
  const buyer = walmartParser.parse(text).buyer;
  assert.notStrictEqual(buyer, 'Seller');
  assert.notStrictEqual(buyer, 'Walmart Business');
  assert.notStrictEqual(buyer, 'Group');
});

// ── 8. Walmart Order Number ────────────────────────────────────────────
test('8. walmart_order_number = 200015079217150', () => {
  assert.strictEqual(walmartParser.parse(DOC_TEXT.c51dd720).walmart_order_number, '200015079217150');
});
test('8b. po_number = null when the printed value is "-"', () => {
  assert.strictEqual(walmartParser.parse(DOC_TEXT.c51dd720).po_number, null);
});

// ── 9. subtotal/tax/total ──────────────────────────────────────────────
test('9. subtotal/tax/total = 52.07/0/52.07 (c51dd720)', () => {
  const p = walmartParser.parse(DOC_TEXT.c51dd720);
  assert.strictEqual(p.subtotal, 52.07);
  assert.strictEqual(p.tax, 0);
  assert.strictEqual(p.total, 52.07);
});

// ── 10. 8 lines c51dd720 (full acceptance) ────────────────────────────
test('10. c51dd720: exactly 8 product lines, matching the full acceptance list', () => {
  const p = walmartParser.parse(DOC_TEXT.c51dd720);
  assert.strictEqual(p.items.length, 8);
  const expected = [
    ['110366636',   2, 3.97, 7.94],
    ['14255252',    2, 4.94, 9.88],
    ['47370609',    2, 5.24, 10.48],
    ['44391605',    3, 2.19, 6.57],
    ['13508117005', 1, 2.62, 2.62],
    ['979818213',   1, 4.97, 4.97],
    ['141418923',   1, 3.67, 3.67],
    ['1918496773',  2, 2.97, 5.94],
  ];
  expected.forEach(([sku, qty, up, amt], i) => {
    assert.strictEqual(p.items[i].vendor_sku, sku, `line ${i+1} sku`);
    assert.strictEqual(p.items[i].qty, qty, `line ${i+1} qty`);
    assert.strictEqual(p.items[i].unit_price, up, `line ${i+1} unit_price`);
    assert.strictEqual(p.items[i].amount, amt, `line ${i+1} amount`);
    assert.strictEqual(p.items[i].line_total, amt, `line ${i+1} line_total alias`);
    assert.strictEqual(p.items[i].line_type, 'product');
  });
});

// ── 11. Multiline description reconstruction ──────────────────────────
test('11a. multiline description: Roth Chèvre (2 physical lines)', () => {
  const item = walmartParser.parse(DOC_TEXT.c51dd720).items[0];
  assert.strictEqual(item.description, 'Roth Chèvre Plain Crumbled Fresh Goat Cheese 4oz');
});
test('11b. multiline description: BelGioioso (3 physical lines)', () => {
  const item = walmartParser.parse(DOC_TEXT.c51dd720).items[1];
  assert.strictEqual(
    item.description,
    'BelGioioso Fresh Mozzarella Cheese Pearls Mini Snacking Cheese, 8 oz Refrigerated Plastic Packet'
  );
});
test('11c. multiline description: Grape Tomatoes (3 physical lines)', () => {
  const item = walmartParser.parse(DOC_TEXT.c51dd720).items[7];
  assert.strictEqual(item.description, 'NatureSweet Cherubs Heavenly Grape Tomatoes, 10oz Package, Fresh');
});
test('11d. no word is split mid-word and no word is dropped across the reconstruction', () => {
  const item = walmartParser.parse(DOC_TEXT.c51dd720).items[0];
  assert.ok(!/\b\w \w\b/.test(item.description.replace(/Chèvre/, 'X')), 'no single-letter fragments left over');
});

// ── 12/13. Split SKU: positive and negative guards ────────────────────
test('12. split SKU positive: "1350811700" + "5" → "13508117005" (real geometry)', () => {
  const item = walmartParser.parse(DOC_TEXT.c51dd720).items[4];
  assert.strictEqual(item.vendor_sku, '13508117005');
  assert.strictEqual(item.description, 'Fresh Kiwi, 1lb Package');
});
test('13a. negative guard: a bare Quantity-like digit never merges onto an UNRELATED prior row', () => {
  // Construct a minimal table where a short digit line follows a row
  // whose SKU is NOT purely numeric (Shipping) — must never be treated
  // as a SKU-fragment continuation.
  const text = [
    'SKU Description Quantity Unit Price Discount Tax Billed Total',
    'Shipping SHIPPING 1 $0.99 $0.00 $0.00 $0.99',
    '5',
    '110366636 Roth Chèvre Plain Crumbled Fresh 2 $3.97 $0.00 $0.00 $7.94',
    'Invoice X Invoice Summary',
  ].join('\n');
  const p = walmartParser.parse(text);
  // "5" must not have been silently absorbed into "Shipping"'s SKU
  assert.strictEqual(p.items[0].vendor_sku, 'Shipping');
  assert.notStrictEqual(p.items[0].vendor_sku, 'Shipping5');
});
test('13b. negative guard: a 5+ digit row-starter is never treated as a fragment of the previous row', () => {
  const text = [
    'SKU Description Quantity Unit Price Discount Tax Billed Total',
    '110366636 Roth Chèvre Plain Crumbled Fresh 2 $3.97 $0.00 $0.00 $7.94',
    '14255252 BelGioioso Fresh Mozzarella Cheese 2 $4.94 $0.00 $0.00 $9.88',
    'Invoice X Invoice Summary',
  ].join('\n');
  const p = walmartParser.parse(text);
  assert.strictEqual(p.items.length, 2);
  assert.strictEqual(p.items[0].vendor_sku, '110366636');
  assert.strictEqual(p.items[1].vendor_sku, '14255252');
});
test('13c. negative guard: a fragment is never merged if it would blow the sane total-length ceiling', () => {
  const text = [
    'SKU Description Quantity Unit Price Discount Tax Billed Total',
    '123456789012 Some Product 1 $1.00 $0.00 $0.00 $1.00',
    '999',
    'Invoice X Invoice Summary',
  ].join('\n');
  const p = walmartParser.parse(text);
  // 12 digits + 3 digits = 15 > 14 ceiling → must NOT merge
  assert.strictEqual(p.items[0].vendor_sku, '123456789012');
});
test('13d. negative guard: Quantity value embedded in a real row is never mistaken for a fragment line', () => {
  // Quantity "2" always co-occurs with $ amounts on the same physical
  // line in real data; a bare "2" alone would only ever occur as a
  // genuine SKU-wrap fragment.
  const p = walmartParser.parse(DOC_TEXT.c51dd720);
  assert.strictEqual(p.items[0].qty, 2);
  assert.strictEqual(p.items[0].vendor_sku, '110366636'); // untouched by its own qty=2
});

// ── 14. Shipping ───────────────────────────────────────────────────────
test('14. Shipping rows parsed as line_type=shipping, never as a product', () => {
  const p = walmartParser.parse(DOC_TEXT['30082536']);
  const shipping = p.items.filter(i => i.line_type === 'shipping');
  assert.strictEqual(shipping.length, 4);
  shipping.forEach(s => {
    assert.strictEqual(s.vendor_sku, 'Shipping');
    assert.strictEqual(s.description, 'SHIPPING');
  });
  assert.strictEqual(shipping.reduce((s, i) => s + i.amount, 0).toFixed(2), (0.99 + 1.39 + 1.25 + 0.45).toFixed(2));
});

// ── 15. Negative ALT_PAYMENT_METHODS adjustment ───────────────────────
test('15. ALT_PAYMENT_METHODS adjustment: negative amount preserved, never a product', () => {
  const p = walmartParser.parse(DOC_TEXT['6c246fda']);
  const adj = p.items.find(i => i.line_type === 'adjustment');
  assert.ok(adj, 'adjustment row must be present');
  assert.strictEqual(adj.vendor_sku, 'ALT_PAYMENT_METHODS');
  assert.strictEqual(adj.description, 'Alternative Payment Methods');
  assert.strictEqual(adj.amount, -21.26);
  assert.strictEqual(adj.unit_price, -21.26);
  // Its wrapped SKU-column fragments ("NT_METHO", "DS") must never leak
  // into the description.
  assert.ok(!adj.description.includes('METHO'));
  assert.ok(!adj.description.includes('DS'));
});

// ── 16. Tax non-zero ───────────────────────────────────────────────────
test('16a. 6c246fda: header tax/subtotal/total reflect real non-zero tax', () => {
  const p = walmartParser.parse(DOC_TEXT['6c246fda']);
  assert.strictEqual(p.subtotal, 58.35);
  assert.strictEqual(p.tax, 4.98);
  assert.strictEqual(p.total, 63.33);
});
test('16b. 6c246fda: per-line tax and tax_rate preserved where present', () => {
  const p = walmartParser.parse(DOC_TEXT['6c246fda']);
  const bona = p.items.find(i => i.vendor_sku === '38437922');
  assert.strictEqual(bona.tax, 3.29);
  assert.strictEqual(bona.tax_rate, 0.0824);
  const untaxed = p.items.find(i => i.vendor_sku === '15754127');
  assert.strictEqual(untaxed.tax, 0);
  assert.strictEqual(untaxed.tax_rate, null);
});
test("16c. tax-rate extraction never confuses the Busch item's own '0.5% ABV' description text with a tax rate", () => {
  const p = walmartParser.parse(DOC_TEXT['6c246fda']);
  const busch = p.items.find(i => i.vendor_sku === '15718162');
  assert.strictEqual(busch.tax_rate, 0.0823);
  assert.ok(busch.description.includes('0.5%'), 'the real ABV percentage must remain part of the description');
});

// ── HANDLING / FULFILL_VARIANCE (real invoice 26104552) ────────────────
// Root cause: "Express Fee HANDLING" and "SubDown FULFILL_VARIANCE" have a
// multi-word SKU-column placeholder ("Express Fee", "SubDown"), unlike
// "Shipping"/"ALT_PAYME" which are single tokens — before this fix, neither
// shape was recognised as a row-start at all, so both fell through to
// continuation handling and were silently absorbed into the PRECEDING
// product row's description, losing their amount as a structured line
// item and corrupting that product's description. These fixtures use the
// exact real row text from 26104552, not idealized text.
test('HANDLING: "Express Fee HANDLING" becomes its own line_type=handling row, not absorbed into the prior row', () => {
  const text = [
    'SKU Description Quantity Unit Price Discount Tax Billed Total',
    '44001602 73% Lean / 27% Fat Ground Beef, 10 lb Roll, Fresh, All Natural* 3 $39.94 $0.00 $0.00 $119.82',
    'Express Fee HANDLING 1 $1.93 $0.00 $0.00 $1.93',
    '19400236 Perdue Harvestland, Free Range, Fresh Boneless Chicken Breast, 1.50 4.30 lb. Tray 1 $11.72 $0.00 $0.00 $11.72',
    'Invoice 26104552 Invoice Summary',
  ].join('\n');
  const p = walmartParser.parse(text);
  assert.strictEqual(p.items.length, 3);
  assert.strictEqual(p.items[0].description, '73% Lean / 27% Fat Ground Beef, 10 lb Roll, Fresh, All Natural*', 'the preceding product description must stay clean');
  assert.strictEqual(p.items[1].line_type, 'handling');
  assert.strictEqual(p.items[1].vendor_sku, 'Express Fee');
  assert.strictEqual(p.items[1].description, 'HANDLING');
  assert.strictEqual(p.items[1].amount, 1.93);
  assert.strictEqual(p.items[2].vendor_sku, '19400236', 'the row after HANDLING must still be recognised as its own product row');
});
test('FULFILL_VARIANCE: "SubDown FULFILL_VARIANCE" becomes its own line_type=fulfillment_variance row, repeated occurrences both preserved', () => {
  const text = [
    'SKU Description Quantity Unit Price Discount Tax Billed Total',
    '19400236 Perdue Harvestland, Free Range, Fresh Boneless Chicken Breast, 1.50 4.30 lb. Tray 1 $11.72 $0.00 $0.00 $11.72',
    'SubDown FULFILL_VARIANCE 1 $10.29 $0.00 $0.00 $10.29',
    'SubDown FULFILL_VARIANCE 1 $14.65 $0.00 $0.00 $14.65',
    '19400236 Perdue Harvestland, Free Range, Fresh Boneless Chicken Breast, 1.50 4.30 lb. Tray 1 $13.10 $0.00 $0.00 $13.10',
    'Invoice 26104552 Invoice Summary',
  ].join('\n');
  const p = walmartParser.parse(text);
  assert.strictEqual(p.items.length, 4);
  assert.strictEqual(p.items[0].description, 'Perdue Harvestland, Free Range, Fresh Boneless Chicken Breast, 1.50 4.30 lb. Tray', 'the first 19400236 description must stay clean');
  assert.strictEqual(p.items[1].line_type, 'fulfillment_variance');
  assert.strictEqual(p.items[1].amount, 10.29);
  assert.strictEqual(p.items[2].line_type, 'fulfillment_variance');
  assert.strictEqual(p.items[2].amount, 14.65, 'a second, differently-priced FULFILL_VARIANCE row must not be collapsed with the first');
  assert.strictEqual(p.items[3].vendor_sku, '19400236');
});
test('HANDLING/FULFILL_VARIANCE never classified as product, never given a numeric or Shipping/ALT_PAYME-style vendor_sku', () => {
  const text = [
    'SKU Description Quantity Unit Price Discount Tax Billed Total',
    'Express Fee HANDLING 1 $1.93 $0.00 $0.00 $1.93',
    'SubDown FULFILL_VARIANCE 1 $10.29 $0.00 $0.00 $10.29',
    'Invoice 26104552 Invoice Summary',
  ].join('\n');
  const p = walmartParser.parse(text);
  p.items.forEach(it => {
    assert.notStrictEqual(it.line_type, 'product');
    assert.notStrictEqual(it.line_type, 'shipping');
    assert.notStrictEqual(it.line_type, 'adjustment');
  });
});
test('regression: Shipping, ALT_PAYMENT_METHODS, numeric SKU, and split-SKU rows are unaffected by the HANDLING/FULFILL_VARIANCE fix', () => {
  const text = [
    'SKU Description Quantity Unit Price Discount Tax Billed Total',
    '110366636 Roth Chèvre Plain Crumbled Fresh 2 $3.97 $0.00 $0.00 $7.94',
    'Shipping SHIPPING 1 $0.99 $0.00 $0.00 $0.99',
    'ALT_PAYME Alternative Payment 1 -$21.26 $0.00 $0.00 -$21.26',
    '1350811700 Fresh Kiwi, 1lb Package 1 $2.62 $0.00 $0.00 $2.62',
    '5',
    'Invoice X Invoice Summary',
  ].join('\n');
  const p = walmartParser.parse(text);
  assert.strictEqual(p.items.length, 4);
  assert.strictEqual(p.items[0].line_type, 'product');
  assert.strictEqual(p.items[1].line_type, 'shipping');
  assert.strictEqual(p.items[2].line_type, 'adjustment');
  assert.strictEqual(p.items[2].amount, -21.26);
  assert.strictEqual(p.items[3].vendor_sku, '13508117005', 'split-SKU reconstruction must still work');
});

test('26104552 (real, full document): 24 structured lines, 1 handling + 4 fulfillment_variance + 1 adjustment, fully reconciled to 317.41', () => {
  const text = norm(fixtures.C26104552_PAGE1) + '\n' + norm(fixtures.C26104552_PAGE2) + '\n' + norm(fixtures.C26104552_PAGE3);
  const p = walmartParser.parse(text);
  assert.strictEqual(p.document_number, '26104552');
  assert.strictEqual(p.buyer, 'Massimilajo Zubboli');
  assert.strictEqual(p.total, 317.41);
  assert.strictEqual(p.items.length, 24);
  const handling = p.items.filter(i => i.line_type === 'handling');
  const fv = p.items.filter(i => i.line_type === 'fulfillment_variance');
  const adj = p.items.filter(i => i.line_type === 'adjustment');
  assert.strictEqual(handling.length, 1);
  assert.strictEqual(Math.round(handling.reduce((s, i) => s + i.amount, 0) * 100) / 100, 1.93);
  assert.strictEqual(fv.length, 4);
  assert.strictEqual(Math.round(fv.reduce((s, i) => s + i.amount, 0) * 100) / 100, 49.88);
  assert.strictEqual(adj.length, 1);
  assert.strictEqual(adj[0].amount, -49.88);
  const sum = Math.round(p.items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  assert.strictEqual(sum, 317.41);
  // Part G — repeated SKU regression, no collapse/dedup
  const sku19400236 = p.items.filter(i => i.vendor_sku === '19400236').map(i => i.amount);
  const sku27935840 = p.items.filter(i => i.vendor_sku === '27935840').map(i => i.amount);
  assert.deepStrictEqual(sku19400236, [11.72, 13.10, 12.87, 12.27, 13.79, 11.63, 14.19, 13.65]);
  assert.deepStrictEqual(sku27935840, [10.69, 12.41, 12.26, 11.54, 13.03, 12.49, 11.77]);
  // Part E — adjacent product descriptions stay clean
  assert.strictEqual(p.items.find(i => i.vendor_sku === '44001602').description, '73% Lean / 27% Fat Ground Beef, 10 lb Roll, Fresh, All Natural*');
  // NOTE: these two real descriptions contain U+E088, an unmapped PUA
  // codepoint (likely a weight-range hyphen, e.g. "1.50-4.30 lb") that
  // decodeTreviPayPUA correctly preserves verbatim rather than inventing
  // a meaning for it — by design (see commit 8325ed5). Pre-existing,
  // unrelated to the HANDLING/FULFILL_VARIANCE fix; not corrected here.
  assert.strictEqual(p.items.find(i => i.vendor_sku === '19400236').description, 'Perdue Harvestland, Free Range, Fresh Boneless Chicken Breast, 1.50\u{e088} 4.30 lb. Tray');
  assert.strictEqual(p.items.find(i => i.vendor_sku === '27935840').description, 'Freshness Guaranteed Boneless, Skinless Chicken Breasts, 2.75 \u{e088} 7.0 lb Tray');
});

// ── pack_description extraction (deterministic, conservative) ────────
// 13 determinable real cases (Part F/G): description untouched,
// pack_description exact, and grams/cost-per-100g match the production
// vdrPackToGrams constants (lb=453.592g, oz=28.3495g) computed here
// independently, not hardcoded from the task's reference values.
const LB_G = 453.592, OZ_G = 28.3495;
const PACK_CASES = [
  { sku: '110366636', desc: 'Roth Chèvre Plain Crumbled Fresh Goat Cheese 4oz', pack: '4oz', grams: 4 * OZ_G },
  { sku: '14255252',  desc: 'BelGioioso Fresh Mozzarella Cheese Pearls Mini Snacking Cheese, 8 oz Refrigerated Plastic Packet', pack: '8oz', grams: 8 * OZ_G },
  { sku: '47370609',  desc: 'Great Value Original Ricotta Cheese, 32 oz Tub', pack: '32oz', grams: 32 * OZ_G },
  { sku: '44391605',  desc: 'Fresh Strawberries, 1 lb Container', pack: '1lb', grams: 1 * LB_G },
  { sku: '13508117005', desc: 'Fresh Kiwi, 1lb Package', pack: '1lb', grams: 1 * LB_G },
  { sku: '979818213', desc: 'Fresh SunGold Kiwi, 1lb, Package', pack: '1lb', grams: 1 * LB_G },
  { sku: '141418923', desc: 'Peaches, 2lb Bag', pack: '2lb', grams: 2 * LB_G },
  { sku: '1918496773', desc: 'NatureSweet Cherubs Heavenly Grape Tomatoes, 10oz Package, Fresh', pack: '10oz', grams: 10 * OZ_G },
  { sku: '10308430', desc: 'Owens Regular Pork Sausage Roll, 32 oz', pack: '32oz', grams: 32 * OZ_G },
  { sku: '44001602', desc: '73% Lean / 27% Fat Ground Beef, 10 lb Roll, Fresh, All Natural*', pack: '10lb', grams: 10 * LB_G },
  { sku: '32247486', desc: 'BARILLA Gluten Free Penne Pasta, Gluten Free Pasta Made with 2 Ingredients, 12oz.', pack: '12oz', grams: 12 * OZ_G },
  { sku: '529759161', desc: 'Canyon Bakehouse Hawaiian Sweet Gluten Free Bread, Fresh 15oz Loaf', pack: '15oz', grams: 15 * OZ_G },
  { sku: '12443812', desc: 'Hillshire Farm Ultra Thin Honey Ham Lunchmeat, 16 oz Plastic Tub, Refrigerated', pack: '16oz', grams: 16 * OZ_G },
];

function buildProductLine(sku, desc, unitPrice) {
  return [
    'SKU Description Quantity Unit Price Discount Tax Billed Total',
    `${sku} ${desc} 1 $${unitPrice} $0.00 $0.00 $${unitPrice}`,
    'Invoice X Invoice Summary',
  ].join('\n');
}

for (const c of PACK_CASES) {
  test(`pack extraction: ${c.sku} -> "${c.pack}" (${c.grams.toFixed(2)}g), description untouched`, () => {
    const text = buildProductLine(c.sku, c.desc, '1.00');
    const item = walmartParser.parse(text).items[0];
    assert.strictEqual(item.description, c.desc, 'description must never be altered by pack extraction');
    assert.strictEqual(item.raw_description, c.desc);
    assert.strictEqual(item.pack_description, c.pack);
  });
}

test('pack extraction reference values (Part G): Ground Beef/Ricotta/Strawberries/Mozzarella/Penne/Bread/Ham cost-per-100g match', () => {
  const refs = [
    { sku: '44001602', desc: '73% Lean / 27% Fat Ground Beef, 10 lb Roll, Fresh, All Natural*', price: 39.94, expectedGrams: 4535.92, expectedP100: 0.8806 },
    { sku: '47370609', desc: 'Great Value Original Ricotta Cheese, 32 oz Tub', price: 5.24, expectedGrams: 907.18, expectedP100: 0.5776 },
    { sku: '44391605', desc: 'Fresh Strawberries, 1 lb Container', price: 2.19, expectedGrams: 453.592, expectedP100: 0.4828 },
    { sku: '14255252', desc: 'BelGioioso Fresh Mozzarella Cheese Pearls Mini Snacking Cheese, 8 oz Refrigerated Plastic Packet', price: 4.94, expectedGrams: 226.796, expectedP100: 2.1782 },
    { sku: '32247486', desc: 'BARILLA Gluten Free Penne Pasta, Gluten Free Pasta Made with 2 Ingredients, 12oz.', price: 2.62, expectedGrams: 340.194, expectedP100: 0.7702 },
    { sku: '529759161', desc: 'Canyon Bakehouse Hawaiian Sweet Gluten Free Bread, Fresh 15oz Loaf', price: 6.97, expectedGrams: 425.2425, expectedP100: 1.6391 },
    { sku: '12443812', desc: 'Hillshire Farm Ultra Thin Honey Ham Lunchmeat, 16 oz Plastic Tub, Refrigerated', price: 6.48, expectedGrams: 453.592, expectedP100: 1.4288 },
  ];
  for (const r of refs) {
    const text = buildProductLine(r.sku, r.desc, r.price.toFixed(2));
    const item = walmartParser.parse(text).items[0];
    const grams = (parseFloat(item.pack_description) || null) &&
      (item.pack_description.endsWith('lb') ? parseFloat(item.pack_description) * LB_G : parseFloat(item.pack_description) * OZ_G);
    assert.ok(Math.abs(grams - r.expectedGrams) < 0.01, `${r.sku} grams: got ${grams}, expected ~${r.expectedGrams}`);
    const p100 = item.unit_price / grams * 100;
    assert.ok(Math.abs(p100 - r.expectedP100) < 0.001, `${r.sku} cost/100g: got ${p100.toFixed(4)}, expected ~${r.expectedP100}`);
  }
});

test('pack extraction: catch-weight RANGE (19400236, real dash+PUA-glyph shape) -> pack_description null, never an endpoint', () => {
  const text = buildProductLine('19400236', 'Perdue Harvestland, Free Range, Fresh Boneless Chicken Breast, 1.50\u{e088} 4.30 lb. Tray', '11.72');
  const item = walmartParser.parse(text).items[0];
  assert.strictEqual(item.pack_description, null);
  assert.notStrictEqual(item.pack_description, '4.3lb');
  assert.notStrictEqual(item.pack_description, '1.5lb');
});
test('pack extraction: catch-weight RANGE (27935840, real double-space shape) -> pack_description null', () => {
  const text = buildProductLine('27935840', 'Freshness Guaranteed Boneless, Skinless Chicken Breasts, 2.75  7.0 lb Tray', '10.69');
  const item = walmartParser.parse(text).items[0];
  assert.strictEqual(item.pack_description, null);
});
test('pack extraction: "Each" (Watermelon) -> pack_description = "Each", never a VDR_UNIT_WEIGHTS estimate', () => {
  const text = buildProductLine('44391101', 'Fresh Seedless Watermelon, Each', '4.65');
  const item = walmartParser.parse(text).items[0];
  assert.strictEqual(item.pack_description, 'Each');
});
test('pack extraction: "Each" (Zucchini) -> pack_description = "Each"', () => {
  const text = buildProductLine('44390947', 'Fresh Zucchini, Each', '3.60');
  const item = walmartParser.parse(text).items[0];
  assert.strictEqual(item.pack_description, 'Each');
});
test('pack extraction: Gallon (Milk) -> pack_description = "1gal", no density used/needed', () => {
  const text = buildProductLine('10450114', 'Great Value Whole Vitamin D Milk, Gallon', '3.17');
  const item = walmartParser.parse(text).items[0];
  assert.strictEqual(item.pack_description, '1gal');
});
test('pack extraction: non-product rows (Shipping/adjustment/handling/fulfillment_variance) always have pack_description = null', () => {
  const text = [
    'SKU Description Quantity Unit Price Discount Tax Billed Total',
    'Shipping SHIPPING 1 $0.99 $0.00 $0.00 $0.99',
    'ALT_PAYME Alternative Payment 1 -$21.26 $0.00 $0.00 -$21.26',
    'Express Fee HANDLING 1 $1.93 $0.00 $0.00 $1.93',
    'SubDown FULFILL_VARIANCE 1 $10.29 $0.00 $0.00 $10.29',
    'Invoice X Invoice Summary',
  ].join('\n');
  const items = walmartParser.parse(text).items;
  assert.ok(items.every(i => i.pack_description === null));
});

// ── 17–20. Reconciliation for all 4 real documents ───────────────────
function sumAmounts(p) { return Math.round(p.items.reduce((s, i) => s + i.amount, 0) * 100) / 100; }

test('17. reconciliation c51dd720 = 52.07', () => {
  const p = parsers.parse(DOC_TEXT.c51dd720);
  assert.strictEqual(sumAmounts(p), 52.07);
  assert.strictEqual(p.warnings.some(w => w.code === 'DOC-TOTAL-001'), false);
});
test('18. reconciliation 6c246fda = 63.33 (includes -21.26 adjustment)', () => {
  const p = parsers.parse(DOC_TEXT['6c246fda']);
  assert.strictEqual(sumAmounts(p), 63.33);
  assert.strictEqual(p.warnings.some(w => w.code === 'DOC-TOTAL-001'), false);
});
test('19. reconciliation 12fd6860 = 61.56', () => {
  const p = parsers.parse(DOC_TEXT['12fd6860']);
  assert.strictEqual(sumAmounts(p), 61.56);
  assert.strictEqual(p.warnings.some(w => w.code === 'DOC-TOTAL-001'), false);
});
test('20. reconciliation 30082536 = 33.88 (includes 4 Shipping rows)', () => {
  const p = parsers.parse(DOC_TEXT['30082536']);
  assert.strictEqual(sumAmounts(p), 33.88);
  assert.strictEqual(p.warnings.some(w => w.code === 'DOC-TOTAL-001'), false);
});

// ── 21. Regression: existing parsers untouched ────────────────────────
test('21a. Hardie\'s, FreshPoint, Fruge, BEK still recognised exactly as before', () => {
  assert.strictEqual(parsers.detectVendor("DAIRYLAND PRODUCE INVOICE/POD 123"), 'hardies');
  assert.strictEqual(parsers.detectVendor("FRESHPOINT DALLAS Invoice No. 123"), 'freshpoint');
  assert.strictEqual(parsers.detectVendor("FRUGE SEAFOOD invoice"), 'fruge');
  assert.strictEqual(parsers.detectVendor("BEN E. KEITH invoice"), 'bek');
});
test('21b. walmart entry does not alter VENDORS iteration for non-Walmart text', () => {
  // Sanity: detectVendor still returns 'unknown' for genuinely
  // unrecognised text (no accidental catch-all introduced).
  assert.strictEqual(parsers.detectVendor('Some random unrelated document'), 'unknown');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
