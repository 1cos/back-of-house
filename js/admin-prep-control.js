// ── PREP CONTROL — js/admin-prep-control.js ──────────────────────────────────
// Admin tool: inspect all active prep tasks with their latest suggestions.
// V1A: List + Search + Filter.
// V1B: Read-only detail panel with lazy history queries.
// No EF calls. No writes.
// ─────────────────────────────────────────────────────────────────────────────

(function () {

  // ── Status sort order ─────────────────────────────────────────────────────
  const STATUS_ORDER = [
    'do_first',
    'count_first',
    'prep_today',
    'no_demand_path',
    'looks_ok',
    'defer_to_tomorrow',
    'out_of_scope',
    '__no_suggestion__',
  ];

  const STATUS_META = {
    do_first:          { label: 'Do First',      dot: '#ef4444', bg: '#fef2f2', border: '#fecaca', text: '#dc2626' },
    count_first:       { label: 'Count First',   dot: '#f59e0b', bg: '#fffbeb', border: '#fde68a', text: '#d97706' },
    prep_today:        { label: 'Prep Today',    dot: '#f97316', bg: '#fff7ed', border: '#fed7aa', text: '#ea580c' },
    no_demand_path:    { label: 'No Demand',     dot: '#94a3b8', bg: '#f8fafc', border: '#e2e8f0', text: '#64748b' },
    looks_ok:          { label: 'Looks OK',      dot: '#22c55e', bg: '#f0fdf4', border: '#bbf7d0', text: '#16a34a' },
    defer_to_tomorrow: { label: 'Defer',         dot: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe', text: '#2563eb' },
    out_of_scope:      { label: 'Checklist',     dot: '#cbd5e1', bg: '#f8fafc', border: '#e2e8f0', text: '#94a3b8' },
    __no_suggestion__: { label: 'No Suggestion', dot: '#cbd5e1', bg: '#f8fafc', border: '#e2e8f0', text: '#94a3b8' },
  };

  const CONF_META = {
    high:   { label: 'High',   color: '#16a34a' },
    medium: { label: 'Med',    color: '#d97706' },
    low:    { label: 'Low',    color: '#94a3b8' },
  };

  // ── Module-level state ────────────────────────────────────────────────────
  let _pcRows         = [];
  let _pcSearch       = '';
  let _pcFilterStatus = '';
  let _pcView         = 'list';   // 'list' | 'detail'
  let _pcDetailRow    = null;     // the joined row being inspected
  let _pcListScroll   = 0;        // scroll position to restore
  let _pcRecalcInFlight = false;  // duplicate-request guard

  // ── Helpers ───────────────────────────────────────────────────────────────
  function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtQty(val, unit) {
    if (val === null || val === undefined) return '—';
    const v = parseFloat(val);
    if (isNaN(v)) return '—';
    const u = (unit || '').toLowerCase();
    if (u === 'g') {
      if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + ' kg';
      return Math.round(v) + ' g';
    }
    return (v % 1 === 0 ? Math.round(v) : v.toFixed(2)) + (unit ? ' ' + unit : '');
  }

  function fmtStockHtml(val, unit) {
    if (val === null || val === undefined) return '<span style="color:#94a3b8;">—</span>';
    return '<span style="font-weight:600;">' + esc(fmtQty(val, unit)) + '</span>';
  }

  function fmtOutput(val, unit) {
    if (val === null || val === undefined || parseFloat(val) === 0) return '';
    return '→ ' + fmtQty(val, unit);
  }

  function fmtDateCDT(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
      hour12: true,
    });
  }

  function fmtDateOnly(iso) {
    if (!iso) return '—';
    return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  }

  function sortRows(rows) {
    return [...rows].sort((a, b) => {
      const ai = STATUS_ORDER.indexOf(a._status);
      const bi = STATUS_ORDER.indexOf(b._status);
      if (ai !== bi) return ai - bi;
      return (a.name || '').localeCompare(b.name || '');
    });
  }

  function filteredRows() {
    let rows = _pcRows;
    if (_pcFilterStatus) rows = rows.filter(r => r._status === _pcFilterStatus);
    if (_pcSearch.trim()) {
      const q = _pcSearch.trim().toLowerCase();
      rows = rows.filter(r => (r.name || '').toLowerCase().includes(q));
    }
    return sortRows(rows);
  }

  // ── KV row helper for detail panel ───────────────────────────────────────
  function kv(label, valueHtml, opts) {
    const muted = opts && opts.muted;
    const warn  = opts && opts.warn;
    const valColor = warn ? '#b45309' : (muted ? '#94a3b8' : '#0f172a');
    return `<div style="display:flex;justify-content:space-between;align-items:baseline;
      padding:5px 0;border-bottom:1px solid #f1f5f9;gap:12px;">
      <span style="font-size:11px;color:#64748b;flex-shrink:0;">${esc(label)}</span>
      <span style="font-size:12px;font-weight:600;color:${valColor};text-align:right;word-break:break-all;">${valueHtml}</span>
    </div>`;
  }

  function sectionHdr(title) {
    return `<div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;
      letter-spacing:0.06em;margin:14px 0 6px;">${esc(title)}</div>`;
  }

  function warnBanner(msg) {
    return `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;
      padding:7px 10px;font-size:12px;color:#b45309;margin-bottom:6px;">⚠️ ${esc(msg)}</div>`;
  }

  // ── Filter chips ──────────────────────────────────────────────────────────
  function buildFilterChips(all) {
    const counts = {};
    for (const r of all) counts[r._status] = (counts[r._status] || 0) + 1;
    const chips = [{ key: '', label: 'All', count: all.length }];
    for (const key of STATUS_ORDER) {
      if (counts[key]) chips.push({ key, label: STATUS_META[key]?.label || key, count: counts[key] });
    }
    return chips.map(c => {
      const active = _pcFilterStatus === c.key;
      const meta = c.key ? STATUS_META[c.key] : null;
      return `<button onclick="window._pcSetFilter('${esc(c.key)}')"
        style="flex-shrink:0;padding:5px 11px;border-radius:20px;
          border:1.5px solid ${active ? (meta?.border || '#bfdbfe') : '#e2e8f0'};
          background:${active ? (meta?.bg || '#eff6ff') : 'white'};
          color:${active ? (meta?.text || '#1e3a5f') : '#64748b'};
          font-size:12px;font-weight:${active ? '700' : '500'};cursor:pointer;
          font-family:inherit;white-space:nowrap;
          display:inline-flex;align-items:center;gap:5px;
          -webkit-tap-highlight-color:transparent;">
        ${c.key ? `<span style="width:7px;height:7px;border-radius:50%;background:${meta?.dot || '#cbd5e1'};flex-shrink:0;display:inline-block;"></span>` : ''}
        ${esc(c.label)} <span style="opacity:0.65;">${c.count}</span>
      </button>`;
    }).join('');
  }

  // ── List row render ───────────────────────────────────────────────────────
  function renderRow(r) {
    const meta = STATUS_META[r._status] || STATUS_META.__no_suggestion__;
    const conf = r.confidence ? CONF_META[r.confidence] : null;
    const outputStr = fmtOutput(r.planned_output, r.output_unit);
    const showWarn = r.production_constraint_quality &&
      (r.production_constraint_quality === 'missing' || r.production_constraint_quality === 'conflicting') &&
      r._status !== 'out_of_scope' && r._status !== '__no_suggestion__' &&
      r._status !== 'looks_ok' && r._status !== 'no_demand_path';

    // Row ID is encoded in the onclick so the detail opener can find the row object
    const rowIdx = _pcRows.indexOf(r);
    return `<div onclick="window._pcOpenDetail(${rowIdx})"
      style="background:${meta.bg};border:1.5px solid ${meta.border};border-radius:12px;
        padding:11px 13px;cursor:pointer;
        display:grid;grid-template-columns:1fr auto;gap:4px 10px;align-items:center;
        -webkit-tap-highlight-color:rgba(0,0,0,0.04);">
      <div style="min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span style="font-size:14px;font-weight:700;color:#0f172a;
            overflow:hidden;text-overflow:ellipsis;">${esc(r.name)}</span>
          ${showWarn ? '<span title="Batch size not configured" style="font-size:12px;color:#f59e0b;">⚠️</span>' : ''}
        </div>
        <div style="font-size:11px;color:#64748b;margin-top:1px;">${esc(r.category || '—')}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0;">
        <span style="font-size:11px;font-weight:700;color:${meta.text};
          background:white;border:1px solid ${meta.border};
          padding:2px 8px;border-radius:20px;white-space:nowrap;">${esc(meta.label)}</span>
        ${conf ? `<span style="font-size:10px;color:${conf.color};font-weight:600;">${conf.label}</span>` : ''}
      </div>
      <div style="grid-column:1/3;display:flex;align-items:center;gap:10px;margin-top:2px;flex-wrap:wrap;">
        <span style="font-size:12px;color:#64748b;">Stock: ${fmtStockHtml(r.current_stock, r.unit)}</span>
        ${outputStr ? `<span style="font-size:12px;color:${meta.text};font-weight:600;">${esc(outputStr)}</span>` : ''}
      </div>
    </div>`;
  }

  // ── List render ───────────────────────────────────────────────────────────
  function pcRender() {
    const listEl  = document.getElementById('pcList');
    const countEl = document.getElementById('pcFilterCount');
    const chipsEl = document.getElementById('pcChips');
    if (!listEl) return;

    const searchFiltered = _pcSearch.trim()
      ? _pcRows.filter(r => (r.name || '').toLowerCase().includes(_pcSearch.trim().toLowerCase()))
      : _pcRows;
    if (chipsEl) chipsEl.innerHTML = buildFilterChips(searchFiltered);

    const visible = filteredRows();
    if (countEl) countEl.textContent = visible.length + ' / ' + _pcRows.length + ' prep';

    if (!visible.length) {
      listEl.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:32px 16px;font-size:14px;">No prep tasks match.</div>';
      return;
    }
    listEl.innerHTML = visible.map(renderRow).join('');
  }

  // ── Show list view (called by Back) ───────────────────────────────────────
  function showList() {
    _pcView = 'list';
    _pcDetailRow = null;

    const modal = document.getElementById('pcModal');
    if (!modal) return;

    // Restore search input value
    const si = document.getElementById('pcSearchInput');
    if (si) si.value = _pcSearch;

    // Show list panels, hide detail
    const listWrap = document.getElementById('pcListWrap');
    const detailWrap = document.getElementById('pcDetailWrap');
    if (listWrap) listWrap.style.display = 'contents';
    if (detailWrap) { detailWrap.style.display = 'none'; detailWrap.innerHTML = ''; }

    // Re-render list
    pcRender();

    // Restore scroll
    const listEl = document.getElementById('pcList');
    if (listEl) listEl.scrollTop = _pcListScroll;
  }

  // ── Open detail for one row ───────────────────────────────────────────────
  window._pcOpenDetail = async function (rowIdx) {
    const r = _pcRows[rowIdx];
    if (!r) return;
    _pcDetailRow = r;
    _pcView = 'detail';

    // Save scroll position
    const listEl = document.getElementById('pcList');
    if (listEl) _pcListScroll = listEl.scrollTop;

    // Hide list, show detail container
    const listWrap = document.getElementById('pcListWrap');
    if (listWrap) listWrap.style.display = 'none';

    let detailWrap = document.getElementById('pcDetailWrap');
    if (!detailWrap) {
      detailWrap = document.createElement('div');
      detailWrap.id = 'pcDetailWrap';
      detailWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;';
      document.getElementById('pcModal')?.appendChild(detailWrap);
    }
    detailWrap.style.display = 'flex';

    // Skeleton while loading
    const meta = STATUS_META[r._status] || STATUS_META.__no_suggestion__;
    detailWrap.innerHTML = `
      <!-- Detail header -->
      <div style="flex-shrink:0;padding:12px 16px 10px;background:white;border-bottom:1px solid #e2e8f0;
        display:flex;align-items:center;gap:10px;">
        <button onclick="window._pcBack()"
          style="padding:6px 12px;background:#f1f5f9;border:none;border-radius:8px;
            font-size:13px;font-weight:600;color:#1e3a5f;cursor:pointer;
            display:flex;align-items:center;gap:4px;flex-shrink:0;
            -webkit-tap-highlight-color:transparent;">← Back</button>
        <div style="min-width:0;">
          <div style="font-size:15px;font-weight:800;color:#1e3a5f;
            overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.name)}</div>
          <div style="font-size:11px;color:#94a3b8;">${esc(r.category || '—')}</div>
        </div>
        <span style="flex-shrink:0;font-size:11px;font-weight:700;color:${meta.text};
          background:${meta.bg};border:1px solid ${meta.border};
          padding:3px 10px;border-radius:20px;margin-left:auto;">${esc(meta.label)}</span>
      </div>
      <!-- Detail body -->
      <div id="pcDetailBody"
        style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;
          padding:12px 14px 40px;">
        <div style="text-align:center;color:#94a3b8;padding:32px;font-size:13px;">Loading…</div>
      </div>
    `;

    // ── Lazy data fetch ───────────────────────────────────────────────────
    try {
      // Fetch all 5 lazy queries in parallel
      const [countRes, prodRes, ded3Res, sugFullRes, recipeRes] = await Promise.all([
        // Latest physical count
        supa.from('prep_stock_counts')
          .select('counted_qty,unit,qty_native,counted_by,counted_at,reconcile_status,expires_at,source')
          .eq('prep_task_id', r.id)
          .order('counted_at', { ascending: false })
          .limit(1)
          .maybeSingle(),

        // Latest production log
        supa.from('prep_log')
          .select('created_at,user_name,qty,unit,duration_minutes')
          .eq('prep_task_id', r.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),

        // Latest 3 stock deductions
        supa.from('stock_deductions')
          .select('business_date,quantity,unit,source,pos_item_name,portions_sold')
          .eq('prep_task_id', r.id)
          .order('business_date', { ascending: false })
          .limit(3),

        // Full suggestion row (includes forecast_path, stock_source, debug_json)
        r.suggestion_date
          ? supa.from('prep_suggestions_daily')
              .select('suggestion_date,generated_at,status,confidence,planned_output,output_unit,net_requirement,demand_source,forecast_path,stock_source,minimum_increment,production_constraint_quality,debug_json')
              .eq('prep_task_id', r.id)
              .eq('suggestion_date', r.suggestion_date)
              .maybeSingle()
          : Promise.resolve({ data: null }),

        // Recipe + BOM (only if recipe_id exists)
        r.recipe_id
          ? supa.from('recipes')
              .select('id,title,pos_name,base_weight_g,base_servings')
              .eq('id', r.recipe_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      const count   = countRes.data  || null;
      const prod    = prodRes.data   || null;
      const ded3    = ded3Res.data   || [];
      const sugFull = sugFullRes.data || null;
      const recipe  = recipeRes.data || null;

      // BOM: only fetch if recipe found
      let bomRows = [];
      if (recipe) {
        const { data: bomData } = await supa
          .from('recipe_bom')
          .select('component_type,quantity,unit,item_id,sub_recipe_id,sort_order')
          .eq('parent_recipe_id', recipe.id)
          .order('sort_order');

        // Gather ingredient names for ITEM rows
        const itemIds = (bomData || []).filter(b => b.component_type === 'ITEM' && b.item_id)
          .map(b => b.item_id);
        const subIds  = (bomData || []).filter(b => b.component_type === 'RECIPE' && b.sub_recipe_id)
          .map(b => b.sub_recipe_id);

        let ingNames = {}, subNames = {};
        if (itemIds.length) {
          const { data: ings } = await supa.from('ingredients')
            .select('id,name').in('id', itemIds);
          for (const i of (ings || [])) ingNames[i.id] = i.name;
        }
        if (subIds.length) {
          const { data: subs } = await supa.from('recipes')
            .select('id,title').in('id', subIds);
          for (const s of (subs || [])) subNames[s.id] = s.title;
        }

        bomRows = (bomData || []).map(b => ({
          ...b,
          displayName: b.component_type === 'ITEM'
            ? (ingNames[b.item_id] || '(ingredient)')
            : (subNames[b.sub_recipe_id] || '(sub-recipe)'),
        }));
      }

      renderDetail(r, count, prod, ded3, sugFull, recipe, bomRows);

    } catch (err) {
      const body = document.getElementById('pcDetailBody');
      if (body) body.innerHTML = `<div style="color:#ef4444;padding:16px;font-size:13px;">Error loading detail: ${esc(err.message)}</div>`;
    }
  };

  // ── Render detail body ────────────────────────────────────────────────────
  function renderDetail(r, count, prod, ded3, sugFull, recipe, bomRows) {
    const body = document.getElementById('pcDetailBody');
    if (!body) return;

    const dj = sugFull?.debug_json || null;
    let html = '';


    // ── EXECUTIVE SUMMARY ─────────────────────────────────────────────────
    // Deterministic chef-facing briefing. Built from fields already loaded.
    // No AI, no new queries. Inserted as the first section in renderDetail.
    html += (function _buildPcExecSummary() {
      const status = (sugFull && sugFull.status) || r._status || '__no_suggestion__';
      const unit   = sugFull?.output_unit || r.unit || '';
      const stock  = r.current_stock;
      const po     = sugFull?.planned_output ?? null;
      const nr     = sugFull?.net_requirement ?? null;
      const pq     = sugFull?.production_constraint_quality || '';
      const mi     = sugFull?.minimum_increment ?? null;
      const ss     = sugFull?.stock_source || '';
      const hasCount = !!count;
      const hasProd  = !!prod;
      const hasDed   = ded3 && ded3.length > 0;

      // Format a quantity as a short human string
      function _fmt(val, u) {
        if (val === null || val === undefined) return null;
        const v = parseFloat(val);
        if (isNaN(v) || v <= 0) return null;
        const ul = (u || '').toLowerCase();
        if (ul === 'g') {
          return v >= 1000
            ? (v / 1000).toFixed(1).replace(/\.0$/, '') + ' kg'
            : Math.round(v) + ' g';
        }
        if (ul === 'kg') return (v % 1 === 0 ? v : v.toFixed(1)) + ' kg';
        if (ul === 'pz' || ul === 'pezzi') {
          const n = Math.round(v);
          return n + (n === 1 ? ' piece' : ' pieces');
        }
        return (v % 1 === 0 ? Math.round(v) : v.toFixed(1)) + (u ? ' ' + u : '');
      }

      // Format stock from the task row
      function _fmtStock() {
        if (stock === null || stock === undefined) return null;
        const v = parseFloat(stock);
        if (isNaN(v)) return null;
        const ul = (r.unit || '').toLowerCase();
        if (ul === 'g') {
          if (v === 0) return '0 g';
          return v >= 1000
            ? (v / 1000).toFixed(1).replace(/\.0$/, '') + ' kg'
            : Math.round(v) + ' g';
        }
        if (ul === 'pz' || ul === 'pezzi') {
          const n = Math.round(v);
          return n + (n === 1 ? ' piece' : ' pieces');
        }
        return (v % 1 === 0 ? Math.round(v) : v.toFixed(1)) + (r.unit ? ' ' + r.unit : '');
      }

      // Batch label: "2 batches (6.3 kg)" or just "6.3 kg"
      function _fmtOutput() {
        const s = _fmt(po, unit);
        if (!s) return null;
        if (mi && parseFloat(mi) > 0 && pq === 'valid_fixed_batch') {
          const batches = Math.round(parseFloat(po) / parseFloat(mi));
          if (batches > 0) return batches + (batches === 1 ? ' batch' : ' batches') + ' — ' + s;
        }
        return s;
      }

      let headline = '';
      let reasons  = [];
      let bg       = '#f8fafc';
      let border   = '#e2e8f0';
      let hColor   = '#334155';
      let accent   = '#e2e8f0';

      // ── NO SUGGESTION ───────────────────────────────────────────────────
      if (status === '__no_suggestion__') {
        headline = 'No suggestion available.';
        reasons.push('The bot has not generated a suggestion for this prep yet.');
        if (!hasDed) reasons.push('No POS deduction history found — the demand path may not be configured.');
        bg = '#f8fafc'; border = '#e2e8f0'; hColor = '#64748b'; accent = '#e2e8f0';
      }

      // ── OUT OF SCOPE ─────────────────────────────────────────────────────
      else if (status === 'out_of_scope') {
        headline = 'Not tracked by the planner.';
        reasons.push('This is a checklist or operational item, not a batch-production prep.');
        reasons.push('No quantity recommendation applies here.');
        bg = '#f8fafc'; border = '#e2e8f0'; hColor = '#64748b'; accent = '#e2e8f0';
      }

      // ── NO DEMAND PATH ───────────────────────────────────────────────────
      else if (status === 'no_demand_path') {
        headline = 'No production recommendation available.';
        reasons.push('This prep is not connected to a usable demand path in the system.');
        if (!hasDed) reasons.push('No POS deductions have been recorded for it.');
        else         reasons.push('Deduction history exists but could not be matched to a valid path.');
        if (!r.recipe_id) reasons.push('No recipe is linked to this prep task.');
        bg = '#f8fafc'; border = '#e2e8f0'; hColor = '#475569'; accent = '#e2e8f0';
      }

      // ── COUNT FIRST ──────────────────────────────────────────────────────
      else if (status === 'count_first') {
        headline = 'Count the stock before producing.';
        const stockStr = _fmtStock();
        if (stock === null || stock === undefined) {
          reasons.push('No stock reading has been recorded for this prep yet.');
        } else if (stockStr) {
          reasons.push('Recorded stock is ' + stockStr + ' but has not been physically verified.');
        } else {
          reasons.push('The current inventory reading is not considered reliable.');
        }
        reasons.push('Align Stock after counting so the planner can give an accurate recommendation.');
        bg = '#fffbeb'; border = '#fde68a'; hColor = '#92400e'; accent = '#fde68a';
      }

      // ── LOOKS OK ─────────────────────────────────────────────────────────
      else if (status === 'looks_ok') {
        headline = 'No production needed.';
        const stockStr = _fmtStock();
        if (stockStr) {
          reasons.push('Current stock is ' + stockStr + ', which covers the expected demand window.');
        } else {
          reasons.push('Recorded stock is sufficient for the coverage window.');
        }
        if (nr !== null && parseFloat(nr) <= 0) {
          reasons.push('Net requirement after stock is zero or negative.');
        }
        bg = '#f0fdf4'; border = '#bbf7d0'; hColor = '#166534'; accent = '#bbf7d0';
      }

      // ── DEFER TO TOMORROW ────────────────────────────────────────────────
      else if (status === 'defer_to_tomorrow') {
        headline = 'Hold off — check again tomorrow morning.';
        const stockStr = _fmtStock();
        if (stockStr) {
          reasons.push('Current stock (' + stockStr + ') should be enough to cover today.');
        } else {
          reasons.push('Stock appears sufficient to cover today\'s service.');
        }
        reasons.push('The system will reassess overnight and confirm whether production is needed.');
        bg = '#f0fdf4'; border = '#d1fae5'; hColor = '#065f46'; accent = '#d1fae5';
      }

      // ── PREP TODAY ───────────────────────────────────────────────────────
      else if (status === 'prep_today') {
        const outStr = _fmtOutput();
        headline = outStr
          ? 'Plan to produce ' + outStr + ' today.'
          : 'Some production needed today.';
        const stockStr = _fmtStock();
        if (stockStr && parseFloat(stock) > 0) {
          reasons.push('Current stock is ' + stockStr + ' — enough for now, but not for the full shift.');
        } else {
          reasons.push('Stock levels are low relative to expected demand.');
        }
        if (ss === 'db_snapshot_unverified') {
          reasons.push('Check the cooler before starting — stock level has not been physically confirmed.');
        }
        bg = '#fff7ed'; border = '#fed7aa'; hColor = '#9a3412'; accent = '#fed7aa';
      }

      // ── DO FIRST ─────────────────────────────────────────────────────────
      else if (status === 'do_first') {
        const outStr = _fmtOutput();
        const noConstraint = (pq === 'missing' || pq === 'conflicting') && !outStr;
        if (outStr) {
          headline = 'Produce ' + outStr + ' before anything else.';
        } else if (noConstraint) {
          headline = 'Production needed — batch size not configured.';
        } else {
          headline = 'This prep needs to happen before service.';
        }
        const stockStr = _fmtStock();
        if (stock !== null && parseFloat(stock) === 0) {
          reasons.push('Current stock is at zero.');
        } else if (stockStr) {
          reasons.push('Recorded stock is critically low' +
            (ss === 'db_snapshot_unverified' ? ' and has not been physically verified.' : '.'));
        } else {
          reasons.push('Current stock is insufficient for the coverage window.');
        }
        if (noConstraint) {
          reasons.push('Set a batch size in the recipe to get a precise quantity.');
        } else if (nr !== null && parseFloat(nr) > 0) {
          const nrStr = _fmt(nr, unit);
          if (nrStr) reasons.push('Net requirement: ' + nrStr + ' to cover expected demand.');
        }
        if (!hasProd) reasons.push('No production has been recorded recently for this prep.');
        bg = '#fef2f2'; border = '#fecaca'; hColor = '#991b1b'; accent = '#fecaca';
      }

      // ── FALLBACK ─────────────────────────────────────────────────────────
      else {
        headline = 'No recommendation available.';
        reasons.push('This prep has no usable demand path in the system.');
        bg = '#f8fafc'; border = '#e2e8f0'; hColor = '#475569'; accent = '#e2e8f0';
      }

      // ── RENDER ────────────────────────────────────────────────────────────
      const reasonHtml = reasons.slice(0, 3).map(function(txt) {
        return '<div style="font-size:12px;color:#475569;margin-top:4px;line-height:1.5;'
          + 'padding-left:10px;border-left:2px solid ' + accent + ';word-break:break-word;">'
          + esc(txt) + '</div>';
      }).join('');

      return '<div style="background:' + bg + ';border:1px solid ' + border + ';border-radius:12px;'
        + 'padding:12px 14px;margin-bottom:14px;">'
        + '<div style="font-size:14px;font-weight:800;color:' + hColor + ';'
        + 'letter-spacing:-0.01em;line-height:1.35;word-break:break-word;">'
        + esc(headline) + '</div>'
        + reasonHtml
        + '</div>';
    })();
    // ── END EXECUTIVE SUMMARY ──────────────────────────────────────────────


    // ── ACTIONS ───────────────────────────────────────────────────────────
    // Set Count — compact inline action area after Executive Summary.
    html += '<div style="margin-bottom:12px;">'
      + '<button id="pcSetCountBtn" onclick="window._pcSetCount()"'
      + ' style="padding:8px 16px;border-radius:10px;border:1.5px solid #bfdbfe;'
      + 'background:white;color:#1e40af;font-size:13px;font-weight:700;'
      + 'font-family:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;">'
      + '&#x1F4E6; Set Count</button>'
      + '</div>';

    // Inline count form (hidden until button pressed)
    html += '<div id="pcCountForm" style="display:none;background:white;border:1px solid #bfdbfe;'
      + 'border-radius:12px;padding:12px 14px;margin-bottom:12px;">'

      // Header row
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
      + '<span style="font-size:13px;font-weight:700;color:#1e3a5f;">Set Physical Count</span>'
      + '<button onclick="window._pcCancelCount()"'
      + ' style="background:none;border:none;font-size:16px;color:#94a3b8;cursor:pointer;'
      + ' padding:2px 6px;-webkit-tap-highlight-color:transparent;">&times;</button>'
      + '</div>'

      // Prep name + current stock summary
      + '<div style="font-size:12px;color:#64748b;margin-bottom:10px;">'
      + esc(r.name)
      + ' &nbsp;&middot;&nbsp; currently '
      + (r.current_stock !== null && r.current_stock !== undefined
          ? '<span style="font-weight:600;color:#0f172a;">' + esc(fmtQty(r.current_stock, r.unit)) + '</span>'
          : '<span style="color:#94a3b8;">not recorded</span>')
      + '</div>'

      // Input row — onfocus/onblur use double quotes inside the onclick attr string
      + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">'
      + '<input id="pcCountInput" type="number" min="0" step="1" placeholder="0"'
      + ' oninput="window._pcCountValidate()"'
      + ' style="width:96px;height:46px;border:2px solid #cbd5e1;border-radius:10px;'
      + 'font-size:20px;font-weight:700;text-align:center;color:#1e3a5f;'
      + 'background:#fff;outline:none;font-family:inherit;">'
      + '<span style="font-size:14px;color:#64748b;font-weight:600;">' + esc(r.unit || '') + '</span>'
      + '</div>'

      // Validation hint
      + '<div id="pcCountHint" style="font-size:11px;color:#94a3b8;min-height:14px;margin-bottom:10px;"></div>'

      // Save button
      + '<button id="pcCountSaveBtn" disabled onclick="window._pcSaveCount()"'
      + ' style="width:100%;height:44px;border-radius:10px;border:none;'
      + 'font-size:14px;font-weight:700;color:white;background:#94a3b8;'
      + 'font-family:inherit;cursor:not-allowed;letter-spacing:0.02em;'
      + '-webkit-tap-highlight-color:transparent;">Save Count</button>'

      // Result area
      + '<div id="pcCountResult" style="margin-top:8px;font-size:12px;'
      + 'line-height:1.5;word-break:break-word;min-height:0;"></div>'

      + '</div>';
    // ── END ACTIONS ────────────────────────────────────────────────────────

    // ── IDENTITY ──────────────────────────────────────────────────────────
    html += sectionHdr('Identity');
    html += `<div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin-bottom:4px;">`;
    html += kv('Prep Task ID',  String(r.id));
    html += kv('Category',      r.category || '—');
    html += kv('Native unit',   r.unit || '—');
    html += kv('Recipe ID',     r.recipe_id
      ? `<span style="font-size:10px;font-family:monospace;">${esc(r.recipe_id)}</span>`
      : '<span style="color:#94a3b8;">not linked</span>', { muted: !r.recipe_id });
    html += `</div>`;

    // ── CURRENT SITUATION ────────────────────────────────────────────────
    // Four chef-facing rows. Technical detail preserved in Admin Diagnostics.
    html += sectionHdr('Current Situation');
    html += `<div style="background:white;border:1px solid #e2e8f0;border-radius:10px;
      padding:0;margin-bottom:4px;overflow:hidden;">`;

    // Helper: one situation row
    function sitRow(label, valueHtml, opts) {
      const borderTop = opts && opts.first ? 'none' : '1px solid #f1f5f9';
      const labelColor = '#64748b';
      return `<div style="display:grid;grid-template-columns:110px 1fr;
        align-items:start;gap:8px;padding:9px 12px;border-top:${borderTop};">
        <span style="font-size:10px;font-weight:700;color:${labelColor};
          text-transform:uppercase;letter-spacing:0.06em;padding-top:1px;">${esc(label)}</span>
        <span style="font-size:13px;color:#0f172a;line-height:1.4;word-break:break-word;">${valueHtml}</span>
      </div>`;
    }

    // ── ON HAND ──────────────────────────────────────────────────────────
    {
      const stockVal = (r.current_stock !== null && r.current_stock !== undefined)
        ? parseFloat(r.current_stock) : null;
      const ss = sugFull?.stock_source || '';
      let stockHtml;
      if (stockVal === null || isNaN(stockVal)) {
        stockHtml = '<span style="color:#94a3b8;">Not recorded</span>';
      } else if (stockVal === 0) {
        stockHtml = '<span style="font-weight:700;color:#dc2626;">0 ' + esc(r.unit || '') + '</span>'
          + (ss === 'db_snapshot_unverified'
            ? ' <span style="font-size:11px;color:#b45309;font-weight:600;">· unverified</span>' : '');
      } else {
        stockHtml = '<span style="font-weight:700;color:#0f172a;">' + esc(fmtQty(r.current_stock, r.unit)) + '</span>'
          + (ss === 'db_snapshot_unverified'
            ? ' <span style="font-size:11px;color:#b45309;font-weight:600;">· unverified</span>' : '');
      }
      html += sitRow('On Hand', stockHtml, { first: true });
    }

    // ── LAST COUNT ───────────────────────────────────────────────────────
    {
      let countHtml;
      if (count) {
        const isExpired = count.expires_at && new Date(count.expires_at) < new Date();
        const qtyNative = count.qty_native != null ? count.qty_native : count.counted_qty;
        const qtyStr    = fmtQty(qtyNative, r.unit);
        const timeStr   = fmtDateCDT(count.counted_at);
        const who       = count.counted_by || '?';
        countHtml = '<span style="font-weight:600;color:#0f172a;">' + esc(qtyStr) + '</span>'
          + ' · ' + esc(who)
          + ' · <span style="color:#64748b;">' + esc(timeStr) + '</span>';
        if (isExpired) {
          countHtml += ' <span style="font-size:11px;font-weight:700;color:#ef4444;">· expired</span>';
        }
      } else {
        countHtml = '<span style="color:#94a3b8;">No recent physical count</span>';
      }
      html += sitRow('Last Count', countHtml);
    }

    // ── LAST PRODUCTION ──────────────────────────────────────────────────
    {
      let prodHtml;
      if (prod) {
        const qtyStr  = fmtQty(prod.qty, prod.unit);
        const who     = prod.user_name || '?';
        const timeStr = fmtDateCDT(prod.created_at);
        const dur     = prod.duration_minutes
          ? ' <span style="color:#64748b;font-size:11px;">(' + prod.duration_minutes + ' min)</span>'
          : '';
        prodHtml = 'Produced <span style="font-weight:600;color:#0f172a;">' + esc(qtyStr) + '</span>'
          + ' · ' + esc(who)
          + ' · <span style="color:#64748b;">' + esc(timeStr) + '</span>'
          + dur;
      } else {
        prodHtml = '<span style="color:#94a3b8;">No recent production recorded</span>';
      }
      html += sitRow('Last Produced', prodHtml);
    }

    // ── RECENT USE ───────────────────────────────────────────────────────
    {
      let useHtml;
      if (ded3 && ded3.length > 0) {
        // Sum quantities across all deduction rows (same unit assumed — they come from the same prep_task)
        let totalQty = 0;
        let unitLabel = '';
        for (const d of ded3) {
          const q = parseFloat(d.quantity);
          if (!isNaN(q)) { totalQty += q; unitLabel = d.unit || r.unit || ''; }
        }
        const totalStr = fmtQty(totalQty, unitLabel);
        const count3   = ded3.length;
        useHtml = '<span style="font-weight:600;color:#0f172a;">' + esc(totalStr) + '</span>'
          + ' consumed across '
          + '<span style="font-weight:600;">' + count3 + '</span>'
          + (count3 === 1 ? ' recent deduction' : ' recent deductions');
      } else {
        useHtml = '<span style="color:#94a3b8;">No recent consumption recorded</span>';
      }
      html += sitRow('Recent Use', useHtml);
    }

    html += `</div>`;

    // Technical detail preserved for Admin Diagnostics (count + deductions)
    // appended to the dj block below under the existing <details> toggle.

    // ── WHY THIS RECOMMENDATION ─────────────────────────────────────────
    // Deterministic plain-language reasons — no AI, no new queries.
    // Inserted between Current Situation and Latest Suggestion.
    {
      const _wrStatus = (sugFull && sugFull.status) || r._status || '__no_suggestion__';
      const _wrUnit   = sugFull?.output_unit || r.unit || '';
      const _wrStock  = r.current_stock;
      const _wrPo     = sugFull?.planned_output ?? null;
      const _wrNr     = sugFull?.net_requirement ?? null;
      const _wrMi     = sugFull?.minimum_increment ?? null;
      const _wrPq     = sugFull?.production_constraint_quality || '';
      const _wrSs     = sugFull?.stock_source || '';
      const _wrConf   = r.confidence || sugFull?.confidence || '';
      const _wrHasCount = !!count;
      const _wrCountExp = count && count.expires_at && new Date(count.expires_at) < new Date();
      const _wrHasProd  = !!prod;
      const _wrHasDed   = ded3 && ded3.length > 0;

      // Format a quantity — same logic as fmtQty but returns null for invalid/zero
      function _wrFmt(val, u) {
        if (val === null || val === undefined) return null;
        const v = parseFloat(val);
        if (isNaN(v) || v <= 0) return null;
        const ul = (u || '').toLowerCase();
        if (ul === 'g') {
          return v >= 1000
            ? (v / 1000).toFixed(1).replace(/\.0$/, '') + ' kg'
            : Math.round(v) + ' g';
        }
        if (ul === 'kg') return (v % 1 === 0 ? v : v.toFixed(1)) + ' kg';
        if (ul === 'pz' || ul === 'pezzi') {
          const n = Math.round(v);
          return n + (n === 1 ? ' piece' : ' pieces');
        }
        return (v % 1 === 0 ? Math.round(v) : v.toFixed(1)) + (u ? ' ' + u : '');
      }

      // Batch label when constraint is valid_fixed_batch
      function _wrBatchLabel() {
        if (!_wrMi || parseFloat(_wrMi) <= 0) return null;
        if (_wrPq !== 'valid_fixed_batch') return null;
        const s = _wrFmt(_wrMi, _wrUnit);
        return s ? 'batches of ' + s : null;
      }

      const reasons = [];

      if (_wrStatus === '__no_suggestion__') {
        reasons.push('The planner has not generated a suggestion for this prep yet.');
        if (!_wrHasDed) reasons.push('No POS demand has been recorded — the system has nothing to calculate from.');

      } else if (_wrStatus === 'out_of_scope') {
        reasons.push('This is a checklist or operational item, not a batch-production prep.');
        reasons.push('The planner does not calculate quantities for this type of task.');

      } else if (_wrStatus === 'no_demand_path') {
        reasons.push('No recent demand deductions are connected to this prep.');
        reasons.push('The planner cannot estimate how much should be produced.');
        if (!r.recipe_id) reasons.push('No recipe is linked — the system cannot trace a demand path.');

      } else if (_wrStatus === 'count_first') {
        reasons.push('The current stock level is not considered reliable.');
        if (!_wrHasCount) {
          reasons.push('There is no recent valid physical count on record.');
        } else if (_wrCountExp) {
          reasons.push('The most recent physical count has expired.');
        } else {
          reasons.push('The stock source is marked as unverified.');
        }
        reasons.push('Count the prep before deciding whether to produce.');

      } else if (_wrStatus === 'looks_ok') {
        reasons.push('Current stock covers the expected requirement.');
        if (_wrNr !== null && parseFloat(_wrNr) <= 0) {
          reasons.push('Net requirement after stock is zero — nothing more is needed right now.');
        } else {
          reasons.push('No additional production is needed right now.');
        }
        if (_wrConf === 'low') reasons.push('Confidence is low — consider verifying stock before relying on this.');

      } else if (_wrStatus === 'defer_to_tomorrow') {
        reasons.push('Stock is sufficient to get through today.');
        reasons.push('The planner will reassess overnight with updated demand data.');
        if (_wrConf === 'low') reasons.push('Confidence is low — check stock if demand runs higher than expected.');

      } else if (_wrStatus === 'prep_today') {
        if (_wrStock !== null && parseFloat(_wrStock) > 0) {
          reasons.push('Current stock is present but will likely run short before end of service.');
        } else {
          reasons.push('Current stock is low relative to expected demand.');
        }
        const nrStr = _wrFmt(_wrNr, _wrUnit);
        if (nrStr) reasons.push('The remaining requirement is ' + nrStr + '.');
        const batchLabel = _wrBatchLabel();
        if (batchLabel) reasons.push('Production must be made in ' + batchLabel + '.');
        if (_wrSs === 'db_snapshot_unverified') reasons.push('Stock level has not been physically verified — check the cooler first.');

      } else if (_wrStatus === 'do_first') {
        const stockVal = _wrStock !== null ? parseFloat(_wrStock) : null;
        if (stockVal === 0) {
          reasons.push('Current stock is at zero — there is nothing on hand.');
        } else {
          reasons.push('Current stock does not cover expected demand.');
        }
        const nrStr = _wrFmt(_wrNr, _wrUnit);
        if (nrStr) reasons.push('The remaining requirement is ' + nrStr + '.');
        const batchLabel = _wrBatchLabel();
        if (batchLabel) reasons.push('Production must be made in ' + batchLabel + '.');
        if (!_wrHasProd) reasons.push('No recent production has been recorded.');

      } else {
        reasons.push('The planner does not have enough information to explain this recommendation.');
      }

      const capped = reasons.slice(0, 4);

      if (capped.length > 0) {
        html += sectionHdr('Why This Recommendation');
        html += '<div style="background:white;border:1px solid #e2e8f0;border-radius:10px;'
          + 'padding:10px 12px;margin-bottom:4px;">';
        for (const reason of capped) {
          html += '<div style="display:flex;align-items:baseline;gap:8px;'
            + 'padding:4px 0;border-bottom:1px solid #f8fafc;">'
            + '<span style="flex-shrink:0;font-size:11px;color:#cbd5e1;margin-top:1px;">\u2014</span>'
            + '<span style="font-size:13px;color:#334155;line-height:1.45;">' + esc(reason) + '</span>'
            + '</div>';
        }
        html += '</div>';
      }
    }
    // ── END WHY THIS RECOMMENDATION ───────────────────────────────────────

    // ── SUGGESTION ────────────────────────────────────────────────────────
    html += sectionHdr('Latest Suggestion');
    html += `<div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin-bottom:4px;">`;
    if (sugFull) {
      const confMeta = CONF_META[sugFull.confidence] || {};
      html += kv('Suggestion date',  fmtDateOnly(sugFull.suggestion_date));
      html += kv('Generated',        fmtDateCDT(sugFull.generated_at));
      html += kv('Status',           `<span style="font-weight:700;color:${STATUS_META[sugFull.status]?.text || '#0f172a'};">${esc(STATUS_META[sugFull.status]?.label || sugFull.status)}</span>`);
      html += kv('Confidence',       `<span style="color:${confMeta.color || '#64748b'};font-weight:700;">${esc(confMeta.label || sugFull.confidence)}</span>`);
      html += kv('Planned output',   sugFull.planned_output != null ? esc(fmtQty(sugFull.planned_output, sugFull.output_unit)) : '<span style="color:#94a3b8;">—</span>');
      html += kv('Net requirement',  sugFull.net_requirement != null ? esc(fmtQty(sugFull.net_requirement, r.unit)) : '<span style="color:#94a3b8;">—</span>');
      html += kv('Demand source',    esc(sugFull.demand_source || '—'));
      html += kv('Forecast path',    esc(sugFull.forecast_path || '—'));
      html += kv('Stock source',     esc(sugFull.stock_source || '—'));
      html += kv('Min increment',    sugFull.minimum_increment != null ? esc(fmtQty(sugFull.minimum_increment, r.unit)) : '—');
      html += kv('Constraint',       esc(sugFull.production_constraint_quality || '—'));
    } else {
      html += kv('Suggestion', '<span style="color:#94a3b8;">no suggestion available</span>', { muted: true });
    }
    html += `</div>`;

    // ── RECALCULATE BUTTON ────────────────────────────────────────────────
    html += `<div style="margin:10px 0 4px;">`;
    html += `<button id="pcRecalcBtn" onclick="window._pcRecalculate()"
      style="padding:9px 18px;background:#1e3a5f;color:white;border:none;border-radius:10px;
        font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;
        -webkit-tap-highlight-color:transparent;">Recalculate</button>`;
    html += `<div id="pcRecalcResult" style="display:none;margin-top:8px;font-size:12px;
      line-height:1.5;word-break:break-word;"></div>`;
    html += `</div>`;

    // ── DEMAND WINDOW (from debug_json) ───────────────────────────────────
    if (dj && (dj.cadence_type || dj.cover_dates || dj.buffered_forecast != null)) {
      html += sectionHdr('Demand Window');
      html += `<div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin-bottom:4px;">`;
      if (dj.cadence_type) html += kv('Cadence',      esc(dj.cadence_type));
      if (dj.slot_type)    html += kv('Slot type',    esc(dj.slot_type));
      if (dj.window)       html += kv('Window',       esc(dj.window));
      if (Array.isArray(dj.cover_dates) && dj.cover_dates.length) {
        html += kv('Cover dates',  esc(dj.cover_dates.join(', ')));
      }
      if (dj.raw_forecast != null)       html += kv('Raw forecast',      esc(fmtQty(dj.raw_forecast, r.unit)));
      if (dj.buffered_forecast != null)  html += kv('Buffered forecast', esc(fmtQty(dj.buffered_forecast, r.unit)));
      if (dj.buffer_factor != null)      html += kv('Buffer factor',     esc(String(dj.buffer_factor)));
      if (dj.shelf_life_days != null)    html += kv('Shelf life',        esc(String(dj.shelf_life_days)) + ' days');
      if (dj.flag_recount)               html += kv('Flag recount',      '<span style="color:#b45309;font-weight:700;">Yes — verify stock before producing</span>');
      if (dj.zero_unverified)            html += kv('Zero unverified',   '<span style="color:#b45309;">Shows as empty but not physically confirmed</span>');
      html += `</div>`;
    }

    // ── DOW AVERAGES (from debug_json) ────────────────────────────────────
    if (dj && dj.dow_avg && typeof dj.dow_avg === 'object') {
      const DOW_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const entries = Object.entries(dj.dow_avg)
        .filter(([, v]) => v && v.count > 0)
        .sort(([a], [b]) => parseInt(a) - parseInt(b));
      if (entries.length) {
        html += sectionHdr('Day-of-Week Demand Avg');
        html += `<div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin-bottom:4px;">`;
        for (const [dow, v] of entries) {
          html += kv(
            DOW_NAMES[parseInt(dow)] || ('DOW ' + dow),
            esc(fmtQty(v.avg, r.unit)) + ' <span style="color:#94a3b8;font-weight:400;">(' + v.count + ' samples)</span>'
          );
        }
        html += `</div>`;
      }
    }

    // ── CONSTRAINT DETAIL (from debug_json) ───────────────────────────────
    if (dj && dj.constraint_detail && typeof dj.constraint_detail === 'object') {
      const cd = dj.constraint_detail;
      html += sectionHdr('Constraint Detail');
      html += `<div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin-bottom:4px;">`;
      if (cd.quality)           html += kv('Quality',    esc(cd.quality));
      if (cd.minimum_increment != null) html += kv('Min increment', esc(fmtQty(cd.minimum_increment, r.unit)));
      if (cd.source)            html += kv('Source',     esc(cd.source));
      html += `</div>`;
    }

    // ── RECIPE & BOM ──────────────────────────────────────────────────────
    html += sectionHdr('Recipe & BOM');
    if (!r.recipe_id) {
      html += warnBanner('No recipe linked to this prep task.');
    } else if (!recipe) {
      html += warnBanner('Recipe record not found (recipe_id set but recipe missing).');
    } else {
      html += `<div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin-bottom:4px;">`;
      html += kv('Recipe name', esc(recipe.title || '—'));
      if (recipe.pos_name) {
        html += kv('POS name', esc(recipe.pos_name));
      } else {
        html += kv('POS name', '<span style="color:#b45309;">not set</span>', { warn: true });
      }
      if (recipe.base_weight_g != null) html += kv('Batch weight', esc(fmtQty(recipe.base_weight_g, 'g')));
      if (recipe.base_servings  != null) html += kv('Base servings', esc(String(recipe.base_servings)));
      html += kv('BOM rows', String(bomRows.length));
      html += `</div>`;

      if (!recipe.pos_name) html += warnBanner('POS name is empty — this recipe cannot be matched by the POS pipeline.');
      if (!bomRows.length) {
        html += warnBanner('BOM is empty — no ingredients or sub-recipes linked.');
      } else {
        html += `<div style="background:white;border:1px solid #e2e8f0;border-radius:10px;
          padding:10px 12px;margin-bottom:4px;">`;
        html += `<div style="font-size:10px;font-weight:700;color:#64748b;margin-bottom:6px;">
          INGREDIENTS & SUB-RECIPES (${bomRows.length})</div>`;
        for (const b of bomRows) {
          const icon = b.component_type === 'RECIPE' ? '🔄 ' : '';
          html += `<div style="display:flex;justify-content:space-between;align-items:baseline;
            padding:3px 0;border-bottom:1px solid #f8fafc;gap:8px;">
            <span style="font-size:12px;color:#0f172a;overflow:hidden;text-overflow:ellipsis;
              white-space:nowrap;flex:1;">${icon}${esc(b.displayName)}</span>
            <span style="font-size:12px;font-weight:600;color:#1e3a5f;white-space:nowrap;flex-shrink:0;">
              ${esc(fmtQty(b.quantity, b.unit))}</span>
          </div>`;
        }
        html += `</div>`;
      }
    }

    // ── ADMIN DIAGNOSTICS (collapsed) ───────────────────────────────────
    // Contains: raw debug_json, technical count fields, individual deduction rows
    {
      const hasDiag = dj || count || (ded3 && ded3.length > 0);
      if (hasDiag) {
        html += `<details style="margin-top:12px;">
          <summary style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;
            letter-spacing:0.06em;cursor:pointer;padding:4px 0;">Admin diagnostics</summary>
          <div style="margin-top:6px;">`;

        // Count technical detail
        if (count) {
          html += `<div style="font-size:10px;font-weight:700;color:#94a3b8;
            text-transform:uppercase;letter-spacing:0.05em;margin:4px 0 2px;">Count detail</div>`;
          html += `<div style="background:#f8fafc;border-radius:8px;padding:8px 10px;
            font-size:11px;color:#475569;line-height:1.8;">`;
          const qtyNativeDiag = count.qty_native != null ? count.qty_native : count.counted_qty;
          html += 'Qty: <b>' + esc(fmtQty(qtyNativeDiag, r.unit)) + '</b><br>';
          if (count.reconcile_status) html += 'Reconcile status: <b>' + esc(count.reconcile_status) + '</b><br>';
          if (count.source)           html += 'Source: <b>' + esc(count.source) + '</b><br>';
          if (count.expires_at)       html += 'Expires: <b>' + esc(fmtDateCDT(count.expires_at)) + '</b>';
          html += `</div>`;
        }

        // Deduction rows
        if (ded3 && ded3.length > 0) {
          html += `<div style="font-size:10px;font-weight:700;color:#94a3b8;
            text-transform:uppercase;letter-spacing:0.05em;margin:8px 0 2px;">POS deductions (last 3)</div>`;
          html += `<div style="background:#f8fafc;border-radius:8px;padding:8px 10px;
            font-size:11px;color:#475569;line-height:1.8;">`;
          for (const d of ded3) {
            html += esc(d.business_date || '?')
              + ' · ' + esc(d.pos_item_name || d.source || '—')
              + ' · <b>' + esc(fmtQty(d.quantity, d.unit)) + '</b>'
              + (d.portions_sold ? ' (' + Math.round(parseFloat(d.portions_sold)) + ' portions)' : '')
              + '<br>';
          }
          html += `</div>`;
        }

        // Raw debug_json
        if (dj) {
          const rawJson = JSON.stringify(dj, null, 2);
          html += `<div style="font-size:10px;font-weight:700;color:#94a3b8;
            text-transform:uppercase;letter-spacing:0.05em;margin:8px 0 2px;">Debug JSON</div>`;
          html += `<pre style="font-size:10px;color:#64748b;background:#f8fafc;border-radius:8px;
            padding:10px;overflow-x:auto;word-break:break-all;white-space:pre-wrap;
            margin:0;max-height:300px;overflow-y:auto;">${esc(rawJson)}</pre>`;
        }

        html += `</div></details>`;
      }
    }

    body.innerHTML = html;
    // Cache lazy-loaded data so Recalculate can re-render without re-fetching
    body._pcCache = { count, prod, ded3, recipe, bomRows };
  }

  // ── Recalculate: rerun Suggester for the selected prep only ─────────────
  window._pcRecalculate = async function () {
    if (_pcRecalcInFlight) return;

    const r = _pcDetailRow;
    if (!r) return;

    // ── Auth check ────────────────────────────────────────────────────────
    const brigadeToken = sessionStorage.getItem('brigade_token');
    if (!brigadeToken) {
      const errEl = document.getElementById('pcRecalcResult');
      if (errEl) {
        errEl.style.display = 'block';
        errEl.innerHTML = '<span style="color:#dc2626;">Session expired — please log in again before recalculating.</span>';
      }
      return;
    }

    // ── Capture before state ──────────────────────────────────────────────
    const beforeStatus = r.status ? (STATUS_META[r.status]?.label || r.status) : '—';
    const beforeOutput = r.planned_output != null ? fmtQty(r.planned_output, r.output_unit) : '—';

    // ── UI: loading state ─────────────────────────────────────────────────
    _pcRecalcInFlight = true;
    const btn   = document.getElementById('pcRecalcBtn');
    const errEl = document.getElementById('pcRecalcResult');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Recalculating…';
      btn.style.opacity = '0.6';
      btn.style.cursor = 'not-allowed';
    }
    if (errEl) { errEl.style.display = 'none'; errEl.innerHTML = ''; }

    try {
      // ── EF request ───────────────────────────────────────────────────────
      let efResp, efData;
      try {
        efResp = await fetch(
          SUPABASE_URL + '/functions/v1/bot-prep-suggester',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prep_task_ids: [r.id],
              dry_run: false,
              brigade_token: brigadeToken,
            }),
          }
        );
      } catch (netErr) {
        throw new Error('Network error — check your connection and try again.');
      }

      // ── Parse response ────────────────────────────────────────────────────
      try {
        efData = await efResp.json();
      } catch (_) {
        throw new Error('Server returned an unreadable response (HTTP ' + efResp.status + ').');
      }

      if (!efResp.ok) {
        const msg = efData?.error || ('Server error: HTTP ' + efResp.status);
        throw new Error(msg);
      }

      if (efData.success === false) {
        throw new Error(efData?.error || 'Suggester returned an error.');
      }

      // ── Reload the saved suggestion row (date may differ) ─────────────────
      const { data: freshRows, error: freshErr } = await supa
        .from('prep_suggestions_daily')
        .select('prep_task_id,suggestion_date,generated_at,status,confidence,planned_output,output_unit,net_requirement,demand_source,production_constraint_quality,forecast_path,stock_source,minimum_increment,debug_json')
        .eq('prep_task_id', r.id)
        .order('suggestion_date', { ascending: false })
        .order('generated_at', { ascending: false })
        .limit(1);

      if (freshErr) throw new Error('Could not reload suggestion: ' + freshErr.message);

      const fresh = (freshRows && freshRows[0]) ? freshRows[0] : null;

      // ── Guard: EF must have saved a row ───────────────────────────────────
      if (!fresh) {
        throw new Error('Recalculation completed, but no saved suggestion was found for this prep.');
      }

      // ── Update in-memory row ──────────────────────────────────────────────
      const updated = {
        suggestion_date: fresh?.suggestion_date || null,
        generated_at:    fresh?.generated_at    || null,
        status:          fresh?.status          || null,
        confidence:      fresh?.confidence      || null,
        planned_output:  fresh?.planned_output  ?? null,
        output_unit:     fresh?.output_unit     || null,
        net_requirement: fresh?.net_requirement ?? null,
        demand_source:   fresh?.demand_source   || null,
        production_constraint_quality: fresh?.production_constraint_quality || null,
        _status:         fresh?.status          || '__no_suggestion__',
      };
      // Patch the live detail reference
      Object.assign(r, updated);
      // Patch the list row so Back shows the refreshed status
      const listIdx = _pcRows.findIndex(row => row.id === r.id);
      if (listIdx >= 0) Object.assign(_pcRows[listIdx], updated);

      // ── Build before/after summary ────────────────────────────────────────
      const afterStatus = fresh?.status
        ? (STATUS_META[fresh.status]?.label || fresh.status)
        : 'No suggestion';
      const afterOutput = fresh?.planned_output != null
        ? fmtQty(fresh.planned_output, fresh.output_unit || r.unit)
        : '—';
      const afterTime = fresh?.generated_at ? fmtDateCDT(fresh.generated_at) : '—';

      const unchanged = (beforeStatus === afterStatus && beforeOutput === afterOutput);
      const summaryHtml = unchanged
        ? '<span style="color:#16a34a;">✓ Recalculated — result unchanged: '
            + esc(afterStatus) + ' · ' + esc(afterOutput) + '</span>'
        : '<span style="color:#16a34a;">✓ Updated</span> · '
            + 'Before: <b>' + esc(beforeStatus) + ' · ' + esc(beforeOutput) + '</b>'
            + ' → Now: <b>' + esc(afterStatus) + ' · ' + esc(afterOutput) + '</b>'
            + ' <span style="color:#94a3b8;">· ' + esc(afterTime) + '</span>';

      // ── Re-render the full detail with fresh suggestion ───────────────────
      const detailBody = document.getElementById('pcDetailBody');
      if (detailBody && detailBody._pcCache) {
        const c = detailBody._pcCache;
        renderDetail(r, c.count, c.prod, c.ded3, fresh, c.recipe, c.bomRows);
        // Restore result banner after re-render (renderDetail replaces innerHTML)
        const newErrEl = document.getElementById('pcRecalcResult');
        if (newErrEl) {
          newErrEl.style.display = 'block';
          newErrEl.innerHTML = summaryHtml;
        }
      } else {
        // Fallback: update banner only
        const el = document.getElementById('pcRecalcResult');
        if (el) { el.style.display = 'block'; el.innerHTML = summaryHtml; }
      }

    } catch (err) {
      const el = document.getElementById('pcRecalcResult');
      if (el) {
        el.style.display = 'block';
        el.innerHTML = '<span style="color:#dc2626;">⚠ ' + esc(err.message) + '</span>';
      }
    } finally {
      _pcRecalcInFlight = false;
      const b = document.getElementById('pcRecalcBtn');
      if (b) {
        b.disabled = false;
        b.textContent = 'Recalculate';
        b.style.opacity = '1';
        b.style.cursor = 'pointer';
      }
    }
  };

  // ── Back handler ──────────────────────────────────────────────────────────
  window._pcBack = function () {
    showList();
  };

  // ── Global callbacks ──────────────────────────────────────────────────────
  window._pcSetFilter = function (status) {
    _pcFilterStatus = status;
    pcRender();
  };

  window._pcSearch = function (val) {
    _pcSearch = val;
    _pcFilterStatus = '';
    pcRender();
  };

  // ── Main entry point ──────────────────────────────────────────────────────
  window.openPrepControl = async function () {
    hideAdminMenu();

    document.getElementById('pcOverlay')?.remove();
    document.getElementById('pcModal')?.remove();

    // Reset state
    _pcRows         = [];
    _pcSearch       = '';
    _pcFilterStatus = '';
    _pcView         = 'list';
    _pcDetailRow    = null;
    _pcListScroll   = 0;

    // ── Overlay ───────────────────────────────────────────────────────────
    const overlay = document.createElement('div');
    overlay.id = 'pcOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:340;background:rgba(8,18,40,0.55);backdrop-filter:blur(2px);';
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        overlay.remove();
        document.getElementById('pcModal')?.remove();
      }
    });
    document.body.appendChild(overlay);

    // ── Modal ─────────────────────────────────────────────────────────────
    const modal = document.createElement('div');
    modal.id = 'pcModal';
    const isMobile = () => window.innerWidth <= 640;
    function applySize() {
      if (isMobile()) {
        modal.style.cssText = 'position:fixed;inset:0;z-index:341;background:#f8faff;display:flex;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
      } else {
        modal.style.cssText = 'position:fixed;inset:12px;z-index:341;background:#f8faff;border-radius:20px;display:flex;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 24px 80px rgba(8,18,40,0.4);';
      }
    }
    applySize();
    window.addEventListener('resize', applySize);

    // The modal wraps a fixed header plus a switcher between list and detail.
    // pcListWrap holds all list-specific panels. pcDetailWrap is appended when needed.
    modal.innerHTML = `
      <!-- Persistent header -->
      <div style="flex-shrink:0;padding:14px 16px 10px;background:white;border-bottom:1px solid #e2e8f0;
        display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <div>
          <div style="font-size:17px;font-weight:800;color:#1e3a5f;letter-spacing:-0.3px;">🍳 Prep Control</div>
          <div id="pcSummary" style="font-size:11px;color:#94a3b8;margin-top:1px;">Loading…</div>
        </div>
        <button onclick="document.getElementById('pcOverlay')?.remove();document.getElementById('pcModal')?.remove();"
          style="width:32px;height:32px;background:#f1f5f9;border:none;border-radius:8px;
            color:#64748b;font-size:18px;cursor:pointer;display:flex;align-items:center;
            justify-content:center;flex-shrink:0;-webkit-tap-highlight-color:transparent;">✕</button>
      </div>

      <!-- List panels (hidden when detail is open) -->
      <div id="pcListWrap" style="display:contents;">
        <div style="flex-shrink:0;padding:10px 14px 8px;background:white;border-bottom:1px solid #f1f5f9;">
          <input id="pcSearchInput" type="search" placeholder="Search prep…"
            oninput="window._pcSearch(this.value)"
            style="width:100%;padding:9px 13px;border:1.5px solid #e2e8f0;border-radius:12px;
              font-size:14px;font-family:inherit;background:#f8fafc;outline:none;
              box-sizing:border-box;color:#0f172a;">
        </div>
        <div id="pcChips" style="flex-shrink:0;display:flex;gap:6px;overflow-x:auto;padding:8px 14px;
          background:white;border-bottom:1px solid #f1f5f9;-webkit-overflow-scrolling:touch;scrollbar-width:none;">
          <span style="color:#94a3b8;font-size:12px;padding:5px 0;">Loading…</span>
        </div>
        <div id="pcFilterCount" style="flex-shrink:0;font-size:11px;color:#94a3b8;padding:6px 16px 2px;background:#f8faff;"></div>
        <div id="pcList" style="flex:1;overflow-y:auto;padding:8px 12px 32px;
          -webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:6px;">
          <div style="text-align:center;color:#94a3b8;padding:48px 16px;font-size:14px;">Loading prep tasks…</div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // ── Data loading ──────────────────────────────────────────────────────
    try {
      const { data: tasks, error: tasksErr } = await supa
        .from('prep_tasks')
        .select('id,name,category,unit,current_stock,recipe_id,archived')
        .eq('archived', false)
        .order('name');
      if (tasksErr) throw new Error('prep_tasks: ' + tasksErr.message);

      const { data: latestRow } = await supa
        .from('prep_suggestions_daily')
        .select('suggestion_date')
        .order('suggestion_date', { ascending: false })
        .limit(1)
        .single();
      const latestDate = latestRow?.suggestion_date || null;

      let sugMap = {};
      if (latestDate) {
        const { data: sugs, error: sugsErr } = await supa
          .from('prep_suggestions_daily')
          .select('prep_task_id,suggestion_date,generated_at,status,confidence,planned_output,output_unit,net_requirement,demand_source,production_constraint_quality')
          .eq('suggestion_date', latestDate);
        if (sugsErr) throw new Error('prep_suggestions_daily: ' + sugsErr.message);
        for (const s of (sugs || [])) sugMap[s.prep_task_id] = s;
      }

      _pcRows = (tasks || []).map(t => {
        const sug = sugMap[t.id] || null;
        return {
          id: t.id,
          name: t.name,
          category: t.category,
          unit: t.unit,
          current_stock: t.current_stock,
          recipe_id: t.recipe_id,
          suggestion_date: sug?.suggestion_date || null,
          generated_at: sug?.generated_at || null,
          status: sug?.status || null,
          confidence: sug?.confidence || null,
          planned_output: sug?.planned_output ?? null,
          output_unit: sug?.output_unit || null,
          net_requirement: sug?.net_requirement ?? null,
          demand_source: sug?.demand_source || null,
          production_constraint_quality: sug?.production_constraint_quality || null,
          _status: sug?.status || '__no_suggestion__',
        };
      });

      const summaryEl = document.getElementById('pcSummary');
      if (summaryEl) {
        const withSug = _pcRows.filter(r => r.suggestion_date).length;
        const dateStr = latestDate
          ? new Date(latestDate + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : 'no suggestions yet';
        summaryEl.textContent = _pcRows.length + ' active · ' + withSug + ' with suggestion · ' + dateStr;
      }

      pcRender();

    } catch (err) {
      const listEl = document.getElementById('pcList');
      if (listEl) listEl.innerHTML = `<div style="color:#ef4444;padding:24px 16px;font-size:13px;">Error loading data: ${esc(err.message)}</div>`;
      const summaryEl = document.getElementById('pcSummary');
      if (summaryEl) summaryEl.textContent = 'Error';
    }
  };


  // ── SET COUNT FUNCTIONS ───────────────────────────────────────────────────
  window._pcSetCount = function () {
    const form = document.getElementById('pcCountForm');
    const btn  = document.getElementById('pcSetCountBtn');
    if (!form || !btn) return;
    form.style.display = 'block';
    btn.style.display  = 'none';
    const inp = document.getElementById('pcCountInput');
    if (inp) setTimeout(function () { inp.focus(); inp.select(); }, 100);
  };

  window._pcCancelCount = function () {
    const form = document.getElementById('pcCountForm');
    const btn  = document.getElementById('pcSetCountBtn');
    if (form) form.style.display = 'none';
    if (btn)  btn.style.display  = '';
  };

  window._pcCountValidate = function () {
    const inp  = document.getElementById('pcCountInput');
    const save = document.getElementById('pcCountSaveBtn');
    const hint = document.getElementById('pcCountHint');
    if (!inp || !save) return;
    const raw = inp.value.trim();
    const val = parseFloat(raw);
    const valid = raw !== '' && !isNaN(val) && val >= 0;
    save.disabled         = !valid;
    save.style.background = valid ? '#1e40af' : '#94a3b8';
    save.style.cursor     = valid ? 'pointer'  : 'not-allowed';
    if (hint) hint.textContent = (!valid && raw !== '') ? 'Enter 0 or a positive number.' : '';
  };

  window._pcSaveCount = async function () {
    const r = _pcDetailRow;
    if (!r) return;

    const inp     = document.getElementById('pcCountInput');
    const saveBtn = document.getElementById('pcCountSaveBtn');
    const resultEl= document.getElementById('pcCountResult');
    if (!inp || !saveBtn) return;

    const raw = inp.value.trim();
    const val = parseFloat(raw);
    if (isNaN(val) || val < 0) return;           // guard: invalid
    if (saveBtn.dataset.saving === '1') return;  // guard: double-submit

    const brigadeToken = sessionStorage.getItem('brigade_token');
    if (!brigadeToken) {
      if (resultEl) resultEl.innerHTML = '<span style="color:#dc2626;">Session expired — log in again.</span>';
      return;
    }

    const unit = r.unit || 'g';

    // Client key: tied to (prep_task_id, qty) for idempotency
    if (!inp.dataset.clientKey || inp.dataset.clientKeyQty !== raw) {
      inp.dataset.clientKey    = crypto.randomUUID();
      inp.dataset.clientKeyQty = raw;
    }
    const clientKey = inp.dataset.clientKey;

    // In-flight state
    saveBtn.dataset.saving  = '1';
    saveBtn.disabled        = true;
    saveBtn.style.background= '#94a3b8';
    saveBtn.style.cursor    = 'not-allowed';
    saveBtn.textContent     = 'Saving…';
    if (resultEl) resultEl.innerHTML = '';

    let resp, efData;
    try {
      resp = await fetch(
        SUPABASE_URL + '/functions/v1/record-prep-stock-count',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + brigadeToken,
          },
          body: JSON.stringify({
            prep_task_id: r.id,
            qty:          val,
            unit:         unit,
            client_key:   clientKey,
          }),
        }
      );
    } catch (_netErr) {
      // Network error — preserve value and client_key for retry
      saveBtn.dataset.saving  = '';
      saveBtn.disabled        = false;
      saveBtn.style.background= '#1e40af';
      saveBtn.style.cursor    = 'pointer';
      saveBtn.textContent     = 'Save Count';
      if (resultEl) resultEl.innerHTML = '<span style="color:#dc2626;">Network error — try again.</span>';
      return;
    }

    try { efData = await resp.json(); } catch (_) { efData = null; }

    if (!efData || !efData.ok) {
      // EF error — preserve value and client_key for retry
      saveBtn.dataset.saving  = '';
      saveBtn.disabled        = false;
      saveBtn.style.background= '#1e40af';
      saveBtn.style.cursor    = 'pointer';
      saveBtn.textContent     = 'Save Count';
      const errMsg = efData && efData.error ? efData.error : ('HTTP ' + (resp ? resp.status : '?'));
      if (resultEl) resultEl.innerHTML = '<span style="color:#dc2626;">Could not save: ' + esc(errMsg) + '</span>';
      return;
    }

    // ── SUCCESS ───────────────────────────────────────────────────────────
    // Clear client_key — next distinct save starts fresh
    delete inp.dataset.clientKey;
    delete inp.dataset.clientKeyQty;

    // Patch in-memory row from server-confirmed stock
    const newStock = efData.new_stock;
    if (newStock !== undefined && newStock !== null) {
      r.current_stock = newStock;
      const listRow = _pcRows.find(function (row) { return row.id === r.id; });
      if (listRow) listRow.current_stock = newStock;
    }

    if (resultEl) resultEl.innerHTML = '<span style="color:#059669;font-weight:600;">✓ Count saved</span>';

    // Reload the detail panel with fresh lazy data after a short pause
    setTimeout(async function () {
      try {
        const [countRes, prodRes, ded3Res, sugFullRes, recipeRes] = await Promise.all([
          supa.from('prep_stock_counts')
            .select('counted_qty,unit,qty_native,counted_by,counted_at,reconcile_status,expires_at,source')
            .eq('prep_task_id', r.id)
            .order('counted_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supa.from('prep_log')
            .select('created_at,user_name,qty,unit,duration_minutes')
            .eq('prep_task_id', r.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supa.from('stock_deductions')
            .select('business_date,quantity,unit,source,pos_item_name,portions_sold')
            .eq('prep_task_id', r.id)
            .order('business_date', { ascending: false })
            .limit(3),
          r.suggestion_date
            ? supa.from('prep_suggestions_daily')
                .select('suggestion_date,generated_at,status,confidence,planned_output,output_unit,net_requirement,demand_source,forecast_path,stock_source,minimum_increment,production_constraint_quality,debug_json')
                .eq('prep_task_id', r.id)
                .eq('suggestion_date', r.suggestion_date)
                .maybeSingle()
            : Promise.resolve({ data: null }),
          r.recipe_id
            ? supa.from('recipes')
                .select('id,title,pos_name,base_weight_g,base_servings')
                .eq('id', r.recipe_id)
                .maybeSingle()
            : Promise.resolve({ data: null }),
        ]);

        const body2 = document.getElementById('pcDetailBody');
        const bomRows2 = (body2 && body2._pcCache) ? (body2._pcCache.bomRows || []) : [];

        renderDetail(
          r,
          countRes.data  || null,
          prodRes.data   || null,
          ded3Res.data   || [],
          sugFullRes.data || null,
          recipeRes.data || null,
          bomRows2
        );

        // Show success notice after re-render
        const res2 = document.getElementById('pcCountResult');
        if (res2) {
          res2.style.display = 'block';
          res2.innerHTML = '<span style="color:#059669;font-weight:600;">✓ Count saved — detail updated.</span>';
        }
        const form2 = document.getElementById('pcCountForm');
        if (form2) form2.style.display = 'none';

      } catch (_reloadErr) {
        const res2 = document.getElementById('pcCountResult');
        if (res2) res2.innerHTML = '<span style="color:#059669;">✓ Count saved.</span>'
          + ' <span style="color:#94a3b8;">Refresh to see updated values.</span>';
      }
    }, 600);
  };
  // ── END SET COUNT FUNCTIONS ────────────────────────────────────────────────

})();
