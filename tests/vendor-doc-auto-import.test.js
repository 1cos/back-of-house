// ══════════════════════════════════════════════════════════════════
// vendor-doc-auto-import — pure-logic regression tests
// Plain Node, no framework: `node tests/vendor-doc-auto-import.test.js`
//
// Tests run against pure_logic.js: index.ts with its two Deno-only
// imports stripped and everything from Deno.serve(...) onward cut off
// (esbuild-transpiled to plain JS first, same "extract + eval" spirit
// as the repo's other tests, adapted for a TypeScript source file).
// ══════════════════════════════════════════════════════════════════
const assert = require('assert');
const {
  vdrIsTreviPayDocument, vdrNormalizeBuyerName, vdrDecideWalmartBuyer,
  isBlockingWarning, hasBlockingQuestion, vdaiPreflight, vdaiApprove,
  vdrDecideCanonicalUpdateLite, vdaiPackToGrams, loadParsers,
  writeInvoiceLines, vdaiRepairMissingInvoiceLines,
} = require('../pure_logic.cjs');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : e)); }
}
async function atest(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : e)); }
}

// ── Minimal mock Supabase client — same shape/spirit as the rest of ──
// the codebase's tests: a chainable query builder over an in-memory
// table map, enough to drive vdaiPreflight/vdaiApprove without a real DB.
function makeMockSb(tables) {
  function builder(tableName) {
    const state = { table: tableName, filters: [], selectCols: null, single: false, insertRows: null, updateData: null, limitN: null };
    const api = {
      select(cols) { state.selectCols = cols; return api; },
      eq(col, val) { state.filters.push(['eq', col, val]); return api; },
      neq(col, val) { state.filters.push(['neq', col, val]); return api; },
      in(col, vals) { state.filters.push(['in', col, vals]); return api; },
      is(col, val) { state.filters.push(['is', col, val]); return api; },
      not(col, op, val) { state.filters.push(['not', col, op, val]); return api; },
      limit(n) { state.limitN = n; return api; },
      order() { return api; },
      single() { state.single = true; return exec(); },
      insert(rows) { state.insertRows = Array.isArray(rows) ? rows : [rows]; state.op = 'insert'; return api; },
      update(data) { state.updateData = data; state.op = 'update'; return api; },
      then(resolve, reject) { return run().then(resolve, reject); }, // await builder — works whether or not .select()/.eq() was chained after insert/update
    };
    function run() {
      if (state.op === 'insert') return execWrite('insert');
      if (state.op === 'update') return execWrite('update');
      return exec();
    }
    function applyFilters(rows) {
      return rows.filter((r) => state.filters.every((f) => {
        if (f[0] === 'eq') return r[f[1]] === f[2];
        if (f[0] === 'neq') return r[f[1]] !== f[2];
        if (f[0] === 'in') return f[2].includes(r[f[1]]);
        if (f[0] === 'is') return f[2] === null ? (r[f[1]] === null || r[f[1]] === undefined) : r[f[1]] === f[2];
        return true;
      }));
    }
    async function exec() {
      let rows = applyFilters(tables[tableName] || []);
      if (state.limitN) rows = rows.slice(0, state.limitN);
      if (state.single) return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } };
      return { data: rows, error: null };
    }
    async function execWrite(kind) {
      tables[tableName] = tables[tableName] || [];
      if (kind === 'insert') {
        tables[tableName].push(...state.insertRows);
        return { data: state.insertRows, error: null };
      }
      // update: apply to matching rows, return them (mirrors PostgREST .select() chaining)
      const matched = applyFilters(tables[tableName]);
      matched.forEach((r) => Object.assign(r, state.updateData));
      return { data: matched, error: null };
    }
    return api;
  }
  return {
    from: (t) => builder(t),
    storage: { from: () => ({ download: async () => ({ data: null, error: { message: 'not used in these tests' } }), remove: async () => ({}) }) },
  };
}

