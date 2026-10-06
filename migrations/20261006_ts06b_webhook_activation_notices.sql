-- TS06b — Il webhook Tripleseat si controlla da solo.
-- Max (06/10): "concentrati sull'attivazione, sulla prova reale e sulla verifica che Brigade riceva le
-- modifiche e avvisi la cucina autonomamente". Quindi Brigade dice da sola, senza Claude:
--   * al PRIMO invio vero e firmato da Tripleseat (site Zeno's): "Webhook Tripleseat attivo" (una volta);
--   * se arrivano invii veri con firma non valida o assente (chiave non incollata o sbagliata):
--     un avviso rosso, aperto finche' non arriva un invio firmato bene, che lo chiude da solo.
-- Rollback: drop function public.tripleseat_webhook_notice(text, text, text, text);

begin;

create or replace function public.tripleseat_webhook_notice(
  p_kind text,            -- 'valid' | 'signature'
  p_event_name text,
  p_trigger text,
  p_detail text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  c_bot constant text := 'tripleseat_webhook';
  v_item uuid;
  v_closed int := 0;
  v_title text;
  v_body text;
  v_req bigint;
begin
  perform pg_advisory_xact_lock(hashtext('ts06_webhook_notice'));

  if p_kind = 'valid' then
    update public.office_items
       set status = 'resolved', resolved_by = 'tripleseat-webhook', resolved_at = now(), updated_at = now(),
           resolution = 'arrivato un invio con firma valida'
     where bot_id = c_bot and source_id = 'tripleseat-webhook:signature' and status = 'open';
    get diagnostics v_closed = row_count;
    if exists (select 1 from public.office_items where bot_id = c_bot and source_id = 'tripleseat-webhook:first_ok') then
      return jsonb_build_object('notice', null, 'closed', v_closed);
    end if;
    v_title := 'Webhook Tripleseat attivo';
    v_body  := 'Brigade ha ricevuto il primo invio firmato da Tripleseat (' || coalesce(p_trigger, '?')
            || coalesce(', «' || p_event_name || '»', '') || '). Da ora le modifiche a menu, ospiti e orari '
            || 'arrivano da sole e la cucina viene avvisata.';
    insert into public.office_items
      (source, source_id, from_user, bot_id, issue_type, priority, severity, category,
       title, summary, body, suggested_action, status, detected_at, last_seen_at)
    values ('ai_scan', 'tripleseat-webhook:first_ok', 'tripleseat-webhook', c_bot, 'tripleseat_webhook_active',
            'blue', 'info', 'eventi', v_title, left(v_body, 280), v_body,
            'Nessuna azione: e'' la conferma che il collegamento funziona.', 'open', now(), now())
    returning id into v_item;

  elsif p_kind = 'signature' then
    select id into v_item from public.office_items
     where bot_id = c_bot and source_id = 'tripleseat-webhook:signature' and status = 'open' limit 1;
    if v_item is not null then
      update public.office_items set last_seen_at = now(), updated_at = now(),
             times_seen = coalesce(times_seen, 1) + 1 where id = v_item;
      return jsonb_build_object('notice', v_item, 'repeat', true);
    end if;
    v_title := 'Webhook Tripleseat: firma non verificata';
    v_body  := 'Tripleseat sta inviando le modifiche, ma Brigade non riesce a verificarne la firma ('
            || coalesce(p_detail, '?') || '). Gli invii sono salvati ma NON elaborati: la cucina non riceve '
            || 'avvisi finche'' non si sistema. Controllare che il secret TS_WEBHOOK_SIGNING_KEY in Supabase '
            || 'sia la Signing Key del webhook in Tripleseat (API Settings > Webhooks).';
    insert into public.office_items
      (source, source_id, from_user, bot_id, issue_type, priority, severity, category,
       title, summary, body, suggested_action, status, detected_at, last_seen_at)
    values ('ai_scan', 'tripleseat-webhook:signature', 'tripleseat-webhook', c_bot, 'tripleseat_webhook_signature',
            'red', 'critical', 'eventi', v_title, left(v_body, 280), v_body,
            'Incollare la Signing Key giusta in Supabase; poi salvare di nuovo un documento di prova.', 'open', now(), now())
    returning id into v_item;
  else
    raise exception 'TS06b: tipo sconosciuto %', p_kind;
  end if;

  select net.http_post(
           url := 'https://ydqmumpytgrlceuinoqt.supabase.co/functions/v1/notifications',
           body := jsonb_build_object('table', 'chef_reports',
                     'record', jsonb_build_object('user_name', 'Tripleseat', 'station', null,
                                                  'message', v_title || ' — ' || v_body)),
           headers := jsonb_build_object('Content-Type', 'application/json'),
           timeout_milliseconds := 30000)
    into v_req;
  return jsonb_build_object('notice', v_item, 'closed', v_closed, 'push_request', v_req);
end $$;

revoke all on function public.tripleseat_webhook_notice(text, text, text, text) from public, anon, authenticated;
grant execute on function public.tripleseat_webhook_notice(text, text, text, text) to service_role;

commit;
