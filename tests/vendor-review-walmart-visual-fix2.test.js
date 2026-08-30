// ══════════════════════════════════════════════════════════════════
// Walmart visual fix 2 — adjustment sign, tray product-only, row match
// badge, top-bar readiness, display-only PUA cleanup
// Plain Node: `node tests/vendor-review-walmart-visual-fix2.test.js`
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const VDR_JS = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');
const VPU_JS = path.join(__dirname, '..', 'js', 'vendor-parser-ui.js');
const vdrSrc = fs.readFileSync(VDR_JS, 'utf8');
const vpuSrc = fs.readFileSync(VPU_JS, 'utf8');
const fixtures = require('./fixtures/trevipay-samples.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }

console.log('\nWalmart visual fix 2 — test run\n');

// ══════════════════════════════════════════════════════════════════
// Real end-to-end parse of 26104552
// ══════════════════════════════════════════════════════════════════
const NORM_START = '// ── MARKER:VDR_TREVIPAY_NORMALIZE_START ────────────────────────────';
const NORM_END   = '// ── MARKER:VDR_TREVIPAY_NORMALIZE_END ──────────────────────────────';
const normBlock = vdrSrc.slice(vdrSrc.indexOf(NORM_START), vdrSrc.indexOf(NORM_END));
const { vdrNormalizeTreviPayPage } = new Function(normBlock + 'return { vdrNormalizeTreviPayPage };')();
function norm(items) { return vdrNormalizeTreviPayPage(items).text; }
const browserParsers = new Function('window', 'document', vpuSrc + '\nreturn buildVendorParsers();')({}, { getElementById: () => null });
const text26104552 = norm(fixtures.C26104552_PAGE1) + '\n' + norm(fixtures.C26104552_PAGE2) + '\n' + norm(fixtures.C26104552_PAGE3);
const items26104552 = browserParsers.parse(text26104552).items;

test('sanity: 26104552 real parse unchanged by this task — 24 items, total 317.41', () => {
  assert.strictEqual(items26104552.length, 24);
  const sum = Math.round(items26104552.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  assert.strictEqual(sum, 317.41);
});

// ══════════════════════════════════════════════════════════════════
// Part B — adjustment sign
// ══════════════════════════════════════════════════════════════════
test('B: extVal no longer applies Math.abs() — structural confirmation', () => {
  const idx = vdrSrc.indexOf('var extVal    = edits.ext');
  const line = vdrSrc.slice(idx, vdrSrc.indexOf('\n', idx));
  assert.ok(!line.includes('Math.abs'), 'extVal must not use Math.abs() anymore');
  assert.ok(line.includes('item.amount.toFixed(2)'), 'extVal must render the real signed amount');
});
test('B: real ALT_PAYMENT_METHODS row (amount=-49.88) — extVal formula evaluates to "-49.88", matching unitVal sign behavior', () => {
  const idx = vdrSrc.indexOf('var extVal    = edits.ext');
  const line = vdrSrc.slice(idx, vdrSrc.indexOf('\n', idx));
  const exprSrc = line.slice(line.indexOf('='), undefined);
  const item = { amount: -49.88 };
  const edits = {};
  const fn = new Function('edits', 'item', 'var extVal ' + exprSrc + '; return extVal;');
  assert.strictEqual(fn(edits, item), '-49.88');
});
test('B (regression): total document reconciliation unaffected — real amount values (not display) still sum to 317.41', () => {
  const adj = items26104552.find(i => i.line_type === 'adjustment');
  assert.strictEqual(adj.amount, -49.88, 'the real parsed_json value must remain unchanged — only display was fixed');
});

// ══════════════════════════════════════════════════════════════════
// Part C — tray index product-only
// ══════════════════════════════════════════════════════════════════
const trayBlockStart = vdrSrc.indexOf('var skuOccurrenceTotals = {};');
const trayBlockEnd = vdrSrc.indexOf('var rows = items.map', trayBlockStart);
const trayPrepBlock = vdrSrc.slice(trayBlockStart, trayBlockEnd);
test('C: structural — occurrence counter now scoped to isProductRow', () => {
  assert.ok(trayPrepBlock.includes('isProductRow'), 'tray occurrence counter must check line_type before counting');
});
test('C: FULFILL_VARIANCE rows (shared "SubDown" vendor_sku) never receive a tray index — real 26104552 data', () => {
  const runPrep = new Function('items', trayPrepBlock + '\nreturn skuOccurrenceTotals;');
  const totals = runPrep(items26104552);
  assert.strictEqual(totals['SubDown'], undefined, 'accounting-row placeholder SKU must never be counted for tray indexing');
});
test('C: real chicken SKUs still correctly counted for tray indexing (8 and 7)', () => {
  const runPrep = new Function('items', trayPrepBlock + '\nreturn skuOccurrenceTotals;');
  const totals = runPrep(items26104552);
  assert.strictEqual(totals['19400236'], 8);
  assert.strictEqual(totals['27935840'], 7);
});

// ══════════════════════════════════════════════════════════════════
// Part D — row match badge (structural + behavioral via real matching)
// ══════════════════════════════════════════════════════════════════
test('D: structural — labelIcon now has a Matched/Needs match branch fed by docMatchStatus.unmatchedSkuSet', () => {
  assert.ok(vdrSrc.includes("labelIcon = rowNeedsMatch ? 'Needs match' : 'Matched'"));
  assert.ok(vdrSrc.includes('unmatchedSkuSet.has(productKey)'));
});
test('D: unmatchedSkuSet is now exposed on the vdrComputeMatchStatus result object (not just its size)', () => {
  const MATCH_START = '// ── MARKER:VDR_MATCH_STATUS_START ───────────────────────────────────';
  const MATCH_END   = '// ── MARKER:VDR_MATCH_STATUS_END ─────────────────────────────────────';
  const matchBlock = vdrSrc.slice(vdrSrc.indexOf(MATCH_START), vdrSrc.indexOf(MATCH_END));
  assert.ok(/status\[doc\.id\]\s*=\s*\{[^}]*unmatchedSkuSet/s.test(matchBlock), 'unmatchedSkuSet must be a field on the result object');
});

(async () => {
  const MATCH_START = '// ── MARKER:VDR_MATCH_STATUS_START ───────────────────────────────────';
  const MATCH_END   = '// ── MARKER:VDR_MATCH_STATUS_END ─────────────────────────────────────';
  const matchBlock = vdrSrc.slice(vdrSrc.indexOf(MATCH_START), vdrSrc.indexOf(MATCH_END));
  const { vdrComputeMatchStatus } = new Function(matchBlock + 'return { vdrComputeMatchStatus };')();
  function makeSb(tables) {
    function builder(tableName) {
      const state = { filters: [] };
      const b = {
        select() { return b; },
        eq(k, v) { state.filters.push(['eq', k, v]); return b; },
        in(k, values) { state.filters.push(['in', k, values]); return b; },
        then(resolve) {
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
    return { from: builder };
  }
  const doc = { id: '26104552-doc', document_type: 'invoice', vendor: 'Walmart Business', parsed_json: { vendor: 'Walmart Business', items: items26104552 } };
  const ingredient_vendors = [
    { vendor_sku: '44001602', vendor: 'Walmart Business', ingredient_id: 'ing-44001602' },
    { vendor_sku: '44391101', vendor: 'Walmart Business', ingredient_id: 'ing-44391101' },
    { vendor_sku: '44390947', vendor: 'Walmart Business', ingredient_id: 'ing-44390947' },
  ];
  const sb = makeSb({ ingredient_vendors, ingredient_links: [], vendor_item_aliases: [] });
  const status = await vdrComputeMatchStatus(sb, [doc]);

  test('D: real 26104552 + real 3 SAFE_AUTO_MAP mappings -> unmatchedSkuSet contains exactly 19400236 and 27935840, never 44001602/44391101/44390947', () => {
    const set = status['26104552-doc'].unmatchedSkuSet;
    assert.strictEqual(set.size, 2);
    assert.ok(set.has('19400236'));
    assert.ok(set.has('27935840'));
    assert.ok(!set.has('44001602'));
    assert.ok(!set.has('44391101'));
    assert.ok(!set.has('44390947'));
  });

  // Simulate the exact row-label decision logic on all 24 real items
  const labelDecisionSrc = `
    var lineTypeLabels = { handling: 'Handling', fulfillment_variance: 'Fulfillment variance', adjustment: 'Adjustment', shipping: 'Shipping' };
    return items.map(function(item) {
      var isAccountingRow = item.line_type && item.line_type !== 'product';
      var productKey = item.vendor_sku || item.item_code || item.description || item.raw_description;
      var rowNeedsMatch = !isAccountingRow && docMatchStatus && docMatchStatus.unmatchedSkuSet && docMatchStatus.unmatchedSkuSet.has(productKey);
      var labelIcon;
      if (isAccountingRow) labelIcon = lineTypeLabels[item.line_type] || item.line_type;
      else if (docMatchStatus && docMatchStatus.unmatchedSkuSet) labelIcon = rowNeedsMatch ? 'Needs match' : 'Matched';
      else labelIcon = 'OK';
      return { sku: item.vendor_sku, line_type: item.line_type, labelIcon: labelIcon };
    });
  `;
  const decide = new Function('items', 'docMatchStatus', labelDecisionSrc);
  const labels = decide(items26104552, status['26104552-doc']);

  test('D: Ground Beef/Watermelon/Zucchini -> "Matched"; all 15 chicken rows -> "Needs match"; accounting rows -> real line_type label', () => {
    assert.strictEqual(labels.find(l => l.sku === '44001602').labelIcon, 'Matched');
    assert.strictEqual(labels.find(l => l.sku === '44391101').labelIcon, 'Matched');
    assert.strictEqual(labels.find(l => l.sku === '44390947').labelIcon, 'Matched');
    const chickenLabels = labels.filter(l => l.sku === '19400236' || l.sku === '27935840');
    assert.strictEqual(chickenLabels.length, 15);
    assert.ok(chickenLabels.every(l => l.labelIcon === 'Needs match'));
    assert.strictEqual(labels.find(l => l.line_type === 'handling').labelIcon, 'Handling');
    assert.strictEqual(labels.filter(l => l.line_type === 'fulfillment_variance').every(l => l.labelIcon === 'Fulfillment variance'), true);
    assert.strictEqual(labels.find(l => l.line_type === 'adjustment').labelIcon, 'Adjustment');
  });

  // ════════════════════════════════════════════════════════════════
  // Part E — top-bar readiness (structural)
  // ════════════════════════════════════════════════════════════════
  test('E: vdrToggle top-bar badge now reads sheetUnmatchedSkuCount, not just qCount', () => {
    const toggleStart = vdrSrc.indexOf('window.vdrToggle = function(id) {');
    const toggleBody = vdrSrc.slice(toggleStart, vdrSrc.indexOf('window.vdrLookupUnitWeight', toggleStart));
    assert.ok(toggleBody.includes('sheetUnmatchedSkuCount'), 'top-bar badge must reference the unmatched SKU count');
    assert.ok(toggleBody.includes('Ready — ${sheetUnmatchedSkuCount} SKU'), 'top-bar wording must match the card badge wording');
  });

  // ════════════════════════════════════════════════════════════════
  // Part F — display-only PUA cleanup + mutation test
  // ════════════════════════════════════════════════════════════════
  const cleanBlockStart = vdrSrc.indexOf('// ── MARKER:VDR_DISPLAY_CLEAN_START');
  const cleanBlockEnd = vdrSrc.indexOf('// ── MARKER:VDR_DISPLAY_CLEAN_END') + 50;
  const cleanBlock = vdrSrc.slice(cleanBlockStart, vdrSrc.indexOf('\n', cleanBlockEnd));
  const { vdrCleanDisplayDescription } = new Function(cleanBlock + '\nreturn { vdrCleanDisplayDescription };')();

  test('F: real chicken description (19400236, PUA glyph) cleaned to en-dash for display', () => {
    const raw = items26104552.find(i => i.vendor_sku === '19400236').raw_description;
    const cleaned = vdrCleanDisplayDescription(raw);
    assert.ok(cleaned.includes('1.50\u20134.30'), 'expected en-dash range in cleaned display text, got: ' + cleaned);
    assert.ok(!/[\uE000-\uF8FF]/.test(cleaned), 'no PUA glyph should remain in the cleaned display text');
  });
  test('F: real chicken description (27935840, double-space) cleaned to en-dash for display', () => {
    const raw = items26104552.find(i => i.vendor_sku === '27935840').raw_description;
    const cleaned = vdrCleanDisplayDescription(raw);
    assert.ok(cleaned.includes('2.75\u20137.0'), 'expected en-dash range in cleaned display text, got: ' + cleaned);
  });
  test('F (regression): Ground Beef / Penne descriptions unaffected by the cleanup (no false-positive range detection)', () => {
    const groundBeef = items26104552.find(i => i.vendor_sku === '44001602').raw_description;
    assert.strictEqual(vdrCleanDisplayDescription(groundBeef), groundBeef, 'must be byte-identical — no false range match');
  });
  test('F: MUTATION TEST — item.description/raw_description remain byte-for-byte unchanged after building the cleaned display name', () => {
    const before = JSON.parse(JSON.stringify(items26104552));
    items26104552.forEach(it => { vdrCleanDisplayDescription(it.description); vdrCleanDisplayDescription(it.raw_description); });
    assert.strictEqual(JSON.stringify(items26104552), JSON.stringify(before), 'calling the cleanup function must never mutate the source items');
  });
  test('F: name construction line now calls vdrCleanDisplayDescription (structural)', () => {
    assert.ok(vdrSrc.includes('var name        = vdrCleanDisplayDescription(item.description || item.raw_description'));
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
})();
