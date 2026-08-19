// ══════════════════════════════════════════════════════════════════
// BEK dedup fallback fix — non deve più matchare record di forma
// incompatibile (BOH OS Task 11D)
// Plain Node: `node tests/bek-dedup-fallback-fix.test.js`
//
// Esegue la funzione reale handleBekOrderConfirmationBody() estratta da
// edge-functions/gmail-vendor-import/index.ts (marker espliciti, stessa
// tecnica degli altri test di questa serie) contro un mock minimo di
// Supabase che applica DAVVERO i filtri .eq() reali ai fixture forniti —
// non un mock che restituisce dati preconfezionati a prescindere.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const EDGE_FN_TS = path.join(__dirname, '..', 'edge-functions', 'gmail-vendor-import', 'index.ts');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); } }
async function atest(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); } }

function readSrc() { return fs.readFileSync(EDGE_FN_TS, 'utf8'); }

function extractHandleBekBody() {
  const src = readSrc();
  const startMarker = "const sourceText = html_body || body || '';";
  const endMarker = 'function jsonResponse(data: unknown, status = 200) {';
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    throw new Error('marker non trovati — handleBekOrderConfirmationBody è cambiata di forma?');
  }
  return src.slice(start, end);
}

// Mock minimo: applica DAVVERO ogni .eq() ai fixture forniti (filtro reale,
// non un pass-through), così testiamo se la query COSTRUITA DAL CODICE REALE
// matcherebbe o no un dato record — non se io *credo* che dovrebbe farlo.
function makeMockSupa({ existingRows = [] } = {}) {
  const calls = { selects: [], inserts: [] };
  const sb = {
    from(table) {
      const c = {
        _eqs: [],
        select() { return c; },
        eq(k, v) { c._eqs.push([k, v]); return c; },
        limit() {
          calls.selects.push({ table, eqs: c._eqs.slice() });
          const matched = existingRows.filter(row => c._eqs.every(([k, v]) => row[k] === v));
          return Promise.resolve({ data: matched });
        },
        insert(payload) {
          calls.inserts.push({ table, payload });
          return { select() { return { single() { return Promise.resolve({ data: { id: 'new-doc-uuid' }, error: null }); } }; } };
        },
      };
      return c;
    },
  };
  return { sb, calls };
}

async function runHandleBekBody({ supabase, subject, from, body, html_body }) {
  let snippet = extractHandleBekBody().replace(/:\s*string\s*\|\s*null/g, '');
  snippet = snippet.trim();
  snippet = snippet.slice(0, snippet.lastIndexOf('}')); // strip the function's own closing brace — new Function already wraps the body
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction('supabase', 'subject', 'from', 'body', 'html_body', 'jsonResponse', 'jsonError', snippet);
  const jsonResponse = (data) => data;
  const jsonError = (message) => ({ error: message });
  return fn(supabase, subject, from, body, html_body, jsonResponse, jsonError);
}

const SUBJECT = "Ben E. Keith : Order Confirmation for FDF770366-ZENO'S ON THE SQUARE;0002952908";
const FROM = 'CRP-SVCMBX-entree@benekeith.com';
const BODY_WITH_SALES_ORDER = 'Ben E. Keith Foods\r\nYour order is confirmed\r\nSales Order # 0002952908\r\nCustomer Name\r\n';
const BODY_WITHOUT_SALES_ORDER = 'Ben E. Keith Foods\r\nYour order is confirmed\r\nCustomer Name\r\nZENO\'S ON THE SQUARE\r\n';
// FIX (BOH OS Task 11F): il subject standard contiene sempre il Sales Order
// dopo il ";" (usato ora anche come fallback di estrazione, non solo per il
// dedup) -- per T4a/T4b serve un subject SENZA quel suffisso, altrimenti
// salesOrder non è mai null e il ramo subject+from non scatterebbe davvero.
const SUBJECT_NO_SALES_ORDER_SUFFIX = "Ben E. Keith : Order Confirmation for FDF770366-ZENO'S ON THE SQUARE";

// Fixture: il vecchio record rotto reale (id d84e4d64-...)
const OLD_BROKEN_RECORD = {
  id: 'd84e4d64-4088-43f7-a35a-49d24cb4cfbc',
  status: 'error',
  vendor: 'bek',
  document_type: 'invoice',
  document_number: '770366',
  source_email_subject: SUBJECT,
  source_email_from: FROM,
};

// Variante del record rotto con subject senza suffisso (per T4a)
const OLD_BROKEN_RECORD_NO_SUFFIX = { ...OLD_BROKEN_RECORD, source_email_subject: SUBJECT_NO_SALES_ORDER_SUFFIX };

// Fixture: un vero duplicato corretto (stessa identità del nuovo documento)
const REAL_CORRECT_RECORD = {
  id: 'existing-correct-uuid',
  status: 'pending',
  vendor: 'Ben E. Keith',
  document_type: 'order_confirmation',
  document_number: '0002952908',
  source_email_subject: SUBJECT,
  source_email_from: FROM,
};

console.log('\nBEK dedup fallback fix — test run\n');

