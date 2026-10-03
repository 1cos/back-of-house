// ══════════════════════════════════════════════════════════════════
// UD01 — Upcoming Demand: finestra 90 giorni, esclusi LOST/cancellati,
// limite di sicurezza 30, conteggio "N eventi nei prossimi 90 giorni".
// Plain Node: `node tests/ud01-upcoming-demand.test.js`
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'briefing.js'), 'utf8');
const start = SRC.indexOf('const UD_WINDOW_DAYS=');
const fnStart = SRC.indexOf('async function loadUpcomingDemand(){');
const end = SRC.indexOf('\n}\n', fnStart);
assert.ok(start >= 0 && fnStart > start && end > fnStart, 'blocco UD01 non trovato in briefing.js');
const BLOCK = SRC.slice(start, end + 3);

let pass = 0, fail = 0;
async function atest(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }

function run({ rows, count, lang = 'it' }) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="upcomingDemandSection"><span id="homeUpcomingLabel"></span><div id="upcomingDemand"></div></div></body></html>');
  const calls = [];
  const builder = {};
  ['select', 'gte', 'lte', 'or', 'order', 'limit'].forEach(m => {
    builder[m] = (...a) => { calls.push([m, ...a]); return builder; };
  });
  builder.then = (res) => res({ data: rows, count, error: null });
  const ctx = {
    document: dom.window.document,
    supa: { from: (t) => { calls.push(['from', t]); return builder; } },
    getNowDallas: () => new Date(2026, 9, 2, 10, 0, 0),
    tr: (k) => k,
    normalizeLang: (l) => String(l || 'en').slice(0, 2),
    user: { lang },
    loginLang: 'en',
    isAdmin: () => false,
    showCalendar: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(BLOCK + '\nthis.__load = loadUpcomingDemand;', ctx);
  return ctx.__load().then(() => ({ calls, html: dom.window.document.getElementById('upcomingDemand').innerHTML }));
}

const ev = (i, d) => ({ id: 'e' + i, name: 'Ev ' + i, event_date: d, event_time: '17:00:00', guest_count: 10, status: 'definite', event_recipes: [] });

(async () => {
  console.log('\nUD01 — Upcoming Demand\n');

  await atest('query: finestra oggi..oggi+90, esclusi lost/cancelled, limit 30, niente piu limit(5)', async () => {
    const { calls } = await run({ rows: [ev(1, '2026-10-09')], count: 1 });
    const get = (m) => calls.filter(c => c[0] === m);
    assert.strictEqual(get('from')[0][1], 'events');
    assert.strictEqual(get('gte')[0].slice(1).join('|'), 'event_date|2026-10-02');
    assert.strictEqual(get('lte')[0].slice(1).join('|'), 'event_date|2026-12-31');
    const orArg = get('or')[0][1];
    assert.ok(orArg.startsWith('status.is.null,status.not.in.('), orArg);
    ['lost', 'cancelled', 'canceled', 'LOST'].forEach(s => assert.ok(orArg.includes(s), s));
    assert.strictEqual(get('limit')[0][1], 30);
    assert.strictEqual(get('select')[0][2].count, 'exact');
    assert.ok(!/\.limit\(5\)/.test(SRC.slice(fnStart, end)), 'limit(5) ancora presente');
  });

  await atest('conteggio IT: "N eventi nei prossimi 90 giorni"', async () => {
    const rows = [ev(1, '2026-10-09'), ev(2, '2026-10-10'), ev(3, '2026-11-05')];
    const { html } = await run({ rows, count: 3 });
    assert.ok(html.includes('3 eventi nei prossimi 90 giorni'), html.slice(0, 300));
    assert.strictEqual((html.match(/Ev \d/g) || []).length, 3);
  });

  await atest('conteggio oltre il limite: mostra totale e "(mostrati 30)"', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ev(i, '2026-10-' + String(3 + (i % 25)).padStart(2, '0')));
    const { html } = await run({ rows, count: 34 });
    assert.ok(html.includes('34 eventi nei prossimi 90 giorni (mostrati 30)'), html.slice(0, 300));
  });

  await atest('conteggio EN e singolare', async () => {
    const { html } = await run({ rows: [ev(1, '2026-10-09')], count: 1, lang: 'en' });
    assert.ok(html.includes('1 event in the next 90 days'), html.slice(0, 300));
  });

  await atest('nessun evento: sezione nascosta come prima', async () => {
    const dom = await run({ rows: [], count: 0 });
    assert.ok(!dom.html.includes('nei prossimi'));
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail) process.exit(1);
})();
