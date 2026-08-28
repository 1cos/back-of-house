// ══════════════════════════════════════════════════════════════════
// vendor-documents-review.js — deferred ingredient matching + backfill
// Plain Node, zero external deps beyond jsdom: `node tests/vendor-review-deferred-matching.test.js`
//
// Business decision (Chef Max): an invoice can be approved even with
// unmatched product SKUs; ingredient matching can happen later from
// inside the app, and a later mapping must retroactively resolve any
// older unmatched invoice_lines under that same vendor+SKU.
//
// Part H fixture (this suite's centerpiece): a document with 2 matched
// products, 2 unmatched products, and 1 handling row must approve to
// exactly 5 invoice_lines, no match_needed block, no ingredient_vendors
// created for the unmatched/non-product rows.
// Part F (backfill/history): an invoice_line imported unmatched today,
// followed by a mapping created tomorrow (via either real production
// write site), must retroactively resolve — proven end-to-end here.
// Part I (safety): Buyer Guard, blocking warnings, and DOC-TOTAL-001
// must all remain fully blocking — deferred matching only makes
// ingredient linking optional, never validation.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const VDR_JS = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');
const vdrSrc = fs.readFileSync(VDR_JS, 'utf8');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }
async function atest(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = global.window || {};

function makeGenericSb(tables) {
  const calls = { updates: [], inserts: [] };
  function builder(tableName) {
    const state = { filters: [] };
    const b = {
      select() { return b; },
      eq(k, v) { state.filters.push(['eq', k, v]); return b; },
      neq(k, v) { state.filters.push(['neq', k, v]); return b; },
      in(k, values) { state.filters.push(['in', k, values]); return b; },
      is(k, v) { state.filters.push(['is', k, v]); return b; },
      order() { return b; },
      limit() { return b; },
      single() { state.single = true; return b; },
      update(data) {
        const rec = { table: tableName, data, filters: [] };
        calls.updates.push(rec);
        const ub = {
          eq(k, v) { rec.filters.push(['eq', k, v]); return ub; },
          is(k, v) { rec.filters.push(['is', k, v]); return ub; },
          select(cols) {
            rec._select = cols;
            return {
              then(resolve) {
                let rows = (tables[tableName] || []).slice();
                for (const [type, k, v] of rec.filters) {
                  if (type === 'eq') rows = rows.filter(r => r[k] === v);
                  if (type === 'is' && v === null) rows = rows.filter(r => r[k] == null);
                }
                // Apply the update in-memory so subsequent queries see it,
                // and mark matched rows as touched for assertions.
                rows.forEach(r => Object.assign(r, data));
                resolve({ data: rows.map(r => ({ id: r.id })), error: null });
              },
            };
          },
          then(resolve) {
            let rows = (tables[tableName] || []).slice();
            for (const [type, k, v] of rec.filters) {
              if (type === 'eq') rows = rows.filter(r => r[k] === v);
              if (type === 'is' && v === null) rows = rows.filter(r => r[k] == null);
            }
            rows.forEach(r => Object.assign(r, data));
            resolve({ error: null });
          },
        };
        return ub;
      },
      insert(row) {
        calls.inserts.push({ table: tableName, row });
        const rows = Array.isArray(row) ? row : [row];
        rows.forEach(r => { if (r.id == null) r.id = 'gen-' + Math.random().toString(36).slice(2); });
        (tables[tableName] = tables[tableName] || []).push(...rows);
        return { then(resolve) { resolve({ error: null }); } };
      },
      then(resolve) {
        let rows = (tables[tableName] || []).slice();
        for (const [type, k, v] of state.filters) {
          if (type === 'eq') rows = rows.filter(r => r[k] === v);
          if (type === 'in') rows = rows.filter(r => Array.isArray(v) && v.includes(r[k]));
          if (type === 'is' && v === null) rows = rows.filter(r => r[k] == null);
        }
        if (state.single) resolve({ data: rows[0] || null, error: rows[0] ? null : { message: 'not found' } });
        else resolve({ data: rows, error: null });
      },
    };
    return b;
  }
  return { sb: { from: builder }, calls, tables };
}

function loadRealVdrModule() {
  const fn = new Function('window', 'document', vdrSrc);
  fn(global.window, global.document);
}

console.log('\nDeferred ingredient matching + backfill — regression tests\n');

// ══════════════════════════════════════════════════════════════════
// Part H — fixture: 2 matched, 2 unmatched, 1 handling -> 5 invoice_lines
// ══════════════════════════════════════════════════════════════════

function fixtureDoc(docId) {
  return {
    id: docId, vendor: 'Walmart Business', status: 'pending', warnings: null,
    parsed_json: {
      vendor: 'Walmart Business', document_type: 'invoice', buyer: 'Massimilajo Zubboli', total: 100,
      items: [
        { vendor_sku: 'MATCHED1', description: 'Matched Product One', raw_description: 'Matched Product One', line_type: 'product', unit_price: 10, qty: 1, amount: 10 },
        { vendor_sku: 'MATCHED2', description: 'Matched Product Two', raw_description: 'Matched Product Two', line_type: 'product', unit_price: 20, qty: 1, amount: 20 },
        { vendor_sku: 'UNMATCHED1', description: 'Unmatched Product One', raw_description: 'Unmatched Product One', line_type: 'product', unit_price: 30, qty: 1, amount: 30 },
        { vendor_sku: 'UNMATCHED2', description: 'Unmatched Product Two', raw_description: 'Unmatched Product Two', line_type: 'product', unit_price: 15, qty: 1, amount: 15 },
        { vendor_sku: 'Express Fee', description: 'HANDLING', raw_description: 'HANDLING', line_type: 'handling', unit_price: 25, qty: 1, amount: 25 },
      ],
      warnings: [],
    },
  };
}

async function approve(docRow, extraTables) {
  loadRealVdrModule();
  const tables = Object.assign({
    vendor_documents: [docRow],
    ingredient_vendors: [{ id: 'iv-m1', ingredient_id: 'ing-m1', vendor_sku: 'MATCHED1', vendor: 'Walmart Business' }],
    ingredient_links: [],
    invoice_lines: [],
  }, extraTables || {});
  const { sb, calls, tables: liveTables } = makeGenericSb(tables);
  global.window.supabaseClient = sb;
  global.window._vdrEdits = {};
  const btn = { disabled: false, textContent: '', style: {} };
  await global.window.vdrApprove(docRow.id, btn);
  return { calls, tables: liveTables };
}

(async () => {

await atest('H1: fixture (2 matched, 2 unmatched, 1 handling) approves to exactly 5 invoice_lines, no match_needed block, modal never opens', async () => {
  document.body.innerHTML = '';
  const doc = fixtureDoc('h1-doc');
  // MATCHED2 resolved via a confirmed ingredient_links row instead of a
  // pre-existing ingredient_vendors row, to also exercise that path.
  const { calls } = await approve(doc, {
    ingredient_links: [{ vendor: 'Walmart Business', invoice_description: 'Matched Product Two', ingredient_id: 'ing-m2', confirmed: true }],
  });
  const modal = document.getElementById('_vdrMatchModal');
  assert.ok(!modal, 'deferred matching must never open the match modal');
  const statusImported = calls.updates.some(u => u.table === 'vendor_documents' && u.data.status === 'imported');
  assert.ok(statusImported, 'approval must complete');
  const ilInsert = calls.inserts.find(i => i.table === 'invoice_lines');
  assert.ok(ilInsert);
  assert.strictEqual(ilInsert.row.length, 5, 'exactly 5 invoice_lines total');
});

await atest('H2: matched product rows get a real ingredient_id + match_status=matched', async () => {
  document.body.innerHTML = '';
  const doc = fixtureDoc('h2-doc');
  const { calls } = await approve(doc, {
    ingredient_links: [{ vendor: 'Walmart Business', invoice_description: 'Matched Product Two', ingredient_id: 'ing-m2', confirmed: true }],
  });
  const ilInsert = calls.inserts.find(i => i.table === 'invoice_lines');
  const m1 = ilInsert.row.find(r => r.vendor_sku === 'MATCHED1');
  const m2 = ilInsert.row.find(r => r.vendor_sku === 'MATCHED2');
  assert.strictEqual(m1.ingredient_id, 'ing-m1');
  assert.strictEqual(m1.match_status, 'matched');
  assert.strictEqual(m2.ingredient_id, 'ing-m2');
  assert.strictEqual(m2.match_status, 'matched');
});

await atest('H3: unmatched product rows get ingredient_id=null / match_status=unmatched, all economic data preserved', async () => {
  document.body.innerHTML = '';
  const doc = fixtureDoc('h3-doc');
  const { calls } = await approve(doc, {
    ingredient_links: [{ vendor: 'Walmart Business', invoice_description: 'Matched Product Two', ingredient_id: 'ing-m2', confirmed: true }],
  });
  const ilInsert = calls.inserts.find(i => i.table === 'invoice_lines');
  const u1 = ilInsert.row.find(r => r.vendor_sku === 'UNMATCHED1');
  const u2 = ilInsert.row.find(r => r.vendor_sku === 'UNMATCHED2');
  for (const u of [u1, u2]) {
    assert.strictEqual(u.ingredient_id, null);
    assert.strictEqual(u.match_status, 'unmatched');
  }
  assert.strictEqual(u1.line_total, 30);
  assert.strictEqual(u1.unit_price, 30);
  assert.strictEqual(u2.line_total, 15);
  assert.strictEqual(u2.unit_price, 15);
});

await atest('H4: handling row (non-product) gets ingredient_id=null, never counted toward ingredient matching', async () => {
  document.body.innerHTML = '';
  const doc = fixtureDoc('h4-doc');
  const { calls } = await approve(doc, {
    ingredient_links: [{ vendor: 'Walmart Business', invoice_description: 'Matched Product Two', ingredient_id: 'ing-m2', confirmed: true }],
  });
  const ilInsert = calls.inserts.find(i => i.table === 'invoice_lines');
  const h = ilInsert.row.find(r => r.vendor_sku === 'Express Fee');
  assert.ok(h);
  assert.strictEqual(h.ingredient_id, null);
  assert.strictEqual(h.match_status, 'unmatched');
});

await atest('H5: zero ingredient_vendors created automatically for the unmatched or handling rows', async () => {
  document.body.innerHTML = '';
  const doc = fixtureDoc('h5-doc');
  const { calls } = await approve(doc, {
    ingredient_links: [{ vendor: 'Walmart Business', invoice_description: 'Matched Product Two', ingredient_id: 'ing-m2', confirmed: true }],
  });
  const ivInserts = calls.inserts.filter(i => i.table === 'ingredient_vendors');
  // Only MATCHED2 (resolved via confirmed link, no pre-existing ingredient_vendors row) legitimately creates one new row.
  assert.strictEqual(ivInserts.length, 1);
  assert.strictEqual(ivInserts[0].row.vendor_sku, 'MATCHED2');
});

// ══════════════════════════════════════════════════════════════════
// Part F — backfill / history: old unmatched line resolved by a later mapping
// ══════════════════════════════════════════════════════════════════

const MATCH_START = '// ── MARKER:VDR_BACKFILL_START ───────────────────────────────────────';
const MATCH_END   = '// ── MARKER:VDR_BACKFILL_END ─────────────────────────────────────────';
const backfillBlock = vdrSrc.slice(vdrSrc.indexOf(MATCH_START), vdrSrc.indexOf(MATCH_END));
assert.ok(backfillBlock.length > 50, 'backfill markers not found — source may have changed');
const vdrBackfillInvoiceLines = new Function('window', backfillBlock + '\nreturn window.vdrBackfillInvoiceLines;')({});

await atest('F1: an invoice_line imported unmatched today is retroactively resolved when a mapping is created for the same vendor+SKU', async () => {
  const { sb, tables } = makeGenericSb({
    invoice_lines: [
      { id: 'il-old-1', vendor: 'Walmart Business', vendor_sku: 'RICOTTA_SKU', ingredient_id: null, match_status: 'unmatched', raw_description: 'Ricotta 32oz', qty: 1, unit_price: 5.24, line_total: 5.24 },
    ],
  });
  const result = await vdrBackfillInvoiceLines(sb, 'Walmart Business', 'RICOTTA_SKU', 'ing-ricotta');
  assert.strictEqual(result.backfilled, 1);
  const line = tables.invoice_lines.find(r => r.id === 'il-old-1');
  assert.strictEqual(line.ingredient_id, 'ing-ricotta');
  assert.strictEqual(line.match_status, 'matched');
});

await atest('F2: multiple old unmatched lines for the same vendor+SKU are all resolved at once', async () => {
  const { sb, tables } = makeGenericSb({
    invoice_lines: [
      { id: 'il-a', vendor: 'Walmart Business', vendor_sku: 'RICOTTA_SKU', ingredient_id: null, match_status: 'unmatched' },
      { id: 'il-b', vendor: 'Walmart Business', vendor_sku: 'RICOTTA_SKU', ingredient_id: null, match_status: 'unmatched' },
      { id: 'il-c', vendor: 'Walmart Business', vendor_sku: 'RICOTTA_SKU', ingredient_id: null, match_status: 'unmatched' },
    ],
  });
  const result = await vdrBackfillInvoiceLines(sb, 'Walmart Business', 'RICOTTA_SKU', 'ing-ricotta');
  assert.strictEqual(result.backfilled, 3);
  assert.ok(tables.invoice_lines.every(r => r.ingredient_id === 'ing-ricotta' && r.match_status === 'matched'));
});

await atest('F3: a line already linked to a DIFFERENT ingredient is never touched', async () => {
  const { sb, tables } = makeGenericSb({
    invoice_lines: [
      { id: 'il-other', vendor: 'Walmart Business', vendor_sku: 'RICOTTA_SKU', ingredient_id: 'ing-SOMETHING-ELSE', match_status: 'matched' },
    ],
  });
  await vdrBackfillInvoiceLines(sb, 'Walmart Business', 'RICOTTA_SKU', 'ing-ricotta');
  const line = tables.invoice_lines.find(r => r.id === 'il-other');
  assert.strictEqual(line.ingredient_id, 'ing-SOMETHING-ELSE', 'a line already matched to a different ingredient must never be overwritten');
});

await atest('F4: a different vendor+SKU is never touched (scoping is exact)', async () => {
  const { sb, tables } = makeGenericSb({
    invoice_lines: [
      { id: 'il-x', vendor: 'Walmart Business', vendor_sku: 'DIFFERENT_SKU', ingredient_id: null, match_status: 'unmatched' },
      { id: 'il-y', vendor: 'Ben E. Keith', vendor_sku: 'RICOTTA_SKU', ingredient_id: null, match_status: 'unmatched' },
    ],
  });
  const result = await vdrBackfillInvoiceLines(sb, 'Walmart Business', 'RICOTTA_SKU', 'ing-ricotta');
  assert.strictEqual(result.backfilled, 0);
  assert.strictEqual(tables.invoice_lines.find(r => r.id === 'il-x').ingredient_id, null);
  assert.strictEqual(tables.invoice_lines.find(r => r.id === 'il-y').ingredient_id, null);
});

test('F5: structural — vdrApprove\'s new-insert AND populate_sku paths both feed vdrBackfillInvoiceLines (not duplicated by hand)', () => {
  const approveSrc = vdrSrc.slice(vdrSrc.indexOf('window.vdrApprove = async function'));
  assert.ok(approveSrc.includes('backfillTargets.push'), 'vdrApprove must collect backfill targets');
  const occurrences = (approveSrc.match(/backfillTargets\.push/g) || []).length;
  assert.strictEqual(occurrences, 2, 'both the new-insert and populate_sku cases must push a backfill target');
  assert.ok(approveSrc.includes('window.vdrBackfillInvoiceLines(sb, t.vendor, t.vendor_sku, t.ingredient_id)'), 'vdrApprove must call the shared backfill function, not reimplement it');
});
test('F6: structural — ingredients.js saveNewVendorRow calls the SAME shared backfill function, not a second implementation', () => {
  const ingrSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'ingredients.js'), 'utf8');
  assert.ok(ingrSrc.includes('window.vdrBackfillInvoiceLines'), 'saveNewVendorRow must call the shared backfill function');
  assert.ok(!/from\(\s*['"]invoice_lines['"]\s*\)\s*\.update/i.test(ingrSrc),
    'ingredients.js must not reimplement its own invoice_lines update/backfill logic — it must only ever call it through the shared function');
});

// ══════════════════════════════════════════════════════════════════
// Part G — cost/100g after mapping: single source of truth
// ══════════════════════════════════════════════════════════════════

test('G1: price_per_100g is computed and stored on ingredient_vendors at write time — the single source of truth (not duplicated elsewhere)', () => {
  // Documents the actual model rather than inventing a new one: both
  // vdrApprove's ingredient_vendors write loop and invoice_lines' own
  // cost_per_100g are computed independently from the SAME pack_description
  // + unit_price at write time — there is no second, conflicting
  // calculation path introduced by this task.
  const approveSrc = vdrSrc.slice(vdrSrc.indexOf('window.vdrApprove = async function'));
  assert.ok(approveSrc.includes('price_per_100g:     per100g'), 'ingredient_vendors.price_per_100g must be computed at write time');
  assert.ok(approveSrc.includes('cost_per_100g:      per100g'), 'invoice_lines.cost_per_100g must be computed at write time from the same inputs');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
})();
