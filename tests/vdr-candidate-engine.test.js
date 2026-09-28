// ══════════════════════════════════════════════════════════════════
// IL MOTORE DI CANDIDATI — js/vendor-documents-review.js
//
// Gira contro la funzione VERA, estratta dalla sorgente e valutata.
// Nessuna copia della logica qui dentro: se il file cambia, cambia il
// test. Le descrizioni e gli ingredienti sono dati REALI di produzione
// (fatture 07133828, 014fbb7f e 28ff13e1 del 22-25 settembre 2026).
// ══════════════════════════════════════════════════════════════════
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'vendor-documents-review.js'), 'utf8');

const BLOCCO = SRC.split('// ── MARKER:VDR_CANDIDATES_START')[1]
                  .split('// ── MARKER:VDR_CANDIDATES_END')[0]
                  .replace(/^[^\n]*\n/, '');   // via i trattini di coda del marker
assert.ok(BLOCCO && BLOCCO.length > 500, 'blocco del motore non trovato nella sorgente');

const window = {};
eval(BLOCCO);
const trova = window.vdrFindIngredientCandidates;

// Anagrafica reale: le 37 schede attive non-Supply che condividono
// almeno una parola con le dieci descrizioni. Copiata da produzione.
const INGR = [
  { name: 'Beef Steak Tomatoes',            category: 'Produce' },
  { name: 'Beets',                          category: 'Produce' },
  { name: 'Beets Puree',                    category: 'Prepared' },
  { name: 'Brown Sugar',                    category: 'Dry Goods' },
  { name: 'Canned Tomatoes',                category: 'Produce' },
  { name: 'Cherry Tomatoes',                category: 'Produce' },
  { name: 'Confit Tomatoes',                category: 'Prepared' },
  { name: 'Diced Tomato',                   category: 'Produce' },
  { name: 'Floor & All Purpose Cleaner',    category: 'Kitchen Supplies' },
  { name: 'Grease Filter Cone 10 in',       category: 'Kitchen Supplies' },
  { name: 'Lemon Juice',                    category: 'Beverages & Spirits' },
  { name: 'Orange',                         category: 'Produce' },
  { name: 'Orange Juice',                   category: 'Beverages & Spirits' },
  { name: 'Orange Zest',                    category: 'Produce' },
  { name: 'Oven Cleaner',                   category: 'Kitchen Supplies' },
  { name: 'Oven Mitt 16 in Tan',            category: 'Kitchen Supplies' },
  { name: 'Pastry Bag 21 in Disposable',    category: 'Kitchen Supplies' },
  { name: 'Peaches',                        category: null },
  { name: 'Powdered Sugar',                 category: 'Dry Goods' },
  { name: 'Purple potatoes',                category: null },
  { name: 'Soffritto',                      category: 'Prepared' },
  { name: 'Sugar',                          category: 'Dry Goods' },
  { name: 'Sun Dried Tomatoes',             category: 'Produce' },
  { name: 'Tomato Paste',                   category: 'Produce' },
  { name: 'Tomato Puree',                   category: 'Produce' },
  { name: 'White Grapes',                   category: 'Beverages & Spirits' },
].map(function(x, i) { return Object.assign({ id: 'i' + i }, x); });

const nomi = function(desc) { return trova(desc, INGR).map(function(c) { return c.name; }); };

// ── I CINQUE CASI PERICOLOSI CHE MAX HA CHIESTO DI DIMOSTRARE ──────

test('1. il cavolo non suggerisce Brown Sugar', function() {
  const c = nomi('CABBAGE SUGAR CONE ROW 7');
  assert.ok(!c.includes('Brown Sugar'), 'Brown Sugar proposto: ' + JSON.stringify(c));
  assert.ok(!c.includes('Sugar'),        'Sugar proposto: ' + JSON.stringify(c));
  assert.ok(!c.includes('Powdered Sugar'));
  assert.deepStrictEqual(c, [], 'nessun ingrediente e\' un cavolo: la risposta giusta e\' nessun candidato');
});

test('2. Yellow Squash non suggerisce Peaches', function() {
  const c = nomi('Fresh Yellow Squash, Each');
  assert.ok(!c.includes('Peaches'), '"each" non deve piu\' pescare "p-each-es": ' + JSON.stringify(c));
  assert.deepStrictEqual(c, []);
});

