// ══════════════════════════════════════════════════════════════════
// INV06B + INV06C — lifecycle di invoice_warnings dalla Vendor Review.
//
// INV06B ha dato un solo proprietario alla transizione e l'UPDATE per id.
// INV06C ha reso l'operazione ATOMICA: documento e riga passano da una
// sola RPC server-side, vdr_resolve_warning, dentro una transazione.
// Gli unici due esiti ammessi sono SUCCESS (entrambi coerenti) e FAILURE
// (nessuno dei due modificato).
//
// Il sorgente vero viene ESTRATTO da js/vendor-documents-review.js e
// valutato in Node con window, document e un client Supabase finti. Il
// finto rpc modella la transazione: se fallisce, non registra NIENTE.
//
// `node tests/vendor-review-warning-lifecycle.test.js`
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'vendor-documents-review.js'), 'utf8');

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

// ── Client finto. L'rpc modella la transazione del DB. ────────────
function makeSb(docRow, opts) {
  opts = opts || {};
  const commits = [];      // solo cio' che il DB avrebbe COMMESSO
  const attempts = [];     // ogni chiamata, riuscita o no
  const legacy = [];       // eventuali write dirette (non devono esistere piu')
  return {
    _commits: commits, _attempts: attempts, _legacy: legacy,
    rpc(name, params) {
      attempts.push({ name, params });
      if (name !== 'vdr_resolve_warning') return Promise.resolve({ data: null, error: { message: 'rpc sconosciuta' } });
      if (opts.docFail)  return Promise.resolve({ data: null, error: { message: 'documento non aggiornato' } });
      if (opts.warnFail) return Promise.resolve({ data: null, error: { message: 'invoice_warnings inesistente' } });
      // successo: la transazione ha scritto il documento e, se c'era un id, la riga
      commits.push({ table: 'vendor_documents', payload: { warnings: params.p_warnings, parsed_json: params.p_parsed_json } });
      let state = 'none';
      if (params.p_warning_id) {
        const aperto = (opts.openIds || []).includes(params.p_warning_id);
        state = aperto ? 'closed' : 'already_closed';
        if (aperto) commits.push({ table: 'invoice_warnings', id: params.p_warning_id,
                                   status: params.p_status, resolution: params.p_resolution,
                                   resolved_by: params.p_resolved_by });
      }
      return Promise.resolve({ data: { ok: true, document_updated: true,
                                       warning_updated: state === 'closed', warning_state: state }, error: null });
    },
    from(table) {
      const b = { table, filters: {},
        select() { return b; }, eq(k, v) { b.filters[k] = v; return b; },
        update(p) { b.payload = p; legacy.push(b); return b; },
        single() { return Promise.resolve({ data: docRow, error: null }); },
        then(res, rej) { legacy.push(b); return Promise.resolve({ data: null, error: null }).then(res, rej); },
      };
      return b;
    },
  };
}

function makeEnv(cfg) {
  const inputs = cfg.inputs || {};
  const toasts = [];
  const win = { _vdrQuestions: {}, _vdrOpenWarnings: cfg.openWarnings || {},
                _currentUser: 'tester', supabaseClient: null, _toasts: toasts };
  const doc = { getElementById: id =>
    (Object.prototype.hasOwnProperty.call(inputs, id) ? { value: inputs[id], focus() {} } : null) };
  return { win, doc, toasts };
}

function load(env, sb) {
  env.win.supabaseClient = sb;
  const body = [
    extractFn('vdrFindWarningRowId'),
    extractFn('vdrWarningRowExpected'),
    extractFn('vdrResolveWarningAtomic'),
    extractFn('vdrResolveQuestion'),
    extractFn('vdrAnswerYes'),
    extractFn('vdrAnswerFollowup'),
    extractFn('vdrAnswerDirect'),
    extractFn('vdrAnswerSkip'),
    extractFn('vdrAnswerWeight'),
    extractFn('vdrSaveEach'),
    'return { vdrFindWarningRowId, vdrWarningRowExpected, vdrResolveQuestion, vdrSaveEach };',
  ].join('\n');
  return new Function('window', 'document', 'console', 'showScToast', 'vdrRefreshBadge', 'setTimeout',
    body)(env.win, env.doc, { warn() {}, log() {} },
          m => env.toasts.push(m), () => {}, f => f && f());
}

