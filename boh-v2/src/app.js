// BOH OS v2 — app bootstrap
// Task 003A: authenticated App Shell replaces login screen on success.
// No global state. No window writes. No storage APIs.

import { t } from './core/i18n.js';
import { checkSupabaseConnection } from './core/supabase-client.js';
import { authenticateWithPin } from './services/auth-service.js';
import { setCurrentUser, getCurrentUser } from './core/app-state.js';
import { router } from './core/router.js';
import { createAppShell } from './components/app-shell/app-shell.js';

const root = document.getElementById('app');

if (!root) {
  throw new Error(
    'BOH OS v2: mount element #app not found. Check index.html.'
  );
}

// ── Login screen ──────────────────────────────────────────────────────
// Rendered initially. Replaced on successful authentication.

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

renderLogin();

// ── DOM references ────────────────────────────────────────────────────

function getPinInput()  { return root.querySelector('#pin-input');    }
function getPinSubmit() { return root.querySelector('#pin-submit');   }
function getErrorEl()   { return root.querySelector('.login-error');  }
function getDot()       { return root.querySelector('.status-dot');   }

// Track in-flight submission to prevent duplicates.
let submitting = false;

// ── Connection diagnostic (non-blocking) ──────────────────────────────

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

// ── Shell transition ──────────────────────────────────────────────────
// Called exactly once after a successful login.
// Replaces the login screen with the App Shell.
// Initializes the router against the new #app-content outlet.

function mountShell(user) {
  const shell = createAppShell({
    appName:   t('app.name'),
    modeLabel: t('mode.station'),
    userName:  user.name,
  });

  // Replace login screen with App Shell.
  root.innerHTML = '';
  root.appendChild(shell);

  // The outlet now exists inside the shell — initialize router against it.
  const outlet = root.querySelector('#app-content');
  router.init(outlet);

  // Register the station-home placeholder route.
  router.register('station-home', () => `
    <div class="scaffold-card">
      <h1 class="scaffold-title">Station Home</h1>
    </div>
  `);

  router.navigate('station-home');
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
// Uses event delegation on root to survive the DOM replacement in mountShell.

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
