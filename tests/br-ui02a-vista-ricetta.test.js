// BR-UI02A/B — scheda ricetta PREP | COSTO | STRUTTURA, sola lettura.
// Carica in jsdom i file VERI (utils.js, recipe-modal.js, recipes.js, recipe-view.js) su dati di test
// ricavati dallo snapshot di produzione del 30/09/2026. Il database finto registra ogni scrittura:
// la vista non deve farne nessuna, qualunque cosa si tocchi.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
// risultati VERI di food_cost.recipe_breakdown (FC05) letti in sola lettura dalla produzione il 30/09/2026
// Il fixture contiene prezzi e fornitori veri: resta locale e non va nel repo pubblico. Senza, i test COSTO si saltano.
const FC05_FILE = path.join(__dirname, 'fixtures', 'br-ui02b-fc05.json');
const FC05 = fs.existsSync(FC05_FILE) ? JSON.parse(fs.readFileSync(FC05_FILE, 'utf8')) : null;
const SENZA_FC05 = FC05 ? false : 'fixture FC05 locale (prezzi reali) non presente';
const leggi = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const ID = {
  penneCat: '475959d6-8558-4a97-907c-39d8fdd60181', cacioPiatto: 'f174c32c-4c00-438a-a35a-40e2e1d02e8b',
  sauce: '1d9f9f59-afd6-4e6d-9b7c-dfaf3fac583f', grated: '27213a2e-e8fd-4100-9fb8-4ebf57cfab1e',
  penne: '458e0632-b4e4-41c4-9eca-6675af82df2a', pecRomano: 'b8de7a30-0a13-4e96-89ce-aa47a9c8ad15',
  milk: '1d0b99cb-9d08-48b9-abdf-7fd8e31fff19', butter: 'fdf9aa4d-2bb0-4197-98ce-298fc7c1b52f', gf: 'c9df3d33-b684-4881-aa16-9bc2d17760f3',
};

function datiDiTest() {
  const rec = (id, o) => ({ id, category: '', pos_name: null, equipment: '', image_url: null, photo_url: null, procedure: '',
    menu_group: null, yield_text: '', base_weight: null, ingredients: [], serving_qty: null, weight_unit: 'kg', serving_unit: null,
    base_servings: null, base_weight_g: null, selling_price: null, shelf_life_days: null, serving_weight_g: null,
    prep_time_minutes: null, prep_frequency_days: null, ...o });
  return {
    recipes: [
      // come in produzione oggi: riga 5 kg collegata al PIATTO (1 porzione)
      rec(ID.penneCat, { title: 'PENNE CACIO E PEPE Catering', menu_group: 'Catering', base_servings: 100 }),
      rec(ID.cacioPiatto, { title: 'Cacio e Pepe', menu_group: 'Primi', base_servings: 1, serving_qty: 2, serving_unit: 'nests', pos_name: 'Cacio e Pepe' }),
      rec(ID.sauce, { title: 'CACIO E PEPE SAUCE', menu_group: 'Sauces', yield_text: '6 kg', base_weight: 6, base_weight_g: 6000, shelf_life_days: 9,
        ingredients: [{ qty: 128, name: 'milk', unit: 'oz', comment: 'latte intero' }, { qty: 440, name: 'butter', unit: 'g', comment: 'burro' }] }),
      rec(ID.grated, { title: 'Grated Pecorino', menu_group: 'Bases', base_weight_g: 7000, shelf_life_days: 7, serving_unit: 'g' }),
      // come la proposta CA05 (non applicata in produzione): riga 5 kg sulla SALSA
      rec('penne-proposta', { title: 'PENNE CACIO E PEPE (proposta)', menu_group: 'Catering', base_servings: 100 }),
      // unita' varie, resa solo nel testo, passi con quantita' nel testo
      rec('unita', { title: 'Prova unità', base_servings: 10, yield_text: '10 porzioni', procedure: 'Aggiungi 200 g di burro e cuoci 10 minuti.' }),
      rec('solo-testo', { title: 'Porzioni solo nel testo', yield_text: '10 porzioni' }),
      // BR-UI02C: sotto-ricetta a porzioni, prep collegata, collegamenti mancanti, ricetta scritta diversa
      rec('torta', { title: 'Torta', base_servings: 8 }),
      rec('buffet', { title: 'Buffet dolci', base_servings: 20 }),
      rec('usa-senza-resa', { title: 'Usa senza resa', base_servings: 4 }),
      rec('orfana', { title: 'Ricetta orfana', base_servings: 10 }),
      rec('scritta-diversa', { title: 'Penne scritta diversa', base_servings: 100,
        ingredients: [{ qty: '4', name: 'penne', unit: 'kg', comment: '' }, { qty: '5', name: 'cacio e pepe sauce', unit: 'kg', comment: '' }] }),
      // solo ricetta scritta
      rec('scritta', { title: 'Solo scritta', base_servings: 4, ingredients: [{ type: 'section', name: 'Base' }, { qty: '2', name: 'uova', unit: 'pz', comment: '' }, { qty: '300', name: 'farina', unit: 'g', comment: '' }] }),
      // nessuna resa
      rec('senza-resa', { title: 'Senza resa' }),
    ],
    recipe_bom: [
      { bom_id: 2470, parent_recipe_id: ID.penneCat, component_type: 'ITEM', item_id: ID.penne, sub_recipe_id: null, quantity: 4, unit: 'kg', notes: null, sort_order: 1, prep_task_id: null },
      { bom_id: 2471, parent_recipe_id: ID.penneCat, component_type: 'RECIPE', item_id: null, sub_recipe_id: ID.cacioPiatto, quantity: 5, unit: 'kg', notes: null, sort_order: 2, prep_task_id: null },
      { bom_id: 2472, parent_recipe_id: ID.penneCat, component_type: 'ITEM', item_id: ID.pecRomano, sub_recipe_id: null, quantity: 200, unit: 'g', notes: null, sort_order: 3, prep_task_id: null },
      { bom_id: 1882, parent_recipe_id: ID.sauce, component_type: 'ITEM', item_id: ID.milk, sub_recipe_id: null, quantity: 1, unit: 'gallone', notes: 'latte intero', sort_order: 1, prep_task_id: null },
      { bom_id: 1883, parent_recipe_id: ID.sauce, component_type: 'ITEM', item_id: ID.butter, sub_recipe_id: null, quantity: 440, unit: 'g', notes: 'burro', sort_order: 2, prep_task_id: 77 },
      { bom_id: 1884, parent_recipe_id: ID.sauce, component_type: 'ITEM', item_id: ID.gf, sub_recipe_id: null, quantity: 160, unit: 'g', notes: 'farina gluten free', sort_order: 3, prep_task_id: null },
      { bom_id: 1885, parent_recipe_id: ID.sauce, component_type: 'RECIPE', item_id: null, sub_recipe_id: ID.grated, quantity: 500, unit: 'g', notes: 'pecorino', sort_order: 4, prep_task_id: null },
      { bom_id: 1842, parent_recipe_id: ID.grated, component_type: 'RECIPE', item_id: null, sub_recipe_id: ID.grated, quantity: 7, unit: 'kg', notes: 'pezzo intero ~7kg', sort_order: 1, prep_task_id: null },
      { bom_id: 5001, parent_recipe_id: 'penne-proposta', component_type: 'ITEM', item_id: ID.penne, sub_recipe_id: null, quantity: 4, unit: 'kg', notes: null, sort_order: 1, prep_task_id: null },
      { bom_id: 5002, parent_recipe_id: 'penne-proposta', component_type: 'RECIPE', item_id: null, sub_recipe_id: ID.sauce, quantity: 5, unit: 'kg', notes: null, sort_order: 2, prep_task_id: null },
      { bom_id: 5003, parent_recipe_id: 'penne-proposta', component_type: 'ITEM', item_id: ID.pecRomano, sub_recipe_id: null, quantity: 200, unit: 'g', notes: null, sort_order: 3, prep_task_id: null },
      { bom_id: 6001, parent_recipe_id: 'unita', component_type: 'ITEM', item_id: ID.gf, sub_recipe_id: null, quantity: 1, unit: 'pinch', notes: null, sort_order: 1, prep_task_id: null },
      { bom_id: 6002, parent_recipe_id: 'unita', component_type: 'ITEM', item_id: ID.penne, sub_recipe_id: null, quantity: 3, unit: 'pz', notes: null, sort_order: 2, prep_task_id: null },
      { bom_id: 6003, parent_recipe_id: 'unita', component_type: 'ITEM', item_id: ID.butter, sub_recipe_id: null, quantity: 12, unit: 'oz', notes: null, sort_order: 3, prep_task_id: null },
      { bom_id: 6004, parent_recipe_id: 'unita', component_type: 'ITEM', item_id: ID.milk, sub_recipe_id: null, quantity: 2, unit: 'tazza', notes: null, sort_order: 4, prep_task_id: null },
      { bom_id: 6005, parent_recipe_id: 'unita', component_type: 'RECIPE', item_id: null, sub_recipe_id: ID.sauce, quantity: 1, unit: 'cup', notes: null, sort_order: 5, prep_task_id: null },
      { bom_id: 7101, parent_recipe_id: 'solo-testo', component_type: 'ITEM', item_id: ID.butter, sub_recipe_id: null, quantity: 50, unit: 'g', notes: null, sort_order: 1, prep_task_id: null },
      { bom_id: 8001, parent_recipe_id: 'torta', component_type: 'ITEM', item_id: ID.butter, sub_recipe_id: null, quantity: 100, unit: 'g', notes: null, sort_order: 1, prep_task_id: null },
      { bom_id: 8002, parent_recipe_id: 'buffet', component_type: 'RECIPE', item_id: null, sub_recipe_id: 'torta', quantity: 20, unit: 'porzioni', notes: null, sort_order: 1, prep_task_id: null },
      { bom_id: 8003, parent_recipe_id: 'buffet', component_type: 'ITEM', item_id: ID.butter, sub_recipe_id: null, quantity: 50, unit: 'g', notes: null, sort_order: 2, prep_task_id: 77 },
      { bom_id: 8004, parent_recipe_id: 'usa-senza-resa', component_type: 'RECIPE', item_id: null, sub_recipe_id: 'senza-resa', quantity: 200, unit: 'g', notes: null, sort_order: 1, prep_task_id: null },
      { bom_id: 8005, parent_recipe_id: 'orfana', component_type: 'RECIPE', item_id: null, sub_recipe_id: 'non-esiste', quantity: 1, unit: 'kg', notes: null, sort_order: 1, prep_task_id: null },
      { bom_id: 8006, parent_recipe_id: 'orfana', component_type: 'ITEM', item_id: ID.butter, sub_recipe_id: null, quantity: 30, unit: 'g', notes: null, sort_order: 2, prep_task_id: 999 },
      { bom_id: 8007, parent_recipe_id: 'scritta-diversa', component_type: 'ITEM', item_id: ID.penne, sub_recipe_id: null, quantity: 4, unit: 'kg', notes: null, sort_order: 1, prep_task_id: null },
      { bom_id: 7001, parent_recipe_id: 'senza-resa', component_type: 'ITEM', item_id: ID.butter, sub_recipe_id: null, quantity: 100, unit: 'g', notes: null, sort_order: 1, prep_task_id: null },
    ],
    recipe_steps: [
      { id: 's1', recipe_id: ID.sauce, step_number: 1, title: 'Heat', title_it: 'Scalda latte e burro', title_es: null, instruction_it: 'Scalda 440 g di burro a fuoco basso', instruction_en: null, instruction_es: null, timer_seconds: 90 },
    ],
    ingredients: [
      { id: ID.penne, name: 'Penne', name_it: 'Penne' }, { id: ID.pecRomano, name: 'Pecorino Romano', name_it: 'Pecorino Romano' },
      { id: ID.milk, name: 'Milk', name_it: 'Latte intero' }, { id: ID.butter, name: 'Butter', name_it: 'Burro' }, { id: ID.gf, name: 'Gluten Free Flour', name_it: 'Farina senza glutine' },
    ],
    recipe_translations: [],
    prep_tasks: [{ id: 77, name: 'Burro a cubetti' }],
  };
}
function conFc05(db) {
  if (!FC05) return db;
  db.recipes.push(...FC05.recipes.map(r => ({ ingredients: [], ...r })));
  db.recipe_bom.push(...FC05.recipe_bom);
  db.ingredients.push(...FC05.ingredients);
  db._fc05 = FC05.breakdown;
  db._costMode = 'ok';
  return db;
}

