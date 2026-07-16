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
import { completePrepTaskRpc } from './services/prep-complete-rpc-service.js';
import { passPrepToShift } from './services/prep-pass-service.js';
import { fetchAvailableStations } from './services/station-list-service.js';

const root = document.getElementById('app');

if (!root) {
  throw new Error('BOH OS v2: mount element #app not found. Check index.html.');
}

// ── Active WorkspaceManager reference ─────────────────────────────────
let _workspaceManager = null;

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
        maxlength="4"
        autocomplete="off"
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

// ── Home placeholder renderer ─────────────────────────────────────────
// Synchronous, returns HTMLElement immediately.
// Will be replaced by the real Home Composition Engine in a future session.

function createHomePlaceholder() {
  const section = document.createElement('section');
  section.className = 'home-placeholder';

  const heading = document.createElement('h2');
  heading.className = 'home-placeholder__title';
  heading.textContent = 'Home';

  const body = document.createElement('p');
  body.className = 'home-placeholder__body';
  body.textContent = 'Workspace foundation active. Home panel coming soon.';

  section.appendChild(heading);
  section.appendChild(body);
  return section;
}

// ── Station Selector modal (executive chef / admin '+' button) ────────
// The station-selector component takes a pre-loaded stations array, so we
// fetch first, then render. The modal is an overlay — not a panel.

function openStationSelectorModal(workspaceManager, shellEl) {
  // Backdrop — full-screen overlay
  const backdrop = document.createElement('div');
  backdrop.className = 'station-selector-modal';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', 'Select a station');

  function dismiss() {
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
  }

  // Loading state while stations are fetched
  const loadingEl = document.createElement('div');
  loadingEl.className = 'station-selector-modal__loading';
  loadingEl.textContent = 'Loading stations…';
  backdrop.appendChild(loadingEl);

  shellEl.appendChild(backdrop);

  // Dismiss on backdrop click (outside the selector card)
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) dismiss();
  });

  // Fetch stations, then swap in the real selector
  fetchAvailableStations().then((result) => {
    if (!backdrop.isConnected) return;

    backdrop.removeChild(loadingEl);

    const stations = result.ok ? (result.stations ?? []) : [];

    const selectorEl = createStationSelector({
      stations,
      translate: t,
      onSelect: (stationName) => {
        dismiss();
        workspaceManager.openPanel('station-prep', { stationName });
      },
    });

    // Wrap in a card so backdrop clicks don't propagate from the selector
    const card = document.createElement('div');
    card.className = 'station-selector-modal__card';
    card.addEventListener('click', (e) => e.stopPropagation());

    // Dismiss button
    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'station-selector-modal__dismiss';
    dismissBtn.setAttribute('aria-label', 'Close station selector');
    dismissBtn.textContent = '×';
    dismissBtn.addEventListener('click', dismiss);

    card.appendChild(dismissBtn);
    card.appendChild(selectorEl);
    backdrop.appendChild(card);
  });
}

// ── Shell mount ───────────────────────────────────────────────────────

function mountShell(user) {
  // Destroy previous WorkspaceManager on logout → re-login.
  if (_workspaceManager) {
    _workspaceManager.destroy();
    _workspaceManager = null;
  }

  // WS-05: App Shell returns workspace-relevant references only.
  // No navMount. No legacyOutlet. Single workspace outlet.
  const { shell, panelStripMount, workspaceOutlet } = createAppShell({
    appName:   t('app.name'),
    modeLabel: t('mode.station'),
    userName:  user.name,
  });

  root.innerHTML = '';
  root.appendChild(shell);

  // Executive chef / admin: '+' control opens Station Selector modal.
  // Station users: '+' hidden.
  const isExecutiveChef = can('view_executive_mode', user);

  // ── Create WorkspaceManager ──────────────────────────────────────
  _workspaceManager = createWorkspaceManager({
    outlet:          workspaceOutlet,
    panelStripMount,
    showAdd:         isExecutiveChef,
    onAdd:           () => openStationSelectorModal(_workspaceManager, shell),
  });

  // ── Register renderers ───────────────────────────────────────────

  _workspaceManager.registerRenderer('home', createHomePlaceholder);

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
      fetchCounts:      fetchRecentPrepCounts,
      startTask:        startPrepTaskRpc,
      completeTask:     completePrepTaskRpc,
      saveCount:        savePrepCountRpc,
      reconcileCount:   reconcilePrepCount,
      passTask:         passPrepToShift,
      currentUser:      user,
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
}

// ── Logout / cleanup ──────────────────────────────────────────────────

function teardownShell() {
  if (_workspaceManager) {
    _workspaceManager.destroy();
    _workspaceManager = null;
  }
  clearCurrentUser();
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
