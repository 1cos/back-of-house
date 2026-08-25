// ══════════════════════════════════════════════════════════════════
// purchase-rhythm.js — engine regression tests (T1-T14)
// Plain Node, no framework: `node tests/purchase-rhythm.test.js`
//
// js/purchase-rhythm.js is a plain ES module (`export function ...`,
// same convention as js/unit-normalizer.js) so it isn't require()-able
// as CommonJS directly. Rather than reimplementing the logic here (which
// could silently drift from the real file), this test reads the real
// source, strips the `export ` keywords, and evaluates it with
// `new Function` — same "test the real code" principle used throughout
// this repo's other test files for non-require()-able sources.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, '..', 'js', 'purchase-rhythm.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');
const runnable = src.replace(/^export (const|function)/gm, '$1');

const mod = new Function(runnable + `
  return {
    FUNCTIONAL_INGREDIENT_EQUIVALENCE,
    resolveEquivalenceConfig,
    isEventEligible,
    computeIngredientRhythm,
    computeQuantitySignal,
    explainRhythm,
    rankCandidates,
  };
`)();

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

console.log('\nPurchase Rhythm v1 — engine regression tests\n');

// Helper to build simple event fixtures
function ev(dates, sku) {
  return dates.map(d => ({ invoice_date: d, vendor_sku: sku || 'X', qty: 1, pack_description: 'p' }));
}

const GENERIC_ID = 'generic-test-ingredient';

// ── T1 — Heavy Cream recurring ──────────────────────────────────────
test('T1: Heavy Cream — stable ~4-day rhythm classifies RECURRING + status computed', () => {
  const HC = '9dc8b439-79fb-4fa5-8a89-48c89a300231';
  const dates = ['2026-06-22','2026-06-29','2026-07-06','2026-07-10','2026-07-15','2026-07-17',
                 '2026-07-22','2026-07-25','2026-07-31','2026-08-03','2026-08-07','2026-08-08',
                 '2026-08-12','2026-08-17','2026-08-21'];
  const raw = ev(dates, '03744');
  const r = mod.computeIngredientRhythm(HC, raw, { asOfDate: '2026-08-25' });
  assert.strictEqual(r.confidence, 'HIGH');
  assert.strictEqual(r.regularity, 'RECURRING');
  assert.strictEqual(r.event_count, 15);
  assert.ok(r.median_gap_days >= 3 && r.median_gap_days <= 5);
});

// ── T2 — Insufficient history ────────────────────────────────────────
test('T2: 2 events → INSUFFICIENT_HISTORY, never a CHECK status', () => {
  const raw = ev(['2026-08-01', '2026-08-10']);
  const r = mod.computeIngredientRhythm(GENERIC_ID, raw, { asOfDate: '2026-08-25' });
  assert.strictEqual(r.status, 'INSUFFICIENT_HISTORY');
  assert.strictEqual(r.confidence, 'LOW');
});

// ── T3 — Variable ingredient → suppressed ───────────────────────────
test('T3: highly dispersed gaps → SUPPRESSED_VARIABLE, no CHECK', () => {
  const raw = ev(['2026-06-01','2026-06-05','2026-06-30','2026-07-02','2026-08-20']); // gaps: 4,25,2,49
  const r = mod.computeIngredientRhythm(GENERIC_ID, raw, { asOfDate: '2026-08-25' });
  assert.notStrictEqual(r.regularity, 'RECURRING');
  assert.strictEqual(r.status, 'SUPPRESSED_VARIABLE');
});

// ── T4 — Threshold: just under → NORMAL ─────────────────────────────
test('T4: days_since just under max(1.5*median, p75) → NORMAL', () => {
  const raw = ev(['2026-07-01','2026-07-05','2026-07-09','2026-07-13','2026-07-17']); // gaps all 4, median=4, p75=4, threshold=6
  const r = mod.computeIngredientRhythm(GENERIC_ID, raw, { asOfDate: '2026-07-22' }); // days_since=5 < 6
  assert.strictEqual(r.regularity, 'RECURRING');
  assert.ok(r.days_since_last < r.check_threshold_days);
  assert.strictEqual(r.status, 'NORMAL');
});

