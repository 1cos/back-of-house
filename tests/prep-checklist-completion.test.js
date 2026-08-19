// ══════════════════════════════════════════════════════════════════
// Checklist-only completion (prep_tasks.completion_mode)
// Plain Node, no framework: `node tests/prep-checklist-completion.test.js`
//
// Scope note (same split as tests/prep-production-unit-fix.test.js):
//   PART A — DB-level: run directly against Supabase via the Supabase
//     MCP (execute_sql) against the REAL RPCs, no bypass. Already
//     executed live for this feature; results reproduced below as a
//     runbook — re-paste into Supabase to re-verify after any future
//     change to record_prep_checklist_completion / record_prep_production.
//   PART B — Frontend routing guard: extracts the REAL
//     `window.prepDone` function body out of the live js/prep.js
//     source and evaluates it with mocked tasks/checklistComplete/
//     openDoneSheet, asserting on which real path gets called for a
//     completion_mode='checklist' task vs a 'quantity' task. Runs
//     against the real source, not a reimplementation.
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
// Background: audit (prior session) established 393-396 (Check
// Citronnette/Ranch/Caesar/Balsamic Dressing) represent a daily line
// check/refill, not a production event, and that their production
// siblings (389 Citronnette, 390 Ranch, 392 Balsamic Dressing —
// prep_type='supporto', recipe-linked) already exist separately.
// Caesar (395) has no production sibling by design (purchased, not
// made in-house).
//
// prep_tasks.completion_mode ('quantity' default | 'checklist') was
// added to represent this in data, not in frontend hardcoded
// id/name checks. Migration
// add_completion_mode_and_checklist_completion_rpc set
// completion_mode='checklist' on exactly 393/394/395/396, guarded on
// id+name+previous value. Every other prep_task (including
// 389/390/392) kept the 'quantity' default untouched.
//
// New RPC record_prep_checklist_completion: no quantity/unit input,
// refuses to run unless completion_mode='checklist' (defense in
// depth against misuse on a production task), writes a prep_log row
// with qty=NULL unit='checklist_done' (honest "no quantity" event —
// not a placeholder 0g/1pz), and updates only in_progress/
// need_tomorrow/suggested_* on prep_tasks — current_stock is never
// touched by this RPC.
//
// A23. Check Citronnette (id=393): record_prep_checklist_completion
//      → { ok:true, log_id:X, current_stock:743 (unchanged) }.
//      prep_log row: qty=NULL, unit='checklist_done'. prep_tasks:
//      in_progress -> false, current_stock still 743. Retry same
//      client_key → { ok:true, duplicate_skipped:true }, same
//      log_id. [VERIFIED 2026-08-19]
//
// A24. Check Ranch (394), Check Caesar (395), Check Balsamic
//      Dressing (396): same RPC, same result shape — all three
//      complete successfully, qty=NULL/unit='checklist_done' logged,
//      current_stock unchanged (1070/1070/1072 respectively).
//      [VERIFIED]
//
// A25. Guard, direction 1: record_prep_checklist_completion(389, ...)
//      — a real production task (completion_mode='quantity') →
//      { ok:false, error:'not_a_checklist_task', completion_mode:
//      'quantity' }. No prep_log row, no state change. [VERIFIED]
//
// A26. Guard, direction 2 / production regression: 389 Citronnette
//      still opens the normal quantity flow — record_prep_production
//      (389, 500, 'g', ...) → { ok:true, qty_native:500,
//      new_stock:1934.265 } (1434.265 + 500). Confirms the quantity
//      RPC is completely untouched by this change. [VERIFIED]
//
// A27. No Need remains architecturally separate: window.noNeed()
//      writes directly via the Supabase client (qty=0, unit='no_need')
//      and does not call record_prep_checklist_completion or
//      record_prep_production at all — untouched by this feature,
//      verified by inspection of the live source (no diff to
//      window.noNeed in this change). Done (qty=NULL,
//      unit='checklist_done') and No Need (qty=0, unit='no_need')
//      remain two distinct, never-merged events.
//
// A28. Cleanup: all five test-generated prep_log rows deleted,
//      current_stock/in_progress restored to their exact pre-test
//      snapshot on 393/394/395/396/389 afterward. Out-of-scope tasks
//      (390, 392, and every other prep_task) confirmed still
//      completion_mode='quantity' (default, untouched). Zero residue
//      confirmed. [VERIFIED]

// ── PART B — frontend routing guard ─────────────────────────────────
const PREP_JS = path.join(__dirname, '..', 'js', 'prep.js');

function extractPrepDoneFn(src) {
  const start = src.indexOf('window.prepDone = function(id){');
  if (start < 0) throw new Error('window.prepDone not found in js/prep.js — has it moved/changed shape?');
  const end = src.indexOf('};', start) + 2;
  return src.slice(start, end);
}

function runPrepDone(taskState) {
  const src = fs.readFileSync(PREP_JS, 'utf8');
  const fnSrc = extractPrepDoneFn(src);
  const calls = { checklistComplete: null, openDoneSheet: null };
  const build = new Function('tasksArg', 'checklistCompleteArg', 'openDoneSheetArg',
    'const tasks = tasksArg;\n' +
    'const checklistComplete = checklistCompleteArg;\n' +
    'const openDoneSheet = openDoneSheetArg;\n' +
    'window = {};\n' + fnSrc + '\nreturn window.prepDone;'
  );
  const prepDone = build(
    { 42: taskState },
    (id) => { calls.checklistComplete = id; },
    (id) => { calls.openDoneSheet = id; }
  );
  prepDone(42);
  return calls;
}

test('completion_mode=checklist task routes to checklistComplete, not the quantity sheet', () => {
  const calls = runPrepDone({ id: 42, completion_mode: 'checklist' });
  assert.strictEqual(calls.checklistComplete, 42, 'checklistComplete was not called for a checklist-mode task');
  assert.strictEqual(calls.openDoneSheet, null, 'openDoneSheet (quantity sheet) was incorrectly opened for a checklist-mode task');
});

test('completion_mode=quantity task still routes to openDoneSheet (production regression)', () => {
  const calls = runPrepDone({ id: 42, completion_mode: 'quantity' });
  assert.strictEqual(calls.openDoneSheet, 42, 'openDoneSheet was not called for a quantity-mode (production) task');
  assert.strictEqual(calls.checklistComplete, null, 'checklistComplete was incorrectly called for a quantity-mode task');
});

test('task with no completion_mode field (legacy/undefined) defaults to the quantity sheet', () => {
  // Every existing task besides 393-396 has completion_mode='quantity' from
  // the column default, but this guards the routing logic itself against
  // any row where the field is somehow absent — same safe fallback.
  const calls = runPrepDone({ id: 42 });
  assert.strictEqual(calls.openDoneSheet, 42);
  assert.strictEqual(calls.checklistComplete, null);
});

test('routing is data-driven (completion_mode), not an id or name check', () => {
  const src = fs.readFileSync(PREP_JS, 'utf8');
  const fnSrc = extractPrepDoneFn(src);
  assert.ok(!/39[3-6]/.test(fnSrc), 'prepDone routing must not hardcode task ids 393-396');
  assert.ok(!fnSrc.includes('Check '), 'prepDone routing must not hardcode a task-name prefix');
  assert.ok(fnSrc.includes('completion_mode'), 'prepDone routing must read completion_mode from the task');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
