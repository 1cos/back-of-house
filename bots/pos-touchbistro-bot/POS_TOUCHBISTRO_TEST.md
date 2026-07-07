# POS_TOUCHBISTRO_BOT_TEST — Checklist di Verifica

## Come triggare il bot manualmente

### Via Supabase Dashboard (Edge Functions)
1. Apri Supabase → Edge Functions → bot-pos-touchbistro-bot
2. Clicca "Invoke"
3. Body: `{"business_date": "2026-07-06"}`
4. Clicca "Send"

### Via curl (da terminale con accesso alla rete)
```bash
curl -X POST \
  "https://ydqmumpytgrlceuinoqt.supabase.co/functions/v1/bot-pos-touchbistro-bot" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
  -d '{"business_date": "2026-07-06"}'
```

## Verifica pos_daily_raw
```sql
-- Quante righe per data?
SELECT business_date, source_table, COUNT(*) as rows, SUM(portions_sold) as total_portions
FROM pos_daily_raw
WHERE business_date = '2026-07-06'
GROUP BY business_date, source_table
ORDER BY source_table;

-- Prime 20 righe
SELECT pos_item_name, portions_sold, source_table
FROM pos_daily_raw
WHERE business_date = '2026-07-06'
ORDER BY source_table, portions_sold DESC
LIMIT 20;
```

## Verifica idempotenza
```sql
-- Lancia il bot due volte per la stessa data
-- Poi controlla che il numero di righe sia invariato
SELECT COUNT(*) FROM pos_daily_raw WHERE business_date = '2026-07-06';
-- Deve essere sempre lo stesso numero
```

## Verifica bot_runs
```sql
SELECT bot_name, run_date, status, rows_read, rows_written, 
       warnings_count, errors_count, summary, started_at, finished_at
FROM bot_runs
WHERE bot_name = 'pos-touchbistro-bot'
ORDER BY started_at DESC
LIMIT 5;
```

## Verifica commis_observations
```sql
-- Tutte le observation per una data
SELECT severity, category, title, explanation
FROM commis_observations
WHERE business_date = '2026-07-06'
  AND bot_name = 'pos-touchbistro-bot'
ORDER BY severity DESC, category;

-- Conteggio per severità
SELECT severity, COUNT(*) as n
FROM commis_observations
WHERE business_date = '2026-07-06'
  AND bot_name = 'pos-touchbistro-bot'
GROUP BY severity;
```

## Checks attesi dopo il primo run su 2026-07-06

### pos_daily_raw
- [ ] Righe da `pos_sales_by_item`: ~104 (come da source)
- [ ] Righe da `pos_modifiers`: ~96
- [ ] Nessuna riga duplicata

### bot_runs
- [ ] Status `success` o `warning` (non `failed`)
- [ ] `rows_read` circa 200, `rows_written` circa 200
- [ ] `finished_at` popolato

### commis_observations
- [ ] Nessuna observation critica (`severity=critical`) — non implementata in v1
- [ ] Warning solo per item con media post-cambio > 3 assenti dal report
- [ ] Info per item senza storico sufficiente
- [ ] Rilancio pulisce e riscrive (nessun duplicato)

## Tabelle che NON devono essere toccate
```sql
-- Questi COUNT devono restare invariati dopo il run
SELECT 
  (SELECT COUNT(*) FROM prep_tasks) as prep_tasks_unchanged,
  (SELECT COUNT(*) FROM stock_daily_snapshot) as snapshot_still_empty,
  (SELECT COUNT(*) FROM stock_deductions) as deductions_still_empty;
```