test('3. le arance non suggeriscono Pastry Bag, e propongono Orange', function() {
  const c = nomi('Fresh Navel Oranges, 4 lb Bag');
  assert.ok(!c.includes('Pastry Bag 21 in Disposable'), '"bag" non deve pescare "Pastry Bag": ' + JSON.stringify(c));
  assert.strictEqual(c[0], 'Orange', 'il plurale "oranges" deve trovare "Orange": ' + JSON.stringify(c));
  assert.ok(!c.includes('Orange Juice'), 'un succo non e\' un\'arancia');
  assert.ok(!c.includes('Orange Zest'),  'una scorza non e\' un\'arancia');
});

test('4. il pomodoro fresco non si confonde con le conserve', function() {
  const c = nomi('TOMATO HEIRLOOM');
  ['Tomato Paste','Tomato Puree','Diced Tomato','Canned Tomatoes','Sun Dried Tomatoes','Confit Tomatoes']
    .forEach(function(x) { assert.ok(!c.includes(x), x + ' proposto per pomodoro fresco: ' + JSON.stringify(c)); });
  assert.ok(!c.includes('Cherry Tomatoes'), 'un ciliegino non e\' un cuore di bue');
  assert.deepStrictEqual(c, [], 'serve un ingrediente nuovo, e il motore deve dirlo tacendo');
});

test('5. White Grapes non viene proposto per primo: in anagrafica e\' uva da vino', function() {
  const full = trova('GRAPES WHITE SEEDLESS', INGR);
  const wg = full.find(function(x) { return x.name === 'White Grapes'; });
  assert.ok(wg, 'il candidato deve esistere, ma marcato');
  assert.strictEqual(wg.needsConfirmation, true, 'Beverages & Spirits senza parola da bevanda');
  const automatici = full.filter(function(x) { return !x.needsConfirmation; });
  assert.strictEqual(automatici.length, 0,
    'non deve esistere NESSUNA proposta automatica: ' + JSON.stringify(automatici.map(function(x){return x.name;})));
});

// ── I DIECI PRODOTTI REALI APPENA IMPORTATI ───────────────────────

test('6. i tre collegamenti che Max vuole approvare escono corretti', function() {
  assert.strictEqual(nomi('Simply Orange Pulp-Free Orange 5 Juice Bottle, 46 fl oz')[0],
    'Orange Juice', 'la parola "juice" c\'e\' in entrambi');
  assert.strictEqual(nomi('Fresh Navel Oranges, 4 lb Bag')[0], 'Orange');
  assert.strictEqual(nomi('Easy-Off Fume Free Oven Cleaner Foam, Removes Grease & Burned-On Food, For Ovens, Air Fryers & More 14.5oz')[0],
    'Oven Cleaner');
});

test('7. Beets esce per le barbabietole, la sua purea no', function() {
  const c = nomi('BEET BABY MIXED');
  assert.strictEqual(c[0], 'Beets', 'singolare/plurale: BEET -> Beets');
  assert.ok(!c.includes('Beets Puree'), 'una purea non e\' una barbabietola cruda');
});

test('8. i grissini non hanno candidati: serve un ingrediente nuovo', function() {
  assert.deepStrictEqual(nomi('BREADSTIXS GRISSINI WRAPPED'), []);
});

test('9. il cavolo napa non pesca Purple potatoes', function() {
  const c = nomi('CABBAGE NAPA PURPLE HEART');
  assert.ok(!c.includes('Purple potatoes'), JSON.stringify(c));
  assert.deepStrictEqual(c, []);
});

// ── COERENZA ALIMENTARE, NEI DUE VERSI ────────────────────────────

test('10. un detergente non pesca ingredienti, e un alimento non pesca detergenti', function() {
  const pulizia = nomi('Easy-Off Fume Free Oven Cleaner Foam, Removes Grease & Burned-On Food, For Ovens, Air Fryers & More 14.5oz');
  assert.ok(!pulizia.includes('Soffritto'), 'un soffritto non e\' un detergente');
  assert.ok(!pulizia.includes('Floor & All Purpose Cleaner'), 'copertura piena: manca "floor"');
  assert.ok(!pulizia.includes('Grease Filter Cone 10 in'), 'copertura piena: manca "filter"');
  // verso opposto: una descrizione alimentare non deve pescare Kitchen Supplies
  assert.ok(!nomi('Fresh Navel Oranges, 4 lb Bag').some(function(n) {
    return ['Pastry Bag 21 in Disposable','Oven Mitt 16 in Tan'].indexOf(n) > -1;
  }));
});

