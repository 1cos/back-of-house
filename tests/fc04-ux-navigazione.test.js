// FC04-UX — formato della confezione e navigazione, sul flusso vero.
// Carica in jsdom i file VERI (utils, nav, pack-format, motore candidati,
// worklist, ingredients, prezzi-mancanti) sopra una pagina con la barra in
// basso e il menu Admin statici, come index.html. Database finto che registra
// ogni scrittura. I casi A-F sono i test di accettazione chiesti da Max.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { makeSb } = require('./helpers-fake-supabase');

const ROOT = path.join(__dirname, '..');
const leggi = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const VDR = leggi('js/vendor-documents-review.js');
const CAND = VDR.slice(VDR.indexOf('// ── MARKER:VDR_CANDIDATES_START'), VDR.indexOf('// ── MARKER:VDR_CANDIDATES_END'));

const PARSLEY = 'a4e20c8f-70f9-413d-978d-e046ada7c0f0';
const CREAM = '9dc8b439-79fb-4fa5-8a89-48c89a300231';

function db() {
  return {
    ingredients: [
      { id: PARSLEY, name: 'Parsley', category: 'Spices & Herbs', base_unit: 'g', measure_type: 'weight', active: true },
      { id: CREAM, name: 'Heavy Cream', category: 'Dairy', base_unit: 'g', measure_type: 'weight', active: true },
    ],
    ingredient_vendors: [
      { id: 'iv-parsley', ingredient_id: PARSLEY, vendor: "Hardie's Fresh Foods / Dairyland Produce", vendor_sku: '07061',
        pack_description: '6 CT', unit_price: 3.55, price_type: 'per_case', conversion_to_base: null, price_per_100g: null,
        price_per_each: null, last_invoice_date: '2026-09-19', active: true },
      { id: 'iv-cream', ingredient_id: CREAM, vendor: "Hardie's Fresh Foods / Dairyland Produce", vendor_sku: '10068',
        pack_description: '12/1 QT', unit_price: 73.99, price_type: 'per_case', conversion_to_base: null, price_per_100g: null,
        price_per_each: null, last_invoice_date: '2026-09-28', active: true },
    ],
    recipes: [], recipe_bom: [], invoice_lines: [], ingredient_links: [], ingredient_vendor_price_audit: [],
  };
}

// Il server: un avviso per ogni ingrediente senza grammi (come il motore).
function avvisi(d) {
  return d.ingredient_vendors.filter(v => !(v.conversion_to_base > 0)).map(v => {
    const i = d.ingredients.find(x => x.id === v.ingredient_id);
    return { ingredient_id: i.id, ingrediente: i.name, codice: 'prezzo_mancante', diagnosi: 'formato_nuovo_senza_peso',
      ricette_bloccate: i.name === 'Parsley' ? 35 : 31, ricette: 'ARRABBIATA, SALSA VERDE', righe_fattura: 25,
      ultima_fattura: { vendor: v.vendor, date: v.last_invoice_date, pack: v.pack_description, unit_price: v.unit_price },
      ultimo_prezzo_al_peso: null, documenti_in_attesa: [] };
  });
}

function app() {
  const dom = new JSDOM('<!doctype html><body>'
    + '<nav class="fixed bottom-0 left-0 right-0 z-40"><button class="tab" data-t="h">Home</button><button class="tab" data-t="i">Ingredienti</button></nav>'
    + '<div id="adminMenuSheet" class="fixed inset-0 z-[60] hidden"></div><div id="newsBar" class="hidden"></div>'
    + '</body>', { runScripts: 'dangerously', url: 'https://brigade.test/', pretendToBeVisual: true });
  const w = dom.window;
  const dati = db();
  const log = { updates: [], inserts: [], rpc: 0, home: 0 };
  const sb = makeSb(dati, log);
  sb.rpc = (nome) => { log.rpc++; return Promise.resolve({ data: { ok: true, generated_at: 'x', items: avvisi(dati) }, error: null }); };
  w.supabase = { createClient: () => sb };
  w.localStorage.setItem('brigade_token', 'a'.repeat(64));
  w.document.querySelector('[data-t="h"]').addEventListener('click', () => { log.home++; });
  w.showScToast = () => {};
  // come <script> veri: in un browser i const di utils.js (isAdmin, supa, user)
  // sono condivisi fra i file, con eval no
  const carica = (src) => { const el = w.document.createElement('script'); el.textContent = src; w.document.body.appendChild(el); };
  for (const f of ['js/utils.js', 'js/nav.js', 'js/pack-format.js']) carica(leggi(f));
  carica(CAND);
  for (const f of ['js/ingredient-worklist.js', 'js/ingredients.js', 'js/prezzi-mancanti.js']) carica(leggi(f));
  carica("user = { id: 1, name: 'Max', is_admin: true, role: 'admin' }; window.user = user;");
  return { w, doc: w.document, dati, log };
}
const pausa = (ms = 20) => new Promise(r => setTimeout(r, ms));
async function finche(cond, ms = 2000) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await pausa(10); }
}
const bottone = (doc, testo, dentro) => Array.from((dentro || doc).querySelectorAll('button')).find(b => b.textContent.trim() === testo || b.textContent.includes(testo));
function scrivi(w, el, v) { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); }