// Supabase finto: le select funzionano, OGNI altra operazione viene registrata come scrittura.
function fakeSb(db, log) {
  const rows = t => db[t] || (db[t] = []);
  function embed(t, cols, r) {
    const o = { ...r };
    if (t === 'recipe_bom' && /ingredients\(/.test(cols || '')) { const i = rows('ingredients').find(x => x.id === r.item_id); o.ingredients = i ? { name: i.name, name_it: i.name_it || null, name_es: null } : null; }
    if (t === 'recipe_bom' && /recipes!/.test(cols || '')) { const s = rows('recipes').find(x => x.id === r.sub_recipe_id);
      o.recipes = s ? { id: s.id, title: s.title, base_servings: s.base_servings, base_weight_g: s.base_weight_g, base_weight: s.base_weight, weight_unit: s.weight_unit,
        serving_weight_g: s.serving_weight_g, serving_qty: s.serving_qty, serving_unit: s.serving_unit, yield_text: s.yield_text } : null; }
    return o;
  }
  function q(t, mode, payload) {
    const f = []; const ord = []; let cols = null;
    const pass = r => f.every(([op, k, v]) => op === 'eq' ? r[k] === v : op === 'in' ? v.includes(r[k]) : op === 'not' ? r[k] !== null : true);
    function run() {
      if (mode !== 'select') { log.writes.push({ t, op: mode, payload }); return { data: null, error: null }; }
      if (db._failSelect === t) return { data: null, error: { message: 'errore simulato' } };
      if (t === 'recipes_with_cost') {   // la vista pubblica gia' esistente: solo il riepilogo di FC05
        return { data: rows('recipes').filter(pass).map(r => { const b = (db._fc05 || {})[r.id]; if (!b) return null; const s = b.semaforo || {};
          return { known_cost: b.totals.known, total_cost: b.complete ? b.totals.known : null, cost_per_portion: b.cost_per_portion, cost_status: b.status,
            semaforo: s.colore, issue_count: (b.issues || []).length, costo_stimato: s.costo_stimato, costo_stimato_porzione: s.costo_porzione, parte_stimata: s.parte_stimata }; }).filter(Boolean), error: null };
      }
      let r = rows(t).filter(pass).map(x => embed(t, cols, x));
      if (ord.length) r.sort((a, b) => { for (const [k] of ord) { if (a[k] === b[k]) continue; return a[k] < b[k] ? -1 : 1; } return 0; });
      return { data: JSON.parse(JSON.stringify(r)), error: null };
    }
    const self = {
      select(c) { cols = c; return self; }, eq(k, v) { f.push(['eq', k, v]); return self; }, neq() { return self; }, in(k, v) { f.push(['in', k, v]); return self; },
      ilike() { return self; }, not(k) { f.push(['not', k]); return self; }, order(k) { ord.push([k]); return self; }, limit() { return self; },
      async maybeSingle() { const r = run(); return { data: r.data && r.data[0] ? r.data[0] : null, error: r.error }; },
      async single() { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] : r.data, error: r.error }; },
      then(a, b) { return Promise.resolve(run()).then(a, b); },
    };
    return self;
  }
  return {
    from: t => ({ select: c => q(t, 'select').select(c), update: d => q(t, 'update', d), insert: d => q(t, 'insert', d),
      upsert: d => q(t, 'upsert', d), delete: () => q(t, 'delete') }),
    storage: { from: () => ({ upload: async () => { log.writes.push({ t: 'storage', op: 'upload' }); return {}; } }) },
    rpc: async (n, args) => {
      if (n !== 'fc_costo_ricetta') { log.writes.push({ t: 'rpc', op: n }); return { data: null, error: null }; }
      log.costCalls.push(args);                      // funzione di sola lettura (STABLE): non e' una scrittura
      const m = db._costMode || 'missing';
      if (m === 'missing') return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.fc_costo_ricetta(p_recipe_id, p_token) in the schema cache' } };
      if (m === 'network') return { data: null, error: { message: 'Failed to fetch' } };
      if (m !== 'ok') return { data: { ok: false, error: m }, error: null };
      const b = (db._fc05 || {})[args.p_recipe_id];
      return { data: b ? { ok: true, breakdown: JSON.parse(JSON.stringify(b)) } : { ok: false, error: 'recipe_required' }, error: null };
    },
  };
}

