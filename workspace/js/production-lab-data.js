// workspace/js/production-lab-data.js
// READ-ONLY adapter for Production Lab.
// ──────────────────────────────────────────────────────────────────────────────
// HARD CONTRACT:
//   • SELECT only. No insert/update/delete/upsert.
//   • No mutating RPC calls.
//   • No Edge Function calls.
//   • Every exported function returns { ok, data?, error? }.
//   • This file never writes to the database.
// ──────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = 'https://ydqmumpytgrlceuinoqt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlkcW11bXB5dGdybGNldWlub3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MzcyOTUsImV4cCI6MjA5NDUxMzI5NX0.MSIKL4nCOxK8YFFTkt9AbFGViiwl-KEhHy6cL25gnKc';

const _db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// ── Add Chicken — fixed IDs (verified 2026-07-19) ───────────────────────────
// modifier_config: modifier = 'Add chicken'  (kitchen_cat: Proteine, portion_note: porzione intera)
// recipes.id:        259864df-f5ce-4f86-b78d-8752126d1269  (title: 'add chicken')
// prep_tasks.id:     473  (name: 'Diced Grilled Chicken', category: Pasta Station, unit: g)
// prep_suggestions_daily: latest row for prep_task_id = 473

const ADD_CHICKEN_RECIPE_ID  = '259864df-f5ce-4f86-b78d-8752126d1269';
const ADD_CHICKEN_PREP_ID    = 473;

/**
 * Fetch all data needed for the Add Chicken card.
 * Returns a single structured object or an error.
 *
 * @returns {Promise<{ ok: true, data: AddChickenData } | { ok: false, error: string }>}
 */
export async function fetchAddChicken() {
  try {
    // 1. Recipe (title + pos_name)
    const { data: recipeRows, error: recErr } = await _db
      .from('recipes')
      .select('id, title, pos_name, base_servings')
      .eq('id', ADD_CHICKEN_RECIPE_ID)
      .limit(1);

    if (recErr) throw new Error(`recipe: ${recErr.message}`);
    if (!recipeRows?.length) throw new Error('recipe row not found');
    const recipe = recipeRows[0];

    // 2. BOM (component names + qty + unit)
    const { data: bomRows, error: bomErr } = await _db
      .from('recipe_bom')
      .select(`
        bom_id, component_type, quantity, unit, sort_order,
        ingredients ( name ),
        sub_recipe:recipes!recipe_bom_sub_recipe_id_fkey ( title )
      `)
      .eq('parent_recipe_id', ADD_CHICKEN_RECIPE_ID)
      .order('sort_order');

    if (bomErr) throw new Error(`bom: ${bomErr.message}`);

    // 3. Prep task (current_stock)
    const { data: prepRows, error: prepErr } = await _db
      .from('prep_tasks')
      .select('id, name, category, unit, current_stock')
      .eq('id', ADD_CHICKEN_PREP_ID)
      .limit(1);

    if (prepErr) throw new Error(`prep_task: ${prepErr.message}`);
    if (!prepRows?.length) throw new Error('prep_task row not found');
    const prep = prepRows[0];

    // 4. Latest BOH suggestion (prep_suggestions_daily)
    const { data: suggRows, error: suggErr } = await _db
      .from('prep_suggestions_daily')
      .select('suggestion_date, status, confidence, planned_output, output_unit, forecast, forecast_unit, net_requirement, demand_source, forecast_path, reason, generated_at, history_start_date, history_end_date, same_weekday_samples, debug_json')
      .eq('prep_task_id', ADD_CHICKEN_PREP_ID)
      .order('suggestion_date', { ascending: false })
      .order('generated_at', { ascending: false })
      .limit(1);

    if (suggErr) throw new Error(`suggestions: ${suggErr.message}`);
    const suggestion = suggRows?.[0] ?? null;

    return {
      ok: true,
      data: {
        recipe,
        bom: bomRows ?? [],
        prep,
        suggestion,
      },
    };
  } catch (err) {
    return { ok: false, error: err.message ?? 'unknown error' };
  }
}

/**
 * Format BOM rows into a compact display string.
 * component_type 'ITEM'   → ingredients.name
 * component_type 'RECIPE' → sub_recipe.title
 */
