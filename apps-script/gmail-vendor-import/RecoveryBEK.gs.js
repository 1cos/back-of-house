// ══════════════════════════════════════════════════════════════════
// MICRO-TASK 66 — recovery one-shot di DUE sole confirmation.
//
// MT63 ha perso due conferme: l'intake le ha scartate come 'duplicate'
// del solo Sales Order, e il collector ha comunque etichettato i thread
// perche' 'duplicate' e' un esito confermato. MT64/MT65 hanno corretto
// intake e revision logic; questi due messaggi vanno rimandati.
//
// Questo file NON contiene una query. Contiene una ALLOWLIST di due
// thread id. Qualunque altro thread viene rifiutato, anche se passato
// esplicitamente. Non esiste un percorso in cui questo codice possa
// toccare un terzo thread.
//
// NON tocca le etichette. I due thread hanno gia' bek-processed, il che
// e' corretto: sono stati inviati. Toglierla e rimetterla sarebbe una
// mutazione inutile su Gmail. Il filtro qui e' l'id, non la label.
//
// Le due funzioni sono SEPARATE di proposito: il canary deve essere
// sequenziale, con un audit in mezzo. Una sola funzione con un
// parametro renderebbe possibile lanciarle insieme per distrazione.
// ══════════════════════════════════════════════════════════════════

var BEK_RECOVERY_ALLOWLIST = {
  '19f3299cede96029': { salesOrder: '0002492315', buyer: 'KITCHEN' },
  '19f32a01faf57e59': { salesOrder: '0002492915', buyer: 'ZENO'    },
};

// Unico punto di invio. Rifiuta tutto cio' che non e' in allowlist.
function recoverBEKSingleThread_(threadId) {
  var atteso = BEK_RECOVERY_ALLOWLIST[threadId];
  if (!atteso) {
    Logger.log('RECOVERY BEK | RIFIUTATO — thread ' + threadId + ' non e in allowlist. Nessun invio.');
    return { refused: true, thread_id: threadId };
  }

  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('BEK_ENABLED') !== 'true') {
    Logger.log('RECOVERY BEK | Skipped — BEK_ENABLED non impostata a true.');
    return { skipped: true };
  }

  var thread = GmailApp.getThreadById(threadId);
  if (!thread) {
    Logger.log('RECOVERY BEK | thread ' + threadId + ' non trovato.');
    return { error: 'thread non trovato', thread_id: threadId };
  }

  // INV10FINAL.1 — stesso contratto del collector: l'unita' e' il MESSAGGIO.
  // Prima partiva solo msgs[msgs.length - 1], quindi su un thread con due
  // messaggi il recovery recuperava meta' del thread e lo dichiarava fatto.
  var eleggibili = bekMessaggiEleggibili(thread);
  if (eleggibili.length === 0) {
    Logger.log('RECOVERY BEK | RIFIUTATO — thread ' + threadId + ' non ha messaggi eleggibili.');
    return { refused: true, thread_id: threadId, motivo: 'nessun messaggio eleggibile' };
  }
  var subject = eleggibili[eleggibili.length - 1].getSubject();

  // Secondo cancello: il Sales Order nel subject deve essere quello atteso.
  // Se Gmail restituisse un thread diverso da quello che crediamo, ci
  // fermiamo qui invece di mandare il messaggio sbagliato.
  var sm = String(subject).match(/;\s*(\d+)\s*$/);
  var so = sm ? sm[1] : null;
  if (so !== atteso.salesOrder) {
    Logger.log('RECOVERY BEK | RIFIUTATO — thread ' + threadId + ' porta Sales Order ' + so +
               ', atteso ' + atteso.salesOrder + '. Nessun invio.');
    return { refused: true, thread_id: threadId, sales_order_trovato: so };
  }

  Logger.log('RECOVERY BEK | invio thread ' + threadId + ' Sales Order ' + so +
             ' (' + atteso.buyer + '), ' + eleggibili.length + ' messaggi');

  // Dal piu' vecchio al piu' nuovo, e al primo fallimento ci si ferma: i
  // successivi prenderebbero un created_at anteriore al mancante e
  // invertirebbero la cronologia che decide la revisione operativa (MT61).
  var risultati = [];
  var tuttiOk = true;
  for (var i = 0; i < eleggibili.length; i++) {
    var result = bekInviaMessaggio(eleggibili[i]);
    risultati.push(result);
    Logger.log('RECOVERY BEK | esito messaggio ' + (i + 1) + '/' + eleggibili.length +
               ': ' + JSON.stringify(result));
    if (!bekInvioRiuscito(result)) { tuttiOk = false; break; }
  }
  return { thread_id: threadId, sales_order: so, buyer: atteso.buyer,
           messaggi: eleggibili.length, tutti_ok: tuttiOk,
           results: risultati, result: risultati[risultati.length - 1] };
}

// ── Canary 1 — SOLO 0002492315, cucina ───────────────────────────
function recoverBEKConfirmation1() {
  return recoverBEKSingleThread_('19f3299cede96029');
}

// ── Canary 2 — SOLO 0002492915, Zeno. Da lanciare SOLO dopo che il
//    canary 1 e' stato verificato. ─────────────────────────────────
function recoverBEKConfirmation2() {
  return recoverBEKSingleThread_('19f32a01faf57e59');
}

// ── Prova di idempotenza: rimanda lo STESSO messaggio del canary 1.
//    Atteso: status 'duplicate', nessun nuovo documento. ───────────
function recoverBEKIdempotencyProbe() {
  return recoverBEKSingleThread_('19f3299cede96029');
}
