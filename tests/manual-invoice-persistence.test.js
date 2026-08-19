// ══════════════════════════════════════════════════════════════════
// Manual Import Invoice — vendor_documents persistence tests (BOH OS Task 6)
// Plain Node, no framework: `node tests/manual-invoice-persistence.test.js`
//
// js/invoice.js è codice browser (window, document, DOM) e non è
// require()-abile direttamente. Come negli altri test di questa serie,
// questo file legge il sorgente reale, estrae le funzioni di interesse
// con marker espliciti e le esegue con un mock minimo di Supabase — non
// una riscrittura della logica.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const INVOICE_JS = path.join(__dirname, '..', 'js', 'invoice.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); }
}
async function atest(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); }
}

// ── Estrae saveToInvoiceLines() reale ────────────────────────────
function loadRealSaveToInvoiceLines() {
  const src = fs.readFileSync(INVOICE_JS, 'utf8');
  const startMarker = 'async function saveToInvoiceLines(data){';
  const endMarker = '// ── EXPOSE PIPELINE FUNCTIONS TO WINDOW';
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    throw new Error('marker non trovati per saveToInvoiceLines — la funzione è cambiata di forma?');
  }
  const body = src.slice(start, end);
  return new Function('supa', 'showScToast', body + '\nreturn saveToInvoiceLines;');
}

// ── Estrae saveInvoice() reale (funzione completa, incluso try/catch) ──
function loadRealSaveInvoice() {
  const src = fs.readFileSync(INVOICE_JS, 'utf8');
  const startMarker = 'async function saveInvoice(data,btn){';
  const endMarker = 'function showDuplicateInvoiceModal(data,btn){';
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    throw new Error('marker non trovati per saveInvoice — la funzione è cambiata di forma?');
  }
  const body = src.slice(start, end);
  return new Function(
    'supa', 'user', 'document', 'showDuplicateInvoiceModal', 'showScToast',
    'saveToInvoiceLines', 'showSaveSuccessModal',
    body + '\nreturn saveInvoice;'
  );
}

function rawSource() {
  return fs.readFileSync(INVOICE_JS, 'utf8');
}

// ── Mock Supabase per saveToInvoiceLines: .from('invoice_lines').insert(lines).select(...) ──
function makeMockSupaForLines(config = {}) {
  const calls = { insertedLines: null };
  const supa = {
    from(table) {
      return {
        insert(lines) {
          calls.insertedLines = lines;
          return {
            select() {
              if (config.error) return Promise.resolve({ data: null, error: config.error });
              const inserted = lines.map((l, i) => ({ id: `line-uuid-${i}`, raw_description: l.raw_description }));
              return Promise.resolve({ data: inserted, error: null });
            },
          };
        },
      };
    },
  };
  return { supa, calls };
}

// ── Mock Supabase generico per saveInvoice: from(table).select().eq().eq().limit() /
//    .insert().select().single() / .update().eq() — registra tutte le chiamate ──
function makeMockSupaForSaveInvoice(config = {}) {
  const calls = { inserts: [], updates: [], selects: [] };
  function chain(table) {
    const c = {
      _eqs: [],
      select() { return c; },
      eq(k, v) { c._eqs.push([k, v]); return c; },
      in(k, v) { c._eqs.push([k, v]); return c; },
      limit() {
        calls.selects.push({ table, eqs: c._eqs });
        const dup = (config.duplicates && config.duplicates[table]) || [];
        return Promise.resolve({ data: dup });
      },
      insert(payload) {
        calls.inserts.push({ table, payload });
        return {
          select() {
            return {
              single() {
                const res = (config.insertResults && config.insertResults[table]) || { data: { id: 'vdoc-uuid-default' }, error: null };
                return Promise.resolve(res);
              },
            };
          },
        };
      },
      update(payload) {
        return {
          eq(_k, id) {
            calls.updates.push({ table, payload, id });
            return Promise.resolve({});
          },
        };
      },
    };
    return c;
  }
  return { supa: { from: (t) => chain(t) }, calls };
}

function makeBtn() {
  return { textContent: '', disabled: false, closest: () => ({ remove() {} }) };
}
function makeDocument() {
  return { getElementById: () => null };
}

console.log('\nManual Import Invoice — vendor_documents persistence test run\n');

