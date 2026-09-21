// ─────────────────────────────────────────────────────────────────────
// INV08G — su una catchweight il prezzo e' al LIBBRA
//
// invoice_lines.cost_per_100g usava (unit_price / grammi) x 100, che
// presuppone unit_price = prezzo dell'intero collo. Su una catchweight
// e' il prezzo di UNA LIBBRA, e il risultato finisce circa 86 volte
// sotto il vero. Il ramo giusto esisteva gia' nel blocco price
// intelligence: mancava solo nel writer.
//
// Fixture reale: 07004208, la fattura recuperata in INV08D.
//   $13,00/lb · 86,20 lb · $1.120,60
// ─────────────────────────────────────────────────────────────────────
'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const ROOT   = path.join(__dirname, '..');
const { writeInvoiceLines } = require(path.join(ROOT, 'pure_logic.cjs'));
const parser = require(path.join(ROOT, 'js/vendor-parsers/hardies-invoice.js'));

let pass = 0, fail = 0;
const queue = [];
const test = (n, f) => queue.push([n, f]);
const HARDIES = "Hardie's Fresh Foods / Dairyland Produce";
const LB = 453.592;

function fakeSb(rows) {
  const c = { select: () => c, eq: () => c, in: () => c, not: () => c, order: () => c,
    limit: async () => ({ data: [] }), insert: async r => { rows.push(...r); return { error: null }; },
    upsert: async () => ({ error: null }), update: () => c, delete: () => c };
  return { from: () => c };
}
async function scrivi(items, vendor) {
  const rows = [];
  await writeInvoiceLines(fakeSb(rows), 'doc', items, { total: null }, '2026-06-17',
    vendor || HARDIES, {}, {});
  return rows;
}

// La voce REALE di 07004208, come la emette il parser.
const VOCE_REALE = {
  vendor_sku: '00907', description: 'CHZ PARMESAN REGGIANO 24 MOS',
  qty: 1, qty_ordered: 1, qty_received: 1, pack_description: '80#',
  catchweight: true, price_per_lb: 13, actual_weight_lb: 86.2,
  unit_price: 13, amount: 1120.6,
};

test('1. 07004208 REALE: cost_per_100g dal peso effettivamente consegnato', async () => {
  const rows = await scrivi([VOCE_REALE]);
  // La regola numerica del sistema, applicata: importo / grammi x 100.
  const grammi = 86.2 * LB;
  const atteso = parseFloat(((1120.6 / grammi) * 100).toFixed(4));
  assert.strictEqual(rows[0].estimated_total_g, Math.round(grammi), 'grammi dal peso reale');
  assert.strictEqual(rows[0].cost_per_100g, atteso,
    'atteso ' + atteso + ', ottenuto ' + rows[0].cost_per_100g);
  assert.ok(Math.abs(rows[0].cost_per_100g - 2.866) < 0.001,
    'il valore reale sta intorno a 2,87 per 100 g, non a 0,03');
});

test('2. le due strade coincidono: importo/peso e prezzo-al-libbra', () => {
  const daImporto = (1120.6 / (86.2 * LB)) * 100;
  const daPrezzo  = (13 / LB) * 100;
  assert.ok(Math.abs(daImporto - daPrezzo) < 0.001,
    'su un documento reale l\'importo E\' prezzo x peso: le due formule devono convergere');
});

test('3. voce NORMALE non catchweight: comportamento invariato', async () => {
  const rows = await scrivi([{ vendor_sku: 'X', description: 'CHZ MOZZ SHRED', qty: 2,
    qty_received: 2, pack_description: '5#', unit_price: 22.22, amount: 44.44 }]);
  const grammi = 5 * LB;
  assert.strictEqual(rows[0].estimated_total_g, Math.round(grammi));
  assert.strictEqual(rows[0].cost_per_100g, parseFloat(((22.22 / grammi) * 100).toFixed(4)),
    'per un collo normale unit_price E\' il prezzo del collo: la vecchia formula resta giusta');
});

test('4. catchweight SENZA peso: fail closed, nessuna stima dal pack nominale', async () => {
  const rows = await scrivi([{ vendor_sku: 'X', description: 'D', qty: 1, qty_received: 1,
    pack_description: '80#', catchweight: true, unit_price: 13, amount: 1120.6 }]);
  assert.strictEqual(rows[0].cost_per_100g, null,
    'senza peso effettivo il costo per 100 g non e\' deducibile');
});

