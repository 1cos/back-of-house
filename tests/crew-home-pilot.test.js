// ══════════════════════════════════════════════════════════════════
// CREW HOME V1 — PILOT (CREW-UX 05)
// Plain Node + jsdom: `node tests/crew-home-pilot.test.js`
//
// What this proves:
//   A. The pilot gate isolates exactly one user id. Max, Tela and every
//      other staff member keep the legacy Home untouched.
//   B. The status → card translation matches the spec frozen in CREW-UX 04,
//      including the two rules that stop the Home from lying:
//        - "looks good" only when there is also nothing unknown
//        - never a quantity when planned_output is NULL
//   C. checklist tasks without a suggestion row do NOT inflate the
//      "can't be checked automatically" counter (they are skipped by the
//      bot by design), while no_demand_path items do.
//   D. Block 2 performs no write of any kind.
//   E. Yesterday is MOVED, not rebuilt: the same DOM node, with the same
//      innerHTML, ends up inside the Crew Home slot.
//
// No network, no Supabase, no Edge Function. The real js/crew-home.js and
// the real index.html are loaded; nothing is re-implemented here.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const CREW_SRC = fs.readFileSync(path.join(ROOT, 'js', 'crew-home.js'), 'utf8');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  OK   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
}

// ── Harness ───────────────────────────────────────────────────────
// Builds a DOM from the real index.html, injects the real crew-home.js,
// and stubs ONLY the globals the production Home would have populated by
// the time doLogin() runs.
function makeApp({ user, items = [], suggestions = {}, suggestionsDate = '2026-09-21',
                   recentCounts = {}, stockVerifiedIds = [] } = {}) {
  const dom = new JSDOM(HTML, { runScripts: 'outside-only' });
  const win = dom.window;

  // Globals the legacy app owns.
  win.user = user;
  win.items = items;
  win.tasks = Object.fromEntries(items.map(i => [i.id, i]));
  win._suggestions = suggestions;
  win._suggestionsDate = suggestionsDate;
  win._suggestionsError = false;
  win._recentCounts = recentCounts;

  // Production helpers, stubbed with their real contract.
  win._computeStockVerified = (task) => stockVerifiedIds.includes(task.id);
  win.humanQty = (qty, unit) => {
    const u = String(unit || '').toLowerCase();
    if (u === 'g' && qty >= 1000) return (qty / 1000) + ' kg';
    return qty + (unit ? ' ' + unit : '');
  };
  win.goToStation = (s) => { win.__wentTo = s; };
  win.openStockCountSheet = (id) => { win.__countSheet = id; };

  // Writes must be impossible: any attempt explodes loudly.
  win.supa = new Proxy({}, { get() { throw new Error('DB ACCESS in crew-home'); } });
  win.fetch = () => { throw new Error('NETWORK CALL in crew-home'); };

  // sessionStorage for Block 2 drafts.
  const store = {};
  win.sessionStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };

  win.eval(CREW_SRC);
  return win;
}

function task(id, name, over = {}) {
  return Object.assign({
    id, name, category: 'Salad Station', unit: 'g', current_stock: 0,
    archived: false, prep_type: 'supporto', in_progress: false,
    in_progress_at: null, in_progress_by: null
  }, over);
}
function sugg(over = {}) {
  return Object.assign({
    status: 'prep_today', confidence: 'low', planned_output: 1000,
    output_unit: 'g', minimum_increment: 1000,
    production_constraint_quality: 'valid_fixed_batch',
    stock_source: 'db_snapshot_unverified', forecast: 500
  }, over);
}

const PABLO = { id: 38, name: 'Pablo', role: 'staff', default_station: 'Salad Station', lang: 'es' };
const MAX   = { id: 1,  name: 'Max',   role: 'admin', default_station: null, is_admin: true, lang: 'en' };
const TELA  = { id: 3,  name: 'Tela',  role: 'staff', default_station: 'Oven Station', lang: 'en' };
const TODD  = { id: 26, name: 'Todd',  role: 'staff', default_station: 'Fresh Pasta Station', lang: 'en' };

// ══════════════════════════════════════════════════════════════════
console.log('\nCREW HOME V1 pilot — CREW-UX 05\n');

// ── A. GATE ───────────────────────────────────────────────────────
console.log('A. Pilot gate');

