// ══════════════════════════════════════════════════════════════════
// fruge-invoice.js — MICRO-TASK 34 regression tests
// Plain Node, no framework: `node tests/vendor-parsers-fruge-fix.test.js`
//
// Fixtures below are minimal textual reproductions of the REAL layouts
// of #854668 (control), #855939 and #856363 (previously failing with
// 0 items, status=error, warnings=null) — no real PDFs committed, per
// task instructions. Full raw_text values were fetched from
// vendor_documents in Supabase and diffed byte-for-byte against these
// fixtures' structurally-relevant lines before writing this suite.
// ══════════════════════════════════════════════════════════════════
const assert = require('assert');
const { parse } = require('../js/vendor-parsers/fruge-invoice.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : e)); }
}

// ── Fixture: #854668 layout (control — was already "working" before ──
// this fix, via 1/5 items; must now extract all 5, no regression) ──
const FIXTURE_854668 = `INVOICE   854668
 Taken   09/03/26
Shipped   09/03/26
Invoiced   09/03/26
 Ordered   Product Description   Shipped   Unit Price   Amount
 1 CA   LOBZM4T6XOZ0 - LOBSTER FZ N. ATL 4-5 OZ 10lb   1 CA   $27.50 LB   $275.00
1 CA,   100-P108234-009-001
 1 BG   MUSFXOXOXOX0 - MUSSELS FR 1 X 10 LB BAG 10lb   1 BG   $35.25 BG   $35.25
1 BG,   100-P108850-027-001 , CANADA - FARMED
1 GA   SCAFDUU10BRO - SCALLOPS FR DRY U10 GAL BRISTOL, 1 GA   $310.00 GA   $310.00
8 LB GAL 8lb  
1 GA,   100-P108908-001-001
 22 LB   BRAFW8001000 - BRANZINI FR WHOLE 800-1000 1lb   22.5 LB   $11.25 LB   $253.13
22.5 LB,   100-P108699-003-001
 1 BG   CLAFXVA10BG0 - CLAMS FR LITTLENECK VIRGINIA 100 1 BG   $38.00 BG   $38.00
CT BAG 10lb  
1 BG,   100-P108851-015-001 , UNITED STATES - FARMED
Total Weight:   60.5 LB  Pay:  
$911.38
Total Cartons:   5`;

// ── Fixture: #855939 layout (previously failing, 0 items) ────────────
const FIXTURE_855939 = `INVOICE   855939
 Taken   09/14/26
Shipped   09/14/26
Invoiced   09/14/26
 Ordered   Product Description   Shipped   Unit Price   Amount
 1 GA   SCAFDUU10BRO - SCALLOPS FR DRY U10 GAL 1 GA   $310.00 GA   $310.00
BRISTOL, 8 LB GAL 8lb  
1 GA,   100-P109068-001-001
 1 BG   CLAFXVA10BG0 - CLAMS FR LITTLENECK VIRGINIA 1 BG   $38.00 BG   $38.00
100 CT BAG 10lb  
1 BG,   100-P109012-001-001 , UNITED STATES - FARMED
1 BG   MUSFXOXOXOX0 - MUSSELS FR 1 X 10 LB BAG 10lb   1 BG   $35.25 BG   $35.25
1 BG,   100-P109012-002-001 , CANADA - FARMED
1 CA   LOBZM4T6XOZ0 - LOBSTER FZ N. ATL 4-5 OZ 10lb   1 CA   $27.50 LB   $275.00
1 CA,   100-P108234-009-001
 2 CA   SHRQT1620WH0 - SHRIMP IQF FZ P&D TO 16-20 WH 2 CA   $8.50 LB   $170.00
WHITE - CENSEA (5 X 2 LBS) 5x2lb  
2 CA,   100-P108860-005-001
 Total Weight:   58 LB  Pay:  
$828.25
Total Cartons:   6`;

// ── Fixture: #856363 layout (previously failing, 0 items) ────────────
const FIXTURE_856363 = `INVOICE   856363
 Taken   09/17/26
Shipped   09/17/26
Invoiced   09/17/26
 Ordered   Product Description   Shipped   Unit Price   Amount
 1 CA   LOBZM4T6XOZ0 - LOBSTER FZ N. ATL 4-5 OZ 10lb   1 CA   $27.50 LB   $275.00
1 CA,   100-P108734-002-001
 2 CA   SHRQT1620WH0 - SHRIMP IQF FZ P&D TO 16-20 WH 2 CA   $8.50 LB   $170.00
WHITE - CENSEA (5 X 2 LBS) 5x2lb  
2 CA,   100-P108860-005-001
 1 CA   SQUZXOXOXTT1 - SQUID FZ TUBES & TENTS 4-6 *25 LB 1 CA   $9.20 LB   $230.00
CASE TOWN DOCK 10x2.5lb  
1 CA,   100-P109032-004-001
 Total Weight:   55 LB  Pay:  
$675.00
Total Cartons:   6`;

