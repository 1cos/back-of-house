# BOH OS v2 — Home Composition Engine

> Version 1.0 · 2026-07-16  
> Status: **PROPOSED — requires Max approval before implementation**  
> Depends on: Workspace Engine v1.1  
> Scope: Architecture and composition rules only. No code. No colors. No layout.

---

## 0. What This Document Is

This document defines how the Home panel is composed, not what it looks like.

Home is a **panel** inside the Workspace Engine. It is permanent — it cannot be closed. What it contains changes based on who is looking at it, what time it is, and what the kitchen's operational state is at that moment.

This document defines:
- The philosophy of Home composition.
- The complete catalog of available Home blocks.
- The priority engine that decides which blocks appear and in what order.
- The rules governing block count, visibility, expansion, and collapse.
- The role presets that define the default composition for each user class.
- The extensibility model for adding new blocks without redesigning Home.

---

## 1. Composition Philosophy

### 1.1 Home is not a dashboard

A dashboard shows everything. Home shows what matters right now, to this person, in this shift.

The difference is editorial. A dashboard is a data display. Home is a briefing.

The Home Composition Engine is an editorial engine. It assembles a reading of the current kitchen state and presents it in order of operational urgency. The user does not configure it. The engine generates it.

### 1.2 The newspaper metaphor

Think of the first page of a newspaper written specifically for one reader, published fresh at the start of each shift.

- The headline is what demands immediate attention.
- The lead stories are what the user needs to know before starting work.
- The secondary stories are useful context.
- The filler is not there. Filler wastes the time of a cook who has 90 minutes before service.

If a block has nothing real to say — no urgent prep, no active alerts, no messages — it does not appear. An empty block is never shown.

### 1.3 Home is generated, not configured

The user does not choose what appears on their Home. They have no settings panel, no block toggle, no drag-to-reorder.

The composition is generated from two inputs:
1. The user's **role preset** — their default block catalog and initial priority order.
2. The **operational state** of the kitchen at the moment Home is rendered — which blocks have content, which blocks are urgent, which blocks are empty.

The engine produces a composition. The user reads it.

### 1.4 One composition per role class, not per person

Home is not fully personalized at the individual level in v1. It is personalized at the **role class** level. Every prep cook gets the same block catalog. Every executive chef gets the same block catalog. What varies within a role class is the *content* of the blocks, not the blocks themselves.

Future extension: per-user block weight overrides. Deferred — see §8.

### 1.5 Home is read-only

Home displays information. It does not execute actions.

The one exception: a block may contain a single entry-point button that opens a panel (e.g., "Open your station" opens the station-prep panel). This is navigation, not action. Home never writes to the database.

### 1.6 Rendering cadence

Home is rendered once per activation (following the Workspace Engine v1.1 skeleton-first renderer contract). It does not poll or auto-refresh in v1.

The data it displays is as fresh as the most recent render. If a cook leaves Home open for 4 hours and returns to it, the data is 4 hours old. This is acceptable for v1. Real-time refresh is a future milestone.

---

## 2. Block Catalog

A **block** is the atomic unit of Home composition. Each block has:
- A unique **block ID** (string constant).
- A **data source** (what Supabase tables it reads).
- A **role gate** (which roles may see it).
- A **visibility condition** (when it has content worth showing).
- A **base priority weight** (lower number = higher priority).
- A **size class** (how much vertical space it occupies by default).
- A **financial flag** (whether it contains money data — restricts to admin and executive_chef only).

The complete catalog follows. All blocks are defined here even if they are not yet implemented. Implementation is sequenced separately.

---

### BLOCK: `greeting`

**Description.** Time-aware greeting with the user's name and shift context. "Good morning, Cole." Not a welcome screen — a brief orientation marker.

**Data source.** `users.name`, `users.birth_date`, current time (CDT). No Supabase query beyond what is already in app-state.

**Role gate.** All roles.

**Visibility condition.** Always visible. This block is the one block that is never suppressed. It has no content threshold.

**Base priority weight.** 0 (always first, always present).

**Size class.** XS — one or two lines. Never expands.

**Financial flag.** No.

**Content rules.** The greeting includes:
- Time-based salutation (morning/afternoon/evening, matching the existing `greetingKey()` logic in `station-home.js`).
- User's first name.
- If today is the user's birthday (`users.birth_date` matches today's date): a birthday note. Appears once, in the greeting line, without fanfare.
- Nothing else. No role title. No date. No motivational phrase.

---

### BLOCK: `urgent_alerts`

**Description.** Active alerts requiring the user's immediate attention before starting work. These are not informational — they are items that, if ignored, will cause a problem during service.

