// ─────────────────────────────────────────────────────────────────────
// INV08FINAL.1 — la price intelligence non riscrive l'identita' SKU
//
// Il 21/09 alle 23:30:09, importando la fattura 07133808, la riga
// canonica di ingredient_vendors e' stata RIPUNTATA:
//
//   Cherry Tomatoes  vendor_sku 07673 -> 71908
//   Zucchini         vendor_sku 03493 -> 71814
//
// 07673 (TOMATO CHERRY ON THE VINE) e 71908 (TOMATO CHERRY RED) sono due
// prodotti a catalogo nello stesso momento, mappati allo stesso
// ingrediente per decisione dello Chef in INV08E. Dopo il ripuntamento
// 07673 risolveva solo per descrizione e 03493 non risolveva affatto.
//
// L'invariante: ingredient_vendors.vendor_sku E' IDENTITA'. Un'osservazione
// di prezzo che arriva da un alias aggiorna i campi ECONOMICI e non
// sostituisce l'identita'.
//
// Questi test NON simulano il percorso: eseguono vdaiApprove VERA contro
// un Supabase finto, quindi misurano la funzione che gira in produzione.
// ─────────────────────────────────────────────────────────────────────
'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const ROOT = path.join(__dirname, '..');
const { makeSb } = require(path.join(ROOT, 'tests/helpers-fake-supabase.js'));
const W    = require(path.join(ROOT, 'pure_logic.cjs'));
const WSRC = fs.readFileSync(path.join(ROOT, 'edge-functions/vendor-doc-auto-import/index.ts'), 'utf8');
const UI   = fs.readFileSync(path.join(ROOT, 'js/vendor-documents-review.js'), 'utf8');
const INGR = fs.readFileSync(path.join(ROOT, 'js/ingredients.js'), 'utf8');

const V = "Hardie's Fresh Foods / Dairyland Produce";

let pass = 0, fail = 0;
const queue = [];
function test(n, f) { queue.push([n, f]); }

// ── il mondo: una riga canonica, i suoi alias, una fattura ───────────
function mondo(canonica, alias, righe) {
  return {
    vendor_documents: [],
    ingredient_vendors: [Object.assign({
      id: 'IV1', vendor: V, ingredient_id: 'ING1', active: true,
      unit_price: null, price_per_100g: null, price_type: null,
      pack_description: null, conversion_to_base: null, last_invoice_date: null,
    }, canonica)],
    vendor_item_aliases: alias.map((a, i) => Object.assign(
      { id: 'AL' + i, vendor: V, ingredient_id: 'ING1', active: true }, a)),
    ingredient_links: [],
    invoice_lines: righe || [],
  };
}

// Importa una fattura di una riga sola, con lo SKU e la data dati.
async function importa(db, { sku, descr, prezzo, pack, data, num }) {
  const docId = 'DOC-' + (num || sku + '-' + data);
  db.vendor_documents.push({
    id: docId, vendor: V, status: 'pending',
    document_number: num || ('99' + sku), document_date: data, warnings: [],
    parsed_json: {
      vendor: V, document_type: 'invoice', total: prezzo, subtotal: prezzo,
      invoice_date: data,
      items: [{ vendor_sku: sku, description: descr, qty: 1, qty_ordered: 1,
                qty_received: 1, unit_price: prezzo, amount: prezzo,
                pack_description: pack }],
    },
  });
  const sb = makeSb(db);
  const res = await W.vdaiApprove(sb, docId);
  return { res, sb, riga: db.ingredient_vendors[0] };
}

const patchIv = (sb) => sb._log.updates.filter(u => u.table === 'ingredient_vendors').map(u => u.patch);

// ═════════════════════════════════════════════════════════════════════
// A. ZUCCHINI — il caso reale
// ═════════════════════════════════════════════════════════════════════

test('A1. direct 03493, osservazione da alias 71814: vendor_sku resta 03493', async () => {
  const db = mondo(
    { vendor_sku: '03493', unit_price: 31.10, pack_description: '5#', last_invoice_date: '2026-09-01' },
    [{ vendor_sku: '71814' }]);
  const { res, sb, riga } = await importa(db,
    { sku: '71814', descr: 'SQUASH ZUCCHINI FANCY', prezzo: 26.77, pack: '18-22#', data: '2026-09-21' });
  assert.strictEqual(res.ok, true, 'l import deve riuscire: ' + JSON.stringify(res));
  assert.strictEqual(riga.vendor_sku, '03493', 'IDENTITA VIOLATA');
  for (const p of patchIv(sb)) assert.ok(!('vendor_sku' in p), 'nessuna patch deve contenere vendor_sku');
});

