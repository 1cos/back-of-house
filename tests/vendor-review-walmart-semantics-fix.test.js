// ══════════════════════════════════════════════════════════════════
// Walmart semantics/UI fix — chicken range preserved, real counts,
// SKU-based unmatched, accounting line labels
// Plain Node: `node tests/vendor-review-walmart-semantics-fix.test.js`
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const VDR_JS = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');
const VPU_JS = path.join(__dirname, '..', 'js', 'vendor-parser-ui.js');
const WALMART_NODE_JS = path.join(__dirname, '..', 'js', 'vendor-parsers', 'walmart-trevipay-invoice.js');
const vdrSrc = fs.readFileSync(VDR_JS, 'utf8');
const vpuSrc = fs.readFileSync(VPU_JS, 'utf8');
const walmartNode = require(WALMART_NODE_JS);
const fixtures = require('./fixtures/trevipay-samples.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }

console.log('\nWalmart semantics/UI fix — chicken range + counts + SKU-unmatched — test run\n');

// ══════════════════════════════════════════════════════════════════
// Real end-to-end parse of 26104552 (both Node and browser)
// ══════════════════════════════════════════════════════════════════

const NORM_START = '// ── MARKER:VDR_TREVIPAY_NORMALIZE_START ────────────────────────────';
const NORM_END   = '// ── MARKER:VDR_TREVIPAY_NORMALIZE_END ──────────────────────────────';
const normBlock = vdrSrc.slice(vdrSrc.indexOf(NORM_START), vdrSrc.indexOf(NORM_END));
const { vdrNormalizeTreviPayPage } = new Function(normBlock + 'return { vdrNormalizeTreviPayPage };')();
function norm(items) { return vdrNormalizeTreviPayPage(items).text; }
const browserParsers = new Function('window', 'document', vpuSrc + '\nreturn buildVendorParsers();')({}, { getElementById: () => null });

const text26104552 = norm(fixtures.C26104552_PAGE1) + '\n' + norm(fixtures.C26104552_PAGE2) + '\n' + norm(fixtures.C26104552_PAGE3);
const browserResult = browserParsers.parse(text26104552);
const nodeResult = walmartNode.parse(text26104552);

// ── I: structured counts ──────────────────────────────────────────
test('I: 26104552 real parse — 24 structured rows, 18 product, 6 accounting, 5 distinct product SKU', () => {
  assert.strictEqual(browserResult.items.length, 24);
  const product = browserResult.items.filter(i => i.line_type === 'product');
  const accounting = browserResult.items.filter(i => i.line_type !== 'product');
  assert.strictEqual(product.length, 18);
  assert.strictEqual(accounting.length, 6);
  const distinctSkus = new Set(product.map(i => i.vendor_sku));
  assert.strictEqual(distinctSkus.size, 5);
});
test('I: total reconciles to 317.41', () => {
  const sum = Math.round(browserResult.items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  assert.strictEqual(sum, 317.41);
  assert.strictEqual(browserResult.total, 317.41);
});

// ── B: range preserved as visible pack, Node/browser parity ──────
test('B: 19400236 -> pack_description = "1.50-4.30lb Tray" (both Node and browser), raw_description untouched', () => {
  const nodeItems = nodeResult.items.filter(i => i.vendor_sku === '19400236');
  const browserItems = browserResult.items.filter(i => i.vendor_sku === '19400236');
  assert.strictEqual(nodeItems.length, 8);
  assert.strictEqual(browserItems.length, 8);
  nodeItems.forEach(i => assert.strictEqual(i.pack_description, '1.50-4.30lb Tray'));
  browserItems.forEach(i => assert.strictEqual(i.pack_description, '1.50-4.30lb Tray'));
  assert.ok(nodeItems[0].raw_description.includes('Chicken Breast'), 'raw_description must remain the full original text');
});
test('B: 27935840 -> pack_description = "2.75-7.0lb Tray" (both Node and browser)', () => {
  const nodeItems = nodeResult.items.filter(i => i.vendor_sku === '27935840');
  const browserItems = browserResult.items.filter(i => i.vendor_sku === '27935840');
  assert.strictEqual(nodeItems.length, 7);
  assert.strictEqual(browserItems.length, 7);
  nodeItems.forEach(i => assert.strictEqual(i.pack_description, '2.75-7.0lb Tray'));
  browserItems.forEach(i => assert.strictEqual(i.pack_description, '2.75-7.0lb Tray'));
});
test('B: Node/browser parity across ALL 24 items pack_description', () => {
  nodeResult.items.forEach((it, i) => {
    assert.strictEqual(browserResult.items[i].pack_description, it.pack_description, `item ${i} (${it.vendor_sku}) parity mismatch`);
  });
});

// ── Regression: the other fixed-weight/Each/Gallon cases in this and other docs unchanged ──
test('regression: 44001602 Ground Beef still "10lb" (unaffected by range change)', () => {
  const items = browserResult.items.filter(i => i.vendor_sku === '44001602');
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].pack_description, '10lb');
});
test('regression: Watermelon/Zucchini still "Each" (unaffected)', () => {
  assert.strictEqual(browserResult.items.find(i => i.vendor_sku === '44391101').pack_description, 'Each');
  assert.strictEqual(browserResult.items.find(i => i.vendor_sku === '44390947').pack_description, 'Each');
});
test('regression: c51dd720 (8 fixed-weight products) — all pack_description unaffected by range/guard changes', () => {
  const text = norm(fixtures.C51DD720_PAGE1) + '\n' + norm(fixtures.C51DD720_PAGE2);
  const r = browserParsers.parse(text);
  const expected = { '110366636': '4oz', '14255252': '8oz', '47370609': '32oz', '44391605': '1lb', '13508117005': '1lb', '979818213': '1lb', '141418923': '2lb', '1918496773': '10oz' };
  for (const [sku, pack] of Object.entries(expected)) {
    assert.strictEqual(r.items.find(i => i.vendor_sku === sku).pack_description, pack);
  }
});
test('regression: 069a51f8 (incl. Gallon) — all pack_description unaffected', () => {
  const text = norm(fixtures.C069A51F8_PAGE1) + '\n' + norm(fixtures.C069A51F8_PAGE2);
  const r = browserParsers.parse(text);
  const expected = { '10308430': '32oz', '44001602': '10lb', '14255252': '8oz', '10450114': '1gal', '32247486': '12oz', '529759161': '15oz', '12443812': '16oz' };
  for (const [sku, pack] of Object.entries(expected)) {
    assert.strictEqual(r.items.find(i => i.vendor_sku === sku).pack_description, pack);
  }
});

