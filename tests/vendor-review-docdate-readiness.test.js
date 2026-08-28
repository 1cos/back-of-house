// ══════════════════════════════════════════════════════════════════
// vendor-documents-review.js — DOC DATE fix + truthful readiness state
// Plain Node, zero external deps beyond jsdom: `node tests/vendor-review-docdate-readiness.test.js`
//
// Part B: docDate fallback chain never checked parsed.invoice_date — the
// only field name the Walmart parser (Node + browser) returns its date
// under, unlike every other live browser parser which already resolves
// through order_date/delivery_date/document_date. Confirmed via real
// production data before fixing: Fruge Seafood invoices (39/39 real
// rows) already have document_date populated, because the LIVE browser
// Fruge parser aliases to document_date — diverging from the Node copy's
// invoice_date, a pre-existing, unrelated drift left untouched here.
//
// Part C: the document-list card badge ("Ready to approve" / "Needs
// matching" / "N questions") is computed once per vdrLoad() call via a
// single batched query per vendor (never per-card / N+1), mirroring
// vdrPreflight's exact matching logic so the two can never disagree.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const VDR_JS = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');
const vdrSrc = fs.readFileSync(VDR_JS, 'utf8');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }
async function atest(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }

console.log('\nDOC DATE fix + truthful readiness state — regression tests\n');

// ══════════════════════════════════════════════════════════════════
// Part B — docDate fallback chain
// ══════════════════════════════════════════════════════════════════

// Extract the REAL live expression, not a hand-copy — evaluated against
// various vendor-shaped parsed objects below.
const docDateMatch = vdrSrc.match(/const docDate\s*=\s*(.+?);/);
assert.ok(docDateMatch, 'docDate fallback-chain line not found — source may have changed');
const docDateExpr = docDateMatch[1];
function computeDocDate(parsed) {
  return new Function('parsed', 'return ' + docDateExpr + ';')(parsed);
}

test('B1: Walmart-shaped parsed (invoice_date only) -> docDate resolves to invoice_date', () => {
  assert.strictEqual(computeDocDate({ invoice_date: '2026-08-27' }), '2026-08-27');
});
test('B2: real 26104552 shape (invoice_date=2026-08-27, no other date field) -> 2026-08-27', () => {
  assert.strictEqual(computeDocDate({ vendor: 'Walmart Business', invoice_date: '2026-08-27', due_date: '2026-09-25' }), '2026-08-27');
});
test('B3: real c51dd720 shape -> 2026-08-26', () => {
  assert.strictEqual(computeDocDate({ vendor: 'Walmart Business', invoice_date: '2026-08-26' }), '2026-08-26');
});
test('B4: no date field at all -> null (unchanged legacy behavior)', () => {
  assert.strictEqual(computeDocDate({}), null);
});

test('B5: non-regression — order_date still wins over invoice_date when both present (existing precedence unchanged)', () => {
  assert.strictEqual(computeDocDate({ order_date: '2026-01-01', invoice_date: '2026-02-02' }), '2026-01-01');
});
test('B6: non-regression — credit_date still wins over invoice_date', () => {
  assert.strictEqual(computeDocDate({ credit_date: '2026-01-15', invoice_date: '2026-02-02' }), '2026-01-15');
});
test('B7: non-regression — delivery_date still wins over invoice_date', () => {
  assert.strictEqual(computeDocDate({ delivery_date: '2026-01-20', invoice_date: '2026-02-02' }), '2026-01-20');
});
test('B8: non-regression — document_date (Fruge/BEK/browser shape) still wins over invoice_date', () => {
  assert.strictEqual(computeDocDate({ document_date: '2026-01-25', invoice_date: '2026-02-02' }), '2026-01-25');
});
test('B9: non-regression — precedence order preserved end-to-end (order > credit > delivery > document > invoice)', () => {
  assert.strictEqual(computeDocDate({ order_date: 'A', credit_date: 'B', delivery_date: 'C', document_date: 'D', invoice_date: 'E' }), 'A');
  assert.strictEqual(computeDocDate({ credit_date: 'B', delivery_date: 'C', document_date: 'D', invoice_date: 'E' }), 'B');
  assert.strictEqual(computeDocDate({ delivery_date: 'C', document_date: 'D', invoice_date: 'E' }), 'C');
  assert.strictEqual(computeDocDate({ document_date: 'D', invoice_date: 'E' }), 'D');
  assert.strictEqual(computeDocDate({ invoice_date: 'E' }), 'E');
});

// The "second point" from the prior audit turned out, on precise
// re-reading, to be a deliberate REUSE of the already-saved column
// (doc.document_date), not an independent fallback-chain computation —
// its own comment explains why duplicating the chain there would be
// wrong. Confirms that design is still in place, unmodified, rather than
// asserting a code change that was never actually needed.
test('structural: vdrApprove still reuses the already-saved document_date column rather than re-deriving it from parsed_json', () => {
  assert.ok(vdrSrc.includes('const invoiceDate = doc.document_date || null;'),
    'vdrApprove must keep reusing doc.document_date, guaranteeing it matches the value this same docDate fix now populates correctly — no second fallback chain to keep in sync');
});

