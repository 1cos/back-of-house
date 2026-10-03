-- XCF-PREZZI 02 — Global Gourmet #20734: dati verificati sulla fattura originale.
-- DATI, non schema. Ogni UPDATE e' guardato sullo stato attuale (WHERE valore = vecchio):
-- se qualcuno ha cambiato la riga nel frattempo, non tocca niente.
-- Fonte: foto originale fattura 20734 del 16/06/2026 (U/M: 3 cs, 3 cs, 2 ea, 7.3 lb, vuota, 1.98 lb;
-- colonna EA/CS/LBS: 3cs, 3cs, 2ea, 1cs, 1ea, 1ea), PDF Global_Gourmet_4_original_invoices_Brigade.pdf.
-- Backup: ~/Brigade_backups/xcf-0210/prezzi/gg_snapshot_pre.json
-- Rollback: migrations/rollback/20261002_xcf_prezzi_02_global_gourmet_rollback.sql
-- Importi contabili (invoice_lines.qty/unit_price/line_total) e costi/100 g NON cambiano.
begin;

-- 1. Guanciale: 16,82 e' AL LIBBRA (7,3 lb x 16,82 = 122,79). La conversione 3175 g
--    (7 lb nominali di cassa) non descrive il prezzo al libbra: via. Costo/100 g 3,7082 invariato.
update public.ingredient_vendors
   set price_type = 'per_lb', conversion_to_base = null, updated_at = now()
 where id = '085ad2bf-5b8d-42e3-9e9b-8e2f0154dd36' and vendor = 'Global Gourmet Foods'
   and price_type = 'per_case' and unit_price = 16.82 and conversion_to_base = 3175
   and round(price_per_100g, 4) = 3.7082
returning id, price_type, conversion_to_base, unit_price, price_per_100g;

-- 2. Salame: 16,50 AL LIBBRA (1,98 lb x 16,50 = 32,67). Costo/100 g 3,6376 invariato.
update public.ingredient_vendors
   set price_type = 'per_lb', updated_at = now()
 where id = 'd50560be-6337-4cd9-b3be-7a392823fcb9' and vendor = 'Global Gourmet Foods'
   and price_type = 'per_case' and unit_price = 16.5 and conversion_to_base is null
   and round(price_per_100g, 4) = 3.6376
returning id, price_type, unit_price, price_per_100g;

-- 3. Gnocchi Flour e Sea Salt: si comprano a sacco (fattura: "2ea" 10 kg, "1ea" 25 kg;
--    #19563: Sea Salt 12.5kg U/M ea). purchase_unit 'lb' era il default di colonna.
--    Solo etichetta: prezzo, conversione e costo/100 g invariati.
update public.ingredient_vendors set purchase_unit = 'each', updated_at = now()
 where id = 'cf322892-12a8-45b3-8682-78db80995760' and purchase_unit = 'lb'
   and unit_price = 74.57 and conversion_to_base = 10000
returning id, purchase_unit;
update public.ingredient_vendors set purchase_unit = 'each', updated_at = now()
 where id = '1e0fd72d-9535-4331-8d6e-d97060b05a1a' and purchase_unit = 'lb'
   and unit_price = 34.5 and conversion_to_base = 25000
returning id, purchase_unit;

-- 4. Pomodori La Carmela (riga creata a mano il 01/07/2026, mai aggiornata, nessuna fonte per 17.700 g).
--    - purchase_unit 'per_case' (valore di price_type finito nella colonna sbagliata) -> 'case' (U/M fattura: cs)
--    - last_invoice_date null -> 2026-06-16 (fattura 20734: 3 cs a $35,00 = stesso prezzo memorizzato)
--    - conversion_to_base 17700 -> 18000: 6 latte da 3 kg = 18.000 g di PRODOTTO NETTO per cassa.
--      FONTE: Max (chef), 02/10/2026. Non e' il peso lordo della cassa ne' la resa in salsa.
--    - price_per_100g null -> 35 / 18000 x 100 = 0,1944
--    Food cost: Canned Tomatoes continua a usare Hardie's (classe A, 17/07/2026, piu' recente).
update public.ingredient_vendors
   set purchase_unit = 'case', last_invoice_date = date '2026-06-16', conversion_to_base = 18000,
       price_per_100g = round(35.00 / 18000 * 100, 6), updated_at = now()
 where id = 'b97d177c-bbd0-461d-85c2-71023ab8f528' and vendor = 'Global Gourmet Foods'
   and purchase_unit = 'per_case' and unit_price = 35.00 and conversion_to_base = 17700
   and last_invoice_date is null and price_per_100g is null
   and exists (select 1 from public.invoice_lines where id = '48c61f60-8673-41c0-9224-dad7e110cf6a'
               and unit_price = 35 and qty = 3 and invoice_date = date '2026-06-16')
