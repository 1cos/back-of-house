// ─────────────────────────────────────────────────────────────────────
// B-76 — scontrino di un altro negozio (Albertsons, Walmart in negozio, …): solo contabilità.
//
// Invoice → 🧾 Other store receipt → Camera / Photo library.
// Brigade legge la foto; lo Chef controlla negozio, data, righe e totale; «Save» registra la spesa.
// Non cambia prezzi né food cost (Chef Max 24/10/2026). H-E-B resta sul suo pulsante.
// Leggere la foto NON scrive niente; lo stesso scontrino non entra mai due volte.
// ─────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  const fnUrl = () => (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : window.SUPABASE_URL) + '/functions/v1/store-receipt';
  const anon = () => (typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : window.SUPABASE_ANON_KEY);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (n == null || isNaN(n) ? '—' : '$' + Number(n).toFixed(2));
  const BLUE = '#1e3a5f';
  const r2 = (n) => Math.round(n * 100) / 100;
  const val = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : r2(Number(v)));

  let st = null; // { b64, mime, p: risposta parse, busy }

  async function call(body) {
    try {
      const r = await fetch(fnUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + anon(), apikey: anon() },
        body: JSON.stringify({ ...body, brigade_token: localStorage.getItem('brigade_token') }),
      });
      return await r.json();
    } catch (e) { return { ok: false, error: 'network' }; }
  }

  function shrink(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 2000 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve({ b64: c.toDataURL('image/jpeg', 0.88).split(',')[1], mime: 'image/jpeg' });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('photo')); };
      img.src = url;
    });
  }

  function shell(inner) {
    let m = document.getElementById('srModal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'srModal';
      m.className = 'fixed inset-0 z-50 flex items-end';
      m.style.background = 'rgba(0,0,0,0.3)';
      document.body.appendChild(m);
    }
    m.innerHTML = `<div style="background:#fff;border-radius:24px 24px 0 0;padding:16px 16px calc(16px + env(safe-area-inset-bottom));width:100%;max-width:520px;margin:0 auto;max-height:92vh;overflow-y:auto;color:${BLUE};font-size:14px">${inner}</div>`;
    return m;
  }
  const close = () => { const m = document.getElementById('srModal'); if (m) m.remove(); st = null; };
  window.srClose = close;
  const btn = (label, on, kind, id) => `<button ${id ? 'id="' + id + '" ' : ''}onclick="${on}" style="width:100%;height:46px;border-radius:14px;border:none;font-size:15px;font-weight:600;cursor:pointer;margin-top:8px;${kind === 'primary' ? 'background:#1d4ed8;color:#fff' : 'background:rgba(59,130,246,0.08);color:#1d4ed8'}">${label}</button>`;
  const field = 'height:38px;box-sizing:border-box;min-width:0;max-width:100%;border:1px solid #cbd5e1;border-radius:10px;padding:0 10px;font-size:15px;background:#fff;color:' + BLUE;

  window.openStoreReceipt = function () {
    st = {};
    shell(`
      <div style="font-size:17px;font-weight:600;margin-bottom:4px">🧾 Other store receipt</div>
      <div style="font-size:13px;color:#64748b;margin-bottom:14px">Albertsons, Walmart, any store except H-E-B. Brigade reads the photo and records the expense. Ingredient prices don't change.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:22px 12px;background:rgba(59,130,246,0.06);border-radius:16px;cursor:pointer">
          <span style="font-size:28px">📷</span><span style="font-size:13px;font-weight:500">Camera</span>
          <input type="file" accept="image/*" capture="environment" style="display:none" onchange="srOnFile(this)"></label>
        <label style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:22px 12px;background:rgba(59,130,246,0.06);border-radius:16px;cursor:pointer">
          <span style="font-size:28px">🖼️</span><span style="font-size:13px;font-weight:500">Photo library</span>
          <input type="file" accept="image/*" style="display:none" onchange="srOnFile(this)"></label>
      </div>
      <div id="srStatus" style="display:none;margin-top:12px;padding:12px;border-radius:12px;background:rgba(59,130,246,0.06);text-align:center"></div>
      ${btn('Cancel', 'srClose()')}`);
  };

  window.srOnFile = async function (input) {
    const f = input.files && input.files[0];
    if (!f) return;
    const s = document.getElementById('srStatus');
    s.style.display = 'block'; s.textContent = '⏳ Reading the receipt…';
    try { Object.assign(st, await shrink(f)); } catch (e) { s.textContent = '❌ This photo could not be opened.'; return; }
    const p = await call({ action: 'parse', imageBase64: st.b64, mimeType: st.mime });
    if (!p.ok) {
      s.textContent = p.error === 'session' ? '❌ Session expired: log in again.'
        : p.error === 'could_not_read' ? '❌ Could not read the receipt. Try a closer, straight photo with the whole receipt.'
        : p.error === 'network' ? '❌ No connection. Try again.' : '❌ Error: ' + (p.error || 'unknown');
      return;
    }
    if (p.already_imported) return alreadyIn(p.already_imported);
    if (p.is_heb) {
      shell(`<div style="font-size:17px;font-weight:600;margin-bottom:8px">This is an H-E-B receipt</div>
        <div>H-E-B has its own button, which also counts pieces and pounds for the prices.</div>
        ${btn('Open H-E-B receipt', "srClose();openHebReceipt()", 'primary')}${btn('Close', 'srClose()')}`);
      return;
    }
    st.p = p;
    st.items = p.items.map((i) => ({ label: i.label, amount: i.amount == null ? '' : String(i.amount), low: i.confidence != null && i.confidence < 0.8 }));
    st.rc = { store: p.receipt.store || '', date: p.receipt.date || '', time: p.receipt.time, receipt_number: p.receipt.receipt_number,
      tax: p.receipt.tax == null ? '' : String(p.receipt.tax), total: p.receipt.total == null ? '' : String(p.receipt.total) };
    review();
  };

  function alreadyIn(a) {
    shell(`<div style="font-size:17px;font-weight:600;margin-bottom:8px">Already recorded</div>
      <div>${esc(a.vendor || 'This receipt')} · ${esc(a.document_date || '')} is already in Brigade. Nothing to do: Brigade never records it twice.</div>${btn('Close', 'srClose()', 'primary')}`);
  }

  function recon() {
    const sum = r2(st.items.reduce((s, i) => s + (val(i.amount) ?? 0), 0) + (val(st.rc.tax) ?? 0));
    const total = val(st.rc.total);
    const missing = st.items.some((i) => val(i.amount) == null);
    return { sum, total, ok: !missing && total != null && Math.abs(sum - total) <= 0.02 };
  }
  const ready = () => recon().ok && !!st.rc.store.trim() && /^\d{4}-\d{2}-\d{2}$/.test(st.rc.date) && st.items.length > 0;

  function checkBox() {
    const r = recon();
    return r.ok ? `<div style="background:#f0fdf4;border-radius:12px;padding:10px;font-size:13px">✓ Lines${val(st.rc.tax) ? ' + tax' : ''} add up to the receipt total ${money(r.total)}</div>`
      : `<div style="background:#fff7ed;border-radius:12px;padding:10px;font-size:13px">Lines${val(st.rc.tax) ? ' + tax' : ''} add up to ${money(r.sum)}, the receipt says ${money(r.total)}. Fix an amount or the total.</div>`;
  }

  function review() {
    shell(`
      <div style="font-size:17px;font-weight:600;margin-bottom:2px">🧾 Check and save</div>
      <div style="font-size:12px;color:#64748b;margin-bottom:10px">Accounting only: ingredient prices and food cost don't change.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        <label style="font-size:12px;color:#64748b;min-width:0">Store<input id="srStore" value="${esc(st.rc.store)}" oninput="srSet('store',this.value)" style="${field};width:100%;margin-top:2px"></label>
        <label style="font-size:12px;color:#64748b;min-width:0">Date<input id="srDate" type="date" value="${esc(st.rc.date)}" oninput="srSet('date',this.value)" style="${field};width:100%;margin-top:2px"></label>
      </div>
      <div style="font-size:12px;color:#64748b;margin-bottom:4px">Lines</div>
      ${st.items.map((i, k) => `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
          <span style="flex:1;font-size:13px">${esc(i.label)}${i.low ? ' <span style="color:#b45309">· check</span>' : ''}</span>
          <input type="number" inputmode="decimal" step="0.01" value="${esc(i.amount)}" oninput="srAmt(${k},this.value)" style="${field};width:96px;text-align:right"></div>`).join('')}
      <div style="display:flex;gap:8px;align-items:center;margin:8px 0 6px"><span style="flex:1;font-size:13px">Tax</span>
        <input type="number" inputmode="decimal" step="0.01" value="${esc(st.rc.tax)}" oninput="srSet('tax',this.value)" style="${field};width:96px;text-align:right"></div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px"><span style="flex:1;font-size:14px;font-weight:600">Total on the receipt</span>
        <input type="number" inputmode="decimal" step="0.01" value="${esc(st.rc.total)}" oninput="srSet('total',this.value)" style="${field};width:96px;text-align:right;font-weight:600"></div>
      <div id="srCheck">${checkBox()}</div>
      <div id="srErr" style="color:#b42318;font-size:13px;margin-top:6px"></div>
      ${btn('Save', 'srSave()', 'primary', 'srSaveBtn')}${btn('Cancel', 'srClose()')}`);
    refresh();
  }
  // aggiorna solo il controllo e il pulsante: il campo che si sta scrivendo non perde il fuoco
  function refresh() {
    const c = document.getElementById('srCheck'); if (c) c.innerHTML = checkBox();
    const b = document.getElementById('srSaveBtn'); if (b) { b.disabled = !ready() || !!st.busy; b.style.opacity = b.disabled ? '0.45' : '1'; }
  }
  window.srSet = function (k, v) { st.rc[k] = v; refresh(); };
  window.srAmt = function (k, v) { st.items[k].amount = v; refresh(); };

  window.srSave = async function () {
    if (!ready() || st.busy) return;
    st.busy = true; refresh();
    const b = document.getElementById('srSaveBtn'); if (b) b.textContent = 'Saving…';
    const r = await call({ action: 'import', imageBase64: st.b64, mimeType: st.mime, raw_text: st.p.raw_text,
      receipt: { ...st.rc, tax: val(st.rc.tax), total: val(st.rc.total) },
      items: st.items.map((i) => ({ label: i.label, amount: val(i.amount) })) });
    st.busy = false;
    if (r.ok && r.already_imported) return alreadyIn(r.already_imported);
    if (r.ok) {
      const d = r.result || {};
      shell(`<div style="font-size:17px;font-weight:600;margin-bottom:8px">✓ Saved</div>
        <div>${esc(d.vendor)} · ${esc(d.document_date)} · ${money(val(st.rc.total))}</div>
        <div style="font-size:13px;color:#64748b;margin-top:6px">Recorded as an expense. Ingredient prices didn't change.</div>${btn('Close', 'srClose()', 'primary')}`);
      if (typeof showScToast === 'function') showScToast('✓ Receipt saved');
      return;
    }
    const msg = { not_allowed: 'Only the chef or a manager can save receipts.', session: 'Session expired: log in again.', use_heb_receipt: 'H-E-B receipts go through the H-E-B button.',
      total_mismatch: 'Lines and total do not match.', date_missing: 'Add the date.', store_missing: 'Add the store.', network: 'No connection. Nothing was saved, try again.' }[r.error] || ('Could not save: ' + (r.error || 'unknown'));
    if (b) b.textContent = 'Save';
    refresh();
    const e = document.getElementById('srErr'); if (e) e.textContent = msg;
  };
})();
