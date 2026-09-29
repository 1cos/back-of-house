-- ============================================================================
-- FC03 — ROLLBACK del rilascio food cost
-- ============================================================================
-- Riporta la produzione allo stato fotografato il 2026-09-29T03:33:23.970079+00:00:
--   righe olio (ingredient_vendors, invoice_lines, ingredient_links),
--   righe gnocchi (prezzo, riga fattura, collegamento, ingredienti),
--   audit, get_recipe_cost() e recipes_with_cost come prima, schema food_cost via.
-- Le ricette e le distinte non vanno ripristinate: il rilascio non le tocca.
-- updated_at torna al valore originale (trigger sospesi durante il ripristino).
-- Provato su PostgreSQL di produzione dentro una transazione annullata (FC03).
-- Le righe di supabase_migrations.schema_migrations del rilascio vanno tolte a
-- parte, se si vuole anche la storia pulita.
-- ============================================================================
begin;
-- 1. le righe tornano esattamente com'erano (2026-09-29T03:33:23.970079+00:00)
alter table public.ingredient_vendors disable trigger ingredient_vendors_updated_at;
alter table public.invoice_lines disable trigger invoice_lines_updated_at;
alter table public.ingredients disable trigger ingredients_updated_at;
update public.ingredient_vendors x set (active, conversion_to_base, created_at, do_not_order, do_not_order_reason, do_not_order_set_at, do_not_order_set_by, ingredient_id, last_invoice_date, order_count, pack_description, price_per_100g, price_per_each, price_type, purchase_unit, unit_price, updated_at, vendor, vendor_sku) =
  (select r.active, r.conversion_to_base, r.created_at, r.do_not_order, r.do_not_order_reason, r.do_not_order_set_at, r.do_not_order_set_by, r.ingredient_id, r.last_invoice_date, r.order_count, r.pack_description, r.price_per_100g, r.price_per_each, r.price_type, r.purchase_unit, r.unit_price, r.updated_at, r.vendor, r.vendor_sku from jsonb_populate_record(null::public.ingredient_vendors, $fc03${"active": true, "conversion_to_base": 13740, "created_at": "2026-07-01T11:33:52.245874+00:00", "do_not_order": false, "do_not_order_reason": null, "do_not_order_set_at": null, "do_not_order_set_by": null, "id": "a9d48626-164a-4809-b051-da539c08595b", "ingredient_id": "412b67a7-040b-4f3f-83f3-6b9f72c5c575", "last_invoice_date": "2026-06-16", "order_count": 0, "pack_description": "3/5LT", "price_per_100g": 1.1936, "price_per_each": null, "price_type": "per_case", "purchase_unit": "case", "unit_price": 164, "updated_at": "2026-09-29T02:20:21.199969+00:00", "vendor": "Global Gourmet Foods", "vendor_sku": null}$fc03$::jsonb) r)
 where x.id = 'a9d48626-164a-4809-b051-da539c08595b'::uuid;
update public.ingredient_vendors x set (active, conversion_to_base, created_at, do_not_order, do_not_order_reason, do_not_order_set_at, do_not_order_set_by, ingredient_id, last_invoice_date, order_count, pack_description, price_per_100g, price_per_each, price_type, purchase_unit, unit_price, updated_at, vendor, vendor_sku) =
  (select r.active, r.conversion_to_base, r.created_at, r.do_not_order, r.do_not_order_reason, r.do_not_order_set_at, r.do_not_order_set_by, r.ingredient_id, r.last_invoice_date, r.order_count, r.pack_description, r.price_per_100g, r.price_per_each, r.price_type, r.purchase_unit, r.unit_price, r.updated_at, r.vendor, r.vendor_sku from jsonb_populate_record(null::public.ingredient_vendors, $fc03${"active": true, "conversion_to_base": 10000, "created_at": "2026-09-29T02:09:08.940102+00:00", "do_not_order": false, "do_not_order_reason": null, "do_not_order_set_at": null, "do_not_order_set_by": null, "id": "cf322892-12a8-45b3-8682-78db80995760", "ingredient_id": "8a95ddb8-4e70-454b-8702-991d8b9a2056", "last_invoice_date": "2026-06-16", "order_count": 0, "pack_description": "10 KG", "price_per_100g": 0.7456999999999999, "price_per_each": null, "price_type": "per_case", "purchase_unit": "lb", "unit_price": 74.57, "updated_at": "2026-09-29T02:09:08.940102+00:00", "vendor": "Global Gourmet Foods", "vendor_sku": null}$fc03$::jsonb) r)
 where x.id = 'cf322892-12a8-45b3-8682-78db80995760'::uuid;
