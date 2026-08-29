// ── vendor-parsers/walmart-trevipay-invoice.js ───────────────────────
// Parser for Walmart Business / TreviPay INVOICE
//
// Input contract: this parser receives text ALREADY normalized by the
// TreviPay-specific preprocessing introduced in commit 8325ed5
// (vdrNormalizeTreviPayPage in vendor-documents-review.js) — Private Use
// Area digit/decimal/minus codepoints already decoded, gap-aware column
// join already applied. This file does NOT re-implement PUA decoding,
// gap-aware joins, or any PDF.js extraction — those responsibilities
// belong exclusively to the normalizer. It only ever consumes a plain
// string via parse(rawText), same as every other vendor parser.
//
// Real-document audit findings this parser is built against (4 real
// TreviPay invoices: c51dd720 Kitchen, 6c246fda/12fd6860/30082536 Bar —
// the latter 3 used strictly as technical PDF-format samples):
//
// - Header fields (Invoice #, Buyer, Seller, dates, Order Number, totals)
//   are printed by a fixed template, but table-layout artifacts merge
//   unrelated columns onto the same output line in a few specific,
//   repeatable spots (e.g. the Bill-To address's "United States" line
//   ends up sharing a row with the Buyer value) — handled by anchoring
//   extraction to the surrounding fixed boilerplate text, not raw
//   position.
// - The item table can repeat its column header ("SKU Description
//   Quantity...") more than once when it spans multiple PDF pages
//   (confirmed real in 30082536) — handled by re-entering table-scan
//   mode on every occurrence, not just the first.
// - A SKU can wrap onto a second physical line as a short digit-only
//   fragment (confirmed real in c51dd720: "1350811700" / "5" →
//   "13508117005") — handled by a narrow, bounded structural rule (Part
//   E), never a hardcoded value.
// - Tax is optional per line ("Tax1 X.XXXX%" + a dollar amount) and can
//   be non-zero (confirmed real in 6c246fda/12fd6860).
// - Two known non-ingredient row types exist and must be preserved for
//   reconciliation without ever being treated as purchasable products:
//   "Shipping" rows, and a single "ALT_PAYMENT_METHODS" adjustment row
//   (confirmed real in 6c246fda, negative amount, its own SKU-column
//   text wraps across 3 short fragments — reconstructing that exact
//   fragmented text buys nothing, so a fixed canonical label is used
//   once the row is recognised by its stable "ALT_PAYME" lead fragment).

'use strict';

const { parseDate, parsePrice, cleanDescription } = require('./utils');

// ── Header field extraction ───────────────────────────────────────────

function firstMatch(text, re) {
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

// "Buyer" the label and its value never sit on the same output line —
// the Bill-To address block's line count varies relative to the
// Buyer/Seller block, so by the time both reach the same PDF row, the
// merge always lands on the Bill-To address's own "United States" line
// (confirmed identical in all 4 real samples). A bare "United States"
// line (the Seller's own address, further down) has nothing after it,
// so requiring trailing content here is what keeps this from ever
// matching the Seller's country line instead.
//
// FIX (empty-Buyer parity task): the gap between "United States" and
// the value must be horizontal whitespace only ([ \t]+), never \s+ —
// \s matches newlines too, so when the Buyer field is genuinely blank
// (nothing after "United States" on its own line), \s+ silently walked
// forward across the line break and grabbed whatever non-blank text
// came next (e.g. "Seller", or later boilerplate) instead of failing to
// match. With the gap restricted to the same physical line, a blank
// field now correctly yields no match at all → buyer stays null, never
// inferred from Seller/Walmart Business/Group or any other nearby label.
function extractBuyer(text) {
  return firstMatch(text, /United States[ \t]+(\S.+)$/m);
}

function valueAfterLabel(lines, label) {
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].trim() === label) return lines[i + 1].trim();
  }
  return null;
}

