// MICRO-TASK 89A — il costo per pezzo deve seguire il prezzo della cassa.
//
// Bug osservato in produzione il 2026-09-20, import di 0003099324:
// BEK 130881 (guanti L, "10/ 100 CT") passa da unit_price 52.92 a 53.00
// ma price_per_each resta 0.05292 invece di 0.053.
//
// La patch estende la decisione condivisa di MICRO-TASK 88A/88A.1 dalla
// sola conversione in grammi alla CAPACITA' della cassa — grammi per i
// prodotti a peso, pezzi per quelli a conteggio — cosi' le due famiglie
// sono protette dalla stessa regola e price_per_each viene ricalcolato
// quando, e solo quando, i pezzi per cassa sono davvero noti.

const fs   = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const M = require(path.join(ROOT, 'js/vendor-parsers/price-intelligence-merge.js'));
const { mergePriceIntelligence, packTotalEach } = M;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

// Osservazione di un documento a conteggio: il worker non sa convertire
// i CT in grammi, quindi conversion e price_per_100g arrivano sempre null.
function osservaCount(pack, unitPrice, invoiceDate, priceType) {
  return {
    unit_price: unitPrice,
    pack_description: pack,
    price_type: priceType || 'per_case',
    conversion_to_base: null,
    price_per_100g: null,
    last_invoice_date: invoiceDate,
  };
}

console.log('\n── MT89A: price_per_each segue il prezzo della cassa ──\n');

// ── 1 ────────────────────────────────────────────────────────────────
test('1. GUANTO REALE 130881: 52.92 -> 53.00 su "10/ 100 CT" → price_per_each 0.053', () => {
  const existing = {
    pack_description: '10/ 100 CT',
    conversion_to_base: null,
    price_per_100g: null,
    price_per_each: 0.05292,
    unit_price: 52.92,
    last_invoice_date: '2026-08-18',
  };
  const r = mergePriceIntelligence(existing, osservaCount('10/ 100 CT', 53.00, '2026-09-03'));
  assert.strictEqual(r.skipped, false);
  assert.strictEqual(r.reason, 'update');
  assert.ok('price_per_each' in r.fields, 'price_per_each non scritto: il bug e\' ancora li\'');
  assert.strictEqual(r.fields.price_per_each, 0.053, 'atteso 0.053, ottenuto ' + r.fields.price_per_each);
  assert.strictEqual(r.fields.unit_price, 53.00);
  assert.strictEqual(r.fields.pack_description, '10/ 100 CT');
  // e nulla di cio' che era gia' giusto cambia
  assert.strictEqual(r.fields.conversion_to_base, null);
  assert.strictEqual(r.fields.price_per_100g, null);
});

// ── 2 ────────────────────────────────────────────────────────────────
test('2. Container "6/ 40 CT": il prezzo cambia → ricalcolo su 240 pezzi', () => {
  assert.strictEqual(packTotalEach('6/ 40 CT'), 240);
  const existing = { pack_description: '6/ 40 CT', conversion_to_base: null, price_per_100g: null,
                     price_per_each: 0.2073333333333333, last_invoice_date: '2026-07-23' };
  const r = mergePriceIntelligence(existing, osservaCount('6/ 40 CT', 55.20, '2026-10-01'));
  assert.strictEqual(r.fields.price_per_each, 55.20 / 240);
  assert.strictEqual(r.fields.price_per_each, 0.23);
});

// ── 3 ────────────────────────────────────────────────────────────────
test('3. il conteggio cambia validamente: "6/ 40 CT" → "6/ 50 CT" = 300 pezzi', () => {
  assert.strictEqual(packTotalEach('6/ 50 CT'), 300);
  const existing = { pack_description: '6/ 40 CT', conversion_to_base: null, price_per_100g: null,
                     price_per_each: 0.2073333333333333, last_invoice_date: '2026-07-23' };
  const r = mergePriceIntelligence(existing, osservaCount('6/ 50 CT', 60.00, '2026-10-01'));
  assert.strictEqual(r.reason, 'update', 'un conteggio nuovo e leggibile deve passare');
  assert.strictEqual(r.fields.pack_description, '6/ 50 CT');
  assert.strictEqual(r.fields.price_per_each, 0.2, '60.00 / 300');
});

