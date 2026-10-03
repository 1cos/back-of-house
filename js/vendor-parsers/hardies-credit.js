// ── vendor-parsers/hardies-credit.js ─────────────────────────
// Parser for Hardie's / Dairyland Produce CREDIT memo
// Document type: credit_memo
//
// Real format (from 00668419):
// QUANTITY  ITEM_CODE  DESCRIPTION         PACK  COOL  UNIT_PRICE  EXTENDED  RETURN_REASON
// 2         25265      CHZ MOZZ SHRED W/M  5#    USA   24.96       -49.92    5A
// Original Sales Order: 06991299

'use strict';

const {
  parseDate, parsePrice, parsePackSize, cleanDescription,
  isSkipLine, extractDocNumber, extractDocDate,
} = require('./utils');

// Credit line: QTY  ITEM_CODE  DESCRIPTION  PACK  [COOL]  UNIT_PRICE  AMOUNT  RETURN_CODE
const LINE_RE = /^(\d+)\s+(\d{5})\s+(.+?)\s{2,}(.+?)\s{1,}(?:(USA|MEX|CAN|CHI)\s+)?([\d,.]+)\s+(-?[\d,.]+)\s+([A-Z0-9]{1,3})?.*$/;
const LINE_RE2 = /^(\d+)\s+(\d{5})\s+(.{8,})$/;

// Credit codes from footer
const RETURN_CODE_LABELS = {
  NN: 'Do Not Need',
  SH: 'Short on Truck',
  NO: 'Did Not Order',
  OO: 'Over Ordered',
  MS: 'Mis-shipped',
  MK: 'Mis-keyed',
  '5A': 'Quality/Other',
};

function parse(rawText) {
  const warnings = [];
  const lines = rawText.split('\n').map(l => l.trim());

  // ── Header ────────────────────────────────────────────────
  const creditNumber   = extractDocNumber(lines, ['CREDIT']) || null;
  const creditDate     = extractDocDate(lines, ['DATE', 'ORDER DATE']) || null;

  // Original sales order reference
  let originalOrder = null;
  for (const line of lines) {
    const m = line.match(/Original Sales Order[:\s]+([\d]+)/i);
    if (m) { originalOrder = m[1]; break; }
  }

  // Total (negative)
  let total = null;
  for (const line of lines) {
    const m = line.match(/TOTAL\s+\$(-?[\d,]+\.?\d*)/i);
    if (m) { total = parsePrice(m[1]); break; }
  }

  // ── Item lines ────────────────────────────────────────────
  const items = [];

  for (const line of lines) {
    if (isSkipLine(line)) continue;
    if (/Original Sales Order/i.test(line)) continue;

    let m = line.match(LINE_RE);
    if (m) {
      const [, qtyStr, sku, descRaw, packRaw, origin, unitPriceStr, amountStr, returnCode] = m;
      const pack = parsePackSize(packRaw.trim());
      const returnLabel = returnCode ? (RETURN_CODE_LABELS[returnCode.toUpperCase()] || returnCode) : null;

      items.push({
        vendor_sku:       sku,
        raw_description:  descRaw.trim(),
        description:      cleanDescription(descRaw.trim()),
        qty_credited:     parseFloat(qtyStr),
        purchase_unit:    inferPurchaseUnit(pack),
        pack_description: packRaw.trim(),
        pack_qty:         pack ? pack.count : null,
        pack_unit:        pack ? pack.unit  : null,
        unit_price:       parsePrice(unitPriceStr),
        amount:           parsePrice(amountStr),   // negative
        origin:           origin || null,
        return_code:      returnCode || null,
        return_reason:    returnLabel,
        warnings:         [],
      });
      continue;
    }

    // Fallback
    m = line.match(LINE_RE2);
    if (m) {
      const [, qtyStr, sku, rest] = m;
      // Credit amounts are negative: "-49.92" or "49.92" at end
      const priceMatch = rest.match(/([\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})(?:\s+([A-Z0-9]{1,3}))?$/);
      if (priceMatch) {
        const rawDesc = rest.slice(0, rest.lastIndexOf(priceMatch[0])).trim();
        const parts   = rawDesc.split(/\s{2,}/);
        const packRaw = parts.length > 1 ? parts[parts.length-1] : '';
        const descRaw = parts.length > 1 ? parts.slice(0,-1).join(' ') : rawDesc;
        const pack    = parsePackSize(packRaw);
        const rc      = priceMatch[3] || null;

        items.push({
          vendor_sku:       sku,
          raw_description:  rawDesc.trim(),
          description:      cleanDescription(descRaw),
          qty_credited:     parseFloat(qtyStr),
          purchase_unit:    inferPurchaseUnit(pack),
          pack_description: packRaw.trim(),
          pack_qty:         pack ? pack.count : null,
          pack_unit:        pack ? pack.unit  : null,
          unit_price:       parsePrice(priceMatch[1]),
          amount:           parsePrice(priceMatch[2]),
          origin:           null,
          return_code:      rc,
          return_reason:    rc ? (RETURN_CODE_LABELS[rc.toUpperCase()] || rc) : null,
          warnings:         [],
        });
      }
    }
  }

  // OQR-001: Credit must be linked to original order
  if (!originalOrder) {
    warnings.push({
      code:    'OQR-001',
      message: 'Credit memo has no original order reference — manual linking required',
      field:   'original_order_number',
    });
  }

  if (!items.length) {
    warnings.push({ code:'PARSE_ERROR', message:'No credit line items found' });
  }

  return {
    vendor:               "Hardie's Fresh Foods / Dairyland Produce",
    document_type:        'credit_memo',
    credit_number:        creditNumber,
    credit_date:          creditDate,
    original_order_number:originalOrder,
    total,
    items,
    warnings,
  };
}

