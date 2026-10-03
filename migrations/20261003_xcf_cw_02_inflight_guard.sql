-- =====================================================================
-- XCF-CW 02 (03/10/2026) — niente modifica/annullo durante un invio reale.
--
-- Il worker CW invia il payload fissato a po_send_begin. Se nel frattempo
-- l'ordine tornasse bozza (modifica) o venisse annullato, CW riceverebbe la
-- versione vecchia mentre Brigade mostrerebbe quella nuova.
-- Regola: con un invio REALE 'pending' e NON incerto, un ordine 'confirmed'
-- non puo' passare a 'draft' ne' a 'cancelled' (errore PO:IN_FLIGHT, che le
-- RPC po_* restituiscono come { ok:false, reason:'IN_FLIGHT' }).
-- Esito incerto: annullare resta possibile (Max ha verificato su CW), la
-- modifica no.
-- Rollback: DROP TRIGGER trg_po_inflight_guard ON public.purchase_orders;
--           DROP FUNCTION public.po__inflight_guard();
-- =====================================================================
CREATE OR REPLACE FUNCTION public.po__inflight_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.status = 'confirmed' AND NEW.status = ANY (ARRAY['draft','cancelled']) THEN
    IF EXISTS (SELECT 1 FROM public.po_send_attempts a
                WHERE a.purchase_order_id = OLD.id AND a.mode = 'real' AND a.state = 'pending'
                  AND (NEW.status = 'draft' OR coalesce((a.result->>'uncertain')::boolean, false) = false)) THEN
      RAISE EXCEPTION 'PO:IN_FLIGHT|%', 'invio reale in corso';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_po_inflight_guard ON public.purchase_orders;
CREATE TRIGGER trg_po_inflight_guard BEFORE UPDATE OF status ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.po__inflight_guard();

REVOKE ALL ON FUNCTION public.po__inflight_guard() FROM PUBLIC, anon, authenticated;
