// ─────────────────────────────────────────────────────────────────────
// INV08E — una fattura Hardie's FUTURA con uno SKU mappato deve
// riconoscersi da sola, senza domande di matching manuale.
//
// Il punto che questi test difendono: L'IDENTITA' PRIMARIA E' LO SKU,
// non la stringa del prodotto. Hardie's cambia le descrizioni fra una
// fattura e l'altra (abbreviazioni, sigle, spaziature); se il
// riconoscimento dipendesse dal testo, ogni variazione tornerebbe a
// chiedere conferma a mano.
//
// Il resolver e' quello VERO del worker, estratto da pure_logic.cjs,
// non una copia semplificata.
// ─────────────────────────────────────────────────────────────────────
'use strict';

const assert = require('assert');
const path   = require('path');
const ROOT   = path.join(__dirname, '..');
const { writeInvoiceLines } = require(path.join(ROOT, 'pure_logic.cjs'));

let pass = 0, fail = 0;
const queue = [];
const test = (n, f) => queue.push([n, f]);

const HARDIES = "Hardie's Fresh Foods / Dairyland Produce";
const FIGS    = '65f4cdbb-0000-0000-0000-000000000000';

// identitySkuMap e' la mappa che il worker costruisce da
// ingredient_vendors (piu' gli alias sovrapposti). La riga creata da
// INV08E la popola cosi':
const SKU_MAP = { '70563': { ingredient_id: FIGS, vendor_sku: '70563' } };

function fakeSb(rows) {
  const chain = {
    select: () => chain, eq: () => chain, in: () => chain, not: () => chain, order: () => chain,
    limit: async () => ({ data: [] }),
    insert: async r => { rows.push(...r); return { error: null }; },
    upsert: async () => ({ error: null }), update: () => chain, delete: () => chain,
  };
  return { from: () => chain };
}

async function scrivi(items, skuMap, linkMap) {
  const rows = [];
  await writeInvoiceLines(fakeSb(rows), 'doc-futuro', items, { total: null },
    '2026-10-15', HARDIES, skuMap || SKU_MAP, linkMap || {});
  return rows;
}

const voce = (extra) => Object.assign({
  vendor_sku: '70563', description: 'FIGS BLACK MISSION FRESH',
  pack_description: '12/8 OZ', qty_ordered: 1, qty_received: 1,
  amount: 62.35, unit_price: 62.35,
}, extra || {});

test('1. fattura futura con SKU 70563 -> identita\' risolta, nessuna domanda', async () => {
  const rows = await scrivi([voce()]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].ingredient_id, FIGS, 'deve agganciare Figs');
  assert.strictEqual(rows[0].match_status, 'matched',
    'match_status "unmatched" e\' quello che genera la domanda manuale');
});

test('2. la descrizione cambia ma lo SKU no -> continua a matchare', async () => {
  // Varianti realistiche della stessa voce su fatture diverse.
  for (const d of ['FIG BLACK MISSION', 'FIGS BLK MISSION FRSH',
                   'FIGS, BLACK MISSION  FRESH', 'BLACK MISSION FIGS 12/8OZ']) {
    const rows = await scrivi([voce({ description: d })]);
    assert.strictEqual(rows[0].ingredient_id, FIGS, 'descrizione "' + d + '" non riconosciuta');
    assert.strictEqual(rows[0].match_status, 'matched');
  }
});

test('3. nessun fallback descrittivo: linkMap VUOTA e match lo stesso', async () => {
  const rows = await scrivi([voce({ description: 'STRINGA MAI VISTA PRIMA' })], SKU_MAP, {});
  assert.strictEqual(rows[0].ingredient_id, FIGS,
    'con linkMap vuota, se matcha e\' per forza per SKU');
});

test('4. lo SKU vince su una descrizione che punterebbe altrove', async () => {
  const ALTRO = 'aaaaaaaa-0000-0000-0000-000000000000';
  const rows = await scrivi([voce({ description: 'ESCA' })], SKU_MAP, { 'ESCA': ALTRO });
  assert.strictEqual(rows[0].ingredient_id, FIGS,
    'lo SKU e\' l\'identita\' primaria, la descrizione e\' solo un ripiego');
});

