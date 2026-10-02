-- XCF-GG 03 — STORICO Global Gourmet in MODALITA' STORICA ISOLATA.
--
-- NON ESEGUIRE PRIMA del deploy di vendor-doc-auto-import con XCF-GG:
-- il worker vecchio ignora historical_mode e scriverebbe i prezzi del
-- 2022/2025 in ingredient_vendors (es. Canned Tomatoes ha
-- last_invoice_date NULL, la cronologia non lo proteggerebbe).
--
-- Tre fatture di carta, mai entrate: #19563 (31/03/2026), #15814
-- (17/06/2025), #7186 (20/12/2022). Verificato il 02/10: nessun
-- vendor_documents e nessuna invoice_lines con questi numeri.
-- Si inseriscono 'pending' con parsed_json.historical_mode = true: Phase B
-- le importa scrivendo SOLO invoice_lines con la data originale. Nessun
-- prezzo corrente cambia. Il guard WM01 rifiuta un secondo import.
-- Generato da gen-storico.js sui testi OCR reali in tests/fixtures/global-gourmet.
begin;

insert into public.vendor_documents (vendor, document_type, document_number, document_date, delivery_date, status, uploaded_by, raw_text, parsed_json, warnings)
select 'Global Gourmet Foods', 'invoice', '19563', date '2026-03-31', date '2026-03-31', 'pending', 'manual-photo (XCF-GG storico)',
       'GLOBAL GOURMET FOODS, LLC
