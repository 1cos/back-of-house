// ─────────────────────────────────────────────────────────────────────
// INV09B — TreviPay era l'ultimo collector orario fail-open
//
// INV09A l'ha dimostrato leggendo il sorgente: checkTreviPayEmails()
// chiamava processLabelPDF con TRE argomenti, quindi il ramo legacy,
// dove l'etichetta -processed si sposta appena un PDF e' stato INVIATO,
// a prescindere dall'esito. Un 400, un 500, un'eccezione di rete o una
// risposta senza status uscivano da trevipay-import e non ci
// rientravano piu'. E con TreviPay passano TUTTE le fatture Walmart
// Business.
//
// Stessa struttura di tests/hardies-collector-fail-closed.test.js: la
// funzione sotto test e' ESTRATTA DAL SORGENTE Apps Script, GmailApp e
// Utilities sono finti, sendToEdge e' pilotato caso per caso.
// ─────────────────────────────────────────────────────────────────────
'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const ROOT  = path.join(__dirname, '..');
const GAS   = path.join(ROOT, 'apps-script/gmail-vendor-import');
const UTILS = fs.readFileSync(path.join(GAS, 'Utils.gs.js'), 'utf8');
const TREVI = fs.readFileSync(path.join(GAS, 'TreviPayImport.js'), 'utf8');
const FRUGE = fs.readFileSync(path.join(GAS, 'FrugeImport.gs.js'), 'utf8');
const HARD  = fs.readFileSync(path.join(GAS, 'HardiesImport.gs.js'), 'utf8');
const CODE  = fs.readFileSync(path.join(GAS, 'Codice.js'), 'utf8');

let pass = 0, fail = 0;
const queue = [];
function test(n, f) { queue.push([n, f]); }

function grab(src, start, end) {
  const s = src.indexOf(start);
  assert.ok(s >= 0, 'non trovato nel sorgente: ' + start);
  const e = src.indexOf(end, s);
  assert.ok(e > s, 'fine non trovata dopo: ' + start);
  return src.slice(s, e + end.length);
}

const PROCESS_LABEL_PDF = grab(UTILS,
  'function processLabelPDF(labelName, processedName, functionSlug, startDate, strictSuccessLabeling) {',
  '\n  return stats;\n}');

// ── Gmail finto: le etichette sono insiemi di id, cosi' "il thread e'
//    ancora in coda?" e' una domanda a cui si risponde ────────────────
function mondoGmail(threads) {
  const labels = { 'trevipay-import': new Set(threads.map(t => t.id)),
                   'trevipay-processed': new Set() };
  function threadObj(t) {
    return {
      getLastMessageDate: () => t.date || new Date(),
      getMessages: () => (t.messages || []).map(m => ({
        getSubject: () => m.subject || ('New Walmart Business invoice: ' + t.id),
        getFrom:    () => '"Walmart Business: Pay By Invoice Support" <no-reply@trevipay.app>',
        getAttachments: () => (m.pdfs || []).map(nome => ({
          getName: () => nome, getBytes: () => [0x25, 0x50, 0x44, 0x46],
        })),
      })),
      removeLabel: (l) => labels[l.name].delete(t.id),
      addLabel:    (l) => labels[l.name].add(t.id),
    };
  }
  const GmailApp = {
    createLabel: (name) => { labels[name] = labels[name] || new Set(); return { name }; },
    getUserLabelByName: (name) => labels[name]
      ? { name, getThreads: () => threads.filter(t => labels[name].has(t.id)).map(threadObj) }
      : null,
  };
  return { GmailApp, labels, inviati: [] };
}

// La funzione VERA del collector, estratta dal sorgente. E' questa che
// i test dalla 1 alla 11 eseguono: se qualcuno rimette la chiamata
// legacy a tre argomenti, cadono loro per primi, non solo gli
// ancoraggi testuali.
const CHECK_TREVIPAY = grab(TREVI, 'function checkTreviPayEmails()', '\n}');

