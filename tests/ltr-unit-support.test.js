// MICRO-TASK 94 — LTR e' un alias esatto di litro.
//
// Censimento del corpus completo (2026-09-20): "LTR" e "LT" compaiono
// SOLO come unita' di pack, mai come testo libero in una descrizione,
// e in tutti e tre i casi reali significano litro:
//   BEK 686226            "2/ 5 LTR"              Vinegar Balsamic Consul
//   Hardie's 27474        "20 LT"                 Fryer Oil Olitalia
//   Global Gourmet        '3/5lt "Oleoestepa"'    Extra Virgin Olive Oil
// L'ultimo porta gia' conversion_to_base = 15000 in ingredient_vendors:
// il sistema tratta quindi da sempre il litro come 1000 g. Questa patch
// non introduce nessuna densita' nuova e nessuna grammatica nuova —
// parsePackSize gia' legge "2/ 5 LTR" come {count:2, sizeEach:5,
// unit:'ltr'}; mancava solo la voce nella tabella di conversione.
//
// MT94 aggiunge il solo alias 'ltr'. 'lt' NON e' stato aggiunto: e' fuori
// dal target di MT94 e cambierebbe il comportamento su documenti Hardie's
// mai auditati in questo task.

const fs   = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT  = path.join(__dirname, '..');
const utils = require(path.join(ROOT, 'js/vendor-parsers/utils.js'));
const M     = require(path.join(ROOT, 'js/vendor-parsers/price-intelligence-merge.js'));
const { mergePriceIntelligence, packTotalEach } = M;

