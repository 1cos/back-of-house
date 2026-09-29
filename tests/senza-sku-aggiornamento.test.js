// ══════════════════════════════════════════════════════════════════
// GG09 — FORNITORI SENZA SKU: il prezzo si crea E si aggiorna.
//
// Questi test NON provano mergePriceIntelligence isolatamente: e' quel
// tipo di simulazione che in GG08 mi ha fatto prevedere un
// aggiornamento che non e' avvenuto. La funzione, da sola, diceva
// "rescue_same_pack, $1,1936" — ma vdrDecideCanonicalUpdate, che le sta
// davanti, rispondeva 'skip' e lei non veniva mai chiamata.
//
// Qui gira il PERCORSO VERO: window.vdrApprove estratta senza modifiche
// da js/vendor-documents-review.js e guidata contro un finto Supabase,
// esattamente come fa gia'
// tests/vendor-review-alias-price-intelligence-client.test.js. Si
// osserva cosa finisce davvero in ingredient_vendors e in
// invoice_lines.
//
// In coda, la parita' col worker: entrambe le copie della decisione
// vengono estratte dal sorgente e confrontate su tutta la tabella di
// verita'. Se qualcuno ne cambia una sola, il test fallisce.
// ══════════════════════════════════════════════════════════════════

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

global.vdrIsPurchasableDocument =
  require('../js/vendor-parsers/ben-e-keith-order-confirmation').isPurchasableDocument;

const VDR_JS = path.join(__dirname, '..', 'js', 'vendor-documents-review.js');
const WORKER = path.join(__dirname, '..', 'edge-functions', 'vendor-doc-auto-import', 'index.ts');
const src = fs.readFileSync(VDR_JS, 'utf8');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = global.window || {};
global.window.PriceIntelligenceMerge = require('../js/vendor-parsers/price-intelligence-merge');
new Function('window', 'document', src)(global.window, global.document);

const VENDOR = 'Global Gourmet Foods';
const OLIO = 'Extra Virgin Olive Oil 3/5lt Seleccion "Oleoestepa"';
const SALAME = 'Salame Napoli Smoked W/Peppercorn 2pc/cs (775Q) "Levoni"';

// ── finto Supabase, stessa forma degli altri test del repository ──
function makeSb(tables) {
  const calls = { updates: [], inserts: [] };
  function builder(t) {
    const st = { filters: [], single: false };
    const b = {
      select() { return b; },
      eq(k, v) { st.filters.push(['eq', k, v]); return b; },
      in(k, v) { st.filters.push(['in', k, v]); return b; },
      order() { return b; }, limit() { return b; },
      single() { st.single = true; return b; },
      update(data) {
        const rec = { table: t, data, filters: [] };
        calls.updates.push(rec);
        const ub = {
          eq(k, v) {
            rec.filters.push(['eq', k, v]);
            (tables[t] || []).filter(r => r[k] === v).forEach(r => Object.assign(r, data));
            return ub;
          },
          is() { return ub; }, select() { return ub; },
          then(res) { res({ data: [], error: null }); },
        };
        return ub;
      },
      insert(row) {
        calls.inserts.push({ table: t, row });
        tables[t] = tables[t] || [];
        (Array.isArray(row) ? row : [row]).forEach((r, i) =>
          tables[t].push(Object.assign({ id: 'new-' + t + '-' + (tables[t].length + i) }, r)));
        return { then(res) { res({ error: null }); } };
      },
      then(res) {
        let rows = (tables[t] || []).slice();
        for (const [ty, k, v] of st.filters) {
          if (ty === 'eq') rows = rows.filter(r => r[k] === v);
          if (ty === 'in') rows = rows.filter(r => Array.isArray(v) && v.includes(r[k]));
        }
        st.single ? res({ data: rows[0] || null, error: rows[0] ? null : { message: 'not found' } })
                  : res({ data: rows, error: null });
      },
    };
    return b;
  }
  return { sb: { from: builder }, calls };
}

function doc(id, data, items, total) {
  return { id, vendor: VENDOR, status: 'pending', warnings: null, document_date: data,
    parsed_json: { vendor: VENDOR, document_type: 'invoice', document_date: data, total, items } };
}
const rigaOlio = (prezzo) => ({
  description: OLIO, raw_description: OLIO, pack_description: '3/5LT',
  qty: 3, unit_price: prezzo, amount: prezzo * 3, line_type: 'product',
  _cost_per_100g: +(prezzo / 13740 * 100).toFixed(4),
});
const link = (desc, ingredientId, confirmed) => ({
  invoice_description: desc, vendor: VENDOR, ingredient_id: ingredientId, confirmed: confirmed !== false });
