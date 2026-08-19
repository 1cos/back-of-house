// ══════════════════════════════════════════════════════════════════
// Ben E. Keith Order Confirmation (email body, no PDF) — tests (BOH OS Task 10)
// Plain Node, no framework: `node tests/bek-order-confirmation.test.js`
//
// Gruppo A: parser browser reale (js/vendor-parser-ui.js -> buildVendorParsers
// -> parseBekOrderConfirmationEmail), estratto ed eseguito via marker come
// negli altri test di questa serie — non una riscrittura della logica.
//
// Gruppo B: logica di detection/dedup della Edge Function gmail-vendor-import
// (supabase/functions, non nel repo git). Non essendo Deno/TS eseguibile qui,
// le regex e le righe di estrazione vengono lette ED ESEGUITE per intero dal
// sorgente reale (stesso principio), più verifiche puntuali di presenza sul
// resto della logica (dedup key, niente Number() sul document_number).
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const VP_UI_JS = path.join(__dirname, '..', 'js', 'vendor-parser-ui.js');
const EDGE_FN_TS = path.join(__dirname, '..', 'edge-functions', 'gmail-vendor-import', 'index.ts');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); }
}

// ── Gruppo A: parser browser reale ──────────────────────────────
function loadRealBrowserParsers() {
  const src = fs.readFileSync(VP_UI_JS, 'utf8');
  const startMarker = 'function buildVendorParsers() {';
  const endMarker = '// ── BRIDGE: Parser result → Invoice Import pipeline ───────────';
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    throw new Error('marker non trovati in js/vendor-parser-ui.js — buildVendorParsers è cambiata di forma?');
  }
  const body = src.slice(start, end);
  const factory = new Function(body + '\nreturn buildVendorParsers();');
  return factory();
}

const BEK_ORDER_CONFIRMATION_FIXTURE = `
Ben E. Keith : Order Confirmation for FDF770366-ZENO'S ON THE SQUARE;0002952908

Sales Order # 0002952908
Customer Name: ZENO'S ON THE SQUARE
Customer #: FDF770366
Delivery Date: 08/20/2026
Order Total: $81.96

ITEM#
ITEM NAME
BRAND
PACK/SIZE
PRICE
ORDERED
CONFIRMED
STATUS

116533
Pastry Bag 21in Clr Disposable
Regency Wraps
1/ 100 CT
$40.98 per case
ORDERED 2
CONFIRMED 2
Filled

118842
Foil Wrap 18in Heavy Duty
Reynolds
1/ 1000 FT
$0.00 per case
ORDERED 1
CONFIRMED 0
Backordered
`;

const NOT_BEK_TEXT = `
Random memo mentioning a person named Keith who works in receiving.
No vendor invoice content here at all.
`;

console.log('\nBen E. Keith Order Confirmation (email body) — test run\n');

const browserParsers = loadRealBrowserParsers();
const ocResult = browserParsers.parse(BEK_ORDER_CONFIRMATION_FIXTURE);

// ── T2 — Sales Order / document_number, zeri iniziali preservati ──
test("T2: document_number === '0002952908' (stringa, zeri iniziali preservati)", () => {
  assert.strictEqual(ocResult.document_number, '0002952908');
  assert.strictEqual(typeof ocResult.document_number, 'string');
});

// ── T3 — Items ─────────────────────────────────────────────────────
test('T3: item#, description, pack, price, ordered, confirmed estratti correttamente', () => {
  assert.strictEqual(ocResult.items.length, 2);
  const it = ocResult.items[0];
  assert.strictEqual(it.vendor_sku, '116533');
  assert.strictEqual(it.description, 'Pastry Bag 21in Clr Disposable');
  assert.strictEqual(it.pack_description, '1/ 100 CT');
  assert.strictEqual(it.unit_price, 40.98);
  assert.strictEqual(it.qty_ordered, 2);
  assert.strictEqual(it.qty_received, 2);
});

// ── STEP 7 — ordered != confirmed non perso ─────────────────────────
test('ordered != confirmed viene preservato (item 2: ordered 1, confirmed 0)', () => {
  const it2 = ocResult.items[1];
  assert.strictEqual(it2.qty_ordered, 1);
  assert.strictEqual(it2.qty_received, 0);
  assert.notStrictEqual(it2.qty_ordered, it2.qty_received);
});

// ── T4 — Total ────────────────────────────────────────────────────
test('T4: order total $81.96 estratto correttamente', () => {
  assert.strictEqual(ocResult.total, 81.96);
});

// ── T5 — Detection negativa ──────────────────────────────────────
test('T5: un testo che menziona solo "Keith" non entra nel path BEK', () => {
  assert.notStrictEqual(browserParsers.detectVendor(NOT_BEK_TEXT), 'bek');
});

test('detectVendor + detectDocumentType riconoscono correttamente vendor=bek, tipo=order_confirmation', () => {
  assert.strictEqual(browserParsers.detectVendor(BEK_ORDER_CONFIRMATION_FIXTURE), 'bek');
  assert.strictEqual(browserParsers.detectDocumentType(BEK_ORDER_CONFIRMATION_FIXTURE), 'order_confirmation');
  assert.strictEqual(ocResult.vendor, 'Ben E. Keith');
  assert.strictEqual(ocResult.document_type, 'order_confirmation');
});

