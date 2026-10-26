// B-77 (MR-20, Max 24/10 e 26/10/2026) — casse approvate dallo Chef: pezzi e/o grammi di una cassa per QUEL pack di QUEL
// fornitore (tabella casse_approvate, attaccata alla riga esistente come row.casse_approvate).
//  - Pomodoro Hardie's 71904 "16-22 CT" = 22 pezzi: il prezzo a pezzo segue la cassa a ogni fattura.
//  - Romaine "12/3 CT" = 7.500 g (non più 22.536) e "40-48ct" = 14.500 g: il prezzo al grammo segue la cassa.

const assert = require('assert');
const M = require('../js/vendor-parsers/price-intelligence-merge.js');

let pass = 0, fail = 0;
const test = (n, f) => { try { f(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + '\n      ' + e.message); } };
const r4 = (x) => Math.round(x * 10000) / 10000;
const obs = (o) => ({ unit_price: 27.53, pack_description: '16-22 CT', price_type: 'per_case', conversion_to_base: null, price_per_100g: null, last_invoice_date: '2026-10-23', ...o });
const pomodoro = (o) => ({ pack_description: '16-22 CT', conversion_to_base: null, price_per_100g: null, casse_approvate: [{ pack: '16-22 CT', pezzi: 22, grammi: null }], ...o });
const romaine = (o) => ({ pack_description: '12/3 CT', conversion_to_base: 22536, price_per_100g: 0.2623, price_per_each: 1.6419,
  casse_approvate: [{ pack: '12/3 CT', pezzi: null, grammi: 7500 }, { pack: '40-48ct', pezzi: null, grammi: 14500 }], ...o });
const oRom = (o) => ({ unit_price: 59.11, pack_description: '12/3 CT', price_type: 'per_case', conversion_to_base: 22536, price_per_100g: 59.11 / 22536 * 100, last_invoice_date: '2026-10-27', ...o });

