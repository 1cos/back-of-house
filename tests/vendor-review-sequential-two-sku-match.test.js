// ══════════════════════════════════════════════════════════════════
// REGRESSION TEST (Part H) — two different vendor SKUs can
// sequentially map to the same ingredient in one document/session.
// Plain Node: `node tests/vendor-review-sequential-two-sku-match.test.js`
//
// HISTORY (bug this test guards against): the live ingredient_vendors
// table has a real UNIQUE constraint on (ingredient_id, vendor) — NOT
// (vendor, vendor_sku) as the application code (vdrSaveVendorSkuMapping)
// correctly assumes. Two different vendor_sku values that legitimately
// resolve to the SAME ingredient (e.g. two different Walmart Chicken
// Breast SKUs) could never coexist as two rows pre-fix — the second
// INSERT was rejected by the database itself, even though the
// application's own existence check (vendor+vendor_sku) correctly
// found nothing and proceeded. Fixed by detecting exactly that known
// constraint and treating it as a successful match for the second SKU
// (the backfill only needs vendor+vendorSku+ingredientId as
// parameters, never a matching ingredient_vendors row to physically
// exist) — never by touching the shared DB schema, which 4 other
// legacy call sites (js/invoice.js, js/admin-ingredients.js) still
// rely on via their own onConflict:'ingredient_id,vendor' upserts.
//
// This mock's `insert()` enforces that EXACT real constraint (mirrors
// the live schema exactly, confirmed via pg_indexes), so this test
// genuinely exercises the fix against the real-world failure mode —
// not a simplified mock that would hide the issue. Must fail pre-fix,
// pass post-fix.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const VDR_JS = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');
const VPU_JS = path.join(__dirname, '..', 'js', 'vendor-parser-ui.js');
const vdrSrc = fs.readFileSync(VDR_JS, 'utf8');
const vpuSrc = fs.readFileSync(VPU_JS, 'utf8');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }
async function atest(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); } }

