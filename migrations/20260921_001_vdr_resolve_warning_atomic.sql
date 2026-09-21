-- =============================================================
-- INV06C — RISOLUZIONE ATOMICA DI UN WARNING DALLA VENDOR REVIEW
-- Deployed: 2026-09-21
-- Project: ydqmumpytgrlceuinoqt
--
-- IL PROBLEMA
-- vdrResolveQuestion faceva due write separate: prima vendor_documents
-- (warnings + parsed_json), poi invoice_warnings. Se la seconda falliva,
-- l'errore veniva loggato ma non propagato, e restava lo stato:
--   documento risolto  +  invoice_warnings ancora open
-- che e' esattamente lo stato stale che INV06/INV06B stanno eliminando.
-- Dimostrato in test: vedi tests/vendor-review-warning-lifecycle.test.js.
--
-- LA REGOLA
-- Una risposta della Vendor Review ha solo due esiti accettabili:
--   SUCCESS  documento e riga coerenti
--   FAILURE  nessuno dei due modificato
-- Una funzione plpgsql gira dentro un'unica transazione: qualunque RAISE
-- qui dentro annulla anche l'UPDATE sul documento.
--
-- p_warning_id NULL E' LEGITTIMO, e non e' una scappatoia: i warning
-- OQR-006 non entrano MAI in invoice_warnings — sono filtrati in
-- entrambi i punti di insert (vendor-documents-review.js e
-- vendor-doc-auto-import/index.ts). Per loro non esiste una riga da
-- chiudere e pretenderla bloccherebbe l'utente. Il chiamante passa NULL
-- solo quando nessuna riga e' attesa; se una riga e' attesa ma non
-- identificabile in modo univoco, NON chiama affatto.
--
-- SECURITY INVOKER (default) di proposito: le tre tabelle non hanno RLS
-- attiva, quindi un SECURITY DEFINER non servirebbe a niente e
-- introdurrebbe solo un'elevazione di privilegi gratuita.
--
-- Non modifica nessuna tabella, nessun vincolo, nessun indice.
-- =============================================================

CREATE OR REPLACE FUNCTION public.vdr_resolve_warning(
  p_document_id uuid,
  p_warnings    jsonb,
  p_parsed_json jsonb   DEFAULT NULL,
  p_warning_id  uuid    DEFAULT NULL,
  p_status      text    DEFAULT 'resolved',
  p_resolution  text    DEFAULT NULL,
  p_resolved_by text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_doc_rows  int;
  v_warn_rows int;
  v_status    text;
BEGIN
  IF p_document_id IS NULL THEN
    RAISE EXCEPTION 'VDR_RESOLVE_WARNING: p_document_id obbligatorio';
  END IF;
  IF p_status NOT IN ('resolved', 'skipped') THEN
    RAISE EXCEPTION 'VDR_RESOLVE_WARNING: status non valido (%)', p_status;
  END IF;

  -- 1) stato del warning sul documento
  UPDATE vendor_documents
     SET warnings    = p_warnings,
         parsed_json = COALESCE(p_parsed_json, parsed_json),
         updated_at  = now()
   WHERE id = p_document_id;
  GET DIAGNOSTICS v_doc_rows = ROW_COUNT;
  IF v_doc_rows <> 1 THEN
    RAISE EXCEPTION 'VDR_RESOLVE_WARNING: documento % non aggiornato (righe=%)',
      p_document_id, v_doc_rows;
  END IF;

  -- 2) nessuna riga attesa (es. OQR-006): il documento basta
  IF p_warning_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'document_updated', true,
                              'warning_updated', false, 'warning_state', 'none');
  END IF;

  SELECT status INTO v_status FROM invoice_warnings WHERE id = p_warning_id;
  IF NOT FOUND THEN
    -- id sbagliato: meglio annullare tutto che chiudere il documento
    -- puntando a una riga che non esiste
    RAISE EXCEPTION 'VDR_RESOLVE_WARNING: invoice_warnings % inesistente', p_warning_id;
  END IF;

  -- 3) idempotenza: gia' chiusa, non si riscrive la risoluzione originale
  IF v_status <> 'open' THEN
    RETURN jsonb_build_object('ok', true, 'document_updated', true,
                              'warning_updated', false, 'warning_state', 'already_closed');
  END IF;

  UPDATE invoice_warnings
     SET status      = p_status,
         resolution  = p_resolution,
         resolved_by = p_resolved_by,
         resolved_at = now()
   WHERE id = p_warning_id
     AND status = 'open';
  GET DIAGNOSTICS v_warn_rows = ROW_COUNT;
  IF v_warn_rows <> 1 THEN
    RAISE EXCEPTION 'VDR_RESOLVE_WARNING: riga % non aggiornata (righe=%)',
      p_warning_id, v_warn_rows;
  END IF;

  RETURN jsonb_build_object('ok', true, 'document_updated', true,
                            'warning_updated', true, 'warning_state', 'closed');
END;
$$;

COMMENT ON FUNCTION public.vdr_resolve_warning IS
  'INV06C — risolve un warning della Vendor Review in modo atomico: stato sul documento e riga invoice_warnings, o entrambi o nessuno. p_warning_id NULL solo quando nessuna riga e attesa (OQR-006).';