function app({ flag = true, lang = 'it', admin = true, fc05 = false } = {}) {
  const dom = new JSDOM('<!doctype html><head></head><body><div id="recipeGrid"></div></body>', { runScripts: 'dangerously', url: 'https://brigade.test/', pretendToBeVisual: true });
  const w = dom.window;
  const db = fc05 ? conFc05(datiDiTest()) : datiDiTest();
  const log = { writes: [], costCalls: [] };
  w.supabase = { createClient: () => fakeSb(db, log) };
  w.alert = () => {}; w.confirm = () => false;
  w.fetch = async () => { log.writes.push({ t: 'fetch' }); return { json: async () => ({}) }; };
  if (flag) w.localStorage.setItem('brigade_ricetta_v2', '1');
  w.localStorage.setItem('brigade_token', 'a'.repeat(64));
  const carica = src => { const el = w.document.createElement('script'); el.textContent = src; w.document.body.appendChild(el); };
  carica(leggi('js/utils.js'));
  carica(leggi('js/recipe-modal.js'));
  carica(leggi('js/recipes.js'));
  carica(leggi('js/recipe-view.js'));
  carica(`user = { id: 1, name: 'Max', is_admin: ${admin}, role: '${admin ? 'admin' : 'cook'}', lang: ${JSON.stringify(lang)} }; window.user = user;
    var SHOP_RECIPES = ${JSON.stringify(db.recipes)};
    window.init = async () => {}; window.renderRecipes = () => {}; window.showScToast = m => window.__toast = m;`);
  return { w, doc: w.document, db, log };
}
const pausa = (ms = 15) => new Promise(r => setTimeout(r, ms));
async function finche(cond, ms = 3000) { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await pausa(10); } }
function scrivi(w, el, v) { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); }
// righe della scheda PREP come "nome = quantita'"
const righe = doc => [...doc.querySelectorAll('#rvView .rv-card .rv-it')].map(r => {
  const n = r.querySelector('.rv-grow').childNodes[0].textContent.trim();
  const v = r.querySelector('.rv-v').childNodes[0].textContent.trim();
  return n + ' = ' + v;
});
const snap = db => JSON.stringify({ r: db.recipes, b: db.recipe_bom, s: db.recipe_steps });
async function apri(a, id) { a.w.recipeView.open(id); await finche(() => a.doc.querySelector('#rvView .rv-card')); }

test('A — apertura: intestazione compatta, tre modalità, porzioni della ricetta', async () => {
  const a = app();
  await apri(a, ID.penneCat);
  assert.strictEqual(a.doc.querySelector('.rv-title h1').textContent, 'PENNE CACIO E PEPE Catering');
  assert.match(a.doc.querySelector('.rv-title span').textContent, /Catering · ricetta da 100 porzioni/);
  assert.deepStrictEqual([...a.doc.querySelectorAll('[role="tab"]')].map(b => b.textContent.trim()), ['PREP', 'COSTO', 'STRUTTURA']);
  assert.strictEqual(a.doc.querySelector('[data-tab="prep"]').getAttribute('aria-selected'), 'true');
  assert.strictEqual(a.doc.querySelector('#rvAmount').value, '100');
  assert.strictEqual(a.doc.querySelector('#rvSub').textContent, 'originale');
  assert.deepStrictEqual(righe(a.doc), ['Penne = 4 kg', 'Cacio e Pepe = 5 kg', 'Pecorino Romano = 200 g']);
  assert.deepStrictEqual(a.log.writes, []);
});

test('B — 100 → 40 → 30 porzioni: cambio immediato, ricetta originale intatta, zero scritture', async () => {
  const a = app();
  const prima = snap(a.db);
  await apri(a, ID.penneCat);
  const inp = a.doc.querySelector('#rvAmount');
  scrivi(a.w, inp, '40');
  assert.deepStrictEqual(righe(a.doc), ['Penne = 1,6 kg', 'Cacio e Pepe = 2 kg', 'Pecorino Romano = 80 g']);
  assert.match(a.doc.querySelector('#rvView h2').textContent, /40 porzioni/);
  scrivi(a.w, inp, '30');
  assert.deepStrictEqual(righe(a.doc), ['Penne = 1,2 kg', 'Cacio e Pepe = 1,5 kg', 'Pecorino Romano = 60 g']);
  // lo slider fa lo stesso
  scrivi(a.w, a.doc.querySelector('#rvRange'), '100');
  assert.deepStrictEqual(righe(a.doc), ['Penne = 4 kg', 'Cacio e Pepe = 5 kg', 'Pecorino Romano = 200 g']);
  assert.strictEqual(a.doc.querySelector('#rvAmount').value, '100');
  // il campo resta lo stesso elemento (niente ridisegno che toglie il fuoco mentre si scrive)
  assert.strictEqual(a.doc.querySelector('#rvAmount'), inp);
  assert.strictEqual(snap(a.db), prima);
  assert.deepStrictEqual(a.log.writes, []);
});

test('C — valori non validi: la vista resta sull\'ultimo valore buono', async () => {
  const a = app();
  await apri(a, ID.penneCat);
  const inp = a.doc.querySelector('#rvAmount');
  scrivi(a.w, inp, '40');
  for (const x of ['', '0', '-5', 'abc']) scrivi(a.w, inp, x);
  assert.deepStrictEqual(righe(a.doc), ['Penne = 1,6 kg', 'Cacio e Pepe = 2 kg', 'Pecorino Romano = 80 g']);
  inp.dispatchEvent(new a.w.Event('blur'));
  assert.strictEqual(inp.value, '40');
});

