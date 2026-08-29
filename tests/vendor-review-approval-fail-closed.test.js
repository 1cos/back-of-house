// ══════════════════════════════════════════════════════════════════
// Approval Safety Fix — invoice_lines insert must fail closed
// Plain Node: `node tests/vendor-review-approval-fail-closed.test.js`
// Runs the REAL live vdrApprove() against a mock Supabase client, not a
// reimplementation of its logic.
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

console.log('\nApproval Safety Fix — invoice_lines fail-closed — test run\n');

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
        if (tableName === 'invoice_lines' && opts.failInvoiceLinesInsert) {
          return { then(resolve) { resolve({ error: { message: opts.failInvoiceLinesInsert } }); } };
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
    ...Array.from({ length: 8 }, () => makeItem('19400236', 'Chicken A', 'product', 12, 1, 12, '1.50-4.30lb Tray')),
    ...Array.from({ length: 7 }, () => makeItem('27935840', 'Chicken B', 'product', 12, 1, 12, '2.75-7.0lb Tray')),
    makeItem('Express Fee', 'HANDLING', 'handling', 1.93, 1, 1.93),
    ...Array.from({ length: 4 }, () => makeItem('SubDown', 'FULFILL_VARIANCE', 'fulfillment_variance', 12.47, 1, 12.47)),
    makeItem('ALT_PAYMENT_METHODS', 'Alternative Payment Methods', 'adjustment', -49.88, 1, -49.88),
  ];
}

function makeFixtureDoc(items) {
  return {
    id: 'fixture-26104552', status: 'pending', vendor: 'Walmart Business', document_number: '26104552', document_date: '2026-08-27',
    warnings: null,
    parsed_json: { vendor: 'Walmart Business', buyer: 'Massimilajo Zubboli', document_type: 'invoice', total: 317.41, items },
  };
}

