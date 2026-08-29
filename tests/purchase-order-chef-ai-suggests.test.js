// ══════════════════════════════════════════════════════════════════
// Show Purchase Rhythm on Compile Order Home — Chef AI Suggests
// Plain Node: `node tests/purchase-order-chef-ai-suggests.test.js`
// Requires the real js/purchase-order.js module (its own test-only
// exports), not a reimplementation.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const po = require(path.join(__dirname, '..', 'js', 'purchase-order.js'));
const purchaseRhythmSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'purchase-rhythm.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }

console.log('\nChef AI Suggests (Compila Ordine home view) — test run\n');

// Real PurchaseRhythm bridge — evaluated from the real source (browser
// bridge block), not reimplemented, so rankCandidates/computeIngredientRhythm
// are the exact same functions the app itself would use.
global.window = global.window || {};
new Function('window', purchaseRhythmSrc.replace(/^export /gm, ''))(global.window);
const PurchaseRhythm = global.window.PurchaseRhythm;

function rhythmFor(medianGapDays, daysSinceLast, eventCount, overrideStatus) {
  // Build a real rhythm object shape by actually running the engine
  // against synthetic dates matching the requested median gap, rather
  // than hand-assembling a fake result object.
  const dates = [];
  let d = new Date('2026-01-01T00:00:00Z');
  for (let i = 0; i < eventCount; i++) {
    dates.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + medianGapDays * 86400000);
  }
  const lastDate = dates[dates.length - 1];
  const asOf = new Date(new Date(lastDate + 'T00:00:00Z').getTime() + daysSinceLast * 86400000).toISOString().slice(0, 10);
  const rawEvents = dates.map(dt => ({ invoice_date: dt, vendor_sku: 'TESTSKU', qty: 1, pack_description: '5lb' }));
  return PurchaseRhythm.computeIngredientRhythm('test-ingredient-id-' + Math.random(), rawEvents, { asOfDate: asOf, pendingSince: null });
}

// ══════════════════════════════════════════════════════════════════
// H.5 — Frier Oil real-world case: median 12 days, 21 days since last -> OVERDUE
// ══════════════════════════════════════════════════════════════════
test('H5: Frier Oil equivalent (median 12d, 21d since last) -> real engine computes OVERDUE', () => {
  const rh = rhythmFor(12, 21, 5);
  assert.strictEqual(rh.status, 'OVERDUE');
  assert.strictEqual(Math.round(rh.median_gap_days), 12);
  assert.strictEqual(rh.days_since_last, 21);
});

// ══════════════════════════════════════════════════════════════════
// H.1 — OVERDUE appears in the home view
// ══════════════════════════════════════════════════════════════════
test('H1: an OVERDUE ingredient appears in poRenderList() output with the exact requested wording', () => {
  const rh = rhythmFor(12, 21, 5);
  po.poSetRhythmResultsForTest([{ ingredient_id: rh.ingredient_id, name: 'Frier Oil', rhythm: rh, qty: { quantity_status: 'INSUFFICIENT_DATA' } }]);
  po.poSetDraftLinesForTest([]);
  const html = po.poRenderList();
  assert.ok(html.includes('Chef AI Suggests'));
  assert.ok(html.includes('Check Frier Oil'));
  assert.ok(html.includes('Usually every 12 days'));
  assert.ok(html.includes('last bought 21 days ago'));
});

// ══════════════════════════════════════════════════════════════════
// H.2 — NORMAL never clutters the actionable list
// ══════════════════════════════════════════════════════════════════
test('H2: a NORMAL ingredient (e.g. Cherry Tomatoes bought yesterday, well within rhythm) never appears in the actionable list', () => {
  const rh = rhythmFor(2, 1, 10); // median 2 days, only 1 day since last -> NORMAL
  assert.strictEqual(rh.status, 'NORMAL');
  po.poSetRhythmResultsForTest([{ ingredient_id: rh.ingredient_id, name: 'Cherry Tomatoes', rhythm: rh, qty: { quantity_status: 'INSUFFICIENT_DATA' } }]);
  po.poSetDraftLinesForTest([]);
  const html = po.poRenderList();
  assert.ok(!html.includes('Cherry Tomatoes'), 'NORMAL items must never appear in Chef AI Suggests');
  assert.ok(html.includes('Nothing unusual to check today'), 'with zero actionable items, the discreet empty state must show');
});

// ══════════════════════════════════════════════════════════════════
// H.3 — SUPPRESSED_VARIABLE never appears as a false warning
// ══════════════════════════════════════════════════════════════════
test('H3: a SUPPRESSED_VARIABLE ingredient (irregular timing, e.g. Raspberry-equivalent) never appears, even though it has an old last-purchase date', () => {
  // Real irregular gaps (not evenly spaced) -> engine itself must classify
  // this as VARIABLE/SUPPRESSED_VARIABLE, not a hand-picked status.
  const rawEvents = [
    { invoice_date: '2026-06-22', vendor_sku: 'X', qty: 1 },
    { invoice_date: '2026-06-29', vendor_sku: 'X', qty: 1 },
    { invoice_date: '2026-07-03', vendor_sku: 'X', qty: 1 },
    { invoice_date: '2026-07-08', vendor_sku: 'X', qty: 1 },
    { invoice_date: '2026-07-11', vendor_sku: 'X', qty: 1 },
    { invoice_date: '2026-07-18', vendor_sku: 'X', qty: 1 },
    { invoice_date: '2026-07-20', vendor_sku: 'X', qty: 1 },
    { invoice_date: '2026-07-24', vendor_sku: 'X', qty: 1 },
    { invoice_date: '2026-08-14', vendor_sku: 'X', qty: 1 },
  ];
  const rh = PurchaseRhythm.computeIngredientRhythm('raspberry-test-id', rawEvents, { asOfDate: '2026-08-29', pendingSince: null });
  assert.strictEqual(rh.status, 'SUPPRESSED_VARIABLE', 'sanity check: this real irregular pattern must genuinely classify as suppressed');
  po.poSetRhythmResultsForTest([{ ingredient_id: rh.ingredient_id, name: 'Raspberry', rhythm: rh, qty: { quantity_status: 'INSUFFICIENT_DATA' } }]);
  po.poSetDraftLinesForTest([]);
  const html = po.poRenderList();
  assert.ok(!html.includes('Raspberry'), 'SUPPRESSED_VARIABLE must never surface as a false warning, despite 15 days since last purchase');
  assert.ok(html.includes('Nothing unusual to check today'));
});

