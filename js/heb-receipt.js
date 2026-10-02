// ─────────────────────────────────────────────────────────────────────
// HEB01 — scontrino H-E-B: foto → poche domande → Review → Confirm.
//
// Invoice → 🛒 H-E-B receipt → Camera / Photo library.
// Leggere la foto e rispondere alle domande NON scrive niente: annullare
// in qualunque momento lascia Brigade com'era. Solo "Confirm import"
// scrive, in una sola transazione (funzione heb-receipt → heb_receipt_import),
// e un secondo Confirm sullo stesso scontrino non duplica nulla.
// ─────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  const fnUrl = () => (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : window.SUPABASE_URL) + '/functions/v1/heb-receipt';
  const anon = () => (typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : window.SUPABASE_ANON_KEY);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (n == null || isNaN(n) ? '—' : '$' + Number(n).toFixed(2));
  const BLUE = '#1e3a5f';

  let st = null; // { b64, mime, p: risposta parse, ans: { key: {...} }, busy }

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

  // Foto ridotta (max 2000 px, JPEG): leggibile e leggera da caricare.
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
    let m = document.getElementById('hebModal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'hebModal';
      m.className = 'fixed inset-0 z-50 flex items-end';
      m.style.background = 'rgba(0,0,0,0.3)';
      document.body.appendChild(m);
    }
    m.innerHTML = `<div style="background:#fff;border-radius:24px 24px 0 0;padding:16px 16px calc(16px + env(safe-area-inset-bottom));width:100%;max-width:520px;margin:0 auto;max-height:92vh;overflow-y:auto;color:${BLUE};font-size:14px">${inner}</div>`;
    return m;
  }
  const close = () => { const m = document.getElementById('hebModal'); if (m) m.remove(); st = null; };
  window.hebClose = close;

  const btn = (label, on, kind, id) => `<button ${id ? 'id="' + id + '" ' : ''}onclick="${on}" style="width:100%;height:46px;border-radius:14px;border:none;font-size:15px;font-weight:600;cursor:pointer;margin-top:8px;${kind === 'primary' ? 'background:#1d4ed8;color:#fff' : 'background:rgba(59,130,246,0.08);color:#1d4ed8'}">${label}</button>`;

  window.openHebReceipt = function () {
    st = { ans: {} };
    shell(`
      <div style="font-size:17px;font-weight:600;margin-bottom:4px">🛒 H-E-B receipt</div>
      <div style="font-size:13px;color:#64748b;margin-bottom:14px">Take or pick the photo of the receipt. Brigade reads it and asks only what it can't know.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:22px 12px;background:rgba(59,130,246,0.06);border-radius:16px;cursor:pointer">
          <span style="font-size:28px">📷</span><span style="font-size:13px;font-weight:500">Camera</span>
          <input type="file" accept="image/*" capture="environment" style="display:none" onchange="hebOnFile(this)"></label>
        <label style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:22px 12px;background:rgba(59,130,246,0.06);border-radius:16px;cursor:pointer">
          <span style="font-size:28px">🖼️</span><span style="font-size:13px;font-weight:500">Photo library</span>
          <input type="file" accept="image/*" style="display:none" onchange="hebOnFile(this)"></label>
      </div>
      <div id="hebStatus" style="display:none;margin-top:12px;padding:12px;border-radius:12px;background:rgba(59,130,246,0.06);text-align:center"></div>
      ${btn('Cancel', 'hebClose()')}`);
  };

  window.hebOnFile = async function (input) {
    const f = input.files && input.files[0];
    if (!f) return;
    const s = document.getElementById('hebStatus');
    s.style.display = 'block'; s.textContent = '⏳ Reading the receipt…';
    try { Object.assign(st, await shrink(f)); } catch (e) { s.textContent = '❌ This photo could not be opened.'; return; }
    const p = await call({ action: 'parse', imageBase64: st.b64, mimeType: st.mime });
    if (!p.ok) {
      s.textContent = p.error === 'session' ? '❌ Session expired: log in again.'
        : p.error === 'could_not_read' ? '❌ Could not read the receipt. Try a closer, straight photo with the whole receipt.'
        : '❌ Error: ' + (p.error || 'unknown');
      return;
    }
    if (p.already_imported) {
      shell(`<div style="font-size:17px;font-weight:600;margin-bottom:8px">Already imported</div>
        <div>This receipt was imported on ${esc(p.already_imported.document_date)}. Nothing to do: Brigade never imports it twice.</div>${btn('Close', 'hebClose()', 'primary')}`);
      return;
    }
    st.p = p;
    for (const g of p.groups) {
      st.ans[g.key] = { ingredient_id: g.ingredient_id || '', ask: g.ask, pieces: '', weight_lb: '', std_g: g.std_g || null, use_std: !!g.std_g };
    }
    renderQuestions();
  };

  const ingName = (id) => { const i = (st.p.ingredients || []).find((x) => x.id === id); return i ? i.name : ''; };

  function liveRecon() {
    const sum = st.p.lines.reduce((t, l) => t + (Number(l.amount) || 0), 0);
    const tot = Number(st.p.receipt.total);
    return { sum: Math.round(sum * 100) / 100, total: isNaN(tot) ? null : tot, ok: !isNaN(tot) && Math.abs(tot - sum) < 0.005 && st.p.lines.every((l) => Number(l.amount) > 0) };
  }

  function groupAmount(g) {
    return st.p.lines.filter((l) => g.line_idx.includes(l.idx)).reduce((t, l) => t + (Number(l.amount) || 0), 0);
  }

  function groupReady(g) {
    const a = st.ans[g.key];
    if (!a.ingredient_id) return false;
    if (a.ask === 'pieces') return Number.isInteger(Number(a.pieces)) && Number(a.pieces) > 0;
    return Number(a.weight_lb) > 0 || g.printed_weight_lb > 0;
  }

  function renderQuestions() {
    const p = st.p, r = liveRecon();
    const check = p.lines.filter((l) => l.needs_check);
    const options = (sel) => `<option value="">— choose —</option>` + (p.ingredients || []).map((i) => `<option value="${esc(i.id)}"${i.id === sel ? ' selected' : ''}>${esc(i.name)}</option>`).join('');
    const cards = p.groups.map((g, gi) => {
      const a = st.ans[g.key];
      const qs = g.questions.map((q) => {
        if (q.kind === 'mapping') {
          return `<div style="margin-top:10px"><div style="font-weight:600">${esc(q.prompt)}</div>
            <div style="font-size:12px;color:#64748b;margin:2px 0 6px">${esc(q.why)}${q.suggestion_source ? ' Suggested from ' + (q.suggestion_source === 'history' ? 'your past H-E-B receipts' : 'the name') + ': check it.' : ''}</div>
            <select onchange="hebSet(${gi},'ingredient_id',this.value)" style="width:100%;height:44px;border-radius:12px;border:1px solid #cbd5e1;padding:0 10px;font-size:15px">${options(a.ingredient_id)}</select>
            <div style="display:flex;gap:14px;margin-top:8px;font-size:13px">
              <label><input type="radio" name="hebask${gi}" ${a.ask === 'pieces' ? 'checked' : ''} onchange="hebSet(${gi},'ask','pieces')"> count pieces</label>
              <label><input type="radio" name="hebask${gi}" ${a.ask === 'weight' ? 'checked' : ''} onchange="hebSet(${gi},'ask','weight')"> by weight (lb)</label></div>
            ${g.std_g_suggested && a.ask === 'pieces' ? `<label style="display:block;margin-top:8px;font-size:13px"><input type="checkbox" ${a.use_std ? 'checked' : ''} onchange="hebStd(${gi},this.checked)"> One piece = ${esc(g.std_g_suggested.grams)} g, as in the recipe "${esc(g.std_g_suggested.recipe)}"</label>` : ''}
          </div>`;
        }
        if (q.kind === 'pieces' || (q.kind !== 'weight' && a.ask === 'pieces')) {
          return `<div style="margin-top:10px"><div style="font-weight:600">${esc(q.prompt)}</div>
            <div style="font-size:12px;color:#64748b;margin:2px 0 6px">${esc(q.why)}</div>
            <input type="number" inputmode="numeric" min="1" step="1" value="${esc(a.pieces)}" placeholder="${q.last_answer ? 'last time: ' + esc(q.last_answer) : 'pieces'}" oninput="hebSet(${gi},'pieces',this.value)" style="width:100%;height:44px;border-radius:12px;border:1px solid #cbd5e1;padding:0 12px;font-size:16px"></div>`;
        }
        return `<div style="margin-top:10px"><div style="font-weight:600">${esc(q.prompt)}</div>
          <div style="font-size:12px;color:#64748b;margin:2px 0 6px">${esc(q.why)}</div>
          <input type="number" inputmode="decimal" min="0" step="0.01" value="${esc(a.weight_lb)}" placeholder="lb" oninput="hebSet(${gi},'weight_lb',this.value)" style="width:100%;height:44px;border-radius:12px;border:1px solid #cbd5e1;padding:0 12px;font-size:16px"></div>`;
      }).join('');
      return `<div style="border:1px solid #e2e8f0;border-radius:16px;padding:12px;margin-top:10px">
        <div style="font-weight:600">${esc(g.description)}</div>
        <div style="font-size:13px;color:#64748b">${g.packages} package${g.packages > 1 ? 's' : ''} · ${money(groupAmount(g))}${g.mapping_confirmed ? ' · ' + esc(ingName(g.ingredient_id)) : ''}</div>${qs}</div>`;
    }).join('');
    const ready = r.ok && !!p.receipt.date && p.groups.every(groupReady);
    shell(`
      <div style="font-size:17px;font-weight:600">We need a few details</div>
      <div style="font-size:13px;color:#64748b;margin:2px 0 8px">H-E-B ${esc(p.receipt.store || '')} · ${esc(p.receipt.date || 'date ?')} ${esc(p.receipt.time || '')} · ${p.lines.length} lines</div>
      ${check.length ? `<div style="background:#fff7ed;border-radius:12px;padding:10px;font-size:13px">Check ${check.length === 1 ? 'this amount' : 'these amounts'} against the receipt:
        ${check.map((l) => `<div style="display:flex;gap:8px;align-items:center;margin-top:6px"><span style="flex:1">${esc(l.description)}</span><input type="number" inputmode="decimal" step="0.01" value="${esc(l.amount ?? '')}" oninput="hebAmt(${l.idx},this.value)" style="width:96px;height:38px;border-radius:10px;border:1px solid #cbd5e1;padding:0 8px"></div>`).join('')}</div>` : ''}
      <div id="hebRecon" style="margin-top:8px;padding:10px;border-radius:12px;font-size:13px;background:${r.ok ? '#ecfdf5' : '#fef2f2'};color:${r.ok ? '#166534' : '#b91c1c'}">
        ${r.ok ? `✓ ${p.lines.length} lines add up to the receipt total ${money(r.total)}`
               : `Lines add up to ${money(r.sum)}, the receipt says ${money(r.total)}. Fix the amount or the total: <input type="number" inputmode="decimal" step="0.01" value="${esc(p.receipt.total ?? '')}" oninput="hebTotal(this.value)" style="width:96px;height:34px;border-radius:10px;border:1px solid #fca5a5;padding:0 8px">`}</div>
      ${!p.receipt.date ? `<div style="margin-top:8px;font-size:13px">Receipt date: <input type="date" oninput="hebDate(this.value)" style="height:38px;border-radius:10px;border:1px solid #cbd5e1;padding:0 8px"></div>` : ''}
      ${cards}
      ${ready ? btn('Review', 'hebReview()', 'primary', 'hebGo') : `<div style="margin-top:12px;font-size:12px;color:#64748b;text-align:center">Answer every card to continue.</div>`}
      ${btn('Cancel — nothing is saved', 'hebClose()')}`);
  }

  window.hebSet = function (gi, field, value) {
    const g = st.p.groups[gi];
    st.ans[g.key][field] = value;
    if (field === 'ask') {
      // il denominatore segue la scelta: pezzi o libbre
      g.questions = g.questions.filter((q) => q.kind === 'mapping');
      if (value === 'pieces') g.questions.push({ kind: 'pieces', prompt: `${g.packages > 1 ? g.packages + ' packages, ' : ''}${money(groupAmount(g))}: how many pieces${g.packages > 1 ? ' in total' : ''}?`, why: 'The receipt shows only the price of the package: the pieces give the cost per piece.' });
      else if (!(g.printed_weight_lb > 0)) g.questions.push({ kind: 'weight', prompt: `${money(groupAmount(g))}: how many lb in total?`, why: 'The receipt does not print the weight: the lb give the cost per lb.' });
      renderQuestions(); return;
    }
    if (field === 'ingredient_id') { renderQuestions(); return; }
    // input numerici: ridisegno (per il pulsante Review) senza perdere il focus
    const ready = liveRecon().ok && !!st.p.receipt.date && st.p.groups.every(groupReady);
    if (ready !== !!document.getElementById('hebGo')) renderQuestionsKeepFocus();
  };
  function renderQuestionsKeepFocus() {
    const a = document.activeElement; const idx = a ? [...document.querySelectorAll('#hebModal input')].indexOf(a) : -1;
    renderQuestions();
    if (idx >= 0) { const n = document.querySelectorAll('#hebModal input')[idx]; if (n) { n.focus(); const v = n.value; n.value = ''; n.value = v; } }
  }
  window.hebStd = function (gi, on) {
    const g = st.p.groups[gi];
    st.ans[g.key].use_std = on;
    st.ans[g.key].std_g = on && g.std_g_suggested ? Number(g.std_g_suggested.grams) : null;
  };
  window.hebAmt = function (idx, v) { const l = st.p.lines.find((x) => x.idx === idx); l.amount = v === '' ? null : Number(v); renderQuestionsKeepFocus(); };
  window.hebTotal = function (v) { st.p.receipt.total = v === '' ? null : Number(v); renderQuestionsKeepFocus(); };
  window.hebDate = function (v) { st.p.receipt.date = v || null; renderQuestionsKeepFocus(); };

  function derived(g) {
    const a = st.ans[g.key], amount = groupAmount(g);
    if (a.ask === 'pieces') { const n = Number(a.pieces); return { qty: n + ' pcs', unit: money(amount / n) + ' / piece', each: amount / n }; }
    const w = Number(a.weight_lb) || g.printed_weight_lb; return { qty: w + ' lb', unit: money(amount / w) + ' / lb' };
  }

  window.hebReview = function () {
    const p = st.p, r = liveRecon();
    if (!p.receipt.date) { renderQuestions(); return; }
    const rows = p.groups.map((g) => {
      const d = derived(g);
      return `<tr><td style="padding:8px 4px;border-top:1px solid #e2e8f0"><div style="font-weight:600">${esc(ingName(st.ans[g.key].ingredient_id))}</div><div style="font-size:11px;color:#64748b">${esc(g.description)} · ${g.packages} pkg</div></td>
        <td style="padding:8px 4px;border-top:1px solid #e2e8f0;text-align:right">${money(groupAmount(g))}</td>
        <td style="padding:8px 4px;border-top:1px solid #e2e8f0;text-align:right">${esc(d.qty)}</td>
        <td style="padding:8px 4px;border-top:1px solid #e2e8f0;text-align:right;font-weight:600">${esc(d.unit)}</td></tr>`;
    }).join('');
    shell(`
      <div style="font-size:17px;font-weight:600">Review</div>
      <div style="font-size:13px;color:#64748b;margin-bottom:8px">H-E-B ${esc(p.receipt.store || '')} · ${esc(p.receipt.date)} · total ${money(r.total)}</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums">
        <tr style="font-size:11px;color:#64748b;text-transform:uppercase"><td style="padding:4px">Product</td><td style="padding:4px;text-align:right">Receipt</td><td style="padding:4px;text-align:right">Qty</td><td style="padding:4px;text-align:right">Cost</td></tr>
        ${rows}
        <tr><td style="padding:8px 4px;border-top:2px solid ${BLUE};font-weight:600">Total</td><td style="padding:8px 4px;border-top:2px solid ${BLUE};text-align:right;font-weight:600">${money(r.sum)}</td><td colspan="2" style="border-top:2px solid ${BLUE}"></td></tr>
      </table>
      <div style="margin-top:12px;padding:10px;border-radius:12px;background:#f1f5f9;font-size:12px;line-height:1.45">
        <b>What Confirm does:</b> saves the photo and this receipt once, with one invoice line per package (the receipt amounts), and sets the current H-E-B cost per piece / lb. Brigade remembers which product each line is, never the number of pieces.<br>
        <b>Inventory is not changed:</b> steaks and filets are counted when the team logs production; counting them here too would double them.</div>
      <div id="hebErr" style="display:none;margin-top:8px;padding:10px;border-radius:12px;background:#fef2f2;color:#b91c1c;font-size:13px"></div>
      ${btn('Confirm import', 'hebConfirm(this)', 'primary')}
      ${btn('Back', 'hebBack()')}
      ${btn('Cancel — nothing is saved', 'hebClose()')}`);
  };
  window.hebBack = function () { renderQuestions(); };
  function alertBox(t) { const e = document.getElementById('hebErr'); if (e) { e.style.display = 'block'; e.textContent = t; } else console.warn(t); }

  window.hebConfirm = async function (b) {
    if (st.busy) return;
    st.busy = true; b.disabled = true; b.textContent = 'Importing…';
    const p = st.p;
    const groups = p.groups.map((g) => {
      const a = st.ans[g.key];
      return { key: g.key, ingredient_id: a.ingredient_id, ask: a.ask,
        pieces: a.ask === 'pieces' ? Number(a.pieces) : null,
        weight_lb: a.ask === 'weight' ? (Number(a.weight_lb) || g.printed_weight_lb) : null,
        std_g: a.ask === 'pieces' && a.use_std ? a.std_g : (g.std_g || null) };
    });
    const res = await call({ action: 'import', imageBase64: st.b64, mimeType: st.mime, receipt: p.receipt,
      lines: p.lines, groups, raw_text: p.raw_text });
    st.busy = false;
    if (!res.ok) {
      b.disabled = false; b.textContent = 'Confirm import';
      const msg = res.error === 'total_mismatch' ? 'The lines do not add up to the total. Nothing was saved.'
        : res.error === 'not_allowed' ? 'Only Chef / admin can import. Nothing was saved.'
        : res.error === 'session' ? 'Session expired: log in again. Nothing was saved.'
        : 'Import refused, nothing was saved: ' + (res.detail || res.error);
      alertBox(msg); return;
    }
    const r = res.result || {};
    const prices = (r.prices || []).map((x) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid #e2e8f0"><span>${esc(ingName(x.ingredient_id))}</span><b>${x.ask === 'pieces' ? money(x.cost_each) + ' / piece' : money(x.amount / x.weight_lb) + ' / lb'}</b></div>`).join('');
    shell(`
      <div style="font-size:17px;font-weight:600;margin-bottom:6px">${r.status === 'already_imported' ? 'Already imported' : '✓ Receipt imported'}</div>
      <div style="font-size:13px;color:#64748b;margin-bottom:8px">${r.status === 'already_imported' ? 'This receipt was already in Brigade: nothing was added.' : `${r.lines} lines saved once, with the photo.`}</div>
      ${prices}
      ${btn('Done', 'hebClose()', 'primary')}`);
  };
})();
