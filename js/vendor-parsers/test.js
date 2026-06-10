// ── vendor-parsers/test.js ────────────────────────────────────
// Test fixtures from real Hardie's documents
// Run: node test.js

'use strict';

const { parse, detectVendor, detectDocumentType } = require('./index');

// ── Fixture: Hardie's CONFIRMATION OF SALE 06991299 ───────────
const FIXTURE_ORDER = `
Dairyland Produce, LLC
(dba Hardie's Fresh Foods)
Hardie's Dallas/Chefs' Whse
CONFIRMATION OF SALE
INVOICE 06991299
DATE 06/06/26
CUSTOMER CODE ZEN102

QUANTITY  ITEM CODE  DESCRIPTION                   PACK      COOL  UNIT PRICE  EXTENDED AMOUNT
1         70116      BRUSSEL SPROUTS MEDIUM         25#             47.92       47.92
2         25265      CHZ MOZZ SHRED GRANDE W/M      5#              24.96       49.92
2         29810      PASTURE RAISED LIQUID WHL EGGS 20#             81.39       162.78
1         71114      LETTUCE ROMAINE HEARTS         12/3 CT         79.17       79.17
1         71117      LIME #1 PERSIAN                110 CT          60.42       60.42
1         00108      ASPARAGUS LARGE                11/1#           59.03       59.03
1         04260      AVOCADO 1 HASS                 6 CT            13.27       13.27
2         05840      FLOWER MARIGOLD                50 CT           23.44       46.88
1         71104      LEMON CHOICE                   95 CT           33.53       33.53
1         01866      WATERMELON SEEDLESS             1 CT           15.97       15.97
2         71898      SPINACH BABY                   4#              17.36       34.72
1         71904      TOMATO BEEFSTEAK RED            16-22 CT       39.02       39.02
1         22520      TOMATO HIIROS CHERRY ON VINE   8/12 OZ         39.63       39.63
1         13544      RWPR 103 RIB REF               1pc / 28#  USA  29.05       871.50

ORDER TAKER ORDER DATE  SUBTOTAL 1553.76
LC          06/05/26    TAX .00
TERMS 07 Days           TOTAL $1,553.76 INVOICE
`;

// ── Fixture: Hardie's INVOICE/POD 06991299 ───────────────────
const FIXTURE_INVOICE = `
Dairyland Produce, LLC
(dba Hardie's Fresh Foods)
INVOICE/POD 06991299
DATE/TRIP 06/06/26 / 00636804
ROUTE/STOP DA110 / 9
CUSTOMER CODE ZEN102

QUANTITY          ITEM CODE  DESCRIPTION                   PACK      UNIT PRICE  EXTENDED  ADJ
ORDERED  SHIPPED
1        1        70116      BRUSSEL SPROUTS MEDIUM         25#       47.92       47.92
2        2        25265      CHZ MOZZ SHRED GRANDE W/M      5#        24.96       49.92
2        2        29810      PASTURE RAISED LIQUID WHL EGGS 20#       81.39       162.78
1        1        71114      LETTUCE ROMAINE HEARTS         12/3 CT   79.17       79.17
1        1        71117      LIME #1 PERSIAN                110 CT    60.42       60.42
1        1        00108      ASPARAGUS LARGE                11/1#     59.03       59.03
1        1        04260      AVOCADO 1 HASS                 6 CT      13.27       13.27
2        2        05840      FLOWER MARIGOLD                50 CT     23.44       46.88
1        1        71104      LEMON CHOICE                   95 CT     33.53       33.53
1        0        01866      WATERMELON SEEDLESS            1 CT      15.97       .00
0        1        05446      WATERMELON LOCAL 1 CT          1 CT      11.81       11.81
                             SUBSTITUTION
2        2        71898      SPINACH BABY                   4#        17.36       34.72
1        1        71904      TOMATO BEEFSTEAK RED           16-22 CT  39.02       39.02
1        1        22520      TOMATO HIIROS CHERRY ON VINE   8/12 OZ   39.63       39.63
1        1        13544      RWPR 103 RIB REF               1pc / 28# 29.05       807.59

SUBTOTAL 1485.69
TAX/PCT. $.00
INVOICE $1,485.69
`;

// ── Fixture: Hardie's CREDIT 00668419 ────────────────────────
const FIXTURE_CREDIT = `
Dairyland Produce, LLC
(dba Hardie's Fresh Foods)
CREDIT 00668419
DATE 06/06/26
ROUTE/STOP DA110 - 9 / 9
CUSTOMER CODE ZEN102

QUANTITY  ITEM CODE  DESCRIPTION            PACK  COOL  UNIT PRICE  EXTENDED  RETURN REASON
2         25265      CHZ MOZZ SHRED GRANDE W/M  5#  USA  24.96      -49.92    5A
Original Sales Order: 06991299

TOTAL $-49.92
`;

// ── Run tests ─────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition, label, got) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`, got !== undefined ? `→ got: ${JSON.stringify(got)}` : '');
    failed++;
  }
}

