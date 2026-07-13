# BOH OS v2 — Next Session Prompt

## Session startup protocol

At the start of a new session, before writing any code:

1. Read `boh-v2/docs/SESSION_STATE.md` from `brigade-main` for project context.
2. Read `sw.js` from `brigade-main` for the live version number (pattern `boh-vNNN`). Do **not** bump it for `boh-v2` changes.
3. Read every live file you will touch before modifying it — always from GitHub, never from a stale local copy.
4. Never re-read between messages in the same session.
5. Never work from `/mnt/project/` copies for code pushes.

---

## Current state summary

Foundation, login, App Shell, Station navigation, Station Home, and Station Prep Tasks 004A through 004G are complete.

The Station Prep page is live and functional:

- Loads active prep tasks for the user's default station from `prep_tasks`.
- Loads bot suggestions from `prep_suggestions_daily` (two-phase paginated query, valid run ≥ 50 rows, last 7 days).
- Merges suggestions into task rows by `prep_task_id`.
- Displays suggestion status as a styled pill (`data-suggestion-status` attribute).
- Sorts tasks by operational priority (DO_FIRST → DO_TODAY → COUNT_FIRST → VERIFY → UNAVAILABLE → missing → LOOKS_GOOD → DEFER).
- Groups tasks into five sections: Do first / Do today / Check / Looks good / In progress.
- In-progress tasks always land in the "In progress" section regardless of bot status.
- Empty sections not rendered.

Recipes, Chat, and Schedule are still scaffold placeholders.

---

## Next action

Wait for **Task 004H — Station Prep Collapsible Task Detail**.

Do not begin Sprint 005 or Station Recipes until Task 004H is completed and approved.

---

## Architecture rules (do not violate)

- Vanilla JS, native ES modules, no bundler, no framework.
- No `window` writes, no storage APIs, no `localStorage`, no `sessionStorage`.
- No `innerHTML` for dynamic user data — always `textContent`.
- All static visible text via `en.js` keys and `t()`.
- No direct Supabase imports in page components — pass services as injected dependencies.
- Renderers return `HTMLElement` (preferred) or `string`. The router handles both.
- Async safety: always check `element.isConnected` before updating DOM after a promise resolves.
- Never mutate arrays returned by services. Use `.slice()` before `.sort()`.
- One responsibility per file. No shared mutable state between modules.
- Production Brigade (`sw.js`, all non-`boh-v2/` files) must never be touched.

---

## File scope rules

Before any task:

- **Create** only the files listed in the task spec under "Create exactly N files".
- **Modify** only the files listed under "Modify exactly N files".
- If a required change is outside the listed files, **stop and report the exact blocker** — do not expand scope silently.
- Scope corrections approved by Max (e.g., a missing parameter at an existing call site) must be explicitly documented in the task output.

---

## Push protocol

1. Read the live file from GitHub API.
2. Edit in `/tmp/`.
3. `node --check` every modified JS file.
4. Fetch fresh SHA immediately before each PUT / tree creation.
5. Use Git Tree API for multi-file atomic commits (never sequential Contents API PUTs).
6. Verify all files landed at expected SHAs after push.

---

## Key database tables referenced so far

| Table | Used by |
|-------|---------|
| `users` | `auth-service.js` — PIN login |
| `settings` | `supabase-client.js` — connection probe |
| `prep_tasks` | `station-prep-service.js` — active prep tasks |
| `prep_suggestions_daily` | `prep-suggestion-service.js` — bot suggestions |

Tables known but not yet queried from boh-v2: `recipes`, `recipe_steps`, `recipe_bom`, `tell_chef_reports`, `current_stock`, `prep_stock_counts`.

---

## Supabase project

Project ID: `ydqmumpytgrlceuinoqt` ("Mise en Place")  
Client singleton: `boh-v2/src/core/supabase-client.js`  
Import pattern in services: `import { supabase } from '../core/supabase-client.js';`

---

## Translation key conventions

Namespace pattern: `{screen}_{element}`.

Existing namespaces:
- `app.*` — global app identity
- `mode.*` — mode labels
- `auth.*` — login screen
- `nav.*` — bottom navigation
- `station_home.*` — Station Home page
- `station_prep.*` — Station Prep page

All keys go in `boh-v2/src/locales/en.js`. No Italian or Spanish in boh-v2 (multilingual support deferred).

---

## Token reference (from `styles/tokens.css`)

```css
--font-sans          /* system font stack */
--bg-base            /* #eff6ff — page background */
--surface            /* #ffffff — cards, panels */
--text-primary       /* #1e3a5f */
--text-secondary     /* #3b6ea8 */
--border             /* rgba(37,99,235,0.13) */
--accent             /* #2563eb — blue-600 */
--sp-1…--sp-8        /* 4px, 8px, 12px, 16px, 20px, 24px, 32px */
--r-sm / --r-md / --r-lg   /* 8px, 12px, 16px */
--safe-top/bottom/left/right  /* env(safe-area-inset-*) */
```

Do not add new color tokens. Do not use hardcoded hex values in CSS.
