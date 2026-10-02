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
    const body = await req.json();
    const { pdf_base64, filename, subject, from } = body;
    if (!pdf_base64) return jsonError('Missing pdf_base64', 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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

    // Create vendor_document record — status pdf_received, no parsing yet
    const { data: doc, error: insertErr } = await supabase
      .from('vendor_documents')
      .insert({
        vendor:          "Hardie's Fresh Foods / Dairyland Produce",
        document_type:   'invoice',
        status:          'pdf_received',
        uploaded_by:     'gmail-auto',
        source_email_subject: subject || null,
        source_email_from:    from    || null,
        raw_text:        storagePath,
        parsed_json:     { storage_path: storagePath, original_filename: safeFilename },
        warnings:        [],
      })
      .select('id')
      .single();

    if (insertErr) return jsonError(`DB insert error: ${insertErr.message}`, 500);

    return jsonResponse({
      status:       'queued',
      message:      'PDF saved — ready to process in app',
      document_id:  doc.id,
      storage_path: storagePath,
    });

  } catch (err: any) {
    console.error('gmail-hardies-import error:', err);
    return jsonError(String(err), 500);
  }
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
function jsonError(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}