t('allowlist holds exactly one id', () => {
  const w = makeApp({ user: PABLO });
  // join(): the array lives in the jsdom realm, so deepStrictEqual would
  // fail on prototype identity alone.
  assert.strictEqual(w.CREW_HOME_PILOT_IDS.join(','), '38');
  assert.strictEqual(w.CREW_HOME_PILOT_IDS.length, 1);
});

t('crewHomeEnabled: Pablo yes; Max, Tela, Todd, null all no', () => {
  const w = makeApp({ user: PABLO });
  assert.strictEqual(w.crewHomeEnabled(PABLO), true);
  assert.strictEqual(w.crewHomeEnabled(MAX), false);
  assert.strictEqual(w.crewHomeEnabled(TELA), false);
  assert.strictEqual(w.crewHomeEnabled(TODD), false);
  assert.strictEqual(w.crewHomeEnabled(null), false);
  assert.strictEqual(w.crewHomeEnabled(undefined), false);
});

t('Pablo: Crew Home shown, legacy Home body hidden', () => {
  const w = makeApp({ user: PABLO });
  w.mountCrewHome(PABLO);
  assert.strictEqual(w.document.getElementById('crewHome').style.display, 'block');
  for (const id of w.CREW_HIDDEN_HOME_IDS) {
    const el = w.document.getElementById(id);
    assert.ok(el, 'missing element in index.html: #' + id);
    assert.strictEqual(el.style.display, 'none', '#' + id + ' should be hidden for Pablo');
  }
});

for (const [label, u] of [['Max', MAX], ['Tela', TELA], ['Todd (other staff)', TODD]]) {
  t(label + ': Crew Home stays hidden and nothing is touched', () => {
    const w = makeApp({ user: u });
    const before = w.document.getElementById('vh').innerHTML;
    w.mountCrewHome(u);
    w.renderCrewHome();
    assert.strictEqual(w.document.getElementById('crewHome').style.display, 'none');
    assert.strictEqual(w.document.getElementById('vh').innerHTML, before,
      'the Home body must be byte-identical for ' + label);
    assert.strictEqual(w.document.getElementById('crewAttention').innerHTML, '');
  });
}

t('Yesterday widget is NOT hidden for anyone', () => {
  const w = makeApp({ user: PABLO });
  assert.ok(!w.CREW_HIDDEN_HOME_IDS.includes('homeHighlightsWidget'));
});

// ── B. CLASSIFICATION ─────────────────────────────────────────────
console.log('\nB. Status translation (CREW-UX 04 contract)');

t('do_first / prep_today with planned_output stay themselves', () => {
  const w = makeApp({ user: PABLO });
  assert.strictEqual(w.crewClassify(task(1, 'A')), 'unknown', 'no suggestion + not checklist');
  w._suggestions = { 1: sugg({ status: 'do_first' }), 2: sugg({ status: 'prep_today' }) };
  assert.strictEqual(w.crewClassify(task(1, 'A')), 'do_first');
  assert.strictEqual(w.crewClassify(task(2, 'B')), 'prep_today');
});

t('D5: attention status with NULL planned_output becomes check_first', () => {
  const w = makeApp({ user: PABLO });
  w._suggestions = {
    1: sugg({ status: 'prep_today', planned_output: null, production_constraint_quality: 'missing' }),
    2: sugg({ status: 'do_first',   planned_output: 0 })
  };
  assert.strictEqual(w.crewClassify(task(1, 'Ranch')), 'check_first');
  assert.strictEqual(w.crewClassify(task(2, 'Citronnette')), 'check_first');
});

t('count_first, looks_ok, defer_to_tomorrow, no_demand_path, out_of_scope', () => {
  const w = makeApp({ user: PABLO });
  w._suggestions = {
    1: sugg({ status: 'count_first' }),
    2: sugg({ status: 'looks_ok' }),
    3: sugg({ status: 'defer_to_tomorrow' }),
    4: sugg({ status: 'no_demand_path' }),
    5: sugg({ status: 'out_of_scope' })
  };
  assert.strictEqual(w.crewClassify(task(1, 'a')), 'count_first');
  assert.strictEqual(w.crewClassify(task(2, 'b')), 'hidden_ok');
  assert.strictEqual(w.crewClassify(task(3, 'c')), 'hidden_ok');
  assert.strictEqual(w.crewClassify(task(4, 'd')), 'unknown');
  assert.strictEqual(w.crewClassify(task(5, 'e')), 'unknown');
});