async function apriSchedaDaPrezziMancanti(a, nome) {
  await a.w.openPrezziMancanti();
  await finche(() => a.doc.getElementById('pmLista'));
  const card = Array.from(a.doc.querySelectorAll('#pmLista > div')).find(d => d.textContent.includes(nome));
  bottone(a.doc, 'Indica il peso del formato', card).click();
  await finche(() => a.doc.getElementById('ingrCard'));
}
async function apriEditVendor(a) {
  bottone(a.doc, 'Edit', a.doc.querySelector('#ingrCard .fixed, #ingrCard') ).click;
  const edit = Array.from(a.doc.querySelectorAll('#ingrCard button')).filter(b => b.textContent.trim() === 'Edit').pop();
  edit.click();
  await finche(() => a.doc.getElementById('pkBox') && a.doc.getElementById('pkBox').textContent.trim());
}

// ── A ─────────────────────────────────────────────────────────────
test('A. Prezzi mancanti > Parsley > 6 x 100 g > Salva > ritorno alla lista aggiornata, filtro e posizione conservati', async () => {
  const a = app();
  await a.w.openPrezziMancanti();
  await finche(() => a.doc.getElementById('pmLista'));
  a.w.pmFiltro('formato');
  a.doc.getElementById('pmLista').scrollTop = 120;
  const card = Array.from(a.doc.querySelectorAll('#pmLista > div')).find(d => d.textContent.includes('Parsley'));
  bottone(a.doc, 'Indica il peso del formato', card).click();
  await finche(() => a.doc.getElementById('ingrCard'));

  assert.strictEqual(a.doc.getElementById('pmModal').style.display, 'none', 'la lista resta, nascosta');
  assert.match(a.doc.getElementById('ingrCard').textContent, /‹ Prezzi mancanti/);
  assert.ok(bottone(a.doc, 'Home', a.doc.getElementById('ingrCard')), 'Home nella scheda');

  await apriEditVendor(a);
  const ed = a.doc.getElementById('evFormato');
  assert.match(ed.textContent, /«6 CT»/);
  assert.strictEqual(ed.querySelector('#pkConf').value, '6');
  assert.strictEqual(ed.querySelector('#pkUnita').value, 'pz');
  assert.match(ed.textContent, /Quanto pesa un pezzo\?/);
  scrivi(a.w, ed.querySelector('#pkUna'), '100');
  assert.match(a.doc.getElementById('pkBox').textContent, /Totale 600 g/);
  assert.match(a.doc.getElementById('pkBox').textContent, /\$3,55 ÷ 600 g = \$0,5917 \/ 100 g/, 'anteprima PRIMA di salvare');
  assert.strictEqual(a.dati.ingredient_vendors[0].conversion_to_base, null, 'niente salvato finora');

  bottone(a.doc, 'Save & Recalculate').click();
  await finche(() => a.doc.getElementById('pmModal').style.display === 'flex' && a.log.rpc >= 2);
  await finche(() => /Parsley ha un prezzo/.test(a.doc.getElementById('pmModal').textContent));

  const iv = a.dati.ingredient_vendors[0];
  assert.strictEqual(iv.conversion_to_base, 600);
  assert.strictEqual(iv.price_per_100g, 0.5917);
  assert.strictEqual(a.doc.getElementById('ingrCard'), null, 'scheda chiusa');
  assert.strictEqual(a.doc.querySelectorAll('[data-nav="ingr-sheet"]').length, 0, 'finestra chiusa');
  assert.match(a.doc.getElementById('pmModal').textContent, /✓ Parsley ha un prezzo: non blocca più 35 ricette/);
  assert.strictEqual(a.w.PM_STATO.filtro, 'formato', 'filtro conservato');
  assert.strictEqual(a.doc.getElementById('pmLista').scrollTop, 120, 'posizione conservata');
  // tracciabilita': la fonte dei grammi
  const au = a.dati.ingredient_vendor_price_audit[0];
  assert.strictEqual(au.assunzioni.fonte, 'chef');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(au.assunzioni.dichiarazione)), { g_per_pz: 100 });
  assert.strictEqual(au.eseguito_da, 'Max');
});

