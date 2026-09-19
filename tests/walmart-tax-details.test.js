// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 56 — la colonna Tax Details di Walmart/TreviPay non
// stampa sempre l'etichetta "Tax1".
//
// Il parser cercava quella stringa letterale. Ogni altra forma faceva
// fallire ENTRAMBI i pattern di coda, quindi parseRowStart restituiva
// null e la riga-prodotto scivolava nel ramo delle continuazioni: veniva
// assorbita nella descrizione della riga precedente e i suoi dollari
// sparivano senza errore. Su 748cc643 si sono persi $53.34 di $61.16.
//
// Forme reali censite su 21 documenti veri:
//   "Tax1"          6c246fda, f4786197 riga 1     funzionava
//   "Tax2"          748cc643 x3, d19bdab1 x4      persa
//   "Tax1 8.28%"    659ae123 x2, rate inline      persa
//   "7ad525ee-"     f4786197 riga 3, tax code     persa
//
// Il fix non elenca le etichette: riconosce l'invariante strutturale,
// cioe' 1-3 token NON monetari fra Discount e le ultime tre colonne in
// dollari. Escludere "$" dalla classe e' cio' che lo tiene fail closed.
//
// `node tests/walmart-tax-details.test.js`
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const parsers = require('../js/vendor-parsers/index.js');
const DOCS = require('./fixtures/walmart-taxdetails-samples.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); }
}
const sum = items => Math.round(items.reduce((s, i) => s + (i.amount || 0), 0) * 100) / 100;

// ── I quattro documenti che il bug rompeva ────────────────────────
// Conteggi e totali sono quelli del PDF reale, non del parser: ogni
// totale qui sotto e' il "Total Due" stampato sul documento.
const BUGGED = [
  { doc: '659ae123', rows: 24, total: 198.27, forma: 'Tax1 con percentuale inline' },
  { doc: '748cc643', rows:  8, total:  61.16, forma: 'etichetta Tax2' },
  { doc: 'd19bdab1', rows:  9, total:  61.02, forma: 'etichetta Tax2, multipagina' },
  { doc: 'f4786197', rows:  3, total:   9.08, forma: 'tax code opaco' },
];

for (const c of BUGGED) {
  test(c.doc + ' — ' + c.forma + ' → ' + c.rows + ' righe, $' + c.total, () => {
    const r = parsers.parse(DOCS[c.doc]);
    assert.strictEqual(r.vendor, 'Walmart Business');
    assert.strictEqual(r.document_number, c.doc);
    assert.strictEqual(r.items.length, c.rows, 'conteggio righe');
    assert.strictEqual(sum(r.items), c.total, 'somma righe');
    assert.strictEqual(r.total, c.total, 'totale dichiarato letto dal documento');
  });

  test(c.doc + ' — quadra, quindi nessun DOC-TOTAL-001', () => {
    const r = parsers.parse(DOCS[c.doc]);
    const codes = (r.warnings || []).map(w => w.code);
    assert.ok(!codes.includes('DOC-TOTAL-001'), 'warning residuo: ' + codes.join(','));
  });
}

// ── I due controlli: devono restare identici ──────────────────────
const CONTROL = [
  { doc: '6c246fda', rows: 7, total: 63.33 },
  { doc: 'c51dd720', rows: 8, total: 52.07 },
];
for (const c of CONTROL) {
  test(c.doc + ' — CONTROLLO, output invariato (' + c.rows + ' righe, $' + c.total + ')', () => {
    const r = parsers.parse(DOCS[c.doc]);
    assert.strictEqual(r.items.length, c.rows);
    assert.strictEqual(sum(r.items), c.total);
    assert.strictEqual(r.total, c.total);
  });
}

