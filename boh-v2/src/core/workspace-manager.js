// BOH OS v2 — WorkspaceManager
// WS-02: implements the Workspace Engine v1.1 contract.
// Spec: BOH_OS_V2_WORKSPACE_ENGINE.md v1.1
//
// All state is instance-scoped inside createWorkspaceManager().
// No module-scope variables — multiple instances are safe.
//
// Rules enforced:
//   - Home ID is 'panel-home'. Home always exists. Home cannot be closed.
//   - Home is always first (index 0) in the registry.
//   - Maximum 6 panels (HOME + 5 content panels).
//   - Duplicate type+canonicalKey activates the existing panel.
//   - Close fallback: left neighbor in registry, then Home. No history tracking.
//   - Renderers MUST be synchronous and return HTMLElement immediately.
//   - Unknown type → null return + console.error diagnostic.
//   - destroy() resets ALL state: panels, renderers, counter, DOM.
//   - No Supabase. No app-state. No router awareness.

import { renderPanelStrip } from '../components/workspace/panel-strip.js';

const HOME_PANEL_ID = 'panel-home';
const HOME_PANEL_TYPE = 'home';
const MAX_PANELS = 6;

/**
 * Canonical deduplication key for a panel type + context.
 * Singletons (home, journal) key on type alone.
 * Station panels key on type + stationName.
 * Recipe panels key on type + recipeId.
 *
 * Panel IDs are never parsed — dedup uses registry lookup only.
 *
 * @param {string} type
 * @param {object} context
 * @returns {string}
 */
function dedupeKey(type, context) {
  switch (type) {
    case 'home':
    case 'journal':
    case 'schedule':
      return type;
    case 'station-prep':
    case 'station-recipes':
      return `${type}::${context.stationName ?? ''}`;
    case 'recipe-detail':
      return `${type}::${context.recipeId ?? ''}`;
    default:
      return `${type}::${JSON.stringify(context)}`;
  }
}

/**
 * Creates a WorkspaceManager instance.
 *
 * @param {{
 *   outlet:         HTMLElement,  // panel content target
 *   panelStripMount: HTMLElement, // strip container
 * }} options
 * @returns {WorkspaceManager}
 */