t('in_progress wins over any suggestion status', () => {
  const w = makeApp({ user: PABLO });
  w._suggestions = { 1: sugg({ status: 'looks_ok' }) };
  assert.strictEqual(w.crewClassify(task(1, 'a', { in_progress: true })), 'in_progress');
});

t('stock verified hides the card', () => {
  const w = makeApp({ user: PABLO, stockVerifiedIds: [1] });
  w._suggestions = { 1: sugg({ status: 'do_first' }) };
  assert.strictEqual(w.crewClassify(task(1, 'a')), 'hidden_verified');
});

t('C: checklist without a suggestion row is hidden, NOT unknown', () => {
  const w = makeApp({ user: PABLO });
  assert.strictEqual(w.crewClassify(task(1, 'Check Caesar', { prep_type: 'checklist' })), 'hidden_checklist');
  assert.strictEqual(w.crewClassify(task(2, 'Some prep', { prep_type: 'supporto' })), 'unknown');
});

t('unrecognised status is unknown, never treated as fine', () => {
  const w = makeApp({ user: PABLO });
  w._suggestions = { 1: sugg({ status: 'brand_new_status_from_a_future_bot' }) };
  assert.strictEqual(w.crewClassify(task(1, 'a')), 'unknown');
});

t('only the user own station is collected', () => {
  const w = makeApp({
    user: PABLO,
    items: [task(1, 'Mine'), task(2, 'Theirs', { category: 'Oven Station' }), task(3, 'Gone', { archived: true })],
    suggestions: { 1: sugg(), 2: sugg(), 3: sugg() }
  });
  const d = w.crewCollect(PABLO);
  assert.strictEqual(d.cards.length, 1);
  assert.strictEqual(d.cards[0].task.name, 'Mine');
});

t('ordering: in_progress > do_first > prep_today > count_first > check_first', () => {
  const w = makeApp({
    user: PABLO,
    items: [task(5, 'e'), task(4, 'd'), task(3, 'c'), task(2, 'b'), task(1, 'a', { in_progress: true })],
    suggestions: {
      2: sugg({ status: 'do_first' }),
      3: sugg({ status: 'prep_today' }),
      4: sugg({ status: 'count_first' }),
      5: sugg({ status: 'prep_today', planned_output: null })
    }
  });
  assert.strictEqual(w.crewCollect(PABLO).cards.map(c => c.kind).join(' > '),
    'in_progress > do_first > prep_today > count_first > check_first');
});

// ── B2. THE TWO ANTI-LYING RULES ──────────────────────────────────
console.log('\nB2. The rules that stop the Home from lying');

t('D3: "looks good" only when there is nothing unknown either', () => {
  const clean = makeApp({ user: PABLO, items: [task(1, 'a')], suggestions: { 1: sugg({ status: 'looks_ok' }) } });
  clean.mountCrewHome(PABLO);
  assert.ok(clean.document.getElementById('crewAttention').textContent.includes('Your station looks good'));

  const dirty = makeApp({
    user: PABLO,
    items: [task(1, 'a'), task(2, 'b')],
    suggestions: { 1: sugg({ status: 'looks_ok' }), 2: sugg({ status: 'no_demand_path' }) }
  });
  dirty.mountCrewHome(PABLO);
  const txt = dirty.document.getElementById('crewAttention').textContent;
  assert.ok(!txt.includes('looks good'), 'must NOT claim the station is fine');
  assert.ok(txt.includes("1 item can't be checked automatically"));
});

t('unknowns are one line, never one card each', () => {
  const w = makeApp({
    user: PABLO,
    items: [1, 2, 3, 4, 5, 6, 7].map(i => task(i, 'unknown ' + i)),
    suggestions: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map(i => [i, sugg({ status: 'no_demand_path' })]))
  });
  w.mountCrewHome(PABLO);
  const host = w.document.getElementById('crewAttention');
  assert.strictEqual(host.querySelectorAll('.crew-card').length, 0);
  assert.strictEqual(host.querySelectorAll('.crew-unknown').length, 1);
  assert.ok(host.textContent.includes("7 items can't be checked automatically"));
});

t('D5: a check_first card renders NO quantity', () => {
  const w = makeApp({
    user: PABLO,
    items: [task(1, 'Ranch')],
    suggestions: { 1: sugg({ status: 'prep_today', planned_output: null, production_constraint_quality: 'missing' }) }
  });
  w.mountCrewHome(PABLO);
  const card = w.document.querySelector('.crew-card');
  assert.ok(card.textContent.includes('CHECK FIRST'));
  assert.ok(card.textContent.includes('Check the cooler before prepping.'));
  assert.strictEqual(card.querySelector('.crew-card__qty'), null, 'no invented quantity');
});

