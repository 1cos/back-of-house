// ─────────────────────────────────────────────────────────────────────
// INV08B — invoice_lines.qty deve essere la quantita' CONSEGNATA
//
// Difetto misurato su 890 voci Hardie's reali: il parser emetteva
// qty_ordered e qty_received ma non `qty`, e il writer preferiva
// l'ordinato. Risultato in due direzioni opposte:
//   - 17 articoli mai consegnati (shipped 0, amount 0) scritti con qty 1-2
//   - 10 sostituti (ordered 0, shipped 1) scritti con qty 0, perche'
//     `0 != null` e' vero e l'ordinato vinceva comunque
//   -  5 consegne parziali scritte con la quantita' richiesta
//
// Questi test ancorano la regola sui DUE punti che la compongono:
// il parser dichiara la quantita' consegnata, il writer preferisce il
// ricevuto all'ordinato.
// ─────────────────────────────────────────────────────────────────────
'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const ROOT   = path.join(__dirname, '..');
const parser = require(path.join(ROOT, 'js/vendor-parsers/hardies-invoice.js'));
const { writeInvoiceLines } = require(path.join(ROOT, 'pure_logic.cjs'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); failed++; }
}

// Una pagina Hardie's minima ma reale nella forma: le colonne sono
// ordered, shipped, sku, descrizione, pack, prezzo, importo.
const PAGE = [
  'HARDIE\'S FRUIT & VEGETABLE CO',
  'Invoice # 07999001   Date: 06/15/26',
  '',
  '2    2    41001   SPINACH BABY              4/2.5 LB     12.00    24.00',
  '1    0    41002   WATERMELON SEEDLESS       1/CT          9.50     0.00',
  '2    1    41003   TOMATO ROMA               25 LB        18.00    18.00',
  '0    1    41004   WATERMELON LOCAL          1/CT         11.00    11.00',
  'SUBSTITUTION',
  '',
  'TOTAL   53.00',
].join('\n');

function itemsOf(text) {
  const out = parser.parse ? parser.parse(text) : parser(text);
  return (out.items || []).filter(i => i.vendor_sku);
}

const ITEMS = itemsOf(PAGE);
const bySku = sku => ITEMS.find(i => i.vendor_sku === sku);

// ── A. il parser dichiara la quantita' consegnata ────────────────────

test('1. articolo consegnato per intero: qty = shipped = ordered', () => {
  const it = bySku('41001');
  assert.strictEqual(it.qty, 2, 'qty deve valere 2');
  assert.strictEqual(it.qty_received, 2);
});

test('2. articolo MAI consegnato: qty = 0, non 1', () => {
  const it = bySku('41002');
  assert.strictEqual(it.qty_ordered, 1, 'il PDF dice ordered 1');
  assert.strictEqual(it.qty, 0, 'merce mai arrivata non puo\' avere qty 1');
});

test('3. articolo mai consegnato: purchasable = false', () => {
  assert.strictEqual(bySku('41002').purchasable, false);
});

test('4. consegna parziale: qty = ricevuto, non ordinato', () => {
  const it = bySku('41003');
  assert.strictEqual(it.qty_ordered, 2);
  assert.strictEqual(it.qty, 1, 'sono arrivate 1, non 2');
});

test('5. sostituto (ordered 0, shipped 1): qty = 1, non 0', () => {
  const it = bySku('41004');
  assert.strictEqual(it.qty_ordered, 0);
  assert.strictEqual(it.qty, 1, 'merce arrivata non puo\' avere qty 0');
});

test('6. sostituto consegnato resta acquistabile', () => {
  assert.ok(bySku('41004').purchasable !== false,
    'ordered 0 non significa non consegnato');
});

test('7. il campo purchasable si aggiunge SOLO quando serve', () => {
  assert.ok(!('purchasable' in bySku('41001')),
    'un articolo normale non deve portare il campo');
});

// ── B. il writer preferisce il ricevuto all'ordinato ─────────────────

