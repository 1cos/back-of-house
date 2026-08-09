// BOH OS v2 — app bootstrap
// WS-05: Bottom bar retired. WorkspaceManager is the sole navigation model.
//
// Login flow:
//   authenticate() → mountShell(user)
//                  → createWorkspaceManager({ outlet, panelStripMount, showAdd, onAdd })
//                  → registerRenderer('home', ...)
//                  → registerRenderer('station-prep', ...)
//                  → openPanel('home', {})
//                  → if station user + defaultStation:
//                      openPanel('station-prep', { stationName })  ← lands here, not Home
//                  → if admin/exec chef: Home is active, '+' opens Station Selector modal
//
// No bottom bar. No legacy router outlet. No dual-surface switching.
// No global state. No window writes. No storage.

import { t } from './core/i18n.js';
import { checkSupabaseConnection } from './core/supabase-client.js';
import { authenticateWithPin, restoreSession } from './services/auth-service.js';
import { setCurrentUser, getCurrentUser, clearCurrentUser } from './core/app-state.js';
import { createAppShell } from './components/app-shell/app-shell.js';
import { createWorkspaceManager } from './core/workspace-manager.js';
import { can } from './core/permissions.js';
import { createStationSelector } from './components/station/station-selector.js';

// ── Prep services for the station-prep renderer ───────────────────────
import { createStationPrep } from './modes/station/station-prep.js';
import { fetchStationPrepTasks } from './services/station-prep-service.js';
import { fetchPrepSuggestions } from './services/prep-suggestion-service.js';
import { fetchTodayPrepLogs } from './services/prep-log-service.js';
import { fetchRecentPrepCounts } from './services/prep-count-service.js';
import { savePrepCountRpc } from './services/prep-count-rpc-service.js';
import { reconcilePrepCount } from './services/prep-count-reconciler-service.js';
import { startPrepTaskRpc } from './services/prep-start-rpc-service.js';
// completePrepTaskRpc no longer injected into station-prep UI (Phase 3B — all completions via markDoneViaEf)
import { markDoneViaEf, recordProductionViaEf, refreshPrepSuggestionViaEf } from './services/prep-production-ef-service.js';
import { fetchHistoricalPrepCounts } from './services/prep-count-service.js';
import { passPrepToShift } from './services/prep-pass-service.js';
import { fetchAvailableStations } from './services/station-list-service.js';
import { createCommandBar } from './components/command-bar/command-bar.js';

// ── Home Panel ─────────────────────────────────────────────────────────
import { createHomePanel } from './home/home-panel.js';

// ── Recipe Panel ────────────────────────────────────────────────────────
import { createRecipePanel } from './components/recipe/recipe-panel.js';

// ── Recipe Book ─────────────────────────────────────────────────────────
import { createRecipeBookPanel } from './components/recipe-book/recipe-book-panel.js';
const root = document.getElementById('app');

if (!root) {
  throw new Error('BOH OS v2: mount element #app not found. Check index.html.');
}

// ── Active WorkspaceManager reference ─────────────────────────────────
let _workspaceManager    = null;
let _commandBar          = null;
let _appShellDestroy     = null;  // UI-06.5: remove vv listener on logout

// ── Login screen ──────────────────────────────────────────────────────

function renderLogin() {
  root.innerHTML = `
    <div class="login-card">
      <h1 class="login-title">${t('auth.title')}</h1>
      <label class="login-label" for="pin-input">${t('auth.pin_label')}</label>
      <input
        id="pin-input"
        class="pin-input"
        type="password"
        inputmode="numeric"
        pattern="[0-9]*"
        maxlength="4"
        autocomplete="one-time-code"
        autofocus
        aria-label="${t('auth.pin_label')}"
      >
      <p class="login-error" role="alert" aria-live="polite"></p>
      <button id="pin-submit" class="btn-primary" type="button">
        ${t('auth.continue')}
      </button>
      <span
        class="status-dot"
        data-status="pending"
        aria-label="Checking data connection"
        role="status"
      ></span>
    </div>
  `;
}

// ── DOM references ────────────────────────────────────────────────────