function ambiente(threads, rispondi) {
  const m = mondoGmail(threads);
  return [m, m.GmailApp, { log: () => {} }, { base64Encode: () => 'JVBERi0=' },
    (slug, payload) => { m.inviati.push(payload.filename); return rispondi(payload.filename); }];
}

// Esegue il CHIAMANTE vero: checkTreviPayEmails() come sta nel file.
function esegui(threads, rispondi) {
  const [m, GmailApp, Logger, Utilities, sendToEdge] = ambiente(threads, rispondi);
  const stats = new Function('GmailApp', 'Logger', 'Utilities', 'sendToEdge',
    PROCESS_LABEL_PDF + '\n' + CHECK_TREVIPAY + '\nreturn checkTreviPayEmails();')(
      GmailApp, Logger, Utilities, sendToEdge);
  return { stats, labels: m.labels, inviati: m.inviati };
}

// Variante che forza il flag: serve SOLO ai due test di mutazione, per
// eseguire deliberatamente il ramo legacy e mostrare che difetto era.
function eseguiConFlag(threads, rispondi, strict) {
  const [m, GmailApp, Logger, Utilities, sendToEdge] = ambiente(threads, rispondi);
  const fn = new Function('GmailApp', 'Logger', 'Utilities', 'sendToEdge',
    PROCESS_LABEL_PDF + '\nreturn processLabelPDF;')(GmailApp, Logger, Utilities, sendToEdge);
  const stats = fn('trevipay-import', 'trevipay-processed', 'gmail-vendor-import', null, strict);
  return { stats, labels: m.labels, inviati: m.inviati };
}

const inCoda     = (r, id) => r.labels['trevipay-import'].has(id);
const archiviato = (r, id) => r.labels['trevipay-processed'].has(id);

const OK_QUEUED    = () => ({ status: 'queued', document_id: 'x' });
const OK_DUPLICATE = () => ({ status: 'duplicate', document_id: 'x' });
const ERR_400      = () => ({ error: 'Missing pdf_base64' });
const ERR_500      = () => ({ error: 'Storage upload error: boom' });
const ERR_RETE     = () => ({ error: 'Exception: DNS' });
const MALFORMATA   = () => ({ message: 'ok' });          // nessun campo status

const unThread = (pdfs) => [{ id: 'T1', messages: [{ pdfs }] }];

// ═════════════════════════════════════════════════════════════════════
// A. LA MATRICE RICHIESTA
// ═════════════════════════════════════════════════════════════════════

test('1. success/queued -> processed', () => {
  const r = esegui(unThread(['737a4124.pdf']), OK_QUEUED);
  assert.strictEqual(archiviato(r, 'T1'), true);
  assert.strictEqual(inCoda(r, 'T1'), false);
  assert.strictEqual(r.stats.queued, 1);
});

test('2. duplicate -> processed', () => {
  const r = esegui(unThread(['737a4124.pdf']), OK_DUPLICATE);
  assert.strictEqual(archiviato(r, 'T1'), true);
  assert.strictEqual(r.stats.duplicate, 1);
});

test('3. HTTP 400 -> trattenuto in trevipay-import', () => {
  const r = esegui(unThread(['x.pdf']), ERR_400);
  assert.strictEqual(archiviato(r, 'T1'), false);
  assert.strictEqual(inCoda(r, 'T1'), true);
  assert.strictEqual(r.stats.failed, 1);
  assert.strictEqual(r.stats.threads_retained_for_retry, 1);
});

test('4. HTTP 500 -> trattenuto', () => {
  const r = esegui(unThread(['x.pdf']), ERR_500);
  assert.strictEqual(archiviato(r, 'T1'), false);
  assert.strictEqual(inCoda(r, 'T1'), true);
});

