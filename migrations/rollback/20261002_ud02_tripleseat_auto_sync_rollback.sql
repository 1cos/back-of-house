-- Rollback UD02 — sync automatico Tripleseat -> events.
-- Ferma i due cron, elimina le funzioni e le tabelle di log/stato, chiude le voci aperte del bot.
-- NON tocca public.events: le righe inserite/aggiornate dal sync restano. Per tornare ai dati di prima:
--   backup ~/Brigade_backups/ud02/events_full_pre_ud02.json (30 righe, 02/10/2026 21:31 UTC) e,
--   per i giri successivi, events_sync_runs.details (tripleseat_id + campi cambiati) PRIMA di eseguire questo file.
-- Il secret Vault ts_shadow_key: rimuoverlo solo se non serve piu' (riga commentata in fondo).
-- tripleseat-oauth-shadow, tripleseat_shadow_* e i token NON vengono toccati.

begin;

select cron.unschedule(jobid) from cron.job where jobname in ('ud02-tripleseat-shadow', 'ud02-events-apply');

update public.office_items
   set status = 'resolved', resolved_by = 'tripleseat-events-sync', resolved_at = now(), updated_at = now(),
       resolution = 'rollback UD02: sync automatico disattivato'
 where bot_id = 'tripleseat_events_sync' and status = 'open';

drop function if exists public.events_sync_apply_shadow(text, interval, boolean);
drop function if exists public.events_sync_alert(text, text);
drop function if exists public.events_sync_invoke_shadow();
drop table if exists public.events_sync_runs;
drop table if exists public.events_sync_state;

-- delete from vault.secrets where name = 'ts_shadow_key';

commit;
