// BOH OS v2 — Prep Count Reconciler Service
// Task 004W: invokes bot-prep-count-reconciler for one saved physical count.
//
// Live contract verified from:
//   - js/prep.js saveKitchenCount (production call, lines 2067–2079)
//   - bot-prep-count-reconciler Edge Function source (Supabase, v1, verify_jwt: false)
//
// Edge Function: bot-prep-count-reconciler
// Request payload: { prep_task_id, count_id }
// Response shape: fields directly on data (top-level):
//   ok, reconcile_status, reconciled_qty, reconciled_note, expires_at,
//   prep_task_id, count_id, item_name, counted_qty, unit, debug
// Rejection: { error } with HTTP 400/404/500
//
// Does not write to prep_stock_counts or prep_tasks.
// Does not query database tables.
// No window writes. No storage. No retry.

import { supabase } from '../core/supabase-client.js';

// ── Exported API ──────────────────────────────────────────────────────

/**
 * Invokes the bot-prep-count-reconciler Edge Function for one saved count.
 *
 * Does not write to any database table directly.
 * The Edge Function writes reconciliation fields to prep_stock_counts.
 *
 * @param {{
 *   prepTaskId: number,
 *   countId:    number
 * }} options
 * @returns {Promise<{
 *   ok: boolean,
 *   reason?: string,
 *   reconciliation: {
 *     prepTaskId:         number,
 *     countId:            number,
 *     reconcileStatus:    string | null,
 *     reconciledQuantity: number | null,
 *     reconciledNote:     string | null,
 *     expiresAt:          string | null
 *   } | null
 * }>}
 */
export async function reconcilePrepCount({ prepTaskId, countId }) {
  // ── Input validation ─────────────────────────────────────────────
  const idValid    = Number.isFinite(prepTaskId) && prepTaskId > 0;
  const countValid = Number.isFinite(countId) && countId > 0;

  if (!idValid || !countValid) {
    return { ok: false, reason: 'INVALID_INPUT', reconciliation: null };
  }

  // ── Invoke Edge Function ─────────────────────────────────────────
  // Payload verified from live production code (js/prep.js line 2073) and
  // Edge Function source (body destructuring: { prep_task_id, count_id }).
  let data;
  let fnError;
  try {
    const result = await supabase.functions.invoke('bot-prep-count-reconciler', {
      body: {
        prep_task_id: prepTaskId,
        count_id:     countId,
      },
    });
    data    = result.data;
    fnError = result.error;
  } catch {
    return { ok: false, reason: 'CONNECTION_ERROR', reconciliation: null };
  }

  // ── Function-level failure ───────────────────────────────────────
  // fnError is set when supabase.functions.invoke itself fails (network/auth).
  if (fnError) {
    return { ok: false, reason: 'CONNECTION_ERROR', reconciliation: null };
  }

  // ── Application-level rejection ──────────────────────────────────
  // The Edge Function returns { error: '...' } with HTTP 400/404/500 on failure.
  // data.ok === false or data.error present → reconciliation did not complete.
  if (!data || data.ok === false || data.error) {
    return { ok: false, reason: 'RECONCILIATION_FAILED', reconciliation: null };
  }

  // ── Normalize success response ───────────────────────────────────
  // Response fields are directly on data (top-level), verified from Edge Function
  // source (step 9 — return JSON with top-level reconcile_status etc.).
  return {
    ok: true,
    reconciliation: {
      prepTaskId:         data.prep_task_id   ?? prepTaskId,
      countId:            data.count_id       ?? countId,
      reconcileStatus:    data.reconcile_status  ?? null,
      reconciledQuantity: data.reconciled_qty    ?? null,
      reconciledNote:     data.reconciled_note   ?? null,
      expiresAt:          data.expires_at        ?? null,
    },
  };
}
