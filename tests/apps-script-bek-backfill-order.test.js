// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 61 — il backfill BEK deve ingerire in ordine cronologico.
//
// Il backend sceglie la revisione operativa di un Sales Order confrontando
// created_at, cioe' l'ordine di ingestione (index.ts, MT42 sezione F).
// GmailApp.search restituisce dal piu' nuovo al piu' vecchio: nel backfill
// i due ordini sono invertiti e vincerebbe l'acknowledgement invece della
// conferma. Caso reale MT60: Sales Order 0003015274, cucina.
//
// Questi test ESEGUONO il codice vero estratto da Backfill.gs.js, con
// GmailApp/Logger/PropertiesService/sendToEdge finti. Stesso approccio di
// tests/apps-script-strict-labeling.test.js.
//
// `node tests/apps-script-bek-backfill-order.test.js`
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'apps-script', 'gmail-vendor-import');
const BACKFILL = fs.readFileSync(path.join(DIR, 'Backfill.gs.js'), 'utf8');
const BEKIMPORT = fs.readFileSync(path.join(DIR, 'BEKImport.gs.js'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.notStrictEqual(start, -1, 'funzione non trovata: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('parentesi non bilanciate in ' + name);
}
const codeOnly = s => s.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); }
}

// ── Ambiente Apps Script finto ───────────────────────────────────
// threadSpecs: { id, date, so, messages:[{subject, body, plain}] }
function makeEnv(threadSpecs, responder, props) {
  const labelled = [];
  const sent = [];
  const logs = [];
  const processedLabel = { name: 'bek-processed' };

  const threads = threadSpecs.map((spec, ti) => ({
    id: spec.id || ('t' + ti),
    getLastMessageDate: () => spec.date,
    getMessages: () => (spec.messages || []).map((m, mi) => ({
      getSubject: () => m.subject,
      getFrom: () => m.from || 'CRP-SVCMBX-entree@benekeith.com',
      getBody: () => m.body || ('<html>' + m.subject + '</html>'),
      getPlainBody: () => (m.plain !== undefined ? m.plain : ''),
      _tag: spec.id + '#' + mi,
    })),
    addLabel(l) { labelled.push({ thread: spec.id, label: l.name }); },
  }));

  const env = {
    GmailApp: {
      // search(query, start, max) — la sorgente e' newest-first, come Gmail.
      search: (q, start, max) => threads.slice(start, start + max),
      getUserLabelByName: n => (n === 'bek-processed' ? processedLabel : null),
      createLabel: n => ({ name: n }),
    },
    Logger: { log: m => logs.push(String(m)) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (props || {})[k] }) },
    sendToEdge: (fn, payload) => { sent.push(payload); return responder(payload); },
    logBackfill: (vendor, stats) => stats,
    JSON, Math, String, Number, Date, RegExp, Object, Array,
  };

  const src = [
    BACKFILL.slice(BACKFILL.indexOf('var BEK_BACKFILL_BATCH_SIZE')),   // costanti + funzioni nuove
    extractFn(BACKFILL, 'backfillBEKFromJune2026'),
  ].join('\n');

  const names = Object.keys(env);
  const run = new Function(...names,
    src + '\n;return {backfillBEKFromJune2026:backfillBEKFromJune2026,' +
    'processBEKBacklogChronological:processBEKBacklogChronological,' +
    'collectAllThreadsPaged:collectAllThreadsPaged,' +
    'bekSalesOrderKey:bekSalesOrderKey,' +
    'BEK_BACKFILL_BATCH_SIZE:BEK_BACKFILL_BATCH_SIZE};');
  return { api: run(...names.map(n => env[n])), labelled, sent, logs };
}

const d = s => new Date(s);
const ok = () => ({ status: 'queued' });
const subj = so => "Ben E. Keith : Order Confirmation for FDF770366-ZENO'S ON THE SQUARE;" + so;
function thread(id, date, so, opts) {
  opts = opts || {};
  return { id, date: d(date), messages: opts.messages || [{ subject: subj(so) }] };
}
const PROPS_ON = { BEK_ENABLED: 'true' };

// ── 1. newest-first in ingresso, oldest-first in uscita ──────────

