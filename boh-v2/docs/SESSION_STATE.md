# BOH OS v2 — Session State

## Current Status

- Foundation: **complete**
- PIN login: **complete**
- Authenticated App Shell: **complete**
- Station navigation: **complete** (WS-01 through WS-05)
- Workspace Engine: **complete** (WS-05 — sole navigation model)
- Station Home: **complete** (legacy; replaced by panel strip in WS-05)
- Station Prep core operational flow: **complete**
- OEE Phase 1: **complete** (2026-07-16)

## Navigation Model (WS-05)

The bottom navigation bar has been retired. The Panel Strip is the sole navigation system.

- **Station users** (staff, supervisor) with `defaultStation`: land directly on their station prep panel on login. Home is in the strip but dormant.
- **Station users** without `defaultStation`: land on Home. See "Station not assigned" message (unchanged).
- **Admin / Executive Chef** (`view_executive_mode`): land on Home. Use `+` control in Panel Strip to open Station Selector modal and choose a station.

## WorkspaceManager (boh-v2/src/core/workspace-manager.js)

Fully implemented per Workspace Engine v1.1 spec.

- `openPanel(type, context)` — dedup, limit, render, activate
- `closePanel(id)` — Case A (active) / Case B (dormant)
- `activatePanel(id)` — mounts panel, fires `onPanelActivated`
- `destroy()` — full state reset for logout → re-login
- `showAdd` + `onAdd` — controls `+` button in Panel Strip

## Station Prep supports

- active task loading by default station
- latest valid bot suggestions
- priority sections (Do first / Do today / Check / Looks good / In progress)
- collapsible task details
- today production logs (Made today)
- Start Prep (marks task in progress, updates local state)
- Complete Prep quantity form
- physical stock counts (inserts prep_stock_counts, updates current_stock)
- count reconciliation (invokes bot-prep-count-reconciler, applies returned fields)
- Work in progress metadata (Started by, Started at, Elapsed)
- previous-shift WIP detection (tasks open ≥ 8 hours)
- previous-shift WIP resolution actions (I finished it / Continue / Pass)
- local post-write updates without refetching

## OEE Phase 1

All three kitchen operations route through atomic, server-authoritative, idempotency-hardened RPCs:

| Operation | Service | RPC |
|---|---|---|
| PREP_STARTED | `prep-start-rpc-service.js` | `rpc_oee_record_prep_start` |
| PREP_COMPLETED | `prep-complete-rpc-service.js` | `rpc_oee_record_prep_completion` |
| STOCK_COUNT_RECORDED | `prep-count-rpc-service.js` | `rpc_oee_record_stock_count` |

## Next Task

**Recipe Panels** — may begin now that WS-05 is verified on iPhone.

Before starting:
- Verify WS-05 on iPhone: station user lands on prep panel (not Home) after login.
- Verify exec chef lands on Home with `+` control visible.
- Verify `+` opens Station Selector modal, station selection opens prep panel.
- Verify panel strip shows Home + station chip; close (×) on station chip returns to Home.

After verification:
- Begin `station-recipes` panel type (register renderer, fetch recipe list by station).
- Ref: WORKSPACE_ARCHITECTURE.md §4 panel types table.

## Completed Tasks

| Task | Description | Commit |
|------|-------------|--------|
| 002A | Static Foundation Scaffold | `b35043f4` |
| 002B | Supabase Client Initialization | `3acf17cb` |
| 002C | Minimal PIN Login | `1cdf40f5` |
| 003A | Authenticated App Shell | — |
| 003B | Bottom Navigation mount | — |
| 003C | Station Navigation | — |
| 003D | Station Home real component | — |
| 003E | Router DOM-first | — |
| 004B | Station Prep with real service | — |
| 004D | Prep Suggestions | — |
| 004K | Today Prep Logs | — |
| 004M | Start action + currentUser | — |
| OEE-B | startTask → RPC | `2649a1f7` |
| 004Q | Complete action | — |
| OEE-C-B | completeTask → RPC | `bf3c4e85` |
| 004S | Recent prep counts | — |
| OEE-D-B | saveCount → RPC | `313793ed` |
| 004X | Count reconciliation | — |
| 004AF | WIP handoff / passTask | — |
| 004AI | Admin station selector | — |
| WS-01 | App Shell panel strip mount point | — |
| WS-02 | WorkspaceManager module | — |
| WS-03 | Connect WorkspaceManager to app.js | — |
| WS-03.1 | Dual-outlet surface switching | — |
| WS-04 | Register station-prep renderer | — |
| WS-04.1 | Dormant-close fix; hide inert + control | `14ca064125a2` |
| WS-05 | Retire bottom bar; WorkspaceManager sole navigation | `344c1d85dd0a` |
