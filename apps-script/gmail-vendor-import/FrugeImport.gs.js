function checkFrugeEmails() {
  processLabelPDF('fruge-import', 'fruge-processed', 'gmail-vendor-import');
  // Usa lo stesso endpoint — il parser riconosce Fruge dal contenuto
}

function resetFrugeLabels() {
  resetLabel('fruge-processed', 'fruge-import');
}