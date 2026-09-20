// ══════════════════════════════════════════════════════════════════
// CREW-UX 13 — una suggestion mirata piu' fresca deve sopravvivere al reload
// Plain Node + jsdom: `node tests/suggestion-overlay.test.js`
//
// METODO, come gli altri tests/prep-*.test.js: NON si riscrive la logica.
// Le tre parti che contano vengono ESTRATTE dal vero js/prep.js e
// valutate. Se qualcuno cambia il loader e non aggiorna questi test,
// l'estrazione fallisce subito invece di testare una copia morta.
//
// Fatto osservato che ha prodotto il fix (CREW-UX 12, task 364):
//   baseline 2026-09-19  do_first   stock 0     generated 09-19 07:06:02
//   overlay  2026-09-20  looks_ok   stock 1000  generated 09-20 22:09:16
//   futura   2026-09-21  prep_today stock 0     generated 09-20 07:06:03
// Il risultato corretto e' l'overlay, e la riga futura non deve vincere
// nonostante la suggestion_date piu' alta.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const PREP_SRC = fs.readFileSync(path.join(ROOT, 'js', 'prep.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const CREW_SRC = fs.readFileSync(path.join(ROOT, 'js', 'crew-home.js'), 'utf8');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  OK   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
}

// ── Estrazione dal sorgente reale ─────────────────────────────────
function slice(from, to, label) {
  const a = PREP_SRC.indexOf(from);
  assert.ok(a >= 0, 'sorgente non trovato in js/prep.js: ' + label + ' (inizio)');
  const b = PREP_SRC.indexOf(to, a);
  assert.ok(b >= 0, 'sorgente non trovato in js/prep.js: ' + label + ' (fine)');
  return PREP_SRC.slice(a, b + to.length);
}

const MIN_ROWS_SRC = slice('const _SUGG_MIN_ROWS =', ';', '_SUGG_MIN_ROWS');
const HELPERS_SRC  = slice('function _suggGeneratedMs(row) {', '\n}', '_suggIsFresher')
                   + slice('function _suggIsFresher(candidate, base) {', '\n}', '_suggIsFresher');
const PICK_SRC     = slice('    const counts = {};', '.map(([d]) => d)[0] || null;', 'scelta baseline');
// Ancora univoca: la riga successiva distingue il merge dal ramo
// "nessuna run valida", che apre con la stessa identica istruzione.
const MERGE_SRC    = slice('    window._suggestions     = {};\n    window._suggestionsDate = validDate;',
                           'window._suggestionsHistoryEnd = _maxHistEnd;', 'merge');

// La soglia deve restare quella di produzione: il fix non la abbassa.
const MIN_ROWS = Number((MIN_ROWS_SRC.match(/=\s*(\d+)/) || [])[1]);

// Sceglie la baseline con le righe reali del loader.
const pickBaseline = new Function('allRows', '_SUGG_MIN_ROWS',
  PICK_SRC + '\n return validDate;');

// Esegue il merge reale e restituisce cio' che il loader lascia su window.
const runMerge = new Function('window', 'data', 'validDate', '_suggIsFresher',
  MERGE_SRC + '\n return { suggestions: window._suggestions,' +
  ' historyEnd: window._suggestionsHistoryEnd, date: window._suggestionsDate };');

// Le due helper reali.
const helpers = new Function(HELPERS_SRC + '\n return { _suggGeneratedMs, _suggIsFresher };')();

function merge(data, validDate) {
  const win = {};
  return runMerge(win, data, validDate, helpers._suggIsFresher);
}

function row(taskId, date, gen, over) {
  return Object.assign({
    prep_task_id: taskId, suggestion_date: date, generated_at: gen,
    status: 'prep_today', current_stock: 0, net_requirement: 500,
    planned_output: 1000, minimum_increment: 1000, history_end_date: null
  }, over || {});
}

// Le righe REALI lette dal database di produzione per il task 364.
const BASE_364 = row(364, '2026-09-19', '2026-09-19T07:06:02.175+00:00',
  { status: 'do_first', current_stock: 0, net_requirement: 690, history_end_date: '2026-09-18' });
const OVER_364 = row(364, '2026-09-20', '2026-09-20T22:09:16.365+00:00',
  { status: 'looks_ok', current_stock: 1000, net_requirement: 0,
    planned_output: null, history_end_date: '2026-09-19' });
