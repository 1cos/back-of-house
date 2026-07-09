// ── BOH WORKSPACE ROUTER ──────────────────────────────────────────────────────
// ⚠️  PRODUCTION SAFETY:
//     This module is EXPERIMENTAL. It must remain DISABLED by default in production.
//     Do NOT activate globally without explicit approval from Chef Max.
//     Workspace is a UI refactor laboratory — not a live operational change.
//
//     To enable (dev/testing only):
//       wsActivate()          — sets localStorage flag, reloads
//       ?workspace=1          — URL query flag, session only
//       localStorage.setItem('bohWorkspace','1')
//
//     On normal load with no flag: this file loads but does NOTHING.
//     window.prepOpenRecipe and all live behaviors are untouched.
//
// Architecture:
//   Safari-like navigation — important views open as full workspace pages.
//   Back/forward via history.pushState + popstate.
//   Modals remain for quick actions only.
//
// Phase 1 routes:
//   /prep/:prep_task_id   → Prep Detail page
//
// Versioning: workspace-v001 (Phase 1), workspace-v002 (Phase 2)...
//   Live boh-v### bumps only for hotfixes, not for workspace features.
// ─────────────────────────────────────────────────────────────────────────────

/* ══ STATE ═══════════════════════════════════════════════════════════════════ */

const WS = {
  active:  false,          // workspace overlay is open
  route:   null,           // current route string e.g. '/prep/uuid'
  payload: null,           // extra data passed to the page renderer
  history: [],             // internal nav stack (for Back when no pushState)
};

/* ══ ROUTES REGISTRY ═════════════════════════════════════════════════════════ */

const WS_ROUTES = {};

/**
 * Register a route handler.
 * @param {string}   pattern  e.g. '/prep/:id'
 * @param {Function} renderer  (params, payload) → HTML string
 * @param {Object}   [opts]    { title(params), afterRender(el, params) }
 */
function wsRegisterRoute(pattern, renderer, opts = {}) {
  WS_ROUTES[pattern] = { pattern, renderer, ...opts };
}

/**
 * Match a route string against registered patterns.
 * Returns { handler, params } or null.
 */
function wsMatchRoute(route) {
  for (const pattern of Object.keys(WS_ROUTES)) {
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, '([^/]+)') + '$');
    const m  = route.match(re);
    if (!m) continue;
    const paramNames = [...pattern.matchAll(/:(\w+)/g)].map(x => x[1]);
    const params     = {};
    paramNames.forEach((n, i) => { params[n] = m[i + 1]; });
    return { handler: WS_ROUTES[pattern], params };
  }
  return null;
}

/* ══ OPEN / CLOSE ════════════════════════════════════════════════════════════ */

/**
 * Open a workspace page.
 * @param {string} route    e.g. '/prep/uuid-here'
 * @param {*}      payload  optional extra data (e.g. the task object if already in memory)
 */
window.openWorkspace = function(route, payload = null) {
  WS.active  = true;
  WS.route   = route;
  WS.payload = payload;

  // Push to browser history so Back works
  const hash = '#' + route;
  if (location.hash !== hash) {
    history.pushState({ wsRoute: route }, '', hash);
  }

  try {
    _wsRender();
  } catch (err) {
    console.error('[workspace] render failed', err);
    _wsShowError(err);
  }
};

/**
 * Close the workspace and return to the app.
 * Called by Back button or ESC.
 */
window.closeWorkspace = function() {
  if (!WS.active) return;
  WS.active  = false;
  WS.route   = null;
  WS.payload = null;

  // Pop hash off URL
  const cleanUrl = location.pathname + location.search;
  history.pushState({}, '', cleanUrl);

  const root = document.getElementById('workspace-root');
  if (root) {
    root.classList.add('ws-closing');
    setTimeout(() => {
      root.innerHTML = '';
      root.style.display = 'none';
      root.classList.remove('ws-closing');
    }, 220);
  }
  // Restore body scroll lock that some modals set
  document.body.style.overflow = '';
};

