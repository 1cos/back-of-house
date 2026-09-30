// BR-FIX01 — salvataggio ricette senza perdite, sul flusso vero.
// Carica in jsdom i file VERI (utils.js, recipes.js) e apre l'editor su dati di test isolati
// ricavati dallo snapshot di produzione del 30/09/2026 (docs/br-fix01/snapshot_prima_20260930.json).
// Database finto in memoria: registra ogni scrittura e puo' far fallire una scrittura a comando.
// Nessuna scrittura su dati di produzione.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
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
      // come in produzione dopo la modifica di Max: riga 5 kg sul PIATTO, ricetta scritta vuota
      rec(ID.penneCat, { title: 'PENNE CACIO E PEPE Catering', menu_group: 'Catering', base_servings: 100 }),
      rec(ID.cacioPiatto, { title: 'Cacio e Pepe', menu_group: 'Primi', base_servings: 1, serving_qty: 2, serving_unit: 'nests', prep_time_minutes: 5, pos_name: 'Cacio e Pepe' }),
      rec(ID.sauce, { title: 'CACIO E PEPE SAUCE', menu_group: 'Sauces', category: 'PRIMI', yield_text: '6 kg', base_weight: 6, base_weight_g: 6000,
        shelf_life_days: 9, prep_time_minutes: 30, prep_frequency_days: 7,
        ingredients: [{ qty: 128, name: 'milk', unit: 'oz', comment: 'latte intero' }, { qty: 440, name: 'butter', unit: 'g', comment: 'burro' }] }),
      rec(ID.grated, { title: 'Grated Pecorino', menu_group: 'Bases', base_weight_g: 7000, shelf_life_days: 7, serving_unit: 'g' }),
      // come PRIMA della modifica di Max (CA05): ricetta scritta con la salsa, distinta con le sole penne
      rec('prima-penne', { title: 'PENNE CACIO E PEPE Catering (copia CA05)', menu_group: 'Catering', base_servings: 100, yield_text: '100  porzioni',
        ingredients: [{ qty: '4', name: 'penne', unit: 'kg', comment: '' }, { qty: '5', name: 'cacio e pepe sauce', unit: 'kg', comment: '' }] }),
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
      { bom_id: 3001, parent_recipe_id: 'prima-penne', component_type: 'ITEM', item_id: ID.penne, sub_recipe_id: null, quantity: 4, unit: 'kg', notes: null, sort_order: 1, prep_task_id: null },
    ],
    recipe_steps: [
      { id: 's1', recipe_id: ID.sauce, step_number: 1, title: 'Heat', title_it: 'Scalda latte e burro', title_es: null, instruction_it: 'Fuoco basso', instruction_en: null, instruction_es: null, timer_seconds: 90 },
    ],
    ingredients: [
      { id: ID.penne, name: 'Penne', category: 'Dry Goods', active: true }, { id: ID.pecRomano, name: 'Pecorino Romano', category: 'Dairy', active: true },
      { id: ID.milk, name: 'Milk', category: 'Dairy', active: true }, { id: ID.butter, name: 'Butter', category: 'Dairy', active: true },
      { id: ID.gf, name: 'Gluten Free Flour', category: 'Dry Goods', active: true },
    ],
    recipe_translations: [],
  };
}

