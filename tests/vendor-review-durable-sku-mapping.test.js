// ══════════════════════════════════════════════════════════════════
// Durable Walmart SKU Mapping — test run
// Plain Node: `node tests/vendor-review-durable-sku-mapping.test.js`
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const VDR_JS = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');
const VPU_JS = path.join(__dirname, '..', 'js', 'vendor-parser-ui.js');
const vdrSrc = fs.readFileSync(VDR_JS, 'utf8');
const vpuSrc = fs.readFileSync(VPU_JS, 'utf8');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }
async function atest(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }

const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="vdrVendorTabs"></div><div id="vdrList"></div></body></html>`);
global.document = dom.window.document;
global.window = global;
global.addSwipeToClose = function() {};
global.showScToast = function() {};

console.log('\nDurable Walmart SKU Mapping (vendor_item_aliases) — test run\n');

function loadRealModules() {
  document.body.innerHTML = '<div id="vdrVendorTabs"></div><div id="vdrList"></div>';
  const fn = new Function('window', 'document', vpuSrc + '\n' + vdrSrc + '\nwindow.vdrComputeMatchStatus = vdrComputeMatchStatus;');
  fn(window, document);
}

function makeSb(tables) {
  function builder(tableName) {
    const state = { filters: [] };
    const b = {
      select() { return b; }, eq(k, v) { state.filters.push(['eq', k, v]); return b; },
      in(k, values) { state.filters.push(['in', k, values]); return b; },
      is(k, v) { state.filters.push(['is', k, v]); return b; },
      order() { return b; }, limit() { return b; }, single() { state.single = true; return b; },
      update(data) {
        const ub = {
          eq(k, v) { state.filters.push(['eq', k, v]); return ub; },
          is(k, v) { state.filters.push(['is', k, v]); return ub; },
          select() {
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
        if (tableName === 'vendor_item_aliases') {
          const conflict1 = (tables.vendor_item_aliases || []).find(r => r.vendor === row.vendor && r.vendor_sku === row.vendor_sku);
          const conflict2 = (tables.vendor_item_aliases || []).find(r => r.vendor === row.vendor && r.vendor_description === row.vendor_description);
          if (conflict1 || conflict2) {
            const conname = conflict1 ? 'vendor_item_aliases_vendor_vendor_sku_key' : 'vendor_item_aliases_vendor_vendor_description_key';
            return { select() { return { single() { return Promise.resolve({ data: null, error: { message: `duplicate key value violates unique constraint "${conname}"` } }); } }; },
              then(resolve) { resolve({ error: { message: `duplicate key value violates unique constraint "${conname}"` } }); } };
          }
        }
        const rows = Array.isArray(row) ? row : [row];
        rows.forEach(r => { if (r.id == null) r.id = 'gen-' + Math.random().toString(36).slice(2); });
        (tables[tableName] = tables[tableName] || []).push(...rows);
        return { select() { return { single() { return Promise.resolve({ data: rows[0], error: null }); } }; }, then(resolve) { resolve({ error: null }); } };
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
  return { from: builder };
}

function item(sku, desc, lineType, pack) {
  return { vendor_sku: sku, description: desc, raw_description: desc, line_type: lineType, pack_description: pack || null, unit_price: 1, qty: 1, amount: 1, warnings: [] };
}
const DESC_A = 'Perdue Harvestland, Free Range, Fresh Boneless Chicken Breast, 1.50 4.30 lb. Tray';
const DESC_B = 'Freshness Guaranteed Boneless Skinless Chicken Breasts, 2.75-7.0 lb Tray';

function makeFixture() {
  const items = [
    ...Array.from({ length: 8 }, () => item('19400236', DESC_A, 'product', '1.50-4.30lb Tray')),
    ...Array.from({ length: 7 }, () => item('27935840', DESC_B, 'product', '2.75-7.0lb Tray')),
  ];
  const doc = {
    id: 'doc-26104552', status: 'imported', vendor: 'Walmart Business', document_number: '26104552', document_type: 'invoice',
    parsed_json: { vendor: 'Walmart Business', document_type: 'invoice', items }, warnings: null,
  };
  const tables = {
    vendor_item_aliases: [],
    ingredient_vendors: [],
    invoice_lines: [
      ...Array.from({ length: 8 }, (_, i) => ({ id: 'a' + i, vendor: 'Walmart Business', vendor_sku: '19400236', ingredient_id: null, match_status: 'unmatched' })),
      ...Array.from({ length: 7 }, (_, i) => ({ id: 'b' + i, vendor: 'Walmart Business', vendor_sku: '27935840', ingredient_id: null, match_status: 'unmatched' })),
    ],
    ingredients: [{ id: 'ing-chicken', name: 'Chicken Breast', category: 'Protein', active: true }],
  };
  return { doc, tables };
}

(async () => {

// ══════════════════════════════════════════════════════════════════
// PART J — multi-SKU durability
// ══════════════════════════════════════════════════════════════════
await atest('J: two different vendor SKUs sequentially map to the same ingredient -> 2 distinct vendor_item_aliases, NOT a second ingredient_vendors row', async () => {
  loadRealModules();
  const { doc, tables } = makeFixture();
  const sb = makeSb(tables);
  window.supabaseClient = sb;
  window._vdrAllDocs = []; window._vdrHistoryDocs = [doc]; window._vdrMatchStatus = {};

  await window.vdrOpenMatchSelector('doc-26104552', 'Walmart Business', '19400236', DESC_A, null);
  assert.ok(document.getElementById('_vdrMatchSelector').innerHTML.includes('Chicken Breast'));
  await window.vdrMatchSelectorPickCandidate(0);

  await window.vdrOpenMatchSelector('doc-26104552', 'Walmart Business', '27935840', DESC_B, null);
  assert.ok(document.getElementById('_vdrMatchSelector').innerHTML.includes('Chicken Breast'));
  await window.vdrMatchSelectorPickCandidate(0);

  assert.strictEqual(tables.vendor_item_aliases.length, 2, 'exactly 2 distinct vendor_item_aliases rows');
  const skus = tables.vendor_item_aliases.map(a => a.vendor_sku).sort();
  assert.deepStrictEqual(skus, ['19400236', '27935840']);
  assert.ok(tables.vendor_item_aliases.every(a => a.ingredient_id === 'ing-chicken'));
  assert.strictEqual(tables.ingredient_vendors.length, 0, 'no ingredient_vendors row created for identity — Part F');

  const a8 = tables.invoice_lines.filter(l => l.vendor_sku === '19400236');
  const b7 = tables.invoice_lines.filter(l => l.vendor_sku === '27935840');
  assert.ok(a8.every(l => l.ingredient_id === 'ing-chicken') && a8.length === 8);
  assert.ok(b7.every(l => l.ingredient_id === 'ing-chicken') && b7.length === 7);
});

await atest('J: a NEW future invoice with vendor_sku=27935840 is now automatically MATCHED — durability proven', async () => {
  loadRealModules();
  const { doc, tables } = makeFixture();
  const sb = makeSb(tables);
  window.supabaseClient = sb;
  window._vdrAllDocs = []; window._vdrHistoryDocs = [doc]; window._vdrMatchStatus = {};

  await window.vdrOpenMatchSelector('doc-26104552', 'Walmart Business', '19400236', DESC_A, null);
  await window.vdrMatchSelectorPickCandidate(0);
  await window.vdrOpenMatchSelector('doc-26104552', 'Walmart Business', '27935840', DESC_B, null);
  await window.vdrMatchSelectorPickCandidate(0);

  const futureDoc = {
    id: 'future-doc', status: 'pending', vendor: 'Walmart Business', document_type: 'invoice',
    parsed_json: { vendor: 'Walmart Business', document_type: 'invoice', items: [item('27935840', DESC_B, 'product')] },
  };
  const matchStatus = await window.vdrComputeMatchStatus(sb, [futureDoc]);
  assert.strictEqual(matchStatus['future-doc'].needsMatching, false, 'DURABILITY PROVEN: future invoice recognizes 27935840 automatically, no re-match needed');
  assert.ok(!matchStatus['future-doc'].unmatchedSkuSet.has('27935840'));
});

// ══════════════════════════════════════════════════════════════════
// PART K — conflict test
// ══════════════════════════════════════════════════════════════════
await atest('K: existing alias Walmart+27935840->Chicken Breast; attempting ->Chicken Thigh is a real CONFLICT, zero overwrite, zero backfill', async () => {
  loadRealModules();
  const tables = {
    vendor_item_aliases: [{ id: 'a1', vendor: 'Walmart Business', vendor_sku: '27935840', ingredient_id: 'ing-chicken', vendor_description: DESC_B, active: true }],
    invoice_lines: [{ id: 'x1', vendor: 'Walmart Business', vendor_sku: '27935840', ingredient_id: null, match_status: 'unmatched' }],
  };
  const sb = makeSb(tables);
  const result = await window.vdrSaveVendorSkuMapping(sb, 'Walmart Business', '27935840', 'ing-thigh', 'Chicken Thigh desc');
  assert.strictEqual(result.status, 'conflict');
  assert.strictEqual(result.existing_ingredient_id, 'ing-chicken');
  assert.strictEqual(tables.vendor_item_aliases.length, 1, 'no new/overwritten row');
  assert.strictEqual(tables.vendor_item_aliases[0].ingredient_id, 'ing-chicken', 'existing alias untouched');
  assert.strictEqual(tables.invoice_lines[0].ingredient_id, null, 'zero backfill on conflict');
});

// ══════════════════════════════════════════════════════════════════
// Part G — v846 fake-idempotence is gone
// ══════════════════════════════════════════════════════════════════
test('G: structural — the v846 fake-idempotence workaround (ingredient_vendors_ingredient_id_vendor_key detection) is completely removed', () => {
  assert.ok(!vdrSrc.includes('ingredient_vendors_ingredient_id_vendor_key'), 'no reference to the old workaround constraint name must remain');
  assert.ok(!vdrSrc.includes('sharedIngredientRow'), 'the old fake-success flag must be gone');
});

// ══════════════════════════════════════════════════════════════════
// Part E — write goes to vendor_item_aliases, never ingredient_vendors
// ══════════════════════════════════════════════════════════════════
test('E: structural — vdrSaveVendorSkuMapping writes only to vendor_item_aliases', () => {
  const s = vdrSrc.indexOf('window.vdrSaveVendorSkuMapping = async function');
  const e = vdrSrc.indexOf('MARKER:VDR_SAVE_SKU_MAPPING_END');
  const block = vdrSrc.slice(s, e);
  assert.ok(block.includes("from('vendor_item_aliases')"));
  assert.ok(!block.includes("from('ingredient_vendors')"), 'must never write ingredient_vendors for identity');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
})();