export function createWorkspaceManager({ outlet, panelStripMount }) {
  // ── Instance-scoped state ──────────────────────────────────────────
  // No module-level variables. All state lives here.

  /** @type {Array<{ id: string, type: string, title: string, context: object, dedupeKey: string }>} */
  let _panels = [];

  /** @type {string | null} */
  let _activeId = null;

  /** @type {Record<string, (context: object) => HTMLElement>} */
  let _renderers = {};

  /** @type {number} */
  let _counter = 0;

  // ── Internal helpers ───────────────────────────────────────────────

  function _nextId(type) {
    _counter += 1;
    return `panel-${type}-${_counter}`;
  }

  function _findById(id) {
    return _panels.find(p => p.id === id) ?? null;
  }

  function _findByDedupeKey(key) {
    return _panels.find(p => p.dedupeKey === key) ?? null;
  }

  function _titleForType(type, context) {
    switch (type) {
      case 'home':           return 'Home';
      case 'station-prep':   return context.stationName ?? 'Station';
      case 'station-recipes':return `${context.stationName ?? 'Station'} Recipes`;
      case 'recipe-detail':  return context.recipeName   ?? 'Recipe';
      case 'journal':        return 'Journal';
      case 'schedule':       return 'Schedule';
      default:               return type;
    }
  }

  /** Re-renders the entire strip from current state. */
  function _renderStrip() {
    const atLimit = _panels.length >= MAX_PANELS;
    const el = renderPanelStrip({
      panels:     _panels,
      activeId:   _activeId,
      onActivate: (id) => workspaceManager.activatePanel(id),
      onClose:    (id) => workspaceManager.closePanel(id),
      onAdd:      () => {
        // Station Selector is wired in WS-04/WS-05.
        // No-op until then — the + button is present but unconnected.
      },
      atLimit,
    });

    // Replace-not-patch: entire strip is rebuilt on every change.
    panelStripMount.innerHTML = '';
    panelStripMount.appendChild(el);
  }

  /** Mounts a panel's DOM into the outlet, clearing any previous content. */
  function _mountPanel(panel) {
    const renderer = _renderers[panel.type];
    if (!renderer) {
      console.error(
        `WorkspaceManager: no renderer registered for type "${panel.type}". ` +
        `Register it with workspaceManager.registerRenderer() before openPanel().`
      );
      outlet.innerHTML = '';
      return;
    }

    const el = renderer(panel.context);

    if (!(el instanceof HTMLElement)) {
      console.error(
        `WorkspaceManager: renderer for type "${panel.type}" did not return ` +
        `an HTMLElement. Renderers MUST be synchronous and return HTMLElement ` +
        `immediately (Workspace Engine v1.1 §3.3 / R-21).`
      );
      outlet.innerHTML = '';
      return;
    }

    outlet.innerHTML = '';
    outlet.appendChild(el);
  }

  // ── Public API ─────────────────────────────────────────────────────

  const workspaceManager = {
    /**
     * Registers a renderer for the given panel type.
     * Always overwrites a previous registration — this is the mechanism
     * for replacing placeholder renderers with real implementations.
     *
     * @param {string} type
     * @param {(context: object) => HTMLElement} fn  MUST be synchronous.
     */
    registerRenderer(type, fn) {
      _renderers[type] = fn;
    },

    /**
     * Opens a panel of the given type with the given context.
     * If a panel with the same canonical key already exists, activates it.
     * If at the panel limit, shows the inline strip notification and returns null.
     * If the type has no registered renderer, returns null and logs an error.
     *
     * Home's fixed ID is always 'panel-home'.
     *
     * @param {string} type
     * @param {object} [context={}]
     * @returns {string | null}  panelId on success, null on failure
     */
    openPanel(type, context = {}) {
      const key = dedupeKey(type, context);

      // Deduplicate: if this exact panel already exists, activate it.
      const existing = _findByDedupeKey(key);
      if (existing) {
        workspaceManager.activatePanel(existing.id);
        return existing.id;
      }

      // Renderer must exist before we create the panel descriptor.
      if (!_renderers[type]) {
        console.error(
          `WorkspaceManager: no renderer registered for type "${type}". ` +
          `Call registerRenderer("${type}", fn) first.`
        );
        return null;
      }

      // Enforce panel limit.
      if (_panels.length >= MAX_PANELS) {
        // Strip already shows the inline notice via atLimit=true in _renderStrip.
        _renderStrip();
        return null;
      }

      // Build the panel descriptor.
      // Home always gets the fixed ID; all others get a generated ID.
      const id = (type === HOME_PANEL_TYPE) ? HOME_PANEL_ID : _nextId(type);

      const panel = {
        id,
        type,
        title:     _titleForType(type, context),
        context,
        dedupeKey: key,
      };

      _panels.push(panel);
      _activeId = id;

      _mountPanel(panel);
      _renderStrip();

      return id;
    },

    /**
     * Activates an existing panel by ID.
     * No-op if already active or if the ID is not in the registry.
     *
     * @param {string} panelId
     */
    activatePanel(panelId) {
      if (_activeId === panelId) return;

      const panel = _findById(panelId);
      if (!panel) return;

      _activeId = panelId;
      _mountPanel(panel);
      _renderStrip();
    },

    /**
     * Closes a panel and activates the left-neighbor fallback.
     * No-op for Home (Home cannot be closed).
     * No-op if the panelId is not in the registry.
     *
     * Fallback order:
     *   1. Left neighbor in the registry array (idx - 1).
     *   2. Home (always present, always index 0).
     *
     * @param {string} panelId
     */
    closePanel(panelId) {
      if (panelId === HOME_PANEL_ID) return;

      const idx = _panels.findIndex(p => p.id === panelId);
      if (idx === -1) return;

      // Select fallback BEFORE removing from registry.
      const fallback = _panels[idx - 1] ?? _panels[0];

      _panels.splice(idx, 1);

      // Activate fallback.
      _activeId = fallback.id;
      _mountPanel(fallback);
      _renderStrip();
    },

    /**
     * Returns the currently active PanelDescriptor, or null.
     *
     * @returns {{ id: string, type: string, title: string, context: object } | null}
     */
    currentPanel() {
      return _findById(_activeId);
    },

    /**
     * Destroys the WorkspaceManager.
     * Resets ALL instance state to initial values.
     * Clears outlet DOM and Panel Strip DOM.
     * Safe to call at any time. Safe to call createWorkspaceManager() again after.
     *
     * Per spec v1.1 §2.3 and R-17.
     */
    destroy() {
      // Clear DOM first.
      outlet.innerHTML = '';
      panelStripMount.innerHTML = '';

      // Reset all state — identical to pre-create() condition.
      _panels    = [];
      _activeId  = null;
      _renderers = {};
      _counter   = 0;
    },
  };

  return workspaceManager;
}