const FUTURE_364 = row(364, '2026-09-21', '2026-09-20T07:06:03.640+00:00',
  { status: 'prep_today', current_stock: 0, net_requirement: 951.5, history_end_date: '2026-09-19' });

console.log('\nCREW-UX 13 — fresh per-task suggestion overlay\n');

// ── 0. la protezione esistente non e' stata indebolita ────────────
console.log('0. La soglia resta quella di produzione');

t('_SUGG_MIN_ROWS e\' ancora 50 (il fix non abbassa la soglia)', () => {
  assert.strictEqual(MIN_ROWS, 50);
});

t('la query della baseline e\' ancora limitata a <= todayCDT', () => {
  const q = PREP_SRC.slice(PREP_SRC.indexOf("select('suggestion_date, prep_task_id')"));
  assert.ok(q.indexOf(".lte('suggestion_date', todayCDT)") >= 0,
    'il limite superiore sulla data e\' sparito dalla prima query');
});

t('anche la seconda query resta limitata a <= todayCDT: nessuna riga futura entra nel merge', () => {
  const i = PREP_SRC.indexOf('.gte(\'suggestion_date\', validDate)');
  assert.ok(i > 0, 'la seconda query non carica piu\' un intervallo');
  const win = PREP_SRC.slice(i, i + 200);
  assert.ok(win.indexOf(".lte('suggestion_date', todayCDT)") >= 0,
    'la seconda query non ha piu\' il limite superiore: una run futura potrebbe diventare overlay');
});

// ── A. baseline completa senza overlay ────────────────────────────
console.log('\nA. Baseline completa, nessun overlay');

t('A — comportamento identico a oggi: ogni task prende la sua riga di baseline', () => {
  const data = [row(100, '2026-09-19', '2026-09-19T07:06:02Z', { status: 'do_first' }),
                row(200, '2026-09-19', '2026-09-19T07:06:02Z', { status: 'looks_ok' }),
                BASE_364];
  const r = merge(data, '2026-09-19');
  assert.strictEqual(Object.keys(r.suggestions).length, 3);
  assert.strictEqual(r.suggestions[100].status, 'do_first');
  assert.strictEqual(r.suggestions[200].status, 'looks_ok');
  assert.strictEqual(r.suggestions[364].status, 'do_first');
  assert.strictEqual(r.date, '2026-09-19');
});

t('A — _suggestionsHistoryEnd resta il massimo delle righe di baseline', () => {
  const data = [row(100, '2026-09-19', '2026-09-19T07:06:02Z', { history_end_date: '2026-09-17' }),
                row(200, '2026-09-19', '2026-09-19T07:06:02Z', { history_end_date: '2026-09-18' })];
  assert.strictEqual(merge(data, '2026-09-19').historyEnd, '2026-09-18');
});

// ── B. overlay per un solo task ───────────────────────────────────
console.log('\nB. Overlay mirato: solo quel task cambia');

t('B — con 100/200/364 in baseline e un refresh su 364, solo 364 cambia', () => {
  const data = [row(100, '2026-09-19', '2026-09-19T07:06:02Z', { status: 'do_first' }),
                row(200, '2026-09-19', '2026-09-19T07:06:02Z', { status: 'looks_ok' }),
                BASE_364, OVER_364];
  const r = merge(data, '2026-09-19');
  assert.strictEqual(r.suggestions[100].status, 'do_first', '100 non deve cambiare');
  assert.strictEqual(r.suggestions[200].status, 'looks_ok', '200 non deve cambiare');
  assert.strictEqual(r.suggestions[364].status, 'looks_ok', '364 deve prendere l\'overlay');
  assert.strictEqual(Number(r.suggestions[364].current_stock), 1000);
  assert.strictEqual(Object.keys(r.suggestions).length, 3, 'nessun task in piu\'');
});

t('B — una riga mirata NON sposta la deduction date di tutti', () => {
  const data = [row(100, '2026-09-19', '2026-09-19T07:06:02Z', { history_end_date: '2026-09-18' }),
                BASE_364, OVER_364];
  assert.strictEqual(merge(data, '2026-09-19').historyEnd, '2026-09-18',
    'history_end_date dell\'overlay (2026-09-19) non deve vincere');
});

// ── C. overlay piu' vecchio ───────────────────────────────────────
console.log('\nC. Overlay piu\' vecchio della baseline');

