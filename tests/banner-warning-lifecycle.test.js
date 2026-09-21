// ─────────────────────────────────────────────────────────────────────
// INV08F — il lifecycle dei warning fuori dalla Vendor Review
//
// Il difetto speculare a quello di INV06B: la Vendor Review puliva il
// documento e lasciava aperta la riga; il banner chiude la riga e
// lasciava sporco il documento. Risultato dimostrato in produzione:
// 07016705 fermo in pending dal 27 giugno con i suoi tre warning gia'
// risolti in invoice_warnings.
//
// Le funzioni sotto test sono ESTRATTE DAL SORGENTE, non ricopiate: se
// qualcuno le cambia, questi test misurano la versione cambiata.
// ─────────────────────────────────────────────────────────────────────
'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const ROOT = path.join(__dirname, '..');
const VDR  = fs.readFileSync(path.join(ROOT, 'js/vendor-documents-review.js'), 'utf8');
const BAN  = fs.readFileSync(path.join(ROOT, 'js/warnings-banner.js'), 'utf8');
const SC   = fs.readFileSync(path.join(ROOT, 'js/souschef-warnings.js'), 'utf8');

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

const LIFECYCLE = grab(VDR,
  'function vdrLocateWarningInDocument(doc, row) {',
  'window.vdrLocateWarningInDocument = vdrLocateWarningInDocument;');

// ── Supabase finto che REGISTRA ogni scrittura ───────────────────────
function fakeSb(cfg) {
  cfg = cfg || {};
  const log = { updates: [], rpc: [], selects: [] };
  const sb = {
    from(table) {
      return {
        select() {
          return {
            eq(_k, id) {
              return {
                single: async () => {
                  log.selects.push({ table, id });
                  if (table === 'vendor_documents') {
                    return cfg.docError
                      ? { data: null, error: { message: 'boom' } }
                      : { data: cfg.doc, error: null };
                  }
                  return { data: cfg.row, error: null };
                },
              };
            },
          };
        },
        update(patch) {
          return {
            eq: async (_k, id) => {
              log.updates.push({ table, id, patch });
              return { error: cfg.updateError ? { message: 'update fallita' } : null };
            },
          };
        },
      };
    },
    async rpc(name, args) {
      log.rpc.push({ name, args });
      if (cfg.rpcError) return { data: null, error: { message: cfg.rpcError } };
      return { data: { ok: true, warning_state: cfg.warningState || 'closed' }, error: null };
    },
  };
  return { sb, log };
}

function loadLifecycle() {
  global.window = { _currentUser: 'Tester' };
  const fn = new Function(LIFECYCLE + '\nreturn { vdrResolveWarningFromRow, vdrLocateWarningInDocument, vdrDocumentHasWarningCode };');
  return fn();
}
const L = loadLifecycle();

// ── Documenti finti, nella forma reale ───────────────────────────────
const ROW = { id: 'w1', code: 'OQR-007', document_id: 'd1',
              item_description: 'LETTUCE ROMAINE HEARTS',
              message: 'Qty mismatch: ordered 1, shipped 0 of LETTUCE ROMAINE HEARTS' };

const docWith = (extra) => ({
  id: 'd1', warnings: [],
  parsed_json: { items: [
    { description: 'LETTUCE ROMAINE HEARTS', warnings: [
        { code: 'OQR-007', message: ROW.message } ].concat(extra || []) },
    { description: 'SPINACH BABY', warnings: [] },
  ] },
});

// ═══ 3. LA PROVA DEL BUG PRE-PATCH ═══════════════════════════════════

test('B1. PRE-PATCH: la vecchia UPDATE chiudeva la riga e lasciava il documento sporco', () => {
  // Riproduce l'operazione esatta di prima della patch.
  const doc = docWith();
  const riga = { status: 'open' };
  riga.status = 'resolved';                     // <- tutto quello che faceva
  const ancoraNelDoc = doc.parsed_json.items[0].warnings
    .filter(w => w.code === 'OQR-007').length;
  assert.strictEqual(riga.status, 'resolved', 'la riga risultava chiusa');
  assert.strictEqual(ancoraNelDoc, 1,
    'ma il warning restava nel documento: e il worker legge il documento');
});

