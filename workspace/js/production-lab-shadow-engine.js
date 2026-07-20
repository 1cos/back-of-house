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
 * Reconstruct the BOH planned_output from explicit named fields in the suggestion record.
 * Pure function — no DB access, no DOM. planned_output is NEVER used as a calculation input.
 *
 * Formula (all inputs are named debug_json / suggestion fields):
 *   1. gross_requirement = buffered_forecast       (debug_json.buffered_forecast)
 *   2. net_requirement   = gross − stock_value     (debug_json.stock_detail.value, fresh count)
 *   3. planned_output    = ceil(net / min_increment) × min_increment
 *
 * Float precision note:
 *   raw_forecast × buffer_factor drifts 0.01g vs stored buffered_forecast.
 *   The shadow uses buffered_forecast directly to match the bot's own stored value.
 *
 * @param {object} input
 * @param {number}   input.bufferedForecast   — debug_json.buffered_forecast (g)
 * @param {number}   input.rawForecast        — debug_json.raw_forecast (g) [display only]
 * @param {number}   input.bufferFactor       — debug_json.buffer_factor [display only]
 * @param {number}   input.stockValue         — debug_json.stock_detail.value (g)
 * @param {number}   input.minimumIncrement   — suggestion.minimum_increment
 * @param {number}   input.bohPlannedOutput   — suggestion.planned_output [comparison ONLY]
 * @param {number}   input.coverageDays       — suggestion.coverage_days [display only]
 * @param {string[]} input.coverDates         — debug_json.cover_dates [display only]
 * @returns {ProductionResult}
 */
export function calculateRequiredProduction(input) {
  const {
    bufferedForecast,
    rawForecast,
    bufferFactor,
    stockValue,
    minimumIncrement,
    bohPlannedOutput,
    coverageDays,
    coverDates,
  } = input;

  // ── Guard: require all essential calculation inputs ───────────────────────
  const missing = [];
  if (bufferedForecast == null || isNaN(Number(bufferedForecast)))
    missing.push('debug_json.buffered_forecast');
  if (stockValue == null || isNaN(Number(stockValue)))
    missing.push('debug_json.stock_detail.value');
  if (minimumIncrement == null || isNaN(Number(minimumIncrement)))
    missing.push('minimum_increment');

  if (missing.length) {
    return {
      ok:            false,
      status:        'CANNOT_RECONSTRUCT',
      missingFields: missing,
      error:         `Missing: ${missing.join(', ')}`,
    };
  }

  const gross  = Number(bufferedForecast);
  const stock  = Number(stockValue);
  const minInc = Number(minimumIncrement);
  const boh    = bohPlannedOutput != null ? Number(bohPlannedOutput) : null;

  // Step 1: gross requirement = buffered forecast
  const grossRequirement = gross;

  // Step 2: net requirement = gross − stock (round to 2dp, matches bot precision)
  const netRequirement = Math.round((gross - stock) * 100) / 100;

  if (netRequirement <= 0) {
    const diff = boh != null ? 0 - boh : 0;
    return {
      ok: true,
      grossRequirement,
      rawForecast:      rawForecast ?? null,
      bufferFactor:     bufferFactor ?? null,
      stockApplied:     stock,
      netRequirement:   0,
      roundingNote:     'Net ≤ 0 — no production needed',
      calculatedOutput: 0,
      bohPlannedOutput: boh,
      diff,
      status:           (boh == null || Math.abs(diff) < minInc) ? 'MATCH' : 'MISMATCH',
      formulaTrace:     `${gross}g − ${stock}g = ${netRequirement}g (≤ 0) → 0g`,
      coverageDays:     coverageDays ?? null,
      coverDates:       coverDates ?? [],
    };
  }

  // Step 3: planned = ceil(net / min_increment) × min_increment
  const calculatedOutput = Math.ceil(netRequirement / minInc) * minInc;
  const roundingNote     = `ceil(${netRequirement}g / ${minInc}) × ${minInc} = ${calculatedOutput}g`;

  // Step 4: compare with BOH (comparison only — boh not used in any calc above)
  const diff    = boh != null ? calculatedOutput - boh : 0;
  const absDiff = Math.abs(diff);
  const status  = boh == null ? 'CANNOT_RECONSTRUCT'
    : absDiff <= minInc ? 'MATCH' : 'MISMATCH';

  const formulaTrace =
    `${gross}g − ${stock}g = ${netRequirement}g → ${roundingNote}`;

  return {
    ok:               true,
    grossRequirement,
    rawForecast:      rawForecast ?? null,
    bufferFactor:     bufferFactor ?? null,
    stockApplied:     stock,
    netRequirement,
    roundingNote,
    calculatedOutput,
    bohPlannedOutput: boh,
    diff,
    status,
    formulaTrace,
    coverageDays:     coverageDays ?? null,
    coverDates:       coverDates ?? [],
  };
}