t('C — generated_at anteriore alla baseline: ignorato', () => {
  const stale = row(364, '2026-09-20', '2026-09-18T10:00:00Z', { status: 'looks_ok', current_stock: 9999 });
  const r = merge([BASE_364, stale], '2026-09-19');
  assert.strictEqual(r.suggestions[364].status, 'do_first');
  assert.strictEqual(Number(r.suggestions[364].current_stock), 0);
});

t('C — generated_at identico: la baseline resta (serve strettamente piu\' fresco)', () => {
  const tie = row(364, '2026-09-20', BASE_364.generated_at, { status: 'looks_ok' });
  assert.strictEqual(merge([BASE_364, tie], '2026-09-19').suggestions[364].status, 'do_first');
});

// ── D. piu' refresh dello stesso task ─────────────────────────────
console.log('\nD. Piu\' refresh mirati sullo stesso task');

t('D — vince il generated_at piu\' recente, non l\'ordine di arrivo', () => {
  const a = row(364, '2026-09-20', '2026-09-20T16:47:54Z', { status: 'prep_today', current_stock: 200 });
  const b = row(364, '2026-09-20', '2026-09-20T22:09:16Z', { status: 'looks_ok',   current_stock: 1000 });
  const asc  = merge([BASE_364, a, b], '2026-09-19');
  const desc = merge([BASE_364, b, a], '2026-09-19');
  assert.strictEqual(asc.suggestions[364].status, 'looks_ok');
  assert.strictEqual(desc.suggestions[364].status, 'looks_ok', 'l\'ordine delle righe non deve contare');
  assert.strictEqual(Number(desc.suggestions[364].current_stock), 1000);
});

// ── E. run parziale non diventa baseline ──────────────────────────
console.log('\nE. Una run parziale non diventa la baseline globale');

t('E — 1 riga il 09-20 e 95 il 09-19: la baseline resta il 09-19', () => {
  const allRows = [{ suggestion_date: '2026-09-20', prep_task_id: 364 }];
  for (let i = 0; i < 95; i++) allRows.push({ suggestion_date: '2026-09-19', prep_task_id: i });
  assert.strictEqual(pickBaseline(allRows, MIN_ROWS), '2026-09-19');
});

t('E — 49 righe non bastano, 50 si\'', () => {
  const mk = (n, d) => Array.from({ length: n }, (_, i) => ({ suggestion_date: d, prep_task_id: i }));
  assert.strictEqual(pickBaseline(mk(49, '2026-09-20'), MIN_ROWS), null);
  assert.strictEqual(pickBaseline(mk(50, '2026-09-20'), MIN_ROWS), '2026-09-20');
});

// ── F. task senza baseline ────────────────────────────────────────
console.log('\nF. Task assente dalla baseline ma con una riga mirata valida');

t('F — l\'overlay viene applicato: una risposta fresca del bot batte "non lo so"', () => {
  // Comportamento DOCUMENTATO e deliberato: la riga e' un output reale del
  // bot per una data operativa <= oggi, generata dopo la baseline. Rifiutarla
  // significherebbe preferire "Suggerimento non disponibile" a un dato fresco.
  const data = [row(100, '2026-09-19', '2026-09-19T07:06:02Z'),
                row(777, '2026-09-20', '2026-09-20T22:09:16Z', { status: 'looks_ok', current_stock: 500 })];
  const r = merge(data, '2026-09-19');
  assert.strictEqual(r.suggestions[777].status, 'looks_ok');
  assert.strictEqual(Object.keys(r.suggestions).length, 2);
});

t('F — e non tocca i task che la baseline copre gia\'', () => {
  const data = [row(100, '2026-09-19', '2026-09-19T07:06:02Z', { status: 'do_first' }),
                row(777, '2026-09-20', '2026-09-20T22:09:16Z', { status: 'looks_ok' })];
  assert.strictEqual(merge(data, '2026-09-19').suggestions[100].status, 'do_first');
});

// ── G. data futura con generated_at piu' vecchio ──────────────────
console.log('\nG. suggestion_date futura, generated_at piu\' vecchio');

