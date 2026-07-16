# BOH OS v2 — Home Block Engine Specification

> Version 1.1 · 2026-07-16  
> Status: **APPROVED FOR IMPLEMENTATION — pending Max sign-off on §15**  
> Depends on: Workspace Engine v1.1, Home Composition Engine v1.0  
> Scope: Architecture only. No code implementation. No UI. No colors.  
> Changes from v1.0: five corrections applied per architectural review — unified settlement protocol (`onBlockReady` only, `onBlockEmpty` removed); pseudocode demoted to illustrative and corrected (`_lastUrgencyScore`, `computeUrgency`, `destroy()` reset, renderer consistency); `home-data-service.js` retired in favour of `BLOCK_FETCHERS`; `canRender()` removed from mandatory contract; `BLOCK_RENDERERS` declared as object (not factory); `BLOCK_DEFINITIONS.permittedRoles` declared the executable authority for role gates. All other review notes deferred to Appendix A.

---

## 0. What This Document Is

The Home Composition Engine (v1.0) defines **which blocks appear on Home** and in what order.

This document defines **what a block is** — the internal architecture every block must follow, the contract every block must honour, and the infrastructure every block receives. It is the block's constitution.

Every future block, without exception, is built against this specification. No block may deviate from the contract defined here. When a new block is added, this document is the primary reference. If this document and the Composition Engine conflict, this document governs on matters of internal block behaviour; the Composition Engine governs on matters of composition and ordering.

**Role gate authority.** Role gates written in the Home Composition Engine document are descriptive documentation only — they describe intent for human readers. The authoritative, executable role gate for each block is `BLOCK_DEFINITIONS[blockId].permittedRoles` defined in §10.2 of this document. When implementing a block, `permittedRoles` is the gate that is enforced at runtime. If the two ever differ, `permittedRoles` governs and the Composition Engine prose must be updated to match.

---

## 1. The Block Mental Model

A block is not a component. It is not a widget. It is not a card.

A block is a **self-contained unit of operational intelligence** that knows how to:
1. Fetch the data it needs, given a user context.
2. Decide whether it has anything worth showing.
3. Render that content into a DOM element.
4. Communicate its urgency to the composition engine.
5. Clean up after itself.

A block knows nothing about:
- Other blocks.
- Home's layout or ordering.
- The Workspace Engine.
- Supabase directly (it receives data through injected services).
- App state directly (it receives the user through injection).

A block is the smallest unit that can independently fail without taking anything else down with it.

---

## 2. Block Lifecycle

Every block passes through these states in order. States are not stored as strings — they are implicit in the control flow. They are named here for specification clarity.

```
CREATED → FETCHING → [LOADED | EMPTY | ERROR] → DESTROYED
```

### 2.1 CREATED

A block instance is created when the home panel renderer requests it. Creation is synchronous. The block allocates its root DOM element (the skeleton) and returns it immediately. No network calls happen in CREATED.

The root DOM element at this point contains only the skeleton: a placeholder structure that will be replaced by real content when the fetch completes.

### 2.2 FETCHING

Immediately after returning the skeleton, the block's internal fetch begins asynchronously. The block calls its injected fetch service, waits for the result, and transitions to one of three terminal display states.

The block is responsible for its own fetch lifecycle. It does not report fetch progress to Home or to the composition engine. The skeleton communicates FETCHING to the user.

### 2.3 LOADED

The fetch returned data that passes the block's `hasContent` check. The block replaces or populates its skeleton DOM with the real content. The `isConnected` guard MUST be checked before any DOM mutation.

This is the display state where the block shows meaningful operational information.

Settlement: the block calls `deps.onBlockReady(blockId, { hasContent: true, urgencyScore: result.urgencyScore })`.

### 2.4 EMPTY

The fetch returned successfully, but the data does not meet the `hasContent` threshold (e.g., no urgent alerts, no handoffs). The block removes its root element from the DOM and signals its settled state to the home panel renderer.

An empty block is invisible. It does not show an empty-state message, a "nothing to show" placeholder, or any container whatsoever.

Settlement: the block calls `deps.onBlockReady(blockId, { hasContent: false, urgencyScore: 0 })`, then removes its root element. This is the only settlement callback. There is no separate `onBlockEmpty` callback.

### 2.5 ERROR

The fetch failed (network error, timeout, service error). The block renders a minimal, non-alarming error state in its root element. The error is local to the block. No other block is affected. Home does not fail.

The error state contains: a brief human-readable message (via `t()`) and, if appropriate, a retry affordance. It does not show technical details (no error codes, no stack traces, no Supabase messages).

Settlement: the block calls `deps.onBlockReady(blockId, { hasContent: true, urgencyScore: 0 })`. An error block counts as settled and counts as content — it occupies a slot in the layout.

### 2.6 DESTROYED

The block is destroyed when Home is deactivated (user switches to another panel) or when the session ends. Destruction clears any timers, cancels any in-flight requests via `AbortController` (when implemented — see §6.5), and removes any residual event listeners attached during `LOADED`.

Destruction is triggered by the home panel renderer calling each mounted block's `destroy()` method before unmounting the home DOM.

### 2.7 State transition diagram

```
                    ┌──────────────────────┐
   createBlock()    │                      │
  ────────────────► │      CREATED         │
                    │  (skeleton mounted)   │
                    └──────────┬───────────┘
                               │
                    internal fetch begins
                               │
                    ┌──────────▼───────────┐
                    │                      │
                    │      FETCHING        │
                    │  (skeleton visible)   │
                    └──────────┬───────────┘
                               │
               ┌───────────────┼────────────────┐
               │               │                │
               ▼               ▼                ▼
        ┌────────────┐  ┌────────────┐  ┌─────────────┐
        │   LOADED   │  │   EMPTY    │  │    ERROR    │
        │ onBlockReady│  │ onBlockReady│  │ onBlockReady│
        │ hasContent: │  │ hasContent: │  │ hasContent: │
        │    true    │  │    false   │  │    true    │
        └──────┬─────┘  └──────┬─────┘  └──────┬──────┘
               │               │                │
               └───────────────┴────────────────┘
                               │
                    all blocks settled
                    (home panel renderer
                     triggers reorder pass)
                               │
                           destroy()
                               │
                    ┌──────────▼───────────┐
                    │                      │
                    │     DESTROYED        │
                    │                      │
                    └──────────────────────┘
```

