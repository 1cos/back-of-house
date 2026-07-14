# BOH OS v2 — Session State

## Current Status

- Foundation: **complete**
- PIN login: **complete**
- Authenticated App Shell: **complete**
- Station navigation: **complete**
- Station Home: **complete**
- Station Prep core operational flow: **complete**

Station Prep supports:

- live task loading by default station
- latest valid bot suggestions
- priority sections (Do first / Do today / Check / Looks good / In progress)
- collapsible task details
- today production logs (Made today)
- Start Prep (marks task in progress, updates local state)
- Complete Prep quantity form
- physical stock counts (inserts prep_stock_counts, updates current_stock)
- count reconciliation (invokes bot-prep-count-reconciler, applies returned fields)
- local post-write updates without refetching

**Station Prep now supports the core kitchen workflow:**

**Review → Start → Complete → Count → Reconcile**

Recipes, Chat, and Schedule remain scaffold placeholders.

---

## Current User Flow

1. User opens BOH OS v2
2. User enters a four-digit PIN
3. Authenticated App Shell opens
4. Station Home displays user name and default station
5. Open Today navigates to Prep
6. Prep loads active tasks for the default station
7. Prep loads:
   - latest valid bot suggestions
   - today production logs
   - recent physical counts
8. Tasks are grouped into: Do first / Do today / Check / Looks good / In progress
9. User expands one task
10. Eligible task can be started
11. Successful Start moves the task to In progress
12. In-progress task can be completed
13. Completion:
    - inserts prep_log
    - updates prep_tasks
    - updates local task state
    - adds the returned log to Made today
14. Any task can open Count stock
15. Physical Count:
    - inserts prep_stock_counts
    - updates prep_tasks.current_stock
    - invokes bot-prep-count-reconciler
16. Reconciliation fields appear in Last physical count
17. Partial write and reconciliation failures are surfaced safely
18. No page reload or data refetch is required after Start, Complete, or Count

---

## Next Task

**Task 004Y — Station Prep WIP Detail**

Scope recommendation:

- Display in-progress metadata already loaded on each task
- Show started by, started at, and elapsed time
- Use local device time
- No database query
- No writes
- No timer interval yet
- No handoff action
- No previous-shift resolution

**Do not begin Station Recipes yet.**

Recommended sequence:

- 004Y — Display WIP metadata
- 004Z — Previous-shift WIP detection
- 004AA — WIP resolution UI
- then close Station Prep core
- only after approval, begin Station Recipes

---

## Completed Tasks

