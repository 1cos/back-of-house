// ═════════════════════════════════════════════════════════════════════
// XCF-GG — Global Gourmet: OCR → righe → fattura, sul codice VERO.
//
// Fixture: testi OCR REALI (parole + coordinate) delle 4 fatture storiche
// fotografate (iCloud Global_Gourmet_4_original_invoices_Brigade.pdf),
// letti con Apple Vision in sviluppo, e delle 3 fatture dello scan del
// 02/10 (Scanned Document 72.pdf) quando presenti. In produzione l'OCR e'
// Google Vision: il test 3 fa passare le STESSE parole dall'adattatore
// Vision e pretende lo stesso risultato.
//
// I valori attesi sono trascritti dagli ORIGINALI (foto), non dall'output.
//
// `node tests/global-gourmet-parser.test.js`  (serve pure_logic.cjs)
// ═════════════════════════════════════════════════════════════════════
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(ROOT, 'tests/fixtures/global-gourmet');
const L = require(path.join(ROOT, 'js/vendor-parsers/ocr-layout.js'));
const GG = require(path.join(ROOT, 'js/vendor-parsers/global-gourmet.js'));
const R = require(path.join(ROOT, 'js/vendor-parsers/index.js'));
const W = require(path.join(ROOT, 'pure_logic.cjs'));
const { makeSb } = require(path.join(ROOT, 'tests/helpers-fake-supabase.js'));

let pass = 0, fail = 0;
const queue = [];
const test = (n, f) => queue.push([n, f]);

const ocrText = (name) => L.pagesToText(JSON.parse(fs.readFileSync(path.join(FIX, `gg-${name}.ocr.json`), 'utf8')).pages);

// [qty, U/M, price, amount, inizio descrizione]
const ATTESI = {
  '20734': { date: '2026-06-16', total: 936.10, rows: [
    [3, 'cs', 35.00, 105.00, 'Italian Peeled Tomatoes'], [3, 'cs', 164.00, 492.00, 'Extra Virgin Olive Oil'],
    [2, 'ea', 74.57, 149.14, 'Gnocchi C-Catering'], [7.3, 'lb', 16.82, 122.79, 'Guanciale'],
    [1, 'ea', 34.50, 34.50, 'SEA SALT COARSE'], [1.98, 'lb', 16.50, 32.67, 'Salame Napoli'] ] },
  '19563': { date: '2026-03-31', total: 1196.30, rows: [
    [3, 'cs', 35.00, 105.00, 'Italian Peeled Tomatoes'], [3, 'cs', 164.00, 492.00, 'Extra Virgin Olive Oil'],
    [2, 'ea', 74.57, 149.14, 'Gnocchi C-Catering'], [12.04, 'lb', 20.48, 246.58, 'Bresaola'],
    [5.63, 'lb', 12.98, 73.08, 'Pecorino Toscano'], [3, 'ea', 28.50, 85.50, 'Sea Salt Coarse'],
    [1, 'cs', 45.00, 45.00, 'Carnaroli Rice'] ] },
  '15814': { date: '2025-06-17', total: 2415.96, rows: [
    [4, 'ea', 69.50, 278.00, 'Semola di Grano Duro'], [3, 'ea', 74.57, 223.71, 'Gnocchi C-Catering'],
    [19.92, 'lb', 11.00, 219.12, 'Prosciutto Italiano'], [6, 'cs', 165.50, 993.00, 'Extra Virgin Olive Oil'],
    [6, 'cs', 34.00, 204.00, 'Italian Peeled Tomatoes'], [1, 'cs', 125.00, 125.00, 'Artichokes Long Steam'],
    [1, 'cs', 45.00, 45.00, 'Carnaroli Rice'], [15.62, 'lb', 9.75, 152.30, 'Pecorino Romano'],
    [8.91, 'lb', 10.98, 97.83, 'Pecorino Toscano'], [1, 'cs', 78.00, 78.00, 'Balsamic Glaze'] ] },
  '7186': { date: '2022-12-20', total: 520.19, rows: [
    [2, 'cs', 99.00, 198.00, 'Extra Virgin Olive Oil'], [1, 'ea', 74.57, 74.57, 'Molino Paisini Gnocchi'],
    [3.67, 'lb', 11.92, 43.75, 'Coppa Italiana'], [12.26, 'lb', 11.00, 134.86, 'Prosciutto Italiano'],
    [4.84, 'lb', 8.99, 43.51, 'Toscano Jumbo'], [0.5, 'cs', 51.00, 25.50, 'Riso Carnaroli'] ] },
};
// Le 3 fatture dello scan del 02/10: aggiunte quando il PDF e' letto.
const NUOVE_PATH = path.join(FIX, 'attesi-scan72.json');
if (fs.existsSync(NUOVE_PATH)) Object.assign(ATTESI, JSON.parse(fs.readFileSync(NUOVE_PATH, 'utf8')));

