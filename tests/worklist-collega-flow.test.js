// ══════════════════════════════════════════════════════════════════
// WORKLIST -> COLLEGA -> MODALE -> SALVA -> AGGIORNA
//
// Riproduce dal vivo, in jsdom, il flusso che dall'iPhone non
// funzionava. Carica i file VERI — js/vendor-documents-review.js e
// js/ingredient-worklist.js — e tocca davvero il bottone.
// Database simulato: nessun collegamento reale viene creato.
// ══════════════════════════════════════════════════════════════════
'use strict';
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const R = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const vpuSrc = R('js/vendor-parsers/price-intelligence-merge.js');
const vdrSrc = R('js/vendor-documents-review.js');
const iwlSrc = R('js/ingredient-worklist.js');

let pass = 0, fail = 0;
async function atest(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); }
}

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = dom.window;
global.Node = dom.window.Node;

// ── dati REALI: le righe scollegate delle fatture 07133828/014fbb7f/28ff13e1
const H = "Hardie's Fresh Foods / Dairyland Produce", W = 'Walmart Business';
const RIGHE = [
  { vendor:W, vendor_sku:'26178258', raw_description:'Easy-Off Fume Free Oven Cleaner Foam, Removes Grease & Burned-On Food, For Ovens, Air Fryers & More 14.5oz', pack_description:'14-5oz', invoice_date:'2026-09-22', unit_price:5.48, line_total:29.66, cost_per_100g:null, import_id:'d1', ingredient_id:null },
  { vendor:W, vendor_sku:'44391012', raw_description:'Fresh Navel Oranges, 4 lb Bag', pack_description:'4lb', invoice_date:'2026-09-22', unit_price:4.97, line_total:4.97, cost_per_100g:0.2739, import_id:'d1', ingredient_id:null },
  { vendor:W, vendor_sku:'1536106904', raw_description:'Simply Orange Pulp-Free Orange 5 Juice Bottle, 46 fl oz', pack_description:null, invoice_date:'2026-09-25', unit_price:4.64, line_total:18.56, cost_per_100g:null, import_id:'d2', ingredient_id:null },
  { vendor:W, vendor_sku:'ALT_PAYMENT_METHODS', raw_description:'Alternative Payment Methods', invoice_date:'2026-09-22', line_total:-68.84, import_id:'d1', ingredient_id:null },
  { vendor:W, vendor_sku:'SubDown', raw_description:'FULFILL_VARIANCE', invoice_date:'2026-09-22', line_total:34.42, import_id:'d1', ingredient_id:null },
  { vendor:H, vendor_sku:'71939', raw_description:'TOMATO HEIRLOOM', pack_description:'8-10#', invoice_date:'2026-09-23', unit_price:45.14, line_total:90.28, cost_per_100g:null, import_id:'d3', ingredient_id:null },
];
const INGREDIENTI = [
  { id:'i-oj',    name:'Orange Juice',                category:'Beverages & Spirits', active:true },
  { id:'i-or',    name:'Orange',                      category:'Produce',             active:true },
  { id:'i-oc',    name:'Oven Cleaner',                category:'Kitchen Supplies',    active:true },
  { id:'i-oz',    name:'Orange Zest',                 category:'Produce',             active:true },
  { id:'i-pb',    name:'Pastry Bag 21 in Disposable', category:'Kitchen Supplies',    active:true },
  { id:'i-tp',    name:'Tomato Paste',                category:'Produce',             active:true },
];

function makeSb(db) {
  function builder(table) {
    const st = { table, filters: [], rows: null };
    const b = {
      select() { return b; },
      eq(k,v)  { st.filters.push([k,v]); return b; },
      is()     { return b; },
      not()    { return b; },
      gt()     { return b; },
      order()  { return b; },
      limit()  { return b; },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      single()      { return Promise.resolve({ data: null, error: null }); },
      insert(row) { db.writes.push({ table, op:'insert', row });
                    return { select(){ return { single(){ return Promise.resolve({ data:{ id:'new' }, error:null }); } }; } }; },
      update(row) { db.writes.push({ table, op:'update', row });
                    const ch = { eq(){ return ch; }, is(){ return ch; }, not(){ return ch; },
                                 select(){ return ch; },
                                 then(res){ return Promise.resolve({ data:[], error:null }).then(res); } };
                    return ch; },
      then(res)   { return Promise.resolve({ data: dataFor(table, st), error: null }).then(res); },
    };
    return b;
  }
  function dataFor(table) {
    if (table === 'invoice_lines')  return db.invoice_lines;
    if (table === 'ingredients')    return db.ingredients;
    if (table === 'recipe_bom')     return db.recipe_bom;
    if (table === 'vendor_item_aliases') return [];
    if (table === 'ingredient_vendors')  return [];
    return [];
  }
  return { from: builder };
}

