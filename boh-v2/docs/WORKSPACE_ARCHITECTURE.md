# BOH OS v2 — Workspace Architecture Decision

> Version 1.0 · 2026-07-15  
> Author: Architecture session  
> Status: **APPROVED — implement in sequence**

---

## 1. Decision Summary

BOH OS v2 is the permanent technical master. Shell Lab is a product and UX reference only; none of its code is carried forward.

The current bottom-navigation model — five tabs that replace the entire page on select — is not the permanent navigation model. It will be replaced by a workspace panel system during the migration described in Section 14.

This document defines every architectural decision required before that migration begins. No workspace code may be written without reference to this document.

---

## 2. Product Model

BOH OS behaves more like Safari than a CRUD application.

Home is always available. It cannot be closed. It is the operational briefing for the day — not a menu.

Opening a station creates a station panel. The station panel hosts the user's prep list and, later, their recipe reference and journal entries. The station is the primary unit of work.

Opening a second station (for eligible users) creates a second panel without destroying the first.

Opening a recipe creates a panel that exists within the station context. The recipe does not replace the prep list; both remain accessible.

Switching between panels does not reload data or destroy local form state.

Chef AI will open as a contextual drawer anchored to the active panel, not as a destination panel. This is not implemented in the first workspace release.

Kitchen Display is a read-only workspace mode derived from live operational state. It is not implemented in the first workspace release.

---

## 3. Workspace Definition

### What a Workspace represents

A Workspace is the container for a user's current authenticated session context. It holds the open panel registry, the active panel pointer, and the session-local station selection for admin and executive chef users.

There is exactly **one Workspace per authenticated session**. A Workspace is created when `mountShell()` is called. It is destroyed when the user closes the browser tab or reloads.

### Workspace vs mode vs station

- `user.role` determines the user's **mode** (station user or executive chef).
- A station user's Workspace begins with Home and their default station pre-opened.
- An executive chef's Workspace begins with Home only; they choose stations from the selector.
- The Workspace does not modify `user.default_station`. It holds a session-local `selectedStation` for admin users, exactly as `station-navigation.js` does today. This binding is carried forward unchanged.

### What belongs in Workspace state

- Open panel registry (ordered array of panel descriptors).
- Active panel ID (string pointer into the registry).
- Session-local station selection for admin/executive chef.
- Nothing else.

### What must not belong in Workspace state

- Prep tasks, suggestions, logs, counts — these live inside their panel's local state.
- User profile data — this lives in `app-state.js`.
- Any data fetched from Supabase — services own data; panels own their own working copies.
- Any form state — this lives inside the panel's closure.

### Station User and Executive Chef use the same Workspace engine

There is one Workspace engine. Mode determines which panels can be opened and whether the panel strip shows navigation controls, but the underlying panel lifecycle is identical for both modes.

---

## 4. Panel Definition

### Panel identity

Each panel has a string `id` assigned at creation time. The id is unique within the open registry for the duration of the session. Format: `panel-{type}-{counter}`, e.g. `panel-home-1`, `panel-station-prep-2`.

Home always has id `panel-home`.

### Panel type

A panel type is a string constant that identifies the renderer. Defined types:

| Type | Status |
|---|---|
| `home` | Milestone 1 |
| `station-prep` | Milestone 1 (already complete, re-framed) |
| `station-recipes` | Future |
| `recipe-detail` | Future |
| `journal` | Future |
| `schedule` | Future |

Panel types not in this list must not be opened by any code. Unrecognized types are silently ignored.

### Panel title

Each open panel has a human-readable title used in the panel strip and, on mobile, in the active panel header. Examples: `Home`, `Saucier Station`, `Arrabbiata`, `Journal`.

### Panel context

A panel may carry context parameters — for example, a station panel carries `{ stationName: 'Saucier Station' }`. Context is immutable after panel creation. A new station panel for a different station is a separate panel, not a mutation of the existing one.

### Panel lifecycle

```
created → active → (hidden when another panel is activated) → closed
```

Panels are never suspended or serialized. A panel's DOM node lives inside the workspace outlet when active and is removed when the panel is closed. Panel switching does not preserve the DOM node across switches in the first implementation — the renderer is called again when a hidden panel is re-activated. This is acceptable because panel-local data is held in in-memory working copies that survive re-activation.

