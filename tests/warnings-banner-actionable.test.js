// ══════════════════════════════════════════════════════════════════
// Home Warnings Banner — non-actionable filter tests (BOH OS Task 2)
// Plain Node, no framework: `node tests/warnings-banner-actionable.test.js`
//
// js/warnings-banner.js è codice browser (window, document) e non è
// require()-abile direttamente. Come tests/prep-station-visibility.test.js,
// questo test legge il sorgente reale, estrae la funzione/costante di
// interesse con un marker esplicito ed esegue quel codice esatto —
// non una riscrittura della logica.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const WB_JS = path.join(__dirname, '..', 'js', 'warnings-banner.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

// Estrae il blocco reale VD_WARNING_NONACTIONABLE_CODES + isVdWarningActionable
// da js/warnings-banner.js e lo esegue, restituendo la funzione vera.
function loadRealFilter() {
  const src = fs.readFileSync(WB_JS, 'utf8');
  const startMarker = "const VD_WARNING_NONACTIONABLE_CODES = ['OQR-006', 'INV-PACKCT-001'];";
  const endMarker = 'function warnSeverity(code) {';
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    throw new Error('marker non trovati in js/warnings-banner.js — la funzione isVdWarningActionable è cambiata di forma?');
  }
  const snippet = src.slice(start, end);
  const fn = new Function(snippet + '\nreturn { isVdWarningActionable, VD_WARNING_NONACTIONABLE_CODES };');
  return fn();
}

// Verifica che il filtro sia effettivamente collegato al loop che legge
// vendor_documents.warnings (non solo definito ma inutilizzato).
function loopCallsFilter() {
  const src = fs.readFileSync(WB_JS, 'utf8');
  return src.includes('if (!isVdWarningActionable(w.code)) continue;');
}

console.log('\nWarnings Banner — non-actionable filter test run\n');

const { isVdWarningActionable, VD_WARNING_NONACTIONABLE_CODES } = loadRealFilter();

// Riproduce lo stesso ciclo di loadWarningsBanner() (sezione "2. Leggi
// vendor_documents.warnings JSONB") su un array di warning grezzi, usando
// la funzione reale appena estratta dal sorgente.
function filterVdWarnings(rawWarnings) {
  return rawWarnings.filter(w => w.code && isVdWarningActionable(w.code));
}

// ── T1 — OQR-006 nascosto ────────────────────────────────────────
test('T1: documento pending con solo OQR-006 → nessuna card', () => {
  const doc = [{ code: 'OQR-006', item: 'FLOWER MARIGOLD', message: 'Count-based: FLOWER MARIGOLD (50 CT)' }];
  assert.strictEqual(filterVdWarnings(doc).length, 0);
});

// ── T2 — INV-PACKCT-001 nascosto ─────────────────────────────────
test('T2: documento pending con solo INV-PACKCT-001 → nessuna card', () => {
  const doc = [{ code: 'INV-PACKCT-001', item: 'PARSLEY FLAT ITALIAN', message: 'Count-based: PARSLEY FLAT ITALIAN (6 CT)' }];
  assert.strictEqual(filterVdWarnings(doc).length, 0);
});

// ── T3 — warning azionabile preservato ───────────────────────────
test('T3: documento pending con warning azionabile (OQR-007) → resta visibile', () => {
  const doc = [{ code: 'OQR-007', item: 'TOMATO HIIROS CHERRY ON VINE', message: 'Qty mismatch: ordered 3, shipped 2' }];
  const result = filterVdWarnings(doc);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].code, 'OQR-007');
});

// ── T4 — array misto: solo l'azionabile sopravvive ───────────────
test('T4: array misto (OQR-006 + INV-PACKCT-001 + azionabile) → mostra solo quello azionabile', () => {
  const doc = [
    { code: 'OQR-006', item: 'FLOWER MARIGOLD', message: 'Count-based: FLOWER MARIGOLD (50 CT)' },
    { code: 'INV-PACKCT-001', item: 'LEMON CHOICE', message: 'Count-based: LEMON CHOICE (95 CT)' },
    { code: 'OQR-002', item: 'TOMATO CHERRY ON THE VINE', message: 'Substitution: ordered 0, received 1' },
  ];
  const result = filterVdWarnings(doc);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].code, 'OQR-002');
});

// ── T5 — invoice_warnings (status='open') non toccata ────────────
test("T5: la query invoice_warnings status='open' resta invariata e non usa il nuovo filtro", () => {
  const src = fs.readFileSync(WB_JS, 'utf8');
  const marker =
    "sb.from('invoice_warnings')\n" +
    "      .select('id,code,severity,vendor,document_id,item_description,message,created_at')\n" +
    "      .eq('status', 'open')";
  assert.ok(src.includes(marker), 'la query invoice_warnings status=open deve restare identica a prima del fix');

  const startQ1 = src.indexOf('1. Leggi invoice_warnings');
  const startQ2 = src.indexOf('2. Leggi vendor_documents.warnings');
  assert.ok(startQ1 > -1 && startQ2 > startQ1, 'sezioni attese non trovate — il file è cambiato di forma?');
  const q1Block = src.slice(startQ1, startQ2);
  assert.ok(!q1Block.includes('isVdWarningActionable'), 'il filtro non deve applicarsi alla fonte invoice_warnings, solo a vendor_documents.warnings');
});

// ── Verifica di collegamento: il filtro è davvero usato nel loop ────
test('il filtro è collegato al loop che legge vendor_documents.warnings (non solo definito)', () => {
  assert.ok(loopCallsFilter(), 'isVdWarningActionable deve essere chiamato dentro il loop di vendor_documents.warnings');
});

// ── Verifica minimo richiesto dal task ───────────────────────────
test('la lista di esclusione contiene esattamente i 2 codici minimi richiesti dal task', () => {
  assert.ok(VD_WARNING_NONACTIONABLE_CODES.includes('OQR-006'));
  assert.ok(VD_WARNING_NONACTIONABLE_CODES.includes('INV-PACKCT-001'));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
