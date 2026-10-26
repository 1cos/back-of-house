// ─────────────────────────────────────────────────────────────────────
// B-77 — CASSE APPROVATE DALLO CHEF (Max 24/10 e 26/10/2026)
//
// Dentro «Edit Vendor»: per la confezione di questo fornitore lo Chef dice
// quanti PEZZI e/o quanti GRAMMI ha una cassa. Serve quando la cassa non lo
// stampa ("16-22 CT" pomodori, "12/3 CT" e "40-48ct" Romaine). Da lì ogni
// fattura nuova fa seguire il prezzo a pezzo / al grammo al prezzo della cassa.
//
// Si salva SOLO con la funzione imposta_cassa (sessione Brigade di uno Chef):
// la tabella casse_approvate non si scrive direttamente. Il valore vecchio
// resta nello storico. Una cassa che stampa già il peso ("1/ 50 LB") non serve.
// ─────────────────────────────────────────────────────────────────────
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (p) => String(p || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const LB = 453.592;
  const lbIt = (g) => (g / LB).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const stampaPeso = (p) => /(#|\b(lb|lbs|oz|kg|g|gal|l|lt|ltr|ml|qt|pt)\b)/i.test(String(p || ''));
  const quando = (t) => { try { return new Date(t).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' }); } catch (_) { return ''; } };

  async function caMonta(box, v, ingredientId) {
    if (!box || !window.supa) return;
    const pack = String(v.pack_description || '').trim();
    box.innerHTML = '<div style="font-size:12px;color:#94a3b8;">Casse approvate…</div>';
    let casse = [];
    try {
      const r = await window.supa.from('casse_approvate').select('id,pack,pezzi,grammi,fonte,da,il')
        .eq('vendor', v.vendor).eq('ingredient_id', ingredientId).eq('attiva', true).order('pack');
      casse = (r && r.data) || [];
    } catch (_) { casse = []; }
    const questa = casse.find((c) => norm(c.pack) === norm(pack)) || null;
    const altre = casse.filter((c) => c !== questa);
    const riga = (c) => `${c.pezzi ? c.pezzi + ' pezzi' : ''}${c.pezzi && c.grammi ? ' · ' : ''}${c.grammi ? Math.round(c.grammi).toLocaleString('it-IT') + ' g (' + lbIt(c.grammi) + ' lb)' : ''}`;
    const lbl = 'font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;';
    const inp = 'width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;';
    box.innerHTML = `
      <div style="border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;">
        <div style="font-size:12px;font-weight:600;color:#1e293b;margin-bottom:2px;">📦 Cassa approvata dallo Chef</div>
        <div style="font-size:11px;color:#94a3b8;margin-bottom:8px;">Quanto contiene una cassa «${esc(pack || '—')}» quando la fattura non lo dice. Ogni fattura nuova usa questi numeri.</div>
        ${!pack ? '<div style="font-size:12px;color:#92400e;">Manca la confezione (pack): prima scrivila sopra.</div>'
          : stampaPeso(pack) ? '<div style="font-size:12px;color:#64748b;">Questa cassa stampa già il suo peso: non serve approvarla.</div>'
          : `${questa ? `<div id="caAttuale" style="font-size:12px;color:#166534;background:#f0fdf4;border-radius:8px;padding:6px 8px;margin-bottom:8px;">Oggi: <strong>${esc(riga(questa))}</strong><br><span style="color:#64748b;">${esc(questa.fonte)} — ${esc(questa.da)}, ${esc(quando(questa.il))}</span></div>` : '<div id="caAttuale" style="font-size:12px;color:#92400e;background:#fff7ed;border-radius:8px;padding:6px 8px;margin-bottom:8px;">Nessun numero approvato per questa cassa.</div>'}
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px;">
              <div><label style="${lbl}">PEZZI PER CASSA</label><input id="caPezzi" type="number" step="1" min="1" inputmode="numeric" value="${questa && questa.pezzi ? esc(questa.pezzi) : ''}" placeholder="es. 22" style="${inp}"></div>
              <div><label style="${lbl}">GRAMMI PER CASSA</label><input id="caGrammi" type="number" step="1" min="1" inputmode="numeric" value="${questa && questa.grammi ? esc(Math.round(questa.grammi)) : ''}" placeholder="es. 7500" style="${inp}"></div>
            </div>
            <div id="caLb" style="font-size:11px;color:#94a3b8;margin-bottom:8px;"></div>
            <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px;">
              <button type="button" id="caTogli" ${questa ? '' : 'disabled'} style="height:40px;border-radius:12px;background:#f1f5f9;color:#6b7280;font-size:12px;border:none;cursor:pointer;">Togli</button>
              <button type="button" id="caSalva" style="height:40px;border-radius:12px;background:#166534;color:white;font-size:12px;font-weight:500;border:none;cursor:pointer;">Salva cassa</button>
            </div>
            <div id="caEsito" style="font-size:12px;margin-top:6px;"></div>`}
        ${altre.length ? `<div style="font-size:11px;color:#64748b;margin-top:8px;">Altre casse approvate: ${altre.map((c) => `«${esc(c.pack)}» ${esc(riga(c))}`).join(' · ')}</div>` : ''}
      </div>`;
    const g = box.querySelector('#caGrammi'), lb = box.querySelector('#caLb');
    const aggLb = () => { if (lb) lb.textContent = g && Number(g.value) > 0 ? `= ${lbIt(Number(g.value))} lb` : ''; };
    if (g) { g.addEventListener('input', aggLb); aggLb(); }
    const manda = async (pezzi, grammi) => {
      const esito = box.querySelector('#caEsito');
      const btns = box.querySelectorAll('button'); btns.forEach((b) => { b.disabled = true; });
      esito.style.color = '#64748b'; esito.textContent = 'Salvo…';
      try {
        const { data, error } = await window.supa.rpc('imposta_cassa', {
          p_token: localStorage.getItem('brigade_token') || '', p_riga: v.id, p_pack: pack, p_pezzi: pezzi, p_grammi: grammi,
        });
        if (error || !data || !data.ok) throw new Error((error && error.message) || 'non salvato');
        esito.style.color = '#166534';
        esito.textContent = data.tolta ? '✓ Tolto (resta nello storico).' : (data.riga_aggiornata ? '✓ Salvato: prezzo di questo fornitore ricalcolato.' : '✓ Salvato: vale dalla prossima fattura con questa cassa.');
        setTimeout(() => caMonta(box, v, ingredientId), 1200);
      } catch (e) {
        esito.style.color = '#b91c1c';
        esito.textContent = /solo lo Chef/.test(e.message) ? 'Solo lo Chef può approvare le casse.' : /sessione/i.test(e.message) ? 'Sessione scaduta: rientra in Brigade.' : 'Non salvato: ' + e.message;
        btns.forEach((b) => { b.disabled = false; });
      }
    };
    const s = box.querySelector('#caSalva');
    if (s) s.addEventListener('click', () => {
      const pz = box.querySelector('#caPezzi').value.trim(), gr = g.value.trim();
      const pezzi = pz === '' ? null : Number(pz), grammi = gr === '' ? null : Number(gr);
      const esito = box.querySelector('#caEsito');
      if (pezzi === null && grammi === null) { esito.style.color = '#92400e'; esito.textContent = 'Scrivi i pezzi o i grammi (o tutti e due).'; return; }
      if ((pezzi !== null && (!Number.isInteger(pezzi) || pezzi <= 0)) || (grammi !== null && !(grammi > 0 && grammi < 200000))) { esito.style.color = '#92400e'; esito.textContent = 'Numeri non validi.'; return; }
      manda(pezzi, grammi);
    });
    const t = box.querySelector('#caTogli');
    if (t) t.addEventListener('click', () => manda(null, null));
  }
  window.caMonta = caMonta;
})();
