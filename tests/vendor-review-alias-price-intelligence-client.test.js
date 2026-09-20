// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 40 — client/background parity check.
// Runs the REAL window.vdrApprove() (evaluated unmodified from
// js/vendor-documents-review.js, same convention as
// tests/vendor-review-price-gate.test.js) against a generic thenable
// Supabase mock, to prove the client path produces the SAME outcomes
// as the background edge-function path covered in
// tests/vendor-review-alias-price-intelligence.test.js.
// Plain Node: `node tests/vendor-review-alias-price-intelligence-client.test.js`
// ══════════════════════════════════════════════════════════════════
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// MICRO-TASK 42: i blocchi estratti da vendor-documents-review.js delegano
// la regola "questo documento genera un acquisto?" al modulo canonico.
// Iniettata QUI IN TESTA: alcuni test girano a livello top-level e devono
// trovarla gia definita. E la REGOLA VERA, non uno stub.
global.vdrIsPurchasableDocument = require('../js/vendor-parsers/ben-e-keith-order-confirmation').isPurchasableDocument;


const VDR_JS = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }
async function atest(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = global.window || {};
// MICRO-TASK 88A: vdrApprove decide cosa scrivere in ingredient_vendors
// tramite il modulo condiviso col worker, che nel browser arriva da un
// <script> in index.html. Qui lo iniettiamo come fa gia'
// vdrIsPurchasableDocument sopra: la REGOLA VERA, non uno stub.
global.window.PriceIntelligenceMerge = require('../js/vendor-parsers/price-intelligence-merge');


// ── Generic thenable Supabase mock — same shape as vendor-review-price-gate.test.js ──
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
          eq(k, v) {
            rec.filters.push(['eq', k, v]);
            let rows = (tables[tableName] || []);
            rows.filter(r => r[k] === v).forEach(r => Object.assign(r, data));
            return ub;
          },
          is(k, v) {
            rec.filters.push(['is', k, v]);
            return ub;
          },
          select() { return ub; },
          then(resolve) { resolve({ data: [], error: null }); },
        };
        return ub;
      },
      insert(row) {
        calls.inserts.push({ table: tableName, row });
        tables[tableName] = tables[tableName] || [];
        tables[tableName].push(Object.assign({ id: 'new-' + tables[tableName].length }, row));
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

function makeDoc(docId, vendor, documentDate, items, total) {
  return {
    id: docId, vendor, status: 'pending', warnings: null, document_date: documentDate,
    parsed_json: { vendor, document_type: 'invoice', document_date: documentDate, total, items },
  };
}

console.log('\nMICRO-TASK 40 — client (vdrApprove) parity tests\n');

(async () => {
  // ── Structural check: the alias-aware price-intel markers exist ──
  test('source contains the MICRO-TASK 40 alias-aware price-intel block, wired before the ingredient_links fallback', () => {
    const src = fs.readFileSync(VDR_JS, 'utf8');
    assert.ok(src.includes('MARKER:VDR_PRICE_INTEL_ALIAS_START'), 'helper block marker missing');
    assert.ok(src.includes('function resolvePriceIntelIdentity'), 'resolvePriceIntelIdentity missing');
    assert.ok(src.includes('function chronologyAllows'), 'chronologyAllows missing');
    const caseCIdx = src.indexOf("resolution.case === 'C'");
    const fallbackIdx = src.indexOf("resolution.case === 'none' — fall back to ingredient_links");
    assert.ok(caseCIdx > -1 && fallbackIdx > caseCIdx, 'CASE C must be checked before the ingredient_links fallback');
  });

  // ── Scenario 1: direct SKU, newer invoice → normal update ──
  await atest('1. Direct SKU, newer invoice → ingredient_vendors updates normally', async () => {
    loadRealVdrModule();
    const doc = makeDoc('c1', 'V', '2026-09-10', [{ vendor_sku: 'S1', description: 'Item One', unit_price: 20, amount: 20, qty_ordered: 1 }], 20);
    const tables = {
      vendor_documents: [doc],
      ingredient_vendors: [{ id: 'iv-1', vendor: 'V', vendor_sku: 'S1', ingredient_id: 'ing-1', last_invoice_date: '2026-09-01' }],
      vendor_item_aliases: [], ingredient_links: [], invoice_lines: [],
    };
    const { sb, calls } = makeGenericSb(tables);
    global.window.supabaseClient = sb;
    global.window._vdrEdits = {};
    const btn = { disabled: false, textContent: '', style: {} };
    await global.window.vdrApprove('c1', btn);
    const ivUpdate = calls.updates.find(u => u.table === 'ingredient_vendors');
    assert.ok(ivUpdate, 'expected an ingredient_vendors update');
    assert.strictEqual(ivUpdate.data.unit_price, 20);
    assert.strictEqual(ivUpdate.data.last_invoice_date, '2026-09-10');
  });

  // ── Scenario 2: direct SKU, older invoice → chronology guard, no regression ──
  await atest('2. Direct SKU, OLDER invoice → chronology guard blocks the price regression', async () => {
    loadRealVdrModule();
    const doc = makeDoc('c2', 'V', '2026-08-01', [{ vendor_sku: 'S2', description: 'Item Two', unit_price: 5, amount: 5, qty_ordered: 1 }], 5);
    const tables = {
      vendor_documents: [doc],
      ingredient_vendors: [{ id: 'iv-2', vendor: 'V', vendor_sku: 'S2', ingredient_id: 'ing-2', last_invoice_date: '2026-09-01', unit_price: 18 }],
      vendor_item_aliases: [], ingredient_links: [], invoice_lines: [],
    };
    const { sb, calls } = makeGenericSb(tables);
    global.window.supabaseClient = sb;
    global.window._vdrEdits = {};
    const btn = { disabled: false, textContent: '', style: {} };
    await global.window.vdrApprove('c2', btn);
    const ivUpdate = calls.updates.find(u => u.table === 'ingredient_vendors');
    assert.strictEqual(ivUpdate, undefined, 'no ingredient_vendors write at all — chronology guard skipped it');
    const iv = tables.ingredient_vendors[0];
    assert.strictEqual(iv.unit_price, 18, 'price must not regress');
  });

  // ── Scenario 4: old canonical GA0 + newer BRO alias invoice → migrated in place ──
  await atest('4. Old canonical row (GA0) + NEWER alias invoice (BRO) → same row migrated, no duplicate', async () => {
    loadRealVdrModule();
    const doc = makeDoc('c4', 'Fruge Seafood', '2026-09-16',
      [{ vendor_sku: 'SCAFDUU10BRO', description: 'SCALLOPS FR DRY U10 GAL', unit_price: 310, amount: 310, qty_ordered: 1, qty_received: 1, cost_per_lb: 38.75, price_type: 'per_lb', catchweight: false }], 310);
    const tables = {
      vendor_documents: [doc],
      ingredient_vendors: [{ id: 'iv-scallops', vendor: 'Fruge Seafood', vendor_sku: 'SCAFDUU10GA0', ingredient_id: 'ing-scallops', last_invoice_date: null, unit_price: 38.75 }],
      vendor_item_aliases: [{ vendor: 'Fruge Seafood', vendor_sku: 'SCAFDUU10BRO', active: true, ingredient_id: 'ing-scallops' }],
      ingredient_links: [], invoice_lines: [],
    };
    const { sb, calls } = makeGenericSb(tables);
    global.window.supabaseClient = sb;
    global.window._vdrEdits = {};
    const btn = { disabled: false, textContent: '', style: {} };
    await global.window.vdrApprove('c4', btn);
    assert.strictEqual(tables.ingredient_vendors.length, 1, 'no second row created');
    const iv = tables.ingredient_vendors[0];
    assert.strictEqual(iv.id, 'iv-scallops');
    assert.strictEqual(iv.vendor_sku, 'SCAFDUU10BRO', 'vendor_sku repointed to the new SKU');
    assert.strictEqual(iv.last_invoice_date, '2026-09-16');
    assert.strictEqual(calls.inserts.filter(i => i.table === 'ingredient_vendors').length, 0, 'must be an UPDATE, never an INSERT');
  });

  // ── Scenario 7: alias vs direct disagree → PRICE_IDENTITY_CONFLICT, zero writes ──
  await atest('7. Direct SKU + alias pointing to a DIFFERENT ingredient_id → PRICE_IDENTITY_CONFLICT, document blocked, zero price writes', async () => {
    loadRealVdrModule();
    const doc = makeDoc('c7', "Hardie's Fresh Foods / Dairyland Produce", '2026-09-10',
      [{ vendor_sku: '03252', description: 'SEED PUMPKIN ROASTED/SALTED', unit_price: 39.33, amount: 39.33, qty_ordered: 1 }], 39.33);
    const tables = {
      vendor_documents: [doc],
      ingredient_vendors: [{ id: 'iv-03252', vendor: "Hardie's Fresh Foods / Dairyland Produce", vendor_sku: '03252', ingredient_id: 'ing-pumpkin-seed', last_invoice_date: '2026-07-03', unit_price: 39.33 }],
      vendor_item_aliases: [{ vendor: "Hardie's Fresh Foods / Dairyland Produce", vendor_sku: '03252', active: true, ingredient_id: 'ing-seeds-generic' }],
      ingredient_links: [], invoice_lines: [],
    };
    const before = JSON.stringify(tables.ingredient_vendors);
    const { sb, calls } = makeGenericSb(tables);
    global.window.supabaseClient = sb;
    global.window._vdrEdits = {};
    const btn = { disabled: false, textContent: '', style: {} };
    // vdrApprove has its own top-level try/catch that turns the thrown
    // PRICE_IDENTITY_CONFLICT into a UI status message rather than
    // re-throwing to the caller — so the meaningful, checkable guarantee
    // here is the DB write side, not an exception reaching this test.
    await global.window.vdrApprove('c7', btn);
    assert.strictEqual(calls.updates.filter(u => u.table === 'ingredient_vendors').length, 0, 'zero ingredient_vendors updates');
    assert.strictEqual(calls.inserts.filter(u => u.table === 'ingredient_vendors').length, 0, 'zero ingredient_vendors inserts');
    assert.strictEqual(JSON.stringify(tables.ingredient_vendors), before, 'byte-identical — nothing written under either identity');
    assert.strictEqual(calls.inserts.filter(u => u.table === 'invoice_lines').length, 0, 'invoice_lines never reached either — approval aborted at preflight');
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail > 0 ? 1 : 0);
})();