const DOC = 'doc-1';
const W_BRANZINI = { code: 'OQR-007', message: 'ordered 22 LB, received 22.5 LB of BRANZINI' };
const W_SALMON   = { code: 'OQR-007', message: 'ordered 16 LB, received 14.65 LB of SALMON' };
const IT_BRANZINI = { description: 'BRANZINI FR WHOLE 800-1000', warnings: [W_BRANZINI] };
const IT_SALMON   = { description: 'SALMON FR FILLET 3-5 ATLANTIC', warnings: [W_SALMON] };
const ROWS = [
  { id: 'row-branzini', document_id: DOC, code: 'OQR-007', item_description: IT_BRANZINI.description, message: W_BRANZINI.message, status: 'open' },
  { id: 'row-salmon',   document_id: DOC, code: 'OQR-007', item_description: IT_SALMON.description,   message: W_SALMON.message,   status: 'open' },
];
const docRow = () => ({
  warnings: [{ ...W_BRANZINI, item: IT_BRANZINI.description }, { ...W_SALMON, item: IT_SALMON.description }],
  parsed_json: { items: [JSON.parse(JSON.stringify(IT_BRANZINI)), JSON.parse(JSON.stringify(IT_SALMON))] },
});

function setup(cfg) {
  cfg = cfg || {};
  const env = makeEnv({ openWarnings: { [DOC]: cfg.rows === undefined ? ROWS : cfg.rows }, inputs: cfg.inputs });
  const sb = makeSb(docRow(), { openIds: cfg.openIds === undefined ? ['row-branzini', 'row-salmon'] : cfg.openIds,
                                docFail: cfg.docFail, warnFail: cfg.warnFail });
  const api = load(env, sb);
  const q = Object.assign({ qid: 'q1', code: 'OQR-007', item: IT_BRANZINI, title: IT_BRANZINI.description }, cfg.q || {});
  q.invoiceWarningId = cfg.forceId !== undefined ? cfg.forceId
    : api.vdrFindWarningRowId(DOC, cfg.w || W_BRANZINI, cfg.item === null ? null : (cfg.item || IT_BRANZINI));
  env.win._vdrQuestions['q1'] = q;
  return { env, sb, api, q };
}

const rpcCalls = sb => sb._attempts.filter(a => a.name === 'vdr_resolve_warning');
const committedWarn = sb => sb._commits.filter(c => c.table === 'invoice_warnings');
const committedDoc  = sb => sb._commits.filter(c => c.table === 'vendor_documents');

// ══════════════════════════════════════════════════════════════════

test('1. successo: una sola RPC, documento e riga commessi insieme', async () => {
  const t = setup();
  await t.api.vdrResolveQuestion(DOC, 'q1', 0, { answered: true, answer: 'yes' });
  assert.strictEqual(rpcCalls(t.sb).length, 1, 'una sola operazione server-side');
  assert.strictEqual(committedDoc(t.sb).length, 1);
  assert.strictEqual(committedWarn(t.sb).length, 1);
  assert.strictEqual(t.sb._legacy.length, 0, 'nessuna write diretta residua');
});

test('2. fallimento sul documento: NIENTE commesso, errore propagato', async () => {
  const t = setup({ docFail: true });
  await t.api.vdrResolveQuestion(DOC, 'q1', 0, { answered: true, answer: 'yes' });
  assert.strictEqual(t.sb._commits.length, 0, 'nessun commit');
  assert.ok(t.env.toasts.some(m => /Error/i.test(m)), 'l errore deve arrivare all utente');
});

