// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 66 — il recovery one-shot non puo' toccare un terzo thread.
//
// Esegue il codice vero estratto da RecoveryBEK.gs.js con GmailApp e
// sendToEdge finti. La proprieta' centrale e' negativa: nessun percorso
// deve portare a un invio per un thread fuori allowlist.
//
// `node tests/apps-script-bek-recovery-allowlist.test.js`
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'apps-script', 'gmail-vendor-import', 'RecoveryBEK.gs.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); }
}

const OK = { '19f3299cede96029': '0002492315', '19f32a01faf57e59': '0002492915' };

function build({ subjectFor, enabled = 'true', threadMancante = false } = {}) {
  const inviati = [], logs = [];
  const env = {
    Logger: { log: m => logs.push(String(m)) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => enabled }) },
    GmailApp: { getThreadById: id => threadMancante ? null : ({
      getMessages: () => [{ getSubject: () => subjectFor(id), getFrom: () => 'x@benekeith.com', getBody: () => '<html>' + id + '</html>' }],
    }) },
    sendToEdge: (fn, p) => { inviati.push(p); return { status: 'queued' }; },
    JSON, String, Object,
  };
  const names = Object.keys(env);
  const api = new Function(...names,
    SRC + '\n;return {one:recoverBEKSingleThread_, c1:recoverBEKConfirmation1, c2:recoverBEKConfirmation2,' +
    ' probe:recoverBEKIdempotencyProbe, lista:BEK_RECOVERY_ALLOWLIST};')(...names.map(n => env[n]));
  return { api, inviati, logs };
}
const subjectGiusto = id => "Ben E. Keith : Order Confirmation for FDF770366-ZENO'S ON THE SQUARE;" + (OK[id] || '0000000');

test('1. l allowlist contiene esattamente i due thread target', () => {
  const { api } = build({ subjectFor: subjectGiusto });
  assert.deepStrictEqual(Object.keys(api.lista).sort(), ['19f3299cede96029', '19f32a01faf57e59']);
});

test('2. qualunque thread fuori allowlist viene rifiutato senza invio', () => {
  const { api, inviati } = build({ subjectFor: subjectGiusto });
  for (const id of ['1a0ab7fdb40d8a18', '19f295af0e301e7c', '', null, undefined, 'qualsiasi', '19f3299cede9602']) {
    const r = api.one(id);
    assert.strictEqual(r.refused, true, 'non rifiutato: ' + id);
  }
  assert.strictEqual(inviati.length, 0, 'nessun invio deve partire per thread fuori allowlist');
});

test('3. i due thread in allowlist vengono inviati, uno per funzione', () => {
  const a = build({ subjectFor: subjectGiusto });
  a.api.c1();
  assert.strictEqual(a.inviati.length, 1);
  assert.ok(/;0002492315$/.test(a.inviati[0].subject), 'canary 1 deve mandare 0002492315');

  const b = build({ subjectFor: subjectGiusto });
  b.api.c2();
  assert.strictEqual(b.inviati.length, 1);
  assert.ok(/;0002492915$/.test(b.inviati[0].subject), 'canary 2 deve mandare 0002492915');
});

test('4. secondo cancello: se il Sales Order non e quello atteso, nessun invio', () => {
  const { api, inviati } = build({ subjectFor: () => 'Ben E. Keith : Order Confirmation;9999999' });
  const r = api.c1();
  assert.strictEqual(r.refused, true);
  assert.strictEqual(r.sales_order_trovato, '9999999');
  assert.strictEqual(inviati.length, 0, 'un thread con Sales Order inatteso non deve partire');
});

test('5. BEK_ENABLED continua a essere rispettato', () => {
  const { api, inviati } = build({ subjectFor: subjectGiusto, enabled: 'false' });
  assert.strictEqual(api.c1().skipped, true);
  assert.strictEqual(inviati.length, 0);
});

test('6. thread inesistente: errore pulito, nessun invio', () => {
  const { api, inviati } = build({ subjectFor: subjectGiusto, threadMancante: true });
  const r = api.c1();
  assert.ok(r.error, 'deve segnalare l errore');
  assert.strictEqual(inviati.length, 0);
});

test('7. nessuna label viene toccata: il file non chiama addLabel/removeLabel', () => {
  const codice = SRC.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/addLabel|removeLabel|createLabel/.test(codice),
    'il recovery non deve mutare etichette Gmail');
});

test('8. nessuna query: il file non usa GmailApp.search', () => {
  const codice = SRC.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/GmailApp\.search/.test(codice), 'nessuna ricerca: solo id espliciti');
});

test('9. la sonda di idempotenza rimanda lo stesso thread del canary 1', () => {
  const { api, inviati } = build({ subjectFor: subjectGiusto });
  api.probe();
  assert.strictEqual(inviati.length, 1);
  assert.ok(/;0002492315$/.test(inviati[0].subject));
});

console.log('\n  ' + pass + ' passati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
