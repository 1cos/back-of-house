// BOH OS v2 — Start Prep write service
// Task 004L: marks one active prep task as in progress.
// Schema fields verified live: id, in_progress, in_progress_at, in_progress_by, archived.
// No UI. No connection to Station Prep yet. No window writes. No storage.

import { supabase } from '../core/supabase-client.js';

// ── Input validation ──────────────────────────────────────────────────

/**
 * Returns true when prepTaskId is a finite number greater than zero.
 *
 * @param {unknown} v
 * @returns {boolean}
 */
function isValidTaskId(v) {
  return typeof v === 'number' && isFinite(v) && v > 0;
}

/**
 * Returns true when startedBy is a non-empty trimmed string.
 *
 * @param {unknown} v
 * @returns {boolean}
 */
function isValidStartedBy(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

// ── Exported API ──────────────────────────────────────────────────────

/**
 * Marks one active prep task as in progress.
 *
 * Writes:
 *   in_progress    = true
 *   in_progress_at = current ISO timestamp (one value per call)
 *   in_progress_by = startedBy.trim()
 *
 * Filters:
 *   id       = prepTaskId
 *   archived = false
 *
 * @param {{ prepTaskId: unknown, startedBy: unknown }} options
 * @returns {Promise<
 *   { ok: true,  task: { id: number, inProgress: boolean, inProgressAt: string, inProgressBy: string } } |
 *   { ok: false, reason: 'INVALID_INPUT' | 'TASK_NOT_FOUND' | 'CONNECTION_ERROR', task: null }
 * >}
 */
export async function startPrepTask({ prepTaskId, startedBy } = {}) {
  // ── Input validation ──
  if (!isValidTaskId(prepTaskId) || !isValidStartedBy(startedBy)) {
    return { ok: false, reason: 'INVALID_INPUT', task: null };
  }

  const trimmedBy = startedBy.trim();

  // One timestamp per call — generated before the request.
  const now = new Date().toISOString();

  try {
    const { data, error } = await supabase
      .from('prep_tasks')
      .update({
        in_progress:    true,
        in_progress_at: now,
        in_progress_by: trimmedBy,
      })
      .eq('id', prepTaskId)
      .eq('archived', false)
      .select('id, in_progress, in_progress_at, in_progress_by');

    if (error) {
      return { ok: false, reason: 'CONNECTION_ERROR', task: null };
    }

    // No matching active row.
    if (!data || data.length === 0) {
      return { ok: false, reason: 'TASK_NOT_FOUND', task: null };
    }

    const row = data[0];

    return {
      ok: true,
      task: {
        id:           row.id,
        inProgress:   row.in_progress,
        inProgressAt: row.in_progress_at,
        inProgressBy: row.in_progress_by,
      },
    };
  } catch {
    return { ok: false, reason: 'CONNECTION_ERROR', task: null };
  }
}
