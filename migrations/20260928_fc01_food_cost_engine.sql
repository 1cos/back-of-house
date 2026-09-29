-- ============================================================================
-- FC01/FC03 — Motore food cost Brigade
-- ============================================================================
-- Perche': public.get_recipe_cost() fallisce su ogni ricetta
--   ERROR 42883: operator does not exist: uuid = integer
-- perche' fa JOIN recipe_bom.item_id (uuid -> ingredients.id) con la vecchia
-- items.item_id (integer) e legge items.current_cost, colonna che non esiste.
-- Di conseguenza anche la view public.recipes_with_cost e' inutilizzabile.
--
-- Principi del motore (FC01, fase 2):
--   * legge ingredients / ingredient_vendors / invoice_lines, mai items;
--   * nessun costo zero implicito: prezzo mancante, conversione mancante,
--     conflitto o ciclo sono righe con uno stato esplicito, fuori dal totale;
--   * prezzi in tre classi (regola catering di Max):
--       A = documentato da fattura   B = stima chef   C = prezzo senza documento;
--   * fra i prezzi A validi vince il piu' recente fra TUTTI i fornitori;
--   * conversioni solo esatte (massa<->massa, volume<->volume) o verificate
--     (food_cost.ingredient_density, public.unit_each_weights);
--   * articoli non alimentari esclusi solo se dichiarati in
--     food_cost.ingredient_policy, e comunque elencati;
--   * sola lettura su recipes / recipe_bom (ricette ZENO 2.0 intoccabili).
--
-- Tutto vive nello schema food_cost. Gli unici oggetti public toccati sono
-- get_recipe_cost() e recipes_with_cost, oggi rotti e senza chiamanti
-- nell'applicazione (audit FC01).
-- ============================================================================

create schema if not exists food_cost;

-- ---------------------------------------------------------------------------
-- 1. Dati curati a mano (partono VUOTI: i semi sono in un file separato)
-- ---------------------------------------------------------------------------

-- Politica per ingrediente: non alimentare (fuori dal food cost) o costo zero
-- dichiarato (es. acqua di rubinetto). Senza una riga qui, un ingrediente
-- senza prezzo resta "prezzo mancante".
create table if not exists food_cost.ingredient_policy (
  ingredient_id uuid primary key references public.ingredients(id),
  policy        text not null check (policy in ('non_food', 'zero_cost')),
  reason        text not null,
  confirmed_by  text not null,
  confirmed_at  timestamptz not null default now()
);

-- Densita' verificata (g per ml). Serve SOLO per convertire volume<->massa.
create table if not exists food_cost.ingredient_density (
  ingredient_id uuid primary key references public.ingredients(id),
  g_per_ml      numeric not null check (g_per_ml > 0),
  source        text not null,
  confirmed_by  text not null,
  confirmed_at  timestamptz not null default now()
);

