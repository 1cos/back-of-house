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
// MICRO-TASK 56 — the two continuation shapes that belong to the Tax
// Details column rather than to the product description. See the two
// call sites in extractItems() for the real-document census.
const TAX_CELL_LINE_RE = /^Tax\d+\s+-?\$[\d,.]+$/;
const PCT_ONLY_LINE_RE = /^[\d.]+%$/;
const SUMMARY_ROW_RE  = /Invoice Summary/;
// ── MARKER:WALMART_FOOTER_START ────────────────────────────────────
// INV03D R5 — the two fixed boilerplate lines TreviPay prints between
// one page's table and the next. Both sit INSIDE the item table (the
// column header is reprinted after them), so before this rule they were
// neither a row-start nor a SKU fragment and fell through to
// continuation handling — appending "© 2026 TreviPay™ Page 2 of 4" and
// "Invoice Details" to whatever description happened to be open.
// Census over all 29 real Walmart documents: 15 items across 15
// documents carried this contamination. No money was ever lost by it
// (all 28 reconciling documents still reconciled), but it corrupts the
// description, which is the text ingredient_links matches on.
// Anchored at line start, so a product description that merely mentions
// a year can never match; and no real product description is exactly
// "Invoice Details".
const TREVIPAY_FOOTER_RE = /^©?\s*\d{4}\s*TreviPay\b/i;
const TABLE_CAPTION_RE   = /^Invoice Details$/i;
// ── MARKER:WALMART_FOOTER_END ──────────────────────────────────────

// ── MARKER:WALMART_STRUCTURED_ROW_START ────────────────────────────
// INV03D R1/R2 — the generic replacement for what used to be two
// hardcoded placeholder regexes (/^(Express Fee) (HANDLING)$/ and
// /^(SubDown) (FULFILL_VARIANCE)$/).
//
// Why those had to go. A TreviPay non-product row prints as
//
//     <reason code>   <STRUCTURED LABEL>   <qty> $unit $disc $tax $total
//
// where the LABEL is a machine constant and the REASON CODE is free
// text chosen by Walmart. Matching on the reason code made the parser
// an allowlist: every reason code nobody had seen yet failed both
// placeholder regexes AND the `^\d{5,}` product fallback below, so
// parseRowStart returned null, the caller treated the line as wrapped
// description text, and the row's money vanished into the PREVIOUS
// item's description. That exact failure has now happened three times:
// Express Fee / SubDown ($1.93 / $10.29 / $14.65), the Tax-label
// variants ($53.34 on 748cc643, $15.49 on 659ae123), and finally
// WebPriceMatch — two rows at $43.50 on 1ca959a6, $87.00, which is
// what INV03D was opened to repair.
//
// So the rule keys on the LABEL, which is the stable half, and lets the
// reason code be anything. Fail-closed is preserved by structure, not by
// enumeration: the row must ALREADY have satisfied a complete monetary
// tail (qty plus four or five dollar columns in the rigid column order)
// before this function is ever consulted. Census over all 29 real
// documents: exactly six distinct SKU-column blobs reach that tail with
// a non-numeric lead — SubDown/Express Fee/Shipping/WebPriceMatch plus
// the two wrap spellings of the ALT_PAYME adjustment — and the only
// continuation lines in the whole corpus that contain a "$" at all are
// three "Tax<n> $x.xx" cells, which carry no qty and only one dollar
// amount and so can never satisfy the tail.
//
// The ALT_PAYMENT_METHODS adjustment deliberately stays OUT of this
// table and keeps its own lead-fragment rule below: its label is prose
// ("Alternative Payment Methods"), not a constant, and it wraps across
// several fragments.
const STRUCTURED_ROW_LABELS = {
  FULFILL_VARIANCE: 'fulfillment_variance',
  HANDLING:         'handling',
  SHIPPING:         'shipping',
};
// The label is the final whitespace-delimited token and is all-caps
// with underscores, so it can never span a space; the reason code is
// everything before it.
const STRUCTURED_ROW_RE = /^(\S.*?)\s+([A-Z][A-Z_]*)$/;

