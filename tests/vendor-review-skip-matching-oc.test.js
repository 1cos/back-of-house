// ══════════════════════════════════════════════════════════════════
// Vendor Review — order_confirmation must skip ingredient matching
// entirely (BOH OS Task 11W)
// Plain Node: `node tests/vendor-review-skip-matching-oc.test.js`
//
// Esegue la VERA window.vdrApprove() (eval del file intero, invariato)
// contro un mock Supabase generico + jsdom `document` reale — il segnale
// "modal aperta" è la presenza reale nel DOM di #_vdrMatchModal (id usato
// da vdrShowMatchModal), non un flag finto.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const VDR_JS = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }
async function atest(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = global.window || {};

function makeGenericSb(tables) {
  const calls = { updates: [], inserts: [], selects: [] };
  function builder(tableName) {
    const state = { filters: [], single: false };
    const b = {
      select(cols) { calls.selects.push({ table: tableName, cols }); return b; },
      eq(k, v) { state.filters.push(['eq', k, v]); return b; },
      in(k, values) { state.filters.push(['in', k, values]); return b; },
      order() { return b; },
      limit() { return b; },
      single() { state.single = true; return b; },
      update(data) {
        const rec = { table: tableName, data, filters: [] };
        calls.updates.push(rec);
        const ub = { eq(k, v) { rec.filters.push(['eq', k, v]); return ub; }, then(resolve) { resolve({ error: null }); } };
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
  const fn = new Function('window', 'document', src);
  fn(global.window, global.document);
}

console.log('\nVendor Review — order_confirmation skips ingredient matching (Task 11W) — test run\n');

test("verifica riga reale: il blocco 2 di vdrPreflight (unmatched count) è racchiuso in if (pj.document_type === 'invoice')", () => {
  // FIX (deferred matching task): vdrPreflight no longer returns
  // {ok:false, reason:'match_needed'} for unmatched product lines — an
  // unmatched item no longer blocks approval at all (Chef Max can defer
  // matching). The unmatchedCount computation itself still lives inside
  // the SAME invoice-only gate this test originally verified — updated
  // to check for that computation instead of the now-removed literal.
  const src = fs.readFileSync(VDR_JS, 'utf8');
  const fnStart = src.indexOf('async function vdrPreflight(docId, doc) {');
  assert.ok(fnStart > -1, 'vdrPreflight non trovata');
  const fnBody = src.slice(fnStart, src.indexOf('\n// ── APPROVE BUTTON', fnStart));
  const gateIdx = fnBody.indexOf("if (pj.document_type === 'invoice') {");
  assert.ok(gateIdx > -1, 'gate non trovato dentro vdrPreflight');
  const unmatchedIdx = fnBody.indexOf('unmatchedCount = unmatched.length;');
  assert.ok(unmatchedIdx > gateIdx, "il calcolo di unmatchedCount deve stare DENTRO il gate 'invoice'");
  assert.ok(!fnBody.includes("reason: 'match_needed'"), 'il blocco match_needed non deve più esistere — deferred matching lo ha rimosso');
});

// Item volutamente NON matchabile (SKU/desc assenti dalla tabella ingredient_vendors/links)
// e con un nome che nella modale reale genererebbe un suggerimento fuorviante
// ("Pastry Bag" -> "Puff Pastry") — replica esatta del bug osservato.
const UNMATCHED_ITEM = { vendor_sku: '116533', description: 'Pastry Bag 21in Clr Disposable', raw_description: 'Pastry Bag 21in Clr Disposable', pack_description: '1/ 100 CT', unit_price: 40.98, qty_ordered: 2, qty_received: 2, amount: 81.96, warnings: [] };

function makeDoc(docType, docId) {
  return {
    id: docId, document_number: '0002952908', vendor: 'Ben E. Keith', status: 'pending', warnings: null,
    parsed_json: { vendor: 'Ben E. Keith', document_type: docType, document_number: '0002952908', document_date: '2026-08-20', delivery_date: '2026-08-20', total: 81.96, items: [UNMATCHED_ITEM], warnings: [] },
  };
}

function tablesNoMatch(doc) {
  return {
    vendor_documents: [doc],
    ingredient_vendors: [], // nessun match SKU esistente
    ingredient_links: [],   // nessun link confermato
    ingredients: [{ id: 'ing-puff', name: 'Puff Pastry', category: 'Bakery', active: true }], // suggerimento fuorviante reale
    invoice_lines: [],
  };
}

(async () => {

  await atest('T1: Order Confirmation, item non matchato — Match Ingredients modal MAI renderizzata nel DOM (0 aperture)', async () => {
    document.body.innerHTML = '';
    loadRealVdrModule();
    const docId = 'oc-w-1';
    const doc = makeDoc('order_confirmation', docId);
    const { sb } = makeGenericSb(tablesNoMatch(doc));
    global.window.supabaseClient = sb;
    global.window._vdrEdits = {};
    const btn = { disabled: false, textContent: '', style: {} };
    await global.window.vdrApprove(docId, btn);

    const modal = document.getElementById('_vdrMatchModal');
    assert.strictEqual(modal, null, 'la modale Match Ingredients non deve MAI apparire per un order_confirmation');
  });

  await atest('T2: Order Confirmation, item non matchato — approval NON richiede matching per procedere (raggiunge il completamento)', async () => {
    document.body.innerHTML = '';
    loadRealVdrModule();
    const docId = 'oc-w-2';
    const doc = makeDoc('order_confirmation', docId);
    const { sb, calls } = makeGenericSb(tablesNoMatch(doc));
    global.window.supabaseClient = sb;
    global.window._vdrEdits = {};
    const btn = { disabled: false, textContent: '', style: {} };
    await global.window.vdrApprove(docId, btn);

    const vdUpdate = calls.updates.find(u => u.table === 'vendor_documents' && u.data.status === 'imported');
    assert.ok(vdUpdate, 'con item non matchato, un order_confirmation deve comunque raggiungere status=imported (nessun blocco per matching)');
    const yesChef = document.getElementById('_yesChefOverlay');
    assert.ok(yesChef, 'la modale celebrativa Yes-Chef deve apparire (percorso di successo raggiunto, non quello di match)');
  });

  await atest('T3: Order Confirmation approval — 0 ingredient_vendors writes, 0 invoice_lines, status=imported', async () => {
    document.body.innerHTML = '';
    loadRealVdrModule();
    const docId = 'oc-w-3';
    const doc = makeDoc('order_confirmation', docId);
    const { sb, calls } = makeGenericSb(tablesNoMatch(doc));
    global.window.supabaseClient = sb;
    global.window._vdrEdits = {};
    const btn = { disabled: false, textContent: '', style: {} };
    await global.window.vdrApprove(docId, btn);

    const ivWrites = calls.updates.filter(u => u.table === 'ingredient_vendors').length + calls.inserts.filter(i => i.table === 'ingredient_vendors').length;
    const ilWrites = calls.inserts.filter(i => i.table === 'invoice_lines').length;
    const statusImported = calls.updates.some(u => u.table === 'vendor_documents' && u.data.status === 'imported');
    assert.strictEqual(ivWrites, 0);
    assert.strictEqual(ilWrites, 0);
    assert.ok(statusImported);
  });

  await atest("T4 (updated for deferred matching): Invoice, item non matchato — la modale Match Ingredients NON si apre più, l'invoice viene comunque approvata con ingredient_id=null", async () => {
    document.body.innerHTML = '';
    loadRealVdrModule();
    const docId = 'inv-w-4';
    const doc = makeDoc('invoice', docId);
    const { sb, calls } = makeGenericSb(tablesNoMatch(doc));
    global.window.supabaseClient = sb;
    global.window._vdrEdits = {};
    const btn = { disabled: false, textContent: '', style: {} };
    await global.window.vdrApprove(docId, btn);

    const modal = document.getElementById('_vdrMatchModal');
    assert.ok(!modal, 'con deferred matching, un item non matchato non deve più aprire la modale');
    const statusImported = calls.updates.some(u => u.table === 'vendor_documents' && u.data.status === 'imported');
    assert.ok(statusImported, "l'invoice deve comunque completare l'approve");
    const ilInsert = calls.inserts.find(i => i.table === 'invoice_lines');
    assert.ok(ilInsert, 'invoice_lines deve comunque essere scritta');
    const line = ilInsert.row.find(r => r.vendor_sku === '116533');
    assert.ok(line);
    assert.strictEqual(line.ingredient_id, null, "l'item non matchato deve avere ingredient_id=null, non bloccare tutto");
    assert.strictEqual(line.match_status, 'unmatched');
    const ivWrites = calls.updates.filter(u => u.table === 'ingredient_vendors').length + calls.inserts.filter(i => i.table === 'ingredient_vendors').length;
    assert.strictEqual(ivWrites, 0, 'nessun ingredient_vendors creato automaticamente per un item unmatched');
  });

  await atest('T5: Invoice, item matchato per SKU — approval invariato (ingredient_vendors + invoice_lines scritti)', async () => {
    document.body.innerHTML = '';
    loadRealVdrModule();
    const docId = 'inv-w-5';
    const doc = makeDoc('invoice', docId);
    const tables = tablesNoMatch(doc);
    tables.ingredient_vendors = [{ id: 'iv-1', ingredient_id: 'ing-1', vendor_sku: '116533', vendor: 'Ben E. Keith' }];
    const { sb, calls } = makeGenericSb(tables);
    global.window.supabaseClient = sb;
    global.window._vdrEdits = {};
    const btn = { disabled: false, textContent: '', style: {} };
    await global.window.vdrApprove(docId, btn);

    assert.strictEqual(document.getElementById('_vdrMatchModal'), null, 'item matchato per SKU: nessuna modale necessaria');
    assert.strictEqual(calls.updates.filter(u => u.table === 'ingredient_vendors').length, 1);
    assert.ok(calls.inserts.find(i => i.table === 'invoice_lines'));
  });

  // ── T6 — Regressione Task 11V (zero price writes per order_confirmation) ──
  await atest('T6: Regressione Task 11V — order_confirmation resta a zero price writes anche con item matchato', async () => {
    document.body.innerHTML = '';
    loadRealVdrModule();
    const docId = 'oc-w-6';
    const doc = makeDoc('order_confirmation', docId);
    const tables = tablesNoMatch(doc);
    tables.ingredient_vendors = [{ id: 'iv-1', ingredient_id: 'ing-1', vendor_sku: '116533', vendor: 'Ben E. Keith' }];
    const { sb, calls } = makeGenericSb(tables);
    global.window.supabaseClient = sb;
    global.window._vdrEdits = {};
    const btn = { disabled: false, textContent: '', style: {} };
    await global.window.vdrApprove(docId, btn);

    assert.strictEqual(calls.updates.filter(u => u.table === 'ingredient_vendors').length, 0);
    assert.strictEqual(calls.inserts.filter(i => i.table === 'ingredient_vendors').length, 0);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