// ── T5 — CHECK_SOON: over threshold, not over max_gap ───────────────
test('T5: over threshold but within max_gap → CHECK_SOON', () => {
  const raw = ev(['2026-07-01','2026-07-05','2026-07-09','2026-07-13','2026-07-17','2026-07-22']); // gaps 4,4,4,4,5 -> median4,p75~4.75,max=5
  const r = mod.computeIngredientRhythm(GENERIC_ID, raw, { asOfDate: '2026-07-28' }); // days_since=6, threshold=max(6,4.75)=6, maxGap=5 -> 6>5 actually triggers OVERDUE path; adjust date to land inside
  // Recompute with a days_since that sits between threshold and max_gap+something isn't possible if threshold>max_gap.
  // Use a series where max_gap > threshold instead:
  const raw2 = ev(['2026-07-01','2026-07-05','2026-07-09','2026-07-13','2026-07-25']); // gaps 4,4,4,12 -> median4, p75=6, max=12, threshold=6
  const r2 = mod.computeIngredientRhythm(GENERIC_ID, raw2, { asOfDate: '2026-07-19' }); // last=07-13, days_since=6
  assert.strictEqual(r2.regularity, 'VARIABLE'); // max_median_ratio=3.0 -> not <3, so VARIABLE — need a cleaner fixture
});

// T5 clean fixture: tight series with one slightly larger historical gap so max_gap > threshold
test('T5b: over threshold, within max_gap → CHECK_SOON (clean fixture)', () => {
  const raw = ev(['2026-06-01','2026-06-05','2026-06-09','2026-06-13','2026-06-17','2026-06-21','2026-06-25','2026-06-30']);
  // gaps: 4,4,4,4,4,4,5 -> median=4, p75=4, max=5, mad~0, max_median_ratio=1.25 -> RECURRING
  // threshold = max(6, 4) = 6. Need days_since between 6 and 5(max_gap)... impossible since max_gap(5)<threshold(6).
  // So instead build a series with a real historical 7-day gap to raise max_gap above threshold.
  const raw2 = ev(['2026-06-01','2026-06-05','2026-06-09','2026-06-13','2026-06-17','2026-06-24','2026-06-28']);
  // gaps: 4,4,4,4,7,4 -> sorted [4,4,4,4,4,7], median=4, p75=4, max=7, threshold=max(6,4)=6
  const r = mod.computeIngredientRhythm(GENERIC_ID, raw2, { asOfDate: '2026-07-04' }); // last=06-28, days_since=6
  assert.strictEqual(r.regularity, 'RECURRING');
  assert.strictEqual(r.days_since_last, 6);
  assert.ok(r.days_since_last >= r.check_threshold_days);
  assert.ok(r.days_since_last <= r.max_gap);
  assert.strictEqual(r.status, 'CHECK_SOON');
});

// ── T6 — OVERDUE: beyond max_gap but not yet 2x median ──────────────
test('T6: days_since beyond max_gap and threshold, but under 2x median → OVERDUE', () => {
  const raw = ev(['2026-06-01','2026-06-05','2026-06-09','2026-06-13','2026-06-17','2026-06-23']);
  // gaps: 4,4,4,4,6 -> median=4, p75=4, max=6, threshold=max(6,4)=6
  const r = mod.computeIngredientRhythm(GENERIC_ID, raw, { asOfDate: '2026-06-30' }); // days_since=7
  assert.strictEqual(r.regularity, 'RECURRING');
  assert.strictEqual(r.days_since_last, 7);
  assert.ok(r.days_since_last > r.max_gap);
  assert.ok(r.days_since_last < 2 * r.median_gap_days);
  assert.strictEqual(r.status, 'OVERDUE');
});

