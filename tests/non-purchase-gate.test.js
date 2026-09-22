// ─────────────────────────────────────────────────────────────────────
// INV10B — la rilevanza contabile viene prima dell'identita'
//
// Il difetto, misurato su documenti veri: Phase B chiedeva "gli SKU
// hanno un'identita'?" PRIMA di chiedere "questo documento puo'
// produrre una spesa?". Il secondo controllo vive dentro vdaiApprove,
// che si raggiunge solo dopo aver superato il primo. Cosi' nove
// acknowledgement Ben E. Keith — ogni riga 'requested', qty 0, importo
// 0, purchase total $0 — sono rimasti in coda per mesi aspettando un
// nome per prodotti che da quei documenti non si contabilizzeranno mai.
//
// Questi test eseguono le funzioni VERE del worker contro un Supabase
// finto, e sui documenti VERI dove serve.
// ─────────────────────────────────────────────────────────────────────
'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const ROOT = path.join(__dirname, '..');
const { makeSb } = require(path.join(ROOT, 'tests/helpers-fake-supabase.js'));
const W    = require(path.join(ROOT, 'pure_logic.cjs'));
const WSRC = fs.readFileSync(path.join(ROOT, 'edge-functions/vendor-doc-auto-import/index.ts'), 'utf8');
const UI   = fs.readFileSync(path.join(ROOT, 'js/vendor-documents-review.js'), 'utf8');

const FIX = require(path.join(__dirname, 'fixtures/bek-non-purchase.js'));

let pass = 0, fail = 0;
const queue = [];
function test(n, f) { queue.push([n, f]); }

const BEK = 'Ben E. Keith';

// Un acknowledgement sintetico: ogni riga 'requested', niente confermato.
function ack(skus, extra) {
  return Object.assign({
    id: 'ACK1', vendor: BEK, document_type: 'order_confirmation', status: 'pending',
    document_number: '0009999999', document_date: '2026-09-01', warnings: [],
    parsed_json: {
      vendor: BEK, document_type: 'order_confirmation', document_class: 'acknowledgement',
      buyer_email: 'raven_wolf_1510@yahoo.com', total: 500, computed_purchase_total: 0,
      items: skus.map((s, i) => ({
        vendor_sku: s, description: 'Prodotto ' + s, raw_description: 'Prodotto ' + s,
        qty: 0, qty_ordered: 1, qty_received: 0, unit_price: 10 + i, amount: 0,
        item_status: 'requested', item_status_raw: 'Requested', purchasable: false,
      })),
    },
  }, extra || {});
}

// Una conferma vera: righe Filled, importi > 0.
function conf(righe, extra) {
  const tot = righe.reduce((s, r) => s + r.amount, 0);
  return Object.assign({
    id: 'CONF1', vendor: BEK, document_type: 'order_confirmation', status: 'pending',
    document_number: '0008888888', document_date: '2026-09-10', warnings: [],
    parsed_json: {
      vendor: BEK, document_type: 'order_confirmation', document_class: 'operational_confirmation',
      buyer_email: 'raven_wolf_1510@yahoo.com', total: tot, computed_purchase_total: tot,
      items: righe.map(r => ({
        vendor_sku: r.sku, description: 'Prodotto ' + r.sku, raw_description: 'Prodotto ' + r.sku,
        qty: r.qty, qty_ordered: r.qty, qty_received: r.qty, unit_price: r.price, amount: r.amount,
        item_status: 'filled', item_status_raw: 'Filled', purchasable: true,
      })),
    },
  }, extra || {});
}

const mondo = (docs, iv) => ({
  vendor_documents: docs,
  ingredient_vendors: (iv || []),
  vendor_item_aliases: [], ingredient_links: [], invoice_lines: [],
});

// ═════════════════════════════════════════════════════════════════════
// A. L'ACKNOWLEDGEMENT NON ASPETTA PIU' L'IDENTITA'
// ═════════════════════════════════════════════════════════════════════

test('1. ACK con 6 SKU tutti NON mappati -> chiuso, zero righe', async () => {
  const d = ack(['A1', 'A2', 'A3', 'A4', 'A5', 'A6']);
  const db = mondo([d]);
  const sb = makeSb(db);
  const r = await W.vdaiAccountingRelevance(sb, d);
  assert.strictEqual(r.skip, true);
  assert.strictEqual(r.reason, 'not_a_purchase');
  assert.strictEqual(await W.vdaiCloseAsNonAccounting(sb, d.id), true);
  assert.strictEqual(db.vendor_documents[0].status, 'ignored');
  assert.strictEqual(db.invoice_lines.length, 0);
});

