// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 78 — il fallback docNumber dal subject non puo' catturare
// un identificativo che non e' un numero di documento.
//
// Difetto (audit MT77): /#?\s*(\d{6,10})/ non ha confini. Sul subject BEK
//   "Ben E. Keith : Order Confirmation for FDF770366-ZENO'S ON THE SQUARE;0002952908"
// il primo run di 6-10 cifre e' 770366 — il Customer# dentro FDF770366,
// IDENTICO su tutte e 61 le email BEK del database — mentre il Sales Order
// vero (0002952908) sta nello stesso subject, subito dopo il ';'.
//
// Due righe reali sono nate cosi' il 19/08 (d84e4d64, 383764dd), entrambe in
// status 'error' e senza invoice_lines. Il danno non e' l'etichetta sbagliata:
// e' che 770366 e' COSTANTE, quindi due documenti diversi che percorressero il
// fallback collasserebbero nello stesso gruppo di riconciliazione.
//
// Il fallback NON e' rimovibile: 121 righe Hardie's su 122 ne dipendono ed e'
// la loro unica fonte di identita'. Questo file misura entrambe le cose.
//
// Seconda meta' della patch: BEK_NO_SALES_ORDER diventa bloccante. Senza,
// "meglio null che un numero sbagliato" sarebbe un peggioramento — le tre
// barriere di identita' sono condizionate a `if (docNumber && ...)`, quindi un
// documento senza numero le salterebbe tutte.
//
// `node tests/docnumber-subject-fallback.test.js`
// ══════════════════════════════════════════════════════════════════
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { processOneQueuedDoc, hasBlockingQuestion, vdaiPreflight, vdaiApprove,
        isBlockingWarning } = require('../pure_logic.cjs');
const CANON = require('../js/vendor-parsers/ben-e-keith-order-confirmation');
const F = require('./fixtures/bek-html-real-shape');

const WORKER_PATH = path.join(__dirname, '..', 'edge-functions', 'vendor-doc-auto-import', 'index.ts');
const UI_PATH     = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');
const WORKER = fs.readFileSync(WORKER_PATH, 'utf8');
const UI     = fs.readFileSync(UI_PATH, 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message ? e.message : e)); }
}
async function atest(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message ? e.message : e)); }
}

// ── La regex sotto test e' ESTRATTA DAL SORGENTE, non ricopiata ────
// Se qualcuno la cambia in uno dei due file, questi test misurano la
// versione cambiata: non possono passare per inerzia.
const MARKER = 'const sm = doc.source_email_subject.match(';
function estraiLiterale(src, nome) {
  const i = src.indexOf(MARKER);
  assert.ok(i > 0, `fallback subject non trovato in ${nome} — e' cambiato di forma?`);
  const fine = src.indexOf(');', i);
  assert.ok(fine > i, `literal non chiuso in ${nome}`);
  return src.slice(i + MARKER.length, fine).trim();
}
const LIT_WORKER = estraiLiterale(WORKER, 'index.ts');
const LIT_UI     = estraiLiterale(UI, 'vendor-documents-review.js');
const RE = new Function('return ' + LIT_WORKER)();

// Il fallback come lo applica il codice: primo match, gruppo 1, altrimenti null.
function fallback(subject) {
  if (!subject) return null;
  const m = String(subject).match(RE);
  return m ? m[1] : null;
}

// ── Subject reali, verbatim dalla produzione ───────────────────────
const SUBJ_BEK_REALE   = "Ben E. Keith : Order Confirmation for FDF770366-ZENO'S ON THE SQUARE;0002952908";
const SUBJ_BEK_NULL    = "Ben E. Keith : Order Confirmation for FDF770366-ZENO'S ON THE SQUARE;null";
const SUBJ_BEK_ALTRO   = "Ben E. Keith : Order Confirmation for FDF770366-ZENO'S ON THE SQUARE;0003243454";
const SUBJ_FRUGE       = 'Fruge Seafood      - Invoice - 843962';
const SUBJ_FRESHPOINT  = 'FreshPoint Dallas Order Confirmation: 19337902-CU59474';
const SUBJ_WALMART     = 'New Walmart Business: Pay By Invoice invoice available: f4786197';

