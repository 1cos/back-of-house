// ── vendor-parsers/freshpoint-order-confirmation.js ───────────────
// FreshPoint Dallas — Order Confirmation (corpo email, testo semplice).
// INV07.
//
// CANONICO, UNA SOLA FONTE. Consumato da tre runtime:
//   - Node (test)                      → require('./freshpoint-order-confirmation')
//   - Deno (vendor-doc-auto-import)    → PARSER_SOURCES + shim makeCjsLoader
//   - Browser (js/vendor-parser-ui.js) → window.FreshpointOrderConfirmationParser
// Non deve mai esistere una seconda implementazione.
//
// PERCHE' AUTOSUFFICIENTE (niente require('./utils')): la copia browser
// viene caricata come <script> senza module loader, e lo shim Deno
// risolve solo cio' che sta in PARSER_SOURCES. Le due funzioni minime
// che servono sono inlined.
//
// PERCHE' NON E' UNA FATTURA. Il corpo dice testualmente "This is not an
// invoice." FreshPoint manda la conferma d'ordine e poi, separatamente,
// la fattura. isPurchasableDocument('FreshPoint Dallas',
// 'order_confirmation') vale false: questo documento NON genera
// invoice_lines, ed e' corretto cosi'. Serve a non perdere la sorgente,
// non a contabilizzare.
//
// LA FORMA REALE (misurata su cinque email vere, giugno 2026):
//   | Order Confirmation | Reference #19464295 |
//   | Order Date/Time | Delivery Date | Purchase Order | Special Message |
//   | 06/04/2026 12:47 PM | Friday 06/05/2026 | N/A | N/A |
//   | Item# | Product | Size | Qty | Price | Ext.P |
//   | 921068 | LETTUCE ONECUT SPRING MIX ... | 3/2# CS | 1 | 33.95 | 33.95 |
//   | Items | 7 | Quantity | 7 | Total | 145.43 |

'use strict';

// Riga articolo: sei celle, la prima e' il codice numerico FreshPoint.
// L'intestazione (| Item# | ...) e il riepilogo (| Items | 7 | ...) non
// iniziano con cifre, quindi non possono essere scambiati per articoli.
const ITEM_RE = /^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(\d+(?:\.\d+)?)\s*\|\s*([\d,]+\.\d{2})\s*\|\s*([\d,]+\.\d{2})\s*\|$/;

const REF_RE     = /Order\s+Confirmation\s*\|\s*Reference\s*#\s*(\d+)/i;
const REF_ALT_RE = /Reference\s*#\s*(\d+)/i;
const SUMMARY_RE = /\|\s*Items\s*\|\s*(\d+)\s*\|\s*Quantity\s*\|\s*(\d+(?:\.\d+)?)\s*\|\s*Total\s*\|\s*([\d,]+\.\d{2})\s*\|/i;
const DATES_RE   = /^\|\s*(\d{2}\/\d{2}\/\d{4})[^|]*\|\s*(?:[A-Za-z]+\s+)?(\d{2}\/\d{2}\/\d{4})\s*\|/;

function parsePrice(s) {
  if (s === null || s === undefined) return null;
  const n = parseFloat(String(s).replace(/[$,\s]/g, ''));
  return isNaN(n) ? null : n;
}

// MM/DD/YYYY → YYYY-MM-DD. Nessun fallback su new Date(): una data
// ambigua e' meglio nulla che sbagliata.
function toIsoDate(s) {
  const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

// Il riquadro "Size" e' scritto come "3/2# CS", "11# BX", "2 CT BX",
// "2CT BX", "5 LB BX". Interessa la forma, non la conversione: questo
// documento non entra nel costo, quindi non si inventano grammi.
function parsePack(sizeCell) {
  const raw = String(sizeCell || '').trim();
  if (!raw) return { count: null, sizeEach: null, unit: null };
  let m = raw.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(#|LB|OZ|CT|EA)\b/i);
  if (m) return { count: parseFloat(m[1]), sizeEach: parseFloat(m[2]),
                  unit: m[3] === '#' ? 'lb' : m[3].toLowerCase() };
  m = raw.match(/^(\d+(?:\.\d+)?)\s*(#|LB|OZ|CT|EA)\b/i);
  if (m) return { count: 1, sizeEach: parseFloat(m[1]),
                  unit: m[2] === '#' ? 'lb' : m[2].toLowerCase() };
  return { count: null, sizeEach: null, unit: null };
}

function parse(rawText) {
  const text     = String(rawText || '');
  const lines    = text.split('\n');
  const warnings = [];

  const refM = text.match(REF_RE) || text.match(REF_ALT_RE);
  const orderNumber = refM ? refM[1] : null;

  let orderDate = null, deliveryDate = null;
  for (const line of lines) {
    const d = line.match(DATES_RE);
    if (d) { orderDate = toIsoDate(d[1]); deliveryDate = toIsoDate(d[2]); break; }
  }

  const items = [];
  for (const line of lines) {
    const m = line.match(ITEM_RE);
    if (!m) continue;
    const [, sku, descRaw, sizeRaw, qtyStr, priceStr, extStr] = m;
    const pack  = parsePack(sizeRaw);
    const qty   = parseFloat(qtyStr);
    const price = parsePrice(priceStr);
    const ext   = parsePrice(extStr);

    items.push({
      vendor_sku:       sku,
      raw_description:  descRaw.trim(),
      description:      descRaw.trim(),
      // Su una conferma d'ordine esiste solo la quantita' ORDINATA: la
      // ricevuta la dira' la fattura. Non si finge di conoscerla.
      qty_ordered:      qty,
      qty_received:     null,
      purchase_unit:    'case',
      pack_description: sizeRaw.trim(),
      pack_qty:         pack.count,
      pack_unit:        pack.unit,
      pack_size_each:   pack.sizeEach,
      unit_price:       price,
      amount:           ext,
      warnings:         [],
    });
  }

  const sm = text.match(SUMMARY_RE);
  const declaredItems = sm ? parseInt(sm[1], 10)   : null;
  const declaredQty   = sm ? parseFloat(sm[2])     : null;
  const total         = sm ? parsePrice(sm[3])     : null;

  if (!items.length) {
    warnings.push({ code: 'PARSE_ERROR', message: 'No line items found — FreshPoint template may have changed' });
  } else if (declaredItems !== null && declaredItems !== items.length) {
    // Guardia contro la deriva del template: il documento dichiara
    // quante righe ha, quindi si verifica invece di sperare.
    warnings.push({
      code: 'DOC-TOTAL-001',
      severity: 'blocking',
      message: `Parsed ${items.length} lines but the order declares ${declaredItems} — possible missing lines`,
      parsed_lines: items.length, declared_lines: declaredItems,
    });
  }

  return {
    vendor:        'FreshPoint Dallas',
    document_type: 'order_confirmation',
    order_number:  orderNumber,
    order_date:    orderDate,
    delivery_date: deliveryDate,
    subtotal:      null,
    tax:           null,
    total,
    declared_item_count: declaredItems,
    declared_quantity:   declaredQty,
    items,
    warnings,
  };
}

module.exports = { parse };
