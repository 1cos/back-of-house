// ══════════════════════════════════════════════════════════════════
// INV06B — lifecycle di invoice_warnings dal percorso Vendor Review.
//
// Come gli altri test di questa serie, il sorgente vero viene ESTRATTO da
// js/vendor-documents-review.js e valutato in Node con window, document e
// un client Supabase finti. Non e' una riscrittura della logica: se
// qualcuno toglie l'update del lifecycle, questi test diventano rossi
// (prova di mutazione documentata nel report).
//
// `node tests/vendor-review-warning-lifecycle.test.js`
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'vendor-documents-review.js'), 'utf8');

// Estrae `function NAME(...)` oppure `window.NAME = async function(...)`.
function extractFn(name) {
  let start = SRC.indexOf('\nfunction ' + name + '(');
  if (start === -1) start = SRC.indexOf('\nasync function ' + name + '(');
  if (start === -1) start = SRC.indexOf('\nwindow.' + name + ' = async function');
  if (start === -1) start = SRC.indexOf('\nwindow.' + name + ' = function');
  assert.notStrictEqual(start, -1, 'funzione non trovata: ' + name);
  let depth = 0;
  for (let j = SRC.indexOf('{', start); j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (depth === 0) return SRC.slice(start + 1, j + 1); }
  }
  throw new Error('parentesi non bilanciate in ' + name);
}

let pass = 0, fail = 0;
function test(name, fn) {
  const done = e => { if (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e.stack || e)); }
                      else { pass++; console.log('  ✓ ' + name); } };
  try { const r = fn(); if (r && r.then) return r.then(() => done(), done); done(); }
  catch (e) { done(e); }
}

// ── Client Supabase finto, che registra ogni scrittura ────────────
function makeSb(docRow, opts) {
  opts = opts || {};
  const writes = [];
  function builder(table, op, payload) {
    const b = { table, op, payload, filters: {},
      select() { return b; },
      eq(k, v) { b.filters[k] = v; return b; },
      single() { return Promise.resolve({ data: docRow, error: null }); },
      then(res, rej) {
        writes.push({ table: b.table, payload: b.payload, filters: b.filters });
        if (b.table === 'invoice_warnings') {
          if (opts.warningUpdateError) return Promise.resolve({ data: null, error: { message: opts.warningUpdateError } }).then(res, rej);
          // idempotenza reale del DB: la riga si aggiorna solo se e' open
          const hit = (opts.openIds || []).includes(b.filters.id) ? [{ id: b.filters.id }] : [];
          return Promise.resolve({ data: hit, error: null }).then(res, rej);
        }
        return Promise.resolve({ data: null, error: opts.docUpdateError ? { message: opts.docUpdateError } : null }).then(res, rej);
      },
    };
    return b;
  }
  return {
    _writes: writes,
    from(table) {
      return {
        select() { return builder(table, 'select', null); },
        update(payload) { return builder(table, 'update', payload); },
      };
    },
  };
}

// ── Ambiente ──────────────────────────────────────────────────────
function makeEnv(cfg) {
  const inputs = cfg.inputs || {};
  const win = {
    _vdrQuestions: {},
    _vdrOpenWarnings: cfg.openWarnings || {},
    _currentUser: 'tester',
    supabaseClient: null,
  };
  const doc = {
    getElementById(id) {
      if (Object.prototype.hasOwnProperty.call(inputs, id)) return { value: inputs[id], focus() {} };
      return null;   // nessuna card: il percorso DOM viene saltato
    },
  };
  return { win, doc };
}