// I 121 subject Hardie's che oggi dipendono DAVVERO da questo fallback
// (parsed_json senza alcun campo numero: extractDocNumber restituisce null sui
// loro PDF, quindi il subject e' la loro unica identita'). Estratti dalla
// produzione il 2026-09-19. Formato: "subject<TAB>document_number atteso".
const CORPUS_HARDIES = `INVOICE - #07000322	07000322
INVOICE - #06996814	06996814
INVOICE - #06997941	06997941
INVOICE - #06995651	06995651
INVOICE - #06992515	06992515
INVOICE - #06992511	06992511
CREDIT - #00668419	00668419
INVOICE - #06991299	06991299
INVOICE - #06989667	06989667
INVOICE - #06986639	06986639
INVOICE - #06983333	06983333
INVOICE - #06981903	06981903
INVOICE - #06977530	06977530
INVOICE - #06978984	06978984
INVOICE - #06976333	06976333
CONFIRMATION OF SALE - #07004208	07004208
INVOICE - #07005461	07005461
INVOICE - #07007285	07007285
CONFIRMATION OF SALE - #07010445	07010445
INVOICE - #07010445	07010445
CONFIRMATION OF SALE - #07013760	07013760
CONFIRMATION OF SALE - #07014861	07014861
INVOICE - #07013760	07013760
CONFIRMATION OF SALE - #07016705	07016705
R.M.A. - #00670731	00670731
INVOICE - #07016705	07016705
INVOICE - #07014861	07014861
CONFIRMATION OF SALE - #07018308	07018308
INVOICE - #07018308	07018308
INVOICE - #07019558	07019558
CONFIRMATION OF SALE - #07023167	07023167
INVOICE - #07023167	07023167
CONFIRMATION OF SALE - #07025359	07025359
INVOICE - #07025359	07025359
CONFIRMATION OF SALE - #07026888	07026888
INVOICE - #07026888	07026888
CONFIRMATION OF SALE - #07029488	07029488
INVOICE - #07029488	07029488
CONFIRMATION OF SALE - #07032533	07032533
INVOICE - #07032533	07032533
INVOICE - #07034321	07034321
CONFIRMATION OF SALE - #07035412	07035412
INVOICE - #07035412	07035412
CONFIRMATION OF SALE - #07038466	07038466
INVOICE - #07038466	07038466
INVOICE - #07040989	07040989
INVOICE - #07042652	07042652
INVOICE - #07043930	07043930
INVOICE - #07043887	07043887
INVOICE - #07047369	07047369
INVOICE - #07047292	07047292
INVOICE - #07050104	07050104
CONFIRMATION OF SALE - #07051870	07051870
INVOICE - #07051870	07051870
CONFIRMATION OF SALE - #07053066	07053066
INVOICE - #07053066	07053066
INVOICE - #07056329	07056329
CONFIRMATION OF SALE - #07059129	07059129
INVOICE - #07059129	07059129
INVOICE - #07062391	07062391
CONFIRMATION OF SALE - #07064605	07064605
CONFIRMATION OF SALE - #07065764	07065764
CONFIRMATION OF SALE - #07065922	07065922
INVOICE - #07065906	07065906
INVOICE - #07064605	07064605
INVOICE - #07065764	07065764
CREDIT - #00675518	00675518
CONFIRMATION OF SALE - #07068852	07068852
CONFIRMATION OF SALE - #07070716	07070716
INVOICE - #07065922	07065922
INVOICE - #07068852	07068852
INVOICE - #07070716	07070716
CONFIRMATION OF SALE - #07071903	07071903
CONFIRMATION OF SALE - #07073805	07073805
INVOICE - #07071903	07071903
CONFIRMATION OF SALE - #07075282	07075282
INVOICE - #07073805	07073805
INVOICE - #07075282	07075282
CONFIRMATION OF SALE - #07078899	07078899
INVOICE - #07078899	07078899
CONFIRMATION OF SALE - #07081108	07081108
INVOICE - #07083092	07083092
CONFIRMATION OF SALE - #07085631	07085631
INVOICE - #07085631	07085631
CONFIRMATION OF SALE - #07088657	07088657
CONFIRMATION OF SALE - #07088797	07088797
INVOICE - #07088657	07088657
INVOICE - #07088797	07088797
CONFIRMATION OF SALE - #07090810	07090810
INVOICE - #07090810	07090810
INVOICE - #07092195	07092195
CONFIRMATION OF SALE - #07095745	07095745
INVOICE - #07081108	07081108
INVOICE - #07095745	07095745
INVOICE - #07095738	07095738
CONFIRMATION OF SALE - #07099257	07099257
INVOICE - #07099257	07099257
INVOICE - #07102560	07102560
INVOICE - #07106025	07106025
CREDIT - #00679556	00679556
CONFIRMATION OF SALE - #07109562	07109562
INVOICE - #07109562	07109562
CONFIRMATION OF SALE - #07111645	07111645
INVOICE - #07111645	07111645
CONFIRMATION OF SALE - #07115822	07115822
INVOICE - #07115822	07115822
CREDIT - #00680317	00680317
CONFIRMATION OF SALE - #07119341	07119341
INVOICE - #07119341	07119341
CONFIRMATION OF SALE - #07121376	07121376
INVOICE - #07121376	07121376
CONFIRMATION OF SALE - #07119379	07119379
INVOICE - #07119379	07119379
INVOICE - #07122828	07122828
CONFIRMATION OF SALE - #07126717	07126717
INVOICE - #07126717	07126717
CONFIRMATION OF SALE - #07130180	07130180
INVOICE - #07130180	07130180
INVOICE - #07132559	07132559
CONFIRMATION OF SALE - #07133808	07133808
CONFIRMATION OF SALE - #07133828	07133828`.split('\n').map((r) => r.split('\t'));

