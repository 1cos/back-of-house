// bot-pos-cleaner — Station 2 del TouchBistro POS Bot
// Legge pos_daily_raw → classifica → mappa → scrive pos_daily_clean
// Commis deterministico: zero LLM, zero stock, zero deduction
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

    // ── 0. Idempotenza: cancella run precedente per questa data ──────────────
    await supa.from('pos_daily_clean')
      .delete()
      .eq('business_date', businessDate)

    await supa.from('commis_observations')
      .delete()
      .eq('business_date', businessDate)
      .eq('bot_name', 'pos-cleaner')
      .eq('commis_name', 'mapping-commis')

    // ── 1. Carica regole classificazione (ordinate per priority ASC) ─────────
    const { data: rules, error: rulesErr } = await supa
      .from('pos_item_class_rules')
      .select('*')
      .eq('active', true)
      .order('priority', { ascending: true })

    if (rulesErr) throw new Error(`Rules load failed: ${rulesErr.message}`)

    // Indicizza per lookup rapido
    const rulesByTable = { pos_sales_by_item: [], pos_modifiers: [], any: [] }
    for (const r of rules) rulesByTable[r.source_table].push(r)

    // ── 2. Carica pos_daily_raw per la data ──────────────────────────────────
    const { data: rawRows, error: rawErr } = await supa
      .from('pos_daily_raw')
      .select('*')
      .eq('business_date', businessDate)

    if (rawErr) throw new Error(`pos_daily_raw load failed: ${rawErr.message}`)
    if (!rawRows || rawRows.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        message: `No pos_daily_raw data for ${businessDate}`,
        business_date: businessDate
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── 3. Carica ricette (pos_name pipe-delimited) ──────────────────────────
    const { data: recipes } = await supa
      .from('recipes')
      .select('id, title, pos_name, menu_group')
      .not('pos_name', 'is', null)
      .neq('pos_name', '')

    // Costruisce mappa alias → recipe
    const recipeByAlias = new Map() // alias_lower → { id, title, pos_name }
    for (const rec of (recipes || [])) {
      const aliases = rec.pos_name.split('|').map(a => a.trim().toLowerCase()).filter(Boolean)
      for (const alias of aliases) {
        if (!recipeByAlias.has(alias)) recipeByAlias.set(alias, rec)
      }
    }

    // ── 4. Carica pos_item_aliases ───────────────────────────────────────────
    const { data: posAliases } = await supa
      .from('pos_item_aliases')
      .select('alias_name, canonical_name, portion_factor, category')

    const aliasByName = new Map()
    for (const a of (posAliases || [])) {
      aliasByName.set(a.alias_name.toLowerCase(), a)
    }

    // ── 5. Funzioni helper ───────────────────────────────────────────────────

    function applyRules(itemName, sourceTable) {
      // Cerca prima nelle regole specifiche per source_table, poi in 'any'
      const candidateSets = [rulesByTable[sourceTable] || [], rulesByTable['any'] || []]
      for (const ruleSet of candidateSets) {
        for (const rule of ruleSet) {
          if (matchesRule(itemName, rule)) {
            return rule
          }
        }
      }
      return null
    }

    function matchesRule(name, rule) {
      const n = name.toLowerCase()
      const p = rule.pattern.toLowerCase()
      switch (rule.match_type) {
        case 'exact':       return n === p
        case 'starts_with': return n.startsWith(p)
        case 'contains':    return n.includes(p)
        case 'regex':       try { return new RegExp(p, 'i').test(name) } catch { return false }
        default:            return false
      }
    }

    function matchRecipe(itemName, menuGroup) {
      const nameLower = itemName.toLowerCase()

      // 1. Match esatto su pos_name alias
      if (recipeByAlias.has(nameLower)) {
        return { recipe: recipeByAlias.get(nameLower), matchType: 'exact', confidence: 1.0 }
      }

      // 2. Kids menu → cerca Half
      if (menuGroup === 'Kids menu') {
        const halfName = nameLower.replace(/\s+kids?\s*$/, ' half').trim()
        if (recipeByAlias.has(halfName)) {
          return { recipe: recipeByAlias.get(halfName), matchType: 'kids_alias', confidence: 0.98 }
        }
        // Tenta anche aggiungendo " [Kids]" come alias (se mai fosse nei pos_name)
        const kidsAlias = nameLower.replace(/\s+kids?\s*$/, '').trim() + ' kids'
        if (recipeByAlias.has(kidsAlias)) {
          return { recipe: recipeByAlias.get(kidsAlias), matchType: 'kids_alias', confidence: 0.98 }
        }
      }

      // 3. pos_item_aliases
      if (aliasByName.has(nameLower)) {
        const aliasRow = aliasByName.get(nameLower)
        const canonLower = aliasRow.canonical_name.toLowerCase()
        if (recipeByAlias.has(canonLower)) {
          return { recipe: recipeByAlias.get(canonLower), matchType: 'modifier_alias', confidence: 0.95 }
        }
      }

      return null
    }

    // ── 6. Processa ogni riga ─────────────────────────────────────────────────
    const cleanRows = []
    const observations = []

    for (const raw of rawRows) {
      const itemName = raw.pos_item_name || ''
      const sourceTable = raw.source_table || 'pos_modifiers'
      const menuGroup = raw.menu_group || raw.metadata?.menu_group || null
      const portionsSold = parseFloat(raw.portions_sold) || 0

      // Step A: classifica tramite regole
      const matchedRule = applyRules(itemName, sourceTable)

      let itemClass, classSource, ruleId, action, warning

      if (matchedRule) {
        itemClass   = matchedRule.item_class
        action      = matchedRule.action
        ruleId      = matchedRule.id
        classSource = `rule_${matchedRule.match_type}`
      } else {
        // Default per source_table
        if (sourceTable === 'pos_sales_by_item') {
          itemClass   = 'MENU_ITEM'
          action      = 'map'
          classSource = 'menu_group'
        } else {
          itemClass   = 'UNKNOWN_REVIEW'
          action      = 'manual_review'
          classSource = 'default'
        }
        ruleId = null
      }

      // Step B: mapping ricetta (solo per MENU_ITEM e KITCHEN_OPERATIONAL con action='map')
      let recipeId = null
      let matchedRecipeName = null
      let matchType = 'classified_ignore'
      let confidence = itemClass.endsWith('_IGNORE') || itemClass === 'SERVER_INSTRUCTION' ? 1.0 : 0
      let needsReview = false

      const shouldMap = (itemClass === 'MENU_ITEM' || itemClass === 'KITCHEN_OPERATIONAL')
                        && action === 'map'

      if (shouldMap) {
        // Skip item con nome vuoto
        if (!itemName.trim()) {
          matchType   = 'empty_name'
          needsReview = false
          confidence  = 0
        } else {
          const recipeMatch = matchRecipe(itemName, menuGroup)
          if (recipeMatch) {
            recipeId          = recipeMatch.recipe.id
            matchedRecipeName = recipeMatch.recipe.title
            matchType         = recipeMatch.matchType
            confidence        = recipeMatch.confidence
            needsReview       = false
          } else {
            matchType   = 'unmatched'
            confidence  = 0
            needsReview = true
            warning     = `No recipe match for "${itemName}" (${itemClass})`
          }
        }
      } else if (itemClass === 'OPEN_ITEM_MANUAL') {
        matchType   = 'open_item'
        needsReview = true
        warning     = `Open Food item — manual review required (${portionsSold} portions)`
      }

      cleanRows.push({
        business_date:       businessDate,
        pos_item_name:       itemName,
        canonical_name:      matchedRecipeName || null,
        recipe_id:           recipeId,
        portions_sold:       portionsSold,
        match_type:          matchType,
        confidence:          confidence,
        needs_review:        needsReview,
        warning:             warning || null,
        item_class:          itemClass,
        class_source:        classSource,
        rule_id:             ruleId,
        action:              action,
        source_table:        sourceTable,
        menu_group:          menuGroup,
        matched_recipe_name: matchedRecipeName,
        gross_sales:         raw.gross_sales || null,
        metadata:            raw.metadata || {}
      })

      // Step C: Commis Mapping Auditor (deterministico)
      // Silenzio totale per SYSTEM_IGNORE, BAR_IGNORE, SERVER_INSTRUCTION
      if (['SYSTEM_IGNORE','BAR_IGNORE','SERVER_INSTRUCTION'].includes(itemClass)) continue

      if (itemClass === 'MENU_ITEM' && !recipeId && itemName.trim()) {
        observations.push({
          business_date:   businessDate,
          bot_name:        'pos-cleaner',
          commis_name:     'mapping-commis',
          severity:        'warning',
          category:        'missing_mapping',
          entity_type:     'pos_item',
          title:           `${itemName} — no recipe match (MENU_ITEM)`,
          explanation:     `"${itemName}" è un piatto del menu (${menuGroup || 'gruppo sconosciuto'}) con ${portionsSold} porzioni vendute ma non ha una ricetta Brigade collegata.`,
          suggested_action:'Aggiungi pos_name alla ricetta corrispondente in Brigade, oppure crea la ricetta.',
          metadata: { pos_item_name: itemName, menu_group: menuGroup, portions_sold: portionsSold, source_table: sourceTable }
        })
      } else if (itemClass === 'KITCHEN_OPERATIONAL' && !recipeId && itemName.trim()) {
        observations.push({
          business_date:   businessDate,
          bot_name:        'pos-cleaner',
          commis_name:     'mapping-commis',
          severity:        'info',
          category:        'missing_mapping',
          entity_type:     'pos_item',
          title:           `${itemName} — nessuna ricetta (KITCHEN_OPERATIONAL)`,
          explanation:     `Modifier "${itemName}" è operativo di cucina (${portionsSold}×) ma non ha ancora un alias in Brigade.`,
          suggested_action:'Aggiungi a pos_item_aliases per abilitare scarico stock futuro.',
          metadata: { pos_item_name: itemName, portions_sold: portionsSold, source_table: sourceTable }
        })
      } else if (itemClass === 'OPEN_ITEM_MANUAL') {
        observations.push({
          business_date:   businessDate,
          bot_name:        'pos-cleaner',
          commis_name:     'mapping-commis',
          severity:        'warning',
          category:        'manual_review',
          entity_type:     'pos_item',
          title:           `Open Food — ${portionsSold} vendite richiedono review`,
          explanation:     `"Open Food" è stato usato ${portionsSold} volte. Questi non vengono scaricati dallo stock automaticamente.`,
          suggested_action:'Verifica su TouchBistro cosa è stato venduto e aggiorna current_stock manualmente se necessario.',
          metadata: { portions_sold: portionsSold }
        })
      } else if (itemClass === 'UNKNOWN_REVIEW' && itemName.trim()) {
        observations.push({
          business_date:   businessDate,
          bot_name:        'pos-cleaner',
          commis_name:     'mapping-commis',
          severity:        'info',
          category:        'missing_mapping',
          entity_type:     'pos_item',
          title:           `${itemName} — UNKNOWN_REVIEW`,
          explanation:     `Modifier "${itemName}" (${portionsSold}×) non classificato. Non sa se è cucina, bar, o istruzione server.`,
          suggested_action:'Aggiungi a pos_item_class_rules con la classe corretta.',
          metadata: { pos_item_name: itemName, portions_sold: portionsSold, source_table: sourceTable }
        })
      }
    }

    // ── 7. Scrivi pos_daily_clean ─────────────────────────────────────────────
    let rowsWritten = 0
    if (cleanRows.length > 0) {
      // Batch insert da 100 righe
      for (let i = 0; i < cleanRows.length; i += 100) {
        const batch = cleanRows.slice(i, i + 100)
        const { error: insertErr } = await supa.from('pos_daily_clean').insert(batch)
        if (insertErr) throw new Error(`pos_daily_clean insert failed: ${insertErr.message}`)
        rowsWritten += batch.length
      }
    }

    // ── 8. Scrivi commis_observations ────────────────────────────────────────
    let obsWritten = 0
    if (observations.length > 0) {
      const { error: obsErr } = await supa.from('commis_observations').insert(observations)
      if (obsErr) throw new Error(`commis_observations insert failed: ${obsErr.message}`)
      obsWritten = observations.length
    }

    // ── 9. Statistiche run ────────────────────────────────────────────────────
    const classDist = {}
    for (const r of cleanRows) {
      classDist[r.item_class] = (classDist[r.item_class] || 0) + 1
    }
    const mappedToRecipe  = cleanRows.filter(r => r.recipe_id).length
    const needsReviewCount = cleanRows.filter(r => r.needs_review).length
    const ignoredCount     = cleanRows.filter(r => r.action === 'ignore').length

    // ── 10. Scrivi bot_runs ───────────────────────────────────────────────────
    const durationMs = Date.now() - runStart
    const summary = [
      `${rowsWritten} rows classified`,
      `${mappedToRecipe} mapped to recipe`,
      `${ignoredCount} ignored (noise)`,
      `${needsReviewCount} needs review`,
      `${obsWritten} observations`
    ].join(' · ')

    await supa.from('bot_runs').insert({
      bot_name:      'pos-cleaner',
      business_date: businessDate,
      status:        'success',
      started_at:    new Date(runStart).toISOString(),
      completed_at:  new Date().toISOString(),
      duration_ms:   durationMs,
      rows_read:     rawRows.length,
      rows_written:  rowsWritten,
      warnings_count: obsWritten,
      summary,
      metadata: {
        class_distribution: classDist,
        mapped_to_recipe:   mappedToRecipe,
        needs_review:       needsReviewCount,
        ignored:            ignoredCount,
        rules_loaded:       rules.length
      }
    })

    return new Response(JSON.stringify({
      success:        true,
      business_date:  businessDate,
      raw_rows:       rawRows.length,
      clean_rows:     rowsWritten,
      mapped_recipes: mappedToRecipe,
      needs_review:   needsReviewCount,
      ignored:        ignoredCount,
      observations:   obsWritten,
      class_distribution: classDist,
      duration_ms:    durationMs,
      summary
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    console.error('bot-pos-cleaner error:', err)
    return new Response(JSON.stringify({
      success: false,
      error:   err.message
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