function load(env, sb) {
  env.win.supabaseClient = sb;
  const body = [
    extractFn('vdrFindWarningRowId'),
    extractFn('vdrResolveWarningRow'),
    extractFn('vdrResolveQuestion'),
    extractFn('vdrAnswerYes'),
    extractFn('vdrAnswerFollowup'),
    extractFn('vdrAnswerDirect'),
    extractFn('vdrAnswerSkip'),
    extractFn('vdrAnswerWeight'),
    extractFn('vdrSaveEach'),
    'return { vdrFindWarningRowId, vdrResolveWarningRow, vdrResolveQuestion, vdrSaveEach, window };',
  ].join('\n');
  return new Function('window', 'document', 'console', 'showScToast', 'vdrRefreshBadge', 'setTimeout',
    body)(env.win, env.doc, { warn() {}, log() {} }, () => {}, () => {}, (f) => f && f());
}

// ── Dati di comodo ────────────────────────────────────────────────
const DOC = 'doc-1';
const W_BRANZINI = { code: 'OQR-007', message: 'Catchweight: ordered 22 LB, received 22.5 LB of BRANZINI' };
const W_SALMON   = { code: 'OQR-007', message: 'Catchweight: ordered 16 LB, received 14.65 LB of SALMON' };
const IT_BRANZINI = { description: 'BRANZINI FR WHOLE 800-1000', warnings: [W_BRANZINI] };
const IT_SALMON   = { description: 'SALMON FR FILLET 3-5 ATLANTIC', warnings: [W_SALMON] };

const ROWS = [
  { id: 'row-branzini', document_id: DOC, code: 'OQR-007', item_description: IT_BRANZINI.description, message: W_BRANZINI.message, status: 'open' },
  { id: 'row-salmon',   document_id: DOC, code: 'OQR-007', item_description: IT_SALMON.description,   message: W_SALMON.message,   status: 'open' },
];

function docRow() {
  return {
    warnings: [ { ...W_BRANZINI, item: IT_BRANZINI.description }, { ...W_SALMON, item: IT_SALMON.description } ],
    parsed_json: { items: [ JSON.parse(JSON.stringify(IT_BRANZINI)), JSON.parse(JSON.stringify(IT_SALMON)) ] },
  };
}

function setup(cfg) {
  cfg = cfg || {};
  const env = makeEnv({ openWarnings: { [DOC]: cfg.rows || ROWS }, inputs: cfg.inputs });
  const sb = makeSb(docRow(), { openIds: cfg.openIds || ['row-branzini', 'row-salmon'], ...cfg.sbOpts });
  const api = load(env, sb);
  const q = Object.assign({ qid: 'q1', code: 'OQR-007', item: IT_BRANZINI, title: IT_BRANZINI.description }, cfg.q || {});
  q.invoiceWarningId = cfg.forceId !== undefined
    ? cfg.forceId
    : api.vdrFindWarningRowId(DOC, cfg.w || W_BRANZINI, cfg.item === null ? null : (cfg.item || IT_BRANZINI));
  env.win._vdrQuestions['q1'] = q;
  return { env, sb, api, q };
}

const warnWrites = sb => sb._writes.filter(w => w.table === 'invoice_warnings');
const docWrites  = sb => sb._writes.filter(w => w.table === 'vendor_documents');

// ══════════════════════════════════════════════════════════════════

test('1. OQR-007 dal percorso normale chiude la riga invoice_warnings', async () => {
  const t = setup();
  assert.strictEqual(t.q.invoiceWarningId, 'row-branzini', 'la riga va identificata');
  await t.api.vdrResolveQuestion(DOC, 'q1', 0, { answered: true, answer: 'yes' });
  const w = warnWrites(t.sb);
  assert.strictEqual(w.length, 1, 'una sola scrittura su invoice_warnings');
  assert.strictEqual(w[0].payload.status, 'resolved');
  assert.strictEqual(w[0].filters.id, 'row-branzini', 'UPDATE per id');
  assert.strictEqual(w[0].filters.status, 'open', 'filtro di idempotenza presente');
  assert.ok(w[0].payload.resolved_at, 'resolved_at popolato');
  assert.strictEqual(w[0].payload.resolved_by, 'tester');
});

