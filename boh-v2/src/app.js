// BOH OS v2 — app bootstrap
// Task 003A: authenticated App Shell replaces login screen on success.
// Task 003B: bottom navigation mount target provided by App Shell.
// Task 003C: station navigation delegated to setupStationNavigation().
// WS-01: App Shell now returns { shell, panelStripMount }.
// WS-03: WorkspaceManager created and Home panel opened after authentication.
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
  throw new Error(
    'BOH OS v2: mount element #app not found. Check index.html.'
  );
}

// ── Active WorkspaceManager reference ─────────────────────────────────
// Held here so destroy() can be called on logout/re-login.
// null when no shell is mounted (login screen showing).
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

// Track in-flight submission to prevent duplicates.
let submitting = false;

// ── Connection diagnostic (non-blocking) ──────────────────────────────

function runConnectionDiagnostic() {
  checkSupabaseConnection().then((result) => {
    const dot = getDot();
    if (!dot) return;   // already replaced by shell — ignore
    if (result.ok) {
      dot.dataset.status = 'ready';
      dot.setAttribute('aria-label', 'Data connection ready');
    } else {
      dot.dataset.status = 'unavailable';
      dot.setAttribute('aria-label', 'Data connection unavailable');
    }
  });
}

// ── Home placeholder renderer (WS-03) ─────────────────────────────────
// Synchronous, returns HTMLElement immediately.
// Clearly temporary. Will be replaced by the real Home Composition Engine.

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

// ── Shell transition ──────────────────────────────────────────────────

function mountShell(user) {
  // Destroy any previous WorkspaceManager from a prior login cycle
  // (handles logout → re-login in the same tab).
  if (_workspaceManager) {
    _workspaceManager.destroy();
    _workspaceManager = null;
  }

  // WS-01: createAppShell now returns { shell, panelStripMount }.
  const { shell, panelStripMount } = createAppShell({
    appName:   t('app.name'),
    modeLabel: t('mode.station'),
    userName:  user.name,
  });

  root.innerHTML = '';
  root.appendChild(shell);

  const outlet = root.querySelector('#app-content');
  router.init(outlet);

  const navMount = root.querySelector('.app-shell__nav-mount');

  // ── WS-03: Bootstrap WorkspaceManager ───────────────────────────────
  _workspaceManager = createWorkspaceManager({ outlet, panelStripMount });
  _workspaceManager.registerRenderer('home', createHomePlaceholder);
  _workspaceManager.openPanel('home', {});

  // Station navigation remains fully operational (WS-04 not yet implemented).
  // It continues to use the router directly.
  setupStationNavigation({
    router,
    mountElement: navMount,
    translate:    t,
    user,
  });

  router.navigate('station-home');
}

// ── Logout / cleanup ──────────────────────────────────────────────────
// Called when re-rendering the login screen after logout.
// Ensures WorkspaceManager state is fully reset before the login UI appears.

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
  if (pinInput) {
    pinInput.value = '';
    pinInput.focus();
  }
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
// Runs once on boot. If a valid brigade_token is in sessionStorage,
// skip the PIN screen. If not, render login and run diagnostics.

(async function boot() {
  const restored = await restoreSession();
  if (restored.ok) {
    setCurrentUser(restored.user);
    mountShell(restored.user);
    return;
  }
  // No valid session — show PIN screen and check connectivity.
  renderLogin();
  runConnectionDiagnostic();
})();
