# Chef AI — Prep Bot Logic (bot-preplist-builder v42)

## Quando gira
Cron: 0 9 * * * UTC = 4AM CDT ogni notte.
Scrive: suggested_qty, suggested_note su prep_tasks.
NON scrive mai su current_stock.

## Logica shelf life (priorita in ordine)

1. prep_tasks.expected_duration_days (fonte primaria — durata della PREP)
2. recipes.shelf_life_days (durata sicura della ricetta — fallback)
3. prep_tasks.prep_frequency_days (frequenza prep — terzo fallback)
4. Default 3 giorni hardcoded

REGOLA CHIAVE: la shelf_life appartiene al PREP, non alla ricetta finale.
Ricette finali (Chicken Parmesan, Mini Caesar, ecc.) hanno shelf_life_days = NULL.
Prep intermedie (Chop Romaine, Pollo impanato, ecc.) hanno expected_duration_days sul prep_task.

## min_cover_days

E una soglia di alert, NON un orizzonte di pianificazione.
- Stock copre < min_cover_days giorni → pill rossa o gialla
- Stock copre >= min_cover_days giorni → pill verde
Default: 2 giorni. Pasta fresca: 1 giorno.

## Pill format

suggested_note = color|testo_it|testo_en|testo_es
- color: green|yellow|red
- Indice lingua: 1=IT, 2=EN, 3=ES

Esempi:
- green: "green|Hai 14kg in casa - arrivi a Venerdi|You have 14kg - good through Friday|Tienes 14kg - llegas al Viernes"
- yellow: "yellow|Stock basso - prepara domani|Low stock - prep tomorrow|Stock bajo - prepara manana"
- red: "red|Prepara oggi - 3 batch|Prep today - 3 batches|Prepara hoy - 3 tandas"

## Percorsi calcolo consumo (in ordine di priorita)

### Percorso 1: direct_pos
Prep ha recipe_id con pos_name → bot legge vendite POS per quel pos_name.
Consumo = sum(vendite DOW media) * serving_weight_g per porzione.

### Percorso 2: sub_recipe
Prep e una sub-recipe usata da altre ricette nel BOM.
Bot cerca tutte le ricette che hanno questa prep come RECIPE nel BOM.
Consumo = sum(vendite padre * qty BOM).

### Percorso 3: ingredient_id
Prep ha ingredient_id ma nessun recipe_id.
Bot somma il consumo da tutte le ricette nel BOM che usano quell'ingrediente come ITEM.

### Percorso none
Nessun collegamento trovato → bot salta il task, crea office_item con issue_type='null_stock' o 'missing_pos_name'.

## Calendar awareness

- Domenica = sempre chiusa (hardcoded)
- closed_dates = giorni chiusura straordinaria
- openStatus: NORMAL_SERVICE_PREP / CLOSED_DAY_REVIEW / REOPENING_PREP
- In REOPENING_PREP: mai pill rossa aggressiva, sempre yellow con "controlla stock Lunedi"

## Sanity cap

Se suggested_qty > average_qty * 3 → forza yellow con "Quantity looks high - verify before producing"

## Unita fisiche

- unit='pezzi' o 'pz' o 'buste' → conta fisica, bot usa quella unita
- unit='nests' → pasta fresca, arrotonda a batch interi
- unit='cup' → spinaci (1 cup = 80g dalla ricetta Butter Spinach)
- unit='g' → tutto il resto, arrotonda a batch da base_weight_g

## Percorso bot per verificare un prep

Per sapere se Brussels Sprouts Ready to Sell e scaricata correttamente dal POS:
1. SELECT recipe_id, prep_type, pos_name (dalla ricetta) FROM prep_tasks WHERE name ILIKE '%brussels%' AND archived=false
2. SELECT pos_name, base_servings, base_weight_g, serving_weight_g FROM recipes WHERE id = {recipe_id}
3. SELECT SUM(quantity) FROM pos_sales_by_item WHERE menu_item ILIKE '%brussel%' AND sale_date >= CURRENT_DATE - 14 GROUP BY menu_item
4. Verifica che il BOM della ricetta esista e abbia almeno 1 riga
5. Controlla expected_duration_days sul prep_task
