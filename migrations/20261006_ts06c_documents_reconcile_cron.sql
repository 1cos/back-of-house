-- TS06c — Riconciliazione periodica dei documenti Tripleseat dall'API ufficiale.
--
-- Scoperta del 06/10: GET /v1/events/{id}?show_financial=true porta documents[].line_items con la stessa
-- forma del webhook (il controllo del 02/10 aveva guardato solo i campi di primo livello). Quindi:
--   * base iniziale: tutti gli eventi futuri hanno gia' una versione (eseguita a mano il 06/10, 15 eventi,
--     308 righe), e la prima modifica naturale di Monica si confronta con quella;
--   * webhook perso: questo giro ogni 2 ore lo recupera e avvisa la cucina lo stesso.
-- Il giro chiama tripleseat-oauth-shadow {action:'documents_sync'} (GET su Tripleseat, niente scritture
-- su Tripleseat), che passa ogni evento firmato al ricevitore tripleseat-webhook (trigger API_RECONCILE).
-- Minuto 17: mai insieme al job 19 (*/5) ne' a UD02 (:37/:43).
-- Rollback: select cron.unschedule('ts06-documents-reconcile'); drop function public.tripleseat_docs_invoke();
--           drop table public.tripleseat_docsync_runs;

begin;

-- Log dei giri documenti: tabella propria. tripleseat_shadow_runs NO: UD02 prende da li' "l'ultimo run ok"
-- come lettura degli eventi, e un giro documenti non contiene eventi.
create table if not exists public.tripleseat_docsync_runs (
  run_id      uuid primary key,
  started_at  timestamptz not null,
  finished_at timestamptz,
  ok          boolean not null,
  counts      jsonb,
  error       text
);
alter table public.tripleseat_docsync_runs enable row level security;
revoke all on public.tripleseat_docsync_runs from public, anon, authenticated;
grant select, insert on public.tripleseat_docsync_runs to service_role;

-- il giro manuale della base (06/10) era finito in tripleseat_shadow_runs: spostato qui
insert into public.tripleseat_docsync_runs (run_id, started_at, finished_at, ok, counts, error)
select run_id, started_at, finished_at, ok, counts, error from public.tripleseat_shadow_runs
 where counts->>'kind' = 'documents_sync'
on conflict (run_id) do nothing;
delete from public.tripleseat_shadow_runs where counts->>'kind' = 'documents_sync';

create or replace function public.tripleseat_docs_invoke()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_key text; v_req bigint;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'ts_shadow_key' limit 1;
  if v_key is null or length(btrim(v_key)) = 0 then
    raise exception 'TS06c: secret Vault ts_shadow_key mancante';
  end if;
  select net.http_post(
           url := 'https://ydqmumpytgrlceuinoqt.supabase.co/functions/v1/tripleseat-oauth-shadow',
           body := jsonb_build_object('action', 'documents_sync', 'days', 120),
           headers := jsonb_build_object('Content-Type', 'application/json', 'x-shadow-key', btrim(v_key)),
           timeout_milliseconds := 150000)
    into v_req;
  return v_req;
end $$;

revoke all on function public.tripleseat_docs_invoke() from public, anon, authenticated;

select cron.unschedule('ts06-documents-reconcile') where exists (select 1 from cron.job where jobname = 'ts06-documents-reconcile');
select cron.schedule('ts06-documents-reconcile', '17 */2 * * *', $c$select public.tripleseat_docs_invoke()$c$);

commit;
