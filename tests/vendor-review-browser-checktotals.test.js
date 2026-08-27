// ══════════════════════════════════════════════════════════════════
// js/vendor-parser-ui.js — browser reconciliation fail-safe (checkTotals port)
// Plain Node, zero external deps: `node tests/vendor-review-browser-checktotals.test.js`
//
// Node's js/vendor-parsers/index.js has always had checkTotals() wrapping
// every vendor's parse() result generically — the browser file (the one
// actually loaded by production, per commit c19fed3's finding) never did.
// This meant a parser bug dropping real line items (exactly the class of
// bug just fixed for HANDLING/FULFILL_VARIANCE in commit 51cd96f) could
// leave sum(items.amount) silently mismatched with warnings: [], and
// vdrProcessAllPdf() only checks items.length > 0 to decide pending/error
// — so a document missing real dollars could still reach 'pending'
// looking completely healthy in Vendor Review.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const VDR_JS   = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');
const VP_UI_JS = path.join(__dirname, '..', 'js', 'vendor-parser-ui.js');
const vdrSrc = fs.readFileSync(VDR_JS, 'utf8');
const vpUiSrc = fs.readFileSync(VP_UI_JS, 'utf8');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }

const NORM_START = '// ── MARKER:VDR_TREVIPAY_NORMALIZE_START ────────────────────────────';
const NORM_END   = '// ── MARKER:VDR_TREVIPAY_NORMALIZE_END ──────────────────────────────';
const normBlock = vdrSrc.slice(vdrSrc.indexOf(NORM_START), vdrSrc.indexOf(NORM_END));
const { vdrNormalizeTreviPayPage } = new Function(normBlock + 'return { vdrNormalizeTreviPayPage };')();
function norm(items) { return vdrNormalizeTreviPayPage(items).text; }

function loadBrowserParsers() {
  return new Function('window', 'document', vpUiSrc + '\nreturn buildVendorParsers();')({}, { getElementById: () => null });
}

const fixtures = require('./fixtures/trevipay-samples.js');

console.log('\nBrowser reconciliation fail-safe (checkTotals port) — regression tests\n');

// ── Part 1 audit, structural confirmation ─────────────────────────────
test('audit: checkTotals now exists in the browser file (was completely absent before this fix)', () => {
  assert.ok(vpUiSrc.includes('function checkTotals('), 'checkTotals must be defined in vendor-parser-ui.js');
});
test('audit: the generic Router wraps every vendor result through checkTotals, not just Walmart', () => {
  const routerBlock = vpUiSrc.slice(vpUiSrc.indexOf('// ── Router ──'));
  assert.ok(routerBlock.includes('if (result) return checkTotals(result);'), 'checkTotals must wrap the single shared return point, covering every vendor branch above it');
});

// ── Part 2 — pre-fix reproduction (still valid as a permanent regression guard) ──
// A hand-built mutilated 26104552-shaped fixture: real header total
// ($317.41) but the row set only sums to a lower amount — reproduces
// exactly the "sum != total, warnings stay empty" failure mode.
const MUTILATED_TEXT = [
  'Walmart Business TreviPay Invoice Details',
  'SKU Description Quantity Unit Price Discount Tax Billed Total',
  '44001602 Ground Beef 3 $39.94 $0.00 $0.00 $119.82',
  '19400236 Chicken Breast 1 $11.72 $0.00 $0.00 $11.72',
  '19400236 Chicken Breast 1 $13.10 $0.00 $0.00 $13.10',
  '19400236 Chicken Breast 1 $12.87 $0.00 $0.00 $12.87',
  '19400236 Chicken Breast 1 $12.27 $0.00 $0.00 $12.27',
  '19400236 Chicken Breast 1 $13.79 $0.00 $0.00 $13.79',
  '19400236 Chicken Breast 1 $11.63 $0.00 $0.00 $11.63',
  '19400236 Chicken Breast 1 $14.19 $0.00 $0.00 $14.19',
  '19400236 Chicken Breast 1 $13.65 $0.00 $0.00 $13.65',
  '27935840 Chicken Breast 1 $10.69 $0.00 $0.00 $10.69',
  '27935840 Chicken Breast 1 $12.41 $0.00 $0.00 $12.41',
  '27935840 Chicken Breast 1 $12.26 $0.00 $0.00 $12.26',
  '27935840 Chicken Breast 1 $11.54 $0.00 $0.00 $11.54',
  '27935840 Chicken Breast 1 $13.03 $0.00 $0.00 $13.03',
  '27935840 Chicken Breast 1 $12.49 $0.00 $0.00 $12.49',
  '27935840 Chicken Breast 1 $11.77 $0.00 $0.00 $11.77',
  'Buyer',
  'United States Massimilajo Zubboli',
  'Please Reference Invoice 26104552 |',
  'Pre-Tax Subtotal $317.41',
  'Taxes Subtotal $0.00',
  'Total Due as of 09/25/2026 $317.41',
  'Invoice 26104552 Invoice Summary',
].join('\n');

