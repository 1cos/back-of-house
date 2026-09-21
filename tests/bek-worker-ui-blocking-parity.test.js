// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 79 — parita' fail-closed fra il gate del worker e quello
// della UI per i due codici di riconciliazione BEK.
//
// Difetto preesistente, trovato durante l'audit MT78: BEK_REVISION_UNKNOWN
// (MT71) e BEK_REVISION_AFTER_IMPORT (MT72) erano blocking in
// isBlockingWarning() ma sconosciuti a vdrWarningToQuestion(). Il cron
// falliva chiuso; la review manuale no.
//
// Misurato sui due documenti VERI prima della patch:
//   dce28e94 (Sales Order 0003243454, BEK_REVISION_AFTER_IMPORT)
//   d1fdb90d (Sales Order 0003272475, BEK_REVISION_UNKNOWN)
// entrambi: 0 domande costruite, vdrPreflight ok:true, Approve fino a
// "Mark imported". Non scrivevano invoice_lines solo perche' i rami MT71/MT72
// lasciano parsed_json a { source } e vdrIsPurchasableDocument() e' falso —
// di nuovo una protezione che e' un'assenza, la forma esatta che MT72 ha
// tolto dal worker.
//
// I due gate sono meccanismi DIVERSI e nessuno dei due deriva dall'altro:
//   worker : isBlockingWarning(code) -> true/false
//   UI     : vdrWarningToQuestion(w) -> domanda non-infoOnly, oppure null
// Entrambi falliscono APERTI sui codici che non conoscono. Il test 6 di
// questo file e' la guardia che impedisce alla prossima aggiunta di
// ripetere la storia.
//
// `node tests/bek-worker-ui-blocking-parity.test.js`
// ══════════════════════════════════════════════════════════════════
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { isBlockingWarning, vdrCodeToSeverityLite } = require('../pure_logic.cjs');

const WORKER_PATH = path.join(__dirname, '..', 'edge-functions', 'vendor-doc-auto-import', 'index.ts');
const UI_PATH     = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');
const WORKER = fs.readFileSync(WORKER_PATH, 'utf8');
const UI     = fs.readFileSync(UI_PATH, 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message ? e.message : e)); }
}
async function atest(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message ? e.message : e)); }
}

// ── Le funzioni UI reali, estratte dal sorgente ────────────────────
// Non ricopiate: se qualcuno le cambia, questi test misurano la versione
// cambiata e non possono passare per inerzia.
function grab(start, endMark) {
  const s = UI.indexOf(start);
  const e = UI.indexOf(endMark, s);
  assert.ok(s >= 0 && e > s, `non trovato nel sorgente UI: ${start}`);
  return UI.slice(s, e + endMark.length);
}

// Conta le scritture: il preflight non deve toccare niente.
const scritture = [];
function mockSb() {
  const c = {
    select: () => c, eq: () => c, in: () => c, not: () => c, order: () => c,
    limit: () => Promise.resolve({ data: [] }),
    insert(r) { scritture.push(['insert', r]); return Promise.resolve({ data: r, error: null }); },
    update(d) { scritture.push(['update', d]); return Promise.resolve({ data: [], error: null }); },
    then: (r) => Promise.resolve({ data: [] }).then(r),
  };
  return c;
}
global.window = { supabaseClient: { from: () => mockSb() } };
global.chronologyAllows = () => true;
global.vdrItemEmoji = () => '📦';

const UI_SRC = [
  grab('function vdrIsPurchasableDocumentFallback(', 'return false;\n}'),
  grab('function vdrIsPurchasableDocument(vendor, documentType)', '\n}'),
  // INV08H — vdrBuildQuestions costruisce ora un contesto documentale e lo
  // passa a vdrWarningToQuestion: senza queste funzioni l'estrazione non
  // compila. Vanno prese dal sorgente come tutto il resto, non ricopiate.
  grab('const VDR_TOTAL_TOLERANCE = 0.02;', 'window.vdrBuildQtyContext                   = vdrBuildQtyContext;'),
  grab('function vdrBuildQuestions(doc)', 'return questions;\n}'),
  grab('function vdrWarningToQuestion(', 'return null; // unknown code — skip') + '\n}',
  // INV06B ha estratto questo helper e vdrWarningToQuestion ora lo chiama:
  // senza includerlo nel ritaglio, il preflight esplode a runtime.
  grab('function vdrFindWarningRowId(docId, w, item)', "return hit.length === 1 ? hit[0].id : null;\n}"),
  grab('async function vdrPreflight(docId, doc)', 'return { ok: true, items, vendor, unmatchedCount };\n}'),
  grab('function vdrCodeToSeverity(code)', "return 'alert';") + '\n}',
].join('\n\n');

