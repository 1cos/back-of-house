const SUPABASE_URL_BASE = 'https://ydqmumpytgrlceuinoqt.supabase.co/functions/v1/';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlkcW11bXB5dGdybGNldWlub3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MzcyOTUsImV4cCI6MjA5NDUxMzI5NX0.MSIKL4nCOxK8YFFTkt9AbFGViiwl-KEhHy6cL25gnKc';

function sendToEdge(functionSlug, payload) {
  const url = SUPABASE_URL_BASE + functionSlug;
  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    const text = response.getContentText();
    Logger.log('[' + functionSlug + '] Response: ' + text.slice(0, 200));
    return JSON.parse(text);
  } catch(e) {
    Logger.log('[' + functionSlug + '] Error: ' + e.toString());
    return { error: e.toString() };
  }
}

// MICRO-TASK 54A — `startDate` OPZIONALE.
//
// Senza quel parametro il comportamento e' IDENTICO a prima: finestra
// relativa di 30 giorni. Con una data esplicita si usa quella al posto del
// cutoff, ed e' l'unico modo per raggiungere lo storico.
//
// Il cutoff a 30 giorni e' il meccanismo che ha lasciato fermo l'arretrato
// (MICRO-TASK 53): le email piu' vecchie non venivano processate E non
// venivano de-etichettate, quindi restavano nella label `-import` per
// sempre. 841 thread hardies-import e le 6 fatture Walmart del 28/07-07/08
// sono li' per questo.
//
// Restituisce un riepilogo dei conteggi, cosi' le funzioni di backfill
// possono loggarlo. Il percorso orario ignora il valore di ritorno: per lui
// non cambia nulla.
//
// ATTENZIONE, comportamento PRESERVATO e non corretto qui: le etichette
// vengono spostate quando almeno un PDF e' stato inviato, anche se la
// risposta era un errore. E' il comportamento attuale del collector orario e
// MICRO-TASK 54A non lo cambia. Se un batch di backfill riporta failed > 0,
// il rimedio esistente e' resetLabel(processedName, labelName), che rimette
// i thread in coda.
function processLabelPDF(labelName, processedName, functionSlug, startDate) {
  const stats = { threads_found: 0, queued: 0, duplicate: 0, failed: 0, processed_label_added: 0 };
  const label = GmailApp.getUserLabelByName(labelName);
  if (!label) { Logger.log('Label not found: ' + labelName); return stats; }
  const processedLabel = GmailApp.getUserLabelByName(processedName)
    || GmailApp.createLabel(processedName);
  let cutoff;
  if (startDate) {
    cutoff = startDate;
  } else {
    cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
  }
  const threads = label.getThreads(0, 20).filter(function(t) {
    return t.getLastMessageDate() > cutoff;
  });
  stats.threads_found = threads.length;
  Logger.log('[' + labelName + '] ' + threads.length + ' threads');
  threads.forEach(function(thread) {
    thread.getMessages().forEach(function(msg) {
      let processed = false;
      msg.getAttachments().forEach(function(att) {
        const name = att.getName().toLowerCase();
        if (!name.endsWith('.pdf')) return;
        const payload = {
          pdf_base64: Utilities.base64Encode(att.getBytes()),
          filename: att.getName(),
          subject: msg.getSubject(),
          from: msg.getFrom(),
        };
        const result = sendToEdge(functionSlug, payload);
        // Solo l'esito, mai il payload ne' il contenuto dell'email.
        if (result && result.status === 'queued')         stats.queued++;
        else if (result && result.status === 'duplicate') stats.duplicate++;
        else                                              stats.failed++;
        Logger.log('PDF sent: ' + att.getName() + ' → ' + JSON.stringify(result));
        processed = true;
      });
      if (processed) {
        thread.removeLabel(label);
        thread.addLabel(processedLabel);
        stats.processed_label_added++;
      }
    });
  });
  return stats;
}

function processLabelCSV(labelName, processedName, functionSlug) {
  const label = GmailApp.getUserLabelByName(labelName);
  if (!label) { Logger.log('Label not found: ' + labelName); return; }
  const processedLabel = GmailApp.getUserLabelByName(processedName)
    || GmailApp.createLabel(processedName);
  const threads = label.getThreads(0, 20);
  Logger.log('[' + labelName + '] ' + threads.length + ' threads');
  threads.forEach(function(thread) {
    thread.getMessages().forEach(function(msg) {
      const csvFiles = msg.getAttachments().filter(function(a) {
        return a.getName().toLowerCase().endsWith('.csv');
      });
      if (csvFiles.length === 0) {
        thread.removeLabel(label);
        return;
      }
      const payload = {
        subject: msg.getSubject(),
        from: msg.getFrom(),
        date: msg.getDate().toISOString(),
        csvs: csvFiles.map(function(f) {
          return { filename: f.getName(), content: Utilities.base64Encode(f.getBytes()) };
        }),
      };
      const result = sendToEdge(functionSlug, payload);
      Logger.log('CSV sent: ' + JSON.stringify(result));
      thread.removeLabel(label);
      thread.addLabel(processedLabel);
      msg.markRead();
    });
  });
}

function resetLabel(fromName, toName) {
  const from = GmailApp.getUserLabelByName(fromName);
  const to = GmailApp.getUserLabelByName(toName);
  if (!from || !to) { Logger.log('Label not found'); return; }
  const threads = from.getThreads(0, 50);
  threads.forEach(function(t) { t.removeLabel(from); t.addLabel(to); });
  Logger.log('Reset ' + threads.length + ' threads → ' + toName);
}