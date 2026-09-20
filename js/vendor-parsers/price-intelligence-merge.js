// ── vendor-parsers/price-intelligence-merge.js ─────────────────────
// MICRO-TASK 88A — una sola decisione, condivisa, su COSA scrivere in
// ingredient_vendors quando arriva una nuova osservazione di prezzo.
//
// IL PROBLEMA CHE RISOLVE
// -----------------------
// Il blocco price-intelligence (worker vdaiApprove e UI vdrApprove, due
// copie della stessa logica) costruiva i campi da scrivere guardando
// SOLO il documento in arrivo:
//
//     conversion_to_base: convBase ? Math.round(convBase) : null,
//     price_per_100g:     per100g,
//
// e poi faceva un UPDATE. Se il documento nuovo non permetteva di
// calcolare i grammi — per qualunque ragione — quei due null finivano
// sopra una conversione valida gia' memorizzata, cancellandola.
//
// Casi reali censiti in produzione al 2026-09-20 (nessuno ancora
// materializzato, tutti in documenti pending):
//
//   BEK 688106 Semolina    pack "1/"          <- troncato dal parser
//   BEK 108509             pack "3/"          <- troncato dal parser
//   Hardie's 03744         pack "9-1/2 GAL"   <- valido, ma la grammatica
//   Hardie's 25618         pack "6-4/2 oz"       del worker non lo copre
//   Hardie's 00907         pack "80#   ITA"      (la UI si')
//
// Le ultime tre mostrano perche' la regola NON puo' basarsi sul
// riconoscere i pack "scritti male": erano pack perfettamente validi,
// e il danno sarebbe arrivato lo stesso. La regola deve guardare la
// TRANSIZIONE, non la stringa.
//
// L'INVARIANTE
// ------------
// Un'osservazione non puo' cancellare un'informazione. Puo' solo
// sostituirla con un'altra informazione.
//
// Detto sui campi: se l'osservazione non produce una conversione, e una
// conversione valida e' gia' memorizzata, la conversione memorizzata
// resta — insieme al pack che la giustifica — e il prezzo normalizzato
// viene RICALCOLATO sul prezzo nuovo, cosi' il record non resta mai
// internamente incoerente (unit_price di agosto con price_per_100g di
// luglio).
//
// L'unica eccezione e' price_type 'per_lb': li' la conversione null non
// e' un'assenza di informazione, e' un'affermazione esplicita
// (catchweight, il peso lo porta la riga di fattura, non il pack). Quel
// null continua a passare, esattamente come prima.
//
// I TRE CASI (MICRO-TASK 88A.1)
// -----------------------------
// "L'osservazione non produce una conversione" non e' una sola
// situazione, sono tre, e solo due sono sicure:
//
//   1. MISSING / TRUNCATED — il pack osservato non dichiara nessuna
//      misura: null, "", "1/", "3/". Il documento non sta dicendo che la
//      cassa e' cambiata; il parser non e' riuscito a leggere. Si
//      conserva quello che sappiamo. SICURO.
//
//   2. SAME PACK, LIMITE DEL PARSER — il pack osservato e' la stessa
//      identica dichiarazione gia' memorizzata, ma la grammatica di
//      questo runtime non la sa convertire: "9-1/2 GAL" osservato su una
//      riga che ha gia' "9-1/2 GAL" e 35961. La cassa e' la stessa, lo
//      dice il documento stesso. SICURO.
//
//   3. PACK DIVERSO E NON CONVERTIBILE — il documento dichiara un pack
//      non vuoto e materialmente diverso da quello memorizzato, e non
//      sappiamo convertirlo: existing "1/ 50 LB" (22680 g) e osservato
//      "80#   ITA". Riusare 22680 attribuirebbe il prezzo della cassa
//      nuova alla conversione della cassa vecchia: un costo normalizzato
//      SBAGLIATO ma dall'aria perfettamente sana. Peggio di un null,
//      perche' nessuno lo noterebbe.
//      NON SICURO -> FAIL-CLOSED: si salta l'intero aggiornamento di
//      price intelligence per quella riga. Nessun campo scritto,
//      last_invoice_date compresa.
//
// Saltare non blocca l'import: il documento diventa comunque 'imported'
// (index.ts:1313, fuori da questo blocco) e Phase B pesca solo i
// 'pending', quindi non verra' riapprovato in eterno. E la cronologia
// resta corretta lo stesso, perche' effectiveLastDate() deriva la data
// vera dalle invoice_lines appena scritte, non dalla colonna che non
// abbiamo toccato.
//
// COSA NON FA
// -----------
// Non scrive. Decide i valori e li restituisce; l'UPDATE resta dove e'
// sempre stato. Non tocca price_per_each, che questi percorsi non hanno
// mai scritto (lo scrive solo la risposta umana in vdrSaveEach).
// Non inventa mai una conversione che non esista gia'.
// ────────────────────────────────────────────────────────────────────