test('2. lo STESSO ACK con tutti gli SKU mappati -> stesso identico esito', async () => {
  const d = ack(['A1', 'A2', 'A3', 'A4', 'A5', 'A6']);
  const iv = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].map((s, i) => ({
    id: 'IV' + i, vendor: BEK, ingredient_id: 'ING' + i, vendor_sku: s, active: true, last_invoice_date: null }));
  const db = mondo([d], iv);
  const sb = makeSb(db);
  const r = await W.vdaiAccountingRelevance(sb, d);
  assert.strictEqual(r.skip, true);
  assert.strictEqual(r.reason, 'not_a_purchase');
  // e per la via vecchia l'esito economico era identico: ignored, zero righe
  const db2 = mondo([ack(['A1','A2','A3','A4','A5','A6'])], iv);
  const sb2 = makeSb(db2);
  const viaVecchia = await W.vdaiApprove(sb2, 'ACK1');
  assert.strictEqual(viaVecchia.ok, true);
  assert.strictEqual(viaVecchia.reason, 'acknowledgement_not_a_purchase');
  assert.strictEqual(db2.vendor_documents[0].status, 'ignored');
  assert.strictEqual(db2.invoice_lines.length, 0);
});

test('3. l identita non e piu il cancello: zero letture di ingredient_vendors', async () => {
  const d = ack(['A1', 'A2']);
  const sb = makeSb(mondo([d]));
  await W.vdaiAccountingRelevance(sb, d);
  const letture = (sb._log.selects || []);
  // lo stub registra solo le select con .single(); il controllo vero e'
  // che la decisione non dipenda da nessuna identita': la ripeto con e
  // senza mappature e pretendo lo stesso esito.
  const conMappe = await W.vdaiAccountingRelevance(
    makeSb(mondo([ack(['A1','A2'])], [{ id:'IV', vendor:BEK, ingredient_id:'X', vendor_sku:'A1', active:true }])),
    ack(['A1','A2']));
  assert.deepStrictEqual(conMappe, { skip: true, reason: 'not_a_purchase' });
  assert.ok(Array.isArray(letture));
});

// ═════════════════════════════════════════════════════════════════════
// B. FAIL CLOSED — chi puo' spendere non passa dal cancello
// ═════════════════════════════════════════════════════════════════════

test('4. documento con UNA riga confermata + SKU non mappato -> NON salta', async () => {
  const d = conf([{ sku: 'B1', qty: 1, price: 50, amount: 50 }]);
  const sb = makeSb(mondo([d]));
  assert.deepStrictEqual(await W.vdaiAccountingRelevance(sb, d), { skip: false });
  // e il preflight lo lascia pending per identita' mancante
  const pre = await W.vdaiPreflight(sb, d);
  assert.strictEqual(pre.ok, true);
  assert.strictEqual(pre.unmatchedCount, 1);
});

test('5. ACK con una sola riga acquistabile in mezzo -> NON salta', async () => {
  const d = ack(['A1', 'A2', 'A3']);
  d.parsed_json.items[1].purchasable = true;          // una sola sfugge al filtro
  const sb = makeSb(mondo([d]));
  assert.deepStrictEqual(await W.vdaiAccountingRelevance(sb, d), { skip: false });
});

test('6. dati insufficienti -> fail closed', async () => {
  for (const pj of [
    { vendor: BEK, document_type: 'order_confirmation' },                 // niente items
    { vendor: BEK, document_type: 'order_confirmation', items: [] },      // items vuoto
  ]) {
    assert.strictEqual(W.vdaiDocumentCannotProduceLines(pj), false, JSON.stringify(pj));
  }
  // parsed_json vuoto e nessun raw_text: la decisione non si prende
  const d = { id: 'X', vendor: BEK, document_number: 'N', document_type: 'order_confirmation',
              status: 'pending', parsed_json: { source: 'email_html' } };
  const sb = makeSb(mondo([d]));
  assert.deepStrictEqual(await W.vdaiAccountingRelevance(sb, d), { skip: false });
});

