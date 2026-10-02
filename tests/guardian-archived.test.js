// GUARD01 — bot-recipe-guardian v14.2: archived recipes never create operational alerts.
// Plain Node: `node tests/guardian-archived.test.js` (needs esbuild on NODE_PATH, like trevipay-revision).
// The real index.ts runs against an in-memory database: Deno.serve and createClient are replaced.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message ? e.message : e)); }
}

function makeDb(tables) {
  const writes = [];
  function builder(t) {
    const st = { f: [], op: 'select', lim: null };
    const api = {
      select() { return api; },
      eq(c, v) { st.f.push(r => r[c] === v); return api; },
      neq(c, v) { st.f.push(r => r[c] !== v); return api; },
      in(c, v) { st.f.push(r => v.includes(r[c])); return api; },
      not(c, op, v) { st.f.push(r => !(op === 'is' && v === null ? r[c] == null : r[c] === v)); return api; },
      gte(c, v) { st.f.push(r => String(r[c]) >= String(v)); return api; },
      limit(n) { st.lim = n; return api; }, order() { return api; },
      insert(row) { st.op = 'insert'; st.rows = Array.isArray(row) ? row : [row]; return api; },
      update(d) { st.op = 'update'; st.upd = d; return api; },
      then(a, b) { return run().then(a, b); },
    };
    async function run() {
      tables[t] = tables[t] || [];
      if (st.op === 'insert') { tables[t].push(...st.rows); writes.push({ t, op: 'insert', rows: st.rows }); return { data: st.rows, error: null }; }
      const m = tables[t].filter(r => st.f.every(f => f(r)));
      if (st.op === 'update') { m.forEach(r => Object.assign(r, st.upd)); writes.push({ t, op: 'update', ids: m.map(r => r.id), upd: st.upd }); return { data: m, error: null }; }
      return { data: st.lim ? m.slice(0, st.lim) : m, error: null };
    }
    return api;
  }
  return { tables, writes, from: t => builder(t) };
}

let handler = null;
function loadGuardian() {
  const esbuild = require('esbuild');
  const src = fs.readFileSync(path.join(__dirname, '../edge-functions/bot-recipe-guardian/index.ts'), 'utf8')
    .split('\n').filter(l => !/^import .*esm\.sh/.test(l)).join('\n');
  const js = esbuild.transformSync(src, { loader: 'ts', format: 'cjs' }).code;
  globalThis.Deno = { serve: fn => { handler = fn; }, env: { get: () => 'x' } };
  new Function('require', 'module', 'exports', 'createClient', js)(require, { exports: {} }, {}, () => globalThis.__db);
}

const today = new Date().toISOString().slice(0, 10);
function fixture() {
  return {
    recipes: [
      { id: 'A1', title: 'Porterhouse', pos_name: 'Porterhouse', category: 'SECONDI', serving_unit: 'porzione', serving_qty: 1, base_servings: null, procedure: 'x', procedure_en: 'x', image_url: 'p.jpg' },
      { id: 'A2', title: 'House Salad', pos_name: 'House Salad', category: 'Salad', serving_unit: 'porzione', serving_qty: 1, base_servings: 1, procedure: 'x', procedure_en: 'x', image_url: 'p.jpg' },
      { id: 'Z1', title: 'Scallops Asparagus Gnocchi', pos_name: 'Scallops Asparagus Gnocchi', category: 'Archived', serving_unit: 'pezzi', serving_qty: 3, base_servings: null, procedure: null, procedure_en: null, image_url: null },
    ],
    recipe_yield: [ { id: 'A1', has_yield: false, portions: null }, { id: 'A2', has_yield: true, portions: 1 }, { id: 'Z1', has_yield: false, portions: null } ],
    pos_sales_by_item: [ { menu_item: 'Porterhouse', quantity: 3, sale_date: today }, { menu_item: 'House Salad', quantity: 5, sale_date: today }, { menu_item: 'Scallops Asparagus Gnocchi', quantity: 2, sale_date: today } ],
    recipe_bom: ['A1', 'A2', 'Z1'].flatMap(p => [1, 2, 3, 4, 5].map(i => ({ parent_recipe_id: p, component_type: 'ITEM', item_id: p + i, quantity: 10, unit: 'g' }))),
    office_items: [
      { id: 'o-arch-yield', bot_id: 'recipe_guardian', source_id: 'Z1', issue_type: 'missing_yield', status: 'open', times_seen: 1 },
      { id: 'o-arch-photo', bot_id: 'recipe_guardian', source_id: 'Z1', issue_type: 'missing_photo', status: 'open', times_seen: 3 },
      { id: 'o-active', bot_id: 'recipe_guardian', source_id: 'A1', issue_type: 'missing_yield', status: 'open', times_seen: 1 },
      { id: 'o-old-bs', bot_id: 'recipe_guardian', source_id: 'A2', issue_type: 'missing_base_servings', status: 'open', times_seen: 9 },
    ],
  };
}

(async () => {
  console.log('\n  GUARD01 — Guardian v14.2, archived recipes');
  loadGuardian();
  globalThis.__db = makeDb(fixture());
  const res = await handler(new Request('https://x/'));
  const out = await res.json();
  const db = globalThis.__db;
  const byId = Object.fromEntries(db.tables.office_items.map(o => [o.id, o]));

  await test('the run succeeds and reports v14.2 with the archived recipe skipped', () => {
    assert.strictEqual(out.ok, true, JSON.stringify(out));
    assert.strictEqual(out.version, 'v14.2');
    assert.strictEqual(out.recipes_checked, 2);
    assert.strictEqual(out.archived_skipped, 1);
  });
  await test('no new alert is created for the archived recipe', () => {
    const inserted = db.writes.filter(w => w.op === 'insert').flatMap(w => w.rows);
    assert.ok(!inserted.some(r => r.source_id === 'Z1'), JSON.stringify(inserted.map(r => r.source_id + ':' + r.issue_type)));
  });
  await test('open alerts on the archived recipe are closed with a traceable reason', () => {
    for (const id of ['o-arch-yield', 'o-arch-photo']) {
      assert.strictEqual(byId[id].status, 'resolved', id);
      assert.match(byId[id].resolution, /recipe archived.*GUARD01/);
    }
    assert.strictEqual(out.archived_closed, 2);
  });
  await test('the active "No yield" alert stays open (Porterhouse is not touched)', () => {
    assert.strictEqual(byId['o-active'].status, 'open');
    assert.strictEqual(byId['o-active'].times_seen, 2, 'seen again by this run');
  });
  await test('regression: old missing_base_servings are still retired as in v14.1', () => {
    assert.strictEqual(byId['o-old-bs'].status, 'resolved');
    assert.match(byId['o-old-bs'].resolution, /canonical yield/);
  });

  console.log(`\n  ${pass} pass, ${fail} fail\n`);
  process.exit(fail ? 1 : 0);
})();