function getPinInput()  { return root.querySelector('#pin-input');   }
function getPinSubmit() { return root.querySelector('#pin-submit');  }
function getErrorEl()   { return root.querySelector('.login-error'); }
function getDot()       { return root.querySelector('.status-dot');  }

let submitting = false;

// ── Connection diagnostic (non-blocking) ──────────────────────────────

function runConnectionDiagnostic() {
  checkSupabaseConnection().then((result) => {
    const dot = getDot();
    if (!dot) return;
    if (result.ok) {
      dot.dataset.status = 'ready';
      dot.setAttribute('aria-label', 'Data connection ready');
    } else {
      dot.dataset.status = 'unavailable';
      dot.setAttribute('aria-label', 'Data connection unavailable');
    }
  });
}

// ── Home renderer factory ─────────────────────────────────────────────
// HOME-01: real Home panel. Returns HTMLElement immediately (skeleton-first).
// Wraps createHomePanel so WorkspaceManager receives the synchronous element.
// Per block lifecycle: skeleton is returned; fetches run asynchronously.
//
// destroy() is tracked so blocks are cleaned up on logout.

let _homePanelDestroy = null;

function makeHomeRenderer(user) {
  return function homeRenderer(/* context — unused for home */) {
    // Destroy previous home panel instance if re-created on the same session
    if (_homePanelDestroy) {
      _homePanelDestroy();
      _homePanelDestroy = null;
    }
    const { root, destroy } = createHomePanel({
      user,
      translate:  t,
      openPanel:  (type, ctx) => _workspaceManager && _workspaceManager.openPanel(type, ctx),
      can:        (perm, u) => can(perm, u ?? user),
    });
    _homePanelDestroy = destroy;
    return root;
  };
}

// ── Station Selector modal (executive chef / admin '+' button) ────────
// The station-selector component takes a pre-loaded stations array, so we
// fetch first, then render. The modal is an overlay — not a panel.

function openPanelChooserModal(workspaceManager, shellEl) {
  // Backdrop — full-screen overlay
  const backdrop = document.createElement('div');
  backdrop.className = 'station-selector-modal';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', 'Open panel');

  function dismiss() {
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
  }

  // Dismiss on backdrop click (outside the card)
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) dismiss();
  });

  // Card container
  const card = document.createElement('div');
  card.className = 'station-selector-modal__card';
  card.addEventListener('click', (e) => e.stopPropagation());

  // Dismiss button
  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.className = 'station-selector-modal__dismiss';
  dismissBtn.setAttribute('aria-label', 'Close');
  dismissBtn.textContent = '×';
  dismissBtn.addEventListener('click', dismiss);
  card.appendChild(dismissBtn);

  // ── Chooser: Recipe Book + Station ──────────────────────────────
  function showChooser() {
    // Clear card content except dismiss button
    while (card.children.length > 1) card.removeChild(card.lastChild);

    const chooser = document.createElement('div');
    chooser.className = 'station-selector-modal__chooser';

    const heading = document.createElement('h3');
    heading.className = 'station-selector-modal__chooser-heading';
    heading.textContent = t('station_selector.open_heading');
    chooser.appendChild(heading);

    // Recipe Book option
    const recipeBtn = document.createElement('button');
    recipeBtn.type = 'button';
    recipeBtn.className = 'station-selector-modal__chooser-option';
    recipeBtn.innerHTML = '<span class="station-selector-modal__chooser-icon" aria-hidden="true">📖</span>';
    recipeBtn.appendChild(document.createTextNode(' ' + t('recipe_book.title')));
    recipeBtn.addEventListener('click', () => {
      dismiss();
      workspaceManager.openPanel('recipe-book', {});
    });
    chooser.appendChild(recipeBtn);

    // Station option
    const stationBtn = document.createElement('button');
    stationBtn.type = 'button';
    stationBtn.className = 'station-selector-modal__chooser-option';
    stationBtn.innerHTML = '<span class="station-selector-modal__chooser-icon" aria-hidden="true">🍳</span>';
    stationBtn.appendChild(document.createTextNode(' ' + t('station_selector.title')));
    stationBtn.addEventListener('click', showStationList);
    chooser.appendChild(stationBtn);

    card.appendChild(chooser);
  }

  // ── Station list (replaces chooser inside same card) ───────────
  function showStationList() {
    // Clear card content except dismiss button
    while (card.children.length > 1) card.removeChild(card.lastChild);

    // Back button
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'station-selector-modal__back';
    backBtn.textContent = '← ' + t('station_selector.open_heading');
    backBtn.addEventListener('click', showChooser);
    card.appendChild(backBtn);

    // Loading state
    const loadingEl = document.createElement('div');
    loadingEl.className = 'station-selector-modal__loading';
    loadingEl.textContent = t('station_selector.loading');
    card.appendChild(loadingEl);

    fetchAvailableStations().then((result) => {
      if (!backdrop.isConnected) return;
      if (loadingEl.parentNode) loadingEl.remove();

      const stations = result.ok ? (result.stations ?? []) : [];

      const selectorEl = createStationSelector({
        stations,
        translate: t,
        onSelect: (stationName) => {
          dismiss();
          workspaceManager.openPanel('station-prep', { stationName });
        },
      });

      card.appendChild(selectorEl);
    });
  }

  // Start with chooser
  showChooser();

  backdrop.appendChild(card);
  shellEl.appendChild(backdrop);
}

