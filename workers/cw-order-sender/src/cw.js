'use strict';
// XCF-CW — trasporto Chef's Warehouse (order.chefswarehouse.com).
//
// Endpoint usati: SOLO quelli osservati dalle sonde (~/cw-probe), mai dedotti.
//   GET  /web-api/cart/current-or-new      carrello attuale       (v4 23/08, v5 02/10)
//   POST /web-api/cart/add                 righe [{code,...}]     (v4 23/08, v5 02/10)
//   POST /web-api/cart/update/deliveryDate data di consegna       (v5 02/10)
//   GET  /web-api/cart-validation          carrello finale        (v5 02/10)
//   POST /web-api/cart/submit              invio dell'ordine      (v5 02/10, ordine TCW9995165226)
//
// submit NON contiene le righe: invia TUTTO quello che c'e' nel carrello CW.
// Per questo: carrello vuoto all'inizio, confronto esatto con il riepilogo
// confermato da Max subito prima del submit, e un submit dall'esito incerto
// non viene MAI ritentato (outcome 'uncertain').
//
// Questo modulo e' puro: riceve `api` ({ get(path), post(path, body) }) e
// non sa nulla di browser, Brigade o credenziali. I test usano un portale finto.

const BU = 'DA';

class AuthExpired extends Error {
  constructor(msg) { super(msg); this.code = 'auth_expired'; }
}

const UNIT_MAP = { 'case': 'CS', 'cases': 'CS', 'case(s)': 'CS', 'cs': 'CS', 'each': 'EA', 'ea': 'EA' };
function cwUnit(u) { return UNIT_MAP[String(u || '').trim().toLowerCase()] || null; }

// Righe del riepilogo confermato -> righe CW. Niente conversioni inventate:
// cio' che non e' certo ferma l'invio prima di toccare il carrello.
function planLines(payload) {
  const errors = [];
  const lines = [];
  const seen = new Set();
  if (!payload || !Array.isArray(payload.lines) || !payload.lines.length) errors.push({ code: 'NO_LINES' });
  if (!payload || !/^\d{4}-\d{2}-\d{2}$/.test(String(payload.delivery_date || ''))) errors.push({ code: 'DELIVERY_DATE_MISSING' });
  for (const l of (payload && payload.lines) || []) {
    const sku = String(l.vendor_sku || '').trim();
    const uom = cwUnit(l.unit);
    const qty = Number(l.quantity);
    const name = l.name || sku;
    if (!/^\d{3,8}$/.test(sku)) { errors.push({ code: 'SKU_MISSING', line: name }); continue; }
    if (!uom) { errors.push({ code: 'UNIT_NOT_CW', line: name, unit: l.unit || null }); continue; }
    if (!Number.isInteger(qty) || qty <= 0 || qty > 999) { errors.push({ code: 'QTY_INVALID', line: name, quantity: l.quantity }); continue; }
    const k = sku + '|' + uom;
    if (seen.has(k)) { errors.push({ code: 'DUPLICATE_LINE', line: name }); continue; }
    seen.add(k);
    lines.push({ sku, uom, qty, name });
  }
  return { ok: errors.length === 0, lines, errors };
}

function subCartsOf(cart) {
  return ((cart && cart.cartGroups) || []).flatMap(g => g.subCarts || []);
}
function cartLines(cart) {
  return subCartsOf(cart).flatMap(sc => (sc.lines || []).map(l => ({
    sku: String(l.productSku || '').trim(),
    uom: String(l.unitOfMeasureCode || '').trim().toUpperCase(),
    qty: Number(l.quantity),
    bu: l.businessUnit || sc.businessUnitId || null,
    substitutions: (l.substitutions || []).length, obsolete: !!l.isObsolete,
  })));
}

// Il carrello finale e' ESATTAMENTE il riepilogo confermato?
function compareCart(planned, cart, deliveryDate) {
  const diffs = [];
  if ((cart.oosLines || []).length) diffs.push({ code: 'OUT_OF_STOCK', n: cart.oosLines.length,
    items: cart.oosLines.map(l => ({ sku: l.productSku || null, name: l.productTitle || null, pack: l.packSize || null })) });
  if ((cart.forcedSubstitutions || []).length) diffs.push({ code: 'FORCED_SUBSTITUTION', n: cart.forcedSubstitutions.length });
  const subs = subCartsOf(cart);
  for (const sc of subs) {
    if (sc.businessUnitId !== BU) diffs.push({ code: 'OTHER_BUSINESS_UNIT', bu: sc.businessUnitId });
    const sel = sc.deliveryInformation && sc.deliveryInformation.selectedDeliveryDate;
    if (sel !== deliveryDate) diffs.push({ code: 'DELIVERY_DATE_DIFFERENT', expected: deliveryDate, cart: sel || null });
    if (sc.isPreOrder || sc.isJIT || sc.isDropShip) diffs.push({ code: 'SPECIAL_SUBCART', bu: sc.businessUnitId });
  }
  const have = cartLines(cart);
  const want = new Map(planned.map(l => [l.sku + '|' + l.uom, l.qty]));
  const got = new Map();
  for (const l of have) {
    const k = l.sku + '|' + l.uom;
    got.set(k, (got.get(k) || 0) + l.qty);
    if (l.obsolete) diffs.push({ code: 'OBSOLETE', sku: l.sku });
  }
  for (const [k, q] of want) if (got.get(k) !== q) diffs.push({ code: 'LINE_DIFFERENT', line: k, expected: q, cart: got.get(k) ?? 0 });
  for (const [k, q] of got) if (!want.has(k)) diffs.push({ code: 'EXTRA_LINE', line: k, cart: q });
  return { ok: diffs.length === 0, diffs, lines: have };
}

