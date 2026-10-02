-- CLAUDE-CLEAN0210C — correzioni Chef 02/10 (email "CORREZIONI CHEF: BRANZINO, PANCETTA").
-- Backup: ~/Brigade_backups/clean0210/before_20261002_chef7.json

do $c$
declare n int;
begin
  -- BRANZINO: Chef, il pesce acquistato pesa 2,2 lb e fa 2 filetti. Base di costo
  -- di un filetto = meta' pesce = 1,1 lb di pesce ACQUISTATO (scarto assorbito
  -- nel costo). Non e' il peso del filetto pulito. Prezzo: Fruge BRAFW8001000 al lb.
  update public.recipe_bom set quantity = 2.2, unit = 'lb',
         notes = '1 branzino acquistato da 2,2 lb (standard Chef 02/10) -> 2 filetti; scarto incluso nel costo. Non e'' il peso del filetto.'
   where bom_id = 1834 and item_id = 'a9d44760-3291-4659-bef0-999156d22a64' and quantity = 1 and unit = 'pz';
  get diagnostics n = row_count; if n <> 1 then raise exception 'Branzino: % righe', n; end if;

  -- PANCETTA: Chef, nella La N 4 il bacon entra PESATO CRUDO; la perdita avviene in
  -- padella, dentro il piatto. La prep Pancetta e' bacon crudo tagliato: 1.000 g -> 1.000 g.
  -- Il 50% vale SOLO per Bacon Crumbs (preparazione cotta). Nessun 30% USDA.
  update public.recipes set base_weight_g = 1000
   where id = '9a8dd743-b49b-4197-99f2-46faf946237e' and base_weight_g is null;
  get diagnostics n = row_count; if n <> 1 then raise exception 'Pancetta: % righe', n; end if;
end
$c$;

-- BACON CRUMBS: Chef 02/10, preparazione cotta con resa ~50% (testo ricetta "250g" da 500 g).
-- Backup: base_weight_g era NULL.
do $b$
declare n int;
begin
  update public.recipes set base_weight_g = 250
   where id = 'f3775587-3f33-4955-a338-436fa8b33787' and base_weight_g is null and yield_text = '250g';
  get diagnostics n = row_count; if n <> 1 then raise exception 'Bacon Crumbs: % righe', n; end if;
end $b$;
