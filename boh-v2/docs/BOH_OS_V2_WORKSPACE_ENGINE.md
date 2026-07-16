# BOH OS v2 — Workspace Engine Specification

> Version 1.1 · 2026-07-16  
> Author: Architecture session  
> Status: **PROPOSED — requires Max approval before any implementation**  
> Preceded by: `boh-v2/docs/WORKSPACE_ARCHITECTURE.md` v1.0 (2026-07-15)  
> Scope: UI architecture only — no DB, no RPCs, no services, no business logic  
> Changes from v1.0: three architectural corrections applied per review (destroy() full reset; _prevId removed / left-neighbor fallback; renderer contract strengthened). All other review notes deferred to Appendix A.

---

## 0. Purpose and Relationship to Existing Docs

`WORKSPACE_ARCHITECTURE.md` (approved 2026-07-15) defines **what** the workspace is: panel lifecycle, panel types, state model, migration steps WS-01 through WS-05.

This document defines **how the workspace behaves** at the UI layer: tab mechanics, mobile/desktop interaction patterns, overflow rules, dirty state, session restore, and the internal JS module architecture that supports all of it.

These two documents are complementary. If they conflict, `WORKSPACE_ARCHITECTURE.md` governs.

---

## 1. Mental Model: One Workspace, Many Panels

BOH OS v2 has exactly one Workspace per authenticated session. The Workspace is the container. Panels are what the user works in.

Think Safari — not because of tabs, but because of what tabs enable: **context is never destroyed by navigation**. Switching from Saucier Station to Arrabbiata recipe does not unload the prep list. Returning to the prep list does not trigger a reload.

The Workspace is not a visual thing. It is the engine that manages which panels are open, which is active, and what happens when panels are opened or closed. The visual representation of the Workspace is the **Panel Strip**.

---

## 2. Workspace Lifecycle

### 2.1 Birth

The Workspace is created exactly once, in `mountShell()`, after the user authenticates.

```
authenticate() → mountShell(user)
               → WorkspaceManager.create({ outlet, panelStrip })
               → open('home', {})                  ← always first
               → open('station-prep', { stationName })  ← if defaultStation present
```

For a station user with a default station: the station panel is activated immediately. The user never sees the Home panel on first load. It is there — in the strip — but the station is the active panel.

For an admin/executive chef: Home is activated. No station panel is created automatically.

### 2.2 Operation

The Workspace runs until the browser tab closes or the user reloads. No state survives a reload in v1. This is a deliberate constraint — see `WORKSPACE_ARCHITECTURE.md` §10.

During operation, the WorkspaceManager:
- Maintains the panel registry (ordered array of PanelDescriptors).
- Tracks the active panel ID.
- Routes open/close/activate calls to the correct panel.
- Manages the Panel Strip DOM.
- Enforces invariants (Home residency, panel limit, duplicate-open deduplication).

### 2.3 Death

On reload or close: all in-memory state is lost. No cleanup is needed — the browser handles it.

On logout: `WorkspaceManager.destroy()` is called. It performs a **complete reset** of all module-scope state:
- Clears the outlet DOM contents.
- Removes the Panel Strip from the DOM.
- Resets `_state` to `{ panels: [], activeId: null }`.
- Resets `_renderers` to `{}`.
- Resets `_counter` to `0`.

After `destroy()` returns, the module is in an identical state to before `createWorkspaceManager()` was first called. This makes it safe to call `createWorkspaceManager()` again in the same tab (logout → re-login flow) without any stale state from the previous session.

The login screen replaces the shell after `destroy()` completes.

---

## 3. Panel Lifecycle

### 3.1 State Diagram

```
                    ┌──────────────┐
          open()    │              │  activate()
  ────────────────► │   ACTIVE     │ ◄──────────────
                    │              │
                    └──────┬───────┘
                           │
               another     │
               panel       │  activate()
               activated   │
                           ▼
                    ┌──────────────┐
                    │              │
                    │   DORMANT    │
                    │              │
                    └──────┬───────┘
                           │
               close()     │
                           ▼
                    ┌──────────────┐
                    │              │
                    │   CLOSED     │  (removed from registry)
                    │              │
                    └──────────────┘
```

Home only: Home has no CLOSED state. It transitions between ACTIVE and DORMANT only.

### 3.2 Transitions

