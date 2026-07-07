// bot-bom-chain-deduction — Station 4 del TouchBistro POS Bot
// Legge pos_daily_clean → traversa BOM → scarica ITEM raw e ricette virtuali
// Regola STOP: prep stockata (ha prep_task) = terminal, non espandere dentro
// Anti-double vs direct_recipe. Aggregazione ingredienti per evitare duplicati.
// Zero LLM, zero current_stock, zero stock_movements
// v3 — SAFETY MODE:
//   - Regola STOP rafforzata: RECIPE con prep_task bloccata anche se cache miss (lookup live)
//   - Regola BATCH: RECIPE senza prep_task con base_servings > 1 → STOP + commis_observation
//   - Regola THRESHOLD: base_servings NULL/1 ma quantità anomale → warning (non blocco)
//   - Warning de-duplicati: 1 observation per (recipe_id, pos_item_name), non per ingrediente
//   - Pipeline Guard mantenuto
//   - Idempotenza observations: cancella solo bom-chain-commis per la data

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const MAX_DEPTH = 5

// Soglie di sicurezza per base_servings NULL/1 (quantità per porzione)
const QUANTITY_THRESHOLDS_G = {
  default: 1000,   // ingrediente generico
  meat:    500,    // carne/pesce
  sauce:   500,    // salse
  oil:     100,    // oli
  cheese:  200,    // formaggi
}