1358 SALDFORD DR
HOUSTON, TX 77008 Invoice
ODS
Date 78
COURMET FOODS Invoice #
76
3/31/2026
19563 36
37
Ship To
ZENO''S ON THE SQUARE
SON THE SQUARE
ollege AvC. 102 Houston
herford, TX 76086 Ave.
Weatherford, TX 76086
P.O. Number Terms Rep Ship Via F.O.B. Project
Net 15 MC 3/31/2026
Quantity U/M
Description Price EA / CS / LBS Amount
CS Italian Peeled Tomatoes 6#10 "La Carmela" 35.00 3cs 105.00
3 CS Extra Virgin Olive Oil 3/5lt Seleccion "Oleoestepa" 164.00 3cs 492.00
2 ea Gnocchi C-Catering 10kg. "Molino Pasini" 74.57 2ea 149.14
12.04 1b Bresaola 4/3lb "Bernina" 20.48 1cs 246.58
5.63 Pecorino Toscano Fresco DOP 2pc/cs "Monti Trentini" 12.98 1ca 73.08
ca Sea Salt Coarse 12.5kg "Antica Salina" 28.50 3ea 85.50
CS Carnaroli Rice 10/1kg "Didonato" 45.00 1cs 45.00
Thankyou foryour business.
Phone # E-mail
Total $1,196.30
orders@ggourmetfoods.com', '{"vendor":"Global Gourmet Foods","document_type":"invoice","document_number":"19563","invoice_number":"19563","document_date":"2026-03-31","invoice_date":"2026-03-31","subtotal":1196.3,"total":1196.3,"items":[{"line_type":"product","vendor_sku":null,"description":"Italian Peeled Tomatoes 6#10 \"La Carmela\"","raw_description":"Italian Peeled Tomatoes 6#10 \"La Carmela\"","qty":3,"purchase_unit":"cs","uom_source":"U/M","unit_price":35,"amount":105,"ea_cs_lbs":"3cs","qty_source":"derived","pack_description":null,"warnings":[{"code":"GG_QTY_DERIVED","severity":"info","message":"Italian Peeled Tomatoes 6#10 \"La Carmela\": quantita'' non letta dall''OCR, ricavata da 105 / 35 = 3"}]},{"line_type":"product","vendor_sku":null,"description":"Extra Virgin Olive Oil 3/5lt Seleccion \"Oleoestepa\"","raw_description":"Extra Virgin Olive Oil 3/5lt Seleccion \"Oleoestepa\"","qty":3,"purchase_unit":"cs","uom_source":"U/M","unit_price":164,"amount":492,"ea_cs_lbs":"3cs","qty_source":"read","pack_description":null,"warnings":[]},{"line_type":"product","vendor_sku":null,"description":"Gnocchi C-Catering 10kg. \"Molino Pasini\"","raw_description":"Gnocchi C-Catering 10kg. \"Molino Pasini\"","qty":2,"purchase_unit":"ea","uom_source":"U/M","unit_price":74.57,"amount":149.14,"ea_cs_lbs":"2ea","qty_source":"read","pack_description":null,"warnings":[]},{"line_type":"product","vendor_sku":null,"description":"Bresaola 4/3lb \"Bernina\"","raw_description":"Bresaola 4/3lb \"Bernina\"","qty":12.04,"purchase_unit":"lb","uom_source":"U/M","unit_price":20.48,"amount":246.58,"ea_cs_lbs":"1cs","qty_source":"read","pack_description":null,"warnings":[],"cost_per_lb":20.48,"price_type":"per_lb"},{"line_type":"product","vendor_sku":null,"description":"Pecorino Toscano Fresco DOP 2pc/cs \"Monti Trentini\"","raw_description":"Pecorino Toscano Fresco DOP 2pc/cs \"Monti Trentini\"","qty":5.63,"purchase_unit":"lb","uom_source":"inferred_weight","unit_price":12.98,"amount":73.08,"ea_cs_lbs":"1ca","qty_source":"read","pack_description":null,"warnings":[{"code":"GG_UOM_INFERRED","severity":"info","message":"Pecorino Toscano Fresco DOP 2pc/cs \"Monti Trentini\": U/M non letta, quantita'' 5.63 frazionaria → lb"}],"cost_per_lb":12.98,"price_type":"per_lb"},{"line_type":"product","vendor_sku":null,"description":"Sea Salt Coarse 12.5kg \"Antica Salina\"","raw_description":"Sea Salt Coarse 12.5kg \"Antica Salina\"","qty":3,"purchase_unit":"ea","uom_source":"U/M","unit_price":28.5,"amount":85.5,"ea_cs_lbs":"3ea","qty_source":"derived","pack_description":null,"warnings":[{"code":"GG_QTY_DERIVED","severity":"info","message":"Sea Salt Coarse 12.5kg \"Antica Salina\": quantita'' non letta dall''OCR, ricavata da 85.5 / 28.5 = 3"}]},{"line_type":"product","vendor_sku":null,"description":"Carnaroli Rice 10/1kg \"Didonato\"","raw_description":"Carnaroli Rice 10/1kg \"Didonato\"","qty":1,"purchase_unit":"cs","uom_source":"U/M","unit_price":45,"amount":45,"ea_cs_lbs":"1cs","qty_source":"derived","pack_description":null,"warnings":[{"code":"GG_QTY_DERIVED","severity":"info","message":"Carnaroli Rice 10/1kg \"Didonato\": quantita'' non letta dall''OCR, ricavata da 45 / 45 = 1"}]}],"copies_read":1,"pages":1,"lines_sum":1196.3,"warnings":[],"source":"photo_ocr_historical","historical_mode":true,"storage_path":"invoices/manual/1790629853000_GlobalGourmet_pacchetto_4_fatture.pdf","ocr_text":"GLOBAL GOURMET FOODS, LLC\n1358 SALDFORD DR\nHOUSTON, TX 77008 Invoice\nODS\nDate 78\nCOURMET FOODS Invoice #\n76\n3/31/2026\n19563 36\n37\nShip To\nZENO''S ON THE SQUARE\nSON THE SQUARE\nollege AvC. 102 Houston\nherford, TX 76086 Ave.\nWeatherford, TX 76086\nP.O. Number Terms Rep Ship Via F.O.B. Project\nNet 15 MC 3/31/2026\nQuantity U/M\nDescription Price EA / CS / LBS Amount\nCS Italian Peeled Tomatoes 6#10 \"La Carmela\" 35.00 3cs 105.00\n3 CS Extra Virgin Olive Oil 3/5lt Seleccion \"Oleoestepa\" 164.00 3cs 492.00\n2 ea Gnocchi C-Catering 10kg. \"Molino Pasini\" 74.57 2ea 149.14\n12.04 1b Bresaola 4/3lb \"Bernina\" 20.48 1cs 246.58\n5.63 Pecorino Toscano Fresco DOP 2pc/cs \"Monti Trentini\" 12.98 1ca 73.08\nca Sea Salt Coarse 12.5kg \"Antica Salina\" 28.50 3ea 85.50\nCS Carnaroli Rice 10/1kg \"Didonato\" 45.00 1cs 45.00\nThankyou foryour business.\nPhone # E-mail\nTotal $1,196.30\norders@ggourmetfoods.com","ocr_engine":"apple-vision-dev (foto originale, verificata a vista)","provenance":{"file":"Global_Gourmet_4_original_invoices_Brigade.pdf","pagina_pacchetto":3,"metodo":"OCR della foto originale + parser global-gourmet.js, righe verificate contro la foto","task":"XCF-GG"}}'::jsonb, '[]'::jsonb
 where not exists (select 1 from public.vendor_documents where vendor = 'Global Gourmet Foods' and document_type = 'invoice' and document_number = '19563')
   and not exists (select 1 from public.invoice_lines where vendor = 'Global Gourmet Foods' and invoice_number = '19563');
