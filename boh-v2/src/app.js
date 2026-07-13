// BOH OS v2 — app bootstrap
// Task 002A: render static scaffold only.
// No global state. No window writes. No data fetching.

import { t } from './core/i18n.js';

const root = document.getElementById('app');

if (!root) {
  throw new Error(
    'BOH OS v2: mount element #app not found. Check index.html.'
  );
}

root.innerHTML = `
  <header class="app-header">
    <span class="app-name">${t('app.name')}</span>
    <span class="app-mode">${t('mode.station')}</span>
  </header>
  <main class="app-main">
    <div class="scaffold-card">
      <h1 class="scaffold-title">${t('foundation.title')}</h1>
      <p class="scaffold-body">${t('foundation.body')}</p>
    </div>
  </main>
`;
