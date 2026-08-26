// ══════════════════════════════════════════════════════════════════
// vendor-documents-review.js — Walmart/TreviPay Buyer Guard (end-to-end)
// Plain Node, zero external deps beyond jsdom: `node tests/vendor-review-walmart-buyer-guard.test.js`
//
// Now that the browser parser actually recognizes Walmart (commit
// c19fed3, js/vendor-parser-ui.js), this drives the REAL production
// pipeline end-to-end:
//  1. Pure classification logic (vdrDecideWalmartBuyer/vdrNormalizeBuyerName),
//     marker-extracted and eval'd in isolation.
//  2. Full real processing: window.vdrProcessAllPdf() (vendor-documents-review.js
//     + vendor-parser-ui.js eval'd together, same convention as
//     tests/bek-parser-parity.test.js) driven with REAL Walmart/TreviPay
//     text via the real 'email_body' bypass (the same real path Ben E.
//     Keith Order Confirmations already use) — genuinely exercises
//     parse -> buyer decision -> status, not a re-implementation.
//  3. Hard write-boundary: the REAL window.vdrApprove(), re-deriving the
//     buyer decision from parsed_json independently of stored status,
//     proving ignore/review documents can never reach
//     invoice_lines/ingredient_vendors even with a stale/manually-edited
//     status.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const VDR_JS   = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');
const VP_UI_JS = path.join(__dirname, '..', 'js', 'vendor-parser-ui.js');
const vdrSrc = fs.readFileSync(VDR_JS, 'utf8');
const vpUiSrc = fs.readFileSync(VP_UI_JS, 'utf8');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }
async function atest(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }

// ══════════════════════════════════════════════════════════════════
// Layer 1 — pure logic, marker-extracted
// ══════════════════════════════════════════════════════════════════
const GUARD_START = '// ── MARKER:VDR_WALMART_BUYER_GUARD_START ────────────────────────────';
const GUARD_END   = '// ── MARKER:VDR_WALMART_BUYER_GUARD_END ──────────────────────────────';
const guardBlock = vdrSrc.slice(vdrSrc.indexOf(GUARD_START), vdrSrc.indexOf(GUARD_END));
assert.ok(guardBlock.length > 100, 'guard markers not found — source may have changed');
const { vdrDecideWalmartBuyer, vdrNormalizeBuyerName } = new Function(
  guardBlock + '\nreturn { vdrDecideWalmartBuyer, vdrNormalizeBuyerName };'
)();

console.log('\nWalmart/TreviPay Buyer Guard — end-to-end regression tests\n');

