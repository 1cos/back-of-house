// ══════════════════════════════════════════════════════════════════
// vendor-doc-auto-import — MICRO-TASK 32: TRUE BACKGROUND AUTO-IMPORT
//
// Server-side counterpart to the client-only path that today requires
// Chef to have Vendor Documents open in a browser:
//   pdf_received → vdrProcessAllPdf() (click "Processa tutti")
//   pending+clean → vdrAutoImportCleanHardiesInvoices() (Hardie's only,
//                    fires from vdrLoad() — still page-open-dependent)
//   pending (any other vendor) → "Approve Document" (manual click)
//
// This function does the same two stages (parse, then approve-if-clean)
// for EVERY status='pending'/'pdf_received' INVOICE document, regardless
// of whether anyone has BOH OS open, triggered by pg_cron (see the
// migration deployed alongside this function).
//
// EXPLICITLY OUT OF SCOPE (left exactly as today):
//   - Ben E. Keith order_confirmation (parsed_json.source ===
//     'email_html'/'email_body'): DOMParser doesn't exist in Deno, and
//     order_confirmation approval is a documented no-op anyway (see
//     MICRO-TASK 31 audit, section D) — these are skipped untouched, for
//     the existing client-side vdrProcessAllPdf()/manual path to keep
//     handling.
//   - fuzzy/semantic SKU matching — unmatchedCount>0 always blocks,
//     exactly like today.
//   - historical backfill / bulk reprocessing of already-imported docs.
//   - parser drift between this file's embedded parsers/*.js and
//     js/vendor-parser-ui.js's browser copy (flagged, not fixed, in the
//     MICRO-TASK 31 audit).
//
// Every block below marked "PORTED FROM js/vendor-documents-review.js"
// is a deliberate byte-for-byte (or near-byte-for-byte, where Deno/TS
// syntax forces a trivial change) copy of the exact logic the manual
// click already runs — so this function can never decide anything the
// manual path wouldn't also decide. Diff against the marked source line
// ranges to verify no drift over time.
// ══════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import pdfjsLib from 'npm:pdfjs-dist@3.11.174/legacy/build/pdf.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// ══════════════════════════════════════════════════════════════════
// PORTED FROM js/vendor-documents-review.js:426-566
// (MARKER:VDR_TREVIPAY_NORMALIZE_START..END) — verbatim, see that file
// for the full audit rationale. Only Walmart Business/TreviPay PDFs
// hit this path; every other vendor uses the plain legacy join below.
// ══════════════════════════════════════════════════════════════════
const TREVIPAY_PUA_DIGIT_BASE = 0xE071;
const TREVIPAY_PUA_DECIMAL    = 0xE094;
const TREVIPAY_PUA_MINUS      = 0xEE55;

function vdrIsTreviPayDocument(items: any[]): boolean {
  if (!items || !items.length) return false;
  const flat = items.map((it) => (it && it.str) || '').join('').replace(/\s+/g, '').toLowerCase();
  return flat.includes('walmartbusiness') && flat.includes('trevipay');
}

function decodeTreviPayPUA(str: string): { text: string; hasUnknownPua: boolean } {
  if (!str) return { text: str || '', hasUnknownPua: false };
  let text = '';
  let hasUnknownPua = false;
  for (const ch of str) {
    const cp = ch.codePointAt(0)!;
    if (cp >= TREVIPAY_PUA_DIGIT_BASE && cp <= TREVIPAY_PUA_DIGIT_BASE + 9) {
      text += String(cp - TREVIPAY_PUA_DIGIT_BASE);
    } else if (cp === TREVIPAY_PUA_DECIMAL) {
      text += '.';
    } else if (cp === TREVIPAY_PUA_MINUS) {
      text += '-';
    } else if (cp >= 0xE000 && cp <= 0xF8FF) {
      hasUnknownPua = true;
      text += ch;
    } else {
      text += ch;
    }
  }
  return { text, hasUnknownPua };
}

function vdrItemFontSize(item: any): number {
  const t = (item && item.transform) || [1, 0, 0, 1, 0, 0];
  return Math.hypot(t[0], t[1]) || Math.hypot(t[2], t[3]) || 1;
}

const TREVIPAY_GAP_EM_FRACTION = 0.5;

function vdrTreviPayJoinRow(rowItems: any[]): { text: string; hasUnknownPua: boolean } {
  const sorted = (rowItems || []).slice().sort((a, b) => a.x - b.x);
  let out = '';
  let prevEnd: number | null = null;
  let hasUnknownPua = false;
  for (const it of sorted) {
    const decoded = decodeTreviPayPUA(it.text);
    if (decoded.hasUnknownPua) hasUnknownPua = true;
    if (!decoded.text) continue;
    if (prevEnd !== null) {
      const threshold = (it.fontSize || 1) * TREVIPAY_GAP_EM_FRACTION;
      if (it.x - prevEnd > threshold) out += ' ';
    }
    out += decoded.text;
    prevEnd = it.x + (it.width || 0);
  }
  return { text: out, hasUnknownPua };
}

function vdrNormalizeTreviPayPage(items: any[]): { text: string; hasUnknownPua: boolean } {
  const lineMap: Record<number, any[]> = {};
  for (const item of items || []) {
    const y = Math.round(item.transform[5]);
    if (!lineMap[y]) lineMap[y] = [];
    lineMap[y].push({ x: item.transform[4], text: item.str, width: item.width, fontSize: vdrItemFontSize(item) });
  }
  const sortedY = Object.keys(lineMap).map(Number).sort((a, b) => b - a);
  let hasUnknownPua = false;
  const lines = sortedY.map((y) => {
    const row = vdrTreviPayJoinRow(lineMap[y]);
    if (row.hasUnknownPua) hasUnknownPua = true;
    return row.text;
  });
  return { text: lines.join('\n'), hasUnknownPua };
}

// ══════════════════════════════════════════════════════════════════
// PORTED FROM js/vendor-documents-review.js:568-610
// (MARKER:VDR_WALMART_BUYER_GUARD_START..END) — verbatim, INCLUDING the
// existing 'Massimilajo Zubboli' constant. Not "fixed" here — out of
// scope for MICRO-TASK 32; flagging a possible typo is not the same as
// being authorized to change a value that gates real purchase writes.
// ══════════════════════════════════════════════════════════════════
const WALMART_KITCHEN_BUYER = 'Massimilajo Zubboli';
const WALMART_BAR_BUYER     = 'Zeno Russo';

function vdrNormalizeBuyerName(name: string | null | undefined): string {
  if (!name) return '';
  return String(name).trim().replace(/\s+/g, ' ').toLowerCase();
}

function vdrDecideWalmartBuyer(parsed: any): { action: string; reason: string } | null {
  if (!parsed || parsed.vendor !== 'Walmart Business') return null;
  const normalized = vdrNormalizeBuyerName(parsed.buyer);
  if (!normalized) return { action: 'review', reason: 'buyer_missing' };
  if (normalized === vdrNormalizeBuyerName(WALMART_KITCHEN_BUYER)) return { action: 'accept', reason: 'buyer_kitchen' };
  if (normalized === vdrNormalizeBuyerName(WALMART_BAR_BUYER)) return { action: 'ignore', reason: 'buyer_bar' };
  return { action: 'review', reason: 'buyer_unrecognized' };
}

