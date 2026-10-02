-- CLAUDE-CLEAN0210 — correzioni dati verificate (GO email "GO ESECUZIONE
-- CONTROLLATA", 02/10). Solo dati dimostrati da fattura, da fonti canoniche
-- concordi o da decisione esplicita di Chef. Nessuna assunzione.
--
-- Backup "prima": ~/Brigade_backups/clean0210/before_20261002.json
-- Ogni blocco verifica che il valore attuale sia ancora quello del backup:
-- se qualcuno l'ha cambiato nel frattempo, si ferma tutto (nessuna scrittura).

do $clean$
declare n int;
begin
  -- ── A0-1 Dry Oregano: prezzo dalla propria fattura (Hardie's 24303, 09/09: 2 x $14,88, 8 OZ = 227 g)
  update public.ingredient_vendors
     set unit_price = 14.88, last_invoice_date = '2026-09-09',
         price_per_100g = 14.88 / 227 * 100
   where id = '582c1308-00d1-489b-8734-3db9de1596f7' and vendor_sku = '24303'
     and unit_price is null and conversion_to_base = 227;
  get diagnostics n = row_count; if n <> 1 then raise exception 'A0-1 Dry Oregano: % righe', n; end if;

  -- ── A0-2 Maldon Salt: prezzo dalla propria fattura (Hardie's 04396, 14/09: $29,99, 3.1# = 1406 g)
  update public.ingredient_vendors
     set unit_price = 29.99, last_invoice_date = '2026-09-14',
         price_per_100g = 29.99 / 1406 * 100
   where id = '69b4fd34-2eaa-42cb-9b2a-e061fe604823' and vendor_sku = '04396'
     and unit_price is null and conversion_to_base = 1406;
  get diagnostics n = row_count; if n <> 1 then raise exception 'A0-2 Maldon: % righe', n; end if;

  -- ── A0-3 Shaved Parmesan: resa 2000 g (testo "2kg" = distinta 2 kg)
  update public.recipes set base_weight_g = 2000
   where id = 'cf887ce4-d9e4-47e6-8ee0-f052eb6f23e8' and base_weight_g is null;
  get diagnostics n = row_count; if n <> 1 then raise exception 'A0-3 Shaved Parmesan: % righe', n; end if;

  -- ── A0-4 VEGGIES SALT: resa 850 g (500 g sale + 350 g zucchero, miscela a secco)
  update public.recipes set base_weight_g = 850
   where id = 'f12c638c-0c14-40a5-841f-ab947a423865' and base_weight_g is null;
  get diagnostics n = row_count; if n <> 1 then raise exception 'A0-4 Veggies Salt: % righe', n; end if;

  -- ── P1 Sliced Mozzarella (Hardie's 27786 "8/1#" a $4,82 AL LIBBRA).
  -- Fattura 07133808 del 21/09: 2 casse x 8 lb x $4,82 = $77,12. Il parser
  -- (corretto in CLEAN0210) l'aveva letta come prezzo a collo: 0,1328 / 100 g.
  -- Valore vero = 4,82 / 453,592 x 100 = 1,0626. Si corregge la riga fornitore
  -- e la sola riga fattura che il food cost confronta (21/09). Importi e
  -- quantita' NON cambiano. Le righe storiche precedenti restano com'erano.
  update public.ingredient_vendors
     set price_type = 'per_lb', conversion_to_base = null,
         price_per_100g = 4.82 / 453.592 * 100
   where id = '1a820846-86c4-448a-b1ec-447799a828b6' and vendor_sku = '27786'
     and price_type = 'per_case' and unit_price = 4.82 and last_invoice_date = '2026-09-21';
  get diagnostics n = row_count; if n <> 1 then raise exception 'P1 mozzarella fornitore: % righe', n; end if;
  update public.invoice_lines set cost_per_100g = round(4.82 / 453.592 * 100, 4)
   where id = '9e2accbc-81a6-4d65-b3e2-4c4bad29969b' and cost_per_100g = 0.1328 and line_total = 77.12;
  get diagnostics n = row_count; if n <> 1 then raise exception 'P1 mozzarella riga: % righe', n; end if;

  -- ── P2 Stew Meat (Hardie's 24171 "ABR BROCHETTE MEAT FRZ 4 PC/12#", pesata).
  -- Fattura del 19/08: 4 colli, $4,37 al libbra, importo $226,54 = 51,84 lb.
  -- Valore vero = 4,37 / 453,592 x 100 = 0,9634 (= 226,54 / 51,84 lb). Stessa
  -- regola della P1: riga fornitore + la riga fattura confrontata, importi invariati.
  update public.ingredient_vendors
     set price_type = 'per_lb', conversion_to_base = null,
         price_per_100g = 4.37 / 453.592 * 100
   where id = '896ba8ab-e9bb-4031-85bc-ea0759921e80' and vendor_sku = '24171'
     and price_type = 'per_case' and unit_price = 4.37 and last_invoice_date = '2026-08-19';
  get diagnostics n = row_count; if n <> 1 then raise exception 'P2 stew meat fornitore: % righe', n; end if;
  update public.invoice_lines set cost_per_100g = round(4.37 / 453.592 * 100, 4)
   where id = '68a49d1d-8e73-4688-81d5-756936d34e78' and cost_per_100g = 0.0803 and line_total = 226.54;
  get diagnostics n = row_count; if n <> 1 then raise exception 'P2 stew meat riga: % righe', n; end if;

  -- ── M1 Meatball Appetizer: peso del sacchetto 380 -> 350 g.
  -- Decisione Chef 02/10: standard ristorante 50 g a polpetta, 5 a porzione.
  -- Distinta della ricetta: 5 Meatballs + 100 g Meatball Sauce = 5 x 50 + 100 = 350 g.
  update public.recipes set base_weight_g = 350
   where id = '74de5287-fc1a-4d53-9927-9da0b26070a9' and base_weight_g = 380;
  get diagnostics n = row_count; if n <> 1 then raise exception 'M1 Meatball Appetizer: % righe', n; end if;

  -- ── M2 Meatball skewer: riga farfalle legacy rimossa (decisione Chef 02/10:
  -- "le farfalle negli skewer NON si usano piu'"). Resta solo la riga stecchini;
  -- la quantita' di polpette (catering, 25 g) resta APERTA: non si indovina.
  delete from public.recipe_bom
   where bom_id = 581 and parent_recipe_id = 'a28586ab-c1f1-457d-bc78-838fe6bb9b74'
     and item_id = 'ac4f78f6-d6ab-4edc-85a7-eb290ad284a4' and quantity = 500;
  get diagnostics n = row_count; if n <> 1 then raise exception 'M2 skewer farfalle: % righe', n; end if;
end
$clean$;
