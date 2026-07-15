// BOH OS v2 — Authentication service
// Validates a 4-digit PIN via the brigade_login server RPC.
// PIN column is bcrypt-hashed server-side; direct .eq('pin') queries no longer work.
// No writes. No PIN in logs. No raw errors to the UI.

import { supabase } from '../core/supabase-client.js';

/**
 * Authenticates a user by PIN.
 *
 * @param {string} pin - 4-digit numeric string
 * @returns {Promise<
 *   { ok: true,  user: { id, name, role, language, defaultStation } } |
 *   { ok: false, reason: 'INVALID_PIN' | 'USER_NOT_FOUND' | 'CONNECTION_ERROR' }
 * >}
 */
export async function authenticateWithPin(pin) {
  // Validate format before touching the network.
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
    return { ok: false, reason: 'INVALID_PIN' };
  }

  try {
    const { data, error } = await supabase.rpc('brigade_login', {
      p_pin:        pin,
      p_user_agent: navigator.userAgent ?? '',
    });

    if (error) {
      return { ok: false, reason: 'CONNECTION_ERROR' };
    }

    if (!data || !data.ok) {
      return { ok: false, reason: 'USER_NOT_FOUND' };
    }

    const u = data.user;

    return {
      ok: true,
      user: {
        id:             u.id,
        name:           u.name,
        role:           u.role            ?? 'staff',
        language:       u.lang            ?? 'en',
        defaultStation: u.default_station ?? null,
      },
    };
  } catch {
    return { ok: false, reason: 'CONNECTION_ERROR' };
  }
}
