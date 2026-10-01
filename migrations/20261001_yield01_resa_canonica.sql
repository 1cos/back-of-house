-- YIELD01 — resa canonica. APPLICATA in produzione il 2026-10-01 (migrazioni yield01_resa_canonica e yield01_migrazione_dati_sicuri).
-- Backup: ~/Brigade_backups/yield01/recipes_before.json. Log: food_cost.yield_migration_log.

-- YIELD01 step 1 — DRAFT, NOT APPLIED. Additive only: no existing behaviour changes.
-- One function for "how many portions does a recipe make", identical to the yield/portions block of FC05
-- (food_cost.recipe_breakdown): yield = base_weight_g, else base_weight × unit (mass/volume);
-- portions = base_servings, else yield ÷ serving_weight_g, else yield ÷ serving_qty (g).
-- yield_text is descriptive only: used to flag a conflict (> 5 %), never as a number.

create or replace function food_cost.recipe_yield(r public.recipes)
returns jsonb
language plpgsql stable
set search_path = public, food_cost
as $$
declare
  y_qty numeric; y_dim text; y_src text; u record;
  n_port numeric; n_src text; n_text numeric; n_conflict text;
begin
  if r.base_weight_g > 0 then
    y_qty := r.base_weight_g; y_dim := 'mass'; y_src := 'base_weight_g';
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

  return jsonb_build_object(
    'portions', n_port, 'portions_source', n_src,
    'yield_qty', y_qty, 'yield_dim', y_dim, 'yield_source', y_src,
    'text_portions', n_text, 'conflict', n_conflict,
    'has_yield', coalesce(n_port > 0 or y_qty > 0, false));
end $$;

create or replace view public.recipe_yield
with (security_invoker = true) as
select r.id, r.title,
       (y ->> 'portions')::numeric      as portions,
       y ->> 'portions_source'          as portions_source,
       (y ->> 'yield_qty')::numeric     as yield_qty,
       y ->> 'yield_dim'                as yield_dim,
       y ->> 'yield_source'             as yield_source,
       (y ->> 'text_portions')::numeric as text_portions,
       y ->> 'conflict'                 as conflict,
       (y ->> 'has_yield')::boolean     as has_yield
from public.recipes r
cross join lateral (select food_cost.recipe_yield(r) as y) x;

comment on view public.recipe_yield is 'YIELD01: canonical yield and portions per recipe (same logic as FC05). Single source for bots and apps.';
grant select on public.recipe_yield to anon, authenticated, service_role;

