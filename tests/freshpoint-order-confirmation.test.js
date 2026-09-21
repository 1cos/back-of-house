// ══════════════════════════════════════════════════════════════════
// INV07 — FreshPoint Order Confirmation: parser, classificazione,
// parita' con la copia incorporata nel worker, e collector fail-closed.
//
// I cinque campioni NON sono inventati: sono i corpi reali delle cinque
// conferme d'ordine di giugno 2026, copiati da Gmail.
//
// `node tests/freshpoint-order-confirmation.test.js`
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const parser = require('../js/vendor-parsers/freshpoint-order-confirmation');
const registry = require('../js/vendor-parsers/index.js');
const { SAMPLES, EXPECTED_TOTAL } = require('./fixtures/freshpoint-order-confirmation-samples');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); }
}

// ── 1. Il parser sui cinque documenti reali ──────────────────────

test('1. i cinque si parsano tutti, con numero e totale esatti', () => {
  let somma = 0;
  for (const s of SAMPLES) {
    const r = parser.parse(s.body);
    assert.strictEqual(r.order_number, s.number, 'numero di ' + s.number);
    assert.strictEqual(r.total, s.total, 'totale di ' + s.number);
    assert.strictEqual(r.document_type, 'order_confirmation', 'tipo di ' + s.number);
    assert.strictEqual(r.vendor, 'FreshPoint Dallas');
    somma += r.total;
  }
  assert.strictEqual(Math.round(somma * 100) / 100, EXPECTED_TOTAL, 'somma dei cinque');
});

test('2. il conteggio righe coincide con quello DICHIARATO dal documento', () => {
  for (const s of SAMPLES) {
    const r = parser.parse(s.body);
    assert.strictEqual(r.items.length, s.items, 'righe di ' + s.number);
    assert.strictEqual(r.declared_item_count, s.items, 'dichiarate da ' + s.number);
    assert.strictEqual(r.declared_quantity, s.qty, 'quantita dichiarata da ' + s.number);
  }
});

test('3. la somma degli estesi quadra col totale, su tutti e cinque', () => {
  for (const s of SAMPLES) {
    const r = parser.parse(s.body);
    const sum = Math.round(r.items.reduce((a, i) => a + i.amount, 0) * 100) / 100;
    assert.strictEqual(sum, s.total, 'quadratura di ' + s.number);
  }
});

test('4. nessun warning sui cinque documenti veri', () => {
  for (const s of SAMPLES) {
    assert.deepStrictEqual(parser.parse(s.body).warnings, [], 'warning su ' + s.number);
  }
});

test('5. date ordine e consegna, e mai new Date() come ripiego', () => {
  const r = parser.parse(SAMPLES[0].body);
  assert.strictEqual(r.order_date, '2026-06-04');
  assert.strictEqual(r.delivery_date, '2026-06-05');
  const vuoto = parser.parse('| Order Confirmation | Reference #999 |');
  assert.strictEqual(vuoto.order_date, null, 'senza riga date non si inventa una data');
  assert.strictEqual(vuoto.delivery_date, null);
});

test('6. le righe portano la quantita ORDINATA, non una ricevuta inventata', () => {
  const r = parser.parse(SAMPLES[1].body);   // ha quantita' > 1
  const basil = r.items.find(i => /BASIL/.test(i.description));
  assert.strictEqual(basil.qty_ordered, 4);
  assert.strictEqual(basil.qty_received, null, 'una conferma d ordine non sa cosa arrivera');
  assert.strictEqual(basil.unit_price, 8.75);
  assert.strictEqual(basil.amount, 35.00);
  assert.strictEqual(basil.vendor_sku, '3970');
});

