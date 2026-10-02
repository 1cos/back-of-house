// HEB01 — heb_receipt_import su PGlite: atomicita', idempotenza, verifiche.
// Esegui con NODE_PATH che contiene @electric-sql/pglite.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
const require = createRequire(import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIG = fs.readFileSync(path.join(HERE, '..', 'migrations', '20261002_heb01_receipt_pipeline.sql'), 'utf8');

const ING = { porter: '11111111-1111-1111-1111-111111111111', nys: '22222222-2222-2222-2222-222222222222',
              filet: '33333333-3333-3333-3333-333333333333', ribeye: '44444444-4444-4444-4444-444444444444' };

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema storage; create table storage.buckets (id text primary key, name text, public boolean);
    create table public.ingredients (id uuid primary key, name text);
    insert into public.ingredients values ('${ING.porter}','Porterhouse'),('${ING.nys}','New York Strip'),('${ING.filet}','Beef Filet'),('${ING.ribeye}','Ribeye');
    create table public.vendor_documents (id uuid primary key default gen_random_uuid(), vendor text, document_type text, document_number text,
      document_date date, delivery_date date, raw_text text, parsed_json jsonb, status text, warnings jsonb, uploaded_by text,
      created_at timestamptz default now(), updated_at timestamptz default now(), source_email_subject text, source_email_from text,
      constraint vendor_documents_document_type_check check (document_type = any (array['order_confirmation','invoice','credit_memo','return_request'])),
      constraint vendor_documents_status_check check (status = any (array['pending','imported','error','ignored','pdf_received'])));
    create table public.invoice_lines (id uuid primary key default gen_random_uuid(), import_id uuid, invoice_date date, invoice_number text, vendor text,
      raw_description text, vendor_sku text, ingredient_id uuid, match_status text check (match_status in ('matched','unmatched','ambiguous','ignored')),
      match_confidence numeric, qty numeric, purchase_unit text, pack_description text, unit_price numeric, line_total numeric, cost_per_100g numeric,
      count_unit text check (count_unit in ('weight','volume','each')), avg_unit_weight_g numeric, created_at timestamptz default now());
    create table public.ingredient_vendors (id uuid primary key default gen_random_uuid(), ingredient_id uuid, vendor text, vendor_sku text, purchase_unit text,
      pack_description text, unit_price numeric, conversion_to_base numeric, order_count int default 0, active boolean default true,
      created_at timestamptz default now(), updated_at timestamptz default now(), price_per_100g numeric, last_invoice_date date,
      price_type text check (price_type in ('per_case','per_lb','per_kg','per_oz','per_each')), price_per_each numeric,
      unique (ingredient_id, vendor));
    create table public.vendor_item_aliases (id uuid primary key default gen_random_uuid(), vendor text, vendor_sku text, vendor_description text,
      ingredient_id uuid, confirmed_by text, confirmed_at timestamptz, active boolean, notes text, created_at timestamptz default now(),
      unique (vendor, vendor_description), unique (vendor, vendor_sku));
    -- copia fedele del trigger WM01 in produzione
    create function public.vendor_documents_guard_import() returns trigger language plpgsql as $f$
    begin
      if new.status = 'imported' and (tg_op = 'INSERT' or old.status is distinct from 'imported') then
        if jsonb_array_length(case when jsonb_typeof(new.parsed_json -> 'items') = 'array' then new.parsed_json -> 'items' else '[]'::jsonb end) = 0
           and not exists (select 1 from public.invoice_lines l where l.import_id = new.id) then
          raise exception 'WM01: no items';
        end if;
        if new.document_number is not null and exists (select 1 from public.vendor_documents d where d.id <> new.id and d.status = 'imported'
             and d.vendor = new.vendor and d.document_type = new.document_type and d.document_number = new.document_number) then
          raise exception 'WM01: already imported';
        end if;
      end if;
      return new;
    end $f$;
    create trigger vendor_documents_guard_import before insert or update on public.vendor_documents for each row execute function public.vendor_documents_guard_import();
    -- la riga H-E-B sbagliata di giugno (prezzo confezione letto come $/lb)
    insert into public.ingredient_vendors (ingredient_id, vendor, unit_price, price_type, price_per_100g)
      values ('${ING.filet}','H-E-B',56.14,'per_case',12.3768);
  `);
  await db.exec(MIG);
  return db;
}

const LINES = [
  ['PORTERHOUSE STEAK USDA PR', 46.52], ['BF RE RST PRIME BNLS 6-8', 247.44], ['PRIME NY STRIP STEAK VP', 175.85],
  ['BF RE RST PRIME BNLS 6-8', 285.61], ['PRIME NY STRIP STEAK VP', 143.23], ['TENDERLOIN ROAST USDA PR', 99.93],
  ['TENDERLOIN ROAST USDA PR', 98.57], ['TENDERLOIN ROAST USDA PR', 106.39], ['TENDERLOIN ROAST USDA PR', 90.07],
].map(([d, a], i) => ({ idx: i + 1, description: d, key: d, amount: a }));
const GROUPS = [
  { key: 'PORTERHOUSE STEAK USDA PR', ingredient_id: ING.porter, ask: 'pieces', pieces: 2 },
  { key: 'BF RE RST PRIME BNLS 6-8', ingredient_id: ING.ribeye, ask: 'pieces', pieces: 24 },
  { key: 'PRIME NY STRIP STEAK VP', ingredient_id: ING.nys, ask: 'pieces', pieces: 12 },
  { key: 'TENDERLOIN ROAST USDA PR', ingredient_id: ING.filet, ask: 'pieces', pieces: 20, std_g: 226.8 },
];
const payload = (over = {}) => ({ photo_sha256: 'a'.repeat(64), document_number: 'HEB-752-20261002-1254-129361',
  receipt_date: '2026-10-02', receipt_time: '12:54', store: '752', total: 1293.61, by: 'Max',
  photo_path: 'heb/aaaa.jpg', lines: LINES, groups: GROUPS, ...over });
const call = (db, p) => db.query('select public.heb_receipt_import($1::jsonb) r', [JSON.stringify(p)]).then((r) => r.rows[0].r);
const count = async (db, t) => (await db.query(`select count(*)::int n from ${t}`)).rows[0].n;

let pass = 0, fail = 0;
async function test(n, f) {
  try { await f(); pass++; console.log('  ok  ' + n); }
  catch (e) { fail++; console.log('  FAIL ' + n + '\n       ' + (e && e.message)); }
}

await test('1. Confirm: 1 documento, 9 righe fattura, 4 prezzi, 4 mappature', async () => {
  const db = await setup();
  const r = await call(db, payload());
  assert.strictEqual(r.status, 'imported');
  assert.strictEqual(await count(db, 'public.vendor_documents'), 1);
  assert.strictEqual(await count(db, 'public.invoice_lines'), 9);
  assert.strictEqual(await count(db, 'public.vendor_item_aliases'), 4);
  const doc = (await db.query(`select status, document_type, parsed_json from public.vendor_documents`)).rows[0];
  assert.strictEqual(doc.status, 'imported'); assert.strictEqual(doc.document_type, 'receipt');
  const tot = (await db.query(`select sum(line_total)::numeric s from public.invoice_lines`)).rows[0].s;
  assert.strictEqual(Number(tot), 1293.61, 'contabilita\' = importi stampati');
});

await test('2. costo per unita\' operativa: filetto $19.75 e per 100 g dallo standard 8 oz', async () => {
  const db = await setup();
  await call(db, payload());
  const f = (await db.query(`select * from public.ingredient_vendors where ingredient_id='${ING.filet}'`)).rows[0];
  assert.strictEqual(Number(f.price_per_each), 19.748);
  assert.strictEqual(f.price_type, 'per_each');
  assert.ok(Math.abs(Number(f.price_per_100g) - (394.96 / 20 / 226.8 * 100)) < 1e-6);
  const p = (await db.query(`select * from public.ingredient_vendors where ingredient_id='${ING.porter}'`)).rows[0];
  assert.strictEqual(Number(p.price_per_each), 23.26);
  assert.strictEqual(p.price_per_100g, null, 'nessun peso standard dichiarato: nessun prezzo per 100 g inventato');
});

await test('3. la riga sbagliata di giugno viene sostituita ma conservata nel documento', async () => {
  const db = await setup();
  await call(db, payload());
  const doc = (await db.query(`select parsed_json from public.vendor_documents`)).rows[0].parsed_json;
  assert.strictEqual(doc.legacy_prices_replaced.length, 1);
  assert.strictEqual(Number(doc.legacy_prices_replaced[0].unit_price), 56.14);
});

await test('4. IDEMPOTENZA: secondo Confirm (stesso scontrino) non scrive nulla', async () => {
  const db = await setup();
  await call(db, payload());
  const r2 = await call(db, payload());
  assert.strictEqual(r2.status, 'already_imported');
  const r3 = await call(db, payload({ document_number: 'HEB-X', photo_sha256: 'a'.repeat(64) }));
  assert.strictEqual(r3.status, 'already_imported', 'stessa foto, numero diverso');
  assert.strictEqual(await count(db, 'public.vendor_documents'), 1);
  assert.strictEqual(await count(db, 'public.invoice_lines'), 9);
});

await test('5. totale che non torna: errore e NIENTE scritto', async () => {
  const db = await setup();
  await assert.rejects(call(db, payload({ total: 1300 })), /add up/);
  for (const t of ['public.vendor_documents', 'public.invoice_lines', 'public.vendor_item_aliases']) assert.strictEqual(await count(db, t), 0, t);
  const f = (await db.query(`select unit_price from public.ingredient_vendors where ingredient_id='${ING.filet}'`)).rows[0];
  assert.strictEqual(Number(f.unit_price), 56.14, 'prezzo invariato');
});

await test('6. pezzi mancanti o non interi: errore e niente scritto (niente half-import)', async () => {
  const db = await setup();
  const g = GROUPS.map((x) => ({ ...x }));
  g[3].pieces = null;
  await assert.rejects(call(db, payload({ groups: g })), /whole number/);
  g[3].pieces = 20.5;
  await assert.rejects(call(db, payload({ groups: g })), /whole number/);
  assert.strictEqual(await count(db, 'public.invoice_lines'), 0);
  assert.strictEqual(await count(db, 'public.vendor_documents'), 0);
});

await test('7. riga senza risposta o ingrediente inesistente: errore', async () => {
  const db = await setup();
  await assert.rejects(call(db, payload({ groups: GROUPS.slice(0, 3) })), /no answer/);
  const g = GROUPS.map((x) => ({ ...x })); g[0].ingredient_id = '99999999-9999-9999-9999-999999999999';
  await assert.rejects(call(db, payload({ groups: g })), /not linked/);
  assert.strictEqual(await count(db, 'public.vendor_documents'), 0);
});

await test('8. uno scontrino PIU\' VECCHIO importato dopo non sovrascrive il prezzo piu\' recente', async () => {
  const db = await setup();
  await call(db, payload());
  const old = payload({ photo_sha256: 'b'.repeat(64), document_number: 'HEB-OLD', receipt_date: '2026-09-01',
    lines: [{ idx: 1, description: 'PORTERHOUSE STEAK USDA PR', key: 'PORTERHOUSE STEAK USDA PR', amount: 40 }], total: 40,
    groups: [{ key: 'PORTERHOUSE STEAK USDA PR', ingredient_id: ING.porter, ask: 'pieces', pieces: 1 }] });
  await call(db, old);
  const p = (await db.query(`select price_per_each, last_invoice_date from public.ingredient_vendors where ingredient_id='${ING.porter}'`)).rows[0];
  assert.strictEqual(Number(p.price_per_each), 23.26, 'resta il prezzo del 02/10');
  assert.strictEqual(await count(db, 'public.invoice_lines'), 10, 'ma la riga contabile del vecchio scontrino c\'e\'');
});

await test('9. a peso: costo per lb e per 100 g dal peso dichiarato', async () => {
  const db = await setup();
  const r = await call(db, payload({ photo_sha256: 'c'.repeat(64), document_number: 'HEB-W', total: 20,
    lines: [{ idx: 1, description: 'GROUND BEEF', key: 'GROUND BEEF', amount: 20, weight_lb: 4 }],
    groups: [{ key: 'GROUND BEEF', ingredient_id: ING.nys, ask: 'weight', weight_lb: 4 }] }));
  assert.strictEqual(r.status, 'imported');
  const p = (await db.query(`select * from public.ingredient_vendors where ingredient_id='${ING.nys}'`)).rows[0];
  assert.strictEqual(p.price_type, 'per_lb'); assert.strictEqual(Number(p.unit_price), 5);
});

await test('10. la memoria ricorda mappatura e tipo di domanda, non i pezzi', async () => {
  const db = await setup();
  await call(db, payload());
  const a = (await db.query(`select notes from public.vendor_item_aliases where vendor_description='TENDERLOIN ROAST USDA PR'`)).rows[0];
  const n = JSON.parse(a.notes);
  assert.deepStrictEqual(Object.keys(n).sort(), ['ask', 'source', 'std_g']);
  assert.strictEqual(n.std_g, 226.8);
});

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
