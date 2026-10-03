// ═════════════════════════════════════════════════════════════════════
// INV15 — LA CONTABILITA' NON ASPETTA I NOMI
//
// Due metà, entrambe sul codice VERO:
//   FASE A  il worker importa una fattura sana anche con SKU mai visti
//           (pure_logic.cjs = bundle di vendor-doc-auto-import/index.ts)
//   FASE B  quando lo SKU prende un nome, il prezzo si recupera dalle
//           invoice_lines già importate
//           (js/vendor-documents-review.js caricato per davvero)
//
// `node tests/accounting-decoupled-from-mapping.test.js`
// ═════════════════════════════════════════════════════════════════════
'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const { makeSb } = require(path.join(ROOT, 'tests/helpers-fake-supabase.js'));
const W    = require(path.join(ROOT, 'pure_logic.cjs'));
const WSRC = fs.readFileSync(path.join(ROOT, 'edge-functions/vendor-doc-auto-import/index.ts'), 'utf8');
const VDR  = fs.readFileSync(path.join(ROOT, 'js/vendor-documents-review.js'), 'utf8');
const PIM  = require(path.join(ROOT, 'js/vendor-parsers/price-intelligence-merge.js'));

let pass = 0, fail = 0;
const queue = [];
const test = (n, f) => queue.push([n, f]);

const HARD = "Hardie's Fresh Foods / Dairyland Produce";

// ── una fattura Hardie's sana: righe consegnate, importi positivi ─────
function fattura(righe, extra) {
  const tot = righe.reduce((s, r) => s + r.amount, 0);
  return Object.assign({
    id: 'DOC1', vendor: HARD, document_type: 'invoice', status: 'pending',
    document_number: '07133828', document_date: '2026-09-23', warnings: [],
    parsed_json: {
      vendor: HARD, document_type: 'invoice', total: tot, subtotal: tot,
      items: righe.map(r => ({
        vendor_sku: r.sku, description: r.desc || ('Prodotto ' + r.sku),
        raw_description: r.desc || ('Prodotto ' + r.sku),
        qty: r.qty, qty_ordered: r.qty, qty_received: r.qty,
        unit_price: r.price, amount: r.amount,
        pack_description: r.pack || null, warnings: [],
      })),
    },
  }, extra || {});
}

const mondo = (docs, iv, aliases) => ({
  vendor_documents: docs.map(d => ({ ...d })),
  invoice_lines: [], ingredient_vendors: iv || [], vendor_item_aliases: aliases || [],
  ingredient_links: [], invoice_warnings: [], vendor_credits: [],
});

// ═════════════════════════════════════════════════════════════════════
console.log('\nFASE A — il worker non aspetta i nomi\n');

test('A. fattura valida + 0 unmatched -> importa, identico a prima', async () => {
  const d = fattura([{ sku: 'K1', qty: 1, price: 50, amount: 50 }]);
  const db = mondo([d], [{ id: 'IV1', vendor: HARD, ingredient_id: 'ING1', vendor_sku: 'K1', active: true, last_invoice_date: null }]);
  const sb = makeSb(db);
  const r = await W.vdaiApprove(sb, 'DOC1');
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(db.invoice_lines.length, 1);
  assert.strictEqual(db.invoice_lines[0].ingredient_id, 'ING1');
  assert.strictEqual(db.invoice_lines[0].match_status, 'matched');
});

test('B. fattura valida + 1 unmatched -> importa comunque', async () => {
  const d = fattura([
    { sku: 'K1', qty: 1, price: 50, amount: 50 },
    { sku: 'NUOVO', qty: 2, price: 45.14, amount: 90.28, desc: 'TOMATO HEIRLOOM' },
  ]);
  const db = mondo([d], [{ id: 'IV1', vendor: HARD, ingredient_id: 'ING1', vendor_sku: 'K1', active: true, last_invoice_date: null }]);
  const sb = makeSb(db);
  const r = await W.vdaiApprove(sb, 'DOC1');
  assert.strictEqual(r.ok, true, 'deve importare: ' + JSON.stringify(r));
  assert.strictEqual(db.invoice_lines.length, 2, 'entrambe le righe in contabilita');
  const nuova = db.invoice_lines.find(l => l.vendor_sku === 'NUOVO');
  assert.ok(nuova, 'la riga del prodotto nuovo esiste');
  assert.strictEqual(nuova.ingredient_id, null, 'nessun ingrediente inventato');
  assert.strictEqual(nuova.match_status, 'unmatched');
  assert.strictEqual(Number(nuova.line_total), 90.28, 'i dollari sono quelli della fattura');
  assert.strictEqual(nuova.raw_description, 'TOMATO HEIRLOOM', 'descrizione conservata');
});