// ══════════════════════════════════════════════════════════════════
// Part C — explicit isWeightRangePack guard
// ══════════════════════════════════════════════════════════════════

const RANGE_GUARD_START = vdrSrc.indexOf('// ── MARKER:VDR_RANGE_GUARD_START');
const RANGE_GUARD_END   = vdrSrc.indexOf('// ── MARKER:VDR_RANGE_GUARD_END', RANGE_GUARD_START);
const rangeGuardEndLineEnd = vdrSrc.indexOf('\n', RANGE_GUARD_END);
const guardBlock = vdrSrc.slice(RANGE_GUARD_START, rangeGuardEndLineEnd);
const packToGramsStart = vdrSrc.indexOf('window.vdrPackToGrams = function');
const packToGramsEnd = vdrSrc.indexOf("// -- Ricalcola riga Sous Chef", packToGramsStart);
const packToGramsBlock = vdrSrc.slice(packToGramsStart, packToGramsEnd);
const calcPackStart = vdrSrc.indexOf('window.vdrCalcPack = function');
const calcPackEnd = vdrSrc.indexOf('// -- Calcola totalG', calcPackStart);
const calcPackBlock = vdrSrc.slice(calcPackStart, calcPackEnd);

const factory = new Function('window', guardBlock + '\n' + calcPackBlock + '\n' + packToGramsBlock + '\nreturn { isWeightRangePack: window.isWeightRangePack, vdrCalcPack: window.vdrCalcPack, vdrPackToGrams: window.vdrPackToGrams };');
const fakeWindow = {};
const { isWeightRangePack, vdrCalcPack, vdrPackToGrams } = factory(fakeWindow);

