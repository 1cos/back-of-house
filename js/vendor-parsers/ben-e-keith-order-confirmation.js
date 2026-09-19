// ── vendor-parsers/ben-e-keith-order-confirmation.js ─────────────────
// Ben E. Keith — Order Confirmation (email HTML). MICRO-TASK 42.
//
// CANONICAL, SINGLE SOURCE OF TRUTH. Consumed by three runtimes:
//   - Node (tests)                     → require('./ben-e-keith-order-confirmation')
//   - Deno (vendor-doc-auto-import)    → PARSER_SOURCES + makeCjsLoader shim
//   - Browser (js/vendor-parser-ui.js) → window.BekOrderConfirmationParser
// There must never be a second implementation of this logic.
//
// WHY NO DOMParser: it does not exist in Deno, and MICRO-TASK 32 excluded
// BEK from background auto-import for exactly that reason. The real email
// is a machine-generated SendGrid template with well-formed, explicitly
// closed table markup, so a deterministic depth-aware scanner reproduces
// what DOMParser gave us — without a browser global. No regex-only cell
// splitting: the PRICE cell contains its OWN nested <table>, so cells must
// be direct children of their row or ORDERED/CONFIRMED/STATUS shift onto
// the wrong values (the bug fixed in Task 11H, Bug 1).
//
// WHY SELF-CONTAINED (no require('./utils')): the browser copy is loaded
// as a plain <script> with no module loader, and the Deno shim resolves
// only what PARSER_SOURCES holds. Inlining the three tiny helpers this
// parser needs keeps one file working unchanged in all three runtimes.
// parseDate/parsePrice here are behaviourally identical to utils.js —
// tests/bek-canonical-parser.test.js pins that equivalence.
//
// ── TWO KINDS OF EMAIL UNDER ONE SUBJECT (measured, MICRO-TASK 42) ───
// Real production data (4 documents read from Gmail) shows Ben E. Keith
// sends two structurally identical emails with the same subject:
//
//   0003243454 16 Sep  8 items, all Filled,    confirmed>0  → a purchase
//   0003126637 06 Sep  4 items, all Filled,    confirmed>0  → a purchase
//   0003126637 04 Sep  4 items, all Requested, confirmed=0  → NOT a purchase
//   0003198361 12 Sep  8 items, all Requested, confirmed=0  → NOT a purchase
//
// The header text is NOT a usable signal: 0003198361 says "Your order is
// confirmed and ready for delivery" while every line is still Requested
// with confirmed 0. Classification therefore derives ONLY from the item
// rows (see classifyDocument), never from prose. The disclaimer sentence
// is kept as diagnostic evidence, never as the decision.
//
// ── TWO DIFFERENT TOTALS (measured) ─────────────────────────────────
// In all 4 real documents the vendor-declared "Order Total" equals
// Σ(unit_price × ORDERED) to the cent — including the two where CONFIRMED
// is 0 throughout. It is an ORDER-TIME total, not a delivery total. So:
//
//   computed_order_total    = Σ(price × ordered)   ← what the declared
//                                                    Order Total verifies;
//                                                    a parser-integrity check
//   computed_purchase_total = Σ(price × confirmed) ← the actual purchase
//
// Reconciling the purchase total against the declared total would block
// every short delivery, which is wrong: a short fill is a normal event
// that must still import, carrying only an informational BEK_QTY_SHORT.

'use strict';

// ── Minimal helpers (behaviour-identical to vendor-parsers/utils.js) ──

function parseDate(str) {
  if (!str) return null;
  str = String(str).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    const mo = String(parseInt(m[1], 10)).padStart(2, '0');
    const da = String(parseInt(m[2], 10)).padStart(2, '0');
    return `${year}-${mo}-${da}`;
  }
  return null;
}

function parsePrice(str) {
  if (str === null || str === undefined) return null;
  const n = parseFloat(String(str).replace(/[$,\s]/g, ''));
  return isNaN(n) ? null : n;
}

function cleanDescription(str) {
  if (!str) return '';
  return String(str).replace(/\s+/g, ' ').trim();
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Same convention as checkTotals / writeInvoiceLines — never a second one.
const RECONCILIATION_TOLERANCE = 0.02;

// ── HTML entities ────────────────────────────────────────────────────

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  copy: '©', reg: '®', trade: '™', hellip: '…',
  ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', deg: '°', middot: '·',
};