test('B2. i dollari totali sono quelli del documento, non un parziale', async () => {
  const d = fattura([
    { sku: 'K1', qty: 1, price: 50, amount: 50 },
    { sku: 'N1', qty: 1, price: 30, amount: 30 },
    { sku: 'N2', qty: 1, price: 20, amount: 20 },
  ]);
  const db = mondo([d], [{ id: 'IV1', vendor: HARD, ingredient_id: 'ING1', vendor_sku: 'K1', active: true, last_invoice_date: null }]);
  await W.vdaiApprove(makeSb(db), 'DOC1');
  const somma = db.invoice_lines.reduce((s, l) => s + Number(l.line_total), 0);
  assert.strictEqual(somma, 100, 'somma righe = totale documento');
});

test('B3. tutti gli SKU nuovi -> importa, zero ingredienti inventati', async () => {
  const d = fattura([{ sku: 'X1', qty: 1, price: 10, amount: 10 }, { sku: 'X2', qty: 1, price: 20, amount: 20 }]);
  const db = mondo([d]);
  const r = await W.vdaiApprove(makeSb(db), 'DOC1');
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(db.invoice_lines.length, 2);
  assert.ok(db.invoice_lines.every(l => l.ingredient_id === null && l.match_status === 'unmatched'));
  assert.strictEqual(db.ingredient_vendors.length, 0, 'la price intel non crea righe fornitore');
});

test('C. unmatched + open_question vera -> BLOCCA, zero righe', async () => {
  const d = fattura([{ sku: 'NUOVO', qty: 1, price: 50, amount: 50 }], {
    warnings: [{ code: 'OQR-002', severity: 'blocking', message: 'quantita incerta' }],
  });
  const db = mondo([d]);
  const sb = makeSb(db);
  const pre = await W.vdaiPreflight(sb, db.vendor_documents[0]);
  assert.strictEqual(pre.ok, false, 'il preflight deve fallire');
  assert.strictEqual(pre.reason, 'open_question');
  const r = await W.vdaiApprove(sb, 'DOC1');
  assert.strictEqual(r.ok, false, 'e vdaiApprove deve rifiutare');
  assert.strictEqual(db.invoice_lines.length, 0, 'zero righe scritte');
  assert.strictEqual(db.vendor_documents[0].status, 'pending', 'resta pending');
});

test('D. totale non riconciliato (DOC-TOTAL-001) -> BLOCCA', async () => {
  const d = fattura([{ sku: 'NUOVO', qty: 1, price: 50, amount: 50 }], {
    warnings: [{ code: 'DOC-TOTAL-001', severity: 'blocking', message: 'totale non torna' }],
  });
  const db = mondo([d]);
  const r = await W.vdaiApprove(makeSb(db), 'DOC1');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(db.invoice_lines.length, 0);
});

test('E. retry del worker -> nessuna doppia contabilizzazione', async () => {
  const d = fattura([{ sku: 'NUOVO', qty: 1, price: 50, amount: 50 }]);
  const db = mondo([d]);
  const sb = makeSb(db);
  await W.vdaiApprove(sb, 'DOC1');
  const dopoPrimo = db.invoice_lines.length;
  const sommaPrima = db.invoice_lines.reduce((s, l) => s + Number(l.line_total), 0);
  await W.vdaiApprove(sb, 'DOC1');          // secondo giro
  assert.strictEqual(db.invoice_lines.length, dopoPrimo, 'nessuna riga in piu');
  assert.strictEqual(db.invoice_lines.reduce((s, l) => s + Number(l.line_total), 0), sommaPrima,
    'nessun dollaro in piu');
});

