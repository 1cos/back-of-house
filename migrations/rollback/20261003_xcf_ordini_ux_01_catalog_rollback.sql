-- Rollback XCF-ORDINI-UX 01
DROP FUNCTION IF EXISTS public.po_vendor_list(text);
DROP FUNCTION IF EXISTS public.po_vendor_catalog(text, text);
DROP FUNCTION IF EXISTS public.po__next_deliveries(int[], int, date);
DELETE FROM public.po_vendor_channels WHERE vendor_name = 'Global Gourmet Foods' AND updated_by = 'XCF-ORDINI-UX 01';
ALTER TABLE public.po_vendor_channels DROP CONSTRAINT IF EXISTS po_vendor_channels_order_view_check;
ALTER TABLE public.po_vendor_channels DROP CONSTRAINT IF EXISTS po_vendor_channels_calendar_source_check;
ALTER TABLE public.po_vendor_channels DROP COLUMN IF EXISTS order_view, DROP COLUMN IF EXISTS calendar_note,
  DROP COLUMN IF EXISTS calendar_source, DROP COLUMN IF EXISTS order_lead_days, DROP COLUMN IF EXISTS delivery_weekdays;