// ── B ─────────────────────────────────────────────────────────────
test('B. Heavy Cream: 12 x 1 US qt, nessun 1 L = 1 kg, peso di una confezione 908 g, anteprima, Salva, ritorno', async () => {
  const a = app();
  await apriSchedaDaPrezziMancanti(a, 'Heavy Cream');
  await apriEditVendor(a);
  const ed = a.doc.getElementById('evFormato');
  assert.strictEqual(ed.querySelector('#pkConf').value, '12');
  assert.strictEqual(ed.querySelector('#pkQta').value, '1');
  assert.strictEqual(ed.querySelector('#pkUnita').value, 'qt');
  assert.match(ed.textContent, /Quanto pesa una confezione da 1 US qt\?/);
  assert.match(a.doc.getElementById('pkBox').textContent, /Manca/, 'la panna non si converte da sola');
  assert.strictEqual(a.doc.getElementById('evConversion').value, '');
  scrivi(a.w, ed.querySelector('#pkUna'), '908');
  assert.match(a.doc.getElementById('pkBox').textContent, /Totale 10\.896 g/);
  assert.match(a.doc.getElementById('pkBox').textContent, /12 × 908 g = 10\.896 g · peso dichiarato dallo chef/);
  assert.match(a.doc.getElementById('pkBox').textContent, /\$73,99 ÷ 10\.896 g = \$0,6791 \/ 100 g/);

  bottone(a.doc, 'Save & Recalculate').click();
  await finche(() => a.doc.getElementById('pmModal').style.display === 'flex' && /Heavy Cream ha un prezzo/.test(a.doc.getElementById('pmModal').textContent));
  const iv = a.dati.ingredient_vendors[1];
  assert.strictEqual(iv.conversion_to_base, 10896);
  assert.strictEqual(iv.price_per_100g, 0.6791);
  const au = a.dati.ingredient_vendor_price_audit.find(r => r.ingredient_id === CREAM);
  assert.strictEqual(au.assunzioni.fonte, 'chef');
  assert.ok(Math.abs(au.assunzioni.dichiarazione.g_per_ml - 908 / 946.353) < 1e-9);
});

test('B2. la dichiarazione approvata viene ricordata: la volta dopo il peso della confezione e\' gia\' li\'', async () => {
  const a = app();
  a.dati.ingredient_vendor_price_audit.push({ id: 'x', ingredient_id: CREAM, created_at: '2026-09-29T06:00:00Z', eseguito_da: 'Max',
    assunzioni: { tipo: 'conversione_formato', fonte: 'chef', dichiarazione: { g_per_ml: 908 / 946.353 } } });
  await a.w.openIngredientCard(CREAM);
  await apriEditVendor(a);
  const ed = a.doc.getElementById('evFormato');
  assert.strictEqual(ed.querySelector('#pkUna').value, '908');
  assert.match(ed.textContent, /dichiarato da Max il 29\/09/);
  assert.match(a.doc.getElementById('pkBox').textContent, /\$0,6791 \/ 100 g/);
});

