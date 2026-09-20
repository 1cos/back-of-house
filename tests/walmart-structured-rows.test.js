// ══════════════════════════════════════════════════════════════════
// INV03D — Walmart TreviPay: structured non-product rows must never be
// swallowed into the previous item's description, and the page footer
// must never reach a description.
//
// Plain Node, zero external deps:
//   node tests/walmart-structured-rows.test.js
//
// The defect this file locks down, in one line: parseRowStart() read a
// row correctly (complete monetary tail, right qty, right amounts) and
// then threw it away because its SKU-column text was neither a 5+ digit
// SKU nor one of four hardcoded placeholder names — so the row's money
// ended up as text inside the PREVIOUS item's description. On 1ca959a6
// that lost two "WebPriceMatch FULFILL_VARIANCE" rows, $43.50 each,
// $87.00 in total, on a $296.15 invoice.
//
// Everything asserted here runs against REAL production text
// (tests/fixtures/walmart-webpricematch-samples.js), never hand-written
// samples, and the fixture is never edited to make the parser pass.
// ══════════════════════════════════════════════════════════════════

'use strict';

const assert = require('assert');

const parser = require('../js/vendor-parsers/walmart-trevipay-invoice.js');
const router = require('../js/vendor-parsers/index.js');
const {
  DOC_1CA959A6,
  DOC_26104552,
  DOC_30082536,
  BASELINE_1CA959A6,
} = require('./fixtures/walmart-webpricematch-samples.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (e) {
    console.error('  FAIL ' + name + '\n       ' + e.message);
    process.exitCode = 1;
  }
}

const FOOTER_RE = /TreviPay|Page \d+ of \d+|Invoice Details/;
const sumAmounts = (items) =>
  Math.round(items.reduce((s, i) => s + (i.amount || 0), 0) * 100) / 100;
const rowsWithSku = (items, sku) => items.filter((i) => i.vendor_sku === sku);

// ── The defect, stated from the frozen pre-fix record ───────────────
// These assertions describe what the parser used to do. They read the
// baseline captured at commit f4d9a7c, so they document the bug without
// needing the old code around; the POST-FIX block below is what fails
// if the repair is ever reverted.

console.log('\nPRE-FIX (record congelato del difetto, parser a f4d9a7c)');

test('PRE: 1ca959a6 dichiarava $296.15 ma sommava solo $209.15', () => {
  assert.strictEqual(BASELINE_1CA959A6.declaredTotal, 296.15);
  assert.strictEqual(BASELINE_1CA959A6.sumOfAmounts, 209.15);
  assert.strictEqual(BASELINE_1CA959A6.missing, 87.00);
});

test('PRE: nessuna riga WebPriceMatch esisteva come item', () => {
  assert.strictEqual(BASELINE_1CA959A6.webPriceMatchRows, 0);
  assert.strictEqual(BASELINE_1CA959A6.itemCount, 22);
});

test('PRE: le due righe perse stavano nella description del brisket', () => {
  const d = BASELINE_1CA959A6.brisketDescription;
  assert.ok(/WebPriceM/.test(d), 'la descrizione conteneva il frammento SKU');
  assert.ok(/FULFILL_VARIANCE/.test(d), 'la descrizione conteneva l\'etichetta');
  assert.strictEqual((d.match(/\$43\.50/g) || []).length, 4,
    'due righe x due importi ciascuna, inghiottite come testo');
  assert.ok(/atch/.test(d), 'anche il frammento alfabetico "atch" era testo');
});

// ── The repair ──────────────────────────────────────────────────────

console.log('\nPOST-FIX (parser corrente, testo reale di produzione)');

const p1 = parser.parse(DOC_1CA959A6);

test('POST: le due righe WebPriceMatch esistono come item separati', () => {
  const rows = rowsWithSku(p1.items, 'WebPriceMatch');
  assert.strictEqual(rows.length, 2, 'due righe, non una e non zero');
  rows.forEach((r) => {
    assert.strictEqual(r.line_type, 'fulfillment_variance');
    assert.strictEqual(r.description, 'FULFILL_VARIANCE');
    assert.strictEqual(r.qty, 1);
  });
});

test('POST: ciascuna vale $43.50, insieme $87.00', () => {
  const rows = rowsWithSku(p1.items, 'WebPriceMatch');
  rows.forEach((r) => {
    assert.strictEqual(r.unit_price, 43.50);
    assert.strictEqual(r.amount, 43.50);
    assert.strictEqual(r.line_total, 43.50);
  });
  assert.strictEqual(Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100, 87.00);
});

