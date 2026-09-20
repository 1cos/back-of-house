// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 81 — Phase A e il reprocess della UI devono prendere LA
// STESSA decisione BEK post-parse.
//
// MT80 ha misurato che il reprocess riscriveva `warnings` con le sole
// warning del parser: BEK_REVISION_AFTER_IMPORT e BEK_REVISION_UNKNOWN
// sparivano, e Phase A non le rigenerava mai piu' perche' lavora solo su
// status 'pdf_received'.
//
// La toppa sarebbe stata copiare la sezione F nel browser. Sarebbe stata la
// QUARTA copia di una decisione che questo progetto ha gia' pagato tre volte
// (MT76 projection, MT78 regex, MT79 gate). La decisione sta ora in
// js/vendor-parsers/bek-post-parse-safety.js e i due percorsi la chiamano.
//
// Questo file NON verifica che il modulo esista: verifica che i DUE PERCORSI
// REALI, eseguiti sugli stessi dati, arrivino allo stesso verdetto. Se
// domani uno dei due smette di usare la logica comune, la matrice del
// gruppo C fallisce da sola.
//
// `NODE_PATH=<testenv> node tests/bek-post-parse-decision-parity.test.js`
// ══════════════════════════════════════════════════════════════════
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const R = path.join(__dirname, '..');
const { processOneQueuedDoc, isBlockingWarning } = require(path.join(R, 'pure_logic.cjs'));
const PARSERS = require(path.join(R, 'js', 'vendor-parsers'));
const CANON   = require(path.join(R, 'js', 'vendor-parsers', 'ben-e-keith-order-confirmation'));
const SAFETY_MOD = require(path.join(R, 'js', 'vendor-parsers', 'bek-post-parse-safety'));
const F = require('./fixtures/bek-html-real-shape');

