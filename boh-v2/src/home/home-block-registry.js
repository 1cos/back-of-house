// BOH OS v2 — Home Block Registry
// HOME-01: implements the Home Block Engine v1.1 registry architecture.
//
// Exports:
//   BLOCK_DEFINITIONS  — catalog metadata + permittedRoles (authoritative role gates)
//   BLOCK_FETCHERS     — one async function per block (only layer that calls Supabase)
//   BLOCK_RENDERERS    — { skeleton, content, error } per block (pure DOM renderers)
//   createBlock(blockId, deps) → BlockInstance | null
//
// Block modules register themselves by importing this file and calling:
//   BLOCK_DEFINITIONS[id] = { ... }
//   BLOCK_FETCHERS[id]    = async fn
//   BLOCK_RENDERERS[id]   = { skeleton, content, error }
//
// home-panel.js imports all block modules (triggering side-effect registration),
// then calls createBlock() for each permitted block.
//
// NO Supabase import here — Supabase lives inside BLOCK_FETCHERS implementations.

export const BLOCK_FETCH_TIMEOUT_MS = 8000;

// ── Three registries, one per concern ─────────────────────────────────

/** @type {Record<string, BlockDefinition>} */
export const BLOCK_DEFINITIONS = {};

/** @type {Record<string, (user: object, signal?: AbortSignal) => Promise<BlockRawData>>} */
export const BLOCK_FETCHERS = {};

/**
 * @type {Record<string, {
 *   skeleton: () => HTMLElement,
 *   content:  (data: object, deps: object) => HTMLElement,
 *   error:    (deps: object) => HTMLElement,
 * }>}
 */
export const BLOCK_RENDERERS = {};

// ── Universal block factory ────────────────────────────────────────────
// Implements the full Block Engine v1.1 lifecycle contract.
// Called only by home-panel.js — never by block modules themselves.

/**
 * @param {string} blockId
 * @param {object} deps   — assembled by home-panel.js per BL-spec §9.2
 * @returns {{ root: HTMLElement, destroy: () => void, refresh: () => void } | null}
 */
export function createBlock(blockId, deps) {
  const definition = BLOCK_DEFINITIONS[blockId];
  const renderer   = BLOCK_RENDERERS[blockId];

  if (!definition || !renderer) {
    console.error('[Home] createBlock: unknown block type:', blockId);
    return null;
  }

  // BL-09: root carries structural classes at all times.
  const root = renderer.skeleton();
  root.dataset.blockId = blockId;
  root.classList.add('home-block', `home-block--${blockId}`, 'block--loading');

  // Lifecycle flags
  let destroyed       = false;
  let fetchInProgress = false;
  let _lastUrgencyScore = 0; // BL-14: init to 0

  // AbortController — v1: signal unused but slot is wired for future.
  let controller = new AbortController();

  // ── Internal fetch ───────────────────────────────────────────────
  function _fetch() {
    if (destroyed) return;
    fetchInProgress = true;

    Promise.race([
      deps.fetchService(deps.user, controller.signal),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), definition.timeout ?? BLOCK_FETCH_TIMEOUT_MS)
      ),
    ])
      .then((result) => {
        fetchInProgress = false;
        if (destroyed || !root.isConnected) return; // BL-03 guard

        if (!result.hasContent) {
          // EMPTY path — BL-08
          _lastUrgencyScore = 0;
          deps.onBlockReady(blockId, { hasContent: false, urgencyScore: 0 }); // BL-19: exactly once
          if (root.isConnected) root.remove();
          return;
        }

        // LOADED path
        _lastUrgencyScore = result.urgencyScore;
        root.innerHTML = '';
        root.appendChild(renderer.content(result.data, deps));
        root.classList.replace('block--loading', 'block--loaded');
        deps.onBlockReady(blockId, { hasContent: true, urgencyScore: result.urgencyScore }); // BL-19
      })
      .catch(() => {
        fetchInProgress = false;
        if (destroyed || !root.isConnected) return; // BL-03 guard

        // ERROR path — BL-15: counts as hasContent: true
        _lastUrgencyScore = 0;
        root.innerHTML = '';
        const errEl = renderer.error(deps);
        errEl.setAttribute('role', 'alert'); // BL-07 / Appendix A4
        root.appendChild(errEl);
        root.classList.replace('block--loading', 'block--error');
        deps.onBlockReady(blockId, { hasContent: true, urgencyScore: 0 }); // BL-19
      });
  }

  // Start immediately
  _fetch();

  // ── Public BlockInstance ─────────────────────────────────────────
  return {
    root,

    // BL-04: safe at any stage, idempotent
    destroy() {
      destroyed       = true;
      fetchInProgress = false; // BL-04: tidy before abort
      controller.abort();
    },

    // BL-11: no-op when destroyed or fetch in progress
    refresh() {
      if (destroyed || fetchInProgress) return;
      deps.blockCache.invalidate(blockId); // BL-16
      root.innerHTML = '';
      root.appendChild(renderer.skeleton());
      root.classList.replace('block--loaded', 'block--loading');
      root.classList.replace('block--error',  'block--loading');
      controller = new AbortController();
      _fetch();
    },
  };
}
