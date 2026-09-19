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
    Logger.log('BACKFILL BEK | Skipped \u2014 BEK_ENABLED non impostata a true.');
    return { threads_found: 0, eligible_total: 0, queued: 0, duplicate: 0, failed: 0,
             processed_label_added: 0, skipped_after_failure: 0, threads_retained_for_retry: 0 };
  }

  // after:2026/05/31 e' esclusivo sul giorno indicato, quindi copre dal
  // 1 giugno 2026 in avanti.
  var query = 'from:benekeith.com subject:"Order Confirmation" after:2026/05/31 -label:bek-processed';

  var stats = processBEKBacklogChronological(query, '[BEK-BACKFILL]', BEK_BACKFILL_BATCH_SIZE);
  return logBackfill('BEK', stats);
}

// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 61 — il backfill BEK non puo' usare processBEKQuery.
//
// Il backend sceglie quale revisione di un Sales Order e' operativa
// confrontando created_at, cioe' l'ORDINE DI INGESTIONE (index.ts,
// MICRO-TASK 42 sezione F). Quella regola assume che le email arrivino in
// ordine cronologico, come succede nel collector orario.
//
// GmailApp.search restituisce dal piu' NUOVO al piu' vecchio. Nel backfill
// l'ordine di ingestione risulta quindi INVERTITO: la conferma entra per
// prima con created_at basso, l'acknowledgement entra dopo con created_at
// alto e viene giudicato "il piu' recente". Caso reale trovato in
// MICRO-TASK 60, Sales Order 0003015274 (CUCINA):
//
//   25/08  "Thank you for your order!"    acknowledgement
//   26/08  "Your order is confirmed"      l'acquisto vero
//
// Senza questo modulo entrerebbero le quantita' ORDINATE invece di quelle
// CONFERMATE.
//
// Ordinare i 20 thread restituiti da search NON basta: una coppia puo'
// cadere a cavallo del taglio (vecchia in posizione 21, nuova in 20). Per
// questo si raccoglie PRIMA tutto il backlog eleggibile, si ordina
// GLOBALMENTE, e solo dopo si taglia a batchSize. Cosi' la revisione piu'
// vecchia sta sempre in un batch precedente o uguale a quella nuova.
// ══════════════════════════════════════════════════════════════════

var BEK_BACKFILL_BATCH_SIZE = 20;

// Tetto duro alla raccolta, perche' il backlog storico e' finito ma la
// funzione deve restare sana anche se un giorno fosse molto piu' grande.
// Se il backlog lo supera, si lavora comunque sui piu' VECCHI, che e'
// l'ordine giusto: il taglio avviene dopo l'ordinamento.
var BEK_BACKFILL_HARD_CAP = 500;

// GmailApp.search pagina con (query, start, max). Un'unica chiamata da 500
// non e' garantita, quindi la paginazione e' esplicita.
function collectAllThreadsPaged(query, hardCap) {
  var all = [];
  var page = 100;
  var start = 0;
  while (start < hardCap) {
    var want = Math.min(page, hardCap - start);
    var chunk = GmailApp.search(query, start, want);
    if (!chunk || chunk.length === 0) break;
    all = all.concat(chunk);
    if (chunk.length < want) break;   // ultima pagina
    start += chunk.length;
  }
  return all;
}

// Il Sales Order serve SOLO a raggruppare le revisioni dentro un run, mai a
// decidere cosa e' un acquisto: quella decisione resta del backend.
// Il subject e' la via rapida, ma MICRO-TASK 60 ha trovato un thread reale
// il cui subject finisce con ";null" mentre il corpo porta un Sales Order
// valido (0003055973). Per quello c'e' il fallback sul corpo, la stessa
// fonte che il parser considera autorevole.
function bekSalesOrderKey(msg, subject) {
  var sm = String(subject || '').match(/;\s*(\d+)\s*$/);
  if (sm) return sm[1];
  var body = '';
  try { body = msg.getPlainBody(); } catch (e) { body = ''; }
  var bm = String(body || '').match(/Sales\s*Order\s*#?\s*:?\s*\*?\s*(\d+)/i);
  return bm ? bm[1] : null;
}

function processBEKBacklogChronological(query, tag, batchSize) {
  var stats = {
    threads_found: 0, eligible_total: 0, queued: 0, duplicate: 0, failed: 0,
    processed_label_added: 0, skipped_after_failure: 0, threads_retained_for_retry: 0
  };

  var processedLabel = GmailApp.getUserLabelByName('bek-processed')
    || GmailApp.createLabel('bek-processed');

  var all = collectAllThreadsPaged(query, BEK_BACKFILL_HARD_CAP);
  stats.eligible_total = all.length;

  // Ordinamento GLOBALE crescente PRIMA del taglio. E' il cuore del fix.
  all.sort(function (a, b) {
    return a.getLastMessageDate().getTime() - b.getLastMessageDate().getTime();
  });

  var batch = all.slice(0, batchSize);
  stats.threads_found = batch.length;
  Logger.log(tag + ' eleggibili ' + stats.eligible_total + ', in questo batch ' + batch.length +
             ' (dal piu vecchio)');

  // Sales Order per cui una revisione e' gia' fallita in QUESTO run. Le
  // revisioni successive dello stesso ordine non partono: se partissero,
  // prenderebbero created_at prima della vecchia, che tornerebbe solo a un
  // retry successivo, invertendo di nuovo l'ordine. Un fallimento su A non
  // tocca B.
  var blocked = {};

  batch.forEach(function (thread) {
    // Invariato rispetto a processBEKQuery: un thread con piu' messaggi
    // manda SOLO l'ultimo. Verificato reale su 0002927278 (MICRO-TASK 60).
    var msgs = thread.getMessages();
    var msg = msgs[msgs.length - 1];
    var subject = msg.getSubject();
    var salesOrder = bekSalesOrderKey(msg, subject);

    if (salesOrder && blocked[salesOrder]) {
      stats.skipped_after_failure++;
      stats.threads_retained_for_retry++;
      Logger.log(tag + ' SKIP revisione successiva di ' + salesOrder +
                 ': una revisione precedente dello stesso ordine e fallita in questo run');
      return;
    }

    var result = sendToEdge('gmail-vendor-import', {
      subject: subject,
      from: msg.getFrom(),
      html_body: msg.getBody()
    });

    // Etichetta SOLO su esito confermato, come il percorso strict di
    // MICRO-TASK 54B: su errore il thread resta eleggibile per un retry.
    if (result && !result.error && (result.status === 'queued' || result.status === 'duplicate')) {
      thread.addLabel(processedLabel);
      stats.processed_label_added++;
      if (result.status === 'queued') stats.queued++; else stats.duplicate++;
    } else {
      stats.failed++;
      stats.threads_retained_for_retry++;
      if (salesOrder) blocked[salesOrder] = true;
      Logger.log(tag + ' Non etichettato \u2014 risposta non confermata: ' + JSON.stringify(result));
    }
  });

  return stats;
}