const WORKER = fs.readFileSync(path.join(R, 'edge-functions', 'vendor-doc-auto-import', 'index.ts'), 'utf8');
const UI_SRC = fs.readFileSync(path.join(R, 'js', 'vendor-documents-review.js'), 'utf8');
const VPU_SRC = fs.readFileSync(path.join(R, 'js', 'vendor-parser-ui.js'), 'utf8');
const SAFETY_SRC = fs.readFileSync(path.join(R, 'js', 'vendor-parsers', 'bek-post-parse-safety.js'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(R, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function test(n, f) { try { f(); pass++; console.log('  ✓ ' + n); }
  catch (e) { fail++; console.log('  ✗ ' + n + '\n      ' + (e && e.message ? e.message : e)); } }
async function atest(n, f) { try { await f(); pass++; console.log('  ✓ ' + n); }
  catch (e) { fail++; console.log('  ✗ ' + n + '\n      ' + (e && e.message ? e.message : e)); } }

// ── Ambiente browser per il percorso reprocess ────────────────────
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;
global.window = global.window || {};
global.window.BekOrderConfirmationParser = CANON;
global.window.BekPostParseSafety = SAFETY_MOD;

// ── Mock Supabase condiviso dai due percorsi ──────────────────────
function makeSb(tables) {
  const scritture = [];
  function builder(t) {
    const st = { filters: [], single: false, limitN: null };
    const api = {
      select() { return api; }, eq(c, v) { st.filters.push(['eq', c, v]); return api; },
      neq(c, v) { st.filters.push(['neq', c, v]); return api; },
      in(c, v) { st.filters.push(['in', c, v]); return api; },
      not() { return api; }, limit(n) { st.limitN = n; return api; }, order() { return api; },
      single() { st.single = true; return exec(); },
      insert(r) { st.rows = Array.isArray(r) ? r : [r]; st.op = 'insert'; return api; },
      update(d) { st.upd = d; st.op = 'update'; return api; },
      then(a, b) { return run().then(a, b); },
    };
    function run() { if (st.op === 'insert') return w('insert'); if (st.op === 'update') return w('update'); return exec(); }
    function filt(rows) {
      return rows.filter((r) => st.filters.every((f2) =>
        f2[0] === 'eq' ? r[f2[1]] === f2[2] : f2[0] === 'neq' ? r[f2[1]] !== f2[2]
          : f2[0] === 'in' ? f2[2].includes(r[f2[1]]) : true));
    }
    async function exec() {
      let rows = filt(tables[t] || []);
      if (st.limitN) rows = rows.slice(0, st.limitN);
      return st.single ? (rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'nf' } })
                       : { data: rows, error: null };
    }
    async function w(k) {
      tables[t] = tables[t] || [];
      if (k === 'insert') { tables[t].push(...st.rows); return { data: st.rows, error: null }; }
      const m = filt(tables[t]);
      scritture.push({ table: t, ids: m.map((r) => r.id), patch: st.upd });
      m.forEach((r) => Object.assign(r, st.upd));
      return { data: m, error: null };
    }
    return api;
  }
  return {
    sb: { from: builder, storage: { from: () => ({ remove: async () => ({}), download: async () => ({ data: null, error: { message: 'no' } }) }) } },
    scritture,
  };
}

function caricaUI(sb) {
  const fn = new Function('window', 'document', VPU_SRC + '\n' + UI_SRC);
  fn(global.window, global.document);
  global.window.supabaseClient = sb;
  // Senza questo vdrProcessAllPdf attende il <script> di PDF.js dal CDN, che
  // in jsdom non risponde mai. I documenti di questo file sono tutti
  // body-only (source: 'email_html'): nessun PDF viene mai aperto.
  global.window.pdfjsLib = global.window.pdfjsLib || { GlobalWorkerOptions: {}, getDocument() { throw new Error('nessun PDF in questi scenari'); } };
}

// ── Fixture: varianti di buyer sullo stesso HTML reale ────────────
const EMAIL_KITCHEN = 'raven_wolf_1510@yahoo.com';
function conBuyer(html, email) {
  return html.replace(new RegExp(EMAIL_KITCHEN, 'g'), email);
}
const HTML_OPERATIONAL = F.BEK_OPERATIONAL_SAME_SO;         // operational_confirmation
const HTML_ACK         = F.BEK_ACKNOWLEDGEMENT;             // acknowledgement
const HTML_AMBIGUOUS   = F.BEK_AMBIGUOUS_CANCELLED;         // ambiguous
const HTML_FOH         = conBuyer(HTML_OPERATIONAL, 'zeno@zenosonthesquare.com');
const HTML_IGNOTO      = conBuyer(HTML_OPERATIONAL, 'chi.e.costui@example.com');

const SO_OP  = CANON.parse(HTML_OPERATIONAL).document_number;
const SO_ACK = CANON.parse(HTML_ACK).document_number;
const SO_AMB = CANON.parse(HTML_AMBIGUOUS).document_number;

function riga(id, html, over) {
  return Object.assign({
    id, vendor: 'Ben E. Keith', document_type: 'order_confirmation',
    status: 'pdf_received', document_number: null, document_date: null,
    created_at: '2026-09-20T10:00:00Z',
    parsed_json: { source: 'email_html' }, warnings: [],
    raw_text: html, source_email_subject: 'Ben E. Keith : Order Confirmation;x',
  }, over || {});
}
function skuMappati(html) {
  return CANON.parse(html).items.map((i, n) => ({
    vendor: 'Ben E. Keith', vendor_sku: i.vendor_sku || i.item_code,
    ingredient_id: 'ing-' + n, conversion_to_base: null,
  }));
}
function tabelle(righe, html) {
  return {
    vendor_documents: righe, ingredient_vendors: skuMappati(html),
    vendor_item_aliases: [], ingredient_links: [], invoice_lines: [],
    invoice_warnings: [], ingredients: [],
  };
}

// Solo le warning che descrivono il rapporto col resto del database.
// Le warning del parser sono legittimamente diverse fra i due percorsi:
// il reprocess le conserva accanto a queste, Phase A in alcuni rami no.
const STATE_CODES = ['BEK_REVISION_AFTER_IMPORT', 'BEK_REVISION_UNKNOWN',
                     'BEK_BUYER_EXCLUDED', 'BEK_BUYER_NOT_ALLOWED'];
function verdetto(tables, docId) {
  const d = tables.vendor_documents.find((r) => r.id === docId);
  const w = Array.isArray(d.warnings) ? d.warnings : [];
  return {
    status: d.status,
    stateWarnings: w.map((x) => x.code).filter((c) => STATE_CODES.includes(c)).sort(),
    existing: (w.find((x) => x.code === 'BEK_REVISION_AFTER_IMPORT') || {}).existing_document_id || null,
    superati: tables.vendor_documents.filter((r) => r.id !== docId && r.status === 'ignored').map((r) => r.id).sort(),
  };
}

// Esegue lo STESSO scenario nei due percorsi e restituisce i due verdetti.
async function dueVie(costruisciRighe, html, docId) {
  const tA = tabelle(costruisciRighe(), html);
  const { sb: sbA } = makeSb(tA);
  await processOneQueuedDoc(sbA, tA.vendor_documents.find((r) => r.id === docId), PARSERS);

  const tB = tabelle(costruisciRighe(), html);
  const { sb: sbB } = makeSb(tB);
  caricaUI(sbB);
  await global.window.vdrProcessAllPdf(docId);

  return { phaseA: verdetto(tA, docId), reprocess: verdetto(tB, docId), tA, tB };
}

(async () => {
  console.log('\nMICRO-TASK 81 — una sola decisione BEK, due percorsi\n');

  // ════════════════════════════════════════════════════════════════
  console.log('A. I due documenti reali');
  // ════════════════════════════════════════════════════════════════

  await atest('1. 0003243454: dopo Reprocess la barriera viene RIGENERATA, non conservata', async () => {
    const IMPORTATO = 'imported-8afad7e2';
    const tables = tabelle([
      riga('rev-0003243454', HTML_OPERATIONAL, {
        status: 'pending', document_number: SO_OP,
        // la vecchia warning c'e', ma non e' lei a dover salvare la situazione
        warnings: [{ code: 'BEK_REVISION_AFTER_IMPORT', severity: 'blocking', message: 'vecchia' }],
      }),
      riga(IMPORTATO, HTML_OPERATIONAL, {
        status: 'imported', document_number: SO_OP, parsed_json: CANON.parse(HTML_OPERATIONAL),
        created_at: '2026-09-19T02:00:00Z', updated_at: '2026-09-19T02:55:20.828446+00',
      }),
    ], HTML_OPERATIONAL);
    const primaUpdatedAt = tables.vendor_documents.find((r) => r.id === IMPORTATO).updated_at;
    const { sb } = makeSb(tables);
    caricaUI(sb);
    await global.window.vdrProcessAllPdf('rev-0003243454');

    const d = tables.vendor_documents.find((r) => r.id === 'rev-0003243454');
    const w = (d.warnings || []).find((x) => x.code === 'BEK_REVISION_AFTER_IMPORT');
    assert.ok(w, 'BEK_REVISION_AFTER_IMPORT non rigenerata');
    assert.strictEqual(w.existing_document_id, IMPORTATO,
      'la warning non punta al documento importato trovato ADESSO');
    assert.ok(/already has an imported purchase/.test(w.message),
      'e\' la vecchia warning conservata, non una rigenerata');
    assert.strictEqual(d.status, 'pending');
    assert.ok(d.parsed_json && d.parsed_json.items && d.parsed_json.items.length > 0,
      'il reprocess deve comunque aver scritto il parsed_json fresco');

    // i due gate si fermano
    assert.strictEqual(isBlockingWarning({ code: 'BEK_REVISION_AFTER_IMPORT' }, null, {}), true);

    // l'import originale e' intatto
    const orig = tables.vendor_documents.find((r) => r.id === IMPORTATO);
    assert.strictEqual(orig.status, 'imported');
    assert.strictEqual(orig.updated_at, primaUpdatedAt,
      'updated_at dell\'import originale toccato: il reprocess ha scritto su di lui');
    assert.ok(primaUpdatedAt, 'il fixture deve avere un updated_at, o l\'asserzione non prova nulla');
    assert.strictEqual(tables.invoice_lines.length, 0, 'nessuna invoice_line scritta');
  });

  await atest('2. 0003272475: classe ancora ambiguous -> BEK_REVISION_UNKNOWN RICALCOLATA', async () => {
    const tables = tabelle([
      riga('amb-0003272475', HTML_AMBIGUOUS, {
        status: 'pending', document_number: SO_AMB,
        warnings: [{ code: 'BEK_REVISION_UNKNOWN', severity: 'blocking', message: 'vecchia' }],
      }),
    ], HTML_AMBIGUOUS);
    const { sb } = makeSb(tables);
    caricaUI(sb);
    await global.window.vdrProcessAllPdf('amb-0003272475');

    const d = tables.vendor_documents.find((r) => r.id === 'amb-0003272475');
    const codes = (d.warnings || []).map((x) => x.code);
    const w = (d.warnings || []).find((x) => x.code === 'BEK_REVISION_UNKNOWN');
    assert.ok(w, 'BEK_REVISION_UNKNOWN non rigenerata');
    assert.notStrictEqual(w.message, 'vecchia', 'e\' la vecchia warning conservata, non ricalcolata');
    assert.ok(/non e' classificabile con certezza/.test(w.message));
    assert.strictEqual(d.status, 'pending');
    // le warning del parser sopravvivono accanto a quella di stato
    assert.ok(codes.includes('BEK_CLASS_AMBIGUOUS'),
      'le warning parser-derived devono essere mantenute');
    assert.strictEqual(tables.invoice_lines.length, 0);
  });

  await atest('3. CONTROLLO POSITIVO: era UNKNOWN, il nuovo parse e\' classificabile -> procede', async () => {
    // Stesso documento, stessa vecchia warning, ma il raw_text ora e' una
    // conferma operativa leggibile. Se stessimo preservando, resterebbe
    // bloccato per sempre.
    const tables = tabelle([
      riga('era-unknown', HTML_OPERATIONAL, {
        status: 'pending', document_number: SO_OP,
        warnings: [{ code: 'BEK_REVISION_UNKNOWN', severity: 'blocking', message: 'vecchia' }],
      }),
    ], HTML_OPERATIONAL);
    const { sb } = makeSb(tables);
    caricaUI(sb);
    await global.window.vdrProcessAllPdf('era-unknown');

    const d = tables.vendor_documents.find((r) => r.id === 'era-unknown');
    const codes = (d.warnings || []).map((x) => x.code);
    assert.ok(!codes.includes('BEK_REVISION_UNKNOWN'),
      'la vecchia UNKNOWN e\' sopravvissuta: stiamo preservando invece di ricalcolare');
    assert.ok(!codes.includes('BEK_REVISION_AFTER_IMPORT'));
    assert.strictEqual(d.status, 'pending', 'senza altre barriere il documento procede');
  });

  // ════════════════════════════════════════════════════════════════
  console.log('\nB. Ruolo di BEK_CLASS_AMBIGUOUS / BEK_STATUS_UNKNOWN (MT81 Fase 5)');
  // ════════════════════════════════════════════════════════════════

  // SCELTA DOCUMENTATA: restano NON bloccanti nei gate. Sono EVIDENZA del
  // parser, non barriere. Da MT81 la decisione canonica trasforma sempre una
  // classe incerta in BEK_REVISION_UNKNOWN — che e' bloccante in entrambi i
  // gate — quindi aggiungerli darebbe DUE warning diverse per la stessa
  // decisione, che e' esattamente cio' che non vogliamo. Una barriera sola.
  test('4. BEK_CLASS_AMBIGUOUS e BEK_STATUS_UNKNOWN NON sono barriere', () => {
    assert.strictEqual(isBlockingWarning({ code: 'BEK_CLASS_AMBIGUOUS' }, null, {}), false);
    assert.strictEqual(isBlockingWarning({ code: 'BEK_STATUS_UNKNOWN' }, null, {}), false);
  });

  test('5. ...perche\' la barriera canonica esiste sempre: ambiguous => rango incerto', () => {
    const r = SAFETY_MOD.bekRevisionRank({ document_class: 'ambiguous', items: [] }, '2026-09-20');
    assert.strictEqual(SAFETY_MOD.bekRankIsCertain(r), false,
      'se una classe ambiguous fosse certa, la decisione canonica non bloccherebbe ' +
      'e questi due codici resterebbero l\'unica difesa');
  });

  // ════════════════════════════════════════════════════════════════
  console.log('\nC. Matrice di parita\' — gli stessi dati nei due percorsi');
  // ════════════════════════════════════════════════════════════════

  const SCENARI = [
    ['buyer kitchen, nessun fratello',       () => [riga('me', HTML_OPERATIONAL)], HTML_OPERATIONAL],
    ['buyer excluded (sala)',                () => [riga('me', HTML_FOH)],         HTML_FOH],
    ['buyer unknown',                        () => [riga('me', HTML_IGNOTO)],      HTML_IGNOTO],
    ['prima conferma operativa',             () => [riga('me', HTML_OPERATIONAL)], HTML_OPERATIONAL],
    ['acknowledgement senza fratelli',       () => [riga('me', HTML_ACK)],         HTML_ACK],
    ['ambiguous',                            () => [riga('me', HTML_AMBIGUOUS)],   HTML_AMBIGUOUS],
    ['fratello pending di rango INFERIORE',  () => [riga('me', HTML_OPERATIONAL, { document_number: SO_OP }),
                                                    riga('sib', HTML_ACK, { id: 'sib', status: 'pending',
                                                      document_number: SO_OP, parsed_json: CANON.parse(HTML_ACK),
                                                      created_at: '2026-09-18T10:00:00Z' })], HTML_OPERATIONAL],
    ['fratello pending di rango SUPERIORE',  () => [riga('me', HTML_ACK, { document_number: SO_ACK }),
                                                    riga('sib', HTML_OPERATIONAL, { id: 'sib', status: 'pending',
                                                      document_number: SO_ACK, parsed_json: CANON.parse(HTML_OPERATIONAL),
                                                      created_at: '2026-09-18T10:00:00Z' })], HTML_ACK],
    ['fratello IMPORTED',                    () => [riga('me', HTML_OPERATIONAL, { document_number: SO_OP }),
                                                    riga('sib', HTML_OPERATIONAL, { id: 'sib', status: 'imported',
                                                      document_number: SO_OP, parsed_json: CANON.parse(HTML_OPERATIONAL),
                                                      created_at: '2026-09-18T10:00:00Z' })], HTML_OPERATIONAL],
    ['fratello IGNORED (gia\' superato)',    () => [riga('me', HTML_OPERATIONAL, { document_number: SO_OP }),
                                                    riga('sib', HTML_AMBIGUOUS, { id: 'sib', status: 'ignored',
                                                      document_number: SO_OP, parsed_json: CANON.parse(HTML_AMBIGUOUS),
                                                      created_at: '2026-09-18T10:00:00Z' })], HTML_OPERATIONAL],
    ['Sales Order senza fratelli',           () => [riga('me', HTML_OPERATIONAL, { document_number: SO_OP })], HTML_OPERATIONAL],
  ];

  const matrice = [];
  for (const [nome, righe, html] of SCENARI) {
    await atest('6. parita\' — ' + nome, async () => {
      const { phaseA, reprocess } = await dueVie(righe, html, 'me');
      matrice.push([nome, phaseA, reprocess]);
      assert.deepStrictEqual(reprocess.stateWarnings, phaseA.stateWarnings,
        `warning di stato diverse:\n        phaseA=${JSON.stringify(phaseA.stateWarnings)}\n        reproc=${JSON.stringify(reprocess.stateWarnings)}`);
      assert.strictEqual(reprocess.status, phaseA.status,
        `status diversi: phaseA=${phaseA.status} reprocess=${reprocess.status}`);
      assert.strictEqual(reprocess.existing, phaseA.existing, 'sibling imported scelto diverso');
      assert.deepStrictEqual(reprocess.superati, phaseA.superati, 'fratelli superati diversi');
    });
  }

  test('7. la matrice ha davvero esercitato esiti DIVERSI fra loro', () => {
    // Una matrice in cui ogni scenario finisse allo stesso modo non
    // proverebbe niente sulla parita'.
    const distinti = new Set(matrice.map(([, a]) => a.status + '|' + a.stateWarnings.join(',')));
    assert.ok(distinti.size >= 4,
      `solo ${distinti.size} esiti distinti nella matrice: gli scenari non discriminano`);
  });

  // ════════════════════════════════════════════════════════════════
  console.log('\nD. La logica e\' davvero condivisa');
  // ════════════════════════════════════════════════════════════════

  test('8. entrambi i percorsi chiamano bekDecidePostParse', () => {
    assert.ok(/bekSafety\.bekDecidePostParse\(/.test(WORKER),
      'Phase A non chiama piu\' la decisione condivisa');
    assert.ok(/vdrBekSafety\(\)\.bekDecidePostParse\(/.test(UI_SRC),
      'il reprocess non chiama piu\' la decisione condivisa');
  });

  test('9. la decisione non e\' stata ricopiata in nessuno dei due caller', () => {
    // In index.ts il modulo compare anche come STRINGA dentro PARSER_SOURCES:
    // quella e' la copia embeddata che il worker carica, non una seconda
    // implementazione. Il controllo si fa sul codice vero, dopo il loader.
    const WORKER_CODE = WORKER.slice(WORKER.indexOf('\n};\n', WORKER.indexOf('const PARSER_SOURCES')));
    assert.ok(WORKER_CODE.length > 1000 && !/"bek-post-parse-safety":/.test(WORKER_CODE),
      'il taglio di PARSER_SOURCES non ha funzionato: il test 9 non proverebbe nulla');
    for (const [nome, src] of [['index.ts', WORKER_CODE], ['vendor-documents-review.js', UI_SRC]]) {
      assert.ok(!/const alreadyImported = rows\.find/.test(src),
        `${nome} contiene di nuovo una copia della ricerca del fratello importato`);
      assert.ok(!/const incerti = live\.filter/.test(src),
        `${nome} contiene di nuovo una copia del gate di incertezza`);
      assert.ok(!/BEK_CLASS_RANK/.test(src),
        `${nome} contiene di nuovo una copia della tabella dei ranghi`);
    }
  });

  test('10. il modulo e\' decision-only: non scrive nulla', () => {
    assert.ok(!/sb\.from\([^)]*\)[\s\S]{0,80}\.update\(/.test(SAFETY_SRC), 'il modulo condiviso esegue una update');
    assert.ok(!/\.insert\(/.test(SAFETY_SRC), 'il modulo condiviso esegue una insert');
    assert.ok(!/\.delete\(/.test(SAFETY_SRC), 'il modulo condiviso esegue una delete');
    assert.ok(!/\.storage\b/.test(SAFETY_SRC), 'il modulo condiviso tocca lo Storage');
    assert.ok(/\.select\(/.test(SAFETY_SRC), 'ma deve leggere i fratelli');
  });

  test('11. il modulo e\' raggiungibile dai tre runtime', () => {
    assert.ok(/"bek-post-parse-safety":/.test(WORKER), 'non e\' in PARSER_SOURCES (worker)');
    assert.ok(/bek-post-parse-safety\.js/.test(INDEX_HTML), 'non e\' caricato da index.html (browser)');
    assert.ok(/window\.BekPostParseSafety = API/.test(SAFETY_SRC), 'non espone il global per il browser');
    assert.strictEqual(typeof SAFETY_MOD.bekDecidePostParse, 'function', 'non esporta per Node');
  });

  test('12. il dedup generico non tocca piu\' i BEK order_confirmation, in nessuno dei due', () => {
    assert.ok(/if \(docNumber && !\(parsersApi\(\)\.isBenEKeith\(parsed\.vendor\) && parsed\.document_type === 'order_confirmation'\)\)/.test(WORKER),
      'Phase A: esclusione BEK dal dedup sparita');
    assert.ok(/if \(docNumber && !\(vdrIsBek\(parsed\.vendor\) && parsed\.document_type === 'order_confirmation'\)\)/.test(UI_SRC),
      'reprocess: senza questa esclusione una revisione legittima diventa DUPLICATE');
  });

  console.log('\n  MATRICE DI PARITA\' (verdetto canonico, identico nei due percorsi)');
  console.log('  ' + 'scenario'.padEnd(38) + 'status'.padEnd(10) + 'warning di stato');
  console.log('  ' + '-'.repeat(88));
  for (const [nome, a] of matrice) {
    console.log('  ' + nome.padEnd(38) + a.status.padEnd(10) + (a.stateWarnings.join(',') || '—'));
  }

  console.log(`\n  ${pass} pass, ${fail} fail\n`);
  process.exit(fail ? 1 : 0);
})();
