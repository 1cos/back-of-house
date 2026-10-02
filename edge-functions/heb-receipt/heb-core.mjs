// ─────────────────────────────────────────────────────────────────────
// HEB01 — logica pura dello scontrino H-E-B (nessun I/O).
//
// Usata dalla funzione heb-receipt (Deno) e dai test (Node). Decide:
//   - come si normalizza una riga letta dalla foto;
//   - quali righe sono la stessa merce (gruppo) senza fonderle: ogni
//     riga resta una confezione con il suo importo;
//   - quali domande servono DAVVERO per questo scontrino: una domanda
//     esiste solo se manca il dato per arrivare al costo per unita'
//     operativa (mappatura sconosciuta, pezzi, peso non stampato);
//   - se il totale dello scontrino torna con le righe.
//
// Niente e' inventato: un valore che non c'e' resta null e diventa una
// domanda; un valore incerto resta da confermare.
// ─────────────────────────────────────────────────────────────────────

export const VENDOR = 'H-E-B';
const LB_G = 453.592;

// Chiave di gruppo: la descrizione stampata, in maiuscolo, senza spazi
// doppi e senza il flag fiscale finale (" F", " T", " N", " X") che H-E-B
// stampa dopo l'articolo.
export function groupKey(description) {
  return String(description || '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+[FTNX]$/, '')
    .trim();
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const round2 = (n) => Math.round(n * 100) / 100;

// Righe dal modello di lettura -> righe normalizzate. L'importo e' la sola
// cosa obbligatoria; peso e prezzo al libbra solo se stampati.
export function normalizeLines(items) {
  const out = [];
  (items || []).forEach((it, i) => {
    const description = String(it.description || '').trim();
    const amount = num(it.amount);
    if (!description && amount === null) return;
    const weight = num(it.weight_lb);
    const plb = num(it.price_per_lb);
    const conf = num(it.confidence);
    out.push({
      idx: out.length + 1,
      description,
      key: groupKey(description),
      amount,
      weight_lb: weight !== null && weight > 0 ? weight : null,
      price_per_lb: plb !== null && plb > 0 ? plb : null,
      confidence: conf === null ? null : Math.max(0, Math.min(1, conf)),
      needs_check: amount === null || (conf !== null && conf < 0.8),
    });
  });
  return out;
}

// Il totale torna? Confronto al centesimo.
export function reconcile(lines, total) {
  const sum = round2((lines || []).reduce((s, l) => s + (num(l.amount) || 0), 0));
  const t = num(total);
  return {
    lines_sum: sum,
    total: t,
    difference: t === null ? null : round2(t - sum),
    ok: t !== null && Math.abs(t - sum) < 0.005 && (lines || []).every((l) => num(l.amount) !== null && num(l.amount) > 0),
  };
}

const tokens = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length >= 3);

// Suggerimento di mappatura: 1) alias confermato (certo); 2) stessa
// descrizione in una riga fattura H-E-B passata gia' collegata (storico);
// 3) parole del nome dell'ingrediente dentro la descrizione. Solo 1 e'
// una certezza; 2 e 3 sono proposte che Chef conferma.
export function suggestMapping(key, ctx) {
  const alias = (ctx.aliases || []).find((a) => groupKey(a.vendor_description) === key && a.active !== false);
  if (alias) return { ingredient_id: alias.ingredient_id, source: 'confirmed', notes: alias.notes || null };
  const hist = (ctx.history || []).filter((h) => h.ingredient_id);
  const exact = hist.find((h) => groupKey(h.raw_description) === key);
  if (exact) return { ingredient_id: exact.ingredient_id, source: 'history' };
  const kt = new Set(tokens(key));
  let best = null;
  for (const h of hist) {
    const ht = tokens(groupKey(h.raw_description));
    if (!ht.length) continue;
    const overlap = ht.filter((t) => kt.has(t)).length / Math.max(ht.length, kt.size);
    if (overlap >= 0.6 && (!best || overlap > best.score)) best = { ingredient_id: h.ingredient_id, source: 'history', score: overlap };
  }
  if (best) return { ingredient_id: best.ingredient_id, source: 'history' };
  for (const ing of ctx.ingredients || []) {
    const it = tokens(ing.name);
    if (it.length && it.every((t) => kt.has(t))) return { ingredient_id: ing.id, source: 'name' };
  }
  return null;
}

const parseNotes = (n) => {
  if (!n) return {};
  if (typeof n === 'object') return n;
  try { return JSON.parse(n); } catch (_) { return {}; }
};

// Gruppi + domande per QUESTO scontrino.
//   ctx.aliases      vendor_item_aliases H-E-B (notes json: { ask, std_g })
//   ctx.history      invoice_lines H-E-B passate { raw_description, ingredient_id }
//   ctx.ingredients  [{ id, name }]
//   ctx.last         { [key]: { pieces, weight_lb } } ultima risposta (solo suggerimento)
export function buildGroups(lines, ctx = {}) {
  const byKey = new Map();
  for (const l of lines) {
    if (!byKey.has(l.key)) byKey.set(l.key, { key: l.key, description: l.description, lines: [] });
    byKey.get(l.key).lines.push(l.idx);
  }
  const groups = [];
  for (const g of byKey.values()) {
    const ls = lines.filter((l) => g.lines.includes(l.idx));
    const amount = round2(ls.reduce((s, l) => s + (num(l.amount) || 0), 0));
    const printedWeight = ls.every((l) => l.weight_lb) ? round2(ls.reduce((s, l) => s + l.weight_lb, 0) * 1000) / 1000 : null;
    const sug = suggestMapping(g.key, ctx);
    const notes = sug && sug.source === 'confirmed' ? parseNotes(sug.notes) : {};
    const ask = notes.ask === 'weight' ? 'weight' : 'pieces';
    const last = (ctx.last || {})[g.key] || null;
    const questions = [];
    if (!sug || sug.source !== 'confirmed') {
      questions.push({
        kind: 'mapping',
        prompt: `What is "${g.description}" in Brigade?`,
        why: 'First time on an H-E-B receipt: Brigade remembers your answer next time.',
        suggested_ingredient_id: sug ? sug.ingredient_id : null,
        suggestion_source: sug ? sug.source : null,
      });
    }
    if (ask === 'pieces') {
      questions.push({
        kind: 'pieces',
        prompt: ls.length > 1
          ? `${ls.length} packages, $${amount.toFixed(2)}: how many pieces in total?`
          : `$${amount.toFixed(2)}: how many pieces?`,
        why: 'The receipt shows only the price of the package: the pieces give the cost per piece.',
        last_answer: last && last.pieces ? last.pieces : null,
      });
    } else if (printedWeight === null) {
      questions.push({
        kind: 'weight',
        prompt: `$${amount.toFixed(2)}: how many lb in total?`,
        why: 'The receipt does not print the weight: the lb give the cost per lb.',
        last_answer: null,
      });
    }
    groups.push({
      key: g.key,
      description: g.description,
      line_idx: g.lines,
      packages: ls.length,
      amount,
      printed_weight_lb: printedWeight,
      ingredient_id: sug ? sug.ingredient_id : null,
      mapping_confirmed: !!(sug && sug.source === 'confirmed'),
      ask,
      std_g: notes.std_g ? num(notes.std_g) : null,
      questions,
    });
  }
  return groups;
}

// Costo per unita' operativa di un gruppo, dalle risposte. Non scrive
// niente: e' quello che la Review mostra e che l'import ricalcola.
export function derive(group, answer = {}) {
  const amount = num(group.amount);
  const ask = answer.ask || group.ask;
  if (ask === 'weight') {
    const w = num(answer.weight_lb) ?? group.printed_weight_lb;
    if (!w || w <= 0) return { ok: false, reason: 'weight missing' };
    return { ok: true, ask, weight_lb: w, cost_per_lb: round2(amount / w), cost_per_100g: Math.round((amount / (w * LB_G)) * 100 * 10000) / 10000 };
  }
  const p = num(answer.pieces);
  if (!p || p <= 0 || !Number.isInteger(p)) return { ok: false, reason: 'pieces missing' };
  const each = amount / p;
  const std = num(answer.std_g) ?? group.std_g;
  return {
    ok: true, ask: 'pieces', pieces: p,
    cost_each: round2(each),
    cost_per_100g: std && std > 0 ? Math.round((each / std) * 100 * 10000) / 10000 : null,
    std_g: std && std > 0 ? std : null,
  };
}

// Identita' dello scontrino: negozio + data + ora + totale. Serve al
// rifiuto dei doppioni insieme all'impronta della foto.
export function receiptNumber(r) {
  const d = String(r.date || '').replace(/-/g, '');
  const t = String(r.time || '').replace(/[^0-9]/g, '');
  const tot = num(r.total) === null ? 'x' : Math.round(num(r.total) * 100);
  return `HEB-${r.store || 'x'}-${d || 'x'}-${t || 'x'}-${tot}`;
}