export function formatBOM(bomRows) {
  if (!bomRows?.length) return '—';
  return bomRows
    .map(row => {
      const name =
        row.component_type === 'ITEM'   ? row.ingredients?.name  :
        row.component_type === 'RECIPE' ? row.sub_recipe?.title  :
        '?';
      const qty  = row.quantity != null ? Number(row.quantity) : null;
      const unit = row.unit ?? '';
      return qty != null ? `${name} ${qty}${unit}` : name;
    })
    .join(' · ');
}

/**
 * Format current_stock for display.
 * prep_tasks.current_stock is numeric (grams for Diced Grilled Chicken).
 */
export function formatStock(prep) {
  const val  = prep?.current_stock;
  const unit = prep?.unit ?? '';
  if (val == null) return '—';
  // Convert g → kg when ≥ 1000
  const num = Number(val);
  if (unit === 'g' && num >= 1000) {
    return `${(num / 1000).toFixed(2)} kg`;
  }
  return `${num} ${unit}`;
}

/**
 * Format the latest BOH suggestion for display.
 * Returns a string: "status · planned_output unit" or "—".
 * Does NOT translate — the lang-indexed reason string is handled by the page.
 */
export function formatSuggestion(suggestion, lang) {
  if (!suggestion) return '—';

  const statusMap = {
    prep_today: 'PREP TODAY',
    looks_ok:   'LOOKS OK',
    do_first:   'DO FIRST',
    count_first:'COUNT FIRST',
    skip:       'SKIP',
  };

  const statusLabel = statusMap[suggestion.status] ?? suggestion.status?.toUpperCase() ?? '?';
  const qty   = suggestion.planned_output != null
    ? ` · ${Number(suggestion.planned_output).toFixed(0)} ${suggestion.output_unit ?? ''}`
    : '';

  // Pick localized reason text: format is "color|it|en|es"
  let reasonText = '';
  if (suggestion.reason) {
    const parts = suggestion.reason.split('|');
    const idx   = lang === 'it' ? 1 : lang === 'es' ? 3 : 2; // default en
    reasonText  = parts[idx] ?? parts[2] ?? '';
  }

  return reasonText
    ? `${statusLabel}${qty} — ${reasonText}`
    : `${statusLabel}${qty}`;
}

/**
 * Fetch modifier counts for the Add Chicken recipe for a given business date.
 * Includes all aliases from recipes.pos_name (pipe-delimited).
 * Source table: pos_modifiers (one row per modifier per date).
 *
 * @param {string} businessDate — 'YYYY-MM-DD'
 * @param {string} posName      — pipe-delimited alias string from recipes.pos_name
 * @returns {Promise<{ ok: true, data: ModifierFetchResult } | { ok: false, error: string }>}
 */
export async function fetchAddChickenModifiers(businessDate, posName) {
  try {
    // Parse aliases from pipe-delimited pos_name
    const aliases = (posName ?? '')
      .split('|')
      .map(a => a.trim())
      .filter(Boolean);

    if (!aliases.length) {
      return { ok: false, error: 'No aliases found in pos_name' };
    }

    // SELECT only — filter by date and any of the aliases (case-insensitive match)
    // PostgREST: use .in() for the alias list
    const { data: modifierRows, error } = await _db
      .from('pos_modifiers')
      .select('modifier, quantity_sold, sale_date')
      .eq('sale_date', businessDate)
      .in('modifier', aliases);  // exact match against pos_name aliases

    if (error) throw new Error(`pos_modifiers: ${error.message}`);

    return {
      ok: true,
      data: {
        businessDate,
        aliases,
        modifierRows: modifierRows ?? [],
      },
    };
  } catch (err) {
    return { ok: false, error: err.message ?? 'unknown error' };
  }
}

/**
 * Get the most recent date that has POS modifier data for Add Chicken aliases.
 * Used to select the business date for the shadow calculation.
 *
 * @returns {Promise<{ ok: true, date: string } | { ok: false, error: string }>}
 */
export async function fetchLatestModifierDate() {
  try {
    const { data, error } = await _db
      .from('pos_modifiers')
      .select('sale_date')
      .eq('modifier', 'Add chicken')
      .order('sale_date', { ascending: false })
      .limit(1);

    if (error) throw new Error(`pos_modifiers date: ${error.message}`);
    if (!data?.length) return { ok: false, error: 'No modifier data found' };

    return { ok: true, date: data[0].sale_date };
  } catch (err) {
    return { ok: false, error: err.message ?? 'unknown error' };
  }
}

/**
 * Extract the BOM quantity (grams) for Diced Grilled Chicken from BOM rows.
 * Returns { qty, unit } or null if not found.
 *
 * @param {Array} bomRows — rows from fetchAddChicken().data.bom
 * @returns {{ qty: number, unit: string } | null}
 */
