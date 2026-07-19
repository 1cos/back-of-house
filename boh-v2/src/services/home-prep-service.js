// BOH OS v2 — Home Prep Service
// HOME-01 Trust & Clean: single canonical data-access module for Home blocks.
//
// Replaces direct supabase imports in station-focus.js and station-overview.js.
// All Supabase queries for the Home panel live here — nowhere else in Home.
//
// Exports:
//   fetchStationHomeFocus(stationName)  → used by station_focus BLOCK_FETCHERS
//   fetchAllStationsOverview(stations)  → used by station_overview BLOCK_FETCHERS
//
// Reuses existing service contracts:
//   - Task/station queries follow the same shape as station-prep-service.js
//   - Valid-date logic matches prep-suggestion-service.js exactly
//
// Read-only. No writes. No window. No storage.

import { supabase } from '../core/supabase-client.js';

// ── Date helpers ───────────────────────────────────────────────────────
// The backend bot (bot-prep-suggester) writes suggestion rows using:
//
//   function nextServiceDay(): string {
//     const d = new Date();
//     d.setUTCDate(d.getUTCDate() + 1);
//     while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
//     return d.toISOString().slice(0, 10);
//   }
//
// This is pure UTC arithmetic: always UTC-tomorrow, advancing past Sunday.
// It has NO timezone component. It does NOT use America/Chicago.
//
// At 10:29 AM CDT (15:29 UTC) on July 19, the bot writes suggestion_date
// = 2026-07-20. The old toLocalDateString(new Date()) returned '2026-07-19'
// on a Texas iPhone, making the .lte filter exclude the active date.
//
// Fix: the upper bound for the valid-date scan must be the same UTC-tomorrow
// value the bot uses. The lower bound (sevenAgo) moves back 8 UTC days so
// the 7-day history window is never short by a day when the service date is
// tomorrow.

/**
 * Returns a YYYY-MM-DD string for a UTC date.
 *
 * @param {Date} date
 * @returns {string}
 */
function _utcDateString(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Returns the next kitchen service date in YYYY-MM-DD (UTC),
 * matching bot-prep-suggester's nextServiceDay() exactly:
 *   UTC tomorrow, advancing past Sunday (UTC day 0).
 *
 * @returns {string}
 */
function _nextServiceDayUtc() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return _utcDateString(d);
}

/**
 * Returns the YYYY-MM-DD string for N UTC days before today.
 *
 * @param {number} n
 * @returns {string}
 */
function _utcDateDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return _utcDateString(d);
}

// ── Constants ──────────────────────────────────────────────────────────

const MIN_ROWS_FOR_VALID_RUN = 50;
const SEARCH_WINDOW_DAYS     = 7;
const DATE_SCAN_LIMIT        = 500;

// ── Shared: find the most recent valid suggestion date ─────────────────
// Matches prep-suggestion-service.js valid-date algorithm exactly.
// A valid date has ≥ 50 suggestion rows in the 7-day window.
//
// @returns {Promise<string|null>}  YYYY-MM-DD or null if no valid run found

async function _findValidSuggestionDate() {
  // Upper bound: next kitchen service day (UTC tomorrow, skip Sunday) —
  // matches the suggestion_date the bot writes. Lower bound: 8 UTC days
  // ago so the scan always covers a full 7-day history even when the
  // service date is one day ahead of the calendar date.
  const today    = _nextServiceDayUtc();
  const sevenAgo = _utcDateDaysAgo(SEARCH_WINDOW_DAYS + 1);

  let allRows = [];
  let pageIndex = 0;

  while (true) {
    const rangeStart = pageIndex * DATE_SCAN_LIMIT;
    const rangeEnd   = rangeStart + DATE_SCAN_LIMIT - 1;

    const { data, error } = await supabase
      .from('prep_suggestions_daily')
      .select('suggestion_date, prep_task_id')
      .gte('suggestion_date', sevenAgo)
      .lte('suggestion_date', today)
      .order('suggestion_date', { ascending: false })
      .range(rangeStart, rangeEnd);

    if (error) throw error;
    for (const row of data) allRows.push(row);
    if (data.length < DATE_SCAN_LIMIT) break;
    pageIndex += 1;
  }

  if (allRows.length === 0) return null;

  // Count rows per date
  const counts = new Map();
  for (const row of allRows) {
    counts.set(row.suggestion_date, (counts.get(row.suggestion_date) ?? 0) + 1);
  }

  // Walk descending (already ordered by query) to find first valid date
  const seen = [];
  for (const row of allRows) {
    const d = row.suggestion_date;
    if (!seen.includes(d)) {
      seen.push(d);
      if (counts.get(d) >= MIN_ROWS_FOR_VALID_RUN) return d;
    }
  }

  return null;
}