function matchStructuredRow(skuAndDesc) {
  const m = skuAndDesc.match(STRUCTURED_ROW_RE);
  if (!m) return null;
  const lineType = STRUCTURED_ROW_LABELS[m[2]];
  if (!lineType) return null;
  const vendorSku = m[1].trim();
  // A real product row always leads with its numeric SKU. This keeps the
  // rule strictly additive: a product whose description happened to end
  // in one of these words can never be reclassified as a structured row.
  if (/^\d{5,}/.test(vendorSku)) return null;
  return { line_type: lineType, vendor_sku: vendorSku, label: m[2] };
}

// The three row types above share one property the adjustment row also
// has: their description is a fixed machine label, never prose that
// wraps. So any continuation line arriving while one of them is open
// belongs to the SKU column or to the page furniture — never to the
// description (INV03D R4).
const STRUCTURED_NON_PRODUCT_TYPES = {
  handling: true, shipping: true, fulfillment_variance: true,
};
// ── MARKER:WALMART_STRUCTURED_ROW_END ──────────────────────────────
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

// INV03D R3 — the alphabetic sibling of the rule above, for the SKU
// column of a STRUCTURED NON-PRODUCT row. Real example: the reason code
// "WebPriceMatch" does not fit the column and prints as "WebPriceM" on
// the row-start line with "atch" alone on the next physical line.
//
// The bound is the observed truncation width, not a guess: the SKU
// column cuts at 9 characters, seen twice independently in the real
// corpus — "WebPriceM"(9) + "atch", and "ALT_PAYME"(9) + "NT_METHO" +
// "DS". Requiring the open row's SKU to be alphabetic AND already at or
// past that width is what keeps this from ever firing on the shorter
// reason codes ("SubDown" 7, "Shipping" 8) or on "Express Fee" (which
// contains a space), and the product-row exclusion is inherited from
// STRUCTURED_NON_PRODUCT_TYPES, so no numeric SKU fragment behaviour
// changes. The adjustment row is deliberately excluded: it already
// carries a fixed canonical vendor_sku and swallows its own fragments.
const SKU_ALPHA_FRAGMENT_RE = /^[A-Za-z]{1,8}$/;
const SKU_COLUMN_WRAP_WIDTH = 9;
const MAX_RECONSTRUCTED_ALPHA_SKU_LEN = 24;

