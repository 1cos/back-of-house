// BOH OS v2 — Recipe Catalog Read Service
// Loads the full recipe catalog for the Recipe Book panel.
// Read-only. No writes. No window. No storage. No mock data.
//
// Exports:
//   fetchRecipeCatalog() → { ok, recipes }

import { supabase } from '../core/supabase-client.js';

/**
 * Loads all recipes for the catalog browser.
 *
 * @returns {Promise<
 *   { ok: true,  recipes: Array<CatalogRecipe> } |
 *   { ok: false, recipes: [] }
 * >}
 *
 * @typedef {{
 *   id:              string,
 *   title:           string,
 *   menuGroup:       string | null,
 *   category:        string | null,
 *   yieldText:       string | null,
 *   shelfLifeDays:   number | null,
 *   photoUrl:        string | null,
 *   imageUrl:        string | null,
 * }} CatalogRecipe
 */
export async function fetchRecipeCatalog() {
  try {
    const { data, error } = await supabase
      .from('recipes')
      .select(
        'id, title, menu_group, category, yield_text, ' +
        'shelf_life_days, photo_url, image_url'
      )
      .order('title', { ascending: true });

    if (error) {
      return { ok: false, recipes: [] };
    }

    const recipes = (data ?? []).map((row) => ({
      id:            row.id,
      title:         row.title,
      menuGroup:     row.menu_group   ?? null,
      category:      row.category     ?? null,
      yieldText:     row.yield_text   ?? null,
      shelfLifeDays: row.shelf_life_days ?? null,
      photoUrl:      row.photo_url    ?? null,
      imageUrl:      row.image_url    ?? null,
    }));

    return { ok: true, recipes };
  } catch {
    return { ok: false, recipes: [] };
  }
}