export function extractDicedChickenBOMQty(bomRows) {
  const row = (bomRows ?? []).find(
    r => r.component_type === 'RECIPE' &&
         r.sub_recipe?.title?.toLowerCase().includes('diced grilled chicken')
  );
  if (!row) return null;
  return { qty: Number(row.quantity), unit: row.unit ?? 'g' };
}

/**
 * Fetch modifier counts for specific dates (DOW sample window).
 * Used for the matching-DOW BOM-first forecast.
 * Returns rows in the form [{date, modifier, quantity_sold}] for all
 * modifier aliases (matched or not — engine filters by alias set).
 *
 * @param {string[]} dates       — array of 'YYYY-MM-DD' strings
 * @param {string[]} aliases     — alias strings from recipes.pos_name
 * @returns {Promise<{ ok: true, data: { rows: Array } } | { ok: false, error: string }>}
 */
export async function fetchModifierCountsForDates(dates, aliases) {
  try {
    if (!dates?.length || !aliases?.length) {
      return { ok: false, error: 'Missing dates or aliases' };
    }

    // SELECT only — no insert/update/delete
    const { data: rows, error } = await _db
      .from('pos_modifiers')
      .select('sale_date, modifier, quantity_sold')
      .in('sale_date', dates)
      .in('modifier', aliases);

    if (error) throw new Error(`pos_modifiers DOW fetch: ${error.message}`);

    // Normalize: add 'date' alias so engine can use row.date
    const normalized = (rows ?? []).map(r => ({
      date:          r.sale_date,
      modifier:      r.modifier,
      quantity_sold: r.quantity_sold,
    }));

    return { ok: true, data: { rows: normalized } };
  } catch (err) {
    return { ok: false, error: err.message ?? 'unknown error' };
  }
}

/**
 * Extract the DOW sample dates from the BOH suggestion debug_json.
 * The debug_json.dow_avg key has one entry per DOW (JS day: 1=Mon…6=Sat).
 * The matching Mondays are the ones in the history window with day_of_week = target_dow.
 *
 * We derive them by finding all dates between history_start_date and history_end_date
 * that match the target DOW — pure JS calculation, no extra DB query needed.
 *
 * @param {string}  historyStart  — 'YYYY-MM-DD'
 * @param {string}  historyEnd    — 'YYYY-MM-DD'
 * @param {number}  targetDow     — JS getDay() of the suggestion_date
 * @returns {string[]}  array of 'YYYY-MM-DD' strings (sorted)
 */
export function deriveMatchingDowDates(historyStart, historyEnd, targetDow) {
  const result = [];
  const start  = new Date(historyStart + 'T00:00:00Z');
  const end    = new Date(historyEnd   + 'T00:00:00Z');
  const cur    = new Date(start);

  // Advance to first matching DOW
  while (cur.getUTCDay() !== targetDow) {
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  // Collect all matching days in window
  while (cur <= end) {
    result.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 7);
  }

  return result;
}

// ── Fried Calamari — fixed IDs (verified 2026-07-19) ────────────────────────
// recipes.id:        14ccae9f-00b8-4f50-8b43-2cb8010d8ead  (title: 'Fried calamari')
//   pos_name: 'Calamari|Fried Calamari|Fritto Misto Di Calamari'
// prep_tasks.id:     266  (name: 'Calamari', category: Oven Station, unit: g)
// Trigger: POS item (pos_sales_by_item), not a modifier
//   'Fried Calamari' = 308 total, 'Calamari' = 11 total (alias via pos_item_aliases)
// BOH status: no_demand_path (stock_deductions exist but bot reports no demand path)

const FRIED_CALAMARI_RECIPE_ID = '14ccae9f-00b8-4f50-8b43-2cb8010d8ead';
const FRIED_CALAMARI_PREP_ID   = 266;

/**
 * Fetch all data for the Fried Calamari card (read-only).
 * SELECT only — no insert/update/delete/upsert/mutating RPC.
 *
 * @returns {Promise<{ ok: true, data: FriedCalamariData } | { ok: false, error: string }>}
 */
