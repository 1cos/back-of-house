// ATTENTION01 — il badge e l'intestazione dell'Ufficio contano le stesse decisioni
// di Today/Decisions della V020: public.attention_items, action_now + needs_chef,
// decision_key distinti, solo origine 'office'. Il codice vero di js/office.js gira
// in jsdom sopra un database finto in memoria.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js/office.js'), 'utf8');

function dati() {
  const office_items = [];
  // 229 voci aperte come il 02/10: 174 di completezza, il resto misto
  for (let i = 0; i < 229; i++) office_items.push({ id: 'o' + i, source: 'ai_scan', issue_type: i < 92 ? 'missing_photo' : i < 174 ? 'missing_procedure' : 'bom_partial',
    title: 'Voce ' + i, status: 'open', priority: 'blue', chef_action: null, created_at: new Date(Date.UTC(2026, 6, 1) + i * 60000).toISOString() });
  const attention_items = [
    { origin: 'office', item_id: 'p', attention: 'action_now', decision_key: 'yield:pear' },
    { origin: 'office', item_id: 'b1', attention: 'needs_chef', decision_key: 'bom_partial_review' },
    { origin: 'office', item_id: 'b2', attention: 'needs_chef', decision_key: 'bom_partial_review' },   // stessa decisione
    { origin: 'office', item_id: 't1', attention: 'needs_chef', decision_key: 'old_team_messages' },
    { origin: 'office', item_id: 'ph', attention: 'backlog', decision_key: 'completeness:missing_photo' },  // non conta
    { origin: 'office', item_id: 'st', attention: 'data_quality_unknown', decision_key: null },          // non conta
    { origin: 'office', item_id: 'ok', attention: 'info', decision_key: null },                         // non conta
    { origin: 'invoice', item_id: 'inv', attention: 'needs_chef', decision_key: 'invoice:x' },           // non e' dell'Ufficio
  ];
  return { office_items, attention_items };
}

function fakeSupa(db, knobs) {
  function q(t) {
    const f = []; let ord = null, lim = null, head = false;
    const run = async () => {
      if (knobs.vistaAssente && t === 'attention_items') return { data: null, error: { message: 'relation "public.attention_items" does not exist' } };
      let rows = (db[t] || []).filter(r => f.every(([k, o, v]) => o === 'eq' ? String(r[k]) === String(v) : o === 'in' ? v.map(String).includes(String(r[k])) : o === 'is' ? r[k] === v : true));
      if (ord) rows = rows.slice().sort((a, b) => (a[ord.k] < b[ord.k] ? -1 : 1) * (ord.asc ? 1 : -1));
      if (lim) rows = rows.slice(0, lim);
      return head ? { data: null, count: rows.length, error: null } : { data: JSON.parse(JSON.stringify(rows)), error: null };
    };
    const c = {
      select(s, o) { head = !!(o && o.head); return c; }, eq(k, v) { f.push([k, 'eq', v]); return c; }, in(k, v) { f.push([k, 'in', v]); return c; },
      is(k, v) { f.push([k, 'is', v]); return c; }, order(k, o) { ord = { k, asc: !o || o.ascending !== false }; return c; }, limit(n) { lim = n; return c; },
      async maybeSingle() { const r = await run(); return { data: r.data && r.data[0] || null, error: r.error }; },
      then(a, b) { return run().then(a, b); },
    };
    return c;
  }
  return { from: t => ({ select: (s, o) => q(t).select(s, o) }), channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {} };
}

function ufficio(knobs = {}) {
  const dom = new JSDOM('<!doctype html><body><div id="officeHomeContent"></div><div id="officeBadge"></div><span id="officeMenuBadge" style="display:none"></span></body>',
    { runScripts: 'dangerously', url: 'https://brigade.test/' });
  const w = dom.window;
  w.supa = fakeSupa(dati(), knobs);
  w.tr = k => k; w.isAdmin = () => true; w.showScToast = () => {}; w.user = { name: 'Max', is_admin: true };
  w.escHtml = s => String(s ?? '');
  w.requestAnimationFrame = fn => setTimeout(fn, 0);
  const el = w.document.createElement('script'); el.textContent = SRC; w.document.body.appendChild(el);
  return w;
}

test('01 — badge del menu: 3 decisioni (non 229 voci)', async () => {
  const w = ufficio();
  await w.officeBadgeUpdate();
  const b = w.document.getElementById('officeMenuBadge');
  assert.strictEqual(b.textContent, '3');
  assert.strictEqual(b.style.display, 'inline-flex');
});

test('02 — completezza, storico, dati non affidabili e fatture non entrano nel conteggio', async () => {
  const w = ufficio();
  assert.strictEqual(await w.officeAttentionCount(w.supa), 3);
});

test('03 — intestazione dell\'Ufficio: lo stesso numero del badge, "3 da decidere"', async () => {
  const w = ufficio();
  await w.officeLoadHome();
  assert.strictEqual(w.document.getElementById('officeBadge').textContent, '3 da decidere');
});

test('04 — se la vista non risponde, il badge torna al conteggio vecchio (229) invece di mostrare 0', async () => {
  const w = ufficio({ vistaAssente: true });
  await w.officeBadgeUpdate();
  assert.strictEqual(w.document.getElementById('officeMenuBadge').textContent, '229');
});
