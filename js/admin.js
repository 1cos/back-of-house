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

// ── BOT DEBUG — tabella ragionamento bot per ogni prep ────────
window.openBotDebug = async function(){
  hideAdminMenu();

  const sheet = document.createElement('div');
  sheet.id = 'botDebugSheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:70;background:rgba(15,23,42,0.5);overflow-y:auto;-webkit-overflow-scrolling:touch;';
  sheet.innerHTML = `<div style="min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:16px 8px 40px;">
    <div style="background:#fff;border-radius:20px;width:100%;max-width:960px;padding:20px 16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <span style="font-size:17px;font-weight:700;color:#1e3a5f;">🤖 Bot Debug</span>
        <div style="display:flex;gap:8px;align-items:center;">
          <button id="botSimRunBtn" onclick="runBotSim()" style="padding:7px 14px;background:#4f46e5;color:white;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;">▶ Aggiorna simulazione</button>
          <button id="botSimPrintBtn" onclick="printBotSim()" style="display:none;padding:7px 14px;background:#0f766e;color:white;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;">🖨️ Stampa</button>
          <button onclick="document.getElementById('botDebugSheet').remove()" style="font-size:22px;background:none;border:none;color:#94a3b8;">✕</button>
        </div>
      </div>
      <div style="font-size:11px;color:#94a3b8;margin-bottom:12px;">
        ⚠️ La simulazione NON tocca stock reale — legge i dati attuali e mostra cosa farebbe il bot stanotte.
      </div>
      <div id="botDebugBody" style="color:#64748b;font-size:14px;">Premi "Aggiorna simulazione" per caricare i dati.</div>
    </div>
  </div>`;
  sheet.addEventListener('click', e => { if(e.target===sheet) sheet.remove(); });
  document.body.appendChild(sheet);
  // Se la sim è già stata girata in precedenza, mostra subito il bottone Stampa
  if(window._botSimRows && window._botSimRows.length > 0) {
    var pb = document.getElementById('botSimPrintBtn');
    if(pb) pb.style.display = 'inline-block';
  }
};

