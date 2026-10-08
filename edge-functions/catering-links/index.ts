// CAT03 — catering-links: collegamenti piatto Tripleseat → ricette + quantità, salvati da Chef dalla V020.
// Ogni chiamata richiede una sessione Brigade valida (brigade_validate_session). Scrivere e vedere i costi:
// solo admin/chef/manager, come heb-receipt. Le scritture passano dalle funzioni SQL catering_* (solo service_role),
// che non toccano ricette, distinte, eventi o Tripleseat.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNITS = new Set(['portions', 'pieces', 'kg', 'trays']);

export function cleanComponents(raw: unknown): { ok: true; list: any[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || !raw.length || raw.length > 12) return { ok: false, error: 'components_required' };
  const list = [];
  for (const c of raw) {
    const q = Number(c?.qty);
    if (!UUID.test(String(c?.recipe_id || ''))) return { ok: false, error: 'recipe_required' };
    if (!UNITS.has(String(c?.unit))) return { ok: false, error: 'unit_not_allowed' };
    if (!(q > 0) || q > 100000) return { ok: false, error: 'qty_missing' };
    const b = c?.basis && typeof c.basis === 'object' ? c.basis : null;
    list.push({ recipe_id: c.recipe_id, unit: c.unit, qty: q,
      basis: b ? { source: String(b.source || '').slice(0, 300), rule: String(b.rule || '').slice(0, 500), status: String(b.status || '').slice(0, 40),
        guests: Number(b.guests) > 0 && Number(b.guests) < 100000 ? Number(b.guests) : null } : null });
  }
  return { ok: true, list };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let body: any;
  try { body = await req.json(); } catch (_) { return json({ ok: false, error: 'bad_json' }, 400); }

  const { data: sess } = await sb.rpc('brigade_validate_session', { p_token: body.brigade_token || '' });
  if (!sess?.ok) return json({ ok: false, error: 'session' }, 401);
  const user = sess.user || {};
  const role = String(user.role || '').toLowerCase();
  const canEdit = user.is_admin === true || ['admin', 'chef', 'manager'].includes(role);

  if (body.action === 'me') return json({ ok: true, user: { name: user.name, role: user.role, is_admin: user.is_admin === true }, can_edit: canEdit });
  if (!canEdit) return json({ ok: false, error: 'not_allowed' }, 403);

  const eventId = String(body.event_id || '');
  if (!UUID.test(eventId)) return json({ ok: false, error: 'event_required' }, 400);

  if (body.action === 'plan') {
    const { data, error } = await sb.rpc('catering_event_plan', { p_event_id: eventId });
    if (error) return json({ ok: false, error: 'plan_failed', detail: error.message }, 500);
    return json(data);
  }

  const lineKey = String(body.line_key || '').slice(0, 400);
  if (!lineKey) return json({ ok: false, error: 'line_required' }, 400);

  if (body.action === 'remove') {
    const { data, error } = await sb.rpc('catering_remove_link', { p_user: user.name, p_event_id: eventId, p_line_key: lineKey });
    if (error) return json({ ok: false, error: 'remove_failed', detail: error.message }, 500);
    return json(data);
  }

  if (body.action === 'save') {
    const c = cleanComponents(body.components);
    if (!c.ok) return json({ ok: false, error: c.error }, 400);
    const { data: ev } = await sb.from('events').select('id,guest_count,tripleseat_id').eq('id', eventId).maybeSingle();
    if (!ev) return json({ ok: false, error: 'event_not_found' }, 404);
    const { data, error } = await sb.rpc('catering_save_link', {
      p_user: user.name, p_event_id: eventId, p_ts_event_id: ev.tripleseat_id ? String(ev.tripleseat_id) : null,
      p_line_key: lineKey, p_original_text: String(body.original_text || '').slice(0, 500), p_section: body.section ? String(body.section).slice(0, 80) : null,
      p_components: c.list, p_note: body.note ? String(body.note).slice(0, 300) : null,
      p_remember: body.remember === true, p_guests: ev.guest_count ?? null,
    });
    if (error) return json({ ok: false, error: 'save_failed', detail: error.message }, 500);
    return json(data, data?.ok ? 200 : 422);
  }
  return json({ ok: false, error: 'action' }, 400);
});
