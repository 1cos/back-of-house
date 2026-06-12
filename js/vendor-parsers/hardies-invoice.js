// ── vendor-parsers/hardies-invoice.js ────────────────────────
// Parser for Hardie's / Dairyland Produce INVOICE/POD
// Document type: invoice
//
// Substitution logic (real PDF layout):
//   WATERMELON SEEDLESS  ordered:1  shipped:0   ← not delivered
//   WATERMELON LOCAL     ordered:0  shipped:1   ← substitution (ordered=0, shipped>0)
//   SUBSTITUTION                                ← marker: applies to PREVIOUS item
//   SPINACH BABY         ordered:2  shipped:2   ← normal item, NOT substitution
//
// Rule: SUBSTITUTION marker retroactively applies to the last parsed item.
// Additionally: ordered=0, shipped>0 pattern is always a substitution.

'use strict';

const {
  parseDate, parsePrice, parsePackSize, cleanDescription,
  isSkipLine, isSubstitutionLine, extractDocNumber, extractDocDate,
} = require('./utils');

const LINE_RE  = /^(\d+)\s+(\d+)\s+(\d{5})\s+(.+?)\s{2,}(.+?)\s{1,}([\d,.]+)\s+([\d,.]+)(?:\s+.*)?$/;
const LINE_RE2 = /^(\d+)\s+(\d+)\s+(\d{5})\s+(.{8,})$/;

function buildItem(sku, descRaw, packRaw, ord, shp, unitPrice, amount, prevSku) {
  const pack = parsePackSize(packRaw.trim());
  const desc = cleanDescription(descRaw.trim());
  const lw   = [];
  const isSub = (ord === 0 && shp > 0);

  if (ord !== shp) lw.push({
    code:    'OQR-007',
    message: `Qty mismatch: ordered ${ord}, shipped ${shp} of ${desc}`,
    field:   'qty_received',
    possible_reasons: ['Short shipped','Back ordered','Vendor error','Substitution'],
  });

  if (isSub) lw.push({
    code:    'OQR-002',
    message: `Substitution: ordered 0, received ${shp} of ${desc}`,
    field:   'is_substitution',
  });

  if (pack && ['ct','ea','each'].includes(pack.unit)) lw.push({
    code:    'OQR-006',
    message: `Count-based: ${desc} (${packRaw.trim()}) — no weight for costing`,
    field:   'pack_unit',
  });

  return {
    vendor_sku:       sku,
    raw_description:  descRaw.trim(),
    description:      desc,
    qty_ordered:      ord,
    qty_received:     shp,
    purchase_unit:    inferPurchaseUnit(pack),
    pack_description: packRaw.trim(),
    pack_qty:         pack ? pack.count     : null,
    pack_unit:        pack ? pack.unit      : null,
    pack_size_each:   pack ? pack.sizeEach  : null,
    unit_price:       unitPrice,
    amount:           amount,
    is_substitution:  isSub,
    substituted_sku:  isSub ? prevSku : null,
    origin:           null,
    cool_flag:        false,
    warnings:         lw,
  };
}

function parse(rawText) {
  const warnings = [];
  // OCR sometimes glues the first item onto the table header line:
  // "QUANTITY ITEM CODE ... SHIPPED AMOUNT 1 1 13544 RWPR ..."
  // isSkipLine would drop the whole line (starts with QUANTITY) — losing the item.
  // Inject a newline after the header keywords when item data follows.
  rawText = String(rawText || '').replace(/(SHIPPED\s+AMOUNT)[ \t]+(?=\d)/g, '$1\n');
  const lines = rawText.split('\n').map(l => l.trim());

  const docNumber    = extractDocNumber(lines, ['INVOICE/POD', 'INVOICE']) || null;
  const orderDate    = extractDocDate(lines, ['DATE/TRIP', 'ORDER DATE', 'DATE']) || null;
  let   deliveryDate = null;
  for (const l of lines) {
    const m = l.match(/DATE\/TRIP\s+([\d\/]+)/i);
    if (m) { deliveryDate = parseDate(m[1]); break; }
  }

  let subtotal = null, tax = null, total = null;
  for (const l of lines) {
    let m;
    m = l.match(/SUBTOTAL\s+([\d,]+\.?\d*)/i);      if (m) subtotal = parsePrice(m[1]);
    m = l.match(/TAX\/PCT\.?\s+\$([\d,.]+)/i);       if (m) tax      = parsePrice(m[1]);
    m = l.match(/INVOICE\s+\$([\d,]+\.?\d*)/i);      if (m && !total) total = parsePrice(m[1]);
  }

  const items  = [];
  let prevSku  = null;

  for (const line of lines) {
    if (isSkipLine(line)) continue;

    // SUBSTITUTION marker → retrofit the LAST parsed item, not the next one
    if (isSubstitutionLine(line)) {
      if (items.length > 0) {
        const last = items[items.length - 1];
        last.is_substitution = true;
        if (!last.substituted_sku) {
          // Find the item before it that was ordered but not shipped
          const prevItem = items.slice(0, -1).reverse().find(i => i.qty_received === 0);
          last.substituted_sku = prevItem?.vendor_sku || null;
        }
        // Ensure OQR-002 warning is on the last item
        if (!last.warnings.some(w => w.code === 'OQR-002')) {
          last.warnings.push({
            code:    'OQR-002',
            message: `Substitution confirmed by SUBSTITUTION marker`,
            field:   'is_substitution',
          });
        }
      }
      continue;
    }

    let m = line.match(LINE_RE);
    if (m) {
      const [, ordS, shpS, sku, descRaw, packRaw, upS, amtS] = m;
      const item = buildItem(sku, descRaw, packRaw, parseFloat(ordS), parseFloat(shpS),
        parsePrice(upS), parsePrice(amtS), prevSku);
      items.push(item);
      prevSku = sku;
      continue;
    }

    m = line.match(LINE_RE2);
    if (m) {
      const [, ordS, shpS, sku, rest] = m;
      const pm = rest.match(/([\d,]+\.\d{2})\s+([\d,]+\.\d{2})(?:\s+.*)?$/);
      if (pm) {
        const rawDesc = rest.slice(0, rest.lastIndexOf(pm[0])).trim();
        const parts   = rawDesc.split(/\s{2,}/);
        let packRaw = parts.length > 1 ? parts[parts.length - 1] : '';
        let descRaw = parts.length > 1 ? parts.slice(0, -1).join(' ') : rawDesc;
        // Single-spaced OCR line: pack glued to description — extract trailing
        // pack pattern like "1pc / 28#", "11/1#", "25#"
        if (!packRaw) {
          const pk = rawDesc.match(/^(.*?)\s+((?:\d+\s*(?:PC|PCS|EA|EACH)?\s*\/\s*)?[\d.]+\s*#)\s*$/i);
          if (pk) { descRaw = pk[1].trim(); packRaw = pk[2].trim(); }
        }
        const item = buildItem(sku, descRaw, packRaw, parseFloat(ordS), parseFloat(shpS),
          parsePrice(pm[1]), parsePrice(pm[2]), prevSku);
        items.push(item);
        prevSku = sku;
      }
    }
  }

  if (!items.length) warnings.push({ code: 'PARSE_ERROR', message: 'No line items found' });

  return {
    vendor:        "Hardie's Fresh Foods / Dairyland Produce",
    document_type: 'invoice',
    order_number:  docNumber,
    order_date:    orderDate,
    delivery_date: deliveryDate,
    subtotal, tax, total,
    items, warnings,
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

module.exports = { parse };
