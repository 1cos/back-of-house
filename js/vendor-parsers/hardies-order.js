// ── vendor-parsers/hardies-order.js ──────────────────────────
// Parser for Hardie's / Dairyland Produce CONFIRMATION OF SALE
// Document type: order_confirmation
// No AI. No OCR. Pure deterministic text parsing.
//
// Real format (from 06991299):
// QUANTITY  ITEM CODE  DESCRIPTION           PACK     COOL  UNIT PRICE  EXTENDED AMOUNT
// 1         70116      BRUSSEL SPROUTS MEDIUM 25#            47.92       47.92
// 1         13544      RWPR 103 RIB REF       1pc / 28# USA 29.05       871.50

'use strict';

const {
  parseDate, parsePrice, parsePackSize, cleanDescription,
  isSkipLine, isSubstitutionLine, extractDocNumber, extractDocDate,
} = require('./utils');

// Hardie's line item regex
// Columns: QTY  ITEM_CODE  DESCRIPTION...  PACK  [COOL]  UNIT_PRICE  AMOUNT
// Item code is always 5 digits. Prices are NN.NN at end of line.
// PACK can be complex: "25#", "12/3 CT", "1pc / 28#", "11/1#", "8/12 OZ"
const LINE_RE = /^(\d+)\s+(\d{5})\s+(.+?)\s{2,}(.+?)\s{1,}(?:(USA|MEX|CAN|CHI|PER|COL|GUA|EC|NL)\s+)?([\d,.]+)\s+([\d,.]+)$/;

// Simpler fallback: qty + item_code + rest (when spacing is irregular)
const LINE_RE2 = /^(\d+)\s+(\d{5})\s+(.{8,})$/;