function addBody(lines) {
  // Stessa forma osservata il 23/08 e il 02/10 (add dall'Order Guide / dalla ricerca).
  return lines.map(l => ({
    code: `HRD_${l.sku}-${BU}`,
    metadata: { unitOfMeasure: l.uom, productKey: null, productClassificationCode: null, chefItemFlag: false, bto: false,
      supermarket: false, stockingType: 'P', lineType: null, vendorId: '', productionItem: false, orderCutoffOverride: null },
    isReserve: false, businessUnitId: BU, quantity: l.qty, cutInstructions1: null, cutInstructions2: null,
    customerFacingName: null, sellByMultiple: 1, addedFromLocation: 'Order Guide',
  }));
}

// Esegue l'ordine. Ritorna { outcome: 'sent'|'failed'|'uncertain', result, vendorOrderNumber }.
// 'failed' SOLO quando e' certo che il submit non e' partito.
async function sendOrder(api, job, opts = {}) {
  const now = () => (opts.now ? opts.now() : new Date()).toISOString();
  const payload = job.payload || {};
  const base = { transmitted: false, order_id: job.order_id, summary_hash: job.summary_hash };
  let stage = 'plan';
  let cartTouched = false;
  const fail = (error, detail) => ({ outcome: 'failed', result: Object.assign({}, base, { stage, error, detail: detail ?? null, cart_touched: cartTouched, at: now() }) });

  const plan = planLines(payload);
  if (!plan.ok) return fail('PLAN_INVALID', plan.errors);

  try {
    stage = 'cart_empty_check';
    const start = await api.get('/web-api/cart/current-or-new');
    const existing = cartLines(start);
    if (existing.length) return fail('CART_NOT_EMPTY', { lines: existing.map(l => `${l.sku} ${l.qty} ${l.uom}`) });

    stage = 'add';
    cartTouched = true;
    const add = await api.post('/web-api/cart/add', addBody(plan.lines));
    if (!add || add.success !== true || (add.validationMessages || []).length) return fail('ADD_REJECTED', add && add.validationMessages);

    stage = 'delivery_date';
    await api.post('/web-api/cart/update/deliveryDate', { expectedDeliveryDate: payload.delivery_date, erpExpectedDeliveryDate: payload.delivery_date, businessUnitId: BU });

    stage = 'validate';
    const val = await api.get('/web-api/cart-validation');
    const cmp = compareCart(plan.lines, val, payload.delivery_date);
    if (!cmp.ok) {
      // Esaurito su CW: lo diciamo per nome (CW porta la riga a quantita' 0).
      const oos = cmp.diffs.find(d => d.code === 'OUT_OF_STOCK');
      return fail(oos ? 'OUT_OF_STOCK' : 'CART_MISMATCH', cmp.diffs);
    }
    base.cw_cart_id = val.id || null;
  } catch (e) {
    return fail(e instanceof AuthExpired ? 'CW_SESSION_EXPIRED' : 'CW_ERROR', String(e.message || e).slice(0, 200));
  }

  // Da qui in poi l'ordine potrebbe essere partito: nessun ritento, mai.
  stage = 'submit';
  let res;
  try {
    res = await api.post('/web-api/cart/submit', { googleSearchVisitorId: null, experimentIds: null });
  } catch (e) {
    return { outcome: 'uncertain', result: Object.assign({}, base, { stage, error: 'SUBMIT_NO_ANSWER', detail: String(e.message || e).slice(0, 200), at: now() }) };
  }
  const orders = (res && res.confirmedOrders) || [];
  const number = orders.length === 1 ? String(orders[0].orderNumber || '').trim() : '';
  const epi = res && res.orderConfirmationUrl ? (String(res.orderConfirmationUrl).match(/epiOrderId=(\d+)/) || [])[1] || null : null;
  if (res && res.success === true && number) {
    return { outcome: 'sent', vendorOrderNumber: number, result: Object.assign({}, base, {
      transmitted: true, stage: 'done', order_number: number, epi_order_id: epi, confirmation_url: res.orderConfirmationUrl || null,
      warnings: res.warnings || [], at: now() }) };
  }
  // Risposta senza numero d'ordine certo: lo Chef verifica sul portale.
  return { outcome: 'uncertain', result: Object.assign({}, base, { stage, error: 'SUBMIT_UNCLEAR',
    detail: { success: res && res.success, confirmed: orders.length, validationMessages: res && res.validationMessages }, at: now() }) };
}

module.exports = { sendOrder, planLines, compareCart, cartLines, addBody, cwUnit, AuthExpired, BU };
