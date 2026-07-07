// bot-stock-consolidator v1
// Sprint 5 — Stock Consolidator Bot
//
// ⚠️ v1 is SNAPSHOT ONLY:
//   - Reads stock_deductions
//   - Writes stock_daily_snapshot (status='partial')
//   - Does NOT update current_stock
//   - Does NOT write stock_movements
//   - Does NOT build La Dispensa UI

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BOT_NAME = 'bot-stock-consolidator';
const COMMIS_NAME = 'stock-consolidator-commis';
const BOT_VERSION = 'v1_snapshot_only';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const startedAt = new Date().toISOString();
  let botRunId = null;
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const businessDate = body.business_date || new Date().toISOString().split('T')[0];

    console.log(`[${BOT_NAME}] Starting run for ${businessDate}`);

    // Register bot run (bot_runs has: id, bot_name, run_date, started_at, status, rows_read, rows_written, warnings_count, errors_count, summary, metadata)
    const { data: runData } = await supa.from('bot_runs').insert({
      bot_name: BOT_NAME,
      run_date: businessDate,
      status: 'running',
      started_at: startedAt,
      summary: `Starting consolidation for ${businessDate}`,
      metadata: { business_date: businessDate, version: BOT_VERSION },
    }).select('id').single();
    botRunId = runData?.id;

    // ── STEP 1: Idempotenza ──
    await supa.from('stock_daily_snapshot').delete().eq('business_date', businessDate);
    await supa.from('commis_observations')
      .delete()
      .eq('business_date', businessDate)
      .eq('bot_name', BOT_NAME)
      .eq('commis_name', COMMIS_NAME);

    // ── STEP 2: Leggi stock_deductions ──
    // Columns: id, business_date, item_type, item_id (uuid), recipe_id, pos_item_name,
    //          source, quantity, unit, portions_sold, calculation_path, confidence,
    //          warning, metadata, created_at, target_recipe_id, prep_task_id, ingredient_id, target_name
    const { data: deductions, error: deductionsError } = await supa
      .from('stock_deductions')
      .select('*')
      .eq('business_date', businessDate);

    if (deductionsError) throw new Error(`stock_deductions read error: ${deductionsError.message}`);

    if (!deductions || deductions.length === 0) {
      await writeCommisObs(supa, businessDate, 'critical', 'missing_input',
        `Nessuna deduction trovata per ${businessDate}`,
        'Il Consolidator non ha trovato dati in stock_deductions per questa data. Verificare che bot-direct-deduction e bot-bom-chain-deduction abbiano girato.',
        'Triggerare la pipeline completa prima di questo bot'
      );
      await updateBotRun(supa, botRunId, 'error', 0, 0, 1, 0,
        `Nessuna stock_deduction trovata per ${businessDate}`);
      return jsonRes({ ok: false, error: 'No deductions found', businessDate }, 200);
    }

    console.log(`[${BOT_NAME}] Found ${deductions.length} deduction rows`);

    // ── STEP 3: Aggregazione per (item_type, target_recipe_id, ingredient_id, unit) ──
    // La chiave di aggregazione usa target_recipe_id per prep, ingredient_id per ingredient
    const groups = new Map();

    for (const row of deductions) {
      if (row.quantity == null || parseFloat(row.quantity) <= 0) continue;

      const itemType = row.item_type || 'unknown';
      const unit = (row.unit || '').trim();

      // Determina item_id per snapshot:
      // per prep: usa target_recipe_id (uuid della ricetta prep)
      // per ingredient: usa ingredient_id
      const resolvedItemId = itemType === 'prep'
        ? (row.target_recipe_id || row.item_id || null)
        : (row.ingredient_id || row.item_id || null);

      // Chiave aggregazione
      const key = `${itemType}|${resolvedItemId || 'null'}|${unit}`;

      if (!groups.has(key)) {
        groups.set(key, {
          item_type: itemType,
          item_id: resolvedItemId,        // uuid per stock_daily_snapshot
          unit,
          prep_task_id: row.prep_task_id || null,
          ingredient_id: row.ingredient_id || null,
          target_recipe_id: row.target_recipe_id || null,
          target_name: row.target_name || null,
          pos_deducted_qty: 0,
          sources: new Set(),
          deduction_rows: 0,
          all_prep_task_ids: new Set(),
          warnings: [],
        });
      }

      const g = groups.get(key);
      g.pos_deducted_qty += parseFloat(row.quantity);
      if (row.source) g.sources.add(row.source);
      g.deduction_rows += 1;
      if (row.prep_task_id) g.all_prep_task_ids.add(row.prep_task_id);
      if (!g.target_name && row.target_name) g.target_name = row.target_name;
      if (!g.prep_task_id && row.prep_task_id) g.prep_task_id = row.prep_task_id;
    }

    // ── STEP 4: Detect unit mismatches per stesso prep/ingredient ──
    const baseKeyMap = new Map();
    for (const [key, g] of groups) {
      // Base key senza unit
      const baseKey = `${g.item_type}|${g.item_id || 'null'}`;
      if (!baseKeyMap.has(baseKey)) baseKeyMap.set(baseKey, []);
      baseKeyMap.get(baseKey).push(g);
    }

    const observations = [];
    let warningCount = 0;

    for (const [baseKey, gs] of baseKeyMap) {
      if (gs.length > 1) {
        const units = [...new Set(gs.map(g => g.unit))].join(', ');
        const name = gs[0].target_name || gs[0].item_id || baseKey;
        for (const g of gs) {
          g.warnings.push(`unit mismatch: ${units}`);
        }
        observations.push({
          severity: 'warning',
          category: 'unit_mismatch',
          title: `Unit mismatch — ${name}: ${units}`,
          explanation: `La stessa prep/ingredient ha deductions con unità diverse (${units}). Il Consolidator le scrive come righe separate in stock_daily_snapshot.`,
          suggested_action: `Verificare BOM delle ricette che scaricano ${name} e allineare le unità`,
        });
        warningCount++;
      }
    }

    // ── STEP 5: Prepara righe snapshot ──
    const snapshotRows = [];
    let skipped = 0;

    for (const [key, g] of groups) {
      // Safety: item_id è NOT NULL in stock_daily_snapshot
      if (!g.item_id) {
        skipped++;
        observations.push({
          severity: 'warning',
          category: 'missing_link',
          title: `Snapshot saltato — item_id mancante: ${g.target_name || key}`,
          explanation: `Impossibile creare snapshot senza item_id UUID. item_type=${g.item_type}, prep_task_id=${g.prep_task_id}, ingredient_id=${g.ingredient_id}`,
          suggested_action: `Collegare ${g.target_name || 'questa prep'} a una ricetta con UUID valido`,
        });
        warningCount++;
        continue;
      }

      // Validazione aggiuntiva
      if (g.item_type === 'prep' && !g.prep_task_id && g.all_prep_task_ids.size === 0) {
        g.warnings.push('prep senza prep_task_id — non aggiornabile in v2');
        observations.push({
          severity: 'warning',
          category: 'missing_link',
          title: `Prep senza prep_task_id — ${g.target_name || g.item_id}`,
          explanation: `La deduction è collegata a una ricetta (${g.item_id}) ma non ha prep_task_id. In v2 non sarà possibile aggiornare current_stock per questa prep.`,
          suggested_action: `Verificare che la ricetta ${g.item_id} abbia un prep_task collegato`,
        });
        warningCount++;
      }

      if (g.item_type === 'ingredient' && !g.ingredient_id) {
        g.warnings.push('ingredient senza ingredient_id');
        warningCount++;
      }

      const warningText = g.warnings.length > 0 ? g.warnings.join(' | ') : null;
      const status = g.warnings.length > 0 ? 'warning' : 'partial';

      snapshotRows.push({
        business_date: businessDate,
        item_type: g.item_type,
        item_id: g.item_id,        // uuid NOT NULL
        stock_start: null,          // non noto in v1
        loaded_qty: 0,              // prep_log non letto in v1
        pos_deducted_qty: Math.round(g.pos_deducted_qty * 1000) / 1000,
        waste_qty: 0,
        adjustment_qty: 0,
        stock_end: null,            // non calcolabile in v1
        unit: g.unit || null,
        status,                     // 'partial' o 'warning'
        warning: warningText,
        metadata: {
          sources: Array.from(g.sources),
          deduction_rows: g.deduction_rows,
          prep_task_id: g.prep_task_id,
          ingredient_id: g.ingredient_id,
          target_recipe_id: g.target_recipe_id,
          target_name: g.target_name,
          consolidator_version: BOT_VERSION,
        },
      });
    }

    // ── STEP 6: Insert snapshot in batch ──
    let rowsWritten = 0;
    if (snapshotRows.length > 0) {
      const { error: insertError } = await supa
        .from('stock_daily_snapshot')
        .insert(snapshotRows);
      if (insertError) throw new Error(`stock_daily_snapshot insert error: ${insertError.message}`);
      rowsWritten = snapshotRows.length;
    }

    console.log(`[${BOT_NAME}] Wrote ${rowsWritten} snapshot rows, ${skipped} skipped`);

    // ── STEP 7: Summary observation se ci sono warnings ──
    if (warningCount > 0 || skipped > 0) {
      observations.push({
        severity: 'info',
        category: 'partial_snapshot',
        title: `Snapshot ${businessDate} — ${rowsWritten} righe, ${warningCount} warning, ${skipped} saltati`,
        explanation: `Il Consolidator ha creato ${rowsWritten} righe snapshot. ${warningCount} con warning, ${skipped} saltati per item_id mancante. v1_snapshot_only: current_stock NON aggiornato.`,
        suggested_action: `SELECT * FROM stock_daily_snapshot WHERE business_date='${businessDate}' AND status='warning'`,
      });
    }

    // Scrivi observations
    if (observations.length > 0) {
      const obsRows = observations.map(o => ({
        business_date: businessDate,
        bot_name: BOT_NAME,
        commis_name: COMMIS_NAME,
        severity: o.severity,
        category: o.category,
        title: o.title,
        explanation: o.explanation,
        suggested_action: o.suggested_action,
        status: 'open',
      }));
      await supa.from('commis_observations').insert(obsRows);
    }

    // ── STEP 8: Aggiorna bot_run ──
    const summary = `Consolidation ${businessDate}: ${rowsWritten} snapshot rows from ${deductions.length} deductions. Groups: ${groups.size}. Skipped: ${skipped}. Warnings: ${warningCount}. ${BOT_VERSION} — current_stock NOT updated.`;
    await updateBotRun(supa, botRunId, 'success', deductions.length, rowsWritten, warningCount, 0, summary);

    console.log(`[${BOT_NAME}] Done. ${summary}`);

    return jsonRes({
      ok: true,
      businessDate,
      deductionsRead: deductions.length,
      groupsTotal: groups.size,
      snapshotRowsWritten: rowsWritten,
      skipped,
      warningCount,
      observations: observations.length,
      note: `${BOT_VERSION} — current_stock NOT updated`,
    });

  } catch (err) {
    console.error(`[${BOT_NAME}] Fatal error:`, err);
    if (botRunId) {
      await updateBotRun(supa, botRunId, 'error', 0, 0, 0, 1, `Fatal: ${err.message}`);
    }
    return jsonRes({ ok: false, error: err.message }, 500);
  }
});

// ── Helpers ──

async function writeCommisObs(supa, businessDate, severity, category, title, explanation, suggested_action) {
  await supa.from('commis_observations').insert({
    business_date: businessDate,
    bot_name: BOT_NAME,
    commis_name: COMMIS_NAME,
    severity,
    category,
    title,
    explanation,
    suggested_action,
    status: 'open',
  });
}

async function updateBotRun(supa, runId, status, rowsRead, rowsWritten, warningsCount, errorsCount, summary) {
  if (!runId) return;
  await supa.from('bot_runs').update({
    status,
    rows_read: rowsRead,
    rows_written: rowsWritten,
    warnings_count: warningsCount,
    errors_count: errorsCount,
    summary,
    finished_at: new Date().toISOString(),
  }).eq('id', runId);
}

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
    status,
  });
}