const rigaPrezzo = (over) => Object.assign({
  id: 'iv-olio', ingredient_id: 'ing-olio', vendor: VENDOR, vendor_sku: null,
  pack_description: '3/5LT', conversion_to_base: 13740, unit_price: 32.80,
  price_per_100g: 0.2187, last_invoice_date: '2026-05-26', price_type: 'per_case', active: true,
}, over || {});

async function approva(tables, docId) {
  const { sb, calls } = makeSb(tables);
  global.window.supabaseClient = sb;
  global.window._vdrEdits = {};
  await global.window.vdrApprove(docId, { style: {}, disabled: false, textContent: '' });
  return { tables, calls };
}
const prezzoOlio = (t) => (t.ingredient_vendors || []).find(r => r.ingredient_id === 'ing-olio');

// ── 1 ─────────────────────────────────────────────────────────────
test('1. prima fattura senza SKU: CREA il prezzo', async () => {
  const t = {
    vendor_documents: [doc('d1', '2026-06-16', [rigaOlio(164)], 492)],
    ingredient_links: [link(OLIO, 'ing-olio')],
    ingredient_vendors: [], invoice_lines: [], vendor_item_aliases: [],
  };
  const { calls } = await approva(t, 'd1');
  const ins = calls.inserts.filter(i => i.table === 'ingredient_vendors');
  assert.strictEqual(ins.length, 1, 'una riga di prezzo creata');
  assert.strictEqual(ins[0].row.ingredient_id, 'ing-olio');
  assert.strictEqual(+ins[0].row.price_per_100g.toFixed(4), 1.1936);
  assert.strictEqual(ins[0].row.last_invoice_date, '2026-06-16');
});

// ── 2 ─────────────────────────────────────────────────────────────
test('2. seconda fattura piu\' recente, stesso prodotto confermato: AGGIORNA', async () => {
  const t = {
    vendor_documents: [doc('d2', '2026-08-20', [rigaOlio(180)], 540)],
    ingredient_links: [link(OLIO, 'ing-olio')],
    ingredient_vendors: [rigaPrezzo({ last_invoice_date: '2026-06-16', unit_price: 164, price_per_100g: 1.1936 })],
    invoice_lines: [], vendor_item_aliases: [],
  };
  await approva(t, 'd2');
  const r = prezzoOlio(t);
  assert.strictEqual(+r.unit_price, 180, 'il prezzo deve avanzare');
  assert.strictEqual(+Number(r.price_per_100g).toFixed(4), +(180 / 13740 * 100).toFixed(4));
  assert.strictEqual(r.last_invoice_date, '2026-08-20');
  assert.strictEqual(r.vendor_sku, null, 'vendor_sku non deve essere inventato');
});

// ── 3 ─────────────────────────────────────────────────────────────
test('3. fattura piu\' VECCHIA: non aggiorna (chronologyAllows)', async () => {
  const t = {
    vendor_documents: [doc('d3', '2026-03-31', [rigaOlio(120)], 360)],
    ingredient_links: [link(OLIO, 'ing-olio')],
    ingredient_vendors: [rigaPrezzo({ last_invoice_date: '2026-06-16', unit_price: 164, price_per_100g: 1.1936 })],
    invoice_lines: [], vendor_item_aliases: [],
  };
  await approva(t, 'd3');
  const r = prezzoOlio(t);
  assert.strictEqual(+r.unit_price, 164, 'il prezzo recente deve resistere');
  assert.strictEqual(r.last_invoice_date, '2026-06-16');
});

// ── 4 ─────────────────────────────────────────────────────────────
test('4. pack incompatibile: fail-closed, niente scritto', async () => {
  // Il pack deve essere non vuoto, DIVERSO da quello memorizzato e non
  // convertibile da QUESTO runtime. Attenzione: "80#   ITA", che il
  // worker non sa leggere, la grammatica del browser lo converte
  // benissimo (36.287 g), quindi li' l'aggiornamento sarebbe legittimo e
  // non e' un caso di fail-closed. Verificato con vdrPackToGrams:
  //   "80#   ITA" -> 36287,36     "6/#10" -> null
  const riga = Object.assign(rigaOlio(164), { pack_description: '6/#10' });
  delete riga._cost_per_100g;                       // il documento non sa dire i grammi
  const t = {
    vendor_documents: [doc('d4', '2026-08-20', [riga], 492)],
    ingredient_links: [link(OLIO, 'ing-olio')],
    ingredient_vendors: [rigaPrezzo()],
    invoice_lines: [], vendor_item_aliases: [],
  };
  await approva(t, 'd4');
  const r = prezzoOlio(t);
  assert.strictEqual(r.pack_description, '3/5LT', 'il pack memorizzato non si perde');
  assert.strictEqual(+r.conversion_to_base, 13740, 'la conversione non si perde');
  assert.strictEqual(+r.unit_price, 32.80, 'nemmeno il prezzo viene scritto');
  assert.strictEqual(r.last_invoice_date, '2026-05-26');
});

