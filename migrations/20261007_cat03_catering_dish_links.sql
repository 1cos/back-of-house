-- CAT03 — Collegamenti piatto Tripleseat → ricette Brigade + quantità, salvati da Chef nella V020.
--
-- Cosa aggiunge
--   public.catering_dish_links    un piatto di UN evento: testo originale Tripleseat, identità stabile della riga,
--                                 componenti [{recipe_id, unit, qty, portions | qty_g, basis}] confermati da Chef.
--   public.catering_menu_aliases  memoria per i prossimi eventi: testo menu normalizzato → componenti + regola
--                                 (quantità per ospite). Si scrive SOLO quando Chef sceglie "ricorda come regola".
--   public.catering_save_link / catering_remove_link / catering_event_plan
--                                 SECURITY DEFINER, eseguibili solo da service_role (edge function catering-links,
--                                 che verifica la sessione Brigade e il ruolo admin/chef).
--
-- Cosa NON tocca: ricette, distinte, ingredienti, rese, events (nome/data/ospiti/stato/event_recipes), Tripleseat.
-- Il foglio food_cost.event_cost_sheets 'preventivo' dell'evento (oggi 0 righe in tutto il DB) viene tenuto
-- allineato ai collegamenti, così Cost usa lo stesso motore FC05 (sheet_cost) con imprevisti 10% su riga propria.
-- Nessuna FK verso events: se un evento venisse ricreato dalla sync, i collegamenti non spariscono (c'è anche ts_event_id).

begin;

create table if not exists public.catering_dish_links (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null,
  ts_event_id    text,
  line_key       text not null,                 -- identità stabile: "<ts_document_id>|<testo normalizzato>"
  original_text  text not null,                 -- testo Tripleseat esattamente com'era
  section        text,
  components     jsonb not null,                -- vedi catering_save_link
  note           text,
  confirmed_by   text not null,
  confirmed_at   timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (event_id, line_key),
  check (jsonb_typeof(components) = 'array' and jsonb_array_length(components) > 0)
);
create index if not exists catering_dish_links_event on public.catering_dish_links (event_id);

create table if not exists public.catering_menu_aliases (
  id            uuid primary key default gen_random_uuid(),
  alias_norm    text not null unique,           -- testo menu normalizzato (minuscolo, senza punteggiatura)
  alias_text    text not null,
  components    jsonb not null,                 -- [{recipe_id, unit, per_guest | qty, basis}]
  scope         text not null default 'catering',
  status        text not null default 'chef_rule' check (status in ('chef_rule')),
  source        text not null,                  -- es. "V020 · Mason Rehearsal 09/10/2026"
  confirmed_by  text not null,
  updated_at    timestamptz not null default now(),
  check (jsonb_typeof(components) = 'array' and jsonb_array_length(components) > 0)
);

-- lettura pubblica (come il resto della V020), nessuna scrittura pubblica
alter table public.catering_dish_links   enable row level security;
alter table public.catering_menu_aliases enable row level security;
revoke all on public.catering_dish_links, public.catering_menu_aliases from anon, authenticated;
grant select on public.catering_dish_links, public.catering_menu_aliases to anon, authenticated;
drop policy if exists cat03_read on public.catering_dish_links;
create policy cat03_read on public.catering_dish_links for select using (true);
drop policy if exists cat03_read on public.catering_menu_aliases;
create policy cat03_read on public.catering_menu_aliases for select using (true);

create or replace function public.catering_norm(t text) returns text
  language sql immutable set search_path = pg_catalog as
$$ select btrim(regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', ' ', 'g')) $$;

-- Valida un componente. La quantità scelta da Chef si salva SEMPRE nella sua unità; porzioni/grammi per il motore
-- (batches, Shopping, Cost) si ricavano SOLO se la ricetta lo permette davvero, altrimenti restano null con il motivo:
--   portions → servono le porzioni dichiarate (recipe_breakdown.portions.n) per i lotti
--   pieces   → valgono come porzioni solo se la porzione della ricetta è in pezzi (serving_unit pz/pezzi/each)
--   kg       → servono resa in massa (recipe_breakdown.yield.dim = 'mass') per i lotti
--   trays    → conteggio teglie: nessuna conversione nota
create or replace function public.catering_component_check(c jsonb) returns jsonb
  language plpgsql stable security definer set search_path = pg_catalog, public as
$$
declare r public.recipes%rowtype; bd jsonb; u text := c->>'unit'; q numeric; n numeric; y numeric; ydim text;
        por numeric; g numeric; bat numeric; why text;
begin
  begin q := (c->>'qty')::numeric; exception when others then q := null; end;
  if q is null or q <= 0 then return jsonb_build_object('ok', false, 'error', 'qty_missing'); end if;
  if u is null or u not in ('portions', 'pieces', 'kg', 'trays') then return jsonb_build_object('ok', false, 'error', 'unit_not_allowed'); end if;
  select * into r from public.recipes where id = (c->>'recipe_id')::uuid;
  if not found then return jsonb_build_object('ok', false, 'error', 'recipe_not_found'); end if;
  bd := food_cost.recipe_breakdown(r.id, null, array[]::uuid[]);
  n := nullif((bd #>> '{portions,n}')::numeric, 0);
  y := nullif((bd #>> '{yield,qty}')::numeric, 0); ydim := bd #>> '{yield,dim}';
  if u = 'portions' then
    por := q; bat := q / n; if n is null then why := 'porzioni della ricetta non dichiarate'; end if;
  elsif u = 'pieces' then
    if lower(coalesce(r.serving_unit, '')) in ('pz', 'pezzi', 'pezzo', 'each', 'piece', 'pieces', 'pcs') then
      por := q; bat := q / n; if n is null then why := 'porzioni della ricetta non dichiarate'; end if;
    else why := 'la porzione della ricetta non è in pezzi'; end if;
  elsif u = 'kg' then
    g := q * 1000;
    if ydim = 'mass' and y is not null then bat := g / y; else why := 'resa in kg della ricetta non dichiarata'; end if;
  else
    why := 'teglie: nessuna conversione dichiarata';
  end if;
  return jsonb_build_object('ok', true, 'recipe_id', r.id, 'title', r.title, 'unit', u, 'qty', q,
    'portions', por, 'qty_g', g, 'batches', bat, 'convertible', bat is not null, 'not_convertible_why', why, 'basis', c->'basis');
end $$;

-- Riallinea il foglio 'preventivo' dell'evento ai collegamenti (mai se il foglio è approvato).
create or replace function public.catering_sync_sheet(p_event_id uuid) returns uuid
  language plpgsql security definer set search_path = pg_catalog, public as
$$
declare sid uuid; st text; c jsonb;
begin
  select id, status into sid, st from food_cost.event_cost_sheets where event_id = p_event_id and kind = 'preventivo';
  if sid is null then
    if not exists (select 1 from public.catering_dish_links where event_id = p_event_id) then return null; end if;
    if not exists (select 1 from public.events where id = p_event_id) then return null; end if;
    insert into food_cost.event_cost_sheets (event_id, kind, status, markup_pct) values (p_event_id, 'preventivo', 'draft', 10)
    returning id into sid;
  elsif st = 'approved' then
    return sid;                                   -- un foglio approvato è congelato: non si riscrive
  end if;
  delete from food_cost.event_cost_lines where sheet_id = sid;
  for c in select x from public.catering_dish_links l, jsonb_array_elements(l.components) x
            where l.event_id = p_event_id and (x->>'convertible')::boolean loop
    insert into food_cost.event_cost_lines (sheet_id, recipe_id, portions, qty_g, note)
    values (sid, (c->>'recipe_id')::uuid, nullif((c->>'portions')::numeric, 0), nullif((c->>'qty_g')::numeric, 0), 'CAT03 · V020');
  end loop;
  return sid;
end $$;

-- Salva (o modifica) il collegamento di UN piatto. p_remember = true → aggiorna anche la regola per i prossimi eventi.
create or replace function public.catering_save_link(p_user text, p_event_id uuid, p_ts_event_id text, p_line_key text,
  p_original_text text, p_section text, p_components jsonb, p_note text, p_remember boolean, p_guests numeric)
  returns jsonb language plpgsql security definer set search_path = pg_catalog, public as
$$
declare c jsonb; chk jsonb; comps jsonb := '[]'; rule jsonb := '[]'; ev public.events%rowtype; lid uuid; sid uuid;
begin
  if coalesce(btrim(p_user), '') = '' then raise exception 'user_required'; end if;
  select * into ev from public.events where id = p_event_id;
  if not found then raise exception 'event_not_found'; end if;
  if coalesce(btrim(p_line_key), '') = '' or coalesce(btrim(p_original_text), '') = '' then raise exception 'line_required'; end if;
  if jsonb_typeof(p_components) <> 'array' or jsonb_array_length(p_components) = 0 then raise exception 'components_required'; end if;
  for c in select * from jsonb_array_elements(p_components) loop
    chk := public.catering_component_check(c);
    if not (chk->>'ok')::boolean then
      return jsonb_build_object('ok', false, 'error', chk->>'error', 'title', chk->>'title');
    end if;
    comps := comps || jsonb_build_array(chk - 'ok');
    rule := rule || jsonb_build_array(jsonb_build_object('recipe_id', chk->>'recipe_id', 'title', chk->>'title', 'unit', chk->>'unit',
              'per_guest', case when coalesce(p_guests, 0) > 0 then (chk->>'qty')::numeric / p_guests end,
              'qty', (chk->>'qty')::numeric, 'guests', p_guests));
  end loop;
  insert into public.catering_dish_links (event_id, ts_event_id, line_key, original_text, section, components, note, confirmed_by)
  values (p_event_id, coalesce(p_ts_event_id, ev.tripleseat_id::text), p_line_key, p_original_text, p_section, comps, nullif(btrim(p_note), ''), p_user)
  on conflict (event_id, line_key) do update set components = excluded.components, note = excluded.note,
    original_text = excluded.original_text, section = excluded.section,
    confirmed_by = excluded.confirmed_by, confirmed_at = now(), updated_at = now()
  returning id into lid;
  if p_remember then
    insert into public.catering_menu_aliases (alias_norm, alias_text, components, source, confirmed_by)
    values (public.catering_norm(p_original_text), p_original_text, rule,
            format('V020 · %s %s · %s ospiti', ev.name, to_char(ev.event_date, 'DD/MM/YYYY'), coalesce(p_guests::text, '?')), p_user)
    on conflict (alias_norm) do update set components = excluded.components, alias_text = excluded.alias_text,
      source = excluded.source, confirmed_by = excluded.confirmed_by, updated_at = now();
  end if;
  sid := public.catering_sync_sheet(p_event_id);
  return jsonb_build_object('ok', true, 'link_id', lid, 'sheet_id', sid, 'components', comps, 'remembered', coalesce(p_remember, false));
end $$;

create or replace function public.catering_remove_link(p_user text, p_event_id uuid, p_line_key text)
  returns jsonb language plpgsql security definer set search_path = pg_catalog, public as
$$
declare n int;
begin
  if coalesce(btrim(p_user), '') = '' then raise exception 'user_required'; end if;
  delete from public.catering_dish_links where event_id = p_event_id and line_key = p_line_key;
  get diagnostics n = row_count;
  perform public.catering_sync_sheet(p_event_id);
  return jsonb_build_object('ok', true, 'removed', n);
end $$;

-- Ingredienti di una ricetta × moltiplicatore, scendendo nelle sotto-ricette quando la frazione è nota.
create or replace function public.catering_flatten(p_recipe uuid, p_mult numeric, p_depth int default 0)
  returns table (ingredient_id uuid, name text, qty numeric, unit text, status text, via text)
  language plpgsql stable security definer set search_path = pg_catalog, public as
$$
declare bd jsonb; l jsonb; sub record;
begin
  bd := food_cost.recipe_breakdown(p_recipe, null, array[]::uuid[]);
  for l in select * from jsonb_array_elements(coalesce(bd->'lines', '[]')) loop
    if l->>'kind' = 'ingrediente' then
      ingredient_id := (l->>'ingredient_id')::uuid; name := l->>'name'; qty := (l->>'qty')::numeric * p_mult;
      unit := l->>'unit'; status := l->>'status'; via := bd->>'title'; return next;
    elsif l->>'kind' = 'sotto_ricetta' and (l->>'fraction') is not null and p_depth < 6 then
      if coalesce(l->>'status', '') <> 'ok' then        -- sotto-ricetta incompleta: segnalata, mai nascosta
        ingredient_id := null; name := l->>'name'; qty := (l->>'qty')::numeric * p_mult; unit := l->>'unit';
        status := 'non_calcolabile:' || coalesce(l->>'status', 'sotto_ricetta'); via := bd->>'title'; return next;
      end if;
      for sub in select * from public.catering_flatten((l->>'recipe_id')::uuid, p_mult * (l->>'fraction')::numeric, p_depth + 1) loop
        ingredient_id := sub.ingredient_id; name := sub.name; qty := sub.qty; unit := sub.unit; status := sub.status; via := sub.via; return next;
      end loop;
    else
      ingredient_id := null; name := l->>'name'; qty := (l->>'qty')::numeric * p_mult; unit := l->>'unit';
      status := 'non_calcolabile:' || coalesce(l->>'status', l->>'kind'); via := bd->>'title'; return next;
    end if;
  end loop;
end $$;

-- Production / Shopping / Cost dell'evento, dalla stessa sorgente (collegamenti confermati).
create or replace function public.catering_event_plan(p_event_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = pg_catalog, public as
$$
declare sid uuid; cost jsonb; shop jsonb; comps jsonb;
begin
  select id into sid from food_cost.event_cost_sheets where event_id = p_event_id and kind = 'preventivo';
  cost := case when sid is not null then food_cost.sheet_cost(sid) end;
  select coalesce(jsonb_agg(jsonb_build_object('line_key', l.line_key, 'original_text', l.original_text, 'component', x)), '[]')
    into comps from public.catering_dish_links l, jsonb_array_elements(l.components) x where l.event_id = p_event_id;
  with c as (
    select (x->>'recipe_id')::uuid rid,
           case when (x->>'batches') is not null then
             case when x->>'unit' in ('portions', 'pieces') then ceil((x->>'portions')::numeric) / nullif((x->>'portions')::numeric / (x->>'batches')::numeric, 0)
                  else (x->>'batches')::numeric end end mult,
           x->>'title' title
      from public.catering_dish_links l, jsonb_array_elements(l.components) x where l.event_id = p_event_id
  ), f as (
    select c.title dish, c.mult, i.* from c
    left join lateral public.catering_flatten(c.rid, c.mult) i on c.mult is not null
  )
  select jsonb_build_object(
    'known', coalesce((select jsonb_agg(jsonb_build_object('ingredient_id', ingredient_id, 'name', name, 'unit', unit, 'qty', q, 'price_missing', pm) order by name)
               from (select ingredient_id, min(name) name, unit, sum(qty) q, bool_or(status = 'prezzo_mancante') pm from f
                      where ingredient_id is not null and status <> 'escluso_non_alimentare' group by ingredient_id, unit) k), '[]'),
    'unknown', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'unit', unit, 'status', status, 'via', via))
               from f where ingredient_id is null and name is not null), '[]'),
    'no_batches', coalesce((select jsonb_agg(title) from c where mult is null), '[]'))
  into shop;
  return jsonb_build_object('ok', true, 'sheet_id', sid, 'cost', cost, 'shopping', shop, 'components', comps,
    'not_costed', coalesce((select jsonb_agg(jsonb_build_object('original_text', l.original_text, 'title', x->>'title', 'qty', x->'qty',
                    'unit', x->>'unit', 'why', x->>'not_convertible_why'))
                from public.catering_dish_links l, jsonb_array_elements(l.components) x
               where l.event_id = p_event_id and not coalesce((x->>'convertible')::boolean, false)), '[]'));
end $$;

revoke all on function public.catering_component_check(jsonb), public.catering_sync_sheet(uuid),
  public.catering_save_link(text, uuid, text, text, text, text, jsonb, text, boolean, numeric),
  public.catering_remove_link(text, uuid, text), public.catering_flatten(uuid, numeric, int),
  public.catering_event_plan(uuid) from public, anon, authenticated;
grant execute on function public.catering_component_check(jsonb), public.catering_sync_sheet(uuid),
  public.catering_save_link(text, uuid, text, text, text, text, jsonb, text, boolean, numeric),
  public.catering_remove_link(text, uuid, text), public.catering_flatten(uuid, numeric, int),
  public.catering_event_plan(uuid) to service_role;

commit;