test('5. CONTROLLO: uno SKU non mappato resta unmatched', async () => {
  const rows = await scrivi([voce({ vendor_sku: '99999' })]);
  assert.strictEqual(rows[0].ingredient_id, null);
  assert.strictEqual(rows[0].match_status, 'unmatched',
    'se questo passasse, il test 1 non proverebbe niente');
});

test('6. il pack memorizzato regge la conversione', async () => {
  const rows = await scrivi([voce()]);
  assert.strictEqual(rows[0].pack_description, '12/8 OZ');
  assert.strictEqual(rows[0].estimated_total_g, 2722,
    'vdaiPackToGrams("12/8 OZ") arrotondato: lo stesso valore scritto in ingredient_vendors');
});

test('7. quantita\' consegnata, non ordinata (regola INV08B.1 ancora attiva)', async () => {
  const rows = await scrivi([voce({ qty_ordered: 3, qty_received: 2 })]);
  assert.strictEqual(rows[0].qty, 2);
  const nessuna = await scrivi([voce({ qty_ordered: 1, qty_received: 0, amount: 0 })]);
  assert.strictEqual(nessuna.length, 0, 'merce non consegnata non diventa una riga');
});

test('8. la riga creata NON porta un prezzo inventato', async () => {
  // Il prezzo in ingredient_vendors resta NULL finche' un documento
  // realmente contabilizzato non lo scrive, col chronology guard.
  // Qui si verifica solo che il writer prenda il prezzo dal DOCUMENTO.
  const rows = await scrivi([voce({ unit_price: 58.00, amount: 58.00 })]);
  assert.strictEqual(Number(rows[0].unit_price), 58.00,
    'il prezzo viene dalla fattura, non da ingredient_vendors');
});

// ─────────────────────────────────────────────────────────────────────
// INV08E.1 — gli SKU chiusi con le decisioni Chef
//
// Stessa prova, stesso resolver reale: lo SKU deve vincere sulla
// descrizione, altrimenti ogni variazione di testo sulla prossima
// fattura tornerebbe a chiedere conferma a mano.
// ─────────────────────────────────────────────────────────────────────

const GRAN_GARLIC = '05c6bc66-0000-0000-0000-000000000000';
const PROSCIUTTO  = '1e0489e5-0000-0000-0000-000000000000';
const PUMPKIN     = '22018b88-0000-0000-0000-000000000000';
const MALDON      = 'c95c090c-0000-0000-0000-000000000000';
const SEEDS       = '852d45fe-0000-0000-0000-000000000000';

// La mappa come la costruisce il worker: prima ingredient_vendors,
// poi gli alias SOPRA. E' l'ordine vero, non una semplificazione.
function mappaReale() {
  const diretti = {
    '70563': FIGS, '24060': GRAN_GARLIC, '25271': PROSCIUTTO,
    '04396': MALDON, '03252': PUMPKIN,
  };
  const alias = { '85025': PUMPKIN, '25193': MALDON, '03252': SEEDS };
  const m = {};
  for (const k in diretti) m[k] = { ingredient_id: diretti[k], vendor_sku: k };
  for (const k in alias)   m[k] = { ingredient_id: alias[k],   vendor_sku: k };
  return m;
}
const MAPPA = mappaReale();

const casi = [
  ['24060', GRAN_GARLIC, 'Granulated Garlic',
   ['SPICE GARLIC GRANULATED', 'GARLIC GRANULATED 16OZ', 'SPICE, GARLIC  GRANULATED', 'GRANULATED GARLIC SPICE']],
  ['85025', PUMPKIN, 'Pumpkin Seed',
   ['SEED PUMPKIN RAW', 'PUMPKIN SEED RAW 5#', 'SEED, PUMPKIN RAW', 'RAW PUMPKIN SEEDS']],
  ['25271', PROSCIUTTO, 'Sliced Prosciutto ABF',
   ['PROSCIUTTO SLICED ABF', 'PROSCIUTTO SLICED A.B.F.', 'SLICED PROSCIUTTO ABF 1#', 'PROSCIUTTO, SLICED ABF']],
  ['04396', MALDON, 'Maldon Salt',
   ['SALT SEA MALDON BUCKET', 'MALDON SEA SALT BUCKET 3.1#', 'SALT, SEA MALDON  BUCKET']],
  ['25193', MALDON, 'Maldon Salt',
   ['SALT SEA MALDON FLAKES', 'MALDON FLAKES 8.75OZ', 'SALT SEA MALDON FLAKE']],
];

