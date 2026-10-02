-- ─────────────────────────────────────────────────────────────────────
-- XCF-HARDIES — document_type 'return_request' (pick-up slip / R.M.A.)
--
-- Il pick-up slip Hardie's (email "R.M.A. - #006xxxxx") e' la richiesta
-- di ritiro di un reso: quantita', SKU, ordine originale, nessun importo.
-- Non e' una fattura (00682258 finiva in errore PARSE_ERROR, 00670731
-- 'imported' con zero righe) e non e' un credito: il credito arriva come
-- documento CREDIT separato e va in vendor_credits.
--
-- Perche' un tipo suo e non 'credit_memo': il dedup del worker e' per
-- (vendor, document_number, document_type). Hardie's numera R.M.A. e
-- CREDIT nella stessa serie 006xxxxx; se il pick-up slip fosse un
-- credit_memo e il CREDIT arrivasse con lo stesso numero, il credito vero
-- verrebbe scartato DUPLICATE e il suo PDF cancellato.
--
-- Migration additiva: allarga il CHECK, non tocca righe. Va applicata
-- PRIMA del deploy di vendor-doc-auto-import che scrive il nuovo tipo.
-- Rollback (solo se nessuna riga usa il tipo):
--   alter table public.vendor_documents drop constraint vendor_documents_document_type_check;
--   alter table public.vendor_documents add constraint vendor_documents_document_type_check
--     check (document_type = any (array['order_confirmation','invoice','credit_memo']));
-- ─────────────────────────────────────────────────────────────────────

alter table public.vendor_documents
  drop constraint if exists vendor_documents_document_type_check;

alter table public.vendor_documents
  add constraint vendor_documents_document_type_check
  check (document_type = any (array['order_confirmation'::text, 'invoice'::text, 'credit_memo'::text, 'return_request'::text]));
