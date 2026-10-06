// TS06 — logica del webhook Tripleseat, sul campione vero mandato dal supporto (ticket 562962).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const path = require('path');
const fs = require('fs');

const SAMPLE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'tripleseat-webhook-sample.json'), 'utf8'));
const L = () => import(path.join(__dirname, '..', 'edge-functions', 'tripleseat-webhook', 'logic.js'));
const doc0 = () => JSON.parse(JSON.stringify(SAMPLE.event.documents[0]));

test('1. le righe del Kitchen Sheet/BEO arrivano tutte, col nome giusto e senza prezzi', async () => {
  const { normalizeLines } = await L();
  const lines = normalizeLines(doc0().line_items);
  assert.strictEqual(lines.length, 10);
  const nomi = lines.map((l) => l.name);
  for (const n of ['Pizza Package', 'Sandwiches', 'Pretzels', 'Hot Dogs']) assert.ok(nomi.includes(n), n);
  const hot = lines.find((l) => l.name === 'Hot Dogs');
  assert.strictEqual(hot.quantity, 50);
  assert.strictEqual(hot.details, 'chilli, blt, caviartesting testing');     // long_description delle picklist
  for (const l of lines) for (const k of Object.keys(l)) assert.ok(!/price|total|discount/.test(k), k);
  assert.ok(!lines.find((l) => l.category === 'Labor').kitchen, 'il personale non e\' cucina');
});

test('2. cambiare solo un prezzo NON e\' una nuova versione per la cucina', async () => {
  const { normalizeLines, contentHash } = await L();
  const a = doc0(), b = doc0();
  b.line_items[0].price = '999.0'; b.line_items[0].total_price = '999.0';
  assert.strictEqual(await contentHash(normalizeLines(a.line_items)), await contentHash(normalizeLines(b.line_items)));
});

test('3. il caso vero: aggiungono una Caesar salad -> la cucina lo legge per primo', async () => {
  const { normalizeLines, diffLines, describeDiff, contentHash } = await L();
  const prima = normalizeLines(doc0().line_items);
  const d = doc0();
  d.line_items.push({ id: 499000001, quantity: '40.0', price: '9.0', position: '3', display_name: null,
    description: 'Caesar Salad', long_description: 'romaine, parmigiano, crostini', category: { name: 'Misc' }, section: 'Food' });
  const dopo = normalizeLines(d.line_items);
  assert.notStrictEqual(await contentHash(prima), await contentHash(dopo));
  const diff = diffLines(prima, dopo);
  assert.strictEqual(diff.added.length, 1);
  assert.deepStrictEqual(describeDiff(diff).lines, ['+ Caesar Salad ×40']);
});

test('4. quantita\' cambiata e piatto tolto', async () => {
  const { normalizeLines, diffLines, describeDiff } = await L();
  const prima = normalizeLines(doc0().line_items);
  const d = doc0();
  d.line_items.find((l) => l.description === 'Hot Dogs').quantity = '60.0';
  d.line_items = d.line_items.filter((l) => l.description !== 'Pretzels');
  const msg = describeDiff(diffLines(prima, normalizeLines(d.line_items))).lines;
  assert.deepStrictEqual(msg.sort(), ['− Pretzels ×12', '~ Hot Dogs: quantità 50 → 60'].sort());
});

test('5. se Tripleseat rinumera una riga, e\' la stessa riga (non tolta e aggiunta)', async () => {
  const { normalizeLines, diffLines } = await L();
  const prima = normalizeLines(doc0().line_items);
  const d = doc0();
  d.line_items.find((l) => l.description === 'Sandwiches').id = 777;
  const diff = diffLines(prima, normalizeLines(d.line_items));
  assert.strictEqual(diff.added.length + diff.removed.length + diff.changed.length, 0);
});

test('6. cambia solo una riga di personale: versione nuova, ma nessun messaggio alla cucina', async () => {
  const { normalizeLines, diffLines, describeDiff } = await L();
  const prima = normalizeLines(doc0().line_items);
  const d = doc0();
  d.line_items.find((l) => l.description === 'asdf').quantity = '9.0';
  const r = describeDiff(diffLines(prima, normalizeLines(d.line_items)));
  assert.strictEqual(r.kitchenChanges, 0);
  assert.strictEqual(r.otherChanges, 1);
});

test('7. ospiti e orari dell\'evento', async () => {
  const { kitchenEventFields, diffEventFields } = await L();
  const a = kitchenEventFields(SAMPLE.event);
  const b = kitchenEventFields({ ...SAMPLE.event, guest_count: 45, event_start_iso8601: '2026-09-28T11:00:00-07:00' });
  assert.deepStrictEqual(diffEventFields(a, b).map((c) => c.field).sort(), ['guest_count', 'start']);
  assert.deepStrictEqual(diffEventFields(a, kitchenEventFields(SAMPLE.event)), []);
  // ospiti non indicati in Tripleseat: vuoto, non zero
  assert.strictEqual(a.guest_count, null);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(diffEventFields(a, b).find((c) => c.field === 'guest_count'))), { field: 'guest_count', before: null, after: 45 });
});

test('8. firma HMAC: hex, base64, prefisso sha256=, chiave sbagliata, nessuna chiave, nessun header', async () => {
  const { verifySignature } = await L();
  const body = JSON.stringify(SAMPLE);
  const key = 'chiave-di-prova';
  const hex = crypto.createHmac('sha256', key).update(body).digest('hex');
  const b64 = crypto.createHmac('sha256', key).update(body).digest('base64');
  assert.strictEqual((await verifySignature(body, { 'x-tripleseat-signature': hex }, key)).status, 'valid');
  assert.strictEqual((await verifySignature(body, { 'x-signature': b64 }, key)).encoding, 'base64');
  assert.strictEqual((await verifySignature(body, { 'x-hub-signature-256': 'sha256=' + hex }, key)).status, 'valid');
  assert.strictEqual((await verifySignature(body, { 'x-tripleseat-signature': hex }, 'altra')).status, 'invalid');
  assert.strictEqual((await verifySignature(body + ' ', { 'x-tripleseat-signature': hex }, key)).status, 'invalid', 'corpo alterato');
  assert.strictEqual((await verifySignature(body, { 'x-tripleseat-signature': hex }, '')).status, 'no_key');
  assert.strictEqual((await verifySignature(body, { 'content-type': 'application/json' }, key)).status, 'no_signature');
});
