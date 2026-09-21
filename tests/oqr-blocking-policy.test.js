// ─────────────────────────────────────────────────────────────────────
// INV08H — quando un warning di quantita' e' una domanda vera
//
// Fino a INV08B il writer usava la quantita' ORDINATA: un "ordered 3 /
// shipped 2" era una domanda vera, perche' il documento diceva una cosa
// e il sistema ne scriveva un'altra. Da INV08B il writer usa il
// RICEVUTO, da INV08B.1 le righe a consegna zero non diventano acquisti,
// da INV08E ogni SKU Hardie's ha identita' stabile. La domanda si e'
// svuotata: la fattura dichiara da sola cosa e' arrivato e quanto e'
// costato.
//
// Questi test ancorano la PREDICATE, non i codici. Ogni caso in cui il
// dato manca, si contraddice o non quadra deve continuare a bloccare, e
// l'assenza di contesto vale come "non dimostrato".
//
// Le funzioni UI sono ESTRATTE DAL SORGENTE, non ricopiate.
// ─────────────────────────────────────────────────────────────────────
'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const ROOT   = path.join(__dirname, '..');
const WSRC   = fs.readFileSync(path.join(ROOT, 'edge-functions/vendor-doc-auto-import/index.ts'), 'utf8');
const VDRSRC = fs.readFileSync(path.join(ROOT, 'js/vendor-documents-review.js'), 'utf8');

const W = require(path.join(ROOT, 'pure_logic.cjs'));

let pass = 0, fail = 0;
const queue = [];
function test(n, f) { queue.push([n, f]); }

function grab(src, start, end) {
  const s = src.indexOf(start);
  assert.ok(s >= 0, 'non trovato nel sorgente: ' + start);
  const e = src.indexOf(end, s);
  assert.ok(e > s, 'fine non trovata dopo: ' + start);
  return src.slice(s, e + end.length);
}

// ── le tre funzioni UI, prese dal file vero ──────────────────────────
const UI_BLOCK = grab(VDRSRC,
  'const VDR_TOTAL_TOLERANCE = 0.02;',
  'window.vdrBuildQtyContext                   = vdrBuildQtyContext;');
const UI_SANDBOX = { window: {} };
new Function('window', UI_BLOCK + '\nwindow.__t = { vdrLineEconomicallyDeterminate, vdrDocumentEconomicallyDeterministic, vdrQtyWarningInformational, vdrBuildQtyContext };')(UI_SANDBOX.window);
const UI = UI_SANDBOX.window.__t;

// ── dati di comodo ───────────────────────────────────────────────────
const line = (o) => Object.assign({
  vendor_sku: '00001', description: 'HERB BASIL',
  qty_ordered: 1, qty_received: 1, unit_price: 9, amount: 9,
}, o);

function doc(items, extra) {
  const total = Math.round(items.reduce((s, i) => s + (i.amount || 0), 0) * 100) / 100;
  return Object.assign({ vendor: "Hardie's", document_type: 'invoice', items, total, subtotal: total }, extra || {});
}

const ctxOf = (pj, skus) => ({
  deterministic: W.vdaiDocumentEconomicallyDeterministic(pj),
  resolvedSkus: new Set(skus),
  resolvedDescs: new Set(),
});

const blocks = (item, pj, skus, code) =>
  W.isBlockingWarning({ code: code || 'OQR-007' }, item, {}, ctxOf(pj, skus));

// ═════════════════════════════════════════════════════════════════════
// A. I NOVE CASI DELLA REGOLA
// ═════════════════════════════════════════════════════════════════════

test('1. ordinato 3, ricevuto 2, addebitati 2 — non blocca', () => {
  const it = line({ vendor_sku: '05840', qty_ordered: 3, qty_received: 2, unit_price: 10, amount: 20 });
  const pj = doc([it, line({ vendor_sku: '00907' })]);
  assert.strictEqual(blocks(it, pj, ['05840', '00907']), false);
});

