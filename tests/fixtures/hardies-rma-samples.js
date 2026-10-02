// XCF-HARDIES — testi reali (raw_text estratto dal PDF in storage dal
// worker) letti da vendor_documents il 02/10/2026. La coda di
// boilerplate PACA e' accorciata dove non serve al parser; le righe
// articolo, i numeri e i totali sono quelli veri.
'use strict';

// R.M.A. - #00682258 (23/09/2026), doc d93f36eb — pagina ripetuta due volte.
const RMA_00682258_PAGE = ` Dairyland Produce, LLC
(dba Hardie’s Fresh Foods)  PICK-UP SLIP  
00682258
 Hardie’s Dallas/Chefs’ Whse  DATE   09/23/26
Phone: (214) 426-5666  TRIP
Fax: (214) 380-4990  ROUTE/STOP   DA110 - 9 / 13
Accounting: (214) 247-0409  CUSTOMER CODE   ZEN102   /
Email: arsupport@hardies.com
 Remit to:
 P.O. BOX 737333, DALLAS , TX 75373-7333
 Bill to:  Ship to:
 Zeno’s On the Square  Zeno’s On the Square
 113 college ave  113 college ave
 weatherford, TX 76086  Weatherford, TX 76086
 Page   1 of 1
 817.907.6353  817.901.5008
 CRED1M0001020
06822580001
EXTENDED  RETURN
 QUANTITY   ITEM CODE   DESCRIPTION   PACK   COOL   UNIT PRICE  
AMOUNT REASON
 1   00108   ASPARAGUS LARGE   11/1#   MEX   5
 Original Sales Order: 07133808
PICK UP
 ORDER TAKER   ORDER DATE   DRIVER’S NAME   SUB TOTAL
 JEM   09/22/26   JUAN LOPEZ - DAL DRV   TAX/PCT
 SALESPERSON   CUSTOMER PO#   TERMS   TOTAL
 JEM   07 Days
 TERMS AND CONDITIONS
 REPACKS   NOTES
 Interest at 1.5% per month added to unpaid balance. Buyer agrees to pay
interest, attorneys fees, and costs necessary to collect any balance due hereunder.
 0
Interest, attorney’s fees, and costs necessary to collect any balance due hereunder
shall be considered sums owing in connection with this transaction under the  FULL CASES
PACA trust.
.
.
..  333
.
 The perishable agricultural commodities listed on this invoice are sold subject to
 WEIGHT
the statutory trust authorized by section 5(c) of the Perishable Agricultural
Commodities Act, 1930 (7 U.S.C. 499e(c)). The seller of these commodities
 5805.84
retains a trust claim over these commodities, all inventories of food or other
 TOTAL PCS CREDITED
products derived from these commodities, and any receivables or proceeds from
the sale of these commodities until full payment is received.
.
 333
. .   .
. .
.
 Credit must be taken by end of calendar year.
 CREDIT CODES
 NN= Do Not Need   SH= Short on Truck   NO= Did Not Order
OO= Over Ordered   MS= Mis-shipped   MK= Mis-keyed`;
const RMA_00682258 = RMA_00682258_PAGE + '\n' + RMA_00682258_PAGE.replace('5805.84', '5817.34').replace(/333/g, '334');

// R.M.A. - #00670731 (26/06/2026), doc fa34327c — oggi 'imported' con zero righe.
const RMA_00670731 = ` Dairyland Produce, LLC
(dba Hardie’s Fresh Foods)  PICK-UP SLIP  
00670731
 Hardie’s Dallas/Chefs’ Whse  DATE   06/26/26
Phone: (214) 426-5666  TRIP
Fax: (214) 380-4990  ROUTE/STOP   DA110 - 9 / 8
 CRED1M0001020
06707310001
EXTENDED  RETURN
 QUANTITY   ITEM CODE   DESCRIPTION   PACK   COOL   UNIT PRICE  
AMOUNT REASON
 1   29810   PASTURE RAISED LIQUID WHL EGGS   20#   ITA   2A
 Original Sales Order: 07010445
 spoiled
PICK UP
 ORDER TAKER   ORDER DATE   DRIVER’S NAME   SUB TOTAL
 JEM   06/25/26   JUAN LOPEZ - DAL DRV   TAX/PCT
 SALESPERSON   CUSTOMER PO#   TERMS   TOTAL
 JEM   07 Days
 TERMS AND CONDITIONS
 The perishable agricultural commodities listed on this invoice are sold subject to
 CREDIT CODES`;

