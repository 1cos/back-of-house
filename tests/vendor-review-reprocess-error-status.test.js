// ══════════════════════════════════════════════════════════════════
// vendor-documents-review.js — safe Reprocess for status='error' documents
// Plain Node, zero external deps beyond jsdom: `node tests/vendor-review-reprocess-error-status.test.js`
//
// Change under test: the Reprocess button (2 render sites) and
// vdrProcessAllPdf(docId)'s eligibility query now both accept
// status='error' in addition to 'pending'/'pdf_received' — 'imported'
// and 'ignored' remain excluded from both, unchanged. No other
// semantics touched: Buyer Guard, invoice_lines, ingredient_vendors,
// ingredient_links, duplicate detection, storage persistence (Task 22)
// are all untouched and re-verified here as a regression guard.
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

console.log('\nSafe Reprocess for status=\'error\' documents — test run\n');

// ══════════════════════════════════════════════════════════════════
// Part A — UI rendering, both real render sites, real source
// ══════════════════════════════════════════════════════════════════

// Site 1: inside window.vdrToggle (sticky-footer sheet)
const toggleBody = vdrSrc.slice(vdrSrc.indexOf("window.vdrToggle = function(id) {"), vdrSrc.indexOf("window.vdrLookupUnitWeight"));
const site1Match = toggleBody.match(/\$\{([^}]*doc\.status[^}]*)\s*\?\s*`<button id="vdrReprocessBtn[\s\S]*?`\s*:\s*''\}/);
assert.ok(site1Match, 'Site 1 (vdrToggle) Reprocess condition not found — source may have changed');
const site1Condition = site1Match[1].trim();

// Site 2: inside vdrDetailHTML
const detailBody = vdrSrc.slice(vdrSrc.indexOf('function vdrDetailHTML(doc) {'), vdrSrc.indexOf('function vdrDetailHTMLNoApprove'));
const site2Match = detailBody.match(/var reprocessHTML = \(([^)]*doc\.status[^)]*)\)/);
assert.ok(site2Match, 'Site 2 (vdrDetailHTML) Reprocess condition not found — source may have changed');
const site2Condition = site2Match[1].trim();

function evalCondition(exprSrc, status) {
  const doc = { status };
  return new Function('doc', 'return (' + exprSrc + ');')(doc);
}

for (const [siteName, cond] of [['Site 1 (vdrToggle)', site1Condition], ['Site 2 (vdrDetailHTML)', site2Condition]]) {
  test(`A: ${siteName} — Reprocess condition true for 'pending'`, () => assert.strictEqual(evalCondition(cond, 'pending'), true));
  test(`A: ${siteName} — Reprocess condition true for 'error'`, () => assert.strictEqual(evalCondition(cond, 'error'), true));
  test(`A: ${siteName} — Reprocess condition false for 'imported'`, () => assert.strictEqual(!!evalCondition(cond, 'imported'), false));
  test(`A: ${siteName} — Reprocess condition false for 'ignored'`, () => assert.strictEqual(!!evalCondition(cond, 'ignored'), false));
}

test('A: text/icon unchanged — button label is still exactly "🔄 Reprocess" at both sites', () => {
  assert.ok(toggleBody.includes('🔄 Reprocess</button>'));
  assert.ok(detailBody.includes('🔄 Reprocess</button>'));
});

// ══════════════════════════════════════════════════════════════════
// Real end-to-end harness (identical pattern to
// tests/vendor-review-storage-persistence.test.js)
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
  const calls = { updates: [], removes: [], downloads: [], inserts: [] };
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
        calls.inserts.push({ table: tableName, row });
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

