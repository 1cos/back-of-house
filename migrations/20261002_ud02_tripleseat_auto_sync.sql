-- UD02 — Sync automatico Tripleseat -> public.events (sola lettura da Tripleseat).
-- GO di Max in sessione 02/10/2026: "sync automatico si'".
--
-- Catena (pg_cron, UTC):
--   :37 alle 09 e 19 UTC (04:37 / 14:37 CDT, 03:37 / 13:37 CST)  ud02-tripleseat-shadow
--        -> public.events_sync_invoke_shadow(): POST a tripleseat-oauth-shadow {action:'test', days:120}
--           (OAuth2 read-only, solo GET su api.tripleseat.com; scrive solo tripleseat_shadow_*).
--           La chiave x-shadow-key e' letta da Vault (nome 'ts_shadow_key'): niente segreti nel codice,
--           in cron.job o nei log.
--   :43 alle 09 e 19 UTC                                         ud02-events-apply
--        -> public.events_sync_apply_shadow('cron', '15 minutes'): applica l'ultimo run shadow ok a events.
--   Minuti 37/43: mai multipli di 5, quindi mai insieme al job 19 (*/5, vendor-doc-auto-import).
--
-- Regole (identiche a UD01, 20261002_ud01_events_from_shadow.sql):
--   identita' events.tripleseat_id = shadow.ts_event_id::text; stesso mapping dei campi;
--   un campo cambia solo se il valore shadow e' non nullo e diverso; updated_at/last_synced_at solo sulle
--   righe che cambiano (cosi' un secondo giro senza novita' non scrive nulla);
--   mai toccati notes, documents, event_recipes; righe source<>'tripleseat' (la manuale) intatte;
--   LOST / CANCELLED / CANCELED / deleted_at non vengono inseriti.
-- In piu' (UD02):
--   evento esistente che nello shadow diventa LOST/cancellato/eliminato -> status='cancelled' (mai delete);
--   evento futuro (dentro la finestra di 120 gg) sparito dallo shadow -> NON toccato, contato "da verificare";
--   evento 'cancelled' in Brigade ma attivo in Tripleseat -> NON riattivato (decisione manuale di Max
--     possibile, es. Melany Loftin), contato "da verificare";
--   run piu' vecchio di 26 ore o con errore -> non applicato;
--   lock advisory: due esecuzioni non si sovrappongono.
-- Allarme solo al CAMBIO di stato (ok / oauth_error / run_failed / stale / apply_error):
--   office_items (source 'ai_scan', bot_id 'tripleseat_events_sync', una voce aperta per stato) +
--   push agli admin/sous_chef via edge function notifications {table:'chef_reports'} (come il worker BEK).
--   Al rientro a 'ok' le voci aperte del bot vengono chiuse (resolved) e parte una push "di nuovo ok".
--
-- Prerequisito (NON in questo file, va creato a mano dal Dashboard > Vault): secret 'ts_shadow_key' = valore di
--   TS_SHADOW_KEY della funzione. Senza, il job shadow fallisce e il giro apply lo segnala (run_failed).
-- Rollback: migrations/rollback/20261002_ud02_tripleseat_auto_sync_rollback.sql
-- Non toccati: tripleseat-sync (stub 410), vendor-doc-auto-import / job 19, frontend, ricette, note, documenti.

begin;

-- ── Log dei giri ─────────────────────────────────────────────────────────────
create table if not exists public.events_sync_runs (
  id                bigserial primary key,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  trigger           text not null default 'manual',
  shadow_run_id     uuid,
  shadow_started_at timestamptz,
  outcome           text not null,          -- applied | skipped_stale | skipped_no_run | apply_error
  health            text not null,          -- ok | oauth_error | run_failed | stale | apply_error
  inserted          int not null default 0,
  updated           int not null default 0,
  cancelled         int not null default 0,
  to_verify         int not null default 0,
  details           jsonb not null default '{}'::jsonb,   -- tripleseat_id e nomi dei campi, niente contatti
  error             text
);
create index if not exists events_sync_runs_started_idx on public.events_sync_runs (started_at desc);