// ── fetchStationHomeFocus ──────────────────────────────────────────────
// Returns the top-priority prep items for a single station,
// merged with the latest valid bot suggestion data.
//
// @param {string} stationName
// @returns {Promise<{
//   ok:      boolean,
//   items:   Array<{ id, name, unit, stock, status, plannedOutput, outputUnit, score }>,
//   hasData: boolean,
// }>}

export async function fetchStationHomeFocus(stationName) {
  if (typeof stationName !== 'string' || stationName.trim().length === 0) {
    return { ok: true, items: [], hasData: false };
  }

  const station = stationName.trim();

  // Fetch tasks — same columns as station-prep-service.js (subset)
  const { data: taskRows, error: taskErr } = await supabase
    .from('prep_tasks')
    .select('id, name, unit, current_stock, in_progress')
    .eq('category', station)
    .eq('archived', false)
    .order('name', { ascending: true });

  if (taskErr) throw taskErr;
  if (!taskRows || taskRows.length === 0) {
    return { ok: true, items: [], hasData: false };
  }

  const taskIds = taskRows.map((r) => r.id);

  // Find latest valid suggestion date
  const validDate = await _findValidSuggestionDate();

  // Fetch suggestion details for this station's tasks on valid date
  const suggMap = {};
  if (validDate) {
    const { data: suggRows, error: suggErr } = await supabase
      .from('prep_suggestions_daily')
      .select('prep_task_id, status, planned_output, output_unit')
      .eq('suggestion_date', validDate)
      .in('prep_task_id', taskIds);

    if (!suggErr && suggRows) {
      for (const row of suggRows) {
        suggMap[row.prep_task_id] = {
          status:        row.status,
          plannedOutput: row.planned_output,
          outputUnit:    row.output_unit,
        };
      }
    }
  }

  // Fetch which tasks have a currently valid physical count.
  // A count is valid when: expires_at is null or in the future,
  // AND reconcile_status is not one of the excluded correction statuses.
  // This matches the validity window used by bot-prep-suggester exactly.
  // Used below to distinguish "no suggestion + count exists (recalculating)"
  // from "no suggestion + no count (cook should count)".
  const validCountTaskIds = new Set();
  const nowIso = new Date().toISOString();
  const excludedStatuses = 'invalid_test_data,corrected_unit_error';
  {
    const { data: countRows, error: countErr } = await supabase
      .from('prep_stock_counts')
      .select('prep_task_id')
      .in('prep_task_id', taskIds)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .or(`reconcile_status.is.null,reconcile_status.not.in.(${excludedStatuses})`);

    if (!countErr && countRows) {
      for (const row of countRows) {
        validCountTaskIds.add(row.prep_task_id);
      }
    }
  }

  // Merge task + suggestion data; compute priority score.
  //
  // Three-way branch when no valid suggestion exists for a task:
  //
  // A) Suggestion present → use it as-is. Normal path.
  //
  // B) No suggestion + valid count exists → 'updating_recommendation'.
  //    The cook has already counted stock. The bot is recalculating.
  //    Telling the cook to count again is wrong. Showing a stale or
  //    fabricated recommendation is wrong. The task is temporarily omitted
  //    from the Home top-3 display (score 99, same as looks_good) until
  //    the refreshed suggestion from the 3s async refresh in station-prep.js
  //    is written to prep_suggestions_daily and Home re-fetches.
  //
  // C) No suggestion + no valid count → 'count_first'.
  //    We have live stock from prep_tasks but no verified measurement and
  //    no recommendation. The cook should count before acting.
  //
  // In all cases: no recommendation is fabricated from live stock alone.
  const items = taskRows.map((task) => {
    const sugg = suggMap[task.id] ?? null;

    let status;
    if (sugg) {
      status = sugg.status;
    } else if (task.in_progress) {
      status = 'in_progress';
    } else if (validCountTaskIds.has(task.id)) {
      status = 'updating_recommendation'; // score 99 → omitted from display
    } else {
      status = 'count_first';
    }

    return {
      id:            task.id,
      name:          task.name,
      unit:          task.unit,
      stock:         task.current_stock,
      status,
      plannedOutput: sugg?.plannedOutput ?? null,
      outputUnit:    sugg?.outputUnit ?? task.unit ?? null,
      score:         _statusScore(status),
    };
  });

  return { ok: true, items, hasData: true };
}