// ── Mock Supabase — stessa forma di bek-after-import-fail-closed ───
function makeMockSb(tables) {
  function builder(t) {
    const st = { filters: [], single: false, limitN: null };
    const api = {
      select() { return api; }, eq(c, v) { st.filters.push(['eq', c, v]); return api; },
      neq(c, v) { st.filters.push(['neq', c, v]); return api; },
      in(c, v) { st.filters.push(['in', c, v]); return api; },
      not() { return api; }, limit(n) { st.limitN = n; return api; }, order() { return api; },
      single() { st.single = true; return exec(); },
      insert(r) { st.rows = Array.isArray(r) ? r : [r]; st.op = 'insert'; return api; },
      update(d) { st.upd = d; st.op = 'update'; return api; },
      then(a, b) { return run().then(a, b); },
    };
    function run() { if (st.op === 'insert') return w('insert'); if (st.op === 'update') return w('update'); return exec(); }
    function filt(rows) {
      return rows.filter((r) => st.filters.every((f) =>
        f[0] === 'eq' ? r[f[1]] === f[2] : f[0] === 'neq' ? r[f[1]] !== f[2]
          : f[0] === 'in' ? f[2].includes(r[f[1]]) : true));
    }
    async function exec() {
      let rows = filt(tables[t] || []);
      if (st.limitN) rows = rows.slice(0, st.limitN);
      return st.single ? (rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'nf' } })
                       : { data: rows, error: null };
    }
    async function w(k) {
      tables[t] = tables[t] || [];
      if (k === 'insert') { tables[t].push(...st.rows); return { data: st.rows, error: null }; }
      const m = filt(tables[t]); m.forEach((r) => Object.assign(r, st.upd)); return { data: m, error: null };
    }
    return api;
  }
  return { tables, from: (t) => builder(t), storage: { from: () => ({ remove: async () => ({}) }) } };
}

// HTML BEK reale a cui e' stato tolto SOLO il label "Sales Order": il parser
// trova ancora 4 item e il buyer di cucina, ma nessun numero -> emette
// BEK_NO_SALES_ORDER. E' la forma esatta del caso che la patch deve fermare.
const HTML_SENZA_SO = F.BEK_OPERATIONAL_SAME_SO.replace(/Sales\s*Order/ig, 'Ordine');
const PARSED_SENZA_SO = CANON.parse(HTML_SENZA_SO);
const PARSED_CON_SO   = CANON.parse(F.BEK_OPERATIONAL_SAME_SO);
const SO_VERO = PARSED_CON_SO.document_number;

function skuMappati(parsed) {
  return parsed.items.map((i, n) => ({
    vendor: 'Ben E. Keith', vendor_sku: i.vendor_sku || i.item_code,
    ingredient_id: 'ing-' + n, conversion_to_base: null,
  }));
}
function tabelle(righe, parsed) {
  return {
    vendor_documents: righe, ingredient_vendors: skuMappati(parsed),
    vendor_item_aliases: [], ingredient_links: [], invoice_lines: [],
    invoice_warnings: [], ingredients: [],
  };
}
const PARSERS = require('../js/vendor-parsers');

