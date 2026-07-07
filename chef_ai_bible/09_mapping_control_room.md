# Chef AI — Mapping Control Room (MCR)

## Cos'e il MCR

Modulo admin che analizza la qualita dei dati recipe_bom e prep_tasks.
File: js/mapping-control-room.js
Detection engine (lines 1-959) non si modifica mai.
MAPPING_WRITE_ENABLED = false (nessuna scrittura automatica — solo write plan proposto).

## Tipi di issue rilevati

### prep_no_trusted_mapping
Prep task senza recipe_id e senza ingredient_id.
Il bot non sa cosa scaricare dal POS.
Fix: collegare recipe_id o ingredient_id al prep task.

### alias_ingredient_recipe_collision
Un ingrediente nel BOM ha lo stesso nome di una ricetta.
Dovrebbe essere component_type='RECIPE' non 'ITEM'.
Fix: UPDATE recipe_bom SET component_type='RECIPE', item_id=NULL, sub_recipe_id={uuid} WHERE bom_id={id}

### subrecipe_missing_yield
Una sub-recipe nel BOM non ha base_weight_g.
Il bot non puo calcolare il consumo in grammi.
Fix: aggiungere base_weight_g alla ricetta collegata.

### stock_unit_mismatch
L'unita del prep_task e diversa dall'unita del BOM o dalla serving_unit della ricetta.
Il bot calcola in grammi ma il cuoco conta in pezzi (o viceversa).
Fix: allineare unit del prep_task con serving_unit della ricetta.

### shelf_life_mismatch
expected_duration_days mancante sul prep_task.
Il bot usa shelf_life_days della ricetta come fallback o default 3gg.
Fix: impostare expected_duration_days sul prep_task con il valore reale.

### bom_empty
Ricetta con pos_name ma senza righe in recipe_bom.
Il bot non sa quali ingredienti scarica.
Fix: aggiungere il BOM tramite recipe editor.

### missing_pos_name
Ricetta collegata a prep_task con prep_type='finale' ma senza pos_name.
Il bot non trova vendite POS per calcolare il consumo.
Fix: aggiungere pos_name corrispondente al menu TouchBistro.

### missing_base_servings
Ricetta con pos_name e BOM ma senza base_servings.
Il bot non puo calcolare il consumo per porzione.
Fix: aggiungere base_servings (e base_weight_g se possibile).

## Query MCR principale

-- Prep senza collegamento (bot non puo calcolare)
SELECT pt.id, pt.name, pt.category, pt.prep_type,
       pt.recipe_id, pt.ingredient_id,
       r.pos_name, r.base_servings, r.base_weight_g
FROM prep_tasks pt
LEFT JOIN recipes r ON r.id = pt.recipe_id
WHERE pt.archived = false
  AND pt.prep_type IN ('finale', 'supporto')
  AND pt.recipe_id IS NULL
  AND pt.ingredient_id IS NULL
ORDER BY pt.category, pt.name;

-- Sub-recipe senza base_weight_g
SELECT DISTINCT r2.id, r2.title, r2.base_weight_g
FROM recipe_bom rb
JOIN recipes r2 ON r2.id = rb.sub_recipe_id
WHERE rb.component_type = 'RECIPE'
  AND (r2.base_weight_g IS NULL OR r2.base_weight_g = 0);

## Regola PostgREST per recipe_bom

recipe_bom ha 1257+ righe. Split sempre in due query:
Query 1: WHERE parent_recipe_id IN ({lista_id_ricette_POS}) LIMIT 1000
Query 2: WHERE parent_recipe_id IN ({lista_id_ricette_prep}) LIMIT 1000
Unisci i risultati in memoria.
