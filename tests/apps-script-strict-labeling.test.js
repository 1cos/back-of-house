// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 54B — etichettatura strict per il solo backfill.
//
// Questi test ESEGUONO davvero processLabelPDF: la sorgente viene estratta
// da Utils.gs.js e valutata con GmailApp/Logger/Utilities/sendToEdge finti.
// Stesso approccio di tests/walmart-trevipay-parser-parity.test.js, che
// estrae e valuta il codice browser non require()-abile.
//
// La proprieta' centrale e' che il collector orario non cambia: senza il
// flag strict il comportamento deve restare quello legacy, etichetta anche
// sugli errori.
//
// `node tests/apps-script-strict-labeling.test.js`
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'apps-script', 'gmail-vendor-import', 'Utils.gs.js'), 'utf8');

// Estrae il corpo di processLabelPDF dal sorgente .gs reale.
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.notStrictEqual(start, -1, 'funzione non trovata: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('parentesi non bilanciate');
}

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); }
}

// ── Ambiente Apps Script finto ───────────────────────────────────

function makeEnv(threadSpecs, responder) {
  const moves = [];          // registro degli spostamenti di etichetta
  const sent  = [];          // nomi dei PDF inviati
  const importLabel = { name: 'X-import' };
  const processedLabel = { name: 'X-processed' };

  const threads = threadSpecs.map((spec, ti) => {
    const t = {
      id: spec.id || ('t' + ti),
      labels: ['X-import'],
      getLastMessageDate: () => spec.date || new Date(),
      getMessages: () => (spec.messages || []).map((m, mi) => ({
        getSubject: () => m.subject || ('subj-' + ti + '-' + mi),
        getFrom: () => m.from || 'sender@example.com',
        getAttachments: () => (m.attachments || []).map(a => ({
          getName: () => a,
          getBytes: () => [1, 2, 3],
        })),
      })),
      removeLabel(l) { moves.push({ thread: t.id, op: 'remove', label: l.name }); },
      addLabel(l)    { moves.push({ thread: t.id, op: 'add',    label: l.name }); },
    };
    return t;
  });

  importLabel.getThreads = () => threads;

  const env = {
    GmailApp: {
      getUserLabelByName: n => (n === 'X-import' ? importLabel : (n === 'X-processed' ? processedLabel : null)),
      createLabel: n => ({ name: n }),
    },
    Logger: { log: () => {} },
    Utilities: { base64Encode: () => 'BASE64' },
    sendToEdge: (slug, payload) => { sent.push(payload.filename); return responder(payload.filename); },
  };
  return { env, moves, sent,
           processedOf: id => moves.some(m => m.thread === id && m.op === 'add' && m.label === 'X-processed') };
}

function run(threadSpecs, responder, strict) {
  const { env, moves, sent, processedOf } = makeEnv(threadSpecs, responder);
  const fn = new Function('GmailApp', 'Logger', 'Utilities', 'sendToEdge',
    extractFn(SRC, 'processLabelPDF') + '\nreturn processLabelPDF;'
  )(env.GmailApp, env.Logger, env.Utilities, env.sendToEdge);
  const stats = fn('X-import', 'X-processed', 'slug', new Date(2020, 0, 1), strict);
  return { stats, moves, sent, processedOf };
}

const OK        = () => ({ status: 'queued', document_id: 'd1' });
const DUP       = () => ({ status: 'duplicate', document_id: 'd1' });
const ERR       = () => ({ error: 'DB insert error: boom' });
const oneThread = atts => [{ id: 'T1', messages: [{ attachments: atts }] }];

// ── 1. Il legacy non cambia ──────────────────────────────────────

test('1. LEGACY (senza strict): etichetta anche su errore', () => {
  const r = run(oneThread(['a.pdf']), ERR, undefined);
  assert.strictEqual(r.processedOf('T1'), true, 'il legacy DEVE continuare a etichettare');
  assert.strictEqual(r.stats.failed, 1);
  assert.strictEqual(r.stats.processed_label_added, 1);
  assert.strictEqual(r.stats.threads_retained_for_retry, 0);
});

test('2. LEGACY: successo -> etichetta, conteggi corretti', () => {
  const r = run(oneThread(['a.pdf']), OK, undefined);
  assert.strictEqual(r.processedOf('T1'), true);
  assert.strictEqual(r.stats.queued, 1);
  assert.strictEqual(r.stats.failed, 0);
});

// ── 2. Strict mode ───────────────────────────────────────────────

test('3. STRICT: successo -> processed', () => {
  const r = run(oneThread(['a.pdf']), OK, true);
  assert.strictEqual(r.processedOf('T1'), true);
  assert.strictEqual(r.stats.queued, 1);
  assert.strictEqual(r.stats.threads_retained_for_retry, 0);
});

test('4. STRICT: duplicate -> processed (e un esito valido)', () => {
  const r = run(oneThread(['a.pdf']), DUP, true);
  assert.strictEqual(r.processedOf('T1'), true);
  assert.strictEqual(r.stats.duplicate, 1);
  assert.strictEqual(r.stats.failed, 0);
  assert.strictEqual(r.stats.threads_retained_for_retry, 0);
});

test('5. STRICT: errore -> NON processed, trattenuto per il retry', () => {
  const r = run(oneThread(['a.pdf']), ERR, true);
  assert.strictEqual(r.processedOf('T1'), false, 'un documento fallito non va nascosto');
  assert.strictEqual(r.stats.failed, 1);
  assert.strictEqual(r.stats.processed_label_added, 0);
  assert.strictEqual(r.stats.threads_retained_for_retry, 1);
});

