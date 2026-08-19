// ══════════════════════════════════════════════════════════════════
// BEK Order Confirmation — fix document_number/UNKNOWN_DOC_TYPE su body
// reale (BOH OS Task 11B)
// Plain Node: `node tests/bek-order-confirmation-body-fix.test.js`
//
// Fixture basata sul vero vendor_documents.raw_text osservato in produzione
// (id d84e4d64-4088-43f7-a35a-49d24cb4cfbc — preambolo/footer SendGrid con
// CRLF reali) + sul contenuto minimo indicato nel task (STEP 2), non una
// singola riga artificiale.
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

function loadRealBrowserParsers() {
  const src = fs.readFileSync(VP_UI_JS, 'utf8');
  const startMarker = 'function buildVendorParsers() {';
  const endMarker = '// ── BRIDGE: Parser result → Invoice Import pipeline ───────────';
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker);
  if (start === -1 || end === -1) throw new Error('marker non trovati in js/vendor-parser-ui.js');
  const body = src.slice(start, end);
  return new Function(body + '\nreturn buildVendorParsers();')();
}

// Fixture multi-riga, CRLF reali, con il preambolo/footer osservato nel
// vendor_documents.raw_text di produzione (id d84e4d64...), NON una stringa
// artificiale su una riga sola.
const REAL_BODY_FIXTURE =
  'Ben E. Keith Foods - Fort Worth Division\r\n\r\n' +
  ' \r\n\r\n Please do not reply to this message. If you need assistance, please ' +
  'contact your sales representative or visit the Contact Us page.\r\n\r\n' +
  'Your order is confirmed and ready for delivery\r\n\r\n' +
  'Sales Order # 0002952908\r\n' +
  'Customer Name\r\n' +
  "ZENO'S ON THE SQUARE\r\n" +
  'Customer #\r\n' +
  'FDF770366\r\n' +
  'Delivery Date\r\n' +
  '08/20/2026\r\n' +
  'Order Total\r\n' +
  '$81.96\r\n\r\n' +
  'ITEM#\r\n' +
  'ITEM NAME\r\n' +
  'BRAND\r\n' +
  'PACK/SIZE\r\n' +
  'PRICE\r\n' +
  'ORDERED\r\n' +
  'CONFIRMED\r\n' +
  'STATUS\r\n\r\n' +
  '116533\r\n' +
  'Pastry Bag 21in Clr Disposable\r\n' +
  'Regency Wraps\r\n' +
  '1/ 100 CT\r\n' +
  '$40.98 per case\r\n' +
  'ORDERED 2\r\n' +
  'CONFIRMED 2\r\n' +
  'Filled\r\n';

console.log('\nBEK Order Confirmation — fix document_number / UNKNOWN_DOC_TYPE — test run\n');

const browserParsers = loadRealBrowserParsers();

// ── Regressione esatta del record production reale ──────────────────
test("regressione: la fixture reale NON produce più UNKNOWN_DOC_TYPE (bug osservato in id d84e4d64...)", () => {
  const docType = browserParsers.detectDocumentType(REAL_BODY_FIXTURE);
  assert.strictEqual(docType, 'order_confirmation', `detectDocumentType ha restituito "${docType}" — root cause del record production non risolta`);
});

test('la fixture reale non contiene la frase letterale "Order Confirmation" (conferma la causa del bug)', () => {
  assert.ok(!/Order Confirmation/i.test(REAL_BODY_FIXTURE), 'la fixture dovrebbe riprodurre il body reale, che non contiene questa frase');
});

// ── T1 — body multilinea reale → Sales Order corretto ────────────────
test("T1: body Gmail multilinea reale (CRLF, footer SendGrid) → document_number '0002952908'", () => {
  const result = browserParsers.parse(REAL_BODY_FIXTURE);
  assert.strictEqual(result.document_type, 'order_confirmation');
  assert.strictEqual(result.document_number, '0002952908');
});

