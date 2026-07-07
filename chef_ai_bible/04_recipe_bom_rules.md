# Chef AI — Recipe BOM Rules

## Fonte di verita

recipe_bom e l'UNICA fonte di verita per gli ingredienti di una ricetta.
recipes.ingredients JSONB e legacy — se esistono righe in recipe_bom, il JSONB viene ignorato ovunque.
saveRecipeBOM() azzera sempre recipes.ingredients dopo ogni write.

## Struttura BOM

component_type = 'ITEM' → ingrediente base (item_id → ingredients.id, sub_recipe_id = NULL)
component_type = 'RECIPE' → sub-recipe (sub_recipe_id → recipes.id, item_id = NULL)
MAIUSCOLO obbligatorio — mai 'item' o 'recipe' in minuscolo.

## Regole Zenos specifiche

- Grated Pecorino → sempre RECIPE "Grated Pecorino" nel BOM, mai ITEM Pecorino Romano
- Diced Butter (quantita ≤20g) → RECIPE "Diced Butter". Quantita >20g → ITEM Butter
- Shredded Carrots come RECIPE → solo House Salad. Tutti gli altri usano ITEM carote raw
- Unita sopra 100g → usa kg. Sotto 100g → usa g
- Batch sempre interi arrotondati per eccesso — mai frazioni

## Audit BOM — check da fare

Per verificare se una ricetta e pronta per il bot:
1. Esiste almeno 1 riga in recipe_bom per questa ricetta?
2. pos_name presente se la ricetta e venduta al POS?
3. base_servings e base_weight_g presenti e coerenti?
4. serving_weight_g = base_weight_g / base_servings?
5. Sub-recipe collegate hanno base_weight_g (necessario per il bot)?
6. Unita BOM fisicamente sensate e convertibili?
7. Ingredienti duplicati o ambigui?

## Query audit BOM

-- BOM completo di una ricetta
SELECT rb.bom_id, rb.component_type, rb.quantity, rb.unit,
       i.name AS ingredient, i.measure_type,
       r2.title AS sub_recipe, r2.base_weight_g AS sub_bw
FROM recipe_bom rb
LEFT JOIN ingredients i ON i.id = rb.item_id
LEFT JOIN recipes r2 ON r2.id = rb.sub_recipe_id
WHERE rb.parent_recipe_id = '{recipe_id}'
ORDER BY rb.sort_order, rb.bom_id;

-- Ricette con pos_name ma BOM vuoto (problema critico per il bot)
SELECT r.id, r.title, r.pos_name, r.base_servings, r.base_weight_g
FROM recipes r
WHERE r.pos_name IS NOT NULL AND r.pos_name != ''
  AND NOT EXISTS (SELECT 1 FROM recipe_bom rb WHERE rb.parent_recipe_id = r.id)
ORDER BY r.title;

-- Ricette vendute al POS ma senza base_servings (bot non puo calcolare)
SELECT r.id, r.title, r.pos_name, r.base_servings
FROM recipes r
WHERE r.pos_name IS NOT NULL AND r.base_servings IS NULL
ORDER BY r.title;

## Convertire ITEM in RECIPE (richiede approvazione)

UPDATE recipe_bom
SET component_type = 'RECIPE',
    item_id = NULL,
    sub_recipe_id = '{recipe_uuid}'
WHERE bom_id = {bom_id};

## PostgREST cap

recipe_bom ha 1257+ righe — superano il cap 1000. Usa sempre filtri:
SELECT ... FROM recipe_bom WHERE parent_recipe_id = '{id}' ...
O split per gruppo di ricette POS vs prep.
