// BOH OS v2 — Prep Production Edge Function Service (Phase 3A)
// Routes all production writes through record-prep-production-v2 EF.
//
// Covers three semantic paths:
//   MARK DONE          — in_progress_at = real task.inProgressAt (closes WIP)
//   RECORD PRODUCTION  — in_progress_at = null (no WIP created)
//   RECORD MORE        — in_progress_at = null (additional event, no WIP)
//
// The frontend NEVER calls rpc_oee_record_prep_completion directly.
// The frontend NEVER uses a service-role key.
//
// Response contract (normalised camelCase):
//   {
//     ok, idempotent, productionRecorded, suggestionRecalculated,
//     task, log, suggestion, warning
//   }
//
//   task:       null | { id, currentStock, needTomorrow, inProgress, inProgressAt, inProgressBy }
//   log:        null | { taskName, station, quantity, unit, userName, startedAt,
//                        durationMinutes, isSuggestedQuantity, createdAt }
//   suggestion: null | camelCase suggestion row
//   warning:    null | 'SUGGESTION_REFRESH_FAILED'
//
// No UI. No DOM. No window writes. No storage writes.

import { getStoredToken } from './auth-service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ── Supabase endpoint ─────────────────────────────────────────────────
// Matches the project ID used across all BOH v2 services.

const EF_URL = 'https://ydqmumpytgrlceuinoqt.supabase.co/functions/v1/record-prep-production-v2';

// ── Input validation ──────────────────────────────────────────────────

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

// ── UUID generator ────────────────────────────────────────────────────

export function generateOperationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0,8), hex.slice(8,12), hex.slice(12,16), hex.slice(16,20), hex.slice(20,32)].join('-');
}

// ── Normalizers ───────────────────────────────────────────────────────

function normalizeLog(raw) {
  if (!raw) return null;
  return {
    taskName:            raw.item        ?? null,
    station:             raw.station     ?? null,
    quantity:            raw.qty         ?? null,
    unit:                raw.unit        ?? null,
    userName:            raw.user_name   ?? null,
    startedAt:           raw.started_at  ?? null,
    durationMinutes:     raw.duration_minutes ?? null,
    isSuggestedQuantity: raw.is_suggested_qty ?? false,
    createdAt:           raw.created_at  ?? null,
  };
}

function normalizeTask(raw) {
  if (!raw) return null;
  return {
    id:           raw.id,
    currentStock: raw.current_stock  ?? null,
    needTomorrow: raw.need_tomorrow  ?? false,
    inProgress:   raw.in_progress    ?? false,
    inProgressAt: raw.in_progress_at ?? null,
    inProgressBy: raw.in_progress_by ?? null,
  };
}

function normalizeSuggestion(raw) {
  if (!raw) return null;
  return {
    status:                      raw.status                        ?? null,
    confidence:                  raw.confidence                    ?? null,
    plannedOutput:               raw.planned_output                ?? null,
    outputUnit:                  raw.output_unit                   ?? null,
    currentStock:                raw.current_stock                 ?? null,
    stockSource:                 raw.stock_source                  ?? null,
    stockUnit:                   raw.stock_unit                    ?? null,
    netRequirement:              raw.net_requirement               ?? null,
    forecast:                    raw.forecast                      ?? null,
    coverageDays:                raw.coverage_days                 ?? null,
    demandSource:                raw.demand_source                 ?? null,
    reason:                      raw.reason                        ?? null,
    productionConstraintQuality: raw.production_constraint_quality ?? null,
  };
}

// ── Core POST helper ──────────────────────────────────────────────────

