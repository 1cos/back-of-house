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

function _toLocalDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function _localDateDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return _toLocalDateString(d);
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
  const today    = _toLocalDateString(new Date());
  const sevenAgo = _localDateDaysAgo(SEARCH_WINDOW_DAYS);

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

  // Merge task + suggestion data; compute priority score.
  // Fix 4: when no suggestion row exists for a task, fall back to
  // 'count_first' rather than null. A null status creates a hybrid card
  // (live stock + no recommendation) that is meaningless to the cook and
  // inconsistent with Prep Control, which would also show no recommendation.
  // 'count_first' is the correct semantic: we have live stock but the bot
  // has not yet produced a recommendation for today's date — the cook
  // should verify the count before acting. This covers the window between
  // a physical count and the bot's next recalculation.
  const items = taskRows.map((task) => {
    const sugg   = suggMap[task.id] ?? null;
    const status = sugg?.status ?? (task.in_progress ? 'in_progress' : 'count_first');
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
    case 'do_first':    return 0;
    case 'in_progress': return 1;
    case 'do_today':    return 2;
    case 'check':       return 3;
    case 'count_first': return 4;
    case 'looks_good':  return 99; // excluded from top-3 display
    default:            return 50;
  }
}
