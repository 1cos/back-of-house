// ─────────────────────────────────────────────────────────────────────
// XCF-HARDIES — R.M.A. (pick-up slip) e righe "ordinato, non spedito,
// non addebitato".
//
// 1. Il pick-up slip 00682258 (23/09) era classificato fattura e finiva
//    in errore PARSE_ERROR; il gemello di giugno 00670731 era finito
//    'imported' con zero righe. Ora e' document_type 'return_request',
//    letto (SKU, quantita', ordine originale, codice reso) e chiuso
//    'ignored': nessuna invoice_line, nessun vendor_credits.
// 2. OQR-007 con ordinato > 0, spedito 0, importo 0, su un documento che
//    quadra: nota informativa anche senza identita' risolta.
// Testi e righe sono quelli reali (tests/fixtures/hardies-rma-samples.js).
// ─────────────────────────────────────────────────────────────────────
'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const ROOT = path.join(__dirname, '..');
const F    = require('./fixtures/hardies-rma-samples');
const P    = require(path.join(ROOT, 'js/vendor-parsers'));
const W    = require(path.join(ROOT, 'pure_logic.cjs'));
const WSRC = fs.readFileSync(path.join(ROOT, 'edge-functions/vendor-doc-auto-import/index.ts'), 'utf8');
const VDRSRC = fs.readFileSync(path.join(ROOT, 'js/vendor-documents-review.js'), 'utf8');
const VPUI = fs.readFileSync(path.join(ROOT, 'js/vendor-parser-ui.js'), 'utf8');

let pass = 0, fail = 0;
function test(n, f) { try { f(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + '\n      ' + (e && e.message)); } }

function grab(src, start, end) {
  const s = src.indexOf(start); assert.ok(s >= 0, 'non trovato: ' + start);
  const e = src.indexOf(end, s); assert.ok(e > s, 'fine non trovata: ' + end);
  return src.slice(s, e + end.length);
}

// UI: le funzioni di quantita', prese dal file vero
const UI_BLOCK = grab(VDRSRC, 'const VDR_TOTAL_TOLERANCE = 0.02;', 'window.vdrBuildQtyContext                   = vdrBuildQtyContext;');
const UIW = {};
new Function('window', UI_BLOCK + '\nwindow.__t = { vdrQtyWarningInformational, vdrDocumentEconomicallyDeterministic };')(UIW);
const UI = UIW.__t;

// Browser parser (copia usata dal reprocess della UI)
function browserParsers() {
  const start = VPUI.indexOf('function buildVendorParsers() {');
  const end = VPUI.indexOf('// ── BRIDGE: Parser result → Invoice Import pipeline ───────────');
  return new Function(VPUI.slice(start, end) + '\nreturn buildVendorParsers();')();
}

console.log('\nXCF-HARDIES — pick-up slip e corti non addebitati\n');

// ── 1. R.M.A. ────────────────────────────────────────────────────────
test('1. 00682258 (reale) non e\' piu\' una fattura: return_request', () => {
  const r = P.parse(F.RMA_00682258);
  assert.strictEqual(r.vendor, "Hardie's Fresh Foods / Dairyland Produce");
  assert.strictEqual(r.document_type, 'return_request');
  assert.strictEqual(r.document_number, '00682258');
  assert.strictEqual(r.document_date, '2026-09-23');
  assert.strictEqual(r.total, null, 'il pick-up slip non ha importo');
});

test('2. la pagina ripetuta conta una riga sola, con ordine e codice reso', () => {
  const r = P.parse(F.RMA_00682258);
  assert.strictEqual(r.items.length, 1);
  const it = r.items[0];
  assert.strictEqual(it.vendor_sku, '00108');
  assert.strictEqual(it.description, 'ASPARAGUS LARGE');
  assert.strictEqual(it.qty_returned, 1);
  assert.strictEqual(it.pack_description, '11/1#');
  assert.strictEqual(it.origin, 'MEX');
  assert.strictEqual(it.return_code, '5');
  assert.strictEqual(it.original_order_number, '07133808');
  assert.strictEqual(it.amount, null);
  assert.strictEqual(r.original_order_number, '07133808');
});

test('3. un solo warning, informativo, che dice cosa e\' e cosa non e\'', () => {
  const r = P.parse(F.RMA_00682258);
  assert.deepStrictEqual(r.warnings.map(w => w.code), ['RETURN_REQUEST']);
  assert.ok(/no amount/i.test(r.warnings[0].message));
  assert.strictEqual(W.isBlockingWarning(r.warnings[0], null, {}, null), false, 'non e\' una domanda');
});

