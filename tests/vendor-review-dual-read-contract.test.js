// ══════════════════════════════════════════════════════════════════
// Dual-Read Transition Contract (vendor_item_aliases authoritative,
// ingredient_vendors legacy fallback) — permanent test suite, Parts A-E
// Plain Node: `node tests/vendor-review-dual-read-contract.test.js`
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const VDR_JS = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');
const vdrSrc = fs.readFileSync(VDR_JS, 'utf8');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }
async function atest(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }

console.log('\nDual-Read Transition Contract (vendor_item_aliases + ingredient_vendors fallback) — test run\n');

// Extract vdrComputeMatchStatus and vdrPreflight via their real source
// markers — the exact live functions, never a reimplementation.
const MATCH_START = '// ── MARKER:VDR_MATCH_STATUS_START ───────────────────────────────────';
const MATCH_END   = '// ── MARKER:VDR_MATCH_STATUS_END ─────────────────────────────────────';
const matchBlock = vdrSrc.slice(vdrSrc.indexOf(MATCH_START), vdrSrc.indexOf(MATCH_END));
assert.ok(matchBlock.length > 100, 'match-status markers not found — source may have changed');
const { vdrComputeMatchStatus } = new Function(matchBlock + '\nreturn { vdrComputeMatchStatus };')();

// vdrPreflight is a plain function declaration further down the file —
// extract it directly by its own signature, dependent only on
// vdrBuildQuestions (stubbed here since these tests never exercise the
// warnings-gate path) and window.supabaseClient equivalents (passed as sb).
const PREFLIGHT_START = 'async function vdrPreflight(docId, doc) {';
const preflightStartIdx = vdrSrc.indexOf(PREFLIGHT_START);
assert.ok(preflightStartIdx > -1, 'vdrPreflight not found — source may have changed');
const preflightEndIdx = vdrSrc.indexOf('\n}\n', preflightStartIdx) + 3;
const preflightSrc = vdrSrc.slice(preflightStartIdx, preflightEndIdx);
const { vdrPreflight } = new Function(
  'vdrBuildQuestions',
  preflightSrc + '\nreturn { vdrPreflight };'
)(function vdrBuildQuestions() { return []; }); // no open questions in these fixtures

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

function walmartDoc(id, sku, desc) {
  return { id, document_type: 'invoice', vendor: 'Walmart Business', parsed_json: { vendor: 'Walmart Business', items: [{ vendor_sku: sku, description: desc, line_type: 'product', amount: 1 }] } };
}