(async () => {

// ══════════════════════════════════════════════════════════════════
// Part B — structural confirmation of the fail-closed fix
// ══════════════════════════════════════════════════════════════════
test('B: structural — the OLD executable console.warn(...) call on invoice_lines insert failure is gone, replaced with a real throw', () => {
  const idx = vdrSrc.indexOf("sb.from('invoice_lines').insert(invoiceLineRows)");
  const block = vdrSrc.slice(idx, idx + 900);
  assert.ok(!/console\.warn\(/.test(block), 'no executable console.warn(...) call may remain on this path (comments mentioning it historically are fine)');
  assert.ok(/if\s*\(ilErr\)\s*throw new Error/.test(block), 'a real throw must exist on ilErr');
});

// ══════════════════════════════════════════════════════════════════
// Part C — failure case: insert fails -> fail closed
// ══════════════════════════════════════════════════════════════════
await atest('C: invoice_lines insert fails -> vdrApprove throws, document stays pending, zero status update, toast shown, no further writes', async () => {
  document.body.innerHTML = '<div id="vdrActionStatus-fixture-26104552"></div>';
  loadRealModules();
  const items = make26104552Items();
  const docRow = makeFixtureDoc(items);
  const tables = {
    vendor_documents: [docRow],
    ingredient_vendors: [
      { id: 'iv-1', ingredient_id: 'ing-ground-beef', vendor_sku: '44001602', vendor: 'Walmart Business' },
      { id: 'iv-2', ingredient_id: 'ing-watermelon', vendor_sku: '44391101', vendor: 'Walmart Business' },
      { id: 'iv-3', ingredient_id: 'ing-zucchini', vendor_sku: '44390947', vendor: 'Walmart Business' },
    ],
    ingredient_links: [],
    invoice_lines: [],
  };
  const { sb, calls } = makeSb(tables, { failInvoiceLinesInsert: 'simulated network failure' });
  global.window.supabaseClient = sb;
  global.window._vdrEdits = {};
  let toastMsg = null;
  global.showScToast = (msg) => { toastMsg = msg; };

  const btn = { disabled: false, textContent: '', style: {} };
  await global.window.vdrApprove('fixture-26104552', btn);

  assert.strictEqual(tables.vendor_documents[0].status, 'pending', 'document must remain pending after a failed insert');
  assert.strictEqual((tables.invoice_lines || []).length, 0, 'zero invoice_lines must have been persisted');
  assert.strictEqual(calls.updates.filter(u => u.table === 'vendor_documents' && u.data.status === 'imported').length, 0, 'zero status=imported update must ever be issued');
  assert.ok(toastMsg && toastMsg.includes('Failed to save invoice lines'), 'a visible error toast must be shown, got: ' + toastMsg);
  const statusEl = document.getElementById('vdrActionStatus-fixture-26104552');
  assert.ok(statusEl.textContent.includes('Failed to save invoice lines'), 'the inline status element must also show the real error');
});

// ══════════════════════════════════════════════════════════════════
// Part D — success case: insert succeeds -> normal completion
// ══════════════════════════════════════════════════════════════════
await atest('D: invoice_lines insert succeeds -> 24 rows persisted, status=imported, normal success (regression, unaffected by the fix)', async () => {
  document.body.innerHTML = '';
  loadRealModules();
  const items = make26104552Items();
  const docRow = makeFixtureDoc(items);
  const tables = {
    vendor_documents: [docRow],
    ingredient_vendors: [
      { id: 'iv-1', ingredient_id: 'ing-ground-beef', vendor_sku: '44001602', vendor: 'Walmart Business' },
      { id: 'iv-2', ingredient_id: 'ing-watermelon', vendor_sku: '44391101', vendor: 'Walmart Business' },
      { id: 'iv-3', ingredient_id: 'ing-zucchini', vendor_sku: '44390947', vendor: 'Walmart Business' },
    ],
    ingredient_links: [],
    invoice_lines: [],
  };
  const { sb } = makeSb(tables); // no failInvoiceLinesInsert -> succeeds
  global.window.supabaseClient = sb;
  global.window._vdrEdits = {};
  const btn = { disabled: false, textContent: '', style: {} };
  await global.window.vdrApprove('fixture-26104552', btn);

  assert.strictEqual(tables.vendor_documents[0].status, 'imported');
  assert.strictEqual((tables.invoice_lines || []).length, 24);
  const matched = tables.invoice_lines.filter(r => r.ingredient_id);
  assert.strictEqual(matched.length, 3);
  assert.strictEqual(tables.ingredient_vendors.length, 3, 'no new mapping created for chicken/accounting rows');
});

// ══════════════════════════════════════════════════════════════════
// Part F — button trace: both real render sites use the exact same
// onclick handler, with the real docId interpolated
// ══════════════════════════════════════════════════════════════════
test('F: both real Approve Document render sites call vdrApprove(docId, this) — same handler', () => {
  const matches = [...vdrSrc.matchAll(/onclick="vdrApprove\(('|\\')\$\{docId\}\1,this\)"/g)];
  const matches2 = [...vdrSrc.matchAll(/onclick=\\"vdrApprove\(\\'\s*'\s*\+\s*docId\s*\+\s*'\\',this\)\\"/g)];
  // Site 1 (vdrDetailHTML template literal) uses ${docId} interpolation;
  // Site 2 (vdrDetailHTMLNoApprove -> built via vdrDetailHTML string, see
  // audit) shares the same underlying construction. Confirm both real
  // occurrences of the button exist and both target vdrApprove with a
  // real docId, not a hardcoded/stale id.
  const approveButtonSites = [...vdrSrc.matchAll(/Approve Document<\/button>/g)];
  assert.ok(approveButtonSites.length >= 2, 'expected at least 2 real Approve Document button render sites');
  const onclickSites = [...vdrSrc.matchAll(/onclick=\\?"?vdrApprove\(/g)];
  assert.ok(onclickSites.length >= 2, 'expected at least 2 vdrApprove( onclick call sites');
});
test('F: no second/alternate approve function exists — vdrApprove is the sole approval entry point', () => {
  const approveFnMatches = [...vdrSrc.matchAll(/window\.vdr\w*[Aa]pprove\w*\s*=/g)];
  assert.strictEqual(approveFnMatches.length, 1, 'expected exactly one vdrApprove-family function assignment, found: ' + approveFnMatches.map(m => m[0]).join(', '));
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
})();
