-- Rollback XCF-CW 01: ripristina po_send_begin di XCF-ORDINI 02 e toglie le RPC del worker.
DROP FUNCTION IF EXISTS public.po_worker_finish(text,uuid,text,jsonb,text);
DROP FUNCTION IF EXISTS public.po_worker_claim(text,text);
DROP FUNCTION IF EXISTS public.po__worker_auth(text);
CREATE OR REPLACE FUNCTION public.po_send_begin(p_token text, p_order_id uuid, p_idempotency_key text,
                                                p_summary_hash text, p_ack_duplicates boolean DEFAULT false,
                                                p_real_requested boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE a jsonb; o public.purchase_orders%ROWTYPE; v_at public.po_send_attempts%ROWTYPE; ch public.po_vendor_channels%ROWTYPE;
        v_dup jsonb; v_mode text; v_real_db boolean; v_payload jsonb; v_sum jsonb;
BEGIN
  a := public.po__auth(p_token);
  PERFORM public.po__require(a, 'admin');
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 OR length(p_idempotency_key) > 200 THEN
    PERFORM public.po__fail('INVALID_INPUT', 'idempotency_key');
  END IF;
  SELECT * INTO o FROM public.purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.po__fail('NOT_FOUND'); END IF;

  -- Idempotenza: stessa chiave = stesso risultato, mai un secondo invio.
  SELECT * INTO v_at FROM public.po_send_attempts WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_at.purchase_order_id <> o.id THEN PERFORM public.po__fail('IDEMPOTENCY_KEY_REUSED'); END IF;
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'attempt_id', v_at.id, 'state', v_at.state, 'mode', v_at.mode,
                              'channel', v_at.channel, 'result', v_at.result, 'order_status', o.status);
  END IF;
  -- Un tentativo reale rimasto 'pending' blocca per sempre (esito ignoto: va
  -- verificato a mano col fornitore); uno simulato blocca per 10 minuti.
  IF EXISTS (SELECT 1 FROM public.po_send_attempts WHERE purchase_order_id = o.id AND state = 'pending'
              AND (mode = 'real' OR created_at > now() - interval '10 minutes')) THEN
    PERFORM public.po__fail('IN_FLIGHT');
  END IF;

  v_dup := public.po__presend_checks(o, p_summary_hash, p_ack_duplicates, a);

  SELECT * INTO ch FROM public.po_vendor_channels WHERE vendor_name = o.vendor_name;
  v_real_db := coalesce((public.po__setting('real_send_enabled', 'false'::jsonb) #>> '{}')::boolean, false)
               AND coalesce(ch.real_send_allowed, false) AND ch.channel = 'email' AND ch.email_to IS NOT NULL
               AND NOT o.is_test;
  v_mode := CASE WHEN coalesce(p_real_requested, false) AND v_real_db THEN 'real' ELSE 'simulated' END;
  v_sum := public.po__summary(o.id);
  v_payload := jsonb_build_object(
    'channel', coalesce(ch.channel, 'manual'), 'to', ch.email_to, 'portal_url', ch.portal_url,
    'subject', 'Order — Zeno''s — ' || o.vendor_name || ' — delivery ' || coalesce(o.delivery_date::text, '-'),
    'body', public.po__summary_text(v_sum), 'summary_hash', o.confirmed_hash);

  INSERT INTO public.po_send_attempts (purchase_order_id, idempotency_key, summary_hash, mode, channel, state, payload,
                                       created_by, created_by_user_id, is_test, test_run_id)
  VALUES (o.id, p_idempotency_key, o.confirmed_hash, v_mode, coalesce(ch.channel, 'manual'), 'pending', v_payload,
          a->>'name', (a->>'user_id')::bigint, o.is_test, o.test_run_id)
  RETURNING * INTO v_at;
  PERFORM public.po__log(o.id, 'send_begin', o.status, o.status, a, jsonb_build_object('attempt_id', v_at.id, 'mode', v_mode,
                         'duplicates_acknowledged', CASE WHEN jsonb_array_length(v_dup->'items') > 0 THEN v_dup END));
  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'attempt_id', v_at.id, 'mode', v_mode,
                            'real_allowed_by_db', v_real_db, 'payload', v_payload, 'is_test', o.is_test);
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'PO:%' THEN RETURN public.po__err(SQLERRM); END IF; RAISE;
END $$;
REVOKE ALL ON FUNCTION public.po_send_begin(text,uuid,text,text,boolean,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.po_send_begin(text,uuid,text,text,boolean,boolean) TO service_role;
DELETE FROM public.po_settings WHERE key IN ('cw_worker_token_sha256','cw_queue_max_age_minutes');
DROP INDEX IF EXISTS public.po_send_attempts_queue_idx;
ALTER TABLE public.po_send_attempts DROP COLUMN IF EXISTS claimed_by, DROP COLUMN IF EXISTS claimed_at, DROP COLUMN IF EXISTS transport;
ALTER TABLE public.po_vendor_channels DROP CONSTRAINT IF EXISTS po_vendor_channels_transport_check;
ALTER TABLE public.po_vendor_channels DROP COLUMN IF EXISTS transport;