function parse(rawText) {
  const warnings = [];
  const lines = rawText.split('\n').map(l => l.trim());

  // ── Header fields ──────────────────────────────────────────
  const docNumber = extractDocNumber(lines, ['INVOICE', 'CONFIRMATION']) || null;
  const orderDate  = extractDocDate(lines, ['DATE', 'ORDER DATE'])  || null;

  // Delivery date: not always explicit on order confirmation
  // Try "DATE/TRIP" field from invoice format
  let deliveryDate = null;
  for (const line of lines) {
    const m = line.match(/DATE\/TRIP\s+([\d\/]+)/i);
    if (m) { deliveryDate = parseDate(m[1]); break; }
  }

  // Totals
  let subtotal = null, tax = null, total = null;
  for (const line of lines) {
    let m;
    m = line.match(/SUBTOTAL\s+([\d,]+\.?\d*)/i);
    if (m) subtotal = parsePrice(m[1]);
    m = line.match(/^TAX(?:\/PCT\.?)?\s+\$([\d,.]+)/i);
    if (m) tax = parsePrice(m[1]);
    m = line.match(/INVOICE\s+\$([\d,]+\.?\d*)/i);
    if (m && !total) total = parsePrice(m[1]);
    m = line.match(/TOTAL\s+\$([\d,]+\.?\d*)/i);
    if (m && !total) total = parsePrice(m[1]);
  }

  // ── Item lines ────────────────────────────────────────────
  const items = [];
  let nextIsSubstitution = false;
  let prevSku = null;

  for (const line of lines) {
    if (isSkipLine(line)) continue;

    if (isSubstitutionLine(line)) {
      nextIsSubstitution = true;
      continue;
    }

    // Try full regex first
    let m = line.match(LINE_RE);
    if (m) {
      const [, qtyStr, sku, descRaw, packRaw, origin, unitPriceStr, amountStr] = m;
      const qty       = parseFloat(qtyStr);
      const unitPrice = parsePrice(unitPriceStr);
      const amount    = parsePrice(amountStr);
      const pack      = parsePackSize(packRaw.trim());
      const desc      = cleanDescription(descRaw.trim());

      const item = {
        vendor_sku:      sku,
        raw_description: descRaw.trim(),
        description:     desc,
        qty_ordered:     qty,
        qty_received:    null,
        purchase_unit:   inferPurchaseUnit(pack),
        pack_description:packRaw.trim(),
        pack_qty:        pack ? pack.count    : null,
        pack_unit:       pack ? pack.unit     : null,
        pack_size_each:  pack ? pack.sizeEach : null,
        unit_price:      unitPrice,
        amount:          amount,
        is_substitution: nextIsSubstitution,
        substituted_sku: nextIsSubstitution ? prevSku : null,
        origin:          origin || null,
        cool_flag:       false,
        warnings:        [],
      };

      // OQR-003: Price sanity (can't compare without order yet — deferred to OQR engine)
      // OQR-006: Count-based products
      if (pack && ['ct','ea','each'].includes(pack.unit)) {
        item.warnings.push({
          code:    'OQR-006',
          message: `Count-based item: ${desc} (${packRaw.trim()}) — no weight for costing`,
          field:   'pack_unit',
        });
      }

      // OQR-008: Item with unusual SKU pattern or description
      if (/^[A-Z]{2,4}\d+/.test(sku) && !/^\d+$/.test(sku)) {
        item.warnings.push({
          code:    'OQR-008',
          message: `Unusual SKU pattern: ${sku} — verify ingredient match`,
          field:   'vendor_sku',
        });
      }

      if (nextIsSubstitution) {
        item.warnings.push({
          code:    'OQR-002',
          message: `Substitution: received ${desc} instead of original item`,
          field:   'is_substitution',
        });
        nextIsSubstitution = false;
      }

      items.push(item);
      prevSku = sku;
      continue;
    }

    // Fallback: line starts with digit + 5-digit code but irregular spacing
    m = line.match(LINE_RE2);
    if (m) {
      const [, qtyStr, sku, rest] = m;
      // Extract prices from end of rest: two numbers like "47.92 47.92"
      const priceMatch = rest.match(/([\d,]+\.\d{2})\s+([\d,]+\.\d{2})$/);
      if (priceMatch) {
        const rawDesc    = rest.slice(0, rest.lastIndexOf(priceMatch[0])).trim();
        // Try to split description from pack: pack is usually last token before prices
        const parts      = rawDesc.split(/\s{2,}/);
        const packRaw    = parts.length > 1 ? parts[parts.length-1] : '';
        const descRaw    = parts.length > 1 ? parts.slice(0,-1).join(' ') : rawDesc;
        const pack       = parsePackSize(packRaw);
        const desc       = cleanDescription(descRaw);

        items.push({
          vendor_sku:      sku,
          raw_description: rawDesc.trim(),
          description:     desc,
          qty_ordered:     parseFloat(qtyStr),
          qty_received:    null,
          purchase_unit:   inferPurchaseUnit(pack),
          pack_description:packRaw.trim(),
          pack_qty:        pack ? pack.count : null,
          pack_unit:       pack ? pack.unit  : null,
          unit_price:      parsePrice(priceMatch[1]),
          amount:          parsePrice(priceMatch[2]),
          is_substitution: nextIsSubstitution,
          substituted_sku: nextIsSubstitution ? prevSku : null,
          origin:          null,
          cool_flag:       false,
          warnings:        nextIsSubstitution ? [{
            code:'OQR-002', message:`Substitution: received ${desc}`, field:'is_substitution'
          }] : [],
        });
        if (nextIsSubstitution) nextIsSubstitution = false;
        prevSku = sku;
      }
    }
  }

  if (!items.length) {
    warnings.push({
      code:    'PARSE_ERROR',
      message: 'No line items found — document format may have changed',
    });
  }

  return {
    vendor:          "Hardie's Fresh Foods / Dairyland Produce",
    document_type:   'order_confirmation',
    order_number:    docNumber,
    order_date:      orderDate,
    delivery_date:   deliveryDate,
    subtotal,
    tax,
    total,
    items,
    warnings,
  };
}

// Infer purchase unit from pack structure
function inferPurchaseUnit(pack) {
  if (!pack) return null;
  const u = pack.unit;
  if (['ct','ea','each'].includes(u)) return 'each';
  if (['lb','lbs'].includes(u))       return 'lb';
  if (u === 'oz')                     return 'oz';
  if (['gal','l','ml'].includes(u))   return u;
  return u || null;
}

module.exports = { parse };