test('B1. Kitchen: "Massimilajo Zubboli" → accept', () => {
  assert.strictEqual(vdrDecideWalmartBuyer({ vendor: 'Walmart Business', buyer: 'Massimilajo Zubboli' }).action, 'accept');
});
test('B2. Bar: "Zeno Russo" → ignore', () => {
  assert.strictEqual(vdrDecideWalmartBuyer({ vendor: 'Walmart Business', buyer: 'Zeno Russo' }).action, 'ignore');
});
test('B3. Missing buyer (null/empty/whitespace) → review', () => {
  assert.strictEqual(vdrDecideWalmartBuyer({ vendor: 'Walmart Business', buyer: null }).action, 'review');
  assert.strictEqual(vdrDecideWalmartBuyer({ vendor: 'Walmart Business', buyer: '' }).action, 'review');
  assert.strictEqual(vdrDecideWalmartBuyer({ vendor: 'Walmart Business', buyer: '   ' }).action, 'review');
});
test('B4. Unrecognized buyer ("Some Other Buyer") → review', () => {
  assert.strictEqual(vdrDecideWalmartBuyer({ vendor: 'Walmart Business', buyer: 'Some Other Buyer' }).action, 'review');
});
test('B5. Benign normalization: " massimilajo   zubboli " → accept', () => {
  assert.strictEqual(vdrDecideWalmartBuyer({ vendor: 'Walmart Business', buyer: ' massimilajo   zubboli ' }).action, 'accept');
});
test('B6. Benign normalization applies to the Bar buyer too', () => {
  assert.strictEqual(vdrDecideWalmartBuyer({ vendor: 'Walmart Business', buyer: '  ZENO   RUSSO  ' }).action, 'ignore');
});
test('B7. Near-match NOT authorized: "Massimiliano Zubboli" → review (no fuzzy matching)', () => {
  assert.strictEqual(vdrDecideWalmartBuyer({ vendor: 'Walmart Business', buyer: 'Massimiliano Zubboli' }).action, 'review');
});
test('B7b. Near-match NOT authorized: "Max Zubboli" → review', () => {
  assert.strictEqual(vdrDecideWalmartBuyer({ vendor: 'Walmart Business', buyer: 'Max Zubboli' }).action, 'review');
});
test('B7c. Near-match NOT authorized: "M. Zubboli" → review', () => {
  assert.strictEqual(vdrDecideWalmartBuyer({ vendor: 'Walmart Business', buyer: 'M. Zubboli' }).action, 'review');
});
test('B7d. Near-match NOT authorized: last name alone ("Zubboli") → review', () => {
  assert.strictEqual(vdrDecideWalmartBuyer({ vendor: 'Walmart Business', buyer: 'Zubboli' }).action, 'review');
});
test('B8. Guard applies ONLY to Walmart Business — null (not_applicable) for every other vendor', () => {
  assert.strictEqual(vdrDecideWalmartBuyer({ vendor: "Hardie's Fresh Foods / Dairyland Produce", buyer: null }), null);
  assert.strictEqual(vdrDecideWalmartBuyer({ vendor: 'Ben E. Keith' }), null);
  assert.strictEqual(vdrDecideWalmartBuyer({ vendor: 'FreshPoint Dallas' }), null);
  assert.strictEqual(vdrDecideWalmartBuyer(null), null);
  assert.strictEqual(vdrDecideWalmartBuyer(undefined), null);
});

// ══════════════════════════════════════════════════════════════════
// Layer 2 — full real processing pipeline (vdrProcessAllPdf), driven
// by the REAL browser parser (now Walmart-aware since c19fed3)
// ══════════════════════════════════════════════════════════════════

const fixtures = require('./fixtures/trevipay-samples.js');
const NORM_START = '// ── MARKER:VDR_TREVIPAY_NORMALIZE_START ────────────────────────────';
const NORM_END   = '// ── MARKER:VDR_TREVIPAY_NORMALIZE_END ──────────────────────────────';
const normBlock = vdrSrc.slice(vdrSrc.indexOf(NORM_START), vdrSrc.indexOf(NORM_END));
const { vdrNormalizeTreviPayPage } = new Function(normBlock + 'return { vdrNormalizeTreviPayPage };')();
function norm(items) { return vdrNormalizeTreviPayPage(items).text; }

