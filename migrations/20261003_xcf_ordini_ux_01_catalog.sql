-- =====================================================================
-- XCF-ORDINI-UX 01 (03/10/2026) — calendario fornitori + catalogo acquisti
-- per Compila Ordine (Lista / Suggeriti / Abituali / Cerca). Solo additiva.
--
-- 1. po_vendor_channels: giorni di consegna (ISO: 1 = lunedi' ... 7 = domenica),
--    anticipo d'ordine in giorni, fonte del calendario ('verified' | 'to_verify'),
--    modo di presentazione ('list' per cataloghi corti, 'suggest' per lunghi).
--    Riga nuova per Global Gourmet Foods (canale manuale, invio spento).
-- 2. po_vendor_catalog(token, vendor): articoli REALMENTE comprati da Zeno da
--    quel fornitore, dallo storico invoice_lines (fonte unica, nessuna lista
--    a mano). Per ogni articolo: ultimo acquisto, ultima quantita'/unita'/
--    prezzo, settimane con acquisto nelle ultime 8, intervallo mediano e la
--    regola "Suggerito" provata sullo storico (report 03/10):
--      suggerito = >=3 acquisti E >=2 delle ultime 8 settimane E 0,75 <= dovuto <= 3
--      dovuto    = giorni dall'ultimo acquisto / intervallo mediano
--      punteggio = settimane/8 + min(dovuto, 2)/2
--    Niente stock, niente quantita' suggerite: solo il perche'.
--    Esclusi gli articoli do_not_order per quel fornitore.
-- Rollback: migrations/rollback/20261003_xcf_ordini_ux_01_catalog_rollback.sql
-- =====================================================================

ALTER TABLE public.po_vendor_channels ADD COLUMN IF NOT EXISTS delivery_weekdays int[];
ALTER TABLE public.po_vendor_channels ADD COLUMN IF NOT EXISTS order_lead_days   int;
ALTER TABLE public.po_vendor_channels ADD COLUMN IF NOT EXISTS calendar_source   text;
ALTER TABLE public.po_vendor_channels ADD COLUMN IF NOT EXISTS calendar_note     text;
ALTER TABLE public.po_vendor_channels ADD COLUMN IF NOT EXISTS order_view        text;
ALTER TABLE public.po_vendor_channels DROP CONSTRAINT IF EXISTS po_vendor_channels_calendar_source_check;
ALTER TABLE public.po_vendor_channels ADD CONSTRAINT po_vendor_channels_calendar_source_check
  CHECK (calendar_source IS NULL OR calendar_source = ANY (ARRAY['verified','to_verify']::text[]));
ALTER TABLE public.po_vendor_channels DROP CONSTRAINT IF EXISTS po_vendor_channels_order_view_check;
ALTER TABLE public.po_vendor_channels ADD CONSTRAINT po_vendor_channels_order_view_check
  CHECK (order_view IS NULL OR order_view = ANY (ARRAY['list','suggest']::text[]));

INSERT INTO public.po_vendor_channels (vendor_name, channel, document_vendor_names, real_send_allowed, notes, updated_by)
VALUES ('Global Gourmet Foods', 'manual', ARRAY['Global Gourmet Foods','Global Gourmet'], false,
        'Ordini a Mauro Ceotto (email "Zeno''s order", lunedi''). Invio da Brigade non attivo.', 'XCF-ORDINI-UX 01')
ON CONFLICT (vendor_name) DO NOTHING;

-- Calendario: solo dove manca (non sovrascrive scelte successive).
UPDATE public.po_vendor_channels SET delivery_weekdays = ARRAY[1,3,5,6], order_lead_days = 1, calendar_source = 'verified', order_view = 'suggest',
  calendar_note = 'Date e cutoff reali dal portale CW (es. "Order by 05:10PM").'
 WHERE vendor_name = 'Hardie''s Fresh Foods / Dairyland Produce' AND delivery_weekdays IS NULL;
UPDATE public.po_vendor_channels SET delivery_weekdays = ARRAY[1,4], order_lead_days = 1, calendar_source = 'verified', order_view = 'suggest',
  calendar_note = 'Consegne lunedi'' e giovedi'' (conferme BEK). "Item confirmation the morning before ship date". Cutoff non verificato.'
 WHERE vendor_name = 'Ben E. Keith' AND delivery_weekdays IS NULL;
UPDATE public.po_vendor_channels SET delivery_weekdays = ARRAY[2], order_lead_days = 1, calendar_source = 'verified', order_view = 'list',
  calendar_note = 'Ordine lunedi'' (email a Mauro), consegna martedi'' mattina. Cutoff non verificato.'
 WHERE vendor_name = 'Global Gourmet Foods' AND delivery_weekdays IS NULL;
UPDATE public.po_vendor_channels SET delivery_weekdays = ARRAY[1,2,3,4,5,6], order_lead_days = 1, calendar_source = 'to_verify', order_view = 'list',
  calendar_note = 'Max: quasi tutti i giorni, ordine il giorno prima. Fatture viste lun/mer/gio/ven. Canale (email o messaggio) da confermare.'
 WHERE vendor_name = 'Fruge Seafood' AND delivery_weekdays IS NULL;

-- Prossime date di consegna (max 3) da oggi + anticipo, solo dai giorni configurati.
CREATE OR REPLACE FUNCTION public.po__next_deliveries(p_weekdays int[], p_lead int, p_today date)
RETURNS date[] LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT coalesce(array_agg(d ORDER BY d), '{}'::date[]) FROM (
    SELECT (p_today + g)::date d FROM generate_series(coalesce(p_lead, 0), 21) g
     WHERE extract(isodow FROM (p_today + g)::date)::int = ANY (coalesce(p_weekdays, '{}'::int[]))
     ORDER BY 1 LIMIT 3) x;
$$;

CREATE OR REPLACE FUNCTION public.po_vendor_catalog(p_token text, p_vendor text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE a jsonb; v_today date := public.po__today(); ch public.po_vendor_channels%ROWTYPE; v_names text[]; v_items jsonb;
BEGIN
  a := public.po__auth(p_token);
  PERFORM public.po__require(a, 'compile');
  SELECT * INTO ch FROM public.po_vendor_channels WHERE vendor_name = p_vendor;
  IF NOT FOUND THEN PERFORM public.po__fail('NOT_FOUND', 'vendor'); END IF;
  v_names := public.po__vendor_doc_names(p_vendor);

  WITH l AS (
    SELECT coalesce(nullif(btrim(il.vendor_sku), ''), il.ingredient_id::text, lower(btrim(il.raw_description))) k,
           il.ingredient_id, nullif(btrim(il.vendor_sku), '') sku, il.raw_description, il.invoice_date d,
           il.qty, il.purchase_unit, il.unit_price, il.pack_description, il.created_at
      FROM public.invoice_lines il
     WHERE lower(il.vendor) = ANY (v_names) AND il.invoice_date IS NOT NULL AND coalesce(il.qty, 0) > 0
  ), dd AS (                                   -- un acquisto = una data per articolo
    SELECT DISTINCT k, d FROM l
  ), gaps AS (
    SELECT k, d, d - lag(d) OVER (PARTITION BY k ORDER BY d) gap FROM dd
  ), st AS (
    SELECT k, count(*) n, max(d) last_d,
           least(8, count(DISTINCT date_trunc('week', d)) FILTER (WHERE d > v_today - 56)) w8,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY gap) FILTER (WHERE gap IS NOT NULL) med_gap
      FROM gaps GROUP BY k
  ), lastl AS (
    SELECT DISTINCT ON (k) k, ingredient_id, sku, raw_description, qty, purchase_unit, unit_price, pack_description, d
      FROM l ORDER BY k, d DESC, created_at DESC
  ), x AS (
    SELECT s.k, s.n, s.last_d, s.w8, s.med_gap, ll.ingredient_id, ll.sku, ll.raw_description, ll.qty, ll.purchase_unit, ll.unit_price,
           ll.pack_description, i.name, i.name_it,
           (v_today - s.last_d) days_since,
           CASE WHEN s.n >= 3 AND s.med_gap > 0 THEN round(((v_today - s.last_d) / s.med_gap)::numeric, 2) END due
      FROM st s JOIN lastl ll USING (k)
      LEFT JOIN public.ingredients i ON i.id = ll.ingredient_id
     WHERE NOT EXISTS (SELECT 1 FROM public.ingredient_vendors iv
                        WHERE iv.do_not_order AND lower(iv.vendor) = ANY (v_names)
                          AND ((ll.sku IS NOT NULL AND iv.vendor_sku = ll.sku) OR (ll.sku IS NULL AND iv.ingredient_id = ll.ingredient_id)))
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'key', k, 'ingredient_id', ingredient_id, 'vendor_sku', sku,
      'name', coalesce(name, raw_description), 'name_it', name_it, 'invoice_description', raw_description,
      'last_date', last_d, 'days_since', days_since, 'last_qty', qty, 'last_unit', lower(purchase_unit),
      'last_price', unit_price, 'pack', pack_description,
      'purchases', n, 'weeks_8', w8, 'interval_days', CASE WHEN n >= 3 THEN round(med_gap::numeric) END, 'due', due,
      'habitual', w8 >= 2,
      'suggested', (n >= 3 AND w8 >= 2 AND due IS NOT NULL AND due BETWEEN 0.75 AND 3),
      'score', round((w8 / 8.0 + least(coalesce(due, 0), 2) / 2.0)::numeric, 3)
    ) ORDER BY (n >= 3 AND w8 >= 2 AND due IS NOT NULL AND due BETWEEN 0.75 AND 3) DESC,
               (w8 / 8.0 + least(coalesce(due, 0), 2) / 2.0) DESC, last_d DESC), '[]'::jsonb)
    INTO v_items FROM x;

  RETURN jsonb_build_object('ok', true, 'vendor', p_vendor, 'today', v_today,
    'channel', jsonb_build_object('channel', ch.channel, 'real_send_allowed', ch.real_send_allowed, 'transport', ch.transport,
      'order_view', coalesce(ch.order_view, 'suggest'), 'delivery_weekdays', ch.delivery_weekdays, 'order_lead_days', ch.order_lead_days,
      'calendar_source', ch.calendar_source, 'calendar_note', ch.calendar_note),
    'next_deliveries', to_jsonb(public.po__next_deliveries(ch.delivery_weekdays, ch.order_lead_days, v_today)),
    'items', v_items);
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'PO:%' THEN RETURN public.po__err(SQLERRM); END IF; RAISE;
END $$;