test('B3. peso totale gia\' noto e formati di peso "documentati"', async () => {
  const a = app();
  a.dati.ingredient_vendors[1].pack_description = '10 KG';
  await a.w.openIngredientCard(CREAM);
  await apriEditVendor(a);
  assert.match(a.doc.getElementById('pkBox').textContent, /Totale 10\.000 g.*peso scritto sulla confezione/s);
  bottone(a.doc, 'Conosco già il peso totale').click();
  scrivi(a.w, a.doc.getElementById('pkTot'), '9500');
  assert.match(a.doc.getElementById('pkBox').textContent, /Totale 9\.500 g.*peso totale indicato dallo chef/s);
  assert.strictEqual(a.doc.getElementById('evConversion').value, '9500');
});

// ── C ─────────────────────────────────────────────────────────────
test('C. Home funziona in ogni passaggio: lista, scheda, finestra di modifica', async () => {
  // dalla lista
  let a = app();
  await a.w.openPrezziMancanti(); await finche(() => a.doc.getElementById('pmLista'));
  bottone(a.doc, 'Home', a.doc.getElementById('pmModal')).click();
  assert.strictEqual(a.doc.getElementById('pmModal'), null); assert.strictEqual(a.log.home, 1);
  // dalla scheda (con la lista nascosta sotto)
  a = app();
  await apriSchedaDaPrezziMancanti(a, 'Parsley');
  bottone(a.doc, 'Home', a.doc.getElementById('ingrCard')).click();
  assert.strictEqual(a.doc.getElementById('ingrCard'), null);
  assert.strictEqual(a.doc.getElementById('pmModal'), null, 'niente lista nascosta appesa');
  assert.strictEqual(a.log.home, 1);
  // dalla finestra di modifica
  a = app();
  await apriSchedaDaPrezziMancanti(a, 'Parsley');
  await apriEditVendor(a);
  bottone(a.doc, 'Home', a.doc.querySelector('[data-nav="ingr-sheet"]')).click();
  assert.strictEqual(a.doc.querySelectorAll('[data-nav]').length, 0);
  assert.strictEqual(a.log.home, 1);
  // la barra e il menu Admin ci sono ancora
  assert.ok(a.doc.querySelector('nav.fixed')); assert.ok(a.doc.getElementById('adminMenuSheet'));
});

// ── D ─────────────────────────────────────────────────────────────
test('D. tastiera iPhone: la finestra sale sopra la tastiera e il campo resta visibile', async () => {
  const a = app();
  const vv = new a.w.EventTarget();
  vv.height = 844; vv.offsetTop = 0;
  Object.defineProperty(a.w, 'visualViewport', { value: vv, configurable: true });
  Object.defineProperty(a.w, 'innerHeight', { value: 844, configurable: true });
  await a.w.openIngredientCard(CREAM);
  await apriEditVendor(a);
  const sheet = a.doc.querySelector('[data-nav="ingr-sheet"]');
  assert.strictEqual(sheet.style.bottom, '0px');
  vv.height = 508;                                  // si apre la tastiera (336 px)
  vv.dispatchEvent(new a.w.Event('resize'));
  assert.strictEqual(sheet.style.bottom, '336px');
  assert.strictEqual(sheet.firstElementChild.style.maxHeight, Math.round(508 * 0.94) + 'px');
  vv.height = 844; vv.dispatchEvent(new a.w.Event('resize'));
  assert.strictEqual(sheet.style.bottom, '0px', 'tastiera chiusa: torna giu\'');
  // i campi del formato sono a 16 px: l'iPhone non ingrandisce la pagina
  assert.match(a.doc.getElementById('pkUna').getAttribute('style'), /font-size:16px/);
  assert.strictEqual(a.doc.getElementById('pkUna').getAttribute('inputmode'), 'decimal');
});