function decodeEntities(text) {
  if (!text) return '';
  return String(text).replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body.charAt(0) === '#') {
      const code = body.charAt(1) === 'x' || body.charAt(1) === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (!isFinite(code) || code < 0 || code > 0x10FFFF) return whole;
      try { return String.fromCodePoint(code); } catch (_e) { return whole; }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

function htmlToText(html) {
  if (!html) return '';
  return cleanDescription(
    decodeEntities(
      String(html)
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
    )
  );
}

// ── Depth-aware table scanner ────────────────────────────────────────
// Returns every <tr> in document order as an array of its DIRECT-CHILD
// <td> cells (inner HTML). A <td> belonging to a nested table is never
// reported as a cell of the outer row — that is the whole point.

const STRUCTURAL = { table: 1, thead: 1, tbody: 1, tfoot: 1, tr: 1, td: 1, th: 1 };
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;

function extractRows(html) {
  const src = String(html || '');
  const rows = [];
  const stack = [];
  let m;

  function topRow() {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].name === 'tr') return stack[i];
    }
    return null;
  }

  function closeCell(entry, endIndex) {
    const parent = stack.length ? stack[stack.length - 1] : null;
    if (parent && parent.name === 'tr') {
      parent.cells.push(src.slice(entry.contentStart, endIndex));
    }
  }

  function unwindTo(name, endIndex) {
    let idx = -1;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].name === name) { idx = i; break; }
    }
    if (idx === -1) return;
    while (stack.length > idx) {
      const entry = stack.pop();
      if (entry.name === 'td' || entry.name === 'th') closeCell(entry, endIndex);
      else if (entry.name === 'tr') rows.push(entry);
    }
  }

  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(src)) !== null) {
    const isClose = m[1] === '/';
    const name = m[2].toLowerCase();
    if (!STRUCTURAL[name]) continue;

    const tagStart = m.index;
    const tagEnd = TAG_RE.lastIndex;
    const selfClosing = /\/\s*$/.test(m[3] || '');

    if (isClose) { unwindTo(name, tagStart); continue; }
    if (selfClosing) continue;

    if (name === 'td' || name === 'th') {
      const top = stack.length ? stack[stack.length - 1] : null;
      if (top && (top.name === 'td' || top.name === 'th')) {
        stack.pop();
        closeCell(top, tagStart);
      }
    } else if (name === 'tr') {
      const rowTop = topRow();
      if (rowTop && stack[stack.length - 1] === rowTop) {
        stack.pop();
        rows.push(rowTop);
      }
    }

    stack.push({ name, contentStart: tagEnd, cells: [] });
  }

  while (stack.length) {
    const entry = stack.pop();
    if (entry.name === 'td' || entry.name === 'th') closeCell(entry, src.length);
    else if (entry.name === 'tr') rows.push(entry);
  }

  return rows.map(r => r.cells);
}

// ── Item status ──────────────────────────────────────────────────────
// Closed set. Anything unrecognised becomes 'unknown' and is reported —
// never silently coerced into a "fine" status.
//
// 'requested' is a REAL production status (measured on 0003126637 04 Sep
// and 0003198361 12 Sep): the order has been received but item
// confirmation has not happened yet.

const STATUS_REQUESTED = 'requested';

const STATUS_MAP = [
  [/^requested$/i,                      STATUS_REQUESTED],
  [/^filled$/i,                         'filled'],
  [/^partially\s*filled$/i,             'partially_filled'],
  [/back\s*-?\s*order/i,                'backordered'],
  [/^not\s*filled$/i,                   'not_filled'],
  [/cancel/i,                           'cancelled'],
  [/substitut/i,                        'substituted'],
  [/out\s*of\s*stock/i,                 'out_of_stock'],
  [/discontinu/i,                       'discontinued'],
];

function normalizeStatus(raw) {
  const s = cleanDescription(raw);
  if (!s) return { status_raw: '', status: 'unknown' };
  for (const [re, norm] of STATUS_MAP) {
    if (re.test(s)) return { status_raw: s, status: norm };
  }
  return { status_raw: s, status: 'unknown' };
}

// ── Document classification (MICRO-TASK 42, section A) ───────────────
// Derived ONLY from the parsed item rows. Never from headers, prose or
// the disclaimer sentence.
//
//   ACKNOWLEDGEMENT          every item confirmed=0 AND status=requested
//   OPERATIONAL_CONFIRMATION at least one item with confirmed>0
//   AMBIGUOUS                everything confirmed=0 but statuses are NOT
//                            all 'requested' (Cancelled / Not Filled /
//                            unknown …) — fail closed, never guessed

