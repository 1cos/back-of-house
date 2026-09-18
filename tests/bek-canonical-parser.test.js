// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 42 — Ben E. Keith Order Confirmation, parser canonico.
// Plain Node, zero dipendenze: `node tests/bek-canonical-parser.test.js`
//
// Esegue il parser REALE (js/vendor-parsers/ben-e-keith-order-confirmation.js),
// lo stesso file che viene embeddato in vendor-doc-auto-import e caricato
// dal browser — non una riscrittura.
//
// Le fixture riproducono la struttura autentica del template SendGrid
// (tabella prezzo annidata, status in <div class="status-val">, wrapper
// esterno), modellata sui 4 documenti di produzione misurati.
// ══════════════════════════════════════════════════════════════════
const assert = require('assert');
const P   = require('../js/vendor-parsers/ben-e-keith-order-confirmation');
const IDX = require('../js/vendor-parsers/index');
const U   = require('../js/vendor-parsers/utils');
const F   = require('./fixtures/bek-html-real-shape');

// MICRO-TASK 42: i blocchi estratti da vendor-documents-review.js delegano
// la regola "questo documento genera un acquisto?" al modulo canonico.
// Iniettata QUI IN TESTA: alcuni test girano a livello top-level e devono
// trovarla gia definita. E la REGOLA VERA, non uno stub.
global.vdrIsPurchasableDocument = require('../js/vendor-parsers/ben-e-keith-order-confirmation').isPurchasableDocument;




let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message ? e.message : e)); }
}
function codes(warnings) { return (warnings || []).map(w => w.code); }
function lineCodes(item) { return codes(item.warnings); }

console.log('\nMICRO-TASK 42 — parser canonico Ben E. Keith\n');

// ── H1 / A: acknowledgement ──────────────────────────────────────
test('H1: tutti Requested + confirmed=0 -> ACKNOWLEDGEMENT, nessun acquisto', () => {
  const r = P.parse(F.BEK_ACKNOWLEDGEMENT);
  assert.strictEqual(r.document_class, 'acknowledgement');
  assert.strictEqual(r.items.length, 4);
  assert.ok(r.items.every(i => i.qty === 0), 'ogni qty deve essere 0');
  assert.ok(r.items.every(i => i.purchasable === false), 'nessun item acquistabile');
  assert.strictEqual(r.computed_purchase_total, 0, 'purchase total deve essere 0');
  assert.ok(!codes(r.warnings).includes('BEK_CLASS_AMBIGUOUS'));
});

test('H1b: acknowledgement conserva Sales Order e tutti gli item nel parsed_json', () => {
  const r = P.parse(F.BEK_ACKNOWLEDGEMENT);
  assert.strictEqual(r.document_number, '0003126637');
  assert.strictEqual(r.items.length, 4, 'gli item restano visibili per audit');
  assert.strictEqual(r.document_type, 'order_confirmation', 'la sorgente originale non si perde');
});

// ── H2 / G: l'header non deve influenzare la classificazione ─────
test('H2: header "ready for delivery" ma Requested/0 -> ancora ACKNOWLEDGEMENT (caso 0003198361)', () => {
  const r = P.parse(F.BEK_ACK_MISLEADING_HEADER);
  assert.ok(/ready for delivery/i.test(F.BEK_ACK_MISLEADING_HEADER), 'la fixture deve contenere davvero l\'header fuorviante');
  assert.strictEqual(r.document_class, 'acknowledgement');
  assert.strictEqual(r.computed_purchase_total, 0);
});

test('H2b: il disclaimer e solo evidenza diagnostica, non una decisione', () => {
  const ack = P.parse(F.BEK_ACKNOWLEDGEMENT);
  const op  = P.parse(F.BEK_OPERATIONAL_SAME_SO);
  assert.strictEqual(ack.has_confirmation_disclaimer, true);
  assert.strictEqual(op.has_confirmation_disclaimer, false);
  // ...ma la classe deriva dalle righe: lo si prova togliendo il disclaimer
  // da una ack e verificando che resti ack.
  const stripped = F.BEK_ACKNOWLEDGEMENT.replace(/Disclaimer:[\s\S]*?<\/table>/i, '');
  const r = P.parse(stripped);
  assert.strictEqual(r.has_confirmation_disclaimer, false, 'disclaimer rimosso');
  assert.strictEqual(r.document_class, 'acknowledgement', 'la classe non cambia senza disclaimer');
});

