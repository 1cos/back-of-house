// tripleseat-oauth-shadow — TS01: Tripleseat OAuth 2.0, READ-ONLY test into shadow tables.
//
// What it does
//   GET  ?code=…&state=…   OAuth callback. Checks the one-time state, exchanges the code for tokens
//                          server-side (client secret from env), stores them in tripleseat_shadow_tokens.
//   POST {action:'test'}   Header x-shadow-key required. Refreshes the access token if needed, then reads
//                          future events (/v1/events/search) and each event's menu item selections, and
//                          stores the raw JSON in tripleseat_shadow_events / _menu_selections.
//
// What it never does
//   No write to Tripleseat (GET only on /v1/*). No write to Brigade's operational tables (events, recipes,
//   integrations, …). Tokens and secrets never appear in responses or logs: responses carry counts only.
//   The old tripleseat-sync stays switched off (410).

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CLIENT_ID = (Deno.env.get('TS2_CLIENT_ID') || '').trim();
const CLIENT_SECRET = (Deno.env.get('TS2_CLIENT_SECRET') || '').trim();
const SHADOW_KEY = Deno.env.get('TS_SHADOW_KEY') || '';
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/tripleseat-oauth-shadow`;
const API = 'https://api.tripleseat.com';
const STATE_TTL_MS = 20 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
// Supabase serves function responses on *.supabase.co as plain text, so the callback answers in plain text.
const page = (title: string, body: string, status = 200) =>
  new Response(`${title}\n\n${body.replace(/<br>/g, '\n').replace(/<[^>]+>/g, '')}\n`, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// Token endpoint errors: keep only the OAuth error code and description, never echo request fields.
// Client credentials go in the form body (as the migration guide shows); if Tripleseat answers
// invalid_client, the same request is retried with HTTP Basic, the other method OAuth 2.0 allows.
async function tokenRequest(form: Record<string, string>) {
  const first = await tokenRequestOnce(form, false);
  if (!first.ok && /invalid_client/.test(first.error)) {
    const second = await tokenRequestOnce(form, true);
    return second.ok ? second : { ...second, error: `${first.error} | basic: ${second.error}` };
  }
  return first;
}
async function tokenRequestOnce(form: Record<string, string>, basic: boolean) {
  const f = { ...form };
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  if (basic) { delete f.client_secret; headers.Authorization = 'Basic ' + btoa(`${CLIENT_ID}:${CLIENT_SECRET}`); }
  const res = await fetch(`${API}/oauth2/token`, { method: 'POST', headers, body: new URLSearchParams(f) });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* HTML or empty: reported as not_json */ }
  if (!res.ok || !body || !body.access_token) {
    const err = body ? `${body.error || 'error'}: ${typeof body.error_description === 'string' ? body.error_description : JSON.stringify(body.error_description || '')}`
                     : `not_json (HTTP ${res.status}, ${text.slice(0, 60).replace(/\s+/g, ' ')})`;
    return { ok: false as const, status: res.status, error: err.slice(0, 300) };
  }
  return { ok: true as const, body };
}

async function saveTokens(sb: any, t: any, how: string) {
  const created = Number(t.created_at) || Math.floor(Date.now() / 1000);
  const { error } = await sb.from('tripleseat_shadow_tokens').upsert({
    id: 1,
    access_token: t.access_token,
    refresh_token: t.refresh_token || null,
    scope: t.scope || null,
    token_type: t.token_type || 'Bearer',
    expires_at: new Date((created + (Number(t.expires_in) || 7200)) * 1000).toISOString(),
    obtained_at: new Date().toISOString(),
    obtained_by: how,
  });
  if (error) throw new Error('token store failed: ' + error.message);
}

async function accessToken(sb: any): Promise<string> {
  const { data, error } = await sb.from('tripleseat_shadow_tokens').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('not_connected: no token yet, the Authorize step has not been completed');
  if (new Date(data.expires_at).getTime() - Date.now() > 5 * 60 * 1000) return data.access_token;
  if (!data.refresh_token) throw new Error('expired: access token expired and no refresh token');
  const r = await tokenRequest({ grant_type: 'refresh_token', refresh_token: data.refresh_token, client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
  if (!r.ok) throw new Error('refresh failed: ' + r.error);
  await saveTokens(sb, { ...r.body, refresh_token: r.body.refresh_token || data.refresh_token }, 'refresh');
  return r.body.access_token;
}

// The OpenAPI spec says /v1/…, the migration guide shows /api/v1/…: try the spec first, then the guide.
let apiPrefix = '';
async function apiGet(token: string, path: string): Promise<any> {
  const r = await apiGetOnce(token, apiPrefix + path);
  if (!r.ok && r.status === 404 && apiPrefix === '') {
    const r2 = await apiGetOnce(token, '/api' + path);
    if (r2.ok) apiPrefix = '/api';
    return r2;
  }
  return r;
}
async function apiGetOnce(token: string, path: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (res.status === 429) { await sleep(1500 * (attempt + 1)); continue; }
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* reported below */ }
    if (!res.ok || body === null) return { ok: false, status: res.status, error: body ? JSON.stringify(body).slice(0, 200) : `not_json: ${text.slice(0, 60).replace(/\s+/g, ' ')}` };
    return { ok: true, status: res.status, body };
  }
  return { ok: false, status: 429, error: 'rate limited' };
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function runTest(sb: any, opts: { days?: number }) {
  const runId = crypto.randomUUID();
  const started = new Date().toISOString();
  const counts: Record<string, unknown> = {};
  try {
    const token = await accessToken(sb);
    const from = new Date(), to = new Date(Date.now() + (opts.days || 120) * 864e5);
    const events: any[] = [];
    let pages = 1;
    for (let p = 1; p <= pages && p <= 30; p++) {
      const r = await apiGet(token, `/v1/events/search.json?event_start_date=${ymd(from)}&event_end_date=${ymd(to)}&order=event_start&sort_direction=asc&page=${p}`);
      if (!r.ok) throw new Error(`events search page ${p}: HTTP ${r.status} ${r.error}`);
      pages = Number(r.body.total_pages) || 1;
      events.push(...(r.body.results || []));
      await sleep(150);
    }
    counts.events = events.length;
    counts.event_pages = pages;
    counts.by_status = events.reduce((m: any, e: any) => { const s = e.status || 'UNKNOWN'; m[s] = (m[s] || 0) + 1; return m; }, {});
    if (events.length) {
      const { error } = await sb.from('tripleseat_shadow_events').insert(events.map((e: any) => ({
        run_id: runId, ts_event_id: e.id, name: e.name || null, status: e.status || null,
        event_date: e.event_date || (e.event_start ? String(e.event_start).slice(0, 10) : null),
        guest_count: e.guest_count ?? null, payload: e,
      })));
      if (error) throw new Error('store events: ' + error.message);
    }
    let withSel = 0, selTotal = 0, selErrors = 0;
    for (const e of events) {
      const r = await apiGet(token, `/v1/events/${e.id}/menu_item_selections.json`);
      if (!r.ok) { selErrors++; counts.last_selection_error = `HTTP ${r.status} ${r.error}`; await sleep(150); continue; }
      const list = r.body.menu_item_selections || [];
      if (list.length) {
        withSel++; selTotal += list.length;
        const { error } = await sb.from('tripleseat_shadow_menu_selections').insert(list.map((m: any) => ({
          run_id: runId, ts_event_id: e.id, ts_selection_id: m.id ?? null, name: m.display_name || m.internal_name || null,
          quantity: m.quantity ?? null, payload: m,
        })));
        if (error) throw new Error('store selections: ' + error.message);
      }
      await sleep(150);
    }
    Object.assign(counts, { events_with_selections: withSel, selections: selTotal, selection_errors: selErrors });
    await sb.from('tripleseat_shadow_runs').insert({ run_id: runId, started_at: started, finished_at: new Date().toISOString(), ok: true, counts });
    return { ok: true, run_id: runId, counts };
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 400);
    await sb.from('tripleseat_shadow_runs').insert({ run_id: runId, started_at: started, finished_at: new Date().toISOString(), ok: false, counts, error: msg });
    return { ok: false, run_id: runId, counts, error: msg };
  }
}

// TS06c — Riconciliazione dei documenti dall'API ufficiale (GET /v1/events/{id}?show_financial=true
// porta documents[].line_items, con la stessa forma del webhook). Ogni evento futuro viene passato,
// firmato con la stessa signing key, al ricevitore tripleseat-webhook come trigger API_RECONCILE:
// un solo percorso di elaborazione. Prima volta = versione base; dopo, recupera un webhook perso.
// Log in tripleseat_docsync_runs, NON in tripleseat_shadow_runs: quella tabella guida il sync eventi UD02.
async function hmacHex(key: string, body: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(body)));
  return Array.from(mac).map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function documentsSync(sb: any, opts: { days?: number }) {
  const runId = crypto.randomUUID();
  const started = new Date().toISOString();
  const counts: Record<string, unknown> = { kind: 'documents_sync' };
  try {
    const key = (Deno.env.get('TS_WEBHOOK_SIGNING_KEY') || '').trim();
    if (!key) throw new Error('TS_WEBHOOK_SIGNING_KEY missing');
    const token = await accessToken(sb);
    const from = new Date(Date.now() - 864e5), to = new Date(Date.now() + (opts.days || 120) * 864e5);
    const events: any[] = [];
    let pages = 1;
    for (let p = 1; p <= pages && p <= 30; p++) {
      const r = await apiGet(token, `/v1/events/search.json?event_start_date=${ymd(from)}&event_end_date=${ymd(to)}&order=event_start&sort_direction=asc&page=${p}`);
      if (!r.ok) throw new Error(`events search page ${p}: HTTP ${r.status} ${r.error}`);
      pages = Number(r.body.total_pages) || 1;
      events.push(...(r.body.results || []));
      await sleep(150);
    }
    const live = events.filter((e: any) => !e.deleted_at && !/^(LOST|CANCELL?ED)$/i.test(String(e.status || '')));
    let delivered = 0, errors = 0, docs = 0, lines = 0;
    for (const e of live) {
      const r = await apiGet(token, `/v1/events/${e.id}.json?show_financial=true`);
      if (!r.ok) { errors++; counts.last_error = `event ${e.id}: HTTP ${r.status}`; await sleep(200); continue; }
      const ev = r.body.event || r.body;
      for (const d of ev.documents || []) { if (Array.isArray(d.line_items)) { docs++; lines += d.line_items.length; } }
      const raw = JSON.stringify({ webhook_trigger_type: 'API_RECONCILE', message: "Brigade: riconciliazione dall'API ufficiale", event: ev });
      const res = await fetch(`${SUPABASE_URL}/functions/v1/tripleseat-webhook`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-tripleseat-signature': await hmacHex(key, raw) }, body: raw });
      const out: any = await res.json().catch(() => ({}));
      if (res.ok && out.processed) delivered++; else { errors++; counts.last_error = `event ${e.id}: ${res.status} ${out.reason || ''}`; }
      await sleep(200);
    }
    Object.assign(counts, { events_seen: events.length, events_live: live.length, delivered, errors, documents: docs, line_items: lines });
    await sb.from('tripleseat_docsync_runs').insert({ run_id: runId, started_at: started, finished_at: new Date().toISOString(), ok: errors === 0, counts, error: errors ? String(counts.last_error || '') : null });
    return { ok: errors === 0, run_id: runId, counts };
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 400);
    await sb.from('tripleseat_docsync_runs').insert({ run_id: runId, started_at: started, finished_at: new Date().toISOString(), ok: false, counts, error: msg });
    return { ok: false, run_id: runId, counts, error: msg };
  }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── OAuth callback ──
  if (req.method === 'GET' && (url.searchParams.has('code') || url.searchParams.has('error'))) {
    if (url.searchParams.has('error')) {
      return page('Tripleseat did not authorize', esc(url.searchParams.get('error_description') || url.searchParams.get('error')), 400);
    }
    const state = url.searchParams.get('state') || '';
    const { data: st } = await sb.from('tripleseat_shadow_oauth_state').select('state, created_at, used_at').eq('state', state).maybeSingle();
    if (!st || st.used_at || Date.now() - new Date(st.created_at).getTime() > STATE_TTL_MS) {
      return page('Link expired', 'This authorization link is not valid any more. Ask Claude for a new one.', 400);
    }
    await sb.from('tripleseat_shadow_oauth_state').update({ used_at: new Date().toISOString() }).eq('state', state);
    if (!CLIENT_ID || !CLIENT_SECRET) return page('Not configured', 'The client ID or secret is missing on the server.', 500);
    const r = await tokenRequest({ grant_type: 'authorization_code', code: url.searchParams.get('code') || '', client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI });
    if (!r.ok) {
      await sb.from('tripleseat_shadow_runs').insert({ run_id: crypto.randomUUID(), started_at: new Date().toISOString(), finished_at: new Date().toISOString(), ok: false, error: 'exchange: ' + r.error, counts: { http: r.status } });
      return page('Token exchange failed', esc(r.error), 502);
    }
    await saveTokens(sb, r.body, 'authorization_code');
    return page('Tripleseat connected (read-only test)', `Scopes granted: <b>${esc(r.body.scope || 'not listed')}</b>.<br>You can close this tab and tell Claude “fatto”.`);
  }

  // ── read-only test ──
  if (req.method === 'POST') {
    if (!SHADOW_KEY || req.headers.get('x-shadow-key') !== SHADOW_KEY) return json({ error: 'forbidden' }, 403);
    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }
    if (body.action === 'status') {
      const { data } = await sb.from('tripleseat_shadow_tokens').select('scope, expires_at, obtained_at, obtained_by, refresh_token').eq('id', 1).maybeSingle();
      return json({ connected: !!data, scope: data?.scope || null, expires_at: data?.expires_at || null, obtained_at: data?.obtained_at || null,
        obtained_by: data?.obtained_by || null, has_refresh_token: !!data?.refresh_token, client_id_set: !!CLIENT_ID, client_secret_set: !!CLIENT_SECRET, client_secret_length: CLIENT_SECRET.length,
        client_secret_had_whitespace: (Deno.env.get('TS2_CLIENT_SECRET') || '') !== CLIENT_SECRET });
    }
    if (body.action === 'test') return json(await runTest(sb, { days: Number(body.days) || 120 }));
    if (body.action === 'documents_sync') return json(await documentsSync(sb, { days: Number(body.days) || 120 }));
    if (body.action === 'probe_event_financial') {
      // Official read: GET /v1/events/{id}?show_financial=true. Returns the response SHAPE, plus the
      // text of fields whose name says they are line items (menu lines: no contact data).
      const token = await accessToken(sb);
      const r = await apiGet(token, `/v1/events/${Number(body.event_id)}.json?show_financial=true`);
      if (!r.ok) return json({ status: r.status, error: r.error });
      const ev = r.body.event || r.body;
      const keys = Object.keys(ev);
      const plain = await apiGet(token, `/v1/events/${Number(body.event_id)}.json`);
      const plainKeys = plain.ok ? Object.keys(plain.body.event || plain.body) : [];
      const extra = keys.filter((k) => !plainKeys.includes(k));
      const pick = (v: any): any => Array.isArray(v) ? v.slice(0, 60).map(pick)
        : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => /name|description|qty|quantity|price|total|category|type|id$/i.test(k)).map(([k, x]) => [k, pick(x)])) : v;
      const lineish = Object.fromEntries(keys.filter((k) => /line|item|financial|billing|menu|picklist/i.test(k)).map((k) => [k, pick(ev[k])]));
      return json({ status: r.status, extra_keys_with_financial: extra, lineish });
    }
    if (body.action === 'probe_documents') {
      // TS06: forma dei documenti (chiavi, numero di righe, chiavi della prima riga) per un evento,
      // con e senza show_financial, e per tutti i parametri plausibili. Nessun valore, nessun contatto.
      const token = await accessToken(sb);
      const id = Number(body.event_id);
      const out: any = {};
      for (const q of ['', '?show_financial=true', '?show_financial=true&include_line_items=true', '?show_documents=true&show_financial=true']) {
        const r = await apiGet(token, `/v1/events/${id}.json${q}`);
        if (!r.ok) { out[q || 'plain'] = { status: r.status, error: r.error }; continue; }
        const ev = r.body.event || r.body;
        out[q || 'plain'] = { status: r.status, documents: (ev.documents || []).map((d: any) => ({
          id: d.id, keys: Object.keys(d), line_items: Array.isArray(d.line_items) ? d.line_items.length : null,
          line_keys: Array.isArray(d.line_items) && d.line_items[0] ? Object.keys(d.line_items[0]) : null })) };
        await sleep(200);
      }
      return json(out);
    }
    if (body.action === 'probe_selections') {
      // Shape only (keys, array lengths, HTTP status): no values, so no customer data in the answer.
      const token = await accessToken(sb);
      const shape = (v: any): any => Array.isArray(v) ? { array: v.length, first: v.length ? shape(v[0]) : null }
        : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Array.isArray(x) ? `array(${x.length})` : typeof x])) : typeof v;
      const out: any = {};
      for (const id of (body.event_ids || []).slice(0, 5)) {
        const r = await apiGet(token, `/v1/events/${Number(id)}/menu_item_selections.json`);
        out[id] = { status: r.status, ok: r.ok, shape: r.ok ? shape(r.body) : r.error };
        await sleep(150);
      }
      const m = await apiGet(token, `/v1/menus.json`);
      out.menus = { status: m.status, ok: m.ok, shape: m.ok ? shape(m.body) : m.error };
      return json(out);
    }
    return json({ error: 'unknown action' }, 400);
  }

  return json({ error: 'not found' }, 404);
});
