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
      .select('suggestion_date, status, confidence, planned_output, output_unit, reason, generated_at')
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