t('no valid bot run: say so instead of showing a list', () => {
  const w = makeApp({ user: PABLO, suggestionsDate: null, items: [task(1, 'a')] });
  w.mountCrewHome(PABLO);
  const txt = w.document.getElementById('crewAttention').textContent;
  assert.ok(txt.includes("Today's plan isn't ready yet."));
  assert.strictEqual(w.document.querySelectorAll('.crew-card').length, 0);
});

t('at most 3 cards, the rest behind one "+ N more" row', () => {
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const w = makeApp({
    user: PABLO,
    items: ids.map(i => task(i, 'item ' + i)),
    suggestions: Object.fromEntries(ids.map(i => [i, sugg({ status: 'prep_today' })]))
  });
  w.mountCrewHome(PABLO);
  assert.strictEqual(w.document.querySelectorAll('.crew-card').length, 3);
  const txt = w.document.getElementById('crewAttention').textContent;
  assert.ok(txt.includes('+ 6 more'));
  assert.ok(txt.includes('See all 9'));
});

t('quantity and batch equivalence are read from the bot, not computed', () => {
  const w = makeApp({
    user: PABLO,
    items: [task(1, 'Chop Romaine'), task(2, 'Pecorino fresh wedge'), task(3, 'Bruschetta')],
    suggestions: {
      1: sugg({ status: 'do_first', planned_output: 1000, minimum_increment: 1000 }),
      2: sugg({ status: 'prep_today', planned_output: 2000, minimum_increment: 2000 }),
      3: sugg({ status: 'prep_today', planned_output: 1568, minimum_increment: 1,
                production_constraint_quality: 'valid_scalable' })
    }
  });
  w.mountCrewHome(PABLO);
  // do_first first, then the two prep_today alphabetically: Bruschetta, Pecorino
  const cards = [...w.document.querySelectorAll('.crew-card')].map(c => c.textContent);
  assert.ok(cards[0].includes('Chop Romaine') && cards[0].includes('1 kg') && cards[0].includes('1 batch'));
  // valid_scalable → a quantity but no batch wording
  assert.ok(cards[1].includes('Bruschetta') && cards[1].includes('1.568 kg') && !cards[1].includes('batch'));
  assert.ok(cards[2].includes('Pecorino') && cards[2].includes('2 kg') && cards[2].includes('1 batch'));
});

t('why-line: stock 0 vs stock present', () => {
  const w = makeApp({
    user: PABLO,
    items: [task(1, 'empty', { current_stock: 0 }), task(2, 'low', { current_stock: 300 })],
    suggestions: { 1: sugg({ status: 'do_first' }), 2: sugg({ status: 'do_first' }) }
  });
  w.mountCrewHome(PABLO);
  const cards = [...w.document.querySelectorAll('.crew-card')].map(c => c.textContent);
  assert.ok(cards.some(c => c.includes('Nothing in stock right now.')));
  assert.ok(cards.some(c => c.includes('Running low for today.')));
});

t('in_progress by someone else names them', () => {
  const w = makeApp({
    user: PABLO,
    items: [task(1, 'Caesar', { in_progress: true, in_progress_at: '2026-09-20T14:12:00Z', in_progress_by: 'David' })]
  });
  w.mountCrewHome(PABLO);
  const card = w.document.querySelector('.crew-card');
  assert.ok(card.textContent.includes('IN PROGRESS'));
  assert.ok(card.textContent.includes('Started by David at'));
  assert.ok(card.textContent.includes('Finish'));
});

t('count_first CTA opens the existing stock count sheet', () => {
  const w = makeApp({ user: PABLO, items: [task(7, 'a')], suggestions: { 7: sugg({ status: 'count_first' }) } });
  w.mountCrewHome(PABLO);
  w.crewOpenCount(7);
  assert.strictEqual(w.__countSheet, 7, 'must reuse openStockCountSheet, not a new workflow');
});

t('Open CTA reuses goToStation, no duplicated Prep workflow', () => {
  const w = makeApp({ user: PABLO, items: [task(1, 'a')], suggestions: { 1: sugg() } });
  w.mountCrewHome(PABLO);
  w.crewOpenTask(1);
  assert.strictEqual(w.__wentTo, 'Salad Station');
});

