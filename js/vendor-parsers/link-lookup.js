// ── vendor-parsers/link-lookup.js ─────────────────────────────────
// GG07 — UNA SOLA LETTURA DI ingredient_links PER DESCRIZIONE.
//
// IL PROBLEMA CHE RISOLVE
// -----------------------
// Otto punti del repository leggevano i collegamenti cosi':
//
//     sb.from('ingredient_links').select(...)
//       .eq('vendor', vendor).eq('confirmed', true)
//       .in('invoice_description', descs)
//
// `.in()` serializza la lista in un filtro PostgREST `in.(a,b,c)`.
// postgrest-js mette un valore fra virgolette doppie quando contiene
// una virgola o una parentesi — ma NON sfugge le virgolette doppie che
// il valore contiene già. Una descrizione che ha entrambe le cose
// produce quindi un filtro che PostgREST non riesce a leggere, e la
// riga non torna. Nessun errore: torna semplicemente una riga in meno.
//
// Osservato in produzione il 28/09/2026 sulla fattura Global Gourmet
// #20734:
//
//     Salame Napoli Smoked W/Peppercorn 2pc/cs (775Q) "Levoni"
//                                       ^^^^^^^        ^^^^^^^
//                                       parentesi      virgolette
//
// Il collegamento ESISTE, confirmed = true, ed e' corretto. Ma
// vdrPreflight lo contava fra i non abbinati e vdrApprove avrebbe
// scritto la riga di fattura senza ingredient_id. Le altre cinque
// descrizioni della stessa fattura hanno le virgolette ma non le
// parentesi, quindi non vengono messe fra virgolette e passano: e'
// per questo che il difetto e' rimasto invisibile per mesi.
//
// LA REGOLA
// ---------
// Le descrizioni di fattura sono testo libero scritto dal fornitore.
// Non possono essere costrette nella grammatica di un filtro di URL.
// Quindi non ci si prova: si legge per fornitore — un filtro su una
// colonna che contiene solo nomi di fornitore, non testo libero — e si
// seleziona in memoria. `ingredient_links` ha 125 righe in tutto al
// 28/09/2026, poche decine per fornitore: il costo e' nullo.
//
// Cosi' la correttezza non dipende piu' da quali caratteri contiene la
// descrizione, che e' l'unica garanzia che regge nel tempo.
//
// COSA NON FA
// -----------
// Non normalizza le descrizioni, non ne cambia nemmeno una. Il
// confronto resta l'uguaglianza esatta che era prima: stesso
// risultato per ogni descrizione che gia' funzionava.
// ────────────────────────────────────────────────────────────────────

'use strict';

// ── MARKER:LINK_LOOKUP_START ─────────────────────────────────────
// sb        client Supabase
// vendor    nome fornitore (colonna controllata, sicura in un filtro)
// descs     descrizioni cercate; l'ordine non conta, i doppioni si
//           ignorano
// opts      { columns, confirmedOnly }
//             columns        default 'invoice_description,ingredient_id'
//             confirmedOnly  default true
//
// Ritorna { data, error } con la stessa forma di prima, cosi' i
// chiamanti non cambiano struttura: solo la riga della query.
async function vplFetchLinksByDescription(sb, vendor, descs, opts) {
  const o = opts || {};
  const columns = o.columns || 'invoice_description,ingredient_id';
  const confirmedOnly = o.confirmedOnly !== false;

  const wanted = new Set((descs || []).filter(function (d) {
    return d != null && d !== '';
  }));
  if (!wanted.size) return { data: [], error: null };

  let q = sb.from('ingredient_links').select(columns).eq('vendor', vendor);
  if (confirmedOnly) q = q.eq('confirmed', true);

  const res = await q;
  if (res && res.error) return { data: [], error: res.error };

  const rows = (res && res.data) || [];
  return {
    data: rows.filter(function (r) { return wanted.has(r.invoice_description); }),
    error: null,
  };
}
// ── MARKER:LINK_LOOKUP_END ───────────────────────────────────────

const api = { vplFetchLinksByDescription };

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.LinkLookup = api;
