// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 72 — BEK_REVISION_AFTER_IMPORT deve bloccare per DECISIONE.
//
// Secondo finding emerso durante MT71. Il ramo che scrive l'eccezione
// (index.ts:448) aggiorna SOLO status e warnings: parsed_json resta
// { source }. Senza document_type nel JSON isPurchasableDocument() e'
// falso, vdaiPreflight esce subito con un ok:true vuoto e vdaiApprove
// rifiuta con 'not_invoice'. Il documento non veniva importato, ma per un
// dato MANCANTE, non per il warning.
//
// Misura di MT72, riprodotta qui dal test T: allo stesso documento, con lo
// stesso warning, basta un parsed_json completo con buyer di cucina e SKU
// mappati perche' vdaiApprove ritorni ok e scriva le invoice_lines. La
// protezione era un'assenza, e le assenze si riempiono.
//
// Caso reale in arrivo: Sales Order 0003243454 e' gia' 'imported' nel DB
// mentre il suo thread Gmail e' ancora eleggibile per il backfill. Questo
// ramo verra' esercitato davvero al prossimo batch.
//
// `node tests/bek-after-import-fail-closed.test.js`
// ══════════════════════════════════════════════════════════════════
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { processOneQueuedDoc, vdaiPreflight, vdaiApprove, loadParsers,
        isBlockingWarning } = require('../pure_logic.cjs');
const CANON = require('../js/vendor-parsers/ben-e-keith-order-confirmation');
const F = require('./fixtures/bek-html-real-shape');

const WORKER = fs.readFileSync(
  path.join(__dirname, '..', 'edge-functions', 'vendor-doc-auto-import', 'index.ts'), 'utf8');

let pass = 0, fail = 0;
async function atest(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message ? e.message : e)); }
}

// Mock Supabase minimale — stessa forma di tests/bek-phase-a-body-only.test.js
function makeMockSb(tables) {
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
      return rows.filter((r) => st.filters.every((f) =>
        f[0] === 'eq' ? r[f[1]] === f[2] : f[0] === 'neq' ? r[f[1]] !== f[2]
          : f[0] === 'in' ? f[2].includes(r[f[1]]) : true));
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
      const m = filt(tables[t]); m.forEach((r) => Object.assign(r, st.upd)); return { data: m, error: null };
    }
    return api;
  }
  return { tables, from: (t) => builder(t), storage: { from: () => ({ remove: async () => ({}) }) } };
}

const PARSED = CANON.parse(F.BEK_OPERATIONAL_SAME_SO);
const SKUS = PARSED.items.map((i) => i.vendor_sku || i.item_code);
const SO = PARSED.document_number;

// Tutti gli SKU mappati: toglie di mezzo l'unmatched come causa del rifiuto,
// cosi' l'unica cosa che puo' fermare il documento e' il warning.
function mappaturaCompleta() {
  return SKUS.map((s, n) => ({ vendor: 'Ben E. Keith', vendor_sku: s,
                               ingredient_id: 'ing-' + n, conversion_to_base: null }));
}

const AFTER_IMPORT_WARN = [{
  code: 'BEK_REVISION_AFTER_IMPORT', severity: 'blocking',
  message: `Sales Order ${SO} already has an imported purchase (document vecchia).`,
  existing_document_id: 'vecchia',
}];

function revisioneNuova(parsedJson, overrides = {}) {
  return Object.assign({
    id: 'rev-nuova', vendor: 'Ben E. Keith', document_type: 'order_confirmation',
    status: 'pending', document_number: SO, document_date: '2026-09-17',
    created_at: '2026-09-20T10:00:00Z',
    parsed_json: parsedJson, warnings: AFTER_IMPORT_WARN,
    raw_text: F.BEK_OPERATIONAL_SAME_SO,
  }, overrides);
}

function tabelleComplete(righe) {
  return {
    vendor_documents: righe, ingredient_vendors: mappaturaCompleta(),
    vendor_item_aliases: [], ingredient_links: [], invoice_lines: [],
    invoice_warnings: [], ingredients: [],
  };
}

