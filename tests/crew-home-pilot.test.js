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
// Async tests are queued and run after the synchronous ones.
const asyncQueue = [];
function ta(name, fn) { asyncQueue.push([name, fn]); }
async function runAsync() {
  for (const [name, fn] of asyncQueue) {
    try { await fn(); console.log('  OK   ' + name); pass++; }
    catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
  }
}
// One JSON response, shaped like the Edge Function's.
function jsonResp(status, body) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

// ── Harness ───────────────────────────────────────────────────────
// Builds a DOM from the real index.html, injects the real crew-home.js,
// and stubs ONLY the globals the production Home would have populated by
// the time doLogin() runs.
function makeApp({ user, items = [], suggestions = {}, suggestionsDate = '2026-09-21',
                   recentCounts = {}, stockVerifiedIds = [], fetchImpl = null } = {}) {
  // A real origin so localStorage / sessionStorage exist (opaque origins throw).
  const dom = new JSDOM(HTML, { runScripts: 'outside-only', url: 'https://example.test/' });
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

  // Direct Supabase access must stay impossible: any attempt explodes loudly.
  win.supa = new Proxy({}, { get() { throw new Error('DB ACCESS in crew-home'); } });
  // fetch: forbidden unless a test provides one. Every call is recorded.
  win.__calls = [];
  win.fetch = fetchImpl
    ? ((url, opts) => { win.__calls.push({ url, body: JSON.parse(opts.body) }); return fetchImpl(url, opts, win); })
    : (() => { throw new Error('NETWORK CALL in crew-home'); });
  win.SUPABASE_URL = 'https://example.test';
  win.localStorage.setItem('brigade_token', 'T'.repeat(64));

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
  assert.ok(txt.includes('1 item needs a quick check'));
  assert.ok(!/can't be checked automatically/.test(txt), 'CREW-UX 07: old wording must be gone');
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
  assert.ok(host.textContent.includes('7 items need a quick check'));
  assert.ok(!/can't be checked automatically/.test(host.textContent), 'CREW-UX 07: old wording must be gone');
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

t('a sentence that is not a production is kept locally, never claimed as recorded', () => {
  const w = makeApp({ user: PABLO });
  w.mountCrewHome(PABLO);
  w.document.getElementById('crewMadeInput').value = 'we only have half a pan left';
  w.crewSubmitMade();
  const drafts = w.document.getElementById('crewMadeDrafts').textContent;
  assert.ok(drafts.includes('we only have half a pan left'), 'the text must not be lost');
  assert.ok(!/recorded|saved to|logged/i.test(drafts), 'must not imply a write happened');
  assert.ok(!/recorded \u00b7|Recorded \u00b7/.test(
    w.document.querySelector('.crew-block--made').textContent));
  assert.strictEqual(w.document.getElementById('crewMadeInput').value, '', 'field cleared');
});

t('drafts survive a re-render', () => {
  const w = makeApp({ user: PABLO });
  w.mountCrewHome(PABLO);
  w.document.getElementById('crewMadeInput').value = 'the pasta machine is noisy';
  w.crewSubmitMade();
  w.renderCrewHome();
  assert.ok(w.document.getElementById('crewMadeDrafts').textContent.includes('pasta machine'));
});

t('drafts are escaped too', () => {
  const w = makeApp({ user: PABLO });
  w.mountCrewHome(PABLO);
  w.document.getElementById('crewMadeInput').value = '<b>oops</b>';
  w.crewSubmitMade();
  assert.strictEqual(w.document.querySelectorAll('#crewMadeDrafts b').length, 0);
});

t('mounting, rendering and a non-production note touch no database and no network', () => {
  // win.supa and win.fetch both throw on any access; completing without
  // throwing is the proof that nothing reached out.
  const w = makeApp({
    user: PABLO,
    items: [task(1, 'a'), task(2, 'b', { prep_type: 'checklist' })],
    suggestions: { 1: sugg({ status: 'do_first' }) }
  });
  w.mountCrewHome(PABLO);
  w.document.getElementById('crewMadeInput').value = 'the walk-in door sticks';
  w.crewSubmitMade();
  w.renderCrewHome();
  assert.ok(true);
});

t('crew-home.js never writes to Supabase directly', () => {
  for (const bad of ['.insert(', '.update(', '.upsert(', '.delete(', 'supa.', 'supabase']) {
    assert.ok(!CREW_SRC.includes(bad), 'crew-home.js must not contain ' + bad);
  }
});

t('the only endpoints it can reach are the two approved ones', () => {
  const eps = (CREW_SRC.match(/\/functions\/v1\/[a-z0-9-]+/g) || []);
  assert.deepStrictEqual([...new Set(eps)].sort(),
    ['/functions/v1/record-prep-production-v2', '/functions/v1/refresh-prep-suggestion']);
  // Comments are allowed to name the paths we deliberately do NOT use.
  const code = CREW_SRC.split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  for (const forbidden of ['record-prep-stock-count', 'chef_reports', 'prep_log', 'office_items']) {
    assert.ok(!code.includes(forbidden), 'must not reference ' + forbidden);
  }
});

// ── D2. DENSITY CONTRACT (CREW-UX 07) ─────────────────────────────
console.log('\nD2. Density contract — same information, less height');

t('the card keeps every piece of information', () => {
  const w = makeApp({
    user: PABLO,
    items: [task(1, 'Chop Romaine')],
    suggestions: { 1: sugg({ status: 'do_first', planned_output: 1000, minimum_increment: 1000 }) }
  });
  w.mountCrewHome(PABLO);
  const card = w.document.querySelector('.crew-card');
  assert.ok(card.querySelector('.crew-card__label'), 'status label');
  assert.ok(card.querySelector('.crew-card__name'), 'prep name');
  assert.ok(card.querySelector('.crew-card__qty'),  'quantity');
  assert.ok(card.querySelector('.crew-card__why'),  'reason');
  assert.ok(card.querySelector('.crew-cta'),        'action');
  assert.ok(card.textContent.includes('DO FIRST'));
  assert.ok(card.textContent.includes('Chop Romaine'));
  assert.ok(card.textContent.includes('1 kg'));
  assert.ok(card.textContent.includes('Nothing in stock right now.'));
  assert.ok(card.textContent.includes('Open'));
});

t('the action sits beside the text, not on a row of its own', () => {
  const w = makeApp({ user: PABLO, items: [task(1, 'a')], suggestions: { 1: sugg() } });
  w.mountCrewHome(PABLO);
  const card = w.document.querySelector('.crew-card');
  // text column and action are siblings inside the card
  assert.ok(card.querySelector('.crew-card__main'), 'text column wrapper exists');
  assert.strictEqual(card.querySelector('.crew-card__actions').parentNode, card);
  assert.strictEqual(card.querySelector('.crew-card__name').closest('.crew-card__main'),
    card.querySelector('.crew-card__main'), 'the name lives in the text column');
  assert.ok(card.querySelector('.crew-cta--compact'), 'the card CTA is the compact variant');
});

t('the compact CTA is declared smaller than the name but still tappable', () => {
  const css = HTML.match(/#crewHome \.crew-cta--compact \{([^}]*)\}/)[1];
  const minH = parseFloat((css.match(/min-height:\s*(\d+)px/) || [])[1]);
  const fs   = parseFloat((css.match(/font:[^;]*?(\d+)px\//) || [])[1]);
  const nameCss = HTML.match(/#crewHome \.crew-card__name \{([^}]*)\}/)[1];
  const nameFs  = parseFloat((nameCss.match(/font-size:\s*(\d+)px/) || [])[1]);
  assert.ok(minH >= 40, 'finger target stays at least 40px, got ' + minH);
  assert.ok(fs < nameFs, 'CTA text (' + fs + 'px) must be quieter than the prep name (' + nameFs + 'px)');
});

t('the wide CTA (no-run state) is untouched', () => {
  const w = makeApp({ user: PABLO, suggestionsDate: null, items: [task(1, 'a')] });
  w.mountCrewHome(PABLO);
  const btn = w.document.querySelector('.crew-cta--wide');
  assert.ok(btn && !btn.classList.contains('crew-cta--compact'));
});

// ══════════════════════════════════════════════════════════════════
// CREW-UX 10 — "What did you make?" writes a real production
// ══════════════════════════════════════════════════════════════════

// Chop Romaine as it really is today: g, stock 0, fixed batch of 1000.
const CHOP = task(364, 'Chop Romaine', { unit: 'g', current_stock: 0 });
const CHOP_SUGG = sugg({
  status: 'prep_today', planned_output: 1000, output_unit: 'g',
  minimum_increment: 1000, production_constraint_quality: 'valid_fixed_batch'
});
function chopApp(over = {}) {
  // a fresh copy per case: the write path mutates the task in place
  return makeApp(Object.assign({
    user: PABLO,
    items: [JSON.parse(JSON.stringify(CHOP))],
    suggestions: { 364: JSON.parse(JSON.stringify(CHOP_SUGG)) }
  }, over));
}

// ── PARSER ─────────────────────────────────────────────────────────
console.log('\nG. Parser — deterministic, no model');

t('"I made 2 batches of Chop Romaine"', () => {
  const p = makeApp({ user: PABLO }).crewParseMade('I made 2 batches of Chop Romaine');
  assert.strictEqual(p.intent, 'production');
  assert.strictEqual(p.raw_item, 'chop romaine');
  assert.strictEqual(p.quantity, 2);
  assert.strictEqual(p.unit_kind, 'batch');
});

t('"made 2 batches chop romaine" (no "I", no "of")', () => {
  const p = makeApp({ user: PABLO }).crewParseMade('made 2 batches chop romaine');
  assert.strictEqual(p.intent, 'production');
  assert.strictEqual(p.raw_item, 'chop romaine');
  assert.strictEqual(p.quantity, 2);
  assert.strictEqual(p.unit_kind, 'batch');
});

t('"I made 2000 g of Chop Romaine"', () => {
  const p = makeApp({ user: PABLO }).crewParseMade('I made 2000 g of Chop Romaine');
  assert.strictEqual(p.quantity, 2000);
  assert.strictEqual(p.unit, 'g');
  assert.strictEqual(p.unit_kind, 'native');
});

t('"I made 2 kg of Chop Romaine"', () => {
  const p = makeApp({ user: PABLO }).crewParseMade('I made 2 kg of Chop Romaine');
  assert.strictEqual(p.quantity, 2);
  assert.strictEqual(p.unit, 'kg');
});

t('quantity missing: "I made Chop Romaine"', () => {
  const p = makeApp({ user: PABLO }).crewParseMade('I made Chop Romaine');
  assert.strictEqual(p.intent, 'production');
  assert.strictEqual(p.raw_item, 'chop romaine');
  assert.strictEqual(p.quantity, null);
});

t('non-production sentences never parse as production', () => {
  const w = makeApp({ user: PABLO });
  for (const s of [
    'We only have half a pan left', "we're out of ranch", 'only half a pan left',
    'the oven is broken', 'ranch', '', '   '
  ]) {
    assert.strictEqual(w.crewParseMade(s).intent, 'unknown', 'should not parse: ' + s);
  }
});

t('a number with no unit is not guessed', () => {
  const p = makeApp({ user: PABLO }).crewParseMade('I made 2 chop romaine');
  assert.strictEqual(p.intent, 'production');
  assert.strictEqual(p.quantity, null, 'no unit means no quantity — it gets asked');
  assert.strictEqual(p.raw_item, 'chop romaine');
});

// ── MATCHING ───────────────────────────────────────────────────────
console.log('\nH. Prep matching — never invents an id');

const MANY = [
  task(364, 'Chop Romaine'),
  task(390, 'Ranch'),
  task(394, 'Check Ranch', { prep_type: 'checklist' }),
  task(256, 'Salmoriglio', { category: 'Sauté Station' }),
  task(423, 'Mash Potato', { category: 'Saucier Station' })
];

t('exact name', () => {
  const w = makeApp({ user: PABLO, items: MANY });
  const r = w.crewMatchPrep('chop romaine', PABLO);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].id, 364);
});

t('unique substring: "romaine"', () => {
  const w = makeApp({ user: PABLO, items: MANY });
  const r = w.crewMatchPrep('romaine', PABLO);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].id, 364);
});

t('checklist prep is never a production target', () => {
  const w = makeApp({ user: PABLO, items: MANY });
  assert.strictEqual(w.crewMatchPrep('check ranch', PABLO).length, 0,
    'the only thing named "Check Ranch" is a checklist');
  const r = w.crewMatchPrep('ranch', PABLO);
  assert.strictEqual(r.length, 1, 'Check Ranch must not appear as a candidate');
  assert.strictEqual(r[0].id, 390);
});

t('ambiguous: two real preps match', () => {
  const w = makeApp({ user: PABLO,
    items: MANY.concat([task(999, 'Ranch Dressing'), task(997, 'Ranch Base')]) });
  const r = w.crewMatchPrep('ranch dress', PABLO);
  assert.strictEqual(r.length, 1, 'a unique substring is not ambiguous');
  const amb = w.crewMatchPrep('ranch b', PABLO);
  assert.strictEqual(amb.length, 1);
  const w2 = makeApp({ user: PABLO,
    items: [task(999, 'Ranch Dressing'), task(997, 'Ranch Base')] });
  assert.strictEqual(w2.crewMatchPrep('ranch', PABLO).length, 2,
    'two substring matches, no exact name: ambiguous');
});

t('zero match', () => {
  const w = makeApp({ user: PABLO, items: MANY });
  assert.strictEqual(w.crewMatchPrep('caesar dressing', PABLO).length, 0);
});

t('own station wins over other stations', () => {
  const w = makeApp({ user: PABLO, items: MANY.concat([task(998, 'Romaine Hearts', { category: 'Oven Station' })]) });
  const r = w.crewMatchPrep('romaine', PABLO);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].category, 'Salad Station');
});

t('a match outside the station is still found', () => {
  const w = makeApp({ user: PABLO, items: MANY });
  const r = w.crewMatchPrep('salmoriglio', PABLO);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].category, 'Sauté Station');
});

