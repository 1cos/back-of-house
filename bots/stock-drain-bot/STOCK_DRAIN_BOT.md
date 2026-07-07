# Stock Drain Bot — Manuale di Stazione

## Identità
- **Nome:** Stock Drain Bot
- **bot_name:** stock-drain-bot
- **Versione:** v1
- **Edge Function:** bot-stock-drain
- **Brigata:** Sprint 3

## Responsabilità (una sola)
Espande il BOM di ogni POS item venduto e scrive movimenti di scarico auditabili in `stock_movements`.

## Dipende da
- POS TouchBistro Bot (deve aver già scritto `pos_daily_raw`)
- Recipe Matcher Bot (deve aver già scritto `pos_daily_clean`)

## NON fa mai
- Aggiornare `current_stock` su `prep_tasks` o `ingredients`
- Modificare `prep_tasks`, `recipes`, `recipe_bom`
- Scrivere `stock_daily_snapshot` (solo Stock Consolidator Bot, futuro)

## Righe sicure (whitelist)
Legge solo da `pos_daily_clean` dove:
- `needs_review = false`
- `recipe_id IS NOT NULL`
- `match_type IN ('exact', 'kids_alias', 'modifier_alias')`

## Esclusi silenziosamente
- `Gift Card`, `Open Food`
- `fuzzy`, `unknown`, `needs_review = true`
- Gluten Free Bread (finché non ha recipe_id/BOM corretto)

## Output — `stock_movements`
Ogni riga BOM genera un movimento:
- `movement_type = 'POS_DRAIN'`
- `source_bot = 'stock-drain-bot'`
- `quantity` negativo (scarico)
- `source_pos_item_name` — nome originale POS
- `source_menu_group` — es. "Kids menu", "Pasta"
- `source_match_type` — exact/kids_alias/modifier_alias
- `recipe_id` + `recipe_name` — ricetta matchata
- `bom_item_type` — ITEM o RECIPE
- `bom_item_name` — ingrediente o prep scaricata
- `sold_quantity` — porzioni vendute
- `bom_quantity_per_recipe` — quantità BOM per porzione

## Idempotenza
Cancella SOLO `movement_type='POS_DRAIN'` + `source_bot='stock-drain-bot'` + `business_date` prima di rigenerare.
Non tocca mai: movimenti manuali, invoice, adjustment, waste, prep_production, transfer.

## Trigger
- Manuale: POST `{"business_date": "YYYY-MM-DD"}`
- Futuro cron: dopo Recipe Matcher Bot (05:00 CDT)
