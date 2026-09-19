// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 48 — Ben E. Keith buyer / order-owner guard.
// Plain Node, zero dipendenze: `node tests/bek-buyer-guard.test.js`
//
// BEK serve due flussi di ordini sullo STESSO Customer# FDF770366:
// la cucina e la sala. Misurato su 56 thread Gmail reali: Customer#,
// Branch, Customer Name, oggetto, mittente e destinatario sono IDENTICI
// su tutti. L'unico campo che cambia e' `Email:` nell'intestazione.
//
// Allow-list e FAIL CLOSED: solo il buyer cucina noto procede.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const P = require('../js/vendor-parsers/ben-e-keith-order-confirmation.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); }
}

const KITCHEN = 'raven_wolf_1510@yahoo.com';
const FOH     = 'zeno@zenosonthesquare.com';

// Intestazione reale, copiata dal corpo di una confirmation di produzione.
function header(email, salesOrder) {
  return 'Please do not reply to this message. Your order is confirmed and ready for delivery '
    + 'Sales Order # *' + (salesOrder || '0003243454') + '* '
    + "Customer Name *ZENO&apos;S ON THE SQUARE* "
    + 'Customer# *FDF770366* PO# ** Branch *FDF* Delivery Date *09/17/2026* '
    + 'Quantity *8 items/ 11 pieces* Order Total* *$638.45* '
    + (email === null ? '' : 'Email: *' + email + '* ')
    + 'ITEM# ITEM NAME BRAND PACK/SIZE PRICE ORDERED CONFIRMED STATUS';
}

// ── classifyBuyer ────────────────────────────────────────────────
test('1. buyer cucina -> kitchen (eligible)', () => {
  assert.strictEqual(P.classifyBuyer(KITCHEN), P.BUYER_KITCHEN);
  assert.strictEqual(P.BUYER_KITCHEN, 'kitchen');
});

test('2. buyer Zeno -> excluded, case-insensitive', () => {
  assert.strictEqual(P.classifyBuyer(FOH), P.BUYER_EXCLUDED);
  assert.strictEqual(P.classifyBuyer('ZENO@ZENOSONTHESQUARE.COM'), P.BUYER_EXCLUDED);
  assert.strictEqual(P.classifyBuyer('Zeno@ZenosOnTheSquare.Com'), P.BUYER_EXCLUDED);
});

test('3. whitespace normalizzato (trim), su entrambi i buyer', () => {
  assert.strictEqual(P.classifyBuyer('   ' + KITCHEN + '   '), P.BUYER_KITCHEN);
  assert.strictEqual(P.classifyBuyer('\t' + FOH + '\n'), P.BUYER_EXCLUDED);
  assert.strictEqual(P.normalizeBuyerEmail('  RAVEN_WOLF_1510@YAHOO.COM '), KITCHEN);
});

test('4. email mancante -> unknown (fail closed), mai kitchen', () => {
  for (const v of [null, undefined, '', '   ']) {
    assert.strictEqual(P.classifyBuyer(v), P.BUYER_UNKNOWN, 'valore: ' + JSON.stringify(v));
    assert.notStrictEqual(P.classifyBuyer(v), P.BUYER_KITCHEN);
  }
});

test('5. terza email sconosciuta -> unknown, NON assunta come Zeno', () => {
  for (const v of ['qualcunaltro@example.com', 'chef@zenosonthesquare.com',
                   'raven_wolf_1511@yahoo.com', 'zeno@gmail.com']) {
    assert.strictEqual(P.classifyBuyer(v), P.BUYER_UNKNOWN, 'valore: ' + v);
    assert.notStrictEqual(P.classifyBuyer(v), P.BUYER_EXCLUDED, v + ' non deve essere trattata come Zeno');
  }
});

