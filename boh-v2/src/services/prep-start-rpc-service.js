// BOH OS v2 — Start Prep RPC service (OEE Session B)
// Task OEE-B: routes PREP_STARTED through rpc_oee_record_prep_start.
//
// Replaces the direct Supabase table write in prep-start-service.js with an
// atomic RPC call that also records the event in operational_events.
//
// Contract preserved (identical to prep-start-service.js):
//   Input:  { prepTaskId: number, startedBy: string }  (startedBy ignored — server-resolved)
//   Output: { ok: true,  task: { id, inProgress, inProgressAt, inProgressBy } }
//         | { ok: false, reason: 'INVALID_INPUT'|'TASK_NOT_FOUND'|'CONNECTION_ERROR', task: null }
//
// Actor identity is resolved server-side from the brigade session token.
// The startedBy parameter is accepted for interface compatibility but is not
// forwarded to the RPC — the server reads the actor from the validated session.
//
// No UI. No DOM. No window writes. No storage writes.

import { supabase }      from '../core/supabase-client.js';
import { getStoredToken } from './auth-service.js';

// ── UUID helper ───────────────────────────────────────────────────────────────
// Returns a cryptographically random UUID v4.
// Uses crypto.randomUUID() when available (Chrome 92+, Safari 15.4+, Firefox 95+).
// Falls back to crypto.getRandomValues() for older environments.
// Never uses Math.random() — not suitable as an idempotency key.

function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback using crypto.getRandomValues() — RFC 4122 v4 format.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Set version (4) and variant bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

// ── Input validation (mirrors prep-start-service.js) ─────────────────────────

function isValidTaskId(v) {
  return typeof v === 'number' && isFinite(v) && v > 0;
}

// ── Normalise RPC result → service result shape ───────────────────────────────

function normalizeSuccess(rpcData) {
  const t = rpcData.task;
  return {
    ok: true,
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
 * Records one PREP_STARTED root event and five lifecycle transitions in
 * operational_events / operational_event_transitions.
 *
 * The startedBy parameter is accepted for interface compatibility with the
 * existing startTask injection contract in station-prep.js, but is not
 * forwarded — actor identity is resolved server-side from the brigade session.
 *
 * @param {{ prepTaskId: unknown, startedBy: unknown }} options
 * @returns {Promise<
 *   { ok: true,  task: { id: number, inProgress: boolean, inProgressAt: string, inProgressBy: string } } |
 *   { ok: false, reason: 'INVALID_INPUT' | 'TASK_NOT_FOUND' | 'CONNECTION_ERROR', task: null }
 * >}
 */
export async function startPrepTaskRpc({ prepTaskId, startedBy: _startedBy } = {}) {
  // ── Input validation ──
  if (!isValidTaskId(prepTaskId)) {
    return { ok: false, reason: 'INVALID_INPUT', task: null };
  }

  // ── Session token ──
  // Retrieved from sessionStorage via the proven auth-service path.
  // If the token is absent, the session has expired — map to CONNECTION_ERROR
  // so the existing error path in station-prep.js handles it without change.
  const token = getStoredToken();
  if (!token) {
    return { ok: false, reason: 'CONNECTION_ERROR', task: null };
  }

  // ── Generate one immutable operation key for this Start action ──
  // Generated once here — this is the point of intentional user submission.
  // A retry of the same RPC call MUST reuse this key. Because this function
  // is called once per button tap (station-prep.js guards against re-entry
  // with its `submitting` flag), each button tap produces exactly one UUID
  // and at most one network call per UUID.
  const clientOperationId = generateUUID();
  const occurredAt = new Date().toISOString();

  // ── Producer ID (install_id) ──
  // auth-service.js already reads/writes brigade_install_id in localStorage.
  // We read it directly here without adding new storage infrastructure.
  // If unavailable (private browsing), pass null — the RPC accepts null.
  let producerId = null;
  try {
    producerId = localStorage.getItem('brigade_install_id') ?? null;
  } catch {
    // localStorage unavailable — private browsing or sandboxed context.
    producerId = null;
  }

  // ── RPC call ──
  try {
    const { data, error } = await supabase.rpc('rpc_oee_record_prep_start', {
      p_token:               token,
      p_task_id:             prepTaskId,
      p_client_operation_id: clientOperationId,
      p_occurred_at:         occurredAt,
      p_producer_id:         producerId,
    });

    if (error) {
      return { ok: false, reason: 'CONNECTION_ERROR', task: null };
    }

    if (!data || data.ok === false) {
      // Map RPC failure reasons to the existing service result contract.
      const reason = data?.reason ?? 'CONNECTION_ERROR';
      if (reason === 'TASK_NOT_FOUND') {
        return { ok: false, reason: 'TASK_NOT_FOUND', task: null };
      }
      if (reason === 'INVALID_INPUT') {
        return { ok: false, reason: 'INVALID_INPUT', task: null };
      }
      // AUTH_ERROR and all other failures → CONNECTION_ERROR
      // (existing error handler shows the same start_error message for all non-OK results)
      return { ok: false, reason: 'CONNECTION_ERROR', task: null };
    }

    return normalizeSuccess(data);
  } catch {
    return { ok: false, reason: 'CONNECTION_ERROR', task: null };
  }
}
