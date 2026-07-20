# Clean & Trust — Nota Operativa 2026-07-20

## Cron disabilitato

**Cron:** `bot-preplist-builder-nightly`
**Data disabilitazione:** 2026-07-20
**Stato precedente:** `active=true`, schedule `0 9 * * *` (04:00 CDT)
**Stato attuale:** `active=false`, schedule invariato (riga preservata per rollback)

**Motivo:** Il bot-preplist-builder ha prodotto 0 output utili dal 2026-06-28.
Il cron girava ogni notte alle 04:00 CDT scrivendo `suggested_qty` e `suggested_note`
in `prep_tasks`, ma la Prep UI usa `prep_suggestions_daily` come fonte di verità dal v625a.
I valori scritti dal builder non influenzavano nessuna card visibile agli utenti.

Confermato da Task 23A (verifica codice live `js/prep.js`):
> "MAI fallback a suggested_qty/note legacy per card con suggestion presente."

## CSV archivio

**Path:** `docs/archive/clean-trust/prep_tasks_legacy_suggested_fields_2026-07-20.csv`
**Contenuto:** 131 righe con `suggested_qty` o `suggested_note` non-null al momento del backup

## Campi azzerati

| Campo | Righe azzerate |
|---|---|
| `prep_tasks.suggested_qty` | 68 |
| `prep_tasks.suggested_note` | 124 |
| Almeno uno dei due | 131 |

**Tabelle NON toccate:** `prep_suggestions_daily`, `prep_tasks.current_stock`,
`prep_tasks.done`, `prep_tasks.average_qty`, tutti i log di produzione,
tutte le tabelle pipeline.

## Rollback

```sql
-- 1. Riattivare il cron
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'bot-preplist-builder-nightly'),
  active := true
);

-- 2. Ripristinare i valori legacy (dal CSV in archivio)
-- Caricare il CSV e fare bulk INSERT/UPDATE manuale
-- oppure lasciare che il builder rigiri la prossima mattina dopo riattivazione
```

**Nota:** i valori legacy non erano visibili agli utenti prima dello zero-out.
Il ripristino è necessario solo se si vuole dismettere bot-prep-suggester,
scenario non previsto.

## Oggetti NON toccati intenzionalmente

- `bot-preplist-builder` Edge Function (v72) — conservata
- Colonne `prep_tasks.suggested_qty` e `prep_tasks.suggested_note` — conservate (solo contenuto azzerato)
- Codice fallback legacy in `js/prep.js` — conservato
- `bot-pipeline-worker`, `bot_pipeline_jobs`, `bot_pipeline_step_runs` — attivi e invariati
- Tutti gli RPC pipeline: `claim_next_pipeline_job`, `complete_pipeline_step`, etc.
