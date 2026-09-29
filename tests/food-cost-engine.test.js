// FC01 — Motore food cost: test della migrazione SQL su un Postgres locale (PGlite).
//
// Run: npm i --no-save @electric-sql/pglite && node tests/food-cost-engine.test.js
//
// Le tabelle public.* sono ricreate con le stesse colonne della produzione
// (sottoinsieme usato dal motore); i dati sono fixture sintetiche che
// riproducono i casi reali di FC01 (olio GG #20734, sale stima chef,
// pomodori Hardie's, ciclo Grated Pecorino, ecc.).

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const MIGRATION = path.join(__dirname, '..', 'migrations', '20260928_fc01_food_cost_engine.sql');

const PROD_SHAPE = `
-- i ruoli di Supabase, come in produzione
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
end $$;
create table public.recipes (id uuid primary key, title text, category text, yield_text text,
  prep_time_minutes integer, ingredients jsonb, procedure text, equipment text, created_at timestamptz,
  image_url text, base_weight numeric, weight_unit text, base_servings integer, selling_price numeric,
  food_cost_pct numeric, base_weight_g numeric, serving_weight_g numeric, serving_unit text, serving_qty numeric);
create table public.ingredients (id uuid primary key, name text, category text, base_unit text,
  measure_type text, active boolean default true, avg_unit_weight_g numeric, yield_factor numeric);
create table public.recipe_bom (bom_id serial primary key, parent_recipe_id uuid, component_type text,
  item_id uuid, sub_recipe_id uuid, quantity numeric, unit text, notes text, sort_order integer);
create table public.ingredient_vendors (id uuid primary key default gen_random_uuid(), ingredient_id uuid,
  vendor text, pack_description text, unit_price numeric, conversion_to_base numeric, active boolean default true,
  updated_at timestamptz default now(), price_per_100g numeric, last_invoice_date date, price_type text,
  price_per_each numeric);
create table public.invoice_lines (id uuid primary key default gen_random_uuid(), invoice_date date,
  invoice_number text, vendor text, ingredient_id uuid, match_status text default 'matched',
  cost_per_100g numeric, price_anomaly boolean default false, created_at timestamptz default now());
create table public.unit_each_weights (ingredient_id uuid primary key, avg_weight_g numeric, source text);
create table public.events (id uuid primary key, name text);
-- gli oggetti rotti di oggi, che la migrazione sostituisce
create table public.items (item_id integer primary key);
create function public.get_recipe_cost(p_recipe_id uuid) returns numeric language sql stable as $$ select 0::numeric $$;
create view public.recipes_with_cost as select id, title, category, yield_text, prep_time_minutes, ingredients,
  procedure, equipment, created_at, image_url, base_weight, weight_unit, base_servings,
  get_recipe_cost(id) as total_cost, case when base_weight > 0 then get_recipe_cost(id) / base_weight end as cost_per_kg
  from public.recipes;
`;

let n = 0;
const U = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

