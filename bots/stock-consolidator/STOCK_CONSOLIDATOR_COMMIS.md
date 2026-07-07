# Stock Consolidator Commis — Manuale

## Identità

| Campo | Valore |
|---|---|
| **commis_name** | `stock-consolidator-commis` |
| **bot_name** | `bot-stock-consolidator` |
| **Tipo** | Deterministico — zero LLM |
| **Scrive in** | `commis_observations` |

---

## Cosa osserva

Il Commis controlla il risultato del Consolidator e segnala anomalie. Non modifica mai dati.

### 1. Unit mismatch
Stesso target (prep_task_id o ingredient_id) con unità diverse in stock_deductions.

```
severity: warning
category: unit_mismatch
title: "Unit mismatch — [target_name]: pz e g"
explanation: "La stessa prep ha deductions con unità diverse. Il Consolidator le ha scritte come righe separate."
suggested_action: "Verificare BOM delle ricette che scaricano [target_name]"
```

### 2. Prep senza prep_task_id
Riga `item_type='prep'` in stock_deductions senza `prep_task_id` valido.

```
severity: warning
category: missing_link
title: "Prep senza prep_task_id — [target_name]"
explanation: "La deduction non è collegata a nessun prep_task attivo."
suggested_action: "Collegare ricetta [target_recipe_id] a un prep_task"
```

### 3. Ingredient senza ingredient_id
Riga `item_type='ingredient'` senza `ingredient_id`.

```
severity: warning
category: missing_link
title: "Ingredient senza ingredient_id — [target_name]"
```

### 4. Deduction insolitamente alta
`pos_deducted_qty` > soglia ragionevole (verificato caso per caso).

```
severity: info
category: unusual_quantity
title: "Deduction alta — [target_name]: [qty] [unit]"
explanation: "Il totale dedotto per questa prep è insolitamente alto. Potrebbe essere corretto o un errore BOM."
suggested_action: "Verificare BOM e storico vendite"
```

### 5. Duplicate in stock_deductions
Stessa chiave `(business_date, item_type, prep_task_id, unit, source)` presente più di una volta.

```
severity: critical
category: duplicate_deduction
title: "Duplicate trovate — [N] righe per [target_name]"
explanation: "Ci sono righe duplicate in stock_deductions per questa data. Il bot ha ignorato i duplicati e preso il valore massimo."
suggested_action: "Verificare idempotenza di bot-direct-deduction e bot-bom-chain-deduction"
```

### 6. Snapshot parziale
Il run è completato ma alcune righe hanno status='warning'.

```
severity: info
category: partial_snapshot
title: "Snapshot 2026-XX-XX parziale — N righe con warning"
explanation: "Il consolidator ha scritto lo snapshot ma alcune prep/ingredient hanno dati ambigui."
suggested_action: "Controllare le righe con status='warning' in stock_daily_snapshot"
```

### 7. Nessuna deduction trovata
stock_deductions è vuota per la data target.

```
severity: critical
category: missing_input
title: "Nessuna deduction trovata per 2026-XX-XX"
explanation: "Il Consolidator non ha trovato dati in stock_deductions per questa data. Verificare che i bot precedenti abbiano girato."
```

---

## Cosa NON fa

- ❌ Non modifica mai nessuna tabella eccetto `commis_observations`
- ❌ Non usa LLM per ragionare — solo regole deterministiche
- ❌ Non propone fix automatici — solo osservazioni per Max
- ❌ Non segnala anomalie su dati che non conosce (es. storico)

---

## Idempotenza

```sql
DELETE FROM commis_observations
WHERE business_date = target_date
  AND bot_name = 'bot-stock-consolidator'
  AND commis_name = 'stock-consolidator-commis';
```