| Transition | Trigger | Side effects |
|---|---|---|
| Open → ACTIVE | `workspaceManager.openPanel(type, context)` | Create PanelDescriptor, call renderer, mount DOM, update Panel Strip, set activeId |
| ACTIVE → DORMANT | Another panel activated | Hide DOM node (v1: remove from outlet; future: detach to cache), update Panel Strip |
| DORMANT → ACTIVE | `workspaceManager.activatePanel(id)` | Call renderer again (v1), mount DOM, update Panel Strip, set activeId |
| ACTIVE → CLOSED | `workspaceManager.closePanel(id)` | Remove from registry, unmount DOM, activate left-neighbor fallback, update Panel Strip |
| DORMANT → CLOSED | `workspaceManager.closePanel(id)` | Remove from registry (DOM already unmounted), activate left-neighbor fallback, update Panel Strip |

### 3.3 Renderer call contract

**Renderer functions MUST be synchronous.** A renderer MUST return a valid `HTMLElement` immediately — it MUST NOT return a `Promise`, `null`, or any other value. Returning `Promise<HTMLElement>` is a specification violation: the WorkspaceManager cannot append a Promise to the DOM, and the failure is silent with no error surfaced to the user or developer.

The correct pattern for panels that require async data is the **skeleton-first pattern**:
1. The renderer synchronously creates and returns a skeleton `HTMLElement` (loading state, spinner, or empty container).
2. After returning, the renderer's async operations populate the skeleton.
3. Every DOM mutation after an `await` MUST be guarded by `node.isConnected` before executing.

```js
// CORRECT — skeleton-first
registerRenderer('station-prep', ({ stationName }) => {
  const section = document.createElement('section');
  section.className = 'station-prep';
  section.textContent = 'Loading…';          // skeleton
  fetchStationPrepTasks(stationName).then(tasks => {
    if (!section.isConnected) return;        // isConnected guard mandatory
    renderTasks(section, tasks);
  });
  return section;                            // synchronous return
});

// VIOLATION — async renderer
registerRenderer('station-prep', async ({ stationName }) => {
  const tasks = await fetchStationPrepTasks(stationName);
  const section = document.createElement('section');
  renderTasks(section, tasks);
  return section;                            // returns Promise<HTMLElement> — never mounted
});
```

`registerRenderer` always overwrites a previous registration for the same type. This is the intended mechanism for replacing placeholder renderers with real implementations as milestones progress.

In v1, the renderer is called on every activation. This means:
- Data is re-fetched from Supabase on every re-activation.
- Form state is lost on switch-away.
- `expandController` state (collapsed/expanded task rows) resets.

This is acceptable for v1 and matches current behavior. Future optimization: DOM caching. No API change is required — the WorkspaceManager would cache the DOM node by panel ID. Renderers are unaffected.

### 3.4 isConnected guard

All async completions in all panel renderers MUST check `node.isConnected` before mutating the DOM. This is the existing pattern from `station-prep.js` and is mandatory for all future panels. It is not optional even when the renderer author believes the panel will always be mounted — the WorkspaceManager may close or replace a panel while an async operation is in flight.

---

## 4. Home Residency Rule

**Home is always open. Home cannot be closed. Home is always leftmost in the Panel Strip.**

Implementation:
- Home PanelDescriptor is created by `WorkspaceManager.create()` before any other panel.
- The WorkspaceManager refuses `closePanel('panel-home')` silently.
- The Panel Strip renderer does not render a close button for Home.
- When no other panels are open, Home is the active panel.

Home content in v1: placeholder. Final Home content (operational briefing, bot status, prep summary) is a separate milestone and does not block Workspace implementation.

---

## 5. Panel Types (v1 scope)

| Type constant | Display title | Context key | Who can open | v1 or future |
|---|---|---|---|---|
| `home` | Home | — | All (automatic) | v1 |
| `station-prep` | `{stationName} Station` | `stationName` | All (auto for station user; selector for chef) | v1 |
| `station-recipes` | `{stationName} Recipes` | `stationName` | All (from station panel) | future |
| `recipe-detail` | `{recipeName}` | `recipeId` | All (from recipe list) | future |
| `journal` | Journal | — | lead, coordinator, executive | future |
| `schedule` | Schedule | — | All | future |

Panel types not in this table: the WorkspaceManager ignores them silently. No error is thrown.

---

## 6. Duplicate-Open Behavior

Opening a panel whose type + canonical context already exists in the registry **activates the existing panel** — it does not create a duplicate.