// ── 5 ─────────────────────────────────────────────────────────────
test('5. descrizione con parentesi e virgolette: collegamento trovato e prezzo scritto', async () => {
  const riga = { description: SALAME, raw_description: SALAME, pack_description: '2 PC/CS',
    qty: 1.98, unit_price: 16.5, amount: 32.67, line_type: 'product', cost_per_lb: 16.5 };
  const t = {
    vendor_documents: [doc('d5', '2026-06-16', [riga], 32.67)],
    ingredient_links: [link(SALAME, 'ing-salame')],
    ingredient_vendors: [], invoice_lines: [], vendor_item_aliases: [],
  };
  const { calls } = await approva(t, 'd5');
  const ins = calls.inserts.filter(i => i.table === 'ingredient_vendors');
  assert.strictEqual(ins.length, 1, 'il salame deve arrivare in fondo');
  assert.strictEqual(ins[0].row.ingredient_id, 'ing-salame');
  const riD = (t.invoice_lines || []).find(r => r.raw_description === SALAME);
  assert.ok(riD, 'la riga di fattura deve esistere');
  assert.strictEqual(riD.ingredient_id, 'ing-salame', 'collegata, non orfana');
});

// ── 6 ─────────────────────────────────────────────────────────────
test('6. descrizione SENZA collegamento confermato: nessun aggiornamento arbitrario', async () => {
  const t = {
    vendor_documents: [doc('d6', '2026-08-20', [rigaOlio(180)], 540)],
    ingredient_links: [link(OLIO, 'ing-olio', false)],      // confirmed = false
    ingredient_vendors: [rigaPrezzo()],
    invoice_lines: [], vendor_item_aliases: [],
  };
  await approva(t, 'd6');
  const r = prezzoOlio(t);
  assert.strictEqual(+r.unit_price, 32.80, 'un collegamento non confermato non autorizza niente');
  assert.strictEqual(r.last_invoice_date, '2026-05-26');
});

// ── 7 ─────────────────────────────────────────────────────────────
test('7. nessuna interferenza con i fornitori che usano gli SKU', async () => {
  const decide = estraiDecisione(src);
  // Le quattro risposte di sempre, con e senza il consenso nuovo.
  for (const consenso of [undefined, true]) {
    assert.strictEqual(decide(null,  'ABC', consenso), 'populate_sku');
    assert.strictEqual(decide('XYZ', 'XYZ', consenso), 'update');
    assert.strictEqual(decide('XYZ', 'ABC', consenso), 'skip');
    assert.strictEqual(decide('XYZ', null,  consenso), 'skip',
      'riga con SKU + documento senza SKU: ambiguo, resta skip');
  }
});

// ── 8 ─────────────────────────────────────────────────────────────
test('8. nessun doppio import, e le invoice_lines non vengono riscritte', async () => {
  const t = {
    vendor_documents: [doc('d8', '2026-08-20', [rigaOlio(180)], 540)],
    ingredient_links: [link(OLIO, 'ing-olio')],
    ingredient_vendors: [rigaPrezzo()],
    invoice_lines: [], vendor_item_aliases: [],
  };
  const { calls } = await approva(t, 'd8');
  const quante = t.invoice_lines.length;
  assert.strictEqual(quante, 1, 'una riga, non due');
  assert.strictEqual(calls.updates.filter(u => u.table === 'invoice_lines').length, 0,
    'vdrApprove non deve aggiornare invoice_lines esistenti');
  const stato = t.vendor_documents[0].status;
  assert.strictEqual(stato, 'imported');
  // seconda approvazione dello stesso documento: si ferma sulla guardia
  const prima = JSON.stringify(t.invoice_lines);
  await approva(t, 'd8');
  assert.strictEqual(t.invoice_lines.length, quante, 'nessuna riga aggiunta');
  assert.strictEqual(JSON.stringify(t.invoice_lines), prima, 'nessuna riga modificata');
});