// ── H3: operational confirmation ─────────────────────────────────
test('H3: tutti Filled + confirmed>0 -> OPERATIONAL_CONFIRMATION', () => {
  const r = P.parse(F.BEK_OPERATIONAL_SAME_SO);
  assert.strictEqual(r.document_class, 'operational_confirmation');
  assert.ok(r.items.every(i => i.purchasable === true));
  assert.strictEqual(r.computed_purchase_total, 312.86);
  assert.strictEqual(r.computed_order_total, 312.86);
});

// ── H4 / B: mixed / partial ──────────────────────────────────────
test('H4: mixed (A ord3 conf2, B ord1 conf0) -> A acquistato 2, B non acquistato', () => {
  const r = P.parse(F.BEK_MIXED_PARTIAL);
  assert.strictEqual(r.document_class, 'operational_confirmation');
  const [a, b] = r.items;
  assert.strictEqual(a.qty, 2, 'A registra il CONFIRMED');
  assert.strictEqual(a.qty_ordered, 3);
  assert.strictEqual(a.purchasable, true);
  assert.strictEqual(b.qty, 0, 'B non confermato');
  assert.strictEqual(b.purchasable, false, 'B non partecipa all\'acquisto');
  assert.notStrictEqual(b.qty, b.qty_ordered, 'B non deve mai ricadere su ORDERED');
});

test('H4b: BEK_QTY_SHORT e informativo, non bloccante', () => {
  const r = P.parse(F.BEK_MIXED_PARTIAL);
  const w = r.items[0].warnings.find(x => x.code === 'BEK_QTY_SHORT');
  assert.ok(w, 'il warning deve esserci');
  assert.strictEqual(w.severity, 'info', 'non deve essere blocking');
});

test('H4c: nessun fallback su ORDERED da nessuna parte', () => {
  const r = P.parse(F.BEK_MIXED_PARTIAL);
  assert.strictEqual(r.computed_purchase_total, 20, '10 x 2 = 20, la riga B non entra');
  assert.strictEqual(r.computed_order_total, 55, '10 x 3 + 25 x 1 = 55');
});

// ── H5 / C / D: i due totali ─────────────────────────────────────
test('H5: riconciliazione ORDERED contro Order Total dichiarato', () => {
  const r = P.parse(F.BEK_MIXED_PARTIAL);
  assert.strictEqual(r.total, 55.00, 'Order Total dichiarato');
  assert.strictEqual(r.computed_order_total, 55.00);
  assert.ok(!codes(r.warnings).includes('DOC-TOTAL-001'), 'ordered combacia -> nessun blocco');
});

test('H5b: caso esatto del requisito D — ord 3, conf 2, prezzo 10, dichiarato 30', () => {
  const r = P.parse(F.BEK_SHORT_FILL_CASE_D);
  assert.strictEqual(r.total, 30.00,                 'declared Order Total = 30');
  assert.strictEqual(r.computed_order_total, 30.00,  'document reconciliation 30 == 30');
  assert.strictEqual(r.computed_purchase_total, 20.00, 'purchase total = 20');
  assert.ok(!codes(r.warnings).includes('DOC-TOTAL-001'), 'NON deve emettere DOC-TOTAL-001');
  assert.strictEqual(r.document_class, 'operational_confirmation');
});

test('H5c: ORDERED che non combacia col dichiarato -> DOC-TOTAL-001 bloccante', () => {
  const broken = F.BEK_SHORT_FILL_CASE_D.replace('<b>$30.00</b>', '<b>$99.00</b>');
  const r = P.parse(broken);
  const w = (r.warnings || []).find(x => x.code === 'DOC-TOTAL-001');
  assert.ok(w, 'deve emettere DOC-TOTAL-001');
  assert.strictEqual(w.severity, 'blocking');
});

test('H5d: subtotal resta null — checkTotals non deve confrontare la somma con se stessa', () => {
  const r = P.parse(F.BEK_SHORT_FILL_CASE_D);
  assert.strictEqual(r.subtotal, null);
  assert.strictEqual(r.totals_reconciled, true, 'il parser dichiara di aver gia riconciliato');
});

test('H5e: checkTotals rispetta totals_reconciled e non rigiudica', () => {
  const r = IDX.parse(F.BEK_SHORT_FILL_CASE_D);
  assert.ok(!codes(r.warnings).includes('DOC-TOTAL-001'),
    'passando dal dispatcher, checkTotals non deve aggiungere un secondo DOC-TOTAL-001 confrontando il purchase total');
});