// ── Shell mount ───────────────────────────────────────────────────────

function mountShell(user) {
  // UI-06.5: Destroy previous shell, WorkspaceManager and Command Bar on logout.
  if (_appShellDestroy) {
    _appShellDestroy();
    _appShellDestroy = null;
  }
  if (_commandBar) {
    _commandBar.destroy();
    _commandBar = null;
  }
  if (_workspaceManager) {
    _workspaceManager.destroy();
    _workspaceManager = null;
  }

  // WS-05: App Shell returns workspace-relevant references only.
  // No navMount. No legacyOutlet. Single workspace outlet.
  const { shell, panelStripMount, workspaceOutlet, destroy: shellDestroy } = createAppShell({
    appName:   t('app.name'),
    modeLabel: t('mode.station'),
    userName:  user.name,
  });

  root.innerHTML = '';
  root.appendChild(shell);
  _appShellDestroy = shellDestroy;

  // Executive chef / admin: '+' control opens Station Selector modal.
  // Station users: '+' hidden.
  const isExecutiveChef = can('view_executive_mode', user);

  // ── Create WorkspaceManager ──────────────────────────────────────
  _workspaceManager = createWorkspaceManager({
    outlet:          workspaceOutlet,
    panelStripMount,
    showAdd:         isExecutiveChef,
    onAdd:           () => openPanelChooserModal(_workspaceManager, shell),
  });

  // ── Register renderers ───────────────────────────────────────────

  _workspaceManager.registerRenderer('home', makeHomeRenderer(user));

  // station-prep renderer — skeleton-first pattern (createStationPrep returns
  // a DOM element immediately and populates it asynchronously with isConnected guards).
  _workspaceManager.registerRenderer('station-prep', ({ stationName }) =>
    createStationPrep({
      stationName,
      canChooseStation: false,  // station already resolved at panel-open time
      translate:        t,
      fetchStations:    fetchAvailableStations,
      onStationSelect:  (newStation) => {
        // If a station selector inside the prep panel fires (legacy path),
        // open it as a new/existing workspace panel.
        _workspaceManager.openPanel('station-prep', { stationName: newStation });
      },
      fetchTasks:       fetchStationPrepTasks,
      fetchSuggestions: fetchPrepSuggestions,
      fetchLogs:        fetchTodayPrepLogs,
      fetchCounts:          fetchRecentPrepCounts,
      fetchHistoricalCounts:fetchHistoricalPrepCounts,
      startTask:            startPrepTaskRpc,
      markDone:             markDoneViaEf,
      recordProduction:     recordProductionViaEf,
      refreshSuggestion:    refreshPrepSuggestionViaEf,
      saveCount:        savePrepCountRpc,
      reconcileCount:   reconcilePrepCount,
      passTask:         passPrepToShift,
      currentUser:      user,
      openPanel:        (type, ctx) => _workspaceManager && _workspaceManager.openPanel(type, ctx),
    })
  );

  // ── Register recipe-detail renderer ─────────────────────────────
  _workspaceManager.registerRenderer('recipe-detail', (context) =>
    createRecipePanel({ ...context, translate: t })
  );

  // ── Register recipe-book renderer ──────────────────────────────
  _workspaceManager.registerRenderer('recipe-book', () =>
    createRecipeBookPanel({
      translate: t,
      openPanel: (type, ctx) => _workspaceManager && _workspaceManager.openPanel(type, ctx),
    })
  );

  // ── Open Home (always first) ─────────────────────────────────────
  // Home chip is always the leftmost item in the Panel Strip.
  _workspaceManager.openPanel('home', {});

  // ── WS-05: station-user auto-open ────────────────────────────────
  // Station users with a defaultStation land directly on their prep panel.
  // Executive chef / admin land on Home and choose stations via '+'.
  const defaultStation =
    typeof user.defaultStation === 'string' && user.defaultStation.trim().length > 0
      ? user.defaultStation.trim()
      : null;

  if (defaultStation && !isExecutiveChef) {
    // openPanel activates the new panel — user sees prep, not Home.
    _workspaceManager.openPanel('station-prep', { stationName: defaultStation });
  }

  // ── UI-06: Command Bar ────────────────────────────────────────────
  // Mounted once per authenticated session, directly on the shell root.
  // Fixed position — lives above all workspace content.
  // UI-06.1: pass the real scroll container so the keyboard-inset logic
  // can dynamically update its padding-bottom. workspaceOutlet.parentNode
  // is .app-shell__main — the element with overflow-y:auto.
  // UI-06.5: no scrollTarget — Command Bar is a flex child, not position:fixed.
  _commandBar = createCommandBar({ translate: t });
  shell.appendChild(_commandBar.el);
}