-- #19563: 7 righe, totale 1196.3

insert into public.vendor_documents (vendor, document_type, document_number, document_date, delivery_date, status, uploaded_by, raw_text, parsed_json, warnings)
select 'Global Gourmet Foods', 'invoice', '15814', date '2025-06-17', date '2025-06-17', 'pending', 'manual-photo (XCF-GG storico)',
       'ngreement
beavatla
US
al.co GLOBAL GOURMET FOODS, LLC Invoice
GG 1358 SALDEOR DR
HOUSTON, IX77008 Date Invoice#
FOODS 6/17/2025 15814
GLOBAL GOURMET FOODS
Ship To
Bill To
ZENO''S ON THE SQUARE ZENO''S ON THE SQUARE
102 Houston Ave,
102 Houston Ave. Weatherford, TX 76086
Weatherford, TX 76086
P.O. Number Terms Rep Ship Via F.O.B. Project
Net 15 MC 6/17/2025
Quantity U/M Description Price EA / CS / LBS Amount
4 ea Semola di Grano Duro 25kg. "Molino Pasini" 69.50 4ea 278.00
3 ea Gnocchi C-Catering 10kg. "Molino Pasini" 74.57 3ea 223.71
19.92 lb Prosciutto Italiano Mattonella 2/101b "San Michele" 11.00 2ea 219.12
CS Extra Virgin Olive Oil 3/5lt "Seleccion "Oleoestepa" 165.50 6cs 993.00
CS Italian Peeled Tomatoes 6#10 "La Carmela" 34.00 6cs 204.00
CS Artichokes Long Steam 6/2.5kg. "Gervasio" 125.00 1cs 125.00
cS Carnaroli Rice 10/1kg "Didonato" 45.00 1cs 45.00
15.62 Pecorino Romano 1/4 "Monti Trentini" 9.75 1ca 152.30
8.91 lb Pecorino Toscano Fresco D.O.P. 2pc/cs "Monti 10.98 2ea 97.83
CS Balsamic Glaze Aged 12/500ml "Fondo Montebello" 78.00 1cs 78.00
Phone #
E-mail
(469) 676 8300
maguirre@selectedfoods.com Total
$2,415.96', '{"vendor":"Global Gourmet Foods","document_type":"invoice","document_number":"15814","invoice_number":"15814","document_date":"2025-06-17","invoice_date":"2025-06-17","subtotal":2415.96,"total":2415.96,"items":[{"line_type":"product","vendor_sku":null,"description":"Semola di Grano Duro 25kg. \"Molino Pasini\"","raw_description":"Semola di Grano Duro 25kg. \"Molino Pasini\"","qty":4,"purchase_unit":"ea","uom_source":"U/M","unit_price":69.5,"amount":278,"ea_cs_lbs":"4ea","qty_source":"read","pack_description":null,"warnings":[]},{"line_type":"product","vendor_sku":null,"description":"Gnocchi C-Catering 10kg. \"Molino Pasini\"","raw_description":"Gnocchi C-Catering 10kg. \"Molino Pasini\"","qty":3,"purchase_unit":"ea","uom_source":"U/M","unit_price":74.57,"amount":223.71,"ea_cs_lbs":"3ea","qty_source":"read","pack_description":null,"warnings":[]},{"line_type":"product","vendor_sku":null,"description":"Prosciutto Italiano Mattonella 2/101b \"San Michele\"","raw_description":"Prosciutto Italiano Mattonella 2/101b \"San Michele\"","qty":19.92,"purchase_unit":"lb","uom_source":"U/M","unit_price":11,"amount":219.12,"ea_cs_lbs":"2ea","qty_source":"read","pack_description":null,"warnings":[],"cost_per_lb":11,"price_type":"per_lb"},{"line_type":"product","vendor_sku":null,"description":"Extra Virgin Olive Oil 3/5lt \"Seleccion \"Oleoestepa\"","raw_description":"Extra Virgin Olive Oil 3/5lt \"Seleccion \"Oleoestepa\"","qty":6,"purchase_unit":"cs","uom_source":"U/M","unit_price":165.5,"amount":993,"ea_cs_lbs":"6cs","qty_source":"derived","pack_description":null,"warnings":[{"code":"GG_QTY_DERIVED","severity":"info","message":"Extra Virgin Olive Oil 3/5lt \"Seleccion \"Oleoestepa\": quantita'' non letta dall''OCR, ricavata da 993 / 165.5 = 6"}]},{"line_type":"product","vendor_sku":null,"description":"Italian Peeled Tomatoes 6#10 \"La Carmela\"","raw_description":"Italian Peeled Tomatoes 6#10 \"La Carmela\"","qty":6,"purchase_unit":"cs","uom_source":"U/M","unit_price":34,"amount":204,"ea_cs_lbs":"6cs","qty_source":"derived","pack_description":null,"warnings":[{"code":"GG_QTY_DERIVED","severity":"info","message":"Italian Peeled Tomatoes 6#10 \"La Carmela\": quantita'' non letta dall''OCR, ricavata da 204 / 34 = 6"}]},{"line_type":"product","vendor_sku":null,"description":"Artichokes Long Steam 6/2.5kg. \"Gervasio\"","raw_description":"Artichokes Long Steam 6/2.5kg. \"Gervasio\"","qty":1,"purchase_unit":"cs","uom_source":"U/M","unit_price":125,"amount":125,"ea_cs_lbs":"1cs","qty_source":"derived","pack_description":null,"warnings":[{"code":"GG_QTY_DERIVED","severity":"info","message":"Artichokes Long Steam 6/2.5kg. \"Gervasio\": quantita'' non letta dall''OCR, ricavata da 125 / 125 = 1"}]},{"line_type":"product","vendor_sku":null,"description":"Carnaroli Rice 10/1kg \"Didonato\"","raw_description":"Carnaroli Rice 10/1kg \"Didonato\"","qty":1,"purchase_unit":"cs","uom_source":"U/M","unit_price":45,"amount":45,"ea_cs_lbs":"1cs","qty_source":"derived","pack_description":null,"warnings":[{"code":"GG_QTY_DERIVED","severity":"info","message":"Carnaroli Rice 10/1kg \"Didonato\": quantita'' non letta dall''OCR, ricavata da 45 / 45 = 1"}]},{"line_type":"product","vendor_sku":null,"description":"Pecorino Romano 1/4 \"Monti Trentini\"","raw_description":"Pecorino Romano 1/4 \"Monti Trentini\"","qty":15.62,"purchase_unit":"lb","uom_source":"inferred_weight","unit_price":9.75,"amount":152.3,"ea_cs_lbs":"1ca","qty_source":"read","pack_description":null,"warnings":[{"code":"GG_UOM_INFERRED","severity":"info","message":"Pecorino Romano 1/4 \"Monti Trentini\": U/M non letta, quantita'' 15.62 frazionaria → lb"}],"cost_per_lb":9.75,"price_type":"per_lb"},{"line_type":"product","vendor_sku":null,"description":"Pecorino Toscano Fresco D.O.P. 2pc/cs \"Monti","raw_description":"Pecorino Toscano Fresco D.O.P. 2pc/cs \"Monti","qty":8.91,"purchase_unit":"lb","uom_source":"U/M","unit_price":10.98,"amount":97.83,"ea_cs_lbs":"2ea","qty_source":"read","pack_description":null,"warnings":[],"cost_per_lb":10.98,"price_type":"per_lb"},{"line_type":"product","vendor_sku":null,"description":"Balsamic Glaze Aged 12/500ml \"Fondo Montebello\"","raw_description":"Balsamic Glaze Aged 12/500ml \"Fondo Montebello\"","qty":1,"purchase_unit":"cs","uom_source":"U/M","unit_price":78,"amount":78,"ea_cs_lbs":"1cs","qty_source":"derived","pack_description":null,"warnings":[{"code":"GG_QTY_DERIVED","severity":"info","message":"Balsamic Glaze Aged 12/500ml \"Fondo Montebello\": quantita'' non letta dall''OCR, ricavata da 78 / 78 = 1"}]}],"copies_read":1,"pages":1,"lines_sum":2415.96,"warnings":[],"source":"photo_ocr_historical","historical_mode":true,"storage_path":"invoices/manual/1790629853000_GlobalGourmet_pacchetto_4_fatture.pdf","ocr_text":"ngreement\nbeavatla\nUS\nal.co GLOBAL GOURMET FOODS, LLC Invoice\nGG 1358 SALDEOR DR\nHOUSTON, IX77008 Date Invoice#\nFOODS 6/17/2025 15814\nGLOBAL GOURMET FOODS\nShip To\nBill To\nZENO''S ON THE SQUARE ZENO''S ON THE SQUARE\n102 Houston Ave,\n102 Houston Ave. Weatherford, TX 76086\nWeatherford, TX 76086\nP.O. Number Terms Rep Ship Via F.O.B. Project\nNet 15 MC 6/17/2025\nQuantity U/M Description Price EA / CS / LBS Amount\n4 ea Semola di Grano Duro 25kg. \"Molino Pasini\" 69.50 4ea 278.00\n3 ea Gnocchi C-Catering 10kg. \"Molino Pasini\" 74.57 3ea 223.71\n19.92 lb Prosciutto Italiano Mattonella 2/101b \"San Michele\" 11.00 2ea 219.12\nCS Extra Virgin Olive Oil 3/5lt \"Seleccion \"Oleoestepa\" 165.50 6cs 993.00\nCS Italian Peeled Tomatoes 6#10 \"La Carmela\" 34.00 6cs 204.00\nCS Artichokes Long Steam 6/2.5kg. \"Gervasio\" 125.00 1cs 125.00\ncS Carnaroli Rice 10/1kg \"Didonato\" 45.00 1cs 45.00\n15.62 Pecorino Romano 1/4 \"Monti Trentini\" 9.75 1ca 152.30\n8.91 lb Pecorino Toscano Fresco D.O.P. 2pc/cs \"Monti 10.98 2ea 97.83\nCS Balsamic Glaze Aged 12/500ml \"Fondo Montebello\" 78.00 1cs 78.00\nPhone #\nE-mail\n(469) 676 8300\nmaguirre@selectedfoods.com Total\n$2,415.96","ocr_engine":"apple-vision-dev (foto originale, verificata a vista)","provenance":{"file":"Global_Gourmet_4_original_invoices_Brigade.pdf","pagina_pacchetto":4,"metodo":"OCR della foto originale + parser global-gourmet.js, righe verificate contro la foto","task":"XCF-GG"}}'::jsonb, '[]'::jsonb
 where not exists (select 1 from public.vendor_documents where vendor = 'Global Gourmet Foods' and document_type = 'invoice' and document_number = '15814')
   and not exists (select 1 from public.invoice_lines where vendor = 'Global Gourmet Foods' and invoice_number = '15814');
