-- ============================================================================
-- FC02 — Olio: convenzione dello chef 1 litro = 1 kg (PROPOSTA, non applicata)
-- ============================================================================
-- Decisione di Max (FC02): nei food cost 1 L = 1 kg. La densita' 0,916 usata
-- in GG09 non vale piu' per i nuovi calcoli.
--
-- Cosa NON cambia (la fattura originale):
--   Global Gourmet #20734 del 2026-06-16, riga "Extra Virgin Olive Oil 3/5lt
--   Seleccion Oleoestepa": qty 3, unit_price $164,00, pack 3/5LT.
-- Cosa cambia (il costo derivato):
--   grammi per cassa   13.740 (15.000 ml x 0,916)  ->  15.000 (1 L = 1 kg)
--   prezzo per 100 g   $1,1936                     ->  $1,093333
--
-- Tre righe portano il valore derivato; tutte e tre si aggiornano insieme, cosi'
-- il motore non vede un conflitto fra prezzo corrente e riga fattura:
--   ingredient_vendors  a9d48626-164a-4809-b051-da539c08595b
--   invoice_lines       fa4e8388-d056-4525-ac45-e3d1e7ef302b
--   ingredient_links    329
-- Ogni UPDATE e' condizionato ai valori attuali: se qualcuno li ha cambiati nel
-- frattempo, la transazione si ferma senza scrivere niente.
-- La conversione precedente resta tracciata: la riga GG09 in
-- ingredient_vendor_price_audit non si tocca, e se ne aggiunge una nuova.
-- ============================================================================


do $$
declare n int;
        prima_iv jsonb; prima_line jsonb; prima_link jsonb;
begin
  select to_jsonb(iv) into prima_iv from public.ingredient_vendors iv
   where id = 'a9d48626-164a-4809-b051-da539c08595b';
  select to_jsonb(l) into prima_line from public.invoice_lines l
   where id = 'fa4e8388-d056-4525-ac45-e3d1e7ef302b';
  select to_jsonb(k) into prima_link from public.ingredient_links k where id = 329;

  update public.ingredient_vendors
     set conversion_to_base = 15000, price_per_100g = 164.0 / 15000 * 100, updated_at = now()
   where id = 'a9d48626-164a-4809-b051-da539c08595b'
     and unit_price = 164 and conversion_to_base = 13740 and pack_description = '3/5LT'
     and last_invoice_date = '2026-06-16';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FC02 olio: ingredient_vendors non e'' nello stato atteso (%)', n; end if;

  update public.invoice_lines
     set cost_per_100g = round(164.0 / 15000 * 100, 4), updated_at = now()
   where id = 'fa4e8388-d056-4525-ac45-e3d1e7ef302b'
     and unit_price = 164 and qty = 3 and cost_per_100g = 1.1936 and invoice_number = '20734';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FC02 olio: invoice_lines non e'' nello stato atteso (%)', n; end if;

  update public.ingredient_links
     set conversion_g = 15000, updated_at = now()
   where id = 329 and conversion_g = 13740 and unit_price = 164;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FC02 olio: ingredient_links non e'' nello stato atteso (%)', n; end if;

  insert into public.ingredient_vendor_price_audit
    (ingredient_vendor_id, ingredient_id, vendor, motivo, source_document_number,
     source_invoice_date, prima, dopo, assunzioni, eseguito_da)
  select iv.id, iv.ingredient_id, iv.vendor,
         'FC02 — convenzione dello chef 1 L = 1 kg al posto della densita'' 0,916 (GG09). '
         || 'La fattura originale non cambia: 3 x 5 L a $164,00. Cambia solo il costo derivato.',
         '20734', date '2026-06-16',
         jsonb_build_object('ingredient_vendors', prima_iv, 'invoice_lines', prima_line,
                            'ingredient_links', prima_link),
         jsonb_build_object('ingredient_vendors', to_jsonb(iv),
           'invoice_lines', (select to_jsonb(l) from public.invoice_lines l where l.id = 'fa4e8388-d056-4525-ac45-e3d1e7ef302b'),
           'ingredient_links', (select to_jsonb(k) from public.ingredient_links k where k.id = 329)),
         jsonb_build_object(
           'fattura_originale', '#20734 del 2026-06-16: 3 x 5 L, $164,00 a cassa',
           'conversione_precedente', '15.000 ml x 0,916 g/ml = 13.740 g (GG09, densita'' assunta)',
           'conversione_nuova', '15.000 ml = 15.000 g (convenzione chef 1 L = 1 kg, FC02)',
           'prezzo_precedente_per_100g', 1.1936,
           'prezzo_nuovo_per_100g', round(164.0 / 15000 * 100, 6),
           'variazione_pct', round((164.0 / 15000 * 100 / 1.1936 - 1) * 100, 2)),
         'Claude Code — FC02, su decisione di Max'
  from public.ingredient_vendors iv where iv.id = 'a9d48626-164a-4809-b051-da539c08595b';
end $$;