(async () => {
  console.log('\nMICRO-TASK 78 — fallback docNumber: confini, e BEK_NO_SALES_ORDER fail closed\n');

  // ════════════════════════════════════════════════════════════════
  console.log('A. La regex: il Customer# non e\' un numero di documento');
  // ════════════════════════════════════════════════════════════════

  test('1. FDF770366 non produce 770366', () => {
    assert.notStrictEqual(fallback('for FDF770366-ZENO\'S ON THE SQUARE'), '770366',
      'il Customer# incollato a "FDF" e\' ancora catturato');
  });

  test('2. subject BEK reale -> 0002952908, mai 770366', () => {
    const got = fallback(SUBJ_BEK_REALE);
    assert.notStrictEqual(got, '770366', 'ha catturato il Customer#');
    assert.strictEqual(got, '0002952908', 'non ha trovato il Sales Order vero');
  });

  test('3. subject BEK reale con ";null" -> null, mai 770366', () => {
    const got = fallback(SUBJ_BEK_NULL);
    assert.notStrictEqual(got, '770366', 'ha catturato il Customer#');
    assert.strictEqual(got, null, 'senza numero isolato il fallback deve tacere, non inventare');
  });

  test('4. ABC123456 rifiutato (token alfanumerico a sinistra)', () => {
    assert.strictEqual(fallback('order ABC123456 shipped'), null);
  });

  test('5. 123456X rifiutato (token alfanumerico a destra)', () => {
    assert.strictEqual(fallback('order 123456X shipped'), null,
      'serve il lookahead [A-Za-z0-9], non il solo (?!\\d)');
  });

  test('5b. cifre incollate su entrambi i lati rifiutate', () => {
    assert.strictEqual(fallback('ref AB1234567CD end'), null);
  });

  test('6. un numero davvero isolato di 6-10 cifre resta accettato', () => {
    assert.strictEqual(fallback('Order 123456 confirmed'), '123456');
    assert.strictEqual(fallback('Order 1234567890 confirmed'), '1234567890');
    assert.strictEqual(fallback('#654321'), '654321');
    assert.strictEqual(fallback('654321'), '654321', 'inizio stringa e\' un confine valido');
    assert.strictEqual(fallback('INVOICE - # 07000322'), '07000322', 'spazio fra # e cifre');
  });

  test('6b. un run di 11+ cifre non viene troncato a 10: nessun match', () => {
    assert.strictEqual(fallback('ref 12345678901 end'), null,
      'meglio nessun numero che un numero tagliato');
  });

  test('7. fixture reali Hardie\'s invariate', () => {
    assert.strictEqual(fallback('INVOICE - #07000322'), '07000322');
    assert.strictEqual(fallback('CREDIT - #00668419'), '00668419');
    assert.strictEqual(fallback('CONFIRMATION OF SALE - #07133808'), '07133808');
  });

  test('8. Fruge "Invoice - 843962" invariato', () => {
    assert.strictEqual(fallback(SUBJ_FRUGE), '843962');
  });

  test('9. FreshPoint "19337902-CU59474" -> 19337902', () => {
    assert.strictEqual(fallback(SUBJ_FRESHPOINT), '19337902');
  });

  test('9b. Walmart "f4786197" rifiutato (lettera a sinistra)', () => {
    assert.strictEqual(fallback(SUBJ_WALMART), null,
      'oggi il parser fornisce il numero, quindi il fallback non viene usato: ' +
      'l\'asserzione fissa il comportamento, non lo cambia');
  });

  // ════════════════════════════════════════════════════════════════
  console.log('\nB. Il corpus reale: i 121 Hardie\'s che dipendono dal fallback');
  // ════════════════════════════════════════════════════════════════

  test('10. tutti i 121 subject Hardie\'s producono lo stesso document_number di oggi', () => {
    assert.strictEqual(CORPUS_HARDIES.length, 121, 'il corpus non e\' piu\' di 121 righe');
    const rotti = [];
    for (const [subject, atteso] of CORPUS_HARDIES) {
      const got = fallback(subject);
      if (got !== atteso) rotti.push(`${subject} -> ${got} (atteso ${atteso})`);
    }
    assert.strictEqual(rotti.length, 0,
      `${rotti.length} subject Hardie's hanno cambiato identita':\n      ` + rotti.slice(0, 5).join('\n      '));
  });

  test('10b. nessun subject del corpus produce 770366', () => {
    const contaminati = CORPUS_HARDIES.filter(([s]) => fallback(s) === '770366');
    assert.strictEqual(contaminati.length, 0);
  });

  // ════════════════════════════════════════════════════════════════
  console.log('\nC. BEK_NO_SALES_ORDER: bloccante nei DUE gate, non in uno solo');
  // ════════════════════════════════════════════════════════════════

  test('11. isBlockingWarning riconosce BEK_NO_SALES_ORDER (gate del worker)', () => {
    assert.strictEqual(isBlockingWarning({ code: 'BEK_NO_SALES_ORDER' }, null, {}), true);
  });

  test('11b. il parser emette davvero quel codice quando manca il Sales Order', () => {
    assert.strictEqual(PARSED_SENZA_SO.document_number, null);
    const w = (PARSED_SENZA_SO.warnings || []).find((x) => x.code === 'BEK_NO_SALES_ORDER');
    assert.ok(w, 'il parser non emette piu\' BEK_NO_SALES_ORDER — il gate resterebbe senza input');
    assert.strictEqual(w.severity, 'blocking');
  });

  await atest('12. BEK senza Sales Order, buyer kitchen, SKU tutti mappati: bloccato e NON importabile', async () => {
    // Il caso costruito apposta per togliere ogni altra causa di rifiuto:
    // 4 item veri, buyer di cucina, ogni SKU mappato. Se passasse, passerebbe
    // per davvero.
    assert.strictEqual(PARSED_SENZA_SO.buyer_class, 'kitchen', 'il fixture non ha piu\' il buyer di cucina');
    assert.ok(PARSED_SENZA_SO.items.length > 0, 'il fixture non ha piu\' item');

    const doc = {
      id: 'senza-so', vendor: 'Ben E. Keith', document_type: 'order_confirmation',
      status: 'pending', document_number: null, document_date: null,
      created_at: '2026-09-20T10:00:00Z',
      parsed_json: PARSED_SENZA_SO,
      warnings: PARSED_SENZA_SO.warnings,
      raw_text: HTML_SENZA_SO,
    };
    const sb = makeMockSb(tabelle([doc], PARSED_SENZA_SO));

    assert.strictEqual(await hasBlockingQuestion(sb, doc), true,
      'hasBlockingQuestion deve essere true');

    const pf = await vdaiPreflight(sb, doc);   // prende il documento, non l'id
    assert.strictEqual(pf.ok, false, 'il preflight non deve essere ok');
    assert.strictEqual(pf.reason, 'open_question',
      `fermato per "${pf.reason}" invece che dalla domanda aperta: sarebbe di nuovo un blocco per effetto collaterale`);

    const ap = await vdaiApprove(sb, 'senza-so');
    assert.strictEqual(ap.ok, false, 'vdaiApprove non deve importare');
    assert.strictEqual(sb.tables.invoice_lines.length, 0, 'nessuna invoice_line deve essere scritta');
    assert.strictEqual(sb.tables.vendor_documents[0].status, 'pending', 'lo status non deve diventare imported');
  });

  test('12b. il gate UI produce una domanda bloccante per lo stesso codice', () => {
    // vdrWarningToQuestion E' la classificazione blocking del percorso UI:
    // vdrPreflight conta le domande non-infoOnly che questa funzione genera.
    const start = UI.indexOf('function vdrWarningToQuestion(');
    const endMark = 'return null; // unknown code — skip';
    const end = UI.indexOf(endMark, start);
    assert.ok(start > 0 && end > start, 'vdrWarningToQuestion e\' cambiata di forma');
    const fn = new Function('return ' + UI.slice(start, end + endMark.length) + '\n}')();

    const q = fn({ code: 'BEK_NO_SALES_ORDER', message: 'Sales Order number not found' }, null, 'd1', 0);
    assert.ok(q, 'nessuna domanda generata -> la UI non blocca');
    assert.strictEqual(q.blocking, true);
    assert.ok(!q.infoOnly, 'una domanda infoOnly non fermerebbe vdrPreflight');
  });

  // ════════════════════════════════════════════════════════════════
  console.log('\nD. Integrazione: precedenza, fratelli, nessun collasso');
  // ════════════════════════════════════════════════════════════════

  await atest('13. quando il parser da\' il numero, il subject non cambia la precedenza', async () => {
    assert.ok(/if \(!docNumber && doc\.source_email_subject\)/.test(WORKER),
      'il fallback non e\' piu\' subordinato a !docNumber');
    assert.ok(/if \(!docNumber && doc\.source_email_subject\)/.test(UI),
      'copia UI: il fallback non e\' piu\' subordinato a !docNumber');

    // Prova end-to-end: body con Sales Order, subject col Customer#.
    const doc = {
      id: 'con-so', vendor: 'Ben E. Keith', document_type: 'order_confirmation',
      status: 'pdf_received', document_number: null, created_at: '2026-09-20T10:00:00Z',
      parsed_json: { source: 'email_html' }, warnings: [],
      raw_text: F.BEK_OPERATIONAL_SAME_SO,
      source_email_subject: SUBJ_BEK_REALE,
    };
    const sb = makeMockSb(tabelle([doc], PARSED_CON_SO));
    await processOneQueuedDoc(sb, doc, PARSERS);
    const row = sb.tables.vendor_documents.find((r) => r.id === 'con-so');
    assert.strictEqual(row.document_number, SO_VERO,
      `document_number ${row.document_number} invece del Sales Order del body ${SO_VERO}`);
    assert.notStrictEqual(row.document_number, '770366');
    assert.notStrictEqual(row.document_number, '0002952908',
      'ha preso il numero dal subject invece che dal body');
  });

  await atest('14. due BEK con lo stesso Sales Order VERO restano fratelli', async () => {
    const vecchia = {
      id: 'fratello', vendor: 'Ben E. Keith', document_type: 'order_confirmation',
      status: 'imported', document_number: SO_VERO, created_at: '2026-09-19T10:00:00Z',
      parsed_json: PARSED_CON_SO, warnings: [], raw_text: F.BEK_OPERATIONAL_SAME_SO,
    };
    const nuova = {
      id: 'revisione', vendor: 'Ben E. Keith', document_type: 'order_confirmation',
      status: 'pdf_received', document_number: null, created_at: '2026-09-20T10:00:00Z',
      parsed_json: { source: 'email_html' }, warnings: [],
      raw_text: F.BEK_OPERATIONAL_SAME_SO,
      source_email_subject: `Ben E. Keith : Order Confirmation for FDF770366-ZENO'S ON THE SQUARE;${SO_VERO}`,
    };
    const sb = makeMockSb(tabelle([vecchia, nuova], PARSED_CON_SO));
    const out = await processOneQueuedDoc(sb, nuova, PARSERS);
    assert.strictEqual(out.outcome, 'bek_revision_after_import',
      `la sezione F non ha visto il fratello gia\' imported (outcome: ${out.outcome})`);
    const row = sb.tables.vendor_documents.find((r) => r.id === 'revisione');
    const w = (row.warnings || []).find((x) => x.code === 'BEK_REVISION_AFTER_IMPORT');
    assert.ok(w, 'manca BEK_REVISION_AFTER_IMPORT');
    assert.strictEqual(sb.tables.vendor_documents.find((r) => r.id === 'fratello').status, 'imported',
      'l\'import esistente e\' stato toccato');
  });

  test('15. due Sales Order VERI diversi non possono collassare su 770366', () => {
    // Stesso Customer# nel subject, Sales Order diversi: la vecchia regex dava
    // 770366 a entrambi, cioe' lo STESSO gruppo di riconciliazione per due
    // ordini che non c'entrano niente.
    const a = fallback(SUBJ_BEK_REALE);
    const b = fallback(SUBJ_BEK_ALTRO);
    assert.notStrictEqual(a, '770366');
    assert.notStrictEqual(b, '770366');
    assert.notStrictEqual(a, b, 'due Sales Order diversi collassano sullo stesso numero');
    assert.strictEqual(a, '0002952908');
    assert.strictEqual(b, '0003243454');
  });

  test('16. il ramo di dedup/riconciliazione non e\' stato toccato', () => {
    // MT78 cambia COME si ottiene docNumber, non cosa ci si fa. I tre blocchi
    // che usano document_number come identita' devono essere identici.
    assert.ok(WORKER.includes(
      "const { data: byNum } = await sb.from('vendor_documents').select('id').eq('vendor', parsed.vendor).eq('document_number', docNumber).eq('document_type', parsed.document_type).neq('id', doc.id).limit(1);"),
      'il dedup generico e\' cambiato');
    assert.ok(WORKER.includes(
      "if (docNumber && RECONCILE_VENDORS.includes(parsed.vendor) && (parsed.document_type === 'order_confirmation' || parsed.document_type === 'invoice')) {"),
      'la riconciliazione Hardie\'s/Chef\'s Warehouse e\' cambiata');
    assert.ok(WORKER.includes(
      "if (docNumber && parsersApi().isBenEKeith(parsed.vendor) && parsed.document_type === 'order_confirmation') {"),
      'il gate della sezione F e\' cambiato');
  });

  // ════════════════════════════════════════════════════════════════
  console.log('\nE. Le copie non devono divergere');
  // ════════════════════════════════════════════════════════════════

  test('17. worker e UI usano la STESSA regex, carattere per carattere', () => {
    assert.strictEqual(LIT_UI, LIT_WORKER,
      `le due copie divergono:\n      index.ts: ${LIT_WORKER}\n      review.js: ${LIT_UI}`);
    assert.ok(/\(\?:\^\|\[\^A-Za-z0-9\]\)/.test(LIT_WORKER), 'manca il confine sinistro');
    assert.ok(/\(\?!\[A-Za-z0-9\]\)/.test(LIT_WORKER), 'manca il confine destro');
  });

  test('17b. la regex senza confini non esiste piu\' in nessuna delle due copie', () => {
    const vecchia = 'source_email_subject.match(/#?\\s*(\\d{6,10})/)';
    assert.ok(!WORKER.includes(vecchia), 'index.ts ha ancora la regex senza confini');
    assert.ok(!UI.includes(vecchia), 'vendor-documents-review.js ha ancora la regex senza confini');
  });

  test('18. la classificazione blocking nomina BEK_NO_SALES_ORDER in TUTTI e quattro i punti', () => {
    // Due gate indipendenti (meccanismi diversi, stesso effetto richiesto) e
    // due liste di severity. Un codice presente in uno solo dei gate significa
    // documento bloccato dal worker e approvabile dalla UI.
    const punti = [
      ['index.ts / isBlockingWarning (gate worker)',
        /if \(code === 'BEK_NO_SALES_ORDER'\) return true;/.test(WORKER)],
      ['vendor-documents-review.js / vdrWarningToQuestion (gate UI)',
        /if \(w\.code === 'BEK_NO_SALES_ORDER'\)/.test(UI)],
      ['index.ts / vdrCodeToSeverityLite (etichetta)',
        /const blocking = \[[^\]]*'BEK_NO_SALES_ORDER'[^\]]*\]/.test(WORKER)],
      ['vendor-documents-review.js / vdrCodeToSeverity (etichetta)',
        /const blocking = \[[^\]]*'BEK_NO_SALES_ORDER'[^\]]*\]/.test(UI)],
    ];
    const mancanti = punti.filter(([, ok]) => !ok).map(([n]) => n);
    assert.strictEqual(mancanti.length, 0, 'BEK_NO_SALES_ORDER manca in:\n      ' + mancanti.join('\n      '));
  });

  test('18b. i codici bloccanti del worker restano un superset stabile', () => {
    // Guardia contro la rimozione silenziosa di una barriera gia' conquistata.
    const f = WORKER.slice(WORKER.indexOf('function isBlockingWarning'));
    for (const code of ['BEK_REVISION_UNKNOWN', 'BEK_REVISION_AFTER_IMPORT',
                        'PARSE_ERROR_NO_LINES', 'BEK_NO_SALES_ORDER', 'DOC-TOTAL-001']) {
      assert.ok(f.includes(`'${code}'`), `isBlockingWarning non nomina piu' ${code}`);
    }
  });

  console.log(`\n  ${pass} pass, ${fail} fail\n`);
  process.exit(fail ? 1 : 0);
})();