**Data source.** `office_items` WHERE `status = 'open'` AND `priority = 'urgent'` AND visible to this role. `alerts` table (if separate). Bot observations classified as `URGENT` by `bot-tell-chef-reader`.

**Role gate.** All roles. Content filtered by role — staff does not see financial alerts.

**Visibility condition.** Only shown when at least one urgent alert exists for this user's role.

**Base priority weight.** 1 (second only to greeting when urgent alerts exist).

**Size class.** S by default. Expands to M if more than 3 alerts. Never shows more than 5 inline — remainder collapsed behind "N more alerts."

**Financial flag.** Per-alert (financial alerts hidden from staff).

**Content rules.** Each alert item: icon by severity, one-line summary, source label (e.g., "Bot · Price Guard"). No inline resolution. Alerts are read here; they are resolved in the Office panel (future).

---

### BLOCK: `station_focus`

**Description.** The user's station and their prep priorities for this shift, distilled to the three most urgent items. This is the actionable core of Home for every station-mode user.

**Data source.** `prep_tasks` WHERE `category = user.defaultStation` AND `archived = false`. `prep_suggestions_daily` for the latest bot suggestions. `prep_tasks.current_stock` and `prep_tasks.in_progress`.

**Role gate.** `staff`, `supervisor`. Not shown to `admin` or `executive_chef` on their Home (they see the multi-station view instead — see `station_overview`).

**Visibility condition.** Always shown for station users who have a `defaultStation`. If `defaultStation` is null, block shows "No station assigned" and is not counted toward block budget.

**Base priority weight.** 2.

**Size class.** M. Expands to L if any `do_first` items exist.

**Financial flag.** No.

**Content rules.**
- Station name header.
- Up to 3 prep items, ordered: `do_first` first, then `do_today`, then `in_progress`.
- Each item: name + bot suggestion status label (DO FIRST / DO TODAY / IN PROGRESS) + quantity if known.
- A single entry-point button: "Open station" — triggers `workspaceManager.openPanel('station-prep', { stationName })`.
- If all prep is `looks_good` or `count_first`: show "Station looks ready" with the count of tasks in good state.
- Does not show the full prep list. The full prep list lives in the `station-prep` panel. This block is the summary.

---

### BLOCK: `wip_handoffs`

**Description.** Previous-shift WIP that was passed to this shift via the handoff service (`chef_reports` records of type handoff). These are tasks that someone started, could not finish, and explicitly handed off. They need a decision.

**Data source.** `chef_reports` WHERE `type = 'handoff'` AND `created_at >= shift_start_threshold` AND `target_station = user.defaultStation` (or all stations for supervisor/exec).

**Role gate.** All roles.

**Visibility condition.** Only shown when at least one unresolved handoff exists.

**Base priority weight.** 3.

**Size class.** S per handoff item. Max 3 items inline.

**Financial flag.** No.

**Content rules.** Each handoff: task name, who passed it, when, and the note they left. No action button on Home — handoff resolution happens in the station-prep panel where the task lives.

---

### BLOCK: `low_stock`

**Description.** Items at or near zero stock that will be needed during today's service. Not the full stock picture — only the items that represent a risk to service if not addressed in the next hour.

**Data source.** `prep_tasks` WHERE `current_stock IS NOT NULL` AND `current_stock <= low_stock_threshold` AND `prep_type IN ('finale', 'supporto')` AND `archived = false`. `prep_suggestions_daily` to confirm `status = 'do_first'`.

**Role gate.** `staff`, `supervisor`, `admin`, `executive_chef`. Not shown to `dish_crew`.

**Visibility condition.** Only shown when at least one item qualifies. The threshold is: `current_stock = 0` OR (`current_stock IS NOT NULL` AND `current_stock < 1.5 × average daily consumption`).

**Base priority weight.** 4.

**Size class.** S. One line per item. Max 5 items inline.

**Financial flag.** No.

**Content rules.** Each item: name + current stock + unit + station. No quantities to produce — that lives in the prep panel. This block is a warning list only.

---

### BLOCK: `kitchen_messages`

**Description.** Recent messages from the brigade chat that this user has not yet seen, or messages that were directly addressed to their station.

**Data source.** `messages` WHERE `created_at >= 12h ago` AND (addressed to this user OR addressed to this station OR general broadcast). Unread count if available.

**Role gate.** All roles.

**Visibility condition.** Only shown when unread messages exist, or when a message was posted to the user's station in the last 4 hours.

**Base priority weight.** 5.

**Size class.** S. Shows the 2 most recent messages inline. "Open Chat" to see more — future panel.

**Financial flag.** No.

