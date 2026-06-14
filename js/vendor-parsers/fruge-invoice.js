// ── vendor-parsers/fruge-invoice.js ──────────────────────────
// Parser for Fruge Seafood INVOICE
//
// Formato colonne:
// Ordered | Product Description | Shipped | Unit Price | Amount
//
// Particolarità:
// - Tutto per_lb — Unit Price ha "LB" esplicitamente dopo il numero
// - Ordered ≠ Shipped è normale (catchweight — pesce fresco)
// - SKU nel Product Description prima del " - "
// - price_per_100g = unit_price / 453.592 × 100

'use strict';

const { parseDate, parsePrice, cleanDescription } = require('./utils');

const SKIP_RE = /invoice|sold to|ship to|customer|freight|sales|route|broker|ordered\s+product|total weight|total carton|carrier|payment|due before|wholesale|driver|signature|check|service charge|lobster|crawfish|shrink|purchaser|attorney|venue|interest|acadia|fruge distributing|purge|credit memo|frozen items/i;

// Riga item Fruge:
// "11 LB  BRAFFOXOXCE1 - BRANZINI FR 600-800 FILLET...  10.2 LB  $23.50 LB  $239.70"
// oppure senza $ davanti al prezzo: "23.50 LB"
function parseLine(line) {
  line = line.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();

  // Cerca pattern: [qty LB] [SKU - Description] [shipped LB] [price LB] [amount]
  // Amount alla fine: numero con decimali
  const amountM = line.match(/\$?([\d,]+\.\d{2})\s*$/);
  if (!amountM) return null;
  const amount = parsePrice(amountM[1]);

  const beforeAmount = line.slice(0, line.lastIndexOf(amountM[0])).trim();

  // Unit price: cerca "NN.NN LB" o "$NN.NN LB"
  const priceM = beforeAmount.match(/\$?([\d,]+\.\d{2})\s+LB\s*$/i);
  if (!priceM) return null;
  const unitPrice = parsePrice(priceM[1]);

  const beforePrice = beforeAmount.slice(0, beforeAmount.lastIndexOf(priceM[0])).trim();

  // Shipped qty: "NN.NN LB" alla fine
  const shippedM = beforePrice.match(/([\d,]+\.?\d*)\s+LB\s*$/i);
  if (!shippedM) return null;
  const qtyShipped = parseFloat(shippedM[1]);

  const beforeShipped = beforePrice.slice(0, beforePrice.lastIndexOf(shippedM[0])).trim();

  // Ordered qty: "NN LB" all'inizio
  const orderedM = beforeShipped.match(/^([\d,]+\.?\d*)\s+LB\s+(.+)/i);
  let qtyOrdered = null, descRaw = beforeShipped;
  if (orderedM) {
    qtyOrdered = parseFloat(orderedM[1]);
    descRaw = orderedM[2].trim();
  }

  // Estrai SKU dalla descrizione (prima del " - ")
  const skuM = descRaw.match(/^([A-Z0-9\-]+)\s+-\s+(.+)/i);
  let sku = null, desc = descRaw;
  if (skuM) {
    sku = skuM[1].trim();
    desc = cleanDescription(skuM[2].trim());
  } else {
    desc = cleanDescription(descRaw);
  }

  // Verifica matematica: shipped × unitPrice ≈ amount (±2%)
  if (unitPrice && qtyShipped && amount) {
    const expected = qtyShipped * unitPrice;
    const ratio = Math.abs(amount - expected) / expected;
    if (ratio > 0.05) return null; // non torna — salta
  }

  // price_per_100g: per_lb → diretta
  const p100 = unitPrice ? parseFloat(((unitPrice / 453.592) * 100).toFixed(4)) : null;

  const itemWarnings = [];
  if (qtyOrdered && qtyShipped && Math.abs(qtyOrdered - qtyShipped) > 0.1) {
    itemWarnings.push({
      code: 'OQR-007',
      message: `Catchweight: ordered ${qtyOrdered} LB, received ${qtyShipped} LB of ${desc}`,
      field: 'qty_received',
    });
  }

  return {
    vendor_sku:        sku,
    raw_description:   descRaw,
    description:       desc,
    qty_ordered:       qtyOrdered,
    qty_received:      qtyShipped,
    pack_description:  `${qtyShipped} LB`,
    pack_unit:         'lb',
    unit_price:        unitPrice,
    amount:            amount,
    extended_price:    amount,
    price_type:        'per_lb',
    conversion_to_base: null,
    _cost_per_100g:    p100,
    catchweight:       true,
    warnings:          itemWarnings,
  };
}

function parse(rawText) {
  const text  = String(rawText || '');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  let invoiceNumber = null, invoiceDate = null, total = null;
  for (const line of lines) {
    let m;
    m = line.match(/INVOICE\s+(\d+)/i);           if (m) invoiceNumber = m[1];
    m = line.match(/Invoiced\s+([\d\/]+)/i);       if (m) invoiceDate = parseDate(m[1]);
    m = line.match(/Pay:\s+\$?([\d,]+\.\d{2})/i); if (m) total = parsePrice(m[1]);
  }

  const items = [];
  for (const line of lines) {
    if (SKIP_RE.test(line)) continue;
    if (line.length < 20) continue;
    const item = parseLine(line);
    if (item && item.unit_price) items.push(item);
  }

  return {
    vendor:         'Fruge Seafood',
    document_type:  'invoice',
    invoice_number: invoiceNumber,
    invoice_date:   invoiceDate,
    subtotal:       total,
    total,
    items,
    warnings: [],
  };
}

module.exports = { parse };