test('1. il backlog arriva newest-first e viene processato oldest-first', () => {
  const specs = [                             // come li restituisce Gmail
    thread('T3', '2026-09-16T10:00:00Z', '0003243454'),
    thread('T2', '2026-08-26T10:00:00Z', '0003015274'),
    thread('T1', '2026-06-27T10:00:00Z', '0002427678'),
  ];
  const env = makeEnv(specs, ok, PROPS_ON);
  const stats = env.api.backfillBEKFromJune2026();
  const ordine = env.sent.map(p => p.subject.split(';')[1]);
  assert.deepStrictEqual(ordine, ['0002427678', '0003015274', '0003243454'],
    'ordine di invio non cronologico: ' + ordine.join(','));
  assert.strictEqual(stats.eligible_total, 3);
  assert.strictEqual(stats.queued, 3);
});

// ── 2. coppia nello stesso batch ─────────────────────────────────

test('2. due revisioni dello stesso Sales Order nello stesso batch: prima la vecchia', () => {
  const specs = [
    thread('NEW', '2026-08-26T13:56:00Z', '0003015274'),   // conferma
    thread('OLD', '2026-08-25T18:29:00Z', '0003015274'),   // acknowledgement
  ];
  const env = makeEnv(specs, ok, PROPS_ON);
  env.api.backfillBEKFromJune2026();
  assert.strictEqual(env.sent.length, 2);
  // L'ordine di INVIO e' cio' che determina created_at lato backend.
  assert.deepStrictEqual(env.labelled.map(l => l.thread), ['OLD', 'NEW'],
    'la vecchia deve essere inviata ed etichettata per prima');
});

// ── 3. coppia a cavallo fra batch 1 e batch 2 ────────────────────

test('3. coppia a cavallo del taglio: la vecchia finisce nel batch 1, mai dopo', () => {
  // 21 thread: la coppia 0003015274 e' la piu' VECCHIA di tutte, quindi
  // dopo l'ordinamento globale entrambe stanno all'inizio.
  const specs = [];
  for (let i = 0; i < 19; i++) {
    specs.push(thread('F' + i, '2026-09-' + String(10 + (i % 15)).padStart(2, '0') + 'T10:00:00Z', '90000' + i));
  }
  specs.push(thread('NEW', '2026-06-02T10:00:00Z', '0003015274'));
  specs.push(thread('OLD', '2026-06-01T10:00:00Z', '0003015274'));
  const env = makeEnv(specs, ok, PROPS_ON);
  const stats = env.api.backfillBEKFromJune2026();
  assert.strictEqual(stats.eligible_total, 21);
  assert.strictEqual(stats.threads_found, 20, 'batch limitato a 20');
  const inviati = env.sent.map(p => p.subject);
  const iOld = inviati.findIndex(s => /;0003015274/.test(s));
  assert.notStrictEqual(iOld, -1, 'la revisione vecchia deve essere nel batch 1');
  assert.strictEqual(iOld, 0, 'la piu vecchia deve essere la prima inviata');
});

test('3b. senza ordinamento globale il taglio invertirebbe: verifica della regressione', () => {
  // Stesso set, ma con il vecchio comportamento (slice PRIMA del sort) la
  // vecchia cadrebbe fuori dal batch. Qui si verifica che NON succede.
  const specs = [];
  specs.push(thread('NEWEST', '2026-09-30T10:00:00Z', '0009999999'));
  for (let i = 0; i < 19; i++) {
    specs.push(thread('M' + i, '2026-09-' + String(10 + i).padStart(2, '0') + 'T10:00:00Z', '80000' + i));
  }
  specs.push(thread('NEW', '2026-07-02T10:00:00Z', '0003015274'));
  specs.push(thread('OLD', '2026-07-01T10:00:00Z', '0003015274'));
  const env = makeEnv(specs, ok, PROPS_ON);
  env.api.backfillBEKFromJune2026();
  const ordine = env.sent.map(p => p.subject.split(';')[1]);
  assert.strictEqual(ordine[0], '0003015274');
  assert.strictEqual(ordine[1], '0003015274');
  assert.ok(!ordine.includes('0009999999'), 'il piu nuovo non deve entrare nel primo batch');
});

