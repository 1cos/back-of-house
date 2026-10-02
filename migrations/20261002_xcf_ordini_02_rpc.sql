-- =====================================================================
-- XCF-ORDINI 02 — RPC del flusso "Compila Ordine"
-- richiesta -> righe verificate -> bozza -> riepilogo (hash) -> conferma
-- Max -> invio (edge send-purchase-order, simulazione di default) | invio
-- manuale registrato -> conferma fornitore -> ricevimento (+ bozza reclamo).
--
-- Tutte SECURITY DEFINER, sessione Brigade opaca (brigade_validate_session).
-- Ogni RPC che scrive e' atomica: un errore applicativo viene sollevato come
-- eccezione 'PO:<CODICE>|<dettaglio>' e intercettata nel blocco esterno,
-- quindi tutte le scritture del tentativo vengono annullate.
-- Rollback: migrations/rollback/20261002_xcf_ordini_rollback.sql
-- =====================================================================

-- ── helper: errore applicativo ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.po__fail(p_code text, p_detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'PO:%|%', p_code, coalesce(p_detail, '');
END $$;

CREATE OR REPLACE FUNCTION public.po__err(p_sqlerrm text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v text := substr(p_sqlerrm, 4); v_code text; v_detail text;
BEGIN
  v_code := split_part(v, '|', 1);
  v_detail := substr(v, length(v_code) + 2);
  BEGIN
    RETURN jsonb_build_object('ok', false, 'reason', v_code, 'detail', v_detail::jsonb);
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'reason', v_code, 'detail', nullif(v_detail, ''));
  END;
END $$;

-- ── helper: impostazioni ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.po__setting(p_key text, p_default jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((SELECT value FROM public.po_settings WHERE key = p_key), p_default);
$$;

CREATE OR REPLACE FUNCTION public.po__today()
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT (now() AT TIME ZONE (public.po__setting('timezone', '"America/Chicago"'::jsonb) #>> '{}'))::date;
$$;

-- ── helper: autenticazione + ruoli ────────────────────────────────────
-- Ritorna {user_id, name, is_admin, can_compile}; solleva PO:AUTH_ERROR.
CREATE OR REPLACE FUNCTION public.po__auth(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
DECLARE v jsonb; v_uid bigint; v_admin boolean; v_compilers jsonb;
BEGIN
  IF p_token IS NULL OR length(p_token) <> 64 THEN
    PERFORM public.po__fail('AUTH_ERROR', 'invalid_token');
  END IF;
  v := public.brigade_validate_session(p_token);
  IF NOT coalesce((v->>'ok')::boolean, false) THEN
    PERFORM public.po__fail('AUTH_ERROR', coalesce(v->>'error', 'session_invalid'));
  END IF;
  v_uid   := (v->'user'->>'id')::bigint;
  v_admin := coalesce((v->'user'->>'is_admin')::boolean, false) OR (v->'user'->>'role') = 'admin';
  v_compilers := public.po__setting('compiler_user_ids', '[]'::jsonb);
  RETURN jsonb_build_object(
    'user_id', v_uid,
    'name', v->'user'->>'name',
    'is_admin', v_admin,
    'can_compile', v_admin OR (v_compilers @> to_jsonb(v_uid))
  );
END $$;

CREATE OR REPLACE FUNCTION public.po__require(p_auth jsonb, p_level text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_level = 'admin' AND NOT (p_auth->>'is_admin')::boolean THEN
    PERFORM public.po__fail('FORBIDDEN', 'solo_admin');
  ELSIF p_level = 'compile' AND NOT (p_auth->>'can_compile')::boolean THEN
    PERFORM public.po__fail('FORBIDDEN', 'non_autorizzato');
  END IF;
END $$;

-- ── helper: storico ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.po__log(p_order uuid, p_event text, p_from text, p_to text,
                                          p_auth jsonb, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  INSERT INTO public.po_events (purchase_order_id, event, from_status, to_status, actor, actor_user_id, detail, is_test)
  SELECT p_order, p_event, p_from, p_to, p_auth->>'name', (p_auth->>'user_id')::bigint, coalesce(p_detail, '{}'::jsonb),
         coalesce((SELECT is_test FROM public.purchase_orders WHERE id = p_order), false);
$$;

-- ── helper: nomi fornitore usati nei documenti (conferme) ─────────────
CREATE OR REPLACE FUNCTION public.po__vendor_doc_names(p_vendor text)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT array(SELECT DISTINCT lower(x) FROM unnest(
    array[p_vendor] || coalesce((SELECT document_vendor_names FROM public.po_vendor_channels WHERE vendor_name = p_vendor), '{}'::text[])
  ) x WHERE x IS NOT NULL);
$$;

-- ── valutazione di una riga (pura lettura: ritorna i campi calcolati) ──
-- Bloccanti: LINE_EMPTY, QTY_MISSING, UNIT_MISSING (confezione), AMBIGUOUS,
-- DO_NOT_ORDER. Avvisi: NO_PRODUCT, PRICE_MISSING, PRICE_STALE.
CREATE OR REPLACE FUNCTION public.po__eval_line(p_vendor text, p_line jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_issues jsonb := '[]'::jsonb;
  v_ing uuid := nullif(p_line->>'ingredient_id', '')::uuid;
  v_qty numeric;
  v_unit text := nullif(btrim(coalesce(p_line->>'unit', '')), '');
  v_text text := nullif(btrim(coalesce(p_line->>'requested_text', '')), '');
  v_needs boolean := coalesce((p_line->>'needs_review')::boolean, false);
  v_iv_id uuid; v_iv_pack text; v_iv_unit_price numeric; v_iv_each numeric; v_iv_unit text;
  v_dno_reason text; v_dno_found boolean;
  v_stale_days int := (public.po__setting('price_stale_days', '30'::jsonb) #>> '{}')::int;
  v_price numeric; v_price_unit text; v_price_date date; v_stale boolean; v_age int;
  v_status text;
  v_names text[] := public.po__vendor_doc_names(p_vendor);
BEGIN
  BEGIN v_qty := nullif(p_line->>'quantity', '')::numeric; EXCEPTION WHEN others THEN v_qty := NULL; END;

  IF v_text IS NULL AND v_ing IS NULL THEN
    v_issues := v_issues || jsonb_build_object('code', 'LINE_EMPTY', 'blocking', true, 'msg', 'Riga vuota');
  END IF;
  IF v_qty IS NULL OR v_qty <= 0 THEN
    v_issues := v_issues || jsonb_build_object('code', 'QTY_MISSING', 'blocking', true, 'msg', 'Quantita'' mancante');
  END IF;
  IF v_unit IS NULL THEN
    v_issues := v_issues || jsonb_build_object('code', 'UNIT_MISSING', 'blocking', true, 'msg', 'Confezione/unita'' mancante');
  END IF;
  IF v_needs THEN
    v_issues := v_issues || jsonb_build_object('code', 'AMBIGUOUS', 'blocking', true, 'msg', 'Prodotto da chiarire');
  END IF;

  IF v_ing IS NULL THEN
    IF NOT v_needs THEN
      v_issues := v_issues || jsonb_build_object('code', 'NO_PRODUCT', 'blocking', false, 'msg', 'Riga manuale, senza prodotto/SKU');
    END IF;
  ELSE
    -- do_not_order: qualsiasi riga del catalogo fornitore per questo ingrediente
    SELECT true, iv.do_not_order_reason INTO v_dno_found, v_dno_reason
      FROM public.ingredient_vendors iv
     WHERE iv.ingredient_id = v_ing AND lower(iv.vendor) = ANY (v_names) AND iv.do_not_order = true
     LIMIT 1;
    IF coalesce(v_dno_found, false) THEN
      v_issues := v_issues || jsonb_build_object('code', 'DO_NOT_ORDER', 'blocking', true,
                    'msg', 'Prodotto marcato "non ordinare"' || coalesce(': ' || v_dno_reason, ''));
    END IF;

    -- Data del prezzo = SOLO l'ultima fattura (updated_at cambia per qualsiasi
    -- modifica e farebbe sembrare fresco un prezzo vecchio).
    SELECT iv.id, iv.unit_price, iv.price_per_each, iv.purchase_unit, iv.pack_description,
           iv.last_invoice_date
      INTO v_iv_id, v_iv_unit_price, v_iv_each, v_iv_unit, v_iv_pack, v_price_date
      FROM public.ingredient_vendors iv
     WHERE iv.ingredient_id = v_ing AND lower(iv.vendor) = ANY (v_names) AND iv.active = true
       AND coalesce(iv.do_not_order, false) = false
     ORDER BY (iv.vendor_sku IS NOT DISTINCT FROM nullif(p_line->>'vendor_sku', '')) DESC,
              iv.last_invoice_date DESC NULLS LAST
     LIMIT 1;
    IF v_iv_id IS NOT NULL THEN
      v_price := coalesce(v_iv_unit_price, v_iv_each);
      v_price_unit := CASE WHEN v_iv_unit_price IS NOT NULL THEN coalesce(v_iv_unit, 'case') ELSE 'each' END;
    END IF;
    IF v_price IS NULL THEN
      v_issues := v_issues || jsonb_build_object('code', 'PRICE_MISSING', 'blocking', false, 'msg', 'Nessun prezzo di riferimento');
    ELSE
      v_age := public.po__today() - v_price_date;
      v_stale := v_price_date IS NULL OR v_age > v_stale_days;
      IF v_stale THEN
        v_issues := v_issues || jsonb_build_object('code', 'PRICE_STALE', 'blocking', false,
                      'msg', 'Prezzo di riferimento vecchio (' || coalesce(v_age::text || ' giorni', 'data sconosciuta') || ')',
                      'age_days', v_age, 'limit_days', v_stale_days);
      END IF;
    END IF;
  END IF;

  v_status := CASE
    WHEN v_issues @> '[{"code":"DO_NOT_ORDER"}]' THEN 'blocked'
    WHEN v_issues @> '[{"code":"AMBIGUOUS"}]'    THEN 'ambiguous'
    WHEN v_issues @> '[{"blocking":true}]'       THEN 'incomplete'
    WHEN jsonb_array_length(v_issues) > 0        THEN 'warning'
    ELSE 'ok' END;

  RETURN jsonb_build_object(
    'line_status', v_status, 'issues', v_issues,
    'quantity', v_qty, 'unit', v_unit, 'requested_text', v_text, 'ingredient_id', v_ing,
    'ingredient_vendor_id', v_iv_id,
    'pack_description', coalesce(nullif(p_line->>'pack_description', ''), v_iv_pack),
    'reference_price', v_price, 'reference_price_unit', v_price_unit,
    'reference_price_date', v_price_date, 'price_stale', v_stale
  );
END $$;

-- ── riepilogo canonico + hash (base della conferma di Max) ────────────
CREATE OR REPLACE FUNCTION public.po__summary(p_order uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object(
    'order_id', o.id, 'vendor', o.vendor_name, 'delivery_date', o.delivery_date,
    'channel', coalesce(o.channel, (SELECT channel FROM public.po_vendor_channels WHERE vendor_name = o.vendor_name), 'manual'),
    'revision', o.revision, 'notes', o.notes, 'is_test', o.is_test,
    'lines', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'line_id', l.id, 'position', l.position, 'ingredient_id', l.ingredient_id, 'vendor_sku', l.vendor_sku,
        'name', coalesce(l.matched_name, l.requested_text), 'requested_text', l.requested_text,
        'quantity', l.quantity, 'unit', l.unit, 'pack_description', l.pack_description,
        'reference_price', l.reference_price, 'reference_price_unit', l.reference_price_unit,
        'reference_price_date', l.reference_price_date, 'price_stale', l.price_stale,
        'line_status', l.line_status, 'issues', l.issues
      ) ORDER BY l.position, l.created_at, l.id)
      FROM public.purchase_order_lines l WHERE l.purchase_order_id = o.id), '[]'::jsonb)
  )
  FROM public.purchase_orders o WHERE o.id = p_order;
$$;

CREATE OR REPLACE FUNCTION public.po__hash(p_summary jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(p_summary::text, 'UTF8')), 'hex');
$$;

-- ── sospetti doppioni (altri ordini inviati, invii manuali, conferme) ──
CREATE OR REPLACE FUNCTION public.po__duplicates(p_order uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  o public.purchase_orders%ROWTYPE;
  v_hours int := (public.po__setting('duplicate_window_hours', '48'::jsonb) #>> '{}')::int;
  v_since timestamptz := now() - make_interval(hours => v_hours);
  v_names text[];
  v_out jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO o FROM public.purchase_orders WHERE id = p_order;
  v_names := public.po__vendor_doc_names(o.vendor_name);

  v_out := v_out || coalesce((SELECT jsonb_agg(jsonb_build_object('kind', 'purchase_order', 'id', x.id, 'at', x.sent_at,
                       'detail', x.status || coalesce(' #' || x.vendor_order_number, '')))
    FROM public.purchase_orders x
   WHERE lower(x.vendor_name) = ANY (v_names) AND x.id <> o.id AND x.is_test = o.is_test
     AND x.status = ANY (ARRAY['sent','sent_manual','acknowledged','received']) AND x.sent_at >= v_since), '[]'::jsonb);

  v_out := v_out || coalesce((SELECT jsonb_agg(jsonb_build_object('kind', 'manual_send', 'id', m.id, 'at', m.sent_at,
                       'detail', coalesce(m.channel, '') || coalesce(' #' || m.vendor_order_number, '') || coalesce(' — ' || m.note, '')))
    FROM public.po_manual_sends m
   WHERE lower(m.vendor_name) = ANY (v_names) AND m.purchase_order_id IS DISTINCT FROM o.id
     AND m.is_test = o.is_test AND m.sent_at >= v_since), '[]'::jsonb);

  -- Conferme d'ordine arrivate per email (ordini fatti a mano/portale/rappresentante).
  v_out := v_out || coalesce((SELECT jsonb_agg(jsonb_build_object('kind', 'vendor_confirmation', 'id', d.id, 'at', d.created_at,
                       'detail', 'conferma #' || coalesce(d.document_number, '?')))
    FROM public.vendor_documents d
   WHERE d.document_type = 'order_confirmation' AND lower(d.vendor) = ANY (v_names) AND d.created_at >= v_since
     AND NOT EXISTS (SELECT 1 FROM public.purchase_orders x WHERE x.vendor_document_id = d.id)), '[]'::jsonb);

  RETURN jsonb_build_object('window_hours', v_hours, 'items', v_out);
END $$;

-- ── lettura: ordine completo ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.po__order_json(p_order uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT to_jsonb(o) - 'summary_json' || jsonb_build_object(
    'lines', coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.position, l.created_at, l.id)
                         FROM public.purchase_order_lines l WHERE l.purchase_order_id = o.id), '[]'::jsonb),
    'channel_info', (SELECT to_jsonb(c) FROM public.po_vendor_channels c WHERE c.vendor_name = o.vendor_name),
    'events', coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at, e.id)
                          FROM public.po_events e WHERE e.purchase_order_id = o.id), '[]'::jsonb),
    'send_attempts', coalesce((SELECT jsonb_agg(to_jsonb(a) - 'payload' ORDER BY a.created_at)
                          FROM public.po_send_attempts a WHERE a.purchase_order_id = o.id), '[]'::jsonb),
    'complaint_drafts', coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at)
                          FROM public.po_complaint_drafts c WHERE c.purchase_order_id = o.id), '[]'::jsonb),
    'summary', o.summary_json,
    'summary_valid', o.summary_hash IS NOT NULL AND o.summary_hash = public.po__hash(public.po__summary(o.id)),
    'confirmation_valid', o.confirmed_hash IS NOT NULL AND o.confirmed_hash = public.po__hash(public.po__summary(o.id))
  )
  FROM public.purchase_orders o WHERE o.id = p_order;