test('2. vdrAnswerYes: documento e invoice_warnings coerenti', async () => {
  const t = setup();
  await t.env.win.vdrAnswerYes(DOC, 'q1', 0);
  const d = docWrites(t.sb), w = warnWrites(t.sb);
  assert.strictEqual(d.length, 1, 'il documento viene aggiornato');
  assert.strictEqual(d[0].payload.warnings.length, 1, 'il warning sparisce da vendor_documents.warnings');
  assert.strictEqual(d[0].payload.parsed_json.items[0].warnings.length, 0, 'e da parsed_json');
  assert.strictEqual(w.length, 1, 'e la riga viene chiusa');
  assert.strictEqual(w[0].payload.resolution, 'yes');
});

test('3. vdrAnswerFollowup: entrambe le rappresentazioni, label con la correzione', async () => {
  const t = setup({ inputs: { 'vdrQFollowupInput-q1': 'peso reale 21 LB' } });
  await t.env.win.vdrAnswerFollowup(DOC, 'q1', 0);
  const w = warnWrites(t.sb);
  assert.strictEqual(docWrites(t.sb).length, 1);
  assert.strictEqual(w.length, 1);
  assert.strictEqual(w[0].payload.resolution, 'no — peso reale 21 LB', 'la correzione non va persa');
});

test('4. vdrAnswerDirect: entrambe coerenti, label = valore inserito', async () => {
  const t = setup({ inputs: { 'vdrInput-q1': '22.5' } });
  await t.env.win.vdrAnswerDirect(DOC, 'q1', 0);
  const w = warnWrites(t.sb);
  assert.strictEqual(docWrites(t.sb).length, 1);
  assert.strictEqual(w.length, 1);
  assert.strictEqual(w[0].payload.resolution, '22.5');
});

test('5. OQR-009 Skip: UNA sola transizione, semantica invariata', async () => {
  const t = setup({ q: { code: 'OQR-009' } });
  await t.env.win.vdrAnswerSkip(DOC, 'q1', 0);
  const w = warnWrites(t.sb);
  assert.strictEqual(w.length, 1, 'non piu due owner: una sola scrittura');
  assert.strictEqual(w[0].payload.status, 'skipped', 'lo status di business resta skipped');
  assert.strictEqual(w[0].payload.resolution, 'skipped by user');
  assert.strictEqual(w[0].filters.id, 'row-branzini');
});

test('6. OQR-009 SaveEach: UNA sola transizione, label units_per_case', async () => {
  const t = setup({ q: { code: 'OQR-009', item: { description: IT_BRANZINI.description } } });
  await t.api.vdrSaveEach(DOC, 'q1', 0, 12);
  const w = warnWrites(t.sb);
  assert.strictEqual(w.length, 1);
  assert.strictEqual(w[0].payload.status, 'resolved');
  assert.strictEqual(w[0].payload.resolution, 'units_per_case=12');
});

test('7. OQR-009 SaveWeight: UNA sola transizione, label unit_weight_g', async () => {
  const t = setup({ q: { code: 'OQR-009', item: { description: IT_BRANZINI.description } },
                    inputs: { 'vdrWInput-q1': '250' } });
  await t.env.win.vdrAnswerWeight(DOC, 'q1', 0);
  const w = warnWrites(t.sb);
  assert.strictEqual(w.length, 1);
  assert.strictEqual(w[0].payload.status, 'resolved');
  assert.strictEqual(w[0].payload.resolution, 'unit_weight_g=250');
});

test('8. warning gia chiuso: idempotente, nessun errore e nessuna riscrittura', async () => {
  const t = setup({ openIds: [] });          // il DB non trova righe open
  await t.api.vdrResolveQuestion(DOC, 'q1', 0, { answered: true, answer: 'yes' });
  await t.api.vdrResolveQuestion(DOC, 'q1', 0, { answered: true, answer: 'yes' });
  const w = warnWrites(t.sb);
  assert.strictEqual(w.length, 2, 'due tentativi');
  for (const x of w) assert.strictEqual(x.filters.status, 'open',
    'il filtro status=open rende il secondo passaggio un no-op lato DB');
  assert.strictEqual(docWrites(t.sb).length, 2, 'e il documento resta gestibile senza eccezioni');
});