Canonical context key per type:
- `station-prep`: `context.stationName`
- `recipe-detail`: `context.recipeId`
- `journal`: type alone (singleton)
- `home`: type alone (singleton, enforced separately)

**Station users**: opening their default station panel a second time activates the existing panel. No duplicate.

**Executive chef**: opening Saucier Station and then Pastry Station creates two separate panels — they have different `stationName` values, so no deduplication applies.

---

## 7. Close Behavior and Fallback

When a panel is closed:
1. It is removed from the registry.
2. Its DOM node is removed from the outlet.
3. The WorkspaceManager selects the fallback panel and activates it.

**Fallback selection rule:**

Activate the panel immediately to the left of the closed panel in the registry array. If the closed panel was at index 0 (which cannot happen — Home is always at index 0 and cannot be closed), or if no left neighbor exists, activate Home.

Home is always the final fallback. The fallback rule never leaves the workspace with no active panel.

```
closed panel at registry index N
  → activate panel at index N-1
  → if N-1 does not exist → activate Home
```

There is no history tracking. The WorkspaceManager does not record which panel was previously active. Fallback is determined entirely by the current registry order at the moment of close. This is spatially predictable: the panel visually to the left of the closed chip becomes the active panel. It cannot reference a deleted panel ID.

**Example:** Home → Saucier → Pastry → Journal (indices 0, 1, 2, 3). Closing Journal (index 3) activates Pastry (index 2). Closing Pastry activates Saucier. Closing Saucier activates Home.

---

## 8. Panel Limit and Overflow

**Maximum open panels: 6** (Home + 5 content panels). This is a constant in WorkspaceManager: `MAX_PANELS = 6`.

When the limit is reached:
- The `+` control in the Panel Strip is hidden.
- Any `openPanel()` call that would exceed the limit is refused.
- The WorkspaceManager shows a brief non-modal notification: "Close a panel to open a new one." The notification is rendered as part of the Panel Strip `HTMLElement` when `atLimit=true` is passed to `renderPanelStrip`. It disappears automatically when any panel is closed and the strip re-renders with `atLimit=false`.

Closing any panel re-enables the `+` control.

The limit is UI policy only. It can be changed by updating `MAX_PANELS`. No other code change is required.

---

## 9. Panel Ordering

Panels appear in the Panel Strip in the order they were opened.

- Home is always position 0.
- New panels append at the end.
- Panels do not reorder when activated (unlike browser tab recency models).
- Panels do not reorder when closed (the gap closes left).

The ordering is the order of the `panels` array in WorkspaceState.

---

## 10. Dirty State

**v1: not implemented.** The WorkspaceManager has no concept of dirty panels in v1.

Known consequence: switching away from a panel with an open quantity form or count form loses the form values.

**v1 mitigation**: The UX must make this obvious. When a form is open, the Panel Strip stays visible — the user can see they are about to switch. No implicit prevention. No warning dialog in v1.

**Future extension**: The panel contract will add an optional `isDirty()` function. The WorkspaceManager calls it before activating another panel. If `isDirty()` returns true, a confirmation prompt is shown. Renderers that do not implement `isDirty()` behave as v1 (switch allowed freely). No WorkspaceManager API change required beyond passing a ref check.

---

## 11. Session Restore

**v1: not implemented.** On reload, the Workspace starts fresh. The user must re-authenticate and their station panel is re-created by the normal login flow.

**v2 scope (deferred)**: sessionStorage-based restore. The WorkspaceManager would serialize `WorkspaceState` to sessionStorage on every change and restore it on next `mountShell()` call. This requires a panel type registry that maps types to renderers — which the WorkspaceManager already has. No panel contract change is required.

Prohibition: `localStorage` is permanently prohibited. If restore is implemented, it uses `sessionStorage` only, and it stores panel descriptors (type, title, context) — never data fetched from Supabase.

---

## 12. Mobile Behavior (iPhone Portrait Primary)

### 12.1 Panel Strip

The Panel Strip lives between the App Shell header and the workspace outlet. It is always visible.

On mobile (viewport ≤ 640px):
- The strip is a single horizontal row of panel chips.
- Chips are small: icon + truncated label + close button (except Home).
- Horizontal scroll when chips overflow the viewport. Scroll snap per chip.
- No left/right arrows. Drag to scroll (native momentum).
- The active chip is visually distinct: filled background, no transparency.
- The strip does not wrap to a second row.

