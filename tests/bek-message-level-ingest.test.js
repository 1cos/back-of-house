// INV10FINAL.1 — l'ingest BEK e' per MESSAGGIO, non per thread.
//
// Ogni caso esegue il sorgente REALE di apps-script/gmail-vendor-import
// dentro il sandbox di helpers-fake-gmail. Nessuna logica ricopiata:
// se il contratto cambia nel file vero, questi test se ne accorgono.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { caricaGas, fakeMessage, fakeThread, GAS_DIR } = require('./helpers-fake-gmail.js');

let passati = 0, falliti = 0;
function t(nome, fn) {
  try { fn(); passati++; console.log('  ok   ' + nome); }
  catch (e) { falliti++; console.log('  FAIL ' + nome + '\n       ' + e.message); }
}

const SUB  = "Ben E. Keith : Order Confirmation for FDF770366-ZENO'S ON THE SQUARE;0002799018";
const FROM = 'CRP-SVCMBX-entree@benekeith.com';
const ACK  = '<html>ACK  Thank you for your order! Sales Order # <b>0002799018</b></html>';
const CONF = '<html>CONF Your order is confirmed Sales Order # <b>0002799018</b></html>';

function threadDue(labels) {
  return fakeThread({
    id: 'thread-due', labels: labels || [],
    messages: [
      fakeMessage({ id: 'm-ack',  subject: SUB, from: FROM, body: ACK  }),
      fakeMessage({ id: 'm-conf', subject: SUB, from: FROM, body: CONF }),
    ],
  });
}

function corpo(p) { return p.html_body || p.body || ''; }

// Esegue il collector orario reale su `threads`, con `rispondi` a decidere
// l'esito di ogni invio.
function collector(threads, rispondi) {
  const g = caricaGas({
    files: ['Utils.gs.js', 'BEKImport.gs.js'],
    threads, props: { BEK_ENABLED: 'true' }, rispondi,
  });
  g.ctx.checkBEKEmails();
  return g;
}
function backfill(threads, rispondi) {
  const g = caricaGas({
    files: ['Utils.gs.js', 'BEKImport.gs.js', 'Backfill.gs.js'],
    threads, props: { BEK_ENABLED: 'true' }, rispondi,
  });
  g.ctx.backfillBEKFromJune2026();
  return g;
}
const sempreOk = () => ({ status: 'queued', document_id: 'x' });

console.log('\nA — thread con ACK poi CONF: partono entrambi, in ordine');

t('A1 collector orario: due messaggi, due invii', () => {
  const th = threadDue();
  const g = collector([th], sempreOk);
  assert.strictEqual(g.inviati.length, 2, 'invii attesi 2, visti ' + g.inviati.length);
});

t('A2 collector orario: prima l\'ACK, poi la CONF (cronologico)', () => {
  const th = threadDue();
  const g = collector([th], sempreOk);
  assert.strictEqual(corpo(g.inviati[0].payload), ACK);
  assert.strictEqual(corpo(g.inviati[1].payload), CONF);
});

t('A3 collector orario: thread etichettato quando tutti passano', () => {
  const th = threadDue();
  collector([th], sempreOk);
  assert.deepStrictEqual([...th._labels], ['bek-processed']);
});

t('A4 backfill: stessi due invii, stesso ordine', () => {
  const th = threadDue();
  const g = backfill([th], sempreOk);
  assert.strictEqual(g.inviati.length, 2);
  assert.strictEqual(corpo(g.inviati[0].payload), ACK);
  assert.strictEqual(corpo(g.inviati[1].payload), CONF);
  assert.deepStrictEqual([...th._labels], ['bek-processed']);
});

t('A5 il payload porta subject, from e html_body di QUEL messaggio', () => {
  const th = threadDue();
  const g = collector([th], sempreOk);
  for (const c of g.inviati) {
    assert.strictEqual(c.payload.subject, SUB);
    assert.strictEqual(c.payload.from, FROM);
    assert.ok(c.payload.html_body, 'html_body mancante');
  }
});

console.log('\nB — un messaggio fallisce: il thread NON viene etichettato');

t('B1 collector: secondo invio fallito -> nessuna etichetta', () => {
  const th = threadDue();
  const g = collector([th], (p, n) => (n === 2 ? { error: 'boom' } : sempreOk()));
  assert.strictEqual(g.inviati.length, 2, 'il primo messaggio deve partire comunque');
  assert.deepStrictEqual([...th._labels], [], 'il thread non deve essere etichettato');
});

t('B2 collector: PRIMO invio fallito -> nessuna etichetta, il secondo parte', () => {
  const th = threadDue();
  const g = collector([th], (p, n) => (n === 1 ? { error: 'boom' } : sempreOk()));
  assert.strictEqual(g.inviati.length, 2);
  assert.deepStrictEqual([...th._labels], []);
});

t('B3 backfill: al primo fallimento i successivi NON partono (cronologia MT61)', () => {
  const th = threadDue();
  const g = backfill([th], (p, n) => (n === 1 ? { error: 'boom' } : sempreOk()));
  assert.strictEqual(g.inviati.length, 1, 'il backfill deve fermarsi al fallito');
  assert.deepStrictEqual([...th._labels], []);
});

