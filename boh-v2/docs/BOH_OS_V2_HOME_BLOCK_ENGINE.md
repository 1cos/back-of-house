# BOH OS v2 — Home Block Engine Specification

> Version 1.0 · 2026-07-16  
> Status: **PROPOSED — requires Max approval before implementation**  
> Depends on: Workspace Engine v1.1, Home Composition Engine v1.0  
> Scope: Architecture only. No code implementation. No UI. No colors.

---

## 0. What This Document Is

The Home Composition Engine (v1.0) defines **which blocks appear on Home** and in what order.

This document defines **what a block is** — the internal architecture every block must follow, the contract every block must honour, and the infrastructure every block receives. It is the block's constitution.

Every future block, without exception, is built against this specification. No block may deviate from the contract defined here. When a new block is added, this document is the primary reference. If this document and the Composition Engine conflict, this document governs on matters of internal block behaviour; the Composition Engine governs on matters of composition and ordering.

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

### 2.4 EMPTY

The fetch returned successfully, but the data does not meet the `hasContent` threshold (e.g., no urgent alerts, no handoffs). The block removes its root element from the DOM and signals its absence to the home panel renderer.

An empty block is invisible. It does not show an empty-state message, a "nothing to show" placeholder, or any container whatsoever.

### 2.5 ERROR

The fetch failed (network error, timeout, service error). The block renders a minimal, non-alarming error state in its root element. The error is local to the block. No other block is affected. Home does not fail.

The error state contains: a brief human-readable message (via `t()`) and, if appropriate, a retry affordance. It does not show technical details (no error codes, no stack traces, no Supabase messages).

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
        │ real content│  │root removed│  │error message│
        └──────┬─────┘  └──────┬─────┘  └──────┬──────┘
               │               │                │
               └───────────────┴────────────────┘
                               │
                           destroy()
                               │
                    ┌──────────▼───────────┐
                    │                      │
                    │     DESTROYED        │
                    │                      │
                    └──────────────────────┘