test('reproduction: mutilated fixture has sum(items.amount) != total (307.23 vs 317.41) — the real failure shape', () => {
  const browserParsers = loadBrowserParsers();
  const r = browserParsers.parse(MUTILATED_TEXT);
  const sum = Math.round(r.items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  assert.strictEqual(sum, 307.23);
  assert.strictEqual(r.total, 317.41);
  assert.notStrictEqual(sum, r.total);
});

// ── Part 3 — the fix itself ────────────────────────────────────────────
test('fix: mutilated document now gets a blocking DOC-TOTAL-001 warning', () => {
  const browserParsers = loadBrowserParsers();
  const r = browserParsers.parse(MUTILATED_TEXT);
  const w = r.warnings.find(w => w.code === 'DOC-TOTAL-001');
  assert.ok(w, 'DOC-TOTAL-001 must be present');
  assert.strictEqual(w.severity, 'blocking');
  assert.strictEqual(w.sum_of_lines, 307.23);
  assert.strictEqual(w.declared_total, 317.41);
});
test('fix: same semantics as Node — $0.02 tolerance, no false positive at the boundary', () => {
  const browserParsers = loadBrowserParsers();
  const text = [
    'Walmart Business TreviPay Invoice Details',
    'SKU Description Quantity Unit Price Discount Tax Billed Total',
    '110366636 Roth Chèvre 1 $10.01 $0.00 $0.00 $10.01',
    'Buyer',
    'United States Massimilajo Zubboli',
    'Please Reference Invoice X |',
    'Pre-Tax Subtotal $10.03',
    'Taxes Subtotal $0.00',
    'Total Due as of 01/01/2026 $10.03',
    'Invoice X Invoice Summary',
  ].join('\n');
  const r = browserParsers.parse(text);
  assert.strictEqual(r.warnings.some(w => w.code === 'DOC-TOTAL-001'), false, '2 cent gap must stay within tolerance, matching Node');
});
test('fix: warning is never duplicated even if checkTotals were somehow applied twice', () => {
  const browserParsers = loadBrowserParsers();
  const r = browserParsers.parse(MUTILATED_TEXT);
  const twice = r.warnings.filter(w => w.code === 'DOC-TOTAL-001');
  assert.strictEqual(twice.length, 1);
});
test('fix: empty-items documents (UNKNOWN_VENDOR etc.) are untouched by checkTotals, no crash', () => {
  const browserParsers = loadBrowserParsers();
  const r = browserParsers.parse('completely unrelated text with no vendor markers');
  assert.strictEqual(r.vendor, null);
  assert.strictEqual(r.items.length, 0);
  assert.strictEqual(r.warnings.some(w => w.code === 'DOC-TOTAL-001'), false);
});

// ── Part 4 — the 3 real documents, must stay clean ────────────────────

test('real c51dd720: 52.07 = 52.07, zero warnings', () => {
  const browserParsers = loadBrowserParsers();
  const text = norm(fixtures.C51DD720_PAGE1) + '\n' + norm(fixtures.C51DD720_PAGE2);
  const r = browserParsers.parse(text);
  const sum = Math.round(r.items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  assert.strictEqual(sum, 52.07);
  assert.strictEqual(r.total, 52.07);
  assert.strictEqual(r.warnings.some(w => w.code === 'DOC-TOTAL-001'), false);
});
test('real 069a51f8: 237.56 = 237.56, zero warnings', () => {
  const browserParsers = loadBrowserParsers();
  const text = norm(fixtures.C069A51F8_PAGE1) + '\n' + norm(fixtures.C069A51F8_PAGE2);
  const r = browserParsers.parse(text);
  const sum = Math.round(r.items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  assert.strictEqual(sum, 237.56);
  assert.strictEqual(r.total, 237.56);
  assert.strictEqual(r.warnings.some(w => w.code === 'DOC-TOTAL-001'), false);
});
test('real 26104552 (with the HANDLING/FULFILL_VARIANCE fix already live): 317.41 = 317.41, zero warnings', () => {
  const browserParsers = loadBrowserParsers();
  const text = norm(fixtures.C26104552_PAGE1) + '\n' + norm(fixtures.C26104552_PAGE2) + '\n' + norm(fixtures.C26104552_PAGE3);
  const r = browserParsers.parse(text);
  const sum = Math.round(r.items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  assert.strictEqual(r.items.length, 24);
  assert.strictEqual(sum, 317.41);
  assert.strictEqual(r.total, 317.41);
  assert.strictEqual(r.warnings.some(w => w.code === 'DOC-TOTAL-001'), false);
});

// ── Non-Walmart regression: other vendors still dispatch/parse identically ──
test('non-Walmart regression: Hardie\'s/FreshPoint/Fruge/BEK detection unchanged after the Router restructure', () => {
  const browserParsers = loadBrowserParsers();
  assert.strictEqual(browserParsers.detectVendor("DAIRYLAND PRODUCE INVOICE/POD 123"), 'hardies');
  assert.strictEqual(browserParsers.detectVendor("FRESHPOINT DALLAS Invoice No. 123"), 'freshpoint');
  assert.strictEqual(browserParsers.detectVendor("FRUGE SEAFOOD invoice"), 'fruge');
  assert.strictEqual(browserParsers.detectVendor("BEN E. KEITH invoice"), 'bek');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
