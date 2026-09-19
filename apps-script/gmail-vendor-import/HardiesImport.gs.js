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
    thread.addLabel(processedLabel);
  });
}

function checkHardiesEmails() {
  processLabelPDF('hardies-import', 'hardies-processed', 'gmail-hardies-import');
}