```

---

## 3. The Block Contract

Every block MUST implement the following interface. No method is optional. The implementation may be a no-op (e.g., `destroy()` does nothing for a block with no timers), but the method must exist.

### 3.1 `createBlock(deps) → BlockInstance`

The block factory function. Always named `createBlock` at the module level; the module filename determines which block it is.

`deps` is the dependency object — see §8 for the complete dependency injection specification.

Returns a `BlockInstance` synchronously. The `BlockInstance` contains the root DOM element (already in skeleton state) and the methods below.

```
BlockInstance {
  root:       HTMLElement      ← the skeleton root, returned to the home renderer
  destroy:    () → void
  refresh:    () → void        ← triggers a re-fetch in place (§7)
}
```

The `root` element is the only DOM the block owns. The home renderer mounts `root` into the Home panel. The block may mutate `root` and its descendants freely. It must never touch any DOM outside `root`.

### 3.2 `destroy() → void`

Called by the home panel renderer when Home is deactivated or the session ends. The block MUST:
- Cancel any in-flight fetch via `AbortController.abort()` (when AbortController is implemented).
- Clear any `setTimeout` or `setInterval` timers.
- Remove any event listeners attached to elements outside `root` (listeners on elements inside `root` are removed automatically when `root` is removed from the DOM).

The block MUST NOT:
- Throw an error if `destroy()` is called before FETCHING begins.
- Throw an error if `destroy()` is called more than once.
- Mutate the DOM after `destroy()` is called.

`destroy()` is always safe to call at any lifecycle stage.

### 3.3 `refresh() → void`

Triggers a re-fetch and re-render of the block content in place, without rebuilding Home. Called by the home panel renderer in response to an explicit refresh request (future: also called by the Realtime subscription system).

`refresh()` transitions the block back to FETCHING (showing the skeleton again), then to LOADED, EMPTY, or ERROR. The root DOM element is reused — it is not replaced.

`refresh()` is a no-op if:
- `destroy()` has already been called.
- A fetch is already in progress.

### 3.4 `canRender() → boolean`

Returns `true` if the block believes it has content to show, based on its most recently fetched data. Returns `false` if the block is in EMPTY or CREATED state.

Called by the home panel renderer after the initial fetch completes to decide whether to keep the block in the layout or remove it. The home renderer does not call `canRender()` during FETCHING — it waits for the fetch to complete.

### 3.5 `urgencyScore() → number`

Returns the block's current urgency modifier — a number ≤ 0 (see §3.1 of the Composition Engine for the modifier table). Returns 0 if the block has no urgent content or is in a pre-LOADED state.

Called once per Home render, after all fetches complete, to allow the composition engine to reorder blocks by resolved priority. This method is synchronous and must not trigger a fetch.

### 3.6 Internal method: `_fetch(signal) → Promise<void>`

Not part of the public contract — internal to the block module. Called once from `createBlock()` immediately after returning the `BlockInstance`. Accepts an `AbortSignal` for cancellation (when AbortController is implemented).

`_fetch()` is responsible for:
1. Calling the injected fetch service.
2. Evaluating `hasContent` on the result.
3. Transitioning to LOADED, EMPTY, or ERROR.
4. Calling `isConnected` before any DOM mutation.
5. Calling the home panel renderer's `onBlockReady(blockId)` callback when the fetch completes (see §6.3).

### 3.7 Internal method: `_renderContent(data) → void`

Not part of the public contract — internal to the block module. Called from `_fetch()` when the data is LOADED. Replaces the skeleton content of `root` with real content. Always guarded by `isConnected`.

### 3.8 Internal method: `_renderError() → void`

Not part of the public contract — internal to the block module. Called from `_fetch()` on ERROR. Replaces the skeleton content with a minimal error message and optional retry affordance.

### 3.9 Internal method: `_renderSkeleton() → void`

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

On ERROR, the skeleton is replaced by the error state (via `_renderError()`). The error state uses the same root element. The skeleton is never shown simultaneously with the error state.

### 4.5 Skeleton removal on empty

On EMPTY, the root element is removed from the DOM entirely:
```
if (root.isConnected) root.remove();
```

The composition engine is notified via `onBlockReady(blockId, { hasContent: false })`. The composition engine removes the block from the visual layout.

### 4.6 No skeleton flicker on fast fetches

If a fetch completes before the browser has had a chance to paint the skeleton, the user sees only the loaded content. There is no forced minimum skeleton display time. Speed is preferred over visual consistency.

---

## 5. Error Handling

### 5.1 Block failure is local

If a block's fetch throws or rejects, that block transitions to ERROR. All other blocks are unaffected. Home does not fail. Home does not show a global error state.

This is the most important rule in this section. A block is the failure boundary.

### 5.2 Error isolation mechanism

Each block's `_fetch()` wraps its fetch service call in a try/catch. The catch handler calls `_renderError()`. Nothing leaks out of the block.

```
async function _fetch(signal) {
  try {
    const data = await deps.fetchService(deps.user, signal);
    if (!root.isConnected) return;
    if (!hasContent(data)) {
      onBlockReady(blockId, { hasContent: false });
      if (root.isConnected) root.remove();
      return;
    }
    _renderContent(data);
    onBlockReady(blockId, { hasContent: true, urgencyScore: computeUrgency(data) });
  } catch (err) {
    if (!root.isConnected) return;
    _renderError();
    onBlockReady(blockId, { hasContent: true, urgencyScore: 0 });
    // Error blocks count as "has content" — they occupy space and show a message.
    // They do not contribute urgency.
  }
}
```

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

The home panel renderer launches all block fetches simultaneously using `Promise.allSettled`. No block waits for another block to complete before starting its own fetch. The first block to finish renders its content; others follow independently.

`Promise.allSettled` (not `Promise.all`) is mandatory: a single fetch rejection must not cancel the remaining fetches.

```
// Inside the home panel renderer's async section:
await Promise.allSettled(
  mountedBlocks.map(block => block._fetchPromise)
);
// At this point, all blocks have settled (loaded, empty, or error).
// The composition engine reorders by urgency score.
```

### 6.2 Progressive rendering

Blocks do not wait for all fetches to complete before showing content. Each block transitions independently from FETCHING to LOADED/EMPTY/ERROR as its own fetch completes.

The composition engine performs a final reorder pass after all fetches settle (§6.3), but the user sees content progressively — fast blocks appear first, slow blocks appear later within their skeleton bounds.

### 6.3 The `onBlockReady` callback and post-load reorder

Each block calls `onBlockReady(blockId, { hasContent, urgencyScore })` when its fetch settles.

`onBlockReady` is injected into every block via `deps`. It is a function provided by the home panel renderer.

After all blocks have called `onBlockReady`, the home panel renderer performs one final reorder: blocks that turned out to have higher urgency than their initial position may be visually promoted. This reorder is the only time the home layout changes after initial mount.

In v1, this reorder is implemented by updating the CSS `order` property of each block's root element (if blocks are in a CSS flex column). No DOM node is moved. No block is re-rendered. The reorder is a style-only update.

### 6.4 Lazy loading (future)

In v1, all blocks in the permitted catalog are fetched in parallel on Home activation. There is no lazy loading.

Future: blocks below the fold may defer their fetch until the user scrolls within range. This requires an IntersectionObserver hooked into the block lifecycle. The block contract accommodates this: `_fetch()` can be deferred; the skeleton remains visible until called. No contract change is required.

### 6.5 AbortController (future — spec defined now)

AbortController is not implemented in v1. When implemented, the contract is:

Every block's `createBlock()` creates an `AbortController` internally. The `AbortSignal` is passed to `_fetch()` and from there to the fetch service call. `destroy()` calls `controller.abort()`.

The block's fetch service (injected) MUST accept an optional `signal` parameter and forward it to the underlying network call.

Because the contract slot (`signal` parameter) is defined now, adding AbortController in a future session requires only: (a) passing a real signal instead of `undefined`, and (b) ensuring fetch services forward it. No block contract change.

### 6.6 Priority loading (future)

In v1, all blocks have equal fetch priority. Future: blocks with `basePriority < 3` (greeting, urgent_alerts, station_focus) may be fetched first, with lower-priority blocks deferred until the high-priority blocks are LOADED or ERROR. Implementation: two phases in `Promise.allSettled`, high-priority first. No contract change required.

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
5. If EMPTY: `root.remove()`. The home layout collapses to fill the gap.
6. If LOADED: content is shown. If urgency changed, the block's new `urgencyScore()` is available — the home panel renderer may optionally trigger a reorder pass.

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
    // Block-specific. Each block receives the fetch service that
    // corresponds to its own data needs.
    // The home-data-service.js injects the correct fetch function
    // per block type. No block receives another block's fetch service.
    // signal: AbortSignal (optional in v1, required when AbortController lands)

  // ── Navigation ──────────────────────────────────────────────────
  openPanel: (type: string, context: object) → void
    // Calls workspaceManager.openPanel(). Allows a block to open a panel
    // when the user taps a navigation affordance.
    // Injected by the home panel renderer.
    // A block that never opens panels ignores this field.

  // ── Composition callbacks ────────────────────────────────────────
  onBlockReady: (blockId: string, result: { hasContent: boolean, urgencyScore: number }) → void
    // Called by the block when its fetch settles.
    // The home panel renderer uses this to track completion and trigger reorder.

  onBlockEmpty: (blockId: string) → void
    // Called by the block when it transitions to EMPTY.
    // The home panel renderer removes the block from the visual layout.
    // Separate from onBlockReady for clarity; may be merged in a future version.

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

`deps` is assembled by the **home panel renderer** (`home-panel.js` — future file) for each block. The home panel renderer knows the current user, the workspace manager, the block cache, and the fetch service registry. It constructs a `deps` object tailored to each block type and passes it to `createBlock(deps)`.

No block constructs its own `deps`. No block assembles its own fetch service. The home panel renderer is the only place where block wiring happens.

---

## 10. The Registry Architecture

### 10.1 Three registries, one per concern

```
BLOCK_DEFINITIONS  ← what a block is (catalog metadata)
BLOCK_FETCHERS     ← how a block gets its data
BLOCK_RENDERERS    ← how a block displays its data
```

These are three separate objects, keyed by `blockId`. They are assembled in a single file: `home-block-registry.js` (future). Adding a block = adding one entry to each.

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
  permittedRoles: Set<string>    // roles that may see this block
  cacheTTL:       number | null  // ms, null = no cache
  timeout:        number         // ms, default BLOCK_FETCH_TIMEOUT_MS
}
```

