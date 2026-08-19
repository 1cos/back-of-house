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
//
// ── Gf pasta canonical-unit migration (2026-08-18) ──────────────────
// Read-only audit found prep_tasks.id=295 (Gf pasta) had unit='porzioni'
// configured, but 8 of 9 historical prep_log entries were logged in
// kg/g by kitchen staff, and no recipe/BOM/ingredient/POS-depletion
// row references this task at all — prep_tasks.unit was the only, and
// wrong, source of truth. Migration fix_gf_pasta_canonical_unit_g
// changed ONLY prep_tasks.id=295.unit: 'porzioni' -> 'g'. current_stock
// (1997) was deliberately left untouched — its historical accumulation
// mixes raw kg/g/porzioni values without conversion, so it cannot be
// reliably rebaselined here; a separate operational decision is needed
// for that cleanup. No other prep_task (Rinse Clams/Mussels, berries,
// dressings, Orange supreme, or any other porzioni/batch/squeezer task)
// was touched.
//
// A8. Gf pasta (id=295) with unit now 'g': qty=1500, unit='g' →
//     { ok:true, qty_native:1500, task_unit:'g' }. No
//     unit_conversion_unsupported. prep_log row created (qty=1500
//     unit='g'). prep_tasks.in_progress -> false. [VERIFIED 2026-08-18]
//
// A9. Retry idempotency on the same call (same client_key) → { ok:true,
//     duplicate_skipped:true }, same log_id, stock unchanged on the
//     second call. [VERIFIED]
//
// A10. Unit normalization: 1 kg on Gf pasta → qty_native:1000 (kg->g
//      conversion branch, pre-existing and untouched by this fix).
//      [VERIFIED]
//
// A11. Regressions: (a) cap for 'g' unaffected — qty=50001 still
//      { ok:false, error:'qty_exceeds_maximum', max:50000 }; (b) the
//      v782 alias fix still works for genuine count-based tasks —
//      Rinse Clams (id=289, unit='porzioni', untouched by this
//      migration) with qty=3 unit='pz' still → { ok:true,
//      task_unit:'porzioni' }. [VERIFIED — all test-generated rows
//      deleted and current_stock/in_progress restored on 295 and 289
//      after verification; zero residue confirmed]
//
// ── High-confidence mass-unit migration (2026-08-18, follow-up) ─────
// Same pattern as Gf pasta, applied to the 3 tasks with unanimous
// mass-based history: Rinse Clams (id=289, 11/11 manual entries in
// g/kg), Rinse Mussels (id=299, 8/8 in g/kg), Refill Blackberries
// (id=328, 3/3 in g). Migration fix_high_confidence_mass_prep_units
// changed ONLY these 3 rows' unit: 'porzioni' -> 'g', each statement
// guarded on id + name + previous value (never a blanket
// WHERE unit='porzioni'). current_stock left untouched on all three
// (same contaminated-history rationale as Gf pasta). Orange supreme
// (id=250), Refill Blueberry/Raspberry (330/360), all 4 Check
// dressings (393-396), and the Rinse Clams/Mussels orphan rows
// (462/463) were verified unchanged before and after.
//
// A12. Rinse Clams (id=289) now unit='g': qty=1000 unit='g' →
//      { ok:true, qty_native:1000, task_unit:'g' }. Retry same
//      client_key → duplicate_skipped:true, same log_id, stock
//      unchanged. Failure case (unit='nests', unsupported) →
//      { ok:false, error:'unit_conversion_unsupported' }, zero rows
//      written, stock unchanged. [VERIFIED]
//
// A13. Rinse Mussels (id=299) now unit='g': qty=1 unit='kg' →
//      { ok:true, qty_native:1000, task_unit:'g' } (kg->g conversion,
//      pre-existing, unaffected). [VERIFIED]
//
// A14. Refill Blackberries (id=328) now unit='g': qty=250 unit='g' →
//      { ok:true, qty_native:250, task_unit:'g' }. Cap unaffected on
//      this task: qty=50001 unit='g' → { ok:false,
//      error:'qty_exceeds_maximum', max:50000 }. [VERIFIED]
//
// A15. Regression — Orange supreme (id=250, unit='porzioni', NOT part
//      of this migration) with qty=5 unit='pz' still → { ok:true,
//      task_unit:'porzioni' }: the v782 fix and the still-count-based
//      tasks are both unaffected by this migration. [VERIFIED]
//
// A16. Out-of-scope verification: 250, 330, 360, 393, 394, 395, 396,
//      462, 463 all confirmed unchanged (unit identical before/after);
//      295 confirmed still 'g' from the prior migration. All
//      test-generated prep_log rows (four) deleted and
//      current_stock/in_progress restored to their exact pre-test
//      snapshot on 289, 299, 328, 250 afterward; zero residue
//      confirmed. [VERIFIED]
//
// ── Dressing "Check" tasks canonical-unit migration (2026-08-19) ────
// Same pattern as Gf pasta and the 3 mass-based checklist tasks,
// applied to the 4 dressing tasks: Check Citronnette (393), Check
// Ranch (394), Check Caesar (395), Check Balsamic Dressing (396). All
// had unit='squeezer' configured, but 'squeezer' has no defined
// capacity or conversion anywhere in the system (not in js/prep.js
// WHOLE_UNITS, not in js/unit-normalizer.js STATIC_CONVERSIONS, not in
// the live unit_conversion_table -- 0 of 26 rows). Historical manual
// entries were almost entirely g/kg, never squeezer. Independent
// converging evidence: the matching recipes (CITRONETTE, Ranch
// Dressing, BALSAMIC VINAIGRETTE) store base_weight_g/serving_unit='g';
// the matching ingredients (Caesar Dressing, Citronette, Ranch,
// Balsamic Vinaigrette) all have base_unit='g'; and the active
// pos_modifier_depletion_rules for all 4 modifiers use
// normalized_qty_g=59.147 (2 fl oz ramekin, confirmed by Max
// 2026-07-08). Migration fix_dressing_check_tasks_canonical_unit_g
// changed ONLY these 4 rows' unit: 'squeezer' -> 'g', each statement
// guarded on id + name + previous value. current_stock, prep_type,
// daily_reset, recipe_id and the (deliberately still unlinked)
// pos_modifier_depletion_rules were all left untouched -- checklist
// semantics and recipe/depletion linkage are explicitly out of scope
// for this task.
//
// A17. Check Citronnette (id=393) now unit='g': qty=500 unit='g' →
//      { ok:true, qty_native:500, task_unit:'g' }. Retry same
//      client_key → duplicate_skipped:true, same log_id, stock
//      unchanged. Failure case (unit='nests', unsupported) →
//      { ok:false, error:'unit_conversion_unsupported' }, zero rows
//      written, stock/in_progress unchanged. [VERIFIED 2026-08-19]
//
// A18. Check Ranch (id=394) now unit='g': qty=1 unit='kg' →
//      { ok:true, qty_native:1000, task_unit:'g' } (kg->g conversion,
//      pre-existing, unaffected). [VERIFIED]
//
// A19. Check Caesar (id=395) now unit='g': qty=250 unit='g' →
//      { ok:true, qty_native:250, task_unit:'g' }. Cap unaffected:
//      qty=50001 unit='g' → { ok:false, error:'qty_exceeds_maximum',
//      max:50000 }. [VERIFIED]
//
// A20. Check Balsamic Dressing (id=396) now unit='g': qty=750
//      unit='g' → { ok:true, qty_native:750, task_unit:'g' }.
//      [VERIFIED]
//
// A21. Regression — Orange supreme (id=250, unit='porzioni', NOT part
//      of this migration) with qty=4 unit='pz' still → { ok:true,
//      task_unit:'porzioni' }: v782 unaffected. [VERIFIED]
//
// A22. Out-of-scope verification: 295, 289, 299, 328 (previously fixed
//      to 'g'), 250, 330, 360 (still 'porzioni'), 462/463 (still NULL)
//      all confirmed unchanged before/after. pos_modifier_depletion_rules
//      for all 4 dressing modifiers confirmed unchanged
//      (active=true, usage_mode='fixed_quantity',
//      normalized_qty_g≈59.147, linked_prep_task_id=NULL). All five
//      test-generated prep_log rows deleted and current_stock/
//      in_progress restored to their exact pre-test snapshot on
//      393, 394, 395, 396, 250 afterward; zero residue confirmed.
//      [VERIFIED]

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
