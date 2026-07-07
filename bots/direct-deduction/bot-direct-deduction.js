// bot-direct-deduction — Station 3 del TouchBistro POS Bot
// Legge pos_daily_clean → calcola scarichi diretti → scrive stock_deductions
// Solo prep con BOM RECIPE diretto. Zero LLM, zero current_stock, zero stock_movements.
// v3 — aggregazione scarichi: stessa prep + stessa unità per stesso piatto = una riga

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const runStart = Date.now()
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  try {
    const body = await req.json().catch(() => ({}))
    const businessDate = body.business_date || new Date().toISOString().slice(0, 10)

    // ── 0. Idempotenza ──────────────────────────────────────────────────────
    await supa.from('stock_deductions')
      .delete().eq('business_date', businessDate).eq('source', 'direct_recipe')
    await supa.from('commis_observations')
      .delete().eq('business_date', businessDate)
      .eq('bot_name', 'bot-direct-deduction').eq('commis_name', 'direct-deduction-commis')

    // ── 1. pos_daily_clean — righe mappate ──────────────────────────────────
    const { data: cleanRows, error: cleanErr } = await supa
      .from('pos_daily_clean')
      .select('id, pos_item_name, recipe_id, portions_sold, item_class, match_type')
      .eq('business_date', businessDate)
      .eq('action', 'map')
      .not('recipe_id', 'is', null)
      .in('item_class', ['MENU_ITEM', 'KITCHEN_OPERATIONAL'])
    if (cleanErr) throw new Error(`pos_daily_clean: ${cleanErr.message}`)
    if (!cleanRows?.length) return new Response(JSON.stringify({
      success: false, message: `No mapped rows for ${businessDate}`, business_date: businessDate
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    // ── 2. Aggrega porzioni per piatto (stesso pos_item_name → somma portions) ─
    // Gestisce il caso in cui lo stesso piatto appare più volte in pos_daily_clean
    const rowByPosName = new Map() // pos_item_name → { recipe_id, totalPortions }
    for (const r of cleanRows) {
      const portions = parseFloat(r.portions_sold) || 0
      if (rowByPosName.has(r.pos_item_name)) {
        rowByPosName.get(r.pos_item_name).totalPortions += portions
      } else {
        rowByPosName.set(r.pos_item_name, {
          recipe_id:    r.recipe_id,
          totalPortions: portions,
          item_class:   r.item_class,
          match_type:   r.match_type
        })
      }
    }

    // ── 3. BOM per le ricette coinvolte (solo RECIPE links) ─────────────────
    const recipeIds = [...new Set([...rowByPosName.values()].map(r => r.recipe_id))]
    const allBom = []
    for (let i = 0; i < recipeIds.length; i += 50) {
      const { data: bom } = await supa
        .from('recipe_bom')
        .select('bom_id, parent_recipe_id, component_type, sub_recipe_id, quantity, unit')
        .in('parent_recipe_id', recipeIds.slice(i, i + 50))
        .eq('component_type', 'RECIPE')
        .not('sub_recipe_id', 'is', null)
      if (bom) allBom.push(...bom)
    }

    // ── 4. prep_tasks collegati alle sub-recipe ─────────────────────────────
    const subIds = [...new Set(allBom.map(b => b.sub_recipe_id))]
    const prepBySubRecipe = new Map()
    if (subIds.length > 0) {
      for (let i = 0; i < subIds.length; i += 50) {
        const { data: tasks } = await supa
          .from('prep_tasks')
          .select('id, name, recipe_id, unit, current_stock')
          .in('recipe_id', subIds.slice(i, i + 50))
          .eq('archived', false)
        if (tasks) {
          for (const t of tasks) {
            if (!prepBySubRecipe.has(t.recipe_id)) prepBySubRecipe.set(t.recipe_id, t)
          }
        }
      }
    }

    // ── 5. Indicizza BOM per ricetta POS ────────────────────────────────────
    const bomByRecipe = new Map()
    for (const b of allBom) {
      if (!bomByRecipe.has(b.parent_recipe_id)) bomByRecipe.set(b.parent_recipe_id, [])
      bomByRecipe.get(b.parent_recipe_id).push(b)
    }

    // ── 6. Calcola scarichi con accumulatore per aggregazione ───────────────
    // Chiave aggregazione: "posItemName|prepTaskId|unit"
    // Stesso piatto + stessa prep + stessa unità → una sola riga
    const dedAccum    = new Map() // chiave → { qty, portions, paths[], prepTask, row }
    const observations = []
    let skippedNoBom = 0, skippedNoPrepTask = 0, skippedZeroQty = 0

    for (const [posItemName, row] of rowByPosName) {
      const portions = row.totalPortions
      if (portions <= 0) { skippedZeroQty++; continue }

      const bomLinks = bomByRecipe.get(row.recipe_id) || []

      if (bomLinks.length === 0) {
        skippedNoBom++
        observations.push({
          business_date: businessDate, bot_name: 'bot-direct-deduction',
          commis_name: 'direct-deduction-commis', severity: 'info',
          category: 'bom_warning', entity_type: 'recipe',
          title: `${posItemName} — nessuna prep nel BOM (Bot 4)`,
          explanation: `"${posItemName}" non ha prep intermedie nel BOM. Scarico via Bot 4 BOM Chain.`,
          suggested_action: 'Nessuna azione. Bot 4 gestirà lo scarico via BOM chain.',
          metadata: { pos_item_name: posItemName, recipe_id: row.recipe_id, portions_sold: portions }
        })
        continue
      }

      let deductedCount = 0
      for (const bom of bomLinks) {
        const bomQty = parseFloat(bom.quantity) || 0
        const prepTask = prepBySubRecipe.get(bom.sub_recipe_id)

        if (!prepTask) {
          skippedNoPrepTask++
          observations.push({
            business_date: businessDate, bot_name: 'bot-direct-deduction',
            commis_name: 'direct-deduction-commis', severity: 'warning',
            category: 'bom_warning', entity_type: 'prep',
            title: `${posItemName} → sub-recipe senza prep task`,
            explanation: `BOM punta a sub_recipe ${bom.sub_recipe_id} ma nessun prep_task attivo.`,
            suggested_action: 'Collegare prep_task alla sub-ricetta in Brigade.',
            metadata: { pos_item_name: posItemName, sub_recipe_id: bom.sub_recipe_id, bom_id: bom.bom_id }
          })
          continue
        }

        if (bomQty <= 0) {
          skippedZeroQty++
          observations.push({
            business_date: businessDate, bot_name: 'bot-direct-deduction',
            commis_name: 'direct-deduction-commis', severity: 'warning',
            category: 'bom_warning', entity_type: 'prep',
            title: `${posItemName} → BOM qty = 0 per "${prepTask.name}"`,
            explanation: 'Quantità BOM è 0 — impossibile calcolare scarico.',
            suggested_action: 'Correggere la quantità nel BOM.',
            metadata: { pos_item_name: posItemName, prep_task_name: prepTask.name, bom_id: bom.bom_id }
          })
          continue
        }

        const unit      = bom.unit || prepTask.unit || 'g'
        const totalQty  = bomQty * portions
        const calcPath  = `${posItemName} → ${prepTask.name}: ${portions}p × ${bomQty}${unit} = ${totalQty}${unit}`

        // Sanity: BOM qty molto alta per porzione
        if (bomQty > 5000) {
          observations.push({
            business_date: businessDate, bot_name: 'bot-direct-deduction',
            commis_name: 'direct-deduction-commis', severity: 'info',
            category: 'bom_warning', entity_type: 'prep',
            title: `${posItemName} → ${prepTask.name} — qty alta (${bomQty}${unit}/porz)`,
            explanation: `${bomQty}${unit} per porzione potrebbe essere BOM per batch. Standard Brigade: BOM quantity = per porzione singola.`,
            suggested_action: 'Verificare che il BOM sia espresso per porzione singola.',
            metadata: { pos_item_name: posItemName, prep_task_name: prepTask.name, bom_qty: bomQty, unit }
          })
        }

        // Accumulatore aggregazione
        const accumKey = `${posItemName}|${prepTask.id}|${unit}`
        if (dedAccum.has(accumKey)) {
          const acc = dedAccum.get(accumKey)
          acc.totalQty   += totalQty
          acc.portions   += 0 // portions già aggregate sopra — non sommare di nuovo
          acc.paths.push(calcPath)
        } else {
          dedAccum.set(accumKey, {
            totalQty, portions, unit,
            prepTask,
            posItemName, posRecipeId: row.recipe_id,
            subRecipeId: bom.sub_recipe_id,
            paths: [calcPath],
            item_class:  row.item_class,
            match_type:  row.match_type,
            bom_id:      bom.bom_id
          })
        }
        deductedCount++
      }

      if (deductedCount === 0 && bomLinks.length > 0) {
        observations.push({
          business_date: businessDate, bot_name: 'bot-direct-deduction',
          commis_name: 'direct-deduction-commis', severity: 'warning',
          category: 'bom_warning', entity_type: 'recipe',
          title: `${posItemName} — nessun scarico generato`,
          explanation: `Ha BOM RECIPE ma nessuno scarico calcolato (prep task mancanti o qty zero).`,
          suggested_action: 'Verificare BOM e prep_task collegati.',
          metadata: { pos_item_name: posItemName, recipe_id: row.recipe_id, portions_sold: portions }
        })
      }
    }

    // ── 7. Costruisci array deductions dagli accumulatori ───────────────────
    const deductions = []
    for (const acc of dedAccum.values()) {
      const aggregated = acc.paths.length > 1
      const calcPath = aggregated
        ? `${acc.posItemName} → ${acc.prepTask.name} (${acc.paths.length} righe aggregate): ${acc.totalQty}${acc.unit} [direct_recipe/aggregated]`
        : `${acc.paths[0]} [direct_recipe]`

      deductions.push({
        business_date:    businessDate,
        item_type:        'prep',
        item_id:          acc.subRecipeId,
        target_recipe_id: acc.subRecipeId,
        prep_task_id:     acc.prepTask.id,
        ingredient_id:    null,
        target_name:      acc.prepTask.name,
        recipe_id:        acc.posRecipeId,
        pos_item_name:    acc.posItemName,
        source:           'direct_recipe',
        quantity:         acc.totalQty,
        unit:             acc.unit,
        portions_sold:    acc.portions,
        calculation_path: calcPath,
        confidence:       0.9,
        warning:          null,
        metadata: {
          aggregated,
          paths_count:    acc.paths.length,
          prep_task_name: acc.prepTask.name,
          current_stock:  acc.prepTask.current_stock,
          bom_id:         acc.bom_id,
          item_class:     acc.item_class,
          match_type:     acc.match_type
        }
      })
    }

    // ── 8. Scrivi stock_deductions (batch 50) ───────────────────────────────
    let rowsWritten = 0, insertError = null
    for (let i = 0; i < deductions.length; i += 50) {
      const { error: ie } = await supa.from('stock_deductions').insert(deductions.slice(i, i + 50))
      if (ie) { insertError = ie.message; break }
      rowsWritten += deductions.slice(i, i + 50).length
    }

    // ── 9. commis_observations ──────────────────────────────────────────────
    let obsWritten = 0
    if (observations.length > 0) {
      const { error: oe } = await supa.from('commis_observations').insert(observations)
      if (oe) throw new Error(`commis_observations: ${oe.message}`)
      obsWritten = observations.length
    }

    // ── 10. bot_runs ────────────────────────────────────────────────────────
    const durationMs = Date.now() - runStart
    const status = insertError ? 'error' : 'success'
    const aggCount = [...dedAccum.values()].filter(a => a.paths.length > 1).length
    const summary = insertError
      ? `Error: ${insertError}`
      : `${cleanRows.length} clean → ${rowsWritten} deductions (${aggCount} aggregati) · ${obsWritten} obs · skip ${skippedNoBom}+${skippedNoPrepTask}+${skippedZeroQty}`

    await supa.from('bot_runs').insert({
      bot_name: 'bot-direct-deduction', run_date: businessDate, status,
      started_at: new Date(runStart).toISOString(), finished_at: new Date().toISOString(),
      rows_read: cleanRows.length, rows_written: rowsWritten,
      warnings_count: obsWritten, errors_count: insertError ? 1 : 0, summary,
      metadata: {
        business_date: businessDate, deductions_written: rowsWritten,
        aggregated_count: aggCount, observations: obsWritten,
        skipped_no_bom: skippedNoBom, skipped_no_prep: skippedNoPrepTask,
        skipped_zero_qty: skippedZeroQty, insert_error: insertError || null, duration_ms: durationMs
      }
    })

    return new Response(JSON.stringify({
      success: !insertError, business_date: businessDate,
      clean_rows_read: cleanRows.length, deductions_written: rowsWritten,
      aggregated_count: aggCount, observations: obsWritten,
      skipped: { no_bom: skippedNoBom, no_prep: skippedNoPrepTask, zero_qty: skippedZeroQty },
      insert_error: insertError || null, duration_ms: durationMs, summary
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    console.error('bot-direct-deduction error:', err)
    return new Response(JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