-- Stato gia' avvisato (una riga). Parte da 'ok': un problema gia' in corso viene detto una volta.
create table if not exists public.events_sync_state (
  id         int primary key default 1 check (id = 1),
  health     text not null default 'ok',
  since      timestamptz not null default now(),
  office_item_id uuid,
  updated_at timestamptz not null default now()
);
insert into public.events_sync_state (id) values (1) on conflict (id) do nothing;

alter table public.events_sync_runs  enable row level security;
alter table public.events_sync_state enable row level security;
revoke all on public.events_sync_runs, public.events_sync_state from public, anon, authenticated;
revoke all on sequence public.events_sync_runs_id_seq from public, anon, authenticated;
grant select, insert, update on public.events_sync_runs, public.events_sync_state to service_role;
grant usage on sequence public.events_sync_runs_id_seq to service_role;

-- ── Invocazione della funzione shadow (chiave da Vault) ──────────────────────
create or replace function public.events_sync_invoke_shadow()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_key text;
  v_req bigint;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'ts_shadow_key' limit 1;
  if v_key is null or length(btrim(v_key)) = 0 then
    raise exception 'UD02: secret Vault ts_shadow_key mancante';
  end if;
  select net.http_post(
           url := 'https://ydqmumpytgrlceuinoqt.supabase.co/functions/v1/tripleseat-oauth-shadow',
           body := jsonb_build_object('action', 'test', 'days', 120),
           headers := jsonb_build_object('Content-Type', 'application/json', 'x-shadow-key', btrim(v_key)),
           timeout_milliseconds := 120000)
    into v_req;
  return v_req;   -- solo l'id della richiesta pg_net, mai la chiave
end $$;