-- #15814: 10 righe, totale 2415.96

insert into public.vendor_documents (vendor, document_type, document_number, document_date, delivery_date, status, uploaded_by, raw_text, parsed_json, warnings)
select 'Global Gourmet Foods', 'invoice', '7186', date '2022-12-20', date '2022-12-20', 'pending', 'manual-photo (XCF-GG storico)',
       'Invoice
GLOBAL GOURMET FOODS, LLC
GG 7207 B Wynnwood Ln.
Date Invoice #
Houston, Texas 77008
FOODS 12/20/2022 7186
CLOBAL GOURMET FOODS Global
Bill To Ship To
ZENO''S ON THE SQUARE ZENO''S ON THE SQUARE
102 Houston Ave,
102 Houston Ave. obirme
Weatherford, TX 76086 Weatherford, TX 76086
SpRry
P.O. Number Terms Rep Ship Via F.O.B. Project
Net 15 MC 12/20/2022 Delivery
Quantity U/M Description Price Each EA / CS / LBS Amount
cs Extra Virgin Olive Oil 4/1gl. "Oleoforum" 99.00 2cs 198.00
ca Molino Paisini Gnocchi C Catering 1/10Kilo "Molino 74.57 1ea 74.57
Pasini"
3.67 lb Coppa Italiana 2/3.5lb "Maestri D''Italia" 11.92 lea 43.75
12.26 lb Prosciutto Italiano Mattonella 1/11lb "Martelli" 11.00 lea 134.86
4.84 lb Toscano Jumbo 5pc/cs "Molinari" 8.99 lea 43.51
0.5 cS Riso Carnaroli "Curtiriso" 10/1kg 51.00 5ea 25.50
Grazie Mille!
(469) 676 8300 orders@ggourmetfoods.com Total $520.19', '{"vendor":"Global Gourmet Foods","document_type":"invoice","document_number":"7186","invoice_number":"7186","document_date":"2022-12-20","invoice_date":"2022-12-20","subtotal":520.19,"total":520.19,"items":[{"line_type":"product","vendor_sku":null,"description":"Extra Virgin Olive Oil 4/1gl. \"Oleoforum\"","raw_description":"Extra Virgin Olive Oil 4/1gl. \"Oleoforum\"","qty":2,"purchase_unit":"cs","uom_source":"U/M","unit_price":99,"amount":198,"ea_cs_lbs":"2cs","qty_source":"derived","pack_description":null,"warnings":[{"code":"GG_QTY_DERIVED","severity":"info","message":"Extra Virgin Olive Oil 4/1gl. \"Oleoforum\": quantita'' non letta dall''OCR, ricavata da 198 / 99 = 2"}]},{"line_type":"product","vendor_sku":null,"description":"Molino Paisini Gnocchi C Catering 1/10Kilo \"Molino Pasini\"","raw_description":"Molino Paisini Gnocchi C Catering 1/10Kilo \"Molino Pasini\"","qty":1,"purchase_unit":"ea","uom_source":"U/M","unit_price":74.57,"amount":74.57,"ea_cs_lbs":"1ea","qty_source":"derived","pack_description":null,"warnings":[{"code":"GG_QTY_DERIVED","severity":"info","message":"Molino Paisini Gnocchi C Catering 1/10Kilo \"Molino Pasini\": quantita'' non letta dall''OCR, ricavata da 74.57 / 74.57 = 1"}]},{"line_type":"product","vendor_sku":null,"description":"Coppa Italiana 2/3.5lb \"Maestri D''Italia\"","raw_description":"Coppa Italiana 2/3.5lb \"Maestri D''Italia\"","qty":3.67,"purchase_unit":"lb","uom_source":"U/M","unit_price":11.92,"amount":43.75,"ea_cs_lbs":"lea","qty_source":"read","pack_description":null,"warnings":[],"cost_per_lb":11.92,"price_type":"per_lb"},{"line_type":"product","vendor_sku":null,"description":"Prosciutto Italiano Mattonella 1/11lb \"Martelli\"","raw_description":"Prosciutto Italiano Mattonella 1/11lb \"Martelli\"","qty":12.26,"purchase_unit":"lb","uom_source":"U/M","unit_price":11,"amount":134.86,"ea_cs_lbs":"lea","qty_source":"read","pack_description":null,"warnings":[],"cost_per_lb":11,"price_type":"per_lb"},{"line_type":"product","vendor_sku":null,"description":"Toscano Jumbo 5pc/cs \"Molinari\"","raw_description":"Toscano Jumbo 5pc/cs \"Molinari\"","qty":4.84,"purchase_unit":"lb","uom_source":"U/M","unit_price":8.99,"amount":43.51,"ea_cs_lbs":"lea","qty_source":"read","pack_description":null,"warnings":[],"cost_per_lb":8.99,"price_type":"per_lb"},{"line_type":"product","vendor_sku":null,"description":"Riso Carnaroli \"Curtiriso\" 10/1kg","raw_description":"Riso Carnaroli \"Curtiriso\" 10/1kg","qty":0.5,"purchase_unit":"cs","uom_source":"U/M","unit_price":51,"amount":25.5,"ea_cs_lbs":"5ea","qty_source":"read","pack_description":null,"warnings":[]}],"copies_read":1,"pages":1,"lines_sum":520.19,"warnings":[],"source":"photo_ocr_historical","historical_mode":true,"storage_path":"invoices/manual/1790629853000_GlobalGourmet_pacchetto_4_fatture.pdf","ocr_text":"Invoice\nGLOBAL GOURMET FOODS, LLC\nGG 7207 B Wynnwood Ln.\nDate Invoice #\nHouston, Texas 77008\nFOODS 12/20/2022 7186\nCLOBAL GOURMET FOODS Global\nBill To Ship To\nZENO''S ON THE SQUARE ZENO''S ON THE SQUARE\n102 Houston Ave,\n102 Houston Ave. obirme\nWeatherford, TX 76086 Weatherford, TX 76086\nSpRry\nP.O. Number Terms Rep Ship Via F.O.B. Project\nNet 15 MC 12/20/2022 Delivery\nQuantity U/M Description Price Each EA / CS / LBS Amount\ncs Extra Virgin Olive Oil 4/1gl. \"Oleoforum\" 99.00 2cs 198.00\nca Molino Paisini Gnocchi C Catering 1/10Kilo \"Molino 74.57 1ea 74.57\nPasini\"\n3.67 lb Coppa Italiana 2/3.5lb \"Maestri D''Italia\" 11.92 lea 43.75\n12.26 lb Prosciutto Italiano Mattonella 1/11lb \"Martelli\" 11.00 lea 134.86\n4.84 lb Toscano Jumbo 5pc/cs \"Molinari\" 8.99 lea 43.51\n0.5 cS Riso Carnaroli \"Curtiriso\" 10/1kg 51.00 5ea 25.50\nGrazie Mille!\n(469) 676 8300 orders@ggourmetfoods.com Total $520.19","ocr_engine":"apple-vision-dev (foto originale, verificata a vista)","provenance":{"file":"Global_Gourmet_4_original_invoices_Brigade.pdf","pagina_pacchetto":5,"metodo":"OCR della foto originale + parser global-gourmet.js, righe verificate contro la foto","task":"XCF-GG"}}'::jsonb, '[]'::jsonb
 where not exists (select 1 from public.vendor_documents where vendor = 'Global Gourmet Foods' and document_type = 'invoice' and document_number = '7186')
   and not exists (select 1 from public.invoice_lines where vendor = 'Global Gourmet Foods' and invoice_number = '7186');
-- #7186: 6 righe, totale 520.19

commit;
