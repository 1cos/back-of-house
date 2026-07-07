# Direct Deduction Commis — Auditor

## Identità

| Campo | Valore |
|---|---|
| **commis_name** | `direct-deduction-commis` |
| **bot_name** | `bot-direct-deduction` |
| **Tipo** | Deterministico — zero LLM |
| **Output** | `commis_observations` |

## Cosa osserva

| Condizione | Severity | Category |
|---|---|---|
| Ricetta senza nessun BOM RECIPE (solo ITEM raw) | `info` | `bom_warning` |
| Sub-recipe nel BOM senza prep_task attivo | `warning` | `bom_warning` |
| BOM quantity = 0 | `warning` | `bom_warning` |
| BOM qty > 5000/porzione (sospetto batch) | `info` | `bom_warning` |
| Ha BOM RECIPE ma zero scarichi generati | `warning` | `bom_warning` |

## Silenzio totale per

- SYSTEM_IGNORE, BAR_IGNORE, SERVER_INSTRUCTION → già fermati da Bot 2
- Ricette senza recipe_id → già escluse dalla query di input
- Righe con portions_sold = 0

## Query verifica

```sql
SELECT severity, category, title, metadata->>'prep_task_name' AS prep
FROM commis_observations
WHERE business_date = '2026-07-06'
  AND bot_name = 'bot-direct-deduction'
ORDER BY severity DESC;
```
