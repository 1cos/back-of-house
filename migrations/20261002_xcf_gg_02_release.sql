-- XCF-GG 02 — RILASCIO dei documenti Global Gourmet fermi.
--
-- NON ESEGUIRE PRIMA DI:
--   1. deploy della correzione prezzi al libbra / U-M / purchase_unit
--      (altro agente: js/vendor-documents-review.js + vendor-doc-auto-import);
--   2. deploy di vendor-doc-auto-import con XCF-GG (OCR Vision + parser
--      Global Gourmet + split + modalita' storica), cioe' il merge di
--      xcf-gg e xcf-prezzi nello STESSO deploy del worker.
--
-- Cosa fa: toglie il trigger di attesa e rimette in coda ('pdf_received')
-- SOLO i documenti fermati da quel trigger. Al giro successivo del job 19
-- il worker: OCR (Google Vision) → testo in parsed_json.ocr_text → split
-- della scansione in una fattura per numero (il contenitore va 'ignored')
-- → al giro dopo ogni fattura e' parsata, deduplicata per numero e, se
-- quadra e non ha warning bloccanti, importata da Phase B.
--
-- Idempotente: rieseguita non trova piu' niente da rilasciare.
begin;

drop trigger if exists trg_vd_hold_global_gourmet on public.vendor_documents;
drop function if exists public.vd_hold_global_gourmet();

update public.vendor_documents
   set status = 'pdf_received',
       warnings = '[]'::jsonb,
       parsed_json = (parsed_json - 'gg_hold') || jsonb_build_object(
         'gg_hold_released', jsonb_build_object(
           'at', now(),
           'held_since', parsed_json -> 'gg_hold' ->> 'since',
           'by', 'migrations/20261002_xcf_gg_02_release.sql'))
 where status = 'error'
   and vendor = 'Global Gourmet Foods'
   and warnings @> '[{"code":"GG_HOLD_PARSER_NOT_DEPLOYED"}]'::jsonb
returning id, source_email_subject, parsed_json ->> 'storage_path' as storage_path;

commit;