// ══════════════════════════════════════════════════════════════════
// Part C — batched match-status computation (vdrComputeMatchStatus)
// ══════════════════════════════════════════════════════════════════

const MATCH_START = '// ── MARKER:VDR_MATCH_STATUS_START ───────────────────────────────────';
const MATCH_END   = '// ── MARKER:VDR_MATCH_STATUS_END ─────────────────────────────────────';
const matchBlock = vdrSrc.slice(vdrSrc.indexOf(MATCH_START), vdrSrc.indexOf(MATCH_END));
assert.ok(matchBlock.length > 100, 'match-status markers not found — source may have changed');
const { vdrComputeMatchStatus } = new Function(matchBlock + '\nreturn { vdrComputeMatchStatus };')();

function makeSb(tables) {
  const calls = [];
  function builder(tableName) {
    const state = { filters: [] };
    const b = {
      select() { return b; },
      eq(k, v) { state.filters.push(['eq', k, v]); return b; },
      in(k, values) { state.filters.push(['in', k, values]); return b; },
      then(resolve) {
        calls.push({ table: tableName, filters: state.filters.slice() });
        let rows = (tables[tableName] || []).slice();
        for (const [type, k, v] of state.filters) {
          if (type === 'eq') rows = rows.filter(r => r[k] === v);
          if (type === 'in') rows = rows.filter(r => Array.isArray(v) && v.includes(r[k]));
        }
        resolve({ data: rows, error: null });
      },
    };
    return b;
  }
  return { sb: { from: builder }, calls };
}

function walmartDoc(id, buyer, items) {
  return { id, document_type: 'invoice', parsed_json: { vendor: 'Walmart Business', buyer, items } };
}