> **Future extension path:** DOM preservation (keeping panel DOM nodes alive in a detached state) can be added later without changing the panel contract. The workspace manager would cache the DOM node by panel ID. Renderers and services require no changes.

### Active panel

Exactly one panel is active at a time. The active panel ID is stored in Workspace state. The Workspace manager applies `aria-hidden` and visibility to non-active panels.

### Open panel registry

An ordered array of panel descriptors. Each descriptor:

```
{
  id:      string,       // unique for this session
  type:    string,       // panel type constant
  title:   string,       // display name
  context: object,       // immutable creation-time parameters
}
```

Maximum open panels: **6** (one Home + five content panels). If a user tries to open a seventh panel, the Workspace manager refuses and notifies the user. This limit is UI policy, not an architectural constraint — it can be changed in a single constant.

### Duplicate-open behavior

Opening a panel whose type + context combination already exists in the registry activates the existing panel rather than creating a duplicate. The identity check uses type and the canonical context key for that type (e.g., for station-prep: `stationName`).

### Ordering behavior

Panels appear in the order they were opened. Home is always first. New panels append at the end.

### Close behavior

Closing a panel removes it from the registry and the DOM. The Workspace manager activates the panel that was active before this one, or Home if no prior panel is recorded.

### Home residency: Home cannot be closed

See Section 5.

### Fallback behavior after close

If the closed panel was the only non-Home panel, Home becomes active. If the closed panel was active and another panel exists to its left, that panel becomes active. If only Home remains, Home becomes active.

---

## 5. Home Residency Rule

**Home is permanently registered. Home cannot be closed. Home is always open.**

Home is registered by the Workspace manager at session start, before any other panel is created. The close control is not rendered for the Home panel.

On mobile, the user returns to Home by tapping the Home button in the panel strip. On desktop, the Home panel tab is always present at the leftmost position.

When no content panels are open, the Home panel is the active panel.

Home is the only panel whose DOM may be kept alive across activations in the first implementation, because it is always present and its content (operational briefing, bot status) does not require re-fetch on every switch. This is optional for the first implementation — a simple re-render on activation is acceptable initially.

**Home must eventually become the operational briefing for the day.** In the first workspace release, Home may contain placeholder content. The content migration is a separate milestone and does not block the workspace implementation.

---

## 6. Station User Behavior

A Station User has `role` equal to `staff`, `supervisor`, or a role that does not grant `view_executive_mode`.

On login:
- If `defaultStation` is present: Home panel is created, then a station panel for the default station is created and activated immediately. The user lands in their station prep list, not on Home.
- If `defaultStation` is null (unusual for a station user): Home is active. No station panel is created. The user sees the "Station not assigned" message in Home.

Panel creation:
- A station user may open exactly one station panel (their assigned station). They may not open a second station panel.
- A station user may open recipe and journal panels from within their station panel.
- The panel strip is simplified for station users: it shows Home and their single station panel. It does not show a "new panel" control.

Navigation:
- The bottom bar is removed for station users. Navigation is through the panel strip (horizontal scroll on mobile) and through entry points within the Home and station panels.

Station users must never see the station selector or the multi-panel management UI.

---

## 7. Executive Chef Behavior

An Executive Chef or Admin user has a role that grants `view_executive_mode` per `permissions.js`.

On login:
- Home panel is created and activated. No station panel is created automatically.
- The station selector is available from Home.

Panel creation:
- An executive chef may open up to five station panels simultaneously (total panels: Home + five).
- Opening a station creates a new station panel. There is no automatic deduplication of the session-local station selection — the executive chef can have Saucier and Pastry open at the same time.
- The `_selectedStation` binding in `station-navigation.js` is no longer the mechanism for executive chef station navigation. It is replaced by the panel context (`context.stationName`).

Navigation:
- The panel strip is visible with all open panels. A "+" control or equivalent opens the station selector to add a panel.
- Switching between open station panels does not modify `user.default_station`.

Executive Chef mode is determined entirely by role. It is not a user choice or a separate login flow. The same authenticated session handles both station and executive chef behavior via the permissions module.

---

## 8. Station / Prep / Recipes / Families Relationship

### Concepts

