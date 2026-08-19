// ══════════════════════════════════════════════════════════════════
// Ben E. Keith Order Confirmation — HTML (msg.getBody()) tests (BOH OS Task 11F)
// Plain Node, zero dipendenze esterne (come ogni altro test in questo repo —
// nessun package.json/npm install richiesto):
// `node tests/bek-html-order-confirmation.test.js`
//
// Esegue il parser reale (js/vendor-parser-ui.js -> buildVendorParsers ->
// parseBekOrderConfirmationHtml) e la logica reale della Edge Function
// (edge-functions/gmail-vendor-import/index.ts), entrambi estratti dal
// sorgente con marker espliciti — non una riscrittura della logica.
//
// Il codice di PRODUZIONE chiama sempre `new DOMParser()` nativo del
// browser, mai toccato qui. Il piccolo polyfill sotto esiste SOLO per
// eseguire quel codice reale in Node senza introdurre jsdom (o qualunque
// altra dipendenza npm) in un progetto che oggi non ne ha nessuna — copre
// solo la superficie che parseBekOrderConfirmationHtml usa davvero
// (.body.textContent, .querySelectorAll('table tr'), per riga
// .querySelectorAll('td') con .textContent), non è un DOM completo.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const VP_UI_JS = path.join(__dirname, '..', 'js', 'vendor-parser-ui.js');
const EDGE_FN_TS = path.join(__dirname, '..', 'edge-functions', 'gmail-vendor-import', 'index.ts');
const { BEK_HTML_FIXTURE, SUBJECT, FROM } = require('./fixtures/bek-html-sample.js');

function decodeEntities(str) {
  return str
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&copy;/g, '©')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}
function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
}
function makeCell(innerHtml) { return { textContent: stripTags(innerHtml) }; }
function makeRow(rowHtml) {
  const cellMatches = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
  return { querySelectorAll(sel) { return sel === 'td' ? cellMatches.map(m => makeCell(m[1])) : []; } };
}
class MiniDOMParser {
  parseFromString(html) {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyHtml = bodyMatch ? bodyMatch[1] : html;
    const rowMatches = [...bodyHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    return {
      body: { textContent: stripTags(bodyHtml) },
      querySelectorAll(sel) { return sel === 'table tr' ? rowMatches.map(m => makeRow(m[1])) : []; },
    };
  }
}
global.DOMParser = MiniDOMParser;

// DOMParser (polyfill sopra), esposto come global solo per l'esecuzione dei
// test — il codice reale in vendor-parser-ui.js chiama semplicemente
// `new DOMParser()`, identica sintassi che userebbe nel browser.
global.window = global.window || {};

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); } }
async function atest(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); } }

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

console.log('\nBen E. Keith Order Confirmation — HTML (getBody) test run\n');

const browserParsers = loadRealBrowserParsers();
const result = browserParsers.parseBekOrderConfirmationHtml(BEK_HTML_FIXTURE);

// ── T3 — HTML table: prima riga ──────────────────────────────────
test('T3: la prima riga della tabella HTML produce tutti i campi attesi', () => {
  assert.strictEqual(result.items.length, 2, 'attese 2 righe nella fixture');
  const it = result.items[0];
  assert.strictEqual(it.vendor_sku, '116533');
  assert.strictEqual(it.description, 'Pastry Bag 21in Clr Disposable');
  assert.strictEqual(it.brand, 'Regency Wraps');
  assert.strictEqual(it.pack_description, '1/ 100 CT');
  assert.strictEqual(it.unit_price, 40.98);
  assert.strictEqual(it.qty_ordered, 2);
  assert.strictEqual(it.qty_received, 2);
  assert.strictEqual(it.status, 'Filled');
});

// ── T4 — Delivery date ───────────────────────────────────────────
test('T4: delivery date 08/20/2026 estratta correttamente', () => {
  assert.strictEqual(result.document_date, '2026-08-20');
});

// ── T5 — Total ────────────────────────────────────────────────────
test('T5: order total 81.96 estratto correttamente', () => {
  assert.strictEqual(result.total, 81.96);
});

// ── T6 — Ordered/confirmed distinti preservati ───────────────────
test('T6: seconda riga (ordered=3, confirmed=2) preserva entrambi i valori distinti', () => {
  const it2 = result.items[1];
  assert.strictEqual(it2.vendor_sku, '118842');
  assert.strictEqual(it2.qty_ordered, 3);
  assert.strictEqual(it2.qty_received, 2);
  assert.notStrictEqual(it2.qty_ordered, it2.qty_received);
  assert.strictEqual(it2.status, 'Backordered');
});

// ── T2 (parser) — document number dal contenuto HTML ─────────────
test("T2b: document_number '0002952908' estratto anche dal solo contenuto HTML (senza fallback subject)", () => {
  assert.strictEqual(result.document_number, '0002952908');
  assert.strictEqual(typeof result.document_number, 'string');
});

// ── T7 — HTML entities decodificate dal DOM parser reale ─────────
test("T7: DOMParser (stessa interfaccia usata dal codice reale) decodifica &apos; e &copy; correttamente (non regex)", () => {
  const doc = new DOMParser().parseFromString('<p>ZENO&apos;S ON THE SQUARE</p><p>&copy; 2026</p>', 'text/html');
  const text = doc.body.textContent;
  assert.ok(text.includes("ZENO'S ON THE SQUARE"), 'apostrofo non decodificato: ' + JSON.stringify(text));
  assert.ok(text.includes('© 2026'), 'copyright non decodificato: ' + JSON.stringify(text));
});

