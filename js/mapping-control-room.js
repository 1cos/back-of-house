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
  const mcrIsMobile = () => window.innerWidth <= 768;
  modal.style.cssText = [
    'position:fixed;z-index:351;',
    'background:#0f172a;',
    'display:flex;flex-direction:column;overflow:hidden;',
    'box-shadow:0 32px 80px rgba(0,0,0,0.6);',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
  ].join('');
  function mcrApplyModalSize() {
    if (mcrIsMobile()) {
      modal.style.inset = '0';
      modal.style.borderRadius = '0';
    } else {
      modal.style.inset = '12px';
      modal.style.borderRadius = '20px';
    }
  }
  mcrApplyModalSize();
  window.addEventListener('resize', mcrApplyModalSize);
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

      <!-- RIGHT: Item Detail Drawer (desktop) / Bottom Sheet (mobile) -->
      <div id="mcrDrawer"
        style="width:420px;flex-shrink:0;background:#0b1628;border-left:1px solid #1e293b;
               overflow-y:auto;-webkit-overflow-scrolling:touch;display:none;padding:16px;">
      </div>

      <!-- MOBILE BOTTOM SHEET -->
      <div id="mcrBottomSheet"
        style="display:none;position:fixed;bottom:0;left:0;right:0;z-index:500;
               background:#0b1628;border-radius:20px 20px 0 0;
               border-top:1px solid #1e293b;max-height:80vh;
               overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 16px 32px;
               box-shadow:0 -8px 40px rgba(0,0,0,0.5);
               animation:mcrSlideUp .25s ease;">
        <div style="width:40px;height:4px;background:#334155;border-radius:2px;margin:12px auto 14px;"></div>
        <div id="mcrBottomSheetContent"></div>
      </div>
      <div id="mcrBottomSheetOverlay"
        style="display:none;position:fixed;inset:0;z-index:499;background:rgba(0,0,0,0.4);"
        onclick="mcrCloseBottomSheet()"></div>
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

      @keyframes mcrSlideUp {
        from { transform: translateY(100%); opacity:0; }
        to   { transform: translateY(0);    opacity:1; }
      }

      @media (max-width: 768px) {
        .mcr-header-row { display:none !important; }
        .mcr-row {
          grid-template-columns: 1fr auto !important;
          grid-template-rows: auto auto auto;
          gap:4px !important;
          padding:12px 14px !important;
        }
        .mcr-row-name    { grid-column:1; grid-row:1; font-size:14px !important; }
        .mcr-row-type    { grid-column:2; grid-row:1; }
        .mcr-row-station { grid-column:1; grid-row:2; }
        .mcr-row-sev     { grid-column:2; grid-row:2; }
        .mcr-row-expl    { grid-column:1 / span 2; grid-row:3; font-size:11px; color:#64748b; }
        .mcr-row-btn     { display:none !important; }
        .mcr-filter-bar  { flex-wrap:nowrap; overflow-x:auto; padding-bottom:4px; }
        .mcr-filter-btn  { flex-shrink:0; }
        .mcr-search      { min-width:100px; }
        #mcrTabGrid      { display:none !important; }
      }
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

// ── Refresh ───────────────────────────────────────────────────
window.mcrRefresh = async function () {
  // Full state reset: data, problems, plan, drawer, selection
  window._mcrData               = null;
  window._mcrProblems           = [];
  window._mcrPendingPlan        = [];
  window._mcrDrawerIdx          = null;
  window._mcrOQRState           = { step: 'info', answers: {} };
  window._mcrActiveProtocol     = null;
  window._mcrConversionResolved = null;

  // Close and clear drawer
  const drawer = document.getElementById('mcrDrawer');
  if (drawer) { drawer.style.display = 'none'; drawer.innerHTML = ''; }

  // Deselect all rows
  document.querySelectorAll('#mcrProbRows .mcr-row').forEach(r => r.classList.remove('selected'));

  const sub = document.getElementById('mcrSubtitle');
  if (sub) sub.textContent = 'Refreshing…';

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
// Each query is wrapped individually so a single failure never
// empties critical tables (recipe_bom, recipes) that drive detection.
window.mcrLoadAndRender = async function () {
  const sb = window.supa;
  const sub = document.getElementById('mcrSubtitle');
  if (sub) sub.textContent = 'Loading audit data…';

  try {
    // Wrap each query: on error log and return [] so detection still runs
    async function q(label, promise) {
      const { data, error } = await promise;
      if (error) console.error('[MCR] query error —', label, ':', error.message || error);
      return data || [];
    }

    const cutoff = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);

    // recipe_bom: PostgREST hard cap is 1000 rows. DB has 1284+ rows.
    // Split into two queries (pos-recipes BOM ≈640 rows, prep-recipes BOM ≈644 rows)
    // to guarantee all rows are fetched regardless of ordering.
    const BOM_SELECT = 'bom_id,parent_recipe_id,component_type,item_id,sub_recipe_id,quantity,unit,notes';
    const [prepTasks, recipes, ingredients, bomPos, bomPrep, posAliases, modifierConfig, posSales, posModifiers] =
      await Promise.all([
        q('prep_tasks',        sb.from('prep_tasks').select('id,name,category,prep_type,unit,current_stock,suggested_qty,suggested_note,suggested_at,recipe_id,ingredient_id,expected_duration_days,min_cover_days,archived').eq('archived', false).limit(500)),
        q('recipes',           sb.from('recipes').select('id,title,pos_name,menu_group,category,base_weight_g,base_servings,serving_weight_g,serving_unit,serving_qty,shelf_life_days,food_cost_pct,selling_price,ingredients').limit(500)),
        q('ingredients',       sb.from('ingredients').select('id,name,category,measure_type,active').eq('active', true).limit(500)),
        // BOM split 1: recipes with pos_name (sold items) — ~640 rows
        q('recipe_bom_pos',    sb.from('recipe_bom').select(BOM_SELECT)
            .in('parent_recipe_id',
              (await sb.from('recipes').select('id').not('pos_name', 'is', null).limit(200)).data?.map(r => r.id) || []
            ).limit(1000)),
        // BOM split 2: recipes without pos_name (prep/sub-recipes) — ~644 rows
        q('recipe_bom_prep',   sb.from('recipe_bom').select(BOM_SELECT)
            .in('parent_recipe_id',
              (await sb.from('recipes').select('id').is('pos_name', null).limit(500)).data?.map(r => r.id) || []
            ).limit(1000)),
        q('pos_item_aliases',  sb.from('pos_item_aliases').select('*').limit(200)),
        q('modifier_config',   sb.from('modifier_config').select('*').limit(200)),
        q('pos_sales_by_item', sb.from('pos_sales_by_item').select('menu_item,quantity,sale_date').gte('sale_date', cutoff).limit(1000)),
        q('pos_modifiers',     sb.from('pos_modifiers').select('modifier,quantity_sold,sale_date').gte('sale_date', cutoff).limit(1000)),
      ]);
    // Merge BOM arrays — both halves together = complete recipe_bom
    const bom = [...bomPos, ...bomPrep];

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
    modSales[m.modifier] = (modSales[m.modifier] || 0) + (m.quantity_sold || 0);
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

  // ── B: Production Profile checks ─────────────────────────────
  //
  // Each recipe/prep gets a production profile with 4 axes:
  //
  //  production_constraint:
  //    sold_item       — has pos_name, served to order
  //    free_quantity   — no minimum unit, bot suggests exact weight
  //    minimum_unit    — must be made in full kitchen units (can/gallon/tray/pot)
  //    portioned_unit  — produces fixed pieces/slices/portions
  //
  //  yield_behavior:
  //    sum_ingredients    — yield ≈ sum of ingredient weights
  //    manual_final_yield — chef measures yield manually
  //    reduction          — cooking reduces yield (sauces, demi, ragù)
  //    growth_absorption  — cooking increases yield (polenta, risotto)
  //    portion_count      — output counted in pieces/slices/portions
  //
  //  control_unit: g / kg / each / slice / piece / tray / gallon / can / recipe
  //
  //  rounding_rule:
  //    none                   — bot can suggest exact weight
  //    round_to_minimum_unit  — bot rounds up to gallon/can/tray/full recipe
  //    round_to_portion_count — bot rounds to slices/pieces/portions
  //    round_to_container     — bot rounds to container size
  //
  // Classification is heuristic from existing DB fields (no new columns).
  // Purpose: surface the RIGHT warning per profile, not a generic "missing batch weight".

  // ── Profile classifier ────────────────────────────────────────
  function classifyPrepProfile(rec, prepTask, bomRows) {
    const n = (rec?.title || prepTask?.name || '').toLowerCase();
    const su = (rec?.serving_unit || prepTask?.unit || '').toLowerCase();

    // production_constraint
    let production_constraint;
    if (rec?.pos_name) {
      production_constraint = 'sold_item';
    } else if (
      su === 'slice' || su === 'slices' || su === 'piece' || su === 'pezzi' ||
      su === 'each' || su === 'pz' ||
      (rec?.serving_qty && rec?.serving_unit && ['slice','piece','pezzi','each','pz'].includes(su))
    ) {
      production_constraint = 'portioned_unit';
    } else if (
      n.includes('sauce') || n.includes('dressing') || n.includes('demi') ||
      n.includes('ragu') || n.includes('ragù') || n.includes('soup') ||
      n.includes('broth') || n.includes('oil') || n.includes('glaze') ||
      n.includes('cacio') || n.includes('arrabbiata') || n.includes('béchamel') ||
      n.includes('bechamel') || n.includes('pesto') || n.includes('cream') ||
      n.includes('tiramisu') || n.includes('cheesecake') || n.includes('cake') ||
      n.includes('bavarese') || n.includes('crème') || n.includes('creme') ||
      n.includes('brulee') || n.includes('panna') || n.includes('mousse') ||
      (rec?.base_servings && rec?.base_weight_g)
    ) {
      production_constraint = 'minimum_unit';
    } else {
      production_constraint = 'free_quantity';
    }

    // yield_behavior
    let yield_behavior;
    if (production_constraint === 'sold_item') {
      yield_behavior = 'sum_ingredients'; // per-sale BOM drawdown
    } else if (production_constraint === 'portioned_unit') {
      yield_behavior = 'portion_count';
    } else if (
      n.includes('demi') || n.includes('reduction') ||
      n.includes('ragu') || n.includes('ragù') ||
      n.includes('tomato sauce') || n.includes('pomodoro') ||
      n.includes('broth') || n.includes('stock')
    ) {
      yield_behavior = 'reduction';
    } else if (
      n.includes('polenta') || n.includes('risotto') || n.includes('rice')
    ) {
      yield_behavior = 'growth_absorption';
    } else if (rec?.base_weight_g) {
      yield_behavior = 'manual_final_yield';
    } else {
      yield_behavior = 'sum_ingredients';
    }

    // control_unit
    let control_unit = rec?.serving_unit || prepTask?.unit || 'g';
    if (control_unit === 'pezzi') control_unit = 'piece';
    if (control_unit === 'nests') control_unit = 'nests';

    // rounding_rule
    let rounding_rule;
    if (production_constraint === 'sold_item') {
      rounding_rule = 'none';
    } else if (production_constraint === 'portioned_unit') {
      rounding_rule = 'round_to_portion_count';
    } else if (production_constraint === 'minimum_unit') {
      rounding_rule = 'round_to_minimum_unit';
    } else {
      rounding_rule = 'none';
    }

    return { production_constraint, yield_behavior, control_unit, rounding_rule };
  }

  // ── B1: SOLD ITEM — check BOTH structured BOM and legacy ingredients ───
  //
  // Three cases for a sold item (has pos_name):
  //
  //  A) structured recipe_bom rows exist and are complete
  //     → NO warning. "OK — 1 vendita scarica questi componenti."
  //
  //  B) NO structured BOM, but legacy ingredients JSONB is populated
  //     → YELLOW. "Ingredienti presenti nell'editor, ma non ancora migrati nel BOM strutturato."
  //     → NOT red — the recipe data exists, just in the wrong place.
  //
  //  C) NO structured BOM and NO legacy ingredients
  //     → RED. "Questo piatto si vende al POS, ma manca cosa scaricare per 1 vendita."
  //
  // Legacy ingredients = recipes.ingredients (JSONB array, free format, used by recipe editor).
  // Structured BOM    = recipe_bom rows with component_type ITEM/RECIPE + linked ids.

  // Helper: parse legacy ingredients JSONB → array of {name, qty, unit}
  // ONLY used when recipe_bom rows = 0. If structured BOM exists, this is never called.
  // recipes.ingredients JSONB is legacy fallback only — recipe_bom is the single source of truth.
  function parseLegacyIngredients(rec) {
    const raw = rec.ingredients;
    if (!raw) return [];
    // JSONB can arrive as array or string
    let arr;
    if (Array.isArray(raw)) {
      arr = raw;
    } else if (typeof raw === 'string') {
      try { arr = JSON.parse(raw); } catch { return []; }
    } else if (typeof raw === 'object') {
      // Sometimes Supabase returns an object — treat as single item or array wrapper
      arr = Array.isArray(raw) ? raw : [raw];
    } else {
      return [];
    }
    return arr.filter(i => i && (i.name || i.ingredient || i.item || i.text));
  }

  // ── SOURCE-OF-TRUTH RULE ──────────────────────────────────────────────────
  // recipe_bom = authoritative. recipes.ingredients JSONB = legacy fallback only.
  //
  // Three cases (evaluated in order):
  //
  //  A) recipe_bom rows exist (≥ 1)
  //     → recipe_bom is the truth. recipes.ingredients IGNORED entirely.
  //     → If all rows complete: no warning (recipe OK).
  //     → If some rows incomplete (missing qty/unit/link): YELLOW on those rows only.
  //     → NEVER show a "legacy ingredients" panel. NEVER build a conversion plan.
  //
  //  B) recipe_bom rows = 0 AND recipes.ingredients has rows
  //     → Legacy path: migration needed.
  //     → Show "legacy ingredients need migration" warning + allow conversion plan.
  //
  //  C) recipe_bom rows = 0 AND recipes.ingredients = [] or null
  //     → Truly missing. RED warning.
  //
  (recipes || []).filter(r => r.pos_name).forEach(r => {
    const structuredRows = bomByParent[r.id] || [];
    const hasStructured = structuredRows.length > 0;

    if (hasStructured) {
      // Case A: recipe_bom is the source of truth. Ignore recipes.ingredients entirely.
      const incompleteRows = structuredRows.filter(b =>
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
          explanation: `Piatto venduto con ${structuredRows.length} righe BOM, ma ${incompleteRows.length} incomplete (mancano qty, unit o link). Il bot potrebbe sotto-calcolare il consumo.`,
          suggestedFix: 'Completa ogni riga BOM: qty > 0, unit, collegamento a ingrediente o sottoricetta.',
          detail: {
            recipe: r,
            profile: classifyPrepProfile(r, null, structuredRows),
            bomRows: structuredRows,
            incompleteRows,
            legacyIngredients: [], // never expose legacy when BOM exists
          },
        });
      }
      // Complete structured BOM → no warning. recipe_bom is correct.
      return;
    }

    // No structured BOM — now check legacy JSONB (fallback path only)
    const legacyIngredients = parseLegacyIngredients(r);
    const hasLegacy = legacyIngredients.length > 0;

    if (hasLegacy) {
      // Case B: legacy ingredients present, not yet migrated to recipe_bom
      problems.push({
        id: `sold-legacy-bom-${r.id}`,
        name: r.title,
        type: 'recipe',
        station: r.menu_group || '—',
        severity: 'yellow',
        problemType: 'sold-item-legacy-ingredients',
        explanation: `Ingredienti presenti nell'editor (${legacyIngredients.length} voci), ma non ancora migrati nel BOM strutturato. Il bot non può calcolare il consumo finché non sono migrati.`,
        suggestedFix: 'Converti gli ingredienti legacy in righe BOM strutturate nel Recipe Editor → scheda Ingredients.',
        detail: {
          recipe: r,
          profile: classifyPrepProfile(r, null, []),
          bomRows: [],
          legacyIngredients,
        },
      });
      return;
    }

    // Case C: no structured BOM and no legacy ingredients → truly missing
    problems.push({
      id: `sold-no-bom-${r.id}`,
      name: r.title,
      type: 'recipe',
      station: r.menu_group || '—',
      severity: 'red',
      problemType: 'sold-item-missing-bom',
      explanation: `Questo piatto si vende al POS, ma manca cosa scaricare per 1 vendita. POS: "${r.pos_name}". Né BOM strutturato né ingredienti legacy trovati.`,
      suggestedFix: 'Aggiungi ingredienti nel Recipe Editor e poi migra in BOM strutturato.',
      detail: {
        recipe: r,
        profile: classifyPrepProfile(r, null, []),
        bomRows: [],
        legacyIngredients: [],
      },
    });
  });

  // ── B2: PREP — production profile warnings ────────────────────
  // For each prep task with a recipe (non-checklist, non-sold-item recipe),
  // classify its production profile and surface the specific missing data.
  (prepTasks || []).filter(t => {
    if (!t.recipe_id) return false;
    if (t.prep_type === 'checklist') return false;
    const rec = recipeById[t.recipe_id];
    return rec && !rec.pos_name; // pure prep recipe
  }).forEach(t => {
    const rec = recipeById[t.recipe_id];
    const rows = bomByParent[rec.id] || [];
    const profile = classifyPrepProfile(rec, t, rows);

    if (profile.production_constraint === 'minimum_unit') {
      // Case D: minimum_unit — needs final yield defined
      const hasYield = rec.base_weight_g || rec.serving_weight_g;
      if (!hasYield) {
        problems.push({
          id: `min-unit-no-yield-${t.id}`,
          name: t.name,
          type: 'prep',
          station: t.category || '—',
          severity: 'yellow',
          problemType: 'minimum-unit-missing-final-yield',
          explanation: `Manca la resa finale dell'unità minima. "${rec.title}" si prepara per unità minima di cucina (pentola/latta/teglia/ricetta intera) ma non è definito quanto produce in grammi.`,
          suggestedFix: 'Imposta base_weight_g (grammi totali del batch) + base_servings sulla ricetta.',
          detail: { prepTask: t, recipe: rec, profile, bomRows: rows },
        });
      }
      // If has reduction behavior AND no final yield either → escalate
      if (profile.yield_behavior === 'reduction' && !hasYield) {
        // Already caught above — no duplicate
      } else if (profile.yield_behavior === 'reduction' && hasYield) {
        // Fine — yield is defined despite reduction
      }
    }

    if (profile.production_constraint === 'minimum_unit' && profile.yield_behavior === 'reduction') {
      // Case E: reduction — verify final yield is truly usable yield (not just ingredient sum)
      const hasYield = rec.base_weight_g || rec.serving_weight_g;
      if (!hasYield) {
        // Already caught in D above — skip duplicate
      } else {
        // Has yield, but flag that reduction means it should be measured, not estimated
        // Only flag if no base_weight_g (serving_weight_g alone is not enough for reduction preps)
        if (!rec.base_weight_g) {
          problems.push({
            id: `reduction-no-base-weight-${t.id}`,
            name: t.name,
            type: 'prep',
            station: t.category || '—',
            severity: 'yellow',
            problemType: 'reduction-missing-final-yield',
            explanation: `Questa prep riduce in cottura: manca la resa finale utilizzabile. "${rec.title}" ha solo serving_weight_g ma non base_weight_g — il bot non sa quanti batch interi produrre.`,
            suggestedFix: 'Imposta base_weight_g (grammi totali del batch cotto/ridotto, non la somma ingredienti crudi).',
            detail: { prepTask: t, recipe: rec, profile, bomRows: rows },
          });
        }
      }
    }

    if (profile.production_constraint === 'portioned_unit') {
      // Case F: portioned_unit — needs portion count
      const hasPortions = rec.base_servings && rec.serving_qty;
      if (!hasPortions) {
        problems.push({
          id: `portioned-no-count-${t.id}`,
          name: t.name,
          type: 'prep',
          station: t.category || '—',
          severity: 'yellow',
          problemType: 'portioned-unit-missing-portion-count',
          explanation: `Questa ricetta è porzionata, ma manca quante porzioni/fette/pezzi produce. "${rec.title}" usa serving_unit="${rec.serving_unit || '?'}" ma non ha base_servings o serving_qty.`,
          suggestedFix: 'Imposta base_servings (quante porzioni produce un batch intero) e serving_qty (pezzi per porzione).',
          detail: { prepTask: t, recipe: rec, profile, bomRows: rows },
        });
      }
    }

    // Case C: free_quantity → no warning needed
    // The bot can suggest exact weight. No minimum unit. No portion count.
  });

  // ── B2b: SUBRECIPE — used in BOM but no yield defined ────────
  const subRecipeIds = new Set(
    (bom || [])
      .filter(b => b.component_type === 'RECIPE' && b.sub_recipe_id)
      .map(b => b.sub_recipe_id)
  );
  subRecipeIds.forEach(rid => {
    const rec = recipeById[rid];
    if (!rec || rec.pos_name) return; // sold items handled in B1
    const hasYield = rec.base_weight_g || rec.serving_weight_g;
    if (!hasYield) {
      const hasLinkedPrep = (prepTasks || []).some(t => t.recipe_id === rid && t.prep_type !== 'checklist');
      if (!hasLinkedPrep) {
        const parentBomRows = (bom || []).filter(b => b.sub_recipe_id === rid);
        const profile = classifyPrepProfile(rec, null, parentBomRows);
        problems.push({
          id: `subrecipe-no-yield-${rid}`,
          name: rec.title,
          type: 'subrecipe',
          station: rec.menu_group || '—',
          severity: 'yellow',
          problemType: 'subrecipe-missing-yield',
          explanation: `Sottoricetta usata in ${parentBomRows.length} BOM ma senza resa definita (base_weight_g o serving_weight_g mancanti). Il bot non riesce a calcolare i grammi consumati per vendita.`,
          suggestedFix: 'Imposta serving_weight_g (grammi di questa sottoricetta per porzione del piatto padre) o base_weight_g + base_servings.',
          detail: { recipe: rec, profile, usedInBomCount: parentBomRows.length },
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
// FEATURE FLAG — WRITE SAFETY GATE
// ══════════════════════════════════════════════════════════════
// ALL DB writes in this file are gated behind this flag.
// Set to true ONLY after explicit approval by Chef Max in a
// dedicated session with a complete DB Write Plan review.
// Default: false — no Supabase insert/update/delete can run.
const MAPPING_WRITE_ENABLED = false;

// ══════════════════════════════════════════════════════════════
// ITEM DETAIL DRAWER — Chef AI OQR + Write Plan
// ══════════════════════════════════════════════════════════════

window.mcrCloseBottomSheet = function() {
  const bs  = document.getElementById('mcrBottomSheet');
  const bso = document.getElementById('mcrBottomSheetOverlay');
  if (bs)  bs.style.display  = 'none';
  if (bso) bso.style.display = 'none';
  document.querySelectorAll('#mcrProbRows .mcr-row').forEach(r => r.classList.remove('selected'));
};

window.mcrOpenDrawer = function (idx) {
  const p = (window._mcrProblems || [])[idx];
  if (!p) return;

  document.querySelectorAll('#mcrProbRows .mcr-row').forEach(r => r.classList.remove('selected'));
  const row = document.getElementById('mcrRow-' + idx);
  if (row) row.classList.add('selected');

  window._mcrDrawerIdx = idx;
  window._mcrOQRState  = { step: 'info', answers: {} };

  if (window.innerWidth <= 768) {
    const bs  = document.getElementById('mcrBottomSheet');
    const bso = document.getElementById('mcrBottomSheetOverlay');
    const bsc = document.getElementById('mcrBottomSheetContent');
    if (!bs || !bsc) return;
    bsc.innerHTML = '<div style="color:#94a3b8;padding:20px;text-align:center;font-size:13px;">Caricamento…</div>';
    bs.style.display  = '';
    bso.style.display = '';
    bs.scrollTop = 0;
    setTimeout(() => { bsc.innerHTML = buildDrawerHTML(p); }, 40);
  } else {
    const drawer = document.getElementById('mcrDrawer');
    if (!drawer) return;
    drawer.style.display = '';
    drawer.innerHTML = '<div style="color:#94a3b8;padding:40px;text-align:center;font-size:13px;">Caricamento…</div>';
    setTimeout(() => { drawer.innerHTML = buildDrawerHTML(p); }, 40);
  }
};

// ── Chef-language field label map ──────────────────────────────
const MCR_FIELD_LABELS = {
  base_weight_g:    'Peso totale ricetta / batch',
  serving_weight_g: 'Grammi usati per porzione',
  base_servings:    'Quante porzioni produce',
  serving_qty:      'Scarico bot per vendita (quantità)',
  serving_unit:     'Scarico bot per vendita (unità)',
  pos_name:         'Nome POS collegato',
  shelf_life_days:  'Durata in frigo (giorni)',
  menu_group:       'Categoria menu',
  prep_type:        'Tipo preparazione',
  expected_duration_days: 'Durata attesa dopo prep (giorni)',
  min_cover_days:   'Giorni minimi di copertura',
  current_stock:    'Stock attuale',
  unit:             'Unità di misura stock',
};
function fieldLabel(key) { return MCR_FIELD_LABELS[key] || key; }

// ── Severity color ─────────────────────────────────────────────
function sevColor(sev) {
  return { red: '#ef4444', yellow: '#f59e0b', green: '#22c55e' }[sev] || '#64748b';
}

// ── Human-readable problem type ────────────────────────────────
const MCR_PROB_LABELS = {
  'sold-item-missing-bom':         '🛒 Piatto POS — nessun componente scaricato per vendita',
  'sold-item-legacy-ingredients':  '📝 Ingredienti nell\'editor non ancora migrati in BOM',
  'sold-item-incomplete-bom':      '⚠️ BOM incompleto — righe senza link o quantità',
  'prep-missing-batch-yield':      '⚖️ Prep senza resa batch definita',
  'minimum-unit-missing-final-yield': '🪣 Unità minima senza resa finale',
  'reduction-missing-final-yield': '🔥 Riduzione in cottura — manca resa finale',
  'portioned-unit-missing-portion-count': '🍰 Porzionata — manca numero porzioni',
  'subrecipe-missing-yield':       '🔗 Sottoricetta senza resa per porzione',
  'prep-no-trusted-mapping':       '❓ Prep senza collegamento ricetta/ingrediente',
  'bot-huge-suggestion':           '🤖 Suggerimento bot anomalo',
  'bot-suggestion-zero-qty':       '🤖 Bot ha girato ma suggerito 0',
  'zero-stock-large-suggestion':   '📦 Stock zero con suggerimento alto',
  'shelf-life-mismatch':           '📅 Shelf life disallineata tra ricetta e prep',
  'missing-min-cover-days':        '📅 min_cover_days non impostato',
  'stock-unit-mismatch':           '⚖️ Unità BOM astratta (batch/porzioni)',
  'alias-ingredient-recipe-collision': '🔁 Nome duplicato: ricetta E ingrediente',
  'ingredient-name-collision':     '🧪 Ingredienti con nomi sovrapposti',
  'missing-modifier-alias':        '🔌 Alias modifier mancanti',
  'recipe-used-as-ingredient':     '🔗 Ricetta usata come ingrediente grezzo',
};
function probLabel(type) { return MCR_PROB_LABELS[type] || type?.replace(/-/g,' ') || '—'; }

// ══════════════════════════════════════════════════════════════
// CHEF AI RESOLVE PROTOCOL — generic engine for every MCR problem
// Every problem maps to exactly one state:
//   SAFE_AUTO_PLAN   — deterministic write, show plan directly
//   NEED_ONE_ANSWER  — one question → plan
//   NEED_MANUAL_LINK — multiple candidates → selection → plan
//   NO_SAVE_TARGET   — fix understood, no safe DB target yet
// ══════════════════════════════════════════════════════════════

function mcrBotImpact(field) {
  const impacts = {
    base_weight_g:           "Bot suggerisce quantità in kg/batch invece di numero astratto",
    serving_weight_g:        "Bot scarica grammi corretti per ogni vendita",
    base_servings:           "Bot arrotonda a porzioni intere nella preplist",
    unit:                    "Unità visualizzata sulle card corrisponde al conteggio fisico",
    min_cover_days:          "Bot non suggerisce prep quando lo stock copre i giorni richiesti",
    expected_duration_days:  "Bot calcola la finestra di consumo correttamente",
    pos_name:                "Bot abbina le vendite POS a questa ricetta per scaricare stock",
    recipe_id:               "Bot trova il percorso di calcolo per questa prep task",
    ingredient_id:           "Bot usa prezzo e conversion corretti per il food cost",
    current_stock:           "Bot include questa prep nei calcoli notturni",
  };
  return impacts[field] || "Impatto sul bot dipende dal contesto";
}

function mcrResolveProtocol(p) {
  const pt  = p.problemType;
  const det = p.detail || {};
  const rec = det.recipe || null;
  const pt_ = det.prepTask || null;

  if (pt === "sold-item-incomplete-bom") {
    const incomplete = det.incompleteRows || [];
    return {
      state: "SAFE_AUTO_PLAN",
      plan: incomplete.map(function(b) {
        return {
          action:    "UPDATE",
          table:     "recipe_bom",
          row_id:    b.bom_id,
          field:     !b.quantity ? "quantity" : !b.unit ? "unit" : "item_id/sub_recipe_id",
          old_value: null,
          new_value: "(da impostare nel Recipe Editor)",
          reason:    "Riga BOM incompleta — bot non calcola il consumo per questa voce",
          confidence:"needs_chef_input",
          botImpact: mcrBotImpact("serving_weight_g"),
        };
      }),
      editorAction: { label: "Apri Recipe Editor per completare il BOM", recipeId: rec && rec.id },
    };
  }

  if (pt === "sold-item-missing-bom") {
    return {
      state:    "NEED_ONE_ANSWER",
      question: "Chef, \"" + escH(rec && rec.title || p.name) + "\" si vende al POS ma il bot non sa cosa scaricare. Come mai?",
      options:  [
        { value: "has_legacy",    label: "Ha ingredienti nell'editor — vanno migrati in BOM" },
        { value: "modifier_only", label: "Si vende solo come modifier — non serve BOM diretto" },
        { value: "new_recipe",    label: "Nuova ricetta — devo aggiungere gli ingredienti" },
      ],
      buildPlan: function(answers) {
        if (answers.choice === "modifier_only") return [{
          action:    "UPDATE",
          table:     "recipes",
          row_id:    rec && rec.id,
          field:     "pos_name",
          old_value: rec && rec.pos_name,
          new_value: "(rimuovere se venduto solo come modifier)",
          reason:    "Piatto venduto solo come modifier — il BOM va sulla ricetta principale",
          confidence:"needs_chef_confirmation",
          botImpact: mcrBotImpact("pos_name"),
        }];
        return [];
      },
      editorAction: { label: "Apri Recipe Editor per aggiungere ingredienti", recipeId: rec && rec.id },
    };
  }

  if (pt === "prep-missing-batch-yield") {
    return {
      state:    "NEED_ONE_ANSWER",
      question: "Chef, \"" + escH((rec && rec.title) || (pt_ && pt_.name)) + "\" non ha il peso totale del batch. Quanto produce un batch intero?",
      options:  [
        { value: "set_weight",  label: "Imposto grammi totali del batch" },
        { value: "free_weight", label: "Libera a peso — nessun batch fisso" },
      ],
      buildPlan: function(answers) {
        if (answers.choice !== "set_weight" || !answers.base_weight_g) return [];
        return [{ action:"UPDATE", table:"recipes", row_id: rec && rec.id, field:"base_weight_g",
          old_value: rec && rec.base_weight_g != null ? rec.base_weight_g : null,
          new_value: parseFloat(answers.base_weight_g),
          reason: "Peso batch — bot suggerisce kg/batch invece di quantità astratte",
          confidence:"chef_confirmed", botImpact: mcrBotImpact("base_weight_g") }];
      },
      followUp: function(choice) {
        return choice === "set_weight" ? { field:"base_weight_g", label:"Grammi totali del batch finito", type:"number", placeholder:"es. 3200" } : null;
      },
    };
  }

  if (pt === "minimum-unit-missing-final-yield") {
    return {
      state:    "NEED_ONE_ANSWER",
      question: "Chef, \"" + escH((rec && rec.title) || (pt_ && pt_.name)) + "\" si fa per unita minima (pentola/latta/teglia). Quanto pesa il risultato finale?",
      options:  [
        { value: "set_weight", label: "Imposto grammi finali (dopo cottura)" },
        { value: "skip",       label: "Lascia per ora" },
      ],
      buildPlan: function(answers) {
        if (answers.choice !== "set_weight" || !answers.base_weight_g) return [];
        return [{ action:"UPDATE", table:"recipes", row_id: rec && rec.id, field:"base_weight_g",
          old_value: rec && rec.base_weight_g != null ? rec.base_weight_g : null,
          new_value: parseFloat(answers.base_weight_g),
          reason: "Resa finale unita minima — bot suggerisce quante unita produrre",
          confidence:"chef_confirmed", botImpact: mcrBotImpact("base_weight_g") }];
      },
      followUp: function(choice) {
        return choice === "set_weight" ? { field:"base_weight_g", label:"Grammi finali utilizzabili", type:"number", placeholder:"es. 4000" } : null;
      },
    };
  }

  if (pt === "reduction-missing-final-yield") {
    return {
      state:    "NEED_ONE_ANSWER",
      question: "Chef, \"" + escH((rec && rec.title) || (pt_ && pt_.name)) + "\" riduce in cottura. Quanti grammi restano di prodotto utilizzabile?",
      options:  [
        { value: "set_weight", label: "Imposto grammi finali (prodotto ridotto)" },
        { value: "skip",       label: "Lascia per ora" },
      ],
      buildPlan: function(answers) {
        if (answers.choice !== "set_weight" || !answers.base_weight_g) return [];
        return [{ action:"UPDATE", table:"recipes", row_id: rec && rec.id, field:"base_weight_g",
          old_value: rec && rec.base_weight_g != null ? rec.base_weight_g : null,
          new_value: parseFloat(answers.base_weight_g),
          reason: "Resa dopo riduzione — bot non usa la somma ingredienti crudi come resa",
          confidence:"chef_confirmed", botImpact: mcrBotImpact("base_weight_g") }];
      },
      followUp: function(choice) {
        return choice === "set_weight" ? { field:"base_weight_g", label:"Grammi finali dopo riduzione", type:"number", placeholder:"es. 2000" } : null;
      },
    };
  }

  if (pt === "portioned-unit-missing-portion-count") {
    return {
      state:    "NEED_ONE_ANSWER",
      question: "Chef, \"" + escH((rec && rec.title) || (pt_ && pt_.name)) + "\" produce un numero fisso di porzioni/fette. Quante ne produce un batch intero?",
      options:  [
        { value: "set_servings", label: "Imposto numero porzioni per batch" },
        { value: "skip",         label: "Lascia per ora" },
      ],
      buildPlan: function(answers) {
        if (answers.choice !== "set_servings" || !answers.base_servings) return [];
        return [{ action:"UPDATE", table:"recipes", row_id: rec && rec.id, field:"base_servings",
          old_value: rec && rec.base_servings != null ? rec.base_servings : null,
          new_value: parseInt(answers.base_servings, 10),
          reason: "Porzioni per batch — bot arrotonda il suggerimento a porzioni intere",
          confidence:"chef_confirmed", botImpact: mcrBotImpact("base_servings") }];
      },
      followUp: function(choice) {
        return choice === "set_servings" ? { field:"base_servings", label:"Porzioni / fette / pezzi per batch intero", type:"number", placeholder:"es. 24" } : null;
      },
    };
  }

  if (pt === "prep-no-trusted-mapping") {
    return {
      state:    "NEED_ONE_ANSWER",
      question: "Chef, \"" + escH(pt_ && pt_.name) + "\" non ha recipe_id ne ingredient_id. Il bot non sa come calcolarne il fabbisogno.",
      options:  [
        { value: "link_recipe",     label: "E una ricetta prodotta in cucina — collego la ricetta" },
        { value: "link_ingredient", label: "E un ingrediente acquistato — collego ingrediente" },
        { value: "is_checklist",    label: "E solo un promemoria — cambia tipo in checklist" },
      ],
      buildPlan: function(answers) {
        if (answers.choice !== "is_checklist") return [];
        return [{ action:"UPDATE", table:"prep_tasks", row_id: pt_ && pt_.id, field:"prep_type",
          old_value: pt_ && pt_.prep_type != null ? pt_.prep_type : null,
          new_value: "checklist",
          reason: "Prep senza ricetta/ingrediente impostata come checklist — bot la ignora nei calcoli",
          confidence:"chef_confirmed", botImpact: "Bot ignora questa prep — appare come promemoria quotidiano" }];
      },
      editorAction: { label: "Apri Admin Prep per collegare ricetta o ingrediente", prepTaskId: pt_ && pt_.id },
    };
  }

  if (pt === "missing-min-cover-days") {
    return {
      state:    "NEED_ONE_ANSWER",
      question: "Chef, per \"" + escH(pt_ && pt_.name) + "\" il bot non sa quanti giorni di copertura servono prima di suggerire nuova prep.",
      options:  [
        { value: "1", label: "1 giorno — pasta fresca, checklist giornaliera" },
        { value: "2", label: "2 giorni — standard (proteine, salse)" },
        { value: "3", label: "3 giorni — prep meno urgenti" },
        { value: "5", label: "5 giorni — prep settimanale (ragu, demi)" },
      ],
      buildPlan: function(answers) {
        if (!answers.choice || isNaN(parseInt(answers.choice))) return [];
        return [{ action:"UPDATE", table:"prep_tasks", row_id: pt_ && pt_.id, field:"min_cover_days",
          old_value: pt_ && pt_.min_cover_days != null ? pt_.min_cover_days : null,
          new_value: parseInt(answers.choice, 10),
          reason: "Bot suggerisce nuova prep solo quando lo stock scende sotto " + answers.choice + " giorni di copertura",
          confidence:"chef_confirmed", botImpact: mcrBotImpact("min_cover_days") }];
      },
    };
  }

  if (pt === "shelf-life-mismatch") {
    var sl = rec && rec.shelf_life_days, ed = pt_ && pt_.expected_duration_days;
    return {
      state:    "NEED_ONE_ANSWER",
      question: "Chef, la ricetta dice shelf_life=" + sl + "gg ma la prep task dice " + ed + "gg. Quale e quello giusto?",
      options:  [
        { value: "use_prep",   label: (ed || "?") + "gg — quello della prep task" },
        { value: "use_recipe", label: (sl || "?") + "gg — quello della ricetta" },
      ],
      buildPlan: function(answers) {
        if (answers.choice === "use_prep") return [{ action:"UPDATE", table:"recipes", row_id: rec && rec.id,
          field:"shelf_life_days", old_value: sl, new_value: ed,
          reason:"Allineato shelf_life ricetta con expected_duration prep task",
          confidence:"chef_confirmed", botImpact:"Bot usa la finestra corretta per calcolare stock/copertura" }];
        return [{ action:"UPDATE", table:"prep_tasks", row_id: pt_ && pt_.id,
          field:"expected_duration_days", old_value: ed, new_value: sl,
          reason:"Allineato expected_duration prep con shelf_life ricetta",
          confidence:"chef_confirmed", botImpact: mcrBotImpact("expected_duration_days") }];
      },
    };
  }

  if (pt === "stock-unit-mismatch") {
    var bomRow = det.bomRow;
    return {
      state:    "NEED_ONE_ANSWER",
      question: "Chef, la riga BOM \"" + escH(det.childName) + "\" usa unita \"" + escH(bomRow && bomRow.unit) + "\" che il bot non converte. Qual e quella corretta?",
      options:  [
        { value: "g",     label: "g — grammi (peso)" },
        { value: "kg",    label: "kg — chilogrammi" },
        { value: "ml",    label: "ml — millilitri" },
        { value: "pezzi", label: "pezzi — contatili" },
        { value: "nests", label: "nests — nidi pasta fresca" },
      ],
      buildPlan: function(answers) {
        if (!answers.choice) return [];
        return [{ action:"UPDATE", table:"recipe_bom", row_id: bomRow && bomRow.bom_id, field:"unit",
          old_value: bomRow && bomRow.unit, new_value: answers.choice,
          reason:"Unita BOM corretta — bot calcola ora il consumo in grammi/unita fisiche",
          confidence:"chef_confirmed", botImpact:"Bot converte correttamente la quantita per il calcolo del consumo" }];
      },
    };
  }

  if (pt === "zero-stock-large-suggestion") {
    var isNull = pt_ && pt_.current_stock === null;
    return {
      state:    "NEED_ONE_ANSWER",
      question: isNull
        ? "Chef, \"" + escH(pt_ && pt_.name) + "\" ha stock NULL — il bot la salta. Imposto stock a 0 per includerla?"
        : "Chef, \"" + escH(pt_ && pt_.name) + "\" ha stock 0 ma bot suggerisce " + (pt_ && pt_.suggested_qty) + " " + (pt_ && pt_.unit) + ". Lo stock e davvero esaurito?",
      options: isNull ? [
        { value: "set_zero", label: "Si — imposta stock a 0 (bot la include da stasera)" },
        { value: "skip",     label: "No — lascia NULL (non ancora in produzione)" },
      ] : [
        { value: "confirmed", label: "Si — stock esaurito, bot suggerisce correttamente" },
        { value: "wrong",     label: "No — c e stock, aggiorno manualmente" },
      ],
      buildPlan: function(answers) {
        if (isNull && answers.choice === "set_zero") return [{ action:"UPDATE", table:"prep_tasks",
          row_id: pt_ && pt_.id, field:"current_stock", old_value: null, new_value: 0,
          reason:"Stock impostato a 0 — bot include questa prep nei calcoli notturni",
          confidence:"chef_confirmed", botImpact: mcrBotImpact("current_stock") }];
        return [];
      },
    };
  }

  if (pt === "subrecipe-missing-yield") {
    return {
      state:    "NEED_ONE_ANSWER",
      question: "Chef, \"" + escH(rec && rec.title) + "\" e usata come sub-recipe ma non sappiamo quanti grammi usa ogni piatto padre per porzione.",
      options:  [
        { value: "set_serving_weight", label: "Imposto grammi per porzione del piatto padre" },
        { value: "skip",               label: "Lascia per ora" },
      ],
      buildPlan: function(answers) {
        if (answers.choice !== "set_serving_weight" || !answers.serving_weight_g) return [];
        return [{ action:"UPDATE", table:"recipes", row_id: rec && rec.id, field:"serving_weight_g",
          old_value: rec && rec.serving_weight_g != null ? rec.serving_weight_g : null,
          new_value: parseFloat(answers.serving_weight_g),
          reason:"Grammi per porzione della sub-recipe — bot moltiplica per le vendite del piatto padre",
          confidence:"chef_confirmed", botImpact: mcrBotImpact("serving_weight_g") }];
      },
      followUp: function(choice) {
        return choice === "set_serving_weight" ? { field:"serving_weight_g", label:"Grammi di questa sub-recipe per porzione del piatto padre", type:"number", placeholder:"es. 150" } : null;
      },
    };
  }

  if (pt === "ingredient-name-collision" || pt === "alias-ingredient-recipe-collision") {
    var cands = (det.ingredients || []).map(function(i) { return { label:i.name, id:i.id, kind:"ingredient", cat:i.category }; });
    if (det.recipe) cands.unshift({ label: det.recipe.title, id: det.recipe.id, kind:"sub_recipe", cat: det.recipe.menu_group });
    return {
      state:      "NEED_MANUAL_LINK",
      question:   "Chef, \"" + escH(p.name) + "\" esiste sia come ingrediente sia come ricetta. Quale versione va usata nei BOM?",
      candidates: cands,
      onSelect:   function(cand) { return [{ action:"NO_WRITE_NEEDED", table:"recipe_bom", row_id:"(righe esistenti da verificare)",
        field: cand.kind === "ingredient" ? "item_id" : "sub_recipe_id",
        old_value:"(misto)", new_value: cand.label + " (" + cand.id.slice(0,8) + "...)",
        reason:"Chef Max ha scelto \"" + cand.label + "\" come target canonico. Verificare ogni BOM row.",
        confidence:"chef_confirmed", botImpact:"Bot usa il target canonico per tutti i calcoli di consumo" }]; },
      note: "Dopo la scelta, verificare ogni riga BOM che usa questo nome nel Recipe Editor.",
    };
  }

  if (pt === "parm-duplicates") {
    return {
      state:      "NEED_MANUAL_LINK",
      question:   "Chef, ci sono " + (det.ingredients || []).length + " ingredienti nella famiglia Parmesan/Pecorino. Quale e quello principale usato nei BOM?",
      candidates: (det.ingredients || []).map(function(i) { return { label:i.name, id:i.id, kind:"ingredient", cat:i.category }; }),
      onSelect:   function(cand) { return [{ action:"NO_WRITE_NEEDED", table:"recipe_bom", row_id:"(righe da verificare)",
        field:"item_id", old_value:"(vari)", new_value: cand.label + " (" + cand.id.slice(0,8) + "...)",
        reason:"Chef Max ha identificato \"" + cand.label + "\" come ingrediente canonico. Consolidare le BOM rows.",
        confidence:"chef_confirmed", botImpact:"Bot scarica dallo stock del solo ingrediente canonico" }]; },
      note: "Parmesan Cheese = bulk. Grated Pecorino / Parmesan Grated = prep recipes.",
    };
  }

  if (pt === "carrot-relationship") {
    return {
      state:      "NEED_MANUAL_LINK",
      question:   "Chef, alcune ricette collegano carote crude invece della prep Shredded Carrots. Quale versione va usata?",
      candidates: (det.ingredients || []).map(function(i) { return { label:i.name, id:i.id, kind:"ingredient", cat:i.category }; }),
      onSelect:   function(cand) { return [{ action:"NO_WRITE_NEEDED", table:"recipe_bom", row_id:"(righe da verificare)",
        field:"item_id/sub_recipe_id", old_value:"Carrot raw (ITEM)", new_value: cand.label,
        reason:"Chef Max ha scelto il target corretto per le ricette che usano carote",
        confidence:"chef_confirmed", botImpact:"Bot scarica dal prep stock Shredded Carrots invece che dall ingrediente grezzo" }]; },
    };
  }

  if (pt === "bot-huge-suggestion") {
    var causes = [];
    if (pt_ && !pt_.recipe_id) causes.push("Nessuna ricetta collegata — bot usa percorso fallback impreciso");
    if (pt_ && pt_.unit === "batch") causes.push("Unita batch astratta — bot non riesce a convertire");
    causes.push("Possibile mismatch grammi vs pezzi nel calcolo");
    return {
      state:       "NO_SAVE_TARGET",
      explanation: "Il bot suggerisce " + (pt_ && pt_.suggested_qty) + " " + (pt_ && pt_.unit) + " per \"" + escH(pt_ && pt_.name) + "\" — valore anomalo.",
      causes:      causes,
      missingSchema: null,
      editorActions: [
        pt_ && !pt_.recipe_id ? { label: "Collega una ricetta in Admin Prep" } : null,
        { label: "Verifica unita in Admin Prep" },
      ].filter(Boolean),
    };
  }

  if (pt === "missing-modifier-alias") {
    var recTitle = (rec && rec.title) || p.name;
    return {
      state:       "NO_SAVE_TARGET",
      explanation: "\"" + escH(recTitle) + "\" non ha alias in modifier_config. Se venduta come add-on, il bot non scarica stock.",
      causes:      ["modifier_config non ha una UI di editing nel Mapping Control Room", "L alias deve specificare is_kitchen=true e kitchen_cat corretta"],
      missingSchema: {
        table:   "modifier_config",
        fields:  "modifier (PK), is_kitchen BOOLEAN, kitchen_cat TEXT, portion_note TEXT",
        why:     "modifier_config non ha una UI admin — richiede query SQL diretta",
      },
      editorActions: [{ sql: "INSERT INTO modifier_config (modifier, is_kitchen, kitchen_cat) VALUES ('" + recTitle.replace(/'/g, "''") + "', true, 'Proteine');" }],
    };
  }

  if (pt === "bot-suggestion-zero-qty") {
    return {
      state:       "NO_SAVE_TARGET",
      explanation: "Il bot ha girato ma ha suggerito 0 per \"" + escH(pt_ && pt_.name) + "\". Il problema e nei dati di input.",
      causes:      [
        "Nessuna vendita ieri che corrisponda agli alias POS di questa ricetta",
        "Il percorso ingrediente non ha trovato ricette collegate con vendite",
        "Lo stock esistente potrebbe gia coprire il fabbisogno (risultato 0 corretto)",
      ],
      missingSchema: null,
      editorActions: [],
    };
  }

  // Default — no protocol yet for this type
  return {
    state:       "NO_SAVE_TARGET",
    explanation: probLabel(pt) + " — protocollo non ancora definito per questo tipo.",
    causes:      ["Problema rilevato ma risoluzione non ancora implementata"],
    missingSchema: null,
    editorActions: [],
  };
}

// Thin shim — kept only for sold-item-legacy-ingredients async path
function mcrOQRDef(problemType) {
  if (problemType !== "sold-item-legacy-ingredients") return null;
  return {
    question: "Chef, ho trovato {legacyCount} ingredient{pl} nell'editor ma 0 righe BOM strutturate. Vuoi che prepari un piano per convertirli in BOM?",
    options: [
      { value: "prepare_plan", label: "Prepara piano conversione" },
      { value: "review_later", label: "Rivedi piu tardi" },
      { value: "verify_bom",   label: "Verifica di nuovo BOM" },
    ],
    buildPlan: function(answers) { return answers.choice === "prepare_plan" ? "__async_conversion__" : []; },
  };
}



// ══════════════════════════════════════════════════════════════
// PROTOCOL UI RENDERERS
// ══════════════════════════════════════════════════════════════


// ══════════════════════════════════════════════════════════════
// FREE-TEXT "ALTRO / SPIEGA TU" — UI ONLY (Step 1)
// No external AI call. No API key. No DB write.
// Step 2: connect to Chef AI local endpoint (Mac mini) later.
// ══════════════════════════════════════════════════════════════

function mcrRenderFreeTextButton() {
  return `
    <div id="mcrFreeTextArea" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid #1e293b;">
      <div style="font-size:11px;font-weight:700;color:#475569;margin-bottom:6px;letter-spacing:.5px;">
        SPIEGA CON PAROLE TUE
      </div>
      <textarea id="mcrFreeTextInput"
        placeholder="Es: 'Parmesan Cheese e Pecorino Romano sono due ingredienti diversi. Parmesan Flakes è vecchio e va rimosso...'"
        style="width:100%;min-height:90px;padding:10px;background:#1e293b;border:1px solid #475569;
               border-radius:8px;color:#f1f5f9;font-size:13px;font-family:inherit;outline:none;
               resize:vertical;box-sizing:border-box;line-height:1.5;"
        oninput="document.getElementById('mcrFreeTextSubmit').disabled=this.value.trim().length<5;">
      </textarea>
      <div style="display:flex;gap:8px;margin-top:6px;">
        <button id="mcrFreeTextSubmit" onclick="mcrSubmitFreeText()" disabled
          style="flex:1;padding:9px;background:#1e293b;border:1px solid #475569;border-radius:8px;
                 color:#94a3b8;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;
                 transition:all .15s;"
          onmouseover="if(!this.disabled){this.style.background='#263548';this.style.color='#f1f5f9';}"
          onmouseout="if(!this.disabled){this.style.background='#1e293b';this.style.color='#94a3b8';}">
          Invia spiegazione →
        </button>
        <button onclick="mcrCancelFreeText()"
          style="padding:9px 14px;background:transparent;border:1px solid #334155;border-radius:8px;
                 color:#64748b;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">
          ✕
        </button>
      </div>
    </div>
    <button onclick="mcrShowFreeText()"
      id="mcrFreeTextToggle"
      style="margin-top:10px;width:100%;padding:9px;background:transparent;
             border:1px dashed #334155;border-radius:8px;color:#64748b;
             font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;
             transition:all .15s;"
      onmouseover="this.style.borderColor='#475569';this.style.color='#94a3b8';"
      onmouseout="this.style.borderColor='#334155';this.style.color='#64748b';">
      ✏️ Altro / Spiega tu
    </button>`;
}

window.mcrShowFreeText = function() {
  const btn  = document.getElementById('mcrFreeTextToggle');
  const area = document.getElementById('mcrFreeTextArea');
  if (!btn || !area) return;
  btn.style.display  = 'none';
  area.style.display = 'block';
  const ta = document.getElementById('mcrFreeTextInput');
  if (ta) ta.focus();
};

window.mcrCancelFreeText = function() {
  const btn  = document.getElementById('mcrFreeTextToggle');
  const area = document.getElementById('mcrFreeTextArea');
  if (!btn || !area) return;
  area.style.display = 'none';
  btn.style.display  = '';
  const ta = document.getElementById('mcrFreeTextInput');
  if (ta) ta.value = '';
  // Also clear any previous free-text response
  const resp = document.getElementById('mcrFreeTextResponse');
  if (resp) resp.remove();
};

// ── LOCAL CHEF AI CONFIG ─────────────────────────────────────
// Gateway on Mac mini via Tailscale Funnel — no external AI, no Anthropic.
// Key stored here matches Supabase Secret CHEF_AI_KEY (set session 5 Jul 2026).
const MCR_CHEF_AI_URL = 'https://max-mini.taildf4122.ts.net/chef-ai';
const MCR_CHEF_AI_KEY = 'ef2494d331d377a56bb6ab065402761844200c44a38f847572b0745cb060361b';
const MCR_CHEF_AI_TIMEOUT_MS = 45000;

// ── SYSTEM PROMPT for MCR free-text interpretation ───────────
function mcrChefAISystemPrompt(p) {
  const det  = p.detail || {};
  const ings = (det.ingredients || []).map(function(i) { return i.name; }).join(', ');
  const cands = (det.conflictingBOMs || []).join('; ');
  return [
    'You are Chef AI, the kitchen management assistant for Zenos on the Square (Weatherford, TX).',
    'Chef Max will describe a kitchen data problem in his own words (Italian, English, or mixed).',
    'Your job: interpret what he means and return ONLY a JSON object — nothing else, no markdown, no preamble.',
    '',
    'CURRENT PROBLEM CONTEXT:',
    '  name: ' + (p.name || ''),
    '  type: ' + (p.problemType || ''),
    '  explanation: ' + (p.explanation || ''),
    ings   ? ('  family members: ' + ings)  : '',
    cands  ? ('  BOM conflicts: ' + cands)  : '',
    '',
    'RULES:',
    '- Never merge Parmesan Cheese and Pecorino Romano — they are different vendor ingredients.',
    '- Shaved Parmesan is a prep/recipe made FROM Parmesan Cheese, not an ingredient itself.',
    '- Parmesan Flakes = legacy duplicate — must ask Chef what to do with it.',
    '- MAPPING_WRITE_ENABLED is false — propose plans only, never claim to write DB.',
    '- If not enough info, set needs_follow_up: true and provide a specific follow_up_question.',
    '',
    'RESPOND ONLY with this JSON (no extra text):',
    '{',
    '  "understood": ["string — each thing you understood from Chef Max input"],',
    '  "not_changed": ["string — things that will NOT be touched"],',
    '  "affected_items": ["item names affected by the proposed action"],',
    '  "suggested_action": "one-line plain-text action summary",',
    '  "needs_follow_up": true or false,',
    '  "follow_up_question": "the ONE question Chef AI needs answered, or null",',
    '  "follow_up_options": ["Option A", "Option B", ...],',
    '  "plan": [],',
    '  "confidence": "low" or "medium" or "high",',
    '  "no_save_target_reason": "if no DB write is possible, explain why, else null"',
    '}',
  ].filter(Boolean).join('\n');
}

// ── RENDER Chef AI structured response ───────────────────────
function mcrRenderChefAIResponse(p, userText, result) {
  const confColor = { high:'#22c55e', medium:'#f59e0b', low:'#ef4444' }[result.confidence] || '#64748b';
  const confLabel = { high:'Alta', medium:'Media', low:'Bassa' }[result.confidence] || '—';

  let html = `
    <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:16px;">🤖</span>
          <div>
            <div style="font-size:12px;font-weight:700;color:#a78bfa;letter-spacing:.4px;">CHEF AI — INTERPRETAZIONE</div>
            <div style="font-size:10px;color:#475569;">${escH(p.name || p.problemType || '')}</div>
          </div>
        </div>
        <span style="font-size:10px;font-weight:700;color:${confColor};padding:3px 8px;border-radius:6px;background:${confColor}20;">
          Fiducia: ${confLabel}
        </span>
      </div>

      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:8px;margin-bottom:8px;">
        <div style="font-size:10px;font-weight:700;color:#475569;margin-bottom:3px;letter-spacing:.4px;">HAI SCRITTO</div>
        <div style="font-size:12px;color:#cbd5e1;font-style:italic;">"${escH(userText)}"</div>
      </div>`;

  if (result.understood && result.understood.length) {
    html += `<div style="margin-bottom:8px;">
      <div style="font-size:10px;font-weight:700;color:#22c55e;margin-bottom:5px;letter-spacing:.4px;">✅ HO CAPITO</div>`;
    result.understood.forEach(function(u) {
      html += `<div style="font-size:12px;color:#86efac;padding:3px 0;display:flex;gap:6px;">
        <span style="color:#22c55e;flex-shrink:0;">▸</span><span>${escH(u)}</span></div>`;
    });
    html += '</div>';
  }

  if (result.not_changed && result.not_changed.length) {
    html += `<div style="margin-bottom:8px;">
      <div style="font-size:10px;font-weight:700;color:#94a3b8;margin-bottom:5px;letter-spacing:.4px;">🔒 NON CAMBIO</div>`;
    result.not_changed.forEach(function(n) {
      html += `<div style="font-size:12px;color:#94a3b8;padding:3px 0;display:flex;gap:6px;">
        <span style="flex-shrink:0;">—</span><span>${escH(n)}</span></div>`;
    });
    html += '</div>';
  }

  if (result.suggested_action) {
    html += `<div style="background:#1e1b4b;border:1px solid #312e81;border-radius:8px;padding:8px;margin-bottom:8px;">
      <div style="font-size:10px;font-weight:700;color:#a78bfa;margin-bottom:3px;letter-spacing:.4px;">💡 AZIONE PROPOSTA</div>
      <div style="font-size:12px;color:#c4b5fd;line-height:1.5;">${escH(result.suggested_action)}</div>
    </div>`;
  }

  if (result.needs_follow_up && result.follow_up_question) {
    html += `<div style="background:#1c1917;border:1px solid #44403c;border-radius:8px;padding:10px;margin-bottom:8px;">
      <div style="font-size:10px;font-weight:700;color:#f59e0b;margin-bottom:6px;letter-spacing:.4px;">❓ PROSSIMA DOMANDA</div>
      <div style="font-size:13px;color:#fde68a;margin-bottom:8px;line-height:1.5;">${escH(result.follow_up_question)}</div>`;
    if (result.follow_up_options && result.follow_up_options.length) {
      result.follow_up_options.forEach(function(opt, oi) {
        const letters = ['A','B','C','D','E'];
        html += `<button onclick="mcrFreeTextFollowUp(${oi})"
          style="display:block;width:100%;text-align:left;padding:8px 10px;margin-bottom:5px;
                 background:#292524;border:1px solid #57534e;border-radius:8px;
                 color:#e7e5e4;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;"
          onmouseover="this.style.background='#3c3835'" onmouseout="this.style.background='#292524'">
          ${escH((letters[oi]||String(oi+1)) + ') ' + opt)}
        </button>`;
      });
    }
    html += '</div>';
  }

  if (result.no_save_target_reason) {
    html += `<div style="background:#1c0a0a;border:1px solid #7f1d1d;border-radius:8px;padding:8px;margin-bottom:8px;">
      <div style="font-size:10px;font-weight:700;color:#f87171;margin-bottom:3px;letter-spacing:.4px;">⛔ NESSUN TARGET DB</div>
      <div style="font-size:12px;color:#fca5a5;line-height:1.5;">${escH(result.no_save_target_reason)}</div>
    </div>`;
  }

  html += `<div style="display:flex;gap:8px;margin-top:4px;">
    <button onclick="mcrCancelFreeText()"
      style="flex:1;padding:8px;background:#1e293b;border:1px solid #334155;border-radius:8px;
             color:#94a3b8;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">
      ✕ Chiudi
    </button>
    <button onclick="document.getElementById('mcrFreeTextInput').value='';mcrCancelFreeText();setTimeout(mcrShowFreeText,50);"
      style="flex:1;padding:8px;background:#1e293b;border:1px solid #475569;border-radius:8px;
             color:#e2e8f0;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">
      ✏️ Riscrivi
    </button>
  </div></div>`;
  return html;
}

// ── RENDER raw/error response ─────────────────────────────────
function mcrRenderChefAIRawResponse(p, userText, rawText, errorMsg) {
  return `
    <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:12px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <span style="font-size:16px;">⚠️</span>
        <div style="font-size:12px;font-weight:700;color:#f59e0b;">AI response needs review</div>
      </div>
      ${errorMsg ? `<div style="font-size:11px;color:#f87171;margin-bottom:8px;">${escH(errorMsg)}</div>` : ''}
      ${rawText ? `<div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:8px;margin-bottom:8px;max-height:160px;overflow-y:auto;">
        <div style="font-size:10px;font-weight:700;color:#475569;margin-bottom:4px;">RISPOSTA RAW</div>
        <pre style="font-size:10px;color:#94a3b8;white-space:pre-wrap;margin:0;">${escH(rawText)}</pre>
      </div>` : ''}
      <div style="display:flex;gap:8px;">
        <button onclick="mcrCancelFreeText()"
          style="flex:1;padding:8px;background:#1e293b;border:1px solid #334155;border-radius:8px;
                 color:#94a3b8;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">
          ✕ Chiudi
        </button>
        <button onclick="document.getElementById('mcrFreeTextInput').value='';mcrCancelFreeText();setTimeout(mcrShowFreeText,50);"
          style="flex:1;padding:8px;background:#1e293b;border:1px solid #475569;border-radius:8px;
                 color:#e2e8f0;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">
          ✏️ Riscrivi
        </button>
      </div>
    </div>`;
}

// ── FOLLOW-UP from AI-generated options ──────────────────────
window.mcrFreeTextFollowUp = function(optIdx) {
  const resp = document.getElementById('mcrFreeTextResponse');
  if (!resp) return;
  // Read the stored follow_up_options from last result
  const stored = window._mcrLastChefAIResult;
  if (!stored || !stored.follow_up_options) return;
  const choice = stored.follow_up_options[optIdx];
  if (!choice) return;
  // Pre-fill textarea with chosen option and re-submit
  const ta = document.getElementById('mcrFreeTextInput');
  if (ta) ta.value = choice;
  mcrSubmitFreeText();
};

// ── MAIN SUBMIT — calls local Chef AI gateway ─────────────────
window.mcrSubmitFreeText = async function() {
  const ta  = document.getElementById('mcrFreeTextInput');
  const idx = window._mcrDrawerIdx;
  const p   = (window._mcrProblems || [])[idx];
  if (!ta || !p) return;
  const text = ta.value.trim();
  if (!text || text.length < 5) return;

  const btn = document.getElementById('mcrFreeTextSubmit');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }

  // Remove previous response
  const prev = document.getElementById('mcrFreeTextResponse');
  if (prev) prev.remove();

  const area = document.getElementById('mcrFreeTextArea');
  if (!area) return;

  // Show loading state
  const loadDiv = document.createElement('div');
  loadDiv.id = 'mcrFreeTextResponse';
  loadDiv.style.cssText = 'margin-top:12px;';
  loadDiv.innerHTML = `
    <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:16px;text-align:center;">
      <div style="font-size:20px;margin-bottom:8px;">🤖</div>
      <div style="font-size:13px;font-weight:600;color:#a78bfa;margin-bottom:4px;">Chef AI sta ragionando…</div>
      <div style="font-size:11px;color:#475569;">qwen3:8b · Mac mini · timeout 45s</div>
    </div>`;
  area.after(loadDiv);

  // Build payload for local Chef AI gateway
  const det   = p.detail || {};
  const payload = {
    model:  'qwen3:8b',
    system: mcrChefAISystemPrompt(p),
    prompt: [
      'Chef Max ha scritto:',
      '"' + text + '"',
      '',
      'Rispondi SOLO con il JSON strutturato richiesto.',
    ].join('\n'),
    stream: false,
  };

  let raw = '';
  let timedOut = false;
  const controller = new AbortController();
  const timer = setTimeout(function() {
    timedOut = true;
    controller.abort();
  }, MCR_CHEF_AI_TIMEOUT_MS);

  try {
    const res = await fetch(MCR_CHEF_AI_URL, {
      method:  'POST',
      headers: {
        'Content-Type':   'application/json',
        'x-chef-ai-key':  MCR_CHEF_AI_KEY,
      },
      body:   JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(function() { return ''; });
      throw new Error('HTTP ' + res.status + (errText ? ': ' + errText.slice(0, 120) : ''));
    }

    raw = await res.text();

    // Gateway wraps Ollama response as { response: "..." }
    // Extract the inner text from the gateway wrapper first,
    // then search for structured JSON inside the model output.
    let modelText = raw;
    try {
      const wrapper = JSON.parse(raw);
      if (wrapper && typeof wrapper.response === 'string') {
        modelText = wrapper.response;
      }
    } catch(_) { /* raw is not wrapper JSON — use as-is */ }

    // Try to parse structured Chef AI JSON from model output
    let parsed = null;
    let parseErr = null;
    try {
      const clean = modelText.replace(/```json|```/g, '').trim();
      // Extract first {...} block in case model prepended text
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error('No JSON object found in model response');
      }
    } catch(e) {
      parseErr = e.message;
    }

    const respDiv = document.getElementById('mcrFreeTextResponse');
    if (!respDiv) return;

    if (parsed) {
      window._mcrLastChefAIResult = parsed;
      respDiv.innerHTML = mcrRenderChefAIResponse(p, text, parsed);
    } else {
      respDiv.innerHTML = mcrRenderChefAIRawResponse(p, text, raw.slice(0, 800), 'JSON parse error: ' + parseErr);
    }

  } catch(e) {
    clearTimeout(timer);
    const respDiv = document.getElementById('mcrFreeTextResponse');
    if (respDiv) {
      const msg = timedOut
        ? 'Timeout 45s — Chef AI locale non ha risposto. Verifica che il Mac mini sia acceso e Tailscale attivo.'
        : 'Chef AI locale non raggiungibile: ' + e.message;
      respDiv.innerHTML = mcrRenderChefAIRawResponse(p, text, '', msg);
    }
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Invia spiegazione →'; }
};

function mcrRenderProtocolUI(proto, p) {
  if (!proto) return '';
  const st = proto.state;

  if (st === 'SAFE_AUTO_PLAN') {
    const plan = proto.plan || [];
    window._mcrPendingPlan = plan;
    let h = `<div class="mcr-drawer-section" style="border-color:#22c55e60;background:#0f1f2e;" id="mcrOQRSection">
      <div class="mcr-drawer-label" style="color:#86efac;">\u{1F916} Chef AI \u2014 Piano automatico</div>
      <div style="font-size:12px;color:#94a3b8;margin-bottom:10px;">Soluzione deterministica. Controlla e approva.</div>`;
    plan.forEach(function(row) { h += mcrRenderWritePlanRow(row); });
    h += mcrRenderApproveButtons();
    if (proto.editorAction) h += mcrRenderEditorActions(proto);
    h += '</div>';
    return h;
  }

  if (st === 'NEED_ONE_ANSWER') {
    const { question, options } = proto;
    return `<div class="mcr-drawer-section" style="border-color:#7c3aed60;background:#0d0e1f;" id="mcrOQRSection">
      <div class="mcr-drawer-label" style="color:#a78bfa;">\u{1F916} Chef AI \u2014 Una domanda</div>
      <div style="font-size:13px;color:#e2e8f0;line-height:1.6;margin-bottom:12px;">${escH(question || '')}</div>
      <div style="display:flex;flex-direction:column;gap:6px;" id="mcrOQROptions">
        ${(options || []).map(o => `
          <button onclick="mcrProtocolAnswer('${escH(o.value)}')"
            style="text-align:left;padding:10px 14px;background:#1e293b;border:1px solid #334155;
                   border-radius:10px;color:#e2e8f0;font-size:13px;font-family:inherit;
                   cursor:pointer;line-height:1.4;"
            onmouseover="this.style.background='#263548'" onmouseout="this.style.background='#1e293b'">
            ${escH(o.label)}
          </button>`).join('')}
      </div>
      ${mcrRenderFreeTextButton()}
    </div>`;
  }

  if (st === 'NEED_MANUAL_LINK') {
    const { question, candidates, note } = proto;
    const candHTML = (candidates || []).map((c, ci) => `
      <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:10px 12px;
                  margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:#f1f5f9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${c.kind === 'ingredient' ? '\u{1F4E6}' : '\u{1F517}'} ${escH(c.label)}
          </div>
          <div style="font-size:10px;color:#475569;margin-top:1px;">
            ${escH(c.kind === 'ingredient' ? 'Ingrediente' : 'Sub-recipe')} \u00b7 ${escH(c.cat || '')} \u00b7 ${escH((c.id || '').slice(0,8))}\u2026
          </div>
        </div>
        <button onclick="mcrProtocolSelectCandidate(${ci})"
          style="flex-shrink:0;padding:6px 14px;background:#7c3aed;border:none;border-radius:8px;
                 color:white;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">
          Seleziona
        </button>
      </div>`).join('');
    return `<div class="mcr-drawer-section" style="border-color:#7c3aed60;background:#0d0e1f;" id="mcrOQRSection">
      <div class="mcr-drawer-label" style="color:#a78bfa;">\u{1F916} Chef AI \u2014 Seleziona target</div>
      <div style="font-size:13px;color:#e2e8f0;line-height:1.6;margin-bottom:10px;">${escH(question || '')}</div>
      ${candHTML}
      ${note ? `<div style="font-size:10px;color:#475569;margin-top:8px;line-height:1.5;">${escH(note)}</div>` : ''}
      ${mcrRenderFreeTextButton()}
    </div>`;
  }

  if (st === 'NO_SAVE_TARGET') {
    const { explanation, causes, missingSchema, editorActions } = proto;
    let h = `<div class="mcr-drawer-section" style="border-color:#f59e0b60;background:#0d0e1f;" id="mcrOQRSection">
      <div class="mcr-drawer-label" style="color:#fde68a;">\u{1F916} Chef AI \u2014 Nessun target DB disponibile</div>
      <div style="font-size:13px;color:#e2e8f0;line-height:1.6;margin-bottom:8px;">${escH(explanation || '')}</div>`;
    if (causes && causes.length) {
      h += '<div style="margin-bottom:8px;">';
      causes.forEach(function(c) {
        h += `<div style="font-size:11px;color:#94a3b8;padding:3px 0;display:flex;gap:6px;">
          <span style="color:#f59e0b;flex-shrink:0;">\u25b8</span><span>${escH(c)}</span></div>`;
      });
      h += '</div>';
    }
    if (missingSchema) {
      h += `<div style="background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px;margin-bottom:8px;">
        <div style="font-size:10px;font-weight:700;color:#f59e0b;margin-bottom:4px;">\u26a0\ufe0f Schema mancante</div>
        <div class="mcr-kv"><span class="mcr-kv-k">Tabella</span><span class="mcr-kv-v">${escH(missingSchema.table)}</span></div>
        <div class="mcr-kv"><span class="mcr-kv-k">Campi</span><span class="mcr-kv-v" style="font-size:10px;font-family:monospace;">${escH(missingSchema.fields)}</span></div>
        <div style="font-size:10px;color:#475569;margin-top:6px;line-height:1.4;">${escH(missingSchema.why)}</div>
      </div>`;
    }
    h += mcrRenderEditorActions(proto);
    h += mcrRenderFreeTextButton();
    h += '</div>';
    return h;
  }
  return '';
}

function mcrRenderWritePlanRow(row) {
  const actionColor = { UPDATE:'#0ea5e9', INSERT:'#22c55e', DELETE:'#ef4444', NO_WRITE_NEEDED:'#64748b' }[row.action] || '#94a3b8';
  return `<div style="background:#1e293b;border-radius:10px;padding:10px;margin-bottom:8px;border:1px solid #334155;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <span style="font-size:11px;font-weight:700;color:${actionColor};letter-spacing:.4px;">${escH(row.action || '')}</span>
      <span style="font-size:10px;color:#475569;">${escH(row.table || '')} \u00b7 ${escH(String(row.row_id || '').slice(0,12))}</span>
    </div>
    <div class="mcr-kv"><span class="mcr-kv-k">Campo</span><span class="mcr-kv-v">${escH(fieldLabel(row.field || ''))}</span></div>
    <div class="mcr-kv"><span class="mcr-kv-k">Valore attuale</span>
      <span class="mcr-kv-v" style="color:#f87171;">${row.old_value !== null && row.old_value !== undefined ? escH(String(row.old_value)) : '\u2014 (non impostato)'}</span>
    </div>
    <div class="mcr-kv"><span class="mcr-kv-k">Nuovo valore</span>
      <span class="mcr-kv-v" style="color:#86efac;">${escH(String(row.new_value ?? ''))}</span>
    </div>
    ${row.botImpact ? `<div class="mcr-kv"><span class="mcr-kv-k">Impatto bot</span>
      <span class="mcr-kv-v" style="font-size:10px;color:#7dd3fc;">${escH(row.botImpact)}</span></div>` : ''}
    <div style="font-size:10px;color:#475569;margin-top:6px;line-height:1.4;">${escH(row.reason || '')}</div>
  </div>`;
}

function mcrRenderApproveButtons() {
  return `<div style="display:flex;gap:8px;margin-top:8px;">
    <button onclick="mcrApprovePlan()"
      style="flex:1;padding:10px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;
             ${MAPPING_WRITE_ENABLED ? 'background:#059669;border:none;color:white;' : 'background:#1e293b;border:1px solid #334155;color:#475569;cursor:not-allowed;'}">
      ${MAPPING_WRITE_ENABLED ? '\u2705 Approva e Salva' : '\u{1F512} Approve (Write Disabled)'}
    </button>
    <button onclick="mcrCancelPlan()"
      style="padding:10px 16px;background:#1e293b;border:1px solid #334155;border-radius:10px;
             color:#94a3b8;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">
      Annulla
    </button>
  </div>`;
}

function mcrRenderEditorActions(proto) {
  const acts = (proto && proto.editorActions) ? proto.editorActions : (proto && proto.editorAction ? [proto.editorAction] : []);
  if (!acts.length) return '';
  let h = `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #1e293b;">
    <div style="font-size:10px;font-weight:700;color:#475569;margin-bottom:6px;letter-spacing:.5px;">AZIONE CONSIGLIATA</div>`;
  acts.forEach(function(a) {
    if (a.sql) {
      h += `<div style="background:#1e293b;border:1px solid #334155;border-radius:8px;padding:8px;margin-bottom:6px;">
        <div style="font-size:10px;color:#94a3b8;margin-bottom:4px;">SQL:</div>
        <code style="font-size:10px;color:#86efac;font-family:monospace;word-break:break-all;">${escH(a.sql)}</code>
      </div>`;
    } else {
      h += `<div style="font-size:12px;color:#7c3aed;padding:4px 0;">\u2192 ${escH(a.label || '')}</div>`;
    }
  });
  h += '</div>';
  return h;
}

// ── Protocol answer handler ────────────────────────────────────
window.mcrProtocolAnswer = async function(choice) {
  const proto = window._mcrActiveProtocol;
  const idx   = window._mcrDrawerIdx;
  const p     = (window._mcrProblems || [])[idx];
  if (!proto || !p) return;
  window._mcrOQRState = window._mcrOQRState || { step:'info', answers:{} };
  window._mcrOQRState.answers.choice = choice;

  document.querySelectorAll('#mcrOQROptions button').forEach(function(btn, i) {
    btn.style.opacity = '0.4'; btn.disabled = true;
    if (proto.options && proto.options[i] && proto.options[i].value === choice) {
      btn.style.opacity = '1'; btn.style.borderColor = '#7c3aed';
      btn.style.background = '#1e1b4b'; btn.style.color = '#c4b5fd';
    }
  });

  const fu = proto.followUp && proto.followUp(choice);
  if (fu) {
    const sec = document.getElementById('mcrOQRSection');
    if (sec) {
      document.getElementById('mcrFollowUp') && document.getElementById('mcrFollowUp').remove();
      const div = document.createElement('div');
      div.id = 'mcrFollowUp';
      div.style.cssText = 'margin-top:12px;padding-top:12px;border-top:1px solid #334155;';
      div.innerHTML = `<div style="font-size:12px;color:#94a3b8;margin-bottom:6px;">${escH(fu.label)}</div>
        <div style="display:flex;gap:8px;align-items:center;">
          <input id="mcrFollowUpInput" type="${fu.type || 'text'}" placeholder="${escH(fu.placeholder || '')}"
            style="flex:1;padding:8px 12px;background:#1e293b;border:1px solid #475569;border-radius:8px;
                   color:#f1f5f9;font-size:13px;font-family:inherit;outline:none;"/>
          <button onclick="mcrProtocolSubmitFollowUp()"
            style="padding:8px 16px;background:#7c3aed;border:none;border-radius:8px;
                   color:white;font-size:13px;font-weight:600;cursor:pointer;">\u2192</button>
        </div>`;
      sec.appendChild(div);
    }
    return;
  }
  mcrProtocolBuildAndShow(proto, p);
};

window.mcrProtocolSubmitFollowUp = function() {
  const proto = window._mcrActiveProtocol;
  const idx   = window._mcrDrawerIdx;
  const p     = (window._mcrProblems || [])[idx];
  const val   = document.getElementById('mcrFollowUpInput') && document.getElementById('mcrFollowUpInput').value && document.getElementById('mcrFollowUpInput').value.trim();
  if (!val || !proto || !p) return;
  const fu = proto.followUp && proto.followUp(window._mcrOQRState.answers.choice);
  if (fu) window._mcrOQRState.answers[fu.field] = val;
  mcrProtocolBuildAndShow(proto, p);
};

window.mcrProtocolSelectCandidate = function(candIdx) {
  const proto = window._mcrActiveProtocol;
  const idx   = window._mcrDrawerIdx;
  const p     = (window._mcrProblems || [])[idx];
  if (!proto || !p) return;
  const cand = proto.candidates && proto.candidates[candIdx];
  if (!cand) return;

  const plan = (proto.onSelect && proto.onSelect(cand)) || [];
  window._mcrPendingPlan = plan;

  const el = document.getElementById('mcrWritePlan');
  if (!el) return;
  el.style.display = '';
  let h = `<div class="mcr-drawer-section" style="border-color:#0ea5e960;background:#0f1f2e;margin-top:8px;">
    <div class="mcr-drawer-label" style="color:#7dd3fc;">\u{1F4CB} Selezione confermata</div>
    <div style="font-size:11px;color:#94a3b8;margin-bottom:8px;">
      Selezionato: ${cand.kind === 'ingredient' ? '\u{1F4E6}' : '\u{1F517}'} <strong style="color:#f1f5f9;">${escH(cand.label)}</strong>
      ${!MAPPING_WRITE_ENABLED ? '<span style="color:#f59e0b;font-weight:700;"> \u26a0\ufe0f WRITE DISABLED</span>' : ''}
    </div>`;
  plan.forEach(function(row) { h += mcrRenderWritePlanRow(row); });
  h += mcrRenderApproveButtons() + '</div>';
  el.innerHTML = h;

  document.querySelectorAll('#mcrOQRSection button').forEach(function(btn) { btn.style.opacity='0.4'; btn.disabled=true; });
};

function mcrProtocolBuildAndShow(proto, p) {
  const plan = (proto.buildPlan && proto.buildPlan(window._mcrOQRState.answers, p, window._mcrData)) || [];
  window._mcrPendingPlan = plan;
  const el = document.getElementById('mcrWritePlan');
  if (!el) return;
  el.style.display = '';
  if (!plan.length) {
    el.innerHTML = mcrRenderEditorActions(proto) ||
      '<div class="mcr-drawer-section" style="border-color:#334155;background:#0f172a;margin-top:8px;"><div style="font-size:12px;color:#475569;">Nessuna modifica DB per questa scelta.</div></div>';
    return;
  }
  let h = `<div class="mcr-drawer-section" style="border-color:#0ea5e960;background:#0f1f2e;margin-top:8px;">
    <div class="mcr-drawer-label" style="color:#7dd3fc;">\u{1F4CB} Piano di Modifica DB</div>
    <div style="font-size:11px;color:#94a3b8;margin-bottom:10px;">
      ${!MAPPING_WRITE_ENABLED ? '<span style="color:#f59e0b;font-weight:700;">\u26a0\ufe0f WRITE DISABLED \u2014 Phase 2 required</span>' : ''}
    </div>`;
  plan.forEach(function(row) { h += mcrRenderWritePlanRow(row); });
  h += mcrRenderApproveButtons();
  if (proto.editorAction) h += mcrRenderEditorActions(proto);
  h += '</div>';
  el.innerHTML = h;
}

// ══════════════════════════════════════════════════════════════
// DRAWER HTML BUILDER
// ══════════════════════════════════════════════════════════════

function buildDrawerHTML(p) {
  const { recipes, ingredients, bom, posSales, prepTasks } = window._mcrData || {};
  const recipeById = Object.fromEntries((recipes || []).map(r => [r.id, r]));
  const ingById    = Object.fromEntries((ingredients || []).map(i => [i.id, i]));

  let html = '';

  // ── HEADER ────────────────────────────────────────────────────
  html += `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">
      <div>
        <div style="font-size:15px;font-weight:700;color:#f1f5f9;line-height:1.3;">${escH(p.name)}</div>
        <div style="font-size:11px;color:#64748b;margin-top:3px;">${escH(probLabel(p.problemType))}</div>
      </div>
      <button onclick="document.getElementById('mcrDrawer').style.display='none';mcrCloseBottomSheet();document.querySelectorAll('.mcr-row').forEach(r=>r.classList.remove('selected'))"
        style="background:none;border:none;color:#475569;font-size:18px;cursor:pointer;flex-shrink:0;padding:0 0 0 8px;">✕</button>
    </div>`;

  // ── PROBLEM IN CHEF LANGUAGE ──────────────────────────────────
  const sc = sevColor(p.severity);
  const sevIcon = { red: '🔴', yellow: '🟡', green: '🟢' }[p.severity] || '⚪';
  html += `
    <div class="mcr-drawer-section" style="border-color:${sc}50;background:#0f172a;">
      <div style="font-size:13px;font-weight:700;color:${sc};margin-bottom:6px;">${sevIcon} ${escH(probLabel(p.problemType))}</div>
      <div style="font-size:13px;color:#e2e8f0;line-height:1.6;">${escH(p.explanation)}</div>
    </div>`;

  // ── RECIPE CARD (chef language labels, no raw DB names) ───────
  const rec = p.detail?.recipe || (p.detail?.prepTask?.recipe_id ? recipeById[p.detail.prepTask.recipe_id] : null);
  if (rec) {
    const modeColor = rec.pos_name ? '#1e3a8a' : '#1a3a2a';
    const modeTxt   = rec.pos_name ? '#bfdbfe' : '#86efac';
    const modeLabel = rec.pos_name
      ? `🛒 Piatto venduto — ${escH(rec.pos_name.split('|')[0])}`
      : '🔪 Prep / Batch — produzione programmata';
    html += `
      <div class="mcr-drawer-section">
        <div class="mcr-drawer-label">📖 Ricetta</div>
        <div class="mcr-kv">
          <span class="mcr-kv-k">Modalità</span>
          <span class="mcr-kv-v" style="font-size:11px;padding:2px 6px;border-radius:6px;background:${modeColor};color:${modeTxt};">${modeLabel}</span>
        </div>`;
    if (rec.pos_name) {
      html += `<div class="mcr-kv">
        <span class="mcr-kv-k">${fieldLabel('pos_name')}</span>
        <span class="mcr-kv-v" style="font-size:11px;">${escH(rec.pos_name)}</span>
      </div>`;
    }
    if (rec.menu_group) {
      html += `<div class="mcr-kv">
        <span class="mcr-kv-k">${fieldLabel('menu_group')}</span>
        <span class="mcr-kv-v">${escH(rec.menu_group)}</span>
      </div>`;
    }
    if (rec.base_servings) {
      html += `<div class="mcr-kv">
        <span class="mcr-kv-k">${fieldLabel('base_servings')}</span>
        <span class="mcr-kv-v">${rec.base_servings}</span>
      </div>`;
    }
    if (rec.base_weight_g) {
      html += `<div class="mcr-kv">
        <span class="mcr-kv-k">${fieldLabel('base_weight_g')}</span>
        <span class="mcr-kv-v">${rec.base_weight_g} g</span>
      </div>`;
    }
    if (rec.serving_weight_g) {
      html += `<div class="mcr-kv">
        <span class="mcr-kv-k">${fieldLabel('serving_weight_g')}</span>
        <span class="mcr-kv-v">${rec.serving_weight_g} g</span>
      </div>`;
    }
    if (rec.serving_qty || rec.serving_unit) {
      html += `<div class="mcr-kv">
        <span class="mcr-kv-k">${fieldLabel('serving_qty')}</span>
        <span class="mcr-kv-v">${rec.serving_qty || '—'} ${escH(rec.serving_unit || '')}</span>
      </div>`;
    }
    if (rec.shelf_life_days) {
      html += `<div class="mcr-kv">
        <span class="mcr-kv-k">${fieldLabel('shelf_life_days')}</span>
        <span class="mcr-kv-v">${rec.shelf_life_days} giorni</span>
      </div>`;
    }
    html += `</div>`;
  }

  // ── PREP TASK CARD (if present) ───────────────────────────────
  const pt = p.detail?.prepTask;
  if (pt) {
    const noteParts = (pt.suggested_note || '').split('|');
    const noteIT    = noteParts[1] || '—';
    const noteColor = noteParts[0] || '';
    const pillColor = { red: '#ef4444', yellow: '#f59e0b', green: '#22c55e' }[noteColor] || '#64748b';
    html += `
      <div class="mcr-drawer-section">
        <div class="mcr-drawer-label">🤖 Bot — Ultima Analisi</div>
        <div class="mcr-kv">
          <span class="mcr-kv-k">Quanto fare oggi</span>
          <span class="mcr-kv-v" style="color:${pillColor};font-weight:700;">${pt.suggested_qty || '—'} ${escH(pt.unit || '')}</span>
        </div>
        <div class="mcr-kv">
          <span class="mcr-kv-k">Nota bot</span>
          <span class="mcr-kv-v" style="font-size:11px;">${escH(noteIT)}</span>
        </div>
        <div class="mcr-kv">
          <span class="mcr-kv-k">Stock attuale</span>
          <span class="mcr-kv-v" style="color:${pt.current_stock === null ? '#f59e0b' : '#e2e8f0'}">
            ${pt.current_stock === null ? 'NULL — bot salta questo task' : pt.current_stock + ' ' + (pt.unit || '')}
          </span>
        </div>
        <div class="mcr-kv">
          <span class="mcr-kv-k">${fieldLabel('min_cover_days')}</span>
          <span class="mcr-kv-v">${pt.min_cover_days || '— (default 2)'}</span>
        </div>
        <div class="mcr-kv">
          <span class="mcr-kv-k">${fieldLabel('expected_duration_days')}</span>
          <span class="mcr-kv-v">${pt.expected_duration_days || '—'}</span>
        </div>
        ${pt.suggested_at ? `<div class="mcr-kv">
          <span class="mcr-kv-k">Ultimo run bot</span>
          <span class="mcr-kv-v" style="font-size:11px;">${new Date(pt.suggested_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
        </div>` : ''}
      </div>`;
  }

  // ── BOM SOURCES (structured + legacy) ─────────────────────────
  if (rec) {
    const allStructured = (bom || []).filter(b => b.parent_recipe_id === rec.id);
    const legacyIngs = (() => {
      const raw = rec.ingredients;
      if (!raw) return [];
      let arr;
      if (Array.isArray(raw))           arr = raw;
      else if (typeof raw === 'string') { try { arr = JSON.parse(raw); } catch { return []; } }
      else                              arr = [raw];
      return arr.filter(i => i && (i.name || i.ingredient || i.item || i.text));
    })();

    // Structured BOM
    const bomBorderColor = allStructured.length > 0 ? '#22c55e40' : '#ef444430';
    const bomLabelColor  = allStructured.length > 0 ? '#86efac' : '#f87171';
    html += `<div class="mcr-drawer-section" style="border-color:${bomBorderColor};">
      <div class="mcr-drawer-label" style="color:${bomLabelColor};">
        🧱 Cosa scarica per 1 vendita (BOM Strutturato) — ${allStructured.length > 0 ? allStructured.length + ' componenti' : 'NESSUN COMPONENTE'}
      </div>`;
    if (allStructured.length > 0) {
      allStructured.forEach(b => {
        const cRec  = b.component_type === 'RECIPE' ? recipeById[b.sub_recipe_id] : null;
        const cIng  = b.component_type === 'ITEM'   ? ingById[b.item_id] : null;
        const cName = cRec?.title || cIng?.name || '?';
        const linked = !!(cRec || cIng);
        const typeClr = b.component_type === 'RECIPE' ? '#a5b4fc' : '#7dd3fc';
        html += `<div class="mcr-bom-row">
          <span style="font-size:12px;color:#e2e8f0;">
            ${linked ? '' : '<span style="color:#f59e0b;" title="Riga senza link">⚠ </span>'}${escH(cName)}
          </span>
          <span style="font-size:11px;color:${typeClr};font-weight:600;">${b.quantity} ${escH(b.unit || '')} · ${b.component_type}</span>
        </div>`;
      });
    } else {
      html += `<div style="font-size:12px;color:#475569;padding:4px 0;line-height:1.5;">
        Il bot non può calcolare il consumo senza componenti strutturati.
      </div>`;
    }
    html += `</div>`;

    // Legacy ingredients (only if present)
    if (legacyIngs.length > 0) {
      html += `<div class="mcr-drawer-section" style="border-color:#f59e0b40;">
        <div class="mcr-drawer-label" style="color:#fde68a;">📝 Ingredienti Editor (legacy) — ${legacyIngs.length} voci</div>
        <div style="font-size:11px;color:#94a3b8;margin-bottom:8px;line-height:1.5;">
          Visibili nel Recipe Editor ma non nel BOM strutturato — il bot non li legge.
        </div>`;
      legacyIngs.forEach(ing => {
        const ingName = ing.name || ing.ingredient || ing.item || ing.text || JSON.stringify(ing);
        const ingQty  = ing.qty  || ing.amount   || ing.quantity || '';
        const ingUnit = ing.unit || '';
        const matched = allStructured.some(b => {
          const sn = (recipeById[b.sub_recipe_id]?.title || ingById[b.item_id]?.name || '').toLowerCase();
          return sn && String(ingName).toLowerCase().includes(sn.slice(0, 5));
        });
        html += `<div class="mcr-bom-row">
          <span style="font-size:12px;color:${matched ? '#86efac' : '#fde68a'};">
            ${matched ? '✅' : '➡'} ${escH(String(ingName))}
          </span>
          <span style="font-size:11px;color:#94a3b8;">${escH(String(ingQty))} ${escH(String(ingUnit))}</span>
        </div>`;
      });
      html += `</div>`;
    }
  }

  // ── INGREDIENT GROUP (for ingredient collision problems) ───────
  if (p.detail?.ingredients?.length > 1) {
    html += `<div class="mcr-drawer-section">
      <div class="mcr-drawer-label">🧪 Gruppo Ingredienti</div>`;
    p.detail.ingredients.forEach(i => {
      const isBalsamic = i.name?.toLowerCase().includes('balsamic');
      const isPrep = i.name?.toLowerCase().includes('dressing') || i.name?.toLowerCase().includes('vinaigrette');
      const tag = isPrep ? '🥗 Prep (fatta in cucina)' : '🛒 Ingrediente acquistato';
      html += `<div class="mcr-kv">
        <span class="mcr-kv-k">${escH(i.name)}</span>
        <span class="mcr-kv-v" style="font-size:10px;color:#94a3b8;">${i.category || '—'} ${isBalsamic ? '· ' + tag : ''}</span>
      </div>`;
    });
    if (p.detail?.conflictingBOMs?.length > 0) {
      html += `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #0f172a;">
        <div style="font-size:10px;color:#f87171;font-weight:700;margin-bottom:4px;">CONFLITTI BOM</div>`;
      p.detail.conflictingBOMs.forEach(c => {
        html += `<div style="font-size:11px;color:#fca5a5;padding:2px 0;">${escH(c)}</div>`;
      });
      html += `</div>`;
    }
    html += `</div>`;
  }

  // ── POS SALES (last 30d) ──────────────────────────────────────
  if (rec?.pos_name) {
    const aliases    = rec.pos_name.split('|').filter(Boolean);
    const totalSold  = (posSales || [])
      .filter(s => aliases.some(a => s.menu_item?.toLowerCase().includes(a.toLowerCase())))
      .reduce((acc, s) => acc + (s.quantity || 0), 0);
    html += `<div class="mcr-drawer-section">
      <div class="mcr-drawer-label">💰 Vendite POS — ultimi 30 giorni</div>
      <div class="mcr-kv"><span class="mcr-kv-k">Porzioni vendute</span>
        <span class="mcr-kv-v" style="font-size:14px;color:#86efac;">${totalSold}</span></div>
      <div class="mcr-kv"><span class="mcr-kv-k">Alias controllati</span>
        <span class="mcr-kv-v" style="font-size:10px;">${escH(aliases.join(' | '))}</span></div>
    </div>`;
  }

  // ── CHEF AI RESOLVE PROTOCOL ──────────────────────────────────
  // Thin shim (mcrOQRDef) only for sold-item-legacy-ingredients async path.
  // All other types go through mcrResolveProtocol.
  const legacyOQR = mcrOQRDef(p.problemType);
  if (legacyOQR) {
    const legacyCount = p.detail && p.detail.legacyIngredients ? p.detail.legacyIngredients.length : 0;
    const oqrQuestion = legacyOQR.question
      .replace('{legacyCount}', legacyCount)
      .replace('{pl}', legacyCount === 1 ? 'e' : 'i');
    html += `<div class="mcr-drawer-section" style="border-color:#7c3aed60;background:#0d0e1f;" id="mcrOQRSection">
      <div class="mcr-drawer-label" style="color:#a78bfa;">\u{1F916} Chef AI \u2014 Domanda</div>
      <div style="font-size:13px;color:#e2e8f0;line-height:1.6;margin-bottom:12px;">${escH(oqrQuestion)}</div>
      <div style="display:flex;flex-direction:column;gap:6px;" id="mcrOQROptions">
        ${legacyOQR.options.map(o => `
          <button onclick="mcrOQRAnswer('${escH(o.value)}')"
            style="text-align:left;padding:10px 14px;background:#1e293b;border:1px solid #334155;
                   border-radius:10px;color:#e2e8f0;font-size:13px;font-family:inherit;
                   cursor:pointer;line-height:1.4;"
            onmouseover="this.style.background='#263548'" onmouseout="this.style.background='#1e293b'">
            ${escH(o.label)}
          </button>`).join('')}
      </div>
    </div>`;
  } else {
    const proto = mcrResolveProtocol(p);
    window._mcrActiveProtocol = proto;
    html += mcrRenderProtocolUI(proto, p);
  }

  // ── WRITE PLAN PLACEHOLDER ─────────────────────────────────────
  html += `<div id="mcrWritePlan" style="display:none;"></div>`;

  return html;
}

// ══════════════════════════════════════════════════════════════
// OQR ANSWER HANDLER
// ══════════════════════════════════════════════════════════════

window.mcrOQRAnswer = async function (choice) {
  const idx = window._mcrDrawerIdx;
  const p   = (window._mcrProblems || [])[idx];
  if (!p) return;

  window._mcrOQRState.answers.choice = choice;

  // Dim OQR options, highlight chosen
  document.querySelectorAll('#mcrOQROptions button').forEach(btn => {
    btn.style.opacity = '0.4';
    btn.disabled = true;
  });
  const allBtns = document.querySelectorAll('#mcrOQROptions button');
  const oqrDef  = mcrOQRDef(p.problemType);
  if (oqrDef) {
    oqrDef.options.forEach((o, i) => {
      if (o.value === choice) {
        allBtns[i].style.opacity = '1';
        allBtns[i].style.borderColor = '#7c3aed';
        allBtns[i].style.background  = '#1e1b4b';
        allBtns[i].style.color       = '#c4b5fd';
      }
    });
  }

  // ── Special handler: verify_bom — re-query recipe_bom live ──
  if (choice === 'verify_bom' && p.detail?.recipe?.id) {
    const writePlanEl = document.getElementById('mcrWritePlan');
    if (writePlanEl) {
      writePlanEl.style.display = '';
      writePlanEl.innerHTML = `
        <div class="mcr-drawer-section" style="border-color:#7c3aed40;background:#0f172a;margin-top:8px;">
          <div class="mcr-drawer-label" style="color:#a78bfa;">🔍 Verifica BOM in corso…</div>
          <div style="font-size:12px;color:#475569;">Query live su recipe_bom…</div>
        </div>`;
    }
    try {
      const sb = window.supa;
      const recipeId = p.detail.recipe.id;
      const { data: freshBOM, error } = await sb
        .from('recipe_bom')
        .select('bom_id, component_type, item_id, sub_recipe_id, quantity, unit')
        .eq('parent_recipe_id', recipeId);

      const bomCount = freshBOM?.length || 0;
      const hasError = !!error;

      if (writePlanEl) {
        if (hasError) {
          writePlanEl.innerHTML = `
            <div class="mcr-drawer-section" style="border-color:#ef444440;background:#0f172a;margin-top:8px;">
              <div class="mcr-drawer-label" style="color:#f87171;">❌ Errore query</div>
              <div style="font-size:12px;color:#94a3b8;">${escH(error.message)}</div>
            </div>`;
        } else if (bomCount > 0) {
          // BOM found — warning was wrong, show verified count
          const rowList = (freshBOM || []).map(b => `
            <div class="mcr-bom-row">
              <span style="font-size:12px;color:#86efac;">${b.component_type === 'RECIPE' ? '🔗' : '📦'} ${escH(b.item_id || b.sub_recipe_id || '?')}</span>
              <span style="font-size:11px;color:#64748b;">${b.quantity || '—'} ${escH(b.unit || '')}</span>
            </div>`).join('');
          writePlanEl.innerHTML = `
            <div class="mcr-drawer-section" style="border-color:#22c55e40;background:#0f172a;margin-top:8px;">
              <div class="mcr-drawer-label" style="color:#86efac;">✅ Verifica completata — ${bomCount} righe BOM trovate</div>
              <div style="font-size:11px;color:#64748b;margin-bottom:8px;line-height:1.5;">
                Il BOM esiste. Questo warning potrebbe essere già risolto — aggiorna la pagina per ricalcolare.
              </div>
              ${rowList}
              <button onclick="mcrRefresh()"
                style="margin-top:10px;width:100%;padding:8px;background:#1e3a5f;border:1px solid #3b82f6;
                       border-radius:8px;color:#93c5fd;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">
                ↺ Aggiorna audit
              </button>
            </div>`;
        } else {
          // Confirmed: still 0 BOM rows
          writePlanEl.innerHTML = `
            <div class="mcr-drawer-section" style="border-color:#f59e0b40;background:#0f172a;margin-top:8px;">
              <div class="mcr-drawer-label" style="color:#fde68a;">🔍 Verifica completata — 0 righe BOM</div>
              <div style="font-size:12px;color:#94a3b8;line-height:1.5;">
                Confermato: recipe_bom non ha righe per questa ricetta. Il warning è corretto.<br>
                Usa "Prepara piano conversione" per migrare gli ingredienti legacy in BOM strutturato.
              </div>
            </div>`;
        }
      }
    } catch(err) {
      if (writePlanEl) {
        writePlanEl.style.display = '';
        writePlanEl.innerHTML = `
          <div class="mcr-drawer-section" style="border-color:#ef444440;background:#0f172a;margin-top:8px;">
            <div class="mcr-drawer-label" style="color:#f87171;">❌ Errore imprevisto</div>
            <div style="font-size:12px;color:#94a3b8;">${escH(err.message)}</div>
          </div>`;
      }
    }
    return; // verify_bom handled — don't fall through to write plan
  }

  // ── Normal path: follow-up input or write plan ───────────────
  if (oqrDef) {
    const fu = oqrDef.followUp?.(choice);
    if (fu) {
      mcrShowFollowUp(fu, p, oqrDef);
      return;
    }
  }

  // Check if buildPlan returned the async sentinel
  const testPlan = oqrDef?.buildPlan?.(window._mcrOQRState.answers, p, window._mcrData);
  if (testPlan === '__async_conversion__') {
    // Intercept: run async resolver for legacy ingredient conversion
    await mcrResolveConversionPlan(p);
    return;
  }

  // Build write plan (covers review_later and all other synchronous choices)
  mcrBuildAndShowWritePlan(p, oqrDef);
};

// ── Follow-up input ────────────────────────────────────────────
function mcrShowFollowUp(fu, p, oqrDef) {
  const oqrSection = document.getElementById('mcrOQRSection');
  if (!oqrSection) return;

  const followDiv = document.createElement('div');
  followDiv.id = 'mcrFollowUp';
  followDiv.style.cssText = 'margin-top:12px;padding-top:12px;border-top:1px solid #334155;';
  followDiv.innerHTML = `
    <div style="font-size:12px;color:#94a3b8;margin-bottom:6px;">${escH(fu.label)}</div>
    <div style="display:flex;gap:8px;align-items:center;">
      <input id="mcrFollowUpInput" type="${fu.type || 'text'}"
        placeholder="${escH(fu.placeholder || '')}"
        style="flex:1;padding:8px 12px;background:#1e293b;border:1px solid #475569;border-radius:8px;
               color:#f1f5f9;font-size:13px;font-family:inherit;outline:none;" />
      <button onclick="mcrSubmitFollowUp()"
        style="padding:8px 16px;background:#7c3aed;border:none;border-radius:8px;
               color:white;font-size:13px;font-weight:600;cursor:pointer;">→</button>
    </div>`;
  oqrSection.appendChild(followDiv);
}

window.mcrSubmitFollowUp = function () {
  const idx     = window._mcrDrawerIdx;
  const p       = (window._mcrProblems || [])[idx];
  const oqrDef  = mcrOQRDef(p?.problemType);
  const val     = document.getElementById('mcrFollowUpInput')?.value?.trim();
  if (!val || !p || !oqrDef) return;

  const fu = oqrDef.followUp?.(window._mcrOQRState.answers.choice);
  if (fu) window._mcrOQRState.answers[fu.field] = val;

  mcrBuildAndShowWritePlan(p, oqrDef);
};

// ══════════════════════════════════════════════════════════════
// WRITE PLAN BUILDER + UI
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// CONVERSION PLAN RESOLVER — async legacy→BOM migration
// ══════════════════════════════════════════════════════════════
// Ingredient families that are NEVER auto-safe due to known ambiguity.
// These always go to 'review' even on exact name match.
const MCR_AMBIGUOUS_FAMILIES = [
  'parmesan', 'parmigiano', 'grana', 'pecorino',
  'balsamic', 'balsamico',
];
function mcrIsAmbiguousFamily(name) {
  const n = (name || '').toLowerCase();
  return MCR_AMBIGUOUS_FAMILIES.some(f => n.includes(f));
}

// Resolve a single legacy ingredient name against the DB.
// Returns { type, id, name, confidence, reason, candidates }
// type: 'ingredient' | 'sub_recipe' | 'ambiguous' | 'unresolved'
// confidence: 'exact' | 'fuzzy' | 'ambiguous' | 'not_found' | 'family_review'
async function mcrResolveSingleLegacyRow(rawName, sb) {
  const name = (rawName || '').trim();
  if (!name) return { type: 'unresolved', id: null, name: '', confidence: 'not_found', reason: 'Nome vuoto', candidates: [] };

  // Family check — always flag for review regardless of match quality
  if (mcrIsAmbiguousFamily(name)) {
    // Still do lookup to show candidates, but mark as family_review
    const [ri, rr] = await Promise.all([
      sb.from('ingredients').select('id,name,category').ilike('name', `%${name}%`).eq('active', true).limit(6),
      sb.from('recipes').select('id,title,menu_group').ilike('title', `%${name}%`).limit(4),
    ]);
    return {
      type:       'ambiguous',
      id:         null,
      name:       '',
      confidence: 'family_review',
      reason:     `Famiglia ambigua (${MCR_AMBIGUOUS_FAMILIES.find(f => name.toLowerCase().includes(f))}). Verifica manuale richiesta.`,
      candidates: [...(ri.data || []).map(i => ({ label: i.name, id: i.id, kind: 'ingredient', cat: i.category })),
                   ...(rr.data || []).map(r => ({ label: r.title, id: r.id, kind: 'sub_recipe', cat: r.menu_group }))],
    };
  }

  // 1. Exact match on ingredients (case-insensitive exact)
  const { data: ingExact } = await sb
    .from('ingredients').select('id,name,category')
    .ilike('name', name).eq('active', true).limit(3);
  const ingExactHits = (ingExact || []).filter(i => i.name.toLowerCase() === name.toLowerCase());

  // 2. Exact match on recipes
  const { data: recExact } = await sb
    .from('recipes').select('id,title,menu_group')
    .ilike('title', name).limit(3);
  const recExactHits = (recExact || []).filter(r => r.title.toLowerCase() === name.toLowerCase());

  const totalExact = ingExactHits.length + recExactHits.length;

  if (totalExact === 1) {
    // Exactly one exact match — safe
    if (ingExactHits.length === 1) {
      return { type: 'ingredient', id: ingExactHits[0].id, name: ingExactHits[0].name, confidence: 'exact',
               reason: `Corrispondenza esatta unica — ingrediente "${ingExactHits[0].name}"`, candidates: [] };
    } else {
      return { type: 'sub_recipe', id: recExactHits[0].id, name: recExactHits[0].title, confidence: 'exact',
               reason: `Corrispondenza esatta unica — sub-recipe "${recExactHits[0].title}"`, candidates: [] };
    }
  }

  if (totalExact > 1) {
    // Special case: exactly 1 ingredient + 1 recipe with identical name.
    // This is the "prep collision" pattern (e.g. "Arrabbiata" exists as both
    // an ingredient and a prep recipe). The recipe is the correct BOM target —
    // the ingredient is the raw purchased version, while the recipe is what
    // the chef actually uses as a subrecipe.
    // Mark as exact but annotate so Max can verify.
    if (ingExactHits.length === 1 && recExactHits.length === 1) {
      return {
        type:       'sub_recipe',
        id:         recExactHits[0].id,
        name:       recExactHits[0].title,
        confidence: 'exact',
        reason:     `Sub-recipe preferita su ingrediente con stesso nome "${recExactHits[0].title}". Verifica: se usi la versione acquistata, cambia in ingrediente.`,
        candidates: [
          { label: ingExactHits[0].name,    id: ingExactHits[0].id,  kind: 'ingredient', cat: ingExactHits[0].category },
          { label: recExactHits[0].title,   id: recExactHits[0].id,  kind: 'sub_recipe', cat: recExactHits[0].menu_group },
        ],
      };
    }
    // Multiple exact matches of the same kind — truly ambiguous
    const candidates = [
      ...ingExactHits.map(i => ({ label: i.name, id: i.id, kind: 'ingredient', cat: i.category })),
      ...recExactHits.map(r => ({ label: r.title, id: r.id, kind: 'sub_recipe', cat: r.menu_group })),
    ];
    return { type: 'ambiguous', id: null, name: '', confidence: 'ambiguous',
             reason: `${totalExact} corrispondenze esatte trovate — scelta manuale richiesta.`, candidates };
  }

  // 3. Fuzzy match
  const [riFuzz, rrFuzz] = await Promise.all([
    sb.from('ingredients').select('id,name,category').ilike('name', `%${name}%`).eq('active', true).limit(5),
    sb.from('recipes').select('id,title,menu_group').ilike('title', `%${name}%`).limit(4),
  ]);
  const ingFuzz = riFuzz.data || [];
  const recFuzz = rrFuzz.data || [];
  const totalFuzz = ingFuzz.length + recFuzz.length;

  if (totalFuzz === 1) {
    // One fuzzy match — review (not auto-safe)
    if (ingFuzz.length === 1) {
      return { type: 'ingredient', id: ingFuzz[0].id, name: ingFuzz[0].name, confidence: 'fuzzy',
               reason: `Corrispondenza parziale — "${ingFuzz[0].name}". Verificare prima di approvare.`,
               candidates: [{ label: ingFuzz[0].name, id: ingFuzz[0].id, kind: 'ingredient', cat: ingFuzz[0].category }] };
    } else {
      return { type: 'sub_recipe', id: recFuzz[0].id, name: recFuzz[0].title, confidence: 'fuzzy',
               reason: `Corrispondenza parziale — "${recFuzz[0].title}". Verificare prima di approvare.`,
               candidates: [{ label: recFuzz[0].title, id: recFuzz[0].id, kind: 'sub_recipe', cat: recFuzz[0].menu_group }] };
    }
  }

  if (totalFuzz > 1) {
    const candidates = [
      ...ingFuzz.map(i => ({ label: i.name, id: i.id, kind: 'ingredient', cat: i.category })),
      ...recFuzz.map(r => ({ label: r.title, id: r.id, kind: 'sub_recipe', cat: r.menu_group })),
    ];
    return { type: 'ambiguous', id: null, name: '', confidence: 'ambiguous',
             reason: `${totalFuzz} corrispondenze parziali — scelta manuale richiesta.`, candidates };
  }

  // No match at all
  return { type: 'unresolved', id: null, name: '', confidence: 'not_found',
           reason: 'Nessuna corrispondenza trovata nel DB. Creare nuovo ingrediente o correggere il nome.', candidates: [] };
}

// Main async conversion plan function
async function mcrResolveConversionPlan(p) {
  const writePlanEl = document.getElementById('mcrWritePlan');
  if (!writePlanEl) return;

  const legacyIngs = p.detail?.legacyIngredients || [];
  const rec        = p.detail?.recipe;
  const sb         = window.supa;

  if (!legacyIngs.length) {
    writePlanEl.style.display = '';
    writePlanEl.innerHTML = `<div class="mcr-drawer-section" style="margin-top:8px;">
      <div class="mcr-drawer-label">📋 Piano Conversione</div>
      <div style="font-size:12px;color:#475569;">Nessun ingrediente legacy trovato.</div>
    </div>`;
    return;
  }

  // Show loading state
  writePlanEl.style.display = '';
  writePlanEl.innerHTML = `
    <div class="mcr-drawer-section" style="border-color:#7c3aed40;background:#0f172a;margin-top:8px;">
      <div class="mcr-drawer-label" style="color:#a78bfa;">📋 Risoluzione ingredienti in corso…</div>
      <div style="font-size:12px;color:#475569;">${legacyIngs.length} righe da verificare nel DB…</div>
    </div>`;

  // Resolve each legacy row in parallel
  const resolved = await Promise.all(
    legacyIngs.map(async (ing, idx) => {
      const rawName = ing.name || ing.ingredient || ing.item || ing.text || '';
      const res = await mcrResolveSingleLegacyRow(rawName, sb);
      return {
        idx,
        legacy:  { name: rawName, qty: ing.qty || ing.amount || ing.quantity || '', unit: ing.unit || 'g', comment: ing.comment || '' },
        resolved: res,
      };
    })
  );

  // Detect duplicate resolved IDs — same ingredient/recipe used multiple times.
  // Duplicates are valid (e.g. Arrabbiata for pasta + Arrabbiata for chicken),
  // but should be flagged so Max can verify the notes distinguish the use.
  const idCounts = {};
  resolved.forEach(r => {
    if (r.resolved.id) {
      idCounts[r.resolved.id] = (idCounts[r.resolved.id] || 0) + 1;
    }
  });
  // Tag each resolved row with duplicate info
  resolved.forEach(r => {
    r.isDuplicate = r.resolved.id && idCounts[r.resolved.id] > 1;
    r.duplicateCount = r.resolved.id ? (idCounts[r.resolved.id] || 1) : 1;
  });

  // Bucket into safe / review / unresolved
  const safe       = resolved.filter(r => r.resolved.confidence === 'exact');
  const review     = resolved.filter(r => ['fuzzy', 'family_review'].includes(r.resolved.confidence));
  const ambiguous  = resolved.filter(r => r.resolved.confidence === 'ambiguous');
  const unresolved = resolved.filter(r => r.resolved.confidence === 'not_found');
  const dupCount   = resolved.filter(r => r.isDuplicate).length;

  // Build the plan rows for safe items (these go to mcrApprovePlan)
  const safePlan = safe.map(r => ({
    action:     'INSERT',
    table:      'recipe_bom',
    row_id:     `(new — ${r.legacy.name})`,
    field:      `parent_recipe_id = ${rec?.id?.slice(0,8)}`,
    old_value:  null,
    new_value:  `${r.legacy.qty} ${r.legacy.unit} di "${r.resolved.name}" (${r.resolved.type} ${r.resolved.id?.slice(0,8)})`,
    reason:     r.resolved.reason,
    confidence: 'exact',
    // Metadata for actual write (future Phase 2)
    _insert_data: {
      parent_recipe_id: rec?.id,
      component_type:   r.resolved.type === 'ingredient' ? 'ITEM' : 'RECIPE',
      item_id:          r.resolved.type === 'ingredient' ? r.resolved.id : null,
      sub_recipe_id:    r.resolved.type === 'sub_recipe' ? r.resolved.id : null,
      quantity:         parseFloat(r.legacy.qty) || null,
      unit:             r.legacy.unit || 'g',
      notes:            r.legacy.comment || null,
    },
  }));

  window._mcrPendingPlan = safePlan;
  window._mcrConversionResolved = resolved;

  // ── Render Conversion Plan UI ─────────────────────────────────
  const confIcon  = { exact: '✅', fuzzy: '↗', ambiguous: '⚠️', family_review: '🔍', not_found: '❌' };
  const confColor = { exact: '#22c55e', fuzzy: '#a78bfa', ambiguous: '#f59e0b', family_review: '#f59e0b', not_found: '#ef4444' };
  const confLabel = { exact: 'Esatta — sicura', fuzzy: 'Parziale — verifica', ambiguous: 'Ambigua — scelta manuale', family_review: 'Famiglia ambigua — verifica', not_found: 'Non trovato' };

  let html = `
    <div class="mcr-drawer-section" style="border-color:#0ea5e960;background:#0f1f2e;margin-top:8px;" id="mcrConversionPlan">
      <div class="mcr-drawer-label" style="color:#7dd3fc;">📋 Piano Conversione BOM — ${legacyIngs.length} ingredienti</div>
      <div style="font-size:11px;color:#94a3b8;margin-bottom:12px;line-height:1.5;">
        ✅ ${safe.length} sicuri · ↗ ${review.length} da verificare · ⚠️ ${ambiguous.length} ambigui · ❌ ${unresolved.length} non trovati${dupCount > 0 ? ` · 🔁 ${dupCount} riga${dupCount > 1 ? 'e' : ''} con stesso ingrediente (usi distinti)` : ''}
        ${!MAPPING_WRITE_ENABLED ? '<br><span style="color:#f59e0b;font-weight:700;">⚠️ WRITE DISABLED — Phase 2 required per la scrittura</span>' : ''}
      </div>`;

  // Render each resolved row
  resolved.forEach(r => {
    const res  = r.resolved;
    const leg  = r.legacy;
    const icon  = confIcon[res.confidence]  || '?';
    const color = confColor[res.confidence] || '#64748b';
    const label = confLabel[res.confidence] || res.confidence;
    // Rows needing manual selection
    const needsReview = ['fuzzy','family_review','ambiguous'].includes(res.confidence);
    // Row that was manually selected by user
    const isSelected = res.confidence === 'user_selected';

    html += `
      <div id="mcr-conv-row-${r.idx}"
           style="background:#1e293b;border:1px solid #334155;border-left:3px solid ${color};
                  border-radius:10px;padding:10px 12px;margin-bottom:8px;">
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px;gap:8px;">
          <div style="font-size:13px;font-weight:600;color:#f1f5f9;">${icon} ${escH(leg.name || '—')}</div>
          <div style="font-size:11px;color:#94a3b8;flex-shrink:0;">${escH(leg.qty)} ${escH(leg.unit)}</div>
        </div>`;

    if ((res.type === 'ingredient' || res.type === 'sub_recipe') && res.id && !needsReview) {
      html += `
        <div style="font-size:11px;color:${color};font-weight:600;margin-bottom:4px;">
          → ${res.type === 'ingredient' ? 'Ingrediente' : 'Sub-recipe'}: <strong>${escH(res.name)}</strong>
          <span style="font-size:9px;color:#475569;margin-left:4px;">${escH(res.id.slice(0,8))}…</span>
        </div>`;
    }

    if (isSelected) {
      html += `
        <div style="font-size:11px;color:#22c55e;font-weight:600;margin-bottom:4px;">
          ✅ Selezionato: ${res.type === 'ingredient' ? 'Ingrediente' : 'Sub-recipe'} <strong>${escH(res.name)}</strong>
          <span style="font-size:9px;color:#475569;margin-left:4px;">${escH(res.id?.slice(0,8))}…</span>
          <button onclick="mcrClearSelection(${r.idx})"
            style="margin-left:8px;font-size:10px;padding:1px 7px;background:#1e293b;border:1px solid #334155;
                   border-radius:5px;color:#94a3b8;cursor:pointer;">✕ Cambia</button>
        </div>`;
    }

    html += `
        <div style="font-size:10px;font-weight:700;color:${color};letter-spacing:.3px;margin-bottom:2px;">${escH(label)}</div>
        <div style="font-size:10px;color:#64748b;line-height:1.4;">${escH(res.reason)}</div>`;

    // For review rows: show "Seleziona →" button instead of passive candidate list
    if (needsReview && !isSelected) {
      html += `
        <div style="margin-top:8px;">
          <button onclick="mcrOpenReviewPanel(${r.idx})"
            style="width:100%;padding:7px 12px;background:#1e1b4b;border:1px solid #7c3aed;border-radius:8px;
                   color:#c4b5fd;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;text-align:left;">
            🔍 Seleziona target per questo ingrediente →
          </button>
        </div>`;
    }

    // Passive candidate list only for already-selected rows (show as context)
    if (isSelected && res.candidates?.length > 0) {
      html += `<div style="margin-top:4px;">
        <div style="font-size:9px;color:#334155;margin-bottom:2px;">Altri candidati ignorati:</div>`;
      res.candidates.forEach(c => {
        if (c.id !== res.id) {
          html += `<div style="font-size:10px;color:#334155;padding:1px 0;">
            ${c.kind === 'ingredient' ? '📦' : '🔗'} ${escH(c.label)}
            <span style="font-size:9px;color:#1e293b;margin-left:4px;">${escH(c.id.slice(0,8))}…</span>
          </div>`;
        }
      });
      html += `</div>`;
    }

    // Duplicate-use badge: same ingredient appears more than once in the recipe
    if (r.isDuplicate) {
      html += `
        <div style="margin-top:6px;padding:4px 8px;background:#1a1f2e;border:1px solid #f59e0b40;
                    border-radius:6px;display:flex;align-items:flex-start;gap:6px;">
          <span style="font-size:12px;flex-shrink:0;">🔁</span>
          <div>
            <div style="font-size:10px;font-weight:700;color:#f59e0b;margin-bottom:1px;">
              Stesso ingrediente usato ${r.duplicateCount} volte in questa ricetta
            </div>
            <div style="font-size:10px;color:#78350f;line-height:1.4;">
              Verifica che le note distinguano l'uso (es. "per pasta" / "per pollo").
              Se è un errore, rimuovi la riga duplicata nel Recipe Editor.
            </div>
          </div>
        </div>`;
    }

    if (leg.comment) {
      html += `<div style="font-size:10px;color:#64748b;margin-top:4px;font-style:italic;">📝 nota: ${escH(leg.comment)}</div>`;
    } else if (r.isDuplicate) {
      html += `<div style="font-size:10px;color:#f59e0b;margin-top:3px;">⚠️ Nessuna nota — aggiungi nota per distinguere l'uso.</div>`;
    }

    html += `</div>`;
  });

  // Action buttons
  const safeCount     = safe.length;
  const selectedCount = resolved.filter(r => r.resolved.confidence === 'user_selected').length;
  html += `
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;" id="mcrConvActionBtns">
        <button onclick="mcrApproveSafeConversions()"
          style="width:100%;padding:10px;border-radius:10px;font-size:13px;font-weight:700;
                 cursor:pointer;font-family:inherit;
                 ${MAPPING_WRITE_ENABLED && safeCount > 0
                   ? 'background:#059669;border:none;color:white;'
                   : 'background:#1e293b;border:1px solid #334155;color:#475569;'}">
          ${MAPPING_WRITE_ENABLED ? (safeCount > 0 ? `✅ Approva ${safeCount} match esatti` : '— Nessun match esatto') : `🔒 Approva ${safeCount} match esatti (Write Disabled)`}
        </button>
        <button id="mcrApproveSelectedBtn" onclick="mcrApproveSelectedConversions()"
          style="width:100%;padding:10px;border-radius:10px;font-size:13px;font-weight:700;
                 cursor:pointer;font-family:inherit;display:${selectedCount > 0 ? 'block' : 'none'};
                 background:#1e1b4b;border:1px solid #7c3aed;color:#c4b5fd;">
          ✋ Approva ${selectedCount} selezionati manualmente
        </button>
        <button onclick="mcrCancelPlan()"
          style="width:100%;padding:10px;background:#1e293b;border:1px solid #334155;border-radius:10px;
                 color:#64748b;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">
          Annulla
        </button>
      </div>
    </div>`;

  writePlanEl.innerHTML = html;
}

// Approve only the 'exact' confidence safe matches
window.mcrApproveSafeConversions = async function () {
  const plan = (window._mcrPendingPlan || []).filter(r => r.confidence === 'exact');
  if (!plan.length) return;

  if (!MAPPING_WRITE_ENABLED) {
    console.log('[MCR] Write gate — safe conversions plan logged:', JSON.stringify(plan, null, 2));
    const btn = document.querySelector('#mcrConversionPlan button');
    const noticeEl = document.createElement('div');
    noticeEl.style.cssText = 'background:#1c1400;border:1px solid #78350f;border-radius:10px;padding:10px;margin-top:8px;';
    noticeEl.innerHTML = `
      <div style="font-size:12px;color:#fde68a;font-weight:700;margin-bottom:4px;">🔒 Phase 2 Required — Write Disabled</div>
      <div style="font-size:11px;color:#92400e;line-height:1.5;">
        Piano con ${plan.length} match esatti registrato in console.<br>
        Per abilitare le scritture, imposta <code style="color:#fde68a;">MAPPING_WRITE_ENABLED = true</code>.
      </div>`;
    document.getElementById('mcrConversionPlan')?.appendChild(noticeEl);
    return;
  }
  // Phase 2: actual write path — same as mcrApprovePlan but only safe rows
  // (implementation deferred until MAPPING_WRITE_ENABLED=true session)
};

// ══════════════════════════════════════════════════════════════
// REVIEW PANEL — interactive candidate selection for fuzzy/ambiguous rows
// ══════════════════════════════════════════════════════════════

// Open the review panel for a specific row index
window.mcrOpenReviewPanel = function (rowIdx) {
  const resolved = window._mcrConversionResolved || [];
  const item = resolved.find(r => r.idx === rowIdx);
  if (!item) return;

  // Remove any existing panel
  document.getElementById('mcrReviewPanel')?.remove();

  const drawer = document.getElementById('mcrDrawer');
  if (!drawer) return;

  const panel = document.createElement('div');
  panel.id = 'mcrReviewPanel';
  panel.style.cssText = [
    'position:sticky;bottom:0;left:0;right:0;',
    'background:#0f172a;border-top:2px solid #7c3aed;',
    'padding:14px 16px 20px;z-index:20;',
    'max-height:70vh;overflow-y:auto;-webkit-overflow-scrolling:touch;',
  ].join('');

  const leg = item.legacy;
  const res = item.resolved;

  // Build candidate HTML
  const candidateHTML = (res.candidates || []).map((cand, ci) => `
    <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;
                padding:10px 12px;margin-bottom:8px;display:flex;align-items:center;
                justify-content:space-between;gap:8px;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;color:#f1f5f9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${cand.kind === 'ingredient' ? '📦' : '🔗'} ${escH(cand.label)}
        </div>
        <div style="font-size:10px;color:#475569;margin-top:1px;">
          ${escH(cand.kind === 'ingredient' ? 'Ingrediente' : 'Sub-recipe')} · ${escH(cand.cat || '')} · ${cand.id.slice(0,8)}…
        </div>
      </div>
      <button onclick="mcrSelectCandidate(${rowIdx}, ${ci})"
        style="flex-shrink:0;padding:6px 14px;background:#7c3aed;border:none;border-radius:8px;
               color:white;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">
        Seleziona
      </button>
    </div>`).join('');

  const noCandidateMsg = !res.candidates?.length
    ? `<div style="font-size:12px;color:#475569;padding:8px 0;">
         Nessun candidato suggerito — usa la ricerca manuale.
       </div>`
    : '';

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
      <div>
        <div style="font-size:14px;font-weight:700;color:#c4b5fd;">🔍 Seleziona target per:</div>
        <div style="font-size:13px;color:#f1f5f9;margin-top:2px;">
          <strong>${escH(leg.name)}</strong> — ${escH(String(leg.qty))} ${escH(leg.unit)}
          ${leg.comment ? `<span style="font-size:11px;color:#64748b;"> (${escH(leg.comment)})</span>` : ''}
        </div>
        <div style="font-size:10px;color:#f59e0b;margin-top:4px;line-height:1.4;">${escH(res.reason)}</div>
      </div>
      <button onclick="document.getElementById('mcrReviewPanel')?.remove()"
        style="background:none;border:none;color:#475569;font-size:18px;cursor:pointer;flex-shrink:0;">✕</button>
    </div>

    ${res.candidates?.length > 0 ? `<div style="font-size:10px;font-weight:700;color:#475569;margin-bottom:8px;letter-spacing:.5px;">CANDIDATI TROVATI NEL DB</div>` : ''}
    ${candidateHTML}
    ${noCandidateMsg}

    <!-- Manual search -->
    <div style="margin-top:10px;padding-top:10px;border-top:1px solid #1e293b;">
      <div style="font-size:10px;font-weight:700;color:#475569;margin-bottom:6px;letter-spacing:.5px;">CERCA MANUALMENTE</div>
      <div style="display:flex;gap:8px;">
        <input id="mcrReviewSearch" type="text" placeholder="Nome ingrediente o ricetta…"
          style="flex:1;padding:8px 12px;background:#1e293b;border:1px solid #334155;border-radius:8px;
                 color:#f1f5f9;font-size:13px;font-family:inherit;outline:none;" />
        <button onclick="mcrRunReviewSearch(${rowIdx})"
          style="padding:8px 14px;background:#1e40af;border:none;border-radius:8px;
                 color:#bfdbfe;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">🔎</button>
      </div>
      <div id="mcrReviewSearchResults" style="margin-top:8px;"></div>
    </div>

    <!-- Actions -->
    <div style="display:flex;gap:8px;margin-top:12px;">
      <button onclick="mcrLeaveUnresolved(${rowIdx})"
        style="flex:1;padding:9px;background:#1e293b;border:1px solid #334155;border-radius:8px;
               color:#64748b;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">
        Lascia non risolto
      </button>
      <button onclick="document.getElementById('mcrReviewPanel')?.remove()"
        style="flex:1;padding:9px;background:#1e293b;border:1px solid #334155;border-radius:8px;
               color:#64748b;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">
        Annulla
      </button>
    </div>`;

  // Append to drawer (sticky bottom)
  drawer.appendChild(panel);
  panel.scrollIntoView({ behavior: 'smooth', block: 'end' });
};

// Run a live search from the review panel
window.mcrRunReviewSearch = async function (rowIdx) {
  const q   = document.getElementById('mcrReviewSearch')?.value?.trim();
  const res = document.getElementById('mcrReviewSearchResults');
  if (!q || !res) return;

  res.innerHTML = `<div style="font-size:11px;color:#475569;">Ricerca…</div>`;

  const sb = window.supa;
  const [ri, rr] = await Promise.all([
    sb.from('ingredients').select('id,name,category').ilike('name',`%${q}%`).eq('active',true).limit(6),
    sb.from('recipes').select('id,title,menu_group').ilike('title',`%${q}%`).limit(4),
  ]);

  const ings = ri.data || [], recs = rr.data || [];
  if (!ings.length && !recs.length) {
    res.innerHTML = `<div style="font-size:11px;color:#ef4444;">Nessun risultato per "${escH(q)}"</div>`;
    return;
  }

  // Add search results temporarily to the resolved item's candidates
  const resolved = window._mcrConversionResolved || [];
  const item = resolved.find(r => r.idx === rowIdx);
  if (item) {
    const newCandidates = [
      ...ings.map(i => ({ label: i.name,  id: i.id,  kind: 'ingredient', cat: i.category })),
      ...recs.map(r => ({ label: r.title, id: r.id,  kind: 'sub_recipe', cat: r.menu_group })),
    ];
    // Merge with existing candidates (dedupe by id)
    const existingIds = new Set((item.resolved.candidates || []).map(c => c.id));
    newCandidates.forEach(nc => { if (!existingIds.has(nc.id)) item.resolved.candidates.push(nc); });
  }

  const html = [...ings, ...recs].map((hit, i) => {
    const isIng = i < ings.length;
    const id    = hit.id, label = isIng ? hit.name : hit.title, cat = isIng ? hit.category : hit.menu_group;
    // Find index in candidates array
    const resolved2 = window._mcrConversionResolved || [];
    const item2 = resolved2.find(r => r.idx === rowIdx);
    const candIdx = (item2?.resolved.candidates || []).findIndex(c => c.id === id);
    return `
      <div style="background:#1e293b;border:1px solid #334155;border-radius:8px;
                  padding:8px 10px;margin-bottom:6px;display:flex;align-items:center;
                  justify-content:space-between;gap:8px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:600;color:#f1f5f9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${isIng ? '📦' : '🔗'} ${escH(label)}
          </div>
          <div style="font-size:10px;color:#475569;">${escH(isIng ? 'Ingrediente' : 'Sub-recipe')} · ${escH(cat || '')} · ${id.slice(0,8)}…</div>
        </div>
        <button onclick="mcrSelectCandidate(${rowIdx}, ${candIdx >= 0 ? candIdx : 99})"
          style="flex-shrink:0;padding:5px 12px;background:#7c3aed;border:none;border-radius:7px;
                 color:white;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">
          Seleziona
        </button>
      </div>`;
  }).join('');
  res.innerHTML = html;
};

// User selected a specific candidate for a review row
window.mcrSelectCandidate = function (rowIdx, candIdx) {
  const resolved = window._mcrConversionResolved;
  if (!resolved) return;

  const item = resolved.find(r => r.idx === rowIdx);
  if (!item) return;

  const cand = item.resolved.candidates?.[candIdx];
  if (!cand) return;

  // Update the resolved item with user selection
  const oldConf = item.resolved.confidence;
  item.resolved = {
    ...item.resolved,
    type:       cand.kind === 'ingredient' ? 'ingredient' : 'sub_recipe',
    id:         cand.id,
    name:       cand.label,
    confidence: 'user_selected',
    reason:     `Selezionato manualmente da Chef Max (era: ${oldConf})`,
  };

  // Rebuild the pending plan to include this user_selected row
  mcrRebuildPlanFromResolved();

  // Close review panel
  document.getElementById('mcrReviewPanel')?.remove();

  // Update the row card in the DOM
  mcrUpdateRowCard(rowIdx);

  // Update counters + buttons
  mcrUpdateConversionCounters();
};

// User decides to leave a row unresolved
window.mcrLeaveUnresolved = function (rowIdx) {
  const resolved = window._mcrConversionResolved;
  if (!resolved) return;
  const item = resolved.find(r => r.idx === rowIdx);
  if (item) {
    item.resolved.confidence = 'not_found';
    item.resolved.reason = 'Lasciato non risolto da Chef Max.';
  }
  document.getElementById('mcrReviewPanel')?.remove();
  mcrUpdateRowCard(rowIdx);
  mcrUpdateConversionCounters();
};

// Clear a manual selection (revert to original confidence)
window.mcrClearSelection = function (rowIdx) {
  const resolved = window._mcrConversionResolved;
  if (!resolved) return;
  const item = resolved.find(r => r.idx === rowIdx);
  if (!item) return;
  // Revert to family_review/ambiguous
  item.resolved.confidence = item.resolved._originalConfidence || 'ambiguous';
  item.resolved.id   = null;
  item.resolved.name = '';
  item.resolved.reason = 'Selezione annullata — scegli di nuovo.';
  document.getElementById('mcrReviewPanel')?.remove();
  mcrUpdateRowCard(rowIdx);
  mcrRebuildPlanFromResolved();
  mcrUpdateConversionCounters();
};

// Rebuild mcrPendingPlan from current resolved state
function mcrRebuildPlanFromResolved() {
  const resolved = window._mcrConversionResolved || [];
  const rec = (window._mcrProblems || [])[window._mcrDrawerIdx]?.detail?.recipe;

  const approvable = resolved.filter(r =>
    r.resolved.confidence === 'exact' || r.resolved.confidence === 'user_selected'
  );

  window._mcrPendingPlan = approvable.map(r => ({
    action:     'INSERT',
    table:      'recipe_bom',
    row_id:     `(new — ${r.legacy.name})`,
    field:      `parent_recipe_id = ${rec?.id?.slice(0,8)}`,
    old_value:  null,
    new_value:  `${r.legacy.qty} ${r.legacy.unit} di "${r.resolved.name}" (${r.resolved.type} ${r.resolved.id?.slice(0,8)})`,
    reason:     r.resolved.reason,
    confidence: r.resolved.confidence,
    _insert_data: {
      parent_recipe_id: rec?.id,
      component_type:   r.resolved.type === 'ingredient' ? 'ITEM' : 'RECIPE',
      item_id:          r.resolved.type === 'ingredient' ? r.resolved.id : null,
      sub_recipe_id:    r.resolved.type === 'sub_recipe' ? r.resolved.id : null,
      quantity:         parseFloat(r.legacy.qty) || null,
      unit:             r.legacy.unit || 'g',
      notes:            r.legacy.comment || null,
    },
  }));
}

// Update a single row card in-place after selection
function mcrUpdateRowCard(rowIdx) {
  const resolved = window._mcrConversionResolved || [];
  const item = resolved.find(r => r.idx === rowIdx);
  if (!item) return;

  const rowEl = document.getElementById(`mcr-conv-row-${rowIdx}`);
  if (!rowEl) return;

  const res  = item.resolved;
  const leg  = item.legacy;
  const confIcon  = { exact: '✅', fuzzy: '↗', ambiguous: '⚠️', family_review: '🔍', not_found: '❌', user_selected: '✅' };
  const confColor = { exact: '#22c55e', fuzzy: '#a78bfa', ambiguous: '#f59e0b', family_review: '#f59e0b', not_found: '#ef4444', user_selected: '#22c55e' };
  const confLabel = { exact: 'Esatta — sicura', fuzzy: 'Parziale — verifica', ambiguous: 'Ambigua — scelta manuale', family_review: 'Famiglia ambigua — verifica', not_found: 'Non trovato / lasciato', user_selected: 'Selezionato manualmente' };

  const color = confColor[res.confidence] || '#64748b';
  const icon  = confIcon[res.confidence]  || '?';
  const label = confLabel[res.confidence] || res.confidence;
  const isSelected = res.confidence === 'user_selected';
  const needsReview = ['fuzzy','family_review','ambiguous'].includes(res.confidence);

  rowEl.style.borderLeftColor = color;

  let inner = `
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px;gap:8px;">
      <div style="font-size:13px;font-weight:600;color:#f1f5f9;">${icon} ${escH(leg.name || '—')}</div>
      <div style="font-size:11px;color:#94a3b8;flex-shrink:0;">${escH(String(leg.qty))} ${escH(leg.unit)}</div>
    </div>`;

  if (isSelected) {
    inner += `
      <div style="font-size:11px;color:#22c55e;font-weight:600;margin-bottom:6px;">
        ✅ ${res.type === 'ingredient' ? 'Ingrediente' : 'Sub-recipe'}: <strong>${escH(res.name)}</strong>
        <span style="font-size:9px;color:#475569;margin-left:4px;">${escH(res.id?.slice(0,8))}…</span>
        <button onclick="mcrClearSelection(${rowIdx})"
          style="margin-left:8px;font-size:10px;padding:1px 7px;background:#1e293b;border:1px solid #334155;
                 border-radius:5px;color:#94a3b8;cursor:pointer;">✕ Cambia</button>
      </div>
      <div style="font-size:10px;font-weight:700;color:${color};margin-bottom:2px;">${escH(label)}</div>
      <div style="font-size:10px;color:#64748b;line-height:1.4;">${escH(res.reason)}</div>`;
  } else if (needsReview) {
    inner += `
      <div style="font-size:10px;font-weight:700;color:${color};margin-bottom:2px;">${escH(label)}</div>
      <div style="font-size:10px;color:#64748b;line-height:1.4;margin-bottom:8px;">${escH(res.reason)}</div>
      <button onclick="mcrOpenReviewPanel(${rowIdx})"
        style="width:100%;padding:7px 12px;background:#1e1b4b;border:1px solid #7c3aed;border-radius:8px;
               color:#c4b5fd;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;text-align:left;">
        🔍 Seleziona target per questo ingrediente →
      </button>`;
  } else {
    inner += `
      <div style="font-size:10px;font-weight:700;color:${color};margin-bottom:2px;">${escH(label)}</div>
      <div style="font-size:10px;color:#64748b;line-height:1.4;">${escH(res.reason)}</div>`;
  }

  if (leg.comment) {
    inner += `<div style="font-size:10px;color:#64748b;margin-top:4px;font-style:italic;">📝 nota: ${escH(leg.comment)}</div>`;
  }

  rowEl.innerHTML = inner;
}

// Recount buckets and update counters + buttons in the UI
function mcrUpdateConversionCounters() {
  const resolved = window._mcrConversionResolved || [];
  const safeCount     = resolved.filter(r => r.resolved.confidence === 'exact').length;
  const selectedCount = resolved.filter(r => r.resolved.confidence === 'user_selected').length;
  const reviewCount   = resolved.filter(r => ['fuzzy','family_review','ambiguous'].includes(r.resolved.confidence)).length;
  const unresolvedCnt = resolved.filter(r => r.resolved.confidence === 'not_found').length;

  // Update summary line
  const summaryEl = document.querySelector('#mcrConversionPlan > div:nth-child(2)');
  if (summaryEl) {
    const dupCount = resolved.filter(r => r.isDuplicate).length;
    summaryEl.innerHTML = `
      ✅ ${safeCount} esatti · ✋ ${selectedCount} selezionati · ↗ ${reviewCount} da verificare · ❌ ${unresolvedCnt} non trovati
      ${dupCount > 0 ? ` · 🔁 ${dupCount} riga${dupCount > 1 ? 'e' : ''} con stesso ingrediente` : ''}
      ${!MAPPING_WRITE_ENABLED ? '<br><span style="color:#f59e0b;font-weight:700;">⚠️ WRITE DISABLED</span>' : ''}`;
  }

  // Show/hide "Approva selezionati" button
  const selBtn = document.getElementById('mcrApproveSelectedBtn');
  if (selBtn) {
    selBtn.style.display = selectedCount > 0 ? 'block' : 'none';
    selBtn.textContent = `✋ Approva ${selectedCount} selezionati manualmente`;
  }
}

// Approve only user_selected rows (manual selections)
window.mcrApproveSelectedConversions = function () {
  const plan = (window._mcrPendingPlan || []).filter(r => r.confidence === 'user_selected');
  if (!plan.length) return;

  if (!MAPPING_WRITE_ENABLED) {
    console.log('[MCR] Write gate — user_selected conversions:', JSON.stringify(plan, null, 2));
    const noticeEl = document.createElement('div');
    noticeEl.style.cssText = 'background:#1c1400;border:1px solid #78350f;border-radius:10px;padding:10px;margin-top:8px;';
    noticeEl.innerHTML = `
      <div style="font-size:12px;color:#fde68a;font-weight:700;margin-bottom:4px;">🔒 Phase 2 Required — Write Disabled</div>
      <div style="font-size:11px;color:#92400e;line-height:1.5;">
        Piano con ${plan.length} selezioni manuali registrato in console.<br>
        Imposta <code style="color:#fde68a;">MAPPING_WRITE_ENABLED = true</code> per abilitare la scrittura.
      </div>`;
    document.getElementById('mcrConversionPlan')?.appendChild(noticeEl);
    return;
  }
  // Phase 2: actual write path for user_selected rows
};

function mcrBuildAndShowWritePlan(p, oqrDef) {
  const writePlanEl = document.getElementById('mcrWritePlan');
  if (!writePlanEl) return;

  const plan = oqrDef?.buildPlan?.(window._mcrOQRState.answers, p, window._mcrData) || [];
  window._mcrPendingPlan = plan;

  if (plan.length === 0) {
    const proto = window._mcrActiveProtocol;
    writePlanEl.style.display = '';
    if (proto && (proto.editorActions || proto.editorAction)) {
      writePlanEl.innerHTML = mcrRenderEditorActions(proto);
    } else if (proto && proto.state === 'NO_SAVE_TARGET') {
      writePlanEl.innerHTML = mcrRenderProtocolUI(proto, (window._mcrProblems||[])[window._mcrDrawerIdx]);
    } else {
      writePlanEl.style.display = 'none';
    }
    return;
  }

  let planHTML = `
    <div class="mcr-drawer-section" style="border-color:#0ea5e960;background:#0f1f2e;margin-top:8px;">
      <div class="mcr-drawer-label" style="color:#7dd3fc;">📋 Piano di Modifica DB</div>
      <div style="font-size:11px;color:#94a3b8;margin-bottom:10px;line-height:1.5;">
        Controlla ogni modifica prima di approvare.
        ${MAPPING_WRITE_ENABLED ? '' : '<span style="color:#f59e0b;font-weight:700;"> ⚠️ WRITE DISABLED — Phase 2 required</span>'}
      </div>`;

  plan.forEach(function(row) {
    planHTML += mcrRenderWritePlanRow(row);
  });

  planHTML += `
      <div style="display:flex;gap:8px;margin-top:4px;">
        <button onclick="mcrApprovePlan()"
          style="flex:1;padding:10px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;
                 ${MAPPING_WRITE_ENABLED
                   ? 'background:#059669;border:none;color:white;'
                   : 'background:#1e293b;border:1px solid #334155;color:#475569;cursor:not-allowed;'}">
          ${MAPPING_WRITE_ENABLED ? '✅ Approva e Salva' : '🔒 Approve (Write Disabled)'}
        </button>
        <button onclick="mcrCancelPlan()"
          style="padding:10px 16px;background:#1e293b;border:1px solid #334155;border-radius:10px;
                 color:#94a3b8;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">
          Annulla
        </button>
      </div>
    </div>`;

  writePlanEl.style.display = '';
  writePlanEl.innerHTML = planHTML;
}

// ══════════════════════════════════════════════════════════════
// APPROVE / CANCEL HANDLERS
// ══════════════════════════════════════════════════════════════

window.mcrApprovePlan = async function () {
  const plan = window._mcrPendingPlan || [];
  if (!plan.length) return;

  // ── WRITE GATE — NEVER REMOVES WITHOUT EXPLICIT FLAG ──────────
  if (!MAPPING_WRITE_ENABLED) {
    console.log('[MCR] Write gate active — MAPPING_WRITE_ENABLED=false. Plan logged:', JSON.stringify(plan, null, 2));
    const el = document.getElementById('mcrWritePlan');
    if (el) {
      el.innerHTML += `
        <div style="background:#1c1400;border:1px solid #78350f;border-radius:10px;padding:12px;margin-top:8px;">
          <div style="font-size:12px;color:#fde68a;font-weight:700;margin-bottom:4px;">🔒 Phase 2 Required — Write Disabled</div>
          <div style="font-size:11px;color:#92400e;line-height:1.5;">
            Le modifiche sono state registrate in console per revisione.<br>
            Per abilitare le scritture, imposta <code style="color:#fde68a;">MAPPING_WRITE_ENABLED = true</code>
            in una sessione dedicata con DB Write Plan approvato da Max.
          </div>
        </div>`;
    }
    return;
  }

  // ── FUTURE WRITE PATH (only reachable when MAPPING_WRITE_ENABLED=true) ──
  const sb = window.supa;
  const approvedAt = new Date().toISOString();
  const approvedBy = window.user?.name || 'Max';
  const results = [];

  for (const row of plan) {
    try {
      let res;
      if (row.action === 'UPDATE') {
        res = await sb.from(row.table).update({ [row.field]: row.new_value }).eq('id', row.row_id);
      } else if (row.action === 'INSERT') {
        res = await sb.from(row.table).insert({ ...row.insert_data });
      }
      // DELETE is intentionally not implemented — always requires manual action
      if (res?.error) {
        results.push({ row, status: 'error', error: res.error.message });
      } else {
        // Read-back verification
        const { data: verified } = await sb.from(row.table).select(row.field).eq('id', row.row_id).single();
        const ok = verified?.[row.field] == row.new_value;
        results.push({ row, status: ok ? 'ok' : 'mismatch', readBack: verified?.[row.field] });

        // Write audit log
        await sb.from('mapping_audit_log').insert({
          table_name:   row.table,
          row_id:       String(row.row_id),
          field_name:   row.field,
          old_value:    String(row.old_value ?? ''),
          new_value:    String(row.new_value ?? ''),
          reason:       row.reason || '',
          approved_by:  approvedBy,
          approved_at:  approvedAt,
          problem_type: (window._mcrProblems || [])[window._mcrDrawerIdx]?.problemType || '',
        }).catch(() => {}); // audit log failure is non-fatal
      }
    } catch (err) {
      results.push({ row, status: 'exception', error: err.message });
    }
  }

  mcrShowWriteResult(results);
};

window.mcrCancelPlan = function () {
  window._mcrPendingPlan = [];
  const el = document.getElementById('mcrWritePlan');
  if (el) { el.style.display = 'none'; el.innerHTML = ''; }
  // Reset OQR
  window._mcrOQRState = { step: 'info', answers: {} };
  const oqrOpts = document.getElementById('mcrOQROptions');
  if (oqrOpts) {
    oqrOpts.querySelectorAll('button').forEach(btn => {
      btn.style.opacity = '1';
      btn.style.borderColor = '#334155';
      btn.style.background  = '#1e293b';
      btn.style.color       = '#e2e8f0';
      btn.disabled = false;
    });
  }
  document.getElementById('mcrFollowUp')?.remove();
};

// ── Write result display ───────────────────────────────────────
function mcrShowWriteResult(results) {
  const el = document.getElementById('mcrWritePlan');
  if (!el) return;

  let html = `<div class="mcr-drawer-section" style="border-color:#0ea5e960;background:#0f1f2e;margin-top:8px;">
    <div class="mcr-drawer-label" style="color:#7dd3fc;">🔍 Verifica Post-Scrittura</div>`;

  results.forEach(r => {
    const ok    = r.status === 'ok';
    const clr   = ok ? '#22c55e' : '#ef4444';
    const icon  = ok ? '✅' : '❌';
    const label = ok ? 'Verificato OK' : (r.status === 'mismatch' ? `Mismatch — letto: ${r.readBack}` : `Errore: ${r.error}`);
    html += `<div class="mcr-kv">
      <span class="mcr-kv-k">${escH(fieldLabel(r.row.field))}</span>
      <span class="mcr-kv-v" style="color:${clr};">${icon} ${escH(label)}</span>
    </div>`;
  });

  html += `</div>`;
  el.innerHTML = html;
}

// ── Utility ───────────────────────────────────────────────────
function escH(str) {
  return (str || '').toString()
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}
