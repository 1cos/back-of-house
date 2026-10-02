-- =====================================================================
-- XCF-ORDINI 04 — do_not_order per SKU (correzione della 02)
-- La 02 bloccava un ingrediente se QUALSIASI sua riga fornitore era
-- do_not_order: una vecchia mappatura SKU sbagliata (es. Sliced Almonds,
-- SKU 02138 superato) avrebbe bloccato anche la mappatura corretta.
-- Ora una riga e' bloccata se:
--   - il suo SKU corrisponde a una riga do_not_order, oppure
--   - per quell'ingrediente/fornitore esiste una riga do_not_order e
--     NESSUNA riga attiva ordinabile.
-- Rollback: rientra nel rollback generale (drop delle funzioni po_*);
-- per tornare alla sola 02 riapplicare le tre funzioni dalla 02.
-- =====================================================================

-- Ritorna NULL se ordinabile, altrimenti il motivo ('' se non indicato).
CREATE OR REPLACE FUNCTION public.po__dno(p_vendor text, p_ing uuid, p_sku text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH m AS (
    SELECT iv.* FROM public.ingredient_vendors iv
     WHERE iv.ingredient_id = p_ing AND lower(iv.vendor) = ANY (public.po__vendor_doc_names(p_vendor))
  )
  SELECT coalesce(
    (SELECT coalesce(r.do_not_order_reason, '') FROM m r
      WHERE r.do_not_order AND p_sku IS NOT NULL AND r.vendor_sku = p_sku LIMIT 1),
    CASE WHEN EXISTS (SELECT 1 FROM m r WHERE r.do_not_order)
          AND NOT EXISTS (SELECT 1 FROM m r WHERE NOT coalesce(r.do_not_order, false) AND r.active)
         THEN (SELECT coalesce(r.do_not_order_reason, '') FROM m r WHERE r.do_not_order LIMIT 1) END);
$$;

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
    v_dno_reason := public.po__dno(p_vendor, v_ing, nullif(p_line->>'vendor_sku', ''));
    IF v_dno_reason IS NOT NULL THEN
      v_issues := v_issues || jsonb_build_object('code', 'DO_NOT_ORDER', 'blocking', true,
                    'msg', 'Prodotto marcato "non ordinare"' || CASE WHEN v_dno_reason <> '' THEN ': ' || v_dno_reason ELSE '' END);
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
   WHERE l.purchase_order_id = o.id AND l.ingredient_id IS NOT NULL
     AND public.po__dno(o.vendor_name, l.ingredient_id, l.vendor_sku) IS NOT NULL;
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
   WHERE l.purchase_order_id = o.id AND l.ingredient_id IS NOT NULL
     AND public.po__dno(o.vendor_name, l.ingredient_id, l.vendor_sku) IS NOT NULL;
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

REVOKE ALL ON FUNCTION public.po__dno(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.po__dno(text, uuid, text) TO service_role;