const WORKER = fs.readFileSync(path.join(ROOT, 'edge-functions/vendor-doc-auto-import/index.ts'), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

// g(pack) — la conversione condivisa, esattamente come la chiamano i parser.
function g(pack) { return utils.packToGrams(utils.parsePackSize(pack)); }

// vdaiPackToGrams ESTRATTA dal sorgente reale del worker, non ricopiata:
// se il worker e la utils divergessero, questi test lo vedrebbero.
function workerPackToGrams() {
  const i = WORKER.indexOf('function vdaiPackToGrams');
  assert.ok(i > 0, 'vdaiPackToGrams non trovata nel worker');
  const j = WORKER.indexOf('\n}', i) + 2;
  const body = WORKER.slice(i, j)
    .replace(/: string \| null/g, '')
    .replace(/: number \| null/g, '')
    .replace(/: Record<string, number>/g, '');
  // eslint-disable-next-line no-new-func
  return new Function(body + '; return vdaiPackToGrams;')();
}
const vdai = workerPackToGrams();

console.log('\n── MT94: supporto unita\' LTR ──\n');

// ── 1-2. il caso target ────────────────────────────────────────────
test('1. "2/ 5 LTR" -> 10000 g (2 x 5 L)', () => {
  const p = utils.parsePackSize('2/ 5 LTR');
  assert.deepStrictEqual({ c: p.count, s: p.sizeEach, u: p.unit }, { c: 2, s: 5, u: 'ltr' },
    'parsePackSize non legge piu\' il pack come prima');
  assert.strictEqual(g('2/ 5 LTR'), 10000);
});

test('2. "1 LTR" -> 1000 g', () => {
  assert.strictEqual(g('1 LTR'), 1000);
  assert.strictEqual(g('5 LTR'), 5000);
});

// ── 3-4. la famiglia volumetrica esistente non si muove ────────────
test('3. "4/ 1250 ML" resta 5000 g', () => {
  assert.strictEqual(g('4/ 1250 ML'), 5000);
});

test('4. "1/ 1 L" resta 1000 g', () => {
  assert.strictEqual(g('1/ 1 L'), 1000);
  assert.strictEqual(g('1/ 1 GAL'), 3785.41, 'GAL non deve muoversi');
});

// ── 5-6. le unita' a peso non si muovono ───────────────────────────
test('5. LB invariato', () => {
  assert.strictEqual(g('1/ 50 LB'), 50 * 453.592);
  assert.strictEqual(g('2/ 10 LB'), 2 * 10 * 453.592);
  assert.strictEqual(g('4/ 5 LB'), 4 * 5 * 453.592);
  assert.strictEqual(g('1/ 15 LB'), 15 * 453.592);
});

test('6. OZ invariato', () => {
  assert.strictEqual(g('8/ 12 OZ'), 8 * 12 * 28.3495);
  assert.strictEqual(g('4/ 28 OZ'), 4 * 28 * 28.3495);
});

// ── 7-8. le unita' a conteggio non si muovono ──────────────────────
test('7. PR = 2 each invariato (MT93A)', () => {
  assert.strictEqual(packTotalEach('1/ 1 PR'), 2);
  assert.strictEqual(packTotalEach('2/ 1 PR'), 4);
  assert.strictEqual(g('1/ 1 PR'), null, 'un paio non ha grammi');
});

test('8. CT/DZ invariati', () => {
  assert.strictEqual(packTotalEach('3/ 50 CT'), 150);
  assert.strictEqual(packTotalEach('10/ 100 CT'), 1000);
  assert.strictEqual(packTotalEach('12/ 250 CT'), 3000);
  assert.strictEqual(packTotalEach('1/ 100 CT'), 100);
  assert.strictEqual(packTotalEach('15 DZ'), 180);
  assert.strictEqual(packTotalEach('2/ 5 LTR'), null, 'un litro non e\' un pezzo');
});

// ── 9. MT88A: il salvataggio della conversione memorizzata ─────────
test('9. MT88A rescue invariato, anche su un pack in litri', () => {
  // Semolina, il caso storico: pack troncato "1/" -> niente da cui
  // ricavare i grammi, la conversione memorizzata va preservata.
  const r = mergePriceIntelligence(
    { conversion_to_base: 22680, pack_description: '1/ 50 LB', price_per_100g: 0.0986 },
    { unit_price: 22.37, pack_description: '1/', price_type: 'per_case',
      conversion_to_base: null, price_per_100g: null, last_invoice_date: '2026-09-10' });
  assert.strictEqual(r.reason, 'rescue_missing_pack');
  assert.strictEqual(r.fields.conversion_to_base, 22680);
  assert.strictEqual(r.fields.pack_description, '1/ 50 LB');

  // Stesso meccanismo su un pack in litri: pack troncato -> si salva 10000.
  const l = mergePriceIntelligence(
    { conversion_to_base: 10000, pack_description: '2/ 5 LTR', price_per_100g: 0.5388 },
    { unit_price: 53.88, pack_description: '2/', price_type: 'per_case',
      conversion_to_base: null, price_per_100g: null, last_invoice_date: '2026-09-10' });
  assert.strictEqual(l.reason, 'rescue_missing_pack');
  assert.strictEqual(l.fields.conversion_to_base, 10000);
});

// ── 10. MT88A.1: fail-closed su pack materialmente diverso ─────────
test('10. MT88A.1 fail-closed invariato, anche su un pack in litri', () => {
  const r = mergePriceIntelligence(
    { conversion_to_base: 22680, pack_description: '1/ 50 LB', price_per_100g: 0.0986 },
    { unit_price: 24.00, pack_description: '80#', price_type: 'per_case',
      conversion_to_base: null, price_per_100g: null, last_invoice_date: '2026-09-10' });
  assert.strictEqual(r.reason, 'unresolved_pack_change');
  assert.strictEqual(r.skipped, true);
  assert.strictEqual(r.fields, null);

  // Litri: una conversione valida non viene degradata da un pack a
  // conteggio che i grammi non li ha.
  const l = mergePriceIntelligence(
    { conversion_to_base: 10000, pack_description: '2/ 5 LTR', price_per_100g: 0.5388 },
    { unit_price: 53.88, pack_description: '2/ 5 CT', price_type: 'per_case',
      conversion_to_base: null, price_per_100g: null, last_invoice_date: '2026-09-10' });
  assert.strictEqual(l.reason, 'unresolved_pack_change');
  assert.strictEqual(l.skipped, true);
});

// ── 11. MT89A: price_per_each ────────────────────────────────────
test('11. MT89A price_per_each invariato', () => {
  const r = mergePriceIntelligence(
    { conversion_to_base: null, pack_description: '10/ 100 CT', price_per_100g: null },
    { unit_price: 53.00, pack_description: '10/ 100 CT', price_type: 'per_case',
      conversion_to_base: null, price_per_100g: null, last_invoice_date: '2026-09-10' });
  assert.strictEqual(r.fields.price_per_each, 0.053, 'il costo per pezzo non segue la cassa');

  // Un pack in litri non e' a conteggio: price_per_each non viene scritto.
  const l = mergePriceIntelligence(null,
    { unit_price: 53.88, pack_description: '2/ 5 LTR', price_type: 'per_case',
      conversion_to_base: 10000, price_per_100g: 0.5388, last_invoice_date: '2026-09-10' });
  assert.ok(!('price_per_each' in l.fields), 'price_per_each scritto su un pack a volume');
  assert.strictEqual(l.fields.conversion_to_base, 10000);
});

// ── 12. parita' worker / utils / UI ──────────────────────────────
test('12. worker e utils convertono LTR allo stesso modo', () => {
  for (const pack of ['2/ 5 LTR', '1 LTR', '5 LTR', '4/ 1250 ML', '1/ 1 L',
                      '1/ 50 LB', '2/ 10 LB', '8/ 12 OZ', '1/ 1 GAL']) {
    assert.strictEqual(vdai(pack), g(pack), 'worker e utils divergono su ' + pack);
  }
  assert.strictEqual(vdai('2/ 5 LTR'), 10000);
  // il worker deve conoscere LTR nella tabella E in entrambe le regex
  assert.ok(/LTR: 1000/.test(WORKER), 'LTR assente dalla tabella del worker');
  assert.strictEqual((WORKER.match(/\|ML\|LTR\|L\||\|ML\|LTR\|L\)/g) || []).length +
                     (WORKER.match(/ML\|LTR\|L/g) || []).length > 0, true,
                     'LTR assente dalle regex del worker');
});