function controlla(num, parsed, att) {
  assert.strictEqual(parsed.vendor, 'Global Gourmet Foods');
  assert.strictEqual(parsed.document_type, 'invoice');
  assert.strictEqual(parsed.invoice_number, num);
  assert.strictEqual(parsed.invoice_date, att.date);
  assert.strictEqual(parsed.total, att.total);
  assert.strictEqual(parsed.items.length, att.rows.length, 'righe: ' + parsed.items.map(i => i.description).join(' | '));
  att.rows.forEach(([q, u, p, a, d], i) => {
    const it = parsed.items[i];
    assert.ok(it.description.startsWith(d), `riga ${i}: "${it.description}" non inizia con "${d}"`);
    assert.strictEqual(it.qty, q, `${d}: qty`);
    assert.strictEqual(it.purchase_unit, u, `${d}: U/M`);
    assert.strictEqual(it.unit_price, p, `${d}: prezzo`);
    assert.strictEqual(it.amount, a, `${d}: importo`);
    assert.strictEqual(it.vendor_sku, null, 'nessuno SKU inventato');
    if (u === 'lb') { assert.strictEqual(it.cost_per_lb, p); assert.strictEqual(it.price_type, 'per_lb'); assert.strictEqual(it.invoice_unit, 'lb'); }
    else assert.strictEqual(it.cost_per_lb, undefined, `${d}: niente cost_per_lb fuori dal peso`);
    // invoice_unit = U/M stampata; null solo dove la colonna e' vuota (SEA SALT #20734).
    if (!(num === '20734' && d === 'SEA SALT COARSE')) assert.strictEqual(it.invoice_unit, u, `${d}: invoice_unit`);
    else assert.strictEqual(it.invoice_unit, null, 'U/M vuota in fattura → invoice_unit null');
  });
  const somma = Math.round(parsed.items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  assert.strictEqual(somma, att.total, 'somma righe = Total');
  const bloccanti = [...parsed.warnings, ...parsed.items.flatMap(i => i.warnings)].filter(w => w.severity === 'blocking' || w.code === 'DOC-TOTAL-001');
  assert.deepStrictEqual(bloccanti, [], 'nessun warning bloccante su una fattura che quadra');
}

// ── 1. le fatture con testo OCR reale ───────────────────────────────
for (const num of Object.keys(ATTESI)) {
  test(`1.${num} OCR reale → fattura #${num} corretta riga per riga`, () => {
    const t = ATTESI[num].text_file ? fs.readFileSync(path.join(FIX, ATTESI[num].text_file), 'utf8') : ocrText(num);
    controlla(num, GG.parse(t), ATTESI[num]);
  });
}

// ── 2. il router la riconosce e la manda al parser giusto ───────────
test('2. router: detectVendor globalgourmet, tipo invoice, stesso risultato', () => {
  const t = ocrText('20734');
  assert.strictEqual(R.detectVendor(t), 'globalgourmet');
  assert.strictEqual(R.detectDocumentType(t, 'globalgourmet'), 'invoice');
  const p = R.parse(t);
  controlla('20734', p, ATTESI['20734']);
  // nessun altro fornitore ruba il riconoscimento
  for (const n of ['19563', '15814', '7186']) assert.strictEqual(R.detectVendor(ocrText(n)), 'globalgourmet');
});

test('2b. estratto conto AR (senza tabella articoli) NON e\' una fattura', () => {
  const stmt = 'GLOBAL GOURMET FOODS, LLC\nStatement\nDate Invoice # 22106 Balance 412.00\nInvoice #22199 830.10\nTotal Due $1,242.10';
  assert.strictEqual(R.detectDocumentType(stmt, 'globalgourmet'), 'unknown');
  assert.strictEqual(R.parse(stmt).items.length, 0);
});

// ── 3. adattatore Google Vision: stesse parole, stesso risultato ────
test('3. Vision fullTextAnnotation (normalizedVertices) → stesse righe', () => {
  for (const num of ['20734', '19563', '15814', '7186']) {
    const j = JSON.parse(fs.readFileSync(path.join(FIX, `gg-${num}.ocr.json`), 'utf8'));
    const fta = { pages: j.pages.map(p => ({ width: p.width, height: p.height, blocks: [{ paragraphs: [{
      words: p.tokens.map(t => ({ boundingBox: { normalizedVertices: t.box }, symbols: [...t.text].map(c => ({ text: c })) })) }] }] })) };
    const t = L.pagesToText(L.visionPagesToLayout(fta));
    assert.strictEqual(t, ocrText(num));
  }
});

// ── 4. review, non import ────────────────────────────────────────────
const RIGA_OK = '3 cs Italian Peeled Tomatoes 6#10 "La Carmela" 35.00 3cs 105.00';
const fattura = (righe, totale, num = '30001', data = '9/29/2026') =>
  `GLOBAL GOURMET FOODS, LLC\nInvoice\nDate Invoice #\n${data} ${num}\nP.O. Number Terms Rep Ship\nQuantity U/M Description Price EA / CS / LBS Amount\n${righe.join('\n')}\nThank you for your business.\nTotal $${totale}\norders@ggourmetfoods.com`;

test('4a. somma righe != Total → GG_TOTAL_MISMATCH + DOC-TOTAL-001, bloccanti', () => {
  const p = R.parse(fattura([RIGA_OK], '150.00'));
  const codes = p.warnings.map(w => w.code);
  assert.ok(codes.includes('GG_TOTAL_MISMATCH') && codes.includes('DOC-TOTAL-001'), codes.join());
  assert.ok(p.warnings.filter(w => w.code.startsWith('GG_') || w.code === 'DOC-TOTAL-001').every(w => W.isBlockingWarning(w, null, {}, null)));
});

test('4b. riga che non quadra (qty x prezzo != importo) → GG_LINE_MATH bloccante', () => {
  const p = GG.parse(fattura(['2 cs Italian Peeled Tomatoes 35.00 2cs 105.00'], '105.00'));
  const w = p.items[0].warnings.find(x => x.code === 'GG_LINE_MATH');
  assert.ok(w && w.severity === 'blocking');
  assert.strictEqual(W.isBlockingWarning(w, p.items[0], {}, null), true);
});

test('4c. qty persa dall\'OCR: ricavata solo se esatta e coerente col conteggio', () => {
  let p = GG.parse(fattura(['cs Italian Peeled Tomatoes 35.00 3cs 105.00'], '105.00'));
  assert.strictEqual(p.items[0].qty, 3); assert.strictEqual(p.items[0].qty_source, 'derived');
  assert.strictEqual(W.isBlockingWarning(p.items[0].warnings[0], p.items[0], {}, null), false, 'GG_QTY_DERIVED e\' informativo');
  // conteggio stampato diverso da importo/prezzo → bloccante
  p = GG.parse(fattura(['cs Italian Peeled Tomatoes 35.00 2cs 105.00'], '105.00'));
  assert.ok(p.items[0].warnings.some(w => w.code === 'GG_LINE_MATH'));
});

test('4d. numero, data o totale mancanti → bloccanti', () => {
  const p = GG.parse('GLOBAL GOURMET FOODS\nInvoice\nQuantity U/M Description Price Amount\n' + RIGA_OK);
  const codes = p.warnings.map(w => w.code);
  for (const c of ['GG_NO_INVOICE_NUMBER', 'GG_NO_DATE', 'GG_NO_TOTAL']) assert.ok(codes.includes(c), c);
});

test('4e. descrizione a capo si riattacca alla riga sopra', () => {
  const p = GG.parse(fattura(['1.98 lb Salame Napoli Smoked W/Peppercorn 2pc/cs (775Q) 16.50 1ea 32.67', '"Levoni"'], '32.67'));
  assert.strictEqual(p.items[0].description, 'Salame Napoli Smoked W/Peppercorn 2pc/cs (775Q) "Levoni"');
});

// ── 5. piu' fatture e copie (POD) in una scansione ──────────────────
const A = fattura([RIGA_OK], '105.00', '30001');
const B = fattura(['2 ea Gnocchi C-Catering 10kg. "Molino Pasini" 74.57 2ea 149.14'], '149.14', '30002', '9/30/2026');
const SCAN = [A, B, A /* POD firmato di A */, B].join('\n\f\n');

test('5a. splitInvoices: 2 fatture, le copie POD nello stesso gruppo', () => {
  const g = GG.splitInvoices(SCAN);
  assert.deepStrictEqual(g.map(x => [x.invoice_number, x.pages]), [['30001', [0, 2]], ['30002', [1, 3]]]);
});

test('5b. parse() su piu\' fatture rifiuta (GG_MULTI_INVOICE)', () => {
  const p = GG.parse(SCAN);
  assert.strictEqual(p.items.length, 0);
  assert.strictEqual(p.warnings[0].code, 'GG_MULTI_INVOICE');
  assert.strictEqual(W.isBlockingWarning(p.warnings[0], null, {}, null), true);
});

test('5c. fattura + POD: una sola fattura, 2 copie lette, nessun doppio', () => {
  const g = GG.splitInvoices(SCAN)[0];
  const p = GG.parse(g.text);
  assert.strictEqual(p.copies_read, 2);
  assert.strictEqual(p.items.length, 1);
  assert.strictEqual(p.total, 105);
});

test('5d. copie con totali diversi → GG_COPIES_DISAGREE', () => {
  const A2 = fattura(['4 cs Italian Peeled Tomatoes 35.00 4cs 140.00'], '140.00', '30001');
  const p = GG.parse([A, A2].join('\n\f\n'));
  assert.ok(p.warnings.some(w => w.code === 'GG_COPIES_DISAGREE' && w.severity === 'blocking'));
});

// ── 6. il worker separa la scansione e non duplica ──────────────────
test('6. vdaiSplitGlobalGourmet: un figlio per fattura, la gia\' presente no', async () => {
  const db = {
    vendor_documents: [
      { id: 'SCAN', vendor: 'Global Gourmet Foods', status: 'pdf_received', document_type: 'invoice', uploaded_by: 'gmail-auto',
        source_email_subject: 'Re: AR ZENO [GG abc]', source_email_from: 'mmartinez@ggourmetfoods.com',
        parsed_json: { storage_path: 'invoices/gmail/x.pdf', ocr_text: SCAN, ocr_engine: 'test' } },
      { id: 'OLD', vendor: 'Global Gourmet Foods', status: 'imported', document_type: 'invoice', document_number: '30002' },
    ],
  };
  const sb = makeSb(db);
  const r = await W.vdaiSplitGlobalGourmet(sb, db.vendor_documents[0], SCAN, 'invoices/gmail/x.pdf');
  assert.strictEqual(r.outcome, 'gg_split');
  const figli = db.vendor_documents.filter(d => d.parsed_json && d.parsed_json.split_from === 'SCAN');
  assert.strictEqual(figli.length, 1, 'solo #30001: #30002 esiste gia\'');
  const f = figli[0];
  assert.strictEqual(f.document_number, '30001');
  assert.strictEqual(f.status, 'pdf_received');
  assert.strictEqual(f.source_email_from, 'mmartinez@ggourmetfoods.com', 'il figlio eredita il mittente');
  assert.strictEqual(f.parsed_json.storage_path, undefined, 'il figlio NON possiede il PDF: un suo DUPLICATE non puo\' cancellarlo');
  assert.strictEqual(f.parsed_json.source_storage_path, 'invoices/gmail/x.pdf');
  assert.deepStrictEqual(f.parsed_json.source_pages, [0, 2]);
  const c = db.vendor_documents[0];
  assert.strictEqual(c.status, 'ignored');
  assert.strictEqual(c.parsed_json.split_duplicates[0].invoice_number, '30002');
  assert.strictEqual(c.parsed_json.storage_path, 'invoices/gmail/x.pdf', 'il contenitore tiene il PDF');
});

test('6b. una sola fattura nella scansione: nessuno split', async () => {
  const db = { vendor_documents: [{ id: 'S1', parsed_json: {} }] };
  const r = await W.vdaiSplitGlobalGourmet(makeSb(db), db.vendor_documents[0], [A, A].join('\n\f\n'), 'p.pdf');
  assert.strictEqual(r, null);
});

test('6c. sorgente Phase A: ocr_text pronto vince sul PDF (ancorato al sorgente)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'edge-functions/vendor-doc-auto-import/index.ts'), 'utf8');
  assert.ok(/if \(ocrTextReady\) \{\s*rawText = ocrTextReady;/.test(src));
  assert.ok(/'No text extracted'\) \{[\s\S]{0,400}\}\s*const ocr = await vdaiOcrScannedPdf/.test(src));
  assert.ok(src.includes("select('source_email_from,uploaded_by').eq('id', doc.id)"), 'lo split rilegge mittente e uploaded_by del contenitore');
});

