# BOH OS v2 — Next Session Prompt

## Status at end of this session

**OEE Sessions A + B + B.1 complete. DB live. All tests pass.**

Session A applied fresh migrations to the DB:
- `20260716_001_oee_phase1_schema.sql` — `operational_events`, `operational_event_transitions`, FK columns on `prep_log` and `prep_stock_counts`
- `20260716_002_oee_phase1_rpcs.sql` — All three RPCs (see below)

All three RPCs deployed, tested, production-grade:
- `rpc_oee_record_prep_start(p_token, p_task_id, p_client_operation_id, p_occurred_at, p_producer_id)`
- `rpc_oee_record_prep_completion(p_token, p_task_id, p_quantity, p_unit, p_client_operation_id, p_occurred_at, p_in_progress_at, p_is_suggested_qty, p_producer_id)`
- `rpc_oee_record_stock_count(p_token, p_task_id, p_counted_quantity, p_unit, p_client_operation_id, p_occurred_at, p_producer_id)`

Frontend:
- `station-navigation.js` → `startTask: startPrepTaskRpc` ✅
- `prep-start-rpc-service.js` → caller-owned `clientOperationId`/`occurredAt`, `retriable` flag ✅
- `station-prep.js` → `buildStartButton` owns `pendingOp` context ✅

DB state: `operational_events` = 0 rows, `operational_event_transitions` = 0 rows. Tasks 234, 244 restored.

---

## ⚠️ Known Bug: WIP panel "Continue" button

In `station-prep.js`, `buildWipResolutionPanel`, the **"Continue this prep"** `continueBtn` calls:
```js
startTask({ prepTaskId: task.id, startedBy: userName })
```
It does **NOT** pass `clientOperationId` or `occurredAt`. This means the B.1 idempotency contract is violated for Continue.

Fix needed: generate a `pendingContinueOp` closure variable (same pattern as `buildStartButton`) and pass it in the call. Confirm with Max before fixing — Session C priority.

---

## Session C: Route PREP_COMPLETED through OEE RPC

### Goal
Wire `rpc_oee_record_prep_completion` into the frontend everywhere `completePrepTask` is called.

### Current state
`completePrepTask` (legacy `prep-complete-service.js`) is called from:
1. `buildCompleteButton` in `station-prep.js` — main Complete button
2. `buildWipResolutionPanel` finishedBtn in `station-prep.js` — "I finished it" in WIP panel

Both use the old direct Supabase flow (no OEE, no session token, no idempotency).

### New service: `prep-complete-rpc-service.js`

Mirrors `prep-start-rpc-service.js` pattern:
- Input: `{ prepTask, quantity, unit, clientOperationId, occurredAt }`
- Returns: `{ ok: true, log, task, retriable: false }` or `{ ok: false, reason, retriable }`
- Caller owns `clientOperationId` (UUID) + `occurredAt` (ISO timestamp)
- Gets token from `getStoredToken()`
- Calls `rpc_oee_record_prep_completion`
- Normalises response to same shape as `completePrepTask` for drop-in compat

### Changes to `station-prep.js` (`buildCompleteButton`)

Add `pendingCompleteOp = null` closure variable.
On `onConfirm` call: create `pendingCompleteOp` if null, or reuse on retry.
Clear on success or definitive failure. Retain on retriable failure.

### Changes to `station-navigation.js`

Add import for `completeTask: completeTaskRpc` from new service.

### WIP "I finished it" button

Same pattern — add `pendingFinishedOp = null` closure.

### Tests required (SQL-level)

1. Invalid token → AUTH_ERROR
2. Zero/negative qty → INVALID_INPUT
3. Non-existent task → TASK_NOT_FOUND
4. Valid completion → ok:true, log row inserted, prep_tasks updated, PREP_STOCK_UPDATED derived fact created
5. Idempotent replay → ok:true, idempotent:true, no duplicate prep_log row, stock unchanged
6. Server reads stock from DB (not client value)
7. suggested_qty + suggested_note cleared; suggested_by + suggested_at preserved
8. Duration calculation correct (10 min elapsed = duration_minutes:10)
9. is_suggested_qty flag carried through

---

## Session D: Route STOCK_COUNT_RECORDED through OEE RPC

### Goal
Wire `rpc_oee_record_stock_count` into the frontend.

### Current state
`savePrepCount` (legacy `prep-count-write-service.js`) is called from `buildCountButton`.

### New service: `prep-count-rpc-service.js`

Same pattern. Input: `{ prepTaskId, countedQuantity, unit, clientOperationId, occurredAt }`.
Returns compatible shape to `savePrepCount`.

### Changes to `buildCountButton` in `station-prep.js`

Add `pendingCountOp` closure. Same pattern as Complete.

---

## Session E: Fix WIP "Continue" + route through OEE

Wire the `continueBtn` in `buildWipResolutionPanel` to also use `pendingContinueOp` + `startPrepTaskRpc`.

---

## Key file paths

```
boh-v2/
  migrations/
    20260716_001_oee_phase1_schema.sql  ← deployed ✅
    20260716_002_oee_phase1_rpcs.sql    ← deployed ✅
  src/
    services/
      prep-start-rpc-service.js    ← live ✅ (B.1)
      prep-complete-service.js     ← legacy, still in use
      prep-count-write-service.js  ← legacy, still in use
      prep-count-reconciler-service.js ← legacy, still in use
    modes/station/
      station-navigation.js        ← live ✅ (startTask → rpc)
      station-prep.js              ← live ✅ (buildStartButton with pendingOp)
```

## RPC return shape (for service normalization)

### rpc_oee_record_prep_start success
```json
{ "ok": true, "idempotent": false, "event_id": "uuid",
  "task": { "id": 234, "in_progress": true, "in_progress_at": "...", "in_progress_by": "Max" } }
```

### rpc_oee_record_prep_completion success
```json
{ "ok": true, "idempotent": false, "event_id": "uuid",
  "log": { "item": "...", "station": "...", "qty": 500, "unit": "g",
           "user_name": "Max", "started_at": "...", "duration_minutes": 10,
           "is_suggested_qty": false, "created_at": "..." },
  "task": { "id": 234, "current_stock": 500, "need_tomorrow": false,
            "in_progress": false, "in_progress_at": null, "in_progress_by": null } }
```

### rpc_oee_record_stock_count success
```json
{ "ok": true, "idempotent": false, "event_id": "uuid",
  "count": { "id": 17, "prep_task_id": 244, "counted_qty": 15, "unit": "pz",
             "counted_by": "Max", "source": "kitchen_count", "counted_at": "...",
             "prev_bot_stock": 18, "prev_bot_suggestion": null, "prev_suggested_by": "..." },
  "task": { "id": 244, "current_stock": 15 } }
```

## Session startup protocol

1. Read token from `/mnt/project/x_claude_GIthub.txt`
2. Check live `boh-v???` from `sw.js`
3. Read last 5 commits
4. Read ALL `boh-v2/docs/*.md` files
5. Read `boh-v2/src/modes/station/station-prep.js` (large file — critical)
6. Read `boh-v2/src/services/prep-start-rpc-service.js` (reference pattern)