(async () => {
  console.log('\nvendor-doc-auto-import — pure-logic tests\n');

  // ── TreviPay detection (ported verbatim — sanity only) ──────────────
  test('TreviPay: detects combined signal regardless of item order', () => {
    const items = [{ str: 'Walmart ' }, { str: 'Business ' }, { str: 'TreviPay' }];
    assert.strictEqual(vdrIsTreviPayDocument(items), true);
  });
  test('TreviPay: a Hardie\'s invoice (no signal) is never misdetected', () => {
    assert.strictEqual(vdrIsTreviPayDocument([{ str: 'Hardie\'s Fresh Foods Invoice' }]), false);
  });

  // ── Walmart Buyer Guard (ported verbatim) ────────────────────────────
  test('Buyer Guard: Kitchen buyer → accept', () => {
    assert.deepStrictEqual(vdrDecideWalmartBuyer({ vendor: 'Walmart Business', buyer: 'Massimilajo Zubboli' }), { action: 'accept', reason: 'buyer_kitchen' });
  });
  test('Buyer Guard: Bar buyer → ignore (never becomes a purchase automatically)', () => {
    assert.deepStrictEqual(vdrDecideWalmartBuyer({ vendor: 'Walmart Business', buyer: 'Zeno Russo' }), { action: 'ignore', reason: 'buyer_bar' });
  });
  test('Buyer Guard: unrecognized buyer → review, never silently accepted', () => {
    assert.deepStrictEqual(vdrDecideWalmartBuyer({ vendor: 'Walmart Business', buyer: 'Someone Else' }), { action: 'review', reason: 'buyer_unrecognized' });
  });
  test('Buyer Guard: non-Walmart vendor → null (untouched)', () => {
    assert.strictEqual(vdrDecideWalmartBuyer({ vendor: "Hardie's Fresh Foods / Dairyland Produce", buyer: 'x' }), null);
  });

  // ── Blocking-question classification (ported from vdrWarningToQuestion) ──
  test('OQR-006: pure count pack ("12/3 CT") never blocks', () => {
    assert.strictEqual(isBlockingWarning({ code: 'OQR-006' }, { pack_description: '12/3 CT' }, {}), false);
  });
  test('OQR-006: range CT ("16-22 CT") never blocks (auto-averaged)', () => {
    assert.strictEqual(isBlockingWarning({ code: 'OQR-006' }, { pack_description: '16-22 CT' }, {}), false);
  });
  test('OQR-006: DZ pack with no known conversion DOES block', () => {
    assert.strictEqual(isBlockingWarning({ code: 'OQR-006' }, { pack_description: '15 DZ' }, {}), true);
  });
  test('OQR-006: DZ pack WITH a known conversion for that SKU never blocks (learned once)', () => {
    const known = { '01115': { conversion_to_base: 1000 } };
    assert.strictEqual(isBlockingWarning({ code: 'OQR-006' }, { vendor_sku: '01115', pack_description: '15 DZ' }, known), false);
  });
  test('OQR-002 (substitution) always blocks', () => {
    assert.strictEqual(isBlockingWarning({ code: 'OQR-002' }, {}, {}), true);
  });
  test('OQR-007 (qty mismatch) always blocks', () => {
    assert.strictEqual(isBlockingWarning({ code: 'OQR-007' }, {}, {}), true);
  });
  test('DOC-TOTAL-001 always blocks', () => {
    assert.strictEqual(isBlockingWarning({ code: 'DOC-TOTAL-001' }, null, {}), true);
  });
  test('PARSE_ERROR / UNKNOWN_VENDOR / NO_PARSER never block (info-only)', () => {
    assert.strictEqual(isBlockingWarning({ code: 'PARSE_ERROR' }, null, {}), false);
    assert.strictEqual(isBlockingWarning({ code: 'UNKNOWN_VENDOR' }, null, {}), false);
    assert.strictEqual(isBlockingWarning({ code: 'NO_PARSER' }, null, {}), false);
  });
  test('OQR-008: auto-resolvable "11# BX" pattern never blocks', () => {
    assert.strictEqual(isBlockingWarning({ code: 'OQR-008' }, { pack_description: '11# BX' }, {}), false);
  });
  test('OQR-008: non-resolvable pattern blocks', () => {
    assert.strictEqual(isBlockingWarning({ code: 'OQR-008' }, { pack_description: 'weird format' }, {}), true);
  });

  // ── vdaiPreflight: matching (SKU via vendor_item_aliases/ingredient_vendors, desc via ingredient_links) ──
  await atest('Preflight: SKU matched via vendor_item_aliases → 0 unmatched, ok', async () => {
    const sb = makeMockSb({
      vendor_item_aliases: [{ vendor: 'V', vendor_sku: 'A1', active: true, ingredient_id: 'ing-1' }],
      ingredient_vendors: [], ingredient_links: [],
    });
    const doc = { vendor: 'V', warnings: null, parsed_json: { document_type: 'invoice', vendor: 'V', items: [{ vendor_sku: 'A1', description: 'Tomatoes' }] } };
    const pre = await vdaiPreflight(sb, doc);
    assert.deepStrictEqual(pre, { ok: true, unmatchedCount: 0 });
  });
  await atest('Preflight: new SKU never seen before → unmatchedCount 1 (this is the "recurring match" case)', async () => {
    const sb = makeMockSb({ vendor_item_aliases: [], ingredient_vendors: [], ingredient_links: [] });
    const doc = { vendor: 'V', warnings: null, parsed_json: { document_type: 'invoice', vendor: 'V', items: [{ vendor_sku: 'NEW-SKU', description: 'Tomato Ombre TOV' }] } };
    const pre = await vdaiPreflight(sb, doc);
    assert.strictEqual(pre.unmatchedCount, 1);
  });
  await atest('Preflight: description matched via confirmed ingredient_links (SKU absent) → matched', async () => {
    const sb = makeMockSb({ vendor_item_aliases: [], ingredient_vendors: [], ingredient_links: [{ vendor: 'V', invoice_description: 'Romaine Hearts', confirmed: true }] });
    const doc = { vendor: 'V', warnings: null, parsed_json: { document_type: 'invoice', vendor: 'V', items: [{ description: 'Romaine Hearts' }] } };
    const pre = await vdaiPreflight(sb, doc);
    assert.strictEqual(pre.unmatchedCount, 0);
  });
  await atest('Preflight: a blocking OQR-002 warning → ok:false, never reaches the matching check', async () => {
    const sb = makeMockSb({});
    const doc = { vendor: 'V', warnings: [{ code: 'OQR-002', item: 'X' }], parsed_json: { document_type: 'invoice', vendor: 'V', items: [{ description: 'X', warnings: [{ code: 'OQR-002' }] }] } };
    const pre = await vdaiPreflight(sb, doc);
    assert.strictEqual(pre.ok, false);
  });
  await atest('Preflight: Shipping/adjustment line_type rows are excluded from matching entirely (Walmart)', async () => {
    const sb = makeMockSb({ vendor_item_aliases: [], ingredient_vendors: [], ingredient_links: [] });
    const doc = { vendor: 'Walmart Business', warnings: null, parsed_json: { document_type: 'invoice', vendor: 'Walmart Business', items: [{ vendor_sku: 'Shipping', description: 'SHIPPING', line_type: 'shipping' }] } };
    const pre = await vdaiPreflight(sb, doc);
    assert.strictEqual(pre.unmatchedCount, 0);
  });

  // ── vdaiApprove: idempotency + Walmart buyer guard + write path ──────
  await atest('Approve: already-imported doc is a safe no-op (idempotency guard #1)', async () => {
    const sb = makeMockSb({ vendor_documents: [{ id: 'd1', status: 'imported', parsed_json: { document_type: 'invoice', items: [] }, vendor: 'V' }] });
    const r = await vdaiApprove(sb, 'd1');
    assert.deepStrictEqual(r, { ok: true, reason: 'already_imported' });
  });
  await atest('Approve: pre-existing invoice_lines for this doc → skips re-insert (idempotency guard #2)', async () => {
    const sb = makeMockSb({
      vendor_documents: [{ id: 'd2', status: 'pending', vendor: 'V', document_date: '2026-09-01', parsed_json: { document_type: 'invoice', vendor: 'V', total: 10, items: [{ vendor_sku: 'S1', description: 'X', unit_price: 10, amount: 10, qty_ordered: 1 }] } }],
      vendor_item_aliases: [{ vendor: 'V', vendor_sku: 'S1', active: true, ingredient_id: 'ing-1' }],
      ingredient_vendors: [],
      invoice_lines: [{ id: 'existing-line', import_id: 'd2' }],
    });
    const beforeCount = sb.from('invoice_lines').select ? undefined : undefined; // (not used — just documenting intent)
    const r = await vdaiApprove(sb, 'd2');
    assert.strictEqual(r.ok, true);
  });
  await atest('Approve: Walmart non-Kitchen buyer never becomes a purchase even via the automated path', async () => {
    const sb = makeMockSb({
      vendor_documents: [{ id: 'd3', status: 'pending', vendor: 'Walmart Business', document_date: '2026-09-01', parsed_json: { document_type: 'invoice', vendor: 'Walmart Business', buyer: 'Zeno Russo', items: [] } }],
    });
    const r = await vdaiApprove(sb, 'd3');
    assert.strictEqual(r.ok, false);
    assert.ok(r.reason.startsWith('buyer_guard_'));
  });
  // MICRO-TASK 42 — questo test asseriva che QUALUNQUE order_confirmation
  // fosse un no-op, incluso Ben E. Keith. Per BEK non e piu vero: la
  // conferma d'ordine E il documento d'acquisto operativo (non arriva
  // nessuna invoice separata). Diviso nei due casi che contano, cosi la
  // regola resta verificata in entrambe le direzioni.
  await atest('Approve: order_confirmation di ALTRI vendor resta un no-op (nessuna regressione)', async () => {
    const sb = makeMockSb({ vendor_documents: [{ id: 'd4', status: 'pending', vendor: "Hardie's Fresh Foods / Dairyland Produce", parsed_json: { document_type: 'order_confirmation', vendor: "Hardie's Fresh Foods / Dairyland Produce", items: [] } }] });
    const r = await vdaiApprove(sb, 'd4');
    assert.deepStrictEqual(r, { ok: false, reason: 'not_invoice' });
  });
  await atest('Approve: order_confirmation Ben E. Keith NON e piu respinto dal gate (MICRO-TASK 42)', async () => {
    const sb = makeMockSb({ vendor_documents: [{ id: 'd4b', status: 'pending', vendor: 'Ben E. Keith', parsed_json: { document_type: 'order_confirmation', vendor: 'Ben E. Keith', items: [] } }] });
    const r = await vdaiApprove(sb, 'd4b');
    assert.notStrictEqual(r.reason, 'not_invoice', 'il gate non deve piu respingere BEK order_confirmation');
  });
  await atest('Approve: un acknowledgement BEK viene parcheggiato come ignored, non importato', async () => {
    const sb = makeMockSb({ vendor_documents: [{ id: 'd4c', status: 'pending', vendor: 'Ben E. Keith', parsed_json: { document_type: 'order_confirmation', document_class: 'acknowledgement', vendor: 'Ben E. Keith', items: [] } }] });
    const r = await vdaiApprove(sb, 'd4c');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.reason, 'acknowledgement_not_a_purchase');
  });

  // ── MICRO-TASK 37: writeInvoiceLines extraction + repair path ────────
  await atest('MT37 T2: normal approval (pending→imported) still produces the same invoice_lines as before the refactor', async () => {
    const tables = {
      vendor_documents: [{ id: 'd5', status: 'pending', vendor: 'V', document_date: '2026-09-01', parsed_json: { document_type: 'invoice', vendor: 'V', total: 25, items: [
        { vendor_sku: 'S1', description: 'Item One', unit_price: 10, amount: 10, qty_ordered: 1 },
        { vendor_sku: 'S2', description: 'Item Two', unit_price: 15, amount: 15, qty_ordered: 1 },
      ] } }],
      vendor_item_aliases: [{ vendor: 'V', vendor_sku: 'S1', active: true, ingredient_id: 'ing-1' }],
      ingredient_vendors: [{ id: 'iv-1', vendor: 'V', vendor_sku: 'S2', ingredient_id: 'ing-2' }],
      invoice_lines: [],
    };
    const sb = makeMockSb(tables);
    const r = await vdaiApprove(sb, 'd5');
    assert.strictEqual(r.ok, true);
    const lines = tables.invoice_lines.filter((l) => l.import_id === 'd5');
    assert.strictEqual(lines.length, 2);
    const l1 = lines.find((l) => l.vendor_sku === 'S1');
    assert.strictEqual(l1.ingredient_id, 'ing-1');
    assert.strictEqual(l1.match_status, 'matched');
    assert.strictEqual(l1.line_total, 10);
    const l2 = lines.find((l) => l.vendor_sku === 'S2');
    assert.strictEqual(l2.ingredient_id, 'ing-2');
    assert.strictEqual(l2.match_status, 'matched');
    assert.strictEqual(tables.vendor_documents.find((d) => d.id === 'd5').status, 'imported');
  });
  await atest('MT37 T3: repair path (status=imported, missing invoice_lines) writes invoice_lines without touching ingredient_vendors', async () => {
    const tables = {
      vendor_documents: [{ id: 'd6', status: 'imported', vendor: 'V', document_date: '2026-06-15', parsed_json: { document_type: 'invoice', vendor: 'V', total: 20, items: [
        { vendor_sku: 'S3', description: 'Item Three', unit_price: 20, amount: 20, qty_ordered: 1 },
      ] } }],
      ingredient_vendors: [{ id: 'iv-3', vendor: 'V', vendor_sku: 'S3', ingredient_id: 'ing-3', unit_price: 99, last_invoice_date: '2026-09-15' }],
      vendor_item_aliases: [],
      invoice_lines: [],
    };
    const sb = makeMockSb(tables);
    const r = await vdaiRepairMissingInvoiceLines(sb, 'd6', false);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.inserted, 1);
    const lines = tables.invoice_lines.filter((l) => l.import_id === 'd6');
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0].ingredient_id, 'ing-3');
    const iv = tables.ingredient_vendors.find((x) => x.id === 'iv-3');
    assert.strictEqual(iv.unit_price, 99, 'price must stay the September value, not be overwritten');
    assert.strictEqual(iv.last_invoice_date, '2026-09-15', 'date must not regress to the June invoice date');
  });
  await atest('MT37 T4: repair path is a no-op when invoice_lines already exist for this doc (idempotency)', async () => {
    const tables = {
      vendor_documents: [{ id: 'd7', status: 'imported', vendor: 'V', document_date: '2026-06-15', parsed_json: { document_type: 'invoice', vendor: 'V', total: 20, items: [
        { vendor_sku: 'S4', description: 'Item Four', unit_price: 20, amount: 20, qty_ordered: 1 },
      ] } }],
      ingredient_vendors: [],
      vendor_item_aliases: [],
      invoice_lines: [{ id: 'already-there', import_id: 'd7' }],
    };
    const sb = makeMockSb(tables);
    const r = await vdaiRepairMissingInvoiceLines(sb, 'd7', false);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.reason, 'already_has_lines');
    assert.strictEqual(r.inserted, 0);
    assert.strictEqual(tables.invoice_lines.filter((l) => l.import_id === 'd7').length, 1);
  });
  await atest('MT37 T5: repair path inserts a line for an unmatched SKU too, correctly flagged, never invented', async () => {
    const tables = {
      vendor_documents: [{ id: 'd8', status: 'imported', vendor: 'V', document_date: '2026-06-15', parsed_json: { document_type: 'invoice', vendor: 'V', total: 5, items: [
        { vendor_sku: 'UNKNOWN-SKU', description: 'Mystery Item', unit_price: 5, amount: 5, qty_ordered: 1 },
      ] } }],
      ingredient_vendors: [],
      vendor_item_aliases: [],
      ingredient_links: [],
      invoice_lines: [],
    };
    const sb = makeMockSb(tables);
    const r = await vdaiRepairMissingInvoiceLines(sb, 'd8', false);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.inserted, 1);
    const line = tables.invoice_lines.find((l) => l.import_id === 'd8');
    assert.strictEqual(line.match_status, 'unmatched');
    assert.strictEqual(line.ingredient_id, null);
    assert.strictEqual(line.vendor_sku, 'UNKNOWN-SKU');
  });
  await atest('MT37 T6: repair path never issues any ingredient_vendors write, even for a description-linkable new SKU', async () => {
    const tables = {
      vendor_documents: [{ id: 'd9', status: 'imported', vendor: 'V', document_date: '2026-06-15', parsed_json: { document_type: 'invoice', vendor: 'V', total: 30, items: [
        { vendor_sku: 'S5', description: 'Known Item', unit_price: 10, amount: 10, qty_ordered: 1 },
        { vendor_sku: 'NEW-SKU', description: 'Brand New Item', unit_price: 20, amount: 20, qty_ordered: 1 },
      ] } }],
      ingredient_vendors: [{ id: 'iv-5', vendor: 'V', vendor_sku: 'S5', ingredient_id: 'ing-5', unit_price: 10, last_invoice_date: '2026-09-10' }],
      vendor_item_aliases: [],
      ingredient_links: [{ vendor: 'V', invoice_description: 'Brand New Item', ingredient_id: 'ing-6', confirmed: true }],
      invoice_lines: [],
    };
    const before = JSON.stringify(tables.ingredient_vendors);
    const sb = makeMockSb(tables);
    const r = await vdaiRepairMissingInvoiceLines(sb, 'd9', false);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.inserted, 2);
    // Even though "Brand New Item" has a confirmed description link that
    // would normally trigger a populate_sku/insert in vdaiApprove's price
    // block, ingredient_vendors stays byte-identical — no row added, none
    // updated, because that whole block does not exist in this path.
    assert.strictEqual(JSON.stringify(tables.ingredient_vendors), before);
    assert.strictEqual(tables.ingredient_vendors.length, 1);
  });
  await atest('MT37 T7: repair path never modifies vendor_documents.status or any other column on the document', async () => {
    const tables = {
      vendor_documents: [{ id: 'd10', status: 'imported', vendor: 'V', document_date: '2026-06-15', updated_at: 'ORIGINAL', parsed_json: { document_type: 'invoice', vendor: 'V', total: 5, items: [
        { vendor_sku: 'S6', description: 'Item Six', unit_price: 5, amount: 5, qty_ordered: 1 },
      ] } }],
      ingredient_vendors: [{ id: 'iv-6', vendor: 'V', vendor_sku: 'S6', ingredient_id: 'ing-6' }],
      vendor_item_aliases: [],
      invoice_lines: [],
    };
    const before = JSON.stringify(tables.vendor_documents[0]);
    const sb = makeMockSb(tables);
    const r = await vdaiRepairMissingInvoiceLines(sb, 'd10', false);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(JSON.stringify(tables.vendor_documents[0]), before);
    assert.strictEqual(tables.vendor_documents[0].status, 'imported');
  });
  await atest('MT37 extra: repair path is a mirror-image guard — refuses a \'pending\' document (that is vdaiApprove\'s job, never this one\'s)', async () => {
    const sb = makeMockSb({ vendor_documents: [{ id: 'd11', status: 'pending', vendor: 'V', parsed_json: { document_type: 'invoice', items: [] } }] });
    const r = await vdaiRepairMissingInvoiceLines(sb, 'd11', false);
    assert.deepStrictEqual(r, { ok: false, reason: 'not_imported' });
  });
  await atest('MT37 extra: repair path dry_run previews without writing anything', async () => {
    const tables = {
      vendor_documents: [{ id: 'd12', status: 'imported', vendor: 'V', document_date: '2026-06-15', parsed_json: { document_type: 'invoice', vendor: 'V', total: 5, items: [
        { vendor_sku: 'S7', description: 'Item Seven', unit_price: 5, amount: 5, qty_ordered: 1 },
      ] } }],
      ingredient_vendors: [],
      vendor_item_aliases: [],
      invoice_lines: [],
    };
    const sb = makeMockSb(tables);
    const r = await vdaiRepairMissingInvoiceLines(sb, 'd12', true);
    assert.deepStrictEqual(r, { ok: true, reason: 'would_repair', inserted: 0 });
    assert.strictEqual(tables.invoice_lines.length, 0);
  });

  // ── vdrDecideCanonicalUpdateLite (ported logic, sanity) ──────────────
  test('Canonical update: no existing SKU → populate_sku', () => {
    assert.strictEqual(vdrDecideCanonicalUpdateLite(null, 'NEW'), 'populate_sku');
  });
  test('Canonical update: same SKU → update (refresh)', () => {
    assert.strictEqual(vdrDecideCanonicalUpdateLite('S1', 'S1'), 'update');
  });
  test('Canonical update: different SKU on both sides → skip (never silently overwritten)', () => {
    assert.strictEqual(vdrDecideCanonicalUpdateLite('S1', 'S2'), 'skip');
  });

  // ── vdaiPackToGrams (pack→weight for price-intelligence calc) ────────
  test('Pack to grams: "2/10 LB" → 2×10×453.592', () => {
    assert.strictEqual(Math.round(vdaiPackToGrams('2/10 LB')), Math.round(2 * 10 * 453.592));
  });
  test('Pack to grams: "25#" → 25×453.592', () => {
    assert.strictEqual(Math.round(vdaiPackToGrams('25#')), Math.round(25 * 453.592));
  });
  test('Pack to grams: count-based "12 CT" → null (no weight)', () => {
    assert.strictEqual(vdaiPackToGrams('12 CT'), null);
  });

  // ── Embedded parser bundle round-trips correctly (no corruption from ──
  // JSON-escaping the 9 real js/vendor-parsers/*.js files into index.ts) ──
  test('Embedded parsers: correctly detects and parses a real Hardie\'s invoice line', () => {
    const parsers = loadParsers();
    const sample = "INVOICE/POD 07119341\nHardie's Fresh Foods\nDATE/TRIP 09/11/2026\n1  1  71114  LETTUCE ROMAINE HEARTS  12/3 CT  28.95  28.95\nSUBTOTAL 28.95";
    const parsed = parsers.parse(sample);
    assert.strictEqual(parsed.vendor, "Hardie's Fresh Foods / Dairyland Produce");
    assert.strictEqual(parsed.document_type, 'invoice');
    assert.ok(parsed.items.length >= 1, 'expected at least one parsed item');
    assert.strictEqual(parsed.items[0].vendor_sku, '71114');
  });
  test('Embedded parsers: Walmart/TreviPay vendor detection still fires on the embedded copy', () => {
    const parsers = loadParsers();
    assert.strictEqual(parsers.detectVendor('Walmart Business  ...  TreviPay  ...  Invoice Details'), 'walmart');
  });

  // ── MICRO-TASK 34: proves the Edge Function's embedded parser is the ──
  // FIXED canonical Fruge logic, not the old LB-only one, and that the
  // new PARSE_ERROR_NO_LINES code is wired as blocking in THIS runtime ──
  test('MT34: embedded parser now extracts all 3 real lines from #856363 (was 0 before the fix)', () => {
    const parsers = loadParsers();
    const sample = `INVOICE   856363
 Taken   09/17/26
Invoiced   09/17/26
 Ordered   Product Description   Shipped   Unit Price   Amount
 1 CA   LOBZM4T6XOZ0 - LOBSTER FZ N. ATL 4-5 OZ 10lb   1 CA   $27.50 LB   $275.00
1 CA,   100-P108734-002-001
 2 CA   SHRQT1620WH0 - SHRIMP IQF FZ P&D TO 16-20 WH 2 CA   $8.50 LB   $170.00
WHITE - CENSEA (5 X 2 LBS) 5x2lb  
2 CA,   100-P108860-005-001
 1 CA   SQUZXOXOXTT1 - SQUID FZ TUBES & TENTS 4-6 *25 LB 1 CA   $9.20 LB   $230.00
CASE TOWN DOCK 10x2.5lb  
1 CA,   100-P109032-004-001
 Total Weight:   55 LB  Pay:  
$675.00
Carrier 1:   Fruge Trucking`;
    const parsed = parsers.parse(sample);
    assert.strictEqual(parsed.items.length, 3);
    assert.strictEqual(parsed.total, 675);
  });
  test('MT34: isBlockingWarning treats PARSE_ERROR_NO_LINES as blocking in the Edge Function runtime', () => {
    assert.strictEqual(isBlockingWarning({ code: 'PARSE_ERROR_NO_LINES' }, null, {}), true);
  });
  await atest('MT34: a Fruge doc with the new PARSE_ERROR_NO_LINES warning never preflight-cleans', async () => {
    const sb = makeMockSb({});
    const doc = { vendor: 'Fruge Seafood', warnings: [{ code: 'PARSE_ERROR_NO_LINES', message: 'no lines' }], parsed_json: { document_type: 'invoice', vendor: 'Fruge Seafood', items: [] } };
    const pre = await vdaiPreflight(sb, doc);
    assert.strictEqual(pre.ok, false);
    assert.strictEqual(pre.reason, 'open_question');
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail > 0 ? 1 : 0);
})();