// ── Le righe recuperate sono quelle giuste, non righe qualsiasi ───
test('659ae123 — le 2 righe recuperate sono i due porzionatori', () => {
  const r = parsers.parse(DOCS['659ae123']);
  const a = r.items.find(i => i.vendor_sku === '1846715023');
  const b = r.items.find(i => i.vendor_sku === '151160032');
  assert.ok(a && b, 'righe assenti');
  assert.strictEqual(a.amount, 8.63);
  assert.strictEqual(b.amount, 6.86);
  assert.strictEqual(a.qty, 1);
  assert.strictEqual(a.unit_price, 7.97);
  assert.strictEqual(a.tax, 0.66);
});

test('748cc643 — la riga piu grossa recuperata ha importi esatti', () => {
  const r = parsers.parse(DOCS['748cc643']);
  const h = r.items.find(i => i.vendor_sku === '1158027110');
  assert.ok(h, 'riga Hefty assente');
  assert.strictEqual(h.qty, 2);
  assert.strictEqual(h.unit_price, 19.23);
  assert.strictEqual(h.tax, 3.65);     // tassa AGGREGATA, non il sotto-totale $0.49
  assert.strictEqual(h.amount, 42.11);
});

// ── Fail closed: una riga senza colonna Tax Details non deve mai
//    finire nel ramo con Tax Details ───────────────────────────────
test('fail closed — quattro importi finali non bastano per il ramo Tax Details', () => {
  const r = parsers.parse(DOCS['c51dd720']);
  // c51dd720 non ha affatto la colonna: ogni riga ha 4 importi.
  assert.ok(r.items.every(i => i.tax === 0), 'una riga ha preso una tassa inesistente');
  assert.strictEqual(sum(r.items), 52.07);
});

test('fail closed — l etichetta non puo mai inghiottire un importo', () => {
  const r = parsers.parse(DOCS['748cc643']);
  for (const i of r.items) {
    assert.ok(!/\$/.test(String(i.vendor_sku)), 'SKU contiene $: ' + i.vendor_sku);
    assert.ok(i.amount !== null && !isNaN(i.amount), 'importo non letto su ' + i.vendor_sku);
  }
});

// ── MT56 parte 5 — la cella Tax non e' descrizione di prodotto ────
test('descrizione — la cella "Tax<n> $importo" non entra nel testo prodotto', () => {
  const r = parsers.parse(DOCS['748cc643']);
  const h = r.items.find(i => i.vendor_sku === '1158027110');
  assert.ok(!/Tax\d/.test(h.description), 'cella tax nella descrizione: ' + h.description);
  assert.ok(!/%/.test(h.description), 'percentuale nella descrizione: ' + h.description);
  assert.ok(/Hefty Ultra Strong/.test(h.description), 'testo prodotto perso');
  assert.ok(/120 Bags/.test(h.description), 'coda della descrizione persa');
});

test('descrizione — una percentuale VERA di prodotto sopravvive (0.5% ABV)', () => {
  const r = parsers.parse(DOCS['6c246fda']);
  const beer = r.items.find(i => i.vendor_sku === '15718162');
  assert.ok(beer, 'riga birra assente');
  assert.ok(/0\.5%/.test(beer.description), 'la gradazione e stata cancellata: ' + beer.description);
  assert.ok(/ABV/.test(beer.description));
});

// ── Nessuna esplosione CPU (lezione MT44/45) ──────────────────────
test('costo lineare, niente backtracking catastrofico', () => {
  const times = [];
  for (const n of [1, 2, 4, 8]) {
    const line = '1234567890 ' + 'Descrizione Lunga '.repeat(60 * n) +
                 '2 $19.23 $0.00 Tax2 $0.49 $3.65 nonchiude';
    const t0 = Date.now();
    for (let i = 0; i < 300; i++) parsers.parse(line);
    times.push(Date.now() - t0);
  }
  // quadratico significherebbe x4 a ogni raddoppio; ammettiamo x3 di margine
  for (let i = 1; i < times.length; i++) {
    assert.ok(times[i] <= Math.max(20, times[i - 1] * 3),
      'crescita non lineare: ' + times.join(' -> ') + ' ms');
  }
});

console.log('\n  ' + pass + ' passati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