// ── 4 ────────────────────────────────────────────────────────────────
test('4. pack troncato "10/" su una riga a conteggio → rescue, non un conteggio inventato', () => {
  const existing = { pack_description: '10/ 100 CT', conversion_to_base: null, price_per_100g: null,
                     price_per_each: 0.05292, last_invoice_date: '2026-08-18' };
  const r = mergePriceIntelligence(existing, osservaCount('10/', 53.00, '2026-09-03'));
  assert.strictEqual(r.skipped, false);
  assert.strictEqual(r.reason, 'rescue_missing_pack',
    'prima di 89A questa riga non era protetta: conversion_to_base e\' null e la regola non scattava');
  assert.strictEqual(r.fields.pack_description, '10/ 100 CT', 'il pack buono e\' stato sovrascritto dal troncato');
  assert.strictEqual(r.fields.price_per_each, 0.053, 'il conteggio conservato deve valere sul prezzo nuovo');
});

test('4b. riga NUOVA con pack troncato → non si inventa nessun conteggio', () => {
  const r = mergePriceIntelligence(null, osservaCount('10/', 53.00, '2026-09-03'));
  assert.strictEqual(r.reason, 'update');
  assert.ok(!('price_per_each' in r.fields), 'price_per_each inventato dal nulla');
});

// ── 5 ────────────────────────────────────────────────────────────────
test('5. pack materialmente diverso e non interpretabile → fail-closed, conteggio vecchio non riusato', () => {
  const existing = { pack_description: '10/ 100 CT', conversion_to_base: null, price_per_100g: null,
                     price_per_each: 0.05292, last_invoice_date: '2026-08-18' };
  const r = mergePriceIntelligence(existing, osservaCount('Each', 53.00, '2026-09-03'));
  assert.strictEqual(r.skipped, true, 'doveva essere fail-closed come in MT88A.1');
  assert.strictEqual(r.reason, 'unresolved_pack_change');
  assert.strictEqual(r.fields, null);
  assert.strictEqual(r.storedPack, '10/ 100 CT');
  assert.strictEqual(r.observedPack, 'Each');
});

// ── 6 ────────────────────────────────────────────────────────────────
test('6. conteggio non determinabile: intervallo "16-22 CT" → la colonna non viene toccata', () => {
  assert.strictEqual(packTotalEach('16-22 CT'), null, 'un intervallo non e\' un conteggio certo');
  const existing = { pack_description: '16-22 CT', conversion_to_base: null, price_per_100g: null,
                     price_per_each: 2.0537, last_invoice_date: '2026-09-14' };
  const r = mergePriceIntelligence(existing, osservaCount('16-22 CT', 22.63, '2026-10-01'));
  assert.strictEqual(r.skipped, false);
  assert.ok(!('price_per_each' in r.fields),
    'senza un conteggio certo la chiave deve restare fuori, cosi\' il valore umano sopravvive');
  assert.strictEqual(r.fields.pack_description, '16-22 CT');
  assert.strictEqual(r.fields.unit_price, 22.63);
});

// ── 7 ────────────────────────────────────────────────────────────────
test('7. prodotti a peso: nessuna regressione su conversion_to_base e price_per_100g', () => {
  // il caso Semolina di MT88A, invariato
  const existing = { pack_description: '1/ 50 LB', conversion_to_base: 22680,
                     price_per_100g: 0.09643027213883844, price_per_each: null,
                     last_invoice_date: '2026-07-23' };
  const r = mergePriceIntelligence(existing, {
    unit_price: 21.87, pack_description: '1/', price_type: 'per_case',
    conversion_to_base: null, price_per_100g: null, last_invoice_date: '2026-08-13' });
  assert.strictEqual(r.reason, 'rescue_missing_pack');
  assert.strictEqual(r.fields.conversion_to_base, 22680);
  assert.strictEqual(r.fields.pack_description, '1/ 50 LB');
  assert.strictEqual(r.fields.price_per_100g, (21.87 / 22680) * 100);
  assert.ok(!('price_per_each' in r.fields), 'un prodotto a peso non deve ricevere price_per_each');

  // e un aggiornamento normale a peso
  const obs = { unit_price: 50.92, pack_description: '1/ 55 LB', price_type: 'per_case',
                conversion_to_base: 24948, price_per_100g: 0.20410813722865087,
                last_invoice_date: '2026-09-03' };
  const r2 = mergePriceIntelligence(existing, obs);
  assert.strictEqual(r2.reason, 'update');
  assert.deepStrictEqual(r2.fields, obs, 'un aggiornamento a peso deve restare byte per byte quello di prima');
});

