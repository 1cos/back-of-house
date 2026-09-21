// ══════════════════════════════════════════════════════════════════
// INV07 — i CINQUE corpi reali delle order confirmation FreshPoint
// della finestra 2026-06-01 → 2026-09-20, copiati verbatim da Gmail
// (msg.getPlainBody()). Non sono ricostruzioni: sono la sorgente.
//
// Servono a due cose: provare che il parser e' deterministico su dati
// veri, e congelare la forma, cosi' se FreshPoint cambia template i
// test se ne accorgono invece di lasciarlo scoprire alla produzione.
// ══════════════════════════════════════════════════════════════════

const SAMPLES = [
  { number: '19464295', date: '2026-06-04', total: 145.43, items: 7,  qty: 7,  body: `| | |
| |
| |

| |
| Order Confirmation | Reference #19464295 |

| |

| |

| |
| Shipping Address | Distribution Center |
| ZENO'S ON THE SQUARE 113 COLLEGE AVE WEATHERFORD, TX 760864467 (817) 757-7552 massimiliano.zubboli@gmail.com[](massimiliano.zubboli@gmail.com) | FreshPoint Dallas 4721 Simonton Road Dallas, TX 75244 (972) 385-5880 107-Sales-CustSrvc-DL@freshpoint.com [](107-Sales-CustSrvc-DL@freshpoint.com) |

| |
| Customer Number |
| 3930 |
| Order Placed By |
| AMR3930 |

| |
| Order Date/Time | Delivery Date | Purchase Order | Special Message |
| 06/04/2026 12:47 PM | Friday 06/05/2026 | N/A | N/A |

| |

| |
| Item# | Product | Size | Qty | Price | Ext.P |
| 921068 | LETTUCE ONECUT SPRING MIX TRUEMIX LOC TX | 3/2# CS | 1 | 33.95 | 33.95 |
| 7038 | TOMATOES CLUSTER CHERRY TOV 11# LOC TX | 11# BX | 1 | 27.15 | 27.15 |
| 21456 | ARUGULA BABY WILD B W 2/1.5# | 2/1.5# BOX | 1 | 16.65 | 16.65 |
| 11148 | POTATOES YUKON GOLD A #1 50# | 50# BX | 1 | 35.35 | 35.35 |
| 3970 | HERB BASIL SWEET 1# | 1# BG | 1 | 8.75 | 8.75 |
| 918 | BLACKBERRIES 2CT(R) | 2 CT BX | 1 | 11.95 | 11.95 |
| 16630 | MELONS CANTALOUPE 3CT(R) | 3 CT BOX | 1 | 11.63 | 11.63 |

| |

| |

| Order Summary | |
| Items | 7 | Quantity | 7 | Total | 145.43 |

| |

| |
| THANK YOU FOR CHOOSING FRESHPOINT For questions regarding this order or to make changes please call FreshPoint Dallas at (972) 385-5880 · This is not an invoice. · Product price and availability are subject to change without notice. · Please do not reply to this e-mail. Copyright © 2026 FreshPoint, Inc. All rights reserved. [myfreshpoint-9784494fc-c2bz4] |

| |` },

  { number: '19471184', date: '2026-06-06', total: 297.33, items: 11, qty: 16, body: `| |
| Order Confirmation | Reference #19471184 |

| |
| Order Date/Time | Delivery Date | Purchase Order | Special Message |
| 06/06/2026 11:31 AM | Monday 06/08/2026 | N/A | N/A |

| |
| Item# | Product | Size | Qty | Price | Ext.P |
| 921068 | LETTUCE ONECUT SPRING MIX TRUEMIX LOC TX | 3/2# CS | 1 | 33.95 | 33.95 |
| 7038 | TOMATOES CLUSTER CHERRY TOV 11# LOC TX | 11# BX | 2 | 27.15 | 54.30 |
| 21456 | ARUGULA BABY WILD B W 2/1.5# | 2/1.5# BOX | 2 | 16.65 | 33.30 |
| 8211 | CARROTS JUMBO CALIF 5#(R) | 5# BX | 1 | 10.89 | 10.89 |
| 11148 | POTATOES YUKON GOLD A #1 50# | 50# BX | 1 | 35.35 | 35.35 |
| 3970 | HERB BASIL SWEET 1# | 1# BG | 4 | 8.75 | 35.00 |
| 44805 | MUSHROOMS SHIITAKE STEMLESS #2 5#CHINESE | 5# BX | 1 | 41.87 | 41.87 |
| 918 | BLACKBERRIES 2CT(R) | 2 CT BX | 1 | 12.23 | 12.23 |
| 9133 | RASPBERRIES 2CT(R) | 2 CT BX | 1 | 12.61 | 12.61 |
| 16630 | MELONS CANTALOUPE 3CT(R) | 3 CT BOX | 1 | 11.63 | 11.63 |
| 926 | BLUEBERRIES 2CT(R) | 2CT BX | 1 | 16.20 | 16.20 |

| Order Summary | |
| Items | 11 | Quantity | 16 | Total | 297.33 |

| THANK YOU FOR CHOOSING FRESHPOINT · This is not an invoice. · Copyright © 2026 FreshPoint, Inc. All rights reserved. |` },

  { number: '19478941', date: '2026-06-09', total: 203.79, items: 11, qty: 11, body: `| |
| Order Confirmation | Reference #19478941 |

| |
| Order Date/Time | Delivery Date | Purchase Order | Special Message |
| 06/09/2026 10:56 AM | Wednesday 06/10/2026 | N/A | N/A |

| |
| Item# | Product | Size | Qty | Price | Ext.P |
| 921068 | LETTUCE ONECUT SPRING MIX TRUEMIX LOC TX | 3/2# CS | 1 | 33.95 | 33.95 |
| 15909 | TOMATOES BEEFSTEAK 25 32CT | 15# BX | 1 | 40.25 | 40.25 |
| 21456 | ARUGULA BABY WILD B W 2/1.5# | 2/1.5# BOX | 1 | 16.65 | 16.65 |
| 3970 | HERB BASIL SWEET 1# | 1# BG | 1 | 8.75 | 8.75 |
| 4134 | HERB TARRAGON 1# | 1# CS | 1 | 19.30 | 19.30 |
| 16451 | HERB ROSEMARY 1# | 1# BG | 1 | 9.00 | 9.00 |
| 4220 | PARSLEY ITALIAN/FLAT 30CT | 30CT BX | 1 | 22.59 | 22.59 |
| 4004 | HERB SAGE 1# | 1# CS | 1 | 11.65 | 11.65 |
| 918 | BLACKBERRIES 2CT(R) | 2 CT BX | 1 | 12.36 | 12.36 |
| 9133 | RASPBERRIES 2CT(R) | 2 CT BX | 1 | 13.09 | 13.09 |
| 926 | BLUEBERRIES 2CT(R) | 2CT BX | 1 | 16.20 | 16.20 |

| Order Summary | |
| Items | 11 | Quantity | 11 | Total | 203.79 |

| THANK YOU FOR CHOOSING FRESHPOINT · This is not an invoice. · Copyright © 2026 FreshPoint, Inc. All rights reserved. |` },

  { number: '19484705', date: '2026-06-10', total: 279.74, items: 10, qty: 12, body: `| |
| Order Confirmation | Reference #19484705 |

| |
| Order Date/Time | Delivery Date | Purchase Order | Special Message |
| 06/10/2026 06:04 PM | Friday 06/12/2026 | N/A | N/A |

| |
| Item# | Product | Size | Qty | Price | Ext.P |
| 921068 | LETTUCE ONECUT SPRING MIX TRUEMIX LOC TX | 3/2# CS | 1 | 33.95 | 33.95 |
| 7038 | TOMATOES CLUSTER CHERRY TOV 11# LOC TX | 11# BX | 2 | 25.15 | 50.30 |
| 15909 | TOMATOES BEEFSTEAK 25 32CT | 15# BX | 1 | 40.25 | 40.25 |
| 21456 | ARUGULA BABY WILD B W 2/1.5# | 2/1.5# BOX | 1 | 16.65 | 16.65 |
| 14365 | BABY SPINACH 4# | 4# BX | 1 | 15.40 | 15.40 |
| 13698 | PEPPERS RED BELL #5 | 5 LB BX | 1 | 14.28 | 14.28 |
| 12880 | ASPARAGUS MEDIUM/LARGE 11# | 11# BX | 1 | 38.69 | 38.69 |
| 8211 | CARROTS JUMBO CALIF 5#(R) | 5# BX | 2 | 10.89 | 21.78 |
| 11148 | POTATOES YUKON GOLD A #1 50# | 50# BX | 1 | 35.35 | 35.35 |
| 9133 | RASPBERRIES 2CT(R) | 2 CT BX | 1 | 13.09 | 13.09 |

| Order Summary | |
| Items | 10 | Quantity | 12 | Total | 279.74 |

| THANK YOU FOR CHOOSING FRESHPOINT · This is not an invoice. · Copyright © 2026 FreshPoint, Inc. All rights reserved. |` },

  { number: '19493416', date: '2026-06-13', total: 137.78, items: 5,  qty: 6,  body: `| |
| Order Confirmation | Reference #19493416 |

| |
| Order Date/Time | Delivery Date | Purchase Order | Special Message |
| 06/13/2026 02:06 PM | Monday 06/15/2026 | N/A | N/A |

| |
| Item# | Product | Size | Qty | Price | Ext.P |
| 921068 | LETTUCE ONECUT SPRING MIX TRUEMIX LOC TX | 3/2# CS | 1 | 33.95 | 33.95 |
| 7038 | TOMATOES CLUSTER CHERRY TOV 11# LOC TX | 11# BX | 1 | 25.15 | 25.15 |
| 15909 | TOMATOES BEEFSTEAK 25 32CT | 15# BX | 1 | 40.25 | 40.25 |
| 21456 | ARUGULA BABY WILD B W 2/1.5# | 2/1.5# BOX | 1 | 16.65 | 16.65 |
| 8211 | CARROTS JUMBO CALIF 5#(R) | 5# BX | 2 | 10.89 | 21.78 |

| Order Summary | |
| Items | 5 | Quantity | 6 | Total | 137.78 |

| THANK YOU FOR CHOOSING FRESHPOINT · This is not an invoice. · Copyright © 2026 FreshPoint, Inc. All rights reserved. |` },
];

// Somma attesa dei cinque, congelata: $1,064.07
const EXPECTED_TOTAL = 1064.07;

module.exports = { SAMPLES, EXPECTED_TOTAL };
