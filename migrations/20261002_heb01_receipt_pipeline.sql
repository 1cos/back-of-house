-- HEB01 — scontrino H-E-B dalla foto: una sola registrazione, atomica e idempotente.
--
-- Flusso: Invoice -> H-E-B -> foto -> lettura (funzione heb-receipt, nessuna
-- scrittura) -> domande minime -> Review -> Confirm Import. SOLO il Confirm
-- scrive, e lo fa qui dentro, in UNA transazione:
--   vendor_documents  (receipt, con foto/impronta, righe lette, risposte Chef)
--   invoice_lines     (una riga per confezione, importo originale = contabilita')
--   ingredient_vendors(prezzo corrente H-E-B per unita' operativa)
--   vendor_item_aliases (mappatura confermata, ricordata per i prossimi scontrini)
-- Se una qualunque verifica fallisce, non resta scritto niente.
--
-- Idempotenza: stesso scontrino (numero = negozio+data+ora+totale) o stessa
-- foto (sha256) gia' importati -> ritorna 'already_imported' senza scrivere.
-- Il trigger WM01 vendor_documents_guard_import resta la seconda barriera.
--
-- Inventario: NON toccato. Brigade non ha un movimento "ricevuto" per gli
-- ingredienti (stock_movements contiene solo scarichi POS) e lo stock delle
-- prep a pezzi (Filets, Porterhouse...) si carica dai log di produzione dello
-- staff: caricarlo anche dallo scontrino contarebbe due volte gli stessi pezzi.

-- 1) Tipo documento 'receipt' (scontrini retail). Fuori dalla Phase B del
--    worker, che seleziona solo invoice / order_confirmation / credit_memo.
alter table public.vendor_documents drop constraint vendor_documents_document_type_check;
alter table public.vendor_documents add constraint vendor_documents_document_type_check
  check (document_type = any (array['order_confirmation','invoice','credit_memo','return_request','receipt']));

-- 2) Foto originali: bucket privato, scritto solo dalla funzione (service role).
insert into storage.buckets (id, name, public)
values ('vendor-receipts', 'vendor-receipts', false)
on conflict (id) do nothing;

