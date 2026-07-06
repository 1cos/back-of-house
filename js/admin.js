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
        <button onclick="document.getElementById('botDebugSheet').remove()" style="font-size:22px;background:none;border:none;color:#94a3b8;">✕</button>
      </div>
      <div style="display:flex;gap:0;margin-bottom:14px;border-bottom:2px solid #e2e8f0;">
        <button id="bdTab1" onclick="bdSwitchTab(1)"
          style="flex:1;padding:9px 0;font-size:13px;font-weight:700;border:none;background:none;cursor:pointer;border-bottom:3px solid #4f46e5;color:#4f46e5;margin-bottom:-2px;">
          Bot v1 (sim attuale)
        </button>
        <button id="bdTab2" onclick="bdSwitchTab(2)"
          style="flex:1;padding:9px 0;font-size:13px;font-weight:600;border:none;background:none;cursor:pointer;border-bottom:3px solid transparent;color:#94a3b8;margin-bottom:-2px;">
          Bot v2 (logica semplice)
        </button>
      </div>
      <div id="bdPanel1">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">
          <button id="botSimRunBtn" onclick="runBotSim()" style="padding:7px 14px;background:#4f46e5;color:white;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;">▶ Aggiorna simulazione</button>
          <button id="botSimPrintBtn" onclick="printBotSim()" style="display:none;padding:7px 14px;background:#0f766e;color:white;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;">🖨️ Stampa</button>
        </div>
        <div style="font-size:11px;color:#94a3b8;margin-bottom:12px;">
          Simulazione bot-preplist-builder — NON tocca stock reale.
        </div>
        <div id="botDebugBody" style="color:#64748b;font-size:14px;">Premi "Aggiorna simulazione" per caricare i dati.</div>
      </div>
      <div id="bdPanel2" style="display:none;">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">
          <button id="botV2RunBtn" onclick="runBotV2()" style="padding:7px 14px;background:#0f766e;color:white;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;">▶ Calcola Bot v2</button>
        </div>
        <div style="font-size:11px;color:#94a3b8;margin-bottom:12px;">
          Logica semplice — stock grezzo dal DB, finestra da expected_duration_days, nessuna scrittura su prep_tasks.
        </div>
        <div id="botV2Body" style="color:#64748b;font-size:14px;">Premi "Calcola Bot v2" per caricare i dati.</div>
      </div>
    </div>
  </div>`;
  sheet.addEventListener('click', e => { if(e.target===sheet) sheet.remove(); });
  document.body.appendChild(sheet);
  if(window._botSimRows && window._botSimRows.length > 0) {
    var pb = document.getElementById('botSimPrintBtn');
    if(pb) pb.style.display = 'inline-block';
  }
};

window.bdSwitchTab = function(n) {
  document.getElementById('bdPanel1').style.display = n===1 ? 'block' : 'none';
  document.getElementById('bdPanel2').style.display = n===2 ? 'block' : 'none';
  const t1 = document.getElementById('bdTab1');
  const t2 = document.getElementById('bdTab2');
  if(t1) { t1.style.borderBottomColor = n===1?'#4f46e5':'transparent'; t1.style.color = n===1?'#4f46e5':'#94a3b8'; t1.style.fontWeight = n===1?'700':'600'; }
  if(t2) { t2.style.borderBottomColor = n===2?'#0f766e':'transparent'; t2.style.color = n===2?'#0f766e':'#94a3b8'; t2.style.fontWeight = n===2?'700':'600'; }
};

window.runBotV2 = async function(){
  const btn = document.getElementById('botV2RunBtn');
  const body = document.getElementById('botV2Body');
  if(btn) { btn.disabled=true; btn.textContent='Calcolo...'; }
  if(body) body.innerHTML = '<div style="color:#64748b;padding:20px;text-align:center;">Bot v2 in esecuzione...</div>';

  try {
    const SUPA_URL = 'https://ydqmumpytgrlceuinoqt.supabase.co';
    const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlkcW11bXB5dGdybGNldWlub3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxNDM5NzgsImV4cCI6MjA2NDcxOTk3OH0.RB5vYE3gJjH7gJy01Gh-eLQixanVX6cLc0disc8-bJs';

    const res = await fetch(`${SUPA_URL}/functions/v1/bot-preplist-v2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ run_by: user?.name || 'Max' })
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Errore bot v2');

    const { data: rows, error: rowsErr } = await supa
      .from('bot_v2_runs')
      .select('*')
      .eq('sim_date', data.sim_date)
      .order('pill', { ascending: true })
      .order('task_name');
    if (rowsErr) throw rowsErr;

    const pillDot = p => p==='red'?'#ef4444':p==='yellow'?'#f59e0b':'#22c55e';
    const pillBg  = p => p==='red'?'#fef2f2':p==='yellow'?'#fefce8':'#f0fdf4';
    const pillBdr = p => p==='red'?'#fecaca':p==='yellow'?'#fde68a':'#bbf7d0';
    const pillTxt = p => p==='red'?'#dc2626':p==='yellow'?'#d97706':'#16a34a';
    const esc = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const fmtN = (n,u) => {
      if(n===null||n===undefined) return '—';
      const v=parseFloat(n); if(isNaN(v)) return '—';
      const ul=(u||'').toLowerCase();
      const isPh=['pezzi','pz','nests','buste','cartocci','cup'].includes(ul);
      if(isPh){const nm=v%1===0?String(Math.round(v)):v.toFixed(1);return ['nests','cup','buste','cartocci'].includes(ul)?nm+' '+u:nm;}
      return v>=1000?(v/1000).toFixed(1).replace(/\.0$/,'')+'kg':Math.round(v)+'g';
    };

    const cards = rows.map((r,i) => {
      const p = r.pill||'green';
      const cid = 'bv2c_'+i;
      const lang = (window._currentUser?.lang||'en').toLowerCase();
      const li = lang==='it'?1:lang==='es'?3:2;
      const noteParts = (r.suggested_note||'').split('|');
      const noteText = noteParts[li]||noteParts[1]||'';

      const srcLabel = {
        'expected_duration_days':'expected_duration_days',
        'shelf_life fallback':'shelf_life (fallback)',
        'prep_frequency fallback':'prep_frequency (fallback)',
        'default 3':'default 3 giorni'
      }[r.planning_window_source] || r.planning_window_source || '—';

      // Estrai giorni_coperti dal percorso ("copertura=Ngg" o "copertura=illimitata")
      const covMatch = (r.percorso||'').match(/copertura=(\d+)gg/);
      const giorniCoperti = covMatch ? parseInt(covMatch[1]) : ((r.percorso||'').includes('illimitata') ? 999 : 0);
      const windowDays = r.planning_window_days || 3;
      const rawPct = windowDays > 0 ? giorniCoperti / windowDays : 0;
      const pct = Math.min(100, Math.round(rawPct * 100));
      const barCol = pct >= 100 ? '#22c55e' : pct >= 30 ? '#f59e0b' : '#ef4444';
      const barPct = giorniCoperti === 0 ? 2 : pct;

      // recipe_id per contributors sub-recipe lookup
      const recipeId = r.recipe_id || '';

      return `<div style="background:${pillBg(p)};border:1.5px solid ${pillBdr(p)};border-radius:14px;margin-bottom:8px;overflow:hidden;">
        <div onclick="window._bv2Toggle('${cid}')" style="padding:12px 14px;cursor:pointer;display:flex;align-items:flex-start;gap:10px;">
          <div style="width:10px;height:10px;border-radius:50%;background:${pillDot(p)};margin-top:5px;flex-shrink:0;"></div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;">
              <span style="font-size:15px;font-weight:700;color:#0f172a;">${esc(r.task_name)}</span>
              <span style="font-size:11px;color:#64748b;">${esc(r.category||'')}</span>
            </div>
            <div style="font-size:13px;font-weight:700;color:${pillTxt(p)};margin-top:3px;">${esc(noteText)}</div>
            <div style="margin-top:6px;height:6px;background:#e2e8f0;border-radius:99px;overflow:hidden;">
              <div style="height:100%;width:${barPct}%;background:${barCol};border-radius:99px;"></div>
            </div>
          </div>
          <div style="font-size:18px;color:#94a3b8;flex-shrink:0;" id="${cid}_arr">&#8250;</div>
        </div>
        <div id="${cid}" style="display:none;padding:0 14px 14px 34px;border-top:1px solid ${pillBdr(p)};">
          <div style="margin:10px 0 4px;">
            <button onclick="event.stopPropagation();window._bv2Contributors('${cid}','${esc(r.task_name)}','${esc(recipeId)}')" style="font-size:12px;color:#3b82f6;font-weight:600;background:none;border:none;padding:0;cursor:pointer;display:flex;align-items:center;gap:4px;">
              <span id="${cid}_ctoggle_icon" style="display:inline-block;transition:transform 0.2s;">&#9660;</span>
              Chi scarica questo stock
            </button>
            <div id="${cid}_contrib" style="display:none;margin-top:8px;"></div>
          </div>
          <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin:10px 0 8px;">Perche il bot dice questo</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;">
            ${_bv2Row('Stock DB', fmtN(r.current_stock,r.unit))}
            ${_bv2Row('Giorni da coprire', r.planning_window_days ? r.planning_window_days+'gg' : '—')}
            ${_bv2Row('Fonte giorni', srcLabel)}
            ${_bv2Row('Giorni aperti', r.open_service_days !== null ? String(r.open_service_days) : '—')}
            ${_bv2Row('Consumo / giorno', fmtN(r.consumo_giornaliero,r.unit))}
            ${_bv2Row('Fabbisogno totale', fmtN(r.fabbisogno,r.unit))}
            ${_bv2Row('Delta stock vs fabbisogno', r.delta !== null ? (r.delta>=0?'+':'')+fmtN(Math.abs(r.delta),r.unit) : '—')}
            ${_bv2Row('Suggested qty', r.suggested_qty !== null ? fmtN(r.suggested_qty,r.unit) : '—')}
            ${r.arrival_day ? _bv2Row('Arrivi a', esc(r.arrival_day)) : ''}
          </div>
          ${r.percorso ? `<div style="margin-top:8px;padding:8px 10px;background:rgba(0,0,0,0.04);border-radius:8px;font-size:10px;color:#64748b;line-height:1.5;">${esc(r.percorso)}</div>` : ''}
        </div>
      </div>`;
    }).join('');

    const nowStr = new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
    if(body) body.innerHTML = `
      <div style="font-size:12px;color:#64748b;margin-bottom:12px;padding:8px 10px;background:#f8fafc;border-radius:8px;">
        Bot v2 · <b>${data.sim_date}</b> · ${nowStr} ·
        <span style="color:#ef4444;">&#9679; ${data.red}</span>
        <span style="color:#f59e0b;margin-left:6px;">&#9679; ${data.yellow}</span>
        <span style="color:#22c55e;margin-left:6px;">&#9679; ${data.green}</span>
        <span style="color:#94a3b8;margin-left:6px;">${rows.length} task · Tap per dettaglio</span>
      </div>
      <div>${cards}</div>`;
  } catch(err) {
    if(body) body.innerHTML = `<div style="color:#ef4444;padding:16px;">Errore: ${escHtml(err.message)}</div>`;
  } finally {
    if(btn) { btn.disabled=false; btn.textContent='▶ Calcola Bot v2'; }
  }
};