test('2. ordinato 1, ricevuto 0, addebitato 0 — non blocca, e non produce riga', () => {
  const zero = line({ vendor_sku: '25271', qty_ordered: 1, qty_received: 0, amount: 0, purchasable: false });
  const pj = doc([zero, line({ vendor_sku: '00907' })]);
  assert.strictEqual(blocks(zero, pj, ['25271', '00907']), false, 'il warning non deve bloccare');
  // e la riga a consegna zero resta fuori dalla contabilita' (INV08B.1)
  assert.strictEqual(
    W.vdaiIsZeroDeliveredLegacy("Hardie's Fresh Foods / Dairyland Produce",
      { qty_received: 0, amount: 0, vendor_sku: '25271' }), true);
});

test('3. sostituzione completa e mappata — OQR-002 non blocca', () => {
  const sub = line({ vendor_sku: '01177', description: 'FLOWER EDIBLE ASSORTED',
                     qty_ordered: 0, qty_received: 2, unit_price: 25.39, amount: 50.78, is_substitution: true });
  const orig = line({ vendor_sku: '05840', qty_ordered: 2, qty_received: 0, amount: 0 });
  const pj = doc([sub, orig]);
  assert.strictEqual(blocks(sub, pj, ['01177', '05840'], 'OQR-002'), false);
});

test('4. sostituzione con replacement NON mappato — BLOCCA', () => {
  const sub = line({ vendor_sku: '99999', description: 'QUALCOSA DI IGNOTO',
                     qty_ordered: 0, qty_received: 2, unit_price: 25.39, amount: 50.78 });
  const pj = doc([sub, line({ vendor_sku: '05840' })]);
  assert.strictEqual(blocks(sub, pj, ['05840'], 'OQR-002'), true,
    'identita' + "'" + ' ignota: non si sa che cosa e' + "'" + ' stato consegnato');
});

test('5. qty_received assente (NULL) — BLOCCA', () => {
  const it = line({ vendor_sku: '05840', qty_received: null, amount: 20 });
  const pj = doc([it, line({ vendor_sku: '00907' })]);
  assert.strictEqual(blocks(it, pj, ['05840', '00907']), true);
  assert.strictEqual(UI.vdrLineEconomicallyDeterminate(it), false, 'NULL non e' + "'" + ' zero');
});

test('6. riga che si contraddice (ricevuto 0, addebitato > 0) — BLOCCA', () => {
  const it = line({ vendor_sku: '05840', qty_ordered: 2, qty_received: 0, amount: 18.29 });
  const pj = doc([it, line({ vendor_sku: '00907' })]);
  assert.strictEqual(blocks(it, pj, ['05840', '00907']), true);
});

test('7. la somma delle righe non quadra col totale — BLOCCA', () => {
  const it = line({ vendor_sku: '05840', qty_ordered: 3, qty_received: 2, amount: 20 });
  const pj = doc([it, line({ vendor_sku: '00907' })]);
  pj.total = pj.subtotal = pj.total + 100;          // manca una riga
  assert.strictEqual(W.vdaiDocumentEconomicallyDeterministic(pj), false);
  assert.strictEqual(blocks(it, pj, ['05840', '00907']), true);
});

test('8. ambiguita: totale dichiarato assente — BLOCCA', () => {
  const it = line({ vendor_sku: '05840', qty_ordered: 3, qty_received: 2, amount: 20 });
  const pj = doc([it, line({ vendor_sku: '00907' })]);
  pj.total = null; pj.subtotal = null;
  assert.strictEqual(blocks(it, pj, ['05840', '00907']), true,
    'senza totale dichiarato non esiste prova di quadratura');
});

test('9. identita non risolta sulla riga del warning — BLOCCA', () => {
  const it = line({ vendor_sku: '05840', qty_ordered: 3, qty_received: 2, amount: 20 });
  const pj = doc([it, line({ vendor_sku: '00907' })]);
  assert.strictEqual(blocks(it, pj, ['00907']), true);
});

