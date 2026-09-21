// ─────────────────────────────────────────────────────────────────────
// INV08C — i credit memo hanno un percorso contabile loro
//
// Un credito non e' una fattura negativa. Finisce in vendor_credits,
// non in invoice_lines, e l'idempotenza la garantisce un indice unico
// del database, non un "select poi insert".
//
// Le fixture sono i quattro credit memo Hardie's reali.
// ─────────────────────────────────────────────────────────────────────
'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const ROOT   = path.join(__dirname, '..');
const { vdaiApproveCredit, vdaiValidateCredit, vdaiCreditFields } = require(path.join(ROOT, 'pure_logic.cjs'));

let pass = 0, fail = 0;
const queue = [];
const test = (n, f) => queue.push([n, f]);
const HARDIES = "Hardie's Fresh Foods / Dairyland Produce";

// I quattro crediti veri, nella forma esatta del loro parsed_json.
const CREDITI = {
  '00668419': { total: -49.92,  credit_date: '2026-06-06', original_order_number: '06991299',
    items: [{ amount: -49.92, vendor_sku: '01866', description: 'WATERMELON SEEDLESS',
              return_code: 'UD', qty_credited: 1 }] },
  '00675518': { total: -59.99,  credit_date: '2026-08-05', original_order_number: '07059129',
    items: [{ amount: -59.99, vendor_sku: '03744', description: 'WHIPPING CREAM',
              return_code: 'UD', qty_credited: 1 }] },
  '00679556': { total: -202.37, credit_date: '2026-09-02', original_order_number: '07106025',
    items: [{ amount: -38.56,  vendor_sku: '27786', description: 'CHZ MOZZ THIN SLICE 21 SLI/LB',
              return_code: 'UD', qty_credited: 1 },
             { amount: -163.81, vendor_sku: '00912', description: 'CHZ PECORINO ROMANO',
              return_code: 'UD', qty_credited: 1 }] },
  '00680317': { total: -82.99,  credit_date: '2026-09-09', original_order_number: '07115822',
    items: [{ amount: -82.99, vendor_sku: '13379', description: 'EGG LIQUID YOLK',
              return_code: 'UD', qty_credited: 1 }] },
};
const pj = (n) => Object.assign({ vendor: HARDIES, document_type: 'credit_memo' }, CREDITI[n]);

// ── Database finto con UNICITA' VERA su vendor_document_id ──────────
function fakeDb(cfg) {
  cfg = cfg || {};
  const stato = { credits: [], lines: [], docUpdates: [], upsertCalls: 0 };
  const doc = cfg.doc || { parsed_json: pj('00668419'), vendor: HARDIES, status: 'pending',
                           document_number: '00668419', document_date: '2026-06-06',
                           document_type: 'credit_memo' };
  // Catena chainable come PostgREST: .select().eq().eq().eq().limit()
  // e .select().eq().single(). Ogni .eq() restituisce la stessa catena.
  const sb = {
    from(t) {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        limit: async () => ({ data: cfg.originali || [] }),
        single: async () => ({ data: doc, error: cfg.fetchError ? { message: 'boom' } : null }),
        async upsert(row, opts) {
          stato.upsertCalls++;
          if (cfg.upsertError) return { error: { message: cfg.upsertError } };
          // L'indice unico del database, riprodotto: la chiave e'
          // vendor_document_id, e un conflitto SOSTITUISCE la riga.
          const chiave = (opts && opts.onConflict) || 'vendor_document_id';
          if (cfg.senzaVincolo) { stato.credits.push(row); return { error: null }; }
          const i = stato.credits.findIndex(r => r[chiave] === row[chiave]);
          if (i >= 0) stato.credits[i] = row; else stato.credits.push(row);
          return { error: null };
        },
        update(patch) { return { eq: async () => { stato.docUpdates.push(patch); return { error: null }; } }; },
        insert: async (rows) => { stato.lines.push(...(Array.isArray(rows) ? rows : [rows])); return { error: null }; },
      };
      return chain;
    },
  };
  return { sb, stato, doc };
}

// ═══ VALIDAZIONE ═════════════════════════════════════════════════════

test('4. il segno arriva dal source: importi gia\' negativi, nessuna doppia negazione', () => {
  for (const n of Object.keys(CREDITI)) {
    const f = vdaiCreditFields({ vendor: HARDIES, document_number: n }, pj(n), 'doc-' + n);
    assert.ok(f.amount < 0, n + ' deve restare negativo');
    assert.strictEqual(f.amount, CREDITI[n].total, n + ': l\'importo e\' quello del parser, intatto');
  }
});

