# Direct Deduction Bot — Test & Verifica

## Prerequisiti

1. `pos_daily_raw` popolato (`bot-pos-importer`)
2. `pos_daily_clean` popolato (`bot-pos-cleaner`)

## Trigger manuale

Edge Functions → `bot-direct-deduction` → Invoke:

```json
{ "business_date": "2026-07-06" }
```

## Query di verifica

### 1. bot_runs
```sql
SELECT bot_name, run_date, status, rows_read, rows_written, warnings_count, errors_count, summary
FROM bot_runs
WHERE bot_name = 'bot-direct-deduction'
ORDER BY started_at DESC LIMIT 5;
```

### 2. Distribuzione stock_deductions
```sql
SELECT source, item_type, COUNT(*) AS rows, ROUND(SUM(quantity)) AS total_qty
FROM stock_deductions
WHERE business_date = '2026-07-06'
GROUP BY source, item_type;
```

### 3. Dettaglio scarichi
```sql
SELECT pos_item_name,
       metadata->>'prep_task_name' AS prep,
       ROUND(quantity) AS qty, unit, portions_sold AS porz,
       calculation_path
FROM stock_deductions
WHERE business_date = '2026-07-06'
ORDER BY pos_item_name, qty DESC;
```

### 4. Observations
```sql
SELECT severity, category, COUNT(*)
FROM commis_observations
WHERE business_date = '2026-07-06'
  AND bot_name = 'bot-direct-deduction'
  AND commis_name = 'direct-deduction-commis'
GROUP BY severity, category;
```

### 5. Stock non toccato
```sql
SELECT 'stock_movements' AS t, COUNT(*) FROM stock_movements
UNION ALL
SELECT 'stock_daily_snapshot', COUNT(*) FROM stock_daily_snapshot;
```

## Risultati attesi su 2026-07-06

- **99 deductions** scritte (source=direct_recipe, item_type=prep)
- **13 info** (ricette con solo ITEM raw → Bot 4)
- **3 warning** (sub-recipe senza prep_task o qty 0)
- stock_movements: 335 (pre-esistenti, non toccate)
- stock_daily_snapshot: 0

## Anomalie note da verificare

| Item | Problema | Nota |
|---|---|---|
| `Meatball Appetizer → Parmesan Grated` | 340g/porzione | BOM reale? O è per batch? |
| `Add chicken → Grilled Chicken` | 2550g/porzione | Intentionale — è il peso di un batch di pollo grigliato collegato come sub-recipe |
| `Lobster Fettucine → Fettucine` | 1g/porzione | BOM qty = 1 (each) ma unit = g — verificare coerenza unità |
