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

// ═════════════════════════════════════════════════════════════
// INV10FINAL.1 — L'UNITA' DI INGEST E' IL MESSAGGIO, NON IL THREAD.
//
// Prima si mandava soltanto msgs[msgs.length - 1] e poi si etichettava
// l'INTERO thread. Su un thread con due messaggi il primo non diventava mai
// un documento e — visto che la query e' `-label:bek-processed` — non
// tornava in nessuna ricerca successiva: perso, non in ritardo. Misurato
// reale su 0002927278 (INV10FINAL), dove Gmail aveva raggruppato la ricevuta
// d'ordine delle 16:36 e la conferma delle 16:43.
//
// Il contratto nuovo e' quello gia' usato per gli allegati multipli in
// processLabelPDF (MICRO-TASK 54B): ogni messaggio eleggibile parte per
// conto suo, e l'etichetta e' una decisione di THREAD presa DOPO, solo se
// tutti sono andati. Al retry quelli gia' passati tornano 'duplicate' —
// no-op lato backend — e solo il fallito riprova.
// ═════════════════════════════════════════════════════════════

// Eleggibilita' per MESSAGGIO: gli stessi due criteri della query di
// ricerca, applicati singolarmente. Un thread puo' contenere risposte o
// inoltri che la search non avrebbe mai restituito da soli, e quelli non
// devono partire.
function bekMessaggioEleggibile(msg) {
  var from = '';
  var subject = '';
  try { from = String(msg.getFrom() || ''); } catch (e) { from = ''; }
  try { subject = String(msg.getSubject() || ''); } catch (e) { subject = ''; }
  return from.toLowerCase().indexOf('benekeith.com') !== -1 &&
         subject.toLowerCase().indexOf('order confirmation') !== -1;
}

// getMessages() restituisce dal piu' VECCHIO al piu' nuovo: e' l'ordine che
// serve al backend, che sceglie la revisione operativa confrontando
// created_at (index.ts, MICRO-TASK 42 sezione F).
function bekMessaggiEleggibili(thread) {
  return thread.getMessages().filter(bekMessaggioEleggibile);
}

// Forme reali di risposta di gmail-vendor-import: successo/duplicate → ha
// "status"; errore → ha solo "error", mai "status". sendToEdge aggiunge
// {error} anche sulle eccezioni di rete. Tutto il resto e' fallimento.
function bekInvioRiuscito(result) {
  return !!result && !result.error &&
         (result.status === 'queued' || result.status === 'duplicate');
}

function bekInviaMessaggio(msg) {
  return sendToEdge('gmail-vendor-import', {
    subject: msg.getSubject(),
    from: msg.getFrom(),
    html_body: msg.getBody()
  });
}

// MICRO-TASK 54A — la parte comune fra il collector orario e il backfill
// storico. L'UNICA differenza fra i due e' la query: la logica di invio,
// di etichettatura e di conteggio vive qui una volta sola.
function processBEKQuery(query, tag) {
  var stats = { threads_found: 0, eligible_total: 0, queued: 0, duplicate: 0, failed: 0,
                processed_label_added: 0, threads_retained_for_retry: 0,
                threads_without_eligible: 0 };
  var processedLabel = GmailApp.getUserLabelByName('bek-processed')
    || GmailApp.createLabel('bek-processed');

  var threads = GmailApp.search(query, 0, 20);
  stats.threads_found = threads.length;
  Logger.log(tag + ' ' + threads.length + ' threads');

  threads.forEach(function(thread) {
    var eleggibili = bekMessaggiEleggibili(thread);
    stats.eligible_total += eleggibili.length;

    // Zero messaggi eleggibili: NON si etichetta. Etichettare qui vorrebbe
    // dire dichiarare processato un thread da cui non abbiamo mandato
    // niente. Meglio un thread che ricompare e si vede nel log.
    if (eleggibili.length === 0) {
      stats.threads_without_eligible++;
      stats.threads_retained_for_retry++;
      Logger.log(tag + ' Nessun messaggio eleggibile nel thread: non etichettato.');
      return;
    }

    var tuttiOk = true;
    eleggibili.forEach(function(msg) {
      var result = bekInviaMessaggio(msg);
      if (bekInvioRiuscito(result)) {
        if (result.status === 'queued') stats.queued++; else stats.duplicate++;
      } else {
        stats.failed++;
        tuttiOk = false;
        Logger.log(tag + ' Invio non confermato: ' + JSON.stringify(result));
      }
    });

    // Decisione di THREAD, presa dopo aver visto tutti i suoi messaggi.
    if (tuttiOk) {
      thread.addLabel(processedLabel);
      stats.processed_label_added++;
    } else {
      stats.threads_retained_for_retry++;
      Logger.log(tag + ' Thread non etichettato: almeno un messaggio non confermato.');
    }
  });

  return stats;
}

function resetBEKLabels() {
  resetLabel('bek-processed', 'bek-import');
}