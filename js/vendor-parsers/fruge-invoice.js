// ── vendor-parsers/fruge-invoice.js ──────────────────────────
// Parser for Fruge Seafood INVOICE
//
// Formato colonne:
// Ordered | Product Description | Shipped | Unit Price | Amount
// Header:  INVOICE 855939 / Taken 09/14/26 / Shipped 09/14/26 / Invoiced 09/14/26
// Total:   "... Pay:  \n$828.25" (label and amount can land on different
//          physical PDF lines — matched against the whole text, not
//          per-line, for exactly this reason)
//
// MICRO-TASK 34 — root cause and fix
// -----------------------------------
// The previous version of this file hardcoded every quantity/price unit
// to "LB", on the theory that Fruge always sells and prices by the
// pound. Real invoices disprove that: the Shipped and Unit Price
// columns each carry their OWN unit independently — LB, BG (bag), GA
// (gallon), CA/CS (case), EA (each) — and the two don't have to match
// (e.g. LOBSTER below: ordered/shipped "1 CA", but priced "$27.50 LB").
// Hardcoding "LB" meant any line shipped in CA/BG/GA never matched at
// all and was silently dropped — invoice #855939 and #856363 happened
// to contain ZERO lines shipped in bare "LB", so they parsed to 0 items
// with no warning at all (the bug this task fixes). Invoice #854668
// only "worked" because 1 of its 5 real lines (BRANZINI) happened to
// use LB for both columns; the other 4 were being silently dropped by
// this file even though it reported no error.
//
// This version is ported, deliberately close to verbatim (regex and
// arithmetic unchanged, only var→const/let and the debug console.log
// calls removed), from the browser copy's `parseFrugeInvoice` /
// "FRUGE PARSER v5" in js/vendor-parser-ui.js — proven correct against
// real production data: invoice #854668's already-stored parsed_json
// (cost_per_lb, total_weight_lb, pack_description, catchweight — every
// field, for every one of its 5 real items) matches this logic's output
// exactly, byte for byte, confirming it is what actually parsed that
// invoice historically (not this file's previous version). See
// MICRO-TASK 34 report for the line-by-line verification against
// #854668, #855939 and #856363.
//
// Unit-derived weight (totalLb) is found three ways, depending on the
// Shipped unit — never invented, always read from text already on the
// invoice:
//   - Shipped in LB directly            → totalLb = the shipped qty itself.
//   - Shipped in BG/GA/GAL              → totalLb = shipped qty × the
//     "N lb" weight-per-unit printed in the description or (since the
//     description sometimes wraps to the next physical PDF line, e.g.
//     "BRISTOL, 8 LB GAL 8lb") one of the next 3 lines.
//   - Shipped in CA/CS                  → totalLb = shipped qty × the
//     "N x M lb" pack breakdown printed the same way (own description or
//     next few lines), e.g. "(5 X 2 LBS)", "10x2.5lb".
// When none of these is found (e.g. LOBSTER: "10lb" is glued to the
// product's own size descriptor, not a "N x M lb" case breakdown), the
// item is still extracted — sku/description/qty/unit_price/amount are
// never in doubt — just without a derived weight, so cost_per_100g
// stays null rather than guessing. This exactly matches the real,
// already-proven behavior for LOBSTER in #854668.

'use strict';

const { parseDate } = require('./utils');

const LINE_RE = /^\s*\d+(?:\.\d+)?\s+(LB|BG|GA|GAL|CA|CS|EA)\s+([A-Z0-9]{6,16})\s*[-\u2013]\s*(.+?)\s+(\d+(?:\.\d+)?)\s+(LB|BG|GA|GAL|CA|CS|EA)\s+\$?([\d,]+\.\d{2})\s+(?:LB|BG|GA|GAL|CA|CS|EA)\s+\$?([\d,]+\.\d{2})/i;