'use strict';

// ── Classificazione dei pack — SOLO DIAGNOSTICA ─────────────────────
// Serve a spiegare nei log e nei report che tipo di pack e' arrivato.
// La decisione di merge qui sotto NON la usa, deliberatamente: una
// regola che dipendesse dal saper leggere il pack fallirebbe sul primo
// formato che nessuno ha previsto — ed e' esattamente quello che e'
// successo con "9-1/2 GAL" e "80#   ITA".
const MEASURE_UNITS = ['#', 'lb', 'lbs', 'oz', 'kg', 'g', 'gal', 'l', 'lt', 'ltr', 'ml', 'qt', 'pt'];
const COUNT_UNITS   = ['ct', 'ea', 'each', 'pk', 'pkg', 'dz', 'doz', 'roll', 'pr', 'bx', 'box', 'cs', 'bg', 'bag', 'ca'];

const PACK_WEIGHT    = 'A_WEIGHT';     // dichiara un peso o un volume: "1/ 50 LB", "9-1/2 GAL", "80#   ITA"
const PACK_COUNT     = 'B_COUNT';      // dichiara un conteggio: "10/ 100 CT", "6/ 40 CT", "Each", "15 DZ"
const PACK_NONE      = 'C_NONE';       // non dichiara niente: null, "", "1/", "3/"
const PACK_UNKNOWN   = 'D_UNKNOWN';    // dichiara qualcosa che non sappiamo leggere: '1 gallon Great Value Whole Milk'

