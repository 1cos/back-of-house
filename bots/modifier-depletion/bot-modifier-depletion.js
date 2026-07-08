// bot-modifier-depletion — Brigade · Zenos on the Square
// Legge pos_modifiers → applica pos_modifier_depletion_rules → scrive stock_movements
//
// REGOLA MADRE:
//   La produzione scarica gli ingredienti.
//   La vendita scarica il prodotto finito.
//
// TARGET per tipo:
//   recipe-backed (Balsamic/Citronette/Ranch) → item_type='prep', item_id=recipe.id
//   ingredient-backed (Caesar)                → item_type='ingredient', item_id=ingredient.id
//
// CUTOFF: processa solo pos_modifiers.created_at >= go_live_at
//   go_live_at = '2026-07-09 07:00:00+00' (primo import post go-live)
//   Impedisce backfill di dati storici.
//
// IDEMPOTENCY: metadata.idempotency_key = 'modifier_depletion:{sale_date}:{rule_id}:{canonical}'
//   Se il key esiste già in stock_movements, skip.
//
// MOVEMENT:
//   source         = 'pos_modifier_drain'
//   source_bot     = 'bot-modifier-depletion'
//   movement_type  = 'POS_MODIFIER_DRAIN'
//   quantity       = -(uses × normalized_qty_ml) — sempre negativo
//   unit           = 'ml'

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

