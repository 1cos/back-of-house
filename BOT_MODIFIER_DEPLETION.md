# BOT MODIFIER DEPLETION
*Brigade · Zenos on the Square · Weatherford TX*
*Creato: 8 luglio 2026 — Phase 3b*

---

## Regola madre

> **La produzione scarica gli ingredienti. La vendita scarica il prodotto finito.**

---

## Go-live

| Campo | Valore |
|---|---|
| Go-live timestamp | `2026-07-09 07:00:00+00` (07:05 UTC = primo import post go-live) |
| Equivalente CDT | 2026-07-09 02:00 CDT |
| Cutoff logica | `pos_modifiers.created_at >= go_live_at` |
| Retroattivo? | **Mai** — dati pre go_live_at non vengono processati |
| Sale_date nella prima run | `2026-07-08` (dati del giorno prima, arrivati nell'import delle 07:05) |

---

## Regole attive

| Modifier | Target type | item_type | item_id | qty/use |
|---|---|---|---|---|
| Caesar | Caesar Dressing (acquistato) | ingredient | f47e1c26-b91e-4539-a60b-95a9a11f5aa1 | 59.147 ml |
| citronette | CITRONETTE (ricetta) | prep | 3f433b8b-eb7f-4f55-90c6-64d25801d9b7 | 59.147 ml |
| Balsamic | BALSAMIC VINAIGRETTE (ricetta) | prep | e834c1e2-c9a7-4c5c-b525-a4e092df42df | 59.147 ml |
| Ranch | Ranch Dressing (ricetta) | prep | 3cee627c-5eb6-48aa-ad50-91949dcbfc9a | 59.147 ml |

---

## Movement schema

```
stock_movements:
  business_date     = sale_date del POS
  item_type         = 'prep' (recipe-backed) | 'ingredient' (acquistato)
  item_id           = recipe.id | ingredient.id
  movement_type     = 'POS_MODIFIER_DRAIN'
  quantity          = -(uses × 59.147)    — sempre negativo, in ml
  unit              = 'ml'
  source            = 'pos_modifier_drain'
  source_bot        = 'bot-modifier-depletion'
  bom_item_name     = modifier_canonical
  sold_quantity     = numero di ramekin (usi)
  bom_quantity_per_recipe = 59.147 (ml per ramekin)
  metadata.idempotency_key = 'modifier_depletion:{sale_date}:{rule_id}:{canonical}'
  metadata.bot_run_id
  metadata.go_live_at
```

---

## Idempotency

Key format: `modifier_depletion:{sale_date}:{rule_id}:{canonical}`

Il bot interroga `stock_movements` filtrando `source='pos_modifier_drain'` e raccoglie tutti i `metadata.idempotency_key` esistenti. Se il key è già presente → skip con log `already_processed`. Non usa `DELETE + re-INSERT` (a differenza degli altri bot) per preservare la tracciabilità storica.

---

## Modalità

| Parametro body | Effetto |
|---|---|
| `{ dry_run: true }` | Calcola, non scrive. Ritorna `movements_preview`. |
| `{ dry_run: false }` | Scrive `stock_movements`. Logga `bot_runs`. |
| `{ force_live: true }` | Override go_live_at (solo per test — non usare in production) |

---

## Rollback SQL

```sql
-- Rollback completo: elimina tutti i movimenti modifier depletion
DELETE FROM stock_movements
WHERE source = 'pos_modifier_drain'
  AND source_bot = 'bot-modifier-depletion';

-- Rollback per data specifica
DELETE FROM stock_movements
WHERE source = 'pos_modifier_drain'
  AND business_date = '2026-07-08';

-- Disattiva le regole (torna a active=false)
UPDATE pos_modifier_depletion_rules
SET active = false
WHERE confidence = 'confirmed'
  AND source_bot_enabled = 'bot-modifier-depletion';
-- (alternativa diretta)
UPDATE pos_modifier_depletion_rules SET active = false;
```

---

## Attivazione regole (Phase 3b)

```sql
-- BEFORE count
SELECT COUNT(*) FROM stock_movements; -- atteso: 335

-- Attiva le 4 regole
UPDATE pos_modifier_depletion_rules
SET active = true
WHERE confidence = 'confirmed';

-- Verifica
SELECT modifier_canonical, confidence, active FROM pos_modifier_depletion_rules;

-- AFTER prime run: verifica count e righe inserite
SELECT COUNT(*) FROM stock_movements;
SELECT business_date, bom_item_name, quantity, unit, metadata->>'idempotency_key'
FROM stock_movements
WHERE source = 'pos_modifier_drain'
ORDER BY business_date, bom_item_name;
```

---

## Pipeline position

Il bot-modifier-depletion è **indipendente** dalla pipeline principale (pos-cleaner → direct-deduction → bom-chain → consolidator). Gira in parallelo dopo ogni import POS, non ha dipendenze sequenziali con gli altri bot.

---

## Unmatched food modifier warnings

Il bot segnala `unmatched_food_modifiers` solo per modifier che contengono parole food-like (dressing, sauce, glaze, cream, ecc.) ma non sono coperti da nessun alias. Modifier come "no dressing", "on the side", "well done" vengono filtrati automaticamente — non generano warning.

---

## Fasi

| Fase | Stato | Azione |
|---|---|---|
| Phase 2.3 | ✅ | Tabella creata, 4 regole confirmed+inactive |
| Phase 3a | ✅ | Dry-run 29gg, 745 ramekin, audit approvato |
| Phase 3b | ⏳ **Stanotte** | `active=true` → prima run live 2026-07-09 07:05 UTC |
