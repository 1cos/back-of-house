# pos_daily_raw — Archive Note
**Table:** `pos_daily_raw`
**Archive date:** 2026-07-20
**Archive path:** `docs/archive/clean-trust/pos_daily_raw_2026-07-20.csv`

## Purpose
Intermediate staging table for the legacy `bot-pos-importer` pipeline (EF v6).
Intended to store POS items after normalization, before the downstream bots
(bot-pos-cleaner, bot-direct-deduction) read from it.
The table has 11 columns: id, business_date, pos_item_name, canonical_name,
portions_sold, gross_sales, net_sales, source_table, menu_group, imported_at, metadata.

## Writer
`bot-pos-importer` EF v6 — last run 2026-07-07.
This bot was superseded by the current nightly pipeline which uses
`pos_daily_clean` (written by `bot-pos-cleaner`) as its staging table.

## Contents at archival
- **Row count:** 146
- **Business dates:** 2026-07-06 only (single date)
- **Source tables:** pos_modifiers (96 rows), pos_sales_by_item (50 rows)
- **Imported:** 2026-07-07 14:51 UTC

## Reason for cleanup
- No active writer since 2026-07-07 (bot-pos-importer is LEGACY_UNUSED)
- No active reader in the production pipeline
- Admin debug panel in office.js reads it but the panel references a deprecated bot
- Table not needed for any current or planned pipeline step

## Table structure retained
`DROP TABLE pos_daily_raw` NOT executed.
The admin debug panel (`office.js` line 1932, 1976) still queries this table.
Structure preserved to avoid JS errors until the Bot Debug panel is refactored.

## Restore instructions
```sql
-- To restore data if needed:
-- 1. Download the CSV from docs/archive/clean-trust/pos_daily_raw_2026-07-20.csv
-- 2. Use Supabase Table Editor import or:
COPY pos_daily_raw (id, business_date, pos_item_name, canonical_name,
  portions_sold, gross_sales, net_sales, source_table, menu_group, imported_at, metadata)
FROM '/path/to/pos_daily_raw_2026-07-20.csv'
CSV HEADER;
```

## Related cleanup
Part of Clean & Trust Phase 2 (2026-07-20).
See also: `CLEAN_TRUST_PHASE2_NOTE_2026-07-20.md`
