-- =====================================================================
-- XCF-CW 01 (03/10/2026) — trasporto Chef's Warehouse: coda per il worker
-- del Mac Mini (workers/cw-order-sender). Solo additiva.
--
-- - po_vendor_channels.transport = 'cw_portal' abilita il canale portale CW.
-- - po_send_begin: un invio REALE verso un canale cw_portal resta 'pending'
--   con le righe strutturate nel payload; il worker lo prende UNA volta
--   (po_worker_claim) e chiude con po_worker_finish (sent | failed | uncertain).
-- - 'uncertain' (submit partito senza risposta certa) lascia l'invio
--   'pending': blocca ogni nuovo invio (IN_FLIGHT) finche' lo Chef non verifica.
-- - Token del worker: in DB solo lo sha256 (po_settings.cw_worker_token_sha256),
--   il token vive solo nel Portachiavi del Mac Mini.
-- - Invio reale ancora SPENTO: real_send_enabled=false, nessun canale con
--   transport impostato, env PO_REAL_SEND_ENABLED assente.
-- Rollback: migrations/rollback/20261003_xcf_cw_01_transport_rollback.sql
-- =====================================================================

ALTER TABLE public.po_vendor_channels ADD COLUMN IF NOT EXISTS transport text;
ALTER TABLE public.po_vendor_channels DROP CONSTRAINT IF EXISTS po_vendor_channels_transport_check;
ALTER TABLE public.po_vendor_channels ADD CONSTRAINT po_vendor_channels_transport_check
  CHECK (transport IS NULL OR transport = ANY (ARRAY['cw_portal']::text[]));

ALTER TABLE public.po_send_attempts ADD COLUMN IF NOT EXISTS transport  text;
ALTER TABLE public.po_send_attempts ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE public.po_send_attempts ADD COLUMN IF NOT EXISTS claimed_by text;
CREATE INDEX IF NOT EXISTS po_send_attempts_queue_idx
  ON public.po_send_attempts (transport, created_at) WHERE state = 'pending' AND mode = 'real';

INSERT INTO public.po_settings (key, value, note) VALUES
  ('cw_worker_token_sha256', 'null'::jsonb, 'sha256 del token del worker CW (Mac Mini). Il token vive solo nel Portachiavi.'),
  ('cw_queue_max_age_minutes', '20'::jsonb, 'Un invio CW in coda piu'' vecchio di cosi'' non parte: va richiesto di nuovo.')
ON CONFLICT (key) DO NOTHING;

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
               AND coalesce(ch.real_send_allowed, false)
               AND ((ch.channel = 'email' AND ch.email_to IS NOT NULL)
                    OR (ch.channel = 'portal' AND ch.transport = 'cw_portal'))
               AND NOT o.is_test;
  v_mode := CASE WHEN coalesce(p_real_requested, false) AND v_real_db THEN 'real' ELSE 'simulated' END;
  v_sum := public.po__summary(o.id);
  v_payload := jsonb_build_object(
    'channel', coalesce(ch.channel, 'manual'), 'to', ch.email_to, 'portal_url', ch.portal_url,
    'subject', 'Order — Zeno''s — ' || o.vendor_name || ' — delivery ' || coalesce(o.delivery_date::text, '-'),
    'body', public.po__summary_text(v_sum), 'summary_hash', o.confirmed_hash,
    'transport', ch.transport, 'delivery_date', o.delivery_date,
    'lines', coalesce((SELECT jsonb_agg(jsonb_build_object('line_id', l->>'line_id', 'vendor_sku', l->>'vendor_sku',
                         'quantity', (l->>'quantity')::numeric, 'unit', l->>'unit', 'name', l->>'name')
                         ORDER BY (l->>'position')::int) FROM jsonb_array_elements(v_sum->'lines') l), '[]'::jsonb));

  INSERT INTO public.po_send_attempts (purchase_order_id, idempotency_key, summary_hash, mode, channel, state, payload,
                                       created_by, created_by_user_id, is_test, test_run_id, transport)
  VALUES (o.id, p_idempotency_key, o.confirmed_hash, v_mode, coalesce(ch.channel, 'manual'), 'pending', v_payload,
          a->>'name', (a->>'user_id')::bigint, o.is_test, o.test_run_id,
          CASE WHEN v_mode = 'real' THEN ch.transport END)
  RETURNING * INTO v_at;
  PERFORM public.po__log(o.id, 'send_begin', o.status, o.status, a, jsonb_build_object('attempt_id', v_at.id, 'mode', v_mode,
                         'duplicates_acknowledged', CASE WHEN jsonb_array_length(v_dup->'items') > 0 THEN v_dup END));
  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'attempt_id', v_at.id, 'mode', v_mode,
                            'real_allowed_by_db', v_real_db, 'payload', v_payload, 'is_test', o.is_test);
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'PO:%' THEN RETURN public.po__err(SQLERRM); END IF; RAISE;
END $$;