/**
 * Calculate shadow demand for a sale-recipe card (POS item → recipe BOM → prep ingredient).
 * Pure function — no DB access, no DOM, no side effects.
 *
 * Used for items sold as POS line items (not modifiers).
 * Each sale row is one portion; portion_factor scales the canonical count.
 *
 * Double-count guard: the function checks that no alias appears more than once
 * across the salesRows for the same date. If found → returns NEEDS_REVIEW.
 *
 * @param {object}   input
 * @param {string}   input.businessDate      — 'YYYY-MM-DD'
 * @param {Array}    input.salesRows         — [{date, menu_item, quantity}] from pos_sales_by_item
 * @param {object}   input.aliasPortionMap   — { 'Fried Calamari': 1.0, 'Calamari': 1.0, … }
 *                                             Keys are recipe alias strings (exact case from pos_name).
 *                                             Values are portion_factor (default 1.0 if alias not in pos_item_aliases).
 * @param {number}   input.bomQuantity       — grams per portion from recipe_bom (live, not hardcoded)
 * @param {string}   input.bomUnit           — unit of bomQuantity (expected 'g')
 * @param {string}   input.ingredientName    — name of the key BOM ingredient (for trace)
 * @param {string}   input.recipeTitle       — recipe title (for trace)
 *
 * @returns {SaleRecipeDemandResult}
 */
export function calculateSaleRecipeDemand(input) {
  const {
    businessDate,
    salesRows,
    aliasPortionMap,
    bomQuantity,
    bomUnit,
    ingredientName,
    recipeTitle,
  } = input;

  // ── Guard: BOM unit ────────────────────────────────────────────────────────
  if (bomUnit !== 'g') {
    return {
      ok:    false,
      status:'NEEDS_REVIEW',
      error: `Unexpected BOM unit '${bomUnit}' — expected 'g'. Cannot calculate demand.`,
    };
  }

  const bomQty    = Number(bomQuantity ?? 0);
  if (bomQty <= 0) {
    return { ok: false, status: 'NEEDS_REVIEW', error: `BOM quantity is zero or missing.` };
  }

  const aliasSet  = new Set(Object.keys(aliasPortionMap).map(k => k.toLowerCase()));

  // ── Double-count guard: each alias must appear at most once per date ───────
  const seenAliases = {};
  for (const row of (salesRows ?? [])) {
    const key = `${row.date}::${(row.menu_item ?? '').toLowerCase()}`;
    if (seenAliases[key]) {
      return {
        ok:     false,
        status: 'NEEDS_REVIEW',
        error:  `Duplicate alias '${row.menu_item}' on ${row.date} — possible double-count. Verify pos_sales_by_item.`,
        duplicateAlias: row.menu_item,
        duplicateDate:  row.date,
      };
    }
    seenAliases[key] = true;
  }

  // ── Process each sales row ─────────────────────────────────────────────────
  let canonicalPortions = 0;
  const includedRows    = [];
  const excludedRows    = [];

  for (const row of (salesRows ?? [])) {
    const itemKey    = (row.menu_item ?? '').toLowerCase();
    const qtyRaw     = Number(row.quantity ?? 0);

    if (!aliasSet.has(itemKey)) {
      excludedRows.push({ menu_item: row.menu_item, quantity: qtyRaw, reason: 'not in alias set' });
      continue;
    }

    // Look up portion_factor — find matching key case-insensitively
    const matchedKey = Object.keys(aliasPortionMap).find(k => k.toLowerCase() === itemKey);
    const factor     = matchedKey != null ? Number(aliasPortionMap[matchedKey] ?? 1.0) : 1.0;
    const canonical  = qtyRaw * factor;

    canonicalPortions += canonical;
    includedRows.push({ menu_item: row.menu_item, quantity: qtyRaw, portion_factor: factor, canonical });
  }

  // ── Demand ─────────────────────────────────────────────────────────────────
  const totalDemandG     = canonicalPortions * bomQty;
  const shadowDemandLabel = `${totalDemandG}g`;

  const explanation =
    `${canonicalPortions} ${recipeTitle ?? 'portions'} × ${bomQty}${bomUnit} ${ingredientName ?? 'ingredient'} = ${totalDemandG}${bomUnit} demand.`;

  // ── Trace ─────────────────────────────────────────────────────────────────
  const tracePath = [
    `pos_sales_by_item (${businessDate}): ${includedRows.map(r => `'${r.menu_item}' ×${r.quantity}`).join(', ')}`,
    `→ recipe '${recipeTitle}' — aliases: [${[...aliasSet].join(', ')}]`,
    `→ recipe_bom: ${ingredientName} ${bomQty}${bomUnit}/portion`,
    `→ demand: ${canonicalPortions} × ${bomQty}${bomUnit} = ${totalDemandG}${bomUnit}`,
  ];

  return {
    ok:                true,
    status:            'OK',
    businessDate,
    canonicalPortions,
    bomQtyPerPortion:  bomQty,
    bomUnit,
    totalDemandG,
    shadowDemandLabel,
    includedRows,
    excludedRows,
    explanation,
    tracePath,
  };
}