t('no station assigned: say so, never fake a list', () => {
  const w = makeApp({ user: { id: 38, name: 'Pablo', role: 'staff', default_station: null } });
  w.mountCrewHome({ id: 38, name: 'Pablo', role: 'staff', default_station: null });
  assert.ok(w.document.getElementById('crewAttention').textContent.includes('No station assigned'));
});

t('task names are escaped (no HTML injection from the database)', () => {
  const w = makeApp({
    user: PABLO,
    items: [task(1, '<img src=x onerror=alert(1)>')],
    suggestions: { 1: sugg({ status: 'do_first' }) }
  });
  w.mountCrewHome(PABLO);
  assert.strictEqual(w.document.querySelectorAll('.crew-card img').length, 0);
  assert.ok(w.document.querySelector('.crew-card__name').textContent.includes('<img'));
});

// ── D. BLOCK 2 WRITES NOTHING ─────────────────────────────────────
console.log('\nD. Block 2 — visible, usable, and writes nothing');

t('the field exists with the frozen copy (D6)', () => {
  const w = makeApp({ user: PABLO });
  w.mountCrewHome(PABLO);
  const input = w.document.getElementById('crewMadeInput');
  assert.ok(input);
  assert.strictEqual(input.placeholder, 'Tell me what you made...');
  assert.ok(!input.placeholder.includes('Tell Chef'), 'must not reuse the Tell Chef wording');
  const block = w.document.querySelector('.crew-block--made');
  assert.ok(block.textContent.includes('What did you make?'));
});

t('no microphone is rendered — no promise it cannot keep', () => {
  const w = makeApp({ user: PABLO });
  w.mountCrewHome(PABLO);
  const block = w.document.querySelector('.crew-block--made');
  assert.ok(!/mic|🎙|voice/i.test(block.innerHTML), 'the mic is out of this slice by decision');
});

t('sending text keeps it locally and never claims it was recorded', () => {
  const w = makeApp({ user: PABLO });
  w.mountCrewHome(PABLO);
  w.document.getElementById('crewMadeInput').value = 'I made 2 batches of Caesar dressing';
  w.crewSaveMade();
  const drafts = w.document.getElementById('crewMadeDrafts').textContent;
  assert.ok(drafts.includes('I made 2 batches of Caesar dressing'), 'the text must not be lost');
  assert.ok(!/recorded|saved to|logged/i.test(drafts), 'must not imply a write happened');
  assert.ok(w.document.querySelector('.crew-block--made').textContent
    .includes('Nothing is recorded yet.'));
  assert.strictEqual(w.document.getElementById('crewMadeInput').value, '', 'field cleared');
});

t('drafts survive a re-render', () => {
  const w = makeApp({ user: PABLO });
  w.mountCrewHome(PABLO);
  w.document.getElementById('crewMadeInput').value = 'made salmoriglio';
  w.crewSaveMade();
  w.renderCrewHome();
  assert.ok(w.document.getElementById('crewMadeDrafts').textContent.includes('made salmoriglio'));
});

t('drafts are escaped too', () => {
  const w = makeApp({ user: PABLO });
  w.mountCrewHome(PABLO);
  w.document.getElementById('crewMadeInput').value = '<b>oops</b>';
  w.crewSaveMade();
  assert.strictEqual(w.document.querySelectorAll('#crewMadeDrafts b').length, 0);
});

t('the whole pilot touches no database and no network', () => {
  // win.supa and win.fetch throw on any access; a full mount + save + render
  // completing without throwing is the proof.
  const w = makeApp({
    user: PABLO,
    items: [task(1, 'a'), task(2, 'b', { prep_type: 'checklist' })],
    suggestions: { 1: sugg({ status: 'do_first' }) }
  });
  w.mountCrewHome(PABLO);
  w.document.getElementById('crewMadeInput').value = 'x';
  w.crewSaveMade();
  w.renderCrewHome();
  assert.ok(true);
});

t('crew-home.js contains no write primitive at all', () => {
  for (const bad of ['.insert(', '.update(', '.upsert(', '.delete(', 'functions/v1', 'fetch(']) {
    assert.ok(!CREW_SRC.includes(bad), 'crew-home.js must not contain ' + bad);
  }
});

// ── E. YESTERDAY IS MOVED, NOT REBUILT ────────────────────────────
console.log('\nE. Yesterday — moved, not rebuilt');