function extractHeader(text, lines) {
  const documentNumber =
    firstMatch(text, /Please Reference Invoice\s+(\S+)\s*\|/i) ||
    firstMatch(text, /Invoice\s+(\S+)\s+(?:How To Pay|Invoice Summary)/i);

  const invoiceDate = parseDate(valueAfterLabel(lines, 'Invoice Date'));
  const dueDate     = parseDate(valueAfterLabel(lines, 'Due Date'));
  const seller      = valueAfterLabel(lines, 'Seller') || 'Walmart Business';
  const buyer       = extractBuyer(text);

  // "Order Number PO Number" is the label row; its value row is two
  // whitespace-separated tokens ("-" means no PO number on this invoice).
  let walmartOrderNumber = null;
  let poNumber = null;
  const labelIdx = lines.findIndex(l => /^Order Number\s+PO Number$/.test(l.trim()));
  if (labelIdx > -1 && lines[labelIdx + 1]) {
    const valueLine = lines[labelIdx + 1].trim();
    const m = valueLine.match(/^(\S+)\s+(\S+)$/);
    if (m) {
      walmartOrderNumber = m[1];
      poNumber = m[2] === '-' ? null : m[2];
    } else {
      walmartOrderNumber = valueLine || null;
    }
  }

  const subtotal = parsePrice(firstMatch(text, /Pre-Tax Subtotal\s+\$(-?[\d,.]+)/i));
  const tax      = parsePrice(firstMatch(text, /Taxes Subtotal\s+\$(-?[\d,.]+)/i));
  const total    = parsePrice(firstMatch(text, /Total Due as of\s+[\d/]+\s+\$(-?[\d,.]+)/i));

  return { documentNumber, invoiceDate, dueDate, seller, buyer, walmartOrderNumber, poNumber, subtotal, tax, total };
}

// ── Line items ─────────────────────────────────────────────────────────

const HEADER_ROW_RE   = /^SKU\s+Description\s+Quantity/;
const SUMMARY_ROW_RE  = /Invoice Summary/;
// ── MARKER:WALMART_SKU_FRAGMENT_START ──────────────────────────────
// A wrapped SKU continuation is a line containing ONLY digits, nothing
// else — real example: "1350811700" then, alone on the next physical
// line, "5". Bounded to 1–4 digits (the only real example is 1 digit;
// this leaves headroom without being loose enough to ever swallow a
// genuine 5+ digit SKU that starts its own row) and only merges into a
// row whose own SKU is itself purely numeric (never onto a Shipping/
// ALT_PAYMENT_METHODS row, whose SKU is text) and only up to a sane
// total reconstructed length — real UPC/EAN-style codes top out at 13
// digits, so 14 is used as a hard ceiling.
const SKU_FRAGMENT_RE = /^\d{1,4}$/;
const MAX_RECONSTRUCTED_SKU_LEN = 14;

function isSkuFragmentContinuation(line, currentItem) {
  if (!SKU_FRAGMENT_RE.test(line)) return false;
  if (!currentItem || currentItem.line_type !== 'product') return false;
  if (!/^\d+$/.test(currentItem.vendor_sku)) return false;
  return (currentItem.vendor_sku.length + line.length) <= MAX_RECONSTRUCTED_SKU_LEN;
}
// ── MARKER:WALMART_SKU_FRAGMENT_END ────────────────────────────────

// Trailing numeric columns. The optional "Tax Details" column only ever
// contributes its percentage (e.g. "0.0824%") to the FIRST continuation
// line, never to the row-start line itself — confirmed real in
// 6c246fda/12fd6860: the row-start line only ever contains "...Tax1"
// followed directly by the SAME dollar amount twice (once for the Tax
// Details column's own dollar sub-total, once for the aggregate Tax
// column) and then Billed Total. The percentage is picked up separately,
// from the continuation line, in extractItems() below.
//
// Every dollar column captures its sign SEPARATELY from its magnitude
// (real data prints negative amounts as "-$21.26" — minus before the
// dollar sign, e.g. the ALT_PAYMENT_METHODS adjustment — not "$-21.26").
const SIGNED_MONEY = '(-?)\\$([\\d,.]+)';
const TAIL_WITH_TAXDETAIL = new RegExp(
  '^(.*?)\\s+(\\d+)\\s+' + SIGNED_MONEY + '\\s+' + SIGNED_MONEY +
  '\\s+Tax1\\s+' + SIGNED_MONEY + '\\s+' + SIGNED_MONEY + '\\s+' + SIGNED_MONEY + '\\s*$'
);
const TAIL_PLAIN = new RegExp(
  '^(.*?)\\s+(\\d+)\\s+' + SIGNED_MONEY + '\\s+' + SIGNED_MONEY +
  '\\s+' + SIGNED_MONEY + '\\s+' + SIGNED_MONEY + '\\s*$'
);

