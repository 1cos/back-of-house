// ══════════════════════════════════════════════════════════════════
// vendor-documents-review.js — TreviPay PDF text normalization
// Plain Node, zero external deps: `node tests/vendor-review-trevipay-normalize.test.js`
//
// Same convention as vendor-review-canonical-sku-guard.test.js: read the
// real source, extract the pure normalization block by marker, eval it,
// and test the EXACT code — not a rewritten copy. Fixtures are real
// PDF.js textContent.items captured from 4 real TreviPay invoices during
// the read-only extraction audit (tests/fixtures/trevipay-samples.js).
// This task does NOT implement the Walmart parser — these tests verify
// the text handed to a future parser is correct, nothing more.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const fixtures = require('./fixtures/trevipay-samples.js');

const SRC_PATH = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

const START = '// ── MARKER:VDR_TREVIPAY_NORMALIZE_START ────────────────────────────';
const END = '// ── MARKER:VDR_TREVIPAY_NORMALIZE_END ──────────────────────────────';
const startIdx = src.indexOf(START);
const endIdx = src.indexOf(END);
assert.ok(startIdx >= 0 && endIdx > startIdx, 'markers not found — source may have changed');
const block = src.slice(startIdx, endIdx);

const {
  vdrIsTreviPayDocument,
  decodeTreviPayPUA,
  vdrTreviPayJoinRow,
  vdrNormalizeTreviPayPage,
} = new Function(block + `
return {
  vdrIsTreviPayDocument,
  decodeTreviPayPUA,
  vdrTreviPayJoinRow,
  vdrNormalizeTreviPayPage,
};
`)();

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); }
}

// Small helper (test-only — not production parsing logic): sums the
// last "$X.XX"/"-$X.XX" token on every product/shipping/adjustment line
// of a normalized page, to check the acceptance math from the audit.
function sumProductLines(normalizedText) {
  const ROW_START = /^(?:\d{5,}|Shipping|ALT_PAYME)/;
  let total = 0;
  for (const line of normalizedText.split('\n')) {
    if (!ROW_START.test(line.trim())) continue;
    const m = line.match(/-?\$[\d]+\.\d{2}(?!.*\$)/); // last $amount on the line
    if (m) total = Math.round((total + parseFloat(m[0].replace('$', ''))) * 100) / 100;
  }
  return total;
}

console.log('\nTreviPay PDF text normalization — regression tests\n');

// ── 1. TreviPay detection on real items from all 4 invoices ──────────
test('1a. detects c51dd720 (real page 1 items) as TreviPay', () => {
  assert.strictEqual(vdrIsTreviPayDocument(fixtures.C51DD720_PAGE1), true);
});
test('1b. detects 6c246fda (real page 1 items — the optional TreviPay intro page) as TreviPay', () => {
  // This document's real page 1 is the "Welcome to the new Walmart
  // Business: Pay By Invoice program!" intro page (3-page invoice) — a
  // different layout from the other 3 samples' page 1, and exactly the
  // "extra intro page" edge case the original audit flagged as real.
  assert.strictEqual(vdrIsTreviPayDocument(fixtures.C6C246FDA_PAGE1), true);
});
test('1c. detects 12fd6860 (real page 1 items) as TreviPay', () => {
  assert.strictEqual(vdrIsTreviPayDocument(fixtures.C12FD6860_PAGE1), true);
});
test('1d. detects 30082536 (real page 1 items) as TreviPay', () => {
  assert.strictEqual(vdrIsTreviPayDocument(fixtures.C30082536_PAGE1), true);
});

// ── 2. Non-TreviPay rejection (synthetic Hardie's-style sample) ──────
test('2. rejects a non-TreviPay document (single generic token is not enough either)', () => {
  assert.strictEqual(vdrIsTreviPayDocument(fixtures.NON_TREVIPAY_PAGE1), false);
  // "Invoice" alone must never be sufficient — Hardie's sample contains it
  const hasInvoiceToken = fixtures.NON_TREVIPAY_PAGE1.some(it => /invoice/i.test(it.str));
  assert.ok(hasInvoiceToken, 'fixture sanity: sample should contain the generic word "Invoice"');
});
test('2b. empty/missing items reject safely', () => {
  assert.strictEqual(vdrIsTreviPayDocument([]), false);
  assert.strictEqual(vdrIsTreviPayDocument(null), false);
});

