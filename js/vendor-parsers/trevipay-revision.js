// ── vendor-parsers/trevipay-revision.js ─────────────────────────────────
// WM01 — WALMART / TREVIPAY: LE REVISIONI NON SONO DOPPIONI.
//
// Il caso reale (28/09/2026, fatture 9a7e7ac1 $83.80 e 31f3acdd $191.65)
// ------------------------------------------------------------------
// TreviPay ha mandato prima la fattura "New ... invoice available" con una
// tabella "Invoice Details" senza prodotti: una sola riga con il NUMERO
// D'ORDINE al posto dello SKU e nessuna descrizione. Qualche ora dopo ha
// mandato "... invoice has been updated: <numero>" con lo stesso totale e il
// PDF con gli articoli veri.
//
// La regola "vince il primo" (vendor + numero + tipo) ha bollato la versione
// buona come DUPLICATE e ne ha cancellato il PDF dallo Storage; la versione
// vuota e' rimasta in errore con "No line items found".
//
// Cosa decide questo file
// -----------------------
// 1. isTreviPayRevisionSubject(subject): l'email e' una revisione TreviPay?
//    Riconoscimento stretto sul testo fisso del template, mai un match largo.
// 2. annotateSummaryOnly(parsed, rawText): la fattura e' la versione
//    riassuntiva senza articoli? Se si', il PARSE_ERROR generico diventa
//    TREVIPAY_SUMMARY_ONLY con un messaggio umano. Non inventa righe.
// 3. decideRevision({ doc, parsed, docNumber, siblings }): dato lo stato
//    attuale dei fratelli (stesso vendor + numero + tipo), cosa succede.
//
// Contratto: DECISION-ONLY, come bek-post-parse-safety.js. Niente scritture,
// niente Storage, niente rete: i due chiamanti (Phase A del worker e il
// reprocess della UI) scrivono ciascuno a modo suo con lo stesso verdetto.
//
// Caricamento: module.exports per Node e per il loader CJS del worker
// (PARSER_SOURCES), window.TreviPayRevision per il browser.
// ────────────────────────────────────────────────────────────────────────

'use strict';

const WALMART_VENDOR = 'Walmart Business';

// Template TreviPay reale: "Walmart Business: Pay By Invoice invoice has been
// updated: 9a7e7ac1". Si richiedono ENTRAMBE le parti: il nome del programma
// e la frase della revisione.
const REVISION_SUBJECT_RE = /pay\s+by\s+invoice\b.*\binvoice\s+has\s+been\s+updated\b/i;

function isTreviPayRevisionSubject(subject) {
  return REVISION_SUBJECT_RE.test(String(subject || ''));
}

const OUTCOME = Object.freeze({
  NOT_APPLICABLE: 'not_applicable',      // non e' una revisione TreviPay con fratelli: regole normali
  SUPERSEDES: 'supersedes',              // questa revisione prende il posto dei fratelli non importati
  AFTER_IMPORT: 'after_import',          // un fratello e' gia' importato: fermo, lo guarda una persona
  NO_ITEMS_YET: 'no_items_yet',          // anche la revisione e' senza articoli: niente da sostituire
});

const CODES = Object.freeze({
  SUMMARY_ONLY: 'TREVIPAY_SUMMARY_ONLY',
  SUPERSEDED: 'SUPERSEDED_BY_REVISION',
  AFTER_IMPORT: 'TREVIPAY_REVISION_AFTER_IMPORT',
});

const SUMMARY_ONLY_MESSAGE =
  "This invoice doesn't include item details yet: Walmart/TreviPay sent only the order total. " +
  'An updated invoice with the items usually follows; it will replace this one automatically.';

// La riga riassuntiva reale: "200015168224760 1 $83.80 $0.00 $0.00 $83.80".
// Numero d'ordine (12+ cifre) + quantita' + quattro importi, nient'altro:
// nessuna parola in mezzo, quindi nessuna descrizione.
const SUMMARY_ROW_RE = /^(\d{12,})\s+\d+\s+-?\$[\d,.]+\s+-?\$[\d,.]+\s+-?\$[\d,.]+\s+-?\$[\d,.]+\s*$/;

function isSummaryOnly(parsed, rawText) {
  if (!parsed || parsed.vendor !== WALMART_VENDOR) return false;
  if (parsed.items && parsed.items.length) return false;
  const order = parsed.walmart_order_number ? String(parsed.walmart_order_number) : null;
  const lines = String(rawText || '').split('\n');
  return lines.some((l) => {
    const m = SUMMARY_ROW_RE.exec(l.trim());
    return !!m && (!order || m[1] === order);
  });
}

// Sostituisce il PARSE_ERROR generico con il codice specifico. Restituisce
// un NUOVO oggetto: il parsed del chiamante non viene mutato.
function annotateSummaryOnly(parsed, rawText) {
  if (!isSummaryOnly(parsed, rawText)) return parsed;
  const warnings = (parsed.warnings || []).filter((w) => w && w.code !== 'PARSE_ERROR');
  warnings.push({ code: CODES.SUMMARY_ONLY, severity: 'blocking', message: SUMMARY_ONLY_MESSAGE });
  return Object.assign({}, parsed, { warnings, summary_only: true });
}

// siblings: righe vendor_documents con stesso vendor + numero + tipo, escluso
// il documento stesso. Servono id e status.
function decideRevision({ doc, parsed, docNumber, siblings }) {
  const out = { applies: false, outcome: OUTCOME.NOT_APPLICABLE, supersedeIds: [], warnings: [] };
  if (!parsed || parsed.vendor !== WALMART_VENDOR || !docNumber) return out;
  if (!isTreviPayRevisionSubject(doc && doc.source_email_subject)) return out;
  const rows = (siblings || []).filter((s) => s && s.id !== (doc && doc.id));
  if (!rows.length) return out;   // nessun originale in archivio: e' una fattura normale

  out.applies = true;
  const imported = rows.filter((s) => s.status === 'imported');
  if (imported.length) {
    // Il costo e' gia' contabilizzato dall'originale. Non si tocca niente e
    // non si importa una seconda volta: fermo con un warning bloccante.
    out.outcome = OUTCOME.AFTER_IMPORT;
    out.warnings = [{
      code: CODES.AFTER_IMPORT, severity: 'blocking',
      message: `Walmart/TreviPay sent an updated version of invoice #${docNumber}, but the original is already imported. ` +
               'Nothing was changed: check by hand whether the items differ.',
      original_ids: imported.map((s) => s.id),
    }];
    return out;
  }

  if (!parsed.items || !parsed.items.length) {
    // Anche la revisione e' vuota: l'originale resta com'e', niente scambio.
    out.outcome = OUTCOME.NO_ITEMS_YET;
    return out;
  }

  out.outcome = OUTCOME.SUPERSEDES;
  out.supersedeIds = rows.filter((s) => s.status !== 'ignored').map((s) => s.id);
  return out;
}

// Il warning da scrivere sull'originale quando viene sostituito.
function supersededWarning(revisionId, docNumber) {
  return {
    code: CODES.SUPERSEDED, severity: 'info',
    message: `Replaced by the updated Walmart/TreviPay invoice #${docNumber} (document ${revisionId}). Kept for history; never imported.`,
    superseded_by: revisionId,
  };
}

const API = {
  WALMART_VENDOR,
  OUTCOME,
  CODES,
  SUMMARY_ONLY_MESSAGE,
  isTreviPayRevisionSubject,
  isSummaryOnly,
  annotateSummaryOnly,
  decideRevision,
  supersededWarning,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = API;
}
if (typeof window !== 'undefined') {
  window.TreviPayRevision = API;
}