/**
 * @typedef {object} SaleRecipeDemandResult
 * @property {true}    ok
 * @property {'OK'|'NEEDS_REVIEW'} status
 * @property {string}  businessDate
 * @property {number}  canonicalPortions
 * @property {number}  bomQtyPerPortion
 * @property {string}  bomUnit
 * @property {number}  totalDemandG
 * @property {string}  shadowDemandLabel
 * @property {Array}   includedRows
 * @property {Array}   excludedRows
 * @property {string}  explanation
 * @property {string[]} tracePath
 */

/**
 * Calculate a matching-DOW BOM-first forecast for a sale-recipe item (POS line item, not modifier).
 * Pure function — no DB, no DOM, no side effects.
 *
 * Analogous to calculateMatchingDowForecast but uses:
 *   row.menu_item  (not row.modifier)
 *   row.quantity   (not row.quantity_sold)
 *   aliasPortionMap for portion_factor scaling
 *
 * When BOH has no forecast (null), comparableLabel = 'SHADOW_ONLY'.
 *
 * @param {object}   input
 * @param {string}   input.targetDate         — 'YYYY-MM-DD'
 * @param {number}   input.targetDow          — JS getUTCDay() of target date
 * @param {Array}    input.sampleRows         — [{date, menu_item, quantity}] from pos_sales_by_item
 * @param {object}   input.aliasPortionMap    — { 'Fried Calamari': 1.0, 'Calamari': 1.0, … }
 * @param {number}   input.bomQtyPerPortion   — grams per canonical portion (live from recipe_bom)
 * @param {string}   input.bomUnit            — 'g'
 * @param {number|null} input.bohForecastG    — null if BOH has no demand path
 * @param {string}   input.ingredientName     — key BOM ingredient name (for trace)
 * @param {string}   input.recipeTitle        — recipe title (for trace)
 * @returns {SaleRecipeDowForecastResult}
 */