// ── fetchAllStationsOverview ───────────────────────────────────────────
// Returns per-station task counts (urgent / in_progress / ready)
// for all stations in the provided list.
//
// @param {string[]} stationNames  — ordered list from fetchAvailableStations()
// @returns {Promise<{
//   ok:       boolean,
//   stations: Array<{ name, urgent, inProgress, ready, total }>,
// }>}

export async function fetchAllStationsOverview(stationNames) {
  if (!stationNames || stationNames.length === 0) {
    return { ok: true, stations: [] };
  }

  // All non-archived tasks for the requested stations
  const { data: taskRows, error: taskErr } = await supabase
    .from('prep_tasks')
    .select('id, category, in_progress')
    .eq('archived', false)
    .in('category', stationNames);

  if (taskErr) throw taskErr;
  if (!taskRows || taskRows.length === 0) {
    return { ok: true, stations: [] };
  }

  // Find latest valid suggestion date
  const validDate = await _findValidSuggestionDate();

  // Fetch suggestion statuses for all tasks
  const suggMap = {};
  if (validDate) {
    const allIds = taskRows.map((r) => r.id);
    const { data: suggRows, error: suggErr } = await supabase
      .from('prep_suggestions_daily')
      .select('prep_task_id, status')
      .eq('suggestion_date', validDate)
      .in('prep_task_id', allIds);

    if (!suggErr && suggRows) {
      for (const row of suggRows) {
        suggMap[row.prep_task_id] = row.status;
      }
    }
  }

  // Aggregate counts per station (preserving caller's order)
  const stationMap = {};
  for (const s of stationNames) {
    stationMap[s] = { urgent: 0, inProgress: 0, ready: 0, total: 0 };
  }

  for (const task of taskRows) {
    const cat = task.category;
    if (!stationMap[cat]) continue;
    stationMap[cat].total += 1;

    const status = suggMap[task.id] ?? (task.in_progress ? 'in_progress' : null);
    if (status === 'do_first') {
      stationMap[cat].urgent += 1;
    } else if (status === 'in_progress' || task.in_progress) {
      stationMap[cat].inProgress += 1;
    } else if (status === 'looks_good') {
      stationMap[cat].ready += 1;
    }
  }

  const stations = stationNames
    .filter((s) => stationMap[s].total > 0)
    .map((s) => ({
      name:       s,
      urgent:     stationMap[s].urgent,
      inProgress: stationMap[s].inProgress,
      ready:      stationMap[s].ready,
      total:      stationMap[s].total,
    }));

  return { ok: true, stations };
}

// ── Priority score helper (shared by both fetchers) ────────────────────
// Higher priority = lower score (do_first is most urgent).

function _statusScore(status) {
  switch (status) {
    case 'do_first':               return 0;
    case 'in_progress':            return 1;
    case 'do_today':               return 2;
    case 'prep_today':             return 2;
    case 'check':                  return 3;
    case 'count_first':            return 4;
    case 'looks_good':             return 99; // excluded from top-3 display
    case 'updating_recommendation': return 99; // temporarily omitted — recalculating
    default:                       return 50;
  }
}
