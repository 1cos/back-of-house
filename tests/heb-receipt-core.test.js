// HEB01 — logica pura dello scontrino H-E-B, sul caso reale del 02/10/2026.
'use strict';
const assert = require('assert');
const path = require('path');

const FIXTURE = [
  { description: 'PORTERHOUSE STEAK USDA PR', amount: 46.52 },
  { description: 'BF RE RST PRIME BNLS 6-8', amount: 247.44 },
  { description: 'PRIME NY STRIP STEAK VP', amount: 175.85 },
  { description: 'BF RE RST PRIME BNLS 6-8', amount: 285.61 },
  { description: 'PRIME NY STRIP STEAK VP', amount: 143.23 },
  { description: 'TENDERLOIN ROAST USDA PR', amount: 99.93 },
  { description: 'TENDERLOIN ROAST USDA PR', amount: 98.57 },
  { description: 'TENDERLOIN ROAST USDA PR', amount: 106.39 },
  { description: 'TENDERLOIN ROAST USDA PR', amount: 90.07 },
];
const ING = { porter: 'p-1', nys: 'n-1', filet: 'f-1', ribeye: 'r-1' };
const HISTORY = [ // le righe di giugno gia' collegate (storico reale)
  { raw_description: 'PORTERHOUSE STEAK USDA PR F', ingredient_id: ING.porter },
  { raw_description: 'PRIME NY STRIP STEAK VP F', ingredient_id: ING.nys },
  { raw_description: 'WHOLE PRIME BEEF TENDERLO', ingredient_id: ING.filet },
  { raw_description: 'BF RE RST PRIME BNLS 6-8', ingredient_id: null },
];
const INGREDIENTS = [
  { id: ING.porter, name: 'Porterhouse' }, { id: ING.nys, name: 'New York Strip' },
  { id: ING.filet, name: 'Beef Filet' }, { id: ING.ribeye, name: 'Ribeye' },
];

let pass = 0, fail = 0;
const queue = [];
const test = (n, f) => queue.push([n, f]);

