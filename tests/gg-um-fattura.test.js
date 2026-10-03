// ═════════════════════════════════════════════════════════════════════
// XCF-PREZZI — LA U/M DELLA FATTURA DECIDE LA SEMANTICA DEL PREZZO
//
// Global Gourmet #20734: "7.3 lb Guanciale 16.82 = 122.79". Il prezzo e'
// AL LIBBRA, ma era salvato come prezzo a cassa (price_type per_case,
// conversion_to_base 3175 = 7 lb nominali), invoice_lines.purchase_unit
// era sempre 'case' e il peso era il nominale invece dei 7,3 lb pagati.
//
// La correzione legge `invoice_unit` (U/M stampata in fattura) dal
// modulo condiviso price-intelligence-merge, lo stesso in UI e worker.
// Il resto di questo file dimostra che per Hardie's, BEK, Fruge',
// FreshPoint e Walmart NON cambia niente: nessun parser emette
// invoice_unit, e le forme reali dei 2.531 item in produzione danno lo
// stesso risultato della regola vecchia.
//
// `node tests/gg-um-fattura.test.js`
// ═════════════════════════════════════════════════════════════════════
'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const ROOT = path.join(__dirname, '..');
const PIM  = require(path.join(ROOT, 'js/vendor-parsers/price-intelligence-merge.js'));
const P    = require(path.join(ROOT, 'js/vendor-parsers/index.js'));
const W    = require(path.join(ROOT, 'pure_logic.cjs'));
const { makeSb } = require(path.join(ROOT, 'tests/helpers-fake-supabase.js'));
const VDR  = fs.readFileSync(path.join(ROOT, 'js/vendor-documents-review.js'), 'utf8');
const WSRC = fs.readFileSync(path.join(ROOT, 'edge-functions/vendor-doc-auto-import/index.ts'), 'utf8');
const FORME = require(path.join(ROOT, 'tests/fixtures/xcf-prezzi-corpus-forme.json')).forme;

let pass = 0, fail = 0;
const queue = [];
const test = (n, f) => queue.push([n, f]);

// La regola di PRIMA, scritta identica in UI (vdr ~4008) e worker (~1938).
const vecchioTipo = it => it.price_type || (it.catchweight ? 'per_lb' : 'per_case');

// ── #20734 come e' in produzione, con la U/M di fattura (colonna U/M) ──
const GG = 'Global Gourmet Foods';
const GG_ITEMS = [
  { qty: 3,    amount: 105,    unit_price: 35,    invoice_unit: 'cs', purchase_unit: 'cs', pack_description: '6/#10',   description: 'Italian Peeled Tomatoes 6#10 "La Carmela"' },
  { qty: 3,    amount: 492,    unit_price: 164,   invoice_unit: 'cs', purchase_unit: 'cs', pack_description: '3/5LT',   description: 'Extra Virgin Olive Oil 3/5lt Seleccion "Oleoestepa"', _cost_per_100g: 1.0933 },
  { qty: 2,    amount: 149.14, unit_price: 74.57, invoice_unit: 'ea', purchase_unit: 'ea', pack_description: '10 KG',   description: 'Gnocchi C-Catering 10kg. "Molino Pasini"' },
  { qty: 7.3,  amount: 122.79, unit_price: 16.82, invoice_unit: 'lb', purchase_unit: 'lb', pack_description: '2/3.5#',  description: 'Guanciale 2/3.5lb "Maestri"', cost_per_lb: 16.82 },
  { qty: 1,    amount: 34.5,   unit_price: 34.5,  invoice_unit: null, purchase_unit: 'ea', pack_description: '25 KG',   description: 'SEA SALT COARSE SICILIAN BULK 25KG' },
  { qty: 1.98, amount: 32.67,  unit_price: 16.5,  invoice_unit: 'lb', purchase_unit: 'lb', pack_description: '2 PC/CS', description: 'Salame Napoli Smoked W/Peppercorn 2pc/cs (775Q) "Levoni"', cost_per_lb: 16.5 },
].map(it => Object.assign({ vendor_sku: null, line_type: 'product', warnings: [], raw_description: it.description }, it));

// ═════════════════════════════════════════════════════════════════════
console.log('\nGlobal Gourmet — la U/M di fattura\n');

test('G1. Guanciale U/M lb: per_lb, invoice_lines lb, peso fatturato 7,3 lb = 3311 g', () => {
  const g = GG_ITEMS[3];
  assert.strictEqual(PIM.derivePriceType(g), 'per_lb');
  assert.strictEqual(PIM.invoiceLineUnit(g), 'lb');
  assert.strictEqual(Math.round(PIM.billedWeightG(g)), 3311);
});