-- Elenco fornitori per i pulsanti di Compila Ordine (solo quelli con calendario/vista).
CREATE OR REPLACE FUNCTION public.po_vendor_list(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE a jsonb; v_today date := public.po__today();
BEGIN
  a := public.po__auth(p_token);
  PERFORM public.po__require(a, 'compile');
  RETURN jsonb_build_object('ok', true, 'today', v_today, 'vendors', coalesce((
    SELECT jsonb_agg(jsonb_build_object('vendor_name', c.vendor_name, 'order_view', c.order_view, 'channel', c.channel,
             'real_send_allowed', c.real_send_allowed, 'transport', c.transport, 'calendar_source', c.calendar_source,
             'next_deliveries', to_jsonb(public.po__next_deliveries(c.delivery_weekdays, c.order_lead_days, v_today)))
           ORDER BY CASE c.vendor_name WHEN 'Hardie''s Fresh Foods / Dairyland Produce' THEN 1 WHEN 'Global Gourmet Foods' THEN 2
                                       WHEN 'Ben E. Keith' THEN 3 WHEN 'Fruge Seafood' THEN 4 ELSE 9 END, c.vendor_name)
      FROM public.po_vendor_channels c WHERE c.order_view IS NOT NULL), '[]'::jsonb));
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'PO:%' THEN RETURN public.po__err(SQLERRM); END IF; RAISE;
END $$;

REVOKE ALL ON FUNCTION public.po__next_deliveries(int[], int, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.po__next_deliveries(int[], int, date) TO service_role;
REVOKE ALL ON FUNCTION public.po_vendor_catalog(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.po_vendor_catalog(text, text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.po_vendor_list(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.po_vendor_list(text) TO anon, authenticated, service_role;