-- ── Allarme al cambio di stato ───────────────────────────────────────────────
create or replace function public.events_sync_alert(p_health text, p_detail text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  c_bot constant text := 'tripleseat_events_sync';
  c_src constant text := 'tripleseat-events-sync';
  v_prev text;
  v_title text;
  v_body text;
  v_item uuid;
  v_closed int := 0;
  v_req bigint;
begin
  select health into v_prev from public.events_sync_state where id = 1 for update;
  v_prev := coalesce(v_prev, 'ok');
  if p_health = v_prev then
    return jsonb_build_object('sent', false, 'state', v_prev);
  end if;

  if p_health = 'ok' then
    v_title := 'Tripleseat -> Brigade: di nuovo OK';
    v_body  := 'Tripleseat -> Brigade: il sync automatico degli eventi funziona di nuovo (prima: ' || v_prev || ').';
    update public.office_items
       set status = 'resolved', resolved_by = c_src, resolved_at = now(), updated_at = now(),
           resolution = 'il giro successivo del sync e'' andato a buon fine'
     where bot_id = c_bot and status = 'open';
    get diagnostics v_closed = row_count;
  else
    v_title := case p_health
      when 'oauth_error' then 'Tripleseat -> Brigade: collegamento OAuth da rifare'
      when 'stale'       then 'Tripleseat -> Brigade: eventi non aggiornati da piu'' di 26 ore'
      when 'apply_error' then 'Tripleseat -> Brigade: errore nell''aggiornare gli eventi'
      else                    'Tripleseat -> Brigade: lettura Tripleseat fallita' end;
    v_body := case p_health
      when 'oauth_error' then 'Tripleseat: la connessione read-only (app "Brigade read-only test 2") non e'' piu'' valida (token scaduto o revocato). Va rifatto il collegamento (Authorize) con Max al Mac. '
      when 'stale'       then 'Tripleseat: nessuna lettura riuscita nelle ultime 26 ore, gli eventi in Brigade possono essere vecchi. '
      when 'apply_error' then 'Tripleseat: lettura ok ma l''aggiornamento della tabella eventi e'' fallito. '
      else                    'Tripleseat: l''ultima lettura automatica degli eventi e'' fallita. ' end
      || 'Brigade mostra gli eventi dell''ultimo aggiornamento riuscito; nulla viene cancellato. Nessuna scrittura su Tripleseat.'
      || coalesce(' Dettaglio: ' || left(p_detail, 160), '');
    -- la voce dello stato precedente e' superata
    update public.office_items
       set status = 'resolved', resolved_by = c_src, resolved_at = now(), updated_at = now(),
           resolution = 'sostituita dallo stato ' || p_health
     where bot_id = c_bot and status = 'open' and source_id <> c_src || ':' || p_health;
    select id into v_item from public.office_items
     where bot_id = c_bot and source_id = c_src || ':' || p_health and status = 'open' limit 1;
    if v_item is not null then
      update public.office_items
         set last_seen_at = now(), updated_at = now(), times_seen = coalesce(times_seen, 1) + 1, body = v_body
       where id = v_item;
    else
      insert into public.office_items
        (source, source_id, from_user, bot_id, issue_type, priority, severity, category,
         title, summary, body, suggested_action, status, detected_at, last_seen_at)
      values
        ('ai_scan', c_src || ':' || p_health, c_src, c_bot, 'tripleseat_sync_' || p_health,
         case when p_health in ('oauth_error','stale') then 'red' else 'orange' end,
         case when p_health in ('oauth_error','stale') then 'critical' else 'warning' end,
         'eventi', v_title, left(v_body, 280), v_body,
         case p_health when 'oauth_error' then 'Max + Claude Code: rifare Authorize di tripleseat-oauth-shadow.'
                       else 'Controllare events_sync_runs e tripleseat_shadow_runs.' end,
         'open', now(), now())
      returning id into v_item;
    end if;
  end if;

  update public.events_sync_state
     set health = p_health, since = now(), office_item_id = v_item, updated_at = now()
   where id = 1;

  -- push (asincrona) agli admin/sous_chef: stesso formato di Tell Chef / worker BEK
  select net.http_post(
           url := 'https://ydqmumpytgrlceuinoqt.supabase.co/functions/v1/notifications',
           body := jsonb_build_object('table', 'chef_reports',
                     'record', jsonb_build_object('user_name', 'Tripleseat sync', 'station', null,
                                                  'message', v_title || ' — ' || v_body)),
           headers := jsonb_build_object('Content-Type', 'application/json'),
           timeout_milliseconds := 30000)
    into v_req;

  return jsonb_build_object('sent', true, 'from', v_prev, 'to', p_health, 'office_item', v_item,
                            'closed', v_closed, 'push_request', v_req);
end $$;

-- ── Applicazione dell'ultimo run shadow ok ───────────────────────────────────
create or replace function public.events_sync_apply_shadow(
  p_trigger text default 'manual',
  p_expect_run_within interval default null,   -- dal cron: un run deve essere partito da poco
  p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  c_max_age constant interval := interval '26 hours';
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_started timestamptz := clock_timestamp();
  v_last record;
  v_ok record;
  v_health text := 'ok';
  v_outcome text;
  v_error text;
  v_n_rows int;
  v_win_end date;
  v_ins int := 0; v_upd int := 0; v_can int := 0; v_ver int := 0;
  v_d_ins jsonb := '[]'; v_d_upd jsonb := '[]'; v_d_can jsonb := '[]'; v_d_ver jsonb := '[]';
  v_alert jsonb;
  v_run_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('ud02_events_sync_apply'));

  -- ultimo tentativo (escluso il callback OAuth, che non legge eventi) e ultimo run ok
  select run_id, started_at, finished_at, ok, error, counts into v_last
    from public.tripleseat_shadow_runs
   where error is null or error not like 'exchange:%'
   order by started_at desc limit 1;
  select run_id, started_at, finished_at, ok, counts into v_ok
    from public.tripleseat_shadow_runs where ok order by started_at desc limit 1;

  if v_last.run_id is not null and not v_last.ok then
    v_health := case when v_last.error ~* '(refresh failed|not_connected|expired|invalid_grant|invalid_client|invalid_token|unauthorized|HTTP 401|HTTP 403)'
                     then 'oauth_error' else 'run_failed' end;
    v_error := 'ultimo run shadow fallito: ' || left(coalesce(v_last.error, '?'), 200);
  elsif p_expect_run_within is not null and (v_last.run_id is null or v_last.started_at < now() - p_expect_run_within) then
    v_health := 'run_failed';
    v_error := 'nessun run shadow negli ultimi ' || p_expect_run_within::text
               || case when not exists (select 1 from vault.secrets where name = 'ts_shadow_key')
                       then ': manca il secret Vault ts_shadow_key' else ' (invocazione fallita?)' end;
  end if;

  if v_ok.run_id is null or v_ok.finished_at < now() - c_max_age then
    v_outcome := case when v_ok.run_id is null then 'skipped_no_run' else 'skipped_stale' end;
    if v_health = 'ok' then v_health := 'stale'; end if;
    v_error := coalesce(v_error || '; ', '') || 'nessun run ok nelle ultime 26 ore: niente applicato';
  else
    select count(*) into v_n_rows from public.tripleseat_shadow_events where run_id = v_ok.run_id;
    if v_n_rows <> coalesce((v_ok.counts->>'events')::int, -1) then
      v_outcome := 'apply_error';
      v_health := 'apply_error';
      v_error := coalesce(v_error || '; ', '') || format('run incompleto: %s righe shadow, counts.events=%s', v_n_rows, v_ok.counts->>'events');
    else
      v_win_end := (v_ok.started_at at time zone 'UTC')::date + 119;
      begin
        -- sorgente: una riga per evento (la piu' recente del run)
        create temp table if not exists _ud02_src (
          tripleseat_id text primary key, active boolean, name text, event_date date, event_time time,
          guest_count int, menu_type text, location text, room_name text, status text, contact_name text,
          contact_email text, contact_phone text, total_amount numeric, service_style text) on commit drop;
        truncate _ud02_src;
        insert into _ud02_src
        select distinct on (t.ts_event_id)
               t.ts_event_id::text,
               upper(coalesce(t.status,'')) not in ('LOST','CANCELLED','CANCELED') and t.payload->>'deleted_at' is null,
               nullif(btrim(t.name),''),
               t.event_date,
               to_timestamp(nullif(btrim(t.payload->>'event_start_time'),''),'HH12:MI AM')::time,
               t.guest_count,
               nullif(btrim(t.payload->>'event_type'),''),
               nullif(btrim(t.payload->'location'->>'name'),''),
               (select nullif(string_agg(r->>'name', ', ' order by r->>'name'),'')
                  from jsonb_array_elements(coalesce(t.payload->'rooms','[]'::jsonb)) r),
               nullif(lower(btrim(t.status)),''),
               nullif(btrim(concat_ws(' ', nullif(btrim(t.payload->'contact'->>'first_name'),''),
                                           nullif(btrim(t.payload->'contact'->>'last_name'),''))),''),
               nullif(btrim(t.payload->'contact'->'email_addresses'->0->>'address'),''),
               nullif(regexp_replace(coalesce(t.payload->'contact'->'phone_numbers'->0->>'number',''),'\D','','g'),''),
               nullif(t.payload->>'grand_total','')::numeric,
               case t.payload->>'event_style' when 'onpremise' then 'On-Premise Event'
                                              when 'catering'  then 'Full-Service Catering' end
          from public.tripleseat_shadow_events t
         where t.run_id = v_ok.run_id
         order by t.ts_event_id, t.id desc;

        -- 1) update: solo righe tripleseat attive (non 'cancelled'), solo campi shadow non nulli e diversi
        with diff as (
          select e.id, s.*,
                 array_remove(array[
                   case when s.name          is not null and s.name          is distinct from e.name          then 'name' end,
                   case when s.event_date    is not null and s.event_date    is distinct from e.event_date    then 'event_date' end,
                   case when s.event_time    is not null and s.event_time    is distinct from e.event_time    then 'event_time' end,
                   case when s.guest_count   is not null and s.guest_count   is distinct from e.guest_count   then 'guest_count' end,
                   case when s.menu_type     is not null and s.menu_type     is distinct from e.menu_type     then 'menu_type' end,
                   case when s.location      is not null and s.location      is distinct from e.location      then 'location' end,
                   case when s.room_name     is not null and s.room_name     is distinct from e.room_name     then 'room_name' end,
                   case when s.status        is not null and s.status        is distinct from e.status        then 'status' end,
                   case when s.contact_name  is not null and s.contact_name  is distinct from e.contact_name  then 'contact_name' end,
                   case when s.contact_email is not null and s.contact_email is distinct from e.contact_email then 'contact_email' end,
                   case when s.contact_phone is not null and s.contact_phone is distinct from e.contact_phone then 'contact_phone' end,
                   case when s.total_amount  is not null and s.total_amount  is distinct from e.total_amount  then 'total_amount' end,
                   case when s.service_style is not null and s.service_style is distinct from e.service_style then 'service_style' end
                 ], null) as fields
            from _ud02_src s
            join public.events e on e.tripleseat_id = s.tripleseat_id
           where s.active and e.source = 'tripleseat' and coalesce(e.status,'') <> 'cancelled'
        ), upd as (
          update public.events e
             set name          = coalesce(d.name, e.name),
                 event_date    = coalesce(d.event_date, e.event_date),
                 event_time    = coalesce(d.event_time, e.event_time),
                 guest_count   = coalesce(d.guest_count, e.guest_count),
                 menu_type     = coalesce(d.menu_type, e.menu_type),
                 location      = coalesce(d.location, e.location),
                 room_name     = coalesce(d.room_name, e.room_name),
                 status        = coalesce(d.status, e.status),
                 contact_name  = coalesce(d.contact_name, e.contact_name),
                 contact_email = coalesce(d.contact_email, e.contact_email),
                 contact_phone = coalesce(d.contact_phone, e.contact_phone),
                 total_amount  = coalesce(d.total_amount, e.total_amount),
                 service_style = coalesce(d.service_style, e.service_style),
                 updated_at = now(), last_synced_at = now()
            from diff d
           where e.id = d.id and cardinality(d.fields) > 0
          returning e.tripleseat_id, d.fields
        )
        select count(*), coalesce(jsonb_agg(jsonb_build_object('tripleseat_id', tripleseat_id, 'fields', to_jsonb(fields))), '[]')
          into v_upd, v_d_upd from upd;

        -- 2) LOST / cancellati / eliminati in Tripleseat -> status 'cancelled' (mai delete)
        with can as (
          update public.events e
             set status = 'cancelled', updated_at = now(), last_synced_at = now()
            from _ud02_src s
           where not s.active and e.tripleseat_id = s.tripleseat_id
             and e.source = 'tripleseat' and coalesce(e.status,'') <> 'cancelled'
          returning e.tripleseat_id, s.status as ts_status
        )
        select count(*), coalesce(jsonb_agg(jsonb_build_object('tripleseat_id', tripleseat_id, 'ts_status', ts_status)), '[]')
          into v_can, v_d_can from can;

        -- 3) nuovi eventi attivi
        with ins as (
          insert into public.events
            (name, event_date, event_time, guest_count, menu_type, location, room_name, status,
             contact_name, contact_email, contact_phone, total_amount, service_style,
             source, tripleseat_id, last_synced_at)
          select s.name, s.event_date, s.event_time, s.guest_count, s.menu_type, s.location, s.room_name, s.status,
                 s.contact_name, s.contact_email, s.contact_phone, s.total_amount, s.service_style,
                 'tripleseat', s.tripleseat_id, now()
            from _ud02_src s
           where s.active and s.name is not null and s.event_date is not null
             and not exists (select 1 from public.events e where e.tripleseat_id = s.tripleseat_id)
          returning tripleseat_id, event_date
        )
        select count(*), coalesce(jsonb_agg(jsonb_build_object('tripleseat_id', tripleseat_id, 'event_date', event_date)), '[]')
          into v_ins, v_d_ins from ins;

        -- 4) da verificare (nessuna scrittura): futuri spariti dallo shadow, o cancellati in Brigade ma attivi in Tripleseat
        select count(*), coalesce(jsonb_agg(jsonb_build_object('tripleseat_id', x.tripleseat_id, 'event_date', x.event_date, 'reason', x.reason)
                                            order by x.event_date), '[]')
          into v_ver, v_d_ver
          from (
            select e.tripleseat_id, e.event_date, 'assente dallo shadow' as reason
              from public.events e
             where e.source = 'tripleseat' and e.tripleseat_id is not null
               and coalesce(e.status,'') <> 'cancelled'
               and e.event_date between v_today and v_win_end
               and not exists (select 1 from _ud02_src s where s.tripleseat_id = e.tripleseat_id)
            union all
            select e.tripleseat_id, e.event_date, 'cancelled in Brigade, ' || s.status || ' in Tripleseat'
              from public.events e join _ud02_src s on s.tripleseat_id = e.tripleseat_id
             where s.active and e.source = 'tripleseat' and e.status = 'cancelled'
          ) x;

        v_outcome := 'applied';
        if p_dry_run then
          raise exception using errcode = 'P0D01', message = 'dry run';
        end if;
      exception
        when sqlstate 'P0D01' then null;   -- dry run: tutto annullato, conteggi tenuti
        when others then
          v_outcome := 'apply_error';
          v_health := 'apply_error';
          v_error := coalesce(v_error || '; ', '') || left(sqlerrm, 300);
          v_ins := 0; v_upd := 0; v_can := 0; v_ver := 0;
      end;
    end if;
  end if;

  if p_dry_run then
    return jsonb_build_object('dry_run', true, 'outcome', v_outcome, 'health', v_health,
      'shadow_run_id', v_ok.run_id, 'shadow_started_at', v_ok.started_at,
      'inserted', v_ins, 'updated', v_upd, 'cancelled', v_can, 'to_verify', v_ver,
      'details', jsonb_build_object('inserted', v_d_ins, 'updated', v_d_upd, 'cancelled', v_d_can, 'to_verify', v_d_ver),
      'error', v_error);
  end if;

  begin
    v_alert := public.events_sync_alert(v_health, v_error);
  exception when others then
    v_alert := jsonb_build_object('sent', false, 'error', left(sqlerrm, 200));
  end;

  insert into public.events_sync_runs
    (started_at, finished_at, trigger, shadow_run_id, shadow_started_at, outcome, health,
     inserted, updated, cancelled, to_verify, details, error)
  values
    (v_started, clock_timestamp(), coalesce(p_trigger, 'manual'), v_ok.run_id, v_ok.started_at, v_outcome, v_health,
     v_ins, v_upd, v_can, v_ver,
     jsonb_build_object('inserted', v_d_ins, 'updated', v_d_upd, 'cancelled', v_d_can, 'to_verify', v_d_ver,
                        'last_attempt', v_last.run_id, 'alert', v_alert),
     v_error)
  returning id into v_run_id;

  return jsonb_build_object('sync_run', v_run_id, 'outcome', v_outcome, 'health', v_health,
    'shadow_run_id', v_ok.run_id, 'shadow_started_at', v_ok.started_at,
    'inserted', v_ins, 'updated', v_upd, 'cancelled', v_can, 'to_verify', v_ver, 'error', v_error, 'alert', v_alert);
