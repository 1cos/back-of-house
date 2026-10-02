// ─────────────────────────────────────────────────────────────────────
// CLAUDE-CLEAN0210 — peso fisso venduto a libbra (Hardie's)
//
// "CHZ MOZZ THIN SLICE 8/1#" a $4,82 al libbra: con DUE casse
// (importo $77,12) il parser la leggeva come voce normale e il prezzo
// finiva a $4,82 / 3.629 g = $0,13 / 100 g invece di $1,06.
// Fixture reale: 07133808 del 21/09/2026.
// ─────────────────────────────────────────────────────────────────────
'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const ROOT   = path.join(__dirname, '..');
const parser = require(path.join(ROOT, 'js/vendor-parsers/hardies-invoice.js'));
const { writeInvoiceLines } = require(path.join(ROOT, 'pure_logic.cjs'));

let pass = 0, fail = 0;
const queue = [];
const test = (n, f) => queue.push([n, f]);
const HARDIES = "Hardie's Fresh Foods / Dairyland Produce";
const LB = 453.592;

function pagina(righe) {
  return ['HARDIE\'S FRUIT & VEGETABLE CO', 'Invoice # 07133808   Date: 09/21/26', '']
    .concat(righe).concat(['', 'TOTAL   999.99']).join('\n');
}
function voci(righe) {
  return (parser.parse(pagina(righe)).items || []).filter(i => i.vendor_sku);
}
function fakeSb(rows) {
  const c = { select: () => c, eq: () => c, in: () => c, not: () => c, order: () => c,
    limit: async () => ({ data: [] }), insert: async r => { rows.push(...r); return { error: null }; },
    upsert: async () => ({ error: null }), update: () => c, delete: () => c };
  return { from: () => c };
}
async function scrivi(items) {
  const rows = [];
  await writeInvoiceLines(fakeSb(rows), 'doc', items, { total: null }, '2026-09-21', HARDIES, {}, {});
  return rows;
}

const MOZZ_2 = '2   2   27786   CHZ MOZZ THIN SLICE 21 SLI/LB   8/1#   4.82   77.12';
const MOZZ_1 = '1   1   27786   CHZ MOZZ THIN SLICE 21 SLI/LB   8/1#   4.82   38.56';

test('1. 07133808 REALE: due casse di mozzarella sono prezzo al libbra, non a collo', () => {
  const [it] = voci([MOZZ_2]);
  assert.strictEqual(it.price_type, 'per_lb');
  assert.strictEqual(it.cost_per_lb, 4.82);
  assert.notStrictEqual(it.catchweight, true, 'peso fisso: non e\' una pesata');
  assert.strictEqual(it.qty, 2, 'la quantita\' consegnata resta 2');
});

test('2. una cassa: stessa lettura', () => {
  const [it] = voci([MOZZ_1]);
  assert.strictEqual(it.price_type, 'per_lb');
  assert.strictEqual(it.qty, 1);
});

test('3. writer: cost_per_100g = $4,82 al libbra, quantita\' 2 conservata', async () => {
  const rows = await scrivi(voci([MOZZ_2]));
  assert.strictEqual(rows[0].cost_per_100g, parseFloat(((4.82 / LB) * 100).toFixed(4)));
  assert.ok(Math.abs(rows[0].cost_per_100g - 1.0626) < 0.0001, 'circa 1,06 / 100 g, non 0,13');
  assert.strictEqual(rows[0].qty, 2);
  assert.strictEqual(rows[0].line_total, 77.12, 'contabilita\' invariata');
});

test('4. MUTAZIONE: senza il ramo peso fisso il costo torna 8 volte piu\' basso', () => {
  const vecchio = (4.82 / (8 * LB)) * 100;
  assert.ok(vecchio < 0.14 && vecchio > 0.13, 'il vecchio valore era 0,1328');
});

test('5. una voce normale a collo non diventa prezzo al libbra', () => {
  const items = voci([
    '3   3   00459   CARROT JUMBO   5#   4.63   13.89',
    '4   4   25265   CHZ MOZZ SHRED GRANDE   5#   22.22   88.88',
  ]);
  for (const it of items) {
    assert.notStrictEqual(it.price_type, 'per_lb', it.vendor_sku);
    assert.strictEqual(it.cost_per_lb, null, it.vendor_sku);
    assert.notStrictEqual(it.catchweight, true, it.vendor_sku);
  }
});

test('6. le catchweight vere restano catchweight (parmigiano 86,2 lb, brochette)', () => {
  const items = voci([
    '1   1   00907   CHZ PARMESAN REGGIANO   80#   13.00   1120.60',
    '4   4   29554   ABR BROCHETTE MEAT   4 PC/12#   6.22   294.95',
    '1   1   13544   RWPR 103 RIB REF   1 PC/25#   29.40   1020.18',
  ]);
  for (const it of items) assert.strictEqual(it.catchweight, true, it.vendor_sku);
});

test('7. due rack Wagyu sulla stessa riga restano una pesata', () => {
  const [it] = voci(['2   2   13544   RWPR 103 RIB REF   1 PC/25#   29.40   1617.00']);
  assert.strictEqual(it.catchweight, true, '55 lb su due rack da 25# nominali');
  assert.ok(Math.abs(it.actual_weight_lb - 55) < 0.01);
});

test('8. la copia del parser dentro il worker e\' allineata', () => {
  const worker = fs.readFileSync(path.join(ROOT, 'edge-functions/vendor-doc-auto-import/index.ts'), 'utf8');
  const m = worker.match(/"hardies-invoice": (".*?(?<!\\)"),\n/s);
  assert.ok(m, 'blocco embedded trovato');
  assert.strictEqual(JSON.parse(m[1]),
    fs.readFileSync(path.join(ROOT, 'js/vendor-parsers/hardies-invoice.js'), 'utf8'));
});

(async () => {
  for (const [n, f] of queue) {
    try { await f(); pass++; console.log('  ok  ' + n); }
    catch (e) { fail++; console.log('  FAIL ' + n + '\n       ' + e.message); }
  }
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