// ── UNIT RESOLUTION ────────────────────────────────────────────────
console.log('\nI. Unit resolution — three shapes, nothing else');

t('native g passes through', () => {
  const r = makeApp({ user: PABLO }).crewResolveQuantity(CHOP, CHOP_SUGG, 2000, 'g', 'native');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.quantity, 2000);
  assert.strictEqual(r.unit, 'g');
  assert.strictEqual(r.native_quantity, 2000);
});

t('kg -> g: the cook keeps kg, the native value is 2000', () => {
  const r = makeApp({ user: PABLO }).crewResolveQuantity(CHOP, CHOP_SUGG, 2, 'kg', 'native');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.unit, 'kg');
  assert.strictEqual(r.native_quantity, 2000);
});

t('batch with valid_fixed_batch: 2 x 1000 = 2000 g', () => {
  const r = makeApp({ user: PABLO }).crewResolveQuantity(CHOP, CHOP_SUGG, 2, 'batch', 'batch');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.quantity, 2000);
  assert.strictEqual(r.unit, 'g');
  assert.strictEqual(r.batches, 2);
});

t('batch WITHOUT valid_fixed_batch is refused', () => {
  const w = makeApp({ user: PABLO });
  for (const bad of [
    sugg({ production_constraint_quality: 'missing', minimum_increment: 1000 }),
    sugg({ production_constraint_quality: 'valid_fixed_batch', minimum_increment: null }),
    sugg({ production_constraint_quality: 'valid_scalable', minimum_increment: 1 }),
    null
  ]) {
    const r = w.crewResolveQuantity(CHOP, bad, 2, 'batch', 'batch');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'batch_unavailable');
  }
});