function isQuantitySuspicious(qtyPerPortion, unit, ingredientName) {
  if (!['g', 'grams', 'ml'].includes(unit)) return false
  const name = (ingredientName || '').toLowerCase()
  let threshold = QUANTITY_THRESHOLDS_G.default
  if (/beef|pork|chicken|salmon|shrimp|scallop|meat|sausage/.test(name)) threshold = QUANTITY_THRESHOLDS_G.meat
  else if (/sauce|broth|cream|soup|coulis/.test(name)) threshold = QUANTITY_THRESHOLDS_G.sauce
  else if (/oil|olio/.test(name)) threshold = QUANTITY_THRESHOLDS_G.oil
  else if (/parmesan|pecorino|cheese|mascarpone/.test(name)) threshold = QUANTITY_THRESHOLDS_G.cheese
  return qtyPerPortion > threshold
}

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
      const guardMsg = `Pipeline Guard: bot-direct-deduction non ha status success per ${businessDate}. Eseguire prima bot-direct-deduction.`
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

    // ── 0. Idempotenza — solo bom_chain e solo le observations di questo commis ──────
    await supa.from('stock_deductions')
      .delete().eq('business_date', businessDate).eq('source', 'bom_chain')
    await supa.from('commis_observations')
      .delete()
      .eq('business_date', businessDate)
      .eq('bot_name', 'bot-bom-chain-deduction')
      .eq('commis_name', 'bom-chain-commis')

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

    // ── 3. Pre-carica cache BOM + prep_tasks + ingredienti + base_servings ──
    const bomCache        = new Map() // recipe_id → [bom_rows]
    const prepTaskCache   = new Map() // recipe_id → prep_task | null
    const recipeMetaCache = new Map() // recipe_id → { title, base_servings }
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

    // Carica base_servings e title per tutte le recipe ids che ci servono
    async function loadRecipeMeta(ids) {
      const toLoad = [...ids].filter(id => id && !recipeMetaCache.has(id))
      if (!toLoad.length) return
      for (let i = 0; i < toLoad.length; i += 50) {
        const { data: recs } = await supa
          .from('recipes')
          .select('id, title, base_servings')
          .in('id', toLoad.slice(i, i + 50))
        if (recs) {
          for (const r of recs) recipeMetaCache.set(r.id, { title: r.title, base_servings: r.base_servings })
        }
      }
      for (const id of toLoad) { if (!recipeMetaCache.has(id)) recipeMetaCache.set(id, { title: id, base_servings: null }) }
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

    // Caricamento multi-livello BOM + prep_tasks + recipe_meta
    const level0 = new Set(cleanRows.map(r => r.recipe_id))
    await loadBomForRecipes(level0)
    await loadPrepTasksForRecipes(level0)
    await loadRecipeMeta(level0)

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
    if (level1.size) {
      await loadBomForRecipes(level1)
      await loadPrepTasksForRecipes(level1)
      await loadRecipeMeta(level1)
    }
    const level2 = collectSubIds(level1)
    if (level2.size) {
      await loadBomForRecipes(level2)
      await loadPrepTasksForRecipes(level2)
      await loadRecipeMeta(level2)
    }
    const level3 = collectSubIds(level2)
    if (level3.size) {
      await loadBomForRecipes(level3)
      await loadPrepTasksForRecipes(level3)
      await loadRecipeMeta(level3)
    }

    const allItemIds = new Set()
    for (const [, boms] of bomCache) {
      for (const b of boms) { if (b.item_id) allItemIds.add(b.item_id) }
    }
    await loadIngredients(allItemIds)

    // ── 4. Traversal per piatto ─────────────────────────────────────────────
    const ingredientAccum = new Map()
    const prepAccum       = new Map()
    const observations    = []

    // De-dup batch warnings: 1 per (posItemName + recipe_id) per non spammare
    const batchWarnedKeys = new Set()
    // De-dup threshold warnings: 1 per (posItemName + ingredient_id)
    const thresholdWarnedKeys = new Set()

    const rowByPosName = new Map()
    for (const r of cleanRows) {
      if (rowByPosName.has(r.pos_item_name)) {
        rowByPosName.get(r.pos_item_name).portions += parseFloat(r.portions_sold) || 0
      } else {
        rowByPosName.set(r.pos_item_name, {
          recipe_id: r.recipe_id,
          portions: parseFloat(r.portions_sold) || 0
        })
      }
    }

    // Lookup live prep_task se non in cache (fix Bug #2 — cache miss su sub-ricette profonde)
    async function getPrepTask(recipeId) {
      if (prepTaskCache.has(recipeId)) return prepTaskCache.get(recipeId)
      // Cache miss: lookup live
      const { data: tasks } = await supa
        .from('prep_tasks')
        .select('id, name, recipe_id, unit, current_stock')
        .eq('recipe_id', recipeId)
        .eq('archived', false)
        .limit(1)
      const task = tasks?.[0] || null
      prepTaskCache.set(recipeId, task)
      return task
    }

    // Lookup live recipe meta se non in cache
    async function getRecipeMeta(recipeId) {
      if (recipeMetaCache.has(recipeId)) return recipeMetaCache.get(recipeId)
      const { data: recs } = await supa
        .from('recipes')
        .select('id, title, base_servings')
        .eq('id', recipeId)
        .limit(1)
      const meta = recs?.[0] ? { title: recs[0].title, base_servings: recs[0].base_servings } : { title: recipeId, base_servings: null }
      recipeMetaCache.set(recipeId, meta)
      return meta
    }

    async function traverse(recipeId, portions, posItemName, posRecipeId, pathSoFar, depth, qtyFactor) {
      if (depth > MAX_DEPTH) {
        observations.push({
          business_date: businessDate, bot_name: 'bot-bom-chain-deduction',
          commis_name: 'bom-chain-commis', severity: 'warning',
          category: 'bom_warning', entity_type: 'recipe',
          title: `${posItemName} — BOM chain depth > ${MAX_DEPTH}`,
          explanation: `Traversal superato max depth a recipe ${recipeId}. Possibile catena circolare.`,
          suggested_action: 'Verificare BOM per catene circolari o troppo profonde.',
          metadata: { pos_item_name: posItemName, recipe_id: recipeId, depth, path: pathSoFar },
          status: 'open',
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
              metadata: { pos_item_name: posItemName, bom_id: bom.bom_id, path: pathSoFar },
              status: 'open',
            })
            continue
          }

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
              metadata: { pos_item_name: posItemName, ingredient: ingName, bom_id: bom.bom_id },
              status: 'open',
            })
          }

          // ── SAFETY THRESHOLD: base_servings NULL/1 ma quantità sospetta ──
          // Regola 4: non blocca, ma avvisa se i grammi per porzione sono anomali
          const qtyPerPortion = effectiveQtyPerPortion
          const thresholdKey = `${posItemName}|${bom.item_id}`
          if (isQuantitySuspicious(qtyPerPortion, unit, ingName) && !thresholdWarnedKeys.has(thresholdKey)) {
            thresholdWarnedKeys.add(thresholdKey)
            observations.push({
              business_date: businessDate, bot_name: 'bot-bom-chain-deduction',
              commis_name: 'bom-chain-commis', severity: 'warning',
              category: 'bom_warning', entity_type: 'ingredient',
              title: `${posItemName} → ${ingName} — quantità per porzione anomala (${qtyPerPortion.toFixed(0)}${unit})`,
              explanation: `${ingName}: ${qtyPerPortion.toFixed(0)}${unit} per porzione sembra elevata per un ingrediente di questa categoria. BOM potrebbe essere batch-level anche se base_servings=1.`,
              suggested_action: 'Verificare se le quantità nel BOM sono per porzione singola o per batch. Se batch, aggiungere base_servings corretto o creare prep_task.',
              metadata: {
                pos_item_name: posItemName,
                ingredient_name: ingName,
                ingredient_id: bom.item_id,
                qty_per_portion: qtyPerPortion,
                unit,
                bom_id: bom.bom_id,
                path: pathSoFar,
                skipped_reason: 'threshold_warning_only'
              },
              status: 'open',
            })
            // NON blocca — continua ad accumulare (con warning visibile in Dispensa)
          }

          // Accumula ingrediente
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
          const prepTask = await getPrepTask(subId)

          if (prepTask) {
            // ── REGOLA 1: PREP STOCKATA → STOP sempre ─────────────────────
            const dkR = `${posItemName}|r:${subId}`
            const dkP = `${posItemName}|p:${prepTask.id}`

            if (alreadyDeducted.has(dkR) || alreadyDeducted.has(dkP)) {
              continue // già in direct_recipe — skip silenzioso
            }

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

          // Nessun prep_task — controlla se è una ricetta batch o virtuale
          const subMeta = await getRecipeMeta(subId)
          const subBaseServings = subMeta.base_servings
          const subTitle = subMeta.title || subId.slice(0, 8)

          // ── REGOLA 2: base_servings > 1 senza prep_task → BATCH SOSPETTA → STOP ──
          if (subBaseServings !== null && subBaseServings > 1) {
            const batchKey = `${posItemName}|${subId}`
            if (!batchWarnedKeys.has(batchKey)) {
              batchWarnedKeys.add(batchKey)

              // Conta i componenti che verrebbero scaricati (per il metadata)
              const subBoms = bomCache.get(subId) || []
              const skippedComponents = subBoms.filter(b => b.component_type === 'ITEM').length
              const skippedEstQty = subBoms
                .filter(b => b.component_type === 'ITEM')
                .reduce((sum, b) => sum + (parseFloat(b.quantity) || 0) * effectiveQtyPerPortion * portions, 0)

              observations.push({
                business_date: businessDate, bot_name: 'bot-bom-chain-deduction',
                commis_name: 'bom-chain-commis', severity: 'warning',
                category: 'bom_warning', entity_type: 'recipe',
                title: `${posItemName} → ${subTitle} — BOM batch-level skipped (base_servings=${subBaseServings})`,
                explanation: `La ricetta "${subTitle}" ha base_servings=${subBaseServings} e nessun prep_task. Probabilmente è una ricetta batch, non per porzione. I suoi ingredienti raw NON sono stati scaricati per evitare numeri falsi.`,
                suggested_action: `Creare un prep_task per "${subTitle}" (prep stockata) oppure verificare che le quantità BOM siano già per porzione e impostare base_servings=1.`,
                metadata: {
                  pos_item_name: posItemName,
                  recipe_id: subId,
                  recipe_name: subTitle,
                  base_servings: subBaseServings,
                  skipped_reason: 'batch_level_bom',
                  skipped_components_count: skippedComponents,
                  skipped_estimated_quantity_g: Math.round(skippedEstQty),
                  path: pathSoFar,
                },
                status: 'open',
              })
            }
            continue // STOP — non scendere dentro
          }

          // ── REGOLA 3: base_servings NULL o 1 → virtuale/per-portion → espandi ──
          const subBoms = bomCache.get(subId) || []
          if (!subBoms.length) {
            observations.push({
              business_date: businessDate, bot_name: 'bot-bom-chain-deduction',
              commis_name: 'bom-chain-commis', severity: 'warning',
              category: 'bom_warning', entity_type: 'recipe',
              title: `${posItemName} → ricetta virtuale "${subTitle}" senza BOM`,
              explanation: `Sub-recipe senza prep_task e senza BOM — impossibile dedurre ingredienti.`,
              suggested_action: 'Aggiungere BOM alla sub-ricetta o creare prep_task.',
              metadata: { pos_item_name: posItemName, sub_recipe_id: subId, bom_id: bom.bom_id },
              status: 'open',
            })
            continue
          }

          // Scendi nella ricetta virtuale
          await traverse(subId, portions, posItemName, posRecipeId,
            `${pathSoFar} → [${subTitle}]`,
            depth + 1, effectiveQtyPerPortion)
        }
      }
    }

    // Esegui traversal per ogni piatto
    for (const [posItemName, { recipe_id, portions }] of rowByPosName) {
      if (portions <= 0) continue
      await traverse(recipe_id, portions, posItemName, recipe_id, posItemName, 1, 1)
    }

    // ── 5. Costruisci array deductions da accumulatori ────────────────────
    const deductions = []

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

    let skippedPrep = 0
    for (const acc of prepAccum.values()) {
      const keyR = `${acc.posItemName}|r:${acc.subId}`
      const keyP = `${acc.posItemName}|p:${acc.prepTask.id}`
      if (alreadyDeducted.has(keyR) || alreadyDeducted.has(keyP)) {
        skippedPrep++
        continue
      }
      const calcPath = `${acc.posItemName} → PREP ${acc.prepTask.name}: ${acc.portions}p × ${(acc.totalQty / acc.portions).toFixed(2)}${acc.unit} = ${acc.totalQty}${acc.unit} [bom_chain/stocked_prep]`
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

    // ── 6. Scrivi stock_deductions (batch 50) ──────────────────────────────
    let rowsWritten = 0, insertError = null
    for (let i = 0; i < deductions.length; i += 50) {
      const { error: ie } = await supa.from('stock_deductions').insert(deductions.slice(i, i + 50))
      if (ie) { insertError = ie.message; break }
      rowsWritten += deductions.slice(i, i + 50).length
    }

    // ── 7. commis_observations ─────────────────────────────────────────────
    let obsWritten = 0
    if (observations.length > 0) {
      const { error: oe } = await supa.from('commis_observations').insert(observations)
      if (oe) throw new Error(`commis_observations: ${oe.message}`)
      obsWritten = observations.length
    }

    // ── 8. bot_runs ────────────────────────────────────────────────────────
    const durationMs = Date.now() - runStart
    const status = insertError ? 'error' : 'success'
    const ingDeds   = deductions.filter(d => d.item_type === 'ingredient').length
    const prepDeds  = deductions.filter(d => d.item_type === 'prep').length
    const aggCount  = [...ingredientAccum.values()].filter(a => a.paths.length > 1).length
    const batchBlocked = batchWarnedKeys.size
    const thresholdWarned = thresholdWarnedKeys.size
    const summary = insertError
      ? `Error: ${insertError}`
      : `${cleanRows.length} clean → ${rowsWritten} bom_chain (${ingDeds} ingredient, ${prepDeds} prep, ${aggCount} aggregati, ${skippedPrep} skip_doubled) · ${batchBlocked} batch-blocked · ${thresholdWarned} threshold-warned · ${obsWritten} obs`

    await supa.from('bot_runs').insert({
      bot_name: 'bot-bom-chain-deduction', run_date: businessDate, status,
      started_at: new Date(runStart).toISOString(), finished_at: new Date().toISOString(),
      rows_read: cleanRows.length, rows_written: rowsWritten,
      warnings_count: obsWritten, errors_count: insertError ? 1 : 0, summary,
      metadata: {
        business_date: businessDate, deductions_written: rowsWritten,
        ingredient_deductions: ingDeds, prep_deductions: prepDeds,
        aggregated_ingredients: aggCount, batch_blocked: batchBlocked,
        threshold_warned: thresholdWarned, observations: obsWritten,
        insert_error: insertError || null, duration_ms: durationMs,
        bot_version: 'v3_safety_mode'
      }
    })

    return new Response(JSON.stringify({
      success: !insertError, business_date: businessDate,
      clean_rows_read: cleanRows.length, deductions_written: rowsWritten,
      ingredient_deductions: ingDeds, prep_deductions: prepDeds,
      aggregated_ingredients: aggCount, batch_blocked: batchBlocked,
      threshold_warned: thresholdWarned, observations: obsWritten,
      insert_error: insertError || null, duration_ms: durationMs, summary,
      bot_version: 'v3_safety_mode'
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    console.error('bot-bom-chain-deduction error:', err)
    return new Response(JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
