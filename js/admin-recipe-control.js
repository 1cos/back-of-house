// ── RECIPE CONTROL TABLE — js/admin-recipe-control.js ────────────────────────
// Admin-only spreadsheet view of all recipes with inline editing.
// Every column maps to a real DB column; saving uses only modified fields;
// read-back from DB verifies every save.
//
// DB MAPPING (authoritative — matches Recipe Editor live):
//   recipes.id               → identity (not editable)
//   recipes.title            → "Title"
//   recipes.menu_group       → "Menu Group / Famiglia"
//   recipes.pos_name         → "POS Name"
//   recipes.base_servings    → "Nr. porzioni"
//   recipes.yield_text       → "Grandezza finale"
//   recipes.base_weight_g    → "Batch weight g" (read-only computed)
//   recipes.serving_weight_g → "Serving weight g" (read-only computed)
//   recipes.prep_time_minutes→ "Prep time (min)"
//   recipes.shelf_life_days  → "Shelf life (days)"
//   recipes.serving_qty      → "Qty / POS sale"
//   recipes.serving_unit     → "Unit / POS sale"
//   recipes.selling_price    → "Selling price $" (admin only)
//   recipes.prep_frequency_days→ "Prep every N days"
//   recipes.equipment        → "Equipment"
//   recipes.procedure        → "Notes / Service"
//   recipes.image_url        → "Photo URL"
//
// STATION: joined from prep_tasks.category WHERE prep_tasks.recipe_id = recipes.id
// FAMILY:  joined from prep_task_classifications.production_family (via prep_tasks)
// SUBFAMILY (sottofamiglia): no dedicated DB column on recipes — shown as "—"
//   (exists only conceptually; data lives in prep_task_classifications.work_type)
//
// EDITING RULES:
//   - title, menu_group, pos_name, yield_text, equipment, procedure, image_url → text input
//   - base_servings, prep_time_minutes, shelf_life_days, prep_frequency_days → number int
//   - base_weight_g, serving_weight_g, serving_qty → number numeric
//   - serving_unit → select from fixed list
//   - selling_price → number decimal (admin only)
//   - id, station, family → read-only
//   - NULL values preserved as NULL on save (never coerced to 0 or '')
//
// SAVE BEHAVIOUR:
//   1. Only changed columns sent to DB (PATCH semantics)
//   2. Read-back immediately after save
//   3. Row updated from DB response
//   4. Confirm only after read-back match
// ─────────────────────────────────────────────────────────────────────────────

