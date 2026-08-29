// ══════════════════════════════════════════════════════════════════
// Approval Economic Integrity Hotfix — line_total sign fix +
// post-insert reconciliation guard
// Plain Node: `node tests/vendor-review-economic-integrity.test.js`
// Runs the REAL live vdrApprove() against a mock Supabase client.
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

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = global.window || {};

console.log('\nApproval Economic Integrity Hotfix — test run\n');

function loadRealModules() {
  const fn = new Function('window', 'document', vpuSrc + '\n' + vdrSrc);
  fn(global.window, global.document);
}

function makeSb(tables, opts) {
  opts = opts || {};
  const calls = { inserts: [], updates: [] };
  function builder(tableName) {
    const state = { filters: [] };
    const b = {
      select() { return b; },
      eq(k, v) { state.filters.push(['eq', k, v]); return b; },
      in(k, values) { state.filters.push(['in', k, values]); return b; },
      limit() { return b; },
      single() { state.single = true; return b; },
      update(data) {
        calls.updates.push({ table: tableName, data });
        const ub = {
          eq(k, v) {
            let rows = (tables[tableName] || []).filter(r => r[k] === v);
            rows.forEach(r => Object.assign(r, data));
            return { then(resolve) { resolve({ error: null }); } };
          },
        };
        return ub;
      },
      insert(row) {
        calls.inserts.push({ table: tableName, row });
        if (tableName === 'invoice_lines' && opts.corruptLineTotalForSku) {
          const rows = Array.isArray(row) ? row : [row];
          rows.forEach(r => {
            if (r.vendor_sku === opts.corruptLineTotalForSku) r.line_total = Math.abs(r.line_total);
            if (r.id == null) r.id = 'gen-' + Math.random().toString(36).slice(2);
          });
          (tables[tableName] = tables[tableName] || []).push(...rows);
          return { then(resolve) { resolve({ error: null }); } };
        }
        const rows = Array.isArray(row) ? row : [row];
        rows.forEach(r => { if (r.id == null) r.id = 'gen-' + Math.random().toString(36).slice(2); });
        (tables[tableName] = tables[tableName] || []).push(...rows);
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

function makeItem(sku, desc, lineType, unitPrice, qty, amount, pack) {
  return {
    vendor_sku: sku, description: desc, raw_description: desc, line_type: lineType,
    unit_price: unitPrice, qty: qty, amount: amount, line_total: amount,
    pack_description: pack || null, warnings: [],
  };
}

function make26104552Items() {
  return [
    makeItem('44001602', 'Ground Beef', 'product', 39.94, 3, 119.82, '10lb'),
    makeItem('44391101', 'Watermelon', 'product', 4.65, 1, 4.65, 'Each'),
    makeItem('44390947', 'Zucchini', 'product', 3.60, 1, 3.60, 'Each'),
    ...Array.from({ length: 8 }, () => makeItem('19400236', 'Chicken A', 'product', 12.9025, 1, 12.9025, '1.50-4.30lb Tray')),
    ...Array.from({ length: 7 }, () => makeItem('27935840', 'Chicken B', 'product', 12.0271, 1, 12.0271, '2.75-7.0lb Tray')),
    makeItem('Express Fee', 'HANDLING', 'handling', 1.93, 1, 1.93),
    ...Array.from({ length: 4 }, () => makeItem('SubDown', 'FULFILL_VARIANCE', 'fulfillment_variance', 12.47, 1, 12.47)),
    makeItem('ALT_PAYMENT_METHODS', 'Alternative Payment Methods', 'adjustment', -49.88, 1, -49.88),
  ];
}
// Use exact real per-SKU sub-totals for the chicken groups (8 rows
// summing to exactly 103.22, 7 rows summing to exactly 84.19) so the
// document total genuinely reconciles to 317.41, matching real 26104552.
function make26104552ItemsExact() {
  const chicken1Prices = [11.72, 13.10, 12.87, 12.27, 13.79, 11.63, 14.19, 13.65];
  const chicken2Prices = [10.69, 12.41, 12.26, 11.54, 13.03, 12.49, 11.77];
  return [
    makeItem('44001602', 'Ground Beef', 'product', 39.94, 3, 119.82, '10lb'),
    makeItem('44391101', 'Watermelon', 'product', 4.65, 1, 4.65, 'Each'),
    makeItem('44390947', 'Zucchini', 'product', 3.60, 1, 3.60, 'Each'),
    ...chicken1Prices.map(p => makeItem('19400236', 'Chicken A', 'product', p, 1, p, '1.50-4.30lb Tray')),
    ...chicken2Prices.map(p => makeItem('27935840', 'Chicken B', 'product', p, 1, p, '2.75-7.0lb Tray')),
    makeItem('Express Fee', 'HANDLING', 'handling', 1.93, 1, 1.93),
    makeItem('SubDown', 'FULFILL_VARIANCE', 'fulfillment_variance', 10.29, 1, 10.29),
    makeItem('SubDown', 'FULFILL_VARIANCE', 'fulfillment_variance', 10.29, 1, 10.29),
    makeItem('SubDown', 'FULFILL_VARIANCE', 'fulfillment_variance', 14.65, 1, 14.65),
    makeItem('SubDown', 'FULFILL_VARIANCE', 'fulfillment_variance', 14.65, 1, 14.65),
    makeItem('ALT_PAYMENT_METHODS', 'Alternative Payment Methods', 'adjustment', -49.88, 1, -49.88),
  ];
}

function makeFixtureDoc(items, total) {
  return {
    id: 'fixture-26104552', status: 'pending', vendor: 'Walmart Business', document_number: '26104552', document_date: '2026-08-27',
    warnings: null,
    parsed_json: { vendor: 'Walmart Business', buyer: 'Massimilajo Zubboli', document_type: 'invoice', total, items },
  };
}
function baseTables() {
  return {
    vendor_documents: [],
    ingredient_vendors: [
      { id: 'iv-1', ingredient_id: 'ing-ground-beef', vendor_sku: '44001602', vendor: 'Walmart Business' },
      { id: 'iv-2', ingredient_id: 'ing-watermelon', vendor_sku: '44391101', vendor: 'Walmart Business' },
      { id: 'iv-3', ingredient_id: 'ing-zucchini', vendor_sku: '44390947', vendor: 'Walmart Business' },
    ],
    ingredient_links: [],
    invoice_lines: [],
  };
}

(async () => {

// ══════════════════════════════════════════════════════════════════
// Part A/B — sign fix, structural + real end-to-end
// ══════════════════════════════════════════════════════════════════
test('B: structural — lineTotal no longer applies Math.abs() to item.amount', () => {
  const idx = vdrSrc.indexOf('const lineTotal   = (edits.ext');
  const line = vdrSrc.slice(idx, vdrSrc.indexOf('\n', idx));
  assert.ok(!line.includes('Math.abs'), 'lineTotal must not use Math.abs() anymore');
  assert.ok(line.includes('item.amount : null'), 'lineTotal must preserve the real signed amount');
});

await atest('E: real 26104552 fixture (correct signs) -> ALT_PAYMENT_METHODS unit_price=-49.88 AND line_total=-49.88, sum=317.41, status=imported', async () => {
  document.body.innerHTML = '';
  loadRealModules();
  const items = make26104552ItemsExact();
  const docRow = makeFixtureDoc(items, 317.41);
  const tables = baseTables();
  tables.vendor_documents = [docRow];
  const { sb } = makeSb(tables);
  global.window.supabaseClient = sb;
  global.window._vdrEdits = {};
  const btn = { disabled: false, textContent: '', style: {} };
  await global.window.vdrApprove('fixture-26104552', btn);

  assert.strictEqual(tables.vendor_documents[0].status, 'imported');
  assert.strictEqual(tables.invoice_lines.length, 24);
  const adj = tables.invoice_lines.find(r => r.vendor_sku === 'ALT_PAYMENT_METHODS');
  assert.strictEqual(adj.unit_price, -49.88);
  assert.strictEqual(adj.line_total, -49.88, 'line_total must preserve the negative sign, matching unit_price');
  const sum = Math.round(tables.invoice_lines.reduce((s, r) => s + r.line_total, 0) * 100) / 100;
  assert.strictEqual(sum, 317.41);
});

// ══════════════════════════════════════════════════════════════════
// Part D/E — reconciliation guard: negative test, forced corruption
// ══════════════════════════════════════════════════════════════════
await atest('D/E: forced adjustment line_total=+49.88 (simulating the exact production bug via a corrupting mock) -> reconciliation guard blocks imported, sum would have been 417.17', async () => {
  document.body.innerHTML = '';
  loadRealModules();
  const items = make26104552ItemsExact();
  const docRow = makeFixtureDoc(items, 317.41);
  const tables = baseTables();
  tables.vendor_documents = [docRow];
  const { sb } = makeSb(tables, { corruptLineTotalForSku: 'ALT_PAYMENT_METHODS' });
  global.window.supabaseClient = sb;
  global.window._vdrEdits = {};
  const btn = { disabled: false, textContent: '', style: {} };
  let toastMsg = null;
  global.showScToast = (msg) => { toastMsg = msg; };
  await global.window.vdrApprove('fixture-26104552', btn);

  assert.strictEqual(tables.vendor_documents[0].status, 'pending', 'reconciliation guard must block imported when sum does not reconcile');
  const sum = Math.round(tables.invoice_lines.reduce((s, r) => s + r.line_total, 0) * 100) / 100;
  assert.strictEqual(sum, 417.17, 'confirms the corrupted persisted sum matches the exact production discrepancy');
  assert.ok(toastMsg && toastMsg.includes('Invoice lines sum'), 'a visible error must be shown, got: ' + toastMsg);
});

test('D: structural — reconciliation guard reuses the exact same $0.02 tolerance as DOC-TOTAL-001 (checkTotals), not a new convention', () => {
  const guardIdx = vdrSrc.indexOf('RECONCILIATION_TOLERANCE');
  assert.ok(guardIdx > -1);
  const guardBlock = vdrSrc.slice(guardIdx, guardIdx + 100);
  assert.ok(guardBlock.includes('0.02'), 'must reuse the same 0.02 tolerance value as DOC-TOTAL-001');
  const totalToleranceIdx = vpuSrc.indexOf('TOTAL_TOLERANCE');
  assert.ok(vpuSrc.slice(totalToleranceIdx, totalToleranceIdx + 30).includes('0.02'), 'confirms DOC-TOTAL-001 itself really uses 0.02');
});

await atest('D: a genuinely reconciled document (sum within $0.02) still approves normally — guard does not false-positive on rounding', async () => {
  document.body.innerHTML = '';
  loadRealModules();
  const items = make26104552ItemsExact();
  const docRow = makeFixtureDoc(items, 317.42); // 1 cent off, within tolerance
  const tables = baseTables();
  tables.vendor_documents = [docRow];
  const { sb } = makeSb(tables);
  global.window.supabaseClient = sb;
  global.window._vdrEdits = {};
  const btn = { disabled: false, textContent: '', style: {} };
  await global.window.vdrApprove('fixture-26104552', btn);
  assert.strictEqual(tables.vendor_documents[0].status, 'imported', 'a 1-cent difference must still be within tolerance');
});

// ══════════════════════════════════════════════════════════════════
// Part F — non-product safety unaffected
// ══════════════════════════════════════════════════════════════════
await atest('F: handling/fulfillment_variance/adjustment still get ingredient_id=null, zero new ingredient_vendors — economics fix is scoped only to line_total', async () => {
  document.body.innerHTML = '';
  loadRealModules();
  const items = make26104552ItemsExact();
  const docRow = makeFixtureDoc(items, 317.41);
  const tables = baseTables();
  tables.vendor_documents = [docRow];
  const { sb } = makeSb(tables);
  global.window.supabaseClient = sb;
  global.window._vdrEdits = {};
  const btn = { disabled: false, textContent: '', style: {} };
  await global.window.vdrApprove('fixture-26104552', btn);

  const accounting = tables.invoice_lines.filter(r => ['handling', 'fulfillment_variance', 'adjustment'].includes(r.match_status === 'matched' ? 'x' : r.vendor_sku === 'Express Fee' ? 'handling' : (r.vendor_sku === 'SubDown' ? 'fulfillment_variance' : (r.vendor_sku === 'ALT_PAYMENT_METHODS' ? 'adjustment' : 'x'))));
  assert.ok(accounting.every(r => r.ingredient_id === null), 'all accounting rows must have ingredient_id=null');
  assert.strictEqual(tables.ingredient_vendors.length, 3, 'no new ingredient_vendors created for accounting rows or chicken');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
})();
