// BOH OS v2 — Station Mode Navigation Controller
// Task 003C: registers five station routes and manages bottom navigation state.
// Task 003D: station-home uses createStationHome; user passed via options.
// Task 003E: station-home renderer returns HTMLElement directly (DOM-first router).
// Task 004B: station-prep uses createStationPrep with real service.
// Task 004D: station-prep receives fetchPrepSuggestions for suggestion merging.
// Task 004K: station-prep receives fetchTodayPrepLogs for today's production log display.
// Task 004M: station-prep receives startTask and currentUser for Start action.
// Task OEE-B: startTask routes through rpc_oee_record_prep_start (prep-start-rpc-service.js).
// Task 004Q: station-prep receives completeTask for Complete action.
// Task OEE-C-B: completeTask routes through rpc_oee_record_prep_completion (prep-complete-rpc-service.js).
// Task 004S: station-prep receives fetchRecentPrepCounts as fetchCounts for physical count display.
// Task OEE-D-B: saveCount routes through rpc_oee_record_stock_count (prep-count-rpc-service.js).
// Task 004X: station-prep receives reconcilePrepCount as reconcileCount for post-count reconciliation.
// Task 004AF: station-prep receives passPrepToShift as passTask for WIP handoff.
// Task 004AI: admin/executive-chef role detection, session-local station selection,
//             fetchAvailableStations injected into Station Home and Prep.
// WS-04: openWorkspacePanel injected optionally from app.js so station selection
//         opens a workspace panel without importing WorkspaceManager directly.
// No window writes. No storage. No Supabase. No browser history. No app-state import.

import { createBottomNavigation } from '../../components/navigation/bottom-navigation.js';
import { createStationHome } from './station-home.js';
import { createStationPrep } from './station-prep.js';
import { fetchStationPrepTasks } from '../../services/station-prep-service.js';
import { fetchPrepSuggestions } from '../../services/prep-suggestion-service.js';
import { fetchTodayPrepLogs } from '../../services/prep-log-service.js';
import { fetchRecentPrepCounts } from '../../services/prep-count-service.js';
import { savePrepCountRpc } from '../../services/prep-count-rpc-service.js';
import { reconcilePrepCount } from '../../services/prep-count-reconciler-service.js';
import { startPrepTaskRpc } from '../../services/prep-start-rpc-service.js';
import { completePrepTaskRpc } from '../../services/prep-complete-rpc-service.js';
import { passPrepToShift } from '../../services/prep-pass-service.js';
import { fetchAvailableStations } from '../../services/station-list-service.js';

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

// ── Role normalization ────────────────────────────────────────────────

/**
 * Normalizes a raw user role string to a canonical snake_case value.
 * Returns null for any invalid / missing input.
 *
 * Examples:
 *   "Admin"           → "admin"
 *   "Executive Chef"  → "executive_chef"
 *   "executive-chef"  → "executive_chef"
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
function normalizeRole(raw) {
  if (typeof raw !== 'string') return null;
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

const CHOOSER_ROLES = new Set(['admin', 'executive_chef']);

// ── Public API ────────────────────────────────────────────────────────

/**
 * Sets up Station Mode navigation: registers routes, mounts the bottom
 * navigation, and manages active state.
 *
 * @param {{
 *   router:              { register: Function, navigate: Function },
 *   mountElement:        HTMLElement,
 *   translate:           (key: string) => string,
 *   user:                { name?: string, defaultStation?: string, role?: string },
 *   openWorkspacePanel?: (type: string, context: object) => void,
 * }} options
 * @returns {{ currentItem: () => string }}
 */
export function setupStationNavigation({ router, mountElement, translate, user, openWorkspacePanel }) {
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

  // ── Role eligibility ───────────────────────────────────────────────
  const role = normalizeRole(user.role ?? null);
  const canChooseStation = CHOOSER_ROLES.has(role);

  // ── Session-local selected station ────────────────────────────────
  // Initial value: trimmed defaultStation when present, otherwise null.
  // Never written to user, storage, URL, or window.
  const defaultStation =
    (typeof user.defaultStation === 'string' && user.defaultStation.trim().length > 0)
      ? user.defaultStation.trim()
      : null;

  let _selectedStation = defaultStation;

  // Returns the effective station for the current session.
  function effectiveStation() {
    return _selectedStation;
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

  // ── Station selection callback ─────────────────────────────────────
  // Called by Station Home or Station Prep when an eligible user picks a station.
  // WS-04: when openWorkspacePanel is provided, station selection opens a workspace
  // panel instead of (or in addition to) navigating the legacy router.
  // The legacy router navigate is preserved so the bottom-bar Prep path still works.
  function handleStationSelect(stationName) {
    if (typeof stationName !== 'string' || stationName.trim().length === 0) return;
    _selectedStation = stationName.trim();

    if (typeof openWorkspacePanel === 'function') {
      // WS-04 path: open/activate the station-prep workspace panel.
      // The workspace surface switch is handled by the onPanelActivated bridge
      // in app.js — no surface logic here.
      openWorkspacePanel('station-prep', { stationName: _selectedStation });
      // Do not navigate the legacy router in this path — the workspace outlet
      // owns station panels in WS-04.
      return;
    }

    // Legacy path: openWorkspacePanel not provided (unchanged behavior).
    const navigated = router.navigate('station-prep');
    if (navigated) {
      _activeItem = 'prep';
      renderNav({ mountElement, items, activeItem: _activeItem, onSelect: handleSelect, translate });
    }
  }

  // ── Register routes ────────────────────────────────────────────────

  // station-home: real Station Home (HTMLElement).
  router.register('station-home', () =>
    createStationHome({
      user,
      stationName:      effectiveStation(),
      canChooseStation,
      translate,
      fetchStations:    fetchAvailableStations,
      onStationSelect:  handleStationSelect,
      onOpenToday:      () => handleSelect('prep'),
    })
  );

  // station-prep: real Prep page (HTMLElement).
  router.register('station-prep', () =>
    createStationPrep({
      stationName:      effectiveStation(),
      canChooseStation,
      translate,
      fetchStations:    fetchAvailableStations,
      onStationSelect:  handleStationSelect,
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
