// ── vendor-parsers/bek-invoice.js ────────────────────────────
// Parser for Ben E. Keith Foods INVOICE
//
// Formato colonne:
// Location(SKU) | Cases(Qty) | Pkgs | Item# | Brand | MfgCode | PackSize | Description | UnitPrice | Amount
//
// Logica prezzi:
// - Sempre per_case — prezzo per confezione
// - Pack size fisso dichiarato (es. 3/1 GAL, 2/10 LB, 1/50 LB)
// - conversion_to_base calcolato dal pack size in grammi

'use strict';

const { parseDate, parsePrice, parsePackSize, cleanDescription } = require('./utils');

const SKIP_RE = /ben e\.? keith|invoice|sold to|ship to|customer|route|terms|due|section total|description\s+promo|^cases\s+pkg|please check|cash\/ck|amt paid|total invoice|continued|^this page|tax\b|^dry$|^frozen$/i;

// Converte pack size BEK in grammi totali
// Es: "3/1 GAL" → 3×3785g=11355g, "2/10 LB" → 2×10×453g=9072g
// "1/50 LB" → 22680g, "8/12 OZ" → 8×12×28.35g=2721g
// "3/50 CT" → null (conta), "24/800 ML" → 24×800=19200ml≈19200g
function packToGrams(packStr) {
  if (!packStr) return null;
  const s = packStr.trim().toUpperCase().replace(/\s+/g, ' ');

  // Pattern "N/M UNIT" — N confezioni da M unità
  const fracM = s.match(/^(\d+)\s*\/\s*(\d+(?:\.\d+)?)\s*(LB|LBS|#|OZ|GAL|ML|L|KG|G)\s*$/);
  if (fracM) {
    const count = parseFloat(fracM[1]);
    const size  = parseFloat(fracM[2]);
    const unit  = fracM[3];
    if (unit === 'LB' || unit === 'LBS' || unit === '#') return count * size * 453.592;
    if (unit === 'OZ') return count * size * 28.3495;
    if (unit === 'GAL') return count * size * 3785.41;
    if (unit === 'ML') return count * size;
    if (unit === 'L') return count * size * 1000;
    if (unit === 'KG') return count * size * 1000;
    if (unit === 'G') return count * size;
  }

  // Pattern "N/M-M2 OZ" range — usa media (es. "12/22-24 OZ")
  const rangeM = s.match(/^(\d+)\s*\/\s*(\d+)-(\d+)\s*(LB|OZ|#)\s*$/);
  if (rangeM) {
    const count = parseFloat(rangeM[1]);
    const avg   = (parseFloat(rangeM[2]) + parseFloat(rangeM[3])) / 2;
    const unit  = rangeM[4];
    if (unit === 'LB' || unit === '#') return count * avg * 453.592;
    if (unit === 'OZ') return count * avg * 28.3495;
  }

  // Pattern semplice "N LB" o "N#"
  const simpleM = s.match(/^(\d+(?:\.\d+)?)\s*(LB|LBS|#|OZ|GAL|KG|G|ML|L)\s*$/);
  if (simpleM) {
    const size = parseFloat(simpleM[1]);
    const unit = simpleM[2];
    if (unit === 'LB' || unit === 'LBS' || unit === '#') return size * 453.592;
    if (unit === 'OZ') return size * 28.3495;
    if (unit === 'GAL') return size * 3785.41;
    if (unit === 'KG') return size * 1000;
    if (unit === 'G') return size;
    if (unit === 'ML') return size;
    if (unit === 'L') return size * 1000;
  }

  return null; // CT, EA, ecc. — conta, nessun peso
}

// Formato riga BEK:
// DW07311  1  1  108509  MR CLEAN  1003700002621  3/1 GAL  Cleaner Floor & All Purpose  54.33  54.33
function parseLine(line) {
  line = line.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();

  // Amount alla fine
  const amountM = line.match(/\$?([\d,]+\.\d{2})\s*$/);
  if (!amountM) return null;
  const amount = parsePrice(amountM[1]);

  const beforeAmount = line.slice(0, line.lastIndexOf(amountM[0])).trim();

  // Unit price prima dell'amount
  const priceM = beforeAmount.match(/\$?([\d,]+\.\d{2})\s*$/);
  if (!priceM) return null;
  const unitPrice = parsePrice(priceM[1]);
  if (!unitPrice) return null;

  const beforePrice = beforeAmount.slice(0, beforeAmount.lastIndexOf(priceM[0])).trim();

  // Parsing da sinistra: SKU(Location) Cases Pkgs ItemNo Brand MfgCode PackSize Description
  // SKU = alfanumerico all'inizio (es. DW07311, AF09212, 700150)
  const tokens = beforePrice.split(/\s+/);
  if (tokens.length < 5) return null;

  const sku   = tokens[0];
  const qty   = parseInt(tokens[1]) || 1;
  // tokens[2] = Pkgs (skip)
  // tokens[3] = Item# (skip)
  // tokens[4] = Brand (skip)
  // tokens[5] = MfgCode (skip) — può essere lungo
  // Dopo: PackSize + Description

  // Cerca il pack size — pattern numerico con unità
  let packSize = null, descStart = -1;
  for (let i = 3; i < tokens.length; i++) {
    const chunk2 = tokens[i] + (tokens[i+1] ? ' ' + tokens[i+1] : '');
    const chunk1 = tokens[i];
    // PackSize tipicamente: "3/1" seguito da "GAL", "LB", "OZ", "CT", "ML" ecc.
    // oppure "3/1 GAL" in un token solo se OCR lo unisce
    if (/^\d+\/\d+$/.test(chunk1) && tokens[i+1] && /^(GAL|LB|LBS|OZ|CT|ML|L|KG|G|#)$/i.test(tokens[i+1])) {
      packSize = chunk2;
      descStart = i + 2;
      break;
    }
    if (/^\d+\/\d+-\d+$/.test(chunk1) && tokens[i+1] && /^(OZ|LB|#)$/i.test(tokens[i+1])) {
      packSize = chunk2;
      descStart = i + 2;
      break;
    }
    // PackSize tutto in un token (es. "3/1GAL" o "24/800ML")
    if (/^\d+\/\d+(?:\.\d+)?(GAL|LB|OZ|ML|CT|KG|G|#)$/i.test(chunk1)) {
      packSize = chunk1;
      descStart = i + 1;
      break;
    }
  }

  if (descStart === -1 || descStart >= tokens.length) return null;

  const descRaw = tokens.slice(descStart).join(' ').trim();
  if (!descRaw || descRaw.length < 3) return null;

  // Ignora righe supply/cleaning (non food)
  if (/cleaner|floor|sanitiz|chemical|glove|bag|container|wrap|film|towel/i.test(descRaw)) {
    return null; // Skip non-food items
  }

  const desc   = cleanDescription(descRaw);
  const totalG = packToGrams(packSize);
  const p100   = (totalG && unitPrice) ? parseFloat(((unitPrice / totalG) * 100).toFixed(4)) : null;

  const itemWarnings = [];
  if (!totalG && packSize && !/ct|ea|each|dz/i.test(packSize)) {
    itemWarnings.push({
      code: 'OQR-006',
      message: `Pack size "${packSize}" — peso non calcolabile per ${desc}`,
      field: 'pack_unit',
    });
  }

  return {
    vendor_sku:         sku,
    raw_description:    descRaw,
    description:        desc,
    qty_ordered:        qty,
    qty_received:       qty,
    pack_description:   packSize,
    unit_price:         unitPrice,
    amount:             amount,
    extended_price:     amount,
    price_type:         'per_case',
    conversion_to_base: totalG ? Math.round(totalG) : null,
    _cost_per_100g:     p100,
    catchweight:        false,
    warnings:           itemWarnings,
  };
}

function parse(rawText) {
  const text  = String(rawText || '');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  let invoiceNumber = null, invoiceDate = null, total = null;
  for (const line of lines) {
    let m;
    m = line.match(/Invoice\s*#?\s*:?\s*(\d+)/i);        if (m) invoiceNumber = m[1];
    m = line.match(/(?:Invoice|Order)\s+Date\s*:?\s*([\d\/]+)/i); if (m) invoiceDate = parseDate(m[1]);
    m = line.match(/Total\s+Invoice\s+([\d,]+\.\d{2})/i); if (m) total = parsePrice(m[1]);
  }

  const items = [];
  for (const line of lines) {
    if (SKIP_RE.test(line)) continue;
    if (line.length < 20) continue;
    const item = parseLine(line);
    if (item && item.unit_price) items.push(item);
  }

  return {
    vendor:         'Ben E. Keith',
    document_type:  'invoice',
    invoice_number: invoiceNumber,
    invoice_date:   invoiceDate,
    subtotal:       null,
    total,
    items,
    warnings: [],
  };
}

module.exports = { parse };