export async function fetchFriedCalamari() {
  try {
    // 1. Recipe
    const { data: recipeRows, error: recErr } = await _db
      .from('recipes')
      .select('id, title, pos_name, base_servings, base_weight_g')
      .eq('id', FRIED_CALAMARI_RECIPE_ID)
      .limit(1);

    if (recErr) throw new Error(`recipe: ${recErr.message}`);
    if (!recipeRows?.length) throw new Error('Fried Calamari recipe not found');
    const recipe = recipeRows[0];

    // 2. BOM
    const { data: bomRows, error: bomErr } = await _db
      .from('recipe_bom')
      .select(`
        bom_id, component_type, quantity, unit, notes, sort_order,
        ingredients ( name ),
        sub_recipe:recipes!recipe_bom_sub_recipe_id_fkey ( title )
      `)
      .eq('parent_recipe_id', FRIED_CALAMARI_RECIPE_ID)
      .order('sort_order');

    if (bomErr) throw new Error(`bom: ${bomErr.message}`);

    // 3. Prep task (current_stock)
    const { data: prepRows, error: prepErr } = await _db
      .from('prep_tasks')
      .select('id, name, category, unit, current_stock')
      .eq('id', FRIED_CALAMARI_PREP_ID)
      .limit(1);

    if (prepErr) throw new Error(`prep_task: ${prepErr.message}`);
    if (!prepRows?.length) throw new Error('Calamari prep task not found');
    const prep = prepRows[0];

    // 4. Latest BOH suggestion
    const { data: suggRows, error: suggErr } = await _db
      .from('prep_suggestions_daily')
      .select('suggestion_date, status, confidence, planned_output, output_unit, forecast, forecast_unit, net_requirement, demand_source, forecast_path, reason, generated_at, history_start_date, history_end_date, same_weekday_samples')
      .eq('prep_task_id', FRIED_CALAMARI_PREP_ID)
      .order('suggestion_date', { ascending: false })
      .order('generated_at',    { ascending: false })
      .limit(1);

    if (suggErr) throw new Error(`suggestions: ${suggErr.message}`);
    const suggestion = suggRows?.[0] ?? null;

    return {
      ok: true,
      data: { recipe, bom: bomRows ?? [], prep, suggestion },
    };
  } catch (err) {
    return { ok: false, error: err.message ?? 'unknown error' };
  }
}

/**
 * Fetch the latest date that has pos_sales_by_item data for Fried Calamari aliases.
 * SELECT only.
 *
 * @param {string[]} aliases  — alias list from recipes.pos_name
 * @returns {Promise<{ ok: true, date: string } | { ok: false, error: string }>}
 */
export async function fetchLatestCalamariSalesDate(aliases) {
  try {
    const { data, error } = await _db
      .from('pos_sales_by_item')
      .select('sale_date')
      .in('menu_item', aliases)
      .order('sale_date', { ascending: false })
      .limit(1);

    if (error) throw new Error(`pos_sales_by_item date: ${error.message}`);
    if (!data?.length) return { ok: false, error: 'No sales found for Fried Calamari aliases' };

    return { ok: true, date: data[0].sale_date };
  } catch (err) {
    return { ok: false, error: err.message ?? 'unknown error' };
  }
}

/**
 * Fetch POS sales for Fried Calamari aliases on a specific date.
 * Also fetch portion_factor values from pos_item_aliases.
 * SELECT only.
 *
 * @param {string}   businessDate — 'YYYY-MM-DD'
 * @param {string[]} aliases      — alias list from recipes.pos_name
 * @returns {Promise<{ ok: true, data: CalamariSalesData } | { ok: false, error: string }>}
 */
export async function fetchFriedCalamariSales(businessDate, aliases) {
  try {
    // 1. POS sales for the date
    const { data: salesRows, error: salesErr } = await _db
      .from('pos_sales_by_item')
      .select('sale_date, menu_item, quantity')
      .eq('sale_date', businessDate)
      .in('menu_item', aliases);

    if (salesErr) throw new Error(`pos_sales_by_item: ${salesErr.message}`);

    // 2. portion_factor from pos_item_aliases for any mapped aliases
    const { data: aliasRows, error: aliasErr } = await _db
      .from('pos_item_aliases')
      .select('alias_name, portion_factor')
      .in('alias_name', aliases);

    if (aliasErr) throw new Error(`pos_item_aliases: ${aliasErr.message}`);

    // Build aliasPortionMap: default 1.0 for aliases not in pos_item_aliases
    const aliasPortionMap = {};
    for (const alias of aliases) {
      const row = (aliasRows ?? []).find(r => r.alias_name === alias);
      aliasPortionMap[alias] = row ? Number(row.portion_factor ?? 1.0) : 1.0;
    }

    // Normalize salesRows: add 'date' for engine compatibility
    const normalized = (salesRows ?? []).map(r => ({
      date:      r.sale_date,
      menu_item: r.menu_item,
      quantity:  r.quantity,
    }));

    return {
      ok: true,
      data: {
        businessDate,
        salesRows: normalized,
        aliasPortionMap,
      },
    };
  } catch (err) {
    return { ok: false, error: err.message ?? 'unknown error' };
  }
}

