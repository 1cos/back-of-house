-- ROLLBACK UD01 — riporta public.events allo stato del backup
-- ~/Brigade_backups/upcoming-demand-0210/events_full_pre_ud01.json (20 righe).
-- 1) cancella i 10 eventi inseriti da UD01 (solo se nessuno li ha arricchiti nel frattempo);
-- 2) ripristina i valori originali delle 4 righe esistenti confrontate.
begin;

do $$
begin
  if exists (select 1 from public.events
              where tripleseat_id in ('61938544','61400611','63511397','63038309','63309525','61325219','63639973','63055699','62092211','63506791')
                and (coalesce(jsonb_array_length(event_recipes),0) > 0 or coalesce(jsonb_array_length(documents),0) > 0 or notes is not null)) then
    raise exception 'ROLLBACK UD01: alcuni eventi inseriti sono stati arricchiti (ricette/documenti/note): verificare a mano';
  end if;
  if exists (select 1 from food_cost.event_cost_sheets cs join public.events e on e.id = cs.event_id
              where e.tripleseat_id in ('61938544','61400611','63511397','63038309','63309525','61325219','63639973','63055699','62092211','63506791')) then
    raise exception 'ROLLBACK UD01: esistono cost sheet sugli eventi inseriti: verificare a mano';
  end if;
end $$;

delete from public.events
 where source = 'tripleseat'
   and tripleseat_id in ('61938544','61400611','63511397','63038309','63309525','61325219','63639973','63055699','62092211','63506791');

-- Wedding Lauren (fd27bc7c-58d0-4670-acc6-521e545074a0)
update public.events set status='prospect', event_time='17:30:00', guest_count=30, contact_name='Lauren non so',
       contact_phone='8179015008', total_amount=3359.63,
       updated_at='2026-07-02 03:05:22.138455+00', last_synced_at='2026-07-02 03:05:22.138455+00'
 where id='fd27bc7c-58d0-4670-acc6-521e545074a0' and tripleseat_id='60442420';

-- Wedding Ashley (3a9c0167-7c27-4f53-8894-a1c65f2996bd)
update public.events set status='prospect', guest_count=150, contact_name='Ashley non so',
       contact_email='ashwtx23@gmailk.com', total_amount=null,
       updated_at='2026-07-02 03:05:22.138455+00', last_synced_at='2026-07-02 03:05:22.138455+00'
 where id='3a9c0167-7c27-4f53-8894-a1c65f2996bd' and tripleseat_id='60969076';

-- Mason Rehearsal / wedding: nessun campo cambiato, solo last_synced_at
update public.events set last_synced_at='2026-07-02 03:05:22.138455+00'
 where id in ('7c4b3029-f4c9-4a64-a17d-c2844e54bf06','ee0b7185-c54e-45eb-817b-28bee2a20395');

do $$
begin
  if (select count(*) from public.events) <> 20 then
    raise exception 'ROLLBACK UD01: events = % (attese 20)', (select count(*) from public.events);
  end if;
end $$;

commit;
