// BOH OS v2 — Prep Suggestions Read Service
// Task 004C: loads the latest valid prep suggestions for a list of prep task IDs.
// Task 004C.1: Phase 1 uses paginated reads (500 rows/page) instead of a fixed limit.
// Read-only. No writes. No window. No storage. No mock data. No legacy fallback.

import { supabase } from '../core/supabase-client.js';

// ── Date helpers ──────────────────────────────────────────────────────
// Private to this module. Returns local calendar dates in YYYY-MM-DD.

/**
 * Returns the local calendar date as a YYYY-MM-DD string.
 *
 * @param {Date} date
 * @returns {string}
 */
function toLocalDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns the YYYY-MM-DD string for N calendar days before today (local).
 *
 * @param {number} daysAgo
 * @returns {string}
 */
function localDateDaysAgo(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return toLocalDateString(d);
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

  const today    = toLocalDateString(new Date());
  const sevenAgo = localDateDaysAgo(SEARCH_WINDOW_DAYS);

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