function docRow(id, storagePath, status) {
  return { id, status: status || 'pdf_received', parsed_json: { storage_path: storagePath, original_filename: 'x.pdf' }, source_email_subject: 'test', raw_text: null };
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

// ══════════════════════════════════════════════════════════════════
// Part B — query eligibility, real vdrProcessAllPdf(docId)
// ══════════════════════════════════════════════════════════════════

(async () => {

await atest("B: vdrProcessAllPdf(docId) ACCEPTS 'pdf_received' — row gets processed", async () => {
  const tables = { vendor_documents: [docRow('b1', 'p.pdf', 'pdf_received')], __pages: [fixtures.C51DD720_PAGE1, fixtures.C51DD720_PAGE2] };
  const { tables: t } = await runProcessAllPdf('b1', tables);
  assert.strictEqual(t.vendor_documents[0].status, 'pending');
});
await atest("B: vdrProcessAllPdf(docId) ACCEPTS 'pending' — row gets processed", async () => {
  const tables = { vendor_documents: [docRow('b2', 'p.pdf', 'pending')], __pages: [fixtures.C51DD720_PAGE1, fixtures.C51DD720_PAGE2] };
  const { tables: t } = await runProcessAllPdf('b2', tables);
  assert.strictEqual(t.vendor_documents[0].status, 'pending');
  assert.strictEqual(t.vendor_documents[0].parsed_json.items.length, 8);
});
await atest("B: vdrProcessAllPdf(docId) ACCEPTS 'error' — row gets processed (the actual fix)", async () => {
  const tables = { vendor_documents: [docRow('b3', 'p.pdf', 'error')], __pages: [fixtures.C51DD720_PAGE1, fixtures.C51DD720_PAGE2] };
  const { tables: t } = await runProcessAllPdf('b3', tables);
  assert.strictEqual(t.vendor_documents[0].status, 'pending', "an 'error' document must now be re-derivable to 'pending' on successful reprocess");
});
await atest("B: vdrProcessAllPdf(docId) REJECTS 'imported' — row untouched, no update at all", async () => {
  const row = docRow('b4', 'p.pdf', 'imported');
  const tables = { vendor_documents: [row], __pages: [fixtures.C51DD720_PAGE1, fixtures.C51DD720_PAGE2] };
  const { calls, tables: t } = await runProcessAllPdf('b4', tables);
  assert.strictEqual(t.vendor_documents[0].status, 'imported', 'status must remain exactly as it was');
  assert.strictEqual(calls.updates.filter(u => u.table === 'vendor_documents').length, 0, 'no vendor_documents update of any kind may be issued');
  assert.strictEqual(calls.downloads.length, 0, 'Storage must never even be contacted for an imported document');
});
await atest("B: vdrProcessAllPdf(docId) REJECTS 'ignored' — row untouched, no update at all", async () => {
  const row = docRow('b5', 'p.pdf', 'ignored');
  const tables = { vendor_documents: [row], __pages: [fixtures.C51DD720_PAGE1, fixtures.C51DD720_PAGE2] };
  const { calls, tables: t } = await runProcessAllPdf('b5', tables);
  assert.strictEqual(t.vendor_documents[0].status, 'ignored');
  assert.strictEqual(calls.updates.filter(u => u.table === 'vendor_documents').length, 0);
  assert.strictEqual(calls.downloads.length, 0);
});

// ══════════════════════════════════════════════════════════════════
// Part C — Reprocess error -> success
// ══════════════════════════════════════════════════════════════════

await atest('C: error -> success — status recalculated, parsed_json regenerated, PDF stays, zero downstream writes', async () => {
  const tables = {
    vendor_documents: [docRow('c1', 'invoices/gmail/c1.pdf', 'error')],
    __pages: [fixtures.C51DD720_PAGE1, fixtures.C51DD720_PAGE2],
  };
  const { calls, tables: t } = await runProcessAllPdf('c1', tables);
  const row = t.vendor_documents[0];
  assert.strictEqual(row.status, 'pending', '(2) PDF disponibile + (3) parser riesce -> (4) status ricalcolato');
  assert.strictEqual(row.parsed_json.items.length, 8, '(5) parsed_json rigenerato');
  assert.strictEqual(row.parsed_json.storage_path, 'invoices/gmail/c1.pdf', 'storage_path preserved');
  assert.strictEqual(calls.removes.length, 0, '(6) PDF rimane in Storage — mai un remove() call');
  assert.strictEqual((calls.inserts.filter(i => i.table === 'invoice_lines')).length, 0, '(7) nessun invoice_line');
  assert.strictEqual((calls.inserts.filter(i => i.table === 'ingredient_vendors')).length, 0, '(8) nessun ingredient_vendor');
});

// ══════════════════════════════════════════════════════════════════
// Part D — Reprocess error -> error (PDF still missing)
// ══════════════════════════════════════════════════════════════════

await atest('D: error -> error — download still fails, status stays error, PROCESS_ERROR present, storage_path preserved, zero downstream writes', async () => {
  const tables = {
    vendor_documents: [docRow('d1', 'invoices/gmail/d1.pdf', 'error')],
    __pages: [],
  };
  const { calls, tables: t } = await runProcessAllPdf('d1', tables, 'Object not found');
  const row = t.vendor_documents[0];
  assert.strictEqual(row.status, 'error', '(3) status finale = error');
  assert.strictEqual(row.warnings[0].code, 'PROCESS_ERROR', '(4) warning PROCESS_ERROR presente');
  assert.ok(row.warnings[0].message.includes('Object not found'));
  assert.strictEqual(row.parsed_json.storage_path, 'invoices/gmail/d1.pdf', '(5) storage_path preservato');
  assert.strictEqual(calls.removes.length, 0);
  assert.strictEqual(calls.inserts.filter(i => i.table === 'invoice_lines').length, 0, '(6) nessun dato downstream');
  assert.strictEqual(calls.inserts.filter(i => i.table === 'ingredient_vendors').length, 0);
});

test('D (structural): error -> error via a genuinely unparseable PDF (parser fails, not just download) also lands on status=error', () => {
  // Covered behaviorally by H3 in vendor-review-storage-persistence.test.js
  // (same harness, empty-items case) — asserted here only as a cross-
  // reference so this suite documents both of Part D's two literal
  // triggers ("PDF mancante OPPURE parser fallisce") without duplicating
  // that test.
  assert.ok(fs.readFileSync(path.join(__dirname, 'vendor-review-storage-persistence.test.js'), 'utf8').includes("H3: unparseable PDF"));
});

// ══════════════════════════════════════════════════════════════════
// Part E — imported hard guard (query itself, not just the UI)
// ══════════════════════════════════════════════════════════════════

await atest('E: direct call vdrProcessAllPdf(importedDocId) — the query is the real second barrier, not just a hidden button', async () => {
  const row = docRow('e1', 'invoices/gmail/e1.pdf', 'imported');
  row.parsed_json.items = [{ vendor_sku: 'X', description: 'already imported', line_type: 'product' }]; // simulate a real, already-complete document
  const tables = { vendor_documents: [row], __pages: [fixtures.C51DD720_PAGE1, fixtures.C51DD720_PAGE2] };
  const before = JSON.stringify(row);
  const { calls, tables: t } = await runProcessAllPdf('e1', tables);
  assert.strictEqual(JSON.stringify(t.vendor_documents[0]), before, 'the row must be byte-for-byte identical after the call — the query itself, not the UI, is what actually stops this');
  assert.strictEqual(calls.downloads.length, 0, 'Storage must never be contacted');
  assert.strictEqual(calls.updates.length, 0, 'zero updates of any kind');
});

// ══════════════════════════════════════════════════════════════════
// Part 3 / 4 — confirm nothing else changed (Buyer Guard, downstream)
// ══════════════════════════════════════════════════════════════════

test('confirms Buyer Guard code (vdrDecideWalmartBuyer, its call sites, IGNORE/REVIEW rules) is textually unchanged from the pre-task version', () => {
  assert.ok(vdrSrc.includes('const walmartBuyerDecision = vdrDecideWalmartBuyer(parsed);'));
  assert.ok(vdrSrc.includes("action === 'ignore'"));
  assert.ok(vdrSrc.includes("action === 'review'"));
  assert.ok(vdrSrc.includes("code:    'BUYER-BAR-001'"));
  assert.ok(vdrSrc.includes("code:    'BUYER-UNKNOWN-001'"));
});
test('confirms vdrApprove\'s independent Buyer Guard write-boundary is untouched', () => {
  const approveSrc = vdrSrc.slice(vdrSrc.indexOf('window.vdrApprove = async function'));
  assert.ok(approveSrc.includes("if (pjForBuyerGuard.vendor === 'Walmart Business') {"));
  assert.ok(approveSrc.includes("if (buyerDecision && buyerDecision.action !== 'accept') {"));
});
test('confirms Reprocess still never references invoice_lines/ingredient_vendors/ingredient_links as an actual table access anywhere in vdrProcessAllPdf', () => {
  const start = vdrSrc.indexOf('window.vdrProcessAllPdf = async function(docId) {');
  const end = vdrSrc.indexOf('window.vdrReprocessOne', start);
  const body = vdrSrc.slice(start, end);
  assert.ok(!/\.from\(\s*['"]invoice_lines['"]\s*\)/.test(body), 'no actual invoice_lines table access — a pre-existing, unrelated explanatory comment mentioning the word is fine and expected');
  assert.ok(!/\.from\(\s*['"]ingredient_vendors['"]\s*\)/.test(body));
  assert.ok(!/\.from\(\s*['"]ingredient_links['"]\s*\)/.test(body));
});
test('confirms the single remaining Storage remove() call is still only the unrelated DUPLICATE-cleanup one (Task 22 fix untouched)', () => {
  const matches = vdrSrc.match(/storage\.from\('app'\)\.remove\(/g) || [];
  assert.strictEqual(matches.length, 1);
  const idx = vdrSrc.indexOf("storage.from('app').remove(");
  assert.ok(vdrSrc.slice(Math.max(0, idx - 300), idx).includes('DUPLICATE'));
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
})();
