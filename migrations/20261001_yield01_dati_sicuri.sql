-- YIELD01 step 2 — dati: solo casi inequivocabili + risposte di Chef del 01/10/2026.
-- APPLICATA in produzione il 2026-10-01 (migrazione yield01_migrazione_dati_sicuri). Log: food_cost.yield_migration_log (14 righe).
-- Backup prima: ~/Brigade_backups/yield01/recipes_before.json
--   M1  (8):  testo esattamente "N porzione/i" -> base_servings, solo se vuoto e FC05 non dava un numero diverso
--             Salmon Cakes 13, SALMORIGLIO 5, FETTUCCINE FRESH PASTA 25, Asparagus 1, House Salad 1,
--             Mediterranean Salad 1, Scallops Chefs Way 1, Wagyu Ribeye 1
--   M2  (3):  base_weight kg -> base_weight_g dove vuoto: BOLOGNESE SAUCE 6000, BESCIAMELLA 15000, MK-CONCIA 2100
--   Chef (2): Fried calamari = 1 porzione da 165 g (base_servings 1, base_weight_g 1800 -> 165);
--             BUTTER SPINACH = 15 porzioni (base_servings 15)

create table if not exists food_cost.yield_migration_log (
  id bigserial primary key, recipe_id uuid not null, title text, field text not null,
  old_value text, new_value text, rule text not null, applied_at timestamptz not null default now());

do $$
declare n1 int; n2 int; n3 int;
begin
  create temp table m1 on commit drop as
  select r.id, r.title, substring(btrim(r.yield_text) from '^(\d+)\s*porzion[ei]$')::int as n
  from public.recipes r
  where r.base_servings is null and coalesce(r.category,'') not ilike '%archiv%'
    and btrim(regexp_replace(r.yield_text, '\s+', ' ', 'g')) ~* '^\d+\s*porzion[ei]$'
    and ((food_cost.recipe_breakdown(r.id, null, null)->'portions'->>'n') is null
         or abs((food_cost.recipe_breakdown(r.id, null, null)->'portions'->>'n')::numeric
                - substring(btrim(r.yield_text) from '^(\d+)\s*porzion[ei]$')::int) < 0.5);
  select count(*) into n1 from m1;
  if n1 <> 8 then raise exception 'M1 expected 8 recipes, found %', n1; end if;
  insert into food_cost.yield_migration_log (recipe_id, title, field, old_value, new_value, rule)
    select id, title, 'base_servings', null, n::text, 'M1 yield_text "N porzioni"' from m1;
  update public.recipes r set base_servings = m1.n from m1 where r.id = m1.id;

  create temp table m2 on commit drop as
  select r.id, r.title, r.base_weight * case lower(r.weight_unit) when 'kg' then 1000 else 1 end as g
  from public.recipes r
  where r.base_weight_g is null and r.base_weight > 0 and lower(coalesce(r.weight_unit,'')) in ('kg','g')
    and coalesce(r.category,'') not ilike '%archiv%';
  select count(*) into n2 from m2;
  if n2 <> 3 then raise exception 'M2 expected 3 recipes, found %', n2; end if;
  insert into food_cost.yield_migration_log (recipe_id, title, field, old_value, new_value, rule)
    select id, title, 'base_weight_g', null, g::text, 'M2 base_weight kg/g -> grams' from m2;
  update public.recipes r set base_weight_g = m2.g from m2 where r.id = m2.id;

  select count(*) into n3 from public.recipes
   where id in ('14ccae9f-00b8-4f50-8b43-2cb8010d8ead','9cec677b-55d6-4329-9dae-5dd4d489e147');
  if n3 <> 2 then raise exception 'Chef cases expected 2 recipes, found %', n3; end if;
  insert into food_cost.yield_migration_log (recipe_id, title, field, old_value, new_value, rule)
    select id, title, 'base_servings', base_servings::text,
           case when id = '14ccae9f-00b8-4f50-8b43-2cb8010d8ead' then '1' else '15' end, 'Chef 01/10/2026'
      from public.recipes where id in ('14ccae9f-00b8-4f50-8b43-2cb8010d8ead','9cec677b-55d6-4329-9dae-5dd4d489e147')
    union all
    select id, title, 'base_weight_g', base_weight_g::text, '165', 'Chef 01/10/2026: 1 portion of 165 g'
      from public.recipes where id = '14ccae9f-00b8-4f50-8b43-2cb8010d8ead';
  update public.recipes set base_servings = 1, base_weight_g = 165 where id = '14ccae9f-00b8-4f50-8b43-2cb8010d8ead';
  update public.recipes set base_servings = 15 where id = '9cec677b-55d6-4329-9dae-5dd4d489e147';
end $$;

-- UNDO (riporta i valori del log):
--   update public.recipes r set base_servings = nullif(l.old_value,'')::numeric::int
--     from food_cost.yield_migration_log l where l.recipe_id = r.id and l.field = 'base_servings';
--   update public.recipes r set base_weight_g = nullif(l.old_value,'')::numeric
--     from food_cost.yield_migration_log l where l.recipe_id = r.id and l.field = 'base_weight_g';
