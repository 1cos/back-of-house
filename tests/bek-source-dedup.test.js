// INV10FINAL.1 — il dedup a monte, eseguito sul sorgente REALE.
//
// Estrae gviCanonicalNewlines e handleBekOrderConfirmationBody da
// edge-functions/gmail-vendor-import/index.ts e li esegue. Nessuna copia:
// se il testo di quelle funzioni cambia, cambia anche cio' che gira qui.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'edge-functions', 'gmail-vendor-import', 'index.ts'), 'utf8');

function estrai(nome, inizio) {
  const i = SRC.indexOf(inizio);
  assert.ok(i >= 0, 'non trovo l\'inizio di ' + nome);
  // 1. la lista dei parametri: si chiude quando la profondita' di tonde
  //    torna a zero. Serve perche' un parametro destrutturato porta graffe
  //    che non sono il corpo della funzione.
  let k = SRC.indexOf('(', i), tonde = 0;
  for (; k < SRC.length; k++) {
    if (SRC[k] === '(') tonde++;
    else if (SRC[k] === ')') { tonde--; if (tonde === 0) { k++; break; } }
  }
  // 2. da qui, la prima graffa apre davvero il corpo.
  let livello = 0;
  k = SRC.indexOf('{', k);
  for (; k < SRC.length; k++) {
    if (SRC[k] === '{') livello++;
    else if (SRC[k] === '}') { livello--; if (livello === 0) break; }
  }
  return SRC.slice(i, k + 1);
}

const fonte =
  estrai('gviCanonicalNewlines', 'function gviCanonicalNewlines') + '\n' +
  estrai('handleBek', 'async function handleBekOrderConfirmationBody') + '\n' +
  'return { gviCanonicalNewlines, handleBekOrderConfirmationBody };';

// TypeScript -> JS: via le sole annotazioni di tipo presenti in questo blocco.
const js = fonte
  .replace(/function gviCanonicalNewlines\(s: string \| null \| undefined\): string/,
           'function gviCanonicalNewlines(s)')
  .replace(/\{ subject, from, body, html_body \}: \{[^}]*\}/, '{ subject, from, body, html_body }')
  .replace(/let salesOrder: string \| null =/, 'let salesOrder =')
  .replace(/\(r: any\)/g, '(r)')
  .replace(/\bsupabase: any\b/g, 'supabase');

const { gviCanonicalNewlines, handleBekOrderConfirmationBody } =
  new Function('jsonResponse', 'jsonError', js)(
    (data) => ({ __risposta: data }),
    (message, status) => ({ __risposta: { error: message, status } }));

// ── finto PostgREST: solo quello che questo percorso usa ────────────────
function fakeSb(righe, onInsert) {
  const inseriti = [];
  return {
    _inseriti: inseriti,
    from() {
      const f = {};
      const q = {
        _sel: null,
        select(s) { this._sel = s; return this; },
        eq(c, v) { f[c] = v; return this; },
        limit() { return this; },
        single() { return this; },
        insert(row) {
          inseriti.push(row);
          const r = onInsert ? onInsert(row) : { data: { id: 'nuovo-' + inseriti.length }, error: null };
          return { select: () => ({ single: async () => r }) };
        },
        then(res) {
          const out = righe.filter(r => Object.keys(f).every(k => r[k] === f[k]));
          return Promise.resolve({ data: out, error: null }).then(res);
        },
      };
      return q;
    },
  };
}

let passati = 0, falliti = 0;
function t(nome, fn) {
  return Promise.resolve().then(fn).then(
    () => { passati++; console.log('  ok   ' + nome); },
    (e) => { falliti++; console.log('  FAIL ' + nome + '\n       ' + e.message); });
}

const SUB  = "Ben E. Keith : Order Confirmation for FDF770366-ZENO'S ON THE SQUARE;0003243454";
const FROM = 'CRP-SVCMBX-entree@benekeith.com';

// Una conferma BEK realistica, con le colonne che contano per il confronto.
function conferma({ qty = '2', prezzo = '40.98', importo = '81.96', stato = 'Filled', eol = '\n' } = {}) {
  return [
    '<html><body>',
    '<th colspan="4">Sales Order # <b>0003243454</b></th>',
    '<tr><td>116533</td><td>Pastry Bag 21in Clr Disposable</td>',
    '<td>$' + prezzo + '</td><td class="text-right">' + qty + '</td>',
    '<td class="text-right">' + qty + '</td>',
    '<td><div class="status-val">' + stato + '<br></div></td>',
    '<td>$' + importo + '</td></tr>',
    '</body></html>',
  ].join(eol);
}

const BASE = conferma();

async function ingest(sb, testo) {
  const r = await handleBekOrderConfirmationBody(sb, { subject: SUB, from: FROM, html_body: testo });
  return r.__risposta;
}