// ── 7. modalita' storica isolata ────────────────────────────────────
function mondoStorico(historical) {
  const parsed = GG.parse(ocrText('7186'));
  return {
    vendor_documents: [{ id: 'D7186', vendor: 'Global Gourmet Foods', document_type: 'invoice', status: 'pending',
      document_number: '7186', document_date: '2022-12-20', warnings: [],
      parsed_json: { ...parsed, historical_mode: historical } }],
    invoice_lines: [], vendor_item_aliases: [], invoice_warnings: [], vendor_credits: [],
    // Coppa: collegata per descrizione, MAI comprata da GG → senza modalita'
    // storica il prezzo del 2022 diventerebbe il prezzo corrente.
    ingredient_links: [{ vendor: 'Global Gourmet Foods', invoice_description: parsed.items[2].description, ingredient_id: 'ING_COPPA', confirmed: true }],
    ingredient_vendors: [{ id: 'IV_EVOO', vendor: 'Global Gourmet Foods', ingredient_id: 'ING_EVOO', vendor_sku: null,
      unit_price: 164, last_invoice_date: '2026-06-16', active: true }],
  };
}

test('7a. senza modalita\' storica: il 2022 crea un prezzo corrente (il rischio)', async () => {
  const db = mondoStorico(false);
  const r = await W.vdaiApprove(makeSb(db), 'D7186');
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.ok(db.ingredient_vendors.some(v => v.ingredient_id === 'ING_COPPA' && v.unit_price === 11.92),
    'dimostra il rischio: la Coppa entrerebbe a 11,92 del 2022');
});

test('7b. modalita\' storica: invoice_lines con la data originale, ingredient_vendors intatto', async () => {
  const db = mondoStorico(true);
  const prima = JSON.stringify(db.ingredient_vendors);
  const r = await W.vdaiApprove(makeSb(db), 'D7186');
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(JSON.stringify(db.ingredient_vendors), prima, 'ingredient_vendors non toccato');
  assert.strictEqual(db.invoice_lines.length, 6);
  assert.ok(db.invoice_lines.every(l => l.invoice_date === '2022-12-20' && l.invoice_number === '7186'));
  const tot = Math.round(db.invoice_lines.reduce((s, l) => s + Number(l.line_total), 0) * 100) / 100;
  assert.strictEqual(tot, 520.19);
  assert.strictEqual(db.invoice_lines.find(l => l.ingredient_id === 'ING_COPPA').line_total, 43.75, 'la riga e\' comunque attribuita');
  assert.strictEqual(db.vendor_documents[0].status, 'imported');
});

(async () => {
  for (const [n, f] of queue) {
    try { await f(); console.log('  ✓ ' + n); pass++; }
    catch (e) { console.log('  ✗ ' + n + '\n      ' + (e && e.message)); fail++; }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