test('4b. i quattro insieme fanno -395,27', () => {
  const somma = Object.keys(CREDITI)
    .map(n => vdaiCreditFields({ vendor: HARDIES, document_number: n }, pj(n), 'd').amount)
    .reduce((a, b) => a + b, 0);
  assert.strictEqual(Math.round(somma * 100) / 100, -395.27);
});

test('10. un credito malformato fallisce chiuso', () => {
  const casi = [
    [{ total: null, items: [{ amount: -1 }] },                       'credit_no_amount'],
    [{ total: 0, items: [{ amount: 0 }] },                           'credit_zero_amount'],
    [{ total: 49.92, items: [{ amount: 49.92 }] },                   'credit_positive_amount'],
    [{ total: -49.92, items: [] },                                   'credit_no_lines'],
    [{ total: -49.92, items: [{ amount: -10 }] },                    'credit_lines_dont_reconcile'],
  ];
  for (const [p, motivo] of casi) {
    const v = vdaiValidateCredit(p);
    assert.strictEqual(v.ok, false, motivo + ' doveva fallire');
    assert.strictEqual(v.reason, motivo);
  }
  assert.strictEqual(vdaiValidateCredit(pj('00679556')).ok, true, 'un credito sano passa');
});

// ═══ IL WRITER ═══════════════════════════════════════════════════════

const async_ = (n, f) => queue.push([n, f]);

async_('1. credit memo sano -> UNA vendor_credit', async () => {
  const { sb, stato } = fakeDb({ originali: [{ id: 'fattura-originale' }] });
  const r = await vdaiApproveCredit(sb, 'doc-00668419');
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(stato.credits.length, 1);
  const c = stato.credits[0];
  assert.strictEqual(c.vendor_document_id, 'doc-00668419');
  assert.strictEqual(c.amount, -49.92);
  assert.strictEqual(c.credit_number, '00668419');
  assert.strictEqual(c.credit_date, '2026-06-06');
  assert.strictEqual(c.original_order_number, '06991299');
  assert.strictEqual(c.status, 'pending', 'il fornitore ha emesso, nessuno ha confermato');
  assert.deepStrictEqual(c.return_codes, ['UD']);
  assert.strictEqual(c.lines.length, 1, 'le righe restano nel JSON');
});

async_('2. ritentare lo stesso documento non crea duplicati', async () => {
  const { sb, stato } = fakeDb({ originali: [{ id: 'f1' }] });
  await vdaiApproveCredit(sb, 'doc-00668419');
  await vdaiApproveCredit(sb, 'doc-00668419');
  await vdaiApproveCredit(sb, 'doc-00668419');
  assert.strictEqual(stato.upsertCalls, 3, 'tre tentativi veri');
  assert.strictEqual(stato.credits.length, 1, 'una sola riga');
});

async_('3. MUTAZIONE: senza il vincolo unico i duplicati passerebbero', async () => {
  const { sb, stato } = fakeDb({ originali: [{ id: 'f1' }], senzaVincolo: true });
  await vdaiApproveCredit(sb, 'doc-00668419');
  await vdaiApproveCredit(sb, 'doc-00668419');
  assert.strictEqual(stato.credits.length, 2,
    'e\' la prova che l\'idempotenza la regge il database, non il codice');
});

async_('7. un credit memo non crea NESSUNA invoice_line', async () => {
  const { sb, stato } = fakeDb({ originali: [{ id: 'f1' }] });
  await vdaiApproveCredit(sb, 'doc-00668419');
  assert.strictEqual(stato.lines.length, 0);
});

async_('8. original_document_id si popola solo se deterministico', async () => {
  const uno = fakeDb({ originali: [{ id: 'fattura-unica' }] });
  await vdaiApproveCredit(uno.sb, 'd');
  assert.strictEqual(uno.stato.credits[0].original_document_id, 'fattura-unica');

  const due = fakeDb({ originali: [{ id: 'a' }, { id: 'b' }] });
  await vdaiApproveCredit(due.sb, 'd');
  assert.strictEqual(due.stato.credits[0].original_document_id, null,
    'due candidati: non si indovina');
  assert.strictEqual(due.stato.credits[0].original_order_number, '06991299',
    'ma il riferimento leggibile resta');
});

async_('9. senza riferimento originale il credito resta valido', async () => {
  const p = pj('00668419'); delete p.original_order_number;
  const { sb, stato } = fakeDb({ doc: { parsed_json: p, vendor: HARDIES, status: 'pending',
    document_number: '00668419', document_date: '2026-06-06', document_type: 'credit_memo' } });
  const r = await vdaiApproveCredit(sb, 'd');
  assert.strictEqual(r.ok, true, 'un rimborso reale si contabilizza comunque');
  assert.strictEqual(stato.credits[0].original_document_id, null);
  assert.strictEqual(stato.credits[0].amount, -49.92);
});

