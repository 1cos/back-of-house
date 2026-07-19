// ── PREP CONTROL — js/admin-prep-control.js ──────────────────────────────────
// Admin tool: inspect all active prep tasks with their latest suggestions.
// V1A: List + Search + Filter. No detail panel, no actions, no EF calls.
// ─────────────────────────────────────────────────────────────────────────────

(function () {

  // ── Status sort order (lower index = more urgent) ─────────────────────────
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

  // ── Status display labels & colours ───────────────────────────────────────
  const STATUS_META = {
    do_first:        { label: 'Do First',      dot: '#ef4444', bg: '#fef2f2', border: '#fecaca', text: '#dc2626' },
    count_first:     { label: 'Count First',   dot: '#f59e0b', bg: '#fffbeb', border: '#fde68a', text: '#d97706' },
    prep_today:      { label: 'Prep Today',    dot: '#f97316', bg: '#fff7ed', border: '#fed7aa', text: '#ea580c' },
    no_demand_path:  { label: 'No Demand',     dot: '#94a3b8', bg: '#f8fafc', border: '#e2e8f0', text: '#64748b' },
    looks_ok:        { label: 'Looks OK',      dot: '#22c55e', bg: '#f0fdf4', border: '#bbf7d0', text: '#16a34a' },
    defer_to_tomorrow:{ label: 'Defer',        dot: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe', text: '#2563eb' },
    out_of_scope:    { label: 'Checklist',     dot: '#cbd5e1', bg: '#f8fafc', border: '#e2e8f0', text: '#94a3b8' },
    __no_suggestion__:{ label: 'No Suggestion',dot: '#cbd5e1', bg: '#f8fafc', border: '#e2e8f0', text: '#94a3b8' },
  };

  const CONF_META = {
    high:   { label: 'High',   color: '#16a34a' },
    medium: { label: 'Med',    color: '#d97706' },
    low:    { label: 'Low',    color: '#94a3b8' },
  };

  // ── Module-level state ────────────────────────────────────────────────────
  let _pcRows        = [];   // joined rows
  let _pcSearch      = '';
  let _pcFilterStatus = '';  // '' = all

  // ── Helpers ───────────────────────────────────────────────────────────────
  function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtStock(val, unit) {
    if (val === null || val === undefined) return '<span style="color:#94a3b8;">—</span>';
    const v = parseFloat(val);
    const u = (unit || '').toLowerCase();
    if (u === 'g') {
      if (v >= 1000) return '<span style="font-weight:600;">' + (v / 1000).toFixed(1).replace(/\.0$/, '') + ' kg</span>';
      return '<span style="font-weight:600;">' + Math.round(v) + ' g</span>';
    }
    return '<span style="font-weight:600;">' + (v % 1 === 0 ? Math.round(v) : v.toFixed(1)) + (unit ? ' ' + esc(unit) : '') + '</span>';
  }

  function fmtOutput(val, unit) {
    if (val === null || val === undefined || val === 0) return '';
    const v = parseFloat(val);
    const u = (unit || '').toLowerCase();
    if (u === 'g') {
      if (v >= 1000) return '→ ' + (v / 1000).toFixed(1).replace(/\.0$/, '') + ' kg';
      return '→ ' + Math.round(v) + ' g';
    }
    return '→ ' + (v % 1 === 0 ? Math.round(v) : v.toFixed(1)) + (unit ? ' ' + unit : '');
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
    if (_pcFilterStatus) {
      rows = rows.filter(r => r._status === _pcFilterStatus);
    }
    if (_pcSearch.trim()) {
      const q = _pcSearch.trim().toLowerCase();
      rows = rows.filter(r => (r.name || '').toLowerCase().includes(q));
    }
    return sortRows(rows);
  }

  // ── Status filter chips ───────────────────────────────────────────────────
  function buildFilterChips(all) {
    // Count per status in the full (unfiltered, searched) dataset
    const counts = {};
    for (const r of all) {
      counts[r._status] = (counts[r._status] || 0) + 1;
    }

    const chips = [{ key: '', label: 'All', count: all.length }];
    for (const key of STATUS_ORDER) {
      if (counts[key]) {
        chips.push({ key, label: STATUS_META[key]?.label || key, count: counts[key] });
      }
    }

    return chips.map(c => {
      const active = _pcFilterStatus === c.key;
      const meta = c.key ? STATUS_META[c.key] : null;
      const dotColor = meta ? meta.dot : '#1e3a5f';
      const activeBg = meta ? meta.bg : '#eff6ff';
      const activeBorder = meta ? meta.border : '#bfdbfe';
      const activeText = meta ? meta.text : '#1e3a5f';
      return `<button
        onclick="window._pcSetFilter('${esc(c.key)}')"
        style="
          flex-shrink:0;padding:5px 11px;border-radius:20px;border:1.5px solid ${active ? activeBorder : '#e2e8f0'};
          background:${active ? activeBg : 'white'};
          color:${active ? activeText : '#64748b'};
          font-size:12px;font-weight:${active ? '700' : '500'};cursor:pointer;
          font-family:inherit;white-space:nowrap;
          display:inline-flex;align-items:center;gap:5px;
          -webkit-tap-highlight-color:transparent;
          transition:all .12s;
        ">
        ${c.key ? `<span style="width:7px;height:7px;border-radius:50%;background:${dotColor};flex-shrink:0;display:inline-block;"></span>` : ''}
        ${esc(c.label)} <span style="opacity:0.65;">${c.count}</span>
      </button>`;
    }).join('');
  }

  // ── Row render ────────────────────────────────────────────────────────────
  function renderRow(r) {
    const meta = STATUS_META[r._status] || STATUS_META.__no_suggestion__;
    const conf = r.confidence ? CONF_META[r.confidence] : null;
    const outputStr = fmtOutput(r.planned_output, r.output_unit);
    const stockStr  = fmtStock(r.current_stock, r.unit);

    // Warning marker: constraint missing/conflicting + not out_of_scope/checklist
    const showWarn = r.production_constraint_quality &&
      (r.production_constraint_quality === 'missing' || r.production_constraint_quality === 'conflicting') &&
      r._status !== 'out_of_scope' && r._status !== '__no_suggestion__' &&
      r._status !== 'looks_ok' && r._status !== 'no_demand_path';

    return `<div style="
      background:${meta.bg};border:1.5px solid ${meta.border};border-radius:12px;
      padding:11px 13px;cursor:pointer;
      display:grid;grid-template-columns:1fr auto;gap:4px 10px;align-items:center;
      -webkit-tap-highlight-color:rgba(0,0,0,0.04);
    ">
      <!-- Left col: name + category -->
      <div style="min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span style="font-size:14px;font-weight:700;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(r.name)}</span>
          ${showWarn ? '<span title="Batch size not configured" style="font-size:12px;color:#f59e0b;">⚠️</span>' : ''}
        </div>
        <div style="font-size:11px;color:#64748b;margin-top:1px;">${esc(r.category || '—')}</div>
      </div>
      <!-- Right col: status pill -->
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0;">
        <span style="
          font-size:11px;font-weight:700;color:${meta.text};
          background:white;border:1px solid ${meta.border};
          padding:2px 8px;border-radius:20px;white-space:nowrap;
        ">${esc(meta.label)}</span>
        ${conf ? `<span style="font-size:10px;color:${conf.color};font-weight:600;">${conf.label}</span>` : ''}
      </div>
      <!-- Bottom row: stock + output -->
      <div style="grid-column:1/3;display:flex;align-items:center;gap:10px;margin-top:2px;flex-wrap:wrap;">
        <span style="font-size:12px;color:#64748b;">Stock: ${stockStr}</span>
        ${outputStr ? `<span style="font-size:12px;color:${meta.text};font-weight:600;">${esc(outputStr)}</span>` : ''}
      </div>
    </div>`;
  }

  // ── Main list render (called on every filter/search change) ───────────────
  function pcRender() {
    const listEl  = document.getElementById('pcList');
    const countEl = document.getElementById('pcFilterCount');
    const chipsEl = document.getElementById('pcChips');
    if (!listEl) return;

    // Rebuild chips using full dataset filtered only by search (not status)
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

  // ── Global callbacks (called from inline onclick) ─────────────────────────
  window._pcSetFilter = function (status) {
    _pcFilterStatus = status;
    pcRender();
  };

  window._pcSearch = function (val) {
    _pcSearch = val;
    _pcFilterStatus = '';   // reset status filter on new search
    pcRender();
  };

  // ── Main entry point ──────────────────────────────────────────────────────
  window.openPrepControl = async function () {
    hideAdminMenu();

    // Remove any existing instance
    document.getElementById('pcOverlay')?.remove();
    document.getElementById('pcModal')?.remove();

    // Reset state
    _pcRows        = [];
    _pcSearch      = '';
    _pcFilterStatus = '';

    // ── Overlay ───────────────────────────────────────────────────────────
    const overlay = document.createElement('div');
    overlay.id = 'pcOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:340;background:rgba(8,18,40,0.55);backdrop-filter:blur(2px);';
    overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); document.getElementById('pcModal')?.remove(); } });
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

    modal.innerHTML = `
      <!-- Header -->
      <div style="flex-shrink:0;padding:14px 16px 10px;background:white;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <div>
          <div style="font-size:17px;font-weight:800;color:#1e3a5f;letter-spacing:-0.3px;">🍳 Prep Control</div>
          <div id="pcSummary" style="font-size:11px;color:#94a3b8;margin-top:1px;">Loading…</div>
        </div>
        <button onclick="document.getElementById('pcOverlay')?.remove();document.getElementById('pcModal')?.remove();"
          style="width:32px;height:32px;background:#f1f5f9;border:none;border-radius:8px;color:#64748b;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-tap-highlight-color:transparent;">✕</button>
      </div>

      <!-- Search -->
      <div style="flex-shrink:0;padding:10px 14px 8px;background:white;border-bottom:1px solid #f1f5f9;">
        <input
          id="pcSearchInput"
          type="search"
          placeholder="Search prep…"
          oninput="window._pcSearch(this.value)"
          style="width:100%;padding:9px 13px;border:1.5px solid #e2e8f0;border-radius:12px;font-size:14px;font-family:inherit;background:#f8fafc;outline:none;box-sizing:border-box;color:#0f172a;"
        >
      </div>

      <!-- Filter chips -->
      <div id="pcChips" style="flex-shrink:0;display:flex;gap:6px;overflow-x:auto;padding:8px 14px;background:white;border-bottom:1px solid #f1f5f9;-webkit-overflow-scrolling:touch;scrollbar-width:none;">
        <span style="color:#94a3b8;font-size:12px;padding:5px 0;">Loading…</span>
      </div>

      <!-- Count label -->
      <div id="pcFilterCount" style="flex-shrink:0;font-size:11px;color:#94a3b8;padding:6px 16px 2px;background:#f8faff;"></div>

      <!-- List -->
      <div id="pcList" style="flex:1;overflow-y:auto;padding:8px 12px 32px;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:6px;">
        <div style="text-align:center;color:#94a3b8;padding:48px 16px;font-size:14px;">Loading prep tasks…</div>
      </div>
    `;

    document.body.appendChild(modal);

    // ── Data loading ──────────────────────────────────────────────────────
    try {
      // 1. Load all non-archived prep_tasks in one query
      const { data: tasks, error: tasksErr } = await supa
        .from('prep_tasks')
        .select('id,name,category,unit,current_stock,recipe_id,archived')
        .eq('archived', false)
        .order('name');

      if (tasksErr) throw new Error('prep_tasks: ' + tasksErr.message);

      // 2. Determine latest suggestion_date in one query
      const { data: latestRow } = await supa
        .from('prep_suggestions_daily')
        .select('suggestion_date')
        .order('suggestion_date', { ascending: false })
        .limit(1)
        .single();

      const latestDate = latestRow?.suggestion_date || null;

      // 3. Load all suggestions for that date in one query
      let sugMap = {};
      if (latestDate) {
        const { data: sugs, error: sugsErr } = await supa
          .from('prep_suggestions_daily')
          .select([
            'prep_task_id',
            'suggestion_date',
            'generated_at',
            'status',
            'confidence',
            'planned_output',
            'output_unit',
            'net_requirement',
            'demand_source',
            'production_constraint_quality',
          ].join(','))
          .eq('suggestion_date', latestDate);

        if (sugsErr) throw new Error('prep_suggestions_daily: ' + sugsErr.message);
        for (const s of (sugs || [])) {
          sugMap[s.prep_task_id] = s;
        }
      }

      // 4. Join in JavaScript
      _pcRows = (tasks || []).map(t => {
        const sug = sugMap[t.id] || null;
        return {
          // prep_task fields
          id: t.id,
          name: t.name,
          category: t.category,
          unit: t.unit,
          current_stock: t.current_stock,
          recipe_id: t.recipe_id,
          // suggestion fields (null if no suggestion)
          suggestion_date: sug?.suggestion_date || null,
          generated_at: sug?.generated_at || null,
          status: sug?.status || null,
          confidence: sug?.confidence || null,
          planned_output: sug?.planned_output ?? null,
          output_unit: sug?.output_unit || null,
          net_requirement: sug?.net_requirement ?? null,
          demand_source: sug?.demand_source || null,
          production_constraint_quality: sug?.production_constraint_quality || null,
          // computed
          _status: sug?.status || '__no_suggestion__',
        };
      });

      // 5. Update summary
      const summaryEl = document.getElementById('pcSummary');
      if (summaryEl) {
        const withSug = _pcRows.filter(r => r.suggestion_date).length;
        const dateStr = latestDate
          ? new Date(latestDate + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : 'no suggestions yet';
        summaryEl.textContent = _pcRows.length + ' active · ' + withSug + ' with suggestion · ' + dateStr;
      }

      // 6. Render
      pcRender();

    } catch (err) {
      const listEl = document.getElementById('pcList');
      if (listEl) {
        listEl.innerHTML = '<div style="color:#ef4444;padding:24px 16px;font-size:13px;">Error loading data: ' + esc(err.message) + '</div>';
      }
      const summaryEl = document.getElementById('pcSummary');
      if (summaryEl) summaryEl.textContent = 'Error';
    }
  };

})();
