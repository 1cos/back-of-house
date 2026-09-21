// CREW-UX 23 — fresh on foreground.
//
// The tests do not reimplement the logic: they EXTRACT the marked section from
// the real js/app.js and run it. If someone edits the section without updating
// these tests, the extraction fails loudly instead of testing a dead copy.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const BEGIN = '// ══ FRESH ON FOREGROUND — CREW-UX 23 — BEGIN';
const END   = '// ══ FRESH ON FOREGROUND — CREW-UX 23 — END';
const i = APP.indexOf(BEGIN), j = APP.indexOf(END);
if (i < 0 || j < 0 || j < i) throw new Error('CREW-UX 23 section not found in js/app.js');
const SECTION = APP.slice(i, j);

let pass = 0, fail = 0;
const queue = [];
function t(name, fn) {
  try { fn(); console.log('  OK   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
}
function ta(name, fn) { queue.push([name, fn]); }
async function runAsync() {
  for (const [name, fn] of queue) {
    try { await fn(); console.log('  OK   ' + name); pass++; }
    catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
  }
}

// ── harness ───────────────────────────────────────────────────────────────
// A tiny world with the same globals app.js expects, and counters for every
// query the section could make.
function world(opts = {}) {
  const w = {
    calls: { prep_tasks: 0, todayLogs: 0, recentCounts: 0,
             renderM: 0, renderS: 0, renderHome: 0, renderHomeItems: 0 },
    visibilityState: 'visible',
    listeners: [],
  };

  const tasks = {};
  const items = (opts.items || []).map(x => Object.assign({}, x));
  items.forEach(x => { tasks[x.id] = x; });

  const win = {
    _suggestions:      opts.suggestions      !== undefined ? opts.suggestions      : { 364: { status: 'prep_today' } },
    _suggestionsDate:  opts.suggestionsDate  !== undefined ? opts.suggestionsDate  : '2026-09-19',
    _suggestionsNoData: false,
    _suggestionsError: false,
    _recentCounts:     opts.recentCounts     !== undefined ? opts.recentCounts     : { 364: { counted_qty: 900 } },
    _taskNames: {},
  };

  const supa = {
    from() {
      return { select() { return { order: async () => {
        w.calls.prep_tasks++;
        if (opts.tasksFail) return { error: new Error('offline'), data: null };
        return { error: null, data: opts.tasksRows !== undefined ? opts.tasksRows : items.map(x => Object.assign({}, x)) };
      } }; } };
    }
  };

  const doc = {
    get visibilityState() { return w.visibilityState; },
    addEventListener(ev, fn) { if (ev === 'visibilitychange') w.listeners.push(fn); },
  };

  async function loadTodayLogs() {
    w.calls.todayLogs++;
    if (opts.suggestionsFail) {
      win._suggestions = {}; win._suggestionsDate = null; win._suggestionsError = true;
      return;
    }
    if (opts.freshSuggestions) win._suggestions = opts.freshSuggestions;
    if (opts.freshLogs) win._todayLogs = opts.freshLogs;
  }
  async function loadRecentCounts() {
    w.calls.recentCounts++;
    if (opts.countsFail) { win._recentCounts = {}; return; }
    if (opts.freshCounts) win._recentCounts = opts.freshCounts;
  }

  const fn = new Function(
    'window', 'document', 'supa', 'items', 'tasks', 'user',
    'loadTodayLogs', 'loadRecentCounts',
    'renderM', 'renderS', 'renderHomeStations', 'renderHomeStationItems',
    SECTION + '\n; return { refreshSharedTruth, _fgIsStale, _fgMergeTasks, FG_STALE_MS };'
  );
  const api = fn(
    win, doc, supa, items, tasks, opts.user === undefined ? { id: 38 } : opts.user,
    loadTodayLogs, loadRecentCounts,
    () => w.calls.renderM++, () => w.calls.renderS++,
    () => w.calls.renderHome++, () => w.calls.renderHomeItems++
  );

  w.win = win; w.items = items; w.tasks = tasks; w.api = api;
  w.fire = () => w.listeners.forEach(f => f());
  return w;
}

const CHOP = { id: 364, name: 'Chop Romaine', category: 'Salad Station', unit: 'g',
               current_stock: 1000, archived: false };

console.log('\nCREW-UX 23 — fresh on foreground\n');

// ── 1 / 2 / 3: the threshold and the concurrency guard ────────────────────
console.log('A. Threshold and guard');

t('1. below the threshold, a foreground makes zero prep queries', () => {
  const w = world({ items: [CHOP] });
  w.win._fgLastLoad = Date.now();          // just loaded
  w.fire();
  assert.strictEqual(w.calls.prep_tasks, 0);
  assert.strictEqual(w.calls.todayLogs, 0);
  assert.strictEqual(w.calls.recentCounts, 0);
});

t('the threshold is 60s, and _fgIsStale agrees with it', () => {
  const w = world({ items: [CHOP] });
  assert.strictEqual(w.api.FG_STALE_MS, 60000);
  w.win._fgLastLoad = Date.now() - 59000;
  assert.strictEqual(w.api._fgIsStale(), false);
  w.win._fgLastLoad = Date.now() - 61000;
  assert.strictEqual(w.api._fgIsStale(), true);
});

ta('2. past the threshold, exactly one refresh sequence runs', async () => {
  const w = world({ items: [CHOP] });
  w.win._fgLastLoad = Date.now() - 120000;
  w.fire();
  await new Promise(r => setTimeout(r, 5));
  assert.strictEqual(w.calls.prep_tasks, 1);
  assert.strictEqual(w.calls.todayLogs, 1);
  assert.strictEqual(w.calls.recentCounts, 1);
  assert.ok(w.calls.renderM >= 1 && w.calls.renderHome >= 1, 'it must redraw');
});

ta('3. two foregrounds back to back never overlap', async () => {
  const w = world({ items: [CHOP] });
  w.win._fgLastLoad = Date.now() - 120000;
  const a = w.api.refreshSharedTruth('a');
  const b = w.api.refreshSharedTruth('b');   // while the first is in flight
  const [ra, rb] = await Promise.all([a, b]);
  assert.strictEqual(ra, 'refreshed');
  assert.strictEqual(rb, 'in_flight', 'the second must bow out');
  assert.strictEqual(w.calls.prep_tasks, 1, 'one query, not two');
  assert.strictEqual(w.calls.todayLogs, 1);
});

ta('a hidden event never refreshes', async () => {
  const w = world({ items: [CHOP] });
  w.win._fgLastLoad = Date.now() - 120000;
  w.visibilityState = 'hidden';
  w.fire();
  await new Promise(r => setTimeout(r, 5));
  assert.strictEqual(w.calls.prep_tasks, 0);
});

ta('nobody logged in: no refresh', async () => {
  const w = world({ items: [CHOP], user: null });
  w.win._fgLastLoad = Date.now() - 120000;
  w.fire();
  await new Promise(r => setTimeout(r, 5));
  assert.strictEqual(w.calls.prep_tasks, 0);
});

// ── 4 / 5 / 6 / 7: the four shared truths ─────────────────────────────────
console.log('\nB. What comes back from another device');

ta('4. stock changed elsewhere is picked up — and the same object is updated', async () => {
  const w = world({ items: [CHOP], tasksRows: [Object.assign({}, CHOP, { current_stock: 0 })] });
  const ref = w.tasks[364];                    // a reference held elsewhere
  w.win._fgLastLoad = Date.now() - 120000;
  await w.api.refreshSharedTruth('t');
  assert.strictEqual(w.tasks[364].current_stock, 0);
  assert.strictEqual(w.items[0].current_stock, 0, 'items and tasks stay in sync');
  assert.strictEqual(w.tasks[364], ref, 'must mutate in place, not replace');
});

ta('5. suggestion changed elsewhere is picked up', async () => {
  const w = world({ items: [CHOP], freshSuggestions: { 364: { status: 'looks_ok' } } });
  w.win._fgLastLoad = Date.now() - 120000;
  await w.api.refreshSharedTruth('t');
  assert.strictEqual(w.win._suggestions[364].status, 'looks_ok');
});

ta('6. prep_log changed elsewhere is picked up', async () => {
  const w = world({ items: [CHOP], freshLogs: { 'Chop Romaine': [{ qty: -1000, unit: 'g' }] } });
  w.win._fgLastLoad = Date.now() - 120000;
  await w.api.refreshSharedTruth('t');
  assert.strictEqual(w.win._todayLogs['Chop Romaine'][0].qty, -1000);
});

ta('7. a new stock count is picked up', async () => {
  const w = world({ items: [CHOP], freshCounts: { 364: { counted_qty: 250 } } });
  w.win._fgLastLoad = Date.now() - 120000;
  await w.api.refreshSharedTruth('t');
  assert.strictEqual(w.win._recentCounts[364].counted_qty, 250);
});

ta('a task archived elsewhere disappears, a new one appears', async () => {
  const other = { id: 999, name: 'New Prep', category: 'Salad Station', unit: 'g',
                  current_stock: 5, archived: false };
  const w = world({ items: [CHOP],
                    tasksRows: [Object.assign({}, CHOP, { archived: true }), other] });
  w.win._fgLastLoad = Date.now() - 120000;
  await w.api.refreshSharedTruth('t');
  assert.strictEqual(w.tasks[364], undefined, 'archived task removed');
  assert.strictEqual(w.tasks[999].name, 'New Prep');
  assert.strictEqual(w.items.length, 1);
  assert.strictEqual(w.win._taskNames[999], 'New Prep');
});

// ── 8: a failed refresh must leave the screen alone ───────────────────────
console.log('\nC. Network failure never destroys what is on screen');

ta('8a. prep_tasks fails: nothing is touched, and it can try again later', async () => {
  const w = world({ items: [CHOP], tasksFail: true });
  const before = w.tasks[364].current_stock;
  const stamp = w.win._fgLastLoad = Date.now() - 120000;
  const r = await w.api.refreshSharedTruth('t');
  assert.strictEqual(r, 'error');
  assert.strictEqual(w.tasks[364].current_stock, before);
  assert.strictEqual(w.win._suggestions[364].status, 'prep_today', 'suggestions kept');
  assert.strictEqual(w.win._suggestionsDate, '2026-09-19');
  assert.strictEqual(w.win._recentCounts[364].counted_qty, 900, 'counts kept');
  assert.strictEqual(w.win._fgLastLoad, stamp, 'still stale, so it retries next time');
  assert.strictEqual(w.api._fgIsStale(), true);
});

ta('8b. suggestions fail: the old plan stays, no "plan not ready" flash', async () => {
  const w = world({ items: [CHOP], suggestionsFail: true });
  w.win._fgLastLoad = Date.now() - 120000;
  await w.api.refreshSharedTruth('t');
  assert.strictEqual(w.win._suggestions[364].status, 'prep_today', 'restored');
  assert.strictEqual(w.win._suggestionsDate, '2026-09-19', 'restored');
  assert.strictEqual(w.win._suggestionsError, false, 'the screen must not say "not ready"');
});

ta('8c. counts fail: the previous counts are kept', async () => {
  const w = world({ items: [CHOP], countsFail: true });
  w.win._fgLastLoad = Date.now() - 120000;
  await w.api.refreshSharedTruth('t');
  assert.strictEqual(w.win._recentCounts[364].counted_qty, 900);
});

ta('8d. after a failure the guard is released', async () => {
  const w = world({ items: [CHOP], tasksFail: true });
  w.win._fgLastLoad = Date.now() - 120000;
  await w.api.refreshSharedTruth('t');
  const r = await w.api.refreshSharedTruth('again');
  assert.strictEqual(r, 'error', 'not stuck on in_flight');
  assert.strictEqual(w.calls.prep_tasks, 2);
});

ta('a genuinely empty count set is not mistaken for a failure', async () => {
  const w = world({ items: [CHOP], recentCounts: {}, freshCounts: {} });
  w.win._fgLastLoad = Date.now() - 120000;
  await w.api.refreshSharedTruth('t');
  assert.deepStrictEqual(Object.keys(w.win._recentCounts), []);
});

// ── 9 / 10: scope ─────────────────────────────────────────────────────────
console.log('\nD. Scope');

t('9. the wake-lock visibility handler in prep.js is untouched', () => {
  const prep = fs.readFileSync(path.join(__dirname, '..', 'js', 'prep.js'), 'utf8');
  assert.ok(/visibilityState==='visible' && _activeTimerCount>0\) requestWakeLock\(\)/.test(prep),
    'the wake lock listener must still be there, unchanged');
  assert.ok(!prep.includes('refreshSharedTruth'), 'prep.js must not have been touched by this task');
});

t('10. the section writes nothing and opens no channel', () => {
  for (const bad of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(',
                     '.channel(', 'postgres_changes', 'setInterval', 'location.reload',
                     'BroadcastChannel', 'postMessage']) {
    assert.ok(!SECTION.includes(bad), 'forbidden in the foreground path: ' + bad);
  }
  assert.ok(SECTION.includes("from('prep_tasks').select('*')"), 'only the read it needs');
  assert.strictEqual((SECTION.match(/supa\./g) || []).length, 1, 'exactly one direct query');
});

t('it reuses the existing loaders instead of duplicating them', () => {
  assert.ok(SECTION.includes('loadTodayLogs'));
  assert.ok(SECTION.includes('loadRecentCounts'));
  assert.ok(!SECTION.includes("from('prep_log')"), 'no second copy of the log query');
  assert.ok(!SECTION.includes("from('prep_suggestions_daily')"), 'no second copy of the suggestion query');
  assert.ok(!SECTION.includes("from('prep_stock_counts')"), 'no second copy of the counts query');
});

t('the render path is the one the app already uses', () => {
  for (const r of ['renderM', 'renderS', 'renderHomeStations', 'renderHomeStationItems']) {
    assert.ok(SECTION.includes(r), 'missing render: ' + r);
  }
  assert.ok(!SECTION.includes('renderCrewHome'), 'the Crew Home is reached through renderHomeStations');
});

runAsync().then(() => {
  console.log('\n' + (fail === 0 ? 'ALL GREEN' : 'FAILURES') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail === 0 ? 0 : 1);
});
