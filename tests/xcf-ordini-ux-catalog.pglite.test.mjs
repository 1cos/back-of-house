// XCF-ORDINI-UX 01 — calendario fornitori + catalogo acquisti (PGlite, nessuna rete).
// Uso: NODE_PATH=<node_modules con @electric-sql/pglite> node tests/xcf-ordini-ux-catalog.pglite.test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { setup, T } from './helpers-xcf-ordini-pglite.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIG = f => fs.readFileSync(path.join(HERE, '..', 'migrations', f), 'utf8');

let pass = 0, fail = 0;
const check = (c, m, extra) => {
  if (c) { pass++; console.log('  ✓ ' + m); }
  else { fail++; console.log('  ✗ ' + m + (extra !== undefined ? '\n      ' + JSON.stringify(extra).slice(0, 700) : '')); }
};
const H = "Hardie's Fresh Foods / Dairyland Produce";

const db = await setup();
await db.exec(`create table public.invoice_lines (id uuid primary key default gen_random_uuid(), import_id uuid, invoice_date date, vendor text,
  raw_description text, vendor_sku text, ingredient_id uuid, qty numeric, purchase_unit text, unit_price numeric, pack_description text,
  created_at timestamptz default now()); alter table public.ingredients add column name_it text;`);
await db.exec(MIG('20261003_xcf_cw_01_transport.sql'));
await db.exec(MIG('20261003_xcf_ordini_ux_01_catalog.sql'));
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const rpc = async (fn, args) => {
  const keys = Object.keys(args);
  await db.exec('set role anon');
  try { return (await q(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, keys.map(k => args[k])))[0].r; }
  finally { await db.exec('reset role'); }
};
const today = (await q(`select public.po__today() d`))[0].d;
const D = n => { const d = new Date(today); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

const [burrata, basil, oldItem, dno] = (await q(`insert into public.ingredients(name, name_it) values
  ('Burrata','Burrata'),('Basil','Basilico'),('Old Thing',null),('Banned',null) returning id`)).map(r => r.id);
await q(`insert into public.ingredient_vendors(ingredient_id,vendor,vendor_sku,do_not_order) values ($1,$2,'777',true)`, [dno, H]);
const ins = (sku, ing, days, qty = 1, unit = 'case', price = 10, vendor = H) => Promise.all(days.map(n =>
  q(`insert into public.invoice_lines(invoice_date,vendor,raw_description,vendor_sku,ingredient_id,qty,purchase_unit,unit_price,pack_description)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'6 x 4oz')`, [D(n), vendor, 'DESC ' + sku, sku, ing, qty, unit, price])));
await ins('25618', burrata, [4, 8, 12, 16, 20, 24, 28, 32, 36], 1, 'CASE', 24.45);      // ogni 4 gg, ultimo 4 gg fa -> dovuto 1
await ins('01306', basil, [1, 5, 9, 13]);                                              // ultimo 1 gg fa -> dovuto 0,25: abituale, non suggerito
await ins('99999', oldItem, [60, 70, 80, 90]);                                         // fuori finestra 8 settimane
await ins('777', dno, [2, 6, 10, 14]);                                                 // do_not_order: escluso
await ins('X1', null, [3], 2, 'case', 5, 'Fruge Seafood');                             // altro fornitore

console.log('\n— calendario');
let ch = (await q(`select vendor_name, delivery_weekdays, order_view, calendar_source from public.po_vendor_channels order by 1`));
const by = Object.fromEntries(ch.map(r => [r.vendor_name, r]));
check(JSON.stringify(by[H].delivery_weekdays) === '[1,3,5,6]' && by[H].order_view === 'suggest' && by[H].calendar_source === 'verified', "Hardie's lun/mer/ven/sab, suggeriti", by[H]);
check(JSON.stringify(by['Ben E. Keith'].delivery_weekdays) === '[1,4]', 'BEK lun/gio', by['Ben E. Keith']);
check(by['Global Gourmet Foods'] && JSON.stringify(by['Global Gourmet Foods'].delivery_weekdays) === '[2]' && by['Global Gourmet Foods'].order_view === 'list', 'GG creato: martedi, lista', by['Global Gourmet Foods']);
check(by['Fruge Seafood'].calendar_source === 'to_verify' && by['Fruge Seafood'].order_view === 'list', 'Fruge: lista, calendario da verificare', by['Fruge Seafood']);
const nd = (await q(`select public.po__next_deliveries(array[2], 1, '2026-10-05'::date) d`))[0].d;   // lunedi 05/10
check(JSON.stringify(nd.map(d => new Date(d).toISOString().slice(0, 10))) === '["2026-10-06","2026-10-13","2026-10-20"]', 'prossime consegne GG da lunedi 05/10: 06, 13, 20', nd);
const nd2 = (await q(`select public.po__next_deliveries(array[1,3,5,6], 1, '2026-10-03'::date) d`))[0].d; // sabato
check(new Date(nd2[0]).toISOString().slice(0, 10) === '2026-10-05', "Hardie's da sabato con anticipo 1: lunedi 05/10", nd2);

console.log('\n— catalogo');
let r = await rpc('po_vendor_catalog', { p_token: T.cook, p_vendor: H });
check(r.ok === false && r.reason === 'FORBIDDEN', 'cuoco non autorizzato', r);
r = await rpc('po_vendor_catalog', { p_token: T.tela, p_vendor: H });
check(r.ok && r.channel.order_view === 'suggest' && r.next_deliveries.length === 3, 'catalogo con canale e prossime consegne', r.channel);
const it = Object.fromEntries(r.items.map(i => [i.vendor_sku, i]));
check(!it['777'], 'do_not_order escluso', Object.keys(it));
check(!it['X1'], 'solo il fornitore richiesto', Object.keys(it));
const b = it['25618'];
check(b && b.suggested === true && b.habitual === true && b.interval_days === 4 && b.days_since === 4 && Number(b.due) === 1 && b.weeks_8 >= 5,
  'Burrata: suggerita, ogni 4 gg, ultimo 4 gg fa', b);
check(b.last_unit === 'case' && Number(b.last_price) === 24.45 && b.name === 'Burrata' && b.ingredient_id === burrata, 'ultima unita (minuscola), prezzo, nome, ingrediente', b);
check(it['01306'].suggested === false && it['01306'].habitual === true && it['01306'].name_it === 'Basilico', 'Basilico: abituale, non ancora dovuto', it['01306']);
check(it['99999'].habitual === false && it['99999'].suggested === false, 'articolo vecchio: in Cerca, non abituale', it['99999']);
check(r.items[0].vendor_sku === '25618', 'i suggeriti vengono per primi', r.items.map(i => i.vendor_sku));

console.log('\n— elenco fornitori');
r = await rpc('po_vendor_list', { p_token: T.tela });
check(r.ok && r.vendors.map(v => v.vendor_name).join('|') === [H, 'Global Gourmet Foods', 'Ben E. Keith', 'Fruge Seafood'].join('|'), 'i 4 fornitori in ordine', r.vendors.map(v => v.vendor_name));

console.log(`\n${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