`BLOCK_DEFINITIONS` is the source of truth for catalog metadata. The Composition Engine reads from it. Role presets reference block IDs that must exist in this registry.

### 10.3 `BLOCK_FETCHERS`

```
BLOCK_FETCHERS: {
  [blockId: string]: BlockFetcher
}

BlockFetcher: (user: UserContext, signal?: AbortSignal) → Promise<BlockRawData>

BlockRawData {
  hasContent:   boolean      // true if the block has something to show
  urgencyScore: number       // 0 or negative; see Composition Engine §3.1
  data:         object       // block-specific payload, already role-filtered
}
```

A fetcher is a pure async function. It has no side effects beyond network calls. It does not mutate DOM. It does not know about the block's root element.

Fetchers are the only place where Supabase is called for Home blocks. All Supabase imports live inside fetcher implementations. Fetchers are called by the home panel renderer, not by block modules directly.

### 10.4 `BLOCK_RENDERERS`

```
BLOCK_RENDERERS: {
  [blockId: string]: BlockRenderer
}

BlockRenderer: (data: object, deps: deps) → {
  skeleton:       () → HTMLElement
  content:        (data: object) → HTMLElement
  error:          () → HTMLElement
}
```

A renderer is a collection of three pure functions, each returning an `HTMLElement`. It does not hold state. It does not fetch data. It does not call network services. It transforms data into DOM.

