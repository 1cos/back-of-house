// XCF-ORDINI — end-to-end client + database (simulazione, nessuna rete).
// Esegue il VERO js/purchase-order.js con un client Supabase finto che
// inoltra .rpc() a PGlite (migrazioni 01/02/03 applicate, ruolo anon).
// La chiamata all'edge function e' emulata con le stesse due RPC che la
// funzione reale usa (po_send_begin / po_send_finish come service_role);
// la funzione deployata e' verificata a parte in produzione.
// Uso: NODE_PATH=<node_modules con @electric-sql/pglite> node tests/xcf-ordini-e2e.pglite.test.mjs
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { setup, T } from './helpers-xcf-ordini-pglite.mjs';
const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const check = (c, m, extra) => {
  if (c) { pass++; console.log('  ✓ ' + m); }
  else { fail++; console.log('  ✗ ' + m + (extra !== undefined ? '\n      ' + JSON.stringify(extra).slice(0, 600) : '')); }
};
const H = "Hardie's Fresh Foods / Dairyland Produce";

const db = await setup();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
// Ogni RPC gira nella sua transazione con SET LOCAL ROLE: le chiamate
// "fire and forget" del client non possono lasciare il ruolo cambiato.
async function callRpc(role, fn, args) {
  const keys = Object.keys(args);
  const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
  try {
    return await db.transaction(async tx => {
      await tx.exec(`set local role ${role}`);
      const res = await tx.query(sql, keys.map(k => (args[k] !== null && typeof args[k] === 'object') ? JSON.stringify(args[k]) : args[k]));
      return { data: res.rows[0].r, error: null };
    });
  } catch (e) { return { data: null, error: { message: e.message } }; }
}

// ── ambiente browser minimo ─────────────────────────────────────────
const toasts = [];
const els = {};
const el = id => (els[id] = els[id] || { id, value: '', checked: false, innerHTML: '', style: {}, disabled: false, textContent: '' });
let currentToken = T.tela;
let sendCalls = 0;
Object.assign(globalThis, {
  window: globalThis,
  document: { getElementById: el, querySelectorAll: () => [] },
  localStorage: { getItem: k => (k === 'brigade_token' ? currentToken : null), setItem() {}, removeItem() {} },
  showScToast: m => toasts.push(m),
  showSection: () => {},
  confirm: () => true, prompt: () => 'test', alert: () => {},
  SUPABASE_URL: 'https://fake.local', SUPABASE_ANON_KEY: 'anon',
  supabaseClient: {
    rpc: (fn, args) => callRpc('anon', fn, args),
    from: () => ({ insert: async () => ({ error: null }) }) // vendor_item_aliases (apprendimento alias)
  },
  fetch: async (url, opts) => {
    // Emulazione fedele dell'edge send-purchase-order (modalita' simulazione).
    if (!String(url).endsWith('/functions/v1/send-purchase-order')) throw new Error('unexpected fetch ' + url);
    sendCalls++;
    const b = JSON.parse(opts.body);
    const begin = (await callRpc('service_role', 'po_send_begin', { p_token: b.brigade_token, p_order_id: b.order_id,
      p_idempotency_key: b.idempotency_key, p_summary_hash: b.summary_hash, p_ack_duplicates: !!b.ack_duplicates, p_real_requested: false })).data;
    if (!begin.ok) return { json: async () => begin };
    if (begin.idempotent) return { json: async () => ({ ...begin, transmitted: false }) };
    const fin = (await callRpc('service_role', 'po_send_finish', { p_attempt_id: begin.attempt_id, p_outcome: 'simulated', p_result: { simulated: true } })).data;
    return { json: async () => ({ ok: true, simulated: true, transmitted: false, order_status: fin.order_status }) };
  }
});
const po = require(path.join(HERE, '..', 'js', 'purchase-order.js'));
const lastToast = () => toasts[toasts.length - 1] || '';
const asUser = (tok, user) => { currentToken = tok; globalThis.user = user; };
const TELA = { id: 3, name: 'Tela', role: 'staff' }, MAX = { id: 1, name: 'Max', role: 'admin', is_admin: true };

// Catalogo (per il matching lato client) e catalogo prezzi lato DB
const [ingCream, ingParsley, ingOld] = (await q(`insert into public.ingredients(name) values ('Heavy Cream'),('Parsley'),('Old Oil') returning id`)).map(r => r.id);
await q(`insert into public.ingredient_vendors(ingredient_id,vendor,vendor_sku,unit_price,purchase_unit,pack_description,last_invoice_date,do_not_order) values
  ($1,$4,'00101',42.5,'case','4/1 GAL',current_date - 3,false),
  ($2,$4,'00202',18,'case','60 CT',current_date - 40,false),
  ($3,$4,'00303',30,'case','6/1 L',current_date - 2,true)`, [ingCream, ingParsley, ingOld, H]);
po.poSetCatalogsForTest([], [
  { id: 1, vendor: H, vendor_sku: '00101', ingredient_id: ingCream, name: 'Heavy Cream' },
  { id: 2, vendor: H, vendor_sku: '00202', ingredient_id: ingParsley, name: 'Parsley' },
  { id: 3, vendor: H, vendor_sku: '00303', ingredient_id: ingOld, name: 'Old Oil' }
], [{ vendor: H, ingredient_id: ingCream, ingredient_name: 'Heavy Cream', confirmed: true }], {}, [{ vendor: H, ingredient_id: ingCream }]);
const tomorrow = (await q(`select (public.po__today() + 1)::text d`))[0].d;

