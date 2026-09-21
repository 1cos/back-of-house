// ─────────────────────────────────────────────────────────────────────
// INV08FINAL — il collector Hardie's non puo' piu' archiviare un
// fallimento come se fosse un successo
//
// Hardie's era l'ultimo collector orario ancora fail-open: chiamava
// processLabelPDF senza strictSuccessLabeling, quindi entrava nel ramo
// legacy dove l'etichetta -processed si sposta appena un PDF e' stato
// INVIATO, a prescindere dall'esito. Un 400, un 500, un'eccezione di
// rete o una risposta senza status uscivano da hardies-import e non ci
// rientravano piu'.
//
// Lo stesso ramo era anche il buco multi-allegato: l'etichetta si muove
// dentro il ciclo sui messaggi, quindi un'email con due PDF di cui il
// secondo fallisce usciva comunque dalla coda.
//
// Le funzioni sotto test sono ESTRATTE DAL SORGENTE Apps Script, non
// ricopiate: GmailApp, Logger e Utilities sono finti, sendToEdge e'
// pilotato caso per caso.
// ─────────────────────────────────────────────────────────────────────
'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const ROOT  = path.join(__dirname, '..');
const GAS   = path.join(ROOT, 'apps-script/gmail-vendor-import');
const UTILS = fs.readFileSync(path.join(GAS, 'Utils.gs.js'), 'utf8');
const HARD  = fs.readFileSync(path.join(GAS, 'HardiesImport.gs.js'), 'utf8');
const FRUGE = fs.readFileSync(path.join(GAS, 'FrugeImport.gs.js'), 'utf8');
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

// ── Gmail finto ──────────────────────────────────────────────────────
// Un thread e' { id, date, messages: [ { pdfs: ['nome.pdf', ...] } ] }.
// Le etichette sono insiemi di id: cosi' "il thread e' ancora in coda?"
// e' una domanda a cui si risponde, non da interpretare.
function mondoGmail(threads) {
  const labels = { 'hardies-import': new Set(threads.map(t => t.id)),
                   'hardies-processed': new Set() };
  const inviati = [];
  function threadObj(t) {
    return {
      getLastMessageDate: () => t.date || new Date(),
      getMessages: () => (t.messages || []).map(m => ({
        getSubject: () => m.subject || ('SOGG ' + t.id),
        getFrom:    () => 'JMIDDLEBROOKS <jmiddlebrooks@hardies.com>',
        getAttachments: () => (m.pdfs || []).map(nome => ({
          getName:  () => nome,
          getBytes: () => [0x25, 0x50, 0x44, 0x46],
        })),
      })),
      removeLabel: (l) => labels[l.name].delete(t.id),
      addLabel:    (l) => labels[l.name].add(t.id),
    };
  }
  const GmailApp = {
    getUserLabelByName: (name) => (labels[name] ? { name } : null),
    createLabel: (name) => { labels[name] = labels[name] || new Set(); return { name }; },
  };
  // getThreads legge la label VIVA a ogni chiamata, come Gmail.
  GmailApp.getUserLabelByName = (name) => labels[name]
    ? { name, getThreads: (_a, _b) => threads.filter(t => labels[name].has(t.id)).map(threadObj) }
    : null;
  return { GmailApp, labels, inviati };
}

// Esegue il processLabelPDF VERO nel mondo finto.
function esegui(threads, rispondi, strict) {
  const m = mondoGmail(threads);
  const sandbox = {
    GmailApp: m.GmailApp,
    Logger: { log: () => {} },
    Utilities: { base64Encode: () => 'JVBERi0=' },
    sendToEdge: (slug, payload) => {
      m.inviati.push(payload.filename);
      return rispondi(payload.filename);
    },
  };
  const fn = new Function('GmailApp', 'Logger', 'Utilities', 'sendToEdge',
    PROCESS_LABEL_PDF + '\nreturn processLabelPDF;')(
      sandbox.GmailApp, sandbox.Logger, sandbox.Utilities, sandbox.sendToEdge);
  const stats = fn('hardies-import', 'hardies-processed', 'gmail-hardies-import', null, strict);
  return { stats, labels: m.labels, inviati: m.inviati };
}

const inCoda    = (r, id) => r.labels['hardies-import'].has(id);
const archiviato = (r, id) => r.labels['hardies-processed'].has(id);

const OK_QUEUED    = () => ({ status: 'queued', document_id: 'x' });
const OK_DUPLICATE = () => ({ status: 'duplicate', document_id: 'x' });
const ERR_400      = () => ({ error: 'Missing pdf_base64' });
const ERR_500      = () => ({ error: 'Storage upload error: boom' });
const ERR_RETE     = () => ({ error: 'Exception: DNS' });          // sendToEdge sul catch
const MALFORMATA   = () => ({ message: 'ok', alerts: 0 });          // nessun campo status

const unThread = (pdfs) => [{ id: 'T1', messages: [{ pdfs }] }];

