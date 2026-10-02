// XCF-GG — Global Gourmet Foods: acquisizione dei PDF da Gmail.
//
// Global Gourmet non ha mai avuto una fonte automatica (INV16): le fatture
// erano di carta. Adesso Mauricio Martinez le manda come SCANSIONE PDF
// (es. "Scanned Document 72.pdf", 02/10/2026, tre fatture in un file),
// spesso in risposta al thread AR di Mauro Ceotto.
//
// Cosa fa questo collector, e cosa NON fa:
//   - trova da solo le email *@ggourmetfoods.com con allegato (nessun
//     filtro Gmail da mantenere, come Fruge da INV11FINAL.1);
//   - manda ogni PDF a gmail-vendor-import, lo stesso endpoint di Fruge e
//     TreviPay: e' lui che salva il file in Storage (app/invoices/gmail) e
//     crea il vendor_documents;
//   - NON legge il PDF e non fa OCR: lo fa il worker (vendor-doc-auto-
//     import), che ha la chiave Vision gia' esistente. Qui nessuno scope
//     nuovo: solo GmailApp, UrlFetchApp e Utilities, gia' autorizzati.
//
// DOCUMENTI FERMI FINCHE' IL PARSER NON E' DEPLOYATO. Il trigger DB
// trg_vd_hold_global_gourmet (migrations/20261002_xcf_gg_01_hold.sql)
// mette ogni nuovo documento di @ggourmetfoods.com in 'error' con
// GG_HOLD_PARSER_NOT_DEPLOYED, e il PDF resta in Storage. Il rilascio e'
// un passo esplicito del coordinatore (20261002_xcf_gg_02_release.sql).
//
// PERCHE' IL SUBJECT HA UN'IMPRONTA. gmail-vendor-import scarta come
// 'duplicate' un secondo PDF con lo stesso subject+from. Nel thread AR
// tutte le risposte di Mauricio hanno lo stesso oggetto ("Re: AR ZENO /
// OPEN BALANCE SELECTYED"): la fattura del martedi' che arrivera' li'
// sarebbe stata buttata come doppione della prima. Aggiungendo al subject
// i primi 12 caratteri dello SHA-256 del PDF la chiave diventa il
// CONTENUTO: lo stesso PDF rimandato torna 'duplicate' (giusto), un PDF
// diverso nello stesso thread diventa un documento nuovo (giusto).
// Il dedup per numero fattura resta al worker.
//
// Fail-closed come gli altri collector (INV05D/INV08FINAL/INV09B): la
// gg-processed si mette sul thread SOLO se tutti i suoi PDF Global Gourmet
// sono tornati 'queued' o 'duplicate'.

// after:2026/10/01 — lo storico GG (statement AR 2023, report 2025) NON
// deve entrare da qui: sono estratti conto, non fatture, e le fatture
// storiche hanno un percorso loro (modalita' storica, XCF-GG).
var GG_INTAKE_QUERY =
  'from:ggourmetfoods.com has:attachment after:2026/10/01 -label:gg-processed';
var GG_SENDER_RE = /@ggourmetfoods\.com/i;

function ggImpronta(bytes) {
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  return d.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); })
          .join('').slice(0, 12);
}

function checkGlobalGourmetEmails() {
  var stats = { threads_found: 0, pdf_sent: 0, queued: 0, duplicate: 0, failed: 0,
                processed_label_added: 0, threads_retained_for_retry: 0 };
  var processedLabel = GmailApp.getUserLabelByName('gg-processed')
    || GmailApp.createLabel('gg-processed');

  var threads = GmailApp.search(GG_INTAKE_QUERY, 0, 20);
  stats.threads_found = threads.length;

  threads.forEach(function (thread) {
    var threadHadPdf = false;
    var threadAllOk = true;
    thread.getMessages().forEach(function (msg) {
      // Nel thread AR ci sono anche messaggi di Selected Foods e nostri:
      // si prende SOLO cio' che manda Global Gourmet.
      if (!GG_SENDER_RE.test(msg.getFrom())) return;
      msg.getAttachments().forEach(function (att) {
        if (!/\.pdf$/i.test(att.getName())) return;
        var bytes = att.getBytes();
        var result = sendToEdge('gmail-vendor-import', {
          pdf_base64: Utilities.base64Encode(bytes),
          filename:   att.getName(),
          subject:    msg.getSubject() + ' [GG ' + ggImpronta(bytes) + ']',
          from:       msg.getFrom(),
        });
        var ok = !!result && !result.error &&
                 (result.status === 'queued' || result.status === 'duplicate');
        stats.pdf_sent++;
        if (ok) { if (result.status === 'queued') stats.queued++; else stats.duplicate++; }
        else { stats.failed++; threadAllOk = false; }
        Logger.log('[GG] PDF ' + att.getName() + ' → ' + JSON.stringify(result));
        threadHadPdf = true;
      });
    });
    // Un thread senza PDF Global Gourmet non ha niente da mandare: si
    // etichetta comunque, altrimenti tornerebbe a ogni giro. Un messaggio
    // NUOVO nello stesso thread non ha l'etichetta e lo fa ritrovare.
    if (threadAllOk) {
      thread.addLabel(processedLabel);
      stats.processed_label_added++;
    } else {
      stats.threads_retained_for_retry++;
    }
  });

  Logger.log('[GG] ' + JSON.stringify(stats));
  return stats;
}
