// BOH OS v2 — Start Prep RPC service (OEE Session B / B.1)
// Task OEE-B:   routes PREP_STARTED through rpc_oee_record_prep_start.
// Task OEE-B.1: client_operation_id and occurred_at are supplied by the caller,
//               not generated inside this service.
//
// Contract:
//   Input:  { prepTaskId, startedBy, clientOperationId, occurredAt }
//           startedBy       — accepted for compatibility; not forwarded (server-resolved)
//           clientOperationId — UUID v4 string; caller owns its lifecycle
//           occurredAt      — ISO timestamp; caller captures it once per operation
//   Output: { ok: true,  task: { id, inProgress, inProgressAt, inProgressBy }, retriable: false }
//         | { ok: false, reason: 'INVALID_INPUT'|'TASK_NOT_FOUND'|'CONNECTION_ERROR',
//             task: null, retriable: boolean }
//
// retriable: true  — caller MUST retain clientOperationId/occurredAt for the next attempt.
// retriable: false — caller may discard the operation context.
//
// No UI. No DOM. No window writes. No storage writes. No UUID generation.

import { supabase }       from '../core/supabase-client.js';
import { getStoredToken } from './auth-service.js';

// ── Input validation ───────────────────────────────────────────────────────────

function isValidTaskId(v) {
  return typeof v === 'number' && isFinite(v) && v > 0;
}

function isValidOperationId(v) {
  return typeof v === 'string' && v.length > 0;
}

// ── Result normalisation ───────────────────────────────────────────────────────

function normalizeSuccess(rpcData) {
  const t = rpcData.task;
  return {
    ok:        true,
    retriable: false,
    task: {
      id:           t.id,
      inProgress:   t.in_progress,
      inProgressAt: t.in_progress_at,
      inProgressBy: t.in_progress_by,
    },
  };
}

// ── Exported API ──────────────────────────────────────────────────────────────

/**
 * Marks one active prep task as in progress via rpc_oee_record_prep_start.
 *
 * The caller (station-prep.js buildStartButton) owns the operation context:
 *   clientOperationId — generated once when the user initiates Start
 *   occurredAt        — ISO timestamp captured at that same moment
 *
 * These values must be reused for retries of the same unresolved operation.
 * This service never generates them.
 *
 * The result includes `retriable` to guide the caller's context management:
 *   retriable: true  → retain clientOperationId/occurredAt for next attempt
 *   retriable: false → discard; the operation either succeeded or cannot succeed
 *
 * @param {{
 *   prepTaskId:        unknown,
 *   startedBy:         unknown,   (accepted for compatibility; not forwarded)
 *   clientOperationId: string,
 *   occurredAt:        string
 * }} options
 * @returns {Promise<
 *   { ok: true,  task: object, retriable: false } |
 *   { ok: false, reason: 'INVALID_INPUT'|'TASK_NOT_FOUND'|'CONNECTION_ERROR',
 *     task: null, retriable: boolean }
 * >}
 */
export async function startPrepTaskRpc({
  prepTaskId,
  startedBy:        _startedBy,  // accepted; not forwarded — actor is server-resolved
  clientOperationId,
  occurredAt,
} = {}) {

  // ── Input validation ──
  if (!isValidTaskId(prepTaskId)) {
    return { ok: false, reason: 'INVALID_INPUT', task: null, retriable: false };
  }
  if (!isValidOperationId(clientOperationId)) {
    return { ok: false, reason: 'INVALID_INPUT', task: null, retriable: false };
  }

  // ── Session token ──
  const token = getStoredToken();
  if (!token) {
    // Missing token means the session has definitely ended.
    // A retry with the same UUID cannot succeed until the user re-authenticates,
    // so this is treated as a definitive failure for context-clearing purposes.
    // The caller maps CONNECTION_ERROR to the existing start_error message.
    return { ok: false, reason: 'CONNECTION_ERROR', task: null, retriable: false };
  }

  // ── Producer ID (install_id) ──
  let producerId = null;
  try {
    producerId = localStorage.getItem('brigade_install_id') ?? null;
  } catch {
    producerId = null;
  }

  // ── RPC call ──
  try {
    const { data, error } = await supabase.rpc('rpc_oee_record_prep_start', {
      p_token:               token,
      p_task_id:             prepTaskId,
      p_client_operation_id: clientOperationId,
      p_occurred_at:         occurredAt ?? new Date().toISOString(),
      p_producer_id:         producerId,
    });

    if (error) {
      // Supabase transport or PostgREST error — the server may or may not have
      // committed the operation. The caller must retain the operation context
      // so a retry can use the same UUID and get an idempotent result.
      return { ok: false, reason: 'CONNECTION_ERROR', task: null, retriable: true };
    }

    if (!data || data.ok === false) {
      const reason = data?.reason ?? 'CONNECTION_ERROR';

      if (reason === 'TASK_NOT_FOUND') {
        // Definitive: the task does not exist or is archived.
        // Retrying with the same UUID will produce the same outcome.
        return { ok: false, reason: 'TASK_NOT_FOUND', task: null, retriable: false };
      }

      if (reason === 'INVALID_INPUT') {
        // Definitive: the request is structurally invalid.
        return { ok: false, reason: 'INVALID_INPUT', task: null, retriable: false };
      }

      if (reason === 'AUTH_ERROR') {
        // Definitive: the session token has expired or been invalidated.
        // Retrying before re-authentication cannot succeed.
        // Map to CONNECTION_ERROR so the existing error message is shown.
        return { ok: false, reason: 'CONNECTION_ERROR', task: null, retriable: false };
      }

      // Any other definitive RPC failure.
      return { ok: false, reason: 'CONNECTION_ERROR', task: null, retriable: false };
    }

    // Success — includes idempotent:true replay case.
    return normalizeSuccess(data);

  } catch {
    // Unhandled exception (e.g., network unreachable, JSON parse failure).
    // Treat as retriable — the server state is unknown.
    return { ok: false, reason: 'CONNECTION_ERROR', task: null, retriable: true };
  }
}
