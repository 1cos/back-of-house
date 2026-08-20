// ══════════════════════════════════════════════════════════════════
// init() — parallelize loadItemAlerts/loadTodayLogs/loadRecentCounts
// (BOH OS PERF P2)
// Plain Node: `node tests/perf-p2-init-parallel.test.js`
//
// Esegue il VERO snippet estratto da js/init.js (marker-based, non una
// riscrittura) con mock strumentati a tempo, per dimostrare concorrenza
// reale (non solo "tutte chiamate"), barrier corretta, e parità di
// semantica di errore rispetto al codice sequenziale precedente.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const INIT_JS = path.join(__dirname, '..', 'js', 'init.js');
const PREP_JS = path.join(__dirname, '..', 'js', 'prep.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }
async function atest(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }

console.log('\ninit() — loadItemAlerts/loadTodayLogs/loadRecentCounts in parallelo (PERF P2) — test run\n');

const initSrc = fs.readFileSync(INIT_JS, 'utf8');
const prepSrc = fs.readFileSync(PREP_JS, 'utf8');

// ── Estrae il VERO blocco di init() che orchestra le 3 chiamate ──────
function extractParallelBlock() {
  const startMarker = 'await ensureChiusuraStation();';
  const endMarker = 'await Promise.all(_p2cJobs);';
  const start = initSrc.indexOf(startMarker);
  const end = initSrc.indexOf(endMarker);
  if (start === -1 || end === -1) throw new Error('blocco parallelo non trovato in init() — la forma è cambiata?');
  return initSrc.slice(start, end + endMarker.length);
}

// ── Verifica strutturale: le 3 chiamate sono in un unico Promise.all ──
test("verifica riga reale: loadItemAlerts/loadTodayLogs/loadRecentCounts entrano tutte in _p2cJobs prima di un unico await Promise.all", () => {
  const block = extractParallelBlock();
  assert.ok(block.includes('loadItemAlerts()'), 'loadItemAlerts() deve essere invocata');
  assert.ok(block.includes('loadTodayLogs()'), 'loadTodayLogs() deve essere invocata');
  assert.ok(block.includes('loadRecentCounts()'), 'loadRecentCounts() deve essere invocata');
  assert.ok(block.includes('Promise.all(_p2cJobs)'), 'le tre devono confluire in un unico Promise.all');
  // Nessuna delle tre deve avere un proprio "await" individuale residuo (sarebbe sequenziale)
  assert.ok(!/await loadItemAlerts\(\);/.test(block), 'loadItemAlerts non deve più essere await-ata singolarmente');
  assert.ok(!/await loadTodayLogs\(\);/.test(block), 'loadTodayLogs non deve più essere await-ata singolarmente');
  assert.ok(!/await loadRecentCounts\(\);/.test(block), 'loadRecentCounts non deve più essere await-ata singolarmente');
});

test('verifica riga reale: ensureChiusuraStation() resta al suo posto, invariata, PRIMA del blocco parallelo', () => {
  assert.ok(initSrc.includes('await ensureChiusuraStation();'), 'la chiamata deve restare in init.js');
  assert.ok(prepSrc.includes('async function ensureChiusuraStation(){'), 'ensureChiusuraStation deve restare definita in prep.js');
  assert.ok(prepSrc.includes('async function ensureChiusuraStation(){\n  const exists = items.some(i=>i.category===\'Chiusura\');\n  if(!exists && isAdmin()){}\n}'),
    'il corpo di ensureChiusuraStation deve restare byte-identico (non toccata da questo task)');
});

test('verifica riga reale: loadTodayLogs() NON è stata modificata internamente (nessun cambiamento a loadSuggestions/loadDailyTrustData)', () => {
  const marker = "async function loadTodayLogs(){";
  const start = prepSrc.indexOf(marker);
  assert.ok(start > -1, 'loadTodayLogs non trovata');
  const end = prepSrc.indexOf('\nfunction getTodayLogsFor', start);
  const body = prepSrc.slice(start, end);
  assert.ok(body.includes('await loadSuggestions();'), 'la chiamata a loadSuggestions() interna deve restare identica — non toccata in questo task');
  assert.ok(body.includes("loadDailyTrustData().then("), 'loadDailyTrustData deve restare fire-and-forget, invariata');
});

// ── Mock strumentati a tempo — misurano start/end reali di ciascun job ──
function buildTimedMocks(delays) {
  const events = [];
  function mk(name) {
    return async function () {
      events.push({ name, evt: 'start', t: Date.now() });
      await new Promise(r => setTimeout(r, delays[name]));
      events.push({ name, evt: 'end', t: Date.now() });
    };
  }
  return {
    events,
    loadItemAlerts: mk('loadItemAlerts'),
    loadTodayLogs: mk('loadTodayLogs'),
    loadRecentCounts: mk('loadRecentCounts'),
  };
}

async function runRealBlock(mocks, extraGlobals) {
  const block = extractParallelBlock();
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction(
    'ensureChiusuraStation', 'loadItemAlerts', 'loadTodayLogs', 'loadRecentCounts',
    block
  );
  return fn(async () => {}, mocks.loadItemAlerts, mocks.loadTodayLogs, mocks.loadRecentCounts);
}

(async () => {

  // ── T1 — Concorrenza reale: i tre job partono prima che uno finisca ──
  await atest('T1: loadItemAlerts/loadTodayLogs/loadRecentCounts partono in concorrenza reale — non uno dopo la fine dell\'altro', async () => {
    const mocks = buildTimedMocks({ loadItemAlerts: 60, loadTodayLogs: 120, loadRecentCounts: 90 });
    await runRealBlock(mocks);
    const byEvt = (name, evt) => mocks.events.find(e => e.name === name && e.evt === evt).t;
    const startItemAlerts = byEvt('loadItemAlerts', 'start');
    const startTodayLogs  = byEvt('loadTodayLogs', 'start');
    const startRecent     = byEvt('loadRecentCounts', 'start');
    const endItemAlerts   = byEvt('loadItemAlerts', 'end');
    // La prova di vera concorrenza: loadTodayLogs e loadRecentCounts sono
    // PARTITE prima che loadItemAlerts (il job più corto) sia FINITO —
    // impossibile se fossero sequenziali (in sequenza, todayLogs partirebbe
    // solo dopo endItemAlerts).
    assert.ok(startTodayLogs <= endItemAlerts, `loadTodayLogs deve partire prima che loadItemAlerts finisca (partita: ${startTodayLogs}, fine itemAlerts: ${endItemAlerts})`);
    assert.ok(startRecent <= endItemAlerts, `loadRecentCounts deve partire prima che loadItemAlerts finisca (partita: ${startRecent}, fine itemAlerts: ${endItemAlerts})`);
    // Tutti e tre gli "start" devono cadere in una finestra ravvicinata (stesso tick di avvio)
    const starts = [startItemAlerts, startTodayLogs, startRecent];
    assert.ok(Math.max(...starts) - Math.min(...starts) < 30, 'i tre job devono partire praticamente insieme (finestra <30ms), non a catena');
  });

  // ── T2 — Barrier finale: nulla dopo il Promise.all parte prima che tutti e 3 siano finiti ──
  await atest('T2: il codice dopo Promise.all (barrier) non parte finché tutti e 3 i job non sono conclusi', async () => {
    const mocks = buildTimedMocks({ loadItemAlerts: 30, loadTodayLogs: 150, loadRecentCounts: 60 });
    let barrierTime = null;
    const block = extractParallelBlock() + '\nbarrierMark();';
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction('ensureChiusuraStation', 'loadItemAlerts', 'loadTodayLogs', 'loadRecentCounts', 'barrierMark', block);
    await fn(async () => {}, mocks.loadItemAlerts, mocks.loadTodayLogs, mocks.loadRecentCounts, () => { barrierTime = Date.now(); });
    const endTimes = ['loadItemAlerts', 'loadTodayLogs', 'loadRecentCounts'].map(n => mocks.events.find(e => e.name === n && e.evt === 'end').t);
    const lastEnd = Math.max(...endTimes);
    assert.ok(barrierTime >= lastEnd, `la barrier deve scattare DOPO l'ultimo job concluso (barrier: ${barrierTime}, ultimo end: ${lastEnd})`);
  });

  // ── T3 — Failure semantics: parità col comportamento sequenziale attuale ──
  await atest('T3a: le tre funzioni reali si auto-proteggono (try/catch interno) — un errore non fa mai rigettare la Promise, né prima né dopo questo task', () => {
    const liaSrc = prepSrc.slice(prepSrc.indexOf('async function loadItemAlerts(){'), prepSrc.indexOf('\n// Set di prep_task_id'));
    const lrcSrc = prepSrc.slice(prepSrc.indexOf('async function loadRecentCounts() {'), prepSrc.indexOf('\n// Helper: ritorna il count recente'));
    assert.ok(/catch\s*\(e\)\s*\{/.test(liaSrc), 'loadItemAlerts deve avere try/catch interno (invariato)');
    assert.ok(/catch\s*\(e\)\s*\{/.test(lrcSrc), 'loadRecentCounts deve avere try/catch interno (invariato)');
    // loadSuggestions (chiamata da loadTodayLogs) si auto-protegge a sua volta
    const lsSrc = prepSrc.slice(prepSrc.indexOf('async function loadSuggestions() {'), prepSrc.indexOf('\n// ── DAILY TRUST DATA LOADER'));
    assert.ok(/catch\s*\(e\)\s*\{/.test(lsSrc), 'loadSuggestions deve avere try/catch interno (invariato, non toccata in questo task)');
  });

  await atest('T3b: con le implementazioni reali (self-catching), un fallimento simulato in una fetch interna NON fa rigettare il Promise.all — comportamento equivalente al sequenziale di prima', async () => {
    // Simula esattamente il pattern reale: try{ ...throw... }catch(e){} — la funzione
    // risolve comunque, non rigetta mai (stesso identico comportamento che aveva
    // ciascun await individuale prima di questo task).
    const selfProtecting = async () => { try { throw new Error('simulated fetch failure'); } catch (e) { /* swallow, come nel codice reale */ } };
    const mocks = { loadItemAlerts: selfProtecting, loadTodayLogs: async () => {}, loadRecentCounts: async () => {} };
    await assert.doesNotReject(() => runRealBlock(mocks), 'con funzioni self-protecting (come quelle reali), Promise.all non deve mai rigettare');
  });

  await atest('T3c: nota di parità documentata — SE in futuro una delle tre venisse modificata per rigettare davvero, il Promise.all abortirebbe (fail-fast) esattamente come la sequenza await originale avrebbe fatto per i passi successivi', async () => {
    const rejecting = async () => { throw new Error('hypothetical real rejection'); };
    const mocks = { loadItemAlerts: rejecting, loadTodayLogs: async () => {}, loadRecentCounts: async () => {} };
    await assert.rejects(() => runRealBlock(mocks), /hypothetical real rejection/, 'un vero reject deve propagarsi — nessuno swallowing introdotto da questo task');
  });

  // ── Timing simulato — miglioramento controllato (non numeri production) ──
  test('MISURA: timing simulato sequenziale vs parallelo con le stesse 3 latenze fittizie', () => {
    const A = 200, B = 400, C = 250;
    const sequenziale = A + B + C;
    const parallelo = Math.max(A, B, C);
    console.log(`      Prima (sequenziale simulato): A ${A}ms + B ${B}ms + C ${C}ms ≈ ${sequenziale}ms`);
    console.log(`      Dopo  (parallelo simulato):    max(${A},${B},${C}) ≈ ${parallelo}ms`);
    console.log(`      Miglioramento teorico: -${sequenziale - parallelo}ms (${Math.round((1 - parallelo/sequenziale)*100)}%)`);
    assert.ok(parallelo < sequenziale);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
