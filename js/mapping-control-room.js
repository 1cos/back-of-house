// ══════════════════════════════════════════════════════════════
// MAPPING CONTROL ROOM — js/mapping-control-room.js
// Desktop audit/editing screen for Chef Max.
// Phase 1: Read-only — Problems View + Item Detail Drawer
// Phase 2 (future): Mapping Grid with inline edit + audit log
// ══════════════════════════════════════════════════════════════

window.openMappingControlRoom = async function () {
  const sb = window.supa;
  if (!sb) return;

  // ── Remove any existing instance ─────────────────────────────
  document.getElementById('mcrOverlay')?.remove();
  document.getElementById('mcrModal')?.remove();

  // ── Overlay ──────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'mcrOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:350;background:rgba(8,18,40,0.6);backdrop-filter:blur(2px);';
  overlay.onclick = e => { if (e.target === overlay) closeMCR(); };
  document.body.appendChild(overlay);

  // ── Modal shell ───────────────────────────────────────────────
  const modal = document.createElement('div');
  modal.id = 'mcrModal';
  modal.style.cssText = [
    'position:fixed;inset:12px;z-index:351;',
    'background:#0f172a;border-radius:20px;',
    'display:flex;flex-direction:column;overflow:hidden;',
    'box-shadow:0 32px 80px rgba(0,0,0,0.6);',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
  ].join('');
  modal.innerHTML = `
    <!-- ── HEADER ── -->
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:14px 20px 12px;background:#0f172a;border-bottom:1px solid #1e293b;flex-shrink:0;">
      <div style="display:flex;align-items:center;gap:12px;">
        <span style="font-size:20px;">🗺️</span>
        <div>
          <div style="font-size:17px;font-weight:700;color:#f1f5f9;letter-spacing:-0.3px;">Mapping Control Room</div>
          <div id="mcrSubtitle" style="font-size:11px;color:#64748b;">Loading audit data…</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button id="mcrRefreshBtn" onclick="mcrRefresh()"
          style="padding:7px 14px;background:#1e293b;border:1px solid #334155;border-radius:10px;
                 color:#94a3b8;font-size:12px;font-weight:600;cursor:pointer;">↺ Refresh</button>
        <button onclick="closeMCR()"
          style="width:32px;height:32px;background:#1e293b;border:none;border-radius:8px;
                 color:#64748b;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
      </div>
    </div>

    <!-- ── TAB BAR ── -->
    <div style="display:flex;gap:2px;padding:10px 16px 0;background:#0f172a;flex-shrink:0;">
      <button id="mcrTabProblems" onclick="mcrShowTab('problems')"
        class="mcr-tab mcr-tab-active">⚠️ Problems <span id="mcrProbCount" style="margin-left:4px;"></span></button>
      <button id="mcrTabGrid" onclick="mcrShowTab('grid')"
        class="mcr-tab">📊 Mapping Grid <span style="font-size:10px;color:#475569;margin-left:4px;">(Phase 2)</span></button>
    </div>

    <!-- ── BODY (split layout) ── -->
    <div style="display:flex;flex:1;overflow:hidden;gap:0;">

      <!-- LEFT: Problems / Grid panel -->
      <div id="mcrLeft" style="flex:1;overflow-y:auto;padding:12px 16px 24px;-webkit-overflow-scrolling:touch;">
        <div id="mcrProblemsPanel"></div>
        <div id="mcrGridPanel" style="display:none;"></div>
      </div>

      <!-- RIGHT: Item Detail Drawer -->
      <div id="mcrDrawer"
        style="width:420px;flex-shrink:0;background:#0b1628;border-left:1px solid #1e293b;
               overflow-y:auto;-webkit-overflow-scrolling:touch;display:none;padding:16px;">
      </div>
    </div>`;
  document.body.appendChild(modal);

  // ── Inject styles ─────────────────────────────────────────────
  if (!document.getElementById('mcrStyles')) {
    const style = document.createElement('style');
    style.id = 'mcrStyles';
    style.textContent = `
      .mcr-tab {
        padding:8px 16px;border-radius:10px 10px 0 0;border:none;
        background:#1e293b;color:#64748b;font-size:13px;font-weight:600;
        cursor:pointer;font-family:inherit;transition:background .15s,color .15s;
      }
      .mcr-tab-active {
        background:#1e40af;color:#e0f2fe;
      }
      .mcr-pill {
        display:inline-block;padding:2px 8px;border-radius:20px;
        font-size:10px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;
      }
      .mcr-pill-red    { background:#7f1d1d;color:#fca5a5; }
      .mcr-pill-yellow { background:#78350f;color:#fde68a; }
      .mcr-pill-green  { background:#14532d;color:#86efac; }
      .mcr-pill-blue   { background:#1e3a8a;color:#bfdbfe; }
      .mcr-row {
        display:grid;
        grid-template-columns:200px 100px 130px 80px 1fr 120px;
        gap:8px;align-items:center;
        padding:10px 12px;border-radius:12px;margin-bottom:6px;
        background:#1e293b;border:1px solid #334155;
        cursor:pointer;transition:background .12s;
        font-size:13px;color:#e2e8f0;
      }
      .mcr-row:hover { background:#263548; }
      .mcr-row.selected { background:#1e3a5f;border-color:#3b82f6; }
      .mcr-header-row {
        display:grid;
        grid-template-columns:200px 100px 130px 80px 1fr 120px;
        gap:8px;padding:6px 12px 8px;
        font-size:10px;font-weight:700;color:#475569;
        letter-spacing:.6px;text-transform:uppercase;
      }
      .mcr-filter-bar {
        display:flex;gap:8px;align-items:center;
        margin-bottom:12px;flex-wrap:wrap;
      }
      .mcr-filter-btn {
        padding:5px 12px;border-radius:20px;border:1px solid #334155;
        background:#1e293b;color:#94a3b8;font-size:11px;font-weight:600;
        cursor:pointer;font-family:inherit;transition:all .12s;
      }
      .mcr-filter-btn.active { background:#1e40af;color:#bfdbfe;border-color:#3b82f6; }
      .mcr-search {
        flex:1;min-width:160px;padding:6px 12px;
        background:#1e293b;border:1px solid #334155;border-radius:10px;
        color:#e2e8f0;font-size:13px;font-family:inherit;outline:none;
      }
      .mcr-search::placeholder { color:#475569; }
      .mcr-drawer-section {
        background:#1e293b;border-radius:12px;padding:12px;margin-bottom:12px;
        border:1px solid #334155;
      }
      .mcr-drawer-label {
        font-size:10px;font-weight:700;color:#475569;letter-spacing:.6px;
        text-transform:uppercase;margin-bottom:8px;
      }
      .mcr-kv { display:flex;justify-content:space-between;align-items:baseline;
                 padding:3px 0;border-bottom:1px solid #0f172a; }
      .mcr-kv:last-child { border-bottom:none; }
      .mcr-kv-k { font-size:11px;color:#64748b; }
      .mcr-kv-v { font-size:12px;color:#e2e8f0;font-weight:600;text-align:right;max-width:60%;word-break:break-all; }
      .mcr-bom-row { padding:4px 0;border-bottom:1px solid #0f172a;display:flex;justify-content:space-between; }
      .mcr-bom-row:last-child { border-bottom:none; }
    `;
    document.head.appendChild(style);
  }

  // ── Load data and render ──────────────────────────────────────
  window._mcrData = null;
  await mcrLoadAndRender();
};