Chip anatomy (mobile):
```
┌─────────────────┐
│ 🍳  Saucier  ×  │
└─────────────────┘
```
- Icon: 16px emoji or SF Symbol glyph (type-specific, see §15.1).
- Label: station name or panel title, truncated at 12 chars with ellipsis.
- Close button: 20×20 tap target, × character. Not shown for Home.
- Entire chip is a tap target to activate the panel.
- Minimum chip width: 80px. Maximum: 140px.

### 12.2 Panel switching

Tap a chip → activates that panel. No animation in v1. Instant switch.

Future: slide animation (panels slide left/right based on relative position). No API change — the WorkspaceManager would accept a `transitionHint` from `activatePanel()`.

### 12.3 Returning to Home

Home chip is always leftmost. Tap it. No dedicated Home button in the App Shell header in v1.

Scroll the strip left to reach Home if many panels are open.

### 12.4 Opening a new panel (executive chef on mobile)

A `+` button appears at the right end of the Panel Strip (after all chips). Tapping it:
- Opens the Station Selector as a **modal overlay** (not a panel — the station selector is a picker, not a workspace).
- Selecting a station closes the overlay and opens a new `station-prep` panel.

The `+` button is hidden when `panels.length >= MAX_PANELS`.

### 12.5 Station user on mobile

- Panel Strip shows: Home + one station chip. No `+` button. No scroll needed.
- The user lands on their station panel. Home is always accessible one tap left.
- No multi-panel management UI is shown.

### 12.6 Safe area

The workspace outlet respects `env(safe-area-inset-bottom)`. The Panel Strip is above the outlet — it does not sit in the safe area.

---

## 13. Desktop and Tablet Behavior

### 13.1 v1 scope: tabs only, no split view

Desktop behavior in v1 is identical to mobile except:
- The Panel Strip renders across the full viewport width.
- Chips have minimum width 100px, maximum 200px. They do not scroll — they truncate labels instead.
- If 6 panels are open at full desktop width, labels truncate. The strip never wraps.

No split view. No side-by-side panels. These are future milestones validated after mobile.

### 13.2 Kitchen Monitor (deferred)

The Kitchen Display (`display.html`) is a separate read-only mode derived from live operational state. It does not use the Workspace Engine. It is not addressed in this document.

### 13.3 Desktop keyboard behavior (future)

Panel switching by keyboard shortcut (`Cmd+1` through `Cmd+6`). Deferred — no API change required.

---

## 14. Navigation Rules

### 14.1 What opens a new panel

Opening a new panel is triggered by explicit user action:
- Station user: automatic on login (their default station).
- Executive chef: tapping `+` → selecting a station from the selector.
- (Future) Tapping a recipe title in a prep task detail → opens `recipe-detail` panel.
- (Future) Tapping a station name in the Home briefing → opens `station-prep` panel.

**Rule**: A new panel is only opened when the user explicitly requests it. Navigation within an existing panel (e.g., expanding a task, viewing a suggestion) never opens a new panel.

### 14.2 What reuses an existing panel

Any `openPanel(type, context)` call where type + canonical context matches an existing panel in the registry activates the existing panel. No new panel is created.

### 14.3 What replaces the current panel

Nothing replaces the current panel in v1. Every open call either:
1. Creates a new panel (if no duplicate).
2. Activates an existing panel (if duplicate).

The concept of "navigate to" (which replaces) is the router's model. The WorkspaceManager's model is "open in addition to" (additive). This is the fundamental difference.

---

## 15. Internal JS Module Architecture

### 15.1 Module Map

```
boh-v2/src/core/
  workspace-manager.js      ← NEW: central engine (Step WS-02)

boh-v2/src/components/
  app-shell/
    app-shell.js            ← MODIFIED: add panelStripMount div (Step WS-01)
  workspace/                ← NEW directory
    panel-strip.js          ← NEW: renders the Panel Strip DOM
    panel-icons.js          ← NEW: maps panel type → icon glyph

boh-v2/src/modes/
  station/
    station-navigation.js   ← MODIFIED: delegate to WorkspaceManager (Step WS-04)

boh-v2/src/app.js           ← MODIFIED: init WorkspaceManager (Step WS-03)
```

No other files change for WS-01 through WS-05. All services, all CSS, all existing components: untouched.

### 15.2 WorkspaceManager

```js
// workspace-manager.js

export function createWorkspaceManager({ outlet, panelStripMount }) → workspaceManager
```

