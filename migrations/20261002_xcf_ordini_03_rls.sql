-- =====================================================================
-- XCF-ORDINI 03 — RLS su purchase_orders / purchase_order_lines
-- DA APPLICARE INSIEME AL RILASCIO DEL NUOVO FRONTEND (js/purchase-order.js
-- ramo xcf-ordini), NON PRIMA: il frontend attuale in produzione scrive con
-- la chiave anon direttamente sulle tabelle e smetterebbe di salvare.
-- Dopo questa migrazione l'unico accesso da anon/authenticated e' tramite
-- le RPC po_* (SECURITY DEFINER, sessione Brigade + ruolo).
-- Dipendenze verificate: nessuna view/funzione legge queste tabelle; unico
-- client = js/purchase-order.js. La migrazione fc02 le legge come postgres.
-- Rollback: migrations/rollback/20261002_xcf_ordini_03_rls_rollback.sql
-- =====================================================================
ALTER TABLE public.purchase_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;
-- Nessuna policy: anon/authenticated non leggono ne' scrivono direttamente.
REVOKE ALL ON public.purchase_orders, public.purchase_order_lines FROM anon, authenticated;
