// TS07 — sezione "Menu Tripleseat" nella scheda evento (js/calendar.js), in jsdom col file vero.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'calendar.js'), 'utf8');

function ambiente(rpcRisposta) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://brigade.test/' });
  const w = dom.window;
  const log = { rpc: [] };
  w.supa = { rpc(n, a) { log.rpc.push([n, a]); return Promise.resolve({ data: rpcRisposta, error: null }); } };
  w.isAdmin = () => false;
  w.localStorage.setItem('brigade_token', 'a'.repeat(64));
  w.eval(SRC);
  return { w, log, doc: w.document };
}

// Il 23 ottobre com'e' oggi (righe vere, versione base), piu' una versione modificata.
const BASE = { ok: true, last_check: '2026-10-06T20:48:42Z', documents: [{ document_id: 39626423, version: 1, received_at: '2026-10-06T20:46:45Z', changes: null,
  lines: [
    { id: '1', section: '', name: 'Wedding menu:', details: '', quantity: 100 },
    { id: '2', section: '', name: 'buffet beef tenderloin ravioli', details: '', quantity: null },
    { id: '3', section: '', name: 'Fettuccine alla vodka plus chicken', details: 'per gli sposi', quantity: 2 },
  ] }] };
const MOD = { ok: true, last_check: '2026-10-07T15:17:00Z', documents: [{ document_id: 39626423, version: 2, received_at: '2026-10-07T15:02:00Z',
  lines: [
    { id: '1', section: '', name: 'Wedding menu:', details: '', quantity: 120 },
    { id: '3', section: '', name: 'Fettuccine alla vodka plus chicken', details: 'per gli sposi', quantity: 2 },
    { id: '9', section: '', name: 'Caesar Salad', details: 'romaine, parmigiano <b>', quantity: 40 },
  ],
  changes: { added: ['9'], changed: [{ id: '1', fields: ['quantity'], before: { quantity: 100 } }],
             removed: [{ name: 'buffet beef tenderloin ravioli', quantity: null }] } }] };

test('1. la base del 23 ottobre: piatti, quantita\' e descrizioni, nessun prezzo', () => {
  const { w } = ambiente(BASE);
  const html = w._calTsMenuHtml(BASE);
  assert.match(html, /Menu Tripleseat/);
  assert.match(html, /Wedding menu:/);
  assert.match(html, /×100/);
  assert.match(html, /per gli sposi/);
  assert.match(html, /versione 1/);
  assert.ok(!/\$|price|prezzo/i.test(html));
  assert.ok(!/NUOVO|TOLTO|era ×/.test(html), 'la base non mostra modifiche');
});

test('2. dopo una modifica: NUOVO, era ×100, TOLTO, e il badge "Modificato"', () => {
  const { w } = ambiente(MOD);
  const html = w._calTsMenuHtml(MOD);
  assert.match(html, /Caesar Salad<span[^>]*>NUOVO/);
  assert.match(html, /×120/);
  assert.match(html, /era ×100/);
  assert.match(html, /buffet beef tenderloin ravioli<\/span>[\s\S]*TOLTO/);
  assert.match(html, /Modificato/);
  assert.ok(!html.includes('<b>'), 'il testo di Tripleseat e\' escapato');
});

test('3. la sezione si carica aprendo la scheda, col token di sessione e l\'id Tripleseat', async () => {
  const { w, log, doc } = ambiente(BASE);
  doc.body.innerHTML = '<div id="cal-detail-x" style="display:none"><div id="cal-tsmenu-x" data-ts="60969076"></div></div><span id="cal-chev-x"></span>';
  w._calToggle('x');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(log.rpc[0])), ['ts_event_menu', { p_token: 'a'.repeat(64), p_tripleseat_id: '60969076' }]);
  assert.match(doc.getElementById('cal-tsmenu-x').innerHTML, /Wedding menu:/);
  w._calToggle('x'); w._calToggle('x');                       // richiuso e riaperto: nessuna seconda chiamata
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(log.rpc.length, 1);
});

test('4. utente non autorizzato: la sezione sparisce, nessun dato mostrato', async () => {
  const { w, doc } = ambiente({ ok: false, error: 'unauthorized' });
  doc.body.innerHTML = '<div id="cal-detail-x" style="display:none"><div id="cal-tsmenu-x" data-ts="60969076"></div></div>';
  w._calToggle('x');
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(doc.getElementById('cal-tsmenu-x'), null);
});

test('5. la scheda evento ha il contenitore solo se l\'evento viene da Tripleseat', () => {
  const { w } = ambiente(BASE);
  const conTs = w._calCard({ id: 'abc-1', name: 'Wedding Ashley', event_date: '2026-10-23', tripleseat_id: '60969076', status: 'definite' });
  const senza = w._calCard({ id: 'abc-2', name: 'Manuale', event_date: '2026-10-23', status: 'definite' });
  assert.match(conTs, /id="cal-tsmenu-abc1" data-ts="60969076"/);
  assert.ok(!/cal-tsmenu-/.test(senza));
});

// TS08 — Wedding Lauren (10/10, #60442420): menu attuale da Tripleseat, vecchia copia e note etichettate.
test('6. Lauren: Food prima di Beverage, ×41 della riga distinto dai 42 ospiti, vecchia copia etichettata', () => {
  const LAUREN = { ok: true, documents: [{ document_id: 1, version: 1, received_at: '2026-10-06T20:46:37Z', changes: null, lines: [
    { id: 'b1', section: 'Beverage', name: 'Espresso Martini', details: '', quantity: null },
    { id: 'f0', section: 'Food', name: 'full menu to be choose', details: '', quantity: 41 },
    { id: 'f4', section: 'Food', name: 'Penne Cacio e Pepe plus Shrimps', details: '', quantity: null } ] }] };
  const { w } = ambiente(LAUREN);
  const html = w._calTsMenuHtml(LAUREN);
  assert.ok(html.indexOf('Food') < html.indexOf('Beverage'));
  assert.match(html, /full menu to be choose[\s\S]*×41/);
  const card = w._calCard({ id: 'fd27', name: 'Wedding Lauren', event_date: '2026-10-10', tripleseat_id: '60442420', guest_count: 42,
    status: 'definite', event_recipes: [{ name: '30 full menu - to be chosen' }], notes: 'U formation with rectangle tables requested. 30 pax.' });
  assert.match(card, /42 ospiti evento/);
  assert.match(card, /Vecchia copia Brigade \(non aggiornata\)[\s\S]*30 full menu - to be chosen/);
  const soloNote = w._calCard({ id: 'x2', name: 'Mason', event_date: '2026-10-09', tripleseat_id: '1', guest_count: 45, status: 'definite', notes: '40 pax <i>' });
  assert.match(soloNote, /Note vecchie Brigade \(non aggiornate\):<\/b> 40 pax &lt;i&gt;/);
  const manuale = w._calCard({ id: 'x3', name: 'Manuale', event_date: '2026-10-09', guest_count: 10, status: 'definite', event_recipes: [{ name: 'Lasagna' }] });
  assert.ok(!/Vecchia copia|ospiti evento/.test(manuale));
});