test('3. fallimento sulla riga warning: NIENTE commesso, errore propagato', async () => {
  const t = setup({ warnFail: true });
  await t.api.vdrResolveQuestion(DOC, 'q1', 0, { answered: true, answer: 'yes' });
  assert.strictEqual(t.sb._commits.length, 0,
    'il documento NON deve restare risolto con la riga aperta');
  assert.ok(t.env.toasts.some(m => /Error/i.test(m)));
});

test('4. nessun commit parziale in nessuno dei due fallimenti', async () => {
  for (const cfg of [{ docFail: true }, { warnFail: true }]) {
    const t = setup(cfg);
    await t.api.vdrResolveQuestion(DOC, 'q1', 0, { answered: true, answer: 'yes' });
    const d = committedDoc(t.sb).length, w = committedWarn(t.sb).length;
    assert.strictEqual(d, w, 'documento e riga devono muoversi insieme: ' + d + ' vs ' + w);
    assert.strictEqual(d, 0);
  }
});

test('5. doppio click: idempotente, la seconda volta la riga e gia chiusa', async () => {
  const t = setup();
  await t.api.vdrResolveQuestion(DOC, 'q1', 0, { answered: true, answer: 'yes' });
  const t2 = setup({ openIds: [] });          // il DB la trova gia' chiusa
  await t2.api.vdrResolveQuestion(DOC, 'q1', 0, { answered: true, answer: 'yes' });
  assert.strictEqual(committedWarn(t2.sb).length, 0, 'non si riscrive la risoluzione originale');
  assert.ok(!t2.env.toasts.some(m => /Error/i.test(m)), 'e non e un errore');
});

test('6. gia resolved: la RPC parte comunque e torna already_closed senza errore', async () => {
  const t = setup({ openIds: [] });
  await t.api.vdrResolveQuestion(DOC, 'q1', 0, { answered: true, answer: 'yes' });
  assert.strictEqual(rpcCalls(t.sb).length, 1);
  assert.strictEqual(committedWarn(t.sb).length, 0);
  assert.ok(!t.env.toasts.some(m => /Error/i.test(m)));
});

test('7. nessuna riga attesa (es. OQR-006): p_warning_id null, documento risolto', async () => {
  const t = setup({ rows: [], forceId: null, q: { code: 'OQR-006' } });
  await t.api.vdrResolveQuestion(DOC, 'q1', 0, { answered: true, answer: 'yes' });
  assert.strictEqual(rpcCalls(t.sb)[0].params.p_warning_id, null);
  assert.strictEqual(committedDoc(t.sb).length, 1, 'OQR-006 deve restare risolvibile');
  assert.ok(!t.env.toasts.some(m => /Error/i.test(m)));
});

test('8. riga attesa ma identita ambigua: rifiuto, zero scritture', async () => {
  const dup = [
    { id: 'dup-a', document_id: DOC, code: 'OQR-007', item_description: IT_BRANZINI.description, message: W_BRANZINI.message, status: 'open' },
    { id: 'dup-b', document_id: DOC, code: 'OQR-007', item_description: IT_BRANZINI.description, message: W_BRANZINI.message, status: 'open' },
  ];
  const t = setup({ rows: dup, openIds: ['dup-a', 'dup-b'] });
  assert.strictEqual(t.q.invoiceWarningId, null, 'due candidate identiche = nessuna scelta');
  await t.api.vdrResolveQuestion(DOC, 'q1', 0, { answered: true, answer: 'yes' });
  assert.strictEqual(rpcCalls(t.sb).length, 0, 'la RPC non deve nemmeno partire');
  assert.strictEqual(t.sb._commits.length, 0);
  assert.ok(t.env.toasts.some(m => /univoco/i.test(m)), 'l utente deve sapere perche');
});

test('9. due warning stesso code: si chiude esattamente il proprio, per id', async () => {
  const branzini = setup();
  const salmon   = setup({ w: W_SALMON, item: IT_SALMON, q: { item: IT_SALMON, title: IT_SALMON.description } });
  assert.strictEqual(branzini.q.invoiceWarningId, 'row-branzini');
  assert.strictEqual(salmon.q.invoiceWarningId, 'row-salmon');
  await branzini.api.vdrResolveQuestion(DOC, 'q1', 0, { answered: true, answer: 'yes' });
  const p = rpcCalls(branzini.sb)[0].params;
  assert.strictEqual(p.p_warning_id, 'row-branzini');
  assert.ok(!('p_code' in p) && !('p_item_description' in p),
    'la RPC non accetta nemmeno chiavi larghe');
});

