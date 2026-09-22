// INV05D — Fruge e' l'unico collector orario in modalita' fail-closed.
//
// Il quinto argomento, strictSuccessLabeling, cambia SOLO la semantica di
// successo: fruge-processed viene messa soltanto se l'edge conferma
// 'queued' o 'duplicate'. Su qualunque altro esito — 4xx, 5xx, eccezione
// di rete, risposta senza status — il thread resta in fruge-import e viene
// ritentato al giro dopo. Al retry i PDF gia' entrati tornano 'duplicate',
// che per il backend e' un no-op.
//
// Perche' proprio Fruge: INV04 ha mostrato che l'etichettatura
// incondizionata trasforma ogni fallimento in un successo archiviato —
// l'email esce dalla coda e non ci rientra mai piu'. Su FreshPoint il
// danno e' gia' avvenuto (12 thread processed, 1 solo documento). Qui la
// mina era ancora intatta e la disinneschiamo prima della prossima
// fattura.
//
// Il quarto argomento e' null di proposito: NON e' un backfill. Senza
// startDate resta la normale finestra di 30 giorni del collector orario.
// Il recupero storico ha una funzione sua, backfillFrugeFromJune2026(),
// che non e' agganciata a checkAllEmails().
// ═════════════════════════════════════════════════════════════
// INV11FINAL.1 — FRUGE NON DIPENDE PIU' DA UN FILTRO GMAIL.
//
// Fino a ieri checkFrugeEmails() leggeva SOLTANTO l'etichetta
// fruge-import, e quell'etichetta la metteva un filtro Gmail scritto a
// mano. INV11FINAL ha misurato la conseguenza: le fatture di
// system@netyield.com entravano in meno di un'ora (53 minuti l'ultima),
// quelle di bill.blanchet@frugeseafood.com hanno aspettato 20 e 51
// giorni, ed erano entrate solo con un recupero manuale. Il filtro non
// copriva il secondo mittente, e nessun fail-closed poteva salvarle:
// proteggeva le email che ENTRANO in fruge-import, e quelle non ci
// entravano proprio.
//
// Adesso il collector le cerca da solo, come fanno gia' BEK e le
// conferme d'ordine Hardie's. Il filtro Gmail puo' restare dov'e': se
// mette fruge-import, bene, non cambia niente; se non lo mette, la
// search la trova comunque.
//
// PERCHE' NON MANDA DIRETTAMENTE E INVECE ETICHETTA. Il percorso di
// invio, la semantica strict e il retry vivono in processLabelPDF e
// funzionano: un secondo collector parallelo vorrebbe dire due
// semantiche diverse per la stessa cosa. Questa funzione fa UNA cosa —
// riempie la coda — e poi lascia lavorare il percorso di sempre.
// ═════════════════════════════════════════════════════════════

// I due mittenti reali, misurati sulla sorgente in INV11FINAL: 56
// fatture da system@netyield.com e 2 da bill.blanchet@frugeseafood.com,
// zero da chiunque altro.
//
// Ogni pezzo della query fa un lavoro preciso e nessuno e' decorativo:
//
//   from:(...)              solo i due mittenti che mandano fatture.
//                           pam@frugeseafood.com manda avvisi "Cash In
//                           - ACH" CON allegato, fans@ manda marketing:
//                           restano fuori.
//   subject:"Invoice"       seconda barriera sugli stessi avvisi ACH,
//                           il cui oggetto comincia identico a quello
//                           delle fatture. Verificato: la query con
//                           pam + subject:"Invoice" torna zero.
//   has:attachment          la fattura Fruge E' il PDF allegato; senza
//                           allegato non c'e' niente da processare.
//   -label:fruge-processed  cio' che e' gia' stato lavorato non torna
//                           indietro. E' anche la ragione per cui
//                           attivare questa ricerca NON rispedisce lo
//                           storico: misurato prima del deploy, la
//                           query tornava ZERO thread.
var FRUGE_INTAKE_QUERY =
  'from:(system@netyield.com OR bill.blanchet@frugeseafood.com) ' +
  'subject:"Invoice" has:attachment -label:fruge-processed';

// Mette in coda i thread eleggibili trovati dalla search. Non invia
// niente e non decide niente: l'invio, l'esito e l'etichetta finale
// restano di processLabelPDF.
//
// addLabel su un thread che ha gia' l'etichetta e' un no-op in Gmail:
// un thread gia' messo in coda dal filtro passa di qui senza cambiare
// comportamento.
function frugeMettiInCoda() {
  var importLabel = GmailApp.getUserLabelByName('fruge-import')
    || GmailApp.createLabel('fruge-import');

  var threads = GmailApp.search(FRUGE_INTAKE_QUERY, 0, 20);
  threads.forEach(function (thread) {
    thread.addLabel(importLabel);
  });

  // Il passo a valle scarta i thread piu' vecchi di 30 giorni senza
  // de-etichettarli (la trappola di MICRO-TASK 53). Qui non puo'
  // succedere in silenzio: se la search pescasse qualcosa di vecchio
  // lo si legge nel log invece di scoprirlo mesi dopo.
  var piuVecchio = null;
  threads.forEach(function (t) {
    var d = t.getLastMessageDate();
    if (!piuVecchio || d < piuVecchio) piuVecchio = d;
  });
  Logger.log('[FRUGE] search autonoma: ' + threads.length + ' thread in coda' +
             (piuVecchio ? ', il piu vecchio del ' + piuVecchio : ''));

  return { trovati: threads.length };
}

function checkFrugeEmails() {
  frugeMettiInCoda();
  processLabelPDF('fruge-import', 'fruge-processed', 'gmail-vendor-import', null, true);
  // Usa lo stesso endpoint — il parser riconosce Fruge dal contenuto
}

function resetFrugeLabels() {
  resetLabel('fruge-processed', 'fruge-import');
}