**Content rules.** Message sender + station label + first 80 characters of message + time. No reply from Home. Reading only.

---

### BLOCK: `today_production`

**Description.** What this station (or the whole kitchen, for supervisors) has already produced today. A progress indicator, not a task list.

**Data source.** `prep_log` WHERE `station = user.defaultStation` AND `created_at >= today_CDT_start`. For supervisors: all stations.

**Role gate.** `staff`, `supervisor`, `admin`, `executive_chef`. Not `dish_crew`.

**Visibility condition.** Only shown after the first production log entry of the day exists (i.e., some prep has been done). Empty before any prep starts.

**Base priority weight.** 8.

**Size class.** S. Collapsed by default for staff (they know what they made). Expanded by default for supervisors and exec.

**Financial flag.** No.

**Content rules.** List of what was produced: item name + quantity + who + time. For staff: their station only. For supervisors: all stations, grouped by station.

---

### BLOCK: `team_status`

**Description.** A brief view of who is currently active in the kitchen. Not attendance tracking — operational awareness. Who is in progress on what.

**Data source.** `user_presence` WHERE `last_seen >= 30min ago`. `prep_tasks` WHERE `in_progress = true` — mapped to the user who set `in_progress_by`.

**Role gate.** `supervisor`, `admin`, `executive_chef`. Not shown to `staff` or `dish_crew`.

**Visibility condition.** Only shown when at least 2 users are present and active.

**Base priority weight.** 9.

**Size class.** S. One line per active user. Max 6 users inline.

**Financial flag.** No.

**Content rules.** Each active user: name + station + current task (if in_progress) or "available." No performance metrics. No timers. Awareness only.

---

### BLOCK: `station_overview`

**Description.** For supervisors and executive chefs: a high-level picture of all stations — how many tasks are done, in progress, or urgent. Not the detail — the pulse.

**Data source.** `prep_tasks` grouped by `category`. `prep_suggestions_daily` for urgency signals. `prep_tasks.in_progress` counts.

**Role gate.** `supervisor`, `admin`, `executive_chef`. Not `staff` or `dish_crew`.

**Visibility condition.** Always shown for eligible roles when kitchen is in operational hours (defined as 06:00–23:00 CDT).

**Base priority weight.** 6 for supervisors; 3 for executive_chef (higher up their Home).

**Size class.** M for supervisors. L for executive_chef.

**Financial flag.** No.

**Content rules.** One row per station: station name + [N do_first] [N in_progress] [N looks_good]. Color-coded status at the station level (red = has do_first items, yellow = all in_progress or check, green = all looks_good). Opening a station row triggers `workspaceManager.openPanel('station-prep', { stationName })`.

---

### BLOCK: `chef_ai_brief`

**Description.** A pre-computed AI briefing for this user, generated at shift start by the nightly/shift-start pipeline and stored. Not a live LLM call — a read of a pre-computed record. The Chef AI's "what you need to know this morning" distilled to 3–5 sentences.

**Data source.** A dedicated `home_briefings` table (future, to be designed) or the existing `sc-nightly-brief` output, filtered by role.

**Role gate.** All roles. Content filtered by role — financial content only for `admin`/`executive_chef`.

**Visibility condition.** Only shown when a valid briefing record exists for today and this user's role tier. If no briefing has been generated, block is absent.

**Base priority weight.** 7 for staff (context, not urgent); 5 for executive_chef (operational intelligence).

**Size class.** S collapsed, M expanded.

**Financial flag.** Per-content. Financial sentences stripped for non-admin roles.

**Content rules.** Plain prose, 3–5 sentences maximum. No bullet points. No numbers without context. Reads like a senior colleague's morning note. No "AI says" framing — it is the voice of the kitchen information system.

---

### BLOCK: `yesterday_recap`

**Description.** Key numbers from yesterday's service — how many covers, which prep items were tight, what the kitchen produced. Context for today's decisions.

**Data source.** `pos_sales_by_item` for yesterday's date. `prep_log` for yesterday. `stock_daily_snapshot` for stock at end of service.

**Role gate.** All roles. Financial data stripped for `staff` and `dish_crew`.

**Visibility condition.** Only shown when yesterday's data has been imported (i.e., the nightly TouchBistro import has run and `pos_daily_clean` has records for yesterday's business date).

**Base priority weight.** 10.

**Size class.** S collapsed. Expands to M on tap.

**Financial flag.** Partial. Cover count and volume are visible to all. Net sales and margins visible only to `admin`/`executive_chef`.

**Content rules.** For staff: "Last night: N covers. Top items: X, Y, Z. Tight: A, B." For exec: same plus revenue line. No raw data tables — narrative summary only.

---