update public.invoice_lines x set (anomaly_note, avg_unit_weight_g, base_cost, clarification_answer, clarification_answered, clarification_at, clarification_question, conversion_to_base, cost_per_100g, count_unit, created_at, estimated_total_g, import_id, ingredient_id, invoice_date, invoice_number, line_total, match_confidence, match_status, needs_clarification, pack_count, pack_description, pack_qty, pack_size, pack_size_each, pack_size_unit, pack_unit, price_anomaly, purchase_unit, qty, raw_description, total_weight_g, unit_price, updated_at, vendor, vendor_sku) =
  (select r.anomaly_note, r.avg_unit_weight_g, r.base_cost, r.clarification_answer, r.clarification_answered, r.clarification_at, r.clarification_question, r.conversion_to_base, r.cost_per_100g, r.count_unit, r.created_at, r.estimated_total_g, r.import_id, r.ingredient_id, r.invoice_date, r.invoice_number, r.line_total, r.match_confidence, r.match_status, r.needs_clarification, r.pack_count, r.pack_description, r.pack_qty, r.pack_size, r.pack_size_each, r.pack_size_unit, r.pack_unit, r.price_anomaly, r.purchase_unit, r.qty, r.raw_description, r.total_weight_g, r.unit_price, r.updated_at, r.vendor, r.vendor_sku from jsonb_populate_record(null::public.invoice_lines, $fc03${"anomaly_note": null, "avg_unit_weight_g": null, "base_cost": null, "clarification_answer": null, "clarification_answered": false, "clarification_at": null, "clarification_question": null, "conversion_to_base": null, "cost_per_100g": 0.7457, "count_unit": null, "created_at": "2026-09-29T02:09:09.55177+00:00", "estimated_total_g": 10000, "id": "bed19f62-77e0-471d-83b9-7e8c952065ed", "import_id": "f32567fc-02b7-43b1-83e3-e27e2e92eaf3", "ingredient_id": "8a95ddb8-4e70-454b-8702-991d8b9a2056", "invoice_date": "2026-06-16", "invoice_number": "20734", "line_total": 149.14, "match_confidence": null, "match_status": "matched", "needs_clarification": false, "pack_count": null, "pack_description": "10 KG", "pack_qty": null, "pack_size": null, "pack_size_each": null, "pack_size_unit": null, "pack_unit": null, "price_anomaly": false, "purchase_unit": "case", "qty": 2, "raw_description": "Gnocchi C-Catering 10kg. \"Molino Pasini\"", "total_weight_g": null, "unit_price": 74.57, "updated_at": "2026-09-29T02:09:09.55177+00:00", "vendor": "Global Gourmet Foods", "vendor_sku": null}$fc03$::jsonb) r)
 where x.id = 'bed19f62-77e0-471d-83b9-7e8c952065ed'::uuid;
update public.invoice_lines x set (anomaly_note, avg_unit_weight_g, base_cost, clarification_answer, clarification_answered, clarification_at, clarification_question, conversion_to_base, cost_per_100g, count_unit, created_at, estimated_total_g, import_id, ingredient_id, invoice_date, invoice_number, line_total, match_confidence, match_status, needs_clarification, pack_count, pack_description, pack_qty, pack_size, pack_size_each, pack_size_unit, pack_unit, price_anomaly, purchase_unit, qty, raw_description, total_weight_g, unit_price, updated_at, vendor, vendor_sku) =
  (select r.anomaly_note, r.avg_unit_weight_g, r.base_cost, r.clarification_answer, r.clarification_answered, r.clarification_at, r.clarification_question, r.conversion_to_base, r.cost_per_100g, r.count_unit, r.created_at, r.estimated_total_g, r.import_id, r.ingredient_id, r.invoice_date, r.invoice_number, r.line_total, r.match_confidence, r.match_status, r.needs_clarification, r.pack_count, r.pack_description, r.pack_qty, r.pack_size, r.pack_size_each, r.pack_size_unit, r.pack_unit, r.price_anomaly, r.purchase_unit, r.qty, r.raw_description, r.total_weight_g, r.unit_price, r.updated_at, r.vendor, r.vendor_sku from jsonb_populate_record(null::public.invoice_lines, $fc03${"anomaly_note": null, "avg_unit_weight_g": null, "base_cost": null, "clarification_answer": null, "clarification_answered": false, "clarification_at": null, "clarification_question": null, "conversion_to_base": null, "cost_per_100g": 1.1936, "count_unit": null, "created_at": "2026-09-29T02:09:09.55177+00:00", "estimated_total_g": null, "id": "fa4e8388-d056-4525-ac45-e3d1e7ef302b", "import_id": "f32567fc-02b7-43b1-83e3-e27e2e92eaf3", "ingredient_id": "412b67a7-040b-4f3f-83f3-6b9f72c5c575", "invoice_date": "2026-06-16", "invoice_number": "20734", "line_total": 492, "match_confidence": null, "match_status": "matched", "needs_clarification": false, "pack_count": null, "pack_description": "3/5LT", "pack_qty": null, "pack_size": null, "pack_size_each": null, "pack_size_unit": null, "pack_unit": null, "price_anomaly": false, "purchase_unit": "case", "qty": 3, "raw_description": "Extra Virgin Olive Oil 3/5lt Seleccion \"Oleoestepa\"", "total_weight_g": null, "unit_price": 164, "updated_at": "2026-09-29T02:09:09.55177+00:00", "vendor": "Global Gourmet Foods", "vendor_sku": null}$fc03$::jsonb) r)
 where x.id = 'fa4e8388-d056-4525-ac45-e3d1e7ef302b'::uuid;
