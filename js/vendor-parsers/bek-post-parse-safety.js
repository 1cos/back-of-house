// ── vendor-parsers/bek-post-parse-safety.js ─────────────────────────────
// MICRO-TASK 81 — LA DECISIONE BEK POST-PARSE, IN UN POSTO SOLO.
//
// Perche' questo file esiste
// --------------------------
// Dopo che un documento Ben E. Keith e' stato parsato, quello che gli
// succede non dipende solo dal testo: dipende dallo STATO DEL DATABASE —
// chi altro porta lo stesso Sales Order, in che stato, di che classe. Quella
// decisione viveva solo dentro Phase A del worker (index.ts, sezione F di
// MT42 piu' il buyer guard di MT48). Il percorso di reprocess della UI, che
// riparsa lo stesso documento e riscrive le stesse colonne, non la eseguiva
// affatto: MT80 ha misurato che cancellava le warning di stato senza
// rigenerarle.
//
// Copiare la sezione F nel browser avrebbe creato la quarta copia di una
// decisione che questo progetto ha gia' pagato tre volte (MT76 projection,
// MT78 regex del fallback, MT79 gate blocking). Quindi la decisione sta qui,
// una volta sola, e i due percorsi la chiamano.
//
// Contratto
// ---------
// DECISION-ONLY. Questa funzione LEGGE il database e non scrive mai: niente
// update, niente invoice_lines, niente cambi di status, niente storage.
// Restituisce un verdetto strutturato; le scritture restano di chi chiama,
// perche' i due caller scrivono in modo legittimamente diverso (Phase A
// esce con un outcome e tocca lo Storage, il reprocess accumula in un
// UPDATE solo).
//
// Le warning che produce sono SOLO quelle state-derived: quelle che
// descrivono il rapporto del documento con il resto del database e che
// nessun riparse potrebbe ricostruire da solo. Le warning del parser
// (OQR-*, BEK_CLASS_AMBIGUOUS, BEK_QTY_SHORT, ...) restano al parser e al
// caller, che le tiene accanto a queste.
//
// Ricalcolo, non conservazione
// ----------------------------
// Il verdetto si deriva sempre dallo stato ATTUALE. Un
// BEK_REVISION_AFTER_IMPORT esiste se e solo se in questo momento esiste
// ancora un fratello 'imported'; un BEK_REVISION_UNKNOWN esiste se e solo
// se in questo momento la classificazione resta incerta. Una warning
// vecchia non sopravvive perche' c'era.
//
// Caricamento: stesso schema del parser canonico — module.exports per Node
// e per il loader CJS del worker (PARSER_SOURCES), window.* per il browser,
// dove index.html lo carica prima di vendor-documents-review.js.
// ────────────────────────────────────────────────────────────────────────

'use strict';

// L'API del parser canonico (classifyBuyer, isBenEKeith, le costanti buyer).
// Risolta pigramente: nel browser il <script> del parser e' caricato prima,
// ma leggerlo a tempo di definizione legherebbe questo file all'ordine degli
// script invece che all'ordine delle chiamate.
function canon() {
  if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
    return require('./ben-e-keith-order-confirmation');
  }
  if (typeof window !== 'undefined' && window.BekOrderConfirmationParser) {
    return window.BekOrderConfirmationParser;
  }
  throw new Error('bek-post-parse-safety: parser canonico Ben E. Keith non disponibile');
}

// ── Funzioni pure di rango — MICRO-TASK 64/65, spostate qui da index.ts ──
// Erano dichiarate solo nel worker, che e' precisamente il motivo per cui il
// browser non poteva prendere la stessa decisione. Il corpo e' invariato.

function bekHasConfirmedQty(parsedDoc) {
  const items = (parsedDoc && Array.isArray(parsedDoc.items)) ? parsedDoc.items : [];
  return items.some((i) => {
    const c = i && (i.qty_received !== undefined && i.qty_received !== null ? i.qty_received : i.qty);
    return Number(c) > 0;
  });
}