t('liters, lb, pan, oz, container, quart are all refused by name', () => {
  const w = makeApp({ user: PABLO });
  for (const u of ['liters', 'lb', 'pans', 'oz', 'containers', 'quarts']) {
    const r = w.crewResolveQuantity(CHOP, CHOP_SUGG, 15, u, 'unsupported');
    assert.strictEqual(r.ok, false, u + ' must be refused');
    assert.strictEqual(r.reason, 'unit_unsupported');
    assert.strictEqual(r.native_unit, 'g');
  }
});

t('missing quantity asks, never assumes', () => {
  const r = makeApp({ user: PABLO }).crewResolveQuantity(CHOP, CHOP_SUGG, null, null, null);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'need_quantity');
  assert.strictEqual(r.native_unit, 'g');
});

// ── FLOW + CONFIRMATION ────────────────────────────────────────────
console.log('\nJ. Confirmation — nothing is written before Record');

function typeAndSubmit(w, text) {
  w.document.getElementById('crewMadeInput').value = text;
  w.crewSubmitMade();
}

t('the happy path reaches a confirmation and writes nothing', () => {
  const w = chopApp();               // fetch throws if touched
  w.mountCrewHome(PABLO);
  typeAndSubmit(w, 'I made 2 batches of Chop Romaine');
  const flow = w.document.getElementById('crewMadeFlow').textContent;
  assert.ok(flow.includes('Chop Romaine'));
  assert.ok(flow.includes('2 batches'));
  assert.ok(flow.includes('2 kg'));
  assert.ok(flow.includes('Record'));
  assert.ok(flow.includes('Cancel'));
  assert.strictEqual(w.__calls.length, 0, 'no request before Record');
});

