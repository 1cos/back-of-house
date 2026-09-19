// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 75 — Phase B non deve affamare i pending oltre la finestra.
//
// Osservato in produzione dopo il batch 3: 31 pending acquistabili, e
// Phase B ne selezionava sempre i 25 piu' vecchi (order created_at asc,
// slice(0,25)). Quei 25 restano pending perche' hanno SKU non mappati o
// domande bloccanti, quindi la selezione era una funzione COSTANTE: le
// posizioni 26-31 non venivano raggiunte mai.
//
//   pos 26  0003099324      pos 29  0003198361
//   pos 27  0003128936      pos 30  0003243454
//   pos 28  0003168282      pos 31  0003272475
//
// Il fix e' una finestra rotante derivata dall'orologio, su un ordine
// TOTALE (created_at asc, poi id asc: senza il tiebreak due righe con lo
// stesso timestamp non hanno ordine garantito e la paginazione ne
// ripeterebbe una saltandone un'altra - vedi K3).
//
// LA GARANZIA, nella forma esatta in cui vale:
//   a insieme ordinato STABILE, tutte le candidate rows vengono visitate
//   entro ceil(total / pageSize) tick consecutivi.
// Sotto churn arbitrario non si promette niente di piu' forte: B2 misura
// cosa succede davvero quando dei documenti escono dalla coda.
//
// Una pagina conta CANDIDATE ROWS, non preflight: il .range() sta prima di
// isPurchasableDocument(), quindi 25 righe SQL possono dare meno di 25
// preflight (test L). Nessuno stato da persistere, nessuna colonna nuova,
// nessuna scrittura in piu'.
//
// Questi test girano contro le funzioni di produzione prese da
// pure_logic.cjs (= index.ts transpilato): vdaiPhaseBWindow,
// isPurchasableDocument, vdaiPreflight, vdaiApprove. Il ciclo di Phase B
// vive dentro Deno.serve e quindi non e' in pure_logic: la funzione
// `giroPhaseB` qui sotto lo replica, e il test P lo ancora al sorgente
// perche' non possa divergere.
//
// `node tests/phase-b-fairness.test.js`
// ══════════════════════════════════════════════════════════════════
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { vdaiPhaseBWindow, isPurchasableDocument, vdaiPreflight, vdaiApprove,
        PHASE_B_PAGE_SIZE, PHASE_B_TICK_MS } = require('../pure_logic.cjs');
const CANON = require('../js/vendor-parsers/ben-e-keith-order-confirmation');
const F = require('./fixtures/bek-html-real-shape');

const WORKER = fs.readFileSync(
  path.join(__dirname, '..', 'edge-functions', 'vendor-doc-auto-import', 'index.ts'), 'utf8');

let pass = 0, fail = 0;
async function atest(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message ? e.message : e)); }
}

// Mock Supabase — come negli altri test, piu' il supporto a head/count.
function makeMockSb(tables) {
  function builder(t) {
    const st = { filters: [], single: false, limitN: null, head: false, count: null, range: null };
    const api = {
      select(_c, opts) { if (opts && opts.count) { st.count = opts.count; st.head = !!opts.head; } return api; },
      eq(c, v) { st.filters.push(['eq', c, v]); return api; },
      neq(c, v) { st.filters.push(['neq', c, v]); return api; },
      in(c, v) { st.filters.push(['in', c, v]); return api; },
      not() { return api; }, order() { return api; },
      limit(n) { st.limitN = n; return api; },
      range(a, b) { st.range = [a, b]; return api; },
      single() { st.single = true; return exec(); },
      insert(r) { st.rows = Array.isArray(r) ? r : [r]; st.op = 'insert'; return api; },
      update(d) { st.upd = d; st.op = 'update'; return api; },
      then(a, b) { return run().then(a, b); },
    };
    function run() { if (st.op === 'insert') return w('insert'); if (st.op === 'update') return w('update'); return exec(); }
    function fl(rs) {
      return rs.filter(r => st.filters.every(f =>
        f[0] === 'eq' ? r[f[1]] === f[2] : f[0] === 'neq' ? r[f[1]] !== f[2]
          : f[0] === 'in' ? f[2].includes(r[f[1]]) : true));
    }
    async function exec() {
      let rs = fl(tables[t] || []);
      const total = rs.length;
      if (st.range) rs = rs.slice(st.range[0], st.range[1] + 1);
      if (st.limitN) rs = rs.slice(0, st.limitN);
      if (st.head) return { data: null, count: total, error: null };
      if (st.single) return rs[0] ? { data: rs[0], error: null } : { data: null, error: { message: 'nf' } };
      return { data: rs, count: st.count ? total : null, error: null };
    }
    async function w(k) {
      tables[t] = tables[t] || [];
      if (k === 'insert') { tables[t].push(...st.rows); return { data: st.rows, error: null }; }
      const m = fl(tables[t]); m.forEach(r => Object.assign(r, st.upd)); return { data: m, error: null };
    }
    return api;
  }
  return { tables, from: t => builder(t), storage: { from: () => ({ remove: async () => ({}) }) } };
}

