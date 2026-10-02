-- CLAUDE-CLEAN0210B — decisioni di Chef del 02/10 (email "RISPOSTE CHEF ALLE 6 DECISIONI").
-- Backup: ~/Brigade_backups/clean0210/before_20261002_chef6.json
-- Ogni scrittura verifica il valore attuale: se e' cambiato, si ferma tutto.

do $chef$
declare n int;
begin
  -- 1) FILETS — standard Chef: 8 oz a filetto = 226,8 g. Una sola fonte: la ricetta
  -- Filets dichiara 1 pezzo da 226,8 g e la distinta usa 226,8 g di Beef Filet
  -- invece di "1 pz" (= un filetto intero). 908 g non aveva fonte.
  -- Lo scarto di pulizia NON e' incluso (va in demi/ragu): costo = minimo, segnalato.
  update public.recipes set base_weight_g = 226.8, base_servings = 1, serving_weight_g = 226.8
   where id = '1eb7f1fa-1248-4534-a507-31f9ec503bd8' and base_weight_g = 908 and base_servings is null;
  get diagnostics n = row_count; if n <> 1 then raise exception 'Filets ricetta: % righe', n; end if;
  update public.recipe_bom set quantity = 226.8, unit = 'g',
         notes = '8 oz netti a filetto (standard Chef 02/10). Scarto di pulizia non incluso.'
   where bom_id = 1839 and item_id = '1ef8e129-13b2-42b3-8222-f98a92c3134c' and quantity = 1 and unit = 'pz';
  get diagnostics n = row_count; if n <> 1 then raise exception 'Filets distinta: % righe', n; end if;

  -- 2) FILET BRANZINO — Chef: 1 branzino intero -> 2 filetti; 1 Siciliana = 1 filetto.
  -- Porzioni 2 (la distinta lo diceva gia' in nota). Il costo a pesce resta aperto:
  -- la fattura e' al libbra e non dice quanti pesci ci sono.
  update public.recipes set base_servings = 2
   where id = 'f7f46c56-a865-4ea3-9514-869e7a3a1226' and base_servings is null;
  get diagnostics n = row_count; if n <> 1 then raise exception 'Filet Branzino: % righe', n; end if;

  -- 4) ROASTED ALMONDS — Chef: mandorle a lamelle. Il prodotto a lamelle e' lo SKU
  -- Hardie's 25035 "ALMONDS SLICED BLANCHED", oggi collegato all'ingrediente
  -- "Blanched Almonds" (719e8b11). La ricetta conteneva se stessa: ora usa quello.
  update public.recipe_bom
     set component_type = 'ITEM', item_id = '719e8b11-8703-4372-9d43-46c100ecc8f3', sub_recipe_id = null
   where bom_id = 1861 and parent_recipe_id = '6a9e8d48-d027-46d9-9141-9e8fc9927f69'
     and sub_recipe_id = '6a9e8d48-d027-46d9-9141-9e8fc9927f69';
  get diagnostics n = row_count; if n <> 1 then raise exception 'Roasted Almonds: % righe', n; end if;

  -- 5) MEATBALLS — Chef: i 200 g di olio/sale/pepe/origano sono dell'impasto.
  -- Distinta = 9.012 g; 9.012 / 50 = 180,24 -> 180 polpette da 50 g (12 g di resto).
  update public.recipes set base_servings = 180, serving_weight_g = 50, serving_unit = 'pezzi', serving_qty = 1
   where id = '46784186-0f68-4fb9-9ec4-34dceef1936c' and base_servings = 35 and serving_weight_g = 257 and base_weight_g = 9012;
  get diagnostics n = row_count; if n <> 1 then raise exception 'Meatballs: % righe', n; end if;
end
$chef$;
