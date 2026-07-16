// BOH OS v2 — Home Panel Renderer
// HOME-01: implements the Block Engine v1.1 home panel renderer contract.
//
// Called by WorkspaceManager as the 'home' renderer — must return HTMLElement
// synchronously (Workspace Engine v1.1 R-21).
//
// Responsibilities:
//   1. Determine which blocks are permitted for this user.
//   2. Assemble deps per block (fetch function, openPanel, translate, can, cache, user).
//   3. Call createBlock() for each permitted block, mount skeletons immediately.
//   4. Track onBlockReady settlement — apply CSS order after all blocks settle.
//   5. Expose destroy() so app.js can clean up on logout.
//
// NO Supabase import here — Supabase is inside block fetchers only.
// NO app-state import — user arrives via argument.

import { BLOCK_DEFINITIONS, BLOCK_FETCHERS, BLOCK_RENDERERS, createBlock } from './home-block-registry.js';

// ── Import block modules (side-effect: registers definitions/fetchers/renderers)
import './blocks/greeting.js';
import './blocks/station-focus.js';
import './blocks/station-overview.js';

// ── In-memory block cache (session-scoped, per BL-spec §7) ────────────
function _createBlockCache() {
  const _store = {};
  return {
    get(blockId) {
      const entry = _store[blockId];
      if (!entry) return null;
      return entry;
    },
    set(blockId, data) {
      _store[blockId] = { data, fetchedAt: Date.now() };
    },
    invalidate(blockId) {
      delete _store[blockId];
    },
  };
}

// ── Role preset: permitted block IDs per user ─────────────────────────
// Reads BLOCK_DEFINITIONS.permittedRoles (BL-21 authoritative gate).

/**
 * Returns ordered list of block IDs permitted for this user,
 * based on BLOCK_DEFINITIONS.permittedRoles.
 *
 * HOME-01 composition:
 *   station user (staff/supervisor with defaultStation):
 *     1. greeting  2. station_focus
 *   admin/executive_chef (view_executive_mode):
 *     1. greeting  2. station_overview
 *
 * @param {object} user
 * @param {(perm: string, user: object) => boolean} canFn
 * @returns {string[]}
 */
function _permittedBlockIds(user, canFn) {
  const role = (user.role ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const isExecutive = canFn('view_executive_mode', user);
  const hasStation  = typeof user.defaultStation === 'string' && user.defaultStation.trim().length > 0;
  const isStationUser = !isExecutive && hasStation;

  // Build ordered catalog for this user type
  let catalog;
  if (isStationUser) {
    catalog = ['greeting', 'station_focus'];
  } else {
    // admin, executive_chef, supervisor without a defaultStation
    catalog = ['greeting', 'station_overview'];
  }

  // Filter: only include blocks where this user's role is in permittedRoles
  return catalog.filter((blockId) => {
    const def = BLOCK_DEFINITIONS[blockId];
    if (!def) return false;
    return def.permittedRoles.has(role);
  });
}

// ── Public: createHomePanel ────────────────────────────────────────────

/**
 * Creates the Home panel element — synchronously returns root HTMLElement.
 * Starts async fetches for all permitted blocks; settles independently.
 *
 * @param {{
 *   user:       object,
 *   translate:  (key: string) => string,
 *   openPanel:  (type: string, context: object) => void,
 *   can:        (perm: string, user: object) => boolean,
 * }} deps
 * @returns {{ root: HTMLElement, destroy: () => void }}
 */
export function createHomePanel({ user, translate, openPanel, can: canFn }) {
  const blockCache = _createBlockCache();

  // ── Root element ───────────────────────────────────────────────────
  const root = document.createElement('section');
  root.className = 'home-panel';
  root.setAttribute('role', 'main');

  // ── Determine permitted blocks ─────────────────────────────────────
  const blockIds = _permittedBlockIds(user, canFn);

  // ── Block instances for destroy() ─────────────────────────────────
  const blockInstances = [];

  // ── Settlement tracking ────────────────────────────────────────────
  let settledCount = 0;
  const urgencyMap = {}; // blockId → urgencyScore

  function onBlockReady(blockId, { hasContent, urgencyScore }) {
    urgencyMap[blockId] = hasContent ? urgencyScore : null;
    settledCount += 1;

    if (settledCount >= blockIds.length) {
      // All blocks settled — apply CSS order (ascending resolved priority)
      _applyOrder();
    }
  }

  function _applyOrder() {
    if (!root.isConnected) return;
    // Collect mounted block roots by blockId, sorted by basePriority + urgencyScore
    const mounted = Array.from(root.children)
      .filter((el) => el.dataset && el.dataset.blockId);

    mounted.sort((a, b) => {
      const idA = a.dataset.blockId;
      const idB = b.dataset.blockId;
      const prioA = (BLOCK_DEFINITIONS[idA]?.basePriority ?? 99) + (urgencyMap[idA] ?? 0);
      const prioB = (BLOCK_DEFINITIONS[idB]?.basePriority ?? 99) + (urgencyMap[idB] ?? 0);
      return prioA - prioB;
    });

    mounted.forEach((el, i) => {
      el.style.order = String(i);
    });
  }

  // ── Mount blocks ───────────────────────────────────────────────────
  // greeting has no network call — its "fetchService" constructs data from user.
  // Other blocks have real Supabase calls in BLOCK_FETCHERS.
  for (const blockId of blockIds) {
    const blockDeps = {
      user,
      translate,
      openPanel,
      can:          (perm) => canFn(perm, user),
      fetchService: BLOCK_FETCHERS[blockId],
      blockId,
      blockCache,
      onBlockReady,
    };

    const instance = createBlock(blockId, blockDeps);
    if (!instance) continue; // unknown block — skipped, logged by factory

    blockInstances.push(instance);
    root.appendChild(instance.root);
  }

  // ── Destroy ────────────────────────────────────────────────────────
  function destroy() {
    for (const inst of blockInstances) {
      inst.destroy();
    }
    root.innerHTML = '';
  }

  return { root, destroy };
}