t('B4 un thread fallito non impedisce a un ALTRO thread di riuscire', () => {
  const a = threadDue();
  const b = fakeThread({ id: 'thread-b', messages: [
    fakeMessage({ id: 'm-b', subject: SUB.replace('0002799018', '0002869853'), from: FROM, body: CONF }),
  ]});
  collector([a, b], (p) => (corpo(p) === ACK ? { error: 'boom' } : sempreOk()));
  assert.deepStrictEqual([...a._labels], []);
  assert.deepStrictEqual([...b._labels], ['bek-processed']);
});

console.log('\nC — al retry il gia\' passato torna duplicate e il thread si chiude');

t('C1 retry: primo duplicate, secondo queued -> thread etichettato', () => {
  const th = threadDue();
  const g = collector([th], (p) => (corpo(p) === ACK
    ? { status: 'duplicate', document_id: 'gia-visto' }
    : { status: 'queued', document_id: 'nuovo' }));
  assert.strictEqual(g.inviati.length, 2);
  assert.deepStrictEqual([...th._labels], ['bek-processed']);
});

t('C2 il ciclo completo: run 1 fallisce, run 2 chiude', () => {
  const th1 = threadDue();
  collector([th1], (p, n) => (n === 2 ? { error: 'rete' } : sempreOk()));
  assert.deepStrictEqual([...th1._labels], [], 'run 1: non etichettato');

  const th2 = threadDue();           // stesso thread, ancora senza etichetta
  const g2 = collector([th2], (p) => (corpo(p) === ACK
    ? { status: 'duplicate' } : { status: 'queued' }));
  assert.strictEqual(g2.inviati.length, 2);
  assert.deepStrictEqual([...th2._labels], ['bek-processed'], 'run 2: chiuso');
});

console.log('\nD — eleggibilita\' per messaggio');

t('D1 un messaggio non-BEK nel thread non parte', () => {
  const th = fakeThread({ id: 'misto', messages: [
    fakeMessage({ id: 'm-ack', subject: SUB, from: FROM, body: ACK }),
    fakeMessage({ id: 'm-reply', subject: 'Re: qualcosa', from: 'chef@zenos.com', body: 'ciao' }),
    fakeMessage({ id: 'm-conf', subject: SUB, from: FROM, body: CONF }),
  ]});
  const g = collector([th], sempreOk);
  assert.strictEqual(g.inviati.length, 2);
  assert.deepStrictEqual(g.inviati.map(c => corpo(c.payload)), [ACK, CONF]);
});

t('D2 thread senza messaggi eleggibili: nessun invio e NESSUNA etichetta', () => {
  const th = fakeThread({ id: 'vuoto', messages: [
    fakeMessage({ id: 'm-x', subject: 'Re: qualcosa', from: 'chef@zenos.com', body: 'ciao' }),
  ]});
  const g = collector([th], sempreOk);
  assert.strictEqual(g.inviati.length, 0);
  assert.deepStrictEqual([...th._labels], [], 'mai etichettare un thread da cui non e\' partito niente');
});

console.log('\nJ — fail closed su ogni forma di errore del backend');

const erroriVeri = [
  ['400 con {error}',      { error: 'Bad Request' }],
  ['500 con {error}',      { error: 'DB insert error' }],
  ['risposta senza status',{ message: 'ok' }],
  ['status sconosciuto',   { status: 'accepted' }],
  ['null',                 null],
  ['array',                []],
];
for (const [nome, risposta] of erroriVeri) {
  t('J ' + nome + ' -> thread non etichettato', () => {
    const th = threadDue();
    collector([th], () => risposta);
    assert.deepStrictEqual([...th._labels], []);
  });
}

t('J eccezione di rete -> thread non etichettato', () => {
  const th = threadDue();
  collector([th], () => new Error('network down'));
  assert.deepStrictEqual([...th._labels], []);
});

t('J JSON malformato -> thread non etichettato', () => {
  const th = threadDue();
  const g = caricaGas({
    files: ['Utils.gs.js', 'BEKImport.gs.js'],
    threads: [th], props: { BEK_ENABLED: 'true' }, rispondi: sempreOk,
  });
  g.sandbox.UrlFetchApp.fetch = () => ({ getContentText: () => '<html>502</html>' });
  g.ctx.checkBEKEmails();
  assert.deepStrictEqual([...th._labels], []);
});

console.log('\nK — il gate BEK_ENABLED e il buyer guard restano dove sono');

t('K1 BEK_ENABLED assente: nessun invio', () => {
  const th = threadDue();
  const g = caricaGas({
    files: ['Utils.gs.js', 'BEKImport.gs.js'],
    threads: [th], props: {}, rispondi: sempreOk,
  });
  g.ctx.checkBEKEmails();
  assert.strictEqual(g.inviati.length, 0);
  assert.deepStrictEqual([...th._labels], []);
});

t('K2 il collector NON replica il buyer guard', () => {
  const src = ['BEKImport.gs.js', 'Backfill.gs.js', 'RecoveryBEK.gs.js']
    .map(f => fs.readFileSync(path.join(GAS_DIR, f), 'utf8'))
    .join('\n')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  for (const vietato of ['raven_wolf', 'zenosonthesquare', 'buyer_class', 'BUYER_EXCLUDED']) {
    assert.ok(!src.includes(vietato),
      'il collector non deve conoscere "' + vietato + '": quella decisione e\' del backend');
  }
});

console.log('\nEsito: ' + passati + ' passati, ' + falliti + ' falliti\n');
process.exit(falliti ? 1 : 0);