(async () => {
  console.log('\nMICRO-TASK 72 — BEK_REVISION_AFTER_IMPORT: fail closed esplicito\n');
  const parsers = loadParsers();

  // ── S ──────────────────────────────────────────────────────────
  await atest('S. BEK_REVISION_AFTER_IMPORT e riconosciuto come bloccante', () => {
    assert.strictEqual(isBlockingWarning({ code: 'BEK_REVISION_AFTER_IMPORT' }, null, {}), true);
  });

  // ── T — il cuore di MT72 ───────────────────────────────────────
  await atest('T. warning + parsed_json COMPLETO + buyer kitchen + SKU tutti mappati -> rifiutato', async () => {
    const pjCompleto = Object.assign({ source: 'email_html' }, PARSED);
    assert.strictEqual(pjCompleto.buyer_class, 'kitchen', 'la fixture deve essere di cucina');
    assert.strictEqual(pjCompleto.document_type, 'order_confirmation');
    assert.ok(pjCompleto.items.length > 0, 'deve avere righe');

    const doc = revisioneNuova(pjCompleto);
    const sb = makeMockSb(tabelleComplete([doc]));

    const pre = await vdaiPreflight(sb, doc);
    assert.strictEqual(pre.unmatchedCount, 0,
      'gli SKU devono essere tutti mappati: altrimenti il test non prova niente');
    assert.strictEqual(pre.ok, false, 'il preflight deve rifiutare');
    assert.strictEqual(pre.reason, 'open_question',
      'il rifiuto deve venire dal WARNING, non da dati mancanti o unmatched');

    const app = await vdaiApprove(sb, doc.id);
    assert.strictEqual(app.ok, false, 'vdaiApprove non deve approvare');
    assert.notStrictEqual(app.reason, 'not_invoice',
      'non deve piu dipendere da parsed_json incompleto: qui e completo');
    assert.strictEqual(app.reason, 'open_question');

    assert.strictEqual((sb.tables.invoice_lines || []).length, 0, 'zero invoice_lines');
    assert.strictEqual(sb.tables.vendor_documents[0].status, 'pending', 'mai imported');
  });

  await atest('T2. lo stesso documento SENZA quel warning verrebbe importato (prova che blocca il warning)', async () => {
    const pjCompleto = Object.assign({ source: 'email_html' }, PARSED);
    const doc = revisioneNuova(pjCompleto, { warnings: null });
    const sb = makeMockSb(tabelleComplete([doc]));

    const pre = await vdaiPreflight(sb, doc);
    assert.strictEqual(pre.ok, true, 'senza il warning il preflight passa');
    const app = await vdaiApprove(sb, doc.id);
    assert.strictEqual(app.ok, true, 'senza il warning il documento e importabile');
    assert.ok((sb.tables.invoice_lines || []).length > 0,
      'e scrive davvero righe: e questo che il warning deve impedire');
  });

  // ── U — il ramo reale, end to end ──────────────────────────────
  await atest('U. fratello gia imported + nuova revisione -> ramo invariato, ledger intatto', async () => {
    const vecchia = {
      id: 'vecchia', vendor: 'Ben E. Keith', document_type: 'order_confirmation',
      status: 'imported', document_number: SO, document_date: '2026-09-15',
      created_at: '2026-09-15T10:00:00Z',
      parsed_json: Object.assign({ source: 'email_html' }, PARSED),
      warnings: null, raw_text: F.BEK_OPERATIONAL_SAME_SO,
    };
    const nuova = {
      id: 'rev-nuova', vendor: 'Ben E. Keith', document_type: 'order_confirmation',
      status: 'pdf_received', document_number: null, document_date: null,
      source_email_subject: `Ben E. Keith : Order Confirmation for FDF770366-ZENO'S ON THE SQUARE;${SO}`,
      created_at: '2026-09-20T10:00:00Z',
      parsed_json: { source: 'email_html' }, warnings: null,
      raw_text: F.BEK_OPERATIONAL_SAME_SO,
    };
    const righeVecchia = [
      { id: 'l1', import_id: 'vecchia', vendor: 'Ben E. Keith', vendor_sku: SKUS[0], quantity: 2 },
      { id: 'l2', import_id: 'vecchia', vendor: 'Ben E. Keith', vendor_sku: SKUS[1], quantity: 1 },
    ];
    const tables = tabelleComplete([vecchia, nuova]);
    tables.invoice_lines = righeVecchia.map((r) => Object.assign({}, r));
    const sb = makeMockSb(tables);

    const r = await processOneQueuedDoc(sb, nuova, parsers);
    assert.strictEqual(r.outcome, 'bek_revision_after_import',
      'il ramo deve restare quello di MT42: ' + r.outcome);

    const rowNuova = sb.tables.vendor_documents.find((x) => x.id === 'rev-nuova');
    assert.strictEqual(rowNuova.status, 'pending', 'status assegnato dal ramo: invariato');
    const w = (rowNuova.warnings || []).find((x) => x.code === 'BEK_REVISION_AFTER_IMPORT');
    assert.ok(w, 'manca BEK_REVISION_AFTER_IMPORT');
    assert.strictEqual(w.severity, 'blocking');
    assert.strictEqual(w.existing_document_id, 'vecchia',
      'deve indicare il documento gia importato');
    assert.ok(/was NOT imported as a second purchase/.test(w.message),
      'messaggio invariato rispetto a MT42');

    // il documento gia' importato non viene toccato
    const rowVecchia = sb.tables.vendor_documents.find((x) => x.id === 'vecchia');
    assert.strictEqual(rowVecchia.status, 'imported', 'la vecchia resta imported');
    assert.deepStrictEqual(sb.tables.invoice_lines, righeVecchia,
      'il ledger della vecchia non deve essere toccato: nessuna riga aggiunta, cambiata o tolta');

    // e la nuova revisione non diventa un secondo acquisto
    const pre = await vdaiPreflight(sb, rowNuova);
    assert.strictEqual(pre.ok, false);
    assert.strictEqual(pre.reason, 'open_question');
    const app = await vdaiApprove(sb, 'rev-nuova');
    assert.strictEqual(app.ok, false, 'la nuova revisione non deve essere importata');
    assert.strictEqual(sb.tables.invoice_lines.length, righeVecchia.length,
      'nessuna riga nuova in invoice_lines');
  });

  // ── V — regressione ────────────────────────────────────────────
  await atest('V. operational_confirmation normale senza warning -> invariata', async () => {
    const doc = {
      id: 'normale', vendor: 'Ben E. Keith', document_type: 'order_confirmation',
      status: 'pdf_received',
      source_email_subject: `Ben E. Keith : Order Confirmation for FDF770366-ZENO'S ON THE SQUARE;${SO}`,
      created_at: '2026-09-20T10:00:00Z',
      parsed_json: { source: 'email_html' }, warnings: null,
      raw_text: F.BEK_OPERATIONAL_SAME_SO,
    };
    const sb = makeMockSb(tabelleComplete([doc]));
    const r = await processOneQueuedDoc(sb, doc, parsers);
    assert.strictEqual(r.outcome, 'parsed_pending', 'deve arrivare in fondo a Phase A: ' + r.outcome);

    const row = sb.tables.vendor_documents[0];
    assert.strictEqual(row.status, 'pending');
    assert.strictEqual(row.parsed_json.document_class, 'operational_confirmation');
    assert.strictEqual((row.warnings || []).length, 0, 'nessun warning nuovo');

    const pre = await vdaiPreflight(sb, row);
    assert.strictEqual(pre.ok, true, 'resta importabile');
    assert.strictEqual(pre.unmatchedCount, 0);
    const app = await vdaiApprove(sb, row.id);
    assert.strictEqual(app.ok, true, 'con SKU mappati deve ancora importare');
    assert.ok(sb.tables.invoice_lines.length > 0, 'e scrivere le righe, come prima di MT72');
  });

  // ── W — pin sul codice ─────────────────────────────────────────
  await atest('W. entrambe le eccezioni di riconciliazione sono bloccanti', () => {
    for (const code of ['BEK_REVISION_UNKNOWN', 'BEK_REVISION_AFTER_IMPORT']) {
      assert.strictEqual(isBlockingWarning({ code }, null, {}), true, code + ' deve bloccare');
    }
    const f = WORKER.slice(WORKER.indexOf('function isBlockingWarning'));
    const corpo = f.slice(0, f.indexOf('\n}'));
    assert.ok(/code === 'BEK_REVISION_UNKNOWN' \|\| code === 'BEK_REVISION_AFTER_IMPORT'/.test(corpo),
      'i due codici devono essere nominati esplicitamente in isBlockingWarning');
  });

  await atest('W2. la lista bloccante non si e allargata ad altro', () => {
    for (const code of ['BEK_BUYER_EXCLUDED', 'BEK_CLASS_AMBIGUOUS', 'BEK_QTY_SHORT',
                        'BEK_CONFIRMED_MISSING', 'FULFILL_VARIANCE', 'CODICE_INVENTATO']) {
      assert.strictEqual(isBlockingWarning({ code }, null, {}), false,
        code + ' non deve essere diventato bloccante');
    }
  });

  console.log('\n  ' + pass + ' passati, ' + fail + ' falliti\n');
  process.exit(fail ? 1 : 0);
})();
