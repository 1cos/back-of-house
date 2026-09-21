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

(async () => {
  for (const [n, f] of queue) {
    try { await f(); console.log('  ✓ ' + n); pass++; }
    catch (e) { console.log('  ✗ ' + n + '\n      ' + e.message); fail++; }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
