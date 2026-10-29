// ─────────────────────────────────────────────────────────────────────
// B-86 — BRIGADE SERVICE MONITOR (Max 29/10/2026)
//
// Stessa schermata in Brigade e in Brigade 2.0: cambia solo «call» (come si
// parla col server). Due pagine:
//   MONITORS   → i 3 monitor con ON/OFF (sala, cucina = display_active di oggi, camerieri)
//   MONITOR 3  → editor Chef/Sous-Chef: Feature, Risotto, Limited Stock (+/−), 86.
//                Si scrive una BOZZA; il TV cambia solo con PUBBLICA.
// Più il pannello rapido «Limited Stock −1» (home di Brigade 2.0 in servizio):
// il −1 va subito sul TV, senza conferma; a 0 il piatto passa da solo in 86.
//
// call(op, args) → Promise<{ok, state?, catalog?, error?}>, op = state|save|publish|adjust|86|display
// ─────────────────────────────────────────────────────────────────────
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const EMPTY = { feature: null, risotto: null, limited: [], sold_out: [] };
  const MONITORS = [
    { key: 'guest', name: 'Monitor 1 · Guest (dining room)', what: 'Dish photos slideshow' },
    { key: 'kitchen', name: 'Monitor 2 · Kitchen', what: 'Kitchen display (same switch as the TV button)' },
    { key: 'waiter', name: 'Monitor 3 · Waiters', what: 'Feature, Risotto, Limited Stock, 86' },
  ];
  const ERR = { changed_meanwhile: 'Changed meanwhile from another device — reloaded, check and try again.', forbidden: 'Only Chef and Sous-Chef can change the monitors.',
    invalid_token: 'Session expired — sign in again.', bad_title: 'The dish needs a title.', bad_qty: 'Quantity must be a whole number 0–999.',
    bad_portions: 'Portions must be a whole number.', duplicate_item: 'This dish is already in Limited Stock.', not_limited: 'This dish is no longer in Limited Stock.', offline: 'No connection — nothing changed.' };
  const msg = (e) => ERR[e] || ('Error: ' + e);

  const S = { // inline styles: the same file runs inside both apps
    wrap: 'font-family:inherit;color:#0f172a;max-width:760px;margin:0 auto;',
    tabs: 'display:flex;gap:8px;margin:0 0 14px;',
    tab: (on) => `flex:1;padding:12px;border-radius:12px;border:2px solid ${on ? '#0f172a' : '#e2e8f0'};background:${on ? '#0f172a' : '#fff'};color:${on ? '#fff' : '#334155'};font-weight:800;font-size:14px;`,
    card: 'border:1px solid #e2e8f0;border-radius:14px;padding:14px;margin-bottom:12px;background:#fff;',
    h: 'font-size:13px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;margin:0 0 10px;',
    inp: 'width:100%;padding:11px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:15px;box-sizing:border-box;margin-bottom:8px;background:#fff;color:#0f172a;',
    btn: (c) => `padding:10px 14px;border-radius:10px;border:0;font-weight:800;font-size:14px;background:${c};color:#fff;`,
    ghost: 'padding:8px 12px;border-radius:10px;border:1px solid #cbd5e1;background:#fff;font-weight:700;font-size:13px;color:#334155;',
    round: (c) => `width:48px;height:48px;flex:none;display:flex;align-items:center;justify-content:center;padding:0;border-radius:50%;border:0;font-size:24px;font-weight:900;background:${c};color:#fff;`,
    row: 'display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9;',
  };

  function mount(root, call, opts) {
    opts = opts || {};
    let st = null, catalog = [], draft = clone(EMPTY), tab = opts.tab || 'monitors', busy = false, saveTimer = null, note = '';

    async function load() {
      const r = await safe(() => call('state', {}));
      if (r && r.ok) { st = r.state; catalog = r.catalog || catalog; draft = clone(st.draft || EMPTY); }
      render();
    }
    async function safe(fn) { try { return await fn(); } catch (e) { return { ok: false, error: (e && (e.code || e.message)) || 'offline' }; } }
    function done(r, okNote) {
      if (r && r.state) { st = r.state; draft = clone(st.draft || EMPTY); }
      note = r && r.ok ? (okNote || '') : msg(r && r.error);
      busy = false; render();
    }
    function saveSoon() { clearTimeout(saveTimer); note = 'Saving draft…'; renderNote(); saveTimer = setTimeout(saveNow, 500); }
    async function saveNow() {
      clearTimeout(saveTimer); saveTimer = null;
      const r = await safe(() => call('save', { draft, rev: st.rev }));
      if (r && r.ok) { st = r.state; note = 'Draft saved — not on the TV until PUBLISH'; renderNote(); renderBar(); }
      else if (r && r.error === 'changed_meanwhile') done(r);
      else { note = msg(r && r.error); renderNote(); }   // what is typed stays on screen
    }
    async function publish() {
      if (busy) return; busy = true;
      if (saveTimer) await saveNow();
      done(await safe(() => call('publish', { rev: st.rev })), 'Published — the waiters’ TV is updated');
    }
    async function toggle(which, on) { if (busy) return; busy = true; done(await safe(() => call('display', { which, on })), ''); }

    function renderNote() { const n = root.querySelector('[data-note]'); if (n) n.textContent = note; }
    function renderBar() { const b = root.querySelector('[data-pub]'); if (b) b.outerHTML = pubBar(); bindPub(); }
    function pubBar() {
      const dirty = st && JSON.stringify(st.draft) !== JSON.stringify(st.published);
      const when = st && st.published_at ? new Date(st.published_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + (st.published_by ? ' · ' + esc(st.published_by) : '') : 'never';
      return `<div data-pub style="position:sticky;bottom:0;background:#fff;padding:10px 0;display:flex;align-items:center;gap:10px;border-top:1px solid #e2e8f0;">
        <div style="flex:1;font-size:12px;color:${dirty ? '#b45309' : '#64748b'};font-weight:700;">${dirty ? '● Changes not on the TV yet' : '✓ TV shows this'}<br><span style="font-weight:500;color:#94a3b8;">Last publish: ${when}</span></div>
        <button data-act="publish" style="${S.btn(dirty ? '#16a34a' : '#94a3b8')}padding:14px 22px;font-size:16px;">PUBLISH</button></div>`;
    }
    function bindPub() { const b = root.querySelector('[data-act="publish"]'); if (b) b.onclick = publish; }

    function dishCard(key, label, group) {
      const d = draft[key];
      const opts_ = catalog.filter((c) => c.group === group).map((c) => `<option value="${esc(c.item)}">`).join('');
      if (!d) return `<div style="${S.card}"><div style="${S.h}">★ ${label}</div>
        <input list="dl-${key}" data-pick="${key}" placeholder="Choose from Brigade (${esc(group)}) or type a new name" style="${S.inp}"><datalist id="dl-${key}">${opts_}</datalist>
        <button data-add="${key}" style="${S.btn('#0f172a')}">Add</button></div>`;
      return `<div style="${S.card}"><div style="display:flex;align-items:center;"><div style="${S.h}flex:1;margin:0;">★ ${label}</div><button data-clear="${key}" style="${S.ghost}">Remove</button></div>
        <div style="font-size:11px;color:#94a3b8;margin:4px 0 8px;">${d.pos_item ? 'From Brigade catalog: ' + esc(d.pos_item) : 'Typed by hand'}</div>
        <input data-f="${key}.title" value="${esc(d.title)}" placeholder="Title" style="${S.inp}font-weight:800;">
        <textarea data-f="${key}.description" placeholder="Description for the waiters" rows="2" style="${S.inp}">${esc(d.description)}</textarea>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;"><span style="font-size:13px;color:#475569;flex:1;">Portions available</span>
          <button data-por="${key}" data-d="-1" style="${S.round('#ef4444')}">−</button>
          <input data-f="${key}.portions" inputmode="numeric" value="${d.portions == null ? '' : d.portions}" placeholder="—" style="${S.inp}width:70px;text-align:center;margin:0;font-size:20px;font-weight:900;">
          <button data-por="${key}" data-d="1" style="${S.round('#16a34a')}">+</button></div>
        <input data-f="${key}.ingredients" value="${esc(d.ingredients)}" placeholder="Main ingredients" style="${S.inp}">
        <input data-f="${key}.allergens" value="${esc(d.allergens)}" placeholder="Allergens (e.g. shellfish, dairy, gluten)" style="${S.inp}">
        <label style="display:flex;gap:10px;align-items:center;font-size:14px;font-weight:700;color:${d.verified ? '#15803d' : '#b45309'};"><input type="checkbox" data-ver="${key}" ${d.verified ? 'checked' : ''} style="width:22px;height:22px;"> Ingredients and allergens verified by the Chef</label></div>`;
    }
    function listCard(kind) {
      const lim = kind === 'limited', arr = lim ? draft.limited : draft.sold_out;
      const all = catalog.map((c) => `<option value="${esc(c.item)}">`).join('');
      const rows = arr.map((x, i) => lim
        ? `<div style="${S.row}"><span style="flex:1;font-weight:800;font-size:15px;">${esc(x.item)}</span>
            <button data-q="${i}" data-d="-1" style="${S.round('#ef4444')}">−</button><span style="min-width:40px;text-align:center;font-size:22px;font-weight:900;">${x.qty}</span>
            <button data-q="${i}" data-d="1" style="${S.round('#16a34a')}">+</button><button data-rm="limited" data-i="${i}" style="${S.ghost}">✕</button></div>`
        : `<div style="${S.row}"><span style="flex:1;font-weight:800;font-size:15px;color:#dc2626;text-decoration:line-through;">${esc(x.item)}</span><button data-rm="sold_out" data-i="${i}" style="${S.ghost}">Back on menu</button></div>`).join('');
      return `<div style="${S.card}"><div style="${S.h}color:${lim ? '#c2410c' : '#dc2626'};">${lim ? 'Limited Stock' : '86 · Sold Out'}</div>
        <div style="font-size:11px;color:#94a3b8;margin:-6px 0 8px;">${lim ? 'Dishes still available, with how many are left. At 0 a dish moves to 86 by itself.' : 'Finished dishes. Separate from Limited Stock.'}</div>
        ${rows || '<div style="color:#94a3b8;font-size:13px;padding:6px 0;">Nothing</div>'}
        <div style="display:flex;gap:8px;margin-top:10px;"><input list="dl-all" data-new="${kind}" placeholder="Dish from the menu" style="${S.inp}margin:0;flex:1;">
        ${lim ? `<input data-newq inputmode="numeric" placeholder="Qty" style="${S.inp}margin:0;width:70px;text-align:center;">` : ''}
        <button data-addl="${kind}" style="${S.btn(lim ? '#c2410c' : '#dc2626')}">Add</button></div><datalist id="dl-all">${all}</datalist></div>`;
    }

    function render() {
      if (!st) { root.innerHTML = `<div style="${S.wrap}padding:20px;color:#64748b;">${note ? esc(note) : 'Loading…'}</div>`; return; }
      const head = `<div style="${S.tabs}"><button data-tab="monitors" style="${S.tab(tab === 'monitors')}">MONITORS</button><button data-tab="board" style="${S.tab(tab === 'board')}">MONITOR 3 · WAITERS</button></div>`;
      let body = '';
      if (tab === 'monitors') {
        body = MONITORS.map((m) => { const on = !!st.displays[m.key];
          return `<div style="${S.card}display:flex;align-items:center;gap:12px;"><div style="flex:1;"><div style="font-weight:900;font-size:16px;">${m.name}</div>
            <div style="font-size:12px;color:#64748b;">${m.what}</div><div style="font-size:13px;font-weight:800;margin-top:4px;color:${on ? '#16a34a' : '#dc2626'};">${on ? '● ON' : '○ OFF'}</div></div>
            <button data-disp="${m.key}" data-on="${on ? 0 : 1}" style="${S.btn(on ? '#dc2626' : '#16a34a')}min-width:96px;padding:14px;">${on ? 'Turn OFF' : 'Turn ON'}</button></div>`; }).join('')
          + (opts.waiterUrl ? `<div style="font-size:12px;color:#64748b;">Waiters’ TV page: <a href="${esc(opts.waiterUrl)}" target="_blank" style="color:#2563eb;">${esc(opts.waiterUrl)}</a></div>` : '');
      } else {
        body = dishCard('feature', 'Feature of the Day', 'Features') + dishCard('risotto', 'Risotto of the Day', 'Risotto') + listCard('limited') + listCard('sold_out') + pubBar();
      }
      root.innerHTML = `<div style="${S.wrap}">${head}<div data-note style="font-size:13px;font-weight:700;color:#475569;min-height:18px;margin-bottom:6px;">${esc(note)}</div>${body}</div>`;
      bind();
    }

    function bind() {
      root.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; note = ''; render(); });
      root.querySelectorAll('[data-disp]').forEach((b) => b.onclick = () => toggle(b.dataset.disp, b.dataset.on === '1'));
      root.querySelectorAll('[data-add]').forEach((b) => b.onclick = () => {
        const k = b.dataset.add, v = root.querySelector(`[data-pick="${k}"]`).value.trim(); if (!v) return;
        const fromCat = catalog.some((c) => c.item.toLowerCase() === v.toLowerCase());
        draft[k] = { title: v, description: '', portions: null, ingredients: '', allergens: '', verified: false, pos_item: fromCat ? v : null };
        render(); saveSoon(); });
      root.querySelectorAll('[data-clear]').forEach((b) => b.onclick = () => { draft[b.dataset.clear] = null; render(); saveSoon(); });
      root.querySelectorAll('[data-f]').forEach((i) => i.oninput = () => {
        const [k, f] = i.dataset.f.split('.');
        if (f === 'portions') { const n = i.value.trim() === '' ? null : parseInt(i.value, 10); draft[k].portions = Number.isFinite(n) ? Math.max(0, Math.min(999, n)) : null; }
        else draft[k][f] = i.value;
        saveSoon(); });
      root.querySelectorAll('[data-ver]').forEach((c) => c.onchange = () => { draft[c.dataset.ver].verified = c.checked; render(); saveSoon(); });
      root.querySelectorAll('[data-por]').forEach((b) => b.onclick = () => { const d = draft[b.dataset.por]; d.portions = Math.max(0, (d.portions || 0) + Number(b.dataset.d)); render(); saveSoon(); });
      root.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => {
        const i = Number(b.dataset.q), x = draft.limited[i]; x.qty = Math.max(0, x.qty + Number(b.dataset.d));
        if (x.qty === 0) { draft.limited.splice(i, 1); draft.sold_out.push({ item: x.item }); note = x.item + ' → 86'; }
        render(); saveSoon(); });
      root.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { draft[b.dataset.rm].splice(Number(b.dataset.i), 1); render(); saveSoon(); });
      root.querySelectorAll('[data-addl]').forEach((b) => b.onclick = () => {
        const k = b.dataset.addl, v = root.querySelector(`[data-new="${k}"]`).value.trim(); if (!v) return;
        const same = (x) => x.item.toLowerCase() === v.toLowerCase();
        if (k === 'limited') {
          const q = parseInt((root.querySelector('[data-newq]') || {}).value, 10);
          if (!Number.isFinite(q) || q < 1 || q > 999) { note = 'Write how many are left (1–999).'; renderNote(); return; }
          if (draft.limited.some(same)) { note = msg('duplicate_item'); renderNote(); return; }
          draft.sold_out = draft.sold_out.filter((x) => !same(x)); draft.limited.push({ item: v, qty: q });
        } else { if (draft.sold_out.some(same)) return; draft.limited = draft.limited.filter((x) => !same(x)); draft.sold_out.push({ item: v }); }
        render(); saveSoon(); });
      bindPub();
    }

    load();
    return { reload: load };
  }

  // Pannello rapido (home Brigade 2.0, servizio 16–21): solo i piatti limitati PUBBLICATI, un tasto grande −1, nessuna conferma.
  function mountQuick(root, call, opts) {
    opts = opts || {};
    let st = null, note = '', pending = {};
    async function load() { try { const r = await call('state', {}); if (r && r.ok) st = r.state; } catch (e) {} render(); }
    async function minus(item) {
      if (pending[item]) return; pending[item] = 1; render();
      let r; try { r = await call('adjust', { item, delta: -1 }); } catch (e) { r = { ok: false, error: 'offline' }; }
      delete pending[item];
      if (r && r.state) st = r.state;
      note = r && r.ok ? (r.went_86 ? `${item} → 86 (sold out)` : `${item}: ${r.qty} left`) : msg(r && r.error);
      render();
    }
    function render() {
      const lim = (st && st.published && st.published.limited) || [], so = (st && st.published && st.published.sold_out) || [];
      if (!st) { root.innerHTML = ''; return; }
      root.innerHTML = `<div style="border:2px solid #fdba74;background:#fff7ed;border-radius:16px;padding:12px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;"><div style="font-weight:900;font-size:14px;letter-spacing:.06em;color:#c2410c;flex:1;">LIMITED STOCK · TV</div>
        ${opts.onOpen ? '<button data-open style="border:0;background:none;color:#c2410c;font-weight:800;font-size:13px;">Edit ›</button>' : ''}</div>
        <div data-qnote style="font-size:13px;font-weight:700;color:#7c2d12;min-height:18px;margin:4px 0;">${esc(note)}</div>
        ${lim.length ? lim.map((x) => `<div style="display:flex;align-items:center;gap:12px;padding:6px 0;">
          <span style="flex:1;font-weight:800;font-size:17px;">${esc(x.item)}</span><span style="font-size:28px;font-weight:900;min-width:44px;text-align:center;color:${x.qty <= 2 ? '#dc2626' : '#0f172a'};">${x.qty}</span>
          <button data-minus="${esc(x.item)}" ${pending[x.item] ? 'disabled' : ''} style="width:84px;height:64px;flex:none;display:flex;align-items:center;justify-content:center;text-align:center;padding:0;border-radius:16px;border:0;background:#ef4444;color:#fff;font-size:26px;font-weight:900;opacity:${pending[x.item] ? .5 : 1};">−1</button></div>`).join('')
          : '<div style="color:#9a3412;font-size:13px;">No limited dishes on the TV.</div>'}
        ${so.length ? `<div style="font-size:12px;color:#dc2626;font-weight:700;margin-top:6px;">86: ${so.map((x) => esc(x.item)).join(' · ')}</div>` : ''}</div>`;
      root.querySelectorAll('[data-minus]').forEach((b) => b.onclick = () => minus(b.dataset.minus));
      const o = root.querySelector('[data-open]'); if (o) o.onclick = opts.onOpen;
    }
    load();
    const iv = setInterval(() => { if (!root.isConnected) return clearInterval(iv); if (!Object.keys(pending).length) load(); }, 20000);   // altri telefoni / T.E.C.
    return { reload: load };
  }

  window.ServiceBoardUI = { mount, mountQuick };
})();