test('4. 00670731 (giugno): stessa forma, nota "spoiled" conservata', () => {
  const r = P.parse(F.RMA_00670731);
  assert.strictEqual(r.document_type, 'return_request');
  assert.strictEqual(r.document_number, '00670731');
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(r.items[0].vendor_sku, '29810');
  assert.strictEqual(r.items[0].return_code, '2A');
  assert.strictEqual(r.items[0].original_order_number, '07010445');
  assert.strictEqual(r.items[0].note, 'spoiled');
});

test('5. non regressione: il CREDIT vero resta credit_memo con il suo importo', () => {
  const r = P.parse(F.CREDIT_00680317);
  assert.strictEqual(r.document_type, 'credit_memo');
  assert.strictEqual(r.total, -82.99);
  assert.strictEqual(W.vdaiValidateCredit(r).ok, true);
});

test('6. un pick-up slip non puo\' diventare un credito', () => {
  const r = P.parse(F.RMA_00682258);
  assert.strictEqual(W.vdaiValidateCredit(r).ok, false);
  assert.strictEqual(W.vdaiValidateCredit(r).reason, 'credit_no_amount');
});

test('7. "PICK-UP SLIP" vale solo per Hardie\'s', () => {
  assert.strictEqual(P.detectDocumentType('PICK-UP SLIP ... listed on this invoice', 'walmart'), 'invoice');
  assert.strictEqual(P.detectDocumentType('PICK-UP SLIP ... listed on this invoice', 'hardies'), 'return_request');
});

test('8. worker Phase A: return_request chiuso ignored, fuori da invoice_warnings', () => {
  assert.strictEqual(W.vdaiIsReturnRequest(P.parse(F.RMA_00682258)), true);
  assert.strictEqual(W.vdaiIsReturnRequest(P.parse(F.CREDIT_00680317)), false);
  assert.ok(/if \(vdaiIsReturnRequest\(parsed\)\) computedStatus = 'ignored';/.test(WSRC));
  assert.ok(WSRC.includes("!['OQR-006', 'RETURN_REQUEST'].includes(w.code)"));
});

test('9. worker Phase B non seleziona return_request (solo invoice/OC/credit_memo)', () => {
  assert.ok(WSRC.includes(".eq('status', 'pending').in('document_type', ['invoice', 'order_confirmation', 'credit_memo'])"));
  assert.strictEqual(W.isPurchasableDocument("Hardie's Fresh Foods / Dairyland Produce", 'return_request'), false);
});

test('10. il parser embeddato nel worker e\' identico ai file canonici', () => {
  for (const k of ['hardies-credit', 'index']) {
    const file = fs.readFileSync(path.join(ROOT, 'js/vendor-parsers', k + '.js'), 'utf8');
    assert.strictEqual(W.PARSER_SOURCES[k], file, k + ' non rigenerato');
  }
});

test('11. reprocess UI: copia browser classifica e legge allo stesso modo', () => {
  const bp = browserParsers();
  const a = bp.parse(F.RMA_00682258), b = P.parse(F.RMA_00682258);
  assert.strictEqual(a.document_type, 'return_request');
  assert.deepStrictEqual(
    a.items.map(i => [i.vendor_sku, i.qty_returned, i.return_code, i.original_order_number]),
    b.items.map(i => [i.vendor_sku, i.qty_returned, i.return_code, i.original_order_number]));
  assert.strictEqual(a.document_number, b.document_number);
  assert.ok(/parsed\.document_type === 'return_request'\) computedStatus = 'ignored'/.test(VDRSRC));
});

// ── 2. ordinato > 0, spedito 0, importo 0 ────────────────────────────
const line = (o) => Object.assign({ vendor_sku: '99999', description: 'X', qty_ordered: 1, qty_received: 1, amount: 9 }, o);
const doc = (items) => { const t = Math.round(items.reduce((s, i) => s + (i.amount || 0), 0) * 100) / 100; return { items, total: t, subtotal: t }; };
const ctxW = (pj, skus) => ({ deterministic: W.vdaiDocumentEconomicallyDeterministic(pj), resolvedSkus: new Set(skus || []), resolvedDescs: new Set() });
const ctxU = (pj, unmatched) => ({ deterministic: UI.vdrDocumentEconomicallyDeterministic(pj), unmatchedKeys: new Set(unmatched || []) });