function inferPurchaseUnit(pack) {
  if (!pack) return null;
  const u = pack.unit;
  if (['ct','ea','each'].includes(u)) return 'each';
  if (['lb','lbs'].includes(u))       return 'lb';
  if (u === 'oz')                     return 'oz';
  return u || null;
}

// ── XCF-HARDIES — R.M.A. / PICK-UP SLIP ──────────────────────
// Hardie's manda due documenti diversi per un reso, e solo il secondo
// e' contabile:
//
//   1. "R.M.A. - #00682258" → PDF intestato PICK-UP SLIP. E' la
//      richiesta di ritiro: quantita', SKU, codice reso, ordine
//      originale. NON ha prezzo, NON ha importo, il TOTAL e' vuoto.
//   2. "CREDIT - #006xxxxx" → PDF intestato CREDIT, con importi
//      negativi e TOTAL $-xx.xx. E' questo che diventa vendor_credits.
//
// Fino a oggi il pick-up slip cadeva nel fallback \bINVOICE\b (il
// testo PACA dice "listed on this invoice") e finiva in errore come
// fattura senza righe (00682258, 23/09) o, peggio, 'imported' con zero
// righe (00670731, 26/06). Non e' ne' una fattura ne' un credito: e'
// un documento operativo. Si legge per tracciabilita' e si chiude
// come non contabile; il denaro, se riconosciuto, arriva col CREDIT.
//
// Il documento reale ripete la stessa pagina due volte (copia autista e
// copia cliente, entrambe "Page 1 of 1"): le righe identiche si
// contano UNA volta.
const RR_ORIGINS = /^(USA|MEX|CAN|CHI|ITA|PER|CHL|GTM|HND|NZL|ESP|FRA|NLD|AUS)$/;