(async () => {

await atest('C1: product line with NO matching ingredient_vendors row -> needsMatching = true', async () => {
  const doc = walmartDoc('d1', 'Massimilajo Zubboli', [{ vendor_sku: '110366636', description: 'Roth Chèvre', line_type: 'product', amount: 7.94 }]);
  const { sb } = makeSb({ ingredient_vendors: [], ingredient_links: [] });
  const status = await vdrComputeMatchStatus(sb, [doc]);
  assert.strictEqual(status['d1'].needsMatching, true);
  assert.strictEqual(status['d1'].unmatchedCount, 1);
});

await atest('C2: product line WITH a matching ingredient_vendors row -> needsMatching = false', async () => {
  const doc = walmartDoc('d2', 'Massimilajo Zubboli', [{ vendor_sku: '110366636', description: 'Roth Chèvre', line_type: 'product', amount: 7.94 }]);
  const { sb } = makeSb({
    ingredient_vendors: [{ vendor_sku: '110366636', vendor: 'Walmart Business' }],
    ingredient_links: [],
  });
  const status = await vdrComputeMatchStatus(sb, [doc]);
  assert.strictEqual(status['d2'].needsMatching, false);
});

await atest('C3 (Part D): shipping/adjustment/handling/fulfillment_variance rows never count toward "needs matching"', async () => {
  const doc = walmartDoc('d3', 'Massimilajo Zubboli', [
    { vendor_sku: 'Shipping', description: 'SHIPPING', line_type: 'shipping', amount: 0.99 },
    { vendor_sku: 'ALT_PAYMENT_METHODS', description: 'Alternative Payment Methods', line_type: 'adjustment', amount: -21.26 },
    { vendor_sku: 'Express Fee', description: 'HANDLING', line_type: 'handling', amount: 1.93 },
    { vendor_sku: 'SubDown', description: 'FULFILL_VARIANCE', line_type: 'fulfillment_variance', amount: 10.29 },
  ]);
  const { sb } = makeSb({ ingredient_vendors: [], ingredient_links: [] });
  const status = await vdrComputeMatchStatus(sb, [doc]);
  assert.strictEqual(status['d3'].needsMatching, false, 'a document with ONLY non-product rows must never need matching');
});

await atest('C4: mixed document — only the real product line counts, non-product rows ignored', async () => {
  const doc = walmartDoc('d4', 'Massimilajo Zubboli', [
    { vendor_sku: '999999', description: 'Some Real Product', line_type: 'product', amount: 5 },
    { vendor_sku: 'Shipping', description: 'SHIPPING', line_type: 'shipping', amount: 0.99 },
  ]);
  const { sb } = makeSb({ ingredient_vendors: [], ingredient_links: [] });
  const status = await vdrComputeMatchStatus(sb, [doc]);
  assert.strictEqual(status['d4'].needsMatching, true);
  assert.strictEqual(status['d4'].unmatchedCount, 1, 'only the product row, never the shipping row, counts');
});

await atest('C5: non-invoice document_type (e.g. order_confirmation) never needs matching', async () => {
  const doc = { id: 'd5', document_type: 'order_confirmation', parsed_json: { vendor: 'Ben E. Keith', items: [{ vendor_sku: 'x', description: 'y', amount: 1 }] } };
  const { sb } = makeSb({ ingredient_vendors: [], ingredient_links: [] });
  const status = await vdrComputeMatchStatus(sb, [doc]);
  assert.strictEqual(status['d5'].needsMatching, false);
});

await atest('C6: real 3 Walmart Kitchen documents — all "Needs matching" today (zero ingredient_vendors for Walmart Business)', async () => {
  const c51 = walmartDoc('c51', 'Massimilajo Zubboli', Array.from({ length: 8 }, (_, i) => ({ vendor_sku: 'sku' + i, description: 'd' + i, line_type: 'product', amount: 1 })));
  const doc69 = walmartDoc('69', 'Massimilajo Zubboli', Array.from({ length: 7 }, (_, i) => ({ vendor_sku: 'sku69_' + i, description: 'd' + i, line_type: 'product', amount: 1 })));
  const doc26 = walmartDoc('26', 'Massimilajo Zubboli', [
    ...Array.from({ length: 18 }, (_, i) => ({ vendor_sku: 'sku26_' + i, description: 'd' + i, line_type: 'product', amount: 1 })),
    { vendor_sku: 'Express Fee', description: 'HANDLING', line_type: 'handling', amount: 1.93 },
    { vendor_sku: 'SubDown', description: 'FULFILL_VARIANCE', line_type: 'fulfillment_variance', amount: 10.29 },
    { vendor_sku: 'SubDown', description: 'FULFILL_VARIANCE', line_type: 'fulfillment_variance', amount: 10.29 },
    { vendor_sku: 'SubDown', description: 'FULFILL_VARIANCE', line_type: 'fulfillment_variance', amount: 14.65 },
    { vendor_sku: 'SubDown', description: 'FULFILL_VARIANCE', line_type: 'fulfillment_variance', amount: 14.65 },
    { vendor_sku: 'ALT_PAYMENT_METHODS', description: 'Alternative Payment Methods', line_type: 'adjustment', amount: -49.88 },
  ]);
  const { sb } = makeSb({ ingredient_vendors: [], ingredient_links: [] }); // real DB state today
  const status = await vdrComputeMatchStatus(sb, [c51, doc69, doc26]);
  assert.strictEqual(status['c51'].needsMatching, true);
  assert.strictEqual(status['c51'].unmatchedCount, 8);
  assert.strictEqual(status['69'].needsMatching, true);
  assert.strictEqual(status['69'].unmatchedCount, 7);
  assert.strictEqual(status['26'].needsMatching, true);
  assert.strictEqual(status['26'].unmatchedCount, 18, 'exactly the 18 real product lines, never the 6 non-product rows');
});

await atest('C7: batched, not N+1 — one ingredient_vendors query per distinct vendor, not one per document', async () => {
  const docs = [
    walmartDoc('a', 'x', [{ vendor_sku: 'sku1', description: 'd1', line_type: 'product', amount: 1 }]),
    walmartDoc('b', 'x', [{ vendor_sku: 'sku2', description: 'd2', line_type: 'product', amount: 1 }]),
    walmartDoc('c', 'x', [{ vendor_sku: 'sku3', description: 'd3', line_type: 'product', amount: 1 }]),
  ];
  const { sb, calls } = makeSb({ ingredient_vendors: [], ingredient_links: [] });
  await vdrComputeMatchStatus(sb, docs);
  const ivCalls = calls.filter(c => c.table === 'ingredient_vendors');
  assert.strictEqual(ivCalls.length, 1, '3 documents, same vendor -> exactly 1 batched query, not 3');
});

test('C8: card badge logic — structural confirmation the three states are distinguished (question > ready-with-unmatched > fully ready)', () => {
  // FIX (deferred matching task, Part D): the badge no longer implies an
  // unmatched invoice is blocked — reworded from "🔗 Needs matching" to
  // "✓ Ready — N unmatched", same positive tone as "Ready to approve".
  assert.ok(vdrSrc.includes('unmatchedCount'), 'vdrCardHTML must reference the precomputed unmatched count');
  assert.ok(!vdrSrc.slice(vdrSrc.indexOf('function vdrCardHTML')).includes('🔗 Needs matching'), 'the old blocking-sounding wording must be gone');
  const cardFn = vdrSrc.slice(vdrSrc.indexOf('function vdrCardHTML'));
  const qBadgeBlock = cardFn.slice(cardFn.indexOf('const qBadge'), cardFn.indexOf('const qBadge') + 900);
  assert.ok(qBadgeBlock.includes('Ready — ${unmatchedCount} unmatched'), 'the new wording must exist');
  assert.ok(/qCount > 0[\s\S]*?unmatchedCount > 0[\s\S]*?Ready to approve/.test(qBadgeBlock),
    'priority order must be: blocking questions first, then ready-with-unmatched-count, then fully ready');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
})();