returning id, purchase_unit, last_invoice_date, conversion_to_base, price_per_100g;

-- 5. invoice_lines #20734: U/M di fattura e peso fatturato. qty, prezzi, importi, costo/100 g invariati.
update public.invoice_lines set purchase_unit = 'lb', estimated_total_g = 3311, updated_at = now()
 where id = '6c06b210-fd6c-483f-aab0-10ebe59cd5b6' and purchase_unit = 'case' and estimated_total_g = 3175
   and qty = 7.3 and unit_price = 16.82 and line_total = 122.79
returning id, purchase_unit, estimated_total_g;
update public.invoice_lines set purchase_unit = 'lb', estimated_total_g = 898, updated_at = now()
 where id = '1bd5712e-0499-4df5-bbee-226869126692' and purchase_unit = 'case' and estimated_total_g is null
   and qty = 1.98 and unit_price = 16.5 and line_total = 32.67
returning id, purchase_unit, estimated_total_g;
update public.invoice_lines set purchase_unit = 'each', updated_at = now()
 where id = 'bed19f62-77e0-471d-83b9-7e8c952065ed' and purchase_unit = 'case'
   and qty = 2 and unit_price = 74.57 and line_total = 149.14
returning id, purchase_unit;
-- Pomodori e olio: U/M cs -> 'case' gia' giusto. Sea Salt: U/M NON stampata -> resta 'case'.

-- 6. Documento #20734: l'olio al dato verificato (15 L = 15.000 g per cassa, 1,0933 $/100 g,
--    lo stesso di ingredient_vendors e invoice_lines) cosi' un riprocessamento non regredisce a 1,1936;
--    invoice_unit = U/M stampata (letta dal nuovo codice). Correzione tracciata in provenance.
update public.vendor_documents
   set parsed_json = jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(
         parsed_json,
         '{items,1}', ((parsed_json->'items'->1) - '_densita_assunta')
                       || '{"_cost_per_100g": 1.0933, "_peso_per_cassa_g": 15000, "_peso_totale_g": 45000, "invoice_unit": "cs"}'::jsonb),
         '{items,0,invoice_unit}', '"cs"'),
         '{items,2,invoice_unit}', '"ea"'),
         '{items,3,invoice_unit}', '"lb"'),
         '{items,4,invoice_unit}', 'null'),
         '{items,5,invoice_unit}', '"lb"'),
         '{provenance,correzioni}', coalesce(parsed_json->'provenance'->'correzioni', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
           'data', '2026-10-02', 'da', 'Claude (XCF-PREZZI, GO Max 02/10)',
           'cosa', 'olio: _cost_per_100g 1.1936 -> 1.0933, _peso_per_cassa_g 13740 -> 15000, _peso_totale_g 41220 -> 45000, tolto _densita_assunta 0.916 (dato verificato in ingredient_vendors/invoice_lines dal 29/09); aggiunto invoice_unit = U/M stampata (cs, cs, ea, lb, vuota, lb)'))),
       updated_at = now()
 where id = 'f32567fc-02b7-43b1-83e3-e27e2e92eaf3'
   and (parsed_json->'items'->1->>'_cost_per_100g')::numeric = 1.1936
   and parsed_json->'items'->1->>'description' like 'Extra Virgin Olive Oil%'
   and parsed_json->'items'->0->>'description' like 'Italian Peeled Tomatoes%'
   and parsed_json->'items'->2->>'description' like 'Gnocchi%'
   and parsed_json->'items'->3->>'description' like 'Guanciale%'
   and parsed_json->'items'->4->>'description' like 'SEA SALT%'
   and parsed_json->'items'->5->>'description' like 'Salame%'
   and not (parsed_json->'items'->0 ? 'invoice_unit')
returning id, parsed_json->'items'->1 as olio;

commit;
