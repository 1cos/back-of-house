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
// IL COSTO PER PEZZO (MICRO-TASK 89A)
// -----------------------------------
// Osservato in produzione il 2026-09-20, sull'import di 0003099324:
// BEK 130881 (guanti L, pack "10/ 100 CT") passa da unit_price 52.92 a
// 53.00, ma price_per_each resta 0.05292 — il prezzo della cassa
// avanza, il costo del pezzo no. Il valore giusto e' 53.00/1000 = 0.053.
//
// La causa: price_per_each non era fra i campi che questo blocco scrive.
// Nessun percorso automatico lo aggiornava: lo scrivevano solo la
// risposta umana (vdrSaveEach) e l'editing manuale della scheda
// ingrediente. Cosi' restava fermo al prezzo del giorno in cui qualcuno
// l'aveva inserito.
//
// Adesso lo decide questa funzione, con la stessa disciplina della
// conversione: price_per_each = unit_price / pezzi-per-cassa, dove i
// pezzi si leggono dal pack con parsePackSize — la sola grammatica di
// pack del repository, non una seconda scritta qui.
//
// CAPACITA' DELLA CASSA
// ---------------------
// Da MICRO-TASK 89A i tre casi non guardano piu' la sola conversione in
// grammi, ma la CAPACITA' della cassa, che per un prodotto a peso sono
// i grammi e per uno a conteggio sono i pezzi. Serviva: per una riga a
// conteggio conversion_to_base e' legittimamente null, quindi la
// protezione di MICRO-TASK 88A non scattava mai e un pack troncato
// ("10/" al posto di "10/ 100 CT") poteva sovrascrivere quello buono
// senza che nessuno se ne accorgesse. Con la capacita' al posto dei
// grammi, le righe a peso e quelle a conteggio sono protette dalla
// stessa identica regola.
//
// COSA NON FA
// -----------
// Non scrive. Decide i valori e li restituisce; l'UPDATE resta dove e'
// sempre stato. Non inventa mai una conversione ne' un conteggio che
// non esistano gia': se i pezzi per cassa non sono determinabili,
// price_per_each non compare fra i campi e la colonna non viene toccata.
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

// ── Pezzi per cassa ─────────────────────────────────────────────────
// Riusa parsePackSize di vendor-parsers/utils.js, che e' gia' la
// grammatica dei pack di tutto il repository: "10/ 100 CT" -> {count:10,
// sizeEach:100, unit:'ct'}. Qui si moltiplica e si converte la dozzina.
// Nessuna regex nuova.
//
// Torna null — cioe' "non lo so", mai un numero inventato — quando il
// pack non si legge, quando l'unita' non e' di conteggio (una cassa da
// 50 LB non ha pezzi) e quando il conteggio e' un intervallo
// ("16-22 CT"), che non e' deterministico.
const COUNT_UNIT_FACTOR = { ct: 1, ea: 1, each: 1, pk: 1, pkg: 1, dz: 12, doz: 12 };

function packUtils() {
  if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
    return require('./utils');
  }
  if (typeof window !== 'undefined' && window.VendorParserUtils) {
    return window.VendorParserUtils;
  }
  return null;
}

