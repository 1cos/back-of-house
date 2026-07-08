// bot-stock-consolidator v5
// Sprint A — Load Qty from prep_log
//
// v5 aggiunge rispetto a v4:
//   - Legge prep_log per business_date (CDT) → popola stock_daily_snapshot.loaded_qty
//   - Crea snapshot "load-only" se prep_log ha carichi ma mancano POS deductions per quella prep
//   - 4 protezioni: Pipeline Guard (v4), match warning, item_id check, unit normalisation
//   - load_only=true: consente run senza deductions POS (solo carichi)
//
// ⚠️ INVARIATO v4→v5:
//   - Non aggiorna current_stock
//   - Non scrive stock_movements
//   - Non modifica prep_log
//   - Non cambia il flusso DONE esistente
//   - Pipeline Guard intatto (salvo load_only=true)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BOT_NAME    = 'bot-stock-consolidator';
const COMMIS_NAME = 'stock-consolidator-commis';
const BOT_VERSION = 'v5_load_qty';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Unit normalisation ──
// Converte unità sicure verso l'unità canonica.
// NON converte: pz, each, nests, cup, buste, filetto — unità fisiche non riducibili a peso.
function normaliseQty(qty: number, fromUnit: string, toUnit: string): number | null {
  const f = fromUnit.toLowerCase().trim();
  const t = toUnit.toLowerCase().trim();
  if (f === t) return qty;
  if (f === 'kg' && t === 'g')  return qty * 1000;
  if (f === 'g'  && t === 'kg') return qty / 1000;
  if (f === 'ml' && t === 'l')  return qty / 1000;
  if (f === 'l'  && t === 'ml') return qty * 1000;
  return null; // unità non convertibili
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const startedAt = new Date().toISOString();
  let botRunId: string | null = null;
  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const body = await req.json().catch(() => ({}));
    const businessDate: string = body.business_date || new Date().toISOString().split('T')[0];
    // load_only=true: consente snapshot senza deductions POS (run manuale carichi)
    const loadOnly: boolean = body.load_only === true;

    console.log(`[${BOT_NAME}] v5 Starting run for ${businessDate}, load_only=${loadOnly}`);

    // ── PROTEZIONE 1: Pipeline Guard ──
    // Verifica upstream success — bypassato solo se load_only=true
    if (!loadOnly) {
      const { data: upstreamRuns } = await supa
        .from('bot_runs')
        .select('bot_name, status')
        .eq('run_date', businessDate)
        .in('bot_name', ['bot-direct-deduction', 'bot-bom-chain-deduction'])
        .eq('status', 'success')
        .order('started_at', { ascending: false });

      const upstreamNames = new Set((upstreamRuns || []).map((r: any) => r.bot_name));
      const missingUpstream: string[] = [];
      if (!upstreamNames.has('bot-direct-deduction'))   missingUpstream.push('bot-direct-deduction');
      if (!upstreamNames.has('bot-bom-chain-deduction')) missingUpstream.push('bot-bom-chain-deduction');

      if (missingUpstream.length > 0) {
        const msg = `Pipeline Guard: bot upstream mancanti o falliti per ${businessDate}: ${missingUpstream.join(', ')}. Eseguirli prima in ordine sequenziale.`;
        console.warn(`[${BOT_NAME}] ${msg}`);
        await supa.from('commis_observations').insert({
          business_date: businessDate, bot_name: BOT_NAME, commis_name: COMMIS_NAME,
          severity: 'warning', category: 'system',
          title: `Pipeline Guard attivato — ${businessDate}`,
          explanation: msg,
          suggested_action: 'Eseguire bot-direct-deduction poi bot-bom-chain-deduction in ordine, poi ritriggerare questo bot.',
          status: 'open',
        });
        return jsonRes({ ok: false, error: 'pipeline_guard', missing: missingUpstream, businessDate });
      }
    }

    // Register bot run
    const { data: runData } = await supa.from('bot_runs').insert({
      bot_name: BOT_NAME, run_date: businessDate, status: 'running', started_at: startedAt,
      summary: `v5 Starting consolidation for ${businessDate} (load_only=${loadOnly})`,
      metadata: { business_date: businessDate, version: BOT_VERSION, load_only: loadOnly },
    }).select('id').single();
    botRunId = runData?.id ?? null;

    // ── Idempotenza ──
    await supa.from('stock_daily_snapshot').delete().eq('business_date', businessDate);
    await supa.from('commis_observations').delete()
      .eq('business_date', businessDate).eq('bot_name', BOT_NAME).eq('commis_name', COMMIS_NAME);

    const observations: any[] = [];
    let warningCount = 0;

    // ── STEP 1: Leggi stock_deductions ──
    const { data: deductions, error: deductionsError } = await supa
      .from('stock_deductions').select('*').eq('business_date', businessDate);
    if (deductionsError) throw new Error(`stock_deductions: ${deductionsError.message}`);

    const hasDeductions = (deductions?.length ?? 0) > 0;

    if (!hasDeductions && !loadOnly) {
      await supa.from('commis_observations').insert({
        business_date: businessDate, bot_name: BOT_NAME, commis_name: COMMIS_NAME,
        severity: 'critical', category: 'system',
        title: `Nessuna deduction per ${businessDate}`,
        explanation: 'stock_deductions vuote nonostante upstream success.',
        suggested_action: 'Verificare bot upstream. Oppure usare load_only=true per creare snapshot solo dai carichi.',
        status: 'open',
      });
      await updateRun(supa, botRunId, 'error', 0, 0, 1, 0, `Nessuna deduction per ${businessDate}`);
      return jsonRes({ ok: false, error: 'No deductions found', hint: 'Use load_only=true for load-only snapshot', businessDate });
    }

    console.log(`[${BOT_NAME}] Found ${deductions?.length ?? 0} deduction rows`);

    // ── STEP 2: Leggi prep_log per business_date (CDT = UTC-5) ──
    // businessDate = "YYYY-MM-DD" in CDT.
    // CDT 00:00 = UTC 05:00.  CDT 23:59 = UTC (next day) 04:59.
    const cdtStart = `${businessDate}T05:00:00Z`;
    const nextDay = new Date(`${businessDate}T05:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const cdtEnd = nextDay.toISOString();

    const { data: prepLogs, error: prepLogErr } = await supa
      .from('prep_log')
      .select('item, qty, unit, user_name, created_at, duration_minutes, station')
      .gte('created_at', cdtStart)
      .lt('created_at', cdtEnd)
      .neq('unit', 'no_need')
      .gt('qty', 0)
      .order('created_at', { ascending: true });

    if (prepLogErr) {
      console.warn(`[${BOT_NAME}] prep_log read error: ${prepLogErr.message}`);
      observations.push({
        severity: 'warning', category: 'prep_log_read_error',
        title: `prep_log read error — ${businessDate}`,
        explanation: `Impossibile leggere prep_log: ${prepLogErr.message}. loaded_qty sarà 0 su tutti gli snapshot.`,
        suggested_action: 'Verificare permessi tabella prep_log e ripetere il run.',
      });
      warningCount++;
    }

    const logs: any[] = prepLogs || [];
    console.log(`[${BOT_NAME}] Found ${logs.length} prep_log rows for ${businessDate}`);

    // ── STEP 3: Fetch prep_tasks per match nome → recipe_id ──
    const { data: allTasks } = await supa
      .from('prep_tasks')
      .select('id, name, recipe_id, unit')
      .eq('archived', false);

    // Map: name_lower → task
    const taskByName = new Map<string, any>();
    for (const t of (allTasks || [])) {
      taskByName.set((t.name as string).toLowerCase().trim(), t);
    }

    // ── STEP 4: Aggrega prep_log per recipe_id ──
    // PROTEZIONE 2: match warning se nessun task trovato
    // PROTEZIONE 3: salta se recipe_id è null
    // PROTEZIONE 4: normalizza unit
    const loadGroups = new Map<string, any>(); // recipe_id → group
    const unmatchedItems = new Set<string>();
    const unitMismatchSentinels = new Set<string>(); // recipe_id+units già segnalati

    for (const log of logs) {
      const logNameLower = (log.item as string || '').toLowerCase().trim();

      // Exact match, poi contains
      let task = taskByName.get(logNameLower);
      if (!task) {
        for (const [k, v] of taskByName) {
          if (k.includes(logNameLower) || logNameLower.includes(k)) { task = v; break; }
        }
      }

      // PROTEZIONE 2
      if (!task) { unmatchedItems.add(log.item); continue; }

      // PROTEZIONE 3
      if (!task.recipe_id) {
        const obsKey = `no_recipe|${task.id}`;
        if (!unitMismatchSentinels.has(obsKey)) {
          unitMismatchSentinels.add(obsKey);
          observations.push({
            severity: 'warning', category: 'prep_log_no_recipe_id',
            title: `prep_log senza recipe_id — ${log.item}`,
            explanation: `prep_task "${log.item}" (id=${task.id}) non ha recipe_id. Impossibile creare snapshot: item_id è uuid NOT NULL.`,
            suggested_action: `Collegare "${log.item}" (id=${task.id}) a una ricetta nel Recipe Editor.`,
          });
          warningCount++;
        }
        continue;
      }

      const recipeId: string = task.recipe_id;
      const taskUnit: string = (task.unit || '').toLowerCase().trim();
      const logUnit: string  = (log.unit  || '').toLowerCase().trim();
      let   loadQty: number  = parseFloat(log.qty);

      // PROTEZIONE 4: normalizza
      if (logUnit !== taskUnit && taskUnit) {
        const converted = normaliseQty(loadQty, logUnit, taskUnit);
        if (converted !== null) {
          loadQty = converted;
        } else {
          // Unità incompatibili: segnala una volta per coppia
          const sentinel = `unit_mismatch_load|${recipeId}|${logUnit}|${taskUnit}`;
          if (!unitMismatchSentinels.has(sentinel)) {
            unitMismatchSentinels.add(sentinel);
            observations.push({
              severity: 'warning', category: 'unit_mismatch_load',
              title: `Unit mismatch carico — ${log.item}: log=${logUnit} vs task=${taskUnit}`,
              explanation: `Impossibile convertire "${logUnit}" in "${taskUnit}". La riga viene scartata da loaded_qty.`,
              suggested_action: `Verificare che il cook registri in ${taskUnit}. Aggiornare il DONE flow se l'unità predefinita è sbagliata.`,
            });
            warningCount++;
          }
          continue;
        }
      }

      if (!loadGroups.has(recipeId)) {
        loadGroups.set(recipeId, {
          recipe_id: recipeId,
          prep_task_id: task.id,
          task_name: task.name,
          task_unit: taskUnit || logUnit,
          loaded_qty: 0,
          logs: [] as any[],
        });
      }
      const lg = loadGroups.get(recipeId)!;
      lg.loaded_qty += loadQty;
      if (lg.logs.length < 10) {
        lg.logs.push({
          user: log.user_name,
          qty: parseFloat(log.qty),
          unit: log.unit,
          at: log.created_at ? new Date(log.created_at).toISOString().slice(11, 16) + ' UTC' : null,
          duration_min: log.duration_minutes ?? null,
        });
      }
    }

    // PROTEZIONE 2 — observation unica per tutti gli unmatched
    if (unmatchedItems.size > 0) {
      const names = [...unmatchedItems];
      observations.push({
        severity: 'warning', category: 'prep_log_unmatched',
        title: `prep_log: ${names.length} item senza match prep_task — ${names.slice(0, 5).join(', ')}${names.length > 5 ? '...' : ''}`,
        explanation: `${names.length} item di prep_log non hanno trovato un prep_task con nome corrispondente (archived=false). loaded_qty non può essere calcolato per questi item.`,
        suggested_action: `Verificare nomi: ${names.join(', ')}. Se esiste con nome diverso, allineare nome in Brigade.`,
      });
      warningCount++;
    }

    // ── STEP 5: Aggrega stock_deductions → groups (come v4) ──
    const groups = new Map<string, any>();
    for (const row of (deductions || [])) {
      if (row.quantity == null || parseFloat(row.quantity) <= 0) continue;
      const itemType: string = row.item_type;
      if (!itemType || (itemType !== 'prep' && itemType !== 'ingredient')) continue;
      const itemId: string | null = itemType === 'prep'
        ? (row.target_recipe_id || row.item_id || null)
        : (row.ingredient_id || row.item_id || null);
      if (!itemId) continue;
      const key = `${itemType}|${itemId}`;
      if (!groups.has(key)) {
        groups.set(key, {
          item_type: itemType, item_id: itemId,
          prep_task_id: null as number | null,
          ingredient_id: itemType === 'ingredient' ? itemId : null,
          target_recipe_id: itemType === 'prep' ? itemId : null,
          target_name: null as string | null,
          pos_deducted_qty: 0,
          loaded_qty: 0,
          loaded_logs: [] as any[],
          loaded_by: [] as string[],
          last_loaded_at: null as string | null,
          sources: new Set<string>(),
          deduction_rows: 0,
          units_seen: new Set<string>(),
          unit_dominant: null as string | null,
          all_prep_task_ids: new Set<number>(),
          warnings: [] as string[],
        });
      }
      const g = groups.get(key)!;
      g.pos_deducted_qty += parseFloat(row.quantity);
      if (row.source) g.sources.add(row.source);
      g.deduction_rows++;
      if (row.unit) { const u = row.unit.trim(); g.units_seen.add(u); if (!g.unit_dominant) g.unit_dominant = u; }
      if (row.prep_task_id) { g.all_prep_task_ids.add(row.prep_task_id); if (!g.prep_task_id) g.prep_task_id = row.prep_task_id; }
      if (!g.target_name && row.target_name) g.target_name = row.target_name;
    }

    // Unit mismatch POS (stesso item, unità diverse — come v4)
    for (const [, g] of groups) {
      if (g.units_seen.size > 1) {
        const unitsStr = [...g.units_seen].join(', ');
        g.warnings.push(`unit mismatch POS: ${unitsStr} — qty sommate, unit=${g.unit_dominant}`);
        observations.push({
          severity: 'warning', category: 'bom_warning',
          title: `Unit mismatch POS — ${g.target_name || g.item_id}: ${unitsStr}`,
          explanation: `Unità diverse (${unitsStr}) per lo stesso item. Qty sommate, unit=${g.unit_dominant}. Correggere BOM.`,
          suggested_action: `Allineare unità BOM per ${g.target_name || g.item_id}`,
        });
        warningCount++;
      }
      if (g.item_type === 'prep' && g.all_prep_task_ids.size === 0) {
        g.warnings.push('prep senza prep_task_id');
        observations.push({
          severity: 'warning', category: 'bom_warning',
          title: `Prep senza prep_task_id — ${g.target_name || g.item_id}`,
          explanation: `Ricetta ${g.item_id} non ha prep_task collegato.`,
          suggested_action: `Collegare ricetta ${g.item_id} a un prep_task`,
        });
        warningCount++;
      }
    }

    // ── STEP 6: Unisci loaded_qty nei groups POS ──
    for (const [recipeId, lg] of loadGroups) {
      const posKey = `prep|${recipeId}`;
      if (groups.has(posKey)) {
        const g = groups.get(posKey)!;
        const posUnit  = (g.unit_dominant || '').toLowerCase().trim();
        const loadUnit = (lg.task_unit || '').toLowerCase().trim();
        if (posUnit === loadUnit || !posUnit) {
          g.loaded_qty   = (g.loaded_qty || 0) + lg.loaded_qty;
          g.loaded_logs  = lg.logs;
          g.loaded_by    = [...new Set<string>(lg.logs.map((l: any) => l.user))];
          g.last_loaded_at = lg.logs.length > 0 ? lg.logs[lg.logs.length - 1].at : null;
        } else {
          const converted = normaliseQty(lg.loaded_qty, loadUnit, posUnit);
          if (converted !== null) {
            g.loaded_qty   = (g.loaded_qty || 0) + converted;
            g.loaded_logs  = lg.logs;
            g.loaded_by    = [...new Set<string>(lg.logs.map((l: any) => l.user))];
            g.last_loaded_at = lg.logs.length > 0 ? lg.logs[lg.logs.length - 1].at : null;
          } else {
            // PROTEZIONE 4: non sommare se non convertibile
            const sentinel = `unit_snap|${recipeId}|${loadUnit}|${posUnit}`;
            if (!unitMismatchSentinels.has(sentinel)) {
              unitMismatchSentinels.add(sentinel);
              g.warnings.push(`loaded_qty unit mismatch: POS=${posUnit} vs log=${loadUnit} — loaded_qty non sommato`);
              observations.push({
                severity: 'warning', category: 'unit_mismatch_snapshot',
                title: `Unit mismatch snapshot — ${lg.task_name}: POS=${posUnit} vs carico=${loadUnit}`,
                explanation: `Non è possibile sommare ${loadUnit} e ${posUnit} in modo sicuro. loaded_qty=0 per questo item.`,
                suggested_action: `Allineare unità prep_task "${lg.task_name}" con quella del DONE flow.`,
              });
              warningCount++;
            }
          }
        }
      } else {
        // Carico senza scarico POS → snapshot load-only
        const loadOnlyWarning = loadOnly
          ? null
          : 'Load-only snapshot: POS deduction pipeline missing or incomplete for this prep.';

        const loadOnlyKey = `prep|${recipeId}`;
        groups.set(loadOnlyKey, {
          item_type: 'prep', item_id: recipeId,
          prep_task_id: lg.prep_task_id, ingredient_id: null,
          target_recipe_id: recipeId, target_name: lg.task_name,
          pos_deducted_qty: 0, loaded_qty: lg.loaded_qty,
          loaded_logs: lg.logs,
          loaded_by: [...new Set<string>(lg.logs.map((l: any) => l.user))],
          last_loaded_at: lg.logs.length > 0 ? lg.logs[lg.logs.length - 1].at : null,
          sources: new Set(['prep_log']),
          deduction_rows: 0, units_seen: new Set([lg.task_unit]),
          unit_dominant: lg.task_unit, all_prep_task_ids: new Set([lg.prep_task_id]),
          warnings: loadOnlyWarning ? [loadOnlyWarning] : [],
        });

        if (!loadOnly) {
          observations.push({
            severity: 'info', category: 'load_only_snapshot',
            title: `Load-only snapshot — ${lg.task_name}`,
            explanation: `"${lg.task_name}" ha carichi in prep_log (${lg.loaded_qty.toFixed(2)} ${lg.task_unit}) ma nessuno scarico POS per ${businessDate}. Snapshot creato con pos_deducted_qty=0.`,
            suggested_action: `Normale per prep non vendute direttamente al POS. Se inatteso, verificare mapping recipe ↔ pos_name.`,
          });
        }
      }
    }

    // ── STEP 7: Prepara righe snapshot ──
    const snapshotRows: any[] = [];
    let skipped = 0;

    for (const [, g] of groups) {
      if (!g.item_id) {
        skipped++;
        observations.push({
          severity: 'warning', category: 'missing_link',
          title: `Snapshot saltato — item_id mancante: ${g.target_name || 'unknown'}`,
          explanation: `item_type=${g.item_type}, prep_task_id=${g.prep_task_id}, ingredient_id=${g.ingredient_id}`,
          suggested_action: `Collegare a una ricetta con UUID valido`,
        });
        warningCount++;
        continue;
      }

      const loadedQty = Math.round((g.loaded_qty || 0) * 1000) / 1000;
      const posQty    = Math.round((g.pos_deducted_qty || 0) * 1000) / 1000;
      const warningTxt = g.warnings.length > 0 ? g.warnings.join(' | ') : null;

      snapshotRows.push({
        business_date: businessDate,
        item_type: g.item_type,
        item_id: g.item_id,
        stock_start: null,
        loaded_qty: loadedQty,
        pos_deducted_qty: posQty,
        waste_qty: 0,
        adjustment_qty: 0,
        stock_end: null,
        unit: g.unit_dominant || null,
        status: g.warnings.length > 0 ? 'warning' : 'partial',
        warning: warningTxt,
        metadata: {
          sources: [...g.sources],
          deduction_rows: g.deduction_rows,
          units_in_source: [...g.units_seen],
          prep_task_id: g.prep_task_id ?? null,
          ingredient_id: g.ingredient_id ?? null,
          target_recipe_id: g.target_recipe_id ?? null,
          target_name: g.target_name ?? null,
          // v5 — carico da prep_log
          loaded_logs_count: (g.loaded_logs || []).length,
          loaded_by: g.loaded_by || [],
          last_loaded_at: g.last_loaded_at ?? null,
          loaded_logs: (g.loaded_logs || []).slice(0, 10),
          consolidator_version: BOT_VERSION,
          load_only: loadOnly && posQty === 0,
        },
      });
    }

    // ── STEP 8: Insert snapshot ──
    let rowsWritten = 0;
    if (snapshotRows.length > 0) {
      const { error: insertErr } = await supa.from('stock_daily_snapshot').insert(snapshotRows);
      if (insertErr) throw new Error(`snapshot insert: ${insertErr.message}`);
      rowsWritten = snapshotRows.length;
    }

    console.log(`[${BOT_NAME}] Wrote ${rowsWritten} snapshot rows, ${skipped} skipped`);

    const loadedCount   = snapshotRows.filter(r => (r.loaded_qty  || 0) > 0).length;
    const loadOnlyCount = snapshotRows.filter(r => (r.loaded_qty  || 0) > 0 && (r.pos_deducted_qty || 0) === 0).length;

    // Summary observation
    observations.push({
      severity: 'info', category: 'consolidation_summary',
      title: `Snapshot ${businessDate} — ${rowsWritten} righe, ${loadedCount} con carico, ${loadOnlyCount} load-only, ${warningCount} warning, ${skipped} saltati`,
      explanation: `${BOT_VERSION}: ${rowsWritten} snapshot da ${(deductions?.length ?? 0)} deductions + ${logs.length} prep_log rows. ${loadedCount} con loaded_qty>0. ${loadOnlyCount} load-only. ${warningCount} warning. ${skipped} saltati. current_stock NON aggiornato.`,
      suggested_action: `SELECT metadata->>'target_name', loaded_qty, pos_deducted_qty, unit FROM stock_daily_snapshot WHERE business_date='${businessDate}' AND loaded_qty > 0 ORDER BY loaded_qty DESC`,
    });

    if (observations.length > 0) {
      const obsRows = observations.map(o => ({
        business_date: businessDate, bot_name: BOT_NAME, commis_name: COMMIS_NAME,
        severity: o.severity, category: o.category, title: o.title,
        explanation: o.explanation, suggested_action: o.suggested_action, status: 'open',
      }));
      const { error: obsErr } = await supa.from('commis_observations').insert(obsRows);
      if (obsErr) console.error(`[${BOT_NAME}] obs insert error: ${obsErr.message}`);
    }

    const deductionsRead = (deductions?.length ?? 0) + logs.length;
    const summary = `${BOT_VERSION} ${businessDate}: ${rowsWritten} snapshot (${loadedCount} with load, ${loadOnlyCount} load-only) from ${deductions?.length ?? 0} deductions + ${logs.length} prep_log rows. Groups: ${groups.size}. Skipped: ${skipped}. Warnings: ${warningCount}. current_stock NOT updated.`;
    await updateRun(supa, botRunId, 'success', deductionsRead, rowsWritten, warningCount, 0, summary);

    console.log(`[${BOT_NAME}] Done. ${summary}`);

    return jsonRes({
      ok: true, businessDate, version: BOT_VERSION,
      deductionsRead: deductions?.length ?? 0,
      prepLogRowsRead: logs.length,
      groupsTotal: groups.size,
      snapshotRowsWritten: rowsWritten,
      snapshotWithLoad: loadedCount,
      snapshotLoadOnly: loadOnlyCount,
      skipped, warningCount,
      observations: observations.length,
      unmatchedLogs: unmatchedItems.size,
      note: 'current_stock NOT updated — v5_load_qty',
    });

  } catch (err: any) {
    console.error(`[${BOT_NAME}] Fatal:`, err);
    if (botRunId) await updateRun(supa, botRunId, 'error', 0, 0, 0, 1, `Fatal: ${err.message}`);
    return jsonRes({ ok: false, error: err.message }, 500);
  }
});

// ── Helpers ──
async function updateRun(supa: any, runId: string | null, status: string, rowsRead: number, rowsWritten: number, warningsCount: number, errorsCount: number, summary: string) {
  if (!runId) return;
  await supa.from('bot_runs').update({
    status, rows_read: rowsRead, rows_written: rowsWritten,
    warnings_count: warningsCount, errors_count: errorsCount,
    summary, finished_at: new Date().toISOString(),
  }).eq('id', runId);
}

function jsonRes(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
    status,
  });
}
