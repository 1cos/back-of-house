// workspace/js/production-lab-shadow-engine.js
// ──────────────────────────────────────────────────────────────────────────────
// PURE FUNCTION MODULE — no Supabase, no DOM, no side effects.
// Input: structured data from production-lab-data.js
// Output: shadow calculation result object
//
// Responsibility:
//   Given modifier counts + BOM quantity per use → compute shadow demand.
//   Compare with BOH suggestion if an equivalent value is available.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Calculate shadow demand for Add Chicken.
 *
 * The BOH uses stock_deductions (historical drain) with a dow_match forecast.
 * Its `forecast` is a multi-day historical average (g/day across matching weekdays).
 * Its `planned_output` is production needed after accounting for current stock.
 * Neither is directly equivalent to a single-date raw modifier count × BOM qty.
 *
 * Therefore: comparison result is NOT_COMPARABLE with documented reason.
 *
 * @param {object} input
 * @param {string}  input.businessDate        — 'YYYY-MM-DD' date of POS data used
 * @param {Array}   input.modifierRows        — [{modifier, quantity_sold}] for that date
 * @param {Array}   input.recipeAliases       — alias strings from recipes.pos_name (pipe-split)
 * @param {number}  input.bomQtyPerUse        — grams from recipe_bom for Diced Grilled Chicken
 * @param {string}  input.bomUnit             — unit of bomQtyPerUse (expected 'g')
 * @param {object|null} input.suggestion      — latest prep_suggestions_daily row or null
 *
 * @returns {ShadowResult}
 */
export function calculateAddChickenShadow(input) {
  const {
    businessDate,
    modifierRows,
    recipeAliases,
    bomQtyPerUse,
    bomUnit,
    suggestion,
  } = input;

  // ── 1. Normalize alias set (lowercase) ─────────────────────────────────────
  const aliasSet = new Set(
    (recipeAliases ?? []).map(a => a.trim().toLowerCase())
  );

  // ── 2. Sum modifier uses for matching aliases only ─────────────────────────
  let totalUses   = 0;
  const matchedRows   = [];
  const unmatchedRows = [];

  for (const row of (modifierRows ?? [])) {
    const modKey = (row.modifier ?? '').trim().toLowerCase();
    if (aliasSet.has(modKey)) {
      totalUses += Number(row.quantity_sold ?? 0);
      matchedRows.push({ modifier: row.modifier, qty: Number(row.quantity_sold ?? 0) });
    } else {
      unmatchedRows.push({ modifier: row.modifier, qty: Number(row.quantity_sold ?? 0) });
    }
  }

  // ── 3. Validate BOM quantity ────────────────────────────────────────────────
  const bomQty = Number(bomQtyPerUse ?? 0);
  if (bomQty <= 0 || bomUnit !== 'g') {
    return {
      ok: false,
      error: `Unexpected BOM unit or zero qty: ${bomQtyPerUse} ${bomUnit}`,
    };
  }

  // ── 4. Shadow demand ────────────────────────────────────────────────────────
  const shadowDemandG = totalUses * bomQty;

  // ── 5. Comparison with BOH ─────────────────────────────────────────────────
  // The BOH `forecast` = multi-day historical avg (dow_match, 3 Mondays).
  // The BOH `planned_output` = net production needed after stock deduction.
  // Our shadow = single-date raw modifier × BOM.
  // These are structurally different values — NOT directly comparable.
  const comparableValue = null;
  const comparableLabel = 'NOT_COMPARABLE';
  const comparableReason = suggestion
    ? `BOH uses stock_deductions/dow_match historical average (${suggestion.demand_source ?? '?'}), not raw modifier counts. Shadow is single-date. Values are structurally different.`
    : 'No BOH suggestion available.';

  // We CAN show the BOH forecast for reference, clearly labelled.
  const bohForecast = suggestion?.forecast != null
    ? { value: Number(suggestion.forecast), unit: suggestion.forecast_unit ?? 'g' }
    : null;

  const bohPlannedOutput = suggestion?.planned_output != null
    ? { value: Number(suggestion.planned_output), unit: suggestion.output_unit ?? 'g' }
    : null;

  // ── 6. Explanation string ───────────────────────────────────────────────────
  const explanation =
    `${totalUses} Add Chicken modifier${totalUses !== 1 ? 's' : ''} × ${bomQty}${bomUnit} = ${shadowDemandG}${bomUnit} Diced Grilled Chicken demand.`;

  // ── 7. Trace path ───────────────────────────────────────────────────────────
  const tracePath = [
    `pos_modifiers.modifier IN [${[...aliasSet].map(a => `'${a}'`).join(', ')}]`,
    `→ recipe 'add chicken' (id: 259864df)`,
    `→ recipe_bom: Diced Grilled Chicken ${bomQty}${bomUnit}/use`,
    `→ demand: ${totalUses} × ${bomQty}${bomUnit} = ${shadowDemandG}${bomUnit}`,
  ];

  return {
    ok:              true,
    businessDate,
    totalUses,
    matchedRows,
    unmatchedRows,
    bomQtyPerUse:    bomQty,
    bomUnit,
    shadowDemandG,
    shadowDemandLabel: `${shadowDemandG}g`,
    comparableValue,
    comparableLabel,
    comparableReason,
    bohForecast,
    bohPlannedOutput,
    explanation,
    tracePath,
  };
}


