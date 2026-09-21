// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 43 — Phase A del worker: documenti Ben E. Keith body-only.
// Plain Node: `node tests/bek-phase-a-body-only.test.js`
//
// Gira contro pure_logic.cjs, cioe il VERO
// edge-functions/vendor-doc-auto-import/index.ts transpilato — stessa
// convenzione di tests/vendor-doc-auto-import.test.js. Non e una
// riscrittura della logica.
//
// Cosa verifica: l'UNICA differenza introdotta da MT43 e *da dove arriva
// il testo grezzo*. Il ramo PDF deve restare identico, il ramo BEK
// body-only deve usare vendor_documents.raw_text, e nessun altro
// documento senza storage_path deve diventare processabile.
// ══════════════════════════════════════════════════════════════════
const assert = require('assert');
const { processOneQueuedDoc, loadParsers } = require('../pure_logic.cjs');
const CANON = require('../js/vendor-parsers/ben-e-keith-order-confirmation');
const F = require('./fixtures/bek-html-real-shape');

let pass = 0, fail = 0;
async function atest(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message ? e.message : e)); }
}

// Mock Supabase minimale, stessa forma di tests/vendor-doc-auto-import.test.js
function makeMockSb(tables, opts = {}) {
  const calls = { storageRemoves: 0, pdfDownloads: 0 };
  function builder(tableName) {
    const state = { table: tableName, filters: [], single: false, insertRows: null, updateData: null, limitN: null };
    const api = {
      select() { return api; },
      eq(c, v) { state.filters.push(['eq', c, v]); return api; },
      neq(c, v) { state.filters.push(['neq', c, v]); return api; },
      in(c, v) { state.filters.push(['in', c, v]); return api; },
      limit(n) { state.limitN = n; return api; },
      order() { return api; },
      single() { state.single = true; return exec(); },
      insert(rows) { state.insertRows = Array.isArray(rows) ? rows : [rows]; state.op = 'insert'; return api; },
      update(d) { state.updateData = d; state.op = 'update'; return api; },
      then(res, rej) { return run().then(res, rej); },
    };
    function run() {
      if (state.op === 'insert') return write('insert');
      if (state.op === 'update') return write('update');
      return exec();
    }
    function filt(rows) {
      return rows.filter((r) => state.filters.every((f) => {
        if (f[0] === 'eq') return r[f[1]] === f[2];
        if (f[0] === 'neq') return r[f[1]] !== f[2];
        if (f[0] === 'in') return f[2].includes(r[f[1]]);
        return true;
      }));
    }
    async function exec() {
      let rows = filt(tables[tableName] || []);
      if (state.limitN) rows = rows.slice(0, state.limitN);
      if (state.single) return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } };
      return { data: rows, error: null };
    }
    async function write(kind) {
      tables[tableName] = tables[tableName] || [];
      if (kind === 'insert') { tables[tableName].push(...state.insertRows); return { data: state.insertRows, error: null }; }
      const m = filt(tables[tableName]);
      m.forEach((r) => Object.assign(r, state.updateData));
      return { data: m, error: null };
    }
    return api;
  }
  return {
    calls,
    from: (t) => builder(t),
    storage: {
      from: () => ({
        download: async () => {
          calls.pdfDownloads++;
          return opts.pdfBytes
            ? { data: { arrayBuffer: async () => opts.pdfBytes }, error: null }
            : { data: null, error: { message: 'download non disponibile nel mock' } };
        },
        remove: async () => { calls.storageRemoves++; return {}; },
      }),
    },
  };
}

function bekDoc(overrides = {}) {
  return Object.assign({
    id: 'doc-bek-1',
    vendor: 'Ben E. Keith',
    document_type: 'order_confirmation',
    status: 'pdf_received',
    source_email_subject: "Ben E. Keith : Order Confirmation for FDF770366-ZENO'S ON THE SQUARE;0009111222",
    created_at: '2026-09-18T22:00:00Z',
    parsed_json: { source: 'email_html' },
    raw_text: F.BEK_HTML_REAL_SHAPE,
  }, overrides);
}