function isAlphaSkuFragmentContinuation(line, currentItem) {
  if (!SKU_ALPHA_FRAGMENT_RE.test(line)) return false;
  if (!currentItem || !STRUCTURED_NON_PRODUCT_TYPES[currentItem.line_type]) return false;
  const sku = currentItem.vendor_sku || '';
  if (!/^[A-Za-z]+$/.test(sku)) return false;
  if (sku.length < SKU_COLUMN_WRAP_WIDTH) return false;
  return (sku.length + line.length) <= MAX_RECONSTRUCTED_ALPHA_SKU_LEN;
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
// MICRO-TASK 55 — the Tax Details column label is NOT always the
// literal "Tax1". Four shapes are confirmed real:
//   "Tax1"            (6c246fda, f4786197 row 1)
//   "Tax2"            (748cc643 x3, d19bdab1 x4)
//   "Tax1 8.28%"      (659ae123 x2 — the rate prints INLINE on the
//                      row-start line instead of wrapping)
//   "7ad525ee-"       (f4786197 row 3 — an opaque tax-code fragment)
// Hardcoding "Tax1" made every other shape fail BOTH tail patterns, so
// the whole product row fell through to continuation handling and was
// silently swallowed into the previous row's description — losing
// $53.34 of $61.16 on 748cc643 and $15.49 on 659ae123.
//
// What is matched instead is the structural invariant that holds in all
// four: one to three NON-MONEY tokens sitting between the Discount
// amount and the final three dollar columns. Excluding "$" from the
// token class is what keeps this fail-closed — a row with no Tax
// Details column has only FOUR trailing dollar amounts and can never
// satisfy the FIVE this shape requires, so it still falls through to
// TAIL_PLAIN exactly as before. Both quantifiers are lazy and bounded
// and the token classes are disjoint, so there is no ambiguous
// backtracking (MICRO-TASK 44/45).
const TAXDETAIL_LABEL = '((?:[^\\s$]+\\s+){1,3}?)';
const TAIL_WITH_TAXDETAIL = new RegExp(
  '^(.*?)\\s+(\\d+)\\s+' + SIGNED_MONEY + '\\s+' + SIGNED_MONEY +
  '\\s+' + TAXDETAIL_LABEL + SIGNED_MONEY + '\\s+' + SIGNED_MONEY + '\\s+' + SIGNED_MONEY + '\\s*$'
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
    // 7 tax-detail label (unused), 8/9 tax-detail sub-total (unused),
    // 10/11 tax, 12/13 billed_total
    unitPrice = signedPrice(m[3], m[4]);
    discount  = signedPrice(m[5], m[6]);
    tax       = signedPrice(m[10], m[11]);
    amount    = signedPrice(m[12], m[13]);
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
  // INV03D — one generic structured-row rule in place of the two
  // hardcoded placeholder regexes this used to carry. It reproduces the
  // old output exactly for "Express Fee HANDLING", "SubDown
  // FULFILL_VARIANCE" and "Shipping SHIPPING" (verified field by field
  // over all 310 items of the 29 real documents), and additionally
  // recognises any other reason code printed against those same three
  // machine labels. See MARKER:WALMART_STRUCTURED_ROW_START.
  const structured = matchStructuredRow(skuAndDesc);

  let lineType, vendorSku, description;
  if (structured) {
    lineType = structured.line_type;
    vendorSku = structured.vendor_sku;
    description = structured.label;
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
    // header comment. INV03D R4 extends the same treatment to the three
    // structured non-product rows: their description is a fixed machine
    // label ("HANDLING", "SHIPPING", "FULFILL_VARIANCE"), never prose
    // that wraps, so a continuation line arriving while one of them is
    // open belongs to the SKU column (handled by the alpha-fragment
    // rule above) or to the page furniture — never to the description.
    _swallowContinuation: lineType === 'adjustment' || !!STRUCTURED_NON_PRODUCT_TYPES[lineType],
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
// ── MARKER:WALMART_PACK_GRAMMAR_START ──────────────────────────────
// INV03D §5 — three additions, each one bounded to a shape actually
// present in the corpus of 29 real Walmart documents and no wider.
//
// HALF GALLON. The generic gallon rule below has an OPTIONAL leading
// number, so a pack printed in words fell through to the `|| '1'`
// default and a half gallon was recorded as a FULL one: the estimated
// weight came out double and the price per 100 g came out half. Census:
// two real SKUs, both dairy, both wrong today — 100341131 (Oak Farms
// buttermilk, Half Gallon) and 10450118 (Great Value milk, whose own
// description confirms the reading by adding ", 64 fl oz", which is
// exactly half a gallon). No "quarter gallon" exists in the corpus, so
// none is invented here.
//
// This is deliberately NOT a general "number in words" rule, and it is
// deliberately matched before the generic gallon rule so the literal
// "half gallon" wins over the default.
const WALMART_PACK_HALF_GAL_RE = /\bhalf\s+gallon\b/i;
const WALMART_PACK_GAL_RE    = /(\d+(?:\.\d+)?)?\s*gal(?:lon)?\b/i;
const WALMART_PACK_WEIGHT_RE = /(\d+(?:\.\d+)?)\s*(oz|lb)\b/i;
// POUND SPELLED OUT. WALMART_PACK_WEIGHT_RE accepts only the "lb"
// abbreviation, so "10 Pound" produced no pack at all and 10 lb of
// sugar carried no weight and no price per 100 g. Census: one real SKU,
// 10293182. The leading number is REQUIRED, which is what keeps this
// off a product name that merely contains the word (a "Pound Cake"
// cannot match).
//
// The gap class is not decoration: on the real document the text reads
// "10\uE088 Pound" — the TreviPay normalizer leaves an unmapped Private
// Use Area glyph between the number and the unit, exactly as it does
// between the two numbers of a catch-weight range. WALMART_PACK_RANGE_RE
// above already tolerates that with \D{1,4}; this allows the same short
// run of whitespace, dashes and PUA codepoints, and nothing else.
const WALMART_PACK_POUND_RE  = /(\d+(?:\.\d+)?)[\s\u2012\u2013\u2014\uE000-\uF8FF-]{0,4}pounds?\b/i;
// "1ea" — the same count semantics as "Each", which the existing rule
// only recognised in full. Census: one real SKU, 51259411 (whole
// celery). It resolves to the SAME canonical 'Each' string the count
// model already uses, and 'Each' has no entry in packToGrams, so this
// adds a count product and never an invented weight.
const WALMART_PACK_EACH_RE   = /\beach\b|\b\d*\s?ea\b/i;
// ── MARKER:WALMART_PACK_GRAMMAR_END ────────────────────────────────

function extractWalmartPack(description) {
  if (!description) return null;
  const rangeMatch = description.match(WALMART_PACK_RANGE_RE);
  if (rangeMatch) {
    const [, num1, num2, unit, tray] = rangeMatch;
    return num1 + '-' + num2 + unit.toLowerCase() + (tray ? ' Tray' : '');
  }
  if (WALMART_PACK_HALF_GAL_RE.test(description)) return '0.5gal';
  const galMatch = description.match(WALMART_PACK_GAL_RE);
  if (galMatch) return (galMatch[1] || '1') + 'gal';
  const weightMatch = description.match(WALMART_PACK_WEIGHT_RE);
  if (weightMatch) return weightMatch[1] + weightMatch[2].toLowerCase();
  const poundMatch = description.match(WALMART_PACK_POUND_RE);
  if (poundMatch) return poundMatch[1] + 'lb';
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

    // INV03D R5 — page furniture reprinted between two pages of the same
    // item table. Skipped before any other handling so it can never
    // reach a description.
    if (TREVIPAY_FOOTER_RE.test(line) || TABLE_CAPTION_RE.test(line)) continue;

    if (isSkuFragmentContinuation(line, current)) {
      current.vendor_sku += line;
      continue;
    }

    // INV03D R3 — alphabetic SKU-column wrap, e.g. "atch" completing
    // "WebPriceM" into "WebPriceMatch".
    if (isAlphaSkuFragmentContinuation(line, current)) {
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
      // MICRO-TASK 56 — a continuation line that is ENTIRELY a Tax
      // Details cell belongs to that column, never to the product
      // description. Confirmed by census over all 21 real Walmart
      // documents: the shape "Tax<n> $<amount>" occurs exactly 3 times
      // (748cc643 "Tax1 $3.16", d19bdab1 "Tax1 $1.80", f4786197
      // "Tax2 $0.29") and every one of them is the SECOND tax detail of
      // a row that already carries one; ZERO continuation lines of any
      // other kind contain a "$" at all. Anchored at both ends so a
      // description that merely mentions a price can never match.
      if (TAX_CELL_LINE_RE.test(line)) continue;

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
      // MICRO-TASK 56 — the companion of the rule above: the SECOND tax
      // detail also prints its own rate, alone on its line. Reached only
      // when tax_rate is already set (the first rate is consumed by the
      // branch above), and only for a line that is a bare percentage and
      // nothing else. Both conditions matter: a real product percentage
      // never arrives alone on a line — the one real example, 6c246fda's
      // "oz Aluminum Cans 0.5%" ABV beer, carries product words on the
      // same line and so still reaches the description untouched.
      if (current.tax_rate !== null && PCT_ONLY_LINE_RE.test(line)) continue;
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
