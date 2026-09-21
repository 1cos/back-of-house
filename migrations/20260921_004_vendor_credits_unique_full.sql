-- ─────────────────────────────────────────────────────────────────────
-- INV08C — l'indice unico deve essere PIENO, non parziale
--
-- La migration 003 aveva creato l'indice con un predicato:
--
--   create unique index ... on vendor_credits (vendor_document_id)
--     where vendor_document_id is not null;
--
-- Sembrava piu' preciso ed era inutilizzabile. ON CONFLICT puo' usare
-- un indice parziale solo se la clausola ripete lo stesso predicato, e
-- PostgREST espone soltanto il nome delle colonne: l'upsert del worker
-- falliva con "there is no unique or exclusion constraint matching the
-- ON CONFLICT specification".
--
-- L'ho scoperto in produzione, al primo recupero. Il fail closed ha
-- retto: nessuna riga scritta e nessun documento chiuso, quindi non e'
-- restato niente a meta'.
--
-- Il predicato non serviva: in Postgres un UNIQUE ammette gia' piu'
-- NULL, quindi l'indice pieno ha esattamente la stessa semantica —
-- un documento, una registrazione — e in piu' funziona con ON CONFLICT.
--
-- Migration incrementale: la 003 non si modifica, si sostituisce qui
-- l'indice che aveva creato. La tabella e' vuota, quindi il passaggio
-- non puo' fallire su dati esistenti.
-- ─────────────────────────────────────────────────────────────────────

drop index if exists public.vendor_credits_vendor_document_id_key;

create unique index if not exists vendor_credits_vendor_document_id_key
  on public.vendor_credits (vendor_document_id);
