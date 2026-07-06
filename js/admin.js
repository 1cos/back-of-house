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
  if(btn) { btn.disabled=true; btn.textContent='Calcolo...'; }
  if(body) body.innerHTML = '<div style="color:#64748b;padding:20px;text-align:center;">Simulazione in corso...</div>';

  try {
    const SUPA_URL = 'https://ydqmumpytgrlceuinoqt.supabase.co';
    const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlkcW11bXB5dGdybGNldWlub3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxNDM5NzgsImV4cCI6MjA2NDcxOTk3OH0.RB5vYE3gJjH7gJy01Gh-eLQixanVX6cLc0disc8-bJs';

    const simRes = await fetch(`${SUPA_URL}/functions/v1/bot-preplist-sim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ run_by: user?.name || 'Max' })
    });
    const simData = await simRes.json();
    if (!simRes.ok || simData.error) throw new Error(simData.error || 'Errore simulazione');

    const { data: rows, error } = await supa
      .from('bot_debug_runs')
      .select('*')
      .eq('sim_date', simData.sim_date)
      .order('pill', { ascending: true })
      .order('task_name');
    if (error) throw error;

    window._botSimMeta = { date: simData.sim_date, time: new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'}), red: simData.red, yellow: simData.yellow, green: simData.green, total: rows.length };
    window._botSimRows = rows;
    const printBtn = document.getElementById('botSimPrintBtn');
    if(printBtn) printBtn.style.display = 'inline-block';

    const fmtN = (n, unit) => {
      if(n===null||n===undefined) return '—';
      const v = parseFloat(n);
      if(isNaN(v)) return '—';
      const u = (unit||'').toLowerCase();
      const isPhys = ['pezzi','pz','nests','buste','cartocci','cup'].includes(u);
      if(isPhys){
        const num = v%1===0 ? String(Math.round(v)) : v.toFixed(1);
        const showUnit = ['nests','cup','buste','cartocci'].includes(u);
        return showUnit ? num+' '+unit : num;
      }
      return v>=1000 ? (v/1000).toFixed(1).replace(/\.0$/,'')+'kg' : Math.round(v)+'g';
    };

    const pillColor = p => p==='red'?'#ef4444':p==='yellow'?'#d97706':'#16a34a';
    const pillBg    = p => p==='red'?'#fef2f2':p==='yellow'?'#fefce8':'#f0fdf4';
    const pillBdr   = p => p==='red'?'#fecaca':p==='yellow'?'#fde68a':'#bbf7d0';
    const pillDot   = p => p==='red'?'#ef4444':p==='yellow'?'#f59e0b':'#22c55e';
    const esc = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    // Barra di copertura: 0-7 giorni = 0-100%
    const coverBar = (days) => {
      if(days===null||days===undefined) return '';
      const pct = Math.min(100, Math.round((parseFloat(days)||0) / 7 * 100));
      const col = pct < 30 ? '#ef4444' : pct < 60 ? '#f59e0b' : '#22c55e';
      return `<div style="margin-top:6px;height:4px;background:#e2e8f0;border-radius:99px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${col};border-radius:99px;transition:width 0.3s;"></div>
      </div>
      <div style="font-size:10px;color:#94a3b8;margin-top:2px;">${parseFloat(days).toFixed(1)} giorni</div>`;
    };

    // Fonte finestra di pianificazione — ricavata dal percorso
    const windowSource = (percorso) => {
      if(!percorso) return null;
      if(percorso.includes('expected_duration_days')) return 'expected_duration_days';
      if(percorso.includes('shelf_life fallback')||percorso.includes('shelf_life')) return 'shelf_life (fallback)';
      if(percorso.includes('prep_frequency')) return 'prep_frequency (fallback)';
      if(percorso.includes('default 3')||percorso.includes('default:3')) return 'default 3 giorni';
      return null;
    };

    const cards = rows.map((r, i) => {
      const p = r.pill || 'green';
      const cardId = 'bdc_'+i;
      const days = r.cover_days_count;
      const src = windowSource(r.percorso);

      // Azione collapsed
      let actionText = '';
      if(p==='red') actionText = r.suggested_qty ? `Prepara oggi: ${fmtN(r.suggested_qty, r.unit)}` : 'Prepara oggi';
      else if(p==='yellow') actionText = r.suggested_qty ? `Prepara presto: ${fmtN(r.suggested_qty, r.unit)}` : 'Prepara presto';
      else actionText = 'Sei coperto';

      // Coverage label
      let coverLabel = '';
      if(r.stock_presunto!==null&&r.stock_presunto!==undefined) {
        coverLabel = `Stock DB: ${fmtN(r.current_stock, r.unit)}`;
        if(r.cover_days_list) {
          const lastDay = r.cover_days_list.split(',').pop().trim();
          if(lastDay) coverLabel += ` \u00b7 arrivi a ${lastDay}`;
        }
      }

      return `<div style="background:${pillBg(p)};border:1.5px solid ${pillBdr(p)};border-radius:14px;margin-bottom:8px;overflow:hidden;">
        <div onclick="window._bdToggle('${cardId}')" style="padding:12px 14px;cursor:pointer;display:flex;align-items:flex-start;gap:10px;">
          <div style="width:10px;height:10px;border-radius:50%;background:${pillDot(p)};margin-top:5px;flex-shrink:0;"></div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap;">
              <span style="font-size:15px;font-weight:700;color:#0f172a;">${esc(r.task_name)}</span>
              <span style="font-size:11px;color:#64748b;font-weight:500;flex-shrink:0;">${esc(r.category||'')}</span>
            </div>
            <div style="font-size:12px;color:#475569;margin-top:2px;">${esc(coverLabel)}</div>
            <div style="font-size:13px;font-weight:700;color:${pillColor(p)};margin-top:3px;">${esc(actionText)}</div>
            ${coverBar(days)}
          </div>
          <div style="font-size:18px;color:#94a3b8;flex-shrink:0;transition:transform 0.2s;" id="${cardId}_arrow">&#8250;</div>
        </div>
        <div id="${cardId}" style="display:none;padding:0 14px 14px 34px;border-top:1px solid ${pillBdr(p)};">
          <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin:10px 0 8px;">Perche il bot dice questo</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;">
            ${_bdRow('Stock DB', fmtN(r.current_stock, r.unit))}
            ${_bdRow('Venduto ieri', r.sold_yesterday ? '-'+fmtN(r.sold_yesterday, r.unit) : '—')}
            ${_bdRow('Stock presunto', fmtN(r.stock_presunto, r.unit))}
            ${_bdRow('Fabbisogno', fmtN(r.fabbisogno_raw, r.unit))}
            ${_bdRow('Manca', r.needed && parseFloat(r.needed) > 0 ? fmtN(r.needed, r.unit) : '—')}
            ${_bdRow('Giorni da coprire', r.cover_days_count !== null ? r.cover_days_count+' gg' : '—')}
            ${src ? _bdRow('Fonte giorni', src) : ''}
            ${_bdRow('Shelf life', r.shelf_life_days ? r.shelf_life_days+' gg' : '—')}
            ${r.cover_days_list ? _bdRow('Giorni aperti', esc(r.cover_days_list)) : ''}
            ${_bdRow('Suggested qty', r.suggested_qty !== null ? fmtN(r.suggested_qty, r.unit) : '—')}
            ${r.pack_label ? _bdRow('Pack / batch', esc(r.pack_label)) : ''}
          </div>
          ${r.percorso ? `<div style="margin-top:8px;padding:8px 10px;background:rgba(0,0,0,0.04);border-radius:8px;font-size:10px;color:#64748b;line-height:1.5;">${esc(r.percorso)}</div>` : ''}
        </div>
      </div>`;
    }).join('');

    const nowStr = new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
    if(body) body.innerHTML = `
      <div style="font-size:12px;color:#64748b;margin-bottom:12px;padding:8px 10px;background:#f8fafc;border-radius:8px;">
        Sim <b>${simData.sim_date}</b> \u00b7 aggiornata ${nowStr} \u00b7
        <span style="color:#ef4444;">&#9679; ${simData.red}</span>
        <span style="color:#f59e0b;margin-left:6px;">&#9679; ${simData.yellow}</span>
        <span style="color:#22c55e;margin-left:6px;">&#9679; ${simData.green}</span>
        <span style="color:#94a3b8;margin-left:6px;">${rows.length} task</span>
        <span style="font-size:10px;color:#cbd5e1;margin-left:8px;">Tap card per dettaglio</span>
      </div>
      <div id="botCardList">${cards}</div>`;

  } catch(err) {
    if(body) body.innerHTML = `<div style="color:#ef4444;padding:16px;">Errore: ${escHtml(err.message)}</div>`;
  } finally {
    if(btn) { btn.disabled=false; btn.textContent='\u25b6 Aggiorna simulazione'; }
  }
};

// Helper riga expanded
function _bdRow(label, value) {
  if(!value || value==='—') return `<div style="padding:3px 0;"><span style="font-size:10px;color:#94a3b8;">${label}</span><div style="font-size:12px;color:#64748b;">—</div></div>`;
  return `<div style="padding:3px 0;"><span style="font-size:10px;color:#94a3b8;">${label}</span><div style="font-size:12px;font-weight:600;color:#1e3a5f;">${value}</div></div>`;
}

// Toggle card expanded/collapsed
window._bdToggle = function(id) {
  const el = document.getElementById(id);
  const arrow = document.getElementById(id+'_arrow');
  if(!el) return;
  const open = el.style.display === 'block';
  el.style.display = open ? 'none' : 'block';
  if(arrow) arrow.style.transform = open ? '' : 'rotate(90deg)';
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