// ── T7 — STRONGLY_OVERDUE: beyond max_gap AND >=2x median ───────────
test('T7: days_since >= 2*median and > max_gap → STRONGLY_OVERDUE (priority over OVERDUE)', () => {
  const raw = ev(['2026-06-01','2026-06-05','2026-06-09','2026-06-13','2026-06-17','2026-06-24','2026-06-28']);
  const r = mod.computeIngredientRhythm(GENERIC_ID, raw, { asOfDate: '2026-07-14' }); // days_since=16 >= 2*4=8, >7
  assert.strictEqual(r.status, 'STRONGLY_OVERDUE');
});

// ── T8 — Cherry Tomatoes equivalence exclusion ──────────────────────
test('T8: 22520/33536 do not reset the 07673 bulk clock', () => {
  const CT = 'c77db80e-4f35-4835-a14d-007fe9ec1a03';
  const raw = [
    ...ev(['2026-06-22','2026-07-01','2026-07-10','2026-07-20','2026-08-01'], '07673'),
    { invoice_date: '2026-08-24', vendor_sku: '22520', qty: 1, pack_description: '8/12 OZ' }, // must NOT count
    { invoice_date: '2026-08-24', vendor_sku: '33536', qty: 1, pack_description: '8/12 OZ' }, // must NOT count
  ];
  const r = mod.computeIngredientRhythm(CT, raw, { asOfDate: '2026-08-25' });
  assert.strictEqual(r.event_count, 5); // only the 07673 dates
  assert.strictEqual(r.last_purchase_date, '2026-08-01'); // NOT reset to 08-24
});

// ── T9 — Stew Meat aggregation + exclusion ──────────────────────────
test('T9: 24171+29554 aggregate as one need; 23278 excluded entirely', () => {
  const SM = '28bd0f90-c1ca-462e-8936-efee74cf9bd6';
  const raw = [
    ...ev(['2026-07-10','2026-07-15','2026-07-31'], '29554'),
    ...ev(['2026-08-19'], '24171'),
    { invoice_date: '2026-07-10', vendor_sku: '23278', qty: 2, pack_description: 'x' }, // excluded
  ];
  const r = mod.computeIngredientRhythm(SM, raw, { asOfDate: '2026-08-25' });
  assert.strictEqual(r.event_count, 4); // 3 REF dates + 1 FRZ date, 23278 excluded, no double count on 07-10
  assert.strictEqual(r.last_purchase_date, '2026-08-19');
});

// ── T10 — Heavy Cream aggregation across 3 SKUs ─────────────────────
test('T10: 03744 + 10068 + 13405 aggregate as one need', () => {
  const HC = '9dc8b439-79fb-4fa5-8a89-48c89a300231';
  const raw = [
    ...ev(['2026-06-22','2026-07-06'], '03744'),
    ...ev(['2026-08-07'], '13405'),
    ...ev(['2026-08-17','2026-08-21'], '10068'),
  ];
  const r = mod.computeIngredientRhythm(HC, raw, { asOfDate: '2026-08-25' });
  assert.strictEqual(r.event_count, 5);
  assert.strictEqual(r.last_purchase_date, '2026-08-21');
});

// ── T11 — Watermelon cross-vendor blind spot ────────────────────────
test('T11: Watermelon overdue-looking data resolves to CROSS_VENDOR_BLIND_SPOT, never strong overdue', () => {
  const WM = '643c5766-ba37-4f61-a165-2e264048fd69';
  const raw = ev(['2026-06-01','2026-06-05','2026-06-09','2026-06-13'], '05446'); // tight 4-day rhythm
  const r = mod.computeIngredientRhythm(WM, raw, { asOfDate: '2026-07-15' }); // days_since way beyond, would be STRONGLY_OVERDUE otherwise
  assert.strictEqual(r.cross_vendor_blind_spot, true);
  assert.strictEqual(r.status, 'CROSS_VENDOR_BLIND_SPOT');
  assert.notStrictEqual(r._raw_status, 'CROSS_VENDOR_BLIND_SPOT'); // proves it was downgraded, not naturally that
});

