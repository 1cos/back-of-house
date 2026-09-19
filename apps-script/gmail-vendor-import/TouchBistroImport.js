function processTouchBistroEmails() {
  processLabelCSV('touchbistro-import', 'touchbistro-processed', 'gmail-touchbistro-import');
}

function resetTouchBistroLabels() {
  resetLabel('touchbistro-processed', 'touchbistro-import');
}