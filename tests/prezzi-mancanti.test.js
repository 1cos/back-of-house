// FC04 — Admin > Prezzi mancanti.
// Carica in jsdom i file VERI: il motore di candidati di vendor-documents-review.js
// (solo il blocco fra i marker, come vdr-candidate-engine.test.js), la worklist e
// la schermata. Dati reali di produzione in tests/fixtures/fc04-prezzi-mancanti.json.
// Database simulato: niente e' scritto, e il test lo verifica.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fc04-prezzi-mancanti.json'), 'utf8'));
const VDR = fs.readFileSync(path.join(ROOT, 'js', 'vendor-documents-review.js'), 'utf8');
const CAND = VDR.slice(VDR.indexOf('// ── MARKER:VDR_CANDIDATES_START'), VDR.indexOf('// ── MARKER:VDR_CANDIDATES_END'));
const IWL = fs.readFileSync(path.join(ROOT, 'js', 'ingredient-worklist.js'), 'utf8');
const PM = fs.readFileSync(path.join(ROOT, 'js', 'prezzi-mancanti.js'), 'utf8');

const item = n => FX.items.find(i => i.ingrediente === n);

function ambiente({ admin = true, rpcRisposta, token = 'a'.repeat(64) } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://brigade.test/' });
  const w = dom.window;
  const log = { rpc: [], scritture: [], card: [], match: [], review: 0 };
  const tabella = (nome) => {
    const q = {
      _nome: nome,
      select() { return q; }, is() { return q; }, eq() { return q; }, order() { return q; },
      insert(r) { log.scritture.push([nome, 'insert', r]); return q; },
      update(r) { log.scritture.push([nome, 'update', r]); return q; },
      upsert(r) { log.scritture.push([nome, 'upsert', r]); return q; },
      delete() { log.scritture.push([nome, 'delete']); return q; },
      then(ok) {
        const data = nome === 'invoice_lines' ? FX.righe_non_collegate : nome === 'ingredients' ? FX.ingredienti : [];
        return Promise.resolve({ data, error: null }).then(ok);
      },
    };
    return q;
  };
  w.supabaseClient = {
    from: tabella,
    rpc(nome, args) {
      log.rpc.push([nome, args]);
      return Promise.resolve({ data: rpcRisposta || { ok: true, generated_at: '2026-09-29T05:00:00Z', items: FX.items }, error: null });
    },
  };
  w.isAdmin = () => admin;
  w.localStorage.setItem('brigade_token', token);
  w.openIngredientCard = (id, opts) => {
    log.card.push(id); log.cardOpts = opts;
    const card = w.document.createElement('div');
    card.className = 'fixed z-[60] flex flex-col';
    w.document.body.appendChild(card);
    return Promise.resolve();
  };
  w.vdrOpenMatchSelector = (doc, vendor, sku, descr) => {
    log.match.push({ doc, vendor, sku, descr });
    const m = w.document.createElement('div'); m.id = '_vdrMatchSelector'; w.document.body.appendChild(m);
    return Promise.resolve();
  };
  w.openVendorDocumentsReview = () => { log.review++; };
  w.eval(CAND); w.eval(IWL); w.eval(PM);
  return { w, log, doc: w.document };
}
const pausa = (ms = 0) => new Promise(r => setTimeout(r, ms));

// ── diagnosi ──────────────────────────────────────────────────────

test('1. Parsley: comprato, manca il peso del formato; prove e azione giuste', () => {
  const { w } = ambiente();
  const d = w.pmDiagnosi(item('Parsley'), []);
  assert.strictEqual(d.gruppo, 'formato');
  assert.match(d.titolo, /ultima fattura non ha un peso/);
  assert.ok(d.prove.some(p => p.includes('«6 CT»') && p.includes('$3,55') && p.includes('19/09')));
  assert.ok(d.prove.some(p => p.includes('$1,0111 / 100 g') && p.includes('09/09')));
  assert.strictEqual(d.azioni[0].tipo, 'scheda');
  assert.ok(d.azioni.some(a => a.tipo === 'vendor_review'), 'documento Hardie\'s in attesa');
});

test('2. Heavy Cream: ultima fattura 12/1 QT senza peso, ultimo prezzo al peso 14/09', () => {
  const { w } = ambiente();
  const d = w.pmDiagnosi(item('Heavy Cream'), []);
  assert.strictEqual(d.gruppo, 'formato');
  assert.ok(d.prove.some(p => p.includes('«12/1 QT»') && p.includes('$73,99') && p.includes('28/09')));
  assert.ok(d.prove.some(p => p.includes('$0,2308 / 100 g') && p.includes('14/09')));
});

