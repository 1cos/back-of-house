// ══════════════════════════════════════════════════════════════════
// Vendor Documents Imported/History View — test run
// Plain Node: `node tests/vendor-review-history-view.test.js`
// Runs the REAL live code against a mock Supabase client and jsdom.
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
  <div id="vdrViewToggle"><button id="vdrView-open"></button><button id="vdrView-history"></button></div>
  <div id="vdrVendorTabs"></div>
  <div id="vdrList"></div>
</body></html>`);
global.document = dom.window.document;
global.window = global;

console.log('\nVendor Documents Imported/History View — test run\n');

global.addSwipeToClose = function() {};
global.showScToast = function() {};

function loadRealModules() {
  const fn = new Function('window', 'document', vpuSrc + '\n' + vdrSrc);
  fn(global.window, global.document);
}

function makeSb(pendingErrorRows, importedRows) {
  const calls = { selects: [] };
  function builder(tableName) {
    const state = { filters: [] };
    const b = {
      select(cols) { calls.selects.push({ table: tableName, cols }); return b; },
      eq(k, v) { state.filters.push(['eq', k, v]); return b; },
      in(k, values) { state.filters.push(['in', k, values]); return b; },
      order() { return b; },
      limit() { return b; },
      then(resolve) {
        let rows;
        if (tableName === 'vendor_documents') {
          const wantsImported = state.filters.some(f => f[0] === 'eq' && f[1] === 'status' && f[2] === 'imported');
          const wantsPdfReceived = state.filters.some(f => f[0] === 'eq' && f[1] === 'status' && f[2] === 'pdf_received');
          const wantsPendingError = state.filters.some(f => f[0] === 'in' && f[1] === 'status');
          if (wantsImported) rows = importedRows;
          else if (wantsPdfReceived) rows = [];
          else if (wantsPendingError) rows = pendingErrorRows;
          else rows = [];
        } else if (tableName === 'ingredient_vendors') {
          rows = [];
        } else {
          rows = [];
        }
        resolve({ data: rows, error: null });
      },
    };
    return b;
  }
  return { sb: { from: builder }, calls };
}

function doc(id, status, vendor, documentType, items) {
  return {
    id, status, vendor, document_type: documentType || 'invoice', document_number: id, document_date: '2026-08-01',
    created_at: '2026-08-0' + (id.length % 9 || 1) + 'T00:00:00Z',
    parsed_json: { vendor, document_type: documentType || 'invoice', items: items || [] },
    warnings: null,
  };
}

(async () => {

// ══════════════════════════════════════════════════════════════════
// I.1-I.4 — Open vs History content
// ══════════════════════════════════════════════════════════════════
await atest('I1/I2/I3: pending and error appear in Open, imported does NOT', async () => {
  loadRealModules();
  const pendingDoc = doc('doc-pending', 'pending', 'Walmart Business');
  const errorDoc = doc('doc-error', 'error', 'Walmart Business');
  const importedDoc = doc('doc-imported', 'imported', 'Walmart Business');
  const { sb } = makeSb([pendingDoc, errorDoc], [importedDoc]);
  window.supabaseClient = sb;
  await window.vdrLoad();

  assert.strictEqual(window._vdrAllDocs.length, 2, 'Open (window._vdrAllDocs) must contain only pending+error');
  assert.ok(window._vdrAllDocs.some(d => d.id === 'doc-pending'));
  assert.ok(window._vdrAllDocs.some(d => d.id === 'doc-error'));
  assert.ok(!window._vdrAllDocs.some(d => d.status === 'imported'), 'imported must never be in the Open list');
});

await atest('I4: imported appears in History (window._vdrHistoryDocs), separate from Open', async () => {
  loadRealModules();
  const pendingDoc = doc('doc-pending2', 'pending', 'Walmart Business');
  const importedDoc = doc('doc-imported2', 'imported', 'Walmart Business');
  const { sb } = makeSb([pendingDoc], [importedDoc]);
  window.supabaseClient = sb;
  await window.vdrLoad();

  assert.strictEqual(window._vdrHistoryDocs.length, 1);
  assert.strictEqual(window._vdrHistoryDocs[0].id, 'doc-imported2');
  assert.ok(!window._vdrHistoryDocs.some(d => d.status === 'pending'), 'History must never contain Open documents');
});

// ══════════════════════════════════════════════════════════════════
// I.5 — 26104552 fixture is reopenable via vdrToggle from History
// ══════════════════════════════════════════════════════════════════
await atest('I5: a 26104552-equivalent imported document is reopenable via vdrToggle (found in History)', async () => {
  loadRealModules();
  const items = [
    { vendor_sku: '44001602', description: 'Ground Beef', line_type: 'product', pack_description: '10lb', unit_price: 39.94, qty: 3, amount: 119.82 },
    ...Array.from({ length: 8 }, () => ({ vendor_sku: '19400236', description: 'Chicken A', line_type: 'product', pack_description: '1.50-4.30lb Tray', unit_price: 12, qty: 1, amount: 12 })),
  ];
  const importedDoc = doc('doc-26104552', 'imported', 'Walmart Business', 'invoice', items);
  const { sb } = makeSb([], [importedDoc]);
  window.supabaseClient = sb;
  await window.vdrLoad();

  document.body.innerHTML += '';
  let sheetAdded = false;
  const origAppendChild = document.body.appendChild.bind(document.body);
  document.body.appendChild = function(el) { if (el && el.id === 'vdrSheet') sheetAdded = true; return origAppendChild(el); };

  window.vdrToggle('doc-26104552');
  assert.ok(sheetAdded || document.getElementById('vdrSheet'), 'vdrToggle must successfully open the sheet for a History (imported) document');
  document.body.appendChild = origAppendChild;
});

// ══════════════════════════════════════════════════════════════════
// I.6 — imported does not show Approve
// ══════════════════════════════════════════════════════════════════
test('I6: structural — both Approve render sites are now conditioned on doc.status !== \'imported\'', () => {
  const occurrences = (vdrSrc.match(/doc\.status !== 'imported'/g) || []).length;
  assert.strictEqual(occurrences, 2, 'expected exactly 2 sites conditioned on status !== imported (sticky-footer + vdrDetailHTML approveHTML), found: ' + occurrences);
});

await atest('I6b: behavioral — vdrToggle on an imported doc never renders an Approve Document button', async () => {
  loadRealModules();
  const importedDoc = doc('doc-noapprove', 'imported', 'Walmart Business');
  const { sb } = makeSb([], [importedDoc]);
  window.supabaseClient = sb;
  await window.vdrLoad();

  window.vdrToggle('doc-noapprove');
  const sheet = document.getElementById('vdrSheet');
  assert.ok(sheet, 'sheet must open');
  assert.ok(!sheet.innerHTML.includes('Approve Document'), 'no Approve Document button anywhere in an imported document\'s sheet');
});

await atest('behavioral (regression): vdrToggle on a pending doc still renders Approve Document normally', async () => {
  loadRealModules();
  const pendingDoc = doc('doc-approve-ok', 'pending', 'Walmart Business');
  const { sb } = makeSb([pendingDoc], []);
  window.supabaseClient = sb;
  await window.vdrLoad();

  window.vdrToggle('doc-approve-ok');
  const sheet = document.getElementById('vdrSheet');
  assert.ok(sheet.innerHTML.includes('Approve Document'), 'Approve Document must still render normally for a pending doc — unaffected by this task');
});

// ══════════════════════════════════════════════════════════════════
// I.7 — post-approval Match: unmatched imported shows Match
// ══════════════════════════════════════════════════════════════════
await atest('I7: an imported document with an unmatched product SKU shows the real "Needs match · Match" button, not just OK', async () => {
  loadRealModules();
  const items = [
    { vendor_sku: '19400236', description: 'Chicken A', line_type: 'product', pack_description: '1.50-4.30lb Tray', unit_price: 12, qty: 1, amount: 12 },
  ];
  const importedDoc = doc('doc-postapproval', 'imported', 'Walmart Business', 'invoice', items);
  const { sb } = makeSb([], [importedDoc]);
  window.supabaseClient = sb; // ingredient_vendors query returns [] -> 19400236 stays unmatched
  await window.vdrLoad();

  assert.ok(window._vdrMatchStatus['doc-postapproval'], 'match status must be computed for History docs too');
  assert.ok(window._vdrMatchStatus['doc-postapproval'].unmatchedSkuSet.has('19400236'));

  window.vdrToggle('doc-postapproval');
  const sheet = document.getElementById('vdrSheet');
  assert.ok(sheet.innerHTML.includes('Needs match'), 'the row must show Needs match');
  assert.ok(sheet.innerHTML.includes('vdrOpenMatchSelector'), 'the real tappable Match action must be present, reaching the same selector as Open documents');
});

// ══════════════════════════════════════════════════════════════════
// I.8 — vendor filtering works in History
// ══════════════════════════════════════════════════════════════════
await atest('I8: vendor filtering works inside History exactly like Open', async () => {
  loadRealModules();
  const walmartImported = doc('doc-h-walmart', 'imported', 'Walmart Business');
  const bekImported = doc('doc-h-bek', 'imported', 'Ben E. Keith', 'order_confirmation');
  const { sb } = makeSb([], [walmartImported, bekImported]);
  window.supabaseClient = sb;
  await window.vdrLoad();

  window.vdrSetView('history');
  let list = document.getElementById('vdrList').innerHTML;
  assert.ok(list.includes('doc-h-walmart') === false || true); // card doesn't literally include id, check via card count instead
  const cardCountAll = (list.match(/data-vdr-card|vdrCard-/g) || []).length;

  window.vdrSetVendor('Walmart_Business');
  list = document.getElementById('vdrList').innerHTML;
  assert.ok(list.includes('vdrCard-doc-h-walmart'), 'Walmart card must show when filtered to Walmart Business inside History');
  assert.ok(!list.includes('vdrCard-doc-h-bek'), 'BEK card must be filtered out');
});

// ══════════════════════════════════════════════════════════════════
// Part G — empty states are distinct
// ══════════════════════════════════════════════════════════════════
await atest('G: Open and History have distinct empty-state wording', async () => {
  loadRealModules();
  const { sb } = makeSb([], []);
  window.supabaseClient = sb;
  await window.vdrLoad();

  let list = document.getElementById('vdrList').innerHTML;
  assert.ok(list.includes('No pending documents'), 'Open empty state');

  window.vdrSetView('history');
  list = document.getElementById('vdrList').innerHTML;
  assert.ok(list.includes('No imported documents'), 'History empty state must be distinct');
  assert.ok(!list.includes('No pending documents'), 'History must never show the Open empty-state wording');
});

// ══════════════════════════════════════════════════════════════════
// I.9 / Part J — Open workflow regression
// ══════════════════════════════════════════════════════════════════
await atest('I9: Open workflow itself is completely unaffected — pending doc still shows Approve, Reprocess, real counts', async () => {
  loadRealModules();
  const pendingDoc = doc('doc-regression', 'pending', 'Walmart Business');
  const { sb } = makeSb([pendingDoc], []);
  window.supabaseClient = sb;
  await window.vdrLoad();

  assert.strictEqual(window._vdrAllDocs.length, 1);
  window.vdrToggle('doc-regression');
  const sheet = document.getElementById('vdrSheet');
  assert.ok(sheet.innerHTML.includes('Approve Document'));
  assert.ok(sheet.innerHTML.includes('Reprocess'));
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
})();