test('9. riga invoice_warnings assente: fail closed, documento comunque risolto', async () => {
  const t = setup({ forceId: null });
  await t.api.vdrResolveQuestion(DOC, 'q1', 0, { answered: true, answer: 'yes' });
  assert.strictEqual(warnWrites(t.sb).length, 0, 'nessuna UPDATE alla cieca');
  assert.strictEqual(docWrites(t.sb).length, 1, 'il documento viene comunque risolto');
});

test('10. due warning stesso code sullo stesso documento: chiude solo il proprio', async () => {
  const branzini = setup();
  const salmon   = setup({ w: W_SALMON, item: IT_SALMON, q: { item: IT_SALMON, title: IT_SALMON.description } });
  assert.strictEqual(branzini.q.invoiceWarningId, 'row-branzini');
  assert.strictEqual(salmon.q.invoiceWarningId, 'row-salmon');
  assert.notStrictEqual(branzini.q.invoiceWarningId, salmon.q.invoiceWarningId);
  await branzini.api.vdrResolveQuestion(DOC, 'q1', 0, { answered: true, answer: 'yes' });
  const w = warnWrites(branzini.sb);
  assert.strictEqual(w.length, 1);
  assert.strictEqual(w[0].filters.id, 'row-branzini', 'non deve toccare il salmone');
  assert.ok(!('code' in w[0].filters), 'nessun filtro per code');
  assert.ok(!('document_id' in w[0].filters), 'nessun filtro per document_id');
  assert.ok(!('item_description' in w[0].filters), 'nessun filtro per item_description');
});

test('11. righe duplicate storiche: identita ambigua -> non si chiude niente', async () => {
  const dup = [
    { id: 'dup-a', document_id: DOC, code: 'OQR-007', item_description: IT_BRANZINI.description, message: W_BRANZINI.message, status: 'open' },
    { id: 'dup-b', document_id: DOC, code: 'OQR-007', item_description: IT_BRANZINI.description, message: W_BRANZINI.message, status: 'open' },
  ];
  const t = setup({ rows: dup, openIds: ['dup-a', 'dup-b'] });
  assert.strictEqual(t.q.invoiceWarningId, null, 'due candidate identiche = nessuna scelta');
  await t.api.vdrResolveQuestion(DOC, 'q1', 0, { answered: true, answer: 'yes' });
  assert.strictEqual(warnWrites(t.sb).length, 0, 'nessun broad resolve accidentale');
});

test('12. nessun tocco a vendor_documents.status ne a invoice_lines', async () => {
  const t = setup();
  await t.env.win.vdrAnswerYes(DOC, 'q1', 0);
  for (const wr of t.sb._writes) {
    assert.notStrictEqual(wr.table, 'invoice_lines', 'invoice_lines non va toccata');
    if (wr.table === 'vendor_documents') {
      assert.ok(!('status' in wr.payload), 'lo status del documento non si tocca');
      assert.deepStrictEqual(Object.keys(wr.payload).sort(), ['parsed_json', 'updated_at', 'warnings']);
    }
  }
});

test('13. la correlazione non guarda solo code+item: distingue per message', () => {
  const t = setup();
  const altro = t.api.vdrFindWarningRowId(DOC,
    { code: 'OQR-007', message: 'un messaggio che non esiste' }, IT_BRANZINI);
  assert.strictEqual(altro, null, 'senza corrispondenza esatta non si identifica nulla');
});

Promise.resolve().then(() => {
  setTimeout(() => {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    if (fail > 0) process.exit(1);
  }, 50);
});