// ── Close ───────────────────────────────────────────────────────
window.closeMCR = function () {
  document.getElementById('mcrOverlay')?.remove();
  document.getElementById('mcrModal')?.remove();
};

// ── Refresh ─────────────────────────────────────────────────────
window.mcrRefresh = async function () {
  window._mcrData = null;
  document.getElementById('mcrSubtitle').textContent = 'Refreshing…';
  await mcrLoadAndRender();
};

// ── Tab switch ──────────────────────────────────────────────────
window.mcrShowTab = function (tab) {
  document.getElementById('mcrTabProblems').classList.toggle('mcr-tab-active', tab === 'problems');
  document.getElementById('mcrTabGrid').classList.toggle('mcr-tab-active', tab === 'grid');
  document.getElementById('mcrProblemsPanel').style.display = tab === 'problems' ? '' : 'none';
  document.getElementById('mcrGridPanel').style.display = tab === 'grid' ? '' : 'none';
  if (tab === 'grid') {
    document.getElementById('mcrGridPanel').innerHTML =
      `<div style="color:#475569;padding:40px;text-align:center;font-size:14px;">
        📊 Mapping Grid — Phase 2<br>
        <span style="font-size:12px;color:#334155;">Edit/save with audit log will be built after Problems View is approved by Chef Max.</span>
      </div>`;
  }
};

// ── Load all data in parallel ────────────────────────────────────
window.mcrLoadAndRender = async function () {
  const sb = window.supa;
  const sub = document.getElementById('mcrSubtitle');
  if (sub) sub.textContent = 'Loading audit data…';

  try {
    const [
      { data: prepTasks },
      { data: recipes },
      { data: ingredients },
      { data: bom },
      { data: posAliases },
      { data: modifierConfig },
      { data: posSales },
      { data: posModifiers },
    ] = await Promise.all([
      sb.from('prep_tasks').select('id,name,category,prep_type,unit,current_stock,suggested_qty,suggested_note,suggested_at,recipe_id,ingredient_id,expected_duration_days,min_cover_days,archived,base_weight_g').eq('archived', false).limit(500),
      sb.from('recipes').select('id,title,pos_name,menu_group,category,base_weight_g,base_servings,serving_weight_g,serving_unit,serving_qty,shelf_life_days,food_cost_pct,selling_price').limit(500),
      sb.from('ingredients').select('id,name,category,measure_type,active').eq('active', true).limit(500),
      sb.from('recipe_bom').select('bom_id,parent_recipe_id,component_type,item_id,sub_recipe_id,quantity,unit,notes').limit(1500),
      sb.from('pos_item_aliases').select('*').limit(200),
      sb.from('modifier_config').select('*').limit(200),
      sb.from('pos_sales_by_item').select('menu_item,quantity,sale_date').gte('sale_date', new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)).limit(1000),
      sb.from('pos_modifiers').select('modifier_name,quantity,sale_date').gte('sale_date', new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)).limit(1000),
    ]);

    window._mcrData = { prepTasks, recipes, ingredients, bom, posAliases, modifierConfig, posSales, posModifiers };

    const problems = mcrDetectProblems(window._mcrData);
    window._mcrProblems = problems;

    renderMcrProblems(problems);
    if (sub) sub.textContent = `${problems.length} problem${problems.length !== 1 ? 's' : ''} found · Last scanned ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} CDT`;

  } catch (err) {
    console.error('[MCR] load error:', err);
    if (sub) sub.textContent = 'Error loading data — check console';
  }
};

