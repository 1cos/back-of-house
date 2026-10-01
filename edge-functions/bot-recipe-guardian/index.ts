// ── BOT-RECIPE-GUARDIAN v14 (YIELD01) ───────────────────────────────────────
// v14: the yield check reads the canonical view public.recipe_yield (same logic as FC05):
//      a recipe needs a yield (batch weight OR portions), not specifically base_servings.
//      Open 'missing_base_servings' items are closed automatically when the recipe has a yield.
// Scansiona ricette con pos_name popolato, prioritizzate per vendite recenti.
// Checks: Critical / Warning / Info — una issue_type per ricetta per run.
// Output: max 5 critical + 5 warning al giorno. Info va in backlog senza limite.
// Dedup: se esiste già un item open per (source_id, issue_type) → aggiorna
//        last_seen_at e times_seen invece di creare un duplicato.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const BOT_ID = 'recipe_guardian';
const MAX_CRITICAL_PER_RUN = 5;
const MAX_WARNING_PER_RUN = 5;

// Unità convertibili — se l'unità non è qui la riga è flaggata
const KNOWN_UNITS = new Set([
  'g','kg','ml','l','oz','lb','each','pz','pezzi','buste','busta',
  'nests','nest','cup','cups','tbsp','tsp','fl_oz','bunch','slice',
  'fette','fetta','cartocci','cartoccio','filetto','filetti',
  'gallone','gallon','lt','cl','mg','lbs',
]);

function isFoodCostCalculable(recipe: any, bomRows: any[]): boolean {
  if (!recipe.selling_price) return false;
  if (bomRows.length === 0) return false;
  // Almeno una riga ITEM con qty e unit valida
  const validRows = bomRows.filter(
    (r: any) => r.component_type === 'ITEM' && r.item_id && r.quantity > 0 && r.unit
  );
  return validRows.length > 0;
}