test('C: isWeightRangePack classifies the two real chicken ranges as ranges', () => {
  assert.strictEqual(isWeightRangePack('1.50-4.30lb Tray'), true);
  assert.strictEqual(isWeightRangePack('2.75-7.0lb Tray'), true);
});
test('C: isWeightRangePack does NOT classify any real fixed-weight/Each/Gallon pack as a range', () => {
  ['10lb', '4oz', '8oz', '32oz', '1lb', '2lb', '10oz', '12oz', '15oz', '16oz', 'Each', '1gal'].forEach(p => {
    assert.strictEqual(isWeightRangePack(p), false, p + ' must not be classified as a range');
  });
});
test('C: isWeightRangePack recognizes en-dash and unmapped-PUA-glyph range separators too, not just ASCII hyphen', () => {
  assert.strictEqual(isWeightRangePack('1.50\u20134.30lb'), true);
  assert.strictEqual(isWeightRangePack('1.50\uE088 4.30lb'), true);
});

test('3: vdrPackToGrams("1.50-4.30lb Tray") -> null (actual grams unknown, never min/max/mid/estimate)', () => {
  assert.strictEqual(vdrPackToGrams('1.50-4.30lb Tray', false, null, 'Chicken Breast'), null);
});
test('3: vdrPackToGrams("2.75-7.0lb Tray") -> null', () => {
  assert.strictEqual(vdrPackToGrams('2.75-7.0lb Tray', false, null, 'Chicken Breast'), null);
});
test('4: vdrPackToGrams handles the space-separated en-dash variant too ("1.50 \u2013 4.30 lb Tray") -> null', () => {
  assert.strictEqual(vdrPackToGrams('1.50 \u2013 4.30 lb Tray', false, null, 'Chicken Breast'), null);
});
test('4: vdrPackToGrams handles the raw unmapped PUA glyph variant (real pre-normalization TreviPay character) -> null', () => {
  assert.strictEqual(vdrPackToGrams('1.50\uE088 4.30lb Tray', false, null, 'Chicken Breast'), null);
});
test('4: a real measured actualWeightLb takes precedence over a range pack in vdrPackToGrams too (not just vdrCalcPack) -> NOT null', () => {
  const grams = vdrPackToGrams('1.50-4.30lb Tray', true, 2.85, 'Chicken Breast');
  assert.notStrictEqual(grams, null);
  assert.ok(Math.abs(grams - 2.85 * 453.592) < 0.01);
});
test('3 (regression): vdrPackToGrams("10lb") still computes normally (Ground Beef unaffected by the guard)', () => {
  assert.ok(Math.abs(vdrPackToGrams('10lb', false, null, 'Ground Beef') - 4535.92) < 0.01);
});
test('vdrCalcPack("1.50-4.30lb Tray") -> null (no computed display string for a range either)', () => {
  assert.strictEqual(vdrCalcPack('1.50-4.30lb Tray', false, null, 'Chicken Breast'), null);
});
test('vdrCalcPack still respects a REAL, separately-provided actualWeightLb even if pack happens to look range-like (measurement takes priority over text)', () => {
  assert.strictEqual(vdrCalcPack('1.50-4.30lb Tray', true, 2.85, 'Chicken Breast'), '2.9lb (catchweight)');
});

// ══════════════════════════════════════════════════════════════════
// Part E — generic, line_type-driven item count description
// ══════════════════════════════════════════════════════════════════

const describeStart = vdrSrc.indexOf('function vdrDescribeItemCounts');
const describeEnd = vdrSrc.indexOf('\n}', describeStart) + 2;
const describeBlock = vdrSrc.slice(describeStart, describeEnd);
const { vdrDescribeItemCounts } = new Function(describeBlock + '\nreturn { vdrDescribeItemCounts };')();