test('10. OQR-009: semantica di business invariata, una sola operazione', async () => {
  const skip = setup({ q: { code: 'OQR-009' } });
  await skip.env.win.vdrAnswerSkip(DOC, 'q1', 0);
  let p = rpcCalls(skip.sb)[0].params;
  assert.strictEqual(p.p_status, 'skipped');
  assert.strictEqual(p.p_resolution, 'skipped by user');

  const each = setup({ q: { code: 'OQR-009', item: { description: IT_BRANZINI.description } } });
  await each.api.vdrSaveEach(DOC, 'q1', 0, 12);
  p = rpcCalls(each.sb)[0].params;
  assert.strictEqual(p.p_status, 'resolved');
  assert.strictEqual(p.p_resolution, 'units_per_case=12');

  const weight = setup({ q: { code: 'OQR-009', item: { description: IT_BRANZINI.description } },
                         inputs: { 'vdrWInput-q1': '250' } });
  await weight.env.win.vdrAnswerWeight(DOC, 'q1', 0);
  p = rpcCalls(weight.sb)[0].params;
  assert.strictEqual(p.p_status, 'resolved');
  assert.strictEqual(p.p_resolution, 'unit_weight_g=250');
  for (const t of [skip, each, weight]) assert.strictEqual(rpcCalls(t.sb).length, 1);
});

test('11. Yes / Followup / Direct: label invariate, documento coerente', async () => {
  const yes = setup();
  await yes.env.win.vdrAnswerYes(DOC, 'q1', 0);
  assert.strictEqual(rpcCalls(yes.sb)[0].params.p_resolution, 'yes');

  const fu = setup({ inputs: { 'vdrQFollowupInput-q1': 'peso reale 21 LB' } });
  await fu.env.win.vdrAnswerFollowup(DOC, 'q1', 0);
  assert.strictEqual(rpcCalls(fu.sb)[0].params.p_resolution, 'no — peso reale 21 LB');

  const dir = setup({ inputs: { 'vdrInput-q1': '22.5' } });
  await dir.env.win.vdrAnswerDirect(DOC, 'q1', 0);
  assert.strictEqual(rpcCalls(dir.sb)[0].params.p_resolution, '22.5');

  for (const t of [yes, fu, dir]) {
    assert.strictEqual(committedDoc(t.sb).length, 1);
    assert.strictEqual(committedWarn(t.sb).length, 1);
  }
});

test('12. invoice_lines non viene mai toccata', async () => {
  const t = setup();
  await t.env.win.vdrAnswerYes(DOC, 'q1', 0);
  for (const c of t.sb._commits) assert.notStrictEqual(c.table, 'invoice_lines');
  for (const l of t.sb._legacy)  assert.notStrictEqual(l.table, 'invoice_lines');
  assert.ok(!('p_invoice_lines' in rpcCalls(t.sb)[0].params));
});

test('13. lo status del documento non viene toccato', async () => {
  const t = setup();
  await t.env.win.vdrAnswerYes(DOC, 'q1', 0);
  const p = rpcCalls(t.sb)[0].params;
  assert.deepStrictEqual(Object.keys(p).sort(),
    ['p_document_id','p_parsed_json','p_resolution','p_resolved_by','p_status','p_warning_id','p_warnings'].sort());
  assert.ok(!('p_document_status' in p), 'nessun parametro puo cambiare lo status');
});

test('14. correlazione: distingue per message, non solo code+item', () => {
  const t = setup();
  assert.strictEqual(
    t.api.vdrFindWarningRowId(DOC, { code: 'OQR-007', message: 'inesistente' }, IT_BRANZINI), null);
});

Promise.resolve().then(() => setTimeout(() => {
  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}, 60));