test('G2. Salame U/M lb: per_lb, 1,98 lb fatturati', () => {
  const s = GG_ITEMS[5];
  assert.strictEqual(PIM.derivePriceType(s), 'per_lb');
  assert.strictEqual(PIM.invoiceLineUnit(s), 'lb');
  assert.strictEqual(Math.round(PIM.billedWeightG(s)), 898);
});

test('G3. cs / ea restano a cassa/pezzo; U/M vuota (Sea Salt) resta case come prima', () => {
  assert.strictEqual(PIM.derivePriceType(GG_ITEMS[0]), 'per_case');
  assert.strictEqual(PIM.invoiceLineUnit(GG_ITEMS[0]), 'case');
  assert.strictEqual(PIM.invoiceLineUnit(GG_ITEMS[2]), 'each');
  assert.strictEqual(PIM.derivePriceType(GG_ITEMS[2]), 'per_case');
  assert.strictEqual(PIM.invoiceLineUnit(GG_ITEMS[4]), 'case', 'U/M non stampata: nessuna invenzione');
  assert.strictEqual(PIM.billedWeightG(GG_ITEMS[2]), null, 'un sacco a pezzo non ha peso fatturato');
});

test('G4. una U/M sconosciuta non inventa niente', () => {
  assert.strictEqual(PIM.invoiceLineUnit({ invoice_unit: 'bx' }), 'case');
  assert.strictEqual(PIM.derivePriceType({ invoice_unit: 'bx' }), 'per_case');
});

function mondoGG() {
  const tot = GG_ITEMS.reduce((s, r) => s + r.amount, 0);
  const ids = ['ING_TOM', 'ING_OIL', 'ING_FLOUR', 'ING_GUAN', 'ING_SALT', 'ING_SAL'];
  return {
    vendor_documents: [{ id: 'GG1', vendor: GG, document_type: 'invoice', status: 'pending',
      document_number: '20734', document_date: '2026-06-16', warnings: [],
      parsed_json: { vendor: GG, document_type: 'invoice', invoice_date: '2026-06-16', total: tot, subtotal: tot,
        items: GG_ITEMS.map(x => Object.assign({}, x)) } }],
    invoice_lines: [], ingredient_vendors: [], vendor_item_aliases: [], invoice_warnings: [], vendor_credits: [],
    ingredient_links: GG_ITEMS.map((it, i) => ({ vendor: GG, invoice_description: it.description, ingredient_id: ids[i], confirmed: true })),
  };
}

test('G5. worker vero (vdaiApprove) su #20734: righe contabili e prezzi corretti, importi invariati', async () => {
  const db = mondoGG();
  const r = await W.vdaiApprove(makeSb(db, null, { notNull: { ingredient_vendors: { price_type: 'per_case' } } }), 'GG1');
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  const il = Object.fromEntries(db.invoice_lines.map(l => [l.ingredient_id, l]));
  // importi contabili identici alla fattura
  const somma = db.invoice_lines.reduce((s, l) => s + Number(l.line_total), 0);
  assert.strictEqual(Math.round(somma * 100), 93610, 'totale $936,10');
  // Guanciale
  assert.strictEqual(il.ING_GUAN.purchase_unit, 'lb');
  assert.strictEqual(Number(il.ING_GUAN.qty), 7.3);
  assert.strictEqual(il.ING_GUAN.estimated_total_g, 3311, 'peso pagato, non 3175 nominali');
  assert.strictEqual(Number(il.ING_GUAN.cost_per_100g), 3.7082);
  assert.strictEqual(il.ING_SAL.purchase_unit, 'lb');
  assert.strictEqual(Number(il.ING_SAL.cost_per_100g), 3.6376);
  assert.strictEqual(il.ING_FLOUR.purchase_unit, 'each');
  assert.strictEqual(il.ING_TOM.purchase_unit, 'case');
  assert.strictEqual(il.ING_SALT.purchase_unit, 'case');
  // ingredient_vendors
  const iv = Object.fromEntries(db.ingredient_vendors.map(v => [v.ingredient_id, v]));
  assert.strictEqual(iv.ING_GUAN.price_type, 'per_lb');
  assert.strictEqual(Number(iv.ING_GUAN.unit_price), 16.82);
  assert.ok(iv.ING_GUAN.conversion_to_base == null, 'al libbra: nessuna conversione cassa');
  assert.strictEqual(Number(iv.ING_GUAN.price_per_100g).toFixed(4), '3.7082', 'costo/100 g invariato');
  assert.strictEqual(iv.ING_SAL.price_type, 'per_lb');
  assert.strictEqual(Number(iv.ING_SAL.price_per_100g).toFixed(4), '3.6376');
  assert.strictEqual(iv.ING_OIL.price_type, 'per_case');
  assert.strictEqual(Number(iv.ING_OIL.price_per_100g), 1.0933, 'olio dal JSON allineato');
  assert.strictEqual(iv.ING_FLOUR.price_type, 'per_case');
});

