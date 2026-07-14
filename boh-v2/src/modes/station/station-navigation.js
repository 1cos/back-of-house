// BOH OS v2 — Station Mode Navigation Controller
// Task 003C: registers five station routes and manages bottom navigation state.
// Task 003D: station-home uses createStationHome; user passed via options.
// Task 003E: station-home renderer returns HTMLElement directly (DOM-first router).
// Task 004B: station-prep uses createStationPrep with real service.
// Task 004D: station-prep receives fetchPrepSuggestions for suggestion merging.
// Task 004K: station-prep receives fetchTodayPrepLogs for today's production log display.
// Task 004M: station-prep receives startPrepTask and currentUser for Start action.
// Task 004Q: station-prep receives completePrepTask for Complete action.
// Task 004S: station-prep receives fetchRecentPrepCounts as fetchCounts for physical count display.
// Task 004V: station-prep receives savePrepCount as saveCount for physical count write.
// Task 004X: station-prep receives reconcilePrepCount as reconcileCount for post-count reconciliation.
// No window writes. No storage. No Supabase. No browser history. No app-state import.

import { createBottomNavigation } from '../../components/navigation/bottom-navigation.js';
import { createStationHome } from './station-home.js';
import { createStationPrep } from './station-prep.js';
import { fetchStationPrepTasks } from '../../services/station-prep-service.js';
import { fetchPrepSuggestions } from '../../services/prep-suggestion-service.js';
import { fetchTodayPrepLogs } from '../../services/prep-log-service.js';
import { fetchRecentPrepCounts } from '../../services/prep-count-service.js';
import { savePrepCount } from '../../services/prep-count-write-service.js';
import { reconcilePrepCount } from '../../services/prep-count-reconciler-service.js';
import { startPrepTask } from '../../services/prep-start-service.js';
import { completePrepTask } from '../../services/prep-complete-service.js';

// ── Route map ─────────────────────────────────────────────────────────

const ROUTE_MAP = {
  home:     'station-home',
  prep:     'station-prep',
  recipes:  'station-recipes',
  chat:     'station-chat',
  schedule: 'station-schedule',
};

// ── Navigation items ──────────────────────────────────────────────────

function buildItems(translate) {
  return [
    { id: 'home',     label: translate('nav.home'),     icon: '\u2302', disabled: false },
    { id: 'prep',     label: translate('nav.prep'),     icon: '\u29d6', disabled: false },
    { id: 'recipes',  label: translate('nav.recipes'),  icon: '\u2318', disabled: false },
    { id: 'chat',     label: translate('nav.chat'),     icon: '\u2709', disabled: false },
    { id: 'schedule', label: translate('nav.schedule'), icon: '\u25a6', disabled: false },
  ];
}

// ── Placeholder renderer ──────────────────────────────────────────────

function scaffoldPage(label) {
  const escaped = label
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<div class="scaffold-card"><h1 class="scaffold-title">${escaped}</h1></div>`;
}

// ── Navigation render ─────────────────────────────────────────────────

function renderNav({ mountElement, items, activeItem, onSelect, translate }) {
  mountElement.innerHTML = '';
  const nav = createBottomNavigation({
    items,
    activeItem,
    navLabel: translate('nav.primary'),
    onSelect,
  });
  mountElement.appendChild(nav);
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Sets up Station Mode navigation: registers routes, mounts the bottom
 * navigation, and manages active state.
 *
 * @param {{
 *   router:       { register: Function, navigate: Function },
 *   mountElement: HTMLElement,
 *   translate:    (key: string) => string,
 *   user:         { name?: string, defaultStation?: string }
 * }} options
 * @returns {{ currentItem: () => string }}
 */
export function setupStationNavigation({ router, mountElement, translate, user }) {
  // ── Guards ─────────────────────────────────────────────────────────
  if (!router || typeof router.register !== 'function' || typeof router.navigate !== 'function') {
    throw new Error('setupStationNavigation: router must be the BOH OS router object.');
  }
  if (!(mountElement instanceof Element)) {
    throw new Error('setupStationNavigation: mountElement must be a DOM element.');
  }
  if (typeof translate !== 'function') {
    throw new Error('setupStationNavigation: translate must be a function.');
  }

  // ── Active state ───────────────────────────────────────────────────
  let _activeItem = 'home';
  const items = buildItems(translate);

  // ── Select handler ─────────────────────────────────────────────────
  function handleSelect(id) {
    const routeName = ROUTE_MAP[id];
    if (!routeName) return;

    const navigated = router.navigate(routeName);

    if (navigated) {
      _activeItem = id;
      renderNav({ mountElement, items, activeItem: _activeItem, onSelect: handleSelect, translate });
    }
  }

  // ── Register routes ────────────────────────────────────────────────

  // station-home: real Station Home (HTMLElement).
  router.register('station-home', () =>
    createStationHome({
      user,
      translate,
      onOpenToday: () => handleSelect('prep'),
    })
  );

  // station-prep: real Prep page (HTMLElement).
  // user.defaultStation may be null/undefined — createStationPrep handles it.
  router.register('station-prep', () =>
    createStationPrep({
      stationName:      user.defaultStation ?? null,
      translate,
      fetchTasks:       fetchStationPrepTasks,
      fetchSuggestions: fetchPrepSuggestions,
      fetchLogs:        fetchTodayPrepLogs,
      fetchCounts:      fetchRecentPrepCounts,
      startTask:        startPrepTask,
      completeTask:     completePrepTask,
      saveCount:        savePrepCount,
      reconcileCount:   reconcilePrepCount,
      currentUser:      user,
    })
  );

  router.register('station-recipes',  () => scaffoldPage(translate('nav.recipes')));
  router.register('station-chat',     () => scaffoldPage(translate('nav.chat')));
  router.register('station-schedule', () => scaffoldPage(translate('nav.schedule')));

  // ── Initial navigation render ─────────────────────────────────────
  renderNav({ mountElement, items, activeItem: _activeItem, onSelect: handleSelect, translate });

  // ── Public interface ──────────────────────────────────────────────
  return {
    currentItem() {
      return _activeItem;
    },
  };
}

