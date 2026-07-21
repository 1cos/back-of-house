// ── RECIPE CONTROL TABLE v2 — js/admin-recipe-control.js ─────────────────────
// Admin-only spreadsheet: view + edit all recipe fields + linked prep data.
// v2: full dropdown + multi-table save (recipes / prep_tasks / prep_task_classifications).
//
// DB WRITE MAPPING (verified against live schema):
//   recipes.*                       → UPDATE recipes SET col=val WHERE id=recipe_id
//   prep_tasks.category (Station)   → UPDATE prep_tasks SET category=val WHERE id=pt_id
//   prep_task_classifications.production_family / work_type
//                                   → UPDATE prep_task_classifications SET col=val WHERE prep_task_id=pt_id
//
// RULES:
//   - NULL preserved as NULL, never coerced to '' or 0
//   - serving_weight_g: editable, never auto-calculated
//   - If recipe has >1 prep_task, user picks which one to edit before save
//   - Save is per-row only; no bulk write
//   - Read-back after every save
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ── Canonical option lists ─────────────────────────────────────────────────
  // production_family: from CHECK constraint chk_ptc_production_family
  const PRODUCTION_FAMILIES = [
    'weekly_batch','daily_fresh','frozen_production','vendor_driven','opportunistic'
  ];
  // work_type: from CHECK constraint chk_ptc_work_type
  const WORK_TYPES = [
    'quantitative_prep','operational_action','stock_check','station_setup','cleaning'
  ];
  // menu_group: authoritative list from the Recipe Editor (plus values found in DB)
  const MENU_GROUPS = [
    'Antipasti','Primi','Secondi','Table Side','Salads','Sides',
    'Soups','Desserts','Sauces','Bases','Finger Food','Catering','Add-ons',
    // legacy values found in live DB — kept so existing rows can be read
    'Entrees','Pasta','Kids menu','Protein','Proteins'
  ];
  // serving_unit: canonical list; user can still set NULL
  const SERVING_UNITS = [
    'g','kg','pezzi','porzione','nests','cup','filetto','ml','l','oz','lb'
  ];

  // Stations are loaded live from prep_tasks.category at startup
  let STATIONS = [];

  // ── Column definitions ─────────────────────────────────────────────────────
  // type: 'text' | 'number-int' | 'number-decimal' | 'select' | 'textarea' | 'readonly'
  // table: which DB table owns this column
  const COLS = [
    { key:'id',                  label:'ID',                   db:'recipes.id',                                  table:'recipes',  type:'readonly',       w:90  },
    { key:'title',               label:'Title',                db:'recipes.title',                               table:'recipes',  type:'readonly',       w:200 },
    { key:'menu_group',          label:'Menu Group',           db:'recipes.menu_group',                          table:'recipes',  type:'select',         w:130, options: MENU_GROUPS },
    { key:'_station',            label:'Station',              db:'prep_tasks.category',                         table:'prep_tasks', type:'select',       w:150, options: [] /* filled later */ },
    { key:'_family',             label:'Prod. Family',         db:'prep_task_classifications.production_family', table:'ptc',      type:'select',         w:140, options: PRODUCTION_FAMILIES },
    { key:'_work_type',          label:'Work Type',            db:'prep_task_classifications.work_type',         table:'ptc',      type:'select',         w:150, options: WORK_TYPES },
    { key:'pos_name',            label:'POS Name',             db:'recipes.pos_name',                            table:'recipes',  type:'text',           w:180 },
    { key:'base_servings',       label:'Nr. Porzioni',         db:'recipes.base_servings',                       table:'recipes',  type:'number-int',     w:90  },
    { key:'yield_text',          label:'Grandezza finale',     db:'recipes.yield_text',                          table:'recipes',  type:'text',           w:130 },
    { key:'base_weight_g',       label:'Batch weight g',       db:'recipes.base_weight_g',                       table:'recipes',  type:'number-decimal', w:110 },
    { key:'serving_weight_g',    label:'Serving weight g',     db:'recipes.serving_weight_g',                    table:'recipes',  type:'number-decimal', w:115 },
    { key:'prep_time_minutes',   label:'Prep time (min)',      db:'recipes.prep_time_minutes',                   table:'recipes',  type:'number-int',     w:105 },
    { key:'shelf_life_days',     label:'Shelf life (days)',    db:'recipes.shelf_life_days',                     table:'recipes',  type:'number-int',     w:110 },
    { key:'serving_qty',         label:'Qty / POS sale',       db:'recipes.serving_qty',                         table:'recipes',  type:'number-decimal', w:105 },
    { key:'serving_unit',        label:'Unit / POS sale',      db:'recipes.serving_unit',                        table:'recipes',  type:'select',         w:110, options: SERVING_UNITS },
    { key:'prep_frequency_days', label:'Prep every N days',    db:'recipes.prep_frequency_days',                 table:'recipes',  type:'number-int',     w:120 },
    { key:'selling_price',       label:'Selling price $',      db:'recipes.selling_price',                       table:'recipes',  type:'number-decimal', w:110 },
    { key:'equipment',           label:'Equipment',            db:'recipes.equipment',                           table:'recipes',  type:'textarea',       w:180 },
    { key:'procedure',           label:'Notes / Service',      db:'recipes.procedure',                           table:'recipes',  type:'textarea',       w:200 },
    { key:'image_url',           label:'Photo URL',            db:'recipes.image_url',                           table:'recipes',  type:'text',           w:160 },
  ];

  // ── Module state ──────────────────────────────────────────────────────────
  let _rows = [];          // [{ recipe, prep_tasks:[], _linked_pt, _edits:{}, _dirty, _saving, _lastSave }]
  let _filtName    = '';
  let _filtGroup   = '';
  let _filtStation = '';
  let _filtFamily  = '';
  let _filtDirty   = false;
  let _filtNull    = false;
  let _sheet       = null;
  let _filtered    = [];   // current visible rows

  // ── Entry point ───────────────────────────────────────────────────────────
  window.openRecipeControlTable = async function () {
    hideAdminMenu();
    _sheet = document.createElement('div');
    _sheet.id = 'recipeControlSheet';
    _sheet.style.cssText = 'position:fixed;inset:0;z-index:80;background:rgba(15,23,42,0.55);overflow:hidden;display:flex;flex-direction:column;';

    _sheet.innerHTML = `
<div style="position:absolute;inset:0;background:#f8fafc;display:flex;flex-direction:column;overflow:hidden;">
  <!-- Header -->
  <div style="background:#1e3a5f;color:white;padding:12px 16px 10px;flex-shrink:0;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <div>
        <div style="font-size:17px;font-weight:700;">📋 Recipe Control Table</div>
        <div style="font-size:11px;opacity:0.6;margin-top:1px;">Admin · modifica diretta DB · una riga = una ricetta</div>
      </div>
      <button onclick="document.getElementById('recipeControlSheet').remove()" style="font-size:22px;background:none;border:none;color:rgba(255,255,255,0.7);cursor:pointer;padding:4px 8px;">✕</button>
    </div>
    <!-- Filters -->
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
      <input id="rctSearchName" placeholder="Cerca titolo…" oninput="rctApplyFilter()"
        style="padding:6px 10px;border-radius:8px;border:none;font-size:13px;min-width:130px;background:rgba(255,255,255,0.15);color:white;flex:1;">
      <select id="rctFilterGroup" onchange="rctApplyFilter()"
        style="padding:6px 8px;border-radius:8px;border:none;font-size:12px;background:rgba(255,255,255,0.15);color:white;max-width:130px;">
        <option value="">All Groups</option>
        ${MENU_GROUPS.map(g=>`<option value="${_esc(g)}">${_esc(g)}</option>`).join('')}
      </select>
      <select id="rctFilterStation" onchange="rctApplyFilter()"
        style="padding:6px 8px;border-radius:8px;border:none;font-size:12px;background:rgba(255,255,255,0.15);color:white;max-width:140px;">
        <option value="">All Stations</option>
      </select>
      <select id="rctFilterFamily" onchange="rctApplyFilter()"
        style="padding:6px 8px;border-radius:8px;border:none;font-size:12px;background:rgba(255,255,255,0.15);color:white;max-width:140px;">
        <option value="">All Families</option>
        ${PRODUCTION_FAMILIES.map(f=>`<option value="${f}">${f}</option>`).join('')}
      </select>
      <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;color:rgba(255,255,255,0.85);">
        <input type="checkbox" id="rctFilterDirty" onchange="rctApplyFilter()"> Modified
      </label>
      <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;color:rgba(255,255,255,0.85);">
        <input type="checkbox" id="rctFilterNull" onchange="rctApplyFilter()"> Has NULLs
      </label>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px;">
      <div id="rctStatus" style="font-size:11px;opacity:0.7;">Loading…</div>
      <button onclick="rctPrintExport()"
        style="padding:5px 13px;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.35);border-radius:7px;color:white;font-size:12px;font-weight:600;cursor:pointer;">
        🖨️ Print / Export PDF
      </button>
    </div>
  </div>
  <!-- Table wrapper -->
  <div id="rctTableWrap" style="flex:1;overflow:auto;-webkit-overflow-scrolling:touch;">
    <div id="rctLoadMsg" style="padding:40px;text-align:center;color:#64748b;font-size:14px;">⏳ Loading recipes…</div>
    <table id="rctTable" style="display:none;border-collapse:collapse;width:max-content;min-width:100%;font-size:12px;">
      <thead id="rctThead"></thead>
      <tbody id="rctTbody"></tbody>
    </table>
  </div>
</div>`;

    document.body.appendChild(_sheet);
    _sheet.addEventListener('click', e => { if (e.target === _sheet) _sheet.remove(); });
    await _load();
  };

  // ── Load all data ─────────────────────────────────────────────────────────
  async function _load() {
    _rows = [];
    try {
      // 1. Recipes
      const { data: recipes, error: re } = await supa.from('recipes')
        .select('id,title,menu_group,pos_name,base_servings,yield_text,base_weight_g,serving_weight_g,prep_time_minutes,shelf_life_days,serving_qty,serving_unit,prep_frequency_days,selling_price,equipment,procedure,image_url')
        .order('title');
      if (re) throw re;

      // 2. prep_tasks (non archived, with recipe_id)
      const { data: preps, error: pe } = await supa.from('prep_tasks')
        .select('id,recipe_id,category,name')
        .not('recipe_id','is',null)
        .eq('archived',false)
        .order('id');
      if (pe) throw pe;

      // 3. Stations for dropdown (distinct categories)
      STATIONS = [...new Set((preps||[]).map(p=>p.category).filter(Boolean))].sort();
      const stSel = document.getElementById('rctFilterStation');
      if (stSel) {
        stSel.innerHTML = '<option value="">All Stations</option>' +
          STATIONS.map(s=>`<option value="${_esc(s)}">${_esc(s)}</option>`).join('');
      }
      // Patch COLS station options
      const stCol = COLS.find(c=>c.key==='_station');
      if (stCol) stCol.options = STATIONS;

      // 4. Classifications
      const ptIds = (preps||[]).map(p=>p.id);
      let clsMap = {};
      for (let i=0;i<ptIds.length;i+=500) {
        const { data: cls } = await supa.from('prep_task_classifications')
          .select('prep_task_id,production_family,work_type')
          .in('prep_task_id', ptIds.slice(i,i+500));
        (cls||[]).forEach(c=>{ clsMap[c.prep_task_id]=c; });
      }

      // 5. Build rows — group prep_tasks per recipe
      const prepsByRecipe = {};
      (preps||[]).forEach(p => {
        if (!prepsByRecipe[p.recipe_id]) prepsByRecipe[p.recipe_id] = [];
        prepsByRecipe[p.recipe_id].push({ ...p, _cls: clsMap[p.id]||null });
      });

      _rows = (recipes||[]).map(r => {
        const pts = prepsByRecipe[r.id] || [];
        // default linked prep_task = first one
        const linked = pts[0] || null;
        return {
          recipe: r,
          prep_tasks: pts,
          _linked_pt: linked,
          _edits: {},
          _dirty: false,
          _saving: false,
          _lastSave: null,
        };
      });

      _buildThead();
      rctApplyFilter();
    } catch(e) {
      const msg = document.getElementById('rctLoadMsg');
      if (msg) msg.innerHTML = `<div style="color:#dc2626;padding:20px;">Errore: ${_esc(e.message)}</div>`;
    }
  }

  // ── Build thead (two header rows: label + db mapping) ─────────────────────
  function _buildThead() {
    const thead = document.getElementById('rctThead');
    const msg   = document.getElementById('rctLoadMsg');
    const tbl   = document.getElementById('rctTable');
    if (!thead) return;
    const th1 = s => `position:sticky;top:0;z-index:3;background:#1e3a5f;color:white;padding:7px 8px;white-space:nowrap;border-right:1px solid rgba(255,255,255,0.1);font-size:11px;font-weight:600;text-align:left;${s||''}`;
    const th2 = s => `position:sticky;top:28px;z-index:3;background:#0f2540;color:rgba(255,255,255,0.5);padding:3px 8px;white-space:nowrap;border-right:1px solid rgba(255,255,255,0.08);font-size:9px;font-family:monospace;text-align:left;${s||''}`;
    const stk0 = (base) => base + 'left:0;z-index:5!important;';
    const stk1 = (base) => base + 'left:60px;z-index:5!important;';

    thead.innerHTML = `
    <tr>
      <th style="${stk0(th1())}min-width:160px;">Actions</th>
      ${COLS.map((col,ci)=>`<th style="${ci<=1?stk1(th1()):th1()}min-width:${col.w}px;">${_esc(col.label)}</th>`).join('')}
    </tr>
    <tr>
      <th style="${stk0(th2())}font-style:italic;">save · reset · prep</th>
      ${COLS.map((col,ci)=>`<th style="${ci<=1?stk1(th2()):th2()}">${_esc(col.db)}</th>`).join('')}
    </tr>`;

    if (msg) msg.style.display='none';
    if (tbl) tbl.style.display='';
  }

  // ── Apply filters ─────────────────────────────────────────────────────────
  window.rctApplyFilter = function() {
    _filtName    = (document.getElementById('rctSearchName')?.value||'').toLowerCase();
    _filtGroup   = document.getElementById('rctFilterGroup')?.value||'';
    _filtStation = document.getElementById('rctFilterStation')?.value||'';
    _filtFamily  = document.getElementById('rctFilterFamily')?.value||'';
    _filtDirty   = document.getElementById('rctFilterDirty')?.checked||false;
    _filtNull    = document.getElementById('rctFilterNull')?.checked||false;

    _filtered = _rows.filter(row => {
      const r = row.recipe;
      if (_filtName   && !(r.title||'').toLowerCase().includes(_filtName)) return false;
      if (_filtGroup  && r.menu_group !== _filtGroup) return false;
      if (_filtStation) {
        const st = row._linked_pt?.category || null;
        if (st !== _filtStation) return false;
      }
      if (_filtFamily) {
        const fam = row._linked_pt?._cls?.production_family || null;
        if (fam !== _filtFamily) return false;
      }
      if (_filtDirty && !row._dirty) return false;
      if (_filtNull) {
        const editableRecipeCols = COLS.filter(c=>c.table==='recipes'&&c.type!=='readonly');
        const hasNull = editableRecipeCols.some(c=>
          (row._edits[c.key]!==undefined ? row._edits[c.key] : (row.recipe[c.key]??null)) === null
        );
        if (!hasNull) return false;
      }
      return true;
    });

    _renderBody();
    const dirty = _filtered.filter(r=>r._dirty).length;
    const st = document.getElementById('rctStatus');
    if (st) st.textContent = `${_filtered.length} / ${_rows.length} ricette${dirty?` · ${dirty} modificate`:''}`;
  };

  // ── Render tbody ──────────────────────────────────────────────────────────
  function _renderBody() {
    const tbody = document.getElementById('rctTbody');
    if (!tbody) return;

    tbody.innerHTML = _filtered.map(row => _renderRow(row)).join('');

    // Wire events
    _filtered.forEach(row => { _wireRow(row); });
  }

  function _renderRow(row) {
    const rid = row.recipe.id;
    const bg = row._dirty ? '#fffbeb' : row._saving ? '#f0fdf4' : '';

    // Current display value for each column
    function val(col) {
      if (col.key === '_station') return row._linked_pt?.category ?? null;
      if (col.key === '_family')  return row._linked_pt?._cls?.production_family ?? null;
      if (col.key === '_work_type') return row._linked_pt?._cls?.work_type ?? null;
      const edited = row._edits[col.key];
      return edited !== undefined ? edited : (row.recipe[col.key] ?? null);
    }

    function isEdited(col) {
      if (!['_station','_family','_work_type'].includes(col.key)) {
        return row._edits[col.key] !== undefined && row._edits[col.key] !== (row.recipe[col.key]??null);
      }
      if (col.key === '_station')   return row._edits._station   !== undefined;
      if (col.key === '_family')    return row._edits._family    !== undefined;
      if (col.key === '_work_type') return row._edits._work_type !== undefined;
      return false;
    }

    const tdBase = `padding:5px 8px;border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;vertical-align:middle;`;
    const tdStk0 = `${tdBase}position:sticky;left:0;z-index:2;background:${bg||'white'};`;
    const tdStk1 = `${tdBase}position:sticky;left:60px;z-index:2;background:${bg||'white'};`;

    // Prep selector (if >1 prep_task)
    let prepSelectorHtml = '';
    if (row.prep_tasks.length > 1) {
      const opts = row.prep_tasks.map(pt =>
        `<option value="${pt.id}" ${row._linked_pt?.id===pt.id?'selected':''}>${_esc(pt.name)} (${_esc(pt.category||'?')})</option>`
      ).join('');
      prepSelectorHtml = `<select id="rctPtSel_${rid}" onchange="rctSelectPt('${rid}',this.value)"
        style="margin-top:4px;width:100%;padding:3px 5px;border:1px solid #e2e8f0;border-radius:5px;font-size:10px;background:white;color:#374151;">
        ${opts}
      </select>`;
    } else if (row.prep_tasks.length === 1) {
      prepSelectorHtml = `<div style="font-size:10px;color:#94a3b8;margin-top:3px;">${_esc(row._linked_pt.name)}</div>`;
    } else {
      prepSelectorHtml = `<div style="font-size:10px;color:#cbd5e1;margin-top:3px;font-style:italic;">No prep task</div>`;
    }

    const lastSaveBadge = row._lastSave
      ? (row._lastSave.ok
          ? `<span style="font-size:10px;color:#059669;font-weight:600;margin-left:4px;">✓ saved</span>`
          : `<span style="font-size:10px;color:#dc2626;font-weight:600;margin-left:4px;" title="${_esc(row._lastSave.error||'')}">✕ error</span>`)
      : '';

    const actionCell = `
      <td style="${tdStk0}min-width:160px;">
        <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
          <button id="rctSaveBtn_${rid}" onclick="rctSaveRow('${rid}')"
            style="padding:4px 10px;border-radius:6px;border:none;cursor:pointer;font-size:11px;font-weight:700;
              background:${row._dirty?'#059669':'#e2e8f0'};color:${row._dirty?'white':'#94a3b8'};
              opacity:${row._dirty?'1':'0.5'};pointer-events:${row._dirty?'auto':'none'};">
            ${row._saving?'…':'Save'}
          </button>
          <button id="rctResetBtn_${rid}" onclick="rctResetRow('${rid}')"
            style="padding:4px 8px;border-radius:6px;border:1px solid #e2e8f0;cursor:pointer;font-size:11px;
              background:white;color:#64748b;display:${row._dirty?'inline-block':'none'};">
            Reset
          </button>
          ${lastSaveBadge}
        </div>
        ${prepSelectorHtml}
      </td>`;

    const dataCells = COLS.map((col, ci) => {
      const v      = val(col);
      const edited = isEdited(col);
      const stkStyle = ci===0 ? tdStk1 : '';
      const cellBg   = edited ? 'background:#fef9c3;' : (bg ? `background:${bg};` : '');
      const style    = `${tdBase}${stkStyle}${cellBg}`;
      return `<td style="${style}">${_cellHtml(col, v, rid)}</td>`;
    }).join('');

    return `<tr id="rctRow_${rid}" style="background:${bg};">${actionCell}${dataCells}</tr>`;
  }

  function _cellHtml(col, val, rid) {
    const isnull = val === null || val === undefined;
    const strVal = isnull ? '' : String(val);
    const eid    = `rctCell_${rid}_${col.key}`;

    if (col.type === 'readonly') {
      if (col.key === 'id') return `<span style="font-family:monospace;font-size:10px;color:#94a3b8;">${_esc(strVal.slice(0,8))}…</span>`;
      return `<span>${_esc(strVal)}</span>`;
    }

    const baseInput = `width:100%;min-width:${col.w-16}px;padding:4px 5px;border:1px solid transparent;border-radius:5px;font-size:12px;font-family:inherit;background:transparent;box-sizing:border-box;`;
    const focus = `onfocus="this.style.border='1px solid #3b82f6';this.style.background='white';" onblur="this.style.border='1px solid transparent';this.style.background='transparent';"`;

    if (col.type === 'select') {
      const opts = ['', ...(col.options||[])].map(o =>
        `<option value="${_esc(o)}" ${strVal===o&&!isnull?'selected':(!o&&isnull?'selected':'')}>${o||'— NULL —'}</option>`
      ).join('');
      return `<select id="${eid}" style="${baseInput}cursor:pointer;">${opts}</select>`;
    }

    if (col.type === 'textarea') {
      return `<textarea id="${eid}" rows="2"
        style="${baseInput}resize:vertical;min-height:34px;"
        ${focus}>${_esc(strVal)}</textarea>`;
    }

    const inputType = (col.type==='number-int'||col.type==='number-decimal') ? 'number' : 'text';
    const step      = col.type==='number-decimal' ? 'step="any"' : col.type==='number-int' ? 'step="1"' : '';
    const nullLabel = isnull ? 'placeholder="NULL"' : '';
    const nullStyle = isnull ? 'color:#94a3b8;' : '';

    return `<input id="${eid}" type="${inputType}" ${step} value="${_esc(strVal)}" ${nullLabel}
      style="${baseInput}${nullStyle}" ${focus}>`;
  }

  // ── Wire input events for a row ───────────────────────────────────────────
  function _wireRow(row) {
    const rid = row.recipe.id;
    COLS.forEach(col => {
      if (col.type === 'readonly') return;
      const el = document.getElementById(`rctCell_${rid}_${col.key}`);
      if (!el) return;
      const ev = (el.tagName === 'SELECT' || el.tagName === 'INPUT') ? 'change' : 'input';
      el.addEventListener('change', () => _onChange(rid, col, el.value));
      if (el.tagName === 'TEXTAREA') el.addEventListener('input', () => _onChange(rid, col, el.value));
    });
  }

  // ── Prep task selector ────────────────────────────────────────────────────
  window.rctSelectPt = function(rid, ptId) {
    const row = _rows.find(r=>r.recipe.id===rid);
    if (!row) return;
    const pt = row.prep_tasks.find(p=>p.id===Number(ptId));
    if (!pt) return;
    row._linked_pt = pt;
    // Clear any pending ptc edits since we switched to a different prep
    delete row._edits._station;
    delete row._edits._family;
    delete row._edits._work_type;
    row._dirty = Object.keys(row._edits).length > 0;
    _reRenderRow(row);
  };

  // ── On cell change ────────────────────────────────────────────────────────
  function _onChange(rid, col, rawVal) {
    const row = _rows.find(r=>r.recipe.id===rid);
    if (!row) return;

    // Parse
    let parsed;
    if (rawVal === '' || rawVal === null || rawVal === undefined) {
      parsed = null;
    } else if (col.type === 'number-int') {
      const n = parseInt(rawVal, 10);
      parsed = isNaN(n) ? null : n;
    } else if (col.type === 'number-decimal') {
      const n = parseFloat(rawVal);
      parsed = isNaN(n) ? null : n;
    } else if (col.type === 'select' && rawVal === '') {
      parsed = null;
    } else {
      parsed = rawVal;
    }

    // Compare to original
    let original;
    if (col.key === '_station')   original = row._linked_pt?.category ?? null;
    else if (col.key === '_family')  original = row._linked_pt?._cls?.production_family ?? null;
    else if (col.key === '_work_type') original = row._linked_pt?._cls?.work_type ?? null;
    else original = row.recipe[col.key] ?? null;

    if (_looseEq(parsed, original)) delete row._edits[col.key];
    else row._edits[col.key] = parsed;

    row._dirty = Object.keys(row._edits).length > 0;
    _updateActionCell(row);
    _highlightEdited(row);
  }

  function _looseEq(a, b) {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    return String(a) === String(b);
  }

  // ── Reset row ─────────────────────────────────────────────────────────────
  window.rctResetRow = function(rid) {
    const row = _rows.find(r=>r.recipe.id===rid);
    if (!row) return;
    row._edits = {};
    row._dirty = false;
    row._lastSave = null;
    COLS.forEach(col => {
      if (col.type === 'readonly') return;
      const el = document.getElementById(`rctCell_${rid}_${col.key}`);
      if (!el) return;
      let orig;
      if (col.key === '_station')   orig = row._linked_pt?.category ?? null;
      else if (col.key === '_family')  orig = row._linked_pt?._cls?.production_family ?? null;
      else if (col.key === '_work_type') orig = row._linked_pt?._cls?.work_type ?? null;
      else orig = row.recipe[col.key] ?? null;
      el.value = orig === null || orig === undefined ? '' : String(orig);
    });
    _updateActionCell(row);
    _highlightEdited(row);
  };

  // ── Save row ──────────────────────────────────────────────────────────────
  window.rctSaveRow = async function(rid) {
    const row = _rows.find(r=>r.recipe.id===rid);
    if (!row || !row._dirty || row._saving) return;

    const edits = { ...row._edits };
    if (!Object.keys(edits).length) return;

    // Validate numeric fields
    for (const [k, v] of Object.entries(edits)) {
      const col = COLS.find(c=>c.key===k);
      if (!col) continue;
      if (v !== null && (col.type==='number-int'||col.type==='number-decimal') && isNaN(parseFloat(v))) {
        _showNotif(rid, false, `Valore non valido per "${col.label}": "${v}"`);
        return;
      }
      if (v !== null && (col.type==='number-int'||col.type==='number-decimal') && parseFloat(v)<0) {
        _showNotif(rid, false, `Valore negativo non consentito per "${col.label}"`);
        return;
      }
    }

    row._saving = true;
    _updateActionCell(row, true);

    try {
      // ── recipes patch ──────────────────────────────────────────────────
      const recPatch = {};
      const ptcEdits = {};
      const ptEdits  = {};

      for (const [k, v] of Object.entries(edits)) {
        if (k === '_station')   ptEdits.category           = v;
        else if (k === '_family')  ptcEdits.production_family = v;
        else if (k === '_work_type') ptcEdits.work_type       = v;
        else recPatch[k] = v;
      }

      // Save recipes
      if (Object.keys(recPatch).length) {
        const { error: re } = await supa.from('recipes').update(recPatch).eq('id', rid);
        if (re) throw new Error(`recipes: ${re.message}`);

        // ── Auto-link pos_item_class_rules when pos_name changes ──────────
        // If pos_name was edited, find any matching rule with target_type='none'
        // and update it to point to this recipe. This prevents unmatched_pos issues.
        if ('pos_name' in recPatch && recPatch.pos_name) {
          const newPosName = recPatch.pos_name;
          // Check each pipe-delimited alias
          const aliases = newPosName.split('|').map(a => a.trim()).filter(Boolean);
          for (const alias of aliases) {
            const { data: matchedRules } = await supa
              .from('pos_item_class_rules')
              .select('id, pattern, target_type, target_id, action')
              .eq('pattern', alias)
              .eq('active', true);
            if (matchedRules && matchedRules.length > 0) {
              for (const rule of matchedRules) {
                if (rule.target_type === 'none' || rule.target_id === null) {
                  // Update to point to this recipe
                  await supa.from('pos_item_class_rules')
                    .update({
                      target_type: 'recipe',
                      target_id: rid,
                      notes: `Auto-linked to recipe ${rid} via Recipe Control Table pos_name save`
                    })
                    .eq('id', rule.id);
                }
              }
            }
          }
        }
      }

      // Save prep_tasks
      if (Object.keys(ptEdits).length) {
        const ptId = row._linked_pt?.id;
        if (!ptId) throw new Error('Nessuna prep task collegata per salvare Station.');
        const { error: pe } = await supa.from('prep_tasks').update(ptEdits).eq('id', ptId);
        if (pe) throw new Error(`prep_tasks: ${pe.message}`);
      }

      // Save prep_task_classifications (upsert)
      if (Object.keys(ptcEdits).length) {
        const ptId = row._linked_pt?.id;
        if (!ptId) throw new Error('Nessuna prep task collegata per salvare Family/Work Type.');
        const existing = row._linked_pt?._cls;
        if (existing) {
          const { error: ce } = await supa.from('prep_task_classifications').update(ptcEdits).eq('prep_task_id', ptId);
          if (ce) throw new Error(`ptc update: ${ce.message}`);
        } else {
          // Insert — work_type is NOT NULL, so we need a value
          const toInsert = {
            prep_task_id: ptId,
            production_family: ptcEdits.production_family ?? null,
            work_type: ptcEdits.work_type ?? 'quantitative_prep',
            classified_by: `rct_${window.user?.name||'admin'}`,
            classified_at: new Date().toISOString(),
          };
          const { error: ci } = await supa.from('prep_task_classifications').insert(toInsert);
          if (ci) throw new Error(`ptc insert: ${ci.message}`);
        }
      }

      // ── Read-back ─────────────────────────────────────────────────────
      const { data: freshRec, error: rr } = await supa.from('recipes')
        .select('id,title,menu_group,pos_name,base_servings,yield_text,base_weight_g,serving_weight_g,prep_time_minutes,shelf_life_days,serving_qty,serving_unit,prep_frequency_days,selling_price,equipment,procedure,image_url')
        .eq('id', rid).single();
      if (rr) throw new Error(`read-back recipes: ${rr.message}`);

      let freshPt = row._linked_pt;
      let freshCls = row._linked_pt?._cls || null;

      if (Object.keys(ptEdits).length || Object.keys(ptcEdits).length) {
        const ptId = row._linked_pt?.id;
        const { data: fp } = await supa.from('prep_tasks').select('id,recipe_id,category,name').eq('id',ptId).single();
        if (fp) freshPt = { ...fp, _cls: freshCls };
        const { data: fc } = await supa.from('prep_task_classifications').select('prep_task_id,production_family,work_type').eq('prep_task_id',ptId).maybeSingle();
        freshCls = fc || null;
        if (freshPt) freshPt._cls = freshCls;
      }

      // Update in-memory
      Object.assign(row.recipe, freshRec);
      row._linked_pt = freshPt;
      if (freshPt) {
        const ptIdx = row.prep_tasks.findIndex(p=>p.id===freshPt.id);
        if (ptIdx>=0) row.prep_tasks[ptIdx] = freshPt;
      }
      row._edits = {};
      row._dirty = false;
      row._lastSave = { ok: true, patch: edits };

    } catch(e) {
      row._lastSave = { ok: false, error: e.message, patch: edits };
    } finally {
      row._saving = false;
    }

    // Show notification then re-render
    _showSaveNotif(row);
    _reRenderRow(row);
  };

  // ── Re-render single row ──────────────────────────────────────────────────
  function _reRenderRow(row) {
    const rid = row.recipe.id;
    const rowEl = document.getElementById(`rctRow_${rid}`);
    if (!rowEl) return;
    const newHtml = _renderRow(row);
    const tmp = document.createElement('tbody');
    tmp.innerHTML = newHtml;
    const newTr = tmp.firstChild;
    rowEl.parentNode.replaceChild(newTr, rowEl);
    _wireRow(row);
  }

  // ── Update just the action cell ───────────────────────────────────────────
  function _updateActionCell(row, saving=false) {
    const rid = row.recipe.id;
    const btn = document.getElementById(`rctSaveBtn_${rid}`);
    const rst = document.getElementById(`rctResetBtn_${rid}`);
    if (btn) {
      btn.style.background     = row._dirty ? '#059669' : '#e2e8f0';
      btn.style.color          = row._dirty ? 'white' : '#94a3b8';
      btn.style.opacity        = row._dirty ? '1' : '0.5';
      btn.style.pointerEvents  = row._dirty ? 'auto' : 'none';
      btn.textContent          = saving ? '…' : 'Save';
    }
    if (rst) rst.style.display = row._dirty ? 'inline-block' : 'none';
    const rowEl = document.getElementById(`rctRow_${rid}`);
    if (rowEl) rowEl.style.background = row._dirty ? '#fffbeb' : '';
  }

  // ── Highlight edited cells ────────────────────────────────────────────────
  function _highlightEdited(row) {
    const rid = row.recipe.id;
    const rowEl = document.getElementById(`rctRow_${rid}`);
    if (!rowEl) return;
    const tds = rowEl.querySelectorAll('td');
    // tds[0] = actions, tds[1..] = COLS
    COLS.forEach((col,ci) => {
      const td = tds[ci+1];
      if (!td) return;
      let edited = false;
      if (col.key==='_station')    edited = row._edits._station   !== undefined;
      else if (col.key==='_family')    edited = row._edits._family    !== undefined;
      else if (col.key==='_work_type') edited = row._edits._work_type !== undefined;
      else edited = row._edits[col.key] !== undefined && !_looseEq(row._edits[col.key], row.recipe[col.key]??null);
      if (edited) {
        td.style.background = '#fef9c3';
      } else {
        td.style.background = row._dirty ? '#fffbeb' : '';
      }
    });
  }

  // ── Save notification ─────────────────────────────────────────────────────
  function _showSaveNotif(row) {
    if (!row._lastSave) return;
    const rid = row.recipe.id;
    document.getElementById(`rctNotif_${rid}`)?.remove();
    const notif = document.createElement('div');
    notif.id = `rctNotif_${rid}`;
    if (!row._lastSave.ok) {
      notif.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#fef2f2;border:1.5px solid #fca5a5;border-radius:12px;padding:12px 16px;z-index:9999;max-width:420px;font-size:12px;color:#991b1b;box-shadow:0 4px 20px rgba(0,0,0,.15);';
      notif.innerHTML = `<b>Salvataggio fallito</b><br>${_esc(row._lastSave.error||'')}`;
    } else {
      const lines = Object.entries(row._lastSave.patch).map(([k,v]) => {
        const col = COLS.find(c=>c.key===k);
        return `<div>· <b>${_esc(col?.label||k)}</b>: ${v===null?'<i>NULL</i>':_esc(String(v))} <span style="color:#94a3b8;font-size:10px;">[${_esc(col?.db||k)}]</span></div>`;
      }).join('');
      notif.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:12px 16px;z-index:9999;max-width:480px;font-size:12px;color:#14532d;box-shadow:0 4px 20px rgba(0,0,0,.15);';
      notif.innerHTML = `<div style="font-weight:700;margin-bottom:5px;">✅ Salvato e verificato dal DB</div><div style="font-weight:600;margin-bottom:4px;">${_esc(row.recipe.title)}</div>${lines}<div style="margin-top:5px;color:#059669;font-weight:600;">Read-back: Confermato ✓</div>`;
    }
    document.body.appendChild(notif);
    setTimeout(()=>notif.remove(), 6000);
  }

  function _showNotif(rid, ok, msg) {
    document.getElementById(`rctNotif_${rid}`)?.remove();
    const notif = document.createElement('div');
    notif.id = `rctNotif_${rid}`;
    notif.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:${ok?'#f0fdf4':'#fef2f2'};border:1.5px solid ${ok?'#86efac':'#fca5a5'};border-radius:12px;padding:12px 16px;z-index:9999;max-width:420px;font-size:12px;color:${ok?'#14532d':'#991b1b'};box-shadow:0 4px 20px rgba(0,0,0,.15);`;
    notif.textContent = msg;
    document.body.appendChild(notif);
    setTimeout(()=>notif.remove(), 5000);
  }

  // ── PRINT / PDF EXPORT ────────────────────────────────────────────────────
  window.rctPrintExport = async function() {
    const filtered = _filtered;
    if (!filtered.length) { alert('Nessuna riga da esportare con i filtri correnti.'); return; }

    const dirtyRows = filtered.filter(r=>r._dirty);
    let exportMode = 'saved';
    if (dirtyRows.length > 0) {
      const choice = await _unsavedDialog(dirtyRows.length);
      if (choice === 'cancel') return;
      exportMode = choice;
    }

    const now = new Date().toLocaleString('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:true});
    const version = typeof CACHE_NAME !== 'undefined' ? CACHE_NAME : 'boh-v741';

    const filterSummary = [
      _filtName    ? `Search: "${_filtName}"` : null,
      _filtGroup   ? `Menu Group: ${_filtGroup}` : null,
      _filtStation ? `Station: ${_filtStation}` : null,
      _filtFamily  ? `Prod. Family: ${_filtFamily}` : null,
      _filtDirty   ? 'Filter: Modified only' : null,
      _filtNull    ? 'Filter: Has NULLs' : null,
    ].filter(Boolean).join('  ·  ') || 'No filters (all recipes)';

    const headerRow1 = COLS.map(col=>`<th class="pth">${_pEsc(col.label)}</th>`).join('');
    const headerRow2 = COLS.map(col=>`<th class="pth pth-db">${_pEsc(col.db)}</th>`).join('');

    const bodyRows = filtered.map(row => {
      const cells = COLS.map(col => {
        let v;
        if (col.key==='_station')   v = row._linked_pt?.category ?? null;
        else if (col.key==='_family')  v = row._linked_pt?._cls?.production_family ?? null;
        else if (col.key==='_work_type') v = row._linked_pt?._cls?.work_type ?? null;
        else if (exportMode==='unsaved'&&row._edits[col.key]!==undefined) v = row._edits[col.key];
        else v = row.recipe[col.key] ?? null;

        const edited = exportMode==='unsaved'&&row._edits[col.key]!==undefined;
        let disp = v===null ? '<span class="p-null">NULL</span>' : col.key==='id' ? `<span class="p-id">${_pEsc(String(v).slice(0,8))}…</span>` : _pEsc(String(v));
        return `<td class="ptd${edited?' ptd-edited':''}">${disp}</td>`;
      }).join('');
      return `<tr class="ptr">${cells}</tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Recipe Control Table Audit</title>
<style>
@page{size:A3 landscape;margin:12mm 10mm 14mm;}
*{box-sizing:border-box;}
body{font-family:-apple-system,Arial,sans-serif;font-size:9pt;color:#0f172a;margin:0;padding:0;}
.p-summary{padding:8px 0 10px;border-bottom:2px solid #1e3a5f;margin-bottom:10px;font-size:9pt;line-height:1.6;}
.p-title{font-size:14pt;font-weight:700;color:#1e3a5f;margin-bottom:4px;}
table{width:100%;border-collapse:collapse;font-size:8pt;page-break-inside:auto;}
thead{display:table-header-group;}
.pth{background:#1e3a5f;color:white;padding:5px 6px;text-align:left;font-size:8pt;font-weight:600;border:1px solid #2d4f78;white-space:nowrap;}
.pth-db{background:#0f2540;color:rgba(255,255,255,0.6);font-size:7pt;font-family:monospace;font-weight:400;word-break:break-all;}
.ptr{page-break-inside:avoid;}
.ptr:nth-child(even) td{background:#f8fafc;}
.ptd{padding:4px 6px;border:1px solid #cbd5e1;vertical-align:top;word-break:break-word;max-width:200px;line-height:1.4;}
.ptd-edited{background:#fef9c3!important;}
.p-null{color:#94a3b8;font-style:italic;font-size:7.5pt;}
.p-id{font-family:monospace;font-size:7pt;color:#94a3b8;}
@media screen{body{padding:20px;background:#f8fafc;}table{display:block;overflow-x:auto;}}
</style></head><body>
<div class="p-summary">
<div class="p-title">📋 Recipe Control Table Audit</div>
<div>Version: ${version} · Rows: ${filtered.length} · ${filterSummary}</div>
<div>${exportMode==='unsaved'?'<b style="color:#b45309;">⚠ INCLUDES UNSAVED EDITS</b>':'<span style="color:#047857;">SAVED DATABASE VALUES</span>'}</div>
<div>Generated: ${now} CDT</div>
</div>
<table><thead><tr>${headerRow1}</tr><tr>${headerRow2}</tr></thead><tbody>${bodyRows}</tbody></table>
</body></html>`;

    const win = window.open('','_blank','width=1200,height=800');
    if (!win) { alert('Pop-up bloccato. Abilita i pop-up per questo sito e riprova.'); return; }
    win.document.write(html);
    win.document.close();
    win.onload = ()=>{ setTimeout(()=>{ win.focus(); win.print(); }, 400); };
    if (win.document.readyState==='complete') setTimeout(()=>{ win.focus(); win.print(); }, 400);
  };

  function _unsavedDialog(count) {
    return new Promise(resolve => {
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(15,23,42,0.65);display:flex;align-items:center;justify-content:center;padding:20px;';
      ov.innerHTML = `<div style="background:white;border-radius:18px;padding:24px;max-width:380px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,.25);">
        <div style="font-size:16px;font-weight:700;color:#1e3a5f;margin-bottom:8px;">⚠️ Modifiche non salvate (${count})</div>
        <div style="font-size:13px;color:#374151;margin-bottom:18px;line-height:1.5;">Quale versione esportare nel PDF?</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button id="_pu" style="padding:11px 14px;background:#fef9c3;border:1.5px solid #f59e0b;border-radius:10px;font-size:13px;font-weight:700;color:#92400e;cursor:pointer;text-align:left;">📄 Valori non salvati attuali</button>
          <button id="_ps" style="padding:11px 14px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:10px;font-size:13px;font-weight:700;color:#14532d;cursor:pointer;text-align:left;">💾 Valori DB (ultimi salvati)</button>
          <button id="_pc" style="padding:11px 14px;background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;font-weight:600;color:#64748b;cursor:pointer;">Annulla</button>
        </div>
      </div>`;
      document.body.appendChild(ov);
      ov.querySelector('#_pu').onclick = ()=>{ ov.remove(); resolve('unsaved'); };
      ov.querySelector('#_ps').onclick = ()=>{ ov.remove(); resolve('saved'); };
      ov.querySelector('#_pc').onclick = ()=>{ ov.remove(); resolve('cancel'); };
      ov.addEventListener('click', e=>{ if(e.target===ov){ ov.remove(); resolve('cancel'); } });
    });
  }

  // ── Utilities ─────────────────────────────────────────────────────────────
  function _esc(s) {
    return (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function _pEsc(s) {
    return (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Expose filter for onclick in header
  window.rctApplyFilter = rctApplyFilter;

})();