Every terminal state calls `deps.onBlockReady` exactly once. This is the settlement signal for the home panel renderer. There are no other settlement callbacks.

---

## 3. The Block Contract

Every block MUST implement the following interface. No method is optional. The implementation may be a no-op (e.g., `destroy()` does nothing for a block with no timers), but the method must exist.

### 3.1 `createBlock(deps) → BlockInstance`

The block factory function. Always named `createBlock` at the module level; the module filename determines which block it is.

`deps` is the dependency object — see §9 for the complete dependency injection specification.

Returns a `BlockInstance` synchronously. The `BlockInstance` contains the root DOM element (already in skeleton state) and the methods below.

```
BlockInstance {
  root:    HTMLElement   ← the skeleton root, returned to the home renderer
  destroy: () → void
  refresh: () → void     ← triggers a re-fetch in place (§8)
}
```

The `root` element is the only DOM the block owns. The home renderer mounts `root` into the Home panel. The block may mutate `root` and its descendants freely. It must never touch any DOM outside `root`.

### 3.2 `destroy() → void`

Called by the home panel renderer when Home is deactivated or the session ends. The block MUST:
- Set its internal `destroyed` flag to `true`.
- Set its internal `fetchInProgress` flag to `false`.
- Cancel any in-flight fetch via `AbortController.abort()` (when AbortController is implemented).
- Clear any `setTimeout` or `setInterval` timers.
- Remove any event listeners attached to elements outside `root` (listeners on elements inside `root` are removed automatically when `root` is removed from the DOM).

The block MUST NOT:
- Throw an error if `destroy()` is called before FETCHING begins.
- Throw an error if `destroy()` is called more than once.
- Mutate the DOM after `destroy()` is called.

`destroy()` is always safe to call at any lifecycle stage. Setting `fetchInProgress = false` inside `destroy()` ensures that any settled fetch callbacks that fire after `destroy()` abort cleanly via the `destroyed` guard without leaving inconsistent flag state.

### 3.3 `refresh() → void`

Triggers a re-fetch and re-render of the block content in place, without rebuilding Home. Called by the home panel renderer in response to an explicit refresh request (future: also called by the Realtime subscription system).

`refresh()` transitions the block back to FETCHING (showing the skeleton again), then to LOADED, EMPTY, or ERROR. The root DOM element is reused — it is not replaced.

`refresh()` is a no-op if:
- `destroy()` has already been called.
- A fetch is already in progress.

### 3.4 Internal method: `_fetch(signal) → Promise<void>`

Not part of the public contract — internal to the block module. Called once from `createBlock()` immediately after returning the `BlockInstance`. Accepts an `AbortSignal` for cancellation (when AbortController is implemented).

`_fetch()` is responsible for:
1. Calling the injected fetch service.
2. Evaluating `hasContent` on the result.
3. Transitioning to LOADED, EMPTY, or ERROR.
4. Calling `isConnected` before any DOM mutation.
5. Storing the resolved urgency score in `_lastUrgencyScore`.
6. Calling `deps.onBlockReady(blockId, { hasContent, urgencyScore })` exactly once, in all three terminal states.

### 3.5 Internal method: `_renderContent(data) → void`

Not part of the public contract — internal to the block module. Called from `_fetch()` when the data is LOADED. Replaces the skeleton content of `root` with real content. Always guarded by `isConnected`.

### 3.6 Internal method: `_renderError(deps) → void`

Not part of the public contract — internal to the block module. Called from `_fetch()` on ERROR. Replaces the skeleton content with a minimal error message and optional retry affordance. Receives `deps` so the error renderer can call `deps.translate()`.

### 3.7 Internal method: `_renderSkeleton() → void`

Not part of the public contract — internal to the block module. Called from `createBlock()` to set the initial skeleton state. Also called from `refresh()` to reset the block to the loading state before re-fetching.

---

## 4. Skeleton Loading Behaviour

### 4.1 The skeleton is real DOM, not a placeholder

The skeleton is a valid `HTMLElement` with structural markup — not an empty div, not a spinner overlay, not a grey rectangle. It mirrors the shape of the loaded content: if the LOADED state shows a list of 3 items, the skeleton shows 3 placeholder rows of the same approximate dimensions.

This prevents layout reflow when content loads. The page height does not jump. The user's eye does not lose its place.

### 4.2 Skeleton construction is synchronous and instant

`createBlock()` returns the skeleton before any async operation begins. This is not optional — it is required by the Workspace Engine v1.1 renderer contract (R-21): the renderer function MUST return a valid `HTMLElement` immediately.

The Home panel renderer mounts all block skeletons synchronously, then waits for fetches to complete asynchronously.

### 4.3 Skeleton-to-content transition

When `_fetch()` completes with data, `_renderContent()` is called. It operates on the already-mounted `root` element. It does not create a new root element — it mutates the existing one.

The transition pattern:
```
root.innerHTML = '';               // clear skeleton
root.appendChild(contentNode);    // insert real content
root.classList.remove('block--loading');
root.classList.add('block--loaded');
```

The `isConnected` guard is called immediately before `root.innerHTML = ''`. If the guard fails, the transition is aborted and the skeleton remains (it will be removed when `root` is detached from the DOM).

