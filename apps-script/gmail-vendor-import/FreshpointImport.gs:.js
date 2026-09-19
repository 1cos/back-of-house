function checkFreshpointEmails() {
  const label = GmailApp.getUserLabelByName('freshpoint-import');
  if (!label) { Logger.log('Label freshpoint-import non trovata'); return; }
  const processedLabel = GmailApp.getUserLabelByName('freshpoint-processed')
    || GmailApp.createLabel('freshpoint-processed');
  const threads = label.getThreads(0, 20);
  Logger.log('[freshpoint-import] ' + threads.length + ' threads');
  threads.forEach(function(thread) {
    thread.getMessages().forEach(function(msg) {
      const payload = {
        raw_text: msg.getPlainBody(),
        subject: msg.getSubject(),
        from: msg.getFrom(),
        vendor: 'freshpoint',
      };
      const result = sendToEdge('gmail-vendor-import', payload);
      Logger.log('FreshPoint: ' + JSON.stringify(result));
      thread.removeLabel(label);
      thread.addLabel(processedLabel);
    });
  });
}

function resetFreshpointLabels() {
  resetLabel('freshpoint-processed', 'freshpoint-import');
}