// Ordine TOTALE, come in produzione: created_at asc, poi id asc. Senza il
// tiebreak su id due righe con lo stesso timestamp non hanno ordine
// garantito e la paginazione potrebbe ripetere una riga e saltarne un'altra.
function ordinaTotale(righe) {
  return righe.slice().sort((a, b) => {
    const t = new Date(a.created_at) - new Date(b.created_at);
    return t !== 0 ? t : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

function candidateRows(sb) {
  return ordinaTotale((sb.tables.vendor_documents || [])
    .filter(d => d.status === 'pending' && ['invoice', 'order_confirmation'].includes(d.document_type)));
}

const purchasable = (d) => isPurchasableDocument(
  (d.parsed_json && d.parsed_json.vendor) || d.vendor || '',
  (d.parsed_json && d.parsed_json.document_type) || d.document_type);

// ── Replica ESATTA della selezione di Phase B (index.ts, ramo senza
//    documentId), conteggio incluso perche' il fail-closed passa di li'.
//    Il test P la ancora al sorgente di produzione.
async function selezionaPagina(sb, nowMs) {
  const { count: pendingTotal, error: countErr } = await sb.from('vendor_documents')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending').in('document_type', ['invoice', 'order_confirmation']);
  if (countErr || pendingTotal === null || pendingTotal === undefined) {
    return { saltata: true, motivo: countErr ? countErr.message : 'conteggio nullo', coda: [], finestra: null };
  }
  const w = vdaiPhaseBWindow(pendingTotal, nowMs);
  return {
    saltata: false, finestra: w,
    coda: candidateRows(sb).slice(w.from, w.to + 1).filter(purchasable).slice(0, w.size),
  };
}

// La selezione com'era PRIMA di MT75: sempre dall'inizio.
function selezioneVecchia(sb) {
  return candidateRows(sb).slice(0, 50).filter(purchasable).slice(0, 25);
}

async function giroPhaseB(sb, nowMs) {
  const { finestra, coda, saltata } = await selezionaPagina(sb, nowMs);
  if (saltata) return { finestra: null, saltata: true, visitati: [], importati: [] };
  const visitati = [], importati = [];
  for (const doc of coda) {
    visitati.push(doc.document_number);
    const pre = await vdaiPreflight(sb, doc);
    if (pre.ok && pre.unmatchedCount === 0) {
      const app = await vdaiApprove(sb, doc.id);
      if (app.ok && app.reason !== 'acknowledgement_not_a_purchase') importati.push(doc.document_number);
    }
  }
  return { finestra, visitati, importati };
}

// ── Scenario: 31 pending, gli stessi ruoli della produzione ──────
const CONF = CANON.parse(F.BEK_OPERATIONAL_SAME_SO);
const ACK = CANON.parse(F.BEK_ACKNOWLEDGEMENT);
const SKUS_CONF = CONF.items.map(i => i.vendor_sku || i.item_code);

function doc(n, over) {
  const secondi = String(n).padStart(2, '0');
  return Object.assign({
    id: 'doc-' + n, vendor: 'Ben E. Keith', document_type: 'order_confirmation',
    status: 'pending', document_number: 'SO-' + String(n).padStart(3, '0'),
    document_date: '2026-09-17', created_at: '2026-09-19T10:00:' + secondi + '.000Z',
    parsed_json: Object.assign({ source: 'email_html' }, CONF),
    warnings: null, raw_text: F.BEK_OPERATIONAL_SAME_SO,
  }, over);
}

// SKU mai mappati: i documenti 1..24 restano pending per sempre.
const SKU_ORFANI = CONF.items.map((i, k) => ({ ...i, vendor_sku: 'ORFANO-' + k }));

function scenario() {
  const righe = [];
  for (let n = 1; n <= 24; n++) {
    righe.push(doc(n, { parsed_json: Object.assign({ source: 'email_html' }, CONF, { items: SKU_ORFANI }) }));
  }
  righe.push(doc(25, { document_number: 'ACK-25', parsed_json: Object.assign({ source: 'email_html' }, ACK) }));
  righe.push(doc(26, { document_number: 'CONF-UNMATCHED-26',
                       parsed_json: Object.assign({ source: 'email_html' }, CONF, { items: SKU_ORFANI }) }));
  righe.push(doc(27, { document_number: 'ACK-27', parsed_json: Object.assign({ source: 'email_html' }, ACK) }));
  righe.push(doc(28, { document_number: 'CONF-MAPPATA-28' }));                       // tutti gli SKU mappati
  righe.push(doc(29, { document_number: 'ACK-29', parsed_json: Object.assign({ source: 'email_html' }, ACK) }));
  righe.push(doc(30, { document_number: 'AFTER-IMPORT-30', parsed_json: { source: 'email_html' },
                       warnings: [{ code: 'BEK_REVISION_AFTER_IMPORT', severity: 'blocking',
                                    message: 'gia importato', existing_document_id: 'gia-imported' }] }));
  righe.push(doc(31, { document_number: 'UNKNOWN-31', parsed_json: { source: 'email_html' },
                       warnings: [{ code: 'BEK_REVISION_UNKNOWN', severity: 'blocking',
                                    message: 'classe incerta', sibling_ids: [] }] }));
  // un documento gia' importato: non deve mai essere riselezionato
  righe.push(doc(99, { id: 'gia-imported', document_number: 'IMPORTED-99', status: 'imported',
                       created_at: '2026-09-19T09:00:00.000Z' }));
  return makeMockSb({
    vendor_documents: righe,
    ingredient_vendors: SKUS_CONF.map((s, k) => ({ vendor: 'Ben E. Keith', vendor_sku: s,
                                                   ingredient_id: 'ing-' + k, conversion_to_base: null })),
    vendor_item_aliases: [], ingredient_links: [], invoice_lines: [], invoice_warnings: [], ingredients: [],
  });
}

const T = (k) => k * PHASE_B_TICK_MS;

(async () => {
  console.log('\nMICRO-TASK 75 — fairness della coda di Phase B\n');

  // ── Il test che sarebbe FALLITO prima del fix ──────────────────
  await atest('*. REGRESSIONE: col codice PRE-MT75 le posizioni 26-31 non si raggiungono mai', async () => {
    const sb = scenario();
    const visti = new Set();
    for (let k = 0; k < 10; k++) selezioneVecchia(sb).forEach(d => visti.add(d.document_number));
    assert.strictEqual(visti.size, 25, 'la vecchia selezione vede sempre e solo 25 documenti');
    for (const n of ['CONF-UNMATCHED-26', 'ACK-27', 'CONF-MAPPATA-28', 'ACK-29',
                     'AFTER-IMPORT-30', 'UNKNOWN-31']) {
      assert.ok(!visti.has(n), n + ' non doveva essere raggiungibile prima del fix');
    }
    // e con il fix, due soli giri bastano
    const conFix = new Set();
    for (let k = 0; k < 2; k++) (await selezionaPagina(sb, T(k))).coda.forEach(d => conFix.add(d.document_number));
    assert.strictEqual(conFix.size, 31, 'col fix due giri coprono tutti e 31');
  });

  // ── A ──────────────────────────────────────────────────────────
  await atest('A. giro 1: al massimo 25 documenti, lavoro limitato', async () => {
    const sb = scenario();
    const r = await giroPhaseB(sb, T(0));
    assert.ok(r.visitati.length <= PHASE_B_PAGE_SIZE, 'visitati ' + r.visitati.length);
    assert.strictEqual(r.visitati.length, 25);
    assert.deepStrictEqual(r.finestra, { page: 0, pages: 2, size: 25, from: 0, to: 24 });
  });

  // ── B ──────────────────────────────────────────────────────────
  await atest('B. a insieme STABILE, due giri coprono tutte e 31 le posizioni', async () => {
    const sb = scenario();
    const visti = new Set();
    for (let k = 0; k < 2; k++) (await selezionaPagina(sb, T(k))).coda.forEach(d => visti.add(d.document_number));
    assert.strictEqual(visti.size, 31, 'coperti ' + visti.size + ' su 31');
    for (const n of ['CONF-UNMATCHED-26', 'ACK-27', 'CONF-MAPPATA-28', 'ACK-29',
                     'AFTER-IMPORT-30', 'UNKNOWN-31']) {
      assert.ok(visti.has(n), n + ' non coperto');
    }
  });

  // Il limite onesto della rotazione stateless: quando un documento ESCE dai
  // pending (importato o parcheggiato come ignored) le posizioni scalano, e
  // un documento vicino al confine puo' saltare UN ciclo. Non e' starvation:
  // l'insieme dei pending permanenti e' stabile, quindi la copertura
  // riprende subito. Questo test lo misura invece di nasconderlo.
  await atest('B2. con documenti che escono dalla coda, tutti raggiunti entro pochi giri', async () => {
    const sb = scenario();
    const visti = new Set();
    let giriNecessari = null;
    const attesi = ['CONF-UNMATCHED-26', 'ACK-27', 'CONF-MAPPATA-28', 'ACK-29',
                    'AFTER-IMPORT-30', 'UNKNOWN-31'];
    for (let k = 0; k < 6; k++) {
      (await giroPhaseB(sb, T(k))).visitati.forEach(n => visti.add(n));
      if (giriNecessari === null && attesi.every(n => visti.has(n))) giriNecessari = k + 1;
    }
    assert.ok(giriNecessari !== null, 'non tutti raggiunti in 6 giri: ' + JSON.stringify(attesi.filter(n => !visti.has(n))));
    assert.ok(giriNecessari <= 4, 'serviti ' + giriNecessari + ' giri, troppi');
    console.log('        (raggiunti tutti in ' + giriNecessari + ' giri, contro mai col codice vecchio)');
  });

  // ── C ──────────────────────────────────────────────────────────
  await atest('C. un pending permanentemente unmatched non monopolizza la coda', async () => {
    const sb = scenario();
    const conteggi = {};
    for (let k = 0; k < 6; k++) {
      const r = await giroPhaseB(sb, T(k));
      r.visitati.forEach(n => { conteggi[n] = (conteggi[n] || 0) + 1; });
    }
    // SO-001 e' unmatched per sempre: non deve prendersi tutti i giri
    assert.ok(conteggi['SO-001'] <= 3, 'SO-001 visitato ' + conteggi['SO-001'] + ' volte su 6 giri');
    assert.ok(conteggi['UNKNOWN-31'] >= 3, 'UNKNOWN-31 visitato solo ' + conteggi['UNKNOWN-31'] + ' volte');
  });

  // ── D ──────────────────────────────────────────────────────────
  await atest('D. una conferma completamente mappata in posizione 28 viene importata', async () => {
    const sb = scenario();
    let importata = false;
    for (let k = 0; k < 2 && !importata; k++) {
      const r = await giroPhaseB(sb, T(k));
      if (r.importati.includes('CONF-MAPPATA-28')) importata = true;
    }
    assert.ok(importata, 'doveva essere importata entro un ciclo completo');
    const row = sb.tables.vendor_documents.find(d => d.document_number === 'CONF-MAPPATA-28');
    assert.strictEqual(row.status, 'imported');
    assert.ok(sb.tables.invoice_lines.some(l => l.import_id === row.id), 'doveva scrivere righe');
  });

  // ── E ──────────────────────────────────────────────────────────
  await atest('E. gli acknowledgement non producono nessuna purchase write', async () => {
    const sb = scenario();
    for (let k = 0; k < 2; k++) await giroPhaseB(sb, T(k));
    for (const n of ['ACK-25', 'ACK-27', 'ACK-29']) {
      const row = sb.tables.vendor_documents.find(d => d.document_number === n);
      assert.strictEqual(sb.tables.invoice_lines.filter(l => l.import_id === row.id).length, 0,
        n + ' non deve avere invoice_lines');
      assert.strictEqual(row.status, 'ignored', n + ' deve essere parcheggiato da MT42');
    }
  });

  // ── F, G ───────────────────────────────────────────────────────
  await atest('F. BEK_REVISION_UNKNOWN resta bloccato anche ora che viene visitato', async () => {
    const sb = scenario();
    for (let k = 0; k < 4; k++) await giroPhaseB(sb, T(k));
    const row = sb.tables.vendor_documents.find(d => d.document_number === 'UNKNOWN-31');
    const pre = await vdaiPreflight(sb, row);
    assert.strictEqual(pre.ok, false);
    assert.strictEqual(pre.reason, 'open_question');
    assert.strictEqual(row.status, 'pending', 'mai imported');
    assert.strictEqual(sb.tables.invoice_lines.filter(l => l.import_id === row.id).length, 0);
  });

  await atest('G. BEK_REVISION_AFTER_IMPORT resta bloccato anche ora che viene visitato', async () => {
    const sb = scenario();
    for (let k = 0; k < 4; k++) await giroPhaseB(sb, T(k));
    const row = sb.tables.vendor_documents.find(d => d.document_number === 'AFTER-IMPORT-30');
    const pre = await vdaiPreflight(sb, row);
    assert.strictEqual(pre.ok, false);
    assert.strictEqual(pre.reason, 'open_question');
    assert.strictEqual(row.status, 'pending', 'mai imported');
    assert.strictEqual(sb.tables.invoice_lines.filter(l => l.import_id === row.id).length, 0);
  });

  // ── H, I ───────────────────────────────────────────────────────
  await atest('H. un documento imported non viene mai riselezionato', async () => {
    const sb = scenario();
    for (let k = 0; k < 6; k++) {
      const r = await giroPhaseB(sb, T(k));
      assert.ok(!r.visitati.includes('IMPORTED-99'), 'giro ' + k + ' ha riselezionato un imported');
    }
    const row = sb.tables.vendor_documents.find(d => d.id === 'gia-imported');
    assert.strictEqual(row.status, 'imported');
  });

  await atest('I. nessun documento viene importato due volte', async () => {
    const sb = scenario();
    const tutti = [];
    for (let k = 0; k < 8; k++) (await giroPhaseB(sb, T(k))).importati.forEach(n => tutti.push(n));
    assert.deepStrictEqual(tutti, ['CONF-MAPPATA-28'], 'import visti: ' + JSON.stringify(tutti));
    const row = sb.tables.vendor_documents.find(d => d.document_number === 'CONF-MAPPATA-28');
    const righe = sb.tables.invoice_lines.filter(l => l.import_id === row.id).length;
    assert.strictEqual(righe, CONF.items.length, 'righe scritte una volta sola: ' + righe);
  });

  // ── J ──────────────────────────────────────────────────────────
  await atest('J. la fairness continua oltre i due giri, e vale per qualunque dimensione', () => {
    for (const totale of [1, 24, 25, 26, 31, 49, 50, 51, 100, 260]) {
      const pagine = vdaiPhaseBWindow(totale, 0).pages;
      const coperte = new Set();
      for (let k = 0; k < pagine * 3; k++) {
        const w = vdaiPhaseBWindow(totale, T(k));
        for (let r = w.from; r <= Math.min(w.to, totale - 1); r++) coperte.add(r);
      }
      assert.strictEqual(coperte.size, totale,
        'totale ' + totale + ': coperte ' + coperte.size + ' righe su ' + totale);
      // e ogni singolo ciclo di `pagine` giri consecutivi copre tutto, da qualunque punto parta
      for (const partenza of [0, 1, 7, 13]) {
        const c = new Set();
        for (let k = partenza; k < partenza + pagine; k++) {
          const w = vdaiPhaseBWindow(totale, T(k));
          for (let r = w.from; r <= Math.min(w.to, totale - 1); r++) c.add(r);
        }
        assert.strictEqual(c.size, totale,
          'totale ' + totale + ' da tick ' + partenza + ': coperte ' + c.size);
      }
    }
  });

  await atest('J2. il lavoro resta limitato: mai piu di una pagina per giro', () => {
    for (const totale of [31, 100, 5000]) {
      for (let k = 0; k < 20; k++) {
        const w = vdaiPhaseBWindow(totale, T(k));
        assert.strictEqual(w.to - w.from + 1, PHASE_B_PAGE_SIZE);
      }
    }
  });

  await atest('J3. casi degeneri: zero pending, totale negativo, orologio a zero', () => {
    for (const t of [0, -5, null, undefined]) {
      const w = vdaiPhaseBWindow(t, 0);
      assert.strictEqual(w.pages, 1);
      assert.strictEqual(w.from, 0);
    }
    assert.strictEqual(vdaiPhaseBWindow(31, 0).page, 0);
  });

  // ── K — ordine TOTALE con timestamp identici ───────────────────
  await atest('K. 30 documenti con lo STESSO created_at: due pagine, ogni id una volta sola', async () => {
    const righe = [];
    for (let n = 1; n <= 30; n++) {
      righe.push(doc(n, { id: 'same-' + String(n).padStart(3, '0'),
                          document_number: 'SAME-' + String(n).padStart(3, '0'),
                          created_at: '2026-09-19T10:00:00.000Z' }));   // identico per tutti
    }
    const sb = makeMockSb({ vendor_documents: righe, ingredient_vendors: [], vendor_item_aliases: [],
                            ingredient_links: [], invoice_lines: [], invoice_warnings: [], ingredients: [] });

    const p0 = (await selezionaPagina(sb, T(0))).coda.map(d => d.id);
    const p1 = (await selezionaPagina(sb, T(1))).coda.map(d => d.id);
    assert.strictEqual(p0.length, 25, 'pagina 0: ' + p0.length);
    assert.strictEqual(p1.length, 5, 'pagina 1: ' + p1.length);

    const unione = p0.concat(p1);
    assert.strictEqual(new Set(unione).size, 30, 'qualche id visto due volte o mai');
    assert.strictEqual(unione.length, 30, 'totale visite ' + unione.length + ', attese 30');
    // e il confine 25/26 e' esattamente dove deve stare, per id
    const attesi = righe.map(r => r.id).sort();
    assert.deepStrictEqual(p0, attesi.slice(0, 25), 'pagina 0 non e il prefisso per id');
    assert.deepStrictEqual(p1, attesi.slice(25), 'pagina 1 non e il suffisso per id');
  });

  await atest('K2. timestamp identici A CAVALLO del confine 25/26, piu un blocco distinto', async () => {
    const righe = [];
    // 20 righe con timestamp distinti
    for (let n = 1; n <= 20; n++) righe.push(doc(n, { id: 'a-' + String(n).padStart(3, '0'),
                                                      document_number: 'A-' + n }));
    // 12 righe con lo STESSO identico timestamp, che cadono a cavallo del confine
    for (let n = 1; n <= 12; n++) righe.push(doc(100 + n, { id: 'b-' + String(n).padStart(3, '0'),
                                                            document_number: 'B-' + n,
                                                            created_at: '2026-09-19T11:00:00.000Z' }));
    const sb = makeMockSb({ vendor_documents: righe, ingredient_vendors: [], vendor_item_aliases: [],
                            ingredient_links: [], invoice_lines: [], invoice_warnings: [], ingredients: [] });
    const p0 = (await selezionaPagina(sb, T(0))).coda.map(d => d.id);
    const p1 = (await selezionaPagina(sb, T(1))).coda.map(d => d.id);
    const unione = p0.concat(p1);
    assert.strictEqual(unione.length, 32);
    assert.strictEqual(new Set(unione).size, 32, 'un id e stato visto due volte o saltato');
    // le 12 righe gemelle sono divise fra le due pagine, senza perdite
    const gemelleP0 = p0.filter(i => i.startsWith('b-')).length;
    const gemelleP1 = p1.filter(i => i.startsWith('b-')).length;
    assert.strictEqual(gemelleP0 + gemelleP1, 12, 'gemelle viste: ' + (gemelleP0 + gemelleP1));
    assert.ok(gemelleP0 > 0 && gemelleP1 > 0, 'il confine doveva cadere dentro il blocco gemello');
  });

  await atest('K3. senza tiebreak su id lo stesso scenario perderebbe righe (prova del perche serve)', async () => {
    const righe = [];
    for (let n = 1; n <= 30; n++) righe.push(doc(n, { id: 'same-' + String(n).padStart(3, '0'),
                                                      created_at: '2026-09-19T10:00:00.000Z' }));
    // Ordinamento instabile REALE: fra righe con lo stesso created_at Postgres
    // puo' restituire un ordine qualunque, e puo' cambiarlo fra una query e
    // l'altra (piano diverso, heap riorganizzato, parallelismo). Qui la
    // pagina 0 arriva in un ordine e la pagina 1 in quello opposto.
    const perTimestampSolo = (arr, verso) => arr.slice().sort((a, b) => {
      const t = new Date(a.created_at) - new Date(b.created_at);
      if (t !== 0) return t;
      return verso * (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
    const p0 = perTimestampSolo(righe, 1).slice(0, 25).map(d => d.id);
    const p1 = perTimestampSolo(righe, -1).slice(25, 50).map(d => d.id);
    const unione = new Set(p0.concat(p1));
    assert.ok(unione.size < 30,
      'con un ordine non totale ci si aspetta di perdere righe, viste ' + unione.size + '/30');
    // col tiebreak su id, lo stesso scenario non perde niente: e' il test K.
    assert.strictEqual(unione.size, 25, 'perse esattamente le 5 righe attese, viste ' + unione.size);
  });

  // ── L — popolazione RAW vs purchasable ─────────────────────────
  await atest('L. righe non-purchasable mischiate: la pagina conta CANDIDATE ROWS, non preflight', async () => {
    const righe = [];
    for (let n = 1; n <= 40; n++) {
      const nonAcquistabile = (n % 3 === 0);   // 13 righe su 40, anche a cavallo del 25/26
      righe.push(doc(n, {
        id: 'mix-' + String(n).padStart(3, '0'),
        document_number: (nonAcquistabile ? 'NOPE-' : 'OK-') + String(n).padStart(3, '0'),
        vendor: nonAcquistabile ? "Hardie's Fresh Foods / Dairyland Produce" : 'Ben E. Keith',
        document_type: 'order_confirmation',   // per Hardie's NON e acquistabile
        parsed_json: nonAcquistabile
          ? { source: 'email_html', vendor: "Hardie's Fresh Foods / Dairyland Produce", document_type: 'order_confirmation' }
          : Object.assign({ source: 'email_html' }, CONF),
      }));
    }
    const sb = makeMockSb({ vendor_documents: righe, ingredient_vendors: [], vendor_item_aliases: [],
                            ingredient_links: [], invoice_lines: [], invoice_warnings: [], ingredients: [] });

    const r0 = await selezionaPagina(sb, T(0));
    const r1 = await selezionaPagina(sb, T(1));
    // la pagina ha 25 candidate rows ma meno preflight
    assert.strictEqual(r0.finestra.to - r0.finestra.from + 1, 25, 'la finestra resta di 25 righe SQL');
    assert.ok(r0.coda.length < 25, 'con righe scartate i preflight devono essere meno di 25: ' + r0.coda.length);

    const purch = candidateRows(sb).filter(purchasable).map(d => d.id);
    const visti = new Set(r0.coda.concat(r1.coda).map(d => d.id));
    assert.strictEqual(visti.size, purch.length,
      'coperti ' + visti.size + ' purchasable su ' + purch.length);
    for (const id of purch) assert.ok(visti.has(id), id + ' non raggiunto in un ciclo');
  });

  await atest('L2. un purchasable molto oltre il primo blocco viene comunque raggiunto', async () => {
    const righe = [];
    // 60 righe non-purchasable in testa: riempiono pagina 0, 1 e parte della 2
    for (let n = 1; n <= 60; n++) righe.push(doc(n, {
      id: 'blocco-' + String(n).padStart(3, '0'), document_number: 'NOPE-' + n,
      vendor: "Hardie's Fresh Foods / Dairyland Produce",
      parsed_json: { source: 'email_html', vendor: "Hardie's Fresh Foods / Dairyland Produce",
                     document_type: 'order_confirmation' },
    }));
    // e UNA sola riga acquistabile in fondo, posizione 61
    righe.push(doc(999, { id: 'zzz-lontano', document_number: 'LONTANO-61',
                          created_at: '2026-09-19T23:59:59.000Z' }));

    const sb = makeMockSb({ vendor_documents: righe, ingredient_vendors: [], vendor_item_aliases: [],
                            ingredient_links: [], invoice_lines: [], invoice_warnings: [], ingredients: [] });
    const pagine = vdaiPhaseBWindow(61, 0).pages;
    assert.strictEqual(pagine, 3, 'con 61 righe servono 3 pagine');

    let raggiunto = null;
    for (let k = 0; k < pagine && raggiunto === null; k++) {
      const r = await selezionaPagina(sb, T(k));
      if (r.coda.some(d => d.id === 'zzz-lontano')) raggiunto = k;
    }
    assert.ok(raggiunto !== null, 'la riga in posizione 61 non e stata raggiunta in un ciclo intero');
    // e col codice vecchio non lo sarebbe stato mai
    assert.ok(!selezioneVecchia(sb).some(d => d.id === 'zzz-lontano'),
      'col codice vecchio non doveva essere raggiungibile');
  });

  // ── M — fail closed sul conteggio ──────────────────────────────
  await atest('M. se la count fallisce, Phase B SALTA il giro invece di ripartire da pagina 0', async () => {
    const sb = scenario();
    // la head-query del conteggio fallisce; tutto il resto funziona
    const from = sb.from.bind(sb);
    sb.from = (t) => {
      const b = from(t);
      if (t !== 'vendor_documents') return b;
      const sel = b.select.bind(b);
      b.select = (c, opts) => {
        if (opts && opts.count) {
          const rotto = { eq: () => rotto, in: () => rotto, order: () => rotto, not: () => rotto,
                          limit: () => rotto, range: () => rotto,
                          then: (res) => Promise.resolve({ data: null, count: null,
                                                           error: { message: 'boom: count non disponibile' } }).then(res) };
          return rotto;
        }
        return sel(c, opts);
      };
      return b;
    };

    const r = await giroPhaseB(sb, T(0));
    assert.strictEqual(r.saltata, true, 'il giro doveva essere saltato');
    assert.deepStrictEqual(r.visitati, [], 'nessun documento doveva essere visitato');
    assert.deepStrictEqual(r.importati, [], 'nessun import');
    assert.strictEqual(sb.tables.invoice_lines.length, 0, 'zero invoice_lines');
    assert.ok(sb.tables.vendor_documents.every(d => d.status === (d.id === 'gia-imported' ? 'imported' : 'pending')),
      'nessuno status deve essere cambiato');
    const sel = await selezionaPagina(sb, T(0));
    assert.strictEqual(sel.motivo, 'boom: count non disponibile', 'il motivo deve essere osservabile');
  });

  // ── P — ancoraggio al sorgente di produzione ───────────────────
  await atest('P. il handler: finestra rotante, ordine totale, fail-closed, ramo documentId invariato', () => {
    const h = WORKER.slice(WORKER.indexOf('── PHASE B: pending invoice'));
    const blocco = h.slice(0, h.indexOf('for (const doc of queueB'));

    assert.ok(/count: 'exact', head: true/.test(blocco), 'manca la head-query per il conteggio');
    assert.ok(/error: countErr/.test(blocco), 'il conteggio deve recuperare anche error');
    assert.ok(!/vdaiPhaseBWindow\(pendingTotal \|\| 0/.test(blocco),
      'vdaiPhaseBWindow(pendingTotal || 0) nasconderebbe l errore della count');
    assert.ok(!/pending_total: pendingTotal \|\| 0/.test(blocco),
      'nemmeno il campo osservabile deve mascherare l errore con uno zero');
    assert.ok(/saltaPhaseB = true/.test(blocco), 'sul fallimento del conteggio Phase B deve saltare');
    assert.ok(/reason: 'count_failed'/.test(blocco), 'l errore deve essere osservabile nella risposta');
    assert.ok(/console\.error\('\[vdai\] Phase B saltata/.test(blocco), 'l errore deve finire anche nei log');

    assert.ok(/vdaiPhaseBWindow\(pendingTotal, Date\.now\(\)\)/.test(blocco),
      'la finestra deve venire dalla funzione di produzione');
    assert.ok(/\.range\(finestra\.from, finestra\.to\)/.test(blocco), 'la query deve usare la finestra');
    assert.ok(!/\.limit\(documentId \? 1 : 50\)/.test(blocco), 'il vecchio limit(50) non deve piu esserci');

    assert.ok(/\.order\('created_at', \{ ascending: true \}\)\.order\('id', \{ ascending: true \}\)/.test(blocco),
      'l ordine deve essere TOTALE: created_at poi id');

    assert.ok(/documentId[\s\S]{0,80}\.limit\(1\)/.test(blocco), 'il ramo documentId deve restare a limit(1)');
    assert.ok(/if \(!documentId\) \{/.test(blocco), 'il conteggio non deve girare nel ramo documentId');
  });

  await atest('P2. la documentazione non promette 25 preflight ne garanzie sotto churn', () => {
    const c = WORKER.slice(WORKER.indexOf('MICRO-TASK 75 — finestra ROTANTE'),
                           WORKER.indexOf('const PHASE_B_PAGE_SIZE'));
    assert.ok(/CANDIDATE ROWS/.test(c), 'deve dire candidate rows, non preflight');
    assert.ok(/puo' produrre meno preflight/.test(c), 'deve dire che i preflight possono essere meno');
    assert.ok(/entro ceil\(total \/ pageSize\) tick consecutivi/.test(c),
      'la garanzia va enunciata nella forma esatta');
    assert.ok(/insieme ordinato STABILE/.test(c), 'la garanzia vale a insieme stabile');
    assert.ok(/Sotto churn arbitrario/.test(c), 'il limite sotto churn va detto');
  });

  console.log('\n  ' + pass + ' passati, ' + fail + ' falliti\n');
  process.exit(fail ? 1 : 0);
})();