// ── T7 — vendor PDF invariati (Hardie's/FreshPoint/Fruge/BEK invoice) ──
test("T7: Hardie's, FreshPoint, Fruge e BEK invoice restano riconosciuti come prima", () => {
  assert.strictEqual(browserParsers.detectVendor("Dairyland Produce, LLC (dba Hardie's Fresh Foods)"), 'hardies');
  assert.strictEqual(browserParsers.detectVendor('FRESHPOINT DALLAS order confirmation'), 'freshpoint');
  assert.strictEqual(browserParsers.detectVendor('FRUGE SEAFOOD invoice'), 'fruge');
  assert.strictEqual(browserParsers.detectVendor('BEN E. KEITH FOODS INVOICE'), 'bek');
  assert.strictEqual(browserParsers.detectDocumentType('BEN E. KEITH FOODS INVOICE line items here'), 'invoice');
});

// ── Gruppo B: Edge Function gmail-vendor-import (sorgente reale, letta ed eseguita) ──

function readEdgeFnSource() {
  return fs.readFileSync(EDGE_FN_TS, 'utf8');
}

// Estrae ed esegue le 3 righe reali di detection (JS puro, nessuna annotazione TS).
function realIsBekOrderConfirmation(from, subject) {
  const src = readEdgeFnSource();
  const startMarker = "const isBekSender  = /@benekeith\\.com/i.test(from || '');";
  const endMarker = 'const isBekOrderConfirmation = isBekSender || isBekSubject;';
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker);
  if (start === -1 || end === -1) throw new Error('marker detection BEK non trovati nella Edge Function');
  const snippet = src.slice(start, end) + endMarker;
  const fn = new Function('from', 'subject', snippet + '\nreturn isBekOrderConfirmation;');
  return fn(from, subject);
}

// Estrae ed esegue le righe reali di estrazione Sales Order (JS puro).
// FIX (BOH OS Task 11F): marker aggiornato — l'estrazione ora prova prima
// body/html_body (variabile rinominata sourceText/cleanText) poi il subject
// come fallback (vedi tests/bek-html-order-confirmation.test.js per la
// copertura completa del fix). Stesso comportamento verificato qui, sorgente
// reale, path body-only legacy (senza html_body).
function realExtractSalesOrder(body) {
  const src = readEdgeFnSource();
  const startMarker = "const sourceText = html_body || body || '';";
  const endMarker = "if (!salesOrder && subject) {";
  if (!src.includes(startMarker) || !src.includes(endMarker)) {
    throw new Error('righe di estrazione Sales Order non trovate o cambiate nella Edge Function');
  }
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker);
  const snippet = src.slice(start, end).replace(/:\s*string\s*\|\s*null/g, '');
  const fn = new Function('body', 'html_body', 'subject', snippet + '\nreturn salesOrder;');
  return fn(body, undefined, null);
}

// ── T1 — Email BEK senza attachment non scartata solo per assenza PDF ──
test('T1: sender/subject BEK + body, senza pdf_base64 -> NON viene rifiutata (isBekOrderConfirmation true)', () => {
  const from = 'CRP-SVCMBX-entree@benekeith.com';
  const subject = "Ben E. Keith : Order Confirmation for FDF770366-ZENO'S ON THE SQUARE;0002952908";
  assert.strictEqual(realIsBekOrderConfirmation(from, subject), true);
});

test('email non-BEK senza pdf_base64 resta rifiutata (nessuna regressione sul comportamento esistente)', () => {
  assert.strictEqual(realIsBekOrderConfirmation('someone@example.com', 'Random subject'), false);
});

// ── T2 (Edge Function) — Sales Order estratto con zeri iniziali ────
test('T2 (edge fn): Sales Order # 0002952908 estratto come stringa con zeri iniziali intatti', () => {
  const result = realExtractSalesOrder(BEK_ORDER_CONFIRMATION_FIXTURE);
  assert.strictEqual(result, '0002952908');
});

// ── T6 — Dedup key vendor+document_type+document_number ────────────
test('T6: la query di dedup usa vendor+document_type=order_confirmation+document_number (non subject/from)', () => {
  const src = readEdgeFnSource();
  const dedupBlock = src.slice(src.indexOf('if (salesOrder) {'), src.indexOf('} else if (subject && from) {'));
  assert.ok(dedupBlock.includes(".eq('vendor', 'Ben E. Keith')"));
  assert.ok(dedupBlock.includes(".eq('document_type', 'order_confirmation')"));
  assert.ok(dedupBlock.includes(".eq('document_number', salesOrder)"));
});

test('document_number non viene mai convertito a Number/parseInt (zeri iniziali a rischio)', () => {
  const src = readEdgeFnSource();
  assert.ok(!/Number\(\s*salesOrder/.test(src));
  assert.ok(!/parseInt\(\s*salesOrder/.test(src));
  assert.ok(!/Number\(\s*soM/.test(src));
});

// ── Vendor_documents shape corretta per il nuovo path ────────────────
test('vendor_documents creato con document_type=order_confirmation, status=pdf_received, raw_text=sourceText', () => {
  const src = readEdgeFnSource();
  assert.ok(src.includes("document_type:        'order_confirmation',"));
  assert.ok(src.includes("status:               'pdf_received',"));
  assert.ok(src.includes('raw_text:             sourceText,'));
  assert.ok(src.includes("parsed_json:          { source: sourceMarker },"));
});

// ── Percorso PDF esistente invariato ──────────────────────────────
test("percorso PDF esistente (altri vendor) non richiede piu' del vecchio pdf_base64 -- nessuna regressione", () => {
  const src = readEdgeFnSource();
  assert.ok(src.includes("if (!isBekOrderConfirmation || (!body && !html_body)) return jsonError('Missing pdf_base64', 400);"));
  // Il branch PDF (else implicito, prosegue sotto) resta identico: stesso
  // upload storage, stesso insert document_type='invoice', stesso vendorHint.
  assert.ok(src.includes("document_type:        'invoice',"));
  assert.ok(src.includes('await supabase.storage'));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
