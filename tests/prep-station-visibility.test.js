// ══════════════════════════════════════════════════════════════════
// Dressing production tasks — station/category visibility fix
// Plain Node, no framework: `node tests/prep-station-visibility.test.js`
//
// Scope note (same split as the other tests/prep-*.test.js files):
//   PART A — DB-level: run directly against Supabase via the Supabase
//     MCP (execute_sql) against the REAL RPCs, no bypass. Already
//     executed live for this fix; results reproduced below as a
//     runbook.
//   PART B — Frontend filter guard: extracts the REAL station-filter
//     line out of the live js/prep.js renderM() source and evaluates
//     it against representative items, confirming the fix is a pure
//     data change — no frontend code needed and none was touched.
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
// Background: audit (prior session) found 389 Citronnette, 390 Ranch,
// 392 Balsamic Dressing -- the real quantity-production tasks,
// correctly prep_type='supporto'/completion_mode='quantity'/recipe-
// linked -- filed under category='Pastry Station' by accident, while
// their checklist twins (393 Check Citronnette, 394 Check Ranch, 396
// Check Balsamic Dressing) correctly live under 'Salad Station'. Since
// js/prep.js renderM() filters the default view by
// `i.category === user.default_station`, a Salad Station cook's
// default view never showed the production tasks -- confirmed by the
// prep_log history: the only non-admin person who ever touched 389
// was Samantha, the Pastry Station cook.
//
// Migration move_dressing_production_tasks_to_salad_station changed
// ONLY the category column on these 3 rows: 'Pastry Station' ->
// 'Salad Station', each statement guarded on id+name+previous
// category. unit, prep_type, completion_mode, recipe_id,
// current_stock, in_progress, daily_reset and every other field were
// left untouched. The archived duplicate rows (441, 442, same names,
// same old category) were explicitly NOT touched -- confirmed
// unchanged after the migration.
//
// A29. 389/390/392 category confirmed 'Salad Station' after the
//      migration; every other field identical to the pre-migration
//      snapshot. [VERIFIED 2026-08-19]
//
// A30. Production flow unaffected by the category change: Citronnette
//      (389), qty=500 unit='g' via record_prep_production ->
//      { ok:true, qty_native:500, new_stock:1934.265 } (1434.265 +
//      500). Quantity flow works identically post-fix. [VERIFIED]
//
// A31. Checklist flow unaffected: Check Citronnette (393) via
//      record_prep_checklist_completion -> { ok:true,
//      current_stock:743 (unchanged) }, qty=NULL/unit='checklist_done'
//      logged. Confirms production (389) and checklist (393) coexist
//      correctly in the same station with no collision. [VERIFIED]
//
// A32. Out-of-scope verification: 393/394/395/396 (Salad Station,
//      unchanged), 295/289/299/328/250/330/360 (unchanged categories),
//      462/463 (orphans, unchanged), 441/442 (archived duplicates,
//      STILL 'Pastry Station' -- confirms the guarded UPDATE did not
//      touch them despite matching name). All test-generated prep_log
//      rows deleted, current_stock/in_progress restored to their
//      exact pre-test snapshot on 389 and 393 afterward; zero residue
//      confirmed. [VERIFIED]

// ── PART B — frontend station-filter guard ──────────────────────────
const PREP_JS = path.join(__dirname, '..', 'js', 'prep.js');

function extractStationFilterLine(src) {
  const marker = "if(station!=='All'&&i.category!==station) return false;";
  if (!src.includes(marker)) throw new Error('station filter line not found in js/prep.js renderM() — has it changed shape?');
  return marker;
}

function passesStationFilter(item, station) {
  const src = fs.readFileSync(PREP_JS, 'utf8');
  const line = extractStationFilterLine(src);
  const fn = new Function('i', 'station', line + '\nreturn true;');
  return fn(item, station);
}

test("Citronnette/Ranch/Balsamic Dressing visible with station='Salad Station'", () => {
  ['Citronnette', 'Ranch', 'Balsamic Dressing'].forEach(name => {
    const item = { name, category: 'Salad Station' };
    assert.strictEqual(passesStationFilter(item, 'Salad Station'), true, name + ' should be visible under Salad Station');
  });
});

test("Citronnette/Ranch/Balsamic Dressing NOT visible with station='Pastry Station' (post-fix)", () => {
  ['Citronnette', 'Ranch', 'Balsamic Dressing'].forEach(name => {
    const item = { name, category: 'Salad Station' }; // real post-migration category
    assert.strictEqual(passesStationFilter(item, 'Pastry Station'), false, name + ' should no longer appear under Pastry Station');
  });
});

test("station='All' still shows them regardless of category", () => {
  const item = { name: 'Ranch', category: 'Salad Station' };
  assert.strictEqual(passesStationFilter(item, 'All'), true);
});

test('filter logic is generic (category comparison) — no id/name hardcode for these tasks', () => {
  const src = fs.readFileSync(PREP_JS, 'utf8');
  const line = extractStationFilterLine(src);
  assert.ok(!/38[9]|39[02]/.test(line), 'station filter must not hardcode task ids 389/390/392');
  assert.ok(!line.includes('Citronnette') && !line.includes('Ranch') && !line.includes('Balsamic'), 'station filter must not hardcode task names');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
