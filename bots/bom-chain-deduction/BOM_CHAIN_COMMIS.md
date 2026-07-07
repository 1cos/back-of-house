# BOM Chain Commis — Auditor

## Identità

| Campo | Valore |
|---|---|
| **commis_name** | `bom-chain-commis` |
| **bot_name** | `bot-bom-chain-deduction` |
| **Tipo** | Deterministico — zero LLM |

## Cosa osserva

| Condizione | Severity | Category |
|---|---|---|
| ITEM nel BOM senza ingredient_id | `warning` | `bom_warning` |
| Unità mancante nel BOM per ITEM | `warning` | `bom_warning` |
| Ricetta virtuale senza BOM | `warning` | `bom_warning` |
| BOM chain depth > MAX_DEPTH | `warning` | `bom_warning` |

## Silenzio totale per

- Prep già dedotte da `direct_recipe` (anti-double) — skip silenzioso
- Ingredienti con unità diversa per lo stesso percorso — righe separate, nessun warning

## Query verifica

```sql
SELECT severity, category, title, explanation
FROM commis_observations
WHERE business_date = '2026-07-06'
  AND bot_name = 'bot-bom-chain-deduction'
ORDER BY severity DESC;
```