function signedPrice(sign, magnitude) {
  const n = parsePrice(magnitude);
  return n === null ? null : (sign === '-' ? -n : n);
}

function parseRowStart(line) {
  let m = line.match(TAIL_WITH_TAXDETAIL);
  let hasTaxDetail = false;
  if (m) {
    hasTaxDetail = true;
  } else {
    m = line.match(TAIL_PLAIN);
  }
  if (!m) return null;

  const skuAndDesc = m[1].trim();
  const qty        = parseInt(m[2], 10);
  let unitPrice, discount, tax, amount;
  if (hasTaxDetail) {
    // groups: 1 desc, 2 qty, 3/4 unit_price, 5/6 discount,
    // 7/8 tax-detail-dup (unused), 9/10 tax, 11/12 billed_total
    unitPrice = signedPrice(m[3], m[4]);
    discount  = signedPrice(m[5], m[6]);
    tax       = signedPrice(m[9], m[10]);
    amount    = signedPrice(m[11], m[12]);
  } else {
    // groups: 1 desc, 2 qty, 3/4 unit_price, 5/6 discount, 7/8 tax, 9/10 billed_total
    unitPrice = signedPrice(m[3], m[4]);
    discount  = signedPrice(m[5], m[6]);
    tax       = signedPrice(m[7], m[8]);
    amount    = signedPrice(m[9], m[10]);
  }

  // Known non-product placeholder rows (same real-template convention as
  // Shipping/ALT_PAYMENT_METHODS above), confirmed real in invoice
  // 26104552: an Express Fee (HANDLING) and, appearing multiple times,
  // a SubDown/FULFILL_VARIANCE fulfillment-substitution charge. Checked
  // against the FULL skuAndDesc blob, not the generic single-token split
  // below — unlike "Shipping" or "ALT_PAYME", their SKU-column
  // placeholder is itself multi-word ("Express Fee"), so splitting on
  // the first space alone would wrongly cut it as "Express" + "Fee
  // HANDLING". Before this fix, neither shape matched any recognised
  // row-start, so both fell through to continuation handling and were
  // silently absorbed into the PRECEDING product row's description —
  // losing $1.93/$10.29/$14.65 as structured line items and corrupting
  // that product's own description (confirmed against the real PDF).
  const handlingMatch = skuAndDesc.match(/^(Express\s+Fee)\s+(HANDLING)$/i);
  const fulfillVarianceMatch = skuAndDesc.match(/^(SubDown)\s+(FULFILL_VARIANCE)$/i);

  let lineType, vendorSku, description;
  if (handlingMatch) {
    lineType = 'handling';
    vendorSku = handlingMatch[1];
    description = handlingMatch[2];
  } else if (fulfillVarianceMatch) {
    lineType = 'fulfillment_variance';
    vendorSku = fulfillVarianceMatch[1];
    description = fulfillVarianceMatch[2];
  } else {
    const tokenMatch = skuAndDesc.match(/^(\S+)\s+(.*)$/);
    if (!tokenMatch) return null;
    const leadToken  = tokenMatch[1];
    const descFirst  = tokenMatch[2].trim();

    lineType = 'product';
    vendorSku = leadToken;
    description = descFirst;

    if (/^shipping$/i.test(leadToken)) {
      lineType = 'shipping';
    } else if (/^ALT_PAYME/i.test(leadToken)) {
      // See file header comment: the SKU-column text for this row wraps
      // across several short fragments across multiple lines; only the
      // stable lead fragment is used for detection. Reconstructing the
      // exact wrapped spelling is not attempted — a fixed canonical label
      // is used instead, since it is always this same placeholder text.
      lineType = 'adjustment';
      vendorSku = 'ALT_PAYMENT_METHODS';
      description = 'Alternative Payment Methods';
    } else if (!/^\d{5,}$/.test(leadToken)) {
      // Not a recognised row-start shape at all (neither a 5+ digit SKU,
      // Shipping, the adjustment placeholder, nor Handling/Fulfillment
      // Variance) — reject so the caller falls through to continuation
      // handling instead of misfiling unrelated text as a new product row.
      return null;
    }
  }

  return {
    vendor_sku:       vendorSku,
    raw_description:  description,
    description:      description,
    qty_ordered:      qty,
    qty_received:     qty,
    qty:              qty,
    unit_price:       unitPrice,
    discount:         discount || 0,
    tax:              tax || 0,
    tax_rate:         null,
    amount:           amount,
    line_total:       amount,
    line_type:        lineType,
    warnings:         [],
    // Adjustment row's SKU-column wrap fragments ("NT_METHO Methods",
    // "DS") are swallowed, never appended to description — see file
    // header comment.
    _swallowContinuation: lineType === 'adjustment',
    _descParts: [description],
  };
}

