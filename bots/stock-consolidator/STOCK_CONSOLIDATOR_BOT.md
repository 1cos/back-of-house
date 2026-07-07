# Stock Consolidator Bot — Station 5 della Pipeline

## Identità

| Campo | Valore |
|---|---|
| **bot_name** | `bot-stock-consolidator` |
| **Edge Function** | `bot-stock-consolidator` |
| **Commis** | `stock-consolidator-commis` |
| **Stazione** | Station 5 — Stock Consolidator |
| **Input** | `stock_deductions` (direct_recipe + bom_chain) |
| **Output** | `stock_daily_snapshot` + `commis_observations` |
| **Trigger** | Manuale o dopo run di `bot-bom-chain-deduction` |

## ⚠️ VERSIONE v1 — SNAPSHOT ONLY

**v1 è read-only rispetto allo stock reale.**

v1 fa **solo** queste cose:
- Legge `stock_deductions` per una business_date
- Aggrega le deductions per prep/ingredient
- Scrive `stock_daily_snapshot` con status='partial'

v1 **NON** fa mai:
- ❌ `UPDATE prep_tasks SET current_stock = ...`
- ❌ `INSERT INTO stock_movements ...`
- ❌ Costruire La Dispensa UI
- ❌ Modificare qualsiasi altra tabella

**La regola è semplice:** se non è `stock_daily_snapshot` o `commis_observations`, v1 non ci scrive.

---

## Logica aggregazione

Per ogni riga `stock_deductions` con la business_date target:

**Chiave aggregazione:**
```
(business_date, item_type, prep_task_id, ingredient_id, unit)
```

**Campi aggregati:**
- `pos_deducted_qty` = SUM(quantity)
- `sources` = array di source distinti (direct_recipe, bom_chain)
- `deduction_rows` = COUNT(*)
- `target_name` = dal primo match (non ambiguo)

---

## Output — stock_daily_snapshot

Per ogni gruppo aggregato:

| Campo | Valore v1 |
|---|---|
| `business_date` | data target |
| `item_type` | 'prep' o 'ingredient' |
| `item_id` | target_recipe_id (prep) oppure ingredient_id |
| `stock_start` | NULL (non noto in v1) |
| `loaded_qty` | 0 (prep_log non ancora letto in v1) |
| `pos_deducted_qty` | SUM(quantity) da stock_deductions |
| `waste_qty` | 0 |
| `adjustment_qty` | 0 |
| `stock_end` | NULL (non calcolabile in v1) |
| `unit` | unità della deduction |
| `status` | 'partial' |
| `warning` | testo se anomalia rilevata |
| `metadata` | JSON con dettaglio (vedi sotto) |

**metadata JSON:**
```json
{
  "sources": ["direct_recipe", "bom_chain"],
  "deduction_rows": 12,
  "prep_task_id": 123,
  "target_name": "Arrabbiata",
  "consolidator_version": "v1_snapshot_only"
}
```

---

## Idempotenza

```sql
DELETE FROM stock_daily_snapshot
WHERE business_date = target_date;
```

Poi riscrive tutto. Non cancella mai `stock_deductions`.

---

## Safety rules — cosa il bot salta o marca warning

Il bot NON blocca l'intero run su un singolo problema. Gestione per riga:

| Anomalia | Azione |
|---|---|
| Stesso target, unità diverse | status='warning', warning='unit mismatch: pz e g' |
| item_type='prep' senza prep_task_id | status='warning', warning='prep_task_id mancante' |
| item_type='ingredient' senza ingredient_id | status='warning', warning='ingredient_id mancante' |
| quantity null o zero | skip + commis_observation |
| target_name mancante | status='warning', warning='target_name non trovato' |
| Duplicate righe in stock_deductions (stessa chiave) | marca warning, non somma doppio |
| Deduction insolitamente alta (>10× media storica) | status='warning', warning='qty insolitamente alta' |

---

## Cosa NON fa mai (regola costituzionale)

```
v1 is snapshot-only.
Do NOT update current_stock.
Do NOT write stock_movements.
Do NOT build La Dispensa UI.
```

---

## Ordine di esecuzione pipeline

1. `bot-pos-importer` → pos_daily_raw ✅
2. `bot-pos-cleaner` → pos_daily_clean ✅
3. `bot-direct-deduction` → stock_deductions (direct_recipe) ✅
4. `bot-bom-chain-deduction` → stock_deductions (bom_chain) ✅
5. **`bot-stock-consolidator`** → stock_daily_snapshot ✅
6. (futuro) `bot-prep-suggester` → suggested_qty, suggested_note
7. (futuro) La Dispensa UI

---

## Versioni

| Versione | Data | Note |
|---|---|---|
| v1 | 2026-07-07 | Prima release — snapshot-only, zero current_stock update |
