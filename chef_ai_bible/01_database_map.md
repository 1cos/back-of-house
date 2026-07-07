# Chef AI — Database Map
## Supabase project: ydqmumpytgrlceuinoqt
Tutti i timestamp sono UTC. Converti sempre in CDT (America/Chicago) per display.
PostgREST hard cap: 1000 righe per SELECT. Usa WHERE su tabelle grandi.

## Tabelle principali

### prep_tasks (task di prep cucina)
Campi chiave:
- id (bigint PK)
- name (text) — nome del prep
- category (text) — stazione: Salad Station, Pastry Station, Saute Station, Oven Station, Pasta Station, Plating Station, Saucier Station, Fresh Pasta Station, Table Side, Manager Station
- unit (text) — unita fisica: g, kg, pezzi, nests, cup, buste, pz
- current_stock (numeric) — stock attuale. NULL = bot salta questo task
- suggested_qty (numeric) — output del bot-preplist-builder. Non modificare manualmente.
- suggested_note (text) — formato: color|testo_it|testo_en|testo_es
- expected_duration_days (integer) — shelf life del PREP (fonte primaria per il bot)
- min_cover_days (integer) — soglia alert (NON orizzonte pianificazione)
- recipe_id (uuid) → FK recipes.id
- ingredient_id (uuid) → FK ingredients.id
- prep_type (text) — 'finale' (collegato POS), 'supporto' (prep intermedia), 'checklist' (operativo)
- archived (boolean) — se true non appare in app

Query stock attuale:
SELECT name, current_stock, unit, suggested_note FROM prep_tasks WHERE archived=false ORDER BY category, name;

Query per aggiornare stock (richiede approvazione Max):
UPDATE prep_tasks SET current_stock = {valore} WHERE id = {id};

### recipes (ricette)
Campi chiave:
- id (uuid PK)
- title (text UNIQUE)
- pos_name (text) — nome sul POS TouchBistro. Pipe-delimited per alias: 'Nome1|Nome2'. MAI modificare alias con storico POS, solo appendere.
- base_servings (integer) — porzioni base del batch
- base_weight_g (numeric) — peso totale batch in grammi
- serving_weight_g (numeric) — calcolato: base_weight_g / base_servings
- serving_qty (numeric) — unita fisiche per porzione (es. 2 nests)
- serving_unit (text) — es. nests, pezzi, g
- shelf_life_days (integer) — durata sicura ricetta (fonte secondaria — vedi prep_tasks.expected_duration_days)
- menu_group (text) — Pasta/Entrees/Appetizers/Salads/Sides/Sauces/Bases/Desserts/Soups/Finger Food/Catering/Condiments
- selling_price (numeric) — ADMIN ONLY
- food_cost_pct (numeric) — ADMIN ONLY

### recipe_bom (Bill of Materials — FONTE AUTORITATIVA ingredienti)
- bom_id (integer PK)
- parent_recipe_id (uuid) → FK recipes.id
- component_type (text) — 'ITEM' (ingrediente) o 'RECIPE' (sub-recipe). MAIUSCOLO.
- item_id (uuid) → FK ingredients.id (se ITEM)
- sub_recipe_id (uuid) → FK recipes.id (se RECIPE)
- quantity (numeric)
- unit (text)
- sort_order (integer)

REGOLA: recipe_bom e la fonte di verita. recipes.ingredients JSONB e legacy — ignoralo se esistono righe recipe_bom.
MAI modificare recipe_bom senza approvazione Max.

Query BOM di una ricetta:
SELECT rb.bom_id, rb.component_type, rb.quantity, rb.unit, i.name AS ingredient, r2.title AS sub_recipe
FROM recipe_bom rb
LEFT JOIN ingredients i ON i.id = rb.item_id
LEFT JOIN recipes r2 ON r2.id = rb.sub_recipe_id
WHERE rb.parent_recipe_id = '{recipe_id}'
ORDER BY rb.sort_order, rb.bom_id;

### ingredients (ingredienti)
- id (uuid PK)
- name (text) — nome canonico EN
- category (text) — Produce/Dairy/Meat/Seafood/Dry Goods/Oil & Vinegar/Spices & Herbs/Beverages & Spirits/Prepared/Bakery/Frozen/Supply
- base_unit (text) — default 'g'
- measure_type (text) — 'weight', 'volume', 'each'
- avg_unit_weight_g (numeric) — peso medio per pezzo (per measure_type='each')
- yield_factor (numeric) — fattore resa (0-1]

### ingredient_vendors (fornitori e prezzi)
- ingredient_id (uuid) → FK ingredients.id
- vendor (text)
- unit_price (numeric)
- price_type (text) — per_case/per_lb/per_kg/per_oz/per_each
- price_per_100g (numeric)
- conversion_to_base (numeric) — grammi totali per unita acquisto
- last_invoice_date (date)

### pos_sales_by_item (vendite POS TouchBistro)
- sale_date (date)
- menu_item (text) — deve combaciare con recipes.title per match automatico
- menu_group (text)
- sales_category (text)
- quantity (numeric) — porzioni vendute
- net_sales (numeric) — ADMIN ONLY

NOTA: dati arrivano via email notturna. Nessuna vista "oggi" in tempo reale.

Query vendite ultimi 7 giorni:
SELECT menu_item, SUM(quantity) as tot FROM pos_sales_by_item
WHERE sale_date >= CURRENT_DATE - 7 AND menu_group NOT IN ('Beverages','Bar')
GROUP BY menu_item ORDER BY tot DESC LIMIT 20;

### office_items (L'Ufficio — decisioni e alert)
- source (text) — tell_chef/operation_note/ai_scan/sous_chef_chat
- priority (text) — red/orange/blue
- title, body (text)
- reasoning_result (jsonb) — output strutturato Jarvis
- jarvis_status (text) — pending/reasoning/ready/executed/rejected
- status (text) — open/resolved/snoozed

### chef_reports (Tell Chef — messaggi brigata)
- user_name, station, message (text)
- status (text) — new/read/in_progress/done/ignored
- report_type (text) — classificazione bot

### closed_dates (giorni chiusura straordinaria)
- date (date PK) — giorni chiusi oltre alla domenica (sempre chiusa)

## Tabelle di backup/legacy — NON usare
- recipes_backup_20250524
- vendor_documents_backup_20260612
- prep_items, prep_check, checks