**Internal state** (module-scope, not exported):
```js
let _state = {
  panels:   [],     // PanelDescriptor[] — ordered registry
  activeId: null,   // string | null — pointer into panels
}
let _renderers = {} // { [type]: rendererFn } — registered panel renderers
let _counter   = 0  // monotonic panel ID counter
```

No history pointer. No `_prevId`. Fallback on close is computed from registry position at the moment of close — see §7.

**`destroy()` resets all module-scope state to initial values:**
```js
function destroy() {
  outlet.innerHTML = '';
  panelStripMount.innerHTML = '';
  _state     = { panels: [], activeId: null };
  _renderers = {};
  _counter   = 0;
}
```

After `destroy()`, the module is safe for `createWorkspaceManager()` to be called again in the same tab. The renderer registry is cleared — all renderers must be re-registered on every `mountShell()` call. This is the designed behavior.

**Public API:**

```js
workspaceManager.registerRenderer(type, fn)
  // fn(context) → HTMLElement  (MUST be synchronous — see §3.3)
  // Always overwrites previous registration for the same type.
  // Must be called before openPanel(type, ...)

workspaceManager.openPanel(type, context)
  // → panelId (string)
  // If duplicate: activates existing panel, returns its ID
  // If at limit: renders inline notification, returns null
  // If unknown type: silently ignores, returns null

workspaceManager.closePanel(panelId)
  // No-op if panelId === 'panel-home'
  // No-op if panelId not in registry
  // Removes panel, selects left-neighbor fallback, activates it

workspaceManager.activatePanel(panelId)
  // No-op if already active
  // No-op if panelId not in registry
  // Calls renderer, mounts DOM, updates Panel Strip

workspaceManager.currentPanel()
  // → PanelDescriptor | null

workspaceManager.destroy()
  // Resets all module-scope state (_state, _renderers, _counter) to initial values.
  // Clears outlet DOM and Panel Strip DOM.
  // Safe to call createWorkspaceManager() again after this.

// Internal only (not exported):
_renderPanelStrip()
_selectFallback(closedId)   // returns left neighbor ID, or 'panel-home'
_isDuplicate(type, context)
_dedupeKey(type, context)
```

**`_selectFallback` implementation contract:**
```js
function _selectFallback(closedId) {
  const idx = _state.panels.findIndex(p => p.id === closedId);
  const neighbor = _state.panels[idx - 1];
  return neighbor ? neighbor.id : 'panel-home';
}
```
Called before the closed panel is removed from the registry, so `idx` is always valid.

**PanelDescriptor:**
```js
{
  id:      'panel-station-prep-2',    // panel-{type}-{counter}
  type:    'station-prep',
  title:   'Saucier Station',
  context: { stationName: 'Saucier Station' },
}
```

Home PanelDescriptor:
```js
{
  id:      'panel-home',
  type:    'home',
  title:   'Home',
  context: {},
}
```

### 15.3 PanelStrip

```js
// panel-strip.js

export function renderPanelStrip({ panels, activeId, onActivate, onClose, atLimit })
  // → HTMLElement (the strip root div)
  // Called by WorkspaceManager._renderPanelStrip()
  // Pure function: same inputs → same DOM structure
  // WorkspaceManager replaces panelStripMount.firstChild on every call
```

Chip structure:
```html
<div class="ws-strip" role="tablist">
  <button class="ws-chip ws-chip--active" role="tab" data-panel-id="panel-home"
          aria-selected="true">
    🏠 Home
  </button>
  <button class="ws-chip" role="tab" data-panel-id="panel-station-prep-2"
          aria-selected="false">
    🍳 Saucier
    <span class="ws-chip__close" aria-label="Close Saucier Station">×</span>
  </button>
  <button class="ws-chip ws-chip--add" aria-label="Open another station"
          hidden><!-- hidden when atLimit -->
    +
  </button>
</div>
```

Accessibility: `role="tablist"` on strip, `role="tab"` + `aria-selected` on chips, `aria-label` on close and add buttons.

### 15.4 PanelIcons

```js
// panel-icons.js

export const PANEL_ICONS = {
  'home':            '🏠',
  'station-prep':    '🍳',
  'station-recipes': '📖',
  'recipe-detail':   '📋',
  'journal':         '📓',
  'schedule':        '📅',
}
// Falls back to '□' for unknown types
```

### 15.5 App Shell changes (WS-01)

