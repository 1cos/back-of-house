-- TS06 — Webhook ufficiale Tripleseat -> Brigade (sola lettura da Tripleseat).
--
-- Ashley Oliver (Tripleseat, ticket 562962, 06/10/2026): con il trigger UPDATE_EVENT_DOCUMENT e
-- "Include Event Payment and Line Item Information" il payload contiene le righe correnti dei documenti
-- (Kitchen Sheet / BEO). E' l'unico canale ufficiale per le righe: l'API non le espone
-- (show_financial aggiunge solo payment_set, verificato il 02/10 e il 06/10).
--
-- Flusso, tutto su Supabase (niente Mac, niente browser, niente Claude):
--   Tripleseat --POST firmato HMAC--> edge function tripleseat-webhook
--     -> tripleseat_webhook_deliveries (grezzo, sempre)
--     -> event_document_versions (una versione per ogni contenuto nuovo, righe SENZA prezzi)
--     -> tripleseat_event_kitchen_state (ospiti, orari, stato, sale)
--     -> se cambia qualcosa: office_items + push (stesso canale del sync UD02)
-- La prima versione di un documento e' la base: nessun avviso. Gli eventi di altri site Tripleseat
-- (es. i campioni del supporto) sono elaborati in modalita' prova: niente push.
-- Rollback: migrations/rollback/20261006_ts06_tripleseat_webhook_rollback.sql

begin;

create table if not exists public.tripleseat_webhook_deliveries (
  id               bigserial primary key,
  received_at      timestamptz not null default now(),
  trigger          text,
  ts_event_id      bigint,
  ts_site_id       bigint,
  signature_status text not null,          -- valid | invalid | no_key | no_signature
  signature_header text,                   -- solo il NOME dell'header
  header_names     text[],
  body_sha256      text,
  body_bytes       int,
  payload          jsonb,
  is_test          boolean not null default false,
  processed_at     timestamptz,
  result           jsonb,
  error            text
);
create index if not exists tsw_deliveries_event_idx on public.tripleseat_webhook_deliveries (ts_event_id, received_at desc);

create table if not exists public.event_document_versions (
  id               bigserial primary key,
  ts_event_id      bigint not null,
  ts_document_id   bigint not null,
  version_no       int not null,
  content_hash     text not null,
  lines            jsonb not null,         -- righe normalizzate, senza prezzi
  line_count       int not null,
  document_title   text,
  event_name       text,
  event_start      text,
  event_updated_at text,                   -- updated_at dell'evento in Tripleseat
  trigger          text,
  delivery_id      bigint references public.tripleseat_webhook_deliveries(id),
  diff             jsonb,                  -- rispetto alla versione precedente (null per la prima)
  summary          text[],                 -- righe del messaggio per la cucina
  is_test          boolean not null default false,
  received_at      timestamptz not null default now(),
  unique (ts_document_id, version_no, is_test)
);
create index if not exists edv_event_idx on public.event_document_versions (ts_event_id, received_at desc);

-- Conferma della cucina: "lavoro sulla versione corrente". Per la schermata (fase successiva).
create table if not exists public.event_document_acks (
  version_id  bigint not null references public.event_document_versions(id),
  acked_by    text not null,
  acked_at    timestamptz not null default now(),
  primary key (version_id, acked_by)
);

create table if not exists public.tripleseat_event_kitchen_state (
  ts_event_id   bigint not null,
  is_test       boolean not null default false,
  fields        jsonb not null,
  updated_at    timestamptz not null default now(),
  primary key (ts_event_id, is_test)
);

alter table public.tripleseat_webhook_deliveries  enable row level security;
alter table public.event_document_versions        enable row level security;
alter table public.event_document_acks            enable row level security;
alter table public.tripleseat_event_kitchen_state enable row level security;
revoke all on public.tripleseat_webhook_deliveries, public.event_document_versions,
              public.event_document_acks, public.tripleseat_event_kitchen_state
  from public, anon, authenticated;
revoke all on sequence public.tripleseat_webhook_deliveries_id_seq, public.event_document_versions_id_seq
  from public, anon, authenticated;
grant select, insert, update on public.tripleseat_webhook_deliveries, public.event_document_versions,
                                public.event_document_acks, public.tripleseat_event_kitchen_state to service_role;
grant usage on sequence public.tripleseat_webhook_deliveries_id_seq, public.event_document_versions_id_seq to service_role;

-- Avviso alla cucina: office_items + push agli admin/sous_chef, come UD02.
-- p_test = true: solo office_items marcato [PROVA], nessuna push.
create or replace function public.tripleseat_change_alert(
  p_ts_event_id bigint, p_title text, p_body text, p_event_start text, p_test boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_days numeric;
  v_item uuid;
  v_req bigint;
  v_title text := case when p_test then '[PROVA] ' else '' end || p_title;
begin
  begin
    v_days := extract(epoch from (p_event_start::timestamptz - now())) / 86400;
  exception when others then v_days := null;
  end;
  insert into public.office_items
    (source, source_id, from_user, bot_id, issue_type, priority, severity, category,
     title, summary, body, suggested_action, status, detected_at, last_seen_at)
  values
    ('ai_scan', 'tripleseat-webhook:' || p_ts_event_id || ':' || extract(epoch from now())::bigint,
     'tripleseat-webhook', 'tripleseat_webhook', 'tripleseat_event_change',
     case when v_days is not null and v_days >= -1 and v_days <= 3 then 'red' else 'orange' end,
     case when v_days is not null and v_days >= -1 and v_days <= 3 then 'critical' else 'warning' end,
     'eventi', v_title, left(p_body, 280), p_body,
     'Controllare il documento in Tripleseat e aggiornare prep e ordini.',
     'open', now(), now())
  returning id into v_item;

  -- evento gia' passato (piu' di un giorno fa): resta in Office, senza push (es. ritocchi di fattura)
  if not p_test and (v_days is null or v_days >= -1) then
    select net.http_post(
             url := 'https://ydqmumpytgrlceuinoqt.supabase.co/functions/v1/notifications',
             body := jsonb_build_object('table', 'chef_reports',
                       'record', jsonb_build_object('user_name', 'Tripleseat', 'station', null,
                                                    'message', v_title || ' — ' || p_body)),
             headers := jsonb_build_object('Content-Type', 'application/json'),
             timeout_milliseconds := 30000)
      into v_req;
  end if;
  return jsonb_build_object('office_item', v_item, 'push_request', v_req, 'test', p_test);
end $$;

revoke all on function public.tripleseat_change_alert(bigint, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.tripleseat_change_alert(bigint, text, text, text, boolean) to service_role;

commit;
