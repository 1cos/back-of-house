-- Rollback XCF-ORDINI 03: ripristina lo stato precedente (RLS off, privilegi
-- diretti di anon/authenticated come prima del 02/10/2026).
ALTER TABLE public.purchase_orders      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_lines DISABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON public.purchase_orders, public.purchase_order_lines TO anon, authenticated;
