// ── vendor-parsers/global-gourmet.js ─────────────────────────
// XCF-GG — Global Gourmet Foods, LLC (Houston). Fattura QuickBooks.
//
// Le fatture arrivano come SCANSIONE (o foto): il testo viene dall'OCR,
// ricostruito per righe da ./ocr-layout.js. Il formato della fattura e'
// stabile dal 2022 (#7186) al 2026 (#20734, #22xxx):
//
//   Date | Invoice #                       6/16/2026 20734
//   Quantity | U/M | Description | Price | EA / CS / LBS | Amount
//   3     cs  Italian Peeled Tomatoes 6#10 "La Carmela"  35.00  3cs  105.00
//   7.3   lb  Guanciale 2/3.5lb "Maestri"                16.82  1cs  122.79
//   1         SEA SALT COARSE SICILIAN BULK 25KG         34.50  1ea   34.50
//   Total $936.10
//
// Regole, tutte verificate sulle quattro fatture storiche:
//   - Amount = Quantity x Price, sempre (anche per le righe a peso: la
//     Quantity e' il peso in libbre e il Price e' al libbra). E' il
//     controllo che rende affidabile una riga letta da OCR.
//   - U/M puo' mancare (SEA SALT): allora si usa l'unita' della colonna
//     EA/CS/LBS, dichiarandolo (uom_source).
//   - Nessuno SKU: Global Gourmet non ne stampa. vendor_sku resta null,
//     sempre. Nessun codice viene inventato.
//   - Una descrizione puo' andare a capo ("Levoni"", "Pasini""): la riga
//     senza importi dentro la tabella si attacca alla riga sopra.
//
// L'OCR perde a volte una cifra isolata (la Quantity "3" di una riga):
// in quel caso la quantita' si RICAVA da Amount / Price solo se il
// risultato e' esatto al centesimo E, per le righe a pezzi, coincide con
// il conteggio della colonna EA/CS/LBS. La riga lo dichiara
// (qty_source: 'derived' + warning informativo GG_QTY_DERIVED). Se la
// quantita' non si puo' ricavare in modo esatto la riga e' bloccante.
//
// Somma delle righe != Total → DOC-TOTAL-001 (checkTotals del router) e
// GG_TOTAL_MISMATCH: il documento va in review, MAI in import.
//
// Un PDF di scansione puo' contenere PIU' fatture e piu' copie della
// stessa (fattura + copia firmata di consegna, POD). splitInvoices()
// separa per pagina e raggruppa per numero; parse() su un testo con due
// numeri diversi si rifiuta (GG_MULTI_INVOICE, bloccante).
//
// Pure functions. Nessun DB, nessuna AI.

'use strict';

const { parseDate } = require('./utils');

const VENDOR = 'Global Gourmet Foods';
const PAGE_SEP = '\f';

const MONEY_RE = /^\$?\d{1,3}(?:,\d{3})*\.\d{2}$|^\$?\d+\.\d{2}$/;
// Colonna EA/CS/LBS: "3cs", "1ea", "2 ea", con le letture OCR tipiche
// (l/I al posto di 1, ca al posto di ea).
const COUNT_RE = /^([\dlI|]+(?:\.\d+)?)\s?(cs|ea|ca|lb|lbs|c5|es)$/i;
const QTY_RE = /^\d+(?:\.\d+)?$|^\.\d+$/;
const UOM_MAP = {
  cs: 'cs', c5: 'cs', es: 'cs',
  ea: 'ea', ca: 'ea',
  lb: 'lb', lbs: 'lb', '1b': 'lb', ib: 'lb', '1bs': 'lb', ibs: 'lb',
};

function num(s) {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[$,\s]/g, ''));
  return isNaN(n) ? null : n;
}
function round2(n) { return Math.round(n * 100) / 100; }
function normUom(tok) {
  if (!tok) return null;
  return UOM_MAP[String(tok).toLowerCase()] || null;
}
function countValue(s) {
  // "lea" / "Ics" → 1: la cifra 1 letta come l, I o |.
  const v = String(s).replace(/^[lI|]+/, m => '1'.repeat(m.length));
  return num(v);
}

// ── Riconoscimento ───────────────────────────────────────────
function isGlobalGourmet(text) {
  const t = String(text || '');
  return /global\s+g\s*[o0c]?\s*urmet\s+foods/i.test(t) || /ggourmetfoods\.com/i.test(t);
}

// ── Intestazione ─────────────────────────────────────────────
const ADDRESS_RE = /houston|texas|\btx\b|weatherford|\bave\b|\bdr\b|\bln\b|college|salford|saldford|wynnwood|phone|\(\d{3}\)/i;

