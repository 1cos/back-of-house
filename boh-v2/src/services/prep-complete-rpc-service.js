// BOH OS v2 — Complete Prep RPC service (OEE Session C-B)
// Task OEE-C-B: routes PREP_COMPLETED through rpc_oee_record_prep_completion.
//
// Contract:
//   Input:  { prepTask, quantity, unit, completedBy,
//              clientOperationId, occurredAt }
//           prepTask.id        — task identifier
//           prepTask.inProgressAt — forwarded for duration calc (may be null)
//           clientOperationId  — UUID v4; caller-owned lifecycle
//           occurredAt         — ISO timestamp; caller-owned
//           completedBy        — accepted for compatibility; not forwarded (actor is server-resolved)
//           prepTask.{name,station,currentStock} — not sent; server resolves
//
//   Output: { ok: true,  log, task, retriable: false }
//         | { ok: false, reason, log: null, task: null, retriable: boolean }
//
// retriable: true  — caller retains clientOperationId/occurredAt/quantity/unit for next attempt.
// retriable: false — caller clears the pending operation context.
//
// Log result shape matches legacy prep-complete-service.js exactly:
//   { taskName, station, quantity, unit, userName, startedAt,
//     durationMinutes, isSuggestedQuantity, createdAt }
//
// Task result shape matches legacy exactly:
//   { id, currentStock, needTomorrow, inProgress, inProgressAt, inProgressBy }
//
// No UI. No DOM. No window writes. No storage writes. No UUID generation.

import { supabase }       from '../core/supabase-client.js';
import { getStoredToken } from './auth-service.js';

// ── Input validation ──────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidTaskId(v) {
  return typeof v === 'number' && isFinite(v) && v > 0;
}

function isValidQuantity(v) {
  return typeof v === 'number' && isFinite(v) && v > 0;
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isValidOperationId(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

function isValidTimestamp(v) {
  if (typeof v !== 'string' || v.length === 0) return false;
  return !isNaN(new Date(v).getTime());
}

// ── Result normalisation ──────────────────────────────────────────────────────

function normalizeLog(rpcLog) {
  return {
    taskName:            rpcLog.item,
    station:             rpcLog.station,
    quantity:            rpcLog.qty,
    unit:                rpcLog.unit,
    userName:            rpcLog.user_name,
    startedAt:           rpcLog.started_at,
    durationMinutes:     rpcLog.duration_minutes,
    isSuggestedQuantity: rpcLog.is_suggested_qty,
    createdAt:           rpcLog.created_at,
  };
}

function normalizeTask(rpcTask) {
  return {
    id:           rpcTask.id,
    currentStock: rpcTask.current_stock,
    needTomorrow: rpcTask.need_tomorrow,
    inProgress:   rpcTask.in_progress,
    inProgressAt: rpcTask.in_progress_at,
    inProgressBy: rpcTask.in_progress_by,
  };
}

// ── Exported API ──────────────────────────────────────────────────────────────

/**
 * Records prep task completion via rpc_oee_record_prep_completion.
 *
 * The caller owns clientOperationId and occurredAt for idempotency.
 * Identical quantity+unit on retry reuses the same UUID for safe replay.
 *
 * @param {{
 *   prepTask:          { id: number, inProgressAt: string|null, [rest]: any },
 *   quantity:          number,
 *   unit:              string,
 *   completedBy:       string,    (accepted; not forwarded — server-resolved)
 *   clientOperationId: string,    (UUID v4)
 *   occurredAt:        string     (ISO timestamp)
 * }} options
 * @returns {Promise<
 *   { ok: true,  log: object, task: object, retriable: false } |
 *   { ok: false, reason: string, log: null, task: null, retriable: boolean }
 * >}
 */
export async function completePrepTaskRpc({
  prepTask,
  quantity,
  unit,
  completedBy:      _completedBy,  // accepted; not forwarded — actor is server-resolved
  clientOperationId,
  occurredAt,
} = {}) {

  // ── Local input validation ──
  if (!prepTask || !isValidTaskId(prepTask.id)) {
    return { ok: false, reason: 'INVALID_INPUT', log: null, task: null, retriable: false };
  }
  if (!isValidQuantity(quantity)) {
    return { ok: false, reason: 'INVALID_INPUT', log: null, task: null, retriable: false };
  }
  if (!isNonEmptyString(unit)) {
    return { ok: false, reason: 'INVALID_INPUT', log: null, task: null, retriable: false };
  }
  if (!isValidOperationId(clientOperationId)) {
    return { ok: false, reason: 'INVALID_INPUT', log: null, task: null, retriable: false };
  }
  if (!isValidTimestamp(occurredAt)) {
    return { ok: false, reason: 'INVALID_INPUT', log: null, task: null, retriable: false };
  }

  // ── Session token ──
  const token = getStoredToken();
  if (!token) {
    return { ok: false, reason: 'CONNECTION_ERROR', log: null, task: null, retriable: false };
  }

  // ── Producer ID ──
  let producerId = null;
  try {
    producerId = localStorage.getItem('brigade_install_id') ?? null;
  } catch {
    producerId = null;
  }

  // ── RPC call ──
  try {
    const { data, error } = await supabase.rpc('rpc_oee_record_prep_completion', {
      p_token:               token,
      p_task_id:             prepTask.id,
      p_quantity:            quantity,
      p_unit:                unit,
      p_client_operation_id: clientOperationId,
      p_occurred_at:         occurredAt,
      p_in_progress_at:      prepTask.inProgressAt ?? null,
      p_is_suggested_qty:    false,
      p_producer_id:         producerId,
    });

    if (error) {
      // Transport/PostgREST error — server state unknown. Caller retains context.
      return { ok: false, reason: 'CONNECTION_ERROR', log: null, task: null, retriable: true };
    }

    if (!data || data.ok === false) {
      const reason = data?.reason ?? 'CONNECTION_ERROR';

      if (reason === 'TASK_NOT_FOUND') {
        return { ok: false, reason: 'TASK_NOT_FOUND', log: null, task: null, retriable: false };
      }
      if (reason === 'INVALID_INPUT') {
        return { ok: false, reason: 'INVALID_INPUT', log: null, task: null, retriable: false };
      }
      if (reason === 'AUTH_ERROR') {
        return { ok: false, reason: 'CONNECTION_ERROR', log: null, task: null, retriable: false };
      }
      if (reason === 'IDEMPOTENCY_KEY_CONFLICT') {
        // Definitive: this UUID was used for a different operation.
        // Caller clears the pending context.
        return { ok: false, reason: 'CONNECTION_ERROR', log: null, task: null, retriable: false };
      }
      // Any other definitive failure.
      return { ok: false, reason: 'CONNECTION_ERROR', log: null, task: null, retriable: false };
    }

    // Success (includes idempotent:true replay).
    return {
      ok:        true,
      log:       normalizeLog(data.log),
      task:      normalizeTask(data.task),
      retriable: false,
    };

  } catch {
    // Unhandled exception — server state unknown. Caller retains context.
    return { ok: false, reason: 'CONNECTION_ERROR', log: null, task: null, retriable: true };
  }
}