test('D — sotto-ricetta convertibile: si apre alla quantità che serve, indietro torna alle porzioni scelte', async () => {
  const a = app();
  await apri(a, 'penne-proposta');
  scrivi(a.w, a.doc.querySelector('#rvAmount'), '40');
  const link = a.doc.querySelector('[data-sub]');
  assert.strictEqual(link.tagName, 'BUTTON');
  assert.match(link.textContent, /CACIO E PEPE SAUCE.*preparazione/);
  link.click();
  await finche(() => a.doc.querySelector('.rv-title h1')?.textContent === 'CACIO E PEPE SAUCE');
  // 5 kg x 0,4 = 2 kg di salsa, su un lotto da 6 kg
  assert.strictEqual(a.doc.querySelector('#rvAmount').value, '2');
  assert.match(a.doc.querySelector('.rv-title span').textContent, /dentro PENNE CACIO E PEPE \(proposta\)/);
  assert.deepStrictEqual(righe(a.doc), ['Latte intero = 0,33 gallone', 'Burro = 147 g', 'Farina senza glutine = 53 g', 'Grated Pecorino = 167 g']);
  // i passi scalano le quantita' scritte nel testo e mostrano il timer
  assert.match(a.doc.querySelector('.rv-steps').textContent, /Scalda 147 g di burro/);
  assert.match(a.doc.querySelector('.rv-steps').textContent, /⏱ 1:30/);
  // un altro livello: pecorino grattugiato
  a.doc.querySelector('[data-sub]').click();
  await finche(() => a.doc.querySelector('.rv-title h1')?.textContent === 'Grated Pecorino');
  assert.strictEqual(a.doc.querySelector('#rvAmount').value, '0,17');
  a.doc.querySelector('#rvBack').click();
  assert.strictEqual(a.doc.querySelector('.rv-title h1').textContent, 'CACIO E PEPE SAUCE');
  a.doc.querySelector('#rvBack').click();
  assert.strictEqual(a.doc.querySelector('.rv-title h1').textContent, 'PENNE CACIO E PEPE (proposta)');
  assert.strictEqual(a.doc.querySelector('#rvAmount').value, '40');
  assert.deepStrictEqual(righe(a.doc), ['Penne = 1,6 kg', 'CACIO E PEPE SAUCE = 2 kg', 'Pecorino Romano = 80 g']);
  a.doc.querySelector('#rvBack').click();
  assert.strictEqual(a.doc.querySelector('#rvOverlay'), null);
  assert.deepStrictEqual(a.log.writes, []);
});

test('E — sotto-ricetta NON convertibile (penne di oggi: 5 kg del piatto da 1 porzione): segnalata, mai inventata', async () => {
  const a = app();
  await apri(a, ID.penneCat);
  const link = a.doc.querySelector('[data-sub]');
  assert.match(link.textContent, /quantità non convertibile: in kg, resa della sotto-ricetta: 1 porzione/);
  link.click();
  await finche(() => a.doc.querySelector('.rv-title h1')?.textContent === 'Cacio e Pepe');
  assert.strictEqual(a.doc.querySelector('#rvAmount').value, '1');
  assert.match(a.doc.querySelector('.rv-note.bad').textContent, /servono 5 kg, ma la quantità non si converte.*Mostro la ricetta alla sua resa/);
});

test('F — unità e arrotondamenti; non convertibili segnalate', async () => {
  const a = app();
  await apri(a, 'unita');
  scrivi(a.w, a.doc.querySelector('#rvAmount'), '25');   // x2,5
  const t = a.doc.querySelector('#rvView').textContent;
  assert.deepStrictEqual(righe(a.doc), ['Farina senza glutine = 1 pinch', 'Penne = 8 pz', 'Burro = 1,88 lb', 'Latte intero = 5 tazza', 'CACIO E PEPE SAUCE = 2,5 cup']);
  assert.match(t, /non scalata/);                          // pizzico
  assert.match(t, /per eccesso da 7,5/);                   // pezzi
  assert.match(t, /unità non convertibile: solo moltiplicata/); // "tazza" sconosciuta
  assert.match(t, /in cup ma la resa è in peso .*serve la densità/); // salsa in volume
  assert.match(t, /Aggiungi 500 g di burro/);              // procedura scritta scalata
  const s = a.w.recipeView._.scaleQty;
  assert.strictEqual(s(999.6, 'g', 1).text, '1 kg');
  assert.strictEqual(s(4, 'oz', 0.5).text, '2 oz');
  assert.strictEqual(s(0.5, 'lb', 0.25).text, '2 oz');
  assert.strictEqual(s(1500, 'ml', 1).text, '1,5 l');
  assert.strictEqual(s(2, 'mg', 1).text, '2 mg');
  assert.strictEqual(s(null, 'g', 2).text, '—');
  // porzioni solo nel testo della resa: FC05 non le usa, la scheda nemmeno (lotti), e lo dice
  a.w.recipeView.close();
  await apri(a, 'solo-testo');
  assert.match(a.doc.querySelector('label[for="rvAmount"]').textContent, /Lotti/);
  assert.match(a.doc.querySelector('.rv-note').textContent, /Il testo della resa dice "10 porzioni".*FC05 non lo usa/);
});

test('G — solo ricetta scritta e ricetta senza resa', async () => {
  const a = app();
  await apri(a, 'scritta');
  scrivi(a.w, a.doc.querySelector('#rvAmount'), '6');
  assert.match(a.doc.querySelector('#rvView').textContent, /Solo ricetta scritta/);
  assert.deepStrictEqual(righe(a.doc), ['uova = 3 pz', 'farina = 450 g']);
  a.w.recipeView.close();
  await apri(a, 'senza-resa');
  assert.match(a.doc.querySelector('.rv-note').textContent, /non ha una resa registrata/);
  assert.match(a.doc.querySelector('label[for="rvAmount"]').textContent, /Lotti/);
  scrivi(a.w, a.doc.querySelector('#rvAmount'), '2');
  assert.deepStrictEqual(righe(a.doc), ['Burro = 200 g']);
});

test('H — errore di lettura della distinta: avviso, nessuna lista vuota spacciata per vera', async () => {
  const a = app();
  a.db._failSelect = 'recipe_bom';
  a.w.recipeView.open(ID.penneCat);
  await finche(() => a.doc.querySelector('#rvView .rv-note.bad'));
  assert.match(a.doc.querySelector('#rvView').textContent, /Non riesco a leggere gli ingredienti/);
  assert.strictEqual(a.doc.querySelectorAll('#rvView .rv-it').length, 0);
});

test('I — STRUTTURA: solo struttura; le porzioni restano passando da una modalità all\'altra', async () => {
  const a = app();
  await apri(a, ID.penneCat);
  a.doc.querySelector('[data-tab="struct"]').click();
  assert.doesNotMatch(a.doc.querySelector('#rvView').textContent, /\$/);
  await finche(() => /Da preparare/.test(a.doc.querySelector('#rvView').textContent) && !/Controllo le/.test(a.doc.querySelector('#rvView').textContent));
  // le porzioni restano quelle scelte passando da una modalita' all'altra
  scrivi(a.w, a.doc.querySelector('#rvAmount'), '40');
  a.doc.querySelector('[data-tab="prep"]').click();
  assert.deepStrictEqual(righe(a.doc), ['Penne = 1,6 kg', 'Cacio e Pepe = 2 kg', 'Pecorino Romano = 80 g']);
});

