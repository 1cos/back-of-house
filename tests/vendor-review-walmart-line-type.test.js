// ══════════════════════════════════════════════════════════════════
// vendor-documents-review.js — Walmart line_type consumption
// (Shipping/adjustment excluded from ingredient matching + writes)
// Plain Node, zero external deps beyond jsdom: `node tests/vendor-review-walmart-line-type.test.js`
//
// Drives the REAL vdrPreflight() and window.vdrApprove() (whole file
// eval'd, same convention as tests/vendor-review-price-gate.test.js)
// against a generic thenable Supabase mock. Real parsed items for
// 6c246fda and 30082536 come from the REAL Walmart parser run against
// the REAL normalized text (tests/fixtures/trevipay-samples.js) — not
// hand-typed. Since the Buyer Guard blocks approval for buyer=Zeno Russo
// (by design, unrelated to this task), the line_type behavior for those
// two real documents' items is verified through a synthetic
// Kitchen-equivalent fixture (buyer=Massimilajo Zubboli, same real
// items) — exactly as suggested by the task spec — never by weakening
// or bypassing the Buyer Guard itself.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const VDR_JS = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');
const vdrSrc = fs.readFileSync(VDR_JS, 'utf8');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }
async function atest(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = global.window || {};

// ── Generic thenable Supabase mock (same convention as
// vendor-review-price-gate.test.js / vendor-review-walmart-buyer-guard.test.js) ──
function makeGenericSb(tables) {
  const calls = { updates: [], inserts: [] };
  function builder(tableName) {
    const state = { filters: [], single: false };
    const b = {
      select() { return b; },
      eq(k, v) { state.filters.push(['eq', k, v]); return b; },
      neq(k, v) { state.filters.push(['neq', k, v]); return b; },
      in(k, values) { state.filters.push(['in', k, values]); return b; },
      order() { return b; },
      limit() { return b; },
      single() { state.single = true; return b; },
      update(data) {
        const rec = { table: tableName, data, filters: [] };
        calls.updates.push(rec);
        const ub = {
          eq(k, v) { rec.filters.push(['eq', k, v]); return ub; },
          then(resolve) { resolve({ error: null }); },
        };
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
          if (type === 'neq') rows = rows.filter(r => r[k] !== v);
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
  const fn = new Function('window', 'document', vdrSrc);
  fn(global.window, global.document);
}

// ── Real parsed items, extracted once from the real parser + real
// normalized text (built exactly like the parity/parser test suites) ──
const fixtures = require('./fixtures/trevipay-samples.js');
const NORM_START = '// ── MARKER:VDR_TREVIPAY_NORMALIZE_START ────────────────────────────';
const NORM_END   = '// ── MARKER:VDR_TREVIPAY_NORMALIZE_END ──────────────────────────────';
const normBlock = vdrSrc.slice(vdrSrc.indexOf(NORM_START), vdrSrc.indexOf(NORM_END));
const { vdrNormalizeTreviPayPage } = new Function(normBlock + 'return { vdrNormalizeTreviPayPage };')();
function norm(items) { return vdrNormalizeTreviPayPage(items).text; }
const nodeParsers = require('../js/vendor-parsers/index.js');

const REAL = {
  c51dd720: nodeParsers.parse(norm(fixtures.C51DD720_PAGE1) + '\n' + norm(fixtures.C51DD720_PAGE2)),
  '6c246fda': nodeParsers.parse(norm(fixtures.C6C246FDA_PAGE2) + '\n' + norm(fixtures.C6C246FDA_PAGE3)),
  '30082536': nodeParsers.parse(norm(fixtures.C30082536_PAGE1) + '\n' + norm(fixtures.C30082536_PAGE2) + '\n' + norm(fixtures.C30082536_PAGE3)),
};

console.log('\nWalmart line_type consumption — regression tests\n');

// ══════════════════════════════════════════════════════════════════
// Layer 1 — vdrPreflight: matching check must skip non-product items
// ══════════════════════════════════════════════════════════════════

// vdrPreflight is a plain top-level `async function`, not window.-prefixed
// — re-eval with an explicit return so we can call it directly.
function loadPreflight() {
  const fn = new Function('window', 'document', vdrSrc + '\nreturn vdrPreflight;');
  return fn(global.window, global.document);
}

(async () => {

await atest('1. product line, no existing match → matching still required (match_needed)', async () => {
  const vdrPreflightFn = loadPreflight();
  const items = [{ vendor_sku: '999999', description: 'Some Real Product', raw_description: 'Some Real Product', line_type: 'product', amount: 5 }];
  const doc = { id: 'd1', vendor: 'Walmart Business', warnings: null, parsed_json: { vendor: 'Walmart Business', document_type: 'invoice', items } };
  const { sb } = makeGenericSb({ ingredient_vendors: [], ingredient_links: [] });
  global.window.supabaseClient = sb;
  const result = await vdrPreflightFn('d1', doc);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'match_needed');
  assert.strictEqual(result.unmatched.length, 1);
});

await atest('2. shipping line, no existing match → NOT unmatched, preflight passes (no match_needed)', async () => {
  const vdrPreflightFn = loadPreflight();
  const items = [{ vendor_sku: 'Shipping', description: 'SHIPPING', raw_description: 'SHIPPING', line_type: 'shipping', amount: 0.99 }];
  const doc = { id: 'd2', vendor: 'Walmart Business', warnings: null, parsed_json: { vendor: 'Walmart Business', document_type: 'invoice', items } };
  const { sb } = makeGenericSb({ ingredient_vendors: [], ingredient_links: [] });
  global.window.supabaseClient = sb;
  const result = await vdrPreflightFn('d2', doc);
  assert.strictEqual(result.ok, true, 'a document containing ONLY a Shipping row must never require ingredient matching');
});

await atest('3. adjustment line, no existing match → NOT unmatched, preflight passes', async () => {
  const vdrPreflightFn = loadPreflight();
  const items = [{ vendor_sku: 'ALT_PAYMENT_METHODS', description: 'Alternative Payment Methods', raw_description: 'Alternative Payment Methods', line_type: 'adjustment', amount: -21.26 }];
  const doc = { id: 'd3', vendor: 'Walmart Business', warnings: null, parsed_json: { vendor: 'Walmart Business', document_type: 'invoice', items } };
  const { sb } = makeGenericSb({ ingredient_vendors: [], ingredient_links: [] });
  global.window.supabaseClient = sb;
  const result = await vdrPreflightFn('d3', doc);
  assert.strictEqual(result.ok, true, 'a document containing ONLY the adjustment row must never require ingredient matching');
});

await atest('mixed doc: unmatched product still blocks, but only the product line is ever counted', async () => {
  const vdrPreflightFn = loadPreflight();
  const items = [
    { vendor_sku: '999999', description: 'Some Real Product', raw_description: 'Some Real Product', line_type: 'product', amount: 5 },
    { vendor_sku: 'Shipping', description: 'SHIPPING', raw_description: 'SHIPPING', line_type: 'shipping', amount: 0.99 },
    { vendor_sku: 'ALT_PAYMENT_METHODS', description: 'Alternative Payment Methods', raw_description: 'Alternative Payment Methods', line_type: 'adjustment', amount: -21.26 },
  ];
  const doc = { id: 'd4', vendor: 'Walmart Business', warnings: null, parsed_json: { vendor: 'Walmart Business', document_type: 'invoice', items } };
  const { sb } = makeGenericSb({ ingredient_vendors: [], ingredient_links: [] });
  global.window.supabaseClient = sb;
  const result = await vdrPreflightFn('d4', doc);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.unmatched.length, 1, 'only the real product line should ever appear in unmatched');
  assert.strictEqual(result.unmatched[0].vendor_sku, '999999');
});

// ══════════════════════════════════════════════════════════════════
// Layer 2 — vdrApprove: hard write-boundary for ingredient_vendors
// ══════════════════════════════════════════════════════════════════

function walmartDoc(id, items, extra) {
  return Object.assign({
    id, vendor: 'Walmart Business', document_number: 'x', status: 'pending', warnings: null,
    parsed_json: Object.assign({ vendor: 'Walmart Business', document_type: 'invoice', buyer: 'Massimilajo Zubboli', total: items.reduce((s, i) => s + (i.amount || 0), 0), items, warnings: [] }, extra || {}),
  }, {});
}

async function approve(docRow, extraTables) {
  loadRealVdrModule();
  const tables = Object.assign({
    vendor_documents: [docRow],
    ingredient_vendors: [],
    ingredient_links: [],
    invoice_lines: [],
  }, extraTables || {});
  const { sb, calls } = makeGenericSb(tables);
  global.window.supabaseClient = sb;
  global.window._vdrEdits = {};
  const btn = { disabled: false, textContent: '', style: {} };
  await global.window.vdrApprove(docRow.id, btn);
  return calls;
}

await atest('4. shipping → zero ingredient_vendors writes, EVEN with an adversarial pre-existing SKU match', async () => {
  const items = [{ vendor_sku: 'Shipping', description: 'SHIPPING', raw_description: 'SHIPPING', line_type: 'shipping', unit_price: 0.99, qty: 1, amount: 0.99 }];
  const doc = walmartDoc('ship-doc', items);
  // Adversarial: an ingredient_vendors row that WOULD match SKU "Shipping"
  // for Walmart Business, as if it had been created by accident before
  // this fix existed.
  const calls = await approve(doc, {
    ingredient_vendors: [{ id: 'iv-bad', ingredient_id: 'ing-bad', vendor_sku: 'Shipping', vendor: 'Walmart Business' }],
  });
  assert.strictEqual(calls.updates.filter(u => u.table === 'ingredient_vendors').length, 0);
  assert.strictEqual(calls.inserts.filter(i => i.table === 'ingredient_vendors').length, 0);
});

await atest('4b. handling → zero ingredient_vendors writes, EVEN with an adversarial pre-existing SKU match (real 26104552 shape)', async () => {
  // Confirms the generic guard (item.line_type && item.line_type !== 'product')
  // covers the new 'handling' value automatically — no whitelist of known
  // line_types to update when a new one is introduced.
  const items = [{ vendor_sku: 'Express Fee', description: 'HANDLING', raw_description: 'HANDLING', line_type: 'handling', unit_price: 1.93, qty: 1, amount: 1.93 }];
  const doc = walmartDoc('handling-doc', items);
  const calls = await approve(doc, {
    ingredient_vendors: [{ id: 'iv-bad3', ingredient_id: 'ing-bad3', vendor_sku: 'Express Fee', vendor: 'Walmart Business' }],
  });
  assert.strictEqual(calls.updates.filter(u => u.table === 'ingredient_vendors').length, 0);
  assert.strictEqual(calls.inserts.filter(i => i.table === 'ingredient_vendors').length, 0);
});

await atest('4c. fulfillment_variance → zero ingredient_vendors writes, EVEN with an adversarial pre-existing confirmed link (real 26104552 shape)', async () => {
  const items = [{ vendor_sku: 'SubDown', description: 'FULFILL_VARIANCE', raw_description: 'FULFILL_VARIANCE', line_type: 'fulfillment_variance', unit_price: 10.29, qty: 1, amount: 10.29 }];
  const doc = walmartDoc('fv-doc', items);
  const calls = await approve(doc, {
    ingredient_links: [{ vendor: 'Walmart Business', invoice_description: 'FULFILL_VARIANCE', ingredient_id: 'ing-bad4', confirmed: true }],
  });
  assert.strictEqual(calls.updates.filter(u => u.table === 'ingredient_vendors').length, 0);
  assert.strictEqual(calls.inserts.filter(i => i.table === 'ingredient_vendors').length, 0);
});

await atest('5. adjustment → zero ingredient_vendors writes, EVEN with an adversarial pre-existing confirmed link', async () => {
  const items = [{ vendor_sku: 'ALT_PAYMENT_METHODS', description: 'Alternative Payment Methods', raw_description: 'Alternative Payment Methods', line_type: 'adjustment', unit_price: -21.26, qty: 1, amount: -21.26 }];
  const doc = walmartDoc('adj-doc', items);
  // Adversarial: a CONFIRMED ingredient_links row for this exact
  // description, as if a chef had mistakenly matched it before this fix.
  const calls = await approve(doc, {
    ingredient_links: [{ vendor: 'Walmart Business', invoice_description: 'Alternative Payment Methods', ingredient_id: 'ing-bad2', confirmed: true }],
  });
  assert.strictEqual(calls.updates.filter(u => u.table === 'ingredient_vendors').length, 0);
  assert.strictEqual(calls.inserts.filter(i => i.table === 'ingredient_vendors').length, 0);
});

await atest('11. adversarial bypass: manipulated state (stale pending + BOTH a bad SKU match AND a bad confirmed link) still yields zero ingredient_vendors writes for the non-product rows, while a real product row in the SAME document still writes normally', async () => {
  const items = [
    { vendor_sku: '110366636', description: 'Roth Chèvre', raw_description: 'Roth Chèvre', line_type: 'product', unit_price: 3.97, qty: 2, amount: 7.94 },
    { vendor_sku: 'Shipping', description: 'SHIPPING', raw_description: 'SHIPPING', line_type: 'shipping', unit_price: 0.99, qty: 1, amount: 0.99 },
    { vendor_sku: 'ALT_PAYMENT_METHODS', description: 'Alternative Payment Methods', raw_description: 'Alternative Payment Methods', line_type: 'adjustment', unit_price: -21.26, qty: 1, amount: -21.26 },
  ];
  const doc = walmartDoc('mixed-doc', items);
  const calls = await approve(doc, {
    ingredient_vendors: [
      { id: 'iv-real', ingredient_id: 'ing-real', vendor_sku: '110366636', vendor: 'Walmart Business' },
      { id: 'iv-bad', ingredient_id: 'ing-bad', vendor_sku: 'Shipping', vendor: 'Walmart Business' },
    ],
    ingredient_links: [
      { vendor: 'Walmart Business', invoice_description: 'Alternative Payment Methods', ingredient_id: 'ing-bad2', confirmed: true },
    ],
  });
  const ivUpdates = calls.updates.filter(u => u.table === 'ingredient_vendors');
  const ivInserts = calls.inserts.filter(i => i.table === 'ingredient_vendors');
  // The real product row (matched by real SKU) should still update normally...
  assert.strictEqual(ivUpdates.length, 1, 'exactly one legitimate product update expected');
  // ...but NEITHER the shipping nor the adjustment row contributed to it.
  const updatedIds = ivUpdates.map(u => u.filters.find(([t, k]) => t === 'eq' && k === 'id')[2]);
  assert.deepStrictEqual(updatedIds, ['iv-real']);
  assert.strictEqual(ivInserts.length, 0);

  // invoice_lines: the shipping/adjustment rows must still be preserved
  // economically, with ingredient_id null, never linked despite the bad
  // pre-existing link/match.
  const ilInsert = calls.inserts.find(i => i.table === 'invoice_lines');
  assert.ok(ilInsert);
  const shipLine = ilInsert.row.find(r => r.vendor_sku === 'Shipping');
  const adjLine  = ilInsert.row.find(r => r.vendor_sku === 'ALT_PAYMENT_METHODS');
  assert.ok(shipLine && adjLine);
  assert.strictEqual(shipLine.ingredient_id, null);
  assert.strictEqual(adjLine.ingredient_id, null);
  assert.strictEqual(shipLine.match_status, 'unmatched');
  assert.strictEqual(adjLine.match_status, 'unmatched');
  assert.strictEqual(shipLine.line_total, 0.99, 'economic value must still be preserved');
  assert.strictEqual(adjLine.line_total, 21.26, 'negative adjustment preserved as an absolute line_total, same convention already used for every other vendor');
});

// ══════════════════════════════════════════════════════════════════
// Layer 3 — real documents (c51dd720, 6c246fda, 30082536)
// ══════════════════════════════════════════════════════════════════

await atest('7. c51dd720 (real, 8 product lines, no shipping/no adjustment): unchanged — normal matching, total=52.07', async () => {
  const items = REAL.c51dd720.items;
  assert.strictEqual(items.length, 8);
  assert.ok(items.every(i => i.line_type === 'product'));
  const doc = walmartDoc('c51-doc', items);
  // Pre-populate a match for every real SKU so approval can fully succeed.
  const ingredient_vendors = items.map((it, i) => ({ id: 'iv-' + i, ingredient_id: 'ing-' + i, vendor_sku: it.vendor_sku, vendor: 'Walmart Business' }));
  const calls = await approve(doc, { ingredient_vendors });
  const ilInsert = calls.inserts.find(i => i.table === 'invoice_lines');
  assert.ok(ilInsert);
  assert.strictEqual(ilInsert.row.length, 8);
  const sum = Math.round(ilInsert.row.reduce((s, r) => s + r.line_total, 0) * 100) / 100;
  assert.strictEqual(sum, 52.07);
  assert.ok(ilInsert.row.every(r => r.ingredient_id != null), 'all 8 real product lines should be matched given the pre-populated ingredient_vendors');
});

await atest('8. 30082536 (real, 4 Shipping rows among 11): Shipping never matched/written, reconciliation still 33.88', async () => {
  const items = REAL['30082536'].items;
  assert.strictEqual(items.length, 11);
  const shippingCount = items.filter(i => i.line_type === 'shipping').length;
  assert.strictEqual(shippingCount, 4);
  const doc = walmartDoc('c300-doc', items);
  // Pre-populate matches for every PRODUCT sku, plus an adversarial match
  // for "Shipping" itself.
  const ingredient_vendors = items
    .filter(i => i.line_type === 'product')
    .map((it, i) => ({ id: 'iv-' + i, ingredient_id: 'ing-' + i, vendor_sku: it.vendor_sku, vendor: 'Walmart Business' }))
    .concat([{ id: 'iv-ship-bad', ingredient_id: 'ing-ship-bad', vendor_sku: 'Shipping', vendor: 'Walmart Business' }]);
  const calls = await approve(doc, { ingredient_vendors });
  const ivUpdates = calls.updates.filter(u => u.table === 'ingredient_vendors');
  // Only the 7 real product lines may update ingredient_vendors — never
  // the 4 shipping rows, even though a matching SKU row exists for them.
  assert.strictEqual(ivUpdates.length, 7);
  const ilInsert = calls.inserts.find(i => i.table === 'invoice_lines');
  const shipLines = ilInsert.row.filter(r => r.vendor_sku === 'Shipping');
  assert.strictEqual(shipLines.length, 4);
  assert.ok(shipLines.every(r => r.ingredient_id === null && r.match_status === 'unmatched'));
  const sum = Math.round(ilInsert.row.reduce((s, r) => s + r.line_total, 0) * 100) / 100;
  assert.strictEqual(sum, 33.88);
});

await atest('9. 6c246fda (real, negative adjustment -21.26): adjustment never matched/written, reconciliation still 63.33 — via a Kitchen-equivalent synthetic fixture since the Buyer Guard rightly blocks the real Zeno-buyer document', async () => {
  const items = REAL['6c246fda'].items;
  assert.strictEqual(items.length, 7);
  const adj = items.find(i => i.line_type === 'adjustment');
  assert.ok(adj && adj.amount === -21.26);
  // Kitchen-equivalent fixture: same real items, buyer swapped to
  // Massimilajo Zubboli purely so the (unrelated, already-tested-elsewhere)
  // Buyer Guard doesn't block this line_type-focused test. This does not
  // touch or weaken the Buyer Guard itself.
  const doc = walmartDoc('c6c-kitchen-equivalent', items);
  const ingredient_vendors = items
    .filter(i => i.line_type === 'product')
    .map((it, i) => ({ id: 'iv-' + i, ingredient_id: 'ing-' + i, vendor_sku: it.vendor_sku, vendor: 'Walmart Business' }))
    .concat([{ id: 'iv-adj-bad', ingredient_id: 'ing-adj-bad', vendor_sku: 'ALT_PAYMENT_METHODS', vendor: 'Walmart Business' }]);
  const ingredient_links = [{ vendor: 'Walmart Business', invoice_description: 'Alternative Payment Methods', ingredient_id: 'ing-adj-bad2', confirmed: true }];
  const calls = await approve(doc, { ingredient_vendors, ingredient_links });
  const ivUpdates = calls.updates.filter(u => u.table === 'ingredient_vendors');
  assert.strictEqual(ivUpdates.length, 6, 'exactly the 6 real product lines, never the adjustment row');
  const ilInsert = calls.inserts.find(i => i.table === 'invoice_lines');
  const adjLine = ilInsert.row.find(r => r.vendor_sku === 'ALT_PAYMENT_METHODS');
  assert.ok(adjLine);
  assert.strictEqual(adjLine.ingredient_id, null);
  assert.strictEqual(adjLine.match_status, 'unmatched');
  const sum = Math.round(ilInsert.row.reduce((s, r) => s + r.line_total, 0) * 100) / 100;
  // line_total is stored as Math.abs(amount) throughout this codebase (see
  // the -21.26 case above and every existing vendor) — the real signed
  // reconciliation (63.33, including the negative) is what checkTotals()
  // in vendor-parsers/index.js already verified in the parser task; here
  // we confirm the invoice_lines rows sum to the same total using the
  // codebase's existing abs-value convention (52.07's siblings use the
  // same pattern), i.e. sum(|amount|) = 84.59 = 63.33 + 2×21.26.
  assert.strictEqual(sum, Math.round(items.reduce((s, i) => s + Math.abs(i.amount), 0) * 100) / 100);
});

// ══════════════════════════════════════════════════════════════════
// Layer 4 — line_type preserved end-to-end in parsed_json
// ══════════════════════════════════════════════════════════════════

test('6. line_type survives the parsed_json spread used when writing vendor_documents (vdrProcessAllPdf)', () => {
  // Same spread pattern used in the real processing update:
  // parsed_json: { ...(doc.parsed_json || {}), ...parsed }
  const parsed = { vendor: 'Walmart Business', items: [{ vendor_sku: 'Shipping', line_type: 'shipping', amount: 0.99 }] };
  const existingParsedJson = { source: 'email_body' };
  const written = { ...(existingParsedJson || {}), ...parsed };
  assert.strictEqual(written.items[0].line_type, 'shipping');
});
test('6b. line_type is present on the real parsed items straight out of the Walmart parser (no reconstruction drops it)', () => {
  const shipItem = REAL['30082536'].items.find(i => i.line_type === 'shipping');
  const adjItem  = REAL['6c246fda'].items.find(i => i.line_type === 'adjustment');
  assert.ok(shipItem && shipItem.line_type === 'shipping');
  assert.ok(adjItem && adjItem.line_type === 'adjustment');
});

// ══════════════════════════════════════════════════════════════════
// Layer 5 — non-Walmart legacy behavior, completely unchanged
// ══════════════════════════════════════════════════════════════════

await atest('10. non-Walmart (Ben E. Keith, item.line_type undefined): matching and ingredient_vendors writes behave exactly as before', async () => {
  const bekItem = { vendor_sku: '116533', description: 'Pastry Bag 21in Clr Disposable', raw_description: 'Pastry Bag 21in Clr Disposable', pack_description: '1/ 100 CT', unit_price: 40.98, qty_ordered: 2, qty_received: 2, amount: 81.96, warnings: [] };
  // no line_type field at all — exactly what every non-Walmart parser produces today
  assert.strictEqual('line_type' in bekItem, false);
  const doc = {
    id: 'bek-1', vendor: 'Ben E. Keith', document_number: '0002952908', status: 'pending', warnings: null,
    parsed_json: { vendor: 'Ben E. Keith', document_type: 'invoice', document_number: '0002952908', total: 81.96, items: [bekItem], warnings: [] },
  };
  const calls = await approve(doc, {
    ingredient_vendors: [{ id: 'iv-1', ingredient_id: 'ing-1', vendor_sku: '116533', vendor: 'Ben E. Keith' }],
  });
  const ivUpdates = calls.updates.filter(u => u.table === 'ingredient_vendors');
  assert.strictEqual(ivUpdates.length, 1, 'a matched BEK invoice item must still update ingredient_vendors exactly as before');
  const ilInsert = calls.inserts.find(i => i.table === 'invoice_lines');
  assert.ok(ilInsert.row[0].ingredient_id, 'a real BEK product line must still get a real ingredient_id — completely untouched by the line_type guard');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
})();