window.runBotSim = async function(){
  const btn = document.getElementById('botSimRunBtn');
  const body = document.getElementById('botDebugBody');
  if(btn) { btn.disabled=true; btn.textContent='⏳ Calcolo...'; }
  if(body) body.innerHTML = '<div style="color:#64748b;padding:20px;text-align:center;">Simulazione in corso...</div>';

  try {
    // 1. Triggera la Edge Function di simulazione
    const SUPA_URL = 'https://ydqmumpytgrlceuinoqt.supabase.co';
    const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlkcW11bXB5dGdybGNldWlub3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxNDM5NzgsImV4cCI6MjA2NDcxOTk3OH0.RB5vYE3gJjH7gJy01Gh-eLQixanVX6cLc0disc8-bJs';

    const simRes = await fetch(`${SUPA_URL}/functions/v1/bot-preplist-sim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ run_by: user?.name || 'Max' })
    });
    const simData = await simRes.json();
    if (!simRes.ok || simData.error) throw new Error(simData.error || 'Errore simulazione');

    // 2. Leggi risultati da bot_debug_runs
    const { data: rows, error } = await supa
      .from('bot_debug_runs')
      .select('*')
      .eq('sim_date', simData.sim_date)
      .order('pill', { ascending: true })  // red prima
      .order('task_name');
    if (error) throw error;

    // 3. Render tabella
    const thS = 'padding:7px 8px;background:#f8fafc;font-size:11px;font-weight:700;color:#64748b;text-align:left;border-bottom:2px solid #e2e8f0;white-space:nowrap;';
    const tdS = 'padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;vertical-align:top;';

    const pillEmoji = p => p==='red'?'🔴':p==='yellow'?'🟡':'🟢';

    const thead = '<tr>'
      + `<th style="${thS}">Prep</th>`
      + `<th style="${thS}">Stock reale</th>`
      + `<th style="${thS}">Venduto ieri</th>`
      + `<th style="${thS}">Stock presunto</th>`
      + `<th style="${thS}">Finestra (${rows[0]?.shelf_life_days||'?'}gg cal)</th>`
      + `<th style="${thS}">Fabbisogno</th>`
      + `<th style="${thS}">Suggestion</th>`
      + `<th style="${thS}">Percorso</th>`
      + '</tr>';

    const fmtN = (n, unit) => {
      if(n===null||n===undefined) return '—';
      const v = parseFloat(n);
      if(isNaN(v)) return '—';
      const u_lower = (unit||'').toLowerCase();
      const isPz = ['pezzi','pz','nests','buste','cartocci','cup'].includes(u_lower);
      if(isPz) {
        const num = v % 1 === 0 ? String(Math.round(v)) : v.toFixed(1);
        // Mostra unità esplicita per unità non-generiche (nests, cup, buste, cartocci)
        const showUnit = ['nests','cup','buste','cartocci'].includes(u_lower);
        return showUnit ? num + ' ' + unit : num;
      }
      return v >= 1000 ? (v/1000).toFixed(1).replace(/\.0$/,'')+'kg' : Math.round(v)+'g';
    };

    const tbody = (rows||[]).map(r => {
      const isRed = r.pill === 'red';
      const rowBg = isRed ? 'background:#fff5f5;' : r.pill==='yellow' ? 'background:#fffbeb;' : '';
      return `<tr style="${rowBg}">
        <td style="${tdS}font-weight:600;color:#1e3a5f;">${pillEmoji(r.pill)} ${escHtml(r.task_name||'')}<br><span style="font-size:10px;color:#94a3b8;font-weight:400;">${escHtml(r.category||'')}</span></td>
        <td style="${tdS}text-align:right;">${fmtN(r.current_stock, r.unit)}</td>
        <td style="${tdS}text-align:right;color:${r.sold_yesterday?'#dc2626':'#94a3b8'};">${r.sold_yesterday ? '-'+fmtN(r.sold_yesterday,r.unit) : '—'}</td>
        <td style="${tdS}text-align:right;font-weight:600;">${fmtN(r.stock_presunto,r.unit)}</td>
        <td style="${tdS}font-size:10px;color:#64748b;white-space:normal;max-width:160px;">${escHtml(r.cover_days_list||'—')}</td>
        <td style="${tdS}text-align:right;">${fmtN(r.fabbisogno_raw,r.unit)}</td>
        <td style="${tdS}font-weight:700;color:${isRed?'#dc2626':r.pill==='yellow'?'#d97706':'#059669'};">${escHtml(r.suggestion_text||'—')}</td>
        <td style="${tdS}font-size:10px;color:#64748b;white-space:normal;max-width:200px;">${escHtml(r.percorso||'')}</td>
      </tr>`;
    }).join('');

    const nowStr = new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
    // Salva dati sim per stampa
    window._botSimMeta = { date: simData.sim_date, time: nowStr, red: simData.red, yellow: simData.yellow, green: simData.green, total: rows.length };
    window._botSimRows = rows;
    const printBtn = document.getElementById('botSimPrintBtn');
    if(printBtn) printBtn.style.display = 'inline-block';
    if(body) body.innerHTML = `
      <div style="font-size:12px;color:#64748b;margin-bottom:10px;">
        Simulazione del <b>${simData.sim_date}</b> — aggiornata alle ${nowStr} —
        🔴 ${simData.red} · 🟡 ${simData.yellow} · 🟢 ${simData.green} su ${rows.length} task
      </div>
      <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
        <table style="width:100%;border-collapse:collapse;min-width:800px;">
          <thead>${thead}</thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>
      <div style="margin-top:10px;font-size:10px;color:#94a3b8;">
        Stock reale non toccato · Scarico presunto = stima venduto ieri · Finestra = shelf life in calendar days
      </div>`;

  } catch(err) {
    if(body) body.innerHTML = `<div style="color:#ef4444;padding:16px;">Errore: ${err.message}</div>`;
  } finally {
    if(btn) { btn.disabled=false; btn.textContent='▶ Aggiorna simulazione'; }
  }
};

window.printBotSim = function() {
  const meta = window._botSimMeta;
  const rows = window._botSimRows;
  if(!meta || !rows) return;

  const fmtN = (n, unit) => {
    if(n===null||n===undefined) return '—';
    const v = parseFloat(n);
    if(isNaN(v)) return '—';
    const u_lower2 = (unit||'').toLowerCase();
    const isPz = ['pezzi','pz','nests','buste','cartocci','cup'].includes(u_lower2);
    if(isPz) {
      const num = v % 1 === 0 ? String(Math.round(v)) : v.toFixed(1);
      const showUnit = ['nests','cup','buste','cartocci'].includes(u_lower2);
      return showUnit ? num + ' ' + unit : num;
    }
    return v >= 1000 ? (v/1000).toFixed(1).replace(/\.0$/,'')+'kg' : Math.round(v)+'g';
  };
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const pillLabel = p => p==='red'?'🔴':p==='yellow'?'🟡':'🟢';

  const thead = `<tr>
    <th style="background:#1e3a5f;color:#fff;padding:5px 6px;font-size:10px;text-align:left;">Prep</th>
    <th style="background:#1e3a5f;color:#fff;padding:5px 6px;font-size:10px;text-align:left;">Stazione</th>
    <th style="background:#1e3a5f;color:#fff;padding:5px 6px;font-size:10px;text-align:right;">Stock reale</th>
    <th style="background:#1e3a5f;color:#fff;padding:5px 6px;font-size:10px;text-align:right;">Venduto ieri</th>
    <th style="background:#1e3a5f;color:#fff;padding:5px 6px;font-size:10px;text-align:right;">Stock presunto</th>
    <th style="background:#1e3a5f;color:#fff;padding:5px 6px;font-size:10px;text-align:right;">Fabbisogno</th>
    <th style="background:#1e3a5f;color:#fff;padding:5px 6px;font-size:10px;text-align:left;">Suggestion</th>
    <th style="background:#1e3a5f;color:#fff;padding:5px 6px;font-size:10px;text-align:left;">Percorso</th>
  </tr>`;

  const tbody = rows.map(r => {
    const bg = r.pill==='red'?'#fff0f0':r.pill==='yellow'?'#fffbeb':'#fff';
    const tdB = `padding:4px 6px;border-bottom:1px solid #e5e7eb;vertical-align:top;font-size:10px;background:${bg};`;
    return `<tr>
      <td style="${tdB}font-weight:700;"><b>${pillLabel(r.pill)} ${esc(r.task_name)}</b></td>
      <td style="${tdB}color:#666;">${esc(r.category)}</td>
      <td style="${tdB}text-align:right;">${fmtN(r.current_stock,r.unit)}</td>
      <td style="${tdB}text-align:right;color:${r.sold_yesterday?'#c00':'#999'};">${r.sold_yesterday?'-'+fmtN(r.sold_yesterday,r.unit):'—'}</td>
      <td style="${tdB}text-align:right;font-weight:700;">${fmtN(r.stock_presunto,r.unit)}</td>
      <td style="${tdB}text-align:right;">${fmtN(r.fabbisogno_raw,r.unit)}</td>
      <td style="${tdB}font-weight:700;color:${r.pill==='red'?'#c00':r.pill==='yellow'?'#b45309':'#166534'};">${esc(r.suggestion_text)}</td>
      <td style="${tdB}color:#555;font-size:9px;">${esc(r.percorso)}</td>
    </tr>`;
  }).join('');

  const tableHtml = `
    <div style="font-family:Arial,sans-serif;font-size:11px;color:#111;padding:12px;">
      <div style="font-size:14px;font-weight:700;margin-bottom:4px;">🤖 Bot Debug Simulazione — Zenos on the Square</div>
      <div style="font-size:11px;color:#555;margin-bottom:10px;">
        Data: <b>${meta.date}</b> · Aggiornata alle ${meta.time} ·
        🔴 ${meta.red} prep oggi · 🟡 ${meta.yellow} domani · 🟢 ${meta.green} ok · ${meta.total} task totali
      </div>
      <table style="width:100%;border-collapse:collapse;">${thead}${tbody}</table>
      <div style="margin-top:10px;font-size:9px;color:#999;">Simulazione — stock reale non toccato · generato da Brigade</div>
    </div>`;

  // Crea overlay fullscreen dentro la PWA (iOS-safe, niente window.open)
  const overlay = document.createElement('div');
  overlay.id = 'botPrintOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#fff;overflow-y:auto;-webkit-overflow-scrolling:touch;';

  // Barra azioni in cima (nascosta in stampa via @media print inline)
  const bar = document.createElement('div');
  bar.id = 'botPrintBar';
  bar.style.cssText = 'position:sticky;top:0;z-index:10;background:#1e3a5f;padding:10px 16px;display:flex;gap:10px;align-items:center;';
  bar.innerHTML = `
    <button onclick="botSimShare()" style="padding:8px 18px;background:#4f46e5;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;">📤 Condividi / Salva PDF</button>
    <button onclick="document.getElementById('botPrintOverlay').remove()" style="padding:8px 14px;background:#475569;color:#fff;border:none;border-radius:10px;font-size:14px;cursor:pointer;">✕ Chiudi</button>
    <span style="font-size:11px;color:#94a3b8;margin-left:4px;">Tocca Condividi → Stampa → tieni premuto PDF → Salva su File</span>`;

  // Contenuto tabella
  const content = document.createElement('div');
  content.innerHTML = tableHtml;

  // CSS stampa: nasconde la barra, forza landscape
  const style = document.createElement('style');
  style.textContent = `@media print { #botPrintBar { display:none!important; } @page { size: landscape; margin: 8mm; } }`;

  overlay.appendChild(style);
  overlay.appendChild(bar);
  overlay.appendChild(content);
  document.body.appendChild(overlay);
};

