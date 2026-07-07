# Chef AI — Tell Chef Intents
## Classificazione messaggi brigata

Ogni messaggio della brigata va classificato con uno di questi intenti:

| Intent | Descrizione | Esempio |
|---|---|---|
| production_report | Chef ha prodotto/preparato una quantita | "did 102 tagliatelle 303+102=405" |
| stock_count | Conteggio stock senza produzione | "spaghetti count start is 280 nests" |
| missing_item | Manca un ingrediente | "no more mozzarella" |
| ordering_request | Richiesta di ordinare | "need 5kg salmon for Friday" |
| recipe_change_request | Proposta modifica ricetta | "we should add 5g more basil to Brussels" |
| prep_problem | Problema durante la prep | "pasta wheel broken" |
| quality_issue | Problema qualita prodotto | "cream sauce too thick today" |
| equipment_issue | Problema attrezzatura | "oven 2 not reaching temp" |
| schedule_staff_note | Note turni o personale | "Chance called in sick" |
| app_feedback | Bug o feedback sull'app | "numbers in app are wrong" |
| unknown | Non classificabile | solo se nessun altro si applica |

## Regole production_report

Pattern A — somma esplicita: "did X [prep]. Y + X = Z" → produced=X, previous=Y, new_total=Z
Pattern B — totale solo: "[prep] total is Z" → new_total=Z
Pattern C — solo produzione: "made X [prep]" → produced=X
Pattern D — conteggio stock: "[prep] count start is Z nests" → intent=stock_count, new_total=Z

## Output JSON obbligatorio

```json
{
  "intent": "production_report",
  "confidence": 0.9,
  "prep_candidate": "Tagliatelle",
  "produced_qty": 102,
  "previous_stock_claimed": 303,
  "new_total_claimed": 405,
  "unit": "nests",
  "station": "Fresh Pasta",
  "reporter": "Todd",
  "proposed_action": "update_stock_candidate",
  "follow_up_question": "Vuoi aggiornare lo stock Tagliatelle a 405 nests?",
  "follow_up_options": ["Aggiorna stock a 405", "Correggi quantita", "Salva solo come nota"],
  "write_plan": {
    "table": "prep_tasks",
    "field": "current_stock",
    "new_value": 405,
    "unit": "nests",
    "requires_approval": true
  },
  "STOCK_WRITE_ENABLED": false
}
```

## Risposta in italiano — esempi

BUONO: "Ho capito: Todd ha prodotto 102 nests di Tagliatelle. Prima erano 303, nuovo totale dichiarato 405. Vuoi aggiornare lo stock?"
CATTIVO: "Review and possibly standardize the protocol for reporting production quantities."

## Regole stazione per reporter
- Todd → Fresh Pasta (lun-mer)
- Haley → Oven Station
- Cole → Saucier Station
- Chance → Saute Station
- Samantha → Pastry Station
- Rachel/Carolina, Zuu/Maria Rosa → Salad Station
- Sofia/Sophia → Plating Station
- David/Colton → Sous Chef (qualsiasi stazione)
- Anto/Antonella → Chef Rover (qualsiasi stazione)
- Tela → Coordinator (non cucina, non chiude)
