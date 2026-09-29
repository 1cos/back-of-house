// ══════════════════════════════════════════════════════════════════
// COLLEGARE DALLA FATTURA PENDING — Global Gourmet #20734
//
// Percorre: documento pending -> collegamento manuale -> preflight ->
// simulazione di approvazione -> aggiornamento prezzi.
// Usa il parsed_json REALE trascritto dalla foto e le funzioni VERE
// del worker (pure_logic.cjs). Database simulato: niente e' scritto.
// ══════════════════════════════════════════════════════════════════
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const IWL = fs.readFileSync(path.join(__dirname,'..','js','ingredient-worklist.js'),'utf8');
const window = {};
const document = { getElementById: function(){ return null; } };
eval(IWL);

const { chronologyAllows, effectiveLastDate, vdaiPackToGrams } = require('../pure_logic.cjs');

// Il documento REALE, come sarebbe in vendor_documents.parsed_json
const DOC = {
  vendor: 'Global Gourmet Foods',
  document_type: 'invoice',
  document_number: '20734',
  document_date: '2026-06-16',
  parsed_json: {
    vendor: 'Global Gourmet Foods', document_type: 'invoice',
    invoice_number: '20734', document_number: '20734',
    invoice_date: '2026-06-16', subtotal: 936.10, total: 936.10,
    items: [
      { qty:3, purchase_unit:'cs', description:'Italian Peeled Tomatoes 6#10 "La Carmela"', raw_description:'Italian Peeled Tomatoes 6#10 "La Carmela"', pack_description:'6/#10', unit_price:35.00, amount:105.00, vendor_sku:null, line_type:'product' },
      { qty:3, purchase_unit:'cs', description:'Extra Virgin Olive Oil 3/5lt Seleccion "Oleoestepa"', raw_description:'Extra Virgin Olive Oil 3/5lt Seleccion "Oleoestepa"', pack_description:'3/5LT', unit_price:164.00, amount:492.00, vendor_sku:null, line_type:'product' },
      { qty:2, purchase_unit:'ea', description:'Gnocchi C-Catering 10kg. "Molino Pasini"', raw_description:'Gnocchi C-Catering 10kg. "Molino Pasini"', pack_description:'10 KG', unit_price:74.57, amount:149.14, vendor_sku:null, line_type:'product' },
      { qty:7.3, purchase_unit:'lb', description:'Guanciale 2/3.5lb "Maestri"', raw_description:'Guanciale 2/3.5lb "Maestri"', pack_description:'2/3.5#', unit_price:16.82, amount:122.79, cost_per_lb:16.82, vendor_sku:null, line_type:'product' },
      { qty:1, purchase_unit:'ea', description:'SEA SALT COARSE SICILIAN BULK 25KG', raw_description:'SEA SALT COARSE SICILIAN BULK 25KG', pack_description:'25 KG', unit_price:34.50, amount:34.50, vendor_sku:null, line_type:'product' },
      { qty:1.98, purchase_unit:'lb', description:'Salame Napoli Smoked W/Peppercorn 2pc/cs (775Q) "Levoni"', raw_description:'Salame Napoli Smoked W/Peppercorn 2pc/cs (775Q) "Levoni"', pack_description:'2 PC/CS', unit_price:16.50, amount:32.67, cost_per_lb:16.50, vendor_sku:null, line_type:'product' },
    ],
  },
};

const ING = {
  salt:  { id:'4720ed37-9e3b-417b-a949-b2bc60d5ec5f', name:'Salt' },
  evo:   { id:'412b67a7-040b-4f3f-83f3-6b9f72c5c575', name:'Extra Virgin Olive Oil' },
  pom:   { id:'9aaf02de-36ff-4113-9413-718a7d7f1006', name:'Canned Tomatoes' },
};

function fakeSb(scritture) {
  return { from: function(t) { return {
    upsert: function(row) { scritture.push({ table:t, row:row }); return Promise.resolve({ error:null }); },
  }; } };
}

test('1. le righe collegabili escono dal parsed_json, non da invoice_lines', () => {
  const r = window.iwlRigheCollegabili(DOC);
  assert.strictEqual(r.length, 6, 'sei prodotti');
  assert.ok(r.every(x => x.vendor_sku === null), 'nessuna ha uno SKU: e\' il punto');
  assert.ok(r.every(x => x.vendor === 'Global Gourmet Foods'));
  assert.strictEqual(r[4].descrizione, 'SEA SALT COARSE SICILIAN BULK 25KG');
  assert.strictEqual(r[4].pack, '25 KG');
});

test('2. le righe non-prodotto sarebbero escluse', () => {
  const d = JSON.parse(JSON.stringify(DOC));
  d.parsed_json.items.push({ description:'HANDLING', line_type:'handling', amount:5 });
  assert.strictEqual(window.iwlRigheCollegabili(d).length, 6, 'HANDLING non e\' un ingrediente');
});