function extractHeader(lines) {
  // La data della fattura e' la PRIMA data della pagina: la data "Ship"
  // viene dopo, nella fascia P.O. Number / Terms / Rep / Ship.
  let date = null, number = null;
  const stopAt = lines.findIndex(l => /P\.?\s*O\.?\s*Number|Quantity/i.test(l));
  const head = stopAt > 0 ? lines.slice(0, stopAt) : lines.slice(0, 15);
  for (const l of head) {
    const m = l.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/);
    if (m && !date) date = parseDate(m[1]);
  }
  for (const l of head) {
    if (ADDRESS_RE.test(l)) continue;
    const toks = l.split(/\s+/);
    const c = toks.find(t => /^\d{4,6}$/.test(t));
    if (c) { number = c; break; }
  }
  return { date, number };
}

function extractTotal(lines) {
  // "Total $936.10" sulla stessa riga, oppure "Total" e l'importo sulla
  // riga subito prima o subito dopo (l'OCR spezza il riquadro).
  for (let i = 0; i < lines.length; i++) {
    if (!/\bTotal\b/i.test(lines[i])) continue;
    const same = lines[i].match(/Total\b[^\d$]*\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})/i);
    if (same) return num(same[1]);
    for (const j of [i + 1, i - 1, i + 2]) {
      if (j < 0 || j >= lines.length) continue;
      const m = lines[j].match(/\$\s*(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})\s*$/);
      if (m) return num(m[1]);
    }
  }
  return null;
}

// ── Righe articolo ───────────────────────────────────────────
// Da destra: Amount (denaro), [conteggio EA/CS/LBS], Price (denaro).
// Da sinistra: [Quantity], [U/M], poi la descrizione.
function parseItemRow(line) {
  const toks = line.trim().split(/\s+/);
  if (toks.length < 3) return null;
  let r = toks.length - 1;
  if (!MONEY_RE.test(toks[r])) return null;
  const amount = num(toks[r--]);
  let countRaw = null;
  if (r >= 0 && COUNT_RE.test(toks[r])) countRaw = toks[r--];
  else if (r >= 1 && /^[\dlI|]+(?:\.\d+)?$/.test(toks[r - 1]) && /^(cs|ea|ca|lb|lbs)$/i.test(toks[r])) {
    countRaw = toks[r - 1] + toks[r]; r -= 2;
  }
  if (r < 0 || !MONEY_RE.test(toks[r])) return null;
  const price = num(toks[r--]);
  let l = 0, qty = null, uomRaw = null;
  if (l <= r && QTY_RE.test(toks[l])) qty = num(toks[l++]);
  if (l <= r && normUom(toks[l])) uomRaw = toks[l++];
  const description = toks.slice(l, r + 1).join(' ').trim();
  if (!description) return null;
  let count = null, countUnit = null;
  if (countRaw) {
    const m = countRaw.match(COUNT_RE);
    if (m) { count = countValue(m[1]); countUnit = normUom(m[2]); }
  }
  return { qty, uomRaw, description, price, count, countUnit, countRaw, amount };
}

