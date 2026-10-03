'use strict';
// XCF-CW — cw-order-sender: invia a Chef's Warehouse gli ordini che Max ha
// CONFERMATO in Brigade (Compila Ordine). Gira sul Mac Mini via launchd.
//
//   node src/index.js            un giro: prende al massimo UN invio in coda e lo esegue
//   node src/index.js --login    Max entra in CW nel profilo del worker (una volta)
//
// Un giro senza lavoro non apre Chrome: chiede solo a Brigade se c'e' un job.
// Esito del processo: 0 ok/nessun job · 2 sessione CW scaduta · 1 errore.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { sendOrder } = require('./cw');
const portal = require('./portal');
const brigade = require('./brigade');

const HOME = process.env.CW_SENDER_HOME || path.join(os.homedir(), 'Library', 'Application Support', 'Brigade', 'cw-order-sender');
const P = {
  config: path.join(HOME, 'config.json'), profile: path.join(HOME, 'profile'), lock: path.join(HOME, 'run.lock'),
  journal: path.join(HOME, 'journal.jsonl'), status: path.join(HOME, 'status.json'), login: path.join(HOME, 'login.json'),
};
const KEYCHAIN_SERVICE = 'brigade-cw-worker';

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const writeJson = (f, v) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 2), { mode: 0o600 }); fs.renameSync(t, f); };
const journal = o => fs.appendFileSync(P.journal, JSON.stringify(Object.assign({ at: new Date().toISOString() }, o)) + '\n', { mode: 0o600 });

// Il token si legge a runtime dal Portachiavi; non viene mai scritto su file o log.
function workerToken() {
  return execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', 'worker', '-w'], { encoding: 'utf8' }).trim();
}

function lock() {
  try {
    const fd = fs.openSync(P.lock, 'wx', 0o600);
    fs.writeSync(fd, String(process.pid)); fs.closeSync(fd);
    return () => { try { fs.unlinkSync(P.lock); } catch (e) {} };
  } catch (e) {
    const age = Date.now() - fs.statSync(P.lock).mtimeMs;
    if (age > 15 * 60 * 1000) { fs.unlinkSync(P.lock); return lock(); }  // lock orfano (crash)
    return null;
  }
}

function messages(outcome, r, vendor) {
  const loginHelp = "Max: sul Mac Mini, Finder > Vai > Vai alla cartella... > ~/Library/Application Support/Brigade/cw-order-sender, doppio clic su cw-login.command ed entra in Chef's Warehouse; poi rimanda l'ordine da Brigade.";
  if (outcome === 'sent') return { title: `Chef's Warehouse: ordine inviato ${r.order_number}`, body: `${vendor}: ordine confermato da CW, numero ${r.order_number}.` };
  if (outcome === 'uncertain') return { title: "Chef's Warehouse: esito NON certo — controlla prima di rifare",
    body: `L'ordine potrebbe essere partito (${r.error}). Controlla lo storico ordini su Chef's Warehouse. Brigade blocca un nuovo invio automatico di questo ordine; se non c'e', registralo come invio manuale o annullalo.` };
  if (r.error === 'CW_SESSION_EXPIRED') return { title: "Chef's Warehouse: serve il login di Max — ordine NON inviato", body: loginHelp };
  const dirty = r.cart_touched ? " Il carrello su Chef's Warehouse puo' contenere le righe aggiunte: va svuotato prima del prossimo invio." : '';
  return { title: `Chef's Warehouse: ordine NON inviato (${r.error})`, body: `Nulla e' stato inviato a CW. Motivo: ${r.error}${r.detail ? ' ' + JSON.stringify(r.detail).slice(0, 200) : ''}.${dirty}` };
}

async function runOnce() {
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  const unlock = lock();
  if (!unlock) return 0;
  try {
    const cfg = readJson(P.config, null);
    const b = brigade.client(cfg, workerToken());
    const workerId = (cfg && cfg.workerId) || os.hostname();
    const c = await b.claim(workerId);
    if (!c || c.ok !== true) { journal({ claim_error: c && c.reason }); writeJson(P.status, { at: new Date().toISOString(), outcome: 'ERROR', error: 'claim: ' + (c && c.reason) }); return 1; }
    writeJson(P.status, { at: new Date().toISOString(), outcome: c.job ? 'WORKING' : 'IDLE' });
    if (!c.job) return 0;

    const job = c.job;
    journal({ claimed: job.attempt_id, order: job.order_id, lines: (job.payload && job.payload.lines || []).length });
    let ctx, out;
    try {
      // --headed: come Entree, i portali rifiutano spesso Chrome headless.
      ctx = await portal.openContext(P.profile, { headless: false });
      const page = await portal.openPage(ctx);
      out = await sendOrder(portal.pageApi(page), job);
    } catch (e) {
      // Errore prima di sendOrder (Chrome non parte, pagina non carica): nulla e' stato inviato.
      out = { outcome: 'failed', result: { transmitted: false, stage: 'open_browser', error: 'BROWSER_ERROR', detail: String(e.message || e).slice(0, 200), at: new Date().toISOString() } };
    } finally { if (ctx) await ctx.close().catch(() => {}); }

    let fin;
    for (let i = 0; i < 3; i++) {       // l'esito DEVE arrivare a Brigade: tre tentativi
      try { fin = await b.finish(job.attempt_id, out.outcome, out.result, out.vendorOrderNumber); if (fin && fin.ok) break; }
      catch (e) { fin = { ok: false, reason: String(e.message || e) }; }
      await new Promise(r => setTimeout(r, 3000));
    }
    const m = messages(out.outcome, out.result, job.vendor);
    const pushed = await b.push(m.title, m.body);
    journal({ attempt: job.attempt_id, outcome: out.outcome, stage: out.result.stage, error: out.result.error || null,
              order_number: out.result.order_number || null, finish_ok: !!(fin && fin.ok), push: pushed });
    writeJson(P.status, { at: new Date().toISOString(), outcome: out.outcome.toUpperCase(), attempt: job.attempt_id,
                          error: out.result.error || null, finish_ok: !!(fin && fin.ok) });
    return out.result.error === 'CW_SESSION_EXPIRED' ? 2 : 0;
  } finally { unlock(); }
}

// Login: si apre Chrome con il profilo del worker; Max entra in CW. Il worker
// controlla ogni 3 s se il carrello e' leggibile, poi chiude da solo.
async function runLogin() {
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  const ctx = await portal.openContext(P.profile, { headless: false });
  try {
    const page = await portal.openPage(ctx);
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      const s = await portal.sessionCheck(page);
      if (s.ok) { writeJson(P.login, { at: new Date().toISOString(), verified: true, reason: s.reason }); console.log('Accesso a Chef\'s Warehouse verificato. Puoi chiudere questa finestra.'); return 0; }
      await new Promise(r => setTimeout(r, 3000));
    }
    writeJson(P.login, { at: new Date().toISOString(), verified: false, reason: 'tempo scaduto' });
    return 2;
  } finally { await ctx.close().catch(() => {}); }
}

if (require.main === module) {
  const run = process.argv.includes('--login') ? runLogin : runOnce;
  run().then(code => process.exit(code), e => { console.error(String(e && e.message || e)); process.exit(1); });
}

module.exports = { messages };