| Concept | Where it lives | Notes |
|---|---|---|
| Station | Database (`prep_tasks.category`) | Source of truth. A string. No dedicated table. |
| Station Workspace Panel | UI only | A panel of type `station-prep` carrying `{ stationName }`. |
| Prep Tasks | Database (`prep_tasks`) | Loaded by `fetchStationPrepTasks(stationName)`. |
| Prep Families | Database (`prep_task_classifications.production_family`) | Classification data in a lateral table. |
| Recipes | Database (`recipes`, `recipe_bom`) | Not yet loaded in a panel. |

### Station is a panel, not a workspace

A station is not itself a workspace. There is one Workspace per session. A station opens as a panel inside that Workspace. The term "station workspace" in product language refers to the collection of panels related to a station — Prep, Recipes, Journal. Architecturally these are individual panels, not a nested workspace.

### Prep and Recipes are separate panels inside the same station context

A `station-prep` panel hosts the prep list for a given station. A `station-recipes` panel (future) hosts the recipe reference for the same station. Both carry the same `stationName` in their context. They are separate panels — the user can have both open simultaneously and switch between them without losing form state.

### Prep Families are visual sections within the Prep panel

Prep Families (`production_family` in `prep_task_classifications`) are grouping and filtering data. They are UI navigation groups within the station-prep panel — not separate panels, not separate routes, not separate database concepts. The `prep_task_classifications` lateral table is already in production. No schema change is needed.

### Opening a second station

An executive chef opens a second station by tapping "+" in the panel strip and selecting from the station selector. A second `station-prep` panel is created with a different `context.stationName`. Both panels exist in the registry. The user switches between them via the panel strip. There is no merging of data between panels.

---

## 9. Router and Workspace Manager Responsibilities

### Retained: the current router

The current `router.js` is retained. Its contract is unchanged:

- `router.register(name, renderer)` — registers a named page renderer.
- `router.navigate(name)` — calls the renderer and injects the result into the outlet.
- Renderers return `HTMLElement` or `string`.

The router continues to manage **named routes** for the bottom bar's five destinations during the transition period. Once the workspace panel model replaces the bottom bar (Migration Step 4), the router may be left in place as an internal routing mechanism for panel-type-to-renderer mapping, or it may be retired. This decision is deferred to the implementation session.

### New: the Workspace Manager

The Workspace Manager is a new module introduced above the router. It does not replace the router; it orchestrates panels.

**Responsibility of the Workspace Manager:**

- Maintain the open panel registry (ordered array of panel descriptors).
- Track the active panel ID.
- Open a panel: check for duplicate, create descriptor, call renderer, mount DOM, update registry, render panel strip.
- Close a panel: remove from registry, unmount DOM, update active pointer, render panel strip.
- Activate a panel: update active pointer, show/hide DOM nodes, render panel strip.
- Render the panel strip: one element per open panel, active state, close button (not on Home).
- Enforce the panel limit (6).
- Enforce Home residency (always open, never closed, always first).

**Responsibility of the App Shell:**

- Provide the workspace outlet: the DOM element into which the Workspace Manager mounts panel DOM.
- Provide the panel strip mount point: the DOM element into which the Workspace Manager renders the panel strip.
- Provide the nav mount point: retained for the transition period; removed when the bottom bar is retired.

The App Shell is not aware of panel types, renderers, or state. It provides mount points only.

**Responsibility of panels:**

- Hold their own local state (working copies of tasks, logs, counts, form values).
- Render themselves into a returned `HTMLElement`.
- Protect against stale async completion via `isConnected` checks (existing pattern, unchanged).
- Know nothing about the Workspace Manager.
- Accept services via dependency injection (existing pattern, unchanged).

**Responsibility of feature renderers:**

- Unchanged. `createStationPrep`, `createStationHome`, `createStationSelector` are not modified. Their injected dependencies are unchanged. They return `HTMLElement` and know nothing about panels.

### What changes in `app.js` and `station-navigation.js`

`app.js → mountShell()`:
- Currently initializes the router and calls `setupStationNavigation`.
- After migration: initializes the Workspace Manager, passes it to `setupStationNavigation` (or equivalent), opens the Home panel.

`station-navigation.js → setupStationNavigation()`:
- Currently registers routes and manages bottom nav state.
- After migration: registers panel types with the Workspace Manager and opens the initial station panel for station users. The `handleStationSelect` callback becomes `workspaceManager.openPanel('station-prep', { stationName })`.
- The `_selectedStation`, `canChooseStation`, and `effectiveStation()` logic is preserved inside the navigation controller or moved into the Workspace Manager's panel context.