// ══════════════════════════════════════════════════════════════
// PROBLEM DETECTION ENGINE
// ══════════════════════════════════════════════════════════════
window.mcrDetectProblems = function ({ prepTasks, recipes, ingredients, bom, posAliases, modifierConfig, posSales, posModifiers }) {
  const problems = [];

  // Helper maps
  const recipeById   = Object.fromEntries((recipes || []).map(r => [r.id, r]));
  const ingById      = Object.fromEntries((ingredients || []).map(i => [i.id, i]));
  const recipeByTitle = {};
  (recipes || []).forEach(r => { recipeByTitle[r.title?.toLowerCase()] = r; });
  const ingByName     = {};
  (ingredients || []).forEach(i => { ingByName[i.name?.toLowerCase()] = i; });

  // BOM indexed by parent
  const bomByParent = {};
  (bom || []).forEach(b => {
    if (!bomByParent[b.parent_recipe_id]) bomByParent[b.parent_recipe_id] = [];
    bomByParent[b.parent_recipe_id].push(b);
  });

  // POS sales last 30d by menu_item (total qty)
  const salesLast30 = {};
  (posSales || []).forEach(s => {
    salesLast30[s.menu_item] = (salesLast30[s.menu_item] || 0) + (s.quantity || 0);
  });

  // Modifier sales last 30d
  const modSales = {};
  (posModifiers || []).forEach(m => {
    modSales[m.modifier_name] = (modSales[m.modifier_name] || 0) + (m.quantity || 0);
  });

  // ── A: Specific Priority Audits ───────────────────────────────

  // A1: Balsamic Dressing vs Balsamic Glaze
  const balsamicIngredients = (ingredients || []).filter(i =>
    i.name?.toLowerCase().includes('balsamic'));
  if (balsamicIngredients.length > 1) {
    // Find prep tasks or BOM rows using them
    const balsamicBomRows = (bom || []).filter(b =>
      b.component_type === 'ITEM' &&
      balsamicIngredients.some(i => i.id === b.item_id));
    problems.push({
      id: 'balsamic-collision',
      name: 'Balsamic Dressing / Glaze',
      type: 'ingredient',
      station: 'Salad Station',
      severity: 'yellow',
      problemType: 'ingredient-name-collision',
      explanation: `${balsamicIngredients.length} balsamic ingredients found: ${balsamicIngredients.map(i => i.name).join(', ')}. ${balsamicBomRows.length} BOM rows use them — verify they aren't cross-linked.`,
      suggestedFix: 'Confirm which recipes use Balsamic Dressing vs Balsamic Glaze and ensure no BOM row points to the wrong ingredient.',
      detail: { ingredientIds: balsamicIngredients.map(i => i.id), bomCount: balsamicBomRows.length, ingredients: balsamicIngredients },
    });
  }

  // A2: Cacio e Pepe — modifier aliases missing
  const cacioRecipe = (recipes || []).find(r => r.title?.toLowerCase().includes('cacio'));
  const cacioModifiers = (modifierConfig || []).filter(m =>
    m.modifier?.toLowerCase().includes('cacio') ||
    m.modifier?.toLowerCase().includes('pepe'));
  const cacioPosSales = Object.keys(salesLast30).filter(k => k.toLowerCase().includes('cacio'));
  if (cacioRecipe && cacioModifiers.length === 0) {
    problems.push({
      id: 'cacio-missing-modifier',
      name: 'Cacio e Pepe — modifier aliases',
      type: 'recipe',
      station: 'Pasta Station',
      severity: 'red',
      problemType: 'missing-modifier-alias',
      explanation: `Cacio e Pepe has POS name "${cacioRecipe.pos_name || 'none'}" but 0 modifier_config entries. If sold as a modifier/add-on, stock is never drawn down.`,
      suggestedFix: 'Add modifier entries to modifier_config for Cacio e Pepe half/full variants.',
      detail: { recipe: cacioRecipe, modifiers: cacioModifiers, posSales: cacioPosSales },
    });
  }

  // A3: Shaved Parmesan / Parmesan / Grana duplicates
  const parmKeywords = ['parmesan', 'parmigiano', 'grana', 'pecorino romano'];
  const parmIngredients = (ingredients || []).filter(i =>
    parmKeywords.some(k => i.name?.toLowerCase().includes(k)));
  if (parmIngredients.length >= 3) {
    // Find which ones share BOMs with the same parent recipe
    const parentsBothUsed = {};
    (bom || []).forEach(b => {
      if (b.component_type !== 'ITEM') return;
      const ing = ingById[b.item_id];
      if (!ing) return;
      if (parmKeywords.some(k => ing.name?.toLowerCase().includes(k))) {
        if (!parentsBothUsed[b.parent_recipe_id]) parentsBothUsed[b.parent_recipe_id] = [];
        parentsBothUsed[b.parent_recipe_id].push(ing.name);
      }
    });
    const conflicting = Object.entries(parentsBothUsed)
      .filter(([, names]) => new Set(names).size > 1)
      .map(([rid, names]) => `${recipeById[rid]?.title || rid}: ${[...new Set(names)].join(' + ')}`);
    problems.push({
      id: 'parm-duplicates',
      name: 'Parmesan / Pecorino duplicates',
      type: 'ingredient',
      station: 'Fresh Pasta Station',
      severity: conflicting.length > 0 ? 'red' : 'yellow',
      problemType: 'ingredient-name-collision',
      explanation: `${parmIngredients.length} parmesan-family ingredients: ${parmIngredients.map(i => i.name).join(', ')}.${conflicting.length ? ' Conflicts in BOMs: ' + conflicting.slice(0, 3).join(' · ') : ' No same-BOM conflicts found.'}`,
      suggestedFix: 'Consolidate to Parmesan Cheese (bulk), Grated Pecorino (prep recipe), Shaved Parmesan (prep recipe). Check BOM rows that use ITEM instead of sub-recipe.',
      detail: { ingredients: parmIngredients, conflictingBOMs: conflicting },
    });
  }

  // A4: Carrots — Julienne vs raw vs shredded
  const carrotIngredients = (ingredients || []).filter(i =>
    i.name?.toLowerCase().includes('carrot'));
  const carrotPreps = (prepTasks || []).filter(t =>
    t.name?.toLowerCase().includes('carrot') || t.name?.toLowerCase().includes('shredded'));
  const carrotBOM = (bom || []).filter(b =>
    b.component_type === 'ITEM' &&
    carrotIngredients.some(i => i.id === b.item_id));
  if (carrotIngredients.length > 1 || (carrotIngredients.length === 1 && carrotBOM.length > 2)) {
    problems.push({
      id: 'carrot-relationship',
      name: 'Carrot Julienne / raw relationship',
      type: 'prep',
      station: 'Salad Station',
      severity: 'yellow',
      problemType: 'recipe-used-as-ingredient',
      explanation: `${carrotIngredients.length} carrot ingredient(s), ${carrotPreps.length} carrot prep task(s). ${carrotBOM.length} BOM rows link raw carrots as ITEM directly — verify Shredded Carrots prep is used as sub-recipe where appropriate.`,
      suggestedFix: 'Ensure recipes consuming shredded carrots link to RECIPE Shredded Carrots (557fab23), not raw ITEM Carrots.',
      detail: { ingredients: carrotIngredients, preps: carrotPreps, bomRows: carrotBOM.length },
    });
  }

  // A5: Sauce/dressing items with huge bot suggestions
  const hugeSuggestions = (prepTasks || []).filter(t => {
    const sq = parseFloat(t.suggested_qty);
    const avg = parseFloat(t.average_qty);
    if (!sq || sq <= 0) return false;
    if (avg && sq > avg * 3) return true;
    if (!avg && sq > 50000) return true; // > 50kg raw
    return false;
  });
  hugeSuggestions.forEach(t => {
    const note = (t.suggested_note || '').split('|')[1] || '';
    problems.push({
      id: `huge-suggestion-${t.id}`,
      name: t.name,
      type: 'prep',
      station: t.category || '—',
      severity: 'red',
      problemType: 'bot-huge-suggestion',
      explanation: `Bot suggests ${t.suggested_qty} ${t.unit} (avg: ${t.average_qty || 'n/a'}). Note: "${note}". Likely a unit mismatch (grams vs physical units) or missing base_weight_g.`,
      suggestedFix: 'Check unit, serving_weight_g/base_weight_g on recipe, and whether bot path is direct_pos or ingredient fallback.',
      detail: { prepTask: t },
    });
  });

  // ── B: Structural checks — SOLD ITEM MODE vs PREP/BATCH MODE ─
  //
  // Two distinct recipe modes:
  //
  // SOLD ITEM MODE  — recipe has pos_name (connected to POS sales).
  //   Does NOT need batch weight / base_weight_g.
  //   NEEDS: a BOM that describes what 1 sale consumes.
  //   Bot path: reads BOM × sales_qty = daily drawdown per ingredient.
  //
  // PREP/BATCH MODE — prep_task has recipe_id (produced ahead, creates stock).
  //   NEEDS: batch yield (base_weight_g + base_servings, or serving_weight_g).
  //   Bot path: reads stock, calculates batches to produce.
  //
  // DO NOT flag a sold item for missing batch weight if it has a complete BOM.

  // B1: SOLD ITEM — missing BOM or BOM rows incomplete
  // A sold item is "OK for consumption" if:
  //   1. Has pos_name
  //   2. Has ≥1 BOM row
  //   3. Each BOM row has qty > 0 + unit + linked item_id or sub_recipe_id
  (recipes || []).filter(r => r.pos_name).forEach(r => {
    const rows = bomByParent[r.id] || [];
    if (rows.length === 0) {
      // No BOM at all — bot cannot calculate any drawdown
      problems.push({
        id: `sold-no-bom-${r.id}`,
        name: r.title,
        type: 'recipe',
        station: r.menu_group || '—',
        severity: 'red',
        problemType: 'sold-item-missing-bom',
        explanation: `Sold item (POS: "${r.pos_name}") has no BOM rows. Bot cannot calculate what 1 sale consumes — nothing is ever drawn down from stock.`,
        suggestedFix: 'Add BOM rows describing what each sale consumes: ingredient qty + unit per portion sold.',
        detail: { recipe: r, bomRows: [] },
      });
      return;
    }
    // Check for incomplete rows: missing qty, or missing link
    const incompleteRows = rows.filter(b =>
      !b.quantity || b.quantity <= 0 ||
      !b.unit ||
      (b.component_type === 'ITEM' && !b.item_id) ||
      (b.component_type === 'RECIPE' && !b.sub_recipe_id)
    );
    if (incompleteRows.length > 0) {
      problems.push({
        id: `sold-incomplete-bom-${r.id}`,
        name: r.title,
        type: 'recipe',
        station: r.menu_group || '—',
        severity: 'yellow',
        problemType: 'sold-item-incomplete-bom',
        explanation: `Sold item has ${rows.length} BOM row(s) but ${incompleteRows.length} are incomplete (missing qty, unit, or item link). Bot may under-calculate consumption.`,
        suggestedFix: 'Complete each BOM row: set quantity, unit, and link to ingredient or sub-recipe.',
        detail: { recipe: r, bomRows: rows, incompleteRows },
      });
    }
    // If BOM is complete: no problem — do NOT flag for missing batch weight
  });

  // B2: PREP/BATCH — missing batch yield
  // A prep task in BATCH MODE needs base_weight_g+base_servings OR serving_weight_g
  // so the bot can calculate "how many batches to produce".
  // Only applies when:
  //   - prep_task has recipe_id
  //   - prep_type != checklist
  //   - recipe has no pos_name (pure prep/subrecipe, produced ahead)
  // If recipe has pos_name it is served to-order — batch weight irrelevant — skip.
  (prepTasks || []).filter(t => {
    if (!t.recipe_id) return false;
    if (t.prep_type === 'checklist') return false;
    const rec = recipeById[t.recipe_id];
    if (!rec) return false;
    if (rec.pos_name) return false; // sold-to-order: no batch weight needed
    const hasYield = rec.base_weight_g || rec.serving_weight_g;
    return !hasYield;
  }).forEach(t => {
    const rec = recipeById[t.recipe_id];
    problems.push({
      id: `prep-no-yield-${t.id}`,
      name: t.name,
      type: 'prep',
      station: t.category || '—',
      severity: 'yellow',
      problemType: 'prep-missing-batch-yield',
      explanation: `Prep recipe "${rec.title}" has no batch yield (base_weight_g or serving_weight_g missing). Bot cannot express suggestions in real kitchen units (kg, nests, pezzi).`,
      suggestedFix: 'Set base_weight_g (total batch grams) + base_servings, or serving_weight_g (grams per portion served).',
      detail: { prepTask: t, recipe: rec },
    });
  });

  // B2b: SUBRECIPE — used in another BOM but has no yield defined
  // A sub-recipe (component_type=RECIPE in a BOM row) needs yield data so
  // the bot can scale grams consumed per parent-recipe sale.
  const subRecipeIds = new Set(
    (bom || [])
      .filter(b => b.component_type === 'RECIPE' && b.sub_recipe_id)
      .map(b => b.sub_recipe_id)
  );
  subRecipeIds.forEach(rid => {
    const rec = recipeById[rid];
    if (!rec) return;
    const hasYield = rec.base_weight_g || rec.serving_weight_g;
    if (!hasYield) {
      const hasLinkedPrep = (prepTasks || []).some(t => t.recipe_id === rid && t.prep_type !== 'checklist');
      if (!hasLinkedPrep) {
        const parentBomRows = (bom || []).filter(b => b.sub_recipe_id === rid);
        problems.push({
          id: `subrecipe-no-yield-${rid}`,
          name: rec.title,
          type: 'subrecipe',
          station: rec.menu_group || '—',
          severity: 'yellow',
          problemType: 'subrecipe-missing-yield',
          explanation: `Sub-recipe used in ${parentBomRows.length} BOM row(s) but has no base_weight_g or serving_weight_g. Bot cannot calculate grams consumed per sale.`,
          suggestedFix: 'Set serving_weight_g (grams of this sub-recipe per parent portion) or base_weight_g + base_servings.',
          detail: { recipe: rec, usedInBomCount: parentBomRows.length },
        });
      }
    }
  });

  // B3: PREP — no recipe_id and no ingredient_id (untethered)
  (prepTasks || []).filter(t =>
    !t.recipe_id && !t.ingredient_id &&
    t.prep_type !== 'checklist' &&
    t.category !== 'Manager Station'
  ).forEach(t => {
    problems.push({
      id: `no-link-${t.id}`,
      name: t.name,
      type: 'prep',
      station: t.category || '—',
      severity: 'yellow',
      problemType: 'prep-no-trusted-mapping',
      explanation: 'Prep task has no recipe_id and no ingredient_id. Bot cannot calculate consumption — it will skip or use fallback guessing.',
      suggestedFix: 'Link to a recipe (for sales-driven preps) or an ingredient (for raw material tracking).',
      detail: { prepTask: t },
    });
  });

  // B4: current_stock = 0 (or null) AND suggested_qty is large (not huge — those caught above)
  (prepTasks || []).filter(t => {
    const sq = parseFloat(t.suggested_qty);
    const cs = parseFloat(t.current_stock);
    return sq > 0 && sq <= 50000 && (isNaN(cs) || cs === 0 || t.current_stock === null);
  }).forEach(t => {
    const note = (t.suggested_note || '').split('|')[1] || '';
    problems.push({
      id: `zero-stock-${t.id}`,
      name: t.name,
      type: 'prep',
      station: t.category || '—',
      severity: 'yellow',
      problemType: 'zero-stock-large-suggestion',
      explanation: `Stock is ${t.current_stock === null ? 'NULL (bot skips)' : '0'}, bot suggests ${t.suggested_qty} ${t.unit}. Note: "${note}". Verify if this is real or a stock entry was missed.`,
      suggestedFix: t.current_stock === null
        ? 'Set current_stock to 0 (or real value) so the bot can include this task.'
        : 'Enter the real current_stock after the next inventory count.',
      detail: { prepTask: t },
    });
  });

  // B5: shelf_life_days >> expected_duration_days (big mismatch — recipe says "fine 30 days" but prep task says "use in 2")
  (prepTasks || []).filter(t => {
    if (!t.recipe_id) return false;
    const rec = recipeById[t.recipe_id];
    if (!rec) return false;
    const sl = rec.shelf_life_days;
    const ed = t.expected_duration_days;
    return sl && ed && sl > ed * 3 && sl > 10;
  }).forEach(t => {
    const rec = recipeById[t.recipe_id];
    problems.push({
      id: `shelf-mismatch-${t.id}`,
      name: t.name,
      type: 'prep',
      station: t.category || '—',
      severity: 'yellow',
      problemType: 'shelf-life-mismatch',
      explanation: `Recipe shelf_life_days=${rec.shelf_life_days}, but prep task expected_duration_days=${t.expected_duration_days}. Bot uses prep task — the recipe field may be stale/wrong.`,
      suggestedFix: 'Align recipe shelf_life_days with the real prep life (use the prep task expected_duration_days as truth).',
      detail: { prepTask: t, recipe: rec },
    });
  });

  // B6: missing min_cover_days on non-checklist preps with a recipe
  (prepTasks || []).filter(t =>
    t.recipe_id && t.prep_type !== 'checklist' && !t.min_cover_days
  ).forEach(t => {
    problems.push({
      id: `no-min-cover-${t.id}`,
      name: t.name,
      type: 'prep',
      station: t.category || '—',
      severity: 'yellow',
      problemType: 'missing-min-cover-days',
      explanation: 'No min_cover_days set — bot defaults to 2 days. Fresh proteins/pastry should be reviewed.',
      suggestedFix: 'Set min_cover_days: 1 for daily pasta, 2 for standard preps, 4–5 for longer batches.',
      detail: { prepTask: t },
    });
  });

  // B7: BOM row with unit = 'batch' or 'porzioni' (invalid units)
  const badUnits = new Set(['batch', 'porzioni', 'portion', 'portions']);
  (bom || []).filter(b => badUnits.has((b.unit || '').toLowerCase())).forEach(b => {
    const parent = recipeById[b.parent_recipe_id];
    const childRec = b.component_type === 'RECIPE' ? recipeById[b.sub_recipe_id] : null;
    const childIng = b.component_type === 'ITEM' ? ingById[b.item_id] : null;
    const childName = childRec?.title || childIng?.name || b.item_id || b.sub_recipe_id;
    problems.push({
      id: `bom-bad-unit-${b.bom_id}`,
      name: `${parent?.title || b.parent_recipe_id} → ${childName}`,
      type: 'subrecipe',
      station: '—',
      severity: 'yellow',
      problemType: 'stock-unit-mismatch',
      explanation: `BOM row unit="${b.unit}" is abstract. Bot cannot calculate grams from this. Quantity: ${b.quantity}.`,
      suggestedFix: 'Change unit to g, kg, pezzi, nests, or ml — something physically measurable.',
      detail: { bomRow: b, parentRecipe: parent, childName },
    });
  });

  // B8: alias points to a name that matches both an ingredient AND a recipe
  const recipeNames = new Set((recipes || []).map(r => r.title?.toLowerCase()).filter(Boolean));
  const ingNames = new Set((ingredients || []).map(i => i.name?.toLowerCase()).filter(Boolean));
  const collisions = [...recipeNames].filter(n => ingNames.has(n));
  collisions.forEach(name => {
    const rec = recipeByTitle[name];
    const ing = ingByName[name];
    problems.push({
      id: `name-collision-${name.replace(/\s+/g, '-')}`,
      name: name,
      type: 'recipe',
      station: '—',
      severity: 'red',
      problemType: 'alias-ingredient-recipe-collision',
      explanation: `"${name}" exists as both a Recipe (${rec?.id?.slice(0,8)}) and an Ingredient (${ing?.id?.slice(0,8)}). BOM rows linking either may be ambiguous.`,
      suggestedFix: 'Rename the ingredient (add "raw" prefix) or archive whichever is no longer used directly.',
      detail: { recipe: rec, ingredient: ing },
    });
  });

  // B9: Prep has bot suggestion (suggested_at within last 3 days) but suggested_qty is null or 0
  const threeDaysAgo = new Date(Date.now() - 3 * 864e5).toISOString();
  (prepTasks || []).filter(t =>
    t.suggested_at && t.suggested_at > threeDaysAgo &&
    (!t.suggested_qty || parseFloat(t.suggested_qty) === 0) &&
    t.prep_type !== 'checklist'
  ).forEach(t => {
    const note = (t.suggested_note || '').split('|')[1] || '';
    problems.push({
      id: `bot-zero-qty-${t.id}`,
      name: t.name,
      type: 'prep',
      station: t.category || '—',
      severity: 'yellow',
      problemType: 'bot-suggestion-zero-qty',
      explanation: `Bot ran recently but suggested_qty=0 or null. Note: "${note}". Could indicate zero sales in the window or mapping failure.`,
      suggestedFix: 'Check if POS name matches actual sales data. Review audit panel for this task.',
      detail: { prepTask: t },
    });
  });

  // Sort: red first, then yellow, then green
  const sevOrder = { red: 0, yellow: 1, green: 2 };
  problems.sort((a, b) => (sevOrder[a.severity] || 1) - (sevOrder[b.severity] || 1));

  return problems;
};

