# POS_IMPORTER_BOT — Manuale di Stazione

## Identità
- **Nome:** bot-pos-importer
- **Versione:** v1
- **Tipo:** Edge Function Supabase
- **Brigata:** Sprint 1 — Fondazione

## Responsabilità (una sola)
Leggere i dati POS reali di una `business_date` e scriverli normalizzati in `pos_daily_raw`.

## NON fa mai
- Aggiornare `current_stock`
- Modificare `prep_tasks`
- Scrivere `stock_daily_snapshot`
- Scrivere `stock_deductions`
- Interpretare ricette o BOM
- Lanciare altri bot

## Input
- `business_date` (YYYY-MM-DD) — default: ieri CDT se non specificato

## Sorgenti lette
| Tabella | Campo usato | Note |
|---|---|---|
| `pos_sales_by_item` | `menu_item`, `quantity`, `gross_sales`, `net_sales` | Item principali |
| `pos_modifiers` | `modifier`, `quantity_sold`, `gross_sales` | Modifier come item separati |

## Output
- `pos_daily_raw` — righe normalizzate per la `business_date`
- `bot_runs` — log del run con status, conteggi, summary

## Idempotenza
Prima di scrivere, cancella le righe di `pos_daily_raw` per quella `business_date`.
Puoi rilanciare il bot 10 volte senza duplicare dati.

## Trigger
- Manuale: POST con `{"business_date": "YYYY-MM-DD"}`
- Futuro cron: 04:00 CDT ogni notte

## Costanti operative
```
MENU_CHANGE_DATE = '2026-06-27'
MIN_HISTORY_OCCURRENCES = 2
ZERO_ANOMALY_THRESHOLD = 3
HIGH_SALES_MULTIPLIER = 2.5
```

## Stato run
- `running` → avviato
- `success` → completato senza warning
- `warning` → completato ma con observations dal Commis
- `failed` → errore bloccante
- `partial` → completato parzialmente (futuro)
