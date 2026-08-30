// ══════════════════════════════════════════════════════════════════
// Restore Original Match UX + Remove Duplicate History — test run
// Plain Node: `node tests/vendor-review-restore-match-ux.test.js`
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

const dom = new JSDOM(`<!DOCTYPE html><html><body>
  <div id="vdrVendorTabs"></div>
  <div id="vdrList"></div>
</body></html>`);
global.document = dom.window.document;
global.window = global;
global.addSwipeToClose = function() {};
global.showScToast = function() {};

console.log('\nRestore Original Match UX + Remove Duplicate History — test run\n');

function loadRealModules() {
  const fn = new Function('window', 'document', vpuSrc + '\n' + vdrSrc);
  fn(global.window, global.document);
}

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

function doc(id, status, vendor, documentType, items) {
  return {
    id, status, vendor, document_type: documentType || 'invoice', document_number: id, document_date: '2026-08-01',
    created_at: '2026-08-01T00:00:00Z',
    parsed_json: { vendor, document_type: documentType || 'invoice', items: items || [] },
    warnings: null,
  };
}

(async () => {

// ══════════════════════════════════════════════════════════════════
// B/E — candidates prepopulated via historic findMatches, no typing
// ══════════════════════════════════════════════════════════════════
await atest('B/E: opening the selector for "Perdue Harvestland ... Chicken Breast ..." immediately shows Chicken Breast as a candidate — no typing required', async () => {
  loadRealModules();
  window.supabaseClient = { from: (t) => ({
    select() { return this; }, eq() { return this; },
    then(resolve) {
      if (t === 'ingredients') resolve({ data: [
        { id: 'ing-chicken', name: 'Chicken Breast', category: 'Protein', active: true },
        { id: 'ing-beef', name: 'Ground Beef', category: 'Protein', active: true },
      ], error: null });
      else resolve({ data: [], error: null });
    },
  }) };

  await window.vdrOpenMatchSelector('doc1', 'Walmart Business', '19400236', 'Perdue Harvestland Boneless Skinless Chicken Breast', null);
  const modal = document.getElementById('_vdrMatchSelector');
  assert.ok(modal, 'modal must exist');
  assert.ok(modal.innerHTML.includes('Chicken Breast'), 'Chicken Breast must be prepopulated as a candidate without typing anything');
  assert.ok(!modal.innerHTML.includes('No close match found'), 'a real candidate must be found, not the empty-state message');
});

// ══════════════════════════════════════════════════════════════════
// B/3 — green primary / blue alternatives colors preserved
// ══════════════════════════════════════════════════════════════════
test('3: structural — primary candidate uses the historic green palette, alternatives use blue', () => {
  assert.ok(vdrSrc.includes('rgba(16,185,129,0.1)'), 'primary candidate green background must be present');
  assert.ok(vdrSrc.includes('#065f46'), 'primary candidate green text must be present');
  assert.ok(vdrSrc.includes('rgba(59,130,246,0.06)'), 'alternative candidate blue background must be present');
  assert.ok(vdrSrc.includes('#1d4ed8'), 'alternative candidate blue text must be present');
});

// ══════════════════════════════════════════════════════════════════
// F — one tap on primary candidate saves immediately (no select-then-confirm)
// ══════════════════════════════════════════════════════════════════
await atest('F: one tap on the primary (green) candidate saves immediately via vdrSaveVendorSkuMapping — no separate Confirm step', async () => {
  loadRealModules();
  const tables = { vendor_item_aliases: [], invoice_lines: [], ingredients: [{ id: 'ing-chicken', name: 'Chicken Breast', category: 'Protein', active: true }] };
  const { sb } = makeSb(tables);
  window.supabaseClient = sb;

  await window.vdrOpenMatchSelector('doc1', 'Walmart Business', '19400236', 'Chicken Breast bulk', null);
  assert.strictEqual(typeof window.vdrMatchSelectorPickCandidate, 'function');
  await window.vdrMatchSelectorPickCandidate(0);

  assert.strictEqual(tables.vendor_item_aliases.length, 1);
  assert.strictEqual(tables.vendor_item_aliases[0].vendor_sku, '19400236');
  assert.strictEqual(tables.vendor_item_aliases[0].ingredient_id, 'ing-chicken');
});

// ══════════════════════════════════════════════════════════════════
// D/6/7 — modern save contract unchanged: per-SKU, vendor_item_aliases,
// conflict protection, backfill
// ══════════════════════════════════════════════════════════════════
await atest('D/6/7: 26104552-equivalent — matching 19400236 (8 rows) creates exactly 1 vendor_item_aliases row and backfills exactly 8 rows; 27935840 untouched', async () => {
  loadRealModules();
  const tables = {
    vendor_item_aliases: [],
    invoice_lines: [
      ...Array.from({ length: 8 }, (_, i) => ({ id: 'a' + i, vendor: 'Walmart Business', vendor_sku: '19400236', ingredient_id: null })),
      ...Array.from({ length: 7 }, (_, i) => ({ id: 'b' + i, vendor: 'Walmart Business', vendor_sku: '27935840', ingredient_id: null })),
    ],
    ingredients: [{ id: 'ing-chicken', name: 'Chicken Breast', category: 'Protein', active: true }],
  };
  const { sb } = makeSb(tables);
  window.supabaseClient = sb;

  await window.vdrOpenMatchSelector('doc1', 'Walmart Business', '19400236', 'Chicken Breast', null);
  await window.vdrMatchSelectorPickCandidate(0);

  assert.strictEqual(tables.vendor_item_aliases.length, 1, 'exactly 1 new vendor_item_aliases row — never 8');
  const a = tables.invoice_lines.filter(l => l.vendor_sku === '19400236');
  const b = tables.invoice_lines.filter(l => l.vendor_sku === '27935840');
  assert.ok(a.every(l => l.ingredient_id === 'ing-chicken'), 'all 8 19400236 rows backfilled');
  assert.ok(b.every(l => l.ingredient_id === null), '27935840 must remain untouched');
});

await atest('D: conflict protection unchanged — a different ingredient_id already mapped is never overwritten', async () => {
  loadRealModules();
  const tables = {
    vendor_item_aliases: [{ id: 'iv-1', vendor: 'Walmart Business', vendor_sku: '19400236', ingredient_id: 'ing-OTHER' }],
    invoice_lines: [],
    ingredients: [{ id: 'ing-chicken', name: 'Chicken Breast', category: 'Protein', active: true }],
  };
  const { sb } = makeSb(tables);
  window.supabaseClient = sb;

  await window.vdrOpenMatchSelector('doc1', 'Walmart Business', '19400236', 'Chicken Breast', null);
  await window.vdrMatchSelectorPickCandidate(0);

  assert.strictEqual(tables.vendor_item_aliases.length, 1, 'no new row created');
  assert.strictEqual(tables.vendor_item_aliases[0].ingredient_id, 'ing-OTHER', 'existing mapping never overwritten');
  const modal = document.getElementById('_vdrMatchSelector');
  assert.ok(modal, 'modal must stay open on conflict');
  assert.ok(modal.innerHTML.includes('already matched to a different ingredient'));
});

test('D: structural — no code path writes ingredient_links from the new flow', () => {
  const startIdx = vdrSrc.indexOf('window.vdrOpenMatchSelector = async function');
  const endIdx = vdrSrc.indexOf('async function vdrShowMatchModal(unmatchedItems');
  const block = vdrSrc.slice(startIdx, endIdx);
  assert.ok(!block.includes('ingredient_links'), 'the active flow must never reference ingredient_links');
});

// ══════════════════════════════════════════════════════════════════
// F (mobile) — search hidden until explicitly tapped
// ══════════════════════════════════════════════════════════════════
await atest('F: search input/keyboard is never present until "Search" is explicitly tapped', async () => {
  loadRealModules();
  window.supabaseClient = { from: () => ({ select() { return this; }, eq() { return this; }, then(r) { r({ data: [], error: null }); } }) };

  await window.vdrOpenMatchSelector('doc1', 'Walmart Business', 'SKU-X', 'Totally Unmatchable Xyzzy', null);
  let modal = document.getElementById('_vdrMatchSelector');
  assert.ok(!modal.innerHTML.includes('_vdrMatchSearchInput'), 'no search input/keyboard on initial open');
  assert.ok(modal.innerHTML.includes('Search a different ingredient'), 'a search fallback button must be present');

  window.vdrMatchSelectorShowSearch();
  modal = document.getElementById('_vdrMatchSelector');
  assert.ok(modal.innerHTML.includes('_vdrMatchSearchInput'), 'search input appears only after explicit tap');
});

// ══════════════════════════════════════════════════════════════════
// G — Open/History toggle removed from Vendor Documents
// ══════════════════════════════════════════════════════════════════
test('G: structural — the Open/History toggle machinery is completely removed', () => {
  assert.ok(!vdrSrc.includes('vdrCurrentView'), 'vdrCurrentView must be gone');
  assert.ok(!vdrSrc.includes('window.vdrSetView'), 'vdrSetView must be gone');
  assert.ok(!vdrSrc.includes('vdrCurrentViewDocs'), 'vdrCurrentViewDocs must be gone');
});

await atest('G: behavioral — vdrRenderList never shows imported documents, always only Open (pending/error)', async () => {
  loadRealModules();
  const pendingDoc = doc('doc-pending', 'pending', 'Walmart Business');
  const importedDoc = doc('doc-imported', 'imported', 'Walmart Business');
  window._vdrAllDocs = [pendingDoc];
  window._vdrHistoryDocs = [importedDoc]; // still silently loaded, never rendered
  window._vdrPdfQueue = [];
  window.vdrRenderList();
  const list = document.getElementById('vdrList').innerHTML;
  assert.ok(list.includes('vdrCard-doc-pending'));
  assert.ok(!list.includes('vdrCard-doc-imported'), 'History docs must never render in the Vendor Documents list itself');
});

// ══════════════════════════════════════════════════════════════════
// H — Purchase History opens the specific document detail
// ══════════════════════════════════════════════════════════════════
await atest('H: showPurchaseDetail(id, "vendor_documents") opens the specific document via vdrToggle, not just the generic list', async () => {
  loadRealModules();
  const importedDoc = doc('doc-26104552', 'imported', 'Walmart Business', 'invoice', [
    { vendor_sku: '19400236', description: 'Chicken A', line_type: 'product' },
  ]);
  const { sb } = makeSb({ ingredient_vendors: [] });
  window.supabaseClient = sb;
  window._vdrAllDocs = null; window._vdrHistoryDocs = null; // simulate never having opened Vendor Documents before
  window.openVendorDocumentsReview = function() { /* real one calls vdrLoad() fire-and-forget; simulate the screen mount only */ };

  // Monkey-patch vdrLoad to populate History directly (avoids needing
  // the full pdf_received/pending queries for this focused test).
  const originalVdrLoad = window.vdrLoad;
  window.vdrLoad = async function() { window._vdrHistoryDocs = [importedDoc]; window._vdrAllDocs = []; };

  const invSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'invoice.js'), 'utf8');
  const fn = new Function('window', 'document', 'supa',
    invSrc.replace(/^async function showPurchaseDetail/m, 'window.showPurchaseDetail = async function'));
  fn(window, document, sb);

  let toggledWith = null;
  window.vdrToggle = function(id) { toggledWith = id; };

  await window.showPurchaseDetail('doc-26104552', 'vendor_documents');
  assert.strictEqual(toggledWith, 'doc-26104552', 'vdrToggle must be called with the specific document id, not left generic');

  window.vdrLoad = originalVdrLoad;
});

