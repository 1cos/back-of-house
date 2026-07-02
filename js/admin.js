// ── ADMIN SHELL ──
// Funzioni condivise usate da tutti i sotto-moduli admin.
// I moduli specifici sono in file separati:
//   admin-prep.js        → gestione prep tasks
//   admin-ingredients.js → bootstrap, cleanup, similarity, vendor match
//   admin-chef-ai.js     → impostazioni Chef AI
//   admin-team.js        → gestione utenti e stazioni

// ── Helpers HTML — usati da tutti i moduli ───────────────────
function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(str) {
  return (str || '').replace(/'/g,'&#39;').replace(/"/g,'&quot;');
}

// ── Menu Admin ───────────────────────────────────────────────
// showAdminMenu e hideAdminMenu sono definite in app.js (con swipe-down e backdrop).
// Non ridefinire qui — la doppia definizione sovrascriveva il listener e rompeva la chiusura.


// ── CLOSED DATES — Giorni chiusura straordinaria ─────────────
window.openClosedDates = async function(){
  hideAdminMenu();
  const {data:rows} = await supa.from('closed_dates').select('*').order('date');
  const list = (rows||[]).map(r =>
    `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:white;border-radius:12px;margin-bottom:8px;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
      <div>
        <div style="font-size:15px;font-weight:600;color:#0f172a;">${r.date}</div>
        ${r.reason?`<div style="font-size:12px;color:#64748b;">${escHtml(r.reason)}</div>`:''}
      </div>
      <button onclick="deleteClosedDate('${r.date}')" style="font-size:18px;background:none;border:none;color:#ef4444;padding:4px 8px;">✕</button>
    </div>`
  ).join('');

  const sheet = document.createElement('div');
  sheet.id = 'closedDatesSheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:70;background:rgba(15,23,42,0.45);';
  sheet.innerHTML = `
    <div style="position:absolute;bottom:0;left:0;right:0;max-width:448px;margin:0 auto;background:#f8faff;border-radius:24px 24px 0 0;padding:20px 16px 40px;max-height:80vh;overflow-y:auto;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <span style="font-size:17px;font-weight:700;color:#0f172a;">🔒 Giorni Chiusi</span>
        <button onclick="document.getElementById('closedDatesSheet').remove()" style="font-size:22px;background:none;border:none;color:#94a3b8;">✕</button>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:16px;">
        <input type="date" id="closedDateInput" style="flex:1;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:inherit;">
        <input type="text" id="closedDateReason" placeholder="Motivo (opz.)" style="flex:1;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:inherit;">
        <button onclick="addClosedDate()" style="padding:10px 16px;background:#1e3a5f;color:white;border:none;border-radius:10px;font-size:14px;font-weight:600;">+</button>
      </div>
      <div id="closedDatesList">${list||'<div style="text-align:center;color:#94a3b8;padding:20px;">Nessun giorno chiuso</div>'}</div>
    </div>`;
  document.body.appendChild(sheet);
  sheet.addEventListener('click', e => { if(e.target===sheet) sheet.remove(); });
};

window.addClosedDate = async function(){
  const dateEl = document.getElementById('closedDateInput');
  const reasonEl = document.getElementById('closedDateReason');
  const date = dateEl?.value;
  if(!date) return;
  await supa.from('closed_dates').upsert({date, reason: reasonEl?.value||null, created_by: user?.name||'Max'});
  document.getElementById('closedDatesSheet')?.remove();
  openClosedDates();
};

window.deleteClosedDate = async function(date){
  await supa.from('closed_dates').delete().eq('date', date);
  document.getElementById('closedDatesSheet')?.remove();
  openClosedDates();
};
