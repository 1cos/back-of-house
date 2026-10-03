-- =====================================================================
-- XCF-GG 04 (03/10/2026) — OCR gratuito sul Mac Mini (Apple Vision).
--
-- Google Vision richiede la fatturazione Google Cloud: Max non vuole pagare.
-- Il worker cloud lascia le scansioni senza testo in 'error' (OCR_FAILED /
-- OCR_UNAVAILABLE) con il PDF intatto. Il worker locale workers/doc-ocr:
--   vd_ocr_claim  -> prende quei documenti (max 3, PDF nello Storage)
--   vd_ocr_submit -> scrive parsed_json.ocr_text (+ engine/pagine) e rimette
--                    il documento in 'pdf_received': il worker cloud riparte
--                    da quel testo (split GG, parser, import) senza Vision.
-- Stesso token del worker del Mac Mini (po__worker_auth: in DB solo sha256).
-- Al massimo 3 tentativi locali per documento, poi resta in errore per Max.
-- Rollback: DROP FUNCTION public.vd_ocr_submit(text,uuid,text,text,int,text);
--           DROP FUNCTION public.vd_ocr_claim(text,text);
-- =====================================================================
CREATE OR REPLACE FUNCTION public.vd_ocr_claim(p_worker_token text, p_worker_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v jsonb;
BEGIN
  PERFORM public.po__worker_auth(p_worker_token);
  WITH c AS (
    SELECT id FROM public.vendor_documents
     WHERE status = 'error'
       AND (warnings @> '[{"code":"OCR_FAILED"}]'::jsonb OR warnings @> '[{"code":"OCR_UNAVAILABLE"}]'::jsonb)
       AND nullif(parsed_json->>'storage_path', '') IS NOT NULL
       AND coalesce(length(parsed_json->>'ocr_text'), 0) < 30
       AND coalesce((parsed_json->'local_ocr'->>'attempts')::int, 0) < 3
       AND (parsed_json->'local_ocr'->>'claimed_at' IS NULL
            OR (parsed_json->'local_ocr'->>'claimed_at')::timestamptz < now() - interval '15 minutes')
     ORDER BY created_at LIMIT 3 FOR UPDATE SKIP LOCKED
  ), u AS (
    UPDATE public.vendor_documents d
       SET parsed_json = d.parsed_json || jsonb_build_object('local_ocr', coalesce(d.parsed_json->'local_ocr', '{}'::jsonb)
             || jsonb_build_object('claimed_at', now(), 'worker', left(coalesce(p_worker_id, 'mac-mini'), 80),
                                   'attempts', coalesce((d.parsed_json->'local_ocr'->>'attempts')::int, 0) + 1))
      FROM c WHERE d.id = c.id
    RETURNING d.id, d.vendor, d.parsed_json->>'storage_path' storage_path
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'vendor', vendor, 'storage_path', storage_path)), '[]'::jsonb) INTO v FROM u;
  RETURN jsonb_build_object('ok', true, 'jobs', v);
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'PO:%' THEN RETURN public.po__err(SQLERRM); END IF; RAISE;
END $$;

-- p_text NULL = OCR locale fallito: si registra il motivo, il documento resta in errore.
CREATE OR REPLACE FUNCTION public.vd_ocr_submit(p_worker_token text, p_doc_id uuid, p_text text, p_engine text,
                                                p_pages int, p_error text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE d public.vendor_documents%ROWTYPE;
BEGIN
  PERFORM public.po__worker_auth(p_worker_token);
  SELECT * INTO d FROM public.vendor_documents WHERE id = p_doc_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.po__fail('NOT_FOUND'); END IF;
  -- Solo un documento ancora fermo per OCR e preso dal worker: niente sovrascritture.
  IF d.status <> 'error' OR d.parsed_json->'local_ocr'->>'claimed_at' IS NULL
     OR NOT (d.warnings @> '[{"code":"OCR_FAILED"}]'::jsonb OR d.warnings @> '[{"code":"OCR_UNAVAILABLE"}]'::jsonb) THEN
    PERFORM public.po__fail('INVALID_STATE', d.status);
  END IF;
  IF p_text IS NULL OR length(regexp_replace(p_text, '\s', '', 'g')) < 30 THEN
    UPDATE public.vendor_documents SET parsed_json = parsed_json || jsonb_build_object('local_ocr', (parsed_json->'local_ocr')
             || jsonb_build_object('error', left(coalesce(p_error, 'OCR senza testo utile'), 300), 'failed_at', now())),
           updated_at = now()
     WHERE id = d.id;
    RETURN jsonb_build_object('ok', true, 'status', 'error', 'recorded', 'failure');
  END IF;
  UPDATE public.vendor_documents
     SET status = 'pdf_received', warnings = '[]'::jsonb, updated_at = now(),
         parsed_json = parsed_json || jsonb_build_object('ocr_text', p_text, 'ocr_engine', left(coalesce(p_engine, 'local'), 60),
           'ocr_pages', p_pages, 'ocr_at', now(),
           'local_ocr', (parsed_json->'local_ocr') || jsonb_build_object('done_at', now(), 'replaced_warning', d.warnings))
   WHERE id = d.id;
  RETURN jsonb_build_object('ok', true, 'status', 'pdf_received');
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'PO:%' THEN RETURN public.po__err(SQLERRM); END IF; RAISE;
END $$;

REVOKE ALL ON FUNCTION public.vd_ocr_claim(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vd_ocr_claim(text, text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.vd_ocr_submit(text, uuid, text, text, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vd_ocr_submit(text, uuid, text, text, int, text) TO anon, authenticated, service_role;
