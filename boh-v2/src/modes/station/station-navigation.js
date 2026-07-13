// BOH OS v2 — Station Mode Navigation Controller
// Task 003C: registers five station routes and manages bottom navigation state.
// Task 003D: station-home uses createStationHome; user passed via options.
// No window writes. No storage. No Supabase. No browser history. No app-state import.

import { createBottomNavigation } from '../../components/navigation/bottom-navigation.js';
import { createStationHome } from './station-home.js';

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

  // ── Station Home renderer ─────────────────────────────────────────
  // The router contract: renderer() → HTML string → outlet.innerHTML.
  // createStationHome returns a DOM element; we serialize it to string.
  // Dynamic values (user.name, defaultStation) were set via textContent
  // inside the component, so they are safe in the serialized output.
  //
  // The onOpenToday callback is lost when innerHTML is injected.
  // We rewire it via event delegation on the shell element (.app-shell),
  // which is mountElement.parentElement and is available at setup time.
  // Delegation survives repeated outlet re-renders.

  router.register('station-home', () => {
    const wrapper = document.createElement('div');
    wrapper.appendChild(
      createStationHome({
        user,
        translate,
        onOpenToday: () => {},   // no-op: interaction handled by delegation below
      })
    );
    return wrapper.innerHTML;
  });

  // ── Delegated listener for Open Today ────────────────────────────
  // Attached once to the shell — survives router re-renders of the outlet.
  // The shell is mountElement.parentElement (div.app-shell).
  const shell = mountElement.parentElement;
  if (shell) {
    shell.addEventListener('click', (e) => {
      const btn = e.target.closest('.station-home__open-today');
      if (btn && !btn.disabled) {
        handleSelect('prep');
      }
    });
  }

  // ── Remaining placeholder routes ──────────────────────────────────
  router.register('station-prep',     () => scaffoldPage(translate('nav.prep')));
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