(async () => {
  const core = await import(path.join(__dirname, '..', 'edge-functions/heb-receipt/heb-core.mjs'));
  const lines = core.normalizeLines(FIXTURE);

  test('1. 9 righe, ognuna resta una confezione con il suo importo', () => {
    assert.strictEqual(lines.length, 9);
    assert.deepStrictEqual(lines.map((l) => l.amount), FIXTURE.map((f) => f.amount));
  });

  test('2. il totale torna al centesimo con $1,293.61', () => {
    const r = core.reconcile(lines, 1293.61);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.lines_sum, 1293.61);
  });

  test('3. un totale che non torna blocca (differenza mostrata)', () => {
    const r = core.reconcile(lines, 1300);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.difference, 6.39);
    assert.strictEqual(core.reconcile(lines.slice(0, 8), 1293.61).ok, false, 'una riga persa non passa');
  });

  const groups = core.buildGroups(lines, { history: HISTORY, ingredients: INGREDIENTS });
  const by = (k) => groups.find((g) => g.key === k);

  test('4. 4 famiglie, ma le righe restano separate dentro il gruppo', () => {
    assert.strictEqual(groups.length, 4);
    assert.deepStrictEqual(by('TENDERLOIN ROAST USDA PR').line_idx, [6, 7, 8, 9]);
    assert.strictEqual(by('TENDERLOIN ROAST USDA PR').amount, 394.96);
    assert.strictEqual(by('BF RE RST PRIME BNLS 6-8').amount, 533.05);
    assert.strictEqual(by('PRIME NY STRIP STEAK VP').amount, 319.08);
  });

  test('5. domande DINAMICHE: mappatura solo dove non e\' confermata, pezzi ovunque', () => {
    for (const g of groups) {
      assert.ok(g.questions.some((q) => q.kind === 'mapping'), g.key + ': prima volta, mappatura da confermare');
      assert.ok(g.questions.some((q) => q.kind === 'pieces'), g.key + ': pezzi sconosciuti');
      assert.ok(g.questions.every((q) => q.why), 'ogni domanda spiega perche\' serve');
    }
  });

  test('6. suggerimenti dallo storico, mai come certezza; rib roast senza proposta', () => {
    assert.strictEqual(by('PORTERHOUSE STEAK USDA PR').ingredient_id, ING.porter);
    assert.strictEqual(by('PRIME NY STRIP STEAK VP').ingredient_id, ING.nys);
    assert.strictEqual(by('PORTERHOUSE STEAK USDA PR').mapping_confirmed, false);
    assert.strictEqual(by('BF RE RST PRIME BNLS 6-8').ingredient_id, null, 'a giugno non era collegato: nessuna proposta inventata');
  });

  test('7. con la mappatura confermata la domanda di mappatura sparisce, resta solo pezzi', () => {
    const aliases = [{ vendor_description: 'TENDERLOIN ROAST USDA PR', ingredient_id: ING.filet, notes: { ask: 'pieces', std_g: 226.8 } }];
    const g = core.buildGroups(lines, { aliases, history: HISTORY, ingredients: INGREDIENTS, last: { 'TENDERLOIN ROAST USDA PR': { pieces: 21 } } })
      .find((x) => x.key === 'TENDERLOIN ROAST USDA PR');
    assert.deepStrictEqual(g.questions.map((q) => q.kind), ['pieces']);
    assert.strictEqual(g.questions[0].last_answer, 21, 'ultima risposta proposta, non usata come valore');
    assert.strictEqual(g.std_g, 226.8);
  });

  test('8. costo per pezzo = importo del gruppo / pezzi dichiarati', () => {
    const d = core.derive(by('TENDERLOIN ROAST USDA PR'), { pieces: 20, std_g: 226.8 });
    assert.strictEqual(d.ok, true);
    assert.strictEqual(d.cost_each, 19.75);
    assert.strictEqual(d.cost_per_100g, Math.round((394.96 / 20 / 226.8) * 100 * 10000) / 10000);
    assert.strictEqual(core.derive(by('PORTERHOUSE STEAK USDA PR'), { pieces: 2 }).cost_each, 23.26);
  });

  test('9. senza pezzi (o con pezzi non interi) niente costo', () => {
    assert.strictEqual(core.derive(by('PORTERHOUSE STEAK USDA PR'), {}).ok, false);
    assert.strictEqual(core.derive(by('PORTERHOUSE STEAK USDA PR'), { pieces: 2.5 }).ok, false);
    assert.strictEqual(core.derive(by('PORTERHOUSE STEAK USDA PR'), { pieces: 0 }).ok, false);
  });

  test('10. peso stampato sullo scontrino: nessuna domanda di peso', () => {
    const wl = core.normalizeLines([{ description: 'GROUND BEEF 80/20', amount: 21.38, weight_lb: 4.28, price_per_lb: 4.99 }]);
    const aliases = [{ vendor_description: 'GROUND BEEF 80/20', ingredient_id: 'g-1', notes: '{"ask":"weight"}' }];
    const [g] = core.buildGroups(wl, { aliases });
    assert.deepStrictEqual(g.questions, []);
    const d = core.derive(g, {});
    assert.strictEqual(d.cost_per_lb, 5);
  });

  test('11. flag fiscale finale non crea un gruppo diverso', () => {
    assert.strictEqual(core.groupKey('PORTERHOUSE STEAK USDA PR F'), core.groupKey('porterhouse  steak usda pr'));
  });

  test('12. riga con lettura incerta marcata da verificare, mai riempita', () => {
    const l = core.normalizeLines([{ description: 'X', amount: null }, { description: 'Y', amount: 10, confidence: 0.5 }]);
    assert.strictEqual(l[0].needs_check, true);
    assert.strictEqual(l[0].amount, null);
    assert.strictEqual(l[1].needs_check, true);
    assert.strictEqual(core.reconcile(l, 10).ok, false, 'un importo mancante blocca l\'import');
  });

  test('13. identita\' dello scontrino stabile', () => {
    assert.strictEqual(core.receiptNumber({ store: '752', date: '2026-10-02', time: '12:54', total: 1293.61 }), 'HEB-752-20261002-1254-129361');
  });

  for (const [n, f] of queue) {
    try { await f(); pass++; console.log('  ok  ' + n); }
    catch (e) { fail++; console.log('  FAIL ' + n + '\n       ' + e.message); }
  }
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