test('A/B sorgente: il gate non guarda piu unmatchedCount', () => {
  const i = WSRC.indexOf('const pre = await vdaiPreflight(sb, doc);\n  if (!pre.ok)');
  assert.ok(i > 0, 'il gate di vdaiApprove deve essere solo su pre.ok');
  const codice = WSRC.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/if \(!pre\.ok \|\| pre\.unmatchedCount > 0\)/.test(codice),
    'il vecchio gate non deve piu esistere nel codice');
  assert.ok(!/if \(pre\.ok && pre\.unmatchedCount === 0\)/.test(codice),
    'ne il suo gemello in Phase B');
});

test('R4 parita: tutti e tre i percorsi guardano solo pre.ok', () => {
  const codice = VDR.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.ok(/if \(!pre\.ok\) continue;/.test(codice),
    'vdrAutoImportCleanHardiesInvoices deve fermarsi solo su una domanda vera');
  assert.ok(!/pre\.unmatchedCount > 0\) continue/.test(codice),
    'il gate stretto del terzo percorso non deve piu esistere');
});

test('unmatchedCount continua a essere calcolato e restituito', async () => {
  const d = fattura([{ sku: 'K1', qty: 1, price: 50, amount: 50 }, { sku: 'NUOVO', qty: 1, price: 10, amount: 10 }]);
  const db = mondo([d], [{ id: 'IV1', vendor: HARD, ingredient_id: 'ING1', vendor_sku: 'K1', active: true, last_invoice_date: null }]);
  const pre = await W.vdaiPreflight(makeSb(db), db.vendor_documents[0]);
  assert.strictEqual(pre.ok, true);
  assert.strictEqual(pre.unmatchedCount, 1, 'l informazione non si perde, smette solo di essere un veto');
});

// ═════════════════════════════════════════════════════════════════════
console.log('\nFASE B — quando lo SKU prende un nome, il prezzo c\'e\' gia\'\n');

// Carica il codice UI vero, con il modulo di merge canonico.
function caricaUI() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = { PriceIntelligenceMerge: PIM, console };
  new Function('window', 'document', VDR)(win, dom.window.document);
  return win;
}
const UIW = caricaUI();

// INV15B — il documento sorgente dichiara la semantica del prezzo: il
// parser Hardie's emette catchweight:false sulle righe a cassa. Senza
// questo documento la recovery NON puo' sapere se il prezzo e' a cassa.
function docSorgente(id, items, vendor) {
  return { id: id, vendor: vendor || HARD, parsed_json: { items: items } };
}
function dbPrezzi(righe, iv, docs) {
  return { invoice_lines: righe, ingredient_vendors: iv || [], vendor_item_aliases: [],
    vendor_documents: docs || [docSorgente('DOCH', [{ vendor_sku: 'NUOVO', catchweight: false, unit_price: 45.14, qty: 2 }])] };
}
// Il vincolo VERO di produzione: ingredient_vendors.price_type NOT NULL
// default 'per_case'. Tutti i test di Fase B girano con questo vincolo.
const VINCOLI = { notNull: { ingredient_vendors: { price_type: 'per_case' } } };
const makeSbFaseB = (db, log) => makeSb(db, log, VINCOLI);
const riga = (o) => Object.assign({
  import_id: 'DOCH',
  vendor: HARD, vendor_sku: 'NUOVO', ingredient_id: null, match_status: 'unmatched',
  invoice_date: '2026-09-23', unit_price: 45.14, line_total: 90.28,
  pack_description: '10#', conversion_to_base: 4536, cost_per_100g: 0.995,
  raw_description: 'TOMATO HEIRLOOM',
}, o || {});

test('F1. mapping tardivo: il prezzo arriva dalle invoice_lines', async () => {
  const db = dbPrezzi([riga()]);
  const r = await UIW.vdrRecoverPriceFromInvoiceLines(makeSbFaseB(db), HARD, 'NUOVO', 'INGNEW');
  assert.strictEqual(r.status, 'created', JSON.stringify(r));
  assert.strictEqual(db.ingredient_vendors.length, 1);
  const iv = db.ingredient_vendors[0];
  assert.strictEqual(Number(iv.unit_price), 45.14, 'prezzo dalla fattura');
  assert.strictEqual(iv.last_invoice_date, '2026-09-23');
  assert.strictEqual(iv.vendor_sku, 'NUOVO', 'identita conservata');
  assert.strictEqual(Number(iv.conversion_to_base), 4536, 'conversione copiata, non inventata');
});

