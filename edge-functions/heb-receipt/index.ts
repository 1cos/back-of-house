// ─────────────────────────────────────────────────────────────────────
// HEB01 — heb-receipt: scontrino H-E-B dalla foto.
//
//   action 'parse'  : legge la foto (stesso modello di process-invoice),
//                     normalizza le righe, controlla il totale e prepara
//                     SOLO le domande che mancano. NON scrive niente.
//   action 'import' : salva la foto (bucket privato vendor-receipts) e
//                     chiama public.heb_receipt_import, che scrive tutto
//                     in UNA transazione o niente. Idempotente.
//
// Richiede una sessione Brigade valida (brigade_token); l'import solo a
// un admin/chef. Nessuna chiamata a servizi diversi dal modello di lettura
// gia' usato dall'app (OpenRouter, chiave nei secrets della funzione).
// ─────────────────────────────────────────────────────────────────────
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { VENDOR, normalizeLines, reconcile, buildGroups, derive, receiptNumber, groupKey } from './heb-core.mjs';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const PROMPT = `You read a photo of an H-E-B (Texas grocery store) receipt for a restaurant.
Return ONLY valid JSON, nothing else:
{
  "store_number": "string or null",
  "date": "YYYY-MM-DD or null",
  "time": "HH:MM (24h) or null",
  "items": [
    { "description": "exactly as printed", "amount": number,
      "weight_lb": number or null, "price_per_lb": number or null,
      "quantity": number or null, "confidence": number between 0 and 1 }
  ],
  "subtotal": number or null,
  "tax": number or null,
  "total": number or null,
  "item_count": number or null
}
Rules:
- One entry per printed item line. amount = the price printed at the right of that item line.
- If a line UNDER an item shows a weight such as "2.13 lb @ 21.99 /lb", put weight_lb and price_per_lb on that item. Do NOT create a separate item for it.
- If a line shows a count such as "2 @ 3.99", set quantity on that item.
- Copy descriptions exactly as printed, including abbreviations. Drop the single tax letter at the end (F, T, N, X).
- Never invent or estimate. If a value is not printed or not readable, use null and set confidence below 0.8.
- Ignore payment, card, change, savings-summary and loyalty lines. Discounts or coupons tied to an item: separate items with a negative amount.
- total = the TOTAL printed on the receipt (before payment). item_count = the "items" count if printed.
- The date on H-E-B receipts is printed as MM-DD-YY.`;

async function readReceipt(b64: string, mime: string): Promise<{ data: any; raw: string }> {
  const key = Deno.env.get('OPENROUTER_API_KEY');
  if (!key) throw new Error('reader_not_configured');
  let lastErr = '';
  for (const model of ['google/gemini-2.0-flash-001', 'google/gemini-2.5-flash']) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': 'https://1cos.github.io/back-of-house',
        'X-Title': 'Brigade H-E-B Receipt',
      },
      body: JSON.stringify({
        model, temperature: 0, max_tokens: 3000,
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
          { type: 'text', text: PROMPT },
        ] }],
      }),
    });
    if (!res.ok) { lastErr = `${model}: ${res.status}`; continue; }
    const j = await res.json();
    const raw = j?.choices?.[0]?.message?.content || '';
    const m = String(raw).replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
    if (!m) { lastErr = `${model}: no json`; continue; }
    try { return { data: JSON.parse(m[0]), raw }; } catch (_) { lastErr = `${model}: bad json`; }
  }
  throw new Error('reader_failed ' + lastErr);
}