test('12b. LTR non fa sconfinare LB, ML, GAL nel ramo litri', () => {
  // il confine di parola deve impedire ogni falso positivo
  assert.strictEqual(vdai('2/ 10 LB'), 2 * 10 * 453.592);
  assert.strictEqual(vdai('4/ 1250 ML'), 5000);
  assert.strictEqual(vdai('1/ 1 GAL'), 3785.41);
  assert.strictEqual(g('2/ 10 LB'), 2 * 10 * 453.592);
  assert.strictEqual(g('4/ 1250 ML'), 5000);
});

// ── 13. il modulo embeddato nel worker e' quello vero ────────────
test('13. utils embeddato nel worker identico al file su disco', () => {
  const line = WORKER.split('\n').find(l => l.startsWith('  "utils": '));
  assert.ok(line, 'voce "utils" assente da PARSER_SOURCES');
  const emb = JSON.parse(line.slice('  "utils": '.length, -1));
  const disk = fs.readFileSync(path.join(ROOT, 'js/vendor-parsers/utils.js'), 'utf8');
  assert.strictEqual(emb, disk, 'PARSER_SOURCES.utils divergente dal file su disco');
  assert.ok(/ltr: 1000/.test(emb), 'il modulo embeddato non conosce LTR');
});

// ── 14. la UI conosce LTR quanto il worker ───────────────────────
test('14. parita\' worker / UI su LTR (jsdom sul file reale)', () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.org/' });
  const prevW = global.window, prevD = global.document;
  global.window = dom.window; global.document = dom.window.document;
  try {
    dom.window.VendorParserUtils = utils;
    dom.window.PriceIntelligenceMerge = M;
    const ui = fs.readFileSync(path.join(ROOT, 'js/vendor-documents-review.js'), 'utf8');
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', ui)(dom.window, dom.window.document);
    const vdr = dom.window.vdrPackToGrams;
    assert.strictEqual(typeof vdr, 'function', 'vdrPackToGrams non definita');

    assert.strictEqual(vdr('2/ 5 LTR', false, null, null), 10000, 'la UI non converte LTR');
    assert.strictEqual(vdr('1 LTR', false, null, null), 1000);
    assert.strictEqual(vdr('5 LTR', false, null, null), 5000);
    assert.strictEqual(vdr('2/ 5 LTR', false, null, null), vdai('2/ 5 LTR'),
      'worker e UI divergono su LTR');

    // e le unita' che la UI gia' conosceva non si sono mosse
    assert.strictEqual(vdr('1/ 50 LB', false, null, null), 22679.6);
    assert.strictEqual(vdr('2/ 10 LB', false, null, null), 9071.84);
    assert.strictEqual(vdr('4/ 5 LB', false, null, null), 4 * 5 * 453.592);
    assert.strictEqual(vdr('8/ 12 OZ', false, null, null), 8 * 12 * 28.3495);
    assert.strictEqual(vdr('1/ 1 PR', false, null, null), null);
    assert.strictEqual(vdr('3/ 50 CT', false, null, null), null);
  } finally {
    global.window = prevW; global.document = prevD;
  }
});

console.log('\n' + (failed === 0 ? '✓' : '✗') + ' MT94: ' + passed + ' passati, ' + failed + ' falliti\n');
process.exit(failed === 0 ? 0 : 1);