test('F2. nessuna perdita dello storico: invoice_lines non viene toccata', async () => {
  const db = dbPrezzi([riga()]);
  const prima = JSON.stringify(db.invoice_lines);
  await UIW.vdrRecoverPriceFromInvoiceLines(makeSbFaseB(db), HARD, 'NUOVO', 'INGNEW');
  assert.strictEqual(JSON.stringify(db.invoice_lines), prima, 'lo storico e intatto');
});

test('F3. prezzi multipli dello stesso SKU -> vince il piu recente', async () => {
  const db = dbPrezzi([
    riga({ invoice_date: '2026-08-01', unit_price: 30 }),
    riga({ invoice_date: '2026-09-23', unit_price: 45.14 }),
    riga({ invoice_date: '2026-07-01', unit_price: 20 }),
  ]);
  const r = await UIW.vdrRecoverPriceFromInvoiceLines(makeSbFaseB(db), HARD, 'NUOVO', 'INGNEW');
  assert.strictEqual(r.status, 'created');
  assert.strictEqual(Number(db.ingredient_vendors[0].unit_price), 45.14);
  assert.strictEqual(db.ingredient_vendors[0].last_invoice_date, '2026-09-23');
});

test('F4. non sovrascrive un prezzo PIU RECENTE con uno vecchio', async () => {
  const db = dbPrezzi(
    [riga({ invoice_date: '2026-08-01', unit_price: 30 })],
    [{ id: 'IVX', vendor: HARD, ingredient_id: 'INGNEW', vendor_sku: 'NUOVO',
       unit_price: 99, last_invoice_date: '2026-09-25', pack_description: '10#', conversion_to_base: 4536 }]
  );
  const r = await UIW.vdrRecoverPriceFromInvoiceLines(makeSbFaseB(db), HARD, 'NUOVO', 'INGNEW');
  assert.strictEqual(r.status, 'skipped');
  assert.strictEqual(r.reason, 'older_than_stored', JSON.stringify(r));
  assert.strictEqual(Number(db.ingredient_vendors[0].unit_price), 99, 'il prezzo recente resta');
});

test('F5. unita di misura diverse: una riga per_lb esistente non si reinterpreta', async () => {
  const db = dbPrezzi(
    [riga({ invoice_date: '2026-09-23', unit_price: 45.14 })],
    [{ id: 'IVL', vendor: HARD, ingredient_id: 'INGNEW', vendor_sku: 'NUOVO',
       unit_price: 3.2, price_type: 'per_lb', last_invoice_date: '2026-01-01' }]
  );
  const r = await UIW.vdrRecoverPriceFromInvoiceLines(makeSbFaseB(db), HARD, 'NUOVO', 'INGNEW');
  assert.strictEqual(r.status, 'skipped');
  assert.strictEqual(r.reason, 'per_lb_row_not_reinterpreted');
  assert.strictEqual(Number(db.ingredient_vendors[0].unit_price), 3.2, 'il prezzo al peso resta');
});

test('F6. non inventa conversioni: riga senza grammi -> conversione resta null', async () => {
  const db = dbPrezzi([riga({ conversion_to_base: null, cost_per_100g: null, pack_description: null })]);
  const r = await UIW.vdrRecoverPriceFromInvoiceLines(makeSbFaseB(db), HARD, 'NUOVO', 'INGNEW');
  assert.strictEqual(r.status, 'created', JSON.stringify(r));
  const iv = db.ingredient_vendors[0];
  assert.ok(iv.conversion_to_base === null || iv.conversion_to_base === undefined,
    'niente conversione inventata: ' + iv.conversion_to_base);
  assert.ok(iv.price_per_100g === null || iv.price_per_100g === undefined,
    'niente costo normalizzato inventato');
  assert.strictEqual(Number(iv.unit_price), 45.14, 'ma il prezzo si recupera');
});

