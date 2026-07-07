# Stock Drain Test — Checklist di Verifica

## Come triggare
```bash
curl -X POST \
  "https://ydqmumpytgrlceuinoqt.supabase.co/functions/v1/bot-stock-drain" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ANON_KEY>" \
  -d '{"business_date": "2026-07-06"}'
```

## Prerequisiti
Il bot richiede che per la stessa business_date siano già stati eseguiti:
1. POS TouchBistro Bot → `pos_daily_raw` popolata
2. Recipe Matcher Bot → `pos_daily_clean` popolata con `needs_review=false`

## Verifica movimenti scritti
```sql
-- Totale movimenti per data
SELECT COUNT(*), movement_type, source_bot
FROM stock_movements
WHERE business_date = '2026-07-06' AND movement_type = 'POS_DRAIN'
GROUP BY movement_type, source_bot;

-- Drill-down: POS item → ricetta → BOM
SELECT source_pos_item_name, source_menu_group, source_match_type,
       recipe_name, bom_item_type, bom_item_name,
       sold_quantity, bom_quantity_per_recipe, quantity as drain, unit
FROM stock_movements
WHERE business_date = '2026-07-06' AND movement_type = 'POS_DRAIN'
ORDER BY recipe_name, bom_item_name;

-- Totale scarico per prep/ingrediente
SELECT bom_item_name, item_type, SUM(quantity) as total_drain, unit
FROM stock_movements
WHERE business_date = '2026-07-06' AND movement_type = 'POS_DRAIN'
GROUP BY bom_item_name, item_type, unit
ORDER BY total_drain;
```

## Idempotenza
```sql
-- Rilancia il bot, poi controlla che il numero resti invariato
SELECT COUNT(*) FROM stock_movements
WHERE business_date = '2026-07-06' AND movement_type = 'POS_DRAIN';
```

## Checks attesi su 2026-07-06
- [ ] ~335 movimenti POS_DRAIN scritti
- [ ] Spaghetti Al Ragu Half (kids_alias): MK-RAGU -200g, POMODORO SAUCE -50g, SPAGHETTI FRESH PASTA -2each
- [ ] Penne Midnight Half (kids_alias): ARRABBIATA -100g, Penne -60g
- [ ] Pear & Pecorino Salad (exact): Spring Mix -300g, Pears -180g, Pecorino Fresh Wedge -480g
- [ ] Cacio e Pepe Half (exact): CACIO E PEPE SAUCE -150g, Grated Pecorino -30g
- [ ] La N.4 Half (exact): SPAGHETTI FRESH PASTA -2.5each, Pancetta -150g

## Tabelle NON toccate
```sql
SELECT 
  (SELECT COUNT(*) FROM prep_tasks) as prep_tasks_unchanged,
  (SELECT COUNT(*) FROM stock_daily_snapshot) as snapshot_still_empty;
-- prep_tasks.current_stock NON modificato — solo stock_movements
```

## Drain totali verificati 2026-07-06
| Prep/Ingrediente | Drain totale | Unità | Da N ricette |
|---|---|---|---|
| ARRABBIATA | -3225 | g | 5 |
| MK-RAGU | -1700 | g | 3 |
| POMODORO SAUCE | -1700 | g | 5 |
| Spring Mix | -1100 | g | 3 |
| SPAGHETTI FRESH PASTA | -27 | each | 7 |
| Pears | -180 | g | 1 |
