// ══════════════════════════════════════════════════════════════════
// XCF-ORDINI — test lato client di js/purchase-order.js (Node puro)
// `node tests/xcf-ordini-client.test.js`
// Costruzione dei gruppi per po_save_draft, controlli bloccanti di riga,
// idempotency key stabile nei retry, rendering per stato e ruolo.
// ══════════════════════════════════════════════════════════════════
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const po = require(path.join(__dirname, '..', 'js', 'purchase-order.js'));

let pass = 0, fail = 0;
function test(name, fn){
  try{ fn(); pass++; console.log('  ✓ ' + name); }
  catch(e){ fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
const H = "Hardie's Fresh Foods / Dairyland Produce";

test('gruppi: solo righe con fornitore risolto, append per fornitore', () => {
  const g = po.poBuildSaveGroups([
    { requested_text: 'cream', quantity: 2, unit: 'case', vendor: H, vendor_status: 'resolved', ingredient_id: 'i1' },
    { requested_text: 'shrimp', quantity: 5, unit: 'lb', vendor: 'Fruge Seafood', vendor_status: 'resolved' },
    { requested_text: 'milk', quantity: 1, unit: 'gal', vendor: null, vendor_status: 'unresolved' },
    { requested_text: 'romaine', quantity: 1, unit: 'case', vendor: H, vendor_status: 'ambiguous' }
  ], null, null, null, '2026-10-05');
  assert.strictEqual(g.length, 2);
  assert(g.every(x => x.mode === 'append' && x.delivery_date === '2026-10-05'));
  assert.strictEqual(g.find(x => x.vendor_name === H).lines.length, 1);
});

test('gruppi: ordine in modifica = replace con expected_revision, anche se svuotato', () => {
  const g = po.poBuildSaveGroups([], 'ord-1', H, 7, '');
  assert.deepStrictEqual(g, [{ vendor_name: H, lines: [], mode: 'replace', order_id: 'ord-1', expected_revision: 7 }]);
});

test('gruppi: needs_review viaggia fino al server (riga ambigua non diventa pronta)', () => {
  const g = po.poBuildSaveGroups([{ requested_text: 'x', quantity: 1, unit: 'case', vendor: H, vendor_status: 'resolved', needs_review: true }], null, null, null, null);
  assert.strictEqual(g[0].lines[0].needs_review, true);
  assert.strictEqual('delivery_date' in g[0], false);
});

test('problemi di riga: quantita e confezione obbligatorie, ambigua bloccante', () => {
  const codes = l => po.poLineClientIssues(l).map(i => i.code).sort();
  assert.deepStrictEqual(codes({ requested_text: 'a', quantity: null, unit: '' }), ['QTY_MISSING', 'UNIT_MISSING']);
  assert.deepStrictEqual(codes({ requested_text: 'a', quantity: 0, unit: 'lb' }), ['QTY_MISSING']);
  assert.deepStrictEqual(codes({ requested_text: 'a', quantity: 2, unit: 'lb', needs_review: true }), ['AMBIGUOUS']);
  assert.deepStrictEqual(codes({ requested_text: 'a', quantity: 2, unit: 'lb' }), []);
});

test('idempotency key: stabile per stessa azione/ordine/hash, diversa se cambia hash', () => {
  const a = po.poIdemKey('send', 'o1', 'h1');
  assert.strictEqual(po.poIdemKey('send', 'o1', 'h1'), a);
  assert.notStrictEqual(po.poIdemKey('send', 'o1', 'h2'), a);
  assert(a.length >= 8);
});

test('messaggi di errore in italiano per i codici del server', () => {
  assert(/doppio/i.test(po.poReasonText('DUPLICATE_SUSPECTED')));
  assert(/conferma/i.test(po.poReasonText('CONFIRMATION_STALE')));
  assert(/Errore/.test(po.poReasonText('XYZ')));
});

const baseOrder = (over) => Object.assign({
  id: 'o1', vendor_name: H, status: 'ready', revision: 3, created_by: 'Tela', delivery_date: '2026-10-05',
  summary_hash: 'abcdef0123456789'.repeat(4), summary_valid: true, confirmation_valid: false,
  summary: { vendor: H, delivery_date: '2026-10-05', lines: [{ position: 1, name: 'Heavy Cream', quantity: 2, unit: 'case', vendor_sku: '00101' }] },
  lines: [{ id: 'l1', requested_text: 'cream', matched_name: 'Heavy Cream', quantity: 2, unit: 'case', vendor_sku: '00101',
            reference_price: 42.5, reference_price_unit: 'case', reference_price_date: '2026-08-01', price_stale: true,
            line_status: 'warning', issues: [{ code: 'PRICE_STALE', blocking: false, msg: 'Prezzo vecchio' }] }],
  events: [], complaint_drafts: [], channel_info: { channel: 'portal', notes: 'Portale Entree' }
}, over || {});

test('ready: solo admin vede "Confermo", con hash corto; Tela vede attesa', () => {
  po.poSetOrderForTest(baseOrder(), { is_admin: true, name: 'Max' });
  let html = po.poRenderOrder();
  assert(/Confermo questo riepilogo/.test(html) && /Riepilogo #abcdef01/.test(html));
  assert(/\(vecchio\)/.test(html), 'prezzo vecchio segnalato');
  po.poSetOrderForTest(baseOrder(), { is_admin: false, name: 'Tela' });
  html = po.poRenderOrder();
  assert(!/Confermo questo riepilogo/.test(html) && /attesa della conferma di Max/.test(html));
});

test('confirmed: pulsante invio e dichiaratamente SIMULAZIONE; invio manuale disponibile', () => {
  po.poSetOrderForTest(baseOrder({ status: 'confirmed', confirmed_hash: 'x'.repeat(64), confirmation_valid: true, confirmed_by: 'Max' }), { is_admin: true });
  const html = po.poRenderOrder();
  assert(/SIMULAZIONE — nulla parte/.test(html));
  assert(/Registra invio manuale/.test(html));
  po.poSetOrderForTest(baseOrder({ status: 'confirmed', confirmation_valid: true }), { is_admin: false });
  assert(!/SIMULAZIONE — nulla parte/.test(po.poRenderOrder()), 'Tela non invia');
});

test('conferma non piu valida (ordine cambiato) e segnalata', () => {
  po.poSetOrderForTest(baseOrder({ status: 'confirmed', confirmation_valid: false }), { is_admin: true });
  assert(/cambiato dopo il riepilogo/.test(po.poRenderOrder()));
});

test('doppioni: elenco + spunta solo per admin su ordine confermato', () => {
  const dup = { window_hours: 48, items: [{ kind: 'vendor_confirmation', at: '2026-10-01T10:00:00Z', detail: 'conferma #07148732' }] };
  po.poSetOrderForTest(baseOrder({ status: 'confirmed', confirmation_valid: true, duplicates: dup }), { is_admin: true });
  let html = po.poRenderOrder();
  assert(/Possibile doppio ordine/.test(html) && /poAckDup/.test(html) && /07148732/.test(html));
  po.poSetOrderForTest(baseOrder({ status: 'confirmed', confirmation_valid: true, duplicates: dup }), { is_admin: false });
  html = po.poRenderOrder();
  assert(!/poAckDup/.test(html) && /Solo Max/.test(html));
});

test('sent simulato su ordine di prova e etichettato come tale', () => {
  po.poSetOrderForTest(baseOrder({ status: 'sent', send_mode: 'simulated', is_test: true, sent_by: 'Max' }), { is_admin: true });
  const html = po.poRenderOrder();
  assert(/SIMULATO — ordine di prova/.test(html) && /ORDINE DI PROVA/.test(html) && /Check-in ricevimento/.test(html));
});

test('bozza reclamo mostrata come NON inviata', () => {
  po.poSetOrderForTest(baseOrder({ status: 'received', complaint_drafts: [{ subject: 'Delivery issue', body: '- Heavy Cream: missing' }] }), { is_admin: true });
  const html = po.poRenderOrder();
  assert(/Bozza reclamo — NON inviata/.test(html) && /missing/.test(html));
  assert(!/Annulla ordine/.test(html), 'ricevuto non si annulla');
});

test('ricevimento: righe con stato e foto facoltativa', () => {
  po.poSetOrderForTest(baseOrder({ status: 'sent_manual' }), { is_admin: false });
  po.poSetReceiveDraftForTest({ l1: { status: 'damaged', received_qty: 1, note: 'leak' } });
  const html = po.poRenderReceive();
  assert(/Danneggiato/.test(html) && /Foto \(facoltativa\)/.test(html) && /BOZZA di reclamo/.test(html));
});

test('lista: sezioni per stato, testo escapato', () => {
  po.poSetOpenOrdersForTest([
    { id: 'a', vendor_name: '<b>X</b>', status: 'ready', created_at: '2026-10-02T10:00:00Z', line_count: 2, blocking_count: 0 },
    { id: 'b', vendor_name: H, status: 'draft', created_at: '2026-10-02T10:00:00Z', line_count: 1, blocking_count: 1 }
  ]);
  const html = po.poRenderOrdersList();
  assert(/Da confermare \(Max\)/.test(html) && /Bozze/.test(html) && /1 da sistemare/.test(html));
  assert(!/<b>X<\/b>/.test(html) && /&lt;b&gt;X/.test(html));
});

test('nessuna scrittura diretta su purchase_orders/purchase_order_lines nel client', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'purchase-order.js'), 'utf8');
  assert(!/from\('purchase_orders'\)/.test(src) && !/from\('purchase_order_lines'\)/.test(src));
  assert(!/PO_VENDOR\b/.test(src.replace(/PO_VENDOR_CANONICAL/g, '')), 'PO_VENDOR inesistente rimosso');
});

test('edge send-purchase-order: nessun trasporto reale nel codice, default simulazione', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'edge-functions', 'send-purchase-order', 'index.ts'), 'utf8');
  assert(!/gmail|resend|smtp|sendgrid|mailgun|api\.telegram/i.test(src.replace(/\/\/.*$/gm, '')));
  assert(/PO_REAL_SEND_ENABLED'\) === 'true'/.test(src));
  assert(/REAL_TRANSPORT_NOT_IMPLEMENTED/.test(src));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