async_('11. un credito gia\' imported senza vendor_credit e\' recuperabile', async () => {
  const { sb, stato } = fakeDb({ originali: [{ id: 'f1' }],
    doc: { parsed_json: pj('00675518'), vendor: HARDIES, status: 'imported',
           document_number: '00675518', document_date: '2026-08-05', document_type: 'credit_memo' } });
  const r = await vdaiApproveCredit(sb, 'd');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(stato.credits.length, 1, 'la riga contabile nasce');
  assert.strictEqual(stato.docUpdates.length, 0, 'e lo status non viene toccato inutilmente');
  assert.strictEqual(r.reason, 'credit_recorded_existing_status');
});

async_('12. un credito pending viene chiuso normalmente', async () => {
  const { sb, stato } = fakeDb({ originali: [{ id: 'f1' }] });
  await vdaiApproveCredit(sb, 'd');
  assert.strictEqual(stato.docUpdates.length, 1);
  assert.strictEqual(stato.docUpdates[0].status, 'imported');
});

async_('6+. un documento che non e\' un credito viene rifiutato', async () => {
  const { sb, stato } = fakeDb({ doc: { parsed_json: { vendor: HARDIES, document_type: 'order_confirmation',
      total: -10, items: [{ amount: -10 }] }, vendor: HARDIES, status: 'pending',
      document_number: 'X', document_type: 'order_confirmation' } });
  const r = await vdaiApproveCredit(sb, 'd');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'not_credit_memo');
  assert.strictEqual(stato.credits.length, 0);
});

async_('10b. su errore di scrittura il documento NON viene chiuso', async () => {
  const { sb, stato } = fakeDb({ originali: [{ id: 'f1' }], upsertError: 'conflitto' });
  const r = await vdaiApproveCredit(sb, 'd');
  assert.strictEqual(r.ok, false);
  assert.ok(/upsert failed/.test(r.reason));
  assert.strictEqual(stato.docUpdates.length, 0,
    'resta pending, quindi visibile e ritentabile al prossimo giro');
});

// ═══ IL ROUTING ══════════════════════════════════════════════════════

test('5+8. Phase B instrada per tipo contabile, senza rendere il credito acquistabile', () => {
  const src = fs.readFileSync(path.join(ROOT, 'edge-functions/vendor-doc-auto-import/index.ts'), 'utf8');
  assert.ok(/\['invoice', 'order_confirmation', 'credit_memo'\]/.test(src),
    'la coda deve selezionare anche i credit_memo');
  assert.ok(/t === 'credit_memo' \|\| isPurchasableDocument\(v, t\)/.test(src),
    'il filtro ammette i crediti SENZA passare da isPurchasableDocument');
  assert.ok(/tipoDoc === 'credit_memo'\s*\n?\s*\? await vdaiApproveCredit/.test(src),
    'il loop deve instradare al writer dei crediti');
  // E la regola di acquistabilita' NON deve essere stata allargata.
  const pur = src.slice(src.indexOf('function isPurchasableDocument'));
  assert.ok(!/credit_memo/.test(pur.slice(0, 900)),
    'isPurchasableDocument non deve nominare i credit memo');
});

test('16. gli altri vendor non sono toccati', () => {
  const src = fs.readFileSync(path.join(ROOT, 'edge-functions/vendor-doc-auto-import/index.ts'), 'utf8');
  const fn = src.slice(src.indexOf('async function vdaiApproveCredit'),
                       src.indexOf('async function vdaiApprove(sb'));
  // Il writer e' generico sul vendor. Si guarda il CODICE, non i
  // commenti: quelli spiegano il caso Hardie's da cui nasce, ed e'
  // giusto che lo facciano.
  const codice = fn.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  for (const v of ['Hardie', 'Fruge', 'Walmart', 'Keith', 'FreshPoint']) {
    assert.ok(!codice.includes(v), 'il writer dei crediti non deve nominare ' + v + ' nel codice');
  }
  assert.ok(/pj\.vendor \|\| doc\.vendor/.test(codice), 'il vendor arriva dal documento');
});

(async () => {
  for (const [n, f] of queue) {
    try { await f(); console.log('  ✓ ' + n); pass++; }
    catch (e) { console.log('  ✗ ' + n + '\n      ' + e.message); fail++; }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