const DOC_CLASS_ACK       = 'acknowledgement';
const DOC_CLASS_OPERATION = 'operational_confirmation';
const DOC_CLASS_AMBIGUOUS = 'ambiguous';

function classifyDocument(items) {
  if (!items.length) return DOC_CLASS_AMBIGUOUS;

  const anyConfirmed = items.some(it => it.qty !== null && it.qty > 0);
  if (anyConfirmed) return DOC_CLASS_OPERATION;

  const allZero      = items.every(it => it.qty === 0);
  const allRequested = items.every(it => it.item_status === STATUS_REQUESTED);
  if (allZero && allRequested) return DOC_CLASS_ACK;

  return DOC_CLASS_AMBIGUOUS;
}

// ── Header fields ────────────────────────────────────────────────────

function extractSalesOrder(text, subject) {
  const m = text.match(/Sales\s*Order\s*#?\s*:?\s*\*?\s*(\d+)/i);
  if (m) return m[1];
  if (subject) {
    const sm = String(subject).match(/;\s*(\d+)\s*$/);
    if (sm) return sm[1];
  }
  return null;
}

function extractDeliveryDate(text) {
  const m = text.match(/Delivery\s*Date\s*:?\s*\*?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  return m ? parseDate(m[1]) : null;
}

function extractOrderTotal(text) {
  const m = text.match(/Order\s*Total\s*\*?\s*:?\s*\*?\s*\$?\s*([\d,]+\.\d{2})/i);
  return m ? parsePrice(m[1]) : null;
}

// Diagnostic evidence only — never a classification input.
const DISCLAIMER_RE = /Item\s+confirmation\s+will\s+occur\s+the\s+morning\s+before/i;

// ── Buyer / order owner (MICRO-TASK 48) ──────────────────────────────
// Ben E. Keith serves TWO order streams on the SAME Customer# (FDF770366,
// "ZENO'S ON THE SQUARE"): the kitchen brigade's orders and the front of
// house's. Measured on 56 real Gmail threads: Customer#, Branch, Customer
// Name, subject, sender and recipient are IDENTICAL on every one of them,
// so none of those can tell the two apart. The only field that differs is
// the `Email:` line in the confirmation header, which carries the address
// of whoever placed the order — 28 threads each, and zero with any third
// value.
//
// BOH OS must treat ONLY the kitchen stream as a purchase. The front of
// house stream is a real order, but not the chef's, and must never reach
// invoice_lines, ingredient_vendors, aliases or price intelligence.
//
// Allow-list, not deny-list, and FAIL CLOSED on anything unrecognised: a
// new buyer appearing tomorrow must stop and ask, never be silently
// assumed to be one side or the other.
const BUYER_EMAIL_RE = /Email:\s*\*?\s*([^\s*<>]+@[^\s*<>]+)/i;

const BEK_BUYER_KITCHEN = 'raven_wolf_1510@yahoo.com';
const BEK_BUYER_FOH     = 'zeno@zenosonthesquare.com';

const BUYER_KITCHEN  = 'kitchen';
const BUYER_EXCLUDED = 'excluded';
const BUYER_UNKNOWN  = 'unknown';

// Normalisation is deliberately minimal: trim + lowercase, nothing else.
// No fuzzy matching, no domain rules, no local-part tricks — an address
// either is one of the two known ones or it is not.
function normalizeBuyerEmail(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  return s === '' ? null : s;
}

function extractBuyerEmail(text) {
  const m = String(text || '').match(BUYER_EMAIL_RE);
  return m ? normalizeBuyerEmail(m[1]) : null;
}

// kitchen  → this is a chef purchase
// excluded → a real front-of-house order, deliberately not a chef purchase
// unknown  → missing or unrecognised: fail closed, never guessed
function classifyBuyer(email) {
  const e = normalizeBuyerEmail(email);
  if (e === BEK_BUYER_KITCHEN) return BUYER_KITCHEN;
  if (e === BEK_BUYER_FOH)     return BUYER_EXCLUDED;
  return BUYER_UNKNOWN;
}

// ── Quantity rule (MICRO-TASK 42, sections B and J) ──────────────────
//   confirmed > 0  → qty = confirmed
//   confirmed = 0  → qty = 0, item does not take part in the purchase
//   confirmed null → qty = null + BEK_CONFIRMED_MISSING (blocking)
// ORDERED is NEVER a fallback.

function resolveQuantity(confirmed) {
  if (confirmed !== null && confirmed !== undefined) {
    return { qty: confirmed, warnings: [] };
  }
  return {
    qty: null,
    warnings: [{
      code: 'BEK_CONFIRMED_MISSING',
      severity: 'blocking',
      message: 'CONFIRMED quantity missing or unreadable — refusing to fall back to ORDERED',
      field: 'qty_received',
    }],
  };
}

function toInt(raw) {
  const s = cleanDescription(raw);
  if (!/^-?\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

// ── Main parser ──────────────────────────────────────────────────────

const ITEM_CODE_RE = /^\d{4,8}$/;
const ITEM_CELL_COUNT = 8; // ITEM# NAME BRAND PACK/SIZE PRICE ORDERED CONFIRMED STATUS

function parse(rawHtml, opts) {
  const options = opts || {};
  const html = String(rawHtml || '');
  const docText = htmlToText(html);
  const warnings = [];

  const salesOrder   = extractSalesOrder(docText, options.subject);
  const deliveryDate = extractDeliveryDate(docText);
  const orderTotal   = extractOrderTotal(docText);
  const hasDisclaimer = DISCLAIMER_RE.test(docText);
  const buyerEmail = extractBuyerEmail(docText);
  const buyerClass = classifyBuyer(buyerEmail);

  const items = [];
  for (const cells of extractRows(html)) {
    if (cells.length < ITEM_CELL_COUNT) continue;
    const text = cells.map(htmlToText);
    const itemCode = text[0];
    if (!ITEM_CODE_RE.test(itemCode)) continue;

    const priceM = text[4].match(/\$?\s*([\d,]+\.\d{2})/);
    const unitPrice = priceM ? parsePrice(priceM[1]) : null;
    const ordered   = toInt(text[5]);
    const confirmed = toInt(text[6]);
    const { status_raw, status } = normalizeStatus(text[7]);
    const { qty, warnings: qtyWarnings } = resolveQuantity(confirmed);

    const lineWarnings = qtyWarnings.slice();
    if (unitPrice === null) {
      lineWarnings.push({
        code: 'BEK_PRICE_MISSING', severity: 'blocking',
        message: `No unit price found for item ${itemCode}`, field: 'unit_price',
      });
    }
    if (status === 'unknown' && status_raw) {
      lineWarnings.push({
        code: 'BEK_STATUS_UNKNOWN', severity: 'blocking',
        message: `Unrecognised item status "${status_raw}" for item ${itemCode}`, field: 'status',
      });
    }
    // Informational only — a short delivery must still import (section B).
    if (ordered !== null && qty !== null && qty > 0 && ordered !== qty) {
      lineWarnings.push({
        code: 'BEK_QTY_SHORT', severity: 'info',
        message: `Ordered ${ordered}, confirmed ${qty} for item ${itemCode} — recording ${qty}`,
        field: 'qty_received',
      });
    }

    // purchasable drives BOTH invoice_lines and price intelligence: an
    // item nobody confirmed was not bought, so it must never move a
    // price (MICRO-TASK 42, section E). The row still stays in
    // parsed_json so the document remains complete and auditable.
    const purchasable = qty !== null && qty > 0;

    items.push({
      vendor_sku:       itemCode,
      raw_description:  text[1],
      description:      cleanDescription(text[1]),
      brand:            text[2],
      pack_description: text[3],
      unit_price:       unitPrice,
      qty_ordered:      ordered,
      qty_received:     qty,
      qty:              qty,
      purchasable:      purchasable,
      item_status:      status,
      item_status_raw:  status_raw,
      price_type:       'per_case',
      amount: (unitPrice !== null && qty !== null) ? round2(unitPrice * qty) : null,
      warnings: lineWarnings,
    });
  }

  const documentClass = classifyDocument(items);

  // ── The two totals (MICRO-TASK 42, section C) ──────────────────────
  let orderedSum = 0, purchaseSum = 0, orderedComputable = items.length > 0;
  for (const it of items) {
    if (it.unit_price === null || it.qty_ordered === null) orderedComputable = false;
    else orderedSum += it.unit_price * it.qty_ordered;
    if (it.purchasable && it.amount !== null) purchaseSum += it.amount;
  }
  const computedOrderTotal    = orderedComputable ? round2(orderedSum) : null;
  const computedPurchaseTotal = items.length ? round2(purchaseSum) : null;

  // ── Parser integrity: ORDERED sum vs vendor-declared Order Total ───
  // Measured on 4 real documents: delta 0.00 every time. Tolerance is
  // the project-wide $0.02, never a new percentage.
  let reconciled = false;
  if (orderTotal !== null && computedOrderTotal !== null) {
    const delta = Math.abs(computedOrderTotal - orderTotal);
    if (delta > RECONCILIATION_TOLERANCE) {
      warnings.push({
        code: 'DOC-TOTAL-001', severity: 'blocking',
        message: `Ordered lines sum $${computedOrderTotal.toFixed(2)} but declared Order Total is $${orderTotal.toFixed(2)} — possible missing or misread lines`,
        sum_of_lines: computedOrderTotal,
        declared_total: orderTotal,
      });
    }
    // Judged here either way, so the generic checkTotals must not
    // re-judge it against the purchase sum (which legitimately differs
    // on a short delivery).
    reconciled = true;
  }

  if (!salesOrder) {
    warnings.push({
      code: 'BEK_NO_SALES_ORDER', severity: 'blocking',
      message: 'Sales Order number not found in email HTML or subject',
    });
  }
  if (items.length === 0) {
    // Mirrors Fruge's PARSE_ERROR_NO_LINES guard (MICRO-TASK 34).
    warnings.push({
      code: 'PARSE_ERROR_NO_LINES', severity: 'blocking',
      message: 'No item rows found in Ben E. Keith Order Confirmation HTML',
    });
  }
  if (documentClass === DOC_CLASS_AMBIGUOUS && items.length > 0) {
    warnings.push({
      code: 'BEK_CLASS_AMBIGUOUS', severity: 'blocking',
      message: 'No item confirmed, but statuses are not uniformly "Requested" — cannot decide whether this is a pre-confirmation acknowledgement or a failed order',
      statuses: items.map(i => i.item_status_raw),
    });
  }

  return {
    vendor:          'Ben E. Keith',
    document_type:   'order_confirmation',
    document_class:  documentClass,
    document_number: salesOrder,
    document_date:   deliveryDate,
    delivery_date:   deliveryDate,
    // subtotal stays null on purpose: publishing our own computed sum
    // here would make checkTotals compare the sum against itself.
    subtotal:        null,
    total:           orderTotal,
    computed_order_total:    computedOrderTotal,
    computed_purchase_total: computedPurchaseTotal,
    // MICRO-TASK 48 — who placed this order. `buyer_class` is the
    // decision; `buyer_email` is kept as the evidence behind it.
    buyer_email:  buyerEmail,
    buyer_class:  buyerClass,
    // Diagnostic evidence, never a classification input.
    has_confirmation_disclaimer: hasDisclaimer,
    // Tells the shared checkTotals this parser already reconciled its own
    // totals. Generic flag — not a vendor special case.
    totals_reconciled: reconciled,
    items,
    warnings,
  };
}

// ── Purchasable document types (MICRO-TASK 42, section I) ────────────
// Lives HERE, in the BEK module, because BEK is the only reason the rule
// is not simply "invoice". vendor-parsers/index.js re-exports it, the
// Edge Function reaches it through loadParsers(), and the browser through
// window.BekOrderConfirmationParser — one definition, three runtimes, no
// divergent copies.
//
// TRUE for:
//   1. any vendor's invoice (unchanged behaviour)
//   2. Ben E. Keith order_confirmation — BEK sends no separate invoice,
//      so the confirmation IS the operational purchase document
//
// Deliberately NOT true for any other vendor's order_confirmation:
// Hardie's and FreshPoint confirmations are followed by a real invoice,
// and treating them as purchases would double-count.
const BEK_VENDOR_RE = /^(?:ben\s*e\.?\s*keith|bek)$/i;

function isBenEKeith(vendor) {
  return BEK_VENDOR_RE.test(String(vendor == null ? '' : vendor).trim());
}

function isPurchasableDocument(vendor, documentType) {
  if (documentType === 'invoice') return true;
  if (documentType === 'order_confirmation' && isBenEKeith(vendor)) return true;
  return false;
}

const API = {
  parse,
  classifyDocument,
  classifyBuyer,
  extractBuyerEmail,
  normalizeBuyerEmail,
  BEK_BUYER_KITCHEN,
  BEK_BUYER_FOH,
  BUYER_KITCHEN,
  BUYER_EXCLUDED,
  BUYER_UNKNOWN,
  isPurchasableDocument,
  isBenEKeith,
  extractRows,
  htmlToText,
  decodeEntities,
  normalizeStatus,
  resolveQuantity,
  parseDate,
  parsePrice,
  DOC_CLASS_ACK,
  DOC_CLASS_OPERATION,
  DOC_CLASS_AMBIGUOUS,
  RECONCILIATION_TOLERANCE,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = API;
}
if (typeof window !== 'undefined') {
  window.BekOrderConfirmationParser = API;
}
