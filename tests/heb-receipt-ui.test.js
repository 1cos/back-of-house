// HEB01 — schermata iPhone dello scontrino H-E-B (jsdom).
// Leggere e rispondere non scrive; solo Confirm chiama l'import, una volta.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');

const LINES = [
  ['PORTERHOUSE STEAK USDA PR', 46.52], ['BF RE RST PRIME BNLS 6-8', 247.44], ['PRIME NY STRIP STEAK VP', 175.85],
  ['BF RE RST PRIME BNLS 6-8', 285.61], ['PRIME NY STRIP STEAK VP', 143.23], ['TENDERLOIN ROAST USDA PR', 99.93],
  ['TENDERLOIN ROAST USDA PR', 98.57], ['TENDERLOIN ROAST USDA PR', 106.39], ['TENDERLOIN ROAST USDA PR', 90.07],
].map(([d, a], i) => ({ idx: i + 1, description: d, key: d, amount: a, weight_lb: null, needs_check: false }));
const q = (kind) => ({ kind, prompt: kind, why: 'why' });
const G = (key, idx, amount, ing) => ({ key, description: key, line_idx: idx, packages: idx.length, amount, printed_weight_lb: null,
  ingredient_id: ing, mapping_confirmed: false, ask: 'pieces', std_g: null, questions: [q('mapping'), q('pieces')] });
const PARSE = {
  ok: true, photo_sha256: 'x', receipt: { store: '752', date: '2026-10-02', time: '12:54', total: 1293.61 },
  lines: LINES, reconciliation: { ok: true },
  groups: [G('PORTERHOUSE STEAK USDA PR', [1], 46.52, 'p'), G('BF RE RST PRIME BNLS 6-8', [2, 4], 533.05, null),
           G('PRIME NY STRIP STEAK VP', [3, 5], 319.08, 'n'), { ...G('TENDERLOIN ROAST USDA PR', [6, 7, 8, 9], 394.96, 'f'), std_g_suggested: { grams: 226.8, recipe: 'Filets' } }],
  ingredients: [{ id: 'p', name: 'Porterhouse' }, { id: 'n', name: 'New York Strip' }, { id: 'f', name: 'Beef Filet' }, { id: 'r', name: 'Ribeye' }],
};

function boot() {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://1cos.github.io/back-of-house/' });
  const w = dom.window;
  w.SUPABASE_URL = 'https://x.supabase.co'; w.SUPABASE_ANON_KEY = 'anon';
  w.localStorage.setItem('brigade_token', 't'.repeat(64));
  const calls = [];
  w.fetch = async (url, opt) => {
    const b = JSON.parse(opt.body); calls.push(b.action);
    if (b.action === 'parse') return { json: async () => JSON.parse(JSON.stringify(PARSE)) };
    await new Promise((r) => setTimeout(r, 20));
    return { json: async () => ({ ok: true, result: { status: calls.filter((c) => c === 'import').length > 1 ? 'already_imported' : 'imported', lines: 9,
      prices: [{ ingredient_id: 'f', ask: 'pieces', cost_each: 19.75 }] } }) };
  };
  // la riduzione della foto usa canvas: in test la salto
  w.eval(fs.readFileSync(path.join(ROOT, 'js/heb-receipt.js'), 'utf8'));
  return { w, calls };
}
async function toQuestions(env) {
  env.w.openHebReceipt();
  const input = env.w.document.querySelector('#hebModal input[type=file]');
  Object.defineProperty(input, 'files', { value: [{}] });
  env.w.URL.createObjectURL = () => 'blob:x'; env.w.URL.revokeObjectURL = () => {};
  // Image che "carica" subito, canvas finto
  env.w.Image = class { set src(v) { this.width = 1000; this.height = 2000; setTimeout(() => this.onload(), 0); } };
  env.w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  env.w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,QUJD';
  await env.w.hebOnFile(input);
}
const text = (w) => w.document.getElementById('hebModal') ? w.document.getElementById('hebModal').textContent : '';

let pass = 0, fail = 0;
const tests = [];
const test = (n, f) => tests.push([n, f]);

test('1. dopo la foto: 4 card di domande, totale che torna, nessun import', async () => {
  const env = await (async () => { const e = boot(); await toQuestions(e); return e; })();
  assert.ok(/We need a few details/.test(text(env.w)));
  assert.ok(/add up to the receipt total \$1293\.61/.test(text(env.w)));
  assert.strictEqual(env.w.document.querySelectorAll('#hebModal select').length, 4);
  assert.deepStrictEqual(env.calls, ['parse']);
  assert.strictEqual(env.w.document.getElementById('hebGo'), null, 'Review nascosto finche\' mancano risposte');
});

test('2. Cancel non scrive nulla', async () => {
  const env = boot(); await toQuestions(env);
  env.w.hebClose();
  assert.strictEqual(env.w.document.getElementById('hebModal'), null);
  assert.deepStrictEqual(env.calls, ['parse']);
});

async function answerAll(env) {
  env.w.hebSet(1, 'ingredient_id', 'r');
  env.w.hebSet(0, 'pieces', '2'); env.w.hebSet(1, 'pieces', '24'); env.w.hebSet(2, 'pieces', '12'); env.w.hebSet(3, 'pieces', '20');
  env.w.hebStd(3, true);
}

test('3. risposte complete → Review con costo per pezzo, ancora nessun import', async () => {
  const env = boot(); await toQuestions(env); await answerAll(env);
  assert.ok(env.w.document.getElementById('hebGo'), 'Review visibile');
  env.w.hebReview();
  const t = text(env.w);
  assert.ok(/Ribeye/.test(t) && /\$22\.21 \/ piece/.test(t), 'rib roast → Ribeye, 533.05/24');
  assert.ok(/\$19\.75 \/ piece/.test(t), 'tenderloin 394.96/20');
  assert.ok(/Inventory is not changed/.test(t));
  assert.deepStrictEqual(env.calls, ['parse'], 'la Review non scrive');
});

test('4. Confirm premuto due volte → UNA sola chiamata di import', async () => {
  const env = boot(); await toQuestions(env); await answerAll(env); env.w.hebReview();
  const b = [...env.w.document.querySelectorAll('#hebModal button')].find((x) => x.textContent === 'Confirm import');
  const p1 = env.w.hebConfirm(b); const p2 = env.w.hebConfirm(b);
  await Promise.all([p1, p2]);
  assert.deepStrictEqual(env.calls, ['parse', 'import']);
  assert.ok(/Receipt imported/.test(text(env.w)));
});

test('5. pezzi non interi → niente Review', async () => {
  const env = boot(); await toQuestions(env); await answerAll(env);
  env.w.hebSet(0, 'pieces', '2.5');
  assert.strictEqual(env.w.document.getElementById('hebGo'), null);
});

test('6. importo corretto a mano che rompe il totale → blocco con differenza', async () => {
  const env = boot(); await toQuestions(env); await answerAll(env);
  env.w.hebTotal('1300');
  assert.ok(/Lines add up to \$1293\.61, the receipt says \$1300\.00/.test(text(env.w)));
  assert.strictEqual(env.w.document.getElementById('hebGo'), null);
});

(async () => {
  for (const [n, f] of tests) {
    try { await f(); pass++; console.log('  ok  ' + n); }
    catch (e) { fail++; console.log('  FAIL ' + n + '\n       ' + (e && e.message)); }
  }
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
