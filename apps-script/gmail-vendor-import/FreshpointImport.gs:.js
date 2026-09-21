// INV07 — FreshPoint e' body-only e adesso e' fail-closed.
//
// Cosa faceva prima, e perche' non poteva funzionare:
//   payload {raw_text, subject, from, vendor}
//   ma gmail-vendor-import legge {pdf_base64, filename, subject, from,
//   body, html_body}: raw_text e vendor non li guarda nemmeno. Senza
//   pdf_base64 e non essendo Ben E. Keith, rispondeva
//   400 "Missing pdf_base64". Poi il collector toglieva
//   freshpoint-import e metteva freshpoint-processed SENZA guardare
//   l'esito, quindi l'email usciva dalla coda per sempre.
//   Cinque conferme d'ordine di giugno sono finite cosi'.
//
// Adesso usa processLabelBody: manda body e html_body, la forma che
// l'edge conosce, e in strict mode mette freshpoint-processed SOLO su
// queued o duplicate. Su 4xx, 5xx, eccezione di rete o risposta senza
// status il thread resta in freshpoint-import e viene ritentato.
//
// Il quarto argomento e' il mittente atteso: il thread 19478941 contiene
// un nostro inoltro dopo l'originale, e senza questo filtro si manderebbe
// quello. Il quinto e' null di proposito: niente start date, quindi resta
// la normale finestra di 30 giorni. Il recupero storico ha una funzione
// sua, backfillFreshpointFromJune2026(), non agganciata a checkAllEmails().
const FRESHPOINT_SENDER_RE = /@freshpoint\.com/i;

function checkFreshpointEmails() {
  return processLabelBody('freshpoint-import', 'freshpoint-processed',
                          'gmail-vendor-import', FRESHPOINT_SENDER_RE, null, true);
}

function resetFreshpointLabels() {
  resetLabel('freshpoint-processed', 'freshpoint-import');
}