test('10. fattura pulita: nessun warning di quantita, comportamento invariato', () => {
  const pj = doc([line({ vendor_sku: '00907' }), line({ vendor_sku: '05840' })]);
  // i codici che bloccavano prima bloccano ancora, con o senza contesto
  const ctx = ctxOf(pj, ['00907', '05840']);
  for (const code of ['DOC-TOTAL-001', 'PARSE_ERROR_NO_LINES', 'BEK_NO_SALES_ORDER',
                      'BEK_REVISION_UNKNOWN', 'BEK_REVISION_AFTER_IMPORT', 'OQR-001', 'OQR-009']) {
    assert.strictEqual(W.isBlockingWarning({ code }, null, {}, ctx), true, code + ' deve ancora bloccare');
  }
  for (const code of ['PARSE_ERROR', 'UNKNOWN_VENDOR', 'UNKNOWN_DOC_TYPE', 'NO_PARSER', 'PARSER_ERROR']) {
    assert.strictEqual(W.isBlockingWarning({ code }, null, {}, ctx), false, code + ' resta infoOnly');
  }
  // OQR-006 conserva la sua logica, contesto o no
  assert.strictEqual(W.isBlockingWarning({ code: 'OQR-006' }, { pack_description: '50 CT' }, {}, ctx), false);
  assert.strictEqual(W.isBlockingWarning({ code: 'OQR-006' }, { pack_description: '5#' }, {}, ctx), true);
});

// ═════════════════════════════════════════════════════════════════════
// B. FAIL CLOSED — l'assenza di contesto non e' un permesso
// ═════════════════════════════════════════════════════════════════════

test('11. senza contesto i due codici bloccano come prima', () => {
  const it = line({ vendor_sku: '05840', qty_ordered: 3, qty_received: 2, amount: 20 });
  for (const code of ['OQR-002', 'OQR-007']) {
    assert.strictEqual(W.isBlockingWarning({ code }, it, {}), true, code + ' senza contesto');
    assert.strictEqual(W.isBlockingWarning({ code }, it, {}, null), true, code + ' con contesto null');
    assert.strictEqual(W.isBlockingWarning({ code }, it, {}, { deterministic: true }), true,
      code + ' con contesto senza mappa identita');
  }
});

test('12. warning di quantita SENZA riga (solo doc-level) — BLOCCA', () => {
  const pj = doc([line({ vendor_sku: '00907' })]);
  assert.strictEqual(W.isBlockingWarning({ code: 'OQR-007' }, null, {}, ctxOf(pj, ['00907'])), true);
});

test('13. un parser che quadra per conto suo non offre prova (totals_reconciled)', () => {
  const it = line({ vendor_sku: '05840', qty_ordered: 3, qty_received: 2, amount: 20 });
  const pj = doc([it, line({ vendor_sku: '00907' })], { totals_reconciled: true });
  assert.strictEqual(W.vdaiDocumentEconomicallyDeterministic(pj), false,
    'BEK: la somma degli amount NON e' + "'" + ' il totale dichiarato, per costruzione');
  assert.strictEqual(blocks(it, pj, ['05840', '00907']), true);
});

test('14. una sola riga indeterminata avvelena tutto il documento', () => {
  const buona = line({ vendor_sku: '05840', qty_ordered: 3, qty_received: 2, amount: 20 });
  const rotta = line({ vendor_sku: '00907', qty_received: null, amount: 9 });
  const pj = doc([buona, rotta]);
  assert.strictEqual(W.vdaiDocumentEconomicallyDeterministic(pj), false);
  assert.strictEqual(blocks(buona, pj, ['05840', '00907']), true,
    'il warning della riga BUONA resta bloccante finche' + "'" + ' il documento non e' + "'" + ' sano');
});

test('15. ricevuto > 0 ma addebitato 0 — BLOCCA (forma del difetto INV08B)', () => {
  const it = line({ vendor_sku: '05840', qty_ordered: 2, qty_received: 2, amount: 0 });
  assert.strictEqual(W.vdaiLineEconomicallyDeterminate(it), false);
  assert.strictEqual(UI.vdrLineEconomicallyDeterminate(it), false);
});

test('16. importi negativi non passano da questa porta (sono credits)', () => {
  assert.strictEqual(W.vdaiLineEconomicallyDeterminate(line({ qty_received: 1, amount: -9 })), false);
  assert.strictEqual(W.vdaiLineEconomicallyDeterminate(line({ qty_received: -1, amount: 9 })), false);
});

