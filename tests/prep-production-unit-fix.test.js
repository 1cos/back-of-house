// ══════════════════════════════════════════════════════════════════
// record_prep_production — unit alias fix (Gf pasta save failure)
// Plain Node, no framework: `node tests/prep-production-unit-fix.test.js`
//
// Scope note (same split as tests/journal-lifecycle.test.js):
// The bug and its root fix live entirely in the Postgres RPC
// `record_prep_production` (unit-alias normalisation). js/prep.js has a
// top-level `document.addEventListener(...)` call and no module.exports,
// so it isn't require()-able the way journal.js is — wrapping it just
// for this fix would be exactly the "large redesign" this task said not
// to do. So:
//   PART A — DB-level tests: run directly against Supabase via the
//     Supabase MCP (execute_sql) against the REAL RPC, no bypass.
//     Already executed live for this fix; results are reproduced below
//     as a runbook — re-paste into Supabase to re-verify after any
//     future change to record_prep_production.
//   PART B — Frontend regression guard: extracts the REAL `btnGrid`
//     expression out of the live js/prep.js source (isolation, not a
//     reimplementation) and evaluates it with `new Function` for
//     representative task-unit scenarios, asserting on the actual
//     rendered button markup. This runs against the real source, not a
//     copy of the logic, so it can't drift out of sync silently.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

// ── PART A — DB-level (documented, live-verified via Supabase MCP) ──
//
// A1. Gf pasta (id=295), qty=25, unit='pz' → { ok:true, qty_native:25,
//     task_unit:'porzioni' }. prep_log row created (qty=25 unit='pz'
//     prep_task_id=295). prep_tasks.in_progress -> false, current_stock
//     += 25. [VERIFIED 2026-08-18]
//
// A2. Same task, unit='g', qty=1500 (the exact reported bug input) →
//     { ok:false, error:'unit_conversion_unsupported', from:'g',
//     to:'porzioni' }. No prep_log row inserted, no stock change.
//     [VERIFIED — this must stay failing: no safe g<->porzioni
//     conversion exists]
//
// A3. Retry idempotency: two calls with the SAME client_key on a
//     disposable porzioni-unit fixture task → first call { ok:true,
//     duplicate_skipped:false, log_id:X }, second call { ok:true,
//     duplicate_skipped:true, log_id:X } (same id), stock incremented
//     exactly once. [VERIFIED]
//
// A4. Squeezer-class regression (Check Balsamic Dressing, id=396),
//     qty=3, unit='pz' → { ok:true, task_unit:'squeezer' }. Confirms
//     the fix covers the whole affected class (porzioni/batch/
//     squeezer), not just the reported item. [VERIFIED]
//
// A5. Non-regression — suggestedSave sends the task's own unit
//     literally (never normalised to 'pz'). unit='porzioni' on a
//     porzioni task → succeeds via the pre-existing direct-equality
//     branch, untouched by this fix. [VERIFIED]
//
// A6. Non-regression — units outside the alias set: 'nests' task
//     (Fettucine fresh pasta, id=474) with unit='nests', and a 'g'
//     task (Demi, id=291) with unit='kg' (kg->g conversion), both
//     still succeed exactly as before. [VERIFIED]
//
// A7. Cap enforcement unaffected: qty=600 unit='pz' on a porzioni
//     fixture (cap 500 for the pz bucket) → still { ok:false,
//     error:'qty_exceeds_maximum', max:500 }. [VERIFIED]

// ── PART B — frontend structural regression guard ──────────────────
const PREP_JS = path.join(__dirname, '..', 'js', 'prep.js');

function extractBtnGridExpr(src) {
  const start = src.indexOf('const btnGrid = defaultNative');
  const end = src.indexOf('  const _inputmode', start);
  if (start < 0 || end < 0) throw new Error('btnGrid block not found in js/prep.js — has openDoneSheetCustom changed shape?');
  const stmt = src.slice(start, end);
  const exprStart = stmt.indexOf('=') + 1;
  let expr = stmt.slice(exprStart);
  const termIdx = expr.lastIndexOf('`;'); // terminating close-template + semicolon
  if (termIdx < 0) throw new Error('terminating `; not found in btnGrid expr');
  return expr.slice(0, termIdx + 1).trim(); // keep closing backtick, drop the ';'
}

function evalBtnGrid({ defaultNative, _autoKg, defaultPezzi, taskUnit, itId, nativeLabel }) {
  const src = fs.readFileSync(PREP_JS, 'utf8');
  const expr = extractBtnGridExpr(src);
  const fn = new Function('defaultNative', '_autoKg', 'defaultPezzi', 'taskUnit', 'nativeLabel', 'it', 'tr',
    'return (' + expr + ');'
  );
  const tr = (k) => ({ prep_grams: 'Grams', prep_pieces: 'Pieces' }[k] || k);
  return fn(defaultNative, _autoKg, defaultPezzi, taskUnit, nativeLabel, { id: itId }, tr);
}

test('WHOLE_UNITS still classifies porzioni/batch/squeezer as count-based', () => {
  const src = fs.readFileSync(PREP_JS, 'utf8');
  const m = src.match(/const WHOLE_UNITS\s*=\s*\[([^\]]+)\]/);
  assert.ok(m, 'WHOLE_UNITS array not found in js/prep.js');
  ['porzioni', 'batch', 'squeezer', 'pezzi', 'pz'].forEach(u => {
    assert.ok(m[1].includes(`'${u}'`), `WHOLE_UNITS missing '${u}'`);
  });
});

test('Count-based task (porzioni): Done-sheet offers Pieces only, no Grams', () => {
  const html = evalBtnGrid({ defaultNative: false, _autoKg: false, defaultPezzi: true, taskUnit: 'porzioni', itId: '295', nativeLabel: '' });
  assert.ok(!html.includes('dsc-btn-g-'), 'Grams button still offered for a porzioni (count-based) task — regression of the fix');
  assert.ok(html.includes('dsc-btn-pz-'), 'Pieces button missing for a porzioni task');
});

test('Native-unit task (nests): Done-sheet still offers Grams + native + Pieces (unchanged)', () => {
  const html = evalBtnGrid({ defaultNative: true, _autoKg: false, defaultPezzi: false, taskUnit: 'nests', itId: '474', nativeLabel: 'Nests' });
  assert.ok(html.includes('dsc-btn-g-'), 'Grams button missing for a native-unit (nests) task — should be unchanged');
  assert.ok(html.includes('dsc-btn-native-'), 'Native unit button missing');
  assert.ok(html.includes('dsc-btn-pz-'), 'Pieces button missing');
});

test('Plain gram task (g): Done-sheet still offers Grams + Pieces (unchanged)', () => {
  const html = evalBtnGrid({ defaultNative: false, _autoKg: false, defaultPezzi: false, taskUnit: 'g', itId: '291', nativeLabel: '' });
  assert.ok(html.includes('dsc-btn-g-'), 'Grams button missing for a plain g-unit task — should be unchanged');
  assert.ok(html.includes('dsc-btn-pz-'), 'Pieces button missing');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