(async () => {

  // ── T1 — Caso production reale: il vecchio record rotto NON deve bloccare ──
  await atest('T1: vecchio record rotto (vendor=bek, document_type=invoice, 770366) presente -> NON duplicate', async () => {
    const { sb, calls } = makeMockSupa({ existingRows: [OLD_BROKEN_RECORD] });
    const result = await runHandleBekBody({ supabase: sb, subject: SUBJECT, from: FROM, body: BODY_WITH_SALES_ORDER });
    assert.notStrictEqual(result.status, 'duplicate', 'il record rotto non deve mai essere considerato un duplicato valido');
    assert.strictEqual(result.status, 'queued');
    assert.strictEqual(calls.inserts.length, 1, 'deve procedere con un nuovo insert corretto');
    assert.strictEqual(calls.inserts[0].payload.document_number, '0002952908');
  });

  // ── T2 — Duplicato vero: stesso vendor/tipo/numero -> duplicate ──────────
  await atest('T2: record esistente corretto e identico -> duplicate', async () => {
    const { sb } = makeMockSupa({ existingRows: [REAL_CORRECT_RECORD] });
    const result = await runHandleBekBody({ supabase: sb, subject: SUBJECT, from: FROM, body: BODY_WITH_SALES_ORDER });
    assert.strictEqual(result.status, 'duplicate');
    assert.strictEqual(result.document_id, 'existing-correct-uuid');
  });

  // ── T3 — Sales Order presente: il fallback NON viene interrogato ────────
  await atest('T3: con Sales Order estratto, il fallback subject/from non viene mai interrogato', async () => {
    const { sb, calls } = makeMockSupa({ existingRows: [] });
    await runHandleBekBody({ supabase: sb, subject: SUBJECT, from: FROM, body: BODY_WITH_SALES_ORDER });
    assert.strictEqual(calls.selects.length, 1, 'una sola query select attesa (solo chiave primaria)');
    const keys = calls.selects[0].eqs.map(([k]) => k);
    assert.ok(keys.includes('document_number'), 'deve essere la query a chiave primaria');
    assert.ok(!keys.includes('source_email_subject'), 'il fallback non deve essere interrogato in parallelo');
  });

  // ── T4 — Sales Order assente (né da body né da subject): il fallback protegge, ma solo per record compatibili ──
  await atest('T4a: senza Sales Order (body e subject), il vecchio record rotto (forma incompatibile) NON blocca più', async () => {
    const { sb } = makeMockSupa({ existingRows: [OLD_BROKEN_RECORD_NO_SUFFIX] });
    const result = await runHandleBekBody({ supabase: sb, subject: SUBJECT_NO_SALES_ORDER_SUFFIX, from: FROM, body: BODY_WITHOUT_SALES_ORDER });
    assert.notStrictEqual(result.status, 'duplicate');
  });

  await atest('T4b: senza Sales Order (body e subject), un record realmente compatibile (stesso subject/from, vendor/document_type corretti) blocca correttamente', async () => {
    const compatibleNoNumber = { ...REAL_CORRECT_RECORD, document_number: null, source_email_subject: SUBJECT_NO_SALES_ORDER_SUFFIX };
    const { sb } = makeMockSupa({ existingRows: [compatibleNoNumber] });
    const result = await runHandleBekBody({ supabase: sb, subject: SUBJECT_NO_SALES_ORDER_SUFFIX, from: FROM, body: BODY_WITHOUT_SALES_ORDER });
    assert.strictEqual(result.status, 'duplicate');
  });

  // ── T5 — Zeri iniziali ────────────────────────────────────────────────
  await atest('T5: document_number resta stringa con zeri iniziali nella riga insert e nella dedup', async () => {
    const { sb, calls } = makeMockSupa({ existingRows: [] });
    await runHandleBekBody({ supabase: sb, subject: SUBJECT, from: FROM, body: BODY_WITH_SALES_ORDER });
    assert.strictEqual(calls.inserts[0].payload.document_number, '0002952908');
    assert.strictEqual(typeof calls.inserts[0].payload.document_number, 'string');
    const primaryQueryEqs = calls.selects[0].eqs;
    const docNumEq = primaryQueryEqs.find(([k]) => k === 'document_number');
    assert.strictEqual(docNumEq[1], '0002952908');
  });

  // ── T6 — Vendor PDF invariati ─────────────────────────────────────────
  test('T6: percorso PDF esistente (altri vendor) invariato nel sorgente', () => {
    const src = readSrc();
    assert.ok(src.includes("if (!pdf_base64) {"));
    assert.ok(src.includes("await supabase.storage"));
    assert.ok(src.includes("document_type:        'invoice',"));
    assert.ok(src.includes("if (/fruge/i.test(hint))           vendorHint = 'Fruge Seafood';"));
    // La query subject+from PDF-path (fuori da handleBekOrderConfirmationBody)
    // resta la stessa di prima -- non tocca vendor/document_type.
    const pdfDedupBlock = src.slice(src.indexOf('// Duplicate check by subject + from'), src.indexOf('// Save PDF to Supabase Storage'));
    assert.ok(pdfDedupBlock.includes(".eq('source_email_subject', subject)"));
    assert.ok(!pdfDedupBlock.includes("eq('vendor'"), 'il dedup del path PDF non deve essere toccato da questo fix');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