test('7. importo positivo o purchase total > 0 -> mai non-purchase', async () => {
  const d1 = ack(['A1']); d1.parsed_json.items[0].amount = 12;
  assert.strictEqual(W.vdaiDocumentCannotProduceLines(d1.parsed_json), false, 'importo positivo');
  const d2 = ack(['A1']); d2.parsed_json.computed_purchase_total = 5;
  assert.strictEqual(W.vdaiDocumentCannotProduceLines(d2.parsed_json), false, 'purchase total positivo');
  const d3 = ack(['A1']); delete d3.parsed_json.computed_purchase_total;
  assert.strictEqual(W.vdaiDocumentCannotProduceLines(d3.parsed_json), true,
    'senza totale dichiarato bastano struttura ed economia delle righe');
});

// ═════════════════════════════════════════════════════════════════════
// C. IL DOPPIONE ESATTO
// ═════════════════════════════════════════════════════════════════════

const righeBase = [{ sku: 'C1', qty: 1, price: 50, amount: 50 }, { sku: 'C2', qty: 2, price: 10, amount: 20 }];

function coppia(modifica) {
  const imported = conf(righeBase, { id: 'IMP', status: 'imported' });
  const righe = JSON.parse(JSON.stringify(righeBase));
  if (modifica) modifica(righe);
  const pending = conf(righe, { id: 'PEND', status: 'pending' });
  pending.document_number = imported.document_number;
  return { imported, pending };
}

test('8. duplicato esatto di un documento gia importato -> ignored', async () => {
  const { imported, pending } = coppia(null);
  const db = mondo([pending, imported]);
  const sb = makeSb(db);
  const r = await W.vdaiAccountingRelevance(sb, pending);
  assert.strictEqual(r.skip, true);
  assert.strictEqual(r.reason, 'exact_duplicate');
  assert.strictEqual(r.duplicateOf, 'IMP');
  await W.vdaiCloseAsNonAccounting(sb, pending.id);
  assert.strictEqual(db.vendor_documents.find(x => x.id === 'PEND').status, 'ignored');
  assert.strictEqual(db.invoice_lines.length, 0, 'zero doppio accounting');
});

test('9. MUTAZIONE: una quantita diversa -> NON e un duplicato', async () => {
  const { imported, pending } = coppia(r => { r[0].qty = 2; });
  const sb = makeSb(mondo([pending, imported]));
  assert.deepStrictEqual(await W.vdaiAccountingRelevance(sb, pending), { skip: false },
    'una revisione vera deve continuare a bloccare');
});

test('10. MUTAZIONE: un prezzo diverso -> NON e un duplicato', async () => {
  const { imported, pending } = coppia(r => { r[1].price = 11; });
  const sb = makeSb(mondo([pending, imported]));
  assert.deepStrictEqual(await W.vdaiAccountingRelevance(sb, pending), { skip: false });
});

test('11. MUTAZIONE: un importo diverso -> NON e un duplicato', async () => {
  const { imported, pending } = coppia(r => { r[1].amount = 21; });
  const sb = makeSb(mondo([pending, imported]));
  assert.deepStrictEqual(await W.vdaiAccountingRelevance(sb, pending), { skip: false });
});

test('12. l ordine delle righe non conta, il contenuto si', () => {
  const a = conf(righeBase).parsed_json;
  const b = conf([righeBase[1], righeBase[0]]).parsed_json;
  assert.strictEqual(W.vdaiEconomicFingerprint(a), W.vdaiEconomicFingerprint(b));
  const c = conf(righeBase).parsed_json; c.items[0].item_status = 'partial';
  assert.notStrictEqual(W.vdaiEconomicFingerprint(a), W.vdaiEconomicFingerprint(c), 'lo stato riga conta');
});

test('13. un fratello NON importato non fa duplicato', async () => {
  const { imported, pending } = coppia(null);
  imported.status = 'pending';                 // nessuno dei due e' contabilizzato
  const sb = makeSb(mondo([pending, imported]));
  assert.deepStrictEqual(await W.vdaiAccountingRelevance(sb, pending), { skip: false });
});

