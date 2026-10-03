'use strict';
// XCF-CW — trasporto contro un portale Chef's Warehouse FINTO (nessuna rete).
// Le risposte hanno la stessa forma registrata dalla sonda v5 il 02/10/2026.
const test = require('node:test');
const assert = require('node:assert');
const { sendOrder, planLines, compareCart, cwUnit } = require('../src/cw');
const { AuthExpired } = require('../src/cw');
const { messages } = require('../src/index');

const DATE = '2026-10-05';
const job = (lines, extra) => ({ attempt_id: 'a1', order_id: 'o1', summary_hash: 'h'.repeat(64), vendor: "Hardie's",
  payload: Object.assign({ delivery_date: DATE, lines }, extra || {}) });
const L = [{ vendor_sku: '25618', quantity: 1, unit: 'case', name: 'Burrata' }, { vendor_sku: '25095', quantity: 2, unit: 'ea', name: 'Lemon' }];

// Portale finto: tiene un carrello lato server come CW.
function fakePortal(opts = {}) {
  const st = { lines: (opts.startLines || []).slice(), date: '2026-10-07', calls: [], submitted: 0 };
  const cart = () => ({ id: 9995165, oosLines: opts.oos ? [{ productSku: '25095' }] : [], forcedSubstitutions: [],
    cartGroups: st.lines.length ? [{ subCarts: [{ businessUnitId: 'DA', isPreOrder: false, isJIT: false, isDropShip: false,
      deliveryInformation: { selectedDeliveryDate: st.date, deliveryDates: [{ deliveryDate: DATE }, { deliveryDate: '2026-10-07' }] },
      lines: st.lines.map(l => ({ productSku: l.sku, unitOfMeasureCode: l.uom, quantity: l.qty, businessUnit: 'DA', substitutions: [], isObsolete: false })) }] }] : [] });
  const api = {
    async get(p) {
      st.calls.push('GET ' + p);
      if (opts.expireOn === p) throw new AuthExpired('rimando al login (0) su ' + p);
      if (p === '/web-api/cart/current-or-new' || p === '/web-api/cart-validation') return cart();
      throw new Error('endpoint inatteso ' + p);
    },
    async post(p, b) {
      st.calls.push('POST ' + p);
      if (opts.expireOn === p) throw new AuthExpired('rimando al login (0) su ' + p);
      if (p === '/web-api/cart/add') {
        if (opts.addReject) return { success: false, totalCount: 0, validationMessages: ['Item unavailable'] };
        for (const x of b) {
          const sku = x.code.match(/^HRD_(\d+)-DA$/)[1];
          st.lines.push({ sku, uom: x.metadata.unitOfMeasure, qty: x.quantity + (opts.addQtyDrift || 0) });
        }
        return { totalCount: st.lines.length, success: true, validationMessages: [] };
      }
      if (p === '/web-api/cart/update/deliveryDate') { if (!opts.ignoreDate) st.date = b.expectedDeliveryDate; return null; }
      if (p === '/web-api/cart/submit') {
        st.submitted++;
        if (opts.submitThrows) throw new Error('POST /web-api/cart/submit: timeout');
        if (opts.submitUnclear) return { success: false, confirmedOrders: [], validationMessages: ['?'] };
        return { confirmedOrders: [{ orderNumber: 'TCW9995165226', businessUnitId: 'DA' }], orderConfirmationUrl: '/cart/order-confirmation/?epiOrderId=6519964',
                 success: true, validationMessages: [], warnings: [] };
      }
      throw new Error('endpoint inatteso ' + p);
    },
  };
  return { api, st };
}

test('unita: solo case/each, niente conversioni', () => {
  assert.strictEqual(cwUnit('Case'), 'CS'); assert.strictEqual(cwUnit('cases'), 'CS'); assert.strictEqual(cwUnit('ea'), 'EA');
  assert.strictEqual(cwUnit('lb'), null); assert.strictEqual(cwUnit(''), null);
});

test('piano: SKU, unita, quantita intere e doppioni fermano prima del carrello', () => {
  const p = planLines({ delivery_date: DATE, lines: [{ vendor_sku: '', quantity: 1, unit: 'case' }, { vendor_sku: '1234', quantity: 1, unit: 'lb' },
    { vendor_sku: '1235', quantity: 1.5, unit: 'case' }, { vendor_sku: '1236', quantity: 1, unit: 'case' }, { vendor_sku: '1236', quantity: 2, unit: 'cs' }] });
  assert.deepStrictEqual(p.errors.map(e => e.code), ['SKU_MISSING', 'UNIT_NOT_CW', 'QTY_INVALID', 'DUPLICATE_LINE']);
  assert.ok(!planLines({ lines: L }).ok, 'senza data di consegna non si parte');
});

test('ordine completo: carrello vuoto -> add -> data -> confronto -> submit -> numero CW', async () => {
  const { api, st } = fakePortal();
  const r = await sendOrder(api, job(L));
  assert.strictEqual(r.outcome, 'sent');
  assert.strictEqual(r.vendorOrderNumber, 'TCW9995165226');
  assert.strictEqual(r.result.epi_order_id, '6519964');
  assert.strictEqual(r.result.transmitted, true);
  assert.deepStrictEqual(st.calls, ['GET /web-api/cart/current-or-new', 'POST /web-api/cart/add', 'POST /web-api/cart/update/deliveryDate',
    'GET /web-api/cart-validation', 'POST /web-api/cart/submit']);
  assert.strictEqual(st.submitted, 1);
});

