// SEC-RECIPES-SC (release) — Sous Chef: sessione Brigade a ogni chiamata, ricette solo come proposte.
// L'Ufficio applica le proposte ricetta di Sous Chef SOLO con le funzioni protette (ricetta_crea / ricetta_salva):
// se non ci sono, non scrive niente. Il codice vero di js/office.js gira sopra un Postgres locale (PGlite)
// con le funzioni SQL vere (file locali in ~/Brigade_security): senza quei file i test con il database si saltano.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const leggi = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SQL_SALVA = path.join(os.homedir(), 'Brigade_security', 'BR-UI03B', 'install_ricetta_salva.sql');
const SQL_CREA = path.join(os.homedir(), 'Brigade_security', 'SEC-RECIPES', 'funzioni_proposta.sql');
let PGlite = null, pgcrypto = null;
try { ({ PGlite } = require('@electric-sql/pglite')); ({ pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')); } catch (e) { PGlite = null; }
const SALTA = !PGlite ? 'PGlite non installato' : !fs.existsSync(SQL_SALVA) || !fs.existsSync(SQL_CREA) ? 'file SQL locali assenti' : false;

const U = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const tok = () => crypto.randomBytes(32).toString('hex');
const T = { admin: tok(), staff: tok() };
const sha = t => crypto.createHash('sha256').update(t).digest('hex');

async function nuovoDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema extensions; create extension pgcrypto with schema extensions;
    create table public.users (id int8 primary key, name text not null, lang text default 'en', is_admin bool default false, role text default 'staff', active bool default true);
    create table public.brigade_sessions (id uuid primary key default gen_random_uuid(), user_id int8 not null, token_hash text not null,
      created_at timestamptz not null default now(), expires_at timestamptz not null default now() + interval '12 hours',
      invalidated_at timestamptz, user_agent text, absolute_expires_at timestamptz not null default now() + interval '7 days');
    create table public.ingredients (id uuid primary key default gen_random_uuid(), name text not null, name_it text, name_es text, base_unit text default 'g');
    create table public.prep_tasks (id int8 primary key, name text not null, recipe_id uuid);
    create table public.recipes (id uuid primary key default gen_random_uuid(), title text not null, category text, yield_text text, prep_time_minutes int4,
      ingredients jsonb default '[]'::jsonb, procedure text, equipment text, created_at timestamptz default now(), image_url text, base_weight numeric,
      weight_unit text default 'kg', base_servings int4, selling_price numeric, photo_url text, food_cost_pct numeric, base_weight_g numeric,
      serving_weight_g numeric, pos_name text, menu_group text, prep_frequency_days int4, shelf_life_days int4, serving_unit text, serving_qty numeric,
      procedure_en text, procedure_es text);
    create table public.recipe_bom (bom_id serial primary key, parent_recipe_id uuid references public.recipes(id) on delete cascade,
      component_type text not null, item_id uuid references public.ingredients(id), sub_recipe_id uuid references public.recipes(id),
      quantity numeric not null, unit text not null, notes text, prep_task_id bigint references public.prep_tasks(id), sort_order int);
    create table public.recipe_steps (id uuid primary key default gen_random_uuid(), recipe_id uuid not null references public.recipes(id) on delete cascade,
      step_number int not null, title text not null, instruction_en text, instruction_it text, instruction_es text, timer_seconds int,
      created_at timestamptz default now(), title_it text, title_es text, unique (recipe_id, step_number));
    create function public.fc_costo_ricetta(p_token text, p_recipe_id uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    insert into public.users values (1,'Max','it',true,'admin',true),(2,'Cuoco','it',false,'staff',true);
    insert into public.brigade_sessions (user_id, token_hash) values (1,'${sha(T.admin)}'),(2,'${sha(T.staff)}');
    insert into public.ingredients (id, name) values ('${U(101)}','Milk'),('${U(102)}','Butter');
    insert into public.prep_tasks values (77,'Burro a cubetti',null);
    insert into public.recipes (id, title, menu_group, base_weight_g, ingredients) values ('${U(3)}','CACIO E PEPE SAUCE','Sauces',6000,'[{"qty":"1","name":"milk"}]');
    insert into public.recipe_bom (bom_id, parent_recipe_id, component_type, item_id, quantity, unit, notes, prep_task_id, sort_order) values
      (1882,'${U(3)}','ITEM','${U(101)}',1,'gallone','latte intero',null,1),
      (1883,'${U(3)}','ITEM','${U(102)}',440,'g','burro',77,2);
    select setval('recipe_bom_bom_id_seq', 9000);
  `);
  await db.exec(fs.readFileSync(SQL_SALVA, 'utf8'));
  await db.exec(fs.readFileSync(SQL_CREA, 'utf8'));
  return db;
}

// supa finto: le rpc protette girano nel Postgres locale; ogni scrittura diretta viene registrata e rifiutata
function fakeSupa(pg, log, knobs) {
  const diretta = (t, op) => { const r = { data: null, error: { message: 'scrittura diretta vietata nel test' } }; log.dirette.push({ t, op });
    const c = { eq: () => c, ilike: () => c, select: () => c, single: async () => r, then: (a, b) => Promise.resolve(r).then(a, b) }; return c; };
  return {
    from: t => ({ update: () => diretta(t, 'update'), insert: () => diretta(t, 'insert'), delete: () => diretta(t, 'delete'), upsert: () => diretta(t, 'upsert'),
      select: () => { const c = { eq: () => c, maybeSingle: async () => ({ data: null, error: null }), then: (a, b) => Promise.resolve({ data: [], error: null }).then(a, b) }; return c; } }),
    rpc: async (n, a) => {
      log.rpc.push(n);
      if (knobs.manca || !pg) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + n } };
      const j = x => x == null ? null : JSON.stringify(x);
      const q = n === 'ricetta_crea' ? ['select public.ricetta_crea($1,$2) r', [a.p_token, j(a.p_dati)]]
        : n === 'ricetta_per_modifica' ? ['select public.ricetta_per_modifica($1,$2) r', [a.p_token, a.p_recipe_id]]
        : n === 'ricetta_salva' ? ['select public.ricetta_salva($1,$2,$3,$4,$5,$6) r', [a.p_token, a.p_recipe_id, a.p_impronta, j(a.p_patch), j(a.p_distinta), j(a.p_passi)]] : null;
      if (!q) return { data: null, error: { message: 'funzione sconosciuta' } };
      return { data: (await pg.query(q[0], q[1])).rows[0].r, error: null };
    },
  };
}

// il codice VERO di office.js: la strada protetta e jarvisExecuteDraft
function ufficio(pg, token, knobs = {}) {
  const src = leggi('js/office.js');
  const i = src.indexOf('var _scProtetta = {');
  const f = src.indexOf('async function jarvisExecuteDraft(sb, draft) {');
  const fine = src.indexOf('\n}\n', f);
  assert.ok(i > 0 && f > i && fine > f, 'blocchi di office.js trovati');
  const log = { rpc: [], dirette: [] };
  const supa = fakeSupa(pg, log, knobs);
  const ctx = { window: { supa }, localStorage: { getItem: () => token }, console };
  vm.createContext(ctx);
  // le costanti di BR-OFFICE01, con l'interruttore acceso: qui le funzioni protette sono installate (come dopo il cutover)
  const c0 = src.indexOf('var RICETTE_PROTETTE_ATTIVE'), c1 = src.indexOf('var _ppUltime');
  assert.ok(c0 > 0 && c1 > c0, 'costanti BR-OFFICE01 trovate');
  const costanti = src.slice(c0, c1).replace('var RICETTE_PROTETTE_ATTIVE = false;', 'var RICETTE_PROTETTE_ATTIVE = true;');
  vm.runInContext(costanti + src.slice(i, fine + 2) + '\nthis.esegui = jarvisExecuteDraft;', ctx);
  return { esegui: d => ctx.esegui(supa, d), log };
}
const foto = async pg => (await pg.query(`select md5(coalesce((select jsonb_agg(to_jsonb(x) order by x.id)::text from public.recipes x),'')
  || coalesce((select jsonb_agg(to_jsonb(x) order by x.bom_id)::text from public.recipe_bom x),'')
  || coalesce((select jsonb_agg(to_jsonb(x) order by x.id)::text from public.recipe_steps x),'')) f`)).rows[0].f;
const bozzaRiga = extra => ({ action_type: 'update_recipe_bom', payload: Object.assign({ bom_id: 1883, recipe_id: U(3), recipe_title: 'CACIO E PEPE SAUCE',
  fields: { quantity: 450 }, motivo: 'prova', proposta_da: 'Cuoco' }, extra || {}) });
const bozzaNuova = { action_type: 'create_recipe', payload: { title: 'Salsa di prova', category: 'Basi|salse madri', base_weight_g: 2000,
  procedure: 'Scalda e manteca.', ingredienti_proposti: [{ name: 'Butter', qty: 200, unit: 'g' }], motivo: 'prova', proposta_da: 'Cuoco' } };

test('01 — tutti e 6 i punti che chiamano Sous Chef mandano la sessione Brigade', () => {
  const conta = (f, re) => (leggi(f).match(re) || []).length;
  const tokenRe = /brigade_token: \(\(\)=>\{ try\{ return localStorage\.getItem\('brigade_token'\); \}catch\(e\)\{ return null; \} \}\)\(\)/g;
  assert.strictEqual(conta('js/souschef-chat.js', tokenRe), 2);
  assert.strictEqual(conta('js/prep.js', tokenRe), 2);
  assert.strictEqual(conta('js/recipes.js', tokenRe), 1);
  assert.strictEqual(conta('daily-journal/journal-ai.js', tokenRe), 1);
  const chiamate = ['js/souschef-chat.js', 'js/prep.js', 'js/recipes.js'].reduce((s, f) => s + conta(f, /functions\/v1\/souschef-chat`/g), 0) + conta('daily-journal/journal-ai.js', /fetch\(CHEF_AI_ENDPOINT/g);
  assert.strictEqual(chiamate, 6);
});

test('02 — la chat parla di proposta da approvare, non di ricetta salvata/modificata', () => {
  const s = leggi('js/souschef-chat.js');
  assert.match(s, /Proposta da approvare in Ufficio: <b>\$\{action\.ingredient_name\}/);
  assert.match(s, /Proposta da approvare in Ufficio: nuova ricetta <b>\$\{action\.title\}/);
  assert.doesNotMatch(s, /Salvo ricetta <b>|Modifico <b>\$\{action\.ingredient_name/);
});

test('03 — funzioni protette assenti: nuova ricetta e riga di distinta NON scrivono niente', async () => {
  const u = ufficio(null, T.admin, { manca: true });
  await assert.rejects(u.esegui(bozzaNuova), /non ancora installata \(ricetta_crea\)/);
  await assert.rejects(u.esegui(bozzaRiga()), /non ancora installata \(ricetta_per_modifica\)/);
  assert.deepStrictEqual(u.log.dirette, []);
});

test('04 — riga di distinta proposta da Sous Chef: solo ricetta_salva, cambia solo quella riga, bom_id e prep restano', { skip: SALTA }, async () => {
  const pg = await nuovoDb();
  const prima = (await pg.query('select to_jsonb(b) j from public.recipe_bom b order by bom_id')).rows.map(r => r.j);
  const r = await ufficio(pg, T.admin).esegui(bozzaRiga());
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), { updated: 'recipe_bom', bom_id: 1883, via: 'ricetta_salva' });
  const dopo = (await pg.query('select to_jsonb(b) j from public.recipe_bom b order by bom_id')).rows.map(r => r.j);
  assert.deepStrictEqual(dopo[0], prima[0]);
  assert.deepStrictEqual(dopo[1], Object.assign({}, prima[1], { quantity: 450 }));
  assert.strictEqual(dopo[1].prep_task_id, 77);
});

