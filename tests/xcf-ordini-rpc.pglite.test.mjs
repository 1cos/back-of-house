// XCF-ORDINI — test delle migrazioni 01/02/03 su Postgres locale (PGlite).
// Nessun contatto con la produzione. Ricostruisce lo schema minimo di
// produzione (tabelle esistenti come al 02/10/2026), ruoli Supabase,
// default privileges, poi applica le TRE migrazioni e prova il flusso.
// Uso: NODE_PATH=<node_modules con @electric-sql/pglite> node tests/xcf-ordini-rpc.pglite.test.mjs
import { setup, T } from './helpers-xcf-ordini-pglite.mjs';

let pass = 0, fail = 0;
const check = (c, m, extra) => {
  if (c) { pass++; console.log('  ✓ ' + m); }
  else { fail++; console.log('  ✗ ' + m + (extra !== undefined ? '\n      ' + JSON.stringify(extra) : '')); }
};

const H = "Hardie's Fresh Foods / Dairyland Produce";

async function main() {
  const db = await setup();
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const rpc = async (role, fn, args) => {
    const keys = Object.keys(args);
    const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
    await db.exec(`set role ${role}`);
    try {
      const rows = await q(sql, keys.map(k => (args[k] !== null && typeof args[k] === 'object') ? JSON.stringify(args[k]) : args[k]));
      return rows[0].r;
    } finally { await db.exec('reset role'); }
  };
  const anonTry = async sql => { await db.exec('set role anon'); try { await db.query(sql); return 'ok'; } catch (e) { return e.message; } finally { await db.exec('reset role'); } };

  // Dati di catalogo
  const [ingCream, ingParsley, ingTruffleOil, ingShrimp] = (await q(`insert into public.ingredients(name) values
    ('Heavy Cream'),('Parsley'),('Old Oil'),('Shrimp') returning id`)).map(r => r.id);
  await q(`insert into public.ingredient_vendors(ingredient_id,vendor,vendor_sku,unit_price,purchase_unit,pack_description,last_invoice_date,do_not_order,do_not_order_reason) values
    ($1,$5,'00101',42.5,'case','4/1 GAL',current_date - 3,false,null),
    ($2,$5,'00202',18,'case','60 CT',current_date - 45,false,null),
    ($3,$5,'00303',30,'case','6/1 L',current_date - 2,true,'sostituito'),
    ($4,'Fruge Seafood','SH-1',11,'lb','5 LB',current_date - 1,false,null)`, [ingCream, ingParsley, ingTruffleOil, ingShrimp, H]);
  const tomorrow = (await q(`select (public.po__today() + 1)::text d`))[0].d;

  console.log('\n— autorizzazioni');
  let r = await rpc('anon', 'po_save_draft', { p_token: T.cook, p_payload: { groups: [{ vendor_name: H, lines: [] }] } });
  check(r.ok === false && r.reason === 'FORBIDDEN', 'cuoco non autorizzato a compilare', r);
  r = await rpc('anon', 'po_list', { p_token: 'x'.repeat(64) });
  check(r.ok === false && r.reason === 'AUTH_ERROR', 'token non valido rifiutato', r);

  console.log('\n— bozza con righe da verificare');
  r = await rpc('anon', 'po_save_draft', { p_token: T.tela, p_payload: { groups: [{ vendor_name: H, lines: [
    { requested_text: 'heavy cream', ingredient_id: ingCream, matched_name: 'Heavy Cream', vendor_sku: '00101', quantity: 2, unit: 'case', match_source: 'ingredient_vendors' },
    { requested_text: 'parsley', ingredient_id: ingParsley, matched_name: 'Parsley', vendor_sku: '00202', quantity: null, unit: 'case', match_source: 'ingredient_vendors' },
    { requested_text: 'romaine?', ingredient_id: null, quantity: 1, unit: 'case', needs_review: true, match_source: 'manual' },
    { requested_text: 'old oil', ingredient_id: ingTruffleOil, matched_name: 'Old Oil', vendor_sku: '00303', quantity: 1, unit: 'case', match_source: 'ingredient_vendors' },
  ] }] } });
  check(r.ok === true && r.orders.length === 1 && r.orders[0].status === 'draft', 'bozza salvata (Tela)', r);
  const o1 = r.orders[0].id;
  let lines = await q(`select requested_text, line_status, issues, reference_price, reference_price_date, price_stale, pack_description from public.purchase_order_lines where purchase_order_id=$1 order by position`, [o1]);
  check(lines[0].line_status === 'ok' && Number(lines[0].reference_price) === 42.5 && lines[0].pack_description === '4/1 GAL', 'riga ok con prezzo di riferimento, data e confezione', lines[0]);
  check(lines[1].line_status === 'incomplete' && lines[1].issues.some(i => i.code === 'QTY_MISSING') && lines[1].issues.some(i => i.code === 'PRICE_STALE'), 'quantita mancante = incompleta; prezzo vecchio (45gg) segnalato', lines[1]);
  check(lines[2].line_status === 'ambiguous', 'riga ambigua non e pronta', lines[2]);
  check(lines[3].line_status === 'blocked' && lines[3].issues.some(i => i.code === 'DO_NOT_ORDER'), 'do_not_order bloccato', lines[3]);

  r = await rpc('anon', 'po_mark_ready', { p_token: T.tela, p_order_id: o1, p_expected_revision: 1 });
  check(r.ok === false && r.reason === 'DELIVERY_DATE_MISSING', 'senza data consegna non diventa pronto', r);

  console.log('\n— revisione concorrente e atomicita');
  r = await rpc('anon', 'po_save_draft', { p_token: T.tela, p_payload: { groups: [{ order_id: o1, expected_revision: 99, vendor_name: H, lines: [] }] } });
  check(r.ok === false && r.reason === 'CONFLICT', 'revisione vecchia = CONFLICT', r);
  r = await rpc('anon', 'po_save_draft', { p_token: T.tela, p_payload: { groups: [
    { vendor_name: 'Fruge Seafood', lines: [{ requested_text: 'shrimp', ingredient_id: ingShrimp, quantity: 5, unit: 'lb', match_source: 'ingredient_vendors' }] },
    { order_id: o1, vendor_name: 'Fruge Seafood', lines: [] }] } });
  check(r.ok === false && r.reason === 'VENDOR_MISMATCH', 'secondo gruppo errato...', r);
  check((await q(`select count(*)::int n from public.purchase_orders where vendor_name='Fruge Seafood'`))[0].n === 0, '...e il primo gruppo NON e stato salvato (transazione unica)');
  check((await q(`select count(*)::int n from public.purchase_order_lines where purchase_order_id=$1`, [o1]))[0].n === 4, 'righe dell ordine intatte dopo errore');

  r = await rpc('anon', 'po_save_draft', { p_token: T.tela, p_payload: { groups: [{ order_id: o1, expected_revision: 1, vendor_name: H, delivery_date: tomorrow, lines: [
    { requested_text: 'heavy cream', ingredient_id: ingCream, matched_name: 'Heavy Cream', vendor_sku: '00101', quantity: 2, unit: 'case', match_source: 'ingredient_vendors' },
    { requested_text: 'parsley', ingredient_id: ingParsley, matched_name: 'Parsley', vendor_sku: '00202', quantity: 3, unit: 'case', match_source: 'ingredient_vendors' },
    { requested_text: 'romaine?', ingredient_id: null, quantity: 1, unit: 'case', needs_review: true, match_source: 'manual' },
  ] }] } });
  check(r.ok && r.orders[0].revision === 2 && r.orders[0].blocking_count === 1, 'replace: revisione 2, resta 1 riga ambigua', r);
  r = await rpc('anon', 'po_mark_ready', { p_token: T.tela, p_order_id: o1, p_expected_revision: 2 });
  check(r.ok === false && r.reason === 'LINES_NOT_READY' && Array.isArray(r.detail) && r.detail.length === 1, 'riga ambigua blocca il "pronto"', r);
  check((await q(`select status from public.purchase_orders where id=$1`, [o1]))[0].status === 'draft', 'ordine resta bozza');

  r = await rpc('anon', 'po_save_draft', { p_token: T.tela, p_payload: { groups: [{ order_id: o1, expected_revision: 2, vendor_name: H, delivery_date: tomorrow, notes: 'back door', lines: [
    { requested_text: 'heavy cream', ingredient_id: ingCream, matched_name: 'Heavy Cream', vendor_sku: '00101', quantity: 2, unit: 'case', match_source: 'ingredient_vendors' },
    { requested_text: 'parsley', ingredient_id: ingParsley, matched_name: 'Parsley', vendor_sku: '00202', quantity: 3, unit: 'case', match_source: 'ingredient_vendors' },
  ] }] } });
  r = await rpc('anon', 'po_mark_ready', { p_token: T.tela, p_order_id: o1, p_expected_revision: 3 });
  check(r.ok === true && r.status === 'ready' && /^[0-9a-f]{64}$/.test(r.summary_hash), 'pronto con riepilogo + hash', r);
  const hash1 = r.summary_hash;
  check(r.summary.lines[1].price_stale === true, 'riepilogo riporta prezzo vecchio', r.summary.lines[1]);

  console.log('\n— conferma di Max sull hash esatto');
  r = await rpc('anon', 'po_confirm', { p_token: T.tela, p_order_id: o1, p_summary_hash: hash1 });
  check(r.ok === false && r.reason === 'FORBIDDEN', 'Tela non puo confermare', r);
  r = await rpc('anon', 'po_confirm', { p_token: T.max, p_order_id: o1, p_summary_hash: 'f'.repeat(64) });
  check(r.ok === false && r.reason === 'SUMMARY_CHANGED', 'hash diverso rifiutato', r);
  r = await rpc('anon', 'po_confirm', { p_token: T.max, p_order_id: o1, p_summary_hash: hash1 });
  check(r.ok === true && r.status === 'confirmed', 'Max conferma', r);

  console.log('\n— modifica dopo conferma invalida la conferma');
  r = await rpc('anon', 'po_save_draft', { p_token: T.tela, p_payload: { groups: [{ order_id: o1, expected_revision: 3, vendor_name: H, lines: [
    { requested_text: 'heavy cream', ingredient_id: ingCream, matched_name: 'Heavy Cream', vendor_sku: '00101', quantity: 4, unit: 'case', match_source: 'ingredient_vendors' },
    { requested_text: 'parsley', ingredient_id: ingParsley, matched_name: 'Parsley', vendor_sku: '00202', quantity: 3, unit: 'case', match_source: 'ingredient_vendors' },
  ] }] } });
  const o1row = (await q(`select status, confirmed_hash, revision from public.purchase_orders where id=$1`, [o1]))[0];
  check(r.ok && o1row.status === 'draft' && o1row.confirmed_hash === null && o1row.revision === 4, 'modifica => torna bozza, conferma cancellata', o1row);
  r = await rpc('service_role', 'po_send_begin', { p_token: T.max, p_order_id: o1, p_idempotency_key: 'k-o1-old-hash', p_summary_hash: hash1 });
  check(r.ok === false && r.reason === 'NOT_CONFIRMED', 'invio con vecchia conferma rifiutato', r);
  // riconferma
  r = await rpc('anon', 'po_mark_ready', { p_token: T.tela, p_order_id: o1, p_expected_revision: 4 });
  const hash2 = r.summary_hash;
  check(hash2 !== hash1, 'nuovo hash diverso dal precedente');
  r = await rpc('anon', 'po_confirm', { p_token: T.max, p_order_id: o1, p_summary_hash: hash2 });
  check(r.ok, 'riconfermato');
  // manomissione diretta (scavalcando le RPC) dopo la conferma
  await q(`update public.purchase_order_lines set quantity = 40 where purchase_order_id=$1 and requested_text='heavy cream'`, [o1]);
  r = await rpc('service_role', 'po_send_begin', { p_token: T.max, p_order_id: o1, p_idempotency_key: 'k-o1-tamper', p_summary_hash: hash2 });
  check(r.ok === false && r.reason === 'CONFIRMATION_STALE', 'riga cambiata fuori dalle RPC => conferma non valida', r);
  await q(`update public.purchase_order_lines set quantity = 4 where purchase_order_id=$1 and requested_text='heavy cream'`, [o1]);

  console.log('\n— invio: solo edge (service_role), simulazione');
  const anonSend = await anonTry(`select public.po_send_begin('${T.max}', '${o1}', 'k-anon-123', '${hash2}')`);
  check(/permission denied/.test(anonSend), 'anon non puo chiamare po_send_begin', anonSend);
  r = await rpc('service_role', 'po_send_begin', { p_token: T.tela, p_order_id: o1, p_idempotency_key: 'k-o1-tela', p_summary_hash: hash2 });
  check(r.ok === false && r.reason === 'FORBIDDEN', 'solo admin invia', r);
  r = await rpc('service_role', 'po_send_begin', { p_token: T.max, p_order_id: o1, p_idempotency_key: 'k-o1-sim-1', p_summary_hash: hash2, p_real_requested: true });
  check(r.ok && r.mode === 'simulated' && r.real_allowed_by_db === false, 'richiesta reale => simulata (real_send_enabled=false)', r);
  check(r.payload && /2 case|4 case/.test(r.payload.body) && /SKU 00101/.test(r.payload.body), 'payload con riepilogo leggibile', r.payload);
  const att1 = r.attempt_id;
  r = await rpc('service_role', 'po_send_begin', { p_token: T.max, p_order_id: o1, p_idempotency_key: 'k-o1-sim-2', p_summary_hash: hash2 });
  check(r.ok === false && r.reason === 'IN_FLIGHT', 'secondo tentativo mentre il primo e in corso => IN_FLIGHT', r);
  r = await rpc('service_role', 'po_send_finish', { p_attempt_id: att1, p_outcome: 'simulated', p_result: { simulated: true } });
  check(r.ok && r.order_status === 'confirmed', 'ordine VERO simulato resta "confirmed" (nulla partito)', r);
  const realSent = await q(`select status, send_mode from public.purchase_orders where id=$1`, [o1]);
  check(realSent[0].status === 'confirmed' && realSent[0].send_mode === null, 'nessun send_mode su ordine vero', realSent);
  const bad = await (async () => { try { await q(`update public.purchase_orders set status='sent', send_mode='simulated' where id=$1`, [o1]); return 'ok'; } catch (e) { return e.message; } })();
  check(/purchase_orders_simulated_only_test/.test(bad), 'vincolo DB: "simulated" solo su ordini di prova', bad);

  console.log('\n— ordine di prova: doppio invio e idempotenza');
  r = await rpc('anon', 'po_save_draft', { p_token: T.max, p_payload: { is_test: true, test_run_id: 'run-1', groups: [{ vendor_name: 'Fruge Seafood', delivery_date: tomorrow,
    lines: [{ requested_text: 'shrimp', ingredient_id: ingShrimp, matched_name: 'Shrimp', vendor_sku: 'SH-1', quantity: 5, unit: 'lb', match_source: 'ingredient_vendors' }] }] } });
  const t1 = r.orders[0].id;
  r = await rpc('anon', 'po_mark_ready', { p_token: T.max, p_order_id: t1, p_expected_revision: 1 });
  const th = r.summary_hash;
  await rpc('anon', 'po_confirm', { p_token: T.max, p_order_id: t1, p_summary_hash: th });
  r = await rpc('service_role', 'po_send_begin', { p_token: T.max, p_order_id: t1, p_idempotency_key: 'k-t1-0001', p_summary_hash: th });
  await rpc('service_role', 'po_send_finish', { p_attempt_id: r.attempt_id, p_outcome: 'simulated', p_result: {} });
  let t1row = (await q(`select status, send_mode, send_idempotency_key from public.purchase_orders where id=$1`, [t1]))[0];
  check(t1row.status === 'sent' && t1row.send_mode === 'simulated', 'ordine di prova => sent (simulated)', t1row);
  r = await rpc('service_role', 'po_send_begin', { p_token: T.max, p_order_id: t1, p_idempotency_key: 'k-t1-0001', p_summary_hash: th });
  check(r.ok && r.idempotent === true && r.state === 'simulated', 'stessa idempotency_key => stesso esito, nessun nuovo invio', r);
  r = await rpc('service_role', 'po_send_begin', { p_token: T.max, p_order_id: t1, p_idempotency_key: 'k-t1-0002', p_summary_hash: th });
  check(r.ok === false && r.reason === 'ALREADY_SENT', 'nuova chiave su ordine inviato => ALREADY_SENT', r);
  check((await q(`select count(*)::int n from public.po_send_attempts where purchase_order_id=$1`, [t1]))[0].n === 1, 'un solo tentativo registrato');
  r = await rpc('service_role', 'po_send_begin', { p_token: T.max, p_order_id: o1, p_idempotency_key: 'k-t1-0001', p_summary_hash: hash2 });
  check(r.ok === false && r.reason === 'IDEMPOTENCY_KEY_REUSED', 'chiave di un altro ordine rifiutata', r);

  console.log('\n— protezione doppioni (ordini, invii manuali, conferme email)');
  r = await rpc('anon', 'po_save_draft', { p_token: T.max, p_payload: { is_test: true, test_run_id: 'run-1', groups: [{ vendor_name: 'Fruge Seafood', delivery_date: tomorrow,
    lines: [{ requested_text: 'shrimp', ingredient_id: ingShrimp, vendor_sku: 'SH-1', quantity: 2, unit: 'lb', match_source: 'ingredient_vendors' }] }] } });
  const t2 = r.orders[0].id;
  check(t2 !== t1, 'ordine inviato non viene riusato come bozza');
  r = await rpc('anon', 'po_mark_ready', { p_token: T.max, p_order_id: t2, p_expected_revision: 1 });
  check(r.duplicates.items.some(d => d.kind === 'purchase_order' && d.id === t1), 'riepilogo segnala ordine gia inviato allo stesso fornitore', r.duplicates);
  const th2 = r.summary_hash;
  await rpc('anon', 'po_confirm', { p_token: T.max, p_order_id: t2, p_summary_hash: th2 });
  r = await rpc('service_role', 'po_send_begin', { p_token: T.max, p_order_id: t2, p_idempotency_key: 'k-t2-0001', p_summary_hash: th2 });
  check(r.ok === false && r.reason === 'DUPLICATE_SUSPECTED', 'invio bloccato: sospetto doppione', r);
  r = await rpc('anon', 'po_register_manual_send', { p_token: T.tela, p_order_id: t2, p_idempotency_key: 'k-t2-man1', p_summary_hash: th2, p_channel: 'phone', p_ack_duplicates: true });
  check(r.ok === false && r.reason === 'FORBIDDEN', 'solo admin puo forzare un sospetto doppione', r);
  r = await rpc('service_role', 'po_send_begin', { p_token: T.max, p_order_id: t2, p_idempotency_key: 'k-t2-0001', p_summary_hash: th2, p_ack_duplicates: true });
  check(r.ok && r.mode === 'simulated', 'Max forza consapevolmente (registrato nello storico)', r);
  await rpc('service_role', 'po_send_finish', { p_attempt_id: r.attempt_id, p_outcome: 'failed', p_result: { error: 'test' } });
  check((await q(`select status from public.purchase_orders where id=$1`, [t2]))[0].status === 'confirmed', 'esito failed: ordine resta confermato');

  // invio esterno (fatto fuori da Brigade) + conferma email per Hardie's (ordine vero o1)
  r = await rpc('anon', 'po_register_external_send', { p_token: T.tela, p_vendor: H, p_channel: 'email', p_note: 'Max via email' });
  check(r.ok, 'registrato invio manuale fatto fuori da Brigade');
  const vd = (await q(`insert into public.vendor_documents(vendor,document_type,document_number,parsed_json,source_email_subject) values
    ($1,'order_confirmation','07150000',$2,'CONFIRMATION OF SALE - #07150000') returning id`,
    [H, JSON.stringify({ items: [{ vendor_sku: '00101', qty_ordered: 4, description: 'CREAM' }, { vendor_sku: '00202', qty_ordered: 2, description: 'PARSLEY' }] })]))[0].id;
  r = await rpc('service_role', 'po_send_begin', { p_token: T.max, p_order_id: o1, p_idempotency_key: 'k-o1-sim-3', p_summary_hash: hash2 });
  check(r.ok === false && r.reason === 'DUPLICATE_SUSPECTED' && r.detail.items.some(d => d.kind === 'manual_send') && r.detail.items.some(d => d.kind === 'vendor_confirmation'),
    'conferma email recente + invio manuale esterno => sospetto doppione', r);

  console.log('\n— invio manuale, conferma fornitore, ricevimento');
  r = await rpc('anon', 'po_register_manual_send', { p_token: T.tela, p_order_id: o1, p_idempotency_key: 'k-o1-man1', p_summary_hash: hash2, p_channel: 'portal', p_vendor_order_number: '7150000' });
  check(r.ok === false && r.reason === 'DUPLICATE_SUSPECTED', 'anche l invio manuale rispetta la protezione doppioni', r);
  r = await rpc('anon', 'po_register_manual_send', { p_token: T.max, p_order_id: o1, p_idempotency_key: 'k-o1-man1', p_summary_hash: hash2, p_channel: 'portal', p_vendor_order_number: '7150000', p_ack_duplicates: true });
  check(r.ok && r.status === 'sent_manual', 'invio manuale registrato => sent_manual', r);
  r = await rpc('anon', 'po_register_manual_send', { p_token: T.max, p_order_id: o1, p_idempotency_key: 'k-o1-man1', p_summary_hash: hash2, p_channel: 'portal' });
  check(r.ok && r.idempotent === true, 'registrazione manuale ripetuta = idempotente', r);
  r = await rpc('anon', 'po_confirmation_candidates', { p_token: T.tela, p_order_id: o1 });
  check(r.ok && r.candidates[0] && r.candidates[0].vendor_document_id === vd && r.candidates[0].number_match === true, 'conferma Hardie trovata per numero ordine', r);
  r = await rpc('anon', 'po_link_confirmation', { p_token: T.tela, p_order_id: o1, p_vendor_document_id: vd });
  check(r.ok && r.status === 'acknowledged' && r.differences.length === 1 && r.differences[0].vendor_sku === '00202', 'collegata; differenza quantita segnalata (parsley 3 vs 2)', r);
  r = await rpc('anon', 'po_link_confirmation', { p_token: T.tela, p_order_id: t1, p_vendor_document_id: vd });
  check(r.ok === false, 'stessa conferma non collegabile a un secondo ordine', r);

  const l1 = await q(`select id, requested_text from public.purchase_order_lines where purchase_order_id=$1 order by position`, [o1]);
  r = await rpc('anon', 'po_receive', { p_token: T.tela, p_order_id: o1, p_lines: [{ line_id: l1[0].id, status: 'received' }] });
  check(r.ok === false && r.reason === 'RECEIPT_INCOMPLETE', 'check-in incompleto rifiutato', r);
  check((await q(`select count(*)::int n from public.purchase_order_lines where purchase_order_id=$1 and received_status is not null`, [o1]))[0].n === 0, 'nessuna riga segnata dopo il rifiuto');
  r = await rpc('anon', 'po_receive', { p_token: T.tela, p_order_id: o1, p_lines: [
    { line_id: l1[0].id, status: 'damaged', received_qty: 4, note: '1 case leaking', photo_url: 'https://example.invalid/p.jpg' },
    { line_id: l1[1].id, status: 'missing' }] });
  check(r.ok && r.status === 'received' && r.anomalies.length === 2 && r.complaint_draft_id, 'ricevuto con anomalie => bozza reclamo', r);
  const cd = (await q(`select status, body from public.po_complaint_drafts where id=$1`, [r.complaint_draft_id]))[0];
  check(cd.status === 'draft' && /missing/.test(cd.body) && /#07150000/.test(cd.body), 'bozza reclamo NON inviata, testo pronto', cd);

  console.log('\n— do_not_order cambiato dopo la conferma');
  r = await rpc('anon', 'po_save_draft', { p_token: T.max, p_payload: { is_test: true, test_run_id: 'run-1', groups: [{ vendor_name: H, delivery_date: tomorrow,
    lines: [{ requested_text: 'heavy cream', ingredient_id: ingCream, vendor_sku: '00101', quantity: 1, unit: 'case', match_source: 'ingredient_vendors' }] }] } });
  const t3 = r.orders[0].id;
  r = await rpc('anon', 'po_mark_ready', { p_token: T.max, p_order_id: t3, p_expected_revision: 1 });
  const th3 = r.summary_hash;
  await rpc('anon', 'po_confirm', { p_token: T.max, p_order_id: t3, p_summary_hash: th3 });
  await q(`update public.ingredient_vendors set do_not_order=true where ingredient_id=$1`, [ingCream]);
  r = await rpc('service_role', 'po_send_begin', { p_token: T.max, p_order_id: t3, p_idempotency_key: 'k-t3-0001', p_summary_hash: th3, p_ack_duplicates: true });
  check(r.ok === false && r.reason === 'DO_NOT_ORDER', 'prodotto diventato do_not_order => invio bloccato', r);

  console.log('\n— do_not_order per SKU (vecchia mappatura superata)');
  const [ingAlm] = (await q(`insert into public.ingredients(name) values ('Sliced Almonds') returning id`)).map(r => r.id);
  await q(`insert into public.ingredient_vendors(ingredient_id,vendor,vendor_sku,unit_price,active,do_not_order,do_not_order_reason,last_invoice_date) values
    ($1,$2,'02138',50,false,true,'SKU superato',current_date-10)`, [ingAlm, H]);
  r = await rpc('anon', 'po_save_draft', { p_token: T.max, p_payload: { is_test: true, groups: [{ vendor_name: H, delivery_date: tomorrow,
    lines: [{ requested_text: 'almonds', ingredient_id: ingAlm, quantity: 1, unit: 'case' }] }] } });
  let alm = (await q(`select line_status from public.purchase_order_lines l join public.purchase_orders o on o.id=l.purchase_order_id where l.ingredient_id=$1 order by l.created_at desc limit 1`, [ingAlm]))[0];
  check(alm.line_status === 'blocked', 'unica mappatura = do_not_order => bloccata', alm);
  await q(`insert into public.ingredient_vendors(ingredient_id,vendor,vendor_sku,unit_price,active,do_not_order,last_invoice_date) values ($1,$2,'25035',55,true,false,current_date-5)`, [ingAlm, H]);
  r = await rpc('anon', 'po_save_draft', { p_token: T.max, p_payload: { is_test: true, groups: [{ vendor_name: H, delivery_date: tomorrow,
    lines: [{ requested_text: 'almonds new', ingredient_id: ingAlm, vendor_sku: '25035', quantity: 1, unit: 'case' },
            { requested_text: 'almonds old', ingredient_id: ingAlm, vendor_sku: '02138', quantity: 1, unit: 'case' }] }] } });
  const almRows = await q(`select requested_text, line_status, reference_price from public.purchase_order_lines where ingredient_id=$1 and requested_text like 'almonds %' order by requested_text`, [ingAlm]);
  check(almRows[0].line_status === 'ok' && Number(almRows[0].reference_price) === 55, 'SKU corretto ordinabile, prezzo dalla riga attiva', almRows[0]);
  check(almRows[1].line_status === 'blocked', 'SKU superato bloccato', almRows[1]);

  console.log('\n— annullamento');
  r = await rpc('anon', 'po_cancel', { p_token: T.tela, p_order_id: t3, p_reason: '' });
  check(r.ok === false && r.reason === 'FORBIDDEN', 'Tela non annulla un ordine confermato', r);
  r = await rpc('anon', 'po_cancel', { p_token: T.max, p_order_id: t3, p_reason: 'test' });
  check(r.ok && r.status === 'cancelled', 'Max annulla con motivo', r);

  console.log('\n— RLS / accesso diretto');
  check(/permission denied/.test(await anonTry(`select * from public.purchase_orders`)), 'anon non legge purchase_orders direttamente');
  check(/permission denied/.test(await anonTry(`insert into public.purchase_orders(vendor_name) values ('x')`)), 'anon non scrive purchase_orders');
  check(/permission denied/.test(await anonTry(`delete from public.purchase_order_lines`)), 'anon non cancella righe');
  check(/permission denied/.test(await anonTry(`select * from public.po_settings`)), 'anon non legge po_settings');
  check(/permission denied/.test(await anonTry(`update public.po_settings set value='true' where key='real_send_enabled'`)), 'anon non abilita invio reale');
  check(/permission denied/.test(await anonTry(`select public.po__summary('${o1}')`)), 'helper interni non eseguibili da anon');
  r = await rpc('anon', 'po_list', { p_token: T.anto });
  check(r.ok && r.orders.every(o => !o.is_test), 'Anto legge la lista via RPC (senza ordini di prova)', r.ok);
  r = await rpc('anon', 'po_home_counts', { p_token: T.tela });
  check(r.ok && typeof r.awaiting_confirmation === 'number', 'contatori home via RPC', r);
  r = await rpc('anon', 'po_get', { p_token: T.tela, p_order_id: o1 });
  check(r.ok && r.order.events.length >= 8 && r.order.lines.length === 2, 'dettaglio con storico eventi', r.ok && r.order.events.map(e => e.event));

  console.log('\n— rollback');
  const fsm = await import('fs'); const pth = await import('path'); const url = await import('url');
  const RB = f => fsm.readFileSync(pth.join(pth.dirname(url.fileURLToPath(import.meta.url)), '..', 'migrations', 'rollback', f), 'utf8');
  await db.exec(RB('20261002_xcf_ordini_03_rls_rollback.sql'));
  check((await q(`select relrowsecurity from pg_class where relname='purchase_orders'`))[0].relrowsecurity === false, 'rollback 03: RLS disattivata');
  check(await anonTry(`select count(*) from public.purchase_orders`) === 'ok', 'rollback 03: anon legge di nuovo come prima');
  await db.exec(RB('20261002_xcf_ordini_rollback.sql'));
  check((await q(`select count(*)::int n from pg_proc where proname in ('po_list','po_send_begin','po__auth','po_receive')`))[0].n === 0, 'rollback 01/02: funzioni rimosse');
  check((await q(`select count(*)::int n from information_schema.columns where table_name='purchase_orders'`))[0].n === 7, 'rollback 01/02: purchase_orders con le 7 colonne originali');
  check((await q(`select count(*)::int n from pg_class where relname in ('po_settings','po_events','po_send_attempts','po_manual_sends','po_vendor_channels','po_complaint_drafts')`))[0].n === 0, 'rollback 01/02: tabelle po_* rimosse');

  console.log(`\n${pass} ok, ${fail} falliti`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