test('G6. U/M lb SENZA cost_per_lb (parser futuro): prezzo al libbra lo stesso, costo/100 g giusto', async () => {
  const db = mondoGG();
  const g = db.vendor_documents[0].parsed_json.items[3];
  delete g.cost_per_lb;
  const r = await W.vdaiApprove(makeSb(db), 'GG1');
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  const il = db.invoice_lines.find(l => l.ingredient_id === 'ING_GUAN');
  assert.strictEqual(Number(il.cost_per_100g), 3.7082, 'e non 16,82 / 3311 g');
  const iv = db.ingredient_vendors.find(v => v.ingredient_id === 'ING_GUAN');
  assert.strictEqual(iv.price_type, 'per_lb');
  assert.strictEqual(Number(iv.price_per_100g).toFixed(4), '3.7082');
});

// ═════════════════════════════════════════════════════════════════════
console.log('\nGli altri fornitori NON cambiano\n');

test('N1. corpus di produzione (2.531 item, tutte le forme): stesso price_type, purchase_unit case, nessun peso fatturato', () => {
  let item = 0;
  for (const f of FORME) {
    const it = { price_type: f.price_type, catchweight: f.catchweight, cost_per_lb: f.cost_per_lb,
                 purchase_unit: f.purchase_unit, qty: 3, unit_price: 10 };
    assert.strictEqual(PIM.derivePriceType(it), vecchioTipo(it), 'forma ' + JSON.stringify(f));
    assert.strictEqual(PIM.invoiceLineUnit(it), 'case', 'forma ' + JSON.stringify(f));
    assert.strictEqual(PIM.billedWeightG(it), null, 'forma ' + JSON.stringify(f));
    item += f.n;
  }
  assert.strictEqual(item, 2531);
});

test('N2. Hardie\'s purchase_unit "lb" del PACK non viene letto come U/M di fattura', () => {
  const h = { vendor_sku: '05001', pack_description: '1/ 50 LB', purchase_unit: 'lb', catchweight: false, price_type: null, unit_price: 31.5, qty: 1 };
  assert.strictEqual(PIM.derivePriceType(h), 'per_case');
  assert.strictEqual(PIM.invoiceLineUnit(h), 'case');
});

function docDa(id, parsed) {
  const items = parsed.items;
  const tot = items.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  return { id, vendor: parsed.vendor, document_type: parsed.document_type || 'invoice', status: 'pending',
    document_number: id, document_date: '2026-09-23', warnings: [],
    parsed_json: Object.assign({}, parsed, { invoice_date: '2026-09-23', total: parsed.total != null ? parsed.total : tot, subtotal: parsed.subtotal != null ? parsed.subtotal : tot }) };
}

async function importa(doc) {
  const db = { vendor_documents: [doc], invoice_lines: [], ingredient_vendors: [], vendor_item_aliases: [],
    ingredient_links: [], invoice_warnings: [], vendor_credits: [] };
  // ogni SKU ha la sua riga prezzo: cosi' il ramo price intelligence gira davvero
  doc.parsed_json.items.forEach((it, i) => {
    if (it.vendor_sku) db.ingredient_vendors.push({ id: 'IV' + i, vendor: doc.vendor, vendor_sku: it.vendor_sku,
      ingredient_id: 'ING' + i, active: true, price_type: 'per_case', last_invoice_date: null });
  });
  const log = { updates: [], inserts: [] };
  const r = await W.vdaiApprove(makeSb(db, log), doc.id);
  return { r, db, log };
}

function verificaInvariato(nome, doc) {
  return async () => {
    const { r, db, log } = await importa(doc);
    const items = doc.parsed_json.items;
    assert.strictEqual(r.ok, true, nome + ' deve importare davvero: ' + JSON.stringify(r));
    assert.ok(db.invoice_lines.length > 0, nome + ': nessuna riga, test vuoto');
    assert.ok(log.updates.some(u => u.table === 'ingredient_vendors'), nome + ': price intelligence non eseguita');
    for (const l of db.invoice_lines) assert.strictEqual(l.purchase_unit, 'case', nome + ': ' + l.raw_description);
    // il price_type scritto in ingredient_vendors e' quello della regola vecchia
    for (const u of log.updates.filter(x => x.table === 'ingredient_vendors')) {
      const id = (u.filters.find(f => f.startsWith('id=')) || '').slice(3);
      const idx = Number(id.replace('IV', ''));
      if (!isFinite(idx) || u.patch.price_type === undefined) continue;
      assert.strictEqual(u.patch.price_type, vecchioTipo(items[idx]), nome + ' sku ' + items[idx].vendor_sku);
    }
    assert.ok(items.every(it => PIM.billedWeightG(it) === null), nome + ': nessun peso fatturato inventato');
  };
}

