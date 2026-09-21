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

const MILK_CHOC = 'aaaa1111-0000-0000-0000-000000000000';
const DRY_OREG  = '2eaf047f-0000-0000-0000-000000000000';
const EDIBLE_FL = 'f3d353e4-0000-0000-0000-000000000000';
const CHERRY    = 'c77db80e-0000-0000-0000-000000000000';
const SUNFLOWER = 'aa38168c-0000-0000-0000-000000000000';
const RED_BELL  = '6589fc51-0000-0000-0000-000000000000';
const BABY_CARR = 'bbbb2222-0000-0000-0000-000000000000';
const ZUCCHINI  = '277a435c-0000-0000-0000-000000000000';
const TENDERLOIN= 'cccc3333-0000-0000-0000-000000000000';
const STEW_MEAT = '28bd0f90-0000-0000-0000-000000000000';

// La mappa come la costruisce il worker: prima ingredient_vendors, poi
// gli alias SOPRA — ma SOLO quelli con active = true, perche' sia il
// worker sia il browser filtrano .eq('active', true).
//
// INV08E.2 — questa clausola e' il motivo per cui in INV08E.1 avevo
// riportato che 03252 risolveva a Seeds: la mia verifica SQL leggeva
// gli alias senza filtrare su `active`, mentre le due righe verso Seeds
// erano gia' inattive. Il resolver dava gia' Pumpkin Seed.
function mappaReale() {
  const diretti = {
    '70563': FIGS, '24060': GRAN_GARLIC, '25271': PROSCIUTTO,
    '04396': MALDON, '03252': PUMPKIN, '23566': MILK_CHOC,
    '24303': DRY_OREG, '05840': EDIBLE_FL, '07673': CHERRY,
    '03257': SUNFLOWER, '02656': RED_BELL, '00428': BABY_CARR,
    '03493': ZUCCHINI, '23278': TENDERLOIN, '24171': STEW_MEAT,
  };
  const aliasAttivi   = { '85025': PUMPKIN, '25193': MALDON,
                          '07140': EDIBLE_FL, '22517': CHERRY,
                          '71814': ZUCCHINI };
  const aliasInattivi = { '03252': SEEDS, '03257': SEEDS };   // non applicati
  const m = {};
  for (const k in diretti)     m[k] = { ingredient_id: diretti[k], vendor_sku: k };
  for (const k in aliasAttivi) m[k] = { ingredient_id: aliasAttivi[k], vendor_sku: k };
  void aliasInattivi;
  return m;
}
const MAPPA = mappaReale();

