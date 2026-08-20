// ══════════════════════════════════════════════════════════════════
// DIAGNOSTIC BASELINE (PERF P1, STEP 8) — cook/staff Home "as-is" snapshot
// Plain Node: `node tests/perf-p1-staff-home-baseline.test.js`
//
// Solo lettura/asserzione strutturale: NON esegue query reali, NON avvia
// il server, NON modifica alcun file di produzione. Serve come fotografia
// di riferimento prima di un futuro cleanup Home (admin-only) — se uno di
// questi assert rompe in futuro, vuol dire che qualcosa nella Home staff
// è cambiato senza intenzione.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const APP_JS = path.join(ROOT, 'js', 'app.js');
const INIT_JS = path.join(ROOT, 'js', 'init.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }

console.log('\nPERF P1 — Staff Home baseline snapshot (diagnostic, not enforced in CI) — test run\n');

const indexHtml = fs.readFileSync(INDEX_HTML, 'utf8');
const appSrc = fs.readFileSync(APP_JS, 'utf8');
const initSrc = fs.readFileSync(INIT_JS, 'utf8');

test('BASELINE: elementi Home visibili per staff (rami "else" di doLogin) — presenti oggi', () => {
  // Questi sono gli id toccati nel ramo staff (non-admin) di doLogin() —
  // catturati come sono ORA, prima di qualunque cleanup Home futuro.
  const staffTouchedIds = ['warningsBanner', 'invoiceSection', 'homeBriefingSection', 'homeStationsTitle', 'homeStations', 'homeStationItems', 'homeOtherStations'];
  for (const id of staffTouchedIds) {
    assert.ok(appSrc.includes(`'${id}'`) || appSrc.includes(`"${id}"`), `id "${id}" atteso nel ramo staff di doLogin() — verificare se è cambiato`);
  }
});

test('BASELINE: navigazione principale (tab bar) presente in index.html', () => {
  const tabMatches = indexHtml.match(/data-t=["']?[a-z]["']?/gi) || [];
  assert.ok(tabMatches.length >= 3, `attese almeno 3 tab di navigazione, trovate ${tabMatches.length}`);
});

test('BASELINE: sequenza doLogin() — ordine delle chiamate immediatamente dopo il login (fotografia)', () => {
  const start = appSrc.indexOf('function doLogin(profile){');
  assert.ok(start > -1, 'doLogin non trovata');
  const snippet = appSrc.slice(start, start + 2000);
  // Ordine atteso oggi (fotografia, non prescrizione):
  const expectedOrderMarkers = ['init();', 'applyLang();', 'updateAlertBtn();', 'setupPush();', 'loadNews();', 'loadBriefing();', 'startPresence();'];
  let lastIdx = -1;
  for (const marker of expectedOrderMarkers) {
    const idx = snippet.indexOf(marker);
    assert.ok(idx > -1, `marker "${marker}" non trovato in doLogin() — sequenza cambiata?`);
    assert.ok(idx > lastIdx, `ordine cambiato: "${marker}" non è più dopo il marker precedente`);
    lastIdx = idx;
  }
});

test('BASELINE (aggiornata PERF P2): init() — ensureChiusuraStation() prima, poi le 3 chiamate indipendenti in un unico Promise.all', () => {
  const start = initSrc.indexOf('async function init(){');
  assert.ok(start > -1, 'init() non trovata');
  const end = initSrc.indexOf('\ndocument.getElementById(\'toggleView\')', start);
  const body = initSrc.slice(start, end > -1 ? end : start + 3000);
  const idxEnsure = body.indexOf('await ensureChiusuraStation();');
  const idxItemAlerts = body.indexOf('loadItemAlerts()');
  const idxTodayLogs = body.indexOf('loadTodayLogs()');
  const idxRecentCounts = body.indexOf('loadRecentCounts()');
  const idxBarrier = body.indexOf('await Promise.all(_p2cJobs);');
  assert.ok(idxEnsure > -1, 'ensureChiusuraStation() deve restare presente');
  assert.ok(idxItemAlerts > idxEnsure && idxTodayLogs > idxEnsure && idxRecentCounts > idxEnsure,
    'ensureChiusuraStation() deve restare PRIMA delle tre chiamate parallele');
  assert.ok(idxBarrier > idxItemAlerts && idxBarrier > idxTodayLogs && idxBarrier > idxRecentCounts,
    'le tre chiamate devono confluire in un unico Promise.all (barrier) — fotografia PERF P2');
});

test('BASELINE (aggiornata PERF P2): initFocusMode() (staff-only) resta l\'ultimo grande step di init(), dopo la barrier Promise.all', () => {
  const start = initSrc.indexOf('async function init(){');
  const focusIdx = initSrc.indexOf('initFocusMode()', start);
  const barrierIdx = initSrc.indexOf('await Promise.all(_p2cJobs);', start);
  assert.ok(focusIdx > -1 && barrierIdx > -1, 'marker non trovati');
  assert.ok(focusIdx > barrierIdx, 'initFocusMode() deve restare DOPO la barrier — fotografia dello stato attuale (non una raccomandazione)');
});

console.log(`\n${pass} passed, ${fail} failed`);
console.log('\n[baseline diagnostico — protegge la Home staff da modifiche accidentali nei task successivi]');
process.exit(fail ? 1 : 0);