test('3. White Wine: nessuna fattura, detto chiaramente, nessun prezzo inventato', () => {
  const { w } = ambiente();
  const d = w.pmDiagnosi(item('White Wine'), []);
  assert.strictEqual(d.gruppo, 'mai');
  assert.strictEqual(d.titolo, 'Nessuna fattura trovata');
  assert.match(d.testo, /Nessun prezzo viene inventato/);
  assert.ok(!JSON.stringify(d).includes('$'), 'nessuna cifra');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(d.azioni.map(a => a.tipo))), ['presto']);
  assert.match(d.azioni[0].label, /Stima dello chef/);
});

test('4. Salt: problema di unita\' e di litri/chili, non "mai fatturato"', () => {
  const { w } = ambiente();
  const sale = FX.items.filter(i => i.ingrediente === 'Salt').map(i => w.pmDiagnosi(i, []).titolo).sort();
  assert.deepStrictEqual(sale, ['Serve la conversione fra litri e chili', 'Unità della ricetta non convertibile']);
});

// ── fatture non collegate, dal motore di candidati esistente ─────

test('5. Beets: il motore esistente trova «BEET BABY MIXED» fra le fatture non collegate', () => {
  const { w } = ambiente();
  const beets = item('Beets');
  const cibo = FX.ingredienti.filter(i => i.category !== 'Supply');
  const cand = w.pmCandidatiNonCollegati(FX.righe_non_collegate, cibo, FX.items.map(i => i.ingredient_id));
  assert.deepStrictEqual(Object.keys(cand), [beets.ingredient_id], 'solo Beets, fra questi avvisi');
  assert.strictEqual(cand[beets.ingredient_id][0].descrizione, 'BEET BABY MIXED');
  assert.strictEqual(cand[beets.ingredient_id][0].vendor_sku, '70170');
  const d = w.pmDiagnosi(beets, cand[beets.ingredient_id]);
  assert.strictEqual(d.gruppo, 'collegare');
  assert.strictEqual(d.azioni[0].tipo, 'collega');
});

test('6. le righe tecniche Walmart non diventano mai candidati', () => {
  const { w } = ambiente();
  const tutti = FX.ingredienti.map(i => i.id);
  const cand = w.pmCandidatiNonCollegati(FX.righe_non_collegate, FX.ingredienti, tutti);
  const descr = Object.values(cand).flat().map(g => g.descrizione).join('|');
  assert.ok(!/FULFILL_VARIANCE|HANDLING|Alternative Payment/i.test(descr), descr);
  // «GRAPES WHITE SEEDLESS»: il motore propone Grape (sicuro) e White Grapes (da
  // confermare). Qui entra solo il candidato sicuro.
  const nome = id => FX.ingredienti.find(i => i.id === id).name;
  const perUva = Object.keys(cand).filter(id => cand[id].some(g => g.descrizione === 'GRAPES WHITE SEEDLESS')).map(nome);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(perUva)), ['Grape']);
});

// ── schermata ─────────────────────────────────────────────────────

test('7. admin: chiede gli avvisi al server CON il token di sessione, e li mostra', async () => {
  const { w, log, doc } = ambiente();
  await w.openPrezziMancanti(); await pausa();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(log.rpc[0])), ['fc_prezzi_mancanti', { p_token: 'a'.repeat(64) }]);
  const testo = doc.getElementById('pmModal').textContent;
  assert.match(testo, /Prezzi mancanti/);
  assert.match(testo, /Parsley.*blocca 35 ricette/s);
  assert.ok(testo.indexOf('Parsley') < testo.indexOf('White Wine'), 'ordinati per ricette bloccate');
});

test('8. utente non amministratore: la schermata non si apre e il server non viene chiamato', async () => {
  const { w, log, doc } = ambiente({ admin: false });
  await w.openPrezziMancanti(); await pausa();
  assert.strictEqual(log.rpc.length, 0);
  assert.strictEqual(doc.getElementById('pmModal'), null);
});

test('9. se il server risponde "unauthorized": un messaggio, nessuna cifra', async () => {
  const { w, doc } = ambiente({ rpcRisposta: { ok: false, error: 'unauthorized' } });
  await w.openPrezziMancanti(); await pausa();
  const testo = doc.getElementById('pmModal').textContent;
  assert.match(testo, /riservata all.amministratore/);
  assert.ok(!testo.includes('$'));
});

