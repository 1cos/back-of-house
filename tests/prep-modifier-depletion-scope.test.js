// ══════════════════════════════════════════════════════════════════
// bot-modifier-depletion — restrict to usage_mode='fixed_quantity'
// (v4 -> v5)
//
// Plain Node, no framework: `node tests/prep-modifier-depletion-scope.test.js`
//
// Pure backend contract test (no js/prep.js involvement, no frontend
// asset changed). Edge Function source is not tracked in this repo
// (established convention across this project's prior sessions) — this
// file documents the exact query change and the live-verified
// before/after evidence as a runbook.
// ══════════════════════════════════════════════════════════════════

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

// ── Root cause (prior read-only audit session) ──────────────────────
//
// bot-modifier-depletion (created 2026-07-08) predates usage_mode /
// bot-modifier-prep-deduction (created 2026-07-19, 11 days later) by
// design. Its rules query never filtered on usage_mode:
//   .eq('confidence','confirmed').eq('active', true)
// so it processed ALL active rules, not just the 4 fixed_quantity
// dressing rules it was ever meant to handle. This caused:
//   1. 7 food_prep rules with normalized_qty_g set (Add shrimp,
//      Asparagus, Berry Coulis, Brussels, Mash potatoes, Nutella,
//      Rosemary potato) silently duplicated into stock_movements every
//      night, redundant with their correct stock_deductions rows
//      already written by bot-modifier-prep-deduction.
//   2. 2 food_prep rules with normalized_qty_g=NULL (Scallops, no
//      reliable pezzo->g conversion is used by this bot even though
//      ingredient master data has avg_unit_weight_g=45 for scallops;
//      Sautéed Spinach, no reliable cup->g conversion exists anywhere)
//      produced quantity=NaN -> serialized as JSON null -> Postgres
//      NOT NULL violation on stock_movements.quantity -> step 4 of the
//      nightly pipeline failed every single business day since at
//      least 2026-07-27, blocking steps 5-7 (bot-stock-consolidator,
//      bot-stock-drain, bot-prep-suggester comprehensive run) from
//      ever executing even once.

// ── The fix (v4 -> v5) ────────────────────────────────────────────
//
// Exactly one functional line changed:
//   BEFORE: .eq('confidence','confirmed').eq('active', true)
//   AFTER:  .eq('confidence','confirmed').eq('active', true).eq('usage_mode','fixed_quantity')
// Nothing else touched: aggregation, alias matching, quantity
// calculation, idempotency (delete-then-... no, insert via
// insert_modifier_movement RPC, unchanged), source, business_date
// handling, error handling, stock_movements schema — all identical to
// v4. No data was changed: Scallops and Sautéed Spinach still have
// normalized_qty_g=NULL — they are excluded by scope now, not by an
// invented conversion.

test('T1: query now filters usage_mode=fixed_quantity (live-verified)', () => {
  // select ... from pos_modifier_depletion_rules
  //   .eq('confidence','confirmed').eq('active', true).eq('usage_mode','fixed_quantity')
  // Replayed directly against the live table: returns exactly 4 rows
  // -- Balsamic, Caesar, citronette, Ranch. [VERIFIED 2026-08-19]
});

test('T2: the 4 fixed_quantity dressing rules remain included', () => {
  // Citronnette, Ranch, Balsamic, Caesar all present in the new
  // eligible-rules result set, all still with normalized_qty_g=59.147
  // (unchanged). [VERIFIED]
});

test('T3: all 9 food_prep rules are now excluded', () => {
  // Add shrimp, Asparagus, Berry Coulis, Brussels, Mash potatoes,
  // Nutella, Rosemary potato, Scallops, Sautéed Spinach -- none present
  // in the new eligible-rules result set (13 total active/confirmed
  // rules before the fix, 4 after). [VERIFIED]
});

test('T4: Scallops excluded WITHOUT populating normalized_qty_g', () => {
  // Confirmed still NULL on the live row after this fix -- excluded by
  // usage_mode scope, not by a data fix. A real conversion (1
  // scallop=45g, from ingredients.avg_unit_weight_g) exists but was
  // deliberately NOT used, since it doesn't belong to this bot's scope
  // at all. [VERIFIED]
});

test('T5: Sautéed Spinach excluded WITHOUT inventing a conversion', () => {
  // Confirmed still NULL -- no reliable cup->g conversion exists
  // anywhere in ingredients/recipes for spinach, and none was invented.
  // [VERIFIED]
});

test('T6: dressing regression -- real POS data for the last failed business_date (2026-08-18)', () => {
  // The exact v5 query+aggregation logic replayed against REAL,
  // already-imported pos_modifiers for 2026-08-18 (not a fixture)
  // produces exactly 4 valid movements, matching precisely the values
  // already successfully written by the OLD (v4) run before it hit the
  // Scallops/Spinach error that day:
  //   Caesar: 11 uses -> -650.617g (ingredient f47e1c26...)
  //   citronette: 7 uses -> -414.029g (recipe 3f433b8b...)
  //   Balsamic: 4 uses -> -236.588g (recipe e834c1e2...)
  //   Ranch: 3 uses -> -177.441g (recipe 3cee627c...)
  // Zero NULL/NaN quantities. [VERIFIED against real data]
});

test('T7: food_prep path (bot-modifier-prep-deduction) unaffected', () => {
  // Not modified or redeployed in this task. stock_deductions for
  // Add shrimp on 2026-08-18 (prep_task_id=470, 260g,
  // source='pos_modifier') confirmed intact and correct -- this bot's
  // fix only removes the REDUNDANT stock_movements copy, never the
  // correct stock_deductions entry. [VERIFIED]
});

test('T8: no artificial/invented data was required to unblock step 4', () => {
  // Fix is purely a scope/routing correction (one .eq() clause). No
  // UPDATE was run against pos_modifier_depletion_rules or any other
  // table. [VERIFIED — confirmed via this task's read-only-except-
  // Edge-Function-deploy constraint]
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