t('zero match says so and writes nothing', () => {
  const w = chopApp();
  w.mountCrewHome(PABLO);
  typeAndSubmit(w, 'I made 2 kg of caesar dressing');
  assert.ok(w.document.getElementById('crewMadeFlow').textContent.includes("couldn't find that prep"));
  assert.strictEqual(w.__calls.length, 0);
});

t('ambiguous shows the candidates and writes nothing', () => {
  const w = makeApp({ user: PABLO,
    items: [task(999, 'Ranch Dressing'), task(997, 'Ranch Base')] });
  w.mountCrewHome(PABLO);
  typeAndSubmit(w, 'I made 2 kg of ranch');
  const flow = w.document.getElementById('crewMadeFlow');
  assert.ok(flow.textContent.includes('Which one?'));
  assert.strictEqual(flow.querySelectorAll('.crew-made__opt').length, 3, '2 candidates + None of these');
  assert.strictEqual(w.__calls.length, 0);
});

t('an unconvertible unit asks for the native one, and writes nothing', () => {
  const w = chopApp();
  w.mountCrewHome(PABLO);
  typeAndSubmit(w, 'I made 15 liters of chop romaine');
  const flow = w.document.getElementById('crewMadeFlow').textContent;
  assert.ok(flow.includes("can't convert liters"));
  assert.ok(flow.includes('How much?'));
  assert.strictEqual(w.__calls.length, 0);
});