test('carrello CW gia pieno: nessuna aggiunta, nessun submit', async () => {
  const { api, st } = fakePortal({ startLines: [{ sku: '99999', uom: 'CS', qty: 1 }] });
  const r = await sendOrder(api, job(L));
  assert.strictEqual(r.outcome, 'failed'); assert.strictEqual(r.result.error, 'CART_NOT_EMPTY'); assert.strictEqual(r.result.cart_touched, false);
  assert.strictEqual(st.calls.length, 1); assert.strictEqual(st.submitted, 0);
});

test('piano non valido: il portale non viene nemmeno chiamato', async () => {
  const { api, st } = fakePortal();
  const r = await sendOrder(api, job([{ vendor_sku: '25618', quantity: 3, unit: 'lb' }]));
  assert.strictEqual(r.result.error, 'PLAN_INVALID'); assert.strictEqual(st.calls.length, 0);
});

test('add rifiutato: fallito, nessun submit', async () => {
  const { api, st } = fakePortal({ addReject: true });
  const r = await sendOrder(api, job(L));
  assert.strictEqual(r.result.error, 'ADD_REJECTED'); assert.strictEqual(st.submitted, 0);
});

test('carrello diverso dal riepilogo (quantita): fallito, nessun submit', async () => {
  const { api, st } = fakePortal({ addQtyDrift: 1 });
  const r = await sendOrder(api, job(L));
  assert.strictEqual(r.result.error, 'CART_MISMATCH'); assert.ok(r.result.detail.some(d => d.code === 'LINE_DIFFERENT'));
  assert.strictEqual(r.result.cart_touched, true); assert.strictEqual(st.submitted, 0);
});

test('data di consegna non applicata: fallito, nessun submit', async () => {
  const { api, st } = fakePortal({ ignoreDate: true });
  const r = await sendOrder(api, job(L));
  assert.ok(r.result.detail.some(d => d.code === 'DELIVERY_DATE_DIFFERENT')); assert.strictEqual(st.submitted, 0);
});

test('articolo esaurito: fallito, nessun submit', async () => {
  const { api, st } = fakePortal({ oos: true });
  const r = await sendOrder(api, job(L));
  assert.ok(r.result.detail.some(d => d.code === 'OUT_OF_STOCK')); assert.strictEqual(st.submitted, 0);
});

test('sessione scaduta prima del submit: fallito (certo), nessun submit', async () => {
  const { api, st } = fakePortal({ expireOn: '/web-api/cart-validation' });
  const r = await sendOrder(api, job(L));
  assert.strictEqual(r.outcome, 'failed'); assert.strictEqual(r.result.error, 'CW_SESSION_EXPIRED'); assert.strictEqual(st.submitted, 0);
});

test('submit senza risposta: INCERTO, mai ritentato', async () => {
  const { api, st } = fakePortal({ submitThrows: true });
  const r = await sendOrder(api, job(L));
  assert.strictEqual(r.outcome, 'uncertain'); assert.strictEqual(r.result.error, 'SUBMIT_NO_ANSWER'); assert.strictEqual(st.submitted, 1);
});

test('submit senza numero ordine: INCERTO (non "fallito")', async () => {
  const { api } = fakePortal({ submitUnclear: true });
  const r = await sendOrder(api, job(L));
  assert.strictEqual(r.outcome, 'uncertain'); assert.strictEqual(r.result.error, 'SUBMIT_UNCLEAR');
});

test('sessione scaduta SUL submit: incerto, non fallito', async () => {
  const { api } = fakePortal({ expireOn: '/web-api/cart/submit' });
  const r = await sendOrder(api, job(L));
  assert.strictEqual(r.outcome, 'uncertain');
});

test('confronto: riga in piu nel carrello', () => {
  const cart = { oosLines: [], forcedSubstitutions: [], cartGroups: [{ subCarts: [{ businessUnitId: 'DA', deliveryInformation: { selectedDeliveryDate: DATE },
    lines: [{ productSku: '25618', unitOfMeasureCode: 'CS', quantity: 1 }, { productSku: '777', unitOfMeasureCode: 'CS', quantity: 1 }] }] }] };
  const c = compareCart([{ sku: '25618', uom: 'CS', qty: 1 }], cart, DATE);
  assert.ok(!c.ok && c.diffs.some(d => d.code === 'EXTRA_LINE'));
});

test('messaggi allo Chef: incerto dice di controllare, login spiega il gesto', () => {
  assert.match(messages('uncertain', { error: 'SUBMIT_NO_ANSWER' }, 'H').title, /NON certo/);
  assert.match(messages('failed', { error: 'CW_SESSION_EXPIRED' }, 'H').body, /cw-login\.command/);
  assert.match(messages('failed', { error: 'CART_MISMATCH', cart_touched: true }, 'H').body, /svuotato/);
  assert.match(messages('sent', { order_number: 'TCW1' }, 'H').title, /TCW1/);
});
