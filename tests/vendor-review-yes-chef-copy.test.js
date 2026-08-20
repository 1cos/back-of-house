// ══════════════════════════════════════════════════════════════════
// Vendor Review — Yes-Chef modal copy: "Documento confermato" /
// "Articoli nell'ordine" for order_confirmation, unchanged for invoice
// (BOH OS Task 11Y)
// Plain Node: `node tests/vendor-review-yes-chef-copy.test.js`
//
// Esegue la VERA window.vdrApprove() (eval del file intero) e legge il
// vero DOM (#_yesChefOverlay) prodotto — non un mock del rendering.
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

console.log('\nVendor Review — Yes-Chef modal copy per document_type (Task 11Y) — test run\n');

const MATCHED_ITEM = { vendor_sku: '116533', description: 'Pastry Bag 21in Clr Disposable', raw_description: 'Pastry Bag 21in Clr Disposable', pack_description: '1/ 100 CT', unit_price: 40.98, qty_ordered: 2, qty_received: 2, amount: 81.96, warnings: [] };

function makeDoc(docType, docId) {
  return {
    id: docId, document_number: '0002952908', vendor: 'Ben E. Keith', status: 'pending', warnings: null,
    parsed_json: { vendor: 'Ben E. Keith', document_type: docType, document_number: '0002952908', document_date: '2026-08-20', delivery_date: '2026-08-20', total: 81.96, items: [MATCHED_ITEM], warnings: [] },
  };
}

function tables(doc) {
  return {
    vendor_documents: [doc],
    ingredient_vendors: [{ id: 'iv-1', ingredient_id: 'ing-1', vendor_sku: '116533', vendor: 'Ben E. Keith' }],
    ingredient_links: [],
    ingredients: [],
    invoice_lines: [],
  };
}

async function runApprove(docType, docId) {
  document.body.innerHTML = '';
  loadRealVdrModule();
  const doc = makeDoc(docType, docId);
  const { sb, calls } = makeGenericSb(tables(doc));
  global.window.supabaseClient = sb;
  global.window._vdrEdits = {};
  const btn = { disabled: false, textContent: '', style: {} };
  await global.window.vdrApprove(docId, btn);
  const overlay = document.getElementById('_yesChefOverlay');
  return { html: overlay ? overlay.innerHTML : '', calls };
}

(async () => {

  // ── T1 — Order Confirmation: nuova copy, nessuna "importati" ────────
  await atest('T1: Order Confirmation — modal contiene "Documento confermato" + "Articoli nell\'ordine", NON contiene "importati"', async () => {
    const { html } = await runApprove('order_confirmation', 'oc-y-1');
    assert.ok(html.length > 0, 'la modal Yes-Chef deve apparire');
    const lower = html.toLowerCase();
    assert.ok(lower.includes('documento confermato'), 'atteso "Documento confermato" nella modal');
    assert.ok(lower.includes("articoli nell'ordine"), "atteso \"Articoli nell'ordine\" nella modal");
    assert.ok(!lower.includes('importat'), 'NON deve comparire "importati"/"importato" per un order_confirmation');
  });

  // ── T2 — Invoice: copy invariata ─────────────────────────────────────
  await atest('T2: Invoice — modal continua a mostrare "Articoli importati" (nessuna regressione di copy)', async () => {
    const { html } = await runApprove('invoice', 'inv-y-2');
    const lower = html.toLowerCase();
    assert.ok(lower.includes('articoli importati'), 'atteso "Articoli importati" invariato per una vera Invoice');
    assert.ok(!lower.includes('documento confermato'), 'la nuova copy non deve comparire per una Invoice');
  });

  // ── T3 — Nessuna write DB differente rispetto a prima (Task 11V/11W) ──
  await atest('T3: Order Confirmation — comportamento DB identico a prima (0 ingredient_vendors, 0 invoice_lines, status=imported)', async () => {
    const { calls } = await runApprove('order_confirmation', 'oc-y-3');
    const ivWrites = calls.updates.filter(u => u.table === 'ingredient_vendors').length + calls.inserts.filter(i => i.table === 'ingredient_vendors').length;
    const ilWrites = calls.inserts.filter(i => i.table === 'invoice_lines').length;
    const statusImported = calls.updates.some(u => u.table === 'vendor_documents' && u.data.status === 'imported');
    assert.strictEqual(ivWrites, 0);
    assert.strictEqual(ilWrites, 0);
    assert.ok(statusImported);
  });

  await atest('T3b: Invoice — comportamento DB identico a prima (price write + invoice_lines invariati)', async () => {
    const { calls } = await runApprove('invoice', 'inv-y-3b');
    assert.strictEqual(calls.updates.filter(u => u.table === 'ingredient_vendors').length, 1);
    assert.ok(calls.inserts.find(i => i.table === 'invoice_lines'));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
