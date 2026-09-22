// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 40 — alias-aware price intelligence + chronological
// safety. Plain Node, no framework: `node tests/vendor-review-alias-
// price-intelligence.test.js`. Runs against the same pure_logic.cjs
// build as tests/vendor-doc-auto-import.test.js (index.ts with its two
// Deno-only imports stripped and everything from Deno.serve(...) cut).
// ══════════════════════════════════════════════════════════════════
const assert = require('assert');
const {
  vdaiPreflight, vdaiApprove, resolvePriceIntelIdentity, chronologyAllows,
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

// ── Same mock Supabase client shape as tests/vendor-doc-auto-import.test.js ──
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
      then(resolve, reject) { return run().then(resolve, reject); },
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

function ivRow(id, vendor, sku, ingredientId, lastInvoiceDate, unitPrice) {
  return { id, vendor, vendor_sku: sku, ingredient_id: ingredientId, last_invoice_date: lastInvoiceDate === undefined ? null : lastInvoiceDate, unit_price: unitPrice == null ? null : unitPrice, active: true };
}

(async () => {
  console.log('\nMICRO-TASK 40 — alias-aware price intelligence + chronology tests\n');

  // ── Unit tests: resolvePriceIntelIdentity + chronologyAllows (pure) ──
  test('resolvePriceIntelIdentity: direct only → case A', () => {
    const r = resolvePriceIntelIdentity('S1', { S1: { id: 'iv1', ingredient_id: 'ing-1', vendor_sku: 'S1' } }, {});
    assert.strictEqual(r.case, 'A');
    assert.strictEqual(r.row.id, 'iv1');
  });
  test('resolvePriceIntelIdentity: alias only, no direct row → case B', () => {
    const r = resolvePriceIntelIdentity('BRO', {}, { BRO: 'ing-scallops' });
    assert.strictEqual(r.case, 'B');
    assert.strictEqual(r.ingredientId, 'ing-scallops');
  });
  test('resolvePriceIntelIdentity: direct + alias agree → case A (alias redundant, not a conflict)', () => {
    const r = resolvePriceIntelIdentity('S1', { S1: { id: 'iv1', ingredient_id: 'ing-1', vendor_sku: 'S1' } }, { S1: 'ing-1' });
    assert.strictEqual(r.case, 'A');
  });
  test('resolvePriceIntelIdentity: direct + alias disagree → case C', () => {
    const r = resolvePriceIntelIdentity('S1', { S1: { id: 'iv1', ingredient_id: 'ing-DIRECT', vendor_sku: 'S1' } }, { S1: 'ing-ALIAS' });
    assert.strictEqual(r.case, 'C');
    assert.strictEqual(r.directIngredientId, 'ing-DIRECT');
    assert.strictEqual(r.aliasIngredientId, 'ing-ALIAS');
  });
  test('resolvePriceIntelIdentity: neither direct nor alias → none', () => {
    assert.strictEqual(resolvePriceIntelIdentity('UNKNOWN', {}, {}).case, 'none');
  });
  test('resolvePriceIntelIdentity: no sku at all → none', () => {
    assert.strictEqual(resolvePriceIntelIdentity(null, { S1: {} }, { S1: 'x' }).case, 'none');
  });
  test('chronologyAllows: existing null → always true', () => {
    assert.strictEqual(chronologyAllows(null, '2020-01-01'), true);
    assert.strictEqual(chronologyAllows(null, null), true);
  });
  test('chronologyAllows: incoming >= existing → true', () => {
    assert.strictEqual(chronologyAllows('2026-01-01', '2026-01-01'), true);
    assert.strictEqual(chronologyAllows('2026-01-01', '2026-02-01'), true);
  });
  test('chronologyAllows: incoming < existing → false', () => {
    assert.strictEqual(chronologyAllows('2026-02-01', '2026-01-01'), false);
  });
  test('chronologyAllows: incoming null, existing dated → false (fails closed)', () => {
    assert.strictEqual(chronologyAllows('2026-01-01', null), false);
  });

  // ══════════════════════════════════════════════════════════════
  // Scenario 1 — direct SKU normale, invoice nuova → update come prima
  // ══════════════════════════════════════════════════════════════
  await atest('1. Direct SKU, newer invoice → ingredient_vendors updates normally', async () => {
    const tables = {
      vendor_documents: [{ id: 'd1', status: 'pending', vendor: 'V', document_date: '2026-09-10', parsed_json: { document_type: 'invoice', vendor: 'V', total: 20, items: [
        { vendor_sku: 'S1', description: 'Item One', unit_price: 20, amount: 20, qty_ordered: 1 },
      ] } }],
      ingredient_vendors: [ivRow('iv-1', 'V', 'S1', 'ing-1', '2026-09-01', 18)],
      vendor_item_aliases: [], ingredient_links: [], invoice_lines: [],
    };
    const sb = makeMockSb(tables);
    const r = await vdaiApprove(sb, 'd1');
    assert.strictEqual(r.ok, true);
    const iv = tables.ingredient_vendors.find((x) => x.id === 'iv-1');
    assert.strictEqual(iv.unit_price, 20, 'price should update — invoice is newer');
    assert.strictEqual(iv.last_invoice_date, '2026-09-10');
  });

  // ══════════════════════════════════════════════════════════════
  // Scenario 2 — direct SKU normale, invoice più vecchia → NO regression
  // ══════════════════════════════════════════════════════════════
  await atest('2. Direct SKU, OLDER invoice → chronology guard blocks the price regression', async () => {
    const tables = {
      vendor_documents: [{ id: 'd2', status: 'pending', vendor: 'V', document_date: '2026-08-01', parsed_json: { document_type: 'invoice', vendor: 'V', total: 5, items: [
        { vendor_sku: 'S2', description: 'Item Two', unit_price: 5, amount: 5, qty_ordered: 1 },
      ] } }],
      ingredient_vendors: [ivRow('iv-2', 'V', 'S2', 'ing-2', '2026-09-01', 18)],
      vendor_item_aliases: [], ingredient_links: [], invoice_lines: [],
    };
    const sb = makeMockSb(tables);
    const r = await vdaiApprove(sb, 'd2');
    assert.strictEqual(r.ok, true, 'the document itself still imports — only price intelligence is skipped');
    const iv = tables.ingredient_vendors.find((x) => x.id === 'iv-2');
    assert.strictEqual(iv.unit_price, 18, 'price must NOT regress to the older invoice value');
    assert.strictEqual(iv.last_invoice_date, '2026-09-01', 'date must not regress either');
  });

  // ══════════════════════════════════════════════════════════════
  // Scenario 3 — alias-only SCAFDUU10BRO → risolve Scallops
  // ══════════════════════════════════════════════════════════════
  await atest('3. Alias-only SKU (no ingredient_vendors row anywhere) → new row created via alias', async () => {
    const tables = {
      vendor_documents: [{ id: 'd3', status: 'pending', vendor: 'Fruge Seafood', document_date: '2026-09-16', parsed_json: { document_type: 'invoice', vendor: 'Fruge Seafood', total: 310, items: [
        { vendor_sku: 'SCAFDUU10BRO', description: 'SCALLOPS FR DRY U10 GAL', unit_price: 310, amount: 310, qty_ordered: 1, qty_received: 1, cost_per_lb: 38.75, price_type: 'per_lb', catchweight: false },
      ] } }],
      ingredient_vendors: [],
      vendor_item_aliases: [{ vendor: 'Fruge Seafood', vendor_sku: 'SCAFDUU10BRO', active: true, ingredient_id: 'ing-scallops' }],
      ingredient_links: [], invoice_lines: [],
    };
    const sb = makeMockSb(tables);
    const r = await vdaiApprove(sb, 'd3');
    assert.strictEqual(r.ok, true);
    const iv = tables.ingredient_vendors.find((x) => x.ingredient_id === 'ing-scallops');
    assert.ok(iv, 'a new ingredient_vendors row must exist for Scallops');
    assert.strictEqual(iv.vendor_sku, 'SCAFDUU10BRO');
    assert.strictEqual(tables.ingredient_vendors.length, 1, 'exactly one row, no duplicate');
    const line = tables.invoice_lines.find((l) => l.import_id === 'd3');
    assert.strictEqual(line.ingredient_id, 'ing-scallops');
  });

  // ══════════════════════════════════════════════════════════════
  // Scenario 4 — canonical row vecchia GA0 + nuova invoice BRO
  //              → stessa riga, economia aggiornata, IDENTITA' INVARIATA
  //
  // INV08FINAL.1 HA CAMBIATO L'ATTESO DI QUESTO SCENARIO, e va detto
  // chiaramente: MICRO-TASK 40 FASE 3 aveva DECISO che qui il vendor_sku
  // venisse ripuntato ("migrazione"), e questo test ancorava quella
  // decisione. E' stata rovesciata dopo averne misurato il costo su un
  // vendor che vende DUE prodotti diversi mappati allo stesso
  // ingrediente: importando 07133808 la riga canonica di Hardie's e'
  // passata da 07673 a 71908 e da 03493 a 71814, lasciando i due SKU
  // precedenti senza identita'. Il resto dello scenario — nessun
  // duplicato, stessa riga, data avanzata — resta verificato.
  // ══════════════════════════════════════════════════════════════
  await atest('4. Old canonical row (GA0) + NEWER alias invoice (BRO) → same row, economics updated, IDENTITY UNCHANGED', async () => {
    const tables = {
      vendor_documents: [{ id: 'd4', status: 'pending', vendor: 'Fruge Seafood', document_date: '2026-09-16', parsed_json: { document_type: 'invoice', vendor: 'Fruge Seafood', total: 310, items: [
        { vendor_sku: 'SCAFDUU10BRO', description: 'SCALLOPS FR DRY U10 GAL', unit_price: 310, amount: 310, qty_ordered: 1, qty_received: 1, cost_per_lb: 38.75, price_type: 'per_lb', catchweight: false },
      ] } }],
      ingredient_vendors: [ivRow('iv-scallops', 'Fruge Seafood', 'SCAFDUU10GA0', 'ing-scallops', null, 38.75)],
      vendor_item_aliases: [{ vendor: 'Fruge Seafood', vendor_sku: 'SCAFDUU10BRO', active: true, ingredient_id: 'ing-scallops' }],
      ingredient_links: [], invoice_lines: [],
    };
    const sb = makeMockSb(tables);
    const r = await vdaiApprove(sb, 'd4');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(tables.ingredient_vendors.length, 1, 'no second row created');
    const iv = tables.ingredient_vendors[0];
    assert.strictEqual(iv.id, 'iv-scallops', 'same row, updated in place');
    assert.strictEqual(iv.vendor_sku, 'SCAFDUU10GA0', 'IDENTITY: the primary SKU must NOT be repointed');
    assert.strictEqual(iv.last_invoice_date, '2026-09-16');
  });

  // ══════════════════════════════════════════════════════════════
  // Scenario 5 — stessa situazione ma invoice BRO più vecchia
  //              → nessuna migrazione
  // ══════════════════════════════════════════════════════════════
  await atest('5. Old canonical row (GA0) + OLDER alias invoice (BRO) → no migration, row untouched', async () => {
    const tables = {
      vendor_documents: [{ id: 'd5', status: 'pending', vendor: 'Fruge Seafood', document_date: '2026-07-01', parsed_json: { document_type: 'invoice', vendor: 'Fruge Seafood', total: 300, items: [
        { vendor_sku: 'SCAFDUU10BRO', description: 'SCALLOPS FR DRY U10 GAL', unit_price: 300, amount: 300, qty_ordered: 1, qty_received: 1, cost_per_lb: 37.50, price_type: 'per_lb', catchweight: false },
      ] } }],
      ingredient_vendors: [ivRow('iv-scallops', 'Fruge Seafood', 'SCAFDUU10GA0', 'ing-scallops', '2026-08-25', 38.75)],
      vendor_item_aliases: [{ vendor: 'Fruge Seafood', vendor_sku: 'SCAFDUU10BRO', active: true, ingredient_id: 'ing-scallops' }],
      ingredient_links: [], invoice_lines: [],
    };
    const sb = makeMockSb(tables);
    const r = await vdaiApprove(sb, 'd5');
    assert.strictEqual(r.ok, true, 'document still imports — only price intelligence is skipped');
    assert.strictEqual(tables.ingredient_vendors.length, 1);
    const iv = tables.ingredient_vendors[0];
    assert.strictEqual(iv.vendor_sku, 'SCAFDUU10GA0', 'SKU must NOT migrate — invoice is older');
    assert.strictEqual(iv.unit_price, 38.75, 'price must not regress');
    assert.strictEqual(iv.last_invoice_date, '2026-08-25');
    // invoice_lines identity still resolves via the alias regardless of the price-intel skip
    const line = tables.invoice_lines.find((l) => l.import_id === 'd5');
    assert.strictEqual(line.ingredient_id, 'ing-scallops');
  });

  // ══════════════════════════════════════════════════════════════
  // Scenario 6 — alias + direct coerenti → comportamento normale
  // ══════════════════════════════════════════════════════════════
  await atest('6. Direct SKU + alias for the SAME SKU, same ingredient_id → normal update, no conflict', async () => {
    const tables = {
      vendor_documents: [{ id: 'd6', status: 'pending', vendor: 'V', document_date: '2026-09-10', parsed_json: { document_type: 'invoice', vendor: 'V', total: 12, items: [
        { vendor_sku: 'S6', description: 'Item Six', unit_price: 12, amount: 12, qty_ordered: 1 },
      ] } }],
      ingredient_vendors: [ivRow('iv-6', 'V', 'S6', 'ing-6', '2026-08-01', 10)],
      vendor_item_aliases: [{ vendor: 'V', vendor_sku: 'S6', active: true, ingredient_id: 'ing-6' }],
      ingredient_links: [], invoice_lines: [],
    };
    const sb = makeMockSb(tables);
    const r = await vdaiApprove(sb, 'd6');
    assert.strictEqual(r.ok, true);
    const iv = tables.ingredient_vendors.find((x) => x.id === 'iv-6');
    assert.strictEqual(iv.unit_price, 12);
    assert.strictEqual(iv.last_invoice_date, '2026-09-10');
  });

  // ══════════════════════════════════════════════════════════════
  // Scenario 7 — alias + direct ingredient_id diversi
  //              → PRICE_IDENTITY_CONFLICT, NO price update, doc blocked
  // ══════════════════════════════════════════════════════════════
  await atest('7. Direct SKU + alias pointing to a DIFFERENT ingredient_id → PRICE_IDENTITY_CONFLICT, document blocked, zero price writes', async () => {
    const tables = {
      vendor_documents: [{ id: 'd7', status: 'pending', vendor: "Hardie's Fresh Foods / Dairyland Produce", document_date: '2026-09-10', parsed_json: { document_type: 'invoice', vendor: "Hardie's Fresh Foods / Dairyland Produce", total: 39.33, items: [
        { vendor_sku: '03252', description: 'SEED PUMPKIN ROASTED/SALTED', unit_price: 39.33, amount: 39.33, qty_ordered: 1 },
      ] } }],
      ingredient_vendors: [ivRow('iv-03252', "Hardie's Fresh Foods / Dairyland Produce", '03252', 'ing-pumpkin-seed', '2026-07-03', 39.33)],
      vendor_item_aliases: [{ vendor: "Hardie's Fresh Foods / Dairyland Produce", vendor_sku: '03252', active: true, ingredient_id: 'ing-seeds-generic' }],
      ingredient_links: [], invoice_lines: [],
    };
    const before = JSON.stringify(tables.ingredient_vendors);
    const sb = makeMockSb(tables);
    const pre = await vdaiPreflight(sb, tables.vendor_documents[0]);
    assert.strictEqual(pre.ok, false);
    assert.strictEqual(pre.reason, 'PRICE_IDENTITY_CONFLICT');
    assert.strictEqual(pre.conflicts.length, 1);
    assert.strictEqual(pre.conflicts[0].vendor_sku, '03252');
    assert.strictEqual(pre.conflicts[0].direct_ingredient_id, 'ing-pumpkin-seed');
    assert.strictEqual(pre.conflicts[0].alias_ingredient_id, 'ing-seeds-generic');

    const r = await vdaiApprove(sb, 'd7');
    assert.strictEqual(r.ok, false, 'the whole document must be blocked, never silently imported');
    assert.strictEqual(r.reason, 'PRICE_IDENTITY_CONFLICT');
    assert.strictEqual(JSON.stringify(tables.ingredient_vendors), before, 'zero price writes under either identity');
    assert.strictEqual(tables.vendor_documents[0].status, 'pending', 'document stays pending, not imported');
    assert.strictEqual((tables.invoice_lines || []).length, 0, 'no invoice_lines written either — approval never proceeded');
  });

  // ══════════════════════════════════════════════════════════════
  // Scenario 8 — ingredient_links fallback con invoice vecchia
  //              → chronology guard applicata
  // ══════════════════════════════════════════════════════════════
  await atest('8. ingredient_links fallback (no SKU match at all) + OLDER invoice → chronology guard still applies', async () => {
    const tables = {
      vendor_documents: [{ id: 'd8', status: 'pending', vendor: 'V', document_date: '2026-06-01', parsed_json: { document_type: 'invoice', vendor: 'V', total: 7, items: [
        { description: 'Romaine Hearts', unit_price: 7, amount: 7, qty_ordered: 1 },
      ] } }],
      ingredient_vendors: [ivRow('iv-8', 'V', 'OTHER-SKU', 'ing-8', '2026-08-01', 6)],
      vendor_item_aliases: [],
      ingredient_links: [{ vendor: 'V', invoice_description: 'Romaine Hearts', ingredient_id: 'ing-8', confirmed: true }],
      invoice_lines: [],
    };
    const sb = makeMockSb(tables);
    const r = await vdaiApprove(sb, 'd8');
    assert.strictEqual(r.ok, true);
    const iv = tables.ingredient_vendors.find((x) => x.id === 'iv-8');
    assert.strictEqual(iv.unit_price, 6, 'older invoice must not overwrite price via the link fallback either');
    assert.strictEqual(iv.vendor_sku, 'OTHER-SKU', 'no populate_sku migration on an older invoice');
    assert.strictEqual(iv.last_invoice_date, '2026-08-01');
  });

  // ══════════════════════════════════════════════════════════════
  // Scenario 9 — normal invoice_lines behavior invariato
  // ══════════════════════════════════════════════════════════════
  await atest('9. invoice_lines matching/writing is unaffected by all of the above (alias still wins there, as before MT40)', async () => {
    const tables = {
      vendor_documents: [{ id: 'd9', status: 'pending', vendor: 'V', document_date: '2026-09-01', parsed_json: { document_type: 'invoice', vendor: 'V', total: 9, items: [
        { vendor_sku: 'S9', description: 'Item Nine', unit_price: 9, amount: 9, qty_ordered: 1 },
      ] } }],
      ingredient_vendors: [],
      vendor_item_aliases: [{ vendor: 'V', vendor_sku: 'S9', active: true, ingredient_id: 'ing-9' }],
      ingredient_links: [], invoice_lines: [],
    };
    const sb = makeMockSb(tables);
    const r = await vdaiApprove(sb, 'd9');
    assert.strictEqual(r.ok, true);
    const line = tables.invoice_lines.find((l) => l.import_id === 'd9');
    assert.strictEqual(line.ingredient_id, 'ing-9');
    assert.strictEqual(line.match_status, 'matched');
    assert.strictEqual(line.line_total, 9);
  });

  // ══════════════════════════════════════════════════════════════
  // Scenario 10 — auto-import non regredisce sugli altri vendor
  // ══════════════════════════════════════════════════════════════
  await atest('10. Hardie\'s document with no aliases/conflicts at all behaves exactly as pre-MT40 (no regression)', async () => {
    const tables = {
      vendor_documents: [{ id: 'd10', status: 'pending', vendor: "Hardie's Fresh Foods / Dairyland Produce", document_date: '2026-09-12', parsed_json: { document_type: 'invoice', vendor: "Hardie's Fresh Foods / Dairyland Produce", total: 65.85, items: [
        { vendor_sku: '00108', description: 'ASPARAGUS LARGE', unit_price: 65.85, amount: 65.85, qty_ordered: 1 },
      ] } }],
      ingredient_vendors: [ivRow('iv-00108', "Hardie's Fresh Foods / Dairyland Produce", '00108', 'ing-asparagus', '2026-09-01', 60)],
      vendor_item_aliases: [{ vendor: "Hardie's Fresh Foods / Dairyland Produce", vendor_sku: '00108', active: true, ingredient_id: 'ing-asparagus' }],
      ingredient_links: [], invoice_lines: [],
    };
    const sb = makeMockSb(tables);
    const r = await vdaiApprove(sb, 'd10');
    assert.strictEqual(r.ok, true);
    const iv = tables.ingredient_vendors.find((x) => x.id === 'iv-00108');
    assert.strictEqual(iv.unit_price, 65.85);
    assert.strictEqual(iv.last_invoice_date, '2026-09-12');
    assert.strictEqual(tables.vendor_documents[0].status, 'imported');
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail > 0 ? 1 : 0);
})();