### BLOCK: `upcoming_events`

**Description.** Reserved events or special circumstances affecting today's or tomorrow's service. Private dining rooms, large parties, catering prep requirements.

**Data source.** `tripleseat_events` (future — pending TripleSeat OAuth authorization) OR `daily_journal` entries tagged `category='catering'` or `category='service'`. Currently: manual journal entries only.

**Role gate.** `supervisor`, `admin`, `executive_chef`, `coordinator`.

**Visibility condition.** Only shown when an event record exists for today +1 day ahead.

**Base priority weight.** 4 (same tier as low_stock — events directly affect prep decisions).

**Size class.** S. One line per event.

**Financial flag.** No.

**Content rules.** Event name + guest count + time + any prep note attached to the event. No pricing. No revenue data.

---

### BLOCK: `delivery_expected`

**Description.** Vendor deliveries expected today. Tells the coordinator or exec what is arriving and when, so receiving can be organized before the prep rush.

**Data source.** `vendor_documents` WHERE `delivery_date = today` AND `status IN ('pending', 'ordered')`. This data is populated by the invoice import pipeline.

**Role gate.** `coordinator`, `supervisor`, `admin`, `executive_chef`.

**Visibility condition.** Only shown when at least one delivery is expected today.

**Base priority weight.** 5.

**Size class.** S. One line per expected delivery.

**Financial flag.** No (vendor name and item category only — no pricing in this block).

**Content rules.** Vendor name + expected items (category, not itemized list) + expected time if known. Does not show invoice details. Navigation to full vendor documents is a future panel.

---

### BLOCK: `birthdays`

**Description.** Team members celebrating a birthday today. A human moment at the start of the shift.

**Data source.** `users.birth_date` WHERE `EXTRACT(MONTH FROM birth_date) = EXTRACT(MONTH FROM TODAY)` AND `EXTRACT(DAY FROM birth_date) = EXTRACT(DAY FROM TODAY)` AND `active = true`.

**Role gate.** All roles.

**Visibility condition.** Only shown on days when at least one team member has a birthday. Disappears otherwise.

**Base priority weight.** 11 (low — nice to have, never urgent).

**Size class.** XS. One line. Never expands.

**Financial flag.** No.

**Content rules.** "Happy birthday, [Name]!" Only first name. One entry per person. If multiple people share the birthday: each gets their own line.

---

### BLOCK: `equipment_alerts`

**Description.** Reported equipment issues that are unresolved and affect today's production. A broken oven or a malfunctioning dishwasher are production-critical.

**Data source.** `daily_journal` WHERE `category = 'equipment'` AND `severity IN ('warning', 'critical')` AND `business_date >= yesterday` AND unresolved (no follow-up journal entry marking it resolved).

**Role gate.** All roles.

**Visibility condition.** Only shown when an unresolved equipment issue has been logged.

**Base priority weight.** 3 when `severity = 'critical'`; 6 when `severity = 'warning'`.

**Financial flag.** No.

**Size class.** S. One line per issue.

**Content rules.** Equipment name + issue description (first 60 chars) + reported by + when. No resolution action from Home — handled in Journal panel (future).

---

### BLOCK: `dish_crew_focus`

**Description.** The Dish Crew equivalent of `station_focus`. Simplified, task-oriented, no prep quantities. What needs to happen in dish before service starts.

**Data source.** `prep_tasks` WHERE `category = 'Dish Crew'` AND `archived = false`. `closing_checks` for dish-crew-relevant closing tasks from the previous night.

**Role gate.** `dish_crew` only.

**Visibility condition.** Always shown for dish crew users.

**Base priority weight.** 2 (same as `station_focus` for other roles).

**Size class.** M.

**Financial flag.** No.

**Content rules.** Task name + status (done/pending). Simple checklist format. No quantities. No bot suggestions. No stock levels. The dish crew needs to know what to do, not how much.

---

## 3. Block Priority System

### 3.1 Priority weight is a base, not a fixed position

Every block has a **base priority weight** defined in the catalog (§2). Lower number = higher position on Home.

The engine computes a **resolved priority** for each block at render time by applying **urgency modifiers** to the base weight. A block's urgency modifier can only lower its weight (push it higher) — it can never increase it (blocks cannot be demoted below their base position by urgency).

```
resolved_priority = base_weight − urgency_modifier
```

**Urgency modifiers:**

| Condition | Modifier |
|---|---|
| Block contains one or more items with `severity = 'critical'` | −3 |
| Block contains items with `status = 'do_first'` | −2 |
| Block contains a WIP handoff from a previous shift | −2 |
| Block contains an item that was flagged by a bot as urgent | −1 |
| Block has new content since last render | −1 |