// ══════════════════════════════════════════════════════════════════
// CJS loader for the deterministic parsers — same technique already
// proven server-side by pdf-parity-test-harness (Edge Function). The
// parsers themselves are byte-identical copies of js/vendor-parsers/
// *.js, deployed as sibling files (parsers/*.js) — never re-typed as
// TS, so there is no second, divergent implementation to keep in sync
// by hand; a future parser fix just needs copying into both places.
// ══════════════════════════════════════════════════════════════════
function makeCjsLoader(sources: Record<string, string>) {
  const cache: Record<string, { exports: any }> = {};
  function req(name: string): any {
    const key = name.replace(/^\.\//, '');
    if (cache[key]) return cache[key].exports;
    const src = sources[key];
    if (src == null) throw new Error('parser module not found: ' + key);
    const mod = { exports: {} };
    cache[key] = mod;
    const fn = new Function('require', 'module', 'exports', src);
    fn(req, mod, mod.exports);
    return mod.exports;
  }
  return req;
}

// PARSER_SOURCES — programmatically embedded (Python json.dumps of the
// real js/vendor-parsers/*.js files read from disk), after a live test
// (request 8808, 2026-09-17) proved Deno.readTextFile of sibling files
// does NOT work in this Edge Runtime (NotFound at
// /var/tmp/sb-compile-edge-runtime/source/parsers/utils.js) — deployed
// sibling files are not placed where import.meta.url-relative reads
// expect them. Embedding avoids that entirely. To update a parser: edit
// js/vendor-parsers/<file>.js in the main repo, then regenerate this
// block the same way (read the file, JSON-escape it) — never hand-edit
// the object below directly.
const PARSER_SOURCES: Record<string, string> = {
  "utils": "// ── vendor-parsers/utils.js ──────────────────────────────────\n// Shared utilities for all vendor parsers.\n// Pure functions only — no DB, no AI, no side effects.\n\n'use strict';\n\n// ── Date parsing ─────────────────────────────────────────────\n// Accepts MM/DD/YY, MM/DD/YYYY, YYYY-MM-DD → 'YYYY-MM-DD' or null\nfunction parseDate(str) {\n  if (!str) return null;\n  str = String(str).trim();\n  // Already ISO\n  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(str)) return str;\n  // MM/DD/YY or MM/DD/YYYY\n  const m = str.match(/^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{2,4})$/);\n  if (m) {\n    let year = parseInt(m[3]);\n    if (year < 100) year += 2000;\n    const mo = String(parseInt(m[1])).padStart(2,'0');\n    const da = String(parseInt(m[2])).padStart(2,'0');\n    return `${year}-${mo}-${da}`;\n  }\n  return null;\n}\n\n// ── Price parsing ─────────────────────────────────────────────\n// Handles \"$1,234.56\", \"1234.56\", \"-49.92\", \"$.00\"\nfunction parsePrice(str) {\n  if (str === null || str === undefined) return null;\n  const cleaned = String(str).replace(/[$,\\s]/g, '');\n  const n = parseFloat(cleaned);\n  return isNaN(n) ? null : n;\n}\n\n// ── Pack size parsing ─────────────────────────────────────────\n// Returns { count, sizeEach, unit, raw } or null\n// Examples: \"25#\" → {count:1,sizeEach:25,unit:'lb'}\n//           \"12/3 CT\" → {count:12,sizeEach:3,unit:'ct'}\n//           \"1pc / 28#\" → {count:1,sizeEach:28,unit:'lb'}\n//           \"11/1#\" → {count:11,sizeEach:1,unit:'lb'}\n//           \"8/12 OZ\" → {count:8,sizeEach:12,unit:'oz'}\n//           \"110 CT\" → {count:1,sizeEach:110,unit:'ct'}\n//           \"6 CT\" → {count:1,sizeEach:6,unit:'ct'}\n//           \"16-22 CT\" → {count:1,sizeEach:16,unit:'ct',sizeMax:22}\nfunction parsePackSize(str) {\n  if (!str) return null;\n  const raw = str;\n  // Normalise # → lb\n  let s = String(str).trim().replace(/#/g, 'lb').toUpperCase();\n\n  let m;\n\n  // \"Npc / Nunit\" or \"Nea / Nunit\" — e.g. \"1pc / 28lb\", \"1PC/28LB\"\n  m = s.match(/^(\\d+)\\s*(?:PC|PCS|EA|EACH)\\s*\\/\\s*([\\d.]+)\\s*([A-Z]+)/i);\n  if (m) return { count: parseFloat(m[1]), sizeEach: parseFloat(m[2]), unit: m[3].toLowerCase(), raw };\n\n  // ── FreshPoint: \"N/N.Nunit N/N.Nunit BOX|BX|CS|BG\" — weight repeated twice ──\n  // e.g. \"2/1.5LB 2/1.5LB BOX\" — take first occurrence only\n  m = s.match(/^(\\d+)\\s*\\/\\s*([\\d.]+)\\s*([A-Z]+)\\s+\\1\\s*\\/\\s*\\2\\s*\\3\\s+(?:BOX|BX|CS|BG|BAG)$/);\n  if (m) return { count: parseFloat(m[1]), sizeEach: parseFloat(m[2]), unit: m[3].toLowerCase(), raw };\n\n  // ── FreshPoint: \"N.Nunit N.Nunit BOX|BX|CS|BG\" — weight repeated twice ──\n  // e.g. \"4LB 4LB BX\", \"11LB 11LB BX\", \"1LB 1LB BG\"\n  m = s.match(/^([\\d.]+)\\s*([A-Z]+)\\s+\\1\\s*\\2\\s+(?:BOX|BX|CS|BG|BAG)$/);\n  if (m) return { count: 1, sizeEach: parseFloat(m[1]), unit: m[2].toLowerCase(), raw };\n\n  // ── FreshPoint: \"N/N unit BOX|BX|CS|BG\" — slash-count with container suffix ──\n  // e.g. \"3/2LB CS\", \"2/1.5LB BOX\"\n  m = s.match(/^(\\d+)\\s*\\/\\s*([\\d.]+)\\s*([A-Z]+)\\s+(?:BOX|BX|CS|BG|BAG)$/);\n  if (m) return { count: parseFloat(m[1]), sizeEach: parseFloat(m[2]), unit: m[3].toLowerCase(), raw };\n\n  // ── FreshPoint: \"N.Nunit BOX|BX|CS|BG\" — single weight with container suffix ──\n  // e.g. \"5LB BX\", \"50LB BX\"\n  m = s.match(/^([\\d.]+)\\s*([A-Z]+)\\s+(?:BOX|BX|CS|BG|BAG)$/);\n  if (m) return { count: 1, sizeEach: parseFloat(m[1]), unit: m[2].toLowerCase(), raw };\n\n  // ── FreshPoint: \"...NCT 15LB BX\" — weight buried at end before container ──\n  m = s.match(/^.*?([\\d.]+)\\s*(LB|OZ|KG|G)\\s+(?:BOX|BX|CS|BG|BAG)$/);\n  if (m) return { count: 1, sizeEach: parseFloat(m[1]), unit: m[2].toLowerCase(), raw };\n\n  // ── FreshPoint: \"N CT BOX|BX\" — count-only with container ──\n  m = s.match(/^([\\d.]+)\\s*CT\\s+(?:BOX|BX|CS|BG|BAG)$/);\n  if (m) return { count: 1, sizeEach: parseFloat(m[1]), unit: 'ct', raw };\n\n  // \"N/N unit\" — e.g. \"12/3 CT\", \"11/1lb\", \"8/12 OZ\"\n  m = s.match(/^(\\d+)\\s*\\/\\s*([\\d.]+)\\s*([A-Z]+)/);\n  if (m) return { count: parseFloat(m[1]), sizeEach: parseFloat(m[2]), unit: m[3].toLowerCase(), raw };\n\n  // \"N-N unit\" — range like \"16-22 CT\" → use min\n  m = s.match(/^(\\d+)-(\\d+)\\s*([A-Z]+)/);\n  if (m) return { count: 1, sizeEach: parseFloat(m[1]), sizeMax: parseFloat(m[2]), unit: m[3].toLowerCase(), raw };\n\n  // \"N unit\" — e.g. \"25lb\", \"110 CT\", \"50 CT\", \"1 CT\"\n  m = s.match(/^([\\d.]+)\\s*([A-Z]+)$/);\n  if (m) return { count: 1, sizeEach: parseFloat(m[1]), unit: m[2].toLowerCase(), raw };\n\n  return null;\n}\n\n// ── Convert pack to grams ─────────────────────────────────────\nconst UNIT_TO_G = {\n  lb: 453.592, lbs: 453.592, oz: 28.3495,\n  kg: 1000, g: 1,\n  gal: 3785.41, l: 1000, ml: 1,\n  qt: 946.353, pt: 473.176,\n};\n\nfunction packToGrams(pack) {\n  if (!pack) return null;\n  const f = UNIT_TO_G[pack.unit];\n  if (!f) return null; // ct, ea — no weight conversion\n  return pack.count * pack.sizeEach * f;\n}\n\n// ── Clean description ─────────────────────────────────────────\n// Remove origin tags, whitespace normalisation, preserve content\nfunction cleanDescription(str) {\n  if (!str) return '';\n  return str\n    .replace(/\\bUSA\\b/gi, '')\n    .replace(/\\s+/g, ' ')\n    .trim();\n}\n\n// ── Line skip heuristics ──────────────────────────────────────\n// Returns true if line is a header, footer, or non-item line\nfunction isSkipLine(line) {\n  if (!line || line.trim().length < 3) return true;\n\n  const l = line.trim().toUpperCase();\n\n  const skipPrefixes = [\n    'QUANTITY', 'ORDERED', 'SHIPPED', 'ITEM CODE', 'DESCRIPTION',\n    'PACK', 'UNIT PRICE', 'EXTENDED', 'AMOUNT', 'ADJ', 'COOL',\n    'TERMS', 'SUBTOTAL', 'TAX', 'TOTAL', 'INVOICE', 'PAGE',\n    'ROUTE', 'CUSTOMER', 'BILL TO', 'SHIP TO', 'REMIT',\n    'PHONE', 'FAX', 'EMAIL', 'ORDER TAKER', 'ORDER DATE',\n    'DRIVER', 'SALESPERSON', 'INTEREST', 'PERISHABLE',\n    'COMMODITY', 'PACA', 'ADJUST', 'CREDIT CARD', 'SURCHARGE',\n    'WE WANT', 'HARDIE', 'DAIRYLAND', 'PROOF', 'DELIVERY WINDOW',\n    'DATE/TRIP', 'CUSTOMER CODE', 'REPACKS', 'FULL CASES',\n    'WEIGHT', 'TOTAL PCS', 'NOTES', 'CREDIT CODES', 'RETURN REASON'\n  ];\n\n  return skipPrefixes.some(prefix => l.startsWith(prefix));\n}\n\n// ── Detect substitution marker ────────────────────────────────\nfunction isSubstitutionLine(line) {\n  return /SUBSTITUTION/i.test(line);\n}\n\n// ── Extract document number ───────────────────────────────────\n// From lines like \"INVOICE/POD 06991299\" or \"CREDIT 00668419\"\nfunction extractDocNumber(lines, keywords) {\n  for (const line of lines) {\n    for (const kw of keywords) {\n      const re = new RegExp(kw + '\\\\s*[/#]?\\\\s*(\\\\d{5,10})', 'i');\n      const m = line.match(re);\n      if (m) return m[1];\n    }\n  }\n  return null;\n}\n\n// ── Extract date from lines ───────────────────────────────────\nfunction extractDocDate(lines, keywords) {\n  for (const line of lines) {\n    for (const kw of keywords) {\n      const re = new RegExp(kw + '[\\\\s:/]*([\\\\d]{1,2}/[\\\\d]{1,2}/[\\\\d]{2,4})', 'i');\n      const m = line.match(re);\n      if (m) return parseDate(m[1]);\n    }\n  }\n  return null;\n}\n\nmodule.exports = {\n  parseDate, parsePrice, parsePackSize, packToGrams,\n  cleanDescription, isSkipLine, isSubstitutionLine,\n  extractDocNumber, extractDocDate,\n};\n",
  "hardies-order": "// ── vendor-parsers/hardies-order.js ──────────────────────────\n// Parser for Hardie's / Dairyland Produce CONFIRMATION OF SALE\n// Document type: order_confirmation\n// No AI. No OCR. Pure deterministic text parsing.\n//\n// Real format (from 06991299):\n// QUANTITY  ITEM CODE  DESCRIPTION           PACK     COOL  UNIT PRICE  EXTENDED AMOUNT\n// 1         70116      BRUSSEL SPROUTS MEDIUM 25#            47.92       47.92\n// 1         13544      RWPR 103 RIB REF       1pc / 28# USA 29.05       871.50\n\n'use strict';\n\nconst {\n  parseDate, parsePrice, parsePackSize, cleanDescription,\n  isSkipLine, isSubstitutionLine, extractDocNumber, extractDocDate,\n} = require('./utils');\n\n// Hardie's line item regex\n// Columns: QTY  ITEM_CODE  DESCRIPTION...  PACK  [COOL]  UNIT_PRICE  AMOUNT\n// Item code is always 5 digits. Prices are NN.NN at end of line.\n// PACK can be complex: \"25#\", \"12/3 CT\", \"1pc / 28#\", \"11/1#\", \"8/12 OZ\"\nconst LINE_RE = /^(\\d+)\\s+(\\d{5})\\s+(.+?)\\s{2,}(.+?)\\s{1,}(?:(USA|MEX|CAN|CHI|PER|COL|GUA|EC|NL)\\s+)?([\\d,.]+)\\s+([\\d,.]+)$/;\n\n// Simpler fallback: qty + item_code + rest (when spacing is irregular)\nconst LINE_RE2 = /^(\\d+)\\s+(\\d{5})\\s+(.{8,})$/;\n\nfunction parse(rawText) {\n  const warnings = [];\n  const lines = rawText.split('\\n').map(l => l.trim());\n\n  // ── Header fields ──────────────────────────────────────────\n  const docNumber = extractDocNumber(lines, ['INVOICE', 'CONFIRMATION']) || null;\n  const orderDate  = extractDocDate(lines, ['DATE', 'ORDER DATE'])  || null;\n\n  // Delivery date: not always explicit on order confirmation\n  // Try \"DATE/TRIP\" field from invoice format\n  let deliveryDate = null;\n  for (const line of lines) {\n    const m = line.match(/DATE\\/TRIP\\s+([\\d\\/]+)/i);\n    if (m) { deliveryDate = parseDate(m[1]); break; }\n  }\n\n  // Totals\n  let subtotal = null, tax = null, total = null;\n  for (const line of lines) {\n    let m;\n    m = line.match(/SUBTOTAL\\s+([\\d,]+\\.?\\d*)/i);\n    if (m) subtotal = parsePrice(m[1]);\n    m = line.match(/^TAX(?:\\/PCT\\.?)?\\s+\\$([\\d,.]+)/i);\n    if (m) tax = parsePrice(m[1]);\n    m = line.match(/INVOICE\\s+\\$([\\d,]+\\.?\\d*)/i);\n    if (m && !total) total = parsePrice(m[1]);\n    m = line.match(/TOTAL\\s+\\$([\\d,]+\\.?\\d*)/i);\n    if (m && !total) total = parsePrice(m[1]);\n  }\n\n  // ── Item lines ────────────────────────────────────────────\n  const items = [];\n  let nextIsSubstitution = false;\n  let prevSku = null;\n\n  for (const line of lines) {\n    if (isSkipLine(line)) continue;\n\n    if (isSubstitutionLine(line)) {\n      nextIsSubstitution = true;\n      continue;\n    }\n\n    // Try full regex first\n    let m = line.match(LINE_RE);\n    if (m) {\n      const [, qtyStr, sku, descRaw, packRaw, origin, unitPriceStr, amountStr] = m;\n      const qty       = parseFloat(qtyStr);\n      const unitPrice = parsePrice(unitPriceStr);\n      const amount    = parsePrice(amountStr);\n      const pack      = parsePackSize(packRaw.trim());\n      const desc      = cleanDescription(descRaw.trim());\n\n      const item = {\n        vendor_sku:      sku,\n        raw_description: descRaw.trim(),\n        description:     desc,\n        qty_ordered:     qty,\n        qty_received:    null,\n        purchase_unit:   inferPurchaseUnit(pack),\n        pack_description:packRaw.trim(),\n        pack_qty:        pack ? pack.count    : null,\n        pack_unit:       pack ? pack.unit     : null,\n        pack_size_each:  pack ? pack.sizeEach : null,\n        unit_price:      unitPrice,\n        amount:          amount,\n        is_substitution: nextIsSubstitution,\n        substituted_sku: nextIsSubstitution ? prevSku : null,\n        origin:          origin || null,\n        cool_flag:       false,\n        warnings:        [],\n      };\n\n      // OQR-003: Price sanity (can't compare without order yet — deferred to OQR engine)\n      // OQR-006: Count-based products\n      if (pack && ['ct','ea','each'].includes(pack.unit)) {\n        item.warnings.push({\n          code:    'OQR-006',\n          message: `Count-based item: ${desc} (${packRaw.trim()}) — no weight for costing`,\n          field:   'pack_unit',\n        });\n      }\n\n      // OQR-008: Item with unusual SKU pattern or description\n      if (/^[A-Z]{2,4}\\d+/.test(sku) && !/^\\d+$/.test(sku)) {\n        item.warnings.push({\n          code:    'OQR-008',\n          message: `Unusual SKU pattern: ${sku} — verify ingredient match`,\n          field:   'vendor_sku',\n        });\n      }\n\n      if (nextIsSubstitution) {\n        item.warnings.push({\n          code:    'OQR-002',\n          message: `Substitution: received ${desc} instead of original item`,\n          field:   'is_substitution',\n        });\n        nextIsSubstitution = false;\n      }\n\n      items.push(item);\n      prevSku = sku;\n      continue;\n    }\n\n    // Fallback: line starts with digit + 5-digit code but irregular spacing\n    m = line.match(LINE_RE2);\n    if (m) {\n      const [, qtyStr, sku, rest] = m;\n      // Extract prices from end of rest: two numbers like \"47.92 47.92\"\n      const priceMatch = rest.match(/([\\d,]+\\.\\d{2})\\s+([\\d,]+\\.\\d{2})$/);\n      if (priceMatch) {\n        const rawDesc    = rest.slice(0, rest.lastIndexOf(priceMatch[0])).trim();\n        // Try to split description from pack: pack is usually last token before prices\n        const parts      = rawDesc.split(/\\s{2,}/);\n        const packRaw    = parts.length > 1 ? parts[parts.length-1] : '';\n        const descRaw    = parts.length > 1 ? parts.slice(0,-1).join(' ') : rawDesc;\n        const pack       = parsePackSize(packRaw);\n        const desc       = cleanDescription(descRaw);\n\n        items.push({\n          vendor_sku:      sku,\n          raw_description: rawDesc.trim(),\n          description:     desc,\n          qty_ordered:     parseFloat(qtyStr),\n          qty_received:    null,\n          purchase_unit:   inferPurchaseUnit(pack),\n          pack_description:packRaw.trim(),\n          pack_qty:        pack ? pack.count : null,\n          pack_unit:       pack ? pack.unit  : null,\n          unit_price:      parsePrice(priceMatch[1]),\n          amount:          parsePrice(priceMatch[2]),\n          is_substitution: nextIsSubstitution,\n          substituted_sku: nextIsSubstitution ? prevSku : null,\n          origin:          null,\n          cool_flag:       false,\n          warnings:        nextIsSubstitution ? [{\n            code:'OQR-002', message:`Substitution: received ${desc}`, field:'is_substitution'\n          }] : [],\n        });\n        if (nextIsSubstitution) nextIsSubstitution = false;\n        prevSku = sku;\n      }\n    }\n  }\n\n  if (!items.length) {\n    warnings.push({\n      code:    'PARSE_ERROR',\n      message: 'No line items found — document format may have changed',\n    });\n  }\n\n  return {\n    vendor:          \"Hardie's Fresh Foods / Dairyland Produce\",\n    document_type:   'order_confirmation',\n    order_number:    docNumber,\n    order_date:      orderDate,\n    delivery_date:   deliveryDate,\n    subtotal,\n    tax,\n    total,\n    items,\n    warnings,\n  };\n}\n\n// Infer purchase unit from pack structure\nfunction inferPurchaseUnit(pack) {\n  if (!pack) return null;\n  const u = pack.unit;\n  if (['ct','ea','each'].includes(u)) return 'each';\n  if (['lb','lbs'].includes(u))       return 'lb';\n  if (u === 'oz')                     return 'oz';\n  if (['gal','l','ml'].includes(u))   return u;\n  return u || null;\n}\n\nmodule.exports = { parse };\n",
  "hardies-invoice": "// ── vendor-parsers/hardies-invoice.js ────────────────────────\n// Parser for Hardie's / Dairyland Produce INVOICE/POD\n// Document type: invoice\n//\n// Substitution logic (real PDF layout):\n//   WATERMELON SEEDLESS  ordered:1  shipped:0   ← not delivered\n//   WATERMELON LOCAL     ordered:0  shipped:1   ← substitution (ordered=0, shipped>0)\n//   SUBSTITUTION                                ← marker: applies to PREVIOUS item\n//   SPINACH BABY         ordered:2  shipped:2   ← normal item, NOT substitution\n//\n// Rule: SUBSTITUTION marker retroactively applies to the last parsed item.\n// Additionally: ordered=0, shipped>0 pattern is always a substitution.\n\n'use strict';\n\nconst {\n  parseDate, parsePrice, parsePackSize, cleanDescription,\n  isSkipLine, isSubstitutionLine, extractDocNumber, extractDocDate,\n} = require('./utils');\n\nconst LINE_RE  = /^(\\d+)\\s+(\\d+)\\s+(\\d{5})\\s+(.+?)\\s{2,}(.+?)\\s{1,}([\\d,.]+)\\s+([\\d,.]+)(?:\\s+.*)?$/;\nconst LINE_RE2 = /^(\\d+)\\s+(\\d+)\\s+(\\d{5})\\s+(.{8,})$/;\n\nfunction buildItem(sku, descRaw, packRaw, ord, shp, unitPrice, amount, prevSku) {\n  const pack = parsePackSize(packRaw.trim());\n  const desc = cleanDescription(descRaw.trim());\n  const lw   = [];\n  const isSub = (ord === 0 && shp > 0);\n\n  if (ord !== shp) lw.push({\n    code:    'OQR-007',\n    message: `Qty mismatch: ordered ${ord}, shipped ${shp} of ${desc}`,\n    field:   'qty_received',\n    possible_reasons: ['Short shipped','Back ordered','Vendor error','Substitution'],\n  });\n\n  if (isSub) lw.push({\n    code:    'OQR-002',\n    message: `Substitution: ordered 0, received ${shp} of ${desc}`,\n    field:   'is_substitution',\n  });\n\n  if (pack && ['ct','ea','each','dz','doz'].includes(pack.unit)) lw.push({\n    code:    'OQR-006',\n    message: `Count-based: ${desc} (${packRaw.trim()}) — no weight for costing`,\n    field:   'pack_unit',\n  });\n\n  // ── Catchweight detection (meat sold by the pound) ──\n  // Pattern: pack like \"1pc / 28#\" (nominal weight) + unit_price is PER POUND,\n  // line amount = actual weight × price/lb. Hardie's prints \"Total weight: N\"\n  // but the exact math is amount ÷ unit_price = actual pounds.\n  // Detection: amount ≠ unit_price (so not a flat case price) AND the implied\n  // weight is within 50% of the nominal pack weight.\n  let catchweight = false, priceLb = null, actualLb = null;\n  if (pack && pack.unit === 'lb' && unitPrice > 0 && amount > 0\n      && Math.abs(amount - unitPrice) > 0.02) {\n    const impliedLb = amount / unitPrice;\n    const nominalLb = pack.count * pack.sizeEach;\n    if (nominalLb > 0 && impliedLb >= nominalLb * 0.5 && impliedLb <= nominalLb * 1.5) {\n      catchweight = true;\n      priceLb  = unitPrice;\n      actualLb = Math.round(impliedLb * 100) / 100;\n    }\n  }\n\n  return {\n    vendor_sku:       sku,\n    raw_description:  descRaw.trim(),\n    description:      desc,\n    qty_ordered:      ord,\n    qty_received:     shp,\n    purchase_unit:    inferPurchaseUnit(pack),\n    pack_description: packRaw.trim(),\n    pack_qty:         pack ? pack.count     : null,\n    pack_unit:        pack ? pack.unit      : null,\n    pack_size_each:   pack ? pack.sizeEach  : null,\n    catchweight:      catchweight,\n    price_per_lb:     priceLb,\n    actual_weight_lb: actualLb,\n    unit_price:       unitPrice,\n    amount:           amount,\n    is_substitution:  isSub,\n    substituted_sku:  isSub ? prevSku : null,\n    origin:           null,\n    cool_flag:        false,\n    warnings:         lw,\n  };\n}\n\nfunction parse(rawText) {\n  const warnings = [];\n  // OCR sometimes glues the first item onto the table header line:\n  // \"QUANTITY ITEM CODE ... SHIPPED AMOUNT 1 1 13544 RWPR ...\"\n  // isSkipLine would drop the whole line (starts with QUANTITY) — losing the item.\n  // Inject a newline after the header keywords when item data follows.\n  rawText = String(rawText || '').replace(/(SHIPPED\\s+AMOUNT)[ \\t]+(?=\\d)/g, '$1\\n');\n  const lines = rawText.split('\\n').map(l => l.trim());\n\n  const docNumber    = extractDocNumber(lines, ['INVOICE/POD', 'INVOICE']) || null;\n  const orderDate    = extractDocDate(lines, ['DATE/TRIP', 'ORDER DATE', 'DATE']) || null;\n  let   deliveryDate = null;\n  for (const l of lines) {\n    const m = l.match(/DATE\\/TRIP\\s+([\\d\\/]+)/i);\n    if (m) { deliveryDate = parseDate(m[1]); break; }\n  }\n\n  let subtotal = null, tax = null, total = null;\n  for (const l of lines) {\n    let m;\n    m = l.match(/SUBTOTAL\\s+([\\d,]+\\.?\\d*)/i);      if (m) subtotal = parsePrice(m[1]);\n    m = l.match(/TAX\\/PCT\\.?\\s+\\$([\\d,.]+)/i);       if (m) tax      = parsePrice(m[1]);\n    m = l.match(/INVOICE\\s+\\$([\\d,]+\\.?\\d*)/i);      if (m && !total) total = parsePrice(m[1]);\n  }\n\n  const items  = [];\n  let prevSku  = null;\n\n  for (const line of lines) {\n    if (isSkipLine(line)) continue;\n\n    // SUBSTITUTION marker → retrofit the LAST parsed item, not the next one\n    if (isSubstitutionLine(line)) {\n      if (items.length > 0) {\n        const last = items[items.length - 1];\n        last.is_substitution = true;\n        if (!last.substituted_sku) {\n          // Find the item before it that was ordered but not shipped\n          const prevItem = items.slice(0, -1).reverse().find(i => i.qty_received === 0);\n          last.substituted_sku = prevItem?.vendor_sku || null;\n        }\n        // Ensure OQR-002 warning is on the last item\n        if (!last.warnings.some(w => w.code === 'OQR-002')) {\n          last.warnings.push({\n            code:    'OQR-002',\n            message: `Substitution confirmed by SUBSTITUTION marker`,\n            field:   'is_substitution',\n          });\n        }\n      }\n      continue;\n    }\n\n    let m = line.match(LINE_RE);\n    if (m) {\n      const [, ordS, shpS, sku, descRaw, packRaw, upS, amtS] = m;\n      const item = buildItem(sku, descRaw, packRaw, parseFloat(ordS), parseFloat(shpS),\n        parsePrice(upS), parsePrice(amtS), prevSku);\n      items.push(item);\n      prevSku = sku;\n      continue;\n    }\n\n    m = line.match(LINE_RE2);\n    if (m) {\n      const [, ordS, shpS, sku, rest] = m;\n      const pm = rest.match(/([\\d,]+\\.\\d{2})\\s+([\\d,]+\\.\\d{2})(?:\\s+.*)?$/);\n      if (pm) {\n        const rawDesc = rest.slice(0, rest.lastIndexOf(pm[0])).trim();\n        const parts   = rawDesc.split(/\\s{2,}/);\n        let packRaw = parts.length > 1 ? parts[parts.length - 1] : '';\n        let descRaw = parts.length > 1 ? parts.slice(0, -1).join(' ') : rawDesc;\n        // Single-spaced OCR line: pack glued to description — extract trailing\n        // pack pattern like \"1pc / 28#\", \"11/1#\", \"25#\"\n        if (!packRaw) {\n          const pk = rawDesc.match(/^(.*?)\\s+((?:\\d+\\s*(?:PC|PCS|EA|EACH)?\\s*\\/\\s*)?[\\d.]+\\s*#)\\s*$/i);\n          if (pk) { descRaw = pk[1].trim(); packRaw = pk[2].trim(); }\n        }\n        const item = buildItem(sku, descRaw, packRaw, parseFloat(ordS), parseFloat(shpS),\n          parsePrice(pm[1]), parsePrice(pm[2]), prevSku);\n        items.push(item);\n        prevSku = sku;\n      }\n    }\n  }\n\n  if (!items.length) warnings.push({ code: 'PARSE_ERROR', message: 'No line items found' });\n\n  return {\n    vendor:        \"Hardie's Fresh Foods / Dairyland Produce\",\n    document_type: 'invoice',\n    order_number:  docNumber,\n    order_date:    orderDate,\n    delivery_date: deliveryDate,\n    subtotal, tax, total,\n    items, warnings,\n  };\n}\n\nfunction inferPurchaseUnit(pack) {\n  if (!pack) return null;\n  const u = pack.unit;\n  if (['ct','ea','each'].includes(u)) return 'each';\n  if (['lb','lbs'].includes(u))       return 'lb';\n  if (u === 'oz')                     return 'oz';\n  return u || null;\n}\n\nmodule.exports = { parse };\n",
  "hardies-credit": "// ── vendor-parsers/hardies-credit.js ─────────────────────────\n// Parser for Hardie's / Dairyland Produce CREDIT memo\n// Document type: credit_memo\n//\n// Real format (from 00668419):\n// QUANTITY  ITEM_CODE  DESCRIPTION         PACK  COOL  UNIT_PRICE  EXTENDED  RETURN_REASON\n// 2         25265      CHZ MOZZ SHRED W/M  5#    USA   24.96       -49.92    5A\n// Original Sales Order: 06991299\n\n'use strict';\n\nconst {\n  parseDate, parsePrice, parsePackSize, cleanDescription,\n  isSkipLine, extractDocNumber, extractDocDate,\n} = require('./utils');\n\n// Credit line: QTY  ITEM_CODE  DESCRIPTION  PACK  [COOL]  UNIT_PRICE  AMOUNT  RETURN_CODE\nconst LINE_RE = /^(\\d+)\\s+(\\d{5})\\s+(.+?)\\s{2,}(.+?)\\s{1,}(?:(USA|MEX|CAN|CHI)\\s+)?([\\d,.]+)\\s+(-?[\\d,.]+)\\s+([A-Z0-9]{1,3})?.*$/;\nconst LINE_RE2 = /^(\\d+)\\s+(\\d{5})\\s+(.{8,})$/;\n\n// Credit codes from footer\nconst RETURN_CODE_LABELS = {\n  NN: 'Do Not Need',\n  SH: 'Short on Truck',\n  NO: 'Did Not Order',\n  OO: 'Over Ordered',\n  MS: 'Mis-shipped',\n  MK: 'Mis-keyed',\n  '5A': 'Quality/Other',\n};\n\nfunction parse(rawText) {\n  const warnings = [];\n  const lines = rawText.split('\\n').map(l => l.trim());\n\n  // ── Header ────────────────────────────────────────────────\n  const creditNumber   = extractDocNumber(lines, ['CREDIT']) || null;\n  const creditDate     = extractDocDate(lines, ['DATE', 'ORDER DATE']) || null;\n\n  // Original sales order reference\n  let originalOrder = null;\n  for (const line of lines) {\n    const m = line.match(/Original Sales Order[:\\s]+([\\d]+)/i);\n    if (m) { originalOrder = m[1]; break; }\n  }\n\n  // Total (negative)\n  let total = null;\n  for (const line of lines) {\n    const m = line.match(/TOTAL\\s+\\$(-?[\\d,]+\\.?\\d*)/i);\n    if (m) { total = parsePrice(m[1]); break; }\n  }\n\n  // ── Item lines ────────────────────────────────────────────\n  const items = [];\n\n  for (const line of lines) {\n    if (isSkipLine(line)) continue;\n    if (/Original Sales Order/i.test(line)) continue;\n\n    let m = line.match(LINE_RE);\n    if (m) {\n      const [, qtyStr, sku, descRaw, packRaw, origin, unitPriceStr, amountStr, returnCode] = m;\n      const pack = parsePackSize(packRaw.trim());\n      const returnLabel = returnCode ? (RETURN_CODE_LABELS[returnCode.toUpperCase()] || returnCode) : null;\n\n      items.push({\n        vendor_sku:       sku,\n        raw_description:  descRaw.trim(),\n        description:      cleanDescription(descRaw.trim()),\n        qty_credited:     parseFloat(qtyStr),\n        purchase_unit:    inferPurchaseUnit(pack),\n        pack_description: packRaw.trim(),\n        pack_qty:         pack ? pack.count : null,\n        pack_unit:        pack ? pack.unit  : null,\n        unit_price:       parsePrice(unitPriceStr),\n        amount:           parsePrice(amountStr),   // negative\n        origin:           origin || null,\n        return_code:      returnCode || null,\n        return_reason:    returnLabel,\n        warnings:         [],\n      });\n      continue;\n    }\n\n    // Fallback\n    m = line.match(LINE_RE2);\n    if (m) {\n      const [, qtyStr, sku, rest] = m;\n      // Credit amounts are negative: \"-49.92\" or \"49.92\" at end\n      const priceMatch = rest.match(/([\\d,]+\\.\\d{2})\\s+(-?[\\d,]+\\.\\d{2})(?:\\s+([A-Z0-9]{1,3}))?$/);\n      if (priceMatch) {\n        const rawDesc = rest.slice(0, rest.lastIndexOf(priceMatch[0])).trim();\n        const parts   = rawDesc.split(/\\s{2,}/);\n        const packRaw = parts.length > 1 ? parts[parts.length-1] : '';\n        const descRaw = parts.length > 1 ? parts.slice(0,-1).join(' ') : rawDesc;\n        const pack    = parsePackSize(packRaw);\n        const rc      = priceMatch[3] || null;\n\n        items.push({\n          vendor_sku:       sku,\n          raw_description:  rawDesc.trim(),\n          description:      cleanDescription(descRaw),\n          qty_credited:     parseFloat(qtyStr),\n          purchase_unit:    inferPurchaseUnit(pack),\n          pack_description: packRaw.trim(),\n          pack_qty:         pack ? pack.count : null,\n          pack_unit:        pack ? pack.unit  : null,\n          unit_price:       parsePrice(priceMatch[1]),\n          amount:           parsePrice(priceMatch[2]),\n          origin:           null,\n          return_code:      rc,\n          return_reason:    rc ? (RETURN_CODE_LABELS[rc.toUpperCase()] || rc) : null,\n          warnings:         [],\n        });\n      }\n    }\n  }\n\n  // OQR-001: Credit must be linked to original order\n  if (!originalOrder) {\n    warnings.push({\n      code:    'OQR-001',\n      message: 'Credit memo has no original order reference — manual linking required',\n      field:   'original_order_number',\n    });\n  }\n\n  if (!items.length) {\n    warnings.push({ code:'PARSE_ERROR', message:'No credit line items found' });\n  }\n\n  return {\n    vendor:               \"Hardie's Fresh Foods / Dairyland Produce\",\n    document_type:        'credit_memo',\n    credit_number:        creditNumber,\n    credit_date:          creditDate,\n    original_order_number:originalOrder,\n    total,\n    items,\n    warnings,\n  };\n}\n\nfunction inferPurchaseUnit(pack) {\n  if (!pack) return null;\n  const u = pack.unit;\n  if (['ct','ea','each'].includes(u)) return 'each';\n  if (['lb','lbs'].includes(u))       return 'lb';\n  if (u === 'oz')                     return 'oz';\n  return u || null;\n}\n\nmodule.exports = { parse };\n",
  "freshpoint-invoice": "// ── vendor-parsers/freshpoint-invoice.js ─────────────────────\n// Parser for FreshPoint Dallas INVOICE\n//\n// Formato colonne OCR:\n// Item(SKU) | QtyOrd | QtyShip | Pack | PackSize | Description | UnitPrice | ExtendedPrice | St\n//\n// Logica prezzi:\n// - Tutto è per_case — il prezzo è sempre per confezione\n// - conversion_to_base calcolato dal pack size (es. 11# → 4989g, 3/2# → 2722g)\n// - price_per_100g = unit_price / conversion_to_base × 100\n\n'use strict';\n\nconst {\n  parseDate, parsePrice, parsePackSize, cleanDescription, isSkipLine,\n} = require('./utils');\n\nconst SKIP_RE = /invoice|customer|salesman|bill to|ship to|route|terms|due date|fuel surcharge|^page\\s|special instructions|remit payment|p\\.o\\. number|order date|quantit|unit\\s+price|extended|sub.?total|^cases|driver|splits|cubes|state|tax|total weight|item\\s+desc/i;\n\n// Converte pack size string in grammi totali\n// Esempi: \"11#\" → 4989g, \"3/2#\" → 3×2×453.592=2722g\n// \"5 LB\" → 2268g, \"48CT\" → null (conta), \"3 CT\" → null\nfunction packToGrams(packStr) {\n  if (!packStr) return null;\n  const s = packStr.trim().toUpperCase();\n\n  // Pattern \"N/M#\" o \"N/MLB\" — N unità da M lb\n  // Es: \"3/2#\" = 3 × 2 lb = 6 lb\n  const fracM = s.match(/^(\\d+)\\s*\\/\\s*(\\d+(?:\\.\\d+)?)\\s*(?:#|LB|LBS)$/);\n  if (fracM) return parseFloat(fracM[1]) * parseFloat(fracM[2]) * 453.592;\n\n  // Pattern \"N#\" o \"N LB\" — N lb totali\n  const lbM = s.match(/^(\\d+(?:\\.\\d+)?)\\s*(?:#|LB|LBS)$/);\n  if (lbM) return parseFloat(lbM[1]) * 453.592;\n\n  // Pattern \"N OZ\"\n  const ozM = s.match(/^(\\d+(?:\\.\\d+)?)\\s*OZ$/);\n  if (ozM) return parseFloat(ozM[1]) * 28.3495;\n\n  // Pattern \"N KG\"\n  const kgM = s.match(/^(\\d+(?:\\.\\d+)?)\\s*KG$/);\n  if (kgM) return parseFloat(kgM[1]) * 1000;\n\n  // Pattern \"N/MOZ\" — N unità da M oz\n  const fracOzM = s.match(/^(\\d+)\\s*\\/\\s*(\\d+(?:\\.\\d+)?)\\s*OZ$/);\n  if (fracOzM) return parseFloat(fracOzM[1]) * parseFloat(fracOzM[2]) * 28.3495;\n\n  // CT/EA — conta, nessun peso\n  return null;\n}\n\nfunction parseLine(line) {\n  line = line.replace(/[^\\x20-\\x7E]/g, ' ').replace(/\\s+/g, ' ').trim();\n\n  // SKU = 3-6 cifre all'inizio\n  const skuM = line.match(/^(\\d{3,6})\\s+(.+)/);\n  if (!skuM) return null;\n  const sku  = skuM[1];\n  const rest = skuM[2];\n\n  // Estrai i due prezzi alla fine della riga\n  // Es: \"... 33.15  66.30  US\" o \"... 33.15  66.30\"\n  const priceM = rest.match(/(\\d{1,4}(?:,\\d{3})*\\.\\d{2})\\s+(\\d{1,4}(?:,\\d{3})*\\.\\d{2})(?:\\s+[A-Z]{2})?$/);\n  if (!priceM) return null;\n\n  const unitPrice = parsePrice(priceM[1]);\n  const extended  = parsePrice(priceM[2]);\n  if (!unitPrice) return null;\n\n  const middle = rest.slice(0, rest.lastIndexOf(priceM[0])).trim();\n\n  // Qty ordinato e spedito\n  const qtyM = middle.match(/^(\\d+)\\s+(\\d+)\\s+(.+)/);\n  if (!qtyM) return null;\n\n  const qtyOrd  = parseInt(qtyM[1]) || 0;\n  const qtyShip = parseInt(qtyM[2]) || 0;\n  let   packRest = qtyM[3].trim();\n\n  // Pack type: BX, CS, BOX, EACH, EA, LB, CT\n  const packTypeM = packRest.match(/^(BX|CS|BOX|EACH|EA|CT|LB)\\s*(.*)/i);\n  let packType = null, packSize = null, descRaw = packRest;\n\n  if (packTypeM) {\n    packType = packTypeM[1].toUpperCase();\n    const afterType = packTypeM[2].trim();\n\n    // Pack size è il primo token se contiene #, LB, OZ, KG, CT, numeri con /\n    const sizeM = afterType.match(/^(\\d[\\d\\/\\.]*\\s*(?:#|LB|LBS|OZ|KG|CT|DZ)?)\\s+(.+)/i);\n    if (sizeM) {\n      packSize = sizeM[1].trim();\n      descRaw  = sizeM[2].trim();\n    } else {\n      descRaw = afterType;\n    }\n  }\n\n  // Rimuovi suffisso origine (US, MX, ecc.) dalla descrizione\n  descRaw = descRaw.replace(/\\s+[A-Z]{2}\\s*$/, '').trim();\n\n  const desc    = cleanDescription(descRaw || packRest);\n  const totalG  = packToGrams(packSize);\n  const p100    = (totalG && unitPrice) ? parseFloat(((unitPrice / totalG) * 100).toFixed(4)) : null;\n\n  const itemWarnings = [];\n\n  if (qtyOrd !== qtyShip && qtyOrd > 0 && qtyShip > 0) {\n    itemWarnings.push({\n      code: 'OQR-007',\n      message: `Qty mismatch: ordered ${qtyOrd}, shipped ${qtyShip} of ${desc}`,\n      field: 'qty_received',\n    });\n  }\n\n  if (!totalG && packSize) {\n    itemWarnings.push({\n      code: 'OQR-006',\n      message: `Count-based: ${desc} (${packSize}) — no weight for costing`,\n      field: 'pack_unit',\n    });\n  }\n\n  return {\n    vendor_sku:        sku,\n    raw_description:   descRaw || packRest,\n    description:       desc,\n    qty_ordered:       qtyOrd,\n    qty_received:      qtyShip,\n    pack_description:  packSize || packRest,\n    pack_qty:          null,\n    pack_unit:         packType,\n    unit_price:        unitPrice,\n    amount:            extended,\n    extended_price:    extended,\n    price_type:        'per_case',\n    conversion_to_base: totalG ? Math.round(totalG) : null,\n    _cost_per_100g:    p100,\n    catchweight:       false,\n    warnings:          itemWarnings,\n  };\n}\n\nfunction parse(rawText) {\n  const text  = String(rawText || '');\n  const lines = text.split('\\n').map(l => l.trim()).filter(Boolean);\n\n  let invoiceNumber = null, invoiceDate = null, total = null, subtotal = null;\n  for (const line of lines) {\n    let m;\n    m = line.match(/Invoice\\s+No\\.?\\s*[:\\-]?\\s*(\\w+)/i);   if (m) invoiceNumber = m[1];\n    m = line.match(/Invoice\\s+Date\\s*[:\\-]?\\s*([\\d\\/]+)/i); if (m) invoiceDate = parseDate(m[1]);\n    m = line.match(/Sub\\s*[-\\s]*Total\\s+([\\d,]+\\.?\\d*)/i);  if (m) subtotal = parsePrice(m[1]);\n    m = line.match(/(?:^|\\s)Total\\s+([\\d,]+\\.?\\d*)\\s*$/i);  if (m && !total) total = parsePrice(m[1]);\n  }\n\n  const items = [];\n  for (const line of lines) {\n    if (SKIP_RE.test(line)) continue;\n    if (line.length < 20) continue;\n    const item = parseLine(line);\n    if (item && item.unit_price) items.push(item);\n  }\n\n  return {\n    vendor:         'FreshPoint Dallas',\n    document_type:  'invoice',\n    invoice_number: invoiceNumber,\n    invoice_date:   invoiceDate,\n    subtotal,\n    total,\n    items,\n    warnings: [],\n  };\n}\n\nmodule.exports = { parse };\n",
  "fruge-invoice": "// \u2500\u2500 vendor-parsers/fruge-invoice.js \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Parser for Fruge Seafood INVOICE\n//\n// Formato colonne:\n// Ordered | Product Description | Shipped | Unit Price | Amount\n// Header:  INVOICE 855939 / Taken 09/14/26 / Shipped 09/14/26 / Invoiced 09/14/26\n// Total:   \"... Pay:  \\n$828.25\" (label and amount can land on different\n//          physical PDF lines \u2014 matched against the whole text, not\n//          per-line, for exactly this reason)\n//\n// MICRO-TASK 34 \u2014 root cause and fix\n// -----------------------------------\n// The previous version of this file hardcoded every quantity/price unit\n// to \"LB\", on the theory that Fruge always sells and prices by the\n// pound. Real invoices disprove that: the Shipped and Unit Price\n// columns each carry their OWN unit independently \u2014 LB, BG (bag), GA\n// (gallon), CA/CS (case), EA (each) \u2014 and the two don't have to match\n// (e.g. LOBSTER below: ordered/shipped \"1 CA\", but priced \"$27.50 LB\").\n// Hardcoding \"LB\" meant any line shipped in CA/BG/GA never matched at\n// all and was silently dropped \u2014 invoice #855939 and #856363 happened\n// to contain ZERO lines shipped in bare \"LB\", so they parsed to 0 items\n// with no warning at all (the bug this task fixes). Invoice #854668\n// only \"worked\" because 1 of its 5 real lines (BRANZINI) happened to\n// use LB for both columns; the other 4 were being silently dropped by\n// this file even though it reported no error.\n//\n// This version is ported, deliberately close to verbatim (regex and\n// arithmetic unchanged, only var\u2192const/let and the debug console.log\n// calls removed), from the browser copy's `parseFrugeInvoice` /\n// \"FRUGE PARSER v5\" in js/vendor-parser-ui.js \u2014 proven correct against\n// real production data: invoice #854668's already-stored parsed_json\n// (cost_per_lb, total_weight_lb, pack_description, catchweight \u2014 every\n// field, for every one of its 5 real items) matches this logic's output\n// exactly, byte for byte, confirming it is what actually parsed that\n// invoice historically (not this file's previous version). See\n// MICRO-TASK 34 report for the line-by-line verification against\n// #854668, #855939 and #856363.\n//\n// Unit-derived weight (totalLb) is found three ways, depending on the\n// Shipped unit \u2014 never invented, always read from text already on the\n// invoice:\n//   - Shipped in LB directly            \u2192 totalLb = the shipped qty itself.\n//   - Shipped in BG/GA/GAL              \u2192 totalLb = shipped qty \u00d7 the\n//     \"N lb\" weight-per-unit printed in the description or (since the\n//     description sometimes wraps to the next physical PDF line, e.g.\n//     \"BRISTOL, 8 LB GAL 8lb\") one of the next 3 lines.\n//   - Shipped in CA/CS                  \u2192 totalLb = shipped qty \u00d7 the\n//     \"N x M lb\" pack breakdown printed the same way (own description or\n//     next few lines), e.g. \"(5 X 2 LBS)\", \"10x2.5lb\".\n// When none of these is found (e.g. LOBSTER: \"10lb\" is glued to the\n// product's own size descriptor, not a \"N x M lb\" case breakdown), the\n// item is still extracted \u2014 sku/description/qty/unit_price/amount are\n// never in doubt \u2014 just without a derived weight, so cost_per_100g\n// stays null rather than guessing. This exactly matches the real,\n// already-proven behavior for LOBSTER in #854668.\n\n'use strict';\n\nconst { parseDate } = require('./utils');\n\nconst LINE_RE = /^\\s*\\d+(?:\\.\\d+)?\\s+(LB|BG|GA|GAL|CA|CS|EA)\\s+([A-Z0-9]{6,16})\\s*[-\\u2013]\\s*(.+?)\\s+(\\d+(?:\\.\\d+)?)\\s+(LB|BG|GA|GAL|CA|CS|EA)\\s+\\$?([\\d,]+\\.\\d{2})\\s+(?:LB|BG|GA|GAL|CA|CS|EA)\\s+\\$?([\\d,]+\\.\\d{2})/i;\n\nfunction parse(rawText) {\n  const text = String(rawText || '');\n\n  let invoiceNumber = null, invoiceDate = null, total = null;\n  const invM = text.match(/INVOICE\\s+(\\d+)/i);          if (invM) invoiceNumber = invM[1];\n  const invdM = text.match(/Invoiced\\s+([\\d\\/]+)/i);    if (invdM) invoiceDate = parseDate(invdM[1]);\n  // FIX (MICRO-TASK 34): matched against the whole text, not per-line \u2014\n  // \"Pay:\" and the dollar amount can land on different physical PDF\n  // lines (confirmed real in #855939/#856363/#854668 alike), so a\n  // per-line match silently found nothing and left total/subtotal null\n  // for every Fruge invoice, not just the two failing ones.\n  const payM = text.match(/Pay:\\s*\\$?([\\d,]+\\.\\d{2})/i); if (payM) total = parseFloat(payM[1].replace(/,/g, ''));\n\n  const lines = text.split('\\n').map((l) => l.trim());\n  const items = [];\n  const warnings = [];\n\n  for (let i = 0; i < lines.length; i++) {\n    const m = lines[i].match(LINE_RE);\n    if (!m) continue;\n\n    const sku = m[2];\n    const descRaw = m[3].trim();\n    const shpQty = parseFloat(m[4]);\n    const shpUnit = m[5].toUpperCase();\n    const unitPrice = parseFloat(m[6].replace(/,/g, ''));\n    const amount = parseFloat(m[7].replace(/,/g, ''));\n\n    let totalLb = null;\n\n    if (shpUnit === 'LB') {\n      // Catchweight \u2014 shipped already in LB.\n      totalLb = shpQty;\n    } else if (shpUnit === 'BG' || shpUnit === 'GA' || shpUnit === 'GAL') {\n      const wm = descRaw.match(/(\\d+(?:\\.\\d+)?)\\s*lb\\b/i);\n      if (wm) {\n        totalLb = shpQty * parseFloat(wm[1]);\n      } else {\n        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {\n          const nxt = lines[j].trim();\n          if (LINE_RE.test(nxt)) break;\n          const wm2 = nxt.match(/(\\d+(?:\\.\\d+)?)\\s*lb\\b/i);\n          if (wm2) { totalLb = shpQty * parseFloat(wm2[1]); break; }\n        }\n      }\n    } else if (shpUnit === 'CA' || shpUnit === 'CS') {\n      let mxm = descRaw.match(/(\\d+)\\s*[xX]\\s*(\\d+(?:\\.\\d+)?)\\s*(?:LBS?|lb)/i);\n      if (!mxm) {\n        for (let k = i + 1; k < Math.min(i + 4, lines.length); k++) {\n          const nxt2 = lines[k].trim();\n          if (LINE_RE.test(nxt2)) break;\n          mxm = nxt2.match(/(\\d+)\\s*[xX]\\s*(\\d+(?:\\.\\d+)?)\\s*(?:LBS?|lb)/i);\n          if (mxm) break;\n        }\n      }\n      if (mxm) {\n        totalLb = shpQty * parseFloat(mxm[1]) * parseFloat(mxm[2]);\n      }\n    }\n\n    const packDesc = totalLb ? (parseFloat(totalLb.toFixed(2)) + ' LB') : (shpQty + ' ' + shpUnit);\n    const costPerLb = totalLb ? (amount / totalLb) : null;\n    const cost100g = costPerLb ? parseFloat(((costPerLb / 453.592) * 100).toFixed(4)) : null;\n\n    const desc = descRaw\n      .replace(/\\d+(?:\\.\\d+)?\\s*lb\\b/gi, '')\n      .replace(/GALLON/gi, '')\n      .replace(/\\s+/g, ' ')\n      .trim();\n\n    items.push({\n      vendor_sku: sku,\n      description: desc,\n      raw_description: descRaw,\n      qty_ordered: null,\n      qty_received: shpQty,\n      received_unit: shpUnit,\n      pack_description: packDesc,\n      total_weight_lb: totalLb ? parseFloat(totalLb.toFixed(4)) : null,\n      unit_price: unitPrice,\n      amount: amount,\n      cost_per_lb: costPerLb ? parseFloat(costPerLb.toFixed(4)) : null,\n      _cost_per_100g: cost100g,\n      price_type: 'per_lb',\n      catchweight: shpUnit === 'LB',\n      warnings: [],\n    });\n  }\n\n  // GUARD (MICRO-TASK 34) \u2014 a document index.js has already identified\n  // as a Fruge invoice, with a real document number, that nonetheless\n  // yields zero parseable line items must never be able to reach\n  // preflight-clean. This is the exact failure mode that let #855939\n  // and #856363 land in status='error' with warnings=null (silent \u2014\n  // no signal at all). Explicit, blocking, and named distinctly from\n  // the generic PARSE_ERROR other vendors use, so it can never be\n  // mistaken for the info-only \"technical error\" codes (see\n  // isBlockingWarning() in edge-functions/vendor-doc-auto-import and\n  // vdrWarningToQuestion() in js/vendor-documents-review.js \u2014 both\n  // updated in this task to treat PARSE_ERROR_NO_LINES as blocking).\n  if (items.length === 0) {\n    warnings.push({\n      code: 'PARSE_ERROR_NO_LINES',\n      message: invoiceNumber\n        ? `Fruge invoice #${invoiceNumber} recognized but 0 line items were parsed \u2014 layout may have changed`\n        : 'Fruge invoice recognized but 0 line items were parsed \u2014 layout may have changed',\n    });\n  }\n\n  return {\n    vendor: 'Fruge Seafood',\n    document_type: 'invoice',\n    document_number: invoiceNumber,\n    invoice_number: invoiceNumber,\n    document_date: invoiceDate,\n    invoice_date: invoiceDate,\n    subtotal: total,\n    total: total,\n    items,\n    warnings,\n  };\n}\n\nmodule.exports = { parse };\n",
  "bek-invoice": "// ── vendor-parsers/bek-invoice.js ────────────────────────────\n// Parser for Ben E. Keith Foods INVOICE\n//\n// Formato colonne:\n// Location(SKU) | Cases(Qty) | Pkgs | Item# | Brand | MfgCode | PackSize | Description | UnitPrice | Amount\n//\n// Logica prezzi:\n// - Sempre per_case — prezzo per confezione\n// - Pack size fisso dichiarato (es. 3/1 GAL, 2/10 LB, 1/50 LB)\n// - conversion_to_base calcolato dal pack size in grammi\n\n'use strict';\n\nconst { parseDate, parsePrice, parsePackSize, cleanDescription } = require('./utils');\n\nconst SKIP_RE = /ben e\\.? keith|invoice|sold to|ship to|customer|route|terms|due|section total|description\\s+promo|^cases\\s+pkg|please check|cash\\/ck|amt paid|total invoice|continued|^this page|tax\\b|^dry$|^frozen$/i;\n\n// Converte pack size BEK in grammi totali\n// Es: \"3/1 GAL\" → 3×3785g=11355g, \"2/10 LB\" → 2×10×453g=9072g\n// \"1/50 LB\" → 22680g, \"8/12 OZ\" → 8×12×28.35g=2721g\n// \"3/50 CT\" → null (conta), \"24/800 ML\" → 24×800=19200ml≈19200g\nfunction packToGrams(packStr) {\n  if (!packStr) return null;\n  const s = packStr.trim().toUpperCase().replace(/\\s+/g, ' ');\n\n  // Pattern \"N/M UNIT\" — N confezioni da M unità\n  const fracM = s.match(/^(\\d+)\\s*\\/\\s*(\\d+(?:\\.\\d+)?)\\s*(LB|LBS|#|OZ|GAL|ML|L|KG|G)\\s*$/);\n  if (fracM) {\n    const count = parseFloat(fracM[1]);\n    const size  = parseFloat(fracM[2]);\n    const unit  = fracM[3];\n    if (unit === 'LB' || unit === 'LBS' || unit === '#') return count * size * 453.592;\n    if (unit === 'OZ') return count * size * 28.3495;\n    if (unit === 'GAL') return count * size * 3785.41;\n    if (unit === 'ML') return count * size;\n    if (unit === 'L') return count * size * 1000;\n    if (unit === 'KG') return count * size * 1000;\n    if (unit === 'G') return count * size;\n  }\n\n  // Pattern \"N/M-M2 OZ\" range — usa media (es. \"12/22-24 OZ\")\n  const rangeM = s.match(/^(\\d+)\\s*\\/\\s*(\\d+)-(\\d+)\\s*(LB|OZ|#)\\s*$/);\n  if (rangeM) {\n    const count = parseFloat(rangeM[1]);\n    const avg   = (parseFloat(rangeM[2]) + parseFloat(rangeM[3])) / 2;\n    const unit  = rangeM[4];\n    if (unit === 'LB' || unit === '#') return count * avg * 453.592;\n    if (unit === 'OZ') return count * avg * 28.3495;\n  }\n\n  // Pattern semplice \"N LB\" o \"N#\"\n  const simpleM = s.match(/^(\\d+(?:\\.\\d+)?)\\s*(LB|LBS|#|OZ|GAL|KG|G|ML|L)\\s*$/);\n  if (simpleM) {\n    const size = parseFloat(simpleM[1]);\n    const unit = simpleM[2];\n    if (unit === 'LB' || unit === 'LBS' || unit === '#') return size * 453.592;\n    if (unit === 'OZ') return size * 28.3495;\n    if (unit === 'GAL') return size * 3785.41;\n    if (unit === 'KG') return size * 1000;\n    if (unit === 'G') return size;\n    if (unit === 'ML') return size;\n    if (unit === 'L') return size * 1000;\n  }\n\n  return null; // CT, EA, ecc. — conta, nessun peso\n}\n\n// Formato riga BEK:\n// DW07311  1  1  108509  MR CLEAN  1003700002621  3/1 GAL  Cleaner Floor & All Purpose  54.33  54.33\nfunction parseLine(line) {\n  line = line.replace(/[^\\x20-\\x7E]/g, ' ').replace(/\\s+/g, ' ').trim();\n\n  // Amount alla fine\n  const amountM = line.match(/\\$?([\\d,]+\\.\\d{2})\\s*$/);\n  if (!amountM) return null;\n  const amount = parsePrice(amountM[1]);\n\n  const beforeAmount = line.slice(0, line.lastIndexOf(amountM[0])).trim();\n\n  // Unit price prima dell'amount\n  const priceM = beforeAmount.match(/\\$?([\\d,]+\\.\\d{2})\\s*$/);\n  if (!priceM) return null;\n  const unitPrice = parsePrice(priceM[1]);\n  if (!unitPrice) return null;\n\n  const beforePrice = beforeAmount.slice(0, beforeAmount.lastIndexOf(priceM[0])).trim();\n\n  // Parsing da sinistra: SKU(Location) Cases Pkgs ItemNo Brand MfgCode PackSize Description\n  // SKU = alfanumerico all'inizio (es. DW07311, AF09212, 700150)\n  const tokens = beforePrice.split(/\\s+/);\n  if (tokens.length < 5) return null;\n\n  const sku   = tokens[0];\n  const qty   = parseInt(tokens[1]) || 1;\n  // tokens[2] = Pkgs (skip)\n  // tokens[3] = Item# (skip)\n  // tokens[4] = Brand (skip)\n  // tokens[5] = MfgCode (skip) — può essere lungo\n  // Dopo: PackSize + Description\n\n  // Cerca il pack size — pattern numerico con unità\n  let packSize = null, descStart = -1;\n  for (let i = 3; i < tokens.length; i++) {\n    const chunk2 = tokens[i] + (tokens[i+1] ? ' ' + tokens[i+1] : '');\n    const chunk1 = tokens[i];\n    // PackSize tipicamente: \"3/1\" seguito da \"GAL\", \"LB\", \"OZ\", \"CT\", \"ML\" ecc.\n    // oppure \"3/1 GAL\" in un token solo se OCR lo unisce\n    if (/^\\d+\\/\\d+$/.test(chunk1) && tokens[i+1] && /^(GAL|LB|LBS|OZ|CT|ML|L|KG|G|#)$/i.test(tokens[i+1])) {\n      packSize = chunk2;\n      descStart = i + 2;\n      break;\n    }\n    if (/^\\d+\\/\\d+-\\d+$/.test(chunk1) && tokens[i+1] && /^(OZ|LB|#)$/i.test(tokens[i+1])) {\n      packSize = chunk2;\n      descStart = i + 2;\n      break;\n    }\n    // PackSize tutto in un token (es. \"3/1GAL\" o \"24/800ML\")\n    if (/^\\d+\\/\\d+(?:\\.\\d+)?(GAL|LB|OZ|ML|CT|KG|G|#)$/i.test(chunk1)) {\n      packSize = chunk1;\n      descStart = i + 1;\n      break;\n    }\n  }\n\n  if (descStart === -1 || descStart >= tokens.length) return null;\n\n  const descRaw = tokens.slice(descStart).join(' ').trim();\n  if (!descRaw || descRaw.length < 3) return null;\n\n  // Ignora righe supply/cleaning (non food)\n  if (/cleaner|floor|sanitiz|chemical|glove|bag|container|wrap|film|towel/i.test(descRaw)) {\n    return null; // Skip non-food items\n  }\n\n  const desc   = cleanDescription(descRaw);\n  const totalG = packToGrams(packSize);\n  const p100   = (totalG && unitPrice) ? parseFloat(((unitPrice / totalG) * 100).toFixed(4)) : null;\n\n  const itemWarnings = [];\n  if (!totalG && packSize && !/ct|ea|each|dz/i.test(packSize)) {\n    itemWarnings.push({\n      code: 'OQR-006',\n      message: `Pack size \"${packSize}\" — peso non calcolabile per ${desc}`,\n      field: 'pack_unit',\n    });\n  }\n\n  return {\n    vendor_sku:         sku,\n    raw_description:    descRaw,\n    description:        desc,\n    qty_ordered:        qty,\n    qty_received:       qty,\n    pack_description:   packSize,\n    unit_price:         unitPrice,\n    amount:             amount,\n    extended_price:     amount,\n    price_type:         'per_case',\n    conversion_to_base: totalG ? Math.round(totalG) : null,\n    _cost_per_100g:     p100,\n    catchweight:        false,\n    warnings:           itemWarnings,\n  };\n}\n\nfunction parse(rawText) {\n  const text  = String(rawText || '');\n  const lines = text.split('\\n').map(l => l.trim()).filter(Boolean);\n\n  let invoiceNumber = null, invoiceDate = null, total = null;\n  for (const line of lines) {\n    let m;\n    m = line.match(/Invoice\\s*#?\\s*:?\\s*(\\d+)/i);        if (m) invoiceNumber = m[1];\n    m = line.match(/(?:Invoice|Order)\\s+Date\\s*:?\\s*([\\d\\/]+)/i); if (m) invoiceDate = parseDate(m[1]);\n    m = line.match(/Total\\s+Invoice\\s+([\\d,]+\\.\\d{2})/i); if (m) total = parsePrice(m[1]);\n  }\n\n  const items = [];\n  for (const line of lines) {\n    if (SKIP_RE.test(line)) continue;\n    if (line.length < 20) continue;\n    const item = parseLine(line);\n    if (item && item.unit_price) items.push(item);\n  }\n\n  return {\n    vendor:         'Ben E. Keith',\n    document_type:  'invoice',\n    invoice_number: invoiceNumber,\n    invoice_date:   invoiceDate,\n    subtotal:       null,\n    total,\n    items,\n    warnings: [],\n  };\n}\n\nmodule.exports = { parse };\n",
  "walmart-trevipay-invoice": "// ── vendor-parsers/walmart-trevipay-invoice.js ───────────────────────\n// Parser for Walmart Business / TreviPay INVOICE\n//\n// Input contract: this parser receives text ALREADY normalized by the\n// TreviPay-specific preprocessing introduced in commit 8325ed5\n// (vdrNormalizeTreviPayPage in vendor-documents-review.js) — Private Use\n// Area digit/decimal/minus codepoints already decoded, gap-aware column\n// join already applied. This file does NOT re-implement PUA decoding,\n// gap-aware joins, or any PDF.js extraction — those responsibilities\n// belong exclusively to the normalizer. It only ever consumes a plain\n// string via parse(rawText), same as every other vendor parser.\n//\n// Real-document audit findings this parser is built against (4 real\n// TreviPay invoices: c51dd720 Kitchen, 6c246fda/12fd6860/30082536 Bar —\n// the latter 3 used strictly as technical PDF-format samples):\n//\n// - Header fields (Invoice #, Buyer, Seller, dates, Order Number, totals)\n//   are printed by a fixed template, but table-layout artifacts merge\n//   unrelated columns onto the same output line in a few specific,\n//   repeatable spots (e.g. the Bill-To address's \"United States\" line\n//   ends up sharing a row with the Buyer value) — handled by anchoring\n//   extraction to the surrounding fixed boilerplate text, not raw\n//   position.\n// - The item table can repeat its column header (\"SKU Description\n//   Quantity...\") more than once when it spans multiple PDF pages\n//   (confirmed real in 30082536) — handled by re-entering table-scan\n//   mode on every occurrence, not just the first.\n// - A SKU can wrap onto a second physical line as a short digit-only\n//   fragment (confirmed real in c51dd720: \"1350811700\" / \"5\" →\n//   \"13508117005\") — handled by a narrow, bounded structural rule (Part\n//   E), never a hardcoded value.\n// - Tax is optional per line (\"Tax1 X.XXXX%\" + a dollar amount) and can\n//   be non-zero (confirmed real in 6c246fda/12fd6860).\n// - Two known non-ingredient row types exist and must be preserved for\n//   reconciliation without ever being treated as purchasable products:\n//   \"Shipping\" rows, and a single \"ALT_PAYMENT_METHODS\" adjustment row\n//   (confirmed real in 6c246fda, negative amount, its own SKU-column\n//   text wraps across 3 short fragments — reconstructing that exact\n//   fragmented text buys nothing, so a fixed canonical label is used\n//   once the row is recognised by its stable \"ALT_PAYME\" lead fragment).\n\n'use strict';\n\nconst { parseDate, parsePrice, cleanDescription } = require('./utils');\n\n// ── Header field extraction ───────────────────────────────────────────\n\nfunction firstMatch(text, re) {\n  const m = text.match(re);\n  return m ? m[1].trim() : null;\n}\n\n// \"Buyer\" the label and its value never sit on the same output line —\n// the Bill-To address block's line count varies relative to the\n// Buyer/Seller block, so by the time both reach the same PDF row, the\n// merge always lands on the Bill-To address's own \"United States\" line\n// (confirmed identical in all 4 real samples). A bare \"United States\"\n// line (the Seller's own address, further down) has nothing after it,\n// so requiring trailing content here is what keeps this from ever\n// matching the Seller's country line instead.\n//\n// FIX (empty-Buyer parity task): the gap between \"United States\" and\n// the value must be horizontal whitespace only ([ \\t]+), never \\s+ —\n// \\s matches newlines too, so when the Buyer field is genuinely blank\n// (nothing after \"United States\" on its own line), \\s+ silently walked\n// forward across the line break and grabbed whatever non-blank text\n// came next (e.g. \"Seller\", or later boilerplate) instead of failing to\n// match. With the gap restricted to the same physical line, a blank\n// field now correctly yields no match at all → buyer stays null, never\n// inferred from Seller/Walmart Business/Group or any other nearby label.\nfunction extractBuyer(text) {\n  return firstMatch(text, /United States[ \\t]+(\\S.+)$/m);\n}\n\nfunction valueAfterLabel(lines, label) {\n  for (let i = 0; i < lines.length - 1; i++) {\n    if (lines[i].trim() === label) return lines[i + 1].trim();\n  }\n  return null;\n}\n\nfunction extractHeader(text, lines) {\n  const documentNumber =\n    firstMatch(text, /Please Reference Invoice\\s+(\\S+)\\s*\\|/i) ||\n    firstMatch(text, /Invoice\\s+(\\S+)\\s+(?:How To Pay|Invoice Summary)/i);\n\n  const invoiceDate = parseDate(valueAfterLabel(lines, 'Invoice Date'));\n  const dueDate     = parseDate(valueAfterLabel(lines, 'Due Date'));\n  const seller      = valueAfterLabel(lines, 'Seller') || 'Walmart Business';\n  const buyer       = extractBuyer(text);\n\n  // \"Order Number PO Number\" is the label row; its value row is two\n  // whitespace-separated tokens (\"-\" means no PO number on this invoice).\n  let walmartOrderNumber = null;\n  let poNumber = null;\n  const labelIdx = lines.findIndex(l => /^Order Number\\s+PO Number$/.test(l.trim()));\n  if (labelIdx > -1 && lines[labelIdx + 1]) {\n    const valueLine = lines[labelIdx + 1].trim();\n    const m = valueLine.match(/^(\\S+)\\s+(\\S+)$/);\n    if (m) {\n      walmartOrderNumber = m[1];\n      poNumber = m[2] === '-' ? null : m[2];\n    } else {\n      walmartOrderNumber = valueLine || null;\n    }\n  }\n\n  const subtotal = parsePrice(firstMatch(text, /Pre-Tax Subtotal\\s+\\$(-?[\\d,.]+)/i));\n  const tax      = parsePrice(firstMatch(text, /Taxes Subtotal\\s+\\$(-?[\\d,.]+)/i));\n  const total    = parsePrice(firstMatch(text, /Total Due as of\\s+[\\d/]+\\s+\\$(-?[\\d,.]+)/i));\n\n  return { documentNumber, invoiceDate, dueDate, seller, buyer, walmartOrderNumber, poNumber, subtotal, tax, total };\n}\n\n// ── Line items ─────────────────────────────────────────────────────────\n\nconst HEADER_ROW_RE   = /^SKU\\s+Description\\s+Quantity/;\nconst SUMMARY_ROW_RE  = /Invoice Summary/;\n// ── MARKER:WALMART_SKU_FRAGMENT_START ──────────────────────────────\n// A wrapped SKU continuation is a line containing ONLY digits, nothing\n// else — real example: \"1350811700\" then, alone on the next physical\n// line, \"5\". Bounded to 1–4 digits (the only real example is 1 digit;\n// this leaves headroom without being loose enough to ever swallow a\n// genuine 5+ digit SKU that starts its own row) and only merges into a\n// row whose own SKU is itself purely numeric (never onto a Shipping/\n// ALT_PAYMENT_METHODS row, whose SKU is text) and only up to a sane\n// total reconstructed length — real UPC/EAN-style codes top out at 13\n// digits, so 14 is used as a hard ceiling.\nconst SKU_FRAGMENT_RE = /^\\d{1,4}$/;\nconst MAX_RECONSTRUCTED_SKU_LEN = 14;\n\nfunction isSkuFragmentContinuation(line, currentItem) {\n  if (!SKU_FRAGMENT_RE.test(line)) return false;\n  if (!currentItem || currentItem.line_type !== 'product') return false;\n  if (!/^\\d+$/.test(currentItem.vendor_sku)) return false;\n  return (currentItem.vendor_sku.length + line.length) <= MAX_RECONSTRUCTED_SKU_LEN;\n}\n// ── MARKER:WALMART_SKU_FRAGMENT_END ────────────────────────────────\n\n// Trailing numeric columns. The optional \"Tax Details\" column only ever\n// contributes its percentage (e.g. \"0.0824%\") to the FIRST continuation\n// line, never to the row-start line itself — confirmed real in\n// 6c246fda/12fd6860: the row-start line only ever contains \"...Tax1\"\n// followed directly by the SAME dollar amount twice (once for the Tax\n// Details column's own dollar sub-total, once for the aggregate Tax\n// column) and then Billed Total. The percentage is picked up separately,\n// from the continuation line, in extractItems() below.\n//\n// Every dollar column captures its sign SEPARATELY from its magnitude\n// (real data prints negative amounts as \"-$21.26\" — minus before the\n// dollar sign, e.g. the ALT_PAYMENT_METHODS adjustment — not \"$-21.26\").\nconst SIGNED_MONEY = '(-?)\\\\$([\\\\d,.]+)';\nconst TAIL_WITH_TAXDETAIL = new RegExp(\n  '^(.*?)\\\\s+(\\\\d+)\\\\s+' + SIGNED_MONEY + '\\\\s+' + SIGNED_MONEY +\n  '\\\\s+Tax1\\\\s+' + SIGNED_MONEY + '\\\\s+' + SIGNED_MONEY + '\\\\s+' + SIGNED_MONEY + '\\\\s*$'\n);\nconst TAIL_PLAIN = new RegExp(\n  '^(.*?)\\\\s+(\\\\d+)\\\\s+' + SIGNED_MONEY + '\\\\s+' + SIGNED_MONEY +\n  '\\\\s+' + SIGNED_MONEY + '\\\\s+' + SIGNED_MONEY + '\\\\s*$'\n);\n\nfunction signedPrice(sign, magnitude) {\n  const n = parsePrice(magnitude);\n  return n === null ? null : (sign === '-' ? -n : n);\n}\n\nfunction parseRowStart(line) {\n  let m = line.match(TAIL_WITH_TAXDETAIL);\n  let hasTaxDetail = false;\n  if (m) {\n    hasTaxDetail = true;\n  } else {\n    m = line.match(TAIL_PLAIN);\n  }\n  if (!m) return null;\n\n  const skuAndDesc = m[1].trim();\n  const qty        = parseInt(m[2], 10);\n  let unitPrice, discount, tax, amount;\n  if (hasTaxDetail) {\n    // groups: 1 desc, 2 qty, 3/4 unit_price, 5/6 discount,\n    // 7/8 tax-detail-dup (unused), 9/10 tax, 11/12 billed_total\n    unitPrice = signedPrice(m[3], m[4]);\n    discount  = signedPrice(m[5], m[6]);\n    tax       = signedPrice(m[9], m[10]);\n    amount    = signedPrice(m[11], m[12]);\n  } else {\n    // groups: 1 desc, 2 qty, 3/4 unit_price, 5/6 discount, 7/8 tax, 9/10 billed_total\n    unitPrice = signedPrice(m[3], m[4]);\n    discount  = signedPrice(m[5], m[6]);\n    tax       = signedPrice(m[7], m[8]);\n    amount    = signedPrice(m[9], m[10]);\n  }\n\n  // Known non-product placeholder rows (same real-template convention as\n  // Shipping/ALT_PAYMENT_METHODS above), confirmed real in invoice\n  // 26104552: an Express Fee (HANDLING) and, appearing multiple times,\n  // a SubDown/FULFILL_VARIANCE fulfillment-substitution charge. Checked\n  // against the FULL skuAndDesc blob, not the generic single-token split\n  // below — unlike \"Shipping\" or \"ALT_PAYME\", their SKU-column\n  // placeholder is itself multi-word (\"Express Fee\"), so splitting on\n  // the first space alone would wrongly cut it as \"Express\" + \"Fee\n  // HANDLING\". Before this fix, neither shape matched any recognised\n  // row-start, so both fell through to continuation handling and were\n  // silently absorbed into the PRECEDING product row's description —\n  // losing $1.93/$10.29/$14.65 as structured line items and corrupting\n  // that product's own description (confirmed against the real PDF).\n  const handlingMatch = skuAndDesc.match(/^(Express\\s+Fee)\\s+(HANDLING)$/i);\n  const fulfillVarianceMatch = skuAndDesc.match(/^(SubDown)\\s+(FULFILL_VARIANCE)$/i);\n\n  let lineType, vendorSku, description;\n  if (handlingMatch) {\n    lineType = 'handling';\n    vendorSku = handlingMatch[1];\n    description = handlingMatch[2];\n  } else if (fulfillVarianceMatch) {\n    lineType = 'fulfillment_variance';\n    vendorSku = fulfillVarianceMatch[1];\n    description = fulfillVarianceMatch[2];\n  } else {\n    const tokenMatch = skuAndDesc.match(/^(\\S+)\\s+(.*)$/);\n    if (!tokenMatch) return null;\n    const leadToken  = tokenMatch[1];\n    const descFirst  = tokenMatch[2].trim();\n\n    lineType = 'product';\n    vendorSku = leadToken;\n    description = descFirst;\n\n    if (/^shipping$/i.test(leadToken)) {\n      lineType = 'shipping';\n    } else if (/^ALT_PAYME/i.test(leadToken)) {\n      // See file header comment: the SKU-column text for this row wraps\n      // across several short fragments across multiple lines; only the\n      // stable lead fragment is used for detection. Reconstructing the\n      // exact wrapped spelling is not attempted — a fixed canonical label\n      // is used instead, since it is always this same placeholder text.\n      lineType = 'adjustment';\n      vendorSku = 'ALT_PAYMENT_METHODS';\n      description = 'Alternative Payment Methods';\n    } else if (!/^\\d{5,}$/.test(leadToken)) {\n      // Not a recognised row-start shape at all (neither a 5+ digit SKU,\n      // Shipping, the adjustment placeholder, nor Handling/Fulfillment\n      // Variance) — reject so the caller falls through to continuation\n      // handling instead of misfiling unrelated text as a new product row.\n      return null;\n    }\n  }\n\n  return {\n    vendor_sku:       vendorSku,\n    raw_description:  description,\n    description:      description,\n    qty_ordered:      qty,\n    qty_received:     qty,\n    qty:              qty,\n    unit_price:       unitPrice,\n    discount:         discount || 0,\n    tax:              tax || 0,\n    tax_rate:         null,\n    amount:           amount,\n    line_total:       amount,\n    line_type:        lineType,\n    warnings:         [],\n    // Adjustment row's SKU-column wrap fragments (\"NT_METHO Methods\",\n    // \"DS\") are swallowed, never appended to description — see file\n    // header comment.\n    _swallowContinuation: lineType === 'adjustment',\n    _descParts: [description],\n  };\n}\n\n// Deterministic pack/weight extraction from the free-text description.\n// Conservative by design — three explicit safety rules:\n//   1. A catch-weight RANGE shape (\"1.50-4.30 lb\" / \"2.75  7.0 lb\",\n//      confirmed real in 26104552 — the gap between the two numbers is a\n//      dash, the unmapped PUA hyphen-like glyph from the normalizer, or\n//      plain whitespace, never more than a few characters) is now\n//      PRESERVED as a visible display string (\"1.50-4.30lb Tray\") — a\n//      real, useful fact for Chef to see, since it's genuinely printed on\n//      the invoice — but is NEVER treated as a real single purchased\n//      weight. Safety is enforced explicitly downstream, not by omitting\n//      the value here: vdrPackToGrams/vdrCalcPack (js/vendor-documents-\n//      review.js) both run an unconditional isWeightRangePack() guard\n//      before any other pattern, so this string can never be converted\n//      to grams by accident — extracting neither endpoint as \"the\"\n//      weight, deliberately different from the single-weight case below.\n//   2. \"Each\"-sold items (Watermelon, Zucchini) are marked as such in\n//      pack_description but NEVER converted to an assumed weight — no\n//      invented average/density. Downstream grams/cost-per-100g stay\n//      unknown for these, by construction (vdrPackToGrams has no \"Each\"\n//      pattern today).\n//   3. Gallon (Milk) is recognised and preserved as a canonical pack\n//      string (\"1gal\") but is NOT converted to grams here — no\n//      production-validated volume→mass density rule exists for Milk\n//      in this codebase; vdrPackToGrams has no plain \"gal\" pattern\n//      either (only mixed-fraction \"N-N/N GAL\"), so this stays inert\n//      by construction too, exactly as intended.\n// Never touches raw_description/description — this only ever adds the\n// separate pack_description field.\nconst WALMART_PACK_RANGE_RE  = /(\\d+(?:\\.\\d+)?)\\D{1,4}(\\d+(?:\\.\\d+)?)\\s*(oz|lb)\\b\\.?\\s*(Tray)?/i;\nconst WALMART_PACK_GAL_RE    = /(\\d+(?:\\.\\d+)?)?\\s*gal(?:lon)?\\b/i;\nconst WALMART_PACK_WEIGHT_RE = /(\\d+(?:\\.\\d+)?)\\s*(oz|lb)\\b/i;\nconst WALMART_PACK_EACH_RE   = /\\beach\\b/i;\n\nfunction extractWalmartPack(description) {\n  if (!description) return null;\n  const rangeMatch = description.match(WALMART_PACK_RANGE_RE);\n  if (rangeMatch) {\n    const [, num1, num2, unit, tray] = rangeMatch;\n    return num1 + '-' + num2 + unit.toLowerCase() + (tray ? ' Tray' : '');\n  }\n  const galMatch = description.match(WALMART_PACK_GAL_RE);\n  if (galMatch) return (galMatch[1] || '1') + 'gal';\n  const weightMatch = description.match(WALMART_PACK_WEIGHT_RE);\n  if (weightMatch) return weightMatch[1] + weightMatch[2].toLowerCase();\n  if (WALMART_PACK_EACH_RE.test(description)) return 'Each';\n  return null;\n}\n\nfunction finalizeItem(item) {\n  if (!item._swallowContinuation && item._descParts.length > 1) {\n    item.raw_description = cleanDescription(item._descParts.join(' '));\n    item.description = item.raw_description;\n  }\n  delete item._descParts;\n  delete item._swallowContinuation;\n  // Pack extraction only for real product rows — Shipping/adjustment/\n  // handling/fulfillment_variance descriptions (\"SHIPPING\", \"Alternative\n  // Payment Methods\", \"HANDLING\", \"FULFILL_VARIANCE\") never match any of\n  // the patterns above anyway, but scoping explicitly to 'product' keeps\n  // intent unambiguous.\n  item.pack_description = item.line_type === 'product' ? extractWalmartPack(item.description) : null;\n  return item;\n}\n\nfunction extractItems(lines) {\n  const items = [];\n  let current = null;\n  let inTable = false;\n\n  for (const rawLine of lines) {\n    const line = rawLine.trim();\n    if (!line) continue;\n\n    if (HEADER_ROW_RE.test(line)) {\n      // Re-entering table mode is safe even if we were already in it\n      // (a document whose table spans multiple PDF pages repeats this\n      // header once per page — confirmed real in 30082536).\n      inTable = true;\n      continue;\n    }\n    if (!inTable) continue;\n    if (SUMMARY_ROW_RE.test(line)) {\n      inTable = false;\n      continue;\n    }\n\n    if (isSkuFragmentContinuation(line, current)) {\n      current.vendor_sku += line;\n      continue;\n    }\n\n    const rowStart = parseRowStart(line);\n    if (rowStart) {\n      if (current) items.push(finalizeItem(current));\n      current = rowStart;\n      continue;\n    }\n\n    // Neither a new row nor a SKU fragment → wrapped description text\n    // continuing the current row (or swallowed, for the adjustment row).\n    if (current && !current._swallowContinuation) {\n      // The optional \"Tax Details\" percentage (e.g. \"0.0824%\") wraps\n      // onto whichever continuation line happens to be first — real\n      // geometry confirmed in 6c246fda/12fd6860. It always sits at the\n      // very end of that line; strip it out before treating the rest\n      // (if any) as further description text, so it never becomes part\n      // of the ingredient description itself.\n      const pctMatch = line.match(/^(.*?)\\s*([\\d.]+)%$/);\n      if (pctMatch && current.tax_rate === null) {\n        // The printed number (e.g. \"0.0824\") already equals the tax rate\n        // as a fraction of 1 (0.0824 = 8.24%) — confirmed by cross-\n        // checking against the real tax dollar amounts (e.g. 6c246fda\n        // row 1: $3.29 / (2 × $19.97) = 0.0824). No further scaling.\n        current.tax_rate = parseFloat(pctMatch[2]);\n        const remainder = pctMatch[1].trim();\n        if (remainder) current._descParts.push(remainder);\n        continue;\n      }\n      current._descParts.push(line);\n    }\n  }\n  if (current) items.push(finalizeItem(current));\n  return items;\n}\n\n// ── Parse a document ───────────────────────────────────────────────────\nfunction parse(rawText) {\n  const text  = String(rawText || '');\n  const lines = text.split('\\n');\n\n  const header = extractHeader(text, lines);\n  const items  = extractItems(lines);\n  const warnings = [];\n\n  if (!items.length) warnings.push({ code: 'PARSE_ERROR', message: 'No line items found' });\n\n  return {\n    vendor:                'Walmart Business',\n    document_type:         'invoice',\n    document_number:       header.documentNumber,\n    invoice_number:        header.documentNumber, // alias — matches sibling invoice parsers' naming\n    invoice_date:          header.invoiceDate,\n    due_date:              header.dueDate,\n    buyer:                 header.buyer,\n    seller:                header.seller,\n    walmart_order_number:  header.walmartOrderNumber,\n    po_number:             header.poNumber,\n    subtotal:              header.subtotal,\n    tax:                   header.tax,\n    total:                 header.total,\n    items,\n    warnings,\n  };\n}\n\nmodule.exports = { parse };\n",
  "index": "// ── vendor-parsers/index.js ───────────────────────────────────\n// Vendor detection and parser routing.\n// Pure functions. No DB, no AI.\n\n'use strict';\n\nconst hardiesOrder      = require('./hardies-order');\nconst hardiesInvoice    = require('./hardies-invoice');\nconst hardiesCredit     = require('./hardies-credit');\nconst freshpointInvoice = require('./freshpoint-invoice');\nconst frugeInvoice      = require('./fruge-invoice');\nconst bekInvoice        = require('./bek-invoice');\nconst walmartTrevipayInvoice = require('./walmart-trevipay-invoice');\n\nconst VENDORS = {\n  // Placed FIRST so it is tried before any other vendor's patterns —\n  // Walmart/TreviPay text also contains the generic word \"Invoice\" many\n  // times, so this must never fall through to a Hardie's-style default.\n  walmart: {\n    patterns: [\n      // Combined-signal (not a single generic token): requires BOTH\n      // \"Walmart Business\" and \"TreviPay\" to appear in the same\n      // document — confirmed present in all 4 real sample invoices.\n      /(?=[\\s\\S]*walmart\\s*business)(?=[\\s\\S]*trevipay)/i,\n      // Fallback combined signal, in case the \"Walmart Business\"\n      // wordmark text is ever missing from the parseable region: still\n      // three independent, unrelated signals together, never \"Invoice\"\n      // alone.\n      /(?=[\\s\\S]*trevipay)(?=[\\s\\S]*\\bBuyer\\b)(?=[\\s\\S]*Invoice Details)/i,\n    ],\n    documents: {\n      invoice: walmartTrevipayInvoice,\n    },\n  },\n  hardies: {\n    patterns: [\n      /dairyland produce/i,\n      /hardie'?s/i,\n      /chefs'?\\s*wh?se/i,\n    ],\n    documents: {\n      order_confirmation: hardiesOrder,\n      invoice:            hardiesInvoice,\n      credit_memo:        hardiesCredit,\n    },\n  },\n  freshpoint: {\n    patterns: [\n      /freshpoint/i,\n      /fresh\\s*point/i,\n    ],\n    documents: {\n      invoice: freshpointInvoice,\n    },\n  },\n  fruge: {\n    patterns: [\n      /fruge/i,\n      /fruge seafood/i,\n      /fruge distributing/i,\n    ],\n    documents: {\n      invoice: frugeInvoice,\n    },\n  },\n  bek: {\n    patterns: [\n      /ben e\\.? keith/i,\n      /ben e keith/i,\n    ],\n    documents: {\n      invoice: bekInvoice,\n    },\n  },\n};\n\n// ── Detect vendor from raw text ───────────────────────────────\nfunction detectVendor(rawText) {\n  const text = rawText || '';\n  for (const [vendorKey, config] of Object.entries(VENDORS)) {\n    if (config.patterns.some(re => re.test(text))) {\n      return vendorKey;\n    }\n  }\n  return 'unknown';\n}\n\n// ── Detect document type from raw text ───────────────────────\nfunction detectDocumentType(rawText) {\n  const text = rawText || '';\n  if (/CONFIRMATION OF SALE/i.test(text))   return 'order_confirmation';\n  if (/\\bCREDIT\\b/i.test(text) && /\\bCREDIT\\s+\\d{5,}/i.test(text)) return 'credit_memo';\n  if (/INVOICE\\/POD/i.test(text))           return 'invoice';\n  if (/\\bINVOICE\\b/i.test(text))            return 'invoice';\n  return 'unknown';\n}\n\n\n// ── Reconciliation check (Quadratura) ────────────────────────\n// Data Priority P1: the document total is the source of truth.\n// If the sum of parsed line amounts does not match the declared\n// subtotal OR total (within tolerance), lines are missing or\n// misread → blocking warning DOC-TOTAL-001.\nconst TOTAL_TOLERANCE = 0.02; // dollars\n\nfunction checkTotals(parsed) {\n  if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) {\n    return parsed; // empty docs are covered by PARSE_ERROR\n  }\n\n  const amounts = parsed.items\n    .map(it => it.amount)\n    .filter(a => a !== null && a !== undefined && !isNaN(parseFloat(a)));\n\n  if (amounts.length === 0) return parsed;\n\n  const sumLines = Math.round(amounts.reduce((s, a) => s + parseFloat(a), 0) * 100) / 100;\n\n  const candidates = [];\n  if (parsed.subtotal !== null && parsed.subtotal !== undefined && !isNaN(parseFloat(parsed.subtotal))) {\n    candidates.push(parseFloat(parsed.subtotal));\n  }\n  if (parsed.total !== null && parsed.total !== undefined && !isNaN(parseFloat(parsed.total))) {\n    candidates.push(parseFloat(parsed.total));\n  }\n\n  if (candidates.length === 0) return parsed;\n\n  const matches = candidates.some(c => Math.abs(c - sumLines) <= TOTAL_TOLERANCE);\n  if (matches) return parsed;\n\n  const declared = candidates[candidates.length - 1];\n  const pct = declared !== 0\n    ? Math.round(Math.abs(sumLines / declared) * 100)\n    : 0;\n\n  parsed.warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];\n  parsed.warnings.push({\n    code:     'DOC-TOTAL-001',\n    severity: 'blocking',\n    message:  `Lines sum $${sumLines.toFixed(2)} but document total is $${declared.toFixed(2)} (${pct}% read) — possible missing lines`,\n    sum_of_lines:   sumLines,\n    declared_total: declared,\n  });\n\n  return parsed;\n}\n\n// ── Parse a document ─────────────────────────────────────────\n// Returns structured VendorDocument or error object\nfunction parse(rawText) {\n  const vendor  = detectVendor(rawText);\n  const docType = detectDocumentType(rawText);\n\n  if (vendor === 'unknown') {\n    return {\n      vendor:        null,\n      document_type: docType,\n      items:         [],\n      warnings: [{\n        code:    'UNKNOWN_VENDOR',\n        message: 'Vendor not recognised from document text',\n      }],\n    };\n  }\n\n  if (docType === 'unknown') {\n    return {\n      vendor,\n      document_type: null,\n      items:         [],\n      warnings: [{\n        code:    'UNKNOWN_DOC_TYPE',\n        message: `Document type not recognised for vendor \"${vendor}\"`,\n      }],\n    };\n  }\n\n  const parser = VENDORS[vendor].documents[docType];\n  if (!parser) {\n    return {\n      vendor,\n      document_type: docType,\n      items:         [],\n      warnings: [{\n        code:    'NO_PARSER',\n        message: `No parser implemented for ${vendor} / ${docType}`,\n      }],\n    };\n  }\n\n  try {\n    const parsed = parser.parse(rawText);\n    return checkTotals(parsed);\n  } catch (err) {\n    return {\n      vendor,\n      document_type: docType,\n      items:         [],\n      warnings: [{\n        code:    'PARSER_ERROR',\n        message: `Parser threw: ${err.message}`,\n      }],\n    };\n  }\n}\n\nmodule.exports = { parse, detectVendor, detectDocumentType, checkTotals };\n"
};

function loadParsers() {
  const require_ = makeCjsLoader(PARSER_SOURCES);
  return require_('index');
}

// ══════════════════════════════════════════════════════════════════
// PDF text extraction — legacy per-line Y/X grouping for every vendor
// except Walmart/TreviPay (ported from js/vendor-documents-review.js's
// vdrProcessAllPdf, same logic already proven server-side verbatim in
// pdf-parity-test-harness), with the TreviPay branch swapped in when
// vdrIsTreviPayDocument() says so — same call-site logic as the client.
// ══════════════════════════════════════════════════════════════════
async function extractPdfText(sb: any, storagePath: string): Promise<{ rawText: string; hadUnknownPua: boolean }> {
  const { data: fileData, error: dlErr } = await sb.storage.from('app').download(storagePath);
  if (dlErr || !fileData) throw new Error('Download failed: ' + (dlErr?.message || 'no file'));
  const arrayBuffer = await fileData.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer), useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;

  const page1Content = await (await pdf.getPage(1)).getTextContent();
  const isTreviPay = vdrIsTreviPayDocument(page1Content.items);

  const pages: string[] = [];
  let hadUnknownPua = false;
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = i === 1 ? page1Content : await (await pdf.getPage(i)).getTextContent();
    if (isTreviPay) {
      const normalized = vdrNormalizeTreviPayPage(content.items as any[]);
      if (normalized.hasUnknownPua) hadUnknownPua = true;
      pages.push(normalized.text);
      continue;
    }
    const lineMap: Record<number, { x: number; text: string }[]> = {};
    for (const item of content.items as any[]) {
      const y = Math.round(item.transform[5]);
      if (!lineMap[y]) lineMap[y] = [];
      lineMap[y].push({ x: item.transform[4], text: item.str });
    }
    const sortedY = Object.keys(lineMap).map(Number).sort((a, b) => b - a);
    pages.push(sortedY.map((y) => lineMap[y].sort((a, b) => a.x - b.x).map((it) => it.text).join(' ')).join('\n'));
  }
  const rawText = pages.join('\n');
  if (!rawText || rawText.trim().length < 30) throw new Error('No text extracted');
  return { rawText, hadUnknownPua };
}