// CREDIT - #00680317 (09/09/2026), doc b9eff17b — credito vero, gia' in vendor_credits.
const CREDIT_00680317 = `Dairyland Produce, LLC
(dba Hardie’s Fresh Foods)  CREDIT  
00680317
 Hardie’s Dallas/Chefs’ Whse  DATE   09/09/26
Phone: (214) 426-5666  TRIP
 CRED1M0001010
06803170001
EXTENDED  RETURN
 QUANTITY   ITEM CODE   DESCRIPTION   PACK   COOL   UNIT PRICE  
AMOUNT REASON
 1   03744   WHIPPING CREAM (40%) FRESH   9-1/2 GAL   USA   82.99   -82.99   1
 Original Sales Order: 07115822
 ORDER TAKER   ORDER DATE   DRIVER’S NAME   SUB TOTAL   $.00
 6JL   09/09/26   TAX/PCT   $.00
 SALESPERSON   CUSTOMER PO#   TERMS   TOTAL   $-82.99
 JEM   07 Days
 The perishable agricultural commodities listed on this invoice are sold subject to`;

// Righe reali (parsed_json.items) delle due fatture ferme in pending.
const L = (sku, description, pack, qo, qr, up, amount, warnings) =>
  ({ vendor_sku: sku, description, pack_description: pack, qty_ordered: qo, qty_received: qr, qty: qr,
     unit_price: up, amount, warnings: warnings || [] });
const W6 = (d, p) => ({ code: 'OQR-006', field: 'pack_unit', message: `Count-based: ${d} (${p}) — no weight for costing` });
const W7 = (d, o, s) => ({ code: 'OQR-007', field: 'qty_received', message: `Qty mismatch: ordered ${o}, shipped ${s} of ${d}` });

const INV_07137898 = {
  vendor: "Hardie's Fresh Foods / Dairyland Produce", document_type: 'invoice', subtotal: 575.27, total: 575.27,
  items: [
    L('01115', 'EGGS LARGE', '15 DZ', 1, 1, 13.99, 13.99, [W6('EGGS LARGE', '15 DZ')]),
    L('25618', 'CHZ MOZZ BURRATA BELGIOIOSO', '6-4/2 oz', 1, 1, 24.45, 24.45),
    L('29810', 'PASTURE RAISED LIQUID WHL EGGS', '20#', 1, 1, 78.41, 78.41),
    L('03744', 'WHIPPING CREAM (40%) FRESH', '9-1/2 GAL', 1, 1, 82.99, 82.99),
    L('71117', 'LIME #1 PERSIAN', '110 CT', 1, 1, 42.07, 42.07, [W6('LIME #1 PERSIAN', '110 CT')]),
    L('00341', 'BUTTER UNSALTED 80% GRND RESRV', '36/1#', 1, 1, 85.99, 85.99),
    L('00459', 'CARROT JUMBO', '5#', 1, 1, 4.36, 4.36),
    L('27786', 'CHZ MOZZ THIN SLICE 21 SLI/LB', '8/1#', 1, 0, 4.82, 0, [W7('CHZ MOZZ THIN SLICE 21 SLI/LB', 1, 0)]),
    L('05840', 'FLOWER MARIGOLD', '50 CT', 2, 2, 16.65, 33.3, [W6('FLOWER MARIGOLD', '50 CT')]),
    L('01296', 'HERB ARUGULA WILD B&W', '3#', 1, 1, 14.21, 14.21),
    L('01306', 'HERB BASIL', '1#', 1, 1, 9, 9),
    L('01374', 'HERB ROSEMARY', '1#', 1, 1, 9, 9),
    L('01385', 'HERB SAGE', '1#', 1, 1, 12, 12),
    L('01981', 'ORGANIC SPRING MIX', '3#', 2, 2, 12.93, 25.86),
    L('03075', 'PARSLEY FLAT ITALIAN', '6 CT', 5, 5, 3.55, 17.75, [W6('PARSLEY FLAT ITALIAN', '6 CT')]),
    L('71553', 'POTATO A SIZE YUKON GOLD', '50#', 1, 1, 38.9, 38.9),
    L('71904', 'TOMATO BEEFSTEAK RED', '16-22 CT', 1, 1, 22.63, 22.63, [W6('TOMATO BEEFSTEAK RED', '16-22 CT')]),
    L('02318', 'ONION RED MEDIUM', '25#', 1, 1, 29.88, 29.88),
    L('71898', 'SPINACH BABY', '4#', 2, 2, 15.24, 30.48),
  ],
};

