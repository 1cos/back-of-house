-- Rollback XCF-PREZZI 02. Ripristina i valori di ~/Brigade_backups/xcf-0210/prezzi/gg_snapshot_pre.json,
-- guardato sui valori scritti dalla migrazione (se qualcosa e' cambiato dopo, non tocca).
begin;
update public.ingredient_vendors set price_type = 'per_case', conversion_to_base = 3175
 where id = '085ad2bf-5b8d-42e3-9e9b-8e2f0154dd36' and price_type = 'per_lb' and conversion_to_base is null and unit_price = 16.82;
update public.ingredient_vendors set price_type = 'per_case'
 where id = 'd50560be-6337-4cd9-b3be-7a392823fcb9' and price_type = 'per_lb' and unit_price = 16.5;
update public.ingredient_vendors set purchase_unit = 'lb'
 where id in ('cf322892-12a8-45b3-8682-78db80995760','1e0fd72d-9535-4331-8d6e-d97060b05a1a') and purchase_unit = 'each';
update public.ingredient_vendors
   set purchase_unit = 'per_case', last_invoice_date = null, conversion_to_base = 17700, price_per_100g = null
 where id = 'b97d177c-bbd0-461d-85c2-71023ab8f528' and purchase_unit = 'case' and conversion_to_base = 18000
   and last_invoice_date = date '2026-06-16' and unit_price = 35.00;
update public.invoice_lines set purchase_unit = 'case', estimated_total_g = 3175
 where id = '6c06b210-fd6c-483f-aab0-10ebe59cd5b6' and purchase_unit = 'lb' and estimated_total_g = 3311;
update public.invoice_lines set purchase_unit = 'case', estimated_total_g = null
 where id = '1bd5712e-0499-4df5-bbee-226869126692' and purchase_unit = 'lb' and estimated_total_g = 898;
update public.invoice_lines set purchase_unit = 'case'
 where id = 'bed19f62-77e0-471d-83b9-7e8c952065ed' and purchase_unit = 'each';
update public.vendor_documents
   set parsed_json = jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(
         parsed_json #- '{provenance,correzioni}',
         '{items,1}', ((parsed_json->'items'->1) - 'invoice_unit')
                       || '{"_cost_per_100g": 1.1936, "_peso_per_cassa_g": 13740, "_peso_totale_g": 41220, "_densita_assunta": 0.916}'::jsonb),
         '{items,0}', (parsed_json->'items'->0) - 'invoice_unit'),
         '{items,2}', (parsed_json->'items'->2) - 'invoice_unit'),
         '{items,3}', (parsed_json->'items'->3) - 'invoice_unit'),
         '{items,4}', (parsed_json->'items'->4) - 'invoice_unit'),
         '{items,5}', (parsed_json->'items'->5) - 'invoice_unit')
 where id = 'f32567fc-02b7-43b1-83e3-e27e2e92eaf3' and (parsed_json->'items'->1->>'_cost_per_100g')::numeric = 1.0933;
commit;