test('6. STRICT: thread con 2 PDF, 1 ok + 1 errore -> NON processed', () => {
  const r = run(oneThread(['a.pdf', 'b.pdf']), n => (n === 'a.pdf' ? OK() : ERR()), true);
  assert.strictEqual(r.processedOf('T1'), false, 'basta un fallimento per trattenere il thread');
  assert.strictEqual(r.stats.queued, 1);
  assert.strictEqual(r.stats.failed, 1);
  assert.strictEqual(r.stats.threads_retained_for_retry, 1);
});

test('7. STRICT: rerun — il PDF gia noto torna duplicate, il secondo passa -> processed', () => {
  // Secondo giro dopo il caso 6: a.pdf era gia' entrato, b.pdf ora funziona.
  const r = run(oneThread(['a.pdf', 'b.pdf']), n => (n === 'a.pdf' ? DUP() : OK()), true);
  assert.strictEqual(r.processedOf('T1'), true);
  assert.strictEqual(r.stats.duplicate, 1);
  assert.strictEqual(r.stats.queued, 1);
  assert.strictEqual(r.stats.failed, 0);
  assert.strictEqual(r.stats.threads_retained_for_retry, 0);
  assert.deepStrictEqual(r.sent, ['a.pdf', 'b.pdf'], 'entrambi reinviati: il dedup li rende innocui');
});

test('8. STRICT: due thread indipendenti — uno passa, l altro resta', () => {
  const specs = [
    { id: 'A', messages: [{ attachments: ['ok.pdf'] }] },
    { id: 'B', messages: [{ attachments: ['ko.pdf'] }] },
  ];
  const r = run(specs, n => (n === 'ok.pdf' ? OK() : ERR()), true);
  assert.strictEqual(r.processedOf('A'), true);
  assert.strictEqual(r.processedOf('B'), false);
  assert.strictEqual(r.stats.threads_retained_for_retry, 1);
  assert.strictEqual(r.stats.processed_label_added, 1);
});

test('9. STRICT: fallimento su UN messaggio trattiene l intero thread', () => {
  const specs = [{ id: 'T1', messages: [
    { attachments: ['m1.pdf'] },
    { attachments: ['m2.pdf'] },
  ] }];
  const r = run(specs, n => (n === 'm1.pdf' ? OK() : ERR()), true);
  assert.strictEqual(r.processedOf('T1'), false,
    'la decisione strict e per thread, non per messaggio');
  assert.strictEqual(r.stats.threads_retained_for_retry, 1);
});

test('10. una risposta senza status e trattata come errore', () => {
  for (const bad of [null, undefined, {}, { status: 'boh' }, { error: 'x', status: 'queued' }]) {
    const r = run(oneThread(['a.pdf']), () => bad, true);
    assert.strictEqual(r.processedOf('T1'), false, 'risposta: ' + JSON.stringify(bad));
    assert.strictEqual(r.stats.failed, 1);
  }
});

// ── 3. I chiamanti ───────────────────────────────────────────────

const DIR = path.join(__dirname, '..', 'apps-script', 'gmail-vendor-import');
const backfill = fs.readFileSync(path.join(DIR, 'Backfill.gs.js'), 'utf8');
const bek      = fs.readFileSync(path.join(DIR, 'BEKImport.gs.js'), 'utf8');
const codice   = fs.readFileSync(path.join(DIR, 'Codice.js'), 'utf8');

test('11. i due backfill PDF passano strict = true', () => {
  for (const n of ['backfillTreviPayFromJune2026', 'backfillHardiesFromJune2026']) {
    const f = extractFn(backfill, n);
    assert.ok(/backfillStartJune2026\(\), true\)/.test(f), n + ' non passa strict');
  }
});

test('12. i chiamanti orari NON passano strict (3 argomenti)', () => {
  for (const [file, fname] of [['HardiesImport.gs.js','checkHardiesEmails'],
                               ['TreviPayImport.js','checkTreviPayEmails'],
                               ['FrugeImport.gs.js','checkFrugeEmails']]) {
    const f = extractFn(fs.readFileSync(path.join(DIR, file), 'utf8'), fname);
    const call = f.match(/processLabelPDF\(([^)]*)\)/);
    assert.strictEqual(call[1].split(',').length, 3, fname + ' deve restare a 3 argomenti');
  }
});

test('13. BEK invariato: gia etichettava solo su esito confermato', () => {
  const f = extractFn(bek, 'processBEKQuery');
  assert.ok(/result\.status === 'queued' \|\| result\.status === 'duplicate'/.test(f));
  assert.ok(/stats\.failed\+\+/.test(f));
  assert.ok(!/strictSuccessLabeling/.test(bek), 'BEK non usa processLabelPDF, non serve il flag');
});

test('14. checkAllEmails invariato', () => {
  const f = extractFn(codice, 'checkAllEmails');
  const chiamate = [...f.matchAll(/^\s*([a-zA-Z]+)\(\);/gm)].map(m => m[1]);
  assert.deepStrictEqual(chiamate, [
    'checkHardiesEmails', 'checkFreshpointEmails', 'processTouchBistroEmails',
    'checkBEKEmails', 'checkFrugeEmails', 'checkTreviPayEmails',
  ]);
});

test('15. il log del backfill riporta threads_retained_for_retry', () => {
  const f = extractFn(backfill, 'logBackfill');
  assert.ok(/threads_retained_for_retry/.test(f));
});

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