test('05 — cuoco (non admin) che approva: la funzione rifiuta, niente cambia', { skip: SALTA }, async () => {
  const pg = await nuovoDb(); const f0 = await foto(pg);
  const u = ufficio(pg, T.staff);
  await assert.rejects(u.esegui(bozzaRiga()));
  await assert.rejects(u.esegui(bozzaNuova));
  assert.strictEqual(await foto(pg), f0);
  assert.deepStrictEqual(u.log.dirette, []);
});

test('06 — proposta con campi non ammessi, riga di un\'altra ricetta, sessione assente: niente cambia', { skip: SALTA }, async () => {
  const pg = await nuovoDb(); const f0 = await foto(pg);
  await assert.rejects(ufficio(pg, T.admin).esegui(bozzaRiga({ fields: { quantity: 1, prep_task_id: null } })), /non ammessi/);
  await assert.rejects(ufficio(pg, T.admin).esegui(bozzaRiga({ bom_id: 9999 })), /non trovata/);
  await assert.rejects(ufficio(pg, null).esegui(bozzaRiga()));
  assert.strictEqual(await foto(pg), f0);
});

test('07 — nuova ricetta approvata: ricetta_crea + procedimento con ricetta_salva; nessun testo storico, nessuna distinta inventata', { skip: SALTA }, async () => {
  const pg = await nuovoDb();
  const u = ufficio(pg, T.admin);
  const r = await u.esegui(bozzaNuova);
  assert.strictEqual(r.via, 'ricetta_crea'); assert.strictEqual(r.ingredienti_da_inserire, 1);
  const rec = (await pg.query('select to_jsonb(r) j from public.recipes r where id = $1', [r.recipe_id])).rows[0].j;
  assert.strictEqual(rec.title, 'Salsa di prova'); assert.strictEqual(rec.procedure, 'Scalda e manteca.');
  assert.deepStrictEqual(rec.ingredients, []);
  assert.strictEqual((await pg.query('select count(*)::int n from public.recipe_bom where parent_recipe_id = $1', [r.recipe_id])).rows[0].n, 0);
  assert.deepStrictEqual(u.log.rpc, ['ricetta_crea', 'ricetta_per_modifica', 'ricetta_salva']);
  assert.deepStrictEqual(u.log.dirette, []);
  await assert.rejects(ufficio(pg, T.admin).esegui(bozzaNuova));   // stesso nome: rifiutata
});

test('08 — BR-OFFICE01: anche le proposte Jarvis solo dalla strada protetta; il contenuto della proposta si mostra come testo', () => {
  const s = leggi('js/office.js');
  assert.match(s, /return await _scProtetta\.aggiornaRiga\(payload\);/);
  assert.doesNotMatch(s, /from\('recipe_bom'\)\.update\(payload\.fields/);
  assert.match(s, /white-space:pre-wrap;">' \+ escHtml\(payloadStr\) \+ '<\/pre>'/);
  assert.match(s, /Proposta: nuova ricetta «' \+ escHtml\(p\.title/);
});