// ── 8 ────────────────────────────────────────────────────────────────
test('8. per_lb: invariato, nessun price_per_each e conversione null esplicita', () => {
  const existing = { pack_description: '8 LB', conversion_to_base: 3629, price_per_100g: 8.5,
                     price_per_each: null, last_invoice_date: '2026-09-01' };
  const r = mergePriceIntelligence(existing, {
    unit_price: 90, pack_description: '8 LB', price_type: 'per_lb',
    conversion_to_base: null, price_per_100g: null, last_invoice_date: '2026-09-19' });
  assert.strictEqual(r.reason, 'update');
  assert.strictEqual(r.fields.conversion_to_base, null);
  assert.ok(!('price_per_each' in r.fields));
  // anche con un pack a conteggio, per_lb non produce price_per_each
  const r2 = mergePriceIntelligence({ pack_description: '50 CT', conversion_to_base: null,
                                      price_per_each: 0.4688, price_per_100g: null },
    { unit_price: 16.46, pack_description: '50 CT', price_type: 'per_lb',
      conversion_to_base: null, price_per_100g: null, last_invoice_date: '2026-09-19' });
  assert.ok(!('price_per_each' in r2.fields), 'per_lb non deve derivare un costo per pezzo');
});

// ── 9 ────────────────────────────────────────────────────────────────
test('9. chronology guard: invariato, resta a monte in entrambi i chiamanti', () => {
  const worker = fs.readFileSync(path.join(ROOT, 'edge-functions/vendor-doc-auto-import/index.ts'), 'utf8');
  const a = worker.indexOf('const PARSER_SOURCES: Record<string, string> = {');
  const b = worker.indexOf('\n};\n', a) + 4;
  const body = worker.slice(0, a) + worker.slice(b);
  const ui = fs.readFileSync(path.join(ROOT, 'js/vendor-documents-review.js'), 'utf8');
  for (const [nome, src] of [['worker', body], ['UI', ui]]) {
    assert.ok(/function chronologyAllows\(|chronologyAllows\(/.test(src), nome + ': guardrail sparito');
    assert.ok((src.match(/chronologyAllows\(/g) || []).length >= 4, nome + ': rami del guardrail ridotti');
    assert.strictEqual((src.match(/mergeFor\(/g) || []).length, 7, nome + ': punti di scrittura cambiati');
  }
});

// ── 10 ───────────────────────────────────────────────────────────────
test('10. parita\' worker/UI: stessa decisione, modulo embeddato == file del browser', () => {
  const worker = fs.readFileSync(path.join(ROOT, 'edge-functions/vendor-doc-auto-import/index.ts'), 'utf8');
  const m = worker.match(/^  "price-intelligence-merge": (".*?"),$/m);
  assert.ok(m, 'modulo non presente in PARSER_SOURCES');
  const disco = fs.readFileSync(path.join(ROOT, 'js/vendor-parsers/price-intelligence-merge.js'), 'utf8');
  assert.strictEqual(JSON.parse(m[1]), disco, 'la copia embeddata e\' divergente dal file');

  // utils, da cui il modulo legge parsePackSize, deve essere embeddato e identico
  const mu = worker.match(/^  "utils": (".*?"),$/m);
  assert.ok(mu, 'utils non presente in PARSER_SOURCES');
  assert.strictEqual(JSON.parse(mu[1]),
    fs.readFileSync(path.join(ROOT, 'js/vendor-parsers/utils.js'), 'utf8'),
    'la copia embeddata di utils e\' divergente');

  // esecuzione vera del modulo embeddato, con il suo require risolto su PARSER_SOURCES
  const sources = {};
  for (const k of ['utils', 'price-intelligence-merge']) {
    sources[k] = JSON.parse(worker.match(new RegExp('^  "' + k + '": (".*?"),$', 'm'))[1]);
  }
  const cache = {};
  function req(name) {
    const key = name.replace(/^\.\//, '');
    if (cache[key]) return cache[key].exports;
    const mod = { exports: {} };
    cache[key] = mod;
    // eslint-disable-next-line no-new-func
    new Function('require', 'module', 'exports', sources[key])(req, mod, mod.exports);
    return mod.exports;
  }
  const embedded = req('price-intelligence-merge').mergePriceIntelligence;

  const packs = [null, '', '10/', '10/ 100 CT', '6/ 40 CT', '6/ 50 CT', '15 DZ', '50 CT',
                 '16-22 CT', 'Each', '1/ 50 LB', '1/ 55 LB', '9-1/2 GAL', '80#   ITA'];
  const existings = [null,
    { pack_description: '10/ 100 CT', conversion_to_base: null, price_per_100g: null, price_per_each: 0.05292, last_invoice_date: '2026-08-18' },
    { pack_description: '1/ 50 LB',  conversion_to_base: 22680, price_per_100g: 0.0964, price_per_each: null, last_invoice_date: '2026-07-23' },
    { pack_description: '16-22 CT',  conversion_to_base: null, price_per_100g: null, price_per_each: 2.0537, last_invoice_date: '2026-09-14' }];
  let n = 0;
  for (const ex of existings) for (const p of packs) for (const pt of ['per_case', 'per_lb']) {
    const obs = { unit_price: 42.5, pack_description: p, price_type: pt,
                  conversion_to_base: null, price_per_100g: null, last_invoice_date: '2026-10-01' };
    assert.deepStrictEqual(embedded(ex, obs), mergePriceIntelligence(ex, obs),
      'decisione divergente su ' + JSON.stringify(p) + ' / ' + JSON.stringify(ex && ex.pack_description));
    n++;
  }
  assert.strictEqual(n, 112, 'attesi 112 scenari, eseguiti ' + n);

  // e il browser deve caricare utils PRIMA del modulo che lo usa
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const iUtils = html.indexOf('js/vendor-parsers/utils.js');
  const iMerge = html.indexOf('js/vendor-parsers/price-intelligence-merge.js');
  const iVdr   = html.indexOf('js/vendor-documents-review.js');
  assert.ok(iUtils > 0, 'utils.js non incluso in index.html');
  assert.ok(iUtils < iMerge, 'utils.js deve precedere price-intelligence-merge.js');
  assert.ok(iMerge < iVdr,   'il modulo deve precedere vendor-documents-review.js');
  assert.ok(/window\.VendorParserUtils = API/.test(
    fs.readFileSync(path.join(ROOT, 'js/vendor-parsers/utils.js'), 'utf8')),
    'utils.js non si espone su window');
});

// ── 11 ───────────────────────────────────────────────────────────────
test('11. MT85/86/87/88/89: i risultati economici storici restano identici', () => {
  // ogni mapping creato in quei task era un INSERT (existing null):
  // il merge deve essere trasparente, campo per campo.
  const storici = [
    { t: 'MT85', pack: '10/ 100 CT', up: 52.36, conv: null,  p100: null },
    { t: 'MT85', pack: '4/ 10 LB',   up: 46.62, conv: 18144, p100: 0.25694897617241924 },
    { t: 'MT86', pack: '2/ 10 LB',   up: 25.88, conv: 9072,  p100: 0.2852783999717808 },
    { t: 'MT87', pack: '4/ 1 GAL',   up: 66.71, conv: 15142, p100: 0.4405731479549111 },
    { t: 'MT87', pack: '1/ 50 LB',   up: 21.87, conv: 22680, p100: 0.09643027213883844 },
    { t: 'MT88', pack: '1/ 15 LB',   up: 53.80, conv: 6804,  p100: 0.7907252920392481 },
    { t: 'MT88', pack: '8/ 12 OZ',   up: 22.87, conv: 2722,  p100: 0.8403293414933833 },
    { t: 'MT88', pack: '6/ 3 LB',    up: 82.54, conv: 8165,  p100: 1.0109427757887166 },
    { t: 'MT89', pack: '1/ 11 LB',   up: 61.22, conv: 4990,  p100: 1.2269737000331897 },
  ];
  for (const s of storici) {
    const obs = { unit_price: s.up, pack_description: s.pack, price_type: 'per_case',
                  conversion_to_base: s.conv, price_per_100g: s.p100, last_invoice_date: null };
    const r = mergePriceIntelligence(null, obs);
    assert.strictEqual(r.reason, 'update', s.t + ' ' + s.pack);
    assert.strictEqual(r.fields.conversion_to_base, s.conv, s.t + ' ' + s.pack + ': conversione cambiata');
    assert.strictEqual(r.fields.price_per_100g, s.p100, s.t + ' ' + s.pack + ': prezzo per 100 g cambiato');
    assert.strictEqual(r.fields.unit_price, s.up, s.t + ' ' + s.pack);
  }
  // i tre container/guanti di MT85-87 ricevono ora price_per_each, con lo
  // STESSO valore che era stato scritto a mano allora: nessuna differenza economica.
  const gia = [
    { pack: '10/ 100 CT', up: 52.36, atteso: 0.05236 },   // MT85 guanti M
    { pack: '10/ 100 CT', up: 52.92, atteso: 0.05292 },   // MT86 guanti L
    { pack: '6/ 40 CT',   up: 49.76, atteso: 0.2073333333333333 }, // MT87 container 16 oz
  ];
  for (const g of gia) {
    const r = mergePriceIntelligence(null, osservaCount(g.pack, g.up, null));
    // tolleranza a 1e-12: 49.76/240 in virgola mobile da' 0.20733333333333331,
    // mentre il valore scritto a mano in MT87 era 0.2073333333333333 — un ulp
    // di differenza, 1.3e-16 in relativo. Nessuna differenza economica.
    const err = Math.abs(r.fields.price_per_each - g.atteso) / g.atteso;
    assert.ok(err < 1e-12,
      g.pack + ' @ ' + g.up + ': atteso ' + g.atteso + ', ottenuto ' + r.fields.price_per_each);
  }
});

// ── il censimento reale ──────────────────────────────────────────────
test('12. le 17 righe reali con price_per_each cadono tutte nel caso giusto', () => {
  // pack, unit_price e price_per_each letti dal database il 2026-09-20.
  const corpus = [
    { sku: '115842', pack: '12/ 250 CT', up: 46.00, each: 0.015333,            n: 3000 },
    { sku: '127279', pack: '2/ 1000 CT', up: 84.74, each: 0.042370,            n: 2000 },
    { sku: '130880', pack: '10/ 100 CT', up: 52.36, each: 0.05236,             n: 1000 },
    { sku: '130881', pack: '10/ 100 CT', up: 53.00, each: 0.05292,             n: 1000 },
    { sku: '130882', pack: '10/ 100 CT', up: 53.00, each: 0.053,               n: 1000 },
    { sku: '394703', pack: '8/ 1 CT',    up: 34.30, each: 4.2875,              n: 8 },
    { sku: '819029', pack: '3/ 50 CT',   up: 60.00, each: 0.4,                 n: 150 },
    { sku: '819050', pack: '6/ 40 CT',   up: 49.76, each: 0.2073333333333333,  n: 240 },
    { sku: '819255', pack: '3/ 50 CT',   up: 74.00, each: 0.493333,            n: 150 },
    { sku: '00254',  pack: '3 CT',       up: 9.68,  each: 3.63,                n: 3 },
    { sku: '01115',  pack: '15 DZ',      up: 24.99, each: 0.0833,              n: 180 },
    { sku: '04260',  pack: '6 CT',       up: 9.31,  each: 2.2117,              n: 6 },
    { sku: '05446',  pack: '1 CT',       up: 14.02, each: 15.97,               n: 1 },
    { sku: '05840',  pack: '50 CT',      up: 16.46, each: 0.4688,              n: 50 },
    { sku: '71104',  pack: '95 CT',      up: 33.41, each: 0.3529,              n: 95 },
    { sku: '71117',  pack: '110 CT',     up: 35.98, each: 0.5493,              n: 110 },
    { sku: '71904',  pack: '16-22 CT',   up: 22.63, each: 2.0537,              n: null },
  ];
  let corrette = 0, ricalcolate = 0, intoccate = 0;
  for (const c of corpus) {
    assert.strictEqual(packTotalEach(c.pack), c.n, c.sku + ': pezzi attesi ' + c.n);
    const ex = { pack_description: c.pack, conversion_to_base: null, price_per_100g: null,
                 price_per_each: c.each, last_invoice_date: '2026-01-01' };
    const r = mergePriceIntelligence(ex, osservaCount(c.pack, c.up, '2026-10-01'));
    assert.strictEqual(r.skipped, false, c.sku);
    if (c.n === null) {
      assert.ok(!('price_per_each' in r.fields), c.sku + ': senza conteggio certo non si tocca');
      intoccate++;
    } else {
      assert.strictEqual(r.fields.price_per_each, c.up / c.n, c.sku);
      if (Math.abs(r.fields.price_per_each - c.each) / c.each < 1e-4) corrette++; else ricalcolate++;
    }
  }
  assert.strictEqual(intoccate, 1, 'solo 16-22 CT non e\' determinabile');
  assert.strictEqual(corrette, 8, 'otto righe erano gia\' allineate');
  assert.strictEqual(ricalcolate, 8, 'otto righe erano stale e vengono corrette');
});

console.log('\n' + (failed === 0 ? '✓' : '✗') + ' MT89A: ' + passed + ' passati, ' + failed + ' falliti\n');
process.exit(failed === 0 ? 0 : 1);