function fakeSb(captured) {
  const chain = {
    select: () => chain, eq: () => chain, in: () => chain,
    limit: async () => ({ data: [] }),
    insert: async rows => { captured.push(...rows); return { error: null }; },
    upsert: async () => ({ error: null }),
    update: () => chain, delete: () => chain, order: () => chain,
    then: undefined,
  };
  return { from: () => chain };
}

async function qtyWritten(item) {
  const rows = [];
  await writeInvoiceLines(fakeSb(rows), 'doc-test', [item],
    { total: null }, '2026-06-15', 'hardies', {}, {});
  return rows.length ? rows[0].qty : undefined;
}

const results = [];
function asyncTest(name, fn) { results.push([name, fn]); }

asyncTest('8. writer: ricevuto batte ordinato quando differiscono', async () => {
  assert.strictEqual(await qtyWritten(
    { vendor_sku: 'X', description: 'D', qty_ordered: 3, qty_received: 2, amount: 10 }), 2);
});

asyncTest('9. writer: ricevuto 0 resta 0, non risale a ordinato', async () => {
  // ZERO e' informazione, e la precedenza deve rispettarlo. Il caso viene
  // esercitato con un importo NON nullo, perche' da INV08B.1 la coppia
  // ricevuto 0 + importo 0 su Hardie's non produce piu' nessuna riga:
  // quel caso e' coperto dal test 17.
  assert.strictEqual(await qtyWritten(
    { vendor_sku: 'X', description: 'D', qty_ordered: 1, qty_received: 0, amount: 12.5 }), 0,
    'con il ricevuto a zero la quantita\' non puo\' risalire all\'ordinato');
});

asyncTest('10. writer: ordinato usato solo se il ricevuto e\' NULL', async () => {
  assert.strictEqual(await qtyWritten(
    { vendor_sku: 'X', description: 'D', qty_ordered: 4, qty_received: null, amount: 10 }), 4,
    'e\' il caso delle order confirmation');
});

asyncTest('11. writer: qty esplicito vince su entrambi', async () => {
  assert.strictEqual(await qtyWritten(
    { vendor_sku: 'X', description: 'D', qty: 7, qty_ordered: 3, qty_received: 2, amount: 10 }), 7);
});

asyncTest('12. writer: catchweight resta 1', async () => {
  assert.strictEqual(await qtyWritten(
    { vendor_sku: 'X', description: 'D', catchweight: true, qty_ordered: 3, qty_received: 2, amount: 10 }), 1);
});

asyncTest('13. writer: purchasable false non diventa una riga', async () => {
  const rows = [];
  await writeInvoiceLines(fakeSb(rows), 'doc-test',
    [{ vendor_sku: 'A', description: 'consegnato', qty_received: 1, amount: 10 },
     { vendor_sku: 'B', description: 'mai arrivato', qty_received: 0, amount: 0, purchasable: false }],
    { total: null }, '2026-06-15', 'hardies', {}, {});
  assert.strictEqual(rows.length, 1, 'una sola riga di acquisto');
  assert.strictEqual(rows[0].vendor_sku, 'A');
});

// ── C. parita' fra file su disco e copia incorporata nel worker ──────

test('14. la copia del parser dentro il worker e\' identica al file', () => {
  const worker = fs.readFileSync(
    path.join(ROOT, 'edge-functions/vendor-doc-auto-import/index.ts'), 'utf8');
  const m = worker.match(/^  "hardies-invoice": (".*?"),\n/ms);
  assert.ok(m, 'PARSER_SOURCES["hardies-invoice"] non trovato');
  const embedded = JSON.parse(m[1]);
  const disk = fs.readFileSync(path.join(ROOT, 'js/vendor-parsers/hardies-invoice.js'), 'utf8');
  assert.strictEqual(embedded, disk, 'copia incorporata disallineata: rigenerare PARSER_SOURCES');
});

test('15. i due gemelli del browser hanno la stessa precedenza del worker', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/vendor-documents-review.js'), 'utf8');
  const hits = src.match(/qty_received != null \? item\.qty_received : \(?item\.qty_ordered/g) || [];
  assert.strictEqual(hits.length, 2,
    'vdrApprove e il display devono entrambi preferire il ricevuto, trovati ' + hits.length);
});

