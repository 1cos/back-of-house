// GG07 — la descrizione con parentesi E virgolette deve essere trovata.
//
// Il difetto vero sta nella serializzazione del filtro .in() di
// postgrest-js, quindi il test non puo' riprodurlo riscrivendolo: lo
// fisserebbe per finta. Qui si verifica l'unica cosa che ci riguarda —
// che il nuovo percorso NON usi un filtro sulla descrizione e selezioni
// esattamente le righe giuste — piu' la prova, in coda, che nel
// repository non resti nessun .in('invoice_description', ...).
//
// La prova sul campo (28/09/2026, database di produzione):
//   .in()  su 6 descrizioni -> 5 righe   (il salame mancava)
//   .eq()  sulla stessa riga -> 1 riga   (esiste, confirmed)

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { vplFetchLinksByDescription } = require('../js/vendor-parsers/link-lookup.js');

const SALAME = 'Salame Napoli Smoked W/Peppercorn 2pc/cs (775Q) "Levoni"';
const RIGHE = [
  { invoice_description: 'Italian Peeled Tomatoes 6#10 "La Carmela"', ingredient_id: 'i1' },
  { invoice_description: 'Extra Virgin Olive Oil 3/5lt Seleccion "Oleoestepa"', ingredient_id: 'i2' },
  { invoice_description: 'Gnocchi C-Catering 10kg. "Molino Pasini"', ingredient_id: 'i3' },
  { invoice_description: 'Guanciale 2/3.5lb "Maestri"', ingredient_id: 'i4' },
  { invoice_description: 'SEA SALT COARSE SICILIAN BULK 25KG', ingredient_id: 'i5' },
  { invoice_description: SALAME, ingredient_id: 'i6' },
  { invoice_description: 'Roba di un altro fornitore', ingredient_id: 'i7' },
];

// Finto client che REGISTRA i filtri applicati. Se qualcuno reintroduce
// un .in() sulla descrizione, il test lo vede.
function fakeSb(rows) {
  const filtri = [];
  const q = {
    filtri,
    select() { return q; },
    eq(col, val) { filtri.push(['eq', col, val]); return q; },
    in(col, vals) { filtri.push(['in', col, vals]); return q; },
    then(res) { return Promise.resolve({ data: rows, error: null }).then(res); },
  };
  return { from(t) { filtri.push(['from', t]); return q; }, _q: q };
}

test('1. trova tutte e sei le descrizioni, parentesi comprese', async () => {
  const sb = fakeSb(RIGHE);
  const descs = RIGHE.slice(0, 6).map(r => r.invoice_description);
  const { data, error } = await vplFetchLinksByDescription(sb, 'Global Gourmet Foods', descs);
  assert.strictEqual(error, null);
  assert.strictEqual(data.length, 6, 'sei descrizioni, sei righe');
  assert.ok(data.some(r => r.invoice_description === SALAME), 'il salame deve esserci');
});

test('2. non applica nessun filtro sulla descrizione', async () => {
  const sb = fakeSb(RIGHE);
  await vplFetchLinksByDescription(sb, 'Global Gourmet Foods', [SALAME]);
  const suDescrizione = sb._q.filtri.filter(f => f[1] === 'invoice_description');
  assert.deepStrictEqual(suDescrizione, [],
    'la descrizione non deve finire in un filtro di URL: ' + JSON.stringify(suDescrizione));
});

test('3. filtra per fornitore e per confirmed', async () => {
  const sb = fakeSb(RIGHE);
  await vplFetchLinksByDescription(sb, 'Global Gourmet Foods', [SALAME]);
  assert.ok(sb._q.filtri.some(f => f[0] === 'eq' && f[1] === 'vendor' && f[2] === 'Global Gourmet Foods'));
  assert.ok(sb._q.filtri.some(f => f[0] === 'eq' && f[1] === 'confirmed' && f[2] === true));
});

test('4. confirmedOnly false salta il filtro confirmed', async () => {
  const sb = fakeSb(RIGHE);
  await vplFetchLinksByDescription(sb, 'V', [SALAME], { confirmedOnly: false });
  assert.ok(!sb._q.filtri.some(f => f[1] === 'confirmed'));
});

test('5. scarta le righe non richieste', async () => {
  const sb = fakeSb(RIGHE);
  const { data } = await vplFetchLinksByDescription(sb, 'V', [SALAME]);
  assert.strictEqual(data.length, 1);
  assert.strictEqual(data[0].ingredient_id, 'i6');
});