// ── T2 — zeri iniziali preservati ────────────────────────────────────
test('T2: document_number è una stringa, zeri iniziali intatti', () => {
  const result = browserParsers.parse(REAL_BODY_FIXTURE);
  assert.strictEqual(typeof result.document_number, 'string');
  assert.strictEqual(result.document_number.length, 10);
  assert.ok(result.document_number.startsWith('000'));
});

// ── T3 — spazi/newline non ragionevoli intorno a "Sales Order #" ────
test('T3: spazi multipli, tab, e "#" assente non rompono l\'estrazione', () => {
  const variants = [
    'Sales   Order   #   0002952908',        // spazi multipli
    'Sales\tOrder\t#\t0002952908',            // tab
    'Sales Order: 0002952908',                // niente "#", solo due punti
    'Sales Order 0002952908',                 // niente "#" né due punti
  ];
  for (const v of variants) {
    const result = browserParsers.parse('Ben E. Keith Foods\nYour order is confirmed\n' + v + '\nCustomer Name\n');
    assert.strictEqual(result.document_number, '0002952908', `variante non riconosciuta: "${v}"`);
  }
});

// ── T4 — item, delivery date, total ancora estratti correttamente ────
test('T4: item 116533, pack, price, ordered/confirmed, delivery date, total estratti dalla fixture reale', () => {
  const result = browserParsers.parse(REAL_BODY_FIXTURE);
  assert.strictEqual(result.document_date, '2026-08-20');
  assert.strictEqual(result.total, 81.96);
  assert.strictEqual(result.items.length, 1);
  const it = result.items[0];
  assert.strictEqual(it.vendor_sku, '116533');
  assert.strictEqual(it.description, 'Pastry Bag 21in Clr Disposable');
  assert.strictEqual(it.pack_description, '1/ 100 CT');
  assert.strictEqual(it.unit_price, 40.98);
  assert.strictEqual(it.qty_ordered, 2);
  assert.strictEqual(it.qty_received, 2);
});

// ── Gruppo B: Edge Function (sorgente reale, letta ed eseguita) ─────

function readEdgeFnSource() {
  return fs.readFileSync(EDGE_FN_TS, 'utf8');
}

function realExtractSalesOrder(bodyText) {
  const src = readEdgeFnSource();
  const marker = 'const cleanBody = body.replace(/[\\u200B\\u200C\\u200D\\uFEFF]/g, \'\');';
  const endMarker = "const soM = cleanBody.match(/Sales\\s*Order\\s*#?\\s*:?\\s*(\\d+)/i);";
  if (!src.includes(marker) || !src.includes(endMarker)) {
    throw new Error('righe di estrazione Sales Order non trovate o cambiate nella Edge Function');
  }
  const start = src.indexOf(marker);
  const end = src.indexOf(endMarker) + endMarker.length;
  const snippet = src.slice(start, end);
  const fn = new Function('body', snippet + '\nreturn soM ? soM[1] : null;');
  return fn(bodyText);
}

// ── T5 — dedup usa il document number reale (non più null) ──────────
test("T5: la Edge Function estrae '0002952908' dal body reale (dedup non cade più nel fallback subject/from)", () => {
  const result = realExtractSalesOrder(REAL_BODY_FIXTURE);
  assert.strictEqual(result, '0002952908');
});

test('la query di dedup resta su vendor+document_type+document_number (invariata, solo l\'estrazione a monte è cambiata)', () => {
  const src = readEdgeFnSource();
  const dedupBlock = src.slice(src.indexOf('if (salesOrder) {'), src.indexOf('} else if (subject && from) {'));
  assert.ok(dedupBlock.includes(".eq('vendor', 'Ben E. Keith')"));
  assert.ok(dedupBlock.includes(".eq('document_type', 'order_confirmation')"));
  assert.ok(dedupBlock.includes(".eq('document_number', salesOrder)"));
});

test('document_number non viene mai convertito a Number/parseInt', () => {
  const src = readEdgeFnSource();
  assert.ok(!/Number\(\s*salesOrder/.test(src));
  assert.ok(!/parseInt\(\s*salesOrder/.test(src));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