t('missing quantity asks only that, then confirms', () => {
  const w = chopApp();
  w.mountCrewHome(PABLO);
  typeAndSubmit(w, 'I made Chop Romaine');
  let flow = w.document.getElementById('crewMadeFlow').textContent;
  assert.ok(flow.includes('How much?'));
  assert.ok(flow.includes('Chop Romaine'), 'the prep is not asked again');
  w.document.getElementById('crewMadeQty').value = '1500';
  w.crewMadeQtySubmit();
  flow = w.document.getElementById('crewMadeFlow').textContent;
  assert.ok(flow.includes('1.5 kg'));
  assert.ok(flow.includes('Record'));
  assert.strictEqual(w.__calls.length, 0);
});

t('an out-of-station prep shows its station in the confirmation', () => {
  const w = makeApp({ user: PABLO, items: MANY, suggestions: {} });
  w.mountCrewHome(PABLO);
  typeAndSubmit(w, 'I made 450 g of salmoriglio');
  const flow = w.document.getElementById('crewMadeFlow').textContent;
  assert.ok(flow.includes('Salmoriglio'));
  assert.ok(flow.includes('Sauté Station'));
});

// ── IDEMPOTENCY ────────────────────────────────────────────────────
console.log('\nK. Idempotency — one operation, one key');

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

ta('the key is a UUID v4, minted at the confirmation and stable across renders', async () => {
  const w = chopApp({ fetchImpl: () => Promise.reject(new Error('offline')) });
  w.mountCrewHome(PABLO);
  typeAndSubmit(w, 'I made 2 batches of Chop Romaine');
  w.renderCrewHome(); w.renderCrewHome();      // re-rendering must not mint a new key
  await w.crewMadeRecord();
  const key = w.__calls[0].body.client_operation_id;
  assert.ok(UUID_V4.test(key), 'not a UUID v4: ' + key);
  w.renderCrewHome();
  await w.crewMadeRecord();
  assert.strictEqual(w.__calls[1].body.client_operation_id, key);
});

ta('double tap produces exactly ONE request', async () => {
  let resolveFirst;
  const gate = new Promise(r => { resolveFirst = r; });
  const w = chopApp({ fetchImpl: () => gate });
  w.mountCrewHome(PABLO);
  typeAndSubmit(w, 'I made 2 batches of Chop Romaine');
  const p1 = w.crewMadeRecord();
  const p2 = w.crewMadeRecord();     // second tap while the first is in flight
  assert.strictEqual(w.__calls.length, 1, 'only one request may leave');
  resolveFirst(await jsonResp(200, { ok: true, idempotent: false, production_recorded: true,
    suggestion_recalculated: true, task: { current_stock: 2000, in_progress: false },
    suggestion: { status: 'looks_ok' } }));
  await p1; await p2;
  assert.strictEqual(w.__calls.length, 1);
});