-- Densita' da usare fra volume e massa: quella verificata in ingredient_density,
-- altrimenti la convenzione dello chef (FC02) per gli oli: 1 litro = 1 kg.
-- Sostituisce la densita' fisica 0,916 di GG09. Vale per ogni ingrediente
-- "Oil & Vinegar" con "oil" nel nome, anche quelli creati in futuro; aceti,
-- vini, latte e succhi restano "conversione mancante" finche' lo chef non
-- estende la convenzione.
create or replace function food_cost.density_for(p_ingredient_id uuid, out g_per_ml numeric, out source text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select d.g_per_ml, d.source from food_cost.ingredient_density d where d.ingredient_id = p_ingredient_id
  union all
  select 1.0, 'convenzione chef: 1 L = 1 kg'
  from public.ingredients i
  where i.id = p_ingredient_id and i.category = 'Oil & Vinegar' and i.name ~* '\moil\M'
    and not exists (select 1 from food_cost.ingredient_density d where d.ingredient_id = p_ingredient_id)
  limit 1
$$;

-- Convalida dello chef (FC03): e' un'altra cosa rispetto al costo "completo".
-- Completo = il motore ha un prezzo e una conversione per ogni riga.
-- Convalidata = lo chef ha guardato la distinta e dice che e' quella giusta.
-- La convalida vale per la distinta com'era in quel momento: se la distinta
-- cambia, bom_hash non torna piu' e la convalida risulta scaduta.
create table if not exists food_cost.recipe_validation (
  recipe_id    uuid primary key references public.recipes(id),
  bom_hash     text not null,
  validated_by text not null,
  validated_at timestamptz not null default now(),
  note         text
);

create or replace function food_cost.bom_hash(p_recipe_id uuid) returns text
language sql stable security definer set search_path = pg_catalog, public as $$
  select md5(coalesce(string_agg(concat_ws('|', b.component_type, b.item_id, b.sub_recipe_id,
                                           b.quantity::text, lower(btrim(b.unit))), ';' order by b.bom_id), ''))
  from public.recipe_bom b where b.parent_recipe_id = p_recipe_id
$$;

-- ---------------------------------------------------------------------------
-- 2. Unita' di misura: solo fattori esatti
-- ---------------------------------------------------------------------------
create or replace function food_cost.unit_info(p_unit text, out dim text, out factor numeric)
language sql immutable as $$
  select d.dim, d.factor from (values
    ('g','mass',1::numeric), ('gr','mass',1), ('grams','mass',1), ('mg','mass',0.001),
    ('kg','mass',1000), ('lb','mass',453.592), ('lbs','mass',453.592), ('oz','mass',28.3495),
    ('ml','volume',1), ('cl','volume',10), ('dl','volume',100), ('l','volume',1000),
    ('lt','volume',1000), ('ltr','volume',1000), ('gal','volume',3785.41), ('gallone','volume',3785.41),
    ('qt','volume',946.353), ('pt','volume',473.176), ('fl_oz','volume',29.5735),
    ('cup','volume',236.588), ('tbsp','volume',14.7868), ('tsp','volume',4.92892),
    ('each','count',1), ('ea','count',1), ('pz','count',1), ('pezzi','count',1), ('n','count',1)
  ) as d(u, dim, factor)
  where d.u = lower(btrim(p_unit))
$$;

-- Chiave comune per le unita' a pezzi: pz = pezzi = each = n; nests = nidi.
create or replace function food_cost.count_unit_key(p_unit text) returns text
language sql immutable as $$
  select case
    when lower(btrim(p_unit)) in ('pz', 'pezzi', 'pezzo', 'each', 'ea', 'n') then 'pezzo'
    when lower(btrim(p_unit)) in ('nests', 'nest', 'nidi', 'nido') then 'nido'
  end
$$;

-- ---------------------------------------------------------------------------
-- 3. Candidati prezzo: una riga per (fornitore, ingrediente) con prezzo usabile
-- ---------------------------------------------------------------------------
create or replace view food_cost.v_price_candidates as
with base as (
  select iv.id as candidate_id, iv.ingredient_id, iv.vendor, iv.last_invoice_date,
         iv.updated_at, iv.pack_description, iv.unit_price, iv.conversion_to_base,
         iv.price_per_100g, iv.price_per_each, iv.price_type,
         case when coalesce(i.measure_type, '') = 'volume' or lower(coalesce(i.base_unit, '')) = 'ml'
              then 'volume' else 'mass' end as basis_dim,
         case
           when iv.vendor ilike 'STIMA CHEF%' then 'B'
           when iv.last_invoice_date is not null then 'A'
           else 'C'
         end as price_class,
         case
           when iv.price_per_100g > 0 then iv.price_per_100g / 100
           when iv.price_type = 'per_lb' and iv.unit_price > 0 then iv.unit_price / 453.592
           when iv.conversion_to_base > 0 and iv.unit_price > 0 then iv.unit_price / iv.conversion_to_base
         end as cost_per_base,
         case when iv.price_per_each > 0 then iv.price_per_each end as cost_per_each
  from public.ingredient_vendors iv
  join public.ingredients i on i.id = iv.ingredient_id
  where iv.active
)
select b.*,
       line.invoice_number, line.line_cost_per_100g,
       array_remove(array[
         -- prezzo memorizzato e prezzo ricalcolato dal pack non concordano
         case when b.price_per_100g > 0 and b.conversion_to_base > 0 and b.unit_price > 0
                   and abs(b.price_per_100g - b.unit_price / b.conversion_to_base * 100) / b.price_per_100g > 0.02
              then format('prezzo/100 %s vs pack %s', round(b.price_per_100g, 4),
                          round(b.unit_price / b.conversion_to_base * 100, 4)) end,
         -- la riga fattura dello stesso giorno dice un'altra cosa
         case when b.price_class = 'A' and b.price_per_100g > 0 and line.line_cost_per_100g > 0
                   and abs(b.price_per_100g - line.line_cost_per_100g) / line.line_cost_per_100g > 0.02
              then format('prezzo/100 %s vs fattura %s', round(b.price_per_100g, 4), line.line_cost_per_100g) end
       ], null) as conflicts
from base b
left join lateral (
  select l.invoice_number, l.cost_per_100g as line_cost_per_100g
  from public.invoice_lines l
  where l.ingredient_id = b.ingredient_id and l.vendor = b.vendor
    and l.invoice_date = b.last_invoice_date and coalesce(l.price_anomaly, false) = false
  order by l.cost_per_100g is null, l.created_at desc nulls last
  limit 1
) line on true
where b.cost_per_base is not null or b.cost_per_each is not null;

-- ---------------------------------------------------------------------------
-- 4. Prezzo scelto per ingrediente
--    A piu' recente fra tutti i fornitori > B > C. Il candidato scelto porta
--    con se' i propri conflitti e gli avvisi di contesto.
-- ---------------------------------------------------------------------------
create or replace view food_cost.v_ingredient_price as
with ranked as (
  select c.*,
         row_number() over (partition by c.ingredient_id
           order by case c.price_class when 'A' then 1 when 'B' then 2 else 3 end,
                    c.last_invoice_date desc nulls last, c.updated_at desc nulls last) as rn
  from food_cost.v_price_candidates c
)
select r.candidate_id, r.ingredient_id, r.vendor, r.price_class, r.basis_dim,
       r.cost_per_base, r.cost_per_each, r.last_invoice_date, r.invoice_number,
       r.pack_description, r.conflicts,
       array_remove(array[
         -- stesso giorno, altro fornitore, prezzo diverso: non si sceglie a caso
         case when exists (
           select 1 from ranked o
           where o.ingredient_id = r.ingredient_id and o.rn > 1 and o.price_class = 'A'
             and o.last_invoice_date = r.last_invoice_date
             and abs(o.cost_per_base - r.cost_per_base) / nullif(r.cost_per_base, 0) > 0.02)
         then 'due fornitori, stessa data, prezzi diversi' end
       ], null) as tie_conflicts,
       array_remove(array[
         case when exists (
           select 1 from public.invoice_lines l
           where l.ingredient_id = r.ingredient_id and l.match_status = 'matched'
             and l.invoice_date > coalesce(r.last_invoice_date, date '1900-01-01'))
         then (select format('fattura piu'' recente non applicata al prezzo: %s %s',
                             l.vendor, l.invoice_date)
               from public.invoice_lines l
               where l.ingredient_id = r.ingredient_id and l.match_status = 'matched'
                 and l.invoice_date > coalesce(r.last_invoice_date, date '1900-01-01')
               order by l.invoice_date desc limit 1) end
       ], null) as warnings
from ranked r
where r.rn = 1;

-- ---------------------------------------------------------------------------
-- 4b. Avvisi per lo chef: cosa impedisce un costo completo, in parole semplici.
--     Una riga per ingrediente, ordinata per numero di ricette bloccate.
-- ---------------------------------------------------------------------------
create or replace view food_cost.v_chef_alerts as
with uso as (
  select b.item_id as ingredient_id, b.unit, r.id as recipe_id, r.title,
         (food_cost.unit_info(b.unit)).dim as dim
  from public.recipe_bom b
  join public.recipes r on r.id = b.parent_recipe_id
  where b.component_type = 'ITEM'
    and not exists (select 1 from food_cost.ingredient_policy x where x.ingredient_id = b.item_id)
),
problemi as (
  select u.ingredient_id, u.recipe_id, u.title,
    case
      when p.ingredient_id is null then 'prezzo_mancante'
      when cardinality(p.conflicts) + cardinality(p.tie_conflicts) > 0 then 'prezzo_in_conflitto'
      when u.dim is null then 'unita_non_convertibile'
      when u.dim = 'count' and p.cost_per_each is null
           and not exists (select 1 from public.unit_each_weights w where w.ingredient_id = u.ingredient_id)
        then 'manca_peso_al_pezzo'
      when u.dim in ('mass', 'volume') and p.cost_per_base is null
           and not exists (select 1 from public.unit_each_weights w where w.ingredient_id = u.ingredient_id)
        then 'manca_peso_al_pezzo'
      when u.dim in ('mass', 'volume') and p.cost_per_base is not null and u.dim <> p.basis_dim
           and (select g_per_ml from food_cost.density_for(u.ingredient_id)) is null
        then 'manca_densita'
    end as codice,
    u.unit
  from uso u
  left join food_cost.v_ingredient_price p on p.ingredient_id = u.ingredient_id
)
select i.id as ingredient_id, i.name as ingrediente, pr.codice,
       case pr.codice
         when 'prezzo_mancante'        then format('Manca il prezzo di %s.', i.name)
         when 'prezzo_in_conflitto'    then format('Il prezzo di %s non torna con la fattura: va controllato.', i.name)
         when 'unita_non_convertibile' then format('%s e'' scritto in un''unita'' non convertibile (%s).', i.name, string_agg(distinct pr.unit, ', '))
         when 'manca_peso_al_pezzo'    then format('%s: serve il peso di un pezzo.', i.name)
         when 'manca_densita'          then format('%s: serve la conversione fra litri e chili.', i.name)
       end as messaggio,
       count(distinct pr.recipe_id) as ricette_bloccate,
       string_agg(distinct pr.title, ', ') as ricette
from problemi pr
join public.ingredients i on i.id = pr.ingredient_id
where pr.codice is not null
group by i.id, i.name, pr.codice
order by ricette_bloccate desc, i.name;

-- ---------------------------------------------------------------------------
-- 5. Catering: fogli di costo evento e snapshot dei prezzi
-- ---------------------------------------------------------------------------
create table if not exists food_cost.event_cost_sheets (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id),
  kind          text not null check (kind in ('preventivo', 'consuntivo')),
  status        text not null default 'draft' check (status in ('draft', 'approved')),
  markup_pct    numeric not null default 10,   -- maggiorazione unica sul subtotale
  approved_at   timestamptz,
  approved_by   text,
  frozen_result jsonb,                         -- risultato congelato all'approvazione
  created_at    timestamptz not null default now(),
  unique (event_id, kind)
);