test('F7. riga senza prezzo non e un osservazione', async () => {
  const db = dbPrezzi([riga({ unit_price: 0 })]);
  const r = await UIW.vdrRecoverPriceFromInvoiceLines(makeSbFaseB(db), HARD, 'NUOVO', 'INGNEW');
  assert.strictEqual(r.status, 'skipped');
  assert.strictEqual(r.reason, 'no_priced_line');
  assert.strictEqual(db.ingredient_vendors.length, 0);
});

test('F8. doppia associazione: rieseguire e un no-op sui dollari', async () => {
  const db = dbPrezzi([riga()]);
  const sb = makeSbFaseB(db);
  await UIW.vdrRecoverPriceFromInvoiceLines(sb, HARD, 'NUOVO', 'INGNEW');
  const dopo1 = JSON.parse(JSON.stringify(db.ingredient_vendors));
  const righePrima = db.invoice_lines.length;
  const r2 = await UIW.vdrRecoverPriceFromInvoiceLines(sb, HARD, 'NUOVO', 'INGNEW');
  assert.ok(['updated', 'idempotent', 'created'].includes(r2.status), JSON.stringify(r2));
  assert.strictEqual(db.ingredient_vendors.length, dopo1.length, 'nessuna riga fornitore in piu');
  assert.strictEqual(db.invoice_lines.length, righePrima, 'nessuna riga contabile in piu');
  assert.strictEqual(Number(db.ingredient_vendors[0].unit_price), 45.14, 'stesso prezzo');
});

test('F9. la recovery non crea contabilita (zero insert in invoice_lines)', async () => {
  const db = dbPrezzi([riga()]);
  await UIW.vdrRecoverPriceFromInvoiceLines(makeSbFaseB(db), HARD, 'NUOVO', 'INGNEW');
  assert.strictEqual(db.invoice_lines.length, 1, 'una riga prima, una dopo');
});