const window = { _vdrMatchStatus: {} };
const uiFn = new Function('window', UI_SRC +
  '\nreturn { vdrBuildQuestions, vdrWarningToQuestion, vdrPreflight, vdrCodeToSeverity, vdrIsPurchasableDocument };')(window);

// Il gate UI come lo applica vdrPreflight: una domanda non-infoOnly blocca.
function uiBlocca(code, extra) {
  const q = uiFn.vdrWarningToQuestion(Object.assign({ code, message: 'm' }, extra || {}), null, 'd', 0);
  return !!(q && !q.infoOnly);
}

// ── I DUE DOCUMENTI VERI, verbatim dalla produzione (2026-09-19) ───
// parsed_json e warnings sono quelli letti dal database, non inventati.
const DOC_AFTER_IMPORT = {
  id: 'dce28e94-23b7-4f25-b85f-bb76b1fb8a0a',
  vendor: 'Ben E. Keith', document_type: 'order_confirmation', status: 'pending',
  document_number: '0003243454', document_date: null,
  parsed_json: { source: 'email_html' },
  warnings: [{
    code: 'BEK_REVISION_AFTER_IMPORT', severity: 'blocking',
    message: 'Sales Order 0003243454 already has an imported purchase (document ' +
             '8afad7e2-1f65-4c03-9e6e-3fcd58195712). This later revision was NOT imported ' +
             'as a second purchase and the existing one was NOT modified — reconcile by hand.',
    existing_document_id: '8afad7e2-1f65-4c03-9e6e-3fcd58195712',
  }],
};
const DOC_UNKNOWN = {
  id: 'd1fdb90d-70ad-4d69-891d-0f363db9fa0c',
  vendor: 'Ben E. Keith', document_type: 'order_confirmation', status: 'pending',
  document_number: '0003272475', document_date: null,
  parsed_json: { source: 'email_html' },
  warnings: [{
    code: 'BEK_REVISION_UNKNOWN', severity: 'blocking',
    message: "Sales Order 0003272475 non e' classificabile con certezza (classe: ambiguous) " +
             "e non ha altre revisioni con cui riconciliarsi.",
    sibling_ids: [],
  }],
};

