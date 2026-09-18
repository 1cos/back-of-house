// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 45 — detectVendor(): equivalenza semantica fra la vecchia
// forma quadratica e la nuova forma lineare.
// Plain Node, zero dipendenze: `node tests/walmart-detectvendor-linear-parity.test.js`
//
// MICRO-TASK 44 ha misurato che i due pattern Walmart costavano ~705 ms
// su ~716 ms di parse() per una email BEK da 29.865 caratteri, con
// scaling quadratico (4k 6,3ms / 8k 25,8ms / 16k 93,2ms / 29,8k 329,2ms).
// Causa: `walmart` è la PRIMA chiave di VENDORS, quindi ogni documento di
// ogni fornitore pagava entrambe le lookahead.
//
// Questo file tiene in vita l'ORACOLO (la vecchia implementazione, copiata
// verbatim) e dimostra che la nuova produce lo stesso vendor su una
// matrice ampia di casi. L'oracolo NON va rimosso: è la prova.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const parsers = require('../js/vendor-parsers/index.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); }
}

// ── ORACOLO: la forma esatta pre-MT45 ─────────────────────────────
// Copiata verbatim da js/vendor-parsers/index.js @ 8cac554.
const OLD_WALMART_PATTERNS = [
  /(?=[\s\S]*walmart\s*business)(?=[\s\S]*trevipay)/i,
  /(?=[\s\S]*trevipay)(?=[\s\S]*\bBuyer\b)(?=[\s\S]*Invoice Details)/i,
];
function oldIsWalmart(rawText) {
  const text = rawText || '';
  return OLD_WALMART_PATTERNS.some(re => re.test(text));
}

// La nuova: `walmart` resta la prima chiave di VENDORS e nessun altro
// vendor può restituire 'walmart', quindi questo è esattamente il
// predicato Walmart nuovo.
function newIsWalmart(rawText) {
  return parsers.detectVendor(rawText) === 'walmart';
}

// ── Matrice dei casi ──────────────────────────────────────────────
const FILLER = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(400);

const CASES = [
  // — i due segnali combinati, nelle forme reali —
  ['W1 canonico',                'Walmart Business\nInvoice\nTreviPay LLC\n'],
  ['W1 minuscolo',               'walmart business ... trevipay'],
  ['W1 MAIUSCOLO',               'WALMART BUSINESS ... TREVIPAY'],
  ['W1 MiXeD',                   'WaLmArT bUsInEsS ... TrEvIpAy'],
  ['W1 ordine invertito',        'TreviPay LLC appears first, Walmart Business later'],
  ['W1 senza spazio',            'walmartbusiness ... trevipay'],
  ['W1 spazi multipli',          'Walmart    Business ... TreviPay'],
  ['W1 newline fra le parole',   'Walmart\nBusiness ... TreviPay'],
  ['W1 termini molto distanti',  'Walmart Business' + FILLER + 'TreviPay'],
  ['W1 distanti, invertiti',     'TreviPay' + FILLER + 'Walmart Business'],

  // — W1 incompleto: NON deve matchare —
  ['solo Walmart Business',      'Walmart Business invoice, no payment processor named'],
  ['solo TreviPay',              'TreviPay LLC statement'],
  ['solo "walmart"',             'walmart supercenter receipt'],
  ['walmart senza business',     'Walmart Inc ... trevipay'],

  // — W2: tre segnali —
  ['W2 canonico',                'TreviPay\nBuyer\nInvoice Details\n'],
  ['W2 ordine sparso',           'Invoice Details ... Buyer ... TreviPay'],
  ['W2 distanti',                'TreviPay' + FILLER + 'Buyer' + FILLER + 'Invoice Details'],
  ['W2 manca Buyer',             'TreviPay ... Invoice Details'],
  ['W2 manca Invoice Details',   'TreviPay ... Buyer'],
  ['W2 manca TreviPay',          'Buyer ... Invoice Details'],
  ['W2 "Buyers" (no boundary)',  'TreviPay ... Buyers ... Invoice Details'],
  ['W2 "Rebuyer" (no boundary)', 'TreviPay ... Rebuyer ... Invoice Details'],
  ['W2 "Buyer:" (boundary ok)',  'TreviPay ... Buyer: ACME ... Invoice Details'],
  ['W2 "Invoice  Details" x2sp', 'TreviPay ... Buyer ... Invoice  Details'],
  ['W2 case-insensitive',        'trevipay ... BUYER ... invoice details'],

  // — prosa che somiglia ma non basta —
  ['prosa: business + pay',      'Our business partner will pay the invoice details to the buyer'],
  ['prosa: invoice generico',    'Invoice Number 12345 for the buyer'],
  ['prosa: walmart + buyer',     'Walmart Business ... Buyer ... Invoice Details'],
  ['vuoto',                      ''],
  ['null',                       null],
  ['undefined',                  undefined],

  // — altri vendor: devono restare intatti —
  ["Hardie's",                   "Hardie's Fresh Foods INVOICE/POD 06991299"],
  ['Dairyland',                  'DAIRYLAND PRODUCE delivery invoice'],
  ["Chefs Whse",                 "CHEFS WHSE invoice"],
  ['FreshPoint',                 'FRESHPOINT DALLAS Invoice No. 123'],
  ['Fruge',                      'FRUGE SEAFOOD invoice'],
  ['BEK testo',                  'BEN E. KEITH invoice'],
  ['ignoto',                     'Some random unrelated document'],
];

