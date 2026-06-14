// ── vendor-parsers/freshpoint-invoice.js ─────────────────────
// Parser for FreshPoint Dallas INVOICE
//
// Formato colonne OCR:
// Item(SKU) | QtyOrd | QtyShip | Pack | PackSize | Description | UnitPrice | ExtendedPrice | St
//
// Logica price_type:
//   qty × unit_price ≈ extended (±2%) → per_case
//   qty × unit_price ≠ extended        → per_lb

'use strict';

const {
  parseDate, parsePrice, parsePackSize, cleanDescription, isSkipLine,
} = require('./utils');

const SKIP_RE = /invoice|customer|salesman|bill to|ship to|route|terms|due date|fuel surcharge|^page\s|special instructions|remit payment|p\.o\. number|order date|quantit|item\s+desc|unit\s+price|extended|sub.?total|^cases|driver|splits|cubes|state|tax|total weight/i;

function detectPriceType(qty, unitPrice, extended) {
  if (!unitPrice || !extended || !qty) return 'per_case';
  const expected = qty * unitPrice;
  const ratio = Math.abs(extended - expected) / Math.max(expected, 0.01);
  return ratio < 0.02 ? 'per_case' : 'per_lb';
}

// Tenta di estrarre campi da una riga FreshPoint
// Formato: SKU  QtyOrd  QtyShip  Pack  PackSize  Description...  UnitPrice  ExtendedPrice  [St]
function parseLine(line) {
  // Rimuovi caratteri non stampabili
  line = line.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();

  // SKU = 4-6 cifre all'inizio
  const skuM = line.match(/^(\d{3,6})\s+(.+)/);
  if (!skuM) return null;
  const sku  = skuM[1];
  const rest = skuM[2];

  // Cerca i due prezzi alla fine: ... UnitPrice  ExtendedPrice  [St]
  // Es: "... 33.15  66.30  US" oppure "... 56.45  56.45  MX"
  const priceM = rest.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{2}))\s+(\d{1,3}(?:,\d{3})*(?:\.\d{2}))(?:\s+[A-Z]{2})?$/);
  if (!priceM) return null;

  const unitPrice = parsePrice(priceM[1]);
  const extended  = parsePrice(priceM[2]);
  const middle    = rest.slice(0, rest.lastIndexOf(priceM[0])).trim();

  // Estrai qty ordinato e spedito (prime due cifre dopo SKU)
  const qtyM = middle.match(/^(\d+)\s+(\d+)\s+(.+)/);
  if (!qtyM) return null;

  const qtyOrd  = parseInt(qtyM[1]) || 0;
  const qtyShip = parseInt(qtyM[2]) || 0;
  const packDesc = qtyM[3].trim();

  // Estrai pack type (BX, CS, BOX, EACH) e pack size
  // Es: "BX 1" "BX 11#" "CS 3/2#" "BX 48CT" "EACH"
  const packTypeM = packDesc.match(/^(BX|CS|BOX|EACH|EA|CT|LB)\s*(.*)/i);
  let packType = null, packSize = null, descRaw = '';
  if (packTypeM) {
    packType = packTypeM[1].toUpperCase();
    const afterPack = packTypeM[2].trim();
    // Il packSize è il primo token se inizia con numero o contiene #/CT/LB
    const sizeM = afterPack.match(/^(\S+(?:\s+\S+)?)\s{2,}(.+)/);
    if (sizeM && /[\d#]/.test(sizeM[1])) {
      packSize = sizeM[1].trim();
      descRaw  = sizeM[2].trim();
    } else {
      // PackSize potrebbe essere solo 1 token
      const tok = afterPack.split(/\s+/);
      if (tok.length > 1 && /[\d#]/.test(tok[0])) {
        packSize = tok[0];
        descRaw  = tok.slice(1).join(' ');
      } else {
        descRaw = afterPack;
      }
    }
  } else {
    descRaw = packDesc;
  }

  // Rimuovi suffissi di origine alla fine della descrizione (US, MX, etc.)
  descRaw = descRaw.replace(/\s+[A-Z]{2}\s*$/, '').trim();

  const desc      = cleanDescription(descRaw || packDesc);
  const packObj   = parsePackSize(packSize || packDesc);
  const priceType = detectPriceType(qtyShip || qtyOrd, unitPrice, extended);

  const itemWarnings = [];

  if (qtyOrd !== qtyShip && qtyOrd > 0 && qtyShip > 0) {
    itemWarnings.push({
      code: 'OQR-007',
      message: `Qty mismatch: ordered ${qtyOrd}, shipped ${qtyShip} of ${desc}`,
      field: 'qty_received',
    });
  }

  if (packObj && ['ct','ea','each','dz','doz'].includes(packObj.unit)) {
    itemWarnings.push({
      code: 'OQR-006',
      message: `Count-based: ${desc} (${packSize}) — no weight for costing`,
      field: 'pack_unit',
    });
  }

  return {
    vendor_sku:       sku,
    raw_description:  descRaw || packDesc,
    description:      desc,
    qty_ordered:      qtyOrd,
    qty_received:     qtyShip,
    pack_description: packSize || packDesc,
    pack_qty:         packObj ? packObj.count    : null,
    pack_unit:        packObj ? packObj.unit     : null,
    pack_size_each:   packObj ? packObj.sizeEach : null,
    unit_price:       unitPrice,
    amount:           extended,
    extended_price:   extended,
    price_type:       priceType,
    catchweight:      priceType === 'per_lb',
    warnings:         itemWarnings,
  };
}

function parse(rawText) {
  const text  = String(rawText || '');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  let invoiceNumber = null, invoiceDate = null, total = null, subtotal = null;
  for (const line of lines) {
    let m;
    m = line.match(/Invoice\s+No\.?\s*[:\-]?\s*(\w+)/i);   if (m) invoiceNumber = m[1];
    m = line.match(/Invoice\s+Date\s*[:\-]?\s*([\d\/]+)/i); if (m) invoiceDate = parseDate(m[1]);
    m = line.match(/Sub\s*[-\s]*Total\s+([\d,]+\.?\d*)/i);  if (m) subtotal = parsePrice(m[1]);
    m = line.match(/(?:^|\s)Total\s+([\d,]+\.?\d*)\s*$/i);  if (m && !total) total = parsePrice(m[1]);
  }

  const items = [];
  for (const line of lines) {
    if (SKIP_RE.test(line)) continue;
    if (line.length < 15) continue;
    const item = parseLine(line);
    if (item && item.unit_price) items.push(item);
  }

  return {
    vendor:         'FreshPoint Dallas',
    document_type:  'invoice',
    invoice_number: invoiceNumber,
    invoice_date:   invoiceDate,
    subtotal,
    total,
    items,
    warnings: [],
  };
}

module.exports = { parse };