(function () {

  // ── Constants ──────────────────────────────────────────────────────────────
  const MENU_GROUPS = [
    'Antipasti','Primi','Secondi','Table Side','Salads','Sides',
    'Soups','Desserts','Sauces','Bases','Finger Food','Catering','Add-ons'
  ];

  const SERVING_UNITS = ['g','kg','cup','nests','pezzi','filetto','porzione','buste','ml','l','oz','lb'];

  // Column definition — order determines display order
  // key: recipes column name (or synthetic)
  // label: human-readable header
  // db: 'recipes.column' or 'join:...' for read-only joined columns
  // editable: bool
  // type: 'text'|'number-int'|'number-decimal'|'select'|'readonly'|'textarea'
  // options: for select only
  // adminOnly: hidden from non-admin (not relevant here since whole panel is admin-only)
  const COLUMNS = [
    { key: 'id',                  label: 'ID',                  db: 'recipes.id',                   editable: false, type: 'readonly' },
    { key: 'title',               label: 'Title',               db: 'recipes.title',                editable: true,  type: 'text' },
    { key: 'menu_group',          label: 'Famiglia / Menu Group',db: 'recipes.menu_group',           editable: true,  type: 'select',  options: [''].concat(MENU_GROUPS) },
    { key: '_station',            label: 'Station',             db: 'prep_tasks.category (joined)', editable: false, type: 'readonly' },
    { key: '_family',             label: 'Prod. Family',        db: 'prep_task_classifications.production_family (joined)', editable: false, type: 'readonly' },
    { key: '_work_type',          label: 'Work Type',           db: 'prep_task_classifications.work_type (joined)', editable: false, type: 'readonly' },
    { key: 'pos_name',            label: 'POS Name',            db: 'recipes.pos_name',             editable: true,  type: 'text' },
    { key: 'base_servings',       label: 'Nr. Porzioni',        db: 'recipes.base_servings',        editable: true,  type: 'number-int' },
    { key: 'yield_text',          label: 'Grandezza finale',    db: 'recipes.yield_text',           editable: true,  type: 'text' },
    { key: 'base_weight_g',       label: 'Batch weight g',      db: 'recipes.base_weight_g',        editable: true,  type: 'number-decimal' },
    { key: 'serving_weight_g',    label: 'Serving weight g',    db: 'recipes.serving_weight_g',     editable: false, type: 'readonly' },
    { key: 'prep_time_minutes',   label: 'Prep time (min)',     db: 'recipes.prep_time_minutes',    editable: true,  type: 'number-int' },
    { key: 'shelf_life_days',     label: 'Shelf life (days)',   db: 'recipes.shelf_life_days',      editable: true,  type: 'number-int' },
    { key: 'serving_qty',         label: 'Qty / POS sale',      db: 'recipes.serving_qty',          editable: true,  type: 'number-decimal' },
    { key: 'serving_unit',        label: 'Unit / POS sale',     db: 'recipes.serving_unit',         editable: true,  type: 'select', options: [''].concat(SERVING_UNITS) },
    { key: 'prep_frequency_days', label: 'Prep every N days',   db: 'recipes.prep_frequency_days', editable: true,  type: 'number-int' },
    { key: 'selling_price',       label: 'Selling price $',     db: 'recipes.selling_price',        editable: true,  type: 'number-decimal' },
    { key: 'equipment',           label: 'Equipment',           db: 'recipes.equipment',            editable: true,  type: 'text' },
    { key: 'procedure',           label: 'Notes / Service',     db: 'recipes.procedure',            editable: true,  type: 'textarea' },
    { key: 'image_url',           label: 'Photo URL',           db: 'recipes.image_url',            editable: true,  type: 'text' },
  ];

  // ── Module state ──────────────────────────────────────────────────────────
  let _rows        = [];     // { recipe, _station, _family, _work_type, _edits: {}, _dirty: false, _saving: false }
  let _filterName  = '';
  let _filterGroup = '';
  let _filterStation='';
  let _filterFamily='';
  let _filterDirty = false;
  let _filterNull  = false;
  let _sortAsc     = true;
  let _sheet       = null;

  // ── Entry point ───────────────────────────────────────────────────────────
  window.openRecipeControlTable = async function () {
    hideAdminMenu();

    _sheet = document.createElement('div');
    _sheet.id = 'recipeControlSheet';
    _sheet.style.cssText = [
      'position:fixed;inset:0;z-index:80;',
      'background:rgba(15,23,42,0.55);',
      'overflow:hidden;',
      'display:flex;flex-direction:column;',
    ].join('');

    _sheet.innerHTML = `
      <div id="rctInner" style="
        position:absolute;inset:0;
        background:#f8fafc;
        display:flex;flex-direction:column;
        overflow:hidden;
      ">
        <!-- Header -->
        <div style="
          background:#1e3a5f;color:white;
          padding:14px 16px 10px;
          flex-shrink:0;
        ">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <div>
              <div style="font-size:17px;font-weight:700;">📋 Recipe Control Table</div>
              <div style="font-size:11px;opacity:0.7;margin-top:2px;">Tabellone admin — una riga per ricetta — modifica diretta DB</div>
            </div>
            <button onclick="document.getElementById('recipeControlSheet').remove()"
              style="font-size:22px;background:none;border:none;color:rgba(255,255,255,0.7);padding:4px 8px;cursor:pointer;">✕</button>
          </div>

          <!-- Filters -->
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
            <input id="rctSearchName" placeholder="Search title…"
              style="padding:6px 10px;border-radius:8px;border:none;font-size:13px;min-width:130px;background:rgba(255,255,255,0.15);color:white;flex:1;"
              oninput="rctApplyFilter()">
            <select id="rctFilterGroup" onchange="rctApplyFilter()"
              style="padding:6px 8px;border-radius:8px;border:none;font-size:12px;background:rgba(255,255,255,0.15);color:white;max-width:130px;">
              <option value="">All Groups</option>
              ${MENU_GROUPS.map(g=>`<option value="${g}">${g}</option>`).join('')}
            </select>
            <select id="rctFilterStation" onchange="rctApplyFilter()"
              style="padding:6px 8px;border-radius:8px;border:none;font-size:12px;background:rgba(255,255,255,0.15);color:white;max-width:130px;">
              <option value="">All Stations</option>
            </select>
            <select id="rctFilterFamily" onchange="rctApplyFilter()"
              style="padding:6px 8px;border-radius:8px;border:none;font-size:12px;background:rgba(255,255,255,0.15);color:white;max-width:130px;">
              <option value="">All Families</option>
            </select>
            <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;color:rgba(255,255,255,0.85);">
              <input type="checkbox" id="rctFilterDirty" onchange="rctApplyFilter()"> Modified
            </label>
            <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;color:rgba(255,255,255,0.85);">
              <input type="checkbox" id="rctFilterNull" onchange="rctApplyFilter()"> Has NULLs
            </label>
          </div>
          <div id="rctStatus" style="font-size:11px;opacity:0.7;margin-top:6px;">Loading…</div>
        </div>

        <!-- DB mapping row + table wrapper -->
        <div id="rctTableWrap" style="
          flex:1;overflow:auto;
          -webkit-overflow-scrolling:touch;
        ">
          <div id="rctLoadMsg" style="padding:40px;text-align:center;color:#64748b;font-size:14px;">
            ⏳ Loading recipes…
          </div>
          <table id="rctTable" style="display:none;border-collapse:collapse;width:max-content;min-width:100%;font-size:12px;">
            <thead id="rctThead"></thead>
            <tbody id="rctTbody"></tbody>
          </table>
        </div>
      </div>`;

    document.body.appendChild(_sheet);
    _sheet.addEventListener('click', e => { if (e.target === _sheet) _sheet.remove(); });

    await _rctLoad();
  };

  // ── Load data ─────────────────────────────────────────────────────────────
  async function _rctLoad() {
    _rows = [];

    try {
      // 1. Fetch all recipes (PostgREST max 1000 — recipes table has ~218 rows, safe)
      const { data: recipes, error: recErr } = await supa.from('recipes')
        .select('id,title,menu_group,pos_name,base_servings,yield_text,base_weight_g,serving_weight_g,prep_time_minutes,shelf_life_days,serving_qty,serving_unit,prep_frequency_days,selling_price,equipment,procedure,image_url')
        .order('title');
      if (recErr) throw recErr;

      // 2. Fetch prep_tasks with recipe_id to get station + link to classifications
      const { data: preps, error: prepErr } = await supa.from('prep_tasks')
        .select('id,recipe_id,category')
        .not('recipe_id', 'is', null)
        .eq('archived', false);
      if (prepErr) throw prepErr;

      // 3. Fetch classifications for those prep task ids
      const prepIds = (preps || []).map(p => p.id);
      let classMap = {};
      if (prepIds.length) {
        // Split if > 500 (safe guard for PostgREST)
        const chunks = [];
        for (let i = 0; i < prepIds.length; i += 500) chunks.push(prepIds.slice(i, i + 500));
        for (const chunk of chunks) {
          const { data: cls } = await supa.from('prep_task_classifications')
            .select('prep_task_id,production_family,work_type')
            .in('prep_task_id', chunk);
          (cls || []).forEach(c => { classMap[c.prep_task_id] = c; });
        }
      }

      // 4. Build recipe_id → { station, family, work_type } map
      //    Multiple prep tasks per recipe → take first non-null
      const recipeJoinMap = {};
      (preps || []).forEach(p => {
        if (!p.recipe_id) return;
        if (!recipeJoinMap[p.recipe_id]) {
          const cls = classMap[p.id] || {};
          recipeJoinMap[p.recipe_id] = {
            _station: p.category || null,
            _family: cls.production_family || null,
            _work_type: cls.work_type || null,
          };
        }
      });

      // 5. Build rows
      _rows = (recipes || []).map(r => ({
        recipe: r,
        _station: (recipeJoinMap[r.id] || {})._station || null,
        _family: (recipeJoinMap[r.id] || {})._family || null,
        _work_type: (recipeJoinMap[r.id] || {})._work_type || null,
        _edits: {},
        _dirty: false,
        _saving: false,
        _lastSave: null, // { ok, before, after }
      }));

      _rctBuildFilters();
      _rctBuildTable();
      _rctApplyFilter();

    } catch (e) {
      const msg = document.getElementById('rctLoadMsg');
      if (msg) msg.innerHTML = `<div style="color:#dc2626;padding:20px;">Error loading: ${_esc(e.message)}</div>`;
    }
  }

  // ── Build filter dropdowns ────────────────────────────────────────────────
  function _rctBuildFilters() {
    const stations = [...new Set(_rows.map(r => r._station).filter(Boolean))].sort();
    const families = [...new Set(_rows.map(r => r._family).filter(Boolean))].sort();

    const stSel = document.getElementById('rctFilterStation');
    if (stSel) {
      stSel.innerHTML = '<option value="">All Stations</option>' +
        stations.map(s => `<option value="${_esc(s)}">${_esc(s)}</option>`).join('');
    }

    const faSel = document.getElementById('rctFilterFamily');
    if (faSel) {
      faSel.innerHTML = '<option value="">All Families</option>' +
        families.map(f => `<option value="${_esc(f)}">${_esc(f)}</option>`).join('');
    }
  }

  // ── Build table structure ─────────────────────────────────────────────────
  function _rctBuildTable() {
    const thead = document.getElementById('rctThead');
    const msg   = document.getElementById('rctLoadMsg');
    const tbl   = document.getElementById('rctTable');
    if (!thead) return;

    // Row 1: visible labels
    // Row 2: DB column mapping (fixed)
    const thStyle = `
      position:sticky;top:0;z-index:3;
      background:#1e3a5f;color:white;
      padding:8px 10px;white-space:nowrap;
      border-right:1px solid rgba(255,255,255,0.1);
      font-size:11px;font-weight:600;text-align:left;
    `;
    const thDbStyle = `
      position:sticky;top:32px;z-index:3;
      background:#0f2540;color:rgba(255,255,255,0.55);
      padding:4px 10px;white-space:nowrap;
      border-right:1px solid rgba(255,255,255,0.08);
      font-size:9px;font-weight:500;text-align:left;
      letter-spacing:0.03em;
    `;

    // Sticky first 2 columns (ID + Title)
    function stickyStyle(colIdx, isLabel) {
      if (colIdx > 1) return isLabel ? thStyle : thDbStyle;
      const left = colIdx === 0 ? '0' : '60px';
      const bg = isLabel ? '#1e3a5f' : '#0f2540';
      return (isLabel ? thStyle : thDbStyle) +
        `;position:sticky;left:${left};z-index:${isLabel?5:4};background:${bg};`;
    }

    thead.innerHTML = `
      <tr>
        <th style="${stickyStyle(0,true)}">Actions</th>
        ${COLUMNS.map((col, ci) => `
          <th style="${stickyStyle(ci+1,true)};min-width:${_colMinWidth(col)}px;">
            ${_esc(col.label)}
          </th>
        `).join('')}
      </tr>
      <tr>
        <th style="${stickyStyle(0,false)}font-style:italic;">save / reset</th>
        ${COLUMNS.map((col, ci) => `
          <th style="${stickyStyle(ci+1,false)};font-family:monospace;font-size:9px;">
            ${_esc(col.db)}
          </th>
        `).join('')}
      </tr>`;

    msg.style.display = 'none';
    tbl.style.display = '';
  }

  function _colMinWidth(col) {
    if (col.key === 'id') return 80;
    if (col.key === 'title') return 200;
    if (col.key === 'procedure' || col.key === 'equipment') return 220;
    if (col.key === 'pos_name') return 160;
    if (col.type === 'select') return 120;
    if (col.type === 'number-int' || col.type === 'number-decimal') return 90;
    return 120;
  }

  // ── Apply filter & render rows ────────────────────────────────────────────
  window.rctApplyFilter = function () {
    _filterName    = (document.getElementById('rctSearchName')?.value || '').toLowerCase();
    _filterGroup   = document.getElementById('rctFilterGroup')?.value || '';
    _filterStation = document.getElementById('rctFilterStation')?.value || '';
    _filterFamily  = document.getElementById('rctFilterFamily')?.value || '';
    _filterDirty   = document.getElementById('rctFilterDirty')?.checked || false;
    _filterNull    = document.getElementById('rctFilterNull')?.checked || false;

    const filtered = _rows.filter(r => {
      const rec = r.recipe;
      if (_filterName   && !(rec.title || '').toLowerCase().includes(_filterName)) return false;
      if (_filterGroup  && rec.menu_group !== _filterGroup) return false;
      if (_filterStation && r._station !== _filterStation) return false;
      if (_filterFamily && r._family !== _filterFamily) return false;
      if (_filterDirty  && !r._dirty) return false;
      if (_filterNull) {
        // At least one editable field is NULL
        const hasNull = COLUMNS.some(col => col.editable && col.key !== 'id' &&
          !col.key.startsWith('_') && (rec[col.key] === null || rec[col.key] === undefined));
        if (!hasNull) return false;
      }
      return true;
    });

    _rctRenderRows(filtered);

    const statusEl = document.getElementById('rctStatus');
    if (statusEl) {
      statusEl.textContent = `${filtered.length} / ${_rows.length} recipes` +
        (filtered.some(r => r._dirty) ? ` · ${filtered.filter(r=>r._dirty).length} modified` : '');
    }
  };

  // ── Render rows ───────────────────────────────────────────────────────────
  function _rctRenderRows(filtered) {
    const tbody = document.getElementById('rctTbody');
    if (!tbody) return;

    const tdBase = `
      padding:6px 10px;
      border-bottom:1px solid #e2e8f0;
      border-right:1px solid #e2e8f0;
      vertical-align:middle;
    `;
    const tdSticky0 = `${tdBase}position:sticky;left:0;z-index:2;background:white;`;
    const tdSticky1 = `${tdBase}position:sticky;left:60px;z-index:2;background:white;`;

    tbody.innerHTML = filtered.map((row, rowIdx) => {
      const rec = row.recipe;
      const rid = rec.id;
      const dirtyBg = row._dirty ? 'background:#fffbeb;' : '';
      const savingBg = row._saving ? 'background:#f0fdf4;' : '';
      const rowBg = row._saving ? savingBg : dirtyBg;

      // Actions cell
      const actionsHtml = `
        <div style="display:flex;gap:4px;align-items:center;">
          <button
            id="rctSaveBtn_${rid}"
            onclick="rctSaveRow('${rid}')"
            style="
              padding:4px 10px;border-radius:6px;border:none;cursor:pointer;font-size:11px;font-weight:700;
              background:${row._dirty ? '#059669' : '#e2e8f0'};
              color:${row._dirty ? 'white' : '#94a3b8'};
              opacity:${row._dirty ? '1' : '0.6'};
              pointer-events:${row._dirty ? 'auto' : 'none'};
            ">Save</button>
          <button
            onclick="rctResetRow('${rid}')"
            style="
              padding:4px 8px;border-radius:6px;border:1px solid #e2e8f0;cursor:pointer;font-size:11px;
              background:white;color:#64748b;
              display:${row._dirty ? 'inline-block' : 'none'};
            "
            id="rctResetBtn_${rid}">Reset</button>
          ${row._lastSave ? _rctSaveBadge(row._lastSave) : ''}
        </div>`;

      const cells = COLUMNS.map((col, ci) => {
        const rawVal = col.key.startsWith('_')
          ? (row[col.key] ?? null)
          : (row._edits[col.key] !== undefined ? row._edits[col.key] : (rec[col.key] ?? null));
        const isEdited = row._edits[col.key] !== undefined &&
          row._edits[col.key] !== (rec[col.key] ?? null);

        const stickyAdd = ci === 0 ? `position:sticky;left:0;z-index:2;background:${row._dirty?'#fffbeb8a':'white'};`
                        : ci === 1 ? `position:sticky;left:60px;z-index:2;background:${row._dirty?'#fffbeb8a':'white'};`
                        : '';
        const cellStyle = `${tdBase}${stickyAdd}${rowBg}${isEdited ? 'background:#fef9c3;' : ''}`;
        const cellContent = _rctCellContent(col, rawVal, rid);
        return `<td style="${cellStyle}">${cellContent}</td>`;
      }).join('');

      return `<tr id="rctRow_${rid}" style="${rowBg}">
        <td style="${tdSticky0}${rowBg}">${actionsHtml}</td>
        ${cells}
      </tr>`;
    }).join('');

    // Wire input events
    filtered.forEach(row => {
      const rid = row.recipe.id;
      COLUMNS.forEach(col => {
        if (!col.editable) return;
        const el = document.getElementById(`rctCell_${rid}_${col.key}`);
        if (!el) return;
        el.addEventListener('change', (e) => _rctOnChange(rid, col, e.target.value));
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          el.addEventListener('input', (e) => _rctOnChange(rid, col, e.target.value));
        }
      });
    });
  }

  function _rctCellContent(col, val, rid) {
    const esc_val = _esc(val === null || val === undefined ? '' : String(val));
    const nullNote = (val === null || val === undefined) ? ' style="color:#94a3b8;font-style:italic;"' : '';

    if (!col.editable || col.type === 'readonly') {
      if (col.key === 'id') {
        return `<span style="font-family:monospace;font-size:10px;color:#94a3b8;">${_esc((val||'').toString().slice(0,8))}…</span>`;
      }
      return `<span${nullNote}>${val === null || val === undefined ? 'NULL' : esc_val}</span>`;
    }

    const baseInputStyle = `
      width:100%;min-width:${_colMinWidth(col)-20}px;
      padding:4px 6px;border:1px solid transparent;border-radius:5px;
      font-size:12px;font-family:inherit;
      background:transparent;
      box-sizing:border-box;
    `;
    const focusHint = `onfocus="this.style.border='1px solid #3b82f6';this.style.background='white';"
                       onblur="this.style.border='1px solid transparent';this.style.background='transparent';"`;

    if (col.type === 'select') {
      const opts = (col.options || []).map(o =>
        `<option value="${_esc(o)}" ${(val === null || val === undefined ? '' : val) === o ? 'selected' : ''}>${o || '— none —'}</option>`
      ).join('');
      return `<select id="rctCell_${rid}_${col.key}"
        style="${baseInputStyle}cursor:pointer;">${opts}</select>`;
    }

    if (col.type === 'textarea') {
      return `<textarea id="rctCell_${rid}_${col.key}"
        rows="2"
        style="${baseInputStyle}resize:vertical;min-height:36px;"
        ${focusHint}
        >${esc_val}</textarea>`;
    }

    const inputType = (col.type === 'number-int' || col.type === 'number-decimal') ? 'number' : 'text';
    const step = col.type === 'number-decimal' ? 'step="0.01"' : col.type === 'number-int' ? 'step="1"' : '';
    const placeholder = (val === null || val === undefined) ? 'NULL' : '';

    return `<input
      id="rctCell_${rid}_${col.key}"
      type="${inputType}" ${step}
      value="${esc_val}"
      placeholder="${placeholder}"
      style="${baseInputStyle}${val === null || val === undefined ? 'color:#94a3b8;' : ''}"
      ${focusHint}
    >`;
  }

  function _rctSaveBadge(save) {
    if (save.ok) {
      return `<span style="font-size:10px;color:#059669;font-weight:600;" title="Read-back verified">✓ saved</span>`;
    }
    return `<span style="font-size:10px;color:#dc2626;font-weight:600;" title="${_esc(save.error||'')}">✕ error</span>`;
  }

  // ── On cell change ────────────────────────────────────────────────────────
  function _rctOnChange(rid, col, rawValue) {
    const rowObj = _rows.find(r => r.recipe.id === rid);
    if (!rowObj) return;

    // Parse value
    let parsed;
    if (rawValue === '' || rawValue === null || rawValue === undefined) {
      parsed = null; // explicit NULL
    } else if (col.type === 'number-int') {
      const n = parseInt(rawValue, 10);
      parsed = isNaN(n) ? null : n;
    } else if (col.type === 'number-decimal') {
      const n = parseFloat(rawValue);
      parsed = isNaN(n) ? null : n;
    } else {
      parsed = rawValue.trim() === '' ? null : rawValue;
    }

    const original = rowObj.recipe[col.key] ?? null;

    if (parsed === original) {
      delete rowObj._edits[col.key];
    } else {
      rowObj._edits[col.key] = parsed;
    }

    rowObj._dirty = Object.keys(rowObj._edits).length > 0;
    _rctUpdateRowUI(rowObj);
  }

  // ── Update single row UI (no full re-render) ──────────────────────────────
  function _rctUpdateRowUI(rowObj) {
    const rid = rowObj.recipe.id;
    const rowEl = document.getElementById(`rctRow_${rid}`);
    const saveBtn = document.getElementById(`rctSaveBtn_${rid}`);
    const resetBtn = document.getElementById(`rctResetBtn_${rid}`);

    if (rowEl) {
      rowEl.style.background = rowObj._dirty ? '#fffbeb' : (rowObj._saving ? '#f0fdf4' : '');
    }

    if (saveBtn) {
      saveBtn.style.background = rowObj._dirty ? '#059669' : '#e2e8f0';
      saveBtn.style.color      = rowObj._dirty ? 'white' : '#94a3b8';
      saveBtn.style.opacity    = rowObj._dirty ? '1' : '0.6';
      saveBtn.style.pointerEvents = rowObj._dirty ? 'auto' : 'none';
    }
    if (resetBtn) {
      resetBtn.style.display = rowObj._dirty ? 'inline-block' : 'none';
    }

    // Highlight edited cells
    COLUMNS.forEach(col => {
      if (!col.editable || col.key.startsWith('_')) return;
      const tdEl = document.querySelector(`#rctRow_${rid} td:nth-child(${COLUMNS.indexOf(col)+2})`);
      if (!tdEl) return;
      const isEdited = rowObj._edits[col.key] !== undefined &&
        rowObj._edits[col.key] !== (rowObj.recipe[col.key] ?? null);
      if (isEdited) {
        tdEl.style.background = '#fef9c3';
      } else {
        tdEl.style.background = rowObj._dirty ? '#fffbeb' : '';
      }
    });
  }

  // ── Reset row ─────────────────────────────────────────────────────────────
  window.rctResetRow = function (rid) {
    const rowObj = _rows.find(r => r.recipe.id === rid);
    if (!rowObj) return;

    rowObj._edits = {};
    rowObj._dirty = false;
    rowObj._lastSave = null;

    // Restore input values
    COLUMNS.forEach(col => {
      if (!col.editable || col.key.startsWith('_')) return;
      const el = document.getElementById(`rctCell_${rid}_${col.key}`);
      if (!el) return;
      const orig = rowObj.recipe[col.key];
      el.value = orig === null || orig === undefined ? '' : String(orig);
    });

    _rctUpdateRowUI(rowObj);
  };

  // ── Save row ──────────────────────────────────────────────────────────────
  window.rctSaveRow = async function (rid) {
    const rowObj = _rows.find(r => r.recipe.id === rid);
    if (!rowObj || !rowObj._dirty || rowObj._saving) return;

    const patch = { ...rowObj._edits };
    if (!Object.keys(patch).length) return;

    rowObj._saving = true;
    _rctUpdateRowUI(rowObj);

    const saveBtn = document.getElementById(`rctSaveBtn_${rid}`);
    if (saveBtn) { saveBtn.textContent = '…'; saveBtn.disabled = true; }

    try {
      // 1. Save to DB — only modified columns
      const { error: updErr } = await supa.from('recipes').update(patch).eq('id', rid);
      if (updErr) throw updErr;

      // 2. Read-back immediately
      const colKeys = COLUMNS
        .filter(c => !c.key.startsWith('_'))
        .map(c => c.key).join(',');
      const { data: fresh, error: readErr } = await supa.from('recipes')
        .select(colKeys)
        .eq('id', rid)
        .single();
      if (readErr) throw readErr;

      // 3. Verify each modified field
      const mismatches = [];
      Object.entries(patch).forEach(([key, expected]) => {
        const got = fresh[key] ?? null;
        const exp = expected ?? null;
        // Numeric comparison with tolerance
        if (typeof exp === 'number' || typeof got === 'number') {
          const expN = parseFloat(exp);
          const gotN = parseFloat(got);
          if (Math.abs(expN - gotN) > 0.0001) {
            mismatches.push({ key, expected: exp, got });
          }
        } else if (String(got) !== String(exp) && !(got === null && exp === null)) {
          mismatches.push({ key, expected: exp, got });
        }
      });

      if (mismatches.length > 0) {
        throw new Error('Read-back mismatch: ' + mismatches.map(m =>
          `${m.key} expected ${JSON.stringify(m.expected)} got ${JSON.stringify(m.got)}`
        ).join('; '));
      }

      // 4. Update in-memory record
      Object.assign(rowObj.recipe, fresh);
      rowObj._edits = {};
      rowObj._dirty = false;
      rowObj._lastSave = { ok: true, patch };

    } catch (e) {
      rowObj._lastSave = { ok: false, error: e.message, patch };
    } finally {
      rowObj._saving = false;
      if (saveBtn) { saveBtn.textContent = 'Save'; saveBtn.disabled = false; }
    }

    // Re-render this row
    _rctReRenderRow(rowObj);
  };

  // ── Re-render single row after save ───────────────────────────────────────
  function _rctReRenderRow(rowObj) {
    const rid = rowObj.recipe.id;
    const rowEl = document.getElementById(`rctRow_${rid}`);
    if (!rowEl) return;

    const rec = rowObj.recipe;
    const rowBg = rowObj._dirty ? 'background:#fffbeb;' : rowObj._saving ? 'background:#f0fdf4;' : '';

    // Rebuild cells
    const tdBase = `padding:6px 10px;border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;vertical-align:middle;`;

    // Actions
    const actCell = rowEl.querySelector('td:first-child');
    if (actCell) {
      actCell.innerHTML = `
        <div style="display:flex;gap:4px;align-items:center;">
          <button id="rctSaveBtn_${rid}" onclick="rctSaveRow('${rid}')"
            style="padding:4px 10px;border-radius:6px;border:none;cursor:pointer;font-size:11px;font-weight:700;
              background:${rowObj._dirty?'#059669':'#e2e8f0'};
              color:${rowObj._dirty?'white':'#94a3b8'};
              opacity:${rowObj._dirty?'1':'0.6'};
              pointer-events:${rowObj._dirty?'auto':'none'};">Save</button>
          <button onclick="rctResetRow('${rid}')"
            style="padding:4px 8px;border-radius:6px;border:1px solid #e2e8f0;cursor:pointer;font-size:11px;
              background:white;color:#64748b;display:${rowObj._dirty?'inline-block':'none'};"
            id="rctResetBtn_${rid}">Reset</button>
          ${rowObj._lastSave ? _rctSaveBadge(rowObj._lastSave) : ''}
        </div>`;
    }

    // Rebuild all data cells
    COLUMNS.forEach((col, ci) => {
      const tdEl = rowEl.querySelector(`td:nth-child(${ci+2})`);
      if (!tdEl) return;

      const rawVal = col.key.startsWith('_')
        ? (rowObj[col.key] ?? null)
        : (rec[col.key] ?? null);

      const stickyAdd = ci === 0 ? `position:sticky;left:0;z-index:2;` : ci === 1 ? `position:sticky;left:60px;z-index:2;` : '';
      tdEl.style.cssText = `${tdBase}${stickyAdd}${rowBg}`;
      tdEl.innerHTML = _rctCellContent(col, rawVal, rid);

      // Re-wire events
      if (col.editable) {
        const el = document.getElementById(`rctCell_${rid}_${col.key}`);
        if (el) {
          el.addEventListener('change', (e) => _rctOnChange(rid, col, e.target.value));
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            el.addEventListener('input', (e) => _rctOnChange(rid, col, e.target.value));
          }
        }
      }
    });

    // Show save result notification
    if (rowObj._lastSave) {
      _rctShowSaveNotification(rowObj);
    }
  }

  // ── Save notification (change summary) ───────────────────────────────────
  function _rctShowSaveNotification(rowObj) {
    const rid = rowObj.recipe.id;
    const existingNotif = document.getElementById(`rctNotif_${rid}`);
    if (existingNotif) existingNotif.remove();

    if (!rowObj._lastSave) return;

    const notif = document.createElement('div');
    notif.id = `rctNotif_${rid}`;

    if (!rowObj._lastSave.ok) {
      notif.style.cssText = `
        position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
        background:#fef2f2;border:1.5px solid #fca5a5;border-radius:12px;
        padding:12px 16px;z-index:999;max-width:400px;font-size:12px;color:#991b1b;
        box-shadow:0 4px 20px rgba(0,0,0,0.15);
      `;
      notif.innerHTML = `<b>Save failed</b><br>${_esc(rowObj._lastSave.error || 'Unknown error')}`;
    } else {
      const patch = rowObj._lastSave.patch || {};
      const lines = Object.entries(patch).map(([k, v]) => {
        const col = COLUMNS.find(c => c.key === k);
        const label = col ? col.label : k;
        const db = col ? col.db : k;
        return `<div>· <b>${_esc(label)}</b>: ${v === null ? '<i>NULL</i>' : _esc(String(v))} <span style="color:#94a3b8;font-size:10px;">(${_esc(db)})</span></div>`;
      }).join('');

      notif.style.cssText = `
        position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
        background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;
        padding:12px 16px;z-index:999;max-width:480px;font-size:12px;color:#14532d;
        box-shadow:0 4px 20px rgba(0,0,0,0.15);
      `;
      notif.innerHTML = `
        <div style="font-weight:700;margin-bottom:6px;">✅ Saved &amp; verified from DB</div>
        <div style="font-weight:600;margin-bottom:4px;">Recipe: ${_esc(rowObj.recipe.title)}</div>
        ${lines}
        <div style="margin-top:6px;color:#059669;font-weight:600;">Read-back: Confirmed ✓</div>
      `;
    }

    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 5000);
  }

  // ── Utilities ─────────────────────────────────────────────────────────────
  function _esc(str) {
    return (str || '').toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Expose filter globally (called from inline onclick in header)
  window.rctApplyFilter = rctApplyFilter;

})();
