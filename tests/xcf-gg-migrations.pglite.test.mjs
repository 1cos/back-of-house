// XCF-GG — le tre migrazioni Global Gourmet su un Postgres vero (PGlite):
// 01 ferma i documenti all'ingresso, 03 inserisce lo storico in modalita'
// storica (idempotente, mai doppioni), 02 rilascia SOLO i fermati.
// `node tests/xcf-gg-migrations.pglite.test.mjs` (NODE_PATH con @electric-sql/pglite)
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIG = f => fs.readFileSync(path.join(HERE, '..', 'migrations', f), 'utf8');

let pass = 0, fail = 0;
async function test(n, f) {
  try { await f(); console.log('  ✓ ' + n); pass++; } catch (e) { console.log('  ✗ ' + n + '\n      ' + e.message); fail++; }
}

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create table public.vendor_documents (
    id uuid primary key default gen_random_uuid(), vendor text, document_type text, document_number text,
    document_date date, delivery_date date, raw_text text, parsed_json jsonb, status text, warnings jsonb,
    uploaded_by text, created_at timestamptz default now(), updated_at timestamptz default now(),
    source_email_subject text, source_email_from text,
    constraint vendor_documents_status_check check (status = any (array['pending','imported','error','ignored','pdf_received'])),
    constraint vendor_documents_document_type_check check (document_type = any (array['order_confirmation','invoice','credit_memo','return_request'])));
  create table public.invoice_lines (id uuid primary key default gen_random_uuid(), vendor text, invoice_number text);
`);
const gmailInsert = (from) => db.query(
  `insert into public.vendor_documents (vendor, document_type, status, uploaded_by, source_email_subject, source_email_from, raw_text, parsed_json, warnings)
   values ('unknown','invoice','pdf_received','gmail-auto','Re: AR ZENO / OPEN BALANCE SELECTYED [GG 0123456789ab]', $1, 'invoices/gmail/1_Scanned_Document_72.pdf',
           '{"storage_path":"invoices/gmail/1_Scanned_Document_72.pdf","original_filename":"Scanned_Document_72.pdf"}', '[]')
   returning id, vendor, status, warnings, parsed_json`, [from]);

await test('01. hold: il PDF di @ggourmetfoods.com nasce fermo, tracciato, con il PDF', async () => {
  await db.exec(MIG('20261002_xcf_gg_01_hold.sql'));
  const r = (await gmailInsert('Mauricio Martinez <mmartinez@ggourmetfoods.com>')).rows[0];
  assert.strictEqual(r.status, 'error');
  assert.strictEqual(r.vendor, 'Global Gourmet Foods');
  assert.strictEqual(r.warnings[0].code, 'GG_HOLD_PARSER_NOT_DEPLOYED');
  assert.strictEqual(r.parsed_json.storage_path, 'invoices/gmail/1_Scanned_Document_72.pdf');
  assert.ok(r.parsed_json.gg_hold.since);
});

await test('01b. hold: gli altri fornitori non sono toccati', async () => {
  const r = (await gmailInsert('system@netyield.com')).rows[0];
  assert.strictEqual(r.status, 'pdf_received');
  assert.strictEqual(r.vendor, 'unknown');
});

await test('03. storico: 3 fatture pending, historical_mode, date originali; rieseguito non duplica', async () => {
  const sql = MIG('20261002_xcf_gg_03_storico.sql');
  await db.exec(sql);
  await db.exec(sql);
  const r = (await db.query(`select document_number, document_date::text d, status, (parsed_json->>'historical_mode') h,
      (parsed_json->>'total')::numeric t, jsonb_array_length(parsed_json->'items') n
      from public.vendor_documents where uploaded_by = 'manual-photo (XCF-GG storico)' order by document_date`)).rows;
  assert.deepStrictEqual(r.map(x => [x.document_number, x.d, x.status, x.h, Number(x.t), x.n]), [
    ['7186', '2022-12-20', 'pending', 'true', 520.19, 6],
    ['15814', '2025-06-17', 'pending', 'true', 2415.96, 10],
    ['19563', '2026-03-31', 'pending', 'true', 1196.3, 7],
  ]);
});

await test('03b. storico: se la fattura esiste gia\' in invoice_lines non entra', async () => {
  const db2 = new PGlite();
  await db2.exec(`create table public.vendor_documents (id uuid primary key default gen_random_uuid(), vendor text, document_type text, document_number text,
    document_date date, delivery_date date, raw_text text, parsed_json jsonb, status text, warnings jsonb, uploaded_by text);
    create table public.invoice_lines (vendor text, invoice_number text);
    insert into public.invoice_lines values ('Global Gourmet Foods','7186');`);
  await db2.exec(MIG('20261002_xcf_gg_03_storico.sql'));
  const r = (await db2.query(`select document_number from public.vendor_documents order by 1`)).rows.map(x => x.document_number);
  assert.deepStrictEqual(r, ['15814', '19563']);
});

await test('02. release: solo i fermati tornano pdf_received, il trigger sparisce', async () => {
  await db.exec(MIG('20261002_xcf_gg_02_release.sql'));
  const held = (await db.query(`select status, warnings, parsed_json from public.vendor_documents where source_email_from like '%ggourmetfoods%'`)).rows;
  assert.strictEqual(held.length, 1);
  assert.strictEqual(held[0].status, 'pdf_received');
  assert.deepStrictEqual(held[0].warnings, []);
  assert.ok(held[0].parsed_json.gg_hold_released && !held[0].parsed_json.gg_hold);
  assert.strictEqual(held[0].parsed_json.storage_path, 'invoices/gmail/1_Scanned_Document_72.pdf');
  const r = (await gmailInsert('mmartinez@ggourmetfoods.com')).rows[0];
  assert.strictEqual(r.status, 'pdf_received', 'dopo il rilascio non si ferma piu\' niente');
  const storico = (await db.query(`select count(*)::int c from public.vendor_documents where status='pending'`)).rows[0].c;
  assert.strictEqual(storico, 3, 'lo storico non e\' toccato dal rilascio');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
