-- ============================================================================
-- FC05 — Food cost realistico: prezzi nativi, conversioni approvate,
--        semaforo VERDE / GIALLO / ROSSO   (PROPOSTA, non applicata)
-- ============================================================================
-- Regole di Max (FC05):
--   * un ingrediente comprato e usato a pezzo costa a pezzo: nessun peso richiesto
--     (Edible Flower: 50 CT a $16,65 -> $0,333 a fiore);
--   * il formato del fornitore si converte da solo: 12/1 QT = 11.356 ml, senza
--     chiedere moltiplicazioni allo chef; la panna in ml usa il prezzo al ml;
--   * le conversioni volume/peso e peso/pezzo sono "approvate" (valgono come
--     documentate) o "proposte" (valgono come STIMA finche' lo chef non conferma);
--     mai 1 L = 1 kg fuori dall'olio;
--   * una ricetta non si blocca per 1 g di pepe: le righe senza prezzo ricevono
--     una stima prudente da un riferimento identificabile (i prezzi che Brigade
--     ha davvero pagato nella stessa categoria). Zafferano, tartufo & co. non si
--     stimano mai;
--   * VERDE: tutto documentato. GIALLO: stime piccole, totale utilizzabile e
--     dichiarato come stimato. ROSSO: manca qualcosa di non stimabile, o le
--     stime pesano troppo. Soglie configurabili (food_cost.soglie);
--   * 10% catering separato, snapshot dei consuntivi invariato, ricette Zeno 2.0
--     mai toccate.
-- Tutto additivo: nessuna colonna di tabelle public, nessuna ricetta, nessuna
-- fattura. Le funzioni esistenti mantengono i campi di prima e ne aggiungono.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Formato del fornitore -> quantita' totale nella sua dimensione
--    (stessa grammatica di js/pack-format.js: 12/1 QT, 6 CT, 3/5LT, 9-1/2 GAL,
--     10 KG, 5#, 4X5LB, 8/12 OZ, 1 DZ). Intervalli ("16-22 CT") e lattine
--    ("6/#10"): nessuna ipotesi, null.
-- ---------------------------------------------------------------------------
create or replace function food_cost.pack_unit(p_u text, out unita text, out dim text, out fattore numeric)
language sql immutable as $$
  select x.unita, x.dim, x.fattore from (values
    ('G','g','mass',1::numeric), ('GR','g','mass',1), ('GRAM','g','mass',1), ('GRAMS','g','mass',1),
    ('KG','kg','mass',1000), ('KGS','kg','mass',1000), ('KILO','kg','mass',1000),
    ('LB','lb','mass',453.592), ('LBS','lb','mass',453.592), ('OZ','oz','mass',28.3495),
    ('ML','ml','volume',1), ('L','l','volume',1000), ('LT','l','volume',1000), ('LTR','l','volume',1000),
    ('LITER','l','volume',1000), ('LITRE','l','volume',1000), ('LITERS','l','volume',1000),
    ('QT','qt','volume',946.353), ('QUART','qt','volume',946.353),
    ('GAL','gal','volume',3785.41), ('GALLON','gal','volume',3785.41), ('GA','gal','volume',3785.41),
    ('CT','pz','count',1), ('EA','pz','count',1), ('EACH','pz','count',1), ('PC','pz','count',1),
    ('PCS','pz','count',1), ('PZ','pz','count',1), ('BUNCH','pz','count',1), ('BU','pz','count',1),
    ('DZ','dz','count',12)
  ) x(k, unita, dim, fattore)
  where x.k = rtrim(upper(btrim(p_u)), '.')
$$;

create or replace function food_cost.pack_parse(p text,
  out confezioni numeric, out quantita numeric, out unita text, out dim text, out totale numeric)
language plpgsql immutable as $$
declare s text; m text[]; u record;
begin
  if p is null or btrim(p) = '' then return; end if;
  s := upper(btrim(p));
  s := regexp_replace(s, '(\d)\s*#', '\1 LB', 'g');
  s := regexp_replace(s, '\s*/\s*', '/', 'g');
  s := regexp_replace(s, '(\d)\s*X\s*(\d)', '\1x\2', 'g');
  s := regexp_replace(s, '\s+', ' ', 'g');
  m := regexp_match(s, '^(\d+)-(\d+)/(\d+)\s*([A-Z.]+)$');                -- 9-1/2 GAL
  if m is not null then
    confezioni := m[1]::numeric; quantita := m[2]::numeric / m[3]::numeric;
    select * into u from food_cost.pack_unit(m[4]);
  elsif s ~ '^\d+(\.\d+)?\s*-\s*\d' then                                   -- intervallo
    return;
  else
    m := regexp_match(s, '^(\d+(?:\.\d+)?)/(\d+(?:\.\d+)?)\s*([A-Z.]+)$'); -- 12/1 QT
    if m is null then m := regexp_match(s, '^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)\s*([A-Z.]+)$'); end if;
    if m is not null then
      confezioni := m[1]::numeric; quantita := m[2]::numeric;
      select * into u from food_cost.pack_unit(m[3]);
    else
      m := regexp_match(s, '^(\d+(?:\.\d+)?)\s*([A-Z.]+)$');                -- 6 CT, 10 KG
      if m is null then return; end if;
      select * into u from food_cost.pack_unit(m[2]);
      if u.dim = 'count' then confezioni := m[1]::numeric; quantita := 1;
      else confezioni := 1; quantita := m[1]::numeric; end if;
    end if;
  end if;
  if u.unita is null or not (confezioni > 0) or not (quantita > 0) then
    confezioni := null; quantita := null; return;
  end if;
  unita := u.unita; dim := u.dim; totale := confezioni * quantita * u.fattore;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Conversioni per ingrediente: approvate o proposte
--    peso_pezzo: grammi per pezzo (uovo); densita: grammi per ml (panna).
--    "proposta" = stima: entra nel costo come stima (GIALLO) finche' lo chef
--    non conferma, e resta riutilizzabile per tutti gli acquisti successivi.
-- ---------------------------------------------------------------------------
create table if not exists food_cost.conversioni (
  ingredient_id uuid not null references public.ingredients(id),
  tipo          text not null check (tipo in ('peso_pezzo', 'densita')),
  valore        numeric not null check (valore > 0),
  stato         text not null check (stato in ('proposta', 'approvata')),
  fonte         text not null,
  riferimento   text,
  approvata_da  text,
  approvata_at  timestamptz,
  created_at    timestamptz not null default now(),
  primary key (ingredient_id, tipo)
);

-- La conversione valida: prima le approvate (questa tabella, poi le fonti gia'
-- verificate: unit_each_weights, ingredient_density, convenzione olio), poi
-- le proposte. Mai una regola generica 1 L = 1 kg.
create or replace function food_cost.conv_for(p_ingredient_id uuid, p_tipo text,
  out valore numeric, out stato text, out fonte text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select v, s, f from (
    select c.valore v, 'approvata' s, c.fonte f, 1 o from food_cost.conversioni c
     where c.ingredient_id = p_ingredient_id and c.tipo = p_tipo and c.stato = 'approvata'
    union all
    select w.avg_weight_g, 'approvata', coalesce(w.source, 'peso unitario verificato'), 2
      from public.unit_each_weights w where p_tipo = 'peso_pezzo' and w.ingredient_id = p_ingredient_id
    union all
    select d.g_per_ml, 'approvata', d.source, 3
      from food_cost.density_for(p_ingredient_id) d where p_tipo = 'densita' and d.g_per_ml is not null
    union all
    select c.valore, 'proposta', c.fonte, 4 from food_cost.conversioni c
     where c.ingredient_id = p_ingredient_id and c.tipo = p_tipo and c.stato = 'proposta'
  ) x order by o limit 1
$$;

-- ---------------------------------------------------------------------------
-- 3. Stime prudenti per le righe senza prezzo
-- ---------------------------------------------------------------------------
-- Ingredienti che non si stimano MAI: pochi grammi possono valere molto.
create table if not exists food_cost.alto_valore (
  modello text primary key,   -- espressione regolare sul nome (case-insensitive)
  motivo  text not null
);
insert into food_cost.alto_valore (modello, motivo) values
  ('saffron|zafferano', 'pochi grammi, prezzo altissimo'),
  ('truffle|tartufo', 'pochi grammi, prezzo altissimo'),
  ('caviar|caviale|bottarga', 'prezzo altissimo'),
  ('vanilla bean|bacca di vaniglia', 'prezzo alto per pezzo'),
  ('wagyu|foie gras', 'prezzo altissimo'),
  ('lobster|astice|aragosta', 'prezzo altissimo'),
  ('pine nut|pinoli|pistach|pistacch', 'frutta secca cara'),
  ('porcini', 'prezzo alto')
on conflict (modello) do nothing;

-- Misure di cucina senza grammi (pizzico, spicchio...): solo per stimare l'impatto.
create table if not exists food_cost.misure_cucina (
  unita  text primary key,
  grammi numeric not null check (grammi > 0),
  fonte  text not null
);
insert into food_cost.misure_cucina (unita, grammi, fonte) values
  ('pinch', 0.5, 'un pizzico: 0,3-0,5 g, si usa il valore alto'),
  ('pizzico', 0.5, 'un pizzico: 0,3-0,5 g, si usa il valore alto'),
  ('drops', 0.05, 'una goccia: circa 0,05 g'),
  ('spicchi', 6, 'uno spicchio d''aglio: 4-6 g, si usa il valore alto'),
  ('foglia', 1, 'una foglia (alloro, salvia): meno di 1 g'),
  ('foglio', 2, 'un foglio di gelatina: circa 2 g')
on conflict (unita) do nothing;

-- Soglie del semaforo: configurabili. Valori di partenza da confermare con Max.
create table if not exists food_cost.soglie (
  chiave      text primary key,
  valore      numeric not null,
  descrizione text not null
);
insert into food_cost.soglie (chiave, valore, descrizione) values
  ('stima_max_porzione', 0.10, 'GIALLO se la parte stimata (valore prudente) non supera questi $ a porzione'),
  ('stima_max_ricetta', 1.00, 'per le ricette senza porzioni: GIALLO se la parte stimata non supera questi $ a lotto'),
  ('stima_max_quota', 0.10, 'oppure GIALLO se la parte incerta non supera questa frazione del costo (0,10 = 10%)'),
  ('peso_prezzo_chef', 0.20, 'quanto e'' incerto un prezzo dichiarato dallo chef (0,20 = puo'' sbagliare del 20%)'),
  ('peso_prezzo_senza_fattura', 0.50, 'quanto e'' incerto un prezzo registrato senza fattura'),
  ('peso_conversione_proposta', 0.20, 'quanto e'' incerta una conversione proposta non ancora confermata (uova 55 g)')
on conflict (chiave) do nothing;

-- Riferimento identificabile: vedi food_cost.v_riferimento_categoria (sezione 4),
-- i prezzi documentati che Brigade ha pagato per categoria (mediana e 90°
-- percentile, $/100 g). Si aggiorna da solo con ogni nuova fattura.

-- Stima di una riga senza prezzo: grammi x riferimento. Null se non si stima.
create or replace function food_cost.stima_riga(p_ingredient_id uuid, p_grammi numeric,
  out centrale numeric, out massimo numeric, out fonte text)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare i record; r record;
begin
  select id, name, coalesce(category, 'Senza categoria') cat into i from public.ingredients where id = p_ingredient_id;
  if not found or not (p_grammi >= 0) then return; end if;
  if exists (select 1 from food_cost.alto_valore a where i.name ~* a.modello) then return; end if;
  select * into r from food_cost.v_riferimento_categoria where categoria = i.cat and n >= 5;
  if not found then select * into r from food_cost.v_riferimento_categoria where categoria = '*'; end if;
  if not found or r.p50 is null then return; end if;
  centrale := p_grammi * r.p50 / 100;
  massimo := p_grammi * r.p90 / 100;
  fonte := format('prezzi pagati da Brigade per "%s": mediana $%s, prudente $%s /100 g (%s prezzi)',
                  r.categoria, round(r.p50::numeric, 4), round(r.p90::numeric, 4), r.n);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Prezzi: al pezzo e al ml dal formato, oltre che al grammo
-- ---------------------------------------------------------------------------
alter table food_cost.event_price_snapshot add column if not exists cost_per_ml numeric;

drop view if exists food_cost.v_chef_alerts;
drop view if exists food_cost.v_ingredient_price;
drop view if exists food_cost.v_riferimento_categoria;
drop view if exists food_cost.v_price_candidates;

create view food_cost.v_price_candidates as
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
         -- al pezzo: dichiarato, oppure prezzo della cassa diviso i pezzi del formato
         case when iv.price_per_each > 0 then iv.price_per_each
              when coalesce(iv.price_type, 'per_case') = 'per_case' and iv.unit_price > 0 and pk.dim = 'count'
                then iv.unit_price / pk.totale end as cost_per_each,
         -- al ml: prezzo della cassa diviso il volume del formato (conversione standard esatta)
         case when coalesce(iv.price_type, 'per_case') = 'per_case' and iv.unit_price > 0 and pk.dim = 'volume'
                then iv.unit_price / pk.totale end as cost_per_ml,
         pk.totale as pack_totale, pk.dim as pack_dim
  from public.ingredient_vendors iv
  join public.ingredients i on i.id = iv.ingredient_id
  left join lateral food_cost.pack_parse(iv.pack_description) pk on true
  where iv.active
)
select b.*,
       line.invoice_number, line.line_cost_per_100g,
       array_remove(array[
         case when b.price_per_100g > 0 and b.conversion_to_base > 0 and b.unit_price > 0
                   and abs(b.price_per_100g - b.unit_price / b.conversion_to_base * 100) / b.price_per_100g > 0.02
              then format('prezzo/100 %s vs pack %s', round(b.price_per_100g, 4),
                          round(b.unit_price / b.conversion_to_base * 100, 4)) end,
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
where b.cost_per_base is not null or b.cost_per_each is not null or b.cost_per_ml is not null;

create view food_cost.v_ingredient_price as
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
       -- PRESTAZIONI (FC05): "ranked" si usa UNA volta sola, cosi' Postgres la
       -- espande e filtra subito sull'ingrediente cercato invece di calcolare
       -- tutti i prezzi a ogni riga di ricetta. Il confronto fra fornitori dello
       -- stesso giorno legge direttamente ingredient_vendors.
       array_remove(array[
         case when r.price_class = 'A' and exists (
           select 1 from public.ingredient_vendors o
           where o.ingredient_id = r.ingredient_id and o.active and o.id <> r.candidate_id
             and o.last_invoice_date = r.last_invoice_date and o.vendor not ilike 'STIMA CHEF%'
             and abs(coalesce(nullif(o.price_per_100g, 0) / 100,
                              case when o.conversion_to_base > 0 then o.unit_price / o.conversion_to_base end)
                     - r.cost_per_base) / nullif(r.cost_per_base, 0) > 0.02)
         then 'due fornitori, stessa data, prezzi diversi' end
       ], null) as tie_conflicts,
       array_remove(array[
         (select format('fattura piu'' recente non applicata al prezzo: %s %s', l.vendor, l.invoice_date)
            from public.invoice_lines l
           where l.ingredient_id = r.ingredient_id and l.match_status = 'matched'
             and l.invoice_date > coalesce(r.last_invoice_date, date '1900-01-01')
           order by l.invoice_date desc limit 1)
       ], null) as warnings,
       r.cost_per_ml, r.pack_totale, r.pack_dim
from ranked r
where r.rn = 1;

-- Riferimento delle stime: i prezzi al grammo documentati (con fattura, non
-- stime chef), per categoria. Letto dalle tabelle base: non serve il formato.
create view food_cost.v_riferimento_categoria as
with p as (
  select coalesce(i.category, 'Senza categoria') as categoria, i.name,
         coalesce(nullif(iv.price_per_100g, 0),
                  case when iv.price_type = 'per_lb' and iv.unit_price > 0 then iv.unit_price / 453.592 * 100 end,
                  case when iv.conversion_to_base > 0 and iv.unit_price > 0 then iv.unit_price / iv.conversion_to_base * 100 end) as c100
  from public.ingredient_vendors iv
  join public.ingredients i on i.id = iv.ingredient_id
  where iv.active and iv.last_invoice_date is not null and iv.vendor not ilike 'STIMA CHEF%'
    and coalesce(i.measure_type, '') <> 'volume' and lower(coalesce(i.base_unit, '')) <> 'ml'
    and not exists (select 1 from food_cost.alto_valore a where i.name ~* a.modello)
)
select categoria, count(*) as n,
       percentile_cont(0.5) within group (order by c100) as p50,
       percentile_cont(0.9) within group (order by c100) as p90
from p where c100 > 0 group by categoria
union all
select '*', count(*), percentile_cont(0.5) within group (order by c100),
       percentile_cont(0.9) within group (order by c100) from p where c100 > 0;

drop function if exists food_cost.price_for(uuid, uuid);
create function food_cost.price_for(p_ingredient_id uuid, p_sheet_id uuid default null)
returns table (candidate_id uuid, vendor text, price_class text, basis_dim text,
               cost_per_base numeric, cost_per_each numeric, last_invoice_date date,
               invoice_number text, pack_description text, conflicts text[], warnings text[],
               cost_per_ml numeric)
language sql stable security definer set search_path = pg_catalog, public as $$
  select s.candidate_id, s.vendor, s.price_class, s.basis_dim, s.cost_per_base, s.cost_per_each,
         s.last_invoice_date, s.invoice_number, null::text, '{}'::text[], '{}'::text[], s.cost_per_ml
  from food_cost.event_price_snapshot s
  where p_sheet_id is not null and s.sheet_id = p_sheet_id and s.ingredient_id = p_ingredient_id
  union all
  select p.candidate_id, p.vendor, p.price_class, p.basis_dim, p.cost_per_base, p.cost_per_each,
         p.last_invoice_date, p.invoice_number, p.pack_description,
         p.conflicts || p.tie_conflicts, p.warnings, p.cost_per_ml
  from food_cost.v_ingredient_price p
  where p.ingredient_id = p_ingredient_id
    and not exists (select 1 from food_cost.event_price_snapshot s
                    where p_sheet_id is not null and s.sheet_id = p_sheet_id
                      and s.ingredient_id = p_ingredient_id)
$$;

-- ---------------------------------------------------------------------------
-- 5. Il motore, esteso. Stessi campi di prima (status, complete, totals,
--    cost_per_portion...) piu':
--      stime     {centrale, massimo}  righe senza prezzo stimate
--      semaforo  {colore, motivo, costo_stimato, parte_stimata, margine,
--                 costo_porzione, parte_stimata_porzione, non_stimabili[]}
-- ---------------------------------------------------------------------------
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
  cd       record;          -- conversione densita' (valore, stato, fonte)
  cw       record;          -- conversione peso al pezzo
  ms       numeric;         -- grammi di una misura di cucina (pizzico...)
  srig     record;          -- stima di una riga
  child    jsonb;
  lines    jsonb := '[]';
  issues   jsonb := '[]';
  nonstim  jsonb := '[]';
  tot_a    numeric := 0; tot_b numeric := 0; tot_c numeric := 0;
  st_c     numeric := 0; st_m numeric := 0;
  incert   numeric := 0;    -- quanto puo' sbagliare il costo: guida il semaforo
  conv_prop boolean;
  qty_base numeric; unit_cost numeric; line_cost numeric; cls text; st text; note text;
  g_est    numeric; stima jsonb; motivo_ns text;
  c_known  numeric; c_yield numeric; c_dim text; frac numeric;
  y_qty    numeric; y_dim text; y_src text; y_warn jsonb := '[]';
  n_port   numeric; n_src text; n_text numeric; n_conflict text;
  path_txt text;
  complete boolean := true;
  only_a   boolean := true;
  s_porz   numeric; s_ric numeric; s_quota numeric; w_chef numeric; w_nofatt numeric; w_conv numeric;
  parte    numeric; parte_max numeric; costo numeric; colore text; motivo text;
begin
  select * into r from public.recipes where id = p_recipe_id;
  if not found then
    return jsonb_build_object('recipe_id', p_recipe_id, 'status', 'incompleto', 'complete', false,
      'issues', jsonb_build_array(jsonb_build_object('code', 'ricetta_inesistente')),
      'semaforo', jsonb_build_object('colore', 'ROSSO', 'motivo', 'ricetta inesistente'));
  end if;
  path_txt := coalesce((select string_agg(rr.title, ' > ' order by o)
                        from unnest(p_path || p_recipe_id) with ordinality x(id, o)
                        join public.recipes rr on rr.id = x.id), r.title);

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

  if r.base_servings > 0 then
    n_port := r.base_servings; n_src := 'base_servings';
  elsif y_dim = 'mass' and r.serving_weight_g > 0 then
    n_port := y_qty / r.serving_weight_g; n_src := 'resa / serving_weight_g';
  elsif y_dim = 'mass' and lower(coalesce(r.serving_unit, '')) = 'g' and r.serving_qty > 0 then
    n_port := y_qty / r.serving_qty; n_src := 'resa / serving_qty g';
  end if;
  n_text := replace(substring(r.yield_text from '^\s*(\d+(?:[.,]\d+)?)\s*porzion'), ',', '.')::numeric;
  if n_port > 0 and n_text > 0 and abs(n_port - n_text) / n_text > 0.05 then
    n_conflict := format('porzioni in conflitto: %s da %s, %s da yield_text "%s"',
                         round(n_port, 2), n_src, n_text, btrim(r.yield_text));
  end if;

  select coalesce(max(valore) filter (where chiave = 'peso_prezzo_chef'), 0.20),
         coalesce(max(valore) filter (where chiave = 'peso_prezzo_senza_fattura'), 0.50),
         coalesce(max(valore) filter (where chiave = 'peso_conversione_proposta'), 0.20)
    into w_chef, w_nofatt, w_conv from food_cost.soglie;

  for b in
    select rb.*, i.name as ing_name, i.category as ing_category, i.measure_type as ing_mt, sr.title as sub_title
    from public.recipe_bom rb
    left join public.ingredients i on i.id = rb.item_id
    left join public.recipes sr on sr.id = rb.sub_recipe_id
    where rb.parent_recipe_id = p_recipe_id
    order by rb.sort_order nulls last, rb.bom_id
  loop
    qty_base := null; unit_cost := null; line_cost := null; cls := null; st := 'ok'; note := null;
    g_est := null; stima := null; motivo_ns := null; conv_prop := false;
    select * into u from food_cost.unit_info(b.unit);

    if b.component_type = 'ITEM' then
      select policy into pol from food_cost.ingredient_policy where ingredient_id = b.item_id;
      has_pr := false; pr_json := null;
      select * into cd from food_cost.conv_for(b.item_id, 'densita');
      select * into cw from food_cost.conv_for(b.item_id, 'peso_pezzo');
      if pol = 'non_food' then
        st := 'escluso_non_alimentare';
      elsif pol = 'zero_cost' then
        st := 'ok'; cls := 'zero'; line_cost := 0; note := 'costo zero dichiarato';
      else
        select * into pr from food_cost.price_for(b.item_id, p_sheet_id) limit 1;
        has_pr := found;
        if has_pr then
          pr_json := jsonb_build_object(
            'vendor', pr.vendor, 'class', pr.price_class, 'basis', pr.basis_dim,
            'cost_per_100', round(pr.cost_per_base * 100, 4), 'cost_per_each', pr.cost_per_each,
            'cost_per_100ml', round(pr.cost_per_ml * 100, 4),
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
          if u.dim = 'count' then
            if pr.cost_per_each is not null then
              -- comprato e usato a pezzo: nessun peso serve
              qty_base := b.quantity; unit_cost := pr.cost_per_each; note := 'prezzo al pezzo';
            elsif pr.cost_per_base is not null and cw.valore > 0 then
              qty_base := b.quantity * cw.valore; unit_cost := pr.cost_per_base;
              note := format('%s g per pezzo (%s)', cw.valore, cw.fonte);
              if cw.stato = 'proposta' then cls := 'C'; conv_prop := true; note := note || ', stima da confermare'; end if;
            else
              st := 'conversione_mancante'; note := 'pezzi senza prezzo al pezzo ne'' peso per pezzo';
            end if;
          elsif u.dim = 'volume' and pr.cost_per_ml is not null then
            -- prezzo al ml dal formato del fornitore (12/1 QT = 11.356 ml): conversione esatta
            qty_base := b.quantity * u.factor; unit_cost := pr.cost_per_ml;
            note := format('prezzo al ml dal formato «%s»', pr.pack_description);
          elsif u.dim = pr.basis_dim and pr.cost_per_base is not null then
            qty_base := b.quantity * u.factor; unit_cost := pr.cost_per_base;
          elsif u.dim = 'mass' and pr.cost_per_base is null and pr.cost_per_ml is not null and cd.valore > 0 then
            qty_base := b.quantity * u.factor / cd.valore; unit_cost := pr.cost_per_ml;
            note := format('%s g/ml (%s)', round(cd.valore, 4), cd.fonte);
            if cd.stato = 'proposta' then cls := 'C'; conv_prop := true; note := note || ', stima da confermare'; end if;
          elsif pr.cost_per_base is not null and cd.valore > 0 then
            qty_base := case when u.dim = 'volume' then b.quantity * u.factor * cd.valore
                             else b.quantity * u.factor / cd.valore end;
            unit_cost := pr.cost_per_base; note := format('%s g/ml (%s)', round(cd.valore, 4), cd.fonte);
            if cd.stato = 'proposta' then cls := 'C'; conv_prop := true; note := note || ', stima da confermare'; end if;
          elsif pr.cost_per_base is null and pr.cost_per_ml is null and pr.cost_per_each is not null then
            -- solo prezzo al pezzo, ricetta in peso o volume
            if u.dim = 'mass' and cw.valore > 0 then
              qty_base := b.quantity * u.factor / cw.valore; unit_cost := pr.cost_per_each;
              note := format('%s g per pezzo (%s)', cw.valore, cw.fonte);
              if cw.stato = 'proposta' then cls := 'C'; conv_prop := true; note := note || ', stima da confermare'; end if;
            else
              st := 'unita_sospetta';
              note := 'si compra a pezzi ma la ricetta lo scrive in ' || b.unit || ': da rivedere nella ricetta';
            end if;
          else
            st := 'conversione_mancante';
            note := format('%s -> %s senza conversione approvata', u.dim, coalesce(pr.basis_dim, '?'));
          end if;
          if st = 'ok' then line_cost := qty_base * unit_cost; end if;
        end if;

        -- STIMA: solo dove manca il prezzo o la conversione, mai sopra un prezzo vero
        if st in ('prezzo_mancante', 'conversione_mancante') then
          if u.dim = 'mass' then g_est := b.quantity * u.factor;
          elsif u.dim = 'volume' then g_est := b.quantity * u.factor * coalesce(cd.valore, 1);
          elsif u.dim = 'count' and cw.valore > 0 then g_est := b.quantity * cw.valore;
          elsif u.dim is null then
            select grammi into ms from food_cost.misure_cucina where unita = lower(btrim(b.unit));
            if ms > 0 then g_est := b.quantity * ms; end if;
          end if;
          if g_est is null then
            motivo_ns := 'quantita'' non stimabile (' || b.quantity || ' ' || b.unit || ')';
          elsif has_pr and pr.cost_per_base is not null then
            -- c'e' il prezzo, manca solo la conversione: si usa il prezzo vero
            stima := jsonb_build_object('centrale', g_est * pr.cost_per_base, 'massimo', g_est * pr.cost_per_base * 1.10,
              'fonte', 'prezzo documentato, conversione stimata' || case when u.dim = 'volume' and cd.valore is null then ' (1 ml ~ 1 g solo per la stima)' else '' end);
          else
            select * into srig from food_cost.stima_riga(b.item_id, g_est);
            if srig.centrale is null then
              motivo_ns := case when exists (select 1 from food_cost.alto_valore a where b.ing_name ~* a.modello)
                                then 'ingrediente di valore alto: non si stima' else 'nessun riferimento di prezzo' end;
            else
              stima := jsonb_build_object('centrale', srig.centrale, 'massimo', srig.massimo, 'fonte', srig.fonte,
                'grammi', g_est) ;
            end if;
          end if;
          if stima is not null then
            st_c := st_c + (stima ->> 'centrale')::numeric; st_m := st_m + (stima ->> 'massimo')::numeric;
            incert := incert + (stima ->> 'massimo')::numeric;
          end if;
        elsif st in ('prezzo_in_conflitto', 'unita_sospetta') then
          motivo_ns := case st when 'unita_sospetta' then 'unita'' della ricetta da rivedere'
                               else 'prezzo in conflitto con la fattura' end;
        end if;
        if motivo_ns is not null then
          nonstim := nonstim || jsonb_build_object('path', path_txt, 'componente', b.ing_name,
            'qty', b.quantity, 'unit', b.unit, 'motivo', motivo_ns);
        end if;
      end if;

      lines := lines || jsonb_build_object(
        'bom_id', b.bom_id, 'kind', 'ingrediente', 'name', b.ing_name, 'ingredient_id', b.item_id,
        'qty', b.quantity, 'unit', b.unit, 'status', st, 'class', cls, 'cost', line_cost, 'note', note,
        'price', pr_json, 'stima', stima);
      pol := null;

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
          st_c := st_c + coalesce((child #>> '{stime,centrale}')::numeric, 0) * frac;
          st_m := st_m + coalesce((child #>> '{stime,massimo}')::numeric, 0) * frac;
          incert := incert + coalesce((child #>> '{stime,incertezza}')::numeric, 0) * frac;
          nonstim := nonstim || coalesce(child #> '{semaforo,non_stimabili}', '[]');
          if not (child ->> 'complete')::boolean then st := 'sotto_ricetta_incompleta'; end if;
          if child ->> 'status' <> 'verificato' then only_a := false; end if;
        else
          -- senza frazione la sotto-ricetta non si puo' pesare dentro questa
          nonstim := nonstim || jsonb_build_object('path', path_txt, 'componente', b.sub_title,
            'qty', b.quantity, 'unit', b.unit, 'motivo', coalesce(note, st));
        end if;
        issues := issues || coalesce(child -> 'issues', '[]');
      end if;
      if st = 'ciclo' then
        nonstim := nonstim || jsonb_build_object('path', path_txt, 'componente', b.sub_title,
          'qty', b.quantity, 'unit', b.unit, 'motivo', 'ciclo');
      end if;
      lines := lines || jsonb_build_object(
        'bom_id', b.bom_id, 'kind', 'sotto_ricetta', 'name', b.sub_title, 'recipe_id', b.sub_recipe_id,
        'qty', b.quantity, 'unit', b.unit, 'status', st, 'cost', line_cost, 'note', note,
        'fraction', frac, 'child_status', child ->> 'status', 'child_semaforo', child #>> '{semaforo,colore}');
      child := null; frac := null;
    end if;

    if b.component_type = 'ITEM' and st = 'ok' then
      if cls = 'zero' then null;
      elsif cls = 'A' then tot_a := tot_a + line_cost;
      elsif cls = 'B' then tot_b := tot_b + line_cost; only_a := false; incert := incert + w_chef * line_cost;
      else tot_c := tot_c + line_cost; only_a := false;
        -- prezzo vero con conversione proposta (uova 55 g): incerta solo la
        -- conversione; prezzo registrato senza fattura: incerto di piu'
        incert := incert + case when conv_prop then w_conv else w_nofatt end * line_cost;
      end if;
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
    nonstim := nonstim || jsonb_build_object('path', path_txt, 'motivo', 'distinta vuota');
  end if;
  if n_conflict is not null then
    issues := issues || jsonb_build_object('code', 'porzioni_in_conflitto', 'path', path_txt, 'detail', n_conflict);
  end if;
  if y_qty is null then
    issues := issues || jsonb_build_object('code', 'resa_non_dichiarata', 'path', path_txt);
  end if;

  -- SEMAFORO
  select valore into s_porz  from food_cost.soglie where chiave = 'stima_max_porzione';
  select valore into s_ric   from food_cost.soglie where chiave = 'stima_max_ricetta';
  select valore into s_quota from food_cost.soglie where chiave = 'stima_max_quota';
  parte     := tot_b + tot_c + st_c;               -- componente stimata (valore centrale)
  parte_max := tot_b + tot_c + st_m;               -- componente stimata (valore prudente)
  costo     := tot_a + tot_b + tot_c + st_c;       -- costo stimato complessivo
  if jsonb_array_length(nonstim) > 0 then
    colore := 'ROSSO'; motivo := 'manca qualcosa che non si puo'' stimare';
  elsif complete and only_a then
    colore := 'VERDE'; motivo := 'tutto documentato';
  -- GIALLO se la parte incerta e' piccola in dollari (a porzione, o a lotto per
  -- le ricette senza porzioni) OPPURE in percentuale del costo: 1 g di pepe non
  -- rende rosso un piatto economico, e 3 $ su un piatto da 60 $ non lo rendono rosso.
  elsif incert <= coalesce(s_quota, 0.10) * (costo + (st_m - st_c))
        or (case when n_port > 0 and n_conflict is null then incert / n_port <= coalesce(s_porz, 0.10)
                 else incert <= coalesce(s_ric, 1.00) end) then
    colore := 'GIALLO'; motivo := 'costo utilizzabile, con una piccola parte stimata';
  else
    colore := 'ROSSO'; motivo := 'la parte stimata e'' troppo grande per fidarsi del totale';
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
    'stime', jsonb_build_object('centrale', st_c, 'massimo', st_m, 'incertezza', incert),
    'semaforo', jsonb_build_object(
      'colore', colore, 'motivo', motivo,
      'costo_stimato', case when colore <> 'ROSSO' then costo end,
      'costo_noto', tot_a + tot_b + tot_c,
      'parte_stimata', parte, 'margine', st_m - st_c, 'incertezza', incert,
      'incertezza_porzione', case when n_port > 0 and n_conflict is null then incert / n_port end,
      'costo_porzione', case when colore <> 'ROSSO' and n_port > 0 and n_conflict is null then costo / n_port end,
      'parte_stimata_porzione', case when n_port > 0 and n_conflict is null then parte / n_port end,
      'margine_porzione', case when n_port > 0 and n_conflict is null then (st_m - st_c) / n_port end,
      'non_stimabili', nonstim),
    'lines', lines, 'issues', issues,
    'chef_validation', (select jsonb_build_object('validated', v.bom_hash = food_cost.bom_hash(r.id),
                                                  'stale', v.bom_hash <> food_cost.bom_hash(r.id),
                                                  'by', v.validated_by, 'at', v.validated_at, 'note', v.note)
                        from food_cost.recipe_validation v where v.recipe_id = r.id));
end $$;

-- ---------------------------------------------------------------------------
-- 6. Avvisi intelligenti
--    prezzo_mancante            nessun prezzo (la schermata distingue "mai
--                               fatturato" da "fattura non collegata")
--    unita_sospetta             si compra e si usa a pezzi, ma una ricetta lo
--                               scrive in grammi/ml: da rivedere nella ricetta
--    conversione_da_confermare  c'e' una conversione proposta (uova 55 g)
--    manca_peso_al_pezzo / manca_densita / unita_non_convertibile / conflitto
--    Chi si compra e si usa a pezzo, o ha il prezzo al ml dal formato, non
--    compare piu'.
-- ---------------------------------------------------------------------------
create view food_cost.v_chef_alerts as
with uso as (
  select b.item_id as ingredient_id, b.unit, r.id as recipe_id, r.title,
         (food_cost.unit_info(b.unit)).dim as dim
  from public.recipe_bom b
  join public.recipes r on r.id = b.parent_recipe_id
  where b.component_type = 'ITEM'
    and not exists (select 1 from food_cost.ingredient_policy x where x.ingredient_id = b.item_id)
),
problemi as (
  select u.ingredient_id, u.recipe_id, u.title, u.unit,
    case
      when p.ingredient_id is null then 'prezzo_mancante'
      when cardinality(p.conflicts) + cardinality(p.tie_conflicts) > 0 then 'prezzo_in_conflitto'
      when u.dim is null then 'unita_non_convertibile'
      when u.dim = 'count' then
        case when p.cost_per_each is not null then null
             when w.stato = 'approvata' and p.cost_per_base is not null then null
             when w.stato = 'proposta' then 'conversione_da_confermare'
             else 'manca_peso_al_pezzo' end
      when u.dim = 'volume' and p.cost_per_ml is not null then null
      when u.dim = p.basis_dim and p.cost_per_base is not null then null
      when p.cost_per_base is null and p.cost_per_ml is null and p.cost_per_each is not null then
        case when w.stato = 'approvata' then null
             when w.stato = 'proposta' then 'conversione_da_confermare'
             else 'unita_sospetta' end
      else
        case when d.stato = 'approvata' then null
             when d.stato = 'proposta' then 'conversione_da_confermare'
             else 'manca_densita' end
    end as codice,
    case when u.dim = 'count' or (p.cost_per_base is null and p.cost_per_ml is null) then
           case when w.valore > 0 then format('%s g per pezzo', round(w.valore, 1)) end
         else case when d.valore > 0 then format('%s g/ml', round(d.valore, 3)) end end as conversione
  from uso u
  left join food_cost.v_ingredient_price p on p.ingredient_id = u.ingredient_id
  left join lateral food_cost.conv_for(u.ingredient_id, 'peso_pezzo') w on true
  left join lateral food_cost.conv_for(u.ingredient_id, 'densita') d on true
)
select i.id as ingredient_id, i.name as ingrediente, pr.codice,
       case pr.codice
         when 'prezzo_mancante'           then format('Manca il prezzo di %s.', i.name)
         when 'prezzo_in_conflitto'       then format('Il prezzo di %s non torna con la fattura: va controllato.', i.name)
         when 'unita_non_convertibile'    then format('%s e'' scritto in un''unita'' non convertibile (%s).', i.name, string_agg(distinct pr.unit, ', '))
         when 'manca_peso_al_pezzo'       then format('%s: serve il peso di un pezzo.', i.name)
         when 'manca_densita'             then format('%s: serve la conversione fra litri e chili.', i.name)
         when 'unita_sospetta'            then format('%s si compra e si usa a pezzi, ma qui la ricetta lo scrive in %s: da rivedere.', i.name, string_agg(distinct pr.unit, ', '))
         when 'conversione_da_confermare' then format('%s: la conversione %s e'' una stima da confermare.', i.name, max(pr.conversione))
       end as messaggio,
       count(distinct pr.recipe_id) as ricette_bloccate,
       string_agg(distinct pr.title, ', ') as ricette,
       max(pr.conversione) as conversione
from problemi pr
join public.ingredients i on i.id = pr.ingredient_id
where pr.codice is not null
group by i.id, i.name, pr.codice
order by ricette_bloccate desc, i.name;

-- La schermata Prezzi mancanti: stesse prove di FC04, diagnosi per i codici nuovi.
create or replace function food_cost.missing_price_report()
returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  with a as (select * from food_cost.v_chef_alerts),
  ev as (
    select a.*,
      (select jsonb_build_object('vendor', l.vendor, 'date', l.invoice_date, 'number', l.invoice_number,
                                 'description', l.raw_description, 'pack', l.pack_description,
                                 'unit_price', l.unit_price, 'cost_per_100g', l.cost_per_100g)
         from public.invoice_lines l
        where l.ingredient_id = a.ingredient_id and coalesce(l.price_anomaly, false) = false
        order by l.invoice_date desc, l.created_at desc limit 1) as ultima_fattura,
      (select jsonb_build_object('vendor', l.vendor, 'date', l.invoice_date, 'number', l.invoice_number,
                                 'description', l.raw_description, 'pack', l.pack_description,
                                 'cost_per_100g', l.cost_per_100g)
         from public.invoice_lines l
        where l.ingredient_id = a.ingredient_id and l.cost_per_100g > 0 and coalesce(l.price_anomaly, false) = false
        order by l.invoice_date desc, l.created_at desc limit 1) as ultimo_prezzo_al_peso,
      (select count(*) from public.invoice_lines l where l.ingredient_id = a.ingredient_id) as righe_fattura,
      (select coalesce(jsonb_agg(distinct jsonb_build_object('document_id', d.id, 'vendor', d.vendor,
                                  'status', d.status, 'description', it->>'description')), '[]'::jsonb)
         from public.vendor_documents d
         cross join lateral jsonb_array_elements(coalesce(d.parsed_json -> 'items', '[]'::jsonb)) it
        where d.status in ('pending', 'error')
          and (exists (select 1 from public.ingredient_links k
                        where k.ingredient_id = a.ingredient_id and k.confirmed
                          and lower(k.invoice_description) = lower(it->>'description'))
               or exists (select 1 from public.vendor_item_aliases s
                           where s.ingredient_id = a.ingredient_id and s.active
                             and s.vendor_sku is not null and s.vendor_sku = it->>'vendor_sku'))) as documenti_in_attesa
    from a
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'ingredient_id', ingredient_id, 'ingrediente', ingrediente, 'codice', codice,
      'messaggio_motore', messaggio, 'ricette_bloccate', ricette_bloccate, 'ricette', ricette,
      'conversione', conversione,
      'righe_fattura', righe_fattura, 'ultima_fattura', ultima_fattura,
      'ultimo_prezzo_al_peso', ultimo_prezzo_al_peso, 'documenti_in_attesa', documenti_in_attesa,
      'diagnosi', case
        when codice = 'prezzo_in_conflitto' then 'conflitto'
        when codice = 'unita_sospetta' then 'unita_sospetta'
        when codice = 'conversione_da_confermare' then 'conversione_da_confermare'
        when codice = 'manca_peso_al_pezzo' then 'peso_al_pezzo'
        when codice = 'manca_densita' then 'litri_chili'
        when codice = 'unita_non_convertibile' then 'unita_ricetta'
        when righe_fattura = 0 and jsonb_array_length(documenti_in_attesa) = 0 then 'mai_fatturato'
        when righe_fattura = 0 then 'solo_in_attesa'
        when ultimo_prezzo_al_peso is not null then 'formato_nuovo_senza_peso'
        else 'formato_senza_peso'
      end)
    order by ricette_bloccate desc, ingrediente), '[]'::jsonb)
  from ev
$$;

-- Lo chef conferma (o corregge) una conversione: una volta, poi vale per tutti gli acquisti.
create or replace function public.fc_conferma_conversione(p_token text, p_ingredient_id uuid, p_tipo text, p_valore numeric)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare v_sess public.brigade_sessions%rowtype; v_user public.users%rowtype;
begin
  if p_token is null or length(p_token) <> 64 then return jsonb_build_object('ok', false, 'error', 'invalid_token'); end if;
  select * into v_sess from public.brigade_sessions
   where token_hash = encode(digest(p_token, 'sha256'), 'hex')
     and invalidated_at is null and expires_at > now() and absolute_expires_at > now();
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid_session'); end if;
  select * into v_user from public.users where id = v_sess.user_id and active = true;
  if not found or v_user.is_admin is not true then return jsonb_build_object('ok', false, 'error', 'unauthorized'); end if;
  if p_tipo not in ('peso_pezzo', 'densita') or not (p_valore > 0) then
    return jsonb_build_object('ok', false, 'error', 'invalid_value');
  end if;
  insert into food_cost.conversioni (ingredient_id, tipo, valore, stato, fonte, approvata_da, approvata_at)
  values (p_ingredient_id, p_tipo, p_valore, 'approvata', 'confermata dallo chef', v_user.name, now())
  on conflict (ingredient_id, tipo) do update
    set valore = excluded.valore, stato = 'approvata', approvata_da = excluded.approvata_da,
        approvata_at = excluded.approvata_at,
        fonte = case when food_cost.conversioni.valore = excluded.valore
                     then food_cost.conversioni.fonte || ' — confermata da ' || excluded.approvata_da
                     else 'corretta e confermata da ' || excluded.approvata_da end;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.fc_conferma_conversione(text, uuid, text, numeric) from public;
grant execute on function public.fc_conferma_conversione(text, uuid, text, numeric) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Elenco ricette e catering con il semaforo
-- ---------------------------------------------------------------------------
create or replace view public.recipes_with_cost as
select r.id, r.title, r.category, r.yield_text, r.prep_time_minutes, r.ingredients, r.procedure,
       r.equipment, r.created_at, r.image_url, r.base_weight, r.weight_unit, r.base_servings,
       x.total_cost,
       case when r.base_weight > 0 then x.total_cost / r.base_weight end as cost_per_kg,
       x.status as cost_status, x.known_cost, x.cost_per_portion, x.issue_count, x.chef_validated,
       x.semaforo, x.costo_stimato, x.costo_stimato_porzione, x.parte_stimata
from public.recipes r
cross join lateral (
  select case when (bd ->> 'complete')::boolean then (bd #>> '{totals,known}')::numeric end as total_cost,
         bd ->> 'status' as status,
         (bd #>> '{totals,known}')::numeric as known_cost,
         (bd ->> 'cost_per_portion')::numeric as cost_per_portion,
         jsonb_array_length(bd -> 'issues') as issue_count,
         coalesce((bd #>> '{chef_validation,validated}')::boolean, false) as chef_validated,
         bd #>> '{semaforo,colore}' as semaforo,
         (bd #>> '{semaforo,costo_stimato}')::numeric as costo_stimato,
         (bd #>> '{semaforo,costo_porzione}')::numeric as costo_stimato_porzione,
         (bd #>> '{semaforo,parte_stimata}')::numeric as parte_stimata
  from food_cost.recipe_breakdown(r.id) bd
) x;

-- Catering: le ricette GIALLE entrano con il costo stimato (dichiarato a parte),
-- le ROSSE restano fuori ed elencate. Il 10% resta una riga sua, una volta sola.
create or replace function food_cost.sheet_cost(p_sheet_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  s food_cost.event_cost_sheets%rowtype;
  l record; bd jsonb; mult numeric; charged numeric; lines jsonb := '[]';
  sub numeric := 0; stim numeric := 0; ok boolean := true; snap uuid; colore text; c numeric;
begin
  select * into s from food_cost.event_cost_sheets where id = p_sheet_id;
  if s.status = 'approved' then return s.frozen_result; end if;
  snap := case when exists (select 1 from food_cost.event_price_snapshot where sheet_id = p_sheet_id)
               then p_sheet_id end;
  for l in select * from food_cost.event_cost_lines where sheet_id = p_sheet_id loop
    bd := food_cost.recipe_breakdown(l.recipe_id, snap);
    colore := bd #>> '{semaforo,colore}';
    charged := null;
    if l.portions > 0 then
      charged := ceil(l.portions);
      mult := charged / nullif((bd #>> '{portions,n}')::numeric, 0);
    else
      mult := l.qty_g / nullif((bd #>> '{yield,qty}')::numeric, 0);
    end if;
    c := case when colore in ('VERDE', 'GIALLO') and mult is not null
              then (bd #>> '{semaforo,costo_stimato}')::numeric * mult end;
    if c is null then ok := false; end if;
    lines := lines || jsonb_build_object('recipe_id', l.recipe_id, 'title', bd ->> 'title',
      'portions', l.portions, 'portions_charged', charged, 'qty_g', l.qty_g,
      'semaforo', colore, 'recipe_status', bd ->> 'status', 'multiplier', mult, 'cost', c,
      'parte_stimata', case when c is not null then (bd #>> '{semaforo,parte_stimata}')::numeric * mult end,
      'non_stimabili', bd #> '{semaforo,non_stimabili}');
    sub := sub + coalesce(c, 0);
    stim := stim + coalesce(case when c is not null then (bd #>> '{semaforo,parte_stimata}')::numeric * mult end, 0);
  end loop;
  return jsonb_build_object('sheet_id', s.id, 'event_id', s.event_id, 'kind', s.kind,
    'priced_with', case when snap is null then 'prezzi correnti' else 'snapshot' end,
    'complete', ok, 'subtotal', sub, 'di_cui_stimato', stim, 'markup_pct', s.markup_pct,
    'markup', sub * s.markup_pct / 100, 'total', sub * (1 + s.markup_pct / 100), 'lines', lines);
end $$;

create or replace function food_cost.approve_sheet(p_sheet_id uuid, p_by text)
returns jsonb language plpgsql as $$
declare res jsonb;
begin
  if exists (select 1 from food_cost.event_cost_sheets where id = p_sheet_id and status = 'approved') then
    raise exception 'FC01: foglio % gia'' approvato', p_sheet_id;
  end if;
  insert into food_cost.event_price_snapshot
    (sheet_id, ingredient_id, candidate_id, vendor, price_class, basis_dim, cost_per_base,
     cost_per_each, last_invoice_date, invoice_number, cost_per_ml)
  with recursive tree(recipe_id, path) as (
    select l.recipe_id, array[l.recipe_id] from food_cost.event_cost_lines l where l.sheet_id = p_sheet_id
    union
    select rb.sub_recipe_id, t.path || rb.sub_recipe_id
    from tree t join public.recipe_bom rb on rb.parent_recipe_id = t.recipe_id
    where rb.component_type = 'RECIPE' and not rb.sub_recipe_id = any(t.path)
  )
  select distinct on (p.ingredient_id) p_sheet_id, p.ingredient_id, p.candidate_id, p.vendor,
         p.price_class, p.basis_dim, p.cost_per_base, p.cost_per_each, p.last_invoice_date, p.invoice_number,
         p.cost_per_ml
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
-- 8. Conversioni di partenza
-- ---------------------------------------------------------------------------
-- Uova: 55 g a uovo, PROPOSTA (richiesta di Max), finche' lo chef non conferma.
insert into food_cost.conversioni (ingredient_id, tipo, valore, stato, fonte, riferimento)
select id, 'peso_pezzo', 55, 'proposta', 'proposta FC05: 55 g per uovo',
       'uovo grande USA: circa 57 g con guscio, 50 g sgusciato (USDA)'
from public.ingredients where name = 'Eggs'
on conflict (ingredient_id, tipo) do nothing;
-- Panna: Max ha dichiarato 908 g per US qt (editor del formato, 29/09/2026).
insert into food_cost.conversioni (ingredient_id, tipo, valore, stato, fonte, riferimento, approvata_da, approvata_at)
select id, 'densita', 908 / 946.353, 'approvata', 'dichiarata da Max: 1 US qt = 908 g (29/09/2026)',
       'USDA FoodData Central, heavy whipping cream: 1 cup = 238 g, circa 1,006 g/ml (952 g per QT)',
       'Max', timestamptz '2026-09-29 18:00:00+00'
from public.ingredients where name = 'Heavy Cream'
on conflict (ingredient_id, tipo) do nothing;

-- ---------------------------------------------------------------------------
-- 9. Permessi
-- ---------------------------------------------------------------------------
alter table food_cost.conversioni   enable row level security;
alter table food_cost.alto_valore   enable row level security;
alter table food_cost.misure_cucina enable row level security;
alter table food_cost.soglie        enable row level security;
revoke all on all functions in schema food_cost from public;
grant execute on function food_cost.recipe_breakdown(uuid, uuid, uuid[]),
                          food_cost.price_for(uuid, uuid),
                          food_cost.density_for(uuid),
                          food_cost.conv_for(uuid, text),
                          food_cost.stima_riga(uuid, numeric),
                          food_cost.pack_parse(text),
                          food_cost.pack_unit(text),
                          food_cost.unit_info(text),
                          food_cost.count_unit_key(text),
                          food_cost.bom_hash(uuid),
                          food_cost.sheet_cost(uuid)
      to anon, authenticated, service_role;
grant execute on function food_cost.approve_sheet(uuid, text) to service_role;
grant execute on function food_cost.missing_price_report() to service_role;
grant all on all tables in schema food_cost to service_role;
grant select on food_cost.v_chef_alerts, food_cost.v_ingredient_price, food_cost.v_riferimento_categoria to service_role;
