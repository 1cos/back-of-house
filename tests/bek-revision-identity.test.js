// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 64 — identita' del messaggio e rango della revisione BEK.
//
// MT63 ha osservato in produzione il difetto vero: il dedup dell'intake
// (gmail-vendor-import) scartava come 'duplicate' QUALUNQUE secondo
// messaggio con lo stesso Sales Order. Il secondo non diventava mai un
// documento, quindi la revision logic di MT42 sezione F non vedeva mai
// due fratelli: irraggiungibile da quel percorso. Risultato reale, Sales
// Order 0002492315 di CUCINA: e' sopravvissuto l'acknowledgement e la
// conferma e' stata buttata.
//
// Due cambi, testati qui:
//   1. l'intake deduplica per CONTENUTO (raw_text), non per Sales Order
//   2. MT42-F sceglie la revisione operativa per QUANTITA' CONFERMATE,
//      non per created_at
//
// Base empirica del punto 2 (18 documenti reali del primo batch): la
// presenza di quantita' confermate separa acknowledgement e conferma
// 18 su 18. Il saluto dell'email no: 0002427678 dice "order is confirmed
// and ready" e ha zero confermati.
//
// `node tests/bek-revision-identity.test.js`
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const L = require('../pure_logic.cjs');

const INTAKE = fs.readFileSync(
  path.join(__dirname, '..', 'edge-functions', 'gmail-vendor-import', 'index.ts'), 'utf8');
const WORKER = fs.readFileSync(
  path.join(__dirname, '..', 'edge-functions', 'vendor-doc-auto-import', 'index.ts'), 'utf8');

// MICRO-TASK 81 — la DECISIONE (rango, fratelli, fail closed) vive ora in
// js/vendor-parsers/bek-post-parse-safety.js, condivisa fra Phase A e il
// reprocess della UI. Le SCRITTURE restano nei caller. I pin qui sotto sono
// stati riancorati di conseguenza: stesse asserzioni, sul file che oggi
// contiene la regola, piu' un pin sul caller per la scrittura che gli compete.
const SAFETY = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'vendor-parsers', 'bek-post-parse-safety.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); }
}

// ── Fixture: le due forme reali dello stesso Sales Order ─────────
// document_class e' prodotto dal parser (classifyDocument), derivato SOLO
// dalle righe: mai dalla prosa, mai dalla frase del disclaimer.
const ACK = {
  id: 'ack', created_at: '2026-07-03T19:00:47Z', status: 'pdf_received',
  parsed: { document_class: 'acknowledgement',
            items: [{ vendor_sku: '780005', qty_ordered: 1, qty_received: 0, item_status: 'requested' },
                    { vendor_sku: '819255', qty_ordered: 1, qty_received: 0, item_status: 'requested' }] },
};
const CONF = {
  id: 'conf', created_at: '2026-07-05T14:04:58Z', status: 'pdf_received',
  parsed: { document_class: 'operational_confirmation',
            items: [{ vendor_sku: '780005', qty_ordered: 1, qty_received: 1, item_status: 'filled' },
                    { vendor_sku: '819255', qty_ordered: 1, qty_received: 1, item_status: 'filled' }] },
};
// Il caso che MT65 e' venuto a chiudere: una conferma con TUTTO esaurito.
// Zero confermati, ma NON e' un acknowledgement. classifyDocument la manda
// in 'ambiguous', quindi non viene declassata sotto un ACK ne' promossa.
const CONF_STOCKOUT = {
  id: 'stockout', created_at: '2026-07-05T14:04:58Z', status: 'pdf_received',
  parsed: { document_class: 'ambiguous',
            items: [{ vendor_sku: '780005', qty_ordered: 1, qty_received: 0, item_status: 'out_of_stock' },
                    { vendor_sku: '819255', qty_ordered: 1, qty_received: 0, item_status: 'out_of_stock' }] },
};