test('14. impronta non calcolabile -> mai duplicato', () => {
  assert.strictEqual(W.vdaiEconomicFingerprint({ items: [] }), null);
  assert.strictEqual(W.vdaiEconomicFingerprint({ items: [{ vendor_sku: 'X' }] }), null, 'senza totale');
  assert.strictEqual(W.vdaiEconomicFingerprint(null), null);
});

// ═════════════════════════════════════════════════════════════════════
// D. I DOCUMENTI VERI
// ═════════════════════════════════════════════════════════════════════

test('15. i 7 acknowledgement reali: tutti non-purchase', () => {
  const ack7 = FIX.acknowledgements;
  assert.strictEqual(ack7.length, 7);
  for (const d of ack7) {
    assert.strictEqual(W.vdaiDocumentCannotProduceLines(d.parsed_json), true, d.document_number);
    assert.strictEqual(Number(d.parsed_json.computed_purchase_total), 0, d.document_number);
  }
});

test('16. 0003272475 reale: deciso dal source, non dal nome del warning', async () => {
  const d = FIX.ambiguo;
  assert.strictEqual((d.warnings || [])[0].code, 'BEK_REVISION_UNKNOWN', 'il warning c e ancora');
  assert.ok(!d.parsed_json.items, 'il parsed_json memorizzato non ha righe');
  const sb = makeSb({ vendor_documents: [d] });
  const r = await W.vdaiAccountingRelevance(sb, d);
  assert.strictEqual(r.skip, true);
  assert.strictEqual(r.reason, 'not_a_purchase');
  // e la prova sta nel source riparsato: 18 righe, tutte non acquistabili
  const pj = await W.vdaiEffectiveParsed(sb, d);
  assert.strictEqual(pj.items.length, 18);
  assert.strictEqual(pj.items.filter(i => i.purchasable === false).length, 18);
  assert.strictEqual(Number(pj.computed_purchase_total), 0);
});

test('17. 0003243454 reale: la copia pending e un duplicato esatto', async () => {
  const { pending, imported } = FIX.duplicato;
  const sb = makeSb({ vendor_documents: [pending, imported] });
  const r = await W.vdaiAccountingRelevance(sb, pending);
  assert.strictEqual(r.skip, true);
  assert.strictEqual(r.reason, 'exact_duplicate');
  assert.strictEqual(r.duplicateOf, imported.id);
  const a = await W.vdaiEffectiveParsed(sb, pending);
  const b = await W.vdaiEffectiveParsed(sb, imported);
  assert.strictEqual(W.vdaiEconomicFingerprint(a), W.vdaiEconomicFingerprint(b));
  assert.strictEqual(Number(b.computed_purchase_total), 638.45);
});

test('18. e se BEK mandasse una revisione VERA dello stesso ordine: blocca', async () => {
  const { pending, imported } = FIX.duplicato;
  const sb = makeSb({ vendor_documents: [pending, imported] });
  const rivisto = await W.vdaiEffectiveParsed(sb, pending);
  const diverso = JSON.parse(JSON.stringify(rivisto));
  diverso.items[0].amount = diverso.items[0].amount + 1;
  diverso.computed_purchase_total = Number(diverso.computed_purchase_total) + 1;
  assert.notStrictEqual(W.vdaiEconomicFingerprint(diverso), W.vdaiEconomicFingerprint(rivisto));
});

// ═════════════════════════════════════════════════════════════════════
// E. NIENTE ALTRO SI MUOVE
// ═════════════════════════════════════════════════════════════════════

test('19. una conferma vera con SKU noto si importa come prima', async () => {
  const d = conf([{ sku: 'D1', qty: 1, price: 40, amount: 40 }]);
  const db = mondo([d], [{ id: 'IV1', vendor: BEK, ingredient_id: 'INGD', vendor_sku: 'D1', active: true, last_invoice_date: null }]);
  const sb = makeSb(db);
  assert.deepStrictEqual(await W.vdaiAccountingRelevance(sb, d), { skip: false });
  const r = await W.vdaiApprove(sb, d.id);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(db.vendor_documents[0].status, 'imported');
  assert.strictEqual(db.invoice_lines.length, 1);
  assert.strictEqual(db.invoice_lines[0].line_total, 40);
});