test('A2. i campi economici SI aggiornano dall osservazione dell alias', async () => {
  const db = mondo(
    { vendor_sku: '03493', unit_price: 31.10, pack_description: '5#', last_invoice_date: '2026-09-01' },
    [{ vendor_sku: '71814' }]);
  const { riga } = await importa(db,
    { sku: '71814', descr: 'SQUASH ZUCCHINI FANCY', prezzo: 26.77, pack: '18-22#', data: '2026-09-21' });
  assert.strictEqual(Number(riga.unit_price), 26.77, 'il prezzo deve venire dall osservazione');
  assert.strictEqual(riga.last_invoice_date, '2026-09-21', 'la data deve avanzare');
});

test('A3. entrambi gli SKU restano risolvibili', async () => {
  const db = mondo(
    { vendor_sku: '03493', unit_price: 31.10, pack_description: '5#', last_invoice_date: '2026-09-01' },
    [{ vendor_sku: '71814' }]);
  await importa(db, { sku: '71814', descr: 'SQUASH ZUCCHINI FANCY', prezzo: 26.77, pack: '18-22#', data: '2026-09-21' });
  const direct = new Set(db.ingredient_vendors.map(r => r.vendor_sku));
  const alias  = new Set(db.vendor_item_aliases.filter(a => a.active).map(a => a.vendor_sku));
  assert.ok(direct.has('03493') || alias.has('03493'), '03493 deve risolvere');
  assert.ok(direct.has('71814') || alias.has('71814'), '71814 deve risolvere');
});

// ═════════════════════════════════════════════════════════════════════
// B. CHERRY TOMATOES — il caso reale, con quattro alias
// ═════════════════════════════════════════════════════════════════════

