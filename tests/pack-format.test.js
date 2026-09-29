// FC04-UX — lettura del formato della confezione e calcolo dei grammi.
// Formati presi dai fornitori veri di Brigade.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const window = {};
global.window = window;
eval(fs.readFileSync(path.join(__dirname, '..', 'js', 'pack-format.js'), 'utf8'));
const L = t => JSON.parse(JSON.stringify(window.pkLeggi(t)));

test('1. formati dei fornitori letti senza reinserirli', () => {
  assert.deepStrictEqual(L('12/1 QT'), { confezioni: 12, quantita: 1, unita: 'qt' });
  assert.deepStrictEqual(L('6 CT'), { confezioni: 6, quantita: 1, unita: 'pz' });
  assert.deepStrictEqual(L('3/5LT'), { confezioni: 3, quantita: 5, unita: 'l' });
  assert.deepStrictEqual(L('2/ 5 LTR'), { confezioni: 2, quantita: 5, unita: 'l' });
  assert.deepStrictEqual(L('1 GAL'), { confezioni: 1, quantita: 1, unita: 'gal' });
  assert.deepStrictEqual(L('9-1/2 GAL'), { confezioni: 9, quantita: 0.5, unita: 'gal' });
  assert.deepStrictEqual(L('10 KG'), { confezioni: 1, quantita: 10, unita: 'kg' });
  assert.deepStrictEqual(L('5#'), { confezioni: 1, quantita: 5, unita: 'lb' });
  assert.deepStrictEqual(L('4X5LB'), { confezioni: 4, quantita: 5, unita: 'lb' });
  assert.deepStrictEqual(L('8/12 OZ'), { confezioni: 8, quantita: 12, unita: 'oz' });
  assert.deepStrictEqual(L('1 DZ'), { confezioni: 1, quantita: 12, unita: 'pz' });
});

test('2. nessuna ipotesi su formati ambigui', () => {
  assert.strictEqual(window.pkLeggi('16-22 CT'), null, 'intervallo');
  assert.strictEqual(window.pkLeggi('6/#10'), null, 'lattine #10');
  assert.strictEqual(window.pkLeggi('Case'), null);
  assert.strictEqual(window.pkLeggi(''), null);
});

test('3. pesi: conversione automatica, fonte "documentato"', () => {
  const r = window.pkGrammi(window.pkLeggi('2/5LB'));
  assert.strictEqual(Math.round(r.grammi), 4536);
  assert.strictEqual(r.fonte, 'documentato');
});

test('4. volumi: MAI da soli in grammi (niente 1 L = 1 kg per la panna)', () => {
  const r = window.pkGrammi(window.pkLeggi('12/1 QT'));
  assert.strictEqual(r.grammi, null);
  assert.strictEqual(r.manca, 'peso_confezione');
  assert.match(r.spiegazione, /una confezione da 1 US qt/);
  assert.strictEqual(window.pkTotale(window.pkLeggi('12/1 QT')).quantita, 12 * 946.353, 'il volume si calcola');
});

test('5. Heavy Cream: 908 g per QT -> 12 confezioni = 10.896 g, $0,6791/100 g', () => {
  const f = window.pkLeggi('12/1 QT');
  const d = window.pkDichiara(f, 908);
  const r = window.pkGrammi(f, d);
  assert.ok(Math.abs(r.grammi - 10896) < 1e-9);
  assert.strictEqual(r.fonte, 'chef');
  assert.strictEqual(r.spiegazione, '12 × 908 g = 10.896 g');
  assert.strictEqual(window.pkPrezzo100(73.99, r.grammi).toFixed(4), '0.6791');
  // la stessa dichiarazione vale per un gallone
  assert.ok(Math.abs(window.pkGrammi(window.pkLeggi("1 GAL"), d).grammi - 908 * 3785.41 / 946.353) < 1e-6);
});

test('6. Parsley: 6 mazzi x 100 g = 600 g, $0,5917/100 g', () => {
  const f = window.pkLeggi('6 CT');
  const r = window.pkGrammi(f, window.pkDichiara(f, 100));
  assert.strictEqual(r.grammi, 600);
  assert.strictEqual(window.pkPrezzo100(3.55, 600).toFixed(4), '0.5917');
});

test('7. peso totale gia\' noto: vince, fonte "totale"', () => {
  const r = window.pkGrammi(window.pkLeggi('12/1 QT'), null, 11000);
  assert.strictEqual(r.grammi, 11000);
  assert.strictEqual(r.fonte, 'totale');
});

test('8. riga di audit: distingue la fonte e non inventa dichiarazioni', () => {
  const st = { formato: window.pkLeggi('10 KG'), dich: null, risultato: window.pkGrammi(window.pkLeggi('10 KG')) };
  const r = window.pkRigaAudit(st, { id: 'v', ingredient_id: 'i', vendor: 'GG', pack_description: '10 KG' }, 10000, 0.7457, 'Max');
  assert.strictEqual(r.assunzioni.fonte, 'documentato');
  assert.strictEqual(r.assunzioni.dichiarazione, null);
  assert.strictEqual(r.eseguito_da, 'Max');
  assert.strictEqual(window.pkRigaAudit({ risultato: { grammi: null } }, {}, null, null), null);
});

test('9. numeri all\'italiana', () => {
  assert.strictEqual(window.pkNum(10896), '10.896');
  assert.strictEqual(window.pkNum(0.6791, 4), '0,6791');
  assert.strictEqual(window.pkNum(0.5), '0,5');
});
