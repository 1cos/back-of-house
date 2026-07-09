// BOH OS Workspace — Tab Manager
// Tabs are persisted in sessionStorage (survives refresh, cleared on window close).
// Each tab: { id, type, title, params, scrollTop }
// ──────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'ws_tabs';
const ACTIVE_KEY  = 'ws_active_tab';
const MAX_TABS    = 10;

let _tabs    = [];
let _activeId = null;
let _onChange = null; // callback registered by shell

/* ── Persistence ─────────────────────────────────────────────────────────── */

function save() {
  sessionStorage.setItem(STORAGE_KEY,  JSON.stringify(_tabs));
  sessionStorage.setItem(ACTIVE_KEY,   _activeId ?? '');
}

function load() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    _tabs = raw ? JSON.parse(raw) : [];
    _activeId = sessionStorage.getItem(ACTIVE_KEY) || null;
    // Validate: active must exist
    if (_activeId && !_tabs.find(t => t.id === _activeId)) _activeId = _tabs[0]?.id ?? null;
  } catch {
    _tabs = [];
    _activeId = null;
  }
}

/* ── Core API ────────────────────────────────────────────────────────────── */

/** Returns a copy of all open tabs */
export function getTabs() { return [..._tabs]; }

/** Returns the active tab object or null */
export function getActiveTab() { return _tabs.find(t => t.id === _activeId) ?? null; }

/**
 * Open a tab. If a tab with the same key exists, bring it to front.
 * @param {string} type     e.g. 'recipe', 'bot_center', 'home'
 * @param {string} title    Visible tab label (already translated)
 * @param {Object} params   Extra data the page component needs (id, name, etc.)
 * @returns {string}        The tab id
 */
export function openTab(type, title, params = {}) {
  // Deduplicate: same type + same primary key → focus existing
  const key = tabKey(type, params);
  const existing = _tabs.find(t => tabKey(t.type, t.params) === key);
  if (existing) {
    _activeId = existing.id;
    save();
    notify();
    return existing.id;
  }

  // Enforce max
  if (_tabs.length >= MAX_TABS) {
    // Close the oldest non-home tab
    const oldest = _tabs.find(t => t.type !== 'home');
    if (oldest) closeTab(oldest.id, false);
  }

  const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  _tabs.push({ id, type, title, params, scrollTop: 0 });
  _activeId = id;
  save();
  notify();
  return id;
}

/**
 * Close a tab. Activates the nearest remaining tab.
 * @param {string} id
 * @param {boolean} [andNotify=true]
 */
export function closeTab(id, andNotify = true) {
  const idx = _tabs.findIndex(t => t.id === id);
  if (idx === -1) return;

  // If closing the active tab, pick the next nearest
  if (_activeId === id) {
    const next = _tabs[idx + 1] ?? _tabs[idx - 1] ?? null;
    _activeId = next?.id ?? null;
  }

  _tabs.splice(idx, 1);
  save();
  if (andNotify) notify();
}

/** Bring a tab to front */
export function activateTab(id) {
  if (!_tabs.find(t => t.id === id)) return;
  _activeId = id;
  save();
  notify();
}

/** Save scroll position for a tab */
export function saveScroll(id, scrollTop) {
  const tab = _tabs.find(t => t.id === id);
  if (tab) { tab.scrollTop = scrollTop; save(); }
}

/** Get saved scroll for a tab */
export function getScroll(id) {
  return _tabs.find(t => t.id === id)?.scrollTop ?? 0;
}

/** Register a callback fired on every tab state change */
export function onChange(fn) { _onChange = fn; }

/* ── Init ────────────────────────────────────────────────────────────────── */

export function initTabs(onChangeFn) {
  _onChange = onChangeFn;
  load();
  if (_tabs.length === 0) {
    // First visit: open Home
    openTab('home', 'Home', {});
  }
}

/* ── Internals ───────────────────────────────────────────────────────────── */

function tabKey(type, params) {
  // home and bot_center are singletons; recipe/inventory are keyed by id
  switch (type) {
    case 'home':        return 'home';
    case 'bot_center':  return 'bot_center';
    case 'daily_journal': return 'daily_journal';
    case 'pos':         return 'pos';
    case 'recipe':      return `recipe:${params.id ?? params.name}`;
    case 'inventory':   return `inventory:${params.id ?? params.name}`;
    default:            return `${type}:${JSON.stringify(params)}`;
  }
}

function notify() {
  if (_onChange) _onChange({ tabs: getTabs(), activeId: _activeId });
  document.dispatchEvent(new CustomEvent('ws:tabschange', {
    detail: { tabs: getTabs(), activeId: _activeId }
  }));
}