Modifiers stack. A `low_stock` block with two `do_first` items and a critical severity alert receives a modifier of −3 − 2 = −5, giving a resolved priority of 4 − 5 = −1. It appears directly after `greeting` (priority 0).

### 3.2 Tiebreaking

When two blocks have the same resolved priority: the block with the higher data freshness (more recently updated source records) appears first.

When freshness is identical: the catalog order (§2) is used as the tiebreaker.

### 3.3 The priority engine runs once per Home render

Priority is computed when the Home panel renderer is called. It is not recomputed in real time. This matches the render-on-activation model of the Workspace Engine.

### 3.4 Empty blocks are removed before priority sorting

A block with no qualifying content is removed from the block list before priority is computed. Priority sorting only orders the blocks that will actually appear. Empty blocks are not shown as empty containers.

### 3.5 `greeting` is exempt from priority sorting

`greeting` always occupies position 0. It is inserted after priority sorting, not before. The priority engine sorts all other blocks first, then `greeting` is prepended.

---

## 4. Composition Rules

### 4.1 Maximum block count

The maximum number of blocks displayed on Home is **7** (including `greeting`). This is a constant: `HOME_MAX_BLOCKS = 7`.

This limit is not a display constraint — it is an editorial constraint. A Home with 12 blocks is not a briefing. It is a dashboard. The engine enforces the limit by keeping only the 7 highest-priority blocks (by resolved priority) after removing empty blocks.

The remaining blocks are suppressed silently. They produce no "N more items" indicator. If a block did not make the cut, the information it would contain is accessible through the relevant panel, not through Home.

### 4.2 When blocks appear

A block appears on Home when both conditions are true:
1. The block passes the role gate for this user.
2. The block's visibility condition evaluates to true (it has qualifying content).

A block that passes the role gate but has no qualifying content is not shown — not even as a placeholder or an empty state.

Exception: `greeting` always appears. `station_focus` for station users always appears (showing "Station ready" if no urgent prep, or "No station assigned" if `defaultStation` is null).

### 4.3 When blocks disappear

A block disappears from Home when:
- Its visibility condition no longer evaluates to true (content was resolved or expired).
- The user's role gate changes (not applicable in v1 — roles are fixed per session).

Block disappearance is detected on the next Home render (activation). There is no live removal in v1.

### 4.4 When blocks expand

Each block has a default size class (XS, S, M, L). In v1, size class is fixed per block and not user-adjustable.

A block may render in a larger size class than its default when urgency conditions apply:
- `station_focus` renders in size class L (instead of M) when any `do_first` items exist.
- `station_overview` renders in size class L (instead of M) for `executive_chef`.
- `urgent_alerts` renders in size class M (instead of S) when more than 3 alerts exist.

There is no user-initiated expand in v1. All size decisions are made by the engine. Tapping a block navigates to the relevant panel — it does not expand the block in-place.

### 4.5 When blocks collapse

Blocks are never interactively collapsed in v1. The `yesterday_recap` block has a collapsed default (S) and can expand to M on tap — this is the only interactive size change in v1, and it is an exception for information density, not a general pattern.

### 4.6 When blocks reorder

Blocks do not reorder after initial render in v1. The composition is computed once at render time and does not change until the next activation.

Future: live priority recalculation on incoming Realtime events (e.g., a new urgent alert pushes `urgent_alerts` to the top). This requires no API change — the renderer is called again, and the composition is recomputed from scratch.

### 4.7 Financial data rule (permanent)

**No block may show financial data (net_sales, gross_sales, food_cost, labor_cost, margins, invoice prices) to users with role `staff`, `supervisor`, or `dish_crew`.**

This rule is enforced at the block level, not at the Home level. The composition engine does not need to know about it — each block's data fetching function is responsible for stripping financial fields based on the user's role.

The `yesterday_recap` block has explicit per-field filtering: cover count visible to all; revenue visible only to `admin`/`executive_chef`. The `chef_ai_brief` block strips financial sentences from the pre-computed text before rendering for non-admin roles.

---

## 5. Role Presets

A role preset defines:
- The **permitted block catalog**: which blocks are available to this role.
- The **default composition**: the blocks that appear if all visibility conditions are met and the block budget allows.

In practice, the engine builds a composition from the permitted catalog, applies visibility conditions to remove empty blocks, applies priority sorting, and truncates to `HOME_MAX_BLOCKS`. The preset is the starting catalog, not the guaranteed output.

---

### 5.1 Prep Cook / Line Cook (`role = 'staff'`)

Includes all station-mode users: Saucier, Pastry, Salad, Oven, Pasta, Fresh Pasta, Sauté, Plating, Table Side.