- `skeleton()` is called from `createBlock()` to produce the initial skeleton.
- `content(data)` is called from `_renderContent()` when the fetch succeeds.
- `error()` is called from `_renderError()` when the fetch fails.

All three are synchronous. All three return valid `HTMLElement` values immediately.

### 10.5 The block factory

A fourth component lives alongside the registries: `createBlock(blockId, deps)` — the universal block factory.

This is the only function the home panel renderer calls to instantiate blocks. It is not a registry; it is the engine that reads from the registries.

```
createBlock(blockId, deps):
  definition = BLOCK_DEFINITIONS[blockId]
  fetcher    = BLOCK_FETCHERS[blockId]
  renderer   = BLOCK_RENDERERS[blockId]

  if (!definition || !fetcher || !renderer):
    // Unknown block — log error, return null
    return null

  root = renderer.skeleton()
  root.dataset.blockId = blockId
  root.classList.add('home-block', `home-block--${blockId}`, 'block--loading')

  controller = new AbortController()  // future: active; v1: signal unused
  destroyed  = false
  fetchInProgress = false

  function _fetch():
    if (destroyed) return
    fetchInProgress = true
    Promise.race([
      fetcher(deps.user, controller.signal),
      timeout(definition.timeout)
    ])
    .then(result → {
      fetchInProgress = false
      if (destroyed || !root.isConnected) return
      if (!result.hasContent):
        deps.onBlockEmpty(blockId)
        root.remove()
        return
      root.innerHTML = ''
      root.appendChild(renderer.content(result.data, deps))
      root.classList.replace('block--loading', 'block--loaded')
      deps.onBlockReady(blockId, { hasContent: true, urgencyScore: result.urgencyScore })
    })
    .catch(err → {
      fetchInProgress = false
      if (destroyed || !root.isConnected) return
      root.innerHTML = ''
      root.appendChild(renderer.error())
      root.classList.replace('block--loading', 'block--error')
      deps.onBlockReady(blockId, { hasContent: true, urgencyScore: 0 })
    })

  _fetch()  // start immediately, asynchronously

  return {
    root,
    destroy() {
      destroyed = true
      controller.abort()
    },
    refresh() {
      if (destroyed || fetchInProgress) return
      deps.blockCache.invalidate(blockId)
      root.innerHTML = ''
      root.appendChild(renderer.skeleton())
      root.classList.replace('block--loaded', 'block--loading')
      root.classList.replace('block--error', 'block--loading')
      _fetch()
    },
    canRender()     { return root.isConnected && root.classList.contains('block--loaded') },
    urgencyScore()  { return _lastUrgencyScore }
  }
```

