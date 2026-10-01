
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const MAX_DEPTH = 5
const BOT_NAME = 'bot-bom-chain-deduction'
const BOT_VERSION = 'v5_yield01'
// YIELD01: portions come from the canonical view public.recipe_yield (same logic as FC05),
// not from recipes.base_servings alone. A batch recipe with an empty base_servings is now seen as a batch.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const QUANTITY_THRESHOLDS_G: Record<string, number> = {
  default: 1000, meat: 500, sauce: 500, oil: 100, cheese: 200,
}

function isQuantitySuspicious(qtyPerPortion: number, unit: string, ingredientName: string): boolean {
  if (!['g', 'grams', 'ml'].includes(unit)) return false
  const name = (ingredientName || '').toLowerCase()
  let threshold = QUANTITY_THRESHOLDS_G.default
  if (/beef|pork|chicken|salmon|shrimp|scallop|meat|sausage/.test(name)) threshold = QUANTITY_THRESHOLDS_G.meat
  else if (/sauce|broth|cream|soup|coulis/.test(name)) threshold = QUANTITY_THRESHOLDS_G.sauce
  else if (/oil|olio/.test(name)) threshold = QUANTITY_THRESHOLDS_G.oil
  else if (/parmesan|pecorino|cheese|mascarpone/.test(name)) threshold = QUANTITY_THRESHOLDS_G.cheese
  return qtyPerPortion > threshold
}

