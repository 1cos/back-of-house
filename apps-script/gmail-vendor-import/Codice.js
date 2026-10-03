function checkAllEmails() {
  checkHardiesEmails();
  checkFreshpointEmails();
  processTouchBistroEmails();
  checkBEKEmails();
  checkFrugeEmails();
  checkTreviPayEmails();
  // XCF-GG — ultimo di proposito: un suo errore non puo' fermare gli altri.
  checkGlobalGourmetEmails();
  // checkTripleSeat();  — quando connesso
  // checkSevenShift();  — quando connesso
}

function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('checkAllEmails').timeBased().everyHours(1).create();
  Logger.log('Trigger: ogni ora → checkAllEmails');
}