// ── A: ambiguo -> fail closed ────────────────────────────────────
test('A: confirmed=0 ma status Cancelled -> AMBIGUOUS bloccante, mai acknowledgement', () => {
  const r = P.parse(F.BEK_AMBIGUOUS_CANCELLED);
  assert.strictEqual(r.document_class, 'ambiguous');
  const w = (r.warnings || []).find(x => x.code === 'BEK_CLASS_AMBIGUOUS');
  assert.ok(w, 'deve emettere BEK_CLASS_AMBIGUOUS');
  assert.strictEqual(w.severity, 'blocking');
});

// ── J: confirmed mancante ────────────────────────────────────────
test('J: CONFIRMED illeggibile -> qty null + BEK_CONFIRMED_MISSING bloccante', () => {
  const broken = F.BEK_SHORT_FILL_CASE_D.replace(
    '<td valign="top" class="text-right">2</td>\n          <td valign="top"><div class="status-val">',
    '<td valign="top" class="text-right">n/d</td>\n          <td valign="top"><div class="status-val">'
  );
  const r = P.parse(broken);
  const it = r.items[0];
  assert.strictEqual(it.qty, null, 'niente quantita inventata');
  assert.notStrictEqual(it.qty, it.qty_ordered, 'mai ORDERED come fallback');
  const w = it.warnings.find(x => x.code === 'BEK_CONFIRMED_MISSING');
  assert.ok(w, 'deve emettere BEK_CONFIRMED_MISSING');
  assert.strictEqual(w.severity, 'blocking');
});

// ── E: price intelligence solo su item confermati ────────────────
test('E: solo gli item con confirmed>0 sono purchasable (price intelligence)', () => {
  const r = P.parse(F.BEK_MIXED_PARTIAL);
  const purch = r.items.filter(i => i.purchasable);
  assert.strictEqual(purch.length, 1, 'un solo item acquistabile');
  assert.strictEqual(purch[0].vendor_sku, '111111');
  // ...e l'item non acquistato resta comunque nel documento
  assert.strictEqual(r.items.length, 2, 'l\'item non confermato non sparisce dal parsed_json');
});

test('E2: un acknowledgement non ha nessun item purchasable', () => {
  const r = P.parse(F.BEK_ACKNOWLEDGEMENT);
  assert.strictEqual(r.items.filter(i => i.purchasable).length, 0);
});

// ── F: stesso Sales Order, due revisioni ─────────────────────────
test('F: ack e operational condividono il Sales Order ma solo una e un acquisto', () => {
  const ack = P.parse(F.BEK_ACKNOWLEDGEMENT);
  const op  = P.parse(F.BEK_OPERATIONAL_SAME_SO);
  assert.strictEqual(ack.document_number, op.document_number, 'stesso Sales Order');
  assert.strictEqual(ack.document_class, 'acknowledgement');
  assert.strictEqual(op.document_class,  'operational_confirmation');
  assert.strictEqual(ack.computed_purchase_total, 0);
  assert.strictEqual(op.computed_purchase_total, 312.86);
});

// ── H9: idempotenza a livello parser ─────────────────────────────
test('H9: la stessa email parsata due volte da risultato identico', () => {
  const a = JSON.stringify(P.parse(F.BEK_OPERATIONAL_SAME_SO));
  const b = JSON.stringify(P.parse(F.BEK_OPERATIONAL_SAME_SO));
  assert.strictEqual(a, b, 'parser deterministico');
});

// ── struttura reale ──────────────────────────────────────────────
test('struttura reale: tabella prezzo annidata, status-val, entita, ITEM <div>NAME</div>', () => {
  const r = P.parse(F.BEK_HTML_REAL_SHAPE, { subject: F.SUBJECT_REAL_SHAPE });
  const E = F.EXPECTED_REAL_SHAPE;
  assert.strictEqual(r.document_number, E.document_number);
  assert.strictEqual(r.delivery_date, E.delivery_date);
  assert.deepStrictEqual(r.items.map(i => i.vendor_sku), E.skus);
  assert.deepStrictEqual(r.items.map(i => i.unit_price), E.unit_prices);
  assert.deepStrictEqual(r.items.map(i => i.qty), E.confirmed);
  assert.deepStrictEqual(r.items.map(i => i.item_status), E.statuses);
  assert.strictEqual(r.items[1].brand, 'Rotella’s Italian Bakery'.replace('’', "'"));
  assert.strictEqual(r.items[0].description, 'Cheese Mascarpone');
});

