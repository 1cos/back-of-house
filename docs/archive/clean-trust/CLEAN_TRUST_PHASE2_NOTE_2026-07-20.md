# Clean & Trust Phase 2 — Cleanup Note
**Date:** 2026-07-20
**Version:** boh-v737
**Commit at start:** d252e9e885c6807cf093eb4f68d7acee127107ce

## Edge Functions tombstoned (4)

Tombstone = deployed stub returning HTTP 410 Gone. Function slot preserved, original behavior eliminated.

### generate-briefing (v36 tombstone)
- **Previous purpose:** AI briefing generator using Groq only, single-column writer
- **Replacement:** `sc-nightly-brief` (cron `generate-briefing-daily` already pointed here)
- **Dependency proof:** 0 frontend refs, 0 cron references to this slug, 0 DB triggers, 0 EF callers
- **Tombstone message:** `"Use sc-nightly-brief."`

### rapid-worker (v37 tombstone)
- **Previous purpose:** WebPush notification sender (legacy version of notifications EF)
- **Replacement:** `notifications` (DB triggers `push-chat-public` and `push-news` both point to `notifications`)
- **Dependency proof:** 0 frontend refs, 0 cron, 0 triggers pointing to rapid-worker
- **Tombstone message:** `"Push handled by notifications EF."`

### translate (v41 tombstone)
- **Previous purpose:** Translation via Groq llama-3.1-8b-instant only
- **Replacement:** `ai-translate` (Google Translate primary + Groq fallback, v47)
- **Dependency proof:** 0 frontend refs, 0 cron, 0 triggers
- **Tombstone message:** `"Use ai-translate."`

### pos-import (v27 tombstone)
- **Previous purpose:** Generic bulk insert/truncate proxy for any table
- **Caller check:** No reference in any JS file, no cron, no trigger, no Apps Script doc.
  Only documentation references in .md files (describing bot-pos-importer output, not this EF).
- **Tombstone message:** `"Functionality absorbed into gmail-touchbistro-import."`

## Rollback: edge functions
```bash
# To restore original behavior, redeploy from git history or Supabase dashboard
# The tombstones return HTTP 410 — existing caller code will fail loudly if a caller existed
# but was missed. This is intentional: tombstone > silent old behavior.
```

## pos_daily_raw — rows deleted

- **Row count deleted:** 146
- **Business dates:** 2026-07-06 only
- **Source breakdown:** 96 pos_modifiers + 50 pos_sales_by_item
- **Writer:** `bot-pos-importer` EF v6 (legacy, last run 2026-07-07)
- **Table structure:** RETAINED (not dropped — admin debug panel in office.js references it)

**Reason:** No active writer since 2026-07-07. No production pipeline reads this table.
The current nightly pipeline uses `pos_daily_clean`, not `pos_daily_raw`.

### Restore pos_daily_raw data
```sql
-- Full dataset in: docs/archive/clean-trust/pos_daily_raw_2026-07-20.csv
-- Restore with Supabase Table Editor import, or:
-- NOTE: table structure is intact, just rows were deleted
```

## Active production verified post-cleanup

| System | Status |
|---|---|
| Nightly pipeline (07-19 run) | ✅ 7 steps, success |
| sc-nightly-brief | ✅ deployed v32 |
| notifications | ✅ deployed v42 |
| ai-translate | ✅ deployed v47 |
| DB trigger push-chat-public → notifications | ✅ unchanged |
| DB trigger push-news → notifications | ✅ unchanged |
| cron generate-briefing-daily → sc-nightly-brief | ✅ confirmed |
| prep_suggestions_daily | ✅ 94 rows for 2026-07-20 |
| bot-pipeline-worker | ✅ active, not touched |
| bot_pipeline_jobs / bot_pipeline_step_runs | ✅ active, not touched |

## Objects intentionally untouched

- `bot-pos-importer` EF — per task scope
- Legacy Bot Debug UI (`office.js`) — per task scope
- `pos_daily_raw` table structure — retained
- All pipeline RPCs
- All BOH v2 objects
- All OEE tables and RPCs