test('J — Modifica apre l\'editor v870 e non passa le porzioni scalate', async () => {
  const a = app();
  await apri(a, ID.penneCat);
  scrivi(a.w, a.doc.querySelector('#rvAmount'), '30');
  a.doc.querySelector('#rvEdit').click();
  assert.strictEqual(a.doc.querySelector('#rvOverlay'), null);
  await finche(() => a.doc.querySelectorAll('#ingList [data-type="ingredient"]').length === 3);
  const q = [...a.doc.querySelectorAll('#ingList [data-type="ingredient"]')].map(r => r.querySelector('.ing-name-input').value + ' ' + r.querySelector('input[type="number"]').value);
  assert.deepStrictEqual(q, ['Penne 4', 'Cacio e Pepe 5', 'Pecorino Romano 200']);
  assert.deepStrictEqual(a.log.writes, []);
});

test('K — interruttore: spento = vecchia scheda come prima, acceso = nuova scheda senza traduzioni salvate', async () => {
  const off = app({ flag: false });
  let vecchia = null;
  off.w.recipeModal.open = id => { vecchia = id; };
  await off.w.openRecipeByData(0);
  assert.strictEqual(vecchia, ID.penneCat);
  assert.strictEqual(off.doc.querySelector('#rvOverlay'), null);
  // acceso, utente inglese: la vecchia strada salverebbe una traduzione (upsert); la nuova non scrive
  const on = app({ lang: 'en' });
  on.w.recipeModal.open = () => { throw new Error('non deve aprire la vecchia scheda'); };
  await on.w.openRecipeByData(0);
  await finche(() => on.doc.querySelector('#rvView .rv-card'));
  assert.deepStrictEqual(on.log.writes, []);
});

