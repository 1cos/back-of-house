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

function processLabelPDF(labelName, processedName, functionSlug) {
  const label = GmailApp.getUserLabelByName(labelName);
  if (!label) { Logger.log('Label not found: ' + labelName); return; }
  const processedLabel = GmailApp.getUserLabelByName(processedName)
    || GmailApp.createLabel(processedName);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const threads = label.getThreads(0, 20).filter(function(t) {
    return t.getLastMessageDate() > cutoff;
  });
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
        Logger.log('PDF sent: ' + att.getName() + ' → ' + JSON.stringify(result));
        processed = true;
      });
      if (processed) {
        thread.removeLabel(label);
        thread.addLabel(processedLabel);
      }
    });
  });
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