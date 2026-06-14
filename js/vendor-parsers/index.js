// ── vendor-parsers/index.js ───────────────────────────────────
// Vendor detection and parser routing.
// Pure functions. No DB, no AI.

'use strict';

const hardiesOrder      = require('./hardies-order');
const hardiesInvoice    = require('./hardies-invoice');
const hardiesCredit     = require('./hardies-credit');
const freshpointInvoice = require('./freshpoint-invoice');

const VENDORS = {
  hardies: {
    patterns: [
      /dairyland produce/i,
      /hardie'?s/i,
      /chefs'?\s*wh?se/i,
    ],
    documents: {
      order_confirmation: hardiesOrder,
      invoice:            hardiesInvoice,
      credit_memo:        hardiesCredit,
    },
  },
  freshpoint: {
    patterns: [
      /freshpoint/i,
      /fresh\s*point/i,
    ],
    documents: {
      invoice: freshpointInvoice,
    },
  },
  // Future:
  // fruge:    { ... },
  // bekeeper: { ... },
};

// ── Detect vendor from raw text ───────────────────────────────
function detectVendor(rawText) {
  const text = rawText || '';
  for (const [vendorKey, config] of Object.entries(VENDORS)) {
    if (config.patterns.some(re => re.test(text))) {
      return vendorKey;
    }
  }
  return 'unknown';
}

// ── Detect document type from raw text ───────────────────────
function detectDocumentType(rawText) {
  const text = rawText || '';
  if (/CONFIRMATION OF SALE/i.test(text))   return 'order_confirmation';
  if (/\bCREDIT\b/i.test(text) && /\bCREDIT\s+\d{5,}/i.test(text)) return 'credit_memo';
  if (/INVOICE\/POD/i.test(text))           return 'invoice';
  if (/\bINVOICE\b/i.test(text))            return 'invoice';
  return 'unknown';
}


// ── Reconciliation check (Quadratura) ────────────────────────
// Data Priority P1: the document total is the source of truth.
// If the sum of parsed line amounts does not match the declared
// subtotal OR total (within tolerance), lines are missing or
// misread → blocking warning DOC-TOTAL-001.
const TOTAL_TOLERANCE = 0.02; // dollars

function checkTotals(parsed) {
  if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) {
    return parsed; // empty docs are covered by PARSE_ERROR
  }

  const amounts = parsed.items
    .map(it => it.amount)
    .filter(a => a !== null && a !== undefined && !isNaN(parseFloat(a)));

  if (amounts.length === 0) return parsed;

  const sumLines = Math.round(amounts.reduce((s, a) => s + parseFloat(a), 0) * 100) / 100;

  const candidates = [];
  if (parsed.subtotal !== null && parsed.subtotal !== undefined && !isNaN(parseFloat(parsed.subtotal))) {
    candidates.push(parseFloat(parsed.subtotal));
  }
  if (parsed.total !== null && parsed.total !== undefined && !isNaN(parseFloat(parsed.total))) {
    candidates.push(parseFloat(parsed.total));
  }

  if (candidates.length === 0) return parsed;

  const matches = candidates.some(c => Math.abs(c - sumLines) <= TOTAL_TOLERANCE);
  if (matches) return parsed;

  const declared = candidates[candidates.length - 1];
  const pct = declared !== 0
    ? Math.round(Math.abs(sumLines / declared) * 100)
    : 0;

  parsed.warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];
  parsed.warnings.push({
    code:     'DOC-TOTAL-001',
    severity: 'blocking',
    message:  `Lines sum $${sumLines.toFixed(2)} but document total is $${declared.toFixed(2)} (${pct}% read) — possible missing lines`,
    sum_of_lines:   sumLines,
    declared_total: declared,
  });

  return parsed;
}

// ── Parse a document ─────────────────────────────────────────
// Returns structured VendorDocument or error object
function parse(rawText) {
  const vendor  = detectVendor(rawText);
  const docType = detectDocumentType(rawText);

  if (vendor === 'unknown') {
    return {
      vendor:        null,
      document_type: docType,
      items:         [],
      warnings: [{
        code:    'UNKNOWN_VENDOR',
        message: 'Vendor not recognised from document text',
      }],
    };
  }

  if (docType === 'unknown') {
    return {
      vendor,
      document_type: null,
      items:         [],
      warnings: [{
        code:    'UNKNOWN_DOC_TYPE',
        message: `Document type not recognised for vendor "${vendor}"`,
      }],
    };
  }

  const parser = VENDORS[vendor].documents[docType];
  if (!parser) {
    return {
      vendor,
      document_type: docType,
      items:         [],
      warnings: [{
        code:    'NO_PARSER',
        message: `No parser implemented for ${vendor} / ${docType}`,
      }],
    };
  }

  try {
    const parsed = parser.parse(rawText);
    return checkTotals(parsed);
  } catch (err) {
    return {
      vendor,
      document_type: docType,
      items:         [],
      warnings: [{
        code:    'PARSER_ERROR',
        message: `Parser threw: ${err.message}`,
      }],
    };
  }
}

module.exports = { parse, detectVendor, detectDocumentType, checkTotals };