test('10. filtro "Mai fatturati": solo quelli senza fattura', async () => {
  const { w, doc } = ambiente();
  await w.openPrezziMancanti(); await pausa();
  w.pmFiltro('mai');
  const testo = doc.getElementById('pmLista').textContent;
  assert.match(testo, /White Wine/);
  assert.ok(!/Parsley|Heavy Cream/.test(testo));
});

test('11. "Indica il peso del formato": nasconde la lista (intatta), apre la scheda sapendo da dove arriva, e dopo Salva torna e rilegge', async () => {
  const { w, log, doc } = ambiente();
  await w.openPrezziMancanti(); await pausa();
  w.pmFiltro('formato');
  const btn = Array.from(doc.querySelectorAll('#pmLista button')).find(b => b.textContent === 'Indica il peso del formato');
  w.pmAzione(btn); await pausa();
  assert.deepStrictEqual(log.card, [item('Parsley').ingredient_id]);
  assert.strictEqual(doc.getElementById('pmModal').style.display, 'none', 'nascosta: la scheda sta a z-index 60');
  assert.strictEqual(log.cardOpts.origine.etichetta, 'Prezzi mancanti');
  assert.strictEqual(log.cardOpts.origine.dopoSalva, 'torna');
  log.cardOpts.origine.torna({ salvato: true, ingredientId: item('Parsley').ingredient_id }); await pausa(10);
  assert.strictEqual(doc.getElementById('pmModal').style.display, 'flex', 'di nuovo visibile');
  assert.strictEqual(log.rpc.length, 2, 'e riletta: il prezzo potrebbe essere arrivato');
  assert.strictEqual(w.PM_STATO.filtro, 'formato', 'filtro conservato');
});

test('12. Beets: "Collega" apre la modale di collegamento esistente con fornitore, SKU e descrizione', async () => {
  const { w, log, doc } = ambiente();
  await w.openPrezziMancanti(); await pausa();
  const btn = Array.from(doc.querySelectorAll('#pmLista button')).find(b => /Collega «BEET BABY MIXED»/.test(b.textContent));
  assert.ok(btn, 'bottone Collega per Beets');
  w.pmAzione(btn); await pausa();
  assert.deepStrictEqual(log.match[0], { doc: log.match[0].doc, vendor: "Hardie's Fresh Foods / Dairyland Produce", sku: '70170', descr: 'BEET BABY MIXED' });
});

test('13. "Apri i documenti in attesa" porta a Vendor Review', async () => {
  const { w, log, doc } = ambiente();
  await w.openPrezziMancanti(); await pausa();
  const btn = Array.from(doc.querySelectorAll('#pmLista button')).find(b => b.textContent === 'Apri i documenti in attesa');
  w.pmAzione(btn);
  assert.strictEqual(log.review, 1);
  assert.strictEqual(doc.getElementById('pmModal'), null);
});

test('14. la schermata non scrive niente, in nessun percorso', async () => {
  const { w, log, doc } = ambiente();
  await w.openPrezziMancanti(); await pausa();
  ['formato', 'mai', 'collegare', 'altro', 'tutti'].forEach(f => w.pmFiltro(f));
  const primo = FX.items[0];
  w.pmRicette('0');                                   // apre l'elenco delle ricette
  assert.match(doc.getElementById('pmLista').textContent, new RegExp(primo.ricette.split(',')[0]));
  assert.deepStrictEqual(log.scritture, []);
  assert.ok(!/\.(insert|update|upsert|delete)\(/.test(PM), 'nessuna scrittura nel sorgente');
});

test('15. il menu Admin ha la voce e index.html carica il file dopo la worklist', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /hideAdminMenu\(\);openPrezziMancanti\(\)/);
  assert.ok(html.indexOf('js/prezzi-mancanti.js') > html.indexOf('js/ingredient-worklist.js'));
});

// ── FC05 ──────────────────────────────────────────────────────────
const FIORI = { ingredient_id: 'f3d353e4-e939-4c52-9e11-540c4c9717ba', ingrediente: 'Edible Flower', codice: 'unita_sospetta',
  diagnosi: 'unita_sospetta', ricette_bloccate: 17, ricette: 'Amalfi Salmon, BRAIDED BRANZINO', righe_fattura: 48,
  ultima_fattura: { vendor: "Hardie's Fresh Foods / Dairyland Produce", date: '2026-09-21', pack: '50 CT', unit_price: 16.65 },
  ultimo_prezzo_al_peso: null, documenti_in_attesa: [] };
