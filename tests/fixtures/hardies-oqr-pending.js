// ─────────────────────────────────────────────────────────────────────
// INV08H — i cinque documenti Hardie's rimasti pending per OQR CURRENT,
// come erano in produzione il 2026-09-21. Copia FEDELE del parsed_json
// memorizzato (nessun campo aggiunto, nessuno tolto, nessuno arrotondato):
// quattro sono parsed_json LEGACY del 7 e 15 settembre — `qty`,
// `purchasable` e `catchweight` non esistono ancora — e uno (07133808)
// e' stato parsato il 21 settembre dal parser corrente.
//
// Serve esattamente a questo: la policy deve reggere sul JSON COSI' COM'E'
// GIA' SCRITTO, senza riparsare niente. E' la stessa disciplina di INV08B.1.
// ─────────────────────────────────────────────────────────────────────
'use strict';

module.exports = [
  {
    "id": "f9d6321d-1d7c-451c-9b3a-3bb896f83a6f",
    "document_number": "07106025",
    "document_type": "invoice",
    "vendor": "Hardie's Fresh Foods / Dairyland Produce",
    "warnings": [
      {
        "code": "OQR-006",
        "item": "FLOWER MARIGOLD",
        "field": "pack_unit",
        "message": "Count-based: FLOWER MARIGOLD (50 CT)"
      },
      {
        "code": "OQR-006",
        "item": "LEMON CHOICE",
        "field": "pack_unit",
        "message": "Count-based: LEMON CHOICE (95 CT)"
      },
      {
        "code": "OQR-006",
        "item": "PARSLEY FLAT ITALIAN",
        "field": "pack_unit",
        "message": "Count-based: PARSLEY FLAT ITALIAN (6 CT)"
      },
      {
        "code": "OQR-006",
        "item": "BLACKBERRY",
        "field": "pack_unit",
        "message": "Count-based: BLACKBERRY (3 CT)"
      },
      {
        "code": "OQR-007",
        "item": "SEED PUMPKIN ROASTED/SALTED",
        "field": "qty_received",
        "message": "Qty mismatch: ordered 2, shipped 1 of SEED PUMPKIN ROASTED/SALTED",
        "possible_reasons": [
          "Short shipped",
          "Back ordered",
          "Vendor error",
          "Substitution"
        ]
      },
      {
        "code": "OQR-002",
        "item": "SEED PUMPKIN RAW",
        "field": "is_substitution",
        "message": "Substitution: ordered 0, received 1 of SEED PUMPKIN RAW"
      },
      {
        "code": "OQR-007",
        "item": "SEED PUMPKIN RAW",
        "field": "qty_received",
        "message": "Qty mismatch: ordered 0, shipped 1 of SEED PUMPKIN RAW",
        "possible_reasons": [
          "Short shipped",
          "Back ordered",
          "Vendor error",
          "Substitution"
        ]
      },
      {
        "code": "OQR-006",
        "item": "TOMATO BEEFSTEAK RED",
        "field": "pack_unit",
        "message": "Count-based: TOMATO BEEFSTEAK RED (16-22 CT)"
      }
    ],
    "parsed_json": {
      "tax": 0,
      "items": [
        {
          "amount": 30.5,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "oz",
          "unit_price": 15.25,
          "vendor_sku": "24060",
          "description": "SPICE GARLIC GRANULATED",
          "qty_ordered": 2,
          "qty_received": 2,
          "purchase_unit": "oz",
          "pack_size_each": 16,
          "is_substitution": false,
          "raw_description": "SPICE GARLIC GRANULATED",
          "substituted_sku": null,
          "pack_description": "16 OZ"
        },
        {
          "amount": 24.45,
          "origin": null,
          "pack_qty": null,
          "warnings": [],
          "pack_unit": null,
          "unit_price": 24.45,
          "vendor_sku": "25618",
          "description": "CHZ MOZZ BURRATA BELGIOIOSO",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": null,
          "pack_size_each": null,
          "is_substitution": false,
          "raw_description": "CHZ MOZZ BURRATA BELGIOIOSO",
          "substituted_sku": null,
          "pack_description": "6-4/2 oz"
        },
        {
          "amount": 82.99,
          "origin": null,
          "pack_qty": null,
          "warnings": [],
          "pack_unit": null,
          "unit_price": 82.99,
          "vendor_sku": "03744",
          "description": "WHIPPING CREAM (40%) FRESH",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": null,
          "pack_size_each": null,
          "is_substitution": false,
          "raw_description": "WHIPPING CREAM (40%) FRESH",
          "substituted_sku": null,
          "pack_description": "9-1/2 GAL"
        },
        {
          "amount": 38.56,
          "origin": null,
          "pack_qty": 8,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 4.82,
          "vendor_sku": "27786",
          "description": "CHZ MOZZ THIN SLICE 21 SLI/LB",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 1,
          "is_substitution": false,
          "raw_description": "CHZ MOZZ THIN SLICE 21 SLI/LB",
          "substituted_sku": null,
          "pack_description": "8/1#"
        },
        {
          "amount": 36.58,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: FLOWER MARIGOLD (50 CT)"
            }
          ],
          "pack_unit": "ct",
          "unit_price": 18.29,
          "vendor_sku": "05840",
          "description": "FLOWER MARIGOLD",
          "qty_ordered": 2,
          "qty_received": 2,
          "purchase_unit": "each",
          "pack_size_each": 50,
          "is_substitution": false,
          "raw_description": "FLOWER MARIGOLD",
          "substituted_sku": null,
          "pack_description": "50 CT"
        },
        {
          "amount": 14.21,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 14.21,
          "vendor_sku": "01296",
          "description": "HERB ARUGULA WILD B&W",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 3,
          "is_substitution": false,
          "raw_description": "HERB ARUGULA WILD B&W",
          "substituted_sku": null,
          "pack_description": "3#"
        },
        {
          "amount": 47.65,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: LEMON CHOICE (95 CT)"
            }
          ],
          "pack_unit": "ct",
          "unit_price": 47.65,
          "vendor_sku": "71104",
          "description": "LEMON CHOICE",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "each",
          "pack_size_each": 95,
          "is_substitution": false,
          "raw_description": "LEMON CHOICE",
          "substituted_sku": null,
          "pack_description": "95 CT"
        },
        {
          "amount": 17.75,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: PARSLEY FLAT ITALIAN (6 CT)"
            }
          ],
          "pack_unit": "ct",
          "unit_price": 3.55,
          "vendor_sku": "03075",
          "description": "PARSLEY FLAT ITALIAN",
          "qty_ordered": 5,
          "qty_received": 5,
          "purchase_unit": "each",
          "pack_size_each": 6,
          "is_substitution": false,
          "raw_description": "PARSLEY FLAT ITALIAN",
          "substituted_sku": null,
          "pack_description": "6 CT"
        },
        {
          "amount": 40.9,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 40.9,
          "vendor_sku": "71553",
          "description": "POTATO A SIZE YUKON GOLD",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 50,
          "is_substitution": false,
          "raw_description": "POTATO A SIZE YUKON GOLD",
          "substituted_sku": null,
          "pack_description": "50#"
        },
        {
          "amount": 75.99,
          "origin": null,
          "pack_qty": 12,
          "warnings": [],
          "pack_unit": "qt",
          "unit_price": 75.99,
          "vendor_sku": "10068",
          "description": "WHIPPING CREAM 36% FRESH UHT",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "qt",
          "pack_size_each": 1,
          "is_substitution": false,
          "raw_description": "WHIPPING CREAM 36% FRESH UHT",
          "substituted_sku": null,
          "pack_description": "12/1 QT"
        },
        {
          "amount": 9.93,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: BLACKBERRY (3 CT)"
            }
          ],
          "pack_unit": "ct",
          "unit_price": 9.93,
          "vendor_sku": "00254",
          "description": "BLACKBERRY",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "each",
          "pack_size_each": 3,
          "is_substitution": false,
          "raw_description": "BLACKBERRY",
          "substituted_sku": null,
          "pack_description": "3 CT"
        },
        {
          "amount": 163.81,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 11.52,
          "vendor_sku": "00912",
          "description": "CHZ PECORINO ROMANO",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 13,
          "is_substitution": false,
          "raw_description": "CHZ PECORINO ROMANO",
          "substituted_sku": null,
          "pack_description": "13#"
        },
        {
          "amount": 39.33,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-007",
              "field": "qty_received",
              "message": "Qty mismatch: ordered 2, shipped 1 of SEED PUMPKIN ROASTED/SALTED",
              "possible_reasons": [
                "Short shipped",
                "Back ordered",
                "Vendor error",
                "Substitution"
              ]
            }
          ],
          "pack_unit": "lb",
          "unit_price": 39.33,
          "vendor_sku": "03252",
          "description": "SEED PUMPKIN ROASTED/SALTED",
          "qty_ordered": 2,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 5,
          "is_substitution": false,
          "raw_description": "SEED PUMPKIN ROASTED/SALTED",
          "substituted_sku": null,
          "pack_description": "5#"
        },
        {
          "amount": 24.57,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-002",
              "field": "is_substitution",
              "message": "Substitution: ordered 0, received 1 of SEED PUMPKIN RAW"
            },
            {
              "code": "OQR-007",
              "field": "qty_received",
              "message": "Qty mismatch: ordered 0, shipped 1 of SEED PUMPKIN RAW",
              "possible_reasons": [
                "Short shipped",
                "Back ordered",
                "Vendor error",
                "Substitution"
              ]
            }
          ],
          "pack_unit": "lb",
          "unit_price": 24.57,
          "vendor_sku": "85025",
          "description": "SEED PUMPKIN RAW",
          "qty_ordered": 0,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 5,
          "is_substitution": true,
          "raw_description": "SEED PUMPKIN RAW",
          "substituted_sku": "03252",
          "pack_description": "5#"
        },
        {
          "amount": 35.98,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 17.99,
          "vendor_sku": "03257",
          "description": "SEED SUNFLOWER RAW",
          "qty_ordered": 2,
          "qty_received": 2,
          "purchase_unit": "lb",
          "pack_size_each": 5,
          "is_substitution": false,
          "raw_description": "SEED SUNFLOWER RAW",
          "substituted_sku": null,
          "pack_description": "5#"
        },
        {
          "amount": 23.68,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: TOMATO BEEFSTEAK RED (16-22 CT)"
            }
          ],
          "pack_unit": "ct",
          "unit_price": 23.68,
          "vendor_sku": "71904",
          "description": "TOMATO BEEFSTEAK RED",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "each",
          "pack_size_each": 16,
          "is_substitution": false,
          "raw_description": "TOMATO BEEFSTEAK RED",
          "substituted_sku": null,
          "pack_description": "16-22 CT"
        },
        {
          "amount": 81.95,
          "origin": null,
          "pack_qty": 4,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 81.95,
          "vendor_sku": "00859",
          "description": "CHZ MASCARPONE BELGIOIOSO",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 5,
          "is_substitution": false,
          "raw_description": "CHZ MASCARPONE BELGIOIOSO",
          "substituted_sku": null,
          "pack_description": "4/5#"
        }
      ],
      "total": 788.83,
      "vendor": "Hardie's Fresh Foods / Dairyland Produce",
      "subtotal": 788.83,
      "warnings": [],
      "order_date": "2026-09-02",
      "order_number": null,
      "storage_path": "invoices/gmail/1788365128241_INVOICE_-_07106025.pdf",
      "delivery_date": "2026-09-02",
      "document_type": "invoice",
      "original_filename": "INVOICE_-_07106025.pdf"
    }
  },
  {
    "id": "a7e61458-3577-4707-b0f8-8215321099ea",
    "document_number": "07109562",
    "document_type": "invoice",
    "vendor": "Hardie's Fresh Foods / Dairyland Produce",
    "warnings": [
      {
        "code": "OQR-006",
        "item": "LETTUCE ROMAINE HEARTS",
        "field": "pack_unit",
        "message": "Count-based: LETTUCE ROMAINE HEARTS (12/3 CT)"
      },
      {
        "code": "OQR-007",
        "item": "FLOWER MARIGOLD",
        "field": "qty_received",
        "message": "Qty mismatch: ordered 2, shipped 1 of FLOWER MARIGOLD",
        "possible_reasons": [
          "Short shipped",
          "Back ordered",
          "Vendor error",
          "Substitution"
        ]
      },
      {
        "code": "OQR-006",
        "item": "FLOWER MARIGOLD",
        "field": "pack_unit",
        "message": "Count-based: FLOWER MARIGOLD (50 CT)"
      },
      {
        "code": "OQR-002",
        "item": "FLOWER EDIBLE ASSORTED",
        "field": "is_substitution",
        "message": "Substitution: ordered 0, received 1 of FLOWER EDIBLE ASSORTED"
      },
      {
        "code": "OQR-007",
        "item": "FLOWER EDIBLE ASSORTED",
        "field": "qty_received",
        "message": "Qty mismatch: ordered 0, shipped 1 of FLOWER EDIBLE ASSORTED",
        "possible_reasons": [
          "Short shipped",
          "Back ordered",
          "Vendor error",
          "Substitution"
        ]
      },
      {
        "code": "OQR-006",
        "item": "FLOWER EDIBLE ASSORTED",
        "field": "pack_unit",
        "message": "Count-based: FLOWER EDIBLE ASSORTED (50 CT)"
      },
      {
        "code": "OQR-006",
        "item": "SQUASH BLOSSOMS FRESH",
        "field": "pack_unit",
        "message": "Count-based: SQUASH BLOSSOMS FRESH (25 CT)"
      }
    ],
    "parsed_json": {
      "tax": 0,
      "items": [
        {
          "amount": 43.78,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 21.89,
          "vendor_sku": "25265",
          "description": "CHZ MOZZ SHRED GRANDE W/M",
          "qty_ordered": 2,
          "qty_received": 2,
          "purchase_unit": "lb",
          "pack_size_each": 5,
          "is_substitution": false,
          "raw_description": "CHZ MOZZ SHRED GRANDE W/M",
          "substituted_sku": null,
          "pack_description": "5#"
        },
        {
          "amount": 32.11,
          "origin": null,
          "pack_qty": 12,
          "warnings": [
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: LETTUCE ROMAINE HEARTS (12/3 CT)"
            }
          ],
          "pack_unit": "ct",
          "unit_price": 32.11,
          "vendor_sku": "71114",
          "description": "LETTUCE ROMAINE HEARTS",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "each",
          "pack_size_each": 3,
          "is_substitution": false,
          "raw_description": "LETTUCE ROMAINE HEARTS",
          "substituted_sku": null,
          "pack_description": "12/3 CT"
        },
        {
          "amount": 59.15,
          "origin": null,
          "pack_qty": 11,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 59.15,
          "vendor_sku": "00108",
          "description": "ASPARAGUS LARGE",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 1,
          "is_substitution": false,
          "raw_description": "ASPARAGUS LARGE",
          "substituted_sku": null,
          "pack_description": "11/1#"
        },
        {
          "amount": 38.56,
          "origin": null,
          "pack_qty": 8,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 4.82,
          "vendor_sku": "27786",
          "description": "CHZ MOZZ THIN SLICE 21 SLI/LB",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 1,
          "is_substitution": false,
          "raw_description": "CHZ MOZZ THIN SLICE 21 SLI/LB",
          "substituted_sku": null,
          "pack_description": "8/1#"
        },
        {
          "amount": 102.87,
          "origin": null,
          "pack_qty": 15,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 102.87,
          "vendor_sku": "13379",
          "description": "EGG LIQUID YOLK",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 2,
          "is_substitution": false,
          "raw_description": "EGG LIQUID YOLK",
          "substituted_sku": null,
          "pack_description": "15/2#"
        },
        {
          "amount": 18.29,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-007",
              "field": "qty_received",
              "message": "Qty mismatch: ordered 2, shipped 1 of FLOWER MARIGOLD",
              "possible_reasons": [
                "Short shipped",
                "Back ordered",
                "Vendor error",
                "Substitution"
              ]
            },
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: FLOWER MARIGOLD (50 CT)"
            }
          ],
          "pack_unit": "ct",
          "unit_price": 18.29,
          "vendor_sku": "05840",
          "description": "FLOWER MARIGOLD",
          "qty_ordered": 2,
          "qty_received": 1,
          "purchase_unit": "each",
          "pack_size_each": 50,
          "is_substitution": false,
          "raw_description": "FLOWER MARIGOLD",
          "substituted_sku": null,
          "pack_description": "50 CT"
        },
        {
          "amount": 25.39,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-002",
              "field": "is_substitution",
              "message": "Substitution: ordered 0, received 1 of FLOWER EDIBLE ASSORTED"
            },
            {
              "code": "OQR-007",
              "field": "qty_received",
              "message": "Qty mismatch: ordered 0, shipped 1 of FLOWER EDIBLE ASSORTED",
              "possible_reasons": [
                "Short shipped",
                "Back ordered",
                "Vendor error",
                "Substitution"
              ]
            },
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: FLOWER EDIBLE ASSORTED (50 CT)"
            }
          ],
          "pack_unit": "ct",
          "unit_price": 25.39,
          "vendor_sku": "01177",
          "description": "FLOWER EDIBLE ASSORTED",
          "qty_ordered": 0,
          "qty_received": 1,
          "purchase_unit": "each",
          "pack_size_each": 50,
          "is_substitution": true,
          "raw_description": "FLOWER EDIBLE ASSORTED",
          "substituted_sku": "05840",
          "pack_description": "50 CT"
        },
        {
          "amount": 9,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 9,
          "vendor_sku": "01306",
          "description": "HERB BASIL",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 1,
          "is_substitution": false,
          "raw_description": "HERB BASIL",
          "substituted_sku": null,
          "pack_description": "1#"
        },
        {
          "amount": 8.5,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 8.5,
          "vendor_sku": "01374",
          "description": "HERB ROSEMARY",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 1,
          "is_substitution": false,
          "raw_description": "HERB ROSEMARY",
          "substituted_sku": null,
          "pack_description": "1#"
        },
        {
          "amount": 12,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 12,
          "vendor_sku": "01385",
          "description": "HERB SAGE",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 1,
          "is_substitution": false,
          "raw_description": "HERB SAGE",
          "substituted_sku": null,
          "pack_description": "1#"
        },
        {
          "amount": 14.5,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "oz",
          "unit_price": 14.5,
          "vendor_sku": "01395",
          "description": "HERB TARRAGON",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "oz",
          "pack_size_each": 8,
          "is_substitution": false,
          "raw_description": "HERB TARRAGON",
          "substituted_sku": null,
          "pack_description": "8 OZ"
        },
        {
          "amount": 25.24,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 12.62,
          "vendor_sku": "01981",
          "description": "ORGANIC SPRING MIX",
          "qty_ordered": 2,
          "qty_received": 2,
          "purchase_unit": "lb",
          "pack_size_each": 3,
          "is_substitution": false,
          "raw_description": "ORGANIC SPRING MIX",
          "substituted_sku": null,
          "pack_description": "3#"
        },
        {
          "amount": 1080,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 13.5,
          "vendor_sku": "00907",
          "description": "CHZ PARMESAN REGGIANO 24 MOS",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 80,
          "is_substitution": false,
          "raw_description": "CHZ PARMESAN REGGIANO 24 MOS",
          "substituted_sku": null,
          "pack_description": "80#"
        },
        {
          "amount": 858.48,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 29.4,
          "vendor_sku": "13544",
          "description": "RWPR 103 RIB REF",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 25,
          "is_substitution": false,
          "raw_description": "RWPR 103 RIB REF",
          "substituted_sku": null,
          "pack_description": "1 PC/25#"
        },
        {
          "amount": 34.39,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: SQUASH BLOSSOMS FRESH (25 CT)"
            }
          ],
          "pack_unit": "ct",
          "unit_price": 34.39,
          "vendor_sku": "03421",
          "description": "SQUASH BLOSSOMS FRESH",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "each",
          "pack_size_each": 25,
          "is_substitution": false,
          "raw_description": "SQUASH BLOSSOMS FRESH",
          "substituted_sku": null,
          "pack_description": "25 CT"
        }
      ],
      "total": 2362.26,
      "vendor": "Hardie's Fresh Foods / Dairyland Produce",
      "subtotal": 2362.26,
      "warnings": [],
      "order_date": "2026-09-04",
      "order_number": null,
      "storage_path": "invoices/gmail/1788552326213_INVOICE_-_07109562.pdf",
      "delivery_date": "2026-09-04",
      "document_type": "invoice",
      "original_filename": "INVOICE_-_07109562.pdf"
    }
  },
  {
    "id": "74dfcc35-4357-4444-aed0-979a1fd14be8",
    "document_number": "07111645",
    "document_type": "invoice",
    "vendor": "Hardie's Fresh Foods / Dairyland Produce",
    "warnings": [
      {
        "code": "OQR-006",
        "item": "LETTUCE ROMAINE HEARTS",
        "field": "pack_unit",
        "message": "Count-based: LETTUCE ROMAINE HEARTS (12/3 CT)"
      },
      {
        "code": "OQR-006",
        "item": "BLACKBERRY",
        "field": "pack_unit",
        "message": "Count-based: BLACKBERRY (3 CT)"
      },
      {
        "code": "OQR-006",
        "item": "BLUEBERRY",
        "field": "pack_unit",
        "message": "Count-based: BLUEBERRY (3 CT)"
      },
      {
        "code": "OQR-007",
        "item": "FLOWER MARIGOLD",
        "field": "qty_received",
        "message": "Qty mismatch: ordered 2, shipped 0 of FLOWER MARIGOLD",
        "possible_reasons": [
          "Short shipped",
          "Back ordered",
          "Vendor error",
          "Substitution"
        ]
      },
      {
        "code": "OQR-006",
        "item": "FLOWER MARIGOLD",
        "field": "pack_unit",
        "message": "Count-based: FLOWER MARIGOLD (50 CT)"
      },
      {
        "code": "OQR-002",
        "item": "FLOWER EDIBLE ASSORTED",
        "field": "is_substitution",
        "message": "Substitution: ordered 0, received 2 of FLOWER EDIBLE ASSORTED"
      },
      {
        "code": "OQR-007",
        "item": "FLOWER EDIBLE ASSORTED",
        "field": "qty_received",
        "message": "Qty mismatch: ordered 0, shipped 2 of FLOWER EDIBLE ASSORTED",
        "possible_reasons": [
          "Short shipped",
          "Back ordered",
          "Vendor error",
          "Substitution"
        ]
      },
      {
        "code": "OQR-006",
        "item": "FLOWER EDIBLE ASSORTED",
        "field": "pack_unit",
        "message": "Count-based: FLOWER EDIBLE ASSORTED (50 CT)"
      },
      {
        "code": "OQR-007",
        "item": "HERB BASIL",
        "field": "qty_received",
        "message": "Qty mismatch: ordered 2, shipped 0 of HERB BASIL",
        "possible_reasons": [
          "Short shipped",
          "Back ordered",
          "Vendor error",
          "Substitution"
        ]
      },
      {
        "code": "OQR-006",
        "item": "CANTALOUPE",
        "field": "pack_unit",
        "message": "Count-based: CANTALOUPE (3 CT)"
      },
      {
        "code": "OQR-006",
        "item": "PARSLEY FLAT ITALIAN",
        "field": "pack_unit",
        "message": "Count-based: PARSLEY FLAT ITALIAN (6 CT)"
      },
      {
        "code": "OQR-006",
        "item": "TOMATO BEEFSTEAK RED",
        "field": "pack_unit",
        "message": "Count-based: TOMATO BEEFSTEAK RED (16-22 CT)"
      }
    ],
    "parsed_json": {
      "tax": 0,
      "items": [
        {
          "amount": 27,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 27,
          "vendor_sku": "07673",
          "description": "TOMATO CHERRY ON THE VINE",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 11,
          "is_substitution": false,
          "raw_description": "TOMATO CHERRY ON THE VINE",
          "substituted_sku": null,
          "pack_description": "11#"
        },
        {
          "amount": 24.45,
          "origin": null,
          "pack_qty": null,
          "warnings": [],
          "pack_unit": null,
          "unit_price": 24.45,
          "vendor_sku": "25618",
          "description": "CHZ MOZZ BURRATA BELGIOIOSO",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": null,
          "pack_size_each": null,
          "is_substitution": false,
          "raw_description": "CHZ MOZZ BURRATA BELGIOIOSO",
          "substituted_sku": null,
          "pack_description": "6-4/2 oz"
        },
        {
          "amount": 82.99,
          "origin": null,
          "pack_qty": null,
          "warnings": [],
          "pack_unit": null,
          "unit_price": 82.99,
          "vendor_sku": "03744",
          "description": "WHIPPING CREAM (40%) FRESH",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": null,
          "pack_size_each": null,
          "is_substitution": false,
          "raw_description": "WHIPPING CREAM (40%) FRESH",
          "substituted_sku": null,
          "pack_description": "9-1/2 GAL"
        },
        {
          "amount": 56.25,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 56.25,
          "vendor_sku": "01314",
          "description": "HERB BASIL",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 5,
          "is_substitution": false,
          "raw_description": "HERB BASIL",
          "substituted_sku": null,
          "pack_description": "5#"
        },
        {
          "amount": 32.11,
          "origin": null,
          "pack_qty": 12,
          "warnings": [
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: LETTUCE ROMAINE HEARTS (12/3 CT)"
            }
          ],
          "pack_unit": "ct",
          "unit_price": 32.11,
          "vendor_sku": "71114",
          "description": "LETTUCE ROMAINE HEARTS",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "each",
          "pack_size_each": 3,
          "is_substitution": false,
          "raw_description": "LETTUCE ROMAINE HEARTS",
          "substituted_sku": null,
          "pack_description": "12/3 CT"
        },
        {
          "amount": 9.93,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: BLACKBERRY (3 CT)"
            }
          ],
          "pack_unit": "ct",
          "unit_price": 9.93,
          "vendor_sku": "00254",
          "description": "BLACKBERRY",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "each",
          "pack_size_each": 3,
          "is_substitution": false,
          "raw_description": "BLACKBERRY",
          "substituted_sku": null,
          "pack_description": "3 CT"
        },
        {
          "amount": 7.93,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: BLUEBERRY (3 CT)"
            }
          ],
          "pack_unit": "ct",
          "unit_price": 7.93,
          "vendor_sku": "00262",
          "description": "BLUEBERRY",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "each",
          "pack_size_each": 3,
          "is_substitution": false,
          "raw_description": "BLUEBERRY",
          "substituted_sku": null,
          "pack_description": "3 CT"
        },
        {
          "amount": 32.61,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 10.87,
          "vendor_sku": "70141",
          "description": "BRUSSEL SPROUTS",
          "qty_ordered": 3,
          "qty_received": 3,
          "purchase_unit": "lb",
          "pack_size_each": 5,
          "is_substitution": false,
          "raw_description": "BRUSSEL SPROUTS",
          "substituted_sku": null,
          "pack_description": "5#"
        },
        {
          "amount": 85.99,
          "origin": null,
          "pack_qty": 36,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 85.99,
          "vendor_sku": "00341",
          "description": "BUTTER UNSALTED 80% GRND RESRV",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 1,
          "is_substitution": false,
          "raw_description": "BUTTER UNSALTED 80% GRND RESRV",
          "substituted_sku": null,
          "pack_description": "36/1#"
        },
        {
          "amount": 38.56,
          "origin": null,
          "pack_qty": 8,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 4.82,
          "vendor_sku": "27786",
          "description": "CHZ MOZZ THIN SLICE 21 SLI/LB",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 1,
          "is_substitution": false,
          "raw_description": "CHZ MOZZ THIN SLICE 21 SLI/LB",
          "substituted_sku": null,
          "pack_description": "8/1#"
        },
        {
          "amount": 0,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-007",
              "field": "qty_received",
              "message": "Qty mismatch: ordered 2, shipped 0 of FLOWER MARIGOLD",
              "possible_reasons": [
                "Short shipped",
                "Back ordered",
                "Vendor error",
                "Substitution"
              ]
            },
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: FLOWER MARIGOLD (50 CT)"
            }
          ],
          "pack_unit": "ct",
          "unit_price": 18.29,
          "vendor_sku": "05840",
          "description": "FLOWER MARIGOLD",
          "qty_ordered": 2,
          "qty_received": 0,
          "purchase_unit": "each",
          "pack_size_each": 50,
          "is_substitution": false,
          "raw_description": "FLOWER MARIGOLD",
          "substituted_sku": null,
          "pack_description": "50 CT"
        },
        {
          "amount": 50.78,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-002",
              "field": "is_substitution",
              "message": "Substitution: ordered 0, received 2 of FLOWER EDIBLE ASSORTED"
            },
            {
              "code": "OQR-007",
              "field": "qty_received",
              "message": "Qty mismatch: ordered 0, shipped 2 of FLOWER EDIBLE ASSORTED",
              "possible_reasons": [
                "Short shipped",
                "Back ordered",
                "Vendor error",
                "Substitution"
              ]
            },
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: FLOWER EDIBLE ASSORTED (50 CT)"
            }
          ],
          "pack_unit": "ct",
          "unit_price": 25.39,
          "vendor_sku": "01177",
          "description": "FLOWER EDIBLE ASSORTED",
          "qty_ordered": 0,
          "qty_received": 2,
          "purchase_unit": "each",
          "pack_size_each": 50,
          "is_substitution": true,
          "raw_description": "FLOWER EDIBLE ASSORTED",
          "substituted_sku": "05840",
          "pack_description": "50 CT"
        },
        {
          "amount": 19.99,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 19.99,
          "vendor_sku": "08423",
          "description": "FLOUR SIR GALAHAD ALL PURPOSE",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 50,
          "is_substitution": false,
          "raw_description": "FLOUR SIR GALAHAD ALL PURPOSE",
          "substituted_sku": null,
          "pack_description": "50#"
        },
        {
          "amount": 17.51,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 17.51,
          "vendor_sku": "01222",
          "description": "GARLIC FRESH JUMBO",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 5,
          "is_substitution": false,
          "raw_description": "GARLIC FRESH JUMBO",
          "substituted_sku": null,
          "pack_description": "5#"
        },
        {
          "amount": 14.21,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 14.21,
          "vendor_sku": "01296",
          "description": "HERB ARUGULA WILD B&W",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 3,
          "is_substitution": false,
          "raw_description": "HERB ARUGULA WILD B&W",
          "substituted_sku": null,
          "pack_description": "3#"
        },
        {
          "amount": 0,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-007",
              "field": "qty_received",
              "message": "Qty mismatch: ordered 2, shipped 0 of HERB BASIL",
              "possible_reasons": [
                "Short shipped",
                "Back ordered",
                "Vendor error",
                "Substitution"
              ]
            }
          ],
          "pack_unit": "lb",
          "unit_price": 9,
          "vendor_sku": "01306",
          "description": "HERB BASIL",
          "qty_ordered": 2,
          "qty_received": 0,
          "purchase_unit": "lb",
          "pack_size_each": 1,
          "is_substitution": false,
          "raw_description": "HERB BASIL",
          "substituted_sku": null,
          "pack_description": "1#"
        },
        {
          "amount": 7.83,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: CANTALOUPE (3 CT)"
            }
          ],
          "pack_unit": "ct",
          "unit_price": 7.83,
          "vendor_sku": "01839",
          "description": "CANTALOUPE",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "each",
          "pack_size_each": 3,
          "is_substitution": false,
          "raw_description": "CANTALOUPE",
          "substituted_sku": null,
          "pack_description": "3 CT"
        },
        {
          "amount": 25.24,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 12.62,
          "vendor_sku": "01981",
          "description": "ORGANIC SPRING MIX",
          "qty_ordered": 2,
          "qty_received": 2,
          "purchase_unit": "lb",
          "pack_size_each": 3,
          "is_substitution": false,
          "raw_description": "ORGANIC SPRING MIX",
          "substituted_sku": null,
          "pack_description": "3#"
        },
        {
          "amount": 76.82,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 38.41,
          "vendor_sku": "02079",
          "description": "MUSHROOM SHIITAKE",
          "qty_ordered": 2,
          "qty_received": 2,
          "purchase_unit": "lb",
          "pack_size_each": 5,
          "is_substitution": false,
          "raw_description": "MUSHROOM SHIITAKE",
          "substituted_sku": null,
          "pack_description": "5#"
        },
        {
          "amount": 21.28,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 21.28,
          "vendor_sku": "02318",
          "description": "ONION RED MEDIUM",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 25,
          "is_substitution": false,
          "raw_description": "ONION RED MEDIUM",
          "substituted_sku": null,
          "pack_description": "25#"
        },
        {
          "amount": 3.29,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 3.29,
          "vendor_sku": "02377",
          "description": "ONION YELLOW JUMBO",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 5,
          "is_substitution": false,
          "raw_description": "ONION YELLOW JUMBO",
          "substituted_sku": null,
          "pack_description": "5#"
        },
        {
          "amount": 17.75,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: PARSLEY FLAT ITALIAN (6 CT)"
            }
          ],
          "pack_unit": "ct",
          "unit_price": 3.55,
          "vendor_sku": "03075",
          "description": "PARSLEY FLAT ITALIAN",
          "qty_ordered": 5,
          "qty_received": 5,
          "purchase_unit": "each",
          "pack_size_each": 6,
          "is_substitution": false,
          "raw_description": "PARSLEY FLAT ITALIAN",
          "substituted_sku": null,
          "pack_description": "6 CT"
        },
        {
          "amount": 40.9,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 40.9,
          "vendor_sku": "71553",
          "description": "POTATO A SIZE YUKON GOLD",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 50,
          "is_substitution": false,
          "raw_description": "POTATO A SIZE YUKON GOLD",
          "substituted_sku": null,
          "pack_description": "50#"
        },
        {
          "amount": 47.36,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: TOMATO BEEFSTEAK RED (16-22 CT)"
            }
          ],
          "pack_unit": "ct",
          "unit_price": 23.68,
          "vendor_sku": "71904",
          "description": "TOMATO BEEFSTEAK RED",
          "qty_ordered": 2,
          "qty_received": 2,
          "purchase_unit": "each",
          "pack_size_each": 16,
          "is_substitution": false,
          "raw_description": "TOMATO BEEFSTEAK RED",
          "substituted_sku": null,
          "pack_description": "16-22 CT"
        }
      ],
      "total": 740.78,
      "vendor": "Hardie's Fresh Foods / Dairyland Produce",
      "subtotal": 740.78,
      "warnings": [],
      "order_date": "2026-09-05",
      "order_number": null,
      "storage_path": "invoices/gmail/1788617126835_INVOICE_-_07111645.pdf",
      "delivery_date": "2026-09-05",
      "document_type": "invoice",
      "original_filename": "INVOICE_-_07111645.pdf"
    }
  },
  {
    "id": "178e009b-b356-4455-9a54-c6be9aaa1567",
    "document_number": "07119341",
    "document_type": "invoice",
    "vendor": "Hardie's Fresh Foods / Dairyland Produce",
    "warnings": [
      {
        "code": "OQR-007",
        "item": "PROSCIUTTO SLICED ABF",
        "field": "qty_received",
        "message": "Qty mismatch: ordered 1, shipped 0 of PROSCIUTTO SLICED ABF",
        "possible_reasons": [
          "Short shipped",
          "Back ordered",
          "Vendor error",
          "Substitution"
        ]
      },
      {
        "code": "OQR-006",
        "item": "LETTUCE ROMAINE HEARTS",
        "field": "pack_unit",
        "message": "Count-based: LETTUCE ROMAINE HEARTS (12/3 CT)"
      },
      {
        "code": "OQR-006",
        "item": "ULTIMATE ARTICHOKE",
        "field": "pack_unit",
        "message": "Count-based: ULTIMATE ARTICHOKE (4/20 CT)"
      },
      {
        "code": "OQR-006",
        "item": "FENNEL/ANISE",
        "field": "pack_unit",
        "message": "Count-based: FENNEL/ANISE (3 CT)"
      },
      {
        "code": "OQR-006",
        "item": "CANTALOUPE",
        "field": "pack_unit",
        "message": "Count-based: CANTALOUPE (3 CT)"
      },
      {
        "code": "OQR-006",
        "item": "PARSLEY FLAT ITALIAN",
        "field": "pack_unit",
        "message": "Count-based: PARSLEY FLAT ITALIAN (6 CT)"
      },
      {
        "code": "OQR-006",
        "item": "BLACKBERRY",
        "field": "pack_unit",
        "message": "Count-based: BLACKBERRY (3 CT)"
      },
      {
        "code": "OQR-007",
        "item": "SQUASH BLOSSOMS FRESH",
        "field": "qty_received",
        "message": "Qty mismatch: ordered 1, shipped 0 of SQUASH BLOSSOMS FRESH",
        "possible_reasons": [
          "Short shipped",
          "Back ordered",
          "Vendor error",
          "Substitution"
        ]
      },
      {
        "code": "OQR-006",
        "item": "SQUASH BLOSSOMS FRESH",
        "field": "pack_unit",
        "message": "Count-based: SQUASH BLOSSOMS FRESH (25 CT)"
      }
    ],
    "parsed_json": {
      "tax": null,
      "items": [
        {
          "amount": 59.99,
          "origin": null,
          "pack_qty": 15,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 59.99,
          "vendor_sku": "09715",
          "description": "EGG LIQUID WHOLE W/C ACID",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 2,
          "is_substitution": false,
          "raw_description": "EGG LIQUID WHOLE W/C ACID",
          "substituted_sku": null,
          "pack_description": "15/2#"
        },
        {
          "amount": 82.99,
          "origin": null,
          "pack_qty": null,
          "warnings": [],
          "pack_unit": null,
          "unit_price": 82.99,
          "vendor_sku": "03744",
          "description": "WHIPPING CREAM (40%) FRESH",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": null,
          "pack_size_each": null,
          "is_substitution": false,
          "raw_description": "WHIPPING CREAM (40%) FRESH",
          "substituted_sku": null,
          "pack_description": "9-1/2 GAL"
        },
        {
          "amount": 0,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-007",
              "field": "qty_received",
              "message": "Qty mismatch: ordered 1, shipped 0 of PROSCIUTTO SLICED ABF",
              "possible_reasons": [
                "Short shipped",
                "Back ordered",
                "Vendor error",
                "Substitution"
              ]
            }
          ],
          "pack_unit": "lb",
          "unit_price": 23.25,
          "vendor_sku": "25271",
          "description": "PROSCIUTTO SLICED ABF",
          "qty_ordered": 1,
          "qty_received": 0,
          "purchase_unit": "lb",
          "pack_size_each": 1,
          "is_substitution": false,
          "raw_description": "PROSCIUTTO SLICED ABF",
          "substituted_sku": null,
          "pack_description": "1#"
        },
        {
          "amount": 29.42,
          "origin": null,
          "pack_qty": 12,
          "warnings": [
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: LETTUCE ROMAINE HEARTS (12/3 CT)"
            }
          ],
          "pack_unit": "ct",
          "unit_price": 29.42,
          "vendor_sku": "71114",
          "description": "LETTUCE ROMAINE HEARTS",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "each",
          "pack_size_each": 3,
          "is_substitution": false,
          "raw_description": "LETTUCE ROMAINE HEARTS",
          "substituted_sku": null,
          "pack_description": "12/3 CT"
        },
        {
          "amount": 161.71,
          "origin": null,
          "pack_qty": 4,
          "warnings": [
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: ULTIMATE ARTICHOKE (4/20 CT)"
            }
          ],
          "pack_unit": "ct",
          "unit_price": 161.71,
          "vendor_sku": "23386",
          "description": "ULTIMATE ARTICHOKE",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "each",
          "pack_size_each": 20,
          "is_substitution": false,
          "raw_description": "ULTIMATE ARTICHOKE",
          "substituted_sku": null,
          "pack_description": "4/20 CT"
        },
        {
          "amount": 4.9,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: FENNEL/ANISE (3 CT)"
            }
          ],
          "pack_unit": "ct",
          "unit_price": 4.9,
          "vendor_sku": "01153",
          "description": "FENNEL/ANISE",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "each",
          "pack_size_each": 3,
          "is_substitution": false,
          "raw_description": "FENNEL/ANISE",
          "substituted_sku": null,
          "pack_description": "3 CT"
        },
        {
          "amount": 21.05,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 21.05,
          "vendor_sku": "01296",
          "description": "HERB ARUGULA WILD B&W",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 3,
          "is_substitution": false,
          "raw_description": "HERB ARUGULA WILD B&W",
          "substituted_sku": null,
          "pack_description": "3#"
        },
        {
          "amount": 13.5,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 13.5,
          "vendor_sku": "01398",
          "description": "HERB THYME",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 1,
          "is_substitution": false,
          "raw_description": "HERB THYME",
          "substituted_sku": null,
          "pack_description": "1#"
        },
        {
          "amount": 9.39,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: CANTALOUPE (3 CT)"
            }
          ],
          "pack_unit": "ct",
          "unit_price": 9.39,
          "vendor_sku": "01839",
          "description": "CANTALOUPE",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "each",
          "pack_size_each": 3,
          "is_substitution": false,
          "raw_description": "CANTALOUPE",
          "substituted_sku": null,
          "pack_description": "3 CT"
        },
        {
          "amount": 28.42,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 14.21,
          "vendor_sku": "01981",
          "description": "ORGANIC SPRING MIX",
          "qty_ordered": 2,
          "qty_received": 2,
          "purchase_unit": "lb",
          "pack_size_each": 3,
          "is_substitution": false,
          "raw_description": "ORGANIC SPRING MIX",
          "substituted_sku": null,
          "pack_description": "3#"
        },
        {
          "amount": 7.28,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: PARSLEY FLAT ITALIAN (6 CT)"
            }
          ],
          "pack_unit": "ct",
          "unit_price": 3.64,
          "vendor_sku": "03075",
          "description": "PARSLEY FLAT ITALIAN",
          "qty_ordered": 2,
          "qty_received": 2,
          "purchase_unit": "each",
          "pack_size_each": 6,
          "is_substitution": false,
          "raw_description": "PARSLEY FLAT ITALIAN",
          "substituted_sku": null,
          "pack_description": "6 CT"
        },
        {
          "amount": 29.26,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 14.63,
          "vendor_sku": "71898",
          "description": "SPINACH BABY",
          "qty_ordered": 2,
          "qty_received": 2,
          "purchase_unit": "lb",
          "pack_size_each": 4,
          "is_substitution": false,
          "raw_description": "SPINACH BABY",
          "substituted_sku": null,
          "pack_description": "4#"
        },
        {
          "amount": 19.7,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: BLACKBERRY (3 CT)"
            }
          ],
          "pack_unit": "ct",
          "unit_price": 9.85,
          "vendor_sku": "00254",
          "description": "BLACKBERRY",
          "qty_ordered": 2,
          "qty_received": 2,
          "purchase_unit": "each",
          "pack_size_each": 3,
          "is_substitution": false,
          "raw_description": "BLACKBERRY",
          "substituted_sku": null,
          "pack_description": "3 CT"
        },
        {
          "amount": 62.35,
          "origin": null,
          "pack_qty": 12,
          "warnings": [],
          "pack_unit": "oz",
          "unit_price": 62.35,
          "vendor_sku": "70563",
          "description": "FIGS BLACK MISSION FRESH",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "oz",
          "pack_size_each": 8,
          "is_substitution": false,
          "raw_description": "FIGS BLACK MISSION FRESH",
          "substituted_sku": null,
          "pack_description": "12/8 OZ"
        },
        {
          "amount": 870.24,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "pack_unit": "lb",
          "unit_price": 29.4,
          "vendor_sku": "13544",
          "description": "RWPR 103 RIB REF",
          "qty_ordered": 1,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 25,
          "is_substitution": false,
          "raw_description": "RWPR 103 RIB REF",
          "substituted_sku": null,
          "pack_description": "1 PC/25#"
        },
        {
          "amount": 0,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-007",
              "field": "qty_received",
              "message": "Qty mismatch: ordered 1, shipped 0 of SQUASH BLOSSOMS FRESH",
              "possible_reasons": [
                "Short shipped",
                "Back ordered",
                "Vendor error",
                "Substitution"
              ]
            },
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: SQUASH BLOSSOMS FRESH (25 CT)"
            }
          ],
          "pack_unit": "ct",
          "unit_price": 29.57,
          "vendor_sku": "03421",
          "description": "SQUASH BLOSSOMS FRESH",
          "qty_ordered": 1,
          "qty_received": 0,
          "purchase_unit": "each",
          "pack_size_each": 25,
          "is_substitution": false,
          "raw_description": "SQUASH BLOSSOMS FRESH",
          "substituted_sku": null,
          "pack_description": "25 CT"
        }
      ],
      "total": 1400.2,
      "vendor": "Hardie's Fresh Foods / Dairyland Produce",
      "subtotal": 1400.2,
      "warnings": [],
      "order_date": "2026-09-11",
      "order_number": null,
      "storage_path": "invoices/gmail/1789146326907_INVOICE_-_07119341.pdf",
      "delivery_date": "2026-09-11",
      "document_type": "invoice",
      "original_filename": "INVOICE_-_07119341.pdf"
    }
  },
  {
    "id": "33497f88-dea5-498e-9c6e-7397fe630820",
    "document_number": "07133808",
    "document_type": "invoice",
    "vendor": "Hardie's Fresh Foods / Dairyland Produce",
    "warnings": [
      {
        "code": "OQR-007",
        "item": "TOMATO CHERRY ON THE VINE",
        "field": "qty_received",
        "message": "Qty mismatch: ordered 5, shipped 0 of TOMATO CHERRY ON THE VINE",
        "possible_reasons": [
          "Short shipped",
          "Back ordered",
          "Vendor error",
          "Substitution"
        ]
      },
      {
        "code": "OQR-006",
        "item": "BLACKBERRY",
        "field": "pack_unit",
        "message": "Count-based: BLACKBERRY (3 CT) — no weight for costing"
      },
      {
        "code": "OQR-006",
        "item": "BLUEBERRY",
        "field": "pack_unit",
        "message": "Count-based: BLUEBERRY (3 CT) — no weight for costing"
      },
      {
        "code": "OQR-006",
        "item": "FLOWER MARIGOLD",
        "field": "pack_unit",
        "message": "Count-based: FLOWER MARIGOLD (50 CT) — no weight for costing"
      },
      {
        "code": "OQR-006",
        "item": "LEMON CHOICE",
        "field": "pack_unit",
        "message": "Count-based: LEMON CHOICE (95 CT) — no weight for costing"
      },
      {
        "code": "OQR-006",
        "item": "CANTALOUPE",
        "field": "pack_unit",
        "message": "Count-based: CANTALOUPE (3 CT) — no weight for costing"
      },
      {
        "code": "OQR-007",
        "item": "SQUASH BABY ZUCCHINI",
        "field": "qty_received",
        "message": "Qty mismatch: ordered 2, shipped 0 of SQUASH BABY ZUCCHINI",
        "possible_reasons": [
          "Short shipped",
          "Back ordered",
          "Vendor error",
          "Substitution"
        ]
      },
      {
        "code": "OQR-006",
        "item": "TOMATO BEEFSTEAK RED",
        "field": "pack_unit",
        "message": "Count-based: TOMATO BEEFSTEAK RED (16-22 CT) — no weight for costing"
      }
    ],
    "parsed_json": {
      "tax": null,
      "items": [
        {
          "qty": 0,
          "amount": 0,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-007",
              "field": "qty_received",
              "message": "Qty mismatch: ordered 5, shipped 0 of TOMATO CHERRY ON THE VINE",
              "possible_reasons": [
                "Short shipped",
                "Back ordered",
                "Vendor error",
                "Substitution"
              ]
            }
          ],
          "cool_flag": false,
          "pack_unit": "lb",
          "unit_price": 26,
          "vendor_sku": "07673",
          "catchweight": false,
          "description": "TOMATO CHERRY ON THE VINE",
          "purchasable": false,
          "qty_ordered": 5,
          "price_per_lb": null,
          "qty_received": 0,
          "purchase_unit": "lb",
          "pack_size_each": 11,
          "is_substitution": false,
          "raw_description": "TOMATO CHERRY ON THE VINE",
          "substituted_sku": null,
          "actual_weight_lb": null,
          "pack_description": "11#"
        },
        {
          "qty": 6,
          "amount": 146.7,
          "origin": null,
          "pack_qty": null,
          "warnings": [],
          "cool_flag": false,
          "pack_unit": null,
          "unit_price": 24.45,
          "vendor_sku": "25618",
          "catchweight": false,
          "description": "CHZ MOZZ BURRATA BELGIOIOSO",
          "qty_ordered": 6,
          "price_per_lb": null,
          "qty_received": 6,
          "purchase_unit": null,
          "pack_size_each": null,
          "is_substitution": false,
          "raw_description": "CHZ MOZZ BURRATA BELGIOIOSO",
          "substituted_sku": null,
          "actual_weight_lb": null,
          "pack_description": "6-4/2 oz"
        },
        {
          "qty": 4,
          "amount": 88.88,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "cool_flag": false,
          "pack_unit": "lb",
          "unit_price": 22.22,
          "vendor_sku": "25265",
          "catchweight": true,
          "description": "CHZ MOZZ SHRED GRANDE W/M",
          "qty_ordered": 4,
          "price_per_lb": 22.22,
          "qty_received": 4,
          "purchase_unit": "lb",
          "pack_size_each": 5,
          "is_substitution": false,
          "raw_description": "CHZ MOZZ SHRED GRANDE W/M",
          "substituted_sku": null,
          "actual_weight_lb": 4,
          "pack_description": "5#"
        },
        {
          "qty": 2,
          "amount": 147.56,
          "origin": null,
          "pack_qty": 11,
          "warnings": [],
          "cool_flag": false,
          "pack_unit": "lb",
          "unit_price": 73.78,
          "vendor_sku": "00108",
          "catchweight": false,
          "description": "ASPARAGUS LARGE",
          "qty_ordered": 2,
          "price_per_lb": null,
          "qty_received": 2,
          "purchase_unit": "lb",
          "pack_size_each": 1,
          "is_substitution": false,
          "raw_description": "ASPARAGUS LARGE",
          "substituted_sku": null,
          "actual_weight_lb": null,
          "pack_description": "11/1#"
        },
        {
          "qty": 1,
          "amount": 10.93,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: BLACKBERRY (3 CT) — no weight for costing"
            }
          ],
          "cool_flag": false,
          "pack_unit": "ct",
          "unit_price": 10.93,
          "vendor_sku": "00254",
          "catchweight": false,
          "description": "BLACKBERRY",
          "qty_ordered": 1,
          "price_per_lb": null,
          "qty_received": 1,
          "purchase_unit": "each",
          "pack_size_each": 3,
          "is_substitution": false,
          "raw_description": "BLACKBERRY",
          "substituted_sku": null,
          "actual_weight_lb": null,
          "pack_description": "3 CT"
        },
        {
          "qty": 1,
          "amount": 8.93,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: BLUEBERRY (3 CT) — no weight for costing"
            }
          ],
          "cool_flag": false,
          "pack_unit": "ct",
          "unit_price": 8.93,
          "vendor_sku": "00262",
          "catchweight": false,
          "description": "BLUEBERRY",
          "qty_ordered": 1,
          "price_per_lb": null,
          "qty_received": 1,
          "purchase_unit": "each",
          "pack_size_each": 3,
          "is_substitution": false,
          "raw_description": "BLUEBERRY",
          "substituted_sku": null,
          "actual_weight_lb": null,
          "pack_description": "3 CT"
        },
        {
          "qty": 2,
          "amount": 8.72,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "cool_flag": false,
          "pack_unit": "lb",
          "unit_price": 4.36,
          "vendor_sku": "00459",
          "catchweight": false,
          "description": "CARROT JUMBO",
          "qty_ordered": 2,
          "price_per_lb": null,
          "qty_received": 2,
          "purchase_unit": "lb",
          "pack_size_each": 5,
          "is_substitution": false,
          "raw_description": "CARROT JUMBO",
          "substituted_sku": null,
          "actual_weight_lb": null,
          "pack_description": "5#"
        },
        {
          "qty": 2,
          "amount": 77.12,
          "origin": null,
          "pack_qty": 8,
          "warnings": [],
          "cool_flag": false,
          "pack_unit": "lb",
          "unit_price": 4.82,
          "vendor_sku": "27786",
          "catchweight": false,
          "description": "CHZ MOZZ THIN SLICE 21 SLI/LB",
          "qty_ordered": 2,
          "price_per_lb": null,
          "qty_received": 2,
          "purchase_unit": "lb",
          "pack_size_each": 1,
          "is_substitution": false,
          "raw_description": "CHZ MOZZ THIN SLICE 21 SLI/LB",
          "substituted_sku": null,
          "actual_weight_lb": null,
          "pack_description": "8/1#"
        },
        {
          "qty": 1,
          "amount": 16.65,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: FLOWER MARIGOLD (50 CT) — no weight for costing"
            }
          ],
          "cool_flag": false,
          "pack_unit": "ct",
          "unit_price": 16.65,
          "vendor_sku": "05840",
          "catchweight": false,
          "description": "FLOWER MARIGOLD",
          "qty_ordered": 1,
          "price_per_lb": null,
          "qty_received": 1,
          "purchase_unit": "each",
          "pack_size_each": 50,
          "is_substitution": false,
          "raw_description": "FLOWER MARIGOLD",
          "substituted_sku": null,
          "actual_weight_lb": null,
          "pack_description": "50 CT"
        },
        {
          "qty": 1,
          "amount": 14.21,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "cool_flag": false,
          "pack_unit": "lb",
          "unit_price": 14.21,
          "vendor_sku": "01296",
          "catchweight": false,
          "description": "HERB ARUGULA WILD B&W",
          "qty_ordered": 1,
          "price_per_lb": null,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 3,
          "is_substitution": false,
          "raw_description": "HERB ARUGULA WILD B&W",
          "substituted_sku": null,
          "actual_weight_lb": null,
          "pack_description": "3#"
        },
        {
          "qty": 1,
          "amount": 9,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "cool_flag": false,
          "pack_unit": "lb",
          "unit_price": 9,
          "vendor_sku": "01306",
          "catchweight": false,
          "description": "HERB BASIL",
          "qty_ordered": 1,
          "price_per_lb": null,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 1,
          "is_substitution": false,
          "raw_description": "HERB BASIL",
          "substituted_sku": null,
          "actual_weight_lb": null,
          "pack_description": "1#"
        },
        {
          "qty": 1,
          "amount": 46.47,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: LEMON CHOICE (95 CT) — no weight for costing"
            }
          ],
          "cool_flag": false,
          "pack_unit": "ct",
          "unit_price": 46.47,
          "vendor_sku": "71104",
          "catchweight": false,
          "description": "LEMON CHOICE",
          "qty_ordered": 1,
          "price_per_lb": null,
          "qty_received": 1,
          "purchase_unit": "each",
          "pack_size_each": 95,
          "is_substitution": false,
          "raw_description": "LEMON CHOICE",
          "substituted_sku": null,
          "actual_weight_lb": null,
          "pack_description": "95 CT"
        },
        {
          "qty": 1,
          "amount": 9.61,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: CANTALOUPE (3 CT) — no weight for costing"
            }
          ],
          "cool_flag": false,
          "pack_unit": "ct",
          "unit_price": 9.61,
          "vendor_sku": "01839",
          "catchweight": false,
          "description": "CANTALOUPE",
          "qty_ordered": 1,
          "price_per_lb": null,
          "qty_received": 1,
          "purchase_unit": "each",
          "pack_size_each": 3,
          "is_substitution": false,
          "raw_description": "CANTALOUPE",
          "substituted_sku": null,
          "actual_weight_lb": null,
          "pack_description": "3 CT"
        },
        {
          "qty": 2,
          "amount": 25.86,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "cool_flag": false,
          "pack_unit": "lb",
          "unit_price": 12.93,
          "vendor_sku": "01981",
          "catchweight": true,
          "description": "ORGANIC SPRING MIX",
          "qty_ordered": 2,
          "price_per_lb": 12.93,
          "qty_received": 2,
          "purchase_unit": "lb",
          "pack_size_each": 3,
          "is_substitution": false,
          "raw_description": "ORGANIC SPRING MIX",
          "substituted_sku": null,
          "actual_weight_lb": 2,
          "pack_description": "3#"
        },
        {
          "qty": 2,
          "amount": 21.12,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "cool_flag": false,
          "pack_unit": "lb",
          "unit_price": 10.56,
          "vendor_sku": "02656",
          "catchweight": false,
          "description": "PEPPER RED BELL CHOPPER",
          "qty_ordered": 2,
          "price_per_lb": null,
          "qty_received": 2,
          "purchase_unit": "lb",
          "pack_size_each": 5,
          "is_substitution": false,
          "raw_description": "PEPPER RED BELL CHOPPER",
          "substituted_sku": null,
          "actual_weight_lb": null,
          "pack_description": "5#"
        },
        {
          "qty": 1,
          "amount": 26.77,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "cool_flag": false,
          "pack_unit": "lb",
          "unit_price": 26.77,
          "vendor_sku": "71814",
          "catchweight": false,
          "description": "SQUASH ZUCCHINI FANCY",
          "qty_ordered": 1,
          "price_per_lb": null,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 18,
          "is_substitution": false,
          "raw_description": "SQUASH ZUCCHINI FANCY",
          "substituted_sku": null,
          "actual_weight_lb": null,
          "pack_description": "18-22#"
        },
        {
          "qty": 0,
          "amount": 0,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-007",
              "field": "qty_received",
              "message": "Qty mismatch: ordered 2, shipped 0 of SQUASH BABY ZUCCHINI",
              "possible_reasons": [
                "Short shipped",
                "Back ordered",
                "Vendor error",
                "Substitution"
              ]
            }
          ],
          "cool_flag": false,
          "pack_unit": "lb",
          "unit_price": 31.1,
          "vendor_sku": "03493",
          "catchweight": false,
          "description": "SQUASH BABY ZUCCHINI",
          "purchasable": false,
          "qty_ordered": 2,
          "price_per_lb": null,
          "qty_received": 0,
          "purchase_unit": "lb",
          "pack_size_each": 5,
          "is_substitution": false,
          "raw_description": "SQUASH BABY ZUCCHINI",
          "substituted_sku": null,
          "actual_weight_lb": null,
          "pack_description": "5#"
        },
        {
          "qty": 1,
          "amount": 3.94,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "cool_flag": false,
          "pack_unit": "lb",
          "unit_price": 3.94,
          "vendor_sku": "10762",
          "catchweight": false,
          "description": "GRAPES RED SEEDLESS",
          "qty_ordered": 1,
          "price_per_lb": null,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 2,
          "is_substitution": false,
          "raw_description": "GRAPES RED SEEDLESS",
          "substituted_sku": null,
          "actual_weight_lb": null,
          "pack_description": "2#"
        },
        {
          "qty": 1,
          "amount": 12,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "cool_flag": false,
          "pack_unit": "lb",
          "unit_price": 12,
          "vendor_sku": "01385",
          "catchweight": false,
          "description": "HERB SAGE",
          "qty_ordered": 1,
          "price_per_lb": null,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 1,
          "is_substitution": false,
          "raw_description": "HERB SAGE",
          "substituted_sku": null,
          "actual_weight_lb": null,
          "pack_description": "1#"
        },
        {
          "qty": 1,
          "amount": 1084,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "cool_flag": false,
          "pack_unit": "lb",
          "unit_price": 13.55,
          "vendor_sku": "00907",
          "catchweight": true,
          "description": "CHZ PARMESAN REGGIANO 24 MOS",
          "qty_ordered": 1,
          "price_per_lb": 13.55,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 80,
          "is_substitution": false,
          "raw_description": "CHZ PARMESAN REGGIANO 24 MOS",
          "substituted_sku": null,
          "actual_weight_lb": 80,
          "pack_description": "80#"
        },
        {
          "qty": 1,
          "amount": 9,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "cool_flag": false,
          "pack_unit": "lb",
          "unit_price": 9,
          "vendor_sku": "01374",
          "catchweight": false,
          "description": "HERB ROSEMARY",
          "qty_ordered": 1,
          "price_per_lb": null,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 1,
          "is_substitution": false,
          "raw_description": "HERB ROSEMARY",
          "substituted_sku": null,
          "actual_weight_lb": null,
          "pack_description": "1#"
        },
        {
          "qty": 1,
          "amount": 29.88,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "cool_flag": false,
          "pack_unit": "lb",
          "unit_price": 29.88,
          "vendor_sku": "02318",
          "catchweight": false,
          "description": "ONION RED MEDIUM",
          "qty_ordered": 1,
          "price_per_lb": null,
          "qty_received": 1,
          "purchase_unit": "lb",
          "pack_size_each": 25,
          "is_substitution": false,
          "raw_description": "ONION RED MEDIUM",
          "substituted_sku": null,
          "actual_weight_lb": null,
          "pack_description": "25#"
        },
        {
          "qty": 1,
          "amount": 22.63,
          "origin": null,
          "pack_qty": 1,
          "warnings": [
            {
              "code": "OQR-006",
              "field": "pack_unit",
              "message": "Count-based: TOMATO BEEFSTEAK RED (16-22 CT) — no weight for costing"
            }
          ],
          "cool_flag": false,
          "pack_unit": "ct",
          "unit_price": 22.63,
          "vendor_sku": "71904",
          "catchweight": false,
          "description": "TOMATO BEEFSTEAK RED",
          "qty_ordered": 1,
          "price_per_lb": null,
          "qty_received": 1,
          "purchase_unit": "each",
          "pack_size_each": 16,
          "is_substitution": false,
          "raw_description": "TOMATO BEEFSTEAK RED",
          "substituted_sku": null,
          "actual_weight_lb": null,
          "pack_description": "16-22 CT"
        },
        {
          "qty": 2,
          "amount": 76.82,
          "origin": null,
          "pack_qty": 1,
          "warnings": [],
          "cool_flag": false,
          "pack_unit": "lb",
          "unit_price": 38.41,
          "vendor_sku": "02079",
          "catchweight": false,
          "description": "MUSHROOM SHIITAKE",
          "qty_ordered": 2,
          "price_per_lb": null,
          "qty_received": 2,
          "purchase_unit": "lb",
          "pack_size_each": 5,
          "is_substitution": false,
          "raw_description": "MUSHROOM SHIITAKE",
          "substituted_sku": null,
          "actual_weight_lb": null,
          "pack_description": "5#"
        },
        {
          "qty": 5,
          "amount": 184.05,
          "origin": null,
          "pack_qty": 12,
          "warnings": [],
          "cool_flag": false,
          "pack_unit": "pt",
          "unit_price": 36.81,
          "vendor_sku": "71908",
          "catchweight": false,
          "description": "TOMATO CHERRY RED",
          "qty_ordered": 5,
          "price_per_lb": null,
          "qty_received": 5,
          "purchase_unit": "pt",
          "pack_size_each": 1,
          "is_substitution": false,
          "raw_description": "TOMATO CHERRY RED",
          "substituted_sku": null,
          "actual_weight_lb": null,
          "pack_description": "12/1 PT"
        }
      ],
      "total": 2080.85,
      "vendor": "Hardie's Fresh Foods / Dairyland Produce",
      "subtotal": 2080.85,
      "warnings": [],
      "order_date": "2026-09-21",
      "order_number": null,
      "storage_path": "invoices/gmail/1790006726526_INVOICE_-_07133808.pdf",
      "delivery_date": "2026-09-21",
      "document_type": "invoice",
      "original_filename": "INVOICE_-_07133808.pdf"
    }
  }
];
