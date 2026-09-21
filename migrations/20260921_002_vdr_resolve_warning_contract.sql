-- =============================================================
-- INV06C.1 — CONTRATTO SERVER-SIDE DI vdr_resolve_warning
-- Deployed: 2026-09-21
-- Project: ydqmumpytgrlceuinoqt
-- Incrementale su 20260921_001. Quella migration NON viene modificata.
--
-- DUE BUCHI DIMOSTRATI NELLA VERSIONE 001
--
-- 1. NESSUN LEGAME FRA DOCUMENTO E WARNING. Passando
--    p_document_id = documento A e p_warning_id = riga di un documento
--    B, la 001 committava entrambi. Verificato in transazione con
--    rollback forzato: ha risposto {"ok": true, "warning_state":
--    "closed"} chiudendo un warning del documento 12fd6860 mentre
--    p_document_id era 856205.
--
-- 2. p_warning_id NULL ACCETTATO SULLA FIDUCIA. La 001 lo trattava
--    sempre come "nessuna riga attesa". L'unica cosa che impediva di
--    risolvere un documento lasciando aperta la sua riga era una
--    guardia in JavaScript.
--
-- PERCHE' NON UNA WHITELIST DI CODICI. La regola naturale sarebbe
-- "NULL ammesso solo per OQR-006". Misurato sui dati veri, pero', i
-- codici presenti nei documenti e MAI persistiti in invoice_warnings
-- sono sei: OQR-006 (802 occorrenze), BEK_BUYER_EXCLUDED (29),
-- OQR-008 (10), BEK_REVISION_AFTER_IMPORT, DUPLICATE,
-- BEK_REVISION_UNKNOWN. Alcuni sono esclusi dal filtro all'insert,
-- altri vengono scritti sul documento da percorsi che in
-- invoice_warnings non inseriscono affatto (per esempio il warning
-- DUPLICATE, scritto con una UPDATE diretta su vendor_documents).
-- Una lista congelata su OQR-006 avrebbe bloccato l'utente sugli altri
-- cinque; una lista di sei codici sarebbe gia' vecchia al prossimo
-- codice nuovo.
--
-- La regola guarda quindi i DATI, non un elenco: NULL e' ammesso solo
-- se per quel documento e quel codice non esiste nessuna riga aperta.
-- E' verificabile dal server, non si fida di niente che arrivi dal
-- browser, e non ha bisogno di manutenzione.
--
-- DROP + CREATE, non CREATE OR REPLACE: la firma cambia (arriva
-- p_warning_code) e un semplice replace lascerebbe in vita la vecchia
-- funzione a 7 argomenti, cioe' proprio quella vulnerabile.
-- =============================================================

DROP FUNCTION IF EXISTS public.vdr_resolve_warning(uuid, jsonb, jsonb, uuid, text, text, text);

CREATE FUNCTION public.vdr_resolve_warning(
  p_document_id  uuid,
  p_warnings     jsonb,
  p_parsed_json  jsonb   DEFAULT NULL,
  p_warning_id   uuid    DEFAULT NULL,
  p_status       text    DEFAULT 'resolved',
  p_resolution   text    DEFAULT NULL,
  p_resolved_by  text    DEFAULT NULL,
  p_warning_code text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_doc_rows  int;
  v_warn_rows int;
  v_status    text;
  v_code      text;
  v_owner     uuid;
BEGIN
  IF p_document_id IS NULL THEN
    RAISE EXCEPTION 'VDR_RESOLVE_WARNING: p_document_id obbligatorio';
  END IF;
  IF p_status NOT IN ('resolved', 'skipped') THEN
    RAISE EXCEPTION 'VDR_RESOLVE_WARNING: status non valido (%) — ammessi solo resolved e skipped', p_status;
  END IF;

  -- ── contratto sul NULL, verificato sui dati ──────────────────────
  IF p_warning_id IS NULL THEN
    IF p_warning_code IS NULL THEN
      RAISE EXCEPTION 'VDR_RESOLVE_WARNING: senza p_warning_id serve p_warning_code per poter verificare che nessuna riga sia attesa';
    END IF;
    IF EXISTS (SELECT 1 FROM invoice_warnings
                WHERE document_id = p_document_id
                  AND code        = p_warning_code
                  AND status      = 'open') THEN
      RAISE EXCEPTION 'VDR_RESOLVE_WARNING: esiste almeno una riga aperta % sul documento %, non si puo risolvere il documento senza chiuderla',
        p_warning_code, p_document_id;
    END IF;
  ELSE
    -- ── il warning deve appartenere a QUESTO documento ─────────────
    SELECT status, code, document_id INTO v_status, v_code, v_owner
      FROM invoice_warnings WHERE id = p_warning_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'VDR_RESOLVE_WARNING: invoice_warnings % inesistente', p_warning_id;
    END IF;
    IF v_owner IS DISTINCT FROM p_document_id THEN
      RAISE EXCEPTION 'VDR_RESOLVE_WARNING: il warning % appartiene al documento %, non a %',
        p_warning_id, v_owner, p_document_id;
    END IF;
    IF p_warning_code IS NOT NULL AND v_code IS DISTINCT FROM p_warning_code THEN
      RAISE EXCEPTION 'VDR_RESOLVE_WARNING: il warning % ha codice %, non %',
        p_warning_id, v_code, p_warning_code;
    END IF;
  END IF;

  -- ── da qui in poi si scrive, e si scrive tutto o niente ──────────
  UPDATE vendor_documents
     SET warnings    = p_warnings,
         parsed_json = COALESCE(p_parsed_json, parsed_json),
         updated_at  = now()
   WHERE id = p_document_id;
  GET DIAGNOSTICS v_doc_rows = ROW_COUNT;
  IF v_doc_rows <> 1 THEN
    RAISE EXCEPTION 'VDR_RESOLVE_WARNING: documento % non aggiornato (righe=%)', p_document_id, v_doc_rows;
  END IF;

  IF p_warning_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'document_updated', true,
                              'warning_updated', false, 'warning_state', 'none');
  END IF;

  -- gia' chiusa: idempotente, non si riscrive la risoluzione originale
  -- e non si puo' riportare una riga chiusa a open (p_status lo vieta)
  IF v_status <> 'open' THEN
    RETURN jsonb_build_object('ok', true, 'document_updated', true,
                              'warning_updated', false, 'warning_state', 'already_closed');
  END IF;

  UPDATE invoice_warnings
     SET status      = p_status,
         resolution  = p_resolution,
         resolved_by = p_resolved_by,
         resolved_at = now()
   WHERE id          = p_warning_id
     AND document_id = p_document_id      -- ridondante e voluto
     AND status      = 'open';
  GET DIAGNOSTICS v_warn_rows = ROW_COUNT;
  IF v_warn_rows <> 1 THEN
    RAISE EXCEPTION 'VDR_RESOLVE_WARNING: riga % non aggiornata (righe=%)', p_warning_id, v_warn_rows;
  END IF;

  RETURN jsonb_build_object('ok', true, 'document_updated', true,
                            'warning_updated', true, 'warning_state', 'closed');
END;
$$;

COMMENT ON FUNCTION public.vdr_resolve_warning IS
  'INV06C.1 - risoluzione atomica di un warning Vendor Review. Invarianti: il warning deve appartenere al documento passato; p_warning_id NULL e ammesso solo se per quel documento e quel codice non esiste nessuna riga aperta; p_status solo resolved o skipped; o entrambi gli update o nessuno.';