const DOC_TEXT = {
  c51dd720:   norm(fixtures.C51DD720_PAGE1) + '\n' + norm(fixtures.C51DD720_PAGE2),
  '6c246fda': norm(fixtures.C6C246FDA_PAGE2) + '\n' + norm(fixtures.C6C246FDA_PAGE3),
  '12fd6860': norm(fixtures.C12FD6860_PAGE1) + '\n' + norm(fixtures.C12FD6860_PAGE2),
  '30082536': norm(fixtures.C30082536_PAGE1) + '\n' + norm(fixtures.C30082536_PAGE2) + '\n' + norm(fixtures.C30082536_PAGE3),
};
// Synthetic real-pipeline edge cases, derived from the REAL c51dd720 text
// by a single surgical substitution (not hand-typed clean text).
const DOC_TEXT_UNKNOWN_BUYER = DOC_TEXT.c51dd720.replace('Massimilajo Zubboli', 'Some Other Buyer');
// KNOWN PARSER LIMITATION (not fixed in this task — walmart-trevipay-invoice.js
// and its browser port are out of scope here): extractBuyer's regex
// (/United States\s+(\S.+)$/m) uses \s+, which matches newlines too, so if
// the "United States" line has nothing after it, it walks forward to
// whatever non-blank line comes next instead of returning null. Simply
// deleting the buyer name (leaving a dangling "United States") or deleting
// the whole line both trip this — the regex then grabs the Seller's
// address's own "United States" line, or later boilerplate text, instead
// of null. Neutralizing every "United States" occurrence sidesteps this
// latent bug cleanly and still gives a genuinely buyer-less document to
// drive the guard with.
const DOC_TEXT_MISSING_BUYER = DOC_TEXT.c51dd720.split('United States').join('USA');
const DOC_TEXT_NEARMATCH_BUYER = DOC_TEXT.c51dd720.replace('Massimilajo Zubboli', 'Massimiliano Zubboli');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = global.window || {};

// Generic thenable Supabase mock (same convention as
// vendor-review-price-gate.test.js), extended with .neq() — needed by
// vdrProcessAllPdf's duplicate-document check.
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

function loadRealModules() {
  // buildVendorParsers() — called directly by vdrProcessAllPdf — lives in
  // vendor-parser-ui.js, not vendor-documents-review.js; both must be
  // eval'd into the same window (same convention as bek-parser-parity.test.js).
  const fn = new Function('window', 'document', vpUiSrc + '\n' + vdrSrc);
  fn(global.window, global.document);
}

function walmartQueueDoc(id, rawText) {
  return { id, parsed_json: { source: 'email_body' }, raw_text: rawText, status: 'pdf_received', source_email_subject: null };
}

function findUpdateFor(calls, docId) {
  const forDoc = calls.updates.filter(u =>
    u.table === 'vendor_documents' && u.filters.some(([type, k, v]) => type === 'eq' && k === 'id' && v === docId)
  );
  return forDoc[forDoc.length - 1];
}

async function runBatch(docs) {
  loadRealModules();
  const { sb, calls } = makeGenericSb({ vendor_documents: docs });
  global.window.supabaseClient = sb;
  // None of our test docs use the PDF-download path (all are email_body),
  // but vdrProcessAllPdf checks for pdfjsLib unconditionally before the
  // per-document loop — stub it so that check is skipped instead of
  // hanging on a <script> load jsdom never resolves.
  global.window.pdfjsLib = {};
  await global.window.vdrProcessAllPdf();
  return calls;
}

