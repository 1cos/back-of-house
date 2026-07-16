// BOH OS v2 — app bootstrap
// Task 003A: authenticated App Shell replaces login screen on success.
// Task 003B: bottom navigation mount target provided by App Shell.
// Task 003C: station navigation delegated to setupStationNavigation().
// WS-01: App Shell returns { shell, panelStripMount, workspaceOutlet, legacyOutlet }.
// WS-03: WorkspaceManager created; Home placeholder registered and opened.
// WS-03.1: dual-outlet surface switching.
//   - workspaceOutlet (#app-content)        → WorkspaceManager exclusive.
//   - legacyOutlet    (#app-content-legacy) → router exclusive.
//   - Only one outlet is visible at a time.
//   - Activating a workspace panel shows workspaceOutlet, hides legacyOutlet.
//   - Any legacy router.navigate() shows legacyOutlet, hides workspaceOutlet,
//     and deactivates the workspace strip (no chip is marked active).
// Session restore: on page load, restoreSession() checks for an existing
// brigade_token so returning users skip the PIN screen.
// No global state. No window writes.

import { t } from './core/i18n.js';
import { checkSupabaseConnection } from './core/supabase-client.js';
import { authenticateWithPin, restoreSession } from './services/auth-service.js';
import { setCurrentUser, getCurrentUser, clearCurrentUser } from './core/app-state.js';
import { router } from './core/router.js';
import { createAppShell } from './components/app-shell/app-shell.js';
import { setupStationNavigation } from './modes/station/station-navigation.js';
import { createWorkspaceManager } from './core/workspace-manager.js';

const root = document.getElementById('app');

if (!root) {
  throw new Error('BOH OS v2: mount element #app not found. Check index.html.');
}

// ── Active WorkspaceManager reference ─────────────────────────────────
let _workspaceManager = null;

// ── Surface references (set in mountShell, cleared in teardownShell) ──
let _workspaceOutlet = null;
let _legacyOutlet    = null;

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

// ── Surface switching ──────────────────────────────────────────────────
// Exactly one outlet is visible at any time.
// Neither function touches the other system's outlet content.

const VISIBLE_CLASS = 'app-shell__outlet--visible';

/**
 * Show the workspace outlet; hide the legacy router outlet.
 * Called when a workspace panel is activated.
 */
function showWorkspaceSurface() {
  if (!_workspaceOutlet || !_legacyOutlet) return;
  _workspaceOutlet.classList.add(VISIBLE_CLASS);
  _legacyOutlet.classList.remove(VISIBLE_CLASS);
}

/**
 * Show the legacy router outlet; hide the workspace outlet.
 * Called when any legacy navigation item is selected.
 * Also deactivates the workspace strip's active indicator so no chip
 * appears falsely selected while legacy content is visible.
 */
function showLegacySurface() {
  if (!_workspaceOutlet || !_legacyOutlet) return;
  _legacyOutlet.classList.add(VISIBLE_CLASS);
  _workspaceOutlet.classList.remove(VISIBLE_CLASS);
}

// ── Home placeholder renderer (WS-03) ─────────────────────────────────
// Synchronous, returns HTMLElement immediately.
// Clearly temporary — will be replaced by the real Home Composition Engine.

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

// ── Patched router.navigate (WS-03.1) ─────────────────────────────────
// Wraps the original router.navigate so that any legacy navigation
// automatically switches the visible surface to the legacy outlet.
// The WorkspaceManager's strip is re-rendered with no active chip
// by deactivating the workspace manager's active state when legacy
// surfaces take over.
//
// Implementation: we intercept at the router level so station-navigation.js
// needs zero changes. The router's _outlet is already set to legacyOutlet;
// this wrapper just keeps surfaces in sync.

const _originalNavigate = router.navigate.bind(router);

function patchedNavigate(name) {
  const result = _originalNavigate(name);
  if (result) {
    // A real page rendered — switch surface to legacy.
    showLegacySurface();
    // Deactivate the workspace strip (no panel appears highlighted)
    // by telling the WorkspaceManager that no workspace panel is "current"
    // from the user's perspective. We do this by stripping the active
    // class from all chips. The WorkspaceManager's internal _activeId
    // remains intact so re-activating a workspace panel still works.
    // We reach this via a lightweight DOM update on the strip only.
    _syncStripForLegacySurface();
  }
  return result;
}

/**
 * Walks the current strip DOM and removes the active class from all chips.
 * Called when legacy surface takes over. Does not touch WorkspaceManager
 * internal state — the manager still knows which panel is "logically active"
 * so it can re-mount it correctly when the user taps a chip.
 */
function _syncStripForLegacySurface() {
  const strip = root.querySelector('.ws-strip');
  if (!strip) return;
  strip.querySelectorAll('.ws-chip--active').forEach(chip => {
    chip.classList.remove('ws-chip--active');
    chip.setAttribute('aria-selected', 'false');
  });
}

// ── Shell transition ──────────────────────────────────────────────────

function mountShell(user) {
  // Destroy previous WorkspaceManager (logout → re-login in same tab).
  if (_workspaceManager) {
    _workspaceManager.destroy();
    _workspaceManager = null;
  }

  // WS-01/WS-03.1: App Shell returns four named references.
  const { shell, panelStripMount, workspaceOutlet, legacyOutlet } = createAppShell({
    appName:   t('app.name'),
    modeLabel: t('mode.station'),
    userName:  user.name,
  });

  root.innerHTML = '';
  root.appendChild(shell);

  // Store surface references for switching.
  _workspaceOutlet = workspaceOutlet;
  _legacyOutlet    = legacyOutlet;

  // Router owns legacyOutlet exclusively.
  router.init(legacyOutlet);
  // Patch navigate so legacy navigations switch the surface automatically.
  router.navigate = patchedNavigate;

  const navMount = root.querySelector('.app-shell__nav-mount');

  // ── WS-03: Bootstrap WorkspaceManager ───────────────────────────────
  // WorkspaceManager owns workspaceOutlet exclusively.
  // onPanelActivated: when the user taps a workspace chip, switch
  // the visible surface to the workspace outlet.
  _workspaceManager = createWorkspaceManager({
    outlet:           workspaceOutlet,
    panelStripMount,
    showAdd:          false,  // no caller wired until WS-04
    onPanelActivated: (_panelId) => {
      showWorkspaceSurface();
    },
  });
  _workspaceManager.registerRenderer('home', createHomePlaceholder);

  // Open Home — places the chip and mounts placeholder into workspaceOutlet.
  // Does NOT switch the visible surface yet; legacy starts visible so
  // Station Home loads normally after setupStationNavigation fires.
  _workspaceManager.openPanel('home', {});

  // Station navigation wired to the legacy outlet via the router.
  // setupStationNavigation is unchanged — it calls router.navigate() which
  // now calls patchedNavigate(), keeping surfaces coherent.
  setupStationNavigation({
    router,
    mountElement: navMount,
    translate:    t,
    user,
  });

  // Initial legacy navigation — shows Station Home in legacyOutlet.
  // legacyOutlet is already visible by default (set in app-shell.js).
  // patchedNavigate is called here; it shows legacyOutlet and dims the strip.
  router.navigate('station-home');
}

// ── Logout / cleanup ──────────────────────────────────────────────────

function teardownShell() {
  if (_workspaceManager) {
    _workspaceManager.destroy();
    _workspaceManager = null;
  }
  _workspaceOutlet = null;
  _legacyOutlet    = null;
  clearCurrentUser();
  // Restore the original navigate so the next mountShell gets a clean patch.
  router.navigate = _originalNavigate;
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