// Go-live timestamp UTC — import del 2026-07-09 alle 02:05 CDT = 07:05 UTC
// Il bot non processa nessun record importato prima di questo momento.
const GO_LIVE_AT = '2026-07-09 07:00:00+00'

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
    const dryRun    = body.dry_run === true
    const forceLive = body.force_live === true  // override go_live_at per test espliciti
    const runId     = crypto.randomUUID()

    // ── 1. Carica le regole active=true ──────────────────────────────────────
    const { data: rules, error: rulesErr } = await supa
      .from('pos_modifier_depletion_rules')
      .select('id, modifier_canonical, modifier_aliases, normalized_qty_ml, normalized_qty_g, linked_recipe_id, linked_ingredient_id')
      .eq('confidence', 'confirmed')
      .eq('active', true)

    if (rulesErr) throw new Error(`rules load: ${rulesErr.message}`)
    if (!rules?.length) return respond({ success: false, message: 'No active confirmed rules found. Set active=true first.', dry_run: dryRun }, corsHeaders)

    // Indice alias → regola
    const aliasMap = {}
    for (const rule of rules) {
      for (const alias of (rule.modifier_aliases || [])) {
        aliasMap[alias] = rule
      }
    }

    // ── 2. Carica pos_modifiers — solo import dopo go_live_at ────────────────
    const cutoff = forceLive ? '2000-01-01T00:00:00+00' : GO_LIVE_AT
    const { data: modRows, error: modErr } = await supa
      .from('pos_modifiers')
      .select('id, sale_date, modifier, quantity_sold, created_at')
      .gte('created_at', cutoff)
      .eq('is_historical', false)

    if (modErr) throw new Error(`pos_modifiers: ${modErr.message}`)
    if (!modRows?.length) return respond({
      success: true,
      message: `No modifier rows to process after go_live_at (${cutoff})`,
      dry_run: dryRun, rows_found: 0
    }, corsHeaders)

    // ── 3. Carica idempotency keys già scritte ────────────────────────────────
    // Legge tutti i metadata.idempotency_key esistenti per modifier_depletion
    const { data: existingMovements } = await supa
      .from('stock_movements')
      .select('metadata')
      .eq('source', 'pos_modifier_drain')

    const processedKeys = new Set(
      (existingMovements || [])
        .map(m => m.metadata?.idempotency_key)
        .filter(Boolean)
    )

    // ── 4. Aggrega per (sale_date, canonical) e costruisce movimenti ──────────
    const aggregated = {}  // key = `${sale_date}:${canonical}`

    for (const row of modRows) {
      const rule = aliasMap[row.modifier]
      if (!rule) continue

      const key = `${row.sale_date}:${rule.modifier_canonical}`
      if (!aggregated[key]) {
        aggregated[key] = {
          sale_date: row.sale_date,
          canonical: rule.modifier_canonical,
          rule_id: rule.id,
          uses: 0,
          aliases_seen: new Set(),
          item_type: rule.linked_recipe_id ? 'prep' : 'ingredient',
          item_id: rule.linked_recipe_id || rule.linked_ingredient_id,
          normalized_qty_ml: parseFloat(rule.normalized_qty_ml),
        }
      }
      aggregated[key].uses += (row.quantity_sold || 1)
      aggregated[key].aliases_seen.add(row.modifier)
    }

    // ── 5. Costruisce righe movimento ─────────────────────────────────────────
    const toInsert  = []
    const skipped   = []
    const unmatched = []
    const preview   = []

    // Conta modifier non matchati
    const matchedIds = new Set(
      modRows
        .filter(r => aliasMap[r.modifier])
        .map(r => r.id)
    )
    for (const row of modRows) {
      if (!aliasMap[row.modifier] && isFoodLike(row.modifier)) {
        unmatched.push({ modifier: row.modifier, sale_date: row.sale_date, uses: row.quantity_sold })
      }
    }

    for (const [, agg] of Object.entries(aggregated)) {
      const idKey = `modifier_depletion:${agg.sale_date}:${agg.rule_id}:${agg.canonical}`

      if (processedKeys.has(idKey)) {
        skipped.push({ idempotency_key: idKey, reason: 'already_processed' })
        continue
      }

      const totalMl = -(agg.uses * agg.normalized_qty_ml)

      const movement = {
        business_date:      agg.sale_date,
        item_type:          agg.item_type,
        item_id:            agg.item_id,
        movement_type:      'POS_MODIFIER_DRAIN',
        quantity:           parseFloat(totalMl.toFixed(4)),
        unit:               'ml',
        source:             'pos_modifier_drain',
        source_bot:         'bot-modifier-depletion',
        bom_item_type:      agg.item_type === 'prep' ? 'RECIPE' : 'ITEM',
        bom_item_name:      agg.canonical,
        sold_quantity:      agg.uses,
        bom_quantity_per_recipe: agg.normalized_qty_ml,
        note: `Modifier drain: ${agg.uses} × "${agg.canonical}" → ${Math.abs(totalMl).toFixed(1)}ml`,
        metadata: {
          idempotency_key:   idKey,
          canonical_modifier: agg.canonical,
          aliases_matched:   [...agg.aliases_seen],
          rule_id:           agg.rule_id,
          qty_ml_per_use:    agg.normalized_qty_ml,
          qty_oz_per_use:    parseFloat((agg.normalized_qty_ml / 29.5735).toFixed(4)),
          target_type:       agg.item_type,
          target_id:         agg.item_id,
          bot_run_id:        runId,
          go_live_at:        GO_LIVE_AT,
          dry_run:           dryRun,
        }
      }

      toInsert.push(movement)
      preview.push({
        sale_date: agg.sale_date,
        canonical: agg.canonical,
        uses: agg.uses,
        total_ml: Math.abs(totalMl).toFixed(1),
        item_type: agg.item_type,
        item_id: agg.item_id,
        idempotency_key: idKey,
      })
    }

    // ── 6. Scrivi (se non dry-run) ────────────────────────────────────────────
    let inserted = 0
    let writeErrors = []

    if (!dryRun && toInsert.length > 0) {
      const { data: written, error: writeErr } = await supa
        .from('stock_movements')
        .insert(toInsert)
        .select('id')

      if (writeErr) {
        writeErrors.push(writeErr.message)
      } else {
        inserted = written?.length || 0
      }
    }

    // ── 7. Logga bot_run ──────────────────────────────────────────────────────
    const runDate = new Date().toISOString().slice(0, 10)
    const summary = dryRun
      ? `DRY-RUN: ${preview.length} would insert, ${skipped.length} skip, ${unmatched.length} unmatched`
      : `LIVE: ${inserted} inserted, ${skipped.length} skip, ${unmatched.length} unmatched, ${writeErrors.length} errors`

    if (!dryRun) {
      await supa.from('bot_runs').insert({
        bot_name:      'bot-modifier-depletion',
        run_date:      runDate,
        started_at:    new Date(runStart).toISOString(),
        finished_at:   new Date().toISOString(),
        status:        writeErrors.length ? 'error' : 'success',
        rows_read:     modRows.length,
        rows_written:  inserted,
        warnings_count: unmatched.length,
        errors_count:  writeErrors.length,
        summary,
        metadata: { run_id: runId, go_live_at: GO_LIVE_AT, dry_run: false }
      })
    }

    return respond({
      success:       true,
      dry_run:       dryRun,
      run_id:        runId,
      go_live_at:    GO_LIVE_AT,
      rows_scanned:  modRows.length,
      movements_preview: preview,
      inserted,
      skipped,
      unmatched_food_modifiers: unmatched,
      write_errors:  writeErrors,
      summary,
      elapsed_ms:    Date.now() - runStart,
    }, corsHeaders)

  } catch (err) {
    return respond({ success: false, error: err.message }, corsHeaders, 500)
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────────
function respond(body, corsHeaders, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

// Modifier "food-like" = ha senso segnalarlo come unmatched (non è una preferenza/istruzione)
function isFoodLike(modifier) {
  if (!modifier) return false
  const m = modifier.toLowerCase()
  // Ignora preferenze/istruzioni note
  const noisy = ['no ', 'without', 'extra ', 'add ', 'split', 'on side', 'on the side',
                  'gluten', 'allerg', 'course ', 'seat', 'ots', 'well done', 'medium',
                  'x ', 'hold ', 'light ', 'heavy ']
  for (const n of noisy) { if (m.startsWith(n) || m.includes(n)) return false }
  // È food-like se menziona cose da cucina non coperte
  const foodWords = ['dressing', 'sauce', 'oil', 'butter', 'cheese', 'cream', 'glaze',
                     'reduction', 'vinaigrette', 'aioli', 'mayo', 'mustard', 'pesto']
  return foodWords.some(w => m.includes(w))
}