t('G — la riga 09-21 non batte il refresh 09-20, pur avendo la data piu\' alta', () => {
  // Nel loader la 09-21 non arriva nemmeno (query <= todayCDT). Qui si
  // verifica che anche se arrivasse perderebbe: il criterio e' causale.
  const r = merge([BASE_364, FUTURE_364, OVER_364], '2026-09-19');
  assert.strictEqual(r.suggestions[364].status, 'looks_ok');
  assert.strictEqual(Number(r.suggestions[364].current_stock), 1000);
  assert.strictEqual(r.suggestions[364].suggestion_date, '2026-09-20');
});

t('G — generated_at illeggibile: fail-closed, vince la baseline', () => {
  const broken = row(364, '2026-09-20', 'non-una-data', { status: 'looks_ok' });
  assert.strictEqual(merge([BASE_364, broken], '2026-09-19').suggestions[364].status, 'do_first');
});

t('G — _suggGeneratedMs legge sia la forma ISO sia quella con lo spazio', () => {
  const iso   = helpers._suggGeneratedMs({ generated_at: '2026-09-20T22:09:16.365+00:00' });
  const space = helpers._suggGeneratedMs({ generated_at: '2026-09-20 22:09:16.365+00' });
  assert.ok(!isNaN(iso) && !isNaN(space));
  assert.strictEqual(iso, space);
  assert.ok(isNaN(helpers._suggGeneratedMs({ generated_at: null })));
});

// ── H. il reload reale di Chop Romaine ────────────────────────────
console.log('\nH. Reload reale — Chop Romaine, dati veri dal database');

t('H — task 364 al reload: looks_ok, stock 1000, net_requirement 0', () => {
  // Esattamente le righe che il DB contiene adesso. La 09-21 non entra
  // perche' e' futura; restano baseline + overlay.
  const r = merge([BASE_364, OVER_364], '2026-09-19');
  const s = r.suggestions[364];
  assert.strictEqual(s.status, 'looks_ok');
  assert.strictEqual(Number(s.current_stock), 1000);
  assert.strictEqual(Number(s.net_requirement), 0);
});

t('H — crewClassify(364) = hidden_ok: Chop Romaine non torna fra le attention card', () => {
  const merged = merge([BASE_364, OVER_364], '2026-09-19').suggestions;
  const dom = new JSDOM(HTML, { runScripts: 'outside-only', url: 'https://example.test/' });
  const win = dom.window;
  const chop = { id: 364, name: 'Chop Romaine', category: 'Salad Station', unit: 'g',
                 current_stock: 1000, archived: false, prep_type: 'supporto',
                 in_progress: false, in_progress_at: null, in_progress_by: null };
  win.user = { id: 38, name: 'Pablo', role: 'staff', default_station: 'Salad Station' };
  win.items = [chop];
  win.tasks = { 364: chop };
  win._suggestions = merged;
  win._suggestionsDate = '2026-09-19';
  win._suggestionsError = false;
  win._recentCounts = {};                       // l'unico conteggio fisico e' scaduto dal 26 luglio
  win.supa = new Proxy({}, { get() { throw new Error('DB ACCESS'); } });
  win.fetch = () => { throw new Error('NETWORK CALL'); };
  win.eval(CREW_SRC);
  assert.strictEqual(win.crewClassify(chop), 'hidden_ok');
});

t('H — senza il fix la stessa card tornerebbe rossa (prova del contrario)', () => {
  const baselineOnly = merge([BASE_364], '2026-09-19').suggestions;
  const dom = new JSDOM(HTML, { runScripts: 'outside-only', url: 'https://example.test/' });
  const win = dom.window;
  const chop = { id: 364, name: 'Chop Romaine', category: 'Salad Station', unit: 'g',
                 current_stock: 1000, archived: false, prep_type: 'supporto',
                 in_progress: false, in_progress_at: null, in_progress_by: null };
  win.user = { id: 38, name: 'Pablo', role: 'staff', default_station: 'Salad Station' };
  win.items = [chop]; win.tasks = { 364: chop };
  win._suggestions = baselineOnly;
  win._suggestionsDate = '2026-09-19';
  win._suggestionsError = false;
  win._recentCounts = {};
  win.supa = new Proxy({}, { get() { throw new Error('DB ACCESS'); } });
  win.fetch = () => { throw new Error('NETWORK CALL'); };
  win.eval(CREW_SRC);
  assert.strictEqual(win.crewClassify(chop), 'do_first');
});

console.log('\n' + (fail === 0 ? 'ALL GREEN' : 'FAILURES') +
  ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail === 0 ? 0 : 1);
