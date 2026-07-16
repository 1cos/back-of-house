// BOH OS v2 — Count Prep RPC service (OEE Session D-B)
// Task OEE-D-B: routes STOCK_COUNT_RECORDED through rpc_oee_record_stock_count.
//
// Contract:
//   Input:  { prepTaskId, countedQuantity, unit, countedBy,
//              clientOperationId, occurredAt }
//           countedBy        — accepted for compatibility; not forwarded (actor is server-resolved)
//           clientOperationId — UUID v4; caller-owned lifecycle
//           occurredAt        — ISO timestamp; caller-owned
//           countedQuantity   — number >= 0 (zero is valid: physically empty)
//
//   Output: { ok: true,  count, task, retriable: false }
//         | { ok: false, reason, count: null, task: null, retriable: boolean }
//
// retriable: true  — caller retains clientOperationId/occurredAt/qty/unit for next attempt.
// retriable: false — caller clears the pending operation context.
//
// Count result shape matches legacy prep-count-write-service.js exactly:
//   { id, prepTaskId, countedQuantity, unit, countedBy, source,
//     countedAt, previousBotStock, previousBotSuggestion, previousSuggestedBy }
//
// Task result shape matches legacy exactly:
//   { id, currentStock }
//
// No UI. No DOM. No window writes. No storage writes. No UUID generation.

import { supabase }       from '../core/supabase-client.js';
import { getStoredToken } from './auth-service.js';

// ── Input validation ──────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidTaskId(v) {
  return typeof v === 'number' && isFinite(v) && v > 0;
}

// countedQuantity >= 0 is valid — zero means the shelf is physically empty.
function isValidCountedQuantity(v) {
  return typeof v === 'number' && isFinite(v) && v >= 0;
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
// RPC returns snake_case; legacy callers (buildCountButton, onCountSuccess)
// expect camelCase matching prep-count-write-service.js exactly.

function normalizeCount(rpcCount) {
  return {
    id:                    rpcCount.id,
    prepTaskId:            rpcCount.prep_task_id,
    countedQuantity:       rpcCount.counted_qty,
    unit:                  rpcCount.unit,
    countedBy:             rpcCount.counted_by,
    source:                rpcCount.source,
    countedAt:             rpcCount.counted_at,
    previousBotStock:      rpcCount.prev_bot_stock,
    previousBotSuggestion: rpcCount.prev_bot_suggestion,
    previousSuggestedBy:   rpcCount.prev_suggested_by,
  };
}

function normalizeTask(rpcTask) {
  return {
    id:           rpcTask.id,
    currentStock: rpcTask.current_stock,
  };
}

// ── Exported API ──────────────────────────────────────────────────────────────

/**
 * Records one physical prep stock count via rpc_oee_record_stock_count.
 *
 * The caller (buildCountButton in station-prep.js) owns clientOperationId
 * and occurredAt. These values must be reused for retries of the same
 * unresolved operation. This service never generates them.
 *
 * @param {{
 *   prepTaskId:        number,
 *   countedQuantity:   number,   (>= 0; zero is valid)
 *   unit:              string,
 *   countedBy:         string,   (accepted; not forwarded — actor is server-resolved)
 *   clientOperationId: string,   (UUID v4)
 *   occurredAt:        string    (ISO timestamp)
 * }} options
 * @returns {Promise<
 *   { ok: true,  count: object, task: object, retriable: false } |
 *   { ok: false, reason: string, count: null, task: null, retriable: boolean }
 * >}
 */
export async function savePrepCountRpc({
  prepTaskId,
  countedQuantity,
  unit,
  countedBy:         _countedBy,  // accepted; not forwarded — actor is server-resolved
  clientOperationId,
  occurredAt,
} = {}) {

  // ── Input validation ──
  if (!isValidTaskId(prepTaskId)) {
    return { ok: false, reason: 'INVALID_INPUT', count: null, task: null, retriable: false };
  }
  if (!isValidCountedQuantity(countedQuantity)) {
    // null, undefined, negative, non-finite all rejected.
    // Zero is explicitly allowed (verified empty shelf).
    return { ok: false, reason: 'INVALID_INPUT', count: null, task: null, retriable: false };
  }
  if (!isNonEmptyString(unit)) {
    return { ok: false, reason: 'INVALID_INPUT', count: null, task: null, retriable: false };
  }
  if (!isValidOperationId(clientOperationId)) {
    return { ok: false, reason: 'INVALID_INPUT', count: null, task: null, retriable: false };
  }
  if (!isValidTimestamp(occurredAt)) {
    // occurredAt is required — never fall back to now().
    // The caller closure owns it and must supply it.
    return { ok: false, reason: 'INVALID_INPUT', count: null, task: null, retriable: false };
  }

  // ── Session token ──
  const token = getStoredToken();
  if (!token) {
    // Session ended. Definitive failure — retrying with the same UUID cannot
    // succeed until the user re-authenticates.
    return { ok: false, reason: 'CONNECTION_ERROR', count: null, task: null, retriable: false };
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
    const { data, error } = await supabase.rpc('rpc_oee_record_stock_count', {
      p_token:               token,
      p_task_id:             prepTaskId,
      p_counted_quantity:    countedQuantity,
      p_unit:                unit,
      p_client_operation_id: clientOperationId,
      p_occurred_at:         occurredAt,
      p_producer_id:         producerId,
    });

    if (error) {
      // Supabase transport or PostgREST error — server state unknown.
      // Caller retains clientOperationId/occurredAt/qty/unit for retry.
      return { ok: false, reason: 'CONNECTION_ERROR', count: null, task: null, retriable: true };
    }

    if (!data || data.ok === false) {
      const reason = data?.reason ?? 'CONNECTION_ERROR';

      if (reason === 'TASK_NOT_FOUND') {
        return { ok: false, reason: 'TASK_NOT_FOUND', count: null, task: null, retriable: false };
      }
      if (reason === 'INVALID_INPUT') {
        return { ok: false, reason: 'INVALID_INPUT', count: null, task: null, retriable: false };
      }
      if (reason === 'AUTH_ERROR') {
        // Session expired server-side. Map to CONNECTION_ERROR for existing UI.
        return { ok: false, reason: 'CONNECTION_ERROR', count: null, task: null, retriable: false };
      }
      if (reason === 'IDEMPOTENCY_KEY_CONFLICT') {
        // UUID was used for a different operation. Caller must discard pendingCountOp.
        return { ok: false, reason: 'CONNECTION_ERROR', count: null, task: null, retriable: false };
      }
      // Any other definitive RPC failure.
      return { ok: false, reason: 'CONNECTION_ERROR', count: null, task: null, retriable: false };
    }

    // Success (includes idempotent:true replay).
    // Normalise to camelCase to match legacy prep-count-write-service.js shape.
    return {
      ok:        true,
      count:     normalizeCount(data.count),
      task:      normalizeTask(data.task),
      retriable: false,
    };

  } catch {
    // Unhandled exception — server state unknown. Caller retains context.
    return { ok: false, reason: 'CONNECTION_ERROR', count: null, task: null, retriable: true };
  }
}