const { BEK_FIXTURE_INVOICE } = require('./fixtures/bek-sample.js');
const H = require('./fixtures/hardies-rma-samples.js');
const WAL = require('./fixtures/walmart-taxdetails-samples.js');

test('N3. BEK (parser vero su fixture, buyer cucina): invariato', verificaInvariato('BEK', docDa('BEK1', Object.assign(P.parse(BEK_FIXTURE_INVOICE), { buyer_email: 'raven_wolf_1510@yahoo.com' }))));
test('N4. Hardie\'s 07137898 (fixture reale): invariato', verificaInvariato('HARD', docDa('H1', H.INV_07137898)));
test('N5. Walmart c51dd720 (parser vero su testo reale): invariato', verificaInvariato('WAL', docDa('W1', P.parse(WAL.c51dd720))));
test('N6. Fruge\' (forme reali: per_lb, catchweight, cost_per_lb): invariato', verificaInvariato('FRUGE', docDa('F1', {
  vendor: 'Fruge Seafood', document_type: 'invoice',
  items: [
    { vendor_sku: 'F1', description: 'SHRIMP 16/20', raw_description: 'SHRIMP 16/20', qty: 10, unit_price: 8.5, amount: 85, price_type: 'per_lb', catchweight: false, cost_per_lb: 8.5, total_weight_lb: 10, _cost_per_100g: 1.874, pack_description: '10 LB', warnings: [] },
    { vendor_sku: 'F2', description: 'RED SNAPPER WHOLE', raw_description: 'RED SNAPPER WHOLE', qty: 1, unit_price: 11.25, amount: 56.25, price_type: 'per_lb', catchweight: true, cost_per_lb: 11.25, total_weight_lb: 5, _cost_per_100g: 2.4802, pack_description: '5 LB', warnings: [] },
  ],
})));

test('N7. UI e worker usano la stessa regola dal modulo condiviso, nessuna copia', () => {
  const codice = s => s.split('\n').filter(l => !l.trim().startsWith('//') && !/^\s*"[a-z0-9-]+":\s*"/.test(l)).join('\n');
  const ui = codice(VDR), wk = codice(WSRC);
  assert.ok(!/item\.price_type \|\| \(item\.catchweight \? 'per_lb' : 'per_case'\)/.test(ui), 'UI: vecchia regola rimossa');
  assert.ok(!/item\.price_type \|\| \(item\.catchweight \? 'per_lb' : 'per_case'\)/.test(wk), 'worker: vecchia regola rimossa');
  assert.ok(/vdrPIM\(\)\.derivePriceType\(item\)/.test(ui));
  assert.ok(/parsersApi\(\)\.priceIntel\.derivePriceType\(item\)/.test(wk));
  assert.ok(/purchase_unit:\s+vdrPIM\(\)\.invoiceLineUnit\(item\)/.test(ui));
  assert.ok(/purchase_unit: parsersApi\(\)\.priceIntel\.invoiceLineUnit\(item\)/.test(wk));
  assert.ok(!/purchase_unit:\s*'case'/.test(ui.slice(ui.indexOf('Populate invoice_lines'))), 'UI: niente case fisso');
  assert.ok(!/qty, purchase_unit: 'case'/.test(wk), 'worker: niente case fisso');
  // il modulo embeddato nel worker e' byte-identico al file
  const m = WSRC.match(/^  "price-intelligence-merge": (".*"),?$/m);
  assert.ok(m, 'modulo embeddato non trovato');
  assert.strictEqual(JSON.parse(m[1]), fs.readFileSync(path.join(ROOT, 'js/vendor-parsers/price-intelligence-merge.js'), 'utf8'));
});

// ═════════════════════════════════════════════════════════════════════
(async () => {
  for (const [n, f] of queue) {
    try { await f(); console.log('  ok   ' + n); pass++; }
    catch (e) { console.log('  FAIL ' + n + '\n       ' + (e && e.stack || e).toString().split('\n').slice(0, 3).join('\n       ')); fail++; }
  }
  console.log('\nEsito: ' + pass + ' passati, ' + fail + ' falliti\n');
  process.exit(fail ? 1 : 0);
})();
