// ── vendor-parsers/hardies-credit.js ─────────────────────────
// Parser for Hardie's / Dairyland Produce CREDIT memo
// Document type: credit_memo
//
// Real format (from 00668419):
// QUANTITY  ITEM_CODE  DESCRIPTION         PACK  COOL  UNIT_PRICE  EXTENDED  RETURN_REASON
// 2         25265      CHZ MOZZ SHRED W/M  5#    USA   24.96       -49.92    5A
// Original Sales Order: 06991299

'use strict';

const {
  parseDate, parsePrice, parsePackSize, cleanDescription,
  isSkipLine, extractDocNumber, extractDocDate,
} = require('./utils');

// Credit line: QTY  ITEM_CODE  DESCRIPTION  PACK  [COOL]  UNIT_PRICE  AMOUNT  RETURN_CODE
const LINE_RE = /^(\d+)\s+(\d{5})\s+(.+?)\s{2,}(.+?)\s{1,}(?:(USA|MEX|CAN|CHI)\s+)?([\d,.]+)\s+(-?[\d,.]+)\s+([A-Z0-9]{1,3})?.*$/;
const LINE_RE2 = /^(\d+)\s+(\d{5})\s+(.{8,})$/;

// Credit codes from footer
const RETURN_CODE_LABELS = {
  NN: 'Do Not Need',
  SH: 'Short on Truck',
  NO: 'Did Not Order',
  OO: 'Over Ordered',
  MS: 'Mis-shipped',
  MK: 'Mis-keyed',
  '5A': 'Quality/Other',
};

function parse(rawText) {
  const warnings = [];
  const lines = rawText.split('\n').map(l => l.trim());

  // ── Header ────────────────────────────────────────────────
  const creditNumber   = extractDocNumber(lines, ['CREDIT']) || null;
  const creditDate     = extractDocDate(lines, ['DATE', 'ORDER DATE']) || null;

  // Original sales order reference
  let originalOrder = null;
  for (const line of lines) {
    const m = line.match(/Original Sales Order[:\s]+([\d]+)/i);
    if (m) { originalOrder = m[1]; break; }
  }

  // Total (negative)
  let total = null;
  for (const line of lines) {
    const m = line.match(/TOTAL\s+\$(-?[\d,]+\.?\d*)/i);
    if (m) { total = parsePrice(m[1]); break; }
  }

  // ── Item lines ────────────────────────────────────────────
  const items = [];

  for (const line of lines) {
    if (isSkipLine(line)) continue;
    if (/Original Sales Order/i.test(line)) continue;

    let m = line.match(LINE_RE);
    if (m) {
      const [, qtyStr, sku, descRaw, packRaw, origin, unitPriceStr, amountStr, returnCode] = m;
      const pack = parsePackSize(packRaw.trim());
      const returnLabel = returnCode ? (RETURN_CODE_LABELS[returnCode.toUpperCase()] || returnCode) : null;

      items.push({
        vendor_sku:       sku,
        raw_description:  descRaw.trim(),
        description:      cleanDescription(descRaw.trim()),
        qty_credited:     parseFloat(qtyStr),
        purchase_unit:    inferPurchaseUnit(pack),
        pack_description: packRaw.trim(),
        pack_qty:         pack ? pack.count : null,
        pack_unit:        pack ? pack.unit  : null,
        unit_price:       parsePrice(unitPriceStr),
        amount:           parsePrice(amountStr),   // negative
        origin:           origin || null,
        return_code:      returnCode || null,
        return_reason:    returnLabel,
        warnings:         [],
      });
      continue;
    }

    // Fallback
    m = line.match(LINE_RE2);
    if (m) {
      const [, qtyStr, sku, rest] = m;
      // Credit amounts are negative: "-49.92" or "49.92" at end
      const priceMatch = rest.match(/([\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})(?:\s+([A-Z0-9]{1,3}))?$/);
      if (priceMatch) {
        const rawDesc = rest.slice(0, rest.lastIndexOf(priceMatch[0])).trim();
        const parts   = rawDesc.split(/\s{2,}/);
        const packRaw = parts.length > 1 ? parts[parts.length-1] : '';
        const descRaw = parts.length > 1 ? parts.slice(0,-1).join(' ') : rawDesc;
        const pack    = parsePackSize(packRaw);
        const rc      = priceMatch[3] || null;

        items.push({
          vendor_sku:       sku,
          raw_description:  rawDesc.trim(),
          description:      cleanDescription(descRaw),
          qty_credited:     parseFloat(qtyStr),
          purchase_unit:    inferPurchaseUnit(pack),
          pack_description: packRaw.trim(),
          pack_qty:         pack ? pack.count : null,
          pack_unit:        pack ? pack.unit  : null,
          unit_price:       parsePrice(priceMatch[1]),
          amount:           parsePrice(priceMatch[2]),
          origin:           null,
          return_code:      rc,
          return_reason:    rc ? (RETURN_CODE_LABELS[rc.toUpperCase()] || rc) : null,
          warnings:         [],
        });
      }
    }
  }

  // OQR-001: Credit must be linked to original order
  if (!originalOrder) {
    warnings.push({
      code:    'OQR-001',
      message: 'Credit memo has no original order reference — manual linking required',
      field:   'original_order_number',
    });
  }

  if (!items.length) {
    warnings.push({ code:'PARSE_ERROR', message:'No credit line items found' });
  }

  return {
    vendor:               "Hardie's Fresh Foods / Dairyland Produce",
    document_type:        'credit_memo',
    credit_number:        creditNumber,
    credit_date:          creditDate,
    original_order_number:originalOrder,
    total,
    items,
    warnings,
  };
}

function inferPurchaseUnit(pack) {
  if (!pack) return null;
  const u = pack.unit;
  if (['ct','ea','each'].includes(u)) return 'each';
  if (['lb','lbs'].includes(u))       return 'lb';
  if (u === 'oz')                     return 'oz';
  return u || null;
}

module.exports = { parse };
