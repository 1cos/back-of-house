// ── vendor-parsers/freshpoint-invoice.js ─────────────────────
// Parser for FreshPoint Dallas INVOICE
//
// Formato colonne OCR:
// Item(SKU) | QtyOrd | QtyShip | Pack | PackSize | Description | UnitPrice | ExtendedPrice | St
//
// Logica prezzi:
// - Tutto è per_case — il prezzo è sempre per confezione
// - conversion_to_base calcolato dal pack size (es. 11# → 4989g, 3/2# → 2722g)
// - price_per_100g = unit_price / conversion_to_base × 100

'use strict';

const {
  parseDate, parsePrice, parsePackSize, cleanDescription, isSkipLine,
} = require('./utils');

const SKIP_RE = /invoice|customer|salesman|bill to|ship to|route|terms|due date|fuel surcharge|^page\s|special instructions|remit payment|p\.o\. number|order date|quantit|unit\s+price|extended|sub.?total|^cases|driver|splits|cubes|state|tax|total weight|item\s+desc/i;

// Converte pack size string in grammi totali
// Esempi: "11#" → 4989g, "3/2#" → 3×2×453.592=2722g
// "5 LB" → 2268g, "48CT" → null (conta), "3 CT" → null
function packToGrams(packStr) {
  if (!packStr) return null;
  const s = packStr.trim().toUpperCase();

  // Pattern "N/M#" o "N/MLB" — N unità da M lb
  // Es: "3/2#" = 3 × 2 lb = 6 lb
  const fracM = s.match(/^(\d+)\s*\/\s*(\d+(?:\.\d+)?)\s*(?:#|LB|LBS)$/);
  if (fracM) return parseFloat(fracM[1]) * parseFloat(fracM[2]) * 453.592;

  // Pattern "N#" o "N LB" — N lb totali
  const lbM = s.match(/^(\d+(?:\.\d+)?)\s*(?:#|LB|LBS)$/);
  if (lbM) return parseFloat(lbM[1]) * 453.592;

  // Pattern "N OZ"
  const ozM = s.match(/^(\d+(?:\.\d+)?)\s*OZ$/);
  if (ozM) return parseFloat(ozM[1]) * 28.3495;

  // Pattern "N KG"
  const kgM = s.match(/^(\d+(?:\.\d+)?)\s*KG$/);
  if (kgM) return parseFloat(kgM[1]) * 1000;

  // Pattern "N/MOZ" — N unità da M oz
  const fracOzM = s.match(/^(\d+)\s*\/\s*(\d+(?:\.\d+)?)\s*OZ$/);
  if (fracOzM) return parseFloat(fracOzM[1]) * parseFloat(fracOzM[2]) * 28.3495;

  // CT/EA — conta, nessun peso
  return null;
}

function parseLine(line) {
  line = line.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();

  // SKU = 3-6 cifre all'inizio
  const skuM = line.match(/^(\d{3,6})\s+(.+)/);
  if (!skuM) return null;
  const sku  = skuM[1];
  const rest = skuM[2];

  // Estrai i due prezzi alla fine della riga
  // Es: "... 33.15  66.30  US" o "... 33.15  66.30"
  const priceM = rest.match(/(\d{1,4}(?:,\d{3})*\.\d{2})\s+(\d{1,4}(?:,\d{3})*\.\d{2})(?:\s+[A-Z]{2})?$/);
  if (!priceM) return null;

  const unitPrice = parsePrice(priceM[1]);
  const extended  = parsePrice(priceM[2]);
  if (!unitPrice) return null;

  const middle = rest.slice(0, rest.lastIndexOf(priceM[0])).trim();

  // Qty ordinato e spedito
  const qtyM = middle.match(/^(\d+)\s+(\d+)\s+(.+)/);
  if (!qtyM) return null;

  const qtyOrd  = parseInt(qtyM[1]) || 0;
  const qtyShip = parseInt(qtyM[2]) || 0;
  let   packRest = qtyM[3].trim();

  // Pack type: BX, CS, BOX, EACH, EA, LB, CT
  const packTypeM = packRest.match(/^(BX|CS|BOX|EACH|EA|CT|LB)\s*(.*)/i);
  let packType = null, packSize = null, descRaw = packRest;

  if (packTypeM) {
    packType = packTypeM[1].toUpperCase();
    const afterType = packTypeM[2].trim();

    // Pack size è il primo token se contiene #, LB, OZ, KG, CT, numeri con /
    const sizeM = afterType.match(/^(\d[\d\/\.]*\s*(?:#|LB|LBS|OZ|KG|CT|DZ)?)\s+(.+)/i);
    if (sizeM) {
      packSize = sizeM[1].trim();
      descRaw  = sizeM[2].trim();
    } else {
      descRaw = afterType;
    }
  }

  // Rimuovi suffisso origine (US, MX, ecc.) dalla descrizione
  descRaw = descRaw.replace(/\s+[A-Z]{2}\s*$/, '').trim();

  const desc    = cleanDescription(descRaw || packRest);
  const totalG  = packToGrams(packSize);
  const p100    = (totalG && unitPrice) ? parseFloat(((unitPrice / totalG) * 100).toFixed(4)) : null;

  const itemWarnings = [];

  if (qtyOrd !== qtyShip && qtyOrd > 0 && qtyShip > 0) {
    itemWarnings.push({
      code: 'OQR-007',
      message: `Qty mismatch: ordered ${qtyOrd}, shipped ${qtyShip} of ${desc}`,
      field: 'qty_received',
    });
  }

  if (!totalG && packSize) {
    itemWarnings.push({
      code: 'OQR-006',
      message: `Count-based: ${desc} (${packSize}) — no weight for costing`,
      field: 'pack_unit',
    });
  }

  return {
    vendor_sku:        sku,
    raw_description:   descRaw || packRest,
    description:       desc,
    qty_ordered:       qtyOrd,
    qty_received:      qtyShip,
    pack_description:  packSize || packRest,
    pack_qty:          null,
    pack_unit:         packType,
    unit_price:        unitPrice,
    amount:            extended,
    extended_price:    extended,
    price_type:        'per_case',
    conversion_to_base: totalG ? Math.round(totalG) : null,
    _cost_per_100g:    p100,
    catchweight:       false,
    warnings:          itemWarnings,
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
    if (line.length < 20) continue;
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