// ── PROPRIETA' GENERALI ───────────────────────────────────────────

test('11. singolare e plurale, nelle due direzioni', function() {
  const s = window.vdrSingular;
  assert.strictEqual(s('tomatoes'), 'tomato');
  assert.strictEqual(s('oranges'),  'orange');
  assert.strictEqual(s('grapes'),   'grape');
  assert.strictEqual(s('beets'),    'beet');
  assert.strictEqual(s('peaches'),  'peach');
  assert.strictEqual(s('berries'),  'berry');
  assert.strictEqual(s('glass'),    'glass', 'una doppia s non e\' un plurale');
  assert.strictEqual(s('gas'),      'gas',   'troppo corta per togliere la s');
});

test('12. il motore non collega mai da solo: restituisce proposte, non scritture', function() {
  const r = trova('Fresh Navel Oranges, 4 lb Bag', INGR);
  assert.ok(Array.isArray(r));
  r.forEach(function(c) {
    assert.ok('score' in c && 'needsConfirmation' in c);
    assert.ok(!('saved' in c) && !('linked' in c), 'nessun effetto collaterale');
  });
  assert.ok(JSON.stringify(INGR).indexOf('score') === -1, 'l\'anagrafica non viene mutata');
});

test('13. descrizione vuota o solo qualificatori: nessun candidato', function() {
  assert.deepStrictEqual(trova('', INGR), []);
  assert.deepStrictEqual(trova('   ', INGR), []);
  assert.deepStrictEqual(trova('LARGE FRESH WHOLE', INGR), [],
    'solo stop words: non c\'e\' niente da cercare');
});

test('14. esiste UNA sola copia del motore in tutto il file', function() {
  // Nessuna seconda IMPLEMENTAZIONE: niente STOP_WORDS locali, niente
  // punteggio a sottostringhe. Resta un solo wrapper che delega.
  assert.strictEqual((SRC.match(/const STOP_WORDS = \[/g) || []).length, 0);
  assert.strictEqual((SRC.match(/const stop = \['large'/g) || []).length, 0);
  assert.strictEqual((SRC.match(/\.indexOf\(k\) > -1/g) || []).length, 0,
    'il punteggio a sottostringhe non deve sopravvivere da nessuna parte');
  assert.strictEqual((SRC.match(/window\.vdrFindIngredientCandidates = function/g) || []).length, 1);
  // entrambe le modali devono passare dalla funzione unica
  assert.ok(SRC.indexOf('const findMatches = window.vdrFindIngredientCandidates;') > -1);
  assert.ok(SRC.indexOf('function findMatches(desc) { return window.vdrFindIngredientCandidates(desc, ingrs); }') > -1);
});

test('15. descrizione povera: propone il piu\' specifico, ma marcato', function() {
  // Una riga che dice solo "Chicken" non dichiara il taglio. Il candidato
  // esce comunque — altrimenti non uscirebbe mai niente — ma needsConfirmation
  // dice che quella specificita' e' un'ipotesi, non un dato della fattura.
  const pollo = [{ id:'p1', name:'Chicken Breast', category:'Meat' },
                 { id:'p2', name:'Fried Chicken',  category:'Prepared' }];
  const r = trova('Chicken A', pollo);
  assert.strictEqual(r.length, 1, 'solo chi COMINCIA con la parola della fattura');
  assert.strictEqual(r[0].name, 'Chicken Breast');
  assert.strictEqual(r[0].needsConfirmation, true, 'il taglio non e\' dichiarato in fattura');
});

test('16. la regola povera non riapre i casi pericolosi', function() {
  // Tutti hanno 2+ parole portanti, quindi restano sotto la regola stretta.
  assert.deepStrictEqual(nomi('CABBAGE SUGAR CONE ROW 7'), []);
  assert.deepStrictEqual(nomi('TOMATO HEIRLOOM'), []);
  assert.deepStrictEqual(nomi('Fresh Yellow Squash, Each'), []);
  assert.ok(!nomi('Fresh Navel Oranges, 4 lb Bag').includes('Pastry Bag 21 in Disposable'));
});