test('5. eccezione di rete -> trattenuto', () => {
  const r = esegui(unThread(['x.pdf']), ERR_RETE);
  assert.strictEqual(archiviato(r, 'T1'), false);
  assert.strictEqual(inCoda(r, 'T1'), true);
});

test('6. risposta malformata (senza status) -> trattenuto', () => {
  const r = esegui(unThread(['x.pdf']), MALFORMATA);
  assert.strictEqual(archiviato(r, 'T1'), false);
  assert.strictEqual(inCoda(r, 'T1'), true);
});

test('7. risposta null / undefined / {} -> trattenuto', () => {
  for (const risposta of [() => null, () => undefined, () => ({})]) {
    const r = esegui(unThread(['x.pdf']), risposta);
    assert.strictEqual(archiviato(r, 'T1'), false);
    assert.strictEqual(inCoda(r, 'T1'), true);
  }
});

// ═════════════════════════════════════════════════════════════════════
// B. MULTI-ALLEGATO E RETRY
// ═════════════════════════════════════════════════════════════════════

test('8. due PDF nella stessa email, il secondo fallisce: thread trattenuto', () => {
  const r = esegui([{ id: 'T1', messages: [{ pdfs: ['A.pdf', 'B.pdf'] }] }],
    (f) => (f === 'A.pdf' ? OK_QUEUED() : ERR_500()));
  assert.deepStrictEqual(r.inviati, ['A.pdf', 'B.pdf'], 'entrambi devono essere tentati');
  assert.strictEqual(inCoda(r, 'T1'), true, 'B non deve sparire perche A e riuscito');
  assert.strictEqual(archiviato(r, 'T1'), false);
});

test('9. retry: primo PDF duplicate + secondo success -> processed', () => {
  const r = esegui([{ id: 'T1', messages: [{ pdfs: ['A.pdf', 'B.pdf'] }] }],
    (f) => (f === 'A.pdf' ? OK_DUPLICATE() : OK_QUEUED()));
  assert.strictEqual(archiviato(r, 'T1'), true);
  assert.strictEqual(r.stats.duplicate, 1);
  assert.strictEqual(r.stats.queued, 1);
  assert.strictEqual(r.stats.failed, 0);
});

test('10. due messaggi nello stesso thread, il secondo fallisce: trattenuto', () => {
  const r = esegui([{ id: 'T1', messages: [{ pdfs: ['A.pdf'] }, { pdfs: ['B.pdf'] }] }],
    (f) => (f === 'A.pdf' ? OK_QUEUED() : ERR_400()));
  assert.strictEqual(inCoda(r, 'T1'), true);
});

test('11. thread indipendenti: uno fallisce, l altro esce lo stesso', () => {
  const r = esegui([{ id: 'T1', messages: [{ pdfs: ['A.pdf'] }] },
                    { id: 'T2', messages: [{ pdfs: ['B.pdf'] }] }],
    (f) => (f === 'A.pdf' ? ERR_500() : OK_QUEUED()));
  assert.strictEqual(inCoda(r, 'T1'), true);
  assert.strictEqual(archiviato(r, 'T2'), true);
});

// ═════════════════════════════════════════════════════════════════════
// C. MUTAZIONE — il ramo legacy era davvero il difetto
// ═════════════════════════════════════════════════════════════════════

test('12. MUTAZIONE: con tre argomenti un 500 viene archiviato come successo', () => {
  const r = eseguiConFlag(unThread(['x.pdf']), ERR_500, false);
  assert.strictEqual(archiviato(r, 'T1'), true, 'e proprio questo il difetto che il fix toglie');
  assert.strictEqual(inCoda(r, 'T1'), false);
  assert.strictEqual(r.stats.failed, 1, 'lo stat lo sapeva: era la decisione a ignorarlo');
});

test('13. MUTAZIONE: con tre argomenti il secondo PDF di un email sparisce', () => {
  const r = eseguiConFlag([{ id: 'T1', messages: [{ pdfs: ['A.pdf', 'B.pdf'] }] }],
    (f) => (f === 'A.pdf' ? OK_QUEUED() : ERR_500()), false);
  assert.strictEqual(archiviato(r, 'T1'), true);
  assert.strictEqual(inCoda(r, 'T1'), false, 'B irrecuperabile');
});

