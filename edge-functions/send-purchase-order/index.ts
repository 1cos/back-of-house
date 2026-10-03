// send-purchase-order v2 — Brigade Edge Function (XCF-ORDINI 02/10, XCF-CW 03/10/2026)
//
// v2: un invio REALE verso un canale portale Chef's Warehouse
// (po_vendor_channels.transport = 'cw_portal') non trasmette da qui: resta
// in coda ('pending') e lo esegue il worker del Mac Mini (workers/cw-order-sender),
// che chiude l'esito con po_worker_finish. Risposta 202 { queued: true }.
//
// Invio di un ordine fornitore CONFERMATO da Max. In questa versione NON
// trasmette nulla: non esiste alcun trasporto (email/portale) nel codice.
// Ogni chiamata produce una SIMULAZIONE registrata (po_send_attempts) con
// il testo che sarebbe partito.
//
// Cancelli per un invio reale (tutti e quattro, e oggi comunque bloccato):
//   1. env PO_REAL_SEND_ENABLED === 'true'           (default: assente)
//   2. po_settings.real_send_enabled = true          (default: false)
//   3. po_vendor_channels: real_send_allowed e (channel='email' + email_to | channel='portal' + transport='cw_portal')
//   4. un trasporto implementato: cw_portal -> coda per il worker; email -> REAL_TRANSPORT_NOT_IMPLEMENTED
//
// Tutte le regole (sessione, solo admin, hash della conferma, idempotenza,
// doppioni, do_not_order, data consegna) sono nella RPC po_send_begin,
// eseguibile solo da service_role. Nessun invio automatico da testo/richiesta.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const REAL_SEND_ENV = Deno.env.get('PO_REAL_SEND_ENABLED') === 'true';
const VERSION = 'send-purchase-order/2';

function cors(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '*';
  const reply = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify({ version: VERSION, ...body }), { status, headers: cors(origin) });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== 'POST') return reply(405, { ok: false, reason: 'METHOD_NOT_ALLOWED' });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(400, { ok: false, reason: 'INVALID_JSON' }); }

  const token = body.brigade_token;
  const orderId = body.order_id;
  const idem = body.idempotency_key;
  const hash = body.summary_hash;
  const ack = body.ack_duplicates === true;
  const requestedMode = body.mode === 'real' ? 'real' : 'simulate';

  if (typeof token !== 'string' || token.length !== 64) return reply(401, { ok: false, reason: 'AUTH_ERROR', detail: 'missing_or_invalid_token' });
  if (typeof orderId !== 'string' || !UUID_RE.test(orderId)) return reply(400, { ok: false, reason: 'INVALID_INPUT', detail: 'order_id' });
  if (typeof idem !== 'string' || idem.length < 8 || idem.length > 200) return reply(400, { ok: false, reason: 'INVALID_INPUT', detail: 'idempotency_key' });
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) return reply(400, { ok: false, reason: 'INVALID_INPUT', detail: 'summary_hash' });

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Il reale viene CHIESTO al DB solo se anche l'env lo consente.
  const realRequested = requestedMode === 'real' && REAL_SEND_ENV;
  const { data: begin, error: beginErr } = await svc.rpc('po_send_begin', {
    p_token: token, p_order_id: orderId, p_idempotency_key: idem, p_summary_hash: hash,
    p_ack_duplicates: ack, p_real_requested: realRequested,
  });
  if (beginErr) {
    console.error(`[${VERSION}] po_send_begin error: ${beginErr.message}`);
    return reply(500, { ok: false, reason: 'RPC_ERROR' });
  }
  if (!begin?.ok) {
    const status = begin?.reason === 'AUTH_ERROR' ? 401 : begin?.reason === 'FORBIDDEN' ? 403 : 409;
    return reply(status, begin ?? { ok: false, reason: 'UNKNOWN' });
  }
  if (begin.idempotent) {
    console.log(`[${VERSION}] idempotent replay order=${orderId} state=${begin.state}`);
    return reply(200, { ...begin, transmitted: begin.state === 'sent' });
  }

  const attemptId = begin.attempt_id as string;
  const realEnv = { env: REAL_SEND_ENV, db: begin.real_allowed_by_db === true };

  if (begin.mode === 'real' && begin.payload?.transport === 'cw_portal') {
    // Resta 'pending': lo prende il worker CW. Nessuna trasmissione da qui.
    console.log(`[${VERSION}] QUEUED cw_portal order=${orderId} attempt=${attemptId}`);
    return reply(202, { ok: true, queued: true, transmitted: false, attempt_id: attemptId, transport: 'cw_portal' });
  }
  if (begin.mode === 'real') {
    // Email: nessun trasporto in questa versione: si chiude come fallito, nulla trasmesso.
    const res = { transmitted: false, error: 'REAL_TRANSPORT_NOT_IMPLEMENTED', gates: realEnv, at: new Date().toISOString() };
    await svc.rpc('po_send_finish', { p_attempt_id: attemptId, p_outcome: 'failed', p_result: res });
    return reply(501, { ok: false, reason: 'REAL_TRANSPORT_NOT_IMPLEMENTED', attempt_id: attemptId, transmitted: false });
  }

  const result = {
    simulated: true, transmitted: false, requested_mode: requestedMode, gates: realEnv,
    would_send: { channel: begin.payload?.channel, to: begin.payload?.to ?? null, subject: begin.payload?.subject },
    at: new Date().toISOString(),
  };
  const { data: fin, error: finErr } = await svc.rpc('po_send_finish', { p_attempt_id: attemptId, p_outcome: 'simulated', p_result: result });
  if (finErr || !fin?.ok) {
    console.error(`[${VERSION}] po_send_finish error: ${finErr?.message ?? JSON.stringify(fin)}`);
    return reply(500, { ok: false, reason: 'RPC_ERROR', attempt_id: attemptId });
  }
  console.log(`[${VERSION}] SIMULATED order=${orderId} attempt=${attemptId} test=${begin.is_test} order_status=${fin.order_status}`);
  return reply(200, {
    ok: true, simulated: true, transmitted: false, attempt_id: attemptId, is_test: begin.is_test,
    order_status: fin.order_status, payload: begin.payload,
  });
});