// ═════════════════════════════════════════════════════════════════════
// A. LA MATRICE RICHIESTA — un allegato, un esito
// ═════════════════════════════════════════════════════════════════════

test('1. success/queued -> processed', () => {
  const r = esegui(unThread(['a.pdf']), OK_QUEUED, true);
  assert.strictEqual(archiviato(r, 'T1'), true);
  assert.strictEqual(inCoda(r, 'T1'), false);
  assert.strictEqual(r.stats.queued, 1);
});

test('2. duplicate -> processed', () => {
  const r = esegui(unThread(['a.pdf']), OK_DUPLICATE, true);
  assert.strictEqual(archiviato(r, 'T1'), true);
  assert.strictEqual(r.stats.duplicate, 1);
});

test('3. HTTP 400 -> NON processed, resta in coda', () => {
  const r = esegui(unThread(['a.pdf']), ERR_400, true);
  assert.strictEqual(archiviato(r, 'T1'), false);
  assert.strictEqual(inCoda(r, 'T1'), true);
  assert.strictEqual(r.stats.failed, 1);
  assert.strictEqual(r.stats.threads_retained_for_retry, 1);
});

test('4. HTTP 500 -> NON processed, resta in coda', () => {
  const r = esegui(unThread(['a.pdf']), ERR_500, true);
  assert.strictEqual(archiviato(r, 'T1'), false);
  assert.strictEqual(inCoda(r, 'T1'), true);
});

test('5. eccezione di rete -> NON processed, resta in coda', () => {
  const r = esegui(unThread(['a.pdf']), ERR_RETE, true);
  assert.strictEqual(archiviato(r, 'T1'), false);
  assert.strictEqual(inCoda(r, 'T1'), true);
});

test('6. risposta malformata (nessuno status) -> NON processed', () => {
  const r = esegui(unThread(['a.pdf']), MALFORMATA, true);
  assert.strictEqual(archiviato(r, 'T1'), false);
  assert.strictEqual(inCoda(r, 'T1'), true);
});

test('7. risposta nulla o undefined -> NON processed', () => {
  for (const risposta of [() => null, () => undefined, () => ({})]) {
    const r = esegui(unThread(['a.pdf']), risposta, true);
    assert.strictEqual(archiviato(r, 'T1'), false);
    assert.strictEqual(inCoda(r, 'T1'), true);
  }
});

// ═════════════════════════════════════════════════════════════════════
// B. MULTI-ALLEGATO — il caso specifico di Hardie's
// ═════════════════════════════════════════════════════════════════════

test('8. due PDF nella STESSA email, il secondo fallisce: il thread resta', () => {
  const r = esegui([{ id: 'T1', messages: [{ pdfs: ['A.pdf', 'B.pdf'] }] }],
    (f) => (f === 'A.pdf' ? OK_QUEUED() : ERR_500()), true);
  assert.deepStrictEqual(r.inviati, ['A.pdf', 'B.pdf'], 'entrambi devono essere tentati');
  assert.strictEqual(inCoda(r, 'T1'), true, 'B non deve diventare irrecuperabile perche A e riuscito');
  assert.strictEqual(archiviato(r, 'T1'), false);
});

test('9. due MESSAGGI nello stesso thread, il secondo fallisce: il thread resta', () => {
  const r = esegui([{ id: 'T1', messages: [{ pdfs: ['A.pdf'] }, { pdfs: ['B.pdf'] }] }],
    (f) => (f === 'A.pdf' ? OK_QUEUED() : ERR_400()), true);
  assert.strictEqual(inCoda(r, 'T1'), true);
  assert.strictEqual(archiviato(r, 'T1'), false);
});

test('10. al giro dopo il PDF gia entrato torna duplicate e il thread esce', () => {
  // primo giro: B fallisce
  const primo = esegui([{ id: 'T1', messages: [{ pdfs: ['A.pdf', 'B.pdf'] }] }],
    (f) => (f === 'A.pdf' ? OK_QUEUED() : ERR_500()), true);
  assert.strictEqual(inCoda(primo, 'T1'), true);
  // secondo giro: A e gia' dentro (duplicate), B riesce
  const secondo = esegui([{ id: 'T1', messages: [{ pdfs: ['A.pdf', 'B.pdf'] }] }],
    (f) => (f === 'A.pdf' ? OK_DUPLICATE() : OK_QUEUED()), true);
  assert.strictEqual(archiviato(secondo, 'T1'), true, 'il retry deve chiudere il thread');
  assert.strictEqual(secondo.stats.duplicate, 1);
  assert.strictEqual(secondo.stats.queued, 1);
});

test('11. tutti e due i PDF riescono: il thread esce subito', () => {
  const r = esegui([{ id: 'T1', messages: [{ pdfs: ['A.pdf', 'B.pdf'] }] }], OK_QUEUED, true);
  assert.strictEqual(archiviato(r, 'T1'), true);
  assert.strictEqual(r.stats.queued, 2);
});