ta('a network retry reuses the SAME key', async () => {
  let mode = 'fail';
  const w = chopApp({ fetchImpl: () => mode === 'fail'
    ? Promise.reject(new Error('offline'))
    : jsonResp(200, { ok: true, idempotent: true, production_recorded: true,
        suggestion_recalculated: true, task: { current_stock: 2000 }, suggestion: { status: 'looks_ok' } }) });
  w.mountCrewHome(PABLO);
  typeAndSubmit(w, 'I made 2 batches of Chop Romaine');
  await w.crewMadeRecord();
  const flow = w.document.getElementById('crewMadeFlow').textContent;
  assert.ok(flow.includes("Couldn't reach"));
  assert.ok(flow.includes('Try again'));
  mode = 'ok';
  await w.crewMadeRecord();
  assert.strictEqual(w.__calls.length, 2);
  assert.strictEqual(w.__calls[0].body.client_operation_id, w.__calls[1].body.client_operation_id,
    'a retry of the same production must reuse the key');
});

ta('correcting the draft after a validation error mints a NEW key', async () => {
  const w = chopApp({ fetchImpl: () => jsonResp(400, { ok: false, reason: 'INVALID_INPUT', detail: 'unit_not_allowed' }) });
  w.mountCrewHome(PABLO);
  typeAndSubmit(w, 'I made 2 batches of Chop Romaine');
  await w.crewMadeRecord();
  assert.ok(w.document.getElementById('crewMadeFlow').textContent.includes('Start again'));
  w.crewMadeCancel();
  typeAndSubmit(w, 'I made 3 batches of Chop Romaine');
  await w.crewMadeRecord();
  assert.strictEqual(w.__calls.length, 2);
  assert.strictEqual(w.__calls[1].body.quantity, 3000);
  assert.notStrictEqual(w.__calls[1].body.client_operation_id, w.__calls[0].body.client_operation_id,
    'a corrected draft is a different operation');
});

// ── WRITE + SUCCESS + REFRESH ──────────────────────────────────────
console.log('\nL. Write, success and Home refresh');

const OK_BODY = {
  ok: true, idempotent: false, production_recorded: true, suggestion_recalculated: true,
  task: { id: 364, current_stock: 2000, need_tomorrow: false, in_progress: false,
          in_progress_at: null, in_progress_by: null },
  log: { item: 'Chop Romaine', qty: 2000, unit: 'g' },
  suggestion: { status: 'looks_ok', planned_output: null, output_unit: 'g',
                current_stock: 2000, net_requirement: 0 },
  warning: null
};

ta('the payload is exactly the CREW-UX 09 contract', async () => {
  const w = chopApp({ fetchImpl: () => jsonResp(200, OK_BODY) });
  w.mountCrewHome(PABLO);
  typeAndSubmit(w, 'I made 2 batches of Chop Romaine');
  await w.crewMadeRecord();
  assert.strictEqual(w.__calls.length, 1);
  const c = w.__calls[0];
  assert.ok(String(c.url).endsWith('/functions/v1/record-prep-production-v2'), 'wrong endpoint: ' + c.url);
  assert.strictEqual(c.body.task_id, 364);
  assert.strictEqual(c.body.quantity, 2000);
  assert.strictEqual(c.body.unit, 'g');
  assert.strictEqual(c.body.in_progress_at, null, 'Record production never opens a WIP');
  assert.strictEqual(c.body.is_suggested_qty, false, '2000 !== planned_output 1000');
  assert.strictEqual(c.body.brigade_token.length, 64);
  assert.ok(!isNaN(new Date(c.body.occurred_at).getTime()));
});

ta('is_suggested_qty is true when the quantity equals planned_output', async () => {
  const w = chopApp({ fetchImpl: () => jsonResp(200, OK_BODY) });
  w.mountCrewHome(PABLO);
  typeAndSubmit(w, 'I made 1 batch of Chop Romaine');
  await w.crewMadeRecord();
  assert.strictEqual(w.__calls[0].body.is_suggested_qty, true);
});

ta('ok:true clears the draft and says Recorded', async () => {
  const w = chopApp({ fetchImpl: () => jsonResp(200, OK_BODY) });
  w.mountCrewHome(PABLO);
  typeAndSubmit(w, 'I made 2 batches of Chop Romaine');
  await w.crewMadeRecord();
  assert.strictEqual(w.document.getElementById('crewMadeInput').value, '');
  assert.ok(w.document.getElementById('crewMadeFlow').textContent.includes('Recorded'));
  assert.ok(w.document.getElementById('crewMadeFlow').textContent.includes('Chop Romaine'));
});

