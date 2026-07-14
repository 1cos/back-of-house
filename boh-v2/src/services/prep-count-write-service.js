// BOH OS v2 — Prep Count Write Service
// Task 004U: records one physical prep stock count and updates current_stock.
//
// Production flow verified from js/prep.js saveKitchenCount (lines 2036–2078):
//   1. Read active prep task snapshot (prev_bot_stock, prev_bot_suggestion, prev_suggested_by)
//   2. Insert one prep_stock_counts row with source = 'kitchen_count'
//   3. Update prep_tasks.current_stock = countedQuantity
//   4. Call bot-prep-count-reconciler  ← NOT implemented in this task
//
// Schema verified from js/prep.js line 2037–2048 (insert) and line 2052 (update).
// No reconciler call. No UI changes. No window writes. No storage.

import { supabase } from '../core/supabase-client.js';

// ── Snapshot select columns ───────────────────────────────────────────
// Verified live fields from prep_tasks used in production saveKitchenCount.
const TASK_SNAPSHOT_COLUMNS = 'id,current_stock,suggested_qty,suggested_by';

// ── Count insert select columns ───────────────────────────────────────
// Mirrors the verified prep_stock_counts schema (js/prep.js line 375).
const COUNT_SELECT_COLUMNS = [
  'id',
  'prep_task_id',
  'counted_qty',
  'unit',
  'counted_by',
  'source',
  'counted_at',
  'prev_bot_stock',
  'prev_bot_suggestion',
  'prev_suggested_by',
].join(',');

// ── Task update select columns ────────────────────────────────────────
const TASK_UPDATE_COLUMNS = 'id,current_stock';

// ── Normalizers ───────────────────────────────────────────────────────

function normalizeCount(row) {
  return {
    id:                    row.id,
    prepTaskId:            row.prep_task_id,
    countedQuantity:       row.counted_qty,
    unit:                  row.unit,
    countedBy:             row.counted_by,
    source:                row.source,
    countedAt:             row.counted_at,
    previousBotStock:      row.prev_bot_stock,
    previousBotSuggestion: row.prev_bot_suggestion,
    previousSuggestedBy:   row.prev_suggested_by,
  };
}

function normalizeTask(row) {
  return {
    id:           row.id,
    currentStock: row.current_stock,
  };
}

// ── Exported API ──────────────────────────────────────────────────────

/**
 * Records one physical prep stock count and updates the prep task's
 * current_stock.
 *
 * Operation order:
 *   1. Validate input
 *   2. Generate one countedAt timestamp
 *   3. Read active prep task snapshot (for prev_bot fields)
 *   4. If task not found, return TASK_NOT_FOUND
 *   5. Insert prep_stock_counts
 *   6. If insert fails, return CONNECTION_ERROR
 *   7. Update prep_tasks.current_stock
 *   8. Return normalized result
 *
 * Does not call the reconciler.
 * Does not modify suggestions, need_tomorrow, or in_progress fields.
 *
 * @param {{
 *   prepTaskId:       number,
 *   countedQuantity:  number,
 *   unit:             string,
 *   countedBy:        string
 * }} options
 * @returns {Promise<{
 *   ok: boolean,
 *   reason?: string,
 *   count: object | null,
 *   task: object | null
 * }>}
 */
export async function savePrepCount({ prepTaskId, countedQuantity, unit, countedBy }) {
  // ── Step 1: Validate input ────────────────────────────────────────
  const idValid  = Number.isFinite(prepTaskId) && prepTaskId > 0;
  const qtyValid = Number.isFinite(countedQuantity) && countedQuantity >= 0;
  const unitTrimmed = (typeof unit === 'string') ? unit.trim() : '';
  const byTrimmed   = (typeof countedBy === 'string') ? countedBy.trim() : '';
  const unitValid = unitTrimmed.length > 0;
  const byValid   = byTrimmed.length > 0;

  if (!idValid || !qtyValid || !unitValid || !byValid) {
    return { ok: false, reason: 'INVALID_INPUT', count: null, task: null };
  }

  // ── Step 2: Generate one timestamp ───────────────────────────────
  const countedAt = new Date().toISOString();

  // ── Step 3: Read active prep task snapshot ────────────────────────
  let taskSnapshot;
  try {
    const { data, error } = await supabase
      .from('prep_tasks')
      .select(TASK_SNAPSHOT_COLUMNS)
      .eq('id', prepTaskId)
      .eq('archived', false)
      .maybeSingle();

    if (error) {
      return { ok: false, reason: 'CONNECTION_ERROR', count: null, task: null };
    }

    // ── Step 4: If no active task, stop ──────────────────────────────
    if (!data) {
      return { ok: false, reason: 'TASK_NOT_FOUND', count: null, task: null };
    }

    taskSnapshot = data;
  } catch {
    return { ok: false, reason: 'CONNECTION_ERROR', count: null, task: null };
  }

  // ── Step 5: Insert prep_stock_counts ─────────────────────────────
  let insertedCount;
  try {
    const { data, error } = await supabase
      .from('prep_stock_counts')
      .insert({
        prep_task_id:        prepTaskId,
        counted_qty:         countedQuantity,
        unit:                unitTrimmed,
        counted_by:          byTrimmed,
        source:              'kitchen_count',
        counted_at:          countedAt,
        prev_bot_stock:      taskSnapshot.current_stock,
        prev_bot_suggestion: taskSnapshot.suggested_qty,
        prev_suggested_by:   taskSnapshot.suggested_by,
      })
      .select(COUNT_SELECT_COLUMNS);

    // ── Step 6: If insert fails, stop ─────────────────────────────────
    if (error || !data || data.length === 0) {
      return { ok: false, reason: 'CONNECTION_ERROR', count: null, task: null };
    }

    insertedCount = normalizeCount(data[0]);
  } catch {
    return { ok: false, reason: 'CONNECTION_ERROR', count: null, task: null };
  }

  // ── Step 7: Update prep_tasks.current_stock ───────────────────────
  // Only current_stock is written. No other prep_tasks field is touched.
  try {
    const { data, error } = await supabase
      .from('prep_tasks')
      .update({ current_stock: countedQuantity })
      .eq('id', prepTaskId)
      .eq('archived', false)
      .select(TASK_UPDATE_COLUMNS);

    if (error) {
      return { ok: false, reason: 'CONNECTION_ERROR', count: insertedCount, task: null };
    }

    if (!data || data.length === 0) {
      return { ok: false, reason: 'TASK_NOT_FOUND', count: insertedCount, task: null };
    }

    // ── Step 8: Return normalized success ─────────────────────────────
    return {
      ok:    true,
      count: insertedCount,
      task:  normalizeTask(data[0]),
    };
  } catch {
    return { ok: false, reason: 'CONNECTION_ERROR', count: insertedCount, task: null };
  }
}