| Task | Description | Commit |
|------|-------------|--------|
| 002A | Static Foundation Scaffold | `b35043f4cb925e4a9fd73d7d50d37c7a8928995a` |
| 002B | Supabase Client Initialization | `3acf17cb886f8f9055b3c81f18d9821204fed21b` |
| 002C | Minimal PIN Login | `1cdf40f5a8823b418d98baf93845627f80ce1475` |
| 002D | In-Memory App State | `0bc8214e5588e1b35f38e4fc038022b3062361c6` |
| 002E | Permissions | `3b2939b2e204c123f2ad53c188c80cc0dd9dea00` |
| 002F | Router Skeleton | `acaa3a08c73877f45791b62b15d67f58719e7dfa` |
| 003A | Authenticated App Shell | `00ef1cf636b94baa4a2dac863df9236eb39a0b67` |
| 003B | Station Mode Bottom Navigation | `500c3352658def01817a150040a855cd07d0680f` |
| 003B.1 | Explicit Navigation API (`navLabel`) | `7e9a1dc774d313ac76a4babd9aedfcffa7908de5` |
| 003C | Station Navigation Controller | `f5387ff9a6a92a628b48037e7d8cc1bb25598887` |
| 003D | Station Home — Identity and Shift Entry | `2ff9909c6443db1b90517876988160b2f1d25f3f` |
| 003E | DOM-First Router Rendering | `21b250b8ec3248229dc0f19df4c123dd5f6808e5` |
| 004A | Station Prep Read Service | `2a3f52b23fe63cbd95ead73be6f2baf537d7de47` |
| 004B | Station Prep Read-Only Page | `4f2411baace80e455b3ada4e75d298bd7708544a` |
| 004C | Prep Suggestion Read Service | `e860a266caddc2993d11888406659a92a2465cf6` |
| 004C.1 | Paginated Phase 1 Discovery | `0a8ac2631ede23ce27ae40125fcfba97824ace73` |
| 004D | Merge Prep Tasks with Suggestions | `1c0432d35179cb53e5c34b78870830a82c024fe0` |
| 004E | Prep Suggestion Status Styling | `1f564c78526b07e7dc835d9f3943a95bc3db807f` |
| 004F | Station Prep Operational Sorting | `7c46e95324eb4a81e0f2ee5144920be606d811a1` |
| 004G | Station Prep Priority Sections | `fd191938f8109f9a685b3075de83c83b52ce6ab3` |
| 004H | Station Prep Collapsible Task Detail | `78d0ee4a984e959b705204a45d4091761ecd2dea` |
| 004I | Kitchen-Language Detail Labels | `52629edd77737a4f855a44a2da50099cc7dfbbc1` |
| 004J | Today Prep Logs Read Service | `11694802d3b73584240ad9cc7ca6a8dd446824ca` |
| 004K | Show Today's Prep Logs | `094d2f38c9b076452c1eb5e33dba563ec7cb1300` |
| 004L | Start Prep Write Service | `370016f6ecffa49bbb219b349baaaa15d65d21ff` |
| 004M | Connect Start Prep to UI | `096fdeab1e6abb97cbc813701282cc44d6724d2f` |
| 004N | Complete Prep Write Service | `efbdcc9d6009cb180743aaaaecce0a44e2f006dd` |
| 004O | Completion Quantity Form Component | `454ea07f23f2b88098627132da60e2131e154229` |
| 004P | Mount Completion Form | `c4e212e4b307008eb20982b5d415c449b553b4e7` |
| 004Q | Connect Complete Prep to UI | `dfcdb0381cd5e15b5a24ae8f006d906cd99ba77b` |
| 004R | Station Prep Physical Count Read Service | `4cefd3d8b2cfdf074c5fb2466b6e47be523f0a51` |
| 004S | Display Recent Physical Count | `83b8700546287cc88ee84033f412e3b471a051c4` |
| 004T | Physical Count Form Component | `6de399e1987d541b3638ac359f9c89f77e24fb22` |
| 004U | Physical Count Write Service | `d1c59eccdafcc66c90220e2d9cd60aecb4da5886` |
| 004V | Connect Physical Count to Station Prep | `389ce4ce8a3c63fc7ed12244e892bc466fc448fb` |
| 004W | Physical Count Reconciler Service | `911dd8e0a5a226a0ce7a67e42d426b9f963b27a2` |
| 004X | Automatically Reconcile Saved Physical Count | `9dff54a2ab7c3f6de70b0fc0c6ad888c9d40c71d` |

---

## Live File Tree (`boh-v2/`)

```
boh-v2/
  index.html
  src/
    app.js
    components/
      app-shell/
        app-shell.js
      navigation/
        bottom-navigation.js
      prep/
        complete-prep-form.js
        prep-count-form.js
    core/
      app-state.js
      i18n.js
      permissions.js
      router.js
      supabase-client.js
    locales/
      en.js
    modes/
      station/
        station-home.js
        station-navigation.js
        station-prep.js
    services/
      auth-service.js
      prep-complete-service.js
      prep-count-reconciler-service.js
      prep-count-service.js
      prep-count-write-service.js
      prep-log-service.js
      prep-start-service.js
      prep-suggestion-service.js
      station-prep-service.js
  styles/
    app-shell.css
    base.css
    bottom-navigation.css
    complete-prep-form.css
    layout.css
    prep-count-form.css
    station-home.css
    station-prep.css
    tokens.css
```