/**
 * Calculate a matching-DOW BOM-first forecast.
 * Pure function — no DB access, no DOM, no side effects.
 *
 * Uses the exact same logic as the BOH dow_match path:
 *   1. Filter sample rows to those matching the target DOW.
 *   2. Multiply each day's modifier uses × bomQtyPerUse → daily BOM demand.
 *   3. Average the daily BOM demands.
 *
 * @param {object} input
 * @param {string}  input.targetDate          — 'YYYY-MM-DD' business date being forecast
 * @param {number}  input.targetDow           — JS getDay() value (0=Sun…6=Sat)
 * @param {Array}   input.sampleRows          — [{date, modifier, quantity_sold, aliases}]
 *                                              Each row is ONE modifier on ONE date.
 * @param {string[]} input.recipeAliases      — lowercase alias set for matching
 * @param {number}  input.bomQtyPerUse        — grams per modifier use
 * @param {string}  input.bomUnit             — 'g'
 * @param {number}  input.bohForecastG        — BOH dow_avg value for this DOW (g)
 * @param {number}  input.bohSampleCount      — how many samples BOH used
 *
 * @returns {DowForecastResult}
 */
export function calculateMatchingDowForecast(input) {
  const {
    targetDate,
    targetDow,
    sampleRows,
    recipeAliases,
    bomQtyPerUse,
    bomUnit,
    bohForecastG,
    bohSampleCount,
  } = input;

  const aliasSet = new Set((recipeAliases ?? []).map(a => a.trim().toLowerCase()));
  const bomQty   = Number(bomQtyPerUse ?? 0);

  if (bomQty <= 0 || bomUnit !== 'g') {
    return { ok: false, error: `Bad BOM qty: ${bomQtyPerUse} ${bomUnit}` };
  }

  // ── 1. Group rows by date, sum matched modifier uses ─────────────────────
  const byDate = {};  // date → { uses, rowDetails }
  for (const row of (sampleRows ?? [])) {
    const modKey = (row.modifier ?? '').trim().toLowerCase();
    if (!aliasSet.has(modKey)) continue;  // only matched aliases
    const d = row.date;
    if (!byDate[d]) byDate[d] = { uses: 0, rowDetails: [] };
    byDate[d].uses += Number(row.quantity_sold ?? 0);
    byDate[d].rowDetails.push({ modifier: row.modifier, qty: Number(row.quantity_sold ?? 0) });
  }

  // ── 2. Build per-date sample array ────────────────────────────────────────
  const samples = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, info]) => ({
      date,
      uses:        info.uses,
      bomDemandG:  info.uses * bomQty,
      rowDetails:  info.rowDetails,
    }));

  if (!samples.length) {
    return { ok: false, error: 'No matching modifier rows for the DOW sample dates' };
  }

  // ── 3. Average ────────────────────────────────────────────────────────────
  const totalDemandG   = samples.reduce((s, r) => s + r.bomDemandG, 0);
  const avgDemandG     = totalDemandG / samples.length;
  // Round to 2dp to match BOH precision
  const avgRounded     = Math.round(avgDemandG * 100) / 100;

  // ── 4. Compare with BOH forecast ─────────────────────────────────────────
  const diff           = avgRounded - Number(bohForecastG ?? 0);
  const absDiff        = Math.abs(diff);
  // Tolerance: ≤1g rounding, or ≤0.1% of bohForecast
  const tolerance      = Math.max(1, Number(bohForecastG ?? 0) * 0.001);
  const isMatch        = absDiff <= tolerance;
  const comparisonStatus = isMatch ? 'MATCH' : 'MISMATCH';

  // ── 5. Mismatch explanation ───────────────────────────────────────────────
  let mismatchReason = null;
  if (!isMatch) {
    const sampleCountDiff = samples.length - Number(bohSampleCount ?? 0);
    if (sampleCountDiff !== 0) {
      mismatchReason = `Sample count differs: BOM-first has ${samples.length} samples, BOH used ${bohSampleCount}.`;
    } else if (absDiff < 5) {
      mismatchReason = `Rounding difference (${diff.toFixed(2)}g). Likely safe.`;
    } else {
      mismatchReason = `Material difference of ${diff.toFixed(2)}g. `
        + `Possible causes: additional deduction sources in stock_deductions beyond direct modifier path, `
        + `unmapped aliases, or excluded status rows.`;
    }
  }

  // ── 6. Trace path ─────────────────────────────────────────────────────────
  const traceDow = [
    `Target: ${targetDate} (DOW ${targetDow})`,
    `Samples (${samples.length}): ${samples.map(s => `${s.date}→${s.uses}×${bomQty}g=${s.bomDemandG}g`).join(', ')}`,
    `BOM-first avg: (${samples.map(s => s.bomDemandG).join('+')}÷${samples.length}) = ${avgRounded}g`,
    `BOH forecast: ${bohForecastG}g`,
    `Diff: ${diff >= 0 ? '+' : ''}${diff.toFixed(2)}g → ${comparisonStatus}`,
  ];

  return {
    ok: true,
    targetDate,
    samples,
    sampleCount:       samples.length,
    totalDemandG,
    avgDemandG:        avgRounded,
    avgLabel:          `${avgRounded}g`,
    bohForecastG:      Number(bohForecastG ?? 0),
    diff,
    comparisonStatus,
    mismatchReason,
    traceDow,
  };
}