// ── E ─────────────────────────────────────────────────────────────
test('E1. dalla sezione Ingredienti: dopo Salva si resta sulla scheda, una sola, con "‹ Indietro"', async () => {
  const a = app();
  await a.w.openIngredientCard(PARSLEY);
  assert.match(a.doc.getElementById('ingrCard').textContent, /‹ Indietro/);
  await apriEditVendor(a);
  scrivi(a.w, a.doc.getElementById('pkUna'), '100');
  bottone(a.doc, 'Save & Recalculate').click();
  await finche(() => a.dati.ingredient_vendors[0].conversion_to_base === 600 && a.doc.getElementById('ingrCard') && !a.doc.querySelector('[data-nav="ingr-sheet"]'));
  await pausa(50);
  assert.strictEqual(a.doc.querySelectorAll('#ingrCard').length, 1, 'mai due schede sovrapposte');
  assert.strictEqual(a.doc.querySelectorAll('[data-nav="ingr"]').length, 1);
  assert.strictEqual(a.log.rpc, 0, 'nessun ritorno a Prezzi mancanti');
  a.w.ingrCardIndietro();
  assert.strictEqual(a.doc.getElementById('ingrCard'), null, 'Indietro chiude, al primo tocco');
});

test('E2. nessun salvataggio cancella piu\' la barra in basso o il menu Admin', async () => {
  const a = app();
  await a.w.openIngredientCard(PARSLEY);
  await apriEditVendor(a);
  bottone(a.doc, 'Save & Recalculate').click();
  await finche(() => !a.doc.querySelector('[data-nav="ingr-sheet"]'));
  await pausa(50);
  assert.ok(a.doc.querySelector('nav.fixed'), 'barra in basso');
  assert.ok(a.doc.getElementById('adminMenuSheet'), 'menu Admin');
  // e la chiusura generica usata da utenti, service update e storico acquisti
  const t = a.doc.createElement('div'); t.className = 'fixed inset-0 z-50'; a.doc.body.appendChild(t);
  a.w.brigadeChiudiFinestre();
  assert.ok(!t.isConnected, 'la finestra transitoria si chiude');
  assert.ok(a.doc.querySelector('nav.fixed') && a.doc.getElementById('adminMenuSheet'), 'le permanenti no');
});

test('E3. nel codice non resta nessuna rimozione "alla cieca" di .fixed', () => {
  const js = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => [f, leggi('js/' + f)]);
  for (const [f, s] of js) {
    assert.ok(!/querySelector\(['"]\.fixed['"]\)\?\.remove\(\)/.test(s), f + ': querySelector(.fixed).remove()');
    assert.ok(!/querySelectorAll\(['"]\.fixed\.inset-0['"]\)\.forEach\(m=>m\.remove\(\)\)/.test(s), f + ': rimozione di ogni .fixed.inset-0');
  }
});

test('E4. un tocco sulla barra in basso chiude scheda e schermate nascoste', async () => {
  const a = app();
  await apriSchedaDaPrezziMancanti(a, 'Parsley');
  a.doc.querySelector('[data-t="i"]').click();
  assert.strictEqual(a.doc.getElementById('ingrCard'), null);
  assert.strictEqual(a.doc.getElementById('pmModal'), null);
});

test('E5. "‹ Prezzi mancanti" senza salvare: la lista torna com\'era, senza ricaricare', async () => {
  const a = app();
  await apriSchedaDaPrezziMancanti(a, 'Parsley');
  const rpc = a.log.rpc;
  a.w.ingrCardIndietro();
  assert.strictEqual(a.doc.getElementById('pmModal').style.display, 'flex');
  assert.strictEqual(a.log.rpc, rpc);
});

// ── F ─────────────────────────────────────────────────────────────
test('F. nessuna scrittura su ricette, distinte o fatture in tutto il flusso', async () => {
  const a = app();
  await apriSchedaDaPrezziMancanti(a, 'Heavy Cream');
  await apriEditVendor(a);
  scrivi(a.w, a.doc.getElementById('pkUna'), '908');
  bottone(a.doc, 'Save & Recalculate').click();
  await finche(() => a.dati.ingredient_vendors[1].conversion_to_base === 10896);
  await pausa(50);
  const tabelle = new Set([...a.log.updates.map(u => u.table), ...a.log.inserts.map(i => i.table)]);
  assert.deepStrictEqual([...tabelle].sort(), ['ingredient_vendor_price_audit', 'ingredient_vendors']);
  const iv = a.dati.ingredient_vendors[1];
  assert.strictEqual(iv.pack_description, '12/1 QT', 'la descrizione del fornitore non si riscrive');
  assert.strictEqual(iv.unit_price, 73.99, 'il prezzo della fattura non cambia');
});