function _bv2Row(label, value) {
  if(!value||value==='—') return `<div style="padding:3px 0;"><span style="font-size:10px;color:#94a3b8;">${label}</span><div style="font-size:12px;color:#64748b;">—</div></div>`;
  return `<div style="padding:3px 0;"><span style="font-size:10px;color:#94a3b8;">${label}</span><div style="font-size:12px;font-weight:600;color:#1e3a5f;">${value}</div></div>`;
}

window._bv2Toggle = function(id) {
  const el = document.getElementById(id);
  const arr = document.getElementById(id+'_arr');
  if(!el) return;
  const open = el.style.display==='block';
  el.style.display = open?'none':'block';
  if(arr) arr.style.transform = open?'':'rotate(90deg)';
};

window._bv2Contributors = async function(cid, taskName, recipeId) {
  const box = document.getElementById(cid+'_contrib');
  const icon = document.getElementById(cid+'_ctoggle_icon');
  if(!box) return;
  const isOpen = box.style.display === 'block';
  if(isOpen) {
    box.style.display = 'none';
    if(icon) icon.style.transform = '';
    return;
  }
  box.style.display = 'block';
  if(icon) icon.style.transform = 'rotate(180deg)';
  if(box.dataset.loaded) return;
  box.innerHTML = '<div style="font-size:12px;color:#94a3b8;padding:6px 0;">Caricamento...</div>';

  try {
    const SUPA_URL = 'https://ydqmumpytgrlceuinoqt.supabase.co';
    const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlkcW11bXB5dGdybGNldWlub3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxNDM5NzgsImV4cCI6MjA2NDcxOTk3OH0.RB5vYE3gJjH7gJy01Gh-eLQixanVX6cLc0disc8-bJs';
    const hdrs = { 'apikey': ANON_KEY, 'Authorization': 'Bearer '+ANON_KEY };

    // Leggo run corrente per unit e consumo
    const runRes = await fetch(
      SUPA_URL+'/rest/v1/bot_v2_runs?sim_date=eq.'+new Date().toISOString().slice(0,10)+'&task_name=eq.'+encodeURIComponent(taskName)+'&select=unit,consumo_giornaliero',
      {headers: hdrs}
    );
    const runRows = await runRes.json();
    const run = runRows[0];
    const unit = run?.unit || 'g';

    // Leggo aliases diretti dalla recipe collegata al prep_task
    let aliases = [];
    let gPerPorzDirect = 0;
    if(recipeId) {
      const recRes = await fetch(
        SUPA_URL+'/rest/v1/recipes?id=eq.'+encodeURIComponent(recipeId)+'&select=pos_name,serving_weight_g,base_weight_g,base_servings',
        {headers: hdrs}
      );
      const recRows = await recRes.json();
      const rec = recRows[0];
      const posName = rec?.pos_name || '';
      aliases = posName ? posName.split('|').map(s=>s.trim().toLowerCase()).filter(Boolean) : [];
      const sw = parseFloat(rec?.serving_weight_g)||0;
      const bw = parseFloat(rec?.base_weight_g)||0;
      const bs = parseFloat(rec?.base_servings)||1;
      gPerPorzDirect = sw>0?sw:(bw>0&&bs>0?bw/bs:0);
    }

    // Se non ho alias diretti, cerco le ricette padre nel BOM (sub-recipe chain)
    // queste ricette padre hanno il pos_name e tramite BOM consumano questa prep
    let parentRecipes = []; // [{id, pos_name, bom_qty, sw, bw, bs}]
    if(aliases.length === 0 && recipeId) {
      const bomRes = await fetch(
        SUPA_URL+'/rest/v1/recipe_bom?sub_recipe_id=eq.'+encodeURIComponent(recipeId)+'&component_type=eq.RECIPE&select=parent_recipe_id,quantity,unit',
        {headers: hdrs}
      );
      const bomRows = await bomRes.json();
      for(const brow of (bomRows||[])) {
        const prRes = await fetch(
          SUPA_URL+'/rest/v1/recipes?id=eq.'+encodeURIComponent(brow.parent_recipe_id)+'&select=id,pos_name,serving_weight_g,base_weight_g,base_servings',
          {headers: hdrs}
        );
        const prRows = await prRes.json();
        const pr = prRows[0];
        if(pr?.pos_name) {
          parentRecipes.push({
            id: pr.id,
            pos_name: pr.pos_name,
            bom_qty: parseFloat(brow.quantity)||1,
            bom_unit: brow.unit||'',
            sw: parseFloat(pr.serving_weight_g)||0,
            bw: parseFloat(pr.base_weight_g)||0,
            bs: parseFloat(pr.base_servings)||1
          });
        }
      }
    }

    // Date range 60 giorni
    const d60 = new Date(); d60.setDate(d60.getDate()-60);
    const since = d60.toISOString().slice(0,10);

    const fmtG = (v, u) => {
      if(isNaN(v)||v===0) return '0';
      const ul=(u||'').toLowerCase();
      const isPh=['pezzi','pz','nests','buste','cartocci','cup'].includes(ul);
      if(isPh){ return v%1===0?String(Math.round(v)):v.toFixed(1); }
      return v>=1000?(v/1000).toFixed(1).replace(/\.0$/,'')+'kg':Math.round(v)+'g';
    };
    const esc2 = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    let rows = [];

    // helper: media su date
    const avgDates = obj => {
      const vals = Object.values(obj.dates);
      return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
    };

    // Carico sales + modifier una volta sola (servono in entrambi i percorsi)
    const salesRes = await fetch(
      SUPA_URL+'/rest/v1/pos_sales_by_item?sale_date=gte.'+since+'&select=sale_date,menu_item,quantity',
      {headers: hdrs}
    );
    const salesAll = await salesRes.json();

    const modRes = await fetch(
      SUPA_URL+'/rest/v1/pos_modifier_by_item?sale_date=gte.'+since+'&select=sale_date,modifier,parent_item,quantity_sold',
      {headers: hdrs}
    );
    const modAll = await modRes.json();

    const pfRes = await fetch(
      SUPA_URL+'/rest/v1/pos_item_aliases?source=in.(modifier,both)&select=alias_name,portion_factor',
      {headers: hdrs}
    );
    const pfAll = await pfRes.json();
    const pfMap = {};
    (pfAll||[]).forEach(a => { pfMap[(a.alias_name||'').toLowerCase().trim()] = parseFloat(a.portion_factor)||1.0; });

    // Funzione per costruire righe dato un set di alias e g/porzione
    const buildRows = (aliasSet, gPerPorz, labelPrefix) => {
      const directByItem = {};
      (salesAll||[]).forEach(row => {
        if(!aliasSet.has((row.menu_item||'').toLowerCase().trim())) return;
        const k = row.menu_item;
        if(!directByItem[k]) directByItem[k] = {dates:{}};
        if(!directByItem[k].dates[row.sale_date]) directByItem[k].dates[row.sale_date] = 0;
        directByItem[k].dates[row.sale_date] += parseFloat(row.quantity)||0;
      });
      const modByKey = {};
      (modAll||[]).forEach(row => {
        const mk = (row.modifier||'').toLowerCase().trim();
        if(!aliasSet.has(mk)) return;
        const pf = pfMap[mk] || 1.0;
        const k = (row.modifier||'')+'|'+(row.parent_item||'');
        if(!modByKey[k]) modByKey[k] = {modifier: row.modifier, parent: row.parent_item, pf, dates:{}};
        if(!modByKey[k].dates[row.sale_date]) modByKey[k].dates[row.sale_date] = 0;
        modByKey[k].dates[row.sale_date] += (row.quantity_sold||0) * pf;
      });
      const out = [];
      Object.entries(directByItem).forEach(([item, obj]) => {
        const avgPorz = avgDates(obj);
        const avgG = gPerPorz>0 ? avgPorz*gPerPorz : avgPorz;
        if(avgG > 0) out.push({label: esc2(labelPrefix||item), sub: esc2(labelPrefix?item:'Vendita diretta'), type:'direct', avgPorz, avgG, pf:1});
      });
      const modByMod = {};
      Object.entries(modByKey).forEach(([k, obj]) => {
        const modName = obj.modifier;
        if(!modByMod[modName]) modByMod[modName] = {parents:[], totalAvgPorz:0, pf: obj.pf};
        modByMod[modName].parents.push(esc2(obj.parent));
        modByMod[modName].totalAvgPorz += avgDates(obj);
      });
      Object.entries(modByMod).forEach(([mod, obj]) => {
        const avgG = gPerPorz>0 ? obj.totalAvgPorz*gPerPorz : obj.totalAvgPorz;
        if(avgG > 0) {
          const parentList = [...new Set(obj.parents)].slice(0,3).join(', ');
          const sub = (labelPrefix?esc2(labelPrefix)+' — ':'')+esc2(mod)+' su: '+parentList+(obj.parents.length>3?' +altri':'');
          out.push({label: esc2(labelPrefix||mod), sub, type:'modifier', avgPorz: obj.totalAvgPorz, avgG, pf: obj.pf});
        }
      });
      return out;
    };

    if(aliases.length > 0) {
      // Percorso diretto: questa prep ha pos_name proprio
      const aliasSet = new Set(aliases);
      rows = buildRows(aliasSet, gPerPorzDirect, '');
    } else if(parentRecipes.length > 0) {
      // Percorso sub-recipe: itero le ricette padre e uso i loro alias
      for(const pr of parentRecipes) {
        const parentAliases = pr.pos_name.split('|').map(s=>s.trim().toLowerCase()).filter(Boolean);
        const parentAliasSet = new Set(parentAliases);
        // g/porzione di QUESTA prep consumata da ogni porzione della ricetta padre = bom_qty
        const gPerPorzParent = pr.bom_qty;
        const prRows = buildRows(parentAliasSet, gPerPorzParent, pr.pos_name.split('|')[0]);
        rows = rows.concat(prRows);
      }
    }

    // Render
    if(rows.length === 0) {
      box.innerHTML = '<div style="font-size:12px;color:#94a3b8;padding:6px 0;">Nessuna fonte trovata nei dati POS.</div>';
      box.dataset.loaded = '1';
      return;
    }

    const totalG = rows.reduce((s,r) => s+r.avgG, 0);

    let html = '<div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Media/giorno negli ultimi 60 giorni</div>';
    rows.sort((a,b) => b.avgG - a.avgG).forEach(row => {
      const isM = row.type==='modifier';
      const bg = isM?'#eff6ff':'#f8fafc';
      const tagBg = isM?'#dbeafe':'#dcfce7';
      const tagCol = isM?'#2563eb':'#16a34a';
      const tagTxt = isM?'MOD':'MAIN';
      const gStr = fmtG(row.avgG, unit);
      const porzStr = row.avgPorz>0?(row.avgPorz%1===0?Math.round(row.avgPorz):row.avgPorz.toFixed(1))+' porz':null;
      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border-radius:8px;background:'+bg+';margin-bottom:3px;">'
        +'<div style="min-width:0;flex:1;">'
        +'<div style="display:flex;align-items:center;gap:5px;"><span style="font-size:12px;font-weight:600;color:#1e3a5f;">'+row.label+'</span>'
        +'<span style="font-size:9px;background:'+tagBg+';color:'+tagCol+';border-radius:3px;padding:1px 4px;font-weight:700;">'+tagTxt+'</span></div>'
        +'<div style="font-size:10px;color:#94a3b8;">'+esc2(row.sub)+(isM&&row.pf!==1?' \u00b7 \u00d7'+row.pf:'')+'</div>'
        +'</div>'
        +'<div style="text-align:right;flex-shrink:0;margin-left:8px;">'
        +(porzStr?'<div style="font-size:10px;color:#64748b;">~'+porzStr+'</div>':'')
        +'<div style="font-size:13px;font-weight:700;color:'+(isM?'#2563eb':'#1e3a5f')+';">'+gStr+'</div>'
        +'</div>'
        +'</div>';
    });

    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px 0;border-top:1px dashed #e2e8f0;margin-top:4px;">'
      +'<span style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;">Totale / giorno</span>'
      +'<span style="font-size:14px;font-weight:800;color:#1e3a5f;">'+fmtG(totalG,unit)+'</span>'
      +'</div>';

    box.innerHTML = html;
    box.dataset.loaded = '1';
  } catch(e) {
    box.innerHTML = '<div style="font-size:11px;color:#ef4444;">Errore: '+e.message+'</div>';
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