// ══════════════════════════════════════════════════════════════
// RENDER PROBLEMS VIEW
// ══════════════════════════════════════════════════════════════
window.renderMcrProblems = function (problems) {
  const panel = document.getElementById('mcrProblemsPanel');
  const countEl = document.getElementById('mcrProbCount');
  if (!panel) return;

  const red = problems.filter(p => p.severity === 'red').length;
  const yellow = problems.filter(p => p.severity === 'yellow').length;
  if (countEl) {
    countEl.innerHTML = problems.length
      ? `<span style="background:#7f1d1d;color:#fca5a5;padding:1px 7px;border-radius:20px;font-size:10px;font-weight:700;">${problems.length}</span>`
      : '';
  }

  const problemTypes = [...new Set(problems.map(p => p.problemType))];

  panel.innerHTML = `
    <!-- Filter bar -->
    <div class="mcr-filter-bar">
      <input class="mcr-search" id="mcrSearch" placeholder="Search…" oninput="mcrFilterProblems()" />
      <button class="mcr-filter-btn active" id="mcrFAll" onclick="mcrSetFilter('all')">All (${problems.length})</button>
      <button class="mcr-filter-btn" id="mcrFRed" onclick="mcrSetFilter('red')">🔴 Red (${red})</button>
      <button class="mcr-filter-btn" id="mcrFYellow" onclick="mcrSetFilter('yellow')">🟡 Yellow (${yellow})</button>
    </div>

    <!-- Header row -->
    <div class="mcr-header-row">
      <span>Item</span>
      <span>Type</span>
      <span>Station</span>
      <span>Severity</span>
      <span>Problem / Explanation</span>
      <span>Action</span>
    </div>

    <!-- Rows -->
    <div id="mcrProbRows">
      ${problems.map((p, idx) => renderMcrProbRow(p, idx)).join('')}
    </div>

    ${problems.length === 0 ? '<div style="color:#475569;padding:40px;text-align:center;">✅ No problems detected</div>' : ''}
  `;

  window._mcrActiveFilter = 'all';
};

