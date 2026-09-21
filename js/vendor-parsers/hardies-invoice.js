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

  if (pack && ['ct','ea','each','dz','doz'].includes(pack.unit)) lw.push({
    code:    'OQR-006',
    message: `Count-based: ${desc} (${packRaw.trim()}) — no weight for costing`,
    field:   'pack_unit',
  });

  // ── Catchweight detection (meat sold by the pound) ──
  // Pattern: pack like "1pc / 28#" (nominal weight) + unit_price is PER POUND,
  // line amount = actual weight × price/lb. Hardie's prints "Total weight: N"
  // but the exact math is amount ÷ unit_price = actual pounds.
  // Detection: amount ≠ unit_price (so not a flat case price) AND the implied
  // weight is within 50% of the nominal pack weight.
  //
  // INV08G — IL DISCRIMINANTE CHE MANCAVA.
  //
  // "amount diverso da unit_price" non basta a distinguere una pesata da
  // una normale moltiplicazione per colli. Su 11 voci reali marcate
  // catchweight, SEI erano falsi positivi, tutti con la stessa firma:
  //
  //   00459 CARROT JUMBO    3 x $4,63  = $13,89   pack 5#
  //   01981 ORGANIC SPRING  2 x $16,40 = $32,80   pack 3#
  //   71898 SPINACH BABY    3 x $15,24 = $45,72   pack 4#
  //   25265 CHZ MOZZ SHRED  4 x $22,22 = $88,88   pack 5#
  //
  // Il "peso implicito" coincideva esattamente con la quantita'
  // ricevuta, e cadeva dentro la finestra 0.5-1.5 del pack nominale
  // solo per coincidenza aritmetica. Conseguenze gia' materializzate:
  // quelle righe hanno cost_per_100g calcolato su un peso inventato e
  // — poiche' per una catchweight la quantita' e' sempre 1 — hanno
  // perso la quantita' reale.
  //
  // Il discriminante e' l'importo stesso: se amount = unit_price x
  // quantita' ricevuta, quella non e' una pesata, e' una
  // moltiplicazione per colli. Su una catchweight vera non torna mai,
  // perche' il peso effettivo non e' il numero di colli:
  //
  //   00907 PARMESAN  1 collo x $13,00 -> $1.120,60   (86,2 lb)
  //   29554 BROCHETTE 4 colli x $6,22  -> $294,95     (47,42 lb)
  let catchweight = false, priceLb = null, actualLb = null;
  if (pack && pack.unit === 'lb' && unitPrice > 0 && amount > 0
      && Math.abs(amount - unitPrice) > 0.02
      && Math.abs(amount - unitPrice * (shp || 0)) > 0.02) {
    const impliedLb = amount / unitPrice;
    const nominalLb = pack.count * pack.sizeEach;
    if (nominalLb > 0 && impliedLb >= nominalLb * 0.5 && impliedLb <= nominalLb * 1.5) {
      catchweight = true;
      priceLb  = unitPrice;
      actualLb = Math.round(impliedLb * 100) / 100;
    }
  }

  // INV08B — QUANTITA' CONSEGNATA, non ordinata.
  //
  // Il parser emetteva qty_ordered e qty_received ma non `qty`, e il
  // writer preferiva l'ORDINATO al RICEVUTO. Conseguenze misurate su 890
  // voci reali: 17 articoli non consegnati (ricevuto 0) scritti con
  // quantita' 1 o 2, cioe' merce mai arrivata registrata come ricevuta;
  // 5 consegne parziali scritte con la quantita' ordinata invece di
  // quella arrivata; e 10 sostituti (ordinato 0, ricevuto 1) scritti con
  // quantita' ZERO, perche' `0 != null` e' vero e l'ordinato vinceva.
  // Il difetto tagliava in due direzioni opposte.
  //
  // `qty` dichiara esplicitamente la quantita' acquistata, com'e' gia'
  // per Ben E. Keith (MICRO-TASK 42, sezione J): "ORDERED is never a
  // fallback for BEK". Vale lo stesso qui.
  const item = {
    vendor_sku:       sku,
    raw_description:  descRaw.trim(),
    description:      desc,
    qty:              shp,
    qty_ordered:      ord,
    qty_received:     shp,
    purchase_unit:    inferPurchaseUnit(pack),
    pack_description: packRaw.trim(),
    pack_qty:         pack ? pack.count     : null,
    pack_unit:        pack ? pack.unit      : null,
    pack_size_each:   pack ? pack.sizeEach  : null,
    catchweight:      catchweight,
    price_per_lb:     priceLb,
    actual_weight_lb: actualLb,
    unit_price:       unitPrice,
    amount:           amount,
    is_substitution:  isSub,
    substituted_sku:  isSub ? prevSku : null,
    origin:           null,
    cool_flag:        false,
    warnings:         lw,
  };

  // INV08B — un articolo ORDINATO E MAI CONSEGNATO non e' un acquisto.
  //
  // La regola non la invento: e' gia' scritta per Ben E. Keith in
  // writeInvoiceLines, MICRO-TASK 42 sezioni B ed E — "an item nobody
  // confirmed was not bought: it must not become a purchase line at all
  // (rather than a line with quantity 0)". Qui e' lo stesso caso: shipped
  // 0 e amount 0. L'articolo resta nel parsed_json, quindi il documento
  // non perde niente ed e' sempre verificabile; semplicemente non diventa
  // una riga di acquisto.
  //
  // Il campo si aggiunge SOLO quando serve: `purchasable` assente
  // significa acquistabile, e il filtro del writer e' `!== false`.
  if (shp === 0) item.purchasable = false;

  return item;
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