// Riproduce il ciclo di MT42-F usando le DUE funzioni di produzione
// (bekRevisionRank/bekOutranks). Il ciclo e' qui, la decisione no.
function operativo(docs) {
  const vivi = docs.filter(d => d.status !== 'ignored');
  const perdenti = new Set();
  for (const me of vivi) {
    const meRank = L.bekRevisionRank(me.parsed, me.created_at);
    const battuto = vivi.some(r => r.id !== me.id && !perdenti.has(r.id) &&
      L.bekOutranks(L.bekRevisionRank(r.parsed, r.created_at), meRank));
    if (battuto) perdenti.add(me.id);
  }
  const vincitori = vivi.filter(d => !perdenti.has(d.id));
  assert.strictEqual(vincitori.length, 1, 'deve restare esattamente una revisione operativa');
  return vincitori[0];
}

// ── A. ACK prima, CONF dopo ──────────────────────────────────────

test('A. ACK ingerito prima, CONF dopo -> operativa la CONF', () => {
  const vincitore = operativo([ACK, CONF]);          // ordine di ingestione: ack, conf
  assert.strictEqual(vincitore.id, 'conf', 'doveva vincere la conferma');
  assert.strictEqual(L.bekHasConfirmedQty(ACK.parsed), false, 'l ACK non e un acquisto');
  assert.strictEqual(L.bekHasConfirmedQty(CONF.parsed), true);
});

// ── B. CONF prima, ACK dopo — il caso che prima regrediva ────────

test('B/H. CONF ingerita prima, ACK piu recente dopo -> resta operativa la CONF', () => {
  const confPrima = { ...CONF, created_at: '2026-07-03T10:00:00Z' };
  const ackDopo   = { ...ACK,  created_at: '2026-07-05T10:00:00Z' };
  const vincitore = operativo([confPrima, ackDopo]);
  assert.strictEqual(vincitore.id, 'conf',
    'un acknowledgement successivo non deve far regredire la conferma');
});

test('B2. il vecchio criterio created_at avrebbe sbagliato: prova della regressione', () => {
  const confPrima = { ...CONF, created_at: '2026-07-03T10:00:00Z' };
  const ackDopo   = { ...ACK,  created_at: '2026-07-05T10:00:00Z' };
  // criterio vecchio: vince il created_at piu' alto
  const vecchio = [confPrima, ackDopo].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
  assert.strictEqual(vecchio.id, 'ack', 'il criterio vecchio sceglieva l ACK');
  assert.strictEqual(operativo([confPrima, ackDopo]).id, 'conf', 'quello nuovo sceglie la CONF');
});

test('B3. l esito non dipende dall ordine in cui Phase A li tocca', () => {
  for (const coppia of [[ACK, CONF], [CONF, ACK]]) {
    assert.strictEqual(operativo(coppia).id, 'conf',
      'ordine ' + coppia.map(d => d.id).join(',') + ' ha dato un esito diverso');
  }
});

// ── Rango: proprieta' della decisione ────────────────────────────

test('rango: la conferma batte l acknowledgement, a prescindere dalla data', () => {
  const vecchiaConf = L.bekRevisionRank(CONF.parsed, '2020-01-01T00:00:00Z');
  const nuovoAck    = L.bekRevisionRank(ACK.parsed,  '2030-01-01T00:00:00Z');
  assert.strictEqual(L.bekOutranks(vecchiaConf, nuovoAck), true);
  assert.strictEqual(L.bekOutranks(nuovoAck, vecchiaConf), false);
});

test('rango: a parita di confermato decide created_at', () => {
  const a = L.bekRevisionRank(CONF.parsed, '2026-07-05T00:00:00Z');
  const b = L.bekRevisionRank(CONF.parsed, '2026-07-09T00:00:00Z');
  assert.strictEqual(L.bekOutranks(b, a), true, 'fra due conferme vince la piu recente');
  assert.strictEqual(L.bekOutranks(a, b), false);
});