const casi = [
  ['02656', RED_BELL, 'Red Bell Pepper',
   ['PEPPER RED BELL CHOPPER', 'RED BELL PEPPER CHOPPER 5#', 'PEPPER, RED BELL  CHOPPER']],
  ['00428', BABY_CARR, 'Baby Carrots',
   ['CARROT BABY PEELED W/TOPS MEX', 'BABY CARROT PEELED 5#', 'CARROT, BABY PEELED W/TOPS']],
  ['03493', ZUCCHINI, 'Zucchini',
   ['SQUASH BABY ZUCCHINI', 'BABY ZUCCHINI SQUASH 5#', 'SQUASH, BABY  ZUCCHINI']],
  ['71814', ZUCCHINI, 'Zucchini',
   ['SQUASH ZUCCHINI FANCY', 'ZUCCHINI FANCY 18-22#', 'SQUASH, ZUCCHINI  FANCY']],
  ['23278', TENDERLOIN, 'Beef Tenderloin Tips',
   ['ABR BC TNDRLN TIPS REF', 'BEEF TENDERLOIN TIPS REFRIGERATED', 'ABR BC TNDRLN  TIPS  REF']],
  ['03252', PUMPKIN, 'Pumpkin Seed',
   ['SEED PUMPKIN ROASTED/SALTED', 'PUMPKIN SEED ROASTED SALTED 5#', 'SEED, PUMPKIN  ROASTED/SALTED']],
  ['23566', MILK_CHOC, 'Milk Chocolate',
   ['33.6% MILK CALLETS 823 BARRY', 'MILK CALLETS 823', 'BARRY 823 MILK CHOC CALLETS 33.6%']],
  ['24303', DRY_OREG, 'Dry Oregano',
   ['SPICE OREGANO LEAVES', 'OREGANO LEAVES 8OZ', 'SPICE, OREGANO  LEAVES']],
  ['07140', EDIBLE_FL, 'Edible Flower',
   ['FLOWER FIRESTIX MIX', 'FIRESTIX MIX FLOWER 50CT', 'FLOWER, FIRESTIX  MIX']],
  ['22517', CHERRY, 'Cherry Tomatoes',
   ['TOMATO CHERRY OMBRE TOV', 'CHERRY TOMATO OMBRE ON VINE', 'TOMATO, CHERRY OMBRE  TOV']],
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

test('E2-03252. la variante SALTED risolve a Pumpkin Seed, non a Seeds', async () => {
  // Decisione Chef INV08E.2: anche ROASTED/SALTED e' Pumpkin Seed.
  // Nota: era GIA' cosi', perche' l'alias verso Seeds e' inattivo.
  const rows = await scrivi([voce({ vendor_sku: '03252', description: 'SEED PUMPKIN ROASTED/SALTED',
                                    pack_description: '5#', amount: 39.33, unit_price: 39.33 })], MAPPA);
  assert.strictEqual(rows[0].ingredient_id, PUMPKIN);
  assert.notStrictEqual(rows[0].ingredient_id, SEEDS,
    'nessun alias deve poter riportare 03252 su Seeds');
});

test('E2-03257. il girasole NON e\' stato rotto dalla pulizia di 03252', async () => {
  // La condizione che il task chiama "importante": 03257 e' un altro
  // prodotto e non fa parte della decisione su 03252.
  const rows = await scrivi([voce({ vendor_sku: '03257', description: 'SEED SUNFLOWER',
                                    pack_description: '5#', amount: 30, unit_price: 30 })], MAPPA);
  assert.strictEqual(rows[0].ingredient_id, SUNFLOWER,
    '03257 deve restare SUNFLOWER Seed');
  assert.notStrictEqual(rows[0].ingredient_id, PUMPKIN, 'non deve finire su Pumpkin Seed');
});

test('E2-slot. gli SKU principali non sono stati migrati', async () => {
  // 05840 e 07673 tenevano gli slot diretti: dovevano restare dov'erano.
  const fiore = await scrivi([voce({ vendor_sku: '05840', description: 'FLOWER MARIGOLD',
                                     pack_description: '50 CT', amount: 18.29, unit_price: 18.29 })], MAPPA);
  assert.strictEqual(fiore[0].ingredient_id, EDIBLE_FL);
  const pomo = await scrivi([voce({ vendor_sku: '07673', description: 'TOMATO CHERRY ON THE VINE',
                                    pack_description: '11#', amount: 24.5, unit_price: 24.5 })], MAPPA);
  assert.strictEqual(pomo[0].ingredient_id, CHERRY);
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

test('E3-zucchini. 03493 e 71814 risolvono allo STESSO ingredient_id', async () => {
  const a = await scrivi([voce({ vendor_sku: '03493', description: 'SQUASH BABY ZUCCHINI',
                                 pack_description: '5#', amount: 20, unit_price: 20 })], MAPPA);
  const b = await scrivi([voce({ vendor_sku: '71814', description: 'SQUASH ZUCCHINI FANCY',
                                 pack_description: '18-22#', amount: 30, unit_price: 30 })], MAPPA);
  assert.strictEqual(a[0].ingredient_id, ZUCCHINI);
  assert.strictEqual(b[0].ingredient_id, ZUCCHINI);
  assert.strictEqual(a[0].ingredient_id, b[0].ingredient_id,
    'baby e fancy devono finire nello stesso ingrediente canonico');
});

test('E3-tenderloin. 23278 NON risolve piu\' a Stew Meat, nemmeno se la descrizione lo suggerisce', async () => {
  // Il caso che ha creato il problema: la riga storica era stata
  // agganciata a Stew Meat PER DESCRIZIONE. Adesso c'e' lo SKU, e lo
  // SKU deve vincere anche contro una linkMap che punta a Stew Meat.
  const rows = await scrivi([voce({ vendor_sku: '23278', description: 'ABR BC TNDRLN TIPS REF',
                                    pack_description: '4 PKG/12#', amount: 88.04, unit_price: 6.83 })],
                            MAPPA, { 'ABR BC TNDRLN TIPS REF': STEW_MEAT });
  assert.strictEqual(rows[0].ingredient_id, TENDERLOIN);
  assert.notStrictEqual(rows[0].ingredient_id, STEW_MEAT,
    'la descrizione non deve piu\' poter riportare 23278 su Stew Meat');
});

test('E3-stew. Stew Meat resta intatto per gli altri suoi SKU', async () => {
  const rows = await scrivi([voce({ vendor_sku: '24171', description: 'ABR BROCHETTE MEAT 1" REF',
                                    pack_description: '4 PC/12#', amount: 40, unit_price: 20 })], MAPPA);
  assert.strictEqual(rows[0].ingredient_id, STEW_MEAT,
    'la correzione di 23278 non doveva toccare 24171');
});

test('E3-pack. nessuna conversione inventata dove il pack non e\' deducibile', () => {
  const f = require(path.join(ROOT, 'pure_logic.cjs')).vdaiPackToGrams;
  assert.strictEqual(f('18-22#'), null, 'pack a intervallo: non deducibile');
  assert.strictEqual(f('4 PKG/12#'), null, 'pack composito non coperto dalla grammatica');
  assert.strictEqual(Math.round(f('5#')), 2268, 'questo invece e\' esatto');
});

// ─────────────────────────────────────────────────────────────────────
// INV08E.4 — gli SKU promossi da link-only a identita' stabile
//
// Il criterio di successo dichiarato dal task: dopo la promozione, il
// resolver deve trovare l'ingrediente PER SKU anche con la linkMap
// COMPLETAMENTE VUOTA. Lo SKU deve bastare da solo.
// ─────────────────────────────────────────────────────────────────────

const PROMOSSI = {
  '06078': ['500224c1', 'Shitake Mushrooms',       ['MUSHROOM SHIITAKE SLICED', 'SHIITAKE SLICED 5#', 'MUSHROOM, SHIITAKE  SLICED']],
  '01177': ['f3d353e4', 'Edible Flower',           ['FLOWER EDIBLE ASSORTED', 'EDIBLE FLOWERS ASSORTED 50CT']],
  '01180': ['f3d353e4', 'Edible Flower',           ['FLOWER ORCHID', 'ORCHID FLOWER 100 CT']],
  '01314': ['dc803585', 'Basil',                   ['HERB BASIL', 'BASIL HERB 5#']],
  '01734': ['ROMAINE0', 'Romaine',                 ['LETTUCE ROMAINE HEARTS', 'ROMAINE HEARTS 40-48ct']],
  '01880': ['SPRINGMX', 'Spring Mix',              ['MESCLUN MIX', 'MESCLUN SALAD MIX 3#']],
  '10068': ['HEAVYCRM', 'Heavy Cream',             ['WHIPPING CREAM 36% FRESH UHT', 'HEAVY WHIPPING CREAM 36%']],
  '13405': ['HEAVYCRM', 'Heavy Cream',             ['WHIPPING CREAM 36% FRESH UHT', 'WHIPPING CREAM 36% 1QT']],
  '25057': ['CALABRIA', 'Calabrian Chili crushed', ['CALABRIAN PEPPER PUREE CRUSHD', 'CRUSHED CALABRIAN CHILI 950GR']],
  '29810': ['LIQUIDEG', 'Liquid Egg',              ['PASTURE RAISED LIQUID WHL EGGS', 'LIQUID WHOLE EGGS 20#']],
  '33536': ['c77db80e', 'Cherry Tomatoes',         ['TOMATO DRAMA CHERRY ON VINE', 'DRAMA CHERRY TOMATO ON THE VINE']],
  '71908': ['c77db80e', 'Cherry Tomatoes',         ['TOMATO CHERRY RED', 'RED CHERRY TOMATO 12/1PT']],
  '29554': ['28bd0f90', 'Stew Meat',               ['ABR BROCHETTE MEAT 1" REF', 'BROCHETTE MEAT 1 INCH REFRIGERATED']],
  '70002': ['FENNEL00', 'Fennel',                  ['FENNEL/ANISE', 'FENNEL ANISE 12 CT']],
};

// La mappa che il worker costruisce dagli alias attivi appena creati.
const MAPPA_E4 = {};
for (const sku in PROMOSSI) {
  MAPPA_E4[sku] = { ingredient_id: PROMOSSI[sku][0], vendor_sku: sku };
}

for (const sku in PROMOSSI) {
  const [ing, nome, descrizioni] = PROMOSSI[sku];
  test('E4-' + sku + '. ' + sku + ' -> ' + nome + ' con linkMap VUOTA', async () => {
    for (const d of descrizioni) {
      // Terzo argomento {} : nessun ingredient_link. Se matcha, e' per SKU.
      const rows = await scrivi([voce({ vendor_sku: sku, description: d,
                                        pack_description: '5#', amount: 25, unit_price: 25 })],
                                MAPPA_E4, {});
      assert.strictEqual(rows.length, 1, sku + ' "' + d + '": riga non scritta');
      assert.strictEqual(rows[0].ingredient_id, ing,
        sku + ' con descrizione "' + d + '" non risolve a ' + nome);
      assert.strictEqual(rows[0].match_status, 'matched');
    }
  });
}

test('E4-controllo. 30635 NON promosso resta senza identita\' per SKU', async () => {
  // Classe C: tenderloin TAILS oggi risolve a Stew Meat solo per
  // descrizione, e non l'ho promosso. Senza linkMap deve restare
  // unmatched — altrimenti avrei mappato alla cieca.
  const rows = await scrivi([voce({ vendor_sku: '30635', description: 'ABR BC TNDRLN TAILS 5+ OZ REF',
                                    pack_description: '4 PKG/12#', amount: 100, unit_price: 25 })],
                            MAPPA_E4, {});
  assert.strictEqual(rows[0].ingredient_id, null,
    '30635 non deve avere un\'identita\' per SKU: aspetta una decisione');
  assert.strictEqual(rows[0].match_status, 'unmatched');
});

test('E4-controllo2. 29554 e 24171 danno lo stesso ingrediente', async () => {
  // Sono lo stesso prodotto, REF e FRZ. La promozione doveva renderli
  // coerenti, non separarli.
  const a = await scrivi([voce({ vendor_sku: '29554', description: 'ABR BROCHETTE MEAT 1" REF',
                                 amount: 40, unit_price: 20 })], MAPPA_E4, {});
  const b = await scrivi([voce({ vendor_sku: '24171', description: 'ABR BROCHETTE MEAT 1" FRZ',
                                 amount: 40, unit_price: 20 })],
                          Object.assign({}, MAPPA_E4, { '24171': { ingredient_id: '28bd0f90', vendor_sku: '24171' } }), {});
  assert.strictEqual(a[0].ingredient_id, b[0].ingredient_id);
});

(async () => {
  for (const [n, f] of queue) {
    try { await f(); console.log('  ✓ ' + n); pass++; }
    catch (e) { console.log('  ✗ ' + n + '\n      ' + e.message); fail++; }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
