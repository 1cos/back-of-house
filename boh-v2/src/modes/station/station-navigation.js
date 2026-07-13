// BOH OS v2 — Station Mode Navigation Controller
// Task 003C: registers five station routes and manages bottom navigation state.
// No window writes. No storage. No Supabase. No browser history.

import { createBottomNavigation } from '../../components/navigation/bottom-navigation.js';

// ── Route map ─────────────────────────────────────────────────────────
// Maps each navigation item ID to its registered router route name.

const ROUTE_MAP = {
  home:     'station-home',
  prep:     'station-prep',
  recipes:  'station-recipes',
  chat:     'station-chat',
  schedule: 'station-schedule',
};

// ── Navigation items ──────────────────────────────────────────────────
// All five items are enabled. Icons match the existing set from 003B.
// Labels come from the translate function supplied by the caller.

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
// Returns an HTML string matching the existing scaffold-card style.
// Visible text comes from translate().

function scaffoldPage(label) {
  // label is already a translated string — inserted as text content
  // via the scaffold-title element. The router contract expects an HTML string;
  // the text is escaped by setting it through a temporary element.
  const escaped = label
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<div class="scaffold-card"><h1 class="scaffold-title">${escaped}</h1></div>`;
}

// ── Navigation render ─────────────────────────────────────────────────
// Clears mountElement and appends exactly one Bottom Navigation.

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
 *   translate:    (key: string) => string
 * }} options
 * @returns {{ currentItem: () => string }}
 */
export function setupStationNavigation({ router, mountElement, translate }) {
  // ── Guard: fail fast for developer errors ─────────────────────────
  if (!router || typeof router.register !== 'function' || typeof router.navigate !== 'function') {
    throw new Error('setupStationNavigation: router must be the BOH OS router object.');
  }
  if (!(mountElement instanceof Element)) {
    throw new Error('setupStationNavigation: mountElement must be a DOM element.');
  }
  if (typeof translate !== 'function') {
    throw new Error('setupStationNavigation: translate must be a function.');
  }

  // ── Register routes ────────────────────────────────────────────────
  router.register('station-home',     () => scaffoldPage(translate('nav.home')));
  router.register('station-prep',     () => scaffoldPage(translate('nav.prep')));
  router.register('station-recipes',  () => scaffoldPage(translate('nav.recipes')));
  router.register('station-chat',     () => scaffoldPage(translate('nav.chat')));
  router.register('station-schedule', () => scaffoldPage(translate('nav.schedule')));

  // ── Active state ───────────────────────────────────────────────────
  let _activeItem = 'home';

  const items = buildItems(translate);

  // ── Select handler ─────────────────────────────────────────────────
  // Called only for enabled items (enforced by the component).
  // Maps item ID → route, navigates, updates active state on success.

  function handleSelect(id) {
    const routeName = ROUTE_MAP[id];
    if (!routeName) return;

    const navigated = router.navigate(routeName);

    if (navigated) {
      _activeItem = id;
      // Rerender the navigation with updated active item.
      renderNav({ mountElement, items, activeItem: _activeItem, onSelect: handleSelect, translate });
    }
    // If navigation returns false, keep previous active item and do not rerender.
  }

  // ── Initial render ─────────────────────────────────────────────────
  renderNav({ mountElement, items, activeItem: _activeItem, onSelect: handleSelect, translate });

  // ── Public interface ───────────────────────────────────────────────
  return {
    currentItem() {
      return _activeItem;
    },
  };
}
