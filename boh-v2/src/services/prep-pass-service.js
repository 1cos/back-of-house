// BOH OS v2 — Prep Pass write service
// Task 004AE: records a previous-shift prep handoff in chef_reports.
//
// Production behavior verified in Task 004AD (js/prep.js wipPassBtn handler):
//   chef_reports fields written: user_name, station, message, status
//   prep_tasks: NOT modified
//   office_items: NOT written (production write is broken; not replicated here)
//
// No UI. Not yet connected to Pass to this shift button. No window writes. No storage.

import { supabase } from '../core/supabase-client.js';

// ── Input validation helpers ──────────────────────────────────────────

function isValidTaskId(v) {
  return typeof v === 'number' && isFinite(v) && v > 0;
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

// ── Message builder ───────────────────────────────────────────────────

/**
 * Builds the English handoff message for chef_reports.
 *
 * Format:
 *   {taskName} was carried over from the previous shift. Started by {startedByText}
 *   at {startedAtText}. Passed to this shift by {passedBy}. Verify how much has
 *   been produced.
 *
 * startedByText fallback:  'unknown user'
 * startedAtText fallback:  'unknown time'
 * Valid startedAt uses browser locale with month, day, hour, minute.
 * Raw ISO string is never stored in the message.
 *
 * @param {{ taskName: string, startedBy: string | null, startedAt: string | null, passedBy: string }} params
 * @returns {string}
 */
function buildMessage({ taskName, startedBy, startedAt, passedBy }) {
  const startedByText = (typeof startedBy === 'string' && startedBy.trim().length > 0)
    ? startedBy.trim()
    : 'unknown user';

  let startedAtText = 'unknown time';
  if (typeof startedAt === 'string' && startedAt.length > 0) {
    const d = new Date(startedAt);
    if (!isNaN(d.getTime())) {
      startedAtText = d.toLocaleString(undefined, {
        month:  'short',
        day:    'numeric',
        hour:   'numeric',
        minute: '2-digit',
      });
    }
  }

  return (
    taskName.trim() +
    ' was carried over from the previous shift.' +
    ' Started by ' + startedByText +
    ' at ' + startedAtText + '.' +
    ' Passed to this shift by ' + passedBy.trim() + '.' +
    ' Verify how much has been produced.'
  );
}

// ── Exported API ──────────────────────────────────────────────────────

/**
 * Records a previous-shift prep handoff in chef_reports.
 *
 * Validates prepTaskId (for traceability) and passedBy (required author).
 * Does not query or modify prep_tasks.
 * Does not write to office_items.
 *
 * Writes exactly:
 *   user_name = passedBy.trim()
 *   station   = station.trim() or null
 *   message   = English handoff message
 *   status    = 'new'
 *
 * @param {{
 *   prepTaskId: unknown,
 *   taskName:   unknown,
 *   station:    unknown,
 *   startedBy:  unknown,
 *   startedAt:  unknown,
 *   passedBy:   unknown
 * }} options
 * @returns {Promise<
 *   { ok: true,  report: { id: string, userName: string, station: string | null, message: string, status: string } } |
 *   { ok: false, reason: 'INVALID_INPUT' | 'CONNECTION_ERROR', report: null }
 * >}
 */
export async function passPrepToShift({
  prepTaskId,
  taskName,
  station,
  startedBy,
  startedAt,
  passedBy,
} = {}) {
  // ── Input validation — required fields ──
  if (!isValidTaskId(prepTaskId)) {
    return { ok: false, reason: 'INVALID_INPUT', report: null };
  }
  if (!isNonEmptyString(taskName)) {
    return { ok: false, reason: 'INVALID_INPUT', report: null };
  }
  if (!isNonEmptyString(passedBy)) {
    return { ok: false, reason: 'INVALID_INPUT', report: null };
  }

  // ── Normalise optional fields — do not mutate options ──
  const normStation = (typeof station === 'string' && station.trim().length > 0)
    ? station.trim()
    : null;

  // startedBy and startedAt are passed through to buildMessage as-is;
  // buildMessage handles null and invalid values internally.

  // ── Build message ──
  const message = buildMessage({
    taskName,
    startedBy: typeof startedBy === 'string' ? startedBy : null,
    startedAt: typeof startedAt === 'string' ? startedAt : null,
    passedBy,
  });

  // ── Database insert ──
  try {
    const { data, error } = await supabase
      .from('chef_reports')
      .insert({
        user_name: passedBy.trim(),
        station:   normStation,
        message,
        status:    'new',
      })
      .select('id, user_name, station, message, status')
      .single();

    if (error || !data) {
      return { ok: false, reason: 'CONNECTION_ERROR', report: null };
    }

    return {
      ok: true,
      report: {
        id:       data.id,
        userName: data.user_name,
        station:  data.station,
        message:  data.message,
        status:   data.status,
      },
    };
  } catch {
    return { ok: false, reason: 'CONNECTION_ERROR', report: null };
  }
}
