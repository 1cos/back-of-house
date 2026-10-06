-- TS07b — Il Menu Tripleseat lo vede tutto lo staff con una sessione Brigade valida.
-- Max (06/10): "if there are no prices everyone can see". I prezzi non sono mai salvati nelle versioni e
-- ts_event_menu restituisce solo piatti, quantita', descrizioni e modifiche: quindi basta un utente attivo
-- con una sessione valida. Senza login (chiave pubblica e basta) resta "unauthorized".
-- public.kitchen_menu_access resta, vuota: non serve piu' per questa schermata.
-- Rollback: rieseguire la definizione di ts_menu_can_view in 20261006_ts07_event_menu_access.sql.

begin;

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
  return v_user.id;            -- qualunque utente attivo dello staff
end $$;
revoke all on function public.ts_menu_can_view(text) from public, anon, authenticated;

commit;