---

## Architecture Decisions

### Core constraints (permanent)
- Vanilla JavaScript, native ES modules, no bundler, no framework.
- Mobile-first, iPhone portrait primary.
- No `window` writes, no storage APIs, no browser history.
- English-first; all static visible text via `en.js` and `t()`.
- Dynamic values always via `textContent`, never `innerHTML`.

### Router (`src/core/router.js`)
- In-memory registry. No URL changes.
- Public API: `router.init(outlet)`, `router.register(name, renderer)`, `router.navigate(name)`, `router.current()`.
- Renderers may return `HTMLElement` (appended directly, JS listeners preserved) or `string` (injected via `innerHTML`).
- `_current` updated only after successful render. Unknown renderer type returns `false`.

### App shell flow
1. `app.js` renders login screen immediately.
2. Successful PIN → `mountShell(user)` called exactly once.
3. `mountShell` creates App Shell, initializes router against `#app-content`, calls `setupStationNavigation({ router, mountElement, translate, user })`.
4. Navigation calls `router.navigate('station-home')` to set initial view.

### Station navigation (`station-navigation.js`)
- `setupStationNavigation` owns: route registration, bottom nav state, active item tracking.
- Returns `{ currentItem() }`.
- Five registered routes: `station-home`, `station-prep`, `station-recipes`, `station-chat`, `station-schedule`.
- Recipes, Chat, Schedule → scaffold string renderers (placeholder).
- Station Home and Station Prep → `HTMLElement` renderers (real components).
- Services injected into `createStationPrep`: `fetchStationPrepTasks`, `fetchPrepSuggestions`, `fetchTodayPrepLogs`, `fetchRecentPrepCounts`, `startPrepTask`, `completePrepTask`, `savePrepCount`, `reconcilePrepCount`, and `currentUser`.

### Station Prep data flow
- `fetchStationPrepTasks(stationName)` → `prep_tasks`, filters `category = stationName`, `archived = false`, ordered `name ASC`.
- `fetchPrepSuggestions(taskIds)` → `prep_suggestions_daily`, two-phase paginated query (Phase 1 finds most recent valid run ≥ 50 rows, Phase 2 loads for that date + IDs).
- `fetchTodayPrepLogs(taskNames)` → `prep_log`, local-day window, ordered `created_at ASC`.
- `fetchRecentPrepCounts(taskIds)` → `prep_stock_counts`, 24-hour window, expires_at filter, most recent valid per task.
- Suggestions, logs, and counts load in parallel after tasks are available.
- Component receives all dependencies as injected parameters — no direct Supabase import in page components.
- Async safety: `section.isConnected` checked before any DOM update after promise resolution.

### Station Prep service architecture
- `prep-log-service.js` owns today `prep_log` reads.
- `prep-start-service.js` owns Start writes: updates `in_progress`, `in_progress_at`, `in_progress_by`.
- `prep-complete-service.js` owns completion: inserts `prep_log`, then updates `prep_tasks` (`current_stock`, `need_tomorrow`, `in_progress`, `in_progress_at`, `in_progress_by`, `suggested_qty`, `suggested_note`).
- `complete-prep-form.js` is a reusable UI-only quantity form component (no Supabase import).
- `prep-count-service.js` owns recent physical count reads.
- `prep-count-form.js` is a reusable UI-only count form (no Supabase import).
- `prep-count-write-service.js` owns count insert and `current_stock` update.
- `prep-count-reconciler-service.js` owns the `bot-prep-count-reconciler` Edge Function invocation.
- `station-navigation.js` injects all services including `reconcileCount` into `createStationPrep`.
- Station Prep UI does not duplicate Supabase queries, writes, or Edge Function calls.
- Successful writes update local page state and trigger a local rerender without refetching.
- Successful Count writes update local task and count state.
- Partial Count results update only the current task detail DOM without a full rerender.
- Reconciliation retry and polling are not implemented.

