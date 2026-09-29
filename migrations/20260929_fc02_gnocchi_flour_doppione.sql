-- ============================================================================
-- FC02 — Gnocchi Flour: assorbe il doppione "Gnocchi Molino Pasini"
-- (PROPOSTA, non applicata)
-- ============================================================================
-- Max (FC02): il prodotto Molino Pasini comprato da Global Gourmet e' il
-- PREPARATO per gnocchi, a cui si aggiungono acqua e noce moscata. E' l'ingrediente
-- gia' esistente "Gnocchi Flour" (Farina per Gnocchi), usato dalla ricetta GNOCCHI:
-- Water 1.200 g + Gnocchi Flour 800 g + Nutmeg 4 g.
--
-- Verifica fatta in produzione (sola lettura) il 29/09/2026:
--   Gnocchi Flour          cd6093bd-d51f-4d39-ae45-3e2984da1df4  Dry Goods, g, peso,
--                          attivo, creato 10/06, nessun fornitore, nessuna fattura
--   Gnocchi Molino Pasini  8a95ddb8-4e70-454b-8702-991d8b9a2056  Dry Goods, g, peso,
--                          creato 29/09 dall'import della #20734
--   Riferimenti al doppione in tutte le 15 tabelle con FK su ingredients e nei jsonb
--   di recipes / events / vendor_documents: esattamente TRE
--     ingredient_vendors  1 riga (GG, 10 KG, $74,57, 16/06)
--     invoice_lines       1 riga (#20734, "Gnocchi C-Catering 10kg. Molino Pasini")
--     ingredient_links    1 riga (id 333): e' quella che guida le fatture future
--   Gnocchi Flour non ha fornitori: nessun conflitto di prezzo da risolvere.
--
-- Non si toccano: recipe_bom, recipes (GNOCCHI e tutte le ricette ZENO 2.0),
-- stock, prep. Il doppione non si cancella: si disattiva e resta tracciabile.
-- Ogni passo e' condizionato: se la situazione non e' quella verificata, si ferma.
-- ============================================================================


do $$
declare
  v_flour  constant uuid := 'cd6093bd-d51f-4d39-ae45-3e2984da1df4';
  v_dup    constant uuid := '8a95ddb8-4e70-454b-8702-991d8b9a2056';
  n int; refs int; prima jsonb;
begin
  -- 0. la situazione deve essere esattamente quella verificata
  perform 1 from public.ingredients where id = v_flour and name = 'Gnocchi Flour' and active;
  if not found then raise exception 'FC02 gnocchi: Gnocchi Flour non e'' nello stato atteso'; end if;
  perform 1 from public.ingredients where id = v_dup and name = 'Gnocchi Molino Pasini' and active;
  if not found then raise exception 'FC02 gnocchi: il doppione non e'' nello stato atteso'; end if;
  if exists (select 1 from public.ingredient_vendors where ingredient_id = v_flour) then
    raise exception 'FC02 gnocchi: Gnocchi Flour ha gia'' un fornitore, serve una verifica a mano';
  end if;
  select (select count(*) from public.recipe_bom where item_id = v_dup)
       + (select count(*) from public.vendor_item_aliases where ingredient_id = v_dup)
       + (select count(*) from public.unit_each_weights where ingredient_id = v_dup)
       + (select count(*) from public.incoming_order_lines where ingredient_id = v_dup)
       + (select count(*) from public.purchase_order_lines where ingredient_id = v_dup)
       + (select count(*) from public.invoice_warnings where ingredient_id = v_dup)
       + (select count(*) from public.prep_tasks where v_dup in (ingredient_id, driver_ingredient_id))
       + (select count(*) from public.office_items where ingredient_id = v_dup)
       + (select count(*) from public.chef_ai_skill_history where ingredient_id = v_dup)
       + (select count(*) from public.pos_modifier_depletion_rules where linked_ingredient_id = v_dup)
       + (select count(*) from public.ingredient_vendor_price_audit where ingredient_id = v_dup)
    into refs;
  if refs <> 0 then raise exception 'FC02 gnocchi: il doppione ha % riferimenti non previsti', refs; end if;

  select jsonb_build_object(
    'ingredient', (select to_jsonb(i) from public.ingredients i where id = v_dup),
    'ingredient_vendors', (select jsonb_agg(to_jsonb(x)) from public.ingredient_vendors x where ingredient_id = v_dup),
    'invoice_lines', (select jsonb_agg(to_jsonb(x)) from public.invoice_lines x where ingredient_id = v_dup),
    'ingredient_links', (select jsonb_agg(to_jsonb(x)) from public.ingredient_links x where ingredient_id = v_dup))
  into prima;

  -- 1. il prezzo passa a Gnocchi Flour, invariato ($74,57 / 10 kg = $0,7457 / 100 g)
  update public.ingredient_vendors set ingredient_id = v_flour, updated_at = now()
   where ingredient_id = v_dup and vendor = 'Global Gourmet Foods' and unit_price = 74.57
     and conversion_to_base = 10000;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FC02 gnocchi: ingredient_vendors %', n; end if;

  -- 2. la riga della fattura #20734 punta a Gnocchi Flour (importi invariati)
  update public.invoice_lines set ingredient_id = v_flour, updated_at = now()
   where ingredient_id = v_dup and invoice_number = '20734' and unit_price = 74.57;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FC02 gnocchi: invoice_lines %', n; end if;

  -- 3. le fatture FUTURE di questo prodotto arrivano a Gnocchi Flour
  update public.ingredient_links
     set ingredient_id = v_flour, ingredient_name = 'Gnocchi Flour', updated_at = now()
   where id = 333 and ingredient_id = v_dup;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FC02 gnocchi: ingredient_links %', n; end if;

  -- 4. il doppione resta, disattivato, con il perche'
  update public.ingredients
     set active = false, updated_at = now(),
         notes = 'FC02 29/09/2026: doppione di Gnocchi Flour (cd6093bd). E'' il preparato per '
              || 'gnocchi Molino Pasini di Global Gourmet. Prezzo, riga fattura #20734 e '
              || 'collegamento 333 trasferiti a Gnocchi Flour. Disattivato, non cancellato.'
   where id = v_dup;

  -- 5. traccia
  insert into public.ingredient_vendor_price_audit
    (ingredient_vendor_id, ingredient_id, vendor, motivo, source_document_number,
     source_invoice_date, prima, dopo, assunzioni, eseguito_da)
  select iv.id, v_flour, iv.vendor,
         'FC02 — "Gnocchi Molino Pasini" era un doppione di Gnocchi Flour (preparato per gnocchi, '
         || 'confermato da Max). Prezzo, riga fattura e collegamento trasferiti; doppione disattivato.',
         '20734', date '2026-06-16', prima,
         jsonb_build_object('ingredient_vendors', to_jsonb(iv),
           'invoice_lines', (select jsonb_agg(to_jsonb(x)) from public.invoice_lines x
                              where ingredient_id = v_flour and invoice_number = '20734'),
           'ingredient_links', (select to_jsonb(k) from public.ingredient_links k where k.id = 333),
           'ingredient_disattivato', v_dup),
         jsonb_build_object('conferma', 'Max, FC02: e'' il preparato a cui si aggiungono acqua e noce moscata',
                            'ricette_toccate', 'nessuna'),
         'Claude Code — FC02, su decisione di Max'
  from public.ingredient_vendors iv
  where iv.ingredient_id = v_flour and iv.vendor = 'Global Gourmet Foods';
end $$;