/**
 * @typedef {object} DowForecastResult
 * @property {true}    ok
 * @property {string}  targetDate
 * @property {Array}   samples            — [{date, uses, bomDemandG, rowDetails}]
 * @property {number}  sampleCount
 * @property {number}  totalDemandG
 * @property {number}  avgDemandG         — rounded to 2dp
 * @property {string}  avgLabel
 * @property {number}  bohForecastG
 * @property {number}  diff               — avgDemandG − bohForecastG
 * @property {'MATCH'|'MISMATCH'} comparisonStatus
 * @property {string|null} mismatchReason
 * @property {string[]} traceDow
 */
/**
 * @typedef {object} ShadowResult
 * @property {true}    ok
 * @property {string}  businessDate
 * @property {number}  totalUses
 * @property {Array}   matchedRows       — [{modifier, qty}] that matched recipe aliases
 * @property {Array}   unmatchedRows     — [{modifier, qty}] chicken-like but NOT matched
 * @property {number}  bomQtyPerUse      — grams per modifier use
 * @property {string}  bomUnit
 * @property {number}  shadowDemandG     — totalUses × bomQtyPerUse
 * @property {string}  shadowDemandLabel — formatted string
 * @property {null}    comparableValue
 * @property {'NOT_COMPARABLE'} comparableLabel
 * @property {string}  comparableReason
 * @property {{value:number,unit:string}|null} bohForecast
 * @property {{value:number,unit:string}|null} bohPlannedOutput
 * @property {string}  explanation
 * @property {string[]} tracePath
 */