async function fresh() {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(PROD_SHAPE);
  await db.exec(fs.readFileSync(MIGRATION, 'utf8'));
  const h = {
    db,
    async ing(name, o = {}) {
      const id = U();
      await db.query(`insert into public.ingredients (id, name, base_unit, measure_type, category) values ($1,$2,$3,$4,$5)`,
        [id, name, o.base_unit || 'g', o.measure_type || 'weight', o.category || null]);
      return id;
    },
    async price(ingredient_id, o) {
      const r = await db.query(`insert into public.ingredient_vendors (ingredient_id, vendor, pack_description, unit_price,
          conversion_to_base, price_per_100g, last_invoice_date, price_type, price_per_each, updated_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9, coalesce($10::timestamptz, now())) returning id`,
        [ingredient_id, o.vendor, o.pack || null, o.unit_price ?? null, o.conv ?? null, o.p100 ?? null,
         o.date || null, o.price_type || 'per_case', o.each ?? null, o.updated_at || null]);
      if (o.line) {
        await db.query(`insert into public.invoice_lines (invoice_date, invoice_number, vendor, ingredient_id, cost_per_100g)
          values ($1,$2,$3,$4,$5)`, [o.date, o.line.number || null, o.vendor, ingredient_id, o.line.c100 ?? o.p100]);
      }
      return r.rows[0].id;
    },
    async recipe(title, o = {}, bom = []) {
      const id = o.id || U();
      await db.query(`insert into public.recipes (id, title, base_weight, weight_unit, base_weight_g, base_servings,
          serving_unit, serving_qty, serving_weight_g) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, title, o.base_weight ?? null, o.weight_unit || 'kg', o.yield_g ?? null, o.servings ?? null,
         o.serving_unit || null, o.serving_qty ?? null, o.serving_weight_g ?? null]);
      for (const [i, c] of bom.entries()) await h.bom(id, c, i);
      return id;
    },
    async bom(parent, c, i = 0) {
      await db.query(`insert into public.recipe_bom (parent_recipe_id, component_type, item_id, sub_recipe_id, quantity, unit, sort_order)
        values ($1,$2,$3,$4,$5,$6,$7)`,
        [parent, c.sub ? 'RECIPE' : 'ITEM', c.item || null, c.sub || null, c.qty, c.unit, i]);
    },
    async bd(recipe_id, sheet = null) {
      return (await db.query(`select food_cost.recipe_breakdown($1, $2) x`, [recipe_id, sheet])).rows[0].x;
    },
    async one(sql, params = []) { return Object.values((await db.query(sql, params)).rows[0])[0]; },
  };
  return h;
}

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(Number(a) - Number(b)) < eps, `${a} != ${b}`);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// --- prezzi ----------------------------------------------------------------

test('olio EVOO: $1,1936/100 g dalla fattura GG #20734, classe A', async () => {
  const h = await fresh();
  const oil = await h.ing('Extra Virgin Olive Oil');
  await h.price(oil, { vendor: 'Global Gourmet Foods', pack: '3/5LT', unit_price: 164, conv: 13740, p100: 1.1936,
    date: '2026-06-16', line: { number: '20734', c100: 1.1936 } });
  const r = await h.recipe('Olio 100', { yield_g: 100 }, [{ item: oil, qty: 100, unit: 'g' }]);
  const x = await h.bd(r);
  close(x.totals.A, 1.1936);
  assert.strictEqual(x.status, 'verificato');
  assert.strictEqual(x.lines[0].price.invoice_number, '20734');
});

test('Salt: la stima chef vale solo in assenza di prezzi documentati, classe B', async () => {
  const h = await fresh();
  const salt = await h.ing('Salt');
  await h.price(salt, { vendor: 'STIMA CHEF — prezzo provvisorio, non un acquisto', unit_price: 34.5, p100: 0.138 });
  const r = await h.recipe('Salato', { yield_g: 1000 }, [{ item: salt, qty: 1000, unit: 'g' }]);
  const x = await h.bd(r);
  close(x.totals.B, 1.38); close(x.totals.A, 0);
  assert.strictEqual(x.status, 'con_stime');
});

test('Sea Salt Coarse documentato batte una stima chef sullo stesso ingrediente', async () => {
  const h = await fresh();
  const s = await h.ing('Sea Salt Coarse');
  await h.price(s, { vendor: 'STIMA CHEF', p100: 0.5 });
  await h.price(s, { vendor: 'Global Gourmet Foods', unit_price: 34.5, conv: 25000, p100: 0.138, date: '2026-06-16' });
  const r = await h.recipe('R', { yield_g: 100 }, [{ item: s, qty: 100, unit: 'g' }]);
  const x = await h.bd(r);
  close(x.totals.A, 0.138); assert.strictEqual(x.lines[0].price.vendor, 'Global Gourmet Foods');
});

test('fra prezzi documentati vince il piu\' recente, su TUTTI i fornitori', async () => {
  const h = await fresh();
  const t = await h.ing('Canned Tomatoes');
  await h.price(t, { vendor: 'Global Gourmet Foods', p100: 0.20, date: '2026-06-16' });
  await h.price(t, { vendor: "Hardie's", pack: '6/3 KG', unit_price: 81.71, conv: 18000, p100: 0.45394444, date: '2026-07-17' });
  const r = await h.recipe('Sugo', { yield_g: 1000 }, [{ item: t, qty: 1, unit: 'kg' }]);
  const x = await h.bd(r);
  close(x.totals.A, 4.5394444, 1e-5);
  assert.strictEqual(x.lines[0].price.vendor, "Hardie's");
});

test('un prezzo senza fattura (classe C) non batte uno documentato piu\' vecchio', async () => {
  const h = await fresh();
  const t = await h.ing('X');
  await h.price(t, { vendor: 'Vecchio', p100: 0.10, updated_at: '2026-09-28' });
  await h.price(t, { vendor: 'Documentato', p100: 0.30, date: '2026-05-01' });
  const r = await h.recipe('R', { yield_g: 100 }, [{ item: t, qty: 100, unit: 'g' }]);
  close((await h.bd(r)).totals.A, 0.30);
});

test('prezzo mancante: riga visibile, fuori dal totale, mai zero; get_recipe_cost NULL', async () => {
  const h = await fresh();
  const a = await h.ing('A'); const b = await h.ing('Senza prezzo');
  await h.price(a, { vendor: 'V', p100: 1, date: '2026-09-01' });
  const r = await h.recipe('R', { yield_g: 200 }, [{ item: a, qty: 100, unit: 'g' }, { item: b, qty: 100, unit: 'g' }]);
  const x = await h.bd(r);
  assert.strictEqual(x.status, 'incompleto');
  assert.strictEqual(x.lines[1].status, 'prezzo_mancante');
  assert.strictEqual(x.lines[1].cost, null);
  close(x.totals.known, 1);
  assert.strictEqual(x.cost_per_portion, null);
  assert.strictEqual(await h.one(`select public.get_recipe_cost($1)`, [r]), null);
  assert.ok(x.issues.some(i => i.code === 'prezzo_mancante' && i.component === 'Senza prezzo'));
});

test('conflitto fra prezzo memorizzato e riga fattura: segnalato, non usato', async () => {
  const h = await fresh();
  const s = await h.ing('Spinach');
  await h.price(s, { vendor: "Hardie's", p100: 3.3598, date: '2026-09-18', line: { c100: 0.84 } });
  const r = await h.recipe('R', { yield_g: 100 }, [{ item: s, qty: 100, unit: 'g' }]);
  const x = await h.bd(r);
  assert.strictEqual(x.lines[0].status, 'prezzo_in_conflitto');
  assert.strictEqual(x.lines[0].cost, null);
});

test('conflitto interno pack vs prezzo/100 (caso Guanciale 7x)', async () => {
  const h = await fresh();
  const g = await h.ing('Guanciale');
  await h.price(g, { vendor: 'GG', unit_price: 16.82, conv: 3175, p100: 3.7082, date: '2026-06-16' });
  const r = await h.recipe('R', { yield_g: 100 }, [{ item: g, qty: 100, unit: 'g' }]);
  assert.strictEqual((await h.bd(r)).lines[0].status, 'prezzo_in_conflitto');
});

test('due fornitori, stessa data, prezzi diversi: conflitto', async () => {
  const h = await fresh();
  const g = await h.ing('Y');
  await h.price(g, { vendor: 'V1', p100: 1, date: '2026-09-01' });
  await h.price(g, { vendor: 'V2', p100: 2, date: '2026-09-01' });
  const r = await h.recipe('R', { yield_g: 100 }, [{ item: g, qty: 100, unit: 'g' }]);
  assert.strictEqual((await h.bd(r)).lines[0].status, 'prezzo_in_conflitto');
});

// --- unita' e conversioni ---------------------------------------------------

test('kg, lb, oz convertiti in modo esatto', async () => {
  const h = await fresh();
  const a = await h.ing('A');
  await h.price(a, { vendor: 'V', p100: 1, date: '2026-09-01' });
  const r = await h.recipe('R', { yield_g: 1 }, [
    { item: a, qty: 1, unit: 'kg' }, { item: a, qty: 1, unit: 'lb' }, { item: a, qty: 1, unit: 'oz' }]);
  close((await h.bd(r)).totals.A, 10 + 4.53592 + 0.283495);
});

test('volume su prezzo a peso: conversione mancante finche\' non c\'e\' una densita\' verificata', async () => {
  const h = await fresh();
  const milk = await h.ing('Whole Milk', { category: 'Dairy' });
  await h.price(milk, { vendor: 'V', p100: 0.08, date: '2026-09-17' });
  const r = await h.recipe('R', { yield_g: 100 }, [{ item: milk, qty: 2, unit: 'tbsp' }]);
  let x = await h.bd(r);
  assert.strictEqual(x.lines[0].status, 'conversione_mancante');
  await h.db.query(`insert into food_cost.ingredient_density values ($1, 1.03, 'pesato', 'test')`, [milk]);
  x = await h.bd(r);
  close(x.totals.A, 2 * 14.7868 * 1.03 * 0.0008, 1e-9);
});

test('olio: convenzione chef 1 L = 1 kg (FC02), senza bisogno di righe di densita\'', async () => {
  const h = await fresh();
  const oil = await h.ing('Extra Virgin Olive Oil', { category: 'Oil & Vinegar' });
  const vin = await h.ing('Balsamic Vinegar', { category: 'Oil & Vinegar' });
  await h.price(oil, { vendor: 'GG', unit_price: 164, conv: 15000, p100: 164 / 150, date: '2026-06-16' });
  await h.price(vin, { vendor: 'BEK', p100: 0.5388, date: '2026-09-10' });
  const r = await h.recipe('R', { yield_g: 100 }, [{ item: oil, qty: 2, unit: 'dl' }, { item: vin, qty: 500, unit: 'ml' }]);
  const x = await h.bd(r);
  close(x.lines[0].cost, 200 * 164 / 15000, 1e-9);   // 2 dl = 200 ml = 200 g
  assert.ok(x.lines[0].note.includes('1 L = 1 kg'));
  assert.strictEqual(x.lines[1].status, 'conversione_mancante');   // l'aceto no
  const alerts = (await h.db.query(`select * from food_cost.v_chef_alerts`)).rows;
  assert.ok(alerts.some(a => a.ingrediente === 'Balsamic Vinegar' && a.codice === 'manca_densita'));
  assert.ok(!alerts.some(a => a.ingrediente === 'Extra Virgin Olive Oil'));
});

test('avvisi allo chef: prezzo mancante con il numero di ricette bloccate', async () => {
  const h = await fresh();
  const p = await h.ing('Parsley');
  await h.recipe('A', { yield_g: 1 }, [{ item: p, qty: 5, unit: 'g' }]);
  await h.recipe('B', { yield_g: 1 }, [{ item: p, qty: 5, unit: 'g' }]);
  const a = (await h.db.query(`select * from food_cost.v_chef_alerts where ingrediente = 'Parsley'`)).rows[0];
  assert.strictEqual(a.codice, 'prezzo_mancante');
  assert.strictEqual(Number(a.ricette_bloccate), 2);
  assert.strictEqual(a.messaggio, 'Manca il prezzo di Parsley.');
});

test('pizzico, spicchi, foglio: conversione mancante, mai zero', async () => {
  const h = await fresh();
  const a = await h.ing('A');
  await h.price(a, { vendor: 'V', p100: 1, date: '2026-09-01' });
  const r = await h.recipe('R', { yield_g: 1 }, [{ item: a, qty: 1, unit: 'pizzico' }]);
  const x = await h.bd(r);
  assert.strictEqual(x.lines[0].status, 'conversione_mancante');
  assert.strictEqual(x.complete, false);
});

test('pezzi: prezzo al pezzo si\', peso medio stimato no (serve unit_each_weights)', async () => {
  const h = await fresh();
  const lemon = await h.ing('Lemon'); const egg = await h.ing('Eggs');
  await h.price(lemon, { vendor: 'V', each: 0.49, date: '2026-09-21' });
  await h.price(egg, { vendor: 'V', p100: 0.8, date: '2026-09-21' });
  await h.db.query(`update public.ingredients set avg_unit_weight_g = 50 where id = $1`, [egg]);
  const r = await h.recipe('R', { yield_g: 1 }, [{ item: lemon, qty: 2, unit: 'pz' }, { item: egg, qty: 2, unit: 'each' }]);
  let x = await h.bd(r);
  close(x.lines[0].cost, 0.98);
  assert.strictEqual(x.lines[1].status, 'conversione_mancante');
  await h.db.query(`insert into public.unit_each_weights values ($1, 50, 'pesato')`, [egg]);
  x = await h.bd(r);
  close(x.lines[1].cost, 0.8);
});

// --- sotto-ricette, rese, porzioni ----------------------------------------

test('sotto-ricetta a peso: costo scalato sulla resa dichiarata (base_weight_g)', async () => {
  const h = await fresh();
  const t = await h.ing('Pomodoro');
  await h.price(t, { vendor: 'V', p100: 0.5, date: '2026-09-01' });
  // 4.000 g crudi -> resa 3.000 g: il costo va diviso per la resa, non per il crudo
  const sugo = await h.recipe('Sugo', { yield_g: 3000, base_weight: 4, weight_unit: 'kg' }, [{ item: t, qty: 4000, unit: 'g' }]);
  const piatto = await h.recipe('Piatto', { servings: 1 }, [{ sub: sugo, qty: 150, unit: 'g' }]);
  const x = await h.bd(piatto);
  close(x.totals.A, 20 * 150 / 3000);
  close(x.cost_per_portion, 1);
  const s = await h.bd(sugo);
  assert.ok(s.yield.warnings[0].includes('resa in conflitto'));
});

test('sotto-ricetta senza resa usata a peso: resa_mancante', async () => {
  const h = await fresh();
  const t = await h.ing('T');
  await h.price(t, { vendor: 'V', p100: 1, date: '2026-09-01' });
  const sub = await h.recipe('Sub', {}, [{ item: t, qty: 100, unit: 'g' }]);
  const p = await h.recipe('P', { servings: 1 }, [{ sub, qty: 50, unit: 'g' }]);
  const x = await h.bd(p);
  assert.strictEqual(x.lines[0].status, 'resa_mancante');
  assert.strictEqual(x.complete, false);
});

test('nidi di pasta: validi solo se la sotto-ricetta dichiara porzioni in nidi', async () => {
  const h = await fresh();
  const f = await h.ing('Farina');
  await h.price(f, { vendor: 'V', p100: 0.2, date: '2026-09-01' });
  // FETTUCCINE FRESH PASTA reale: 3.500 g, porzione = 2 nidi = 140 g -> 25 porzioni, 50 nidi
  const pasta = await h.recipe('Pasta', { yield_g: 3500, serving_unit: 'nests', serving_qty: 2, serving_weight_g: 140 }, [{ item: f, qty: 3500, unit: 'g' }]);
  const focaccia = await h.recipe('Focaccia', { servings: 12 }, [{ item: f, qty: 1200, unit: 'g' }]);
  const p = await h.recipe('Piatto', { servings: 1 }, [{ sub: pasta, qty: 2, unit: 'nests' }, { sub: focaccia, qty: 1, unit: 'pz' }]);
  const x = await h.bd(p);
  close(x.lines[0].cost, 7 * 2 / 50);   // 2 nidi su 50
  assert.strictEqual(x.lines[1].status, 'conversione_mancante');
});

test('porzioni in conflitto col testo della resa: niente costo per porzione, niente nidi', async () => {
  const h = await fresh();
  const f = await h.ing('Semola');
  await h.price(f, { vendor: 'V', p100: 0.1, date: '2026-09-01' });
  const sp = await h.recipe('Spaghetti', { yield_g: 3500, serving_unit: 'nests', serving_qty: 2, serving_weight_g: 70 },
    [{ item: f, qty: 3500, unit: 'g' }]);
  await h.db.query(`update public.recipes set yield_text = '20  porzioni' where id = $1`, [sp]);
  const x = await h.bd(sp);
  assert.ok(x.portions.conflict.includes('porzioni in conflitto'));
  assert.strictEqual(x.cost_per_portion, null);
  const p = await h.recipe('Piatto', { servings: 1 }, [{ sub: sp, qty: 2, unit: 'nests' }]);
  assert.strictEqual((await h.bd(p)).lines[0].status, 'conversione_mancante');
});

test('sotto-ricetta circolare (Grated Pecorino contiene se stessa): ciclo, nessuna ricorsione infinita', async () => {
  const h = await fresh();
  const p = await h.ing('Pecorino');
  await h.price(p, { vendor: 'V', p100: 2, date: '2026-09-01' });
  const gp = U();
  await h.recipe('Grated Pecorino', { id: gp, yield_g: 1000 }, [{ item: p, qty: 1000, unit: 'g' }, { sub: gp, qty: 10, unit: 'g' }]);
  const cep = await h.recipe('Cacio e Pepe', { servings: 1 }, [{ sub: gp, qty: 30, unit: 'g' }]);
  const x = await h.bd(cep);
  assert.strictEqual(x.complete, false);
  assert.ok(x.issues.some(i => i.code === 'ciclo' && i.path === 'Cacio e Pepe > Grated Pecorino'));
  close(x.totals.A, 20 * 30 / 1000); // la parte nota resta visibile come parziale
});

test('ciclo indiretto A -> B -> A', async () => {
  const h = await fresh();
  const a = U(), b = U();
  await h.recipe('A', { id: a, yield_g: 100 }, []);
  await h.recipe('B', { id: b, yield_g: 100 }, [{ sub: a, qty: 10, unit: 'g' }]);
  await h.bom(a, { sub: b, qty: 10, unit: 'g' });
  const x = await h.bd(a);
  assert.ok(x.issues.some(i => i.code === 'ciclo'));
});

test('porzioni da resa / peso porzione quando base_servings manca', async () => {
  const h = await fresh();
  const a = await h.ing('A');
  await h.price(a, { vendor: 'V', p100: 1, date: '2026-09-01' });
  const r = await h.recipe('Vinaigrette', { yield_g: 2000, serving_unit: 'g', serving_qty: 74 }, [{ item: a, qty: 2000, unit: 'g' }]);
  const x = await h.bd(r);
  close(x.portions.n, 2000 / 74, 1e-9);
  close(x.cost_per_portion, 20 / (2000 / 74), 1e-9);
});

test('distinta vuota: incompleta, non "verificata a costo zero"', async () => {
  const h = await fresh();
  const r = await h.recipe('Vuota', { servings: 1 }, []);
  const x = await h.bd(r);
  assert.strictEqual(x.status, 'incompleto');
  assert.ok(x.issues.some(i => i.code === 'distinta_vuota'));
});

// --- non alimentari e costo zero dichiarato --------------------------------

test('non alimentare dichiarato: escluso ed elencato; costo zero dichiarato: incluso a 0', async () => {
  const h = await fresh();
  const a = await h.ing('A'); const cup = await h.ing('Alluminium Cups'); const water = await h.ing('Water');
  await h.price(a, { vendor: 'V', p100: 1, date: '2026-09-01' });
  const r = await h.recipe('R', { yield_g: 100 }, [
    { item: a, qty: 100, unit: 'g' }, { item: cup, qty: 12, unit: 'g' }, { item: water, qty: 500, unit: 'g' }]);
  let x = await h.bd(r);
  assert.strictEqual(x.complete, false);
  await h.db.query(`insert into food_cost.ingredient_policy (ingredient_id, policy, reason, confirmed_by) values
    ($1, 'non_food', 'bicchiere', 'test'), ($2, 'zero_cost', 'rubinetto', 'test')`, [cup, water]);
  x = await h.bd(r);
  assert.strictEqual(x.status, 'verificato');
  assert.strictEqual(x.lines[1].status, 'escluso_non_alimentare');
  close(x.totals.known, 1);
});

// --- vista pubblica ---------------------------------------------------------

test('recipes_with_cost: colonne storiche nello stesso ordine + nuove in coda', async () => {
  const h = await fresh();
  const cols = (await h.db.query(`select column_name from information_schema.columns
    where table_schema='public' and table_name='recipes_with_cost' order by ordinal_position`)).rows.map(r => r.column_name);
  assert.deepStrictEqual(cols.slice(0, 15), ['id', 'title', 'category', 'yield_text', 'prep_time_minutes', 'ingredients',
    'procedure', 'equipment', 'created_at', 'image_url', 'base_weight', 'weight_unit', 'base_servings', 'total_cost', 'cost_per_kg']);
  assert.deepStrictEqual(cols.slice(15), ['cost_status', 'known_cost', 'cost_per_portion', 'issue_count', 'chef_validated']);
});

test('get_recipe_cost non legge piu\' items', async () => {
  const h = await fresh();
  const def = await h.one(`select pg_get_functiondef('public.get_recipe_cost(uuid)'::regprocedure)`);
  assert.ok(!/\bitems\b/.test(def));
});

test('costo completo e convalida dello chef sono due cose diverse; la convalida scade se la distinta cambia', async () => {
  const h = await fresh();
  const a = await h.ing('A');
  await h.price(a, { vendor: 'V', p100: 1, date: '2026-09-01' });
  const r = await h.recipe('R', { servings: 1 }, [{ item: a, qty: 100, unit: 'g' }]);
  let x = await h.bd(r);
  assert.strictEqual(x.status, 'verificato');
  assert.strictEqual(x.chef_validation, null);                 // completo, ma nessuno l'ha convalidata
  await h.db.query(`insert into food_cost.recipe_validation (recipe_id, bom_hash, validated_by)
                    values ($1, food_cost.bom_hash($1), 'Max')`, [r]);
  x = await h.bd(r);
  assert.strictEqual(x.chef_validation.validated, true);
  assert.strictEqual(await h.one(`select chef_validated from public.recipes_with_cost where id = $1`, [r]), true);
  await h.db.query(`update public.recipe_bom set quantity = 120 where parent_recipe_id = $1`, [r]);
  x = await h.bd(r);
  assert.strictEqual(x.chef_validation.validated, false);
  assert.strictEqual(x.chef_validation.stale, true);
});

test('prima riga con policy (acqua) in una sessione nuova: nessun errore (trovato dalla prova su PostgreSQL vero)', async () => {
  const h = await fresh();
  const water = await h.ing('Water'); const f = await h.ing('Gnocchi Flour');
  await h.price(f, { vendor: 'Global Gourmet Foods', unit_price: 74.57, conv: 10000, p100: 0.7457, date: '2026-06-16' });
  await h.db.query(`insert into food_cost.ingredient_policy values ($1, 'zero_cost', 'rubinetto', 'test', now())`, [water]);
  const r = await h.recipe('GNOCCHI', { yield_g: 2000, serving_unit: 'g', serving_qty: 200 },
    [{ item: water, qty: 1200, unit: 'g' }, { item: f, qty: 800, unit: 'g' }]);
  const x = await h.bd(r);           // prima chiamata della sessione, prima riga = acqua
  close(x.totals.known, 5.9656, 1e-9);
  close(x.cost_per_portion, 0.59656, 1e-9);
});

test('permessi: anon legge lo STESSO costo del proprietario, ma non puo\' approvare ne\' scrivere', async () => {
  const h = await fresh();
  const a = await h.ing('A'); const water = await h.ing('Water');
  await h.price(a, { vendor: 'V', p100: 1, date: '2026-09-01' });
  await h.db.query(`insert into food_cost.ingredient_policy values ($1, 'zero_cost', 'rubinetto', 'test', now())`, [water]);
  const r = await h.recipe('R', { servings: 1 }, [{ item: a, qty: 100, unit: 'g' }, { item: water, qty: 500, unit: 'g' }]);
  await h.db.exec(`grant select on all tables in schema public to anon; grant execute on function public.get_recipe_cost(uuid) to anon;`);
  const owner = await h.one(`select public.get_recipe_cost($1)`, [r]);
  await h.db.exec(`set role anon`);
  try {
    close(await h.one(`select public.get_recipe_cost($1)`, [r]), owner);   // la policy dell'acqua vale anche per anon
    await assert.rejects(h.db.query(`select food_cost.approve_sheet(gen_random_uuid(), 'x')`), /permission denied/);
    await assert.rejects(h.db.query(`insert into food_cost.ingredient_policy values ($1, 'non_food', 'x', 'x', now())`, [a]), /permission denied|row-level security/);
    await assert.rejects(h.db.query(`select * from food_cost.recipe_validation`), /permission denied/);
  } finally { await h.db.exec(`reset role`); }
});

// --- catering ---------------------------------------------------------------

test('catering: preventivo a prezzi correnti, porzioni per eccesso, 10% una volta sola', async () => {
  const h = await fresh();
  const a = await h.ing('Mascarpone');
  await h.price(a, { vendor: 'V', p100: 1, date: '2026-09-01' });
  const tira = await h.recipe('Tiramisu', { servings: 3 }, [{ item: a, qty: 300, unit: 'g' }]); // $1/porzione
  const ev = U(); await h.db.query(`insert into public.events values ($1, 'Evento')`, [ev]);
  const sheet = await h.one(`insert into food_cost.event_cost_sheets (event_id, kind) values ($1, 'preventivo') returning id`, [ev]);
  await h.db.query(`insert into food_cost.event_cost_lines (sheet_id, recipe_id, portions) values ($1, $2, 8.33)`, [sheet, tira]);
  const c = await h.one(`select food_cost.sheet_cost($1)`, [sheet]);
  assert.strictEqual(Number(c.lines[0].portions_charged), 9);
  close(c.subtotal, 9); close(c.markup, 0.9); close(c.total, 9.9);
  assert.strictEqual(c.priced_with, 'prezzi correnti');
});

test('catering: consuntivo approvato congelato; un aumento del fornitore non lo cambia', async () => {
  const h = await fresh();
  const oil = await h.ing('Olio'); const t = await h.ing('Pomodoro');
  const ivOil = await h.price(oil, { vendor: 'GG', p100: 1.1936, date: '2026-06-16' });
  await h.price(t, { vendor: "Hardie's", p100: 0.4539, date: '2026-07-17' });
  const sugo = await h.recipe('Sugo', { yield_g: 1000 }, [{ item: t, qty: 1000, unit: 'g' }]);
  const piatto = await h.recipe('Piatto', { servings: 10 }, [{ item: oil, qty: 100, unit: 'g' }, { sub: sugo, qty: 1000, unit: 'g' }]);
  const ev = U(); await h.db.query(`insert into public.events values ($1, 'Evento')`, [ev]);
  const sheet = await h.one(`insert into food_cost.event_cost_sheets (event_id, kind) values ($1, 'consuntivo') returning id`, [ev]);
  await h.db.query(`insert into food_cost.event_cost_lines (sheet_id, recipe_id, portions) values ($1, $2, 10)`, [sheet, piatto]);
  const approved = await h.one(`select food_cost.approve_sheet($1, 'Max')`, [sheet]);
  close(approved.subtotal, 1.1936 + 4.539);
  // lo snapshot copre anche l'ingrediente dentro la sotto-ricetta
  assert.strictEqual(Number(await h.one(`select count(*) from food_cost.event_price_snapshot where sheet_id = $1`, [sheet])), 2);

  // il fornitore aumenta l'olio del 50%
  await h.db.query(`update public.ingredient_vendors set price_per_100g = 1.7904, last_invoice_date = '2026-10-01' where id = $1`, [ivOil]);
  const again = await h.one(`select food_cost.sheet_cost($1)`, [sheet]);
  close(again.subtotal, approved.subtotal);
  // il motore live invece vede il prezzo nuovo
  close((await h.bd(piatto)).totals.A, 1.7904 + 4.539);
  // e il costo della ricetta calcolato con lo snapshot resta quello approvato
  close((await h.bd(piatto, sheet)).totals.A, 1.1936 + 4.539);
});

test('catering: un foglio approvato non si puo\' modificare', async () => {
  const h = await fresh();
  const a = await h.ing('A');
  await h.price(a, { vendor: 'V', p100: 1, date: '2026-09-01' });
  const r = await h.recipe('R', { servings: 1 }, [{ item: a, qty: 100, unit: 'g' }]);
  const ev = U(); await h.db.query(`insert into public.events values ($1, 'E')`, [ev]);
  const sheet = await h.one(`insert into food_cost.event_cost_sheets (event_id, kind) values ($1, 'consuntivo') returning id`, [ev]);
  await h.db.query(`insert into food_cost.event_cost_lines (sheet_id, recipe_id, portions) values ($1, $2, 5)`, [sheet, r]);
  await h.one(`select food_cost.approve_sheet($1, 'Max')`, [sheet]);
  for (const sql of [
    `update food_cost.event_cost_lines set portions = 50 where sheet_id = $1`,
    `delete from food_cost.event_price_snapshot where sheet_id = $1`,
    `update food_cost.event_cost_sheets set markup_pct = 0 where id = $1`,
    `insert into food_cost.event_cost_lines (sheet_id, recipe_id, portions) values ($1, '${r}', 1)`,
  ]) {
    await assert.rejects(h.db.query(sql, [sheet]), /approvato/);
  }
});

test('il motore non scrive mai su recipes / recipe_bom', async () => {
  const h = await fresh();
  const a = await h.ing('A');
  await h.price(a, { vendor: 'V', p100: 1, date: '2026-09-01' });
  const r = await h.recipe('R', { servings: 2 }, [{ item: a, qty: 100, unit: 'g' }]);
  const md5 = () => h.one(`select md5((select string_agg(t::text, '|' order by id) from public.recipes t) ||
                                      (select string_agg(b::text, '|' order by bom_id) from public.recipe_bom b))`);
  const before = await md5();
  await h.bd(r); await h.db.query(`select * from public.recipes_with_cost`);
  assert.strictEqual(await md5(), before);
});

(async () => {
  let pass = 0, fail = 0;
  for (const t of tests) {
    try { await t.fn(); pass++; console.log(`  ok  ${t.name}`); }
    catch (e) { fail++; console.log(`  FAIL ${t.name}\n       ${e.message}`); }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
