# POS Cleaner Commis — Mapping Auditor

## Identità

| Campo | Valore |
|---|---|
| **commis_name** | `mapping-commis` |
| **bot_name** | `pos-cleaner` |
| **Tipo** | Deterministico — zero LLM |
| **Output** | `commis_observations` |

## Cosa osserva

Il Commis legge `pos_daily_clean` dopo la classificazione e scrive osservazioni. Non corregge dati, non modifica ricette, non tocca stock.

## Regole di osservazione

| Condizione | Severity | Category | Azione |
|---|---|---|---|
| `MENU_ITEM` senza `recipe_id` | `warning` | `missing_mapping` | Aggiungi pos_name alla ricetta |
| `KITCHEN_OPERATIONAL` senza `recipe_id` | `info` | `missing_mapping` | Aggiungi a pos_item_aliases |
| `OPEN_ITEM_MANUAL` | `warning` | `manual_review` | Verifica manuale su TouchBistro |
| `UNKNOWN_REVIEW` | `info` | `missing_mapping` | Classifica in pos_item_class_rules |
| `SYSTEM_IGNORE` | — | — | Silenzio totale |
| `BAR_IGNORE` | — | — | Silenzio totale |
| `SERVER_INSTRUCTION` | — | — | Silenzio totale |

## Query per vedere le osservazioni

```sql
-- Osservazioni del mapping-commis per data
SELECT severity, title, explanation, suggested_action
FROM commis_observations
WHERE business_date = '2026-07-06'
  AND bot_name = 'pos-cleaner'
  AND commis_name = 'mapping-commis'
ORDER BY severity DESC, title;

-- Solo warning (MENU_ITEM senza ricetta e Open Food)
SELECT title, metadata->>'portions_sold' AS porzioni
FROM commis_observations
WHERE business_date = '2026-07-06'
  AND bot_name = 'pos-cleaner'
  AND severity = 'warning'
ORDER BY (metadata->>'portions_sold')::numeric DESC;
```

## Cosa NON fa il Commis

- Non chiama LLM
- Non modifica `pos_daily_clean`
- Non crea office_items (questo lo fa Chef AI sopra, in futuro)
- Non fa matching fuzzy — solo segnalazione secca