`app-shell.js` adds one div:
```js
// After header, before existing nav mount point:
const panelStripMount = document.createElement('div');
panelStripMount.className = 'app-shell__panel-strip';
shell.insertBefore(panelStripMount, navMount);

// app-shell returns:
return { shell, navMount, panelStripMount, contentOutlet };
```

### 15.6 app.js changes (WS-03, WS-05)

```js
// WS-03: init WorkspaceManager alongside existing flow
const { outlet, navMount, panelStripMount } = appShell;
const workspaceManager = createWorkspaceManager({ outlet, panelStripMount });
workspaceManager.registerRenderer('home', () => createHomePlaceholder());
workspaceManager.openPanel('home', {});
// ... existing setupStationNavigation call unchanged

// WS-05: open station panel for station users
if (user.defaultStation) {
  workspaceManager.openPanel('station-prep', { stationName: user.defaultStation });
}
```

### 15.7 station-navigation.js changes (WS-04)

`handleStationSelect` becomes:
```js
function handleStationSelect(stationName) {
  workspaceManager.openPanel('station-prep', { stationName });
}
```

The `station-prep` renderer is registered using the skeleton-first pattern (see §3.3):
```js
workspaceManager.registerRenderer('station-prep', ({ stationName }) => {
  return createStationPrep({
    stationName,
    // ... all existing injected services unchanged
  });
  // createStationPrep already implements the skeleton-first pattern
  // and guards all async mutations with isConnected — no change required
});
```

`router.register('station-prep', ...)` remains for the transition period (Step WS-04). Removed at Step WS-05.

---

## 16. State Diagram (complete)

```
SESSION START
     │
     ▼
[authenticate]
     │
     ▼
[mountShell(user)]
     │
     ▼
[WorkspaceManager.create]──────────────────────────────────────┐
     │   _state = { panels:[], activeId:null }                  │
     │   _renderers = {}   _counter = 0                         │
     ▼                                                          │
[open('home')]                                                  │
     │                                                          │
     ├── user.defaultStation?                                   │
     │      YES → [open('station-prep', { stationName })]      │
     │               │                                          │
     │               ▼                                          │
     │          [station panel ACTIVE]                          │
     │                                                          │
     │      NO  → [home ACTIVE]                                 │
     │                                                          │
     ▼                                                          │
[WORKSPACE RUNNING]                                             │
     │                                                          │
     ├── user taps chip ──────────────────► [activatePanel]     │
     │                                          │               │
     │                                          ▼               │
     │                                    [panel ACTIVE]        │
     │                                    [prev DORMANT]        │
     │                                                          │
     ├── user taps + → selects station ──► [openPanel]          │
     │                                          │               │
     │                                    duplicate?            │
     │                                     YES → [activate]     │
     │                                     NO  → [create]       │
     │                                          │               │
     │                                    at limit?             │
     │                                     YES → [notify]       │
     │                                     NO  → [mount, ACTIVE]│
     │                                                          │
     ├── user taps × on chip ─────────────► [closePanel]        │
     │                                          │               │
     │                                    [_selectFallback]     │
     │                                    → left neighbor       │
     │                                    → or Home             │
     │                                    [remove from registry]│
     │                                    [activate fallback]   │
     │                                                          │
     ├── user logs out ───────────────────► [destroy()]         │
     │                                    [_state reset]        │
     │                                    [_renderers reset]    │
     │                                    [_counter reset]      │
     │                                    [DOM cleared]         │
     │                                    → login screen        │
     │                                    → safe for re-login   │
     │                                                          │
     └── user closes browser / reloads ──────────────────────► [death]
```

---

## 17. UI Behavior Rules

These rules are the implementation contract. Every one must be respected.

**R-01.** Home is always the leftmost chip in the Panel Strip. Home chip has no close button.

**R-02.** A station user sees at most two chips: Home + their station. No `+` button.

**R-03.** An executive chef sees Home + up to five station chips + `+` button (hidden at limit).

**R-04.** The active chip has a filled background. Dormant chips are outlined or ghost.

**R-05.** Activating a panel is instant in v1. No animation required. Scroll position is not preserved across switch-away (re-render on activation).

**R-06.** Closing a panel activates the left neighbor in the registry. If no left neighbor exists, Home is activated. There is no history-based fallback.

**R-07.** Opening a duplicate panel (same type + canonical context) silently activates the existing one. No notification.