async function sha256Hex(b64: string): Promise<string> {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const d = await crypto.subtle.digest('SHA-256', bin);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const validDate = (d: unknown) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let body: any;
  try { body = await req.json(); } catch (_) { return json({ ok: false, error: 'bad_json' }, 400); }

  // sessione Brigade
  const { data: sess } = await sb.rpc('brigade_validate_session', { p_token: body.brigade_token || '' });
  if (!sess?.ok) return json({ ok: false, error: 'session' }, 401);
  const user = sess.user || {};

  const b64 = String(body.imageBase64 || '');
  const mime = /^image\/(jpeg|png|webp|heic)$/.test(body.mimeType || '') ? body.mimeType : 'image/jpeg';
  if (!b64 || b64.length > 14_000_000) return json({ ok: false, error: 'photo_missing_or_too_large' }, 400);
  const sha = await sha256Hex(b64);

  // ── PARSE: nessuna scrittura ─────────────────────────────────────────
  if (body.action === 'parse') {
    const { data: prev } = await sb.from('vendor_documents').select('id,document_number,document_date')
      .eq('vendor', VENDOR).eq('document_type', 'receipt').eq('status', 'imported')
      .filter('parsed_json->>photo_sha256', 'eq', sha).limit(1);
    if (prev && prev.length) return json({ ok: true, already_imported: prev[0], photo_sha256: sha });

    let read;
    try { read = await readReceipt(b64, mime); }
    catch (e) { return json({ ok: false, error: 'could_not_read', detail: String((e as Error).message) }, 422); }
    const r = read.data || {};
    const lines = normalizeLines(r.items);
    const receipt = {
      store: r.store_number ? String(r.store_number) : null,
      date: validDate(r.date), time: typeof r.time === 'string' ? r.time : null,
      total: typeof r.total === 'number' ? r.total : null,
      item_count: typeof r.item_count === 'number' ? r.item_count : null,
    };

    const [{ data: aliases }, { data: history }, { data: ingredients }, { data: last }] = await Promise.all([
      sb.from('vendor_item_aliases').select('vendor_description,ingredient_id,notes,active').eq('vendor', VENDOR).eq('active', true),
      sb.from('invoice_lines').select('raw_description,ingredient_id').eq('vendor', VENDOR).not('ingredient_id', 'is', null).limit(500),
      sb.from('ingredients').select('id,name,category').eq('active', true).order('name').limit(2000),
      sb.from('vendor_documents').select('parsed_json').eq('vendor', VENDOR).eq('document_type', 'receipt')
        .eq('status', 'imported').order('document_date', { ascending: false }).limit(5),
    ]);
    const lastByKey: Record<string, unknown> = {};
    for (const d of last || []) for (const g of (d.parsed_json?.groups || [])) if (!lastByKey[g.key]) lastByKey[g.key] = { pieces: g.pieces, weight_lb: g.weight_lb };
    const groups = buildGroups(lines, { aliases: aliases || [], history: history || [], ingredients: ingredients || [], last: lastByKey });

    // peso standard di un pezzo: SOLO come proposta, dalla ricetta che usa l'ingrediente
    // a porzione singola in grammi (es. Filets 226,8 g = 8 oz). Chef lo conferma o lo toglie.
    const ids = groups.map((g: any) => g.ingredient_id).filter(Boolean);
    if (ids.length) {
      const { data: boms } = await sb.from('recipe_bom').select('item_id,quantity,unit,recipes!recipe_bom_parent_recipe_id_fkey(title,base_servings)')
        .in('item_id', ids).eq('unit', 'g');
      for (const g of groups as any[]) {
        if (g.std_g) continue;
        const hit = (boms || []).filter((b: any) => b.item_id === g.ingredient_id && b.recipes?.base_servings === 1);
        if (hit.length === 1) g.std_g_suggested = { grams: Number(hit[0].quantity), recipe: hit[0].recipes.title };
      }
    }
    return json({
      ok: true, photo_sha256: sha, receipt, lines, groups,
      reconciliation: reconcile(lines, receipt.total),
      document_number: receiptNumber(receipt),
      ingredients: (ingredients || []).map((i: any) => ({ id: i.id, name: i.name, category: i.category })),
      raw_text: String(read.raw || '').slice(0, 20000),
    });
  }

  // ── IMPORT: solo dal Confirm ─────────────────────────────────────────
  if (body.action === 'import') {
    const role = String(user.role || '').toLowerCase();
    if (!(user.is_admin === true || ['admin', 'chef', 'manager'].includes(role))) return json({ ok: false, error: 'not_allowed' }, 403);
    const rc = body.receipt || {};
    const lines = normalizeLines(body.lines).map((l: any) => ({ ...l, key: groupKey(l.description) }));
    const rec = reconcile(lines, rc.total);
    if (!rec.ok) return json({ ok: false, error: 'total_mismatch', reconciliation: rec }, 422);
    if (!validDate(rc.date)) return json({ ok: false, error: 'date_missing' }, 422);

    // ogni gruppo deve avere il suo denominatore: lo ricontrollo qui prima di salvare la foto
    const groups = (body.groups || []).map((g: any) => ({
      key: groupKey(g.key), ingredient_id: g.ingredient_id || null, ask: g.ask === 'weight' ? 'weight' : 'pieces',
      pieces: g.pieces ?? null, weight_lb: g.weight_lb ?? null, std_g: g.std_g ?? null,
    }));
    for (const g of groups) {
      const amount = lines.filter((l: any) => l.key === g.key).reduce((s: number, l: any) => s + l.amount, 0);
      const d = derive({ amount, ask: g.ask, printed_weight_lb: null, std_g: g.std_g }, g);
      if (!g.ingredient_id || !d.ok) return json({ ok: false, error: 'answers_missing', key: g.key }, 422);
    }

    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const photoPath = `heb/${sha}.${ext}`;
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const up = await sb.storage.from('vendor-receipts').upload(photoPath, bin, { contentType: mime, upsert: true });
    if (up.error) return json({ ok: false, error: 'photo_not_saved', detail: up.error.message }, 500);

    const payload = {
      photo_sha256: sha, photo_path: photoPath, document_number: receiptNumber(rc),
      receipt_date: rc.date, receipt_time: rc.time || null, store: rc.store || null, total: rc.total,
      by: String(user.name || 'unknown'), raw_text: String(body.raw_text || '').slice(0, 20000),
      lines, groups,
    };
    const { data, error } = await sb.rpc('heb_receipt_import', { p: payload });
    if (error) return json({ ok: false, error: 'import_refused', detail: error.message }, 422);
    return json({ ok: true, result: data });
  }

  return json({ ok: false, error: 'unknown_action' }, 400);
});
