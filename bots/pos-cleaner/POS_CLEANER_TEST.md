# POS Cleaner Bot — Test & Verifica

## Trigger manuale (Supabase Dashboard)

Edge Functions → `bot-pos-cleaner` → Invoke con body:

```json
{ "business_date": "2026-07-06" }
```

## Query di verifica post-run

### 1. Distribuzione per item_class

```sql
SELECT item_class, action, COUNT(*), SUM(portions_sold)
FROM pos_daily_clean
WHERE business_date = '2026-07-06'
GROUP BY item_class, action
ORDER BY COUNT(*) DESC;
```

Atteso: MENU_ITEM la maggioranza, SYSTEM_IGNORE cattura Glass/Goodnight/timestamps, BAR_IGNORE cattura liquori.

### 2. Solo righe che vanno verso stock (action = 'map' + recipe_id)

```sql
SELECT pos_item_name, item_class, match_type, matched_recipe_name, portions_sold
FROM pos_daily_clean
WHERE business_date = '2026-07-06'
  AND action = 'map'
  AND recipe_id IS NOT NULL
ORDER BY portions_sold DESC;
```

### 3. Review queue reale (solo item che contano)

```sql
SELECT pos_item_name, item_class, portions_sold, warning
FROM pos_daily_clean
WHERE business_date = '2026-07-06'
  AND needs_review = true
ORDER BY portions_sold DESC;
```

Questa deve essere corta — solo MENU_ITEM senza ricetta e OPEN_ITEM_MANUAL.

### 4. Osservazioni del Commis

```sql
SELECT severity, category, title, metadata->>'portions_sold' AS porzioni
FROM commis_observations
WHERE business_date = '2026-07-06'
  AND bot_name = 'pos-cleaner'
ORDER BY severity DESC, (metadata->>'portions_sold')::numeric DESC;
```

### 5. Conferma che stock è intatto

```sql
-- Deve tornare 0 righe per la data di oggi
SELECT COUNT(*) FROM stock_movements WHERE business_date = '2026-07-06';
SELECT COUNT(*) FROM stock_daily_snapshot WHERE snapshot_date = '2026-07-06';
```

### 6. Stato bot_runs

```sql
SELECT bot_name, status, rows_read, rows_written, warnings_count, summary, duration_ms
FROM bot_runs
WHERE bot_name = 'pos-cleaner'
ORDER BY started_at DESC
LIMIT 5;
```

## Cosa controllare se qualcosa non va

| Sintomo | Causa probabile | Fix |
|---|---|---|
| Item classificato wrong | Regola errata o priorità sbagliata | `UPDATE pos_item_class_rules SET item_class='...' WHERE pattern='...'` |
| Nuovo modifier non classificato | Manca regola | `INSERT INTO pos_item_class_rules ...` |
| MENU_ITEM senza ricetta | pos_name mancante sulla ricetta | Aggiungere pos_name in recipe editor |
| 0 righe in pos_daily_clean | pos_daily_raw vuoto per quella data | Runnare prima `bot-pos-importer` |
| Duplicati | Run multipli senza idempotenza | Non possibile — DELETE garantisce idempotenza |