(async () => {
  console.log('\nMICRO-TASK 43 — Phase A, documenti BEK body-only\n');
  const parsers = loadParsers();

  // ── 1. ramo PDF invariato ──────────────────────────────────────
  await atest('1: documento con storage_path -> usa ancora il path PDF (nessuna regressione)', async () => {
    const doc = { id: 'pdf-1', vendor: 'V', document_type: 'invoice', status: 'pdf_received',
                  parsed_json: { storage_path: 'invoices/gmail/x.pdf' }, raw_text: null };
    const sb = makeMockSb({ vendor_documents: [doc] });
    const r = await processOneQueuedDoc(sb, doc, parsers);
    assert.strictEqual(sb.calls.pdfDownloads, 1, 'deve tentare il download dallo Storage');
    assert.notStrictEqual(r.outcome, 'skipped_no_pdf');
    // il download fallisce nel mock -> errore deterministico, come prima di MT43
    assert.strictEqual(r.outcome, 'error');
    const row = sb.calls && doc;
    assert.strictEqual(row.status, 'error');
    assert.strictEqual(row.warnings[0].code, 'MISSING_STORAGE_PATH');
  });

  // ── 2/3. BEK body-only viene processato ────────────────────────
  await atest('2: BEK email_html con raw_text -> NON e piu skipped_no_pdf', async () => {
    const doc = bekDoc();
    const sb = makeMockSb({ vendor_documents: [doc] });
    const r = await processOneQueuedDoc(sb, doc, parsers);
    assert.notStrictEqual(r.outcome, 'skipped_no_pdf', 'Phase A deve processarlo');
    assert.strictEqual(sb.calls.pdfDownloads, 0, 'non deve toccare lo Storage');
  });

  await atest('3: BEK email_body con raw_text -> stesso trattamento', async () => {
    const doc = bekDoc({ id: 'doc-bek-body', parsed_json: { source: 'email_body' } });
    const sb = makeMockSb({ vendor_documents: [doc] });
    const r = await processOneQueuedDoc(sb, doc, parsers);
    assert.notStrictEqual(r.outcome, 'skipped_no_pdf');
    assert.strictEqual(sb.calls.pdfDownloads, 0);
  });

  // ── 4. fail closed su body vuoto ───────────────────────────────
  await atest('4: BEK body-only senza raw_text -> errore deterministico, mai pending', async () => {
    const doc = bekDoc({ id: 'doc-bek-empty', raw_text: '   ' });
    const sb = makeMockSb({ vendor_documents: [doc] });
    const r = await processOneQueuedDoc(sb, doc, parsers);
    assert.strictEqual(r.outcome, 'error');
    assert.strictEqual(doc.status, 'error');
    assert.strictEqual(doc.warnings[0].code, 'BEK_EMPTY_BODY');
    assert.strictEqual(doc.warnings[0].severity, 'blocking');
  });

  // ── 5. nessuna apertura generica ai body-only ──────────────────
  // ── INV07: FreshPoint body-only entra nello stesso ramo ────────
  await atest('4b [INV07]: FreshPoint order_confirmation body-only -> processato, non skipped', async () => {
    const { SAMPLES } = require('./fixtures/freshpoint-order-confirmation-samples');
    const doc = { id: 'fp-1', vendor: 'FreshPoint Dallas', document_type: 'order_confirmation',
                  status: 'pdf_received', parsed_json: { source: 'email_body' },
                  raw_text: SAMPLES[0].body };
    const sb = makeMockSb({ vendor_documents: [doc] });
    const r = await processOneQueuedDoc(sb, doc, parsers);
    assert.notStrictEqual(r.outcome, 'skipped_no_pdf',
      'senza questo ramo resterebbe fermo in pdf_received per sempre');
    assert.strictEqual(sb.calls.pdfDownloads, 0, 'non deve cercare nessun PDF');
  });

  await atest('4c [INV07]: FreshPoint body-only VUOTO -> errore con codice neutro, non BEK', async () => {
    const doc = { id: 'fp-2', vendor: 'FreshPoint Dallas', document_type: 'order_confirmation',
                  status: 'pdf_received', parsed_json: { source: 'email_body' }, raw_text: '   ' };
    const sb = makeMockSb({ vendor_documents: [doc] });
    const r = await processOneQueuedDoc(sb, doc, parsers);
    assert.strictEqual(r.outcome, 'error');
    assert.strictEqual(doc.warnings[0].code, 'EMPTY_BODY',
      'non deve attribuire a Ben E. Keith un documento che non e suo');
  });

  await atest('4d [INV07]: FreshPoint INVOICE body-only resta fuori dal ramo', async () => {
    const doc = { id: 'fp-3', vendor: 'FreshPoint Dallas', document_type: 'invoice',
                  status: 'pdf_received', parsed_json: { source: 'email_body' }, raw_text: 'x' };
    const sb = makeMockSb({ vendor_documents: [doc] });
    const r = await processOneQueuedDoc(sb, doc, parsers);
    assert.strictEqual(r.outcome, 'skipped_no_pdf', 'la lista resta chiusa: vendor E tipo');
  });

  await atest('5: altro vendor body-only senza storage_path -> resta skipped_no_pdf', async () => {
    const doc = { id: 'other-1', vendor: "Hardie's Fresh Foods / Dairyland Produce",
                  document_type: 'order_confirmation', status: 'pdf_received',
                  parsed_json: { source: 'email_html' }, raw_text: 'qualcosa' };
    const sb = makeMockSb({ vendor_documents: [doc] });
    const r = await processOneQueuedDoc(sb, doc, parsers);
    assert.strictEqual(r.outcome, 'skipped_no_pdf');
    assert.strictEqual(doc.status, 'pdf_received', 'non deve essere toccato');
  });

  await atest('5b: BEK ma document_type invoice body-only -> resta skipped_no_pdf', async () => {
    const doc = bekDoc({ id: 'bek-inv', document_type: 'invoice' });
    const sb = makeMockSb({ vendor_documents: [doc] });
    const r = await processOneQueuedDoc(sb, doc, parsers);
    assert.strictEqual(r.outcome, 'skipped_no_pdf');
  });

  await atest('5c: BEK order_confirmation ma senza marker source -> resta skipped_no_pdf', async () => {
    const doc = bekDoc({ id: 'bek-nomarker', parsed_json: {} });
    const sb = makeMockSb({ vendor_documents: [doc] });
    const r = await processOneQueuedDoc(sb, doc, parsers);
    assert.strictEqual(r.outcome, 'skipped_no_pdf');
  });

  // ── 6/8. parser canonico + esito pending ───────────────────────
  await atest('6+8: operational confirmation -> parser canonico, status pending (non error)', async () => {
    const doc = bekDoc({ id: 'bek-op' });
    const sb = makeMockSb({ vendor_documents: [doc] });
    const r = await processOneQueuedDoc(sb, doc, parsers);
    assert.strictEqual(r.outcome, 'parsed_pending');
    assert.strictEqual(doc.status, 'pending', 'unmatched NON e un parse error');
    assert.strictEqual(doc.parsed_json.vendor, 'Ben E. Keith');
    assert.strictEqual(doc.parsed_json.document_type, 'order_confirmation');
    assert.strictEqual(doc.parsed_json.document_class, 'operational_confirmation');
    assert.strictEqual(doc.parsed_json.items.length, 3);
    assert.strictEqual(doc.document_number, '0009111222');
  });

  // ── 7. acknowledgement ─────────────────────────────────────────
  await atest('7: acknowledgement -> classificato correttamente, nessun item acquistabile', async () => {
    const doc = bekDoc({ id: 'bek-ack', raw_text: F.BEK_ACKNOWLEDGEMENT,
                         source_email_subject: 'Ben E. Keith : Order Confirmation ...;0003126637' });
    const sb = makeMockSb({ vendor_documents: [doc] });
    await processOneQueuedDoc(sb, doc, parsers);
    assert.strictEqual(doc.parsed_json.document_class, 'acknowledgement');
    assert.strictEqual(doc.parsed_json.items.filter((i) => i.purchasable).length, 0);
    assert.strictEqual(doc.parsed_json.computed_purchase_total, 0);
  });

  // ── 9. parse error non diventa pending ─────────────────────────
  await atest('9: HTML non riconoscibile -> status error, mai pending silenzioso', async () => {
    const doc = bekDoc({ id: 'bek-junk', raw_text: '<html><body>niente di utile</body></html>' });
    const sb = makeMockSb({ vendor_documents: [doc] });
    const r = await processOneQueuedDoc(sb, doc, parsers);
    assert.notStrictEqual(doc.status, 'pending', 'un documento senza righe non puo finire pending');
    assert.strictEqual(doc.status, 'error');
    assert.strictEqual(r.outcome, 'error');
  });

  // ── 10. parity con il parser canonico ──────────────────────────
  await atest('10: parity — Phase A produce lo stesso parsed del parser canonico sullo stesso raw_text', async () => {
    const doc = bekDoc({ id: 'bek-parity' });
    const sb = makeMockSb({ vendor_documents: [doc] });
    await processOneQueuedDoc(sb, doc, parsers);
    const direct = CANON.parse(F.BEK_HTML_REAL_SHAPE);
    const viaPhaseA = doc.parsed_json;
    for (const k of ['vendor', 'document_type', 'document_class', 'document_number',
                     'total', 'computed_order_total', 'computed_purchase_total',
                     'delivery_date', 'subtotal']) {
      assert.deepStrictEqual(viaPhaseA[k], direct[k], 'campo divergente: ' + k);
    }
    assert.deepStrictEqual(viaPhaseA.items.map((i) => i.vendor_sku), direct.items.map((i) => i.vendor_sku));
    assert.deepStrictEqual(viaPhaseA.items.map((i) => i.qty), direct.items.map((i) => i.qty));
    assert.deepStrictEqual(viaPhaseA.items.map((i) => i.unit_price), direct.items.map((i) => i.unit_price));
  });

  // ── nessuna scrittura purchase da Phase A ──────────────────────
  await atest('nessun purchase: Phase A non crea invoice_lines / ingredient_vendors / aliases', async () => {
    const tables = { vendor_documents: [bekDoc({ id: 'bek-nopurchase' })] };
    const sb = makeMockSb(tables);
    await processOneQueuedDoc(sb, tables.vendor_documents[0], parsers);
    assert.strictEqual((tables.invoice_lines || []).length, 0);
    assert.strictEqual((tables.ingredient_vendors || []).length, 0);
    assert.strictEqual((tables.vendor_item_aliases || []).length, 0);
  });

  await atest('body-only non tocca mai lo Storage (nessuna remove spuria)', async () => {
    const doc = bekDoc({ id: 'bek-storage' });
    const sb = makeMockSb({ vendor_documents: [doc] });
    await processOneQueuedDoc(sb, doc, parsers);
    assert.strictEqual(sb.calls.storageRemoves, 0);
    assert.strictEqual(sb.calls.pdfDownloads, 0);
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail === 0 ? 0 : 1);
})();