// ── 4/5. fallimento e leapfrog ───────────────────────────────────

test('4. se la revisione vecchia fallisce, la nuova dello stesso ordine NON parte', () => {
  const specs = [
    thread('NEW', '2026-08-26T13:56:00Z', '0003015274'),
    thread('OLD', '2026-08-25T18:29:00Z', '0003015274'),
  ];
  // Il PRIMO invio, cioe' la revisione piu' vecchia, fallisce.
  let n = 0;
  const env = makeEnv(specs, () => { n++; return n === 1 ? { error: 'boom' } : ok(); }, PROPS_ON);
  const stats = env.api.backfillBEKFromJune2026();
  assert.strictEqual(env.sent.length, 1, 'la seconda revisione non deve essere inviata');
  assert.strictEqual(stats.failed, 1);
  assert.strictEqual(stats.skipped_after_failure, 1);
  assert.strictEqual(stats.threads_retained_for_retry, 2, 'entrambe restano da ritentare');
  assert.strictEqual(env.labelled.length, 0, 'nessuna delle due va etichettata');
});

test('5. un fallimento su un Sales Order non blocca gli altri', () => {
  const specs = [
    thread('B2', '2026-08-27T10:00:00Z', '0002222222'),
    thread('A2', '2026-08-26T10:00:00Z', '0001111111'),
    thread('A1', '2026-08-25T10:00:00Z', '0001111111'),
  ];
  const env = makeEnv(specs, p => (/;0001111111/.test(p.subject) ? { error: 'boom' } : ok()), PROPS_ON);
  const stats = env.api.backfillBEKFromJune2026();
  const inviati = env.sent.map(p => p.subject.split(';')[1]);
  assert.deepStrictEqual(inviati, ['0001111111', '0002222222'],
    'A1 fallisce, A2 salta, B2 prosegue');
  assert.strictEqual(stats.failed, 1);
  assert.strictEqual(stats.skipped_after_failure, 1);
  assert.strictEqual(stats.queued, 1);
  assert.deepStrictEqual(env.labelled.map(l => l.thread), ['B2']);
});

// ── 6. un thread, piu' messaggi ──────────────────────────────────

test('6. thread con piu messaggi: parte SOLO l ultimo', () => {
  const specs = [{
    id: 'MULTI', date: d('2026-08-17T16:43:00Z'),
    messages: [
      { subject: subj('0002927278'), body: '<html>acknowledgement</html>' },
      { subject: subj('0002927278'), body: '<html>confermato</html>' },
    ],
  }];
  const env = makeEnv(specs, ok, PROPS_ON);
  env.api.backfillBEKFromJune2026();
  assert.strictEqual(env.sent.length, 1);
  assert.strictEqual(env.sent[0].html_body, '<html>confermato</html>');
});

// ── 7. tetto del batch ───────────────────────────────────────────

test('7. massimo 20 thread per esecuzione', () => {
  const specs = [];
  for (let i = 0; i < 54; i++) {
    specs.push(thread('T' + i, new Date(Date.UTC(2026, 5, 1 + i)).toISOString(), '000' + (1000000 + i)));
  }
  const env = makeEnv(specs, ok, PROPS_ON);
  const stats = env.api.backfillBEKFromJune2026();
  assert.strictEqual(stats.eligible_total, 54, 'deve RACCOGLIERE tutto il backlog');
  assert.strictEqual(stats.threads_found, 20, 'ma processarne 20');
  assert.strictEqual(env.sent.length, 20);
});

test('7b. la paginazione raccoglie oltre i 100 di una singola search', () => {
  const specs = [];
  for (let i = 0; i < 230; i++) {
    specs.push(thread('T' + i, new Date(Date.UTC(2026, 5, 1, 0, i)).toISOString(), '000' + (2000000 + i)));
  }
  const env = makeEnv(specs, ok, PROPS_ON);
  const stats = env.api.backfillBEKFromJune2026();
  assert.strictEqual(stats.eligible_total, 230, 'paginazione incompleta: ' + stats.eligible_total);
  assert.strictEqual(stats.threads_found, 20);
});

