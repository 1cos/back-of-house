// TS06 — logica pura del webhook Tripleseat (nessun accesso a rete o database).
// Usata da index.ts (Deno) e dai test (node). Niente prezzi: alla cucina servono
// piatti, quantita' e descrizioni; i dati economici non entrano nelle versioni.

// Categorie che non sono cucina: restano nelle versioni, ma non nel messaggio.
const NON_KITCHEN = /labor|labour|room|rental|staff|fee|service charge|deposit|tax|gratuity|admin/i;

const str = (v) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
const num = (v) => { if (v == null || v === '' || v === 'None') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

// Una riga del documento come la vede la cucina.
//   Riga di menu/pacchetto: display_name = il nome, description = il testo.
//   Riga di picklist/freehand: display_name vuoto, description = il nome, long_description = i dettagli.
export function normalizeLine(li) {
  const display = str(li.display_name);
  const name = display || str(li.description);
  const details = display ? str(li.description) : str(li.long_description);
  const category = li.category && typeof li.category === 'object' ? str(li.category.name) : str(li.category);
  return {
    id: li.id != null ? String(li.id) : null,
    section: str(li.section),
    category,
    name,
    details,
    quantity: num(li.quantity),
    position: num(li.position),
    menu_item_id: li.menu_item_id != null ? String(li.menu_item_id) : null,
    kitchen: !NON_KITCHEN.test(category),
  };
}

export function normalizeLines(lineItems) {
  return (lineItems || []).map(normalizeLine)
    .sort((a, b) => (a.section > b.section ? 1 : a.section < b.section ? -1 : 0)
      || (a.position ?? 0) - (b.position ?? 0) || String(a.id).localeCompare(String(b.id)));
}

// Impronta stabile del contenuto: cambia solo se cambia qualcosa che la cucina vede.
export async function contentHash(lines) {
  const canon = JSON.stringify(lines.map((l) => [l.id, l.section, l.category, l.name, l.details, l.quantity]));
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canon));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Differenza fra due versioni: per id della riga; se Tripleseat rinumera, si riconosce per nome+sezione.
export function diffLines(before, after) {
  const out = { added: [], removed: [], changed: [] };
  const b = new Map(before.map((l) => [l.id, l]));
  const a = new Map(after.map((l) => [l.id, l]));
  const added = after.filter((l) => !b.has(l.id));
  const removed = before.filter((l) => !a.has(l.id));
  const key = (l) => `${l.section}\u0000${l.name.toLowerCase()}`;
  const remByKey = new Map();
  removed.forEach((l) => { const k = key(l); if (!remByKey.has(k)) remByKey.set(k, []); remByKey.get(k).push(l); });
  const pairs = [];
  for (const l of added) {
    const cand = remByKey.get(key(l));
    if (cand && cand.length) pairs.push([cand.shift(), l]); else out.added.push(l);
  }
  for (const list of remByKey.values()) out.removed.push(...list);
  for (const l of after) if (b.has(l.id)) pairs.push([b.get(l.id), l]);
  for (const [x, y] of pairs) {
    const fields = ['name', 'details', 'quantity', 'section', 'category'].filter((f) => x[f] !== y[f]);
    if (fields.length) out.changed.push({ id: y.id, name: y.name, kitchen: y.kitchen || x.kitchen, fields,
      before: Object.fromEntries(fields.map((f) => [f, x[f]])), after: Object.fromEntries(fields.map((f) => [f, y[f]])) });
  }
  return out;
}

export const isEmptyDiff = (d) => !d.added.length && !d.removed.length && !d.changed.length;

const q = (n) => (n == null ? '' : ` ×${Number.isInteger(n) ? n : n.toFixed(2).replace(/\.?0+$/, '')}`);

// Il messaggio per la cucina: solo righe di cucina, prima le aggiunte.
export function describeDiff(d) {
  const lines = [];
  d.added.filter((l) => l.kitchen).forEach((l) => lines.push(`+ ${l.name}${q(l.quantity)}`));
  d.removed.filter((l) => l.kitchen).forEach((l) => lines.push(`− ${l.name}${q(l.quantity)}`));
  d.changed.filter((c) => c.kitchen).forEach((c) => {
    const parts = [];
    if (c.fields.includes('quantity')) parts.push(`quantità ${c.before.quantity ?? '—'} → ${c.after.quantity ?? '—'}`);
    if (c.fields.includes('name')) parts.push(`era «${c.before.name}»`);
    if (c.fields.includes('details')) parts.push('dettagli cambiati');
    if (c.fields.includes('section') || c.fields.includes('category')) parts.push('spostato di sezione');
    lines.push(`~ ${c.name}: ${parts.join(', ')}`);
  });
  const other = d.added.filter((l) => !l.kitchen).length + d.removed.filter((l) => !l.kitchen).length
    + d.changed.filter((c) => !c.kitchen).length;
  return { lines, kitchenChanges: lines.length, otherChanges: other };
}

// Campi dell'evento che contano per la cucina.
export function kitchenEventFields(ev) {
  return {
    name: str(ev.name),
    status: str(ev.status),
    start: str(ev.event_start_iso8601 || ev.event_start),
    end: str(ev.event_end_iso8601 || ev.event_end),
    guest_count: num(ev.guest_count),
    guaranteed_guest_count: num(ev.guaranteed_guest_count),
    event_style: str(ev.event_style),
    rooms: (ev.rooms || []).map((r) => str(r && r.name)).filter(Boolean).sort().join(', '),
  };
}

export function diffEventFields(before, after) {
  return Object.keys(after).filter((k) => k !== 'name' && before[k] !== after[k])
    .map((k) => ({ field: k, before: before[k], after: after[k] }));
}

// ── firma HMAC ─────────────────────────────────────────────────────────────
// La documentazione Tripleseat dice "HMAC signature in the request headers" senza nominare
// l'header ne' il formato. Si prova ogni header che contiene "signature" o "hmac", con
// SHA-256 e SHA-1, in esadecimale o base64, con o senza prefisso "sha256=".
async function hmac(alg, key, body) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: alg }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(body)));
}
const toHex = (u) => Array.from(u).map((b) => b.toString(16).padStart(2, '0')).join('');
const toB64 = (u) => btoa(String.fromCharCode(...u));
function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// headers: oggetto { nome_minuscolo: valore }. Ritorna { status, header, alg, encoding }.
//   valid | invalid | no_signature | no_key
export async function verifySignature(rawBody, headers, signingKey) {
  const names = Object.keys(headers).filter((h) => /signature|hmac/i.test(h));
  if (!signingKey) return { status: 'no_key', header: names[0] || null };
  if (!names.length) return { status: 'no_signature', header: null };
  for (const alg of ['SHA-256', 'SHA-1']) {
    const mac = await hmac(alg, signingKey, rawBody);
    const cands = [toHex(mac), toB64(mac)];
    for (const h of names) {
      for (const part of String(headers[h]).split(/[,\s]+/)) {
        const v = part.replace(/^(sha256|sha1|v1|t=\d+;?)=/i, '').trim();
        if (!v) continue;
        const vHex = /^[0-9a-f]+$/i.test(v) ? v.toLowerCase() : null;
        if (vHex && safeEq(vHex, cands[0])) return { status: 'valid', header: h, alg, encoding: 'hex' };
        if (safeEq(v, cands[1])) return { status: 'valid', header: h, alg, encoding: 'base64' };
      }
    }
  }
  return { status: 'invalid', header: names[0] };
}