This pseudocode is the implementation contract, not the final code. The actual implementation follows this logic exactly.

### 10.6 Registering a new block

Adding a new block named `inventory_alert` (example):

Step 1 — Definition:
```
BLOCK_DEFINITIONS['inventory_alert'] = {
  blockId:       'inventory_alert',
  basePriority:  4,
  sizeClass:     'S',
  financialFlag: false,
  permittedRoles: new Set(['supervisor', 'admin', 'executive_chef', 'coordinator']),
  cacheTTL:      null,
  timeout:       BLOCK_FETCH_TIMEOUT_MS,
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
  skeleton: () => { /* returns skeleton HTMLElement */ },
  content:  (data) => { /* returns content HTMLElement */ },
  error:    () => { /* returns error HTMLElement */ },
}
```

No other file is modified. The composition engine picks it up automatically.

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

- The `content()` renderer returns an `HTMLElement` that contains interactive elements.
- Event listeners are attached to elements inside `root` — never to `root` itself or to elements outside it.
- `destroy()` removes any timers created by the interaction (no special handling for DOM listeners — they are removed when `root` is detached).
- The block calls `deps.openPanel()` for any action that should open a new panel.

### 11.5 Blocks with multi-step loading (future)

Some future blocks may have a two-phase fetch: a fast initial load (e.g., count of urgent items) followed by a slower detail load. The contract handles this as two sequential calls inside `_fetch()`. The block renders partial content after the first call, then updates in place after the second. `isConnected` is checked before each update.

---

## 12. Module File Structure

```
boh-v2/src/home/
  home-panel.js             ← Home panel renderer (future — registered with WorkspaceManager)
  home-block-registry.js    ← BLOCK_DEFINITIONS, BLOCK_FETCHERS, BLOCK_RENDERERS, createBlock
  home-data-service.js      ← All Supabase fetches for Home blocks (imports supabase-client)
  home-cache.js             ← In-memory block cache (session-scoped)
  home-realtime.js          ← Realtime subscription manager (future)
  blocks/
    greeting.js             ← createBlock wrapper + renderer (no fetcher — data from deps.user)
    urgent-alerts.js        ← fetcher + renderer
    station-focus.js        ← fetcher + renderer
    wip-handoffs.js         ← fetcher + renderer
    low-stock.js            ← fetcher + renderer
    kitchen-messages.js     ← fetcher + renderer
    today-production.js     ← fetcher + renderer
    team-status.js          ← fetcher + renderer
    station-overview.js     ← fetcher + renderer
    chef-ai-brief.js        ← fetcher + renderer
    yesterday-recap.js      ← fetcher + renderer
    upcoming-events.js      ← fetcher + renderer
    delivery-expected.js    ← fetcher + renderer
    birthdays.js            ← fetcher + renderer
    equipment-alerts.js     ← fetcher + renderer
    dish-crew-focus.js      ← fetcher + renderer
```

Each file in `blocks/` exports exactly one thing: the registration call that adds its entries to the three registries. The registration call is made when the module is imported by `home-block-registry.js`. No block exports `createBlock` — that is the registry's domain.

---

## 13. Rules Summary

These rules are the implementation contract. Every block must obey all of them.

**BL-01.** Every block implements the full `BlockInstance` interface: `root`, `destroy()`, `refresh()`, `canRender()`, `urgencyScore()`.

**BL-02.** `createBlock(deps)` MUST return a valid `HTMLElement` (the skeleton) synchronously. No block may return a Promise, null, or undefined.