test('5. catchweight con peso ma senza importo: ripiega sul prezzo al libbra', async () => {
  const rows = await scrivi([{ vendor_sku: 'X', description: 'D', qty: 1, qty_received: 1,
    pack_description: '80#', catchweight: true, price_per_lb: 13,
    actual_weight_lb: 86.2, unit_price: 13, amount: null }]);
  assert.strictEqual(rows[0].cost_per_100g, parseFloat(((13 / LB) * 100).toFixed(4)));
});

test('6. la semantica della quantita\' di INV08B non si muove', async () => {
  const cw = await scrivi([Object.assign({}, VOCE_REALE, { qty: undefined, qty_received: 4 })]);
  assert.strictEqual(cw[0].qty, 1, 'catchweight resta 1');
  const parziale = await scrivi([{ vendor_sku: 'X', description: 'D', qty_ordered: 3,
    qty_received: 2, pack_description: '5#', unit_price: 10, amount: 20 }]);
  assert.strictEqual(parziale[0].qty, 2, 'consegna parziale: vale il ricevuto');
  const mai = await scrivi([{ vendor_sku: 'X', description: 'D', qty_ordered: 1,
    qty_received: 0, amount: 0, pack_description: '5#', unit_price: 10 }]);
  assert.strictEqual(mai.length, 0, 'zero-delivered guard ancora attivo');
});

test('7. il parser non chiama piu\' catchweight una moltiplicazione per colli', () => {
  // I quattro falsi positivi reali: importo = prezzo x quantita'.
  const pagina = [
    'HARDIE\'S', 'Invoice # 07999002   Date: 09/18/26', '',
    '3    3    00459   CARROT JUMBO            5#        4.63    13.89',
    '2    2    01981   ORGANIC SPRING MIX      3#       16.40    32.80',
    '3    3    71898   SPINACH BABY            4#       15.24    45.72',
    '4    4    25265   CHZ MOZZ SHRED GRANDE   5#       22.22    88.88',
    '', 'TOTAL   181.29',
  ].join('\n');
  const out = parser.parse ? parser.parse(pagina) : parser(pagina);
  const items = (out.items || []).filter(i => i.vendor_sku);
  assert.strictEqual(items.length, 4, 'le quattro voci devono essere lette');
  for (const it of items) {
    assert.notStrictEqual(it.catchweight, true,
      it.vendor_sku + ' e\' una moltiplicazione per colli, non una pesata');
    assert.strictEqual(it.qty, it.qty_received,
      it.vendor_sku + ' deve conservare la quantita\' reale, non diventare 1');
  }
});

test('8. il parser riconosce ancora le catchweight VERE', () => {
  const pagina = [
    'HARDIE\'S', 'Invoice # 07999003   Date: 06/17/26', '',
    '1    1    00907   CHZ PARMESAN REGGIANO   80#      13.00   1120.60',
    '4    4    29554   ABR BROCHETTE MEAT      4 PC/12#  6.22    294.95',
    '', 'TOTAL   1415.55',
  ].join('\n');
  const out = parser.parse ? parser.parse(pagina) : parser(pagina);
  const items = (out.items || []).filter(i => i.vendor_sku);
  assert.strictEqual(items.length, 2);
  for (const it of items) {
    assert.strictEqual(it.catchweight, true, it.vendor_sku + ' e\' una catchweight vera');
    assert.ok(it.actual_weight_lb > 0, it.vendor_sku + ' deve avere il peso implicito');
    // Il parser emette la quantita' consegnata (INV08B); e' il WRITER a
    // portarla a 1 per le catchweight, ed e' verificato dal test 6.
    assert.strictEqual(it.qty, it.qty_received);
  }
  const parmigiano = items.find(i => i.vendor_sku === '00907');
  assert.ok(Math.abs(parmigiano.actual_weight_lb - 86.2) < 0.01, 'peso 86,2 lb');
});

test('9. parita\' worker / browser sulla formula', () => {
  const worker  = fs.readFileSync(path.join(ROOT, 'edge-functions/vendor-doc-auto-import/index.ts'), 'utf8');
  const browser = fs.readFileSync(path.join(ROOT, 'js/vendor-documents-review.js'), 'utf8');
  for (const [nome, src] of [['worker', worker], ['browser', browser]]) {
    assert.ok(/const cwGrams = item\.catchweight/.test(src), nome + ': manca cwGrams');
    assert.ok(/lineTotal \/ cwGrams\) \* 100/.test(src), nome + ': manca importo/peso');
    assert.ok(/item\.price_per_lb \/ 453\.592\) \* 100/.test(src), nome + ': manca il ripiego al libbra');
  }
});

