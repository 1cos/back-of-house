// ══════════════════════════════════════════════════════════════════
// Vendor Documents Review — order_confirmation/invoice reconciliation
// tests (BOH OS Task 3)
// Plain Node, no framework: `node tests/vendor-documents-reconciliation.test.js`
//
// js/vendor-documents-review.js è codice browser dentro una funzione async
// molto grande (vdrProcessAllPdf), non isolabile con require(). Come
// tests/prep-station-visibility.test.js e tests/warnings-banner-actionable.test.js,
// questo test legge il sorgente reale, estrae il blocco di riconciliazione
// con marker espliciti ed esegue quel codice esatto contro un mock minimo
// di Supabase che registra le chiamate .update() — non una riscrittura
// della logica.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const VDR_JS = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); }
}
async function atest(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); }
}

function extractReconciliationBlock() {
  const src = fs.readFileSync(VDR_JS, 'utf8');
  const startMarker = "// ── Hardie's / Chef's Warehouse: order_confirmation <-> invoice reconciliation ──";
  const endMarker = 'const allWarnings = [';
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    throw new Error('marker non trovati in js/vendor-documents-review.js — il blocco di riconciliazione è cambiato di forma?');
  }
  return src.slice(start, end);
}

// Mock minimo che riproduce esattamente la catena usata dal codice reale:
// sb.from('vendor_documents').select('id,status').eq().eq().eq().neq().limit(1)
// sb.from('vendor_documents').update({...}).eq('id', x)
function makeMockSb(counterpartRows) {
  const calls = { updates: [] };
  const sb = {
    from(table) {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        neq() {
                          return { limit: () => Promise.resolve({ data: counterpartRows }) };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
        update(payload) {
          return { eq: (_k, id) => { calls.updates.push({ table, payload, id }); return Promise.resolve({}); } };
        },
      };
    },
  };
  return { sb, calls };
}

// Esegue il blocco reale estratto, con `sb`, `parsed`, `docNumber`, `doc`
// iniettati come nella funzione originale. `continue` è valido perché il
// blocco viene eseguito dentro un ciclo a una sola iterazione, esattamente
// come nel codice reale (dentro il for-of di vdrProcessAllPdf).
async function runReconciliation({ sb, parsed, docNumber, doc }) {
  const snippet = extractReconciliationBlock();
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const runner = new AsyncFunction('sb', 'parsed', 'docNumber', 'doc', `
    let done = 0;
    for (let _once = 0; _once < 1; _once++) {
      ${snippet}
    }
    return { done };
  `);
  return runner(sb, parsed, docNumber, doc);
}

const HARDIES = "Hardie's Fresh Foods / Dairyland Produce";

console.log('\nVendor Documents Reconciliation — order_confirmation/invoice test run\n');