// ══════════════════════════════════════════════════════════════════
// H.4 — a failed load never breaks Compila Ordine
// ══════════════════════════════════════════════════════════════════
test('H4: PurchaseRhythm unavailable (engine failed to load) -> poRenderList() still renders the normal composer/drafts, no exception', () => {
  const realBridge = global.window.PurchaseRhythm;
  delete global.window.PurchaseRhythm;
  po.poSetDraftLinesForTest([]);
  let html;
  assert.doesNotThrow(() => { html = po.poRenderList(); });
  assert.ok(html.includes('Detta o scrivi la lista'), 'the main composer must still render');
  assert.ok(!html.includes('Chef AI Suggests'), 'the section itself must be entirely absent when the engine is unavailable, not an error');
  global.window.PurchaseRhythm = realBridge; // restore for subsequent tests
});
test('H4b: rhythm data still loading (null) -> poRenderList() renders immediately, no flash of an empty-state card', () => {
  po.poSetRhythmResultsForTest(null);
  po.poSetDraftLinesForTest([]);
  // A real, never-resolving Promise mock — matches real network latency
  // (the fetch genuinely hasn't completed yet at the moment we check).
  const pendingChain = { eq() { return this; }, not() { return this; }, in() { return this; }, select() { return this; }, then() { /* never resolves */ } };
  global.window.supabaseClient = { from() { return pendingChain; } };
  const html = po.poRenderList();
  assert.ok(html.includes('Detta o scrivi la lista'), 'the main composer must render immediately regardless of load state');
  assert.ok(!html.includes('Chef AI Suggests'), 'while still loading, the section must say nothing yet — not an empty-state message either');
  delete global.window.supabaseClient;
});

// ══════════════════════════════════════════════════════════════════
// Part G — Hardie's scope note always present when the section renders
// ══════════════════════════════════════════════════════════════════
test('G: the Hardie\'s-scope note is present whenever the section renders (both with items and empty state)', () => {
  const rh = rhythmFor(12, 21, 5);
  po.poSetRhythmResultsForTest([{ ingredient_id: rh.ingredient_id, name: 'Frier Oil', rhythm: rh, qty: {} }]);
  po.poSetDraftLinesForTest([]);
  let html = po.poRenderList();
  assert.ok(html.includes("Based on Hardie's purchase history"));

  po.poSetRhythmResultsForTest([]); // loaded, genuinely nothing
  html = po.poRenderList();
  assert.ok(html.includes("Based on Hardie's purchase history"), 'the scope note must appear even in the empty state, not only when items exist');
});

// ══════════════════════════════════════════════════════════════════
// Part D — never invents a quantity suggestion
// ══════════════════════════════════════════════════════════════════
test('D: RELIABLE quantity signal is shown verbatim; MIXED_PACKS/INSUFFICIENT_DATA never invents a suggested quantity', () => {
  const rh = rhythmFor(12, 21, 5);
  po.poSetRhythmResultsForTest([
    { ingredient_id: rh.ingredient_id + '-a', name: 'Reliable Item', rhythm: rh, qty: { quantity_status: 'RELIABLE', median_qty: 2, dominant_pack: '5lb bag' } },
    { ingredient_id: rh.ingredient_id + '-b', name: 'Mixed Item', rhythm: { ...rh, ingredient_id: rh.ingredient_id + '-b' }, qty: { quantity_status: 'MIXED_PACKS', median_qty: null } },
  ]);
  po.poSetDraftLinesForTest([]);
  const html = po.poRenderList();
  assert.ok(html.includes('Usually 2 (5lb bag)'), 'the real RELIABLE signal must be shown verbatim');
  // "Mixed Item" appears (it's still OVERDUE), but with no quantity line —
  // count the "Usually N" quantity-signal occurrences (distinct from
  // "Usually every N days" rhythm line, which always exists per item).
  const qtyLines = (html.match(/Usually \d+ \(/g) || []).length;
  assert.strictEqual(qtyLines, 1, 'exactly one invented-free quantity line (Reliable Item only) — Mixed Item must not get one');
});

// ══════════════════════════════════════════════════════════════════
// Part F — review view (poRenderCheckBeforeOrdering) still works, untouched
// ══════════════════════════════════════════════════════════════════
test('F: poRenderCheckBeforeOrdering() (the pre-existing review-view section) is untouched and still renders the same OVERDUE item', () => {
  const rh = rhythmFor(12, 21, 5);
  po.poSetRhythmResultsForTest([{ ingredient_id: rh.ingredient_id, name: 'Frier Oil', rhythm: rh, qty: {} }]);
  po.poSetDraftLinesForTest([]);
  const html = po.poRenderCheckBeforeOrdering();
  assert.ok(html.includes('Check Before Ordering'), 'the review-view section header must be unchanged');
  assert.ok(html.includes('Frier Oil'));
  assert.ok(html.includes('Worth checking — later than the usual purchase rhythm'), 'the existing OVERDUE wording in the review view must be unchanged');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
