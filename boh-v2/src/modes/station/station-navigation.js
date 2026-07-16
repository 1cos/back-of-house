// BOH OS v2 — Station Mode Navigation Controller
// WS-05: Bottom bar retired. This module no longer manages bottom navigation,
//        route registration, or the legacy router.
//
// After WS-05 this module's sole responsibility is:
//   - Providing the canonical station-prep renderer registration helper.
//   - Exposing handleStationSelect so callers outside the WorkspaceManager
//     can trigger opening a station panel (e.g. future Home panel entry points).
//
// The module is now a thin connector between app.js and the WorkspaceManager.
// All service imports are retained for the renderer factory.
//
// No window writes. No storage. No Supabase. No browser history. No router import.
// No bottom-navigation import.

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

// ── Role normalization ────────────────────────────────────────────────

/**
 * Normalizes a raw user role string to a canonical snake_case value.
 * Returns null for any invalid / missing input.
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
function normalizeRole(raw) {
  if (typeof raw !== 'string') return null;
  return raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

const CHOOSER_ROLES = new Set(['admin', 'executive_chef']);

// ── Public API ────────────────────────────────────────────────────────

/**
 * Sets up Station Mode navigation for WS-05+:
 *   - Registers the station-prep renderer with the WorkspaceManager.
 *   - Returns a handleStationSelect callback for external callers.
 *
 * @param {{
 *   workspaceManager: {
 *     registerRenderer: (type: string, fn: (ctx: object) => HTMLElement) => void,
 *     openPanel: (type: string, context: object) => string | null,
 *   },
 *   translate:   (key: string) => string,
 *   user:        { name?: string, defaultStation?: string, role?: string },
 * }} options
 * @returns {{ handleStationSelect: (stationName: string) => void, canChooseStation: boolean }}
 */
export function setupStationNavigation({ workspaceManager, translate, user }) {
  if (!workspaceManager || typeof workspaceManager.registerRenderer !== 'function') {
    throw new Error('setupStationNavigation: workspaceManager must expose registerRenderer.');
  }
  if (typeof translate !== 'function') {
    throw new Error('setupStationNavigation: translate must be a function.');
  }

  // ── Role eligibility ───────────────────────────────────────────────
  const role = normalizeRole(user.role ?? null);
  const canChooseStation = CHOOSER_ROLES.has(role);

  // ── Station-prep renderer ──────────────────────────────────────────
  // Registered here so it is co-located with its service dependencies.
  // createStationPrep already uses the skeleton-first pattern with
  // isConnected guards — it satisfies the renderer contract (R-21).
  workspaceManager.registerRenderer('station-prep', ({ stationName }) =>
    createStationPrep({
      stationName,
      canChooseStation: false,   // concrete station already chosen at panel-open time
      translate,
      fetchStations:    fetchAvailableStations,
      onStationSelect:  (newStation) => {
        workspaceManager.openPanel('station-prep', { stationName: newStation });
      },
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

  // ── Station selection callback ─────────────────────────────────────
  // Called by any UI entry point that wants to open a station prep panel.
  // Delegates to the WorkspaceManager — no router, no bottom-bar state.
  function handleStationSelect(stationName) {
    if (typeof stationName !== 'string' || stationName.trim().length === 0) return;
    workspaceManager.openPanel('station-prep', { stationName: stationName.trim() });
  }

  // ── Public interface ──────────────────────────────────────────────
  return {
    handleStationSelect,
    canChooseStation,
  };
}