test('B1. direct 07673, osservazione da alias 71908: vendor_sku resta 07673', async () => {
  const db = mondo(
    { vendor_sku: '07673', unit_price: 27.00, pack_description: '11#',
      conversion_to_base: 4989, price_per_100g: 0.54, last_invoice_date: '2026-09-19' },
    [{ vendor_sku: '71908' }, { vendor_sku: '22517' }, { vendor_sku: '22520' }, { vendor_sku: '33536' }]);
  const { res, sb, riga } = await importa(db,
    { sku: '71908', descr: 'TOMATO CHERRY RED', prezzo: 36.81, pack: '12/1 PT', data: '2026-09-21' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(riga.vendor_sku, '07673', 'IDENTITA VIOLATA');
  for (const p of patchIv(sb)) assert.ok(!('vendor_sku' in p));
});

test('B2. tutti e cinque gli SKU della famiglia continuano a risolvere', async () => {
  const db = mondo(
    { vendor_sku: '07673', unit_price: 27.00, pack_description: '11#', last_invoice_date: '2026-09-19' },
    [{ vendor_sku: '71908' }, { vendor_sku: '22517' }, { vendor_sku: '22520' }, { vendor_sku: '33536' }]);
  await importa(db, { sku: '71908', descr: 'TOMATO CHERRY RED', prezzo: 36.81, pack: '12/1 PT', data: '2026-09-21' });
  const risolvono = new Set([
    ...db.ingredient_vendors.map(r => r.vendor_sku),
    ...db.vendor_item_aliases.filter(a => a.active).map(a => a.vendor_sku),
  ]);
  for (const s of ['07673', '71908', '22517', '22520', '33536'])
    assert.ok(risolvono.has(s), s + ' non risolve piu');
});

test('B3. una sola riga canonica: nessun duplicato per (vendor, ingrediente)', async () => {
  const db = mondo(
    { vendor_sku: '07673', unit_price: 27.00, pack_description: '11#', last_invoice_date: '2026-09-19' },
    [{ vendor_sku: '71908' }]);
  await importa(db, { sku: '71908', descr: 'TOMATO CHERRY RED', prezzo: 36.81, pack: '12/1 PT', data: '2026-09-21' });
  assert.strictEqual(db.ingredient_vendors.length, 1, 'niente seconda riga: UNIQUE(ingredient_id, vendor)');
});

// ═════════════════════════════════════════════════════════════════════
// C. IL PRIMARIO NON OSCILLA
// ═════════════════════════════════════════════════════════════════════

test('C1. direct -> alias -> alias -> direct: vendor_sku non si muove mai', async () => {
  const db = mondo(
    { vendor_sku: '07673', unit_price: 20.00, pack_description: '11#', last_invoice_date: '2026-09-01' },
    [{ vendor_sku: '71908' }, { vendor_sku: '22517' }]);
  const sequenza = [
    { sku: '07673', descr: 'TOMATO CHERRY ON THE VINE', prezzo: 27.00, pack: '11#',     data: '2026-09-05', num: 'S1' },
    { sku: '71908', descr: 'TOMATO CHERRY RED',         prezzo: 36.81, pack: '12/1 PT', data: '2026-09-10', num: 'S2' },
    { sku: '22517', descr: 'TOMATO CHERRY MIX',         prezzo: 30.00, pack: '10#',     data: '2026-09-15', num: 'S3' },
    { sku: '07673', descr: 'TOMATO CHERRY ON THE VINE', prezzo: 28.50, pack: '11#',     data: '2026-09-20', num: 'S4' },
  ];
  const visti = [];
  for (const passo of sequenza) {
    await importa(db, passo);
    visti.push(db.ingredient_vendors[0].vendor_sku);
  }
  assert.deepStrictEqual(visti, ['07673', '07673', '07673', '07673'],
    'il primario ha oscillato: ' + visti.join(' -> '));
  assert.strictEqual(Number(db.ingredient_vendors[0].unit_price), 28.50, 'l ultimo prezzo deve restare');
  assert.strictEqual(db.ingredient_vendors[0].last_invoice_date, '2026-09-20');
});

test('C2. anche partendo da un primario che NON e mai stato fatturato', async () => {
  const db = mondo(
    { vendor_sku: '03493', unit_price: null, pack_description: null, last_invoice_date: null },
    [{ vendor_sku: '71814' }]);
  for (const d of ['2026-09-05', '2026-09-12', '2026-09-21']) {
    await importa(db, { sku: '71814', descr: 'SQUASH ZUCCHINI FANCY', prezzo: 26.77, pack: '18-22#', data: d, num: 'Z' + d });
    assert.strictEqual(db.ingredient_vendors[0].vendor_sku, '03493', 'oscillato su ' + d);
  }
});

// ═════════════════════════════════════════════════════════════════════
// D. LA GUARDIA CRONOLOGICA NON CAMBIA
// ═════════════════════════════════════════════════════════════════════

test('D1. una fattura piu VECCHIA non aggiorna prezzo, data ne identita', async () => {
  const db = mondo(
    { vendor_sku: '07673', unit_price: 36.81, pack_description: '12/1 PT', last_invoice_date: '2026-09-21' },
    [{ vendor_sku: '71908' }]);
  const prima = { ...db.ingredient_vendors[0] };
  const { sb } = await importa(db,
    { sku: '71908', descr: 'TOMATO CHERRY RED', prezzo: 10.00, pack: '12/1 PT', data: '2026-08-01' });
  const dopo = db.ingredient_vendors[0];
  assert.strictEqual(dopo.vendor_sku, '07673');
  assert.strictEqual(Number(dopo.unit_price), Number(prima.unit_price), 'il prezzo non deve arretrare');
  assert.strictEqual(dopo.last_invoice_date, '2026-09-21', 'la data non deve arretrare');
  assert.strictEqual(patchIv(sb).length, 0, 'nessuna patch: la guardia ha fermato tutto');
});

test('D2. stessa data: la guardia ammette (incoming >= stored)', async () => {
  const db = mondo(
    { vendor_sku: '07673', unit_price: 20.00, pack_description: '11#', last_invoice_date: '2026-09-21' },
    [{ vendor_sku: '71908' }]);
  await importa(db, { sku: '71908', descr: 'TOMATO CHERRY RED', prezzo: 36.81, pack: '12/1 PT', data: '2026-09-21' });
  assert.strictEqual(Number(db.ingredient_vendors[0].unit_price), 36.81);
  assert.strictEqual(db.ingredient_vendors[0].vendor_sku, '07673');
});

// ═════════════════════════════════════════════════════════════════════
// E. IL PERCORSO ESPLICITO DI MAPPING PUO' ANCORA CAMBIARE LO SKU
// ═════════════════════════════════════════════════════════════════════

test('E1. la scheda ingrediente scrive ancora vendor_sku, ed e un atto umano', () => {
  // Attenzione: `const updates = {` compare due volte in ingredients.js —
  // la prima e' l'editor dell'ingrediente. Serve quella della riga vendor.
  const i = INGR.indexOf("const updates = {\n    vendor:");
  assert.ok(i > 0, 'il salvataggio della riga vendor deve esistere');
  const blocco = INGR.slice(i, INGR.indexOf('.eq(\'id\',vendorId)', i));
  assert.ok(/vendor_sku:\s*document\.getElementById\('evSku'\)/.test(blocco),
    'lo SKU deve venire da un campo del form, non da un documento');
  assert.ok(/from\('ingredient_vendors'\)\.update\(updates\)/.test(INGR));
});

test('E2. il ramo populate_sku riempie un vuoto, non sostituisce un identita', () => {
  assert.strictEqual(W.vdrDecideCanonicalUpdateLite(null,     'X'), 'populate_sku');
  assert.strictEqual(W.vdrDecideCanonicalUpdateLite('',       'X'), 'populate_sku');
  assert.strictEqual(W.vdrDecideCanonicalUpdateLite('A',      'A'), 'update');
  assert.strictEqual(W.vdrDecideCanonicalUpdateLite('A',      'B'), 'skip',
    'due SKU diversi: la riga canonica si lascia stare');
});

// ═════════════════════════════════════════════════════════════════════
// F. IL SORGENTE — e la parita' fra le due copie
// ═════════════════════════════════════════════════════════════════════

function caseB(src) {
  const i = src.indexOf("if (resolution.case === 'B')");
  assert.ok(i > 0);
  return src.slice(i, src.indexOf("resolution.case === 'none'", i));
}

test('F1. case B non scrive piu vendor_sku, ne nel worker ne nella UI', () => {
  for (const [nome, src] of [['worker', WSRC], ['UI', UI]]) {
    const b = caseB(src);
    assert.ok(!/toUpdate\.push\(\{\s*id:\s*canonical\.id,\s*vendor_sku:/.test(b),
      nome + ': case B riscrive ancora l identita');
    assert.ok(/toUpdate\.push\(\{ id: canonical\.id, \.\.\.fBm \}\)/.test(b),
      nome + ': manca l update economico senza identita');
  }
});

test('F2. il backfill delle invoice_lines resta, alla stessa condizione', () => {
  for (const [nome, src] of [['worker', WSRC], ['UI', UI]]) {
    const b = caseB(src);
    assert.ok(/backfillTargets\.push\(\{ vendor, vendor_sku: sku, ingredient_id: ingrId \}\)/.test(b),
      nome + ': il backfill e sparito');
  }
  // e il backfill tocca SOLO invoice_lines
  const f = WSRC.slice(WSRC.indexOf('async function vdaiBackfillInvoiceLines'),
                       WSRC.indexOf('async function vdaiBackfillInvoiceLines') + 400);
  assert.ok(/from\('invoice_lines'\)\.update/.test(f));
  assert.ok(!/ingredient_vendors/.test(f), 'il backfill non deve toccare l identita');
});

test('F3. nessun altro UPDATE di ingredient_vendors porta vendor_sku', () => {
  // l unico rimasto e populate_sku, che per costruzione riempie un vuoto
  for (const [nome, src] of [['worker', WSRC], ['UI', UI]]) {
    const hits = [...src.matchAll(/toUpdate\.push\(\{[^}]*vendor_sku:/g)];
    assert.strictEqual(hits.length, 1, nome + ': attesa una sola push con vendor_sku, trovate ' + hits.length);
    // L'unica rimasta sta nel ramo `else` di `decision === 'update'`, che
    // per costruzione di vdrDecideCanonicalUpdateLite puo' essere solo
    // 'populate_sku' — cioe' la riga canonica non ha ancora uno SKU.
    const intorno = src.slice(Math.max(0, hits[0].index - 900), hits[0].index);
    assert.ok(/decision === 'update' \|\| decision === 'populate_sku'/.test(intorno),
      nome + ': la push deve stare sotto il gate update|populate_sku');
    assert.ok(/if \(decision === 'update'\) \{[\s\S]*\} else \{/.test(intorno),
      nome + ": l'unica push con vendor_sku deve essere il ramo populate_sku");
  }
});

// ═════════════════════════════════════════════════════════════════════
// G. MUTAZIONE
// ═════════════════════════════════════════════════════════════════════

test('G1. reintrodurre vendor_sku nell update romperebbe A, B e C', async () => {
  // Si esegue la regola vecchia sugli stessi dati e si verifica che
  // l esito DIVERGA: se un giorno tornasse, questi tre casi cadono.
  const casi = [
    { direct: '03493', alias: '71814' },
    { direct: '07673', alias: '71908' },
    { direct: '07673', alias: '22517' },
  ];
  let divergenze = 0;
  for (const c of casi) {
    const db = mondo({ vendor_sku: c.direct, unit_price: 10, pack_description: '5#', last_invoice_date: '2026-09-01' },
                     [{ vendor_sku: c.alias }]);
    await importa(db, { sku: c.alias, descr: 'X', prezzo: 20, pack: '10#', data: '2026-09-21' });
    const vero  = db.ingredient_vendors[0].vendor_sku;   // regola nuova
    const finto = c.alias;                               // regola vecchia
    assert.strictEqual(vero, c.direct);
    if (vero !== finto) divergenze++;
  }
  assert.strictEqual(divergenze, 3, 'la regola vecchia e quella nuova devono divergere su tutti e tre');
});

// ── run ──────────────────────────────────────────────────────────────
(async () => {
  for (const [n, f] of queue) {
    try { await f(); console.log('  ✓ ' + n); pass++; }
    catch (e) { console.log('  ✗ ' + n + '\n      ' + e.message); fail++; }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