// ═════════════════════════════════════════════════════════════════════
// C. PARITA' WORKER / UI
// ═════════════════════════════════════════════════════════════════════

test('17. le due copie danno la stessa risposta sugli stessi dati', () => {
  const casi = [
    line({ qty_received: 2, amount: 20 }),
    line({ qty_received: 0, amount: 0 }),
    line({ qty_received: 0, amount: 18.29 }),
    line({ qty_received: null, amount: 20 }),
    line({ qty_received: 2, amount: null }),
    line({ qty_received: 2, amount: 0 }),
    line({ qty_received: -1, amount: 5 }),
    line({ qty_received: '2', amount: '20.00' }),
  ];
  for (const c of casi) {
    assert.strictEqual(W.vdaiLineEconomicallyDeterminate(c), UI.vdrLineEconomicallyDeterminate(c),
      'riga divergente: ' + JSON.stringify(c));
  }
  const pjs = [
    doc([line({ qty_received: 2, amount: 20 })]),
    doc([line({ qty_received: 0, amount: 0 }), line({ qty_received: 1, amount: 9 })]),
    Object.assign(doc([line({})]), { total: 999, subtotal: 999 }),
    { items: [] },
    doc([line({})], { totals_reconciled: true }),
  ];
  for (const pj of pjs) {
    assert.strictEqual(W.vdaiDocumentEconomicallyDeterministic(pj), UI.vdrDocumentEconomicallyDeterministic(pj),
      'documento divergente: ' + JSON.stringify(pj.total));
  }
});

test('18. la UI usa la stessa risoluzione di identita del preflight', () => {
  // vdrBuildQtyContext legge window._vdrMatchStatus, che vdrComputeMatchStatus
  // costruisce con le STESSE tre query di vdaiPreflight, conflitti inclusi.
  assert.ok(/window\._vdrMatchStatus/.test(UI_BLOCK), 'il contesto UI deve venire da _vdrMatchStatus');
  assert.ok(/unmatchedSkuSet instanceof Set/.test(UI_BLOCK), 'senza la mappa: fail closed');
  const ctx = { deterministic: true, unmatchedKeys: new Set(['99999']) };
  assert.strictEqual(UI.vdrQtyWarningInformational('OQR-007', line({ vendor_sku: '99999', qty_received: 2, amount: 20 }), ctx), false);
  assert.strictEqual(UI.vdrQtyWarningInformational('OQR-007', line({ vendor_sku: '05840', qty_received: 2, amount: 20 }), ctx), true);
  // e vdrBuildQtyContext senza mappa non inventa niente
  UI_SANDBOX.window._vdrMatchStatus = {};
  assert.strictEqual(UI.vdrBuildQtyContext({ id: 'x', parsed_json: doc([line({})]) }), null);
});

