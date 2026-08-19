// ══════════════════════════════════════════════════════════════════
// Vendor Review — approve/populate invoice_lines tests (BOH OS Task 7)
// Plain Node, no framework: `node tests/vendor-review-manual-import.test.js`
//
// js/vendor-documents-review.js è codice browser dentro vdrApprove(), una
// funzione molto grande legata a DOM/preflight/match-modal non isolabile
// con require(). Come negli altri test di questa serie, questo file legge
// il sorgente reale, estrae il blocco "Populate invoice_lines" con marker
// espliciti — l'unico blocco toccato da questo task — e lo esegue con un
// mock minimo di Supabase. Non è una riscrittura della logica.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const VDR_JS = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');

global.window = global.window || {}; // il blocco reale legge window.vdrPackToGrams

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); }
}
async function atest(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); }
}

function extractPopulateInvoiceLinesBlock() {
  const src = fs.readFileSync(VDR_JS, 'utf8');
  const startMarker = '// ── Populate invoice_lines (invoices only) ────────────────────';
  const endMarker = '// Mark imported';
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    throw new Error('marker non trovati in js/vendor-documents-review.js — il blocco "Populate invoice_lines" è cambiato di forma?');
  }
  return src.slice(start, end);
}

async function runPopulateInvoiceLines({ sb, pj, items, docId, docEdits = {}, skuMap = {}, linkMap = {}, vendor, invoiceDate }) {
  const snippet = extractPopulateInvoiceLinesBlock();
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction('sb', 'pj', 'items', 'docId', 'docEdits', 'skuMap', 'linkMap', 'vendor', 'invoiceDate', snippet);
  return fn(sb, pj, items, docId, docEdits, skuMap, linkMap, vendor, invoiceDate);
}

// Mock minimo: sb.from('invoice_lines').select('id').eq('import_id',docId).limit(1)
// e sb.from('invoice_lines').insert(rows)
function makeMockSb(config = {}) {
  const calls = { selects: [], inserts: [] };
  const sb = {
    from(table) {
      return {
        select() {
          return {
            eq(_k, id) {
              return {
                limit() {
                  calls.selects.push({ table, id });
                  const existing = (config.existingLines && config.existingLines[id]) || [];
                  return Promise.resolve({ data: existing });
                },
              };
            },
          };
        },
        insert(rows) {
          calls.inserts.push({ table, rows });
          return Promise.resolve({ error: config.insertError || null });
        },
      };
    },
  };
  return { sb, calls };
}

console.log('\nVendor Review — Manual Import / duplicate invoice_lines test run\n');