**Permitted block catalog:**

| Block ID | Base priority |
|---|---|
| `greeting` | 0 |
| `urgent_alerts` | 1 |
| `station_focus` | 2 |
| `wip_handoffs` | 3 |
| `low_stock` | 4 |
| `kitchen_messages` | 5 |
| `chef_ai_brief` | 7 |
| `today_production` | 8 |
| `yesterday_recap` | 10 |
| `birthdays` | 11 |

**Excluded blocks:** `team_status`, `station_overview`, `upcoming_events`, `delivery_expected`, `equipment_alerts` (staff does not need the cross-kitchen view), `dish_crew_focus`.

**Typical composition (opening shift, no alerts):**

```
1. greeting          — "Good morning, Cole."
2. station_focus     — "Saucier Station · 3 items · DO FIRST: Arrabbiata (0g in stock)"
3. wip_handoffs      — [absent — no handoffs]
4. kitchen_messages  — [absent — no messages]
5. chef_ai_brief     — "Tuesday. Salmon Cakes and Scallops moved fast yesterday..."
6. today_production  — [absent — nothing produced yet]
7. yesterday_recap   — "Monday: 87 covers. Top: Salmon Fettuccine (28), Brussels Sprouts (22)."
8. birthdays         — [absent unless today]
```

**Typical composition (mid-shift, alerts active):**

```
1. greeting          — "Good afternoon, Cole."
2. urgent_alerts     — "1 alert: Arrabbiata at zero stock"
3. station_focus     — Arrabbiata: DO FIRST (priority elevated)
4. wip_handoffs      — "Brisket: started by Todd, passed to this shift"
5. low_stock         — Scallops: 0 pz
6. kitchen_messages  — "Colton (Pasta): Grilled chicken needed by 4PM"
7. today_production  — "Produced: Pomodoro Sauce 3.5kg · Cole · 9:15 AM"
```

---

### 5.2 Dish Crew (`role = 'staff'`, `defaultStation = 'Dish Crew'`)

Dish Crew is a staff role with a specialized composition. The station override is detected by `user.defaultStation === 'Dish Crew'` and routes to the Dish Crew preset instead of the standard staff preset.

**Permitted block catalog:**

| Block ID | Base priority |
|---|---|
| `greeting` | 0 |
| `urgent_alerts` | 1 |
| `dish_crew_focus` | 2 |
| `kitchen_messages` | 5 |
| `birthdays` | 11 |

**Excluded blocks:** Everything else. Dish Crew does not see prep quantities, stock levels, production logs, bot briefings, yesterday's sales, or team status. Their Home is operationally focused and minimal by design.

**No Focus Mode for Dish Crew** (confirmed decision — see BOH_OS_DECISIONS.md backlog).

**Typical composition:**

```
1. greeting        — "Good morning, Austin."
2. dish_crew_focus — "Dish Crew · 3 tasks · Pre-service setup pending"
3. kitchen_messages — [absent unless messages exist]
4. birthdays       — [absent unless today]
```

---

### 5.3 Coordinator (`role = 'supervisor'`, Tela)

The Kitchen Operation Coordinator has a cross-station view without financial data. Tela needs to know what is happening everywhere so she can manage logistics and ordering. She does not close stations (confirmed decision).

**Permitted block catalog:**

| Block ID | Base priority |
|---|---|
| `greeting` | 0 |
| `urgent_alerts` | 1 |
| `station_overview` | 6 |
| `wip_handoffs` | 3 |
| `low_stock` | 4 |
| `delivery_expected` | 5 |
| `kitchen_messages` | 5 |
| `team_status` | 9 |
| `equipment_alerts` | 3–6 |
| `upcoming_events` | 4 |
| `chef_ai_brief` | 7 |
| `today_production` | 8 |
| `yesterday_recap` | 10 |
| `birthdays` | 11 |

**Excluded blocks:** `station_focus`, `dish_crew_focus` (she sees the overview, not a single station).

**Typical composition (before service):**

```
1. greeting           — "Good morning, Tela."
2. urgent_alerts      — [if any]
3. delivery_expected  — "Hardie's arriving today · Produce + Proteins"
4. upcoming_events    — "Private dining: 8 guests, 7 PM — prep note: add 4 covers Tiramisu"
5. station_overview   — All stations: 2 red, 1 yellow, 7 green
6. low_stock          — Lobster Tail: 0 each
7. kitchen_messages   — "David: Brisket needs to be pulled at 11"
8. chef_ai_brief      — "Tuesday focus: Salmon production and Thursday prep window..."
```

---