test('rango: una conferma parziale conta come conferma', () => {
  const parziale = { document_class: 'operational_confirmation',
                     items: [{ qty_received: 0, item_status: 'out_of_stock' },
                             { qty_received: 2, item_status: 'filled' }] };
  assert.strictEqual(L.bekHasConfirmedQty(parziale), true);
  assert.strictEqual(L.bekOutranks(L.bekRevisionRank(parziale, '2026-01-01'),
                                   L.bekRevisionRank(ACK.parsed, '2030-01-01')), true);
});

// ── MICRO-TASK 65: i casi che il criterio economico sbagliava ────

test('G. conferma con TUTTO esaurito: non viene declassata sotto un ACK', () => {
  const rAck  = L.bekRevisionRank(ACK.parsed, '2026-07-03');
  const rOut  = L.bekRevisionRank(CONF_STOCKOUT.parsed, '2026-07-05');
  assert.strictEqual(L.bekHasConfirmedQty(CONF_STOCKOUT.parsed), false,
    'ha davvero zero confermati: col criterio economico pareva un ACK');
  assert.strictEqual(L.bekRankIsCertain(rOut), false, 'classificata ambiguous, quindi incerta');
  assert.strictEqual(L.bekOutranks(rAck, rOut), false, 'l ACK NON deve superarla');
  assert.strictEqual(L.bekOutranks(rOut, rAck), false, 'e nemmeno lei supera al buio');
});

test('G2. col criterio di MT64 quella conferma sarebbe stata superata dall ACK', () => {
  // criterio vecchio: confermati>0 come unico discriminante, poi created_at
  const vecchioRank = d => ({ confirmed: L.bekHasConfirmedQty(d) ? 1 : 0 });
  const a = vecchioRank(ACK.parsed), b = vecchioRank(CONF_STOCKOUT.parsed);
  assert.strictEqual(a.confirmed, b.confirmed, 'pari merito col criterio vecchio');
  // a pari merito decideva created_at: l ACK del 03/07 perdeva contro il 05/07,
  // ma se l ACK fosse arrivato DOPO avrebbe vinto lui. Ecco il rischio.
  const ackPiuRecente = L.bekRevisionRank(ACK.parsed, '2026-08-01');
  assert.strictEqual(L.bekOutranks(ackPiuRecente, L.bekRevisionRank(CONF_STOCKOUT.parsed, '2026-07-05')),
    false, 'col criterio nuovo un ACK piu recente non la supera comunque');
});

test('I. due conferme dello stesso rango: decide created_at', () => {
  const c1 = { ...CONF, id: 'c1', created_at: '2026-07-05T10:00:00Z' };
  const c2 = { ...CONF, id: 'c2', created_at: '2026-07-09T10:00:00Z' };
  assert.strictEqual(operativo([c1, c2]).id, 'c2', 'fra due conferme vince la piu recente');
});

test('J. due acknowledgement: decide created_at, e nessuno dei due e un acquisto', () => {
  const a1 = { ...ACK, id: 'a1', created_at: '2026-07-03T10:00:00Z' };
  const a2 = { ...ACK, id: 'a2', created_at: '2026-07-04T10:00:00Z' };
  const v = operativo([a1, a2]);
  assert.strictEqual(v.id, 'a2');
  assert.strictEqual(L.bekHasConfirmedQty(v.parsed), false, 'nessun acquisto da un acknowledgement');
});

test('K. revisione non classificabile: nessuno supera nessuno, fail closed', () => {
  const ignoto = { id: 'x', created_at: '2026-07-10T00:00:00Z',
                   parsed: { document_class: 'ambiguous', items: [] } };
  const rIgn = L.bekRevisionRank(ignoto.parsed, ignoto.created_at);
  assert.strictEqual(L.bekRankIsCertain(rIgn), false);
  for (const altro of [ACK, CONF]) {
    const rAltro = L.bekRevisionRank(altro.parsed, altro.created_at);
    assert.strictEqual(L.bekOutranks(rAltro, rIgn), false, altro.id + ' non deve superare un incerto');
    assert.strictEqual(L.bekOutranks(rIgn, rAltro), false, 'un incerto non deve superare ' + altro.id);
  }
});