function classifyPack(pack) {
  if (pack == null || String(pack).trim() === '') return PACK_NONE;
  const s = String(pack).toLowerCase();
  const tokens = s.match(/#|[a-z]+/g) || [];
  if (!tokens.length) return PACK_NONE;
  for (const t of tokens) if (MEASURE_UNITS.indexOf(t) !== -1) return PACK_WEIGHT;
  for (const t of tokens) if (COUNT_UNITS.indexOf(t) !== -1) return PACK_COUNT;
  return PACK_UNKNOWN;
}

// ── Confronto fra due dichiarazioni di pack ─────────────────────────
// Normalizzazione MINIMA, e deliberatamente stupida: spazi ai bordi via,
// spazi interni collassati, tutto minuscolo. Nient'altro — niente
// punteggiatura rimossa, niente unita' espanse, niente riordino. Serve
// solo a non trattare "80#   ITA" e "80# ita" come casse diverse.
// Qualunque cosa in piu' sarebbe la grammatica universale che non
// vogliamo costruire, e ogni sua imprecisione si pagherebbe con un
// riuso silenzioso della conversione sbagliata.
function normalizePack(pack) {
  if (pack == null) return null;
  const s = String(pack).trim().replace(/\s+/g, ' ').toLowerCase();
  return s === '' ? null : s;
}

function samePack(a, b) {
  const na = normalizePack(a);
  const nb = normalizePack(b);
  if (na === null || nb === null) return false;   // un'assenza non e' un'uguaglianza
  return na === nb;
}

// ── La decisione ────────────────────────────────────────────────────
// existing     riga ingredient_vendors gia' presente, o null/undefined
//              per un INSERT (allora non c'e' niente da proteggere e il
//              risultato e' identico a quello di prima della patch).
// observation  quello che il documento in arrivo dice, con gli stessi
//              nomi di colonna: unit_price, pack_description, price_type,
//              conversion_to_base, price_per_100g, last_invoice_date.
//
// Ritorna { fields, skipped, reason, rescued, packClass }:
//   fields     l'oggetto da passare a .update()/.insert(), oppure null
//              se skipped
//   skipped    true = il chiamante NON deve scrivere niente su questa
//              riga (caso 3, fail-closed)
//   reason     'update' | 'rescue_missing_pack' | 'rescue_same_pack'
//              | 'unresolved_pack_change'
//   rescued    true se un dato valido e' stato protetto (per il log)
//   packClass  la classificazione diagnostica del pack osservato
function mergePriceIntelligence(existing, observation) {
  const obs = observation || {};
  const ex  = existing || null;

  const priceType = obs.price_type != null ? obs.price_type : null;
  const isPerLb   = priceType === 'per_lb';

  const obsConv = obs.conversion_to_base != null ? Number(obs.conversion_to_base) : null;
  const exConvRaw = ex && ex.conversion_to_base != null ? Number(ex.conversion_to_base) : null;
  const exConv = (exConvRaw !== null && isFinite(exConvRaw) && exConvRaw > 0) ? exConvRaw : null;

  const packClass = classifyPack(obs.pack_description);

  // Niente da proteggere: riga nuova, conversione osservata valida, o
  // per_lb (dove il null e' un'affermazione esplicita, non un'assenza).
  // Percorso identico a prima di MICRO-TASK 88A.
  const nothingToProtect = isPerLb || obsConv !== null || exConv === null;

  let reason;
  if (nothingToProtect) {
    reason = 'update';
  } else if (packClass === PACK_NONE) {
    reason = 'rescue_missing_pack';                       // caso 1
  } else if (samePack(obs.pack_description, ex.pack_description)) {
    reason = 'rescue_same_pack';                          // caso 2
  } else {
    reason = 'unresolved_pack_change';                    // caso 3
  }

  // ── Caso 3 — FAIL-CLOSED ──────────────────────────────────────────
  // Il documento dichiara una cassa diversa e non sappiamo quanto pesa.
  // Non si scrive NIENTE: ne' il pack (perderemmo quello che giustifica
  // la conversione), ne' la conversione (non ne abbiamo una), ne' il
  // prezzo normalizzato (sarebbe il prezzo nuovo diviso per la cassa
  // vecchia), ne' unit_price e last_invoice_date, che da soli
  // lascerebbero la riga a dire due cose incompatibili.
  if (reason === 'unresolved_pack_change') {
    return {
      fields: null,
      skipped: true,
      reason,
      rescued: false,
      packClass,
      observedPack: obs.pack_description != null ? obs.pack_description : null,
      storedPack: ex.pack_description != null ? ex.pack_description : null,
    };
  }

  const rescued = reason === 'rescue_missing_pack' || reason === 'rescue_same_pack';

  const conversion = isPerLb
    ? null
    : rescued
      ? Math.round(exConv)
      : (obsConv !== null ? Math.round(obsConv) : null);

  // Il pack segue la conversione che giustifica. Se conserviamo la
  // conversione vecchia conserviamo anche il pack vecchio: scriverci
  // sopra "1/" lascerebbe una riga che dice 22680 grammi senza dire piu'
  // da dove vengono. Nel caso 2 i due pack sono la stessa dichiarazione,
  // quindi si tiene la forma gia' memorizzata e non cambia nulla.
  const pack = rescued
    ? (ex.pack_description != null ? ex.pack_description : null)
    : (obs.pack_description != null ? obs.pack_description : null);

  // Prezzo normalizzato: quello osservato se c'e'; altrimenti, se
  // stiamo proteggendo una conversione, lo si RICALCOLA sul prezzo
  // nuovo — mai lasciato indietro, mai azzerato.
  let per100g;
  if (obs.price_per_100g != null) {
    per100g = obs.price_per_100g;
  } else if (rescued && obs.unit_price != null && isFinite(Number(obs.unit_price))) {
    per100g = (Number(obs.unit_price) / exConv) * 100;
  } else if (rescued) {
    per100g = ex.price_per_100g != null ? Number(ex.price_per_100g) : null;
  } else {
    per100g = null;
  }

  return {
    fields: {
      unit_price:         obs.unit_price != null ? obs.unit_price : null,
      pack_description:   pack,
      price_type:         priceType,
      conversion_to_base: conversion,
      price_per_100g:     per100g,
      last_invoice_date:  obs.last_invoice_date != null ? obs.last_invoice_date : null,
    },
    skipped: false,
    reason,
    rescued,
    packClass,
  };
}

const api = {
  mergePriceIntelligence,
  classifyPack,
  normalizePack, samePack,
  PACK_WEIGHT, PACK_COUNT, PACK_NONE, PACK_UNKNOWN,
};

// Tripla esposizione, come gli altri moduli condivisi: require() per i
// test Node e per PARSER_SOURCES nel worker, window.* per il browser.
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.PriceIntelligenceMerge = api;