test('B2. il sorgente non contiene piu' + "'" + ' nessuna UPDATE diretta su invoice_warnings', () => {
  const diretta = /from\(['"]invoice_warnings['"]\)[\s\S]{0,80}?\.update\(/;
  assert.ok(!diretta.test(BAN), 'warnings-banner.js ha ancora una UPDATE diretta');
  assert.ok(!diretta.test(SC),  'souschef-warnings.js ha ancora una UPDATE diretta');
});

// ═══ 6. I TEST RICHIESTI ═════════════════════════════════════════════

test('1. document-linked: documento e riga risolti INSIEME, in una sola chiamata', async () => {
  const { sb, log } = fakeSb({ row: ROW, doc: docWith() });
  const r = await L.vdrResolveWarningFromRow(sb, ROW, { resolution: 'short_ok' });
  assert.strictEqual(log.rpc.length, 1, 'una sola operazione');
  assert.strictEqual(log.rpc[0].name, 'vdr_resolve_warning');
  assert.strictEqual(log.updates.length, 0, 'nessuna UPDATE separata sulla riga');
  assert.strictEqual(r.mode, 'document');
  assert.strictEqual(r.removed, true);
  const pj = log.rpc[0].args.p_parsed_json;
  assert.strictEqual(pj.items[0].warnings.length, 0, 'il warning e\' sparito dal documento');
});

test('2. fallimento lato documento -> zero commit parziali', async () => {
  const { sb, log } = fakeSb({ row: ROW, docError: true });
  await assert.rejects(() => L.vdrResolveWarningFromRow(sb, ROW, {}),
    /Documento non leggibile/);
  assert.strictEqual(log.rpc.length, 0, 'non deve nemmeno provare a scrivere');
  assert.strictEqual(log.updates.length, 0, 'la riga non va chiusa da sola');
});

test('3. fallimento lato invoice_warnings -> zero commit parziali', async () => {
  const { sb, log } = fakeSb({ row: ROW, doc: docWith(), rpcError: 'riga non aggiornata' });
  await assert.rejects(() => L.vdrResolveWarningFromRow(sb, ROW, {}), /riga non aggiornata/);
  assert.strictEqual(log.updates.length, 0,
    'nessun ripiego su una UPDATE diretta dopo il fallimento della RPC');
});

test('4. targeting per id ESATTO, mai per codice', async () => {
  const { sb, log } = fakeSb({ row: ROW, doc: docWith() });
  await L.vdrResolveWarningFromRow(sb, ROW, {});
  assert.strictEqual(log.rpc[0].args.p_warning_id, 'w1');
  assert.strictEqual(log.rpc[0].args.p_warning_code, 'OQR-007',
    'il codice va passato come termine di verifica, non come selettore');
});

test('5. due warning stesso codice: chiude solo quello selezionato', async () => {
  // Stesso code su un ALTRO articolo: la chiave include item_description
  // e message, quindi i due non si confondono.
  const doc = docWith();
  doc.parsed_json.items[1].warnings.push(
    { code: 'OQR-007', message: 'Qty mismatch: ordered 2, shipped 1 of SPINACH BABY' });
  const { sb, log } = fakeSb({ row: ROW, doc });
  await L.vdrResolveWarningFromRow(sb, ROW, {});
  const pj = log.rpc[0].args.p_parsed_json;
  assert.strictEqual(pj.items[0].warnings.length, 0, 'il selezionato e\' rimosso');
  assert.strictEqual(pj.items[1].warnings.length, 1, 'l\'altro resta intatto');
});

test('6. correlazione ambigua -> FAIL CLOSED', async () => {
  // Due rappresentazioni identiche per chiave: non si puo' scegliere.
  const doc = docWith([{ code: 'OQR-007', message: ROW.message }]);
  const { sb, log } = fakeSb({ row: ROW, doc });
  await assert.rejects(() => L.vdrResolveWarningFromRow(sb, ROW, {}),
    /Correlazione ambigua \(2 candidati/);
  assert.strictEqual(log.rpc.length, 0, 'non tocca niente');
});

test('6b. zero candidati ma il codice C\'E\' nel documento -> FAIL CLOSED', async () => {
  const doc = { id: 'd1', warnings: [], parsed_json: { items: [
    { description: 'ALTRO ARTICOLO', warnings: [{ code: 'OQR-007', message: 'altro messaggio' }] }] } };
  const { sb, log } = fakeSb({ row: ROW, doc });
  await assert.rejects(() => L.vdrResolveWarningFromRow(sb, ROW, {}),
    /nessuno corrisponde a questa riga/);
  assert.strictEqual(log.rpc.length, 0);
  assert.strictEqual(log.updates.length, 0, 'NON rimuove "il primo con quel code"');
});

test('7. documento gia\' pulito -> chiude solo la riga, documento invariato', async () => {
  const doc = { id: 'd1', warnings: [], parsed_json: { items: [
    { description: 'LETTUCE ROMAINE HEARTS', warnings: [] }] } };
  const { sb, log } = fakeSb({ row: ROW, doc, warningState: 'closed' });
  const r = await L.vdrResolveWarningFromRow(sb, ROW, {});
  assert.strictEqual(r.removed, false);
  assert.strictEqual(log.rpc.length, 1, 'passa comunque dalla RPC: una sola operazione logica');
  assert.deepStrictEqual(log.rpc[0].args.p_parsed_json, doc.parsed_json, 'documento invariato');
});

test('7b. riga gia\' chiusa -> idempotente, la risoluzione storica non si riscrive', async () => {
  const { sb, log } = fakeSb({ row: ROW, doc: docWith(), warningState: 'already_closed' });
  const r = await L.vdrResolveWarningFromRow(sb, ROW, {});
  assert.strictEqual(r.warning_state, 'already_closed');
  assert.strictEqual(log.updates.length, 0,
    'nessuna scrittura diretta che sovrascriverebbe resolved_at');
});

test('8. warning autonomo (document_id NULL) -> lifecycle per id esatto, nessuna RPC', async () => {
  const standalone = { id: 'w9', code: 'SC-001', document_id: null,
                       item_description: 'Domanda SousChef', message: 'm' };
  const { sb, log } = fakeSb({ row: standalone });
  const r = await L.vdrResolveWarningFromRow(sb, standalone, { resolution: 'fatto' });
  assert.strictEqual(r.mode, 'standalone');
  assert.strictEqual(log.rpc.length, 0, 'non va forzato dentro una RPC documentale');
  assert.strictEqual(log.updates.length, 1);
  assert.strictEqual(log.updates[0].id, 'w9', 'per id esatto');
  assert.strictEqual(log.updates[0].patch.resolution, 'fatto');
});

// ═══ I TRE PERCORSI, VERIFICATI SUL SORGENTE ═════════════════════════

test('9. bannerOQRAnswer passa dal lifecycle condiviso e fallisce chiuso', () => {
  const f = grab(BAN, 'window.bannerOQRAnswer = async function', '\n};');
  assert.ok(/vdrResolveWarningFromRow\(sb, row,/.test(f), 'deve delegare');
  assert.ok(/return;\s*\/\/ fail closed/.test(f), 'su errore non deve proseguire');
  assert.ok(!/from\(['"]invoice_warnings['"]\)[\s\S]{0,60}\.update\(/.test(f));
});

test('10. scDismissWarning passa dal lifecycle condiviso', () => {
  const f = grab(SC, 'window.scDismissWarning = async function', '\n};');
  assert.ok(/vdrResolveWarningFromRow\(sb, row,/.test(f), 'deve delegare');
  assert.ok(/skip — rivisto manualmente/.test(f), 'la resolution storica resta quella');
  assert.ok(!/from\(['"]invoice_warnings['"]\)[\s\S]{0,60}\.update\(/.test(f));
});

test('11. scApplyWarningOption — il terzo percorso trovato nella call graph', () => {
  const f = grab(SC, 'window.scApplyWarningOption = async function', 'scSendWarningToChat');
  assert.ok(/vdrResolveWarningFromRow\(sb, w,/.test(f),
    'usa `w`, la riga gia\' letta fresca, che porta document_id');
  assert.ok(!/from\(['"]invoice_warnings['"]\)[\s\S]{0,60}\.update\(/.test(f));
});

test('12. il percorso Vendor Review resta invariato', () => {
  assert.ok(/async function vdrResolveWarningAtomic\(sb, docId, updatedWarn, updatedPj, q, resolution, warnLabel\)/.test(VDR),
    'la firma non deve cambiare');
  assert.ok(/vdrWarningRowExpected\(docId, q\) && !\(q && q\.invoiceWarningId\)/.test(VDR),
    'il suo fail-closed resta al suo posto');
});

test('13. OQR-009 non e\' toccata da questo task', () => {
  const before = fs.readFileSync(path.join(ROOT, 'js/vendor-documents-review.js'), 'utf8');
  assert.ok(before.includes('OQR-009'), 'il codice esiste ancora');
  assert.ok(!LIFECYCLE.includes('OQR-009'),
    'il lifecycle nuovo non fa nessun caso speciale su OQR-009');
});

test('14. il lifecycle non tocca invoice_lines ne\' lo status del documento', () => {
  assert.ok(!/invoice_lines/.test(LIFECYCLE), 'nessun riferimento a invoice_lines');
  assert.ok(!/status['"]?\s*:\s*['"](pending|imported|pdf_received)/.test(LIFECYCLE),
    'nessuna transizione di stato del documento');
  const args = LIFECYCLE.match(/p_[a-z_]+:/g) || [];
  assert.deepStrictEqual([...new Set(args)].sort(),
    ['p_document_id:','p_parsed_json:','p_resolution:','p_resolved_by:','p_status:','p_warning_code:','p_warning_id:','p_warnings:'],
    'passa esattamente gli 8 parametri del contratto, niente di piu\'');
});

// ═══ MUTAZIONE ═══════════════════════════════════════════════════════

test('15. mutazione: la vecchia UPDATE diretta non supererebbe i test document-linked', async () => {
  const vecchio = async (sb, row) => {
    await sb.from('invoice_warnings').update({ status: 'resolved' }).eq('id', row.id);
    return { mode: 'legacy' };
  };
  const { sb, log } = fakeSb({ row: ROW, doc: docWith() });
  await vecchio(sb, ROW);
  assert.strictEqual(log.rpc.length, 0,
    'la vecchia via non chiama la RPC: il test 1 fallirebbe');
  assert.strictEqual(log.updates.length, 1,
    'e scrive solo la riga: il documento resterebbe sporco');
});

(async () => {
  for (const [n, f] of queue) {
    try { await f(); console.log('  ✓ ' + n); pass++; }
    catch (e) { console.log('  ✗ ' + n + '\n      ' + e.message); fail++; }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
