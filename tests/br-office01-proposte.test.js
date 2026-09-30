// BR-OFFICE01 — "Proposte da approvare" in cima all'Ufficio.
// Il codice vero di js/office.js gira in jsdom sopra un database finto in memoria: le proposte hanno una query
// loro (visibili anche oltre le 200 voci più recenti), non si mischiano con la scansione AI, e finché il
// salvataggio protetto delle ricette non è attivo "Approva" non esegue niente (nessuna scrittura diretta di ripiego).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/office.js'), 'utf8');

const RID = { sauce: '1d9f9f59-afd6-4e6d-9b7c-dfaf3fac583f', brussel: 'b227f1da-3e55-43f1-9533-cda928f4f1bf' };
const OFF = { sc: '214bde13-7b16-468d-833f-000583358583', jv: 'dd38ead6-936b-442c-b05a-7108edd6cc87' };

function dati() {
  const office_items = [
    { id: OFF.sc, source: 'sous_chef_chat', from_user: 'Max', title: 'Proposta: «CACIO E PEPE SAUCE» · Butter', status: 'open', priority: 'blue',
      jarvis_status: 'ready', created_at: '2026-06-01T10:00:00Z', recipe_id: RID.sauce, recipe_name: 'CACIO E PEPE SAUCE',
      reasoning_result: { intent: 'ricetta_proposta', proposed_solution: 'x' } },
    { id: OFF.jv, source: 'ai_scan', from_user: 'jarvis', title: '🔵 Brussel Sprouts — No procedure / plating notes', status: 'open', priority: 'blue',
      jarvis_status: 'ready', created_at: '2026-06-01T09:00:00Z', recipe_id: RID.brussel, recipe_name: null, reasoning_result: { proposed_solution: 'y' } },
  ];
  // 250 voci di scansione più recenti: la lista generale (200) non arriva alle proposte
  for (let i = 0; i < 250; i++) office_items.push({ id: 'scan-' + i, source: 'ai_scan', title: 'Scan ' + i, status: 'open', priority: i % 3 ? 'orange' : 'blue',
    created_at: new Date(Date.UTC(2026, 8, 1) + i * 60000).toISOString() });
  return {
    office_items,
    chef_ai_action_drafts: [
      { id: 'd064e61f', office_item_id: OFF.sc, action_type: 'update_recipe_bom', status: 'pending', requires_approval: true, risk_level: 'medium', created_at: '2026-06-01T10:00:00Z',
        payload: { riga: 'Butter', bom_id: 1883, fields: { notes: 'usa burro freddo' }, motivo: '', recipe_id: RID.sauce, proposta_da: 'Max', recipe_title: 'CACIO E PEPE SAUCE' } },
      { id: '5ae15d1b', office_item_id: OFF.jv, action_type: 'update_recipe_procedure', status: 'pending', requires_approval: true, risk_level: 'low', created_at: '2026-06-01T09:00:00Z',
        payload: { procedure: 'detailed_procedure', recipe_id: 'id_from_getRecipeByName' } },
      { id: 'vecchia', office_item_id: 'scan-1', action_type: 'update_prep_stock', status: 'failed', requires_approval: true, created_at: '2026-06-01T08:00:00Z', payload: {} },
    ],
    recipe_bom: [{ bom_id: 1883, parent_recipe_id: RID.sauce, item_id: 'ing-butter', sub_recipe_id: null, quantity: 440, unit: 'g', notes: 'burro', prep_task_id: null }],
    ingredients: [{ id: 'ing-butter', name: 'Butter' }],
    recipe_steps: [1, 2, 3, 4].map(n => ({ id: 's' + n, recipe_id: RID.brussel })),
    recipes: [{ id: RID.sauce, title: 'CACIO E PEPE SAUCE', procedure: '' }, { id: RID.brussel, title: 'Brussel Sprouts', procedure: '' }],
  };
}

