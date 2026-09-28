// ══════════════════════════════════════════════════════════════════
// WORKLIST INGREDIENTI — raggruppamento e filtro delle righe tecniche
// Gira contro js/ingredient-worklist.js vero, caricato come lo carica
// il browser. Dati reali: le 16 righe scollegate entrate con INV15.
// ══════════════════════════════════════════════════════════════════
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname,'..','js','ingredient-worklist.js'),'utf8');
const window = {};
const document = { getElementById: function(){ return null; } };
eval(SRC);

// Le 16 righe REALI rimaste senza ingredient_id dopo il cron delle 19:55
// del 28/09/2026, verbatim da invoice_lines.
const H = "Hardie's Fresh Foods / Dairyland Produce", W = 'Walmart Business';
const RIGHE = [
  { vendor:W, vendor_sku:'26178258', raw_description:'Easy-Off Fume Free Oven Cleaner Foam', pack_description:'14-5oz', invoice_date:'2026-09-22', unit_price:5.48, line_total:29.66, cost_per_100g:null, import_id:'d1' },
  { vendor:W, vendor_sku:'44391012', raw_description:'Fresh Navel Oranges, 4 lb Bag', pack_description:'4lb', invoice_date:'2026-09-22', unit_price:4.97, line_total:4.97, cost_per_100g:0.2739, import_id:'d1' },
  { vendor:W, vendor_sku:'44391040', raw_description:'Fresh Yellow Squash, Each', pack_description:'Each', invoice_date:'2026-09-22', unit_price:10.79, line_total:10.79, cost_per_100g:null, import_id:'d1' },
  { vendor:W, vendor_sku:'ALT_PAYMENT_METHODS', raw_description:'Alternative Payment Methods', invoice_date:'2026-09-22', line_total:-68.84, import_id:'d1' },
  { vendor:W, vendor_sku:'SubDown', raw_description:'FULFILL_VARIANCE', invoice_date:'2026-09-22', line_total:34.42, import_id:'d1' },
  { vendor:W, vendor_sku:'SubDown', raw_description:'FULFILL_VARIANCE', invoice_date:'2026-09-22', line_total:34.42, import_id:'d1' },
  { vendor:W, vendor_sku:'1536106904', raw_description:'Simply Orange Pulp-Free Orange 5 Juice Bottle, 46 fl oz', pack_description:null, invoice_date:'2026-09-25', unit_price:4.64, line_total:18.56, cost_per_100g:null, import_id:'d2' },
  { vendor:W, vendor_sku:'ALT_PAYMENT_METHODS', raw_description:'Alternative Payment Methods', invoice_date:'2026-09-25', line_total:-14.18, import_id:'d2' },
  { vendor:W, vendor_sku:'SubDown', raw_description:'FULFILL_VARIANCE', invoice_date:'2026-09-25', line_total:7.09, import_id:'d2' },
  { vendor:W, vendor_sku:'SubDown', raw_description:'FULFILL_VARIANCE', invoice_date:'2026-09-25', line_total:7.09, import_id:'d2' },
  { vendor:H, vendor_sku:'10763', raw_description:'GRAPES WHITE SEEDLESS', pack_description:'2#', invoice_date:'2026-09-23', unit_price:4.49, line_total:8.98, cost_per_100g:0.4949, import_id:'d3' },
  { vendor:H, vendor_sku:'24437', raw_description:'BREADSTIXS GRISSINI WRAPPED', pack_description:'320 CT', invoice_date:'2026-09-23', unit_price:80.81, line_total:80.81, cost_per_100g:null, import_id:'d3' },
  { vendor:H, vendor_sku:'33537', raw_description:'CABBAGE SUGAR CONE ROW 7', pack_description:'20#', invoice_date:'2026-09-23', unit_price:50.5, line_total:50.5, cost_per_100g:0.5567, import_id:'d3' },
  { vendor:H, vendor_sku:'33588', raw_description:'CABBAGE NAPA PURPLE HEART', pack_description:'20#', invoice_date:'2026-09-23', unit_price:40.97, line_total:40.97, cost_per_100g:0.4516, import_id:'d3' },
  { vendor:H, vendor_sku:'70170', raw_description:'BEET BABY MIXED', pack_description:'24 CT', invoice_date:'2026-09-23', unit_price:55.56, line_total:55.56, cost_per_100g:null, import_id:'d3' },
  { vendor:H, vendor_sku:'71939', raw_description:'TOMATO HEIRLOOM', pack_description:'8-10#', invoice_date:'2026-09-23', unit_price:45.14, line_total:90.28, cost_per_100g:null, import_id:'d3' },
];

test('1. restano esattamente i 10 prodotti veri: le 6 righe tecniche spariscono', function() {
  const g = window.iwlRaggruppa(RIGHE);
  assert.strictEqual(g.length, 10, JSON.stringify(g.map(function(x){return x.vendor_sku;})));
  const sku = g.map(function(x) { return x.vendor_sku; });
  assert.ok(!sku.includes('ALT_PAYMENT_METHODS'));
  assert.ok(!sku.includes('SubDown'));
});