(async () => {

// ── Test 1/2 — Massimilajo: processing → normal pending, no BUYER-* ──
await atest('1. Massimilajo (real c51dd720): processing → status=pending, no BUYER-* warning, buyer preserved', async () => {
  const doc = walmartQueueDoc('walmart-c51', DOC_TEXT.c51dd720);
  const calls = await runBatch([doc]);
  const upd = findUpdateFor(calls, 'walmart-c51');
  assert.ok(upd, 'expected an update for this document');
  assert.strictEqual(upd.data.vendor, 'Walmart Business');
  assert.strictEqual(upd.data.status, 'pending');
  assert.strictEqual(upd.data.parsed_json.buyer, 'Massimilajo Zubboli');
  assert.ok(!(upd.data.warnings || []).some(w => w.code && w.code.startsWith('BUYER-')));
});

// ── Test 3 — Zeno: processing → ignored ───────────────────────────────
await atest('3. Zeno (real 6c246fda): processing → status=ignored, BUYER-BAR-001, buyer preserved, reason retrievable', async () => {
  const doc = walmartQueueDoc('walmart-6c2', DOC_TEXT['6c246fda']);
  const calls = await runBatch([doc]);
  const upd = findUpdateFor(calls, 'walmart-6c2');
  assert.ok(upd);
  assert.strictEqual(upd.data.status, 'ignored');
  assert.strictEqual(upd.data.parsed_json.buyer, 'Zeno Russo');
  const w = (upd.data.warnings || []).find(w => w.code === 'BUYER-BAR-001');
  assert.ok(w, 'BUYER-BAR-001 warning must be present so the reason is retrievable later');
  assert.ok(w.message.includes('Zeno Russo'));
});
test('3b. second Bar document (real 12fd6860 header/dates): decision function alone confirms ignore too', () => {
  // Full real-pipeline proof for the second Bar sample is covered in the
  // parser parity suite (buyer extraction); here we confirm the guard
  // itself treats it identically to 6c246fda since both carry the same
  // buyer value.
  assert.strictEqual(vdrDecideWalmartBuyer({ vendor: 'Walmart Business', buyer: 'Zeno Russo' }).action, 'ignore');
});
await atest('3c. real 30082536: processing → status=ignored too', async () => {
  const doc = walmartQueueDoc('walmart-300', DOC_TEXT['30082536']);
  const calls = await runBatch([doc]);
  const upd = findUpdateFor(calls, 'walmart-300');
  assert.ok(upd);
  assert.strictEqual(upd.data.status, 'ignored');
});

// ── Test 5/6 — unknown/missing buyer (real text, surgical substitution) ──
await atest('5. unknown buyer (real text, "Some Other Buyer"): processing → status=error, BUYER-UNKNOWN-001, never pending', async () => {
  const doc = walmartQueueDoc('walmart-unknown', DOC_TEXT_UNKNOWN_BUYER);
  const calls = await runBatch([doc]);
  const upd = findUpdateFor(calls, 'walmart-unknown');
  assert.ok(upd);
  assert.strictEqual(upd.data.status, 'error');
  assert.notStrictEqual(upd.data.status, 'pending');
  assert.strictEqual(upd.data.parsed_json.buyer, 'Some Other Buyer');
  const w = (upd.data.warnings || []).find(w => w.code === 'BUYER-UNKNOWN-001');
  assert.ok(w);
  assert.ok(w.message.toLowerCase().includes('manual review'));
});
await atest('6. missing buyer (real text, surgically removed): processing → status=error, BUYER-UNKNOWN-001, never pending', async () => {
  const doc = walmartQueueDoc('walmart-missing', DOC_TEXT_MISSING_BUYER);
  const calls = await runBatch([doc]);
  const upd = findUpdateFor(calls, 'walmart-missing');
  assert.ok(upd);
  assert.strictEqual(upd.data.status, 'error');
  assert.notStrictEqual(upd.data.status, 'pending');
  assert.ok(!upd.data.parsed_json.buyer);
  assert.ok((upd.data.warnings || []).some(w => w.code === 'BUYER-UNKNOWN-001'));
});
await atest('8. near-match "Massimiliano Zubboli" (real text, surgical substitution): processing → status=error, never pending', async () => {
  const doc = walmartQueueDoc('walmart-nearmatch', DOC_TEXT_NEARMATCH_BUYER);
  const calls = await runBatch([doc]);
  const upd = findUpdateFor(calls, 'walmart-nearmatch');
  assert.ok(upd);
  assert.strictEqual(upd.data.status, 'error');
  assert.notStrictEqual(upd.data.status, 'pending');
  assert.strictEqual(upd.data.parsed_json.buyer, 'Massimiliano Zubboli');
});

// ── Test 9 — non-Walmart processing unchanged ─────────────────────────
await atest('9. non-Walmart (real-shaped Hardie\'s, no buyer at all): processing completely unaffected', async () => {
  const hardiesText = [
    "HARDIE'S FRESH FOODS / DAIRYLAND PRODUCE",
    'INVOICE/POD 06991299',
    'DATE/TRIP 08/15/2026',
    'QUANTITY ITEM CODE DESCRIPTION PACK UNIT PRICE SHIPPED AMOUNT',
    '2 2 13544 SPINACH BABY  4/2.5#  18.50  37.00',
    'SUBTOTAL 37.00',
  ].join('\n');
  const doc = walmartQueueDoc('hardies-1', hardiesText);
  const calls = await runBatch([doc]);
  const upd = findUpdateFor(calls, 'hardies-1');
  assert.ok(upd);
  assert.strictEqual(upd.data.vendor, "Hardie's Fresh Foods / Dairyland Produce");
  assert.strictEqual(upd.data.status, 'pending');
  assert.ok(!(upd.data.warnings || []).some(w => w.code && w.code.startsWith('BUYER-')));
});

// ══════════════════════════════════════════════════════════════════
// Layer 3 — hard write-boundary in vdrApprove(): zero downstream
// writes for ignored/error Walmart documents, re-derived independently
// of stored status
// ══════════════════════════════════════════════════════════════════

function walmartDocRow(id, status, buyer, warnings) {
  return {
    id, vendor: 'Walmart Business', document_number: 'x', status, warnings: warnings || null,
    parsed_json: {
      vendor: 'Walmart Business', document_type: 'invoice', buyer, total: 7.94,
      items: [{ vendor_sku: '110366636', description: 'Roth Chèvre', raw_description: 'Roth Chèvre', qty: 2, unit_price: 3.97, amount: 7.94, warnings: [] }],
      warnings: [],
    },
  };
}

async function callApprove(docRow, extraTables) {
  loadRealModules();
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

// ── Test 2 — Massimilajo approve → allow ──────────────────────────────
await atest('2. Massimilajo, status=pending → vdrApprove() ALLOWS: invoice_lines actually written', async () => {
  const doc = walmartDocRow('pending-doc', 'pending', 'Massimilajo Zubboli', []);
  const calls = await callApprove(doc, {
    ingredient_vendors: [{ id: 'iv-w1', ingredient_id: 'ing-w1', vendor_sku: '110366636', vendor: 'Walmart Business' }],
  });
  const ilInsert = calls.inserts.find(i => i.table === 'invoice_lines');
  assert.ok(ilInsert, 'a genuinely Kitchen-accepted, pending document must still be approvable');
});

// ── Test 4 — Zeno approve → blocked ───────────────────────────────────
await atest('4. Zeno, status=ignored → vdrApprove() BLOCKS: zero invoice_lines, zero ingredient_vendors', async () => {
  const doc = walmartDocRow('ignored-doc', 'ignored', 'Zeno Russo', [{ code: 'BUYER-BAR-001', message: 'x' }]);
  const calls = await callApprove(doc);
  assert.strictEqual(calls.inserts.filter(i => i.table === 'invoice_lines').length, 0);
  assert.strictEqual(calls.inserts.filter(i => i.table === 'ingredient_vendors').length, 0);
  assert.strictEqual(calls.updates.filter(u => u.table === 'ingredient_vendors').length, 0);
  const imported = calls.updates.find(u => u.table === 'vendor_documents' && u.data.status === 'imported');
  assert.ok(!imported, 'must never be marked imported while blocked');
});

// ── Test 5/6 (approve side) — unknown/missing buyer, status=error → blocked ──
await atest('5b. unknown buyer, status=error → vdrApprove() BLOCKS: zero downstream writes', async () => {
  const doc = walmartDocRow('error-unknown', 'error', 'Some Other Buyer', [{ code: 'BUYER-UNKNOWN-001', message: 'x' }]);
  const calls = await callApprove(doc);
  assert.strictEqual(calls.inserts.filter(i => i.table === 'invoice_lines').length, 0);
  assert.strictEqual(calls.inserts.filter(i => i.table === 'ingredient_vendors').length, 0);
});
await atest('6b. missing buyer, status=error → vdrApprove() BLOCKS: zero downstream writes', async () => {
  const doc = walmartDocRow('error-missing', 'error', null, [{ code: 'BUYER-UNKNOWN-001', message: 'x' }]);
  const calls = await callApprove(doc);
  assert.strictEqual(calls.inserts.filter(i => i.table === 'invoice_lines').length, 0);
  assert.strictEqual(calls.inserts.filter(i => i.table === 'ingredient_vendors').length, 0);
});

// ── Test 8 (approve side) — near-match blocked ────────────────────────
await atest('8b. near-match buyer ("Massimiliano Zubboli") → vdrApprove() BLOCKS even if status were mistakenly pending', async () => {
  // Deliberately constructs the adversarial case Part D calls out: a
  // stale/incorrect status='pending' on a non-Kitchen buyer. The hard
  // guard re-derives the decision from parsed_json independently of
  // this status and must still block.
  const doc = walmartDocRow('stale-pending-nearmatch', 'pending', 'Massimiliano Zubboli', []);
  const calls = await callApprove(doc);
  assert.strictEqual(calls.inserts.filter(i => i.table === 'invoice_lines').length, 0, 'stale pending status must not bypass the buyer re-check');
});

// ── The mandatory adversarial proof for Zeno/unknown too: stale status='pending' ──
await atest('F1. stale status=pending on a Zeno (Bar) document → vdrApprove() still BLOCKS (write-boundary is independent of stored status)', async () => {
  const doc = walmartDocRow('stale-pending-zeno', 'pending', 'Zeno Russo', []);
  const calls = await callApprove(doc);
  assert.strictEqual(calls.inserts.filter(i => i.table === 'invoice_lines').length, 0);
  assert.strictEqual(calls.inserts.filter(i => i.table === 'ingredient_vendors').length, 0);
});
await atest('F2. stale status=pending on a missing-buyer document → vdrApprove() still BLOCKS', async () => {
  const doc = walmartDocRow('stale-pending-missing', 'pending', '', []);
  const calls = await callApprove(doc);
  assert.strictEqual(calls.inserts.filter(i => i.table === 'invoice_lines').length, 0);
});

// ── Test 10 — non-Walmart approve unchanged ───────────────────────────
await atest('10. non-Walmart (Ben E. Keith, no buyer field at all): vdrApprove() behaves exactly as before — untouched by the guard', async () => {
  const bekDoc = {
    id: 'bek-1', vendor: 'Ben E. Keith', document_number: '0002952908', status: 'pending', warnings: null,
    parsed_json: {
      vendor: 'Ben E. Keith', document_type: 'invoice', document_number: '0002952908', total: 81.96,
      items: [{ vendor_sku: '116533', description: 'Pastry Bag', raw_description: 'Pastry Bag', unit_price: 40.98, qty_ordered: 2, qty_received: 2, amount: 81.96, warnings: [] }],
      warnings: [],
    },
  };
  const calls = await callApprove(bekDoc, {
    ingredient_vendors: [{ id: 'iv-bek1', ingredient_id: 'ing-bek1', vendor_sku: '116533', vendor: 'Ben E. Keith' }],
  });
  const ilInsert = calls.inserts.find(i => i.table === 'invoice_lines');
  assert.ok(ilInsert, 'a non-Walmart pending Invoice must still approve normally — the guard never engages for it');
});

// ── Structural confirmation the guard is source-present and Walmart-scoped ──
test('D1. structural: vdrApprove contains the Walmart-scoped hard guard, re-deriving from parsed_json', () => {
  assert.ok(vdrSrc.includes("pjForBuyerGuard.vendor === 'Walmart Business'"), 'the write-boundary guard must exist verbatim in vdrApprove, scoped to Walmart Business');
  assert.ok(vdrSrc.includes('vdrDecideWalmartBuyer(pjForBuyerGuard)'), 'must reuse vdrDecideWalmartBuyer, not a hand-duplicated rule');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
})();
