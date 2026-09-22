// INV09B — TreviPay era l'ULTIMO collector orario ancora fail-open.
//
// Cosa faceva il quinto argomento mancante: processLabelPDF senza
// strictSuccessLabeling entra nel ramo legacy, dove `processed` diventa
// true appena un PDF e' stato INVIATO, a prescindere dall'esito, e il
// thread passa subito in trevipay-processed. Un 400, un 500,
// un'eccezione di rete, una risposta senza status: tutti finivano
// etichettati come riusciti. E un'email che esce da trevipay-import non
// ci rientra mai piu': il documento non e' in errore da nessuna parte,
// semplicemente non esiste, e nessuna coda lo reclama.
//
// Lo stesso ramo e' anche il buco multi-allegato: l'etichetta si sposta
// dentro il ciclo sui messaggi, quindi un'email con due PDF di cui il
// primo riesce e il secondo fallisce usciva comunque dalla coda,
// portandosi via il secondo.
//
// In strict mode la decisione e' per THREAD e dopo aver visto tutti i
// suoi PDF: un solo fallimento e il thread resta in trevipay-import. Al
// giro dopo i PDF gia' entrati tornano 'duplicate' — per il backend un
// no-op — mentre quello fallito viene ritentato.
//
// Contratto di successo, quello corrente e non uno nuovo: gmail-vendor-
// import risponde jsonResponse({status:'queued'|'duplicate'}) sul
// percorso riuscito e {error} sull'errore; sendToEdge aggiunge {error}
// anche sulle eccezioni di rete e sul JSON malformato. processLabelPDF
// verifica esattamente questo: `!!result && !result.error &&
// (result.status === 'queued' || result.status === 'duplicate')`.
//
// Il quarto argomento e' null di proposito: NON e' un backfill, resta la
// normale finestra di 30 giorni del collector orario. Il recupero
// storico ha una funzione sua, backfillTreviPayFromJune2026(), che non
// e' agganciata a checkAllEmails().
//
// Stessa forma gia' applicata a Fruge (INV05D), FreshPoint (INV07),
// Ben E. Keith (Task 11A) e Hardie's (INV08FINAL). TreviPay era
// rimasto indietro, e con lui tutte le fatture Walmart Business.
function checkTreviPayEmails() {
  return processLabelPDF('trevipay-import', 'trevipay-processed',
                         'gmail-vendor-import', null, true);
}
