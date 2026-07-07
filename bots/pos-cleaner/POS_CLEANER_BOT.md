# POS Cleaner Bot — Station 2 del TouchBistro POS Bot

## Identità

| Campo | Valore |
|---|---|
| **bot_name** | `pos-cleaner` |
| **Edge Function** | `bot-pos-cleaner` |
| **Commis** | `mapping-commis` |
| **Stazione** | Station 2 — TouchBistro POS Bot |
| **Input** | `pos_daily_raw` |
| **Output** | `pos_daily_clean` + `commis_observations` |
| **Trigger** | Manuale o dopo run di `bot-pos-importer` |

## Cosa fa

Legge `pos_daily_raw` (dati grezzi da TouchBistro) e produce `pos_daily_clean`:

1. **Classifica** ogni riga POS tramite `pos_item_class_rules` (tabella configurabile)
2. **Mappa** food item e modifier operativi alle ricette Brigade
3. **Filtra il rumore**: timestamp, drink, istruzioni server → classificati e fermati
4. **Commis deterministico**: scrive osservazioni su item non mappati

## Classi item (item_class)

| Classe | Descrizione | action | Verso stock? |
|---|---|---|---|
| `MENU_ITEM` | Piatto vero da menu | map | ✅ (Sprint 3+) |
| `KITCHEN_OPERATIONAL` | Modifier food con impatto cucina | map | ✅ (Sprint 3+) |
| `SYSTEM_IGNORE` | Rumore TouchBistro (timestamp, Glass, Goodnight…) | ignore | ❌ mai |
| `BAR_IGNORE` | Drink, cocktail, liquori, mixer | ignore | ❌ mai |
| `SERVER_INSTRUCTION` | Allergie, temperature, sostituzioni, on side | ignore | ❌ mai |
| `OPEN_ITEM_MANUAL` | Open Food — review manuale richiesta | manual_review | ❌ mai |
| `UNKNOWN_REVIEW` | Non classificato — da aggiungere a regole | manual_review | ❌ finché non classificato |

## Come aggiornare le regole

Le regole sono in `pos_item_class_rules` — modificabili via SQL in qualsiasi momento:

```sql
-- Aggiungere una nuova regola
INSERT INTO pos_item_class_rules (pattern, match_type, source_table, item_class, action, priority, notes)
VALUES ('Bellini', 'exact', 'pos_modifiers', 'BAR_IGNORE', 'ignore', 10, 'Cocktail — bar');

-- Disattivare una regola senza cancellarla
UPDATE pos_item_class_rules SET active = false WHERE pattern = 'Balsamic';

-- Vedere tutte le regole per classe
SELECT item_class, pattern, match_type FROM pos_item_class_rules WHERE active = true ORDER BY item_class, priority;
```

## Idempotenza

Re-triggerare per la stessa `business_date` non crea duplicati:

```
DELETE pos_daily_clean WHERE business_date = target_date
DELETE commis_observations WHERE business_date = target_date AND bot_name = 'pos-cleaner'
→ poi reinserisce tutto da capo
```

## Cosa NON fa

- ❌ Non tocca `current_stock`
- ❌ Non scrive `stock_movements`
- ❌ Non modifica `stock_daily_snapshot`
- ❌ Non tocca `prep_tasks`
- ❌ Non fa deduction di nessun tipo
- ❌ Zero LLM — è un Commis deterministico

## Versioni

| Versione | Data | Note |
|---|---|---|
| v1 | 2026-07-07 | Prima release — classification + mapping + commis deterministico |