// Il rango di una revisione e' il suo TIPO, non il suo valore economico.
// classifyDocument() deriva la classe SOLO dalle righe articolo, mai dalla
// prosa. Qualunque classe fuori da questa tabella ha rango null = incerta.
const BEK_CLASS_RANK = {
  operational_confirmation: 2,
  acknowledgement:          1,
};

function bekRevisionRank(parsedDoc, createdAt) {
  const cls = parsedDoc && parsedDoc.document_class;
  let rank = Object.prototype.hasOwnProperty.call(BEK_CLASS_RANK, cls) ? BEK_CLASS_RANK[cls] : null;
  // Invariante di validazione: un acknowledgement non puo' avere confermati.
  // Se il parser un giorno si contraddicesse, il documento diventa incerto
  // invece di essere classato male.
  if (cls === 'acknowledgement' && bekHasConfirmedQty(parsedDoc)) rank = null;
  return { cls: cls || null, rank, at: createdAt ? new Date(createdAt).getTime() : 0 };
}

function bekRankIsCertain(r) {
  return !!r && r.rank !== null && r.rank !== undefined;
}

// true se `a` deve prevalere su `b`. Mai al buio: se uno dei due non e'
// classificabile, nessuno supera nessuno.
function bekOutranks(a, b) {
  if (!bekRankIsCertain(a) || !bekRankIsCertain(b)) return false;
  if (a.rank !== b.rank) return a.rank > b.rank;
  return a.at > b.at;
}

// ── Buyer: allow-list, fail closed (MICRO-TASK 48) ──────────────────────
// BEK serve due flussi d'ordine sullo STESSO Customer#: la cucina e la sala.
// Su 56 thread reali l'unico campo che li distingue e' la riga `Email:`.
// Qualunque valore non riconosciuto, o assente, e' 'unknown' e non passa.
const BUYER_KITCHEN  = 'kitchen';
const BUYER_EXCLUDED = 'excluded';
const BUYER_UNKNOWN  = 'unknown';

function bekBuyerVerdict(parsed) {
  const api = canon();
  const cls = (parsed && parsed.buyer_class) || api.BUYER_UNKNOWN;
  if (cls === api.BUYER_EXCLUDED) return BUYER_EXCLUDED;
  if (cls === api.BUYER_KITCHEN)  return BUYER_KITCHEN;
  return BUYER_UNKNOWN;
}

// ── Gli esiti canonici ──────────────────────────────────────────────────
// Un solo verdetto per documento. E' questo il valore che il test di parita'
// confronta fra Phase A e reprocess: se i due percorsi producono lo stesso
// `outcome`, stanno prendendo la stessa decisione, indipendentemente da come
// poi ciascuno scrive.
const OUTCOME = {
  NOT_BEK:        'not_bek',          // non e' un BEK acquistabile: nessuna decisione
  BUYER_EXCLUDED: 'buyer_excluded',   // ordine di sala: mai un acquisto di cucina
  BUYER_UNKNOWN:  'buyer_unknown',    // buyer non riconosciuto: fail closed
  AFTER_IMPORT:   'after_import',     // il Sales Order ha gia' un acquisto importato
  REVISION_UNKNOWN: 'revision_unknown', // classe incerta, mia o di un fratello vivo
  SUPERSEDED:     'superseded',       // un fratello vivo mi supera
  OPERATIVE:      'operative',        // sono io la revisione operativa
};

function vuoto() {
  return {
    applies: false,
    outcome: OUTCOME.NOT_BEK,
    buyer: { verdict: null, email: null },
    revision: { verdict: null, existingDocumentId: null, siblingIds: [], supersedeIds: [], meRank: null },
    warnings: [],
    blocking: false,
    blockingCode: null,
  };
}

