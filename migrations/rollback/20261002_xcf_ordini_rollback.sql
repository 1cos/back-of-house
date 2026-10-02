-- Rollback XCF-ORDINI 01 + 02 (applicare DOPO il rollback della 03 se applicata).
-- ATTENZIONE: cancella storico ordini (eventi, tentativi, invii manuali,
-- bozze reclamo) e le colonne nuove. Gli ordini in stati nuovi vengono
-- riportati a 'sent' (inviati) o 'draft' prima di ripristinare il CHECK.
BEGIN;
DO $$
DECLARE f text;
BEGIN
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND (p.proname LIKE 'po\_\_%' OR p.proname LIKE 'po\_%')
              AND p.proname IN ('po__fail','po__err','po__setting','po__today','po__auth','po__require','po__log',
                'po__vendor_doc_names','po__eval_line','po__summary','po__hash','po__duplicates','po__order_json',
                'po__presend_checks','po__summary_text','po__dno','po_send_begin','po_send_finish','po_list','po_get',
                'po_home_counts','po_save_draft','po_mark_ready','po_confirm','po_register_manual_send',
                'po_register_external_send','po_confirmation_candidates','po_link_confirmation','po_receive','po_cancel')
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || f || ' CASCADE';
  END LOOP;
END $$;

DROP TABLE IF EXISTS public.po_complaint_drafts, public.po_events, public.po_manual_sends,
                     public.po_send_attempts, public.po_vendor_channels, public.po_settings;

UPDATE public.purchase_orders SET status = 'sent'  WHERE status IN ('sent_manual','acknowledged','received');
UPDATE public.purchase_orders SET status = 'draft' WHERE status = 'confirmed';
ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_status_check
  CHECK (status = ANY (ARRAY['draft','ready','sent','cancelled']::text[]));
ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_send_mode_check;
ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_simulated_only_test;
ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_vendor_document_fk;
DROP INDEX IF EXISTS public.purchase_orders_send_idem_uq;
DROP INDEX IF EXISTS public.purchase_orders_vendor_document_uq;
DROP INDEX IF EXISTS public.purchase_orders_vendor_status_idx;
DROP INDEX IF EXISTS public.purchase_order_lines_order_idx;
ALTER TABLE public.purchase_orders
  DROP COLUMN IF EXISTS delivery_date, DROP COLUMN IF EXISTS channel, DROP COLUMN IF EXISTS revision,
  DROP COLUMN IF EXISTS summary_json, DROP COLUMN IF EXISTS summary_hash, DROP COLUMN IF EXISTS ready_at,
  DROP COLUMN IF EXISTS ready_by, DROP COLUMN IF EXISTS confirmed_hash, DROP COLUMN IF EXISTS confirmed_at,
  DROP COLUMN IF EXISTS confirmed_by, DROP COLUMN IF EXISTS confirmed_by_user_id, DROP COLUMN IF EXISTS sent_at,
  DROP COLUMN IF EXISTS sent_by, DROP COLUMN IF EXISTS send_mode, DROP COLUMN IF EXISTS send_idempotency_key,
  DROP COLUMN IF EXISTS vendor_order_number, DROP COLUMN IF EXISTS vendor_document_id, DROP COLUMN IF EXISTS acknowledged_at,
  DROP COLUMN IF EXISTS acknowledged_by, DROP COLUMN IF EXISTS received_at, DROP COLUMN IF EXISTS received_by,
  DROP COLUMN IF EXISTS cancelled_at, DROP COLUMN IF EXISTS cancelled_by, DROP COLUMN IF EXISTS cancel_reason,
  DROP COLUMN IF EXISTS created_by_user_id, DROP COLUMN IF EXISTS is_test, DROP COLUMN IF EXISTS test_run_id;
ALTER TABLE public.purchase_order_lines DROP CONSTRAINT IF EXISTS purchase_order_lines_line_status_check;
ALTER TABLE public.purchase_order_lines DROP CONSTRAINT IF EXISTS purchase_order_lines_received_status_check;
ALTER TABLE public.purchase_order_lines
  DROP COLUMN IF EXISTS position, DROP COLUMN IF EXISTS pack_description, DROP COLUMN IF EXISTS ingredient_vendor_id,
  DROP COLUMN IF EXISTS needs_review, DROP COLUMN IF EXISTS line_status, DROP COLUMN IF EXISTS issues,
  DROP COLUMN IF EXISTS reference_price, DROP COLUMN IF EXISTS reference_price_unit, DROP COLUMN IF EXISTS reference_price_date,
  DROP COLUMN IF EXISTS price_stale, DROP COLUMN IF EXISTS received_status, DROP COLUMN IF EXISTS received_qty,
  DROP COLUMN IF EXISTS received_note, DROP COLUMN IF EXISTS received_photo_url, DROP COLUMN IF EXISTS received_at,
  DROP COLUMN IF EXISTS received_by;
COMMIT;