**R-08.** Opening a panel when at the limit (6) shows an inline notification in the Panel Strip. No new panel is created.

**R-09.** The `+` button is hidden when `panels.length >= 6`. It reappears when a panel is closed.

**R-10.** The WorkspaceManager never calls `router.navigate()`. The router is used only during the WS-03/WS-04 transition period, and only by `station-navigation.js` for the bottom-bar paths. At WS-05, the router is retained as an internal mechanism but is no longer the primary navigation path.

**R-11.** Panels know nothing about the WorkspaceManager. They accept services via injection. They return `HTMLElement` synchronously. The WorkspaceManager mounts and unmounts them — they never mount themselves.

**R-12.** The WorkspaceManager does not know about Supabase, services, or prep tasks. It knows panel types, panel IDs, and renderers.

**R-13.** `WorkspaceState` is never exported. External code uses the public API only.

**R-14.** The Panel Strip is replaced (not patched) on every state change. `_renderPanelStrip()` calls `renderPanelStrip(...)` and replaces `panelStripMount.firstChild`.

**R-15.** Dirty state is not implemented in v1. No confirmation is shown when switching panels with an open form.

**R-16.** Session restore is not implemented in v1. Reload means re-authenticate.

**R-17.** `destroy()` is called on logout. It resets `_state`, `_renderers`, and `_counter` to initial values. It clears outlet DOM and Panel Strip DOM. It is not called on reload.

**R-18.** The `+` button on mobile opens the Station Selector as a modal overlay. The Station Selector is not a panel.

**R-19.** Panel chip labels are truncated to 12 characters on mobile, 24 characters on desktop. Full title available via `title` attribute for tooltip.

**R-20.** No `localStorage` or `sessionStorage` in v1. All WorkspaceState is in-memory.

**R-21.** Renderer functions MUST be synchronous and MUST return a valid `HTMLElement` immediately. Returning `Promise<HTMLElement>` or `null` is a specification violation. Async data loading uses the skeleton-first pattern: return skeleton immediately, populate asynchronously, guard every DOM mutation with `isConnected`.

---

## 18. Implementation Roadmap

The implementation sequence follows `WORKSPACE_ARCHITECTURE.md` §15 exactly, extended here with sub-tasks and estimated complexity.

### Phase A — Foundation (WS-01 through WS-03)

| Step | File | Change | Complexity |
|---|---|---|---|
| WS-01 | `app-shell.js` | Add `div.app-shell__panel-strip` mount point | XS |
| WS-01 | `styles/app-shell.css` | Add `.app-shell__panel-strip` layout rule (height 0 in v1, no chips yet) | XS |
| WS-02 | `src/core/workspace-manager.js` (NEW) | Full WorkspaceManager: panel registry, open/close/activate, left-neighbor fallback, destroy() full reset, skeleton-first renderer contract | M |
| WS-02 | `src/components/workspace/panel-strip.js` (NEW) | `renderPanelStrip()` pure function | S |
| WS-02 | `src/components/workspace/panel-icons.js` (NEW) | Icon map | XS |
| WS-02 | `styles/panel-strip.css` (NEW) | Strip, chip, active state, close, add button styles | S |
| WS-03 | `src/app.js` | Init WorkspaceManager, register home renderer (skeleton-first), open Home panel | S |

After WS-03: Home chip appears in the Panel Strip alongside the still-functional bottom bar. Both navigation paths work. The app is fully usable.

### Phase B — Station Panel Integration (WS-04)

| Step | File | Change | Complexity |
|---|---|---|---|
| WS-04 | `src/modes/station/station-navigation.js` | Register `station-prep` renderer, delegate `handleStationSelect` to WorkspaceManager | S |
| WS-04 | `src/app.js` | Pass WorkspaceManager to `setupStationNavigation` | XS |

After WS-04: Station prep panels open through the WorkspaceManager. The bottom bar `Prep` button still works via `router.navigate`. Both paths reach the same renderer. The app is fully usable.

### Phase C — Bottom Bar Retirement (WS-05)

| Step | File | Change | Complexity |
|---|---|---|---|
| WS-05 | `src/app.js` | Open station panel automatically for station users with `defaultStation` | S |
| WS-05 | `src/modes/station/station-navigation.js` | Remove bottom nav creation, remove router nav calls | S |
| WS-05 | `src/components/app-shell/app-shell.js` | Remove nav mount point | XS |

After WS-05: The bottom bar is gone. The Panel Strip is the sole navigation. The app is fully usable.