(async () => {

  // ══ Gruppo A — saveToInvoiceLines() reale ══════════════════════

  // ── T3 — UUID collegato alle righe ─────────────────────────────
  await atest('T3: ogni riga invoice_lines riceve import_id = vendor_documents.id (UUID reale)', async () => {
    const { supa: mockSupa, calls } = makeMockSupaForLines();
    const fn = loadRealSaveToInvoiceLines()(mockSupa, () => {});
    const data = {
      _vendor_document_id: '11111111-1111-1111-1111-111111111111',
      invoice_date: '2026-08-19', invoice_number: '999',
      items: [{ description: 'Tomato Cherry', unit_price: 10, amount: 10 }, { description: 'Parsley', unit_price: 5, amount: 5 }],
    };
    await fn(data);
    assert.strictEqual(calls.insertedLines.length, 2);
    calls.insertedLines.forEach(l => assert.strictEqual(l.import_id, '11111111-1111-1111-1111-111111111111'));
  });

  // ── T4 — numero fattura presente ────────────────────────────────
  await atest('T4: invoice_number estratto dall\'AI arriva sulle righe', async () => {
    const { supa: mockSupa, calls } = makeMockSupaForLines();
    const fn = loadRealSaveToInvoiceLines()(mockSupa, () => {});
    const data = { _vendor_document_id: 'uuid-x', invoice_number: '123456', items: [{ description: 'Lime', amount: 3 }] };
    await fn(data);
    assert.strictEqual(calls.insertedLines[0].invoice_number, '123456');
  });

  // ── T5 — numero fattura assente ─────────────────────────────────
  await atest('T5: invoice_number assente -> null, nessun crash, nessun valore inventato', async () => {
    const { supa: mockSupa, calls } = makeMockSupaForLines();
    const fn = loadRealSaveToInvoiceLines()(mockSupa, () => {});
    const data = { _vendor_document_id: 'uuid-x', items: [{ description: 'Lime', amount: 3 }] }; // invoice_number assente
    await fn(data);
    assert.strictEqual(calls.insertedLines[0].invoice_number, null);
  });

  // ── T6 (parte 1) — insert fallisce -> saveToInvoiceLines torna null ──
  await atest('T6a: se l\'insert su invoice_lines fallisce, saveToInvoiceLines ritorna null (non crasha)', async () => {
    const { supa: mockSupa } = makeMockSupaForLines({ error: { message: 'simulated insert failure' } });
    const fn = loadRealSaveToInvoiceLines()(mockSupa, () => {});
    const data = { _vendor_document_id: 'uuid-x', items: [{ description: 'Lime', amount: 3 }] };
    const result = await fn(data);
    assert.strictEqual(result, null);
  });

  // ── T7 (parte 1) — regressione: il vecchio pattern non esiste più ──
  test('T7a: il pattern isValidUUID(data._purchase_id) non esiste più nel sorgente', () => {
    const src = rawSource();
    assert.ok(!src.includes('isValidUUID(data._purchase_id)'), 'vecchio bug ancora presente');
    assert.ok(src.includes('data._vendor_document_id||null'), 'nuovo import_id non trovato');
  });

  // ══ Gruppo B — saveInvoice() reale (funzione completa) ═════════

  // ── T1 — non usa più purchases ──────────────────────────────────
  await atest('T1: saveInvoice() non esegue alcun insert su purchases', async () => {
    const { supa: mockSupa, calls } = makeMockSupaForSaveInvoice();
    const saveToInvoiceLinesMock = async () => ([{ id: 'line-1', raw_description: 'Tomato' }]);
    const fn = loadRealSaveInvoice()(
      mockSupa, { name: 'Max' }, makeDocument(),
      () => {}, () => {}, saveToInvoiceLinesMock, async () => {}
    );
    const data = { vendor: "Hardie's Fresh Foods / Dairyland Produce", invoice_number: '07099001', invoice_date: '2026-08-19', items: [{ description: 'Tomato' }] };
    await fn(data, makeBtn());
    assert.ok(calls.inserts.every(c => c.table !== 'purchases'), 'non deve mai scrivere su purchases');
    assert.ok(calls.inserts.some(c => c.table === 'vendor_documents'), 'deve scrivere su vendor_documents');
  });

  // ── T2 — crea vendor_documents con vendor/type/status corretti ──
  await atest('T2: vendor_documents creato con vendor, document_type=invoice, status=pending', async () => {
    const { supa: mockSupa, calls } = makeMockSupaForSaveInvoice();
    const saveToInvoiceLinesMock = async () => ([{ id: 'line-1', raw_description: 'Tomato' }]);
    const fn = loadRealSaveInvoice()(
      mockSupa, { name: 'Max' }, makeDocument(),
      () => {}, () => {}, saveToInvoiceLinesMock, async () => {}
    );
    const data = { vendor: "Hardie's Fresh Foods / Dairyland Produce", invoice_number: '07099002', invoice_date: '2026-08-19', items: [{ description: 'Tomato' }] };
    await fn(data, makeBtn());
    const vdocInsert = calls.inserts.find(c => c.table === 'vendor_documents' && c.payload.document_number === '07099002');
    assert.ok(vdocInsert, 'insert su vendor_documents non trovato');
    assert.strictEqual(vdocInsert.payload.vendor, "Hardie's Fresh Foods / Dairyland Produce");
    assert.strictEqual(vdocInsert.payload.document_type, 'invoice');
    assert.strictEqual(vdocInsert.payload.status, 'pending');
  });

  // ── T5 (parte 2) — invoice_number assente non blocca il salvataggio ──
  await atest('T5b: senza invoice_number, document_number è null (non un timestamp o valore inventato)', async () => {
    const { supa: mockSupa, calls } = makeMockSupaForSaveInvoice();
    const saveToInvoiceLinesMock = async () => ([{ id: 'line-1', raw_description: 'Lime' }]);
    const fn = loadRealSaveInvoice()(
      mockSupa, { name: 'Max' }, makeDocument(),
      () => {}, () => {}, saveToInvoiceLinesMock, async () => {}
    );
    const data = { vendor: 'H-E-B', invoice_date: '2026-08-19', items: [{ description: 'Lime' }] }; // niente invoice_number
    await fn(data, makeBtn());
    const vdocInsert = calls.inserts.find(c => c.table === 'vendor_documents');
    assert.ok(vdocInsert);
    assert.strictEqual(vdocInsert.payload.document_number, null);
  });

  // ── T6 (parte 2) — invoice_lines fallisce end-to-end da saveInvoice ──
  await atest('T6b: se saveToInvoiceLines fallisce, il documento passa a status=error e NON si mostra successo', async () => {
    const { supa: mockSupa, calls } = makeMockSupaForSaveInvoice({
      insertResults: { vendor_documents: { data: { id: 'vdoc-fail-uuid' }, error: null } },
    });
    const saveToInvoiceLinesMock = async () => null; // simula fallimento
    let successModalCalled = false;
    let toastMessage = null;
    const fn = loadRealSaveInvoice()(
      mockSupa, { name: 'Max' }, makeDocument(),
      () => {}, (msg) => { toastMessage = msg; },
      saveToInvoiceLinesMock,
      async () => { successModalCalled = true; }
    );
    const btn = makeBtn();
    const data = { vendor: "Hardie's Fresh Foods / Dairyland Produce", invoice_number: '07099003', invoice_date: '2026-08-19', items: [{ description: 'Tomato' }] };
    await fn(data, btn);

    assert.strictEqual(successModalCalled, false, 'non deve mai mostrare successo se le righe falliscono');
    assert.ok(toastMessage && /error/i.test(toastMessage), 'deve mostrare un errore all\'utente');
    assert.strictEqual(btn.textContent, 'Error — retry');

    const errorUpdate = calls.updates.find(c => c.table === 'vendor_documents' && c.id === 'vdoc-fail-uuid');
    assert.ok(errorUpdate, 'il vendor_documents creato deve essere aggiornato');
    assert.strictEqual(errorUpdate.payload.status, 'error', 'deve restare identificabile come incompleto');
  });

  // ── T7 (parte 2) — regressione end-to-end: nessun purchases anche in caso di duplicato/errore ──
  await atest('T7b: anche nel percorso duplicato, nessuna scrittura su purchases', async () => {
    const { supa: mockSupa, calls } = makeMockSupaForSaveInvoice({
      duplicates: { vendor_documents: [{ id: 'existing-vdoc' }] },
    });
    let dupModalCalled = false;
    const fn = loadRealSaveInvoice()(
      mockSupa, { name: 'Max' }, makeDocument(),
      () => { dupModalCalled = true; }, () => {}, async () => null, async () => {}
    );
    const data = { vendor: "Hardie's Fresh Foods / Dairyland Produce", invoice_number: '07016705', invoice_date: '2026-06-26', items: [{ description: 'x' }] };
    await fn(data, makeBtn());
    assert.strictEqual(dupModalCalled, true, 'deve rilevare il duplicato su vendor_documents');
    assert.strictEqual(calls.inserts.length, 0, 'non deve inserire nulla se duplicato');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
