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
// `strictSuccessLabeling` OPZIONALE (MICRO-TASK 54B). Di default resta il
// comportamento legacy: le etichette si spostano appena un PDF e' stato
// inviato, anche su risposta di errore. E' cosi' che si comporta il collector
// orario e non lo cambiamo qui.
//
// In strict mode la decisione e' per THREAD e solo su esito confermato: un
// documento fallito non viene mai nascosto dietro un'etichetta -processed.
// Serve al backfill storico, dove l'obiettivo e' recuperare TUTTO.
function processLabelPDF(labelName, processedName, functionSlug, startDate, strictSuccessLabeling) {
  const stats = { threads_found: 0, queued: 0, duplicate: 0, failed: 0,
                  processed_label_added: 0, threads_retained_for_retry: 0 };
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
    let threadHadPdf = false;
    let threadAllOk = true;
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
        // Esito positivo: la stessa forma per ENTRAMBI gli endpoint —
        // verificato sul sorgente di gmail-vendor-import e sulla versione in
        // produzione di gmail-hardies-import (v32), che condividono
        // jsonResponse({status:'queued'|'duplicate'}) e jsonError({error}).
        // sendToEdge aggiunge {error} anche sulle eccezioni di rete.
        const ok = !!result && !result.error &&
                   (result.status === 'queued' || result.status === 'duplicate');
        if (ok) {
          if (result.status === 'queued') stats.queued++; else stats.duplicate++;
        } else {
          stats.failed++;
          threadAllOk = false;
        }
        // Solo l'esito, mai il payload ne' il contenuto dell'email.
        Logger.log('PDF sent: ' + att.getName() + ' → ' + JSON.stringify(result));
        processed = true;
        threadHadPdf = true;
      });
      // LEGACY (default): etichetta per messaggio appena un PDF e' stato
      // inviato, a prescindere dall'esito. Comportamento del collector
      // orario, lasciato intatto.
      if (processed && !strictSuccessLabeling) {
        thread.removeLabel(label);
        thread.addLabel(processedLabel);
        stats.processed_label_added++;
      }
    });
    // STRICT (solo backfill): decisione a livello di THREAD, dopo aver visto
    // tutti i suoi PDF. Un solo fallimento e il thread resta in coda.
    // Al giro dopo i PDF gia' riusciti tornano 'duplicate' — no-op lato
    // backend — mentre quello fallito viene ritentato. Meglio un reinvio
    // innocuo che un documento perso.
    if (strictSuccessLabeling && threadHadPdf) {
      if (threadAllOk) {
        thread.removeLabel(label);
        thread.addLabel(processedLabel);
        stats.processed_label_added++;
      } else {
        stats.threads_retained_for_retry++;
      }
    }
  });
  return stats;
}

// INV07 — gemello body-only di processLabelPDF.
//
// Perche' non bastava quello: FreshPoint non allega niente. La conferma
// d'ordine E' il corpo dell'email, e processLabelPDF itera
// msg.getAttachments() — su un messaggio senza allegati non manda nulla
// e non fa nulla. Il vecchio collector FreshPoint mandava invece
// {raw_text, vendor}, due campi che gmail-vendor-import non legge
// nemmeno: destruttura {pdf_base64, filename, subject, from, body,
// html_body}. Risultato: 400 "Missing pdf_base64" su ogni email, e
// l'etichetta processed messa lo stesso.
//
// Qui si manda la forma che l'edge function conosce davvero, body e
// html_body, la stessa gia' usata per Ben E. Keith. Nessun secondo
// protocollo, nessuna conversione del corpo in un finto PDF.
//
// IL MESSAGGIO GIUSTO NON E' SEMPRE L'ULTIMO. Il thread 19478941 e'
// reale e contiene, dopo l'originale FreshPoint, un inoltro partito da
// noi: prendere l'ultimo messaggio manderebbe all'edge un'email con
// from massimiliano e subject "Fwd: ...", che non verrebbe riconosciuta.
// Si prende quindi l'ULTIMO messaggio il cui mittente corrisponde a
// senderPattern, e se non ce n'e' nessuno il thread viene saltato senza
// etichettarlo.
//
// startDate e strictSuccessLabeling hanno la stessa semantica di
// processLabelPDF: senza startDate resta il cutoff relativo a 30 giorni;
// in strict la -processed si mette SOLO su queued o duplicate.
function processLabelBody(labelName, processedName, functionSlug, senderPattern, startDate, strictSuccessLabeling) {
  const stats = { threads_found: 0, queued: 0, duplicate: 0, failed: 0,
                  processed_label_added: 0, threads_retained_for_retry: 0,
                  skipped_no_source_message: 0 };
  const label = GmailApp.getUserLabelByName(labelName);
  if (!label) { Logger.log('Label not found: ' + labelName); return stats; }
  const processedLabel = GmailApp.getUserLabelByName(processedName)
    || GmailApp.createLabel(processedName);

  let cutoff;
  if (startDate) { cutoff = startDate; }
  else { cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30); }

  const threads = label.getThreads(0, 20).filter(function(t) {
    return t.getLastMessageDate() > cutoff;
  });
  stats.threads_found = threads.length;
  Logger.log('[' + labelName + '] ' + threads.length + ' threads');

  threads.forEach(function(thread) {
    const msgs = thread.getMessages();
    let msg = null;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (!senderPattern || senderPattern.test(msgs[i].getFrom())) { msg = msgs[i]; break; }
    }
    if (!msg) {
      stats.skipped_no_source_message++;
      Logger.log('[' + labelName + '] thread senza messaggio del mittente atteso: non etichettato');
      return;
    }

    const result = sendToEdge(functionSlug, {
      subject:   msg.getSubject(),
      from:      msg.getFrom(),
      body:      msg.getPlainBody(),
      html_body: msg.getBody(),
    });

    const ok = !!result && !result.error &&
               (result.status === 'queued' || result.status === 'duplicate');
    if (ok) {
      if (result.status === 'queued') stats.queued++; else stats.duplicate++;
    } else {
      stats.failed++;
    }
    Logger.log('Body sent: ' + msg.getSubject() + ' \u2192 ' + JSON.stringify(result));

    if (ok || !strictSuccessLabeling) {
      thread.removeLabel(label);
      thread.addLabel(processedLabel);
      stats.processed_label_added++;
    } else {
      stats.threads_retained_for_retry++;
    }
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