Deno.serve(async () => {
  const now = new Date();
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ── 1. Ricette con pos_name ──────────────────────────────────────────────
    const { data: recipes, error: recipeErr } = await sb
      .from('recipes')
      .select(`
        id, title, pos_name, serving_unit, serving_qty, base_servings,
        procedure, procedure_en, selling_price, food_cost_pct,
        image_url, photo_url
      `)
      .not('pos_name', 'is', null)
      .neq('pos_name', '');

    if (recipeErr) throw recipeErr;
    if (!recipes || recipes.length === 0) {
      return new Response(JSON.stringify({ skipped: true, reason: 'no recipes with pos_name' }), { status: 200 });
    }

    const recipeIds = recipes.map((r: any) => r.id);

    // ── 1b. Resa canonica (vista recipe_yield) ───────────────────────────────
    const yieldMap: Record<string, { has_yield: boolean; portions: number | null }> = {};
    for (let i = 0; i < recipeIds.length; i += 100) {
      const { data: ys, error: yErr } = await sb.from('recipe_yield')
        .select('id, has_yield, portions').in('id', recipeIds.slice(i, i + 100));
      if (yErr) throw yErr;
      for (const y of (ys || [])) yieldMap[y.id] = { has_yield: !!y.has_yield, portions: y.portions };
    }

    // ── 2. POS sales — ultimi 30 giorni (7 e 1 giorno per priorità) ─────────
    const { data: sales30, error: salesErr } = await sb
      .from('pos_sales_by_item')
      .select('menu_item, quantity, sale_date')
      .gte('sale_date', new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));

    if (salesErr) throw salesErr;

    // Costruisci mappa per menu_item → { qty30, qty7, qty1 }
    const salesMap: Record<string, { qty30: number; qty7: number; qty1: number }> = {};
    const d7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const d1 = new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10);

    for (const row of (sales30 || [])) {
      if (!salesMap[row.menu_item]) salesMap[row.menu_item] = { qty30: 0, qty7: 0, qty1: 0 };
      const qty = parseFloat(row.quantity) || 0;
      salesMap[row.menu_item].qty30 += qty;
      if (row.sale_date >= d7) salesMap[row.menu_item].qty7 += qty;
      if (row.sale_date >= d1) salesMap[row.menu_item].qty1 += qty;
    }

    // Associa vendite a ogni ricetta (pos_name può avere alias pipe-delimited)
    function getRecipeSales(recipe: any) {
      const aliases = (recipe.pos_name as string).split('|').map((s: string) => s.trim());
      let qty30 = 0, qty7 = 0, qty1 = 0;
      for (const alias of aliases) {
        const s = salesMap[alias];
        if (s) { qty30 += s.qty30; qty7 += s.qty7; qty1 += s.qty1; }
      }
      return { qty30, qty7, qty1 };
    }

    // ── 3. BOM completo per tutte le ricette ─────────────────────────────────
    const { data: allBom, error: bomErr } = await sb
      .from('recipe_bom')
      .select('parent_recipe_id, component_type, item_id, sub_recipe_id, quantity, unit')
      .in('parent_recipe_id', recipeIds);

    if (bomErr) throw bomErr;

    const bomByRecipe: Record<string, any[]> = {};
    for (const row of (allBom || [])) {
      if (!bomByRecipe[row.parent_recipe_id]) bomByRecipe[row.parent_recipe_id] = [];
      bomByRecipe[row.parent_recipe_id].push(row);
    }

    // ── 4. Office items già esistenti da questo bot ──────────────────────────
    const { data: existingItems } = await sb
      .from('office_items')
      .select('id, source_id, issue_type, status, times_seen')
      .eq('bot_id', BOT_ID)
      .in('status', ['open', 'snoozed']);

    // key = `${source_id}::${issue_type}`
    const existingMap: Record<string, any> = {};
    for (const item of (existingItems || [])) {
      const key = `${item.source_id}::${item.issue_type}`;
      existingMap[key] = item;
    }

    // ── 5. Ordina ricette per priorità vendite ────────────────────────────────
    // sold yesterday > sold 7d > sold 30d > top sellers first
    const scoredRecipes = recipes.map((r: any) => {
      const s = getRecipeSales(r);
      let priority = 0;
      if (s.qty1 > 0) priority = 3;
      else if (s.qty7 > 0) priority = 2;
      else if (s.qty30 > 0) priority = 1;
      return { ...r, sales: s, salesPriority: priority };
    });
    scoredRecipes.sort((a: any, b: any) =>
      b.salesPriority - a.salesPriority || b.sales.qty30 - a.sales.qty30
    );

    // ── 6. Analizza ogni ricetta e raccogli issues ────────────────────────────
    type Issue = {
      recipeId: string;
      recipeName: string;
      posName: string;
      sales: { qty30: number; qty7: number; qty1: number };
      issueType: string;
      severity: 'critical' | 'warning' | 'info';
      priority: 'red' | 'orange' | 'blue';
      title: string;
      body: string;
      impact: string;
      suggestedFix: string;
    };

    const issues: Issue[] = [];

    for (const recipe of scoredRecipes) {
      const bomRows = bomByRecipe[recipe.id] || [];
      const { qty30, qty7, qty1 } = recipe.sales;

      // Periodo vendite in testo
      const salesText = qty1 > 0
        ? `sold ${qty1} time${qty1 > 1 ? 's' : ''} yesterday`
        : qty7 > 0
        ? `sold ${qty7} time${qty7 > 1 ? 's' : ''} in the last 7 days`
        : qty30 > 0
        ? `sold ${qty30} time${qty30 > 1 ? 's' : ''} in the last 30 days`
        : 'not sold recently but has pos_name';

      // ── CRITICAL ──────────────────────────────────────────────────────────

      // C1: BOM vuoto
      if (bomRows.length === 0) {
        issues.push({
          recipeId: recipe.id,
          recipeName: recipe.title,
          posName: recipe.pos_name,
          sales: recipe.sales,
          issueType: 'bom_empty',
          severity: 'critical',
          priority: 'red',
          title: `🔴 ${recipe.title} — BOM empty`,
          body: `${recipe.title} was ${salesText}, but has NO ingredients in the BOM. Food cost and prep forecast are completely blind. Add all components immediately.`,
          impact: 'Food cost calculation impossible. Bot 3 cannot forecast production.',
          suggestedFix: 'Open recipe editor → BOM tab → add all ingredients with qty and unit.',
        });
      }

      // C2: serving_qty o serving_unit mancanti
      if (!recipe.serving_qty || !recipe.serving_unit) {
        const missing = [];
        if (!recipe.serving_qty) missing.push('serving_qty');
        if (!recipe.serving_unit) missing.push('serving_unit');
        issues.push({
          recipeId: recipe.id,
          recipeName: recipe.title,
          posName: recipe.pos_name,
          sales: recipe.sales,
          issueType: 'missing_serving_fields',
          severity: 'critical',
          priority: 'red',
          title: `🔴 ${recipe.title} — Missing ${missing.join(' / ')}`,
          body: `${recipe.title} was ${salesText}. Missing: ${missing.join(', ')}. Bot 3 (Preplist Builder) cannot calculate production quantities without these fields.`,
          impact: 'Bot 3 skips this recipe. Prep forecast unreliable.',
          suggestedFix: `Set ${missing.join(' and ')} in recipe editor (e.g., serving_qty=1, serving_unit=pezzi).`,
        });
      }

      // C3 (v14): nessuna resa — né peso del lotto né porzioni (resa canonica, stessa logica di FC05)
      if (!yieldMap[recipe.id]?.has_yield) {
        issues.push({
          recipeId: recipe.id,
          recipeName: recipe.title,
          posName: recipe.pos_name,
          sales: recipe.sales,
          issueType: 'missing_yield',
          severity: 'critical',
          priority: 'red',
          title: `🔴 ${recipe.title} — No yield`,
          body: `${recipe.title} was ${salesText}, but it has no yield: no batch weight and no number of portions. Food cost per portion and stock deduction cannot be calculated.`,
          impact: 'Food cost per portion and stock deduction cannot be calculated.',
          suggestedFix: 'Set the yield once: batch weight (kg) or number of portions.',
        });
      }

      // C4: venduto ma food cost non calcolabile (selling_price presente ma BOM insufficiente)
      if (recipe.selling_price && qty30 > 0 && !isFoodCostCalculable(recipe, bomRows)) {
        issues.push({
          recipeId: recipe.id,
          recipeName: recipe.title,
          posName: recipe.pos_name,
          sales: recipe.sales,
          issueType: 'food_cost_uncalculable',
          severity: 'critical',
          priority: 'red',
          title: `🔴 ${recipe.title} — Food cost cannot be calculated`,
          body: `${recipe.title} has a selling price set but was ${salesText} without a complete BOM. Food cost % is unknown. Margin tracking is blind.`,
          impact: 'Bot 5 (Food Cost Guard) cannot calculate margin on this dish.',
          suggestedFix: 'Complete BOM with ingredient rows (component_type=ITEM, valid qty and unit).',
        });
      }

      // ── WARNING ───────────────────────────────────────────────────────────

      // W1: BOM parziale (< 4 righe valide)
      const validBomRows = bomRows.filter(
        (r: any) => (r.item_id || r.sub_recipe_id) && r.quantity > 0
      );
      if (bomRows.length > 0 && validBomRows.length < 4) {
        issues.push({
          recipeId: recipe.id,
          recipeName: recipe.title,
          posName: recipe.pos_name,
          sales: recipe.sales,
          issueType: 'bom_partial',
          severity: 'warning',
          priority: 'orange',
          title: `🟠 ${recipe.title} — BOM incomplete (${validBomRows.length} row${validBomRows.length !== 1 ? 's' : ''})`,
          body: `${recipe.title} was ${salesText}, but BOM has only ${validBomRows.length} valid row${validBomRows.length !== 1 ? 's' : ''}. Most recipes need at least 4. Food cost may be understated.`,
          impact: 'Food cost likely understated. Bot 3 forecast partially blind.',
          suggestedFix: 'Review BOM — add missing ingredients (protein, sauce, garnish, starch).',
        });
      }

      // W2: righe BOM senza item_id o sub_recipe_id
      const orphanRows = bomRows.filter(
        (r: any) => !r.item_id && !r.sub_recipe_id
      );
      if (orphanRows.length > 0) {
        issues.push({
          recipeId: recipe.id,
          recipeName: recipe.title,
          posName: recipe.pos_name,
          sales: recipe.sales,
          issueType: 'bom_orphan_rows',
          severity: 'warning',
          priority: 'orange',
          title: `🟠 ${recipe.title} — BOM has ${orphanRows.length} unlinked row${orphanRows.length !== 1 ? 's' : ''}`,
          body: `${recipe.title} was ${salesText}. ${orphanRows.length} BOM row${orphanRows.length !== 1 ? 's' : ''} have no linked ingredient or sub-recipe. These rows are invisible to food cost and prep calculations.`,
          impact: 'Unlinked rows ignored by all bots. Food cost understated.',
          suggestedFix: 'Open BOM editor — find rows without ingredient and re-link or delete them.',
        });
      }

      // W3: righe BOM con qty o unit mancanti
      const missingQtyRows = bomRows.filter(
        (r: any) => (!r.quantity || r.quantity <= 0 || !r.unit)
      );
      if (missingQtyRows.length > 0) {
        issues.push({
          recipeId: recipe.id,
          recipeName: recipe.title,
          posName: recipe.pos_name,
          sales: recipe.sales,
          issueType: 'bom_missing_qty_unit',
          severity: 'warning',
          priority: 'orange',
          title: `🟠 ${recipe.title} — ${missingQtyRows.length} BOM row${missingQtyRows.length !== 1 ? 's' : ''} missing qty/unit`,
          body: `${recipe.title} was ${salesText}. ${missingQtyRows.length} ingredient row${missingQtyRows.length !== 1 ? 's' : ''} in the BOM have no quantity or unit. These rows contribute $0 to food cost.`,
          impact: 'Food cost calculation skips these rows — margin understated.',
          suggestedFix: 'Fill in quantity and unit for all BOM rows.',
        });
      }

      // W4: unità non convertibili
      const badUnitRows = bomRows.filter(
        (r: any) => r.unit && !KNOWN_UNITS.has(r.unit.toLowerCase().trim())
      );
      if (badUnitRows.length > 0) {
        const badUnits = [...new Set(badUnitRows.map((r: any) => r.unit))].join(', ');
        issues.push({
          recipeId: recipe.id,
          recipeName: recipe.title,
          posName: recipe.pos_name,
          sales: recipe.sales,
          issueType: 'bom_unknown_units',
          severity: 'warning',
          priority: 'orange',
          title: `🟠 ${recipe.title} — Unknown unit${badUnitRows.length !== 1 ? 's' : ''}: ${badUnits}`,
          body: `${recipe.title} was ${salesText}. BOM contains unit${badUnitRows.length !== 1 ? 's' : ''} the system cannot convert: ${badUnits}. Cost per 100g cannot be calculated for these rows.`,
          impact: 'Conversion impossible — these ingredients excluded from food cost.',
          suggestedFix: `Replace "${badUnits}" with standard units: g, kg, ml, l, oz, lb, each, pz, nests.`,
        });
      }

      // ── INFO ──────────────────────────────────────────────────────────────

      // I1: procedura vuota
      if (!recipe.procedure || recipe.procedure.trim() === '') {
        issues.push({
          recipeId: recipe.id,
          recipeName: recipe.title,
          posName: recipe.pos_name,
          sales: recipe.sales,
          issueType: 'missing_procedure',
          severity: 'info',
          priority: 'blue',
          title: `🔵 ${recipe.title} — No procedure / plating notes`,
          body: `${recipe.title} was ${salesText} with no written procedure or plating notes. New cooks cannot reference this dish.`,
          impact: 'Training and consistency risk — no documented service notes.',
          suggestedFix: 'Add plating notes in the Notes tab (procedure field) — what to do when the ticket comes in.',
        });
      }

      // I2: foto mancante
      if (!recipe.image_url && !recipe.photo_url) {
        issues.push({
          recipeId: recipe.id,
          recipeName: recipe.title,
          posName: recipe.pos_name,
          sales: recipe.sales,
          issueType: 'missing_photo',
          severity: 'info',
          priority: 'blue',
          title: `🔵 ${recipe.title} — No photo`,
          body: `${recipe.title} was ${salesText} with no plating photo. Cooks have no visual reference for presentation.`,
          impact: 'Inconsistent plating — no visual standard for new cooks.',
          suggestedFix: 'Take a photo of a well-plated dish and upload via recipe editor.',
        });
      }
    }

    // ── 7. Applica limiti per run (critical: 5, warning: 5, info: no limit) ──
    const criticalIssues = issues.filter((i) => i.severity === 'critical');
    const warningIssues  = issues.filter((i) => i.severity === 'warning');
    const infoIssues     = issues.filter((i) => i.severity === 'info');

    const sortBySales = (a: Issue, b: Issue) => b.sales.qty30 - a.sales.qty30;
    criticalIssues.sort(sortBySales);
    warningIssues.sort(sortBySales);
    infoIssues.sort(sortBySales);

    const toProcess: Issue[] = [
      ...criticalIssues.slice(0, MAX_CRITICAL_PER_RUN),
      ...warningIssues.slice(0, MAX_WARNING_PER_RUN),
      ...infoIssues,
    ];

    // ── 8. Insert / update office_items ──────────────────────────────────────
    let inserted = 0;
    let updated = 0;

    for (const issue of toProcess) {
      const dedupeKey = `${issue.recipeId}::${issue.issueType}`;
      const existing = existingMap[dedupeKey];

      if (existing) {
        await sb.from('office_items').update({
          last_seen_at: now.toISOString(),
          times_seen: (existing.times_seen || 1) + 1,
          updated_at: now.toISOString(),
          body: issue.body,
          impact: issue.impact,
        }).eq('id', existing.id);
        updated++;
      } else {
        await sb.from('office_items').insert({
          source: 'ai_scan',
          source_id: issue.recipeId,
          from_user: 'bot-recipe-guardian',
          bot_id: BOT_ID,
          severity: issue.severity,
          issue_type: issue.issueType,
          recipe_id: issue.recipeId,
          priority: issue.priority,
          title: issue.title,
          body: issue.body,
          impact: issue.impact,
          suggested_fix: issue.suggestedFix,
          ai_options: [
            { label: 'Fix now', action: 'open_recipe', recipe_id: issue.recipeId },
            { label: 'Snooze 7 days', action: 'snooze', days: 7 },
            { label: 'Ignore', action: 'resolve' },
          ],
          status: 'open',
          notify_brigade: false,
          detected_at: now.toISOString(),
          last_seen_at: now.toISOString(),
          times_seen: 1,
          report_type: 'RECIPE_INCOMPLETE',
          updated_at: now.toISOString(),
        });
        inserted++;
      }
    }

    // ── 9. (v14) Chiude le voci 'missing_base_servings' superate dalla resa canonica ──
    let autoClosed = 0;
    for (const item of (existingItems || [])) {
      if (item.issue_type !== 'missing_base_servings') continue;
      if (!yieldMap[item.source_id]?.has_yield) continue;          // still no yield: it will be re-raised as missing_yield
      const { error: cErr } = await sb.from('office_items').update({
        status: 'resolved',
        resolution: 'auto: the recipe has a yield (canonical yield, YIELD01)',
        resolved_by: 'bot-recipe-guardian',
        resolved_at: now.toISOString(),
        updated_at: now.toISOString(),
      }).eq('id', item.id).eq('status', item.status);
      if (!cErr) autoClosed++;
    }

    const backlogCritical = Math.max(0, criticalIssues.length - MAX_CRITICAL_PER_RUN);
    const backlogWarning  = Math.max(0, warningIssues.length - MAX_WARNING_PER_RUN);

    console.log(`[bot-recipe-guardian v14] recipes=${recipes.length} issues=${issues.length} inserted=${inserted} updated=${updated} backlog_critical=${backlogCritical} backlog_warning=${backlogWarning}`);

    return new Response(JSON.stringify({
      ok: true,
      bot_id: BOT_ID,
      version: 'v14',
      recipes_checked: recipes.length,
      issues_found: {
        critical: criticalIssues.length,
        warning: warningIssues.length,
        info: infoIssues.length,
        total: issues.length,
      },
      surfaced: {
        critical: Math.min(criticalIssues.length, MAX_CRITICAL_PER_RUN),
        warning: Math.min(warningIssues.length, MAX_WARNING_PER_RUN),
        info: infoIssues.length,
      },
      backlog: {
        critical: backlogCritical,
        warning: backlogWarning,
      },
      office_items: { inserted, updated, auto_closed: autoClosed },
      run_at: now.toISOString(),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[bot-recipe-guardian v14]', err);
    return new Response(JSON.stringify({ error: err.message, bot_id: BOT_ID, version: 'v14' }), { status: 500 });
  }
});