// supabase finto: letture vere sui dati in memoria; ogni scrittura e ogni rpc vengono registrate
function fakeSupa(db, log, knobs) {
  function q(t, op, valori) {
    const f = []; let ord = null, lim = null, sel = null;
    const run = async () => {
      if (knobs.errore && t === 'chef_ai_action_drafts' && op === 'select') return { data: null, error: { message: 'rete assente' } };
      if (op !== 'select') { log.writes.push({ t, op, valori, filtri: f.slice() }); return { data: [], error: null }; }
      let rows = (db[t] || []).filter(r => f.every(([k, o, v]) => o === 'eq' ? String(r[k]) === String(v) : o === 'in' ? v.map(String).includes(String(r[k])) : true));
      if (ord) rows = rows.slice().sort((a, b) => (a[ord.k] < b[ord.k] ? -1 : 1) * (ord.asc ? 1 : -1));
      if (lim) rows = rows.slice(0, lim);
      log.reads.push(t);
      return { data: JSON.parse(JSON.stringify(rows)), error: null };
    };
    const c = {
      select(s) { sel = s; return c; }, eq(k, v) { f.push([k, 'eq', v]); return c; }, in(k, v) { f.push([k, 'in', v]); return c; },
      order(k, o) { ord = { k, asc: !o || o.ascending !== false }; return c; }, limit(n) { lim = n; return c; }, ilike() { return c; },
      async maybeSingle() { const r = await run(); return { data: r.data && r.data[0] || null, error: r.error }; },
      async single() { const r = await run(); return { data: r.data && r.data[0] || null, error: r.error }; },
      then(a, b) { return run().then(a, b); },
    };
    return c;
  }
  return {
    from: t => ({ select: s => q(t, 'select').select(s), update: v => q(t, 'update', v), insert: v => q(t, 'insert', v), delete: () => q(t, 'delete'), upsert: v => q(t, 'upsert', v) }),
    rpc: async (n) => { log.rpc.push(n); return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + n } }; },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {},
  };
}