test('L — il codice della vista non contiene scritture', () => {
  const src = leggi('js/recipe-view.js').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/ [^'`\n]*$/gm, '');
  assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\s*\(/);
  assert.deepStrictEqual([...src.matchAll(/\.rpc\(\s*'([^']+)'/g)].map(m => m[1]), ['fc_costo_ricetta'], 'unica funzione chiamata: la lettura protetta dei costi');
  assert.doesNotMatch(src, /fetch\s*\(/);
  assert.doesNotMatch(src, /sheet_cost|price_for|cost_per_base|stima_riga/, 'nessun pezzo del motore rifatto qui: FC05 resta l\'unico motore');
  assert.doesNotMatch(src, /\*\s*1\.1\b|\*\s*1\.10\b|1\.1\s*\*|\*\s*0\.1\b/, 'nessuna maggiorazione del 10% nella scheda ricetta');
});

test('M — misure da iPhone: bersagli da almeno 44 px', () => {
  const src = leggi('js/recipe-view.js');
  const px = (sel, prop) => { const m = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{[^}]*?' + prop + ':(\\d+)px').exec(src); return m ? +m[1] : 0; };
  assert.ok(px('.rv-round', 'width') >= 44 && px('.rv-round', 'height') >= 44, 'indietro/chiudi');
  assert.ok(px('.rv-seg button', 'height') >= 44, 'PREP | COSTO | STRUTTURA');
  assert.ok(px('.rv-prow input#rvAmount', 'height') >= 44, 'campo porzioni');
  assert.ok(px('.rv-por input[type=range]', 'height') >= 44, 'slider porzioni');
  assert.ok(px('.rv-it', 'min-height') >= 44, 'righe sotto-ricetta');
  assert.match(src, /safe-area-inset-bottom/);
  assert.match(src, /inputmode="decimal"/);
});

// ── BR-UI02B — COSTO, sui risultati veri di FC05 ─────────────────────────────
const CHEESECAKE = 'c58bfd1c-0738-45db-820b-dd65e863aa1e', BURRO = '02240420-efe1-4e6d-8708-f233d10c9ed1';
async function apriCosto(a, id) {
  await apri(a, id);
  a.doc.querySelector('[data-tab="cost"]').click();
  await finche(() => a.doc.querySelector('#rvView .rv-state, #rvView .rv-note, #rvView .rv-soon b'));
}
// testo come lo legge l'occhio: un blocco = una parola separata
const testo = el => el ? el.innerHTML.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : '';
const verdetto = doc => testo(doc.querySelector('#rvView .rv-state'));
const costi = doc => [...doc.querySelectorAll('#rvView h2 + .rv-card .rv-it')].filter(r => r.closest('.rv-card').previousElementSibling.textContent.startsWith('Da dove'))
  .map(r => r.querySelector('.rv-grow').childNodes[0].textContent.trim() + ' = ' + r.querySelector('.rv-v').childNodes[0].textContent.trim());
const problemi = doc => [...doc.querySelectorAll('#rvView .rv-issue b')].map(b => b.textContent);

test('N — COSTO Penne (FC05 vero): costo non affidabile, collegamento errato e problemi documentati; niente $0', { skip: SENZA_FC05 }, async () => {
  const a = app({ fc05: true });
  await apriCosto(a, ID.penneCat);
  const v = verdetto(a.doc);
  assert.match(v, /Costo non affidabile/);
  assert.match(v, /Costo noto, parziale · 100 porzioni \$16,20/);
  assert.match(v, /A porzione non calcolabile/);
  assert.match(v, /non usarlo per preventivi/);
  assert.match(v, /Maggiorazione catering del 10% esclusa/);            // mai applicata qui
  assert.doesNotMatch(a.doc.querySelector('#rvView').textContent, /\$0[,.]00|\$17,8/);  // niente $0, niente 16,20 x 1,1
  const p = problemi(a.doc);
  assert.strictEqual(p[0], 'Collegamento da verificare: «Cacio e Pepe»');
  assert.match(a.doc.querySelector('#rvView .rv-issue span').textContent, /usata in kg .* la sua resa è 1 porzione\. Cercavi una salsa o una base\?/);
  assert.ok(p.includes('La ricetta contiene se stessa'), 'pecorino grattugiato in ciclo');
  assert.ok(p.includes('Porzioni in conflitto') && p.includes('Resa non dichiarata'));
  assert.ok(!p.includes('La sotto-ricetta non dichiara la resa'), 'la riga sbagliata compare una volta sola, come collegamento da verificare');
  assert.strictEqual(p.length, 7);
  assert.match(a.doc.querySelector('#rvView').textContent, /in Cacio e Pepe > Grated Pecorino/);
  assert.deepStrictEqual(costi(a.doc), ['Penne · 4 kg = $11,41', 'Cacio e Pepe · 5 kg = ?', 'Pecorino Romano · 200 g = $4,78']);
  const righe = [...a.doc.querySelectorAll('#rvView .rv-it')].map(r => r.textContent.replace(/\s+/g, ' '));
  assert.ok(righe.some(t => /\$0,2853 \/ 100 g · Ben E\. Keith · 10\/09\/26\s*fattura/.test(t)), 'prezzo unitario, fornitore, data, classe');
  assert.ok(righe.some(t => /Cacio e Pepe.*La sotto-ricetta non dichiara la resa.*sconosciuto/.test(t)));
  assert.strictEqual(a.log.costCalls.length, 1);
  assert.strictEqual(a.log.costCalls[0].p_token.length, 64);
  assert.deepStrictEqual(a.log.writes, []);
});

test('O — COSTO 100 → 40 → 30 porzioni: cambio immediato, FC05 letto una volta sola, zero scritture', { skip: SENZA_FC05 }, async () => {
  const a = app({ fc05: true });
  const prima = snap(a.db);
  await apriCosto(a, ID.penneCat);
  const inp = a.doc.querySelector('#rvAmount');
  scrivi(a.w, inp, '40');
  assert.match(verdetto(a.doc), /Costo noto, parziale · 40 porzioni \$6,48/);
  assert.deepStrictEqual(costi(a.doc), ['Penne · 1,6 kg = $4,56', 'Cacio e Pepe · 2 kg = ?', 'Pecorino Romano · 80 g = $1,91']);
  scrivi(a.w, inp, '30');
  assert.match(verdetto(a.doc), /Costo noto, parziale · 30 porzioni \$4,86/);
  assert.deepStrictEqual(costi(a.doc), ['Penne · 1,2 kg = $3,42', 'Cacio e Pepe · 1,5 kg = ?', 'Pecorino Romano · 60 g = $1,44']);
  assert.strictEqual(a.log.costCalls.length, 1);
  assert.strictEqual(snap(a.db), prima);
  assert.deepStrictEqual(a.log.writes, []);
});

test('P — COSTO GIALLO (Cheesecake): totale dichiarato stimato, prezzo mancante con stima, a porzione di FC05', { skip: SENZA_FC05 }, async () => {
  const a = app({ fc05: true });
  await apriCosto(a, CHEESECAKE);
  const v = verdetto(a.doc);
  assert.match(v, /Costo utilizzabile, con una parte stimata/);
  assert.match(v, /Totale stimato · 24 porzioni \$20,63/);
  assert.match(v, /A porzione \(stima\) \$0,86/);
  assert.match(v, /Parte stimata: \$0,30/);
  assert.doesNotMatch(v, /Maggiorazione catering/);
  const t = a.doc.querySelector('#rvView').textContent;
  assert.match(t, /Honey · 50 g.*Prezzo mancante.*~\$0,30\s*stima/s);
  scrivi(a.w, a.doc.querySelector('#rvAmount'), '12');
  assert.match(verdetto(a.doc), /Totale stimato · 12 porzioni \$10,32.*A porzione \(stima\) \$0,86/);
});

test('Q — COSTO VERDE (Diced Butter): costo affidabile, porzioni con la stessa regola di FC05', { skip: SENZA_FC05 }, async () => {
  const a = app({ fc05: true });
  await apriCosto(a, BURRO);
  assert.match(a.doc.querySelector('.rv-title span').textContent, /ricetta da 19,7 porzioni/);  // 454 g / 23 g, come FC05
  const v = verdetto(a.doc);
  assert.match(v, /Costo affidabile/);
  assert.match(v, /Totale · 19,7 porzioni \$2,39/);
  assert.match(v, /A porzione \$0,12/);
  assert.match(v, /Tutti i prezzi vengono da fatture/);
});

test('R — sotto-ricetta aperta da COSTO: resta in COSTO, avviso di conversione, costi della sotto-ricetta', { skip: SENZA_FC05 }, async () => {
  const a = app({ fc05: true });
  await apriCosto(a, ID.penneCat);
  a.doc.querySelector('#rvView [data-sub]').click();
  await finche(() => a.doc.querySelector('.rv-title h1')?.textContent === 'Cacio e Pepe' && a.doc.querySelector('#rvView .rv-state'));
  assert.strictEqual(a.doc.querySelector('[data-tab="cost"]').getAttribute('aria-selected'), 'true');
  assert.match(a.doc.querySelector('#rvNotes').textContent, /servono 5 kg, ma la quantità non si converte/);
  assert.match(verdetto(a.doc), /Costo non affidabile/);
  assert.deepStrictEqual(a.log.costCalls.map(c => c.p_recipe_id), [ID.penneCat, ID.cacioPiatto]);
  a.doc.querySelector('#rvBack').click();
  assert.match(verdetto(a.doc), /100 porzioni \$16,20/);
  assert.strictEqual(a.log.costCalls.length, 2, 'tornando indietro non rilegge');
});

test('S — funzione protetta assente, accesso negato, errore: mai numeri inventati', { skip: SENZA_FC05 }, async () => {
  // funzione non installata: riepilogo gia' pubblico di FC05, con il limite dichiarato
  const a = app({ fc05: true }); a.db._costMode = 'missing';
  await apriCosto(a, ID.penneCat);
  assert.match(verdetto(a.doc), /Costo non affidabile.*Costo noto, parziale · 100 porzioni \$16,20.*non calcolabile/);
  assert.match(a.doc.querySelector('#rvView').textContent, /FC05 segnala 7 problemi.*Dettaglio per ingrediente non disponibile.*fc_costo_ricetta/s);
  // non amministratore: nessun costo, neanche il riepilogo
  const c = app({ fc05: true, admin: false }); c.db._costMode = 'missing';
  await apriCosto(c, ID.penneCat);
  assert.match(c.doc.querySelector('#rvView').textContent, /Costi riservati/);
  assert.doesNotMatch(c.doc.querySelector('#rvView').textContent, /\$/);
  for (const [mode, re] of [['unauthorized', /Costi riservati/], ['invalid_session', /Sessione scaduta/], ['network', /Non riesco a leggere i costi/]]) {
    const x = app({ fc05: true }); x.db._costMode = mode;
    await apriCosto(x, ID.penneCat);
    assert.match(x.doc.querySelector('#rvView').textContent, re, mode);
    assert.doesNotMatch(x.doc.querySelector('#rvView').textContent, /\$/, mode);
  }
});

test('T — costo sconosciuto non diventa $0 (Grated Pecorino: nessun prezzo noto, ricetta in ciclo)', { skip: SENZA_FC05 }, async () => {
  const a = app({ fc05: true });
  await apriCosto(a, ID.grated);
  const v = verdetto(a.doc);
  assert.match(v, /Costo non affidabile/);
  assert.match(v, /Costo noto, parziale · 7 kg nessun prezzo noto/);
  assert.doesNotMatch(a.doc.querySelector('#rvView').textContent, /\$0[,.]00/);
  assert.ok(problemi(a.doc).includes('La ricetta contiene se stessa'));
});

test('U — layout del primo mockup: modalità in alto sotto porzioni, cappello blu su PREP, un solo COSTO', async () => {
  const a = app({ fc05: true });
  await apri(a, ID.penneCat);
  const head = a.doc.querySelector('.rv-head');
  assert.ok(head && head.contains(a.doc.querySelector('#rvAmount')) && head.contains(a.doc.querySelector('.rv-seg')), 'porzioni e modalità nell\'intestazione');
  assert.ok(a.doc.querySelector('.rv-por').compareDocumentPosition(a.doc.querySelector('.rv-seg')) & a.w.Node.DOCUMENT_POSITION_FOLLOWING, 'modalità sotto le porzioni');
  assert.ok(a.doc.querySelector('.rv-head').compareDocumentPosition(a.doc.querySelector('#rvView')) & a.w.Node.DOCUMENT_POSITION_FOLLOWING, 'contenuto sotto l\'intestazione');
  assert.deepStrictEqual([...a.doc.querySelectorAll('[role="tab"]')].map(b => b.textContent.trim()), ['PREP', 'COSTO', 'STRUTTURA']);
  assert.ok(a.doc.querySelector('[data-tab="prep"] svg.rv-hat'), 'cappello da chef su PREP');
  assert.match(leggi('js/recipe-view.js'), /\.rv-seg \.rv-hat\{color:var\(--accent\)\}/, 'cappello sempre blu');
  assert.match(leggi('js/recipe-view.js'), /\.rv-head\{position:sticky;top:0/, 'intestazione ferma mentre si scorre');
  assert.strictEqual([...a.doc.querySelectorAll('#rvOverlay button')].filter(b => /COSTO/i.test(b.textContent)).length, 1, 'un solo pulsante COSTO');
  assert.strictEqual(a.doc.querySelector('.rv-dock, .rv-tabbar'), null, 'nessuna barra in basso');
  assert.strictEqual(a.doc.querySelectorAll('#rvView table').length, 0);
});

// ── BR-UI02C — STRUTTURA e intestazione compatta ─────────────────────────────
async function apriStruttura(a, id) {
  await apri(a, id);
  a.doc.querySelector('[data-tab="struct"]').click();
  await finche(() => !/Controllo le sotto-preparazioni/.test(a.doc.querySelector('#rvView').textContent));
}
const blocco = (doc, titolo) => { const h = [...doc.querySelectorAll('#rvView h2')].find(x => x.textContent.startsWith(titolo)); return h ? h.nextElementSibling : null; };
const voci = (doc, titolo) => [...(blocco(doc, titolo)?.querySelectorAll('.rv-it') || [])].map(testo);
const problemiStruttura = doc => [...(blocco(doc, 'Problemi di struttura')?.querySelectorAll('.rv-issue b') || [])].map(b => b.textContent);
const stato = doc => testo(doc.querySelector('#rvView .rv-state'));

test('C1 — STRUTTURA 100 → 40 → 30: componenti, preparazioni e lotti si aggiornano subito; ricetta intatta', async () => {
  const a = app();
  const prima = snap(a.db);
  await apriStruttura(a, 'penne-proposta');
  assert.deepStrictEqual(voci(a.doc, 'Da preparare'), [
    'Grated Pecorino 0,06 lotti · resa lotto 7 kg per «CACIO E PEPE SAUCE» 417 g ›',
    'CACIO E PEPE SAUCE 0,83 lotti · resa lotto 6 kg 5 kg ›']);
  const inp = a.doc.querySelector('#rvAmount');
  scrivi(a.w, inp, '40');
  assert.match(voci(a.doc, 'Componenti')[1], /CACIO E PEPE SAUCE sotto-ricetta originale: 5 kg resa lotto 6 kg · servono 0,33 lotti 2 kg/);
  assert.deepStrictEqual(voci(a.doc, 'Da preparare').map(t => t.replace(/ ›$/, '').split(' ').slice(-2).join(' ')), ['167 g', '2 kg']);
  scrivi(a.w, inp, '30');
  assert.deepStrictEqual(voci(a.doc, 'Componenti').map(t => t.replace(/ ›$/, '').split(' ').slice(-2).join(' ')), ['1,2 kg', '1,5 kg', '60 g']);
  assert.deepStrictEqual(voci(a.doc, 'Da preparare').map(t => t.replace(/ ›$/, '').split(' ').slice(-2).join(' ')), ['125 g', '1,5 kg']);
  assert.match(voci(a.doc, 'Da preparare')[1], /0,25 lotti/);
  // una quantita' minuscola non diventa "0 lotti"
  scrivi(a.w, inp, '1');
  assert.match(voci(a.doc, 'Da preparare')[0], /Grated Pecorino meno di 0,01 lotti/);
  assert.doesNotMatch(a.doc.querySelector('#rvView').textContent, /(^|[^,\d])0 lott/);
  scrivi(a.w, inp, '30');
  assert.match(voci(a.doc, 'Resa').join('|'), /Per 30 porzioni peso non calcolabile: manca la resa in peso/);
  assert.strictEqual(snap(a.db), prima);
  assert.deepStrictEqual(a.log.writes, []);
});

test('C2 — sotto-ricetta con resa in kg: lotti dalla resa in peso', async () => {
  const a = app();
  await apriStruttura(a, 'penne-proposta');
  assert.match(voci(a.doc, 'Componenti')[1], /resa lotto 6 kg · servono 0,83 lotti/);
  await apriStruttura(a, ID.sauce);
  assert.match(voci(a.doc, 'Resa').join('|'), /Resa del lotto 6 kg/);
  assert.match(voci(a.doc, 'Resa').join('|'), /Porzioni non registrate/);
  assert.match(voci(a.doc, 'Resa').join('|'), /Testo della resa solo descrittivo «6 kg»/);
  assert.match(voci(a.doc, 'Resa').join('|'), /Per 6 kg peso finale previsto 6 kg/);
});

test('C3 — sotto-ricetta con resa in porzioni e prep collegata: struttura completa', async () => {
  const a = app();
  await apriStruttura(a, 'buffet');
  assert.match(stato(a.doc), /Struttura completa/);
  assert.match(voci(a.doc, 'Componenti')[0], /Torta sotto-ricetta originale: 20 porzioni resa 8 porzioni · servono 2,5 lotti 20 porzioni/);
  assert.match(voci(a.doc, 'Componenti')[1], /Burro ingrediente prep originale: 50 g · prep: Burro a cubetti 50 g/);
  scrivi(a.w, a.doc.querySelector('#rvAmount'), '10');
  assert.deepStrictEqual(voci(a.doc, 'Da preparare'), ['Torta 1,25 lotti · resa 8 porzioni 10 porzioni ›', 'Burro prep: Burro a cubetti 25 g']);
  assert.strictEqual(problemiStruttura(a.doc).length, 0);
});

test('C4 — sotto-ricetta senza resa: lotti non calcolabili, detto in chiaro', async () => {
  const a = app();
  await apriStruttura(a, 'usa-senza-resa');
  assert.ok(problemiStruttura(a.doc).includes('Non conosco la resa di «Senza resa»: non posso calcolare quanti lotti servono.'));
  assert.match(voci(a.doc, 'Da preparare')[0], /Senza resa resa resa non indicata: quantità non calcolabile \?/);
  assert.doesNotMatch(stato(a.doc), /completa/);
});

test('C5 — ricetta che contiene se stessa', async () => {
  const a = app();
  await apriStruttura(a, ID.grated);
  assert.ok(problemiStruttura(a.doc).includes('«Grated Pecorino» contiene se stessa.'));
  assert.match(stato(a.doc), /Struttura da correggere/);
});

test('C6 — Penne di oggi: collegamento sospetto al piatto, mai verde', async () => {
  const a = app();
  await apriStruttura(a, ID.penneCat);
  const p = problemiStruttura(a.doc);
  assert.ok(p.includes('Collegamento sospetto: «Cacio e Pepe» rende 1 porzione ma in «PENNE CACIO E PEPE Catering» è usata in kg. Cercavi una salsa o una base?'), p.join('\n'));
  assert.match(stato(a.doc), /Struttura da correggere/);
  assert.match(voci(a.doc, 'Componenti')[1], /resa 1 porzione · lotti non calcolabili/);
  assert.match(voci(a.doc, 'Da preparare')[0], /Cacio e Pepe resa 1 porzione: quantità non calcolabile \?/);
});

test('C7/C8 — due livelli di sotto-ricetta, apertura da "Da preparare", ritorno con le porzioni scelte', async () => {
  const a = app();
  await apriStruttura(a, 'penne-proposta');
  scrivi(a.w, a.doc.querySelector('#rvAmount'), '40');
  assert.match(voci(a.doc, 'Da preparare')[0], /Grated Pecorino .*per «CACIO E PEPE SAUCE» 167 g/);
  assert.ok(problemiStruttura(a.doc).includes('«Grated Pecorino» contiene se stessa.'), 'problema del secondo livello visto dalla ricetta principale');
  a.doc.querySelector('#rvView [data-rid]').click();
  await finche(() => a.doc.querySelector('.rv-title h1')?.textContent === 'Grated Pecorino' && !/Controllo/.test(a.doc.querySelector('#rvView').textContent));
  assert.strictEqual(a.doc.querySelector('[data-tab="struct"]').getAttribute('aria-selected'), 'true');
  assert.strictEqual(a.doc.querySelector('#rvAmount').value, '0,17');
  assert.match(a.doc.querySelector('.rv-title span').textContent, /dentro PENNE CACIO E PEPE \(proposta\)/);
  a.doc.querySelector('#rvBack').click();
  assert.strictEqual(a.doc.querySelector('#rvAmount').value, '40');
  assert.match(voci(a.doc, 'Componenti')[1], /2 kg/);
  // anche dai componenti: sotto-ricetta e ritorno
  a.doc.querySelector('#rvView [data-sub="1"]').click();
  await finche(() => a.doc.querySelector('.rv-title h1')?.textContent === 'CACIO E PEPE SAUCE');
  assert.strictEqual(a.doc.querySelector('#rvAmount').value, '2');
  a.doc.querySelector('#rvBack').click();
  assert.strictEqual(a.doc.querySelector('#rvAmount').value, '40');
  assert.deepStrictEqual(a.log.writes, []);
});

test('C9 — ricetta scritta diversa dalla distinta; preparazioni e prep collegate mancanti', async () => {
  const a = app();
  await apriStruttura(a, 'scritta-diversa');
  assert.ok(problemiStruttura(a.doc).includes('La ricetta scritta contiene ingredienti assenti dalla distinta: cacio e pepe sauce.'));
  assert.match(stato(a.doc), /Struttura da correggere · 1 problema/, 'mai verde');
  assert.ok(a.doc.querySelector('#rvView .rv-state.est'), 'giallo: confronto per nome');
  // i nomi della ricetta scritta in inglese si ritrovano nella distinta anche se l'utente la legge in italiano
  const b = app();
  b.db.recipes.push({ id: 'bilingue', title: 'Bilingue', base_servings: 2, ingredients: [{ qty: '1', name: 'milk', unit: 'l' }] });
  b.db.recipe_bom.push({ bom_id: 9101, parent_recipe_id: 'bilingue', component_type: 'ITEM', item_id: ID.milk, sub_recipe_id: null, quantity: 1, unit: 'l', sort_order: 1, prep_task_id: null });
  await apriStruttura(b, 'bilingue');
  assert.strictEqual(problemiStruttura(b.doc).length, 0, 'Milk = Latte intero: nessun falso allarme');
  // un ingrediente scritto che sta dentro una sotto-ricetta non e' "assente"
  b.db.recipes.push({ id: 'con-salsa', title: 'Con salsa', base_servings: 2, ingredients: [{ qty: '440', name: 'butter', unit: 'g' }, { qty: '1', name: 'zafferano', unit: 'g' }] });
  b.db.recipe_bom.push({ bom_id: 9102, parent_recipe_id: 'con-salsa', component_type: 'RECIPE', item_id: null, sub_recipe_id: ID.sauce, quantity: 1, unit: 'kg', sort_order: 1, prep_task_id: null });
  await apriStruttura(b, 'con-salsa');
  assert.ok(problemiStruttura(b.doc).includes('La ricetta scritta contiene ingredienti assenti dalla distinta: zafferano.'), problemiStruttura(b.doc).join('\n'));
  await apriStruttura(a, 'orfana');
  const p = problemiStruttura(a.doc);
  assert.ok(p.includes('Una riga punta a una preparazione che non esiste più.'), p.join('\n'));
  assert.ok(p.includes('«Burro» è collegato a una prep che non esiste più.'), p.join('\n'));
});

test('C10 — STRUTTURA: solo letture, nessuna scrittura', async () => {
  const a = app();
  for (const id of ['penne-proposta', ID.penneCat, 'buffet', 'orfana', ID.grated]) {
    await apriStruttura(a, id);
    scrivi(a.w, a.doc.querySelector('#rvAmount'), '3');
  }
  assert.deepStrictEqual(a.log.writes, []);
  const src = leggi('js/recipe-view.js');
  assert.deepStrictEqual([...src.matchAll(/from\('([a-z_]+)'\)/g)].map(m => m[1]).sort(), ['prep_tasks', 'recipe_bom', 'recipe_bom', 'recipe_steps', 'recipes', 'recipes_with_cost']);
});

test('C11 — interruttore spento: nessuna traccia della nuova scheda', async () => {
  const off = app({ flag: false });
  let vecchia = null;
  off.w.recipeModal.open = id => { vecchia = id; };
  await off.w.openRecipeByData(1);
  assert.strictEqual(vecchia, ID.cacioPiatto);
  assert.strictEqual(off.doc.querySelector('#rvOverlay'), null);
  assert.strictEqual(off.doc.getElementById('rvStyle'), null);
  assert.deepStrictEqual(off.log.writes, []);
});

test('C12 — intestazione compatta: porzioni in una riga, tab da 44 px, titolo su 2 righe al massimo', async () => {
  const a = app();
  await apri(a, ID.penneCat);
  const prow = a.doc.querySelector('.rv-prow');
  assert.ok(prow.contains(a.doc.querySelector('#rvAmount')) && prow.contains(a.doc.querySelector('#rvRange')) && prow.contains(a.doc.querySelector('#rvSub')), 'etichetta, numero e slider sulla stessa riga');
  const src = leggi('js/recipe-view.js');
  assert.match(src, /\.rv-seg button\{height:44px/);
  assert.match(src, /\.rv-title h1\{[^}]*-webkit-line-clamp:2/);
  assert.match(src, /\.rv-title span\{[^}]*text-overflow:ellipsis/);
  assert.match(src, /\.rv-prow\{display:flex;align-items:center;gap:10px\}/, 'riga porzioni senza a capo');
  assert.strictEqual(a.doc.querySelector('.rv-title h1').getAttribute('title'), 'PENNE CACIO E PEPE Catering');
});

// ── BR-UI02D — interruttore per dispositivo, solo amministratore ─────────────
test('D1 — interruttore: spento di default per tutti, visibile solo all\'admin, acceso/spento per dispositivo', async () => {
  const conBottoni = a => { const d = a.doc.createElement('div'); d.id = 'recipeAdminBtns'; a.doc.body.appendChild(d); return d; };
  // cuoco: nessun interruttore, scheda vecchia
  const c = app({ flag: false, admin: false }); conBottoni(c);
  c.w.recipeView.syncFlagButton();
  assert.strictEqual(c.doc.getElementById('rvFlagBtn'), null);
  assert.strictEqual(c.w.recipeView.enabled(), false);
  // admin: interruttore OFF finche' non lo tocca
  const a = app({ flag: false }); conBottoni(a);
  a.w.recipeView.syncFlagButton();
  const b = a.doc.getElementById('rvFlagBtn');
  assert.strictEqual(b.textContent, 'Scheda nuova: OFF');
  let vecchia = null; a.w.recipeModal.open = id => { vecchia = id; };
  await a.w.openRecipeByData(0);
  assert.strictEqual(vecchia, ID.penneCat, 'spento: si apre la scheda di oggi');
  b.click();
  assert.strictEqual(b.textContent, 'Scheda nuova: ON');
  assert.strictEqual(a.w.localStorage.getItem('brigade_ricetta_v2'), '1');
  await a.w.openRecipeByData(0);
  await finche(() => a.doc.querySelector('#rvView .rv-card'));
  a.w.recipeView.close();
  b.click();
  assert.strictEqual(b.textContent, 'Scheda nuova: OFF');
  assert.strictEqual(a.w.localStorage.getItem('brigade_ricetta_v2'), null);
  // la griglia ricette aggiorna l'interruttore
  assert.match(leggi('js/recipes.js'), /function renderRecipes\(\)\{\n  window\.recipeView\?\.syncFlagButton\(\);/);
  assert.deepStrictEqual(a.log.writes, []);
});
