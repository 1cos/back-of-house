# Direct Deduction Bot — Station 3 del TouchBistro POS Bot

## Identità

| Campo | Valore |
|---|---|
| **bot_name** | `bot-direct-deduction` |
| **Edge Function** | `bot-direct-deduction` |
| **Commis** | `direct-deduction-commis` |
| **Stazione** | Station 3 — TouchBistro POS Bot |
| **Input** | `pos_daily_clean` (action='map', recipe_id IS NOT NULL) |
| **Output** | `stock_deductions` + `commis_observations` |
| **Trigger** | Manuale o dopo run di `bot-pos-cleaner` |

## Cosa fa

Legge le righe pulite e mappate di `pos_daily_clean` e calcola scarichi diretti per ogni prep intermedia collegata via BOM:

1. Per ogni MENU_ITEM o KITCHEN_OPERATIONAL mappato a una ricetta
2. Guarda il BOM della ricetta — solo righe `component_type='RECIPE'`
3. Per ogni sub-ricetta nel BOM → cerca il `prep_task` collegato
4. Calcola `quantity = bom_qty × portions_sold`
5. Scrive in `stock_deductions` con `source='direct_recipe'`

## Cosa NON fa

- ❌ Non tocca `current_stock`
- ❌ Non scrive `stock_movements`
- ❌ Non aggiorna `stock_daily_snapshot`
- ❌ Non segue catene BOM complesse (Bot 4 BOM Chain)
- ❌ Non scarica ingredienti raw ITEM (solo prep RECIPE)
- ❌ Zero LLM

## item_id in stock_deductions

`stock_deductions.item_id` è uuid NOT NULL. `prep_tasks.id` è bigint — non compatibile.

**Scelta Sprint 3:** `item_id = sub_recipe_id` (uuid di `recipes`) — il riferimento alla prep recipe.
Il `prep_task_id` (bigint) va in `metadata.prep_task_id` per reference.

Questo sarà rivisto in Sprint 5 (Stock Consolidator) se necessario.

## Regola fondamentale

**Scarica solo quello che è diretto, chiaro e spiegabile.**

Se manca uno di questi elementi, non scrive deduction ma observation:
- recipe_bom con `component_type='RECIPE'`
- `sub_recipe_id` valido
- `prep_task` attivo collegato alla sub-ricetta
- `quantity > 0` nel BOM

## Idempotenza

```sql
DELETE FROM stock_deductions
WHERE business_date = target_date AND source = 'direct_recipe';

DELETE FROM commis_observations
WHERE business_date = target_date
  AND bot_name = 'bot-direct-deduction'
  AND commis_name = 'direct-deduction-commis';
```

## Versioni

| Versione | Data | Note |
|---|---|---|
| v1 | 2026-07-07 | Prima release — scarichi diretti da BOM RECIPE, Commis deterministico |
