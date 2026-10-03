-- UD01 — Upcoming Demand: copia UNA TANTUM degli eventi futuri da tripleseat_shadow_events a public.events.
-- DATI, non schema. GO esplicito di Max in sessione 02/10/2026 ("GO per correggere Upcoming Demand").
--
-- Sorgente: tripleseat_shadow_events, run 84628a1a-9383-4e8c-a0eb-6843147c88dd
--           (edge function tripleseat-oauth-shadow v9, OAuth read-only, fetched_at 2026-10-02 03:35 UTC, 21 eventi 03/10-12/12).
-- tripleseat-sync (v44) resta uno stub 410 (CA01): NON riattivato. Nessuna chiamata a Tripleseat, nessun cron.
-- Il sync continuo resta DA DECIDERE.
--
-- Filtro: event_date >= 2026-10-02, status NOT IN (LOST, CANCELLED, CANCELED), payload.deleted_at IS NULL  -> 14 eventi.
-- Identita': events.tripleseat_id (UNIQUE) = shadow.ts_event_id::text.
-- Mapping (stessa semantica delle 19 righe source='tripleseat' esistenti):
--   name          <- shadow.name
--   event_date    <- shadow.event_date
--   event_time    <- payload.event_start_time ('5:00 PM' -> 17:00)
--   guest_count   <- shadow.guest_count
--   menu_type     <- payload.event_type (stringa, es. 'Rehearsal Dinner'/'Birthday'/'Meeting')
--   location      <- payload.location.name
--   room_name     <- nomi di payload.rooms[] (', ')
--   status        <- lower(shadow.status)  (definite/tentative/prospect, come le righe esistenti)
--   contact_name  <- contact.first_name || ' ' || contact.last_name
--   contact_email <- contact.email_addresses[0].address
--   contact_phone <- contact.phone_numbers[0].number, solo cifre
--   total_amount  <- payload.grand_total
--   service_style <- event_style: onpremise -> 'On-Premise Event', catering -> 'Full-Service Catering'
--   source='tripleseat', last_synced_at=now()
--   notes, documents, event_recipes: MAI toccati (sulle nuove righe restano null / '[]' di default).
-- Update righe esistenti: solo i campi in cui lo shadow ha un valore non nullo e diverso; updated_at=now() solo se cambia qualcosa;
--   last_synced_at=now() sulle 4 righe confrontate.
-- Non toccati: la riga manuale (b098e99f..., tripleseat_id null) e Melany Loftin (60163656, LOST nello shadow -> SEGNALATA, non cancellata).
-- Rollback: 20261002_ud01_events_from_shadow_rollback.sql (cartella rollback/ e ~/Brigade_backups/upcoming-demand-0210/).

begin;

-- ── Guardie sullo stato attuale ───────────────────────────────────────────────
do $$
declare n_all int; n_ts int; n_man int; n_new_present int; n_shadow int; n_src int;
begin
  select count(*), count(*) filter (where source='tripleseat'), count(*) filter (where source='manual')
    into n_all, n_ts, n_man from public.events;
  if n_all <> 20 or n_ts <> 19 or n_man <> 1 then
    raise exception 'UD01 guard: events inattesi (tot %, tripleseat %, manual %)', n_all, n_ts, n_man;
  end if;

  select count(*) into n_shadow from public.tripleseat_shadow_events
   where run_id = '84628a1a-9383-4e8c-a0eb-6843147c88dd';
  if n_shadow <> 21 then raise exception 'UD01 guard: shadow run ha % righe (attese 21)', n_shadow; end if;

  select count(*) into n_new_present from public.events
   where tripleseat_id in ('61938544','61400611','63511397','63038309','63309525','61325219','63639973','63055699','62092211','63506791');
  if n_new_present <> 0 then raise exception 'UD01 guard: % eventi nuovi gia'' presenti', n_new_present; end if;

  -- le 4 righe da confrontare devono essere ancora quelle del backup (updated_at 2026-07-02)
  if (select count(*) from public.events
       where tripleseat_id in ('60062987','60442420','60969076','55559638')
         and updated_at = timestamptz '2026-07-02 03:05:22.138455+00') <> 4 then
    raise exception 'UD01 guard: righe esistenti modificate dopo il backup';
  end if;
end $$;