$$;

CREATE OR REPLACE FUNCTION public.po_list(p_token text, p_include_closed boolean DEFAULT false, p_include_test boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE a jsonb;
BEGIN
  a := public.po__auth(p_token);
  PERFORM public.po__require(a, 'compile');
  RETURN jsonb_build_object('ok', true, 'me', a,
    'settings', jsonb_build_object(
      'price_stale_days', public.po__setting('price_stale_days', '30'::jsonb),
      'duplicate_window_hours', public.po__setting('duplicate_window_hours', '48'::jsonb),
      'real_send_enabled', public.po__setting('real_send_enabled', 'false'::jsonb)),
    'orders', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', o.id, 'vendor_name', o.vendor_name, 'status', o.status, 'created_by', o.created_by,
        'created_at', o.created_at, 'updated_at', o.updated_at, 'delivery_date', o.delivery_date,
        'revision', o.revision, 'is_test', o.is_test, 'sent_at', o.sent_at, 'send_mode', o.send_mode,
        'vendor_order_number', o.vendor_order_number,
        'line_count', (SELECT count(*) FROM public.purchase_order_lines l WHERE l.purchase_order_id = o.id),
        'blocking_count', (SELECT count(*) FROM public.purchase_order_lines l WHERE l.purchase_order_id = o.id
                             AND l.line_status = ANY (ARRAY['incomplete','ambiguous','blocked'])),
        'confirmation_valid', o.confirmed_hash IS NOT NULL AND o.confirmed_hash = public.po__hash(public.po__summary(o.id))
      ) ORDER BY o.created_at DESC)
      FROM public.purchase_orders o
     WHERE (p_include_test OR o.is_test = false)
       AND (p_include_closed OR o.status <> ALL (ARRAY['received','cancelled'])
            OR o.updated_at > now() - interval '3 days')), '[]'::jsonb));
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'PO:%' THEN RETURN public.po__err(SQLERRM); END IF; RAISE;
END $$;

