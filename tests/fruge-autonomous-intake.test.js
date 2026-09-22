// INV11FINAL.1 — il collector Fruge trova le fatture da solo.
//
// Fino a ieri leggeva soltanto l'etichetta fruge-import, che metteva un
// filtro Gmail scritto a mano: quel filtro copriva system@netyield.com ma
// non bill.blanchet@frugeseafood.com, e le due fatture di bill hanno
// aspettato 20 e 51 giorni.
//
// Qui la query di produzione viene ANALIZZATA E APPLICATA davvero ai
// messaggi finti (helpers-fake-gmail, valutaQuery), non simulata: se la
// query cambia, questi test se ne accorgono. Il codice eseguito e' quello
// vero di apps-script/gmail-vendor-import.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { caricaGas, fakeMessage, fakeThread, analizzaQueryGmail, GAS_DIR } =
  require('./helpers-fake-gmail.js');

let passati = 0, falliti = 0;
function t(nome, fn) {
  try { fn(); passati++; console.log('  ok   ' + nome); }
  catch (e) { falliti++; console.log('  FAIL ' + nome + '\n       ' + e.message); }
}

const FRUGE_SRC = fs.readFileSync(path.join(GAS_DIR, 'FrugeImport.gs.js'), 'utf8');

const NETYIELD = 'system@netyield.com';
const BLANCHET = 'bill.blanchet@frugeseafood.com';
const PAM      = 'pam@frugeseafood.com';
const FANS     = 'fans@frugeseafood.com';
const SUBJ_INV = 'Fruge Seafood      - Invoice - 857053';
const SUBJ_ACH = 'Fruge Seafood      - Cash In - ACH 09-17-2026';
const SUBJ_ADS = 'Premium East Coast Oysters Now Available!';

function mail({ from, subject, allegati = ['invoice.pdf'] }) {
  return fakeMessage({ id: 'm', subject, from, body: '<html/>', attachments: allegati });
}
function thread(id, msg, labels = []) {
  return fakeThread({ id, messages: [msg], labels });
}

// Esegue checkFrugeEmails() REALE con GmailApp che valuta la query vera.
function giro(threads, rispondi) {
  const g = caricaGas({
    files: ['Utils.gs.js', 'FrugeImport.gs.js'],
    threads, props: {}, valutaQuery: true,
    rispondi: rispondi || (() => ({ status: 'queued', document_id: 'x' })),
  });
  g.ctx.checkFrugeEmails();
  return g;
}
const etichette = (th) => [...th._labels].sort();

console.log('\nLA QUERY — forma esatta, niente di piu e niente di meno');

t('Q1 la query vive nel sorgente come costante', () => {
  assert.ok(/var FRUGE_INTAKE_QUERY\s*=/.test(FRUGE_SRC));
});

t('Q2 contiene esattamente le clausole richieste, e nessun extra', () => {
  const g = caricaGas({ files: ['Utils.gs.js', 'FrugeImport.gs.js'], threads: [], rispondi: () => ({}) });
  const c = analizzaQueryGmail(g.ctx.FRUGE_INTAKE_QUERY);   // solleva su clausole ignote
  assert.deepStrictEqual(c.from.sort(), [BLANCHET, NETYIELD].sort());
  assert.deepStrictEqual(c.subject, ['invoice']);
  assert.strictEqual(c.haAllegato, true);
  assert.deepStrictEqual(c.senzaEtichetta, ['fruge-processed']);
  assert.deepStrictEqual(c.conEtichetta, []);
});

console.log('\n1-3 — le fatture dei due mittenti vengono trovate');

t('1. netyield con allegato -> trovata e inviata', () => {
  const th = thread('t-ny', mail({ from: NETYIELD, subject: SUBJ_INV }));
  const g = giro([th]);
  assert.strictEqual(g.inviati.length, 1);
  assert.deepStrictEqual(etichette(th), ['fruge-processed']);
});

t('2. blanchet con allegato -> trovata e inviata', () => {
  const th = thread('t-bb', mail({ from: BLANCHET, subject: 'Fruge Seafood      - Invoice - 850453' }));
  const g = giro([th]);
  assert.strictEqual(g.inviati.length, 1);
  assert.deepStrictEqual(etichette(th), ['fruge-processed']);
});

t('3. blanchet con ZERO etichette iniziali -> trovata comunque', () => {
  const th = thread('t-bb0', mail({ from: BLANCHET, subject: 'Fruge Seafood      - Invoice - 999999' }), []);
  assert.deepStrictEqual(etichette(th), [], 'parte senza nessuna etichetta');
  const g = giro([th]);
  assert.strictEqual(g.inviati.length, 1, 'il filtro Gmail non serve piu');
  assert.deepStrictEqual(etichette(th), ['fruge-processed']);
});

console.log('\n4-8 — chi deve restare fuori, resta fuori');

const esclusi = [
  ['4. pam@frugeseafood.com',        thread('t-pam',  mail({ from: PAM,  subject: SUBJ_INV }))],
  ['5. fans@frugeseafood.com',       thread('t-fans', mail({ from: FANS, subject: SUBJ_INV }))],
  ['6. oggetto "Cash In - ACH"',     thread('t-ach',  mail({ from: NETYIELD, subject: SUBJ_ACH }))],
  ['6b. marketing senza "Invoice"',  thread('t-ads',  mail({ from: NETYIELD, subject: SUBJ_ADS }))],
  ['7. Invoice SENZA allegato',      thread('t-noatt', mail({ from: NETYIELD, subject: SUBJ_INV, allegati: [] }))],
  ['8. gia fruge-processed',         thread('t-done', mail({ from: NETYIELD, subject: SUBJ_INV }), ['fruge-processed'])],
];
for (const [nome, th] of esclusi) {
  t(nome + ' -> nessun invio', () => {
    const prima = etichette(th);
    const g = giro([th]);
    assert.strictEqual(g.inviati.length, 0, 'non doveva partire niente');
    assert.deepStrictEqual(etichette(th), prima, 'e le etichette non devono cambiare');
  });
}