test('1. pomodoro "16-22 CT" con 22 pezzi approvati: 27,53 / 22 = 1,2514 a pezzo', () => {
  const m = M.mergePriceIntelligence(pomodoro(), obs());
  assert.strictEqual(m.skipped, false); assert.strictEqual(r4(m.fields.price_per_each), 1.2514); assert.strictEqual(m.approvata, true);
});
test('2. fattura dopo a 30,00: il prezzo a pezzo segue (30 / 22)', () => {
  assert.strictEqual(r4(M.mergePriceIntelligence(pomodoro(), obs({ unit_price: 30 })).fields.price_per_each), r4(30 / 22));
});
test('3. senza casse approvate: come oggi, price_per_each non viene toccato', () => {
  const m = M.mergePriceIntelligence(pomodoro({ casse_approvate: [] }), obs());
  assert.strictEqual(m.skipped, false); assert.ok(!('price_per_each' in m.fields));
});
test('4. pack nuovo non approvato ("20-24 CT"): non si scrive niente (fail-closed, come oggi)', () => {
  const m = M.mergePriceIntelligence(pomodoro(), obs({ pack_description: '20-24 CT' }));
  assert.strictEqual(m.skipped, true); assert.strictEqual(m.reason, 'unresolved_pack_change');
});
test('5. trappola di oggi: riga "18 ct", fattura "16-22 CT" approvata → aggiorna con /22 (prima rifiutata)', () => {
  assert.strictEqual(M.mergePriceIntelligence(pomodoro({ pack_description: '18 ct', casse_approvate: [] }), obs()).skipped, true);
  const m = M.mergePriceIntelligence(pomodoro({ pack_description: '18 ct' }), obs());
  assert.strictEqual(m.skipped, false); assert.strictEqual(m.fields.pack_description, '16-22 CT'); assert.strictEqual(r4(m.fields.price_per_each), 1.2514);
});
test('6. un pack che stampa i pezzi ("18 CT") vince: 27,53 / 18', () => {
  assert.strictEqual(r4(M.mergePriceIntelligence(pomodoro(), obs({ pack_description: '18 CT' })).fields.price_per_each), r4(27.53 / 18));
});
test('7. fattura senza pack: si tiene "16-22 CT" e si usa 22', () => {
  const m = M.mergePriceIntelligence(pomodoro(), obs({ pack_description: '' }));
  assert.strictEqual(m.rescued, true); assert.strictEqual(r4(m.fields.price_per_each), 1.2514);
});
test('8. maiuscole e spazi non contano (" 16-22  ct")', () => {
  assert.strictEqual(r4(M.mergePriceIntelligence(pomodoro(), obs({ pack_description: ' 16-22  ct' })).fields.price_per_each), 1.2514);
});
test('9. valori non validi (0, 21,5, testo, negativi) ignorati', () => {
  for (const v of [0, 21.5, 'ventidue', -3]) assert.ok(!('price_per_each' in M.mergePriceIntelligence(pomodoro({ casse_approvate: [{ pack: '16-22 CT', pezzi: v }] }), obs()).fields), String(v));
});
test('10. riga nuova (nessuna riga esistente): nessun valore inventato', () => {
  assert.ok(!('price_per_each' in M.mergePriceIntelligence(null, obs()).fields));
});
test('11. mai sopra un peso stampato: "1/ 50 LB" con una cassa "approvata" resta identico', () => {
  const ex = { pack_description: '1/ 50 LB', conversion_to_base: 22680, price_per_100g: 0.3, casse_approvate: [{ pack: '1/ 50 LB', pezzi: 10, grammi: 1000 }] };
  const o = { unit_price: 40, pack_description: '1/ 50 LB', price_type: 'per_case', conversion_to_base: 22680, price_per_100g: 40 / 22680 * 100, last_invoice_date: '2026-10-23' };
  assert.deepStrictEqual(M.mergePriceIntelligence(ex, o).fields, M.mergePriceIntelligence({ ...ex, casse_approvate: [] }, o).fields);
});
test('12. pack a pezzi fissi ("10/ 100 CT"): identico a prima (MICRO-TASK 89A)', () => {
  const m = M.mergePriceIntelligence({ pack_description: '10/ 100 CT', casse_approvate: [{ pack: '10/ 100 CT', pezzi: 7 }] },
    { unit_price: 53, pack_description: '10/ 100 CT', price_type: 'per_case', conversion_to_base: null, price_per_100g: null, last_invoice_date: '2026-10-23' });
  assert.strictEqual(m.fields.price_per_each, 0.053);
});
test('13. Romaine "12/3 CT" con 7.500 g: conversione 7.500 (non 22.536), 59,11 → 0,7881 $/100 g', () => {
  const m = M.mergePriceIntelligence(romaine(), oRom());
  assert.strictEqual(m.fields.conversion_to_base, 7500); assert.strictEqual(r4(m.fields.price_per_100g), 0.7881);
  assert.strictEqual(r4(m.fields.price_per_each), r4(59.11 / 36), 'i 36 cuori stampati restano');
});
test('14. Romaine "40-48ct" con 14.500 g: prima rifiutata, ora entra: 46,53 → 0,3209 $/100 g', () => {
  assert.strictEqual(M.mergePriceIntelligence(romaine({ casse_approvate: [] }), oRom({ unit_price: 46.53, pack_description: '40-48ct', conversion_to_base: null, price_per_100g: null })).skipped, true);
  const m = M.mergePriceIntelligence(romaine(), oRom({ unit_price: 46.53, pack_description: '40-48ct', conversion_to_base: null, price_per_100g: null }));
  assert.strictEqual(m.skipped, false); assert.strictEqual(m.fields.conversion_to_base, 14500); assert.strictEqual(r4(m.fields.price_per_100g), 0.3209);
  assert.ok(!('price_per_each' in m.fields), 'i pezzi di una 40-48 non si sanno: il prezzo a pezzo non viene toccato');
});
test('15. dopo una 40-48 torna la "12/3 CT": di nuovo 7.500 g', () => {
  const m = M.mergePriceIntelligence(romaine({ pack_description: '40-48ct', conversion_to_base: 14500 }), oRom());
  assert.strictEqual(m.skipped, false); assert.strictEqual(m.fields.conversion_to_base, 7500);
});
test('16. Romaine "12/3 CT" senza fattura con il pack (troncato): si tiene la cassa e i grammi dello Chef', () => {
  const m = M.mergePriceIntelligence(romaine(), oRom({ pack_description: '', conversion_to_base: null, price_per_100g: null }));
  assert.strictEqual(m.rescued, true); assert.strictEqual(m.fields.conversion_to_base, 7500); assert.strictEqual(r4(m.fields.price_per_100g), 0.7881);
});
test('17. prezzo al libbra (per_lb): i grammi approvati non contano', () => {
  const m = M.mergePriceIntelligence(romaine(), oRom({ price_type: 'per_lb', unit_price: 2.5, conversion_to_base: null, price_per_100g: 2.5 / 453.592 * 100 }));
  assert.strictEqual(m.fields.conversion_to_base, null); assert.strictEqual(r4(m.fields.price_per_100g), r4(2.5 / 453.592 * 100));
});

console.log((fail ? '✗' : '✓') + ` B-77: ${pass} passati, ${fail} falliti`);
process.exit(fail ? 1 : 0);