ta('idempotent:true is treated as success', async () => {
  const w = chopApp({ fetchImpl: () => jsonResp(200, Object.assign({}, OK_BODY, { idempotent: true })) });
  w.mountCrewHome(PABLO);
  typeAndSubmit(w, 'I made 2 batches of Chop Romaine');
  await w.crewMadeRecord();
  assert.ok(w.document.getElementById('crewMadeFlow').textContent.includes('Recorded'));
});

ta('a fresh suggestion updates the Home and the card disappears', async () => {
  const w = chopApp({ fetchImpl: () => jsonResp(200, OK_BODY) });
  w.mountCrewHome(PABLO);
  assert.strictEqual(w.document.querySelectorAll('.crew-card').length, 1, 'before: Chop Romaine is an attention card');
  typeAndSubmit(w, 'I made 2 batches of Chop Romaine');
  await w.crewMadeRecord();
  assert.strictEqual(w.tasks[364].current_stock, 2000, 'stock applied from the response');
  assert.strictEqual(w._suggestions[364].status, 'looks_ok');
  assert.strictEqual(w.document.querySelectorAll('.crew-card').length, 0, 'the card is gone');
});

ta('minimum_increment is preserved when the response omits it', async () => {
  const w = chopApp({ fetchImpl: () => jsonResp(200, OK_BODY) });
  w.mountCrewHome(PABLO);
  typeAndSubmit(w, 'I made 2 batches of Chop Romaine');
  await w.crewMadeRecord();
  assert.strictEqual(w._suggestions[364].minimum_increment, 1000,
    'the EF does not return it — it must survive');
});

ta('suggestion_recalculated:false does NOT repeat the production', async () => {
  const bodies = [
    Object.assign({}, OK_BODY, { suggestion_recalculated: false, suggestion: null, warning: 'SUGGESTION_REFRESH_FAILED' }),
    { ok: true, recalculated: true, suggestion: { status: 'looks_ok', current_stock: 2000 }, warning: null }
  ];
  let i = 0;
  const w = chopApp({ fetchImpl: () => jsonResp(200, bodies[i++]) });
  w.mountCrewHome(PABLO);
  typeAndSubmit(w, 'I made 2 batches of Chop Romaine');
  await w.crewMadeRecord();
  await new Promise(r => setTimeout(r, 0));
  const prod = w.__calls.filter(c => String(c.url).includes('record-prep-production-v2'));
  const refr = w.__calls.filter(c => String(c.url).includes('refresh-prep-suggestion'));
  assert.strictEqual(prod.length, 1, 'exactly one production, ever');
  assert.strictEqual(refr.length, 1, 'the fallback refresh is called');
  assert.strictEqual(refr[0].body.task_id, 364);
  assert.strictEqual(w._suggestions[364].status, 'looks_ok');
});

ta('when the fallback refresh fails, the old suggestion is not shown as fresh', async () => {
  let i = 0;
  const w = chopApp({ fetchImpl: () => {
    i++;
    if (i === 1) return jsonResp(200, Object.assign({}, OK_BODY, {
      suggestion_recalculated: false, suggestion: null, warning: 'SUGGESTION_REFRESH_FAILED' }));
    return jsonResp(200, { ok: false, recalculated: false, suggestion: null, warning: 'SUGGESTION_REFRESH_FAILED' });
  } });
  w.mountCrewHome(PABLO);
  typeAndSubmit(w, 'I made 2 batches of Chop Romaine');
  await w.crewMadeRecord();
  await new Promise(r => setTimeout(r, 0));
  const flow = w.document.getElementById('crewMadeFlow').textContent;
  assert.ok(flow.includes('Recorded'), 'the production still succeeded');
  assert.ok(flow.includes('plan is still updating'));
  assert.strictEqual(w._suggestions[364].status, 'prep_today', 'the old status is untouched, not relabelled');
  assert.strictEqual(w.tasks[364].current_stock, 2000, 'stock still applied');
});

// ── ERRORS ─────────────────────────────────────────────────────────
console.log('\nM. Error contract');

