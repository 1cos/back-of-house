// ══════════════════════════════════════════════════════════════
// PRODUCTION COVERAGE DASHBOARD — js/admin-prod-coverage.js
// Read-only Admin panel. No writes. No fixes. Pure visibility.
// ══════════════════════════════════════════════════════════════

window.openProductionCoverage = async function () {
  const sb = window.supa;
  if (!sb) return;

  document.getElementById('pdcOverlay')?.remove();
  document.getElementById('pdcModal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'pdcOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:350;background:rgba(8,18,40,0.65);backdrop-filter:blur(2px);';
  overlay.onclick = e => { if (e.target === overlay) closePDC(); };
  document.body.appendChild(overlay);

  const modal = document.createElement('div');
  modal.id = 'pdcModal';
  const isMob = () => window.innerWidth <= 768;
  function applySize() {
    if (isMob()) { modal.style.inset='0'; modal.style.borderRadius='0'; }
    else { modal.style.inset='10px'; modal.style.borderRadius='18px'; }
  }
  modal.style.cssText = [
    'position:fixed;z-index:351;background:#0f172a;',
    'display:flex;flex-direction:column;overflow:hidden;',
    'box-shadow:0 32px 80px rgba(0,0,0,0.7);',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
  ].join('');
  applySize();
  window.addEventListener('resize', applySize);

  modal.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:14px 18px 12px;background:#0f172a;border-bottom:1px solid #1e293b;flex-shrink:0;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:18px;">📡</span>
        <div>
          <div style="font-size:16px;font-weight:700;color:#f1f5f9;letter-spacing:-.3px;">Production Coverage</div>
          <div id="pdcSubtitle" style="font-size:11px;color:#64748b;">Loading…</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <select id="pdcPeriod" onchange="pdcChangePeriod()"
          style="padding:5px 8px;background:#1e293b;border:1px solid #334155;border-radius:8px;
                 color:#94a3b8;font-size:12px;font-family:inherit;cursor:pointer;">
          <option value="28">Last 28 days</option>
          <option value="7">Last 7 days</option>
          <option value="week">Last week</option>
          <option value="custom">Custom…</option>
        </select>
        <div id="pdcCustomRange" style="display:none;display:flex;gap:4px;align-items:center;">
          <input type="date" id="pdcStart" style="padding:4px 6px;background:#1e293b;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:11px;">
          <span style="color:#475569;font-size:11px;">→</span>
          <input type="date" id="pdcEnd" style="padding:4px 6px;background:#1e293b;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:11px;">
          <button onclick="pdcRun()" style="padding:4px 10px;background:#1e40af;border:none;border-radius:6px;color:white;font-size:11px;font-weight:700;cursor:pointer;">Run</button>
        </div>
        <button onclick="pdcRun()" id="pdcRefreshBtn"
          style="padding:6px 12px;background:#1e293b;border:1px solid #334155;border-radius:8px;
                 color:#94a3b8;font-size:12px;font-weight:600;cursor:pointer;">↺</button>
        <button onclick="closePDC()"
          style="width:30px;height:30px;background:#1e293b;border:none;border-radius:8px;
                 color:#64748b;font-size:17px;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
      </div>
    </div>

    <!-- TAB BAR -->
    <div style="display:flex;gap:2px;padding:10px 16px 0;background:#0f172a;flex-shrink:0;overflow-x:auto;-webkit-overflow-scrolling:touch;">
      <button id="pdcT0" onclick="pdcTab('summary')" class="pdc-tab pdc-tab-active">📊 Summary</button>
      <button id="pdcT1" onclick="pdcTab('issues')" class="pdc-tab">⚠️ Issues <span id="pdcIssueCount" style="margin-left:3px;"></span></button>
      <button id="pdcT2" onclick="pdcTab('pos')" class="pdc-tab">🍽️ POS Coverage</button>
      <button id="pdcT3" onclick="pdcTab('prep')" class="pdc-tab">📋 Prep Integrity</button>
      <button id="pdcT4" onclick="pdcTab('modifiers')" class="pdc-tab">🔀 Modifiers</button>
      <button id="pdcT5" onclick="pdcTab('alias')" class="pdc-tab">🪞 Aliases</button>
    </div>

    <!-- BODY -->
    <div style="display:flex;flex:1;overflow:hidden;">
      <div id="pdcBody" style="flex:1;overflow-y:auto;padding:14px 16px 32px;-webkit-overflow-scrolling:touch;">
        <div style="color:#64748b;text-align:center;padding:40px;">Loading data…</div>
      </div>
      <!-- DETAIL DRAWER (desktop) -->
      <div id="pdcDrawer"
        style="width:400px;flex-shrink:0;background:#0b1628;border-left:1px solid #1e293b;
               overflow-y:auto;-webkit-overflow-scrolling:touch;display:none;padding:16px;"></div>
    </div>`;

  document.body.appendChild(modal);

  if (!document.getElementById('pdcStyles')) {
    const s = document.createElement('style');
    s.id = 'pdcStyles';
    s.textContent = `
      .pdc-tab {
        padding:8px 14px;border-radius:8px 8px 0 0;border:none;
        background:#1e293b;color:#64748b;font-size:12px;font-weight:600;
        cursor:pointer;font-family:inherit;white-space:nowrap;
        transition:background .15s,color .15s;
      }
      .pdc-tab-active { background:#1e3a8a;color:#bfdbfe; }
      .pdc-pill {
        display:inline-block;padding:2px 7px;border-radius:20px;
        font-size:10px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;
      }
      .pdc-p0  { background:#7f1d1d;color:#fca5a5; }
      .pdc-p1  { background:#78350f;color:#fde68a; }
      .pdc-p2  { background:#1e3a5f;color:#93c5fd; }
      .pdc-row {
        display:flex;gap:8px;align-items:flex-start;
        padding:10px 12px;border-radius:10px;margin-bottom:5px;
        background:#1e293b;border:1px solid #334155;
        cursor:pointer;transition:background .12s;
        font-size:12px;color:#cbd5e1;
      }
      .pdc-row:hover { background:#263548; }
      .pdc-row.pdc-selected { background:#1e3a5f;border-color:#3b82f6; }
      .pdc-kv { display:flex;justify-content:space-between;gap:8px;margin-bottom:6px;font-size:12px; }
      .pdc-kv-k { color:#64748b;flex-shrink:0;min-width:120px; }
      .pdc-kv-v { color:#e2e8f0;text-align:right;word-break:break-all; }
      .pdc-section { margin-top:14px;margin-bottom:6px;font-size:10px;font-weight:700;
                     color:#475569;letter-spacing:.8px;text-transform:uppercase; }
      .pdc-card { background:#1e293b;border:1px solid #334155;border-radius:12px;
                  padding:14px 16px;margin-bottom:10px; }
      .pdc-stat-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-bottom:14px; }
      .pdc-stat { background:#1e293b;border:1px solid #334155;border-radius:10px;padding:12px 14px; }
      .pdc-stat-num { font-size:22px;font-weight:800;color:#f1f5f9; }
      .pdc-stat-lbl { font-size:11px;color:#64748b;margin-top:2px; }
      .pdc-filter-bar { display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px; }
      .pdc-fbtn {
        padding:4px 10px;border-radius:16px;border:1px solid #334155;
        background:#1e293b;color:#94a3b8;font-size:11px;font-weight:600;
        cursor:pointer;font-family:inherit;
      }
      .pdc-fbtn.active { background:#1e3a8a;border-color:#3b82f6;color:#bfdbfe; }
    `;
    document.head.appendChild(s);
  }

  // State
  window._pdcState = {
    issues: [],
    tab: 'summary',
    filterSev: 'all',
    filterType: 'all',
    dateStart: null,
    dateEnd: null,
    selectedIssueId: null,
  };

  await pdcRun();
};

// ── Utilities ─────────────────────────────────────────────────
function pdcEsc(s) {
  return (s||'').toString()
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function pdcSevPill(sev) {
  const cls = sev==='P0'?'pdc-p0':sev==='P1'?'pdc-p1':'pdc-p2';
  return `<span class="pdc-pill ${cls}">${pdcEsc(sev)}</span>`;
}
function pdcIssuePill(t) {
  const labels = {
    unmatched_pos:'Unmatched POS', ambiguous_alias:'Alias Collision',
    mapped_zero_deduction:'Zero Deductions', orphan_prep_task:'Orphan Prep',
    duplicate_source:'Duplicate Demand', ingredient_only_demand:'Ingredient-Only',
    unit_mismatch:'Unit Mismatch', no_demand_path:'No Demand Path',
  };
  return `<span style="font-size:11px;color:#94a3b8;">${pdcEsc(labels[t]||t)}</span>`;
}
function pdcStatusBadge(s) {
  const map = {
    unmatched:'#ef4444', ambiguous:'#f59e0b', zero_deduction:'#f59e0b',
    orphan_no_recipe:'#f59e0b', duplicate_sources:'#f59e0b', ingredient_only:'#64748b',
    unit_mismatch:'#f59e0b', no_demand:'#f59e0b', covered_once:'#22c55e',
  };
  const col = map[s]||'#64748b';
  return `<span style="color:${col};font-size:11px;font-weight:600;">${pdcEsc(s)}</span>`;
}
function pdcN(n) {
  if (n===null||n===undefined) return '—';
  const v = parseFloat(n); if (isNaN(v)) return '—';
  return v%1===0 ? String(Math.round(v)) : v.toFixed(1);
}

// ── Date helpers ───────────────────────────────────────────────
function pdcGetDates() {
  const sel = document.getElementById('pdcPeriod')?.value || '28';
  const now = new Date(); now.setHours(0,0,0,0);
  const yest = new Date(now); yest.setDate(yest.getDate()-1);
  const fmt = d => d.toISOString().slice(0,10);
  if (sel === 'custom') {
    return {
      start: document.getElementById('pdcStart')?.value || fmt(new Date(now.getTime()-28*864e5)),
      end:   document.getElementById('pdcEnd')?.value   || fmt(yest),
    };
  }
  if (sel === 'week') {
    const mon = new Date(now); mon.setDate(mon.getDate() - mon.getDay() - 6);
    const sun = new Date(mon); sun.setDate(sun.getDate()+6);
    return { start: fmt(mon), end: fmt(sun < yest ? sun : yest) };
  }
  const days = parseInt(sel)||28;
  return { start: fmt(new Date(now.getTime()-days*864e5)), end: fmt(yest) };
}

window.pdcChangePeriod = function() {
  const sel = document.getElementById('pdcPeriod')?.value;
  const cr = document.getElementById('pdcCustomRange');
  if (cr) cr.style.display = sel==='custom' ? 'flex' : 'none';
  if (sel !== 'custom') pdcRun();
};

// ── Load data ─────────────────────────────────────────────────
window.pdcRun = async function() {
  const sb = window.supa; if (!sb) return;
  const body = document.getElementById('pdcBody');
  if (body) body.innerHTML = '<div style="color:#64748b;text-align:center;padding:40px;font-size:13px;">⏳ Running coverage analysis…</div>';
  const sub = document.getElementById('pdcSubtitle');
  if (sub) sub.textContent = 'Loading…';

  const { start, end } = pdcGetDates();
  window._pdcState.dateStart = start; window._pdcState.dateEnd = end;

  try {
    const t0 = Date.now();
    const { data, error } = await sb.rpc('pdc_get_issues', { p_start: start, p_end: end });
    if (error) throw error;
    const ms = Date.now() - t0;

    window._pdcState.issues = data || [];
    const cnt = document.getElementById('pdcIssueCount');
    if (cnt) cnt.textContent = `(${window._pdcState.issues.length})`;
    if (sub) sub.textContent = `${start} → ${end} · ${window._pdcState.issues.length} issues · ${ms}ms`;

    pdcRenderCurrentTab();
  } catch (err) {
    if (body) body.innerHTML = `<div style="color:#ef4444;padding:20px;font-size:13px;">Error: ${pdcEsc(err.message)}</div>`;
  }
};

// ── Tab switching ──────────────────────────────────────────────
window.pdcTab = function(name) {
  window._pdcState.tab = name;
  window._pdcState.selectedIssueId = null;
  const drawer = document.getElementById('pdcDrawer');
  if (drawer) drawer.style.display = 'none';
  ['summary','issues','pos','prep','modifiers','alias'].forEach((t,i) => {
    const btn = document.getElementById('pdcT'+i);
    if (btn) btn.classList.toggle('pdc-tab-active', t===name);
  });
  pdcRenderCurrentTab();
};

function pdcRenderCurrentTab() {
  const t = window._pdcState.tab;
  if      (t==='summary')   pdcRenderSummary();
  else if (t==='issues')    pdcRenderIssues();
  else if (t==='pos')       pdcRenderPOS();
  else if (t==='prep')      pdcRenderPrep();
  else if (t==='modifiers') pdcRenderModifiers();
  else if (t==='alias')     pdcRenderAlias();
}

// ── SUMMARY TAB ───────────────────────────────────────────────
function pdcRenderSummary() {
  const issues = window._pdcState.issues;
  const body = document.getElementById('pdcBody'); if (!body) return;

  const p0 = issues.filter(i=>i.severity==='P0').length;
  const p1 = issues.filter(i=>i.severity==='P1').length;
  const p2 = issues.filter(i=>i.severity==='P2').length;

  const byType = {};
  issues.forEach(i => { byType[i.issue_type] = (byType[i.issue_type]||0)+1; });

  const unmatched   = issues.filter(i=>i.issue_type==='unmatched_pos');
  const totUnmatchedSold = unmatched.reduce((s,i)=>s+parseFloat(i.qty_sold||0),0);

  const dupNames = [...new Set(issues.filter(i=>i.issue_type==='duplicate_source').map(i=>i.prep_task_name))];
  const orphNames = [...new Set(issues.filter(i=>i.issue_type==='orphan_prep_task').map(i=>i.prep_task_name))];
  const noDemand = [...new Set(issues.filter(i=>i.issue_type==='no_demand_path').map(i=>i.prep_task_name))];

  body.innerHTML = `
    <div class="pdc-stat-grid">
      <div class="pdc-stat" style="border-color:#7f1d1d;">
        <div class="pdc-stat-num" style="color:#ef4444;">${p0}</div>
        <div class="pdc-stat-lbl">P0 Critical</div>
      </div>
      <div class="pdc-stat" style="border-color:#78350f;">
        <div class="pdc-stat-num" style="color:#f59e0b;">${p1}</div>
        <div class="pdc-stat-lbl">P1 High</div>
      </div>
      <div class="pdc-stat" style="border-color:#1e3a5f;">
        <div class="pdc-stat-num" style="color:#60a5fa;">${p2}</div>
        <div class="pdc-stat-lbl">P2 Medium</div>
      </div>
      <div class="pdc-stat">
        <div class="pdc-stat-num">${p0+p1+p2}</div>
        <div class="pdc-stat-lbl">Total Issues</div>
      </div>
      <div class="pdc-stat">
        <div class="pdc-stat-num" style="color:#ef4444;">${unmatched.length}</div>
        <div class="pdc-stat-lbl">Unmatched POS items</div>
      </div>
      <div class="pdc-stat">
        <div class="pdc-stat-num" style="color:#f59e0b;">${Math.round(totUnmatchedSold)}</div>
        <div class="pdc-stat-lbl">Portions sold — no coverage</div>
      </div>
    </div>

    <div class="pdc-section">Issue breakdown</div>
    ${Object.entries(byType).sort((a,b)=>b[1]-a[1]).map(([type,cnt])=>`
      <div style="display:flex;justify-content:space-between;align-items:center;
                  padding:8px 12px;background:#1e293b;border-radius:8px;margin-bottom:4px;">
        <div style="display:flex;align-items:center;gap:8px;">
          ${pdcSevPill(issues.find(i=>i.issue_type===type)?.severity||'P2')}
          <span style="font-size:12px;color:#cbd5e1;">${pdcEsc(type.replace(/_/g,' '))}</span>
        </div>
        <span style="font-size:14px;font-weight:700;color:#f1f5f9;">${cnt}</span>
      </div>`).join('')}

    ${p0 > 0 ? `
    <div class="pdc-section" style="color:#ef4444;margin-top:16px;">🚨 P0 — No coverage at all</div>
    ${unmatched.sort((a,b)=>parseFloat(b.qty_sold)-parseFloat(a.qty_sold)).slice(0,10).map(i=>`
      <div style="padding:8px 12px;background:#1a0a0a;border:1px solid #7f1d1d;border-radius:8px;margin-bottom:4px;
                  display:flex;justify-content:space-between;cursor:pointer;"
           onclick="pdcShowIssueDetail(${JSON.stringify(i).replace(/"/g,'&quot;')})">
        <span style="font-size:12px;color:#fca5a5;">${pdcEsc(i.pos_name||i.prep_task_name||'—')}</span>
        <span style="font-size:12px;color:#64748b;">${pdcN(i.qty_sold)} portions · ${i.affected_dates}d</span>
      </div>`).join('')}` : ''}

    ${dupNames.length > 0 ? `
    <div class="pdc-section" style="color:#f59e0b;margin-top:12px;">⚡ Duplicate demand paths</div>
    ${dupNames.map(n=>`<div style="padding:6px 12px;background:#1e293b;border:1px solid #78350f;border-radius:7px;margin-bottom:3px;font-size:12px;color:#fde68a;">${pdcEsc(n)}</div>`).join('')}` : ''}

    ${orphNames.length > 0 ? `
    <div class="pdc-section" style="margin-top:12px;">👻 Orphan prep tasks (no recipe)</div>
    ${orphNames.map(n=>`<div style="padding:6px 12px;background:#1e293b;border-radius:7px;margin-bottom:3px;font-size:12px;color:#94a3b8;">${pdcEsc(n)}</div>`).join('')}` : ''}

    <div style="margin-top:20px;padding:12px 14px;background:#0f2a1a;border:1px solid #14532d;border-radius:10px;">
      <div style="font-size:11px;color:#4ade80;font-weight:700;margin-bottom:4px;">ℹ️ What this dashboard does NOT do</div>
      <div style="font-size:11px;color:#64748b;line-height:1.6;">
        Read-only v1 — no writes, no fixes, no AI guesses.<br>
        False positives are possible and are labeled explicitly.<br>
        Fix data in Mapping Control Room or directly in the DB.
      </div>
    </div>`;
}

// ── ISSUES TAB ────────────────────────────────────────────────
function pdcRenderIssues() {
  const body = document.getElementById('pdcBody'); if (!body) return;
  const st = window._pdcState;
  let issues = [...st.issues];

  if (st.filterSev !== 'all') issues = issues.filter(i=>i.severity===st.filterSev);
  if (st.filterType !== 'all') issues = issues.filter(i=>i.issue_type===st.filterType);

  // sort: P0 first, then by qty_sold desc
  issues.sort((a,b)=>{
    const sp={'P0':0,'P1':1,'P2':2};
    if (sp[a.severity]!==sp[b.severity]) return sp[a.severity]-sp[b.severity];
    return parseFloat(b.qty_sold||0)-parseFloat(a.qty_sold||0);
  });

  const types = [...new Set(st.issues.map(i=>i.issue_type))];

  body.innerHTML = `
    <div class="pdc-filter-bar">
      <span style="font-size:11px;color:#64748b;align-self:center;">Severity:</span>
      ${['all','P0','P1','P2'].map(s=>`
        <button class="pdc-fbtn ${st.filterSev===s?'active':''}" onclick="pdcFilterSev('${s}')">${s==='all'?'All':s}</button>
      `).join('')}
      <span style="font-size:11px;color:#64748b;align-self:center;margin-left:6px;">Type:</span>
      <button class="pdc-fbtn ${st.filterType==='all'?'active':''}" onclick="pdcFilterType('all')">All</button>
      ${types.map(t=>`<button class="pdc-fbtn ${st.filterType===t?'active':''}" onclick="pdcFilterType('${t}')">${t.replace(/_/g,' ')}</button>`).join('')}
    </div>
    <div style="font-size:11px;color:#475569;margin-bottom:8px;">${issues.length} issues</div>
    ${issues.length===0 ? '<div style="color:#64748b;text-align:center;padding:30px;">No issues match the current filter.</div>' : ''}
    ${issues.map((iss)=>{
      const stableId = (iss.pos_name||'') + '|' + (iss.issue_type||'') + '|' + (iss.prep_task_id||'');
      const name = pdcEsc(iss.pos_name || iss.prep_task_name || '—');
      return `<div class="pdc-row ${st.selectedIssueId===stableId?'pdc-selected':''}"
                   onclick="pdcSelectIssue('${stableId.replace(/'/g,"\\'").replace(/"/g,'&quot;')}')">
        <div style="flex:0 0 50px;">${pdcSevPill(iss.severity)}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</div>
          <div style="margin-top:2px;">${pdcIssuePill(iss.issue_type)}</div>
        </div>
        <div style="flex:0 0 80px;text-align:right;">
          <div style="color:#94a3b8;font-size:11px;">${pdcN(iss.qty_sold)} sold</div>
          <div style="color:#64748b;font-size:10px;">${iss.affected_dates}d</div>
        </div>
      </div>`;
    }).join('')}`;
}

window.pdcFilterSev = function(s) { window._pdcState.filterSev=s; pdcRenderIssues(); };
window.pdcFilterType = function(t) { window._pdcState.filterType=t; pdcRenderIssues(); };
window.pdcSelectIssue = function(stableId) {
  window._pdcState.selectedIssueId = stableId;
  // Look up the real issue from the canonical issues array using the stableId
  const iss = window._pdcState.issues.find(i =>
    ((i.pos_name||'') + '|' + (i.issue_type||'') + '|' + (i.prep_task_id||'')) === stableId
  );
  pdcRenderIssues();
  if (iss) pdcShowIssueDetail(iss);
};

// ── ISSUE DETAIL DRAWER ───────────────────────────────────────
window.pdcShowIssueDetail = function(iss) {
  const drawer = document.getElementById('pdcDrawer'); if (!drawer) return;
  const mob = window.innerWidth <= 768;
  if (!mob) { drawer.style.display = 'block'; }

  const extra = iss.extra || {};
  const typeLabels = {
    unmatched_pos: 'No recipe mapping found for this POS item. All sales go untracked.',
    ambiguous_alias: 'This alias matches multiple recipes. The pipeline picks one arbitrarily — deductions may go to the wrong recipe.',
    mapped_zero_deduction: 'Recipe was matched but no stock deductions were generated. Check BOM completeness and prep_task_id links.',
    orphan_prep_task: 'This prep task has no linked recipe and is not a checklist. It cannot receive POS-driven demand.',
    duplicate_source: 'The same prep task was deducted by multiple pipeline sources on the same day. Risk of double-counting.',
    ingredient_only_demand: 'A BOM ITEM row references an ingredient that matches an active prep task, but the BOM has no prep_task_id. Deductions go to ingredient only, not the prep task.',
    unit_mismatch: 'The prep task unit differs from the unit used in stock deductions. Quantities cannot be compared reliably.',
    no_demand_path: 'This prep task has a linked recipe but received zero stock deductions in the period. Either the recipe was not sold, or the pipeline chain is broken.',
  };

  const repairHints = {
    unmatched_pos: 'Add a pos_name alias to the matching recipe, or add to pos_excluded_items if intentional.',
    ambiguous_alias: 'Remove duplicate alias from one recipe. Keep only one owner per alias.',
    mapped_zero_deduction: 'Check that recipe_bom contains RECIPE rows with prep_task_id, or direct_recipe rule is active.',
    orphan_prep_task: 'Link a recipe to this prep task, or reclassify as checklist if no production tracking is needed.',
    duplicate_source: 'Review pos_modifier_depletion_rules and direct_recipe paths. Remove one deduction source.',
    ingredient_only_demand: 'Set recipe_bom.prep_task_id to the candidate prep task, or reclassify the BOM row as RECIPE.',
    unit_mismatch: 'Align prep_task.unit with the unit used in recipe_bom and stock_deductions.',
    no_demand_path: 'Verify the recipe has pos_name set correctly and that the POS-cleaner matched it in the period.',
  };

  drawer.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:8px;">
        ${pdcSevPill(iss.severity)}
        ${pdcIssuePill(iss.issue_type)}
      </div>
      ${mob ? `<button onclick="document.getElementById('pdcDrawer').style.display='none'" style="background:none;border:none;color:#64748b;font-size:18px;cursor:pointer;">✕</button>` : ''}
    </div>

    <div style="font-size:14px;font-weight:700;color:#f1f5f9;margin-bottom:10px;">
      ${pdcEsc(iss.pos_name||iss.prep_task_name||'—')}
    </div>

    <div class="pdc-card">
      <div class="pdc-section" style="margin-top:0;">Classification</div>
      <div class="pdc-kv"><span class="pdc-kv-k">Coverage status</span>${pdcStatusBadge(iss.coverage_status)}</div>
      <div class="pdc-kv"><span class="pdc-kv-k">Source</span><span class="pdc-kv-v">${pdcEsc(iss.source)}</span></div>
      ${iss.affected_dates>0?`<div class="pdc-kv"><span class="pdc-kv-k">Affected dates</span><span class="pdc-kv-v">${iss.affected_dates}</span></div>`:''}
      ${iss.qty_sold?`<div class="pdc-kv"><span class="pdc-kv-k">Qty sold</span><span class="pdc-kv-v">${pdcN(iss.qty_sold)} ${pdcEsc(iss.unit||'')}</span></div>`:''}
    </div>

    ${iss.recipe_id ? `
    <div class="pdc-card">
      <div class="pdc-section" style="margin-top:0;">Recipe</div>
      <div class="pdc-kv"><span class="pdc-kv-k">Title</span><span class="pdc-kv-v">${pdcEsc(iss.recipe_title||'—')}</span></div>
      <div class="pdc-kv"><span class="pdc-kv-k">ID</span><span class="pdc-kv-v" style="font-size:10px;font-family:monospace;">${pdcEsc(iss.recipe_id)}</span></div>
    </div>` : ''}

    ${iss.prep_task_id ? `
    <div class="pdc-card">
      <div class="pdc-section" style="margin-top:0;">Prep Task</div>
      <div class="pdc-kv"><span class="pdc-kv-k">Name</span><span class="pdc-kv-v">${pdcEsc(iss.prep_task_name||'—')}</span></div>
      <div class="pdc-kv"><span class="pdc-kv-k">ID</span><span class="pdc-kv-v">#${iss.prep_task_id}</span></div>
      <div class="pdc-kv"><span class="pdc-kv-k">Unit</span><span class="pdc-kv-v">${pdcEsc(iss.unit||'—')}</span></div>
    </div>` : ''}

    ${Object.keys(extra).length > 0 ? `
    <div class="pdc-card">
      <div class="pdc-section" style="margin-top:0;">Evidence</div>
      ${Object.entries(extra).map(([k,v])=>`
        <div class="pdc-kv">
          <span class="pdc-kv-k">${pdcEsc(k.replace(/_/g,' '))}</span>
          <span class="pdc-kv-v" style="font-size:10px;">${pdcEsc(Array.isArray(v)?v.join(', '):String(v))}</span>
        </div>`).join('')}
    </div>` : ''}

    <div class="pdc-card" style="border-color:#1e3a5f;background:#0b1e35;">
      <div class="pdc-section" style="margin-top:0;color:#60a5fa;">Why this issue</div>
      <div style="font-size:12px;color:#93c5fd;line-height:1.6;">${pdcEsc(typeLabels[iss.issue_type]||iss.reason||'')}</div>
    </div>

    <div class="pdc-card" style="border-color:#14532d;background:#0a1f12;">
      <div class="pdc-section" style="margin-top:0;color:#4ade80;">Suggested repair</div>
      <div style="font-size:12px;color:#86efac;line-height:1.6;">${pdcEsc(repairHints[iss.issue_type]||'Investigate in Mapping Control Room.')}</div>
      <div style="font-size:10px;color:#475569;margin-top:6px;">No write actions available in v1. Fix in MCR or DB directly.</div>
    </div>`;

  if (mob) {
    drawer.style.cssText = 'display:block;position:fixed;bottom:0;left:0;right:0;z-index:500;' +
      'background:#0b1628;border-radius:20px 20px 0 0;border-top:1px solid #1e293b;' +
      'max-height:80vh;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px 16px 32px;';
  }
};

// ── POS COVERAGE TAB ──────────────────────────────────────────
function pdcRenderPOS() {
  const body = document.getElementById('pdcBody'); if (!body) return;
  const issues = window._pdcState.issues;

  // Build a map of pos_name → issue type / status
  const unmatched = new Set(issues.filter(i=>i.issue_type==='unmatched_pos').map(i=>i.pos_name));
  const ambiguous = new Set(issues.filter(i=>i.issue_type==='ambiguous_alias').map(i=>i.pos_name));
  const zeroDed  = new Set(issues.filter(i=>i.issue_type==='mapped_zero_deduction').map(i=>i.pos_name));

  const allPOS = [...new Map(issues.map(i=>[i.pos_name, i])).values()]
    .filter(i=>i.pos_name)
    .sort((a,b)=>(a.pos_name||'').localeCompare(b.pos_name||''));

  body.innerHTML = `
    <div style="font-size:11px;color:#475569;margin-bottom:10px;">
      ${allPOS.length} distinct POS entries with issues in period.<br>
      <span style="color:#64748b;">Items without issues (covered_once) are not shown — only problem entries appear here.</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 80px 100px 100px;gap:0;margin-bottom:6px;">
      <div style="font-size:10px;font-weight:700;color:#475569;letter-spacing:.6px;text-transform:uppercase;padding:0 8px;">POS Name</div>
      <div style="font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;text-align:right;">Sold</div>
      <div style="font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;text-align:right;">Days</div>
      <div style="font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;text-align:right;">Status</div>
    </div>
    ${allPOS.map(i=>{
      const status = unmatched.has(i.pos_name) ? 'unmatched'
                   : ambiguous.has(i.pos_name) ? 'ambiguous'
                   : zeroDed.has(i.pos_name)   ? 'zero_deduction'
                   : i.coverage_status || '—';
      return `<div style="display:grid;grid-template-columns:1fr 80px 100px 100px;gap:0;
                          padding:8px;border-radius:8px;margin-bottom:3px;background:#1e293b;
                          border:1px solid #334155;cursor:pointer;"
                   onclick="pdcShowIssueDetail(${JSON.stringify(i).replace(/"/g,'&quot;')})">
        <div style="font-size:12px;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${pdcEsc(i.pos_name)}</div>
        <div style="font-size:12px;color:#94a3b8;text-align:right;">${pdcN(i.qty_sold)}</div>
        <div style="font-size:12px;color:#64748b;text-align:right;">${i.affected_dates}</div>
        <div style="text-align:right;">${pdcStatusBadge(status)}</div>
      </div>`;
    }).join('')}`;
}

// ── PREP INTEGRITY TAB ────────────────────────────────────────
function pdcRenderPrep() {
  const body = document.getElementById('pdcBody'); if (!body) return;
  const issues = window._pdcState.issues;

  const prepIssues = issues.filter(i=>i.prep_task_id || i.prep_task_name);
  const byTask = {};
  prepIssues.forEach(i => {
    const key = i.prep_task_id || i.prep_task_name;
    if (!byTask[key]) byTask[key] = { name: i.prep_task_name, id: i.prep_task_id, unit: i.unit, issues: [] };
    byTask[key].issues.push(i);
  });

  body.innerHTML = `
    <div style="font-size:11px;color:#475569;margin-bottom:10px;">
      ${Object.keys(byTask).length} prep tasks with at least one integrity issue.
    </div>
    ${Object.values(byTask).map(task=>{
      const maxSev = task.issues.reduce((s,i)=>(['P0','P1','P2'].indexOf(i.severity)<['P0','P1','P2'].indexOf(s)?i.severity:s), 'P2');
      return `<div class="pdc-card" style="margin-bottom:8px;cursor:pointer;"
                   onclick="pdcShowIssueDetail(${JSON.stringify(task.issues[0]).replace(/"/g,'&quot;')})">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
          <div>
            <div style="font-size:13px;font-weight:700;color:#f1f5f9;">${pdcEsc(task.name||'—')}</div>
            ${task.id?`<div style="font-size:10px;color:#64748b;margin-top:2px;">PT #${task.id} · ${pdcEsc(task.unit||'—')}</div>`:''}
          </div>
          ${pdcSevPill(maxSev)}
        </div>
        ${task.issues.map(i=>`
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
            <span style="font-size:10px;color:#64748b;">→</span>
            ${pdcIssuePill(i.issue_type)}
            <span style="font-size:11px;color:#64748b;">${pdcEsc(i.reason||'')}</span>
          </div>`).join('')}
      </div>`;
    }).join('')}`;
}

// ── MODIFIERS TAB ─────────────────────────────────────────────
function pdcRenderModifiers() {
  const body = document.getElementById('pdcBody'); if (!body) return;
  const issues = window._pdcState.issues;
  const dupMod = issues.filter(i=>i.issue_type==='duplicate_source');

  body.innerHTML = `
    <div style="font-size:11px;color:#475569;margin-bottom:12px;">
      Modifier double-count candidates — prep tasks reached by both direct_recipe and pos_modifier sources on the same day.
    </div>
    ${dupMod.length === 0 ? '<div style="color:#22c55e;font-size:13px;padding:10px;">✅ No modifier double-count candidates in period.</div>' :
      dupMod.map(i=>`
        <div class="pdc-row" onclick="pdcShowIssueDetail(${JSON.stringify(i).replace(/"/g,'&quot;')})">
          <div style="flex:0 0 50px;">${pdcSevPill(i.severity)}</div>
          <div style="flex:1;">
            <div style="font-weight:600;color:#e2e8f0;">${pdcEsc(i.prep_task_name||'—')}</div>
            <div style="font-size:11px;color:#64748b;margin-top:2px;">
              PT #${i.prep_task_id} · ${i.affected_dates} days · ${pdcEsc(i.extra?.sources||'')}
            </div>
          </div>
          <div style="font-size:12px;color:#f59e0b;">${pdcN(i.qty_sold)} total</div>
        </div>`).join('')}

    <div class="pdc-section" style="margin-top:16px;">Active modifier depletion rules</div>
    <div id="pdcModRules" style="color:#64748b;font-size:12px;">Loading rules…</div>`;

  // async load rules
  (async () => {
    try {
      const { data } = await window.supa.from('v_pdc_modifier_rules').select('*');
      const el = document.getElementById('pdcModRules'); if (!el) return;
      if (!data || data.length === 0) { el.textContent = 'No rules found.'; return; }
      el.innerHTML = data.map(r=>`
        <div class="pdc-card" style="margin-bottom:6px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="font-size:12px;font-weight:700;color:#e2e8f0;">${pdcEsc(r.modifier_canonical)}</div>
            <span style="font-size:10px;padding:2px 7px;border-radius:10px;
              background:${r.active?'#14532d':'#1e293b'};color:${r.active?'#4ade80':'#64748b'};">
              ${r.active?'active':'inactive'}
            </span>
          </div>
          <div class="pdc-kv" style="margin-top:6px;">
            <span class="pdc-kv-k">Mode</span><span class="pdc-kv-v">${pdcEsc(r.usage_mode||'—')}</span>
          </div>
          <div class="pdc-kv">
            <span class="pdc-kv-k">Target recipe</span><span class="pdc-kv-v">${pdcEsc(r.linked_recipe_title||'—')}</span>
          </div>
          <div class="pdc-kv">
            <span class="pdc-kv-k">Target prep</span><span class="pdc-kv-v">${pdcEsc(r.linked_prep_task_name||'—')}</span>
          </div>
          <div class="pdc-kv">
            <span class="pdc-kv-k">Confidence</span><span class="pdc-kv-v">${pdcEsc(r.confidence||'—')}</span>
          </div>
        </div>`).join('');
    } catch (e) {
      const el = document.getElementById('pdcModRules');
      if (el) el.textContent = 'Error loading rules: ' + e.message;
    }
  })();
}

// ── ALIAS COLLISIONS TAB ──────────────────────────────────────
function pdcRenderAlias() {
  const body = document.getElementById('pdcBody'); if (!body) return;
  const issues = window._pdcState.issues;
  const aliases = issues.filter(i=>i.issue_type==='ambiguous_alias');

  body.innerHTML = `
    <div style="font-size:11px;color:#475569;margin-bottom:12px;">
      POS aliases that appear in more than one recipe's pos_name field.<br>
      When the pipeline encounters this alias, it cannot resolve to a single recipe.
    </div>
    ${aliases.length === 0 ? '<div style="color:#22c55e;font-size:13px;padding:10px;">✅ No alias collisions detected.</div>' :
      aliases.map(i=>{
        const extra = i.extra || {};
        return `<div class="pdc-card" style="margin-bottom:8px;cursor:pointer;"
                     onclick="pdcShowIssueDetail(${JSON.stringify(i).replace(/"/g,'&quot;')})">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <div style="font-size:13px;font-weight:700;color:#fde68a;">"${pdcEsc(i.pos_name)}"</div>
            ${pdcSevPill(i.severity)}
          </div>
          <div class="pdc-kv">
            <span class="pdc-kv-k">Recipes claiming this alias</span>
            <span class="pdc-kv-v">${extra.recipe_count||'?'}</span>
          </div>
          ${(extra.recipe_titles||[]).map((t,idx)=>`
            <div style="font-size:11px;color:#94a3b8;margin-bottom:2px;margin-left:8px;">
              • ${pdcEsc(t)} <span style="color:#475569;font-size:10px;">(${pdcEsc((extra.recipe_ids||[])[idx]?.slice(0,8)+'…'||'')})</span>
            </div>`).join('')}
          <div class="pdc-kv" style="margin-top:6px;">
            <span class="pdc-kv-k">Sold in period</span><span class="pdc-kv-v">${pdcN(i.qty_sold)} portions · ${i.affected_dates} days</span>
          </div>
        </div>`;
      }).join('')}`;
}

// ── Close ──────────────────────────────────────────────────────
window.closePDC = function() {
  document.getElementById('pdcOverlay')?.remove();
  document.getElementById('pdcModal')?.remove();
  window.removeEventListener('resize', window._pdcResizeHandler);
};
