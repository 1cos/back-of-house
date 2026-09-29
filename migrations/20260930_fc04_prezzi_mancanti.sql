-- ============================================================================
-- FC04 — "Prezzi mancanti": gli avvisi del motore, con la diagnosi, solo per
-- chi ha una sessione Brigade da amministratore.  (PROPOSTA, non applicata)
-- ============================================================================
-- Non e' un secondo motore: legge food_cost.v_chef_alerts cosi' com'e' e, per
-- ogni ingrediente, aggiunge le PROVE gia' presenti nel database:
--   * l'ultima fattura collegata a quell'ingrediente (anche senza prezzo al peso)
--   * l'ultima fattura che un prezzo al peso ce l'aveva
--   * i documenti in attesa che contengono un prodotto gia' collegato a lui
-- e da queste una diagnosi in parole semplici. Non scrive niente.
--
-- Accesso: public.fc_prezzi_mancanti(p_token) verifica la sessione esattamente
-- come brigade_reset_pin (sha256 del token in brigade_sessions, non scaduta,
-- utente attivo con is_admin). Senza sessione valida: nessun dato.
-- food_cost resta non esposto a PostgREST.
-- ============================================================================

create or replace function food_cost.missing_price_report()
returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  with a as (select * from food_cost.v_chef_alerts),
  ev as (
    select a.*,
      -- ultima riga di fattura collegata all'ingrediente, qualunque sia
      (select jsonb_build_object('vendor', l.vendor, 'date', l.invoice_date, 'number', l.invoice_number,
                                 'description', l.raw_description, 'pack', l.pack_description,
                                 'unit_price', l.unit_price, 'cost_per_100g', l.cost_per_100g)
         from public.invoice_lines l
        where l.ingredient_id = a.ingredient_id and coalesce(l.price_anomaly, false) = false
        order by l.invoice_date desc, l.created_at desc limit 1) as ultima_fattura,
      -- ultima riga con un prezzo al peso
      (select jsonb_build_object('vendor', l.vendor, 'date', l.invoice_date, 'number', l.invoice_number,
                                 'description', l.raw_description, 'pack', l.pack_description,
                                 'cost_per_100g', l.cost_per_100g)
         from public.invoice_lines l
        where l.ingredient_id = a.ingredient_id and l.cost_per_100g > 0 and coalesce(l.price_anomaly, false) = false
        order by l.invoice_date desc, l.created_at desc limit 1) as ultimo_prezzo_al_peso,
      (select count(*) from public.invoice_lines l where l.ingredient_id = a.ingredient_id) as righe_fattura,
      -- documenti non ancora importati che contengono un prodotto gia' collegato a questo ingrediente
      (select coalesce(jsonb_agg(distinct jsonb_build_object('document_id', d.id, 'vendor', d.vendor,
                                  'status', d.status, 'description', it->>'description')), '[]'::jsonb)
         from public.vendor_documents d
         cross join lateral jsonb_array_elements(coalesce(d.parsed_json -> 'items', '[]'::jsonb)) it
        where d.status in ('pending', 'error')
          and (exists (select 1 from public.ingredient_links k
                        where k.ingredient_id = a.ingredient_id and k.confirmed
                          and lower(k.invoice_description) = lower(it->>'description'))
               or exists (select 1 from public.vendor_item_aliases s
                           where s.ingredient_id = a.ingredient_id and s.active
                             and s.vendor_sku is not null and s.vendor_sku = it->>'vendor_sku'))) as documenti_in_attesa
    from a
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'ingredient_id', ingredient_id, 'ingrediente', ingrediente, 'codice', codice,
      'messaggio_motore', messaggio, 'ricette_bloccate', ricette_bloccate, 'ricette', ricette,
      'righe_fattura', righe_fattura, 'ultima_fattura', ultima_fattura,
      'ultimo_prezzo_al_peso', ultimo_prezzo_al_peso, 'documenti_in_attesa', documenti_in_attesa,
      'diagnosi', case
        -- prima il TIPO di problema: per peso al pezzo, litri/chili e unita' della
        -- ricetta la fattura non c'entra (il sale ha una stima chef ma nessuna fattura)
        when codice = 'prezzo_in_conflitto' then 'conflitto'
        when codice = 'manca_peso_al_pezzo' then 'peso_al_pezzo'
        when codice = 'manca_densita' then 'litri_chili'
        when codice = 'unita_non_convertibile' then 'unita_ricetta'
        -- poi, per il prezzo mancante, cosa dicono le fatture
        when righe_fattura = 0 and jsonb_array_length(documenti_in_attesa) = 0 then 'mai_fatturato'
        when righe_fattura = 0 then 'solo_in_attesa'
        when ultimo_prezzo_al_peso is not null then 'formato_nuovo_senza_peso'
        else 'formato_senza_peso'
      end)
    order by ricette_bloccate desc, ingrediente), '[]'::jsonb)
  from ev
$$;

create or replace function public.fc_prezzi_mancanti(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare v_sess public.brigade_sessions%rowtype; v_user public.users%rowtype;
begin
  if p_token is null or length(p_token) <> 64 then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;
  select * into v_sess from public.brigade_sessions
   where token_hash = encode(digest(p_token, 'sha256'), 'hex')
     and invalidated_at is null and expires_at > now() and absolute_expires_at > now();
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid_session'); end if;
  select * into v_user from public.users where id = v_sess.user_id and active = true;
  if not found or v_user.is_admin is not true then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  return jsonb_build_object('ok', true, 'generated_at', now(), 'items', food_cost.missing_price_report());
end $$;

revoke all on function food_cost.missing_price_report() from public, anon, authenticated;
grant execute on function food_cost.missing_price_report() to service_role;
revoke all on function public.fc_prezzi_mancanti(text) from public;
grant execute on function public.fc_prezzi_mancanti(text) to anon, authenticated, service_role;