// ══════════════════════════════════════════════════════════════════
// I — imported detail guarantees preserved
// ══════════════════════════════════════════════════════════════════
await atest('I: an imported document opened via vdrToggle still hides Approve and Reprocess, and shows Match for unmatched SKUs', async () => {
  loadRealModules();
  const importedDoc = doc('doc-i', 'imported', 'Walmart Business', 'invoice', [
    { vendor_sku: '19400236', description: 'Chicken A', line_type: 'product' },
  ]);
  const { sb } = makeSb({ ingredient_vendors: [] });
  window.supabaseClient = sb;
  window._vdrAllDocs = [];
  window._vdrHistoryDocs = [importedDoc];
  window._vdrMatchStatus = { 'doc-i': { needsMatching: true, unmatchedSkuCount: 1, unmatchedLineCount: 1, unmatchedSkuSet: new Set(['19400236']) } };

  window.vdrToggle('doc-i');
  const sheet = document.getElementById('vdrSheet');
  assert.ok(sheet, 'sheet must open for an imported document found in History');
  assert.ok(!sheet.innerHTML.includes('Approve Document'));
  assert.ok(!sheet.innerHTML.includes('Reprocess'));
  assert.ok(sheet.innerHTML.includes('Needs match'));
  assert.ok(sheet.innerHTML.includes('vdrOpenMatchSelector'));
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
})();