const UOVA = { ingredient_id: 'uova', ingrediente: 'Eggs', codice: 'conversione_da_confermare', diagnosi: 'conversione_da_confermare',
  conversione: { tipo: 'peso_pezzo', in_uso: null, proposta: 55, fonte_proposta: 'stima', riferimento: null }, ricette_bloccate: 4, ricette: 'crostata al cioccolato', righe_fattura: 20,
  ultima_fattura: null, ultimo_prezzo_al_peso: null, documenti_in_attesa: [] };

test('16. FC05 fiori in grammi: "unita\' da rivedere", nessun peso richiesto, nessuna azione che modifichi', () => {
  const { w } = ambiente();
  const d = w.pmDiagnosi(FIORI, []);
  assert.strictEqual(d.gruppo, 'altro');
  assert.match(d.titolo, /Unità della ricetta da rivedere/);
  assert.doesNotMatch(d.titolo + d.testo, /peso di un pezzo/);
  assert.strictEqual(d.azioni.length, 0);
  assert.ok(d.prove.some(p => p.includes('«50 CT»') && p.includes('$16,65')));
});

test('17. FC05 uova 55 g: "Conferma" chiama il server con il token e rilegge la lista', async () => {
  const { w, log, doc } = ambiente({ rpcRisposta: { ok: true, generated_at: 'x', items: [UOVA] } });
  await w.openPrezziMancanti(); await pausa();
  const d = w.pmDiagnosi(UOVA, []);
  assert.strictEqual(d.azioni[0].tipo, 'conferma');
  assert.strictEqual(d.azioni[0].tipoConv, 'peso_pezzo');
  assert.strictEqual(d.azioni[0].valore, 55);
  const campo = doc.querySelector('input[id^="pmConv"]');
  assert.strictEqual(campo.value, '55');
  campo.value = '52';                                    // lo chef corregge
  w.supabaseClient.rpc = (nome, args) => { log.rpc.push([nome, args]);
    return Promise.resolve({ data: nome === 'fc_conferma_conversione' ? { ok: true } : { ok: true, generated_at: 'y', items: [] }, error: null }); };
  await w.pmAzione(Array.from(doc.querySelectorAll('#pmLista button')).find(b => b.textContent === 'Conferma'));
  await pausa(10);
  const conf = log.rpc.find(r => r[0] === 'fc_conferma_conversione');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(conf[1])), { p_token: 'a'.repeat(64), p_ingredient_id: 'uova', p_tipo: 'peso_pezzo', p_valore: 52 });
  assert.ok(log.rpc.filter(r => r[0] === 'fc_prezzi_mancanti').length >= 2, 'lista riletta');
  assert.deepStrictEqual(log.scritture, [], 'nessuna scrittura diretta sulle tabelle');
});

const PANNA = { ingredient_id: 'panna', ingrediente: 'Heavy Cream', codice: 'conversione_alternativa', diagnosi: 'conversione_alternativa',
  conversione: { tipo: 'densita', in_uso: 908 / 946.353, proposta: 952 / 946.353, fonte_proposta: 'USDA', riferimento: null },
  ricette_bloccate: 3, ricette: 'Mash', righe_fattura: 10, ultima_fattura: null, ultimo_prezzo_al_peso: null, documenti_in_attesa: [] };

test('18. FC05 panna: 908 in uso, 952 proposto; "Usa 952 g" manda g/ml al server, niente campo libero', async () => {
  const { w, log, doc } = ambiente({ rpcRisposta: { ok: true, generated_at: 'x', items: [PANNA] } });
  await w.openPrezziMancanti(); await pausa();
  const d = w.pmDiagnosi(PANNA, []);
  assert.match(d.testo, /In uso: 908 g per US qt\. Riferimento standard: 952 g per US qt/);
  assert.strictEqual(JSON.stringify(d.azioni.map(a => a.label)), '["Usa 952 g","Tieni 908 g"]');
  assert.strictEqual(doc.querySelector('input[id^="pmConv"]'), null);
  w.supabaseClient.rpc = (nome, args) => { log.rpc.push([nome, args]);
    return Promise.resolve({ data: nome === 'fc_conferma_conversione' ? { ok: true } : { ok: true, generated_at: 'y', items: [] }, error: null }); };
  await w.pmAzione(Array.from(doc.querySelectorAll('#pmLista button')).find(b => b.textContent === 'Usa 952 g'));
  await pausa(10);
  const conf = log.rpc.find(r => r[0] === 'fc_conferma_conversione')[1];
  assert.strictEqual(conf.p_tipo, 'densita');
  assert.ok(Math.abs(conf.p_valore - 952 / 946.353) < 1e-9);
  assert.deepStrictEqual(log.scritture, []);
});