t('4b. pam con oggetto ACH e allegato: esclusa due volte (mittente E oggetto)', () => {
  const th = thread('t-pam-ach', mail({ from: PAM, subject: SUBJ_ACH }));
  const g = giro([th]);
  assert.strictEqual(g.inviati.length, 0);
});

console.log('\n9-14 — la semantica strict non e cambiata di una virgola');

t('9. queued -> fruge-processed', () => {
  const th = thread('t9', mail({ from: BLANCHET, subject: SUBJ_INV }));
  giro([th], () => ({ status: 'queued' }));
  assert.deepStrictEqual(etichette(th), ['fruge-processed']);
});

t('10. duplicate -> fruge-processed', () => {
  const th = thread('t10', mail({ from: BLANCHET, subject: SUBJ_INV }));
  giro([th], () => ({ status: 'duplicate' }));
  assert.deepStrictEqual(etichette(th), ['fruge-processed']);
});

const fallimenti = [
  ['11. 400',        { error: 'Bad Request' }],
  ['12. 500',        { error: 'DB insert error' }],
  ['13. rete',       new Error('network down')],
  ['14. malformato', { message: 'ok senza status' }],
];
for (const [nome, risposta] of fallimenti) {
  t(nome + ' -> NON processed, resta in coda', () => {
    const th = thread('t-' + nome, mail({ from: BLANCHET, subject: SUBJ_INV }));
    const g = giro([th], () => risposta);
    assert.strictEqual(g.inviati.length, 1, 'l invio e stato tentato');
    assert.deepStrictEqual(etichette(th), ['fruge-import'],
      'deve restare in coda, mai fruge-processed');
  });
  t(nome + ' -> al giro dopo viene ritentato', () => {
    const th = thread('t-r-' + nome, mail({ from: BLANCHET, subject: SUBJ_INV }));
    giro([th], () => risposta);
    const g2 = giro([th], () => ({ status: 'duplicate' }));
    assert.strictEqual(g2.inviati.length, 1, 'il retry deve ripartire');
    assert.deepStrictEqual(etichette(th), ['fruge-processed'], 'e stavolta chiudersi');
  });
}

console.log('\n15-16 — convivenza col filtro e nessun doppione');

t('15. thread gia etichettato fruge-import dal filtro: stesso comportamento', () => {
  const conFiltro = thread('t-f', mail({ from: NETYIELD, subject: SUBJ_INV }), ['fruge-import']);
  const senza     = thread('t-s', mail({ from: NETYIELD, subject: SUBJ_INV }), []);
  const a = giro([conFiltro]);
  const b = giro([senza]);
  assert.strictEqual(a.inviati.length, b.inviati.length, 'stesso numero di invii');
  assert.deepStrictEqual(etichette(conFiltro), etichette(senza), 'stesse etichette finali');
  assert.deepStrictEqual(etichette(conFiltro), ['fruge-processed']);
});

t('16a. una fattura parte UNA volta sola dentro un giro', () => {
  const th = thread('t16', mail({ from: BLANCHET, subject: SUBJ_INV }));
  const g = giro([th]);
  assert.strictEqual(g.inviati.length, 1);
});

t('16b. rieseguire il collector NON rimanda niente', () => {
  const th = thread('t16b', mail({ from: NETYIELD, subject: SUBJ_INV }));
  giro([th]);
  assert.deepStrictEqual(etichette(th), ['fruge-processed']);
  const g2 = giro([th]);
  assert.strictEqual(g2.inviati.length, 0, 'lo storico non si rispedisce');
});

t('16c. un thread con due allegati manda due PDF, non quattro', () => {
  const th = fakeThread({ id: 't16c', messages: [
    fakeMessage({ id: 'm', subject: SUBJ_INV, from: NETYIELD, body: '<html/>',
                  attachments: ['a.pdf', 'b.pdf'] }),
  ]});
  const g = giro([th]);
  assert.strictEqual(g.inviati.length, 2);
  assert.deepStrictEqual(etichette(th), ['fruge-processed']);
});

console.log('\nRIUSO — nessun secondo collector parallelo');

t('R1 checkFrugeEmails passa ancora da processLabelPDF strict', () => {
  assert.ok(
    /processLabelPDF\('fruge-import', 'fruge-processed', 'gmail-vendor-import', null, true\)/
      .test(FRUGE_SRC),
    'la chiamata strict deve restare identica');
});

t('R2 il collector Fruge non invia da se: nessun sendToEdge nel file', () => {
  const codice = FRUGE_SRC.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/sendToEdge/.test(codice),
    'l invio deve restare in processLabelPDF, non duplicato qui');
});

t('R3 la messa in coda non decide esiti: nessuna logica di status', () => {
  const fn = FRUGE_SRC.slice(FRUGE_SRC.indexOf('function frugeMettiInCoda'));
  const corpo = fn.slice(0, fn.indexOf('function checkFrugeEmails'));
  for (const vietato of ['queued', 'duplicate', 'addLabel(processedLabel)', 'fruge-processed']) {
    assert.ok(!corpo.includes(vietato),
      'frugeMettiInCoda non deve occuparsi di "' + vietato + '"');
  }
});

console.log('\nEsito: ' + passati + ' passati, ' + falliti + ' falliti\n');
process.exit(falliti ? 1 : 0);