-- 3) Import.
create or replace function public.heb_receipt_import(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_vendor constant text := 'H-E-B';
  v_sha    text    := nullif(p->>'photo_sha256', '');
  v_num    text    := nullif(p->>'document_number', '');
  v_date   date    := nullif(p->>'receipt_date', '')::date;
  v_total  numeric := nullif(p->>'total', '')::numeric;
  v_by     text    := coalesce(nullif(p->>'by', ''), 'unknown');
  v_lines  jsonb   := coalesce(p->'lines', '[]'::jsonb);
  v_groups jsonb   := coalesce(p->'groups', '[]'::jsonb);
  v_doc uuid; v_existing uuid;
  l jsonb; g jsonb;
  v_sum numeric := 0; v_amt numeric; v_n int;
  v_ing uuid; v_ask text; v_pieces numeric; v_w numeric; v_std numeric;
  v_each numeric; v_p100 numeric; v_old jsonb;
  v_legacy jsonb := '[]'::jsonb; v_prices jsonb := '[]'::jsonb;
begin
  if v_sha is null or v_num is null or v_date is null then
    raise exception 'HEB01: photo, receipt number and date are required' using errcode = 'check_violation';
  end if;

  -- due Confirm contemporanei sullo stesso scontrino: il secondo aspetta e poi trova 'imported'
  perform pg_advisory_xact_lock(hashtext('heb01:' || v_sha));
  perform pg_advisory_xact_lock(hashtext('heb01:' || v_num));

  select id into v_existing from public.vendor_documents
   where vendor = c_vendor and document_type = 'receipt' and status = 'imported'
     and (document_number = v_num or parsed_json->>'photo_sha256' = v_sha)
   limit 1;
  if v_existing is not null then
    return jsonb_build_object('status', 'already_imported', 'document_id', v_existing);
  end if;

  -- righe: importo valido e gruppo con risposta
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'HEB01: the receipt has no lines' using errcode = 'check_violation';
  end if;
  for l in select * from jsonb_array_elements(v_lines) loop
    v_amt := nullif(l->>'amount', '')::numeric;
    if v_amt is null or v_amt <= 0 then
      raise exception 'HEB01: line % has no valid amount', coalesce(l->>'idx', '?') using errcode = 'check_violation';
    end if;
    if not exists (select 1 from jsonb_array_elements(v_groups) x where x->>'key' = l->>'key') then
      raise exception 'HEB01: line % (%) has no answer', coalesce(l->>'idx', '?'), l->>'description' using errcode = 'check_violation';
    end if;
    v_sum := v_sum + v_amt;
  end loop;

  -- il totale deve tornare al centesimo
  if v_total is null or abs(v_total - v_sum) >= 0.005 then
    raise exception 'HEB01: lines add up to % but the receipt total is %', round(v_sum, 2), v_total using errcode = 'check_violation';
  end if;

  -- gruppi: ingrediente esistente + denominatore (pezzi interi o libbre)
  for g in select * from jsonb_array_elements(v_groups) loop
    v_ing := nullif(g->>'ingredient_id', '')::uuid;
    if v_ing is null or not exists (select 1 from public.ingredients where id = v_ing) then
      raise exception 'HEB01: "%" is not linked to a Brigade ingredient', g->>'key' using errcode = 'check_violation';
    end if;
    v_ask := coalesce(g->>'ask', 'pieces');
    if v_ask = 'pieces' then
      v_pieces := nullif(g->>'pieces', '')::numeric;
      if v_pieces is null or v_pieces <= 0 or v_pieces <> trunc(v_pieces) then
        raise exception 'HEB01: "%" needs a whole number of pieces', g->>'key' using errcode = 'check_violation';
      end if;
    elsif v_ask = 'weight' then
      v_w := nullif(g->>'weight_lb', '')::numeric;
      if v_w is null or v_w <= 0 then
        raise exception 'HEB01: "%" needs the weight in lb', g->>'key' using errcode = 'check_violation';
      end if;
    else
      raise exception 'HEB01: unknown unit "%"', v_ask using errcode = 'check_violation';
    end if;
    if not exists (select 1 from jsonb_array_elements(v_lines) x where x->>'key' = g->>'key') then
      raise exception 'HEB01: answer for "%" matches no line', g->>'key' using errcode = 'check_violation';
    end if;
  end loop;

  -- documento (pending dentro la transazione; imported alla fine)
  insert into public.vendor_documents (vendor, document_type, document_number, document_date, status, uploaded_by, raw_text, parsed_json)
  values (c_vendor, 'receipt', v_num, v_date, 'pending', v_by, p->>'raw_text',
          jsonb_build_object('source', 'heb_receipt', 'photo_sha256', v_sha, 'photo_path', p->>'photo_path',
                             'store', p->>'store', 'receipt_time', p->>'receipt_time', 'total', v_total,
                             'items', v_lines, 'groups', v_groups))
  returning id into v_doc;

  for g in select * from jsonb_array_elements(v_groups) loop
    v_ing := (g->>'ingredient_id')::uuid;
    v_ask := coalesce(g->>'ask', 'pieces');
    v_pieces := nullif(g->>'pieces', '')::numeric;
    v_w := nullif(g->>'weight_lb', '')::numeric;
    v_std := nullif(g->>'std_g', '')::numeric;
    select sum((x->>'amount')::numeric), count(*) into v_amt, v_n
      from jsonb_array_elements(v_lines) x where x->>'key' = g->>'key';

    if v_ask = 'pieces' then
      v_each := v_amt / v_pieces;
      v_p100 := case when v_std > 0 then v_each / v_std * 100 end;
    else
      v_each := null;
      v_p100 := v_amt / (v_w * 453.592) * 100;
    end if;

    -- una riga per confezione: l'importo stampato resta la verita' contabile
    insert into public.invoice_lines
      (import_id, invoice_date, invoice_number, vendor, raw_description, ingredient_id, match_status, match_confidence,
       qty, purchase_unit, pack_description, unit_price, line_total, cost_per_100g, count_unit, avg_unit_weight_g)
    select v_doc, v_date, v_num, c_vendor, x->>'description', v_ing, 'matched', 1,
           1, 'package',
           case when v_ask = 'pieces' then format('1 of %s package(s) · %s pieces in total', v_n, v_pieces)
                else format('1 of %s package(s) · %s lb in total', v_n, v_w) end,
           (x->>'amount')::numeric, (x->>'amount')::numeric,
           case when nullif(x->>'weight_lb', '')::numeric > 0
                  then round((x->>'amount')::numeric / ((x->>'weight_lb')::numeric * 453.592) * 100, 4)
                when v_p100 is not null then round(v_p100, 4) end,
           case when v_ask = 'pieces' then 'each' else 'weight' end,
           v_std
      from jsonb_array_elements(v_lines) x where x->>'key' = g->>'key';

    -- prezzo corrente H-E-B; la riga precedente (anche quella sbagliata di giugno) resta nel documento
    select to_jsonb(iv) into v_old from public.ingredient_vendors iv where iv.ingredient_id = v_ing and iv.vendor = c_vendor;
    if v_old is not null then v_legacy := v_legacy || jsonb_build_array(v_old); end if;

    insert into public.ingredient_vendors as iv
      (ingredient_id, vendor, purchase_unit, pack_description, unit_price, price_type, price_per_each, price_per_100g,
       conversion_to_base, last_invoice_date, active)
    values (v_ing, c_vendor,
            case when v_ask = 'pieces' then 'each' else 'lb' end,
            case when v_ask = 'pieces' then format('per piece · receipt %s', v_num) else format('per lb · receipt %s', v_num) end,
            case when v_ask = 'pieces' then round(v_each, 4) else round(v_amt / v_w, 4) end,
            case when v_ask = 'pieces' then 'per_each' else 'per_lb' end,
            case when v_ask = 'pieces' then round(v_each, 4) end,
            v_p100, null, v_date, true)
    on conflict (ingredient_id, vendor) do update
       set purchase_unit = excluded.purchase_unit, pack_description = excluded.pack_description,
           unit_price = excluded.unit_price, price_type = excluded.price_type,
           price_per_each = excluded.price_per_each, price_per_100g = excluded.price_per_100g,
           conversion_to_base = null, last_invoice_date = excluded.last_invoice_date, active = true
     where iv.last_invoice_date is null or iv.last_invoice_date <= excluded.last_invoice_date;

    -- memoria: la mappatura e il tipo di domanda, MAI il numero di pezzi
    insert into public.vendor_item_aliases (vendor, vendor_description, ingredient_id, confirmed_by, confirmed_at, active, notes)
    values (c_vendor, g->>'key', v_ing, v_by, now(), true,
            jsonb_build_object('ask', v_ask, 'std_g', v_std, 'source', 'heb01')::text)
    on conflict (vendor, vendor_description) do update
       set ingredient_id = excluded.ingredient_id, confirmed_by = excluded.confirmed_by,
           confirmed_at = excluded.confirmed_at, active = true, notes = excluded.notes;

    v_prices := v_prices || jsonb_build_array(jsonb_build_object(
      'key', g->>'key', 'ingredient_id', v_ing, 'packages', v_n, 'amount', round(v_amt, 2), 'ask', v_ask,
      'pieces', v_pieces, 'weight_lb', v_w, 'cost_each', round(v_each, 2), 'cost_per_100g', round(v_p100, 4), 'std_g', v_std));
  end loop;

  update public.vendor_documents
     set status = 'imported',
         parsed_json = parsed_json || jsonb_build_object('derived', v_prices, 'legacy_prices_replaced', v_legacy,
                                                         'imported_by', v_by, 'imported_at', now())
   where id = v_doc;

  return jsonb_build_object('status', 'imported', 'document_id', v_doc,
                            'lines', jsonb_array_length(v_lines), 'prices', v_prices);
end
$$;

revoke all on function public.heb_receipt_import(jsonb) from public, anon, authenticated;
grant execute on function public.heb_receipt_import(jsonb) to service_role;

-- Undo:
--   drop function public.heb_receipt_import(jsonb);
--   (bucket e vincolo possono restare: senza la funzione nessuno li usa)
