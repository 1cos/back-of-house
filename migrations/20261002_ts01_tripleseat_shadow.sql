-- TS01 — Tripleseat OAuth 2.0, read-only test: isolated "shadow" storage.
-- Separate from Brigade's operational tables (events, integrations, recipes): nothing reads these
-- tables in the app. RLS on with no policies and grants revoked: only the service role (the edge
-- function tripleseat-oauth-shadow and SQL from the dashboard) can read or write them.

create table if not exists public.tripleseat_shadow_oauth_state (
  state      text primary key,
  created_at timestamptz not null default now(),
  used_at    timestamptz
);

create table if not exists public.tripleseat_shadow_tokens (
  id            int primary key default 1 check (id = 1),
  access_token  text not null,
  refresh_token text,
  scope         text,
  token_type    text,
  expires_at    timestamptz not null,
  obtained_at   timestamptz not null default now(),
  obtained_by   text
);

create table if not exists public.tripleseat_shadow_runs (
  run_id      uuid primary key,
  started_at  timestamptz not null,
  finished_at timestamptz,
  ok          boolean,
  counts      jsonb,
  error       text
);

create table if not exists public.tripleseat_shadow_events (
  id          bigserial primary key,
  run_id      uuid not null,
  ts_event_id bigint not null,
  name        text,
  status      text,
  event_date  date,
  guest_count int,
  payload     jsonb not null,
  fetched_at  timestamptz not null default now()
);
create index if not exists tripleseat_shadow_events_run on public.tripleseat_shadow_events (run_id);

create table if not exists public.tripleseat_shadow_menu_selections (
  id              bigserial primary key,
  run_id          uuid not null,
  ts_event_id     bigint not null,
  ts_selection_id bigint,
  name            text,
  quantity        numeric,
  payload         jsonb not null,
  fetched_at      timestamptz not null default now()
);
create index if not exists tripleseat_shadow_sel_run on public.tripleseat_shadow_menu_selections (run_id, ts_event_id);

do $$
declare t text;
begin
  foreach t in array array['tripleseat_shadow_oauth_state','tripleseat_shadow_tokens','tripleseat_shadow_runs',
                           'tripleseat_shadow_events','tripleseat_shadow_menu_selections'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
revoke all on sequence public.tripleseat_shadow_events_id_seq, public.tripleseat_shadow_menu_selections_id_seq from anon, authenticated;

comment on table public.tripleseat_shadow_tokens is 'TS01: Tripleseat OAuth 2.0 tokens for the read-only shadow test. Service role only.';

-- Undo:
--   drop table if exists public.tripleseat_shadow_menu_selections, public.tripleseat_shadow_events,
--     public.tripleseat_shadow_runs, public.tripleseat_shadow_tokens, public.tripleseat_shadow_oauth_state;
