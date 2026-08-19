// ══════════════════════════════════════════════════════════════════
// BEK — fix DOC DATE/DELIVERY non mostrate in Vendor Review (BOH OS Task 11L)
// Plain Node, zero dipendenze esterne: `node tests/bek-date-mapping-fix.test.js`
//
// Esegue i parser reali (js/vendor-parser-ui.js) e la logica reale di
// mapping/persistenza (js/vendor-documents-review.js, estratta con marker
// espliciti) — non una riscrittura della logica.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const VP_UI_JS = path.join(__dirname, '..', 'js', 'vendor-parser-ui.js');
const VDR_JS = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');
const { BEK_HTML_FIXTURE } = require('./fixtures/bek-html-sample.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); } }

// ── Stesso mini-DOMParser (test-only) usato in bek-html-order-confirmation.test.js ──
function decodeEntities(str) {
  return str.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&copy;/g, '©').replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}
function parseHtmlTree(html) {
  const voidTags = new Set(['br', 'img', 'hr', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);
  const openTagRe = /^<([a-zA-Z0-9]+)((?:\s+[a-zA-Z0-9_-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]*))?)*)\s*(\/?)>/;
  const closeTagRe = /^<\/([a-zA-Z0-9]+)\s*>/;
  let i = 0; const n = html.length;
  const root = { tagName: '#root', childNodes: [] };
  const stack = [root]; let current = root;
  while (i < n) {
    if (html.startsWith('<!--', i)) { const end = html.indexOf('-->', i); i = end === -1 ? n : end + 3; continue; }
    if (html[i] === '<') {
      if (html[i + 1] === '!') { const end = html.indexOf('>', i); i = end === -1 ? n : end + 1; continue; }
      if (html[i + 1] === '/') {
        const m = closeTagRe.exec(html.slice(i));
        if (m) {
          const tag = m[1].toLowerCase();
          for (let s = stack.length - 1; s >= 1; s--) { if (stack[s].tagName.toLowerCase() === tag) { stack.length = s; current = stack[stack.length - 1]; break; } }
          i += m[0].length; continue;
        }
        i++; continue;
      }
      const m = openTagRe.exec(html.slice(i));
      if (!m) { i++; continue; }
      const tagLower = m[1].toLowerCase();
      const selfClosing = m[3] === '/' || voidTags.has(tagLower);
      i += m[0].length;
      const el = { tagName: tagLower.toUpperCase(), childNodes: [] };
      current.childNodes.push(el);
      if (!selfClosing) { stack.push(el); current = el; }
      continue;
    }
    const nextLt = html.indexOf('<', i);
    const text = nextLt === -1 ? html.slice(i) : html.slice(i, nextLt);
    if (text) current.childNodes.push({ isText: true, text });
    i = nextLt === -1 ? n : nextLt;
  }
  return root;
}
function elChildren(el) { return el.childNodes.filter(c => !c.isText); }
function elTextContent(el) { let out = ''; for (const c of el.childNodes) out += c.isText ? c.text : elTextContent(c); return decodeEntities(out); }
function findAllByTag(el, tagUpper, acc) { acc = acc || []; for (const c of elChildren(el)) { if (c.tagName === tagUpper) acc.push(c); findAllByTag(c, tagUpper, acc); } return acc; }
function wrapEl(el) {
  return {
    tagName: el.tagName,
    get children() { return elChildren(el).map(wrapEl); },
    get textContent() { return elTextContent(el); },
    querySelectorAll(sel) { if (sel === 'table tr' || sel === 'td') return findAllByTag(el, sel === 'td' ? 'TD' : 'TR').map(wrapEl); return []; },
  };
}
class MiniDOMParser {
  parseFromString(html) {
    const root = parseHtmlTree(String(html || ''));
    const bodyMatches = findAllByTag(root, 'BODY');
    const bodyEl = bodyMatches[0] || root;
    return { body: wrapEl(bodyEl), querySelectorAll(sel) { return sel === 'table tr' ? findAllByTag(root, 'TR').map(wrapEl) : []; } };
  }
}
global.DOMParser = MiniDOMParser;
global.window = global.window || {};

function loadRealBrowserParsers() {
  const src = fs.readFileSync(VP_UI_JS, 'utf8');
  const startMarker = 'function buildVendorParsers() {';
  const endMarker = '// ── BRIDGE: Parser result → Invoice Import pipeline ───────────';
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker);
  if (start === -1 || end === -1) throw new Error('marker non trovati in js/vendor-parser-ui.js');
  return new Function(src.slice(start, end) + '\nreturn buildVendorParsers();')();
}