CREATE OR REPLACE FUNCTION public.po_get(p_token text, p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE a jsonb; v jsonb; o public.purchase_orders%ROWTYPE;
BEGIN
  a := public.po__auth(p_token);
  PERFORM public.po__require(a, 'compile');
  SELECT * INTO o FROM public.purchase_orders WHERE id = p_order_id;
  IF NOT FOUND THEN PERFORM public.po__fail('NOT_FOUND'); END IF;
  v := public.po__order_json(p_order_id);
  IF o.status = ANY (ARRAY['ready','confirmed']) THEN
    v := v || jsonb_build_object('duplicates', public.po__duplicates(p_order_id));
  END IF;
  RETURN jsonb_build_object('ok', true, 'me', a, 'order', v);
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'PO:%' THEN RETURN public.po__err(SQLERRM); END IF; RAISE;
END $$;

CREATE OR REPLACE FUNCTION public.po_home_counts(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE a jsonb;
BEGIN
  a := public.po__auth(p_token);
  PERFORM public.po__require(a, 'compile');
  RETURN jsonb_build_object('ok', true,
    'draft_lines_by_vendor', coalesce((SELECT jsonb_object_agg(vendor_name, n) FROM (
        SELECT o.vendor_name, count(l.id) n FROM public.purchase_orders o
          JOIN public.purchase_order_lines l ON l.purchase_order_id = o.id
         WHERE o.status = 'draft' AND o.is_test = false GROUP BY o.vendor_name) x), '{}'::jsonb),
    'awaiting_confirmation', (SELECT count(*) FROM public.purchase_orders WHERE status = 'ready' AND is_test = false),
    'awaiting_send', (SELECT count(*) FROM public.purchase_orders WHERE status = 'confirmed' AND is_test = false),
    'awaiting_receipt', (SELECT count(*) FROM public.purchase_orders WHERE status = ANY (ARRAY['sent','sent_manual','acknowledged']) AND is_test = false));
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'PO:%' THEN RETURN public.po__err(SQLERRM); END IF; RAISE;
END $$;

-- ── scrittura: salva bozza (transazionale, multi-fornitore) ───────────
-- p_payload = { groups: [ { order_id?, expected_revision?, vendor_name, delivery_date?, notes?,
--               mode: 'replace'|'append', lines: [ {requested_text, ingredient_id, matched_name,
--               vendor_sku, quantity, unit, pack_description, match_confidence, match_source,
--               needs_review} ] } ], office_item_id?, is_test?, test_run_id? }
-- Ogni modifica riporta l'ordine a 'draft', incrementa revision e invalida
-- riepilogo e conferma di Max.
CREATE OR REPLACE FUNCTION public.po_save_draft(p_token text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  a jsonb; g jsonb; ln jsonb; ev jsonb;
  o public.purchase_orders%ROWTYPE;
  v_vendor text; v_mode text; v_order uuid; v_pos int; v_prev_status text;
  v_is_test boolean := coalesce((p_payload->>'is_test')::boolean, false);
  v_test_run text := nullif(p_payload->>'test_run_id', '');
  v_delivery date; v_out jsonb := '[]'::jsonb; v_src text;
BEGIN
  a := public.po__auth(p_token);
  PERFORM public.po__require(a, 'compile');
  IF v_is_test AND NOT (a->>'is_admin')::boolean THEN PERFORM public.po__fail('FORBIDDEN', 'test_solo_admin'); END IF;
  IF jsonb_typeof(p_payload->'groups') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'groups') = 0 THEN
    PERFORM public.po__fail('INVALID_INPUT', 'groups_required');
  END IF;

  FOR g IN SELECT * FROM jsonb_array_elements(p_payload->'groups') LOOP
    v_vendor := nullif(btrim(coalesce(g->>'vendor_name', '')), '');
    v_mode := coalesce(g->>'mode', CASE WHEN g->>'order_id' IS NULL THEN 'append' ELSE 'replace' END);
    IF v_vendor IS NULL THEN PERFORM public.po__fail('INVALID_INPUT', 'vendor_required'); END IF;
    BEGIN v_delivery := nullif(g->>'delivery_date', '')::date;
    EXCEPTION WHEN others THEN PERFORM public.po__fail('INVALID_INPUT', 'delivery_date'); END;

    IF v_mode = 'replace' THEN
      SELECT * INTO o FROM public.purchase_orders WHERE id = (g->>'order_id')::uuid FOR UPDATE;
      IF NOT FOUND THEN PERFORM public.po__fail('NOT_FOUND', g->>'order_id'); END IF;
      IF o.vendor_name <> v_vendor THEN PERFORM public.po__fail('VENDOR_MISMATCH', o.vendor_name); END IF;
      IF o.status <> ALL (ARRAY['draft','ready','confirmed']) THEN PERFORM public.po__fail('ORDER_NOT_EDITABLE', o.status); END IF;
      IF g ? 'expected_revision' AND (g->>'expected_revision')::int <> o.revision THEN
        PERFORM public.po__fail('CONFLICT', jsonb_build_object('expected', g->'expected_revision', 'actual', o.revision)::text);
      END IF;
      DELETE FROM public.purchase_order_lines WHERE purchase_order_id = o.id;
      v_pos := 0;
    ELSIF v_mode = 'append' THEN
      SELECT * INTO o FROM public.purchase_orders
       WHERE vendor_name = v_vendor AND status = 'draft' AND is_test = v_is_test
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
      IF NOT FOUND THEN
        INSERT INTO public.purchase_orders (vendor_name, status, created_by, created_by_user_id, is_test, test_run_id,
                                            channel)
        VALUES (v_vendor, 'draft', a->>'name', (a->>'user_id')::bigint, v_is_test, v_test_run,
                (SELECT channel FROM public.po_vendor_channels WHERE vendor_name = v_vendor))
        RETURNING * INTO o;
        PERFORM public.po__log(o.id, 'created', NULL, 'draft', a);
      END IF;
      SELECT coalesce(max(position), 0) INTO v_pos FROM public.purchase_order_lines WHERE purchase_order_id = o.id;
    ELSE
      PERFORM public.po__fail('INVALID_INPUT', 'mode');
    END IF;

    FOR ln IN SELECT * FROM jsonb_array_elements(coalesce(g->'lines', '[]'::jsonb)) LOOP
      ev := public.po__eval_line(v_vendor, ln);
      v_pos := v_pos + 1;
      v_src := CASE WHEN ln->>'match_source' = ANY (ARRAY['ingredient_vendors','vendor_item_aliases','ingredient_links','manual'])
                    THEN ln->>'match_source' ELSE 'manual' END;
      INSERT INTO public.purchase_order_lines (
        purchase_order_id, position, ingredient_id, vendor_name, vendor_sku, requested_text, matched_name,
        quantity, unit, pack_description, match_confidence, match_source, needs_review,
        ingredient_vendor_id, line_status, issues, reference_price, reference_price_unit, reference_price_date, price_stale)
      VALUES (
        o.id, v_pos, (ev->>'ingredient_id')::uuid, v_vendor, nullif(ln->>'vendor_sku', ''), ev->>'requested_text',
        nullif(ln->>'matched_name', ''), (ev->>'quantity')::numeric, ev->>'unit', ev->>'pack_description',
        nullif(ln->>'match_confidence', '')::numeric, v_src, coalesce((ln->>'needs_review')::boolean, false),
        (ev->>'ingredient_vendor_id')::uuid, ev->>'line_status', ev->'issues', (ev->>'reference_price')::numeric,
        ev->>'reference_price_unit', (ev->>'reference_price_date')::date, (ev->>'price_stale')::boolean);
    END LOOP;

    v_prev_status := o.status;
    UPDATE public.purchase_orders SET
      status = 'draft', revision = revision + 1,
      delivery_date = CASE WHEN g ? 'delivery_date' THEN v_delivery ELSE delivery_date END,
      notes = CASE WHEN g ? 'notes' THEN nullif(g->>'notes', '') ELSE notes END,
      summary_json = NULL, summary_hash = NULL, ready_at = NULL, ready_by = NULL,
      confirmed_hash = NULL, confirmed_at = NULL, confirmed_by = NULL, confirmed_by_user_id = NULL,
      updated_at = now()
    WHERE id = o.id RETURNING * INTO o;
    PERFORM public.po__log(o.id, CASE WHEN v_prev_status = 'draft' THEN 'saved' ELSE 'saved_confirmation_invalidated' END,
                           v_prev_status, 'draft', a, jsonb_build_object('mode', v_mode, 'revision', o.revision,
                           'lines_written', jsonb_array_length(coalesce(g->'lines', '[]'::jsonb))));

    v_out := v_out || jsonb_build_object('id', o.id, 'vendor_name', o.vendor_name, 'status', o.status,
      'revision', o.revision, 'previous_status', v_prev_status,
      'blocking_count', (SELECT count(*) FROM public.purchase_order_lines l WHERE l.purchase_order_id = o.id
                           AND l.line_status = ANY (ARRAY['incomplete','ambiguous','blocked'])));
  END LOOP;

  -- Ponte Tell Chef: ack solo dopo che tutte le righe sono state scritte (stessa transazione).
  IF nullif(p_payload->>'office_item_id', '') IS NOT NULL THEN
    UPDATE public.office_items SET chef_action = 'added_to_order', chef_action_at = now(), chef_action_by = a->>'name'
     WHERE id = (p_payload->>'office_item_id')::uuid;
  END IF;

  RETURN jsonb_build_object('ok', true, 'orders', v_out);
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'PO:%' THEN RETURN public.po__err(SQLERRM); END IF; RAISE;
END $$;

-- ── draft -> ready: rivaluta righe, blocca se ambigue/incomplete/vietate,
--    calcola riepilogo + hash ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.po_mark_ready(p_token text, p_order_id uuid, p_expected_revision int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE a jsonb; o public.purchase_orders%ROWTYPE; l record; ev jsonb; v_blocking jsonb; v_sum jsonb; v_hash text;
BEGIN
  a := public.po__auth(p_token);
  PERFORM public.po__require(a, 'compile');
  SELECT * INTO o FROM public.purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.po__fail('NOT_FOUND'); END IF;
  IF o.status <> 'draft' THEN PERFORM public.po__fail('INVALID_STATE', o.status); END IF;
  IF p_expected_revision IS DISTINCT FROM o.revision THEN
    PERFORM public.po__fail('CONFLICT', jsonb_build_object('expected', p_expected_revision, 'actual', o.revision)::text);
  END IF;
  IF o.delivery_date IS NULL THEN PERFORM public.po__fail('DELIVERY_DATE_MISSING'); END IF;
  IF o.delivery_date < public.po__today() THEN PERFORM public.po__fail('DELIVERY_DATE_PAST', o.delivery_date::text); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.purchase_order_lines WHERE purchase_order_id = o.id) THEN
    PERFORM public.po__fail('NO_LINES');
  END IF;

  -- Rivaluta ogni riga con i dati di oggi (do_not_order, prezzo, eta' prezzo).
  FOR l IN SELECT * FROM public.purchase_order_lines WHERE purchase_order_id = o.id LOOP
    ev := public.po__eval_line(o.vendor_name, jsonb_build_object(
      'requested_text', l.requested_text, 'ingredient_id', l.ingredient_id, 'vendor_sku', l.vendor_sku,
      'quantity', l.quantity, 'unit', l.unit, 'pack_description', l.pack_description, 'needs_review', l.needs_review));
    UPDATE public.purchase_order_lines SET line_status = ev->>'line_status', issues = ev->'issues',
      pack_description = ev->>'pack_description', ingredient_vendor_id = (ev->>'ingredient_vendor_id')::uuid,
      reference_price = (ev->>'reference_price')::numeric, reference_price_unit = ev->>'reference_price_unit',
      reference_price_date = (ev->>'reference_price_date')::date, price_stale = (ev->>'price_stale')::boolean
    WHERE id = l.id;
  END LOOP;

  SELECT jsonb_agg(jsonb_build_object('line_id', id, 'position', position, 'text', coalesce(matched_name, requested_text),
                   'line_status', line_status, 'issues', issues) ORDER BY position)
    INTO v_blocking
    FROM public.purchase_order_lines
   WHERE purchase_order_id = o.id AND line_status = ANY (ARRAY['incomplete','ambiguous','blocked']);
  IF v_blocking IS NOT NULL THEN PERFORM public.po__fail('LINES_NOT_READY', v_blocking::text); END IF;

  v_sum := public.po__summary(o.id);
  v_hash := public.po__hash(v_sum);
  UPDATE public.purchase_orders SET status = 'ready', summary_json = v_sum, summary_hash = v_hash,
    ready_at = now(), ready_by = a->>'name', updated_at = now()
  WHERE id = o.id;
  PERFORM public.po__log(o.id, 'ready', 'draft', 'ready', a, jsonb_build_object('summary_hash', v_hash, 'revision', o.revision));
  RETURN jsonb_build_object('ok', true, 'order_id', o.id, 'status', 'ready', 'summary', v_sum, 'summary_hash', v_hash,
                            'duplicates', public.po__duplicates(o.id));
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'PO:%' THEN RETURN public.po__err(SQLERRM); END IF; RAISE;
END $$;

-- ── ready -> confirmed: SOLO admin (Max), sull'hash esatto del riepilogo ─
CREATE OR REPLACE FUNCTION public.po_confirm(p_token text, p_order_id uuid, p_summary_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE a jsonb; o public.purchase_orders%ROWTYPE; v_now_hash text; v_dno jsonb;
BEGIN
  a := public.po__auth(p_token);
  PERFORM public.po__require(a, 'admin');
  SELECT * INTO o FROM public.purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.po__fail('NOT_FOUND'); END IF;
  IF o.status <> 'ready' THEN PERFORM public.po__fail('INVALID_STATE', o.status); END IF;
  v_now_hash := public.po__hash(public.po__summary(o.id));
  IF p_summary_hash IS NULL OR p_summary_hash <> o.summary_hash OR v_now_hash <> o.summary_hash THEN
    PERFORM public.po__fail('SUMMARY_CHANGED', jsonb_build_object('given', p_summary_hash, 'current', v_now_hash)::text);
  END IF;
  -- do_not_order verificato dal vivo (puo' essere cambiato dopo il "pronto").
  SELECT jsonb_agg(l.id) INTO v_dno FROM public.purchase_order_lines l
   WHERE l.purchase_order_id = o.id AND l.ingredient_id IS NOT NULL AND EXISTS (
     SELECT 1 FROM public.ingredient_vendors iv WHERE iv.ingredient_id = l.ingredient_id
        AND lower(iv.vendor) = ANY (public.po__vendor_doc_names(o.vendor_name)) AND iv.do_not_order);
  IF v_dno IS NOT NULL THEN PERFORM public.po__fail('DO_NOT_ORDER', v_dno::text); END IF;

  UPDATE public.purchase_orders SET status = 'confirmed', confirmed_hash = o.summary_hash, confirmed_at = now(),
    confirmed_by = a->>'name', confirmed_by_user_id = (a->>'user_id')::bigint, updated_at = now()
  WHERE id = o.id;
  PERFORM public.po__log(o.id, 'confirmed', 'ready', 'confirmed', a, jsonb_build_object('confirmed_hash', o.summary_hash));
  RETURN jsonb_build_object('ok', true, 'order_id', o.id, 'status', 'confirmed', 'confirmed_hash', o.summary_hash,
                            'duplicates', public.po__duplicates(o.id));
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'PO:%' THEN RETURN public.po__err(SQLERRM); END IF; RAISE;
END $$;

-- ── controlli comuni prima di ogni invio (edge o manuale) ─────────────
CREATE OR REPLACE FUNCTION public.po__presend_checks(o public.purchase_orders, p_hash text, p_ack_duplicates boolean, a jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_now_hash text; v_dno jsonb; v_dup jsonb;
BEGIN
  IF o.status = ANY (ARRAY['sent','sent_manual','acknowledged','received']) THEN
    PERFORM public.po__fail('ALREADY_SENT', jsonb_build_object('status', o.status, 'sent_at', o.sent_at, 'send_mode', o.send_mode)::text);
  END IF;
  IF o.status <> 'confirmed' THEN PERFORM public.po__fail('NOT_CONFIRMED', o.status); END IF;
  v_now_hash := public.po__hash(public.po__summary(o.id));
  IF o.confirmed_hash IS NULL OR v_now_hash <> o.confirmed_hash OR p_hash IS DISTINCT FROM o.confirmed_hash THEN
    PERFORM public.po__fail('CONFIRMATION_STALE', jsonb_build_object('given', p_hash, 'confirmed', o.confirmed_hash, 'current', v_now_hash)::text);
  END IF;
  SELECT jsonb_agg(l.id) INTO v_dno FROM public.purchase_order_lines l
   WHERE l.purchase_order_id = o.id AND l.ingredient_id IS NOT NULL AND EXISTS (
     SELECT 1 FROM public.ingredient_vendors iv WHERE iv.ingredient_id = l.ingredient_id
        AND lower(iv.vendor) = ANY (public.po__vendor_doc_names(o.vendor_name)) AND iv.do_not_order);
  IF v_dno IS NOT NULL THEN PERFORM public.po__fail('DO_NOT_ORDER', v_dno::text); END IF;
  IF o.delivery_date IS NULL OR o.delivery_date < public.po__today() THEN
    PERFORM public.po__fail('DELIVERY_DATE_PAST', coalesce(o.delivery_date::text, 'null'));
  END IF;
  v_dup := public.po__duplicates(o.id);
  IF jsonb_array_length(v_dup->'items') > 0 THEN
    IF NOT coalesce(p_ack_duplicates, false) THEN PERFORM public.po__fail('DUPLICATE_SUSPECTED', v_dup::text); END IF;
    IF NOT (a->>'is_admin')::boolean THEN PERFORM public.po__fail('FORBIDDEN', 'duplicato_solo_admin'); END IF;
  END IF;
  RETURN v_dup;
END $$;

-- ── testo del riepilogo (per email / portale / telefono) ──────────────
CREATE OR REPLACE FUNCTION public.po__summary_text(p_summary jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'Order — Zeno''s' || E'\n' ||
         'Vendor: ' || (p_summary->>'vendor') || E'\n' ||
         'Requested delivery: ' || coalesce(p_summary->>'delivery_date', '-') || E'\n\n' ||
         coalesce((SELECT string_agg(
            (l->>'quantity') || ' ' || coalesce(l->>'unit', '') || ' — ' || coalesce(l->>'name', '') ||
            coalesce(' (SKU ' || (l->>'vendor_sku') || ')', '') || coalesce(' [' || (l->>'pack_description') || ']', ''),
            E'\n' ORDER BY (l->>'position')::int)
          FROM jsonb_array_elements(p_summary->'lines') l), '') ||
         coalesce(E'\n\nNotes: ' || (p_summary->>'notes'), '') ||
         E'\n\nPlease confirm by reply with your order number. Thank you.';
$$;

-- ── invio via edge (SOLO service_role): inizio ────────────────────────
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

-- ── invio via edge (SOLO service_role): esito ─────────────────────────
-- 'simulated': ordine VERO resta 'confirmed' (nulla e' partito); ordine di
-- prova passa a 'sent' con send_mode='simulated' per provare il ciclo.
CREATE OR REPLACE FUNCTION public.po_send_finish(p_attempt_id uuid, p_outcome text, p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_at public.po_send_attempts%ROWTYPE; o public.purchase_orders%ROWTYPE; v_to text;
        a jsonb;
BEGIN
  SELECT * INTO v_at FROM public.po_send_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.po__fail('NOT_FOUND'); END IF;
  SELECT * INTO o FROM public.purchase_orders WHERE id = v_at.purchase_order_id FOR UPDATE;
  a := jsonb_build_object('name', v_at.created_by, 'user_id', v_at.created_by_user_id);
  IF v_at.state <> 'pending' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'state', v_at.state, 'order_status', o.status);
  END IF;
  IF p_outcome = 'simulated' THEN
    UPDATE public.po_send_attempts SET state = 'simulated', result = p_result, finished_at = now() WHERE id = v_at.id;
    IF o.is_test THEN
      UPDATE public.purchase_orders SET status = 'sent', send_mode = 'simulated', sent_at = now(), sent_by = v_at.created_by,
        send_idempotency_key = v_at.idempotency_key, updated_at = now() WHERE id = o.id;
      v_to := 'sent';
    ELSE
      v_to := o.status;
    END IF;
    PERFORM public.po__log(o.id, 'send_simulated', o.status, v_to, a, jsonb_build_object('attempt_id', v_at.id));
  ELSIF p_outcome = 'sent' THEN
    IF v_at.mode <> 'real' THEN PERFORM public.po__fail('INVALID_STATE', 'attempt_not_real'); END IF;
    UPDATE public.po_send_attempts SET state = 'sent', result = p_result, finished_at = now() WHERE id = v_at.id;
    UPDATE public.purchase_orders SET status = 'sent', send_mode = 'real', sent_at = now(), sent_by = v_at.created_by,
      send_idempotency_key = v_at.idempotency_key, updated_at = now() WHERE id = o.id;
    v_to := 'sent';
    PERFORM public.po__log(o.id, 'sent', o.status, v_to, a, jsonb_build_object('attempt_id', v_at.id));
  ELSIF p_outcome = 'failed' THEN
    UPDATE public.po_send_attempts SET state = 'failed', result = p_result, finished_at = now() WHERE id = v_at.id;
    v_to := o.status;
    PERFORM public.po__log(o.id, 'send_failed', o.status, v_to, a, jsonb_build_object('attempt_id', v_at.id, 'result', p_result));
  ELSE
    PERFORM public.po__fail('INVALID_INPUT', 'outcome');
  END IF;
  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'state', p_outcome, 'order_status', v_to);
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'PO:%' THEN RETURN public.po__err(SQLERRM); END IF; RAISE;
END $$;

-- ── confirmed -> sent_manual: invio fatto a mano (portale/telefono/email) ─
CREATE OR REPLACE FUNCTION public.po_register_manual_send(p_token text, p_order_id uuid, p_idempotency_key text,
    p_summary_hash text, p_channel text, p_vendor_order_number text DEFAULT NULL, p_note text DEFAULT NULL,
    p_ack_duplicates boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE a jsonb; o public.purchase_orders%ROWTYPE; m public.po_manual_sends%ROWTYPE; v_dup jsonb;
BEGIN
  a := public.po__auth(p_token);
  PERFORM public.po__require(a, 'compile');
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN PERFORM public.po__fail('INVALID_INPUT', 'idempotency_key'); END IF;
  IF p_channel IS NULL OR p_channel <> ALL (ARRAY['email','portal','phone','manual']) THEN PERFORM public.po__fail('INVALID_INPUT', 'channel'); END IF;
  SELECT * INTO o FROM public.purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.po__fail('NOT_FOUND'); END IF;
  SELECT * INTO m FROM public.po_manual_sends WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF m.purchase_order_id IS DISTINCT FROM o.id THEN PERFORM public.po__fail('IDEMPOTENCY_KEY_REUSED'); END IF;
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'manual_send_id', m.id, 'status', o.status);
  END IF;
  v_dup := public.po__presend_checks(o, p_summary_hash, p_ack_duplicates, a);
  INSERT INTO public.po_manual_sends (vendor_name, purchase_order_id, idempotency_key, channel, vendor_order_number, note,
                                      recorded_by, recorded_by_user_id, is_test, test_run_id)
  VALUES (o.vendor_name, o.id, p_idempotency_key, p_channel, nullif(btrim(p_vendor_order_number), ''), nullif(p_note, ''),
          a->>'name', (a->>'user_id')::bigint, o.is_test, o.test_run_id)
  RETURNING * INTO m;
  UPDATE public.purchase_orders SET status = 'sent_manual', send_mode = 'manual', sent_at = now(), sent_by = a->>'name',
    channel = p_channel, send_idempotency_key = p_idempotency_key,
    vendor_order_number = coalesce(nullif(btrim(p_vendor_order_number), ''), vendor_order_number), updated_at = now()
  WHERE id = o.id;
  PERFORM public.po__log(o.id, 'sent_manual', 'confirmed', 'sent_manual', a, jsonb_build_object('manual_send_id', m.id,
                         'channel', p_channel, 'duplicates_acknowledged', CASE WHEN jsonb_array_length(v_dup->'items') > 0 THEN v_dup END));
  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'manual_send_id', m.id, 'status', 'sent_manual');
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'PO:%' THEN RETURN public.po__err(SQLERRM); END IF; RAISE;
END $$;

-- ── ordine fatto FUORI da Brigade (es. email/telefono di Max): registrazione
--    usata dal controllo doppioni ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.po_register_external_send(p_token text, p_vendor text, p_channel text,
    p_sent_at timestamptz DEFAULT NULL, p_vendor_order_number text DEFAULT NULL, p_note text DEFAULT NULL,
    p_idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE a jsonb; m public.po_manual_sends%ROWTYPE;
BEGIN
  a := public.po__auth(p_token);
  PERFORM public.po__require(a, 'compile');
  IF nullif(btrim(coalesce(p_vendor, '')), '') IS NULL THEN PERFORM public.po__fail('INVALID_INPUT', 'vendor'); END IF;
  IF p_channel IS NULL OR p_channel <> ALL (ARRAY['email','portal','phone','manual']) THEN PERFORM public.po__fail('INVALID_INPUT', 'channel'); END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO m FROM public.po_manual_sends WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN jsonb_build_object('ok', true, 'idempotent', true, 'manual_send_id', m.id); END IF;
  END IF;
  INSERT INTO public.po_manual_sends (vendor_name, idempotency_key, channel, sent_at, vendor_order_number, note,
                                      recorded_by, recorded_by_user_id)
  VALUES (btrim(p_vendor), p_idempotency_key, p_channel, coalesce(p_sent_at, now()), nullif(btrim(p_vendor_order_number), ''),
          nullif(p_note, ''), a->>'name', (a->>'user_id')::bigint)
  RETURNING * INTO m;
  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'manual_send_id', m.id);
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'PO:%' THEN RETURN public.po__err(SQLERRM); END IF; RAISE;
END $$;

-- ── conferme/risposte del fornitore: candidati e collegamento ─────────
CREATE OR REPLACE FUNCTION public.po_confirmation_candidates(p_token text, p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE a jsonb; o public.purchase_orders%ROWTYPE; v_from timestamptz; v_days int; v_skus text[]; v_names text[];
BEGIN
  a := public.po__auth(p_token);
  PERFORM public.po__require(a, 'compile');
  SELECT * INTO o FROM public.purchase_orders WHERE id = p_order_id;
  IF NOT FOUND THEN PERFORM public.po__fail('NOT_FOUND'); END IF;
  v_days := (public.po__setting('confirmation_link_days', '7'::jsonb) #>> '{}')::int;
  v_from := coalesce(o.sent_at, o.confirmed_at, o.created_at) - interval '12 hours';
  v_names := public.po__vendor_doc_names(o.vendor_name);
  SELECT array_agg(DISTINCT vendor_sku) INTO v_skus FROM public.purchase_order_lines
   WHERE purchase_order_id = o.id AND vendor_sku IS NOT NULL;
  RETURN jsonb_build_object('ok', true, 'candidates', coalesce((
    SELECT jsonb_agg(c ORDER BY (c->>'score')::numeric DESC, c->>'created_at' DESC) FROM (
      SELECT jsonb_build_object(
        'vendor_document_id', d.id, 'document_number', d.document_number, 'document_date', d.document_date,
        'delivery_date', d.delivery_date, 'created_at', d.created_at, 'subject', d.source_email_subject,
        'item_count', jsonb_array_length(coalesce(d.parsed_json->'items', '[]'::jsonb)),
        'number_match', o.vendor_order_number IS NOT NULL AND ltrim(d.document_number, '0') = ltrim(o.vendor_order_number, '0'),
        'sku_overlap', ov.n,
        'score', CASE WHEN o.vendor_order_number IS NOT NULL AND ltrim(d.document_number, '0') = ltrim(o.vendor_order_number, '0')
                      THEN 100 ELSE 0 END
                 + CASE WHEN coalesce(array_length(v_skus, 1), 0) > 0 THEN round(50.0 * ov.n / array_length(v_skus, 1)) ELSE 0 END
      ) c
      FROM public.vendor_documents d
      CROSS JOIN LATERAL (SELECT count(DISTINCT it->>'vendor_sku') n
                            FROM jsonb_array_elements(coalesce(d.parsed_json->'items', '[]'::jsonb)) it
                           WHERE it->>'vendor_sku' = ANY (coalesce(v_skus, '{}'::text[]))) ov
      WHERE d.document_type = 'order_confirmation' AND lower(d.vendor) = ANY (v_names)
        AND d.created_at >= v_from AND d.created_at <= v_from + make_interval(days => v_days)
        AND NOT EXISTS (SELECT 1 FROM public.purchase_orders x WHERE x.vendor_document_id = d.id AND x.id <> o.id)
      ) q), '[]'::jsonb));
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'PO:%' THEN RETURN public.po__err(SQLERRM); END IF; RAISE;
END $$;

CREATE OR REPLACE FUNCTION public.po_link_confirmation(p_token text, p_order_id uuid, p_vendor_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE a jsonb; o public.purchase_orders%ROWTYPE; d record; v_diff jsonb;
BEGIN
  a := public.po__auth(p_token);
  PERFORM public.po__require(a, 'compile');
  SELECT * INTO o FROM public.purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.po__fail('NOT_FOUND'); END IF;
  IF o.status <> ALL (ARRAY['sent','sent_manual']) THEN PERFORM public.po__fail('INVALID_STATE', o.status); END IF;
  SELECT id, vendor, document_type, document_number, parsed_json INTO d FROM public.vendor_documents WHERE id = p_vendor_document_id;
  IF NOT FOUND THEN PERFORM public.po__fail('NOT_FOUND', 'vendor_document'); END IF;
  IF d.document_type <> 'order_confirmation' OR lower(d.vendor) <> ALL (public.po__vendor_doc_names(o.vendor_name)) THEN
    PERFORM public.po__fail('DOCUMENT_MISMATCH', coalesce(d.vendor, '') || ' / ' || coalesce(d.document_type, ''));
  END IF;
  IF EXISTS (SELECT 1 FROM public.purchase_orders WHERE vendor_document_id = d.id AND id <> o.id) THEN
    PERFORM public.po__fail('DOCUMENT_ALREADY_LINKED');
  END IF;
  -- Differenze per SKU (solo informative: ordinato vs confermato).
  SELECT jsonb_agg(x) INTO v_diff FROM (
    SELECT jsonb_build_object('vendor_sku', coalesce(l.vendor_sku, c.sku), 'ordered', l.quantity, 'confirmed', c.qty,
                              'name', coalesce(l.matched_name, l.requested_text, c.descr)) x
      FROM (SELECT vendor_sku, sum(quantity) quantity, min(matched_name) matched_name, min(requested_text) requested_text
              FROM public.purchase_order_lines WHERE purchase_order_id = o.id AND vendor_sku IS NOT NULL GROUP BY vendor_sku) l
      FULL JOIN (SELECT it->>'vendor_sku' sku, sum(nullif(it->>'qty_ordered', '')::numeric) qty, min(it->>'description') descr
                   FROM jsonb_array_elements(coalesce(d.parsed_json->'items', '[]'::jsonb)) it GROUP BY 1) c
        ON c.sku = l.vendor_sku
     WHERE l.quantity IS DISTINCT FROM c.qty) q;
  UPDATE public.purchase_orders SET status = 'acknowledged', vendor_document_id = d.id,
    vendor_order_number = coalesce(d.document_number, vendor_order_number),
    acknowledged_at = now(), acknowledged_by = a->>'name', updated_at = now()
  WHERE id = o.id;
  PERFORM public.po__log(o.id, 'acknowledged', o.status, 'acknowledged', a,
                         jsonb_build_object('vendor_document_id', d.id, 'document_number', d.document_number, 'differences', v_diff));
  RETURN jsonb_build_object('ok', true, 'status', 'acknowledged', 'document_number', d.document_number,
                            'differences', coalesce(v_diff, '[]'::jsonb));
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'PO:%' THEN RETURN public.po__err(SQLERRM); END IF; RAISE;
END $$;

-- ── ricevimento: check-in righe; anomalie => BOZZA di reclamo (mai inviata) ─
-- p_lines = [ {line_id, status: received|missing|damaged|partial, received_qty?, note?, photo_url?} ]
CREATE OR REPLACE FUNCTION public.po_receive(p_token text, p_order_id uuid, p_lines jsonb, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE a jsonb; o public.purchase_orders%ROWTYPE; r jsonb; l public.purchase_order_lines%ROWTYPE;
        v_status text; v_qty numeric; v_anom jsonb := '[]'::jsonb; v_missing int; v_cd uuid; v_body text;
BEGIN
  a := public.po__auth(p_token);
  PERFORM public.po__require(a, 'compile');
  SELECT * INTO o FROM public.purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.po__fail('NOT_FOUND'); END IF;
  IF o.status <> ALL (ARRAY['sent','sent_manual','acknowledged']) THEN PERFORM public.po__fail('INVALID_STATE', o.status); END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN PERFORM public.po__fail('INVALID_INPUT', 'lines'); END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO l FROM public.purchase_order_lines WHERE id = (r->>'line_id')::uuid AND purchase_order_id = o.id;
    IF NOT FOUND THEN PERFORM public.po__fail('INVALID_INPUT', 'line_id ' || coalesce(r->>'line_id', 'null')); END IF;
    v_status := r->>'status';
    IF v_status IS NULL OR v_status <> ALL (ARRAY['received','missing','damaged','partial']) THEN
      PERFORM public.po__fail('INVALID_INPUT', 'status ' || coalesce(v_status, 'null'));
    END IF;
    BEGIN v_qty := nullif(r->>'received_qty', '')::numeric; EXCEPTION WHEN others THEN v_qty := NULL; END;
    v_qty := CASE v_status WHEN 'received' THEN coalesce(v_qty, l.quantity) WHEN 'missing' THEN 0 ELSE v_qty END;
    IF v_status = 'partial' AND (v_qty IS NULL OR v_qty < 0 OR v_qty >= l.quantity) THEN
      PERFORM public.po__fail('INVALID_INPUT', 'partial_qty ' || l.id);
    END IF;
    UPDATE public.purchase_order_lines SET received_status = v_status, received_qty = v_qty,
      received_note = nullif(r->>'note', ''), received_photo_url = nullif(r->>'photo_url', ''),
      received_at = now(), received_by = a->>'name'
    WHERE id = l.id;
    IF v_status <> 'received' OR v_qty < l.quantity THEN
      v_anom := v_anom || jsonb_build_object('line_id', l.id, 'name', coalesce(l.matched_name, l.requested_text),
        'vendor_sku', l.vendor_sku, 'ordered', l.quantity, 'unit', l.unit, 'received', v_qty, 'status', v_status,
        'note', nullif(r->>'note', ''), 'photo_url', nullif(r->>'photo_url', ''));
    END IF;
  END LOOP;

  SELECT count(*) INTO v_missing FROM public.purchase_order_lines WHERE purchase_order_id = o.id AND received_status IS NULL;
  IF v_missing > 0 THEN PERFORM public.po__fail('RECEIPT_INCOMPLETE', v_missing::text); END IF;

  IF jsonb_array_length(v_anom) > 0 THEN
    SELECT 'Hello,' || E'\n\n' ||
           'Regarding our order' || coalesce(' #' || o.vendor_order_number, '') || ' (delivery ' || coalesce(o.delivery_date::text, '-') ||
           '), we found the following issues at delivery:' || E'\n\n' ||
           string_agg('- ' || (x->>'name') || coalesce(' (SKU ' || (x->>'vendor_sku') || ')', '') || ': ' ||
                      CASE x->>'status' WHEN 'missing' THEN 'missing'
                                        WHEN 'damaged' THEN 'damaged'
                                        WHEN 'partial' THEN 'short' ELSE x->>'status' END ||
                      ' — ordered ' || (x->>'ordered') || ' ' || coalesce(x->>'unit', '') ||
                      ', received ' || coalesce(x->>'received', '?') || coalesce(' — ' || (x->>'note'), ''), E'\n') ||
           E'\n\nPlease advise on credit or replacement. Thank you.'
      INTO v_body FROM jsonb_array_elements(v_anom) x;
    INSERT INTO public.po_complaint_drafts (purchase_order_id, vendor_name, status, subject, body, lines, created_by, is_test, test_run_id)
    VALUES (o.id, o.vendor_name, 'draft', 'Delivery issue — ' || o.vendor_name || coalesce(' — order #' || o.vendor_order_number, ''),
            v_body, v_anom, a->>'name', o.is_test, o.test_run_id)
    RETURNING id INTO v_cd;
  END IF;

  UPDATE public.purchase_orders SET status = 'received', received_at = now(), received_by = a->>'name',
    notes = CASE WHEN nullif(p_note, '') IS NULL THEN notes ELSE coalesce(notes || E'\n', '') || 'Ricevimento: ' || p_note END,
    updated_at = now()
  WHERE id = o.id;
  PERFORM public.po__log(o.id, 'received', o.status, 'received', a,
                         jsonb_build_object('anomalies', jsonb_array_length(v_anom), 'complaint_draft_id', v_cd));
  RETURN jsonb_build_object('ok', true, 'status', 'received', 'anomalies', v_anom, 'complaint_draft_id', v_cd);
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'PO:%' THEN RETURN public.po__err(SQLERRM); END IF; RAISE;
END $$;

-- ── annullamento ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.po_cancel(p_token text, p_order_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE a jsonb; o public.purchase_orders%ROWTYPE;
BEGIN
  a := public.po__auth(p_token);
  PERFORM public.po__require(a, 'compile');
  SELECT * INTO o FROM public.purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.po__fail('NOT_FOUND'); END IF;
  IF o.status = ANY (ARRAY['received','cancelled']) THEN PERFORM public.po__fail('INVALID_STATE', o.status); END IF;
  IF o.status <> ALL (ARRAY['draft','ready']) THEN
    PERFORM public.po__require(a, 'admin');
    IF nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN PERFORM public.po__fail('INVALID_INPUT', 'reason_required'); END IF;
  END IF;
  UPDATE public.purchase_orders SET status = 'cancelled', cancelled_at = now(), cancelled_by = a->>'name',
    cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_at = now()
  WHERE id = o.id;
  PERFORM public.po__log(o.id, 'cancelled', o.status, 'cancelled', a, jsonb_build_object('reason', p_reason));
  RETURN jsonb_build_object('ok', true, 'status', 'cancelled',
    'warning', CASE WHEN o.status = ANY (ARRAY['sent','sent_manual','acknowledged'])
                    THEN 'Ordine gia'' inviato: avvisare il fornitore a mano.' END);
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'PO:%' THEN RETURN public.po__err(SQLERRM); END IF; RAISE;
END $$;

-- ── permessi ──────────────────────────────────────────────────────────
-- Helper interni: nessun accesso da anon/authenticated (default privileges
-- di Supabase concedono EXECUTE: revoca esplicita).
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'po__fail(text,text)', 'po__err(text)', 'po__setting(text,jsonb)', 'po__today()', 'po__auth(text)',
    'po__require(jsonb,text)', 'po__log(uuid,text,text,text,jsonb,jsonb)', 'po__vendor_doc_names(text)',
    'po__eval_line(text,jsonb)', 'po__summary(uuid)', 'po__hash(jsonb)', 'po__duplicates(uuid)', 'po__order_json(uuid)',
    'po__presend_checks(purchase_orders,text,boolean,jsonb)', 'po__summary_text(jsonb)',
    'po_send_begin(text,uuid,text,text,boolean,boolean)', 'po_send_finish(uuid,text,jsonb)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'po_list(text,boolean,boolean)', 'po_get(text,uuid)', 'po_home_counts(text)', 'po_save_draft(text,jsonb)',
    'po_mark_ready(text,uuid,integer)', 'po_confirm(text,uuid,text)',
    'po_register_manual_send(text,uuid,text,text,text,text,text,boolean)',
    'po_register_external_send(text,text,text,timestamptz,text,text,text)',
    'po_confirmation_candidates(text,uuid)', 'po_link_confirmation(text,uuid,uuid)',
    'po_receive(text,uuid,jsonb,text)', 'po_cancel(text,uuid,text)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO anon, authenticated, service_role', f);
  END LOOP;
END $$;
