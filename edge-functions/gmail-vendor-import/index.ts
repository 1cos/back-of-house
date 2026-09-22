import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const payload = await req.json();
    const { pdf_base64, filename, subject, from, body, html_body } = payload;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ── FIX (BOH OS Task 10): Ben E. Keith Order Confirmation emails carry no
    // attachment — every field lives in the plain-text body. Detection here is
    // deliberately specific (sender domain and/or exact subject phrasing), not
    // a bare "keith" match, and is kept separate from the generic vendorHint
    // heuristic below (used only for the existing PDF path, unchanged).
    const isBekSender  = /@benekeith\.com/i.test(from || '');
    const isBekSubject = /ben\s+e\.?\s+keith\s*:\s*order confirmation/i.test(subject || '');
    const isBekOrderConfirmation = isBekSender || isBekSubject;

    // INV07 — FreshPoint Dallas manda la conferma d'ordine nel CORPO,
    // senza allegati. Riconoscimento su due segnali insieme, non uno:
    // il dominio del mittente E la frase nel subject. Lo stesso criterio
    // stretto usato sopra per Ben E. Keith.
    const isFreshpointSender    = /@freshpoint\.com/i.test(from || '');
    const isFreshpointOrderConf = isFreshpointSender && /order\s+confirmation/i.test(subject || '');

    if (!pdf_base64) {
      // FIX (BOH OS Task 11F): getPlainBody() degrades real BEK content
      // (values wrapped in stray asterisks, item table rows entirely
      // stripped — confirmed against real production data, Task 11E).
      // html_body (msg.getBody()) is the authoritative source when present;
      // body stays supported for backward compatibility (Task 10/11B/11D),
      // just no longer required once html_body is available.
      // INV07 — prima di questo ramo ogni email FreshPoint riceveva 400
      // "Missing pdf_base64", e il collector la marcava comunque come
      // processata: cinque conferme d'ordine reali sono sparite cosi'.
      //
      // Messo PRIMA del gate Ben E. Keith di proposito, per lasciarlo
      // intatto parola per parola: quella riga e' congelata da tre test
      // BEK che la confrontano verbatim, e non c'e' nessun motivo di
      // toccarla. Un messaggio non puo' comunque essere insieme BEK e
      // FreshPoint: i due riconoscimenti guardano domini diversi.
      if (isFreshpointOrderConf && (body || html_body)) {
        return await handleFreshpointOrderConfirmationBody(supabase, { subject, from, body, html_body });
      }
      if (!isBekOrderConfirmation || (!body && !html_body)) return jsonError('Missing pdf_base64', 400);
      return await handleBekOrderConfirmationBody(supabase, { subject, from, body, html_body });
    }

    // Duplicate check by subject + from
    if (subject && from) {
      const { data: existing } = await supabase
        .from('vendor_documents')
        .select('id, status')
        .eq('source_email_subject', subject)
        .eq('source_email_from', from)
        .limit(1);
      if (existing && existing.length > 0)
        return jsonResponse({ status: 'duplicate', message: 'Already imported', document_id: existing[0].id });
    }

    // Save PDF to Supabase Storage
    const pdfBytes = Uint8Array.from(atob(pdf_base64), c => c.charCodeAt(0));
    const safeFilename = (filename || 'invoice.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `invoices/gmail/${Date.now()}_${safeFilename}`;

    const { error: uploadErr } = await supabase.storage
      .from('app')
      .upload(storagePath, pdfBytes, { contentType: 'application/pdf', upsert: false });
    if (uploadErr) return jsonError(`Storage upload error: ${uploadErr.message}`, 500);

    // Detect vendor from subject/filename for display purposes
    const hint = ((subject || '') + ' ' + (filename || '')).toLowerCase();
    let vendorHint = 'unknown';
    if (/fruge/i.test(hint))           vendorHint = 'Fruge Seafood';
    else if (/ben.*keith|keith/i.test(hint)) vendorHint = 'Ben E. Keith';
    else if (/freshpoint/i.test(hint)) vendorHint = 'FreshPoint Dallas';

    // Create vendor_document record — status pdf_received, parsing happens in app
    const { data: doc, error: insertErr } = await supabase
      .from('vendor_documents')
      .insert({
        vendor:               vendorHint,
        document_type:        'invoice',
        status:               'pdf_received',
        uploaded_by:          'gmail-auto',
        source_email_subject: subject || null,
        source_email_from:    from    || null,
        raw_text:             storagePath,
        parsed_json:          { storage_path: storagePath, original_filename: safeFilename },
        warnings:             [],
      })
      .select('id')
      .single();

    if (insertErr) return jsonError(`DB insert error: ${insertErr.message}`, 500);

    return jsonResponse({
      status:       'queued',
      message:      'PDF saved — ready to process in app',
      document_id:  doc.id,
      vendor:       vendorHint,
      storage_path: storagePath,
    });

  } catch (err: any) {
    console.error('gmail-vendor-import error:', err);
    return jsonError(String(err), 500);
  }
});

