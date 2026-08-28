// ══════════════════════════════════════════════════════════════════
// vendor-documents-review.js — Storage persistence (PDF survives parsing)
// Plain Node, zero external deps beyond jsdom: `node tests/vendor-review-storage-persistence.test.js`
//
// Root cause (proven on real production data, Storage Incident task):
// vdrProcessAllPdf() used to call storage.remove([storagePath]) right
// after ANY successful parse (parsed.items.length > 0), regardless of
// what happened next (Buyer Guard accept/ignore/review, final status).
// 20 of 21 real vendor_documents with a storage_path had already lost
// their PDF this way. New architecture: "PDF acquisito = PDF
// persistente" — the PDF survives every parsing outcome, always.
//
// This suite runs the REAL vdrProcessAllPdf() end-to-end against real
// PDF.js textContent.items fixtures (tests/fixtures/trevipay-samples.js
// — literal PDF.js output from real files, not synthetic), not a mock
// of the function itself, so the storage.remove() assertions are
// genuinely behavioral, not just structural string-absence checks.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const VDR_JS = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');
const VPU_JS = path.join(__dirname, '..', 'js', 'vendor-parser-ui.js');
const vdrSrc = fs.readFileSync(VDR_JS, 'utf8');
const vpuSrc = fs.readFileSync(VPU_JS, 'utf8');
const fixtures = require('./fixtures/trevipay-samples.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }
async function atest(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = global.window || {};

console.log('\nStorage persistence — PDF survives parsing (regression) — test run\n');

// ══════════════════════════════════════════════════════════════════
// Part A (structural) — the old removal is gone; the legitimate,
// unrelated duplicate-cleanup removal (a different document's
// redundant PDF, never this document's own source) is untouched.
// ══════════════════════════════════════════════════════════════════

test('structural: "Remove PDF from storage after successful parse" no longer exists', () => {
  assert.ok(!vdrSrc.includes('Remove PDF from storage after successful parse'));
});
test('structural: exactly ONE storage.remove call remains in the whole file — the unrelated DUPLICATE-cleanup one', () => {
  const matches = vdrSrc.match(/storage\.from\('app'\)\.remove\(/g) || [];
  assert.strictEqual(matches.length, 1, 'expected exactly 1 remove() call (duplicate cleanup), found ' + matches.length);
  const idx = vdrSrc.indexOf("storage.from('app').remove(");
  const nearby = vdrSrc.slice(Math.max(0, idx - 300), idx);
  assert.ok(nearby.includes('DUPLICATE'), 'the sole remaining remove() call must be the duplicate-cleanup one, not a reintroduced post-parse one');
});
test('structural: no remove() call exists anywhere between the Buyer Guard block and the end of the processing loop (covers accept/ignore/review uniformly)', () => {
  const buyerGuardIdx = vdrSrc.indexOf('FIX (Buyer Guard task): buyer is the sole authoritative signal');
  const loopEndIdx = vdrSrc.indexOf("if (log) log.textContent = `✓ Done", buyerGuardIdx);
  assert.ok(buyerGuardIdx > -1 && loopEndIdx > buyerGuardIdx);
  const span = vdrSrc.slice(buyerGuardIdx, loopEndIdx);
  assert.ok(!span.includes('.remove('), 'no path from Buyer Guard decision through end-of-loop may ever call remove() — this single span covers pending/ignored/error(review) outcomes identically, since they all share this same linear code path');
});

// ══════════════════════════════════════════════════════════════════
// Real end-to-end harness — actually runs vdrProcessAllPdf()
// ══════════════════════════════════════════════════════════════════

function makeFakePdfjs(pagesItems) {
  return {
    getDocument({ data }) {
      return {
        promise: Promise.resolve({
          numPages: pagesItems.length,
          getPage(i) {
            return Promise.resolve({
              getTextContent() { return Promise.resolve({ items: pagesItems[i - 1] }); },
            });
          },
        }),
      };
    },
    GlobalWorkerOptions: {},
  };
}

function makeSb(tables, downloadBytes, downloadError) {
  const calls = { updates: [], removes: [], downloads: [] };
  function builder(tableName) {
    const state = { filters: [] };
    const b = {
      select() { return b; },
      eq(k, v) { state.filters.push(['eq', k, v]); return b; },
      in(k, values) { state.filters.push(['in', k, values]); return b; },
      neq(k, v) { state.filters.push(['neq', k, v]); return b; },
      order() { return b; },
      limit() { return b; },
      single() { state.single = true; return b; },
      update(data) {
        calls.updates.push({ table: tableName, data });
        const ub = {
          eq(k, v) {
            let rows = (tables[tableName] || []).filter(r => r[k] === v);
            rows.forEach(r => Object.assign(r, data));
            return { then(resolve) { resolve({ error: null }); } };
          },
        };
        return ub;
      },
      insert(row) {
        const rows = Array.isArray(row) ? row : [row];
        (tables[tableName] = tables[tableName] || []).push(...rows);
        return { then(resolve) { resolve({ error: null }); } };
      },
      then(resolve) {
        let rows = (tables[tableName] || []).slice();
        for (const [type, k, v] of state.filters) {
          if (type === 'eq') rows = rows.filter(r => r[k] === v);
          if (type === 'in') rows = rows.filter(r => Array.isArray(v) && v.includes(r[k]));
          if (type === 'neq') rows = rows.filter(r => r[k] !== v);
        }
        if (state.single) resolve({ data: rows[0] || null, error: rows[0] ? null : { message: 'not found' } });
        else resolve({ data: rows, error: null });
      },
    };
    return b;
  }
  const storage = {
    from(bucket) {
      return {
        download(storagePath) {
          calls.downloads.push(storagePath);
          if (downloadError) return Promise.resolve({ data: null, error: { message: downloadError } });
          return Promise.resolve({ data: { arrayBuffer: () => Promise.resolve(downloadBytes || new ArrayBuffer(8)) }, error: null });
        },
        remove(paths) {
          calls.removes.push(paths);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { sb: { from: builder, storage }, calls };
}

function loadRealModules() {
  const fn = new Function('window', 'document', vpuSrc + '\n' + vdrSrc);
  fn(global.window, global.document);
}

function docRow(id, storagePath) {
  return { id, status: 'pdf_received', parsed_json: { storage_path: storagePath, original_filename: 'x.pdf' }, source_email_subject: 'test', raw_text: null };
}

function norm(pageItems, sb) {
  // Uses the real, already-live vdrNormalizeTreviPayPage indirectly by
  // just feeding raw fixture items — vdrProcessAllPdf calls it itself.
  return pageItems;
}

async function runProcessAllPdf(docId, tables, downloadError) {
  document.body.innerHTML = '';
  loadRealModules();
  global.window.pdfjsLib = makeFakePdfjs(tables.__pages || []);
  const { sb, calls } = makeSb(tables, tables.__downloadBytes, downloadError);
  global.window.supabaseClient = sb;
  await global.window.vdrProcessAllPdf(docId);
  return { calls, tables };
}

// ── H1: successful parse, Buyer Guard accept (real c51dd720 fixture, Kitchen) ──
(async () => {

await atest('H1 (real fixture, accept): successful parse -> status=pending, storage.remove NEVER called', async () => {
  const tables = {
    vendor_documents: [docRow('doc-accept', 'invoices/gmail/1_c51dd720.pdf')],
    __pages: [fixtures.C51DD720_PAGE1, fixtures.C51DD720_PAGE2],
  };
  const { calls, tables: t } = await runProcessAllPdf('doc-accept', tables);
  const row = t.vendor_documents.find(r => r.id === 'doc-accept');
  assert.strictEqual(row.status, 'pending');
  assert.strictEqual(row.parsed_json.items.length, 8);
  assert.strictEqual(calls.removes.length, 0, 'accept + successful parse must never call storage.remove');
  assert.strictEqual(row.parsed_json.storage_path, 'invoices/gmail/1_c51dd720.pdf', 'storage_path must remain valid/unchanged');
});

// ── H2: successful parse, Buyer Guard reject/ignore (real 6c246fda fixture, Bar/Zeno Russo) ──
await atest('H2 (real fixture, Buyer Guard ignore): successful parse but non-Kitchen buyer -> status=ignored, storage.remove NEVER called', async () => {
  const tables = {
    vendor_documents: [docRow('doc-ignore', 'invoices/gmail/2_6c246fda.pdf')],
    __pages: [fixtures.C6C246FDA_PAGE2, fixtures.C6C246FDA_PAGE3],
  };
  const { calls, tables: t } = await runProcessAllPdf('doc-ignore', tables);
  const row = t.vendor_documents.find(r => r.id === 'doc-ignore');
  assert.strictEqual(row.status, 'ignored');
  assert.ok(row.parsed_json.items.length > 0, 'parse succeeded — this is exactly the case the OLD code would have deleted the PDF for');
  assert.strictEqual(calls.removes.length, 0, 'Buyer Guard ignore + successful parse must never call storage.remove — this is the scenario that was actually broken before the fix');
});

// ── H3: parser error (empty/unparseable text) -> status=error, PDF never reachable for removal either way ──
await atest('H3: unparseable PDF (empty text) -> status=error, storage.remove NEVER called', async () => {
  const tables = {
    vendor_documents: [docRow('doc-parseerr', 'invoices/gmail/3_empty.pdf')],
    __pages: [[]], // zero text items -> "No text extracted"
  };
  const { calls, tables: t } = await runProcessAllPdf('doc-parseerr', tables);
  const row = t.vendor_documents.find(r => r.id === 'doc-parseerr');
  assert.strictEqual(row.status, 'error');
  assert.strictEqual(row.warnings[0].code, 'PROCESS_ERROR');
  assert.strictEqual(calls.removes.length, 0);
  assert.strictEqual(row.parsed_json.storage_path, 'invoices/gmail/3_empty.pdf', 'storage_path preserved even on parser error');
});

// ── H4: download failure (the real, live scenario for the 3 Walmart docs today) -> status=error, storage.remove NEVER called ──
await atest('H4: Storage download failure (the live 069a51f8/26104552 scenario) -> status=error, storage.remove NEVER called', async () => {
  const tables = {
    vendor_documents: [docRow('doc-dlerr', 'invoices/gmail/4_missing.pdf')],
    __pages: [],
  };
  const { calls, tables: t } = await runProcessAllPdf('doc-dlerr', tables, 'Object not found');
  const row = t.vendor_documents.find(r => r.id === 'doc-dlerr');
  assert.strictEqual(row.status, 'error');
  assert.strictEqual(row.warnings[0].code, 'PROCESS_ERROR');
  assert.ok(row.warnings[0].message.includes('Object not found'));
  assert.strictEqual(calls.removes.length, 0);
});

// ══════════════════════════════════════════════════════════════════
// Part D — idempotency / future Reprocess
// ══════════════════════════════════════════════════════════════════

await atest('D1: same vendor_document processed twice — same id/storage_path throughout, no new row created, no remove() across either run', async () => {
  const tables = {
    vendor_documents: [docRow('doc-twice', 'invoices/gmail/5_c51dd720.pdf')],
    __pages: [fixtures.C51DD720_PAGE1, fixtures.C51DD720_PAGE2],
  };
  // First run: pdf_received -> pending
  let result = await runProcessAllPdf('doc-twice', tables);
  assert.strictEqual(result.tables.vendor_documents.length, 1, 'no duplicate row after first run');
  assert.strictEqual(result.calls.removes.length, 0);
  const afterFirst = result.tables.vendor_documents[0];
  assert.strictEqual(afterFirst.status, 'pending');
  assert.strictEqual(afterFirst.parsed_json.storage_path, 'invoices/gmail/5_c51dd720.pdf');

  // Second run: pending -> reprocessed with the SAME (still-present) PDF —
  // this is exactly the future Reprocess scenario this task restores.
  tables.vendor_documents[0].status = 'pending'; // vdrProcessAllPdf(docId) already allows this via .in(['pdf_received','pending'])
  result = await runProcessAllPdf('doc-twice', tables);
  assert.strictEqual(result.tables.vendor_documents.length, 1, 'still no duplicate row after second run');
  assert.strictEqual(result.calls.removes.length, 0, 'second run must also never call storage.remove');
  const afterSecond = result.tables.vendor_documents[0];
  assert.strictEqual(afterSecond.status, 'pending');
  assert.strictEqual(afterSecond.parsed_json.items.length, 8, 'reprocessing re-derives parsed_json fresh from the still-present PDF');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
})();
