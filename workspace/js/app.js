// BOH OS Workspace — App Bootstrap
// Orchestrates shell: top bar, tab bar, workspace area, role switcher.
// ──────────────────────────────────────────────────────────────────────────────

import { t, setLang, getLang, applyTranslations } from '../i18n/i18n.js';
import { can, getRole, setRole, ROLES } from '../permissions/permissions.js';
import { initTabs, getTabs, getActiveTab, openTab,
         closeTab, activateTab, saveScroll, getScroll } from './tabs.js';
import { PAGES, showYesChef } from './pages.js';

/* ── DOM refs (set in init) ─────────────────────────────────────────────── */
let $topbar, $tabbar, $workspace;

/* ── Init ────────────────────────────────────────────────────────────────── */
export function init() {
  $topbar   = document.getElementById('ws-topbar');
  $tabbar   = document.getElementById('ws-tabbar');
  $workspace = document.getElementById('ws-workspace');

  // Tabs
  initTabs(renderShell);

  // Listen for tab/lang/role changes
  document.addEventListener('ws:tabschange',  () => renderShell());
  document.addEventListener('ws:langchange',  () => renderShell());
  document.addEventListener('ws:rolechange',  () => renderShell());

  // First render
  renderShell();
}

/* ── Shell render ────────────────────────────────────────────────────────── */
function renderShell() {
  renderTopBar();
  renderTabBar();
  renderWorkspace();
}

/* ── Top bar ─────────────────────────────────────────────────────────────── */
function renderTopBar() {
  const lang = getLang();
  const role = getRole();

  $topbar.innerHTML = `
    <div class="topbar-left">
      <span class="topbar-logo">BOH OS</span>
      <span class="topbar-tagline">Workspace</span>
    </div>

    <div class="topbar-center">
      <div class="topbar-search">
        <span class="search-icon">⌕</span>
        <span class="search-placeholder">${t('topbar.search')}</span>
      </div>
    </div>

    <div class="topbar-right">
      <!-- Language switcher -->
      <div class="lang-switcher">
        ${['it','en','es'].map(l => `
          <button class="lang-btn ${l === lang ? 'active' : ''}"
                  data-lang="${l}">${l.toUpperCase()}</button>
        `).join('')}
      </div>

      <!-- Role switcher (demo) -->
      <div class="role-switcher">
        <span class="role-label">${t('role.label')}:</span>
        <select class="role-select" id="role-select">
          ${ROLES.map(r => `
            <option value="${r}" ${r === role ? 'selected' : ''}>
              ${t(`role.${r}`)}
            </option>
          `).join('')}
        </select>
      </div>

      <!-- Demo badge -->
      <span class="demo-badge">DEMO</span>
    </div>
  `;

  // Lang buttons
  $topbar.querySelectorAll('[data-lang]').forEach(btn => {
    btn.addEventListener('click', () => setLang(btn.dataset.lang));
  });

  // Role select
  $topbar.querySelector('#role-select')?.addEventListener('change', e => {
    setRole(e.target.value);
  });
}

/* ── Tab bar ─────────────────────────────────────────────────────────────── */
function renderTabBar() {
  const tabs   = getTabs();
  const active = getActiveTab();

  $tabbar.innerHTML = `
    <div class="tabbar-inner" id="tabbar-inner">
      ${tabs.map(tab => `
        <div class="ws-tab ${tab.id === active?.id ? 'active' : ''}"
             data-tab-id="${tab.id}" role="tab"
             aria-selected="${tab.id === active?.id}">
          <span class="tab-icon">${tabIcon(tab.type)}</span>
          <span class="tab-title">${tab.title}</span>
          ${tab.type !== 'home' ? `
            <button class="tab-close" data-close-tab="${tab.id}"
                    title="${t('btn.close')}">✕</button>
          ` : ''}
        </div>
      `).join('')}

      <button class="tab-new-btn" id="btn-new-tab" title="${t('topbar.new_tab')}">
        +
      </button>
    </div>
  `;

  // Activate
  $tabbar.querySelectorAll('[data-tab-id]').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('[data-close-tab]')) return;
      activateTab(el.dataset.tabId);
    });
  });

  // Close
  $tabbar.querySelectorAll('[data-close-tab]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      closeTab(btn.dataset.closeTab);
    });
  });

  // New tab: open Home if not already there, else show picker
  $tabbar.querySelector('#btn-new-tab')?.addEventListener('click', () => {
    openTab('home', t('tab.home'), {});
  });

  // Scroll active tab into view
  requestAnimationFrame(() => {
    const activeEl = $tabbar.querySelector('.ws-tab.active');
    activeEl?.scrollIntoView({ behavior:'smooth', inline:'nearest', block:'nearest' });
  });
}

/* ── Workspace ───────────────────────────────────────────────────────────── */
function renderWorkspace() {
  const tab = getActiveTab();
  if (!tab) {
    $workspace.innerHTML = `<div class="ws-empty">Nessuna pagina aperta.</div>`;
    return;
  }

  // Save scroll of currently rendered tab before switching
  const prev = $workspace.dataset.tabId;
  if (prev && prev !== tab.id) {
    saveScroll(prev, $workspace.scrollTop);
  }

  const Page = PAGES[tab.type];
  if (!Page) {
    $workspace.innerHTML = `<div class="ws-empty">Pagina non trovata: ${tab.type}</div>`;
    return;
  }

  $workspace.dataset.tabId = tab.id;
  $workspace.innerHTML = Page.render(tab.params ?? {});
  applyTranslations($workspace);

  // Restore scroll
  const savedScroll = getScroll(tab.id);
  $workspace.scrollTop = savedScroll;

  // After-render hooks
  Page.afterRender?.($workspace, tab.params ?? {});

  // Save scroll on scroll
  $workspace.onscroll = () => saveScroll(tab.id, $workspace.scrollTop);
}

/* ── Utilities ───────────────────────────────────────────────────────────── */
function tabIcon(type) {
  return { home:'⌂', bot_center:'🤖', recipe:'📋',
           inventory:'📦', daily_journal:'📓', pos:'📊' }[type] ?? '📄';
}

// Expose openTab for inline onclick (used from pages)
window._wsOpenTab = openTab;