// ══════════════════════════════════════════════════════════════════
// INV10FINAL.1 — canonicalizzazione MINIMA dei soli fine-riga.
//
// Il dedup BEK confronta raw_text carattere per carattere. Su 0003243454
// la STESSA email e' entrata due volte perche' una lettura portava \n e
// l'altra \r\n: 54 righe di tabella e 8 prodotti identici, ma stringhe
// diverse. A valle la regola di impronta economica di INV10B ha chiuso il
// secondo come exact_duplicate — quindi $0,00 — ma il documento era gia'
// nato.
//
// Qui si toglie SOLO quella differenza, e SOLO per il confronto: quello
// che si scrive in raw_text resta il testo verbatim che e' arrivato.
// Applicata a ENTRAMBI i lati, funziona anche sui documenti gia' in
// archivio, che hanno fine-riga misti.
//
// Nient'altro viene toccato: niente trim, niente collapse degli spazi,
// niente lowercase, niente rimozione di tag. Due revisioni vere — qty,
// prezzo, importo o stato riga diversi — restano stringhe diverse, e lo
// devono restare: e' il dedup a monte, non la difesa contabile, che vive
// nell'impronta economica di INV10B.
// ══════════════════════════════════════════════════════════════════
function gviCanonicalNewlines(s: string | null | undefined): string {
  return String(s == null ? '' : s).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// ── FIX (BOH OS Task 10): body-only path for Ben E. Keith Order Confirmation ──
// No file to store. Only a lightweight extraction happens here, just enough
// for the dedup key and document_number — the real parse (items, pricing,
// ordered/confirmed quantities) happens client-side, reusing the exact same
// Vendor Review pipeline every other vendor already goes through. This is
// not a second parser.
async function handleBekOrderConfirmationBody(
  supabase: any,
  { subject, from, body, html_body }: { subject?: string; from?: string; body?: string; html_body?: string }
) {
  // FIX (BOH OS Task 11F): html_body (msg.getBody()) is authoritative when
  // present — getPlainBody() was confirmed (Task 11E, real production data)
  // to strip the item table entirely and wrap values in stray asterisks.
  // body stays supported (Task 10/11B/11D) for backward compatibility when
  // html_body isn't sent yet.
  const sourceText = html_body || body || '';
  const sourceMarker = html_body ? 'email_html' : 'email_body';

  // Document number extraction. STEP 2: try the body/html text first (tags
  // stripped crudely — this is only for the dedup key, the real per-column
  // HTML table parse happens client-side via DOMParser, not here); the real
  // per-column item parse is NOT attempted server-side. Optional "*" handles
  // the bold-wrapped values confirmed in Task 11E ("Sales Order # *0002952908*").
  // Falls back to the subject, which already carries the Sales Order in a
  // reliable structured position ("...;0002952908") — confirmed against the
  // real production subject line.
  const cleanText = sourceText.replace(/<[^>]+>/g, ' ').replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
  const soM = cleanText.match(/Sales\s*Order\s*#?\s*:?\s*\*?\s*(\d+)/i);
  let salesOrder: string | null = soM ? soM[1] : null; // string — leading zeros preserved, never Number()
  if (!salesOrder && subject) {
    const subM = subject.match(/;\s*(\d+)\s*$/);
    if (subM) salesOrder = subM[1];
  }

  // Dedup key: vendor + document_type + document_number, as required.
  // Falls back to the existing subject+from check only if no Sales Order
  // number could be found at all.
  // ══════════════════════════════════════════════════════════════
  // MICRO-TASK 64 — il dedup NON puo' essere il solo Sales Order.
  //
  // Per Ben E. Keith il Sales Order e' un GRUPPO DI RICONCILIAZIONE, non
  // l'identita' di un messaggio: lo stesso ordine genera piu' email
  // (acknowledgement e poi conferma operativa). Scartare la seconda come
  // 'duplicate' significava che non diventava mai un documento, e quindi
  // che la revision logic di vendor-doc-auto-import (MICRO-TASK 42
  // sezione F) non vedeva MAI due fratelli: era irraggiungibile da questo
  // percorso. MICRO-TASK 63 lo ha osservato in produzione — il backfill
  // ha conservato l'acknowledgement e buttato la conferma.
  //
  // L'identita' vera di un messaggio, gia' disponibile senza nuove colonne
  // e senza cambiare il payload del collector, e' il CONTENUTO: raw_text
  // conserva html_body verbatim. Stessa email -> stesso raw_text ->
  // idempotenza tecnica. Email diversa -> documento nuovo, e decide
  // MT42-F.
  //
  // Un fratello gia' 'imported' NON viene bloccato qui: lo lascia passare
  // di proposito, perche' MT42-F lo gestisce gia' come fail closed
  // (status 'pending' + BEK_REVISION_AFTER_IMPORT bloccante, l'acquisto
  // esistente mai toccato). Fermarlo qui creerebbe un secondo meccanismo
  // e, peggio, lascerebbe il caso invisibile alla review.
  // ══════════════════════════════════════════════════════════════
  if (salesOrder) {
    const { data: siblings } = await supabase
      .from('vendor_documents')
      .select('id, status, raw_text')
      .eq('vendor', 'Ben E. Keith')
      .eq('document_type', 'order_confirmation')
      .eq('document_number', salesOrder)
      .limit(20);   // un Sales Order non ha 20 revisioni: query limitata per sicurezza

    // Confronto sui soli fine-riga canonicalizzati (INV10FINAL.1). Il
    // contenuto memorizzato resta verbatim: si normalizza la CHIAVE, non il
    // documento.
    const sourceKey = gviCanonicalNewlines(sourceText);
    const identical = (siblings || []).find(r => gviCanonicalNewlines(r.raw_text) === sourceKey);
    if (identical)
      return jsonResponse({ status: 'duplicate', message: 'Same message already ingested', document_id: identical.id });
    // Nessun altro ramo: un Sales Order gia' presente con contenuto DIVERSO
    // e' una revisione e deve diventare un documento.
  } else if (subject && from) {
    // FIX (BOH OS Task 11D): the fallback previously matched on subject+from
    // ALONE — no vendor/document_type filter — unlike the primary key path
    // above, which is correctly scoped on all three. That let it match a
    // record with an entirely incompatible shape (e.g. the legacy
    // vendor='bek'/document_type='invoice' row from before Task 9's
    // vendor='Ben E. Keith' convention existed), returning 'duplicate' for a
    // genuinely new, correctly-keyed document. Scoped the same way the
    // primary key path already is.
    const { data: existing } = await supabase
      .from('vendor_documents')
      .select('id, status')
      .eq('vendor', 'Ben E. Keith')
      .eq('document_type', 'order_confirmation')
      .eq('source_email_subject', subject)
      .eq('source_email_from', from)
      .limit(1);
    if (existing && existing.length > 0)
      return jsonResponse({ status: 'duplicate', message: 'Already imported', document_id: existing[0].id });
  }

  const { data: doc, error: insertErr } = await supabase
    .from('vendor_documents')
    .insert({
      vendor:               'Ben E. Keith',
      document_type:        'order_confirmation',
      document_number:      salesOrder,
      status:               'pdf_received', // reuses the existing queue vdrProcessAllPdf() already reads
      uploaded_by:          'gmail-auto',
      source_email_subject: subject || null,
      source_email_from:    from    || null,
      raw_text:             sourceText,     // HTML when available (authoritative), else plain body — no file to store
      parsed_json:          { source: sourceMarker }, // marker: client skips PDF download/extraction, picks the right parser
      warnings:             [],
    })
    .select('id')
    .single();

  if (insertErr) return jsonError(`DB insert error: ${insertErr.message}`, 500);

  return jsonResponse({
    status:          'queued',
    message:         'Order Confirmation body saved — ready to process in app',
    document_id:     doc.id,
    vendor:          'Ben E. Keith',
    document_number: salesOrder,
  });
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
function jsonError(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}

// ── INV07: FreshPoint Dallas — Order Confirmation dal corpo email ──
//
// Stessa forma del gemello Ben E. Keith qui sopra: nessun file da
// salvare, estrazione MINIMA lato server (solo il numero, che serve per
// la chiave di dedup), e il corpo conservato verbatim in raw_text. Il
// parse vero — righe, prezzi, date — avviene dopo, nella stessa pipeline
// Vendor Review di tutti gli altri documenti. Non e' un secondo parser.
//
// DIFFERENZA IMPORTANTE RISPETTO A BEK, e non e' un dettaglio: per Ben
// E. Keith l'HTML e' la fonte autorevole perche' getPlainBody() ne
// distrugge la tabella. Per FreshPoint vale l'opposto: la tabella
// esiste, ben formata, proprio nel testo semplice
// ("| 921068 | LETTUCE ... | 3/2# CS | 1 | 33.95 | 33.95 |"), ed e'
// quella che il parser legge. Quindi qui si preferisce `body`.
// html_body resta come ripiego per non perdere mai la sorgente: in quel
// caso il marker lo dichiara e il parser fallira' in modo visibile,
// invece di far sparire l'email in silenzio.
//
// QUESTO DOCUMENTO NON E' UN ACQUISTO. Il corpo dice "This is not an
// invoice", e isPurchasableDocument('FreshPoint Dallas',
// 'order_confirmation') vale false: non generera' invoice_lines. Entra
// per non perdere la sorgente.
async function handleFreshpointOrderConfirmationBody(
  supabase: any,
  { subject, from, body, html_body }: { subject?: string; from?: string; body?: string; html_body?: string }
) {
  const sourceText   = body || html_body || '';
  const sourceMarker = body ? 'email_body' : 'email_html';

  // Numero d'ordine: la cella "Reference #19464295" nel corpo, con
  // ripiego sul subject ("...Order Confirmation: 19464295-CU59474"),
  // che lo porta in posizione strutturata.
  const cleanText = sourceText.replace(/<[^>]+>/g, ' ').replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
  const refM = cleanText.match(/Reference\s*#\s*(\d+)/i);
  let orderNumber: string | null = refM ? refM[1] : null;
  if (!orderNumber && subject) {
    const subM = subject.match(/Order\s+Confirmation\s*:\s*(\d+)/i);
    if (subM) orderNumber = subM[1];
  }

  // Dedup, stessa scala del gemello BEK: prima per chiave naturale
  // (vendor + tipo + numero), e in quel caso si guarda anche il
  // CONTENUTO, cosi' una revisione vera dello stesso ordine non viene
  // scambiata per un duplicato.
  if (orderNumber) {
    const { data: siblings } = await supabase
      .from('vendor_documents')
      .select('id, status, raw_text')
      .eq('vendor', 'FreshPoint Dallas')
      .eq('document_type', 'order_confirmation')
      .eq('document_number', orderNumber);
    const identical = (siblings || []).find((r: any) => r.raw_text === sourceText);
    if (identical) {
      return jsonResponse({ status: 'duplicate', message: 'Same message already ingested', document_id: identical.id });
    }
  } else if (subject && from) {
    const { data: existing } = await supabase
      .from('vendor_documents')
      .select('id, status')
      .eq('source_email_subject', subject)
      .eq('source_email_from', from)
      .limit(1);
    if (existing && existing.length > 0) {
      return jsonResponse({ status: 'duplicate', message: 'Already imported', document_id: existing[0].id });
    }
  }

  const { data: doc, error: insertErr } = await supabase
    .from('vendor_documents')
    .insert({
      vendor:               'FreshPoint Dallas',
      document_type:        'order_confirmation',
      document_number:      orderNumber,
      status:               'pdf_received', // stessa coda che Phase A e la UI leggono gia'
      uploaded_by:          'gmail-auto',
      source_email_subject: subject || null,
      source_email_from:    from    || null,
      raw_text:             sourceText,
      parsed_json:          { source: sourceMarker },
      warnings:             [],
    })
    .select('id')
    .single();

  if (insertErr) return jsonError(`DB insert error: ${insertErr.message}`, 500);

  return jsonResponse({
    status:          'queued',
    message:         'FreshPoint Order Confirmation body saved — ready to process in app',
    document_id:     doc.id,
    vendor:          'FreshPoint Dallas',
    document_number: orderNumber,
  });
}