update public.ingredient_links x set (base_unit, confidence, confirmed, conversion_g, created_at, ingredient_id, ingredient_name, invoice_description, invoice_unit, last_invoice_date, unit_price, updated_at, vendor) =
  (select r.base_unit, r.confidence, r.confirmed, r.conversion_g, r.created_at, r.ingredient_id, r.ingredient_name, r.invoice_description, r.invoice_unit, r.last_invoice_date, r.unit_price, r.updated_at, r.vendor from jsonb_populate_record(null::public.ingredient_links, $fc03${"base_unit": "g", "confidence": 1, "confirmed": true, "conversion_g": 13740, "created_at": "2026-09-28T22:49:05.399111+00:00", "id": 329, "ingredient_id": "412b67a7-040b-4f3f-83f3-6b9f72c5c575", "ingredient_name": "Extra Virgin Olive Oil", "invoice_description": "Extra Virgin Olive Oil 3/5lt Seleccion \"Oleoestepa\"", "invoice_unit": "cs", "last_invoice_date": "2026-06-16", "unit_price": 164, "updated_at": "2026-09-28T22:49:05.399111+00:00", "vendor": "Global Gourmet Foods"}$fc03$::jsonb) r)
 where x.id = '329'::bigint;
update public.ingredient_links x set (base_unit, confidence, confirmed, conversion_g, created_at, ingredient_id, ingredient_name, invoice_description, invoice_unit, last_invoice_date, unit_price, updated_at, vendor) =
  (select r.base_unit, r.confidence, r.confirmed, r.conversion_g, r.created_at, r.ingredient_id, r.ingredient_name, r.invoice_description, r.invoice_unit, r.last_invoice_date, r.unit_price, r.updated_at, r.vendor from jsonb_populate_record(null::public.ingredient_links, $fc03${"base_unit": "g", "confidence": 1, "confirmed": true, "conversion_g": 10000, "created_at": "2026-09-29T00:18:55.265098+00:00", "id": 333, "ingredient_id": "8a95ddb8-4e70-454b-8702-991d8b9a2056", "ingredient_name": "Gnocchi Molino Pasini", "invoice_description": "Gnocchi C-Catering 10kg. \"Molino Pasini\"", "invoice_unit": "ea", "last_invoice_date": "2026-06-16", "unit_price": 74.57, "updated_at": "2026-09-29T00:18:55.265098+00:00", "vendor": "Global Gourmet Foods"}$fc03$::jsonb) r)
 where x.id = '333'::bigint;
update public.ingredients x set (active, avg_unit_weight_g, base_unit, category, created_at, measure_type, name, name_es, name_it, notes, updated_at, yield_factor) =
  (select r.active, r.avg_unit_weight_g, r.base_unit, r.category, r.created_at, r.measure_type, r.name, r.name_es, r.name_it, r.notes, r.updated_at, r.yield_factor from jsonb_populate_record(null::public.ingredients, $fc03${"active": true, "avg_unit_weight_g": null, "base_unit": "g", "category": "Dry Goods", "created_at": "2026-09-29T00:18:55.265098+00:00", "id": "8a95ddb8-4e70-454b-8702-991d8b9a2056", "measure_type": "weight", "name": "Gnocchi Molino Pasini", "name_es": null, "name_it": null, "notes": null, "updated_at": "2026-09-29T00:18:55.265098+00:00", "yield_factor": 1}$fc03$::jsonb) r)
 where x.id = '8a95ddb8-4e70-454b-8702-991d8b9a2056'::uuid;
