# BOM Chain Deduction Bot — Station 4 del TouchBistro POS Bot

## Identità

| Campo | Valore |
|---|---|
| **bot_name** | `bot-bom-chain-deduction` |
| **Edge Function** | `bot-bom-chain-deduction` |
| **Commis** | `bom-chain-commis` |
| **Stazione** | Station 4 — TouchBistro POS Bot |
| **Input** | `pos_daily_clean` (action='map', recipe_id IS NOT NULL) |
| **Output** | `stock_deductions` (source='bom_chain') + `commis_observations` |

## Cosa fa

Traversa ricorsivamente il BOM di ogni piatto venduto e scarica:
- **ITEM raw** (ingredienti senza prep_task) → `item_type='ingredient'`
- **Prep non ancora dedotte da direct_recipe** → `item_type='prep'`

## Regola STOP — fondamentale

**Prep stockata = terminale.** Se una sub-recipe ha un `prep_task` attivo collegato, il bot si ferma lì e non scende dentro il suo BOM interno.

```
SICILIANA sold
├── Siciliana cartoccio (ha prep_task) → STOP ← scarica 2pz, non scende
├── Garlic Oil (ha prep_task) → STOP
└── Spinach (ha prep_task) → STOP
```

I figli interni di `Siciliana cartoccio` (Filet Branzino, SICILIAN MIX, EVOO, White Wine) vengono scaricati solo quando si **produce** il cartoccio, non quando si **vende** la Siciliana.

## Anti-double deduction

Legge `stock_deductions` con `source='direct_recipe'` già presenti prima di iniziare. Salta qualsiasi prep già dedotta da Sprint 3.

## Aggregazione ingredienti (v2)

Lo stesso ingrediente può apparire in più percorsi della catena BOM (es. Salt nella ricetta madre E in una sub-recipe). Il bot li aggrega per `(pos_item_name, ingredient_id, unit)` — una sola riga, quantità sommata. Se le unità sono diverse (es. `pz` e `g`), rimangono separate.

## Idempotenza

```sql
DELETE FROM stock_deductions
WHERE business_date = target_date AND source = 'bom_chain';
```

Non tocca mai `direct_recipe`.

## MAX_DEPTH = 5

Protezione contro catene circolari. Se la traversal supera 5 livelli, genera un warning e si ferma.

## Cosa NON fa

- ❌ Non tocca `current_stock`
- ❌ Non scrive `stock_movements`
- ❌ Non aggiorna `stock_daily_snapshot`
- ❌ Zero LLM

## Ordine di esecuzione pipeline

1. `bot-pos-importer` → pos_daily_raw
2. `bot-pos-cleaner` → pos_daily_clean
3. `bot-direct-deduction` → stock_deductions (direct_recipe)
4. **`bot-bom-chain-deduction`** → stock_deductions (bom_chain)
5. (futuro) `bot-stock-consolidator` → current_stock

## Versioni

| Versione | Data | Note |
|---|---|---|
| v1 | 2026-07-07 | Prima release |
| v2 | 2026-07-07 | Aggregazione ingredienti per evitare duplicati da percorsi multipli |