function renderMcrProbRow(p, idx) {
  const sevPill = {
    red:    '<span class="mcr-pill mcr-pill-red">RED</span>',
    yellow: '<span class="mcr-pill mcr-pill-yellow">WARN</span>',
    green:  '<span class="mcr-pill mcr-pill-green">OK</span>',
  }[p.severity] || '';

  const typePill = `<span class="mcr-pill mcr-pill-blue">${p.type}</span>`;
  const probTypeLabel = (p.problemType || '').replace(/-/g, ' ');

  return `
    <div class="mcr-row" id="mcrRow-${idx}"
         data-severity="${p.severity}"
         data-search="${(p.name + ' ' + p.station + ' ' + p.problemType + ' ' + p.explanation).toLowerCase()}"
         onclick="mcrOpenDrawer(${idx})">
      <span style="font-weight:600;color:#f1f5f9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escH(p.name)}">${escH(p.name)}</span>
      <span>${typePill}</span>
      <span style="color:#94a3b8;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escH(p.station || '')}">${escH(p.station || '—')}</span>
      <span>${sevPill}</span>
      <span style="color:#94a3b8;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escH(p.explanation)}">
        <span style="color:#cbd5e1;font-weight:600;font-size:11px;">${escH(probTypeLabel)}</span><br>
        ${escH((p.explanation || '').slice(0, 90))}${(p.explanation || '').length > 90 ? '…' : ''}
      </span>
      <span>
        <button onclick="event.stopPropagation();mcrOpenDrawer(${idx})"
          style="padding:5px 12px;background:#1e3a5f;border:1px solid #3b82f6;border-radius:8px;
                 color:#93c5fd;font-size:12px;font-weight:600;cursor:pointer;">Review</button>
      </span>
    </div>`;
}