update public.ingredients x set (active, avg_unit_weight_g, base_unit, category, created_at, measure_type, name, name_es, name_it, notes, updated_at, yield_factor) =
  (select r.active, r.avg_unit_weight_g, r.base_unit, r.category, r.created_at, r.measure_type, r.name, r.name_es, r.name_it, r.notes, r.updated_at, r.yield_factor from jsonb_populate_record(null::public.ingredients, $fc03${"active": true, "avg_unit_weight_g": null, "base_unit": "g", "category": "Dry Goods", "created_at": "2026-06-10T04:28:08.037046+00:00", "id": "cd6093bd-d51f-4d39-ae45-3e2984da1df4", "measure_type": "weight", "name": "Gnocchi Flour", "name_es": "Harina para \u00d1oquis", "name_it": "Farina per Gnocchi", "notes": null, "updated_at": "2026-06-18T15:07:25.094198+00:00", "yield_factor": 1}$fc03$::jsonb) r)
 where x.id = 'cd6093bd-d51f-4d39-ae45-3e2984da1df4'::uuid;
alter table public.ingredient_vendors enable trigger ingredient_vendors_updated_at;
alter table public.invoice_lines enable trigger invoice_lines_updated_at;
alter table public.ingredients enable trigger ingredients_updated_at;

-- 2. le righe di audit aggiunte dal rilascio (quella di GG09 resta)
delete from public.ingredient_vendor_price_audit
 where id not in ('b452faad-5d4c-4e01-ac9d-c4744ea5777e') and eseguito_da like 'Claude Code — FC0%';

-- 3. get_recipe_cost e recipes_with_cost tornano alla versione di prima,
--    poi lo schema food_cost sparisce
drop view if exists public.recipes_with_cost;
set local check_function_bodies = off;
CREATE OR REPLACE FUNCTION public.get_recipe_cost(p_recipe_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
WITH RECURSIVE recipe_cost AS (
  -- Base: ingredienti comprati
  SELECT 
    b.parent_recipe_id,
    SUM(
      CASE 
        WHEN b.unit = 'kg' THEN b.quantity * i.current_cost
        WHEN b.unit = 'g' THEN b.quantity * i.current_cost / 1000.0
        WHEN b.unit = 'L' THEN b.quantity * i.current_cost
        WHEN b.unit = 'ml' THEN b.quantity * i.current_cost / 1000.0
        ELSE b.quantity * i.current_cost
      END
    ) as total
  FROM recipe_bom b
  JOIN items i ON b.item_id = i.item_id
  WHERE b.component_type = 'ITEM' AND b.parent_recipe_id = p_recipe_id
  GROUP BY b.parent_recipe_id
  
  UNION ALL
  
  -- Ricorsivo: sub-ricette
  SELECT 
    b.parent_recipe_id,
    SUM(b.quantity * (
      SELECT get_recipe_cost(b.sub_recipe_id) / r.base_weight * 
      CASE 
        WHEN b.unit = 'kg' THEN 1
        WHEN b.unit = 'g' THEN 0.001
        ELSE 1 
      END
    ))
  FROM recipe_bom b
  JOIN recipes r ON b.sub_recipe_id = r.id
  WHERE b.component_type = 'RECIPE' AND b.parent_recipe_id = p_recipe_id
  GROUP BY b.parent_recipe_id
)
SELECT COALESCE(SUM(total), 0) FROM recipe_cost WHERE parent_recipe_id = p_recipe_id;
$function$;
create view public.recipes_with_cost as
SELECT id,
    title,
    category,
    yield_text,
    prep_time_minutes,
    ingredients,
    procedure,
    equipment,
    created_at,
    image_url,
    base_weight,
    weight_unit,
    base_servings,
    get_recipe_cost(id) AS total_cost,
        CASE
            WHEN (base_weight > (0)::numeric) THEN (get_recipe_cost(id) / base_weight)
            ELSE NULL::numeric
        END AS cost_per_kg
   FROM recipes r;
grant all on public.recipes_with_cost to anon, authenticated, service_role;
drop schema if exists food_cost cascade;

commit;