// ── 3/4/5. PUA digits, decimal point, minus sign ──────────────────────
test('3. decodes U+E071..U+E07A to "0".."9" via the arithmetic offset', () => {
  for (let d = 0; d <= 9; d++) {
    const ch = String.fromCodePoint(0xE071 + d);
    assert.strictEqual(decodeTreviPayPUA(ch).text, String(d), `digit ${d}`);
  }
});
test('4. decodes U+E094 to "."', () => {
  assert.strictEqual(decodeTreviPayPUA('\uE094').text, '.');
});
test('5. decodes U+EE55 to "-"', () => {
  assert.strictEqual(decodeTreviPayPUA('\uEE55').text, '-');
});
test('3b/4b/5b. reconstructs "-7.94" from its real PUA sequence', () => {
  const raw = '\uEE55' + '\uE078' + '\uE094' + '\uE07A' + '\uE075'; // - 7 . 9 4
  assert.strictEqual(decodeTreviPayPUA(raw).text, '-7.94');
});

// ── 6. Unknown PUA is preserved verbatim + flagged, never invented ───
test('6. unknown PUA codepoint (U+E088, a real icon glyph seen in the audit) is preserved, not guessed', () => {
  const result = decodeTreviPayPUA('\uE088');
  assert.strictEqual(result.text, '\uE088');
  assert.strictEqual(result.hasUnknownPua, true);
});
test('6b. known + unknown PUA mixed in one string: only the known part decodes', () => {
  const result = decodeTreviPayPUA('\uE073\uE088\uE094');
  assert.strictEqual(result.text, '2\uE088.');
  assert.strictEqual(result.hasUnknownPua, true);
});
test('6c. ordinary ASCII never trips the unknown-PUA flag', () => {
  assert.strictEqual(decodeTreviPayPUA('Roth Chèvre').hasUnknownPua, false);
});

// ── 7. Adjacent text runs, no real gap → no inserted space ───────────
test('7. adjacent single-letter runs with ~0 gap reconstruct "Roth", not "R oth"', () => {
  // Real geometry shape from c51dd720 row 1 ("R" ends at x≈104.48, "oth"
  // starts at x≈104.36 — effectively touching, per the audit).
  const row = [
    { x: 99.63, text: 'R', width: 4.84, fontSize: 9 },
    { x: 104.36, text: 'oth', width: 6.53, fontSize: 9 },
  ];
  assert.strictEqual(vdrTreviPayJoinRow(row).text, 'Roth');
});

// ── 8/9. Real geometric gap → space inserted; columns never merge ────
test('8/9. c51dd720 row 1: description, Quantity, Unit Price, Discount, Tax, Billed Total stay correctly separated', () => {
  const p2 = vdrNormalizeTreviPayPage(fixtures.C51DD720_PAGE2).text;
  assert.ok(
    p2.includes('Roth Chèvre Plain Crumbled Fresh 2 $3.97 $0.00 $0.00 $7.94'),
    'columns must be single-space separated, not merged, on the real row 1 text'
  );
});

// ── 10. Multiline description stays on separate output lines ─────────
test('10. wrapped description "Goat Cheese 4oz" stays on its own line, not merged into row 1', () => {
  const lines = vdrNormalizeTreviPayPage(fixtures.C51DD720_PAGE2).text.split('\n');
  assert.ok(lines.some(l => l.trim() === 'Goat Cheese 4oz'), 'continuation line must remain separate');
  assert.ok(!lines.some(l => l.includes('$7.94') && l.includes('Goat')), 'must not fuse into the priced row');
});

// ── 11. c51dd720 — full real-PDF acceptance list ──────────────────────
test('11. c51dd720: full acceptance list present after normalization (page 1 + page 2)', () => {
  const page1 = vdrNormalizeTreviPayPage(fixtures.C51DD720_PAGE1).text;
  const page2 = vdrNormalizeTreviPayPage(fixtures.C51DD720_PAGE2).text;
  const full = page1 + '\n' + page2;

  const mustContain = [
    'Massimilajo Zubboli',
    '110366636',
    'Roth Chèvre Plain Crumbled Fresh',
    'Goat Cheese 4oz',
    'Fresh Kiwi, 1lb Package',
    '52.07',
    '08/26/2026',
    '09/24/2026',
  ];
  for (const needle of mustContain) {
    assert.ok(full.includes(needle), `missing expected substring: ${JSON.stringify(needle)}`);
  }
  // Row-1 Quantity "2" and price "3.97"/"7.94" as they really appear, joined:
  assert.ok(full.includes('2 $3.97 $0.00 $0.00 $7.94'), 'row 1 numeric columns');

  // ── explicit non-goal (Part E): the split SKU must NOT be reconstructed here ──
  // Real PDF geometry: "1350811700" shares its row with the rest of that
  // line's columns (description/qty/prices); only the wrapped SKU
  // continuation "5" sits alone on the next geometric line. The
  // normalizer must report exactly this shape — reassembling
  // "13508117005" is the future parser's job, not the normalizer's.
  const lines = full.split('\n').map(l => l.trim());
  assert.ok(
    lines.includes('1350811700 Fresh Kiwi, 1lb Package 1 $2.62 $0.00 $0.00 $2.62'),
    'row containing the first geometric line of the split SKU must be reported as-is'
  );
  assert.ok(lines.includes('5'), 'wrapped second geometric line of the split SKU must stand alone');
  assert.ok(!full.includes('13508117005'), 'reassembling the split SKU is the parser\'s job, not the normalizer\'s (next task)');
});