test('POST: il frammento alfabetico "atch" e\' ricongiunto nello SKU', () => {
  // "WebPriceMatch" wraps as "WebPriceM" + "atch" in the real PDF.
  assert.strictEqual(rowsWithSku(p1.items, 'WebPriceM').length, 0,
    'nessuno SKU deve restare troncato');
  assert.strictEqual(rowsWithSku(p1.items, 'WebPriceMatch').length, 2);
  assert.ok(!p1.items.some((i) => (i.description || '') === 'atch'),
    '"atch" non deve diventare una description');
});

test('POST: la somma degli item fa $296.15, differenza $0.00', () => {
  assert.strictEqual(sumAmounts(p1.items), 296.15);
  assert.strictEqual(p1.total, 296.15);
  assert.strictEqual(Math.round((sumAmounts(p1.items) - p1.total) * 100) / 100, 0.00);
  assert.strictEqual(p1.items.length, 24, '22 item prima, 24 dopo: le due recuperate');
});

test('POST: la description del brisket e\' pulita', () => {
  const brisket = rowsWithSku(p1.items, '1194236457');
  assert.strictEqual(brisket.length, 1);
  assert.strictEqual(brisket[0].description, 'Beef Prime Brisket, 12.94 1 - 17.0 lb');
  assert.strictEqual(brisket[0].amount, 91.73, 'l\'importo del brisket non cambia');
  assert.ok(!/\$/.test(brisket[0].description), 'nessun importo residuo nel testo');
  assert.ok(!/FULFILL_VARIANCE|WebPrice/.test(brisket[0].description));
});

test('POST: il Router non genera piu\' DOC-TOTAL-001 su 1ca959a6', () => {
  const routed = router.parse(DOC_1CA959A6);
  assert.strictEqual(routed.vendor, 'Walmart Business');
  const blocking = (routed.warnings || []).filter((w) => w && w.code === 'DOC-TOTAL-001');
  assert.deepStrictEqual(blocking, [], 'la quadratura ora torna, quindi nessun warning');
});

// ── Footer contamination ────────────────────────────────────────────

console.log('\nFOOTER TREVIPAY');

test('il footer non entra in nessuna description di 1ca959a6', () => {
  const dirty = p1.items.filter((i) => FOOTER_RE.test(i.description || ''));
  assert.deepStrictEqual(dirty.map((i) => i.vendor_sku), []);
});

test('30082536: "Fresh Navel Orange, Each" non porta piu\' il footer', () => {
  const p = parser.parse(DOC_30082536);
  const dirty = p.items.filter((i) => FOOTER_RE.test(i.description || ''));
  assert.deepStrictEqual(dirty.map((i) => i.description), [],
    'nessuna description contaminata');
  const orange = p.items.filter((i) => /Navel Orange/.test(i.description || ''));
  assert.strictEqual(orange.length, 1);
  assert.strictEqual(orange[0].description, 'Fresh Navel Orange, Each');
});

test('26104552: il footer non contamina piu\' la riga FULFILL_VARIANCE', () => {
  const p = parser.parse(DOC_26104552);
  const dirty = p.items.filter((i) => FOOTER_RE.test(i.description || ''));
  assert.deepStrictEqual(dirty.map((i) => i.description), []);
  p.items
    .filter((i) => i.line_type === 'fulfillment_variance')
    .forEach((i) => assert.strictEqual(i.description, 'FULFILL_VARIANCE'));
});

test('una description che cita un anno non viene scambiata per footer', () => {
  // The footer rule is anchored at line start; ordinary prose is safe.
  const p = parser.parse(DOC_26104552);
  assert.ok(p.items.length > 0);
  assert.ok(p.items.every((i) => (i.description || '').length > 0),
    'nessuna description e\' stata svuotata dalla regola footer');
});

// ── The already-supported row types must not move ───────────────────

console.log('\nTIPI DI RIGA GIA\' SUPPORTATI — INVARIATI');

test('26104552 quadra ancora al centesimo', () => {
  const p = parser.parse(DOC_26104552);
  assert.strictEqual(sumAmounts(p.items), p.total);
  assert.strictEqual(p.total, 317.41);
});

test('SubDown resta fulfillment_variance con il suo SKU', () => {
  const p = parser.parse(DOC_26104552);
  const sub = rowsWithSku(p.items, 'SubDown');
  assert.strictEqual(sub.length, 4);
  sub.forEach((r) => {
    assert.strictEqual(r.line_type, 'fulfillment_variance');
    assert.strictEqual(r.description, 'FULFILL_VARIANCE');
  });
});

test('Express Fee resta handling, SKU multi-parola intatto', () => {
  const p = parser.parse(DOC_26104552);
  const fee = rowsWithSku(p.items, 'Express Fee');
  assert.strictEqual(fee.length, 1);
  assert.strictEqual(fee[0].line_type, 'handling');
  assert.strictEqual(fee[0].description, 'HANDLING');
});

