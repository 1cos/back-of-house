// BR-FIX02 — protezione immediata dei BOM: niente "Elimina ricetta" nel vecchio editor, /dev/ ritirato.
// Carica in jsdom i file VERI (utils.js, recipe-modal.js, recipes.js, recipe-view.js) con il database finto dei test
// della scheda: ogni scrittura viene registrata. Nessun dato reale.
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

function app({ flag = true, lang = 'it', admin = true, fc05 = false, recipesSrc = null } = {}) {
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
  carica(recipesSrc || leggi('js/recipes.js'));
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

const writes = a => JSON.parse(JSON.stringify(a.log.writes));
async function apriEditor(a, id) {
  const rec = a.w.eval('SHOP_RECIPES').find(r => r.id === id);
  a.w.openRecipeEditor(rec);
  await finche(() => a.doc.querySelectorAll('#ingList [data-type="ingredient"]').length > 0);
}
const riga = (a, nome) => [...a.doc.querySelectorAll('#ingList [data-type="ingredient"]')].find(r => r.querySelector('.ing-name-input').value === nome);

test('F2-1 — il vecchio editor si apre come prima; al posto di "Elimina" c\'è l\'avviso, senza tasto', async () => {
  const a = app({ flag: false });
  await apriEditor(a, ID.sauce);
  assert.ok(a.doc.querySelector('#saveR'), 'Salva c\'è');
  assert.deepStrictEqual([...a.doc.querySelectorAll('#ingList [data-type="ingredient"]')].map(r => r.querySelector('.ing-name-input').value),
    ['Milk', 'Butter', 'Gluten Free Flour', 'Grated Pecorino']);
  assert.strictEqual(a.doc.querySelector('#deleteR'), null, 'nessun tasto Elimina');
  assert.strictEqual(a.doc.querySelector('#deleteDisabledNote').textContent.trim(),
    'Eliminazione temporaneamente disabilitata. Sarà disponibile nella nuova scheda con controllo dipendenze.');
  assert.ok(a.doc.querySelector('[onclick="openBOMRecipeAudit()"]'), 'BOM Audit resta (non toccato in questo task)');
  assert.deepStrictEqual(writes(a), [], 'aprire non scrive');
});

// il salvataggio del vecchio editor, file nuovo contro file oggi online: stesse identiche scritture
let ONLINE = null;
try { ONLINE = require('child_process').execSync('git show origin/brigade-main:js/recipes.js', { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 24 }); } catch (e) { ONLINE = null; }
async function salvaConEditor(sorgente) {
  const a = app({ flag: false, recipesSrc: sorgente });
  await apriEditor(a, ID.sauce);
  const q = riga(a, 'Butter').querySelector('input[type="number"]');
  q.value = '450'; q.dispatchEvent(new a.w.Event('input', { bubbles: true }));
  a.doc.querySelector('#saveR').click();
  await finche(() => a.log.writes.length > 0 && !a.doc.querySelector('#saveR'));
  await pausa(30);
  return writes(a);
}
test('F2-2 — Modifica normale invariata: stesse scritture del codice oggi online, nessuna cancellazione', { skip: ONLINE ? false : 'git non disponibile' }, async () => {
  const vecchia = app({ flag: false, recipesSrc: ONLINE });
  await apriEditor(vecchia, ID.sauce);
  assert.ok(vecchia.doc.querySelector('#deleteR'), 'controllo: l\'istanza "online" ha ancora il vecchio tasto Elimina');
  const nuovo = await salvaConEditor(null), online = await salvaConEditor(ONLINE);
  assert.deepStrictEqual(nuovo, online, 'identiche al codice online');
  assert.deepStrictEqual(nuovo.map(w => [w.t, w.op]), [['recipe_bom', 'update'], ['recipes', 'update']]);
  assert.deepStrictEqual(nuovo[0].payload, { quantity: 450 });
  assert.ok(nuovo.every(w => w.op !== 'delete'));
});

test('F2-3/4 — "Elimina ricetta" non può più scrivere: nessuna strada nel codice, nessun DELETE emesso', async () => {
  const src = leggi('js/recipes.js');
  assert.doesNotMatch(src, /id="deleteR"/);
  assert.doesNotMatch(src, /from\('recipes'\)\.delete\(/, 'nessuna cancellazione di ricette');
  assert.doesNotMatch(src, /delete\(\)\.eq\('sub_recipe_id'/, 'mai righe di distinta di ALTRE ricette');
  assert.doesNotMatch(src, /from\('recipe_bom'\)\.delete\(\)\.eq\('parent_recipe_id', rec\.id\)/, 'mai l\'intera distinta');
  assert.doesNotMatch(src, /from\('recipe_steps'\)\.delete\(\)\.eq\('recipe_id', rec\.id\)/, 'mai tutti i passi');
  assert.doesNotMatch(src, /from\('prep_tasks'\)\.update\(\{recipe_id: null\}\)/, 'mai scollegare le prep');
  // le cancellazioni che restano sono quelle del salvataggio v870 (solo righe tolte a mano, passi vecchi dopo quelli nuovi),
  // le traduzioni quando cambia il titolo, e l'Audit BOM (prossimo da migrare, non toccato qui)
  const del = [...src.matchAll(/from\('([a-z_]+)'\)\s*\.delete\(\)[^;\n]*/g)].map(m => m[0].replace(/\s+/g, ' '));
  assert.deepStrictEqual(del, [
    "from('recipe_translations').delete().eq('recipe_id',rec.id)",
    "from('recipe_bom').delete().eq('parent_recipe_id', recipeId).in('bom_id', plan.deletes)",
    "from('recipe_steps').delete().eq('recipe_id', recipeId).in('id', oldIds)",
    "from('recipe_bom').delete().eq('bom_id', bomId)",
  ]);
  // in pratica: aprire, cambiare una nota e chiudere senza salvare non emette nulla; niente da cliccare per eliminare
  const a = app({ flag: false });
  await apriEditor(a, ID.penneCat);
  a.doc.querySelector('#deleteDisabledNote').click();
  await pausa(30);
  assert.deepStrictEqual(writes(a), []);
  assert.ok(a.doc.querySelector('#saveR'), 'l\'editor resta aperto, niente è successo');
});

test('F2-5 — /dev/ non contiene più l\'app: nessuno script, niente Supabase, il vecchio service worker si disinstalla', () => {
  const html = leggi('dev/index.html');
  assert.doesNotMatch(html, /<script[^>]+src=/i, 'nessuno script caricato');
  assert.doesNotMatch(html, /supabase|createClient|recipes\.js|app\.js/i);
  assert.match(html, /Ambiente di sviluppo non disponibile/);
  assert.match(html, /r\.unregister\(\)/);
  for (const f of ['dev/js/recipes.js', 'dev/js/app.js', 'dev/manifest.json']) assert.ok(!fs.existsSync(path.join(ROOT, f)), f + ' tolto dal sito');
  const sw = leggi('dev/sw.js');
  assert.match(sw, /self\.registration\.unregister\(\)/);
  assert.doesNotMatch(sw, /addEventListener\('fetch'/, 'non intercetta più nessuna richiesta');
  // nessuna pagina del sito carica ancora codice da dev/
  const pagine = fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).map(f => leggi(f));
  assert.ok(pagine.every(p => !/src="dev\//.test(p)));
});

test('F2-5b — la pagina /dev/ aperta in un browser non fa richieste al database', async () => {
  const dom = new JSDOM(leggi('dev/index.html'), { runScripts: 'dangerously', url: 'https://1cos.github.io/back-of-house/dev/' });
  let chiamate = 0;
  dom.window.fetch = async () => { chiamate++; return {}; };
  await pausa(30);
  assert.strictEqual(chiamate, 0);
  assert.strictEqual(typeof dom.window.supabase, 'undefined');
  assert.strictEqual(typeof dom.window.openRecipeEditor, 'undefined');
});

test('F2-6/9 — il fix tocca solo il vecchio editor, /dev/ e la cache: suggester, FC05, POS/TouchBistro, prep, catering intatti', { skip: ONLINE ? false : 'git non disponibile' }, () => {
  const git = c => require('child_process').execSync(c, { cwd: ROOT, encoding: 'utf8' });
  const file = git('git diff --name-only origin/brigade-main -- . ":!tests"').trim().split('\n').filter(Boolean).sort();
  assert.deepStrictEqual(file, ['dev/index.html', 'dev/js/app.js', 'dev/js/recipes.js', 'dev/manifest.json', 'dev/sw.js', 'js/recipes.js', 'sw.js']);
  // in js/recipes.js solo due punti: il tasto e il suo gestore; nessuna lettura toccata
  const hunks = git('git diff -U0 origin/brigade-main -- js/recipes.js').split('\n').filter(l => l.startsWith('@@'));
  assert.strictEqual(hunks.length, 2, hunks.join('\n'));
  const tolte = git('git diff -U0 origin/brigade-main -- js/recipes.js').split('\n').filter(l => l.startsWith('-') && !l.startsWith('---'));
  assert.ok(tolte.every(l => !/\.select\(/.test(l)), 'nessuna lettura tolta');
  assert.match(git('git diff -U0 origin/brigade-main -- sw.js'), /\+const CACHE_NAME = 'boh-v872';/);
});