function carica() {
  document.body.innerHTML = '';
  new Function('window','document', vpuSrc + '\n' + vdrSrc + '\n' + iwlSrc)(global.window, global.document);
}

const z = el => parseInt((el && el.style && el.style.zIndex) || '0', 10);

(async function () {
console.log('\nWorklist → Collega → modale → salva — test run\n');

const db = { invoice_lines: RIGHE, ingredients: INGREDIENTI, recipe_bom: [], writes: [] };

await atest('A. la worklist si apre e mostra i 4 prodotti veri, non le righe tecniche', async () => {
  carica();
  window.supabaseClient = makeSb(db); window.supa = window.supabaseClient;
  await window.openIngredientWorklist();
  const modal = document.getElementById('iwlModal');
  assert.ok(modal, 'la worklist deve esistere');
  const bottoni = modal.querySelectorAll('button[data-sku]');
  assert.strictEqual(bottoni.length, 4, 'ALT_PAYMENT_METHODS e SubDown devono restare fuori');
  const sku = Array.from(bottoni).map(b => b.getAttribute('data-sku'));
  assert.ok(!sku.includes('SubDown') && !sku.includes('ALT_PAYMENT_METHODS'));
});

await atest('B. tocco Collega: la modale di match viene creata', async () => {
  const btn = document.querySelector('button[data-sku="1536106904"]');
  assert.ok(btn, 'il bottone del Simply Orange deve esistere');
  await window.iwlCollega(btn);
  assert.ok(document.getElementById('_vdrMatchSelector'), 'la modale deve essere nel DOM');
});

await atest('C. ED E\' QUI CHE SI ROMPEVA: la modale deve stare SOPRA la worklist', async () => {
  const sel = document.getElementById('_vdrMatchSelector');
  const wl  = document.getElementById('iwlModal');
  assert.ok(sel && wl);
  assert.ok(z(sel) > z(wl),
    'z-index modale ' + z(sel) + ' vs worklist ' + z(wl) +
    ' — se la worklist sta sopra, la modale e\' invisibile e il bottone sembra morto');
});

await atest('D. compare il candidato corretto, Orange Juice', async () => {
  const html = document.getElementById('_vdrMatchSelector').innerHTML;
  assert.ok(html.includes('Orange Juice'), 'candidato mancante');
  assert.ok(!html.includes('Pastry Bag'), 'nessun intruso');
});

await atest('E. seleziono il candidato: viene salvato', async () => {
  db.writes.length = 0;
  // Il salvataggio vero fa anche il backfill: quando la worklist si
  // rilegge, quella riga ha gia' un ingredient_id e non e' piu' scollegata.
  db.invoice_lines = RIGHE.filter(r => r.vendor_sku !== '1536106904');
  assert.strictEqual(typeof window.vdrMatchSelectorPickCandidate, 'function');
  await window.vdrMatchSelectorPickCandidate(0);
  const alias = db.writes.find(w => w.table === 'vendor_item_aliases' && w.op === 'insert');
  assert.ok(alias, 'deve scrivere l\'identita\' in vendor_item_aliases: ' + JSON.stringify(db.writes));
  assert.strictEqual(alias.row.vendor_sku, '1536106904');
  assert.strictEqual(alias.row.ingredient_id, 'i-oj');
});

await atest('F. dopo il salvataggio la worklist si aggiorna da sola', async () => {
  // l'osservatore vede sparire la modale e rilegge: aspetto che accada
  for (let i = 0; i < 40; i++) {
    if (document.querySelectorAll('#iwlModal button[data-sku]').length === 3) break;
    await new Promise(r => setTimeout(r, 25));
  }
  const bottoni = document.querySelectorAll('#iwlModal button[data-sku]');
  assert.strictEqual(bottoni.length, 3,
    'la worklist deve essersi ricaricata senza il prodotto appena collegato');
  assert.ok(!document.querySelector('#iwlModal button[data-sku="1536106904"]'),
    'il prodotto collegato non deve piu\' comparire');
});

await atest('G. gli altri due candidati escono giusti dalla stessa modale', async () => {
  for (const [sku, atteso] of [['44391012','Orange'], ['26178258','Oven Cleaner']]) {
    const b = document.querySelector('button[data-sku="' + sku + '"]');
    assert.ok(b, 'bottone mancante per ' + sku);
    await window.iwlCollega(b);
    const html = document.getElementById('_vdrMatchSelector').innerHTML;
    assert.ok(html.includes(atteso), sku + ' deve proporre ' + atteso);
    document.getElementById('_vdrMatchSelector').remove();
  }
});

console.log('\n' + pass + ' passati, ' + fail + ' falliti\n');
process.exit(fail === 0 ? 0 : 1);
})();
