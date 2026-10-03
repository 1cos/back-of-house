'use strict';
// XCF-GG 04 — doc-ocr: OCR gratuito sul Mac Mini (Apple Vision) per le
// scansioni che il worker cloud non riesce a leggere (Google Vision senza
// fatturazione). Un giro: vd_ocr_claim -> scarica il PDF (bucket pubblico
// 'app') -> ocr-pdf (Swift, Apple Vision) -> righe con ocr-layout.js (la
// stessa funzione del worker cloud e dei test) -> vd_ocr_submit.
// Poi il worker cloud riparte da quel testo: split GG, parser, import.
// Nessun dato contabile scritto da qui. Esito: 0 ok, 1 errore.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const layout = require('./ocr-layout');

const HOME = process.env.DOC_OCR_HOME || path.join(os.homedir(), 'Library', 'Application Support', 'Brigade', 'doc-ocr');
const APP = path.join(HOME, 'app');
const BIN = path.join(APP, 'bin', 'ocr-pdf');
const CFG = path.join(HOME, 'config.json');
const JOURNAL = path.join(HOME, 'journal.jsonl');
const KEYCHAIN_SERVICE = 'brigade-cw-worker';   // token unico del worker Mac Mini (in DB solo sha256)

const journal = o => fs.appendFileSync(JOURNAL, JSON.stringify(Object.assign({ at: new Date().toISOString() }, o)) + '\n', { mode: 0o600 });
const token = () => execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', 'worker', '-w'], { encoding: 'utf8' }).trim();

function pagesToText(ocr) { return layout.pagesToText(ocr.pages || []); }

async function main() {
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'));
  const base = cfg.supabaseUrl.replace(/\/$/, '');
  const h = { apikey: cfg.supabaseKey, Authorization: 'Bearer ' + cfg.supabaseKey, 'Content-Type': 'application/json' };
  const t = token();
  const rpc = async (fn, args) => {
    const r = await fetch(base + '/rest/v1/rpc/' + fn, { method: 'POST', headers: h, body: JSON.stringify(args) });
    if (!r.ok) throw new Error(fn + ': ' + r.status);
    return r.json();
  };
  const c = await rpc('vd_ocr_claim', { p_worker_token: t, p_worker_id: cfg.workerId || os.hostname() });
  if (!c.ok) { journal({ claim_error: c.reason }); return 1; }
  for (const job of c.jobs) {
    const tmp = path.join(os.tmpdir(), 'brigade-ocr-' + job.id + '.pdf');
    try {
      const url = base + '/storage/v1/object/public/app/' + job.storage_path.split('/').map(encodeURIComponent).join('/');
      const r = await fetch(url);
      if (!r.ok) throw new Error('download ' + r.status);
      fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()), { mode: 0o600 });
      const ocr = JSON.parse(execFileSync(BIN, [tmp], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180000 }));
      const text = pagesToText(ocr);
      const s = await rpc('vd_ocr_submit', { p_worker_token: t, p_doc_id: job.id, p_text: text, p_engine: ocr.engine, p_pages: (ocr.pages || []).length, p_error: null });
      journal({ doc: job.id, vendor: job.vendor, pages: (ocr.pages || []).length, chars: text.length, result: s.status || s.reason });
    } catch (e) {
      const msg = String(e.message || e).slice(0, 300);
      await rpc('vd_ocr_submit', { p_worker_token: t, p_doc_id: job.id, p_text: null, p_engine: 'apple-vision', p_pages: 0, p_error: msg }).catch(() => {});
      journal({ doc: job.id, vendor: job.vendor, error: msg });
    } finally { try { fs.unlinkSync(tmp); } catch (e) {} }
  }
  return 0;
}

if (require.main === module) main().then(c => process.exit(c), e => { console.error(String(e && e.message || e)); process.exit(1); });
module.exports = { pagesToText };
