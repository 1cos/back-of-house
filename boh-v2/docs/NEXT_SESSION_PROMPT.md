# BOH OS v2 — Next Session Prompt

## WS-05 STATUS: ✅ COMPLETE (2026-07-16)

The bottom bar has been retired. WorkspaceManager is the sole navigation model.
Station users land directly on their prep panel. Admin/exec chef land on Home.
boh-v678 is live.

---

## What to verify on iPhone before starting Recipe Panels

1. **Station user login**: after PIN → lands directly on station prep panel (not Home)
2. **Home chip**: visible in Panel Strip; tap it → returns to Home placeholder
3. **Admin login**: after PIN → lands on Home placeholder, `+` chip visible in strip
4. **`+` button**: opens Station Selector modal sheet from bottom of screen
5. **Station selection**: tap a station → modal dismisses → station prep panel opens → strip shows two chips (Home + station)
6. **Close chip**: tap `×` on station chip → returns to Home (left-neighbor fallback)
7. **Reload**: session starts fresh, re-authentication required (expected, v1 behavior)

---

## Next task after iPhone verification

**Recipe Panels** (station-recipes panel type)

Prerequisites: WS-05 verified on iPhone.

Implementation sequence:
1. Register `station-recipes` renderer in `app.js`
2. `station-recipes` renderer: fetch recipe list by station from `recipes` table via `station-prep-service` or a new service
3. Recipe list panel: show recipe titles; tap → opens `recipe-detail` panel
4. `recipe-detail` renderer: fetch recipe + BOM; display ingredients
5. Add entry point from station-prep panel (future: tap recipe name in task detail)

Do NOT begin Home Composition Engine yet (separate milestone).

---

## OEE Phase 1 — Active Routing Table

| Operation | Frontend producer(s) | Service | RPC |
|---|---|---|---|
| PREP_STARTED | `buildStartButton` | `prep-start-rpc-service.js` | `rpc_oee_record_prep_start` |
| PREP_STARTED | `continueBtn` (WIP Continue) | same service | same RPC |
| PREP_COMPLETED | `buildCompleteButton` | `prep-complete-rpc-service.js` | `rpc_oee_record_prep_completion` |
| PREP_COMPLETED | `finishedBtn` (WIP finished) | same service | same RPC |
| STOCK_COUNT_RECORDED | `buildCountButton` | `prep-count-rpc-service.js` | `rpc_oee_record_stock_count` |
| Reconciler | after saveCount ok:true | `prep-count-reconciler-service.js` | `bot-prep-count-reconciler` EF |

---

## Workspace Migration — Completed Steps

| Step | Status | Commit |
|---|---|---|
| WS-01 | ✅ App Shell panel strip mount point | — |
| WS-02 | ✅ WorkspaceManager module | — |
| WS-03 | ✅ Connect to app.js; open Home | — |
| WS-03.1 | ✅ Dual-outlet surface switching | — |
| WS-04 | ✅ Register station-prep renderer | — |
| WS-04.1 | ✅ Dormant-close fix; inert + hidden | `14ca064125a2` |
| WS-05 | ✅ Retire bottom bar; sole navigation | `344c1d85dd0a` |

---

## Key files changed in WS-05

| File | Change |
|---|---|
| `boh-v2/src/app.js` | Removed router/legacy-outlet/setupStationNavigation; station-user auto-open; modal function |
| `boh-v2/src/components/app-shell/app-shell.js` | Removed navMount + legacyOutlet; single workspaceOutlet |
| `boh-v2/src/modes/station/station-navigation.js` | Removed bottom nav + router; pure panel helper |
| `boh-v2/src/core/workspace-manager.js` | Accept onAdd callback; connect to '+' control |
| `boh-v2/styles/app-shell.css` | Removed dual-outlet CSS; added station-selector-modal styles |