// ── 12. The other 3 real PDFs — edge cases + math reconciliation ─────
test('12a. 6c246fda: Tax1 percentage and negative ALT_PAYMENT_METHODS decode correctly', () => {
  const text = vdrNormalizeTreviPayPage(fixtures.C6C246FDA_PAGE3).text;
  assert.ok(text.includes('0.0824%'), 'Tax1 percentage must decode cleanly');
  assert.ok(text.includes('-$21.26'), 'negative adjustment must keep its minus sign');
  assert.ok(text.includes('ALT_PAYME'), 'ALT_PAYMENT_METHODS row must be present, not merged away');
});
test('12b. 6c246fda: sum(product/adjustment lines) == invoice total (63.33)', () => {
  const text = vdrNormalizeTreviPayPage(fixtures.C6C246FDA_PAGE3).text;
  assert.strictEqual(sumProductLines(text), 63.33);
});
test('12c. 12fd6860: Tax1 percentages decode correctly', () => {
  const text = vdrNormalizeTreviPayPage(fixtures.C12FD6860_PAGE2).text;
  assert.ok(text.includes('0.0821%') && text.includes('0.0827%'));
});
test('12d. 12fd6860: sum(product lines) == invoice total (61.56)', () => {
  const text = vdrNormalizeTreviPayPage(fixtures.C12FD6860_PAGE2).text;
  assert.strictEqual(sumProductLines(text), 61.56);
});
test('12e. 30082536: Shipping rows stay separate, not folded into the preceding product row', () => {
  const p2 = vdrNormalizeTreviPayPage(fixtures.C30082536_PAGE2).text;
  const shippingLines = p2.split('\n').filter(l => l.trim().startsWith('Shipping'));
  assert.ok(shippingLines.length >= 4, `expected multiple standalone Shipping rows, got ${shippingLines.length}`);
});
test('12f. 30082536: sum(product/shipping lines across pages 2+3) == invoice total (33.88)', () => {
  const p2 = vdrNormalizeTreviPayPage(fixtures.C30082536_PAGE2).text;
  const p3 = vdrNormalizeTreviPayPage(fixtures.C30082536_PAGE3).text;
  assert.strictEqual(sumProductLines(p2 + '\n' + p3), 33.88);
});

// ── 13. Non-regression: legacy path is untouched for non-TreviPay vendors ──
test('13a. the exact legacy per-row join expression is still present, unmodified, in source', () => {
  assert.ok(
    src.includes("lineMap[y].sort((a, b) => a.x - b.x).map(i => i.text).join(' ')"),
    'the original flat join must remain byte-identical for the non-TreviPay branch'
  );
});
test('13b. the legacy branch is reachable independently of the TreviPay branch (structural continue)', () => {
  const callSiteStart = src.indexOf('const page1Content = await (await pdf.getPage(1)).getTextContent();');
  assert.ok(callSiteStart > -1, 'call-site integration not found');
  const nearby = src.slice(callSiteStart, callSiteStart + 1800);
  assert.ok(nearby.includes('if (isTreviPay)'), 'must branch explicitly on detection result');
  assert.ok(nearby.includes('continue;'), 'TreviPay branch must not fall through into the legacy join');
});
test('13c. detection combination guards against a false positive from a single generic token', () => {
  // A document that only mentions "Invoice" (extremely common word across
  // every vendor) must never alone trigger the TreviPay path.
  assert.strictEqual(vdrIsTreviPayDocument([{ str: 'INVOICE' }, { str: 'Invoice Number 12345' }]), false);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