// ── parity helper interni vs utils.js (anti-drift) ───────────────
test('anti-drift: parseDate/parsePrice identici a vendor-parsers/utils.js', () => {
  const dates = ['09/17/2026', '1/2/26', '2026-09-17', '', null, 'boh', '12/31/2099'];
  for (const d of dates) {
    assert.strictEqual(P.parseDate(d), U.parseDate(d), 'parseDate diverge su ' + JSON.stringify(d));
  }
  const prices = ['$1,234.56', '1234.56', '-49.92', '$.00', '', null, '82.73', 'x'];
  for (const p of prices) {
    assert.strictEqual(P.parsePrice(p), U.parsePrice(p), 'parsePrice diverge su ' + JSON.stringify(p));
  }
});

// ── routing dal dispatcher ───────────────────────────────────────
test('dispatcher: detectVendor bek + detectDocumentType order_confirmation', () => {
  assert.strictEqual(IDX.detectVendor(F.BEK_OPERATIONAL_SAME_SO), 'bek');
  assert.strictEqual(IDX.detectDocumentType(F.BEK_OPERATIONAL_SAME_SO, 'bek'), 'order_confirmation');
  const r = IDX.parse(F.BEK_OPERATIONAL_SAME_SO);
  assert.strictEqual(r.vendor, 'Ben E. Keith');
  assert.strictEqual(r.document_type, 'order_confirmation');
});

test('dispatcher: "Sales Order" non riclassifica documenti di altri vendor', () => {
  assert.strictEqual(IDX.detectDocumentType('Sales Order 123 INVOICE'), 'invoice');
  assert.strictEqual(IDX.detectDocumentType('CONFIRMATION OF SALE - #07115822'), 'order_confirmation');
  assert.strictEqual(IDX.detectDocumentType('INVOICE/POD 06991299'), 'invoice');
});

// ── isPurchasableDocument ────────────────────────────────────────
test('isPurchasableDocument: solo invoice + BEK order_confirmation', () => {
  const T = [
    ["Hardie's Fresh Foods / Dairyland Produce", 'invoice', true],
    ['Walmart Business', 'invoice', true],
    ['Ben E. Keith', 'invoice', true],
    ['Ben E. Keith', 'order_confirmation', true],
    ['ben e keith', 'order_confirmation', true],
    ['bek', 'order_confirmation', true],
    ["Hardie's Fresh Foods / Dairyland Produce", 'order_confirmation', false],
    ['FreshPoint Dallas', 'order_confirmation', false],
    ['Fruge Seafood', 'order_confirmation', false],
    ['Ben E. Keith', 'credit_memo', false],
    ['Ben E. Keith Holdings', 'order_confirmation', false],
    [null, 'order_confirmation', false],
    [null, 'invoice', true],
  ];
  for (const [v, d, want] of T) {
    assert.strictEqual(IDX.isPurchasableDocument(v, d), want,
      'isPurchasableDocument(' + JSON.stringify(v) + ', ' + d + ')');
  }
});

// ── parity: copia inline del browser vs regola canonica ─────────
test('parity: il fallback inline di vendor-documents-review.js non puo divergere dalla regola canonica', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'js', 'vendor-documents-review.js'), 'utf8');
  const m = src.match(/function vdrIsPurchasableDocumentFallback\(vendor, documentType\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'la funzione di fallback deve esistere in vendor-documents-review.js');
  // eslint-disable-next-line no-new-func
  const fallback = new Function('return (' + m[0] + ')')();

  const vendors = [
    'Ben E. Keith', 'ben e keith', 'BEN E. KEITH', 'Ben E Keith', 'bek', 'BEK',
    'Ben E. Keith Holdings', "Hardie's Fresh Foods / Dairyland Produce",
    'FreshPoint Dallas', 'Fruge Seafood', 'Walmart Business', '', '   ', null, undefined,
  ];
  const types = ['invoice', 'order_confirmation', 'credit_memo', 'unknown', null, undefined];
  let checked = 0;
  for (const v of vendors) {
    for (const t of types) {
      assert.strictEqual(
        fallback(v, t), IDX.isPurchasableDocument(v, t),
        'divergenza su vendor=' + JSON.stringify(v) + ' type=' + JSON.stringify(t));
      checked++;
    }
  }
  assert.ok(checked >= 80, 'tabella di verita troppo piccola: ' + checked);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail === 0 ? 0 : 1);