test('E: 26104552 real items -> "18 product lines · 5 SKUs · 6 accounting lines"', () => {
  assert.strictEqual(vdrDescribeItemCounts(browserResult.items), '18 product lines · 5 SKUs · 6 accounting lines');
});
test('E: a document with zero accounting rows falls back to the exact old "N items" wording (generic, not Walmart-specific)', () => {
  const items = [{ line_type: 'product' }, { line_type: 'product' }, { line_type: 'product' }];
  assert.strictEqual(vdrDescribeItemCounts(items), '3 items');
});
test('E: a document with no line_type at all (every non-Walmart vendor) also falls back to plain "N items"', () => {
  const items = [{ vendor_sku: 'a' }, { vendor_sku: 'b' }];
  assert.strictEqual(vdrDescribeItemCounts(items), '2 items');
});
test('E: singular "1 item" / "1 product line" wording', () => {
  assert.strictEqual(vdrDescribeItemCounts([{ line_type: 'product', vendor_sku: 'X1' }]), '1 item');
  assert.strictEqual(vdrDescribeItemCounts([{ line_type: 'product', vendor_sku: 'X1' }, { line_type: 'handling', vendor_sku: 'Express Fee' }]), '1 product line · 1 SKU · 1 accounting line');
});

// ══════════════════════════════════════════════════════════════════
// Part F — SKU-based unmatched counts (vdrComputeMatchStatus extension)
// ══════════════════════════════════════════════════════════════════

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