(async () => {
  console.log('\nE — stesso messaggio con LF contro CRLF -> duplicate');

  await t('E1 in archivio CRLF, in arrivo LF -> duplicate', async () => {
    const sb = fakeSb([{ id: 'esistente', vendor: 'Ben E. Keith', document_type: 'order_confirmation',
                         document_number: '0003243454', status: 'imported',
                         raw_text: conferma({ eol: '\r\n' }) }]);
    const r = await ingest(sb, conferma({ eol: '\n' }));
    assert.strictEqual(r.status, 'duplicate', JSON.stringify(r).slice(0, 160));
    assert.strictEqual(r.document_id, 'esistente');
    assert.strictEqual(sb._inseriti.length, 0, 'non deve nascere un secondo documento');
  });

  await t('E2 in archivio LF, in arrivo CRLF -> duplicate (simmetrico)', async () => {
    const sb = fakeSb([{ id: 'esistente', vendor: 'Ben E. Keith', document_type: 'order_confirmation',
                         document_number: '0003243454', status: 'imported', raw_text: conferma({ eol: '\n' }) }]);
    const r = await ingest(sb, conferma({ eol: '\r\n' }));
    assert.strictEqual(r.status, 'duplicate');
    assert.strictEqual(sb._inseriti.length, 0);
  });

  await t('E3 \\r solo (Mac classico) -> duplicate', async () => {
    const sb = fakeSb([{ id: 'esistente', vendor: 'Ben E. Keith', document_type: 'order_confirmation',
                         document_number: '0003243454', status: 'imported', raw_text: conferma({ eol: '\n' }) }]);
    const r = await ingest(sb, conferma({ eol: '\r' }));
    assert.strictEqual(r.status, 'duplicate');
  });

  console.log('\nF/G/H — una revisione VERA non e\' un duplicato');

  const revisioni = [
    ['F quantita\' diversa', conferma({ qty: '3' })],
    ['G prezzo diverso',     conferma({ prezzo: '41.98' })],
    ['H importo diverso',    conferma({ importo: '122.94' })],
    ['H2 stato riga diverso', conferma({ stato: 'Out of Stock' })],
  ];
  for (const [nome, testo] of revisioni) {
    await t(nome + ' -> NON duplicate, nasce un documento', async () => {
      const sb = fakeSb([{ id: 'esistente', vendor: 'Ben E. Keith', document_type: 'order_confirmation',
                           document_number: '0003243454', status: 'imported', raw_text: BASE }]);
      const r = await ingest(sb, testo);
      assert.strictEqual(r.status, 'queued', 'atteso queued, visto ' + JSON.stringify(r).slice(0, 160));
      assert.strictEqual(sb._inseriti.length, 1);
    });
    await t(nome + ' -> resta diversa ANCHE con fine-riga diversi', async () => {
      const sb = fakeSb([{ id: 'esistente', vendor: 'Ben E. Keith', document_type: 'order_confirmation',
                           document_number: '0003243454', status: 'imported',
                           raw_text: BASE.replace(/\n/g, '\r\n') }]);
      const r = await ingest(sb, testo);
      assert.strictEqual(r.status, 'queued');
    });
  }

  console.log('\nI — reinvio identico -> duplicate');

  await t('I1 stesso identico testo -> duplicate', async () => {
    const sb = fakeSb([{ id: 'esistente', vendor: 'Ben E. Keith', document_type: 'order_confirmation',
                         document_number: '0003243454', status: 'imported', raw_text: BASE }]);
    const r = await ingest(sb, BASE);
    assert.strictEqual(r.status, 'duplicate');
    assert.strictEqual(sb._inseriti.length, 0);
  });

  console.log('\nD — due messaggi diversi dello stesso thread non si schiacciano');

  await t('D3 ACK e CONF dello stesso Sales Order: due documenti', async () => {
    const ack  = '<html>Thank you for your order! Sales Order # <b>0003243454</b> CONFIRMED 0 Requested</html>';
    const sb = fakeSb([]);
    const r1 = await ingest(sb, ack);
    assert.strictEqual(r1.status, 'queued');
    // il primo e' ora in archivio
    const sb2 = fakeSb([{ id: 'ack-doc', vendor: 'Ben E. Keith', document_type: 'order_confirmation',
                          document_number: '0003243454', status: 'pending', raw_text: ack }]);
    const r2 = await ingest(sb2, BASE);
    assert.strictEqual(r2.status, 'queued', 'la CONF non deve essere scambiata per duplicato dell\'ACK');
    assert.strictEqual(sb2._inseriti.length, 1);
  });

  await t('D4 la chiave di dedup NON contiene il thread: solo vendor+tipo+numero+contenuto', () => {
    const f = SRC.slice(SRC.indexOf('async function handleBekOrderConfirmationBody'));
    const blocco = f.slice(0, f.indexOf('const { data: doc, error: insertErr }'));
    assert.ok(!/thread/i.test(blocco), 'il dedup non deve dipendere dal thread');
    for (const atteso of ["eq('vendor', 'Ben E. Keith')",
                          "eq('document_type', 'order_confirmation')",
                          "eq('document_number', salesOrder)"]) {
      assert.ok(blocco.includes(atteso), 'chiave attesa mancante: ' + atteso);
    }
  });

  console.log('\nNORMALIZZAZIONE MINIMA — nient\'altro viene toccato');

  const invarianti = [
    ['spazi non collassati',   'a  b',      'a b'],
    ['niente trim',            '  a  ',     'a'],
    ['niente lowercase',       'ABC',       'abc'],
    ['tag non rimossi',        '<b>a</b>',  'a'],
    ['tab non toccati',        'a\tb',      'a b'],
  ];
  for (const [nome, x, y] of invarianti) {
    await t('N ' + nome, () => {
      assert.notStrictEqual(gviCanonicalNewlines(x), gviCanonicalNewlines(y));
    });
  }
  await t('N i soli fine-riga sono equiparati', () => {
    assert.strictEqual(gviCanonicalNewlines('a\r\nb\rc\nd'), 'a\nb\nc\nd');
  });
  await t('N il testo memorizzato resta verbatim', () => {
    const f = SRC.slice(SRC.indexOf('async function handleBekOrderConfirmationBody'));
    assert.ok(/raw_text:\s+sourceText,/.test(f),
      'raw_text deve continuare a salvare sourceText, non la versione normalizzata');
  });

  console.log('\nEsito: ' + passati + ' passati, ' + falliti + ' falliti\n');
  process.exit(falliti ? 1 : 0);
})();
