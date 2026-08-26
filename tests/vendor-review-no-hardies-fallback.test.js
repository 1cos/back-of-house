// ══════════════════════════════════════════════════════════════════
// vendor-documents-review.js — remove silent Hardie's vendor fallback
// Plain Node, zero external deps beyond jsdom: `node tests/vendor-review-no-hardies-fallback.test.js`
//
// Drives the REAL window.vdrProcessAllPdf() end-to-end (whole file
// eval'd, same convention as the Buyer Guard/line_type test suites)
// with real vendor detection (Hardie's/Walmart/unknown), via the real
// 'email_body' bypass path. Also proves the write-boundary for a fully
// unknown-vendor document by driving the REAL vdrApprove() against it.
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

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = global.window || {};

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
  const fn = new Function('window', 'document', vpUiSrc + '\n' + vdrSrc);
  fn(global.window, global.document);
}

function queueDoc(id, rawText) {
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
  global.window.pdfjsLib = {}; // skip the unconditional PDF.js load check — no PDF-download path used here
  await global.window.vdrProcessAllPdf();
  return calls;
}

console.log('\nVendor Review — remove silent Hardie\'s vendor fallback — regression tests\n');

// ── 1/4/5. Genuinely unrecognized text → NEVER Hardie's ──────────────
(async () => {

await atest('3. unrecognized text → vendor="unknown", NEVER "Hardie\'s Fresh Foods / Dairyland Produce"', async () => {
  const doc = queueDoc('unknown-1', 'This is a completely unrelated document with no vendor markers at all.');
  const calls = await runBatch([doc]);
  const upd = findUpdateFor(calls, 'unknown-1');
  assert.ok(upd);
  assert.strictEqual(upd.data.vendor, 'unknown');
  assert.notStrictEqual(upd.data.vendor, "Hardie's Fresh Foods / Dairyland Produce");
});

await atest('4. unrecognized text → status stays review-safe (error), never pending', async () => {
  const doc = queueDoc('unknown-2', 'This is a completely unrelated document with no vendor markers at all.');
  const calls = await runBatch([doc]);
  const upd = findUpdateFor(calls, 'unknown-2');
  assert.strictEqual(upd.data.status, 'error');
  assert.notStrictEqual(upd.data.status, 'pending');
});

test('warning: UNKNOWN_VENDOR already exists, already blocking severity, already info-only in vdrBuildQuestions — reused, not duplicated', () => {
  // Part G explicitly says not to build new warning infrastructure.
  // Confirms the decision: the existing UNKNOWN_VENDOR code (from
  // vendor-parsers/index.js's detectVendor fallback) already covers
  // this exact situation and is already wired into severity/question
  // handling — a second, parallel "VENDOR-UNKNOWN-001" code would be
  // redundant, not "coerente con le convenzioni esistenti".
  assert.ok(vdrSrc.includes("'UNKNOWN_VENDOR'"), 'UNKNOWN_VENDOR must already be a recognized code in this file');
  const severityBlock = vdrSrc.slice(vdrSrc.indexOf('function vdrCodeToSeverity'));
  assert.ok(severityBlock.slice(0, 400).includes('UNKNOWN_VENDOR'), 'UNKNOWN_VENDOR must already carry blocking severity');
});
await atest('unrecognized text → the existing UNKNOWN_VENDOR warning is actually recorded on the document', async () => {
  const doc = queueDoc('unknown-3', 'This is a completely unrelated document with no vendor markers at all.');
  const calls = await runBatch([doc]);
  const upd = findUpdateFor(calls, 'unknown-3');
  assert.ok((upd.data.warnings || []).some(w => w.code === 'UNKNOWN_VENDOR'));
});

// ── 5. zero downstream writes for a fully unknown-vendor document ────
await atest('5. unknown vendor → vdrApprove() creates ZERO invoice_lines and ZERO ingredient_vendors, even if forced through with a stale pending status', async () => {
  loadRealModules();
  const docRow = {
    id: 'unknown-approve-1', vendor: 'unknown', status: 'pending', warnings: [{ code: 'UNKNOWN_VENDOR', message: 'x' }],
    parsed_json: { vendor: null, document_type: 'invoice', items: [], warnings: [{ code: 'UNKNOWN_VENDOR', message: 'x' }] },
  };
  const tables = { vendor_documents: [docRow], ingredient_vendors: [], ingredient_links: [], invoice_lines: [] };
  const { sb, calls } = makeGenericSb(tables);
  global.window.supabaseClient = sb;
  global.window._vdrEdits = {};
  const btn = { disabled: false, textContent: '', style: {} };
  await global.window.vdrApprove('unknown-approve-1', btn);
  assert.strictEqual(calls.inserts.filter(i => i.table === 'invoice_lines').length, 0);
  assert.strictEqual(calls.inserts.filter(i => i.table === 'ingredient_vendors').length, 0);
  assert.strictEqual(calls.updates.filter(u => u.table === 'ingredient_vendors').length, 0);
  const imported = calls.updates.find(u => u.table === 'vendor_documents' && u.data.status === 'imported');
  assert.ok(!imported, 'an unknown-vendor document with zero extractable items must never be marked imported');
});

// ── 1/2. Hardie's and Walmart still recognized by REAL detection ─────
await atest('1. real-shaped Hardie\'s text → vendor="Hardie\'s Fresh Foods / Dairyland Produce", via detection/parsing, not fallback', async () => {
  const hardiesText = [
    "HARDIE'S FRESH FOODS / DAIRYLAND PRODUCE",
    'INVOICE/POD 06991299',
    'DATE/TRIP 08/15/2026',
    'QUANTITY ITEM CODE DESCRIPTION PACK UNIT PRICE SHIPPED AMOUNT',
    '2 2 13544 SPINACH BABY  4/2.5#  18.50  37.00',
    'SUBTOTAL 37.00',
  ].join('\n');
  const doc = queueDoc('hardies-real', hardiesText);
  const calls = await runBatch([doc]);
  const upd = findUpdateFor(calls, 'hardies-real');
  assert.strictEqual(upd.data.vendor, "Hardie's Fresh Foods / Dairyland Produce");
  assert.strictEqual(upd.data.status, 'pending', 'a genuinely recognized, well-formed Hardie\'s invoice must still process normally');
});

const fixtures = require('./fixtures/trevipay-samples.js');
const NORM_START = '// ── MARKER:VDR_TREVIPAY_NORMALIZE_START ────────────────────────────';
const NORM_END   = '// ── MARKER:VDR_TREVIPAY_NORMALIZE_END ──────────────────────────────';
const normBlock = vdrSrc.slice(vdrSrc.indexOf(NORM_START), vdrSrc.indexOf(NORM_END));
const { vdrNormalizeTreviPayPage } = new Function(normBlock + 'return { vdrNormalizeTreviPayPage };')();
function norm(items) { return vdrNormalizeTreviPayPage(items).text; }
const c51Text = norm(fixtures.C51DD720_PAGE1) + '\n' + norm(fixtures.C51DD720_PAGE2);

await atest('2. real c51dd720 → vendor="Walmart Business" (no change from prior tasks)', async () => {
  const doc = queueDoc('walmart-real', c51Text);
  const calls = await runBatch([doc]);
  const upd = findUpdateFor(calls, 'walmart-real');
  assert.strictEqual(upd.data.vendor, 'Walmart Business');
  assert.strictEqual(upd.data.status, 'pending');
  assert.strictEqual(upd.data.parsed_json.buyer, 'Massimilajo Zubboli');
});

// ── Adversarial: Walmart/TreviPay-shaped but corrupted text that the
// combined-signal detection can no longer recognize as Walmart at all
// (e.g. the "Walmart Business"/"TreviPay" markers themselves garbled) —
// must fall to genuinely unknown, never silently to Hardie's, and must
// never be approvable/importable by accident.
await atest('D. corrupted Walmart/TreviPay text (combined-signal detection fails) → unknown, NEVER Hardie\'s, review/error, not approvable', async () => {
  // Case-insensitive and thorough — a literal-case replace of "Walmart
  // Business"/"TreviPay" alone left the lowercase
  // "walmartbusiness.trevipay.app" URL text intact, which alone still
  // satisfies the combined-signal detection (by design, robustly) and
  // defeated the point of this adversarial case on the first attempt.
  const corrupted = c51Text.replace(/walmart/gi, 'XXXXXXX').replace(/trevipay/gi, 'XXXXXXXX');
  const doc = queueDoc('corrupted-walmart', corrupted);
  const calls = await runBatch([doc]);
  const upd = findUpdateFor(calls, 'corrupted-walmart');
  assert.ok(upd);
  assert.strictEqual(upd.data.vendor, 'unknown');
  assert.notStrictEqual(upd.data.vendor, "Hardie's Fresh Foods / Dairyland Produce");
  assert.notStrictEqual(upd.data.vendor, 'Walmart Business');
  assert.strictEqual(upd.data.status, 'error');
});

// ── F. vendor already known at intake is not silently overwritten with Hardie's ──
await atest('6a. intake vendor already a real, different value + parser fails to recognize → still becomes "unknown", never silently Hardie\'s or the stale intake guess', async () => {
  // Documents intake, in this codebase, only ever writes an initial
  // vendor via two paths: gmail-hardies-import (hardcoded "Hardie's...")
  // or gmail-vendor-import (a subject/filename heuristic guess, itself
  // defaulting to 'unknown'). Neither is selected by the batch query
  // this file already runs (`.select('id,parsed_json,source_email_subject,
  // raw_text')` — no `vendor` column), so it is never available to
  // "preserve" at this point without broadening that shared query.
  // Decision (documented, not just asserted): trusting an earlier
  // subject/filename guess when the full-document-text parser ALSO
  // fails to recognize anything is no safer than the Hardie's fallback
  // this task removes — it would just move the same class of mistake
  // one step earlier. 'unknown' is used instead, deliberately.
  assert.ok(vdrSrc.includes(".select('id,parsed_json,source_email_subject,raw_text')"),
    'the batch query genuinely does not select vendor — confirms the decision basis, not just asserts it');
  const doc = queueDoc('intake-known-1', 'This is a completely unrelated document with no vendor markers at all.');
  const calls = await runBatch([doc]);
  const upd = findUpdateFor(calls, 'intake-known-1');
  assert.strictEqual(upd.data.vendor, 'unknown');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
})();