// ══════════════════════════════════════════════════════════════════
// PHASE A — pdf_received → parsed (ported from vdrProcessAllPdf,
// js/vendor-documents-review.js:612-990). Only the PDF-attachment path
// (parsed_json.storage_path) is handled here — the email_html/
// email_body (BEK order_confirmation) path is deliberately skipped;
// see file header. Dedup-by-document_number and the Hardie's/Chef's
// Warehouse order_confirmation↔invoice reconciliation are ported
// unchanged (lines 797-850).
// ══════════════════════════════════════════════════════════════════
const RECONCILE_VENDORS = ["Hardie's Fresh Foods / Dairyland Produce", "Chef's Warehouse"];

async function processOneQueuedDoc(sb: any, doc: any, parsers: any): Promise<{ outcome: string; detail?: string }> {
  const storagePath = doc.parsed_json?.storage_path;
  if (!storagePath) {
    // Not a real PDF attachment (e.g. BEK email_html/email_body) — out
    // of scope for this function, left exactly as-is for the client.
    return { outcome: 'skipped_no_pdf' };
  }

  let rawText: string;
  try {
    const extracted = await extractPdfText(sb, storagePath);
    rawText = extracted.rawText;
  } catch (e: any) {
    await sb.from('vendor_documents').update({ status: 'error', warnings: [{ code: 'MISSING_STORAGE_PATH', message: e.message }] }).eq('id', doc.id);
    return { outcome: 'error', detail: e.message };
  }

  const parsed = parsers.parse(rawText);

  let docNumber = parsed.invoice_number || parsed.order_number || parsed.credit_number || parsed.document_number || null;
  if (!docNumber && doc.source_email_subject) {
    const sm = doc.source_email_subject.match(/#?\s*(\d{6,10})/);
    if (sm) docNumber = sm[1];
  }
  const docDate = parsed.order_date || parsed.credit_date || parsed.delivery_date || parsed.document_date || parsed.invoice_date || null;

  // ── Duplicate check by doc number (ported verbatim) ──
  if (docNumber) {
    const { data: byNum } = await sb.from('vendor_documents').select('id').eq('vendor', parsed.vendor).eq('document_number', docNumber).eq('document_type', parsed.document_type).neq('id', doc.id).limit(1);
    if (byNum && byNum.length > 0) {
      await sb.from('vendor_documents').update({ status: 'error', warnings: [{ code: 'DUPLICATE', message: `Document #${docNumber} already exists` }] }).eq('id', doc.id);
      await sb.storage.from('app').remove([storagePath]);
      return { outcome: 'duplicate' };
    }
  }

  // ── Hardie's/Chef's Warehouse order_confirmation<->invoice reconciliation (ported verbatim) ──
  if (docNumber && RECONCILE_VENDORS.includes(parsed.vendor) && (parsed.document_type === 'order_confirmation' || parsed.document_type === 'invoice')) {
    const counterpartType = parsed.document_type === 'invoice' ? 'order_confirmation' : 'invoice';
    const { data: counterpart } = await sb.from('vendor_documents').select('id,status').eq('vendor', parsed.vendor).eq('document_number', docNumber).eq('document_type', counterpartType).neq('id', doc.id).limit(1);
    if (counterpart && counterpart.length > 0) {
      if (parsed.document_type === 'invoice') {
        const other = counterpart[0];
        if (other.status !== 'imported' && other.status !== 'ignored') {
          await sb.from('vendor_documents').update({ status: 'ignored' }).eq('id', other.id);
        }
      } else {
        await sb.from('vendor_documents').update({ status: 'ignored' }).eq('id', doc.id);
        return { outcome: 'ignored_superseded' };
      }
    }
  }

  const allWarnings = [...(parsed.warnings || []), ...(parsed.items || []).flatMap((i: any) => (i.warnings || []).map((w: any) => ({ ...w, item: i.description })))];

  const walmartBuyerDecision = vdrDecideWalmartBuyer(parsed);
  if (walmartBuyerDecision && walmartBuyerDecision.action === 'ignore') {
    allWarnings.push({ code: 'BUYER-BAR-001', message: `Walmart/TreviPay buyer "${parsed.buyer}" is not a Kitchen buyer — document excluded from the Kitchen pipeline.`, field: 'buyer' });
  } else if (walmartBuyerDecision && walmartBuyerDecision.action === 'review') {
    allWarnings.push({ code: 'BUYER-UNKNOWN-001', message: 'Walmart/TreviPay buyer is missing or not recognized; manual review required.', field: 'buyer' });
  }

  let computedStatus = parsed.items && parsed.items.length > 0 ? 'pending' : 'error';
  if (walmartBuyerDecision && walmartBuyerDecision.action === 'ignore') computedStatus = 'ignored';
  else if (walmartBuyerDecision && walmartBuyerDecision.action === 'review') computedStatus = 'error';

  await sb.from('vendor_documents').update({
    vendor: parsed.vendor || 'unknown',
    document_type: parsed.document_type || 'invoice',
    document_number: docNumber,
    document_date: docDate,
    delivery_date: parsed.delivery_date || null,
    raw_text: rawText,
    parsed_json: { ...(doc.parsed_json || {}), ...parsed },
    status: computedStatus,
    warnings: allWarnings.length ? allWarnings : null,
    updated_at: new Date().toISOString(),
  }).eq('id', doc.id);

  if (allWarnings.length > 0) {
    const warnRows = allWarnings.filter((w: any) => w.code && !['OQR-006'].includes(w.code)).map((w: any) => ({
      document_id: doc.id, vendor: parsed.vendor || 'unknown', document_date: docDate || null, document_number: docNumber || null,
      code: w.code, severity: vdrCodeToSeverityLite(w.code), item_description: w.item || null, field: w.field || null, message: w.message || '', status: 'open',
    }));
    if (warnRows.length > 0) {
      const { error: wErr } = await sb.from('invoice_warnings').insert(warnRows);
      if (wErr) console.warn('[vdai] invoice_warnings insert error:', wErr.message);
    }
  }

  return { outcome: computedStatus === 'pending' ? 'parsed_pending' : computedStatus };
}

function vdrCodeToSeverityLite(code: string): string {
  const blocking = ['INV-PACK-001', 'OQR-008', 'DOC-PARSE-001', 'DOC-VENDOR-001', 'DOC-TYPE-001', 'DOC-NOPARSER-001', 'INV-MATCH-001', 'INV-DUP-001', 'INV-OCR-001', 'PARSE_ERROR', 'UNKNOWN_VENDOR', 'UNKNOWN_DOC_TYPE', 'NO_PARSER', 'PARSER_ERROR', 'DOC-TOTAL-001', 'PROCESS_ERROR', 'PARSE_ERROR_NO_LINES'];
  const insight = ['INV-SUB-001', 'OQR-002', 'INV-PACKCT-001', 'OQR-006', 'INV-PRICE-001', 'INV-UNUSED-001'];
  if (blocking.includes(code)) return 'blocking';
  if (insight.includes(code)) return 'insight';
  return 'alert';
}

// ══════════════════════════════════════════════════════════════════
// PHASE B — preflight (ported from vdrPreflight + the blocking subset
// of vdrBuildQuestions/vdrWarningToQuestion, js/vendor-documents-
// review.js:1701-2018 and 2397-2468). Same two gates, same order:
//  1. any BLOCKING open question → not ok
//  2. any unmatched product line (vendor_item_aliases active, then
//     ingredient_vendors fallback for SKU; ingredient_links confirmed
//     for description) → unmatchedCount>0
// Parsers actually emit only DOC-TOTAL-001 (doc-level) and OQR-002/
// OQR-006/OQR-007 (item-level) today — OQR-001/008/009 are ported too,
// for parser-drift safety, exactly matching the client's branching.
// ══════════════════════════════════════════════════════════════════
function isBlockingWarning(w: any, item: any, knownConversions: Record<string, any>): boolean {
  const code = w.code;
  if (code === 'DOC-TOTAL-001') return true;
  // MICRO-TASK 34 — a recognized invoice (real vendor, real document
  // number) that a parser nonetheless extracted zero line items from.
  // Deliberately NOT grouped with the generic PARSE_ERROR/UNKNOWN_*
  // infoOnly codes right below: those mean the parser couldn't even
  // identify the document (nothing actionable); this means real data
  // exists and something concrete broke, so it must always block.
  if (code === 'PARSE_ERROR_NO_LINES') return true;
  if (['PARSE_ERROR', 'UNKNOWN_VENDOR', 'UNKNOWN_DOC_TYPE', 'NO_PARSER', 'PARSER_ERROR'].includes(code)) return false; // infoOnly
  if (code === 'OQR-001') return true;
  if (code === 'OQR-002') return true;
  if (code === 'OQR-007') return true;
  if (code === 'OQR-009') return true;
  if (code === 'OQR-006') {
    const pack = item ? item.pack_description || '' : '';
    if (item && item.vendor_sku) {
      const known = knownConversions[item.vendor_sku];
      if (known && known.conversion_to_base) return false; // silent — already known
    }
    if (/^\d+\s*(\/\s*\d+\s*)?CT$/i.test(pack.trim())) return false; // pure count — no ambiguity
    if (/^(\d+)-(\d+)\s*CT$/i.test(pack.trim())) return false; // range CT — infoOnly (auto-averaged)
    return true;
  }
  if (code === 'OQR-008') {
    const rawDesc = item ? item.pack_description || item.description || '' : w.item || '';
    if (/(\d+(?:\.\d+)?)#[^\d]/.test(rawDesc)) return false; // auto-resolvable
    if (/(\d+)\/(\d+(?:\.\d+)?)#/.test(rawDesc)) return false; // auto-resolvable
    return true;
  }
  return false; // unknown code — matches vdrWarningToQuestion's `return null` fallback
}

async function hasBlockingQuestion(sb: any, doc: any): Promise<boolean> {
  const pj = doc.parsed_json || {};
  const docWarn: any[] = Array.isArray(doc.warnings) ? doc.warnings : [];
  const items: any[] = pj.items || [];

  // Batch the OQR-006 "known conversion" lookup exactly like vdrLoad's
  // window._vdrKnownConversions preload (js/vendor-documents-review.js:380-407).
  const skus = items.map((i) => i.vendor_sku).filter(Boolean);
  const knownConversions: Record<string, any> = {};
  if (skus.length) {
    const { data: ivRows } = await sb.from('ingredient_vendors').select('vendor_sku, conversion_to_base').in('vendor_sku', [...new Set(skus)]).not('conversion_to_base', 'is', null);
    for (const row of ivRows || []) knownConversions[row.vendor_sku] = { conversion_to_base: row.conversion_to_base };
  }

  for (const w of docWarn) {
    if (w.item) continue; // item-level warnings are read from pj.items[] below, richer context there
    if (isBlockingWarning(w, null, knownConversions)) return true;
  }
  for (const item of items) {
    for (const w of item.warnings || []) {
      if (isBlockingWarning(w, item, knownConversions)) return true;
    }
  }
  return false;
}

async function vdaiPreflight(sb: any, doc: any): Promise<{ ok: boolean; unmatchedCount: number; reason?: string }> {
  if (await hasBlockingQuestion(sb, doc)) return { ok: false, unmatchedCount: 0, reason: 'open_question' };

  const pj = doc.parsed_json || {};
  const vendor = pj.vendor || doc.vendor || '';
  const items: any[] = pj.items || [];
  if (pj.document_type !== 'invoice') return { ok: true, unmatchedCount: 0 };

  const matchableItems = items.filter((i) => !(i.line_type && i.line_type !== 'product'));
  const descs = matchableItems.map((i) => i.description || i.raw_description).filter(Boolean);
  const skus = matchableItems.map((i) => i.vendor_sku || i.item_code).filter(Boolean);

  const [aliasRows, legacyRows] = skus.length
    ? await Promise.all([
        sb.from('vendor_item_aliases').select('vendor_sku').eq('vendor', vendor).eq('active', true).in('vendor_sku', skus),
        sb.from('ingredient_vendors').select('vendor_sku').eq('vendor', vendor).in('vendor_sku', skus),
      ])
    : [{ data: [] }, { data: [] }];
  const matchedSkus = new Set([...(aliasRows.data || []).map((r: any) => r.vendor_sku), ...(legacyRows.data || []).map((r: any) => r.vendor_sku)]);

  const { data: linkRows } = descs.length ? await sb.from('ingredient_links').select('invoice_description').eq('vendor', vendor).eq('confirmed', true).in('invoice_description', descs) : { data: [] };
  const matchedDescs = new Set((linkRows || []).map((r: any) => r.invoice_description));

  const unmatched = matchableItems.filter((item) => {
    const sku = item.vendor_sku || item.item_code;
    const desc = item.description || item.raw_description;
    return !(sku && matchedSkus.has(sku)) && !(desc && matchedDescs.has(desc));
  });

  return { ok: true, unmatchedCount: unmatched.length };
}

// ══════════════════════════════════════════════════════════════════
// PHASE C — write side effects, ported from vdrApprove's invoice-only
// branch (js/vendor-documents-review.js:2531-2920): ingredient_vendors
// price intelligence, invoice_lines, retroactive backfill, economic
// reconciliation, mark imported. No _vdrEdits equivalent exists here
// (no human has edited anything in a background run) — every `edits.*`
// lookup in the source simply falls through to the parsed value, which
// is what omitting docEdits entirely reproduces.
// ══════════════════════════════════════════════════════════════════
function vdrDecideCanonicalUpdateLite(existingSku: string | null, incomingSku: string | null): 'update' | 'populate_sku' | 'skip' {
  if (!existingSku) return 'populate_sku';
  if (existingSku === incomingSku) return 'update';
  return 'skip';
}

async function vdaiBackfillInvoiceLines(sb: any, vendor: string, vendorSku: string, ingredientId: string) {
  if (!sb || !vendor || !vendorSku || !ingredientId) return;
  await sb.from('invoice_lines').update({ ingredient_id: ingredientId, match_status: 'matched' }).eq('vendor', vendor).eq('vendor_sku', vendorSku).is('ingredient_id', null);
}

async function vdaiApprove(sb: any, docId: string): Promise<{ ok: boolean; reason?: string }> {
  const { data: doc, error: fetchErr } = await sb.from('vendor_documents').select('parsed_json,vendor,warnings,status,document_number,document_date').eq('id', docId).single();
  if (fetchErr) return { ok: false, reason: fetchErr.message };

  // Idempotency guard #1 — never re-approve an already-imported doc.
  if (doc.status === 'imported') return { ok: true, reason: 'already_imported' };
  if (doc.status !== 'pending') return { ok: false, reason: 'not_pending' };

  const pj = doc.parsed_json || {};
  if (pj.document_type !== 'invoice') return { ok: false, reason: 'not_invoice' };

  // Walmart Buyer Guard hard write-boundary — re-derived fresh, same as
  // vdrApprove (never trust a stale status for this).
  if (pj.vendor === 'Walmart Business') {
    const buyerDecision = vdrDecideWalmartBuyer(pj);
    if (buyerDecision && buyerDecision.action !== 'accept') return { ok: false, reason: 'buyer_guard_' + buyerDecision.action };
  }

  const pre = await vdaiPreflight(sb, doc);
  if (!pre.ok || pre.unmatchedCount > 0) return { ok: false, reason: pre.reason || 'unmatched' };

  const vendor = pj.vendor || doc.vendor || 'Unknown';
  const invoiceDate = doc.document_date || null;
  const items: any[] = pj.items || [];

  const skus = items.map((i) => i.vendor_sku || i.item_code).filter(Boolean);
  const descs = items.map((i) => i.description || i.raw_description).filter(Boolean);

  const [skuRes, aliasRes, ingrVendorRes, linkRes] = await Promise.all([
    skus.length ? sb.from('ingredient_vendors').select('id,ingredient_id,vendor_sku').eq('vendor', vendor).in('vendor_sku', skus) : { data: [] },
    skus.length ? sb.from('vendor_item_aliases').select('vendor_sku,ingredient_id').eq('vendor', vendor).eq('active', true).in('vendor_sku', skus) : { data: [] },
    sb.from('ingredient_vendors').select('id,ingredient_id,vendor_sku').eq('vendor', vendor),
    descs.length ? sb.from('ingredient_links').select('invoice_description,ingredient_id').eq('vendor', vendor).eq('confirmed', true).in('invoice_description', descs) : { data: [] },
  ]);

  const skuMap: Record<string, any> = {};
  (skuRes.data || []).forEach((r: any) => { skuMap[r.vendor_sku] = r; });
  const identitySkuMap: Record<string, any> = Object.assign({}, skuMap);
  (aliasRes.data || []).forEach((r: any) => { if (r.vendor_sku) identitySkuMap[r.vendor_sku] = { ingredient_id: r.ingredient_id, vendor_sku: r.vendor_sku }; });
  const ingrVendorMap: Record<string, any> = {};
  (ingrVendorRes.data || []).forEach((r: any) => { ingrVendorMap[r.ingredient_id] = { id: r.id, vendor_sku: r.vendor_sku }; });
  const linkMap: Record<string, any> = {};
  (linkRes.data || []).forEach((l: any) => { linkMap[l.invoice_description] = l.ingredient_id; });

  const toUpdate: any[] = [];
  const toInsert: any[] = [];
  const backfillTargets: { vendor: string; vendor_sku: string; ingredient_id: string }[] = [];

  if (pj.document_type === 'invoice') {
    const processedIds = new Set<string>();
    for (const item of items) {
      if (item.line_type && item.line_type !== 'product') continue;
      const sku = item.vendor_sku || item.item_code || null;
      const desc = item.description || item.raw_description || null;
      if (!desc) continue;

      const effectivePack = item.pack_description || null;
      const effectivePrice = item.unit_price != null ? parseFloat(item.unit_price) : null;
      const effectiveExt = item.amount != null ? Math.abs(item.amount) : null;
      const effectiveQty = item.qty_ordered || 1;

      const totalG = item.total_weight_lb
        ? item.total_weight_lb * 453.592
        : item.catchweight && item.actual_weight_lb
        ? item.actual_weight_lb * 453.592
        : vdaiPackToGrams(effectivePack);

      const price = item.cost_per_lb != null ? item.cost_per_lb : effectivePrice != null ? effectivePrice : effectiveExt && effectiveQty ? effectiveExt / effectiveQty : null;

      const per100g = item._cost_per_100g
        ? parseFloat(item._cost_per_100g)
        : item.catchweight && item.price_per_lb
        ? (item.price_per_lb / 453.592) * 100
        : item.cost_per_lb
        ? (item.cost_per_lb / 453.592) * 100
        : totalG && price
        ? (price / totalG) * 100
        : null;

      const priceType = item.price_type || (item.catchweight ? 'per_lb' : 'per_case');
      const convBase = priceType === 'per_lb' ? null : item.conversion_to_base || totalG || null;

      const fields = {
        unit_price: price,
        pack_description: effectivePack,
        price_type: priceType,
        conversion_to_base: convBase ? Math.round(convBase) : null,
        price_per_100g: per100g,
        last_invoice_date: invoiceDate,
      };

      if (sku && skuMap[sku]) {
        const ingrId = skuMap[sku].ingredient_id;
        if (!processedIds.has(ingrId)) {
          processedIds.add(ingrId);
          toUpdate.push({ id: skuMap[sku].id, ...fields });
        }
        continue;
      }

      const linkedId = linkMap[desc];
      if (!linkedId || processedIds.has(linkedId)) continue;
      processedIds.add(linkedId);

      const existingIv = ingrVendorMap[linkedId];
      if (existingIv) {
        const decision = vdrDecideCanonicalUpdateLite(existingIv.vendor_sku, sku);
        if (decision === 'update') toUpdate.push({ id: existingIv.id, ...fields });
        else if (decision === 'populate_sku') {
          toUpdate.push({ id: existingIv.id, vendor_sku: sku, ...fields });
          if (sku) backfillTargets.push({ vendor, vendor_sku: sku, ingredient_id: linkedId });
        }
      } else {
        toInsert.push({ ingredient_id: linkedId, vendor, vendor_sku: sku, active: true, ...fields });
        if (sku) backfillTargets.push({ vendor, vendor_sku: sku, ingredient_id: linkedId });
      }
    }

    if (toUpdate.length) {
      const results = await Promise.all(toUpdate.map((r) => { const { id, ...data } = r; return sb.from('ingredient_vendors').update(data).eq('id', id); }));
      const failed = results.find((r: any) => r.error);
      if (failed) return { ok: false, reason: 'ingredient_vendors update failed: ' + failed.error.message };
    }
    for (const row of toInsert) {
      const { error: insErr } = await sb.from('ingredient_vendors').insert(row);
      if (insErr && insErr.code !== '23505') return { ok: false, reason: 'ingredient_vendors insert failed: ' + insErr.message };
    }
    for (const t of backfillTargets) await vdaiBackfillInvoiceLines(sb, t.vendor, t.vendor_sku, t.ingredient_id);
  }

  // ── invoice_lines — idempotency guard #2: reuse pre-existing lines ──
  const { data: existingLines } = await sb.from('invoice_lines').select('id').eq('import_id', docId).limit(1);
  if (!existingLines || existingLines.length === 0) {
    const invoiceLineRows = items
      .map((item) => {
        const desc = item.description || item.raw_description || null;
        const sku = item.vendor_sku || item.item_code || null;
        const qty = item.catchweight === true ? 1 : item.qty_ordered != null ? item.qty_ordered : item.qty_received != null ? item.qty_received : null;
        const pack = item.pack_description || null;
        const unitPrice = item.unit_price != null ? parseFloat(item.unit_price) : null;
        const lineTotal = item.amount != null ? item.amount : null;

        const totalG = item.total_weight_lb ? item.total_weight_lb * 453.592 : item.catchweight && item.actual_weight_lb ? item.actual_weight_lb * 453.592 : vdaiPackToGrams(pack);
        const per100g = item._cost_per_100g ? parseFloat(item._cost_per_100g) : item.cost_per_lb ? (item.cost_per_lb / 453.592) * 100 : totalG && unitPrice && qty && qty > 0 ? (unitPrice / totalG) * 100 : null;

        const isNonProduct = !!(item.line_type && item.line_type !== 'product');
        const matchedId = isNonProduct ? null : sku && identitySkuMap[sku] ? identitySkuMap[sku].ingredient_id : desc && linkMap[desc] ? linkMap[desc] : null;

        return {
          import_id: docId, invoice_date: invoiceDate, invoice_number: pj.invoice_number || pj.document_number || null, vendor,
          raw_description: desc, vendor_sku: sku, ingredient_id: matchedId, match_status: matchedId ? 'matched' : 'unmatched',
          qty, purchase_unit: 'case', pack_description: pack, unit_price: unitPrice, line_total: lineTotal,
          estimated_total_g: totalG ? Math.round(totalG) : null, cost_per_100g: per100g ? parseFloat(per100g.toFixed(4)) : null,
        };
      })
      .filter((r) => r.raw_description);

    if (invoiceLineRows.length) {
      const { error: ilErr } = await sb.from('invoice_lines').insert(invoiceLineRows);
      if (ilErr) return { ok: false, reason: 'invoice_lines insert failed: ' + ilErr.message };

      if (pj.total != null && !isNaN(parseFloat(pj.total))) {
        const RECONCILIATION_TOLERANCE = 0.02;
        const sumLineTotals = Math.round(invoiceLineRows.reduce((s, r) => s + (r.line_total || 0), 0) * 100) / 100;
        const declaredTotal = parseFloat(pj.total);
        if (Math.abs(sumLineTotals - declaredTotal) > RECONCILIATION_TOLERANCE) {
          return { ok: false, reason: `reconciliation failed: lines sum $${sumLineTotals.toFixed(2)} vs document total $${declaredTotal.toFixed(2)}` };
        }
      }
    } else {
      return { ok: false, reason: 'no invoice lines extractable' };
    }
  }

  // Idempotency guard #3 — the atomic conditional update. If another
  // concurrent run already flipped this row (status no longer
  // 'pending'), this matches zero rows and .data comes back empty — the
  // caller can tell the difference from a real DB error.
  const { data: updRows, error: updErr } = await sb.from('vendor_documents').update({ status: 'imported', updated_at: new Date().toISOString() }).eq('id', docId).eq('status', 'pending').select('id');
  if (updErr) return { ok: false, reason: updErr.message };
  if (!updRows || updRows.length === 0) return { ok: false, reason: 'lost race — another run already updated this document' };

  return { ok: true };
}

function vdaiPackToGrams(packStr: string | null): number | null {
  if (!packStr) return null;
  const s = String(packStr).trim().toUpperCase();
  const UNIT_TO_G: Record<string, number> = { LB: 453.592, LBS: 453.592, '#': 453.592, OZ: 28.3495, GAL: 3785.41, ML: 1, L: 1000, KG: 1000, G: 1 };
  let m = s.match(/^(\d+)\s*\/\s*(\d+(?:\.\d+)?)\s*(LB|LBS|#|OZ|GAL|ML|L|KG|G)\s*$/);
  if (m) return parseFloat(m[1]) * parseFloat(m[2]) * (UNIT_TO_G[m[3]] || 0);
  m = s.match(/^(\d+(?:\.\d+)?)\s*(LB|LBS|#|OZ|GAL|KG|G|ML|L)\s*$/);
  if (m) return parseFloat(m[1]) * (UNIT_TO_G[m[2]] || 0);
  return null;
}

// ══════════════════════════════════════════════════════════════════
// Orchestration
// ══════════════════════════════════════════════════════════════════
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const started = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const dryRun: boolean = !!body.dry_run;
    const documentId: string | null = body.document_id || null;

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const parsers = loadParsers();

    const result = { phaseA: [] as any[], phaseB: [] as any[], dry_run: dryRun };

    // ── PHASE A: pdf_received → parsed ──
    let qA = sb.from('vendor_documents').select('id,parsed_json,source_email_subject,raw_text,vendor,status');
    qA = documentId ? qA.eq('id', documentId).eq('status', 'pdf_received') : qA.eq('status', 'pdf_received');
    const { data: queueA } = await qA.order('created_at', { ascending: true }).limit(documentId ? 1 : 25);
    for (const doc of queueA || []) {
      if (dryRun) { result.phaseA.push({ id: doc.id, would_process: !!doc.parsed_json?.storage_path }); continue; }
      try {
        const r = await processOneQueuedDoc(sb, doc, parsers);
        result.phaseA.push({ id: doc.id, ...r });
      } catch (e: any) {
        await sb.from('vendor_documents').update({ status: 'error', warnings: [{ code: 'PROCESS_ERROR', message: e.message }] }).eq('id', doc.id);
        result.phaseA.push({ id: doc.id, outcome: 'error', detail: e.message });
      }
    }

    // ── PHASE B: pending invoice → preflight → approve if clean ──
    let qB = sb.from('vendor_documents').select('id,parsed_json,vendor,warnings,status,document_number,document_date').eq('status', 'pending').eq('document_type', 'invoice');
    qB = documentId ? qB.eq('id', documentId) : qB;
    const { data: queueB } = await qB.order('created_at', { ascending: true }).limit(documentId ? 1 : 25);
    for (const doc of queueB || []) {
      if (dryRun) {
        const pre = await vdaiPreflight(sb, doc);
        result.phaseB.push({ id: doc.id, document_number: doc.document_number, would_import: pre.ok && pre.unmatchedCount === 0, preflight: pre });
        continue;
      }
      const pre = await vdaiPreflight(sb, doc);
      if (pre.ok && pre.unmatchedCount === 0) {
        const approveResult = await vdaiApprove(sb, doc.id);
        result.phaseB.push({ id: doc.id, document_number: doc.document_number, outcome: approveResult.ok ? 'imported' : 'approve_failed', reason: approveResult.reason });
      } else {
        result.phaseB.push({ id: doc.id, document_number: doc.document_number, outcome: 'left_pending', reason: pre.reason || 'unmatched', unmatchedCount: pre.unmatchedCount });
      }
    }

    return json({ ok: true, ms: Date.now() - started, ...result });
  } catch (err: any) {
    console.error('vendor-doc-auto-import error:', err);
    return json({ ok: false, error: String((err && err.stack) || err) }, 500);
  }
});
