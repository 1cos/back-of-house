# BOH OS v2 — Session State

## Current Status

- Foundation: **complete**
- Authenticated App Shell: **complete**
- Station Mode navigation: **complete**
- Station Home: **complete**
- Station Prep read-only page: **complete** (Tasks 004A–004G landed this session)

The Station Prep page is fully functional: it loads tasks and bot suggestions, merges them, sorts by operational priority, groups into five named sections (Do first / Do today / Check / Looks good / In progress), and styles each suggestion status as a labelled pill. Recipes, Chat, and Schedule remain scaffold placeholders.

---

## Next Task

**Task 004H — Station Prep Collapsible Task Detail**

Scope:

- Keep the existing Station Prep sectioned list.
- Allow one prep task row to expand and collapse.
- Display only suggestion data already loaded by the page.
- Do not add a database query.
- Do not add writes.
- Do not add Start.
- Do not add Done.
- Do not add Count.
- Do not add Recipe navigation.
- Do not begin Station Recipes.

Sprint 005 (Station Recipes) does not begin until Task 004H is completed and approved.

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
      prep-suggestion-service.js
      station-prep-service.js
  styles/
    app-shell.css
    base.css
    bottom-navigation.css
    layout.css
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

### Station Prep data flow
- `fetchStationPrepTasks(stationName)` → `prep_tasks` table, filters `category = stationName`, `archived = false`, ordered by `name ASC`.
- `fetchPrepSuggestions(taskIds)` → `prep_suggestions_daily`, two-phase: paginated Phase 1 finds most recent date with ≥ 50 rows (500 rows/page), Phase 2 loads suggestions for valid date + requested IDs.
- Component receives both as injected dependencies — no direct Supabase import in page components.
- Async safety: `section.isConnected` checked before any DOM update after promise resolution.

### Station Prep sorting and sections (004F + 004G)
- Sort: `inProgress === true` always last; then suggestion priority (DO_FIRST=1 … DEFER=10, missing=7); then name ascending case-insensitive.
- Sections (render order): Do first / Do today / Check / Looks good / In progress.
- `inProgress === true` overrides suggestion status for section assignment.
- LOOKS_OK, LOOKS_GOOD, DEFER_TO_TOMORROW, DEFER → "Looks good" section.
- COUNT_FIRST, VERIFY, UNAVAILABLE, missing/unknown → "Check" section.
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

## Known Constraints for Next Session

- `sw.js` on `brigade-main` is at `boh-v635`. The `boh-v2/` app is served at `https://1cos.github.io/back-of-house/boh-v2/` and does **not** use the service worker cache (sw.js controls the root Brigade PWA, not boh-v2). Do not bump sw.js for boh-v2 changes.
- `app.js` bootstrap comment still references 003C as last task; update when next structural change lands.
- Recipes, Chat, Schedule routes still use `scaffoldPage()` string renderers.
- No AbortController yet — navigating away during a slow load is safe via `isConnected` check but requests are not cancelled.
- `station-prep.js` has no `.catch()` on service promise chains — intentional; both services return `{ ok: false }` instead of throwing.