test('12. corto totale non addebitato: informativo anche SENZA identita\' (worker e UI)', () => {
  const z = line({ vendor_sku: '27786', qty_ordered: 1, qty_received: 0, amount: 0 });
  const pj = doc([line({}), z]);
  assert.strictEqual(W.isBlockingWarning({ code: 'OQR-007' }, z, {}, ctxW(pj, [])), false);
  assert.strictEqual(UI.vdrQtyWarningInformational('OQR-007', z, ctxU(pj, ['27786'])), true);
});

test('13. ...ma solo se il documento quadra', () => {
  const z = line({ qty_ordered: 1, qty_received: 0, amount: 0 });
  const pj = Object.assign(doc([line({}), z]), { total: 999, subtotal: 999 });
  assert.strictEqual(W.isBlockingWarning({ code: 'OQR-007' }, z, {}, ctxW(pj, [])), true);
  assert.strictEqual(UI.vdrQtyWarningInformational('OQR-007', z, ctxU(pj, ['99999'])), false);
});

test('14. NULL non e\' zero: ordinato o importo mancanti continuano a bloccare', () => {
  for (const z of [line({ qty_ordered: null, qty_received: 0, amount: 0 }),
                   line({ qty_ordered: 1, qty_received: 0, amount: null })]) {
    const pj = doc([line({}), Object.assign({}, z, { amount: z.amount || 0 })]);
    assert.strictEqual(W.isBlockingWarning({ code: 'OQR-007' }, z, {}, ctxW(pj, [])), true);
  }
});

test('15. spedito 0 ma addebitato: resta domanda', () => {
  const z = line({ qty_ordered: 1, qty_received: 0, amount: 4.82 });
  const pj = doc([line({}), z]);
  assert.strictEqual(W.isBlockingWarning({ code: 'OQR-007' }, z, {}, ctxW(pj, ['99999'])), true);
});

test('16. spedito senza ordine (0/2) senza identita\': resta domanda (non si inventa un ingrediente)', () => {
  const z = line({ qty_ordered: 0, qty_received: 2, amount: 48.76 });
  const pj = doc([line({}), z]);
  assert.strictEqual(W.isBlockingWarning({ code: 'OQR-007' }, z, {}, ctxW(pj, [])), true);
  assert.strictEqual(W.isBlockingWarning({ code: 'OQR-002' }, z, {}, ctxW(pj, [])), true);
});

// ── 3. le due fatture reali ferme in pending ─────────────────────────
function blockers(pj, resolvedSkus) {
  const ctx = ctxW(pj, resolvedSkus);
  const out = [];
  for (const it of pj.items) for (const w of it.warnings || [])
    if (W.isBlockingWarning(w, it, F.KNOWN_CONVERSIONS, ctx)) out.push(w.code + ' ' + it.description);
  return out;
}

test('17. 07137898 e 07148979 quadrano al centesimo col totale stampato', () => {
  assert.strictEqual(W.vdaiDocumentEconomicallyDeterministic(F.INV_07137898), true);
  assert.strictEqual(W.vdaiDocumentEconomicallyDeterministic(F.INV_07148979), true);
});

test('18. le righe a spedito 0 non diventano acquisti (writer)', () => {
  const v = "Hardie's Fresh Foods / Dairyland Produce";
  const z1 = F.INV_07137898.items.filter(i => W.vdaiIsZeroDeliveredLegacy(v, i)).map(i => i.vendor_sku);
  const z2 = F.INV_07148979.items.filter(i => W.vdaiIsZeroDeliveredLegacy(v, i)).map(i => i.vendor_sku);
  assert.deepStrictEqual(z1, ['27786']);
  assert.deepStrictEqual(z2, ['05840']);
});

test('19. nessun OQR-007/OQR-002 blocca piu\' i due documenti (identita\' come in produzione)', () => {
  const all = (pj) => pj.items.map(i => i.vendor_sku);
  assert.deepStrictEqual(blockers(F.INV_07137898, all(F.INV_07137898)).filter(b => !/^OQR-006/.test(b)), []);
  assert.deepStrictEqual(blockers(F.INV_07148979, all(F.INV_07148979)).filter(b => !/^OQR-006/.test(b)), []);
});

console.log(`\n  ${pass} pass, ${fail} fail\n`);
process.exit(fail ? 1 : 0);