const INV_07148979 = {
  vendor: "Hardie's Fresh Foods / Dairyland Produce", document_type: 'invoice', subtotal: 849.01, total: 849.01,
  items: [
    L('07673', 'TOMATO CHERRY ON THE VINE', '11#', 2, 2, 26, 52),
    L('01115', 'EGGS LARGE', '15 DZ', 1, 1, 13.99, 13.99, [W6('EGGS LARGE', '15 DZ')]),
    L('03744', 'WHIPPING CREAM (40%) FRESH', '9-1/2 GAL', 1, 1, 80.99, 80.99),
    L('71114', 'LETTUCE ROMAINE HEARTS', '12/3 CT', 1, 1, 33.16, 33.16, [W6('LETTUCE ROMAINE HEARTS', '12/3 CT')]),
    L('00254', 'BLACKBERRY', '3 CT', 1, 1, 10.43, 10.43, [W6('BLACKBERRY', '3 CT')]),
    L('00341', 'BUTTER UNSALTED 80% GRND RESRV', '36/1#', 1, 1, 85.99, 85.99),
    L('00459', 'CARROT JUMBO', '5#', 2, 2, 4.36, 8.72),
    L('00859', 'CHZ MASCARPONE BELGIOIOSO', '4/5#', 1, 1, 83.78, 83.78),
    L('13379', 'EGG LIQUID YOLK', '15/2#', 1, 1, 102.5, 102.5),
    L('05840', 'FLOWER MARIGOLD', '50 CT', 2, 0, 16.65, 0, [W7('FLOWER MARIGOLD', 2, 0), W6('FLOWER MARIGOLD', '50 CT')]),
    L('01177', 'FLOWER EDIBLE ASSORTED', '50 CT', 0, 2, 24.38, 48.76, [W7('FLOWER EDIBLE ASSORTED', 0, 2),
      { code: 'OQR-002', field: 'is_substitution', message: 'Substitution: ordered 0, received 2 of FLOWER EDIBLE ASSORTED' },
      W6('FLOWER EDIBLE ASSORTED', '50 CT')]),
    L('01296', 'HERB ARUGULA WILD B&W', '3#', 1, 1, 14.21, 14.21),
    L('01306', 'HERB BASIL', '1#', 5, 5, 9, 45),
    L('71104', 'LEMON CHOICE', '95 CT', 1, 1, 46.47, 46.47, [W6('LEMON CHOICE', '95 CT')]),
    L('01981', 'ORGANIC SPRING MIX', '3#', 2, 2, 14.51, 29.02),
    L('03075', 'PARSLEY FLAT ITALIAN', '6 CT', 5, 5, 3.55, 17.75, [W6('PARSLEY FLAT ITALIAN', '6 CT')]),
    L('06181', 'SPICE NUTMEG GROUND PENDERYS', '16 OZ', 2, 2, 16.95, 33.9),
    L('71898', 'SPINACH BABY', '4#', 3, 3, 15.24, 45.72),
    L('10068', 'WHIPPING CREAM 36% FRESH UHT', '12/1 QT', 1, 1, 73.99, 73.99),
    L('71904', 'TOMATO BEEFSTEAK RED', '16-22 CT', 1, 1, 22.63, 22.63, [W6('TOMATO BEEFSTEAK RED', '16-22 CT')]),
  ],
};

// conversion_to_base non nulli in ingredient_vendors per gli SKU sopra (02/10).
const KNOWN_CONVERSIONS = {
  '00254': { conversion_to_base: 510 }, '03075': { conversion_to_base: 600 },
  '71104': { conversion_to_base: 9500 }, '71114': { conversion_to_base: 22536 },
  '71117': { conversion_to_base: 7370 },
};

module.exports = { RMA_00682258, RMA_00670731, CREDIT_00680317, INV_07137898, INV_07148979, KNOWN_CONVERSIONS };
