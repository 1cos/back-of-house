// ══════════════════════════════════════════════════════════════════
// Vendor Review — gate ingredient_vendors (price intelligence) writes to
// Invoice only, never Order Confirmation (BOH OS Task 11V)
// Plain Node, zero dipendenze npm proprie (usa jsdom già presente per il
// `document` reale): `node tests/vendor-review-price-gate.test.js`
//
// Esegue la VERA window.vdrApprove() (estratta invariata da
// js/vendor-documents-review.js via eval del file intero) contro un mock
// Supabase generico che si comporta come un vero query builder
// (.select/.eq/.in/.update/.insert/.single, tutti thenable) — non un mock
// che "sa già" cosa filtrare, i conteggi vengono dalle chiamate reali.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const VDR_JS = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }
async function atest(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }

// ── jsdom document — vdrApprove tocca document.getElementById/createElement/body ──
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = global.window || {};

// ── Generic thenable Supabase mock — un vero query builder, non uno shortcut ──
function makeGenericSb(tables) {
  const calls = { updates: [], inserts: [] };
  function builder(tableName) {
    const state = { filters: [], single: false };
    const b = {
      select() { return b; },
      eq(k, v) { state.filters.push(['eq', k, v]); return b; },
      in(k, values) { state.filters.push(['in', k, values]); return b; },
      order() { return b; },
      limit() { return b; },
      single() { state.single = true; return b; },
      update(data) {
        const rec = { table: tableName, data, filters: [] };
        calls.updates.push(rec);
        const ub = {
          eq(k, v) { rec.filters.push(['eq', k, v]); return ub; },
          then(resolve) { resolve({ error: null }); },
        };
        return ub;
      },
      insert(row) {
        calls.inserts.push({ table: tableName, row });
        return { then(resolve) { resolve({ error: null }); } };
      },
      then(resolve) {
        let rows = (tables[tableName] || []).slice();
        for (const [type, k, v] of state.filters) {
          if (type === 'eq') rows = rows.filter(r => r[k] === v);
          if (type === 'in') rows = rows.filter(r => Array.isArray(v) && v.includes(r[k]));
        }
        if (state.single) resolve({ data: rows[0] || null, error: rows[0] ? null : { message: 'not found' } });
        else resolve({ data: rows, error: null });
      },
    };
    return b;
  }
  return { sb: { from: builder }, calls };
}

function loadRealVdrModule() {
  const src = fs.readFileSync(VDR_JS, 'utf8');
  // Il file, eseguito in browser, fa `window.vdrApprove = async function...`
  // direttamente sul parametro `window` passato qui (== global.window) —
  // nessun wiring aggiuntivo necessario dopo l'eval.
  const fn = new Function('window', 'document', src);
  fn(global.window, global.document);
}

console.log('\nVendor Review — gate ingredient_vendors a solo Invoice (Task 11V) — test run\n');

// ── Verifica strutturale: la riga reale nel sorgente ──────────────────
test("verifica riga reale: 'if (pj.document_type === 'invoice') {' racchiude il blocco ingredient_vendors (non solo invoice_lines)", () => {
  const src = fs.readFileSync(VDR_JS, 'utf8');
  const occurrences = src.split("if (pj.document_type === 'invoice') {").length - 1;
  assert.strictEqual(occurrences, 2, "atteso ESATTAMENTE 2 gate 'invoice' — uno per ingredient_vendors (nuovo, Task 11V) e uno per invoice_lines (preesistente)");
  const ivBlockIdx = src.indexOf("ingredient_vendors (price intelligence) — invoices only");
  assert.ok(ivBlockIdx > -1, 'commento del fix Task 11V non trovato');
  const gateAfterComment = src.indexOf("if (pj.document_type === 'invoice') {", ivBlockIdx);
  assert.ok(gateAfterComment > -1 && gateAfterComment < ivBlockIdx + 1200, 'il gate deve seguire a breve distanza il commento del fix Task 11V, racchiudendo il blocco ingredient_vendors');
});

const BEK_ITEM = { vendor_sku: '116533', description: 'Pastry Bag 21in Clr Disposable', raw_description: 'Pastry Bag 21in Clr Disposable', pack_description: '1/ 100 CT', unit_price: 40.98, qty_ordered: 2, qty_received: 2, amount: 81.96, warnings: [] };

function makeDoc(docType, docId) {
  return {
    id: docId,
    document_number: '0002952908',
    vendor: 'Ben E. Keith',
    status: 'pending',
    warnings: null,
    parsed_json: {
      vendor: 'Ben E. Keith',
      document_type: docType,
      document_number: '0002952908',
      document_date: '2026-08-20',
      delivery_date: '2026-08-20',
      total: 81.96,
      items: [BEK_ITEM],
      warnings: [],
    },
  };
}