t('the same DOM node lands in the Crew Home slot, unchanged', () => {
  const w = makeApp({ user: PABLO });
  const widget = w.document.getElementById('homeHighlightsWidget');
  // Simulate loadServiceUpdates() having populated it.
  w.document.getElementById('serviceUpdatesList').innerHTML =
    '<div>Chicken Parmesan</div><div>18</div>';
  const htmlBefore = widget.outerHTML;

  w.mountCrewHome(PABLO);

  const after = w.document.getElementById('homeHighlightsWidget');
  assert.strictEqual(after, widget, 'must be the SAME node, not a copy');
  assert.strictEqual(after.outerHTML, htmlBefore, 'markup must be byte-identical');
  assert.strictEqual(after.parentNode.id, 'crewYesterdaySlot');
  assert.ok(w.document.getElementById('serviceUpdatesList'), 'the population target still exists');
  assert.ok(after.innerHTML.includes('Chicken Parmesan'), 'existing content preserved');
});

t('Yesterday is the third and last block', () => {
  const w = makeApp({ user: PABLO });
  w.mountCrewHome(PABLO);
  const blocks = [...w.document.querySelectorAll('#crewHome > .crew-block')];
  assert.strictEqual(blocks.length, 3);
  assert.ok(blocks[0].classList.contains('crew-block--attention'));
  assert.ok(blocks[1].classList.contains('crew-block--made'));
  assert.ok(blocks[2].classList.contains('crew-block--yesterday'));
  assert.strictEqual(blocks[2].id, 'crewYesterdaySlot');
});

t('moving is idempotent across re-renders', () => {
  const w = makeApp({ user: PABLO });
  w.mountCrewHome(PABLO);
  w.renderCrewHome(); w.renderCrewHome();
  assert.strictEqual(w.document.querySelectorAll('#homeHighlightsWidget').length, 1);
  assert.strictEqual(w.document.getElementById('crewYesterdaySlot').children.length, 1);
});

t('for a non-pilot user Yesterday never moves', () => {
  const w = makeApp({ user: TELA });
  const parentBefore = w.document.getElementById('homeHighlightsWidget').parentNode.id;
  w.mountCrewHome(TELA);
  w.renderCrewHome();
  assert.strictEqual(w.document.getElementById('homeHighlightsWidget').parentNode.id, parentBefore);
  assert.strictEqual(parentBefore, 'vh');
});

// ── F. WIRING ─────────────────────────────────────────────────────
console.log('\nF. Wiring into the existing app');

t('exactly one id check exists in the whole codebase for this pilot', () => {
  const files = ['js/app.js', 'js/briefing.js', 'js/crew-home.js', 'index.html'];
  let hits = 0;
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|<!--)/.test(l)).join('\n');
    assert.ok(!/user\.id\s*===\s*38/.test(code), 'hardcoded id check found in ' + f);
    assert.ok(!/name\s*===\s*['"]Pablo['"]/.test(code), 'hardcoded name check found in ' + f);
    hits += (code.match(/CREW_HOME_PILOT_IDS/g) || []).length;
  }
  assert.strictEqual(hits, 2, 'in code (comments excluded) the allowlist is declared once and read once');
});

t('app.js calls mountCrewHome once, guarded', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  const calls = src.match(/mountCrewHome\(/g) || [];
  assert.strictEqual(calls.length, 1);
  assert.ok(src.includes("typeof mountCrewHome === 'function'"), 'the call must be guarded');
});

t('briefing.js calls renderCrewHome once, guarded, before its early returns', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'briefing.js'), 'utf8');
  assert.strictEqual((src.match(/renderCrewHome\(/g) || []).length, 1);
  assert.ok(src.includes("typeof renderCrewHome === 'function'"));
  const fnStart = src.indexOf('function renderHomeStations()');
  const call = src.indexOf('renderCrewHome()');
  const firstReturn = src.indexOf('\n    return', fnStart); // a real statement, not the word in a comment
  assert.ok(call > fnStart && call < firstReturn, 'must run before any early return');
});

t('no other production file was given a crew-home dependency', () => {
  const touched = ['js/app.js', 'js/briefing.js'];
  for (const f of touched) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const n = (src.match(/[Cc]rewHome/g) || []).length;
    assert.ok(n <= 3, f + ' has too many crew-home references (' + n + ')');
  }
});

// ══════════════════════════════════════════════════════════════════
console.log('\n' + (fail === 0 ? 'ALL GREEN' : 'FAILURES') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail === 0 ? 0 : 1);