test('6. lista vuota: nessuna query, nessuna riga', async () => {
  const sb = fakeSb(RIGHE);
  const { data } = await vplFetchLinksByDescription(sb, 'V', []);
  assert.deepStrictEqual(data, []);
  assert.deepStrictEqual(sb._q.filtri, [], 'non deve nemmeno interrogare il database');
});

test('7. null e stringhe vuote sono ignorate', async () => {
  const sb = fakeSb(RIGHE);
  const { data } = await vplFetchLinksByDescription(sb, 'V', [null, '', SALAME, undefined]);
  assert.strictEqual(data.length, 1);
});

test('8. un errore del database viene propagato, non nascosto', async () => {
  const sb = { from() { return { select(){return this;}, eq(){return this;},
    then(r){ return Promise.resolve({ data:null, error:{ message:'boom' } }).then(r); } }; } };
  const { data, error } = await vplFetchLinksByDescription(sb, 'V', [SALAME]);
  assert.deepStrictEqual(data, []);
  assert.strictEqual(error.message, 'boom');
});

test('9. nessun .in(\'invoice_description\') resta nel repository', () => {
  const root = path.join(__dirname, '..');
  const files = [
    'js/vendor-documents-review.js',
    'js/invoice.js',
    'edge-functions/vendor-doc-auto-import/index.ts',
  ];
  const colpevoli = [];
  for (const f of files) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    src.split('\n').forEach((riga, n) => {
      // le righe di PARSER_SOURCES sono la COPIA incorporata dei moduli
      // condivisi: contengono il testo del commento, non una chiamata.
      if (/^\s*"[a-z0-9-]+":\s*"/.test(riga)) return;
      if (/\.in\(\s*['"]invoice_description['"]/.test(riga)) colpevoli.push(f + ':' + (n + 1));
    });
  }
  assert.deepStrictEqual(colpevoli, [],
    'questi punti filtrano ancora per descrizione:\n  ' + colpevoli.join('\n  '));
});

test('10. le due copie del blocco sono identiche, byte per byte', () => {
  const root = path.join(__dirname, '..');
  const A = 'js/vendor-parsers/link-lookup.js';              // la carica il worker
  const B = 'js/vendor-documents-review.js';                 // la carica il browser
  const START = '// ── MARKER:LINK_LOOKUP_START ──';
  const END   = '// ── MARKER:LINK_LOOKUP_END ──';

  const estrai = (f) => {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const i = src.indexOf(START), j = src.indexOf(END);
    assert.ok(i >= 0 && j > i, 'marker non trovati in ' + f);
    return src.slice(i, j + END.length);
  };

  const a = estrai(A), b = estrai(B);
  assert.ok(a.length > 300, 'blocco troppo corto: estrazione sbagliata');
  assert.strictEqual(a, b,
    'le due copie di vplFetchLinksByDescription sono divergenti.\n' +
    'La regola vive una volta sola: aggiorna entrambe, e rigenera\n' +
    'PARSER_SOURCES["link-lookup"] nel worker.');
});

test('11. la copia incorporata nel worker è aggiornata', () => {
  const root = path.join(__dirname, '..');
  const modulo = fs.readFileSync(path.join(root, 'js/vendor-parsers/link-lookup.js'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'edge-functions/vendor-doc-auto-import/index.ts'), 'utf8');
  const m = worker.match(/^  "link-lookup": ("(?:[^"\\]|\\.)*"),$/m);
  assert.ok(m, 'PARSER_SOURCES["link-lookup"] assente nel worker');
  assert.strictEqual(JSON.parse(m[1]), modulo,
    'la copia incorporata nel worker non corrisponde al modulo su disco: rigenerala');
});

test('12. il worker non filtra più per descrizione e usa il modulo', () => {
  const root = path.join(__dirname, '..');
  const worker = fs.readFileSync(path.join(root, 'edge-functions/vendor-doc-auto-import/index.ts'), 'utf8');
  const righe = worker.split('\n')
    .filter(r => !/^\s*"[a-z0-9-]+":\s*"/.test(r));            // esclude PARSER_SOURCES
  const colpevoli = righe.filter(r => /\.in\(\s*['"]invoice_description['"]/.test(r));
  assert.deepStrictEqual(colpevoli, [], 'il worker filtra ancora per descrizione');
  const usi = righe.filter(r => /linkLookup\.vplFetchLinksByDescription/.test(r));
  assert.strictEqual(usi.length, 4, 'attesi 4 punti di lettura nel worker, trovati ' + usi.length);
});