test('19. il worker consulta la predicate, non una lista di codici', () => {
  const f = WSRC.slice(WSRC.indexOf('function isBlockingWarning'), WSRC.indexOf('async function hasBlockingQuestion'));
  assert.ok(/OQR-002' \|\| code === 'OQR-007'/.test(f), 'i due codici sono trattati insieme');
  assert.ok(/vdaiQtyWarningInformational\(code, item, qtyCtx\)/.test(f),
    'la decisione deve passare dalla predicate');
  assert.ok(!/if \(code === 'OQR-007'\) return false;/.test(f),
    'nessuna scorciatoia "OQR-007 non blocca mai"');
  assert.ok(!/if \(code === 'OQR-002'\) return false;/.test(f),
    'nessuna scorciatoia "OQR-002 non blocca mai"');
});

test('20. la UI rende informativi i due codici, non li cancella', () => {
  // il warning resta una card visibile (infoOnly), non un `return null`
  const oqr2 = VDRSRC.slice(VDRSRC.indexOf("if (w.code === 'OQR-002') {"), VDRSRC.indexOf("// ── OQR-007: Qty mismatch"));
  assert.ok(/vdrQtyWarningInformational\('OQR-002', item, qtyCtx\)/.test(oqr2));
  assert.ok(/infoOnly: true/.test(oqr2));
  assert.ok(!/return null/.test(oqr2), 'informativo non vuol dire invisibile');
  const oqr7 = VDRSRC.slice(VDRSRC.indexOf("if (w.code === 'OQR-007') {"), VDRSRC.indexOf("// ── OQR-001: Credit missing original order"));
  assert.ok(/vdrQtyWarningInformational\('OQR-007', item, qtyCtx\)/.test(oqr7));
  assert.ok(/infoOnly: true/.test(oqr7));
});

// ═════════════════════════════════════════════════════════════════════
// D. IL LIFECYCLE NON CAMBIA
// ═════════════════════════════════════════════════════════════════════

// I commenti NOMINANO invoice_warnings per dire che non la toccano: si
// misura il codice, non la prosa.
function senzaCommenti(src) {
  return src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
}
function corpoDi(src, inizio, fini) {
  const a = src.indexOf(inizio);
  assert.ok(a >= 0, 'non trovato: ' + inizio);
  let b = src.length;
  for (const f of fini) {
    const i = src.indexOf(f, a + inizio.length);
    if (i > a && i < b) b = i;
  }
  return senzaCommenti(src.slice(a, b));
}

test('21. nessun percorso di import chiude un warning', () => {
  // ne' il worker ne' la UI toccano invoice_warnings quando approvano:
  // "non bloccante" e "risolto" restano due cose diverse.
  const approve = corpoDi(WSRC, 'async function vdaiApprove(sb: any, docId: string)',
    ['\nasync function ', '\nfunction ', '\nDeno.serve(']);
  assert.ok(!/invoice_warnings/.test(approve), 'vdaiApprove non deve scrivere invoice_warnings');
  const vdrApprove = corpoDi(VDRSRC, 'window.vdrApprove = async function',
    ['\nwindow.vdrReject', '\nwindow.vdrProcessAllPdf', '\nfunction vdr']);
  assert.ok(!/from\('invoice_warnings'\)/.test(vdrApprove),
    'vdrApprove non deve toccare invoice_warnings');
});

test('22. un warning informativo resta non-bloccante ma NON risolto', () => {
  const it = line({ vendor_sku: '05840', qty_ordered: 3, qty_received: 2, amount: 20 });
  const pj = doc([it, line({ vendor_sku: '00907' })]);
  const ctx = ctxOf(pj, ['05840', '00907']);
  assert.strictEqual(W.vdaiQtyWarningInformational('OQR-007', it, ctx), true);
  // la predicate e' pura: non ha alcun effetto su invoice_warnings
  assert.ok(!/invoice_warnings/.test(
    WSRC.slice(WSRC.indexOf('function vdaiQtyWarningInformational'), WSRC.indexOf('function isBlockingWarning'))));
});

// ═════════════════════════════════════════════════════════════════════
// E. NIENTE ALTRO SI MUOVE
// ═════════════════════════════════════════════════════════════════════

test('23. credit memo: routing invariato', () => {
  assert.ok(/t === 'credit_memo' \|\| isPurchasableDocument\(v, t\)/.test(WSRC),
    'un credito passa ACCANTO alla regola, non attraverso');
  assert.ok(/tipoDoc === 'credit_memo'\s*\n?\s*\? await vdaiApproveCredit/.test(WSRC));
});

test('24. catchweight: formula invariata', () => {
  assert.ok(/item\.catchweight === true \? 1 :/.test(WSRC), 'qty 1 su catchweight');
  assert.ok(/cwGrams && lineTotal != null && lineTotal > 0 \? \(lineTotal \/ cwGrams\) \* 100/.test(WSRC));
});

test('25. la quadratura riusa la tolleranza di checkTotals, non una nuova', () => {
  const idx = fs.readFileSync(path.join(ROOT, 'js/vendor-parsers/index.js'), 'utf8');
  const m = idx.match(/const TOTAL_TOLERANCE = ([\d.]+);/);
  assert.ok(m, 'checkTotals deve dichiarare la sua tolleranza');
  assert.strictEqual(W.VDAI_TOTAL_TOLERANCE, parseFloat(m[1]));
  assert.ok(new RegExp('const VDR_TOTAL_TOLERANCE = ' + m[1].replace('.', '\\.')).test(VDRSRC));
});

// ═════════════════════════════════════════════════════════════════════
// F. I CINQUE DOCUMENTI VERI
// ═════════════════════════════════════════════════════════════════════

const REALI = require('./fixtures/hardies-oqr-pending.js');

test('26. i cinque pending: contesto deterministico e quadratura esatta', () => {
  assert.strictEqual(REALI.length, 5);
  for (const d of REALI) {
    assert.strictEqual(W.vdaiDocumentEconomicallyDeterministic(d.parsed_json), true,
      d.document_number + ' deve essere deterministico');
    assert.strictEqual(UI.vdrDocumentEconomicallyDeterministic(d.parsed_json), true,
      d.document_number + ' anche per la UI');
  }
});

test('27. i cinque pending: ogni OQR-002/007 diventa informativo', () => {
  let n = 0;
  for (const d of REALI) {
    const skus = (d.parsed_json.items || []).map(i => i.vendor_sku).filter(Boolean);
    const ctx = ctxOf(d.parsed_json, skus);   // identita' verificata in produzione: 0 unmatched
    for (const it of d.parsed_json.items) {
      for (const w of (it.warnings || [])) {
        if (w.code !== 'OQR-002' && w.code !== 'OQR-007') continue;
        n++;
        assert.strictEqual(W.isBlockingWarning(w, it, {}, ctx), false,
          d.document_number + ' / ' + w.code + ' / ' + it.description);
      }
    }
  }
  assert.strictEqual(n, 14, 'i warning di quantita aperti sono 14');
});

test('28. i cinque pending: se una sola identita manca, quel documento torna a bloccare', () => {
  for (const d of REALI) {
    const skus = (d.parsed_json.items || []).map(i => i.vendor_sku).filter(Boolean);
    const conWarning = d.parsed_json.items.filter(i => (i.warnings || []).some(w => w.code === 'OQR-002' || w.code === 'OQR-007'));
    const vittima = conWarning[0];
    const ctx = ctxOf(d.parsed_json, skus.filter(s => s !== vittima.vendor_sku));
    const w = vittima.warnings.find(x => x.code === 'OQR-002' || x.code === 'OQR-007');
    assert.strictEqual(W.isBlockingWarning(w, vittima, {}, ctx), true, d.document_number);
  }
});

test('29. mutazione: rendere i due codici sempre nonblocking deve rompere i fail-closed', () => {
  // se qualcuno sostituisse la predicate con "return false", questi sono i
  // casi che diventerebbero verdi a torto — qui li eseguiamo con quella
  // regola finta e verifichiamo che la differenza esista davvero.
  const sempreNonBlocking = () => false;
  const casiCheDevonoBloccare = [
    line({ vendor_sku: '05840', qty_received: null, amount: 20 }),          // dato assente
    line({ vendor_sku: '05840', qty_received: 0, amount: 18.29 }),          // si contraddice
    line({ vendor_sku: '99999', qty_received: 2, amount: 20 }),             // identita ignota
  ];
  const pj = doc([line({ vendor_sku: '00907' })]);
  const ctx = ctxOf(pj, ['05840', '00907']);
  let differenze = 0;
  for (const it of casiCheDevonoBloccare) {
    const vero  = W.isBlockingWarning({ code: 'OQR-007' }, it, {}, ctx);
    const finto = sempreNonBlocking();
    assert.strictEqual(vero, true, 'deve bloccare: ' + JSON.stringify(it));
    if (vero !== finto) differenze++;
  }
  assert.strictEqual(differenze, 3, 'la regola vera e quella finta devono divergere su tutti e tre');
});

// ── run ──────────────────────────────────────────────────────────────
(async () => {
  for (const [n, f] of queue) {
    try { await f(); console.log('  ✓ ' + n); pass++; }
    catch (e) { console.log('  ✗ ' + n + '\n      ' + e.message); fail++; }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