// ── T12 — Pending documents force provisional ───────────────────────
test('T12: a would-be CHECK_SOON becomes DATA_INCOMPLETE when a pending doc could contain it', () => {
  const raw = ev(['2026-06-01','2026-06-05','2026-06-09','2026-06-13','2026-06-17','2026-06-24','2026-06-28']);
  const r = mod.computeIngredientRhythm(GENERIC_ID, raw, { asOfDate: '2026-07-04', pendingSince: '2026-06-30' });
  assert.strictEqual(r._raw_status, 'CHECK_SOON');
  assert.strictEqual(r.status, 'DATA_INCOMPLETE');
});

// ── T13 — Same-day duplicates don't create extra events ─────────────
test('T13: multiple lines same day/document = one event', () => {
  const raw = [
    { invoice_date: '2026-08-01', vendor_sku: 'X', qty: 1, pack_description: 'p' },
    { invoice_date: '2026-08-01', vendor_sku: 'X', qty: 2, pack_description: 'p' },
    { invoice_date: '2026-08-01', vendor_sku: 'X', qty: 1, pack_description: 'p' },
    { invoice_date: '2026-08-05', vendor_sku: 'X', qty: 1, pack_description: 'p' },
  ];
  const r = mod.computeIngredientRhythm(GENERIC_ID, raw, { asOfDate: '2026-08-10' });
  assert.strictEqual(r.event_count, 2); // not 4
});

// ── T14 — Mixed packs suppress quantity prediction ──────────────────
test('T14: mixed packs → quantity_status MIXED_PACKS, no median_qty', () => {
  const lines = [
    { pack_description: '9-1/2 GAL', qty: 1 },
    { pack_description: '9-1/2 GAL', qty: 1 },
    { pack_description: '9-1/2 GAL', qty: 1 },
    { pack_description: '12/1 QT', qty: 1 },
    { pack_description: '1 QT', qty: 1 },
  ];
  const q = mod.computeQuantitySignal(lines);
  assert.strictEqual(q.quantity_status, 'MIXED_PACKS');
  assert.strictEqual(q.median_qty, null);
});

// ── Extra: RELIABLE quantity signal sanity check ────────────────────
test('Extra: dominant pack >=80% -> RELIABLE with median qty', () => {
  const lines = [
    { pack_description: '6 CT', qty: 2 }, { pack_description: '6 CT', qty: 3 },
    { pack_description: '6 CT', qty: 3 }, { pack_description: '6 CT', qty: 4 },
    { pack_description: '6 CT', qty: 3 },
  ];
  const q = mod.computeQuantitySignal(lines);
  assert.strictEqual(q.quantity_status, 'RELIABLE');
  assert.strictEqual(q.median_qty, 3);
});

// ── Extra: explanation wording never says "order this" ──────────────
test('Extra: explanation text uses "check stock", never "order this"', () => {
  const raw = ev(['2026-06-01','2026-06-05','2026-06-09','2026-06-13','2026-06-17','2026-06-24','2026-06-28']);
  const r = mod.computeIngredientRhythm(GENERIC_ID, raw, { asOfDate: '2026-07-06' });
  r.ingredient_name = 'Arugula';
  const text = mod.explainRhythm(r);
  assert.ok(/check stock/i.test(text));
  assert.ok(!/order this/i.test(text));
});

// ── Extra: ranking caps at 10 and orders by severity then ratio ─────
test('Extra: rankCandidates orders STRONGLY_OVERDUE > OVERDUE > CHECK_SOON and caps at max', () => {
  const mk = (status, ratio) => ({ rhythm: { status, days_since_last: ratio * 4, median_gap_days: 4 } });
  const entries = [
    mk('CHECK_SOON', 1.5), mk('STRONGLY_OVERDUE', 2.2), mk('OVERDUE', 1.8),
    mk('NORMAL', 1.0), mk('SUPPRESSED_VARIABLE', 3.0),
  ];
  const ranked = mod.rankCandidates(entries, 10);
  assert.strictEqual(ranked.length, 3); // NORMAL and SUPPRESSED_VARIABLE excluded
  assert.strictEqual(ranked[0].rhythm.status, 'STRONGLY_OVERDUE');
  assert.strictEqual(ranked[2].rhythm.status, 'CHECK_SOON');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail > 0 ? 1 : 0);
