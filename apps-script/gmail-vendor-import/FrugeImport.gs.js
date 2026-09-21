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
function checkFrugeEmails() {
  processLabelPDF('fruge-import', 'fruge-processed', 'gmail-vendor-import', null, true);
  // Usa lo stesso endpoint — il parser riconosce Fruge dal contenuto
}

function resetFrugeLabels() {
  resetLabel('fruge-processed', 'fruge-import');
}
