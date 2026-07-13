// BOH OS v2 — Station Prep Read Service
// Task 004A: loads active prep tasks for one station.
// Read-only. No writes. No window. No storage. No mock data.

import { supabase } from '../core/supabase-client.js';

/**
 * Loads active prep tasks for the given station.
 *
 * @param {string} stationName
 * @returns {Promise<
 *   { ok: true,  tasks: Array<PrepTask> } |
 *   { ok: false, reason: 'INVALID_STATION' | 'CONNECTION_ERROR', tasks: [] }
 * >}
 *
 * @typedef {{
 *   id:           number,
 *   name:         string,
 *   station:      string,
 *   prepType:     string | null,
 *   unit:         string | null,
 *   currentStock: number | null,
 *   inProgress:   boolean | null,
 *   inProgressAt: string | null,
 *   inProgressBy: string | null,
 *   needTomorrow: boolean | null,
 *   recipeId:     number | null
 * }} PrepTask
 */
export async function fetchStationPrepTasks(stationName) {
  // ── Input validation ────────────────────────────────────────────────
  if (
    typeof stationName !== 'string' ||
    stationName.trim().length === 0
  ) {
    return { ok: false, reason: 'INVALID_STATION', tasks: [] };
  }

  const station = stationName.trim();

  // ── Query ───────────────────────────────────────────────────────────
  try {
    const { data, error } = await supabase
      .from('prep_tasks')
      .select(
        'id, name, category, prep_type, unit, current_stock, ' +
        'in_progress, in_progress_at, in_progress_by, need_tomorrow, recipe_id'
      )
      .eq('category', station)
      .eq('archived', false)
      .order('name', { ascending: true });

    if (error) {
      return { ok: false, reason: 'CONNECTION_ERROR', tasks: [] };
    }

    // ── Normalize: snake_case → camelCase ──────────────────────────
    const tasks = data.map((row) => ({
      id:           row.id,
      name:         row.name,
      station:      row.category,
      prepType:     row.prep_type,
      unit:         row.unit,
      currentStock: row.current_stock,
      inProgress:   row.in_progress,
      inProgressAt: row.in_progress_at,
      inProgressBy: row.in_progress_by,
      needTomorrow: row.need_tomorrow,
      recipeId:     row.recipe_id,
    }));

    return { ok: true, tasks };
  } catch {
    return { ok: false, reason: 'CONNECTION_ERROR', tasks: [] };
  }
}
