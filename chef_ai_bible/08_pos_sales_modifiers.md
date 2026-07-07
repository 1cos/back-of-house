# Chef AI — POS Sales & Modifiers

## Come funziona il POS TouchBistro

Dati arrivano via email notturna. Nessuna vista "oggi" in tempo reale.
Tabella: pos_sales_by_item — colonne chiave: menu_item, quantity, sale_date, menu_group
Colonne ADMIN ONLY: net_sales, gross_sales, item_discounts, voids

## Match POS → recipe

recipes.pos_name deve combaciare con pos_sales_by_item.menu_item.
pos_name supporta alias pipe-delimited: 'Nome1|Nome2|Nome3'
MAI modificare alias con storico POS — solo appendere nuovi.

Query per trovare vendite di una ricetta:
SELECT sale_date, SUM(quantity) as qty
FROM pos_sales_by_item
WHERE menu_item = ANY(string_to_array('{pos_name}', '|'))
  AND sale_date >= CURRENT_DATE - 30
GROUP BY sale_date ORDER BY sale_date DESC;

## Alias POS confermati (produzione)

| POS name | Produzione |
|---|---|
| Penne Midnight, Penne Midnight Half | Arrabbiata sauce |
| Add salmon whole, add salmon whole, Add salmon, add salmon | Salmon Filet (1 per piatto) |
| Add chicken, Add Chicken, Blackened chicken | Diced Grilled Chicken (60g) |
| Scallops Chefs Way, Scallops | 4 pezzi per porzione |
| Scallops Asparagus Gnocchi, Scallops add on | 3 pezzi per porzione |
| Brussel Sprouts, Brussels, Box Brussels | Brussels Sprouts Ready to Sell |
| Shrimp Gnocchi, Gnocchi | Gnocchi (200g) |
| Cacio e Pepe | 1 nest spaghetti + Cacio e Pepe sauce |
| Chicken Parmesan | 1 pezzo petto + arrabbiata + 1 nest spaghetti |
| La N 4, La No 4 | 1 nest spaghetti |
| La N.4 Half, La No.4 Half | 0.5 nest spaghetti |

## Add-on = mezza porzione per produzione

Tutti gli add-on proteici (chicken, shrimp, salmon, scallops, lobster) su pasta
= MEZZA porzione per la produzione.
pos_modifiers.portion_factor = 0.5 per questi modificatori.

## pos_modifiers e pos_modifier_by_item

Modificatori grezzi POS e scomposizione per piatto padre (parent_item, pct_of_parent).
Per add-on: usare pos_excluded_items per capire cosa NON deve generare prep.

## Drink/alcol esclusi dalle statistiche

Escludere usando menu_group NOT IN ('Beverages','Bar','Spirits') nelle query di produzione.

## Query consumo medio per giorno della settimana (DOW)

SELECT
  EXTRACT(DOW FROM sale_date) AS dow,
  AVG(quantity) AS avg_qty
FROM pos_sales_by_item
WHERE menu_item ILIKE '%{menu_item}%'
  AND sale_date >= CURRENT_DATE - 60
  AND EXTRACT(DOW FROM sale_date) != 0  -- esclude domenica
GROUP BY dow
ORDER BY dow;

-- DOW: 0=domenica, 1=lunedi, 2=martedi, 3=mercoledi, 4=giovedi, 5=venerdi, 6=sabato

## Aggregazione per data (fix bug alias multipli)

Se una ricetta ha piu alias in pos_name, la stessa data puo avere piu righe.
Aggregare PER DATA prima di calcolare la media DOW:
SELECT sale_date, SUM(quantity) as day_total
FROM pos_sales_by_item
WHERE menu_item = ANY(string_to_array('{pos_name}', '|'))
GROUP BY sale_date;
Poi calcola media DOW su day_total.
