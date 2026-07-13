// BOH OS v2 — Authentication service
// Validates a 4-digit PIN against the existing `users` table.
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
    const { data, error } = await supabase
      .from('users')
      .select('id, name, role, lang, default_station')
      .eq('pin', pin)
      .eq('active', true)
      .maybeSingle();

    if (error) {
      return { ok: false, reason: 'CONNECTION_ERROR' };
    }

    if (!data) {
      return { ok: false, reason: 'USER_NOT_FOUND' };
    }

    return {
      ok: true,
      user: {
        id:             data.id,
        name:           data.name,
        role:           data.role   ?? 'staff',
        language:       data.lang   ?? 'en',
        defaultStation: data.default_station ?? null,
      },
    };
  } catch {
    return { ok: false, reason: 'CONNECTION_ERROR' };
  }
}
