-- XCF-PREZZI 01 — INV15B: recupero prezzo per i 3 SKU Walmart mappati il 28/09/2026.
-- DATI, non schema. Esito calcolato eseguendo in node il vero
-- vdrRecoverPriceFromInvoiceLines (commit c56c538) sui dati di produzione letti via SQL
-- (snapshot: ~/Brigade_backups/xcf-0210/prezzi/walmart_inv15b_snapshot_pre.json):
--   1536106904 Orange Juice -> created  (per_case: parser Walmart a quantita' intere)
--   44391012   Orange       -> sku_conflict (riga Walmart 78fc8995 ha SKU 5256904046): NIENTE
--   26178258   Oven Cleaner -> sku_conflict (riga Walmart b1d9ba6a ha SKU 1525746859): NIENTE
-- Unica scrittura: insert Orange Juice / Walmart Business, guardata sullo stato attuale.
insert into public.ingredient_vendors
  (ingredient_id, vendor, vendor_sku, active, unit_price, pack_description, price_type,
   conversion_to_base, price_per_100g, last_invoice_date)
select '35f6c424-e32e-4aee-931e-5191e8954965', 'Walmart Business', '1536106904', true, 4.64, null, 'per_case',
       null, null, date '2026-09-25'
where not exists (select 1 from public.ingredient_vendors
                  where ingredient_id = '35f6c424-e32e-4aee-931e-5191e8954965' and vendor = 'Walmart Business')
  and exists (select 1 from public.vendor_item_aliases
              where vendor = 'Walmart Business' and vendor_sku = '1536106904'
                and ingredient_id = '35f6c424-e32e-4aee-931e-5191e8954965' and active)
  and (select max(invoice_date) from public.invoice_lines
       where vendor = 'Walmart Business' and vendor_sku = '1536106904' and unit_price > 0) = date '2026-09-25'
  and exists (select 1 from public.invoice_lines where id = 'c9aef03b-1c8f-4c23-89de-7baa7f0df5e6'
              and unit_price = 4.64 and qty = 4 and line_total = 18.56)
returning id, ingredient_id, vendor, vendor_sku, unit_price, price_type, purchase_unit, last_invoice_date;