// ── T1: #854668-like layout — full extraction, no regression ─────────
test('T1: #854668-like layout extracts all 5 real lines (was 1/5 before this fix)', () => {
  const r = parse(FIXTURE_854668);
  assert.strictEqual(r.items.length, 5);
  assert.strictEqual(r.document_number, '854668');
  assert.strictEqual(r.total, 911.38);
  const skus = r.items.map(i => i.vendor_sku).sort();
  assert.deepStrictEqual(skus, ['BRAFW8001000', 'CLAFXVA10BG0', 'LOBZM4T6XOZ0', 'MUSFXOXOXOX0', 'SCAFDUU10BRO']);
  assert.strictEqual(r.warnings.length, 0, 'a clean, fully-parsed invoice must carry no blocking warning');
});
test('T1b: #854668 BRANZINI (pure-LB catchweight) keeps identical math to before the fix', () => {
  const r = parse(FIXTURE_854668);
  const branzini = r.items.find(i => i.vendor_sku === 'BRAFW8001000');
  assert.strictEqual(branzini.catchweight, true);
  assert.strictEqual(branzini.total_weight_lb, 22.5);
  assert.strictEqual(branzini.cost_per_lb, 11.2502); // 253.13 / 22.5, matches the real stored production value exactly
});
test('T1c: #854668 LOBSTER (case-shipped, per-lb priced, no derivable weight) is still extracted without a fabricated weight', () => {
  const r = parse(FIXTURE_854668);
  const lobster = r.items.find(i => i.vendor_sku === 'LOBZM4T6XOZ0');
  assert.strictEqual(lobster.received_unit, 'CA');
  assert.strictEqual(lobster.total_weight_lb, null, 'must not invent a weight it cannot read from the text');
  assert.strictEqual(lobster.unit_price, 27.5);
  assert.strictEqual(lobster.amount, 275);
});

// ── T2: #855939-like layout — the real previously-failing case ───────
test('T2: #855939-like layout extracts all 5 real lines (was 0 before this fix)', () => {
  const r = parse(FIXTURE_855939);
  assert.strictEqual(r.items.length, 5);
  assert.strictEqual(r.document_number, '855939');
  assert.strictEqual(r.total, 828.25);
  assert.strictEqual(r.warnings.length, 0);
});
test('T2b: #855939 SHRIMP derives its weight from the wrapped "(5 X 2 LBS)" continuation line', () => {
  const r = parse(FIXTURE_855939);
  const shrimp = r.items.find(i => i.vendor_sku === 'SHRQT1620WH0');
  assert.strictEqual(shrimp.total_weight_lb, 20);
  assert.strictEqual(shrimp.cost_per_lb, 8.5);
});
test('T2c: #855939 SCALLOPS derives its weight from the wrapped "8 LB GAL 8lb" continuation line', () => {
  const r = parse(FIXTURE_855939);
  const scallops = r.items.find(i => i.vendor_sku === 'SCAFDUU10BRO');
  assert.strictEqual(scallops.total_weight_lb, 8);
});

// ── T3: #856363-like layout — the second previously-failing case ─────
test('T3: #856363-like layout extracts all 3 real lines (was 0 before this fix)', () => {
  const r = parse(FIXTURE_856363);
  assert.strictEqual(r.items.length, 3);
  assert.strictEqual(r.document_number, '856363');
  assert.strictEqual(r.total, 675);
  assert.strictEqual(r.warnings.length, 0);
});
test('T3b: #856363 SQUID derives its weight from the wrapped "10x2.5lb" continuation line', () => {
  const r = parse(FIXTURE_856363);
  const squid = r.items.find(i => i.vendor_sku === 'SQUZXOXOXTT1');
  assert.strictEqual(squid.total_weight_lb, 25);
  assert.strictEqual(squid.cost_per_lb, 9.2);
});

// ── T4: valid header, zero parseable lines → explicit blocking guard ─
test('T4: a recognized Fruge invoice with a real document number but zero parseable lines gets the explicit blocking guard, never silent', () => {
  const fixture = `INVOICE   999999
 Taken   01/01/26
Invoiced   01/01/26
 Ordered   Product Description   Shipped   Unit Price   Amount
 the line item table format has changed completely and no longer matches
 Pay:  
$50.00`;
  const r = parse(fixture);
  assert.strictEqual(r.items.length, 0);
  assert.strictEqual(r.warnings.length, 1);
  assert.strictEqual(r.warnings[0].code, 'PARSE_ERROR_NO_LINES');
  assert.ok(r.warnings[0].message.includes('999999'), 'message should reference the real document number it did find');
});
test('T4b: zero-lines guard fires even when no document number was found at all', () => {
  const r = parse('completely unrecognizable garbage text with no structure whatsoever');
  assert.strictEqual(r.items.length, 0);
  assert.strictEqual(r.warnings.length, 1);
  assert.strictEqual(r.warnings[0].code, 'PARSE_ERROR_NO_LINES');
});

// ── T5: document total stays coherent with the sum of extracted lines ─
test('T5: for all three real layouts, sum(items.amount) reconciles exactly with the extracted document total', () => {
  for (const [fixture, expectedTotal] of [[FIXTURE_854668, 911.38], [FIXTURE_855939, 828.25], [FIXTURE_856363, 675]]) {
    const r = parse(fixture);
    const sum = Math.round(r.items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
    assert.strictEqual(r.total, expectedTotal);
    assert.ok(Math.abs(sum - expectedTotal) < 0.02, `sum ${sum} should reconcile with total ${expectedTotal}`);
  }
});

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail > 0 ? 1 : 0);