// ── parita' fra le due copie ──────────────────────────────────────
function estraiDecisione(sorgente) {
  const m = sorgente.match(/function vdrDecideCanonicalUpdate\([\s\S]*?\n\}/);
  assert.ok(m, 'decisione non trovata nella UI');
  return new Function(m[0] + '\nreturn vdrDecideCanonicalUpdate;')();
}
function estraiDecisioneWorker() {
  const w = fs.readFileSync(WORKER, 'utf8')
    .split('\n').filter(r => !/^\s*"[a-z0-9-]+":\s*"/.test(r)).join('\n');
  const m = w.match(/function vdrDecideCanonicalUpdateLite\([\s\S]*?\n\}/);
  assert.ok(m, 'decisione non trovata nel worker');
  const js = m[0]
    .replace(/:\s*string \| null/g, '').replace(/\?\s*:\s*boolean/g, '')
    .replace(/\)\s*:\s*'update' \| 'populate_sku' \| 'skip'/, ')')
    .replace(/\(v:\s*any\)/g, '(v)');
  return new Function(js + '\nreturn vdrDecideCanonicalUpdateLite;')();
}

test('9. UI e worker decidono identicamente su tutta la tabella di verita\'', () => {
  const ui = estraiDecisione(src);
  const wk = estraiDecisioneWorker();
  const sku = [null, undefined, '', '  ', 'ABC', 'XYZ'];
  const consensi = [undefined, false, true];
  let combinazioni = 0;
  for (const ex of sku) for (const inc of sku) for (const c of consensi) {
    assert.strictEqual(ui(ex, inc, c), wk(ex, inc, c),
      `divergenza su existing=${JSON.stringify(ex)} incoming=${JSON.stringify(inc)} consenso=${c}`);
    combinazioni++;
  }
  assert.strictEqual(combinazioni, 108);
});

test('10. entrambi i punti di chiamata passano il consenso esplicito', () => {
  const w = fs.readFileSync(WORKER, 'utf8')
    .split('\n').filter(r => !/^\s*"[a-z0-9-]+":\s*"/.test(r)).join('\n');
  assert.ok(/vdrDecideCanonicalUpdate\(existingIv\.vendor_sku, sku, true\)/.test(src),
    'la UI deve passare true dal ramo ingredient_links');
  assert.ok(/vdrDecideCanonicalUpdateLite\(existingIv\.vendor_sku, sku, true\)/.test(w),
    'il worker deve passare true dal ramo ingredient_links');
  // e da nessun'altra parte
  assert.strictEqual((src.match(/vdrDecideCanonicalUpdate\(/g) || []).length, 2,
    'una definizione e una sola chiamata nella UI');
});

// ── GG09b — la protezione 88A deve essere VIVA su questo ramo ─────
test('11. la mappa porta la riga intera, altrimenti 88A e\' inerte', () => {
  const f = fs.readFileSync(VDR_JS, 'utf8');
  const w = fs.readFileSync(WORKER, 'utf8')
    .split('\n').filter(r => !/^\s*"[a-z0-9-]+":\s*"/.test(r)).join('\n');
  for (const [nome, s] of [['UI', f], ['worker', w]]) {
    const m = s.match(/ingrVendorMap\[r\.ingredient_id\] = ([^;]+);/);
    assert.ok(m, 'costruzione di ingrVendorMap non trovata in ' + nome);
    assert.strictEqual(m[1].trim(), 'r',
      nome + ': la mappa deve conservare la riga intera. Tenendo solo ' +
      '{id, vendor_sku, last_invoice_date}, mergePriceIntelligence non vede ' +
      'mai una conversione memorizzata e il fail-closed non puo\' scattare.');
  }
});

test('12. con la riga intera il fail-closed scatta, con quella troncata no', () => {
  const PI = require('../js/vendor-parsers/price-intelligence-merge');
  const obs = { unit_price: 164, pack_description: '6/#10', price_type: 'per_case',
    conversion_to_base: null, price_per_100g: null, last_invoice_date: '2026-08-20' };
  const intera = { id: 'x', vendor_sku: null, last_invoice_date: '2026-05-26',
    pack_description: '3/5LT', conversion_to_base: 13740, price_per_100g: 0.2187 };
  const troncata = { id: 'x', vendor_sku: null, last_invoice_date: '2026-05-26' };

  const a = PI.mergePriceIntelligence(intera, obs);
  assert.strictEqual(a.reason, 'unresolved_pack_change');
  assert.strictEqual(a.skipped, true);
  assert.strictEqual(a.fields, null, 'niente deve essere scritto');

  // Documenta il difetto che c'era: serve a far fallire il test se
  // qualcuno rimette la troncatura.
  const b = PI.mergePriceIntelligence(troncata, obs);
  assert.strictEqual(b.skipped, false);
  assert.strictEqual(b.fields.conversion_to_base, null,
    'con la riga troncata si scriveva null sopra una conversione valida');
});
