// MICRO-TASK 88A — una nuova osservazione di qualita' inferiore non deve
// degradare una price intelligence valida gia' memorizzata.
//
// I test 1-8 esercitano la funzione di decisione. Il 9 usa il documento
// BEK 0002869853 vero. Il 10 ripercorre i tre import gia' approvati
// (MT85/86/87) e pretende che nulla cambi. L'11 e' la parita' fra worker
// e UI, letta dai sorgenti, non da copie scritte a mano.

const fs   = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const { mergePriceIntelligence, classifyPack,
        PACK_WEIGHT, PACK_COUNT, PACK_NONE, PACK_UNKNOWN } =
  require(path.join(ROOT, 'js/vendor-parsers/price-intelligence-merge.js'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

// vdaiPackToGrams, estratta dal sorgente del worker — non ricopiata.
function loadWorkerPackToGrams() {
  const src = fs.readFileSync(path.join(ROOT, 'edge-functions/vendor-doc-auto-import/index.ts'), 'utf8');
  const start = src.indexOf('function vdaiPackToGrams(packStr: string | null): number | null {');
  assert.ok(start > 0, 'vdaiPackToGrams non trovata nel worker');
  const end = src.indexOf('\n}\n', start) + 3;
  const ts = src.slice(start, end);
  const js = ts.replace(/: string \| null/g, '').replace(/: number \| null/g, '')
               .replace(/: Record<string, number>/g, '');
  // eslint-disable-next-line no-new-func
  return new Function(js + '\nreturn vdaiPackToGrams;')();
}
const vdaiPackToGrams = loadWorkerPackToGrams();

// Il sorgente del worker MENO il blocco PARSER_SOURCES: dentro quel blocco
// ci sono i parser serializzati come stringhe, che altrimenti inquinano
// ogni ricerca testuale. Il codice vero del worker sta sia prima sia dopo.
function workerBody() {
  const src = fs.readFileSync(path.join(ROOT, 'edge-functions/vendor-doc-auto-import/index.ts'), 'utf8');
  const a = src.indexOf('const PARSER_SOURCES: Record<string, string> = {');
  const b = src.indexOf('\n};\n', a) + 4;
  return src.slice(0, a) + src.slice(b);
}


// L'osservazione, costruita con la stessa catena del worker.
function observe({ pack, unitPrice, invoiceDate, priceType = 'per_case' }) {
  const totalG = vdaiPackToGrams(pack);
  const per100g = (totalG && unitPrice) ? (unitPrice / totalG) * 100 : null;
  const convBase = priceType === 'per_lb' ? null : (totalG || null);
  return {
    unit_price: unitPrice,
    pack_description: pack,
    price_type: priceType,
    conversion_to_base: convBase ? Math.round(convBase) : null,
    price_per_100g: per100g,
    last_invoice_date: invoiceDate,
  };
}

console.log('\n── MT88A: price intelligence non degrada ──\n');

// ── 1 ────────────────────────────────────────────────────────────────
test('1. WEIGHT valido esistente + documento piu\' recente con pack troncato "1/" → niente diventa null', () => {
  const existing = {
    pack_description: '1/ 50 LB',
    conversion_to_base: 22680,
    price_per_100g: 0.09643027213883844,
    last_invoice_date: '2026-07-23',
  };
  const r = mergePriceIntelligence(existing, observe({ pack: '1/', unitPrice: 21.87, invoiceDate: '2026-08-13' }));
  assert.strictEqual(r.rescued, true, 'doveva essere un salvataggio');
  assert.strictEqual(r.fields.conversion_to_base, 22680, 'conversione persa');
  assert.strictEqual(r.fields.pack_description, '1/ 50 LB', 'pack valido sovrascritto dal troncato');
  assert.notStrictEqual(r.fields.price_per_100g, null, 'price_per_100g azzerato');
  assert.strictEqual(r.fields.price_per_100g, (21.87 / 22680) * 100, 'price_per_100g non ricalcolato sul prezzo nuovo');
  assert.strictEqual(r.fields.unit_price, 21.87, 'unit_price non avanzato');
  assert.strictEqual(r.fields.last_invoice_date, '2026-08-13', 'data non avanzata');
  assert.strictEqual(r.packClass, PACK_NONE);
});

// ── 2 ────────────────────────────────────────────────────────────────
test('2. nuovo WEIGHT pack valido e DIVERSO → conversione e prezzo normalizzato si aggiornano', () => {
  const existing = { pack_description: '1/ 50 LB', conversion_to_base: 22680, price_per_100g: 0.0964, last_invoice_date: '2026-07-23' };
  const r = mergePriceIntelligence(existing, observe({ pack: '1/ 55 LB', unitPrice: 50.92, invoiceDate: '2026-08-13' }));
  assert.strictEqual(r.rescued, false, 'non doveva proteggere nulla');
  assert.strictEqual(r.fields.conversion_to_base, 24948, 'nuova conversione non applicata');
  assert.strictEqual(r.fields.pack_description, '1/ 55 LB');
  assert.strictEqual(r.fields.price_per_100g, (50.92 / (55 * 453.592)) * 100);
  assert.strictEqual(r.packClass, PACK_WEIGHT);
});

// ── 3 ────────────────────────────────────────────────────────────────
test('3. stesso pack valido, prezzo nuovo → aggiornamento normale, byte per byte come prima', () => {
  const existing = { pack_description: '1/ 50 LB', conversion_to_base: 22680, price_per_100g: 0.0964, last_invoice_date: '2026-07-23' };
  const obs = observe({ pack: '1/ 50 LB', unitPrice: 23.50, invoiceDate: '2026-08-13' });
  const r = mergePriceIntelligence(existing, obs);
  assert.strictEqual(r.rescued, false);
  assert.deepStrictEqual(r.fields, obs, 'il merge ha alterato un aggiornamento normale');
});

// ── 4 ────────────────────────────────────────────────────────────────
test('4. COUNT pack "10/ 100 CT" → conversion_to_base null resta legittimo, il pack si aggiorna', () => {
  const existing = { pack_description: '10/ 100 CT', conversion_to_base: null, price_per_100g: null, last_invoice_date: '2026-08-18' };
  const r = mergePriceIntelligence(existing, observe({ pack: '10/ 100 CT', unitPrice: 52.92, invoiceDate: '2026-09-17' }));
  assert.strictEqual(r.rescued, false, 'un count pack non e\' un salvataggio');
  assert.strictEqual(r.fields.conversion_to_base, null);
  assert.strictEqual(r.fields.price_per_100g, null);
  assert.strictEqual(r.fields.pack_description, '10/ 100 CT');
  assert.strictEqual(r.fields.unit_price, 52.92);
  assert.strictEqual(r.fields.last_invoice_date, '2026-09-17');
  assert.strictEqual(r.packClass, PACK_COUNT);
  assert.ok(!('price_per_each' in r.fields), 'price_per_each non deve essere toccato da questo percorso');
});

// ── 5 ────────────────────────────────────────────────────────────────
test('5. altro COUNT "6/ 40 CT" → stesso comportamento, e un cambio di conteggio passa', () => {
  const existing = { pack_description: '6/ 40 CT', conversion_to_base: null, price_per_100g: null, last_invoice_date: '2026-07-23' };
  const r = mergePriceIntelligence(existing, observe({ pack: '6/ 50 CT', unitPrice: 49.76, invoiceDate: '2026-09-01' }));
  assert.strictEqual(r.rescued, false);
  assert.strictEqual(r.fields.conversion_to_base, null);
  assert.strictEqual(r.fields.pack_description, '6/ 50 CT', 'un count pack nuovo deve poter sostituire il vecchio');
  assert.strictEqual(r.packClass, PACK_COUNT);
});

// ── 6 ────────────────────────────────────────────────────────────────
test('6. nessuna conversione precedente + pack incompleto → non si inventa niente', () => {
  const r = mergePriceIntelligence(null, observe({ pack: '3/', unitPrice: 40.00, invoiceDate: '2026-08-27' }));
  assert.strictEqual(r.rescued, false);
  assert.strictEqual(r.fields.conversion_to_base, null, 'conversione inventata dal nulla');
  assert.strictEqual(r.fields.price_per_100g, null, 'prezzo normalizzato inventato dal nulla');
  const r2 = mergePriceIntelligence({ conversion_to_base: null, pack_description: null, price_per_100g: null },
                                    observe({ pack: '3/', unitPrice: 40.00, invoiceDate: '2026-08-27' }));
  assert.strictEqual(r2.fields.conversion_to_base, null);
  assert.strictEqual(r2.fields.price_per_100g, null);
});

// ── 7 ────────────────────────────────────────────────────────────────
test('7. chronology guard: e\' a monte e resta intatto, il merge non lo scavalca', () => {
  const body = workerBody();
  const guardOk = /function chronologyAllows\([\s\S]*?if \(!existingLastInvoiceDate\) return true;[\s\S]*?return incomingInvoiceDate >= existingLastInvoiceDate;/.test(body);
  assert.ok(guardOk, 'chronologyAllows alterata');
  // il merge non ha sostituito il guardrail: restano tutti i rami che lo chiamano
  const nGuard = (body.match(/chronologyAllows\(/g) || []).length;
  assert.ok(nGuard >= 4, 'chronologyAllows non piu\' chiamata in tutti i rami: ' + nGuard);
  // e ogni ramo che scrive passa dal merge
  const nMerge = (body.match(/mergeFor\(/g) || []).length;
  assert.strictEqual(nMerge, 7, 'attesi 7 punti di scrittura passati dal merge, trovati ' + nMerge);
  // in ogni ramo di UPDATE il guardrail precede testualmente il merge
  for (const ramo of body.split('if (!chronologyAllows(').slice(1)) {
    const fino = ramo.slice(0, 600);
    assert.ok(fino.includes('continue;'), 'un ramo con guardrail non interrompe piu\' la scrittura');
  }
});

// ── 8 ────────────────────────────────────────────────────────────────
test('8. pack mancante del tutto (null) → fail-safe: si conserva, non si cancella', () => {
  const existing = { pack_description: '1/ 15 LB', conversion_to_base: 6804, price_per_100g: 1.0817, last_invoice_date: '2026-07-25' };
  const r = mergePriceIntelligence(existing, observe({ pack: null, unitPrice: 73.60, invoiceDate: '2026-08-01' }));
  assert.strictEqual(r.rescued, true);
  assert.strictEqual(r.fields.conversion_to_base, 6804);
  assert.strictEqual(r.fields.pack_description, '1/ 15 LB');
  assert.strictEqual(r.packClass, PACK_NONE);
  // e senza nulla da proteggere, resta null
  const r2 = mergePriceIntelligence({ conversion_to_base: null }, observe({ pack: null, unitPrice: 10, invoiceDate: '2026-08-01' }));
  assert.strictEqual(r2.fields.conversion_to_base, null);
});

test('8b. price_type per_lb: la conversione null e\' esplicita e continua a passare', () => {
  const existing = { pack_description: '8 LB', conversion_to_base: 3629, price_per_100g: 8.5, last_invoice_date: '2026-09-01' };
  const r = mergePriceIntelligence(existing, observe({ pack: '8 LB', unitPrice: 90, invoiceDate: '2026-09-19', priceType: 'per_lb' }));
  assert.strictEqual(r.rescued, false, 'per_lb non e\' un salvataggio');
  assert.strictEqual(r.fields.conversion_to_base, null, 'per_lb deve poter scrivere null');
});

// ── 9 ────────────────────────────────────────────────────────────────
test('9. Semolina reale: 0002869853 non degrada la riga BEK 688106', () => {
  const PRE = {
    pack_description: '1/ 50 LB',
    conversion_to_base: 22680,
    price_per_100g: 0.09643027213883844,
    price_per_each: null,
    last_invoice_date: '2026-07-23',
    unit_price: 21.87,
  };
  const r = mergePriceIntelligence(PRE, observe({ pack: '1/', unitPrice: 21.87, invoiceDate: '2026-08-13' }));
  const POST = r.fields;
  assert.strictEqual(POST.conversion_to_base, 22680, 'conversione persa sul caso reale');
  assert.strictEqual(POST.pack_description, '1/ 50 LB', 'pack valido perso sul caso reale');
  assert.ok(POST.price_per_100g > 0.096 && POST.price_per_100g < 0.097, 'prezzo per 100 g fuori scala: ' + POST.price_per_100g);
  assert.strictEqual(POST.unit_price, 21.87);
  assert.strictEqual(POST.last_invoice_date, '2026-08-13');
  assert.ok(!('price_per_each' in POST), 'price_per_each non deve comparire fra i campi scritti');
});

test('9b. gli altri cinque SKU a rischio censiti in produzione sono tutti protetti', () => {
  const casi = [
    { nome: 'Hardie\'s 03744', pack: '9-1/2 GAL',  conv: 35961, prezzo: 83.00 },
    { nome: 'Hardie\'s 25618', pack: '6-4/2 oz',   conv: 1361,  prezzo: 24.50 },
    { nome: 'Hardie\'s 00907', pack: '80#   ITA',  conv: 36287, prezzo: 13.50 },
    { nome: 'Hardie\'s 00912', pack: '13#   ITA',  conv: 5897,  prezzo: 10.85 },
    { nome: 'BEK 688106',      pack: '1/',         conv: 22680, prezzo: 21.87 },
  ];
  for (const c of casi) {
    assert.strictEqual(vdaiPackToGrams(c.pack), null, c.nome + ': il worker ora saprebbe leggere questo pack, il test va rivisto');
    const r = mergePriceIntelligence(
      { pack_description: c.pack, conversion_to_base: c.conv, price_per_100g: 1, last_invoice_date: '2026-09-14' },
      observe({ pack: c.pack, unitPrice: c.prezzo, invoiceDate: '2026-09-21' }));
    assert.strictEqual(r.rescued, true, c.nome + ': non protetto');
    assert.strictEqual(r.fields.conversion_to_base, c.conv, c.nome + ': conversione persa');
    assert.strictEqual(r.fields.price_per_100g, (c.prezzo / c.conv) * 100, c.nome + ': prezzo normalizzato non ricalcolato');
  }
});

// ── 10 ───────────────────────────────────────────────────────────────
test('10. MT85/MT86/MT87: i tre import gia\' approvati producono gli stessi valori di prima', () => {
  // Righe nuove (existing = null): il merge deve essere trasparente.
  const righe = [
    { sku: '130880', pack: '10/ 100 CT', prezzo: 52.36, data: '2026-08-18' },  // MT85
    { sku: '780005', pack: '4/ 10 LB',   prezzo: 46.62, data: '2026-08-18' },  // MT85
    { sku: '700150', pack: '2/ 10 LB',   prezzo: 25.88, data: '2026-08-18' },  // MT86
    { sku: '130881', pack: '10/ 100 CT', prezzo: 52.92, data: '2026-08-18' },  // MT86
    { sku: '662583', pack: '4/ 1 GAL',   prezzo: 66.71, data: '2026-07-23' },  // MT87
    { sku: '688106', pack: '1/ 50 LB',   prezzo: 21.87, data: '2026-07-23' },  // MT87
    { sku: '819050', pack: '6/ 40 CT',   prezzo: 49.76, data: '2026-07-23' },  // MT87
  ];
  for (const r of righe) {
    const obs = observe({ pack: r.pack, unitPrice: r.prezzo, invoiceDate: r.data });
    const m = mergePriceIntelligence(null, obs);
    assert.strictEqual(m.rescued, false, r.sku + ': una riga nuova non ha niente da proteggere');
    assert.deepStrictEqual(m.fields, obs, r.sku + ': valori cambiati rispetto a prima della patch');
  }
  // I numeri effettivamente in produzione dopo MT87.
  const semolina = mergePriceIntelligence(null, observe({ pack: '1/ 50 LB', unitPrice: 21.87, invoiceDate: '2026-07-23' }));
  assert.strictEqual(semolina.fields.conversion_to_base, 22680);
  assert.strictEqual(semolina.fields.price_per_100g, 0.09643027213883844);
  const caesar = mergePriceIntelligence(null, observe({ pack: '4/ 1 GAL', unitPrice: 66.71, invoiceDate: '2026-07-23' }));
  assert.strictEqual(caesar.fields.conversion_to_base, 15142);
  assert.strictEqual(caesar.fields.price_per_100g, 0.4405731479549111);
  const container = mergePriceIntelligence(null, observe({ pack: '6/ 40 CT', unitPrice: 49.76, invoiceDate: '2026-07-23' }));
  assert.strictEqual(container.fields.conversion_to_base, null);
  assert.strictEqual(container.fields.price_per_100g, null);
});

// ── 11 ───────────────────────────────────────────────────────────────
test('11. parita\' worker/UI: un solo modulo, nessuna terza copia della decisione', () => {
  const worker = fs.readFileSync(path.join(ROOT, 'edge-functions/vendor-doc-auto-import/index.ts'), 'utf8');
  const ui     = fs.readFileSync(path.join(ROOT, 'js/vendor-documents-review.js'), 'utf8');
  const body   = workerBody();

  assert.ok(body.includes('parsersApi().priceIntel.mergePriceIntelligence'), 'il worker non usa il modulo condiviso');
  assert.ok(ui.includes('priceIntel.mergePriceIntelligence'), 'la UI non usa il modulo condiviso');
  assert.ok(ui.includes('window.PriceIntelligenceMerge'), 'la UI non legge il modulo da window');

  // Nessuno dei due deve piu' avere il vecchio blocco che scriveva
  // direttamente i campi calcolati.
  assert.ok(!/\.\.\.fields\b/.test(body), 'il worker scrive ancora ...fields');
  assert.ok(!/\.\.\.fields\b/.test(ui),   'la UI scrive ancora ...fields');

  // Entrambi devono leggere le colonne che servono a proteggere il dato.
  for (const [nome, src] of [['worker', body], ['UI', ui]]) {
    const n = (src.match(/select\('id,ingredient_id,vendor_sku,last_invoice_date,conversion_to_base,pack_description,price_per_100g'\)/g) || []).length;
    assert.strictEqual(n, 2, nome + ': attese 2 select allargate, trovate ' + n);
  }

  // Il modulo embeddato nel worker deve essere byte-identico al file.
  const disco = fs.readFileSync(path.join(ROOT, 'js/vendor-parsers/price-intelligence-merge.js'), 'utf8');
  const m = worker.match(/^  "price-intelligence-merge": (".*?"),$/m);
  assert.ok(m, 'price-intelligence-merge non e\' in PARSER_SOURCES');
  assert.strictEqual(JSON.parse(m[1]), disco, 'la copia embeddata nel worker e\' divergente dal file');

  // E il browser deve caricarlo prima di chi lo usa.
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const iMod = html.indexOf('js/vendor-parsers/price-intelligence-merge.js');
  const iUse = html.indexOf('js/vendor-documents-review.js');
  assert.ok(iMod > 0, 'modulo non incluso in index.html');
  assert.ok(iMod < iUse, 'il modulo deve precedere vendor-documents-review.js');
});

test('11b. classifyPack: vocabolario diagnostico, coerente col corpus reale', () => {
  assert.strictEqual(classifyPack('1/'),               PACK_NONE);
  assert.strictEqual(classifyPack('3/'),               PACK_NONE);
  assert.strictEqual(classifyPack(null),               PACK_NONE);
  assert.strictEqual(classifyPack('   '),              PACK_NONE);
  assert.strictEqual(classifyPack('1/ 50 LB'),         PACK_WEIGHT);
  assert.strictEqual(classifyPack('9-1/2 GAL'),        PACK_WEIGHT);
  assert.strictEqual(classifyPack('6-4/2 oz'),         PACK_WEIGHT);
  assert.strictEqual(classifyPack('80#   ITA'),        PACK_WEIGHT);
  assert.strictEqual(classifyPack('1.50-4.30lb Tray'), PACK_WEIGHT);
  assert.strictEqual(classifyPack('20 LT'),            PACK_WEIGHT);
  assert.strictEqual(classifyPack('10/ 100 CT'),       PACK_COUNT);
  assert.strictEqual(classifyPack('6/ 40 CT'),         PACK_COUNT);
  assert.strictEqual(classifyPack('Each'),             PACK_COUNT);
  assert.strictEqual(classifyPack('15 DZ'),            PACK_COUNT);
  assert.strictEqual(classifyPack('16-22 CT'),         PACK_COUNT);
  assert.strictEqual(classifyPack('1 CA'),             PACK_COUNT);
  assert.strictEqual(classifyPack('1 gallon Great Value Whole Milk'), PACK_UNKNOWN);
});

console.log('\n' + (failed === 0 ? '✓' : '✗') + ' MT88A: ' + passed + ' passati, ' + failed + ' falliti\n');
process.exit(failed === 0 ? 0 : 1);