const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="vdrVendorTabs"></div><div id="vdrList"></div></body></html>`);
global.document = dom.window.document;
global.window = global;
global.addSwipeToClose = function() {};
global.showScToast = function() {};

console.log('\nSequential two-SKU match — bug reproduction + regression test\n');

function loadRealModules() {
  document.body.innerHTML = '<div id="vdrVendorTabs"></div><div id="vdrList"></div>';
  const fn = new Function('window', 'document', vpuSrc + '\n' + vdrSrc);
  fn(window, document);
}

// Mock Supabase that enforces the REAL live production constraint on
// ingredient_vendors: UNIQUE (ingredient_id, vendor) — confirmed via
// pg_indexes audit against the live database, not assumed.
function makeSbWithRealConstraint(tables) {
  const calls = { inserts: [], updates: [] };
  function builder(tableName) {
    const state = { filters: [] };
    const b = {
      select() { return b; },
      eq(k, v) { state.filters.push(['eq', k, v]); return b; },
      in(k, values) { state.filters.push(['in', k, values]); return b; },
      is(k, v) { state.filters.push(['is', k, v]); return b; },
      order() { return b; },
      limit() { return b; },
      single() { state.single = true; return b; },
      ilike() { return b; },
      update(data) {
        calls.updates.push({ table: tableName, data });
        const ub = {
          eq(k, v) { state.filters.push(['eq', k, v]); return ub; },
          is(k, v) { state.filters.push(['is', k, v]); return ub; },
          select() {
            let rows = (tables[tableName] || []).slice();
            for (const [type, k, v] of state.filters) {
              if (type === 'eq') rows = rows.filter(r => r[k] === v);
              if (type === 'is') rows = rows.filter(r => v === null ? (r[k] === null || r[k] === undefined) : r[k] === v);
            }
            rows.forEach(r => Object.assign(r, data));
            return { then(resolve) { resolve({ data: rows, error: null }); } };
          },
        };
        return ub;
      },
      insert(row) {
        calls.inserts.push({ table: tableName, row });
        if (tableName === 'ingredient_vendors') {
          // ── REAL CONSTRAINT (live schema, pg_indexes-confirmed) ──
          const conflict = (tables.ingredient_vendors || []).find(
            r => r.vendor === row.vendor && r.ingredient_id === row.ingredient_id
          );
          if (conflict) {
            return {
              select() { return { single() { return Promise.resolve({ data: null, error: { message: 'duplicate key value violates unique constraint "ingredient_vendors_ingredient_id_vendor_key"' } }); } }; },
              then(resolve) { resolve({ error: { message: 'duplicate key value violates unique constraint "ingredient_vendors_ingredient_id_vendor_key"' } }); },
            };
          }
        }
        const rows = Array.isArray(row) ? row : [row];
        rows.forEach(r => { if (r.id == null) r.id = 'gen-' + Math.random().toString(36).slice(2); });
        (tables[tableName] = tables[tableName] || []).push(...rows);
        return { select() { return { single() { return Promise.resolve({ data: rows[0], error: null }); } }; }, then(resolve) { resolve({ error: null }); } };
      },
      then(resolve) {
        let rows = (tables[tableName] || []).slice();
        for (const [type, k, v] of state.filters) {
          if (type === 'eq') rows = rows.filter(r => r[k] === v);
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

function item(sku, desc, lineType, pack) {
  return { vendor_sku: sku, description: desc, raw_description: desc, line_type: lineType, pack_description: pack || null, unit_price: 1, qty: 1, amount: 1, warnings: [] };
}

const DESC_19400236 = 'Perdue Harvestland, Free Range, Fresh Boneless Chicken Breast, 1.50–4.30 lb Tray';
const DESC_27935840 = 'Freshness Guaranteed Boneless Skinless Chicken Breasts, 2.75–7.0 lb Tray';

function makeFixture() {
  const items = [
    ...Array.from({ length: 8 }, () => item('19400236', DESC_19400236, 'product', '1.50-4.30lb Tray')),
    ...Array.from({ length: 7 }, () => item('27935840', DESC_27935840, 'product', '2.75-7.0lb Tray')),
  ];
  const doc = {
    id: 'doc-26104552', status: 'imported', vendor: 'Walmart Business', document_number: '26104552', document_type: 'invoice',
    document_date: '2026-08-27', created_at: '2026-08-27T00:00:00Z',
    parsed_json: { vendor: 'Walmart Business', document_type: 'invoice', items },
    warnings: null,
  };
  const tables = {
    ingredient_vendors: [],
    invoice_lines: [
      ...Array.from({ length: 8 }, (_, i) => ({ id: 'a' + i, vendor: 'Walmart Business', vendor_sku: '19400236', ingredient_id: null, match_status: 'unmatched' })),
      ...Array.from({ length: 7 }, (_, i) => ({ id: 'b' + i, vendor: 'Walmart Business', vendor_sku: '27935840', ingredient_id: null, match_status: 'unmatched' })),
    ],
    ingredients: [{ id: 'ing-chicken', name: 'Chicken Breast', category: 'Protein', active: true }],
  };
  return { doc, tables };
}

(async () => {

// ══════════════════════════════════════════════════════════════════
// PART A — reproduce the real sequence (not the isolated single case)
// ══════════════════════════════════════════════════════════════════
await atest('H: REGRESSION — two different vendor SKUs can sequentially map to the same ingredient in one document/session (19400236 then 27935840, both -> Chicken Breast); 15/15 chicken invoice_lines matched', async () => {
  loadRealModules();
  const { doc, tables } = makeFixture();
  const { sb } = makeSbWithRealConstraint(tables);
  window.supabaseClient = sb;
  window._vdrAllDocs = [];
  window._vdrHistoryDocs = [doc];
  window._vdrMatchStatus = {};

  // ── STEP 1: open Match on 19400236, pick Chicken Breast ──
  await window.vdrOpenMatchSelector('doc-26104552', 'Walmart Business', '19400236', DESC_19400236, null);
  let modal = document.getElementById('_vdrMatchSelector');
  assert.ok(modal, 'first modal must open');
  assert.ok(modal.innerHTML.includes('Chicken Breast'), 'Chicken Breast candidate present for SKU 1');
  await window.vdrMatchSelectorPickCandidate(0);

  assert.strictEqual(tables.ingredient_vendors.length, 1, 'first match creates exactly 1 row');
  const firstBatch = tables.invoice_lines.filter(l => l.vendor_sku === '19400236');
  assert.ok(firstBatch.every(l => l.ingredient_id === 'ing-chicken'), 'first SKU: all 8 rows backfilled');

  // ── STEP 2 (Part C): the old modal is genuinely gone before opening
  // the second one — no stale DOM/context left behind ──
  assert.ok(!document.getElementById('_vdrMatchSelector'), 'old modal must be fully removed after a successful match, before the second open');

  // ── STEP 3: open Match on 27935840 (DIFFERENT SKU, same target
  // ingredient) — Part B: trace the exact context passed ──
  await window.vdrOpenMatchSelector('doc-26104552', 'Walmart Business', '27935840', DESC_27935840, null);
  modal = document.getElementById('_vdrMatchSelector');
  assert.ok(modal, 'second modal must open independently');
  assert.ok(modal.innerHTML.includes('SKU 27935840'), 'Part B: the second modal must show vendorSku=27935840, never a stale 19400236 — no leftover context reused');
  assert.ok(modal.innerHTML.includes('Chicken Breast'), 'Part F: Chicken Breast candidate present for the real second SKU description');

  // ── STEP 4: pick Chicken Breast for the second SKU ──
  await window.vdrMatchSelectorPickCandidate(0);

  // ── THE FIX: 27935840 must now be correctly backfilled, even though
  // the real DB constraint prevents a second ingredient_vendors row
  // for the same (vendor, ingredient_id) pair ──
  const secondBatch = tables.invoice_lines.filter(l => l.vendor_sku === '27935840');
  assert.ok(secondBatch.every(l => l.ingredient_id === 'ing-chicken'), 'FIX VERIFIED: 27935840 correctly backfilled — 7/7, not 0/7');

  // ── Total: 15/15 chicken rows across both SKUs ──
  const allChicken = tables.invoice_lines.filter(l => l.vendor_sku === '19400236' || l.vendor_sku === '27935840');
  assert.strictEqual(allChicken.length, 15);
  assert.ok(allChicken.every(l => l.ingredient_id === 'ing-chicken' && l.match_status === 'matched'), '15/15 chicken invoice_lines matched');

  // Modal must have closed normally (success path, not the error path).
  assert.ok(!document.getElementById('_vdrMatchSelector'), 'modal closes normally on success — no visible error');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
})();
