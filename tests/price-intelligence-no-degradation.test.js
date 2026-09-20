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
const { mergePriceIntelligence, classifyPack, normalizePack, samePack,
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
  assert.strictEqual(r.skipped, false);
  assert.strictEqual(r.reason, 'rescue_missing_pack');
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
  assert.strictEqual(r.skipped, false);
  assert.strictEqual(r.reason, 'update');
  assert.deepStrictEqual(r.fields, obs, 'il merge ha alterato un aggiornamento normale');
});

// ── 4 ────────────────────────────────────────────────────────────────
test('4. COUNT pack "10/ 100 CT" → conversion_to_base null resta legittimo, il pack si aggiorna', () => {
  const existing = { pack_description: '10/ 100 CT', conversion_to_base: null, price_per_100g: null, last_invoice_date: '2026-08-18' };
  const r = mergePriceIntelligence(existing, observe({ pack: '10/ 100 CT', unitPrice: 52.92, invoiceDate: '2026-09-17' }));
  assert.strictEqual(r.rescued, false, 'un count pack non e\' un salvataggio');
  assert.strictEqual(r.skipped, false, 'un count pack non va mai saltato');
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
  // MT88A.1: nessun ramo deve piu' spandere direttamente il risultato del
  // merge — il null dello skip va controllato prima di scrivere.
  assert.ok(!/\.\.\.mergeFor\(/.test(body), 'un ramo del worker scrive senza controllare lo skip');
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

test('9b. corpus reale: ogni SKU a rischio cade nel caso giusto, coi pack veri del database', () => {
  // Letti dal database il 2026-09-20. existing.pack e' quello MEMORIZZATO
  // in ingredient_vendors, observed quello che il documento pending
  // dichiara davvero — non sempre sono la stessa stringa.
  const corpus = [
    { nome: 'BEK 688106',    exPack: '1/ 50 LB',  conv: 22680, obsPack: '1/',          prezzo: 21.87, atteso: 'rescue_missing_pack' },
    { nome: 'BEK 688106',    exPack: '1/ 50 LB',  conv: 22680, obsPack: '1/ 50 LB',    prezzo: 21.87, atteso: 'update' },
    { nome: "HAR 03744",     exPack: '9-1/2 GAL', conv: 35961, obsPack: '9-1/2 GAL',   prezzo: 83.00, atteso: 'rescue_same_pack' },
    { nome: "HAR 25618",     exPack: '6-4/2 oz',  conv: 1361,  obsPack: '6-4/2 oz',    prezzo: 24.50, atteso: 'rescue_same_pack' },
    { nome: "HAR 00907",     exPack: '80#',       conv: 36287, obsPack: '80#',         prezzo: 13.50, atteso: 'update' },
    { nome: "HAR 00907",     exPack: '80#',       conv: 36287, obsPack: '80#   ITA',   prezzo: 13.50, atteso: 'unresolved_pack_change' },
    { nome: "HAR 00912",     exPack: '13#',       conv: 5897,  obsPack: '13#',         prezzo: 10.85, atteso: 'update' },
    { nome: "HAR 00912",     exPack: '13#',       conv: 5897,  obsPack: '13#   ITA',   prezzo: 10.85, atteso: 'unresolved_pack_change' },
    { nome: 'BEK 108509',    exPack: null,        conv: null,  obsPack: '3/',          prezzo: 40.00, atteso: 'update' },
    { nome: 'BEK 108509',    exPack: null,        conv: null,  obsPack: '3/ 1 GAL',    prezzo: 40.00, atteso: 'update' },
  ];
  for (const c of corpus) {
    const existing = c.conv === null && c.exPack === null ? null
      : { pack_description: c.exPack, conversion_to_base: c.conv, price_per_100g: 1, last_invoice_date: '2026-01-01' };
    const r = mergePriceIntelligence(existing, observe({ pack: c.obsPack, unitPrice: c.prezzo, invoiceDate: '2026-09-30' }));
    assert.strictEqual(r.reason, c.atteso,
      c.nome + ' observed ' + JSON.stringify(c.obsPack) + ': atteso ' + c.atteso + ', ottenuto ' + r.reason);

    if (c.atteso === 'unresolved_pack_change') {
      // fail-closed: nessun campo scritto, e soprattutto la conversione
      // vecchia non viene MAI associata al prezzo nuovo
      assert.strictEqual(r.skipped, true, c.nome);
      assert.strictEqual(r.fields, null, c.nome);
    } else if (c.atteso === 'update') {
      // il worker sa leggere questo pack da solo
      assert.strictEqual(r.skipped, false, c.nome);
      assert.strictEqual(r.rescued, false, c.nome);
      assert.strictEqual(r.fields.conversion_to_base, observe({ pack: c.obsPack, unitPrice: c.prezzo, invoiceDate: 'x' }).conversion_to_base, c.nome);
    } else {
      // rescue: la conversione memorizzata sopravvive e il prezzo
      // normalizzato viene rifatto sul prezzo nuovo
      assert.strictEqual(r.skipped, false, c.nome);
      assert.strictEqual(r.rescued, true, c.nome);
      assert.strictEqual(r.fields.conversion_to_base, c.conv, c.nome + ': conversione persa');
      assert.strictEqual(r.fields.pack_description, c.exPack, c.nome + ': pack valido perso');
      assert.strictEqual(r.fields.price_per_100g, (c.prezzo / c.conv) * 100, c.nome + ': prezzo normalizzato non ricalcolato');
      assert.strictEqual(r.fields.last_invoice_date, '2026-09-30', c.nome + ': data non avanzata');
    }
  }
});

test('9b2. nessun SKU del corpus finisce con la conversione azzerata', () => {
  const protetti = [
    { exPack: '1/ 50 LB',  conv: 22680, obsPack: '1/' },
    { exPack: '9-1/2 GAL', conv: 35961, obsPack: '9-1/2 GAL' },
    { exPack: '6-4/2 oz',  conv: 1361,  obsPack: '6-4/2 oz' },
    { exPack: '80#',       conv: 36287, obsPack: '80#   ITA' },
    { exPack: '13#',       conv: 5897,  obsPack: '13#   ITA' },
  ];
  for (const c of protetti) {
    const r = mergePriceIntelligence(
      { pack_description: c.exPack, conversion_to_base: c.conv, price_per_100g: 1, last_invoice_date: '2026-01-01' },
      observe({ pack: c.obsPack, unitPrice: 50, invoiceDate: '2026-09-30' }));
    // o si salta del tutto, o si scrive conservando la conversione:
    // in nessun caso la conversione diventa null
    if (r.skipped) { assert.strictEqual(r.fields, null); continue; }
    assert.strictEqual(r.fields.conversion_to_base, c.conv,
      c.exPack + ' -> ' + c.obsPack + ': conversione non conservata');
  }
});

// ── MT88A.1: i tre casi distinti ─────────────────────────────────────
test('9c. CASO 2 — stesso pack che il worker non sa leggere: conversione conservata', () => {
  const existing = { pack_description: '9-1/2 GAL', conversion_to_base: 35961, price_per_100g: 0.23077525218362635, last_invoice_date: '2026-09-14' };
  const r = mergePriceIntelligence(existing, observe({ pack: '9-1/2 GAL', unitPrice: 83.00, invoiceDate: '2026-09-18' }));
  assert.strictEqual(r.skipped, false);
  assert.strictEqual(r.reason, 'rescue_same_pack');
  assert.strictEqual(r.fields.conversion_to_base, 35961);
  assert.strictEqual(r.fields.pack_description, '9-1/2 GAL');
  assert.strictEqual(r.fields.price_per_100g, (83.00 / 35961) * 100);
  assert.strictEqual(r.fields.last_invoice_date, '2026-09-18');
});

test('9d. CASO 2 — differenze di solo whitespace o maiuscole restano "stesso pack"', () => {
  const coppie = [
    ['80#   ITA', '80# ITA'],
    ['80#   ITA', '80#   ita'],
    ['9-1/2 GAL', '  9-1/2 gal  '],
    ['6-4/2 oz',  '6-4/2 OZ'],
    ['1/ 50 LB',  '1/  50  lb'],
  ];
  for (const [memorizzato, osservato] of coppie) {
    assert.ok(samePack(memorizzato, osservato), 'samePack: ' + memorizzato + ' vs ' + osservato);
    const r = mergePriceIntelligence(
      { pack_description: memorizzato, conversion_to_base: 12345, price_per_100g: 1, last_invoice_date: '2026-01-01' },
      { unit_price: 10, pack_description: osservato, price_type: 'per_case',
        conversion_to_base: null, price_per_100g: null, last_invoice_date: '2026-02-01' });
    assert.strictEqual(r.skipped, false, osservato + ': saltato per una differenza innocua');
    assert.strictEqual(r.reason, 'rescue_same_pack');
    assert.strictEqual(r.fields.conversion_to_base, 12345);
    assert.strictEqual(r.fields.pack_description, memorizzato, 'va conservata la forma gia\' memorizzata');
  }
});

test('9e. CASO 3 — pack diverso e non convertibile: FAIL-CLOSED, nessun campo scritto', () => {
  const existing = { pack_description: '1/ 50 LB', conversion_to_base: 22680, price_per_100g: 0.09643027213883844, last_invoice_date: '2026-07-23' };
  const r = mergePriceIntelligence(existing, observe({ pack: '80#   ITA', unitPrice: 40.00, invoiceDate: '2026-08-13' }));
  assert.strictEqual(r.skipped, true, 'doveva essere fail-closed');
  assert.strictEqual(r.reason, 'unresolved_pack_change');
  assert.strictEqual(r.fields, null, 'con skipped non deve esserci nessun campo da scrivere');
  assert.strictEqual(r.rescued, false);
  assert.strictEqual(r.observedPack, '80#   ITA');
  assert.strictEqual(r.storedPack, '1/ 50 LB');
  // e soprattutto: non deve MAI uscire 22680 associato al prezzo nuovo
  const falso = (40.00 / 22680) * 100;
  const vero  = (40.00 / (80 * 453.592)) * 100;
  assert.ok(Math.abs(falso - vero) / vero > 0.5, 'il caso scelto non e\' abbastanza distante da essere probante');
});

test('9f. CASO 3 — altre forme: pack diverso, conteggio diverso, pack sconosciuto', () => {
  const existing = { pack_description: '1/ 50 LB', conversion_to_base: 22680, price_per_100g: 0.0964, last_invoice_date: '2026-07-23' };
  for (const osservato of ['80#   ITA', '4 PKG/12#', '1 gallon Great Value Whole Milk', '12/ 250 CT', '2/ 1000 CT']) {
    const r = mergePriceIntelligence(existing, observe({ pack: osservato, unitPrice: 40, invoiceDate: '2026-08-13' }));
    assert.strictEqual(r.skipped, true, osservato + ': doveva essere saltato');
    assert.strictEqual(r.fields, null, osservato);
  }
});

test('9g. il fail-closed scatta SOLO se c\'e\' davvero qualcosa da proteggere', () => {
  // nessuna conversione memorizzata -> niente da perdere, si scrive normalmente
  const r = mergePriceIntelligence(
    { pack_description: '10/ 100 CT', conversion_to_base: null, price_per_100g: null, last_invoice_date: '2026-08-18' },
    observe({ pack: '3/ 50 CT', unitPrice: 60.19, invoiceDate: '2026-09-17' }));
  assert.strictEqual(r.skipped, false, 'senza conversione memorizzata non si salta mai');
  assert.strictEqual(r.reason, 'update');
  assert.strictEqual(r.fields.pack_description, '3/ 50 CT');
  // conversione memorizzata a 0 o negativa: non e' una conversione valida
  for (const conv of [0, -1]) {
    const r2 = mergePriceIntelligence(
      { pack_description: '1/ 50 LB', conversion_to_base: conv, price_per_100g: null, last_invoice_date: '2026-07-23' },
      observe({ pack: '80#   ITA', unitPrice: 40, invoiceDate: '2026-08-13' }));
    assert.strictEqual(r2.skipped, false, 'conversione ' + conv + ' non e\' un dato da proteggere');
  }
});

test('9h. per_lb non viene mai saltato, nemmeno con un pack diverso', () => {
  const existing = { pack_description: '8 LB', conversion_to_base: 3629, price_per_100g: 8.5, last_invoice_date: '2026-09-01' };
  const r = mergePriceIntelligence(existing, observe({ pack: '25 LB', unitPrice: 90, invoiceDate: '2026-09-19', priceType: 'per_lb' }));
  assert.strictEqual(r.skipped, false, 'per_lb non passa dal fail-closed');
  assert.strictEqual(r.reason, 'update');
  assert.strictEqual(r.fields.conversion_to_base, null);
});


test('9i. parita\' di decisione: modulo embeddato nel worker == file usato dal browser', () => {
  const worker = fs.readFileSync(path.join(ROOT, 'edge-functions/vendor-doc-auto-import/index.ts'), 'utf8');
  const m = worker.match(/^  "price-intelligence-merge": (".*?"),$/m);
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', JSON.parse(m[1]))(null, mod, mod.exports);
  const embedded = mod.exports.mergePriceIntelligence;

  const scenari = [];
  const packs = [null, '', '1/', '3/', '1/ 50 LB', '1/ 55 LB', '9-1/2 GAL', '  9-1/2 gal ',
                 '80#   ITA', '80# ita', '10/ 100 CT', '6/ 40 CT', 'Each', '1 gallon Great Value Whole Milk'];
  const existings = [null,
    { pack_description: '1/ 50 LB',  conversion_to_base: 22680, price_per_100g: 0.0964, last_invoice_date: '2026-07-23' },
    { pack_description: '9-1/2 GAL', conversion_to_base: 35961, price_per_100g: 0.2308, last_invoice_date: '2026-09-14' },
    { pack_description: '10/ 100 CT', conversion_to_base: null, price_per_100g: null,   last_invoice_date: '2026-08-18' }];
  for (const ex of existings) for (const p of packs) for (const pt of ['per_case', 'per_lb']) {
    scenari.push([ex, observe({ pack: p, unitPrice: 42.5, invoiceDate: '2026-09-30', priceType: pt })]);
  }
  let n = 0;
  for (const [ex, obs] of scenari) {
    const a = mergePriceIntelligence(ex, obs);
    const b = embedded(ex, obs);
    assert.deepStrictEqual(b, a, 'decisione divergente su ' + JSON.stringify(obs.pack_description) + ' / ' + JSON.stringify(ex && ex.pack_description));
    n++;
  }
  assert.strictEqual(n, 112, 'attesi 112 scenari, eseguiti ' + n);
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
  assert.ok(!/\.\.\.mergeFor\(/.test(body), 'il worker spande mergeFor senza controllare lo skip');
  assert.ok(!/\.\.\.mergeFor\(/.test(ui),   'la UI spande mergeFor senza controllare lo skip');
  // entrambi devono gestire esplicitamente il ritorno null
  assert.ok(/if \(m\.skipped\)/.test(body), 'il worker non gestisce skipped');
  assert.ok(/if \(m\.skipped\)/.test(ui),   'la UI non gestisce skipped');

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

test('11c. normalizePack: normalizzazione minima, niente di piu\'', () => {
  assert.strictEqual(normalizePack('  80#   ITA  '), '80# ita');
  assert.strictEqual(normalizePack('9-1/2 GAL'),     '9-1/2 gal');
  assert.strictEqual(normalizePack(''),              null);
  assert.strictEqual(normalizePack('   '),           null);
  assert.strictEqual(normalizePack(null),            null);
  // NON deve normalizzare via la sostanza
  assert.ok(!samePack('1/ 50 LB', '1/ 55 LB'), 'due casse diverse non sono lo stesso pack');
  assert.ok(!samePack('80# ITA',  '80 LB'),    'non si espandono le unita\'');
  assert.ok(!samePack('10/ 100 CT', '100/ 10 CT'), 'non si riordina');
  assert.ok(!samePack(null, null), 'due assenze non sono un\'uguaglianza');
  assert.ok(!samePack('1/ 50 LB', null));
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
