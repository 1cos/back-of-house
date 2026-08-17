// ══════════════════════════════════════════════════════════════════
// Purchase Order — matching engine tests
// Plain Node, no framework/dependency needed: `node tests/purchase-order-matching.test.js`
// Exercises the REAL matching code in js/purchase-order.js via require(),
// with a fixture catalog injected through poSetCatalogsForTest().
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const path = require('path');
const po = require(path.join(__dirname, '..', 'js', 'purchase-order.js'));

let pass = 0, fail = 0;
function test(name, fn){
  try{ fn(); pass++; console.log('  ✓ ' + name); }
  catch(e){ fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

// ── Fixture catalog — small, realistic Hardie's-style data ──────────
const ING = {
  brusselsSprouts: 'ing-brussels',
  heavyCream: 'ing-heavycream',
  liquidWholeEggs: 'ing-liquideggs',
  eggsLargeGradeA: 'ing-eggslarge',
  romaineLettuce: 'ing-romaine',
  romaHearts: 'ing-romahearts',
};

const aliasCatalog = [
  // one already-confirmed alias, to prove Tier "vendor_item_aliases" gets priority
  { vendor_sku: 'AL001', vendor_description: 'brussel sprouts', ingredient_id: ING.brusselsSprouts }
];

const ingredientVendorsCatalog = [
  { id: 1, vendor_sku: 'HW-BRS', ingredient_id: ING.brusselsSprouts, name: 'Brussels Sprouts' },
  { id: 2, vendor_sku: 'HW-HVC', ingredient_id: ING.heavyCream, name: 'Heavy Cream' },
  { id: 3, vendor_sku: 'HW-LWE', ingredient_id: ING.liquidWholeEggs, name: 'Liquid Whole Eggs' },
  { id: 4, vendor_sku: 'HW-ELG', ingredient_id: ING.eggsLargeGradeA, name: 'Eggs Large Grade A' },
  { id: 5, vendor_sku: 'HW-ROM', ingredient_id: ING.romaineLettuce, name: 'Romaine Lettuce' },
  { id: 6, vendor_sku: 'HW-ROH', ingredient_id: ING.romaHearts, name: 'Romaine Hearts 3ct' },
];

const linksCatalog = [];

function freshCatalog(purchaseFreq){
  po.poSetCatalogsForTest(aliasCatalog, ingredientVendorsCatalog, linksCatalog, purchaseFreq || {});
}

console.log('\nPurchase Order matching — test run\n');

// 1. Brussels -> Brussels Sprouts (high confidence, auto-select)
test('Brussels -> Brussels Sprouts (high confidence)', () => {
  freshCatalog();
  const r = po.poMatchItem('Brussels');
  assert.strictEqual(r.matched, true);
  assert.strictEqual(r.matched_name, 'Brussels Sprouts');
  assert.ok(r.confidence >= 0.82, 'expected high confidence, got ' + r.confidence);
  assert.strictEqual(r.needsReview, false);
});

// 2. brussel -> Brussels Sprouts (typo / missing final s)
test('brussel -> Brussels Sprouts (missing trailing s)', () => {
  freshCatalog();
  const r = po.poMatchItem('brussel');
  assert.strictEqual(r.matched, true);
  assert.strictEqual(r.matched_name, 'Brussels Sprouts');
});

// 3. simple typo: heavy crem -> Heavy Cream
test('heavy crem -> Heavy Cream (typo)', () => {
  freshCatalog();
  const r = po.poMatchItem('heavy crem');
  assert.strictEqual(r.matched, true);
  assert.strictEqual(r.matched_name, 'Heavy Cream');
  assert.ok(r.confidence >= 0.82, 'expected high confidence, got ' + r.confidence);
});

// 4. exact: heavy cream -> Heavy Cream
test('heavy cream -> Heavy Cream (exact)', () => {
  freshCatalog();
  const r = po.poMatchItem('heavy cream');
  assert.strictEqual(r.matched_name, 'Heavy Cream');
  assert.strictEqual(r.confidence, 1);
});

// 5. singular/plural: "sprouts" alone should still point at Brussels Sprouts
//    (only plausible candidate in this fixture catalog)
test('sprouts -> Brussels Sprouts (singular/plural + partial name)', () => {
  freshCatalog();
  const r = po.poMatchItem('sprouts');
  assert.strictEqual(r.matched_name, 'Brussels Sprouts');
});

// 6. partial name: brussels sprouts (full dictated phrase) -> exact
test('brussels sprouts -> Brussels Sprouts (exact stemmed)', () => {
  freshCatalog();
  const r = po.poMatchItem('brussels sprouts');
  assert.strictEqual(r.matched_name, 'Brussels Sprouts');
  assert.strictEqual(r.needsReview, false);
});

// 7. exact alias: "brussel sprouts" is a confirmed alias -> should win via that path
test('exact alias hit is used (vendor_item_aliases)', () => {
  freshCatalog();
  const r = po.poMatchItem('brussel sprouts');
  assert.strictEqual(r.matched, true);
  assert.strictEqual(r.ingredient_id, ING.brusselsSprouts);
});

// 8. vendor filtering: catalog only contains Hardie's-scoped items (fixture
//    itself proves this — poMatchItem never sees items outside what we inject)
test('vendor filtering — only injected (vendor-scoped) catalog is considered', () => {
  freshCatalog();
  const r = po.poMatchItem('nonexistent product xyz');
  assert.strictEqual(r.matched, false);
  assert.deepStrictEqual(r.candidates, []);
});

// 9. two similar candidates -> ambiguous (ROmaine Lettuce vs Romaine Hearts)
test('romaine -> ambiguous between Romaine Lettuce / Romaine Hearts', () => {
  freshCatalog();
  const r = po.poMatchItem('romaine');
  assert.strictEqual(r.matched, false, 'expected no auto-selection when candidates are too close');
  assert.strictEqual(r.needsReview, true);
  assert.ok(r.candidates.length >= 2, 'expected at least 2 candidates, got ' + r.candidates.length);
});

// 10. no real candidate -> manual
test('completely unrelated text -> manual (no candidates)', () => {
  freshCatalog();
  const r = po.poMatchItem('xyz industrial bolts 40mm');
  assert.strictEqual(r.matched, false);
  assert.strictEqual(r.candidates.length, 0);
});

// 11. purchase history breaks a tie between two similarly-named candidates
test('purchase history tiebreak: frequently-bought candidate wins a near-tie', () => {
  // Without history, romaine is ambiguous (see test 9). With heavy purchase
  // history favoring Romaine Hearts, it should win outright.
  freshCatalog({ [ING.romaHearts]: 40, [ING.romaineLettuce]: 0 });
  const r = po.poMatchItem('romaine');
  assert.strictEqual(r.matched, true, 'expected purchase history to resolve the tie');
  assert.strictEqual(r.matched_name, 'Romaine Hearts 3ct');
});

// 12. egg yolk -> best available candidate (no exact "egg yolk" product in
//     catalog) — should land on Eggs Large Grade A or Liquid Whole Eggs,
//     medium confidence, flagged for review rather than silently picked as high
test('egg yolk -> best available candidate, flagged for review', () => {
  freshCatalog();
  const r = po.poMatchItem('egg yolk');
  assert.ok(r.candidates.length >= 1, 'expected at least one plausible egg candidate');
  if(r.matched){
    assert.strictEqual(r.needsReview, true, 'no exact "egg yolk" product exists — should not be silently high-confidence');
  }
});

// 13. liquid egg / liquid eggs -> Liquid Whole Eggs
test('liquid egg -> Liquid Whole Eggs', () => {
  freshCatalog();
  const r = po.poMatchItem('liquid egg');
  assert.strictEqual(r.matched, true);
  assert.strictEqual(r.matched_name, 'Liquid Whole Eggs');
});

test('liquid eggs -> Liquid Whole Eggs (plural)', () => {
  freshCatalog();
  const r = po.poMatchItem('liquid eggs');
  assert.strictEqual(r.matched, true);
  assert.strictEqual(r.matched_name, 'Liquid Whole Eggs');
});

// ── poParseLine sanity (unchanged behaviour, quick regression check) ──
test('poParseLine: "heavy cream 2 cases"', () => {
  const p = po.poParseLine('heavy cream 2 cases');
  assert.strictEqual(p.requested_text, 'heavy cream');
  assert.strictEqual(p.quantity, 2);
  assert.strictEqual(p.unit, 'cases');
});

test('poParseLine: "parsley 3" (no unit)', () => {
  const p = po.poParseLine('parsley 3');
  assert.strictEqual(p.requested_text, 'parsley');
  assert.strictEqual(p.quantity, 3);
  assert.strictEqual(p.unit, null);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail > 0 ? 1 : 0);