function respond(body: object, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const runStart = Date.now()
  const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!)

  let body: any = {}
  try { body = await req.json() } catch (_) {}

  const businessDate: string = body.business_date || new Date().toISOString().slice(0, 10)
  const simulateFailure: string | null = body.simulate_failure || null
  const dryRun: boolean = body.dry_run === true

  const { data: runRow, error: runInsertErr } = await supa.from('bot_runs').insert({
    bot_name: BOT_NAME, run_date: businessDate, status: 'running',
    started_at: new Date(runStart).toISOString(),
    summary: BOT_VERSION + ' starting for ' + businessDate + (dryRun ? ' [dry-run]' : ''),
    metadata: { version: BOT_VERSION, dry_run: dryRun, simulate_failure: simulateFailure },
  }).select('id').single()

  const runId: string | null = runRow?.id ?? null
  if (runInsertErr || !runId) {
    return respond({ success: false, error: 'Failed to create bot_runs row', logging_failed: true, detail: runInsertErr?.message }, 500)
  }

  async function finishRun(status: string, rowsRead: number, rowsWritten: number, warnings: number, errors: number, summary: string, meta: object) {
    const { error: updErr } = await supa.from('bot_runs').update({
      status, rows_read: rowsRead, rows_written: rowsWritten,
      warnings_count: warnings, errors_count: errors,
      summary, finished_at: new Date().toISOString(),
      metadata: { ...meta, version: BOT_VERSION, run_id: runId },
    }).eq('id', runId)
    if (updErr) return { logging_failed: true, logging_error: updErr.message }
    return {}
  }

  try {
    const { data: directGuard } = await supa
      .from('bot_runs').select('bot_name, status')
      .eq('run_date', businessDate).eq('bot_name', 'bot-direct-deduction').eq('status', 'success').limit(1)
    if (!directGuard || directGuard.length === 0) {
      const guardMsg = 'Pipeline Guard: bot-direct-deduction non ha status success per ' + businessDate
      await supa.from('commis_observations').insert({
        business_date: businessDate, bot_name: BOT_NAME, commis_name: 'bom-chain-commis',
        severity: 'warning', category: 'system',
        title: 'Pipeline Guard attivato - ' + businessDate, explanation: guardMsg,
        suggested_action: 'Eseguire bot-direct-deduction prima.', status: 'open',
      })
      const logResult = await finishRun('failed', 0, 0, 1, 1,
        BOT_VERSION + ' BLOCKED pipeline guard - ' + businessDate,
        { dry_run: dryRun, result: 'pipeline_guard' })
      return respond({ ok: false, run_id: runId, error: 'pipeline_guard', businessDate, ...logResult })
    }

    if (!dryRun) {
      await supa.from('stock_deductions').delete().eq('business_date', businessDate).eq('source', 'bom_chain')
      await supa.from('commis_observations').delete()
        .eq('business_date', businessDate).eq('bot_name', BOT_NAME).eq('commis_name', 'bom-chain-commis')
    }

    const { data: cleanRows, error: cleanErr } = await supa
      .from('pos_daily_clean')
      .select('id, pos_item_name, recipe_id, portions_sold, item_class, match_type')
      .eq('business_date', businessDate).eq('action', 'map').not('recipe_id', 'is', null)
      .in('item_class', ['MENU_ITEM', 'KITCHEN_OPERATIONAL'])
    if (cleanErr) throw new Error('pos_daily_clean: ' + cleanErr.message)
    if (!cleanRows?.length) {
      const logResult = await finishRun('success', 0, 0, 0, 0,
        BOT_VERSION + ' ' + businessDate + ' | no mapped rows',
        { dry_run: dryRun, execution_mode: dryRun ? 'dry_run' : 'live', result: 'no_data' })
      return respond({ success: false, run_id: runId, message: 'No mapped rows for ' + businessDate, ...logResult })
    }

    if (simulateFailure === 'after_validation') {
      const logResult = await finishRun('failed', cleanRows.length, 0, 0, 1,
        BOT_VERSION + ' simulate_failure=after_validation for ' + businessDate,
        { dry_run: dryRun, simulate_failure: simulateFailure, execution_mode: 'test' })
      return respond({ success: false, run_id: runId, business_date: businessDate,
        simulate_failure: simulateFailure, status: 'failed',
        message: 'Simulated failure after validation - no operative writes', ...logResult })
    }

    const { data: directDeds } = await supa.from('stock_deductions')
      .select('pos_item_name, target_recipe_id, prep_task_id, ingredient_id')
      .eq('business_date', businessDate).eq('source', 'direct_recipe')
    const alreadyDeducted = new Set<string>()
    for (const d of (directDeds || [])) {
      if (d.target_recipe_id) alreadyDeducted.add(d.pos_item_name + '|r:' + d.target_recipe_id)
      if (d.prep_task_id)     alreadyDeducted.add(d.pos_item_name + '|p:' + d.prep_task_id)
      if (d.ingredient_id)    alreadyDeducted.add(d.pos_item_name + '|i:' + d.ingredient_id)
    }

    const bomCache        = new Map<string, any[]>()
    const prepTaskCache   = new Map<string, any>()
    const recipeMetaCache = new Map<string, { title: string, base_servings: number | null }>()
    const ingredientCache = new Map<string, any>()

    async function loadBomForRecipes(ids: Set<string>) {
      const toLoad = [...ids].filter(id => !bomCache.has(id))
      if (!toLoad.length) return
      for (let i = 0; i < toLoad.length; i += 50) {
        const { data: bom } = await supa.from('recipe_bom')
          .select('bom_id, parent_recipe_id, component_type, sub_recipe_id, item_id, quantity, unit')
          .in('parent_recipe_id', toLoad.slice(i, i + 50))
        if (bom) for (const b of bom) {
          if (!bomCache.has(b.parent_recipe_id)) bomCache.set(b.parent_recipe_id, [])
          bomCache.get(b.parent_recipe_id)!.push(b)
        }
      }
      for (const id of toLoad) { if (!bomCache.has(id)) bomCache.set(id, []) }
    }
    async function loadPrepTasksForRecipes(ids: Set<string>) {
      const toLoad = [...ids].filter(id => !prepTaskCache.has(id))
      if (!toLoad.length) return
      for (let i = 0; i < toLoad.length; i += 50) {
        const { data: tasks } = await supa.from('prep_tasks')
          .select('id, name, recipe_id, unit, current_stock').in('recipe_id', toLoad.slice(i, i + 50)).eq('archived', false)
        if (tasks) for (const t of tasks) { if (!prepTaskCache.has(t.recipe_id)) prepTaskCache.set(t.recipe_id, t) }
      }
      for (const id of toLoad) { if (!prepTaskCache.has(id)) prepTaskCache.set(id, null) }
    }
    async function loadRecipeMeta(ids: Set<string>) {
      const toLoad = [...ids].filter(id => id && !recipeMetaCache.has(id))
      if (!toLoad.length) return
      for (let i = 0; i < toLoad.length; i += 50) {
        const { data: recs } = await supa.from('recipe_yield').select('id, title, portions').in('id', toLoad.slice(i, i + 50))
        if (recs) for (const r of recs) recipeMetaCache.set(r.id, { title: r.title, base_servings: r.portions != null ? Number(r.portions) : null })
      }
      for (const id of toLoad) { if (!recipeMetaCache.has(id)) recipeMetaCache.set(id, { title: id, base_servings: null }) }
    }
    async function loadIngredients(ids: Set<string>) {
      const toLoad = [...ids].filter(id => id && !ingredientCache.has(id))
      if (!toLoad.length) return
      for (let i = 0; i < toLoad.length; i += 50) {
        const { data: ings } = await supa.from('ingredients').select('id, name, base_unit, measure_type').in('id', toLoad.slice(i, i + 50))
        if (ings) for (const ing of ings) ingredientCache.set(ing.id, ing)
      }
    }
    function collectSubIds(fromIds: Set<string>): Set<string> {
      const subs = new Set<string>()
      for (const id of fromIds) for (const b of (bomCache.get(id) || []))
        if (b.component_type === 'RECIPE' && b.sub_recipe_id) subs.add(b.sub_recipe_id)
      return subs
    }

    const level0 = new Set<string>(cleanRows.map((r: any) => r.recipe_id))
    await loadBomForRecipes(level0); await loadPrepTasksForRecipes(level0); await loadRecipeMeta(level0)
    const level1 = collectSubIds(level0)
    if (level1.size) { await loadBomForRecipes(level1); await loadPrepTasksForRecipes(level1); await loadRecipeMeta(level1) }
    const level2 = collectSubIds(level1)
    if (level2.size) { await loadBomForRecipes(level2); await loadPrepTasksForRecipes(level2); await loadRecipeMeta(level2) }
    const level3 = collectSubIds(level2)
    if (level3.size) { await loadBomForRecipes(level3); await loadPrepTasksForRecipes(level3); await loadRecipeMeta(level3) }
    const allItemIds = new Set<string>()
    for (const [, boms] of bomCache) for (const b of boms) if (b.item_id) allItemIds.add(b.item_id)
    await loadIngredients(allItemIds)

    const ingredientAccum = new Map<string, any>()
    const prepAccum       = new Map<string, any>()
    const observations: any[] = []
    const batchWarnedKeys     = new Set<string>()
    const thresholdWarnedKeys = new Set<string>()

    const rowByPosName = new Map<string, { recipe_id: string, portions: number }>()
    for (const r of cleanRows) {
      if (rowByPosName.has(r.pos_item_name)) rowByPosName.get(r.pos_item_name)!.portions += parseFloat(r.portions_sold) || 0
      else rowByPosName.set(r.pos_item_name, { recipe_id: r.recipe_id, portions: parseFloat(r.portions_sold) || 0 })
    }

    async function getPrepTask(recipeId: string) {
      if (prepTaskCache.has(recipeId)) return prepTaskCache.get(recipeId)
      const { data: tasks } = await supa.from('prep_tasks')
        .select('id, name, recipe_id, unit, current_stock').eq('recipe_id', recipeId).eq('archived', false).limit(1)
      const task = tasks?.[0] || null
      prepTaskCache.set(recipeId, task)
      return task
    }
    async function getRecipeMeta(recipeId: string) {
      if (recipeMetaCache.has(recipeId)) return recipeMetaCache.get(recipeId)!
      const { data: recs } = await supa.from('recipe_yield').select('id, title, portions').eq('id', recipeId).limit(1)
      const meta = recs?.[0] ? { title: recs[0].title, base_servings: recs[0].portions != null ? Number(recs[0].portions) : null } : { title: recipeId, base_servings: null }
      recipeMetaCache.set(recipeId, meta)
      return meta
    }

    async function traverse(recipeId: string, portions: number, posItemName: string, posRecipeId: string, pathSoFar: string, depth: number, qtyFactor: number): Promise<void> {
      if (depth > MAX_DEPTH) { observations.push({ business_date: businessDate, bot_name: BOT_NAME, commis_name: 'bom-chain-commis', severity: 'warning', category: 'bom_warning', entity_type: 'recipe', title: posItemName + ' BOM chain depth > ' + MAX_DEPTH, explanation: 'Traversal superato max depth.', suggested_action: 'Verificare BOM per catene circolari.', metadata: { pos_item_name: posItemName, recipe_id: recipeId, depth, path: pathSoFar }, status: 'open' }); return }
      const boms = bomCache.get(recipeId) || []
      for (const bom of boms) {
        const bomQty = parseFloat(bom.quantity) || 0
        if (bomQty <= 0) continue
        const effectiveQtyPerPortion = bomQty * qtyFactor
        if (bom.component_type === 'ITEM') {
          if (!bom.item_id) { observations.push({ business_date: businessDate, bot_name: BOT_NAME, commis_name: 'bom-chain-commis', severity: 'warning', category: 'bom_warning', entity_type: 'ingredient', title: posItemName + ' ITEM senza ingredient_id', explanation: 'ITEM nel BOM senza ingredient_id.', suggested_action: 'Collegare ingrediente nel BOM editor.', metadata: { pos_item_name: posItemName, bom_id: bom.bom_id, path: pathSoFar }, status: 'open' }); continue }
          if (alreadyDeducted.has(posItemName + '|i:' + bom.item_id)) continue
          const ingredient = ingredientCache.get(bom.item_id)
          const ingName = ingredient?.name || bom.item_id
          const unit = bom.unit || ingredient?.base_unit || 'g'
          if (!bom.unit) observations.push({ business_date: businessDate, bot_name: BOT_NAME, commis_name: 'bom-chain-commis', severity: 'warning', category: 'bom_warning', entity_type: 'ingredient', title: posItemName + ' ' + ingName + ' unita mancante nel BOM', explanation: 'Fallback a base_unit o g.', suggested_action: 'Aggiungere unita nel BOM.', metadata: { pos_item_name: posItemName, ingredient: ingName, bom_id: bom.bom_id }, status: 'open' })
          const thresholdKey = posItemName + '|' + bom.item_id
          if (isQuantitySuspicious(effectiveQtyPerPortion, unit, ingName) && !thresholdWarnedKeys.has(thresholdKey)) {
            thresholdWarnedKeys.add(thresholdKey)
            observations.push({ business_date: businessDate, bot_name: BOT_NAME, commis_name: 'bom-chain-commis', severity: 'warning', category: 'bom_warning', entity_type: 'ingredient', title: posItemName + ' ' + ingName + ' qty anomala (' + effectiveQtyPerPortion.toFixed(0) + unit + ')', explanation: ingName + ': ' + effectiveQtyPerPortion.toFixed(0) + unit + '/porzione sembra elevata.', suggested_action: 'Verificare se BOM e per porzione o batch.', metadata: { pos_item_name: posItemName, ingredient_name: ingName, ingredient_id: bom.item_id, qty_per_portion: effectiveQtyPerPortion, unit, bom_id: bom.bom_id, path: pathSoFar, skipped_reason: 'threshold_warning_only' }, status: 'open' })
          }
          const accumKey = posItemName + '|' + bom.item_id + '|' + unit
          const totalQtyThisPath = effectiveQtyPerPortion * portions
          const pathDesc = pathSoFar + ' -> ' + ingName + ' x' + effectiveQtyPerPortion.toFixed(4).replace(/\.?0+$/, '') + unit
          if (ingredientAccum.has(accumKey)) { ingredientAccum.get(accumKey).totalQty += totalQtyThisPath; ingredientAccum.get(accumKey).paths.push(pathDesc) }
          else ingredientAccum.set(accumKey, { totalQty: totalQtyThisPath, unit, ingredient_id: bom.item_id, ingName, paths: [pathDesc], posItemName, posRecipeId, portions })
          continue
        }
        if (bom.component_type === 'RECIPE' && bom.sub_recipe_id) {
          const subId = bom.sub_recipe_id
          const prepTask = await getPrepTask(subId)
          if (prepTask) {
            const dkR = posItemName + '|r:' + subId, dkP = posItemName + '|p:' + prepTask.id
            if (alreadyDeducted.has(dkR) || alreadyDeducted.has(dkP)) continue
            const unit = bom.unit || prepTask.unit || 'pz'
            const totalQty = effectiveQtyPerPortion * portions
            const accumKey = posItemName + '|p:' + prepTask.id + '|' + unit
            const pathDesc = pathSoFar + ' -> PREP ' + prepTask.name + ' x' + effectiveQtyPerPortion.toFixed(4).replace(/\.?0+$/, '') + unit
            if (prepAccum.has(accumKey)) { prepAccum.get(accumKey).totalQty += totalQty; prepAccum.get(accumKey).paths.push(pathDesc) }
            else prepAccum.set(accumKey, { totalQty, unit, prepTask, paths: [pathDesc], posItemName, posRecipeId, portions, subId })
            continue
          }
          const subMeta = await getRecipeMeta(subId)
          const subBaseServings = subMeta.base_servings
          const subTitle = subMeta.title || subId.slice(0, 8)
          if (subBaseServings !== null && subBaseServings > 1) {
            const batchKey = posItemName + '|' + subId
            if (!batchWarnedKeys.has(batchKey)) {
              batchWarnedKeys.add(batchKey)
              const subBoms = bomCache.get(subId) || []
              observations.push({ business_date: businessDate, bot_name: BOT_NAME, commis_name: 'bom-chain-commis', severity: 'warning', category: 'bom_warning', entity_type: 'recipe', title: posItemName + ' ' + subTitle + ' BOM batch-level skipped (base_servings=' + subBaseServings + ')', explanation: subTitle + ' ha base_servings=' + subBaseServings + ' e nessun prep_task.', suggested_action: 'Creare prep_task o impostare base_servings=1.', metadata: { pos_item_name: posItemName, recipe_id: subId, recipe_name: subTitle, base_servings: subBaseServings, skipped_reason: 'batch_level_bom', skipped_components_count: subBoms.filter((b: any) => b.component_type === 'ITEM').length, path: pathSoFar }, status: 'open' })
            }
            continue
          }
          const subBoms = bomCache.get(subId) || []
          if (!subBoms.length) { observations.push({ business_date: businessDate, bot_name: BOT_NAME, commis_name: 'bom-chain-commis', severity: 'warning', category: 'bom_warning', entity_type: 'recipe', title: posItemName + ' ricetta virtuale ' + subTitle + ' senza BOM', explanation: 'Sub-recipe senza prep_task e senza BOM.', suggested_action: 'Aggiungere BOM o creare prep_task.', metadata: { pos_item_name: posItemName, sub_recipe_id: subId, bom_id: bom.bom_id }, status: 'open' }); continue }
          await traverse(subId, portions, posItemName, posRecipeId, pathSoFar + ' -> [' + subTitle + ']', depth + 1, effectiveQtyPerPortion)
        }
      }
    }

    for (const [posItemName, { recipe_id, portions }] of rowByPosName) {
      if (portions <= 0) continue
      const topMeta = recipeMetaCache.get(recipe_id) || { title: recipe_id, base_servings: null }
      const topBaseServings = topMeta.base_servings
      const topPrepTask = prepTaskCache.get(recipe_id) ?? await getPrepTask(recipe_id)
      if (topBaseServings !== null && topBaseServings > 1 && topPrepTask) continue
      if (topBaseServings !== null && topBaseServings > 1 && !topPrepTask) {
        const batchKey = posItemName + '|' + recipe_id
        if (!batchWarnedKeys.has(batchKey)) {
          batchWarnedKeys.add(batchKey)
          const topBoms = bomCache.get(recipe_id) || []
          observations.push({ business_date: businessDate, bot_name: BOT_NAME, commis_name: 'bom-chain-commis', severity: 'warning', category: 'bom_warning', entity_type: 'recipe', title: posItemName + ' POS recipe batch-level senza prep_task (base_servings=' + topBaseServings + ')', explanation: topMeta.title + ' ha base_servings=' + topBaseServings + ' ma nessun prep_task.', suggested_action: 'Creare prep_task o impostare base_servings=1.', metadata: { pos_item_name: posItemName, recipe_id, recipe_name: topMeta.title, base_servings: topBaseServings, skipped_reason: 'top_level_batch_no_prep_task', skipped_components_count: topBoms.filter((b: any) => b.component_type === 'ITEM').length }, status: 'open' })
        }
        continue
      }
      await traverse(recipe_id, portions, posItemName, recipe_id, posItemName, 1, 1)
    }

    const deductions: any[] = []
    for (const acc of ingredientAccum.values()) {
      const calcPath = acc.paths.length === 1 ? (acc.paths[0] + ': ' + acc.portions + 'p = ' + acc.totalQty + acc.unit + ' [bom_chain]') : (acc.posItemName + ' -> ' + acc.ingName + ' (' + acc.paths.length + ' percorsi): ' + acc.totalQty + acc.unit + ' [bom_chain/aggregated]')
      deductions.push({ business_date: businessDate, item_type: 'ingredient', item_id: acc.ingredient_id, target_recipe_id: null, prep_task_id: null, ingredient_id: acc.ingredient_id, target_name: acc.ingName, recipe_id: acc.posRecipeId, pos_item_name: acc.posItemName, source: 'bom_chain', quantity: acc.totalQty, unit: acc.unit, portions_sold: acc.portions, calculation_path: calcPath, confidence: 0.8, warning: null, metadata: { aggregated: acc.paths.length > 1, paths_count: acc.paths.length, ingredient_name: acc.ingName } })
    }
    let skippedPrep = 0
    for (const acc of prepAccum.values()) {
      if (alreadyDeducted.has(acc.posItemName + '|r:' + acc.subId) || alreadyDeducted.has(acc.posItemName + '|p:' + acc.prepTask.id)) { skippedPrep++; continue }
      const calcPath = acc.posItemName + ' -> PREP ' + acc.prepTask.name + ': ' + acc.portions + 'p x ' + (acc.totalQty / acc.portions).toFixed(2) + acc.unit + ' = ' + acc.totalQty + acc.unit + ' [bom_chain/stocked_prep]'
      deductions.push({ business_date: businessDate, item_type: 'prep', item_id: acc.subId, target_recipe_id: acc.subId, prep_task_id: acc.prepTask.id, ingredient_id: null, target_name: acc.prepTask.name, recipe_id: acc.posRecipeId, pos_item_name: acc.posItemName, source: 'bom_chain', quantity: acc.totalQty, unit: acc.unit, portions_sold: acc.portions, calculation_path: calcPath, confidence: 0.85, warning: null, metadata: { prep_task_name: acc.prepTask.name, stop_reason: 'stocked_prep_terminal' } })
    }

    let rowsWritten = 0, insertError: string | null = null
    if (!dryRun) {
      for (let i = 0; i < deductions.length; i += 50) {
        const { error: ie } = await supa.from('stock_deductions').insert(deductions.slice(i, i + 50))
        if (ie) { insertError = ie.message; break }
        rowsWritten += deductions.slice(i, i + 50).length
      }
      if (observations.length > 0) {
        const { error: oe } = await supa.from('commis_observations').insert(observations)
        if (oe) throw new Error('commis_observations: ' + oe.message)
      }
    }
    if (insertError) throw new Error('stock_deductions insert: ' + insertError)

    const ingDeds = deductions.filter((d: any) => d.item_type === 'ingredient').length
    const prepDeds = deductions.filter((d: any) => d.item_type === 'prep').length
    const aggCount = [...ingredientAccum.values()].filter((a: any) => a.paths.length > 1).length
    const batchBlocked = batchWarnedKeys.size, thresholdWarned = thresholdWarnedKeys.size
    const summary = BOT_VERSION + ' ' + businessDate + (dryRun ? ' [dry-run]' : '') + ': ' + cleanRows.length + ' clean -> ' + (dryRun ? 0 : rowsWritten) + ' bom_chain (' + ingDeds + ' ing, ' + prepDeds + ' prep, ' + aggCount + ' agg, ' + skippedPrep + ' skip) . ' + batchBlocked + ' batch-blocked . ' + thresholdWarned + ' threshold-warned . ' + observations.length + ' obs'

    const logResult = await finishRun('success', cleanRows.length, dryRun ? 0 : rowsWritten, observations.length, 0, summary,
      { dry_run: dryRun, execution_mode: dryRun ? 'dry_run' : 'live', ingredient_deductions: ingDeds, prep_deductions: prepDeds, aggregated_ingredients: aggCount, batch_blocked: batchBlocked, threshold_warned: thresholdWarned, result: dryRun ? 'dry_run' : 'written', bot_version: BOT_VERSION })

    return respond({ success: true, run_id: runId, business_date: businessDate, dry_run: dryRun, clean_rows_read: cleanRows.length, deductions_written: dryRun ? 0 : rowsWritten, ingredient_deductions: ingDeds, prep_deductions: prepDeds, aggregated_ingredients: aggCount, batch_blocked: batchBlocked, threshold_warned: thresholdWarned, observations: observations.length, summary, bot_version: BOT_VERSION, ...logResult })

  } catch (err: any) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const logResult = await finishRun('failed', 0, 0, 0, 1,
      BOT_VERSION + ' FAILED ' + businessDate + ': ' + errMsg,
      { dry_run: dryRun, error: errMsg, execution_mode: dryRun ? 'dry_run' : 'live' })
    return respond({ success: false, run_id: runId, error: errMsg, ...logResult }, 500)
  }
})