// ── D. MUTAZIONE: rimettere la vecchia precedenza deve far fallire ───

test('16. mutazione: ripristinando ordinato-prima il caso ricevuto=0 fallisce', () => {
  // Riproduce l'espressione ESATTA di prima della patch e verifica che
  // sbagli sul caso che la patch protegge. Se un giorno qualcuno
  // reintroduce quella precedenza, il test 9 diventa rosso.
  const item = { qty_ordered: 1, qty_received: 0 };
  const vecchia = item.catchweight === true ? 1 : item.qty != null ? item.qty
                : item.qty_ordered != null ? item.qty_ordered
                : item.qty_received != null ? item.qty_received : null;
  const nuova   = item.catchweight === true ? 1 : item.qty != null ? item.qty
                : item.qty_received != null ? item.qty_received
                : item.qty_ordered != null ? item.qty_ordered : null;
  assert.strictEqual(vecchia, 1, 'la vecchia regola scriveva 1 pezzo mai arrivato');
  assert.strictEqual(nuova, 0, 'la nuova scrive lo zero reale');
  assert.notStrictEqual(vecchia, nuova, 'la patch deve cambiare davvero il risultato');
});

// ─────────────────────────────────────────────────────────────────────
// INV08B.1 — il percorso LEGACY: parsed_json gia' memorizzati
//
// Phase B non riparsa: legge il parsed_json salvato al momento
// dell'ingestione. I documenti entrati prima di INV08B non hanno
// `purchasable` e non hanno `qty`. Il writer deve essere corretto anche
// su quella forma, altrimenti i 9 pending Hardie's di oggi, quando
// verranno approvati, scriveranno ancora merce mai arrivata.
// ─────────────────────────────────────────────────────────────────────

const HARDIES = "Hardie's Fresh Foods / Dairyland Produce";

async function scrivi(items, vendor) {
  const rows = [];
  await writeInvoiceLines(fakeSb(rows), 'doc-legacy', items,
    { total: null }, '2026-06-26', vendor || HARDIES, {}, {});
  return rows;
}

asyncTest('17. legacy: ricevuto 0 e importo 0 SENZA purchasable -> nessuna riga', async () => {
  const rows = await scrivi([{ vendor_sku: 'Z', description: 'mai arrivato',
                               qty_ordered: 1, qty_received: 0, amount: 0 }]);
  assert.strictEqual(rows.length, 0,
    'il guard deve reggere anche senza il flag del parser nuovo');
});

asyncTest('18. il flag esplicito continua a funzionare', async () => {
  const rows = await scrivi([{ vendor_sku: 'Z', description: 'd',
                               qty_received: 0, amount: 0, purchasable: false }]);
  assert.strictEqual(rows.length, 0);
});

asyncTest('19. NULL non e\' zero: ricevuto ignoto non fa sparire la riga', async () => {
  const rows = await scrivi([{ vendor_sku: 'Z', description: 'order confirmation',
                               qty_ordered: 4, qty_received: null, amount: 0 }]);
  assert.strictEqual(rows.length, 1, 'non sapere non autorizza a buttare via la riga');
  assert.strictEqual(rows[0].qty, 4, 'con il ricevuto assente vale l\'ordinato');
});

asyncTest('20. importo ignoto: il guard non decide', async () => {
  const rows = await scrivi([{ vendor_sku: 'Z', description: 'd',
                               qty_ordered: 1, qty_received: 0, amount: null }]);
  assert.strictEqual(rows.length, 1, 'senza importo non c\'e\' prova di mancata consegna');
});

asyncTest('21. ricevuto 0 ma importo NON zero: la riga resta', async () => {
  const rows = await scrivi([{ vendor_sku: 'Z', description: 'd',
                               qty_ordered: 1, qty_received: 0, amount: 12.5 }]);
  assert.strictEqual(rows.length, 1,
    'importo diverso da zero significa che qualcosa e\' stato addebitato');
});