test('12. un thread SENZA PDF non viene mai etichettato (e non manda niente)', () => {
  const r = esegui([{ id: 'T1', messages: [{ pdfs: [] }] }], OK_QUEUED, true);
  assert.deepStrictEqual(r.inviati, []);
  assert.strictEqual(archiviato(r, 'T1'), false);
  assert.strictEqual(inCoda(r, 'T1'), true, 'resta in coda: non e un documento, ma non viene nascosto');
});

test('13. gli allegati non-PDF vengono ignorati, non inviati', () => {
  const r = esegui([{ id: 'T1', messages: [{ pdfs: ['foto.jpg', 'vero.pdf'] }] }], OK_QUEUED, true);
  assert.deepStrictEqual(r.inviati, ['vero.pdf']);
  assert.strictEqual(archiviato(r, 'T1'), true);
});

test('14. thread indipendenti: uno fallisce, l altro esce lo stesso', () => {
  const r = esegui([{ id: 'T1', messages: [{ pdfs: ['A.pdf'] }] },
                    { id: 'T2', messages: [{ pdfs: ['B.pdf'] }] }],
    (f) => (f === 'A.pdf' ? ERR_500() : OK_QUEUED()), true);
  assert.strictEqual(inCoda(r, 'T1'), true);
  assert.strictEqual(archiviato(r, 'T2'), true);
});

// ═════════════════════════════════════════════════════════════════════
// C. LA MUTAZIONE — il ramo legacy e' ancora il difetto
// ═════════════════════════════════════════════════════════════════════

test('15. MUTAZIONE: senza strict, un 500 viene archiviato come successo', () => {
  const r = esegui(unThread(['a.pdf']), ERR_500, false);
  assert.strictEqual(archiviato(r, 'T1'), true, 'e proprio questo il difetto che il fix toglie');
  assert.strictEqual(inCoda(r, 'T1'), false);
  assert.strictEqual(r.stats.failed, 1, 'lo stat lo sapeva: era la decisione a ignorarlo');
});

test('16. MUTAZIONE: senza strict, il secondo PDF di un email sparisce', () => {
  const r = esegui([{ id: 'T1', messages: [{ pdfs: ['A.pdf', 'B.pdf'] }] }],
    (f) => (f === 'A.pdf' ? OK_QUEUED() : ERR_500()), false);
  assert.strictEqual(archiviato(r, 'T1'), true);
  assert.strictEqual(inCoda(r, 'T1'), false, 'B irrecuperabile: il buco multi-allegato');
});

// ═════════════════════════════════════════════════════════════════════
// D. IL CHIAMANTE — il fix vive nella riga che conta
// ═════════════════════════════════════════════════════════════════════

test('17. checkHardiesEmails chiede esplicitamente lo strict labeling', () => {
  const f = grab(HARD, 'function checkHardiesEmails()', '\n}');
  assert.ok(/processLabelPDF\(\s*'hardies-import',\s*'hardies-processed',\s*\n?\s*'gmail-hardies-import',\s*null,\s*true\s*\)/.test(f),
    'il quinto argomento deve essere true e il quarto null (niente backfill)');
});

test('18. checkAllEmails chiama ancora Hardie s, e per primo', () => {
  assert.ok(/checkHardiesEmails\(\);/.test(CODE));
  assert.ok(CODE.indexOf('checkHardiesEmails') < CODE.indexOf('checkFrugeEmails'));
});

test('19. Hardie s ora ha la stessa forma di Fruge', () => {
  const h = grab(HARD,  'function checkHardiesEmails()', '\n}');
  const g = grab(FRUGE, 'function checkFrugeEmails()',   '\n}');
  const args = (src) => (src.match(/processLabelPDF\(([\s\S]*?)\)/)[1])
    .split(',').map(s => s.trim()).slice(3);
  assert.deepStrictEqual(args(h), args(g), 'stessi ultimi due argomenti: null, true');
});

test('20. il percorso order-check e fail-closed ma NON trasporta documenti', () => {
  const f = grab(HARD, 'function checkHardiesOrderConfirmations()', '\n}');
  assert.ok(/result\.ok === true/.test(f), 'etichetta solo su ok confermato');
  assert.ok(/else \{[\s\S]*non etichettato/.test(f), 'e su fallimento lo dice');
  // e resta dormiente: checkAllEmails non lo chiama
  assert.ok(!/checkHardiesOrderConfirmations\(\)/.test(CODE),
    'non e agganciato al trigger orario');
});

test('21. il backfill storico resta separato e non entra nel giro orario', () => {
  const back = fs.readFileSync(path.join(GAS, 'Backfill.gs.js'), 'utf8');
  assert.ok(/function backfillHardiesFromJune2026\(\)/.test(back));
  assert.ok(!/backfillHardiesFromJune2026\(\)/.test(CODE),
    'il backfill non deve essere agganciato a checkAllEmails');
  const bf = grab(back, 'function backfillHardiesFromJune2026()', '\n}');
  assert.ok(/backfillStartJune2026\(\),\s*true/.test(bf), 'il backfill era gia strict');
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