create table if not exists food_cost.event_cost_lines (
  id          uuid primary key default gen_random_uuid(),
  sheet_id    uuid not null references food_cost.event_cost_sheets(id) on delete cascade,
  recipe_id   uuid not null references public.recipes(id),
  -- preventivo: porzioni previste. consuntivo: porzioni o grammi realmente usati.
  portions    numeric,
  qty_g       numeric,
  note        text,
  check (portions > 0 or qty_g > 0)
);

create table if not exists food_cost.event_price_snapshot (
  sheet_id       uuid not null references food_cost.event_cost_sheets(id) on delete cascade,
  ingredient_id  uuid not null references public.ingredients(id),
  candidate_id   uuid,
  vendor         text,
  price_class    text not null,
  basis_dim      text not null,
  cost_per_base  numeric,
  cost_per_each  numeric,
  last_invoice_date date,
  invoice_number text,
  captured_at    timestamptz not null default now(),
  primary key (sheet_id, ingredient_id)
);

-- Un foglio approvato non si tocca piu': ne' righe, ne' snapshot, ne' foglio.
create or replace function food_cost.guard_approved_sheet() returns trigger
language plpgsql as $$
declare v_sheet uuid; v_status text;
begin
  if tg_table_name = 'event_cost_sheets' then
    if old.status = 'approved' then
      raise exception 'FC01: il foglio % e'' approvato e non si modifica', old.id;
    end if;
    return coalesce(new, old);
  end if;
  v_sheet := coalesce(new.sheet_id, old.sheet_id);
  select status into v_status from food_cost.event_cost_sheets where id = v_sheet;
  if v_status = 'approved' then
    raise exception 'FC01: il foglio % e'' approvato e non si modifica', v_sheet;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_guard_sheet on food_cost.event_cost_sheets;