test('K2. il worker tratta il caso incerto come eccezione bloccante', () => {
  assert.ok(/BEK_REVISION_UNKNOWN/.test(SAFETY), 'manca il codice di eccezione');
  const blocco = SAFETY.slice(SAFETY.indexOf('const incerti'), SAFETY.indexOf('const betterSibling'));
  assert.ok(/severity: 'blocking'/.test(blocco), 'deve essere bloccante');
  assert.ok(SAFETY.indexOf('const incerti') < SAFETY.indexOf('const betterSibling'),
    'il controllo di incertezza deve precedere qualunque superamento');
  // la scrittura compete al caller, e deve restare pending
  const ramo = WORKER.slice(WORKER.indexOf('OUT.REVISION_UNKNOWN'));
  assert.ok(/status: 'pending'/.test(ramo.slice(0, 300)), 'deve restare pending');
});

test('K3. una classe mai vista non riceve rango per sbaglio', () => {
  for (const cls of ['qualcosa_di_nuovo', undefined, null, '']) {
    const r = L.bekRevisionRank({ document_class: cls, items: [{ qty_received: 5 }] }, '2026-01-01');
    assert.strictEqual(L.bekRankIsCertain(r), false, 'classe ' + cls + ' non deve avere rango');
  }
});

test('K4. invariante: un acknowledgement con confermati>0 diventa incerto', () => {
  const contraddittorio = { document_class: 'acknowledgement',
                            items: [{ qty_received: 3, item_status: 'requested' }] };
  assert.strictEqual(L.bekRankIsCertain(L.bekRevisionRank(contraddittorio, '2026-01-01')), false,
    'le qty servono da validazione, non da identita');
});

// ── C / D. identita' del messaggio nell'intake ───────────────────
// Test strutturali sul sorgente: l'intake e' Deno/TypeScript e non e'
// require()-abile qui. Asseriscono le proprieta' esatte che MT63 ha
// dimostrato mancanti.

// Il corpo inizia dopo la ") {" che CHIUDE la firma: la prima graffa
// incontrata e' quella del parametro destrutturato, non quella del corpo.
function fnBody(src, name) {
  const st = src.indexOf('function ' + name + '(');
  assert.notStrictEqual(st, -1, 'funzione non trovata: ' + name);
  const open = src.indexOf(') {', st);
  assert.notStrictEqual(open, -1, 'firma non chiusa: ' + name);
  let d = 0;
  for (let j = open + 2; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (d === 0) return src.slice(st, j + 1); }
  }
  throw new Error('parentesi non bilanciate');
}
const codeOnly = s => s.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

test('C. stessa identica email -> duplicate per CONTENUTO', () => {
  const f = codeOnly(fnBody(INTAKE, 'handleBekOrderConfirmationBody'));
  assert.ok(/\.select\('id, status, raw_text'\)/.test(f),
    'l intake deve leggere raw_text per poter confrontare il contenuto');
  // INV10FINAL.1 — il confronto resta sul CONTENUTO; adesso passa da
  // gviCanonicalNewlines su entrambi i lati, che equipara i soli fine-riga.
  assert.ok(/gviCanonicalNewlines\(r\.raw_text\) === sourceKey/.test(f),
    'il confronto di identita deve restare sul contenuto');
  assert.ok(/const sourceKey = gviCanonicalNewlines\(sourceText\)/.test(f),
    'anche il lato in arrivo deve passare dalla stessa canonicalizzazione');
  assert.ok(/identical[\s\S]{0,200}status: 'duplicate'/.test(f),
    'solo un contenuto identico deve produrre duplicate');
});