---

## 10. State Model

### In-memory only. No persistence across reload. No storage APIs.

`localStorage` and `sessionStorage` remain prohibited. This prohibition is permanent for the first workspace implementation. A future session may introduce opt-in persistence, but only after the panel contract is stable.

### Minimum required state

```
WorkspaceState {
  panels:      PanelDescriptor[],   // ordered registry
  activeId:    string | null,        // pointer into panels
}

PanelDescriptor {
  id:      string,
  type:    string,
  title:   string,
  context: object,
}
```

This state lives inside the Workspace Manager module as a module-scope variable. It is not exported. External code interacts with the Workspace Manager only through its public API (`openPanel`, `closePanel`, `activatePanel`, `currentPanel`).

### Panel-local state

Each panel holds its own working copies (tasks, logs, counts, form values) inside the closure created by its renderer function. This is the pattern already established by `createStationPrep`. It is unchanged.

When a panel is re-activated (user switches back to it), the renderer is called again in the first implementation, re-loading data from Supabase. This is acceptable and matches current behavior. DOM preservation is a future optimization that does not change the state model.

### Unsaved form state

In the first workspace implementation, switching away from a panel with an open form will cause form state to be lost when the panel re-renders on re-activation. This is a known limitation. A warning or disabling of panel switching while a form is open can be added in a later session without changing the workspace contract.

### Expanded task state

The `expandController` inside `createStationPrep` manages expanded/collapsed task detail panels. It is reset on every `render()` call (existing behavior). It is not persisted across panel switches in the first implementation.

---

## 11. Mobile Interaction Model

### Panel strip

On mobile (viewport width ≤ 640px), open panels are represented as a horizontally scrollable strip below the App Shell header and above the workspace outlet. Each panel is a tap target. The active panel is visually distinct. The strip is always visible.

For station users (one content panel): the strip shows Home and one station panel. It does not scroll.

For executive chef users (up to six panels): the strip scrolls horizontally when panel labels overflow the viewport width.

### Switching panels

Tap a panel in the strip to activate it. No swipe gesture in the first implementation — swipe navigation is added later without changing the panel contract.

### Opening another station (Executive Chef)

A "+" button at the right end of the panel strip opens the station selector overlay. The station selector is a modal overlay on mobile, not a panel. Selecting a station closes the overlay and opens a new station panel.

### Returning to Home

Home is always the first item in the panel strip. Tap it to return. There is no dedicated "Home" button in the App Shell header in the first implementation.

### Close action

Each panel in the strip (except Home) has a small close tap target ("×"). Tapping it closes the panel and activates the fallback panel.

### Panel limit and overflow

When six panels are open, the "+" button is hidden. Closing a panel re-shows it.

### Bottom bar

The bottom bar (`bottom-navigation.js`) is retired as part of Migration Step 4 (see Section 15). During the transition period it remains functional. It is not modified before Migration Step 4.

---

## 12. Desktop Interaction Model

### First-phase desktop behavior: tabs only

For the first workspace release, desktop behavior is identical to mobile except:

- The panel strip is displayed horizontally across the full viewport width. No horizontal scroll — panels have a fixed minimum width. If all six panels are open, labels truncate.
- The workspace outlet fills the remaining vertical space.
- No split view. No side-by-side panels. These are future milestones.

Desktop support beyond the panel strip is deferred. The workspace model is validated on mobile first. Desktop-specific layout (panel rail, side-by-side views) is added in a later session without changing the panel contract.

Kitchen Display is not a desktop layout concern in this document. It is a future milestone with its own architecture.

---

## 13. Async Lifecycle Rules

### Existing safeguard: `isConnected`

Every async completion in `createStationPrep` checks `section.isConnected` before mutating the DOM. This pattern is correct and is carried forward unchanged for all future panel renderers.

### Panel switched while fetch is in progress

In the first implementation, fetches are not cancelled on panel switch. The `isConnected` check prevents stale completions from writing to a detached DOM node. The data loaded by the fetch is lost — the panel re-fetches on next activation.

### AbortController (future)

AbortController is not implemented in the first workspace release. It is added per panel type in a later session. The workspace manager passes an AbortSignal to the renderer as an optional parameter. Renderers that do not use it are unaffected.

### Panel closed during fetch

