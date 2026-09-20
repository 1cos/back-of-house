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
  "utils": "// \u2500\u2500 vendor-parsers/utils.js \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Shared utilities for all vendor parsers.\n// Pure functions only \u2014 no DB, no AI, no side effects.\n\n'use strict';\n\n// \u2500\u2500 Date parsing \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Accepts MM/DD/YY, MM/DD/YYYY, YYYY-MM-DD \u2192 'YYYY-MM-DD' or null\nfunction parseDate(str) {\n  if (!str) return null;\n  str = String(str).trim();\n  // Already ISO\n  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(str)) return str;\n  // MM/DD/YY or MM/DD/YYYY\n  const m = str.match(/^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{2,4})$/);\n  if (m) {\n    let year = parseInt(m[3]);\n    if (year < 100) year += 2000;\n    const mo = String(parseInt(m[1])).padStart(2,'0');\n    const da = String(parseInt(m[2])).padStart(2,'0');\n    return `${year}-${mo}-${da}`;\n  }\n  return null;\n}\n\n// \u2500\u2500 Price parsing \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Handles \"$1,234.56\", \"1234.56\", \"-49.92\", \"$.00\"\nfunction parsePrice(str) {\n  if (str === null || str === undefined) return null;\n  const cleaned = String(str).replace(/[$,\\s]/g, '');\n  const n = parseFloat(cleaned);\n  return isNaN(n) ? null : n;\n}\n\n// \u2500\u2500 Pack size parsing \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Returns { count, sizeEach, unit, raw } or null\n// Examples: \"25#\" \u2192 {count:1,sizeEach:25,unit:'lb'}\n//           \"12/3 CT\" \u2192 {count:12,sizeEach:3,unit:'ct'}\n//           \"1pc / 28#\" \u2192 {count:1,sizeEach:28,unit:'lb'}\n//           \"11/1#\" \u2192 {count:11,sizeEach:1,unit:'lb'}\n//           \"8/12 OZ\" \u2192 {count:8,sizeEach:12,unit:'oz'}\n//           \"110 CT\" \u2192 {count:1,sizeEach:110,unit:'ct'}\n//           \"6 CT\" \u2192 {count:1,sizeEach:6,unit:'ct'}\n//           \"16-22 CT\" \u2192 {count:1,sizeEach:16,unit:'ct',sizeMax:22}\nfunction parsePackSize(str) {\n  if (!str) return null;\n  const raw = str;\n  // Normalise # \u2192 lb\n  let s = String(str).trim().replace(/#/g, 'lb').toUpperCase();\n\n  let m;\n\n  // \"Npc / Nunit\" or \"Nea / Nunit\" \u2014 e.g. \"1pc / 28lb\", \"1PC/28LB\"\n  m = s.match(/^(\\d+)\\s*(?:PC|PCS|EA|EACH)\\s*\\/\\s*([\\d.]+)\\s*([A-Z]+)/i);\n  if (m) return { count: parseFloat(m[1]), sizeEach: parseFloat(m[2]), unit: m[3].toLowerCase(), raw };\n\n  // \u2500\u2500 FreshPoint: \"N/N.Nunit N/N.Nunit BOX|BX|CS|BG\" \u2014 weight repeated twice \u2500\u2500\n  // e.g. \"2/1.5LB 2/1.5LB BOX\" \u2014 take first occurrence only\n  m = s.match(/^(\\d+)\\s*\\/\\s*([\\d.]+)\\s*([A-Z]+)\\s+\\1\\s*\\/\\s*\\2\\s*\\3\\s+(?:BOX|BX|CS|BG|BAG)$/);\n  if (m) return { count: parseFloat(m[1]), sizeEach: parseFloat(m[2]), unit: m[3].toLowerCase(), raw };\n\n  // \u2500\u2500 FreshPoint: \"N.Nunit N.Nunit BOX|BX|CS|BG\" \u2014 weight repeated twice \u2500\u2500\n  // e.g. \"4LB 4LB BX\", \"11LB 11LB BX\", \"1LB 1LB BG\"\n  m = s.match(/^([\\d.]+)\\s*([A-Z]+)\\s+\\1\\s*\\2\\s+(?:BOX|BX|CS|BG|BAG)$/);\n  if (m) return { count: 1, sizeEach: parseFloat(m[1]), unit: m[2].toLowerCase(), raw };\n\n  // \u2500\u2500 FreshPoint: \"N/N unit BOX|BX|CS|BG\" \u2014 slash-count with container suffix \u2500\u2500\n  // e.g. \"3/2LB CS\", \"2/1.5LB BOX\"\n  m = s.match(/^(\\d+)\\s*\\/\\s*([\\d.]+)\\s*([A-Z]+)\\s+(?:BOX|BX|CS|BG|BAG)$/);\n  if (m) return { count: parseFloat(m[1]), sizeEach: parseFloat(m[2]), unit: m[3].toLowerCase(), raw };\n\n  // \u2500\u2500 FreshPoint: \"N.Nunit BOX|BX|CS|BG\" \u2014 single weight with container suffix \u2500\u2500\n  // e.g. \"5LB BX\", \"50LB BX\"\n  m = s.match(/^([\\d.]+)\\s*([A-Z]+)\\s+(?:BOX|BX|CS|BG|BAG)$/);\n  if (m) return { count: 1, sizeEach: parseFloat(m[1]), unit: m[2].toLowerCase(), raw };\n\n  // \u2500\u2500 FreshPoint: \"...NCT 15LB BX\" \u2014 weight buried at end before container \u2500\u2500\n  m = s.match(/^.*?([\\d.]+)\\s*(LB|OZ|KG|G)\\s+(?:BOX|BX|CS|BG|BAG)$/);\n  if (m) return { count: 1, sizeEach: parseFloat(m[1]), unit: m[2].toLowerCase(), raw };\n\n  // \u2500\u2500 FreshPoint: \"N CT BOX|BX\" \u2014 count-only with container \u2500\u2500\n  m = s.match(/^([\\d.]+)\\s*CT\\s+(?:BOX|BX|CS|BG|BAG)$/);\n  if (m) return { count: 1, sizeEach: parseFloat(m[1]), unit: 'ct', raw };\n\n  // \"N/N unit\" \u2014 e.g. \"12/3 CT\", \"11/1lb\", \"8/12 OZ\"\n  m = s.match(/^(\\d+)\\s*\\/\\s*([\\d.]+)\\s*([A-Z]+)/);\n  if (m) return { count: parseFloat(m[1]), sizeEach: parseFloat(m[2]), unit: m[3].toLowerCase(), raw };\n\n  // \"N-N unit\" \u2014 range like \"16-22 CT\" \u2192 use min\n  m = s.match(/^(\\d+)-(\\d+)\\s*([A-Z]+)/);\n  if (m) return { count: 1, sizeEach: parseFloat(m[1]), sizeMax: parseFloat(m[2]), unit: m[3].toLowerCase(), raw };\n\n  // \"N unit\" \u2014 e.g. \"25lb\", \"110 CT\", \"50 CT\", \"1 CT\"\n  m = s.match(/^([\\d.]+)\\s*([A-Z]+)$/);\n  if (m) return { count: 1, sizeEach: parseFloat(m[1]), unit: m[2].toLowerCase(), raw };\n\n  return null;\n}\n\n// \u2500\u2500 Convert pack to grams \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nconst UNIT_TO_G = {\n  lb: 453.592, lbs: 453.592, oz: 28.3495,\n  kg: 1000, g: 1,\n  gal: 3785.41, l: 1000, ltr: 1000, ml: 1,\n  qt: 946.353, pt: 473.176,\n};\n\nfunction packToGrams(pack) {\n  if (!pack) return null;\n  const f = UNIT_TO_G[pack.unit];\n  if (!f) return null; // ct, ea \u2014 no weight conversion\n  return pack.count * pack.sizeEach * f;\n}\n\n// \u2500\u2500 Clean description \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Remove origin tags, whitespace normalisation, preserve content\nfunction cleanDescription(str) {\n  if (!str) return '';\n  return str\n    .replace(/\\bUSA\\b/gi, '')\n    .replace(/\\s+/g, ' ')\n    .trim();\n}\n\n// \u2500\u2500 Line skip heuristics \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Returns true if line is a header, footer, or non-item line\nfunction isSkipLine(line) {\n  if (!line || line.trim().length < 3) return true;\n\n  const l = line.trim().toUpperCase();\n\n  const skipPrefixes = [\n    'QUANTITY', 'ORDERED', 'SHIPPED', 'ITEM CODE', 'DESCRIPTION',\n    'PACK', 'UNIT PRICE', 'EXTENDED', 'AMOUNT', 'ADJ', 'COOL',\n    'TERMS', 'SUBTOTAL', 'TAX', 'TOTAL', 'INVOICE', 'PAGE',\n    'ROUTE', 'CUSTOMER', 'BILL TO', 'SHIP TO', 'REMIT',\n    'PHONE', 'FAX', 'EMAIL', 'ORDER TAKER', 'ORDER DATE',\n    'DRIVER', 'SALESPERSON', 'INTEREST', 'PERISHABLE',\n    'COMMODITY', 'PACA', 'ADJUST', 'CREDIT CARD', 'SURCHARGE',\n    'WE WANT', 'HARDIE', 'DAIRYLAND', 'PROOF', 'DELIVERY WINDOW',\n    'DATE/TRIP', 'CUSTOMER CODE', 'REPACKS', 'FULL CASES',\n    'WEIGHT', 'TOTAL PCS', 'NOTES', 'CREDIT CODES', 'RETURN REASON'\n  ];\n\n  return skipPrefixes.some(prefix => l.startsWith(prefix));\n}\n\n// \u2500\u2500 Detect substitution marker \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nfunction isSubstitutionLine(line) {\n  return /SUBSTITUTION/i.test(line);\n}\n\n// \u2500\u2500 Extract document number \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// From lines like \"INVOICE/POD 06991299\" or \"CREDIT 00668419\"\nfunction extractDocNumber(lines, keywords) {\n  for (const line of lines) {\n    for (const kw of keywords) {\n      const re = new RegExp(kw + '\\\\s*[/#]?\\\\s*(\\\\d{5,10})', 'i');\n      const m = line.match(re);\n      if (m) return m[1];\n    }\n  }\n  return null;\n}\n\n// \u2500\u2500 Extract date from lines \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nfunction extractDocDate(lines, keywords) {\n  for (const line of lines) {\n    for (const kw of keywords) {\n      const re = new RegExp(kw + '[\\\\s:/]*([\\\\d]{1,2}/[\\\\d]{1,2}/[\\\\d]{2,4})', 'i');\n      const m = line.match(re);\n      if (m) return parseDate(m[1]);\n    }\n  }\n  return null;\n}\n\nconst API = {\n  parseDate, parsePrice, parsePackSize, packToGrams,\n  cleanDescription, isSkipLine, isSubstitutionLine,\n  extractDocNumber, extractDocDate,\n};\n\n// MICRO-TASK 89A \u2014 esposizione tripla, come bek-post-parse-safety.js e\n// price-intelligence-merge.js: require() per i test Node e per il loader\n// CJS del worker, window.* per il browser. Serve perche' la decisione\n// condivisa sulla price intelligence deve poter leggere il numero di\n// pezzi per cassa con parsePackSize, la sola grammatica di pack del\n// repository, invece di riscriverne una parallela.\n// Additivo: module.exports resta identico, nessun parser cambia.\nif (typeof module !== 'undefined' && module.exports) module.exports = API;\nif (typeof window !== 'undefined') window.VendorParserUtils = API;\n",
  "hardies-order": "// \u2500\u2500 vendor-parsers/hardies-order.js \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Parser for Hardie's / Dairyland Produce CONFIRMATION OF SALE\n// Document type: order_confirmation\n// No AI. No OCR. Pure deterministic text parsing.\n//\n// Real format (from 06991299):\n// QUANTITY  ITEM CODE  DESCRIPTION           PACK     COOL  UNIT PRICE  EXTENDED AMOUNT\n// 1         70116      BRUSSEL SPROUTS MEDIUM 25#            47.92       47.92\n// 1         13544      RWPR 103 RIB REF       1pc / 28# USA 29.05       871.50\n\n'use strict';\n\nconst {\n  parseDate, parsePrice, parsePackSize, cleanDescription,\n  isSkipLine, isSubstitutionLine, extractDocNumber, extractDocDate,\n} = require('./utils');\n\n// Hardie's line item regex\n// Columns: QTY  ITEM_CODE  DESCRIPTION...  PACK  [COOL]  UNIT_PRICE  AMOUNT\n// Item code is always 5 digits. Prices are NN.NN at end of line.\n// PACK can be complex: \"25#\", \"12/3 CT\", \"1pc / 28#\", \"11/1#\", \"8/12 OZ\"\nconst LINE_RE = /^(\\d+)\\s+(\\d{5})\\s+(.+?)\\s{2,}(.+?)\\s{1,}(?:(USA|MEX|CAN|CHI|PER|COL|GUA|EC|NL)\\s+)?([\\d,.]+)\\s+([\\d,.]+)$/;\n\n// Simpler fallback: qty + item_code + rest (when spacing is irregular)\nconst LINE_RE2 = /^(\\d+)\\s+(\\d{5})\\s+(.{8,})$/;\n\nfunction parse(rawText) {\n  const warnings = [];\n  const lines = rawText.split('\\n').map(l => l.trim());\n\n  // \u2500\u2500 Header fields \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n  const docNumber = extractDocNumber(lines, ['INVOICE', 'CONFIRMATION']) || null;\n  const orderDate  = extractDocDate(lines, ['DATE', 'ORDER DATE'])  || null;\n\n  // Delivery date: not always explicit on order confirmation\n  // Try \"DATE/TRIP\" field from invoice format\n  let deliveryDate = null;\n  for (const line of lines) {\n    const m = line.match(/DATE\\/TRIP\\s+([\\d\\/]+)/i);\n    if (m) { deliveryDate = parseDate(m[1]); break; }\n  }\n\n  // Totals\n  let subtotal = null, tax = null, total = null;\n  for (const line of lines) {\n    let m;\n    m = line.match(/SUBTOTAL\\s+([\\d,]+\\.?\\d*)/i);\n    if (m) subtotal = parsePrice(m[1]);\n    m = line.match(/^TAX(?:\\/PCT\\.?)?\\s+\\$([\\d,.]+)/i);\n    if (m) tax = parsePrice(m[1]);\n    m = line.match(/INVOICE\\s+\\$([\\d,]+\\.?\\d*)/i);\n    if (m && !total) total = parsePrice(m[1]);\n    m = line.match(/TOTAL\\s+\\$([\\d,]+\\.?\\d*)/i);\n    if (m && !total) total = parsePrice(m[1]);\n  }\n\n  // \u2500\u2500 Item lines \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n  const items = [];\n  let nextIsSubstitution = false;\n  let prevSku = null;\n\n  for (const line of lines) {\n    if (isSkipLine(line)) continue;\n\n    if (isSubstitutionLine(line)) {\n      nextIsSubstitution = true;\n      continue;\n    }\n\n    // Try full regex first\n    let m = line.match(LINE_RE);\n    if (m) {\n      const [, qtyStr, sku, descRaw, packRaw, origin, unitPriceStr, amountStr] = m;\n      const qty       = parseFloat(qtyStr);\n      const unitPrice = parsePrice(unitPriceStr);\n      const amount    = parsePrice(amountStr);\n      const pack      = parsePackSize(packRaw.trim());\n      const desc      = cleanDescription(descRaw.trim());\n\n      const item = {\n        vendor_sku:      sku,\n        raw_description: descRaw.trim(),\n        description:     desc,\n        qty_ordered:     qty,\n        qty_received:    null,\n        purchase_unit:   inferPurchaseUnit(pack),\n        pack_description:packRaw.trim(),\n        pack_qty:        pack ? pack.count    : null,\n        pack_unit:       pack ? pack.unit     : null,\n        pack_size_each:  pack ? pack.sizeEach : null,\n        unit_price:      unitPrice,\n        amount:          amount,\n        is_substitution: nextIsSubstitution,\n        substituted_sku: nextIsSubstitution ? prevSku : null,\n        origin:          origin || null,\n        cool_flag:       false,\n        warnings:        [],\n      };\n\n      // OQR-003: Price sanity (can't compare without order yet \u2014 deferred to OQR engine)\n      // OQR-006: Count-based products\n      if (pack && ['ct','ea','each'].includes(pack.unit)) {\n        item.warnings.push({\n          code:    'OQR-006',\n          message: `Count-based item: ${desc} (${packRaw.trim()}) \u2014 no weight for costing`,\n          field:   'pack_unit',\n        });\n      }\n\n      // OQR-008: Item with unusual SKU pattern or description\n      if (/^[A-Z]{2,4}\\d+/.test(sku) && !/^\\d+$/.test(sku)) {\n        item.warnings.push({\n          code:    'OQR-008',\n          message: `Unusual SKU pattern: ${sku} \u2014 verify ingredient match`,\n          field:   'vendor_sku',\n        });\n      }\n\n      if (nextIsSubstitution) {\n        item.warnings.push({\n          code:    'OQR-002',\n          message: `Substitution: received ${desc} instead of original item`,\n          field:   'is_substitution',\n        });\n        nextIsSubstitution = false;\n      }\n\n      items.push(item);\n      prevSku = sku;\n      continue;\n    }\n\n    // Fallback: line starts with digit + 5-digit code but irregular spacing\n    m = line.match(LINE_RE2);\n    if (m) {\n      const [, qtyStr, sku, rest] = m;\n      // Extract prices from end of rest: two numbers like \"47.92 47.92\"\n      const priceMatch = rest.match(/([\\d,]+\\.\\d{2})\\s+([\\d,]+\\.\\d{2})$/);\n      if (priceMatch) {\n        const rawDesc    = rest.slice(0, rest.lastIndexOf(priceMatch[0])).trim();\n        // Try to split description from pack: pack is usually last token before prices\n        const parts      = rawDesc.split(/\\s{2,}/);\n        const packRaw    = parts.length > 1 ? parts[parts.length-1] : '';\n        const descRaw    = parts.length > 1 ? parts.slice(0,-1).join(' ') : rawDesc;\n        const pack       = parsePackSize(packRaw);\n        const desc       = cleanDescription(descRaw);\n\n        items.push({\n          vendor_sku:      sku,\n          raw_description: rawDesc.trim(),\n          description:     desc,\n          qty_ordered:     parseFloat(qtyStr),\n          qty_received:    null,\n          purchase_unit:   inferPurchaseUnit(pack),\n          pack_description:packRaw.trim(),\n          pack_qty:        pack ? pack.count : null,\n          pack_unit:       pack ? pack.unit  : null,\n          unit_price:      parsePrice(priceMatch[1]),\n          amount:          parsePrice(priceMatch[2]),\n          is_substitution: nextIsSubstitution,\n          substituted_sku: nextIsSubstitution ? prevSku : null,\n          origin:          null,\n          cool_flag:       false,\n          warnings:        nextIsSubstitution ? [{\n            code:'OQR-002', message:`Substitution: received ${desc}`, field:'is_substitution'\n          }] : [],\n        });\n        if (nextIsSubstitution) nextIsSubstitution = false;\n        prevSku = sku;\n      }\n    }\n  }\n\n  if (!items.length) {\n    warnings.push({\n      code:    'PARSE_ERROR',\n      message: 'No line items found \u2014 document format may have changed',\n    });\n  }\n\n  return {\n    vendor:          \"Hardie's Fresh Foods / Dairyland Produce\",\n    document_type:   'order_confirmation',\n    order_number:    docNumber,\n    order_date:      orderDate,\n    delivery_date:   deliveryDate,\n    subtotal,\n    tax,\n    total,\n    items,\n    warnings,\n  };\n}\n\n// Infer purchase unit from pack structure\nfunction inferPurchaseUnit(pack) {\n  if (!pack) return null;\n  const u = pack.unit;\n  if (['ct','ea','each'].includes(u)) return 'each';\n  if (['lb','lbs'].includes(u))       return 'lb';\n  if (u === 'oz')                     return 'oz';\n  if (['gal','l','ml'].includes(u))   return u;\n  return u || null;\n}\n\nmodule.exports = { parse };\n",
  "hardies-invoice": "// \u2500\u2500 vendor-parsers/hardies-invoice.js \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Parser for Hardie's / Dairyland Produce INVOICE/POD\n// Document type: invoice\n//\n// Substitution logic (real PDF layout):\n//   WATERMELON SEEDLESS  ordered:1  shipped:0   \u2190 not delivered\n//   WATERMELON LOCAL     ordered:0  shipped:1   \u2190 substitution (ordered=0, shipped>0)\n//   SUBSTITUTION                                \u2190 marker: applies to PREVIOUS item\n//   SPINACH BABY         ordered:2  shipped:2   \u2190 normal item, NOT substitution\n//\n// Rule: SUBSTITUTION marker retroactively applies to the last parsed item.\n// Additionally: ordered=0, shipped>0 pattern is always a substitution.\n\n'use strict';\n\nconst {\n  parseDate, parsePrice, parsePackSize, cleanDescription,\n  isSkipLine, isSubstitutionLine, extractDocNumber, extractDocDate,\n} = require('./utils');\n\nconst LINE_RE  = /^(\\d+)\\s+(\\d+)\\s+(\\d{5})\\s+(.+?)\\s{2,}(.+?)\\s{1,}([\\d,.]+)\\s+([\\d,.]+)(?:\\s+.*)?$/;\nconst LINE_RE2 = /^(\\d+)\\s+(\\d+)\\s+(\\d{5})\\s+(.{8,})$/;\n\nfunction buildItem(sku, descRaw, packRaw, ord, shp, unitPrice, amount, prevSku) {\n  const pack = parsePackSize(packRaw.trim());\n  const desc = cleanDescription(descRaw.trim());\n  const lw   = [];\n  const isSub = (ord === 0 && shp > 0);\n\n  if (ord !== shp) lw.push({\n    code:    'OQR-007',\n    message: `Qty mismatch: ordered ${ord}, shipped ${shp} of ${desc}`,\n    field:   'qty_received',\n    possible_reasons: ['Short shipped','Back ordered','Vendor error','Substitution'],\n  });\n\n  if (isSub) lw.push({\n    code:    'OQR-002',\n    message: `Substitution: ordered 0, received ${shp} of ${desc}`,\n    field:   'is_substitution',\n  });\n\n  if (pack && ['ct','ea','each','dz','doz'].includes(pack.unit)) lw.push({\n    code:    'OQR-006',\n    message: `Count-based: ${desc} (${packRaw.trim()}) \u2014 no weight for costing`,\n    field:   'pack_unit',\n  });\n\n  // \u2500\u2500 Catchweight detection (meat sold by the pound) \u2500\u2500\n  // Pattern: pack like \"1pc / 28#\" (nominal weight) + unit_price is PER POUND,\n  // line amount = actual weight \u00d7 price/lb. Hardie's prints \"Total weight: N\"\n  // but the exact math is amount \u00f7 unit_price = actual pounds.\n  // Detection: amount \u2260 unit_price (so not a flat case price) AND the implied\n  // weight is within 50% of the nominal pack weight.\n  let catchweight = false, priceLb = null, actualLb = null;\n  if (pack && pack.unit === 'lb' && unitPrice > 0 && amount > 0\n      && Math.abs(amount - unitPrice) > 0.02) {\n    const impliedLb = amount / unitPrice;\n    const nominalLb = pack.count * pack.sizeEach;\n    if (nominalLb > 0 && impliedLb >= nominalLb * 0.5 && impliedLb <= nominalLb * 1.5) {\n      catchweight = true;\n      priceLb  = unitPrice;\n      actualLb = Math.round(impliedLb * 100) / 100;\n    }\n  }\n\n  return {\n    vendor_sku:       sku,\n    raw_description:  descRaw.trim(),\n    description:      desc,\n    qty_ordered:      ord,\n    qty_received:     shp,\n    purchase_unit:    inferPurchaseUnit(pack),\n    pack_description: packRaw.trim(),\n    pack_qty:         pack ? pack.count     : null,\n    pack_unit:        pack ? pack.unit      : null,\n    pack_size_each:   pack ? pack.sizeEach  : null,\n    catchweight:      catchweight,\n    price_per_lb:     priceLb,\n    actual_weight_lb: actualLb,\n    unit_price:       unitPrice,\n    amount:           amount,\n    is_substitution:  isSub,\n    substituted_sku:  isSub ? prevSku : null,\n    origin:           null,\n    cool_flag:        false,\n    warnings:         lw,\n  };\n}\n\nfunction parse(rawText) {\n  const warnings = [];\n  // OCR sometimes glues the first item onto the table header line:\n  // \"QUANTITY ITEM CODE ... SHIPPED AMOUNT 1 1 13544 RWPR ...\"\n  // isSkipLine would drop the whole line (starts with QUANTITY) \u2014 losing the item.\n  // Inject a newline after the header keywords when item data follows.\n  rawText = String(rawText || '').replace(/(SHIPPED\\s+AMOUNT)[ \\t]+(?=\\d)/g, '$1\\n');\n  const lines = rawText.split('\\n').map(l => l.trim());\n\n  const docNumber    = extractDocNumber(lines, ['INVOICE/POD', 'INVOICE']) || null;\n  const orderDate    = extractDocDate(lines, ['DATE/TRIP', 'ORDER DATE', 'DATE']) || null;\n  let   deliveryDate = null;\n  for (const l of lines) {\n    const m = l.match(/DATE\\/TRIP\\s+([\\d\\/]+)/i);\n    if (m) { deliveryDate = parseDate(m[1]); break; }\n  }\n\n  let subtotal = null, tax = null, total = null;\n  for (const l of lines) {\n    let m;\n    m = l.match(/SUBTOTAL\\s+([\\d,]+\\.?\\d*)/i);      if (m) subtotal = parsePrice(m[1]);\n    m = l.match(/TAX\\/PCT\\.?\\s+\\$([\\d,.]+)/i);       if (m) tax      = parsePrice(m[1]);\n    m = l.match(/INVOICE\\s+\\$([\\d,]+\\.?\\d*)/i);      if (m && !total) total = parsePrice(m[1]);\n  }\n\n  const items  = [];\n  let prevSku  = null;\n\n  for (const line of lines) {\n    if (isSkipLine(line)) continue;\n\n    // SUBSTITUTION marker \u2192 retrofit the LAST parsed item, not the next one\n    if (isSubstitutionLine(line)) {\n      if (items.length > 0) {\n        const last = items[items.length - 1];\n        last.is_substitution = true;\n        if (!last.substituted_sku) {\n          // Find the item before it that was ordered but not shipped\n          const prevItem = items.slice(0, -1).reverse().find(i => i.qty_received === 0);\n          last.substituted_sku = prevItem?.vendor_sku || null;\n        }\n        // Ensure OQR-002 warning is on the last item\n        if (!last.warnings.some(w => w.code === 'OQR-002')) {\n          last.warnings.push({\n            code:    'OQR-002',\n            message: `Substitution confirmed by SUBSTITUTION marker`,\n            field:   'is_substitution',\n          });\n        }\n      }\n      continue;\n    }\n\n    let m = line.match(LINE_RE);\n    if (m) {\n      const [, ordS, shpS, sku, descRaw, packRaw, upS, amtS] = m;\n      const item = buildItem(sku, descRaw, packRaw, parseFloat(ordS), parseFloat(shpS),\n        parsePrice(upS), parsePrice(amtS), prevSku);\n      items.push(item);\n      prevSku = sku;\n      continue;\n    }\n\n    m = line.match(LINE_RE2);\n    if (m) {\n      const [, ordS, shpS, sku, rest] = m;\n      const pm = rest.match(/([\\d,]+\\.\\d{2})\\s+([\\d,]+\\.\\d{2})(?:\\s+.*)?$/);\n      if (pm) {\n        const rawDesc = rest.slice(0, rest.lastIndexOf(pm[0])).trim();\n        const parts   = rawDesc.split(/\\s{2,}/);\n        let packRaw = parts.length > 1 ? parts[parts.length - 1] : '';\n        let descRaw = parts.length > 1 ? parts.slice(0, -1).join(' ') : rawDesc;\n        // Single-spaced OCR line: pack glued to description \u2014 extract trailing\n        // pack pattern like \"1pc / 28#\", \"11/1#\", \"25#\"\n        if (!packRaw) {\n          const pk = rawDesc.match(/^(.*?)\\s+((?:\\d+\\s*(?:PC|PCS|EA|EACH)?\\s*\\/\\s*)?[\\d.]+\\s*#)\\s*$/i);\n          if (pk) { descRaw = pk[1].trim(); packRaw = pk[2].trim(); }\n        }\n        const item = buildItem(sku, descRaw, packRaw, parseFloat(ordS), parseFloat(shpS),\n          parsePrice(pm[1]), parsePrice(pm[2]), prevSku);\n        items.push(item);\n        prevSku = sku;\n      }\n    }\n  }\n\n  if (!items.length) warnings.push({ code: 'PARSE_ERROR', message: 'No line items found' });\n\n  return {\n    vendor:        \"Hardie's Fresh Foods / Dairyland Produce\",\n    document_type: 'invoice',\n    order_number:  docNumber,\n    order_date:    orderDate,\n    delivery_date: deliveryDate,\n    subtotal, tax, total,\n    items, warnings,\n  };\n}\n\nfunction inferPurchaseUnit(pack) {\n  if (!pack) return null;\n  const u = pack.unit;\n  if (['ct','ea','each'].includes(u)) return 'each';\n  if (['lb','lbs'].includes(u))       return 'lb';\n  if (u === 'oz')                     return 'oz';\n  return u || null;\n}\n\nmodule.exports = { parse };\n",
  "hardies-credit": "// \u2500\u2500 vendor-parsers/hardies-credit.js \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Parser for Hardie's / Dairyland Produce CREDIT memo\n// Document type: credit_memo\n//\n// Real format (from 00668419):\n// QUANTITY  ITEM_CODE  DESCRIPTION         PACK  COOL  UNIT_PRICE  EXTENDED  RETURN_REASON\n// 2         25265      CHZ MOZZ SHRED W/M  5#    USA   24.96       -49.92    5A\n// Original Sales Order: 06991299\n\n'use strict';\n\nconst {\n  parseDate, parsePrice, parsePackSize, cleanDescription,\n  isSkipLine, extractDocNumber, extractDocDate,\n} = require('./utils');\n\n// Credit line: QTY  ITEM_CODE  DESCRIPTION  PACK  [COOL]  UNIT_PRICE  AMOUNT  RETURN_CODE\nconst LINE_RE = /^(\\d+)\\s+(\\d{5})\\s+(.+?)\\s{2,}(.+?)\\s{1,}(?:(USA|MEX|CAN|CHI)\\s+)?([\\d,.]+)\\s+(-?[\\d,.]+)\\s+([A-Z0-9]{1,3})?.*$/;\nconst LINE_RE2 = /^(\\d+)\\s+(\\d{5})\\s+(.{8,})$/;\n\n// Credit codes from footer\nconst RETURN_CODE_LABELS = {\n  NN: 'Do Not Need',\n  SH: 'Short on Truck',\n  NO: 'Did Not Order',\n  OO: 'Over Ordered',\n  MS: 'Mis-shipped',\n  MK: 'Mis-keyed',\n  '5A': 'Quality/Other',\n};\n\nfunction parse(rawText) {\n  const warnings = [];\n  const lines = rawText.split('\\n').map(l => l.trim());\n\n  // \u2500\u2500 Header \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n  const creditNumber   = extractDocNumber(lines, ['CREDIT']) || null;\n  const creditDate     = extractDocDate(lines, ['DATE', 'ORDER DATE']) || null;\n\n  // Original sales order reference\n  let originalOrder = null;\n  for (const line of lines) {\n    const m = line.match(/Original Sales Order[:\\s]+([\\d]+)/i);\n    if (m) { originalOrder = m[1]; break; }\n  }\n\n  // Total (negative)\n  let total = null;\n  for (const line of lines) {\n    const m = line.match(/TOTAL\\s+\\$(-?[\\d,]+\\.?\\d*)/i);\n    if (m) { total = parsePrice(m[1]); break; }\n  }\n\n  // \u2500\u2500 Item lines \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n  const items = [];\n\n  for (const line of lines) {\n    if (isSkipLine(line)) continue;\n    if (/Original Sales Order/i.test(line)) continue;\n\n    let m = line.match(LINE_RE);\n    if (m) {\n      const [, qtyStr, sku, descRaw, packRaw, origin, unitPriceStr, amountStr, returnCode] = m;\n      const pack = parsePackSize(packRaw.trim());\n      const returnLabel = returnCode ? (RETURN_CODE_LABELS[returnCode.toUpperCase()] || returnCode) : null;\n\n      items.push({\n        vendor_sku:       sku,\n        raw_description:  descRaw.trim(),\n        description:      cleanDescription(descRaw.trim()),\n        qty_credited:     parseFloat(qtyStr),\n        purchase_unit:    inferPurchaseUnit(pack),\n        pack_description: packRaw.trim(),\n        pack_qty:         pack ? pack.count : null,\n        pack_unit:        pack ? pack.unit  : null,\n        unit_price:       parsePrice(unitPriceStr),\n        amount:           parsePrice(amountStr),   // negative\n        origin:           origin || null,\n        return_code:      returnCode || null,\n        return_reason:    returnLabel,\n        warnings:         [],\n      });\n      continue;\n    }\n\n    // Fallback\n    m = line.match(LINE_RE2);\n    if (m) {\n      const [, qtyStr, sku, rest] = m;\n      // Credit amounts are negative: \"-49.92\" or \"49.92\" at end\n      const priceMatch = rest.match(/([\\d,]+\\.\\d{2})\\s+(-?[\\d,]+\\.\\d{2})(?:\\s+([A-Z0-9]{1,3}))?$/);\n      if (priceMatch) {\n        const rawDesc = rest.slice(0, rest.lastIndexOf(priceMatch[0])).trim();\n        const parts   = rawDesc.split(/\\s{2,}/);\n        const packRaw = parts.length > 1 ? parts[parts.length-1] : '';\n        const descRaw = parts.length > 1 ? parts.slice(0,-1).join(' ') : rawDesc;\n        const pack    = parsePackSize(packRaw);\n        const rc      = priceMatch[3] || null;\n\n        items.push({\n          vendor_sku:       sku,\n          raw_description:  rawDesc.trim(),\n          description:      cleanDescription(descRaw),\n          qty_credited:     parseFloat(qtyStr),\n          purchase_unit:    inferPurchaseUnit(pack),\n          pack_description: packRaw.trim(),\n          pack_qty:         pack ? pack.count : null,\n          pack_unit:        pack ? pack.unit  : null,\n          unit_price:       parsePrice(priceMatch[1]),\n          amount:           parsePrice(priceMatch[2]),\n          origin:           null,\n          return_code:      rc,\n          return_reason:    rc ? (RETURN_CODE_LABELS[rc.toUpperCase()] || rc) : null,\n          warnings:         [],\n        });\n      }\n    }\n  }\n\n  // OQR-001: Credit must be linked to original order\n  if (!originalOrder) {\n    warnings.push({\n      code:    'OQR-001',\n      message: 'Credit memo has no original order reference \u2014 manual linking required',\n      field:   'original_order_number',\n    });\n  }\n\n  if (!items.length) {\n    warnings.push({ code:'PARSE_ERROR', message:'No credit line items found' });\n  }\n\n  return {\n    vendor:               \"Hardie's Fresh Foods / Dairyland Produce\",\n    document_type:        'credit_memo',\n    credit_number:        creditNumber,\n    credit_date:          creditDate,\n    original_order_number:originalOrder,\n    total,\n    items,\n    warnings,\n  };\n}\n\nfunction inferPurchaseUnit(pack) {\n  if (!pack) return null;\n  const u = pack.unit;\n  if (['ct','ea','each'].includes(u)) return 'each';\n  if (['lb','lbs'].includes(u))       return 'lb';\n  if (u === 'oz')                     return 'oz';\n  return u || null;\n}\n\nmodule.exports = { parse };\n",
  "freshpoint-invoice": "// \u2500\u2500 vendor-parsers/freshpoint-invoice.js \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Parser for FreshPoint Dallas INVOICE\n//\n// Formato colonne OCR:\n// Item(SKU) | QtyOrd | QtyShip | Pack | PackSize | Description | UnitPrice | ExtendedPrice | St\n//\n// Logica prezzi:\n// - Tutto \u00e8 per_case \u2014 il prezzo \u00e8 sempre per confezione\n// - conversion_to_base calcolato dal pack size (es. 11# \u2192 4989g, 3/2# \u2192 2722g)\n// - price_per_100g = unit_price / conversion_to_base \u00d7 100\n\n'use strict';\n\nconst {\n  parseDate, parsePrice, parsePackSize, cleanDescription, isSkipLine,\n} = require('./utils');\n\nconst SKIP_RE = /invoice|customer|salesman|bill to|ship to|route|terms|due date|fuel surcharge|^page\\s|special instructions|remit payment|p\\.o\\. number|order date|quantit|unit\\s+price|extended|sub.?total|^cases|driver|splits|cubes|state|tax|total weight|item\\s+desc/i;\n\n// Converte pack size string in grammi totali\n// Esempi: \"11#\" \u2192 4989g, \"3/2#\" \u2192 3\u00d72\u00d7453.592=2722g\n// \"5 LB\" \u2192 2268g, \"48CT\" \u2192 null (conta), \"3 CT\" \u2192 null\nfunction packToGrams(packStr) {\n  if (!packStr) return null;\n  const s = packStr.trim().toUpperCase();\n\n  // Pattern \"N/M#\" o \"N/MLB\" \u2014 N unit\u00e0 da M lb\n  // Es: \"3/2#\" = 3 \u00d7 2 lb = 6 lb\n  const fracM = s.match(/^(\\d+)\\s*\\/\\s*(\\d+(?:\\.\\d+)?)\\s*(?:#|LB|LBS)$/);\n  if (fracM) return parseFloat(fracM[1]) * parseFloat(fracM[2]) * 453.592;\n\n  // Pattern \"N#\" o \"N LB\" \u2014 N lb totali\n  const lbM = s.match(/^(\\d+(?:\\.\\d+)?)\\s*(?:#|LB|LBS)$/);\n  if (lbM) return parseFloat(lbM[1]) * 453.592;\n\n  // Pattern \"N OZ\"\n  const ozM = s.match(/^(\\d+(?:\\.\\d+)?)\\s*OZ$/);\n  if (ozM) return parseFloat(ozM[1]) * 28.3495;\n\n  // Pattern \"N KG\"\n  const kgM = s.match(/^(\\d+(?:\\.\\d+)?)\\s*KG$/);\n  if (kgM) return parseFloat(kgM[1]) * 1000;\n\n  // Pattern \"N/MOZ\" \u2014 N unit\u00e0 da M oz\n  const fracOzM = s.match(/^(\\d+)\\s*\\/\\s*(\\d+(?:\\.\\d+)?)\\s*OZ$/);\n  if (fracOzM) return parseFloat(fracOzM[1]) * parseFloat(fracOzM[2]) * 28.3495;\n\n  // CT/EA \u2014 conta, nessun peso\n  return null;\n}\n\nfunction parseLine(line) {\n  line = line.replace(/[^\\x20-\\x7E]/g, ' ').replace(/\\s+/g, ' ').trim();\n\n  // SKU = 3-6 cifre all'inizio\n  const skuM = line.match(/^(\\d{3,6})\\s+(.+)/);\n  if (!skuM) return null;\n  const sku  = skuM[1];\n  const rest = skuM[2];\n\n  // Estrai i due prezzi alla fine della riga\n  // Es: \"... 33.15  66.30  US\" o \"... 33.15  66.30\"\n  const priceM = rest.match(/(\\d{1,4}(?:,\\d{3})*\\.\\d{2})\\s+(\\d{1,4}(?:,\\d{3})*\\.\\d{2})(?:\\s+[A-Z]{2})?$/);\n  if (!priceM) return null;\n\n  const unitPrice = parsePrice(priceM[1]);\n  const extended  = parsePrice(priceM[2]);\n  if (!unitPrice) return null;\n\n  const middle = rest.slice(0, rest.lastIndexOf(priceM[0])).trim();\n\n  // Qty ordinato e spedito\n  const qtyM = middle.match(/^(\\d+)\\s+(\\d+)\\s+(.+)/);\n  if (!qtyM) return null;\n\n  const qtyOrd  = parseInt(qtyM[1]) || 0;\n  const qtyShip = parseInt(qtyM[2]) || 0;\n  let   packRest = qtyM[3].trim();\n\n  // Pack type: BX, CS, BOX, EACH, EA, LB, CT\n  const packTypeM = packRest.match(/^(BX|CS|BOX|EACH|EA|CT|LB)\\s*(.*)/i);\n  let packType = null, packSize = null, descRaw = packRest;\n\n  if (packTypeM) {\n    packType = packTypeM[1].toUpperCase();\n    const afterType = packTypeM[2].trim();\n\n    // Pack size \u00e8 il primo token se contiene #, LB, OZ, KG, CT, numeri con /\n    const sizeM = afterType.match(/^(\\d[\\d\\/\\.]*\\s*(?:#|LB|LBS|OZ|KG|CT|DZ)?)\\s+(.+)/i);\n    if (sizeM) {\n      packSize = sizeM[1].trim();\n      descRaw  = sizeM[2].trim();\n    } else {\n      descRaw = afterType;\n    }\n  }\n\n  // Rimuovi suffisso origine (US, MX, ecc.) dalla descrizione\n  descRaw = descRaw.replace(/\\s+[A-Z]{2}\\s*$/, '').trim();\n\n  const desc    = cleanDescription(descRaw || packRest);\n  const totalG  = packToGrams(packSize);\n  const p100    = (totalG && unitPrice) ? parseFloat(((unitPrice / totalG) * 100).toFixed(4)) : null;\n\n  const itemWarnings = [];\n\n  if (qtyOrd !== qtyShip && qtyOrd > 0 && qtyShip > 0) {\n    itemWarnings.push({\n      code: 'OQR-007',\n      message: `Qty mismatch: ordered ${qtyOrd}, shipped ${qtyShip} of ${desc}`,\n      field: 'qty_received',\n    });\n  }\n\n  if (!totalG && packSize) {\n    itemWarnings.push({\n      code: 'OQR-006',\n      message: `Count-based: ${desc} (${packSize}) \u2014 no weight for costing`,\n      field: 'pack_unit',\n    });\n  }\n\n  return {\n    vendor_sku:        sku,\n    raw_description:   descRaw || packRest,\n    description:       desc,\n    qty_ordered:       qtyOrd,\n    qty_received:      qtyShip,\n    pack_description:  packSize || packRest,\n    pack_qty:          null,\n    pack_unit:         packType,\n    unit_price:        unitPrice,\n    amount:            extended,\n    extended_price:    extended,\n    price_type:        'per_case',\n    conversion_to_base: totalG ? Math.round(totalG) : null,\n    _cost_per_100g:    p100,\n    catchweight:       false,\n    warnings:          itemWarnings,\n  };\n}\n\nfunction parse(rawText) {\n  const text  = String(rawText || '');\n  const lines = text.split('\\n').map(l => l.trim()).filter(Boolean);\n\n  let invoiceNumber = null, invoiceDate = null, total = null, subtotal = null;\n  for (const line of lines) {\n    let m;\n    m = line.match(/Invoice\\s+No\\.?\\s*[:\\-]?\\s*(\\w+)/i);   if (m) invoiceNumber = m[1];\n    m = line.match(/Invoice\\s+Date\\s*[:\\-]?\\s*([\\d\\/]+)/i); if (m) invoiceDate = parseDate(m[1]);\n    m = line.match(/Sub\\s*[-\\s]*Total\\s+([\\d,]+\\.?\\d*)/i);  if (m) subtotal = parsePrice(m[1]);\n    m = line.match(/(?:^|\\s)Total\\s+([\\d,]+\\.?\\d*)\\s*$/i);  if (m && !total) total = parsePrice(m[1]);\n  }\n\n  const items = [];\n  for (const line of lines) {\n    if (SKIP_RE.test(line)) continue;\n    if (line.length < 20) continue;\n    const item = parseLine(line);\n    if (item && item.unit_price) items.push(item);\n  }\n\n  return {\n    vendor:         'FreshPoint Dallas',\n    document_type:  'invoice',\n    invoice_number: invoiceNumber,\n    invoice_date:   invoiceDate,\n    subtotal,\n    total,\n    items,\n    warnings: [],\n  };\n}\n\nmodule.exports = { parse };\n",
  "fruge-invoice": "// \u2500\u2500 vendor-parsers/fruge-invoice.js \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Parser for Fruge Seafood INVOICE\n//\n// Formato colonne:\n// Ordered | Product Description | Shipped | Unit Price | Amount\n// Header:  INVOICE 855939 / Taken 09/14/26 / Shipped 09/14/26 / Invoiced 09/14/26\n// Total:   \"... Pay:  \\n$828.25\" (label and amount can land on different\n//          physical PDF lines \u2014 matched against the whole text, not\n//          per-line, for exactly this reason)\n//\n// MICRO-TASK 34 \u2014 root cause and fix\n// -----------------------------------\n// The previous version of this file hardcoded every quantity/price unit\n// to \"LB\", on the theory that Fruge always sells and prices by the\n// pound. Real invoices disprove that: the Shipped and Unit Price\n// columns each carry their OWN unit independently \u2014 LB, BG (bag), GA\n// (gallon), CA/CS (case), EA (each) \u2014 and the two don't have to match\n// (e.g. LOBSTER below: ordered/shipped \"1 CA\", but priced \"$27.50 LB\").\n// Hardcoding \"LB\" meant any line shipped in CA/BG/GA never matched at\n// all and was silently dropped \u2014 invoice #855939 and #856363 happened\n// to contain ZERO lines shipped in bare \"LB\", so they parsed to 0 items\n// with no warning at all (the bug this task fixes). Invoice #854668\n// only \"worked\" because 1 of its 5 real lines (BRANZINI) happened to\n// use LB for both columns; the other 4 were being silently dropped by\n// this file even though it reported no error.\n//\n// This version is ported, deliberately close to verbatim (regex and\n// arithmetic unchanged, only var\u2192const/let and the debug console.log\n// calls removed), from the browser copy's `parseFrugeInvoice` /\n// \"FRUGE PARSER v5\" in js/vendor-parser-ui.js \u2014 proven correct against\n// real production data: invoice #854668's already-stored parsed_json\n// (cost_per_lb, total_weight_lb, pack_description, catchweight \u2014 every\n// field, for every one of its 5 real items) matches this logic's output\n// exactly, byte for byte, confirming it is what actually parsed that\n// invoice historically (not this file's previous version). See\n// MICRO-TASK 34 report for the line-by-line verification against\n// #854668, #855939 and #856363.\n//\n// Unit-derived weight (totalLb) is found three ways, depending on the\n// Shipped unit \u2014 never invented, always read from text already on the\n// invoice:\n//   - Shipped in LB directly            \u2192 totalLb = the shipped qty itself.\n//   - Shipped in BG/GA/GAL              \u2192 totalLb = shipped qty \u00d7 the\n//     \"N lb\" weight-per-unit printed in the description or (since the\n//     description sometimes wraps to the next physical PDF line, e.g.\n//     \"BRISTOL, 8 LB GAL 8lb\") one of the next 3 lines.\n//   - Shipped in CA/CS                  \u2192 totalLb = shipped qty \u00d7 the\n//     \"N x M lb\" pack breakdown printed the same way (own description or\n//     next few lines), e.g. \"(5 X 2 LBS)\", \"10x2.5lb\".\n// When none of these is found (e.g. LOBSTER: \"10lb\" is glued to the\n// product's own size descriptor, not a \"N x M lb\" case breakdown), the\n// item is still extracted \u2014 sku/description/qty/unit_price/amount are\n// never in doubt \u2014 just without a derived weight, so cost_per_100g\n// stays null rather than guessing. This exactly matches the real,\n// already-proven behavior for LOBSTER in #854668.\n\n'use strict';\n\nconst { parseDate } = require('./utils');\n\nconst LINE_RE = /^\\s*\\d+(?:\\.\\d+)?\\s+(LB|BG|GA|GAL|CA|CS|EA)\\s+([A-Z0-9]{6,16})\\s*[-\\u2013]\\s*(.+?)\\s+(\\d+(?:\\.\\d+)?)\\s+(LB|BG|GA|GAL|CA|CS|EA)\\s+\\$?([\\d,]+\\.\\d{2})\\s+(?:LB|BG|GA|GAL|CA|CS|EA)\\s+\\$?([\\d,]+\\.\\d{2})/i;\n\nfunction parse(rawText) {\n  const text = String(rawText || '');\n\n  let invoiceNumber = null, invoiceDate = null, total = null;\n  const invM = text.match(/INVOICE\\s+(\\d+)/i);          if (invM) invoiceNumber = invM[1];\n  const invdM = text.match(/Invoiced\\s+([\\d\\/]+)/i);    if (invdM) invoiceDate = parseDate(invdM[1]);\n  // FIX (MICRO-TASK 34): matched against the whole text, not per-line \u2014\n  // \"Pay:\" and the dollar amount can land on different physical PDF\n  // lines (confirmed real in #855939/#856363/#854668 alike), so a\n  // per-line match silently found nothing and left total/subtotal null\n  // for every Fruge invoice, not just the two failing ones.\n  const payM = text.match(/Pay:\\s*\\$?([\\d,]+\\.\\d{2})/i); if (payM) total = parseFloat(payM[1].replace(/,/g, ''));\n\n  const lines = text.split('\\n').map((l) => l.trim());\n  const items = [];\n  const warnings = [];\n\n  for (let i = 0; i < lines.length; i++) {\n    const m = lines[i].match(LINE_RE);\n    if (!m) continue;\n\n    const sku = m[2];\n    const descRaw = m[3].trim();\n    const shpQty = parseFloat(m[4]);\n    const shpUnit = m[5].toUpperCase();\n    const unitPrice = parseFloat(m[6].replace(/,/g, ''));\n    const amount = parseFloat(m[7].replace(/,/g, ''));\n\n    let totalLb = null;\n\n    if (shpUnit === 'LB') {\n      // Catchweight \u2014 shipped already in LB.\n      totalLb = shpQty;\n    } else if (shpUnit === 'BG' || shpUnit === 'GA' || shpUnit === 'GAL') {\n      const wm = descRaw.match(/(\\d+(?:\\.\\d+)?)\\s*lb\\b/i);\n      if (wm) {\n        totalLb = shpQty * parseFloat(wm[1]);\n      } else {\n        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {\n          const nxt = lines[j].trim();\n          if (LINE_RE.test(nxt)) break;\n          const wm2 = nxt.match(/(\\d+(?:\\.\\d+)?)\\s*lb\\b/i);\n          if (wm2) { totalLb = shpQty * parseFloat(wm2[1]); break; }\n        }\n      }\n    } else if (shpUnit === 'CA' || shpUnit === 'CS') {\n      let mxm = descRaw.match(/(\\d+)\\s*[xX]\\s*(\\d+(?:\\.\\d+)?)\\s*(?:LBS?|lb)/i);\n      if (!mxm) {\n        for (let k = i + 1; k < Math.min(i + 4, lines.length); k++) {\n          const nxt2 = lines[k].trim();\n          if (LINE_RE.test(nxt2)) break;\n          mxm = nxt2.match(/(\\d+)\\s*[xX]\\s*(\\d+(?:\\.\\d+)?)\\s*(?:LBS?|lb)/i);\n          if (mxm) break;\n        }\n      }\n      if (mxm) {\n        totalLb = shpQty * parseFloat(mxm[1]) * parseFloat(mxm[2]);\n      }\n    }\n\n    const packDesc = totalLb ? (parseFloat(totalLb.toFixed(2)) + ' LB') : (shpQty + ' ' + shpUnit);\n    const costPerLb = totalLb ? (amount / totalLb) : null;\n    const cost100g = costPerLb ? parseFloat(((costPerLb / 453.592) * 100).toFixed(4)) : null;\n\n    const desc = descRaw\n      .replace(/\\d+(?:\\.\\d+)?\\s*lb\\b/gi, '')\n      .replace(/GALLON/gi, '')\n      .replace(/\\s+/g, ' ')\n      .trim();\n\n    items.push({\n      vendor_sku: sku,\n      description: desc,\n      raw_description: descRaw,\n      qty_ordered: null,\n      qty_received: shpQty,\n      received_unit: shpUnit,\n      pack_description: packDesc,\n      total_weight_lb: totalLb ? parseFloat(totalLb.toFixed(4)) : null,\n      unit_price: unitPrice,\n      amount: amount,\n      cost_per_lb: costPerLb ? parseFloat(costPerLb.toFixed(4)) : null,\n      _cost_per_100g: cost100g,\n      price_type: 'per_lb',\n      catchweight: shpUnit === 'LB',\n      warnings: [],\n    });\n  }\n\n  // GUARD (MICRO-TASK 34) \u2014 a document index.js has already identified\n  // as a Fruge invoice, with a real document number, that nonetheless\n  // yields zero parseable line items must never be able to reach\n  // preflight-clean. This is the exact failure mode that let #855939\n  // and #856363 land in status='error' with warnings=null (silent \u2014\n  // no signal at all). Explicit, blocking, and named distinctly from\n  // the generic PARSE_ERROR other vendors use, so it can never be\n  // mistaken for the info-only \"technical error\" codes (see\n  // isBlockingWarning() in edge-functions/vendor-doc-auto-import and\n  // vdrWarningToQuestion() in js/vendor-documents-review.js \u2014 both\n  // updated in this task to treat PARSE_ERROR_NO_LINES as blocking).\n  if (items.length === 0) {\n    warnings.push({\n      code: 'PARSE_ERROR_NO_LINES',\n      message: invoiceNumber\n        ? `Fruge invoice #${invoiceNumber} recognized but 0 line items were parsed \u2014 layout may have changed`\n        : 'Fruge invoice recognized but 0 line items were parsed \u2014 layout may have changed',\n    });\n  }\n\n  return {\n    vendor: 'Fruge Seafood',\n    document_type: 'invoice',\n    document_number: invoiceNumber,\n    invoice_number: invoiceNumber,\n    document_date: invoiceDate,\n    invoice_date: invoiceDate,\n    subtotal: total,\n    total: total,\n    items,\n    warnings,\n  };\n}\n\nmodule.exports = { parse };\n",
  "bek-invoice": "// \u2500\u2500 vendor-parsers/bek-invoice.js \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Parser for Ben E. Keith Foods INVOICE\n//\n// Formato colonne:\n// Location(SKU) | Cases(Qty) | Pkgs | Item# | Brand | MfgCode | PackSize | Description | UnitPrice | Amount\n//\n// Logica prezzi:\n// - Sempre per_case \u2014 prezzo per confezione\n// - Pack size fisso dichiarato (es. 3/1 GAL, 2/10 LB, 1/50 LB)\n// - conversion_to_base calcolato dal pack size in grammi\n\n'use strict';\n\nconst { parseDate, parsePrice, parsePackSize, cleanDescription } = require('./utils');\n\nconst SKIP_RE = /ben e\\.? keith|invoice|sold to|ship to|customer|route|terms|due|section total|description\\s+promo|^cases\\s+pkg|please check|cash\\/ck|amt paid|total invoice|continued|^this page|tax\\b|^dry$|^frozen$/i;\n\n// Converte pack size BEK in grammi totali\n// Es: \"3/1 GAL\" \u2192 3\u00d73785g=11355g, \"2/10 LB\" \u2192 2\u00d710\u00d7453g=9072g\n// \"1/50 LB\" \u2192 22680g, \"8/12 OZ\" \u2192 8\u00d712\u00d728.35g=2721g\n// \"3/50 CT\" \u2192 null (conta), \"24/800 ML\" \u2192 24\u00d7800=19200ml\u224819200g\nfunction packToGrams(packStr) {\n  if (!packStr) return null;\n  const s = packStr.trim().toUpperCase().replace(/\\s+/g, ' ');\n\n  // Pattern \"N/M UNIT\" \u2014 N confezioni da M unit\u00e0\n  const fracM = s.match(/^(\\d+)\\s*\\/\\s*(\\d+(?:\\.\\d+)?)\\s*(LB|LBS|#|OZ|GAL|ML|L|KG|G)\\s*$/);\n  if (fracM) {\n    const count = parseFloat(fracM[1]);\n    const size  = parseFloat(fracM[2]);\n    const unit  = fracM[3];\n    if (unit === 'LB' || unit === 'LBS' || unit === '#') return count * size * 453.592;\n    if (unit === 'OZ') return count * size * 28.3495;\n    if (unit === 'GAL') return count * size * 3785.41;\n    if (unit === 'ML') return count * size;\n    if (unit === 'L') return count * size * 1000;\n    if (unit === 'KG') return count * size * 1000;\n    if (unit === 'G') return count * size;\n  }\n\n  // Pattern \"N/M-M2 OZ\" range \u2014 usa media (es. \"12/22-24 OZ\")\n  const rangeM = s.match(/^(\\d+)\\s*\\/\\s*(\\d+)-(\\d+)\\s*(LB|OZ|#)\\s*$/);\n  if (rangeM) {\n    const count = parseFloat(rangeM[1]);\n    const avg   = (parseFloat(rangeM[2]) + parseFloat(rangeM[3])) / 2;\n    const unit  = rangeM[4];\n    if (unit === 'LB' || unit === '#') return count * avg * 453.592;\n    if (unit === 'OZ') return count * avg * 28.3495;\n  }\n\n  // Pattern semplice \"N LB\" o \"N#\"\n  const simpleM = s.match(/^(\\d+(?:\\.\\d+)?)\\s*(LB|LBS|#|OZ|GAL|KG|G|ML|L)\\s*$/);\n  if (simpleM) {\n    const size = parseFloat(simpleM[1]);\n    const unit = simpleM[2];\n    if (unit === 'LB' || unit === 'LBS' || unit === '#') return size * 453.592;\n    if (unit === 'OZ') return size * 28.3495;\n    if (unit === 'GAL') return size * 3785.41;\n    if (unit === 'KG') return size * 1000;\n    if (unit === 'G') return size;\n    if (unit === 'ML') return size;\n    if (unit === 'L') return size * 1000;\n  }\n\n  return null; // CT, EA, ecc. \u2014 conta, nessun peso\n}\n\n// Formato riga BEK:\n// DW07311  1  1  108509  MR CLEAN  1003700002621  3/1 GAL  Cleaner Floor & All Purpose  54.33  54.33\nfunction parseLine(line) {\n  line = line.replace(/[^\\x20-\\x7E]/g, ' ').replace(/\\s+/g, ' ').trim();\n\n  // Amount alla fine\n  const amountM = line.match(/\\$?([\\d,]+\\.\\d{2})\\s*$/);\n  if (!amountM) return null;\n  const amount = parsePrice(amountM[1]);\n\n  const beforeAmount = line.slice(0, line.lastIndexOf(amountM[0])).trim();\n\n  // Unit price prima dell'amount\n  const priceM = beforeAmount.match(/\\$?([\\d,]+\\.\\d{2})\\s*$/);\n  if (!priceM) return null;\n  const unitPrice = parsePrice(priceM[1]);\n  if (!unitPrice) return null;\n\n  const beforePrice = beforeAmount.slice(0, beforeAmount.lastIndexOf(priceM[0])).trim();\n\n  // Parsing da sinistra: SKU(Location) Cases Pkgs ItemNo Brand MfgCode PackSize Description\n  // SKU = alfanumerico all'inizio (es. DW07311, AF09212, 700150)\n  const tokens = beforePrice.split(/\\s+/);\n  if (tokens.length < 5) return null;\n\n  const sku   = tokens[0];\n  const qty   = parseInt(tokens[1]) || 1;\n  // tokens[2] = Pkgs (skip)\n  // tokens[3] = Item# (skip)\n  // tokens[4] = Brand (skip)\n  // tokens[5] = MfgCode (skip) \u2014 pu\u00f2 essere lungo\n  // Dopo: PackSize + Description\n\n  // Cerca il pack size \u2014 pattern numerico con unit\u00e0\n  let packSize = null, descStart = -1;\n  for (let i = 3; i < tokens.length; i++) {\n    const chunk2 = tokens[i] + (tokens[i+1] ? ' ' + tokens[i+1] : '');\n    const chunk1 = tokens[i];\n    // PackSize tipicamente: \"3/1\" seguito da \"GAL\", \"LB\", \"OZ\", \"CT\", \"ML\" ecc.\n    // oppure \"3/1 GAL\" in un token solo se OCR lo unisce\n    if (/^\\d+\\/\\d+$/.test(chunk1) && tokens[i+1] && /^(GAL|LB|LBS|OZ|CT|ML|L|KG|G|#)$/i.test(tokens[i+1])) {\n      packSize = chunk2;\n      descStart = i + 2;\n      break;\n    }\n    if (/^\\d+\\/\\d+-\\d+$/.test(chunk1) && tokens[i+1] && /^(OZ|LB|#)$/i.test(tokens[i+1])) {\n      packSize = chunk2;\n      descStart = i + 2;\n      break;\n    }\n    // PackSize tutto in un token (es. \"3/1GAL\" o \"24/800ML\")\n    if (/^\\d+\\/\\d+(?:\\.\\d+)?(GAL|LB|OZ|ML|CT|KG|G|#)$/i.test(chunk1)) {\n      packSize = chunk1;\n      descStart = i + 1;\n      break;\n    }\n  }\n\n  if (descStart === -1 || descStart >= tokens.length) return null;\n\n  const descRaw = tokens.slice(descStart).join(' ').trim();\n  if (!descRaw || descRaw.length < 3) return null;\n\n  // Ignora righe supply/cleaning (non food)\n  if (/cleaner|floor|sanitiz|chemical|glove|bag|container|wrap|film|towel/i.test(descRaw)) {\n    return null; // Skip non-food items\n  }\n\n  const desc   = cleanDescription(descRaw);\n  const totalG = packToGrams(packSize);\n  const p100   = (totalG && unitPrice) ? parseFloat(((unitPrice / totalG) * 100).toFixed(4)) : null;\n\n  const itemWarnings = [];\n  if (!totalG && packSize && !/ct|ea|each|dz/i.test(packSize)) {\n    itemWarnings.push({\n      code: 'OQR-006',\n      message: `Pack size \"${packSize}\" \u2014 peso non calcolabile per ${desc}`,\n      field: 'pack_unit',\n    });\n  }\n\n  return {\n    vendor_sku:         sku,\n    raw_description:    descRaw,\n    description:        desc,\n    qty_ordered:        qty,\n    qty_received:       qty,\n    pack_description:   packSize,\n    unit_price:         unitPrice,\n    amount:             amount,\n    extended_price:     amount,\n    price_type:         'per_case',\n    conversion_to_base: totalG ? Math.round(totalG) : null,\n    _cost_per_100g:     p100,\n    catchweight:        false,\n    warnings:           itemWarnings,\n  };\n}\n\nfunction parse(rawText) {\n  const text  = String(rawText || '');\n  const lines = text.split('\\n').map(l => l.trim()).filter(Boolean);\n\n  let invoiceNumber = null, invoiceDate = null, total = null;\n  for (const line of lines) {\n    let m;\n    m = line.match(/Invoice\\s*#?\\s*:?\\s*(\\d+)/i);        if (m) invoiceNumber = m[1];\n    m = line.match(/(?:Invoice|Order)\\s+Date\\s*:?\\s*([\\d\\/]+)/i); if (m) invoiceDate = parseDate(m[1]);\n    m = line.match(/Total\\s+Invoice\\s+([\\d,]+\\.\\d{2})/i); if (m) total = parsePrice(m[1]);\n  }\n\n  const items = [];\n  for (const line of lines) {\n    if (SKIP_RE.test(line)) continue;\n    if (line.length < 20) continue;\n    const item = parseLine(line);\n    if (item && item.unit_price) items.push(item);\n  }\n\n  return {\n    vendor:         'Ben E. Keith',\n    document_type:  'invoice',\n    invoice_number: invoiceNumber,\n    invoice_date:   invoiceDate,\n    subtotal:       null,\n    total,\n    items,\n    warnings: [],\n  };\n}\n\nmodule.exports = { parse };\n",
  "ben-e-keith-order-confirmation": "// \u2500\u2500 vendor-parsers/ben-e-keith-order-confirmation.js \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Ben E. Keith \u2014 Order Confirmation (email HTML). MICRO-TASK 42.\n//\n// CANONICAL, SINGLE SOURCE OF TRUTH. Consumed by three runtimes:\n//   - Node (tests)                     \u2192 require('./ben-e-keith-order-confirmation')\n//   - Deno (vendor-doc-auto-import)    \u2192 PARSER_SOURCES + makeCjsLoader shim\n//   - Browser (js/vendor-parser-ui.js) \u2192 window.BekOrderConfirmationParser\n// There must never be a second implementation of this logic.\n//\n// WHY NO DOMParser: it does not exist in Deno, and MICRO-TASK 32 excluded\n// BEK from background auto-import for exactly that reason. The real email\n// is a machine-generated SendGrid template with well-formed, explicitly\n// closed table markup, so a deterministic depth-aware scanner reproduces\n// what DOMParser gave us \u2014 without a browser global. No regex-only cell\n// splitting: the PRICE cell contains its OWN nested <table>, so cells must\n// be direct children of their row or ORDERED/CONFIRMED/STATUS shift onto\n// the wrong values (the bug fixed in Task 11H, Bug 1).\n//\n// WHY SELF-CONTAINED (no require('./utils')): the browser copy is loaded\n// as a plain <script> with no module loader, and the Deno shim resolves\n// only what PARSER_SOURCES holds. Inlining the three tiny helpers this\n// parser needs keeps one file working unchanged in all three runtimes.\n// parseDate/parsePrice here are behaviourally identical to utils.js \u2014\n// tests/bek-canonical-parser.test.js pins that equivalence.\n//\n// \u2500\u2500 TWO KINDS OF EMAIL UNDER ONE SUBJECT (measured, MICRO-TASK 42) \u2500\u2500\u2500\n// Real production data (4 documents read from Gmail) shows Ben E. Keith\n// sends two structurally identical emails with the same subject:\n//\n//   0003243454 16 Sep  8 items, all Filled,    confirmed>0  \u2192 a purchase\n//   0003126637 06 Sep  4 items, all Filled,    confirmed>0  \u2192 a purchase\n//   0003126637 04 Sep  4 items, all Requested, confirmed=0  \u2192 NOT a purchase\n//   0003198361 12 Sep  8 items, all Requested, confirmed=0  \u2192 NOT a purchase\n//\n// The header text is NOT a usable signal: 0003198361 says \"Your order is\n// confirmed and ready for delivery\" while every line is still Requested\n// with confirmed 0. Classification therefore derives ONLY from the item\n// rows (see classifyDocument), never from prose. The disclaimer sentence\n// is kept as diagnostic evidence, never as the decision.\n//\n// \u2500\u2500 TWO DIFFERENT TOTALS (measured) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// In all 4 real documents the vendor-declared \"Order Total\" equals\n// \u03a3(unit_price \u00d7 ORDERED) to the cent \u2014 including the two where CONFIRMED\n// is 0 throughout. It is an ORDER-TIME total, not a delivery total. So:\n//\n//   computed_order_total    = \u03a3(price \u00d7 ordered)   \u2190 what the declared\n//                                                    Order Total verifies;\n//                                                    a parser-integrity check\n//   computed_purchase_total = \u03a3(price \u00d7 confirmed) \u2190 the actual purchase\n//\n// Reconciling the purchase total against the declared total would block\n// every short delivery, which is wrong: a short fill is a normal event\n// that must still import, carrying only an informational BEK_QTY_SHORT.\n\n'use strict';\n\n// \u2500\u2500 Minimal helpers (behaviour-identical to vendor-parsers/utils.js) \u2500\u2500\n\nfunction parseDate(str) {\n  if (!str) return null;\n  str = String(str).trim();\n  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(str)) return str;\n  const m = str.match(/^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{2,4})$/);\n  if (m) {\n    let year = parseInt(m[3], 10);\n    if (year < 100) year += 2000;\n    const mo = String(parseInt(m[1], 10)).padStart(2, '0');\n    const da = String(parseInt(m[2], 10)).padStart(2, '0');\n    return `${year}-${mo}-${da}`;\n  }\n  return null;\n}\n\nfunction parsePrice(str) {\n  if (str === null || str === undefined) return null;\n  const n = parseFloat(String(str).replace(/[$,\\s]/g, ''));\n  return isNaN(n) ? null : n;\n}\n\nfunction cleanDescription(str) {\n  if (!str) return '';\n  return String(str).replace(/\\s+/g, ' ').trim();\n}\n\nfunction round2(n) {\n  return Math.round(n * 100) / 100;\n}\n\n// Same convention as checkTotals / writeInvoiceLines \u2014 never a second one.\nconst RECONCILIATION_TOLERANCE = 0.02;\n\n// \u2500\u2500 HTML entities \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nconst NAMED_ENTITIES = {\n  amp: '&', lt: '<', gt: '>', quot: '\"', apos: \"'\", nbsp: ' ',\n  copy: '\u00a9', reg: '\u00ae', trade: '\u2122', hellip: '\u2026',\n  ndash: '\u2013', mdash: '\u2014', rsquo: '\u2019', lsquo: '\u2018',\n  ldquo: '\u201c', rdquo: '\u201d', deg: '\u00b0', middot: '\u00b7',\n};\n\nfunction decodeEntities(text) {\n  if (!text) return '';\n  return String(text).replace(/&(#x[0-9a-fA-F]+|#\\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {\n    if (body.charAt(0) === '#') {\n      const code = body.charAt(1) === 'x' || body.charAt(1) === 'X'\n        ? parseInt(body.slice(2), 16)\n        : parseInt(body.slice(1), 10);\n      if (!isFinite(code) || code < 0 || code > 0x10FFFF) return whole;\n      try { return String.fromCodePoint(code); } catch (_e) { return whole; }\n    }\n    const named = NAMED_ENTITIES[body.toLowerCase()];\n    return named === undefined ? whole : named;\n  });\n}\n\nfunction htmlToText(html) {\n  if (!html) return '';\n  return cleanDescription(\n    decodeEntities(\n      String(html)\n        .replace(/<!--[\\s\\S]*?-->/g, ' ')\n        .replace(/<(script|style)\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>/gi, ' ')\n        .replace(/<[^>]*>/g, ' ')\n    )\n  );\n}\n\n// \u2500\u2500 Depth-aware table scanner \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Returns every <tr> in document order as an array of its DIRECT-CHILD\n// <td> cells (inner HTML). A <td> belonging to a nested table is never\n// reported as a cell of the outer row \u2014 that is the whole point.\n\nconst STRUCTURAL = { table: 1, thead: 1, tbody: 1, tfoot: 1, tr: 1, td: 1, th: 1 };\nconst TAG_RE = /<(\\/?)([a-zA-Z][a-zA-Z0-9]*)\\b([^>]*)>/g;\n\nfunction extractRows(html) {\n  const src = String(html || '');\n  const rows = [];\n  const stack = [];\n  let m;\n\n  function topRow() {\n    for (let i = stack.length - 1; i >= 0; i--) {\n      if (stack[i].name === 'tr') return stack[i];\n    }\n    return null;\n  }\n\n  function closeCell(entry, endIndex) {\n    const parent = stack.length ? stack[stack.length - 1] : null;\n    if (parent && parent.name === 'tr') {\n      parent.cells.push(src.slice(entry.contentStart, endIndex));\n    }\n  }\n\n  function unwindTo(name, endIndex) {\n    let idx = -1;\n    for (let i = stack.length - 1; i >= 0; i--) {\n      if (stack[i].name === name) { idx = i; break; }\n    }\n    if (idx === -1) return;\n    while (stack.length > idx) {\n      const entry = stack.pop();\n      if (entry.name === 'td' || entry.name === 'th') closeCell(entry, endIndex);\n      else if (entry.name === 'tr') rows.push(entry);\n    }\n  }\n\n  TAG_RE.lastIndex = 0;\n  while ((m = TAG_RE.exec(src)) !== null) {\n    const isClose = m[1] === '/';\n    const name = m[2].toLowerCase();\n    if (!STRUCTURAL[name]) continue;\n\n    const tagStart = m.index;\n    const tagEnd = TAG_RE.lastIndex;\n    const selfClosing = /\\/\\s*$/.test(m[3] || '');\n\n    if (isClose) { unwindTo(name, tagStart); continue; }\n    if (selfClosing) continue;\n\n    if (name === 'td' || name === 'th') {\n      const top = stack.length ? stack[stack.length - 1] : null;\n      if (top && (top.name === 'td' || top.name === 'th')) {\n        stack.pop();\n        closeCell(top, tagStart);\n      }\n    } else if (name === 'tr') {\n      const rowTop = topRow();\n      if (rowTop && stack[stack.length - 1] === rowTop) {\n        stack.pop();\n        rows.push(rowTop);\n      }\n    }\n\n    stack.push({ name, contentStart: tagEnd, cells: [] });\n  }\n\n  while (stack.length) {\n    const entry = stack.pop();\n    if (entry.name === 'td' || entry.name === 'th') closeCell(entry, src.length);\n    else if (entry.name === 'tr') rows.push(entry);\n  }\n\n  return rows.map(r => r.cells);\n}\n\n// \u2500\u2500 Item status \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Closed set. Anything unrecognised becomes 'unknown' and is reported \u2014\n// never silently coerced into a \"fine\" status.\n//\n// 'requested' is a REAL production status (measured on 0003126637 04 Sep\n// and 0003198361 12 Sep): the order has been received but item\n// confirmation has not happened yet.\n\nconst STATUS_REQUESTED = 'requested';\n\nconst STATUS_MAP = [\n  [/^requested$/i,                      STATUS_REQUESTED],\n  [/^filled$/i,                         'filled'],\n  [/^partially\\s*filled$/i,             'partially_filled'],\n  [/back\\s*-?\\s*order/i,                'backordered'],\n  [/^not\\s*filled$/i,                   'not_filled'],\n  [/cancel/i,                           'cancelled'],\n  [/substitut/i,                        'substituted'],\n  [/out\\s*of\\s*stock/i,                 'out_of_stock'],\n  [/discontinu/i,                       'discontinued'],\n];\n\nfunction normalizeStatus(raw) {\n  const s = cleanDescription(raw);\n  if (!s) return { status_raw: '', status: 'unknown' };\n  for (const [re, norm] of STATUS_MAP) {\n    if (re.test(s)) return { status_raw: s, status: norm };\n  }\n  return { status_raw: s, status: 'unknown' };\n}\n\n// \u2500\u2500 Document classification (MICRO-TASK 42, section A) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Derived ONLY from the parsed item rows. Never from headers, prose or\n// the disclaimer sentence.\n//\n//   ACKNOWLEDGEMENT          every item confirmed=0 AND status=requested\n//   OPERATIONAL_CONFIRMATION at least one item with confirmed>0\n//   AMBIGUOUS                everything confirmed=0 but statuses are NOT\n//                            all 'requested' (Cancelled / Not Filled /\n//                            unknown \u2026) \u2014 fail closed, never guessed\n\nconst DOC_CLASS_ACK       = 'acknowledgement';\nconst DOC_CLASS_OPERATION = 'operational_confirmation';\nconst DOC_CLASS_AMBIGUOUS = 'ambiguous';\n\nfunction classifyDocument(items) {\n  if (!items.length) return DOC_CLASS_AMBIGUOUS;\n\n  const anyConfirmed = items.some(it => it.qty !== null && it.qty > 0);\n  if (anyConfirmed) return DOC_CLASS_OPERATION;\n\n  const allZero      = items.every(it => it.qty === 0);\n  const allRequested = items.every(it => it.item_status === STATUS_REQUESTED);\n  if (allZero && allRequested) return DOC_CLASS_ACK;\n\n  return DOC_CLASS_AMBIGUOUS;\n}\n\n// \u2500\u2500 Header fields \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nfunction extractSalesOrder(text, subject) {\n  const m = text.match(/Sales\\s*Order\\s*#?\\s*:?\\s*\\*?\\s*(\\d+)/i);\n  if (m) return m[1];\n  if (subject) {\n    const sm = String(subject).match(/;\\s*(\\d+)\\s*$/);\n    if (sm) return sm[1];\n  }\n  return null;\n}\n\nfunction extractDeliveryDate(text) {\n  const m = text.match(/Delivery\\s*Date\\s*:?\\s*\\*?\\s*(\\d{1,2}\\/\\d{1,2}\\/\\d{2,4})/i);\n  return m ? parseDate(m[1]) : null;\n}\n\nfunction extractOrderTotal(text) {\n  const m = text.match(/Order\\s*Total\\s*\\*?\\s*:?\\s*\\*?\\s*\\$?\\s*([\\d,]+\\.\\d{2})/i);\n  return m ? parsePrice(m[1]) : null;\n}\n\n// Diagnostic evidence only \u2014 never a classification input.\nconst DISCLAIMER_RE = /Item\\s+confirmation\\s+will\\s+occur\\s+the\\s+morning\\s+before/i;\n\n// \u2500\u2500 Buyer / order owner (MICRO-TASK 48) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Ben E. Keith serves TWO order streams on the SAME Customer# (FDF770366,\n// \"ZENO'S ON THE SQUARE\"): the kitchen brigade's orders and the front of\n// house's. Measured on 56 real Gmail threads: Customer#, Branch, Customer\n// Name, subject, sender and recipient are IDENTICAL on every one of them,\n// so none of those can tell the two apart. The only field that differs is\n// the `Email:` line in the confirmation header, which carries the address\n// of whoever placed the order \u2014 28 threads each, and zero with any third\n// value.\n//\n// BOH OS must treat ONLY the kitchen stream as a purchase. The front of\n// house stream is a real order, but not the chef's, and must never reach\n// invoice_lines, ingredient_vendors, aliases or price intelligence.\n//\n// Allow-list, not deny-list, and FAIL CLOSED on anything unrecognised: a\n// new buyer appearing tomorrow must stop and ask, never be silently\n// assumed to be one side or the other.\nconst BUYER_EMAIL_RE = /Email:\\s*\\*?\\s*([^\\s*<>]+@[^\\s*<>]+)/i;\n\nconst BEK_BUYER_KITCHEN = 'raven_wolf_1510@yahoo.com';\nconst BEK_BUYER_FOH     = 'zeno@zenosonthesquare.com';\n\nconst BUYER_KITCHEN  = 'kitchen';\nconst BUYER_EXCLUDED = 'excluded';\nconst BUYER_UNKNOWN  = 'unknown';\n\n// Normalisation is deliberately minimal: trim + lowercase, nothing else.\n// No fuzzy matching, no domain rules, no local-part tricks \u2014 an address\n// either is one of the two known ones or it is not.\nfunction normalizeBuyerEmail(raw) {\n  if (raw === null || raw === undefined) return null;\n  const s = String(raw).trim().toLowerCase();\n  return s === '' ? null : s;\n}\n\nfunction extractBuyerEmail(text) {\n  const m = String(text || '').match(BUYER_EMAIL_RE);\n  return m ? normalizeBuyerEmail(m[1]) : null;\n}\n\n// kitchen  \u2192 this is a chef purchase\n// excluded \u2192 a real front-of-house order, deliberately not a chef purchase\n// unknown  \u2192 missing or unrecognised: fail closed, never guessed\nfunction classifyBuyer(email) {\n  const e = normalizeBuyerEmail(email);\n  if (e === BEK_BUYER_KITCHEN) return BUYER_KITCHEN;\n  if (e === BEK_BUYER_FOH)     return BUYER_EXCLUDED;\n  return BUYER_UNKNOWN;\n}\n\n// \u2500\u2500 Quantity rule (MICRO-TASK 42, sections B and J) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n//   confirmed > 0  \u2192 qty = confirmed\n//   confirmed = 0  \u2192 qty = 0, item does not take part in the purchase\n//   confirmed null \u2192 qty = null + BEK_CONFIRMED_MISSING (blocking)\n// ORDERED is NEVER a fallback.\n\nfunction resolveQuantity(confirmed) {\n  if (confirmed !== null && confirmed !== undefined) {\n    return { qty: confirmed, warnings: [] };\n  }\n  return {\n    qty: null,\n    warnings: [{\n      code: 'BEK_CONFIRMED_MISSING',\n      severity: 'blocking',\n      message: 'CONFIRMED quantity missing or unreadable \u2014 refusing to fall back to ORDERED',\n      field: 'qty_received',\n    }],\n  };\n}\n\nfunction toInt(raw) {\n  const s = cleanDescription(raw);\n  if (!/^-?\\d+$/.test(s)) return null;\n  const n = parseInt(s, 10);\n  return isNaN(n) ? null : n;\n}\n\n// \u2500\u2500 Main parser \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nconst ITEM_CODE_RE = /^\\d{4,8}$/;\nconst ITEM_CELL_COUNT = 8; // ITEM# NAME BRAND PACK/SIZE PRICE ORDERED CONFIRMED STATUS\n\nfunction parse(rawHtml, opts) {\n  const options = opts || {};\n  const html = String(rawHtml || '');\n  const docText = htmlToText(html);\n  const warnings = [];\n\n  const salesOrder   = extractSalesOrder(docText, options.subject);\n  const deliveryDate = extractDeliveryDate(docText);\n  const orderTotal   = extractOrderTotal(docText);\n  const hasDisclaimer = DISCLAIMER_RE.test(docText);\n  const buyerEmail = extractBuyerEmail(docText);\n  const buyerClass = classifyBuyer(buyerEmail);\n\n  const items = [];\n  for (const cells of extractRows(html)) {\n    if (cells.length < ITEM_CELL_COUNT) continue;\n    const text = cells.map(htmlToText);\n    const itemCode = text[0];\n    if (!ITEM_CODE_RE.test(itemCode)) continue;\n\n    const priceM = text[4].match(/\\$?\\s*([\\d,]+\\.\\d{2})/);\n    const unitPrice = priceM ? parsePrice(priceM[1]) : null;\n    const ordered   = toInt(text[5]);\n    const confirmed = toInt(text[6]);\n    const { status_raw, status } = normalizeStatus(text[7]);\n    const { qty, warnings: qtyWarnings } = resolveQuantity(confirmed);\n\n    const lineWarnings = qtyWarnings.slice();\n    if (unitPrice === null) {\n      lineWarnings.push({\n        code: 'BEK_PRICE_MISSING', severity: 'blocking',\n        message: `No unit price found for item ${itemCode}`, field: 'unit_price',\n      });\n    }\n    if (status === 'unknown' && status_raw) {\n      lineWarnings.push({\n        code: 'BEK_STATUS_UNKNOWN', severity: 'blocking',\n        message: `Unrecognised item status \"${status_raw}\" for item ${itemCode}`, field: 'status',\n      });\n    }\n    // Informational only \u2014 a short delivery must still import (section B).\n    if (ordered !== null && qty !== null && qty > 0 && ordered !== qty) {\n      lineWarnings.push({\n        code: 'BEK_QTY_SHORT', severity: 'info',\n        message: `Ordered ${ordered}, confirmed ${qty} for item ${itemCode} \u2014 recording ${qty}`,\n        field: 'qty_received',\n      });\n    }\n\n    // purchasable drives BOTH invoice_lines and price intelligence: an\n    // item nobody confirmed was not bought, so it must never move a\n    // price (MICRO-TASK 42, section E). The row still stays in\n    // parsed_json so the document remains complete and auditable.\n    const purchasable = qty !== null && qty > 0;\n\n    items.push({\n      vendor_sku:       itemCode,\n      raw_description:  text[1],\n      description:      cleanDescription(text[1]),\n      brand:            text[2],\n      pack_description: text[3],\n      unit_price:       unitPrice,\n      qty_ordered:      ordered,\n      qty_received:     qty,\n      qty:              qty,\n      purchasable:      purchasable,\n      item_status:      status,\n      item_status_raw:  status_raw,\n      price_type:       'per_case',\n      amount: (unitPrice !== null && qty !== null) ? round2(unitPrice * qty) : null,\n      warnings: lineWarnings,\n    });\n  }\n\n  const documentClass = classifyDocument(items);\n\n  // \u2500\u2500 The two totals (MICRO-TASK 42, section C) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n  let orderedSum = 0, purchaseSum = 0, orderedComputable = items.length > 0;\n  for (const it of items) {\n    if (it.unit_price === null || it.qty_ordered === null) orderedComputable = false;\n    else orderedSum += it.unit_price * it.qty_ordered;\n    if (it.purchasable && it.amount !== null) purchaseSum += it.amount;\n  }\n  const computedOrderTotal    = orderedComputable ? round2(orderedSum) : null;\n  const computedPurchaseTotal = items.length ? round2(purchaseSum) : null;\n\n  // \u2500\u2500 Parser integrity: ORDERED sum vs vendor-declared Order Total \u2500\u2500\u2500\n  // Measured on 4 real documents: delta 0.00 every time. Tolerance is\n  // the project-wide $0.02, never a new percentage.\n  let reconciled = false;\n  if (orderTotal !== null && computedOrderTotal !== null) {\n    const delta = Math.abs(computedOrderTotal - orderTotal);\n    if (delta > RECONCILIATION_TOLERANCE) {\n      warnings.push({\n        code: 'DOC-TOTAL-001', severity: 'blocking',\n        message: `Ordered lines sum $${computedOrderTotal.toFixed(2)} but declared Order Total is $${orderTotal.toFixed(2)} \u2014 possible missing or misread lines`,\n        sum_of_lines: computedOrderTotal,\n        declared_total: orderTotal,\n      });\n    }\n    // Judged here either way, so the generic checkTotals must not\n    // re-judge it against the purchase sum (which legitimately differs\n    // on a short delivery).\n    reconciled = true;\n  }\n\n  if (!salesOrder) {\n    warnings.push({\n      code: 'BEK_NO_SALES_ORDER', severity: 'blocking',\n      message: 'Sales Order number not found in email HTML or subject',\n    });\n  }\n  if (items.length === 0) {\n    // Mirrors Fruge's PARSE_ERROR_NO_LINES guard (MICRO-TASK 34).\n    warnings.push({\n      code: 'PARSE_ERROR_NO_LINES', severity: 'blocking',\n      message: 'No item rows found in Ben E. Keith Order Confirmation HTML',\n    });\n  }\n  if (documentClass === DOC_CLASS_AMBIGUOUS && items.length > 0) {\n    warnings.push({\n      code: 'BEK_CLASS_AMBIGUOUS', severity: 'blocking',\n      message: 'No item confirmed, but statuses are not uniformly \"Requested\" \u2014 cannot decide whether this is a pre-confirmation acknowledgement or a failed order',\n      statuses: items.map(i => i.item_status_raw),\n    });\n  }\n\n  return {\n    vendor:          'Ben E. Keith',\n    document_type:   'order_confirmation',\n    document_class:  documentClass,\n    document_number: salesOrder,\n    document_date:   deliveryDate,\n    delivery_date:   deliveryDate,\n    // subtotal stays null on purpose: publishing our own computed sum\n    // here would make checkTotals compare the sum against itself.\n    subtotal:        null,\n    total:           orderTotal,\n    computed_order_total:    computedOrderTotal,\n    computed_purchase_total: computedPurchaseTotal,\n    // MICRO-TASK 48 \u2014 who placed this order. `buyer_class` is the\n    // decision; `buyer_email` is kept as the evidence behind it.\n    buyer_email:  buyerEmail,\n    buyer_class:  buyerClass,\n    // Diagnostic evidence, never a classification input.\n    has_confirmation_disclaimer: hasDisclaimer,\n    // Tells the shared checkTotals this parser already reconciled its own\n    // totals. Generic flag \u2014 not a vendor special case.\n    totals_reconciled: reconciled,\n    items,\n    warnings,\n  };\n}\n\n// \u2500\u2500 Purchasable document types (MICRO-TASK 42, section I) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Lives HERE, in the BEK module, because BEK is the only reason the rule\n// is not simply \"invoice\". vendor-parsers/index.js re-exports it, the\n// Edge Function reaches it through loadParsers(), and the browser through\n// window.BekOrderConfirmationParser \u2014 one definition, three runtimes, no\n// divergent copies.\n//\n// TRUE for:\n//   1. any vendor's invoice (unchanged behaviour)\n//   2. Ben E. Keith order_confirmation \u2014 BEK sends no separate invoice,\n//      so the confirmation IS the operational purchase document\n//\n// Deliberately NOT true for any other vendor's order_confirmation:\n// Hardie's and FreshPoint confirmations are followed by a real invoice,\n// and treating them as purchases would double-count.\nconst BEK_VENDOR_RE = /^(?:ben\\s*e\\.?\\s*keith|bek)$/i;\n\nfunction isBenEKeith(vendor) {\n  return BEK_VENDOR_RE.test(String(vendor == null ? '' : vendor).trim());\n}\n\nfunction isPurchasableDocument(vendor, documentType) {\n  if (documentType === 'invoice') return true;\n  if (documentType === 'order_confirmation' && isBenEKeith(vendor)) return true;\n  return false;\n}\n\nconst API = {\n  parse,\n  classifyDocument,\n  classifyBuyer,\n  extractBuyerEmail,\n  normalizeBuyerEmail,\n  BEK_BUYER_KITCHEN,\n  BEK_BUYER_FOH,\n  BUYER_KITCHEN,\n  BUYER_EXCLUDED,\n  BUYER_UNKNOWN,\n  isPurchasableDocument,\n  isBenEKeith,\n  extractRows,\n  htmlToText,\n  decodeEntities,\n  normalizeStatus,\n  resolveQuantity,\n  parseDate,\n  parsePrice,\n  DOC_CLASS_ACK,\n  DOC_CLASS_OPERATION,\n  DOC_CLASS_AMBIGUOUS,\n  RECONCILIATION_TOLERANCE,\n};\n\nif (typeof module !== 'undefined' && module.exports) {\n  module.exports = API;\n}\nif (typeof window !== 'undefined') {\n  window.BekOrderConfirmationParser = API;\n}\n",
  "walmart-trevipay-invoice": "// \u2500\u2500 vendor-parsers/walmart-trevipay-invoice.js \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Parser for Walmart Business / TreviPay INVOICE\n//\n// Input contract: this parser receives text ALREADY normalized by the\n// TreviPay-specific preprocessing introduced in commit 8325ed5\n// (vdrNormalizeTreviPayPage in vendor-documents-review.js) \u2014 Private Use\n// Area digit/decimal/minus codepoints already decoded, gap-aware column\n// join already applied. This file does NOT re-implement PUA decoding,\n// gap-aware joins, or any PDF.js extraction \u2014 those responsibilities\n// belong exclusively to the normalizer. It only ever consumes a plain\n// string via parse(rawText), same as every other vendor parser.\n//\n// Real-document audit findings this parser is built against (4 real\n// TreviPay invoices: c51dd720 Kitchen, 6c246fda/12fd6860/30082536 Bar \u2014\n// the latter 3 used strictly as technical PDF-format samples):\n//\n// - Header fields (Invoice #, Buyer, Seller, dates, Order Number, totals)\n//   are printed by a fixed template, but table-layout artifacts merge\n//   unrelated columns onto the same output line in a few specific,\n//   repeatable spots (e.g. the Bill-To address's \"United States\" line\n//   ends up sharing a row with the Buyer value) \u2014 handled by anchoring\n//   extraction to the surrounding fixed boilerplate text, not raw\n//   position.\n// - The item table can repeat its column header (\"SKU Description\n//   Quantity...\") more than once when it spans multiple PDF pages\n//   (confirmed real in 30082536) \u2014 handled by re-entering table-scan\n//   mode on every occurrence, not just the first.\n// - A SKU can wrap onto a second physical line as a short digit-only\n//   fragment (confirmed real in c51dd720: \"1350811700\" / \"5\" \u2192\n//   \"13508117005\") \u2014 handled by a narrow, bounded structural rule (Part\n//   E), never a hardcoded value.\n// - Tax is optional per line (\"Tax1 X.XXXX%\" + a dollar amount) and can\n//   be non-zero (confirmed real in 6c246fda/12fd6860).\n// - Two known non-ingredient row types exist and must be preserved for\n//   reconciliation without ever being treated as purchasable products:\n//   \"Shipping\" rows, and a single \"ALT_PAYMENT_METHODS\" adjustment row\n//   (confirmed real in 6c246fda, negative amount, its own SKU-column\n//   text wraps across 3 short fragments \u2014 reconstructing that exact\n//   fragmented text buys nothing, so a fixed canonical label is used\n//   once the row is recognised by its stable \"ALT_PAYME\" lead fragment).\n\n'use strict';\n\nconst { parseDate, parsePrice, cleanDescription } = require('./utils');\n\n// \u2500\u2500 Header field extraction \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nfunction firstMatch(text, re) {\n  const m = text.match(re);\n  return m ? m[1].trim() : null;\n}\n\n// \"Buyer\" the label and its value never sit on the same output line \u2014\n// the Bill-To address block's line count varies relative to the\n// Buyer/Seller block, so by the time both reach the same PDF row, the\n// merge always lands on the Bill-To address's own \"United States\" line\n// (confirmed identical in all 4 real samples). A bare \"United States\"\n// line (the Seller's own address, further down) has nothing after it,\n// so requiring trailing content here is what keeps this from ever\n// matching the Seller's country line instead.\n//\n// FIX (empty-Buyer parity task): the gap between \"United States\" and\n// the value must be horizontal whitespace only ([ \\t]+), never \\s+ \u2014\n// \\s matches newlines too, so when the Buyer field is genuinely blank\n// (nothing after \"United States\" on its own line), \\s+ silently walked\n// forward across the line break and grabbed whatever non-blank text\n// came next (e.g. \"Seller\", or later boilerplate) instead of failing to\n// match. With the gap restricted to the same physical line, a blank\n// field now correctly yields no match at all \u2192 buyer stays null, never\n// inferred from Seller/Walmart Business/Group or any other nearby label.\nfunction extractBuyer(text) {\n  return firstMatch(text, /United States[ \\t]+(\\S.+)$/m);\n}\n\nfunction valueAfterLabel(lines, label) {\n  for (let i = 0; i < lines.length - 1; i++) {\n    if (lines[i].trim() === label) return lines[i + 1].trim();\n  }\n  return null;\n}\n\nfunction extractHeader(text, lines) {\n  const documentNumber =\n    firstMatch(text, /Please Reference Invoice\\s+(\\S+)\\s*\\|/i) ||\n    firstMatch(text, /Invoice\\s+(\\S+)\\s+(?:How To Pay|Invoice Summary)/i);\n\n  const invoiceDate = parseDate(valueAfterLabel(lines, 'Invoice Date'));\n  const dueDate     = parseDate(valueAfterLabel(lines, 'Due Date'));\n  const seller      = valueAfterLabel(lines, 'Seller') || 'Walmart Business';\n  const buyer       = extractBuyer(text);\n\n  // \"Order Number PO Number\" is the label row; its value row is two\n  // whitespace-separated tokens (\"-\" means no PO number on this invoice).\n  let walmartOrderNumber = null;\n  let poNumber = null;\n  const labelIdx = lines.findIndex(l => /^Order Number\\s+PO Number$/.test(l.trim()));\n  if (labelIdx > -1 && lines[labelIdx + 1]) {\n    const valueLine = lines[labelIdx + 1].trim();\n    const m = valueLine.match(/^(\\S+)\\s+(\\S+)$/);\n    if (m) {\n      walmartOrderNumber = m[1];\n      poNumber = m[2] === '-' ? null : m[2];\n    } else {\n      walmartOrderNumber = valueLine || null;\n    }\n  }\n\n  const subtotal = parsePrice(firstMatch(text, /Pre-Tax Subtotal\\s+\\$(-?[\\d,.]+)/i));\n  const tax      = parsePrice(firstMatch(text, /Taxes Subtotal\\s+\\$(-?[\\d,.]+)/i));\n  const total    = parsePrice(firstMatch(text, /Total Due as of\\s+[\\d/]+\\s+\\$(-?[\\d,.]+)/i));\n\n  return { documentNumber, invoiceDate, dueDate, seller, buyer, walmartOrderNumber, poNumber, subtotal, tax, total };\n}\n\n// \u2500\u2500 Line items \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nconst HEADER_ROW_RE   = /^SKU\\s+Description\\s+Quantity/;\n// MICRO-TASK 56 \u2014 the two continuation shapes that belong to the Tax\n// Details column rather than to the product description. See the two\n// call sites in extractItems() for the real-document census.\nconst TAX_CELL_LINE_RE = /^Tax\\d+\\s+-?\\$[\\d,.]+$/;\nconst PCT_ONLY_LINE_RE = /^[\\d.]+%$/;\nconst SUMMARY_ROW_RE  = /Invoice Summary/;\n// \u2500\u2500 MARKER:WALMART_SKU_FRAGMENT_START \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// A wrapped SKU continuation is a line containing ONLY digits, nothing\n// else \u2014 real example: \"1350811700\" then, alone on the next physical\n// line, \"5\". Bounded to 1\u20134 digits (the only real example is 1 digit;\n// this leaves headroom without being loose enough to ever swallow a\n// genuine 5+ digit SKU that starts its own row) and only merges into a\n// row whose own SKU is itself purely numeric (never onto a Shipping/\n// ALT_PAYMENT_METHODS row, whose SKU is text) and only up to a sane\n// total reconstructed length \u2014 real UPC/EAN-style codes top out at 13\n// digits, so 14 is used as a hard ceiling.\nconst SKU_FRAGMENT_RE = /^\\d{1,4}$/;\nconst MAX_RECONSTRUCTED_SKU_LEN = 14;\n\nfunction isSkuFragmentContinuation(line, currentItem) {\n  if (!SKU_FRAGMENT_RE.test(line)) return false;\n  if (!currentItem || currentItem.line_type !== 'product') return false;\n  if (!/^\\d+$/.test(currentItem.vendor_sku)) return false;\n  return (currentItem.vendor_sku.length + line.length) <= MAX_RECONSTRUCTED_SKU_LEN;\n}\n// \u2500\u2500 MARKER:WALMART_SKU_FRAGMENT_END \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\n// Trailing numeric columns. The optional \"Tax Details\" column only ever\n// contributes its percentage (e.g. \"0.0824%\") to the FIRST continuation\n// line, never to the row-start line itself \u2014 confirmed real in\n// 6c246fda/12fd6860: the row-start line only ever contains \"...Tax1\"\n// followed directly by the SAME dollar amount twice (once for the Tax\n// Details column's own dollar sub-total, once for the aggregate Tax\n// column) and then Billed Total. The percentage is picked up separately,\n// from the continuation line, in extractItems() below.\n//\n// Every dollar column captures its sign SEPARATELY from its magnitude\n// (real data prints negative amounts as \"-$21.26\" \u2014 minus before the\n// dollar sign, e.g. the ALT_PAYMENT_METHODS adjustment \u2014 not \"$-21.26\").\nconst SIGNED_MONEY = '(-?)\\\\$([\\\\d,.]+)';\n// MICRO-TASK 55 \u2014 the Tax Details column label is NOT always the\n// literal \"Tax1\". Four shapes are confirmed real:\n//   \"Tax1\"            (6c246fda, f4786197 row 1)\n//   \"Tax2\"            (748cc643 x3, d19bdab1 x4)\n//   \"Tax1 8.28%\"      (659ae123 x2 \u2014 the rate prints INLINE on the\n//                      row-start line instead of wrapping)\n//   \"7ad525ee-\"       (f4786197 row 3 \u2014 an opaque tax-code fragment)\n// Hardcoding \"Tax1\" made every other shape fail BOTH tail patterns, so\n// the whole product row fell through to continuation handling and was\n// silently swallowed into the previous row's description \u2014 losing\n// $53.34 of $61.16 on 748cc643 and $15.49 on 659ae123.\n//\n// What is matched instead is the structural invariant that holds in all\n// four: one to three NON-MONEY tokens sitting between the Discount\n// amount and the final three dollar columns. Excluding \"$\" from the\n// token class is what keeps this fail-closed \u2014 a row with no Tax\n// Details column has only FOUR trailing dollar amounts and can never\n// satisfy the FIVE this shape requires, so it still falls through to\n// TAIL_PLAIN exactly as before. Both quantifiers are lazy and bounded\n// and the token classes are disjoint, so there is no ambiguous\n// backtracking (MICRO-TASK 44/45).\nconst TAXDETAIL_LABEL = '((?:[^\\\\s$]+\\\\s+){1,3}?)';\nconst TAIL_WITH_TAXDETAIL = new RegExp(\n  '^(.*?)\\\\s+(\\\\d+)\\\\s+' + SIGNED_MONEY + '\\\\s+' + SIGNED_MONEY +\n  '\\\\s+' + TAXDETAIL_LABEL + SIGNED_MONEY + '\\\\s+' + SIGNED_MONEY + '\\\\s+' + SIGNED_MONEY + '\\\\s*$'\n);\nconst TAIL_PLAIN = new RegExp(\n  '^(.*?)\\\\s+(\\\\d+)\\\\s+' + SIGNED_MONEY + '\\\\s+' + SIGNED_MONEY +\n  '\\\\s+' + SIGNED_MONEY + '\\\\s+' + SIGNED_MONEY + '\\\\s*$'\n);\n\nfunction signedPrice(sign, magnitude) {\n  const n = parsePrice(magnitude);\n  return n === null ? null : (sign === '-' ? -n : n);\n}\n\nfunction parseRowStart(line) {\n  let m = line.match(TAIL_WITH_TAXDETAIL);\n  let hasTaxDetail = false;\n  if (m) {\n    hasTaxDetail = true;\n  } else {\n    m = line.match(TAIL_PLAIN);\n  }\n  if (!m) return null;\n\n  const skuAndDesc = m[1].trim();\n  const qty        = parseInt(m[2], 10);\n  let unitPrice, discount, tax, amount;\n  if (hasTaxDetail) {\n    // groups: 1 desc, 2 qty, 3/4 unit_price, 5/6 discount,\n    // 7 tax-detail label (unused), 8/9 tax-detail sub-total (unused),\n    // 10/11 tax, 12/13 billed_total\n    unitPrice = signedPrice(m[3], m[4]);\n    discount  = signedPrice(m[5], m[6]);\n    tax       = signedPrice(m[10], m[11]);\n    amount    = signedPrice(m[12], m[13]);\n  } else {\n    // groups: 1 desc, 2 qty, 3/4 unit_price, 5/6 discount, 7/8 tax, 9/10 billed_total\n    unitPrice = signedPrice(m[3], m[4]);\n    discount  = signedPrice(m[5], m[6]);\n    tax       = signedPrice(m[7], m[8]);\n    amount    = signedPrice(m[9], m[10]);\n  }\n\n  // Known non-product placeholder rows (same real-template convention as\n  // Shipping/ALT_PAYMENT_METHODS above), confirmed real in invoice\n  // 26104552: an Express Fee (HANDLING) and, appearing multiple times,\n  // a SubDown/FULFILL_VARIANCE fulfillment-substitution charge. Checked\n  // against the FULL skuAndDesc blob, not the generic single-token split\n  // below \u2014 unlike \"Shipping\" or \"ALT_PAYME\", their SKU-column\n  // placeholder is itself multi-word (\"Express Fee\"), so splitting on\n  // the first space alone would wrongly cut it as \"Express\" + \"Fee\n  // HANDLING\". Before this fix, neither shape matched any recognised\n  // row-start, so both fell through to continuation handling and were\n  // silently absorbed into the PRECEDING product row's description \u2014\n  // losing $1.93/$10.29/$14.65 as structured line items and corrupting\n  // that product's own description (confirmed against the real PDF).\n  const handlingMatch = skuAndDesc.match(/^(Express\\s+Fee)\\s+(HANDLING)$/i);\n  const fulfillVarianceMatch = skuAndDesc.match(/^(SubDown)\\s+(FULFILL_VARIANCE)$/i);\n\n  let lineType, vendorSku, description;\n  if (handlingMatch) {\n    lineType = 'handling';\n    vendorSku = handlingMatch[1];\n    description = handlingMatch[2];\n  } else if (fulfillVarianceMatch) {\n    lineType = 'fulfillment_variance';\n    vendorSku = fulfillVarianceMatch[1];\n    description = fulfillVarianceMatch[2];\n  } else {\n    const tokenMatch = skuAndDesc.match(/^(\\S+)\\s+(.*)$/);\n    if (!tokenMatch) return null;\n    const leadToken  = tokenMatch[1];\n    const descFirst  = tokenMatch[2].trim();\n\n    lineType = 'product';\n    vendorSku = leadToken;\n    description = descFirst;\n\n    if (/^shipping$/i.test(leadToken)) {\n      lineType = 'shipping';\n    } else if (/^ALT_PAYME/i.test(leadToken)) {\n      // See file header comment: the SKU-column text for this row wraps\n      // across several short fragments across multiple lines; only the\n      // stable lead fragment is used for detection. Reconstructing the\n      // exact wrapped spelling is not attempted \u2014 a fixed canonical label\n      // is used instead, since it is always this same placeholder text.\n      lineType = 'adjustment';\n      vendorSku = 'ALT_PAYMENT_METHODS';\n      description = 'Alternative Payment Methods';\n    } else if (!/^\\d{5,}$/.test(leadToken)) {\n      // Not a recognised row-start shape at all (neither a 5+ digit SKU,\n      // Shipping, the adjustment placeholder, nor Handling/Fulfillment\n      // Variance) \u2014 reject so the caller falls through to continuation\n      // handling instead of misfiling unrelated text as a new product row.\n      return null;\n    }\n  }\n\n  return {\n    vendor_sku:       vendorSku,\n    raw_description:  description,\n    description:      description,\n    qty_ordered:      qty,\n    qty_received:     qty,\n    qty:              qty,\n    unit_price:       unitPrice,\n    discount:         discount || 0,\n    tax:              tax || 0,\n    tax_rate:         null,\n    amount:           amount,\n    line_total:       amount,\n    line_type:        lineType,\n    warnings:         [],\n    // Adjustment row's SKU-column wrap fragments (\"NT_METHO Methods\",\n    // \"DS\") are swallowed, never appended to description \u2014 see file\n    // header comment.\n    _swallowContinuation: lineType === 'adjustment',\n    _descParts: [description],\n  };\n}\n\n// Deterministic pack/weight extraction from the free-text description.\n// Conservative by design \u2014 three explicit safety rules:\n//   1. A catch-weight RANGE shape (\"1.50-4.30 lb\" / \"2.75  7.0 lb\",\n//      confirmed real in 26104552 \u2014 the gap between the two numbers is a\n//      dash, the unmapped PUA hyphen-like glyph from the normalizer, or\n//      plain whitespace, never more than a few characters) is now\n//      PRESERVED as a visible display string (\"1.50-4.30lb Tray\") \u2014 a\n//      real, useful fact for Chef to see, since it's genuinely printed on\n//      the invoice \u2014 but is NEVER treated as a real single purchased\n//      weight. Safety is enforced explicitly downstream, not by omitting\n//      the value here: vdrPackToGrams/vdrCalcPack (js/vendor-documents-\n//      review.js) both run an unconditional isWeightRangePack() guard\n//      before any other pattern, so this string can never be converted\n//      to grams by accident \u2014 extracting neither endpoint as \"the\"\n//      weight, deliberately different from the single-weight case below.\n//   2. \"Each\"-sold items (Watermelon, Zucchini) are marked as such in\n//      pack_description but NEVER converted to an assumed weight \u2014 no\n//      invented average/density. Downstream grams/cost-per-100g stay\n//      unknown for these, by construction (vdrPackToGrams has no \"Each\"\n//      pattern today).\n//   3. Gallon (Milk) is recognised and preserved as a canonical pack\n//      string (\"1gal\") but is NOT converted to grams here \u2014 no\n//      production-validated volume\u2192mass density rule exists for Milk\n//      in this codebase; vdrPackToGrams has no plain \"gal\" pattern\n//      either (only mixed-fraction \"N-N/N GAL\"), so this stays inert\n//      by construction too, exactly as intended.\n// Never touches raw_description/description \u2014 this only ever adds the\n// separate pack_description field.\nconst WALMART_PACK_RANGE_RE  = /(\\d+(?:\\.\\d+)?)\\D{1,4}(\\d+(?:\\.\\d+)?)\\s*(oz|lb)\\b\\.?\\s*(Tray)?/i;\nconst WALMART_PACK_GAL_RE    = /(\\d+(?:\\.\\d+)?)?\\s*gal(?:lon)?\\b/i;\nconst WALMART_PACK_WEIGHT_RE = /(\\d+(?:\\.\\d+)?)\\s*(oz|lb)\\b/i;\nconst WALMART_PACK_EACH_RE   = /\\beach\\b/i;\n\nfunction extractWalmartPack(description) {\n  if (!description) return null;\n  const rangeMatch = description.match(WALMART_PACK_RANGE_RE);\n  if (rangeMatch) {\n    const [, num1, num2, unit, tray] = rangeMatch;\n    return num1 + '-' + num2 + unit.toLowerCase() + (tray ? ' Tray' : '');\n  }\n  const galMatch = description.match(WALMART_PACK_GAL_RE);\n  if (galMatch) return (galMatch[1] || '1') + 'gal';\n  const weightMatch = description.match(WALMART_PACK_WEIGHT_RE);\n  if (weightMatch) return weightMatch[1] + weightMatch[2].toLowerCase();\n  if (WALMART_PACK_EACH_RE.test(description)) return 'Each';\n  return null;\n}\n\nfunction finalizeItem(item) {\n  if (!item._swallowContinuation && item._descParts.length > 1) {\n    item.raw_description = cleanDescription(item._descParts.join(' '));\n    item.description = item.raw_description;\n  }\n  delete item._descParts;\n  delete item._swallowContinuation;\n  // Pack extraction only for real product rows \u2014 Shipping/adjustment/\n  // handling/fulfillment_variance descriptions (\"SHIPPING\", \"Alternative\n  // Payment Methods\", \"HANDLING\", \"FULFILL_VARIANCE\") never match any of\n  // the patterns above anyway, but scoping explicitly to 'product' keeps\n  // intent unambiguous.\n  item.pack_description = item.line_type === 'product' ? extractWalmartPack(item.description) : null;\n  return item;\n}\n\nfunction extractItems(lines) {\n  const items = [];\n  let current = null;\n  let inTable = false;\n\n  for (const rawLine of lines) {\n    const line = rawLine.trim();\n    if (!line) continue;\n\n    if (HEADER_ROW_RE.test(line)) {\n      // Re-entering table mode is safe even if we were already in it\n      // (a document whose table spans multiple PDF pages repeats this\n      // header once per page \u2014 confirmed real in 30082536).\n      inTable = true;\n      continue;\n    }\n    if (!inTable) continue;\n    if (SUMMARY_ROW_RE.test(line)) {\n      inTable = false;\n      continue;\n    }\n\n    if (isSkuFragmentContinuation(line, current)) {\n      current.vendor_sku += line;\n      continue;\n    }\n\n    const rowStart = parseRowStart(line);\n    if (rowStart) {\n      if (current) items.push(finalizeItem(current));\n      current = rowStart;\n      continue;\n    }\n\n    // Neither a new row nor a SKU fragment \u2192 wrapped description text\n    // continuing the current row (or swallowed, for the adjustment row).\n    if (current && !current._swallowContinuation) {\n      // The optional \"Tax Details\" percentage (e.g. \"0.0824%\") wraps\n      // onto whichever continuation line happens to be first \u2014 real\n      // geometry confirmed in 6c246fda/12fd6860. It always sits at the\n      // very end of that line; strip it out before treating the rest\n      // (if any) as further description text, so it never becomes part\n      // of the ingredient description itself.\n      // MICRO-TASK 56 \u2014 a continuation line that is ENTIRELY a Tax\n      // Details cell belongs to that column, never to the product\n      // description. Confirmed by census over all 21 real Walmart\n      // documents: the shape \"Tax<n> $<amount>\" occurs exactly 3 times\n      // (748cc643 \"Tax1 $3.16\", d19bdab1 \"Tax1 $1.80\", f4786197\n      // \"Tax2 $0.29\") and every one of them is the SECOND tax detail of\n      // a row that already carries one; ZERO continuation lines of any\n      // other kind contain a \"$\" at all. Anchored at both ends so a\n      // description that merely mentions a price can never match.\n      if (TAX_CELL_LINE_RE.test(line)) continue;\n\n      const pctMatch = line.match(/^(.*?)\\s*([\\d.]+)%$/);\n      if (pctMatch && current.tax_rate === null) {\n        // The printed number (e.g. \"0.0824\") already equals the tax rate\n        // as a fraction of 1 (0.0824 = 8.24%) \u2014 confirmed by cross-\n        // checking against the real tax dollar amounts (e.g. 6c246fda\n        // row 1: $3.29 / (2 \u00d7 $19.97) = 0.0824). No further scaling.\n        current.tax_rate = parseFloat(pctMatch[2]);\n        const remainder = pctMatch[1].trim();\n        if (remainder) current._descParts.push(remainder);\n        continue;\n      }\n      // MICRO-TASK 56 \u2014 the companion of the rule above: the SECOND tax\n      // detail also prints its own rate, alone on its line. Reached only\n      // when tax_rate is already set (the first rate is consumed by the\n      // branch above), and only for a line that is a bare percentage and\n      // nothing else. Both conditions matter: a real product percentage\n      // never arrives alone on a line \u2014 the one real example, 6c246fda's\n      // \"oz Aluminum Cans 0.5%\" ABV beer, carries product words on the\n      // same line and so still reaches the description untouched.\n      if (current.tax_rate !== null && PCT_ONLY_LINE_RE.test(line)) continue;\n      current._descParts.push(line);\n    }\n  }\n  if (current) items.push(finalizeItem(current));\n  return items;\n}\n\n// \u2500\u2500 Parse a document \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nfunction parse(rawText) {\n  const text  = String(rawText || '');\n  const lines = text.split('\\n');\n\n  const header = extractHeader(text, lines);\n  const items  = extractItems(lines);\n  const warnings = [];\n\n  if (!items.length) warnings.push({ code: 'PARSE_ERROR', message: 'No line items found' });\n\n  return {\n    vendor:                'Walmart Business',\n    document_type:         'invoice',\n    document_number:       header.documentNumber,\n    invoice_number:        header.documentNumber, // alias \u2014 matches sibling invoice parsers' naming\n    invoice_date:          header.invoiceDate,\n    due_date:              header.dueDate,\n    buyer:                 header.buyer,\n    seller:                header.seller,\n    walmart_order_number:  header.walmartOrderNumber,\n    po_number:             header.poNumber,\n    subtotal:              header.subtotal,\n    tax:                   header.tax,\n    total:                 header.total,\n    items,\n    warnings,\n  };\n}\n\nmodule.exports = { parse };\n",
  "bek-post-parse-safety": "// \u2500\u2500 vendor-parsers/bek-post-parse-safety.js \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// MICRO-TASK 81 \u2014 LA DECISIONE BEK POST-PARSE, IN UN POSTO SOLO.\n//\n// Perche' questo file esiste\n// --------------------------\n// Dopo che un documento Ben E. Keith e' stato parsato, quello che gli\n// succede non dipende solo dal testo: dipende dallo STATO DEL DATABASE \u2014\n// chi altro porta lo stesso Sales Order, in che stato, di che classe. Quella\n// decisione viveva solo dentro Phase A del worker (index.ts, sezione F di\n// MT42 piu' il buyer guard di MT48). Il percorso di reprocess della UI, che\n// riparsa lo stesso documento e riscrive le stesse colonne, non la eseguiva\n// affatto: MT80 ha misurato che cancellava le warning di stato senza\n// rigenerarle.\n//\n// Copiare la sezione F nel browser avrebbe creato la quarta copia di una\n// decisione che questo progetto ha gia' pagato tre volte (MT76 projection,\n// MT78 regex del fallback, MT79 gate blocking). Quindi la decisione sta qui,\n// una volta sola, e i due percorsi la chiamano.\n//\n// Contratto\n// ---------\n// DECISION-ONLY. Questa funzione LEGGE il database e non scrive mai: niente\n// update, niente invoice_lines, niente cambi di status, niente storage.\n// Restituisce un verdetto strutturato; le scritture restano di chi chiama,\n// perche' i due caller scrivono in modo legittimamente diverso (Phase A\n// esce con un outcome e tocca lo Storage, il reprocess accumula in un\n// UPDATE solo).\n//\n// Le warning che produce sono SOLO quelle state-derived: quelle che\n// descrivono il rapporto del documento con il resto del database e che\n// nessun riparse potrebbe ricostruire da solo. Le warning del parser\n// (OQR-*, BEK_CLASS_AMBIGUOUS, BEK_QTY_SHORT, ...) restano al parser e al\n// caller, che le tiene accanto a queste.\n//\n// Ricalcolo, non conservazione\n// ----------------------------\n// Il verdetto si deriva sempre dallo stato ATTUALE. Un\n// BEK_REVISION_AFTER_IMPORT esiste se e solo se in questo momento esiste\n// ancora un fratello 'imported'; un BEK_REVISION_UNKNOWN esiste se e solo\n// se in questo momento la classificazione resta incerta. Una warning\n// vecchia non sopravvive perche' c'era.\n//\n// Caricamento: stesso schema del parser canonico \u2014 module.exports per Node\n// e per il loader CJS del worker (PARSER_SOURCES), window.* per il browser,\n// dove index.html lo carica prima di vendor-documents-review.js.\n// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\n'use strict';\n\n// L'API del parser canonico (classifyBuyer, isBenEKeith, le costanti buyer).\n// Risolta pigramente: nel browser il <script> del parser e' caricato prima,\n// ma leggerlo a tempo di definizione legherebbe questo file all'ordine degli\n// script invece che all'ordine delle chiamate.\nfunction canon() {\n  if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {\n    return require('./ben-e-keith-order-confirmation');\n  }\n  if (typeof window !== 'undefined' && window.BekOrderConfirmationParser) {\n    return window.BekOrderConfirmationParser;\n  }\n  throw new Error('bek-post-parse-safety: parser canonico Ben E. Keith non disponibile');\n}\n\n// \u2500\u2500 Funzioni pure di rango \u2014 MICRO-TASK 64/65, spostate qui da index.ts \u2500\u2500\n// Erano dichiarate solo nel worker, che e' precisamente il motivo per cui il\n// browser non poteva prendere la stessa decisione. Il corpo e' invariato.\n\nfunction bekHasConfirmedQty(parsedDoc) {\n  const items = (parsedDoc && Array.isArray(parsedDoc.items)) ? parsedDoc.items : [];\n  return items.some((i) => {\n    const c = i && (i.qty_received !== undefined && i.qty_received !== null ? i.qty_received : i.qty);\n    return Number(c) > 0;\n  });\n}\n\n// Il rango di una revisione e' il suo TIPO, non il suo valore economico.\n// classifyDocument() deriva la classe SOLO dalle righe articolo, mai dalla\n// prosa. Qualunque classe fuori da questa tabella ha rango null = incerta.\nconst BEK_CLASS_RANK = {\n  operational_confirmation: 2,\n  acknowledgement:          1,\n};\n\nfunction bekRevisionRank(parsedDoc, createdAt) {\n  const cls = parsedDoc && parsedDoc.document_class;\n  let rank = Object.prototype.hasOwnProperty.call(BEK_CLASS_RANK, cls) ? BEK_CLASS_RANK[cls] : null;\n  // Invariante di validazione: un acknowledgement non puo' avere confermati.\n  // Se il parser un giorno si contraddicesse, il documento diventa incerto\n  // invece di essere classato male.\n  if (cls === 'acknowledgement' && bekHasConfirmedQty(parsedDoc)) rank = null;\n  return { cls: cls || null, rank, at: createdAt ? new Date(createdAt).getTime() : 0 };\n}\n\nfunction bekRankIsCertain(r) {\n  return !!r && r.rank !== null && r.rank !== undefined;\n}\n\n// true se `a` deve prevalere su `b`. Mai al buio: se uno dei due non e'\n// classificabile, nessuno supera nessuno.\nfunction bekOutranks(a, b) {\n  if (!bekRankIsCertain(a) || !bekRankIsCertain(b)) return false;\n  if (a.rank !== b.rank) return a.rank > b.rank;\n  return a.at > b.at;\n}\n\n// \u2500\u2500 Buyer: allow-list, fail closed (MICRO-TASK 48) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// BEK serve due flussi d'ordine sullo STESSO Customer#: la cucina e la sala.\n// Su 56 thread reali l'unico campo che li distingue e' la riga `Email:`.\n// Qualunque valore non riconosciuto, o assente, e' 'unknown' e non passa.\nconst BUYER_KITCHEN  = 'kitchen';\nconst BUYER_EXCLUDED = 'excluded';\nconst BUYER_UNKNOWN  = 'unknown';\n\nfunction bekBuyerVerdict(parsed) {\n  const api = canon();\n  const cls = (parsed && parsed.buyer_class) || api.BUYER_UNKNOWN;\n  if (cls === api.BUYER_EXCLUDED) return BUYER_EXCLUDED;\n  if (cls === api.BUYER_KITCHEN)  return BUYER_KITCHEN;\n  return BUYER_UNKNOWN;\n}\n\n// \u2500\u2500 Gli esiti canonici \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Un solo verdetto per documento. E' questo il valore che il test di parita'\n// confronta fra Phase A e reprocess: se i due percorsi producono lo stesso\n// `outcome`, stanno prendendo la stessa decisione, indipendentemente da come\n// poi ciascuno scrive.\nconst OUTCOME = {\n  NOT_BEK:        'not_bek',          // non e' un BEK acquistabile: nessuna decisione\n  BUYER_EXCLUDED: 'buyer_excluded',   // ordine di sala: mai un acquisto di cucina\n  BUYER_UNKNOWN:  'buyer_unknown',    // buyer non riconosciuto: fail closed\n  AFTER_IMPORT:   'after_import',     // il Sales Order ha gia' un acquisto importato\n  REVISION_UNKNOWN: 'revision_unknown', // classe incerta, mia o di un fratello vivo\n  SUPERSEDED:     'superseded',       // un fratello vivo mi supera\n  OPERATIVE:      'operative',        // sono io la revisione operativa\n};\n\nfunction vuoto() {\n  return {\n    applies: false,\n    outcome: OUTCOME.NOT_BEK,\n    buyer: { verdict: null, email: null },\n    revision: { verdict: null, existingDocumentId: null, siblingIds: [], supersedeIds: [], meRank: null },\n    warnings: [],\n    blocking: false,\n    blockingCode: null,\n  };\n}\n\n// \u2500\u2500 LA DECISIONE \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// sb            client Supabase, usato in sola lettura\n// doc           la riga come sta adesso (serve id e created_at)\n// parsed        il parsed_json APPENA prodotto\n// docNumber     il numero gia' risolto dal caller (parser, poi fallback subject)\n// parseRawText  funzione iniettata per parsare il raw_text di un fratello non\n//               ancora parsato. Iniettata e non importata: questo modulo vive\n//               sotto vendor-parsers/ e non deve dipendere dal dispatcher.\nasync function bekDecidePostParse({ sb, doc, parsed, docNumber, parseRawText }) {\n  const api = canon();\n  const p = parsed || {};\n\n  if (!api.isPurchasableDocument(p.vendor, p.document_type) || !api.isBenEKeith(p.vendor)) {\n    return vuoto();\n  }\n\n  const out = vuoto();\n  out.applies = true;\n  out.buyer.email = p.buyer_email || null;\n\n  // 1. BUYER PRIMA DI TUTTO. Un ordine che non e' di cucina non deve\n  //    partecipare alla riconciliazione del Sales Order della cucina,\n  //    nemmeno come fratello superato. L'ordine dei controlli qui e' lo\n  //    stesso di Phase A e non e' negoziabile.\n  const buyer = bekBuyerVerdict(p);\n  out.buyer.verdict = buyer;\n\n  if (buyer === BUYER_EXCLUDED) {\n    out.outcome = OUTCOME.BUYER_EXCLUDED;\n    out.warnings = [{\n      code: 'BEK_BUYER_EXCLUDED', severity: 'info',\n      message: `Order placed by ${p.buyer_email} \u2014 front of house, not a kitchen purchase`,\n      buyer_email: p.buyer_email,\n    }];\n    return out;   // non bloccante: e' un ordine vero, solo non nostro\n  }\n\n  if (buyer !== BUYER_KITCHEN) {\n    out.outcome = OUTCOME.BUYER_UNKNOWN;\n    out.blocking = true;\n    out.blockingCode = 'BEK_BUYER_NOT_ALLOWED';\n    out.warnings = [{\n      code: 'BEK_BUYER_NOT_ALLOWED', severity: 'blocking',\n      message: p.buyer_email\n        ? `Unrecognised Ben E. Keith buyer \"${p.buyer_email}\" \u2014 refusing to guess whether this is a kitchen purchase`\n        : 'Ben E. Keith order confirmation carries no Email: buyer field \u2014 refusing to guess whether this is a kitchen purchase',\n      buyer_email: p.buyer_email || null,\n    }];\n    return out;\n  }\n\n  // 2. RICONCILIAZIONE DELLE REVISIONI. Solo per order_confirmation con un\n  //    numero: senza numero non esiste il gruppo di riconciliazione, e quel\n  //    caso ha gia' la sua barriera (BEK_NO_SALES_ORDER, MT78).\n  if (!docNumber || p.document_type !== 'order_confirmation') {\n    out.outcome = OUTCOME.OPERATIVE;\n    out.revision.verdict = OUTCOME.OPERATIVE;\n    return out;\n  }\n\n  const { data: siblings } = await sb.from('vendor_documents')\n    .select('id,status,created_at,raw_text,parsed_json')\n    .eq('vendor', p.vendor)\n    .eq('document_number', docNumber)\n    .eq('document_type', 'order_confirmation')\n    .neq('id', doc.id);\n\n  const rows = siblings || [];\n  out.revision.siblingIds = rows.map((r) => r.id);\n\n  // 2a. Un acquisto gia' importato per questo Sales Order. FAIL CLOSED, sempre:\n  //     mai un secondo acquisto, mai una riscrittura silenziosa di uno gia'\n  //     contabilizzato. Ricalcolato ogni volta: se il fratello importato non\n  //     ci fosse piu', questa warning non verrebbe prodotta.\n  const alreadyImported = rows.find((r) => r.status === 'imported');\n  if (alreadyImported) {\n    out.outcome = OUTCOME.AFTER_IMPORT;\n    out.revision.verdict = OUTCOME.AFTER_IMPORT;\n    out.revision.existingDocumentId = alreadyImported.id;\n    out.blocking = true;\n    out.blockingCode = 'BEK_REVISION_AFTER_IMPORT';\n    out.warnings = [{\n      code: 'BEK_REVISION_AFTER_IMPORT',\n      severity: 'blocking',\n      message: `Sales Order ${docNumber} already has an imported purchase (document ${alreadyImported.id}). This later revision was NOT imported as a second purchase and the existing one was NOT modified \u2014 reconcile by hand.`,\n      existing_document_id: alreadyImported.id,\n    }];\n    return out;\n  }\n\n  const meRank = bekRevisionRank(p, doc.created_at);\n  out.revision.meRank = meRank;\n\n  // Il rango di un fratello si calcola dal suo parse; se non e' ancora stato\n  // parsato lo si parsa al volo dal suo raw_text. Senza questo, l'esito\n  // tornerebbe a dipendere da quale documento viene toccato per primo.\n  const live = rows.filter((r) => r.status !== 'ignored').map((r) => {\n    let pj = r.parsed_json;\n    if (!pj || !Array.isArray(pj.items) || pj.items.length === 0) {\n      try { pj = parseRawText ? parseRawText(r.raw_text || '') : null; } catch (_e) { pj = null; }\n    }\n    return { row: r, rank: bekRevisionRank(pj, r.created_at) };\n  });\n  out.revision.liveRanks = live.map((s) => ({ id: s.row.id, cls: s.rank.cls, rank: s.rank.rank }));\n\n  // 2b. FAIL CLOSED sull'incertezza. Se io o un fratello vivo non siamo\n  //     classificabili, nessuno supera nessuno: decide una persona.\n  //     La condizione NON richiede fratelli vivi (MT71): l'incertezza e' una\n  //     proprieta' del documento, non del numero di fratelli.\n  const incerti = live.filter((s) => !bekRankIsCertain(s.rank));\n  if (!bekRankIsCertain(meRank) || incerti.length > 0) {\n    const quali = [meRank.cls || 'sconosciuta'].concat(incerti.map((s) => s.rank.cls || 'sconosciuta'));\n    const messaggio = live.length > 0\n      ? `Sales Order ${docNumber} ha piu' revisioni e almeno una non e' classificabile (classi viste: ${quali.join(', ')}). Nessuna revisione e' stata superata automaticamente: riconcilia a mano.`\n      : `Sales Order ${docNumber} non e' classificabile con certezza (classe: ${meRank.cls || 'sconosciuta'}) e non ha altre revisioni con cui riconciliarsi. Un documento di classe incerta non viene mai importato automaticamente: serve una revisione manuale.`;\n    out.outcome = OUTCOME.REVISION_UNKNOWN;\n    out.revision.verdict = OUTCOME.REVISION_UNKNOWN;\n    out.blocking = true;\n    out.blockingCode = 'BEK_REVISION_UNKNOWN';\n    out.warnings = [{\n      code: 'BEK_REVISION_UNKNOWN',\n      severity: 'blocking',\n      message: messaggio,\n      sibling_ids: live.map((s) => s.row.id),\n    }];\n    return out;\n  }\n\n  // 2c. Un fratello vivo mi supera: io divento superato.\n  const betterSibling = live.find((s) => bekOutranks(s.rank, meRank));\n  if (betterSibling) {\n    out.outcome = OUTCOME.SUPERSEDED;\n    out.revision.verdict = OUTCOME.SUPERSEDED;\n    out.revision.supersededBy = betterSibling.row.id;\n    return out;\n  }\n\n  // 2d. Sono io la revisione operativa: i fratelli vivi vanno superati.\n  //     La lista e' un'istruzione per il caller, non una scrittura fatta qui.\n  out.outcome = OUTCOME.OPERATIVE;\n  out.revision.verdict = OUTCOME.OPERATIVE;\n  out.revision.supersedeIds = live.map((s) => s.row.id);\n  return out;\n}\n\nconst API = {\n  bekDecidePostParse,\n  bekBuyerVerdict,\n  bekRevisionRank,\n  bekRankIsCertain,\n  bekOutranks,\n  bekHasConfirmedQty,\n  BEK_CLASS_RANK,\n  OUTCOME,\n  BUYER_KITCHEN,\n  BUYER_EXCLUDED,\n  BUYER_UNKNOWN,\n};\n\nif (typeof module !== 'undefined' && module.exports) {\n  module.exports = API;\n}\nif (typeof window !== 'undefined') {\n  window.BekPostParseSafety = API;\n}\n",
  "price-intelligence-merge": "// \u2500\u2500 vendor-parsers/price-intelligence-merge.js \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// MICRO-TASK 88A \u2014 una sola decisione, condivisa, su COSA scrivere in\n// ingredient_vendors quando arriva una nuova osservazione di prezzo.\n//\n// IL PROBLEMA CHE RISOLVE\n// -----------------------\n// Il blocco price-intelligence (worker vdaiApprove e UI vdrApprove, due\n// copie della stessa logica) costruiva i campi da scrivere guardando\n// SOLO il documento in arrivo:\n//\n//     conversion_to_base: convBase ? Math.round(convBase) : null,\n//     price_per_100g:     per100g,\n//\n// e poi faceva un UPDATE. Se il documento nuovo non permetteva di\n// calcolare i grammi \u2014 per qualunque ragione \u2014 quei due null finivano\n// sopra una conversione valida gia' memorizzata, cancellandola.\n//\n// Casi reali censiti in produzione al 2026-09-20 (nessuno ancora\n// materializzato, tutti in documenti pending):\n//\n//   BEK 688106 Semolina    pack \"1/\"          <- troncato dal parser\n//   BEK 108509             pack \"3/\"          <- troncato dal parser\n//   Hardie's 03744         pack \"9-1/2 GAL\"   <- valido, ma la grammatica\n//   Hardie's 25618         pack \"6-4/2 oz\"       del worker non lo copre\n//   Hardie's 00907         pack \"80#   ITA\"      (la UI si')\n//\n// Le ultime tre mostrano perche' la regola NON puo' basarsi sul\n// riconoscere i pack \"scritti male\": erano pack perfettamente validi,\n// e il danno sarebbe arrivato lo stesso. La regola deve guardare la\n// TRANSIZIONE, non la stringa.\n//\n// L'INVARIANTE\n// ------------\n// Un'osservazione non puo' cancellare un'informazione. Puo' solo\n// sostituirla con un'altra informazione.\n//\n// Detto sui campi: se l'osservazione non produce una conversione, e una\n// conversione valida e' gia' memorizzata, la conversione memorizzata\n// resta \u2014 insieme al pack che la giustifica \u2014 e il prezzo normalizzato\n// viene RICALCOLATO sul prezzo nuovo, cosi' il record non resta mai\n// internamente incoerente (unit_price di agosto con price_per_100g di\n// luglio).\n//\n// L'unica eccezione e' price_type 'per_lb': li' la conversione null non\n// e' un'assenza di informazione, e' un'affermazione esplicita\n// (catchweight, il peso lo porta la riga di fattura, non il pack). Quel\n// null continua a passare, esattamente come prima.\n//\n// I TRE CASI (MICRO-TASK 88A.1)\n// -----------------------------\n// \"L'osservazione non produce una conversione\" non e' una sola\n// situazione, sono tre, e solo due sono sicure:\n//\n//   1. MISSING / TRUNCATED \u2014 il pack osservato non dichiara nessuna\n//      misura: null, \"\", \"1/\", \"3/\". Il documento non sta dicendo che la\n//      cassa e' cambiata; il parser non e' riuscito a leggere. Si\n//      conserva quello che sappiamo. SICURO.\n//\n//   2. SAME PACK, LIMITE DEL PARSER \u2014 il pack osservato e' la stessa\n//      identica dichiarazione gia' memorizzata, ma la grammatica di\n//      questo runtime non la sa convertire: \"9-1/2 GAL\" osservato su una\n//      riga che ha gia' \"9-1/2 GAL\" e 35961. La cassa e' la stessa, lo\n//      dice il documento stesso. SICURO.\n//\n//   3. PACK DIVERSO E NON CONVERTIBILE \u2014 il documento dichiara un pack\n//      non vuoto e materialmente diverso da quello memorizzato, e non\n//      sappiamo convertirlo: existing \"1/ 50 LB\" (22680 g) e osservato\n//      \"80#   ITA\". Riusare 22680 attribuirebbe il prezzo della cassa\n//      nuova alla conversione della cassa vecchia: un costo normalizzato\n//      SBAGLIATO ma dall'aria perfettamente sana. Peggio di un null,\n//      perche' nessuno lo noterebbe.\n//      NON SICURO -> FAIL-CLOSED: si salta l'intero aggiornamento di\n//      price intelligence per quella riga. Nessun campo scritto,\n//      last_invoice_date compresa.\n//\n// Saltare non blocca l'import: il documento diventa comunque 'imported'\n// (index.ts:1313, fuori da questo blocco) e Phase B pesca solo i\n// 'pending', quindi non verra' riapprovato in eterno. E la cronologia\n// resta corretta lo stesso, perche' effectiveLastDate() deriva la data\n// vera dalle invoice_lines appena scritte, non dalla colonna che non\n// abbiamo toccato.\n//\n// IL COSTO PER PEZZO (MICRO-TASK 89A)\n// -----------------------------------\n// Osservato in produzione il 2026-09-20, sull'import di 0003099324:\n// BEK 130881 (guanti L, pack \"10/ 100 CT\") passa da unit_price 52.92 a\n// 53.00, ma price_per_each resta 0.05292 \u2014 il prezzo della cassa\n// avanza, il costo del pezzo no. Il valore giusto e' 53.00/1000 = 0.053.\n//\n// La causa: price_per_each non era fra i campi che questo blocco scrive.\n// Nessun percorso automatico lo aggiornava: lo scrivevano solo la\n// risposta umana (vdrSaveEach) e l'editing manuale della scheda\n// ingrediente. Cosi' restava fermo al prezzo del giorno in cui qualcuno\n// l'aveva inserito.\n//\n// Adesso lo decide questa funzione, con la stessa disciplina della\n// conversione: price_per_each = unit_price / pezzi-per-cassa, dove i\n// pezzi si leggono dal pack con parsePackSize \u2014 la sola grammatica di\n// pack del repository, non una seconda scritta qui.\n//\n// CAPACITA' DELLA CASSA\n// ---------------------\n// Da MICRO-TASK 89A i tre casi non guardano piu' la sola conversione in\n// grammi, ma la CAPACITA' della cassa, che per un prodotto a peso sono\n// i grammi e per uno a conteggio sono i pezzi. Serviva: per una riga a\n// conteggio conversion_to_base e' legittimamente null, quindi la\n// protezione di MICRO-TASK 88A non scattava mai e un pack troncato\n// (\"10/\" al posto di \"10/ 100 CT\") poteva sovrascrivere quello buono\n// senza che nessuno se ne accorgesse. Con la capacita' al posto dei\n// grammi, le righe a peso e quelle a conteggio sono protette dalla\n// stessa identica regola.\n//\n// COSA NON FA\n// -----------\n// Non scrive. Decide i valori e li restituisce; l'UPDATE resta dove e'\n// sempre stato. Non inventa mai una conversione ne' un conteggio che\n// non esistano gia': se i pezzi per cassa non sono determinabili,\n// price_per_each non compare fra i campi e la colonna non viene toccata.\n// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\n'use strict';\n\n// \u2500\u2500 Classificazione dei pack \u2014 SOLO DIAGNOSTICA \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Serve a spiegare nei log e nei report che tipo di pack e' arrivato.\n// La decisione di merge qui sotto NON la usa, deliberatamente: una\n// regola che dipendesse dal saper leggere il pack fallirebbe sul primo\n// formato che nessuno ha previsto \u2014 ed e' esattamente quello che e'\n// successo con \"9-1/2 GAL\" e \"80#   ITA\".\nconst MEASURE_UNITS = ['#', 'lb', 'lbs', 'oz', 'kg', 'g', 'gal', 'l', 'lt', 'ltr', 'ml', 'qt', 'pt'];\nconst COUNT_UNITS   = ['ct', 'ea', 'each', 'pk', 'pkg', 'dz', 'doz', 'roll', 'pr', 'pair', 'bx', 'box', 'cs', 'bg', 'bag', 'ca'];\n\nconst PACK_WEIGHT    = 'A_WEIGHT';     // dichiara un peso o un volume: \"1/ 50 LB\", \"9-1/2 GAL\", \"80#   ITA\"\nconst PACK_COUNT     = 'B_COUNT';      // dichiara un conteggio: \"10/ 100 CT\", \"6/ 40 CT\", \"Each\", \"15 DZ\"\nconst PACK_NONE      = 'C_NONE';       // non dichiara niente: null, \"\", \"1/\", \"3/\"\nconst PACK_UNKNOWN   = 'D_UNKNOWN';    // dichiara qualcosa che non sappiamo leggere: '1 gallon Great Value Whole Milk'\n\nfunction classifyPack(pack) {\n  if (pack == null || String(pack).trim() === '') return PACK_NONE;\n  const s = String(pack).toLowerCase();\n  const tokens = s.match(/#|[a-z]+/g) || [];\n  if (!tokens.length) return PACK_NONE;\n  for (const t of tokens) if (MEASURE_UNITS.indexOf(t) !== -1) return PACK_WEIGHT;\n  for (const t of tokens) if (COUNT_UNITS.indexOf(t) !== -1) return PACK_COUNT;\n  return PACK_UNKNOWN;\n}\n\n// \u2500\u2500 Pezzi per cassa \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Riusa parsePackSize di vendor-parsers/utils.js, che e' gia' la\n// grammatica dei pack di tutto il repository: \"10/ 100 CT\" -> {count:10,\n// sizeEach:100, unit:'ct'}. Qui si moltiplica e si converte la dozzina.\n// Nessuna regex nuova.\n//\n// Torna null \u2014 cioe' \"non lo so\", mai un numero inventato \u2014 quando il\n// pack non si legge, quando l'unita' non e' di conteggio (una cassa da\n// 50 LB non ha pezzi) e quando il conteggio e' un intervallo\n// (\"16-22 CT\"), che non e' deterministico.\n// Il fattore dice quanti PEZZI FISICI vale una unita' collettiva, non\n// quante confezioni: dz -> 12 uova, pr -> 2 guanti. MICRO-TASK 93A ha\n// aggiunto il paio dopo un censimento del corpus: \"1/ 1 PR\" compare su\n// un solo SKU, BEK 115579, la cui descrizione dice \"Mitt Oven 16 In\n// Pair Tan\". L'unica altra occorrenza di \"PR\" nel database e' dentro la\n// descrizione H-E-B \"PORTERHOUSE STEAK USDA PR F\", dove sta per Prime e\n// non e' un pack \u2014 parsePackSize la rifiuta perche' non inizia con un\n// numero, quindi non puo' essere reinterpretata.\n// \"prs\" non e' incluso: non compare da nessuna parte nel corpus.\nconst COUNT_UNIT_FACTOR = { ct: 1, ea: 1, each: 1, pk: 1, pkg: 1, dz: 12, doz: 12, pr: 2, pair: 2 };\n\nfunction packUtils() {\n  if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {\n    return require('./utils');\n  }\n  if (typeof window !== 'undefined' && window.VendorParserUtils) {\n    return window.VendorParserUtils;\n  }\n  return null;\n}\n\nfunction packTotalEach(pack) {\n  if (pack == null || String(pack).trim() === '') return null;\n  const utils = packUtils();\n  if (!utils || typeof utils.parsePackSize !== 'function') return null;\n  let p;\n  try { p = utils.parsePackSize(pack); } catch (_) { return null; }\n  if (!p) return null;\n  const factor = COUNT_UNIT_FACTOR[p.unit];\n  if (!factor) return null;                                   // non e' un conteggio\n  if (p.sizeMax != null && p.sizeMax !== p.sizeEach) return null;  // intervallo\n  const total = p.count * p.sizeEach * factor;\n  return (isFinite(total) && total > 0) ? total : null;\n}\n\n// \u2500\u2500 Confronto fra due dichiarazioni di pack \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Normalizzazione MINIMA, e deliberatamente stupida: spazi ai bordi via,\n// spazi interni collassati, tutto minuscolo. Nient'altro \u2014 niente\n// punteggiatura rimossa, niente unita' espanse, niente riordino. Serve\n// solo a non trattare \"80#   ITA\" e \"80# ita\" come casse diverse.\n// Qualunque cosa in piu' sarebbe la grammatica universale che non\n// vogliamo costruire, e ogni sua imprecisione si pagherebbe con un\n// riuso silenzioso della conversione sbagliata.\nfunction normalizePack(pack) {\n  if (pack == null) return null;\n  const s = String(pack).trim().replace(/\\s+/g, ' ').toLowerCase();\n  return s === '' ? null : s;\n}\n\nfunction samePack(a, b) {\n  const na = normalizePack(a);\n  const nb = normalizePack(b);\n  if (na === null || nb === null) return false;   // un'assenza non e' un'uguaglianza\n  return na === nb;\n}\n\n// \u2500\u2500 La decisione \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// existing     riga ingredient_vendors gia' presente, o null/undefined\n//              per un INSERT (allora non c'e' niente da proteggere e il\n//              risultato e' identico a quello di prima della patch).\n// observation  quello che il documento in arrivo dice, con gli stessi\n//              nomi di colonna: unit_price, pack_description, price_type,\n//              conversion_to_base, price_per_100g, last_invoice_date.\n//\n// Ritorna { fields, skipped, reason, rescued, packClass }:\n//   fields     l'oggetto da passare a .update()/.insert(), oppure null\n//              se skipped\n//   skipped    true = il chiamante NON deve scrivere niente su questa\n//              riga (caso 3, fail-closed)\n//   reason     'update' | 'rescue_missing_pack' | 'rescue_same_pack'\n//              | 'unresolved_pack_change'\n//   rescued    true se un dato valido e' stato protetto (per il log)\n//   packClass  la classificazione diagnostica del pack osservato\nfunction mergePriceIntelligence(existing, observation) {\n  const obs = observation || {};\n  const ex  = existing || null;\n\n  const priceType = obs.price_type != null ? obs.price_type : null;\n  const isPerLb   = priceType === 'per_lb';\n\n  const obsConv = obs.conversion_to_base != null ? Number(obs.conversion_to_base) : null;\n  const exConvRaw = ex && ex.conversion_to_base != null ? Number(ex.conversion_to_base) : null;\n  const exConv = (exConvRaw !== null && isFinite(exConvRaw) && exConvRaw > 0) ? exConvRaw : null;\n\n  // Pezzi per cassa, letti dai due pack. Per un prodotto a peso sono\n  // null su entrambi i lati e tutto si comporta come prima di 89A.\n  const obsCount = packTotalEach(obs.pack_description);\n  const exCount  = ex ? packTotalEach(ex.pack_description) : null;\n\n  const packClass = classifyPack(obs.pack_description);\n\n  // CAPACITA' \u2014 quanto misura una cassa: in grammi per un prodotto a\n  // peso, in pezzi per uno a conteggio. Non e' la sola conversione che\n  // va protetta: le righe a conteggio hanno conversion_to_base\n  // legittimamente null, quindi la regola di MICRO-TASK 88A non\n  // scattava mai per loro e un pack troncato poteva sovrascrivere\n  // quello buono senza che nessuno se ne accorgesse.\n  //\n  // La perdita si misura PER TIPO, non in blocco: un'osservazione che\n  // porta i pezzi ma non i grammi non \"sostituisce\" una conversione in\n  // grammi, la cancella. Vale anche al contrario.\n  const perdeGrammi = exConv  !== null && obsConv  === null;\n  const perdePezzi  = exCount !== null && obsCount === null;\n\n  // Niente da proteggere: riga nuova, l'osservazione dice almeno quanto\n  // diceva la riga, o per_lb (dove il null e' un'affermazione esplicita,\n  // non un'assenza).\n  const nothingToProtect = isPerLb || (!perdeGrammi && !perdePezzi);\n\n  let reason;\n  if (nothingToProtect) {\n    reason = 'update';\n  } else if (packClass === PACK_NONE) {\n    reason = 'rescue_missing_pack';                       // caso 1\n  } else if (samePack(obs.pack_description, ex.pack_description)) {\n    reason = 'rescue_same_pack';                          // caso 2\n  } else {\n    reason = 'unresolved_pack_change';                    // caso 3\n  }\n\n  // \u2500\u2500 Caso 3 \u2014 FAIL-CLOSED \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n  // Il documento dichiara una cassa diversa e non sappiamo quanto\n  // contiene. Non si scrive NIENTE: ne' il pack (perderemmo quello che\n  // giustifica la capacita'), ne' la conversione o il costo per pezzo\n  // (sarebbero il prezzo nuovo diviso per la cassa vecchia), ne'\n  // unit_price e last_invoice_date, che da soli lascerebbero la riga a\n  // dire due cose incompatibili.\n  if (reason === 'unresolved_pack_change') {\n    return {\n      fields: null,\n      skipped: true,\n      reason,\n      rescued: false,\n      packClass,\n      observedPack: obs.pack_description != null ? obs.pack_description : null,\n      storedPack: ex.pack_description != null ? ex.pack_description : null,\n    };\n  }\n\n  const rescued = reason === 'rescue_missing_pack' || reason === 'rescue_same_pack';\n\n  // La capacita' effettiva: quella osservata, o quella conservata.\n  const effConv  = isPerLb ? null : (rescued ? exConv  : obsConv);\n  const effCount = isPerLb ? null : (rescued ? exCount : obsCount);\n\n  const conversion = effConv !== null ? Math.round(effConv) : null;\n\n  // Il pack segue la capacita' che giustifica. Se conserviamo quella\n  // vecchia conserviamo anche il pack vecchio: scriverci sopra \"10/\"\n  // lascerebbe una riga che dice 1000 pezzi senza dire piu' da dove\n  // vengono. Nel caso 2 i due pack sono la stessa dichiarazione, quindi\n  // si tiene la forma gia' memorizzata e non cambia nulla.\n  const pack = rescued\n    ? (ex.pack_description != null ? ex.pack_description : null)\n    : (obs.pack_description != null ? obs.pack_description : null);\n\n  // Prezzo normalizzato al peso: quello osservato se c'e'; altrimenti,\n  // se stiamo proteggendo una conversione, lo si RICALCOLA sul prezzo\n  // nuovo \u2014 mai lasciato indietro, mai azzerato.\n  const unitPrice = obs.unit_price != null ? obs.unit_price : null;\n  const unitPriceNum = (unitPrice != null && isFinite(Number(unitPrice))) ? Number(unitPrice) : null;\n\n  let per100g;\n  if (obs.price_per_100g != null) {\n    per100g = obs.price_per_100g;\n  } else if (rescued && effConv !== null && unitPriceNum !== null) {\n    per100g = (unitPriceNum / effConv) * 100;\n  } else if (rescued) {\n    per100g = ex.price_per_100g != null ? Number(ex.price_per_100g) : null;\n  } else {\n    per100g = null;\n  }\n\n  const fields = {\n    unit_price:         unitPrice,\n    pack_description:   pack,\n    price_type:         priceType,\n    conversion_to_base: conversion,\n    price_per_100g:     per100g,\n    last_invoice_date:  obs.last_invoice_date != null ? obs.last_invoice_date : null,\n  };\n\n  // \u2500\u2500 Costo per pezzo (MICRO-TASK 89A) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n  // La chiave compare SOLO quando i pezzi per cassa sono davvero noti.\n  // Se non lo sono, price_per_each resta fuori dai campi e la colonna\n  // non viene toccata: non si inventa un conteggio e non si cancella\n  // quello che c'e'. Per ogni prodotto a peso siamo sempre in questo\n  // ramo, quindi per loro non cambia assolutamente nulla.\n  if (effCount !== null && unitPriceNum !== null) {\n    fields.price_per_each = unitPriceNum / effCount;\n  }\n\n  return { fields, skipped: false, reason, rescued, packClass };\n}\n\nconst api = {\n  mergePriceIntelligence,\n  classifyPack,\n  normalizePack, samePack,\n  packTotalEach,\n  PACK_WEIGHT, PACK_COUNT, PACK_NONE, PACK_UNKNOWN,\n};\n\n// Tripla esposizione, come gli altri moduli condivisi: require() per i\n// test Node e per PARSER_SOURCES nel worker, window.* per il browser.\nif (typeof module !== 'undefined' && module.exports) module.exports = api;\nif (typeof window !== 'undefined') window.PriceIntelligenceMerge = api;\n",
  "index": "// \u2500\u2500 vendor-parsers/index.js \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Vendor detection and parser routing.\n// Pure functions. No DB, no AI.\n\n'use strict';\n\nconst hardiesOrder      = require('./hardies-order');\nconst hardiesInvoice    = require('./hardies-invoice');\nconst hardiesCredit     = require('./hardies-credit');\nconst freshpointInvoice = require('./freshpoint-invoice');\nconst frugeInvoice      = require('./fruge-invoice');\nconst bekInvoice        = require('./bek-invoice');\nconst bekOrderConfirmation = require('./ben-e-keith-order-confirmation');\nconst walmartTrevipayInvoice = require('./walmart-trevipay-invoice');\n\nconst VENDORS = {\n  // Placed FIRST so it is tried before any other vendor's patterns \u2014\n  // Walmart/TreviPay text also contains the generic word \"Invoice\" many\n  // times, so this must never fall through to a Hardie's-style default.\n  walmart: {\n    patterns: [\n      // Combined-signal (not a single generic token): requires BOTH\n      // \"Walmart Business\" and \"TreviPay\" to appear in the same\n      // document \u2014 confirmed present in all 4 real sample invoices.\n      //\n      // MICRO-TASK 45 \u2014 expressed as an array (= AND) instead of the\n      // previous single regex /(?=[\\s\\S]*A)(?=[\\s\\S]*B)/i. The two\n      // forms are exactly equivalent: a lookahead (?=[\\s\\S]*A) at\n      // position p succeeds iff A occurs at or after p, the engine tries\n      // p=0 first, and if it fails there it fails at every later p too \u2014\n      // so the regex matched iff every term occurred somewhere, which is\n      // what .every(re => re.test(text)) tests directly. The lookahead\n      // form made the engine re-scan the tail once per start position:\n      // measured quadratic (MICRO-TASK 44 \u2014 4k chars 6.3ms, 8k 25.8ms,\n      // 16k 93.2ms, 29.8k 329.2ms) and 705ms of a 716ms parse() on one\n      // BEK email, because `walmart` is tried FIRST for every vendor.\n      [/walmart\\s*business/i, /trevipay/i],\n      // Fallback combined signal, in case the \"Walmart Business\"\n      // wordmark text is ever missing from the parseable region: still\n      // three independent, unrelated signals together, never \"Invoice\"\n      // alone.\n      [/trevipay/i, /\\bBuyer\\b/i, /Invoice Details/i],\n    ],\n    documents: {\n      invoice: walmartTrevipayInvoice,\n    },\n  },\n  hardies: {\n    patterns: [\n      /dairyland produce/i,\n      /hardie'?s/i,\n      /chefs'?\\s*wh?se/i,\n    ],\n    documents: {\n      order_confirmation: hardiesOrder,\n      invoice:            hardiesInvoice,\n      credit_memo:        hardiesCredit,\n    },\n  },\n  freshpoint: {\n    patterns: [\n      /freshpoint/i,\n      /fresh\\s*point/i,\n    ],\n    documents: {\n      invoice: freshpointInvoice,\n    },\n  },\n  fruge: {\n    patterns: [\n      /fruge/i,\n      /fruge seafood/i,\n      /fruge distributing/i,\n    ],\n    documents: {\n      invoice: frugeInvoice,\n    },\n  },\n  bek: {\n    patterns: [\n      /ben e\\.? keith/i,\n      /ben e keith/i,\n    ],\n    documents: {\n      invoice:            bekInvoice,\n      // MICRO-TASK 42: the Order Confirmation email is an operational\n      // purchase document for Ben E. Keith \u2014 there is no separate\n      // invoice to wait for. document_type stays 'order_confirmation'\n      // so the original source is never lost.\n      order_confirmation: bekOrderConfirmation,\n    },\n  },\n};\n\n// \u2500\u2500 Detect vendor from raw text \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// A pattern is either a RegExp (matches on its own) or an array of\n// RegExp meaning \"all of these must appear somewhere in the document\".\n// The array form replaces the quadratic (?=[\\s\\S]*\u2026) lookahead chains\n// (MICRO-TASK 45) \u2014 same semantics, linear cost.\nfunction matchesPattern(pattern, text) {\n  return Array.isArray(pattern)\n    ? pattern.every(re => re.test(text))\n    : pattern.test(text);\n}\n\nfunction detectVendor(rawText) {\n  const text = rawText || '';\n  for (const [vendorKey, config] of Object.entries(VENDORS)) {\n    if (config.patterns.some(p => matchesPattern(p, text))) {\n      return vendorKey;\n    }\n  }\n  return 'unknown';\n}\n\n// \u2500\u2500 Detect document type from raw text \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// `vendor` is optional and backwards compatible: called with one\n// argument this behaves exactly as before. parse() passes the detected\n// vendor so a vendor-specific signal can never leak into another\n// vendor's detection.\nfunction detectDocumentType(rawText, vendor) {\n  const text = rawText || '';\n  if (/CONFIRMATION OF SALE/i.test(text))   return 'order_confirmation';\n  if (/\\bCREDIT\\b/i.test(text) && /\\bCREDIT\\s+\\d{5,}/i.test(text)) return 'credit_memo';\n  if (/INVOICE\\/POD/i.test(text))           return 'invoice';\n\n  // MICRO-TASK 42 \u2014 Ben E. Keith Order Confirmation. Scoped to vendor\n  // 'bek' ONLY: the real email body never contains the literal phrase\n  // \"Order Confirmation\" (that lives in the subject, which this\n  // function never sees), but it always carries \"Sales Order #\".\n  // Checked BEFORE the generic \\bINVOICE\\b fallback, because BEK's\n  // footer/boilerplate can mention invoices. Deliberately NOT global \u2014\n  // \"Sales Order\" is common vendor prose and must not reclassify any\n  // other vendor's document. (Same root cause as Task 11B, fixed there\n  // for the browser parser.)\n  if (vendor === 'bek' && /Sales\\s*Order/i.test(text)) return 'order_confirmation';\n\n  if (/\\bINVOICE\\b/i.test(text))            return 'invoice';\n  return 'unknown';\n}\n\n// \u2500\u2500 Purchasable document types (MICRO-TASK 42) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Re-exported, NOT redefined: the single definition lives in\n// ./ben-e-keith-order-confirmation.js, which is also the copy the browser\n// loads as a plain <script> (window.BekOrderConfirmationParser). Keeping\n// one definition is the whole point \u2014 a second copy here would be exactly\n// the divergence this task forbids.\nconst isBenEKeith           = bekOrderConfirmation.isBenEKeith;\nconst isPurchasableDocument = bekOrderConfirmation.isPurchasableDocument;\n\n// MICRO-TASK 48 \u2014 the Ben E. Keith buyer guard. Same rule as above: the\n// single definition lives in the BEK module and is re-exported here, never\n// redefined, so the Edge Function (which reaches the parsers only through\n// this index) and the browser see exactly the same allow-list.\nconst classifyBuyer       = bekOrderConfirmation.classifyBuyer;\nconst extractBuyerEmail   = bekOrderConfirmation.extractBuyerEmail;\nconst normalizeBuyerEmail = bekOrderConfirmation.normalizeBuyerEmail;\nconst BEK_BUYER_KITCHEN   = bekOrderConfirmation.BEK_BUYER_KITCHEN;\nconst BEK_BUYER_FOH       = bekOrderConfirmation.BEK_BUYER_FOH;\nconst BUYER_KITCHEN       = bekOrderConfirmation.BUYER_KITCHEN;\nconst BUYER_EXCLUDED      = bekOrderConfirmation.BUYER_EXCLUDED;\nconst BUYER_UNKNOWN       = bekOrderConfirmation.BUYER_UNKNOWN;\n\n\n// \u2500\u2500 Reconciliation check (Quadratura) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Data Priority P1: the document total is the source of truth.\n// If the sum of parsed line amounts does not match the declared\n// subtotal OR total (within tolerance), lines are missing or\n// misread \u2192 blocking warning DOC-TOTAL-001.\nconst TOTAL_TOLERANCE = 0.02; // dollars\n\nfunction checkTotals(parsed) {\n  if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) {\n    return parsed; // empty docs are covered by PARSE_ERROR\n  }\n\n  // MICRO-TASK 42 \u2014 a parser that already reconciled its own totals says\n  // so, and this generic check must not re-judge it. Generic flag, not a\n  // vendor special case: it exists because `amount` does not always mean\n  // the same thing as the document's declared total. For Ben E. Keith the\n  // declared \"Order Total\" is an ORDER-time figure (measured: equals\n  // \u03a3 price\u00d7ordered on all 4 real documents), while `amount` carries the\n  // CONFIRMED purchase value. Comparing the two would fail every short\n  // delivery \u2014 which must import, carrying only an informational\n  // BEK_QTY_SHORT. That parser raises DOC-TOTAL-001 itself, against the\n  // ordered sum, using this same $0.02 tolerance.\n  if (parsed.totals_reconciled === true) return parsed;\n\n  const amounts = parsed.items\n    .map(it => it.amount)\n    .filter(a => a !== null && a !== undefined && !isNaN(parseFloat(a)));\n\n  if (amounts.length === 0) return parsed;\n\n  const sumLines = Math.round(amounts.reduce((s, a) => s + parseFloat(a), 0) * 100) / 100;\n\n  const candidates = [];\n  if (parsed.subtotal !== null && parsed.subtotal !== undefined && !isNaN(parseFloat(parsed.subtotal))) {\n    candidates.push(parseFloat(parsed.subtotal));\n  }\n  if (parsed.total !== null && parsed.total !== undefined && !isNaN(parseFloat(parsed.total))) {\n    candidates.push(parseFloat(parsed.total));\n  }\n\n  if (candidates.length === 0) return parsed;\n\n  const matches = candidates.some(c => Math.abs(c - sumLines) <= TOTAL_TOLERANCE);\n  if (matches) return parsed;\n\n  const declared = candidates[candidates.length - 1];\n  const pct = declared !== 0\n    ? Math.round(Math.abs(sumLines / declared) * 100)\n    : 0;\n\n  parsed.warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];\n  parsed.warnings.push({\n    code:     'DOC-TOTAL-001',\n    severity: 'blocking',\n    message:  `Lines sum $${sumLines.toFixed(2)} but document total is $${declared.toFixed(2)} (${pct}% read) \u2014 possible missing lines`,\n    sum_of_lines:   sumLines,\n    declared_total: declared,\n  });\n\n  return parsed;\n}\n\n// \u2500\u2500 Parse a document \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Returns structured VendorDocument or error object\nfunction parse(rawText) {\n  const vendor  = detectVendor(rawText);\n  const docType = detectDocumentType(rawText, vendor);\n\n  if (vendor === 'unknown') {\n    return {\n      vendor:        null,\n      document_type: docType,\n      items:         [],\n      warnings: [{\n        code:    'UNKNOWN_VENDOR',\n        message: 'Vendor not recognised from document text',\n      }],\n    };\n  }\n\n  if (docType === 'unknown') {\n    return {\n      vendor,\n      document_type: null,\n      items:         [],\n      warnings: [{\n        code:    'UNKNOWN_DOC_TYPE',\n        message: `Document type not recognised for vendor \"${vendor}\"`,\n      }],\n    };\n  }\n\n  const parser = VENDORS[vendor].documents[docType];\n  if (!parser) {\n    return {\n      vendor,\n      document_type: docType,\n      items:         [],\n      warnings: [{\n        code:    'NO_PARSER',\n        message: `No parser implemented for ${vendor} / ${docType}`,\n      }],\n    };\n  }\n\n  try {\n    const parsed = parser.parse(rawText);\n    return checkTotals(parsed);\n  } catch (err) {\n    return {\n      vendor,\n      document_type: docType,\n      items:         [],\n      warnings: [{\n        code:    'PARSER_ERROR',\n        message: `Parser threw: ${err.message}`,\n      }],\n    };\n  }\n}\n\n// MICRO-TASK 81 \u2014 la decisione BEK post-parse (buyer guard + riconciliazione\n// delle revisioni) e' condivisa fra Phase A del worker e il reprocess della\n// UI. Esposta da qui perche' e' la porta d'ingresso che entrambi usano gia'.\nconst bekSafety = require('./bek-post-parse-safety');\n\n// MICRO-TASK 88A \u2014 la decisione su cosa scrivere in ingredient_vendors\n// quando arriva una nuova osservazione di prezzo. Condivisa fra worker\n// e UI Approve, che avevano due copie identiche dello stesso blocco.\nconst priceIntel = require('./price-intelligence-merge');\n\nmodule.exports = {\n  parse, detectVendor, detectDocumentType, checkTotals,\n  bekSafety,\n  priceIntel,\n  isPurchasableDocument, isBenEKeith,\n  classifyBuyer, extractBuyerEmail, normalizeBuyerEmail,\n  BEK_BUYER_KITCHEN, BEK_BUYER_FOH,\n  BUYER_KITCHEN, BUYER_EXCLUDED, BUYER_UNKNOWN,\n};\n",
};

