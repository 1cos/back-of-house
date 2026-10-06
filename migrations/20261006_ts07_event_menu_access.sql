-- TS07 — "Menu Tripleseat" nella scheda evento, per Max e i sous chef autorizzati.
--
-- I dati vengono da event_document_versions (webhook + riconciliazione TS06): piatti, quantita',
-- descrizioni. Niente prezzi (non sono mai stati salvati), niente dati amministrativi (contatti,
-- pagamenti, importi): la funzione restituisce solo nome evento, righe del menu e cosa e' cambiato.
--
-- Accesso: sessione Brigade valida (come brigade_reset_pin / fc_prezzi_mancanti) e
--   utente admin, oppure presente in public.kitchen_menu_access (sous chef autorizzati da Max).
-- Le tabelle restano chiuse alla chiave pubblica; l'unica porta e' public.ts_event_menu(p_token, ...).
-- Rollback: drop function public.ts_event_menu(text, text); drop function public.ts_menu_can_view(text);
--           drop table public.kitchen_menu_access;

begin;

create table if not exists public.kitchen_menu_access (
  user_id    bigint primary key references public.users(id),
  note       text,
  granted_by text not null,
  granted_at timestamptz not null default now()
);
alter table public.kitchen_menu_access enable row level security;
revoke all on public.kitchen_menu_access from public, anon, authenticated;
grant select, insert, delete on public.kitchen_menu_access to service_role;

-- Chi puo' vedere il menu: restituisce l'id utente, o null.
create or replace function public.ts_menu_can_view(p_token text)
returns bigint
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions
as $$
declare v_sess public.brigade_sessions%rowtype; v_user public.users%rowtype;
begin
  if p_token is null or length(p_token) <> 64 then return null; end if;
  select * into v_sess from public.brigade_sessions
   where token_hash = encode(digest(p_token, 'sha256'), 'hex')
     and invalidated_at is null and expires_at > now() and absolute_expires_at > now();
  if not found then return null; end if;
  select * into v_user from public.users where id = v_sess.user_id and active = true;
  if not found then return null; end if;
  if v_user.is_admin is true or v_user.role = 'admin'
     or exists (select 1 from public.kitchen_menu_access a where a.user_id = v_user.id) then
    return v_user.id;
  end if;
  return null;
end $$;
revoke all on function public.ts_menu_can_view(text) from public, anon, authenticated;

create or replace function public.ts_event_menu(p_token text, p_tripleseat_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions
as $$
declare v_uid bigint; v_docs jsonb;
begin
  v_uid := public.ts_menu_can_view(p_token);
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'unauthorized'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'document_id', d.ts_document_id,
           'version', d.version_no,
           'received_at', d.received_at,
           'source', case when d.trigger = 'API_RECONCILE' then 'api' else 'webhook' end,
           -- solo i campi per la cucina; i prezzi non esistono nelle versioni
           'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', l->>'id', 'section', l->>'section', 'name', l->>'name',
                        'details', l->>'details', 'quantity', l->'quantity')
                        order by l->>'section', (l->>'position')::numeric nulls last), '[]'::jsonb)
                     from jsonb_array_elements(d.lines) l
                     where coalesce((l->>'kitchen')::boolean, true)),
           -- cosa e' cambiato rispetto alla versione precedente (null per la base)
           'changes', case when d.diff is null then null else jsonb_build_object(
                'added',   (select coalesce(jsonb_agg(a->>'id'), '[]'::jsonb) from jsonb_array_elements(d.diff->'added') a),
                'changed', (select coalesce(jsonb_agg(jsonb_build_object('id', c->>'id', 'fields', c->'fields',
                                   'before', c->'before')), '[]'::jsonb) from jsonb_array_elements(d.diff->'changed') c),
                'removed', (select coalesce(jsonb_agg(jsonb_build_object('name', r->>'name', 'quantity', r->'quantity')), '[]'::jsonb)
                              from jsonb_array_elements(d.diff->'removed') r where coalesce((r->>'kitchen')::boolean, true)),
                'previous_received_at', (select p.received_at from public.event_document_versions p
                                          where p.ts_document_id = d.ts_document_id and p.is_test = false
                                            and p.version_no = d.version_no - 1)) end)
           order by d.ts_document_id), '[]'::jsonb)
    into v_docs
    from (select distinct on (v.ts_document_id) v.*
            from public.event_document_versions v
           where v.ts_event_id::text = p_tripleseat_id and v.is_test = false
           order by v.ts_document_id, v.version_no desc) d;

  return jsonb_build_object('ok', true, 'tripleseat_id', p_tripleseat_id, 'documents', v_docs,
    'last_check', (select max(finished_at) from public.tripleseat_docsync_runs where ok));
end $$;

revoke all on function public.ts_event_menu(text, text) from public;
grant execute on function public.ts_event_menu(text, text) to anon, authenticated, service_role;

commit;