// ── LA DECISIONE ────────────────────────────────────────────────────────
// sb            client Supabase, usato in sola lettura
// doc           la riga come sta adesso (serve id e created_at)
// parsed        il parsed_json APPENA prodotto
// docNumber     il numero gia' risolto dal caller (parser, poi fallback subject)
// parseRawText  funzione iniettata per parsare il raw_text di un fratello non
//               ancora parsato. Iniettata e non importata: questo modulo vive
//               sotto vendor-parsers/ e non deve dipendere dal dispatcher.
async function bekDecidePostParse({ sb, doc, parsed, docNumber, parseRawText }) {
  const api = canon();
  const p = parsed || {};

  if (!api.isPurchasableDocument(p.vendor, p.document_type) || !api.isBenEKeith(p.vendor)) {
    return vuoto();
  }

  const out = vuoto();
  out.applies = true;
  out.buyer.email = p.buyer_email || null;

  // 1. BUYER PRIMA DI TUTTO. Un ordine che non e' di cucina non deve
  //    partecipare alla riconciliazione del Sales Order della cucina,
  //    nemmeno come fratello superato. L'ordine dei controlli qui e' lo
  //    stesso di Phase A e non e' negoziabile.
  const buyer = bekBuyerVerdict(p);
  out.buyer.verdict = buyer;

  if (buyer === BUYER_EXCLUDED) {
    out.outcome = OUTCOME.BUYER_EXCLUDED;
    out.warnings = [{
      code: 'BEK_BUYER_EXCLUDED', severity: 'info',
      message: `Order placed by ${p.buyer_email} — front of house, not a kitchen purchase`,
      buyer_email: p.buyer_email,
    }];
    return out;   // non bloccante: e' un ordine vero, solo non nostro
  }

  if (buyer !== BUYER_KITCHEN) {
    out.outcome = OUTCOME.BUYER_UNKNOWN;
    out.blocking = true;
    out.blockingCode = 'BEK_BUYER_NOT_ALLOWED';
    out.warnings = [{
      code: 'BEK_BUYER_NOT_ALLOWED', severity: 'blocking',
      message: p.buyer_email
        ? `Unrecognised Ben E. Keith buyer "${p.buyer_email}" — refusing to guess whether this is a kitchen purchase`
        : 'Ben E. Keith order confirmation carries no Email: buyer field — refusing to guess whether this is a kitchen purchase',
      buyer_email: p.buyer_email || null,
    }];
    return out;
  }

  // 2. RICONCILIAZIONE DELLE REVISIONI. Solo per order_confirmation con un
  //    numero: senza numero non esiste il gruppo di riconciliazione, e quel
  //    caso ha gia' la sua barriera (BEK_NO_SALES_ORDER, MT78).
  if (!docNumber || p.document_type !== 'order_confirmation') {
    out.outcome = OUTCOME.OPERATIVE;
    out.revision.verdict = OUTCOME.OPERATIVE;
    return out;
  }

  const { data: siblings } = await sb.from('vendor_documents')
    .select('id,status,created_at,raw_text,parsed_json')
    .eq('vendor', p.vendor)
    .eq('document_number', docNumber)
    .eq('document_type', 'order_confirmation')
    .neq('id', doc.id);

  const rows = siblings || [];
  out.revision.siblingIds = rows.map((r) => r.id);

  // 2a. Un acquisto gia' importato per questo Sales Order. FAIL CLOSED, sempre:
  //     mai un secondo acquisto, mai una riscrittura silenziosa di uno gia'
  //     contabilizzato. Ricalcolato ogni volta: se il fratello importato non
  //     ci fosse piu', questa warning non verrebbe prodotta.
  const alreadyImported = rows.find((r) => r.status === 'imported');
  if (alreadyImported) {
    out.outcome = OUTCOME.AFTER_IMPORT;
    out.revision.verdict = OUTCOME.AFTER_IMPORT;
    out.revision.existingDocumentId = alreadyImported.id;
    out.blocking = true;
    out.blockingCode = 'BEK_REVISION_AFTER_IMPORT';
    out.warnings = [{
      code: 'BEK_REVISION_AFTER_IMPORT',
      severity: 'blocking',
      message: `Sales Order ${docNumber} already has an imported purchase (document ${alreadyImported.id}). This later revision was NOT imported as a second purchase and the existing one was NOT modified — reconcile by hand.`,
      existing_document_id: alreadyImported.id,
    }];
    return out;
  }

  const meRank = bekRevisionRank(p, doc.created_at);
  out.revision.meRank = meRank;

  // Il rango di un fratello si calcola dal suo parse; se non e' ancora stato
  // parsato lo si parsa al volo dal suo raw_text. Senza questo, l'esito
  // tornerebbe a dipendere da quale documento viene toccato per primo.
  const live = rows.filter((r) => r.status !== 'ignored').map((r) => {
    let pj = r.parsed_json;
    if (!pj || !Array.isArray(pj.items) || pj.items.length === 0) {
      try { pj = parseRawText ? parseRawText(r.raw_text || '') : null; } catch (_e) { pj = null; }
    }
    return { row: r, rank: bekRevisionRank(pj, r.created_at) };
  });
  out.revision.liveRanks = live.map((s) => ({ id: s.row.id, cls: s.rank.cls, rank: s.rank.rank }));

  // 2b. FAIL CLOSED sull'incertezza. Se io o un fratello vivo non siamo
  //     classificabili, nessuno supera nessuno: decide una persona.
  //     La condizione NON richiede fratelli vivi (MT71): l'incertezza e' una
  //     proprieta' del documento, non del numero di fratelli.
  const incerti = live.filter((s) => !bekRankIsCertain(s.rank));
  if (!bekRankIsCertain(meRank) || incerti.length > 0) {
    const quali = [meRank.cls || 'sconosciuta'].concat(incerti.map((s) => s.rank.cls || 'sconosciuta'));
    const messaggio = live.length > 0
      ? `Sales Order ${docNumber} ha piu' revisioni e almeno una non e' classificabile (classi viste: ${quali.join(', ')}). Nessuna revisione e' stata superata automaticamente: riconcilia a mano.`
      : `Sales Order ${docNumber} non e' classificabile con certezza (classe: ${meRank.cls || 'sconosciuta'}) e non ha altre revisioni con cui riconciliarsi. Un documento di classe incerta non viene mai importato automaticamente: serve una revisione manuale.`;
    out.outcome = OUTCOME.REVISION_UNKNOWN;
    out.revision.verdict = OUTCOME.REVISION_UNKNOWN;
    out.blocking = true;
    out.blockingCode = 'BEK_REVISION_UNKNOWN';
    out.warnings = [{
      code: 'BEK_REVISION_UNKNOWN',
      severity: 'blocking',
      message: messaggio,
      sibling_ids: live.map((s) => s.row.id),
    }];
    return out;
  }

  // 2c. Un fratello vivo mi supera: io divento superato.
  const betterSibling = live.find((s) => bekOutranks(s.rank, meRank));
  if (betterSibling) {
    out.outcome = OUTCOME.SUPERSEDED;
    out.revision.verdict = OUTCOME.SUPERSEDED;
    out.revision.supersededBy = betterSibling.row.id;
    return out;
  }

  // 2d. Sono io la revisione operativa: i fratelli vivi vanno superati.
  //     La lista e' un'istruzione per il caller, non una scrittura fatta qui.
  out.outcome = OUTCOME.OPERATIVE;
  out.revision.verdict = OUTCOME.OPERATIVE;
  out.revision.supersedeIds = live.map((s) => s.row.id);
  return out;
}

const API = {
  bekDecidePostParse,
  bekBuyerVerdict,
  bekRevisionRank,
  bekRankIsCertain,
  bekOutranks,
  bekHasConfirmedQty,
  BEK_CLASS_RANK,
  OUTCOME,
  BUYER_KITCHEN,
  BUYER_EXCLUDED,
  BUYER_UNKNOWN,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = API;
}
if (typeof window !== 'undefined') {
  window.BekPostParseSafety = API;
}