test('6. nessun fuzzy: sottostringhe e domini simili non passano', () => {
  assert.strictEqual(P.classifyBuyer('raven_wolf_1510@yahoo.com.evil.tld'), P.BUYER_UNKNOWN);
  assert.strictEqual(P.classifyBuyer('xraven_wolf_1510@yahoo.com'), P.BUYER_UNKNOWN);
  assert.strictEqual(P.classifyBuyer('zeno@zenosonthesquare.co'), P.BUYER_UNKNOWN);
});

// ── estrazione dal corpo reale ───────────────────────────────────
test('7. extractBuyerEmail legge il campo Email: dall\u2019intestazione', () => {
  assert.strictEqual(P.extractBuyerEmail(header(KITCHEN)), KITCHEN);
  assert.strictEqual(P.extractBuyerEmail(header(FOH)), FOH);
  assert.strictEqual(P.extractBuyerEmail(header(null)), null);
});

// ── campi che NON devono influenzare la decisione ────────────────
test('8. Customer# identico non influenza il risultato', () => {
  const a = header(KITCHEN), b = header(FOH);
  assert.ok(a.indexOf('FDF770366') !== -1 && b.indexOf('FDF770366') !== -1,
    'entrambe le intestazioni portano lo stesso Customer#');
  assert.notStrictEqual(P.classifyBuyer(P.extractBuyerEmail(a)),
                        P.classifyBuyer(P.extractBuyerEmail(b)));
});

test('9. Customer Name / Branch / oggetto identici non influenzano', () => {
  const a = header(KITCHEN), b = header(FOH);
  for (const token of ['ZENO&apos;S ON THE SQUARE', 'Branch *FDF*', 'Sales Order #']) {
    assert.ok(a.indexOf(token) !== -1 && b.indexOf(token) !== -1, 'token comune: ' + token);
  }
  assert.strictEqual(P.classifyBuyer(P.extractBuyerEmail(a)), P.BUYER_KITCHEN);
  assert.strictEqual(P.classifyBuyer(P.extractBuyerEmail(b)), P.BUYER_EXCLUDED);
});

test('10. la parola "zeno" nel Customer Name non esclude un ordine cucina', () => {
  // Customer Name contiene "ZENO'S" su OGNI documento, anche quelli cucina:
  // se il guard guardasse li' invece che al campo Email:, scarterebbe tutto.
  const a = header(KITCHEN);
  assert.ok(/zeno/i.test(a), 'il nome cliente contiene comunque "zeno"');
  assert.strictEqual(P.classifyBuyer(P.extractBuyerEmail(a)), P.BUYER_KITCHEN);
});

// ── parse() completo: buyer_email e buyer_class nell'output ──────
test('11. parse() espone buyer_email e buyer_class', () => {
  const r = P.parse(header(KITCHEN));
  assert.strictEqual(r.buyer_email, KITCHEN);
  assert.strictEqual(r.buyer_class, P.BUYER_KITCHEN);

  const z = P.parse(header(FOH));
  assert.strictEqual(z.buyer_email, FOH);
  assert.strictEqual(z.buyer_class, P.BUYER_EXCLUDED);

  const u = P.parse(header(null));
  assert.strictEqual(u.buyer_email, null);
  assert.strictEqual(u.buyer_class, P.BUYER_UNKNOWN);
});

// ── i due documenti reali citati nella specifica ─────────────────
test('12. canary 0003243454 -> kitchen eligible', () => {
  const r = P.parse(header(KITCHEN, '0003243454'));
  assert.strictEqual(r.document_number, '0003243454');
  assert.strictEqual(r.buyer_class, P.BUYER_KITCHEN);
});

test('13. 0003239646 (Zeno reale) -> excluded', () => {
  const r = P.parse(header(FOH, '0003239646'));
  assert.strictEqual(r.document_number, '0003239646');
  assert.strictEqual(r.buyer_class, P.BUYER_EXCLUDED);
});

test('14. le due costanti sono quelle confermate da Max', () => {
  assert.strictEqual(P.BEK_BUYER_KITCHEN, KITCHEN);
  assert.strictEqual(P.BEK_BUYER_FOH, FOH);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