### Station Prep local state
- `workingTasks`: mutable array of shallow-copied task objects. Original `fetchTasks` result never mutated.
- `workingLogsMap`: mutable shallow copy of `logsByTaskName`. Original map and log arrays never mutated.
- `workingCountsMap`: mutable shallow copy of `countsByPrepTaskId`. Each entry shallow-copied. Replaced (not mutated) on Count write.
- `suggestionsMap`: read-only throughout the page lifecycle.
- `render()` is called after each successful Start, Complete, or full Count; creates a fresh `expandController` (all panels collapsed).
- Partial Count results replace only the Last physical count section in the currently expanded task detail.

### Station Prep sorting and sections (004F + 004G)
- Sort: `inProgress === true` always last; then suggestion priority (DO_FIRST=1 … DEFER=10, missing=7); then name ascending case-insensitive.
- Sections (render order): Do first / Do today / Check / Looks good / In progress.
- Empty sections not rendered.
- Original arrays never mutated (`tasks.slice().sort(...)`).

### Suggestion status styling (004E)
- `data-suggestion-status` attribute on `.station-prep__task-bot-status` drives CSS.
- Six values: `do-first`, `do-today`, `looks-good`, `count-first`, `check-tomorrow`, `check`.
- Attribute set from `suggestionStatusAttr(rawStatus)` — never derived from translated text.

### Design tokens (`styles/tokens.css`)
```
--font-sans, --bg-base, --surface, --text-primary, --text-secondary,
--border, --accent, --sp-1…--sp-8, --r-sm/md/lg,
--safe-top/bottom/left/right
```
No new tokens introduced since 002A. All components use only these.

---

## Current Limitations

- No Recipe navigation from Prep.
- No recipe procedure or steps.
- No persistent session across reload.
- No Italian or Spanish locale.
- Home, Recipes, Chat, and Schedule remain placeholders except Station Home and Prep.
- No Chef AI bottom sheet.
- Completion does not automatically use suggested quantity.
- Completion service is sequential rather than transactional: `prep_log` insert may succeed while `prep_tasks` update fails; the UI exposes this partial failure safely.
- Count service is sequential rather than transactional: `prep_stock_counts` insert may succeed while `prep_tasks.current_stock` update fails; the UI exposes this partial failure safely.
- Reconciler failures are not retried automatically.
- No Realtime synchronization between multiple devices.
- No previous-shift WIP resolution flow.
- No recipe timer or procedural step integration.
- No production handoff workflow.
- No station summary progress metrics beyond existing section counts.

---

## Production Safety

- Production Brigade (`sw.js` at `boh-v635`, all non-`boh-v2/` files) remains separate and unchanged.
- BOH OS v2 live URL: `https://1cos.github.io/back-of-house/boh-v2/`
- Do not bump `sw.js` for `boh-v2` changes.

---

## Approved Product Rules

- English first.
- Mobile first, iPhone portrait primary.
- Station Mode first; Executive Chef Mode later; Studio last.
- No modal-based navigation.
- Chef AI will use a contextual bottom sheet.
- One source of truth per domain.
- UI components do not query Supabase directly; services own data access.
- Small, descriptive files. One responsibility per file.
- No `window` globals.
- No inline JavaScript.
- No inline CSS.
- One responsibility per task.
- One atomic commit per task.
- Claude implements explicit technical tasks only.

---

## Known Constraints for Next Session

- `sw.js` on `brigade-main` is at `boh-v635`. Do not bump for `boh-v2` changes.
- `app.js` bootstrap comment still references 003C as last task; update when next structural change lands.
- Recipes, Chat, Schedule routes still use `scaffoldPage()` string renderers.
- No AbortController — navigating away is safe via `isConnected` checks but requests are not cancelled.
- `station-prep.js` uses `.catch()` on the `completeTask` and `saveCount`/`reconcileCount` promise chains.