### Phase D — Visual Language (WS-06, separate milestone)

Port Shell Lab design tokens into `tokens.css` and `base.css`. This is a purely visual change — no architectural impact. Deferred to a dedicated session.

### Deferred (not sequenced yet)

- DOM caching across panel switches (zero API change, WorkspaceManager internal only)
- AbortController per panel renderer (optional parameter, zero impact on renderers that ignore it)
- Dirty state guard (optional `isDirty()` on renderer, zero impact on renderers that don't implement it)
- Session restore via sessionStorage (serialize PanelDescriptors only)
- Recipe panels (`station-recipes`, `recipe-detail`)
- Journal panel
- Chef AI contextual drawer (not a panel — a drawer anchored to the active panel)
- Kitchen Display workspace mode (entirely separate architecture)

---

## 19. Non-Goals

This document does not define:

- Home panel content (briefing, bot status, prep summary) — separate milestone.
- Recipe panel UI — separate milestone, begins only after WS-05 is verified on iPhone.
- Visual design, colors, typography — covered by WS-06 (design token import).
- Chef AI drawer implementation — separate milestone.
- Kitchen Display architecture.
- Daily Journal UI.
- Database schema changes.
- Any business logic.
- Any service layer.
- Any RPC.

---

## 20. Approval Checkpoint

Before any implementation of Phase A (WS-01 through WS-03):

- [ ] Max confirms that the Panel Strip position (between header and content) is correct for iPhone.
- [ ] Max confirms that station users land directly on their station panel (not Home) on login.
- [ ] Max confirms the chip anatomy (icon + truncated label + ×).
- [ ] Max confirms the panel limit of 6 for v1.
- [ ] Max confirms that dirty-state warning is NOT needed in v1 (switching freely, form state lost on switch).
- [ ] Max confirms that session restore is NOT needed in v1 (reload = re-authenticate).

Implementation begins only after all six items above are checked.

---

## Appendix A — Future Review Notes

The following issues were identified in the v1.0 architectural review but are deferred from this specification. They do not block implementation of WS-01 through WS-05. They should be revisited before recipe panels (WS-future) are implemented.

**A1 — `openPanel` return value cannot distinguish failure reasons.**
`openPanel` returns `null` for both "at limit" and "unknown type". Callers cannot distinguish them. No error is logged for unknown types. Risk: a typo in a panel type constant fails silently. Proposed fix when recipe panels are added: `console.error` on unknown type, or a structured return `{ panelId, error }`.

**A2 — Close button accessibility and tap target.**
The close `<span>` inside the chip `<button>` is not announced as a separate interactive element by screen readers. The 20×20px tap target is below WCAG minimum (44×44px). Proposed fix before kitchen staff use executive chef mode: replace the `<span>` with a sibling `<button>` element; expand tap target via CSS padding.

**A3 — Panel ID format contains hyphens matching the type separator.**
`panel-station-prep-2` cannot be reliably parsed to extract type or counter. Currently no code path needs to parse IDs — all lookups use the full ID. If any future tooling (debugging, session restore) ever needs to parse an ID, it will fail for hyphenated types. Proposed fix if needed: document IDs as opaque, or change separator to `:`.

**A4 — `title` attribute tooltip is not available on iPhone.**
The `title` attribute on chips provides the full station name on desktop hover but is never shown on iOS. Chips truncated to 12 characters may be ambiguous on mobile. Proposed fix: ensure no two active stations share the same 12-character prefix, or add a long-press label on mobile.

**A5 — Panel limit notification text is hardcoded English in the current spec.**
The notification "Close a panel to open a new one" should go through `t('workspace.limit_reached')` to respect user language preference (IT/EN/ES). Proposed fix before v1 ships to non-English kitchen staff.

**A6 — Panels must not attach event listeners to the outlet element.**
The spec prohibits panels from knowing about the outlet, but does not make this mechanically impossible. If any future panel attaches listeners to `outlet` directly, those listeners survive `destroy()` and fire in the next session. R-11 covers this implicitly; an explicit prohibition should be added if the pattern becomes a concern.

---

*End of Workspace Engine Specification v1.1.*  
*Companion document: `boh-v2/docs/WORKSPACE_ARCHITECTURE.md` v1.0 (2026-07-15)*  
*Supersedes: `boh-v2/docs/BOH_OS_V2_WORKSPACE_ENGINE.md` v1.0*
