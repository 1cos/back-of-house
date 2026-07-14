// BOH OS v2 — Complete Prep write service
// Task 004N: inserts one prep_log row and updates the matching prep_tasks row.
//
// Schema verified against production Brigade js/prep.js Done flow:
//   prep_log fields used: item, station, qty, unit, user_name,
//                         started_at, duration_minutes, is_suggested_qty
//   prep_tasks fields updated: current_stock, need_tomorrow, in_progress,
//                              in_progress_at, in_progress_by,
//                              suggested_qty, suggested_note
//
// No UI. Not yet connected to Station Prep. No window writes. No storage.

import { supabase } from '../core/supabase-client.js';

// ── Input validation helpers ──────────────────────────────────────────

function isFinitePositive(v) {
  return typeof v === 'number' && isFinite(v) && v > 0;
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Validates the prepTask object.
 * Does not mutate prepTask.
 *
 * @param {unknown} prepTask
 * @returns {boolean}
 */
function isValidPrepTask(prepTask) {
  if (!prepTask || typeof prepTask !== 'object') return false;
  if (!isFinitePositive(prepTask.id)) return false;
  if (!isNonEmptyString(prepTask.name)) return false;
  if (!isNonEmptyString(prepTask.station)) return false;
  // currentStock: finite number or null
  const cs = prepTask.currentStock;
  if (cs !== null && !(typeof cs === 'number' && isFinite(cs))) return false;
  // inProgressAt: non-empty string or null (not validated as a date here)
  const ipa = prepTask.inProgressAt;
  if (ipa !== null && ipa !== undefined) {
    if (typeof ipa !== 'string' || ipa.trim().length === 0) return false;
  }
  return true;
}

// ── Duration calculation ──────────────────────────────────────────────

/**
 * Calculates duration in whole minutes between inProgressAt and completedAt.
 * Returns null when inProgressAt is missing, empty, or invalid.
 * Never returns a negative value.
 *
 * @param {string|null|undefined} inProgressAt
 * @param {Date} completedAt
 * @returns {number|null}
 */
function calcDurationMinutes(inProgressAt, completedAt) {
  if (!inProgressAt) return null;
  const startedAt = new Date(inProgressAt);
  if (isNaN(startedAt.getTime())) return null;
  return Math.max(0, Math.round((completedAt.getTime() - startedAt.getTime()) / 60000));
}

// ── Result normalization ──────────────────────────────────────────────

function normalizeLog(row) {
  return {
    taskName:            row.item,
    station:             row.station,
    quantity:            row.qty,
    unit:                row.unit,
    userName:            row.user_name,
    startedAt:           row.started_at,
    durationMinutes:     row.duration_minutes,
    isSuggestedQuantity: row.is_suggested_qty,
    createdAt:           row.created_at,
  };
}

function normalizeTask(row) {
  return {
    id:           row.id,
    currentStock: row.current_stock,
    needTomorrow: row.need_tomorrow,
    inProgress:   row.in_progress,
    inProgressAt: row.in_progress_at,
    inProgressBy: row.in_progress_by,
  };
}

// ── Exported API ──────────────────────────────────────────────────────

/**
 * Completes one in-progress prep task:
 *   1. Validates input.
 *   2. Calculates completion timestamp, duration, and new stock.
 *   3. Inserts one row into prep_log.
 *   4. Only on insert success, updates the matching prep_tasks row.
 *   5. Returns normalized results.
 *
 * @param {{
 *   prepTask:    { id, name, station, currentStock, inProgressAt },
 *   quantity:    number,
 *   unit:        string,
 *   completedBy: string
 * }} options
 * @returns {Promise<
 *   { ok: true,  log: object, task: object } |
 *   { ok: false, reason: 'INVALID_INPUT' | 'CONNECTION_ERROR' | 'TASK_NOT_FOUND', log: object|null, task: null }
 * >}
 */
export async function completePrepTask({ prepTask, quantity, unit, completedBy } = {}) {
  // ── Step 1: Validate input ──
  if (!isValidPrepTask(prepTask) ||
      !isFinitePositive(quantity) ||
      !isNonEmptyString(unit) ||
      !isNonEmptyString(completedBy)) {
    return { ok: false, reason: 'INVALID_INPUT', log: null, task: null };
  }

  // ── Step 2: Calculate timestamp, duration, new stock ──
  const completedAt = new Date();

  const durationMinutes = calcDurationMinutes(prepTask.inProgressAt, completedAt);

  const baseStock = (typeof prepTask.currentStock === 'number' && isFinite(prepTask.currentStock))
    ? prepTask.currentStock
    : 0;
  const newCurrentStock = baseStock + quantity;

  const startedAtValue = (prepTask.inProgressAt && prepTask.inProgressAt.trim().length > 0)
    ? prepTask.inProgressAt
    : null;

  // ── Step 3: Insert prep_log ──
  let normalizedLog = null;

  try {
    const { data: logData, error: logError } = await supabase
      .from('prep_log')
      .insert({
        item:             prepTask.name.trim(),
        station:          prepTask.station.trim(),
        qty:              quantity,
        unit:             unit.trim(),
        user_name:        completedBy.trim(),
        started_at:       startedAtValue,
        duration_minutes: durationMinutes,
        is_suggested_qty: false,
      })
      .select('item, station, qty, unit, user_name, started_at, duration_minutes, is_suggested_qty, created_at');

    // ── Step 4: If insert fails, stop ──
    if (logError) {
      return { ok: false, reason: 'CONNECTION_ERROR', log: null, task: null };
    }

    normalizedLog = normalizeLog((logData ?? [])[0] ?? {});
  } catch {
    return { ok: false, reason: 'CONNECTION_ERROR', log: null, task: null };
  }

  // ── Step 5: Update prep_tasks ──
  try {
    const { data: taskData, error: taskError } = await supabase
      .from('prep_tasks')
      .update({
        current_stock:  newCurrentStock,
        need_tomorrow:  false,
        in_progress:    false,
        in_progress_at: null,
        in_progress_by: null,
        suggested_qty:  null,
        suggested_note: null,
      })
      .eq('id', prepTask.id)
      .eq('archived', false)
      .select('id, current_stock, need_tomorrow, in_progress, in_progress_at, in_progress_by');

    if (taskError) {
      return { ok: false, reason: 'CONNECTION_ERROR', log: normalizedLog, task: null };
    }

    if (!taskData || taskData.length === 0) {
      return { ok: false, reason: 'TASK_NOT_FOUND', log: normalizedLog, task: null };
    }

    return {
      ok:   true,
      log:  normalizedLog,
      task: normalizeTask(taskData[0]),
    };
  } catch {
    return { ok: false, reason: 'CONNECTION_ERROR', log: normalizedLog, task: null };
  }
}
