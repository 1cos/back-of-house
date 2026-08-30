// ══════════════════════════════════════════════════════════════════
// Manual SKU Match from Vendor Document — test run
// Plain Node: `node tests/vendor-review-manual-sku-match.test.js`
// Runs the REAL live code (vendor-documents-review.js + ingredients.js)
// against a mock Supabase client and a real jsdom DOM.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const VDR_JS = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');
const VPU_JS = path.join(__dirname, '..', 'js', 'vendor-parser-ui.js');
const ING_JS = path.join(__dirname, '..', 'js', 'ingredients.js');
const vdrSrc = fs.readFileSync(VDR_JS, 'utf8');
const vpuSrc = fs.readFileSync(VPU_JS, 'utf8');
const ingSrc = fs.readFileSync(ING_JS, 'utf8');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }
async function atest(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = global.window || {};

console.log('\nManual SKU Match from Vendor Document — test run\n');

function loadRealModules() {
  document.body.innerHTML = '';
  const fn = new Function('window', 'document', vpuSrc + '\n' + vdrSrc);
  fn(global.window, global.document);
}

// Real 26104552-equivalent items (8x 19400236, 7x 27935840, 3 matched
// products, 6 accounting rows) — same shape as the real production doc.
function make26104552Items() {
  function item(sku, desc, lineType, pack) {
    return { vendor_sku: sku, description: desc, raw_description: desc, line_type: lineType, pack_description: pack || null, unit_price: 1, qty: 1, amount: 1, warnings: [] };
  }
  return [
    item('44001602', 'Ground Beef', 'product', '10lb'),
    item('44391101', 'Watermelon', 'product', 'Each'),
    item('44390947', 'Zucchini', 'product', 'Each'),
    ...Array.from({ length: 8 }, () => item('19400236', 'Chicken A', 'product', '1.50-4.30lb Tray')),
    ...Array.from({ length: 7 }, () => item('27935840', 'Chicken B', 'product', '2.75-7.0lb Tray')),
    item('Express Fee', 'HANDLING', 'handling'),
    ...Array.from({ length: 4 }, () => item('SubDown', 'FULFILL_VARIANCE', 'fulfillment_variance')),
    item('ALT_PAYMENT_METHODS', 'Alternative Payment Methods', 'adjustment'),
  ];
}

function makeSb(tables) {
  const calls = { inserts: [], updates: [], selects: [] };
  function builder(tableName) {
    const state = { filters: [] };
    const b = {
      select(cols) { calls.selects.push({ table: tableName, cols }); return b; },
      eq(k, v) { state.filters.push(['eq', k, v]); return b; },
      in(k, values) { state.filters.push(['in', k, values]); return b; },
      is(k, v) { state.filters.push(['is', k, v]); return b; },
      limit() { return b; },
      single() { state.single = true; return b; },
      ilike(k, v) { state.filters.push(['ilike', k, v]); return b; },
      update(data) {
        calls.updates.push({ table: tableName, data });
        const ub = {
          eq(k, v) { state.filters.push(['eq', k, v]); return ub; },
          is(k, v) { state.filters.push(['is', k, v]); return ub; },
          select(cols) {
            let rows = (tables[tableName] || []).slice();
            for (const [type, k, v] of state.filters) {
              if (type === 'eq') rows = rows.filter(r => r[k] === v);
              if (type === 'is') rows = rows.filter(r => v === null ? (r[k] === null || r[k] === undefined) : r[k] === v);
            }
            rows.forEach(r => Object.assign(r, data));
            return { then(resolve) { resolve({ data: rows, error: null }); } };
          },
        };
        return ub;
      },
      insert(row) {
        calls.inserts.push({ table: tableName, row });
        const rows = Array.isArray(row) ? row : [row];
        rows.forEach(r => { if (r.id == null) r.id = 'gen-' + Math.random().toString(36).slice(2); });
        (tables[tableName] = tables[tableName] || []).push(...rows);
        return {
          select() { return { single() { return Promise.resolve({ data: rows[0], error: null }); } }; },
          then(resolve) { resolve({ error: null }); },
        };
      },
      then(resolve) {
        let rows = (tables[tableName] || []).slice();
        for (const [type, k, v] of state.filters) {
          if (type === 'eq') rows = rows.filter(r => r[k] === v);
          if (type === 'in') rows = rows.filter(r => Array.isArray(v) && v.includes(r[k]));
          if (type === 'ilike') { const needle = String(v).replace(/%/g, '').toLowerCase(); rows = rows.filter(r => String(r[k] || '').toLowerCase().includes(needle)); }
        }
        if (state.single) resolve({ data: rows[0] || null, error: rows[0] ? null : { message: 'not found' } });
        else resolve({ data: rows, error: null });
      },
    };
    return b;
  }
  return { sb: { from: builder }, calls };
}

(async () => {

// ══════════════════════════════════════════════════════════════════
// Part F/G — vdrSaveVendorSkuMapping: created / idempotent / conflict
// ══════════════════════════════════════════════════════════════════
await atest('F: new mapping -> creates vendor_item_aliases row, calls backfill, returns created', async () => {
  loadRealModules();
  const tables = { vendor_item_aliases: [], invoice_lines: [
    { id: 'l1', vendor: 'Walmart Business', vendor_sku: '19400236', ingredient_id: null, match_status: 'unmatched' },
    { id: 'l2', vendor: 'Walmart Business', vendor_sku: '19400236', ingredient_id: null, match_status: 'unmatched' },
  ] };
  const { sb, calls } = makeSb(tables);
  const result = await window.vdrSaveVendorSkuMapping(sb, 'Walmart Business', '19400236', 'ing-chicken', 'Chicken Breast Tray');
  assert.strictEqual(result.status, 'created');
  assert.strictEqual(result.backfilled, 2);
  assert.strictEqual(tables.vendor_item_aliases.length, 1);
  assert.strictEqual(tables.vendor_item_aliases[0].vendor_sku, '19400236');
  assert.strictEqual(tables.vendor_item_aliases[0].ingredient_id, 'ing-chicken');
  assert.ok(tables.invoice_lines.every(l => l.ingredient_id === 'ing-chicken' && l.match_status === 'matched'));
});

await atest('G1: same ingredient_id already mapped -> idempotent, no duplicate row, backfill still runs safely', async () => {
  loadRealModules();
  const tables = {
    vendor_item_aliases: [{ id: 'iv-1', vendor: 'Walmart Business', vendor_sku: '19400236', ingredient_id: 'ing-chicken' }],
    invoice_lines: [{ id: 'l1', vendor: 'Walmart Business', vendor_sku: '19400236', ingredient_id: null }],
  };
  const { sb } = makeSb(tables);
  const result = await window.vdrSaveVendorSkuMapping(sb, 'Walmart Business', '19400236', 'ing-chicken', 'Chicken Breast Tray');
  assert.strictEqual(result.status, 'idempotent');
  assert.strictEqual(tables.vendor_item_aliases.length, 1, 'no duplicate row');
  assert.strictEqual(tables.invoice_lines[0].ingredient_id, 'ing-chicken', 'backfill still applies to any still-unmatched rows');
});

await atest('G2: DIFFERENT ingredient_id already mapped -> conflict, nothing written, nothing overwritten', async () => {
  loadRealModules();
  const tables = {
    vendor_item_aliases: [{ id: 'iv-1', vendor: 'Walmart Business', vendor_sku: '19400236', ingredient_id: 'ing-OTHER' }],
    invoice_lines: [],
  };
  const { sb, calls } = makeSb(tables);
  const result = await window.vdrSaveVendorSkuMapping(sb, 'Walmart Business', '19400236', 'ing-chicken', 'Chicken Breast Tray');
  assert.strictEqual(result.status, 'conflict');
  assert.strictEqual(result.existing_ingredient_id, 'ing-OTHER');
  assert.strictEqual(tables.vendor_item_aliases.length, 1, 'no new row');
  assert.strictEqual(tables.vendor_item_aliases[0].ingredient_id, 'ing-OTHER', 'existing mapping never overwritten');
  assert.strictEqual(calls.inserts.filter(i => i.table === 'vendor_item_aliases').length, 0);
});

// ══════════════════════════════════════════════════════════════════
// Part K — real Walmart-equivalent fixture, per-SKU match
// ══════════════════════════════════════════════════════════════════
await atest('K: 26104552-equivalent fixture — matching 19400236 backfills exactly its 8 rows, 27935840 untouched, vendor_item_aliases gets exactly 1 new row', async () => {
  loadRealModules();
  const items = make26104552Items();
  const invoiceLines = items.filter(i => i.line_type === 'product').map((it, i) => ({
    id: 'il-' + i, vendor: 'Walmart Business', vendor_sku: it.vendor_sku, ingredient_id:
      ['44001602', '44391101', '44390947'].includes(it.vendor_sku) ? 'ing-' + it.vendor_sku : null,
    match_status: ['44001602', '44391101', '44390947'].includes(it.vendor_sku) ? 'matched' : 'unmatched',
  }));
  const tables = {
    vendor_item_aliases: [
      { id: 'iv-1', vendor: 'Walmart Business', vendor_sku: '44001602', ingredient_id: 'ing-44001602' },
      { id: 'iv-2', vendor: 'Walmart Business', vendor_sku: '44391101', ingredient_id: 'ing-44391101' },
      { id: 'iv-3', vendor: 'Walmart Business', vendor_sku: '44390947', ingredient_id: 'ing-44390947' },
    ],
    invoice_lines: invoiceLines,
  };
  const { sb } = makeSb(tables);
  const result = await window.vdrSaveVendorSkuMapping(sb, 'Walmart Business', '19400236', 'ing-chicken-19400236', 'Chicken Breast Tray');

  assert.strictEqual(result.status, 'created');
  assert.strictEqual(result.backfilled, 8, 'exactly the 8 real 19400236 rows');
  assert.strictEqual(tables.vendor_item_aliases.length, 4, '3 pre-existing + exactly 1 new — never 8');

  const chickenA = tables.invoice_lines.filter(l => l.vendor_sku === '19400236');
  const chickenB = tables.invoice_lines.filter(l => l.vendor_sku === '27935840');
  assert.strictEqual(chickenA.length, 8);
  assert.ok(chickenA.every(l => l.ingredient_id === 'ing-chicken-19400236' && l.match_status === 'matched'));
  assert.ok(chickenB.every(l => l.ingredient_id === null), '27935840 must remain untouched until its own separate match');
});

// ══════════════════════════════════════════════════════════════════
// Part C/D — the button itself: real per-SKU, no row-index identity
// ══════════════════════════════════════════════════════════════════
test('C/D: the Match button only renders for product rows with a real vendor_sku; passes docId/vendor/vendorSku/description, never a row index', () => {
  const idx = vdrSrc.indexOf('var canMatchThisRow');
  const block = vdrSrc.slice(idx, idx + 500);
  assert.ok(block.includes('rowNeedsMatch && !!item.vendor_sku'), 'button must require a real vendor_sku, not just any unmatched row');
  assert.ok(block.includes("vdrOpenMatchSelector('") && block.includes('docId') && block.includes('docVendor') && block.includes('item.vendor_sku'));
  assert.ok(!/vdrOpenMatchSelector\([^)]*idx/.test(block), 'must never pass the row index as the match identity');
});
test('C: accounting rows never get a Match button (canMatchThisRow requires !isAccountingRow via rowNeedsMatch)', () => {
  assert.ok(vdrSrc.includes('var rowNeedsMatch = !isAccountingRow && docMatchStatus'));
});

// ══════════════════════════════════════════════════════════════════
// Part I — pre-approval UX: matching re-renders the SAME open detail,
// no manual refresh, via a real vdrToggle() safe re-render
// ══════════════════════════════════════════════════════════════════
await atest('I: pre-approval — after a successful match via the real end-to-end flow (prepopulated candidate, one tap), window._vdrMatchStatus is updated and vdrToggle() is called to safely redraw — no manual refresh', async () => {
  loadRealModules();
  const items = make26104552Items();
  const doc = {
    id: 'doc-pending', status: 'pending', vendor: 'Walmart Business', document_number: '26104552', document_type: 'invoice',
    parsed_json: { vendor: 'Walmart Business', document_type: 'invoice', items },
  };
  window._vdrAllDocs = [doc];
  window._vdrMatchStatus = {};

  const tables = {
    ingredient_vendors: [
      { id: 'iv-1', vendor: 'Walmart Business', vendor_sku: '44001602', ingredient_id: 'ing-44001602' },
      { id: 'iv-2', vendor: 'Walmart Business', vendor_sku: '44391101', ingredient_id: 'ing-44391101' },
      { id: 'iv-3', vendor: 'Walmart Business', vendor_sku: '44390947', ingredient_id: 'ing-44390947' },
    ],
    invoice_lines: Array.from({ length: 8 }, (_, i) => ({ id: 'il-' + i, vendor: 'Walmart Business', vendor_sku: '19400236', ingredient_id: null, match_status: 'unmatched' })),
    ingredients: [{ id: 'ing-chicken', name: 'Chicken Breast', category: 'Protein', active: true }],
  };
  const { sb } = makeSb(tables);
  window.supabaseClient = sb;

  let toggleCalledWith = null;
  window.vdrToggle = function(id) { toggleCalledWith = id; };

  // Open the real selector, exactly as the button's onclick would. Now
  // awaits an ingredients fetch before creating itself (avoids an
  // empty-state flash — Restore Original Match UX task, Part F).
  await window.vdrOpenMatchSelector('doc-pending', 'Walmart Business', '19400236', 'Chicken A', null);
  assert.ok(document.getElementById('_vdrMatchSelector'), 'selector modal must be inserted into the DOM once ready');
  assert.ok(document.getElementById('_vdrMatchSelector').innerHTML.includes('Chicken Breast'), 'the real invoice description "Chicken A" must already surface Chicken Breast as a prepopulated candidate — no typing required');

  // One tap on the (only, primary) candidate saves immediately — no
  // separate search-then-confirm step.
  assert.strictEqual(typeof window.vdrMatchSelectorPickCandidate, 'function');
  await window.vdrMatchSelectorPickCandidate(0);

  assert.strictEqual(toggleCalledWith, 'doc-pending', 'vdrToggle must be called with the same docId to safely redraw — no manual refresh');
  assert.ok(window._vdrMatchStatus['doc-pending'], 'match status must have been recomputed for this document');
  assert.ok(window._vdrMatchStatus['doc-pending'].unmatchedSkuSet.has('27935840'), '27935840 must still be unmatched');
  assert.ok(!window._vdrMatchStatus['doc-pending'].unmatchedSkuSet.has('19400236'), '19400236 must no longer be in the unmatched set after the real match flow completed');
  assert.strictEqual(tables.invoice_lines.filter(l => l.vendor_sku === '19400236' && l.ingredient_id === 'ing-chicken').length, 8, 'all 8 real rows backfilled');
});

// ══════════════════════════════════════════════════════════════════
// Part J — post-approval UX: backfill works on already-imported docs too
// ══════════════════════════════════════════════════════════════════
await atest('J: post-approval — an already-"imported" document with unmatched invoice_lines still gets backfilled correctly by the same helper', async () => {
  loadRealModules();
  const tables = {
    ingredient_vendors: [],
    invoice_lines: Array.from({ length: 5 }, (_, i) => ({ id: 'il-' + i, vendor: 'Walmart Business', vendor_sku: 'X-SKU', ingredient_id: null, match_status: 'unmatched' })),
  };
  const { sb } = makeSb(tables);
  const result = await window.vdrSaveVendorSkuMapping(sb, 'Walmart Business', 'X-SKU', 'ing-x');
  assert.strictEqual(result.status, 'created');
  assert.strictEqual(result.backfilled, 5);
  assert.ok(tables.invoice_lines.every(l => l.ingredient_id === 'ing-x' && l.match_status === 'matched'), 'backfill must work regardless of the parent vendor_document.status');
});

// ══════════════════════════════════════════════════════════════════
// Part L — regression: Ingredient Card's saveNewVendorRow still works
// ══════════════════════════════════════════════════════════════════
await atest('L: saveNewVendorRow (Ingredient Card) — price intelligence writes ingredient_vendors (no vendor_sku, matching the 4 legacy sites), identity writes vendor_item_aliases separately', async () => {
  loadRealModules();
  const tables = { ingredient_vendors: [], vendor_item_aliases: [], invoice_lines: [] };
  const { sb } = makeSb(tables);
  // FIX (Durable Walmart SKU Mapping task, Part H): saveNewVendorRow now
  // upserts ingredient_vendors directly (onConflict:'ingredient_id,vendor'),
  // matching the other 4 legacy price-intelligence call sites — the mock
  // needs a real upsert() implementation (update-if-exists, else insert).
  const origFrom = sb.from;
  sb.from = function(tableName) {
    const b = origFrom(tableName);
    b.upsert = function(row, opts) {
      const conflictCols = (opts && opts.onConflict || '').split(',');
      const existing = (tables[tableName] || []).find(r => conflictCols.every(c => r[c] === row[c]));
      if (existing) {
        Object.assign(existing, row);
        return { then(resolve) { resolve({ error: null }); } };
      }
      const newRow = Object.assign({ id: 'gen-' + Math.random().toString(36).slice(2) }, row);
      (tables[tableName] = tables[tableName] || []).push(newRow);
      return { then(resolve) { resolve({ error: null }); } };
    };
    return b;
  };
  global.supa = sb; // ingredients.js references the bare identifier `supa`, defined globally in js/utils.js in the real app
  global.openIngredientCard = function() {}; // no-op for this test, same bare-identifier reasoning
  new Function('window', 'document', ingSrc)(global.window, global.document);

  document.body.innerHTML = `
    <input id="avUnitPrice" value="39.94" /><input id="avConversion" value="4535.92" />
    <select id="avPriceType"><option value="per_case" selected>per_case</option></select>
    <input id="avPricePerEach" value="" /><input id="avVendor" value="Walmart Business" />
    <input id="avSku" value="44001602" /><input id="avPackDesc" value="10lb" />
    <div class="fixed inset-0"><button id="saveBtn"></button></div>
  `;
  const btn = document.getElementById('saveBtn');
  await window.saveNewVendorRow('ing-ground-beef', btn);

  // Price intelligence: ingredient_vendors, keyed on ingredient_id+vendor,
  // no vendor_sku written (matches the other 4 legacy sites' contract).
  assert.strictEqual(tables.ingredient_vendors.length, 1);
  const priceRow = tables.ingredient_vendors[0];
  assert.strictEqual(priceRow.vendor, 'Walmart Business');
  assert.strictEqual(priceRow.ingredient_id, 'ing-ground-beef');
  assert.strictEqual(priceRow.unit_price, 39.94);
  assert.strictEqual(priceRow.pack_description, '10lb');
  assert.strictEqual(priceRow.active, true);

  // Identity: vendor_item_aliases, the durable SKU mapping source.
  assert.strictEqual(tables.vendor_item_aliases.length, 1);
  const identityRow = tables.vendor_item_aliases[0];
  assert.strictEqual(identityRow.vendor, 'Walmart Business');
  assert.strictEqual(identityRow.vendor_sku, '44001602');
  assert.strictEqual(identityRow.ingredient_id, 'ing-ground-beef');

  delete global.supa;
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
})();
