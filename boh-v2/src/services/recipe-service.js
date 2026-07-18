// BOH OS v2 — Recipe Read Service
// Read-only. No writes. No window. No storage.
//
// Fetches all data needed by the recipe panel in one call:
//   recipes row + recipe_bom (with joined ingredient/sub-recipe names) +
//   recipe_steps + prep_steps
//
// Exports:
//   fetchRecipeData(recipeId, prepTaskId) → RecipeData

import { supabase } from '../core/supabase-client.js';

/**
 * @typedef {{
 *   ok:           boolean,
 *   recipe:       object | null,
 *   bomRows:      Array,
 *   recipeSteps:  Array,
 *   prepSteps:    Array,
 * }} RecipeData
 */

/**
 * Fetches all read-only recipe data needed by the recipe panel.
 *
 * @param {string | null} recipeId   — UUID from prep_tasks.recipe_id
 * @param {number | null} prepTaskId — prep_tasks.id (for prep_steps)
 * @returns {Promise<RecipeData>}
 */
export async function fetchRecipeData(recipeId, prepTaskId) {
  const result = {
    ok:          false,
    recipe:      null,
    bomRows:     [],
    recipeSteps: [],
    prepSteps:   [],
  };

  // ── Fetch recipe row ──────────────────────────────────────────────
  if (recipeId) {
    try {
      const { data: rec, error: recErr } = await supabase
        .from('recipes')
        .select(
          'id, title, base_servings, base_weight_g, procedure, procedure_en, ' +
          'equipment, shelf_life_days, yield_text, menu_group'
        )
        .eq('id', recipeId)
        .maybeSingle();

      if (recErr) throw recErr;
      result.recipe = rec ?? null;
    } catch {
      // recipe fetch failed — panel will show empty state
    }

    // ── Fetch BOM ─────────────────────────────────────────────────
    try {
      const { data: bom, error: bomErr } = await supabase
        .from('recipe_bom')
        .select(
          'bom_id, component_type, quantity, unit, sort_order, ' +
          'ingredients(name), recipes!recipe_bom_sub_recipe_id_fkey(title)'
        )
        .eq('parent_recipe_id', recipeId)
        .order('sort_order', { nullsFirst: false });

      if (!bomErr && bom) {
        result.bomRows = bom;
      }
    } catch {
      // BOM unavailable — ingredient list will show empty state
    }

    // ── Fetch recipe_steps ────────────────────────────────────────
    try {
      const { data: rs, error: rsErr } = await supabase
        .from('recipe_steps')
        .select('step_number, title, instruction_en, instruction_it, timer_seconds')
        .eq('recipe_id', recipeId)
        .order('step_number');

      if (!rsErr && rs) {
        result.recipeSteps = rs;
      }
    } catch {
      // steps unavailable — procedure will fall through to procedure_en
    }
  }

  // ── Fetch prep_steps ─────────────────────────────────────────────
  if (prepTaskId) {
    try {
      const { data: ps, error: psErr } = await supabase
        .from('prep_steps')
        .select('id, sort_order, title, note, timer_minutes')
        .eq('prep_task_id', prepTaskId)
        .order('sort_order');

      if (!psErr && ps) {
        result.prepSteps = ps;
      }
    } catch {
      // prep_steps unavailable — falls through to recipe_steps
    }
  }

  result.ok = true;
  return result;
}