function ufficio(knobs = {}, sorgente = SRC) {
  const dom = new JSDOM('<!doctype html><body><div id="officeHomeContent"></div><div id="officeBadge"></div></body>', { runScripts: 'dangerously', url: 'https://brigade.test/' });
  const w = dom.window;
  const db = dati(), log = { writes: [], reads: [], rpc: [], toast: [] };
  w.supa = fakeSupa(db, log, knobs);
  w.tr = k => k; w.isAdmin = () => true; w.showScToast = m => log.toast.push(m);
  w.escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  w.user = { name: 'Max', is_admin: true };
  w.requestAnimationFrame = fn => setTimeout(fn, 0);
  const el = w.document.createElement('script'); el.textContent = sorgente; w.document.body.appendChild(el);
  return { w, doc: w.document, db, log };
}
// testo come lo legge l'occhio: ogni elemento è una parola separata
const testo = el => (el ? el.innerHTML : '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const card = (a, id) => a.doc.querySelector(`.pp-card[data-pp-id="${id}"]`);

test('01 — home: "Proposte da approvare · 2" in cima, anche se le proposte sono oltre le 200 voci più recenti', async () => {
  const a = ufficio();
  await a.w.officeLoadHome();
  const home = a.doc.getElementById('officeHomeContent');
  assert.strictEqual(home.firstElementChild.id, 'ppSezioneHome');
  assert.match(testo(home.firstElementChild), /Proposte da approvare · 2/);
  assert.ok(card(a, OFF.sc) && card(a, OFF.jv));
  assert.deepStrictEqual(a.log.writes, []);
});

test('02 — card Sous Chef: tipo, ricetta, attuale → proposto, origine, stato; Approva spento con spiegazione', async () => {
  const a = ufficio();
  await a.w.officeLoadHome();
  const t = testo(card(a, OFF.sc));
  for (const atteso of ['Modifica ricetta', 'Da approvare', 'Sous Chef', 'CACIO E PEPE SAUCE', 'Butter · nota: burro → usa burro freddo', 'Apri', 'Rifiuta',
    'Approva — non ancora disponibile', 'Il salvataggio protetto delle ricette deve essere attivato prima.']) assert.ok(t.includes(atteso), atteso + ' in: ' + t);
  const approva = [...card(a, OFF.sc).querySelectorAll('button')].find(b => /Approva/.test(b.textContent));
  assert.strictEqual(approva.disabled, true);
});

test('03 — vecchia proposta Jarvis (segnaposto): "Incompleta", ricetta dal collegamento della voce, origine Jarvis', async () => {
  const a = ufficio();
  await a.w.officeLoadHome();
  const t = testo(card(a, OFF.jv));
  for (const atteso of ['Modifica ricetta', 'Incompleta', 'Jarvis', 'Brussel Sprouts', 'Procedimento · proposta incompleta']) assert.ok(t.includes(atteso), atteso + ' in: ' + t);
});

test('04 — badge sul cassetto Chef AI: "2 da approvare"', async () => {
  const a = ufficio();
  await a.w.officeLoadHome();
  const righe = [...a.doc.querySelectorAll('#officeHomeContent div')].filter(d => /Chef AI|chefAI/.test(d.textContent) && /da approvare/.test(d.textContent));
  assert.ok(righe.some(r => /2 da approvare/.test(r.textContent)));
});

test('05 — cassetto Chef AI: sezione in cima, poi "Altre voci"; le proposte non si ripetono nella lista generale', async () => {
  const a = ufficio();
  await a.w.officeOpenFolder('chefai');
  const lista = a.doc.getElementById('officeFolderList');
  assert.strictEqual(lista.firstElementChild.id, 'ppSezioneCassetto');
  assert.match(testo(lista.firstElementChild), /^Proposte da approvare · 2/);
  assert.match(testo(lista.firstElementChild), /Altre voci$/);
  assert.strictEqual(lista.querySelectorAll(`[data-item-id="${OFF.sc}"]`).length, 1);   // solo la card della sezione
  assert.strictEqual(lista.querySelectorAll('.pp-card').length, 2);
  assert.deepStrictEqual(a.log.writes, []);
});

test('06 — Apri (riga di distinta): attuale, proposto, bom_id, unità, collegamento prep non modificato; niente applicato', async () => {
  const a = ufficio();
  await a.w.officeLoadHome();
  a.w.officePropostaApri(OFF.sc);
  const t = testo(a.doc.getElementById('ppDettaglio'));
  for (const atteso of ['Riga di distinta: Butter', 'Nota', 'burro', 'usa burro freddo', 'bom_id 1883', 'Unità g', 'Collegamento prep nessuno — non viene modificato',
    'Niente è stato applicato.', 'Approva — non ancora disponibile']) assert.ok(t.includes(atteso), atteso + ' in: ' + t);
  assert.deepStrictEqual(a.log.writes, []);
});

test('07 — Apri (procedimento): testo attuale e proposto; segnaposto dichiarato non applicabile', async () => {
  const a = ufficio();
  await a.w.officeLoadHome();
  a.w.officePropostaApri(OFF.jv);
  const t = testo(a.doc.getElementById('ppDettaglio'));
  for (const atteso of ['Procedimento', 'Proposta incompleta', 'Attuale', '— testo vuoto —', 'La scheda ha già 4 passi.', 'Proposto', 'detailed_procedure']) assert.ok(t.includes(atteso), atteso + ' in: ' + t);
});

test('08 — Apri (nuova ricetta): nome, categoria, resa, procedimento, ingredienti solo informativi', () => {
  const a = ufficio();
  const [pz] = a.w.officeProposteModello([{ id: 'n1', office_item_id: 'o1', action_type: 'create_recipe', created_at: '2026-09-30T10:00:00Z',
    payload: { title: 'Salsa X', category: 'Basi', base_weight_g: 2000, procedure: 'Scalda.', ingredienti_proposti: [{ name: 'Butter', qty: 200, unit: 'g' }], proposta_da: 'Max' } }],
    { o1: { id: 'o1', source: 'sous_chef_chat', status: 'open', created_at: '2026-09-30T10:00:00Z' } }, {}, {}, {});
  const d = a.doc.createElement('div'); d.innerHTML = a.w.officePropostaDettaglioHtml(pz);
  const t = testo(d);
  for (const atteso of ['Nuova ricetta', 'Salsa X', 'Basi', '2000 g', 'Scalda.', 'Ingredienti proposti (solo informativi', 'Butter 200 g']) assert.ok(t.includes(atteso), atteso + ' in: ' + t);
  const c = a.doc.createElement('div'); c.innerHTML = a.w.officePropostaCardHtml(pz);
  assert.match(testo(c), /Nuova ricetta .*Salsa X/);
});

test('09 — Approva (da qualunque punto) su proposte ricetta: nessuna esecuzione, nessuna scrittura, bozze ancora pendenti', async () => {
  const a = ufficio();
  await a.w.officeLoadHome();
  a.w.officePropostaApprova(OFF.sc);
  await a.w.jarvisAction(OFF.sc, 'approve_all');     // il vecchio pulsante della card Jarvis
  await a.w.jarvisAction(OFF.jv, 'approve_all');
  assert.deepStrictEqual(a.log.writes, []);
  assert.deepStrictEqual(a.log.rpc, []);
  assert.strictEqual(a.doc.getElementById('jarvisApprovalSheet'), null);
  assert.ok(a.log.toast.every(m => /non ancora disponibile|attivato prima/.test(m)) && a.log.toast.length === 3);
});

test('10 — esecuzione diretta delle bozze ricetta: rifiutata prima di qualunque scrittura o chiamata', async () => {
  const a = ufficio();
  for (const d of [{ action_type: 'update_recipe_bom', payload: { bom_id: 1883, fields: { quantity: 1 } } },
    { action_type: 'create_procedure_draft', payload: { recipe_id: RID.sauce, procedure_text: 'x y' } },
    { action_type: 'create_recipe', payload: { title: 'X' } }, { action_type: 'update_recipe_procedure', payload: {} }]) {
    await assert.rejects(a.w.eval('jarvisExecuteDraft')(a.w.supa, d), /salvataggio protetto/);
  }
  assert.deepStrictEqual(a.log.writes, []);
  assert.deepStrictEqual(a.log.rpc, []);
});

test('11 — al cutover (interruttore acceso) le bozze Jarvis passano solo dalla strada protetta: mai update diretto', async () => {
  const a = ufficio({}, SRC.replace('var RICETTE_PROTETTE_ATTIVE = false;', 'var RICETTE_PROTETTE_ATTIVE = true;'));
  await assert.rejects(a.w.eval('jarvisExecuteDraft')(a.w.supa, { action_type: 'update_recipe_bom', payload: { bom_id: 1883, fields: { quantity: 1 } } }), /non ancora installata/);
  await assert.rejects(a.w.eval('jarvisExecuteDraft')(a.w.supa, { action_type: 'create_procedure_draft', payload: { recipe_id: RID.sauce, procedure_text: 'x y' } }), /non ancora installata/);
  assert.deepStrictEqual(a.log.rpc, ['ricetta_per_modifica', 'ricetta_per_modifica']);
  assert.deepStrictEqual(a.log.writes, []);
  const src = SRC.slice(SRC.indexOf('async function jarvisExecuteDraft'));
  assert.doesNotMatch(src.slice(0, src.indexOf('\n}\n')), /from\('recipe_bom'\)\.update|from\('recipes'\)\.update|from\('recipe_steps'\)/);
});

test('12 — Rifiuta: il primo tocco chiede conferma e non scrive; il secondo chiude solo quella proposta', async () => {
  const a = ufficio();
  await a.w.officeLoadHome();
  const btn = card(a, OFF.sc).querySelector('[data-pp-rifiuta]');
  await a.w.officePropostaRifiuta(OFF.sc, btn);
  assert.strictEqual(btn.textContent, 'Conferma rifiuto');
  assert.deepStrictEqual(a.log.writes, []);
  await a.w.officePropostaRifiuta(OFF.sc, btn);
  const w = a.log.writes.map(x => ({ t: x.t, stato: x.valori.status, filtri: x.filtri }));
  assert.deepStrictEqual(w, [
    { t: 'chef_ai_action_drafts', stato: 'rejected', filtri: [['office_item_id', 'eq', OFF.sc], ['status', 'eq', 'pending']] },
    { t: 'office_items', stato: 'resolved', filtri: [['id', 'eq', OFF.sc]] },
  ]);
});

test('13 — testo delle proposte mostrato come testo (niente HTML iniettato)', () => {
  const a = ufficio();
  const [pz] = a.w.officeProposteModello([{ id: 'n1', office_item_id: 'o1', action_type: 'create_recipe', created_at: '2026-09-30T10:00:00Z',
    payload: { title: '<img src=x onerror=alert(1)>', motivo: '<b>x</b>' } }], { o1: { id: 'o1', source: 'sous_chef_chat', status: 'open' } }, {}, {}, {});
  const html = a.w.officePropostaCardHtml(pz) + a.w.officePropostaDettaglioHtml(pz);
  assert.doesNotMatch(html, /<img|<b>x/);
});

test('14 — errore nel caricare le proposte: si dice, e il resto dell\'Ufficio si vede lo stesso', async () => {
  const a = ufficio({ errore: true });
  await a.w.officeLoadHome();
  const home = a.doc.getElementById('officeHomeContent');
  assert.match(testo(home.firstElementChild), /Proposte non caricate: rete assente/);
  assert.match(testo(home), /Da leggere/);
});

test('15 — nessuna proposta: "Proposte da approvare · 0", nessun badge', async () => {
  const a = ufficio();
  a.db.chef_ai_action_drafts.forEach(d => { d.status = 'rejected'; });
  await a.w.officeLoadHome();
  assert.match(testo(a.doc.getElementById('ppSezioneHome')), /Proposte da approvare · 0 Nessuna proposta in attesa\./);
  assert.doesNotMatch(testo(a.doc.getElementById('officeHomeContent')), /da approvare(?! ·)/i);
});
