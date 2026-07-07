# Stock Consolidator Bot — Test Procedure

## Test v1 — Sprint 5

### Pre-flight: verifica pipeline upstream

Prima di testare il Consolidator, verificare che la pipeline upstream abbia dati puliti:

```sql
-- Pipeline status per 2026-07-06
SELECT source, item_type, COUNT(*), SUM(quantity)
FROM stock_deductions
WHERE business_date = '2026-07-06'
GROUP BY source, item_type
ORDER BY source, item_type;
-- Atteso: direct_recipe prep ~93, bom_chain ingredient ~235
```

---

### Trigger manuale

Da Supabase Dashboard → Edge Functions → `bot-stock-consolidator` → Invoke:
```json
{ "business_date": "2026-07-06" }
```

---

### Verification queries

**1. Bot run status:**
```sql
SELECT bot_name, status, rows_read, rows_written, warnings_count, summary
FROM bot_runs
WHERE bot_name = 'bot-stock-consolidator'
ORDER BY created_at DESC
LIMIT 5;
```

**2. Snapshot aggregato per tipo:**
```sql
SELECT item_type, unit, COUNT(*) AS rows, SUM(pos_deducted_qty) AS total_pos_deducted
FROM stock_daily_snapshot
WHERE business_date = '2026-07-06'
GROUP BY item_type, unit
ORDER BY item_type, unit;
```

**3. Controllo duplicati snapshot (DEVE essere vuoto):**
```sql
SELECT item_type, item_id, unit, COUNT(*) AS duplicate_count
FROM stock_daily_snapshot
WHERE business_date = '2026-07-06'
GROUP BY item_type, item_id, unit
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;
-- Atteso: zero righe
```

**4. Top deductions:**
```sql
SELECT item_type, item_id, pos_deducted_qty, unit, status, warning,
       metadata->>'target_name' AS target_name
FROM stock_daily_snapshot
WHERE business_date = '2026-07-06'
ORDER BY item_type, pos_deducted_qty DESC
LIMIT 50;
```

**5. Osservazioni Commis:**
```sql
SELECT severity, category, title, explanation, suggested_action
FROM commis_observations
WHERE business_date = '2026-07-06'
  AND bot_name = 'bot-stock-consolidator'
  AND commis_name = 'stock-consolidator-commis'
ORDER BY severity DESC, created_at DESC;
```

**6. Safety confirmation — current_stock NON toccato:**
```sql
-- Verifica che stock_movements non sia stato scritto e snapshot esiste
SELECT 'stock_movements (new today)' AS check_name,
       COUNT(*) AS count
FROM stock_movements
WHERE created_at >= CURRENT_DATE
UNION ALL
SELECT 'stock_daily_snapshot 2026-07-06',
       COUNT(*)
FROM stock_daily_snapshot
WHERE business_date = '2026-07-06';

-- Verifica che current_stock non sia stato cambiato recentemente
-- (i valori devono essere gli stessi di prima del run)
SELECT id, name, current_stock, suggested_at
FROM prep_tasks
WHERE current_stock IS NOT NULL
ORDER BY suggested_at DESC NULLS LAST
LIMIT 10;
```

**7. Verifica totali corrispondono a stock_deductions:**
```sql
-- I totali nello snapshot devono matchare i totali nelle deductions
SELECT
  sd.item_type,
  sd.unit,
  SUM(sd.quantity) AS deductions_total,
  SUM(sds.pos_deducted_qty) AS snapshot_total
FROM stock_deductions sd
LEFT JOIN stock_daily_snapshot sds
  ON sds.business_date = sd.business_date
  AND sds.item_type = sd.item_type
  AND sds.unit = sd.unit
WHERE sd.business_date = '2026-07-06'
GROUP BY sd.item_type, sd.unit
ORDER BY sd.item_type;
-- Atteso: deductions_total ≈ snapshot_total per ogni gruppo
```

---

### Success criteria v1

Sprint 5 v1 PASS solo se:

| Check | Risultato atteso |
|---|---|
| `stock_daily_snapshot` popolata | ✅ N > 0 righe |
| Nessuna riga duplicata in snapshot | ✅ zero duplicati |
| `current_stock` su prep_tasks invariato | ✅ non toccato |
| Nessun insert in `stock_movements` | ✅ zero nuovi movimenti |
| Warnings solo per dati davvero ambigui | ✅ noise basso |
| Totali snapshot ≈ totali deductions | ✅ match |
| `bot_runs` mostra success | ✅ status='success' |
| Commis observations utili e non rumorose | ✅ max 5-10 warning reali |

---

## Note importanti v1

**Cosa fa:** crea la "foto" giornaliera in `stock_daily_snapshot`.
**Cosa non fa:** NON aggiorna `current_stock` su `prep_tasks`.

Questo comportamento è **intenzionale** in v1. Prima verifichiamo che i numeri tornino,
poi daremo al Consolidator il permesso di aggiornare lo stock reale.

**v2 (futuro):**
- Leggerà anche `prep_log` per `loaded_qty`
- Calcolerà `stock_end = stock_start + loaded_qty - pos_deducted_qty`
- Aggiornerà `prep_tasks.current_stock` con `stock_end`
- Costruirà La Dispensa UI