// ── 8/9. i due gate ──────────────────────────────────────────────

test('8. BEK_TEST_MODE non influenza il backfill', () => {
  const specs = [thread('T1', '2026-08-01T10:00:00Z', '0001234567')];
  const env = makeEnv(specs, ok, { BEK_ENABLED: 'true', BEK_TEST_MODE: 'true', BEK_TEST_SALES_ORDER: '9999999' });
  const stats = env.api.backfillBEKFromJune2026();
  assert.strictEqual(stats.queued, 1, 'il backfill deve ignorare BEK_TEST_MODE');
  const f = codeOnly(extractFn(BACKFILL, 'backfillBEKFromJune2026') + extractFn(BACKFILL, 'processBEKBacklogChronological'));
  assert.ok(!/BEK_TEST_MODE/.test(f), 'il backfill non deve nemmeno nominare BEK_TEST_MODE');
});

test('9. BEK_ENABLED continua a essere rispettato', () => {
  const specs = [thread('T1', '2026-08-01T10:00:00Z', '0001234567')];
  const env = makeEnv(specs, ok, { BEK_ENABLED: 'false' });
  const stats = env.api.backfillBEKFromJune2026();
  assert.strictEqual(env.sent.length, 0, 'nessun invio con il gate chiuso');
  assert.strictEqual(stats.threads_found, 0);
  assert.strictEqual(stats.queued, 0);
});

// ── 10. etichettatura ────────────────────────────────────────────

test('10. etichetta solo su queued o duplicate confermati', () => {
  const esiti = [{ status: 'queued' }, { status: 'duplicate' }, { error: 'boom' }, { status: 'weird' }, null];
  const specs = esiti.map((_, i) =>
    thread('T' + i, new Date(Date.UTC(2026, 5, 1 + i)).toISOString(), '000' + (3000000 + i)));
  let k = 0;
  const env = makeEnv(specs, () => esiti[k++], PROPS_ON);
  const stats = env.api.backfillBEKFromJune2026();
  assert.strictEqual(stats.queued, 1);
  assert.strictEqual(stats.duplicate, 1);
  assert.strictEqual(stats.failed, 3);
  assert.deepStrictEqual(env.labelled.map(l => l.thread), ['T0', 'T1']);
  assert.strictEqual(stats.processed_label_added, 2);
});

// ── 11. il collector orario non cambia ───────────────────────────

test('11. checkBEKEmails e processBEKQuery restano invariati', () => {
  const live = codeOnly(extractFn(BEKIMPORT, 'checkBEKEmails'));
  assert.ok(/BEK_TEST_MODE/.test(live), 'il test mode live e sparito');
  assert.ok(/processBEKQuery\(query, '\[BEK\]'\)/.test(live), 'il collector orario non chiama piu processBEKQuery');
  const q = codeOnly(extractFn(BEKIMPORT, 'processBEKQuery'));
  assert.ok(/GmailApp\.search\(query, 0, 20\)/.test(q), 'processBEKQuery e stata modificata');
  assert.ok(!/sort\(/.test(q), 'processBEKQuery non deve ordinare: e il percorso live');
  assert.ok(!/BEK_BACKFILL/.test(BEKIMPORT), 'la logica di backfill non deve entrare in BEKImport');
});

// ── 12. il caso reale del subject ";null" ────────────────────────

test('12. subject ";null": il Sales Order si recupera dal corpo', () => {
  const env = makeEnv([], ok, PROPS_ON);
  const msgNull = {
    getSubject: () => "Ben E. Keith : Order Confirmation for FDF770366-ZENO'S ON THE SQUARE;null",
    getPlainBody: () => 'Sales Order # *0003055973*\nCustomer# *FDF770366*',
  };
  assert.strictEqual(env.api.bekSalesOrderKey(msgNull, msgNull.getSubject()), '0003055973');
  const msgOk = { getSubject: () => subj('0003015274'), getPlainBody: () => 'niente' };
  assert.strictEqual(env.api.bekSalesOrderKey(msgOk, msgOk.getSubject()), '0003015274');
});

console.log('\n  ' + pass + ' passati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
