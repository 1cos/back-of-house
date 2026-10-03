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

// ── XCF-CW: invio reale Chef's Warehouse ──────────────────────────────
const cwOrder = (over) => baseOrder(Object.assign({ status: 'confirmed', confirmed_hash: 'c'.repeat(64), confirmation_valid: true, confirmed_by: 'Max',
  channel_info: { channel: 'portal', transport: 'cw_portal', real_send_allowed: true }, send_attempts: [] }, over || {}));

test('XCF-CW: pulsante ORDINE REALE solo con interruttori accesi, canale cw_portal e admin', () => {
  po.poSetSettingsForTest({ real_send_enabled: false });
  po.poSetOrderForTest(cwOrder(), { is_admin: true });
  assert(!/ORDINE REALE/.test(po.poRenderOrder()), 'interruttore generale spento');
  po.poSetSettingsForTest({ real_send_enabled: true });
  assert(/ORDINE REALE/.test(po.poRenderOrder()) && /#cccccccc/.test(po.poRenderOrder()), 'acceso: pulsante con hash corto');
  po.poSetOrderForTest(cwOrder(), { is_admin: false });
  assert(!/ORDINE REALE/.test(po.poRenderOrder()), 'Tela non invia');
  po.poSetOrderForTest(cwOrder({ channel_info: { channel: 'portal', transport: null, real_send_allowed: true } }), { is_admin: true });
  assert(!/ORDINE REALE/.test(po.poRenderOrder()), 'canale senza transport cw');
  po.poSetOrderForTest(cwOrder({ channel_info: { channel: 'portal', transport: 'cw_portal', real_send_allowed: false } }), { is_admin: true });
  assert(!/ORDINE REALE/.test(po.poRenderOrder()), 'fornitore non autorizzato');
  po.poSetOrderForTest(cwOrder({ is_test: true }), { is_admin: true });
  assert(!/ORDINE REALE/.test(po.poRenderOrder()), 'ordine di prova');
});

test('XCF-CW: in coda / in invio / incerto / fallito mostrati, nessun pulsante mentre e pending', () => {
  po.poSetSettingsForTest({ real_send_enabled: true });
  po.poSetOrderForTest(cwOrder({ send_attempts: [{ mode: 'real', state: 'pending', claimed_at: null, result: null }] }), { is_admin: true });
  let html = po.poRenderOrder();
  assert(/In coda per il Mac Mini/.test(html) && !/ORDINE REALE/.test(html) && !/SIMULAZIONE — nulla parte/.test(html));
  po.poSetOrderForTest(cwOrder({ send_attempts: [{ mode: 'real', state: 'pending', claimed_at: '2026-10-03T03:00:00Z', result: null }] }), { is_admin: true });
  assert(/sta inviando/.test(po.poRenderOrder()));
  po.poSetOrderForTest(cwOrder({ send_attempts: [{ mode: 'real', state: 'pending', claimed_at: 'x', result: { uncertain: true, error: 'SUBMIT_NO_ANSWER' } }] }), { is_admin: true });
  html = po.poRenderOrder();
  assert(/Esito NON certo/.test(html) && !/ORDINE REALE/.test(html), 'incerto: niente nuovo invio');
  po.poSetOrderForTest(cwOrder({ send_attempts: [{ mode: 'real', state: 'failed', result: { error: 'CART_MISMATCH', cart_touched: true } }] }), { is_admin: true });
  html = po.poRenderOrder();
  assert(/NON partito \(CART_MISMATCH\)/.test(html) && /svuotalo/.test(html) && /ORDINE REALE/.test(html), 'fallito: si puo riprovare');
  po.poSetOrderForTest(cwOrder({ send_attempts: [{ mode: 'real', state: 'failed', result: { error: 'OUT_OF_STOCK', cart_touched: true,
    detail: [{ code: 'OUT_OF_STOCK', items: [{ sku: '03075', name: 'Flat Italian Parsley' }] }] } }] }), { is_admin: true });
  assert(/Esaurito su CW: <b>Flat Italian Parsley<\/b>/.test(po.poRenderOrder()), 'esaurito per nome');
  po.poSetSettingsForTest(null);
});

// ── XCF-ORDINI-UX 02: fornitore → Lista / Suggeriti / Abituali / Cerca ──
const CAT = (view) => ({ ok: true, vendor: H, next_deliveries: ['2026-10-05', '2026-10-07'],
  channel: { order_view: view, calendar_source: view === 'list' ? 'to_verify' : 'verified', calendar_note: 'nota' },
  items: [
    { key: '25618', ingredient_id: 'ing-b', vendor_sku: '25618', name: 'Burrata', name_it: 'Burrata', last_unit: 'case', last_price: 24.45, last_date: '2026-09-29',
      days_since: 4, weeks_8: 7, interval_days: 4, suggested: true, habitual: true, pack: '6 x 4oz' },
    { key: '01306', ingredient_id: 'ing-basil', vendor_sku: '01306', name: 'Basil', name_it: 'Basilico', last_unit: 'case', last_price: 18, last_date: '2026-10-02',
      days_since: 1, weeks_8: 5, interval_days: 4, suggested: false, habitual: true },
    { key: "zz o'brien", ingredient_id: null, vendor_sku: null, name: "O'Brien Mix", invoice_description: "O'BRIEN MIX", last_unit: 'case', days_since: 60, weeks_8: 0, suggested: false, habitual: false }
  ] });

test('XCF-ORDINI-UX: vista suggest = Suggeriti con il perche, Abituali, Cerca; consegna dal calendario', () => {
  po.poSetVendorViewForTest(H, CAT('suggest'), {}, '');
  const html = po.poRenderVendor();
  assert(/Suggeriti \(1\)/.test(html) && /Acquistati abitualmente \(1\)/.test(html) && /Tutti \/ cerca/.test(html));
  assert(/7 delle ultime 8 settimane · ultimo 4 gg fa · di solito ogni 4 gg/.test(html), 'perche del suggerimento');
  assert(/Basilico · Basil/.test(html), 'nome italiano mostrato');
  assert(/lun 05\/10/.test(html) && /mer 07\/10/.test(html), 'prossime consegne');
  assert(!/O'Brien|O&#39;Brien/.test(html), 'articolo vecchio solo in Cerca');
  po.poSetVendorViewForTest(H, CAT('suggest'), {}, 'brien');
  assert(/O&#39;Brien Mix|O'Brien Mix/.test(po.poRenderVendor()), 'Cerca trova anche i vecchi');
});

test('XCF-ORDINI-UX: vista list = tutti gli articoli, calendario "da verificare"', () => {
  po.poSetVendorViewForTest('Fruge Seafood', CAT('list'), {}, '');
  const html = po.poRenderVendor();
  assert(/Articoli comprati da Zeno \(3\)/.test(html) && /da verificare/.test(html) && !/Suggeriti/.test(html));
});

test('XCF-ORDINI-UX: quantita scelte → righe di bozza gia risolte (unita ultima fattura, niente invenzioni)', () => {
  const lines = po.poCatalogToDraftLines(CAT('suggest'), { '25618': 2, "zz o'brien": 1 }, H);
  assert.strictEqual(lines.length, 2);
  const b = lines.find(l => l.vendor_sku === '25618');
  assert.deepStrictEqual([b.quantity, b.unit, b.unit_from_history, b.ingredient_id, b.vendor, b.vendor_status, b.match_source, b.needs_review],
    [2, 'case', true, 'ing-b', H, 'resolved', 'ingredient_vendors', false]);
  const o = lines.find(l => l.vendor_sku === null);
  assert.strictEqual(o.needs_review, true, 'senza ingrediente collegato: da verificare, non pronto');
  assert.strictEqual(po.poCatalogToDraftLines(CAT('suggest'), {}, H).length, 0);
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