// Estrae la vera logica di mapping data + persistenza (righe reali di
// vendor-documents-review.js), non una riscrittura.
function extractDateMappingLogic() {
  const src = fs.readFileSync(VDR_JS, 'utf8');
  const startMarker = "const docDate   = parsed.order_date   || parsed.credit_date   || parsed.delivery_date || null;";
  const marker2 = 'document_date:   docDate,';
  const marker3 = 'delivery_date:   parsed.delivery_date || null,';
  if (!src.includes(startMarker) || !src.includes(marker2) || !src.includes(marker3)) {
    throw new Error('righe di mapping data non trovate o cambiate in vendor-documents-review.js');
  }
  return { docDateLine: startMarker, insertDocumentDate: marker2, insertDeliveryDate: marker3 };
}
function computePersistedDates(parsed) {
  const { docDateLine } = extractDateMappingLogic();
  const fn = new Function('parsed', docDateLine + '\nreturn docDate;');
  const docDate = fn(parsed);
  const deliveryDate = parsed.delivery_date || null; // riga reale: delivery_date: parsed.delivery_date || null,
  return { document_date: docDate, delivery_date: deliveryDate };
}

function extractVdrFmtDate() {
  const src = fs.readFileSync(VDR_JS, 'utf8');
  const startMarker = 'function vdrFmtDate(d) {';
  const start = src.indexOf(startMarker);
  const end = src.indexOf('\n}\n', start) + 3;
  const snippet = src.slice(start, end);
  return new Function(snippet + '\nreturn vdrFmtDate;')();
}

console.log('\nBEK — fix mapping DOC DATE / DELIVERY — test run\n');

const browserParsers = loadRealBrowserParsers();

// ── T1 — parser BEK: 08/20/2026 → document_date = 2026-08-20 ────────
test('T1: parser BEK HTML — 08/20/2026 produce document_date=2026-08-20', () => {
  const result = browserParsers.parseBekOrderConfirmationHtml(BEK_HTML_FIXTURE);
  assert.strictEqual(result.document_date, '2026-08-20');
});

// ── T2 — il processing persiste la data nella chiave che la UI legge ──
test('T2: docDate/delivery_date calcolati da vendor-documents-review.js sono valorizzati per un risultato BEK (non null)', () => {
  const parsed = browserParsers.parseBekOrderConfirmationHtml(BEK_HTML_FIXTURE);
  const persisted = computePersistedDates(parsed);
  assert.strictEqual(persisted.document_date, '2026-08-20', 'BUG: senza il fix, docDate sarebbe null (non legge parsed.document_date)');
  assert.strictEqual(persisted.delivery_date, '2026-08-20', 'BUG: senza il fix, delivery_date sarebbe null (BEK non impostava questa chiave)');
});

// ── T3 — la UI mostra "Aug 20, 2026" per DOC DATE ────────────────────
test('T3: vdrFmtDate(document_date persistito) produce "Aug 20, 2026" (quello che la UI mostra per DOC DATE)', () => {
  const vdrFmtDate = extractVdrFmtDate();
  const parsed = browserParsers.parseBekOrderConfirmationHtml(BEK_HTML_FIXTURE);
  const persisted = computePersistedDates(parsed);
  assert.strictEqual(vdrFmtDate(persisted.document_date), 'Aug 20, 2026');
});

// ── T4 — DELIVERY = Aug 20, 2026 ──────────────────────────────────────
test('T4: vdrFmtDate(delivery_date persistito) produce "Aug 20, 2026" (quello che la UI mostra per DELIVERY)', () => {
  const vdrFmtDate = extractVdrFmtDate();
  const parsed = browserParsers.parseBekOrderConfirmationHtml(BEK_HTML_FIXTURE);
  const persisted = computePersistedDates(parsed);
  assert.strictEqual(vdrFmtDate(persisted.delivery_date), 'Aug 20, 2026');
});

// ── T5 — altri vendor invariati ───────────────────────────────────────
test("T5: la logica docDate/delivery_date in vendor-documents-review.js non è stata toccata (nessuna regressione sugli altri vendor)", () => {
  const src = fs.readFileSync(VDR_JS, 'utf8');
  assert.ok(src.includes("const docDate   = parsed.order_date   || parsed.credit_date   || parsed.delivery_date || null;"), 'la logica condivisa deve restare identica — il fix è solo nei due parser BEK');
});

test("T5b: parseBekOrderConfirmationEmail (plain-body, legacy) riceve lo stesso fix — coerenza tra i due parser BEK", () => {
  const bodyFixture = 'Ben E. Keith Foods\nSales Order # 0002952908\nDelivery Date 08/20/2026\nCustomer Name\n';
  const parsed = browserParsers.parse(bodyFixture);
  const persisted = computePersistedDates(parsed);
  assert.strictEqual(persisted.document_date, '2026-08-20');
  assert.strictEqual(persisted.delivery_date, '2026-08-20');
});

// ── T6 — regressione mirata: struttura output BEK invariata a parte le nuove date ──
test('T6: la struttura del risultato BEK resta compatibile (vendor/document_type/document_number/items invariati)', () => {
  const result = browserParsers.parseBekOrderConfirmationHtml(BEK_HTML_FIXTURE);
  assert.strictEqual(result.vendor, 'Ben E. Keith');
  assert.strictEqual(result.document_type, 'order_confirmation');
  assert.strictEqual(result.document_number, '0002952908');
  assert.strictEqual(result.items.length, 2);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
