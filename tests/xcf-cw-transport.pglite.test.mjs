// XCF-CW 01 — coda dell'invio reale Chef's Warehouse per il worker (PGlite, nessuna rete).
// Uso: NODE_PATH=<node_modules con @electric-sql/pglite> node tests/xcf-cw-transport.pglite.test.mjs
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { setup, T } from './helpers-xcf-ordini-pglite.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const check = (c, m, extra) => {
  if (c) { pass++; console.log('  ✓ ' + m); }
  else { fail++; console.log('  ✗ ' + m + (extra !== undefined ? '\n      ' + JSON.stringify(extra).slice(0, 600) : '')); }
};
const H = "Hardie's Fresh Foods / Dairyland Produce";
const WTOKEN = 'w'.repeat(48);
const WHASH = crypto.createHash('sha256').update(WTOKEN).digest('hex');

const db = await setup();
await db.exec(fs.readFileSync(path.join(HERE, '..', 'migrations', '20261003_xcf_cw_01_transport.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(HERE, '..', 'migrations', '20261003_xcf_cw_02_inflight_guard.sql'), 'utf8'));
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

const [ingBurrata, ingCream] = (await q(`insert into public.ingredients(name) values ('Burrata'),('Heavy Cream') returning id`)).map(r => r.id);
await q(`insert into public.ingredient_vendors(ingredient_id,vendor,vendor_sku,unit_price,purchase_unit,pack_description,last_invoice_date) values
  ($1,$3,'25618',24.51,'case','6 x 4-2oz',current_date - 1),($2,$3,'00101',42.5,'case','4/1 GAL',current_date - 2)`, [ingBurrata, ingCream, H]);
const tomorrow = (await q(`select (public.po__today() + 1)::text d`))[0].d;

async function confirmedOrder(tag, lines) {
  let r = await rpc('anon', 'po_save_draft', { p_token: T.tela, p_payload: { groups: [{ vendor_name: H, delivery_date: tomorrow, lines }] } });
  const id = r.orders[0].id;
  r = await rpc('anon', 'po_mark_ready', { p_token: T.tela, p_order_id: id, p_expected_revision: 1 });
  if (!r.ok) throw new Error(tag + ' mark_ready ' + JSON.stringify(r));
  const hash = r.summary_hash;
  r = await rpc('anon', 'po_confirm', { p_token: T.max, p_order_id: id, p_summary_hash: hash });
  if (!r.ok) throw new Error(tag + ' confirm ' + JSON.stringify(r));
  return { id, hash };
}
const L1 = [{ requested_text: 'burrata', ingredient_id: ingBurrata, matched_name: 'Burrata', vendor_sku: '25618', quantity: 1, unit: 'case', match_source: 'ingredient_vendors' }];

console.log('\n— stato iniziale: invio reale CW spento');
const o1 = await confirmedOrder('o1', L1);
let r = await rpc('service_role', 'po_send_begin', { p_token: T.max, p_order_id: o1.id, p_idempotency_key: 'k-o1-real-0', p_summary_hash: o1.hash, p_real_requested: true });
check(r.ok && r.mode === 'simulated' && r.real_allowed_by_db === false, 'senza canale cw_portal e interruttori: resta simulazione', r);
await rpc('service_role', 'po_send_finish', { p_attempt_id: r.attempt_id, p_outcome: 'simulated', p_result: {} });

console.log('\n— interruttori accesi (come farebbe Max)');
await q(`update public.po_vendor_channels set channel='portal', transport='cw_portal', real_send_allowed=true where vendor_name=$1`, [H]);
await q(`update public.po_settings set value='true'::jsonb where key='real_send_enabled'`);
r = await rpc('service_role', 'po_send_begin', { p_token: T.max, p_order_id: o1.id, p_idempotency_key: 'k-o1-sim-1', p_summary_hash: o1.hash });
check(r.ok && r.mode === 'simulated', 'senza richiesta esplicita di invio reale: simulazione', r);
await rpc('service_role', 'po_send_finish', { p_attempt_id: r.attempt_id, p_outcome: 'simulated', p_result: {} });
r = await rpc('service_role', 'po_send_begin', { p_token: T.max, p_order_id: o1.id, p_idempotency_key: 'k-o1-real-1', p_summary_hash: o1.hash, p_real_requested: true });
check(r.ok && r.mode === 'real' && r.payload.transport === 'cw_portal', 'reale richiesto + interruttori: invio reale in coda', r);
check(r.payload.lines.length === 1 && r.payload.lines[0].vendor_sku === '25618' && Number(r.payload.lines[0].quantity) === 1
      && r.payload.lines[0].unit === 'case' && r.payload.delivery_date === tomorrow, 'payload con righe strutturate e data di consegna', r.payload);
const a1 = r.attempt_id;
r = await rpc('service_role', 'po_send_begin', { p_token: T.max, p_order_id: o1.id, p_idempotency_key: 'k-o1-real-2', p_summary_hash: o1.hash, p_real_requested: true });
check(r.ok === false && r.reason === 'IN_FLIGHT', 'secondo invio mentre il primo e in coda: rifiutato', r);

console.log('\n— token del worker');
r = await rpc('anon', 'po_worker_claim', { p_worker_token: WTOKEN, p_worker_id: 'mini' });
check(r.ok === false && r.reason === 'AUTH_ERROR', 'nessun hash configurato: worker rifiutato', r);
await q(`update public.po_settings set value=to_jsonb($1::text) where key='cw_worker_token_sha256'`, [WHASH]);
r = await rpc('anon', 'po_worker_claim', { p_worker_token: 'x'.repeat(48), p_worker_id: 'mini' });
check(r.ok === false && r.reason === 'AUTH_ERROR', 'token sbagliato rifiutato', r);

console.log('\n— claim una sola volta');
r = await rpc('anon', 'po_worker_claim', { p_worker_token: WTOKEN, p_worker_id: 'mini' });
check(r.ok && r.job && r.job.attempt_id === a1 && r.job.summary_hash === o1.hash && r.job.payload.lines[0].vendor_sku === '25618', 'il worker prende il job giusto', r);
r = await rpc('anon', 'po_worker_claim', { p_worker_token: WTOKEN, p_worker_id: 'mini' });
check(r.ok && r.job === null, 'job gia preso: non viene ridato', r);

console.log('\n— esito');
r = await rpc('anon', 'po_worker_finish', { p_worker_token: WTOKEN, p_attempt_id: a1, p_outcome: 'sent', p_result: { transmitted: true } });
check(r.ok === false && r.reason === 'INVALID_INPUT', 'sent senza numero ordine CW: rifiutato', r);
r = await rpc('anon', 'po_worker_finish', { p_worker_token: WTOKEN, p_attempt_id: a1, p_outcome: 'sent', p_result: { transmitted: true }, p_vendor_order_number: 'TCW9995165226' });
check(r.ok && r.order_status === 'sent', 'sent con numero ordine', r);
let row = (await q(`select status, send_mode, vendor_order_number, channel from public.purchase_orders where id=$1`, [o1.id]))[0];
check(row.status === 'sent' && row.send_mode === 'real' && row.vendor_order_number === 'TCW9995165226' && row.channel === 'portal', 'ordine: inviato, reale, numero CW salvato', row);
r = await rpc('anon', 'po_worker_finish', { p_worker_token: WTOKEN, p_attempt_id: a1, p_outcome: 'sent', p_result: {}, p_vendor_order_number: 'X' });
check(r.ok && r.idempotent === true, 'secondo esito sullo stesso invio: idempotente', r);
r = await rpc('service_role', 'po_send_begin', { p_token: T.max, p_order_id: o1.id, p_idempotency_key: 'k-o1-real-3', p_summary_hash: o1.hash, p_real_requested: true });
check(r.ok === false && r.reason === 'ALREADY_SENT', 'ordine gia inviato: nessun nuovo invio', r);

console.log('\n— esito incerto blocca');
const o2 = await confirmedOrder('o2', [{ requested_text: 'cream', ingredient_id: ingCream, matched_name: 'Heavy Cream', vendor_sku: '00101', quantity: 2, unit: 'case', match_source: 'ingredient_vendors' }]);
r = await rpc('service_role', 'po_send_begin', { p_token: T.max, p_order_id: o2.id, p_idempotency_key: 'k-o2-real-1', p_summary_hash: o2.hash, p_real_requested: true, p_ack_duplicates: true });
check(r.ok && r.mode === 'real', 'o2 in coda (doppione confermato da Max)', r);
const a2 = r.attempt_id;
r = await rpc('anon', 'po_worker_finish', { p_worker_token: WTOKEN, p_attempt_id: a2, p_outcome: 'failed', p_result: {} });
check(r.ok === false && r.reason === 'INVALID_STATE', 'esito senza claim: rifiutato', r);
await rpc('anon', 'po_worker_claim', { p_worker_token: WTOKEN, p_worker_id: 'mini' });
r = await rpc('anon', 'po_worker_finish', { p_worker_token: WTOKEN, p_attempt_id: a2, p_outcome: 'uncertain', p_result: { error: 'SUBMIT_TIMEOUT' } });
check(r.ok && r.uncertain === true, 'incerto registrato', r);
row = (await q(`select state, result from public.po_send_attempts where id=$1`, [a2]))[0];
check(row.state === 'pending' && row.result.uncertain === true, 'tentativo resta pending con nota incerta', row);
r = await rpc('service_role', 'po_send_begin', { p_token: T.max, p_order_id: o2.id, p_idempotency_key: 'k-o2-real-2', p_summary_hash: o2.hash, p_real_requested: true, p_ack_duplicates: true });
check(r.ok === false && r.reason === 'IN_FLIGHT', 'dopo un incerto nessun nuovo invio automatico', r);
r = await rpc('anon', 'po_worker_claim', { p_worker_token: WTOKEN, p_worker_id: 'mini' });
check(r.ok && r.job === null, 'l incerto non viene ripreso dal worker', r);

console.log('\n— ricontrolli al claim');
const o3 = await confirmedOrder('o3', L1);
r = await rpc('service_role', 'po_send_begin', { p_token: T.max, p_order_id: o3.id, p_idempotency_key: 'k-o3-real-1', p_summary_hash: o3.hash, p_real_requested: true, p_ack_duplicates: true });
const a3 = r.attempt_id;
await q(`update public.purchase_order_lines set quantity = 5 where purchase_order_id=$1`, [o3.id]); // modifica dopo la conferma
r = await rpc('anon', 'po_worker_claim', { p_worker_token: WTOKEN, p_worker_id: 'mini' });
check(r.ok && r.job === null, 'riepilogo cambiato dopo la conferma: il worker non riceve nulla', r);
row = (await q(`select state, result from public.po_send_attempts where id=$1`, [a3]))[0];
check(row.state === 'failed' && row.result.error === 'CONFIRMATION_STALE' && row.result.transmitted === false, 'chiuso come CONFIRMATION_STALE, nulla trasmesso', row);

const o4 = await confirmedOrder('o4', [{ requested_text: 'cream', ingredient_id: ingCream, matched_name: 'Heavy Cream', vendor_sku: '00101', quantity: 1, unit: 'case', match_source: 'ingredient_vendors' }]);
r = await rpc('service_role', 'po_send_begin', { p_token: T.max, p_order_id: o4.id, p_idempotency_key: 'k-o4-real-1', p_summary_hash: o4.hash, p_real_requested: true, p_ack_duplicates: true });
const a4 = r.attempt_id;
await q(`update public.po_send_attempts set created_at = now() - interval '1 hour' where id=$1`, [a4]);
r = await rpc('anon', 'po_worker_claim', { p_worker_token: WTOKEN, p_worker_id: 'mini' });
check(r.ok && r.job === null, 'invio vecchio in coda non parte', r);
row = (await q(`select state, result from public.po_send_attempts where id=$1`, [a4]))[0];
check(row.state === 'failed' && row.result.error === 'QUEUE_EXPIRED', 'chiuso come QUEUE_EXPIRED', row);

console.log('\n— niente modifica/annullo durante un invio reale (XCF-CW 02)');
const o5 = await confirmedOrder('o5', L1);
r = await rpc('service_role', 'po_send_begin', { p_token: T.max, p_order_id: o5.id, p_idempotency_key: 'k-o5-real-1', p_summary_hash: o5.hash, p_real_requested: true, p_ack_duplicates: true });
const a5 = r.attempt_id;
r = await rpc('anon', 'po_save_draft', { p_token: T.tela, p_payload: { groups: [{ order_id: o5.id, expected_revision: 1, vendor_name: H, lines: L1 }] } });
check(r.ok === false && r.reason === 'IN_FLIGHT', 'modifica durante invio in coda: rifiutata', r);
r = await rpc('anon', 'po_cancel', { p_token: T.max, p_order_id: o5.id, p_reason: 'test' });
check(r.ok === false && r.reason === 'IN_FLIGHT', 'annullo durante invio in coda: rifiutato', r);
await rpc('anon', 'po_worker_claim', { p_worker_token: WTOKEN, p_worker_id: 'mini' });
await rpc('anon', 'po_worker_finish', { p_worker_token: WTOKEN, p_attempt_id: a5, p_outcome: 'uncertain', p_result: { error: 'SUBMIT_NO_ANSWER' } });
r = await rpc('anon', 'po_save_draft', { p_token: T.tela, p_payload: { groups: [{ order_id: o5.id, expected_revision: 1, vendor_name: H, lines: L1 }] } });
check(r.ok === false && r.reason === 'IN_FLIGHT', 'esito incerto: modifica ancora rifiutata', r);
r = await rpc('anon', 'po_cancel', { p_token: T.max, p_order_id: o5.id, p_reason: 'verificato su CW: non arrivato' });
check(r.ok === true && r.status === 'cancelled', 'esito incerto: annullo possibile dopo verifica', r);
const o6 = await confirmedOrder('o6', L1);
r = await rpc('service_role', 'po_send_begin', { p_token: T.max, p_order_id: o6.id, p_idempotency_key: 'k-o6-real-1', p_summary_hash: o6.hash, p_real_requested: true, p_ack_duplicates: true });
await rpc('anon', 'po_worker_claim', { p_worker_token: WTOKEN, p_worker_id: 'mini' });
await rpc('anon', 'po_worker_finish', { p_worker_token: WTOKEN, p_attempt_id: r.attempt_id, p_outcome: 'failed', p_result: { error: 'OUT_OF_STOCK' } });
r = await rpc('anon', 'po_save_draft', { p_token: T.tela, p_payload: { groups: [{ order_id: o6.id, expected_revision: 1, vendor_name: H, lines: L1 }] } });
check(r.ok === true && r.orders[0].status === 'draft', 'dopo un invio non partito: modifica possibile (torna bozza)', r);

console.log('\n— permessi');
const anonFin = await (async () => { await db.exec('set role anon'); try { await db.query(`select public.po_send_finish('${a4}', 'sent', '{}')`); return 'ok'; } catch (e) { return e.message; } finally { await db.exec('reset role'); } })();
check(/permission denied/.test(anonFin), 'anon non puo chiamare po_send_finish direttamente', anonFin);
const anonAuth = await (async () => { await db.exec('set role anon'); try { await db.query(`select public.po__worker_auth('${WTOKEN}')`); return 'ok'; } catch (e) { return e.message; } finally { await db.exec('reset role'); } })();
check(/permission denied/.test(anonAuth), 'po__worker_auth non esposto', anonAuth);

console.log('\n— rollback');
await db.exec(fs.readFileSync(path.join(HERE, '..', 'migrations', 'rollback', '20261003_xcf_cw_01_transport_rollback.sql'), 'utf8'));
const cols = await q(`select count(*)::int n from information_schema.columns where table_name='po_send_attempts' and column_name in ('claimed_at','claimed_by','transport')`);
check(cols[0].n === 0, 'rollback toglie le colonne', cols);

console.log(`\n${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