function isTableHeader(l) { return /Quantity/i.test(l) && /(Description|Amount|Price)/i.test(l); }
// L'OCR puo' spezzare l'intestazione della tabella su due righe
// ("Quantity U/M" e "Description Price EA / CS / LBS Amount").
function tableStart(lines) {
  const h = lines.findIndex(isTableHeader);
  if (h >= 0) return h;
  const q = lines.findIndex(l => /\bQuantity\b/i.test(l));
  const d = lines.findIndex(l => /\bDescription\b/i.test(l) && /\bAmount\b/i.test(l));
  if (q >= 0 && d >= 0 && Math.abs(q - d) <= 2) return Math.max(q, d);
  return -1;
}
function isTableEnd(l) { return /\bTotal\b|Thank\s*you|Grazie|Phone\s*#|E-?mail/i.test(l); }

function resolveQty(row) {
  // Ritorna { qty, source, ok, reason }.
  const close = (q) => Math.abs(round2(q * row.price) - row.amount) <= 0.011;
  if (row.qty != null && row.price != null && close(row.qty)) return { qty: row.qty, source: 'read', ok: true };
  if (!row.price) return { qty: row.qty, source: 'read', ok: false, reason: 'price_zero' };
  const derived = round2(row.amount / row.price);
  const uom = normUom(row.uomRaw) || row.countUnit;
  const derivedOk = close(derived) && derived > 0;
  if (derivedOk) {
    if (uom !== 'lb') {
      // A pezzi: la quantita' ricavata deve essere intera e coincidere con
      // il conteggio stampato nella colonna EA/CS/LBS (quando c'e').
      const intOk = Math.abs(derived - Math.round(derived)) < 1e-9 || Math.abs(derived * 2 - Math.round(derived * 2)) < 1e-9;
      // Il conteggio vale come prova solo se e' nella stessa unita'
      // (0.5 cs di riso = "5ea" sacchetti: unita' diverse, non confrontabili).
      const sameUnit = !row.countUnit || !normUom(row.uomRaw) || row.countUnit === normUom(row.uomRaw);
      const countOk = row.count == null || !sameUnit || Math.abs(row.count - derived) < 1e-9;
      if (intOk && countOk) return { qty: derived, source: row.qty == null ? 'derived' : 'derived_ocr_fix', ok: true };
    } else {
      return { qty: derived, source: row.qty == null ? 'derived' : 'derived_ocr_fix', ok: true };
    }
  }
  return { qty: row.qty, source: 'read', ok: false, reason: 'math' };
}

function parsePage(text) {
  const lines = String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
  const header = extractHeader(lines);
  const total = extractTotal(lines);
  const items = [];
  const warnings = [];
  const h = tableStart(lines);
  let inTable = h >= 0;
  for (let i = h + 1; inTable && i < lines.length; i++) {
    const l = lines[i];
    if (isTableEnd(l)) break;
    const row = parseItemRow(l);
    if (row) { items.push(row); continue; }
    // Riga senza importi dentro la tabella: e' la continuazione della
    // descrizione precedente (solo se non contiene numeri di prezzo).
    if (items.length && !/\d+\.\d{2}/.test(l)) {
      items[items.length - 1].description += ' ' + l;
      items[items.length - 1].wrapped = true;
    } else if (/\d+\.\d{2}/.test(l)) {
      warnings.push({ code: 'GG_ROW_UNREADABLE', severity: 'blocking', message: `Riga della tabella non leggibile: "${l}"` });
    }
  }
  return { lines, header, total, items, warnings, hasTable: h >= 0 };
}

function buildItem(row) {
  const q = resolveQty(row);
  const uom = normUom(row.uomRaw);
  // U/M non letta e quantita' frazionaria (non mezza cassa): Global
  // Gourmet vende a frazioni SOLO a peso (verificato su 4 fatture, 26
  // righe). Si dichiara come dedotta, non si spaccia per letta.
  const fractional = q.qty != null && Math.abs(q.qty * 2 - Math.round(q.qty * 2)) > 1e-9;
  const weightInferred = !uom && fractional;
  const purchaseUnit = uom || (weightInferred ? 'lb' : row.countUnit) || null;
  const item = {
    line_type: 'product',
    vendor_sku: null,
    description: row.description,
    raw_description: row.description,
    qty: q.qty,
    // Contratto xcf-prezzi: la U/M STAMPATA in fattura ('cs'/'ea'/'lb'),
    // null se la colonna e' vuota. Unica eccezione dichiarata: U/M persa
    // dall'OCR su una quantita' frazionaria → 'lb' (uom_source
    // 'inferred_weight' + GG_UOM_INFERRED). Il tipo di prezzo si decide da
    // qui, non da purchase_unit.
    invoice_unit: uom || (weightInferred ? 'lb' : null),
    purchase_unit: purchaseUnit,
    uom_source: uom ? 'U/M' : weightInferred ? 'inferred_weight' : (row.countUnit ? 'EA/CS/LBS' : null),
    unit_price: row.price,
    amount: row.amount,
    ea_cs_lbs: row.countRaw,
    qty_source: q.source,
    pack_description: null,
    warnings: [],
  };
  if (item.invoice_unit === 'lb') {
    // Riga a peso: la Quantity e' il peso, il Price e' al libbra.
    item.cost_per_lb = row.price;
    item.price_type = 'per_lb';
  }
  if (!q.ok) {
    item.warnings.push({ code: 'GG_LINE_MATH', severity: 'blocking',
      message: `${row.description}: ${row.qty} x ${row.price} != ${row.amount}` });
  } else if (q.source !== 'read') {
    item.warnings.push({ code: 'GG_QTY_DERIVED', severity: 'info',
      message: `${row.description}: quantita' non letta dall'OCR, ricavata da ${row.amount} / ${row.price} = ${q.qty}` });
  }
  if (weightInferred) {
    item.warnings.push({ code: 'GG_UOM_INFERRED', severity: 'info',
      message: `${row.description}: U/M non letta, quantita' ${q.qty} frazionaria → lb` });
  }
  if (!purchaseUnit) {
    item.warnings.push({ code: 'GG_UOM_MISSING', severity: 'info', message: `${row.description}: unita' non stampata` });
  }
  return item;
}

// ── Una fattura (una o piu' pagine dello stesso numero) ──────
function parse(rawText) {
  const text = String(rawText || '');
  const pages = text.split(PAGE_SEP).map(p => p.trim()).filter(Boolean);
  const warnings = [];

  const numbers = [...new Set(pages.map(p => extractHeader(p.split('\n')).number).filter(Boolean))];
  if (numbers.length > 1) {
    return {
      vendor: VENDOR, document_type: 'invoice', items: [],
      document_number: null, invoice_number: null,
      warnings: [{ code: 'GG_MULTI_INVOICE', severity: 'blocking',
        message: `Il documento contiene ${numbers.length} fatture (${numbers.join(', ')}): va separato con splitInvoices()` }],
    };
  }

  // Copie: la stessa fattura stampata due volte (fattura + POD firmato).
  // Si legge ogni copia e si tiene la prima che quadra; se due copie
  // leggibili danno totali diversi, review.
  const parsedPages = pages.map(parsePage);
  const copies = parsedPages.filter(p => p.hasTable && p.items.length);
  let chosen = null;
  const readings = copies.map(p => {
    const items = p.items.map(buildItem);
    const sum = round2(items.reduce((s, it) => s + (it.amount || 0), 0));
    const clean = p.total != null && Math.abs(sum - p.total) <= 0.02 &&
      items.every(it => !it.warnings.some(w => w.severity === 'blocking')) && !p.warnings.length;
    return { p, items, sum, clean };
  });
  chosen = readings.find(r => r.clean) || readings[0] || null;
  const cleanTotals = [...new Set(readings.filter(r => r.clean).map(r => r.p.total))];
  if (cleanTotals.length > 1) {
    warnings.push({ code: 'GG_COPIES_DISAGREE', severity: 'blocking',
      message: `Copie della stessa fattura con totali diversi: ${cleanTotals.join(' / ')}` });
  }

  const header = parsedPages.map(p => p.header).find(hh => hh.number) || parsedPages[0]?.header || {};
  const number = header.number || null;
  const date = parsedPages.map(p => p.header.date).find(Boolean) || null;
  const items = chosen ? chosen.items : [];
  const total = chosen ? chosen.p.total : (parsedPages.map(p => p.total).find(t => t != null) ?? null);

  if (chosen) warnings.push(...chosen.p.warnings);
  if (!number) warnings.push({ code: 'GG_NO_INVOICE_NUMBER', severity: 'blocking', message: 'Numero fattura Global Gourmet non letto' });
  if (!date) warnings.push({ code: 'GG_NO_DATE', severity: 'blocking', message: 'Data fattura Global Gourmet non letta' });
  if (total == null) warnings.push({ code: 'GG_NO_TOTAL', severity: 'blocking', message: 'Totale fattura Global Gourmet non letto' });
  if (!items.length) {
    warnings.push({ code: 'PARSE_ERROR_NO_LINES', severity: 'blocking',
      message: number ? `Global Gourmet #${number}: nessuna riga articolo letta` : 'Global Gourmet: nessuna riga articolo letta' });
  }
  const sum = round2(items.reduce((s, it) => s + (it.amount || 0), 0));
  if (items.length && total != null && Math.abs(sum - total) > 0.02) {
    warnings.push({ code: 'GG_TOTAL_MISMATCH', severity: 'blocking',
      message: `Somma righe $${sum.toFixed(2)} diversa dal Total $${total.toFixed(2)}: review, non import` });
  }

  return {
    vendor: VENDOR,
    document_type: 'invoice',
    document_number: number,
    invoice_number: number,
    document_date: date,
    invoice_date: date,
    subtotal: total,
    total,
    items,
    copies_read: copies.length,
    pages: pages.length,
    lines_sum: sum,
    warnings,
  };
}

// ── Separazione di un PDF con piu' fatture ───────────────────
// Ritorna [{ invoice_number, pages: [indici 0-based], text }] nell'ordine
// di prima comparsa. Una pagina senza numero si attacca alla precedente
// (seconda pagina di una fattura lunga). Le pagine con lo stesso numero
// — anche non consecutive, come fattura e POD in fondo al file — finiscono
// nello stesso gruppo.
function splitInvoices(rawText) {
  const pages = String(rawText || '').split(PAGE_SEP).map(p => p.trim());
  const groups = [];
  const byNum = {};
  let last = null;
  pages.forEach((p, i) => {
    if (!p) return;
    const n = extractHeader(p.split('\n')).number;
    const key = n || (last ? last.invoice_number : null);
    if (key && byNum[key]) { byNum[key].pages.push(i); last = byNum[key]; return; }
    const g = { invoice_number: key, pages: [i] };
    groups.push(g); if (key) byNum[key] = g; last = g;
  });
  groups.forEach(g => { g.text = g.pages.map(i => pages[i]).join('\n' + PAGE_SEP + '\n'); });
  return groups;
}

const API = { parse, splitInvoices, parsePage, parseItemRow, isGlobalGourmet, VENDOR, PAGE_SEP };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
