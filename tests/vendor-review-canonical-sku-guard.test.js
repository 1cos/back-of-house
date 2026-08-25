// ══════════════════════════════════════════════════════════════════
// vendor-documents-review.js — vdrDecideCanonicalUpdate() regression
// Plain Node, no framework: `node tests/vendor-review-canonical-sku-guard.test.js`
//
// vdrPreflight is a large async function with many DOM/Supabase
// dependencies, not require()-able whole. Same convention as the other
// tests in this series: read the real source, extract the pure guard
// function by marker, eval it, and test the EXACT code — not a
// rewritten copy. Deliberately a local function, not shared with
// process-invoice's decideVendorUpdate() (see task scope).
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

const START = '// ── MARKER:VDR_DECIDE_CANONICAL_UPDATE_START ────────────────────────';
const END = '// ── MARKER:VDR_DECIDE_CANONICAL_UPDATE_END ──────────────────────────';
const startIdx = src.indexOf(START);
const endIdx = src.indexOf(END);
assert.ok(startIdx >= 0 && endIdx > startIdx, 'markers not found — source may have changed');
const block = src.slice(startIdx, endIdx);

const vdrDecideCanonicalUpdate = new Function(block + '\nreturn vdrDecideCanonicalUpdate;')();

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

console.log('\nvdrDecideCanonicalUpdate() — regression tests\n');

// ── T1: same SKU ────────────────────────────────────────────────────
test('T1: same SKU → update (refresh canonical metadata)', () => {
  assert.strictEqual(vdrDecideCanonicalUpdate('A', 'A'), 'update');
});

// ── T2: different SKU — the bug being fixed ─────────────────────────
test('T2: different SKU (both valued) → skip (canonical fully preserved)', () => {
  assert.strictEqual(vdrDecideCanonicalUpdate('A', 'B'), 'skip');
});

test('T2b: documents the OLD behavior would have updated unconditionally', () => {
  // Old code had no branch at all here — it always did toUpdate.push(...).
  // This test just makes the contrast explicit for future readers.
  const oldBehaviorAlwaysUpdates = true;
  assert.notStrictEqual(vdrDecideCanonicalUpdate('A', 'B'), oldBehaviorAlwaysUpdates ? 'update' : 'skip');
});

// ── T3: existing SKU null — safe to populate ────────────────────────
test('T3: existing vendor_sku null + incoming valid → populate_sku', () => {
  assert.strictEqual(vdrDecideCanonicalUpdate(null, 'A'), 'populate_sku');
});
test('T3b: existing vendor_sku empty string treated as null', () => {
  assert.strictEqual(vdrDecideCanonicalUpdate('   ', 'A'), 'populate_sku');
});

// ── T4: incoming SKU missing — canonical preserved ──────────────────
test('T4: incoming SKU missing (null) → skip', () => {
  assert.strictEqual(vdrDecideCanonicalUpdate('A', null), 'skip');
});
test('T4b: incoming SKU whitespace-only → skip', () => {
  assert.strictEqual(vdrDecideCanonicalUpdate('A', '   '), 'skip');
});

test('Both missing → skip (nothing to populate, nothing to refresh)', () => {
  assert.strictEqual(vdrDecideCanonicalUpdate(null, null), 'skip');
});

// ── Liquid Egg real-world regression (STEP 5) ───────────────────────
test('Liquid Egg regression: canonical 09715 stays intact when 29810 arrives later', () => {
  const decision = vdrDecideCanonicalUpdate('09715', '29810');
  assert.strictEqual(decision, 'skip', 'a future 29810 invoice must not touch the 09715 canonical row');
  // The guard alone is the proof: no payload is ever built for the
  // canonical row id in the 'skip' branch, so pack=15/2# and
  // unit_price=59.99 are never overwritten by 29810's 20#/$78.41.
});

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail > 0 ? 1 : 0);