/**
 * Extract the Calamari ingredient BOM quantity from Fried Calamari BOM rows.
 * Returns { qty, unit, ingredientName } or null if not found.
 * Looks for ITEM component whose ingredient name contains 'calamari'.
 *
 * @param {Array} bomRows — rows from fetchFriedCalamari().data.bom
 * @returns {{ qty: number, unit: string, ingredientName: string } | null}
 */
export function extractCalamariItemBOMQty(bomRows) {
  const row = (bomRows ?? []).find(
    r => r.component_type === 'ITEM' &&
         r.ingredients?.name?.toLowerCase().includes('calamari')
  );
  if (!row) return null;
  return {
    qty:            Number(row.quantity),
    unit:           row.unit ?? 'g',
    ingredientName: row.ingredients.name,
  };
}

/**
 * Fetch pos_sales_by_item rows for specific dates and a set of aliases.
 * Used for DOW sample window calculation.
 * Returns rows normalized to {date, menu_item, quantity}.
 * SELECT only.
 *
 * @param {string[]} dates    — array of 'YYYY-MM-DD'
 * @param {string[]} aliases  — recipe alias strings
 * @returns {Promise<{ ok: true, data: { rows: Array } } | { ok: false, error: string }>}
 */
export async function fetchSalesForDates(dates, aliases) {
  try {
    if (!dates?.length || !aliases?.length) {
      return { ok: false, error: 'Missing dates or aliases' };
    }

    const { data: rows, error } = await _db
      .from('pos_sales_by_item')
      .select('sale_date, menu_item, quantity')
      .in('sale_date', dates)
      .in('menu_item', aliases);

    if (error) throw new Error(`pos_sales_by_item DOW fetch: ${error.message}`);

    const normalized = (rows ?? []).map(r => ({
      date:      r.sale_date,
      menu_item: r.menu_item,
      quantity:  r.quantity,
    }));

    return { ok: true, data: { rows: normalized } };
  } catch (err) {
    return { ok: false, error: err.message ?? 'unknown error' };
  }
}

/**
 * Fetch raw POS sales AND stock_deductions for Fried Calamari diagnostic.
 * SELECT only — no insert/update/delete.
 *
 * @param {string[]} dates    — array of 'YYYY-MM-DD' sample dates
 * @param {string[]} aliases  — recipe alias strings (from pos_name)
 * @returns {Promise<{ ok: true, data: CalamariDiagData } | { ok: false, error: string }>}
 */
export async function fetchCalamariDeductionDiagnostics(dates, aliases) {
  try {
    // 1. POS sales for those dates (from pos_sales_by_item)
    const { data: salesRows, error: salesErr } = await _db
      .from('pos_sales_by_item')
      .select('sale_date, menu_item, quantity')
      .in('sale_date', dates)
      .in('menu_item', aliases);

    if (salesErr) throw new Error(`pos_sales_by_item diagnostic: ${salesErr.message}`);

    // 2. Stock deductions for prep_task 266 on those dates
    const { data: deductionRows, error: dedErr } = await _db
      .from('stock_deductions')
      .select('business_date, pos_item_name, quantity, source, calculation_path')
      .eq('prep_task_id', FRIED_CALAMARI_PREP_ID)
      .in('business_date', dates);

    if (dedErr) throw new Error(`stock_deductions diagnostic: ${dedErr.message}`);

    // Normalize to engine-friendly shape
    const normSales = (salesRows ?? []).map(r => ({
      date:      r.sale_date,
      menu_item: r.menu_item,
      quantity:  r.quantity,
    }));

    const normDeductions = (deductionRows ?? []).map(r => ({
      date:           r.business_date,
      pos_item_name:  r.pos_item_name,
      quantity_g:     r.quantity,
      source:         r.source,
      calculation_path: r.calculation_path,
    }));

    return {
      ok:   true,
      data: { salesRows: normSales, deductionRows: normDeductions },
    };
  } catch (err) {
    return { ok: false, error: err.message ?? 'unknown error' };
  }
}
