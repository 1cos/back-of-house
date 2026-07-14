// BOH OS v2 — Prep Count Read Service
// Task 004R
//
// Loads the most recent valid physical stock count for a supplied list of
// prep task IDs. Read-only. No database writes. No reconciler call.

import { supabase } from '../core/supabase-client.js';

// Verified live columns from production js/prep.js (line 375, brigade-main).
// Timestamp column confirmed as `counted_at` (lines 376–377).
const SELECT_COLUMNS = [
  'prep_task_id',
  'counted_qty',
  'unit',
  'counted_by',
  'counted_at',
  'expires_at',
  'reconcile_status',
  'reconciled_qty',
  'reconciled_note',
].join(',');

/**
 * Loads the most recent valid physical stock count for each supplied prep
 * task ID.
 *
 * A count is valid when:
 *   - counted_at is within the last 24 hours (relative to call time)
 *   - expires_at is null or later than the current time
 *
 * Only the most recent valid count per prep task is returned.
 * Tasks with no valid recent count are omitted from the result.
 *
 * @param {unknown[]} prepTaskIds
 * @returns {Promise<{
 *   ok: true,
 *   countsByPrepTaskId: Record<number, {
 *     prepTaskId: number,
 *     countedQuantity: number,
 *     unit: string | null,
 *     countedBy: string | null,
 *     countedAt: string,
 *     expiresAt: string | null,
 *     reconcileStatus: string | null,
 *     reconciledQuantity: number | null,
 *     reconciledNote: string | null
 *   }>
 * } | {
 *   ok: false,
 *   reason: 'CONNECTION_ERROR',
 *   countsByPrepTaskId: {}
 * }>}
 */
export async function fetchRecentPrepCounts(prepTaskIds) {
  // ── Input normalisation ─────────────────────────────────────────────────
  // Keep only finite numbers greater than zero; deduplicate.
  const seen = new Set();
  const validIds = [];

  if (Array.isArray(prepTaskIds)) {
    for (const id of prepTaskIds) {
      const n = Number(id);
      if (Number.isFinite(n) && n > 0 && !seen.has(n)) {
        seen.add(n);
        validIds.push(n);
      }
    }
  }

  if (validIds.length === 0) {
    return { ok: true, countsByPrepTaskId: {} };
  }

  // ── Time boundaries — one Date instance for the entire call ─────────────
  const now = new Date();
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();

  // ── Database query ───────────────────────────────────────────────────────
  let rows;
  try {
    const { data, error } = await supabase
      .from('prep_stock_counts')
      .select(SELECT_COLUMNS)
      .in('prep_task_id', validIds)
      .gte('counted_at', cutoff)
      .order('counted_at', { ascending: false });

    if (error) {
      return { ok: false, reason: 'CONNECTION_ERROR', countsByPrepTaskId: {} };
    }

    rows = data;
  } catch {
    return { ok: false, reason: 'CONNECTION_ERROR', countsByPrepTaskId: {} };
  }

  // ── Select most recent valid count per task ──────────────────────────────
  // Rows are already ordered counted_at DESC.
  // Iterate once; for each prep_task_id take the first non-expired row.
  const countsByPrepTaskId = {};

  for (const row of rows) {
    const taskId = row.prep_task_id;

    // Skip if a valid count for this task has already been selected.
    if (Object.prototype.hasOwnProperty.call(countsByPrepTaskId, taskId)) {
      continue;
    }

    // Ignore expired rows (null expires_at remains valid).
    if (row.expires_at !== null && row.expires_at <= nowIso) {
      continue;
    }

    countsByPrepTaskId[taskId] = {
      prepTaskId:         taskId,
      countedQuantity:    row.counted_qty,
      unit:               row.unit,
      countedBy:          row.counted_by,
      countedAt:          row.counted_at,
      expiresAt:          row.expires_at,
      reconcileStatus:    row.reconcile_status,
      reconciledQuantity: row.reconciled_qty,
      reconciledNote:     row.reconciled_note,
    };
  }

  return { ok: true, countsByPrepTaskId };
}