console.log('\n═══ TEST: Vendor Detection ═══');
assert(detectVendor(FIXTURE_ORDER)   === 'hardies', 'order → hardies');
assert(detectVendor(FIXTURE_INVOICE) === 'hardies', 'invoice → hardies');
assert(detectVendor(FIXTURE_CREDIT)  === 'hardies', 'credit → hardies');
assert(detectDocumentType(FIXTURE_ORDER)   === 'order_confirmation', 'order type', detectDocumentType(FIXTURE_ORDER));
assert(detectDocumentType(FIXTURE_INVOICE) === 'invoice',            'invoice type', detectDocumentType(FIXTURE_INVOICE));
assert(detectDocumentType(FIXTURE_CREDIT)  === 'credit_memo',        'credit type', detectDocumentType(FIXTURE_CREDIT));

console.log('\n═══ TEST: Order Confirmation 06991299 ═══');
const order = parse(FIXTURE_ORDER);
assert(order.document_type   === 'order_confirmation', 'document_type');
assert(order.order_number    === '06991299',           'order_number', order.order_number);
assert(order.order_date      === '2026-06-06',         'order_date',   order.order_date);
assert(order.total           === 1553.76,              'total',        order.total);
assert(order.items.length    >= 13,                    'item count >= 13', order.items.length);

const rwpr = order.items.find(i => i.vendor_sku === '13544');
assert(!!rwpr,                                          'RWPR 103 found');
assert(rwpr?.pack_description?.includes('28'),          'RWPR pack has 28', rwpr?.pack_description);
assert(rwpr?.unit_price === 29.05,                      'RWPR unit_price', rwpr?.unit_price);
assert(rwpr?.amount     === 871.50,                     'RWPR amount',     rwpr?.amount);
assert(rwpr?.origin     === 'USA',                      'RWPR origin USA', rwpr?.origin);

const lime = order.items.find(i => i.vendor_sku === '71117');
assert(lime?.pack_description?.includes('110'),         'LIME 110 CT pack', lime?.pack_description);
assert(lime?.warnings?.some(w=>w.code==='OQR-006'),     'LIME has OQR-006 count warning');

console.log('\n═══ TEST: Invoice 06991299 ═══');
const invoice = parse(FIXTURE_INVOICE);
assert(invoice.document_type    === 'invoice',   'document_type');
assert(invoice.order_number     === '06991299',  'order_number', invoice.order_number);
assert(invoice.items.length     >= 13,           'item count >= 13', invoice.items.length);
assert(invoice.total            === 1485.69,     'total', invoice.total);

const waterSeedless = invoice.items.find(i => i.vendor_sku === '01866');
assert(waterSeedless?.qty_ordered  === 1, 'watermelon seedless ordered=1', waterSeedless?.qty_ordered);
assert(waterSeedless?.qty_received === 0, 'watermelon seedless shipped=0', waterSeedless?.qty_received);
assert(waterSeedless?.warnings?.some(w=>w.code==='OQR-007'), 'watermelon has OQR-007 mismatch');

const waterLocal = invoice.items.find(i => i.vendor_sku === '05446');
assert(waterLocal?.is_substitution === true, 'watermelon local is substitution', waterLocal?.is_substitution);
assert(waterLocal?.warnings?.some(w=>w.code==='OQR-002'), 'watermelon local has OQR-002');

const spinach = invoice.items.find(i => i.vendor_sku === '71898');
assert(spinach?.is_substitution === false, 'spinach baby NOT substitution', spinach?.is_substitution);
assert(!spinach?.warnings?.some(w=>w.code==='OQR-002'), 'spinach baby has NO OQR-002');

// Pack fields populated
const mozzOrder = order.items.find(i => i.vendor_sku === '25265');
assert(mozzOrder?.pack_size_each === 5, 'mozz pack_size_each=5 (5# bag)', mozzOrder?.pack_size_each);
assert(mozzOrder?.pack_unit === 'lb', 'mozz pack_unit=lb', mozzOrder?.pack_unit);
const limeOrder = order.items.find(i => i.vendor_sku === '71117');
assert(limeOrder?.pack_size_each === 110, 'lime pack_size_each=110', limeOrder?.pack_size_each);
assert(limeOrder?.pack_unit === 'ct', 'lime pack_unit=ct', limeOrder?.pack_unit);
const cherry = order.items.find(i => i.vendor_sku === '22520');
assert(cherry?.pack_qty === 8, 'cherry tomato pack_qty=8', cherry?.pack_qty);
assert(cherry?.pack_unit === 'oz', 'cherry tomato pack_unit=oz', cherry?.pack_unit);

console.log('\n═══ TEST: Credit 00668419 ═══');
const credit = parse(FIXTURE_CREDIT);
assert(credit.document_type        === 'credit_memo', 'document_type');
assert(credit.credit_number        === '00668419',    'credit_number', credit.credit_number);
assert(credit.original_order_number === '06991299',   'original_order', credit.original_order_number);
assert(credit.total                === -49.92,        'total negative', credit.total);
assert(credit.items.length         === 1,             'item count=1', credit.items.length);
assert(credit.items[0].return_code === '5A',          'return code 5A', credit.items[0].return_code);
assert(credit.items[0].amount      === -49.92,        'amount negative', credit.items[0].amount);
assert(!credit.warnings.some(w=>w.code==='OQR-001'),  'no OQR-001 (original order found)');

console.log(`\n${'═'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (!failed) console.log('✅ All tests passed');
else process.exit(1);