create temp table _ud01_src on commit drop as
select t.ts_event_id::text                                                    as tripleseat_id,
       nullif(btrim(t.name),'')                                               as name,
       t.event_date,
       to_timestamp(t.payload->>'event_start_time','HH12:MI AM')::time        as event_time,
       t.guest_count,
       nullif(btrim(t.payload->>'event_type'),'')                             as menu_type,
       nullif(btrim(t.payload->'location'->>'name'),'')                       as location,
       (select nullif(string_agg(r->>'name', ', ' order by r->>'name'),'')
          from jsonb_array_elements(coalesce(t.payload->'rooms','[]'::jsonb)) r) as room_name,
       lower(t.status)                                                        as status,
       nullif(btrim(concat_ws(' ', nullif(btrim(t.payload->'contact'->>'first_name'),''),
                                   nullif(btrim(t.payload->'contact'->>'last_name'),''))),'') as contact_name,
       nullif(btrim(t.payload->'contact'->'email_addresses'->0->>'address'),'') as contact_email,
       nullif(regexp_replace(coalesce(t.payload->'contact'->'phone_numbers'->0->>'number',''),'\D','','g'),'') as contact_phone,
       nullif(t.payload->>'grand_total','')::numeric                          as total_amount,
       case t.payload->>'event_style' when 'onpremise' then 'On-Premise Event'
                                      when 'catering'  then 'Full-Service Catering' end as service_style
  from public.tripleseat_shadow_events t
 where t.run_id = '84628a1a-9383-4e8c-a0eb-6843147c88dd'
   and t.event_date >= date '2026-10-02'
   and upper(coalesce(t.status,'')) not in ('LOST','CANCELLED','CANCELED')
   and t.payload->>'deleted_at' is null;

do $$
begin
  if (select count(*) from _ud01_src) <> 14 then
    raise exception 'UD01 guard: sorgente % righe (attese 14)', (select count(*) from _ud01_src);
  end if;
  if (select count(*) from _ud01_src s join public.events e on e.tripleseat_id = s.tripleseat_id) <> 4 then
    raise exception 'UD01 guard: match esistenti diverso da 4';
  end if;
end $$;

-- ── Update righe esistenti (solo campi realmente diversi) ────────────────────
update public.events e
   set name          = coalesce(s.name, e.name),
       event_date    = s.event_date,
       event_time    = coalesce(s.event_time, e.event_time),
       guest_count   = coalesce(s.guest_count, e.guest_count),
       menu_type     = coalesce(s.menu_type, e.menu_type),
       location      = coalesce(s.location, e.location),
       room_name     = coalesce(s.room_name, e.room_name),
       status        = coalesce(s.status, e.status),
       contact_name  = coalesce(s.contact_name, e.contact_name),
       contact_email = coalesce(s.contact_email, e.contact_email),
       contact_phone = coalesce(s.contact_phone, e.contact_phone),
       total_amount  = coalesce(s.total_amount, e.total_amount),
       service_style = coalesce(s.service_style, e.service_style),
       updated_at    = case when (coalesce(s.name, e.name), s.event_date, coalesce(s.event_time, e.event_time),
                                  coalesce(s.guest_count, e.guest_count), coalesce(s.menu_type, e.menu_type),
                                  coalesce(s.location, e.location), coalesce(s.room_name, e.room_name),
                                  coalesce(s.status, e.status), coalesce(s.contact_name, e.contact_name),
                                  coalesce(s.contact_email, e.contact_email), coalesce(s.contact_phone, e.contact_phone),
                                  coalesce(s.total_amount, e.total_amount), coalesce(s.service_style, e.service_style))
                             is distinct from
                                 (e.name, e.event_date, e.event_time, e.guest_count, e.menu_type, e.location, e.room_name,
                                  e.status, e.contact_name, e.contact_email, e.contact_phone, e.total_amount, e.service_style)
                            then now() else e.updated_at end,
       last_synced_at = now()
  from _ud01_src s
 where e.tripleseat_id = s.tripleseat_id
   and e.source = 'tripleseat';

-- ── Insert eventi nuovi ───────────────────────────────────────────────────────
insert into public.events
  (name, event_date, event_time, guest_count, menu_type, location, room_name, status,
   contact_name, contact_email, contact_phone, total_amount, service_style,
   source, tripleseat_id, last_synced_at)
select s.name, s.event_date, s.event_time, s.guest_count, s.menu_type, s.location, s.room_name, s.status,
       s.contact_name, s.contact_email, s.contact_phone, s.total_amount, s.service_style,
       'tripleseat', s.tripleseat_id, now()
  from _ud01_src s
 where not exists (select 1 from public.events e where e.tripleseat_id = s.tripleseat_id);

-- ── Controlli finali ─────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from public.events) <> 30 then
    raise exception 'UD01 post: events = % (attese 30)', (select count(*) from public.events);
  end if;
  if (select count(*) from public.events where source='manual') <> 1 then
    raise exception 'UD01 post: riga manuale alterata';
  end if;
  if (select status from public.events where tripleseat_id='60163656') <> 'tentative' then
    raise exception 'UD01 post: Melany Loftin non doveva essere toccata';
  end if;
end $$;

commit;
