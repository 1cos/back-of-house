// BOH OS v2 — app bootstrap
// Task 002D: session state via app-state.js.
// No global state. No window writes. No storage APIs.

import { t } from './core/i18n.js';
import { checkSupabaseConnection } from './core/supabase-client.js';
import { authenticateWithPin } from './services/auth-service.js';
import { setCurrentUser, getCurrentUser } from './core/app-state.js';

const root = document.getElementById('app');

if (!root) {
  throw new Error(
    'BOH OS v2: mount element #app not found. Check index.html.'
  );
}

// ── Render shell immediately ─────────────────────────────────────────

root.innerHTML = `
  <header class="app-header">
    <span class="app-name">${t('app.name')}</span>
    <span class="app-mode">${t('mode.station')}</span>
  </header>
  <main class="app-main">
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
  </main>
`;

// ── DOM references ───────────────────────────────────────────────────

const pinInput  = root.querySelector('#pin-input');
const pinSubmit = root.querySelector('#pin-submit');
const errorEl   = root.querySelector('.login-error');
const dot       = root.querySelector('.status-dot');
const loginCard = root.querySelector('.login-card');

// Track in-flight submission to prevent duplicates.
let submitting = false;

// ── Connection diagnostic (non-blocking) ─────────────────────────────

checkSupabaseConnection().then((result) => {
  if (result.ok) {
    dot.dataset.status = 'ready';
    dot.setAttribute('aria-label', 'Data connection ready');
  } else {
    dot.dataset.status = 'unavailable';
    dot.setAttribute('aria-label', 'Data connection unavailable');
  }
});

// ── PIN submission logic ─────────────────────────────────────────────

function setSubmitting(active) {
  submitting = active;
  pinInput.disabled  = active;
  pinSubmit.disabled = active;
  pinSubmit.textContent = active ? t('auth.checking') : t('auth.continue');
}

function showError(message) {
  errorEl.textContent = message;
  pinInput.value = '';
  pinInput.focus();
}

function clearError() {
  errorEl.textContent = '';
}

async function handleSubmit() {
  if (submitting) return;

  const pin = pinInput.value;

  clearError();
  setSubmitting(true);

  const result = await authenticateWithPin(pin);

  if (result.ok) {
    // Store user in app state — available to all modules via getCurrentUser().
    setCurrentUser(result.user);

    // Read name from state, not from the login result directly.
    const user = getCurrentUser();
    const welcomeText = t('auth.welcome').replace('{name}', user.name);

    loginCard.innerHTML = `
      <p class="auth-welcome">${welcomeText}</p>
      <p class="auth-ready">${t('auth.ready')}</p>
    `;
    return;
  }

  setSubmitting(false);

  if (result.reason === 'USER_NOT_FOUND' || result.reason === 'INVALID_PIN') {
    showError(t('auth.invalid_pin'));
  } else {
    showError(t('auth.connection_error'));
  }
}

// ── Event listeners ──────────────────────────────────────────────────

pinSubmit.addEventListener('click', handleSubmit);

pinInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleSubmit();
});

// Auto-submit when 4th digit is entered.
pinInput.addEventListener('input', () => {
  if (pinInput.value.length === 4) handleSubmit();
});