// Deterministic pack/weight extraction from the free-text description.
// Conservative by design — three explicit safety rules:
//   1. A catch-weight RANGE shape ("1.50-4.30 lb" / "2.75  7.0 lb",
//      confirmed real in 26104552 — the gap between the two numbers is a
//      dash, the unmapped PUA hyphen-like glyph from the normalizer, or
//      plain whitespace, never more than a few characters) is now
//      PRESERVED as a visible display string ("1.50-4.30lb Tray") — a
//      real, useful fact for Chef to see, since it's genuinely printed on
//      the invoice — but is NEVER treated as a real single purchased
//      weight. Safety is enforced explicitly downstream, not by omitting
//      the value here: vdrPackToGrams/vdrCalcPack (js/vendor-documents-
//      review.js) both run an unconditional isWeightRangePack() guard
//      before any other pattern, so this string can never be converted
//      to grams by accident — extracting neither endpoint as "the"
//      weight, deliberately different from the single-weight case below.
//   2. "Each"-sold items (Watermelon, Zucchini) are marked as such in
//      pack_description but NEVER converted to an assumed weight — no
//      invented average/density. Downstream grams/cost-per-100g stay
//      unknown for these, by construction (vdrPackToGrams has no "Each"
//      pattern today).
//   3. Gallon (Milk) is recognised and preserved as a canonical pack
//      string ("1gal") but is NOT converted to grams here — no
//      production-validated volume→mass density rule exists for Milk
//      in this codebase; vdrPackToGrams has no plain "gal" pattern
//      either (only mixed-fraction "N-N/N GAL"), so this stays inert
//      by construction too, exactly as intended.
// Never touches raw_description/description — this only ever adds the
// separate pack_description field.
const WALMART_PACK_RANGE_RE  = /(\d+(?:\.\d+)?)\D{1,4}(\d+(?:\.\d+)?)\s*(oz|lb)\b\.?\s*(Tray)?/i;
const WALMART_PACK_GAL_RE    = /(\d+(?:\.\d+)?)?\s*gal(?:lon)?\b/i;
const WALMART_PACK_WEIGHT_RE = /(\d+(?:\.\d+)?)\s*(oz|lb)\b/i;
const WALMART_PACK_EACH_RE   = /\beach\b/i;

