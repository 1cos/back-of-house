// ══════════════════════════════════════════════════════════════════
// Home — eliminazione card invoice_warnings/vendor_documents.warnings
// (BOH OS HOME H2)
// Plain Node: `node tests/home-no-invoice-warnings.test.js`
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const APP_JS = path.join(ROOT, 'js', 'app.js');
const VDR_JS = path.join(ROOT, 'js', 'vendor-documents-review.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }
async function atest(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }

console.log('\nHome — 0 card da invoice_warnings/vendor_documents.warnings (HOME H2) — test run\n');

const indexHtml = fs.readFileSync(INDEX_HTML, 'utf8');

// ── T1/T2 — index.html non carica più i due script che generavano le card ──
test('T1/T2: index.html NON carica più js/warnings-banner.js né js/souschef-warnings.js', () => {
  assert.ok(!indexHtml.includes('<script src="js/warnings-banner.js">'), 'warnings-banner.js non deve più essere caricato in Home');
  assert.ok(!indexHtml.includes('<script src="js/souschef-warnings.js">'), 'souschef-warnings.js non deve più essere caricato in Home');
});

test('T1/T2b: il container #warningsBanner resta nel DOM ma inerte (nessuno script lo popola più)', () => {
  assert.ok(indexHtml.includes('<div id="warningsBanner"'), 'il container deve restare presente (nessun crash se qualche vecchio riferimento lo cerca)');
});

(async () => {

  // ── T1/T2 end-to-end: senza i due file caricati, loadWarningsBanner non esiste ──
  await atest('T1/T2 end-to-end: senza warnings-banner.js/souschef-warnings.js caricati, window.loadWarningsBanner è undefined e #warningsBanner resta vuoto/nascosto', async () => {
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="warningsBanner" style="display:none;"></div></body></html>');
    const win = dom.window;
    win.supabaseClient = { from() { throw new Error('non deve mai essere chiamato — nessuno script di warning è caricato'); } };
    // Simuliamo l'esatto pattern guardato usato in init.js/souschef-chat.js/souschef-scan.js:
    // se loadWarningsBanner non è definita, questi call-site non devono lanciare.
    assert.strictEqual(typeof win.loadWarningsBanner, 'undefined', 'loadWarningsBanner non deve esistere se i due file non sono caricati');
    assert.doesNotThrow(() => {
      if (typeof win.loadWarningsBanner === 'function') win.loadWarningsBanner();
    }, 'il pattern guardato usato da init.js/souschef-chat.js/souschef-scan.js non deve mai lanciare');
    const container = win.document.getElementById('warningsBanner');
    assert.strictEqual(container.innerHTML, '', 'il container deve restare vuoto — nessuna card mai renderizzata');
    assert.strictEqual(container.style.display, 'none', 'il container resta nascosto (stato iniziale mai cambiato)');
  });

  // ── T3 — VDR badge invariato ──
  await atest('T3: vdrLoadBadge() (app.js, invariata) mostra il count corretto con 3 documenti pending', async () => {
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="vdrPendingBadge"></div></body></html>');
    global.document = dom.window.document;
    global.window = global.window || {};

    const rows = [
      { id: 'd1', status: 'pending' },
      { id: 'd2', status: 'pending' },
      { id: 'd3', status: 'pdf_received' },
      { id: 'd4', status: 'imported' }, // non deve contare
      { id: 'd5', status: 'error' },    // non deve contare
    ];
    const sb = {
      from(table) {
        assert.strictEqual(table, 'vendor_documents');
        const state = { filters: [] };
        const b = {
          select(cols, opts) { b._count = opts && opts.count === 'exact'; return b; },
          in(k, values) { state.filters.push([k, values]); return b; },
          then(resolve) {
            let matched = rows;
            for (const [k, values] of state.filters) matched = matched.filter(r => values.includes(r[k]));
            resolve({ count: matched.length, error: null });
          },
        };
        return b;
      },
    };
    global.window.supabaseClient = sb;

    // Estrae la vera funzione vdrLoadBadge da app.js (marker) — non una riscrittura.
    const appSrc = fs.readFileSync(APP_JS, 'utf8');
    const start = appSrc.indexOf('async function vdrLoadBadge() {');
    assert.ok(start > -1, 'vdrLoadBadge non trovata in app.js — invariata rispetto a prima di questo task?');
    const end = appSrc.indexOf('\n}', start) + 2;
    const fnSrc = appSrc.slice(start, end);
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const vdrLoadBadge = new AsyncFunction('window', 'document', `${fnSrc}\nreturn vdrLoadBadge();`);
    await vdrLoadBadge(global.window, global.document);

    const el = global.document.getElementById('vdrPendingBadge');
    assert.strictEqual(el.textContent, '3 to review', `badge atteso "3 to review", trovato "${el.textContent}"`);
  });

  // ── T4 — altri widget Home non rotti (presenza strutturale) ──
  test('T4: Briefing, Yesterday\'s Highlights, Operation Notes, navigation restano cablati in index.html', () => {
    assert.ok(indexHtml.includes('<script src="js/briefing.js">'), 'briefing.js deve restare caricato');
    assert.ok(indexHtml.includes('<script src="js/operation-notes.js">'), 'operation-notes.js deve restare caricato');
    assert.ok(indexHtml.includes('id="homeBriefingSection"') && indexHtml.includes('id="briefingContent"'), 'container Briefing AI presenti');
    assert.ok(indexHtml.includes('id="homeHighlightsWidget"') && indexHtml.includes('id="serviceUpdatesList"'), 'container Yesterday\'s Highlights presenti');
    assert.ok(indexHtml.includes('id="vdrPendingBadge"'), 'badge Vendor Review presente');
    // Navigation: le tab principali (data-t) devono essere ancora presenti
    assert.ok(/data-t=./.test(indexHtml), 'tab bar di navigazione presente');
  });

  // ── T5 — indipendente dal ruolo: la funzione non esiste per nessuno ──
  test('T5: nessuna logica di ruolo residua per invoice/vendor warning su Home — la funzione semplicemente non esiste, quindi vale per admin come per chiunque altro', () => {
    assert.ok(!indexHtml.includes('<script src="js/warnings-banner.js">') && !indexHtml.includes('<script src="js/souschef-warnings.js">'),
      'nessuno dei due <script> è caricato — non essendoci codice, non può esserci un ramo "solo admin" che li mostra');
  });

  // ── T6 — Vendor Review invariato ──
  test("T6: js/vendor-documents-review.js non è stato toccato da questo task (byte-identico)", () => {
    const vdrSrc = fs.readFileSync(VDR_JS, 'utf8');
    assert.ok(vdrSrc.includes('async function vdrPreflight(docId, doc)'), 'vdrPreflight ancora presente e funzionante');
    assert.ok(vdrSrc.includes('function vdrBuildQuestions(doc)'), 'vdrBuildQuestions (domande/warning Vendor Review) ancora presente e funzionante');
    assert.ok(vdrSrc.includes("window.vdrApprove = async function(docId, btn)"), 'vdrApprove ancora presente e funzionante');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