### 4.4 Skeleton persistence on error

On ERROR, the skeleton is replaced by the error state (via `_renderError(deps)`). The error state uses the same root element. The skeleton is never shown simultaneously with the error state.

### 4.5 Skeleton removal on empty

On EMPTY, the root element is removed from the DOM entirely, after `onBlockReady` is called:
```
deps.onBlockReady(blockId, { hasContent: false, urgencyScore: 0 })
if (root.isConnected) root.remove()
```

`onBlockReady` is always called before `root.remove()`. This guarantees the home panel renderer can track settlement before the element disappears.

### 4.6 No skeleton flicker on fast fetches

If a fetch completes before the browser has had a chance to paint the skeleton, the user sees only the loaded content. There is no forced minimum skeleton display time. Speed is preferred over visual consistency.

---

## 5. Error Handling

### 5.1 Block failure is local

If a block's fetch throws or rejects, that block transitions to ERROR. All other blocks are unaffected. Home does not fail. Home does not show a global error state.

This is the most important rule in this section. A block is the failure boundary.

### 5.2 Error isolation mechanism

Each block's `_fetch()` wraps its fetch service call in a try/catch. The catch handler calls `_renderError(deps)`. Nothing leaks out of the block.

The control flow for all three terminal states is shown in the §10.5 illustrative pseudocode. The authoritative rules for each state are:

- **LOADED**: `_lastUrgencyScore = result.urgencyScore`; render content; call `onBlockReady(blockId, { hasContent: true, urgencyScore: result.urgencyScore })`.
- **EMPTY**: `_lastUrgencyScore = 0`; call `onBlockReady(blockId, { hasContent: false, urgencyScore: 0 })`; remove root.
- **ERROR**: `_lastUrgencyScore = 0`; render error; call `onBlockReady(blockId, { hasContent: true, urgencyScore: 0 })`.

In all three paths: `_lastUrgencyScore` is assigned before `onBlockReady` is called. `onBlockReady` is called exactly once. `isConnected` is checked before any DOM mutation.

### 5.3 Error state counts as content

An error block is visible — it shows a message. It is not removed from the layout. It counts as `hasContent: true` for composition purposes, so it occupies a slot in the `HOME_MAX_BLOCKS` budget.

Rationale: a missing block is confusing. A cook who expects to see their prep priorities sees nothing — no explanation. An error state tells them something went wrong. That is more informative than silence.

### 5.4 Error state content rules

