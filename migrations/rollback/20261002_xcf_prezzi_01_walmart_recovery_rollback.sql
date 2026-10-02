-- Rollback XCF-PREZZI 01: toglie SOLO la riga creata, se e' ancora quella scritta
-- (nessuna fattura successiva l'ha aggiornata).
delete from public.ingredient_vendors
 where ingredient_id = '35f6c424-e32e-4aee-931e-5191e8954965' and vendor = 'Walmart Business'
   and vendor_sku = '1536106904' and unit_price = 4.64 and last_invoice_date = date '2026-09-25'
returning id;