// ── PIN submission logic ───────────────────────────────────────────────

function setSubmitting(active) {
  submitting = active;
  const pinInput  = getPinInput();
  const pinSubmit = getPinSubmit();
  if (!pinInput || !pinSubmit) return;
  pinInput.disabled  = active;
  pinSubmit.disabled = active;
  pinSubmit.textContent = active ? t('auth.checking') : t('auth.continue');
}

function showError(message) {
  const errorEl = getErrorEl();
  const pinInput = getPinInput();
  if (errorEl) errorEl.textContent = message;
  if (pinInput) { pinInput.value = ''; pinInput.focus(); }
}

function clearError() {
  const errorEl = getErrorEl();
  if (errorEl) errorEl.textContent = '';
}

async function handleSubmit() {
  if (submitting) return;
  const pinInput = getPinInput();
  if (!pinInput) return;

  const pin = pinInput.value;
  clearError();
  setSubmitting(true);

  const result = await authenticateWithPin(pin);

  if (result.ok) {
    setCurrentUser(result.user);
    const user = getCurrentUser();
    mountShell(user);
    return;
  }

  setSubmitting(false);

  if (result.reason === 'USER_NOT_FOUND' || result.reason === 'INVALID_PIN') {
    showError(t('auth.invalid_pin'));
  } else {
    showError(t('auth.connection_error'));
  }
}

// ── Event wiring ──────────────────────────────────────────────────────

root.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'pin-submit') handleSubmit();
});

root.addEventListener('keydown', (e) => {
  const pinInput = getPinInput();
  if (pinInput && e.target === pinInput && e.key === 'Enter') handleSubmit();
});

root.addEventListener('input', (e) => {
  const pinInput = getPinInput();
  if (pinInput && e.target === pinInput && pinInput.value.length === 4) {
    handleSubmit();
  }
});

// ── Session restore ───────────────────────────────────────────────────

(async function boot() {
  const restored = await restoreSession();
  if (restored.ok) {
    setCurrentUser(restored.user);
    mountShell(restored.user);
    return;
  }
  renderLogin();
  runConnectionDiagnostic();
})();



