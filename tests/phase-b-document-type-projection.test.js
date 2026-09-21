// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 76 — Phase B deve SELEZIONARE le colonne su cui poi fa
// fallback.
//
// Il filtro della coda e':
//   isPurchasableDocument(parsed_json.vendor || d.vendor || '',
//                         parsed_json.document_type || d.document_type)
// ma la query non selezionava document_type. Quel fallback quindi non
// poteva funzionare: d.document_type valeva undefined per ogni riga.
// Finche' parsed_json.document_type c'e' nessuno se ne accorge; i rami
// MT71 e MT72 pero' lasciano parsed_json a { source }, e quei documenti
// venivano scartati PRIMA del preflight.
//
// Osservato in produzione il 19/09 alle 23:25: pagina 1 aveva 8 candidate
// rows e solo 6 preflight, e i due mancanti erano esattamente 0003243454
// (BEK_REVISION_AFTER_IMPORT) e 0003272475 (BEK_REVISION_UNKNOWN).
//
// Phase A faceva gia' la cosa giusta: qA seleziona document_type e
// isBekBodyOnlySource usa lo stesso idioma. MT76 allinea Phase B.
//
// I test modellano la PROJECTION esplicitamente: `proietta()` costruisce la
// riga con le sole colonne della select list, cosi' la differenza fra prima
// e dopo e' esattamente quella che fa PostgREST.
//
// `node tests/phase-b-document-type-projection.test.js`
// ══════════════════════════════════════════════════════════════════
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { isPurchasableDocument, vdaiPreflight, vdaiApprove, vdaiPhaseBWindow } = require('../pure_logic.cjs');
const CANON = require('../js/vendor-parsers/ben-e-keith-order-confirmation');
const F = require('./fixtures/bek-html-real-shape');

const WORKER = fs.readFileSync(
  path.join(__dirname, '..', 'edge-functions', 'vendor-doc-auto-import', 'index.ts'), 'utf8');

let pass = 0, fail = 0;
async function atest(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message ? e.message : e)); }
}