create trigger trg_guard_sheet before update or delete on food_cost.event_cost_sheets
  for each row execute function food_cost.guard_approved_sheet();
drop trigger if exists trg_guard_lines on food_cost.event_cost_lines;
create trigger trg_guard_lines before insert or update or delete on food_cost.event_cost_lines
  for each row execute function food_cost.guard_approved_sheet();
drop trigger if exists trg_guard_snapshot on food_cost.event_price_snapshot;
create trigger trg_guard_snapshot before insert or update or delete on food_cost.event_price_snapshot
  for each row execute function food_cost.guard_approved_sheet();

-- Prezzo di un ingrediente: dallo snapshot del foglio se c'e', altrimenti corrente.
create or replace function food_cost.price_for(p_ingredient_id uuid, p_sheet_id uuid default null)
returns table (candidate_id uuid, vendor text, price_class text, basis_dim text,
               cost_per_base numeric, cost_per_each numeric, last_invoice_date date,
               invoice_number text, pack_description text, conflicts text[], warnings text[])
language sql stable security definer set search_path = pg_catalog, public as $$
  select s.candidate_id, s.vendor, s.price_class, s.basis_dim, s.cost_per_base, s.cost_per_each,
         s.last_invoice_date, s.invoice_number, null::text, '{}'::text[], '{}'::text[]
  from food_cost.event_price_snapshot s
  where p_sheet_id is not null and s.sheet_id = p_sheet_id and s.ingredient_id = p_ingredient_id
  union all
  select p.candidate_id, p.vendor, p.price_class, p.basis_dim, p.cost_per_base, p.cost_per_each,
         p.last_invoice_date, p.invoice_number, p.pack_description,
         p.conflicts || p.tie_conflicts, p.warnings
  from food_cost.v_ingredient_price p
  where p.ingredient_id = p_ingredient_id
    and not exists (select 1 from food_cost.event_price_snapshot s
                    where p_sheet_id is not null and s.sheet_id = p_sheet_id
                      and s.ingredient_id = p_ingredient_id)
$$;

