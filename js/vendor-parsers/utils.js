// ── vendor-parsers/utils.js ──────────────────────────────────
// Shared utilities for all vendor parsers.
// Pure functions only — no DB, no AI, no side effects.

'use strict';

// ── Date parsing ─────────────────────────────────────────────
// Accepts MM/DD/YY, MM/DD/YYYY, YYYY-MM-DD → 'YYYY-MM-DD' or null
function parseDate(str) {
  if (!str) return null;
  str = String(str).trim();
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  // MM/DD/YY or MM/DD/YYYY
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let year = parseInt(m[3]);
    if (year < 100) year += 2000;
    const mo = String(parseInt(m[1])).padStart(2,'0');
    const da = String(parseInt(m[2])).padStart(2,'0');
    return `${year}-${mo}-${da}`;
  }
  return null;
}

// ── Price parsing ─────────────────────────────────────────────
// Handles "$1,234.56", "1234.56", "-49.92", "$.00"
function parsePrice(str) {
  if (str === null || str === undefined) return null;
  const cleaned = String(str).replace(/[$,\s]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

// ── Pack size parsing ─────────────────────────────────────────
// Returns { count, sizeEach, unit, raw } or null
// Examples: "25#" → {count:1,sizeEach:25,unit:'lb'}
//           "12/3 CT" → {count:12,sizeEach:3,unit:'ct'}
//           "1pc / 28#" → {count:1,sizeEach:28,unit:'lb'}
//           "11/1#" → {count:11,sizeEach:1,unit:'lb'}
//           "8/12 OZ" → {count:8,sizeEach:12,unit:'oz'}
//           "110 CT" → {count:1,sizeEach:110,unit:'ct'}
//           "6 CT" → {count:1,sizeEach:6,unit:'ct'}
//           "16-22 CT" → {count:1,sizeEach:16,unit:'ct',sizeMax:22}
function parsePackSize(str) {
  if (!str) return null;
  const raw = str;
  // Normalise # → lb
  let s = String(str).trim().replace(/#/g, 'lb').toUpperCase();

  let m;

  // "Npc / Nunit" or "Nea / Nunit" — e.g. "1pc / 28lb", "1PC/28LB"
  m = s.match(/^(\d+)\s*(?:PC|PCS|EA|EACH)\s*\/\s*([\d.]+)\s*([A-Z]+)/i);
  if (m) return { count: parseFloat(m[1]), sizeEach: parseFloat(m[2]), unit: m[3].toLowerCase(), raw };

  // "N/N unit" — e.g. "12/3 CT", "11/1lb", "8/12 OZ"
  m = s.match(/^(\d+)\s*\/\s*([\d.]+)\s*([A-Z]+)/);
  if (m) return { count: parseFloat(m[1]), sizeEach: parseFloat(m[2]), unit: m[3].toLowerCase(), raw };

  // "N-N unit" — range like "16-22 CT" → use min
  m = s.match(/^(\d+)-(\d+)\s*([A-Z]+)/);
  if (m) return { count: 1, sizeEach: parseFloat(m[1]), sizeMax: parseFloat(m[2]), unit: m[3].toLowerCase(), raw };

  // "N unit" — e.g. "25lb", "110 CT", "50 CT", "1 CT"
  m = s.match(/^([\d.]+)\s*([A-Z]+)$/);
  if (m) return { count: 1, sizeEach: parseFloat(m[1]), unit: m[2].toLowerCase(), raw };

  return null;
}

// ── Convert pack to grams ─────────────────────────────────────
const UNIT_TO_G = {
  lb: 453.592, lbs: 453.592, oz: 28.3495,
  kg: 1000, g: 1,
  gal: 3785.41, l: 1000, ml: 1,
  qt: 946.353, pt: 473.176,
};

function packToGrams(pack) {
  if (!pack) return null;
  const f = UNIT_TO_G[pack.unit];
  if (!f) return null; // ct, ea — no weight conversion
  return pack.count * pack.sizeEach * f;
}

// ── Clean description ─────────────────────────────────────────
// Remove origin tags, whitespace normalisation, preserve content
function cleanDescription(str) {
  if (!str) return '';
  return str
    .replace(/\bUSA\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Line skip heuristics ──────────────────────────────────────
// Returns true if line is a header, footer, or non-item line
function isSkipLine(line) {
  if (!line || line.trim().length < 3) return true;

  const l = line.trim().toUpperCase();

  const skipPrefixes = [
    'QUANTITY', 'ORDERED', 'SHIPPED', 'ITEM CODE', 'DESCRIPTION',
    'PACK', 'UNIT PRICE', 'EXTENDED', 'AMOUNT', 'ADJ', 'COOL',
    'TERMS', 'SUBTOTAL', 'TAX', 'TOTAL', 'INVOICE', 'PAGE',
    'ROUTE', 'CUSTOMER', 'BILL TO', 'SHIP TO', 'REMIT',
    'PHONE', 'FAX', 'EMAIL', 'ORDER TAKER', 'ORDER DATE',
    'DRIVER', 'SALESPERSON', 'INTEREST', 'PERISHABLE',
    'COMMODITY', 'PACA', 'ADJUST', 'CREDIT CARD', 'SURCHARGE',
    'WE WANT', 'HARDIE', 'DAIRYLAND', 'PROOF', 'DELIVERY WINDOW',
    'DATE/TRIP', 'CUSTOMER CODE', 'REPACKS', 'FULL CASES',
    'WEIGHT', 'TOTAL PCS', 'NOTES', 'CREDIT CODES', 'RETURN REASON'
  ];

  return skipPrefixes.some(prefix => l.startsWith(prefix));
}

// ── Detect substitution marker ────────────────────────────────
function isSubstitutionLine(line) {
  return /SUBSTITUTION/i.test(line);
}

// ── Extract document number ───────────────────────────────────
// From lines like "INVOICE/POD 06991299" or "CREDIT 00668419"
function extractDocNumber(lines, keywords) {
  for (const line of lines) {
    for (const kw of keywords) {
      const re = new RegExp(kw + '\\s*[/#]?\\s*(\\d{5,10})', 'i');
      const m = line.match(re);
      if (m) return m[1];
    }
  }
  return null;
}

// ── Extract date from lines ───────────────────────────────────
function extractDocDate(lines, keywords) {
  for (const line of lines) {
    for (const kw of keywords) {
      const re = new RegExp(kw + '[\\s:/]*([\\d]{1,2}/[\\d]{1,2}/[\\d]{2,4})', 'i');
      const m = line.match(re);
      if (m) return parseDate(m[1]);
    }
  }
  return null;
}

module.exports = {
  parseDate, parsePrice, parsePackSize, packToGrams,
  cleanDescription, isSkipLine, isSubstitutionLine,
  extractDocNumber, extractDocDate,
};
