// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 71 — una classe BEK incerta deve fallire chiusa DA SOLA.
//
// Finding di MT70. Il gate fail-closed di MT65 era:
//
//     if (live.length > 0 && (!bekRankIsCertain(meRank) || incerti.length))
//
// cioe' un documento di classe incerta veniva fermato solo se aveva
// almeno un fratello vivo. Un `ambiguous` di CUCINA senza fratelli
// scavalcava il gate, arrivava in fondo a Phase A come 'pending' senza
// warning e finiva selezionabile da Phase B.
//
// L'intenzione contraria era gia' scritta nel codice, in vdaiApprove:
//   "The 'ambiguous' class ... deliberately does NOT land here: it fails
//    closed as a blocking warning so a human looks at it."
// Non era pero' realizzata nel caso isolato. MT71 la realizza togliendo
// `live.length > 0` dalla condizione: l'incertezza e' una proprieta' del
// documento, non del numero di fratelli.
//
// Questi test guidano la FUNZIONE DI PRODUZIONE (processOneQueuedDoc,
// vdaiPreflight, vdaiApprove da pure_logic.cjs = index.ts transpilato)
// su HTML BEK reale, non una riscrittura della regola.
//
// `node tests/bek-ambiguous-fail-closed.test.js`
// ══════════════════════════════════════════════════════════════════
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { processOneQueuedDoc, vdaiPreflight, vdaiApprove, loadParsers,
        bekRevisionRank, bekRankIsCertain, isBlockingWarning } = require('../pure_logic.cjs');
const F = require('./fixtures/bek-html-real-shape');

const WORKER = fs.readFileSync(
  path.join(__dirname, '..', 'edge-functions', 'vendor-doc-auto-import', 'index.ts'), 'utf8');

let pass = 0, fail = 0;
async function atest(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message ? e.message : e)); }
}

// Mock Supabase minimale — stessa forma di tests/bek-phase-a-body-only.test.js
function makeMockSb(tables) {
  const calls = { storageRemoves: 0 };
  function builder(tableName) {
    const state = { table: tableName, filters: [], single: false, insertRows: null, updateData: null, limitN: null };
    const api = {
      select() { return api; },
      eq(c, v) { state.filters.push(['eq', c, v]); return api; },
      neq(c, v) { state.filters.push(['neq', c, v]); return api; },
      in(c, v) { state.filters.push(['in', c, v]); return api; },
      not() { return api; },
      limit(n) { state.limitN = n; return api; },
      order() { return api; },
      single() { state.single = true; return exec(); },
      insert(rows) { state.insertRows = Array.isArray(rows) ? rows : [rows]; state.op = 'insert'; return api; },
      update(d) { state.updateData = d; state.op = 'update'; return api; },
      then(res, rej) { return run().then(res, rej); },
    };
    function run() {
      if (state.op === 'insert') return write('insert');
      if (state.op === 'update') return write('update');
      return exec();
    }
    function filt(rows) {
      return rows.filter((r) => state.filters.every((f) => {
        if (f[0] === 'eq') return r[f[1]] === f[2];
        if (f[0] === 'neq') return r[f[1]] !== f[2];
        if (f[0] === 'in') return f[2].includes(r[f[1]]);
        return true;
      }));
    }
    async function exec() {
      let rows = filt(tables[tableName] || []);
      if (state.limitN) rows = rows.slice(0, state.limitN);
      if (state.single) return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } };
      return { data: rows, error: null };
    }
    async function write(kind) {
      tables[tableName] = tables[tableName] || [];
      if (kind === 'insert') { tables[tableName].push(...state.insertRows); return { data: state.insertRows, error: null }; }
      const m = filt(tables[tableName]);
      m.forEach((r) => Object.assign(r, state.updateData));
      return { data: m, error: null };
    }
    return api;
  }
  return {
    calls, tables,
    from: (t) => builder(t),
    storage: { from: () => ({ remove: async () => { calls.storageRemoves++; return {}; } }) },
  };
}

