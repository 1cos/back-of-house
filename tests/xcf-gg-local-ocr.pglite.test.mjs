// XCF-GG 04 — OCR locale del Mac Mini: claim/submit (PGlite, nessuna rete).
// Uso: NODE_PATH=<node_modules con @electric-sql/pglite> node tests/xcf-gg-local-ocr.pglite.test.mjs
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { setup } from './helpers-xcf-ordini-pglite.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIG = f => fs.readFileSync(path.join(HERE, '..', 'migrations', f), 'utf8');

let pass = 0, fail = 0;
const check = (c, m, extra) => {
  if (c) { pass++; console.log('  ✓ ' + m); }
  else { fail++; console.log('  ✗ ' + m + (extra !== undefined ? '\n      ' + JSON.stringify(extra).slice(0, 600) : '')); }
};
const WTOKEN = 'w'.repeat(48);

const db = await setup();
await db.exec(MIG('20261003_xcf_cw_01_transport.sql'));
await db.exec(MIG('20261003_xcf_gg_04_local_ocr.sql'));
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const rpc = async (fn, args) => {
  const keys = Object.keys(args);
  await db.exec('set role anon');
  try {
    return (await q(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, keys.map(k => args[k])))[0].r;
  } finally { await db.exec('reset role'); }
};
await q(`update public.po_settings set value=to_jsonb($1::text) where key='cw_worker_token_sha256'`, [crypto.createHash('sha256').update(WTOKEN).digest('hex')]);

const W = (code) => JSON.stringify([{ code, severity: 'blocking', message: 'x' }]);
const [scan, other, ok, noPdf] = (await q(`insert into public.vendor_documents (vendor, status, warnings, parsed_json) values
  ('Global Gourmet Foods','error',$1,'{"storage_path":"invoices/gmail/s.pdf"}'),
  ('Global Gourmet Foods','error',$2,'{"storage_path":"invoices/gmail/o.pdf"}'),
  ('Fruge Seafood','imported','[]','{"storage_path":"invoices/gmail/f.pdf"}'),
  ('Global Gourmet Foods','error',$1,'{}') returning id`, [W('OCR_FAILED'), W('PARSER_ERROR')])).map(r => r.id);

console.log('\n— token');
let r = await rpc('vd_ocr_claim', { p_worker_token: 'x'.repeat(48), p_worker_id: 'mini' });
check(r.ok === false && r.reason === 'AUTH_ERROR', 'token sbagliato rifiutato', r);

console.log('\n— claim');
r = await rpc('vd_ocr_claim', { p_worker_token: WTOKEN, p_worker_id: 'mini' });
check(r.ok && r.jobs.length === 1 && r.jobs[0].id === scan && r.jobs[0].storage_path === 'invoices/gmail/s.pdf',
  'solo la scansione in OCR_FAILED con PDF (non altri errori, non importati, non senza PDF)', r);
r = await rpc('vd_ocr_claim', { p_worker_token: WTOKEN, p_worker_id: 'mini' });
check(r.ok && r.jobs.length === 0, 'gia presa: non ridata per 15 minuti', r);

console.log('\n— submit');
r = await rpc('vd_ocr_submit', { p_worker_token: WTOKEN, p_doc_id: ok, p_text: 'x'.repeat(100), p_engine: 'apple-vision', p_pages: 1 });
check(r.ok === false && r.reason === 'INVALID_STATE', 'documento non fermo per OCR: non si tocca', r);
r = await rpc('vd_ocr_submit', { p_worker_token: WTOKEN, p_doc_id: scan, p_text: 'poco', p_engine: 'apple-vision', p_pages: 1 });
check(r.ok && r.recorded === 'failure', 'testo inutile: registrato come fallimento, resta in errore', r);
let row = (await q(`select status, parsed_json from public.vendor_documents where id=$1`, [scan]))[0];
check(row.status === 'error' && row.parsed_json.local_ocr.error && !row.parsed_json.ocr_text, 'nessun testo scritto', row);
const TEXT = 'GLOBAL GOURMET FOODS\nInvoice 22328\nQuantity Description Amount\n' + 'riga '.repeat(20);
r = await rpc('vd_ocr_submit', { p_worker_token: WTOKEN, p_doc_id: scan, p_text: TEXT, p_engine: 'apple-vision', p_pages: 3 });
check(r.ok && r.status === 'pdf_received', 'testo buono: torna in coda per il worker cloud', r);
row = (await q(`select status, warnings, parsed_json from public.vendor_documents where id=$1`, [scan]))[0];
check(row.status === 'pdf_received' && row.warnings.length === 0 && row.parsed_json.ocr_text === TEXT && row.parsed_json.ocr_engine === 'apple-vision'
  && row.parsed_json.storage_path === 'invoices/gmail/s.pdf' && row.parsed_json.local_ocr.replaced_warning[0].code === 'OCR_FAILED',
  'ocr_text, motore, PDF e traccia del vecchio errore', row);
r = await rpc('vd_ocr_submit', { p_worker_token: WTOKEN, p_doc_id: scan, p_text: TEXT, p_engine: 'apple-vision', p_pages: 3 });
check(r.ok === false && r.reason === 'INVALID_STATE', 'secondo submit: rifiutato (gia in coda)', r);

console.log('\n— massimo 3 tentativi');
await q(`update public.vendor_documents set parsed_json = parsed_json || '{"local_ocr":{"attempts":3,"claimed_at":"2020-01-01T00:00:00Z"}}' where id=$1`, [noPdf]);
await q(`update public.vendor_documents set parsed_json = '{"storage_path":"p.pdf","local_ocr":{"attempts":3,"claimed_at":"2020-01-01T00:00:00Z"}}' where id=$1`, [noPdf]);
r = await rpc('vd_ocr_claim', { p_worker_token: WTOKEN, p_worker_id: 'mini' });
check(r.ok && r.jobs.length === 0, 'dopo 3 tentativi non si riprova', r);

console.log(`\n${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