/* ══ RENDER ══════════════════════════════════════════════════════════════════ */

function _wsRender() {
  const root = document.getElementById('workspace-root');
  if (!root) {
    console.warn('[workspace] #workspace-root not found in DOM');
    return;
  }

  const match = wsMatchRoute(WS.route || '');
  if (!match) {
    _wsShowError({ message: 'No route matched: ' + WS.route });
    return;
  }

  const { handler, params } = match;

  // Build page title
  const title = handler.title ? handler.title(params, WS.payload) : 'Detail';

  // Render page HTML
  let pageHTML;
  try {
    pageHTML = handler.renderer(params, WS.payload);
  } catch (err) {
    console.error('[workspace] page renderer threw', err);
    pageHTML = _wsErrorHTML(err);
  }

  // Assemble shell
  root.innerHTML = `
    <div class="ws-shell" id="ws-shell">
      <div class="ws-header" id="ws-header">
        <button class="ws-back-btn" onclick="wsBack()" aria-label="Back">
          <span class="ws-back-icon">‹</span>
        </button>
        <div class="ws-header-title" id="ws-header-title">${_wsEscape(title)}</div>
        <div class="ws-header-actions" id="ws-header-actions"></div>
      </div>
      <div class="ws-page" id="ws-page">
        ${pageHTML}
      </div>
    </div>
  `;

  root.style.display = '';

  // After-render hook
  try {
    if (handler.afterRender) {
      handler.afterRender(root.querySelector('#ws-page'), params, WS.payload);
    }
  } catch (err) {
    console.error('[workspace] afterRender threw', err);
  }

  // Lock body scroll on mobile
  document.body.style.overflow = 'hidden';

  // Scroll to top
  const page = root.querySelector('#ws-page');
  if (page) page.scrollTop = 0;
}

/* ══ NAVIGATION ══════════════════════════════════════════════════════════════ */

/**
 * Navigate back: pop browser history, or close if stack is empty.
 */
window.wsBack = function() {
  if (window.history.length > 1) {
    history.back();
  } else {
    closeWorkspace();
  }
};

// popstate and keydown listeners are registered inside the DOMContentLoaded
// guard above — they only activate when workspace is explicitly enabled.

/* ══ ERROR HELPERS ═══════════════════════════════════════════════════════════ */

function _wsShowError(err) {
  const root = document.getElementById('workspace-root');
  if (!root) return;
  root.innerHTML = `
    <div class="ws-shell">
      <div class="ws-header">
        <button class="ws-back-btn" onclick="wsBack()">‹</button>
        <div class="ws-header-title">Error</div>
        <div></div>
      </div>
      <div class="ws-page" style="padding:24px 16px">
        ${_wsErrorHTML(err)}
      </div>
    </div>`;
  root.style.display = '';
}

function _wsErrorHTML(err) {
  return `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:16px;font-size:13px;color:#991b1b;">
    <div style="font-weight:700;margin-bottom:6px;">⚠️ Workspace render error</div>
    <div style="font-family:monospace;font-size:11px;color:#7f1d1d;">${_wsEscape(err.message || String(err))}</div>
    <button onclick="closeWorkspace()" style="margin-top:12px;padding:6px 14px;background:#dc2626;color:#fff;border:none;border-radius:8px;font-size:12px;cursor:pointer;">← Back</button>
  </div>`;
}

