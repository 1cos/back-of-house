-- ============================================================================
-- ROLLBACK FC05 — riporta il food cost esattamente allo stato FC03/FC04 in
-- produzione (definizioni lette da produzione il 29/09/2026, dopo FC04-R).
-- Da eseguire SOLO se il rilascio FC05 va annullato, in una transazione:
--   begin; \i questo file; commit;
-- Cosa si perde: le conversioni confermate dallo chef dopo FC05 (tabella
-- food_cost.conversioni) e le soglie modificate. Ricette, fatture e prezzi
-- non sono mai stati toccati da FC05 e restano come sono.
-- ============================================================================

-- 1. la funzione nuova della schermata
drop function if exists public.fc_conferma_conversione(text, uuid, text, numeric);

-- 2. elenco ricette: torna alle colonne di prima (FC05 ne aveva aggiunte in coda)
drop view if exists public.recipes_with_cost;
create view public.recipes_with_cost as
 SELECT r.id,
    r.title,
    r.category,
    r.yield_text,
    r.prep_time_minutes,
    r.ingredients,
    r.procedure,
    r.equipment,
    r.created_at,
    r.image_url,
    r.base_weight,
    r.weight_unit,
    r.base_servings,
    x.total_cost,
        CASE
            WHEN (r.base_weight > (0)::numeric) THEN (x.total_cost / r.base_weight)
            ELSE NULL::numeric
        END AS cost_per_kg,
    x.status AS cost_status,
    x.known_cost,
    x.cost_per_portion,
    x.issue_count,
    x.chef_validated
   FROM (recipes r
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN ((bd.bd ->> 'complete'::text))::boolean THEN ((bd.bd #>> '{totals,known}'::text[]))::numeric
                    ELSE NULL::numeric
                END AS total_cost,
            (bd.bd ->> 'status'::text) AS status,
            ((bd.bd #>> '{totals,known}'::text[]))::numeric AS known_cost,
            ((bd.bd ->> 'cost_per_portion'::text))::numeric AS cost_per_portion,
            jsonb_array_length((bd.bd -> 'issues'::text)) AS issue_count,
            COALESCE(((bd.bd #>> '{chef_validation,validated}'::text[]))::boolean, false) AS chef_validated
           FROM food_cost.recipe_breakdown(r.id) bd(bd)) x);
grant all on public.recipes_with_cost to anon, authenticated, service_role;

-- 3. viste del motore (FC05 le aveva ricreate con le colonne per pezzo/ml)
drop view if exists food_cost.v_chef_alerts;
drop view if exists food_cost.v_ingredient_price;
drop view if exists food_cost.v_riferimento_categoria;
drop view if exists food_cost.v_price_candidates;

create view food_cost.v_price_candidates as
 WITH base AS (
         SELECT iv.id AS candidate_id,
            iv.ingredient_id,
            iv.vendor,
            iv.last_invoice_date,
            iv.updated_at,
            iv.pack_description,
            iv.unit_price,
            iv.conversion_to_base,
            iv.price_per_100g,
            iv.price_per_each,
            iv.price_type,
                CASE
                    WHEN ((COALESCE(i.measure_type, ''::text) = 'volume'::text) OR (lower(COALESCE(i.base_unit, ''::text)) = 'ml'::text)) THEN 'volume'::text
                    ELSE 'mass'::text
                END AS basis_dim,
                CASE
                    WHEN (iv.vendor ~~* 'STIMA CHEF%'::text) THEN 'B'::text
                    WHEN (iv.last_invoice_date IS NOT NULL) THEN 'A'::text
                    ELSE 'C'::text
                END AS price_class,
                CASE
                    WHEN (iv.price_per_100g > (0)::numeric) THEN (iv.price_per_100g / (100)::numeric)
                    WHEN ((iv.price_type = 'per_lb'::text) AND (iv.unit_price > (0)::numeric)) THEN (iv.unit_price / 453.592)
                    WHEN ((iv.conversion_to_base > (0)::numeric) AND (iv.unit_price > (0)::numeric)) THEN (iv.unit_price / iv.conversion_to_base)
                    ELSE NULL::numeric
                END AS cost_per_base,
                CASE
                    WHEN (iv.price_per_each > (0)::numeric) THEN iv.price_per_each
                    ELSE NULL::numeric
                END AS cost_per_each
           FROM (ingredient_vendors iv
             JOIN ingredients i ON ((i.id = iv.ingredient_id)))
          WHERE iv.active
        )
 SELECT b.candidate_id,
    b.ingredient_id,
    b.vendor,
    b.last_invoice_date,
    b.updated_at,
    b.pack_description,
    b.unit_price,
    b.conversion_to_base,
    b.price_per_100g,
    b.price_per_each,
    b.price_type,
    b.basis_dim,
    b.price_class,
    b.cost_per_base,
    b.cost_per_each,
    line.invoice_number,
    line.line_cost_per_100g,
    array_remove(ARRAY[
        CASE
            WHEN ((b.price_per_100g > (0)::numeric) AND (b.conversion_to_base > (0)::numeric) AND (b.unit_price > (0)::numeric) AND ((abs((b.price_per_100g - ((b.unit_price / b.conversion_to_base) * (100)::numeric))) / b.price_per_100g) > 0.02)) THEN format('prezzo/100 %s vs pack %s'::text, round(b.price_per_100g, 4), round(((b.unit_price / b.conversion_to_base) * (100)::numeric), 4))
            ELSE NULL::text
        END,
        CASE
            WHEN ((b.price_class = 'A'::text) AND (b.price_per_100g > (0)::numeric) AND (line.line_cost_per_100g > (0)::numeric) AND ((abs((b.price_per_100g - line.line_cost_per_100g)) / line.line_cost_per_100g) > 0.02)) THEN format('prezzo/100 %s vs fattura %s'::text, round(b.price_per_100g, 4), line.line_cost_per_100g)
            ELSE NULL::text
        END], NULL::text) AS conflicts
   FROM (base b
     LEFT JOIN LATERAL ( SELECT l.invoice_number,
            l.cost_per_100g AS line_cost_per_100g
           FROM invoice_lines l
          WHERE ((l.ingredient_id = b.ingredient_id) AND (l.vendor = b.vendor) AND (l.invoice_date = b.last_invoice_date) AND (COALESCE(l.price_anomaly, false) = false))
          ORDER BY (l.cost_per_100g IS NULL), l.created_at DESC NULLS LAST
         LIMIT 1) line ON (true))
  WHERE ((b.cost_per_base IS NOT NULL) OR (b.cost_per_each IS NOT NULL));

create view food_cost.v_ingredient_price as
 WITH ranked AS (
         SELECT c.candidate_id,
            c.ingredient_id,
            c.vendor,
            c.last_invoice_date,
            c.updated_at,
            c.pack_description,
            c.unit_price,
            c.conversion_to_base,
            c.price_per_100g,
            c.price_per_each,
            c.price_type,
            c.basis_dim,
            c.price_class,
            c.cost_per_base,
            c.cost_per_each,
            c.invoice_number,
            c.line_cost_per_100g,
            c.conflicts,
            row_number() OVER (PARTITION BY c.ingredient_id ORDER BY
                CASE c.price_class
                    WHEN 'A'::text THEN 1
                    WHEN 'B'::text THEN 2
                    ELSE 3
                END, c.last_invoice_date DESC NULLS LAST, c.updated_at DESC NULLS LAST) AS rn
           FROM food_cost.v_price_candidates c
        )
 SELECT candidate_id,
    ingredient_id,
    vendor,
    price_class,
    basis_dim,
    cost_per_base,
    cost_per_each,
    last_invoice_date,
    invoice_number,
    pack_description,
    conflicts,
    array_remove(ARRAY[
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM ranked o
              WHERE ((o.ingredient_id = r.ingredient_id) AND (o.rn > 1) AND (o.price_class = 'A'::text) AND (o.last_invoice_date = r.last_invoice_date) AND ((abs((o.cost_per_base - r.cost_per_base)) / NULLIF(r.cost_per_base, (0)::numeric)) > 0.02)))) THEN 'due fornitori, stessa data, prezzi diversi'::text
            ELSE NULL::text
        END], NULL::text) AS tie_conflicts,
    array_remove(ARRAY[
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM invoice_lines l
              WHERE ((l.ingredient_id = r.ingredient_id) AND (l.match_status = 'matched'::text) AND (l.invoice_date > COALESCE(r.last_invoice_date, '1900-01-01'::date))))) THEN ( SELECT format('fattura piu'' recente non applicata al prezzo: %s %s'::text, l.vendor, l.invoice_date) AS format
               FROM invoice_lines l
              WHERE ((l.ingredient_id = r.ingredient_id) AND (l.match_status = 'matched'::text) AND (l.invoice_date > COALESCE(r.last_invoice_date, '1900-01-01'::date)))
              ORDER BY l.invoice_date DESC
             LIMIT 1)
            ELSE NULL::text
        END], NULL::text) AS warnings
   FROM ranked r
  WHERE (rn = 1);

create view food_cost.v_chef_alerts as
 WITH uso AS (
         SELECT b.item_id AS ingredient_id,
            b.unit,
            r.id AS recipe_id,
            r.title,
            (food_cost.unit_info(b.unit)).dim AS dim
           FROM (recipe_bom b
             JOIN recipes r ON ((r.id = b.parent_recipe_id)))
          WHERE ((b.component_type = 'ITEM'::text) AND (NOT (EXISTS ( SELECT 1
                   FROM food_cost.ingredient_policy x
                  WHERE (x.ingredient_id = b.item_id)))))
        ), problemi AS (
         SELECT u.ingredient_id,
            u.recipe_id,
            u.title,
                CASE
                    WHEN (p.ingredient_id IS NULL) THEN 'prezzo_mancante'::text
                    WHEN ((cardinality(p.conflicts) + cardinality(p.tie_conflicts)) > 0) THEN 'prezzo_in_conflitto'::text
                    WHEN (u.dim IS NULL) THEN 'unita_non_convertibile'::text
                    WHEN ((u.dim = 'count'::text) AND (p.cost_per_each IS NULL) AND (NOT (EXISTS ( SELECT 1
                       FROM unit_each_weights w
                      WHERE (w.ingredient_id = u.ingredient_id))))) THEN 'manca_peso_al_pezzo'::text
                    WHEN ((u.dim = ANY (ARRAY['mass'::text, 'volume'::text])) AND (p.cost_per_base IS NULL) AND (NOT (EXISTS ( SELECT 1
                       FROM unit_each_weights w
                      WHERE (w.ingredient_id = u.ingredient_id))))) THEN 'manca_peso_al_pezzo'::text
                    WHEN ((u.dim = ANY (ARRAY['mass'::text, 'volume'::text])) AND (p.cost_per_base IS NOT NULL) AND (u.dim <> p.basis_dim) AND (( SELECT density_for.g_per_ml
                       FROM food_cost.density_for(u.ingredient_id) density_for(g_per_ml, source)) IS NULL)) THEN 'manca_densita'::text
                    ELSE NULL::text
                END AS codice,
            u.unit
           FROM (uso u
             LEFT JOIN food_cost.v_ingredient_price p ON ((p.ingredient_id = u.ingredient_id)))
        )
 SELECT i.id AS ingredient_id,
    i.name AS ingrediente,
    pr.codice,
        CASE pr.codice
            WHEN 'prezzo_mancante'::text THEN format('Manca il prezzo di %s.'::text, i.name)
            WHEN 'prezzo_in_conflitto'::text THEN format('Il prezzo di %s non torna con la fattura: va controllato.'::text, i.name)
            WHEN 'unita_non_convertibile'::text THEN format('%s e'' scritto in un''unita'' non convertibile (%s).'::text, i.name, string_agg(DISTINCT pr.unit, ', '::text))
            WHEN 'manca_peso_al_pezzo'::text THEN format('%s: serve il peso di un pezzo.'::text, i.name)
            WHEN 'manca_densita'::text THEN format('%s: serve la conversione fra litri e chili.'::text, i.name)
            ELSE NULL::text
        END AS messaggio,
    count(DISTINCT pr.recipe_id) AS ricette_bloccate,
    string_agg(DISTINCT pr.title, ', '::text) AS ricette
   FROM (problemi pr
     JOIN ingredients i ON ((i.id = pr.ingredient_id)))
  WHERE (pr.codice IS NOT NULL)
  GROUP BY i.id, i.name, pr.codice
  ORDER BY (count(DISTINCT pr.recipe_id)) DESC, i.name;

grant all
  on food_cost.v_price_candidates, food_cost.v_ingredient_price, food_cost.v_chef_alerts to service_role;
revoke all on food_cost.v_price_candidates, food_cost.v_ingredient_price, food_cost.v_chef_alerts from anon, authenticated;

-- 4. funzioni del motore: definizioni di produzione prima di FC05
drop function if exists food_cost.price_for(uuid, uuid);

CREATE OR REPLACE FUNCTION food_cost.price_for(p_ingredient_id uuid, p_sheet_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(candidate_id uuid, vendor text, price_class text, basis_dim text, cost_per_base numeric, cost_per_each numeric, last_invoice_date date, invoice_number text, pack_description text, conflicts text[], warnings text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION food_cost.recipe_breakdown(p_recipe_id uuid, p_sheet_id uuid DEFAULT NULL::uuid, p_path uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION food_cost.missing_price_report()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with a as (select * from food_cost.v_chef_alerts),
  ev as (
    select a.*,
      -- ultima riga di fattura collegata all'ingrediente, qualunque sia
      (select jsonb_build_object('vendor', l.vendor, 'date', l.invoice_date, 'number', l.invoice_number,
                                 'description', l.raw_description, 'pack', l.pack_description,
                                 'unit_price', l.unit_price, 'cost_per_100g', l.cost_per_100g)
         from public.invoice_lines l
        where l.ingredient_id = a.ingredient_id and coalesce(l.price_anomaly, false) = false
        order by l.invoice_date desc, l.created_at desc limit 1) as ultima_fattura,
      -- ultima riga con un prezzo al peso
      (select jsonb_build_object('vendor', l.vendor, 'date', l.invoice_date, 'number', l.invoice_number,
                                 'description', l.raw_description, 'pack', l.pack_description,
                                 'cost_per_100g', l.cost_per_100g)
         from public.invoice_lines l
        where l.ingredient_id = a.ingredient_id and l.cost_per_100g > 0 and coalesce(l.price_anomaly, false) = false
        order by l.invoice_date desc, l.created_at desc limit 1) as ultimo_prezzo_al_peso,
      (select count(*) from public.invoice_lines l where l.ingredient_id = a.ingredient_id) as righe_fattura,
      -- documenti non ancora importati che contengono un prodotto gia' collegato a questo ingrediente
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
      'righe_fattura', righe_fattura, 'ultima_fattura', ultima_fattura,
      'ultimo_prezzo_al_peso', ultimo_prezzo_al_peso, 'documenti_in_attesa', documenti_in_attesa,
      'diagnosi', case
        -- prima il TIPO di problema: per peso al pezzo, litri/chili e unita' della
        -- ricetta la fattura non c'entra (il sale ha una stima chef ma nessuna fattura)
        when codice = 'prezzo_in_conflitto' then 'conflitto'
        when codice = 'manca_peso_al_pezzo' then 'peso_al_pezzo'
        when codice = 'manca_densita' then 'litri_chili'
        when codice = 'unita_non_convertibile' then 'unita_ricetta'
        -- poi, per il prezzo mancante, cosa dicono le fatture
        when righe_fattura = 0 and jsonb_array_length(documenti_in_attesa) = 0 then 'mai_fatturato'
        when righe_fattura = 0 then 'solo_in_attesa'
        when ultimo_prezzo_al_peso is not null then 'formato_nuovo_senza_peso'
        else 'formato_senza_peso'
      end)
    order by ricette_bloccate desc, ingrediente), '[]'::jsonb)
  from ev
$function$;

CREATE OR REPLACE FUNCTION food_cost.sheet_cost(p_sheet_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION food_cost.approve_sheet(p_sheet_id uuid, p_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
end $function$;

revoke all on function food_cost.price_for(uuid, uuid), food_cost.recipe_breakdown(uuid, uuid, uuid[]),
  food_cost.missing_price_report(), food_cost.sheet_cost(uuid), food_cost.approve_sheet(uuid, text) from public;
grant execute on function food_cost.price_for(uuid, uuid), food_cost.recipe_breakdown(uuid, uuid, uuid[]),
  food_cost.sheet_cost(uuid) to anon, authenticated, service_role;
grant execute on function food_cost.approve_sheet(uuid, text), food_cost.missing_price_report() to service_role;

-- 5. oggetti nuovi di FC05
drop function if exists food_cost.stima_riga(uuid, numeric);
drop function if exists food_cost.conv_for(uuid, text);
drop function if exists food_cost.pack_parse(text);
drop function if exists food_cost.pack_unit(text);
drop table if exists food_cost.conversioni;
drop table if exists food_cost.alto_valore;
drop table if exists food_cost.misure_cucina;
drop table if exists food_cost.soglie;

-- 6. colonna aggiunta agli snapshot: si toglie solo se nessun consuntivo l'ha usata
do $$ begin
  if not exists (select 1 from food_cost.event_price_snapshot where cost_per_ml is not null) then
    alter table food_cost.event_price_snapshot drop column if exists cost_per_ml;
  else
    raise notice 'event_price_snapshot.cost_per_ml contiene dati di consuntivi approvati: lasciata';
  end if;
end $$;

delete from supabase_migrations.schema_migrations where version = '20261001000001';