// ── Supabase finto con la catena PostgREST usata dall'editor ──────────────────
function fakeSb(db, log) {
  const rows = t => db[t] || (db[t] = []);
  const like = (v, pat) => new RegExp('^' + String(pat).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i').test(String(v ?? ''));
  function embed(t, cols, r) {
    const o = { ...r };
    if (t === 'recipe_bom' && /ingredients\(/.test(cols || '')) { const i = rows('ingredients').find(x => x.id === r.item_id); o.ingredients = i ? { name: i.name } : null; }
    if (t === 'recipe_bom' && /recipes!/.test(cols || '')) { const s = rows('recipes').find(x => x.id === r.sub_recipe_id);
      o.recipes = s ? { title: s.title, base_servings: s.base_servings, base_weight_g: s.base_weight_g, yield_text: s.yield_text } : null; }
    return o;
  }
  function q(t, mode, payload) {
    const f = []; const ord = []; let lim = null; let cols = null; let wantSingle = false;
    const pass = r => f.every(([op, k, v]) => op === 'eq' ? r[k] === v : op === 'neq' ? r[k] !== v : op === 'in' ? v.includes(r[k]) : op === 'ilike' ? like(r[k], v) : true);
    const fail = () => db._fail && db._fail.table === t && db._fail.op === mode ? { message: 'errore simulato su ' + t + ' ' + mode } : null;
    function run() {
      const err = fail();
      if (mode === 'select') {
        let r = rows(t).filter(pass).map(x => embed(t, cols, x));
        if (ord.length) r.sort((a, b) => { for (const [k, asc] of ord) { const av = a[k], bv = b[k]; if (av === bv) continue;
          if (av == null) return 1; if (bv == null) return -1; return (String(av).toLowerCase() < String(bv).toLowerCase() ? -1 : 1) * (asc ? 1 : -1); } return 0; });
        if (lim) r = r.slice(0, lim);
        return { data: r, error: null };
      }
      if (err) { log.failed.push({ table: t, op: mode }); return { data: null, error: err }; }
      // vincoli reali di recipe_bom (NOT NULL su quantity, unit, component_type)
      if (t === 'recipe_bom' && (mode === 'insert' || mode === 'update')) {
        const arr = mode === 'insert' ? (Array.isArray(payload) ? payload : [payload]) : [payload];
        const bad = arr.find(x => ['quantity', 'unit', 'component_type'].some(k => (mode === 'insert' || k in x) && (x[k] === null || x[k] === undefined)));
        if (bad) { log.failed.push({ table: t, op: mode, notnull: true }); return { data: null, error: { message: 'null value violates not-null constraint' } }; }
      }
      if (mode === 'update') { const hit = rows(t).filter(pass); hit.forEach(r => Object.assign(r, payload)); log.writes.push({ t, op: 'update', where: f.map(x => x[1] + '=' + x[2]).join(','), patch: { ...payload }, n: hit.length }); return { data: hit, error: null }; }
      if (mode === 'delete') { const keep = rows(t).filter(r => !pass(r)); const n = rows(t).length - keep.length; db[t] = keep; log.writes.push({ t, op: 'delete', where: f.map(x => x[1] + '=' + JSON.stringify(x[2])).join(','), n }); return { data: null, error: null }; }
      if (mode === 'insert') { const arr = (Array.isArray(payload) ? payload : [payload]).map((x, i) => ({ ...(t === 'recipe_bom' ? { bom_id: 9000 + rows(t).length + i } : { id: 'nuovo-' + (rows(t).length + i + 1) }), ...x }));
        rows(t).push(...arr); log.writes.push({ t, op: 'insert', rows: arr.map(x => ({ ...x })) }); return { data: wantSingle ? arr[0] : arr, error: null }; }
    }
    const self = {
      select(c) { cols = c; return self; }, eq(k, v) { f.push(['eq', k, v]); return self; }, neq(k, v) { f.push(['neq', k, v]); return self; },
      in(k, v) { f.push(['in', k, v]); return self; }, ilike(k, v) { f.push(['ilike', k, v]); return self; },
      order(k, o) { ord.push([k, !(o && o.ascending === false)]); return self; }, limit(n) { lim = n; return self; },
      async maybeSingle() { const r = run(); return { data: r.data && r.data[0] ? r.data[0] : null, error: r.error }; },
      async single() { wantSingle = true; const r = run(); return { data: Array.isArray(r.data) ? r.data[0] : r.data, error: r.error }; },
      then(a, b) { return Promise.resolve(run()).then(a, b); },
    };
    return self;
  }
  return {
    from: t => ({ select: c => q(t, 'select').select(c), update: d => q(t, 'update', d), insert: d => q(t, 'insert', d), delete: () => q(t, 'delete') }),
    storage: { from: () => ({ upload: async () => ({}), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
    rpc: async () => ({ data: null, error: null }),
  };
}

function app() {
  const dom = new JSDOM('<!doctype html><body><div id="recipeGrid"></div></body>', { runScripts: 'dangerously', url: 'https://brigade.test/', pretendToBeVisual: true });
  const w = dom.window;
  const db = datiDiTest();
  const log = { writes: [], failed: [], alerts: [], toasts: [] };
  w.supabase = { createClient: () => fakeSb(db, log) };
  w.alert = m => log.alerts.push(String(m));
  w.confirm = () => false;
  const carica = src => { const el = w.document.createElement('script'); el.textContent = src; w.document.body.appendChild(el); };
  carica(leggi('js/utils.js'));
  carica(process.env.BRFIX_RECIPES ? fs.readFileSync(process.env.BRFIX_RECIPES, 'utf8') : leggi('js/recipes.js')); // BRFIX_RECIPES: prova sul codice vecchio
  carica(`user = { id: 1, name: 'Max', is_admin: true, role: 'admin' }; window.user = user;
    window.init = async () => {}; window.renderRecipes = () => {}; window.translateAndSaveRecipe = async () => {};
    window.groqTranslate = async () => ''; window.showScToast = m => window.__toast = m;`);
  return { w, doc: w.document, db, log };
}
const pausa = (ms = 15) => new Promise(r => setTimeout(r, ms));
async function finche(cond, ms = 3000) { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await pausa(10); } }
const righe = doc => [...doc.querySelectorAll('#ingList [data-type="ingredient"]')];
const nomeRiga = r => r.querySelector('.ing-name-input').value;
const riga = (doc, nome) => righe(doc).find(r => nomeRiga(r) === nome);
function scrivi(w, el, v, ev = 'input') { el.value = v; el.dispatchEvent(new w.Event(ev, { bubbles: true })); }
const snap = db => JSON.stringify({ r: db.recipes, b: db.recipe_bom.slice().sort((a, b) => a.bom_id - b.bom_id), s: db.recipe_steps });

async function apri(ctx, id, recInMemoria) {
  const rec = recInMemoria || ctx.db.recipes.find(r => r.id === id);
  ctx.w.openRecipeEditor(JSON.parse(JSON.stringify(rec)));
  await finche(() => ctx.doc.querySelector('#saveR'));
  const attese = ctx.db.recipe_bom.filter(b => b.parent_recipe_id === id).length;
  await finche(() => righe(ctx.doc).length >= Math.max(attese, 1));
  await pausa(30);
}
async function salva(ctx) { ctx.doc.querySelector('#saveR').click(); await pausa(80); }
const editorAperto = doc => !!doc.querySelector('#saveR');

// ─────────────────────────────────────────────────────────────────────────────
test('A — aprire e salvare senza modifiche non scrive NIENTE (PENNE CACIO E PEPE Catering)', async () => {
  const ctx = app(); const prima = snap(ctx.db);
  await apri(ctx, ID.penneCat);
  assert.deepStrictEqual(righe(ctx.doc).map(nomeRiga), ['Penne', 'Cacio e Pepe', 'Pecorino Romano']);
  await salva(ctx);
  assert.strictEqual(ctx.log.writes.length, 0, JSON.stringify(ctx.log.writes));
  assert.strictEqual(snap(ctx.db), prima);
  assert.strictEqual(editorAperto(ctx.doc), false);
});

test('B — unità fuori elenco (1 gallone di latte) e prep_task_id restano identici; si aggiorna solo la riga toccata', async () => {
  const ctx = app();
  await apri(ctx, ID.sauce);
  assert.strictEqual(riga(ctx.doc, 'Milk').querySelector('select').value, 'gallone');
  const burro = riga(ctx.doc, 'Butter');
  scrivi(ctx.w, burro.querySelector('input[type="number"]'), '450');
  await salva(ctx);
  const bomW = ctx.log.writes.filter(x => x.t === 'recipe_bom');   // lo svuotamento del testo e' verificato in K
  assert.deepStrictEqual(bomW.map(x => x.op), ['update']);
  assert.deepStrictEqual(bomW[0].patch, { quantity: 450 });
  const b = id => ctx.db.recipe_bom.find(x => x.bom_id === id);
  assert.strictEqual(b(1882).unit, 'gallone');
  assert.strictEqual(b(1883).prep_task_id, 77);
  assert.strictEqual(b(1883).quantity, 450);
  assert.strictEqual(ctx.db.recipe_bom.filter(x => x.parent_recipe_id === ID.sauce).length, 4);
});

test('C — la ricetta scritta non viene più svuotata e le righe mancanti nella distinta sono mostrate', async () => {
  const ctx = app();
  await apri(ctx, 'prima-penne');
  const avviso = ctx.doc.querySelector('#writtenRecipeNotice');
  assert.ok(avviso, 'avviso ricetta scritta assente');
  assert.match(avviso.textContent, /cacio e pepe sauce/);
  assert.doesNotMatch(avviso.textContent, /\bpenne\b(?! cacio)/i, 'le penne sono nella distinta: non vanno segnalate');
  scrivi(ctx.w, ctx.doc.querySelector('#rShelfLife'), '3');
  await salva(ctx);
  assert.deepStrictEqual(ctx.log.writes.map(x => x.op + ' ' + x.t), ['update recipes']);
  assert.deepStrictEqual(ctx.log.writes[0].patch, { shelf_life_days: 3 });
  const r = ctx.db.recipes.find(x => x.id === 'prima-penne');
  assert.strictEqual(r.ingredients.length, 2, 'ricetta scritta svuotata');
  assert.strictEqual(r.yield_text, '100  porzioni', 'testo della resa perso');
});

test('D — la sotto-ricetta sbagliata si vede, si corregge, e si aggiorna una sola riga', async () => {
  const ctx = app();
  await apri(ctx, ID.penneCat);
  const r = riga(ctx.doc, 'Cacio e Pepe');
  assert.match(r.querySelector('.sub-yield-warn')?.textContent || '', /non ha una resa in peso \(1 porzione\)/);
  const input = r.querySelector('.ing-name-input');
  scrivi(ctx.w, input, 'cacio e pepe');
  await finche(() => r.querySelectorAll('.ac-opt[data-rid]').length > 0);
  const opzioni = [...r.querySelectorAll('.ac-opt[data-rid]')].map(o => o.textContent.replace(/\s+/g, ' ').trim());
  assert.ok(opzioni.some(t => /CACIO E PEPE SAUCE.*lotto 6 kg/.test(t)), opzioni.join(' | '));
  assert.ok(opzioni.some(t => /Cacio e Pepe .*1 porzione/.test(t)), opzioni.join(' | '));
  assert.strictEqual(r.querySelector(`.ac-opt[data-rid="${ID.penneCat}"]`), null, 'la ricetta stessa non deve comparire');
  r.querySelector(`.ac-opt[data-rid="${ID.sauce}"]`).dispatchEvent(new ctx.w.MouseEvent('mousedown', { bubbles: true }));
  assert.strictEqual(r.querySelector('.sub-yield-warn'), null, 'avviso rimasto dopo la correzione');
  await salva(ctx);
  assert.deepStrictEqual(ctx.log.writes.map(x => x.op + ' ' + x.t), ['update recipe_bom']);
  assert.strictEqual(ctx.log.writes[0].where, 'bom_id=2471,parent_recipe_id=' + ID.penneCat);
  assert.deepStrictEqual(ctx.log.writes[0].patch, { sub_recipe_id: ID.sauce });
  // riapertura: stessi dati, nessun avviso
  const ctx2 = ctx; await apri(ctx2, ID.penneCat);
  assert.deepStrictEqual(righe(ctx2.doc).map(nomeRiga), ['Penne', 'CACIO E PEPE SAUCE', 'Pecorino Romano']);
  assert.strictEqual(ctx2.doc.querySelector('.sub-yield-warn'), null);
});

test('E — righe non collegate e ricetta dentro se stessa: salvataggio bloccato, niente scritto', async () => {
  const ctx = app(); const prima = snap(ctx.db);
  await apri(ctx, ID.penneCat);
  ctx.doc.querySelector('#addIng').click();
  scrivi(ctx.w, righe(ctx.doc).at(-1).querySelector('.ing-name-input'), 'pepe nero macinato');
  await salva(ctx);
  assert.match(ctx.doc.querySelector('#saveBlockedPanel').textContent, /pepe nero macinato/);
  assert.strictEqual(ctx.log.writes.length, 0);
  const ctx2 = app();
  await apri(ctx2, ID.grated);
  await salva(ctx2);
  assert.match(ctx2.doc.querySelector('#saveBlockedPanel').textContent, /non può contenere se stessa/);
  assert.strictEqual(ctx2.log.writes.length, 0);
  assert.strictEqual(snap(ctx.db), prima);
});

test('F — se l\'aggiunta fallisce non si cancella nulla: le righe esistenti restano', async () => {
  const ctx = app();
  await apri(ctx, ID.sauce);
  riga(ctx.doc, 'Gluten Free Flour').querySelector('button').click();        // tolgo una riga
  ctx.doc.querySelector('#addIng').click();                                   // e ne aggiungo una
  const nuova = righe(ctx.doc).at(-1);
  nuova.dataset.ingredientId = ID.penne; scrivi(ctx.w, nuova.querySelector('.ing-name-input'), 'Penne'); nuova.dataset.ingredientId = ID.penne;
  scrivi(ctx.w, nuova.querySelector('input[type="number"]'), '10');
  ctx.db._fail = { table: 'recipe_bom', op: 'insert' };
  await salva(ctx);
  assert.deepStrictEqual(ctx.log.failed, [{ table: 'recipe_bom', op: 'insert' }]);
  assert.ok(!ctx.log.writes.some(x => x.op === 'delete'), 'ha cancellato dopo un errore');
  assert.strictEqual(ctx.db.recipe_bom.filter(x => x.parent_recipe_id === ID.sauce).length, 4);
  assert.match(ctx.log.alerts[0] || '', /si è fermato negli ingredienti/);
  assert.strictEqual(editorAperto(ctx.doc), true, 'l\'editor si è chiuso come se fosse andato bene');
});

test('G — dati in memoria vecchi: l\'editor usa la riga fresca e non la sovrascrive', async () => {
  const ctx = app();
  ctx.db.recipes.find(r => r.id === ID.sauce).procedure = 'Procedura aggiornata da Tila';
  const vecchia = { ...datiDiTest().recipes.find(r => r.id === ID.sauce) };  // SHOP_RECIPES caricata prima
  await apri(ctx, ID.sauce, vecchia);
  assert.strictEqual(ctx.doc.querySelector('#rProc').value, 'Procedura aggiornata da Tila');
  scrivi(ctx.w, ctx.doc.querySelector('#rTime'), '35');
  await salva(ctx);
  assert.deepStrictEqual(ctx.log.writes.filter(x => x.t === 'recipes').map(x => x.patch), [{ prep_time_minutes: 35 }]);
  assert.strictEqual(ctx.db.recipes.find(r => r.id === ID.sauce).procedure, 'Procedura aggiornata da Tila');
});

test('H — passi: 90 secondi restano 90; i nuovi si scrivono prima di togliere i vecchi', async () => {
  const ctx = app();
  await apri(ctx, ID.sauce);
  scrivi(ctx.w, ctx.doc.querySelector('.step-title-it'), 'Scalda latte e burro piano');
  await salva(ctx);
  const ops = ctx.log.writes.filter(x => x.t === 'recipe_steps').map(x => x.op);
  assert.deepStrictEqual(ops, ['insert', 'delete']);
  assert.strictEqual(ctx.db.recipe_steps.length, 1);
  assert.strictEqual(ctx.db.recipe_steps[0].timer_seconds, 90);
  assert.strictEqual(ctx.db.recipe_steps[0].title_it, 'Scalda latte e burro piano');
});

test('I — ricetta nuova: una riga ricetta e righe di distinta compatibili con FC05', async () => {
  const ctx = app();
  ctx.w.openRecipeEditor();
  await finche(() => righe(ctx.doc).length === 3);
  scrivi(ctx.w, ctx.doc.querySelector('#rTitle'), 'Test BR-FIX01');
  scrivi(ctx.w, ctx.doc.querySelector('#rServings'), '10');
  const [r1, r2] = righe(ctx.doc);
  scrivi(ctx.w, r1.querySelector('.ing-name-input'), 'Penne'); r1.dataset.ingredientId = ID.penne; scrivi(ctx.w, r1.querySelector('input[type="number"]'), '400');
  scrivi(ctx.w, r2.querySelector('.ing-name-input'), 'CACIO E PEPE SAUCE'); r2.dataset.subRecipeId = ID.sauce; scrivi(ctx.w, r2.querySelector('input[type="number"]'), '500');
  await salva(ctx);
  const ins = ctx.log.writes.filter(x => x.op === 'insert').map(x => x.t);
  assert.deepStrictEqual(ins, ['recipes', 'recipe_bom']);
  const bom = JSON.parse(JSON.stringify(ctx.log.writes.find(x => x.t === 'recipe_bom' && x.op === 'insert').rows)); // oggetti nati in jsdom
  assert.deepStrictEqual(bom.map(b => [b.component_type, b.item_id, b.sub_recipe_id, b.quantity, b.unit, b.sort_order]),
    [['ITEM', ID.penne, null, 400, 'g', 1], ['RECIPE', null, ID.sauce, 500, 'g', 2]]);
  bom.forEach(b => assert.ok((b.component_type === 'ITEM') === !!b.item_id && (b.component_type === 'RECIPE') === !!b.sub_recipe_id, 'riga incoerente per FC05'));
});

test('J — il codice non azzera più recipes.ingredients e non cancella la distinta intera', () => {
  const src = process.env.BRFIX_RECIPES ? fs.readFileSync(process.env.BRFIX_RECIPES, 'utf8') : leggi('js/recipes.js');
  assert.ok(/_writtenFullyInBom\(scritta, ingredients\)/.test(src), 'lo svuotamento della ricetta scritta deve essere condizionato');
  assert.ok(!/from\('recipe_bom'\)\.delete\(\)\.eq\('parent_recipe_id',\s*recipeId\);/.test(src), 'ancora presente la cancellazione di tutta la distinta');
});

test('K — ricetta scritta gia' + "'" + ' tutta nella distinta: dopo una modifica agli ingredienti si svuota; con righe mancanti resta', async () => {
  const ctx = app();
  // tutta rappresentata: salsa con testo milk/butter e distinta che li contiene
  await apri(ctx, ID.sauce);
  scrivi(ctx.w, riga(ctx.doc, 'Butter').querySelector('input[type="number"]'), '460');
  await salva(ctx);
  assert.deepStrictEqual(ctx.log.writes.map(x => x.op + ' ' + x.t), ['update recipe_bom', 'update recipes']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.log.writes[1].patch)), { ingredients: [] });
  // non tutta rappresentata: copia CA05 (manca la salsa) -> resta
  const ctx2 = app();
  await apri(ctx2, 'prima-penne');
  scrivi(ctx2.w, righe(ctx2.doc)[0].querySelector('input[type="number"]'), '4.5');
  await salva(ctx2);
  assert.deepStrictEqual(ctx2.log.writes.map(x => x.op + ' ' + x.t), ['update recipe_bom']);
  assert.strictEqual(ctx2.db.recipes.find(r => r.id === 'prima-penne').ingredients.length, 2);
});

test('L — errore a metà (aggiunta riuscita, aggiornamento fallito): niente perso, errore visibile, riaprendo si vede lo stato reale', async () => {
  const ctx = app();
  await apri(ctx, ID.sauce);
  scrivi(ctx.w, riga(ctx.doc, 'Butter').querySelector('input[type="number"]'), '999');   // aggiornamento
  riga(ctx.doc, 'Gluten Free Flour').querySelector('button').click();                    // eliminazione
  ctx.doc.querySelector('#addIng').click();                                               // aggiunta
  const nuova = righe(ctx.doc).at(-1);
  scrivi(ctx.w, nuova.querySelector('.ing-name-input'), 'Penne'); nuova.dataset.ingredientId = ID.penne;
  scrivi(ctx.w, nuova.querySelector('input[type="number"]'), '10');
  ctx.db._fail = { table: 'recipe_bom', op: 'update' };
  await salva(ctx);
  const sauceRows = () => ctx.db.recipe_bom.filter(x => x.parent_recipe_id === ID.sauce);
  assert.deepStrictEqual(ctx.log.writes.filter(x => x.t === 'recipe_bom').map(x => x.op), ['insert'], 'dopo l\'errore non deve eliminare');
  assert.strictEqual(sauceRows().length, 5, 'le 4 righe originali + quella aggiunta');
  assert.ok(sauceRows().some(r => r.bom_id === 1884), 'la riga da togliere non e\' stata tolta: nessuna perdita');
  assert.strictEqual(sauceRows().find(r => r.bom_id === 1883).quantity, 440, 'aggiornamento non applicato');
  assert.match(ctx.log.alerts[0] || '', /si è fermato negli ingredienti/);
  assert.strictEqual(editorAperto(ctx.doc), true);
  // recupero: chiudo, riapro -> vedo lo stato reale (5 righe) e posso sistemarlo
  ctx.doc.querySelector('.fixed').remove(); ctx.db._fail = null;
  await apri(ctx, ID.sauce);
  assert.deepStrictEqual(righe(ctx.doc).map(nomeRiga), ['Milk', 'Butter', 'Gluten Free Flour', 'Grated Pecorino', 'Penne']);
});

test('M — modifiche di Max fatte mentre un altro ha l\'editor aperto: non vengono sovrascritte né cancellate', async () => {
  const ctx = app();
  await apri(ctx, ID.penneCat);
  // Max, da un altro telefono, cambia il suo pecorino e aggiunge una riga
  ctx.db.recipe_bom.find(b => b.bom_id === 2472).quantity = 250;
  ctx.db.recipe_bom.push({ bom_id: 2600, parent_recipe_id: ID.penneCat, component_type: 'ITEM', item_id: ID.butter, sub_recipe_id: null,
    quantity: 100, unit: 'g', notes: 'aggiunta di Max', sort_order: 4, prep_task_id: null });
  ctx.db.recipes.find(r => r.id === ID.penneCat).procedure = 'Procedura scritta da Max';
  // l'altro cambia solo le penne e salva
  scrivi(ctx.w, riga(ctx.doc, 'Penne').querySelector('input[type="number"]'), '4.2');
  await salva(ctx);
  const bom = id => ctx.db.recipe_bom.find(b => b.bom_id === id);
  assert.deepStrictEqual(ctx.log.writes.map(w => w.op + ' ' + w.t + ' ' + (w.where || '')), ['update recipe_bom bom_id=2470,parent_recipe_id=' + ID.penneCat]);
  assert.strictEqual(bom(2470).quantity, 4.2);
  assert.strictEqual(bom(2472).quantity, 250, 'il pecorino di Max e\' stato sovrascritto');
  assert.ok(bom(2600), 'la riga aggiunta da Max e\' stata cancellata');
  assert.strictEqual(ctx.db.recipes.find(r => r.id === ID.penneCat).procedure, 'Procedura scritta da Max');
});

test('N — riga collegata senza quantità: salvataggio bloccato con spiegazione, niente scritto (quantity è NOT NULL)', async () => {
  const ctx = app(); const prima = snap(ctx.db);
  await apri(ctx, ID.penneCat);
  scrivi(ctx.w, riga(ctx.doc, 'Pecorino Romano').querySelector('input[type="number"]'), '');
  await salva(ctx);
  assert.match(ctx.doc.querySelector('#saveBlockedPanel').textContent, /Manca la quantità per: Pecorino Romano/);
  assert.strictEqual(ctx.log.writes.length, 0);
  assert.strictEqual(ctx.log.failed.length, 0);
  assert.strictEqual(snap(ctx.db), prima);
});
