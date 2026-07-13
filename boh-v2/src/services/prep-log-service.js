// BOH OS v2 — Today Prep Logs read service
// Task 004J: loads today's production log entries for a list of prep task names.
// Read-only. No writes. No caching. No window writes. No storage.

import { supabase } from '../core/supabase-client.js';

// ── Input normalization ───────────────────────────────────────────────

/**
 * Normalizes a raw taskNames input into a deduplicated array of
 * non-empty trimmed strings preserving original capitalization.
 *
 * @param {unknown} taskNames
 * @returns {string[]}
 */
function normalizeTaskNames(taskNames) {
  if (!Array.isArray(taskNames)) return [];

  const seen = new Set();
  const result = [];

  for (const item of taskNames) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

// ── Date window ───────────────────────────────────────────────────────

/**
 * Returns ISO string boundaries for the current local calendar day.
 *
 * start: today at 00:00:00 local time
 * end:   tomorrow at 00:00:00 local time
 *
 * @returns {{ start: string, end: string }}
 */
function localDayWindow() {
  const now = new Date();

  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);

  return {
    start: start.toISOString(),
    end:   end.toISOString(),
  };
}

// ── Result grouping ───────────────────────────────────────────────────

/**
 * Groups a flat array of normalized log rows by taskName.
 * Preserves the order within each group (created_at ascending from query).
 *
 * @param {Array<{ taskName: string, quantity: unknown, unit: unknown, userName: unknown, createdAt: unknown }>} rows
 * @returns {Object}
 */
function groupByTaskName(rows) {
  const groups = {};
  for (const row of rows) {
    if (!Object.prototype.hasOwnProperty.call(groups, row.taskName)) {
      groups[row.taskName] = [];
    }
    groups[row.taskName].push(row);
  }
  return groups;
}

// ── Exported API ──────────────────────────────────────────────────────

/**
 * Fetches today's prep log entries for the supplied task names.
 *
 * @param {unknown} taskNames   — expected string[]
 * @returns {Promise<{
 *   ok: true,
 *   logsByTaskName: Object
 * } | {
 *   ok: false,
 *   reason: 'CONNECTION_ERROR',
 *   logsByTaskName: {}
 * }>}
 */
export async function fetchTodayPrepLogs(taskNames) {
  const names = normalizeTaskNames(taskNames);

  if (names.length === 0) {
    return { ok: true, logsByTaskName: {} };
  }

  const { start, end } = localDayWindow();

  try {
    const { data, error } = await supabase
      .from('prep_log')
      .select('item, qty, unit, user_name, created_at')
      .in('item', names)
      .gte('created_at', start)
      .lt('created_at', end)
      .order('created_at', { ascending: true });

    if (error) {
      return { ok: false, reason: 'CONNECTION_ERROR', logsByTaskName: {} };
    }

    const rows = (data ?? []).map((row) => ({
      taskName:  row.item,
      quantity:  row.qty,
      unit:      row.unit,
      userName:  row.user_name,
      createdAt: row.created_at,
    }));

    return { ok: true, logsByTaskName: groupByTaskName(rows) };
  } catch {
    return { ok: false, reason: 'CONNECTION_ERROR', logsByTaskName: {} };
  }
}