(async () => {

await (async () => {
  const doc = { id: '26104552-doc', document_type: 'invoice', vendor: 'Walmart Business', parsed_json: { vendor: 'Walmart Business', items: browserResult.items } };
  const ingredient_vendors = [
    { vendor_sku: '44001602', vendor: 'Walmart Business' },
    { vendor_sku: '44391101', vendor: 'Walmart Business' },
    { vendor_sku: '44390947', vendor: 'Walmart Business' },
  ];
  const sb = makeSb({ ingredient_vendors, ingredient_links: [] });
  const status = await vdrComputeMatchStatus(sb, [doc]);
  test('F: 26104552 with the real 3 SAFE_AUTO_MAP mappings -> unmatchedLineCount=15, unmatchedSkuCount=2 (not 15)', () => {
    assert.strictEqual(status['26104552-doc'].unmatchedLineCount, 15);
    assert.strictEqual(status['26104552-doc'].unmatchedSkuCount, 2);
  });
  test('F: unmatchedCount (legacy field) still present and equal to unmatchedLineCount — backward compatible', () => {
    assert.strictEqual(status['26104552-doc'].unmatchedCount, 15);
  });
  test('F: needsMatching still true (unchanged semantics)', () => {
    assert.strictEqual(status['26104552-doc'].needsMatching, true);
  });
})();

await (async () => {
  // Zero mappings -> every one of the 5 distinct SKUs unmatched
  const doc = { id: 'zero-map-doc', document_type: 'invoice', vendor: 'Walmart Business', parsed_json: { vendor: 'Walmart Business', items: browserResult.items } };
  const sb = makeSb({ ingredient_vendors: [], ingredient_links: [] });
  const status = await vdrComputeMatchStatus(sb, [doc]);
  test('F: zero mappings -> unmatchedSkuCount=5 (all distinct product SKUs), unmatchedLineCount=18', () => {
    assert.strictEqual(status['zero-map-doc'].unmatchedSkuCount, 5);
    assert.strictEqual(status['zero-map-doc'].unmatchedLineCount, 18);
  });
})();

await (async () => {
  // Part 2 (continuation task): a product line with NO vendor_sku must
  // never disappear from the SKU-level count — falls back to
  // description as the matching "action key", exactly matching the
  // matching check itself (sku||desc). Confirmed no current parser
  // (Hardie's/FreshPoint/Fruge/BEK/Walmart) omits vendor_sku on a real
  // product row — this is a robustness guard for the generic mechanism,
  // not a reproduction of an observed real bug.
  const doc = {
    id: 'no-sku-doc', document_type: 'invoice', vendor: 'Test Vendor',
    parsed_json: {
      vendor: 'Test Vendor',
      items: [
        { line_type: 'product', description: 'Unbranded Item A' }, // no vendor_sku at all
        { line_type: 'product', vendor_sku: '', description: 'Unbranded Item B' }, // empty-string vendor_sku
        { line_type: 'product', description: 'Unbranded Item C' },
      ],
    },
  };
  const sb = makeSb({ ingredient_vendors: [], ingredient_links: [] });
  const status2 = await vdrComputeMatchStatus(sb, [doc]);
  test('Part 2: 3 unmatched product lines with NO vendor_sku (2 distinct + 1 falsy-empty) -> unmatchedSkuCount must NEVER be 0 (would falsely show "Ready")', () => {
    assert.strictEqual(status2['no-sku-doc'].unmatchedLineCount, 3, 'all 3 lines still counted at line level');
    assert.ok(status2['no-sku-doc'].unmatchedSkuCount > 0, 'CRITICAL: unmatchedSkuCount must never silently drop to 0 just because vendor_sku is missing — that would make the badge falsely say "Ready to approve"');
    assert.strictEqual(status2['no-sku-doc'].unmatchedSkuCount, 3, 'each has a distinct description -> 3 distinct action keys, falling back to description exactly like the matching check itself does (sku||desc)');
    assert.strictEqual(status2['no-sku-doc'].needsMatching, true);
  });
})();

await (async () => {
  // Companion case: two no-SKU rows sharing the SAME description are
  // legitimately the same matching "action" (identical to how repeated
  // chicken-SKU rows collapse to one SKU) — this must collapse to 1, not
  // artificially count as 2, since resolving one resolves the other.
  const doc = {
    id: 'no-sku-same-desc-doc', document_type: 'invoice', vendor: 'Test Vendor',
    parsed_json: {
      vendor: 'Test Vendor',
      items: [
        { line_type: 'product', description: 'Unbranded Bulk Item' },
        { line_type: 'product', description: 'Unbranded Bulk Item' },
      ],
    },
  };
  const sb = makeSb({ ingredient_vendors: [], ingredient_links: [] });
  const status3 = await vdrComputeMatchStatus(sb, [doc]);
  test('Part 2: 2 no-SKU rows with the SAME description -> unmatchedSkuCount=1 (one real matching action resolves both, not double-counted)', () => {
    assert.strictEqual(status3['no-sku-same-desc-doc'].unmatchedLineCount, 2);
    assert.strictEqual(status3['no-sku-same-desc-doc'].unmatchedSkuCount, 1);
  });
})();

// ══════════════════════════════════════════════════════════════════
// Badge wording (structural) — Ready — N SKUs unmatched
// ══════════════════════════════════════════════════════════════════
test('badge: card wording uses unmatchedSkuCount, not unmatchedLineCount/unmatchedCount, as the primary number', () => {
  const cardFn = vdrSrc.slice(vdrSrc.indexOf('function vdrCardHTML'));
  const qBadgeBlock = cardFn.slice(cardFn.indexOf('const qBadge'), cardFn.indexOf('const qBadge') + 900);
  assert.ok(qBadgeBlock.includes('${unmatchedSkuCount} SKU'), 'badge must lead with the SKU count');
  assert.ok(/unmatchedSkuCount > 0/.test(cardFn.slice(cardFn.indexOf('const qBadge') - 400, cardFn.indexOf('const qBadge'))) || /unmatchedSkuCount > 0/.test(qBadgeBlock));
});

// ══════════════════════════════════════════════════════════════════
// Part G — accounting line semantic labels (structural)
// ══════════════════════════════════════════════════════════════════
test('G: row label uses the real line_type name for accounting rows (Handling/Fulfillment variance/Adjustment/Shipping), never generic "OK"', () => {
  assert.ok(vdrSrc.includes("lineTypeLabels = { handling: 'Handling', fulfillment_variance: 'Fulfillment variance', adjustment: 'Adjustment', shipping: 'Shipping' }"));
  assert.ok(vdrSrc.includes('isAccountingRow'));
});
test('G: a warning still takes priority over the type label on any row (more urgent to surface)', () => {
  const idx = vdrSrc.indexOf('var labelIcon');
  const line = vdrSrc.slice(idx, vdrSrc.indexOf('\n', idx));
  assert.ok(line.startsWith('var labelIcon   = hasWarning ? \'Warning\''));
});

// ══════════════════════════════════════════════════════════════════
// Part 3 — tray N/M is presentation-only, never mutates the item
// ══════════════════════════════════════════════════════════════════

test('Part 3: tray-index snippet never mutates item.description/raw_description/vendor_sku/pack_description — deep-equal before/after, on the real 26104552 items', () => {
  const trayStart = vdrSrc.indexOf('var skuOccurrenceTotals = {};');
  const trayEnd = vdrSrc.indexOf('var rows = items.map', trayStart);
  const traySnippet = vdrSrc.slice(trayStart, trayEnd);
  assert.ok(traySnippet.includes('skuOccurrenceSeen'), 'snippet extraction marker may have moved — source may have changed');

  // Deep clone so we have an untouched "before" to compare against —
  // this must equal the (still real, same-reference) items array after
  // running the exact real snippet.
  const before = JSON.parse(JSON.stringify(browserResult.items));

  const runSnippet = new Function('items', traySnippet + '\nreturn skuOccurrenceTotals;');
  runSnippet(browserResult.items); // exercise it once to make sure it doesn't throw
  const namesFn = new Function('items', traySnippet + `
    var names = items.map(function(item, idx) {
      var name = item.description || item.raw_description || '-';
      var repeatSku = item.vendor_sku || item.item_code;
      if (repeatSku && skuOccurrenceTotals[repeatSku] > 1) {
        skuOccurrenceSeen[repeatSku] = (skuOccurrenceSeen[repeatSku] || 0) + 1;
        name += ' (tray ' + skuOccurrenceSeen[repeatSku] + '/' + skuOccurrenceTotals[repeatSku] + ')';
      }
      return name;
    });
    return names;
  `);
  const displayNames = namesFn(browserResult.items);

  // The built display strings DO contain the tray suffix...
  const chicken1Idx = browserResult.items.findIndex(i => i.vendor_sku === '19400236');
  assert.ok(displayNames[chicken1Idx].includes('(tray 1/8)'), 'display name must show the tray index');

  // ...but the underlying item objects (same array, same references)
  // must be byte-for-byte identical to the pre-render snapshot — no
  // description/raw_description/vendor_sku/pack_description mutation.
  assert.deepStrictEqual(browserResult.items.map(i => i.description), before.map(i => i.description), 'description must never be mutated');
  assert.deepStrictEqual(browserResult.items.map(i => i.raw_description), before.map(i => i.raw_description), 'raw_description must never be mutated');
  assert.deepStrictEqual(browserResult.items.map(i => i.vendor_sku), before.map(i => i.vendor_sku), 'vendor_sku must never be mutated');
  assert.deepStrictEqual(browserResult.items.map(i => i.pack_description), before.map(i => i.pack_description), 'pack_description must never be mutated');
  assert.strictEqual(JSON.stringify(browserResult.items), JSON.stringify(before), 'the full items array must be byte-for-byte identical after building display names');
});
test('Part 3: real chicken descriptions never contain "(tray" before rendering (confirms the suffix is purely additive at render time, not baked into parsed_json)', () => {
  browserResult.items.filter(i => i.vendor_sku === '19400236' || i.vendor_sku === '27935840').forEach(i => {
    assert.ok(!i.description.includes('(tray'), 'parsed_json.description must never contain the tray suffix');
    assert.ok(!i.raw_description.includes('(tray'), 'parsed_json.raw_description must never contain the tray suffix');
  });
});


test('accounting rows (handling/fulfillment_variance/adjustment) still economically unaffected — sums verified in Part I total-reconciliation test above', () => {
  const handling = browserResult.items.filter(i => i.line_type === 'handling');
  const fv = browserResult.items.filter(i => i.line_type === 'fulfillment_variance');
  const adj = browserResult.items.filter(i => i.line_type === 'adjustment');
  assert.strictEqual(handling.length, 1);
  assert.strictEqual(handling[0].amount, 1.93);
  assert.strictEqual(fv.length, 4);
  assert.strictEqual(Math.round(fv.reduce((s, i) => s + i.amount, 0) * 100) / 100, 49.88);
  assert.strictEqual(adj.length, 1);
  assert.strictEqual(adj[0].amount, -49.88);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
})();
