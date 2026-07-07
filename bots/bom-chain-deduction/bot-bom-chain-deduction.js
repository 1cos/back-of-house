// bot-bom-chain-deduction — Station 4 del TouchBistro POS Bot
// Legge pos_daily_clean → traversa BOM → scarica ITEM raw e ricette virtuali
// Regola STOP: prep stockata (ha prep_task) = terminal, non espandere dentro
// Anti-double vs direct_recipe. Aggregazione ingredienti per evitare duplicati.
// Zero LLM, zero current_stock, zero stock_movements
// v2 — aggregazione ingredienti: somma percorsi multipli per stesso ingrediente

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const MAX_DEPTH = 5

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

    // ── PIPELINE GUARD: richiede bot-direct-deduction success per la stessa run_date ──
    const { data: directGuard } = await supa
      .from('bot_runs')
      .select('bot_name, status')
      .eq('run_date', businessDate)
      .eq('bot_name', 'bot-direct-deduction')
      .eq('status', 'success')
      .limit(1)

    if (!directGuard || directGuard.length === 0) {
      const guardMsg = `Pipeline Guard: bot-direct-deduction non ha status success per ${businessDate}. Eseguire prima bot-direct-deduction, poi questo bot.`
      console.warn('[bot-bom-chain-deduction] ' + guardMsg)
      await supa.from('commis_observations').insert({
        business_date: businessDate, bot_name: 'bot-bom-chain-deduction', commis_name: 'bom-chain-commis',
        severity: 'warning', category: 'system',
        title: `Pipeline Guard attivato — ${businessDate}`,
        explanation: guardMsg,
        suggested_action: 'Eseguire bot-direct-deduction prima di bot-bom-chain-deduction.',
        status: 'open',
      })
      return new Response(JSON.stringify({ ok: false, error: 'pipeline_guard', missing: 'bot-direct-deduction', businessDate }), {
        headers: corsHeaders, status: 200
      })
    }

    // ── 0. Idempotenza — solo bom_chain, mai direct_recipe ─────────────────
    await supa.from('stock_deductions')
      .delete().eq('business_date', businessDate).eq('source', 'bom_chain')
    await supa.from('commis_observations')
      .delete().eq('business_date', businessDate)
      .eq('bot_name', 'bot-bom-chain-deduction').eq('commis_name', 'bom-chain-commis')

    // ── 1. pos_daily_clean — righe mappate ─────────────────────────────────
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

    // ── 2. Anti-double: già dedotti da direct_recipe ────────────────────────
    const { data: directDeds } = await supa
      .from('stock_deductions')
      .select('pos_item_name, target_recipe_id, prep_task_id, ingredient_id')
      .eq('business_date', businessDate)
      .eq('source', 'direct_recipe')

    const alreadyDeducted = new Set()
    for (const d of (directDeds || [])) {
      if (d.target_recipe_id) alreadyDeducted.add(`${d.pos_item_name}|r:${d.target_recipe_id}`)
      if (d.prep_task_id)     alreadyDeducted.add(`${d.pos_item_name}|p:${d.prep_task_id}`)
      if (d.ingredient_id)    alreadyDeducted.add(`${d.pos_item_name}|i:${d.ingredient_id}`)
    }

    // ── 3. Pre-carica cache BOM + prep_tasks + ingredienti ─────────────────
    const bomCache     = new Map() // recipe_id → [bom_rows]
    const prepTaskCache = new Map() // recipe_id → prep_task | null
    const ingredientCache = new Map() // ingredient_id → ingredient

    async function loadBomForRecipes(ids) {
      const toLoad = [...ids].filter(id => !bomCache.has(id))
      if (!toLoad.length) return
      for (let i = 0; i < toLoad.length; i += 50) {
        const { data: bom } = await supa
          .from('recipe_bom')
          .select('bom_id, parent_recipe_id, component_type, sub_recipe_id, item_id, quantity, unit')
          .in('parent_recipe_id', toLoad.slice(i, i + 50))
        if (bom) {
          for (const b of bom) {
            if (!bomCache.has(b.parent_recipe_id)) bomCache.set(b.parent_recipe_id, [])
            bomCache.get(b.parent_recipe_id).push(b)
          }
        }
      }
      for (const id of toLoad) { if (!bomCache.has(id)) bomCache.set(id, []) }
    }

    async function loadPrepTasksForRecipes(ids) {
      const toLoad = [...ids].filter(id => !prepTaskCache.has(id))
      if (!toLoad.length) return
      for (let i = 0; i < toLoad.length; i += 50) {
        const { data: tasks } = await supa
          .from('prep_tasks')
          .select('id, name, recipe_id, unit, current_stock')
          .in('recipe_id', toLoad.slice(i, i + 50))
          .eq('archived', false)
        if (tasks) {
          for (const t of tasks) {
            if (!prepTaskCache.has(t.recipe_id)) prepTaskCache.set(t.recipe_id, t)
          }
        }
      }
      for (const id of toLoad) { if (!prepTaskCache.has(id)) prepTaskCache.set(id, null) }
    }

    async function loadIngredients(ids) {
      const toLoad = [...ids].filter(id => id && !ingredientCache.has(id))
      if (!toLoad.length) return
      for (let i = 0; i < toLoad.length; i += 50) {
        const { data: ings } = await supa
          .from('ingredients')
          .select('id, name, base_unit, measure_type')
          .in('id', toLoad.slice(i, i + 50))
        if (ings) { for (const ing of ings) ingredientCache.set(ing.id, ing) }
      }
    }

    // Caricamento multi-livello
    const level0 = new Set(cleanRows.map(r => r.recipe_id))
    await loadBomForRecipes(level0)
    await loadPrepTasksForRecipes(level0)

    function collectSubIds(fromIds) {
      const subs = new Set()
      for (const id of fromIds) {
        for (const b of (bomCache.get(id) || [])) {
          if (b.component_type === 'RECIPE' && b.sub_recipe_id) subs.add(b.sub_recipe_id)
        }
      }
      return subs
    }

    const level1 = collectSubIds(level0)
    if (level1.size) { await loadBomForRecipes(level1); await loadPrepTasksForRecipes(level1) }
    const level2 = collectSubIds(level1)
    if (level2.size) { await loadBomForRecipes(level2); await loadPrepTasksForRecipes(level2) }
    const level3 = collectSubIds(level2)
    if (level3.size) { await loadBomForRecipes(level3); await loadPrepTasksForRecipes(level3) }

    const allItemIds = new Set()
    for (const [, boms] of bomCache) {
      for (const b of boms) { if (b.item_id) allItemIds.add(b.item_id) }
    }
    await loadIngredients(allItemIds)

    // ── 4. Traversal per piatto ─────────────────────────────────────────────
    // Accumulator per ingredienti: "posItemName|ingredient_id|unit" → { qty, paths[], ingredient }
    // Accumulator per prep (bom_chain, non anti-doubled): "posItemName|prepTaskId" → { qty, path }
    const ingredientAccum = new Map() // chiave → { totalQty, unit, ingredient_id, ingName, paths, posItemName, posRecipeId, portions }
    const prepAccum       = new Map() // chiave → { qty, unit, prepTask, posItemName, posRecipeId, portions, path }
    const observations    = []

    const rowByPosName = new Map()
    for (const r of cleanRows) {
      // Gestisce duplicati pos_item_name sommando le porzioni
      if (rowByPosName.has(r.pos_item_name)) {
        rowByPosName.get(r.pos_item_name).portions += parseFloat(r.portions_sold) || 0
      } else {
        rowByPosName.set(r.pos_item_name, {
          recipe_id: r.recipe_id,
          portions: parseFloat(r.portions_sold) || 0
        })
      }
    }

    function traverse(recipeId, portions, posItemName, posRecipeId, pathSoFar, depth, qtyFactor) {
      if (depth > MAX_DEPTH) {
        observations.push({
          business_date: businessDate, bot_name: 'bot-bom-chain-deduction',
          commis_name: 'bom-chain-commis', severity: 'warning',
          category: 'bom_warning', entity_type: 'recipe',
          title: `${posItemName} — BOM chain depth > ${MAX_DEPTH}`,
          explanation: `Traversal superato max depth a recipe ${recipeId}. Possibile catena circolare.`,
          suggested_action: 'Verificare BOM per catene circolari o troppo profonde.',
          metadata: { pos_item_name: posItemName, recipe_id: recipeId, depth, path: pathSoFar }
        })
        return
      }

      const boms = bomCache.get(recipeId) || []
      for (const bom of boms) {
        const bomQty = parseFloat(bom.quantity) || 0
        if (bomQty <= 0) continue
        const effectiveQtyPerPortion = bomQty * qtyFactor

        // ── A. ITEM raw ────────────────────────────────────────────────────
        if (bom.component_type === 'ITEM') {
          if (!bom.item_id) {
            observations.push({
              business_date: businessDate, bot_name: 'bot-bom-chain-deduction',
              commis_name: 'bom-chain-commis', severity: 'warning',
              category: 'bom_warning', entity_type: 'ingredient',
              title: `${posItemName} — ITEM senza ingredient_id (bom_id ${bom.bom_id})`,
              explanation: `ITEM nel BOM senza ingredient_id.`,
              suggested_action: 'Collegare ingrediente nel BOM editor.',
              metadata: { pos_item_name: posItemName, bom_id: bom.bom_id, path: pathSoFar }
            })
            continue
          }

          // Anti-double vs direct_recipe
          if (alreadyDeducted.has(`${posItemName}|i:${bom.item_id}`)) continue

          const ingredient = ingredientCache.get(bom.item_id)
          const ingName = ingredient?.name || bom.item_id
          const unit = bom.unit || ingredient?.base_unit || 'g'

          if (!bom.unit) {
            observations.push({
              business_date: businessDate, bot_name: 'bot-bom-chain-deduction',
              commis_name: 'bom-chain-commis', severity: 'warning',
              category: 'bom_warning', entity_type: 'ingredient',
              title: `${posItemName} → ${ingName} — unità mancante nel BOM`,
              explanation: `Unità mancante — fallback a base_unit o 'g'.`,
              suggested_action: 'Aggiungere unità nel BOM.',
              metadata: { pos_item_name: posItemName, ingredient: ingName, bom_id: bom.bom_id }
            })
          }

          // AGGREGAZIONE: chiave per deduplicare percorsi multipli
          const accumKey = `${posItemName}|${bom.item_id}|${unit}`
          const totalQtyThisPath = effectiveQtyPerPortion * portions
          const pathDesc = `${pathSoFar} → ${ingName} ×${effectiveQtyPerPortion.toFixed(4).replace(/\.?0+$/, '')}${unit}`

          if (ingredientAccum.has(accumKey)) {
            const acc = ingredientAccum.get(accumKey)
            acc.totalQty += totalQtyThisPath
            acc.paths.push(pathDesc)
          } else {
            ingredientAccum.set(accumKey, {
              totalQty: totalQtyThisPath,
              unit, ingredient_id: bom.item_id, ingName,
              paths: [pathDesc],
              posItemName, posRecipeId, portions
            })
          }
          continue
        }

        // ── B. RECIPE ──────────────────────────────────────────────────────
        if (bom.component_type === 'RECIPE' && bom.sub_recipe_id) {
          const subId = bom.sub_recipe_id
          const prepTask = prepTaskCache.get(subId)

          if (prepTask) {
            // PREP STOCKATA → STOP
            const dkR = `${posItemName}|r:${subId}`
            const dkP = `${posItemName}|p:${prepTask.id}`

            if (alreadyDeducted.has(dkR) || alreadyDeducted.has(dkP)) {
              // Già in direct_recipe — skip silenzioso (niente observation per non sporcare)
              continue
            }

            // Non ancora dedotta — accumula e STOP
            const unit = bom.unit || prepTask.unit || 'pz'
            const totalQty = effectiveQtyPerPortion * portions
            const accumKey = `${posItemName}|p:${prepTask.id}|${unit}`
            const pathDesc = `${pathSoFar} → PREP ${prepTask.name} ×${effectiveQtyPerPortion.toFixed(4).replace(/\.?0+$/, '')}${unit}`

            if (prepAccum.has(accumKey)) {
              prepAccum.get(accumKey).totalQty += totalQty
              prepAccum.get(accumKey).paths.push(pathDesc)
            } else {
              prepAccum.set(accumKey, {
                totalQty, unit, prepTask,
                paths: [pathDesc],
                posItemName, posRecipeId, portions, subId
              })
            }
            continue // STOP — non scendere dentro
          }

          // RICETTA VIRTUALE → espandi
          const subBoms = bomCache.get(subId) || []
          if (!subBoms.length) {
            observations.push({
              business_date: businessDate, bot_name: 'bot-bom-chain-deduction',
              commis_name: 'bom-chain-commis', severity: 'warning',
              category: 'bom_warning', entity_type: 'recipe',
              title: `${posItemName} → ricetta virtuale ${subId.slice(0,8)} senza BOM`,
              explanation: `Sub-recipe senza prep_task e senza BOM — impossibile dedurre.`,
              suggested_action: 'Aggiungere BOM alla sub-ricetta o creare prep_task.',
              metadata: { pos_item_name: posItemName, sub_recipe_id: subId, bom_id: bom.bom_id }
            })
            continue
          }

          // Scendi
          traverse(subId, portions, posItemName, posRecipeId,
            `${pathSoFar} → [${subId.slice(0,8)}]`,
            depth + 1, effectiveQtyPerPortion)
        }
      }
    }

    // Esegui traversal per ogni piatto
    for (const [posItemName, { recipe_id, portions }] of rowByPosName) {
      if (portions <= 0) continue
      traverse(recipe_id, portions, posItemName, recipe_id, posItemName, 1, 1)
    }

    // ── 5. Costruisci array deductions da accumulatori ───────────────────────
    const deductions = []

    // Ingredienti aggregati
    for (const acc of ingredientAccum.values()) {
      const calcPath = acc.paths.length === 1
        ? `${acc.paths[0]}: ${acc.portions}p = ${acc.totalQty}${acc.unit} [bom_chain]`
        : `${acc.posItemName} → ${acc.ingName} (${acc.paths.length} percorsi): ${acc.totalQty}${acc.unit} [bom_chain/aggregated]`

      deductions.push({
        business_date:    businessDate,
        item_type:        'ingredient',
        item_id:          acc.ingredient_id,
        target_recipe_id: null,
        prep_task_id:     null,
        ingredient_id:    acc.ingredient_id,
        target_name:      acc.ingName,
        recipe_id:        acc.posRecipeId,
        pos_item_name:    acc.posItemName,
        source:           'bom_chain',
        quantity:         acc.totalQty,
        unit:             acc.unit,
        portions_sold:    acc.portions,
        calculation_path: calcPath,
        confidence:       0.8,
        warning:          null,
        metadata: {
          aggregated: acc.paths.length > 1,
          paths_count: acc.paths.length,
          ingredient_name: acc.ingName
        }
      })
    }

    // Prep da bom_chain — anti-doubled: skip se già dedotta da direct_recipe
    let skippedPrep = 0
    for (const acc of prepAccum.values()) {
      // Salta se direct_recipe ha già dedotto questa prep per lo stesso pos_item_name
      const keyR = `${acc.posItemName}|r:${acc.subId}`
      const keyP = `${acc.posItemName}|p:${acc.prepTask.id}`
      if (alreadyDeducted.has(keyR) || alreadyDeducted.has(keyP)) {
        skippedPrep++
        continue // evita il doppio scarico
      }
      const calcPath = `${acc.posItemName} → PREP ${acc.prepTask.name}: ${acc.portions}p × ${acc.totalQty / acc.portions}${acc.unit} = ${acc.totalQty}${acc.unit} [bom_chain/stocked_prep]`
      deductions.push({
        business_date:    businessDate,
        item_type:        'prep',
        item_id:          acc.subId,
        target_recipe_id: acc.subId,
        prep_task_id:     acc.prepTask.id,
        ingredient_id:    null,
        target_name:      acc.prepTask.name,
        recipe_id:        acc.posRecipeId,
        pos_item_name:    acc.posItemName,
        source:           'bom_chain',
        quantity:         acc.totalQty,
        unit:             acc.unit,
        portions_sold:    acc.portions,
        calculation_path: calcPath,
        confidence:       0.85,
        warning:          null,
        metadata: { prep_task_name: acc.prepTask.name, stop_reason: 'stocked_prep_terminal' }
      })
    }

    // ── 6. Scrivi stock_deductions (batch 50) ───────────────────────────────
    let rowsWritten = 0, insertError = null
    for (let i = 0; i < deductions.length; i += 50) {
      const { error: ie } = await supa.from('stock_deductions').insert(deductions.slice(i, i + 50))
      if (ie) { insertError = ie.message; break }
      rowsWritten += deductions.slice(i, i + 50).length
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
    const ingDeds  = deductions.filter(d => d.item_type === 'ingredient').length
    const prepDeds = deductions.filter(d => d.item_type === 'prep').length
    const aggCount = [...ingredientAccum.values()].filter(a => a.paths.length > 1).length
    const summary = insertError
      ? `Error: ${insertError}`
      : `${cleanRows.length} clean → ${rowsWritten} bom_chain (${ingDeds} ingredient, ${prepDeds} prep, ${aggCount} aggregati, ${skippedPrep} skip_doubled) · ${obsWritten} obs`

    await supa.from('bot_runs').insert({
      bot_name: 'bot-bom-chain-deduction', run_date: businessDate, status,
      started_at: new Date(runStart).toISOString(), finished_at: new Date().toISOString(),
      rows_read: cleanRows.length, rows_written: rowsWritten,
      warnings_count: obsWritten, errors_count: insertError ? 1 : 0, summary,
      metadata: {
        business_date: businessDate, deductions_written: rowsWritten,
        ingredient_deductions: ingDeds, prep_deductions: prepDeds,
        aggregated_ingredients: aggCount, observations: obsWritten,
        insert_error: insertError || null, duration_ms: durationMs
      }
    })

    return new Response(JSON.stringify({
      success: !insertError, business_date: businessDate,
      clean_rows_read: cleanRows.length, deductions_written: rowsWritten,
      ingredient_deductions: ingDeds, prep_deductions: prepDeds,
      aggregated_ingredients: aggCount, observations: obsWritten,
      insert_error: insertError || null, duration_ms: durationMs, summary
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    console.error('bot-bom-chain-deduction error:', err)
    return new Response(JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