(async () => {

  // ── T1 — Confirmation poi Invoice ──────────────────────────────
  await atest('T1: Invoice arriva dopo la Confirmation → Confirmation diventa ignored, Invoice procede', async () => {
    const { sb, calls } = makeMockSb([{ id: 'confirmation-id-07075282', status: 'pending' }]);
    const result = await runReconciliation({
      sb, docNumber: '07075282', doc: { id: 'invoice-id-07075282' },
      parsed: { vendor: HARDIES, document_type: 'invoice' },
    });
    assert.strictEqual(calls.updates.length, 1);
    assert.strictEqual(calls.updates[0].id, 'confirmation-id-07075282');
    assert.strictEqual(calls.updates[0].payload.status, 'ignored');
    assert.strictEqual(result.done, 0, "l'Invoice non deve fare continue — deve procedere come documento operativo");
  });

  // ── T2 — Invoice poi Confirmation ──────────────────────────────
  await atest('T2: Confirmation arriva dopo l\'Invoice → Confirmation stessa diventa ignored, non diventa pending', async () => {
    const { sb, calls } = makeMockSb([{ id: 'invoice-id-07075282', status: 'pending' }]);
    const result = await runReconciliation({
      sb, docNumber: '07075282', doc: { id: 'confirmation-id-07075282' },
      parsed: { vendor: HARDIES, document_type: 'order_confirmation' },
    });
    assert.strictEqual(calls.updates.length, 1);
    assert.strictEqual(calls.updates[0].id, 'confirmation-id-07075282', 'deve auto-marcarsi ignored, non toccare l\'Invoice');
    assert.strictEqual(calls.updates[0].payload.status, 'ignored');
    assert.strictEqual(result.done, 1, 'deve fare continue (skip) — non deve mai diventare pending');
  });

  // ── T3 — Numeri diversi ─────────────────────────────────────────
  await atest('T3: document_number diversi → nessuna riconciliazione (nessun match dal DB)', async () => {
    const { sb, calls } = makeMockSb([]); // query reale non troverebbe nulla con numero diverso
    const result = await runReconciliation({
      sb, docNumber: '07071903', doc: { id: 'invoice-id-07071903' },
      parsed: { vendor: HARDIES, document_type: 'invoice' },
    });
    assert.strictEqual(calls.updates.length, 0);
    assert.strictEqual(result.done, 0);
  });

  // ── T4 — Altro vendor ─────────────────────────────────────────
  await atest('T4: stesso document_number ma vendor diverso → nessuna riconciliazione (gate vendor blocca prima della query)', async () => {
    // counterpartRows con un match "finto" per dimostrare che il gate sul vendor
    // impedisce la riconciliazione anche se un match esistesse.
    const { sb, calls } = makeMockSb([{ id: 'other-vendor-doc-id', status: 'pending' }]);
    const result = await runReconciliation({
      sb, docNumber: '07075282', doc: { id: 'freshpoint-doc-id' },
      parsed: { vendor: 'FreshPoint Dallas', document_type: 'invoice' },
    });
    assert.strictEqual(calls.updates.length, 0);
    assert.strictEqual(result.done, 0);
  });

  // ── T5 — Solo Confirmation ──────────────────────────────────────
  await atest('T5: solo Confirmation, nessuna Invoice ancora → comportamento normale, non nascosta preventivamente', async () => {
    const { sb, calls } = makeMockSb([]);
    const result = await runReconciliation({
      sb, docNumber: '07099999', doc: { id: 'confirmation-only-id' },
      parsed: { vendor: HARDIES, document_type: 'order_confirmation' },
    });
    assert.strictEqual(calls.updates.length, 0, 'non deve auto-nascondersi in assenza di Invoice');
    assert.strictEqual(result.done, 0);
  });

  // ── T6 — Solo Invoice ────────────────────────────────────────────
  await atest('T6: solo Invoice, nessuna Confirmation → comportamento normale attuale', async () => {
    const { sb, calls } = makeMockSb([]);
    const result = await runReconciliation({
      sb, docNumber: '07099998', doc: { id: 'invoice-only-id' },
      parsed: { vendor: HARDIES, document_type: 'invoice' },
    });
    assert.strictEqual(calls.updates.length, 0);
    assert.strictEqual(result.done, 0);
  });

  // ── Extra — Confirmation già 'imported' non viene toccata ────────
  await atest("extra: se la Confirmation è già status='imported' (invoice_lines reali possibili), non viene toccata", async () => {
    const { sb, calls } = makeMockSb([{ id: 'confirmation-imported-id', status: 'imported' }]);
    await runReconciliation({
      sb, docNumber: '07075282', doc: { id: 'invoice-id-x' },
      parsed: { vendor: HARDIES, document_type: 'invoice' },
    });
    assert.strictEqual(calls.updates.length, 0, 'una Confirmation già importata non deve essere silenziosamente nascosta');
  });

  // ── Extra — credit_memo escluso dallo scope ──────────────────────
  await atest('extra: document_type=credit_memo non entra mai in riconciliazione', async () => {
    const { sb, calls } = makeMockSb([{ id: 'some-invoice-id', status: 'pending' }]);
    const result = await runReconciliation({
      sb, docNumber: '07075282', doc: { id: 'credit-memo-id' },
      parsed: { vendor: HARDIES, document_type: 'credit_memo' },
    });
    assert.strictEqual(calls.updates.length, 0);
    assert.strictEqual(result.done, 0);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
