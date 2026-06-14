// ── vendor-parsers/freshpoint-invoice.js ─────────────────────
// Parser for FreshPoint Dallas INVOICE
// Formato colonne: SKU | Description | Pack | Qty Ord | Qty Ship | Unit Price | Extended Price
//
// Logica price_type:
//   qty × unit_price ≈ extended (±2%) → per_case
//   qty × unit_price ≠ extended       → per_lb (prezzo a lb, extended = unit_price × peso reale)

'use strict';

const {
  parseDate, parsePrice, parsePackSize, cleanDescription, isSkipLine,
} = require('./utils');

// FreshPoint line format:
// SKU  Description  Pack  QtyOrd  QtyShip  UnitPrice  ExtendedPrice
// es: "7038  TOMATOES CLUSTER CHERRY TOV 11# LOC US  BX 1  1  1  33.15  66.30"
const LINE_RE = /^(\d{4,6})\s+(.+?)\s{2,}(\S+\s*\S*)\s+(\d+)\s+(\d+)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)$/;

function detectPriceType(qty, unitPrice, extended) {
  if (!unitPrice || !extended || !qty) return 'per_case';
  const expected = qty * unitPrice;
  const ratio = Math.abs(extended - expected) / expected;
  return ratio < 0.02 ? 'per_case' : 'per_lb';
}

function parse(rawText) {
  const text  = String(rawText || '');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const warnings = [];

  // Header fields
  let invoiceNumber = null, invoiceDate = null, total = null, subtotal = null;
  for (const line of lines) {
    let m;
    m = line.match(/Invoice\s+No\.?\s*[:\-]?\s*(\d+)/i);
    if (m) invoiceNumber = m[1];
    m = line.match(/Invoice\s+Date\s*[:\-]?\s*([\d\/]+)/i);
    if (m) invoiceDate = parseDate(m[1]);
    m = line.match(/Sub\s*Total\s+([\d,]+\.?\d*)/i);
    if (m) subtotal = parsePrice(m[1]);
    m = line.match(/(?:^|\s)Total\s+([\d,]+\.?\d*)/i);
    if (m && !total) total = parsePrice(m[1]);
  }

  const items = [];

  for (const line of lines) {
    if (isSkipLine(line)) continue;
    // Salta righe header/footer
    if (/invoice|customer|salesman|bill to|ship to|route|terms|due date|fuel surcharge|^page\s/i.test(line)) continue;
    if (/^(sku|item|desc|pack|qty|price|ext|unit|total|sub)/i.test(line)) continue;

    const m = line.match(LINE_RE);
    if (!m) continue;

    const sku        = m[1].trim();
    const descRaw    = m[2].trim();
    const packRaw    = m[3].trim();
    const qtyOrd     = parseInt(m[4]) || 0;
    const qtyShip    = parseInt(m[5]) || 0;
    const unitPrice  = parsePrice(m[6]);
    const extended   = parsePrice(m[7]);

    if (!unitPrice && !extended) continue;

    const desc      = cleanDescription(descRaw);
    const pack      = parsePackSize(packRaw);
    const priceType = detectPriceType(qtyShip || qtyOrd, unitPrice, extended);

    const itemWarnings = [];

    // Qty mismatch
    if (qtyOrd !== qtyShip && qtyOrd > 0 && qtyShip > 0) {
      itemWarnings.push({
        code: 'OQR-007',
        message: `Qty mismatch: ordered ${qtyOrd}, shipped ${qtyShip} of ${desc}`,
        field: 'qty_received',
      });
    }

    // Count-only pack (CT, EA) — no weight for costing
    if (pack && ['ct','ea','each','dz','doz'].includes(pack.unit)) {
      itemWarnings.push({
        code: 'OQR-006',
        message: `Count-based: ${desc} (${packRaw}) — no weight for costing`,
        field: 'pack_unit',
      });
    }

    items.push({
      vendor_sku:       sku,
      raw_description:  descRaw,
      description:      desc,
      qty_ordered:      qtyOrd,
      qty_received:     qtyShip,
      pack_description: packRaw,
      pack_qty:         pack ? pack.count    : null,
      pack_unit:        pack ? pack.unit     : null,
      pack_size_each:   pack ? pack.sizeEach : null,
      unit_price:       unitPrice,
      amount:           extended,
      extended_price:   extended,
      price_type:       priceType,
      catchweight:      priceType === 'per_lb',
      warnings:         itemWarnings,
    });
  }

  return {
    vendor:         'FreshPoint Dallas',
    document_type:  'invoice',
    invoice_number: invoiceNumber,
    invoice_date:   invoiceDate,
    subtotal,
    total,
    items,
    warnings,
  };
}

module.exports = { parse };
