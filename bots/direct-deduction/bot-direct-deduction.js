// bot-direct-deduction — Station 3 del TouchBistro POS Bot
// Legge pos_daily_clean → calcola scarichi diretti → scrive stock_deductions
// Solo prep con BOM RECIPE diretto. Zero LLM, zero current_stock, zero stock_movements.
// v1

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

    // ── 1. pos_daily_clean — righe mappate e sicure ─────────────────────────
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

    // ── 2. BOM per le ricette coinvolte (solo RECIPE links) ─────────────────
    const recipeIds = [...new Set(cleanRows.map(r => r.recipe_id))]
    const allBom = []
    for (let i = 0; i < recipeIds.length; i += 50) {
      const { data: bom } = await supa
        .from('recipe_bom')
        .select('bom_id, parent_recipe_id, component_type, sub_recipe_id, quantity, unit')
        .in('parent_recipe_id', recipeIds.slice(i, i + 50))
        .eq('component_type', 'RECIPE')  // solo link a prep
        .not('sub_recipe_id', 'is', null)
      if (bom) allBom.push(...bom)
    }

    // ── 3. prep_tasks collegati alle sub-recipe ─────────────────────────────
    const subIds = [...new Set(allBom.map(b => b.sub_recipe_id))]
    const prepBySubRecipe = new Map() // sub_recipe_id (uuid) → prep_task
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

    // ── 4. Indicizza BOM per ricetta POS ────────────────────────────────────
    const bomByRecipe = new Map()
    for (const b of allBom) {
      if (!bomByRecipe.has(b.parent_recipe_id)) bomByRecipe.set(b.parent_recipe_id, [])
      bomByRecipe.get(b.parent_recipe_id).push(b)
    }

    // ── 5. Calcola scarichi ──────────────────────────────────────────────────
    const deductions = []
    const observations = []
    let skippedNoBom = 0, skippedNoPrepTask = 0, skippedZeroQty = 0

    for (const row of cleanRows) {
      const portions = parseFloat(row.portions_sold) || 0
      if (portions <= 0) { skippedZeroQty++; continue }

      const bomLinks = bomByRecipe.get(row.recipe_id) || []

      if (bomLinks.length === 0) {
        // Ricetta senza nessun link RECIPE nel BOM
        // Può avere solo ITEM raw → Bot 4 BOM Chain. Non è un errore qui.
        skippedNoBom++
        observations.push({
          business_date: businessDate, bot_name: 'bot-direct-deduction',
          commis_name: 'direct-deduction-commis', severity: 'info',
          category: 'bom_warning', entity_type: 'recipe',
          title: `${row.pos_item_name} — nessuna prep nel BOM (richiede Bot 4)`,
          explanation: `"${row.pos_item_name}" non ha prep intermedie nel BOM. Solo ingredienti raw — scarico gestito da Bot 4 BOM Chain.`,
          suggested_action: 'Nessuna azione richiesta. Bot 4 gestirà lo scarico via BOM chain.',
          metadata: { pos_item_name: row.pos_item_name, recipe_id: row.recipe_id, portions_sold: portions }
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
            title: `${row.pos_item_name} → sub-recipe senza prep task`,
            explanation: `BOM di "${row.pos_item_name}" punta a sub_recipe ${bom.sub_recipe_id} ma nessun prep_task attivo è collegato.`,
            suggested_action: 'Collegare prep_task.recipe_id alla sub-ricetta in Brigade.',
            metadata: { pos_item_name: row.pos_item_name, sub_recipe_id: bom.sub_recipe_id, bom_id: bom.bom_id }
          })
          continue
        }

        if (bomQty <= 0) {
          skippedZeroQty++
          observations.push({
            business_date: businessDate, bot_name: 'bot-direct-deduction',
            commis_name: 'direct-deduction-commis', severity: 'warning',
            category: 'bom_warning', entity_type: 'prep',
            title: `${row.pos_item_name} → quantità BOM = 0 per "${prepTask.name}"`,
            explanation: `Quantità BOM è 0 — impossibile calcolare scarico.`,
            suggested_action: 'Correggere la quantità nel BOM della ricetta.',
            metadata: { pos_item_name: row.pos_item_name, prep_task_name: prepTask.name, bom_id: bom.bom_id }
          })
          continue
        }

        const totalQty = bomQty * portions
        const unit = bom.unit || prepTask.unit || 'g'
        const calcPath = `${row.pos_item_name} → ${prepTask.name}: ${portions} porzioni × ${bomQty}${unit} = ${totalQty}${unit} [direct_recipe]`

        // Sanity: qty/porzione molto alta (>5kg o >1000 pz)
        if (totalQty / portions > 5000) {
          observations.push({
            business_date: businessDate, bot_name: 'bot-direct-deduction',
            commis_name: 'direct-deduction-commis', severity: 'info',
            category: 'bom_warning', entity_type: 'prep',
            title: `${row.pos_item_name} → quantità alta (${(bomQty).toFixed(1)}${unit}/porzione)`,
            explanation: `${bomQty}${unit} per porzione potrebbe indicare BOM espresso per batch anziché per porzione.`,
            suggested_action: 'Verificare che il BOM sia espresso per porzione singola.',
            metadata: { pos_item_name: row.pos_item_name, prep_task_name: prepTask.name, bom_qty: bomQty, unit, total_qty: totalQty }
          })
        }

        // item_id in stock_deductions è uuid NOT NULL.
        // prep_tasks.id è bigint — non compatibile.
        // Usiamo sub_recipe_id (uuid di recipes) come item_id: è il riferimento alla "prep recipe".
        // Il prep_task_id bigint va in metadata.
        deductions.push({
          business_date:    businessDate,
          item_type:        'prep',
          item_id:          bom.sub_recipe_id,  // uuid della prep recipe — proxy valido
          recipe_id:        row.recipe_id,
          pos_item_name:    row.pos_item_name,
          source:           'direct_recipe',
          quantity:         totalQty,
          unit:             unit,
          portions_sold:    portions,
          calculation_path: calcPath,
          confidence:       0.9,
          warning:          null,
          metadata: {
            prep_task_id:   prepTask.id,    // bigint — per reference
            prep_task_name: prepTask.name,
            current_stock:  prepTask.current_stock,
            bom_qty:        bomQty,
            bom_unit:       bom.unit,
            bom_id:         bom.bom_id,
            item_class:     row.item_class,
            match_type:     row.match_type
          }
        })
        deductedCount++
      }

      // Se aveva BOM links ma nessun deduction
      if (deductedCount === 0 && bomLinks.length > 0) {
        observations.push({
          business_date: businessDate, bot_name: 'bot-direct-deduction',
          commis_name: 'direct-deduction-commis', severity: 'warning',
          category: 'bom_warning', entity_type: 'recipe',
          title: `${row.pos_item_name} — nessun scarico generato`,
          explanation: `"${row.pos_item_name}" ha BOM RECIPE ma nessuno scarico calcolato (prep task mancanti o quantità zero).`,
          suggested_action: 'Verificare BOM e prep_task collegati.',
          metadata: { pos_item_name: row.pos_item_name, recipe_id: row.recipe_id, portions_sold: portions }
        })
      }
    }

    // ── 6. Scrivi stock_deductions (batch 50) ───────────────────────────────
    let rowsWritten = 0
    let insertError = null
    if (deductions.length > 0) {
      for (let i = 0; i < deductions.length; i += 50) {
        const { error: ie } = await supa.from('stock_deductions').insert(deductions.slice(i, i + 50))
        if (ie) { insertError = ie.message; break }
        rowsWritten += deductions.slice(i, i + 50).length
      }
    }

    // ── 7. commis_observations ──────────────────────────────────────────────
    let obsWritten = 0
    if (observations.length > 0) {
      const { error: oe } = await supa.from('commis_observations').insert(observations)
      if (oe) throw new Error(`commis_observations: ${oe.message}`)
      obsWritten = observations.length
    }

    // ── 8. bot_runs ─────────────────────────────────────────────────────────
    const durationMs = Date.now() - runStart
    const status = insertError ? 'error' : 'success'
    const summary = insertError
      ? `Error writing deductions: ${insertError}`
      : `${cleanRows.length} righe clean → ${rowsWritten} deductions scritte · ${obsWritten} observations · skip: ${skippedNoBom}+${skippedNoPrepTask}+${skippedZeroQty}`

    await supa.from('bot_runs').insert({
      bot_name: 'bot-direct-deduction', run_date: businessDate, status,
      started_at: new Date(runStart).toISOString(), finished_at: new Date().toISOString(),
      rows_read: cleanRows.length, rows_written: rowsWritten,
      warnings_count: obsWritten, errors_count: insertError ? 1 : 0,
      summary,
      metadata: {
        business_date: businessDate,
        deductions_attempted: deductions.length,
        deductions_written: rowsWritten,
        observations: obsWritten,
        skipped_no_bom: skippedNoBom,
        skipped_no_prep: skippedNoPrepTask,
        skipped_zero_qty: skippedZeroQty,
        insert_error: insertError || null,
        duration_ms: durationMs
      }
    })

    return new Response(JSON.stringify({
      success: !insertError, business_date: businessDate,
      clean_rows_read: cleanRows.length, deductions_written: rowsWritten,
      observations: obsWritten, insert_error: insertError || null,
      skipped: { no_bom: skippedNoBom, no_prep: skippedNoPrepTask, zero_qty: skippedZeroQty },
      duration_ms: durationMs, summary
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    console.error('bot-direct-deduction error:', err)
    return new Response(JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
