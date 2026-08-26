// ══════════════════════════════════════════════════════════════════
// vdrAutoImportCleanHardiesInvoices() — regression tests (T1-T10)
// Plain Node, no framework: `node tests/vendor-review-hardies-auto-import.test.js`
//
// Same convention as vendor-review-canonical-sku-guard.test.js: extract
// the real function via marker, eval it with an INJECTED vdrPreflight
// (a controllable stand-in for the already-existing gate, not a
// reimplementation of it) and a mocked window.vdrApprove (the already
// -existing, already-tested write path — this suite is not re-testing
// vdrApprove itself, only that auto-import calls it exactly when, and
// only when, the gate says ok:true).
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

const START = '// ── MARKER:VDR_AUTO_IMPORT_START ─────────────────────────────────';
const END = '// ── MARKER:VDR_AUTO_IMPORT_END ───────────────────────────────────';
const startIdx = src.indexOf(START);
const endIdx = src.indexOf(END);
assert.ok(startIdx >= 0 && endIdx > startIdx, 'markers not found — source may have changed');
const block = src.slice(startIdx, endIdx);

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0,2).join(' | ') : e)); }
}
async function atest(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0,2).join(' | ') : e)); }
}

const HARDIES = "Hardie's Fresh Foods / Dairyland Produce";

// Builds a fresh isolated instance of the function with an injectable
// vdrPreflight (mocked gate) and a mocked window.vdrApprove (mocked write).
function makeInstance({ preflightResults = {}, approveMock = async () => {} } = {}) {
  const fakeVdrPreflight = async (docId) => {
    if (preflightResults[docId]) return preflightResults[docId];
    return { ok: true };
  };
  global.window = { _vdrAllDocs: [], vdrApprove: approveMock, vdrLoad: () => {} };
  const fn = new Function('vdrPreflight', 'window', block + '\nreturn vdrAutoImportCleanHardiesInvoices;')(fakeVdrPreflight, global.window);
  return fn;
}

function doc(overrides) {
  return Object.assign({
    id: 'doc-1', vendor: HARDIES, status: 'pending',
    parsed_json: { document_type: 'invoice', items: [] },
    document_number: 'DOC-1',
  }, overrides);
}