test('10. la copia del parser dentro il worker e\' allineata', () => {
  const worker = fs.readFileSync(path.join(ROOT, 'edge-functions/vendor-doc-auto-import/index.ts'), 'utf8');
  const m = worker.match(/^  "hardies-invoice": (".*?"),\n/ms);
  assert.ok(m, 'PARSER_SOURCES non trovato');
  const disk = fs.readFileSync(path.join(ROOT, 'js/vendor-parsers/hardies-invoice.js'), 'utf8');
  assert.strictEqual(JSON.parse(m[1]), disk, 'copia incorporata disallineata');
});

test('11. MUTAZIONE: la vecchia formula darebbe un valore 86 volte piu\' piccolo', () => {
  const grammi  = 86.2 * LB;
  const vecchia = (13 / grammi) * 100;        // unit_price / grammi nominali
  const nuova   = (1120.6 / grammi) * 100;    // importo / peso reale
  assert.ok(Math.abs(vecchia - 0.0332) < 0.001, 'la vecchia dava ~0,0332');
  assert.ok(Math.abs(nuova - 2.866) < 0.001, 'la nuova da\' ~2,866');
  assert.ok(nuova / vecchia > 80, 'due ordini di grandezza di differenza');
});

// ─────────────────────────────────────────────────────────────────────
// INV08G.1 — la chiusura storica, ancorata ai source reali
//
// I quattro falsi positivi e la voce 00907 del 14/09 sono presi dal
// raw_text canonico dei documenti veri, non ricopiati a mano, e fatti
// passare dal parser e dal writer ATTUALI.
// ─────────────────────────────────────────────────────────────────────

const idx = require(path.join(ROOT, 'js/vendor-parsers/index.js'));

// Le righe sorgente esatte, come stanno nel raw_text dei documenti.
const RIGHE_07130180 = [
  '3   3   00459   CARROT JUMBO   5#   4.63   13.89',
  '2   2   01981   ORGANIC SPRING MIX   3#   16.40   32.80',
  '3   3   71898   SPINACH BABY   4#   15.24   45.72',
];
const RIGA_00907_14SET = '1   1   00907   CHZ PARMESAN REGGIANO 24 MOS   80#   13.50   1163.16';
const RIGA_00907_GIUGNO = '1   1   00907   CHZ PARMESAN REGGIANO 24 MOS   80#   13.00   1120.60';

function pagina(righe, numero, data) {
  return ['HARDIE\'S FRUIT & VEGETABLE CO', 'Invoice # ' + numero + '   Date: ' + data, '']
    .concat(righe).concat(['', 'TOTAL   999.99']).join('\n');
}
function voci(righe, numero, data) {
  const out = parser.parse ? parser.parse(pagina(righe, numero, data))
                           : parser(pagina(righe, numero, data));
  return (out.items || []).filter(i => i.vendor_sku);
}

test('G1-1. i quattro falsi positivi reali sono voci normali', () => {
  const items = voci(RIGHE_07130180, '07130180', '09/18/26');
  assert.strictEqual(items.length, 3);
  for (const it of items) {
    assert.notStrictEqual(it.catchweight, true, it.vendor_sku + ' non e\' una pesata');
    assert.strictEqual(it.actual_weight_lb, null, it.vendor_sku + ' non deve avere un peso inventato');
  }
});

test('G1-2. le quantita\' attese sono 3, 2, 3', () => {
  const items = voci(RIGHE_07130180, '07130180', '09/18/26');
  const q = {};
  for (const it of items) q[it.vendor_sku] = it.qty;
  assert.deepStrictEqual(q, { '00459': 3, '01981': 2, '71898': 3 });
});

test('G1-3. gli economics derivati vengono dal writer corrente', async () => {
  const rows = await scrivi(voci(RIGHE_07130180, '07130180', '09/18/26'));
  const by = {};
  for (const r of rows) by[r.vendor_sku] = r;
  // Pack nominale, perche' non sono catchweight: 5#, 3#, 4#.
  assert.strictEqual(by['00459'].estimated_total_g, Math.round(5 * LB));
  assert.strictEqual(by['01981'].estimated_total_g, Math.round(3 * LB));
  assert.strictEqual(by['71898'].estimated_total_g, Math.round(4 * LB));
  // E il costo torna alla formula del collo, quella giusta per loro.
  assert.strictEqual(by['00459'].cost_per_100g,
    parseFloat(((4.63 / (5 * LB)) * 100).toFixed(4)));
  assert.strictEqual(by['71898'].cost_per_100g,
    parseFloat(((15.24 / (4 * LB)) * 100).toFixed(4)));
  // Il denaro non si muove.
  assert.strictEqual(by['00459'].line_total, 13.89);
  assert.strictEqual(by['01981'].line_total, 32.8);
  assert.strictEqual(by['71898'].line_total, 45.72);
});