function packTotalEach(pack) {
  if (pack == null || String(pack).trim() === '') return null;
  const utils = packUtils();
  if (!utils || typeof utils.parsePackSize !== 'function') return null;
  let p;
  try { p = utils.parsePackSize(pack); } catch (_) { return null; }
  if (!p) return null;
  const factor = COUNT_UNIT_FACTOR[p.unit];
  if (!factor) return null;                                   // non e' un conteggio
  if (p.sizeMax != null && p.sizeMax !== p.sizeEach) return null;  // intervallo
  const total = p.count * p.sizeEach * factor;
  return (isFinite(total) && total > 0) ? total : null;
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

  // Pezzi per cassa, letti dai due pack. Per un prodotto a peso sono
  // null su entrambi i lati e tutto si comporta come prima di 89A.
  const obsCount = packTotalEach(obs.pack_description);
  const exCount  = ex ? packTotalEach(ex.pack_description) : null;

  const packClass = classifyPack(obs.pack_description);

  // CAPACITA' — quanto misura una cassa: in grammi per un prodotto a
  // peso, in pezzi per uno a conteggio. Non e' la sola conversione che
  // va protetta: le righe a conteggio hanno conversion_to_base
  // legittimamente null, quindi la regola di MICRO-TASK 88A non
  // scattava mai per loro e un pack troncato poteva sovrascrivere
  // quello buono senza che nessuno se ne accorgesse.
  //
  // La perdita si misura PER TIPO, non in blocco: un'osservazione che
  // porta i pezzi ma non i grammi non "sostituisce" una conversione in
  // grammi, la cancella. Vale anche al contrario.
  const perdeGrammi = exConv  !== null && obsConv  === null;
  const perdePezzi  = exCount !== null && obsCount === null;

  // Niente da proteggere: riga nuova, l'osservazione dice almeno quanto
  // diceva la riga, o per_lb (dove il null e' un'affermazione esplicita,
  // non un'assenza).
  const nothingToProtect = isPerLb || (!perdeGrammi && !perdePezzi);

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
  // Il documento dichiara una cassa diversa e non sappiamo quanto
  // contiene. Non si scrive NIENTE: ne' il pack (perderemmo quello che
  // giustifica la capacita'), ne' la conversione o il costo per pezzo
  // (sarebbero il prezzo nuovo diviso per la cassa vecchia), ne'
  // unit_price e last_invoice_date, che da soli lascerebbero la riga a
  // dire due cose incompatibili.
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

  // La capacita' effettiva: quella osservata, o quella conservata.
  const effConv  = isPerLb ? null : (rescued ? exConv  : obsConv);
  const effCount = isPerLb ? null : (rescued ? exCount : obsCount);

  const conversion = effConv !== null ? Math.round(effConv) : null;

  // Il pack segue la capacita' che giustifica. Se conserviamo quella
  // vecchia conserviamo anche il pack vecchio: scriverci sopra "10/"
  // lascerebbe una riga che dice 1000 pezzi senza dire piu' da dove
  // vengono. Nel caso 2 i due pack sono la stessa dichiarazione, quindi
  // si tiene la forma gia' memorizzata e non cambia nulla.
  const pack = rescued
    ? (ex.pack_description != null ? ex.pack_description : null)
    : (obs.pack_description != null ? obs.pack_description : null);

  // Prezzo normalizzato al peso: quello osservato se c'e'; altrimenti,
  // se stiamo proteggendo una conversione, lo si RICALCOLA sul prezzo
  // nuovo — mai lasciato indietro, mai azzerato.
  const unitPrice = obs.unit_price != null ? obs.unit_price : null;
  const unitPriceNum = (unitPrice != null && isFinite(Number(unitPrice))) ? Number(unitPrice) : null;

  let per100g;
  if (obs.price_per_100g != null) {
    per100g = obs.price_per_100g;
  } else if (rescued && effConv !== null && unitPriceNum !== null) {
    per100g = (unitPriceNum / effConv) * 100;
  } else if (rescued) {
    per100g = ex.price_per_100g != null ? Number(ex.price_per_100g) : null;
  } else {
    per100g = null;
  }

  const fields = {
    unit_price:         unitPrice,
    pack_description:   pack,
    price_type:         priceType,
    conversion_to_base: conversion,
    price_per_100g:     per100g,
    last_invoice_date:  obs.last_invoice_date != null ? obs.last_invoice_date : null,
  };

  // ── Costo per pezzo (MICRO-TASK 89A) ──────────────────────────────
  // La chiave compare SOLO quando i pezzi per cassa sono davvero noti.
  // Se non lo sono, price_per_each resta fuori dai campi e la colonna
  // non viene toccata: non si inventa un conteggio e non si cancella
  // quello che c'e'. Per ogni prodotto a peso siamo sempre in questo
  // ramo, quindi per loro non cambia assolutamente nulla.
  if (effCount !== null && unitPriceNum !== null) {
    fields.price_per_each = unitPriceNum / effCount;
  }

  return { fields, skipped: false, reason, rescued, packClass };
}

const api = {
  mergePriceIntelligence,
  classifyPack,
  normalizePack, samePack,
  packTotalEach,
  PACK_WEIGHT, PACK_COUNT, PACK_NONE, PACK_UNKNOWN,
};

// Tripla esposizione, come gli altri moduli condivisi: require() per i
// test Node e per PARSER_SOURCES nel worker, window.* per il browser.
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.PriceIntelligenceMerge = api;