The error state for any block is:
- A one-line message: `t('home.block_error')` — e.g., "Unable to load. Pull down to refresh."
- No technical details.
- No block-specific context in the error message (the block type is visible from the block's header if present).
- A retry action: calling `refresh()` on the block. The retry affordance is a single tap target — no elaborate UI.

The error state MUST NOT show:
- HTTP status codes.
- Supabase error messages.
- JavaScript error messages.
- Stack traces.

### 5.5 Timeout

A block fetch that takes longer than **8 seconds** is treated as an error. The block transitions to ERROR at 8 seconds regardless of whether the request is still pending.

8 seconds is a constant: `BLOCK_FETCH_TIMEOUT_MS = 8000`.

The timeout is implemented with a `Promise.race` inside `_fetch()`:

```
const result = await Promise.race([
  deps.fetchService(deps.user, signal),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), BLOCK_FETCH_TIMEOUT_MS)
  )
]);
```

When AbortController is implemented, the timeout also calls `controller.abort()`.

### 5.6 Retry

A block in ERROR state may be retried by calling `refresh()`. There is no automatic retry. There is no exponential backoff in v1. The cook taps the retry affordance, `refresh()` is called, and the block transitions back to FETCHING.

---

## 6. Performance

### 6.1 All blocks fetch in parallel

The home panel renderer launches all block fetches simultaneously. No block waits for another block to complete before starting its own fetch. The first block to finish renders its content; others follow independently.

The home panel renderer tracks settlement by counting `onBlockReady` calls. When the count equals the number of mounted blocks, all blocks have settled and the post-load reorder pass fires. This is the settlement protocol — `onBlockReady` is its sole signal.

### 6.2 Progressive rendering

Blocks do not wait for all fetches to complete before showing content. Each block transitions independently from FETCHING to LOADED/EMPTY/ERROR as its own fetch completes.

The home panel renderer performs a final reorder pass after all `onBlockReady` calls have been received, but the user sees content progressively — fast blocks appear first, slow blocks appear later within their skeleton bounds.

### 6.3 The `onBlockReady` callback and post-load reorder

Each block calls `deps.onBlockReady(blockId, { hasContent, urgencyScore })` exactly once, in every terminal state (LOADED, EMPTY, or ERROR). This is the sole settlement signal.

`onBlockReady` is injected into every block via `deps`. It is a function provided by the home panel renderer.

After all blocks have called `onBlockReady`, the home panel renderer:
1. Removes from the layout any blocks where `hasContent: false` (their root elements are already gone — this is a layout cleanup pass only).
2. Performs one reorder pass using the `urgencyScore` values received, updating the CSS `order` property of each remaining block's root element. No DOM node is moved. No block is re-rendered.

### 6.4 Lazy loading (future)

In v1, all blocks in the permitted catalog are fetched in parallel on Home activation. There is no lazy loading.

Future: blocks below the fold may defer their fetch until the user scrolls within range. This requires an IntersectionObserver hooked into the block lifecycle. The block contract accommodates this: `_fetch()` can be deferred; the skeleton remains visible until called. No contract change is required.

### 6.5 AbortController (future — spec defined now)

AbortController is not implemented in v1. When implemented, the contract is:

Every block's `createBlock()` creates an `AbortController` internally. The `AbortSignal` is passed to `_fetch()` and from there to the fetch service call. `destroy()` calls `controller.abort()`.

The block's fetch service (injected) MUST accept an optional `signal` parameter and forward it to the underlying network call.

Because the contract slot (`signal` parameter) is defined now, adding AbortController in a future session requires only: (a) passing a real signal instead of `undefined`, and (b) ensuring fetch services forward it. No block contract change.

### 6.6 Priority loading (future)

In v1, all blocks have equal fetch priority. Future: blocks with `basePriority < 3` (greeting, urgent_alerts, station_focus) may be fetched first, with lower-priority blocks deferred until the high-priority blocks are LOADED or ERROR. Implementation: two phases, high-priority first. No contract change required.

---

## 7. Caching

### 7.1 v1: No cache

In v1, there is no caching. Every Home activation triggers fresh fetches for all blocks. Fetched data is held only in the block's closure for the duration of the current activation. It is discarded when the block is destroyed.

This is deliberate: the data on Home (prep priorities, stock levels, alerts) changes during a shift. A cache that returns stale prep priorities is worse than no cache.

### 7.2 In-memory session cache (future, opt-in per block)

The block contract reserves a cache slot in `deps`:

```
deps.blockCache    ← a shared in-memory key-value store, scoped to the session
```

A block that opts into caching reads from `deps.blockCache.get(blockId)` before fetching. If a valid cached entry exists (within TTL), the block skips the network fetch and uses the cached data.

The cache is in-memory only. It is never written to `sessionStorage` or `localStorage`. It is reset on logout (same lifecycle as all other in-memory state).

Not all blocks should cache. Blocks whose data changes frequently (`urgent_alerts`, `low_stock`, `wip_handoffs`) MUST NOT cache. Blocks whose data is stable for hours (`yesterday_recap`, `birthdays`) MAY opt in.

The `blockCache` object in `deps` is always provided — blocks that do not use it simply ignore it. No contract change when caching is added to a specific block.

### 7.3 Cache TTL

Each block that opts in defines its own TTL as a constant inside its module. The cache entry stores: `{ data, fetchedAt }`. A cache hit requires `Date.now() - fetchedAt < TTL_MS`.

Suggested TTLs (not enforced in v1 — informational):
- `birthdays`: 4 hours (changes only at midnight)
- `yesterday_recap`: 2 hours (updates after nightly import, stable after that)
- `chef_ai_brief`: 1 hour (pre-computed, does not change during shift)

### 7.4 Cache invalidation

Cache is invalidated explicitly by calling `deps.blockCache.invalidate(blockId)`. This is called when `refresh()` is triggered — the block bypasses the cache and fetches fresh data, then updates the cache entry.

There is no time-based cache eviction in v1 other than session end.

---

## 8. Refresh Model

### 8.1 A block refreshes without rebuilding Home

`refresh()` updates the block's content in place. The home panel renderer does not re-run. Other blocks are not re-fetched. The block's root DOM element stays in its current position in the layout.

Sequence:
1. `refresh()` is called on a specific block instance.
2. Block transitions back to FETCHING: `_renderSkeleton()` is called, replacing current content with the skeleton.
3. `_fetch()` is called again (with a new AbortController when implemented).
4. Block transitions to LOADED, EMPTY, or ERROR.
5. If EMPTY: `onBlockReady(blockId, { hasContent: false, urgencyScore: 0 })` is called, then `root.remove()`. The home layout collapses to fill the gap.
6. If LOADED: content is shown. The block's updated `_lastUrgencyScore` is available to the home panel renderer via `onBlockReady` — which may optionally trigger a reorder pass.

### 8.2 Who calls `refresh()`

In v1: `refresh()` is called only by the home panel renderer in response to a user action (a "retry" tap on an ERROR block, or a future manual pull-to-refresh gesture).

Future: `refresh()` is also called by the Realtime subscription system when a relevant database change is received. Each block defines which tables it subscribes to. A change to `prep_tasks` triggers `refresh()` on `station_focus` and `low_stock`. A change to `office_items` triggers `refresh()` on `urgent_alerts`. Other blocks are unaffected.

This requires no change to the block contract — `refresh()` already exists. The Realtime system simply calls it on the right block at the right time.

### 8.3 Refresh does not change block position (v1)

In v1, a refreshed block stays in its current visual position regardless of urgency changes after refresh. Position is fixed at initial Home composition time. Full reposition requires a Home re-render (which happens on the next panel activation).

Future: a refresh that produces a significantly higher urgency score (e.g., a new critical alert appears on `urgent_alerts`) triggers a reorder pass on the live layout, using CSS `order` updates only.

---

## 9. Dependency Injection

### 9.1 Every block receives exactly one object: `deps`

No block imports anything directly except its own module dependencies (utility functions, locale keys). All external resources — data, user, navigation, cache, callbacks — arrive through `deps`.

This is the same principle as `createStationPrep` in the existing codebase: all services are injected, nothing is imported at the top of the file from Supabase or app-state.

### 9.2 The complete `deps` shape

```
deps {
  // ── Identity ────────────────────────────────────────────────────
  user: {
    id:              string
    name:            string
    role:            string          // canonical: 'admin' | 'executive_chef' |
                                     //            'supervisor' | 'staff'
    language:        string          // 'en' | 'it' | 'es'
    defaultStation:  string | null
    birthDate:       string | null   // ISO date string YYYY-MM-DD
  }

  // ── Locale ──────────────────────────────────────────────────────
  translate: (key: string, params?: object) → string
    // The t() function from i18n.js. Every visible string goes through this.

  // ── Data service ────────────────────────────────────────────────
  fetchService: (user, signal?) → Promise<BlockRawData>
    // Block-specific. Each block receives the fetch function drawn from
    // BLOCK_FETCHERS for its own blockId. No block receives another
    // block's fetch service. The home panel renderer performs this wiring.
    // signal: AbortSignal (optional in v1, required when AbortController lands)

  // ── Navigation ──────────────────────────────────────────────────
  openPanel: (type: string, context: object) → void
    // Calls workspaceManager.openPanel(). Allows a block to open a panel
    // when the user taps a navigation affordance.
    // Injected by the home panel renderer.
    // A block that never opens panels ignores this field.

  // ── Settlement callback ──────────────────────────────────────────
  onBlockReady: (blockId: string, result: { hasContent: boolean, urgencyScore: number }) → void
    // Called by the block exactly once when its fetch settles, in all
    // three terminal states: LOADED, EMPTY, and ERROR.
    // This is the sole settlement signal. There is no other callback.
    // hasContent: false → block is empty (root already removed by caller)
    // hasContent: true  → block has content (LOADED or ERROR)
    // urgencyScore: from result.urgencyScore on LOADED; 0 on EMPTY and ERROR

  // ── Cache ────────────────────────────────────────────────────────
  blockCache: {
    get:        (blockId: string) → { data: object, fetchedAt: number } | null
    set:        (blockId: string, data: object) → void
    invalidate: (blockId: string) → void
  }
    // Shared in-memory cache, provided by the home panel renderer.
    // Blocks that do not cache ignore this field entirely.

  // ── Permissions ─────────────────────────────────────────────────
  can: (permission: string) → boolean
    // The can() function from permissions.js, partially applied with the
    // current user. Usage: deps.can('view_food_cost').
    // Blocks use this to strip financial content from rendered output.

  // ── Block identity ───────────────────────────────────────────────
  blockId: string
    // The canonical block ID (e.g., 'urgent_alerts').
    // Used for cache keys and onBlockReady calls.
    // Injected so the block does not need to hardcode its own ID.
}
```

### 9.3 What blocks MUST NOT import

| Prohibited import | Reason |
|---|---|
| `supabase-client.js` | All data access through injected `fetchService`. |
| `app-state.js` | All user data through injected `deps.user`. |
| `workspace-manager.js` | Navigation through injected `deps.openPanel`. |
| `permissions.js` (directly) | Permission checks through injected `deps.can`. |
| `i18n.js` (directly) | Locale through injected `deps.translate`. |
| Any other block module | Blocks are independent. |

### 9.4 What blocks MAY import

| Permitted import | Reason |
|---|---|
| Their own block-specific utilities | Pure functions with no side effects. |
| `en.js` locale constants (key names only) | To avoid magic strings. |
| DOM helper utilities | If a shared utility module is established. |

### 9.5 Injecting `deps` — where it happens

`deps` is assembled by the **home panel renderer** (`home-panel.js` — future file) for each block. The home panel renderer knows the current user, the workspace manager, the block cache, and the fetcher registry (`BLOCK_FETCHERS`). It constructs a `deps` object tailored to each block type — pulling the correct fetch function from `BLOCK_FETCHERS[blockId]` and assigning it to `deps.fetchService` — and passes the completed `deps` to `createBlock(deps)`.

No block constructs its own `deps`. No block reaches into `BLOCK_FETCHERS` directly. The home panel renderer is the only place where block wiring happens.

---

## 10. The Registry Architecture

### 10.1 Three registries, one per concern

```
BLOCK_DEFINITIONS  ← what a block is (catalog metadata, permittedRoles, timeout, cacheTTL)
BLOCK_FETCHERS     ← how a block gets its data (one async function per block)
BLOCK_RENDERERS    ← how a block displays its data (one renderer object per block)
```

These are three separate objects, keyed by `blockId`. They are assembled in a single file: `home-block-registry.js`. Adding a block = adding one entry to each registry inside the block's own module file in `blocks/`. No central service file is edited.

`BLOCK_FETCHERS` is the only layer in the Home system that imports and calls Supabase. There is no separate monolithic data service file. Each block's fetcher function lives with or is registered by its block module. When a block is added, its fetcher is registered in `BLOCK_FETCHERS` — and that is the complete data-layer change required.

### 10.2 `BLOCK_DEFINITIONS`

```
BLOCK_DEFINITIONS: {
  [blockId: string]: BlockDefinition
}

BlockDefinition {
  blockId:        string         // canonical ID, matches key
  basePriority:   number         // from Composition Engine §2
  sizeClass:      'XS'|'S'|'M'|'L'
  financialFlag:  boolean        // true = contains money data
  permittedRoles: Set<string>    // THE AUTHORITATIVE EXECUTABLE ROLE GATE
                                 // Role gates in the Composition Engine prose
                                 // are descriptive only. This field governs at runtime.
  cacheTTL:       number | null  // ms, null = no cache
  timeout:        number         // ms, default BLOCK_FETCH_TIMEOUT_MS
}
```

`BLOCK_DEFINITIONS` is the source of truth for catalog metadata. The home panel renderer reads `permittedRoles` here to determine which blocks to instantiate for a given user. Role presets in the Composition Engine reference block IDs that must exist in this registry.

### 10.3 `BLOCK_FETCHERS`

```
BLOCK_FETCHERS: {
  [blockId: string]: BlockFetcher
}

BlockFetcher: (user: UserContext, signal?: AbortSignal) → Promise<BlockRawData>

BlockRawData {
  hasContent:   boolean      // true if the block has something to show
  urgencyScore: number       // 0 or negative; see Composition Engine §3.1
                             // this is the authoritative urgency value;
                             // the block does not recompute it
  data:         object       // block-specific payload, already role-filtered
}
```

A fetcher is a pure async function. It has no side effects beyond network calls. It does not mutate DOM. It does not know about the block's root element. It computes and returns `urgencyScore` based on the data it fetched — this is the only place urgency is computed for that block. The block factory reads `result.urgencyScore` directly; it does not call any separate urgency computation function.

Fetchers are the only layer where Supabase is called for Home blocks. All Supabase imports live inside fetcher implementations, registered in `BLOCK_FETCHERS`. The home panel renderer pulls the correct fetcher from this registry and injects it as `deps.fetchService`. Fetchers are never called directly by block modules.

### 10.4 `BLOCK_RENDERERS`

```
BLOCK_RENDERERS: {
  [blockId: string]: BlockRenderer
}

BlockRenderer: {
  skeleton: ()           → HTMLElement
  content:  (data, deps) → HTMLElement
  error:    (deps)       → HTMLElement
}
```

`BLOCK_RENDERERS[blockId]` is an **object**, not a factory function. It is stored directly in the registry and used directly by the block factory. There is no intermediate call to produce the renderer — the registry entry is the renderer.

Each method is a synchronous pure function returning a valid `HTMLElement`:
- `skeleton()` — no arguments; returns the loading skeleton structure.
- `content(data, deps)` — receives the fetched `data` payload and `deps` (for `translate`, `can`, `openPanel`); returns the populated content element.
- `error(deps)` — receives `deps` (for `translate`); returns the error element with the localised message and retry affordance.

All three return `HTMLElement` immediately. None may return a Promise, null, or undefined.

### 10.5 The block factory

A fourth component lives alongside the registries: `createBlock(blockId, deps)` — the universal block factory.

This is the only function the home panel renderer calls to instantiate blocks. It is not a registry; it is the engine that reads from the registries.

```
// Illustrative pseudocode — see formal contracts and rules for authority.
// This pseudocode illustrates the intended control flow.
// The formal contracts and rules in this specification are authoritative.

createBlock(blockId, deps):
  definition = BLOCK_DEFINITIONS[blockId]
  renderer   = BLOCK_RENDERERS[blockId]
  // Note: deps.fetchService is already wired by the home panel renderer
  //       from BLOCK_FETCHERS[blockId] — the factory does not read BLOCK_FETCHERS directly.

  if (!definition || !renderer):
    console.error('WorkspaceManager: unknown block type:', blockId)
    return null

  root = renderer.skeleton()
  root.dataset.blockId = blockId
  root.classList.add('home-block', `home-block--${blockId}`, 'block--loading')

  let controller      = new AbortController()   // future: active; v1: signal unused
  let destroyed       = false
  let fetchInProgress = false
  let _lastUrgencyScore = 0                     // initialised to 0; assigned on every settle

  function _fetch():
    if (destroyed) return
    fetchInProgress = true

    Promise.race([
      deps.fetchService(deps.user, controller.signal),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), definition.timeout)
      )
    ])
    .then(result => {
      fetchInProgress = false
      if (destroyed || !root.isConnected) return

      if (!result.hasContent):
        _lastUrgencyScore = 0
        deps.onBlockReady(blockId, { hasContent: false, urgencyScore: 0 })
        root.remove()
        return

      _lastUrgencyScore = result.urgencyScore
      root.innerHTML = ''
      root.appendChild(renderer.content(result.data, deps))
      root.classList.replace('block--loading', 'block--loaded')
      deps.onBlockReady(blockId, { hasContent: true, urgencyScore: result.urgencyScore })
    })
    .catch(err => {
      fetchInProgress = false
      if (destroyed || !root.isConnected) return

      _lastUrgencyScore = 0
      root.innerHTML = ''
      root.appendChild(renderer.error(deps))
      root.classList.replace('block--loading', 'block--error')
      deps.onBlockReady(blockId, { hasContent: true, urgencyScore: 0 })
    })

  _fetch()  // start immediately, asynchronously

  return {
    root,
    destroy() {
      destroyed       = true
      fetchInProgress = false    // tidy flag state before controller aborts
      controller.abort()
    },
    refresh() {
      if (destroyed || fetchInProgress) return
      deps.blockCache.invalidate(blockId)
      root.innerHTML = ''
      root.appendChild(renderer.skeleton())
      root.classList.replace('block--loaded', 'block--loading')
      root.classList.replace('block--error',  'block--loading')
      _fetch()
    }
  }
```

### 10.6 Registering a new block

Adding a new block named `inventory_alert` (example). All three steps happen inside `blocks/inventory-alert.js`. No other file is modified.

Step 1 — Definition:
```
BLOCK_DEFINITIONS['inventory_alert'] = {
  blockId:        'inventory_alert',
  basePriority:   4,
  sizeClass:      'S',
  financialFlag:  false,
  permittedRoles: new Set(['supervisor', 'admin', 'executive_chef', 'coordinator']),
  cacheTTL:       null,
  timeout:        BLOCK_FETCH_TIMEOUT_MS,
}
```

Step 2 — Fetcher:
```
BLOCK_FETCHERS['inventory_alert'] = async (user, signal) => {
  const items = await fetchLowInventoryItems(user.defaultStation, signal)
  return {
    hasContent:   items.length > 0,
    urgencyScore: items.some(i => i.critical) ? -2 : 0,
    data:         { items }
  }
}
```

Step 3 — Renderer:
```
BLOCK_RENDERERS['inventory_alert'] = {
  skeleton: ()           => { /* returns skeleton HTMLElement */ },
  content:  (data, deps) => { /* returns content HTMLElement */ },
  error:    (deps)       => { /* returns error HTMLElement with deps.translate('home.block_error') */ },
}
```

No other file is modified. The home panel renderer picks up the new block via the registries.

---

## 11. Future Compatibility

### 11.1 Realtime blocks

When Supabase Realtime is activated for Home, the mechanism is:

A Realtime subscription manager (future: `home-realtime.js`) holds a map of `table → blockId[]`. When a relevant change arrives on a subscribed table, it calls `blockInstance.refresh()` on each affected block.

The block contract is unchanged. Blocks do not know they are being refreshed by Realtime vs. a user tap. `refresh()` behaves identically in both cases.

The only addition to the block contract: blocks that support Realtime declare a `realtimeTables` array in their `BLOCK_DEFINITIONS` entry. This is an optional field — blocks that do not need Realtime simply omit it.

### 11.2 AI blocks

An AI block (e.g., `chef_ai_brief`) is architecturally identical to a data block. Its fetcher calls a pre-computed record from the database (the nightly AI pipeline output). It does not call an LLM at render time.

If a future block needs live LLM output at render time: the fetcher calls the Edge Function, the skeleton waits, the content is rendered when the LLM response arrives. The block contract handles this with no changes — it is just a slow fetch.

### 11.3 External API blocks (TripleSeat, 7Shifts, Weather)

External API blocks follow the same contract. Their fetchers call Supabase Edge Functions that proxy the external APIs. The block sees only a `Promise<BlockRawData>` — it has no knowledge of what network calls the fetcher makes.

This means the block is agnostic to API auth, rate limits, and service availability. If the external API is down, the fetcher returns an error, and the block shows its ERROR state. Home is unaffected.

The `BLOCK_FETCH_TIMEOUT_MS` constant applies uniformly. External APIs that are consistently slow should be pre-fetched by Edge Functions and cached in the database, rather than fetched live during Home render.

### 11.4 Blocks with user interaction (future)

In v1, blocks are read-only (Home is read-only per Composition Engine §1.5). A future block may contain a form or a confirmation affordance. The contract accommodates this without changes:

- The `content(data, deps)` renderer returns an `HTMLElement` that contains interactive elements.
- Event listeners are attached to elements inside `root` — never to `root` itself or to elements outside it.
- `destroy()` removes any timers created by the interaction (no special handling for DOM listeners — they are removed when `root` is detached).
- The block calls `deps.openPanel()` for any action that should open a new panel.

### 11.5 Blocks with multi-step loading (future)

Some future blocks may have a two-phase fetch: a fast initial load (e.g., count of urgent items) followed by a slower detail load. The contract handles this as two sequential calls inside `_fetch()`. The block renders partial content after the first call, then updates in place after the second. `isConnected` is checked before each update. `onBlockReady` is called only after the final phase settles.

---

## 12. Module File Structure

```
boh-v2/src/home/
  home-panel.js           ← Home panel renderer: assembles deps per block,
                             reads BLOCK_DEFINITIONS/BLOCK_FETCHERS/BLOCK_RENDERERS,
                             calls createBlock(), tracks onBlockReady settlement,
                             triggers post-load reorder pass
  home-block-registry.js  ← exports BLOCK_DEFINITIONS, BLOCK_FETCHERS,
                             BLOCK_RENDERERS, and createBlock()
                             (imports all block modules to trigger registration)
  home-cache.js           ← In-memory block cache (session-scoped)
  home-realtime.js        ← Realtime subscription manager (future)
  blocks/
    greeting.js           ← definition + renderer (no fetcher — data from deps.user)
    urgent-alerts.js      ← definition + fetcher (imports supabase-client) + renderer
    station-focus.js      ← definition + fetcher + renderer
    wip-handoffs.js       ← definition + fetcher + renderer
    low-stock.js          ← definition + fetcher + renderer
    kitchen-messages.js   ← definition + fetcher + renderer
    today-production.js   ← definition + fetcher + renderer
    team-status.js        ← definition + fetcher + renderer
    station-overview.js   ← definition + fetcher + renderer
    chef-ai-brief.js      ← definition + fetcher + renderer
    yesterday-recap.js    ← definition + fetcher + renderer
    upcoming-events.js    ← definition + fetcher + renderer
    delivery-expected.js  ← definition + fetcher + renderer
    birthdays.js          ← definition + fetcher + renderer
    equipment-alerts.js   ← definition + fetcher + renderer
    dish-crew-focus.js    ← definition + fetcher + renderer
```

Each file in `blocks/` registers its own entries in `BLOCK_DEFINITIONS`, `BLOCK_FETCHERS`, and `BLOCK_RENDERERS` when it is imported. It does not export `createBlock` — that belongs to `home-block-registry.js`. It does not import from `home-data-service.js` — that file does not exist.

`supabase-client.js` is imported only by fetcher implementations inside `blocks/` files. It is never imported by `home-panel.js`, `home-block-registry.js`, `home-cache.js`, or any renderer.

---

## 13. Rules Summary

These rules are the implementation contract. Every block must obey all of them.

**BL-01.** Every block implements the `BlockInstance` interface: `root`, `destroy()`, `refresh()`.

**BL-02.** `createBlock(deps)` MUST return a valid `HTMLElement` (the skeleton) synchronously. No block may return a Promise, null, or undefined.

**BL-03.** Every async DOM mutation MUST be guarded by `root.isConnected` immediately before the mutation.

**BL-04.** `destroy()` MUST be safe to call at any lifecycle stage, including before the fetch begins, and MUST be idempotent (safe to call multiple times). `destroy()` MUST set `fetchInProgress = false` before calling `controller.abort()`.

**BL-05.** A block MUST NOT import `supabase-client.js`, `app-state.js`, `workspace-manager.js`, or any other block module.

**BL-06.** Every visible string MUST pass through `deps.translate(key)`. No string is hardcoded in a block renderer.

**BL-07.** A block in ERROR state MUST NOT show technical error details. It shows only `t('home.block_error')` and an optional retry affordance.

**BL-08.** A block transitions to EMPTY by calling `deps.onBlockReady(blockId, { hasContent: false, urgencyScore: 0 })` first, then calling `root.remove()`. It MUST NOT show an empty-state placeholder. There is no `onBlockEmpty` callback.

**BL-09.** A block's root element MUST carry `data-block-id`, `home-block`, `home-block--{blockId}`, and one of `block--loading`, `block--loaded`, or `block--error` class names at all times.

**BL-10.** A block fetch that exceeds `BLOCK_FETCH_TIMEOUT_MS` (8000ms) transitions to ERROR. The timeout is implemented with `Promise.race` inside `_fetch()`.

**BL-11.** `refresh()` MUST be a no-op when `destroy()` has been called or when a fetch is already in progress.

**BL-12.** A block MUST NOT mutate DOM nodes outside its `root` element at any time.

**BL-13.** Event listeners attached during the LOADED state MUST be attached to elements inside `root`. Listeners attached to `root` itself must be removed in `destroy()`.

**BL-14.** `_lastUrgencyScore` MUST be initialised to `0` at block creation. It MUST be assigned `result.urgencyScore` in the LOADED path and `0` in the EMPTY and ERROR paths, before `onBlockReady` is called in each path.

**BL-15.** A block in ERROR state counts as `hasContent: true`. It occupies a slot in the `HOME_MAX_BLOCKS` budget. It contributes `urgencyScore: 0`.

**BL-16.** `refresh()` invalidates the block cache before re-fetching, regardless of whether the block uses caching.

**BL-17.** Financial data (net_sales, food_cost, margins, invoice prices) MUST be stripped from rendered content for users where `deps.can('view_food_cost')` returns false. This check happens inside the block renderer (`content(data, deps)`), not in the fetcher. This allows the same fetcher to serve both admin and non-admin users.

**BL-18.** A block's fetcher (in `BLOCK_FETCHERS`) is the only place where Supabase is called for Home data. The fetcher computes and returns `urgencyScore` as part of `BlockRawData`. The block factory reads `result.urgencyScore` directly. There is no separate urgency computation step in the block factory.

**BL-19.** `deps.onBlockReady` is called exactly once per fetch cycle, in every terminal state (LOADED, EMPTY, ERROR). It is the sole settlement signal. There is no other settlement callback in `deps`.

**BL-20.** `BLOCK_RENDERERS[blockId]` is an object `{ skeleton, content, error }`. It is not a factory function. `skeleton()` takes no arguments. `content(data, deps)` takes the fetched data payload and deps. `error(deps)` takes deps for translation. No other signatures are valid.

**BL-21.** `BLOCK_DEFINITIONS[blockId].permittedRoles` is the authoritative runtime role gate. The home panel renderer reads this field to decide whether to instantiate a block for a given user. Role gate descriptions in the Home Composition Engine are documentation, not enforcement.

---

## 14. Non-Goals

This document does not define:

- Visual design of skeleton states, content states, or error states.
- CSS class names beyond the structural ones in BL-09.
- The `home-panel.js` implementation (home panel renderer — separate task).
- Any specific block's data schema (defined in the Composition Engine §2).
- Realtime subscription channel names or filter syntax.
- Animation or transition between states.
- The `home_briefings` DB table (future, separate session).

---

## 15. Approval Checkpoint

Before implementation of any Home block:

- [ ] Max confirms that a single block failure does not affect other blocks or Home.
- [ ] Max confirms that empty blocks are silently absent — `onBlockReady(hasContent: false)` is called, then the root is removed. No placeholder.
- [ ] Max confirms the 8-second timeout per block (`BLOCK_FETCH_TIMEOUT_MS = 8000`).
- [ ] Max confirms that `refresh()` on an error block is the only retry mechanism — no auto-retry.
- [ ] Max confirms that financial data stripping happens in `content(data, deps)` inside the renderer, not in the fetcher.
- [ ] Max confirms that `BLOCK_FETCHERS` is the only data layer — there is no separate `home-data-service.js`.

Implementation begins only after all six items above are checked.

---

## Appendix A — Deferred Review Notes

The following issues were identified in the v1.0 architectural review but do not affect the correctness of v1.1. They should be revisited before recipe panels or any block with non-trivial user interaction is implemented.

**A1 — Role gate description drift.** Role gates are now formally defined in `BLOCK_DEFINITIONS.permittedRoles` (BL-21). The role gate prose in the Home Composition Engine §2 is documentation only. If a role gate changes, both must be updated together. A future session should consider generating the Composition Engine prose from the registry to eliminate the drift risk.

**A2 — Error renderer receives `deps` but no `blockId`.** `error(deps)` currently cannot include the block name in its error message without `deps.blockId` being available. `deps.blockId` is already in the `deps` shape (§9.2), so this is not a gap, but it should be noted for any block that wants block-specific error text.

**A3 — `greeting` block has no fetcher.** `greeting` reads from `deps.user` directly — its data arrives through `deps`, not through `deps.fetchService`. This is a legitimate special case (greeting data is already in memory, no network call needed). It must be documented explicitly when `greeting` is implemented: its `BLOCK_FETCHERS` entry is a synchronous function that constructs `BlockRawData` from `deps.user` without a network call. The factory treats it identically to any other block. No contract change needed.

**A4 — `block--error` class has no associated ARIA role.** An error block should carry `role="alert"` or `aria-live="polite"` so screen readers announce the failure. This is a CSS/accessibility note for the implementation phase, not an architectural concern.

---

*End of Home Block Engine Specification v1.1.*  
*Companion documents:*  
*— `boh-v2/docs/BOH_OS_V2_WORKSPACE_ENGINE.md` v1.1*  
*— `boh-v2/docs/BOH_OS_V2_HOME_COMPOSITION_ENGINE.md` v1.0*  
*— `boh-v2/docs/WORKSPACE_ARCHITECTURE.md` v1.0*  
*Supersedes: `boh-v2/docs/BOH_OS_V2_HOME_BLOCK_ENGINE.md` v1.0*