(async () => {
  console.log('\nMICRO-TASK 79 — worker e UI devono fermarsi sugli stessi warning BEK\n');

  // ════════════════════════════════════════════════════════════════
  console.log('A. I due codici, gate per gate');
  // ════════════════════════════════════════════════════════════════

  test('1. BEK_REVISION_UNKNOWN: blocking nel worker E nella UI', () => {
    assert.strictEqual(isBlockingWarning({ code: 'BEK_REVISION_UNKNOWN' }, null, {}), true,
      'gate worker');
    const q = uiFn.vdrWarningToQuestion(DOC_UNKNOWN.warnings[0], null, 'd', 0);
    assert.ok(q, 'la UI non costruisce nessuna domanda');
    assert.strictEqual(q.blocking, true, 'la domanda non e\' marcata blocking');
    assert.ok(!q.infoOnly, 'una domanda infoOnly non ferma vdrPreflight');
    assert.strictEqual(q.code, 'BEK_REVISION_UNKNOWN');
  });

  test('2. BEK_REVISION_AFTER_IMPORT: blocking nel worker E nella UI', () => {
    assert.strictEqual(isBlockingWarning({ code: 'BEK_REVISION_AFTER_IMPORT' }, null, {}), true,
      'gate worker');
    const q = uiFn.vdrWarningToQuestion(DOC_AFTER_IMPORT.warnings[0], null, 'd', 0);
    assert.ok(q, 'la UI non costruisce nessuna domanda');
    assert.strictEqual(q.blocking, true);
    assert.ok(!q.infoOnly);
    assert.strictEqual(q.code, 'BEK_REVISION_AFTER_IMPORT');
  });

  test('2b. il messaggio del warning reale arriva nella domanda', () => {
    // La domanda deve portare il contesto, non una frase generica: chi la
    // legge deve vedere QUALE documento ha gia' l'import.
    const q = uiFn.vdrWarningToQuestion(DOC_AFTER_IMPORT.warnings[0], null, 'd', 0);
    assert.ok(String(q.detected).includes('8afad7e2'),
      'la domanda non mostra il documento gia\' importato');
  });

  // ════════════════════════════════════════════════════════════════
  console.log('\nB. I due documenti reali nel percorso UI completo');
  // ════════════════════════════════════════════════════════════════

  await atest('3. 0003243454 (dce28e94): la UI non puo\' approvarlo, e non scrive nulla', async () => {
    scritture.length = 0;
    const qs = uiFn.vdrBuildQuestions(DOC_AFTER_IMPORT);
    const aperte = qs.filter((q) => !q.infoOnly);
    assert.strictEqual(aperte.length, 1, `domande aperte: ${aperte.length}, attesa 1`);

    const pre = await uiFn.vdrPreflight(DOC_AFTER_IMPORT.id, DOC_AFTER_IMPORT);
    assert.strictEqual(pre.ok, false, 'vdrPreflight lascia passare il documento');
    assert.notStrictEqual(pre.reason, 'match_needed',
      'con reason match_needed vdrApprove aprirebbe il modal invece di fermarsi');

    // Il preflight e' una lettura: non deve toccare niente.
    assert.strictEqual(scritture.length, 0,
      `il preflight ha scritto ${scritture.length} volte`);
  });

  test('3b. l\'import esistente non puo\' essere toccato: vdrApprove scrive solo docId', () => {
    // La sola UPDATE di stato in vdrApprove e' scoped sul documento corrente.
    assert.ok(UI.includes(
      ".update({ status: 'imported', updated_at: new Date().toISOString() }).eq('id', docId);"),
      'la scrittura di stato non e\' piu\' scoped su docId');
    // ...e sta DOPO il preflight, che ora si ferma: strutturalmente irraggiungibile.
    const iPre  = UI.indexOf('const pre = await vdrPreflight(docId, doc);');
    const iThrow = UI.indexOf('throw new Error(pre.reason);', iPre);
    const iMark = UI.indexOf("// Mark imported", iPre);
    assert.ok(iPre > 0 && iThrow > iPre && iMark > iThrow,
      'l\'ordine preflight -> throw -> mark imported non e\' piu\' garantito');
  });

  await atest('4. 0003272475 (d1fdb90d): la UI non puo\' approvarlo, zero purchase write', async () => {
    scritture.length = 0;
    const aperte = uiFn.vdrBuildQuestions(DOC_UNKNOWN).filter((q) => !q.infoOnly);
    assert.strictEqual(aperte.length, 1);

    const pre = await uiFn.vdrPreflight(DOC_UNKNOWN.id, DOC_UNKNOWN);
    assert.strictEqual(pre.ok, false);
    assert.notStrictEqual(pre.reason, 'match_needed');
    assert.strictEqual(scritture.length, 0);
  });

  await atest('4b. CONTROLLO: il meccanismo fail-open esiste davvero', async () => {
    // Stesso documento, stesso percorso, un codice che nessuno dei due gate
    // conosce: passa. E' la prova che la parita' dei test 1-4 viene dai rami
    // aggiunti e non da un'altra barriera che nasconde il difetto.
    const finto = Object.assign({}, DOC_UNKNOWN, {
      warnings: [{ code: 'BEK_CODICE_MAI_VISTO', severity: 'blocking', message: 'x' }],
    });
    assert.strictEqual(isBlockingWarning({ code: 'BEK_CODICE_MAI_VISTO' }, null, {}), false);
    assert.strictEqual(uiFn.vdrBuildQuestions(finto).filter((q) => !q.infoOnly).length, 0);
    const pre = await uiFn.vdrPreflight(finto.id, finto);
    assert.strictEqual(pre.ok, true,
      'atteso ok:true — se fosse false, i test sopra non proverebbero nulla');
  });

  // ════════════════════════════════════════════════════════════════
  console.log('\nC. MT78 non regredisce');
  // ════════════════════════════════════════════════════════════════

  test('5. BEK_NO_SALES_ORDER resta blocking sia nel worker sia nella UI', () => {
    assert.strictEqual(isBlockingWarning({ code: 'BEK_NO_SALES_ORDER' }, null, {}), true);
    assert.strictEqual(uiBlocca('BEK_NO_SALES_ORDER'), true);
  });

  // ════════════════════════════════════════════════════════════════
  console.log('\nD. Parita\' — la guardia per il futuro');
  // ════════════════════════════════════════════════════════════════

  // I codici NON sono elencati a mano: vengono raccolti dal sorgente. Se
  // qualcuno aggiunge un nuovo BEK_* e lo rende blocking nel worker senza
  // darne una rappresentazione bloccante alla UI, questo test fallisce da
  // solo, senza che nessuno debba ricordarsi di aggiornarlo.
  const CODICI_BEK = [...new Set(
    (WORKER + UI + fs.readFileSync(
      path.join(__dirname, '..', 'js', 'vendor-parsers', 'ben-e-keith-order-confirmation.js'), 'utf8'))
      .match(/'BEK_[A-Z_]+'/g) || []
  )].map((s) => s.slice(1, -1)).sort();

  test('6. PARITA\': ogni BEK blocking nel worker lo e\' anche nella UI', () => {
    assert.ok(CODICI_BEK.length >= 10,
      `raccolti solo ${CODICI_BEK.length} codici BEK — la raccolta dal sorgente e' rotta`);
    const buchi = [];
    for (const code of CODICI_BEK) {
      const w = isBlockingWarning({ code }, null, {});
      if (w && !uiBlocca(code)) buchi.push(code);
    }
    assert.strictEqual(buchi.length, 0,
      'blocking nel worker ma non nella UI:\n      ' + buchi.join('\n      ') +
      '\n      -> aggiungi un ramo in vdrWarningToQuestion()');
  });

  test('6b. PARITA\' inversa: nessun BEK blocca la UI senza bloccare il worker', () => {
    const buchi = CODICI_BEK.filter((code) => uiBlocca(code) && !isBlockingWarning({ code }, null, {}));
    assert.strictEqual(buchi.length, 0,
      'blocking nella UI ma non nel worker:\n      ' + buchi.join('\n      '));
  });

  test('6c. le due etichette severity concordano su ogni codice BEK', () => {
    // Gate ed etichetta sono cose diverse: il gate decide se si passa,
    // l'etichetta decide come il warning viene mostrato. Qui si verifica solo
    // che le DUE etichette (worker e UI) non divergano fra loro.
    const diff = CODICI_BEK
      .map((c) => [c, vdrCodeToSeverityLite(c), uiFn.vdrCodeToSeverity(c)])
      .filter(([, a, b]) => a !== b);
    assert.strictEqual(diff.length, 0,
      'severity divergenti:\n      ' + diff.map(([c, a, b]) => `${c}: worker=${a} ui=${b}`).join('\n      '));
  });

  test('6d. i due codici MT71/MT72 non sono piu\' etichettati come semplici alert', () => {
    for (const c of ['BEK_REVISION_UNKNOWN', 'BEK_REVISION_AFTER_IMPORT']) {
      assert.strictEqual(vdrCodeToSeverityLite(c), 'blocking', `worker: ${c}`);
      assert.strictEqual(uiFn.vdrCodeToSeverity(c), 'blocking', `ui: ${c}`);
    }
  });

  // ════════════════════════════════════════════════════════════════
  console.log('\nE. Nessuna regressione sugli altri warning');
  // ════════════════════════════════════════════════════════════════

  test('7. i codici gia\' esistenti mantengono la forma che avevano', () => {
    // Lock di regressione: valori misurati PRIMA della patch MT79.
    const attesi = [
      // code,                 domanda?  blocking  infoOnly
      ['DOC-TOTAL-001',        true,     true,     false],
      ['PARSE_ERROR_NO_LINES', true,     true,     false],
      ['PARSE_ERROR',          true,     false,    true ],
      ['UNKNOWN_VENDOR',       true,     false,    true ],
      ['UNKNOWN_DOC_TYPE',     true,     false,    true ],
      ['OQR-002',              true,     false,    false],
      ['OQR-001',              true,     false,    false],
      ['CODICE_INESISTENTE',   false,    false,    false],
    ];
    for (const [code, esiste, blocking, infoOnly] of attesi) {
      const q = uiFn.vdrWarningToQuestion({ code, message: 'm' }, null, 'd', 0);
      assert.strictEqual(!!q, esiste, `${code}: domanda costruita ${!!q}, attesa ${esiste}`);
      if (q) {
        assert.strictEqual(!!q.blocking, blocking, `${code}: blocking`);
        assert.strictEqual(!!q.infoOnly, infoOnly, `${code}: infoOnly`);
      }
    }
  });

  test('7b. OQR-006 con conversione nota resta auto-risolto (nessuna domanda)', () => {
    global.window._vdrKnownConversions = { '110593': { conversion_to_base: 1 } };
    const q = uiFn.vdrWarningToQuestion(
      { code: 'OQR-006', message: 'm' },
      { vendor_sku: '110593', pack_description: '12 CT', description: 'x' }, 'd', 0);
    assert.ok(q === null || !!q.infoOnly || !q.blocking,
      'OQR-006 non deve diventare bloccante');
  });

  test('7c. il gate worker resta un superset stabile', () => {
    const f = WORKER.slice(WORKER.indexOf('function isBlockingWarning'));
    for (const code of ['BEK_REVISION_UNKNOWN', 'BEK_REVISION_AFTER_IMPORT',
                        'BEK_NO_SALES_ORDER', 'PARSE_ERROR_NO_LINES', 'DOC-TOTAL-001']) {
      assert.ok(f.includes(`'${code}'`), `isBlockingWarning non nomina piu' ${code}`);
    }
  });

  console.log(`\n  ${pass} pass, ${fail} fail\n`);
  process.exit(fail ? 1 : 0);
})();
