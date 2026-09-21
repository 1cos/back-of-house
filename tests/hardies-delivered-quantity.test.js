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
  assert.strictEqual(await qtyWritten(
    { vendor_sku: 'X', description: 'D', qty_ordered: 1, qty_received: 0, amount: 0 }), 0,
    'ZERO e\' informazione: e\' la prova che non e\' arrivato niente');
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

(async () => {
  for (const [name, fn] of results) {
    try { await fn(); console.log('  ✓ ' + name); passed++; }
    catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); failed++; }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
