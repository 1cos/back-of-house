-- XCF-ORDINI 05 — search_path fisso sugli helper non SECURITY DEFINER
-- (advisor function_search_path_mutable). Nessun cambio di comportamento:
-- sono funzioni interne, gia' non eseguibili da anon/authenticated.
-- Rollback: non necessario (ALTER ... RESET search_path per tornare indietro).
ALTER FUNCTION public.po__fail(text, text)        SET search_path = pg_catalog, public;
ALTER FUNCTION public.po__err(text)               SET search_path = pg_catalog, public;
ALTER FUNCTION public.po__hash(jsonb)             SET search_path = pg_catalog, public;
ALTER FUNCTION public.po__require(jsonb, text)    SET search_path = pg_catalog, public;
ALTER FUNCTION public.po__summary_text(jsonb)     SET search_path = pg_catalog, public;
