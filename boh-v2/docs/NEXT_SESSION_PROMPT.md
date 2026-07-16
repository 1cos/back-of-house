# BOH OS v2 — Next Session Prompt

## OEE PHASE 1 STATUS: ✅ COMPLETE (2026-07-16)

All three kitchen operations are routed through atomic, server-authoritative,
idempotency-hardened Supabase RPCs. No Brigade production files were modified.

---

## Active Routing Table

| Operation | Frontend producer(s) | Service | RPC |
|---|---|---|---|
| PREP_STARTED | `buildStartButton` (Start btn) | `prep-start-rpc-service.js` | `rpc_oee_record_prep_start` |
| PREP_STARTED | `continueBtn` (WIP Continue) | same service | same RPC |
| PREP_COMPLETED | `buildCompleteButton` (Complete btn) | `prep-complete-rpc-service.js` | `rpc_oee_record_prep_completion` |
| PREP_COMPLETED | `finishedBtn` (WIP "I finished it") | same service | same RPC |
| STOCK_COUNT_RECORDED | `buildCountButton` (Count btn) | `prep-count-rpc-service.js` | `rpc_oee_record_stock_count` |
| Reconciler | after saveCount returns ok:true | `prep-count-reconciler-service.js` | `bot-prep-count-reconciler` EF |

---

## Migration Inventory

| File | Deploys | Status |
|---|---|---|
| `20260716_001_oee_phase1_schema.sql` | `operational_events`, `operational_event_transitions`, FK cols on `prep_log`/`prep_stock_counts` | ✅ deployed |
| `20260716_002_oee_phase1_rpcs.sql` | Original bodies of all 3 RPCs (no conflict detection) | ✅ deployed |
| `20260716_003_oee_prep_start_idempotency_hardening.sql` | Hardens `rpc_oee_record_prep_start` — 6-field payload validation, `IDEMPOTENCY_KEY_CONFLICT` | ✅ deployed |
| `20260716_004_oee_prep_completion_idempotency_hardening.sql` | Hardens `rpc_oee_record_prep_completion` — same pattern | ✅ deployed |
| `20260716_005_oee_stock_count_idempotency_hardening.sql` | Hardens `rpc_oee_record_stock_count` — same pattern | ✅ deployed |

---

## Key Commit Hashes (OEE Phase 1)

| Commit | Change |
|---|---|
| `a02164d8bd18` | Migration 003 — PREP_STARTED idempotency |
| `2649a1f7a8c4` | `prep-start-rpc-service.js` — UUID validation, no fallback, conflict mapping |
| `28fc852f4425` | `station-prep.js` — `continueBtn` gets `pendingContinueOp` |
| `bf3c4e85333d` | `prep-complete-rpc-service.js` (new) |
| `0a2df744d4ea` | Migration 004 — PREP_COMPLETED idempotency |
| `40d525cdfa68` | `station-navigation.js` — `completeTask: completePrepTaskRpc` |
| `895da21324a0` | `station-prep.js` — `buildCompleteButton` + `finishedBtn` with `pendingCompleteOp`/`pendingFinishedOp` |
| `313793ed627d` | `prep-count-rpc-service.js` (new) |
| `84ce174ef47a` | `station-navigation.js` — `saveCount: savePrepCountRpc` |
| `40cde5286d1f` | `station-prep.js` — `buildCountButton` with `pendingCountOp` (Rules A/B/C) |
| `6d651b1e6406` | Migration 005 — STOCK_COUNT_RECORDED idempotency |
| `ece129290ace` | `station-prep.js` — clear `pendingCountOp` before reconcileCount |

---

## Behavior Guarantees

### Per-operation events
- **PREP_STARTED** → 1 root event (`PREP_STARTED`, `event_role=root`)
- **PREP_COMPLETED** → 1 root event (`PREP_COMPLETED`) + 1 derived fact (`PREP_STOCK_UPDATED`)
- **STOCK_COUNT_RECORDED** → 1 root event (`STOCK_COUNT_RECORDED`) + 1 derived fact (`PREP_STOCK_VERIFIED`)

### Transitions (all root events)
5 rows in `operational_event_transitions`: `received → authorized → execution_started → execution_completed → completed`

### Idempotency contract
- Client owns `clientOperationId` (UUID v4) and `occurredAt` (ISO timestamp)
- Same UUID + identical payload → `ok:true, idempotent:true` — no second write
- Same UUID + different payload → `IDEMPOTENCY_KEY_CONFLICT` — no write, `retriable:false`
- Matching rules enforced: `event_role`, `type`, `source_module`, `task_id` + operation-specific fields
- Applied to both the pre-insert fast path and the concurrent UNIQUE-violation path

### Atomic write guarantees
- PREP_STARTED: `prep_tasks` update in same transaction as event
- PREP_COMPLETED: `prep_log` insert + `prep_tasks` update in same transaction — no partial failure
- STOCK_COUNT_RECORDED: `prep_stock_counts` insert (`ON CONFLICT DO NOTHING`) + `prep_tasks.current_stock` update in same transaction

