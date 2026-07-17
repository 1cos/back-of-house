// BOH OS v2 — Prep Count Read Service
// Task 004R
//
// Two read models, one service:
//
// fetchRecentPrepCounts(ids)     — LIVE BASELINE read model
//   Used by: station-prep card, bot stock calculation fallback display
//   Semantics: a count is "live" when it has NOT been superseded by
//   a subsequent production event. expires_at is the supersession marker.
//   Excludes: invalid_test_data, corrected_unit_error, and any row
//   where expires_at is in the past.
//
// fetchHistoricalPrepCounts(ids) — PHYSICAL COUNT HISTORY read model
//   Used by: "Last physical count" detail in station-prep cards
//   Semantics: a count is a permanent historical record of a physical
//   observation by a cook. It is preserved even when superseded by
//   production (expires_at in the past). The last physical count a cook
//   did is always visible for transparency.
//   Excludes: invalid_test_data, corrected_unit_error only.
//   Does NOT exclude expired rows.
//
// The two read models diverge only when a production write has set
// expires_at to the production time (superseding the count as a live
// baseline). In that case:
//   fetchRecentPrepCounts   → omits the count (correct: production is now authoritative)
//   fetchHistoricalPrepCounts → returns the count (correct: it was a real physical observation)

import { supabase } from '../core/supabase-client.js';

// Columns shared by both models
const SHARED_COLUMNS = [
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

// reconcile_status values that mark a count as permanently invalid.
// These are excluded from BOTH read models.
// NULL reconcile_status = not yet reconciled = still valid.
const EXCLUDED_RECONCILE_STATUSES = ['invalid_test_data', 'corrected_unit_error'];

// ── LIVE BASELINE read model ──────────────────────────────────────────
//
// Returns only counts that have not been superseded by a production event.
// A count is superseded when rpc_oee_record_prep_completion sets
// expires_at = production.occurred_at (a past timestamp).
//
// This is what the bot-prep-suggester also uses (via its own query).
// These two must remain semantically consistent.

/**
 * @param {unknown[]} prepTaskIds
 * @returns {Promise<{ok: boolean, countsByPrepTaskId: object}>}
 */
export async function fetchRecentPrepCounts(prepTaskIds) {
  const validIds = _normalizeIds(prepTaskIds);
  if (validIds.length === 0) return { ok: true, countsByPrepTaskId: {} };

  const now = new Date();
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();

  try {
    const excludedFilter = EXCLUDED_RECONCILE_STATUSES.join(',');
    const { data, error } = await supabase
      .from('prep_stock_counts')
      .select(SHARED_COLUMNS)
      .in('prep_task_id', validIds)
      .gte('counted_at', cutoff)
      // exclude invalid/corrected rows (NULL reconcile_status is valid)
      .or(`reconcile_status.is.null,reconcile_status.not.in.(${excludedFilter})`)
      .order('counted_at', { ascending: false });

    if (error) return { ok: false, reason: 'CONNECTION_ERROR', countsByPrepTaskId: {} };

    const countsByPrepTaskId = {};
    for (const row of (data ?? [])) {
      const taskId = row.prep_task_id;
      if (Object.prototype.hasOwnProperty.call(countsByPrepTaskId, taskId)) continue;
      // LIVE BASELINE: skip rows where expires_at is in the past
      // (these have been superseded by a production event)
      if (row.expires_at !== null && row.expires_at <= nowIso) continue;
      countsByPrepTaskId[taskId] = _normalizeRow(row);
    }

    return { ok: true, countsByPrepTaskId };
  } catch {
    return { ok: false, reason: 'CONNECTION_ERROR', countsByPrepTaskId: {} };
  }
}

// ── PHYSICAL COUNT HISTORY read model ─────────────────────────────────
//
// Returns the most recent legitimate physical count per task,
// regardless of whether it has been superseded by production.
// Used by "Last physical count" in the station-prep detail panel.
//
// A cook physically walked to the shelf and counted. That observation
// is permanent history even if production has since changed the live stock.
// expires_at means "no longer the live baseline" — it does NOT mean
// "this observation never happened."

/**
 * @param {unknown[]} prepTaskIds
 * @returns {Promise<{ok: boolean, countsByPrepTaskId: object}>}
 */
export async function fetchHistoricalPrepCounts(prepTaskIds) {
  const validIds = _normalizeIds(prepTaskIds);
  if (validIds.length === 0) return { ok: true, countsByPrepTaskId: {} };

  try {
    const excludedFilter = EXCLUDED_RECONCILE_STATUSES.join(',');
    const { data, error } = await supabase
      .from('prep_stock_counts')
      .select(SHARED_COLUMNS)
      .in('prep_task_id', validIds)
      // exclude invalid/corrected rows only — NOT excluded based on expires_at
      .or(`reconcile_status.is.null,reconcile_status.not.in.(${excludedFilter})`)
      .order('counted_at', { ascending: false });

    if (error) return { ok: false, reason: 'CONNECTION_ERROR', countsByPrepTaskId: {} };

    // Take only the most recent count per task (rows are DESC by counted_at)
    const countsByPrepTaskId = {};
    for (const row of (data ?? [])) {
      const taskId = row.prep_task_id;
      if (!Object.prototype.hasOwnProperty.call(countsByPrepTaskId, taskId)) {
        countsByPrepTaskId[taskId] = _normalizeRow(row);
      }
    }

    return { ok: true, countsByPrepTaskId };
  } catch {
    return { ok: false, reason: 'CONNECTION_ERROR', countsByPrepTaskId: {} };
  }
}

// ── Shared helpers ────────────────────────────────────────────────────

function _normalizeIds(prepTaskIds) {
  if (!Array.isArray(prepTaskIds)) return [];
  const seen = new Set();
  const result = [];
  for (const id of prepTaskIds) {
    const n = Number(id);
    if (Number.isFinite(n) && n > 0 && !seen.has(n)) {
      seen.add(n);
      result.push(n);
    }
  }
  return result;
}

function _normalizeRow(row) {
  return {
    prepTaskId:         row.prep_task_id,
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