ta('401 says the session expired and never says Recorded', async () => {
  const w = chopApp({ fetchImpl: () => jsonResp(401, { ok: false, error: 'AUTH_ERROR' }) });
  w.mountCrewHome(PABLO);
  typeAndSubmit(w, 'I made 2 batches of Chop Romaine');
  await w.crewMadeRecord();
  const flow = w.document.getElementById('crewMadeFlow').textContent;
  assert.ok(flow.includes('Session expired'));
  assert.ok(!flow.includes('Recorded'));
});

ta('409 conflict does not auto-retry', async () => {
  const w = chopApp({ fetchImpl: () => jsonResp(409, { ok: false, reason: 'IDEMPOTENCY_KEY_CONFLICT' }) });
  w.mountCrewHome(PABLO);
  typeAndSubmit(w, 'I made 2 batches of Chop Romaine');
  await w.crewMadeRecord();
  assert.strictEqual(w.__calls.length, 1, 'no automatic retry');
  const flow = w.document.getElementById('crewMadeFlow').textContent;
  assert.ok(flow.includes('Something changed'));
  assert.ok(!flow.includes('Recorded'));
});

ta('no failure path ever prints "Recorded"', async () => {
  for (const [status, body] of [
    [400, { ok: false, reason: 'INVALID_INPUT', detail: 'unit_conversion_unsupported' }],
    [401, { ok: false, error: 'AUTH_ERROR' }],
    [409, { ok: false, reason: 'IDEMPOTENCY_KEY_CONFLICT' }],
    [500, { ok: false, reason: 'RPC_FAILED' }],
    [502, { ok: false, error: 'CONNECTION_ERROR' }]
  ]) {
    const w = chopApp({ fetchImpl: () => jsonResp(status, body) });
    w.mountCrewHome(PABLO);
    typeAndSubmit(w, 'I made 2 batches of Chop Romaine');
    await w.crewMadeRecord();
    assert.ok(!/Recorded/.test(w.document.getElementById('crewMadeFlow').textContent),
      'status ' + status + ' must not claim success');
    assert.strictEqual(w.tasks[364].current_stock, 0, 'status ' + status + ' must not change stock');
  }
});

// ── ISOLATION ──────────────────────────────────────────────────────
console.log('\nN. Isolation — only Pablo gets the write path');

t('Pablo gets the whole new path', () => {
  const w = chopApp();
  w.mountCrewHome(PABLO);
  assert.notStrictEqual(w.document.getElementById('crewHome').style.display, 'none');
  assert.ok(w.document.getElementById('crewMadeFlow'), 'the flow container exists');
  typeAndSubmit(w, 'I made 2 batches of Chop Romaine');
  assert.ok(w.document.getElementById('crewMadeFlow').textContent.includes('Record'));
});

t('Max, Tela and any other staff get nothing new and no write path', () => {
  for (const u of [MAX, TELA, TODD, { id: 99, name: 'New Hire', role: 'staff', default_station: 'Salad Station' }]) {
    const w = chopApp();
    w.mountCrewHome(u);
    assert.strictEqual(w.document.getElementById('crewHome').style.display, 'none',
      u.name + ' must stay on the existing Home');
    assert.strictEqual(w.document.getElementById('crewMadeFlow').innerHTML, '',
      u.name + ' has no production flow');
    // Even if the function is reached, nothing leaves the device.
    w.document.getElementById('crewMadeInput').value = 'I made 2 batches of Chop Romaine';
    w.crewSubmitMade();
    assert.strictEqual(w.__calls.length, 0, u.name + ' must not be able to write');
    assert.strictEqual(w.tasks[364].current_stock, 0);
  }
});

ta('Yesterday is untouched by a production', async () => {
  const w = chopApp({ fetchImpl: () => jsonResp(200, OK_BODY) });
  w.mountCrewHome(PABLO);
  const y = w.document.getElementById('homeHighlightsWidget');
  const before = y.innerHTML;
  const parentBefore = y.parentNode.id;
  typeAndSubmit(w, 'I made 2 batches of Chop Romaine');
  await w.crewMadeRecord();
  assert.strictEqual(y.innerHTML, before, 'Yesterday content must not be rewritten');
  assert.strictEqual(y.parentNode.id, parentBefore);
  assert.strictEqual(w.document.getElementById('homeHighlightsWidget'), y, 'same node, never rebuilt');
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
runAsync().then(() => {
  console.log('\n' + (fail === 0 ? 'ALL GREEN' : 'FAILURES') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail === 0 ? 0 : 1);
});