function extractWalmartPack(description) {
  if (!description) return null;
  const rangeMatch = description.match(WALMART_PACK_RANGE_RE);
  if (rangeMatch) {
    const [, num1, num2, unit, tray] = rangeMatch;
    return num1 + '-' + num2 + unit.toLowerCase() + (tray ? ' Tray' : '');
  }
  const galMatch = description.match(WALMART_PACK_GAL_RE);
  if (galMatch) return (galMatch[1] || '1') + 'gal';
  const weightMatch = description.match(WALMART_PACK_WEIGHT_RE);
  if (weightMatch) return weightMatch[1] + weightMatch[2].toLowerCase();
  if (WALMART_PACK_EACH_RE.test(description)) return 'Each';
  return null;
}

function finalizeItem(item) {
  if (!item._swallowContinuation && item._descParts.length > 1) {
    item.raw_description = cleanDescription(item._descParts.join(' '));
    item.description = item.raw_description;
  }
  delete item._descParts;
  delete item._swallowContinuation;
  // Pack extraction only for real product rows — Shipping/adjustment/
  // handling/fulfillment_variance descriptions ("SHIPPING", "Alternative
  // Payment Methods", "HANDLING", "FULFILL_VARIANCE") never match any of
  // the patterns above anyway, but scoping explicitly to 'product' keeps
  // intent unambiguous.
  item.pack_description = item.line_type === 'product' ? extractWalmartPack(item.description) : null;
  return item;
}

function extractItems(lines) {
  const items = [];
  let current = null;
  let inTable = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (HEADER_ROW_RE.test(line)) {
      // Re-entering table mode is safe even if we were already in it
      // (a document whose table spans multiple PDF pages repeats this
      // header once per page — confirmed real in 30082536).
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (SUMMARY_ROW_RE.test(line)) {
      inTable = false;
      continue;
    }

    if (isSkuFragmentContinuation(line, current)) {
      current.vendor_sku += line;
      continue;
    }

    const rowStart = parseRowStart(line);
    if (rowStart) {
      if (current) items.push(finalizeItem(current));
      current = rowStart;
      continue;
    }

    // Neither a new row nor a SKU fragment → wrapped description text
    // continuing the current row (or swallowed, for the adjustment row).
    if (current && !current._swallowContinuation) {
      // The optional "Tax Details" percentage (e.g. "0.0824%") wraps
      // onto whichever continuation line happens to be first — real
      // geometry confirmed in 6c246fda/12fd6860. It always sits at the
      // very end of that line; strip it out before treating the rest
      // (if any) as further description text, so it never becomes part
      // of the ingredient description itself.
      const pctMatch = line.match(/^(.*?)\s*([\d.]+)%$/);
      if (pctMatch && current.tax_rate === null) {
        // The printed number (e.g. "0.0824") already equals the tax rate
        // as a fraction of 1 (0.0824 = 8.24%) — confirmed by cross-
        // checking against the real tax dollar amounts (e.g. 6c246fda
        // row 1: $3.29 / (2 × $19.97) = 0.0824). No further scaling.
        current.tax_rate = parseFloat(pctMatch[2]);
        const remainder = pctMatch[1].trim();
        if (remainder) current._descParts.push(remainder);
        continue;
      }
      current._descParts.push(line);
    }
  }
  if (current) items.push(finalizeItem(current));
  return items;
}

// ── Parse a document ───────────────────────────────────────────────────
function parse(rawText) {
  const text  = String(rawText || '');
  const lines = text.split('\n');

  const header = extractHeader(text, lines);
  const items  = extractItems(lines);
  const warnings = [];

  if (!items.length) warnings.push({ code: 'PARSE_ERROR', message: 'No line items found' });

  return {
    vendor:                'Walmart Business',
    document_type:         'invoice',
    document_number:       header.documentNumber,
    invoice_number:        header.documentNumber, // alias — matches sibling invoice parsers' naming
    invoice_date:          header.invoiceDate,
    due_date:              header.dueDate,
    buyer:                 header.buyer,
    seller:                header.seller,
    walmart_order_number:  header.walmartOrderNumber,
    po_number:             header.poNumber,
    subtotal:              header.subtotal,
    tax:                   header.tax,
    total:                 header.total,
    items,
    warnings,
  };
}

module.exports = { parse };
