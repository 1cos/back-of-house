'use strict';
// B-54 F5: la push porta il codice interno solo se il file esiste; le RPC della coda restano identiche.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { client } = require('../src/brigade.js');
const cfg0 = { supabaseUrl: 'https://x.supabase.co', supabaseKey: 'ANON' };
function rec() { const calls = []; return { calls, f: async (u, o) => { calls.push({ u, h: o.headers }); return { ok: true, json: async () => ({}) }; } }; }
test('push con file del codice: aggiunge x-brigade-internal', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'k')); fs.writeFileSync(d + '/k', 'K'.repeat(64));
  const r = rec(); await client({ ...cfg0, internalKeyFile: d + '/k' }, 'W', r.f).push('t', 'b');
  assert.strictEqual(r.calls[0].h['x-brigade-internal'], 'K'.repeat(64)); assert.strictEqual(r.calls[0].h.Authorization, 'Bearer ANON');
});
test('push senza file: identica a prima', async () => {
  const r = rec(); await client({ ...cfg0, internalKeyFile: '/non/esiste' }, 'W', r.f).push('t', 'b');
  assert.strictEqual(r.calls[0].h['x-brigade-internal'], undefined);
});
test('RPC della coda: nessun codice interno', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'k')); fs.writeFileSync(d + '/k', 'K'.repeat(64));
  const r = rec(); await client({ ...cfg0, internalKeyFile: d + '/k' }, 'W', r.f).claim('w1');
  assert.ok(r.calls[0].u.endsWith('/rest/v1/rpc/po_worker_claim')); assert.strictEqual(r.calls[0].h['x-brigade-internal'], undefined);
});