test('3. il salvataggio scrive SOLO ingredient_links', async () => {
  const w = [];
  const out = await window.iwlSalvaLink(fakeSb(w), 'Global Gourmet Foods',
    'SEA SALT COARSE SICILIAN BULK 25KG', ING.salt, { invoice_unit: 'ea' });
  assert.strictEqual(out.status, 'saved');
  assert.strictEqual(w.length, 1, 'una sola scrittura');
  assert.strictEqual(w[0].table, 'ingredient_links');
  assert.strictEqual(w[0].row.ingredient_id, ING.salt.id);
  assert.strictEqual(w[0].row.confirmed, true, 'approvato a mano, non dedotto');
  assert.strictEqual(w[0].row.confidence, 1.0);
  assert.strictEqual(w[0].row.conversion_g, null, 'nessuna conversione inventata');
});

test('4. l\'olio si converte con la convenzione dello chef, 1 L = 1 kg (FC02)', async () => {
  const w = [];
  // 3 bottiglie da 5 litri = 15 litri = 15.000 g
  const grammi = 15 * 1000 * window.IWL_DENSITA["olio d'oliva"];
  assert.strictEqual(grammi, 15000);
  await window.iwlSalvaLink(fakeSb(w), 'Global Gourmet Foods',
    'Extra Virgin Olive Oil 3/5lt Seleccion "Oleoestepa"', ING.evo,
    { invoice_unit: 'cs', conversion_g: grammi });
  assert.strictEqual(w[0].row.conversion_g, 15000);
  assert.strictEqual(w[0].row.base_unit, 'g');
  // e il prezzo che ne viene: $164,00 / 15.000 g x 100
  const per100 = 164.00 / grammi * 100;
  assert.ok(Math.abs(per100 - 1.0933) < 0.0001, 'circa $1,0933/100 g: ' + per100.toFixed(4));
});

test('5. il file non tocca invoice_lines ne\' ingredient_vendors', () => {
  assert.ok(!/from\(['"]invoice_lines['"]\)[\s\S]{0,200}?\.(insert|update|upsert)/.test(IWL),
    'nessuna scrittura su invoice_lines');
  assert.ok(!/from\(['"]ingredient_vendors['"]\)/.test(IWL),
    'i prezzi non si scrivono da qui: li scrive il worker all\'approvazione');
});

// ── SIMULAZIONE DELL'APPROVAZIONE, con le funzioni vere ────────────

test('6. con i link presenti, writeInvoiceLines aggancerebbe l\'ingrediente', () => {
  // linkMap e' esattamente { invoice_description: ingredient_id }
  const linkMap = {
    'SEA SALT COARSE SICILIAN BULK 25KG': ING.salt.id,
    'Extra Virgin Olive Oil 3/5lt Seleccion "Oleoestepa"': ING.evo.id,
    'Italian Peeled Tomatoes 6#10 "La Carmela"': ING.pom.id,
  };
  const righe = DOC.parsed_json.items.map(it => {
    const desc = it.description || it.raw_description;
    // stessa espressione del writer: sku ? ... : desc && linkMap[desc] ? ... : null
    const sku = it.vendor_sku || it.item_code || null;
    return { desc, ingredient_id: (sku ? null : (desc && linkMap[desc] ? linkMap[desc] : null)) };
  });
  const collegate = righe.filter(r => r.ingredient_id);
  assert.strictEqual(collegate.length, 3, 'tre collegate, tre ancora no');
  assert.strictEqual(righe[4].ingredient_id, ING.salt.id, 'il sale');
  assert.strictEqual(righe[1].ingredient_id, ING.evo.id,  'l\'olio');
  assert.strictEqual(righe[0].ingredient_id, ING.pom.id,  'il pomodoro');
  assert.strictEqual(righe[3].ingredient_id, null, 'il guanciale resta scollegato');
});

test('7. la guardia cronologica decide riga per riga, con le funzioni del worker', () => {
  const inArrivo = '2026-06-16';
  const casi = [
    ['Salt',                   null,         true,  'nessun prezzo memorizzato'],
    ['Extra Virgin Olive Oil', null,         true,  'nessun prezzo memorizzato'],
    ['Canned Tomatoes',        '2026-07-17', false, 'Hardie 17/07 e\' piu\' recente'],
  ];
  for (const [nome, stored, atteso, perche] of casi) {
    const eff = effectiveLastDate(stored, null);
    assert.strictEqual(chronologyAllows(eff, inArrivo), atteso, nome + ': ' + perche);
  }
});

test('8. i pesi che il writer ricaverebbe dai formati trascritti', () => {
  assert.strictEqual(Math.round(vdaiPackToGrams('25 KG')), 25000, 'sale');
  assert.strictEqual(Math.round(vdaiPackToGrams('10 KG')), 10000, 'gnocchi');
  assert.strictEqual(Math.round(vdaiPackToGrams('2/3.5#')), 3175, 'guanciale');
  assert.strictEqual(vdaiPackToGrams('3/5LT'), null,  'litri: serve la densita\'');
  assert.strictEqual(vdaiPackToGrams('6/#10'), null,  'lattina #10: peso non dichiarato');
  // il sale da' il numero pieno, senza nessuna assunzione
  assert.ok(Math.abs(34.50 / 25000 * 100 - 0.1380) < 0.0001);
});
