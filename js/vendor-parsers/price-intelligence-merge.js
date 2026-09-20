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

// ── La decisione ────────────────────────────────────────────────────
// existing     riga ingredient_vendors gia' presente, o null/undefined
//              per un INSERT (allora non c'e' niente da proteggere e il
//              risultato e' identico a quello di prima della patch).
// observation  quello che il documento in arrivo dice, con gli stessi
//              nomi di colonna: unit_price, pack_description, price_type,
//              conversion_to_base, price_per_100g, last_invoice_date.
//
// Ritorna { fields, rescued, packClass }:
//   fields     l'oggetto da passare tale e quale a .update()/.insert()
//   rescued    true se un dato valido e' stato protetto (per il log)
//   packClass  la classificazione diagnostica del pack osservato
function mergePriceIntelligence(existing, observation) {
  const obs = observation || {};
  const ex  = existing || null;

  const priceType = obs.price_type != null ? obs.price_type : null;
  const isPerLb   = priceType === 'per_lb';

  const obsConv = obs.conversion_to_base != null ? Number(obs.conversion_to_base) : null;
  const exConv  = ex && ex.conversion_to_base != null ? Number(ex.conversion_to_base) : null;

  // L'osservazione non porta conversione, ma una valida e' memorizzata:
  // e' un'assenza di informazione, non una smentita. Si conserva.
  // 'per_lb' e' escluso: li' il null e' voluto.
  const rescued = !isPerLb
    && obsConv === null
    && exConv !== null
    && isFinite(exConv)
    && exConv > 0;

  const conversion = isPerLb
    ? null
    : rescued
      ? Math.round(exConv)
      : (obsConv !== null ? Math.round(obsConv) : null);

  // Il pack segue la conversione che giustifica. Se conserviamo la
  // conversione vecchia, conserviamo anche il pack vecchio: scriverci
  // sopra "1/" lascerebbe una riga che dice 22680 grammi senza dire
  // piu' da dove vengono. Quando invece non stiamo proteggendo niente
  // (riga nuova, pack a conteggio, pack valido) il pack osservato passa
  // come e' sempre passato.
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
    rescued,
    packClass: classifyPack(obs.pack_description),
  };
}

const api = {
  mergePriceIntelligence,
  classifyPack,
  PACK_WEIGHT, PACK_COUNT, PACK_NONE, PACK_UNKNOWN,
};

// Tripla esposizione, come gli altri moduli condivisi: require() per i
// test Node e per PARSER_SOURCES nel worker, window.* per il browser.
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.PriceIntelligenceMerge = api;