(async () => {

// ══════════════════════════════════════════════════════════════════
// A — alias present, active, ingredient_vendors absent -> MATCHED via alias
// ══════════════════════════════════════════════════════════════════
await atest('A: alias present (active) + no ingredient_vendors row -> MATCHED via vdrComputeMatchStatus', async () => {
  const doc = walmartDoc('dA', 'SKU-A', 'Chicken Breast A');
  const sb = makeSb({
    vendor_item_aliases: [{ vendor_sku: 'SKU-A', vendor: 'Walmart Business', ingredient_id: 'ing-chicken', active: true }],
    ingredient_vendors: [],
    ingredient_links: [],
  });
  const status = await vdrComputeMatchStatus(sb, [doc]);
  assert.strictEqual(status['dA'].needsMatching, false, 'alias alone must be sufficient — matched');
  assert.ok(!status['dA'].unmatchedSkuSet.has('SKU-A'));
});

await atest('A (vdrPreflight): alias present + no ingredient_vendors row -> unmatchedCount 0', async () => {
  const sb = makeSb({
    vendor_item_aliases: [{ vendor_sku: 'SKU-A', vendor: 'Walmart Business', ingredient_id: 'ing-chicken', active: true }],
    ingredient_vendors: [],
  });
  const doc = { document_type: 'invoice', parsed_json: { vendor: 'Walmart Business', items: [{ vendor_sku: 'SKU-A', description: 'Chicken Breast A', line_type: 'product' }] } };
  // vdrPreflight reads window.supabaseClient internally, not a param — patch global for this call.
  global.window = global.window || {};
  global.window.supabaseClient = sb;
  const pre = await vdrPreflight('dA', doc);
  assert.strictEqual(pre.ok, true);
  assert.strictEqual(pre.unmatchedCount, 0, 'alias alone must satisfy vdrPreflight too');
});

// ══════════════════════════════════════════════════════════════════
// B — alias absent, legacy ingredient_vendors present -> MATCHED via fallback
// ══════════════════════════════════════════════════════════════════
await atest('B: no alias + legacy ingredient_vendors row present -> MATCHED via temporary fallback', async () => {
  const doc = walmartDoc('dB', 'SKU-B', 'Ground Beef B');
  const sb = makeSb({
    vendor_item_aliases: [],
    ingredient_vendors: [{ vendor_sku: 'SKU-B', vendor: 'Walmart Business', ingredient_id: 'ing-beef' }],
    ingredient_links: [],
  });
  const status = await vdrComputeMatchStatus(sb, [doc]);
  assert.strictEqual(status['dB'].needsMatching, false, 'legacy fallback must still work during transition');
});

// ══════════════════════════════════════════════════════════════════
// C — both exist and agree -> MATCHED, no conflict
// ══════════════════════════════════════════════════════════════════
await atest('C: alias and legacy ingredient_vendors agree on the same ingredient_id -> MATCHED, no conflict', async () => {
  const doc = walmartDoc('dC', 'SKU-C', 'Zucchini C');
  const sb = makeSb({
    vendor_item_aliases: [{ vendor_sku: 'SKU-C', vendor: 'Walmart Business', ingredient_id: 'ing-zucchini', active: true }],
    ingredient_vendors: [{ vendor_sku: 'SKU-C', vendor: 'Walmart Business', ingredient_id: 'ing-zucchini' }],
    ingredient_links: [],
  });
  const status = await vdrComputeMatchStatus(sb, [doc]);
  assert.strictEqual(status['dC'].needsMatching, false);
  assert.strictEqual(status['dC'].conflictSkuSet.size, 0, 'agreement must never be flagged as a conflict');
});

// ══════════════════════════════════════════════════════════════════
// D — divergence -> CONFLICT, never silently resolved
// ══════════════════════════════════════════════════════════════════
await atest('D: alias says ingredient A, legacy says ingredient B -> CONFLICT, never silently matched to either', async () => {
  const doc = walmartDoc('dD', 'SKU-D', 'Ambiguous D');
  const sb = makeSb({
    vendor_item_aliases: [{ vendor_sku: 'SKU-D', vendor: 'Walmart Business', ingredient_id: 'ing-A', active: true }],
    ingredient_vendors: [{ vendor_sku: 'SKU-D', vendor: 'Walmart Business', ingredient_id: 'ing-B' }],
    ingredient_links: [],
  });
  const status = await vdrComputeMatchStatus(sb, [doc]);
  assert.strictEqual(status['dD'].needsMatching, true, 'a real divergence must never be silently treated as matched');
  assert.ok(status['dD'].unmatchedSkuSet.has('SKU-D'), 'still surfaces as needing attention, not resolved either way');
  assert.ok(status['dD'].conflictSkuSet.has('SKU-D'), 'explicitly flagged as a conflict, not just a generic unmatched row');
});

// ══════════════════════════════════════════════════════════════════
// E — alias inactive -> never an active source of truth
// ══════════════════════════════════════════════════════════════════
await atest('E: alias exists but active=false + no legacy fallback -> NOT matched', async () => {
  const doc = walmartDoc('dE', 'SKU-E', 'Inactive E');
  const sb = makeSb({
    vendor_item_aliases: [{ vendor_sku: 'SKU-E', vendor: 'Walmart Business', ingredient_id: 'ing-x', active: false }],
    ingredient_vendors: [],
    ingredient_links: [],
  });
  const status = await vdrComputeMatchStatus(sb, [doc]);
  assert.strictEqual(status['dE'].needsMatching, true, 'an inactive alias must never be an active source of truth');
  assert.ok(status['dE'].unmatchedSkuSet.has('SKU-E'));
});

test('E: structural — the vendor_item_aliases lookup explicitly filters .eq(\'active\', true)', () => {
  const s = vdrSrc.indexOf(MATCH_START);
  const e = vdrSrc.indexOf(MATCH_END);
  const block = vdrSrc.slice(s, e);
  assert.ok(/from\('vendor_item_aliases'\)[^;]*\.eq\('active', true\)/.test(block), 'vendor_item_aliases query must filter to active rows only, documented and enforced');
});

// ══════════════════════════════════════════════════════════════════
// Part 4 — Ingredient Card contract (saveNewVendorRow)
// ══════════════════════════════════════════════════════════════════
const { JSDOM } = require('jsdom');
const domForCard = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = domForCard.window.document;
global.window = global; // real browser semantics — bare identifiers resolve against the true global

const ingSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'ingredients.js'), 'utf8');
const vpuSrc2 = fs.readFileSync(path.join(__dirname, '..', 'js', 'vendor-parser-ui.js'), 'utf8');
global.addSwipeToClose = function() {};
global.showScToast = function() {};

