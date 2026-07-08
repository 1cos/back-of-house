// bot-stock-consolidator v2
// Sprint A — Stock Consolidator: Load Qty from prep_log
//
// v2 aggiunge rispetto a v1:
//   - Legge prep_log per business_date → popola stock_daily_snapshot.loaded_qty
//   - Crea snapshot "load-only" se prep_log ha carichi ma mancano POS deductions
//   - 4 protezioni: Pipeline Guard, match warning, item_id check, unit normalizzazione
//
// ⚠️ INVARIATO v1→v2:
//   - Non aggiorna current_stock
//   - Non scrive stock_movements
//   - Non modifica prep_log
//   - Non cambia il flusso DONE esistente

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BOT_NAME = 'bot-stock-consolidator';
const COMMIS_NAME = 'stock-consolidator-commis';
const BOT_VERSION = 'v2_load_qty';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Unit normalisation ──
// Converte unità sicure verso l'unità canonica.
// NON converte: pz, each, nests, cup, buste — unità fisiche non riducibili a peso.
function normaliseUnit(qty, fromUnit, toUnit) {
  if (!fromUnit || !toUnit) return null;
  const f = fromUnit.toLowerCase().trim();
  const t = toUnit.toLowerCase().trim();
  if (f === t) return { qty, unit: t };
  // kg ↔ g
  if (f === 'kg' && t === 'g')  return { qty: qty * 1000, unit: 'g' };
  if (f === 'g'  && t === 'kg') return { qty: qty / 1000, unit: 'kg' };
  // ml ↔ l
  if (f === 'ml' && t === 'l')  return { qty: qty / 1000, unit: 'l' };
  if (f === 'l'  && t === 'ml') return { qty: qty * 1000, unit: 'ml' };
  // Unità fisiche non convertibili
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const startedAt = new Date().toISOString();
  let botRunId = null;
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const businessDate = body.business_date || new Date().toISOString().split('T')[0];
    // load_only=true: consente snapshot anche senza deductions POS (run manuale carichi)
    const loadOnly = body.load_only === true;

    console.log(`[${BOT_NAME}] v2 Starting run for ${businessDate}, load_only=${loadOnly}`);

    // Register bot run
    const { data: runData } = await supa.from('bot_runs').insert({
      bot_name: BOT_NAME,
      run_date: businessDate,
      status: 'running',
      started_at: startedAt,
      summary: `v2 Starting consolidation for ${businessDate}`,
      metadata: { business_date: businessDate, version: BOT_VERSION, load_only: loadOnly },
    }).select('id').single();
    botRunId = runData?.id;

    // ── PROTEZIONE 1: Pipeline Guard ──
    // Verifica che bot-direct-deduction e bot-bom-chain-deduction abbiano girato
    // con successo per questa data — SOLO se non è una run load_only.
    if (!loadOnly) {
      const { data: upstreamRuns } = await supa
        .from('bot_runs')
        .select('bot_name, status, finished_at')
        .eq('run_date', businessDate)
        .in('bot_name', ['bot-direct-deduction', 'bot-bom-chain-deduction'])
        .eq('status', 'success')
        .order('finished_at', { ascending: false });

      const successBots = new Set((upstreamRuns || []).map(r => r.bot_name));
      const missingUpstream = [];
      if (!successBots.has('bot-direct-deduction'))   missingUpstream.push('bot-direct-deduction');
      if (!successBots.has('bot-bom-chain-deduction')) missingUpstream.push('bot-bom-chain-deduction');

      if (missingUpstream.length > 0) {
        await writeCommisObs(supa, businessDate, 'critical', 'pipeline_guard_fail',
          `Pipeline Guard: upstream mancante — ${missingUpstream.join(', ')}`,
          `Il Consolidator richiede che bot-direct-deduction e bot-bom-chain-deduction abbiano completato con successo per ${businessDate}. Mancano: ${missingUpstream.join(', ')}.`,
          'Eseguire la pipeline completa in ordine: pos-cleaner → direct-deduction → bom-chain-deduction → consolidator'
        );
        await updateBotRun(supa, botRunId, 'error', 0, 0, 0, 1,
          `Pipeline Guard fail: upstream mancante per ${businessDate} — ${missingUpstream.join(', ')}`);
        return jsonRes({ ok: false, error: 'Pipeline Guard: upstream bots not successful', missing: missingUpstream, businessDate }, 200);
      }
    }

    // ── STEP 1: Idempotenza ──
    await supa.from('stock_daily_snapshot').delete().eq('business_date', businessDate);
    await supa.from('commis_observations')
      .delete()
      .eq('business_date', businessDate)
      .eq('bot_name', BOT_NAME)
      .eq('commis_name', COMMIS_NAME);

    const observations = [];
    let warningCount = 0;

    // ── STEP 2: Leggi stock_deductions ──
    const { data: deductions, error: deductionsError } = await supa
      .from('stock_deductions')
      .select('*')
      .eq('business_date', businessDate);

    if (deductionsError) throw new Error(`stock_deductions read error: ${deductionsError.message}`);

    const hasDeductions = deductions && deductions.length > 0;

    if (!hasDeductions && !loadOnly) {
      await writeCommisObs(supa, businessDate, 'critical', 'missing_input',
        `Nessuna deduction trovata per ${businessDate}`,
        'Il Consolidator non ha trovato dati in stock_deductions per questa data. Verificare che bot-direct-deduction e bot-bom-chain-deduction abbiano girato.',
        'Triggerare la pipeline completa prima di questo bot. Oppure usare load_only=true per creare snapshot solo dai carichi prep_log.'
      );
      await updateBotRun(supa, botRunId, 'error', 0, 0, 1, 0,
        `Nessuna stock_deduction trovata per ${businessDate}`);
      return jsonRes({ ok: false, error: 'No deductions found', hint: 'Use load_only=true to create load-only snapshot', businessDate }, 200);
    }

    console.log(`[${BOT_NAME}] Found ${(deductions||[]).length} deduction rows`);

    // ── STEP 2.5: Leggi prep_log per business_date (CDT) ──
    // business_date = giorno operativo CDT.
    // prep_log.created_at è UTC → converte in CDT per filtrare.
    // Lo snapshot di 2026-07-06 include prep chiuse il 06/07 CDT (non il 07 mattina).
    const { data: prepLogs, error: prepLogError } = await supa
      .from('prep_log')
      .select('item, qty, unit, user_name, created_at, duration_minutes, station')
      .gte('created_at', `${businessDate}T05:00:00Z`)   // 00:00 CDT = 05:00 UTC
      .lt('created_at',  `${businessDate}T29:00:00Z`)   // fine giorno CDT (usa giorno+1 05:00 UTC)
      .neq('unit', 'no_need')
      .gt('qty', 0)
      .order('created_at', { ascending: true });

    // Correzione intervallo: fine = giorno successivo 05:00 UTC
    // Ricostruiamo in modo robusto
    const nextDate = new Date(`${businessDate}T05:00:00Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const nextDateISO = nextDate.toISOString();

    const { data: prepLogsClean, error: prepLogError2 } = await supa
      .from('prep_log')
      .select('item, qty, unit, user_name, created_at, duration_minutes, station')
      .gte('created_at', `${businessDate}T05:00:00Z`)
      .lt('created_at',  nextDateISO)
      .neq('unit', 'no_need')
      .gt('qty', 0)
      .order('created_at', { ascending: true });

    if (prepLogError2) {
      console.warn(`[${BOT_NAME}] prep_log read warning: ${prepLogError2.message}`);
      observations.push({
        severity: 'warning',
        category: 'prep_log_read_error',
        title: `prep_log read error per ${businessDate}`,
        explanation: `Impossibile leggere prep_log: ${prepLogError2.message}. loaded_qty sarà 0 su tutti gli snapshot.`,
        suggested_action: 'Verificare permessi tabella prep_log e ripetere il run.',
      });
      warningCount++;
    }

    const logs = prepLogsClean || [];
    console.log(`[${BOT_NAME}] Found ${logs.length} prep_log rows for ${businessDate}`);

    // ── STEP 2.6: Fetch prep_tasks per match nome → recipe_id ──
    // Legge tutti i prep_task attivi per costruire la mappa nome → {recipe_id, unit, id}
    const { data: allTasks } = await supa
      .from('prep_tasks')
      .select('id, name, recipe_id, unit')
      .eq('archived', false);

    // Mappa: name_lowercase → task
    const taskByName = new Map();
    for (const t of (allTasks || [])) {
      taskByName.set(t.name.toLowerCase().trim(), t);
    }

    // ── STEP 2.7: Aggrega prep_log per item ──
    // PROTEZIONE 2: match warning se non trova il task
    // PROTEZIONE 3: salta se recipe_id è null (item_id NOT NULL in snapshot)
    // PROTEZIONE 4: normalizza unit verso unit canonica del task
    const loadGroups = new Map(); // key: recipe_id (uuid) → group
    const unmatchedLogs = [];    // log senza match prep_task

    for (const log of logs) {
      const logName = (log.item || '').toLowerCase().trim();
      // Exact match prima, poi ILIKE-style (contains)
      let task = taskByName.get(logName);
      if (!task) {
        // Fallback: cerca task il cui nome contiene il nome del log
        for (const [k, v] of taskByName) {
          if (k.includes(logName) || logName.includes(k)) {
            task = v;
            break;
          }
        }
      }

      // PROTEZIONE 2: nessun match → observation, non creare snapshot
      if (!task) {
        unmatchedLogs.push(log);
        continue;
      }

      // PROTEZIONE 3: recipe_id null → observation, non creare snapshot
      if (!task.recipe_id) {
        observations.push({
          severity: 'warning',
          category: 'prep_log_no_recipe_id',
          title: `prep_log senza recipe_id — ${log.item}`,
          explanation: `prep_log ha un carico per "${log.item}" (prep_task_id=${task.id}) ma il prep_task non ha recipe_id. Impossibile creare snapshot: item_id è uuid NOT NULL.`,
          suggested_action: `Collegare il prep_task "${log.item}" (id=${task.id}) a una ricetta nel Recipe Editor.`,
        });
        warningCount++;
        continue;
      }

      const recipeId = task.recipe_id; // uuid — useremo come item_id in snapshot

      // PROTEZIONE 4: normalizzazione unità
      const taskUnit = (task.unit || '').toLowerCase().trim();
      const logUnit  = (log.unit  || '').toLowerCase().trim();
      let loadQty = parseFloat(log.qty);
      let resolvedUnit = logUnit;

      if (logUnit !== taskUnit && taskUnit) {
        const conv = normaliseUnit(loadQty, logUnit, taskUnit);
        if (conv) {
          loadQty = conv.qty;
          resolvedUnit = conv.unit;
        } else {
          // Unità non convertibili: non sommare, scrivi warning
          const warnKey = `unit_mismatch_load|${recipeId}|${logUnit}|${taskUnit}`;
          if (!loadGroups.has(warnKey)) {
            observations.push({
              severity: 'warning',
              category: 'unit_mismatch_load',
              title: `Unit mismatch carico — ${log.item}: log=${logUnit} vs task=${taskUnit}`,
              explanation: `Non è possibile convertire "${logUnit}" in "${taskUnit}" per il carico di "${log.item}". La riga viene scartata dalla somma loaded_qty.`,
              suggested_action: `Verificare che il cook registri la quantità nell'unità corretta (${taskUnit}). Aggiornare il DONE flow se l'unità predefinita è sbagliata.`,
            });
            loadGroups.set(warnKey, null); // sentinel — segnalato, non aggregare
            warningCount++;
          }
          continue;
        }
      }

      const key = recipeId; // aggrega per recipe_id
      if (!loadGroups.has(key)) {
        loadGroups.set(key, {
          recipe_id: recipeId,
          prep_task_id: task.id,
          task_name: task.name,
          task_unit: taskUnit || logUnit,
          loaded_qty: 0,
          logs: [],
        });
      }
      const g = loadGroups.get(key);
      if (g === null) continue; // sentinel unit-mismatch
      g.loaded_qty += loadQty;

      // Aggiungi al log array (cap a 10 per metadata)
      if (g.logs.length < 10) {
        g.logs.push({
          user: log.user_name,
          qty: parseFloat(log.qty),
          unit: log.unit,
          at: log.created_at ? new Date(log.created_at).toISOString().slice(11, 16) + ' UTC' : null,
          duration_min: log.duration_minutes || null,
        });
      }
    }

    // PROTEZIONE 2 — scrivi observation unica per tutti gli unmatched
    if (unmatchedLogs.length > 0) {
      const names = [...new Set(unmatchedLogs.map(l => l.item))];
      observations.push({
        severity: 'warning',
        category: 'prep_log_unmatched',
        title: `prep_log: ${unmatchedLogs.length} righe senza match prep_task — ${names.slice(0, 5).join(', ')}${names.length > 5 ? '...' : ''}`,
        explanation: `${unmatchedLogs.length} righe di prep_log non hanno trovato un prep_task con nome corrispondente (archived=false). loaded_qty non può essere calcolato per questi item.`,
        suggested_action: `Verificare i nomi: ${names.join(', ')}. Se il prep_task esiste con nome diverso, aggiornare il nome in Brigade o aggiungere un alias.`,
      });
      warningCount++;
    }

    // ── STEP 3: Aggregazione stock_deductions ──
    const groups = new Map();

    for (const row of (deductions || [])) {
      if (row.quantity == null || parseFloat(row.quantity) <= 0) continue;

      const itemType = row.item_type || 'unknown';
      const unit = (row.unit || '').trim();
      const resolvedItemId = itemType === 'prep'
        ? (row.target_recipe_id || row.item_id || null)
        : (row.ingredient_id || row.item_id || null);

      const key = `${itemType}|${resolvedItemId || 'null'}|${unit}`;

      if (!groups.has(key)) {
        groups.set(key, {
          item_type: itemType,
          item_id: resolvedItemId,
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

    // ── STEP 3.5: Unisci loaded_qty nei groups POS ──
    // Per ogni load group (recipe_id), cerca il gruppo POS corrispondente.
    // Se trovato → aggiorna loaded_qty nel group esistente.
    // Se non trovato (carico senza scarico POS) → aggiungi group "load-only".
    for (const [recipeId, lg] of loadGroups) {
      if (lg === null) continue; // sentinel

      // Cerca group POS con item_id = recipeId e item_type = 'prep'
      let found = false;
      for (const [key, g] of groups) {
        if (g.item_type === 'prep' && g.item_id === recipeId) {
          // PROTEZIONE 4: verifica compatibilità unit prima di assegnare
          const posUnit  = (g.unit || '').toLowerCase().trim();
          const loadUnit = (lg.task_unit || '').toLowerCase().trim();
          if (posUnit === loadUnit) {
            g.loaded_qty = (g.loaded_qty || 0) + lg.loaded_qty;
            g.loaded_logs = lg.logs;
            g.loaded_by   = [...new Set(lg.logs.map(l => l.user))];
            g.last_loaded_at = lg.logs.length > 0 ? lg.logs[lg.logs.length - 1].at : null;
          } else {
            // Prova conversione POS unit → load unit
            const conv = normaliseUnit(lg.loaded_qty, loadUnit, posUnit);
            if (conv) {
              g.loaded_qty = (g.loaded_qty || 0) + conv.qty;
              g.loaded_logs = lg.logs;
              g.loaded_by   = [...new Set(lg.logs.map(l => l.user))];
              g.last_loaded_at = lg.logs.length > 0 ? lg.logs[lg.logs.length - 1].at : null;
            } else {
              g.warnings.push(`loaded_qty unit mismatch: POS=${posUnit} vs prep_log=${loadUnit} — loaded_qty non sommato`);
              observations.push({
                severity: 'warning',
                category: 'unit_mismatch_snapshot',
                title: `Unit mismatch snapshot — ${lg.task_name}: POS=${posUnit} vs carico=${loadUnit}`,
                explanation: `Lo scarico POS usa ${posUnit}, il carico prep_log usa ${loadUnit}. Non è possibile sommare in modo sicuro. loaded_qty è 0 per questo item nello snapshot.`,
                suggested_action: `Allineare l'unità del prep_task "${lg.task_name}" (${posUnit}) con quella usata nel DONE flow.`,
              });
              warningCount++;
            }
          }
          found = true;
          break;
        }
      }

      if (!found) {
        // Carico senza scarico POS per questa data → snapshot load-only
        const loadOnlyWarning = loadOnly
          ? null
          : 'Load-only snapshot: POS deduction pipeline missing or incomplete for this prep.';

        const loadOnlyKey = `prep|${recipeId}|${lg.task_unit}`;
        groups.set(loadOnlyKey, {
          item_type: 'prep',
          item_id: recipeId,
          unit: lg.task_unit,
          prep_task_id: lg.prep_task_id,
          ingredient_id: null,
          target_recipe_id: recipeId,
          target_name: lg.task_name,
          pos_deducted_qty: 0,
          loaded_qty: lg.loaded_qty,
          loaded_logs: lg.logs,
          loaded_by: [...new Set(lg.logs.map(l => l.user))],
          last_loaded_at: lg.logs.length > 0 ? lg.logs[lg.logs.length - 1].at : null,
          sources: new Set(['prep_log']),
          deduction_rows: 0,
          all_prep_task_ids: new Set([lg.prep_task_id]),
          warnings: loadOnlyWarning ? [loadOnlyWarning] : [],
        });

        if (!loadOnly) {
          observations.push({
            severity: 'info',
            category: 'load_only_snapshot',
            title: `Load-only snapshot — ${lg.task_name}`,
            explanation: `"${lg.task_name}" ha carichi in prep_log (${lg.loaded_qty.toFixed(2)} ${lg.task_unit}) ma nessuno scarico POS per ${businessDate}. Snapshot creato con pos_deducted_qty=0.`,
            suggested_action: `Normale se la prep non è venduta direttamente al POS. Se inatteso, verificare il mapping recipe ↔ pos_name.`,
          });
        }
      }
    }

    // ── STEP 4: Detect unit mismatches per stesso prep/ingredient (POS) ──
    const baseKeyMap = new Map();
    for (const [key, g] of groups) {
      const baseKey = `${g.item_type}|${g.item_id || 'null'}`;
      if (!baseKeyMap.has(baseKey)) baseKeyMap.set(baseKey, []);
      baseKeyMap.get(baseKey).push(g);
    }

    for (const [baseKey, gs] of baseKeyMap) {
      if (gs.length > 1) {
        const units = [...new Set(gs.map(g => g.unit))].join(', ');
        const name = gs[0].target_name || gs[0].item_id || baseKey;
        for (const g of gs) g.warnings.push(`unit mismatch POS: ${units}`);
        observations.push({
          severity: 'warning',
          category: 'unit_mismatch',
          title: `Unit mismatch POS — ${name}: ${units}`,
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

      if (g.item_type === 'prep' && !g.prep_task_id && (!g.all_prep_task_ids || g.all_prep_task_ids.size === 0)) {
        g.warnings.push('prep senza prep_task_id — non aggiornabile in v3');
        observations.push({
          severity: 'warning',
          category: 'missing_link',
          title: `Prep senza prep_task_id — ${g.target_name || g.item_id}`,
          explanation: `La deduction è collegata a una ricetta (${g.item_id}) ma non ha prep_task_id. In v3 non sarà possibile aggiornare current_stock per questa prep.`,
          suggested_action: `Verificare che la ricetta ${g.item_id} abbia un prep_task collegato`,
        });
        warningCount++;
      }

      if (g.item_type === 'ingredient' && !g.ingredient_id) {
        g.warnings.push('ingredient senza ingredient_id');
        warningCount++;
      }

      const warningText = g.warnings.length > 0 ? g.warnings.join(' | ') : null;
      const loadedQty = Math.round((g.loaded_qty || 0) * 1000) / 1000;
      const posQty    = Math.round((g.pos_deducted_qty || 0) * 1000) / 1000;

      // Status: warning se ci sono warning POS, partial altrimenti
      // Load-only (pos=0, loaded>0, no POS warning) → partial con nota
      let status = g.warnings.length > 0 ? 'warning' : 'partial';

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
        unit: g.unit || null,
        status,
        warning: warningText,
        metadata: {
          sources: Array.from(g.sources || []),
          deduction_rows: g.deduction_rows || 0,
          prep_task_id: g.prep_task_id || null,
          ingredient_id: g.ingredient_id || null,
          target_recipe_id: g.target_recipe_id || null,
          target_name: g.target_name || null,
          // v2 — carico prep_log
          loaded_logs_count: (g.loaded_logs || []).length,
          loaded_by: g.loaded_by || [],
          last_loaded_at: g.last_loaded_at || null,
          loaded_logs: (g.loaded_logs || []).slice(0, 10),
          consolidator_version: BOT_VERSION,
          load_only: loadOnly && posQty === 0,
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

    // ── STEP 7: Summary observation ──
    const loadedCount = snapshotRows.filter(r => (r.loaded_qty || 0) > 0).length;
    const loadOnlyCount = snapshotRows.filter(r => (r.loaded_qty || 0) > 0 && (r.pos_deducted_qty || 0) === 0).length;

    if (warningCount > 0 || skipped > 0 || loadedCount > 0) {
      observations.push({
        severity: 'info',
        category: 'consolidation_summary',
        title: `Snapshot ${businessDate} — ${rowsWritten} righe, ${loadedCount} con carico, ${loadOnlyCount} load-only, ${warningCount} warning, ${skipped} saltati`,
        explanation: `v2: Stock Consolidator ha creato ${rowsWritten} righe snapshot. ${loadedCount} con loaded_qty>0 (dai ragazzi). ${loadOnlyCount} load-only (solo carico, nessuno scarico POS). ${warningCount} warning. ${skipped} saltati per item_id mancante. current_stock NON aggiornato.`,
        suggested_action: `SELECT metadata->>'target_name', loaded_qty, pos_deducted_qty, unit FROM stock_daily_snapshot WHERE business_date='${businessDate}' AND loaded_qty > 0 ORDER BY loaded_qty DESC;`,
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
    const prepLogCount = logs.length;
    const summary = `${BOT_VERSION} ${businessDate}: ${rowsWritten} snapshot rows (${loadedCount} with load, ${loadOnlyCount} load-only) from ${(deductions||[]).length} deductions + ${prepLogCount} prep_log rows. Groups: ${groups.size}. Skipped: ${skipped}. Warnings: ${warningCount}. current_stock NOT updated.`;
    await updateBotRun(supa, botRunId, 'success', (deductions||[]).length + prepLogCount, rowsWritten, warningCount, 0, summary);

    console.log(`[${BOT_NAME}] Done. ${summary}`);

    return jsonRes({
      ok: true,
      businessDate,
      version: BOT_VERSION,
      deductionsRead: (deductions||[]).length,
      prepLogRowsRead: prepLogCount,
      groupsTotal: groups.size,
      snapshotRowsWritten: rowsWritten,
      snapshotWithLoad: loadedCount,
      snapshotLoadOnly: loadOnlyCount,
      skipped,
      warningCount,
      observations: observations.length,
      unmatchedLogs: unmatchedLogs.length,
      note: 'current_stock NOT updated — v2_load_qty',
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