end $$;

-- ── Permessi: solo postgres (owner) e service_role ───────────────────────────
alter function public.events_sync_invoke_shadow() owner to postgres;
alter function public.events_sync_alert(text, text) owner to postgres;
alter function public.events_sync_apply_shadow(text, interval, boolean) owner to postgres;
revoke all on function public.events_sync_invoke_shadow() from public, anon, authenticated;
revoke all on function public.events_sync_alert(text, text) from public, anon, authenticated;
revoke all on function public.events_sync_apply_shadow(text, interval, boolean) from public, anon, authenticated;
grant execute on function public.events_sync_invoke_shadow() to service_role;
grant execute on function public.events_sync_alert(text, text) to service_role;
grant execute on function public.events_sync_apply_shadow(text, interval, boolean) to service_role;

-- ── Schedulazione ────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'ts_shadow_key') then
    raise notice 'UD02: secret Vault ts_shadow_key ancora assente: il job shadow fallira'' (e il giro apply lo segnalera'') finche'' non viene creato';
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname in ('ud02-tripleseat-shadow', 'ud02-events-apply');
  perform cron.schedule('ud02-tripleseat-shadow', '37 9,19 * * *', 'select public.events_sync_invoke_shadow()');
  perform cron.schedule('ud02-events-apply', '43 9,19 * * *',
                        $c$select public.events_sync_apply_shadow('cron', interval '15 minutes')$c$);
end $$;

commit;