function parseReturnRequest(rawText) {
  const lines = (rawText || '').split('\n').map(l => l.trim());

  let returnNumber = null;
  for (let i = 0; i < lines.length; i++) {
    if (/PICK-UP\s+SLIP/i.test(lines[i])) {
      const same = lines[i].match(/PICK-UP\s+SLIP\s*#?\s*(\d{6,10})\b/i);
      if (same) { returnNumber = same[1]; break; }
      const next = (lines[i + 1] || '').match(/^(\d{6,10})$/);
      if (next) { returnNumber = next[1]; break; }
    }
  }
  const returnDate = extractDocDate(lines, ['DATE', 'ORDER DATE']) || null;

  const items = [];
  const seen = new Set();
  let last = null;
  for (const line of lines) {
    const orig = line.match(/Original Sales Order[:\s]+(\d+)/i);
    if (orig) { if (last && !last.original_order_number) last.original_order_number = orig[1]; continue; }
    if (isSkipLine(line)) { last = null; continue; }

    const parts = line.split(/\s{2,}/);
    if (parts.length >= 4 && /^\d+$/.test(parts[0]) && /^\d{5}$/.test(parts[1])) {
      const rest = parts.slice(4);
      let origin = null, returnCode = null;
      const money = [];
      for (const p of rest) {
        if (!origin && RR_ORIGINS.test(p)) { origin = p; continue; }
        if (/^-?[\d,]*\.\d{2}$/.test(p)) { money.push(parsePrice(p)); continue; }
        if (!returnCode && /^[A-Z0-9]{1,3}$/.test(p)) { returnCode = p; continue; }
      }
      const pack = parsePackSize(parts[3]);
      last = {
        vendor_sku:            parts[1],
        raw_description:       parts[2],
        description:           cleanDescription(parts[2]),
        qty_returned:          parseFloat(parts[0]),
        pack_description:      parts[3],
        pack_qty:              pack ? pack.count : null,
        pack_unit:             pack ? pack.unit  : null,
        origin,
        return_code:           returnCode,
        return_reason:         returnCode ? (RETURN_CODE_LABELS[returnCode.toUpperCase()] || returnCode) : null,
        original_order_number: null,
        // Un pick-up slip non porta prezzi. Se un giorno ne portasse,
        // restano qui come dato letto ma NON diventano un credito: il
        // credito e' il documento CREDIT, non questo.
        unit_price:            money.length >= 1 ? money[0] : null,
        amount:                null,
        warnings:              [],
      };
      items.push(last);
      continue;
    }
    // Riga di nota libera sotto l'articolo ("spoiled", "PICK UP"): resta
    // attaccata all'ultima riga letta, utile a chi apre il documento.
    if (last && /^[a-z][a-z .,'-]{2,60}$/i.test(line) && !/^PICK UP$/i.test(line)) {
      last.note = last.note ? last.note + ' ' + line : line;
    }
  }

  // Copie della stessa pagina: una riga identica (SKU, quantita',
  // ordine originale, codice) si conta una volta sola.
  const unique = [];
  for (const it of items) {
    const key = [it.vendor_sku, it.qty_returned, it.original_order_number, it.return_code].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(it);
  }

  const originals = [...new Set(unique.map(i => i.original_order_number).filter(Boolean))];
  const what = unique.length
    ? unique.map(i => `${i.qty_returned} x ${i.description}${i.original_order_number ? ' (order ' + i.original_order_number + ')' : ''}`).join(', ')
    : 'no readable lines';

  return {
    vendor:                 "Hardie's Fresh Foods / Dairyland Produce",
    document_type:          'return_request',
    return_number:          returnNumber,
    return_date:            returnDate,
    // I nomi generici che il worker e la UI leggono gia' per numero e data.
    document_number:        returnNumber,
    document_date:          returnDate,
    original_order_number:  originals.length === 1 ? originals[0] : null,
    original_order_numbers: originals,
    total:                  null,
    awaiting_credit:        true,
    items:                  unique,
    warnings: [{
      code:     'RETURN_REQUEST',
      severity: 'info',
      message:  `Hardie's pick-up slip (R.M.A.)${returnNumber ? ' #' + returnNumber : ''}: ${what}. ` +
                'Not an invoice and not a credit: no amount on the document. ' +
                'Any credit arrives as a separate CREDIT memo.',
    }],
  };
}

module.exports = { parse, parseReturnRequest };