const ZENO = (html) => html.replace(/raven_wolf_1510@yahoo\.com/g, 'zeno@zenosonthesquare.com');

function bekDoc(html, overrides = {}) {
  return Object.assign({
    id: 'doc-1',
    vendor: 'Ben E. Keith',
    document_type: 'order_confirmation',
    status: 'pdf_received',
    source_email_subject: "Ben E. Keith : Order Confirmation for FDF770366-ZENO'S ON THE SQUARE;0009444555",
    created_at: '2026-09-20T10:00:00Z',
    parsed_json: { source: 'email_html' },
    raw_text: html,
  }, overrides);
}

function warn(row, code) {
  return (Array.isArray(row.warnings) ? row.warnings : []).find((w) => w && w.code === code) || null;
}

// Il documento come lo vede Phase B: la query qB seleziona per status
// 'pending' e filtra con isPurchasableDocument su parsed_json/colonne.
async function faseB(sb, row) {
  const pre = await vdaiPreflight(sb, row);
  const approvato = await vdaiApprove(sb, row.id);
  const righe = (sb.tables.invoice_lines || []).length;
  return { pre, approvato, righe };
}

(async () => {
  console.log('\nMICRO-TASK 71 — ambiguous isolato: fail closed\n');
  const parsers = loadParsers();

  // ── L. ambiguous KITCHEN isolato ───────────────────────────────
  await atest('L. ambiguous KITCHEN senza fratelli -> pending + BEK_REVISION_UNKNOWN', async () => {
    const doc = bekDoc(F.BEK_AMBIGUOUS_CANCELLED);
    const sb = makeMockSb({ vendor_documents: [doc], invoice_lines: [] });
    const r = await processOneQueuedDoc(sb, doc, parsers);

    assert.strictEqual(r.outcome, 'bek_revision_unknown',
      'doveva fermarsi nel ramo fail-closed, invece: ' + r.outcome);
    const row = sb.tables.vendor_documents[0];
    assert.strictEqual(row.status, 'pending', 'deve restare pending');
    const w = warn(row, 'BEK_REVISION_UNKNOWN');
    assert.ok(w, 'manca il warning BEK_REVISION_UNKNOWN');
    assert.strictEqual(w.severity, 'blocking', 'deve essere bloccante');
    assert.deepStrictEqual(w.sibling_ids, [], 'senza fratelli sibling_ids resta vuoto');
    assert.ok(/non e' classificabile con certezza/.test(w.message),
      'il messaggio deve spiegare il caso isolato, non parlare di piu revisioni');
    assert.ok(/revisione manuale/.test(w.message), 'deve chiedere review manuale');
  });

  await atest('L2. ... e Phase B non lo importa: preflight bloccato, zero invoice_lines', async () => {
    const doc = bekDoc(F.BEK_AMBIGUOUS_CANCELLED);
    const sb = makeMockSb({ vendor_documents: [doc], invoice_lines: [] });
    await processOneQueuedDoc(sb, doc, parsers);
    const row = sb.tables.vendor_documents[0];

    const { pre, approvato, righe } = await faseB(sb, row);
    assert.strictEqual(pre.ok, false, 'il preflight deve rifiutare');
    assert.strictEqual(pre.reason, 'open_question',
      'deve essere fermato dalla domanda bloccante, non da un unmatched casuale');
    assert.strictEqual(approvato.ok, false, 'vdaiApprove non deve approvare');
    assert.strictEqual(righe, 0, 'zero invoice_lines');
    assert.notStrictEqual(sb.tables.vendor_documents[0].status, 'imported');
  });

  await atest('L3. il warning BEK_REVISION_UNKNOWN e bloccante per DECISIONE, non per caso', () => {
    assert.strictEqual(isBlockingWarning({ code: 'BEK_REVISION_UNKNOWN' }, null, {}), true,
      'il codice deve essere riconosciuto come bloccante dal preflight');
  });


  // ── M. operational_confirmation KITCHEN isolata ────────────────
  await atest('M. operational_confirmation KITCHEN isolata -> comportamento invariato', async () => {
    // Fixture senza warning di documento: cosi' l'unica cosa che puo'
    // fermare il preflight e' il gate di MT71, ed e' quello che misuriamo.
    const doc = bekDoc(F.BEK_OPERATIONAL_SAME_SO);
    const sb = makeMockSb({ vendor_documents: [doc], invoice_lines: [] });
    const r = await processOneQueuedDoc(sb, doc, parsers);

    assert.strictEqual(r.outcome, 'parsed_pending', 'deve arrivare in fondo a Phase A: ' + r.outcome);
    const row = sb.tables.vendor_documents[0];
    assert.strictEqual(row.status, 'pending');
    assert.strictEqual(warn(row, 'BEK_REVISION_UNKNOWN'), null,
      'una conferma certa non deve ricevere l eccezione');
    assert.strictEqual(row.parsed_json.document_class, 'operational_confirmation',
      'parsed_json deve essere scritto per intero, come prima di MT71');
    const pre = await vdaiPreflight(sb, row);
    assert.notStrictEqual(pre.reason, 'open_question',
      'non deve essere fermata da una domanda bloccante');
    assert.strictEqual(pre.ok, true, 'resta importabile: la fermano solo gli SKU non mappati');
  });

  // ── N. acknowledgement KITCHEN isolato ─────────────────────────
  await atest('N. acknowledgement KITCHEN isolato -> invariato, e zero purchase write', async () => {
    const doc = bekDoc(F.BEK_ACKNOWLEDGEMENT);
    const sb = makeMockSb({ vendor_documents: [doc], invoice_lines: [] });
    const r = await processOneQueuedDoc(sb, doc, parsers);

    assert.strictEqual(r.outcome, 'parsed_pending', 'invariato: arriva in fondo a Phase A');
    const row = sb.tables.vendor_documents[0];
    assert.strictEqual(row.status, 'pending');
    assert.strictEqual(warn(row, 'BEK_REVISION_UNKNOWN'), null,
      'acknowledgement e una classe CERTA (rango 1): non deve diventare incerta');
    assert.strictEqual(bekRankIsCertain(bekRevisionRank(row.parsed_json, row.created_at)), true);

    const approvato = await vdaiApprove(sb, row.id);
    assert.strictEqual(approvato.reason, 'acknowledgement_not_a_purchase',
      'la barriera di MT42 deve continuare a parcheggiarlo');
    assert.strictEqual(sb.tables.vendor_documents[0].status, 'ignored');
    assert.strictEqual((sb.tables.invoice_lines || []).length, 0, 'zero invoice_lines');
  });

  // ── O. ambiguous CON fratello ──────────────────────────────────
  await atest('O. ambiguous con fratello vivo -> fail closed di MT65 invariato', async () => {
    const fratello = bekDoc(F.BEK_OPERATIONAL_SAME_SO, {
      id: 'doc-fratello', status: 'pending', created_at: '2026-09-20T09:00:00Z',
      document_number: '0009444555',
    });
    const doc = bekDoc(F.BEK_AMBIGUOUS_CANCELLED);
    const sb = makeMockSb({ vendor_documents: [fratello, doc], invoice_lines: [] });
    const r = await processOneQueuedDoc(sb, doc, parsers);

    assert.strictEqual(r.outcome, 'bek_revision_unknown');
    const row = sb.tables.vendor_documents.find((x) => x.id === 'doc-1');
    assert.strictEqual(row.status, 'pending');
    const w = warn(row, 'BEK_REVISION_UNKNOWN');
    assert.ok(w && w.severity === 'blocking');
    assert.deepStrictEqual(w.sibling_ids, ['doc-fratello'],
      'con fratelli sibling_ids deve essere conservato come prima di MT71');
    assert.ok(/ha piu' revisioni/.test(w.message),
      'con fratelli il messaggio resta quello di MT65');
    assert.ok(/ambiguous/.test(w.message), 'deve elencare le classi viste');
  });

  // ── P. ambiguous ZENO ──────────────────────────────────────────
  await atest('P. ambiguous ZENO -> lo ferma il buyer guard, prima del gate di classe', async () => {
    const doc = bekDoc(ZENO(F.BEK_AMBIGUOUS_CANCELLED));
    const sb = makeMockSb({ vendor_documents: [doc], invoice_lines: [] });
    const r = await processOneQueuedDoc(sb, doc, parsers);

    assert.strictEqual(r.outcome, 'ignored_buyer_excluded',
      'il buyer guard sta prima e deve continuare a vincere: ' + r.outcome);
    const row = sb.tables.vendor_documents[0];
    assert.strictEqual(row.status, 'ignored');
    assert.ok(warn(row, 'BEK_BUYER_EXCLUDED'), 'manca BEK_BUYER_EXCLUDED');
    assert.strictEqual(warn(row, 'BEK_REVISION_UNKNOWN'), null,
      'un ordine non di cucina non entra nemmeno nella riconciliazione');

    const approvato = await vdaiApprove(sb, row.id);
    assert.strictEqual(approvato.ok, false, 'non deve essere approvabile');
    assert.strictEqual((sb.tables.invoice_lines || []).length, 0, 'zero purchase write');
  });

  // ── Q. classe futura / mai vista ───────────────────────────────
  await atest('Q. classe mai vista, senza fratelli -> fail closed comunque', async () => {
    const finti = Object.assign(Object.create(Object.getPrototypeOf(parsers)), parsers, {
      parse: (text) => Object.assign({}, parsers.parse(text), { document_class: 'partially_confirmed_v2' }),
    });
    const doc = bekDoc(F.BEK_HTML_REAL_SHAPE);
    const sb = makeMockSb({ vendor_documents: [doc], invoice_lines: [] });
    const r = await processOneQueuedDoc(sb, doc, finti);

    assert.strictEqual(r.outcome, 'bek_revision_unknown',
      'una classe fuori da BEK_CLASS_RANK non deve prendere rango per sbaglio: ' + r.outcome);
    const row = sb.tables.vendor_documents[0];
    assert.strictEqual(row.status, 'pending');
    const w = warn(row, 'BEK_REVISION_UNKNOWN');
    assert.ok(w && w.severity === 'blocking');
    assert.ok(/partially_confirmed_v2/.test(w.message), 'il messaggio deve nominare la classe vista');
  });

  await atest('Q2. il rango di una classe mai vista resta incerto, non zero', () => {
    const r = bekRevisionRank({ document_class: 'partially_confirmed_v2', items: [{ qty: 3 }] }, '2026-09-20');
    assert.strictEqual(r.rank, null, 'nessun rango numerico, nemmeno 0');
    assert.strictEqual(bekRankIsCertain(r), false);
  });

  // ── Pin di regressione sul sorgente ────────────────────────────
  await atest('R. il gate fail-closed non dipende piu dal numero di fratelli', () => {
    const f = WORKER.slice(WORKER.indexOf('MICRO-TASK 42, section F'));
    const gate = f.slice(f.indexOf('const incerti ='), f.indexOf('const betterSibling'));
    assert.ok(/BEK_REVISION_UNKNOWN/.test(gate), 'il gate deve ancora scrivere l eccezione');
    assert.ok(!/live\.length > 0 &&/.test(gate),
      'live.length > 0 non deve piu condizionare il gate: era il difetto di MT70');
    assert.ok(/if \(!bekRankIsCertain\(meRank\) \|\| incerti\.length > 0\)/.test(gate),
      'la condizione deve dipendere solo dalla certezza delle classi');
    assert.ok(/live\.length > 0/.test(gate),
      'live.length serve ancora a scegliere il messaggio, non a decidere se bloccare');
  });

  console.log('\n  ' + pass + ' passati, ' + fail + ' falliti\n');
  process.exit(fail ? 1 : 0);
})();
