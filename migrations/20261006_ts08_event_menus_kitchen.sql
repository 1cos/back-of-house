-- TS08 — Menu Tripleseat per le schermate in sola lettura con la chiave pubblica (V020, brigade-dev/v020).
-- V020 non ha la sessione Brigade: legge public.events con la chiave pubblica (nome, ospiti, note,
-- event_recipes). Per mostrare il menu ATTUALE (event_document_versions, TS06) serve una lettura dello
-- stesso livello: solo righe di cucina (nome, descrizione, quantita' della riga, sezione), mai prezzi
-- (non sono salvati), mai contatti/pagamenti. Max 06/10: "if there are no prices everyone can see".
-- Le tabelle restano chiuse; l'unica porta e' questa funzione, solo per eventi presenti in public.events.
-- Rollback: drop function public.ts_event_menus_kitchen(date);

begin;

create or replace function public.ts_event_menus_kitchen(p_from date)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with ev as (
    select distinct e.tripleseat_id::text as ts
      from public.events e
     where e.tripleseat_id is not null and e.event_date >= coalesce(p_from, current_date)
  ), d as (
    select distinct on (v.ts_document_id) v.ts_event_id, v.ts_document_id, v.version_no, v.received_at, v.lines
      from public.event_document_versions v join ev on ev.ts = v.ts_event_id::text
     where v.is_test = false
     order by v.ts_document_id, v.version_no desc
  ), l as (
    select d.ts_event_id, d.ts_document_id, x.l, x.i,
           min(case when coalesce(x.l->>'section','') ~* 'food|cibo|menu' then 0 else 1000 end + x.i)
             over (partition by d.ts_document_id, coalesce(x.l->>'section','')) as srank
      from d, jsonb_array_elements(d.lines) with ordinality x(l, i)
     where coalesce((x.l->>'kitchen')::boolean, true)
  )
  select coalesce(jsonb_object_agg(t.ts_event_id::text, t.menu), '{}'::jsonb)
    from (select d.ts_event_id,
                 jsonb_build_object(
                   'version', max(d.version_no),
                   'received_at', max(d.received_at),
                   'lines', coalesce((select jsonb_agg(jsonb_build_object(
                                 'section', coalesce(l.l->>'section',''), 'name', l.l->>'name',
                                 'details', coalesce(l.l->>'details',''), 'quantity', l.l->'quantity')
                               order by l.ts_document_id, l.srank, (l.l->>'position')::numeric nulls last, l.i)
                             from l where l.ts_event_id = d.ts_event_id), '[]'::jsonb)) as menu
            from d group by d.ts_event_id) t;
$$;

revoke all on function public.ts_event_menus_kitchen(date) from public;
grant execute on function public.ts_event_menus_kitchen(date) to anon, authenticated, service_role;

commit;
