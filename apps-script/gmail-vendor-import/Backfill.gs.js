// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 54A — recupero storico dal 1 giugno 2026.
//
// Funzioni ESPLICITE, da invocare a mano dall'editor Apps Script. Nessuna
// di queste e' chiamata da checkAllEmails(): il collector orario resta
// esattamente com'era.
//
// Perche' servono: processLabelPDF() filtra a 30 giorni, e le email piu'
// vecchie non vengono processate NE' de-etichettate, quindi restano ferme
// nella label `-import` per sempre (MICRO-TASK 53). Il backfill passa una
// start date esplicita al posto di quel cutoff.
//
// Batch: 20 per invocazione, ovunque. Si rilancia la funzione finche' il
// log non riporta threads_found = 0.
//
// Fruge NON ha una funzione di backfill: e' gia' completo, 51/51, con
// fruge-import vuota. Un replay sarebbe solo rumore.
// ══════════════════════════════════════════════════════════════════

// 1 giugno 2026 costruito in ora LOCALE dello script (America/Chicago,
// vedi appsscript.json). Volutamente NON una stringa ISO ne' un parse UTC:
// quelli possono spostare il giorno a seconda del fuso.
function backfillStartJune2026() {
  return new Date(2026, 5, 1);   // mese 0-based: 5 = giugno
}

// Log uniforme per ogni batch. Solo conteggi ed esiti: mai token, mai
// payload, mai contenuto delle email.
function logBackfill(vendor, stats) {
  Logger.log(
    'BACKFILL ' + vendor +
    ' | threads_found=' + stats.threads_found +
    ' | queued=' + stats.queued +
    ' | duplicate=' + stats.duplicate +
    ' | failed=' + stats.failed +
    ' | processed_label_added=' + stats.processed_label_added +
    ' | threads_retained_for_retry=' + (stats.threads_retained_for_retry || 0)
  );
  if (stats.failed > 0) {
    Logger.log('BACKFILL ' + vendor + ' | ' + stats.failed + ' invii falliti; ' +
      (stats.threads_retained_for_retry || 0) + ' thread NON etichettati e ancora in coda. ' +
      'Rilanciare la funzione: i PDF gia' + String.fromCharCode(39) + ' riusciti torneranno duplicate.');
  }
  return stats;
}

// ── Walmart / TreviPay ───────────────────────────────────────────
// Stesso identico percorso del collector orario: label trevipay-import →
// trevipay-processed, endpoint gmail-vendor-import, parsing PDF e dedup
// invariati. Il buyer guard cucina/bar decide nel backend, non qui.
function backfillTreviPayFromJune2026() {
  // strict labeling (MICRO-TASK 54B): un thread con anche un solo PDF fallito
  // NON viene etichettato -processed, cosi' resta in coda per il giro dopo.
  var stats = processLabelPDF('trevipay-import', 'trevipay-processed',
                              'gmail-vendor-import', backfillStartJune2026(), true);
  return logBackfill('WALMART', stats);
}

// ── Hardie's ─────────────────────────────────────────────────────
// SOLO le invoice, che sono i documenti acquistabili. Le order confirmation
// Hardie's hanno un percorso separato (checkHardiesOrderConfirmations, verso
// hardies-order-check) che oggi NON gira: MICRO-TASK 54A non lo abilita e non
// lo aggiunge a checkAllEmails().
function backfillHardiesFromJune2026() {
  // strict labeling (MICRO-TASK 54B), come per Walmart.
  var stats = processLabelPDF('hardies-import', 'hardies-processed',
                              'gmail-hardies-import', backfillStartJune2026(), true);
  return logBackfill('HARDIES', stats);
}

// ── Ben E. Keith ─────────────────────────────────────────────────
// Stessa pipeline di checkBEKEmails (processBEKQuery), con UNA sola
// differenza: ignora BEK_TEST_MODE, che restringerebbe la ricerca a un solo
// Sales Order di test.
//
// Il gate BEK_ENABLED resta in vigore: se non e' 'true', qui non succede
// nulla, esattamente come nel percorso orario.
//
// Raccoglie TUTTE le confirmation dal 1 giugno, cucina e sala insieme. Il
// buyer guard di produzione (v12) smista: raven_wolf_1510@yahoo.com diventa
// un acquisto, zeno@zenosonthesquare.com finisce 'ignored', qualunque altro
// indirizzo fallisce chiuso. Il collector non deve replicare quella regola.
function backfillBEKFromJune2026() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('BEK_ENABLED') !== 'true') {
    Logger.log('BACKFILL BEK | Skipped — BEK_ENABLED non impostata a true.');
    return { threads_found: 0, queued: 0, duplicate: 0, failed: 0, processed_label_added: 0 };
  }

  // after:2026/05/31 e' esclusivo sul giorno indicato, quindi copre dal
  // 1 giugno 2026 in avanti.
  var query = 'from:benekeith.com subject:"Order Confirmation" after:2026/05/31 -label:bek-processed';

  var stats = processBEKQuery(query, '[BEK-BACKFILL]');
  return logBackfill('BEK', stats);
}
