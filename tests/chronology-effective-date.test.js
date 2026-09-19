// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 52B — la chronology guard non si fida piu' del solo
// ingredient_vendors.last_invoice_date.
//
// MICRO-TASK 52A: 49 righe su 98 avevano quel campo divergente dalla
// realta', 32 lo avevano NULL. Con NULL chronologyAllows ritornava true
// incondizionatamente: una fattura del 26 giugno rigiocata oggi poteva
// sovrascrivere un prezzo di settembre.
//
// La data autorevole ora e':
//   effective = MAX(last_invoice_date salvata, ultima invoice_date persistita)
//
// `node tests/chronology-effective-date.test.js`
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const { chronologyAllows, effectiveLastDate } = require('../pure_logic.cjs');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); }
}

// Decisione completa: come la usano i tre call-site.
function decide(stored, authoritative, incoming) {
  return chronologyAllows(effectiveLastDate(stored, authoritative), incoming);
}

// ── I casi obbligatori della specifica ───────────────────────────

test('1. stored NULL, ultima fattura Sep 17, incoming Jun 26 -> BLOCK', () => {
  assert.strictEqual(effectiveLastDate(null, '2026-09-17'), '2026-09-17');
  assert.strictEqual(decide(null, '2026-09-17', '2026-06-26'), false);
  // regressione storica: prima del fix passava
  assert.strictEqual(chronologyAllows(null, '2026-06-26'), true,
    'il vecchio comportamento con NULL lasciava passare — e questo era il bug');
});

test('2. stored Sep 14, ultima fattura Sep 17, incoming Sep 15 -> BLOCK', () => {
  assert.strictEqual(effectiveLastDate('2026-09-14', '2026-09-17'), '2026-09-17');
  assert.strictEqual(decide('2026-09-14', '2026-09-17', '2026-09-15'), false);
  // prima del fix la sola data salvata lo lasciava passare
  assert.strictEqual(chronologyAllows('2026-09-14', '2026-09-15'), true);
});

test('3. ultima Sep 17, incoming Sep 18 stesso prezzo -> ALLOW', () => {
  assert.strictEqual(decide('2026-09-14', '2026-09-17', '2026-09-18'), true);
  // Il prezzo identico non entra nella decisione: la guardia e' solo
  // temporale, e last_invoice_date avanza comunque (il campo sta dentro
  // `fields`, scritto a ogni update consentito).
});

test('4. ultima Sep 17, incoming Sep 18 prezzo diverso -> ALLOW', () => {
  assert.strictEqual(decide('2026-08-31', '2026-09-17', '2026-09-18'), true);
});

test('5. incoming Sep 16 con ultima Sep 17 -> BLOCK, nessuna regressione', () => {
  assert.strictEqual(decide('2026-08-31', '2026-09-17', '2026-09-16'), false);
  assert.strictEqual(decide(null, '2026-09-17', '2026-09-16'), false);
});

test('6. stesso giorno dell ultima fattura -> ALLOW (>=, non >)', () => {
  assert.strictEqual(decide('2026-09-14', '2026-09-17', '2026-09-17'), true);
});

test('7. incoming senza data -> BLOCK, mai sovrascrive una riga datata', () => {
  assert.strictEqual(decide('2026-09-14', '2026-09-17', null), false);
  assert.strictEqual(decide(null, '2026-09-17', null), false);
});

test('8. nessuno storico e nessuna data salvata -> ALLOW (primo dato)', () => {
  assert.strictEqual(effectiveLastDate(null, null), null);
  assert.strictEqual(decide(null, null, '2026-06-26'), true,
    'una riga senza alcun acquisto persistito non ha nulla da proteggere');
});

// ── effectiveLastDate: vince sempre la piu' recente ──────────────

test('9. effectiveLastDate prende il massimo, in entrambi gli ordini', () => {
  assert.strictEqual(effectiveLastDate('2026-09-17', '2026-09-14'), '2026-09-17');
  assert.strictEqual(effectiveLastDate('2026-09-14', '2026-09-17'), '2026-09-17');
  assert.strictEqual(effectiveLastDate('2026-09-17', '2026-09-17'), '2026-09-17');
  assert.strictEqual(effectiveLastDate(null, '2026-09-17'), '2026-09-17');
  assert.strictEqual(effectiveLastDate('2026-09-17', null), '2026-09-17');
});

test('10. stringhe ISO: il confronto lessicografico e cronologico coincidono', () => {
  // Il guard confronta stringhe, non Date. Con YYYY-MM-DD e' equivalente.
  assert.strictEqual(effectiveLastDate('2026-09-09', '2026-09-10'), '2026-09-10');
  assert.strictEqual(effectiveLastDate('2026-08-31', '2026-09-01'), '2026-09-01');
  assert.strictEqual(effectiveLastDate('2025-12-31', '2026-01-01'), '2026-01-01');
});

// ── i casi reali misurati in MT52A ───────────────────────────────

test('11. caso reale Carrots: stored Aug 31, reale Sep 12, doc Jun 26 -> BLOCK', () => {
  assert.strictEqual(decide('2026-08-31', '2026-09-12', '2026-06-26'), false);
});

test('12. caso reale Mascarpone (stored NULL, reale Aug 19), doc Jun 26 -> BLOCK', () => {
  assert.strictEqual(decide(null, '2026-08-19', '2026-06-26'), false);
  assert.strictEqual(chronologyAllows(null, '2026-06-26'), true,
    'senza il fix questo documento di giugno vinceva');
});

test('13. il documento Hardie 07016705 (26 giugno) non vince su nessuna delle 6 righe', () => {
  const reali = ['2026-09-12','2026-09-14','2026-09-09','2026-08-19','2026-08-31','2026-06-19'];
  for (const r of reali) {
    assert.strictEqual(decide(null, r, '2026-06-26'), r <= '2026-06-26',
      'ultima reale ' + r + ' vs documento 2026-06-26');
  }
});

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
