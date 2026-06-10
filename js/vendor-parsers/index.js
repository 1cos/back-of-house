// ── vendor-parsers/index.js ───────────────────────────────────
// Vendor detection and parser routing.
// Pure functions. No DB, no AI.

'use strict';

const hardiesOrder   = require('./hardies-order');
const hardiesInvoice = require('./hardies-invoice');
const hardiesCredit  = require('./hardies-credit');

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
  // Future:
  // freshpoint: { ... },
  // fruge:      { ... },
  // bekeeper:   { ... },
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
    return parser.parse(rawText);
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

module.exports = { parse, detectVendor, detectDocumentType };