window._mcrActiveFilter = 'all';

window.mcrSetFilter = function (f) {
  window._mcrActiveFilter = f;
  ['All', 'Red', 'Yellow'].forEach(n => {
    const btn = document.getElementById('mcrF' + n);
    if (btn) btn.classList.toggle('active', f === n.toLowerCase() || (f === 'all' && n === 'All'));
  });
  mcrFilterProblems();
};

window.mcrFilterProblems = function () {
  const q = (document.getElementById('mcrSearch')?.value || '').toLowerCase().trim();
  const f = window._mcrActiveFilter || 'all';
  document.querySelectorAll('#mcrProbRows .mcr-row').forEach(row => {
    const sev = row.dataset.severity;
    const search = row.dataset.search || '';
    const sevMatch = f === 'all' || sev === f;
    const qMatch = !q || search.includes(q);
    row.style.display = sevMatch && qMatch ? '' : 'none';
  });
};

// ══════════════════════════════════════════════════════════════
// ITEM DETAIL DRAWER
// ══════════════════════════════════════════════════════════════
window.mcrOpenDrawer = function (idx) {
  const p = (window._mcrProblems || [])[idx];
  if (!p) return;

  // Highlight selected row
  document.querySelectorAll('#mcrProbRows .mcr-row').forEach(r => r.classList.remove('selected'));
  const row = document.getElementById('mcrRow-' + idx);
  if (row) row.classList.add('selected');

  const drawer = document.getElementById('mcrDrawer');
  if (!drawer) return;
  drawer.style.display = '';
  drawer.innerHTML = `<div style="color:#94a3b8;padding:40px;text-align:center;">Loading detail…</div>`;

  setTimeout(() => {
    drawer.innerHTML = buildDrawerHTML(p);
  }, 50);
};

