// ══════════════════════════════════════════════════════════════════
// WM01 — Walmart/TreviPay: revisione vs doppione, fattura senza articoli.
// Plain Node: `node tests/trevipay-revision.test.js`
//
// Caso reale: 9a7e7ac1 ($83.80) e 31f3acdd ($191.65), 28/09/2026. La prima
// versione TreviPay aveva solo la riga riassuntiva (numero d'ordine, nessuna
// descrizione); la "invoice has been updated" con gli articoli e' stata
// scartata come DUPLICATE e il suo PDF cancellato.
//
// Copre: il modulo condiviso, Phase A del worker (processOneQueuedDoc con
// PDF.js simulato sui fixture reali c51dd720), il riarmo in
// gmail-vendor-import e la parita' della regex fra i due worker.
// ══════════════════════════════════════════════════════════════════
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const TP = require('../js/vendor-parsers/trevipay-revision');
const WALMART = require('../js/vendor-parsers/walmart-trevipay-invoice');
const F = require('./fixtures/trevipay-samples');
const { processOneQueuedDoc, loadParsers, isBlockingWarning } = require('../pure_logic.cjs');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message ? e.message : e)); }
}

const SUBJ_NEW = 'New Walmart Business: Pay By Invoice invoice available: 9a7e7ac1';
const SUBJ_UPD = 'Walmart Business: Pay By Invoice invoice has been updated: 9a7e7ac1';

// Righe vere del PDF riassuntivo di 9a7e7ac1 (solo intestazione e tabella).
const SUMMARY_TEXT = [
  'Invoice 9a7e7ac1 How To Pay',
  'Total Due ', '$83.80',
  'Invoice Date ', '09/28/2026',
  'Buyer',
  'United States Massimilajo Zubboli',
  'Seller', 'Walmart Business',
  'Order Number PO Number',
  '200015168224760 -',
  '© 2026 TreviPay™ Page 1 of 2',
  'Invoice Details',
  'SKU Description Quantity Unit Price Discount Tax Billed Total',
  '200015168224760 1 $83.80 $0.00 $0.00 $83.80',
  'Invoice 9a7e7ac1 Invoice Summary',
  'Total Due ', '$83.80 Pre-Tax Subtotal $83.80',
].join('\n');

// ── Mock Supabase: stessa forma dei test BEK, piu' lo Storage registrato ──
function makeMockSb(tables) {
  const removed = [], uploaded = [];
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
      if (st.single) return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'nf' } };
      return { data: rows, error: null };
    }
    async function w(k) {
      tables[t] = tables[t] || [];
      if (k === 'insert') { tables[t].push(...st.rows); return { data: st.rows, error: null }; }
      const m = filt(tables[t]); m.forEach((r) => Object.assign(r, st.upd));
      return { data: m, error: null };
    }
    return api;
  }
  return {
    tables, removed, uploaded,
    from: (t) => builder(t),
    storage: { from: () => ({
      remove: async (paths) => { removed.push(...paths); return {}; },
      download: async () => ({ data: { arrayBuffer: async () => new ArrayBuffer(8) }, error: null }),
      upload: async (p) => { uploaded.push(p); return { error: null }; },
    }) },
  };
}

// PDF.js simulato: restituisce gli items reali della fattura c51dd720.
globalThis.pdfjsLib = {
  getDocument: () => ({ promise: Promise.resolve({
    numPages: 2,
    getPage: async (i) => ({ getTextContent: async () => ({ items: i === 1 ? F.C51DD720_PAGE1 : F.C51DD720_PAGE2 }) }),
  }) }),
};

function docRow(over) {
  return Object.assign({
    id: 'doc', vendor: 'unknown', document_type: 'invoice', document_number: null, status: 'pdf_received',
    source_email_from: '"Walmart Business: Pay By Invoice Support" <no-reply@trevipay.app>',
    parsed_json: { storage_path: 'invoices/gmail/rev.pdf' }, warnings: [], raw_text: 'invoices/gmail/rev.pdf',
  }, over);
}