for (const [sku, ing, nome, descrizioni] of casi) {
  test('E1-' + sku + '. ' + sku + ' -> ' + nome + ', qualunque sia la descrizione', async () => {
    for (const d of descrizioni) {
      const rows = await scrivi([voce({ vendor_sku: sku, description: d,
                                        pack_description: '5#', amount: 20, unit_price: 20 })], MAPPA);
      assert.strictEqual(rows.length, 1, 'descrizione "' + d + '": riga non scritta');
      assert.strictEqual(rows[0].ingredient_id, ing, 'descrizione "' + d + '" non riconosciuta');
      assert.strictEqual(rows[0].match_status, 'matched',
        '"unmatched" e\' cio\' che genera la domanda manuale');
    }
  });
}

test('E1-link. lo SKU vince anche contro una linkMap che punta altrove', async () => {
  const ESCA = 'ffffffff-0000-0000-0000-000000000000';
  for (const [sku, ing] of casi.map(c => [c[0], c[1]])) {
    const rows = await scrivi([voce({ vendor_sku: sku, description: 'ESCA', amount: 10, unit_price: 10 })],
                              MAPPA, { 'ESCA': ESCA });
    assert.strictEqual(rows[0].ingredient_id, ing, sku + ' si e\' fatto sviare dalla descrizione');
  }
});

test('E1-03252. la variante SALTED NON e\' stata toccata: risolve ancora a Seeds', async () => {
  // Non e' un difetto residuo: e' una decisione in sospeso. 03252 e'
  // SEED PUMPKIN ROASTED/SALTED, e il Chef ha autorizzato come stessa
  // identita' solo RAW e ROASTED UNSALTED.
  const rows = await scrivi([voce({ vendor_sku: '03252', description: 'SEED PUMPKIN ROASTED/SALTED',
                                    pack_description: '5#', amount: 39.33, unit_price: 39.33 })], MAPPA);
  assert.strictEqual(rows[0].ingredient_id, SEEDS,
    'l\'alias 03252 -> Seeds deve essere ancora intatto');
  assert.notStrictEqual(rows[0].ingredient_id, PUMPKIN,
    'mapparlo a Pumpkin Seed sarebbe stata una decisione che non mi spetta');
});

test('E1-25271. mappato per il futuro, ma oggi NON produce riga', async () => {
  // Il documento storico ha ricevuto 0 e importo 0: il guard di
  // INV08B.1 lo esclude. Identita' e riga sono due cose diverse.
  const oggi = await scrivi([voce({ vendor_sku: '25271', description: 'PROSCIUTTO SLICED ABF',
                                    pack_description: '1#', qty_ordered: 1, qty_received: 0, amount: 0 })], MAPPA);
  assert.strictEqual(oggi.length, 0, 'merce mai consegnata non diventa una riga d\'acquisto');
  const domani = await scrivi([voce({ vendor_sku: '25271', description: 'PROSCIUTTO SLICED ABF',
                                      pack_description: '1#', qty_ordered: 2, qty_received: 2,
                                      amount: 46.50, unit_price: 23.25 })], MAPPA);
  assert.strictEqual(domani.length, 1, 'quando arrivera\' davvero, la riga nasce');
  assert.strictEqual(domani[0].ingredient_id, PROSCIUTTO, 'e con l\'identita\' gia\' risolta');
  assert.strictEqual(domani[0].qty, 2);
});

(async () => {
  for (const [n, f] of queue) {
    try { await f(); console.log('  ✓ ' + n); pass++; }
    catch (e) { console.log('  ✗ ' + n + '\n      ' + e.message); fail++; }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