-- ── worker CW: autenticazione col token (solo hash in DB) ─────────────
CREATE OR REPLACE FUNCTION public.po__worker_auth(p_worker_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
DECLARE v_hash text := public.po__setting('cw_worker_token_sha256', 'null'::jsonb) #>> '{}';
BEGIN
  IF v_hash IS NULL OR p_worker_token IS NULL OR length(p_worker_token) < 32
     OR encode(sha256(convert_to(p_worker_token, 'UTF8')), 'hex') <> v_hash THEN
    PERFORM public.po__fail('AUTH_ERROR', 'worker_token');
  END IF;
END $$;

-- ── worker CW: prende UN invio reale in coda (una sola volta) ─────────
CREATE OR REPLACE FUNCTION public.po_worker_claim(p_worker_token text, p_worker_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_at public.po_send_attempts%ROWTYPE; o public.purchase_orders%ROWTYPE; v_now_hash text;
        v_max int := coalesce((public.po__setting('cw_queue_max_age_minutes', '20'::jsonb) #>> '{}')::int, 20);
        a jsonb;
BEGIN
  PERFORM public.po__worker_auth(p_worker_token);
  LOOP
    SELECT * INTO v_at FROM public.po_send_attempts
     WHERE state = 'pending' AND mode = 'real' AND transport = 'cw_portal' AND claimed_at IS NULL
     ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'job', null); END IF;
    SELECT * INTO o FROM public.purchase_orders WHERE id = v_at.purchase_order_id FOR UPDATE;
    a := jsonb_build_object('name', 'cw-order-sender', 'user_id', null);
    v_now_hash := public.po__hash(public.po__summary(o.id));
    -- Ricontrollo al momento dell'invio: stesso ordine confermato, stesso hash, non scaduto in coda.
    IF v_at.created_at < now() - make_interval(mins => v_max) THEN
      PERFORM public.po_send_finish(v_at.id, 'failed', jsonb_build_object('transmitted', false, 'error', 'QUEUE_EXPIRED',
              'detail', 'in coda da troppo tempo: nulla inviato, va richiesto di nuovo', 'at', now()));
    ELSIF o.status <> 'confirmed' OR o.confirmed_hash IS DISTINCT FROM v_at.summary_hash OR v_now_hash <> v_at.summary_hash THEN
      PERFORM public.po_send_finish(v_at.id, 'failed', jsonb_build_object('transmitted', false, 'error', 'CONFIRMATION_STALE',
              'order_status', o.status, 'at', now()));
    ELSE
      UPDATE public.po_send_attempts SET claimed_at = now(), claimed_by = left(coalesce(p_worker_id, 'worker'), 80)
       WHERE id = v_at.id;
      PERFORM public.po__log(o.id, 'send_claimed', o.status, o.status, a,
                             jsonb_build_object('attempt_id', v_at.id, 'worker', p_worker_id));
      RETURN jsonb_build_object('ok', true, 'job', jsonb_build_object(
        'attempt_id', v_at.id, 'order_id', o.id, 'vendor', o.vendor_name, 'summary_hash', v_at.summary_hash,
        'idempotency_key', v_at.idempotency_key, 'payload', v_at.payload));
    END IF;
  END LOOP;
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'PO:%' THEN RETURN public.po__err(SQLERRM); END IF; RAISE;
END $$;

-- ── worker CW: esito ──────────────────────────────────────────────────
-- sent      = CW ha confermato (numero ordine obbligatorio)
-- failed    = provato che NULLA e' stato inviato (fermo prima del submit, o submit rifiutato)
-- uncertain = submit partito senza esito certo: resta 'pending' (blocca nuovi invii), lo Chef verifica
CREATE OR REPLACE FUNCTION public.po_worker_finish(p_worker_token text, p_attempt_id uuid, p_outcome text,
                                                   p_result jsonb, p_vendor_order_number text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_at public.po_send_attempts%ROWTYPE; o public.purchase_orders%ROWTYPE; v_fin jsonb; a jsonb;
BEGIN
  PERFORM public.po__worker_auth(p_worker_token);
  SELECT * INTO v_at FROM public.po_send_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.po__fail('NOT_FOUND'); END IF;
  IF v_at.transport IS DISTINCT FROM 'cw_portal' OR v_at.mode <> 'real' THEN PERFORM public.po__fail('INVALID_STATE', 'not_cw_real'); END IF;
  IF v_at.claimed_at IS NULL THEN PERFORM public.po__fail('INVALID_STATE', 'not_claimed'); END IF;
  IF v_at.state <> 'pending' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'state', v_at.state);
  END IF;
  a := jsonb_build_object('name', 'cw-order-sender', 'user_id', null);
  IF p_outcome = 'sent' THEN
    IF nullif(btrim(coalesce(p_vendor_order_number, '')), '') IS NULL THEN
      PERFORM public.po__fail('INVALID_INPUT', 'vendor_order_number');
    END IF;
    v_fin := public.po_send_finish(v_at.id, 'sent', coalesce(p_result, '{}'::jsonb));
    UPDATE public.purchase_orders SET vendor_order_number = btrim(p_vendor_order_number), channel = 'portal', updated_at = now()
     WHERE id = v_at.purchase_order_id;
  ELSIF p_outcome = 'failed' THEN
    v_fin := public.po_send_finish(v_at.id, 'failed', coalesce(p_result, '{}'::jsonb));
  ELSIF p_outcome = 'uncertain' THEN
    UPDATE public.po_send_attempts SET result = coalesce(p_result, '{}'::jsonb) || jsonb_build_object('uncertain', true)
     WHERE id = v_at.id;
    SELECT * INTO o FROM public.purchase_orders WHERE id = v_at.purchase_order_id;
    PERFORM public.po__log(o.id, 'send_uncertain', o.status, o.status, a, jsonb_build_object('attempt_id', v_at.id, 'result', p_result));
    v_fin := jsonb_build_object('ok', true, 'state', 'pending', 'uncertain', true);
  ELSE
    PERFORM public.po__fail('INVALID_INPUT', 'outcome');
  END IF;
  RETURN v_fin;
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'PO:%' THEN RETURN public.po__err(SQLERRM); END IF; RAISE;
END $$;

REVOKE ALL ON FUNCTION public.po__worker_auth(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.po__worker_auth(text) TO service_role;
REVOKE ALL ON FUNCTION public.po_send_begin(text,uuid,text,text,boolean,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.po_send_begin(text,uuid,text,text,boolean,boolean) TO service_role;
-- Il worker chiama con la chiave anon + il suo token (verificato in po__worker_auth).
REVOKE ALL ON FUNCTION public.po_worker_claim(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.po_worker_claim(text,text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.po_worker_finish(text,uuid,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.po_worker_finish(text,uuid,text,jsonb,text) TO anon, authenticated, service_role;