test('G1-4. 07004208 resta una catchweight vera', () => {
  const it = voci([RIGA_00907_GIUGNO], '07004208', '06/17/26')[0];
  assert.strictEqual(it.catchweight, true);
  assert.ok(Math.abs(it.actual_weight_lb - 86.2) < 0.01);
});

test('G1-5. la voce 00907 del 14/09 e\' catchweight secondo il source reale', () => {
  // Il documento stampa "Total weight: 86.16" e 1163,16/13,50 = 86,16:
  // la riclassificazione non e\' un\'inferenza, e\' aritmetica del PDF.
  const it = voci([RIGA_00907_14SET], '07119379', '09/14/26')[0];
  assert.strictEqual(it.catchweight, true, 'il parser v27 deve riconoscerla');
  assert.ok(Math.abs(it.actual_weight_lb - 86.16) < 0.01,
    'peso implicito 86,16 lb, lo stesso stampato sulla fattura');
  assert.strictEqual(it.price_per_lb, 13.5);
});

test('G1-6. la ricostruzione PI usa la merge corrente e la cronologia giusta', () => {
  const PI = require(path.join(ROOT, 'js/vendor-parsers/price-intelligence-merge.js'));
  const merge = PI.mergePriceIntelligence;
  const it = voci([RIGA_00907_14SET], '07119379', '09/14/26')[0];
  const osservazione = {
    unit_price: it.unit_price, pack_description: it.pack_description,
    price_type: it.catchweight ? 'per_lb' : 'per_case',
    conversion_to_base: null,
    price_per_100g: (it.price_per_lb / 453.592) * 100,
    last_invoice_date: '2026-09-14',
  };
  const prima = { unit_price: 13.5, pack_description: '80#', price_type: 'per_case',
    conversion_to_base: 36287, price_per_100g: 0.03720303709060124,
    last_invoice_date: '2026-09-14' };
  const m = merge(prima, osservazione);
  assert.ok(!m.skipped, 'la merge non deve saltare');
  assert.strictEqual(m.fields.price_type, 'per_lb');
  assert.strictEqual(m.fields.conversion_to_base, null,
    'un prodotto a peso non ha una conversione per collo');
  assert.ok(Math.abs(m.fields.price_per_100g - 2.9762) < 0.001);
  assert.strictEqual(m.fields.last_invoice_date, '2026-09-14',
    'la data non si muove: e\' la stessa osservazione, letta bene');
});

test('G1-7. il documento pending non e\' un\'osservazione contabilizzata', () => {
  // 07133808 e' pending: puo' provare il parser, mai fissare un prezzo.
  const it = voci(['1   1   00907   CHZ PARMESAN REGGIANO 24 MOS   80#   13.55   1084.00'],
                  '07133808', '09/21/26')[0];
  assert.strictEqual(it.catchweight, true, 'come test del parser va benissimo');
  assert.notStrictEqual(it.unit_price, 13.5,
    'porta un prezzo diverso da quello contabilizzato: se fosse usato, sposterebbe la PI');
});

test('G1-8. Fruge resta invariata: il suo _cost_per_100g ha la precedenza', async () => {
  const rows = await scrivi([{ vendor_sku: 'SALFF3T5XAE0', description: 'SALMON FR FILLET',
    qty: 1, qty_received: 1, pack_description: '1 CT', catchweight: true,
    actual_weight_lb: 13.95, price_per_lb: 9.98, cost_per_lb: 9.98,
    _cost_per_100g: 2.2002, unit_price: 9.98, amount: 139.22 }], 'Fruge Seafood');
  assert.strictEqual(rows[0].cost_per_100g, 2.2002,
    'il valore del parser Fruge vince su qualunque ricalcolo');
});

test('G1-9. una voce Hardie\'s normale non catchweight non cambia', async () => {
  const rows = await scrivi([{ vendor_sku: 'X', description: 'CHZ MOZZ SHRED', qty: 3,
    qty_received: 3, pack_description: '5#', unit_price: 22.22, amount: 66.66 }]);
  assert.strictEqual(rows[0].qty, 3);
  assert.strictEqual(rows[0].estimated_total_g, Math.round(5 * LB));
  assert.strictEqual(rows[0].cost_per_100g, parseFloat(((22.22 / (5 * LB)) * 100).toFixed(4)));
});

(async () => {
  for (const [n, f] of queue) {
    try { await f(); console.log('  ✓ ' + n); pass++; }
    catch (e) { console.log('  ✗ ' + n + '\n      ' + e.message); fail++; }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