test('7. intestazione e riepilogo non vengono scambiati per articoli', () => {
  const r = parser.parse(SAMPLES[4].body);
  assert.strictEqual(r.items.length, 5);
  for (const i of r.items) {
    assert.ok(/^\d+$/.test(i.vendor_sku), 'sku numerico: ' + i.vendor_sku);
    assert.ok(!/^Item#$/i.test(i.vendor_sku));
    assert.ok(!/^Items$/i.test(i.vendor_sku));
  }
});

test('8. deriva del template: se le righe non tornano, lo dice', () => {
  // stesso documento ma con una riga tolta: il totale dichiarato resta 7
  const rotto = SAMPLES[0].body.replace(/\| 3970 \| HERB BASIL SWEET 1#[^\n]*\n/, '');
  const r = parser.parse(rotto);
  assert.strictEqual(r.items.length, 6);
  assert.strictEqual(r.declared_item_count, 7);
  const w = r.warnings.find(x => x.code === 'DOC-TOTAL-001');
  assert.ok(w, 'deve avvisare che mancano righe');
  assert.strictEqual(w.severity, 'blocking');
});

// ── 2. Classificazione: NON e' una fattura ───────────────────────

test('9. il vendor e il tipo vengono riconosciuti dal contenuto', () => {
  for (const s of SAMPLES) {
    const v = registry.detectVendor(s.body);
    assert.strictEqual(v, 'freshpoint', 'vendor di ' + s.number);
    assert.strictEqual(registry.detectDocumentType(s.body, v), 'order_confirmation',
      'tipo di ' + s.number);
  }
});

test('10. la frase "This is not an invoice" non lo rende una fattura', () => {
  // E' il difetto che questo task chiude: il fallback generico su
  // \bINVOICE\b vedeva la parola proprio nella riga che nega di esserlo.
  const s = SAMPLES[0];
  assert.ok(/This is not an invoice/i.test(s.body), 'la frase c e davvero');
  assert.notStrictEqual(registry.detectDocumentType(s.body, 'freshpoint'), 'invoice');
});

test('11. la regola e limitata a FreshPoint e richiede DUE segnali', () => {
  const body = SAMPLES[0].body;
  // stesso testo, altro vendor: non deve diventare order_confirmation
  assert.notStrictEqual(registry.detectDocumentType(body, 'hardies'), 'order_confirmation');
  // "Order Confirmation" da solo, senza Reference #, non basta
  const soloFrase = 'FreshPoint Order Confirmation\nINVOICE 123';
  assert.notStrictEqual(registry.detectDocumentType(soloFrase, 'freshpoint'), 'order_confirmation');
});

test('12. NON e un acquisto: zero invoice_lines attese', () => {
  for (const s of SAMPLES) {
    const r = registry.parse(s.body);
    assert.strictEqual(registry.isPurchasableDocument(r.vendor, r.document_type), false,
      s.number + ' non deve essere acquistabile');
  }
  // e il contrasto: per Ben E. Keith la stessa cosa e' acquistabile
  assert.strictEqual(registry.isPurchasableDocument('Ben E. Keith', 'order_confirmation'), true);
});

test('13. il giro completo dal registry produce lo stesso risultato', () => {
  for (const s of SAMPLES) {
    const r = registry.parse(s.body);
    assert.strictEqual(r.order_number, s.number);
    assert.strictEqual(r.total, s.total);
    assert.strictEqual(r.items.length, s.items);
    assert.deepStrictEqual(r.warnings, [], 'checkTotals non deve aggiungere niente');
  }
});

// ── 3. Parita' con la copia INCORPORATA nel worker ───────────────
// Il worker Deno non fa require dal filesystem: legge PARSER_SOURCES.
// Una copia disallineata e' gia' costata un task (INV03D), quindi qui
// si esegue davvero il codice incorporato, con lo stesso shim.

function loadEmbedded() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'edge-functions', 'vendor-doc-auto-import', 'index.ts'), 'utf8');
  const i = src.indexOf('const PARSER_SOURCES: Record<string, string> = {');
  assert.notStrictEqual(i, -1, 'PARSER_SOURCES non trovato');
  const j = src.indexOf('\n};', i);
  const sources = eval('(' + src.slice(src.indexOf('{', i), j + 2) + ')');

  const cache = {};
  function req(name) {
    const key = String(name).replace(/^\.\//, '');
    if (cache[key]) return cache[key].exports;
    const s = sources[key];
    if (s == null) throw new Error('parser module not found: ' + key);
    const mod = { exports: {} };
    cache[key] = mod;
    new Function('require', 'module', 'exports', s)(req, mod, mod.exports);
    return mod.exports;
  }
  return { sources, req };
}

test('14. il parser incorporato nel worker esiste ed e caricabile', () => {
  const { sources, req } = loadEmbedded();
  assert.ok(sources['freshpoint-order-confirmation'], 'voce mancante in PARSER_SOURCES');
  const embedded = req('./freshpoint-order-confirmation');
  assert.strictEqual(typeof embedded.parse, 'function');
});

test('15. copia incorporata e copia canonica danno lo STESSO risultato', () => {
  const { req } = loadEmbedded();
  const embeddedIndex = req('./index');
  for (const s of SAMPLES) {
    const canonico   = JSON.stringify(registry.parse(s.body));
    const incorporato = JSON.stringify(embeddedIndex.parse(s.body));
    assert.strictEqual(incorporato, canonico, 'divergenza su ' + s.number);
  }
});

test('16. anche il worker incorporato lo classifica non acquistabile', () => {
  const { req } = loadEmbedded();
  const embeddedIndex = req('./index');
  for (const s of SAMPLES) {
    const r = embeddedIndex.parse(s.body);
    assert.strictEqual(embeddedIndex.isPurchasableDocument(r.vendor, r.document_type), false);
  }
});

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