// ═════════════════════════════════════════════════════════════════════
// D. IL CHIAMANTE
// ═════════════════════════════════════════════════════════════════════

test('14. checkTreviPayEmails chiede esplicitamente lo strict labeling', () => {
  const f = grab(TREVI, 'function checkTreviPayEmails()', '\n}');
  const args = f.match(/processLabelPDF\(([\s\S]*?)\)/)[1].split(',').map(a => a.trim());
  assert.strictEqual(args.length, 5, 'devono essere 5 argomenti');
  assert.strictEqual(args[3], 'null', 'startDate null: il collector orario non fa backfill');
  assert.strictEqual(args[4], 'true', 'strictSuccessLabeling deve essere true');
});

test('15. TreviPay ha ora la stessa forma di Fruge e Hardie s', () => {
  const ultimi = (src, nome) => grab(src, 'function ' + nome + '()', '\n}')
    .match(/processLabelPDF\(([\s\S]*?)\)/)[1].split(',').map(a => a.trim()).slice(3);
  const t = ultimi(TREVI, 'checkTreviPayEmails');
  assert.deepStrictEqual(t, ultimi(FRUGE, 'checkFrugeEmails'),  'diverso da Fruge');
  assert.deepStrictEqual(t, ultimi(HARD,  'checkHardiesEmails'), 'diverso da Hardie s');
});

test('16. checkAllEmails chiama ancora TreviPay', () => {
  assert.ok(/checkTreviPayEmails\(\);/.test(CODE));
});

test('17. il backfill storico resta separato dal giro orario', () => {
  const back = fs.readFileSync(path.join(GAS, 'Backfill.gs.js'), 'utf8');
  assert.ok(/function backfillTreviPayFromJune2026\(\)/.test(back));
  assert.ok(!/backfillTreviPayFromJune2026\(\)/.test(CODE),
    'il backfill non deve essere agganciato a checkAllEmails');
});

test('18. NESSUN collector orario e rimasto fail-open', () => {
  // La ragione di questo test: e' l'ultimo del giro. Se domani qualcuno
  // aggiunge un vendor e dimentica lo strict, deve cadere qui.
  for (const [file, fname] of [['TreviPayImport.js',        'checkTreviPayEmails'],
                               ['FrugeImport.gs.js',        'checkFrugeEmails'],
                               ['HardiesImport.gs.js',      'checkHardiesEmails']]) {
    const f = grab(fs.readFileSync(path.join(GAS, file), 'utf8'), 'function ' + fname + '()', '\n}');
    const args = f.match(/processLabelPDF\(([\s\S]*?)\)/)[1].split(',').map(a => a.trim());
    assert.strictEqual(args[4], 'true', fname + ' non passa strictSuccessLabeling');
  }
  // FreshPoint usa processLabelBody, stesso flag
  const fp = grab(fs.readFileSync(path.join(GAS, 'FreshpointImport.gs:.js'), 'utf8'),
                  'function checkFreshpointEmails()', '\n}');
  assert.ok(/,\s*null,\s*true\)/.test(fp), 'FreshPoint deve restare strict');
  // Ben E. Keith non usa processLabelPDF: etichetta solo su esito confermato
  const bek = fs.readFileSync(path.join(GAS, 'BEKImport.gs.js'), 'utf8');
  assert.ok(/result\.status === 'queued' \|\| result\.status === 'duplicate'/.test(bek));
});

// ── run ──────────────────────────────────────────────────────────────
(async () => {
  for (const [n, f] of queue) {
    try { await f(); console.log('  ✓ ' + n); pass++; }
    catch (e) { console.log('  ✗ ' + n + '\n      ' + e.message); fail++; }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