function _wsEscape(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ══ STYLES ══════════════════════════════════════════════════════════════════ */
// Injected only when workspace is enabled — no DOM pollution on live load.
// Called from inside the DOMContentLoaded guard.

function wsInjectStyles() {
  if (document.getElementById('ws-styles')) return;
  const style = document.createElement('style');
  style.id = 'ws-styles';
  style.textContent = `
    /* ── Workspace root ── */
    #workspace-root {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 120; /* above bottom nav (z-10), below modals (z-50+) */
      background: #f1f5f9;
      overscroll-behavior: contain;
    }

    /* ── Shell ── */
    .ws-shell {
      display: flex;
      flex-direction: column;
      height: 100%;
      max-height: 100dvh;
      animation: wsSlideIn 0.22s cubic-bezier(0.34, 1.2, 0.64, 1);
    }
    @keyframes wsSlideIn {
      from { transform: translateX(100%); opacity: 0; }
      to   { transform: translateX(0);   opacity: 1; }
    }
    #workspace-root.ws-closing .ws-shell {
      animation: wsSlideOut 0.20s cubic-bezier(0.4, 0, 1, 1) forwards;
    }
    @keyframes wsSlideOut {
      from { transform: translateX(0);    opacity: 1; }
      to   { transform: translateX(100%); opacity: 0; }
    }

    /* ── Header ── */
    .ws-header {
      flex-shrink: 0;
      height: 52px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 12px 0 4px;
      background: rgba(255,255,255,0.88);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid rgba(30,58,95,0.10);
      box-shadow: 0 1px 4px rgba(30,58,95,0.06);
    }
    .ws-back-btn {
      width: 40px; height: 40px;
      display: flex; align-items: center; justify-content: center;
      border: none; background: none; cursor: pointer;
      border-radius: 10px;
      transition: background 0.12s;
      -webkit-tap-highlight-color: transparent;
    }
    .ws-back-btn:hover { background: rgba(30,58,95,0.06); }
    .ws-back-btn:active { background: rgba(30,58,95,0.12); }
    .ws-back-icon {
      font-size: 28px;
      font-weight: 300;
      color: #2563eb;
      line-height: 1;
      margin-top: -2px;
    }
    .ws-header-title {
      flex: 1;
      font-size: 17px;
      font-weight: 700;
      color: #1e3a5f;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      letter-spacing: -0.02em;
    }
    .ws-header-actions {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-shrink: 0;
    }

    /* ── Page scroll area ── */
    .ws-page {
      flex: 1;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      overscroll-behavior: contain;
      padding: 16px 14px 100px; /* bottom pad clears bottom nav */
    }

    /* ── Prep Detail page ── */
    .wsp-section {
      background: rgba(255,255,255,0.75);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(30,58,95,0.09);
      border-radius: 16px;
      padding: 16px;
      margin-bottom: 12px;
    }
    .wsp-section-title {
      font-size: 11px;
      font-weight: 700;
      color: #7a9cc4;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      margin-bottom: 12px;
    }
    .wsp-name {
      font-size: 22px;
      font-weight: 800;
      color: #1e3a5f;
      line-height: 1.2;
      letter-spacing: -0.025em;
      margin-bottom: 6px;
    }
    .wsp-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }
    .wsp-tag {
      font-size: 11px;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: 999px;
      background: rgba(37,99,235,0.08);
      border: 1px solid rgba(37,99,235,0.18);
      color: #2563eb;
    }
    .wsp-tag.green  { background: rgba(22,163,74,0.08); border-color: rgba(22,163,74,0.2); color: #16a34a; }
    .wsp-tag.yellow { background: rgba(217,119,6,0.08); border-color: rgba(217,119,6,0.2); color: #d97706; }
    .wsp-tag.red    { background: rgba(220,38,38,0.08); border-color: rgba(220,38,38,0.2); color: #dc2626; }
    .wsp-tag.purple { background: rgba(124,58,237,0.08);border-color: rgba(124,58,237,0.2);color: #7c3aed; }
    .wsp-tag.gray   { background: rgba(100,116,139,0.08);border-color:rgba(100,116,139,0.2);color:#475569; }

    .wsp-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid rgba(30,58,95,0.06);
      font-size: 14px;
    }
    .wsp-row:last-child { border-bottom: none; }
    .wsp-row-label { color: #7a9cc4; font-size: 12px; }
    .wsp-row-value { color: #1e3a5f; font-weight: 600; text-align: right; }

    .wsp-action-row {
      display: flex;
      gap: 8px;
      margin-top: 4px;
    }
    .wsp-btn {
      flex: 1;
      padding: 13px 12px;
      border: none;
      border-radius: 14px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.12s;
      -webkit-tap-highlight-color: transparent;
    }
    .wsp-btn:active { transform: scale(0.97); }
    .wsp-btn.primary {
      background: linear-gradient(135deg, #1e40af, #2563eb);
      color: #fff;
      box-shadow: 0 2px 10px rgba(37,99,235,0.3);
    }
    .wsp-btn.primary:hover { box-shadow: 0 4px 16px rgba(37,99,235,0.4); }
    .wsp-btn.success {
      background: linear-gradient(135deg, #059669, #10b981);
      color: #fff;
      box-shadow: 0 2px 10px rgba(5,150,105,0.3);
    }
    .wsp-btn.secondary {
      background: rgba(255,255,255,0.9);
      color: #1e3a5f;
      border: 1px solid rgba(30,58,95,0.15);
    }
    .wsp-btn.danger {
      background: rgba(220,38,38,0.08);
      color: #dc2626;
      border: 1px solid rgba(220,38,38,0.2);
    }

    .wsp-today-log {
      background: rgba(5,150,105,0.06);
      border: 1px solid rgba(5,150,105,0.2);
      border-radius: 12px;
      padding: 10px 12px;
    }
    .wsp-today-log-title {
      font-size: 10px;
      font-weight: 700;
      color: #059669;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 7px;
    }

    .wsp-open-recipe-btn {
      width: 100%;
      padding: 12px 14px;
      background: rgba(37,99,235,0.06);
      border: 1px solid rgba(37,99,235,0.18);
      border-radius: 12px;
      font-size: 13px;
      font-weight: 600;
      color: #2563eb;
      text-align: left;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: background 0.12s;
      -webkit-tap-highlight-color: transparent;
    }
    .wsp-open-recipe-btn:hover { background: rgba(37,99,235,0.10); }

    /* note textarea */
    .wsp-note-area {
      width: 100%;
      padding: 10px 12px;
      font-size: 13px;
      color: #1e3a5f;
      background: rgba(241,245,249,0.8);
      border: 1px solid rgba(30,58,95,0.12);
      border-radius: 10px;
      resize: none;
      outline: none;
      font-family: inherit;
      line-height: 1.5;
      transition: border-color 0.12s;
    }
    .wsp-note-area:focus { border-color: #2563eb; background: #fff; }
  `;
  document.head.appendChild(style);
}

/* ══ PHASE 1: PREP DETAIL PAGE ═══════════════════════════════════════════════ */

wsRegisterRoute('/prep/:id', function renderPrepDetail(params, payload) {
  // Use payload if passed, otherwise look up from global `tasks`
  const task = payload || (typeof tasks !== 'undefined' && tasks[params.id]) || null;

  if (!task) {
    return `<div style="text-align:center;padding:40px 16px;color:#7a9cc4;">
      <div style="font-size:32px;margin-bottom:10px;">📋</div>
      <div style="font-size:15px;font-weight:600;color:#1e3a5f;">Prep task not found</div>
      <div style="font-size:12px;margin-top:4px;">ID: ${_wsEscape(params.id)}</div>
    </div>`;
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const isWip      = !!task.in_progress;
  const hasRecipe  = !!task.recipe_id;
  const unit       = task.unit || '';
  const sugNote    = task.suggested_note || '';
  const hasSug     = sugNote.includes('|');
  let pillColor = 'gray', pillLabel = '', botNote = '';
  if (hasSug) {
    const parts = sugNote.split('|');
    pillColor   = parts[0] || 'gray';
    // Try to get English label from parts[2] (en), fallback to parts[1] (it)
    const userLang = (typeof user !== 'undefined' && user?.lang) || 'it';
    pillLabel   = (userLang === 'en' ? parts[2] : userLang === 'es' ? parts[3] : parts[1]) || parts[1] || '';
    botNote     = parts.slice(4).join('|') || '';
  }

  // Today logs
  const tlogs = (typeof window._todayLogs !== 'undefined')
    ? (window._todayLogs[task.name] || [])
    : [];

  // Stock
  const stockVal = task.current_stock != null ? parseFloat(task.current_stock) : null;

  // Category tag
  const cat = (task.category || '').replace(' Station', '');

  // ── HTML ──────────────────────────────────────────────────────────────────
  const todayLogHTML = tlogs.length ? `
    <div class="wsp-today-log">
      <div class="wsp-today-log-title">✅ Logged today (${tlogs.length})</div>
      ${tlogs.slice(-3).map(l => {
        const qty    = parseFloat(l.qty);
        const qtyStr = Number.isInteger(qty) ? qty : qty.toFixed(1);
        const timeStr = l.created_at
          ? new Date(l.created_at).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',timeZone:'America/Chicago'})
          : '';
        return `<div style="font-size:13px;color:#374151;display:flex;justify-content:space-between;padding:3px 0;">
          <span><b style="color:#1e3a5f">${_wsEscape(l.user_name)}</b> — ${qtyStr} ${_wsEscape(l.unit||unit)}</span>
          <span style="color:#9ca3af;font-size:11px;">${timeStr}</span>
        </div>`;
      }).join('')}
    </div>
  ` : '';

  const botHTML = hasSug ? `
    <div style="margin-top:10px;padding:10px 12px;background:rgba(${pillColor==='red'?'220,38,38':pillColor==='yellow'?'217,119,6':pillColor==='green'?'5,150,105':'100,116,139'},0.07);border-radius:12px;border-left:3px solid ${pillColor==='red'?'#dc2626':pillColor==='yellow'?'#d97706':pillColor==='green'?'#059669':'#94a3b8'};">
      <div style="font-size:11px;font-weight:700;color:${pillColor==='red'?'#dc2626':pillColor==='yellow'?'#d97706':pillColor==='green'?'#059669':'#64748b'};text-transform:uppercase;letter-spacing:0.07em;margin-bottom:4px;">
        🤖 Chef AI · ${_wsEscape(pillLabel)}
      </div>
      ${botNote ? `<div style="font-size:13px;color:#374151;line-height:1.5;">${_wsEscape(botNote)}</div>` : ''}
      ${task.suggested_qty != null ? `<div style="font-size:13px;font-weight:700;color:#1e3a5f;margin-top:4px;">Suggested: ${parseFloat(task.suggested_qty)} ${_wsEscape(unit)}</div>` : ''}
    </div>
  ` : '';

  return `
    <!-- ── Task header ── -->
    <div class="wsp-section">
      <div class="wsp-name">${_wsEscape(task.name)}</div>
      <div class="wsp-meta">
        ${cat ? `<span class="wsp-tag gray">${_wsEscape(cat)}</span>` : ''}
        ${task.prep_type === 'checklist' ? '<span class="wsp-tag purple">Checklist</span>' : ''}
        ${unit ? `<span class="wsp-tag">${_wsEscape(unit)}</span>` : ''}
        ${isWip ? '<span class="wsp-tag" style="background:rgba(37,99,235,0.1);color:#1e40af;border-color:rgba(37,99,235,0.25);">▶ In progress</span>' : ''}
      </div>
      ${botHTML}
    </div>

    <!-- ── Today logs ── -->
    ${tlogs.length ? `<div class="wsp-section" style="padding:12px 14px;">${todayLogHTML}</div>` : ''}

    <!-- ── Details ── -->
    <div class="wsp-section">
      <div class="wsp-section-title">Details</div>
      ${stockVal != null ? `<div class="wsp-row"><span class="wsp-row-label">Current stock</span><span class="wsp-row-value">${stockVal} ${_wsEscape(unit)}</span></div>` : ''}
      ${task.suggested_qty != null ? `<div class="wsp-row"><span class="wsp-row-label">Bot suggestion</span><span class="wsp-row-value">${parseFloat(task.suggested_qty)} ${_wsEscape(unit)}</span></div>` : ''}
      ${task.need_tomorrow ? '<div class="wsp-row"><span class="wsp-row-label">Status</span><span class="wsp-row-value" style="color:#d97706;">⚠️ Needs prep</span></div>' : ''}
      ${task.note ? `<div class="wsp-row" style="display:block;padding:10px 0;"><div class="wsp-row-label" style="margin-bottom:4px;">Note</div><div style="font-size:13px;color:#374151;">${_wsEscape(task.note)}</div></div>` : ''}
      ${task.expected_duration_days ? `<div class="wsp-row"><span class="wsp-row-label">Shelf life</span><span class="wsp-row-value">${task.expected_duration_days}d</span></div>` : ''}
      ${task.min_cover_days ? `<div class="wsp-row"><span class="wsp-row-label">Min cover</span><span class="wsp-row-value">${task.min_cover_days}d</span></div>` : ''}
    </div>

    <!-- ── Recipe link ── -->
    ${hasRecipe ? `
    <div class="wsp-section" style="padding:12px 14px;">
      <div class="wsp-section-title">Recipe</div>
      <button class="wsp-open-recipe-btn" onclick="wsPrepOpenRecipe(${JSON.stringify(params.id)})">
        <span>📋 View recipe & procedure</span>
        <span style="opacity:0.5;font-size:18px;">›</span>
      </button>
    </div>` : ''}

    <!-- ── Actions ── -->
    <div class="wsp-section" style="padding:14px;">
      <div class="wsp-action-row">
        ${!isWip
          ? `<button class="wsp-btn primary" onclick="wsCallPrepStart(${JSON.stringify(params.id)})">▶ Start</button>`
          : `<button class="wsp-btn secondary" onclick="wsCallPrepSeeSteps(${JSON.stringify(params.id)})">📋 See steps</button>`
        }
        <button class="wsp-btn success" onclick="wsCallPrepDone(${JSON.stringify(params.id)})">✓ Done</button>
      </div>
    </div>

    <!-- ── Note input (admin only) ── -->
    ${typeof isAdmin === 'function' && isAdmin() ? `
    <div class="wsp-section" id="ws-note-section">
      <div class="wsp-section-title">Add / edit note</div>
      <textarea class="wsp-note-area" id="ws-note-input" rows="3" placeholder="Note for the team...">${_wsEscape(task.note || '')}</textarea>
      <button onclick="wsNotesSave(${JSON.stringify(params.id)})" style="margin-top:8px;padding:8px 16px;background:#1e3a5f;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;">Save note</button>
    </div>` : ''}
  `;
}, {
  title: function(params, payload) {
    const task = payload || (typeof tasks !== 'undefined' && tasks[params.id]);
    return task ? task.name : 'Prep Detail';
  },
  afterRender: function(el, params, payload) {
    // Nothing needed for now — all interactions via window.* functions
  }
});

/* ══ WORKSPACE ACTIONS (called from within workspace page HTML) ══════════════ */

window.wsPrepOpenRecipe = function(id) {
  const task = (typeof tasks !== 'undefined' && tasks[id]);
  if (!task) return;
  // Phase 1: fall back to existing recipeModal
  if (typeof recipeModal !== 'undefined') {
    recipeModal.open(task.recipe_id || null, id);
  }
};

window.wsCallPrepStart = function(id) {
  if (typeof window.prepStart === 'function') {
    window.prepStart(id);
    // After starting, refresh workspace to show updated state
    setTimeout(() => {
      const task = typeof tasks !== 'undefined' && tasks[id];
      if (task && WS.active) openWorkspace('/prep/' + id, task);
    }, 300);
  }
};

window.wsCallPrepSeeSteps = function(id) {
  if (typeof window.prepSeeSteps === 'function') window.prepSeeSteps(id);
};

window.wsCallPrepDone = function(id) {
  // Close workspace first so Done sheet appears on top of prep list
  closeWorkspace();
  setTimeout(() => {
    if (typeof window.prepDone === 'function') window.prepDone(id);
  }, 250);
};

window.wsNotesSave = async function(id) {
  const input = document.getElementById('ws-note-input');
  if (!input) return;
  const note = input.value.trim();
  try {
    await supa.from('prep_tasks').update({ note }).eq('id', id);
    if (typeof tasks !== 'undefined' && tasks[id]) tasks[id].note = note;
    // Small feedback
    input.style.borderColor = '#059669';
    setTimeout(() => { input.style.borderColor = ''; }, 1500);
  } catch (err) {
    console.error('[workspace] note save failed', err);
    alert('Save failed: ' + err.message);
  }
};

/* ══ WORKSPACE ACTIVATION GUARD ═════════════════════════════════════════════
   Workspace is DISABLED by default on the live Brigade app.
   It activates ONLY when explicitly enabled via:
     - URL query:       ?workspace=1
     - localStorage:    localStorage.setItem('bohWorkspace','1')
     - Programmatic:    wsActivate()

   This keeps the live operational UI completely unchanged.
   The Workspace refactor is a separate laboratory, not a live feature.
   ─────────────────────────────────────────────────────────────────────────── */

function _wsIsEnabled() {
  try {
    if (new URLSearchParams(location.search).get('workspace') === '1') return true;
    if (localStorage.getItem('bohWorkspace') === '1') return true;
  } catch(e) {}
  return false;
}

/**
 * Explicitly enable the workspace.
 * Call from console or dev tools: wsActivate()
 */
window.wsActivate = function() {
  try { localStorage.setItem('bohWorkspace', '1'); } catch(e) {}
  console.log('[workspace] activated — reload to apply');
  location.reload();
};

/**
 * Disable the workspace and return to default live behavior.
 */
window.wsDeactivate = function() {
  try { localStorage.removeItem('bohWorkspace'); } catch(e) {}
  console.log('[workspace] deactivated — reload to apply');
  location.reload();
};

/* ── Side effects run ONLY when workspace is enabled ── */
document.addEventListener('DOMContentLoaded', function() {
  if (!_wsIsEnabled()) {
    console.log('[workspace] disabled (default). To enable: wsActivate() or ?workspace=1');
    return; // <-- live app: nothing below runs
  }

  console.log('[workspace] enabled — activating router and intercepts');

  // Inject workspace CSS (only when enabled)
  if (!document.getElementById('ws-styles')) wsInjectStyles();

  // Intercept prep card click
  const _originalPrepOpenRecipe = window.prepOpenRecipe;
  window.prepOpenRecipe = function(id) {
    const task = (typeof tasks !== 'undefined' && tasks[id]);
    if (task) { openWorkspace('/prep/' + id, task); return; }
    if (typeof _originalPrepOpenRecipe === 'function') _originalPrepOpenRecipe(id);
  };

  // Browser back/forward
  window.addEventListener('popstate', function(e) {
    const hash = location.hash;
    if (hash && hash.startsWith('#/')) {
      const route = hash.slice(1);
      WS.active = true; WS.route = route; WS.payload = null;
      try { _wsRender(); } catch (err) { _wsShowError(err); }
    } else if (WS.active) {
      WS.active = false; WS.route = null;
      const root = document.getElementById('workspace-root');
      if (root) { root.innerHTML = ''; root.style.display = 'none'; }
      document.body.style.overflow = '';
    }
  });

  // ESC to close
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && WS.active) closeWorkspace();
  });

  // Check URL hash on page load
  const hash = location.hash;
  if (hash && hash.startsWith('#/')) {
    const waitForInit = setInterval(function() {
      if (typeof tasks !== 'undefined' && Object.keys(tasks).length > 0) {
        clearInterval(waitForInit);
        openWorkspace(hash.slice(1));
      }
    }, 100);
    setTimeout(() => clearInterval(waitForInit), 5000);
  }
});
