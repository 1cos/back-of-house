'use strict';
// XCF-CW — Brigade per il worker: SOLO le due RPC della coda
// (po_worker_claim / po_worker_finish) e la push agli admin.
// URL e chiave anon dal config.json locale; il token del worker dal
// Portachiavi (vedi index.js). In DB c'e' solo lo sha256 del token.

function client(cfg, workerToken, fetchImpl = globalThis.fetch) {
  if (!cfg || !cfg.supabaseUrl || !cfg.supabaseKey) throw new Error('config: supabaseUrl/supabaseKey mancanti');
  if (!workerToken) throw new Error('token del worker mancante (Portachiavi)');
  const base = cfg.supabaseUrl.replace(/\/$/, '');
  const h = { apikey: cfg.supabaseKey, Authorization: 'Bearer ' + cfg.supabaseKey, 'Content-Type': 'application/json', Accept: 'application/json' };
  async function rpc(fn, args) {
    const r = await fetchImpl(base + '/rest/v1/rpc/' + fn, { method: 'POST', headers: h, body: JSON.stringify(args) });
    if (!r.ok) throw new Error(`Brigade ${fn}: ${r.status}`);
    return r.json();
  }
  return {
    claim: workerId => rpc('po_worker_claim', { p_worker_token: workerToken, p_worker_id: workerId }),
    finish: (attemptId, outcome, result, vendorOrderNumber) => rpc('po_worker_finish', {
      p_worker_token: workerToken, p_attempt_id: attemptId, p_outcome: outcome, p_result: result,
      p_vendor_order_number: vendorOrderNumber || null }),
    // Stesso percorso di Tell Chef / bek-entree-sync: push solo ad admin/sous_chef.
    async push(title, body) {
      try {
        const r = await fetchImpl(base + '/functions/v1/notifications', { method: 'POST', headers: h,
          body: JSON.stringify({ table: 'chef_reports', record: { user_name: "Chef's Warehouse (worker)", station: null, message: title + ' — ' + body } }) });
        return r.ok;
      } catch (e) { return false; }
    },
  };
}

module.exports = { client };