function parse(rawText) {
  const text = String(rawText || '');

  let invoiceNumber = null, invoiceDate = null, total = null;
  const invM = text.match(/INVOICE\s+(\d+)/i);          if (invM) invoiceNumber = invM[1];
  const invdM = text.match(/Invoiced\s+([\d\/]+)/i);    if (invdM) invoiceDate = parseDate(invdM[1]);
  // FIX (MICRO-TASK 34): matched against the whole text, not per-line —
  // "Pay:" and the dollar amount can land on different physical PDF
  // lines (confirmed real in #855939/#856363/#854668 alike), so a
  // per-line match silently found nothing and left total/subtotal null
  // for every Fruge invoice, not just the two failing ones.
  const payM = text.match(/Pay:\s*\$?([\d,]+\.\d{2})/i); if (payM) total = parseFloat(payM[1].replace(/,/g, ''));

  const lines = text.split('\n').map((l) => l.trim());
  const items = [];
  const warnings = [];

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LINE_RE);
    if (!m) continue;

    const sku = m[2];
    const descRaw = m[3].trim();
    const shpQty = parseFloat(m[4]);
    const shpUnit = m[5].toUpperCase();
    const unitPrice = parseFloat(m[6].replace(/,/g, ''));
    const amount = parseFloat(m[7].replace(/,/g, ''));

    let totalLb = null;

    if (shpUnit === 'LB') {
      // Catchweight — shipped already in LB.
      totalLb = shpQty;
    } else if (shpUnit === 'BG' || shpUnit === 'GA' || shpUnit === 'GAL') {
      const wm = descRaw.match(/(\d+(?:\.\d+)?)\s*lb\b/i);
      if (wm) {
        totalLb = shpQty * parseFloat(wm[1]);
      } else {
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          const nxt = lines[j].trim();
          if (LINE_RE.test(nxt)) break;
          const wm2 = nxt.match(/(\d+(?:\.\d+)?)\s*lb\b/i);
          if (wm2) { totalLb = shpQty * parseFloat(wm2[1]); break; }
        }
      }
    } else if (shpUnit === 'CA' || shpUnit === 'CS') {
      let mxm = descRaw.match(/(\d+)\s*[xX]\s*(\d+(?:\.\d+)?)\s*(?:LBS?|lb)/i);
      if (!mxm) {
        for (let k = i + 1; k < Math.min(i + 4, lines.length); k++) {
          const nxt2 = lines[k].trim();
          if (LINE_RE.test(nxt2)) break;
          mxm = nxt2.match(/(\d+)\s*[xX]\s*(\d+(?:\.\d+)?)\s*(?:LBS?|lb)/i);
          if (mxm) break;
        }
      }
      if (mxm) {
        totalLb = shpQty * parseFloat(mxm[1]) * parseFloat(mxm[2]);
      }
    }

    const packDesc = totalLb ? (parseFloat(totalLb.toFixed(2)) + ' LB') : (shpQty + ' ' + shpUnit);
    const costPerLb = totalLb ? (amount / totalLb) : null;
    const cost100g = costPerLb ? parseFloat(((costPerLb / 453.592) * 100).toFixed(4)) : null;

    const desc = descRaw
      .replace(/\d+(?:\.\d+)?\s*lb\b/gi, '')
      .replace(/GALLON/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    items.push({
      vendor_sku: sku,
      description: desc,
      raw_description: descRaw,
      qty_ordered: null,
      qty_received: shpQty,
      received_unit: shpUnit,
      pack_description: packDesc,
      total_weight_lb: totalLb ? parseFloat(totalLb.toFixed(4)) : null,
      unit_price: unitPrice,
      amount: amount,
      cost_per_lb: costPerLb ? parseFloat(costPerLb.toFixed(4)) : null,
      _cost_per_100g: cost100g,
      price_type: 'per_lb',
      catchweight: shpUnit === 'LB',
      warnings: [],
    });
  }

  // GUARD (MICRO-TASK 34) — a document index.js has already identified
  // as a Fruge invoice, with a real document number, that nonetheless
  // yields zero parseable line items must never be able to reach
  // preflight-clean. This is the exact failure mode that let #855939
  // and #856363 land in status='error' with warnings=null (silent —
  // no signal at all). Explicit, blocking, and named distinctly from
  // the generic PARSE_ERROR other vendors use, so it can never be
  // mistaken for the info-only "technical error" codes (see
  // isBlockingWarning() in edge-functions/vendor-doc-auto-import and
  // vdrWarningToQuestion() in js/vendor-documents-review.js — both
  // updated in this task to treat PARSE_ERROR_NO_LINES as blocking).
  if (items.length === 0) {
    warnings.push({
      code: 'PARSE_ERROR_NO_LINES',
      message: invoiceNumber
        ? `Fruge invoice #${invoiceNumber} recognized but 0 line items were parsed — layout may have changed`
        : 'Fruge invoice recognized but 0 line items were parsed — layout may have changed',
    });
  }

  return {
    vendor: 'Fruge Seafood',
    document_type: 'invoice',
    document_number: invoiceNumber,
    invoice_number: invoiceNumber,
    document_date: invoiceDate,
    invoice_date: invoiceDate,
    subtotal: total,
    total: total,
    items,
    warnings,
  };
}

module.exports = { parse };