### Reconciler boundary
- Reconciler (`bot-prep-count-reconciler` EF) is called **after** `saveCount` confirms `ok:true`
- `pendingCountOp` is cleared **before** calling the reconciler — reconciler failure does NOT require repeating saveCount
- Reconciler writes to `prep_stock_counts.reconcile_status` etc. — does not write to `prep_tasks`

### Retry-context lifecycle (all three operations)
| Context var | Operation | Cleared on | Retained on |
|---|---|---|---|
| `pendingOp` | Start (normal btn) | success + definitive fail + form toggle clear | `retriable:true`, `.catch()` |
| `pendingContinueOp` | Start (Continue btn) | success + definitive fail | `retriable:true`, `.catch()` |
| `pendingCompleteOp` | Complete (normal btn) | success + definitive fail + cancel | `retriable:true`, `.catch()` |
| `pendingFinishedOp` | Complete (WIP "finished") | success + definitive fail + cancel | `retriable:true`, `.catch()` |
| `pendingCountOp` | Count | success (immediately after saveCount) + definitive fail + cancel | `.catch()` on saveCount |

---

## Active Service Files

### OEE (active)
- `prep-start-rpc-service.js` — `startPrepTaskRpc()`
- `prep-complete-rpc-service.js` — `completePrepTaskRpc()`
- `prep-count-rpc-service.js` — `savePrepCountRpc()`
- `prep-count-reconciler-service.js` — `reconcilePrepCount()` (unchanged)

### Legacy (retained, not active in main flow)
- `prep-start-service.js` — replaced by RPC service; kept for reference
- `prep-complete-service.js` — replaced by RPC service; kept for reference
- `prep-count-write-service.js` — replaced by RPC service; kept for reference

---

## Retained Test Event IDs (in DB, do not delete)

| Event ID | Type | Task | Purpose |
|---|---|---|---|
| `4803b734-672c-4f94-a9b7-1d496377aeb1` | PREP_STARTED | 234 | B.2B normal start + replay tests |
| `f771bcd8-4f11-4bb8-953e-c9b7063919e3` | PREP_STARTED | 235 | B.2B Continue + cross-task conflict |
| `5fe8ce4e-ab52-409f-9dba-779bfc587a51` | PREP_STARTED | 234 | B.2B null-occurredAt DB behavior |
| `31862a4b-883f-4ec7-ae7e-cd48f758be5a` | PREP_COMPLETED | 234 | C-B normal complete + replay + conflict source |
| `a736afba-c164-4c20-98b5-6b3246e03f1e` | PREP_COMPLETED | 234 | C-B unit conversion test (2kg) |
| `ad176f9b-2d4d-4aa0-bbce-288aa2e0151e` | STOCK_COUNT_RECORDED | 244 | D-B.1 normal count + replay + conflict source |
| `e4f55687-fb2d-4021-a9e1-18d583082220` | STOCK_COUNT_RECORDED | 244 | D-B.1 zero count valid |

---

## Known Limitations (Phase 2 scope)

- No OEE history UI — events are stored but not surfaced to staff or chef
- No failed-event persistence — rolled-back transactions leave no event trace
- No reconciliation retry UI — if reconciler fails, the cook cannot retry from UI
- No Communication Bus — OEE events do not yet trigger downstream notifications
- No notification delivery from OEE events
- No AI reasoning over OEE events (Chef AI does not read operational_events yet)
- Live roles in DB are only `admin` and `staff` — no supervisor/coordinator
- No "Yes Chef" proposal mechanism in OEE
- Diagnostic metadata (`diag_flag`) computed but not surfaced in any UI

---

## Session Startup Protocol

1. Read token from `/mnt/project/x_claude_GIthub.txt`
2. Check live `boh-v???` from `sw.js`
3. Read last 5 commits
4. Read ALL `boh-v2/docs/*.md` files
5. Read `boh-v2/src/modes/station/station-prep.js` (large file — 1919 lines as of closeout)
6. Read `boh-v2/src/services/prep-start-rpc-service.js` (canonical pattern for all three RPC services)

---

## Recommended Next Development Area

**Dish Crew Home (Phase 2 — station visibility)**

The dishwashers (`user.default_station === 'Dish Crew'`) need a simplified Home screen:
topbar + alerts + Dish Crew station task list + birthdays + bottom bar.
Phase 1 (station visibility filtering) is already complete in v332.
Phase 2 requires the simplified layout component with no Focus Mode, no Recipes,
no Closing, no Sales, no Operation Notes prompt.
This is a concrete, kitchen-facing improvement that can be delivered in one session
and directly improves daily usability for the dish crew.

Do not begin OEE Phase 2 (Communication Bus, notifications, AI reasoning) before
a product decision from Max.
