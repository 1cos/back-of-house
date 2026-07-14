// BOH OS v2 — Station List Read Service
// Task 004AG: loads distinct station names from active prep tasks.
// Read-only. No writes. No window. No storage. No mock data.

import { supabase } from '../core/supabase-client.js';

/**
 * Loads the distinct station names from active prep tasks.
 *
 * @returns {Promise<
 *   { ok: true,  stations: string[] } |
 *   { ok: false, reason: 'CONNECTION_ERROR', stations: [] }
 * >}
 */
export async function fetchAvailableStations() {
  try {
    const { data, error } = await supabase
      .from('prep_tasks')
      .select('category')
      .eq('archived', false)
      .limit(500);

    if (error) {
      return { ok: false, reason: 'CONNECTION_ERROR', stations: [] };
    }

    const stations = [
      ...new Set(
        data
          .map((row) => (typeof row.category === 'string' ? row.category.trim() : null))
          .filter((name) => name !== null && name.length > 0)
      ),
    ].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    return { ok: true, stations };
  } catch {
    return { ok: false, reason: 'CONNECTION_ERROR', stations: [] };
  }
}
