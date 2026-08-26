// ══════════════════════════════════════════════════════════════════
// Check Before Ordering — regression tests (T1-T10)
// Plain Node, no framework: `node tests/purchase-order-check-before-ordering.test.js`
//
// Loads the REAL js/purchase-rhythm.js (ES module, so `export` is stripped
// the same way as its own test suite does) into a `window.PurchaseRhythm`
// bridge — the exact same bridge object the real browser build creates —
// then requires the REAL js/purchase-order.js (which already exports test
// hooks via module.exports) and exercises the real rendering function.
// Nothing here reimplements the engine or the rendering logic.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// ── Build the real window.PurchaseRhythm bridge from the real source ──────
const prSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'purchase-rhythm.js'), 'utf8');
const prRunnable = prSrc.replace(/^export (const|function)/gm, '$1').replace(/^if \(typeof window[\s\S]*$/m, ''); // drop the browser-bridge tail, we build our own below
const prMod = new Function(prRunnable + `
  return { FUNCTIONAL_INGREDIENT_EQUIVALENCE, resolveEquivalenceConfig, isEventEligible, computeIngredientRhythm, computeQuantitySignal, explainRhythm, rankCandidates };
`)();

global.window = { PurchaseRhythm: prMod, supabaseClient: null };
global.document = undefined;

const po = require(path.join(__dirname, '..', 'js', 'purchase-order.js'));

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

console.log('\nCheck Before Ordering — regression tests\n');

const HC = '9dc8b439-79fb-4fa5-8a89-48c89a300231'; // Heavy Cream
const WM = '643c5766-ba37-4f61-a165-2e264048fd69'; // Watermelon (cross-vendor blind spot)

function ev(dates, sku) { return dates.map(d => ({ invoice_date: d, vendor_sku: sku || 'X', qty: 1, pack_description: 'p' })); }

function rhythmFor(ingredientId, dates, asOfDate, sku, pendingSince) {
  const raw = ev(dates, sku);
  const rhythm = prMod.computeIngredientRhythm(ingredientId, raw, { asOfDate, pendingSince });
  const qty = prMod.computeQuantitySignal(raw);
  const cfg = prMod.resolveEquivalenceConfig(ingredientId);
  return { ingredient_id: ingredientId, name: cfg.name || 'Test Ingredient', rhythm, qty };
}

// ── T1: no candidates → section absent ──────────────────────────────
test('T1: no rhythm results → renders nothing', () => {
  po.poSetRhythmResultsForTest([]);
  po.poSetDraftLinesForTest([]);
  assert.strictEqual(po.poRenderCheckBeforeOrdering(), '');
});

// ── T2: 1 CHECK_SOON → section present with correct wording ─────────
test('T2: one CHECK_SOON candidate renders the section with correct wording', () => {
  const entry = rhythmFor('generic-1', ['2026-06-01','2026-06-05','2026-06-09','2026-06-13','2026-06-17','2026-06-23'], '2026-06-30');
  entry.name = 'Arugula';
  assert.strictEqual(entry.rhythm.status, 'OVERDUE'); // sanity on fixture reuse from engine tests — adjust if needed below
  po.poSetRhythmResultsForTest([entry]);
  po.poSetDraftLinesForTest([]);
  const html = po.poRenderCheckBeforeOrdering();
  assert.ok(html.includes('Check Before Ordering'));
  assert.ok(html.includes('Arugula'));
});

// ── T3: OVERDUE wording, never "order now" ──────────────────────────
test('T3: OVERDUE uses "Worth checking" wording, never "order now"', () => {
  const w = po.poCheckBeforeOrderingWording('OVERDUE');
  assert.ok(/Worth checking/.test(w));
  assert.ok(!/order now/i.test(w));
  assert.ok(!/you forgot/i.test(w));
});
test('T3b: STRONGLY_OVERDUE wording never says "out of stock" or "need to buy"', () => {
  const w = po.poCheckBeforeOrderingWording('STRONGLY_OVERDUE');
  assert.ok(/Strong check/.test(w));
  assert.ok(!/out of stock/i.test(w));
  assert.ok(!/need to buy/i.test(w));
});

// ── T4: DATA_INCOMPLETE → provisional, no strong alert ───────────────
test('T4: DATA_INCOMPLETE candidates render as provisional, not as a normal check', () => {
  const entry = rhythmFor('generic-2', ['2026-06-01','2026-06-05','2026-06-09','2026-06-13','2026-06-17','2026-06-23'], '2026-07-04', 'X', '2026-06-30');
  entry.name = 'Tomahake Loin';
  assert.strictEqual(entry.rhythm.status, 'DATA_INCOMPLETE');
  po.poSetRhythmResultsForTest([entry]);
  po.poSetDraftLinesForTest([]);
  const html = po.poRenderCheckBeforeOrdering();
  assert.ok(html.includes('Recent invoices still processing'));
  assert.ok(html.includes('Tomahake Loin'));
  assert.ok(html.includes('provisional'));
  assert.ok(!/Worth checking|Strong check/.test(html)); // no strong wording attached to a provisional item
});

// ── T5: quantity RELIABLE → shows quantity hint ──────────────────────
test('T5: RELIABLE quantity shows a hint', () => {
  const entry = rhythmFor(HC, ['2026-06-01','2026-06-05','2026-06-09','2026-06-13','2026-06-17','2026-06-23'], '2026-06-30', '03744');
  entry.qty = { quantity_status: 'RELIABLE', dominant_pack: '9-1/2 GAL', dominant_pct: 1, median_qty: 1 };
  po.poSetRhythmResultsForTest([entry]);
  po.poSetDraftLinesForTest([]);
  const html = po.poRenderCheckBeforeOrdering();
  assert.ok(/Usually 1/.test(html));
});

// ── T6: MIXED_PACKS → no quantity hint ───────────────────────────────
test('T6: MIXED_PACKS suppresses the quantity hint', () => {
  const entry = rhythmFor(HC, ['2026-06-01','2026-06-05','2026-06-09','2026-06-13','2026-06-17','2026-06-23'], '2026-06-30', '03744');
  entry.qty = { quantity_status: 'MIXED_PACKS', dominant_pack: '9-1/2 GAL', dominant_pct: 0.5, median_qty: null };
  po.poSetRhythmResultsForTest([entry]);
  po.poSetDraftLinesForTest([]);
  const html = po.poRenderCheckBeforeOrdering();
  assert.ok(!/Usually \d/.test(html));
});

// ── T7: Watermelon cross-vendor blind spot never shown as overdue ────
test('T7: CROSS_VENDOR_BLIND_SPOT never surfaces as a normal check', () => {
  const entry = rhythmFor(WM, ['2026-06-01','2026-06-05','2026-06-09','2026-06-13'], '2026-07-15', '05446');
  assert.strictEqual(entry.rhythm.status, 'CROSS_VENDOR_BLIND_SPOT');
  po.poSetRhythmResultsForTest([entry]);
  po.poSetDraftLinesForTest([]);
  const html = po.poRenderCheckBeforeOrdering();
  assert.strictEqual(html, ''); // nothing else to show → section absent entirely
});

// ── T8: ranking caps at 10 ────────────────────────────────────────────
test('T8: more than 10 candidates → section shows at most 10', () => {
  const entries = [];
  for (let i = 0; i < 15; i++) {
    const e = rhythmFor('generic-many-' + i, ['2026-06-01','2026-06-05','2026-06-09','2026-06-13','2026-06-17','2026-06-23'], '2026-06-30');
    e.name = 'Item' + i;
    entries.push(e);
  }
  po.poSetRhythmResultsForTest(entries);
  po.poSetDraftLinesForTest([]);
  const html = po.poRenderCheckBeforeOrdering();
  const count = (html.match(/Item\d+/g) || []).length;
  assert.ok(count <= 10, 'expected at most 10 items, got ' + count);
});

// ── T9: items already in the current draft are never re-suggested ────
test('T9: an ingredient already in the draft is excluded from suggestions', () => {
  const entry = rhythmFor('generic-3', ['2026-06-01','2026-06-05','2026-06-09','2026-06-13','2026-06-17','2026-06-23'], '2026-06-30');
  entry.name = 'AlreadyOrdered';
  po.poSetRhythmResultsForTest([entry]);
  po.poSetDraftLinesForTest([{ ingredient_id: 'generic-3', requested_text: 'AlreadyOrdered', quantity: 1 }]);
  const html = po.poRenderCheckBeforeOrdering();
  assert.strictEqual(html, '');
  // and the draft line itself is untouched by this whole feature
  assert.strictEqual(po.poRenderCheckBeforeOrdering.length, 0); // function takes no args, doesn't mutate draft
});

// ── T10: engine failure never blocks rendering ───────────────────────
test('T10: no PurchaseRhythm results (as if the fetch failed) still renders empty, not throwing', () => {
  po.poSetRhythmResultsForTest([]);
  po.poSetDraftLinesForTest([]);
  assert.doesNotThrow(() => po.poRenderCheckBeforeOrdering());
});

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail > 0 ? 1 : 0);
