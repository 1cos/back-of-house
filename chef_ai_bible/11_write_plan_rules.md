# Chef AI — Write Plan Rules

## Principio fondamentale

Chef AI NON scrive mai nel DB senza che Max abbia premuto "Si Chef".
Il write_plan e una PROPOSTA — descrive cosa verrebbe scritto se Max approva.
STOCK_WRITE_ENABLED = false sempre nel JSON output.

## Struttura write_plan

```json
{
  "write_plan": {
    "table": "prep_tasks",
    "field": "current_stock",
    "new_value": 570,
    "row": "Spaghetti fresh pasta",
    "unit": "nests",
    "requires_approval": true
  },
  "STOCK_WRITE_ENABLED": false
}
```

## Action types supportati in jarvisExecuteDraft

| action_type | Cosa fa |
|---|---|
| update_prep_stock | Aggiorna current_stock su prep_tasks. Cerca per nome (exact + ILIKE fallback). |
| update_recipe_bom | Modifica quantity/unit su una riga recipe_bom specifica (richiede bom_id). |
| create_prep_task | Crea nuovo prep_task (richiede name + category). |
| create_procedure_draft | Aggiorna recipes.procedure (richiede recipe_id + testo). |
| link_prep_task_to_recipe | Collega prep_task a recipe (richiede prep_task_id + recipe_id). |
| mark_issue_not_needed | Risolve un office_item come "non necessario". |
| archive_duplicate_issue | Risolve un office_item come duplicato. |
| assign_task_to_station | Sposta prep_task a nuova stazione (richiede prep_task_id + station). |
| ask_staff_clarification | Crea office_item con richiesta chiarimento. |

## Confidence e flusso approvazione

- confidence >= 0.85: bottone "Si Chef" diretto → jarvisDirectExecute (no sheet intermedio)
- confidence < 0.85: bottone "Apri dettaglio" → jarvisShowApprovalSheet → "Si Chef — Esegui"
- "Verifica" sempre disponibile → jarvisShowReasoning (mostra ragionamento completo)

## Cosa NON fare mai

- Non inventare bom_id, recipe_id, ingredient_id — sempre verificarli con query
- Non costruire write_plan su tabelle non in questa lista
- Non impostare requires_approval: false (sempre richiede approvazione Max)
- Non aggiornare piu campi insieme senza mostrare esplicitamente cosa cambia
- Non modificare suggested_qty o suggested_note (quelli sono di proprieta del bot-preplist-builder)
- Non modificare pos_name rimuovendo alias esistenti — solo appendere con pipe |

## Errore comune — write_plan null

Se il modello capisce i numeri ma lascia write_plan: null, il sistema lo ricostruisce
dai campi top-level del reasoning_result:
- new_total_claimed → write_plan.new_value
- prep_candidate → write_plan.row
- unit → write_plan.unit
- table: 'prep_tasks', field: 'current_stock' (default per production_report)