// Documenti reali, non sintetici.
const bekFixtures = require('./fixtures/bek-html-real-shape.js');
for (const key of ['BEK_OPERATIONAL_SAME_SO', 'BEK_ACKNOWLEDGEMENT', 'BEK_SHORT_FILL_CASE_D']) {
  if (typeof bekFixtures[key] === 'string') {
    CASES.push(['BEK HTML reale: ' + key, bekFixtures[key]]);
  }
}

// ── 1. Equivalenza del predicato Walmart su tutta la matrice ──────
test('1. il predicato Walmart vecchio e nuovo coincidono su tutti i casi', () => {
  const diffs = [];
  for (const [name, text] of CASES) {
    const o = oldIsWalmart(text);
    const n = newIsWalmart(text);
    if (o !== n) diffs.push(`${name}: OLD=${o} NEW=${n}`);
  }
  assert.deepStrictEqual(diffs, [], 'divergenze:\n  ' + diffs.join('\n  '));
});

// ── 2. detectVendor completo: stesso vendor su tutta la matrice ───
// Quando il predicato Walmart non scatta, la vecchia detectVendor
// proseguiva sulle chiavi successive, che MT45 non ha toccato: quindi
// il vendor atteso è esattamente quello che restituisce la nuova.
test('2. detectVendor restituisce un vendor coerente col predicato', () => {
  for (const [name, text] of CASES) {
    const v = parsers.detectVendor(text);
    if (oldIsWalmart(text)) {
      assert.strictEqual(v, 'walmart', `${name}: atteso walmart, ottenuto ${v}`);
    } else {
      assert.notStrictEqual(v, 'walmart', `${name}: non doveva essere walmart`);
    }
  }
});

// ── 3. I vendor non-Walmart restano identici ──────────────────────
test('3. gli altri vendor non sono cambiati', () => {
  assert.strictEqual(parsers.detectVendor("Hardie's Fresh Foods INVOICE/POD 06991299"), 'hardies');
  assert.strictEqual(parsers.detectVendor('DAIRYLAND PRODUCE delivery invoice'), 'hardies');
  assert.strictEqual(parsers.detectVendor('FRESHPOINT DALLAS Invoice No. 123'), 'freshpoint');
  assert.strictEqual(parsers.detectVendor('FRUGE SEAFOOD invoice'), 'fruge');
  assert.strictEqual(parsers.detectVendor('BEN E. KEITH invoice'), 'bek');
  assert.strictEqual(parsers.detectVendor('Some random unrelated document'), 'unknown');
});

// ── 4. Ordine di VENDORS invariato: walmart resta il primo ────────
test('4. walmart resta la prima chiave di VENDORS', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'vendor-parsers', 'index.js'), 'utf8');
  const keys = [...src.matchAll(/^  ([a-z]+): \{$/gm)].map(m => m[1]);
  assert.deepStrictEqual(keys, ['walmart', 'hardies', 'freshpoint', 'fruge', 'bek']);
});

// ── 5. Le lookahead quadratiche non esistono più nella sorgente ───
test('5. nessuna lookahead (?=[\\s\\S]*…) residua in vendor-parsers/index.js', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'vendor-parsers', 'index.js'), 'utf8');
  const code = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/\(\?=\[\\s\\S\]\*/.test(code),
    'la forma quadratica è ancora presente nel codice (non nei commenti)');
});

// ── 6. Costo lineare, non quadratico ──────────────────────────────
// Soglia volutamente larga (non un threshold al millisecondo): la forma
// quadratica faceva ×3,5–4 a ogni raddoppio, quella lineare sta sotto ×2,5.
test('6. detectVendor scala linearmente col crescere del documento', () => {
  const unit = 'Ben E. Keith order confirmation row filler text 12345 ';
  function timeAt(chars) {
    const text = unit.repeat(Math.ceil(chars / unit.length)).slice(0, chars);
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 20; i++) parsers.detectVendor(text);
    return Number(process.hrtime.bigint() - t0) / 1e6 / 20;
  }
  timeAt(4000); // warm-up
  const t8  = timeAt(8000);
  const t32 = timeAt(32000);
  // 4x l'input: lineare ~4x, quadratico ~16x. Margine molto ampio.
  assert.ok(t32 < t8 * 8 + 1,
    `scaling non lineare: 8k=${t8.toFixed(3)}ms 32k=${t32.toFixed(3)}ms`);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