A closed panel's DOM is removed. `isConnected` returns false. No DOM mutations occur. No special cleanup is required in the first implementation.

### Panel closed during form submission

If a panel is closed while a write service call is in flight, the write completes (services are stateless and fire-and-forget from the panel's perspective). The panel DOM is gone; `isConnected` prevents any UI update. The data is written to the database. This is acceptable for the first implementation. Future work may add a close guard for in-flight writes.

### Preventing cross-panel DOM updates

Panels hold references only to their own DOM nodes. The Workspace Manager does not expose other panels' DOM. There is no mechanism by which one panel can write to another panel's DOM.

### Station Prep local state (`workingTasks`, `workingLogsMap`, `workingCountsMap`)

These are closure-local variables inside each `createStationPrep` invocation. They are completely isolated per panel instance. When a station panel is re-rendered (panel re-activation), a fresh invocation creates a fresh closure with fresh working copies from a new Supabase fetch.

---

## 14. Migration Plan

The migration keeps the live `boh-v2` application usable after every atomic commit. Station Prep is never rebuilt.

### What remains untouched throughout

- All services in `boh-v2/src/services/`.
- `station-prep.js` — the complete Station Prep component.
- `complete-prep-form.js`, `prep-count-form.js` — reusable form components.
- `station-selector.js` — the admin station selector.
- `app-state.js`, `permissions.js`, `router.js`, `supabase-client.js`, `i18n.js`, `en.js`.
- All CSS files.
- `auth-service.js` (already fixed).

### What is wrapped, not replaced

- `station-navigation.js` — wrapped to delegate panel opening to the Workspace Manager while keeping the existing service injection logic.
- `app.js → mountShell()` — extended to initialize the Workspace Manager and pass it to the navigation setup.

### What is replaced

- `bottom-navigation.js` — retired and replaced by the panel strip (Migration Step 4).
- The bottom bar mount point in `app-shell.js` — replaced by a panel strip mount point.

### Migration step sequence

| Step | What changes | Bottom bar |
|---|---|---|
| 1 | `app-shell.js`: add panel strip mount point alongside existing nav mount point | Still present |
| 2 | New `workspace-manager.js`: panel registry, open/close/activate, panel strip renderer | Still present |
| 3 | `app.js`: initialize Workspace Manager; call `workspaceManager.openPanel('home')` after shell mount | Still present |
| 4 | `station-navigation.js`: delegate `handleSelect` and `handleStationSelect` to Workspace Manager; retire bottom bar | **Removed** |
| 5 | `app.js`: open station panel automatically for station users with `defaultStation` | — |
| 6 | Visual language import: port Shell design tokens into `tokens.css` and `base.css` | — |

Steps 1–5 are the atomic implementation sequence (Section 15). Step 6 is a separate milestone.

---

## 15. Atomic Implementation Sequence

Each item is exactly one atomic commit. No step depends on unreleased steps from a later session. Each step leaves the application in a usable state.

**Step WS-01 — App Shell panel strip mount point**

File: `boh-v2/src/components/app-shell/app-shell.js`

Add a `div.app-shell__panel-strip` element between the header and the main content outlet. Return it alongside the existing nav mount point. No visual change — the div is empty.

**Step WS-02 — Workspace Manager module**

New file: `boh-v2/src/core/workspace-manager.js`

Public API:
- `createWorkspaceManager({ outlet, panelStripMount }) → workspaceManager`
- `workspaceManager.openPanel(type, context) → panelId`
- `workspaceManager.closePanel(panelId)`
- `workspaceManager.activatePanel(panelId)`
- `workspaceManager.currentPanel() → PanelDescriptor | null`
- `workspaceManager.registerRenderer(type, rendererFn)`

Home panel opened automatically in `createWorkspaceManager`. Renderer registry starts empty — renderers are registered by the caller.

Panel strip rendered as a plain list of buttons. No styling beyond structure. Panel strip is inserted into `panelStripMount`.

**Step WS-03 — Connect Workspace Manager to app.js**

File: `boh-v2/src/app.js`

In `mountShell()`:
- Create the Workspace Manager with the panel strip mount and workspace outlet.
- Register the `home` renderer (a placeholder that returns a div with "Home").
- Call `workspaceManager.openPanel('home', {})`.
- Continue to call `setupStationNavigation` as before (bottom bar still present, still functional).

At this point, Home panel appears in the panel strip alongside the functioning bottom bar. Both navigation models are live simultaneously.

**Step WS-04 — Register station-prep renderer in Workspace Manager**

Files: `boh-v2/src/modes/station/station-navigation.js`, `boh-v2/src/app.js`

Register the `station-prep` renderer with the Workspace Manager. The renderer calls `createStationPrep` with injected services, identical to the current `router.register('station-prep')` call.

Update `handleStationSelect` to call `workspaceManager.openPanel('station-prep', { stationName })` instead of `router.navigate('station-prep')`.

The bottom bar Prep button continues to call `router.navigate('station-prep')` for the transition period — this is a parallel path, not a conflict. Both reach the same renderer.

**Step WS-05 — Retire bottom bar; panel strip becomes sole navigation**

Files: `boh-v2/src/app.js`, `boh-v2/src/modes/station/station-navigation.js`, `boh-v2/src/components/app-shell/app-shell.js`

Remove the nav mount point from `app-shell.js`. Remove bottom navigation creation from `station-navigation.js`. Remove the `bottom-navigation.js` import. Update `app.js` to no longer provide a nav mount target.

For station users with `defaultStation`: open the station panel automatically in `mountShell()`, activating it so the user lands directly in their prep list (not Home).

For admin/executive chef with null station: Home is active; station selector available from Home.

At this commit, the workspace panel model is the sole navigation model. The bottom bar is gone.

---

## 16. Rejected Alternatives

**Continuing with five permanent bottom-navigation pages.** Rejected. This model contradicts the product vision. Context is destroyed on every navigation. It cannot support multiple station panels or recipe panels coexisting with the prep list.

**Copying Shell Lab tab code directly.** Rejected. Shell Lab's tab system uses module-scope mutable global variables, `sessionStorage` for persistence, and inline DOM manipulation. These contradict every architectural constraint established in v2.

**Rebuilding v2 inside Shell Lab.** Rejected. Shell Lab is a monolithic 98KB+ file with no module system. It cannot become a production base without a full rewrite — equivalent in effort to building v2 from scratch, but on worse foundations.

**Using `sessionStorage` as primary workspace state.** Rejected. `sessionStorage` is a storage API. v2's architecture prohibits storage APIs. Session state is in-memory only. This is a deliberate constraint that enables predictable, side-effect-free behavior.

**Supabase calls in panel components.** Rejected. The existing architecture prohibits this. Services own data access. Components receive services via dependency injection. This rule is not relaxed for panels.

**A separate app for Executive Chef Mode.** Rejected. Executive Chef mode is determined by role. It is the same authenticated session, the same Workspace engine, the same services. The only difference is which panels can be opened and how many. A separate app would duplicate authentication, services, and state management for no benefit.

**Making every station a completely independent route.** Rejected. A route renders a page and destroys it on navigation. Station panels must coexist in the registry without destroying each other. Routes and panels are different concepts.

**Implementing Recipe pages before the workspace foundation.** Rejected. Recipes open as panels. The panel model must exist before recipe panels can be implemented. Building recipes inside the bottom-bar model would require tearing them apart when the workspace model lands.

---

## 17. Non-Goals

This architecture document does not define or decide:

- Final visual styling, colors, typography.
- Detailed Home panel content (bot status, prep summary, alerts).
- Recipe panel UI design.
- Kitchen Display architecture.
- Daily Journal UI design.
- Chef AI drawer implementation.
- Database schema changes of any kind.
- Persistent sessions across browser reload.
- Real-time multi-device synchronization.
- AbortController implementation (noted as future work).
- DOM preservation across panel switches (noted as future extension).
- Station Prep feature changes.
- Desktop split-view or side-by-side panel layouts.

---

## 18. Approval Checkpoint

Before any implementation begins:

- [ ] Max reviews Section 6 (Station User behavior) and confirms the default station auto-open behavior.
- [ ] Max reviews Section 7 (Executive Chef behavior) and confirms that auto-opening a station on login is not desired for admin users.
- [ ] Max reviews Section 15 (atomic sequence) and confirms the order of WS-01 through WS-05.
- [ ] Max confirms the panel maximum of 6 is correct for the initial release.
- [ ] Max confirms that recipe panels are not to be started until WS-05 is complete and verified on iPhone.

No implementation code may be committed until this checkpoint is passed.
