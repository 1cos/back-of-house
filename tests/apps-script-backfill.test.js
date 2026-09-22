// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 54A — audit statico delle funzioni di backfill storico.
//
// I file .gs non sono require()-abili (girano su Apps Script, con
// GmailApp/PropertiesService globali), quindi questi test leggono il
// SORGENTE e verificano le proprieta' che devono valere. Stesso approccio
// gia' usato in tests/walmart-detectvendor-linear-parity.test.js.
//
// La proprieta' piu' importante e' negativa: il collector orario NON deve
// essere cambiato.
//
// `node tests/apps-script-backfill.test.js`
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'apps-script', 'gmail-vendor-import');
const read = f => fs.readFileSync(path.join(DIR, f), 'utf8');
const utils    = read('Utils.gs.js');
const bek      = read('BEKImport.gs.js');
const backfill = read('Backfill.gs.js');
const codice   = read('Codice.js');
const hardies  = read('HardiesImport.gs.js');
const trevipay = read('TreviPayImport.js');

// Corpo di una funzione, per asserire su UNA funzione e non sul file intero.
function fnBody(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.notStrictEqual(start, -1, 'funzione non trovata: ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (let j = i; j < src.length; j++) {
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

// ── Retrocompatibilita' di processLabelPDF ───────────────────────

test('1. processLabelPDF senza startDate conserva il cutoff a 30 giorni', () => {
  const f = fnBody(utils, 'processLabelPDF');
  assert.ok(/cutoff\.setDate\(cutoff\.getDate\(\) - 30\)/.test(f), 'cutoff 30gg assente');
  assert.ok(/if \(startDate\) \{\s*cutoff = startDate;\s*\} else \{/.test(f.replace(/\n\s*/g, ' ').replace(/\s+/g,' ')),
    'il ramo 30 giorni deve essere quello di DEFAULT, non il contrario');
});

test('2. processLabelPDF mantiene batch 20 e il filtro sulla data', () => {
  const f = fnBody(utils, 'processLabelPDF');
  assert.ok(/getThreads\(0, 20\)/.test(f), 'batch 20 assente');
  assert.ok(/getLastMessageDate\(\) > cutoff/.test(f), 'filtro sul cutoff assente');
});

test('3. i chiamanti orari NON passano startDate', () => {
  // La proprieta' che conta non e' il NUMERO di argomenti, e' che nessun
  // collector orario si porti dietro una data: se lo facesse,
  // raggiungerebbe lo storico e non sarebbe piu' un percorso orario.
  //
  // INV05D ha portato Fruge a 5 argomenti per attivare strict, ma il
  // quarto resta null: il cutoff relativo a 30 giorni e' intatto. Per
  // questo qui si controlla il valore della startDate, non l'arieta'.
  for (const [src, fname] of [[hardies,'checkHardiesEmails'], [trevipay,'checkTreviPayEmails'],
                              [read('FrugeImport.gs.js'),'checkFrugeEmails']]) {
    const f = fnBody(src, fname);
    const call = f.match(/processLabelPDF\(([\s\S]*?)\);/);
    assert.ok(call, 'chiamata non trovata in ' + fname);
    const args = call[1].split(',').map(a => a.trim());
    assert.ok(args.length === 3 || args.length === 5,
      fname + ': 3 argomenti (legacy) oppure 5 (strict), non altro');
    if (args.length === 5) {
      assert.strictEqual(args[3], 'null',
        fname + ' deve passare startDate null, non una data');
      assert.strictEqual(args[4], 'true',
        fname + ': il quinto argomento ha senso solo per attivare strict');
    }
    assert.ok(!/backfillStartJune2026|new Date\(/.test(f),
      fname + ' non deve costruire nessuna start date');
  }
});

// ── Le tre funzioni di backfill ──────────────────────────────────

test('4. Walmart historical: 1 giugno 2026, percorso e endpoint invariati', () => {
  const f = fnBody(backfill, 'backfillTreviPayFromJune2026');
  assert.ok(/'trevipay-import'/.test(f) && /'trevipay-processed'/.test(f));
  assert.ok(/'gmail-vendor-import'/.test(f), 'endpoint deve restare gmail-vendor-import');
  assert.ok(/backfillStartJune2026\(\)/.test(f), 'start date assente');
});

test("5. Hardie's historical: solo invoice, endpoint gmail-hardies-import", () => {
  const f = fnBody(backfill, 'backfillHardiesFromJune2026');
  assert.ok(/'hardies-import'/.test(f) && /'hardies-processed'/.test(f));
  assert.ok(/'gmail-hardies-import'/.test(f), 'deve usare il percorso invoice esistente');
  assert.ok(!/hardies-order/.test(f), 'non deve toccare le order confirmation');
  // codeOnly: il commento della funzione CITA checkHardiesOrderConfirmations
  // per spiegare perche' NON la si tocca. Va verificato il codice, non la prosa.
  assert.ok(codeOnly(backfill).indexOf('checkHardiesOrderConfirmations') === -1,
    'il backfill non deve invocare le OC Hardie’s');
});

test('6. la start date e 1 giugno 2026 costruita in ora locale', () => {
  const f = fnBody(backfill, 'backfillStartJune2026');
  assert.ok(/new Date\(2026, 5, 1\)/.test(f), 'deve essere new Date(2026, 5, 1)');
  assert.ok(!/2026-06-01/.test(f), 'niente stringa ISO: un parse UTC puo spostare il giorno');
  const d = new Date(2026, 5, 1);
  assert.strictEqual(d.getFullYear(), 2026);
  assert.strictEqual(d.getMonth(), 5, 'mese 0-based: 5 = giugno');
  assert.strictEqual(d.getDate(), 1);
});

// ── BEK: live vs backfill ────────────────────────────────────────

test('7. BEK historical contiene after:2026/05/31 e batch 20', () => {
  const f = fnBody(backfill, 'backfillBEKFromJune2026');
  assert.ok(/after:2026\/05\/31/.test(f), 'finestra storica assente');
  assert.ok(/-label:bek-processed/.test(f), 'clausola anti-ripetizione assente');
  assert.ok(/subject:"Order Confirmation"/.test(f) && /from:benekeith\.com/.test(f));
  assert.ok(/GmailApp\.search\(query, 0, 20\)/.test(fnBody(bek, 'processBEKQuery')), 'batch 20 assente');
});

test('8. BEK historical NON applica BEK_TEST_MODE', () => {
  const f = fnBody(backfill, 'backfillBEKFromJune2026');
  assert.ok(!/BEK_TEST_MODE/.test(codeOnly(f)), 'il backfill non deve restringere al Sales Order di test');
  assert.ok(!/BEK_TEST_SALES_ORDER/.test(codeOnly(f)));
});

test('9. BEK historical MANTIENE il gate BEK_ENABLED', () => {
  const f = fnBody(backfill, 'backfillBEKFromJune2026');
  assert.ok(/getProperty\('BEK_ENABLED'\) !== 'true'/.test(f), 'gate BEK_ENABLED assente');
  const gate = f.indexOf("BEK_ENABLED");
  const query = f.indexOf('after:2026/05/31');
  assert.ok(gate < query, 'il gate deve precedere la query, non seguirla');
});

test('10. il live checkBEKEmails continua ad applicare BEK_TEST_MODE', () => {
  const f = fnBody(bek, 'checkBEKEmails');
  assert.ok(/getProperty\('BEK_TEST_MODE'\) === 'true'/.test(f), 'test mode rimosso dal live');
  assert.ok(/BEK_TEST_SALES_ORDER/.test(f));
  assert.ok(/getProperty\('BEK_ENABLED'\) !== 'true'/.test(f), 'gate rimosso dal live');
  assert.ok(!/after:2026\/05\/31/.test(f), 'il live non deve guardare allo storico');
});

// AGGIORNATO da MICRO-TASK 61. Fino a MT54A live e backfill condividevano
// processBEKQuery. Non e' piu' possibile: il backend sceglie la revisione
// operativa di un Sales Order per created_at, cioe' per ordine di
// ingestione, e GmailApp.search restituisce newest-first. Il backfill deve
// quindi raccogliere tutto il backlog, ordinarlo cronologicamente e solo
// dopo tagliare, cosa che il percorso orario non deve fare. Resta invariato
// cio' che conta: il live usa ancora processBEKQuery, e processBEKQuery
// etichetta solo su esito confermato.
test('11. il live usa processBEKQuery; il backfill ha il suo percorso cronologico', () => {
  assert.ok(/processBEKQuery\(query, '\[BEK\]'\)/.test(fnBody(bek, 'checkBEKEmails')),
    'il collector orario deve continuare a usare processBEKQuery');
  // INV10FINAL.1 — l'esito confermato adesso vive in bekInvioRiuscito(),
  // chiamato da processBEKQuery. La proprieta' e' la stessa: si etichetta
  // solo su 'queued' o 'duplicate'. Si controlla dove sta davvero.
  const ok = fnBody(bek, 'bekInvioRiuscito');
  assert.ok(/status === 'queued' \|\| result\.status === 'duplicate'/.test(ok),
    'esito confermato = solo queued o duplicate');
  assert.ok(/!result\.error/.test(ok), 'una risposta con {error} non e mai un successo');

  const shared = fnBody(bek, 'processBEKQuery');
  assert.ok(/bekInvioRiuscito\(result\)/.test(shared),
    'processBEKQuery deve decidere l esito con bekInvioRiuscito');
  assert.ok(/stats\.failed\+\+/.test(shared), 'gli errori devono essere contati, non etichettati');
  // L'etichetta e' una decisione di THREAD presa dopo tutti i messaggi.
  assert.ok(/tuttiOk[\s\S]{0,200}addLabel\(processedLabel\)/.test(shared),
    'addLabel deve dipendere dall esito di TUTTI i messaggi eleggibili');
  assert.ok(/bekMessaggiEleggibili\(thread\)/.test(shared),
    'l unita di ingest deve essere il messaggio, non il thread');

  const bf = fnBody(backfill, 'backfillBEKFromJune2026');
  assert.ok(/processBEKBacklogChronological\(query, '\[BEK-BACKFILL\]'/.test(bf),
    'il backfill deve usare il percorso cronologico');
  assert.ok(!/processBEKQuery/.test(bf),
    'il backfill non deve piu chiamare processBEKQuery');
  const chrono = fnBody(backfill, 'processBEKBacklogChronological');
  assert.ok(/bekInvioRiuscito\(result\)/.test(chrono),
    'anche il backfill decide l esito con bekInvioRiuscito');
  assert.ok(/tuttiOk[\s\S]{0,200}addLabel\(processedLabel\)/.test(chrono),
    'anche il backfill etichetta solo se TUTTI i messaggi eleggibili sono passati');
  assert.ok(/bekMessaggiEleggibili\(thread\)/.test(chrono),
    'anche il backfill ingerisce per messaggio');
  assert.ok(/\.sort\(/.test(chrono) && /slice\(0, batchSize\)/.test(chrono),
    'ordinamento globale PRIMA del taglio');
  assert.ok(chrono.indexOf('.sort(') < chrono.indexOf('slice(0, batchSize)'),
    'il sort deve precedere lo slice, altrimenti il taglio invertirebbe le coppie');
});

// ── Il collector orario non deve essere cambiato ─────────────────

test('12. checkAllEmails invariato: stesse 6 chiamate, stesso ordine', () => {
  const f = fnBody(codice, 'checkAllEmails');
  const chiamate = [...f.matchAll(/^\s*([a-zA-Z]+)\(\);/gm)].map(m => m[1]);
  assert.deepStrictEqual(chiamate, [
    'checkHardiesEmails', 'checkFreshpointEmails', 'processTouchBistroEmails',
    'checkBEKEmails', 'checkFrugeEmails', 'checkTreviPayEmails',
  ]);
});

test('13. nessuna funzione di backfill e agganciata al trigger orario', () => {
  const f = fnBody(codice, 'checkAllEmails');
  for (const n of ['backfillTreviPayFromJune2026', 'backfillHardiesFromJune2026',
                   'backfillBEKFromJune2026', 'backfillFrugeFromJune2026']) {
    assert.ok(f.indexOf(n) === -1, n + ' non deve stare in checkAllEmails');
    assert.ok(codeOnly(codice).indexOf(n) === -1, n + ' non deve comparire in Codice.js');
  }
  assert.ok(/everyHours\(1\)/.test(codice), 'il trigger orario deve restare');
});

test("14. checkHardiesOrderConfirmations resta NON collegata", () => {
  assert.strictEqual(codeOnly(codice).indexOf('checkHardiesOrderConfirmations'), -1,
    'le OR Hardie’s non vanno aggiunte a checkAllEmails');
});

test('15. Fruge HA un backfill, strict, e resta manuale', () => {
  // INV05: la premessa di questo test era falsa. Diceva "nessun backfill
  // per Fruge: e' gia' completo", ma quel "completo" valeva solo per le
  // email ETICHETTATE. INV04 ha misurato la sorgente vera: 57 fatture, 51
  // importate, 6 mai etichettate. Il backfill e' servito eccome, e le ha
  // recuperate tutte e sei.
  const f = fnBody(backfill, 'backfillFrugeFromJune2026');
  assert.ok(/'fruge-import'/.test(f) && /'fruge-processed'/.test(f),
    'deve usare le etichette Fruge');
  assert.ok(/'gmail-vendor-import'/.test(f), 'deve usare l endpoint normale');
  assert.ok(/backfillStartJune2026\(\), true\)/.test(f),
    'deve passare la start date E strict = true');
  assert.ok(/logBackfill\('FRUGE'/.test(f), 'deve loggare come gli altri');
  // resta separato dal percorso orario: il collector ha il suo cutoff
  assert.ok(fnBody(fs.readFileSync(path.join(DIR, 'FrugeImport.gs.js'), 'utf8'),
                   'checkFrugeEmails').indexOf('backfillFruge') === -1,
    'il collector orario non deve chiamare il backfill');
});

// ── Log: conteggi si, contenuti no ───────────────────────────────

test('16. il log riporta i conteggi richiesti e nessun segreto', () => {
  const f = fnBody(backfill, 'logBackfill');
  for (const k of ['threads_found', 'queued', 'duplicate', 'failed', 'processed_label_added']) {
    assert.ok(f.indexOf(k) !== -1, 'manca il conteggio ' + k);
  }
  assert.ok(!/ANON_KEY|Bearer|pdf_base64|html_body|getPlainBody/.test(f),
    'il log non deve mai contenere token, payload o contenuto email');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
