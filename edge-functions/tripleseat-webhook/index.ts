// tripleseat-webhook — TS06: riceve i webhook ufficiali di Tripleseat e tiene le versioni dei documenti.
//
//   POST (da Tripleseat)  corpo JSON firmato HMAC con la signing key dell'endpoint.
//   GET                   risposta di salute, nessun dato.
//
// Mai: scrivere su Tripleseat, leggere i link dei documenti (portal), salvare prezzi nelle versioni.
// Segreti: TS_WEBHOOK_SIGNING_KEY (incollata da Max dal pannello Tripleseat), TS_SITE_ID (15530).
// verify_jwt = false: Tripleseat non manda JWT Supabase; l'autenticita' e' la firma HMAC.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  normalizeLines, contentHash, diffLines, isEmptyDiff, describeDiff,
  kitchenEventFields, diffEventFields, verifySignature,
} from './logic.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SIGNING_KEY = (Deno.env.get('TS_WEBHOOK_SIGNING_KEY') || '').trim();
const SITE_ID = Number(Deno.env.get('TS_SITE_ID') || 15530);
const MAX_BYTES = 3_000_000;

const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });

async function sha256(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

const giorno = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso || '';
  return d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'America/Chicago' });
};

async function process(sb: any, deliveryId: number, payload: any, isTest: boolean) {
  const ev = payload.event || {};
  const evId = Number(ev.id);
  const trigger = String(payload.webhook_trigger_type || '');
  const out: any = { documents: [], event_change: null, alerts: [] };
  const kitchenMsg: string[] = [];

  // 1. documenti: una versione per ogni contenuto nuovo
  for (const doc of ev.documents || []) {
    if (!Array.isArray(doc.line_items)) { out.documents.push({ id: doc.id, skipped: 'no line_items (financials off?)' }); continue; }
    if (doc.deleted_at) { out.documents.push({ id: doc.id, skipped: 'deleted' }); continue; }
    const lines = normalizeLines(doc.line_items);
    const hash = await contentHash(lines);
    const { data: last } = await sb.from('event_document_versions')
      .select('id, version_no, content_hash, lines').eq('ts_document_id', doc.id).eq('is_test', isTest)
      .order('version_no', { ascending: false }).limit(1).maybeSingle();
    if (last && last.content_hash === hash) { out.documents.push({ id: doc.id, version: last.version_no, unchanged: true }); continue; }
    const diff = last ? diffLines(last.lines, lines) : null;
    const desc = diff ? describeDiff(diff) : null;
    const { data: ins, error } = await sb.from('event_document_versions').insert({
      ts_event_id: evId, ts_document_id: doc.id, version_no: (last?.version_no || 0) + 1, content_hash: hash,
      lines, line_count: lines.length, document_title: doc.title || null, event_name: ev.name || null,
      event_start: ev.event_start_iso8601 || null, event_updated_at: ev.updated_at || null, trigger,
      delivery_id: deliveryId, diff, summary: desc ? desc.lines : null, is_test: isTest,
    }).select('id, version_no').single();
    if (error) throw new Error('version insert: ' + error.message);
    out.documents.push({ id: doc.id, version: ins.version_no, lines: lines.length, kitchen_changes: desc?.kitchenChanges ?? null });
    if (desc && desc.kitchenChanges) kitchenMsg.push(...desc.lines);
  }

  // 2. campi dell'evento (ospiti, orari, stato, sale)
  const fields = kitchenEventFields(ev);
  const { data: st } = await sb.from('tripleseat_event_kitchen_state').select('fields')
    .eq('ts_event_id', evId).eq('is_test', isTest).maybeSingle();
  const evDiff = st ? diffEventFields(st.fields, fields) : [];
  await sb.from('tripleseat_event_kitchen_state').upsert({ ts_event_id: evId, is_test: isTest, fields, updated_at: new Date().toISOString() });
  if (evDiff.length) {
    out.event_change = evDiff;
    const nomi: Record<string, string> = { guest_count: 'ospiti', guaranteed_guest_count: 'ospiti garantiti', start: 'inizio',
      end: 'fine', status: 'stato', event_style: 'stile', rooms: 'sale' };
    for (const c of evDiff) kitchenMsg.push(`${nomi[c.field] || c.field}: ${c.before ?? '—'} → ${c.after ?? '—'}`);
  }

  // 3. un solo avviso per consegna, solo se cambia qualcosa per la cucina
  if (kitchenMsg.length) {
    const title = `Tripleseat: cambiato «${fields.name || evId}» (${giorno(fields.start)})`;
    const { data: a, error } = await sb.rpc('tripleseat_change_alert', {
      p_ts_event_id: evId, p_title: title, p_body: kitchenMsg.slice(0, 12).join(' · ') + (kitchenMsg.length > 12 ? ` · e altre ${kitchenMsg.length - 12}` : ''),
      p_event_start: fields.start || null, p_test: isTest });
    if (error) throw new Error('alert: ' + error.message);
    out.alerts.push(a);
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'GET') return json({ ok: true, service: 'tripleseat-webhook', signing_key_set: !!SIGNING_KEY });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const raw = await req.text();
  if (raw.length > MAX_BYTES) return json({ error: 'too large' }, 413);
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  const sig = await verifySignature(raw, headers, SIGNING_KEY);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  let payload: any = null;
  try { payload = JSON.parse(raw); } catch { /* registrato sotto */ }
  const ev = payload?.event || {};
  const siteId = Number(ev.site_id) || null;
  const isTest = !!siteId && siteId !== SITE_ID;

  const { data: del, error: delErr } = await sb.from('tripleseat_webhook_deliveries').insert({
    trigger: payload?.webhook_trigger_type || null, ts_event_id: Number(ev.id) || null, ts_site_id: siteId,
    signature_status: sig.status, signature_header: sig.header, header_names: Object.keys(headers).sort(),
    body_sha256: await sha256(raw), body_bytes: raw.length,
    payload: payload ?? { unparsed: raw.slice(0, 2000) }, is_test: isTest,
    error: payload ? null : 'not_json',
  }).select('id').single();
  if (delErr) return json({ error: 'store failed' }, 500);   // Tripleseat ritentera'

  // Si elabora solo cio' che e' firmato. Senza firma valida: registrato e basta (risposta 200, cosi'
  // Tripleseat non disattiva l'endpoint mentre si mette a punto la chiave).
  // Brigade si controlla da sola (TS06b): primo invio vero firmato -> "attivo";
  // invii veri non firmati o con firma sbagliata -> avviso rosso finche' non si sistema.
  if (payload && !isTest && siteId === SITE_ID) {
    const kind = sig.status === 'valid' ? 'valid' : 'signature';
    const detail = sig.status === 'valid' ? null : `${sig.status}${sig.header ? ', header ' + sig.header : ''}`;
    await sb.rpc('tripleseat_webhook_notice', {
      p_kind: kind, p_event_name: ev.name || null, p_trigger: payload.webhook_trigger_type || null, p_detail: detail });
  }

  if (sig.status !== 'valid' || !payload) {
    return json({ ok: true, processed: false, reason: payload ? sig.status : 'not_json' });
  }
  try {
    const result = await process(sb, del.id, payload, isTest);
    await sb.from('tripleseat_webhook_deliveries').update({ processed_at: new Date().toISOString(), result }).eq('id', del.id);
    return json({ ok: true, processed: true });
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 300);
    await sb.from('tripleseat_webhook_deliveries').update({ processed_at: new Date().toISOString(), error: msg }).eq('id', del.id);
    return json({ ok: true, processed: false, reason: 'processing_error' });
  }
});