export function calculateSaleRecipeDowForecast(input) {
  const {
    targetDate,
    targetDow,
    sampleRows,
    aliasPortionMap,
    bomQtyPerPortion,
    bomUnit,
    bohForecastG,
    ingredientName,
    recipeTitle,
  } = input;

  if (bomUnit !== 'g') {
    return { ok: false, error: `Unexpected BOM unit '${bomUnit}' — expected 'g'` };
  }

  const bomQty   = Number(bomQtyPerPortion ?? 0);
  if (bomQty <= 0) {
    return { ok: false, error: 'BOM qty per portion is zero or missing' };
  }

  const aliasSet = new Set(Object.keys(aliasPortionMap).map(k => k.toLowerCase()));

  // ── 1. Group rows by date, sum canonical portions ────────────────────────
  const byDate = {};
  for (const row of (sampleRows ?? [])) {
    const itemKey = (row.menu_item ?? '').trim().toLowerCase();
    if (!aliasSet.has(itemKey)) continue;

    const matchedKey = Object.keys(aliasPortionMap).find(k => k.toLowerCase() === itemKey);
    const factor     = matchedKey != null ? Number(aliasPortionMap[matchedKey] ?? 1.0) : 1.0;
    const qty        = Number(row.quantity ?? 0);
    const canonical  = qty * factor;

    const d = row.date;
    if (!byDate[d]) byDate[d] = { portions: 0, rowDetails: [] };
    byDate[d].portions += canonical;
    byDate[d].rowDetails.push({ menu_item: row.menu_item, qty, factor, canonical });
  }

  // ── 2. Build per-date sample array ─────────────────────────────────────
  const samples = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, info]) => ({
      date,
      portions:   info.portions,
      bomDemandG: info.portions * bomQty,
      rowDetails: info.rowDetails,
    }));

  if (!samples.length) {
    return { ok: false, error: 'No sales found for recipe aliases on the DOW sample dates' };
  }

  // ── 3. Average ──────────────────────────────────────────────────────────
  const totalDemandG = samples.reduce((s, r) => s + r.bomDemandG, 0);
  const avgRounded   = Math.round((totalDemandG / samples.length) * 100) / 100;

  // ── 4. Compare with BOH ─────────────────────────────────────────────────
  const hasBOH = bohForecastG != null;
  let comparisonStatus, diff, mismatchReason;

  if (!hasBOH) {
    comparisonStatus = 'SHADOW_ONLY';
    diff             = null;
    mismatchReason   = 'BOH has no forecast (no_demand_path). BOM-first forecast exists but BOH does not classify this prep as having a demand path.';
  } else {
    diff = avgRounded - Number(bohForecastG);
    const tolerance = Math.max(1, Number(bohForecastG) * 0.001);
    if (Math.abs(diff) <= tolerance) {
      comparisonStatus = 'MATCH';
      mismatchReason   = null;
    } else {
      comparisonStatus = 'MISMATCH';
      mismatchReason   = `BOM-first avg ${avgRounded}g vs BOH ${bohForecastG}g — diff ${diff.toFixed(2)}g.`;
    }
  }

  // ── 5. Trace ────────────────────────────────────────────────────────────
  const traceDow = [
    `Target: ${targetDate} (DOW ${targetDow})`,
    `Samples (${samples.length}): ${samples.map(s => `${s.date}→${s.portions}p×${bomQty}g=${s.bomDemandG}g`).join(', ')}`,
    `BOM-first avg: (${samples.map(s => s.bomDemandG).join('+')}÷${samples.length}) = ${avgRounded}g`,
    `BOH forecast: ${hasBOH ? bohForecastG + 'g' : 'NONE (no_demand_path)'}`,
    `Status: ${comparisonStatus}`,
  ];

  return {
    ok:              true,
    targetDate,
    samples,
    sampleCount:     samples.length,
    totalDemandG,
    avgDemandG:      avgRounded,
    avgLabel:        `${avgRounded}g`,
    bohForecastG:    hasBOH ? Number(bohForecastG) : null,
    diff,
    comparisonStatus,
    mismatchReason,
    traceDow,
  };
}

/**
 * @typedef {object} SaleRecipeDowForecastResult
 * @property {true}    ok
 * @property {string}  targetDate
 * @property {Array}   samples             — [{date, portions, bomDemandG, rowDetails}]
 * @property {number}  sampleCount
 * @property {number}  totalDemandG
 * @property {number}  avgDemandG
 * @property {string}  avgLabel
 * @property {number|null} bohForecastG
 * @property {number|null} diff
 * @property {'MATCH'|'MISMATCH'|'SHADOW_ONLY'} comparisonStatus
 * @property {string|null} mismatchReason
 * @property {string[]} traceDow
 */
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