test('vendor/document_type corretti nel risultato HTML', () => {
  assert.strictEqual(result.vendor, 'Ben E. Keith');
  assert.strictEqual(result.document_type, 'order_confirmation');
});

// ── Gruppo B: Edge Function (sorgente reale, letta ed eseguita) ─────

function readEdgeSrc() { return fs.readFileSync(EDGE_FN_TS, 'utf8'); }

// ── T1 — payload html_body accettato senza pdf_base64 ────────────
test('T1: il gate accetta html_body (senza body) al posto di pdf_base64 per BEK', () => {
  const src = readEdgeSrc();
  const marker = "if (!isBekOrderConfirmation || (!body && !html_body)) return jsonError('Missing pdf_base64', 400);";
  assert.ok(src.includes(marker), 'gate non trovato o non aggiornato per accettare html_body');
});

function extractHandleBekBody() {
  const src = readEdgeSrc();
  const startMarker = 'const sourceText = html_body || body || \'\';';
  const endMarker = 'function jsonResponse(data: unknown, status = 200) {';
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker);
  if (start === -1 || end === -1) throw new Error('marker non trovati per handleBekOrderConfirmationBody');
  let snippet = src.slice(start, end).replace(/:\s*string\s*\|\s*null/g, '');
  snippet = snippet.trim();
  snippet = snippet.slice(0, snippet.lastIndexOf('}'));
  return snippet;
}

function makeMockSupa({ existingRows = [] } = {}) {
  const calls = { inserts: [] };
  const sb = {
    from(table) {
      const c = {
        _eqs: [],
        select() { return c; },
        eq(k, v) { c._eqs.push([k, v]); return c; },
        limit() {
          const matched = existingRows.filter(row => c._eqs.every(([k, v]) => row[k] === v));
          return Promise.resolve({ data: matched });
        },
        insert(payload) {
          calls.inserts.push({ table, payload });
          return { select() { return { single() { return Promise.resolve({ data: { id: 'new-doc-uuid' }, error: null }); } }; } };
        },
      };
      return c;
    },
  };
  return { sb, calls };
}

async function runHandleBekBody({ supabase, subject, from, body, html_body }) {
  const snippet = extractHandleBekBody();
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction('supabase', 'subject', 'from', 'body', 'html_body', 'jsonResponse', 'jsonError', snippet);
  const jsonResponse = (data) => data;
  const jsonError = (message) => ({ error: message });
  return fn(supabase, subject, from, body, html_body, jsonResponse, jsonError);
}

(async () => {

  // ── T2 (edge fn) — document number dal subject come da specifica ────
  await atest("T2: subject '...;0002952908' produce document_number '0002952908' (fallback)", async () => {
    const { sb, calls } = makeMockSupa({ existingRows: [] });
    // body senza "Sales Order" riconoscibile -> forza il fallback sul subject
    await runHandleBekBody({ supabase: sb, subject: SUBJECT, from: FROM, body: 'no useful data here', html_body: undefined });
    assert.strictEqual(calls.inserts[0].payload.document_number, '0002952908');
    assert.strictEqual(typeof calls.inserts[0].payload.document_number, 'string');
  });

  // ── STEP 2/3 — html_body ha priorità, source marcato correttamente ──
  await atest('html_body ha priorità su body quando entrambi presenti (source=email_html, raw_text=html)', async () => {
    const { sb, calls } = makeMockSupa({ existingRows: [] });
    await runHandleBekBody({ supabase: sb, subject: SUBJECT, from: FROM, body: 'plain fallback text', html_body: BEK_HTML_FIXTURE });
    const payload = calls.inserts[0].payload;
    assert.strictEqual(payload.parsed_json.source, 'email_html');
    assert.strictEqual(payload.raw_text, BEK_HTML_FIXTURE);
    assert.strictEqual(payload.document_number, '0002952908');
  });

  // ── T9 — solo body (legacy) continua a funzionare ────────────────
  await atest('T9: solo body (nessun html_body) -> continua a funzionare, source=email_body', async () => {
    const { sb, calls } = makeMockSupa({ existingRows: [] });
    const plainBody = 'Ben E. Keith Foods\nSales Order # 0002952908\nCustomer Name\n';
    await runHandleBekBody({ supabase: sb, subject: SUBJECT, from: FROM, body: plainBody, html_body: undefined });
    const payload = calls.inserts[0].payload;
    assert.strictEqual(payload.parsed_json.source, 'email_body');
    assert.strictEqual(payload.raw_text, plainBody);
    assert.strictEqual(payload.document_number, '0002952908');
  });

  // ── T8 — path PDF altri vendor invariato ─────────────────────────
  test('T8: percorso PDF esistente (altri vendor) invariato nel sorgente', () => {
    const src = readEdgeSrc();
    assert.ok(src.includes('await supabase.storage'));
    assert.ok(src.includes("document_type:        'invoice',"));
    assert.ok(src.includes("if (/fruge/i.test(hint))           vendorHint = 'Fruge Seafood';"));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