test('D. stesso Sales Order ma email diversa -> NON duplicate', () => {
  const f = codeOnly(fnBody(INTAKE, 'handleBekOrderConfirmationBody'));
  // Dentro il ramo salesOrder non deve restare un return 'duplicate' che
  // dipenda solo dall'esistenza del Sales Order.
  const ramo = f.slice(f.indexOf('if (salesOrder)'), f.indexOf('} else if (subject && from)'));
  const ritorni = ramo.match(/status: 'duplicate'/g) || [];
  assert.strictEqual(ritorni.length, 1, 'un solo return duplicate nel ramo Sales Order');
  assert.ok(/gviCanonicalNewlines\(r\.raw_text\) === sourceKey/.test(ramo),
    'e deve essere condizionato al contenuto identico');
  assert.ok(!/\.limit\(1\)[\s\S]{0,120}existing\.length > 0[\s\S]{0,120}duplicate/.test(ramo),
    'il vecchio duplicate incondizionato sul Sales Order deve essere sparito');
});

// ── E. fratello gia' imported -> fail closed ─────────────────────

test('E. un fratello gia imported ferma tutto, lato worker', () => {
  assert.ok(/alreadyImported = rows\.find\(\(r\) => r\.status === 'imported'\)/.test(SAFETY),
    'il controllo sul fratello imported deve restare');
  const blocco = SAFETY.slice(SAFETY.indexOf('if (alreadyImported)'), SAFETY.indexOf('const meRank'));
  assert.ok(/BEK_REVISION_AFTER_IMPORT/.test(blocco) && /severity: 'blocking'/.test(blocco),
    'deve alzare un warning bloccante');
  assert.ok(/was NOT imported as a second purchase/.test(blocco),
    'nessuna seconda purchase');
  assert.ok(SAFETY.indexOf('if (alreadyImported)') < SAFETY.indexOf('const meRank'),
    'il fail closed deve precedere qualunque scelta di revisione');
  // la scrittura compete al caller, e non puo' essere 'imported'
  const ramo = WORKER.slice(WORKER.indexOf('OUT.AFTER_IMPORT'));
  assert.ok(/status: 'pending'/.test(ramo.slice(0, 300)), 'deve restare pending, mai imported');
});

test('E2. l intake NON blocca il caso imported: lo lascia a MT42-F', () => {
  const f = codeOnly(fnBody(INTAKE, 'handleBekOrderConfirmationBody'));
  const ramo = f.slice(f.indexOf('if (salesOrder)'), f.indexOf('} else if (subject && from)'));
  assert.ok(!/status === 'imported'/.test(ramo),
    'l intake non deve duplicare il fail closed: esiste gia in MT42-F ed e visibile in review');
});

// ── F. buyer guard ───────────────────────────────────────────────

test('F. il buyer guard resta invariato e Zeno resta escluso', () => {
  const P = L.parsersApi();
  assert.strictEqual(P.classifyBuyer('raven_wolf_1510@yahoo.com'), P.BUYER_KITCHEN);
  assert.strictEqual(P.classifyBuyer('zeno@zenosonthesquare.com'), P.BUYER_EXCLUDED);
  assert.strictEqual(P.classifyBuyer('  ZENO@ZenosOnTheSquare.com '), P.BUYER_EXCLUDED);
  assert.strictEqual(P.classifyBuyer('altro@x.com'), P.BUYER_UNKNOWN);
  assert.strictEqual(P.classifyBuyer(null), P.BUYER_UNKNOWN);
});

test('F2. una revisione Zeno resta esclusa comunque vada il rango', () => {
  // anche se la conferma Zeno vince il rango, il buyer guard la esclude
  assert.strictEqual(operativo([ACK, CONF]).id, 'conf');
  assert.strictEqual(L.parsersApi().classifyBuyer('zeno@zenosonthesquare.com'),
                     L.parsersApi().BUYER_EXCLUDED);
});

console.log('\n  ' + pass + ' passati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
