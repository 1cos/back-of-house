// INV08FINAL — questo percorso NON trasporta documenti.
//
// hardies-order-check legge l'HTML della conferma d'ordine Chef's
// Warehouse e, per gli SKU marcati do_not_order, scrive un alert in
// office_items. Non crea nessun vendor_document, non tocca
// invoice_lines, non tocca vendor_credits: se un suo invio si perde,
// si perde un AVVISO, non una fattura. Ed e' dormiente: checkAllEmails()
// non lo chiama (vedi Codice.js).
//
// Resta comunque fail-closed, perche' la regola vale per tutti: un
// avviso che non e' partito non deve essere archiviato come se fosse
// partito. Contratto di successo di hardies-order-check, letto dal
// sorgente live (v21): { ok: true, ... } sul percorso riuscito,
// { error } con status 500 sull'eccezione. sendToEdge aggiunge { error }
// anche sulle eccezioni di rete e sul JSON malformato.
function checkHardiesOrderConfirmations() {
  var processedLabel = GmailApp.getUserLabelByName('hardies-order-processed')
    || GmailApp.createLabel('hardies-order-processed');
  var threads = GmailApp.search(
    'from:orders@info.chefswarehouse.com subject:"Your Order is Processing" -label:hardies-order-processed',
    0, 20
  );
  Logger.log('[hardies-order] ' + threads.length + ' threads trovati');
  threads.forEach(function(thread) {
    var msg = thread.getMessages()[thread.getMessages().length - 1];
    var result = sendToEdge('hardies-order-check', { raw_html: msg.getBody() });
    Logger.log('[hardies-order] ' + JSON.stringify(result));
    if (result && !result.error && result.ok === true) {
      thread.addLabel(processedLabel);
    } else {
      Logger.log('[hardies-order] non etichettato — risposta non confermata');
    }
  });
}

// INV08FINAL — Hardie's era l'ULTIMO collector orario ancora fail-open.
//
// Cosa faceva il quinto argomento mancante: processLabelPDF senza
// strictSuccessLabeling entra nel ramo legacy, dove `processed` diventa
// true appena un PDF e' stato INVIATO, a prescindere dall'esito, e il
// thread passa subito in hardies-processed. Un 400, un 500,
// un'eccezione di rete, una risposta senza status: tutti finivano
// etichettati come riusciti, e un'email che esce da hardies-import non
// ci rientra mai piu'. Il documento non e' in errore da nessuna parte:
// semplicemente non esiste, e nessuna coda lo reclama.
//
// Lo stesso ramo e' anche il buco multi-allegato: l'etichetta si sposta
// dentro il ciclo sui messaggi, quindi un'email con due PDF di cui il
// primo riesce e il secondo fallisce usciva comunque dalla coda,
// portandosi via il secondo.
//
// In strict mode la decisione e' per THREAD e dopo aver visto tutti i
// suoi PDF: un solo fallimento e il thread resta in hardies-import. Al
// giro dopo i PDF gia' entrati tornano 'duplicate' — verificato in
// produzione su tutti e quattro i tipi di documento Hardie's, e per il
// backend e' un no-op — mentre quello fallito viene ritentato.
//
// Il quarto argomento e' null di proposito: NON e' un backfill, resta
// la normale finestra di 30 giorni del collector orario. Il recupero
// storico ha una funzione sua, backfillHardiesFromJune2026(), che non e'
// agganciata a checkAllEmails().
//
// Stessa forma gia' applicata a Fruge (INV05D), FreshPoint (INV07) e
// Ben E. Keith (Task 11A). Hardie's era rimasto indietro.
function checkHardiesEmails() {
  return processLabelPDF('hardies-import', 'hardies-processed',
                         'gmail-hardies-import', null, true);
}