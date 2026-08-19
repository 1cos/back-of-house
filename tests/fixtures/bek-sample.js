'use strict';
// ── Fixture Ben E. Keith — formato colonne da bek-invoice.js ────────
// Location(SKU) | Cases(Qty) | Pkgs | Item# | Brand | MfgCode | PackSize | Description | UnitPrice | Amount
// Nessuna fixture BEK preesisteva nel repo (Task 8): creata qui, dati non reali,
// nessun documento production coinvolto.

const BEK_FIXTURE_INVOICE = `
BEN E. KEITH FOODS
Fort Worth Division
INVOICE
Invoice # 12345678
Invoice Date 08/15/2026
Customer: ZENOS ON THE SQUARE

Location  Cases  Pkgs  Item#   Brand       MfgCode         PackSize     Description                          UnitPrice  Amount
AF09212   1      1     120033  TYSON       4088500012345   2/10 LB      Chicken Breast Boneless Skinless      45.00      45.00
700150    3      1     130044  GOLD MEDAL  8000200098765   1/50 LB      Flour All Purpose Enriched             22.50      67.50
DW04455   2      1     145099  COLAVITA    7612345098765   3/1 GAL      Olive Oil Extra Virgin                 38.75      77.50
BF11220   1      1     155200  GULF PRIDE  9098765043210   12/22-24 OZ  Salmon Fillet Fresh Atlantic            96.00      96.00

Total Invoice 286.00
`;

// Testo di controllo per T2 (non deve essere classificato come BEK)
const NOT_BEK_TEXT = `
Random memo mentioning a person named Keith who works in receiving.
No vendor invoice content here at all.
`;

module.exports = { BEK_FIXTURE_INVOICE, NOT_BEK_TEXT };
