// BOH OS v2 — app bootstrap
// Task 002B: adds Supabase connection diagnostic.
// No global state. No window writes.

import { t } from './core/i18n.js';
import { checkSupabaseConnection } from './core/supabase-client.js';

const root = document.getElementById('app');

if (!root) {
  throw new Error(
    'BOH OS v2: mount element #app not found. Check index.html.'
  );
}

// Render scaffold immediately — diagnostic runs after.
root.innerHTML = `
  <header class="app-header">
    <span class="app-name">${t('app.name')}</span>
    <span class="app-mode">${t('mode.station')}</span>
  </header>
  <main class="app-main">
    <div class="scaffold-card">
      <h1 class="scaffold-title">${t('foundation.title')}</h1>
      <p class="scaffold-body">${t('foundation.body')}</p>
      <span
        class="status-dot"
        data-status="pending"
        aria-label="Checking data connection"
        role="status"
      ></span>
    </div>
  </main>
`;

// Run diagnostic without blocking render.
const dot = root.querySelector('.status-dot');

checkSupabaseConnection().then((result) => {
  if (result.ok) {
    dot.dataset.status = 'ready';
    dot.setAttribute('aria-label', 'Data connection ready');
  } else {
    dot.dataset.status = 'unavailable';
    dot.setAttribute('aria-label', 'Data connection unavailable');
  }
});
