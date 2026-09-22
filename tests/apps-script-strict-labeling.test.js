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

function makeEnv(threadSpecs, responder, importName, processedName) {
  const IMP  = importName    || 'X-import';
  const PROC = processedName || 'X-processed';
  const moves = [];          // registro degli spostamenti di etichetta
  const sent  = [];          // nomi dei PDF inviati
  const importLabel = { name: IMP };
  const processedLabel = { name: PROC };

  const threads = threadSpecs.map((spec, ti) => {
    const t = {
      id: spec.id || ('t' + ti),
      labels: [IMP],
      getLastMessageDate: () => spec.date || new Date(),
      getMessages: () => (spec.messages || []).map((m, mi) => ({
        getSubject: () => m.subject || ('subj-' + ti + '-' + mi),
        getFrom: () => m.from || 'sender@example.com',
        // INV07 — il percorso body-only legge questi due
        getPlainBody: () => m.body || '',
        getBody: () => m.html || '',
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
      getUserLabelByName: n => (n === IMP ? importLabel : (n === PROC ? processedLabel : null)),
      createLabel: n => ({ name: n }),
      // INV11FINAL.1 — qui i thread sono GIA' nella coda di import (e' cosi'
      // che makeEnv li costruisce): e' lo scenario "il filtro Gmail ha gia'
      // fatto il suo lavoro". La search autonoma non trova nulla di nuovo, ed
      // e' giusto cosi': questi test misurano il DRENAGGIO della coda, non la
      // ricerca. La ricerca ha la sua suite, fruge-autonomous-intake.
      search: () => [],
    },
    Logger: { log: () => {} },
    Utilities: { base64Encode: () => 'BASE64' },
    sendToEdge: (slug, payload) => { sent.push(payload.filename); return responder(payload.filename); },
  };
  return { env, moves, sent,
           processedOf: id => moves.some(m => m.thread === id && m.op === 'add'    && m.label === PROC),
           // trattenuto = mai de-etichettato dalla coda: al giro dopo lo ritrova
           retainedOf:  id => !moves.some(m => m.thread === id && m.op === 'remove' && m.label === IMP) };
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

test('12. il giro orario e ora interamente fail-closed', () => {
  // Storia di questo test, perche' e' cambiato tre volte e il perche'
  // conta piu' dell'asserzione.
  //   INV05D  — Fruge diventa strict; il test nasce per impedire che
  //             gli ALTRI collector venissero cambiati di straforo.
  //   INV08FINAL — Hardie's esce dalla lista, per decisione dichiarata.
  //   INV09B  — TreviPay esce per ultimo, e con lui tutte le fatture
  //             Walmart Business.
  // Non resta nessun chiamante orario a tre argomenti: la guardia non
  // ha piu' niente da proteggere, quindi cambia verso e ancora la
  // regola nuova — ogni collector orario passa strict.
  for (const [file, fname] of [['FrugeImport.gs.js',   'checkFrugeEmails'],
                               ['HardiesImport.gs.js', 'checkHardiesEmails'],
                               ['TreviPayImport.js',   'checkTreviPayEmails']]) {
    const f = extractFn(fs.readFileSync(path.join(DIR, file), 'utf8'), fname);
    const args = f.match(/processLabelPDF\(([\s\S]*?)\)/)[1].split(',').map(a => a.trim());
    assert.strictEqual(args.length, 5, fname + ' deve passare 5 argomenti');
    assert.strictEqual(args[3], 'null', fname + ': startDate null, niente backfill nel giro orario');
    assert.strictEqual(args[4], 'true', fname + ': strictSuccessLabeling deve essere true');
  }
});

// INV10FINAL.1 — BEK adotta lo stesso contratto strict di processLabelPDF,
// ma sui MESSAGGI invece che sugli allegati: ognuno parte per conto suo e
// l'etichetta e' una decisione di thread presa alla fine.
test('13. BEK: strict per messaggio, come processLabelPDF lo e per allegato', () => {
  const ok = extractFn(bek, 'bekInvioRiuscito');
  assert.ok(/result\.status === 'queued' \|\| result\.status === 'duplicate'/.test(ok),
    'esito confermato = solo queued o duplicate');
  const f = extractFn(bek, 'processBEKQuery');
  assert.ok(/stats\.failed\+\+/.test(f));
  assert.ok(/stats\.threads_retained_for_retry\+\+/.test(f),
    'un thread non chiuso deve restare ritentabile, come nel ramo strict');
  assert.ok(/tuttiOk[\s\S]{0,200}addLabel\(processedLabel\)/.test(f),
    'l etichetta e una decisione di thread presa dopo tutti i messaggi');
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

// ── 4. Fruge: il collector ORARIO e fail-closed (INV05D) ─────────
//
// Qui non si testa piu' processLabelPDF con un flag passato a mano: si
// esegue checkFrugeEmails() vero, estratto da FrugeImport.gs.js, sopra il
// processLabelPDF vero. Se qualcuno togliesse il flag dal collector, i
// test A-E diventerebbero rossi.

const frugeSrc = fs.readFileSync(path.join(DIR, 'FrugeImport.gs.js'), 'utf8');

// INV11FINAL.1 — checkFrugeEmails() adesso chiama prima frugeMettiInCoda(),
// che vive nello stesso file e usa la costante FRUGE_INTAKE_QUERY. In Apps
// Script condividono un solo scope globale: il banco di prova le include
// entrambe invece di lasciare checkFrugeEmails a meta'.
function estraiCostante(src, nome) {
  const i = src.indexOf('var ' + nome);
  assert.notStrictEqual(i, -1, 'costante non trovata: ' + nome);
  const fine = src.indexOf(';', i);
  return src.slice(i, fine + 1);
}

function runFruge(threadSpecs, responder) {
  const e = makeEnv(threadSpecs, responder, 'fruge-import', 'fruge-processed');
  const fn = new Function('GmailApp', 'Logger', 'Utilities', 'sendToEdge',
    extractFn(SRC, 'processLabelPDF') + '\n' +
    estraiCostante(frugeSrc, 'FRUGE_INTAKE_QUERY') + '\n' +
    extractFn(frugeSrc, 'frugeMettiInCoda') + '\n' +
    extractFn(frugeSrc, 'checkFrugeEmails') + '\nreturn checkFrugeEmails;'
  )(e.env.GmailApp, e.env.Logger, e.env.Utilities, e.env.sendToEdge);
  fn();
  return e;
}

const giorniFa = n => new Date(Date.now() - n * 24 * 3600 * 1000);
const frugeThread = (atts, date) => [{ id: 'F1', date: date || giorniFa(1),
                                       messages: [{ attachments: atts }] }];

test('16. [A] Fruge successo -> fruge-processed aggiunto', () => {
  const r = runFruge(frugeThread(['Invoice 900001.pdf']), OK);
  assert.strictEqual(r.processedOf('F1'), true);
  assert.deepStrictEqual(r.sent, ['Invoice 900001.pdf']);
});

test('17. [B] Fruge duplicate -> fruge-processed aggiunto', () => {
  const r = runFruge(frugeThread(['Invoice 900002.pdf']), DUP);
  assert.strictEqual(r.processedOf('F1'), true);
});

test('18. [C] Fruge errore edge 4xx/5xx -> processed NON aggiunto', () => {
  // sendToEdge non lancia sugli HTTP error: muteHttpExceptions e' true e
  // l'edge risponde {error}. E' la forma reale di un 400 o di un 500.
  for (const body of [{ error: 'Missing pdf_base64' },
                      { error: 'DB insert error: boom' },
                      { error: 'Storage upload error: 500' }]) {
    const r = runFruge(frugeThread(['Invoice 900003.pdf']), () => body);
    assert.strictEqual(r.processedOf('F1'), false, JSON.stringify(body));
  }
});

test('19. [D] Fruge eccezione di rete -> processed NON aggiunto', () => {
  // sendToEdge cattura l'eccezione e ritorna {error: ...}: stessa forma.
  const r = runFruge(frugeThread(['Invoice 900004.pdf']),
                     () => ({ error: 'Exception: Address unavailable' }));
  assert.strictEqual(r.processedOf('F1'), false);
});

test('20. [E] il thread fallito resta in fruge-import per il retry', () => {
  const ko = runFruge(frugeThread(['Invoice 900005.pdf']), ERR);
  assert.strictEqual(ko.processedOf('F1'), false, 'non deve essere archiviato');
  assert.strictEqual(ko.retainedOf('F1'), true, 'non deve uscire dalla coda');
  // giro successivo: l'edge risponde bene e il thread esce davvero
  const ok = runFruge(frugeThread(['Invoice 900005.pdf']), OK);
  assert.strictEqual(ok.processedOf('F1'), true);
  assert.strictEqual(ok.retainedOf('F1'), false);
});

test('21. [F] la finestra normale di 30 giorni resta invariata', () => {
  // niente startDate: il cutoff e' relativo, non il 1 giugno del backfill
  const vecchio = runFruge(frugeThread(['Invoice 900006.pdf'], giorniFa(45)), OK);
  assert.deepStrictEqual(vecchio.sent, [], 'oltre 30 giorni non deve essere inviato');
  assert.strictEqual(vecchio.processedOf('F1'), false);

  const recente = runFruge(frugeThread(['Invoice 900007.pdf'], giorniFa(29)), OK);
  assert.deepStrictEqual(recente.sent, ['Invoice 900007.pdf'], 'entro 30 giorni deve passare');

  // e la prova che non e' diventato un backfill: nessuna data fissa
  const f = extractFn(frugeSrc, 'checkFrugeEmails');
  assert.ok(!/backfillStartJune2026|new Date\(/.test(f),
    'il collector orario non deve portarsi dietro una start date');
});

test('22. checkFrugeEmails passa esattamente null e true', () => {
  const f = extractFn(frugeSrc, 'checkFrugeEmails');
  const call = f.match(/processLabelPDF\(([\s\S]*?)\);/);
  const args = call[1].split(',').map(a => a.trim());
  assert.strictEqual(args.length, 5, 'devono essere 5 argomenti');
  assert.strictEqual(args[3], 'null', 'startDate deve restare null: niente backfill');
  assert.strictEqual(args[4], 'true', 'strictSuccessLabeling deve essere true');
});

test('23. nessun collector del giro orario e rimasto fail-open', () => {
  // INV09B — TreviPay era l'ultimo. Il dettaglio dei singoli chiamanti
  // sta nel test 12; qui si verifica la proprieta' di insieme, cioe'
  // che checkAllEmails() non chiami piu' niente che possa archiviare un
  // fallimento come successo.
  const chiamati = extractFn(codice, 'checkAllEmails');
  const perLabelPDF = ['checkFrugeEmails', 'checkHardiesEmails', 'checkTreviPayEmails'];
  for (const fname of perLabelPDF) {
    assert.ok(chiamati.includes(fname + '()'), fname + ' deve essere nel giro orario');
  }
  // FreshPoint passa da processLabelBody, stesso flag
  const fp = extractFn(fs.readFileSync(path.join(DIR, 'FreshpointImport.gs:.js'), 'utf8'),
                       'checkFreshpointEmails');
  assert.ok(/,\s*null,\s*true\)/.test(fp), 'FreshPoint deve restare strict');
  // Ben E. Keith non usa i due helper: etichetta solo su esito confermato
  assert.ok(/result\.status === 'queued' \|\| result\.status === 'duplicate'/.test(bek));
});

// ── 5. FreshPoint: collector BODY-ONLY e fail-closed (INV07) ─────
//
// FreshPoint non allega niente: la conferma d'ordine E' il corpo. Il
// vecchio collector mandava {raw_text, vendor}, campi che l'edge non
// legge, riceveva 400 su ogni email e metteva comunque -processed.
// Qui si esegue processLabelBody vero e checkFreshpointEmails vero.

const fpSrc = fs.readFileSync(path.join(DIR, 'FreshpointImport.gs:.js'), 'utf8');

function makeEnvBody(threadSpecs, responder, importName, processedName) {
  const e = makeEnv(threadSpecs, responder, importName, processedName);
  // sendToEdge del percorso body riceve il payload intero, non un filename
  e.env.sendToEdge = (slug, payload) => { e.sent.push(payload); return responder(payload); };
  return e;
}

function runFruge2(threadSpecs, responder) {   // helper generico body-only
  const e = makeEnvBody(threadSpecs, responder, 'freshpoint-import', 'freshpoint-processed');
  const fn = new Function('GmailApp', 'Logger', 'Utilities', 'sendToEdge',
    extractFn(SRC, 'processLabelBody') + '\n' +
    'const FRESHPOINT_SENDER_RE = /@freshpoint\\.com/i;\n' +
    extractFn(fpSrc, 'checkFreshpointEmails') + '\nreturn checkFreshpointEmails;'
  )(e.env.GmailApp, e.env.Logger, e.env.Utilities, e.env.sendToEdge);
  fn();
  return e;
}

const FP_MSG = { from: 'internet.order@freshpoint.com',
                 subject: 'FreshPoint Dallas Order Confirmation: 19464295-CU59474',
                 body: '| Order Confirmation | Reference #19464295 |', html: '<table></table>' };
const fpThread = (msgs, date) => [{ id: 'FP1', date: date || new Date(Date.now() - 86400000),
                                    messages: msgs || [FP_MSG] }];

test('24. [FP] successo -> freshpoint-processed, e manda body E html_body', () => {
  const r = runFruge2(fpThread(), OK);
  assert.strictEqual(r.processedOf('FP1'), true);
  assert.strictEqual(r.sent.length, 1);
  const p = r.sent[0];
  assert.deepStrictEqual(Object.keys(p).sort(), ['body', 'from', 'html_body', 'subject']);
  assert.ok(!('raw_text' in p), 'raw_text non esiste piu: l edge non lo legge');
  assert.ok(!('vendor' in p),   'vendor non esiste piu: l edge non lo legge');
});

test('25. [FP] duplicate -> processed', () => {
  assert.strictEqual(runFruge2(fpThread(), DUP).processedOf('FP1'), true);
});

test('26. [FP] 400 / 500 / eccezione / risposta malformata -> NON processed', () => {
  const esiti = [
    { error: 'Missing pdf_base64' },              // il 400 che li ha uccisi
    { error: 'DB insert error: boom' },           // 500
    { error: 'Exception: Address unavailable' },  // eccezione di rete
    {}, null, { status: 'boh' },                  // risposte malformate
  ];
  for (const e of esiti) {
    const r = runFruge2(fpThread(), () => e);
    assert.strictEqual(r.processedOf('FP1'), false, JSON.stringify(e));
    assert.strictEqual(r.retainedOf('FP1'), true, 'resta in coda: ' + JSON.stringify(e));
  }
});

test('27. [FP] dopo un fallimento, il retry successivo riesce', () => {
  assert.strictEqual(runFruge2(fpThread(), ERR).processedOf('FP1'), false);
  const ok = runFruge2(fpThread(), OK);
  assert.strictEqual(ok.processedOf('FP1'), true);
  assert.strictEqual(ok.retainedOf('FP1'), false);
});

test('28. [FP] il thread con un inoltro NOSTRO manda comunque l originale', () => {
  // Caso reale: thread 19478941, dopo l email FreshPoint c e un nostro Fwd.
  const conInoltro = fpThread([
    FP_MSG,
    { from: 'massimiliano.zubboli@gmail.com', subject: 'Fwd: ...', body: 'inoltro', html: '' },
  ]);
  const r = runFruge2(conInoltro, OK);
  assert.strictEqual(r.sent.length, 1);
  assert.strictEqual(r.sent[0].from, 'internet.order@freshpoint.com',
    'deve mandare l originale FreshPoint, non il nostro inoltro');
  assert.ok(/Reference #19464295/.test(r.sent[0].body));
});

test('29. [FP] nessun messaggio del mittente atteso -> niente invio, niente etichetta', () => {
  const soloInoltro = fpThread([{ from: 'qualcunaltro@example.com', subject: 'x', body: 'y' }]);
  const r = runFruge2(soloInoltro, OK);
  assert.strictEqual(r.sent.length, 0);
  assert.strictEqual(r.processedOf('FP1'), false);
  assert.strictEqual(r.retainedOf('FP1'), true);
});

test('30. [FP] la finestra di 30 giorni resta quella normale', () => {
  const vecchio = runFruge2(fpThread([FP_MSG], new Date(Date.now() - 45 * 86400000)), OK);
  assert.strictEqual(vecchio.sent.length, 0, 'oltre 30 giorni non parte');
  const recente = runFruge2(fpThread([FP_MSG], new Date(Date.now() - 29 * 86400000)), OK);
  assert.strictEqual(recente.sent.length, 1, 'entro 30 giorni parte');
});

test('31. [FP] checkFreshpointEmails passa mittente, null e true', () => {
  const f = extractFn(fpSrc, 'checkFreshpointEmails');
  const call = f.match(/processLabelBody\(([\s\S]*?)\);/);
  const args = call[1].split(',').map(a => a.trim());
  assert.strictEqual(args.length, 6, 'sei argomenti');
  assert.strictEqual(args[3], 'FRESHPOINT_SENDER_RE');
  assert.strictEqual(args[4], 'null', 'niente start date: non e un backfill');
  assert.strictEqual(args[5], 'true', 'strict obbligatorio');
  // nel CODICE, non nei commenti: il commento cita raw_text apposta,
  // per spiegare il vecchio difetto
  assert.ok(!/raw_text/.test(f), 'raw_text non deve piu comparire nella funzione');
  assert.ok(!/raw_text\s*:/.test(extractFn(SRC, 'processLabelBody')),
    'e nemmeno nel payload di processLabelBody');
});

test('32. [FP] il backfill esiste, e strict, e non e nel percorso orario', () => {
  const b = extractFn(backfill, 'backfillFreshpointFromJune2026');
  assert.ok(/processLabelBody/.test(b));
  assert.ok(/backfillStartJune2026\(\), true\)/.test(b), 'start date E strict');
  assert.ok(/logBackfill\('FRESHPOINT'/.test(b));
  assert.strictEqual(extractFn(codice, 'checkAllEmails').indexOf('backfillFreshpoint'), -1);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