test('2. il filtro e\' esatto, non euristico: uno SKU che CONTIENE il nome resta', function() {
  // se un domani un prodotto vero si chiamasse cosi', non deve sparire
  const g = window.iwlRaggruppa([
    { vendor:W, vendor_sku:'SubDownJacket', raw_description:'Piumino', line_total:10 },
    { vendor:W, vendor_sku:'SubDown',       raw_description:'FULFILL_VARIANCE', line_total:10 },
  ]);
  assert.deepStrictEqual(g.map(function(x){return x.vendor_sku;}), ['SubDownJacket']);
});

test('3. ordinati per importanza economica', function() {
  const g = window.iwlRaggruppa(RIGHE);
  assert.strictEqual(g[0].vendor_sku, '71939', 'il pomodoro heirloom vale $90,28');
  assert.strictEqual(g[1].vendor_sku, '24437', 'poi i grissini, $80,81');
  for (let i = 1; i < g.length; i++) {
    assert.ok(g[i-1].valore >= g[i].valore, 'ordine decrescente rotto a ' + i);
  }
});

test('4. una riga per SKU, non per fattura, e i valori si sommano', function() {
  const doppio = [
    { vendor:H, vendor_sku:'99', raw_description:'VECCHIA', invoice_date:'2026-08-01', unit_price:5, line_total:10 },
    { vendor:H, vendor_sku:'99', raw_description:'NUOVA',   invoice_date:'2026-09-01', unit_price:7, line_total:14 },
  ];
  const g = window.iwlRaggruppa(doppio);
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].righe, 2);
  assert.strictEqual(g[0].valore, 24);
  assert.strictEqual(g[0].descrizione, 'NUOVA', 'vince la fattura piu\' recente');
  assert.strictEqual(g[0].ultimo_prezzo, 7);
  assert.strictEqual(g[0].ultima_data, '2026-09-01');
});

test('5. lo stesso SKU da due fornitori resta separato', function() {
  const g = window.iwlRaggruppa([
    { vendor:H, vendor_sku:'123', raw_description:'da Hardie', line_total:10 },
    { vendor:W, vendor_sku:'123', raw_description:'da Walmart', line_total:20 },
  ]);
  assert.strictEqual(g.length, 2, 'vendor+sku e\' la chiave, non lo sku da solo');
});

test('6. segnala se il formato permette gia\' un prezzo al chilo', function() {
  const g = window.iwlRaggruppa(RIGHE);
  const byS = {}; g.forEach(function(x) { byS[x.vendor_sku] = x; });
  assert.strictEqual(byS['33537'].ha_peso, true,  'cavolo 20# -> $0,5567/100 g');
  assert.strictEqual(byS['24437'].ha_peso, false, 'grissini 320 CT -> a pezzo');
  assert.strictEqual(byS['70170'].ha_peso, false, 'barbabietole 24 CT -> a pezzo');
});

test('7. righe senza vendor_sku non entrano in worklist', function() {
  const g = window.iwlRaggruppa([
    { vendor:H, vendor_sku:null, raw_description:'senza sku', line_total:99 },
    { vendor:H, vendor_sku:'',   raw_description:'sku vuoto', line_total:99 },
  ]);
  assert.deepStrictEqual(g, []);
});

test('8. l\'unica scrittura del file e\' ingredient_links, e nient\'altro', function() {
  // Aggiornato quando e' nato iwlSalvaLink: prima il file era in sola
  // lettura, adesso ha UNA scrittura. L'asserzione non e' stata
  // allentata, e' stata resa precisa — verifica di piu', non di meno.
  assert.ok(!/from\(['"]invoice_lines['"]\)[\s\S]{0,300}?\.(insert|update|upsert|delete)\s*\(/.test(SRC),
    'la contabilita\' non si scrive da qui');
  assert.ok(!/from\(['"]ingredient_vendors['"]\)/.test(SRC),
    'i prezzi li scrive il worker all\'approvazione, non questo file');
  assert.ok(!/from\(['"]vendor_item_aliases['"]\)/.test(SRC),
    'l\'identita\' per SKU vive in vdrSaveVendorSkuMapping');
  assert.ok(!/from\(['"]ingredients['"]\)[\s\S]{0,300}?\.(insert|update)\s*\(/.test(SRC),
    'nessun ingrediente creato o modificato da qui');
  assert.ok(!/from\(['"]recipes?['"]\)|recipe_bom['"]\)[\s\S]{0,300}?\.(insert|update)/.test(SRC),
    'le ricette non si toccano mai');
  // l'unica upsert del file e' quella su ingredient_links
  const upserts = SRC.match(/\.upsert\s*\(/g) || [];
  assert.strictEqual(upserts.length, 1, 'una sola upsert in tutto il file');
  assert.ok(/from\('ingredient_links'\)\s*\n?\s*\.upsert/.test(SRC),
    'e deve essere quella su ingredient_links');
  assert.ok(SRC.indexOf('vdrOpenMatchSelector') > -1, 'deve riusare la modale esistente');
});