function makeSbForCard(tables) {
  function builder(tableName) {
    const state = { filters: [] };
    const b = {
      select() { return b; }, eq(k, v) { state.filters.push(['eq', k, v]); return b; },
      in(k, values) { state.filters.push(['in', k, values]); return b; },
      is(k, v) { state.filters.push(['is', k, v]); return b; },
      single() { state.single = true; return b; },
      update(data) {
        const ub = { eq(k, v) { state.filters.push(['eq', k, v]); return ub; },
          is(k, v) { state.filters.push(['is', k, v]); return ub; },
          select() {
            let rows = (tables[tableName] || []).slice();
            for (const [type, k, v] of state.filters) { if (type === 'eq') rows = rows.filter(r => r[k] === v); if (type === 'is') rows = rows.filter(r => v === null ? (r[k] == null) : r[k] === v); }
            rows.forEach(r => Object.assign(r, data));
            return { then(resolve) { resolve({ data: rows, error: null }); } };
          } };
        return ub;
      },
      upsert(row, opts) {
        const conflictCols = (opts && opts.onConflict || '').split(',');
        const existing = (tables[tableName] || []).find(r => conflictCols.every(c => r[c] === row[c]));
        if (existing) { Object.assign(existing, row); return { then(resolve) { resolve({ error: null }); } }; }
        const newRow = Object.assign({ id: 'gen-' + Math.random().toString(36).slice(2) }, row);
        (tables[tableName] = tables[tableName] || []).push(newRow);
        return { then(resolve) { resolve({ error: null }); } };
      },
      insert(row) {
        const rows = Array.isArray(row) ? row : [row];
        rows.forEach(r => { if (r.id == null) r.id = 'gen-' + Math.random().toString(36).slice(2); });
        (tables[tableName] = tables[tableName] || []).push(...rows);
        return { select() { return { single() { return Promise.resolve({ data: rows[0], error: null }); } }; }, then(resolve) { resolve({ error: null }); } };
      },
      then(resolve) {
        let rows = (tables[tableName] || []).slice();
        for (const [type, k, v] of state.filters) { if (type === 'eq') rows = rows.filter(r => r[k] === v); if (type === 'in') rows = rows.filter(r => Array.isArray(v) && v.includes(r[k])); }
        if (state.single) resolve({ data: rows[0] || null, error: rows[0] ? null : { message: 'not found' } });
        else resolve({ data: rows, error: null });
      },
    };
    return b;
  }
  return { from: builder };
}

function loadCardModules() {
  document.body.innerHTML = '';
  const fn = new Function('window', 'document', vpuSrc2 + '\n' + vdrSrc);
  fn(window, document);
}

await atest('4a: saveNewVendorRow with a real vendor_sku -> both ingredient_vendors (price) AND vendor_item_aliases (identity) written, backfill runs', async () => {
  loadCardModules();
  const tables = {
    ingredient_vendors: [], vendor_item_aliases: [],
    invoice_lines: [
      { id: 'l1', vendor: 'Walmart Business', vendor_sku: '99999999', ingredient_id: null, match_status: 'unmatched' },
      { id: 'l2', vendor: 'Walmart Business', vendor_sku: '99999999', ingredient_id: null, match_status: 'unmatched' },
    ],
  };
  const sb = makeSbForCard(tables);
  global.supa = sb;
  global.openIngredientCard = function() {};
  new Function('window', 'document', ingSrc)(global.window, global.document);

  document.body.innerHTML = `
    <input id="avUnitPrice" value="10" /><input id="avConversion" value="1000" />
    <select id="avPriceType"><option value="per_case" selected>per_case</option></select>
    <input id="avPricePerEach" value="" /><input id="avVendor" value="Walmart Business" />
    <input id="avSku" value="99999999" /><input id="avPackDesc" value="5lb bag" />
    <div class="fixed inset-0"><button id="saveBtn"></button></div>`;
  await window.saveNewVendorRow('ing-test', document.getElementById('saveBtn'));

  assert.strictEqual(tables.ingredient_vendors.length, 1, 'exactly one price-intelligence write');
  assert.strictEqual(tables.vendor_item_aliases.length, 1, 'exactly one identity write');
  assert.strictEqual(tables.vendor_item_aliases[0].vendor_sku, '99999999');
  assert.ok(tables.invoice_lines.every(l => l.ingredient_id === 'ing-test'), 'backfill correctly ran for the new alias');
  delete global.supa;
});

await atest('4b: saveNewVendorRow with NO vendor_sku -> price written, NO alias created (never an empty/invented identity row)', async () => {
  loadCardModules();
  const tables = { ingredient_vendors: [], vendor_item_aliases: [] };
  const sb = makeSbForCard(tables);
  global.supa = sb;
  global.openIngredientCard = function() {};
  new Function('window', 'document', ingSrc)(global.window, global.document);

  document.body.innerHTML = `
    <input id="avUnitPrice" value="10" /><input id="avConversion" value="1000" />
    <select id="avPriceType"><option value="per_case" selected>per_case</option></select>
    <input id="avPricePerEach" value="" /><input id="avVendor" value="Walmart Business" />
    <input id="avSku" value="" /><input id="avPackDesc" value="5lb bag" />
    <div class="fixed inset-0"><button id="saveBtn"></button></div>`;
  await window.saveNewVendorRow('ing-test2', document.getElementById('saveBtn'));

  assert.strictEqual(tables.ingredient_vendors.length, 1, 'price intelligence still saved');
  assert.strictEqual(tables.vendor_item_aliases.length, 0, 'no alias created when vendor_sku is empty — never an invented identity row');
  delete global.supa;
});

test('4c: structural — vendor_description is never hardcoded/invented; only the real form field (pack_description) or the helper\'s own explicit "SKU "+sku fallback are used', () => {
  const s = ingSrc.indexOf('window.saveNewVendorRow');
  const block = ingSrc.slice(s, s + 2500);
  assert.ok(block.includes('packDescVal'), 'must pass the real form-derived description, not a hardcoded string');
  assert.ok(!/vendorDescription\s*:\s*['"][^'"]+['"]/.test(block), 'must never hardcode a fake description literal');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
})();