**BL-03.** Every async DOM mutation MUST be guarded by `root.isConnected` immediately before the mutation.

**BL-04.** `destroy()` MUST be safe to call at any lifecycle stage, including before the fetch begins, and MUST be idempotent (safe to call multiple times).

**BL-05.** A block MUST NOT import `supabase-client.js`, `app-state.js`, `workspace-manager.js`, or any other block module.

**BL-06.** Every visible string MUST pass through `deps.translate(key)`. No string is hardcoded in a block renderer.

**BL-07.** A block in ERROR state MUST NOT show technical error details. It shows only `t('home.block_error')` and an optional retry affordance.

**BL-08.** A block transitions to EMPTY by calling `deps.onBlockEmpty(blockId)` and then `root.remove()`. It MUST NOT show an empty-state placeholder.

**BL-09.** A block's root element MUST carry `data-block-id`, `home-block`, `home-block--{blockId}`, and one of `block--loading`, `block--loaded`, or `block--error` class names at all times.

**BL-10.** A block fetch that exceeds `BLOCK_FETCH_TIMEOUT_MS` (8000ms) transitions to ERROR. The timeout is implemented with `Promise.race` inside `_fetch()`.

**BL-11.** `refresh()` MUST be a no-op when `destroy()` has been called or when a fetch is already in progress.

**BL-12.** A block MUST NOT mutate DOM nodes outside its `root` element at any time.

**BL-13.** Event listeners attached during the LOADED state MUST be attached to elements inside `root`. Listeners attached to `root` itself must be removed in `destroy()`.

**BL-14.** `urgencyScore()` is synchronous and MUST NOT trigger a fetch. It returns the urgency computed during the most recent settled fetch, or 0 if no fetch has settled.

**BL-15.** A block in ERROR state counts as `hasContent: true`. It occupies a slot in the `HOME_MAX_BLOCKS` budget. It contributes `urgencyScore: 0`.

**BL-16.** `refresh()` invalidates the block cache before re-fetching, regardless of whether the block uses caching.

**BL-17.** Financial data (net_sales, food_cost, margins, invoice prices) MUST be stripped from rendered content for users where `deps.can('view_food_cost')` returns false. This check happens inside the block renderer, not in the fetcher.

**BL-18.** A block's fetcher (in `BLOCK_FETCHERS`) is the only place where Supabase is called. The fetcher returns `BlockRawData`. The block renderer receives `data` from `BlockRawData` and never calls Supabase.

---

## 14. Non-Goals

This document does not define:

- Visual design of skeleton states, content states, or error states.
- CSS class names beyond the structural ones in BL-09.
- The `home-panel.js` implementation (home panel renderer — separate task).
- The `home-data-service.js` implementation (fetcher implementations — separate task).
- Any specific block's data schema (defined in the Composition Engine §2).
- Realtime subscription channel names or filter syntax.
- Animation or transition between states.
- The `home_briefings` DB table (future, separate session).

---

## 15. Approval Checkpoint

Before implementation of any Home block:

- [ ] Max confirms that a single block failure does not affect other blocks or Home.
- [ ] Max confirms that empty blocks are silently absent (no placeholder, no "nothing to show").
- [ ] Max confirms the 8-second timeout per block.
- [ ] Max confirms that `refresh()` on an error block is the only retry mechanism (no auto-retry).
- [ ] Max confirms the `HOME_BLOCK_TIMEOUT_MS = 8000` constant.
- [ ] Max confirms that financial data stripping happens in the block renderer, not the fetcher (so fetcher is reusable for admin and non-admin).

Implementation begins only after all six items above are checked.

---

*End of Home Block Engine Specification.*  
*Companion documents:*  
*— `boh-v2/docs/BOH_OS_V2_WORKSPACE_ENGINE.md` v1.1*  
*— `boh-v2/docs/BOH_OS_V2_HOME_COMPOSITION_ENGINE.md` v1.0*  
*— `boh-v2/docs/WORKSPACE_ARCHITECTURE.md` v1.0*