(async () => {
  console.log('\nvdrAutoImportCleanHardiesInvoices() — regression tests\n');

  // ── T1: normal invoice, zero warnings → auto-import ────────────────
  await atest('T1: clean invoice (preflight ok) gets approved automatically', async () => {
    const calls = [];
    const approveMock = async (docId) => { calls.push(docId); };
    const fn = makeInstance({ preflightResults: { 'doc-1': { ok: true } }, approveMock });
    window._vdrAllDocs = [doc({ id: 'doc-1' })];
    await fn();
    assert.deepStrictEqual(calls, ['doc-1']);
  });

  // ── T2/T3: known ingredient (Romaine/Beef Steak) → same path, no new question ──
  await atest('T2: a document whose gate is already clean (Romaine-like) is approved without any extra question logic here', async () => {
    const calls = [];
    const fn = makeInstance({ preflightResults: { 'doc-romaine': { ok: true } }, approveMock: async (id) => calls.push(id) });
    window._vdrAllDocs = [doc({ id: 'doc-romaine', document_number: 'ROMAINE-DOC' })];
    await fn();
    assert.deepStrictEqual(calls, ['doc-romaine']);
  });
  await atest('T3: a second known-ingredient document behaves identically (no per-ingredient special-casing exists here)', async () => {
    const calls = [];
    const fn = makeInstance({ preflightResults: { 'doc-beef': { ok: true } }, approveMock: async (id) => calls.push(id) });
    window._vdrAllDocs = [doc({ id: 'doc-beef' })];
    await fn();
    assert.deepStrictEqual(calls, ['doc-beef']);
  });

  // ── T4: a real open question → left untouched, no approve call ─────
  await atest('T4: preflight not-ok (real question) is left alone, never approved', async () => {
    const calls = [];
    const fn = makeInstance({ preflightResults: { 'doc-q': { ok: false, reason: '1 question to answer' } }, approveMock: async (id) => calls.push(id) });
    window._vdrAllDocs = [doc({ id: 'doc-q' })];
    await fn();
    assert.deepStrictEqual(calls, []);
  });

  // ── T5: unmatched item (match_needed) → left for a human ────────────
  await atest('T5: match_needed is left for a human, not approved', async () => {
    const calls = [];
    const fn = makeInstance({ preflightResults: { 'doc-m': { ok: false, reason: 'match_needed', unmatched: [{}] } }, approveMock: async (id) => calls.push(id) });
    window._vdrAllDocs = [doc({ id: 'doc-m' })];
    await fn();
    assert.deepStrictEqual(calls, []);
  });

  // ── T6: parsing failure (status='error') never touched ──────────────
  await atest('T6: status=error documents are never candidates (real parsing failure stays untouched)', async () => {
    const calls = [];
    const fn = makeInstance({ approveMock: async (id) => calls.push(id) });
    window._vdrAllDocs = [doc({ id: 'doc-err', status: 'error' })];
    await fn();
    assert.deepStrictEqual(calls, []);
  });

  // ── T7: same invoice received twice — only one gets processed here; ──
  // real dedupe is vdrApprove's own "already imported" guard, untouched.
  await atest('T7: two docs with the same document_number are each evaluated independently (dedupe is vdrApprove\'s job, unchanged)', async () => {
    const calls = [];
    const fn = makeInstance({
      preflightResults: { 'doc-a': { ok: true }, 'doc-b': { ok: true } },
      approveMock: async (id) => calls.push(id),
    });
    window._vdrAllDocs = [doc({ id: 'doc-a', document_number: 'SAME-NUM' }), doc({ id: 'doc-b', document_number: 'SAME-NUM' })];
    await fn();
    assert.strictEqual(calls.length, 2); // this function doesn't invent new dedupe logic — vdrApprove's own guard (untouched) is the real safety net
  });

  // ── T8: canonical SKU guard v825 is not bypassed ────────────────────
  test('T8: auto-import calls the real window.vdrApprove — the same function that contains the v825 canonical-SKU guard — never a parallel write path', () => {
    assert.ok(block.includes('window.vdrApprove(doc.id, noopBtn)'), 'must call the real, unmodified vdrApprove for every write');
    assert.ok(!/skuMap|ingrVendorMap|toUpdate\.push/.test(block), 'auto-import must not reimplement any of the ingredient_vendors write logic itself');
  });

  // ── T9: invoice_date propagation untouched ──────────────────────────
  test('T9: auto-import contains no date-handling logic of its own — invoice_date propagation is entirely vdrApprove\'s existing, already-fixed responsibility', () => {
    assert.ok(!/invoice_date|document_date/.test(block), 'auto-import must not touch date fields directly — that logic already lives in vdrApprove');
  });

  // ── T10: scope — only Hardie's, only invoice, only status=pending ───
  await atest('T10a: a non-Hardie\'s vendor document is never touched', async () => {
    const calls = [];
    const fn = makeInstance({ preflightResults: { 'doc-fp': { ok: true } }, approveMock: async (id) => calls.push(id) });
    window._vdrAllDocs = [doc({ id: 'doc-fp', vendor: 'Freshpoint Dallas' })];
    await fn();
    assert.deepStrictEqual(calls, []);
  });
  await atest('T10b: an order_confirmation document (not an invoice) is never touched', async () => {
    const calls = [];
    const fn = makeInstance({ preflightResults: { 'doc-oc': { ok: true } }, approveMock: async (id) => calls.push(id) });
    window._vdrAllDocs = [doc({ id: 'doc-oc', parsed_json: { document_type: 'order_confirmation', items: [] } })];
    await fn();
    assert.deepStrictEqual(calls, []);
  });
  await atest('T10c: a pdf_received (not yet parsed) document is never touched', async () => {
    const calls = [];
    const fn = makeInstance({ preflightResults: { 'doc-pdf': { ok: true } }, approveMock: async (id) => calls.push(id) });
    window._vdrAllDocs = [doc({ id: 'doc-pdf', status: 'pdf_received', parsed_json: null })];
    await fn();
    assert.deepStrictEqual(calls, []);
  });

  // ── Extra: re-entrancy guard prevents overlapping runs ──────────────
  await atest('Extra: calling the function while it is already running is a safe no-op (reentrancy guard)', async () => {
    let resolveFirst;
    const gate = new Promise(r => { resolveFirst = r; });
    const calls = [];
    const fn = makeInstance({
      preflightResults: { 'doc-slow': { ok: true } },
      approveMock: async (id) => { calls.push(id); await gate; },
    });
    window._vdrAllDocs = [doc({ id: 'doc-slow' })];
    const p1 = fn();
    const p2 = fn(); // fired while p1 is still mid-flight
    resolveFirst();
    await Promise.all([p1, p2]);
    assert.strictEqual(calls.length, 1, 'the overlapping call must not double-process the same document');
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail > 0 ? 1 : 0);
})();
