// BOH OS v2 — Authentication service
// Routes PIN login through the brigade-login Edge Function (service-role gateway).
// Direct supabase.rpc('brigade_login') is not available to the anon key — permission denied.
// The Edge Function is the only authorized path.
//
// Session restore: brigade_validate_session RPC is anon-callable and used on page load.
// Token stored in sessionStorage under 'brigade_token' (same key as Brigade PWA).
// If the same device already has a valid Brigade session it is reused transparently.
//
// No PIN in logs. No raw errors to the UI. No writes to the DB from this module.

import { supabase } from '../core/supabase-client.js';

const SUPABASE_URL  = 'https://ydqmumpytgrlceuinoqt.supabase.co';
const LOGIN_EF_URL  = SUPABASE_URL + '/functions/v1/brigade-login';

// ── Install ID ────────────────────────────────────────────────────────
// Matches the Brigade PWA install ID so both apps share rate-limit bucket.

function getInstallId() {
  try {
    let id = localStorage.getItem('brigade_install_id');
    if (!id) {
      id = crypto.randomUUID
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
          });
      localStorage.setItem('brigade_install_id', id);
    }
    return id;
  } catch {
    return undefined;
  }
}

// ── Token helpers ─────────────────────────────────────────────────────

function saveToken(token) {
  try { sessionStorage.setItem('brigade_token', token); } catch { /* private browsing */ }
}

export function getStoredToken() {
  try { return sessionStorage.getItem('brigade_token') ?? null; } catch { return null; }
}

// ── Map DB user object → BOH v2 user shape ───────────────────────────

function mapUser(u) {
  return {
    id:             u.id,
    name:           u.name,
    role:           u.role            ?? 'staff',
    language:       u.lang            ?? 'en',
    defaultStation: u.default_station ?? null,
  };
}

// ── Session restore ───────────────────────────────────────────────────
// Called on page load. Uses brigade_validate_session (anon-callable).
// Returns the same shape as authenticateWithPin on success.

export async function restoreSession() {
  const token = getStoredToken();
  if (!token) return { ok: false, reason: 'NO_STORED_TOKEN' };

  try {
    const { data, error } = await supabase.rpc('brigade_validate_session', {
      p_token: token,
    });

    if (error || !data || !data.ok) {
      try { sessionStorage.removeItem('brigade_token'); } catch { /* ignore */ }
      return { ok: false, reason: 'SESSION_EXPIRED' };
    }

    return { ok: true, user: mapUser(data.user) };
  } catch {
    return { ok: false, reason: 'CONNECTION_ERROR' };
  }
}

// ── PIN login via Edge Function ───────────────────────────────────────
// The anon key cannot call brigade_login directly (no EXECUTE grant).
// The Edge Function uses the service role key and is the authorized gateway.

export async function authenticateWithPin(pin) {
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
    return { ok: false, reason: 'INVALID_PIN' };
  }

  let raw, data;
  try {
    raw = await fetch(LOGIN_EF_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        pin,
        install_id: getInstallId(),
      }),
    });
    data = await raw.json();
  } catch {
    return { ok: false, reason: 'CONNECTION_ERROR' };
  }

  if (!raw.ok) {
    return { ok: false, reason: 'CONNECTION_ERROR' };
  }

  if (!data || !data.ok) {
    return { ok: false, reason: 'USER_NOT_FOUND' };
  }

  saveToken(data.token);

  return { ok: true, user: mapUser(data.user) };
}