function buildDrawerHTML(p) {
  const { prepTasks, recipes, ingredients, bom, posAliases, modifierConfig, posSales, posModifiers } = window._mcrData || {};
  const recipeById = Object.fromEntries((recipes || []).map(r => [r.id, r]));
  const ingById    = Object.fromEntries((ingredients || []).map(i => [i.id, i]));

  let html = `
    <!-- Drawer header -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
      <div>
        <div style="font-size:15px;font-weight:700;color:#f1f5f9;">${escH(p.name)}</div>
        <div style="font-size:11px;color:#64748b;margin-top:2px;">${escH(p.problemType?.replace(/-/g,' ') || '')}</div>
      </div>
      <button onclick="document.getElementById('mcrDrawer').style.display='none';document.querySelectorAll('.mcr-row').forEach(r=>r.classList.remove('selected'))"
        style="background:none;border:none;color:#475569;font-size:18px;cursor:pointer;flex-shrink:0;">✕</button>
    </div>`;

  // ── Problem Summary ──────────────────────────────────────────
  const sevColor = { red: '#ef4444', yellow: '#f59e0b', green: '#22c55e' }[p.severity] || '#94a3b8';
  html += `
    <div class="mcr-drawer-section" style="border-color:${sevColor}30;">
      <div class="mcr-drawer-label">⚠️ Problem</div>
      <div style="font-size:13px;color:#e2e8f0;line-height:1.55;margin-bottom:8px;">${escH(p.explanation)}</div>
      <div style="font-size:12px;color:#22c55e;line-height:1.5;"><strong>✅ Suggested fix:</strong> ${escH(p.suggestedFix)}</div>
    </div>`;

  // ── Bot output (from prep_task) ──────────────────────────────
  const pt = p.detail?.prepTask || null;
  const bomRows = (bom || []).filter(b => b.parent_recipe_id === (p.detail?.recipe?.id || pt?.recipe_id));

  if (pt) {
    const noteParts = (pt.suggested_note || '').split('|');
    const noteColor = noteParts[0] || '—';
    const noteIT    = noteParts[1] || '—';
    html += `
      <div class="mcr-drawer-section">
        <div class="mcr-drawer-label">🤖 Bot Output</div>
        <div class="mcr-kv"><span class="mcr-kv-k">Suggested qty</span><span class="mcr-kv-v">${pt.suggested_qty || '—'} ${pt.unit || ''}</span></div>
        <div class="mcr-kv"><span class="mcr-kv-k">Color</span><span class="mcr-kv-v">${escH(noteColor)}</span></div>
        <div class="mcr-kv"><span class="mcr-kv-k">Note (IT)</span><span class="mcr-kv-v">${escH(noteIT)}</span></div>
        <div class="mcr-kv"><span class="mcr-kv-k">Current stock</span><span class="mcr-kv-v">${pt.current_stock === null ? 'NULL ⚠' : pt.current_stock + ' ' + (pt.unit || '')}</span></div>
        <div class="mcr-kv"><span class="mcr-kv-k">Suggested at</span><span class="mcr-kv-v">${pt.suggested_at ? new Date(pt.suggested_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'}</span></div>
        <div class="mcr-kv"><span class="mcr-kv-k">prep_type</span><span class="mcr-kv-v">${pt.prep_type || '—'}</span></div>
        <div class="mcr-kv"><span class="mcr-kv-k">expected_duration_days</span><span class="mcr-kv-v">${pt.expected_duration_days || '—'}</span></div>
        <div class="mcr-kv"><span class="mcr-kv-k">min_cover_days</span><span class="mcr-kv-v">${pt.min_cover_days || '—'}</span></div>
      </div>`;
  }

  // ── Recipe info ──────────────────────────────────────────────
  const rec = p.detail?.recipe || (pt?.recipe_id ? recipeById[pt.recipe_id] : null);
  if (rec) {
    html += `
      <div class="mcr-drawer-section">
        <div class="mcr-drawer-label">📖 Recipe</div>
        <div class="mcr-kv"><span class="mcr-kv-k">Title</span><span class="mcr-kv-v">${escH(rec.title)}</span></div>
        <div class="mcr-kv"><span class="mcr-kv-k">POS name</span><span class="mcr-kv-v">${escH(rec.pos_name || '—')}</span></div>
        <div class="mcr-kv"><span class="mcr-kv-k">base_servings</span><span class="mcr-kv-v">${rec.base_servings || '—'}</span></div>
        <div class="mcr-kv"><span class="mcr-kv-k">base_weight_g</span><span class="mcr-kv-v">${rec.base_weight_g || '—'}</span></div>
        <div class="mcr-kv"><span class="mcr-kv-k">serving_weight_g</span><span class="mcr-kv-v">${rec.serving_weight_g || '—'}</span></div>
        <div class="mcr-kv"><span class="mcr-kv-k">shelf_life_days</span><span class="mcr-kv-v">${rec.shelf_life_days || '—'}</span></div>
        <div class="mcr-kv"><span class="mcr-kv-k">menu_group</span><span class="mcr-kv-v">${escH(rec.menu_group || '—')}</span></div>
        <div class="mcr-kv">
          <span class="mcr-kv-k">Recipe mode</span>
          <span class="mcr-kv-v" style="font-size:11px;padding:2px 6px;border-radius:6px;${rec.pos_name ? 'background:#1e3a8a;color:#bfdbfe;' : 'background:#1a3a2a;color:#86efac;'}">
            ${rec.pos_name ? '🛒 SOLD ITEM — BOM = 1 sale consumes' : '🔪 PREP/BATCH — BOM = batch recipe'}
          </span>
        </div>
      </div>`;

    // BOM
    if (bomRows.length > 0) {
      html += `<div class="mcr-drawer-section">
        <div class="mcr-drawer-label">🧱 Bill of Materials (${bomRows.length} rows)</div>`;
      bomRows.forEach(b => {
        const childRec = b.component_type === 'RECIPE' ? recipeById[b.sub_recipe_id] : null;
        const childIng = b.component_type === 'ITEM' ? ingById[b.item_id] : null;
        const childName = childRec?.title || childIng?.name || '?';
        const typeColor = b.component_type === 'RECIPE' ? '#6366f1' : '#0ea5e9';
        html += `<div class="mcr-bom-row">
          <span style="font-size:12px;color:#e2e8f0;">${escH(childName)}</span>
          <span style="font-size:11px;color:${typeColor};font-weight:600;">${b.quantity} ${escH(b.unit || '')} · ${b.component_type}</span>
        </div>`;
      });
      html += `</div>`;
    }
  }

  // ── Ingredient duplicates ────────────────────────────────────
  if (p.detail?.ingredients && p.detail.ingredients.length > 1) {
    html += `<div class="mcr-drawer-section">
      <div class="mcr-drawer-label">🧪 Ingredients in this group</div>`;
    p.detail.ingredients.forEach(i => {
      html += `<div class="mcr-kv">
        <span class="mcr-kv-k">${escH(i.name)}</span>
        <span class="mcr-kv-v">${i.category || '—'} · ${i.measure_type || '—'}</span>
      </div>`;
    });
    html += `</div>`;
  }

  // ── BOM conflicts ────────────────────────────────────────────
  if (p.detail?.conflictingBOMs?.length > 0) {
    html += `<div class="mcr-drawer-section" style="border-color:#ef444430;">
      <div class="mcr-drawer-label" style="color:#f87171;">🔴 BOM Conflicts</div>`;
    p.detail.conflictingBOMs.forEach(c => {
      html += `<div style="font-size:12px;color:#fca5a5;padding:3px 0;">${escH(c)}</div>`;
    });
    html += `</div>`;
  }

  // ── POS Sales (last 30d) — for recipes with pos_name ─────────
  if (rec?.pos_name) {
    const aliases = rec.pos_name.split('|').filter(Boolean);
    const salesRows = [];
    (posSales || []).forEach(s => {
      if (aliases.some(a => s.menu_item?.toLowerCase().includes(a.toLowerCase()))) {
        salesRows.push(s);
      }
    });
    const totalSold = salesRows.reduce((acc, s) => acc + (s.quantity || 0), 0);
    html += `<div class="mcr-drawer-section">
      <div class="mcr-drawer-label">💰 POS Sales — last 30d</div>
      <div class="mcr-kv"><span class="mcr-kv-k">Total portions</span><span class="mcr-kv-v">${totalSold}</span></div>
      <div class="mcr-kv"><span class="mcr-kv-k">Aliases checked</span><span class="mcr-kv-v" style="font-size:11px;">${escH(aliases.join(', '))}</span></div>
    </div>`;
  }

  // ── Phase 2 placeholder ──────────────────────────────────────
  html += `
    <div class="mcr-drawer-section" style="border-style:dashed;border-color:#334155;background:#0f172a;">
      <div class="mcr-drawer-label" style="color:#334155;">✏️ Edit / Save — Phase 2</div>
      <div style="font-size:12px;color:#334155;">Inline editing with before/after diff and audit log will be enabled in Phase 2.</div>
    </div>`;

  return html;
}

// ── Utility ──────────────────────────────────────────────────
function escH(str) {
  return (str || '').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