### 5.4 Sous Chef (`role = 'supervisor'`, David / Colton)

Sous Chefs manage the brigade during service. They need team visibility, station status, and handoffs. Like the Coordinator, no financial data.

**Permitted block catalog:** Identical to Coordinator.

**Priority overrides for Sous Chef:**
- `team_status` base priority: 6 (higher than Coordinator's 9 — sous chefs need team awareness faster).
- `station_overview` base priority: 5 (higher than Coordinator's 6 — service-focus).
- `delivery_expected` base priority: 8 (lower than Coordinator's 5 — deliveries are Tela's domain).

**Typical composition (during service):**

```
1. greeting         — "Good evening, David."
2. urgent_alerts    — [if any]
3. wip_handoffs     — "Pastry: Tiramisu started by Samantha, passed at 3:45 PM"
4. team_status      — "Cole: Saucier (in progress: Arrabbiata) · Samantha: Pastry · ..."
5. station_overview — 1 red (Table Side: no NY Strip), 9 green
6. low_stock        — NY Strip: 0 pz
7. kitchen_messages — "Max: 86 the salmon cake tonight"
8. chef_ai_brief    — [service context, no financial data]
```

---

### 5.5 Executive Chef (`role = 'admin'` or `'executive_chef'`, Max)

The Executive Chef's Home is the full operational picture of the kitchen. All blocks available. Financial data visible. Chef AI briefing includes intelligence from all bot outputs.

**Permitted block catalog:** All blocks.

**Priority overrides for Executive Chef:**
- `chef_ai_brief` base priority: 2 (elevated — this is Max's primary intelligence channel).
- `station_overview` base priority: 3 (elevated — Max wants the full kitchen picture early).
- `urgent_alerts` base priority: 1 (same — always first after greeting).
- `upcoming_events` base priority: 4 (elevated — Max needs to plan around events).
- `delivery_expected` base priority: 5 (important context for ordering decisions).
- `yesterday_recap` base priority: 6 (Max uses yesterday's data for today's decisions — elevated from 10).
- `team_status` base priority: 9 (deprioritized vs Sous Chef — Max reads the overview, not individual presence).

**Typical composition (morning, before brigade arrives):**

```
1. greeting          — "Good morning, Max."
2. urgent_alerts     — [if any — includes financial alerts]
3. chef_ai_brief     — "Tuesday, July 16. Salmon production is the priority. Modifier data shows Caesar dressing
                        consumption up 18% vs last week. Arrabbiata at zero — 4 batches needed by noon.
                        Net sales Monday: $4,280. Food cost: 31.2%."
4. station_overview  — Full kitchen: 3 red, 2 yellow, 5 green
5. upcoming_events   — "Private dining: 8 covers tonight, 7 PM"
6. delivery_expected — "Hardie's today, Frugé Thursday"
7. yesterday_recap   — "Monday: 87 covers, $4,280 net sales, top item Salmon Fettuccine"
```

---

## 6. The Composition Engine — Data Contract

### 6.1 What the engine receives

The Home renderer receives a single `homeContext` object assembled by the caller (`app.js` or the Home service). The renderer does not fetch from Supabase directly.

```
homeContext {
  user:          { id, name, role, language, defaultStation, birthDate }
  blocks:        BlockData[]       ← pre-fetched data for each candidate block
  renderTime:    Date              ← CDT timestamp of render
}

BlockData {
  blockId:       string            ← matches a catalog ID from §2
  hasContent:    boolean           ← pre-evaluated visibility condition
  urgencyScore:  number            ← pre-computed urgency modifier (0 or negative)
  data:          object            ← block-specific payload (pre-fetched, role-filtered)
}
```

### 6.2 What the engine produces

```
HomeComposition {
  blocks: RenderedBlock[]          ← ordered by resolved priority, truncated to HOME_MAX_BLOCKS
}

RenderedBlock {
  blockId:       string
  resolvedPriority: number
  sizeClass:     'XS' | 'S' | 'M' | 'L'
  data:          object
}
```

### 6.3 Engine algorithm

```
function composeHome(homeContext):
  user = homeContext.user
  preset = getPreset(user)                          // role + defaultStation → preset
  candidates = preset.permittedBlocks
    .map(blockId → homeContext.blocks[blockId])
    .filter(b → b.hasContent)                       // remove empty blocks

  sorted = candidates.sort(b →
    BASE_PRIORITY[b.blockId] + b.urgencyScore)      // ascending (lower = first)

  truncated = sorted.slice(0, HOME_MAX_BLOCKS - 1)  // reserve slot 0 for greeting

  greeting = buildGreeting(user, homeContext.renderTime)

  return [greeting, ...truncated]
```

### 6.4 Data fetching — where it happens

All Supabase reads for Home happen in a **Home data service** (`home-data-service.js` — future file). This service is injected into the Home renderer, following the existing dependency-injection pattern of v2.

The Home renderer does not import `supabase-client.js`. It receives all data pre-fetched. This is the same principle as `createStationPrep` receiving `fetchStationPrepTasks` as an injected dependency.

The Home data service:
- Runs all block data fetches in parallel (`Promise.all`).
- Applies role-based filtering to each block's data before returning.
- Returns the complete `homeContext` object.
- Is called once per Home activation.

---

## 7. Extensibility Model

### 7.1 Adding a new block

Adding a new block to Home requires exactly three steps, and no step touches any existing block:

1. **Define the block in the catalog.** Add a new entry to §2 of this document with all required fields: ID, data source, role gate, visibility condition, base priority weight, size class, financial flag, content rules.

2. **Implement the block renderer.** Create a function `renderBlockXxx(data) → HTMLElement` in `home-blocks.js` (future file). This function is registered in the `BLOCK_RENDERERS` map by block ID. It knows nothing about priority, ordering, or other blocks.

3. **Implement the block data fetcher.** Add a fetch function to `home-data-service.js` that returns `{ hasContent, urgencyScore, data }` for the new block. Register it in the `BLOCK_FETCHERS` map by block ID. The composition engine calls all fetchers in the registry — it does not need to know about the new one by name.

No changes to the composition engine. No changes to role presets (unless the new block should be in a preset — that is a separate, optional change). No changes to existing blocks.

### 7.2 Modifying an existing block's data or appearance

Changes to a block's renderer or data fetcher are local to that block's functions. No other block is affected.

Changes to a block's base priority, role gate, or size class require updating this document and the corresponding constant in the `BLOCK_CATALOG` registry object.

### 7.3 Modifying a role preset

A preset change (adding or removing a block from a role's permitted catalog, or changing a priority override) is a one-line change in the `ROLE_PRESETS` object. No renderer is touched.

### 7.4 The registry pattern

The composition engine operates on two registries:

```
BLOCK_FETCHERS:   { [blockId]: (user) → Promise<BlockData> }
BLOCK_RENDERERS:  { [blockId]: (data) → HTMLElement }
BLOCK_CATALOG:    { [blockId]: { basePriority, sizeClass, financialFlag, ... } }
ROLE_PRESETS:     { [roleKey]: { permittedBlocks: string[], priorityOverrides: {...} } }
```

Adding a block = adding one entry to each of the first three registries. Updating a preset = updating one entry in the fourth. The composition engine function itself never changes.

### 7.5 Future: per-user weight overrides

The extensibility model reserves space for a future `user_home_preferences` table that stores per-user block weight deltas (e.g., Max decides he wants `yesterday_recap` to always appear second). This would add a fifth registry layer (`USER_OVERRIDES`) applied after preset priority overrides. No architectural change required — the composition engine already accepts a `priorityOverrides` parameter.

---

## 8. Non-Goals

This document does not define:

- Visual layout, spacing, or typography of blocks.
- Color coding of any block element.
- CSS implementation of size classes.
- Animation or transition behavior.
- The `home-data-service.js` implementation (service layer — separate task).
- The `home-blocks.js` implementation (renderers — separate task).
- Real-time Home refresh (future milestone).
- Per-user block configuration (future milestone).
- The `home_briefings` DB table schema for `chef_ai_brief` (future, requires separate session).
- Kitchen Display integration.
- Chef AI drawer behavior on Home.
- The Schedule block content (future — requires 7shifts integration).

---

## 9. Approval Checkpoint

Before any implementation of the Home panel:

- [ ] Max confirms that Home is read-only — no actions executed from Home (navigation only).
- [ ] Max confirms `HOME_MAX_BLOCKS = 7`.
- [ ] Max confirms the Dish Crew preset (§5.2) — minimal, 4 blocks maximum.
- [ ] Max confirms the Executive Chef preset (§5.5) — includes financial data.
- [ ] Max confirms that `chef_ai_brief` shows financial data for `admin`/`executive_chef` only.
- [ ] Max confirms that `station_focus` always appears for station users even when all prep is in good state.
- [ ] Max confirms that blocks with no content are silently absent (no empty-state placeholders).

Implementation begins only after all seven items above are checked.

---

*End of Home Composition Engine Specification.*  
*Companion documents:*  
*— `boh-v2/docs/BOH_OS_V2_WORKSPACE_ENGINE.md` v1.1*  
*— `boh-v2/docs/WORKSPACE_ARCHITECTURE.md` v1.0*
