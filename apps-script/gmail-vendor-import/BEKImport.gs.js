function checkBEKEmails() {
  // FIX (BOH OS Task 11A): gate contro backfill accidentale. checkAllEmails()
  // gira ogni ora (Code.gs). Esistono molte email BEK storiche non etichettate
  // (bek-processed ha 0 messaggi oggi) — una search semplice le processerebbe
  // tutte al primo trigger. Non succede nulla qui finché BEK_ENABLED non è
  // impostata esplicitamente a 'true' in Script Properties (Project Settings
  // → Script Properties).
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('BEK_ENABLED') !== 'true') {
    Logger.log('[BEK] Skipped — BEK_ENABLED script property non è "true".');
    return;
  }

  // Sender + subject specifici a Ben E. Keith Order Confirmation — mai un
  // match generico su "Keith".
  var query = 'from:benekeith.com subject:"Order Confirmation" -label:bek-processed';

  // FIX (Task 11A, test singola email): con BEK_TEST_MODE='true' la search si
  // restringe a un solo Sales Order noto, cosi' la prima esecuzione tocca
  // solo quella email, mai lo storico.
  if (props.getProperty('BEK_TEST_MODE') === 'true') {
    var testSalesOrder = props.getProperty('BEK_TEST_SALES_ORDER') || '0002952908';
    query += ' subject:"' + testSalesOrder + '"';
  }

  processBEKQuery(query, '[BEK]');
}

// MICRO-TASK 54A — la parte comune fra il collector orario e il backfill
// storico. L'UNICA differenza fra i due e' la query: la logica di invio,
// di etichettatura e di conteggio vive qui una volta sola.
function processBEKQuery(query, tag) {
  var stats = { threads_found: 0, queued: 0, duplicate: 0, failed: 0, processed_label_added: 0 };
  var processedLabel = GmailApp.getUserLabelByName('bek-processed')
    || GmailApp.createLabel('bek-processed');

  var threads = GmailApp.search(query, 0, 20);
  stats.threads_found = threads.length;
  Logger.log(tag + ' ' + threads.length + ' threads');

  threads.forEach(function(thread) {
    // Ultimo messaggio del thread — stesso pattern di
    // checkHardiesOrderConfirmations(): evita di inviare due volte lo stesso
    // Sales Order solo perché il thread ha più messaggi.
    var msgs = thread.getMessages();
    var msg = msgs[msgs.length - 1];

    var result = sendToEdge('gmail-vendor-import', {
      subject: msg.getSubject(),
      from: msg.getFrom(),
      html_body: msg.getBody()    });

    // FIX (Task 11A, STEP 4): etichetta processed SOLO su successo reale o
    // duplicate confermato — mai su errore, cosi' un invio fallito può essere
    // ritentato all'ora successiva. Forme reali di risposta di
    // gmail-vendor-import v29: successo/duplicate → ha "status"; errore → ha
    // solo "error", mai "status".
    if (result && !result.error && (result.status === 'queued' || result.status === 'duplicate')) {
      thread.addLabel(processedLabel);
      stats.processed_label_added++;
      if (result.status === 'queued') stats.queued++; else stats.duplicate++;
    } else {
      stats.failed++;
      Logger.log(tag + ' Non etichettato — risposta non confermata: ' + JSON.stringify(result));
    }
  });

  return stats;
}

function resetBEKLabels() {
  resetLabel('bek-processed', 'bek-import');
}