(async () => {

  // ── T1 — Manual document con linee esistenti ─────────────────────
  // vendor_documents.id = UUID-A, 5 righe già presenti, nessun PDF referenziato
  // in nessun punto di questo blocco (nessun errore "PDF missing" possibile).
  await atest('T1: documento con 5 invoice_lines già esistenti -> nessun nuovo insert, nessun errore', async () => {
    const docId = 'UUID-A';
    const { sb, calls } = makeMockSb({ existingLines: { [docId]: [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }, { id: 'l4' }, { id: 'l5' }] } });
    const pj = { document_type: 'invoice', document_number: '07099010' };
    await runPopulateInvoiceLines({ sb, pj, items: [], docId, vendor: 'Hardie\'s Fresh Foods / Dairyland Produce', invoiceDate: '2026-08-19' });
    assert.strictEqual(calls.inserts.length, 0, 'non deve inserire un secondo set di righe');
  });

  // ── T2 — Numero fattura null ──────────────────────────────────────
  await atest('T2: come T1 ma document_number=null -> reviewable, nessun crash', async () => {
    const docId = 'UUID-B';
    const { sb, calls } = makeMockSb({ existingLines: { [docId]: [{ id: 'l1' }] } });
    const pj = { document_type: 'invoice', document_number: null };
    await runPopulateInvoiceLines({ sb, pj, items: [], docId, vendor: 'H-E-B', invoiceDate: null });
    assert.strictEqual(calls.inserts.length, 0);
  });

  // ── T3 — Gmail document normale (0 righe esistenti, PDF-derived items) ──
  await atest('T3: documento Gmail normale con 0 righe esistenti -> comportamento invariato, righe inserite da parsed_json.items', async () => {
    const docId = 'UUID-GMAIL';
    const { sb, calls } = makeMockSb({ existingLines: { [docId]: [] } });
    const pj = { document_type: 'invoice', document_number: '07071903', invoice_date: '2026-08-10' };
    const items = [{ description: 'TOMATO CHERRY ON THE VINE', unit_price: 12, amount: 12, qty_ordered: 1 }];
    await runPopulateInvoiceLines({ sb, pj, items, docId, vendor: "Hardie's Fresh Foods / Dairyland Produce", invoiceDate: '2026-08-10' });
    assert.strictEqual(calls.inserts.length, 1, 'il path Gmail deve continuare a inserire le righe come prima');
    assert.strictEqual(calls.inserts[0].rows.length, 1);
    assert.strictEqual(calls.inserts[0].rows[0].import_id, docId);
  });

  // ── T4 — Documento con linee già esistenti NON viene duplicato ──
  // (riprocessare/riaprire non deve creare una seconda copia)
  await atest('T4: rieseguire il blocco due volte su un documento con righe esistenti non duplica mai', async () => {
    const docId = 'UUID-A';
    const { sb, calls } = makeMockSb({ existingLines: { [docId]: [{ id: 'l1' }] } });
    const pj = { document_type: 'invoice' };
    await runPopulateInvoiceLines({ sb, pj, items: [{ description: 'x' }], docId, vendor: 'v', invoiceDate: null });
    await runPopulateInvoiceLines({ sb, pj, items: [{ description: 'x' }], docId, vendor: 'v', invoiceDate: null });
    assert.strictEqual(calls.inserts.length, 0);
  });

  // ── T5 — Approval path ────────────────────────────────────────────
  // Il blocco non lancia eccezioni quando le righe esistono già, quindi il
  // codice non modificato subito dopo (status -> 'imported') viene raggiunto
  // normalmente — nessuna modifica alla semantica di approvazione.
  await atest('T5: nessuna eccezione quando le righe esistono già -> il flow di approvazione può proseguire', async () => {
    const docId = 'UUID-A';
    const { sb } = makeMockSb({ existingLines: { [docId]: [{ id: 'l1' }] } });
    const pj = { document_type: 'invoice' };
    await runPopulateInvoiceLines({ sb, pj, items: [], docId, vendor: 'v', invoiceDate: null }); // non deve rigettare
  });

  // ── T6 — Failure reale ────────────────────────────────────────────
  await atest('T6: nessuna riga esistente e nessun item estraibile -> errore esplicito, non "imported" silenzioso', async () => {
    const docId = 'UUID-EMPTY';
    const { sb, calls } = makeMockSb({ existingLines: { [docId]: [] } });
    const pj = { document_type: 'invoice' };
    await assert.rejects(
      () => runPopulateInvoiceLines({ sb, pj, items: [], docId, vendor: 'v', invoiceDate: null }),
      /No invoice lines found or extractable/
    );
    assert.strictEqual(calls.inserts.length, 0, 'non deve inserire nulla nel percorso di errore');
  });

  // ── Verifica di collegamento: il guard è realmente nel sorgente ────
  test('il controllo su invoice_lines esistenti è presente e collegato prima del build delle righe', () => {
    const src = fs.readFileSync(VDR_JS, 'utf8');
    assert.ok(src.includes("select('id').eq('import_id', docId).limit(1)"), 'guard non trovato');
    assert.ok(src.includes('No invoice lines found or extractable'), 'errore esplicito T6 non trovato');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
