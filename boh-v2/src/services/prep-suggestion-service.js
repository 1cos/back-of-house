// BOH OS v2 — Prep Suggestions Read Service
// Task 004C: loads the latest valid prep suggestions for a list of prep task IDs.
// Task 004C.1: Phase 1 uses paginated reads (500 rows/page) instead of a fixed limit.
// Read-only. No writes. No window. No storage. No mock data. No legacy fallback.

import { supabase } from '../core/supabase-client.js';

// ── Date helpers ──────────────────────────────────────────────────────
// The backend bot (bot-prep-suggester) writes suggestion_date using:
//
//   function nextServiceDay(): string {
//     const d = new Date();
//     d.setUTCDate(d.getUTCDate() + 1);
//     while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
//     return d.toISOString().slice(0, 10);
//   }
//
// Pure UTC arithmetic — no timezone. At 10:29 AM CDT (15:29 UTC) on
// July 19 it writes suggestion_date = 2026-07-20. The old
// toLocalDateString(new Date()) returned '2026-07-19' on a Texas iPhone,
// making the .lte filter exclude the active date entirely.
//
// Fix: use UTC arithmetic for both bounds so the scan always includes
// the date the bot wrote.

/**
 * Returns a YYYY-MM-DD string for a UTC date.
 *
 * @param {Date} date
 * @returns {string}
 */
function utcDateString(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Returns the next kitchen service date in YYYY-MM-DD (UTC),
 * matching bot-prep-suggester's nextServiceDay() exactly:
 *   UTC tomorrow, advancing past Sunday (UTC day 0).
 *
 * @returns {string}
 */
function nextServiceDayUtc() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return utcDateString(d);
}

/**
 * Returns the YYYY-MM-DD string for N UTC days before today.
 *
 * @param {number} n
 * @returns {string}
 */
function utcDateDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return utcDateString(d);
}

// ── Constants ─────────────────────────────────────────────────────────

const MIN_ROWS_FOR_VALID_RUN = 50;
const SEARCH_WINDOW_DAYS     = 7;
const PHASE1_PAGE_SIZE       = 500;

// ── Empty successful result ────────────────────────────────────────────

const EMPTY_SUCCESS = Object.freeze({
  ok:             true,
  suggestionDate: null,
  suggestions:    {},
});

// ── Public API ────────────────────────────────────────────────────────

/**
 * Loads the latest valid prep suggestions for the supplied prep task IDs.
 *
 * @param {Array} prepTaskIds
 * @returns {Promise<
 *   { ok: true,  suggestionDate: string|null, suggestions: Object } |
 *   { ok: false, reason: 'CONNECTION_ERROR', suggestionDate: null, suggestions: {} }
 * >}
 */
export async function fetchPrepSuggestions(prepTaskIds) {
  // ── Input normalization ────────────────────────────────────────────
  if (!Array.isArray(prepTaskIds)) {
    return { ...EMPTY_SUCCESS };
  }

  // Keep only finite numeric IDs; remove duplicates.
  const normalized = [...new Set(
    prepTaskIds.filter((id) => typeof id === 'number' && Number.isFinite(id))
  )];

  if (normalized.length === 0) {
    return { ...EMPTY_SUCCESS };
  }

  // ── Phase 1: find the most recent valid run (paginated) ───────────
  // Retrieve the full 7-day window using 500-row pages so no partial run
  // can hide an older valid run. Pagination stops when a page returns
  // fewer than PHASE1_PAGE_SIZE rows (including zero). Any page error
  // aborts immediately — partial data is never used.

  // Upper bound: next kitchen service day (UTC tomorrow, skip Sunday) —
  // matches the suggestion_date the bot writes. Lower bound: 8 UTC days
  // ago so the scan always covers a full 7-day history even when the
  // service date is one day ahead of the calendar date.
  const today    = nextServiceDayUtc();
  const sevenAgo = utcDateDaysAgo(SEARCH_WINDOW_DAYS + 1);

  const allPhase1Rows = [];
  let pageIndex = 0;

  while (true) {
    const rangeStart = pageIndex * PHASE1_PAGE_SIZE;
    const rangeEnd   = rangeStart + PHASE1_PAGE_SIZE - 1;

    let pageData;
    try {
      const { data, error } = await supabase
        .from('prep_suggestions_daily')
        .select('suggestion_date, prep_task_id')
        .gte('suggestion_date', sevenAgo)
        .lte('suggestion_date', today)
        .order('suggestion_date', { ascending: false })
        .range(rangeStart, rangeEnd);

      if (error) {
        return { ok: false, reason: 'CONNECTION_ERROR', suggestionDate: null, suggestions: {} };
      }

      pageData = data;
    } catch {
      return { ok: false, reason: 'CONNECTION_ERROR', suggestionDate: null, suggestions: {} };
    }

    for (const row of pageData) {
      allPhase1Rows.push(row);
    }

    // A page shorter than the page size means there are no more rows.
    if (pageData.length < PHASE1_PAGE_SIZE) {
      break;
    }

    pageIndex += 1;
  }

  // Count rows per date in memory using the complete window.
  // Select the most recent date with ≥ 50 rows.
  const countsByDate = new Map();
  for (const row of allPhase1Rows) {
    const d = row.suggestion_date;
    countsByDate.set(d, (countsByDate.get(d) ?? 0) + 1);
  }

  // Dates arrive descending from the query; iterate in that order.
  let validDate = null;
  const seenDates = [];
  for (const row of allPhase1Rows) {
    const d = row.suggestion_date;
    if (!seenDates.includes(d)) {
      seenDates.push(d);
      if (countsByDate.get(d) >= MIN_ROWS_FOR_VALID_RUN) {
        validDate = d;
        break;
      }
    }
  }

  if (validDate === null) {
    return { ...EMPTY_SUCCESS };
  }

  // ── Phase 2: load suggestions for the valid date ───────────────────
  let phase2Data;
  try {
    const { data, error } = await supabase
      .from('prep_suggestions_daily')
      .select(
        'prep_task_id, status, confidence, planned_output, output_unit, ' +
        'current_stock, stock_source, stock_unit, net_requirement, forecast, ' +
        'coverage_days, demand_source, reason, production_constraint_quality, debug_json'
      )
      .eq('suggestion_date', validDate)
      .in('prep_task_id', normalized);

    if (error) {
      return { ok: false, reason: 'CONNECTION_ERROR', suggestionDate: null, suggestions: {} };
    }

    phase2Data = data;
  } catch {
    return { ok: false, reason: 'CONNECTION_ERROR', suggestionDate: null, suggestions: {} };
  }

  // ── Normalize: snake_case → camelCase; keyed by numeric prep_task_id ──
  const suggestions = {};
  for (const row of phase2Data) {
    suggestions[row.prep_task_id] = {
      prepTaskId:                  row.prep_task_id,
      status:                      row.status,
      confidence:                  row.confidence,
      plannedOutput:               row.planned_output,
      outputUnit:                  row.output_unit,
      currentStock:                row.current_stock,
      stockSource:                 row.stock_source,
      stockUnit:                   row.stock_unit,
      netRequirement:              row.net_requirement,
      forecast:                    row.forecast,
      coverageDays:                row.coverage_days,
      demandSource:                row.demand_source,
      reason:                      row.reason,
      productionConstraintQuality: row.production_constraint_quality,
      debug:                       row.debug_json,
    };
  }

  return {
    ok:             true,
    suggestionDate: validDate,
    suggestions,
  };
}