test('F10. e agganciata al percorso di mapping condiviso', () => {
  const codice = VDR.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const i = codice.indexOf('vdrSaveVendorSkuMapping = async function');
  const corpo = codice.slice(i, codice.indexOf('MARKER:VDR_SAVE_SKU_MAPPING_END'));
  // due call site (created e idempotent), ognuno con guard + chiamata
  const n = (corpo.match(/await window\.vdrRecoverPriceFromInvoiceLines\(/g) || []).length;
  assert.strictEqual(n, 2, 'agganciata su created E su idempotent, non su uno solo');
  assert.ok(/vdrBackfillInvoiceLines/.test(corpo), 'il backfill resta al suo posto');
});

test('F11. la recovery riusa gli helper esistenti, non ne scrive di nuovi', () => {
  const i = VDR.indexOf('MARKER:VDR_PRICE_RECOVERY_START');
  const corpo = VDR.slice(i, VDR.indexOf('MARKER:VDR_PRICE_RECOVERY_END'));
  assert.ok(/effectiveLastDate\(/.test(corpo), 'usa effectiveLastDate esistente');
  assert.ok(/chronologyAllows\(/.test(corpo), 'usa chronologyAllows esistente');
  assert.ok(/PriceIntelligenceMerge/.test(corpo), 'usa mergePriceIntelligence canonico');
  assert.ok(!/function chronologyAllows|function effectiveLastDate/.test(corpo),
    'non ridefinisce la cronologia');
});

// ═════════════════════════════════════════════════════════════════════
console.log('\nINV15B — price_type: vincolo vero, nessun per_case inventato, SKU diverso\n');

const WAL = 'Walmart Business';
const { execSync } = require('child_process');

test('B0. il fake DB riproduce il vincolo: price_type null esplicito -> 23502, nessuna scrittura', async () => {
  const db = { ingredient_vendors: [{ id: 'X', price_type: 'per_case', unit_price: 1 }] };
  const sb = makeSbFaseB(db);
  const u = await sb.from('ingredient_vendors').update({ unit_price: 2, price_type: null }).eq('id', 'X');
  assert.ok(u.error && u.error.code === '23502', 'update con null deve fallire');
  assert.strictEqual(db.ingredient_vendors[0].unit_price, 1, 'niente scritto');
  const i = await sb.from('ingredient_vendors').insert({ id: 'Y', price_type: null });
  assert.ok(i.error && i.error.code === '23502', 'insert con null deve fallire');
  assert.strictEqual(db.ingredient_vendors.length, 1);
});

test('B1. il codice PRIMA della correzione falliva davvero contro il vincolo (riproduzione del 400)', async () => {
  let vecchio;
  try { vecchio = execSync('git show 3d46cd2:js/vendor-documents-review.js', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }); }
  catch (_) { return; } // commit non disponibile (es. export senza git): la prova B2 basta
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const w = { PriceIntelligenceMerge: PIM, console };
  new Function('window', 'document', vecchio)(w, dom.window.document);
  const db = dbPrezzi([riga({ invoice_date: '2026-09-28', unit_price: 50 })],
    [{ id: 'IVO', vendor: HARD, ingredient_id: 'INGNEW', vendor_sku: 'NUOVO', unit_price: 40, price_type: 'per_case',
       pack_description: '10#', conversion_to_base: 4536, last_invoice_date: '2026-09-01' }]);
  const r = await w.vdrRecoverPriceFromInvoiceLines(makeSbFaseB(db), HARD, 'NUOVO', 'INGNEW');
  assert.strictEqual(r.status, 'error', 'il vecchio codice deve fallire: ' + JSON.stringify(r));
  assert.ok(/not-null/.test(r.reason));
  assert.strictEqual(Number(db.ingredient_vendors[0].unit_price), 40);
});

test('B2. update: scrive davvero e conserva il price_type esistente (nessun null inviato)', async () => {
  const log = { updates: [], inserts: [] };
  const db = dbPrezzi([riga({ invoice_date: '2026-09-28', unit_price: 50, cost_per_100g: 1.1023 })],
    [{ id: 'IVO', vendor: HARD, ingredient_id: 'INGNEW', vendor_sku: 'NUOVO', unit_price: 40, price_type: 'per_case',
       pack_description: '10#', conversion_to_base: 4536, last_invoice_date: '2026-09-01' }]);
  const r = await UIW.vdrRecoverPriceFromInvoiceLines(makeSbFaseB(db, log), HARD, 'NUOVO', 'INGNEW');
  assert.strictEqual(r.status, 'updated', JSON.stringify(r));
  const iv = db.ingredient_vendors[0];
  assert.strictEqual(Number(iv.unit_price), 50, 'scrittura effettiva');
  assert.strictEqual(iv.last_invoice_date, '2026-09-28');
  assert.strictEqual(iv.price_type, 'per_case', 'tipo conservato');
  const patch = log.updates.find(u => u.table === 'ingredient_vendors').patch;
  assert.ok(!('price_type' in patch), 'price_type non viene inviato sull update');
});

test('B3. insert senza prova del tipo -> needs_review, ZERO scritture', async () => {
  const log = { updates: [], inserts: [] };
  const db = dbPrezzi([riga({ import_id: null })], [], []);
  const r = await UIW.vdrRecoverPriceFromInvoiceLines(makeSbFaseB(db, log), HARD, 'NUOVO', 'INGNEW');
  assert.strictEqual(r.status, 'needs_review', JSON.stringify(r));
  assert.strictEqual(r.reason, 'price_type_unknown');
  assert.ok(r.message, 'motivo leggibile');
  assert.strictEqual(db.ingredient_vendors.length, 0);
  assert.strictEqual(log.inserts.length + log.updates.length, 0);
});

test('B4. documento che non dichiara catchweight (parser generico) -> needs_review, non per_case', async () => {
  const db = dbPrezzi([riga()], [], [docSorgente('DOCH', [{ vendor_sku: 'NUOVO', unit_price: 45.14, qty: 2 }])]);
  const r = await UIW.vdrRecoverPriceFromInvoiceLines(makeSbFaseB(db), HARD, 'NUOVO', 'INGNEW');
  assert.strictEqual(r.status, 'needs_review', JSON.stringify(r));
  assert.strictEqual(db.ingredient_vendors.length, 0);
});

test('B5. Walmart: quantita intere dal parser -> per_case provato, riga creata', async () => {
  const db = dbPrezzi(
    [riga({ vendor: WAL, vendor_sku: '1536106904', import_id: 'DW', unit_price: 4.64, invoice_date: '2026-09-25',
            pack_description: null, conversion_to_base: null, cost_per_100g: null })],
    [], [docSorgente('DW', [{ vendor_sku: '1536106904', qty: 4, unit_price: 4.64, amount: 18.56, line_type: 'product' }], WAL)]);
  const r = await UIW.vdrRecoverPriceFromInvoiceLines(makeSbFaseB(db), WAL, '1536106904', 'OJ');
  assert.strictEqual(r.status, 'created', JSON.stringify(r));
  assert.strictEqual(r.price_type_source, 'walmart_parser_integer_units');
  const iv = db.ingredient_vendors[0];
  assert.strictEqual(iv.price_type, 'per_case');
  assert.strictEqual(Number(iv.unit_price), 4.64);
  assert.strictEqual(iv.vendor_sku, '1536106904');
});

test('B6. SKU diverso sulla riga esistente -> sku_conflict, nessuna scrittura', async () => {
  const log = { updates: [], inserts: [] };
  const db = dbPrezzi(
    [riga({ vendor: WAL, vendor_sku: '44391012', import_id: 'DW', unit_price: 4.97, invoice_date: '2026-09-29', pack_description: '4lb' })],
    [{ id: 'IVOR', vendor: WAL, ingredient_id: 'ORANGE', vendor_sku: '5256904046', unit_price: 5.97, price_type: 'per_case',
       pack_description: '3lb', last_invoice_date: '2026-09-08' }],
    [docSorgente('DW', [{ vendor_sku: '44391012', qty: 1, unit_price: 4.97 }], WAL)]);
  const r = await UIW.vdrRecoverPriceFromInvoiceLines(makeSbFaseB(db, log), WAL, '44391012', 'ORANGE');
  assert.strictEqual(r.status, 'sku_conflict', JSON.stringify(r));
  assert.strictEqual(r.existing_sku, '5256904046');
  assert.strictEqual(Number(db.ingredient_vendors[0].unit_price), 5.97, 'riga dell altro articolo intatta');
  assert.strictEqual(log.updates.length + log.inserts.length, 0);
});

test('B7. riga esistente SENZA SKU -> populate_sku come l import, prezzo aggiornato', async () => {
  const db = dbPrezzi([riga({ invoice_date: '2026-09-28', unit_price: 50 })],
    [{ id: 'IVN', vendor: HARD, ingredient_id: 'INGNEW', vendor_sku: null, unit_price: 40, price_type: 'per_case',
       pack_description: '10#', conversion_to_base: 4536, last_invoice_date: '2026-09-01' }]);
  const r = await UIW.vdrRecoverPriceFromInvoiceLines(makeSbFaseB(db), HARD, 'NUOVO', 'INGNEW');
  assert.strictEqual(r.status, 'updated', JSON.stringify(r));
  assert.strictEqual(db.ingredient_vendors[0].vendor_sku, 'NUOVO');
  assert.strictEqual(Number(db.ingredient_vendors[0].unit_price), 50);
});

test('B8. documento dice al libbra, riga memorizzata a cassa -> needs_review (mismatch), nessuna scrittura', async () => {
  const db = dbPrezzi([riga({ invoice_date: '2026-09-28', unit_price: 16.82 })],
    [{ id: 'IVG', vendor: HARD, ingredient_id: 'INGNEW', vendor_sku: 'NUOVO', unit_price: 15, price_type: 'per_case',
       pack_description: '10#', conversion_to_base: 4536, last_invoice_date: '2026-09-01' }],
    [docSorgente('DOCH', [{ vendor_sku: 'NUOVO', purchase_unit: 'lb', cost_per_lb: 16.82, unit_price: 16.82 }])]);
  const r = await UIW.vdrRecoverPriceFromInvoiceLines(makeSbFaseB(db), HARD, 'NUOVO', 'INGNEW');
  assert.strictEqual(r.status, 'needs_review', JSON.stringify(r));
  assert.strictEqual(r.reason, 'price_type_mismatch');
  assert.strictEqual(Number(db.ingredient_vendors[0].unit_price), 15);
});

test('B9. insert al libbra solo se il prezzo della riga E il prezzo al libbra del documento', async () => {
  const okDb = dbPrezzi([riga({ unit_price: 16.82, conversion_to_base: null, cost_per_100g: 3.7082, pack_description: '7 lb' })], [],
    [docSorgente('DOCH', [{ vendor_sku: 'NUOVO', purchase_unit: 'lb', cost_per_lb: 16.82, unit_price: 16.82 }])]);
  const r1 = await UIW.vdrRecoverPriceFromInvoiceLines(makeSbFaseB(okDb), HARD, 'NUOVO', 'INGNEW');
  assert.strictEqual(r1.status, 'created', JSON.stringify(r1));
  assert.strictEqual(okDb.ingredient_vendors[0].price_type, 'per_lb');
  assert.ok(okDb.ingredient_vendors[0].conversion_to_base == null, 'per_lb: nessuna conversione cassa');
  const koDb = dbPrezzi([riga({ unit_price: 122.79 })], [],
    [docSorgente('DOCH', [{ vendor_sku: 'NUOVO', catchweight: true, price_per_lb: 16.82, unit_price: 122.79 }])]);
  const r2 = await UIW.vdrRecoverPriceFromInvoiceLines(makeSbFaseB(koDb), HARD, 'NUOVO', 'INGNEW');
  assert.strictEqual(r2.status, 'needs_review', JSON.stringify(r2));
  assert.strictEqual(koDb.ingredient_vendors.length, 0);
});

test('B10. righe dello stesso vendor+SKU concordi -> prova accettata; discordi -> needs_review', async () => {
  const base = () => [riga({ import_id: null })];
  const ok = dbPrezzi(base(), [{ id: 'S1', vendor: HARD, ingredient_id: 'ALTRO', vendor_sku: 'NUOVO', price_type: 'per_case' }], []);
  const r1 = await UIW.vdrRecoverPriceFromInvoiceLines(makeSbFaseB(ok), HARD, 'NUOVO', 'INGNEW');
  assert.strictEqual(r1.status, 'created', JSON.stringify(r1));
  assert.strictEqual(r1.price_type_source, 'same_vendor_sku_rows');
  const ko = dbPrezzi(base(), [
    { id: 'S1', vendor: HARD, ingredient_id: 'A1', vendor_sku: 'NUOVO', price_type: 'per_case' },
    { id: 'S2', vendor: HARD, ingredient_id: 'A2', vendor_sku: 'NUOVO', price_type: 'per_lb' }], []);
  const r2 = await UIW.vdrRecoverPriceFromInvoiceLines(makeSbFaseB(ko), HARD, 'NUOVO', 'INGNEW');
  assert.strictEqual(r2.status, 'needs_review', JSON.stringify(r2));
});

test('B11. esito visibile: testo per ogni stato, e i due chiamanti lo mostrano', () => {
  const d = UIW.vdrDescribePriceRecovery;
  assert.strictEqual(d({ status: 'created', fields: { unit_price: 4.64 }, from_invoice_date: '2026-09-25' }).tone, 'ok');
  assert.strictEqual(d({ status: 'needs_review', reason: 'price_type_unknown', message: 'x' }).tone, 'warn');
  assert.ok(/5256904046/.test(d({ status: 'sku_conflict', existing_sku: '5256904046' }).text));
  assert.strictEqual(d({ status: 'error', reason: 'boom' }).tone, 'error');
  assert.ok(/more recent/.test(d({ status: 'skipped', reason: 'older_than_stored' }).text));
  const vdrSave = VDR.slice(VDR.indexOf('async function saveMapping('), VDR.indexOf('window.vdrMatchSelectorPickCandidate = function'));
  assert.ok(/vdrDescribePriceRecovery\(result\.price_recovery\)/.test(vdrSave), 'vendor review mostra l esito');
  const ING = fs.readFileSync(path.join(ROOT, 'js/ingredients.js'), 'utf8');
  assert.ok(/vdrDescribePriceRecovery\(result\.price_recovery\)/.test(ING), 'scheda ingrediente mostra l esito');
});

// ═════════════════════════════════════════════════════════════════════
(async () => {
  for (const [n, f] of queue) {
    try { await f(); console.log('  ok   ' + n); pass++; }
    catch (e) { console.log('  FAIL ' + n + '\n       ' + (e && e.message)); fail++; }
  }
  console.log('\nEsito: ' + pass + ' passati, ' + fail + ' falliti\n');
  process.exit(fail ? 1 : 0);
})();