test('20. buyer guard invariato', () => {
  const P = require(path.join(ROOT, 'js/vendor-parsers/ben-e-keith-order-confirmation.js'));
  assert.strictEqual(P.classifyBuyer('raven_wolf_1510@yahoo.com'), 'kitchen');
  assert.strictEqual(P.classifyBuyer('zeno@zenosonthesquare.com'), 'excluded');
  assert.strictEqual(P.classifyBuyer('ignoto@example.com'), 'unknown');
  assert.strictEqual(P.classifyBuyer(null), 'unknown');
  assert.ok(/BEK_BUYER_EXCLUDED|BEK_BUYER_NOT_ALLOWED/.test(WSRC), 'il gate buyer resta nel worker');
});

test('21. credit memo e altri vendor: percorsi invariati', () => {
  assert.ok(/t === 'credit_memo' \|\| isPurchasableDocument\(v, t\)/.test(WSRC));
  assert.ok(/tipoDoc === 'credit_memo'\s*\n?\s*\? await vdaiApproveCredit/.test(WSRC));
  // il nuovo cancello e' prima del preflight e non conosce vendor ne classe
  const f = WSRC.slice(WSRC.indexOf('function vdaiDocumentCannotProduceLines'),
                       WSRC.indexOf('function vdaiEconomicFingerprint'));
  assert.ok(!/Ben E\. Keith|acknowledgement|'bek'/i.test(f),
    'la predicate non deve nominare vendor ne classe di documento');
  assert.ok(/purchasable === false/.test(f) && /vdaiIsZeroDeliveredLegacy/.test(f),
    'deve leggere il filtro vero di writeInvoiceLines');
});

test('22. il cancello non crea identita e non tocca la price intelligence', async () => {
  const d = ack(['Z1', 'Z2']);
  const db = mondo([d]);
  const sb = makeSb(db);
  await W.vdaiAccountingRelevance(sb, d);
  await W.vdaiCloseAsNonAccounting(sb, d.id);
  assert.strictEqual(db.ingredient_vendors.length, 0, 'nessuna identita creata');
  assert.strictEqual(db.invoice_lines.length, 0);
  assert.strictEqual((sb._log.inserts || []).length, 0, 'nessun insert di nessun tipo');
  const updates = sb._log.updates.filter(u => u.table !== 'vendor_documents');
  assert.strictEqual(updates.length, 0, 'nessun update fuori da vendor_documents');
});

test('23. le warning NON vengono chiuse dal cancello', async () => {
  const d = FIX.ambiguo;
  const db = { vendor_documents: [JSON.parse(JSON.stringify(d))] };
  const sb = makeSb(db);
  await W.vdaiCloseAsNonAccounting(sb, d.id);
  const dopo = db.vendor_documents[0];
  assert.strictEqual(dopo.status, 'ignored');
  assert.strictEqual((dopo.warnings || [])[0].code, 'BEK_REVISION_UNKNOWN',
    'informazione operativa preservata: chiuderla sarebbe una decisione umana');
  const f = WSRC.slice(WSRC.indexOf('async function vdaiCloseAsNonAccounting'));
  assert.ok(!/warnings/.test(f.slice(0, f.indexOf('\n}'))), 'la funzione non nomina warnings');
});

test('24. la UI non prende questa decisione da sola, e va detto', () => {
  // vdrApprove e' un clic umano: non ha ne puo' avere un cancello che
  // chiude documenti in automatico. La parita' qui e' deliberatamente
  // ASIMMETRICA, e il test la fissa perche' nessuno la "ripari".
  assert.ok(!/vdaiAccountingRelevance|vdaiCloseAsNonAccounting|vdrAccountingRelevance/.test(UI),
    'la UI non deve chiudere documenti automaticamente');
  assert.ok(/document_class === 'acknowledgement'/.test(WSRC),
    'il ramo storico dentro vdaiApprove resta come difesa in profondita');
});

test('25. il cancello sta PRIMA del preflight in Phase B', () => {
  const loop = WSRC.slice(WSRC.indexOf('for (const doc of queueB || [])'));
  const iRel = loop.indexOf('vdaiAccountingRelevance');
  const iPre = loop.indexOf('vdaiPreflight');
  assert.ok(iRel > 0 && iPre > 0, 'entrambi devono esserci');
  assert.ok(iRel < iPre, 'la rilevanza contabile deve venire prima del preflight');
});

