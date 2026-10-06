-- Rollback TS06. Prima: in Tripleseat (API Settings > Webhooks) disattivare o cancellare l'endpoint
-- che punta a /functions/v1/tripleseat-webhook, poi `supabase functions delete tripleseat-webhook`.
begin;
drop function if exists public.tripleseat_change_alert(bigint, text, text, text, boolean);
drop table if exists public.event_document_acks;
drop table if exists public.event_document_versions;
drop table if exists public.tripleseat_event_kitchen_state;
drop table if exists public.tripleseat_webhook_deliveries;
commit;