// ── Bot Sim Share — iOS-safe PDF export ──────────────────────
window.botSimShare = async function() {
  if (navigator.share) {
    try {
      var meta = window._botSimMeta;
      var rows = window._botSimRows || [];
      var lines = ['Bot Debug Simulazione — Zenos on the Square'];
      if (meta) lines.push('Data: ' + meta.date + ' · 🔴 ' + meta.red + ' prep oggi · 🟡 ' + meta.yellow + ' domani · 🟢 ' + meta.green + ' ok');
      lines.push('');
      rows.forEach(function(r) {
        var pill = r.pill==='red'?'🔴':r.pill==='yellow'?'🟡':'🟢';
        var fmtN = function(n,u) {
          if(n===null||n===undefined) return '—';
          var v=parseFloat(n); if(isNaN(v)) return '—';
          var u_lower=(u||'').toLowerCase();
          var isPz=['pezzi','pz','nests','buste','cartocci','cup'].indexOf(u_lower)!==-1;
          if(isPz){var num=v%1===0?String(Math.round(v)):v.toFixed(1);var showUnit=['nests','cup','buste','cartocci'].indexOf(u_lower)!==-1;return showUnit?num+' '+u:num;}
          return v>=1000?(v/1000).toFixed(1).replace(/\.0$/,'')+'kg':Math.round(v)+'g';
        };
        lines.push(pill+' '+r.task_name+' | '+(r.category||'')+' | '+fmtN(r.current_stock,r.unit)+' | '+(r.sold_yesterday?'-'+fmtN(r.sold_yesterday,r.unit):'—')+' | '+fmtN(r.stock_presunto,r.unit)+' | '+(r.suggestion_text||'—'));
      });
      await navigator.share({ title: 'Bot Debug Simulazione — Zenos', text: lines.join('\n') });
      return;
    } catch(e) {
      if (e.name === 'AbortError') return;
    }
  }
  window.print();
};