(async () => {
  console.log('\n  WM01 — modulo condiviso');

  await test('subject: "invoice has been updated" e\' una revisione, "invoice available" no', () => {
    assert.strictEqual(TP.isTreviPayRevisionSubject(SUBJ_UPD), true);
    assert.strictEqual(TP.isTreviPayRevisionSubject('Walmart Business: Pay By Invoice invoice has been updated: 31f3acdd'), true);
    assert.strictEqual(TP.isTreviPayRevisionSubject(SUBJ_NEW), false);
    assert.strictEqual(TP.isTreviPayRevisionSubject('Your invoice has been updated'), false, 'serve anche "Pay By Invoice"');
    assert.strictEqual(TP.isTreviPayRevisionSubject(null), false);
  });

  await test('la fattura riassuntiva reale diventa TREVIPAY_SUMMARY_ONLY, senza PARSE_ERROR e senza righe inventate', () => {
    const parsed = WALMART.parse(SUMMARY_TEXT);
    assert.strictEqual(parsed.items.length, 0);
    assert.ok(parsed.warnings.some(w => w.code === 'PARSE_ERROR'));
    const out = TP.annotateSummaryOnly(parsed, SUMMARY_TEXT);
    assert.strictEqual(out.items.length, 0, 'nessuna riga inventata');
    assert.deepStrictEqual(out.warnings.map(w => w.code), ['TREVIPAY_SUMMARY_ONLY']);
    assert.strictEqual(out.summary_only, true);
    assert.ok(/doesn't include item details yet/.test(out.warnings[0].message));
    assert.ok(parsed.warnings.some(w => w.code === 'PARSE_ERROR'), 'il parsed originale non viene mutato');
  });

  await test('una fattura Walmart normale con articoli resta identica', () => {
    const parsed = { vendor: 'Walmart Business', items: [{ description: 'x' }], warnings: [] };
    assert.strictEqual(TP.annotateSummaryOnly(parsed, SUMMARY_TEXT), parsed);
  });

  await test('un altro vendor senza righe tiene il suo PARSE_ERROR', () => {
    const parsed = { vendor: 'Fruge Seafood', items: [], warnings: [{ code: 'PARSE_ERROR' }] };
    assert.strictEqual(TP.annotateSummaryOnly(parsed, SUMMARY_TEXT), parsed);
  });

  const withItems = { vendor: 'Walmart Business', document_type: 'invoice', items: [{ description: 'milk' }] };
  const rev = { id: 'rev', source_email_subject: SUBJ_UPD };

  await test('decideRevision: originale in errore -> SUPERSEDES, gli ignored non si toccano', () => {
    const d = TP.decideRevision({ doc: rev, parsed: withItems, docNumber: '9a7e7ac1',
      siblings: [{ id: 'orig', status: 'error' }, { id: 'old', status: 'ignored' }] });
    assert.strictEqual(d.outcome, TP.OUTCOME.SUPERSEDES);
    assert.deepStrictEqual(d.supersedeIds, ['orig']);
  });

  await test('decideRevision: originale gia\' importato -> AFTER_IMPORT bloccante', () => {
    const d = TP.decideRevision({ doc: rev, parsed: withItems, docNumber: '9a7e7ac1', siblings: [{ id: 'orig', status: 'imported' }] });
    assert.strictEqual(d.outcome, TP.OUTCOME.AFTER_IMPORT);
    assert.strictEqual(d.warnings[0].code, 'TREVIPAY_REVISION_AFTER_IMPORT');
    assert.deepStrictEqual(d.supersedeIds, []);
  });

  await test('decideRevision: revisione ancora senza articoli -> NO_ITEMS_YET, nessuna sostituzione', () => {
    const d = TP.decideRevision({ doc: rev, parsed: { vendor: 'Walmart Business', items: [] }, docNumber: '9a7e7ac1', siblings: [{ id: 'orig', status: 'error' }] });
    assert.strictEqual(d.outcome, TP.OUTCOME.NO_ITEMS_YET);
    assert.deepStrictEqual(d.supersedeIds, []);
  });

  await test('decideRevision: senza fratelli, o con subject non di revisione, non si applica', () => {
    assert.strictEqual(TP.decideRevision({ doc: rev, parsed: withItems, docNumber: 'x', siblings: [] }).applies, false);
    assert.strictEqual(TP.decideRevision({ doc: { id: 'n', source_email_subject: SUBJ_NEW }, parsed: withItems, docNumber: 'x', siblings: [{ id: 'o', status: 'error' }] }).applies, false);
  });

  await test('il worker tratta i due nuovi codici come bloccanti', () => {
    assert.strictEqual(isBlockingWarning({ code: 'TREVIPAY_SUMMARY_ONLY' }, {}, {}), true);
    assert.strictEqual(isBlockingWarning({ code: 'TREVIPAY_REVISION_AFTER_IMPORT' }, {}, {}), true);
  });

  console.log('\n  WM01 — Phase A (processOneQueuedDoc, PDF reale c51dd720)');
  const PARSERS = loadParsers();
  const SUBJ_C51_UPD = 'Walmart Business: Pay By Invoice invoice has been updated: c51dd720';
  const SUBJ_C51_NEW = 'New Walmart Business: Pay By Invoice invoice available: c51dd720';

  await test('revisione con articoli: l\'originale vuoto diventa ignored con lo storico, la revisione va in pending, nessun PDF cancellato', async () => {
    const orig = docRow({ id: 'orig', vendor: 'Walmart Business', document_number: 'c51dd720', status: 'error',
      source_email_subject: SUBJ_C51_NEW, warnings: [{ code: 'PARSE_ERROR', message: 'No line items found' }] });
    const revDoc = docRow({ id: 'rev', source_email_subject: SUBJ_C51_UPD });
    const sb = makeMockSb({ vendor_documents: [orig, revDoc],
      invoice_warnings: [{ id: 'w1', document_id: 'orig', code: 'PARSE_ERROR', status: 'open' }] });
    const r = await processOneQueuedDoc(sb, revDoc, PARSERS);
    assert.strictEqual(r.outcome, 'parsed_pending', JSON.stringify(r));
    assert.strictEqual(revDoc.status, 'pending');
    assert.ok(revDoc.parsed_json.items.length > 0, 'la revisione ha le righe vere');
    assert.strictEqual(orig.status, 'ignored');
    assert.deepStrictEqual(orig.warnings.map(w => w.code), ['PARSE_ERROR', 'SUPERSEDED_BY_REVISION'], 'storico conservato');
    assert.strictEqual(orig.warnings[1].superseded_by, 'rev');
    assert.strictEqual(sb.tables.invoice_warnings[0].status, 'resolved');
    assert.deepStrictEqual(sb.removed, [], 'nessun PDF cancellato');
  });

  await test('revisione dopo l\'import: l\'originale non si tocca, la revisione si ferma con il blocco e il PDF resta', async () => {
    const orig = docRow({ id: 'orig', vendor: 'Walmart Business', document_number: 'c51dd720', status: 'imported', source_email_subject: SUBJ_C51_NEW });
    const revDoc = docRow({ id: 'rev', source_email_subject: SUBJ_C51_UPD });
    const sb = makeMockSb({ vendor_documents: [orig, revDoc], invoice_warnings: [] });
    const r = await processOneQueuedDoc(sb, revDoc, PARSERS);
    assert.strictEqual(r.outcome, 'trevipay_revision_after_import');
    assert.strictEqual(orig.status, 'imported');
    assert.strictEqual(revDoc.status, 'pending');
    assert.strictEqual(revDoc.warnings[0].code, 'TREVIPAY_REVISION_AFTER_IMPORT');
    assert.strictEqual(sb.tables.invoice_warnings.length, 1);
    assert.deepStrictEqual(sb.removed, []);
  });

  await test('regressione: un doppione vero (stesso subject "available") resta DUPLICATE e il PDF si cancella come prima', async () => {
    const orig = docRow({ id: 'orig', vendor: 'Walmart Business', document_number: 'c51dd720', status: 'imported', source_email_subject: SUBJ_C51_NEW });
    const dup = docRow({ id: 'dup', source_email_subject: SUBJ_C51_NEW });
    const sb = makeMockSb({ vendor_documents: [orig, dup], invoice_warnings: [] });
    const r = await processOneQueuedDoc(sb, dup, PARSERS);
    assert.strictEqual(r.outcome, 'duplicate');
    assert.strictEqual(dup.warnings[0].code, 'DUPLICATE');
    assert.deepStrictEqual(sb.removed, ['invoices/gmail/rev.pdf']);
  });

  await test('regressione: una fattura Walmart nuova senza fratelli segue il percorso normale', async () => {
    const d = docRow({ id: 'solo', source_email_subject: SUBJ_C51_NEW });
    const sb = makeMockSb({ vendor_documents: [d], invoice_warnings: [] });
    const r = await processOneQueuedDoc(sb, d, PARSERS);
    assert.strictEqual(r.outcome, 'parsed_pending');
    assert.strictEqual(d.vendor, 'Walmart Business');
    assert.strictEqual(d.document_number, 'c51dd720');
  });

  console.log('\n  WM01 — gmail-vendor-import (handler vero, transpilato)');
  const GVI = fs.readFileSync(path.join(__dirname, '../edge-functions/gmail-vendor-import/index.ts'), 'utf8');

  await test('la regex di revisione e\' identica nei due worker', () => {
    const m = GVI.match(/const TREVIPAY_REVISION_SUBJECT_RE = (\/.*\/i);/);
    const mod = fs.readFileSync(path.join(__dirname, '../js/vendor-parsers/trevipay-revision.js'), 'utf8')
      .match(/const REVISION_SUBJECT_RE = (\/.*\/i);/);
    assert.ok(m && mod);
    assert.strictEqual(m[1], mod[1]);
  });

  let handler = null, sbForHandler = null;
  try {
    const esbuild = require('esbuild');
    const src = GVI.split('\n').filter(l => !/^import .*'jsr:/.test(l)).join('\n');
    const js = esbuild.transformSync(src, { loader: 'ts', format: 'cjs' }).code;
    globalThis.Deno = { serve: (fn) => { handler = fn; }, env: { get: () => 'x' } };
    globalThis.createClient = () => sbForHandler;
    new Function('require', 'module', 'exports', js)(require, { exports: {} }, {});
  } catch (e) {
    console.log('    (esbuild non disponibile: test del riarmo saltati — ' + e.message + ')');
  }
  const post = async (body) => {
    const res = await handler({ method: 'POST', json: async () => body });
    return JSON.parse(await res.text());
  };
  const PDF_B64 = Buffer.from('%PDF-1.4 test').toString('base64');
  const FROM = '"Walmart Business: Pay By Invoice Support" <no-reply@trevipay.app>';

  if (handler) {
    await test('revisione scartata come DUPLICATE: la stessa email la riarma (stesso documento, nuovo PDF, storico)', async () => {
      const discarded = { id: 'unk', status: 'error', vendor: 'unknown', source_email_subject: SUBJ_UPD, source_email_from: FROM,
        warnings: [{ code: 'DUPLICATE', message: 'Document #9a7e7ac1 already exists' }],
        parsed_json: { storage_path: 'invoices/gmail/old_9a7e7ac1.pdf', original_filename: '9a7e7ac1.pdf' } };
      sbForHandler = makeMockSb({ vendor_documents: [discarded] });
      const out = await post({ pdf_base64: PDF_B64, filename: '9a7e7ac1.pdf', subject: SUBJ_UPD, from: FROM });
      assert.strictEqual(out.status, 'queued', JSON.stringify(out));
      assert.strictEqual(out.document_id, 'unk');
      assert.strictEqual(discarded.status, 'pdf_received');
      assert.deepStrictEqual(discarded.warnings, []);
      assert.strictEqual(discarded.parsed_json.storage_path, sbForHandler.uploaded[0]);
      assert.strictEqual(discarded.parsed_json.rearmed.length, 1);
      assert.strictEqual(discarded.parsed_json.rearmed[0].previous_storage_path, 'invoices/gmail/old_9a7e7ac1.pdf');
      assert.strictEqual(sbForHandler.tables.vendor_documents.length, 1, 'nessun documento nuovo');
    });

    await test('la stessa email arrivata di nuovo con il documento gia\' riarmato resta un doppione', async () => {
      const live = { id: 'unk', status: 'pending', source_email_subject: SUBJ_UPD, source_email_from: FROM, warnings: [], parsed_json: {} };
      sbForHandler = makeMockSb({ vendor_documents: [live] });
      const out = await post({ pdf_base64: PDF_B64, filename: '9a7e7ac1.pdf', subject: SUBJ_UPD, from: FROM });
      assert.strictEqual(out.status, 'duplicate');
      assert.deepStrictEqual(sbForHandler.uploaded, []);
    });

    await test('un DUPLICATE di un\'email non di revisione resta un doppione (nessun riarmo fuori da TreviPay)', async () => {
      const subj = 'INVOICE - #06997941';
      const row = { id: 'h', status: 'error', source_email_subject: subj, source_email_from: 'x@hardies.com',
        warnings: [{ code: 'DUPLICATE' }], parsed_json: {} };
      sbForHandler = makeMockSb({ vendor_documents: [row] });
      const out = await post({ pdf_base64: PDF_B64, filename: 'a.pdf', subject: subj, from: 'x@hardies.com' });
      assert.strictEqual(out.status, 'duplicate');
      assert.strictEqual(row.status, 'error');
    });
  }

  console.log(`\n  ${pass} pass, ${fail} fail\n`);
  process.exit(fail ? 1 : 0);
})();