function loadParsers() {
  const require_ = makeCjsLoader(PARSER_SOURCES);
  return require_('index');
}

// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 42 — purchasable document types.
//
// The rule lives ONCE, in js/vendor-parsers/index.js, and is reached
// here through the same embedded-source loader the parsers already use.
// No second copy to keep in sync by hand: if the rule changes there,
// regenerating PARSER_SOURCES from the canonical file changes it here
// too. Cached because loadParsers() compiles the embedded modules.
// ══════════════════════════════════════════════════════════════════
let _parsersApiCache: any = null;
function parsersApi(): any {
  if (!_parsersApiCache) _parsersApiCache = loadParsers();
  return _parsersApiCache;
}
function isPurchasableDocument(vendor: any, documentType: any): boolean {
  return parsersApi().isPurchasableDocument(vendor, documentType) === true;
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

// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 43 — source acquisition for a Ben E. Keith body-only
// document.
//
// A BEK Order Confirmation email carries no attachment: gmail-vendor-import
// stores the email HTML straight into vendor_documents.raw_text and marks
// parsed_json.source as 'email_html' (or 'email_body' for the legacy
// plain-text path). There is nothing in Storage to download — the text to
// parse is already in the row.
//
// Deliberately narrow. This does NOT make every body-only document
// processable: it is restricted to Ben E. Keith order_confirmation with an
// explicit email source marker. Anything else without a storage_path keeps
// returning 'skipped_no_pdf', exactly as before.
//
// vendor/document_type are read from the COLUMNS: gmail-vendor-import writes
// parsed_json = { source: '…' } and nothing else, so the type is not in the
// JSON at this stage. (parsed_json is still preferred when present, for
// documents re-processed after a first parse.)
// ══════════════════════════════════════════════════════════════════
function isBekBodyOnlySource(doc: any): boolean {
  const pj = doc.parsed_json || {};
  const source = pj.source;
  if (source !== 'email_html' && source !== 'email_body') return false;
  const vendor  = pj.vendor || doc.vendor || '';
  const docType = pj.document_type || doc.document_type || '';
  return parsersApi().isBenEKeith(vendor) && docType === 'order_confirmation';
}

async function processOneQueuedDoc(sb: any, doc: any, parsers: any): Promise<{ outcome: string; detail?: string }> {
  // ── SOURCE ACQUISITION ──────────────────────────────────────────
  // The ONLY thing MICRO-TASK 43 changes is where the raw text comes
  // from. Everything below this block — parsing, dedup, reconciliation,
  // status — is untouched and shared by both paths.
  const storagePath = doc.parsed_json?.storage_path || null;
  const bodyOnly = !storagePath && isBekBodyOnlySource(doc);

  if (!storagePath && !bodyOnly) {
    // Not a PDF attachment and not a recognised BEK email body — out of
    // scope, left exactly as-is for the client (unchanged behaviour).
    return { outcome: 'skipped_no_pdf' };
  }

  let rawText: string;
  if (storagePath) {
    try {
      const extracted = await extractPdfText(sb, storagePath);
      rawText = extracted.rawText;
    } catch (e: any) {
      await sb.from('vendor_documents').update({ status: 'error', warnings: [{ code: 'MISSING_STORAGE_PATH', message: e.message }] }).eq('id', doc.id);
      return { outcome: 'error', detail: e.message };
    }
  } else {
    // BEK body-only: the email HTML is already the raw source. Fail
    // closed on an empty body rather than handing '' to the parser and
    // letting it look like a document with no lines.
    const body = typeof doc.raw_text === 'string' ? doc.raw_text : '';
    if (!body.trim()) {
      await sb.from('vendor_documents').update({
        status: 'error',
        warnings: [{ code: 'BEK_EMPTY_BODY', severity: 'blocking', message: 'Ben E. Keith body-only document has no raw_text to parse' }],
      }).eq('id', doc.id);
      return { outcome: 'error', detail: 'empty raw_text' };
    }
    rawText = body;
  }

  // ── PARSING / BUSINESS LOGIC (unchanged, shared by both paths) ───
  const parsed = parsers.parse(rawText);

  let docNumber = parsed.invoice_number || parsed.order_number || parsed.credit_number || parsed.document_number || null;
  if (!docNumber && doc.source_email_subject) {
    // MICRO-TASK 78 — un numero di documento nel subject e' un numero ISOLATO,
    // mai un gruppo di cifre dentro un token alfanumerico.
    //
    // La regex precedente era /#?\s*(\d{6,10})/: nessun confine, e match()
    // senza flag `g` restituisce il PRIMO run da sinistra. Sul subject BEK
    //   "Ben E. Keith : Order Confirmation for FDF770366-ZENO'S ON THE SQUARE;0002952908"
    // il primo run e' 770366, cioe' il Customer# dentro FDF770366 — lo STESSO
    // su tutte e 61 le email BEK del database. Non e' teorico: due righe
    // (d84e4d64, 383764dd) sono nate cosi' il 19/08, con il Sales Order vero
    // 0002952908 scritto nello stesso subject, subito dopo il ';'.
    //
    // Un document_number sbagliato non sporca soltanto: SPACCA il gruppo di
    // riconciliazione (quelle due righe non sono mai state viste come fratelli
    // di 7aa702b1, l'import vero) e, poiche' 770366 e' costante, due documenti
    // diversi che percorressero il fallback collasserebbero nello STESSO
    // gruppo — sezione F keyed su un Sales Order che non esiste.
    //
    // Il confine e' consumato a sinistra e verificato in lookahead a destra:
    // niente lookbehind, che Safari < 16.4 non supporta e questa stessa regex
    // gira anche nel browser (js/vendor-documents-review.js, copia gemella).
    // Un run di 11+ cifre non matcha piu' affatto invece di essere troncato a
    // 10: fail closed, meglio nessun numero che un numero tagliato.
    //
    // Misurato su tutti i 256 subject reali: Hardie's 122/122 invariati (121
    // righe dipendono da QUESTO fallback ed e' la loro unica identita'),
    // Fruge 51/51 invariati, FreshPoint 1/1 invariato, BEK 61/61 non producono
    // piu' 770366 (58 danno il Sales Order vero, 1 — subject ";null" — da'
    // null, che e' il comportamento voluto).
    const sm = doc.source_email_subject.match(/(?:^|[^A-Za-z0-9])#?\s*(\d{6,10})(?![A-Za-z0-9])/);
    if (sm) docNumber = sm[1];
  }
  const docDate = parsed.order_date || parsed.credit_date || parsed.delivery_date || parsed.document_date || parsed.invoice_date || null;

  // ══════════════════════════════════════════════════════════════════
  // MICRO-TASK 81 — LA DECISIONE BEK POST-PARSE E' UNA SOLA.
  //
  // Qui stavano, in linea, il buyer guard di MT48 e la sezione F di MT42
  // (con MT64/65 per il rango e MT71/72 per il fail-closed). Erano corretti,
  // ma erano SOLO qui: il reprocess della UI riparsa gli stessi documenti e
  // riscrive le stesse colonne senza prendere nessuna di queste decisioni —
  // MT80 lo ha misurato su due documenti veri.
  //
  // La decisione ora vive in js/vendor-parsers/bek-post-parse-safety.js,
  // chiamata identica da entrambi i percorsi. Le REGOLE non sono cambiate:
  // stesso ordine (buyer prima della riconciliazione), stesse condizioni,
  // stessi messaggi. Quello che cambia e' dove sono scritte.
  //
  // Il modulo decide e non scrive: le UPDATE restano qui, perche' Phase A e
  // il reprocess scrivono legittimamente in modo diverso (qui si esce con un
  // outcome e si tocca lo Storage, li' si accumula in un UPDATE solo).
  // ══════════════════════════════════════════════════════════════════
  const bekSafety = parsersApi().bekSafety;
  const decisione = await bekSafety.bekDecidePostParse({
    sb, doc, parsed, docNumber,
    parseRawText: (t: string) => parsersApi().parse(t),
  });
  const OUT = bekSafety.OUTCOME;

  if (decisione.applies) {
    const keepJson = { ...parsed, source: doc.parsed_json?.source, storage_path: storagePath };

    if (decisione.outcome === OUT.BUYER_EXCLUDED) {
      // Un ordine vero, solo non della cucina. Conservato per audit sotto lo
      // stesso 'ignored' usato per le revisioni superate: mai un acquisto, e
      // mai una riga da risolvere in review.
      await sb.from('vendor_documents').update({
        status: 'ignored',
        document_number: docNumber,
        document_date: docDate,
        parsed_json: keepJson,
        warnings: decisione.warnings,
      }).eq('id', doc.id);
      return { outcome: 'ignored_buyer_excluded', detail: parsed.buyer_email || '' };
    }

    if (decisione.outcome === OUT.BUYER_UNKNOWN) {
      // Buyer assente o non riconosciuto. NON assunto da nessuna delle due
      // parti: resta pending con un warning bloccante e lo guarda una persona.
      await sb.from('vendor_documents').update({
        status: 'pending',
        document_number: docNumber,
        document_date: docDate,
        parsed_json: keepJson,
        warnings: decisione.warnings,
      }).eq('id', doc.id);
      return { outcome: 'blocked_buyer_unknown', detail: parsed.buyer_email || 'missing' };
    }

    if (decisione.outcome === OUT.AFTER_IMPORT) {
      await sb.from('vendor_documents').update({
        status: 'pending',
        warnings: decisione.warnings,
      }).eq('id', doc.id);
      if (storagePath) await sb.storage.from('app').remove([storagePath]);
      return { outcome: 'bek_revision_after_import' };
    }

    if (decisione.outcome === OUT.REVISION_UNKNOWN) {
      await sb.from('vendor_documents').update({
        status: 'pending',
        warnings: decisione.warnings,
      }).eq('id', doc.id);
      if (storagePath) await sb.storage.from('app').remove([storagePath]);
      return { outcome: 'bek_revision_unknown' };
    }

    if (decisione.outcome === OUT.SUPERSEDED) {
      await sb.from('vendor_documents').update({ status: 'ignored' }).eq('id', doc.id);
      return { outcome: 'bek_superseded_by_newer_revision' };
    }

    // OPERATIVE — i fratelli vivi vengono superati e questo documento
    // prosegue deliberatamente: dev'essere preflightato e, se pulito,
    // importato.
    for (const id of decisione.revision.supersedeIds || []) {
      await sb.from('vendor_documents').update({ status: 'ignored' }).eq('id', id);
    }
  }

  // ── Duplicate check by doc number (ported verbatim) ──
  // MICRO-TASK 42: BEK order_confirmation never reaches here — the block
  // above always returns or has already superseded its siblings, so this
  // first-wins rule keeps applying unchanged to every other vendor.
  if (docNumber && !(parsersApi().isBenEKeith(parsed.vendor) && parsed.document_type === 'order_confirmation')) {
    const { data: byNum } = await sb.from('vendor_documents').select('id').eq('vendor', parsed.vendor).eq('document_number', docNumber).eq('document_type', parsed.document_type).neq('id', doc.id).limit(1);
    if (byNum && byNum.length > 0) {
      await sb.from('vendor_documents').update({ status: 'error', warnings: [{ code: 'DUPLICATE', message: `Document #${docNumber} already exists` }] }).eq('id', doc.id);
      // MICRO-TASK 43: null-guard — un documento body-only non ha nulla da
      // rimuovere da Storage. Non cambia il comportamento del ramo PDF.
      if (storagePath) await sb.storage.from('app').remove([storagePath]);
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

// MICRO-TASK 64/65 — un documento BEK e' un acquisto solo se qualcosa e'
// stato CONFERMATO. Serve come INVARIANTE di validazione, non come
// identita' della revisione: quella la da' document_class.
// ── MICRO-TASK 81 — le funzioni di rango non vivono piu' qui ────────────
// Erano dichiarate SOLO in questo file, ed e' esattamente il motivo per cui
// il percorso di reprocess della UI non poteva prendere la stessa decisione:
// non aveva modo di calcolare un rango. Ora stanno in
// js/vendor-parsers/bek-post-parse-safety.js, embeddato in PARSER_SOURCES.
//
// Qui restano quattro deleghe di una riga. Non sono una seconda copia: sono
// il nome con cui il resto di questo file (e i test che lo esercitano
// attraverso pure_logic) continua a raggiungere l'unica implementazione.
// Il comportamento e' identico per costruzione — non c'e' nessun corpo da
// tenere allineato.
const bekHasConfirmedQty = (parsedDoc: any): boolean => parsersApi().bekSafety.bekHasConfirmedQty(parsedDoc);
const bekRevisionRank = (parsedDoc: any, createdAt: any) => parsersApi().bekSafety.bekRevisionRank(parsedDoc, createdAt);
const bekRankIsCertain = (r: any): boolean => parsersApi().bekSafety.bekRankIsCertain(r);
const bekOutranks = (a: any, b: any): boolean => parsersApi().bekSafety.bekOutranks(a, b);

function vdrCodeToSeverityLite(code: string): string {
  const blocking = ['INV-PACK-001', 'OQR-008', 'DOC-PARSE-001', 'DOC-VENDOR-001', 'DOC-TYPE-001', 'DOC-NOPARSER-001', 'INV-MATCH-001', 'INV-DUP-001', 'INV-OCR-001', 'PARSE_ERROR', 'UNKNOWN_VENDOR', 'UNKNOWN_DOC_TYPE', 'NO_PARSER', 'PARSER_ERROR', 'DOC-TOTAL-001', 'PROCESS_ERROR', 'PARSE_ERROR_NO_LINES', 'BEK_NO_SALES_ORDER', 'BEK_REVISION_UNKNOWN', 'BEK_REVISION_AFTER_IMPORT'];
  const insight = ['INV-SUB-001', 'OQR-002', 'INV-PACKCT-001', 'OQR-006', 'INV-PRICE-001', 'INV-UNUSED-001'];
  if (blocking.includes(code)) return 'blocking';
  if (insight.includes(code)) return 'insight';
  return 'alert';
}

// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 75 — finestra ROTANTE per la coda di Phase B.
//
// Fino a MT74 Phase B prendeva sempre `order(created_at).limit(50)` e poi
// `slice(0,25)`: sempre i 25 piu' vecchi. Quei 25 restano pending perche'
// hanno SKU non mappati o domande bloccanti, quindi ogni giro di cron
// riselezionava esattamente gli stessi e i documenti oltre la posizione 25
// non venivano raggiunti MAI. Misurato dopo il batch 3: 31 pending
// acquistabili, 6 (posizioni 26-31) mai visitati:
//   0003099324  0003128936  0003168282  0003198361  0003243454  0003272475
//
// Da non confondere con la composizione DOPO il fix: li' la pagina 1
// contiene 8 candidate rows, ma due di quelle (0003015274 e 0003055973)
// erano gia' visitate dal vecchio algoritmo. Gli affamati erano 6, non 8.
//
// Il difetto non e' il numero 25, e alzarlo non lo risolve: lo sposta piu'
// in la'. Il difetto e' che la coda non ha memoria ne' rotazione, quindi
// l'insieme visitato e' una funzione costante.
//
// Qui la rotazione e' STATELESS: la pagina si deriva dall'orologio, non da
// un cursore da persistere ne' da una colonna da aggiungere. Niente schema
// change, nessuna scrittura in piu', e updated_at continua a significare
// "ultima modifica vera" invece di "ultima volta che il cron ci e' passato
// sopra".
//
// LA GARANZIA, nella forma esatta in cui vale:
//   a insieme ordinato STABILE, tutte le candidate rows vengono visitate
//   entro ceil(total / pageSize) tick consecutivi.
// Le pagine piastrellano l'insieme ordinato (pagina k = righe
// [k*size, k*size+size-1]), quindi la copertura di un ciclo e' completa.
// Sotto churn arbitrario della coda NON vale niente di piu' forte: quando
// una riga esce dai pending le posizioni scalano, e una riga vicino al
// confine di pagina puo' saltare un ciclo. Non e' starvation — l'insieme
// dei pending permanenti e' stabile per definizione — ma non va spacciata
// per una garanzia matematica che non c'e'.
//
// COSA CONTA UNA PAGINA: righe SQL, non preflight. Il .range() lavora sulla
// query prima di isPurchasableDocument(), quindi una pagina contiene al
// massimo PHASE_B_PAGE_SIZE CANDIDATE ROWS e puo' produrre meno preflight,
// se alcune vengono scartate dal filtro. La fairness e' dimostrata su quella
// popolazione: le pagine piastrellano l'insieme SQL, quindi ogni candidate
// row entra in una pagina e ogni purchasable viene raggiunto.
//
// La finestra decide solo QUANDO una riga viene esaminata, mai SE e'
// importabile: quella resta interamente responsabilita' di vdaiPreflight e
// vdaiApprove, che non cambiano.
// ══════════════════════════════════════════════════════════════════
const PHASE_B_PAGE_SIZE = 25;
const PHASE_B_TICK_MS = 5 * 60 * 1000;   // il periodo del pg_cron jobid 19

function vdaiPhaseBWindow(pendingTotal: number, nowMs: number, pageSize?: number) {
  const size = pageSize && pageSize > 0 ? pageSize : PHASE_B_PAGE_SIZE;
  const total = pendingTotal > 0 ? pendingTotal : 0;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.abs(Math.floor(nowMs / PHASE_B_TICK_MS)) % pages;
  return { page, pages, size, from: page * size, to: page * size + size - 1 };
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
  // MICRO-TASK 71/72 — le due eccezioni di riconciliazione BEK devono
  // fermare il preflight per DECISIONE, non per effetto collaterale.
  //
  // Entrambi i rami che le scrivono aggiornano SOLO status e warnings e non
  // riscrivono parsed_json, che resta { source }. Senza document_type nel
  // JSON, isPurchasableDocument() e' falso: vdaiPreflight esce subito con un
  // ok:true vuoto e vdaiApprove rifiuta con 'not_invoice'. Il documento non
  // veniva importato, ma per un dato MANCANTE, non per il warning.
  //
  // Misurato (MT72): allo stesso documento, con lo stesso warning, basta un
  // parsed_json completo con buyer di cucina e SKU mappati perche'
  // vdaiApprove ritorni ok e scriva le invoice_lines. La protezione era
  // un'assenza, e le assenze si riempiono: il ramo che oggi non scrive
  // parsed_json potrebbe scriverlo domani, e il reprocess dalla UI di review
  // lo scrive gia'. Nominare qui i due codici rende la barriera esplicita e
  // indipendente da quel dettaglio.
  //
  // NOTA: la prima versione di questo commento (MT71) attribuiva il blocco al
  // buyer guard del preflight. Era sbagliato — il buyer guard non viene mai
  // raggiunto, perche' l'uscita per isPurchasableDocument viene prima.
  if (code === 'BEK_REVISION_UNKNOWN' || code === 'BEK_REVISION_AFTER_IMPORT') return true;
  // MICRO-TASK 78 — un documento BEK senza Sales Order non ha identita'.
  //
  // Il parser canonico emette gia' BEK_NO_SALES_ORDER con severity 'blocking'
  // (js/vendor-parsers/ben-e-keith-order-confirmation.js:480-487), ma il codice
  // non era nominato qui e cadeva nel `return false` dei codici sconosciuti:
  // la barriera esisteva nel parser e non fermava niente. In piu', fino a MT78
  // il fallback su subject riempiva comunque il buco con il Customer# 770366,
  // quindi a valle non mancava nulla e l'assenza era invisibile.
  //
  // Da MT78 quel fallback restituisce null su un subject senza numero isolato
  // (BEK ";null", gia' visto in produzione). Senza QUESTA riga il null sarebbe
  // peggio del numero sbagliato: le tre barriere di identita' sono tutte
  // condizionate a `if (docNumber && ...)` — sezione F (:438), dedup (:551),
  // riconciliazione (:563) — quindi un documento senza numero le salterebbe
  // tutte e arriverebbe all'import senza mai passare dalla riconciliazione
  // delle revisioni. Le due cose vanno insieme: il fallback smette di
  // inventare, e l'assenza diventa una domanda aperta bloccante.
  //
  // Stessa forma di MT71/MT72: si blocca per DECISIONE, non per un dato
  // mancante. La copia UI di questa classificazione e' il ramo
  // BEK_NO_SALES_ORDER in vdrWarningToQuestion() — vanno in lockstep.
  if (code === 'BEK_NO_SALES_ORDER') return true;
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

async function vdaiPreflight(sb: any, doc: any): Promise<{ ok: boolean; unmatchedCount: number; reason?: string; conflicts?: any[] }> {
  if (await hasBlockingQuestion(sb, doc)) return { ok: false, unmatchedCount: 0, reason: 'open_question' };

  const pj = doc.parsed_json || {};
  const vendor = pj.vendor || doc.vendor || '';
  const items: any[] = pj.items || [];
  // MICRO-TASK 42 — was `pj.document_type !== 'invoice'`. Ben E. Keith
  // order_confirmation IS a purchase and must go through the real
  // preflight (matching, aliases, conflicts), not be waved through as
  // trivially clean. Every other vendor's order_confirmation keeps the
  // previous behaviour exactly.
  if (!isPurchasableDocument(vendor, pj.document_type)) return { ok: true, unmatchedCount: 0 };

  // MICRO-TASK 48 — buyer guard, defence in depth. Phase A already routes
  // a non-kitchen BEK order to 'ignored' before it can ever reach here, so
  // this is not the primary gate. It exists because vdaiApprove is callable
  // on its own (the review UI, a manual re-run, a future caller): a front
  // of house order must never become a kitchen purchase by any path, and a
  // buyer nobody recognises must never be guessed either way.
  if (parsersApi().isBenEKeith(vendor)) {
    const buyerClass = parsersApi().classifyBuyer(pj.buyer_email);
    if (buyerClass !== parsersApi().BUYER_KITCHEN) {
      return {
        ok: false,
        unmatchedCount: 0,
        reason: buyerClass === parsersApi().BUYER_EXCLUDED ? 'BEK_BUYER_EXCLUDED' : 'BEK_BUYER_NOT_ALLOWED',
      };
    }
  }

  const matchableItems = items.filter((i) => !(i.line_type && i.line_type !== 'product'));
  const descs = matchableItems.map((i) => i.description || i.raw_description).filter(Boolean);
  const skus = matchableItems.map((i) => i.vendor_sku || i.item_code).filter(Boolean);

  // MICRO-TASK 40 — fetch ingredient_id alongside vendor_sku (not just
  // presence) so a real identity conflict between vendor_item_aliases and
  // direct ingredient_vendors can be told apart from a normal match. Same
  // two queries as before, one extra column each — no new round trip.
  const [aliasRows, legacyRows] = skus.length
    ? await Promise.all([
        sb.from('vendor_item_aliases').select('vendor_sku,ingredient_id').eq('vendor', vendor).eq('active', true).in('vendor_sku', skus),
        sb.from('ingredient_vendors').select('vendor_sku,ingredient_id').eq('vendor', vendor).in('vendor_sku', skus),
      ])
    : [{ data: [] }, { data: [] }];
  const aliasIdBySku: Record<string, string> = {};
  (aliasRows.data || []).forEach((r: any) => { if (r.vendor_sku) aliasIdBySku[r.vendor_sku] = r.ingredient_id; });
  const directIdBySku: Record<string, string> = {};
  (legacyRows.data || []).forEach((r: any) => { if (r.vendor_sku) directIdBySku[r.vendor_sku] = r.ingredient_id; });

  // CASE C (MICRO-TASK 40 spec) — a SKU where the durable alias and the
  // direct ingredient_vendors row genuinely disagree on ingredient_id.
  // Blocking, same tier as open_question: the document is left pending,
  // never silently imported with price attributed to either guess. This
  // never auto-resolves and is never fixed by this code — a human decides
  // which identity is correct (see MICRO-TASK 39 audit for the 3 known
  // Hardie's cases as of this writing: 03252, 03257, 71898).
  const conflicts = skus
    .filter((sku) => aliasIdBySku[sku] && directIdBySku[sku] && aliasIdBySku[sku] !== directIdBySku[sku])
    .map((sku) => ({ vendor, vendor_sku: sku, direct_ingredient_id: directIdBySku[sku], alias_ingredient_id: aliasIdBySku[sku] }));
  if (conflicts.length) {
    return { ok: false, unmatchedCount: 0, reason: 'PRICE_IDENTITY_CONFLICT', conflicts } as any;
  }

  const matchedSkus = new Set([...Object.keys(aliasIdBySku), ...Object.keys(directIdBySku)]);

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

// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 40 — alias-aware price intelligence + chronological safety.
// Two small, pure, independently-testable helpers used by vdaiApprove's
// price-intelligence write loop below. Frozen spec (do not reinterpret):
//
//   CASE A — direct ingredient_vendors row exists for this SKU, and if an
//            alias also exists for it, the two agree on ingredient_id
//            → use the direct row normally.
//   CASE B — no direct row for this SKU, but an active vendor_item_aliases
//            row does → the alias is a valid identity. Resolve the
//            CANONICAL ingredient_vendors row for (vendor, alias
//            ingredient_id) — same lookup already used by the
//            ingredient_links fallback — and update/migrate/insert it.
//            Never a second row for the same vendor+ingredient.
//   CASE C — direct row exists AND an alias exists AND they name a
//            DIFFERENT ingredient_id → PRICE_IDENTITY_CONFLICT. Price
//            intelligence must not guess; this is caught earlier by
//            vdaiPreflight (blocking, whole document left pending) and
//            re-checked here defensively so this function is safe to
//            call from any future caller that skips preflight.
//   ingredient_links stays the fallback, used ONLY when neither a direct
//   row nor an alias resolves the SKU at all (case: 'none' below).
// ══════════════════════════════════════════════════════════════════
type PriceIntelResolution =
  | { case: 'A'; row: { id: string; ingredient_id: string; vendor_sku: string; last_invoice_date?: string | null } }
  | { case: 'B'; ingredientId: string }
  | { case: 'C'; directIngredientId: string; aliasIngredientId: string }
  | { case: 'none' };

function resolvePriceIntelIdentity(
  sku: string | null,
  skuMap: Record<string, { id: string; ingredient_id: string; vendor_sku: string; last_invoice_date?: string | null }>,
  aliasIdMap: Record<string, string>,
): PriceIntelResolution {
  if (!sku) return { case: 'none' };
  const direct = skuMap[sku];
  const aliasIngredientId = aliasIdMap[sku];
  if (direct && aliasIngredientId && aliasIngredientId !== direct.ingredient_id) {
    return { case: 'C', directIngredientId: direct.ingredient_id, aliasIngredientId };
  }
  if (direct) return { case: 'A', row: direct };
  if (aliasIngredientId) return { case: 'B', ingredientId: aliasIngredientId };
  return { case: 'none' };
}

// Chronological guard (MICRO-TASK 40, FASE 2) — applies uniformly to
// every existing-row UPDATE path (direct SKU, alias-canonical, and
// ingredient_links), never to an INSERT (nothing to regress against
// when the row doesn't exist yet). A null existing last_invoice_date
// (the historically-frozen-row case, e.g. SCAFDUU10GA0) always allows
// the incoming write — there is nothing to protect yet. A null
// incoming invoiceDate can never satisfy ">=", so it never overwrites
// a dated row — fails closed, not open.
// MICRO-TASK 52B — la data autorevole non e' il campo di metadati, sono gli
// eventi d'acquisto gia' persistiti.
//
// MICRO-TASK 52A ha misurato 49 righe su 98 con last_invoice_date divergente
// dalla realta', e 32 con il campo a NULL: per quelle chronologyAllows
// ritornava true incondizionatamente, quindi una fattura del 26 giugno
// rigiocata oggi poteva sovrascrivere un prezzo di settembre.
//
// La causa e' che last_invoice_date viene scritto solo quando la price
// intelligence esegue davvero un update: ogni skip (chronology, identity
// conflict, SKU non risolto) lo lascia indietro mentre le invoice_lines
// avanzano. NON lo risolviamo avanzando la data anche sugli skip — sarebbe
// falso, uno skip per conflitto d'identita' non e' un acquisto osservato.
// Deriviamo invece la verita' dalle invoice_lines, che sono il registro
// reale degli acquisti gia' contabilizzati.
function effectiveLastDate(storedLastInvoiceDate: string | null | undefined,
                           authoritativeLatest: string | null | undefined): string | null {
  const stored = storedLastInvoiceDate || null;
  const auth   = authoritativeLatest   || null;
  if (!stored) return auth;
  if (!auth)   return stored;
  return auth > stored ? auth : stored;
}

function chronologyAllows(existingLastInvoiceDate: string | null | undefined, incomingInvoiceDate: string | null): boolean {
  if (!existingLastInvoiceDate) return true;
  if (!incomingInvoiceDate) return false;
  return incomingInvoiceDate >= existingLastInvoiceDate;
}

async function vdaiBackfillInvoiceLines(sb: any, vendor: string, vendorSku: string, ingredientId: string) {
  if (!sb || !vendor || !vendorSku || !ingredientId) return;
  await sb.from('invoice_lines').update({ ingredient_id: ingredientId, match_status: 'matched' }).eq('vendor', vendor).eq('vendor_sku', vendorSku).is('ingredient_id', null);
}

// ══════════════════════════════════════════════════════════════════
// writeInvoiceLines — MICRO-TASK 37. Extracted, unchanged, from
// vdaiApprove's own invoice_lines block (the exact same idempotency
// guard, the exact same row-building transformation, the exact same
// reconciliation check — nothing rewritten, nothing added). Reused by:
//   - vdaiApprove(), the normal pending→imported approval path, below
//   - vdaiRepairMissingInvoiceLines(), the historical-backfill repair
//     path for already-`imported` documents (MICRO-TASK 35/36 audit:
//     21 documents, 16 Hardie's + 5 Fruge, status='imported' with a
//     valid parsed_json but zero invoice_lines rows, from a pre-existing
//     bulk historical import that never wrote them)
// Deliberately scoped to ONLY invoice_lines. Never touches
// ingredient_vendors (no price intelligence, no last_invoice_date),
// vendor_item_aliases, invoice_warnings, parsed_json, or
// vendor_documents.status — none of those tables/fields appear
// anywhere in this function, by construction, so no caller of it can
// accidentally trigger any of that regardless of which document or
// document status it's called with.
// ══════════════════════════════════════════════════════════════════
async function writeInvoiceLines(
  sb: any,
  docId: string,
  items: any[],
  pj: any,
  invoiceDate: string | null,
  vendor: string,
  identitySkuMap: Record<string, any>,
  linkMap: Record<string, any>,
): Promise<{ ok: boolean; reason?: string; inserted?: number }> {
  // Idempotency guard — reuse pre-existing lines, exactly as before.
  const { data: existingLines } = await sb.from('invoice_lines').select('id').eq('import_id', docId).limit(1);
  if (existingLines && existingLines.length > 0) return { ok: true, reason: 'already_has_lines', inserted: 0 };

  const invoiceLineRows = items
    // MICRO-TASK 42, sections B and E — an item nobody confirmed was not
    // bought: it must not become a purchase line at all (rather than a
    // line with quantity 0). Only the BEK parser sets `purchasable`;
    // items without the field are untouched, so every other vendor keeps
    // exactly today's behaviour. The item still lives on in parsed_json,
    // so the document stays complete and auditable.
    .filter((item: any) => item.purchasable !== false)
    .map((item: any) => {
      const desc = item.description || item.raw_description || null;
      const sku = item.vendor_sku || item.item_code || null;
      // MICRO-TASK 42, section J — `item.qty` first. It is the quantity a
      // parser explicitly declares as the PURCHASED amount. Without it
      // this expression preferred qty_ordered, which for a Ben E. Keith
      // short delivery would persist what we asked for instead of what
      // the vendor confirmed (ordered 3 / confirmed 2 would store 3
      // against a line_total computed from 2). ORDERED is never a
      // fallback for BEK.
      // No behaviour change elsewhere: Walmart sets qty === qty_ordered
      // === qty_received, and no other parser emits `qty` at all, so they
      // all fall through to the original precedence unchanged.
      const qty = item.catchweight === true ? 1 : item.qty != null ? item.qty : item.qty_ordered != null ? item.qty_ordered : item.qty_received != null ? item.qty_received : null;
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
    .filter((r: any) => r.raw_description);

  if (!invoiceLineRows.length) return { ok: false, reason: 'no invoice lines extractable' };

  const { error: ilErr } = await sb.from('invoice_lines').insert(invoiceLineRows);
  if (ilErr) return { ok: false, reason: 'invoice_lines insert failed: ' + ilErr.message };

  // ── MICRO-TASK 42, section D — reconcile against the RIGHT total ────
  // The rows just built carry the PURCHASE value. For most vendors that
  // equals the document's declared total, so `pj.total` is correct and
  // nothing changes. For a Ben E. Keith order_confirmation the declared
  // "Order Total" is an ORDER-time figure (measured on 4 real documents:
  // it equals Σ price×ordered, even where confirmed is 0 throughout), so
  // comparing persisted lines against it would fail EVERY short delivery
  // — e.g. ordered 3 / confirmed 2 / price 10 / declared 30 would compare
  // 20 vs 30 and refuse a perfectly valid import.
  //
  // A parser that knows the two differ publishes computed_purchase_total;
  // that is what the persisted rows must add up to. Document-level
  // integrity (ordered sum vs declared total) is checked separately, by
  // the parser itself, with this same $0.02 tolerance. Both checks stay
  // alive — neither is disabled.
  const expectedTotal = (pj.computed_purchase_total != null && !isNaN(parseFloat(pj.computed_purchase_total)))
    ? parseFloat(pj.computed_purchase_total)
    : (pj.total != null && !isNaN(parseFloat(pj.total)) ? parseFloat(pj.total) : null);

  if (expectedTotal != null) {
    const RECONCILIATION_TOLERANCE = 0.02;
    const sumLineTotals = Math.round(invoiceLineRows.reduce((s: number, r: any) => s + (r.line_total || 0), 0) * 100) / 100;
    if (Math.abs(sumLineTotals - expectedTotal) > RECONCILIATION_TOLERANCE) {
      return { ok: false, reason: `reconciliation failed: lines sum $${sumLineTotals.toFixed(2)} vs document total $${expectedTotal.toFixed(2)}` };
    }
  }

  return { ok: true, inserted: invoiceLineRows.length };
}

async function vdaiApprove(sb: any, docId: string): Promise<{ ok: boolean; reason?: string }> {
  const { data: doc, error: fetchErr } = await sb.from('vendor_documents').select('parsed_json,vendor,warnings,status,document_number,document_date').eq('id', docId).single();
  if (fetchErr) return { ok: false, reason: fetchErr.message };

  // Idempotency guard #1 — never re-approve an already-imported doc.
  if (doc.status === 'imported') return { ok: true, reason: 'already_imported' };
  if (doc.status !== 'pending') return { ok: false, reason: 'not_pending' };

  const pj = doc.parsed_json || {};
  // MICRO-TASK 42 — reason string kept as 'not_invoice' on purpose: it is
  // asserted by tests/vendor-doc-auto-import.test.js and consumed as an
  // opaque marker elsewhere. What changed is WHICH documents reach it.
  if (!isPurchasableDocument(pj.vendor || doc.vendor || '', pj.document_type)) {
    return { ok: false, reason: 'not_invoice' };
  }

  // MICRO-TASK 42 — a Ben E. Keith acknowledgement (every line Requested,
  // confirmed 0) is not a purchase: nothing has been confirmed yet. It is
  // parked as 'ignored' rather than imported or queued as an exception —
  // the real confirmation arrives later under the same Sales Order. The
  // 'ambiguous' class (confirmed 0 but statuses NOT uniformly Requested,
  // e.g. Cancelled) deliberately does NOT land here: it fails closed as a
  // blocking warning so a human looks at it.
  if (pj.document_class === 'acknowledgement') {
    await sb.from('vendor_documents').update({ status: 'ignored' }).eq('id', docId);
    return { ok: true, reason: 'acknowledgement_not_a_purchase' };
  }

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

  // MICRO-TASK 40: skuRes and ingrVendorRes now also select
  // last_invoice_date — required by the chronological guard below. No
  // new query, same two ingredient_vendors reads as before, one extra
  // column each.
  const [skuRes, aliasRes, ingrVendorRes, linkRes] = await Promise.all([
    skus.length ? sb.from('ingredient_vendors').select('id,ingredient_id,vendor_sku,last_invoice_date,conversion_to_base,pack_description,price_per_100g').eq('vendor', vendor).in('vendor_sku', skus) : { data: [] },
    skus.length ? sb.from('vendor_item_aliases').select('vendor_sku,ingredient_id').eq('vendor', vendor).eq('active', true).in('vendor_sku', skus) : { data: [] },
    sb.from('ingredient_vendors').select('id,ingredient_id,vendor_sku,last_invoice_date,conversion_to_base,pack_description,price_per_100g').eq('vendor', vendor),
    descs.length ? sb.from('ingredient_links').select('invoice_description,ingredient_id').eq('vendor', vendor).eq('confirmed', true).in('invoice_description', descs) : { data: [] },
  ]);

  // MICRO-TASK 52B — ultima invoice_date realmente persistita, per identita'.
  // Due letture limitate agli SKU/ingredienti di QUESTO documento: per
  // vendor_sku (identita' diretta) e per ingredient_id (identita' canonica
  // usata dai rami alias e ingredient_links). Nessuna scansione completa.
  // Le righe senza data sono scartate dai riduttori qui sotto.
  const identIngredientIds = [...new Set([
    ...(aliasRes.data || []).map((r: any) => r.ingredient_id),
    ...(linkRes.data  || []).map((r: any) => r.ingredient_id),
  ].filter(Boolean))];

  const [authBySkuRes, authByIngrRes] = await Promise.all([
    skus.length
      ? sb.from('invoice_lines').select('vendor_sku,invoice_date').eq('vendor', vendor).in('vendor_sku', skus)
      : { data: [] },
    identIngredientIds.length
      ? sb.from('invoice_lines').select('ingredient_id,invoice_date').eq('vendor', vendor).in('ingredient_id', identIngredientIds)
      : { data: [] },
  ]);

  const authLatestBySku: Record<string, string> = {};
  (authBySkuRes.data || []).forEach((r: any) => {
    if (!r.vendor_sku || !r.invoice_date) return;
    if (!authLatestBySku[r.vendor_sku] || r.invoice_date > authLatestBySku[r.vendor_sku]) authLatestBySku[r.vendor_sku] = r.invoice_date;
  });
  const authLatestByIngredient: Record<string, string> = {};
  (authByIngrRes.data || []).forEach((r: any) => {
    if (!r.ingredient_id || !r.invoice_date) return;
    if (!authLatestByIngredient[r.ingredient_id] || r.invoice_date > authLatestByIngredient[r.ingredient_id]) authLatestByIngredient[r.ingredient_id] = r.invoice_date;
  });

  const skuMap: Record<string, any> = {};
  (skuRes.data || []).forEach((r: any) => { skuMap[r.vendor_sku] = r; });
  const identitySkuMap: Record<string, any> = Object.assign({}, skuMap);
  (aliasRes.data || []).forEach((r: any) => { if (r.vendor_sku) identitySkuMap[r.vendor_sku] = { ingredient_id: r.ingredient_id, vendor_sku: r.vendor_sku }; });
  // MICRO-TASK 40: aliasIdMap is a SEPARATE plain sku->ingredient_id map
  // (unlike identitySkuMap above, which already merges alias over direct
  // for invoice_lines matching) — the price-intelligence resolver below
  // needs BOTH the direct match and the alias match visible side by side
  // to tell CASE A/B apart from a genuine CASE C conflict.
  const aliasIdMap: Record<string, string> = {};
  (aliasRes.data || []).forEach((r: any) => { if (r.vendor_sku) aliasIdMap[r.vendor_sku] = r.ingredient_id; });
  const ingrVendorMap: Record<string, any> = {};
  (ingrVendorRes.data || []).forEach((r: any) => { ingrVendorMap[r.ingredient_id] = { id: r.id, vendor_sku: r.vendor_sku, last_invoice_date: r.last_invoice_date }; });
  const linkMap: Record<string, any> = {};
  (linkRes.data || []).forEach((l: any) => { linkMap[l.invoice_description] = l.ingredient_id; });

  const toUpdate: any[] = [];
  const toInsert: any[] = [];
  const backfillTargets: { vendor: string; vendor_sku: string; ingredient_id: string }[] = [];

  if (isPurchasableDocument(pj.vendor || doc.vendor || '', pj.document_type)) {
    const processedIds = new Set<string>();
    for (const item of items) {
      if (item.line_type && item.line_type !== 'product') continue;
      // MICRO-TASK 42, section E — an item nobody confirmed was not
      // bought, so it must never move price intelligence or create an
      // ingredient_vendors row. `purchasable` is set by the BEK parser
      // (confirmed > 0); parsers that don't set it are unaffected, so
      // every existing vendor behaves exactly as before.
      if (item.purchasable === false) continue;
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

      // MICRO-TASK 88A — quello che QUESTO documento osserva. Non e'
      // piu' direttamente cio' che si scrive: mergePriceIntelligence lo
      // confronta con la riga esistente e decide, perche' un documento
      // che non sa dire i grammi non deve cancellare quelli che sappiamo
      // gia'. Su una riga nuova (nessun `existing`) il risultato e'
      // identico ai valori qui sotto, campo per campo.
      const observation = {
        unit_price: price,
        pack_description: effectivePack,
        price_type: priceType,
        conversion_to_base: convBase ? Math.round(convBase) : null,
        price_per_100g: per100g,
        last_invoice_date: invoiceDate,
      };
      // MICRO-TASK 88A.1 — ritorna null quando la decisione e' di NON
      // scrivere (caso 3: il documento dichiara una cassa diversa e non
      // sappiamo quanto pesa). Ogni ramo qui sotto deve rispettarlo: una
      // riga saltata resta com'era, per intero.
      const mergeFor = (existingRow: any) => {
        const m = parsersApi().priceIntel.mergePriceIntelligence(existingRow, observation);
        if (m.skipped) {
          console.log('[price-intel] unresolved_pack_change — price intelligence saltata', {
            vendor, sku, observed_pack: m.observedPack, stored_pack: m.storedPack,
            pack_class: m.packClass, kept_conversion: existingRow && existingRow.conversion_to_base,
          });
          return null;
        }
        if (m.rescued) {
          console.log('[price-intel] osservazione senza grammi, conversione preservata', {
            vendor, sku, observed_pack: effectivePack, pack_class: m.packClass, reason: m.reason,
            kept_conversion: m.fields.conversion_to_base, kept_pack: m.fields.pack_description,
          });
        }
        return m.fields;
      };

      // MICRO-TASK 40 — CASE A/B/C resolution (see resolvePriceIntelIdentity
      // doc comment). Replaces the old direct-SKU-only check; the
      // ingredient_links fallback below is now reached ONLY on 'none'.
      const resolution = resolvePriceIntelIdentity(sku, skuMap, aliasIdMap);

      if (resolution.case === 'C') {
        // Should never actually reach here in the normal Phase B flow —
        // vdaiPreflight already blocks the whole document (reason:
        // 'PRICE_IDENTITY_CONFLICT') before vdaiApprove is ever called.
        // Kept as a defensive no-op so this function stays safe on its
        // own, e.g. if a future caller skips preflight. Never writes
        // price under either the direct or the alias identity.
        console.log('[price-intel] PRICE_IDENTITY_CONFLICT skip', { vendor, sku, direct_ingredient_id: resolution.directIngredientId, alias_ingredient_id: resolution.aliasIngredientId });
        continue;
      }

      if (resolution.case === 'A') {
        const row = resolution.row;
        const ingrId = row.ingredient_id;
        if (processedIds.has(ingrId)) continue;
        processedIds.add(ingrId);
        const effA = effectiveLastDate(row.last_invoice_date, authLatestBySku[row.vendor_sku] || authLatestByIngredient[ingrId]);
        if (!chronologyAllows(effA, invoiceDate)) {
          console.log('[price-intel] chronology skip (direct SKU)', { vendor, sku, stored: row.last_invoice_date, effective: effA, incoming: invoiceDate });
          continue;
        }
        const fA = mergeFor(row);
        if (fA) toUpdate.push({ id: row.id, ...fA });
        continue;
      }

      if (resolution.case === 'B') {
        const ingrId = resolution.ingredientId;
        if (processedIds.has(ingrId)) continue;
        processedIds.add(ingrId);
        const canonical = ingrVendorMap[ingrId];
        if (canonical) {
          const effB = effectiveLastDate(canonical.last_invoice_date, authLatestByIngredient[ingrId] || authLatestBySku[canonical.vendor_sku]);
          if (!chronologyAllows(effB, invoiceDate)) {
            console.log('[price-intel] chronology skip (alias→canonical)', { vendor, sku, stored: canonical.last_invoice_date, effective: effB, incoming: invoiceDate });
            continue;
          }
          if (canonical.vendor_sku !== sku) {
            // FASE 3 — alias-confirmed SKU migration onto the existing
            // canonical row (e.g. SCAFDUU10GA0 → SCAFDUU10BRO). Same row,
            // never a duplicate: vendor_sku is repointed in place.
            // Se la price intelligence viene saltata, si salta anche la
            // migrazione del vendor_sku e il backfill che ne dipende:
            // altrimenti resterebbe un legame che la riga canonica non
            // rispecchia.
            const fBm = mergeFor(canonical);
            if (fBm) {
              toUpdate.push({ id: canonical.id, vendor_sku: sku, ...fBm });
              if (sku) backfillTargets.push({ vendor, vendor_sku: sku, ingredient_id: ingrId });
            }
          } else {
            const fB = mergeFor(canonical);
            if (fB) toUpdate.push({ id: canonical.id, ...fB });
          }
        } else {
          // No canonical row anywhere for this ingredient yet — first
          // price data point via this alias. Plain insert, nothing to
          // regress against.
          // Un INSERT non ha niente da proteggere, quindi mergeFor non
          // puo' saltare; il controllo resta comunque esplicito, cosi'
          // nessun ramo scrive mai senza averlo guardato.
          const fBi = mergeFor(null);
          if (fBi) toInsert.push({ ingredient_id: ingrId, vendor, vendor_sku: sku, active: true, ...fBi });
          if (sku) backfillTargets.push({ vendor, vendor_sku: sku, ingredient_id: ingrId });
        }
        continue;
      }

      // resolution.case === 'none' — fall back to ingredient_links,
      // exactly as before, now under the same chronological guard.
      const linkedId = linkMap[desc];
      if (!linkedId || processedIds.has(linkedId)) continue;
      processedIds.add(linkedId);

      const existingIv = ingrVendorMap[linkedId];
      if (existingIv) {
        const decision = vdrDecideCanonicalUpdateLite(existingIv.vendor_sku, sku);
        if (decision === 'update' || decision === 'populate_sku') {
          const effC = effectiveLastDate(existingIv.last_invoice_date, authLatestByIngredient[linkedId] || authLatestBySku[existingIv.vendor_sku]);
          if (!chronologyAllows(effC, invoiceDate)) {
            console.log('[price-intel] chronology skip (ingredient_links)', { vendor, sku, desc, stored: existingIv.last_invoice_date, effective: effC, incoming: invoiceDate });
            continue;
          }
          if (decision === 'update') {
            const fC = mergeFor(existingIv);
            if (fC) toUpdate.push({ id: existingIv.id, ...fC });
          } else {
            const fCp = mergeFor(existingIv);
            if (fCp) {
              toUpdate.push({ id: existingIv.id, vendor_sku: sku, ...fCp });
              if (sku) backfillTargets.push({ vendor, vendor_sku: sku, ingredient_id: linkedId });
            }
          }
        }
        // decision === 'skip' — unchanged: canonical row deliberately left alone.
      } else {
        // Un INSERT non ha niente da proteggere, quindi mergeFor non
        // puo' saltare; il controllo resta comunque esplicito, cosi'
        // nessun ramo scrive mai senza averlo guardato.
        const fCi = mergeFor(null);
        if (fCi) toInsert.push({ ingredient_id: linkedId, vendor, vendor_sku: sku, active: true, ...fCi });
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

  // ── invoice_lines — extracted to writeInvoiceLines() (MICRO-TASK 37) ──
  // Same idempotency guard, same row-building, same reconciliation —
  // just no longer inlined here, so the identical logic can also be
  // reused by the repair path below without duplicating it by hand.
  const linesResult = await writeInvoiceLines(sb, docId, items, pj, invoiceDate, vendor, identitySkuMap, linkMap);
  if (!linesResult.ok) return { ok: false, reason: linesResult.reason };

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
  const UNIT_TO_G: Record<string, number> = { LB: 453.592, LBS: 453.592, '#': 453.592, OZ: 28.3495, GAL: 3785.41, ML: 1, LTR: 1000, L: 1000, KG: 1000, G: 1 };
  let m = s.match(/^(\d+)\s*\/\s*(\d+(?:\.\d+)?)\s*(LB|LBS|#|OZ|GAL|ML|LTR|L|KG|G)\s*$/);
  if (m) return parseFloat(m[1]) * parseFloat(m[2]) * (UNIT_TO_G[m[3]] || 0);
  m = s.match(/^(\d+(?:\.\d+)?)\s*(LB|LBS|#|OZ|GAL|KG|G|ML|LTR|L)\s*$/);
  if (m) return parseFloat(m[1]) * (UNIT_TO_G[m[2]] || 0);
  return null;
}

// ══════════════════════════════════════════════════════════════════
// vdaiRepairMissingInvoiceLines — MICRO-TASK 37. A standalone repair
// path for the exact opposite situation vdaiApprove handles: a
// document that is ALREADY status='imported' (vdaiApprove refuses
// these outright — "Idempotency guard #1" above) but whose
// invoice_lines were never written, from a pre-existing bulk
// historical import that set status='imported' without ever running
// the normal write path (MICRO-TASK 35/36 audit: 21 such documents,
// 16 Hardie's + 5 Fruge, all dated 2026-05-26..2026-06-22).
//
// This function's status guard is the mirror image of vdaiApprove's:
// it requires status === 'imported' and does nothing for 'pending' —
// the two paths can never both fire on the same document. It NEVER
// touches vendor_documents (status or any other column) and NEVER
// runs the ingredient_vendors price-intelligence block — that whole
// block (source lines ~526-609 of vdaiApprove above) is simply absent
// here, not merely skipped by a flag, so there is no code path by
// which calling this function can regress last_invoice_date or
// current price, or touch vendor_item_aliases, or write
// invoice_warnings, or modify parsed_json. Matching (identitySkuMap /
// linkMap) is rebuilt read-only from the exact same tables/queries
// vdaiApprove already uses, so an unmatched SKU is handled exactly
// the same way (match_status:'unmatched', ingredient_id:null) —
// never invented, never silently forced to match.
// ══════════════════════════════════════════════════════════════════
async function vdaiRepairMissingInvoiceLines(sb: any, docId: string, dryRun: boolean): Promise<{ ok: boolean; reason?: string; inserted?: number }> {
  const { data: doc, error: fetchErr } = await sb.from('vendor_documents').select('parsed_json,vendor,status,document_number,document_date').eq('id', docId).single();
  if (fetchErr) return { ok: false, reason: fetchErr.message };

  // Mirror-image guard of vdaiApprove's — this path exists ONLY for
  // already-imported documents. Never for 'pending' (that's
  // vdaiApprove's job) and never for 'error'/'ignored'.
  if (doc.status !== 'imported') return { ok: false, reason: 'not_imported' };

  const pj = doc.parsed_json || {};
  // MICRO-TASK 42 — same generalisation as vdaiApprove; reason string
  // intentionally unchanged (asserted by existing tests).
  if (!isPurchasableDocument(pj.vendor || doc.vendor || '', pj.document_type)) {
    return { ok: false, reason: 'not_invoice' };
  }

  const vendor = pj.vendor || doc.vendor || 'Unknown';
  const invoiceDate = doc.document_date || null;
  const items: any[] = pj.items || [];

  const skus = items.map((i: any) => i.vendor_sku || i.item_code).filter(Boolean);
  const descs = items.map((i: any) => i.description || i.raw_description).filter(Boolean);

  // Same read-only matching lookups vdaiApprove builds — no
  // ingredient_vendors WRITE query here (that table is only ever
  // written by the price-intelligence block, which this path omits
  // entirely rather than merely skip).
  const [skuRes, aliasRes, linkRes] = await Promise.all([
    skus.length ? sb.from('ingredient_vendors').select('id,ingredient_id,vendor_sku').eq('vendor', vendor).in('vendor_sku', skus) : { data: [] },
    skus.length ? sb.from('vendor_item_aliases').select('vendor_sku,ingredient_id').eq('vendor', vendor).eq('active', true).in('vendor_sku', skus) : { data: [] },
    descs.length ? sb.from('ingredient_links').select('invoice_description,ingredient_id').eq('vendor', vendor).eq('confirmed', true).in('invoice_description', descs) : { data: [] },
  ]);

  const skuMap: Record<string, any> = {};
  (skuRes.data || []).forEach((r: any) => { skuMap[r.vendor_sku] = r; });
  const identitySkuMap: Record<string, any> = Object.assign({}, skuMap);
  (aliasRes.data || []).forEach((r: any) => { if (r.vendor_sku) identitySkuMap[r.vendor_sku] = { ingredient_id: r.ingredient_id, vendor_sku: r.vendor_sku }; });
  const linkMap: Record<string, any> = {};
  (linkRes.data || []).forEach((l: any) => { linkMap[l.invoice_description] = l.ingredient_id; });

  if (dryRun) {
    const { data: existingLines } = await sb.from('invoice_lines').select('id').eq('import_id', docId).limit(1);
    return { ok: true, reason: existingLines && existingLines.length > 0 ? 'already_has_lines' : 'would_repair', inserted: 0 };
  }

  return await writeInvoiceLines(sb, docId, items, pj, invoiceDate, vendor, identitySkuMap, linkMap);
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
    // MICRO-TASK 37 — an entirely separate, additive branch: the cron's
    // bare invocation never sets this, so Phase A/B below (and every
    // other vendor's behavior) is completely unaffected by its
    // existence. Only fires on an explicit, single-document request.
    const repairInvoiceLines: boolean = !!body.repair_invoice_lines;

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    if (repairInvoiceLines) {
      if (!documentId) return json({ ok: false, error: 'repair_invoice_lines requires document_id' }, 400);
      const repairResult = await vdaiRepairMissingInvoiceLines(sb, documentId, dryRun);
      return json({ ok: true, ms: Date.now() - started, repair: { id: documentId, dry_run: dryRun, ...repairResult } });
    }

    const parsers = loadParsers();

    const result = { phaseA: [] as any[], phaseB: [] as any[], dry_run: dryRun };

    // ── PHASE A: pdf_received → parsed ──
    // MICRO-TASK 42: created_at added — the BEK Sales Order revision rule
    // needs it to decide which revision is the newest/operative one.
    let qA = sb.from('vendor_documents').select('id,parsed_json,source_email_subject,raw_text,vendor,status,created_at,document_type');
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
    // MICRO-TASK 42 — was `.eq('document_type','invoice')`, which meant a
    // Ben E. Keith order_confirmation was never even selected. Widened to
    // the two types that CAN be purchases, then filtered in code by the
    // single source of truth, so the vendor rule is stated once instead of
    // being duplicated as a PostgREST filter string. Other vendors'
    // order_confirmations are fetched and immediately dropped below —
    // same outcome as before, no behaviour change for them.
    // MICRO-TASK 75 — la pagina da visitare ruota a ogni tick del cron, cosi'
    // nessuna candidate row resta fuori dalla finestra per sempre. Il
    // conteggio e' una head-query senza righe; il ramo documentId resta
    // quello di prima.
    //
    // FAIL CLOSED sul conteggio. `pendingTotal || 0` avrebbe trasformato un
    // errore della count in "zero pending", cioe' pages=1 e pagina 0: il
    // worker sarebbe tornato in silenzio esattamente al comportamento che
    // questa micro-task sta togliendo, e per giunta senza dirlo. Se non so
    // quante righe ci sono non so nemmeno che finestra usare, quindi Phase B
    // salta il giro. Non e' una perdita: il cron ripassa fra cinque minuti, e
    // saltare non puo' mai importare qualcosa di sbagliato.
    let finestra = { page: 0, pages: 1, size: PHASE_B_PAGE_SIZE, from: 0, to: PHASE_B_PAGE_SIZE - 1 };
    let saltaPhaseB = false;
    if (!documentId) {
      const { count: pendingTotal, error: countErr } = await sb.from('vendor_documents')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending').in('document_type', ['invoice', 'order_confirmation']);
      if (countErr || pendingTotal === null || pendingTotal === undefined) {
        saltaPhaseB = true;
        const motivo = countErr ? countErr.message : 'conteggio nullo';
        (result as any).phaseB_window = { skipped: true, reason: 'count_failed', error: motivo };
        console.error('[vdai] Phase B saltata: conteggio dei pending fallito:', motivo);
      } else {
        finestra = vdaiPhaseBWindow(pendingTotal, Date.now());
        // Senza questo, da fuori non si capisce quale pagina ha girato.
        (result as any).phaseB_window = { ...finestra, pending_total: pendingTotal };
      }
    }

    // L'ordine deve essere TOTALE, non solo per created_at: l'intake inserisce
    // piu' documenti nello stesso secondo (misurato: il batch 3 ne ha creati
    // 16 in 18 secondi) e due righe con lo stesso timestamp non hanno ordine
    // relativo garantito da Postgres. Senza il tiebreak su id, due pagine
    // consecutive potrebbero vedere la stessa riga due volte e saltarne
    // un'altra. `id` e' la primary key, quindi il tiebreak e' totale.
    let queueB: any[] = [];
    if (!saltaPhaseB) {
      // MICRO-TASK 76 — document_type NELLA SELECT. Il filtro qui sotto usa
      // `parsed_json.document_type || d.document_type`, ma quella colonna non
      // era selezionata: valeva undefined per ogni riga, quindi il fallback
      // non poteva funzionare. Finche' parsed_json.document_type c'e' nessuno
      // se ne accorge; i rami MT71 e MT72 pero' lasciano parsed_json a
      // { source }, e quei documenti venivano scartati PRIMA del preflight.
      // Osservato in produzione nel giro delle 23:25 del 19/09: pagina 1
      // aveva 8 candidate rows e solo 6 preflight, e i due mancanti erano
      // esattamente 0003243454 e 0003272475.
      // Phase A fa gia' la cosa giusta (qA seleziona document_type e
      // isBekBodyOnlySource usa lo stesso idioma): qui si allinea Phase B.
      let qB = sb.from('vendor_documents').select('id,parsed_json,vendor,document_type,warnings,status,document_number,document_date').eq('status', 'pending').in('document_type', ['invoice', 'order_confirmation']);
      qB = documentId ? qB.eq('id', documentId) : qB;
      qB = qB.order('created_at', { ascending: true }).order('id', { ascending: true });
      const { data: queueBRaw } = documentId
        ? await qB.limit(1)
        : await qB.range(finestra.from, finestra.to);
      queueB = (queueBRaw || []).filter((d: any) =>
        isPurchasableDocument((d.parsed_json && d.parsed_json.vendor) || d.vendor || '', (d.parsed_json && d.parsed_json.document_type) || d.document_type)
      ).slice(0, documentId ? 1 : finestra.size);
    }
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