-- ---------------------------------------------------------------------------
-- 6. Il motore: costo dettagliato di una ricetta (ricorsivo, con cicli)
-- ---------------------------------------------------------------------------
-- Ritorna jsonb:
--  { recipe_id, title, status, complete,
--    yield: {qty, dim, source, warnings[]}, portions: {n, source},
--    totals: {A, B, C, known}, cost_per_portion, cost_per_yield_unit,
--    lines: [...], issues: [{code, path, detail}] }
-- status: 'verificato' (solo A, nulla manca) | 'con_stime' (B/C, nulla manca)
--         | 'incompleto' (manca qualcosa: il totale e' parziale).
create or replace function food_cost.recipe_breakdown(
  p_recipe_id uuid, p_sheet_id uuid default null, p_path uuid[] default '{}')
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  r        public.recipes%rowtype;
  b        record;
  pr       record;
  has_pr   boolean; pr_json jsonb;
  u        record;
  pol      text;
  dens     numeric; dens_src text;
  eachw    numeric;
  child    jsonb;
  lines    jsonb := '[]';
  issues   jsonb := '[]';
  tot_a    numeric := 0; tot_b numeric := 0; tot_c numeric := 0;
  qty_base numeric; unit_cost numeric; line_cost numeric; cls text; st text; note text;
  c_known  numeric; c_yield numeric; c_dim text; frac numeric;
  y_qty    numeric; y_dim text; y_src text; y_warn jsonb := '[]';
  n_port   numeric; n_src text; n_text numeric; n_conflict text;
  path_txt text;
  complete boolean := true;
  only_a   boolean := true;
begin
  select * into r from public.recipes where id = p_recipe_id;
  if not found then
    return jsonb_build_object('recipe_id', p_recipe_id, 'status', 'incompleto', 'complete', false,
      'issues', jsonb_build_array(jsonb_build_object('code', 'ricetta_inesistente')));
  end if;
  path_txt := coalesce((select string_agg(rr.title, ' > ' order by o)
                        from unnest(p_path || p_recipe_id) with ordinality x(id, o)
                        join public.recipes rr on rr.id = x.id), r.title);

  -- Resa dichiarata. base_weight_g e' la resa (arrabbiata 4.422 g crudi -> 3.150 g);
  -- base_weight e' un campo piu' vecchio: se discorda si segnala e vince base_weight_g.
  if r.base_weight_g > 0 then
    y_qty := r.base_weight_g; y_dim := 'mass'; y_src := 'base_weight_g';
    if r.base_weight > 0 and lower(coalesce(r.weight_unit, '')) in ('kg', 'g') then
      if abs(r.base_weight * case lower(r.weight_unit) when 'kg' then 1000 else 1 end - r.base_weight_g)
         / r.base_weight_g > 0.05 then
        y_warn := y_warn || to_jsonb(format('resa in conflitto: base_weight_g %s g, base_weight %s %s',
                                            r.base_weight_g, r.base_weight, r.weight_unit));
      end if;
    end if;
  elsif r.base_weight > 0 then
    select * into u from food_cost.unit_info(r.weight_unit);
    if u.dim in ('mass', 'volume') then
      y_qty := r.base_weight * u.factor; y_dim := u.dim; y_src := 'base_weight ' || r.weight_unit;
    end if;
  end if;

  -- Porzioni
  if r.base_servings > 0 then
    n_port := r.base_servings; n_src := 'base_servings';
  elsif y_dim = 'mass' and r.serving_weight_g > 0 then
    n_port := y_qty / r.serving_weight_g; n_src := 'resa / serving_weight_g';
  elsif y_dim = 'mass' and lower(coalesce(r.serving_unit, '')) = 'g' and r.serving_qty > 0 then
    n_port := y_qty / r.serving_qty; n_src := 'resa / serving_qty g';
  end if;
  -- Controllo incrociato con il testo della resa ("25 porzioni"): se discorda,
  -- il costo per porzione non si calcola (SPAGHETTI FRESH PASTA: 50 vs 20).
  n_text := replace(substring(r.yield_text from '^\s*(\d+(?:[.,]\d+)?)\s*porzion'), ',', '.')::numeric;
  if n_port > 0 and n_text > 0 and abs(n_port - n_text) / n_text > 0.05 then
    n_conflict := format('porzioni in conflitto: %s da %s, %s da yield_text "%s"',
                         round(n_port, 2), n_src, n_text, btrim(r.yield_text));
  end if;

  for b in
    select rb.*, i.name as ing_name, i.category as ing_category, sr.title as sub_title
    from public.recipe_bom rb
    left join public.ingredients i on i.id = rb.item_id
    left join public.recipes sr on sr.id = rb.sub_recipe_id
    where rb.parent_recipe_id = p_recipe_id
    order by rb.sort_order nulls last, rb.bom_id
  loop
    qty_base := null; unit_cost := null; line_cost := null; cls := null; st := 'ok'; note := null;
    select * into u from food_cost.unit_info(b.unit);

    if b.component_type = 'ITEM' then
      select policy into pol from food_cost.ingredient_policy where ingredient_id = b.item_id;
      has_pr := false; pr_json := null;
      if pol = 'non_food' then
        st := 'escluso_non_alimentare';
      elsif pol = 'zero_cost' then
        st := 'ok'; cls := 'zero'; line_cost := 0; note := 'costo zero dichiarato';
      else
        select * into pr from food_cost.price_for(b.item_id, p_sheet_id) limit 1;
        has_pr := found;
        -- il jsonb del prezzo si costruisce SOLO qui, dove pr e' assegnato: citare
        -- i campi di pr altrove fallisce se la prima riga della sessione non ha
        -- prezzo (trovato dalla prova su PostgreSQL vero, FC03)
        if has_pr then
          pr_json := jsonb_build_object(
            'vendor', pr.vendor, 'class', pr.price_class, 'basis', pr.basis_dim,
            'cost_per_100', round(pr.cost_per_base * 100, 4), 'cost_per_each', pr.cost_per_each,
            'invoice_date', pr.last_invoice_date, 'invoice_number', pr.invoice_number,
            'pack', pr.pack_description, 'warnings', to_jsonb(pr.warnings));
        end if;
        if not has_pr then
          st := 'prezzo_mancante';
        elsif coalesce(array_length(pr.conflicts, 1), 0) > 0 then
          st := 'prezzo_in_conflitto'; note := array_to_string(pr.conflicts, '; ');
        elsif u.dim is null then
          st := 'conversione_mancante'; note := format('unita'' "%s" non convertibile', b.unit);
        else
          cls := pr.price_class;
          select d.g_per_ml, d.source into dens, dens_src from food_cost.density_for(b.item_id) d;
          select avg_weight_g into eachw from public.unit_each_weights where ingredient_id = b.item_id;
          if u.dim = 'count' then
            if pr.cost_per_each is not null then
              qty_base := b.quantity; unit_cost := pr.cost_per_each; note := 'prezzo al pezzo';
            elsif pr.cost_per_base is not null and pr.basis_dim = 'mass' and eachw > 0 then
              qty_base := b.quantity * eachw; unit_cost := pr.cost_per_base;
              note := format('peso unitario verificato %s g', eachw);
            else
              st := 'conversione_mancante'; note := 'pezzi senza prezzo al pezzo ne'' peso unitario verificato';
            end if;
          elsif pr.cost_per_base is null then
            -- solo prezzo al pezzo, ricetta in peso/volume
            if u.dim = 'mass' and eachw > 0 then
              qty_base := b.quantity * u.factor / eachw; unit_cost := pr.cost_per_each;
              note := format('peso unitario verificato %s g', eachw);
            else
              st := 'conversione_mancante'; note := 'prezzo solo al pezzo, peso unitario non verificato';
            end if;
          elsif u.dim = pr.basis_dim then
            qty_base := b.quantity * u.factor; unit_cost := pr.cost_per_base;
          elsif dens > 0 then
            qty_base := case when u.dim = 'volume' then b.quantity * u.factor * dens
                             else b.quantity * u.factor / dens end;
            unit_cost := pr.cost_per_base; note := format('%s (%s g/ml)', dens_src, dens);
          else
            st := 'conversione_mancante';
            note := format('%s -> %s senza densita'' verificata', u.dim, pr.basis_dim);
          end if;
          if st = 'ok' then line_cost := qty_base * unit_cost; end if;
        end if;
      end if;

      lines := lines || jsonb_build_object(
        'bom_id', b.bom_id, 'kind', 'ingrediente', 'name', b.ing_name, 'ingredient_id', b.item_id,
        'qty', b.quantity, 'unit', b.unit, 'status', st, 'class', cls, 'cost', line_cost, 'note', note,
        'price', pr_json);
      pol := null; dens := null; eachw := null;

    else  -- sotto-ricetta
      if b.sub_recipe_id = any(p_path || p_recipe_id) then
        st := 'ciclo'; note := 'la sotto-ricetta contiene la ricetta stessa';
      else
        child := food_cost.recipe_breakdown(b.sub_recipe_id, p_sheet_id, p_path || p_recipe_id);
        c_known := (child #>> '{totals,known}')::numeric;
        c_yield := (child #>> '{yield,qty}')::numeric;
        c_dim   := child #>> '{yield,dim}';
        if u.dim is null and lower(btrim(b.unit)) not in ('nests') then
          st := 'conversione_mancante'; note := format('unita'' "%s" non convertibile', b.unit);
        elsif u.dim in ('mass', 'volume') then
          if c_yield is null then
            st := 'resa_mancante'; note := 'la sotto-ricetta non dichiara la resa';
          elsif c_dim <> u.dim then
            st := 'conversione_mancante'; note := format('resa in %s, uso in %s', c_dim, u.dim);
          else
            qty_base := b.quantity * u.factor; frac := qty_base / c_yield;
          end if;
        else
          -- pezzi / nidi: vale solo se la sotto-ricetta dichiara porzioni nella stessa unita'
          -- (nests <-> nests, pz <-> pezzi). "1 pz di focaccia = 1 porzione" sarebbe un'assunzione.
          if (child #>> '{portions,n}') is null then
            st := 'conversione_mancante'; note := 'sotto-ricetta a pezzi senza numero di porzioni';
          elsif (child #>> '{portions,conflict}') is not null then
            st := 'conversione_mancante'; note := child #>> '{portions,conflict}';
          elsif coalesce(food_cost.count_unit_key(b.unit), '?')
                <> coalesce(food_cost.count_unit_key(child ->> 'serving_unit'), '!') then
            st := 'conversione_mancante';
            note := format('uso in "%s", porzioni della sotto-ricetta in "%s"', b.unit,
                           coalesce(child ->> 'serving_unit', 'non dichiarate'));
          else
            -- pezzi per lotto = porzioni x pezzi per porzione (FETTUCCINE: 25 x 2 nidi = 50)
            frac := b.quantity / ((child #>> '{portions,n}')::numeric
                                  * coalesce(nullif((child ->> 'serving_qty')::numeric, 0), 1));
            note := format('%s per lotto dichiarati dalla sotto-ricetta',
                           round((child #>> '{portions,n}')::numeric
                                 * coalesce(nullif((child ->> 'serving_qty')::numeric, 0), 1), 2));
          end if;
        end if;
        if frac is not null then
          line_cost := c_known * frac;
          tot_a := tot_a + coalesce((child #>> '{totals,A}')::numeric, 0) * frac;
          tot_b := tot_b + coalesce((child #>> '{totals,B}')::numeric, 0) * frac;
          tot_c := tot_c + coalesce((child #>> '{totals,C}')::numeric, 0) * frac;
          if not (child ->> 'complete')::boolean then st := 'sotto_ricetta_incompleta'; end if;
          if child ->> 'status' <> 'verificato' then only_a := false; end if;
        end if;
        issues := issues || coalesce(child -> 'issues', '[]');
      end if;
      lines := lines || jsonb_build_object(
        'bom_id', b.bom_id, 'kind', 'sotto_ricetta', 'name', b.sub_title, 'recipe_id', b.sub_recipe_id,
        'qty', b.quantity, 'unit', b.unit, 'status', st, 'cost', line_cost, 'note', note,
        'fraction', frac, 'child_status', child ->> 'status');
      child := null; frac := null;
    end if;

    if b.component_type = 'ITEM' and st = 'ok' then
      if cls = 'zero' then null;
      elsif cls = 'A' then tot_a := tot_a + line_cost;
      elsif cls = 'B' then tot_b := tot_b + line_cost; only_a := false;
      else tot_c := tot_c + line_cost; only_a := false; end if;
    end if;
    if st not in ('ok', 'escluso_non_alimentare') then
      complete := false;
      if st <> 'sotto_ricetta_incompleta' then
        issues := issues || jsonb_build_object('code', st, 'path', path_txt,
          'component', coalesce(b.ing_name, b.sub_title), 'qty', b.quantity, 'unit', b.unit, 'detail', note);
      end if;
    end if;
  end loop;

  if jsonb_array_length(lines) = 0 then
    complete := false;
    issues := issues || jsonb_build_object('code', 'distinta_vuota', 'path', path_txt);
  end if;
  if n_conflict is not null then
    issues := issues || jsonb_build_object('code', 'porzioni_in_conflitto', 'path', path_txt, 'detail', n_conflict);
  end if;
  if y_qty is null then
    -- informativo: blocca solo chi usa questa ricetta a peso (resa_mancante)
    issues := issues || jsonb_build_object('code', 'resa_non_dichiarata', 'path', path_txt);
  end if;

  return jsonb_build_object(
    'recipe_id', r.id, 'title', r.title, 'serving_unit', r.serving_unit, 'serving_qty', r.serving_qty,
    'status', case when not complete then 'incompleto' when only_a then 'verificato' else 'con_stime' end,
    'complete', complete,
    'yield', jsonb_build_object('qty', y_qty, 'dim', y_dim, 'source', y_src, 'warnings', y_warn),
    'portions', jsonb_build_object('n', n_port, 'source', n_src, 'conflict', n_conflict),
    'totals', jsonb_build_object('A', tot_a, 'B', tot_b, 'C', tot_c, 'known', tot_a + tot_b + tot_c),
    'cost_per_portion', case when complete and n_port > 0 and n_conflict is null then (tot_a + tot_b + tot_c) / n_port end,
    'cost_per_yield_unit', case when complete and y_qty > 0 then (tot_a + tot_b + tot_c) / y_qty end,
    'lines', lines, 'issues', issues,
    'chef_validation', (select jsonb_build_object('validated', v.bom_hash = food_cost.bom_hash(r.id),
                                                  'stale', v.bom_hash <> food_cost.bom_hash(r.id),
                                                  'by', v.validated_by, 'at', v.validated_at, 'note', v.note)
                        from food_cost.recipe_validation v where v.recipe_id = r.id));
end $$;

-- ---------------------------------------------------------------------------
-- 7. Interfaccia pubblica, compatibile col vecchio nome
-- ---------------------------------------------------------------------------
-- Costo totale SOLO se completo; altrimenti NULL (mai 0 per dati mancanti).
create or replace function public.get_recipe_cost(p_recipe_id uuid)
returns numeric language sql stable as $$
  select case when (x ->> 'complete')::boolean then (x #>> '{totals,known}')::numeric end
  from food_cost.recipe_breakdown(p_recipe_id) x
$$;

-- La view mantiene le colonne storiche nello stesso ordine e ne aggiunge in coda.
-- cost_per_kg resta "costo / base_weight" come prima, ma solo se il costo e' completo.
create or replace view public.recipes_with_cost as
select r.id, r.title, r.category, r.yield_text, r.prep_time_minutes, r.ingredients, r.procedure,
       r.equipment, r.created_at, r.image_url, r.base_weight, r.weight_unit, r.base_servings,
       x.total_cost,
       case when r.base_weight > 0 then x.total_cost / r.base_weight end as cost_per_kg,
       x.status as cost_status,
       x.known_cost,
       x.cost_per_portion,
       x.issue_count,
       x.chef_validated
from public.recipes r
cross join lateral (
  select case when (bd ->> 'complete')::boolean then (bd #>> '{totals,known}')::numeric end as total_cost,
         bd ->> 'status' as status,
         (bd #>> '{totals,known}')::numeric as known_cost,
         (bd ->> 'cost_per_portion')::numeric as cost_per_portion,
         jsonb_array_length(bd -> 'issues') as issue_count,
         coalesce((bd #>> '{chef_validation,validated}')::boolean, false) as chef_validated
  from food_cost.recipe_breakdown(r.id) bd
) x;

-- ---------------------------------------------------------------------------
-- 8. Catering: calcolo del foglio e approvazione con snapshot
-- ---------------------------------------------------------------------------
-- Preventivo = prezzi correnti; consuntivo approvato = prezzi dello snapshot.
-- Regole Max: maggiorazione una volta sola su riga autonoma; porzioni
-- frazionarie arrotondate per eccesso; mancanti fuori dal totale ed elencati.
create or replace function food_cost.sheet_cost(p_sheet_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  s food_cost.event_cost_sheets%rowtype;
  l record; bd jsonb; mult numeric; charged numeric; lines jsonb := '[]'; sub numeric := 0; ok boolean := true;
  snap uuid;
begin
  select * into s from food_cost.event_cost_sheets where id = p_sheet_id;
  if s.status = 'approved' then return s.frozen_result; end if;
  snap := case when exists (select 1 from food_cost.event_price_snapshot where sheet_id = p_sheet_id)
               then p_sheet_id end;
  for l in select * from food_cost.event_cost_lines where sheet_id = p_sheet_id loop
    bd := food_cost.recipe_breakdown(l.recipe_id, snap);
    charged := null;
    if l.portions > 0 then
      charged := ceil(l.portions);   -- 8,33 porzioni -> se ne calcolano 9
      mult := charged / nullif((bd #>> '{portions,n}')::numeric, 0);
    else
      mult := l.qty_g / nullif((bd #>> '{yield,qty}')::numeric, 0);
    end if;
    if mult is null or not (bd ->> 'complete')::boolean then ok := false; end if;
    lines := lines || jsonb_build_object('recipe_id', l.recipe_id, 'title', bd ->> 'title',
      'portions', l.portions, 'portions_charged', charged, 'qty_g', l.qty_g,
      'recipe_status', bd ->> 'status', 'multiplier', mult,
      'cost', case when mult is not null then (bd #>> '{totals,known}')::numeric * mult end,
      'issues', bd -> 'issues');
    sub := sub + coalesce((bd #>> '{totals,known}')::numeric * mult, 0);
  end loop;
  return jsonb_build_object('sheet_id', s.id, 'event_id', s.event_id, 'kind', s.kind,
    'priced_with', case when snap is null then 'prezzi correnti' else 'snapshot' end,
    'complete', ok, 'subtotal', sub, 'markup_pct', s.markup_pct,
    'markup', sub * s.markup_pct / 100, 'total', sub * (1 + s.markup_pct / 100), 'lines', lines);
end $$;

-- Approva un consuntivo: fotografa i prezzi di tutti gli ingredienti toccati
-- (anche dentro le sotto-ricette), congela il risultato, blocca il foglio.
create or replace function food_cost.approve_sheet(p_sheet_id uuid, p_by text)
returns jsonb language plpgsql as $$
declare res jsonb;
begin
  if exists (select 1 from food_cost.event_cost_sheets where id = p_sheet_id and status = 'approved') then
    raise exception 'FC01: foglio % gia'' approvato', p_sheet_id;
  end if;
  insert into food_cost.event_price_snapshot
    (sheet_id, ingredient_id, candidate_id, vendor, price_class, basis_dim, cost_per_base,
     cost_per_each, last_invoice_date, invoice_number)
  with recursive tree(recipe_id, path) as (
    select l.recipe_id, array[l.recipe_id] from food_cost.event_cost_lines l where l.sheet_id = p_sheet_id
    union
    select rb.sub_recipe_id, t.path || rb.sub_recipe_id
    from tree t join public.recipe_bom rb on rb.parent_recipe_id = t.recipe_id
    where rb.component_type = 'RECIPE' and not rb.sub_recipe_id = any(t.path)
  )
  select distinct on (p.ingredient_id) p_sheet_id, p.ingredient_id, p.candidate_id, p.vendor,
         p.price_class, p.basis_dim, p.cost_per_base, p.cost_per_each, p.last_invoice_date, p.invoice_number
  from tree t
  join public.recipe_bom rb on rb.parent_recipe_id = t.recipe_id and rb.component_type = 'ITEM'
  join food_cost.v_ingredient_price p on p.ingredient_id = rb.item_id
  on conflict do nothing;

  res := food_cost.sheet_cost(p_sheet_id);
  update food_cost.event_cost_sheets
     set frozen_result = res, status = 'approved', approved_at = now(), approved_by = p_by
   where id = p_sheet_id;
  return res;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Permessi: il food cost e' solo per l'amministrazione
-- ---------------------------------------------------------------------------
alter table food_cost.ingredient_policy     enable row level security;
alter table food_cost.ingredient_density    enable row level security;
alter table food_cost.event_cost_sheets     enable row level security;
alter table food_cost.event_cost_lines      enable row level security;
alter table food_cost.event_price_snapshot  enable row level security;
alter table food_cost.recipe_validation     enable row level security;
-- Nessuna policy per anon/authenticated: le tabelle si scrivono solo da
-- service_role / SQL. La lettura del costo passa dalle funzioni SECURITY
-- DEFINER (recipe_breakdown & co.), che leggono le tabelle curate con i diritti
-- del proprietario: cosi' anon e service_role ottengono LO STESSO costo, invece
-- di un costo in cui la policy dell'acqua sparisce perche' RLS la nasconde.
-- Le funzioni che scrivono (approve_sheet) non sono eseguibili da anon.
grant usage on schema food_cost to anon, authenticated, service_role;
revoke all on all functions in schema food_cost from public;
grant execute on function food_cost.recipe_breakdown(uuid, uuid, uuid[]),
                          food_cost.price_for(uuid, uuid),
                          food_cost.density_for(uuid),
                          food_cost.unit_info(text),
                          food_cost.count_unit_key(text),
                          food_cost.bom_hash(uuid),
                          food_cost.sheet_cost(uuid)
      to anon, authenticated, service_role;
grant execute on function food_cost.approve_sheet(uuid, text) to service_role;
grant all on all tables in schema food_cost to service_role;
grant select on food_cost.v_chef_alerts, food_cost.v_ingredient_price to service_role;