function makeMockSb(tables) {
  function builder(t) {
    const st = { filters: [], single: false, limitN: null, head: false, count: null, range: null };
    const api = {
      select(_c, o) { if (o && o.count) { st.count = o.count; st.head = !!o.head; } return api; },
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
      const tot = rs.length;
      if (st.range) rs = rs.slice(st.range[0], st.range[1] + 1);
      if (st.limitN) rs = rs.slice(0, st.limitN);
      if (st.head) return { data: null, count: tot, error: null };
      if (st.single) return rs[0] ? { data: rs[0], error: null } : { data: null, error: { message: 'nf' } };
      return { data: rs, count: st.count ? tot : null, error: null };
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

// ── Le due select list, quella vecchia e quella di MT76 ──────────
const SELECT_PRIMA = 'id,parsed_json,vendor,warnings,status,document_number,document_date';
const SELECT_DOPO  = 'id,parsed_json,vendor,document_type,warnings,status,document_number,document_date';

// Modella PostgREST: la riga che arriva al codice ha SOLO le colonne chieste.
function proietta(riga, selectList) {
  const colonne = selectList.split(',');
  const out = {};
  for (const c of colonne) if (c in riga) out[c] = riga[c];
  return out;
}

// Il filtro esatto del handler (index.ts), invariato da MT76.
const filtroPurchasable = (d) => isPurchasableDocument(
  (d.parsed_json && d.parsed_json.vendor) || d.vendor || '',
  (d.parsed_json && d.parsed_json.document_type) || d.document_type);

const CONF = CANON.parse(F.BEK_OPERATIONAL_SAME_SO);

function riga(over) {
  return Object.assign({
    id: 'doc-1', vendor: 'Ben E. Keith', document_type: 'order_confirmation',
    status: 'pending', document_number: '0003243454', document_date: '2026-09-17',
    created_at: '2026-09-19T20:11:47.716Z',
    parsed_json: { source: 'email_html' },       // come lo lasciano MT71/MT72
    warnings: null, raw_text: F.BEK_OPERATIONAL_SAME_SO,
  }, over);
}

const W_UNKNOWN = [{ code: 'BEK_REVISION_UNKNOWN', severity: 'blocking',
                     message: "Sales Order 0003272475 non e' classificabile con certezza (classe: ambiguous)",
                     sibling_ids: [] }];
const W_AFTER = [{ code: 'BEK_REVISION_AFTER_IMPORT', severity: 'blocking',
                   message: 'Sales Order 0003243454 already has an imported purchase (document 8afad7e2).',
                   existing_document_id: 'originale-imported' }];

function tabelle(righe, extra) {
  return Object.assign({
    vendor_documents: righe, ingredient_vendors: [], vendor_item_aliases: [],
    ingredient_links: [], invoice_lines: [], invoice_warnings: [], ingredients: [],
  }, extra || {});
}

(async () => {
  console.log('\nMICRO-TASK 76 — document_type nella projection di Phase B\n');

  // ── REGRESSIONE ────────────────────────────────────────────────
  await atest('*. REGRESSIONE: con la select PRIMA di MT76 la riga viene scartata', () => {
    const r = riga({ warnings: W_UNKNOWN });
    assert.strictEqual(filtroPurchasable(proietta(r, SELECT_PRIMA)), false,
      'con la vecchia projection il documento doveva essere scartato');
    assert.strictEqual(filtroPurchasable(proietta(r, SELECT_DOPO)), true,
      'con la nuova projection deve passare');
    // e la colonna c era, nel database: era la SELECT a non chiederla
    assert.strictEqual(r.document_type, 'order_confirmation');
    assert.strictEqual('document_type' in proietta(r, SELECT_PRIMA), false);
  });

  // ── A ──────────────────────────────────────────────────────────
  await atest('A. vendor e document_type solo nelle colonne, parsed_json senza tipo -> purchasable', () => {
    const d = proietta(riga({ parsed_json: { source: 'email_html' } }), SELECT_DOPO);
    assert.strictEqual(d.vendor, 'Ben E. Keith');
    assert.strictEqual(d.document_type, 'order_confirmation');
    assert.strictEqual('document_type' in d.parsed_json, false, 'parsed_json non deve avere il tipo');
    assert.strictEqual(filtroPurchasable(d), true, 'il fallback sulla colonna deve funzionare');
  });

  await atest('A2. il fallback su vendor continua a funzionare come prima', () => {
    const d = proietta(riga({ vendor: 'Ben E. Keith', parsed_json: { source: 'email_html' } }), SELECT_DOPO);
    assert.strictEqual(filtroPurchasable(d), true);
    // e parsed_json, quando c e, continua a vincere sulla colonna
    const d2 = proietta(riga({ vendor: 'Vendor Sbagliato',
                               parsed_json: Object.assign({ source: 'email_html' }, CONF) }), SELECT_DOPO);
    assert.strictEqual(filtroPurchasable(d2), true, 'parsed_json ha la precedenza');
  });

  // ── B ──────────────────────────────────────────────────────────
  await atest('B. BEK_REVISION_UNKNOWN: passa il filtro, ARRIVA al preflight, open_question, resta pending', async () => {
    const r = riga({ id: 'unknown-1', document_number: '0003272475', warnings: W_UNKNOWN });
    const d = proietta(r, SELECT_DOPO);
    assert.strictEqual(filtroPurchasable(d), true, 'deve entrare in coda');

    const sb = makeMockSb(tabelle([JSON.parse(JSON.stringify(r))]));
    const doc = sb.tables.vendor_documents[0];
    const pre = await vdaiPreflight(sb, doc);
    assert.strictEqual(pre.ok, false, 'il preflight deve rifiutare');
    assert.strictEqual(pre.reason, 'open_question', 'deve fermarlo il warning');

    // il handler chiama vdaiApprove solo se pre.ok && unmatched === 0
    assert.strictEqual(pre.ok && pre.unmatchedCount === 0, false, 'non deve arrivare ad approve');
    const app = await vdaiApprove(sb, doc.id);   // forzato, per prova
    assert.strictEqual(app.ok, false, 'e comunque approve rifiuta');

    assert.strictEqual(sb.tables.vendor_documents[0].status, 'pending', 'mai imported');
    assert.strictEqual(sb.tables.invoice_lines.length, 0, 'zero invoice_lines');
  });

  // ── C ──────────────────────────────────────────────────────────
  await atest('C. BEK_REVISION_AFTER_IMPORT: arriva al preflight, bloccato, originale intatto', async () => {
    const nuova = riga({ id: 'dopo-import', document_number: '0003243454', warnings: W_AFTER });
    const originale = riga({ id: 'originale-imported', status: 'imported', warnings: null,
                             created_at: '2026-09-18T22:26:27.489Z',
                             parsed_json: Object.assign({ source: 'email_html' }, CONF) });
    const righeOriginale = Array.from({ length: 8 }, (_, i) =>
      ({ id: 'l' + i, import_id: 'originale-imported', vendor: 'Ben E. Keith', quantity: 1 }));

    const d = proietta(nuova, SELECT_DOPO);
    assert.strictEqual(filtroPurchasable(d), true, 'deve entrare in coda');

    const sb = makeMockSb(tabelle(
      [JSON.parse(JSON.stringify(nuova)), JSON.parse(JSON.stringify(originale))],
      { invoice_lines: righeOriginale.map(x => Object.assign({}, x)) }));
    const doc = sb.tables.vendor_documents[0];

    const pre = await vdaiPreflight(sb, doc);
    assert.strictEqual(pre.ok, false);
    assert.strictEqual(pre.reason, 'open_question');
    assert.strictEqual(pre.ok && pre.unmatchedCount === 0, false, 'non deve arrivare ad approve');
    const app = await vdaiApprove(sb, doc.id);
    assert.strictEqual(app.ok, false, 'nessun secondo import');

    const orig = sb.tables.vendor_documents.find(x => x.id === 'originale-imported');
    assert.strictEqual(orig.status, 'imported', 'l originale resta imported');
    assert.deepStrictEqual(sb.tables.invoice_lines, righeOriginale,
      'le 8 righe dell originale non devono essere toccate');
    assert.strictEqual(sb.tables.invoice_lines.filter(l => l.import_id === 'dopo-import').length, 0,
      'la nuova revisione non deve scrivere righe');
    assert.strictEqual(sb.tables.vendor_documents[0].status, 'pending');
  });

  // ── D ──────────────────────────────────────────────────────────
  await atest('D. un documento davvero non-purchasable resta escluso', () => {
    // Hardie's order_confirmation: non acquistabile ne da parsed_json ne da colonna
    const hardiesOC = proietta(riga({
      vendor: "Hardie's Fresh Foods / Dairyland Produce", document_type: 'order_confirmation',
      parsed_json: { source: 'email_html', vendor: "Hardie's Fresh Foods / Dairyland Produce",
                     document_type: 'order_confirmation' },
    }), SELECT_DOPO);
    assert.strictEqual(filtroPurchasable(hardiesOC), false, 'Hardie s order_confirmation non e un acquisto');

    // e nemmeno con parsed_json vuoto: ora il fallback legge la colonna, che dice order_confirmation
    const hardiesOCvuoto = proietta(riga({
      vendor: "Hardie's Fresh Foods / Dairyland Produce", document_type: 'order_confirmation',
      parsed_json: { source: 'email_html' },
    }), SELECT_DOPO);
    assert.strictEqual(filtroPurchasable(hardiesOCvuoto), false,
      'la patch non deve far passare cio che non e acquistabile');

    // un vendor sconosciuto resta fuori
    const ignoto = proietta(riga({ vendor: 'Vendor Mai Visto', parsed_json: { source: 'email_html' } }), SELECT_DOPO);
    assert.strictEqual(filtroPurchasable(ignoto), false);

    // e una riga senza vendor ne tipo da nessuna parte resta fuori
    const vuota = proietta(riga({ vendor: null, document_type: null, parsed_json: {} }), SELECT_DOPO);
    assert.strictEqual(filtroPurchasable(vuota), false);
  });

  // ── E ──────────────────────────────────────────────────────────
  await atest('E. la finestra rotante di MT75 non e toccata', () => {
    // la funzione e identica
    assert.deepStrictEqual(vdaiPhaseBWindow(33, 0), { page: 0, pages: 2, size: 25, from: 0, to: 24 });
    assert.deepStrictEqual(vdaiPhaseBWindow(33, 5 * 60 * 1000), { page: 1, pages: 2, size: 25, from: 25, to: 49 });
    // e il sorgente del blocco finestra non e cambiato
    const h = WORKER.slice(WORKER.indexOf('── PHASE B: pending invoice'));
    const blocco = h.slice(0, h.indexOf('for (const doc of queueB'));
    assert.ok(/vdaiPhaseBWindow\(pendingTotal, Date\.now\(\)\)/.test(blocco));
    assert.ok(/\.range\(finestra\.from, finestra\.to\)/.test(blocco));
    assert.ok(/saltaPhaseB = true/.test(blocco), 'il fail-closed di MT75 resta');
    assert.ok(/\.order\('created_at', \{ ascending: true \}\)\.order\('id', \{ ascending: true \}\)/.test(blocco),
      'l ordine totale di MT75 resta');
  });

  // TRE POPOLAZIONI DISTINTE, e non vanno mai confuse. Lo scenario qui sotto
  // riproduce esattamente quella di produzione al 19/09:
  //   33  candidate rows   righe che la query SQL restituisce
  //                        (status pending, document_type invoice|order_confirmation)
  //   31  purchasable      quelle che passano isPurchasableDocument, cioe' 33
  //                        meno 2 order_confirmation Hardie's che non sono
  //                        acquisti. Questo numero NON dipende dalla projection.
  //   29  preflight PRE-MT76   perche' i 2 BEK con parsed_json incompleto
  //                            venivano scartati dal fallback morto
  //   31  preflight POST-MT76  i due tornano dentro
  // Le candidate rows restano 33 in entrambi i casi: MT76 non cambia la query,
  // cambia solo quali righe sopravvivono al filtro.
  await atest('E2. tre popolazioni: 33 candidate, 31 purchasable, preflight 29 -> 31', () => {
    const righe = [];
    // 29 BEK order_confirmation con parsed_json completo: acquistabili sempre
    for (let n = 1; n <= 29; n++) righe.push(riga({
      id: 'ok-' + String(n).padStart(3, '0'), document_number: 'SO-' + n,
      created_at: '2026-09-19T10:00:' + String(n).padStart(2, '0') + '.000Z',
      parsed_json: Object.assign({ source: 'email_html' }, CONF) }));
    // 2 order_confirmation Hardie's: candidate rows, ma NON acquistabili, mai
    for (let n = 1; n <= 2; n++) righe.push(riga({
      id: 'hardies-' + n, document_number: 'HARD-' + n,
      created_at: '2026-09-19T09:00:0' + n + '.000Z',
      vendor: "Hardie's Fresh Foods / Dairyland Produce",
      document_type: 'order_confirmation',
      parsed_json: { source: 'email_html', vendor: "Hardie's Fresh Foods / Dairyland Produce",
                     document_type: 'order_confirmation' } }));
    // 2 BEK con parsed_json incompleto: i casi MT71/MT72
    righe.push(riga({ id: 'z-32', document_number: '0003243454', warnings: W_AFTER,
                      created_at: '2026-09-19T11:00:00.000Z' }));
    righe.push(riga({ id: 'z-33', document_number: '0003272475', warnings: W_UNKNOWN,
                      created_at: '2026-09-19T11:00:01.000Z' }));

    const ordinate = righe.slice().sort((a, b) => {
      const t = new Date(a.created_at) - new Date(b.created_at);
      return t !== 0 ? t : (a.id < b.id ? -1 : 1);
    });

    // POPOLAZIONE 1 — candidate rows: quante righe la query restituisce.
    // Identica prima e dopo: MT76 non tocca where, order ne range.
    assert.strictEqual(ordinate.length, 33, 'lo scenario deve avere 33 candidate rows');
    const pagine = vdaiPhaseBWindow(ordinate.length, 0).pages;
    const candidatePerCiclo = new Set();
    for (let k = 0; k < pagine; k++) {
      const w = vdaiPhaseBWindow(ordinate.length, k * 5 * 60 * 1000);
      ordinate.slice(w.from, w.to + 1).forEach(r => candidatePerCiclo.add(r.id));
    }
    assert.strictEqual(candidatePerCiclo.size, 33,
      'un ciclo deve toccare tutte e 33 le candidate rows: ' + candidatePerCiclo.size);

    // POPOLAZIONE 2 — purchasable: non dipende dalla projection, perche' per
    // queste righe il tipo e' nel database in un modo o nell'altro.
    const purchasableVeri = ordinate.filter(r => filtroPurchasable(r)).map(r => r.id);
    assert.strictEqual(purchasableVeri.length, 31,
      '31 righe sono davvero acquistabili, le 2 Hardie s no: ' + purchasableVeri.length);

    // POPOLAZIONE 3 — preflight, che e' l'unica che MT76 cambia.
    const preflightCon = (selectList) => {
      const visti = new Set();
      for (let k = 0; k < pagine; k++) {
        const w = vdaiPhaseBWindow(ordinate.length, k * 5 * 60 * 1000);
        ordinate.slice(w.from, w.to + 1)
          .map(r => proietta(r, selectList))
          .filter(filtroPurchasable)
          .forEach(d => visti.add(d.id));
      }
      return visti;
    };

    const pre = preflightCon(SELECT_PRIMA);
    assert.strictEqual(pre.size, 29,
      'PRE-MT76 i preflight in un ciclo devono essere 29: ' + pre.size);
    assert.ok(!pre.has('z-32') && !pre.has('z-33'),
      'PRE-MT76 i due casi MT71/MT72 non devono comparire');
    assert.ok(!pre.has('hardies-1') && !pre.has('hardies-2'),
      'le Hardie s order_confirmation non devono comparire nemmeno prima');

    const post = preflightCon(SELECT_DOPO);
    assert.strictEqual(post.size, 31,
      'POST-MT76 i preflight in un ciclo devono essere 31: ' + post.size);
    assert.ok(post.has('z-32') && post.has('z-33'),
      'POST-MT76 i due casi MT71/MT72 devono finalmente arrivare al preflight');
    assert.ok(!post.has('hardies-1') && !post.has('hardies-2'),
      'MT76 non deve far passare cio che non e acquistabile');

    // la differenza e' esattamente due righe, e sono quelle due
    const differenza = [...post].filter(id => !pre.has(id)).sort();
    assert.deepStrictEqual(differenza, ['z-32', 'z-33'],
      'MT76 deve aggiungere quei due e nessun altro: ' + JSON.stringify(differenza));

    // e le candidate rows restano 33 anche con la vecchia projection: la
    // query non e' cambiata, e' cambiato solo cosa sopravvive al filtro
    assert.strictEqual(candidatePerCiclo.size, 33);
  });

  // ── P — ancoraggio al sorgente ─────────────────────────────────
  await atest('P. la select di Phase B contiene document_type, e il filtro non e cambiato', () => {
    const h = WORKER.slice(WORKER.indexOf('── PHASE B: pending invoice'));
    const blocco = h.slice(0, h.indexOf('for (const doc of queueB'));
    assert.ok(blocco.includes("select('" + SELECT_DOPO + "')"),
      'la select list di Phase B deve essere quella di MT76');
    assert.ok(!blocco.includes("select('" + SELECT_PRIMA + "')"), 'la vecchia select non deve restare');
    // INV08C ha cambiato il filtro DI PROPOSITO: Phase B instrada anche i
    // credit_memo, verso vendor_credits e non verso invoice_lines. Quello
    // che MT76 proteggeva resta pero' intatto, e lo si verifica pezzo per
    // pezzo invece che verbatim: la regola di acquistabilita' e' ancora
    // applicata, e ancora con gli stessi due fallback parsed_json -> colonna.
    assert.ok(/const v = \(d\.parsed_json && d\.parsed_json\.vendor\) \|\| d\.vendor \|\| '';/.test(blocco),
      'il fallback sul vendor deve restare parsed_json -> colonna');
    assert.ok(/const t = \(d\.parsed_json && d\.parsed_json\.document_type\) \|\| d\.document_type;/.test(blocco),
      'il fallback sul tipo deve restare parsed_json -> colonna, che e\' il punto di MT76');
    assert.ok(/isPurchasableDocument\(v, t\)/.test(blocco),
      'la regola di acquistabilita\' deve essere ancora applicata');
    assert.ok(/t === 'credit_memo' \|\| isPurchasableDocument/.test(blocco),
      'i credit_memo passano ACCANTO alla regola, non attraverso di essa');
  });

  await atest('P2. Phase A resta com era: gia selezionava document_type', () => {
    assert.ok(/let qA = sb\.from\('vendor_documents'\)\.select\('id,parsed_json,source_email_subject,raw_text,vendor,status,created_at,document_type'\)/.test(WORKER),
      'la select di Phase A non deve essere toccata');
    assert.ok(/const docType = pj\.document_type \|\| doc\.document_type \|\| '';/.test(WORKER),
      'isBekBodyOnlySource usa lo stesso idioma e resta invariato');
  });

  console.log('\n  ' + pass + ' passati, ' + fail + ' falliti\n');
  process.exit(fail ? 1 : 0);
})();
