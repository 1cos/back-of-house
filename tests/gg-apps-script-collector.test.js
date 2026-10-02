// XCF-GG — collector Apps Script Global Gourmet, eseguito con GmailApp finto.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto'), assert = require('assert');
const SRC = fs.readFileSync(path.join(__dirname, '../apps-script/gmail-vendor-import/GlobalGourmetImport.gs.js'), 'utf8');

function run(threads, edge) {
  const sent = [], labels = [];
  const ctx = {
    Logger: { log() {} },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (_a, bytes) => Array.from(crypto.createHash('sha256').update(Buffer.from(bytes)).digest()).map(b => b > 127 ? b - 256 : b),
      base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
    },
    GmailApp: {
      search: (q) => { ctx.lastQuery = q; return threads; },
      getUserLabelByName: () => ({ name: 'gg-processed' }),
      createLabel: () => ({ name: 'gg-processed' }),
    },
    sendToEdge: (slug, p) => { sent.push({ slug, p }); return edge(p); },
  };
  vm.createContext(ctx); vm.runInContext(SRC, ctx);
  threads.forEach(t => { t.addLabel = () => labels.push(t.id); });
  const stats = ctx.checkGlobalGourmetEmails();
  return { stats, sent, labels, query: ctx.lastQuery };
}
const att = (name, s) => ({ getName: () => name, getBytes: () => Array.from(Buffer.from(s)) });
const msg = (from, subject, atts) => ({ getFrom: () => from, getSubject: () => subject, getAttachments: () => atts });
const thread = (id, msgs) => ({ id, getMessages: () => msgs });

// 1. thread AR reale: Mauro (selectedfoods) + noi + Mauricio con il PDF.
let r = run([thread('t1', [
  msg('Mauro Ceotto <mceotto@selectedfoods.com>', 'AR ZENO / OPEN BALANCE SELECTYED', [att('AR statement.pdf', 'stmt')]),
  msg('massimiliano.zubboli@gmail.com', 'Re: AR ZENO / OPEN BALANCE SELECTYED', []),
  msg('Mauricio Martinez <mmartinez@ggourmetfoods.com>', 'Re: AR ZENO / OPEN BALANCE SELECTYED', [att('Scanned Document 72.pdf', 'scan72'), att('logo.png', 'png')]),
])], () => ({ status: 'queued' }));
assert.strictEqual(r.sent.length, 1, 'solo il PDF di Global Gourmet');
assert.strictEqual(r.sent[0].slug, 'gmail-vendor-import');
const h = crypto.createHash('sha256').update('scan72').digest('hex').slice(0, 12);
assert.strictEqual(r.sent[0].p.subject, 'Re: AR ZENO / OPEN BALANCE SELECTYED [GG ' + h + ']');
assert.strictEqual(r.sent[0].p.filename, 'Scanned Document 72.pdf');
assert.deepStrictEqual(r.labels, ['t1']);
assert.ok(/from:ggourmetfoods\.com/.test(r.query) && /after:2026\/10\/01/.test(r.query) && /-label:gg-processed/.test(r.query));

// 2. stesso subject, PDF diversi -> subject diversi (niente falso duplicate).
r = run([thread('t2', [
  msg('mmartinez@ggourmetfoods.com', 'Re: AR', [att('a.pdf', 'A')]),
  msg('mmartinez@ggourmetfoods.com', 'Re: AR', [att('b.pdf', 'B')]),
])], () => ({ status: 'queued' }));
assert.notStrictEqual(r.sent[0].p.subject, r.sent[1].p.subject);

// 3. fail-closed: un errore e il thread NON viene etichettato.
r = run([thread('t3', [msg('mmartinez@ggourmetfoods.com', 'Re: AR', [att('a.pdf', 'A'), att('b.pdf', 'B')])])],
  (p) => p.filename === 'b.pdf' ? { error: 'boom' } : { status: 'queued' });
assert.deepStrictEqual(r.labels, []);
assert.strictEqual(r.stats.threads_retained_for_retry, 1);

// 4. duplicate conta come successo.
r = run([thread('t4', [msg('mmartinez@ggourmetfoods.com', 'x', [att('a.pdf', 'A')])])], () => ({ status: 'duplicate' }));
assert.deepStrictEqual(r.labels, ['t4']);
console.log('gg-apps-script-collector: OK');