asyncTest('22. il guard e\' su lista chiusa: un altro vendor non e\' toccato', async () => {
  const rows = await scrivi([{ vendor_sku: 'Z', description: 'd',
                               qty_ordered: 1, qty_received: 0, amount: 0 }], 'Ben E. Keith');
  assert.strictEqual(rows.length, 1, 'BEK imposta purchasable da se\', non va scavalcato');
});

asyncTest('23. legacy: sostituto ordinato 0 ricevuto 1 -> qty 1', async () => {
  const rows = await scrivi([{ vendor_sku: 'Z', description: 'd',
                               qty_ordered: 0, qty_received: 1, amount: 104.86 }]);
  assert.strictEqual(rows[0].qty, 1);
});

asyncTest('24. legacy: consegna parziale 3 ordinate / 2 arrivate -> qty 2', async () => {
  const rows = await scrivi([{ vendor_sku: 'Z', description: 'd',
                               qty_ordered: 3, qty_received: 2, amount: 73.78 }]);
  assert.strictEqual(rows[0].qty, 2);
});

asyncTest('25. legacy: ordinato = ricevuto -> invariato', async () => {
  const rows = await scrivi([{ vendor_sku: 'Z', description: 'd',
                               qty_ordered: 2, qty_received: 2, amount: 28.9 }]);
  assert.strictEqual(rows[0].qty, 2);
});

asyncTest('26. legacy: catchweight -> 1, il guard non interferisce', async () => {
  const rows = await scrivi([{ vendor_sku: 'Z', description: 'd', catchweight: true,
                               qty_ordered: 3, qty_received: 0, amount: 44.5 }]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].qty, 1);
});

asyncTest('27. 07016705 REALE: 17 item memorizzati -> 16 righe', async () => {
  const stored = require('./fixtures/hardies-07016705-stored.js');
  const rows = await scrivi(stored);
  assert.strictEqual(stored.length, 17);
  assert.strictEqual(rows.length, 16, 'una sola esclusione');
});

asyncTest('28. 07016705 REALE: 71114 esclusa, 01734 con qty 1', async () => {
  const stored = require('./fixtures/hardies-07016705-stored.js');
  const rows = await scrivi(stored);
  assert.ok(!rows.find(r => r.vendor_sku === '71114'),
    '71114 ha ricevuto 0 e importo 0: non deve esistere');
  assert.strictEqual(rows.find(r => r.vendor_sku === '01734').qty, 1,
    '01734 e\' il sostituto realmente arrivato');
});

asyncTest('29. 07016705 REALE: la riconciliazione regge al centesimo', async () => {
  const stored = require('./fixtures/hardies-07016705-stored.js');
  const rows = await scrivi(stored);
  const somma = rows.reduce((a, r) => a + (Number(r.line_total) || 0), 0);
  assert.ok(Math.abs(somma - 637.81) < 0.005,
    'somma righe ' + somma.toFixed(2) + ' contro totale documento 637.81');
});

test('30. mutazione: senza il guard legacy il test 17 non potrebbe passare', () => {
  // L'espressione del filtro come sarebbe SENZA la guardia di INV08B.1.
  const legacy = { qty_ordered: 1, qty_received: 0, amount: 0 };
  assert.ok(legacy.purchasable !== false,
    'un item legacy passa il filtro purchasable: da solo non basta');
  const src = fs.readFileSync(
    path.join(ROOT, 'edge-functions/vendor-doc-auto-import/index.ts'), 'utf8');
  assert.ok(/vdaiIsZeroDeliveredLegacy\(vendor, item\)/.test(src),
    'il filtro del writer deve invocare il guard');
  assert.ok(/function vdrIsZeroDeliveredLegacy/.test(
    fs.readFileSync(path.join(ROOT, 'js/vendor-documents-review.js'), 'utf8')),
    'il gemello del browser deve esistere: approve e worker non possono divergere');
});

(async () => {
  for (const [name, fn] of results) {
    try { await fn(); console.log('  ✓ ' + name); passed++; }
    catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); failed++; }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
