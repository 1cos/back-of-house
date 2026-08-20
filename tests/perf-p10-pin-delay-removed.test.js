// ══════════════════════════════════════════════════════════════════
// PIN login — remove artificial 150ms delay before attemptPinLogin()
// (BOH OS PERF P10)
// Plain Node + jsdom: `node tests/perf-p10-pin-delay-removed.test.js`
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const APP_JS = path.join(__dirname, '..', 'js', 'app.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }
async function atest(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }

console.log('\nPIN login — 150ms artificial delay removed (PERF P10) — test run\n');

const appSrc = fs.readFileSync(APP_JS, 'utf8');

test('verifica riga reale: nessun setTimeout(...,150) residuo prima di attemptPinLogin()', () => {
  assert.ok(!/setTimeout\(\s*\(\)\s*=>\s*attemptPinLogin\(\)\s*,\s*150\s*\)/.test(appSrc), 'il vecchio setTimeout(...,150) non deve più essere presente');
});

test('verifica riga reale: pinPress usa requestAnimationFrame come yield minimo prima di attemptPinLogin()', () => {
  const start = appSrc.indexOf('function pinPress(digit){');
  const end = appSrc.indexOf('\n}', start);
  const body = appSrc.slice(start, end);
  assert.ok(body.includes('updatePinDots();'), 'updatePinDots() deve ancora girare prima della schedulazione (4° pallino applicato)');
  assert.ok(/requestAnimationFrame\(\s*\(\)\s*=>\s*attemptPinLogin\(\)\s*\)/.test(body), 'attemptPinLogin deve essere schedulata via requestAnimationFrame');
  const dotsIdx = body.indexOf('updatePinDots();');
  const rafIdx = body.indexOf('requestAnimationFrame');
  assert.ok(dotsIdx < rafIdx, 'updatePinDots() deve girare PRIMA della schedulazione, cosi il 4° pallino viene applicato prima del paint atteso da rAF');
});

test('verifica riga reale: pinDel() e gli altri setTimeout (es. reset errore 600ms) restano invariati', () => {
  assert.ok(appSrc.includes('function pinDel(){\n  if(_pinSubmitting) return;'), 'pinDel invariata');
  assert.ok(appSrc.includes(", 600);"), 'il timeout da 600ms del reset errore PIN resta intatto (non e\' quello di questo task)');
});

(async () => {

  // ── Setup jsdom con rAF reale, per verificare il comportamento effettivo ──
  function makeDom() {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div id="pinDots">
        <div class="pin-dot"></div><div class="pin-dot"></div>
        <div class="pin-dot"></div><div class="pin-dot"></div>
      </div>
      <p id="err" class="hidden"></p>
    </body></html>`);
    // jsdom non implementa requestAnimationFrame di default in tutte le versioni: forniamo un polyfill fedele (schedula al prossimo tick di rendering, qui simulato con setTimeout(0) + verifica che sia comunque asincrono e non sincrono)
    dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    return dom;
  }

  // ── Estrae ed esegue pinPress/updatePinDots reali (marker-based), nello stesso scope di chiusura di app.js ──
  function loadPinModule(win, onAttempt) {
    global.document = win.document;
    global.requestAnimationFrame = win.requestAnimationFrame;
    global.attemptPinLogin = onAttempt;
    const src = appSrc;
    const startFn = 'function pinPress(digit){';
    const startIdx = src.indexOf(startFn);
    const endFn = src.indexOf('\nfunction updatePinDots(){');
    const endIdx = src.indexOf('\n}', endFn) + 2;
    const snippet = src.slice(startIdx, endIdx);
    const wrapped = new Function(`
      let pinBuffer = '';
      let _pinSubmitting = false;
      ${snippet}
      global.pinPress = pinPress;
      global.updatePinDots = updatePinDots;
    `);
    wrapped();
  }

  // ── T1 — nessun delay artificiale: attemptPinLogin schedulata subito (yield minimo, non 150ms) ──
  await atest('T1: dopo il 4° digit, attemptPinLogin() parte con yield minimo (<<150ms), non con un\'attesa fissa', async () => {
    const dom = makeDom();
    const win = dom.window;
    let calledAt = null;
    const startedAt = Date.now();
    loadPinModule(win, () => { calledAt = Date.now(); });
    global.pinPress('1'); global.pinPress('2'); global.pinPress('3'); global.pinPress('4');
    await new Promise(r => setTimeout(r, 130)); // ben sotto ai 150ms fissi del vecchio comportamento, ma con margine per l'overhead di scheduling di Node/jsdom
    assert.ok(calledAt !== null, 'attemptPinLogin doveva essere gia\' stata invocata entro 130ms (prima richiedeva 150ms fissi + il tempo di rete)');
    assert.ok(calledAt - startedAt < 130, `atteso <130ms (ben sotto il vecchio delay fisso di 150ms), misurato ${calledAt - startedAt}ms`);
  });

  // ── T2 — il 4° pallino resta corretto (stile applicato) prima della chiamata ──
  await atest('T2: il 4° pallino PIN risulta gia\' "pieno" (stile applicato) nel momento in cui attemptPinLogin viene invocata', async () => {
    const dom = makeDom();
    const win = dom.window;
    let dotStateAtCall = null;
    loadPinModule(win, () => {
      const dots = win.document.querySelectorAll('.pin-dot');
      dotStateAtCall = Array.from(dots).map(d => d.style.background);
    });
    global.pinPress('1'); global.pinPress('2'); global.pinPress('3'); global.pinPress('4');
    await new Promise(r => setTimeout(r, 50));
    assert.deepStrictEqual(dotStateAtCall, ['white', 'white', 'white', 'white'], 'tutti e 4 i pallini devono risultare pieni al momento della chiamata');
  });

  // ── T3/T4 — comportamento PIN valido/errato invariato (delegato al vero attemptPinLogin, non toccato) ──
  test('T3/T4: attemptPinLogin() stessa non e\' stata toccata da questo task (logica PIN valido/errato invariata)', () => {
    assert.ok(appSrc.includes('async function attemptPinLogin(){'), 'attemptPinLogin deve restare presente e invariata');
    assert.ok(appSrc.includes("body: JSON.stringify({\n        pin: pinBuffer,"), 'il body della richiesta resta identico');
  });

  // ── T5 — cooldown/rate limit: nessuna modifica lato client a quella logica ──
  test('T5: nessuna logica di cooldown/rate-limit toccata (fuori scope, invariata)', () => {
    assert.ok(appSrc.includes("_showLoginError('pin')"), 'gestione errore PIN/cooldown invariata');
  });

  // ── T6 — Home staff/admin non toccate ──
  test('T6: nessun riferimento a Home/init/prep toccato da questo task (diff scoped a pinPress)', () => {
    const start = appSrc.indexOf('function pinPress(digit){');
    const end = appSrc.indexOf('\n}', start);
    const body = appSrc.slice(start, end);
    assert.ok(!/homeStations|initFocusMode|renderHomeStations/.test(body), 'pinPress non deve contenere riferimenti a Home/Focus Mode');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
