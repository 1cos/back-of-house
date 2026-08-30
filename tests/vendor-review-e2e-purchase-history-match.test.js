// ══════════════════════════════════════════════════════════════════
// End-to-end integration test — Purchase History → Match, real iPhone
// path. Plain Node: `node tests/vendor-review-e2e-purchase-history-match.test.js`
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const VDR_JS = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');
const VPU_JS = path.join(__dirname, '..', 'js', 'vendor-parser-ui.js');
const INV_JS = path.join(__dirname, '..', 'js', 'invoice.js');
const vdrSrc = fs.readFileSync(VDR_JS, 'utf8');
const vpuSrc = fs.readFileSync(VPU_JS, 'utf8');
const invSrc = fs.readFileSync(INV_JS, 'utf8');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }
async function atest(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }

const dom = new JSDOM(`<!DOCTYPE html><html><body>
  <div id="vdrVendorTabs"></div>
  <div id="vdrList"></div>
</body></html>`);
global.document = dom.window.document;
global.window = global;
global.addSwipeToClose = function() {};
global.showScToast = function() {};

console.log('\nEnd-to-end: Purchase History → Match (real iPhone path) — test run\n');

function makeSb(tables) {
  const calls = { inserts: [], updates: [] };
  function builder(tableName) {
    const state = { filters: [] };
    const b = {
      select() { return b; },
      eq(k, v) { state.filters.push(['eq', k, v]); return b; },
      in(k, values) { state.filters.push(['in', k, values]); return b; },
      is(k, v) { state.filters.push(['is', k, v]); return b; },
      order() { return b; },
      limit() { return b; },
      single() { state.single = true; return b; },
      ilike(k, v) { state.filters.push(['ilike', k, v]); return b; },
      update(data) {
        calls.updates.push({ table: tableName, data });
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
        calls.inserts.push({ table: tableName, row });
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

await atest('E2E: Purchase History -> showPurchaseDetail -> real detail opens -> tap Match -> prepopulated candidates (real long description) -> tap Chicken Breast -> full backfill, 27935840 untouched, UI shows Matched', async () => {
  const REAL_DESC = 'Perdue Harvestland, Free Range, Fresh Boneless Chicken Breast, 1.50–4.30 lb Tray';

  function item(sku, desc, lineType, pack) {
    return { vendor_sku: sku, description: desc, raw_description: desc, line_type: lineType, pack_description: pack || null, unit_price: 1, qty: 1, amount: 1, warnings: [] };
  }
  const items = [
    item('44001602', 'Ground Beef', 'product', '10lb'),
    ...Array.from({ length: 8 }, () => item('19400236', REAL_DESC, 'product', '1.50-4.30lb Tray')),
    ...Array.from({ length: 7 }, () => item('27935840', 'Chicken B', 'product', '2.75-7.0lb Tray')),
  ];

  const importedDoc = {
    id: 'doc-26104552', status: 'imported', vendor: 'Walmart Business', document_number: '26104552', document_type: 'invoice',
    document_date: '2026-08-27', created_at: '2026-08-27T00:00:00Z',
    parsed_json: { vendor: 'Walmart Business', document_type: 'invoice', items },
    warnings: null,
  };

  const tables = {
    vendor_documents: [importedDoc],
    ingredient_vendors: [
      { id: 'iv-1', vendor: 'Walmart Business', vendor_sku: '44001602', ingredient_id: 'ing-44001602' },
    ],
    invoice_lines: [
      ...Array.from({ length: 8 }, (_, i) => ({ id: 'a' + i, vendor: 'Walmart Business', vendor_sku: '19400236', ingredient_id: null, match_status: 'unmatched' })),
      ...Array.from({ length: 7 }, (_, i) => ({ id: 'b' + i, vendor: 'Walmart Business', vendor_sku: '27935840', ingredient_id: null, match_status: 'unmatched' })),
    ],
    ingredients: [
      { id: 'ing-chicken', name: 'Chicken Breast', category: 'Protein', active: true },
      { id: 'ing-beef', name: 'Ground Beef', category: 'Protein', active: true },
    ],
  };
  const { sb } = makeSb(tables);

  // ── Fresh module load, exactly once, real source — ALL THREE in one
  // single new Function call, matching how classic <script> tags in the
  // real browser share one real global scope (two separate new Function
  // calls would create two separate function scopes even sharing the
  // same window, breaking bare-identifier calls like
  // vdrComputeMatchStatus() from within invoice.js's own body).
  document.body.innerHTML = '<div id="vdrVendorTabs"></div><div id="vdrList"></div>';
  const invSrcForEval = invSrc.replace(/^async function showPurchaseDetail/m, 'window.showPurchaseDetail = async function');
  const fn = new Function('window', 'document', 'supa', vpuSrc + '\n' + vdrSrc + '\n' + invSrcForEval);
  window.supabaseClient = sb;
  fn(window, document, sb);

  // Purchase History already knows this id (it queried vendor_documents
  // itself, per openPurchaseHistory()'s own real contract) but the
  // Vendor Documents screen has never been opened yet — simulates the
  // real path where History's own bounded query might not have this doc.
  window._vdrAllDocs = null;
  window._vdrHistoryDocs = null;
  window.openVendorDocumentsReview = function() { /* real one shows the screen + fires vdrLoad() fire-and-forget */ };
  const originalVdrLoad = window.vdrLoad;
  window.vdrLoad = async function() { window._vdrAllDocs = []; window._vdrHistoryDocs = []; /* simulates this doc NOT being in the most-recent-100 window */ };

  // ── STEP 1: Purchase History taps the row ──
  await window.showPurchaseDetail('doc-26104552', 'vendor_documents');

  const sheet = document.getElementById('vdrSheet');
  assert.ok(sheet, 'the specific document detail must open — not just the generic list');
  assert.ok(!sheet.innerHTML.includes('Approve Document'), 'imported document must never show Approve');
  assert.ok(!sheet.innerHTML.includes('Reprocess'), 'imported document must never show Reprocess');
  assert.ok(sheet.innerHTML.includes('Needs match'), 'the real unmatched SKU must show Needs match, not generic OK');

  // ── STEP 2: tap Match ──
  await window.vdrOpenMatchSelector('doc-26104552', 'Walmart Business', '19400236', REAL_DESC, null);
  const modal = document.getElementById('_vdrMatchSelector');
  assert.ok(modal, 'match modal must open');
  assert.ok(modal.innerHTML.includes('Chicken Breast'), 'Chicken Breast must be a prepopulated candidate for the real long description, with zero typing');
  assert.ok(!modal.innerHTML.includes('_vdrMatchSearchInput'), 'no search input/keyboard on open');
  assert.ok(modal.innerHTML.includes('Search a different ingredient'), 'search must remain available only as a fallback');

  // ── STEP 3: tap the (primary/best) Chicken Breast candidate ──
  await window.vdrMatchSelectorPickCandidate(0);

  // ── FINAL STATE ──
  assert.strictEqual(tables.ingredient_vendors.filter(r => r.vendor_sku === '19400236').length, 1, 'exactly 1 mapping for 19400236');
  assert.strictEqual(tables.ingredient_vendors.find(r => r.vendor_sku === '19400236').ingredient_id, 'ing-chicken');
  const chickenA = tables.invoice_lines.filter(l => l.vendor_sku === '19400236');
  const chickenB = tables.invoice_lines.filter(l => l.vendor_sku === '27935840');
  assert.strictEqual(chickenA.length, 8);
  assert.ok(chickenA.every(l => l.ingredient_id === 'ing-chicken'), 'all 8 rows backfilled');
  assert.ok(chickenB.every(l => l.ingredient_id === null), '27935840 must remain untouched');

  const finalSheet = document.getElementById('vdrSheet');
  assert.ok(finalSheet, 'sheet must re-render after the match (vdrToggle safe redraw)');
  assert.ok(!finalSheet.innerHTML.includes('Needs match') || finalSheet.innerHTML.includes('27935840'), 'the matched SKU rows no longer show Needs match');

  window.vdrLoad = originalVdrLoad;
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
})();