test('ALT_PAYMENT_METHODS resta adjustment con etichetta canonica', () => {
  const p = parser.parse(DOC_26104552);
  const adj = rowsWithSku(p.items, 'ALT_PAYMENT_METHODS');
  assert.strictEqual(adj.length, 1);
  assert.strictEqual(adj[0].line_type, 'adjustment');
  assert.strictEqual(adj[0].description, 'Alternative Payment Methods');
  assert.ok(adj[0].amount < 0, 'resta negativo');
});

test('Shipping resta shipping e 30082536 quadra', () => {
  const p = parser.parse(DOC_30082536);
  const ship = rowsWithSku(p.items, 'Shipping');
  assert.strictEqual(ship.length, 4);
  ship.forEach((r) => {
    assert.strictEqual(r.line_type, 'shipping');
    assert.strictEqual(r.description, 'SHIPPING');
  });
  assert.strictEqual(sumAmounts(p.items), p.total);
  assert.strictEqual(p.total, 33.88);
});

test('gli SKU prodotto numerici non sono toccati dalla nuova regola', () => {
  const p = parser.parse(DOC_1CA959A6);
  const products = p.items.filter((i) => i.line_type === 'product');
  assert.ok(products.length > 0);
  products.forEach((i) => assert.ok(/^\d{5,}$/.test(i.vendor_sku),
    'SKU prodotto inatteso: ' + i.vendor_sku));
});

// ── The rule must stay fail-closed ──────────────────────────────────

console.log('\nFAIL-CLOSED');

test('un testo qualunque senza tail monetaria resta description', () => {
  // A line that merely ends in an all-caps word is not a row.
  const txt = [
    'SKU Description Quantity Unit Price Discount Tax Details Tax Billed Total',
    '10450114 Great Value Whole 2 $3.08 $0.00 $0.00 $6.16',
    'Vitamin D Milk SHIPPING',
    'Invoice Summary',
  ].join('\n');
  const p = parser.parse(txt);
  assert.strictEqual(p.items.length, 1, 'una riga sola, nessuna riga inventata');
  assert.strictEqual(p.items[0].line_type, 'product');
  assert.ok(/SHIPPING/.test(p.items[0].description),
    'resta testo di descrizione, non diventa una riga shipping');
});

test('un prodotto la cui descrizione finisce in HANDLING resta prodotto', () => {
  const txt = [
    'SKU Description Quantity Unit Price Discount Tax Details Tax Billed Total',
    '10450114 Some Product HANDLING 2 $3.08 $0.00 $0.00 $6.16',
    'Invoice Summary',
  ].join('\n');
  const p = parser.parse(txt);
  assert.strictEqual(p.items.length, 1);
  assert.strictEqual(p.items[0].line_type, 'product',
    'il lead token numerico vince sempre sull\'etichetta');
  assert.strictEqual(p.items[0].vendor_sku, '10450114');
});

test('un\'etichetta sconosciuta con tail completa resta description', () => {
  const txt = [
    'SKU Description Quantity Unit Price Discount Tax Details Tax Billed Total',
    '10450114 Great Value Milk 2 $3.08 $0.00 $0.00 $6.16',
    'SomeCode TOTALLY_NEW_LABEL 1 $5.00 $0.00 $0.00 $5.00',
    'Invoice Summary',
  ].join('\n');
  const p = parser.parse(txt);
  assert.strictEqual(p.items.length, 1,
    'solo le tre etichette censite sui documenti reali sono accettate');
});

test('un frammento alfabetico non si attacca a uno SKU prodotto', () => {
  const txt = [
    'SKU Description Quantity Unit Price Discount Tax Details Tax Billed Total',
    '27935840 Freshness Guaranteed 1 $13.70 $0.00 $0.00 $13.70',
    'Tray',
    'Invoice Summary',
  ].join('\n');
  const p = parser.parse(txt);
  assert.strictEqual(p.items[0].vendor_sku, '27935840', 'SKU intatto');
  assert.ok(/Tray/.test(p.items[0].description), '"Tray" resta descrizione');
});

test('un frammento non si attacca a uno SKU alfabetico corto', () => {
  // "SubDown" (7) and "Shipping" (8) are below the observed 9-char
  // truncation width, so they are never treated as wrapped.
  const txt = [
    'SKU Description Quantity Unit Price Discount Tax Details Tax Billed Total',
    'SubDown FULFILL_VARIANCE 1 $6.39 $0.00 $0.00 $6.39',
    'abcd',
    'Invoice Summary',
  ].join('\n');
  const p = parser.parse(txt);
  assert.strictEqual(p.items[0].vendor_sku, 'SubDown', 'SKU corto non ricostruito');
  assert.strictEqual(p.items[0].description, 'FULFILL_VARIANCE',
    'e il frammento non contamina comunque la description');
});

console.log('\n' + passed + ' test superati' +
  (process.exitCode ? ' — CI SONO FALLIMENTI' : ''));