function baseTables(doc) {
  return {
    vendor_documents: [doc],
    ingredient_vendors: [{ id: 'iv-1', ingredient_id: 'ing-1', vendor_sku: '116533', vendor: 'Ben E. Keith' }],
    ingredient_links: [],
    invoice_lines: [],
  };
}

(async () => {

  // ── T1/T2/T3 — Order Confirmation ────────────────────────────────
  await atest('T1: Order Confirmation — 0 UPDATE e 0 INSERT su ingredient_vendors', async () => {
    loadRealVdrModule();
    const docId = 'oc-doc-1';
    const doc = makeDoc('order_confirmation', docId);
    const { sb, calls } = makeGenericSb(baseTables(doc));
    global.window.supabaseClient = sb;
    global.window._vdrEdits = {};
    const btn = { disabled: false, textContent: '', style: {} };
    await global.window.vdrApprove(docId, btn);

    const ivUpdates = calls.updates.filter(u => u.table === 'ingredient_vendors');
    const ivInserts = calls.inserts.filter(i => i.table === 'ingredient_vendors');
    assert.strictEqual(ivUpdates.length, 0, `atteso 0 UPDATE ingredient_vendors, trovati ${ivUpdates.length}`);
    assert.strictEqual(ivInserts.length, 0, `atteso 0 INSERT ingredient_vendors, trovati ${ivInserts.length}`);
  });

  await atest('T2: Order Confirmation — 0 INSERT su invoice_lines', async () => {
    loadRealVdrModule();
    const docId = 'oc-doc-2';
    const doc = makeDoc('order_confirmation', docId);
    const { sb, calls } = makeGenericSb(baseTables(doc));
    global.window.supabaseClient = sb;
    global.window._vdrEdits = {};
    const btn = { disabled: false, textContent: '', style: {} };
    await global.window.vdrApprove(docId, btn);

    const ilInserts = calls.inserts.filter(i => i.table === 'invoice_lines');
    assert.strictEqual(ilInserts.length, 0, `atteso 0 INSERT invoice_lines, trovati ${ilInserts.length}`);
  });

  await atest("T3: Order Confirmation — vendor_documents.status -> 'imported' (approval documentale funzionante)", async () => {
    loadRealVdrModule();
    const docId = 'oc-doc-3';
    const doc = makeDoc('order_confirmation', docId);
    const { sb, calls } = makeGenericSb(baseTables(doc));
    global.window.supabaseClient = sb;
    global.window._vdrEdits = {};
    const btn = { disabled: false, textContent: '', style: {} };
    await global.window.vdrApprove(docId, btn);

    const vdUpdate = calls.updates.find(u => u.table === 'vendor_documents' && u.data.status === 'imported');
    assert.ok(vdUpdate, 'atteso un UPDATE vendor_documents con status=imported');
  });

  // ── T4/T5 — Invoice: comportamento invariato ─────────────────────
  await atest('T4: Invoice — i price writes su ingredient_vendors continuano a funzionare (>0 UPDATE o INSERT)', async () => {
    loadRealVdrModule();
    const docId = 'inv-doc-1';
    const doc = makeDoc('invoice', docId);
    const { sb, calls } = makeGenericSb(baseTables(doc));
    global.window.supabaseClient = sb;
    global.window._vdrEdits = {};
    const btn = { disabled: false, textContent: '', style: {} };
    await global.window.vdrApprove(docId, btn);

    const ivUpdates = calls.updates.filter(u => u.table === 'ingredient_vendors');
    const ivInserts = calls.inserts.filter(i => i.table === 'ingredient_vendors');
    assert.ok(ivUpdates.length + ivInserts.length > 0, 'atteso almeno una scrittura su ingredient_vendors per una vera Invoice (matched by SKU -> UPDATE)');
    assert.strictEqual(ivUpdates.length, 1, 'atteso esattamente 1 UPDATE (item matchato per SKU su riga esistente)');
  });

  await atest('T5: Invoice — invoice_lines viene ancora creata', async () => {
    loadRealVdrModule();
    const docId = 'inv-doc-2';
    const doc = makeDoc('invoice', docId);
    const { sb, calls } = makeGenericSb(baseTables(doc));
    global.window.supabaseClient = sb;
    global.window._vdrEdits = {};
    const btn = { disabled: false, textContent: '', style: {} };
    await global.window.vdrApprove(docId, btn);

    const ilInsert = calls.inserts.find(i => i.table === 'invoice_lines');
    assert.ok(ilInsert, 'atteso un INSERT invoice_lines per una vera Invoice');
    assert.strictEqual(ilInsert.row.length, 1, 'atteso 1 riga invoice_lines per 1 item');
  });

  // NOTA: T6 (nessuna mutazione dati production) è verificato
  // procedurally fuori da questo file — questa intera suite gira contro
  // un mock Supabase in-memory (makeGenericSb), zero chiamate di rete,
  // zero riferimenti al project_id o al documento production reali.

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