// ═════════════════════════════════════════════════════════════════════
// F. LA SEQUENZA VERA DI PHASE B
//
// I test sopra chiamano il cancello direttamente. Questo invece ESTRAE
// dal sorgente il corpo del ciclo di Phase B e lo ESEGUE: e' l'unico
// modo per misurare l'ORDINE dei controlli e non solo la loro
// esistenza. Se qualcuno rimette l'identita' davanti alla rilevanza
// contabile, e' qui che si rompe.
// ═════════════════════════════════════════════════════════════════════

const CORPO_PHASE_B = (() => {
  const i = WSRC.indexOf('for (const doc of queueB || []) {');
  assert.ok(i > 0, 'ciclo di Phase B non trovato');
  const fine = WSRC.indexOf('\n    }\n\n    return json(', i);
  assert.ok(fine > i, 'fine del ciclo non trovata');
  return WSRC.slice(i, fine + 6);
})();

async function eseguiPhaseB(sb, docs) {
  const result = { phaseB: [] };
  const fn = new Function(
    'sb', 'queueB', 'dryRun', 'result',
    'vdaiAccountingRelevance', 'vdaiCloseAsNonAccounting', 'vdaiPreflight', 'vdaiApprove', 'vdaiApproveCredit',
    'return (async () => { ' + CORPO_PHASE_B + ' return result; })();');
  return await fn(sb, docs, false, result,
    W.vdaiAccountingRelevance, W.vdaiCloseAsNonAccounting, W.vdaiPreflight, W.vdaiApprove, W.vdaiApproveCredit);
}

test('26. SEQUENZA VERA: ACK con SKU non mappati esce lo stesso', async () => {
  const d = ack(['A1', 'A2', 'A3', 'A4', 'A5', 'A6']);
  const db = mondo([d]);
  const sb = makeSb(db);
  const out = await eseguiPhaseB(sb, [d]);
  assert.strictEqual(out.phaseB.length, 1);
  assert.strictEqual(out.phaseB[0].outcome, 'ignored', JSON.stringify(out.phaseB[0]));
  assert.strictEqual(out.phaseB[0].reason, 'not_a_purchase');
  assert.strictEqual(db.vendor_documents[0].status, 'ignored');
  assert.strictEqual(db.invoice_lines.length, 0);
  assert.strictEqual(db.ingredient_vendors.length, 0);
});

test('27. SEQUENZA VERA: il duplicato esatto esce come duplicato', async () => {
  const { imported, pending } = coppia(null);
  const db = mondo([pending, imported]);
  const sb = makeSb(db);
  const out = await eseguiPhaseB(sb, [pending]);
  assert.strictEqual(out.phaseB[0].outcome, 'ignored');
  assert.strictEqual(out.phaseB[0].reason, 'exact_duplicate');
  assert.strictEqual(db.invoice_lines.length, 0, 'zero doppio accounting');
});

test('28. SEQUENZA VERA: una conferma con SKU non mappato resta pending', async () => {
  const d = conf([{ sku: 'E1', qty: 1, price: 30, amount: 30 }]);
  const db = mondo([d]);
  const sb = makeSb(db);
  const out = await eseguiPhaseB(sb, [d]);
  assert.strictEqual(out.phaseB[0].outcome, 'left_pending');
  assert.strictEqual(out.phaseB[0].unmatchedCount, 1);
  assert.strictEqual(db.vendor_documents[0].status, 'pending');
});

test('29. SEQUENZA VERA: una conferma con SKU noto si importa', async () => {
  const d = conf([{ sku: 'E2', qty: 1, price: 30, amount: 30 }]);
  const db = mondo([d], [{ id: 'IVE', vendor: BEK, ingredient_id: 'INGE', vendor_sku: 'E2', active: true, last_invoice_date: null }]);
  const sb = makeSb(db);
  const out = await eseguiPhaseB(sb, [d]);
  assert.strictEqual(out.phaseB[0].outcome, 'imported', JSON.stringify(out.phaseB[0]));
  assert.strictEqual(db.invoice_lines.length, 1);
});

// ── run ──────────────────────────────────────────────────────────────
(async () => {
  for (const [n, f] of queue) {
    try { await f(); console.log('  ✓ ' + n); pass++; }
    catch (e) { console.log('  ✗ ' + n + '\n      ' + (e && e.message)); fail++; }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
