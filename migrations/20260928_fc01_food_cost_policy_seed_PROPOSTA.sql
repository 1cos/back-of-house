-- ============================================================================
-- FC01 — Semi per food_cost.ingredient_policy (PROPOSTA, da rivedere con Max)
-- ============================================================================
-- Non applicare insieme alla migrazione del motore: ogni riga va confermata.
-- Il motore esclude dal food cost SOLO cio' che e' elencato qui; tutto il
-- resto senza prezzo resta "prezzo mancante", visibile.
-- ============================================================================


insert into food_cost.ingredient_policy (ingredient_id, policy, reason, confirmed_by)
select i.id, v.policy, v.reason, 'PROPOSTA FC01 — da confermare'
from (values
  -- Non alimentari chiari: attrezzatura o contenitori finiti dentro una distinta
  ('Alluminium Cups', 'non_food', 'contenitore monouso (Mint Bavarese, Butter Spinach)'),
  ('Butane Can',      'non_food', 'gas per fornelletto (Wheel Pasta)'),
  ('Lid',             'non_food', 'coperchio (Lasagna)'),
  ('Pan',             'non_food', 'teglia (Lasagna)'),
  ('Shot Glass',      'non_food', 'bicchierino (Caprese Shot)'),
  ('Skewers',         'non_food', 'spiedini di legno (Meatball skewer)'),
  ('Vacuum Bag',      'non_food', 'busta sottovuoto (Tuscan Lamb Chops)'),
  -- Costo zero dichiarato
  ('Water',           'zero_cost', 'acqua di rubinetto: costo zero dichiarato, non un prezzo mancante')
) as v(name, policy, reason)
join public.ingredients i on i.name = v.name
on conflict (ingredient_id) do nothing;

-- DA DECIDERE (non inseriti): Co2 (cartuccia sifone: consumo o food cost?),
-- Pk85 (Panna Cotta, 10 g: additivo o materiale?), Bosina (Tagliere formaggi,
-- 30 g: cos'e'?). Cooking Spray, Dressing, Marinade, Sable e Salt Water sono
-- in categoria "Supply" ma sono alimenti: restano nel food cost.