async function postToEf(body) {
  const token = getStoredToken();
  if (!token) {
    return { ok: false, reason: 'CONNECTION_ERROR', retriable: false };
  }

  let producerId = null;
  try {
    producerId = localStorage.getItem('brigade_install_id') ?? null;
  } catch { /* ignore */ }

  const payload = {
    brigade_token:      token,
    task_id:            body.taskId,
    quantity:           body.quantity,
    unit:               body.unit,
    client_operation_id:body.clientOperationId,
    occurred_at:        body.occurredAt,
    in_progress_at:     body.inProgressAt ?? null,
    is_suggested_qty:   body.isSuggestedQty ?? false,
    producer_id:        producerId,
  };

  let resp;
  try {
    resp = await fetch(EF_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
  } catch {
    // Network error — server state unknown.
    return { ok: false, reason: 'CONNECTION_ERROR', retriable: true };
  }

  let data;
  try {
    data = await resp.json();
  } catch {
    return { ok: false, reason: 'CONNECTION_ERROR', retriable: resp.status >= 500 };
  }

  if (!resp.ok) {
    const reason = data?.reason ?? data?.error ?? 'CONNECTION_ERROR';
    // 401 = auth; 409 = idempotency conflict — both definitive (not retriable)
    const retriable = resp.status >= 500 && resp.status !== 409;
    return { ok: false, reason, retriable };
  }

  if (!data || data.ok === false) {
    const reason = data?.reason ?? data?.error ?? 'CONNECTION_ERROR';
    return { ok: false, reason, retriable: false };
  }

  return {
    ok:                    true,
    idempotent:            data.idempotent            ?? false,
    productionRecorded:    data.production_recorded   ?? true,
    suggestionRecalculated:data.suggestion_recalculated ?? false,
    task:                  normalizeTask(data.task),
    log:                   normalizeLog(data.log),
    suggestion:            normalizeSuggestion(data.suggestion),
    warning:               data.warning ?? null,
  };
}

// ── Exported API ──────────────────────────────────────────────────────

/**
 * Mark done — closes WIP and records production.
 * Caller must supply prepTask.inProgressAt (the real start timestamp).
 *
 * @param {{
 *   prepTask:          { id: number, inProgressAt: string|null },
 *   quantity:          number,
 *   unit:              string,
 *   clientOperationId: string,   (UUID v4, caller-owned)
 *   occurredAt:        string,   (ISO timestamp, caller-owned)
 * }} options
 */
export async function markDoneViaEf({ prepTask, quantity, unit, clientOperationId, occurredAt }) {
  if (!prepTask || !isValidTaskId(prepTask.id)) {
    return { ok: false, reason: 'INVALID_INPUT', retriable: false };
  }
  if (!isValidQuantity(quantity)) {
    return { ok: false, reason: 'INVALID_INPUT', retriable: false };
  }
  if (!isNonEmptyString(unit)) {
    return { ok: false, reason: 'INVALID_INPUT', retriable: false };
  }
  if (!isValidOperationId(clientOperationId)) {
    return { ok: false, reason: 'INVALID_INPUT', retriable: false };
  }
  if (!isValidTimestamp(occurredAt)) {
    return { ok: false, reason: 'INVALID_INPUT', retriable: false };
  }

  return postToEf({
    taskId:           prepTask.id,
    quantity,
    unit,
    clientOperationId,
    occurredAt,
    inProgressAt:     prepTask.inProgressAt ?? null,  // real start → closes WIP
    isSuggestedQty:   false,
  });
}

/**
 * Record production — records completed work without closing WIP.
 * Used for both "Record production" (no prior WIP) and "Record more".
 * in_progress_at is always null — no WIP event is created.
 *
 * @param {{
 *   taskId:            number,
 *   quantity:          number,
 *   unit:              string,
 *   clientOperationId: string,
 *   occurredAt:        string,
 * }} options
 */
export async function recordProductionViaEf({ taskId, quantity, unit, clientOperationId, occurredAt }) {
  if (!isValidTaskId(taskId)) {
    return { ok: false, reason: 'INVALID_INPUT', retriable: false };
  }
  if (!isValidQuantity(quantity)) {
    return { ok: false, reason: 'INVALID_INPUT', retriable: false };
  }
  if (!isNonEmptyString(unit)) {
    return { ok: false, reason: 'INVALID_INPUT', retriable: false };
  }
  if (!isValidOperationId(clientOperationId)) {
    return { ok: false, reason: 'INVALID_INPUT', retriable: false };
  }
  if (!isValidTimestamp(occurredAt)) {
    return { ok: false, reason: 'INVALID_INPUT', retriable: false };
  }

  return postToEf({
    taskId,
    quantity,
    unit,
    clientOperationId,
    occurredAt,
    inProgressAt:  null,   // no WIP — both "Record production" and "Record more"
    isSuggestedQty:false,
  });
}

// ── Suggestion-only refresh ───────────────────────────────────────────
// Calls refresh-prep-suggestion EF to trigger a targeted bot recalculation
// for a single task and return the fresh suggestion.
//
// Used by station-prep.js when production_recorded=true but
// suggestion_recalculated=false (Phase 3F recovery path).
//
// No production write. No stock write. No prep_log write.
// The backend enforces suggestion_date server-side (America/Chicago).
//
// @param {number} taskId
// @returns {Promise<
//   { ok: true,  recalculated: true,  suggestion: object } |
//   { ok: false, recalculated: false, suggestion: null,   warning: 'SUGGESTION_REFRESH_FAILED' }
// >}

const REFRESH_SUGGESTION_URL = 'https://ydqmumpytgrlceuinoqt.supabase.co/functions/v1/refresh-prep-suggestion';

export async function refreshPrepSuggestionViaEf(taskId) {
  const token = getStoredToken();
  if (!token) {
    return { ok: false, recalculated: false, suggestion: null, warning: 'SUGGESTION_REFRESH_FAILED' };
  }

  if (typeof taskId !== 'number' || !isFinite(taskId) || taskId <= 0) {
    return { ok: false, recalculated: false, suggestion: null, warning: 'SUGGESTION_REFRESH_FAILED' };
  }

  let resp;
  try {
    resp = await fetch(REFRESH_SUGGESTION_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ brigade_token: token, task_id: taskId }),
    });
  } catch {
    return { ok: false, recalculated: false, suggestion: null, warning: 'SUGGESTION_REFRESH_FAILED' };
  }

  let data;
  try {
    data = await resp.json();
  } catch {
    return { ok: false, recalculated: false, suggestion: null, warning: 'SUGGESTION_REFRESH_FAILED' };
  }

  if (!resp.ok || !data || data.ok !== true || !data.suggestion) {
    return { ok: false, recalculated: false, suggestion: null, warning: 'SUGGESTION_REFRESH_FAILED' };
  }

  // Normalize using the same normalizer as record-prep-production-v2 response.
  return {
    ok:           true,
    recalculated: true,
    suggestion:   normalizeSuggestion(data.suggestion),
    warning:      null,
  };
}
