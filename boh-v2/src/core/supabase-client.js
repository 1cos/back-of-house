// BOH OS v2 — Supabase client
// One client instance, exported as a named export.
// No window writes. No auth. No UI. No side effects on import.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = 'https://ydqmumpytgrlceuinoqt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlkcW11bXB5dGdybGNldWlub3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MzcyOTUsImV4cCI6MjA5NDUxMzI5NX0.MSIKL4nCOxK8YFFTkt9AbFGViiwl-KEhHy6cL25gnKc';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

/**
 * Performs a minimal read-only probe against the `settings` table.
 * Returns a normalized result — never throws to the caller,
 * never logs credentials or row data.
 *
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function checkSupabaseConnection() {
  try {
    const { error } = await supabase
      .from('settings')
      .select('key')
      .limit(1);

    if (error) {
      return { ok: false, error: 'Connection check failed' };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: 'Connection unreachable' };
  }
}