function linesFromText(text) {
  return text.split('\n').map(raw => {
    const p = po.poParseLine(raw); const m = po.poMatchItem(p.requested_text);
    return { requested_text: p.requested_text, quantity: p.quantity, unit: p.unit,
      ingredient_id: m.matched ? m.ingredient_id : null, matched_name: m.matched ? m.matched_name : null,
      vendor_sku: m.matched ? m.vendor_sku : null, match_confidence: m.matched ? m.confidence : null,
      match_source: m.matched ? m.source : 'manual', needs_review: !!m.needsReview, candidates: m.candidates || [],
      vendor: m.vendor || null, vendor_status: m.vendorStatus || 'unresolved', vendor_candidates: m.vendorCandidates || [] };
  });
}
const order = async id => (await q(`select * from public.purchase_orders where id=$1`, [id]))[0];

console.log('\n— richiesta scritta → bozza (Tela)');
asUser(T.tela, TELA);
po.poSetDraftLinesForTest(linesFromText('heavy cream 2 case\nparsley'));
await window.poSaveDraft();
const oid = (await q(`select id from public.purchase_orders`))[0].id;
check(/Bozza salvata/.test(lastToast()) && /1 riga da sistemare/.test(lastToast()), 'bozza salvata, quantita mancante segnalata', toasts);
check((await order(oid)).status === 'draft', 'stato draft');
check(sendCalls === 0, 'nessun invio da richiesta scritta');

console.log('\n— righe verificate → pronto');
await window.poOpenOrder(oid);
await window.poMarkReady();
check(/data di consegna/i.test(lastToast()), 'senza data consegna: rifiutato', lastToast());
window.poEditOrderLines();
window.poLineSetQty(1, '3'); window.poLineSetUnit(1, 'case'); window.poSetDeliveryDate(tomorrow);
await window.poSaveDraft();
check((await order(oid)).delivery_date !== null, 'data consegna salvata');
await window.poMarkReady();
let o = await order(oid);
check(o.status === 'ready' && o.summary_hash, 'pronto con hash', o.status);

console.log('\n— conferma Max, modifica dopo conferma');
asUser(T.max, MAX);
await window.poOpenOrder(oid);
await window.poConfirmOrder();
check((await order(oid)).status === 'confirmed', 'Max conferma dalla UI');
asUser(T.tela, TELA);
await window.poOpenOrder(oid);
window.poEditOrderLines();
window.poLineSetQty(0, '5');
await window.poSaveDraft();
o = await order(oid);
check(o.status === 'ready' && o.confirmed_hash === null && /annullati/.test(toasts.join(' ')) && /Riepilogo pronto/.test(toasts.join(' ')), 'modifica dopo conferma => conferma annullata, nuovo riepilogo subito pronto (XCF-ORDINI-UX)', o.status);
await window.poMarkReady();
asUser(T.max, MAX);
await window.poOpenOrder(oid);
await window.poConfirmOrder();

console.log('\n— invio simulato (ordine vero) e invio manuale');
await window.poOpenOrder(oid);
await window.poSendSimulated();
check(/SIMULAZIONE registrata/.test(lastToast()) && (await order(oid)).status === 'confirmed', 'simulazione: ordine vero resta confermato, nulla parte', lastToast());
asUser(T.tela, TELA);
await window.poOpenOrder(oid);
el('poManualChannel').value = 'portal'; el('poManualNumber').value = '07160001';
await window.poRegisterManualSend();
check((await order(oid)).status === 'sent_manual', 'invio manuale registrato da Tela');
asUser(T.max, MAX);
await window.poOpenOrder(oid);
await window.poSendSimulated();
check(/già inviato/.test(lastToast()), 'tentativo di secondo invio bloccato (ALREADY_SENT)', lastToast());

console.log('\n— risposta fornitore → ricevimento');
const vd = (await q(`insert into public.vendor_documents(vendor,document_type,document_number,parsed_json) values ($1,'order_confirmation','07160001',$2) returning id`,
  [H, JSON.stringify({ items: [{ vendor_sku: '00101', qty_ordered: 5 }, { vendor_sku: '00202', qty_ordered: 3 }] })]))[0].id;
asUser(T.tela, TELA);
await window.poOpenOrder(oid);
await window.poLoadCandidates();
check(/numero corrisponde/.test(po.poRenderOrder()), 'conferma trovata per numero ordine');
await window.poLinkConfirmation(vd);
check((await order(oid)).status === 'acknowledged', 'collegata: acknowledged');
window.poStartReceive();
const lines = await q(`select id from public.purchase_order_lines where purchase_order_id=$1 order by position`, [oid]);
window.poRecvSet(lines[1].id, 'status', 'missing');
await window.poSubmitReceive();
o = await order(oid);
const cd = await q(`select status from public.po_complaint_drafts where purchase_order_id=$1`, [oid]);
check(o.status === 'received' && cd.length === 1 && cd[0].status === 'draft' && /NON inviata/.test(lastToast()), 'ricevuto; bozza reclamo non inviata', lastToast());

console.log('\n— do_not_order bloccato');
po.poSetDraftLinesForTest(linesFromText('old oil 1 case'));
window.poSetDeliveryDate(tomorrow);
await window.poSaveDraft();
const o2 = (await q(`select id from public.purchase_orders where id <> $1`, [oid]))[0].id;
await window.poOpenOrder(o2);
check(/non ordinare/.test(po.poRenderOrder()), 'riga "non ordinare" mostrata come bloccante');
await window.poMarkReady();
check((await order(o2)).status === 'draft' && /righe da sistemare/.test(lastToast()), 'non diventa pronto', lastToast());

console.log(`\n${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
