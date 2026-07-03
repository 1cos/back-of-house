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

  // Sheet di caricamento
  const sheet = document.createElement('div');
  sheet.id = 'botDebugSheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:70;background:rgba(15,23,42,0.5);overflow-y:auto;';
  sheet.innerHTML = `<div style="min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:16px 8px 40px;">
    <div style="background:#fff;border-radius:20px;width:100%;max-width:900px;padding:20px 16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <span style="font-size:17px;font-weight:700;color:#1e3a5f;">🤖 Bot Debug</span>
        <button onclick="document.getElementById('botDebugSheet').remove()" style="font-size:22px;background:none;border:none;color:#94a3b8;">✕</button>
      </div>
      <div id="botDebugBody" style="color:#64748b;font-size:14px;">Caricamento...</div>
    </div>
  </div>`;
  sheet.addEventListener('click', e => { if(e.target===sheet) sheet.remove(); });
  document.body.appendChild(sheet);

  try {
    // ── Dati necessari ──────────────────────────────────────────
    const today = new Date();
    // offset CDT (UTC-5)
    const nowCDT = new Date(today.getTime() - 5*60*60*1000);
    const toISO = d => d.toISOString().slice(0,10);
    const yesterday = new Date(nowCDT); yesterday.setDate(yesterday.getDate()-1);

    const DOW_IT  = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];
    const DOW_EN  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const BUFFER  = 1.10;

    // Fetch parallelo
    const [tasksRes, salesYRes, salesAvgRes, closedRes] = await Promise.all([
      supa.from('prep_tasks')
        .select('id,name,category,unit,current_stock,min_cover_days,expected_duration_days,recipe_id,recipes:recipe_id(title,pos_name,base_servings,base_weight_g,serving_qty,serving_unit,serving_weight_g,shelf_life_days)')
        .eq('archived', false)
        .neq('prep_type', 'checklist'),
      supa.from('pos_sales_by_item').select('menu_item,quantity').eq('sale_date', toISO(yesterday)),
      supa.rpc('get_sales_by_dow', {
        start_date: toISO(new Date(nowCDT.getTime() - 90*24*60*60*1000)),
        end_date: toISO(nowCDT)
      }),
      supa.from('closed_dates').select('date')
        .gte('date', toISO(nowCDT))
        .lte('date', toISO(new Date(nowCDT.getTime() + 30*24*60*60*1000)))
    ]);

    const tasks   = (tasksRes.data || []).filter(t => t.current_stock !== null && t.current_stock !== undefined);
    const closedDates = new Set((closedRes.data||[]).map(r => r.date));

    // yMap: vendite ieri
    const yMap = {};
    for(const s of (salesYRes.data||[])){
      const k=(s.menu_item||'').toLowerCase().trim();
      yMap[k]=(yMap[k]||0)+(parseFloat(s.quantity)||0);
    }

    // salesMap: medie per DOW
    const salesMap = {};
    for(const r of (salesAvgRes.data||[])){
      const k=(r.menu_item||'').toLowerCase().trim();
      if(!salesMap[k])salesMap[k]={};
      salesMap[k][r.dow_name]=parseFloat(r.avg_qty)||0;
    }
    const avgForDow = (pn, dow) => salesMap[pn.toLowerCase().trim()]?.[dow]||0;

    // Helpers
    const calDays = (from, n) => {
      const days=[]; const d=new Date(from);
      for(let i=0;i<n;i++){days.push(new Date(d));d.setDate(d.getDate()+1);}
      return days;
    };
    const fmtN = n => isNaN(n)||n===null?'—':Number.isInteger(n)?String(n):parseFloat(n.toFixed(2)).toString();
    const PZ_UNITS = ['pezzi','pz'];

    // ── Costruisci righe ────────────────────────────────────────
    const rows = [];
    for(const task of tasks){
      const rec = task.recipes;
      const pns = rec?.pos_name ? rec.pos_name.split('|').map(x=>x.trim()).filter(Boolean) : [];
      const tu  = (task.unit||'').toLowerCase().trim();
      const isPz = PZ_UNITS.includes(tu);
      const bs  = rec?.base_servings ? parseInt(rec.base_servings) : null;
      const bw  = rec?.base_weight_g ? parseFloat(rec.base_weight_g) : null;
      const sq  = rec?.serving_qty   ? parseFloat(rec.serving_qty)   : null;
      const sw  = rec?.serving_weight_g ? parseFloat(rec.serving_weight_g) : null;
      const stock = parseFloat(String(task.current_stock))||0;

      // Shelf life
      let sl = task.expected_duration_days||0;
      if(!sl) sl = rec?.shelf_life_days||3;

      // Venduto ieri
      let vendutoIeri = 0;
      for(const pn of pns){
        const sold = yMap[pn.toLowerCase().trim()]||0;
        if(sold>0){
          if(isPz&&sq&&sq>0) vendutoIeri+=sold*sq;
          else if(isPz&&bs&&bs>1) vendutoIeri+=sold/bs;
          else if(sw&&sw>0) vendutoIeri+=sold*sw;
          else if(bw&&bs&&bs>0) vendutoIeri+=sold*(bw/bs);
          else vendutoIeri+=sold;
        }
      }
      if(isPz) vendutoIeri = Math.ceil(vendutoIeri);

      // Stock presunto dopo scarico
      const stockPresunto = Math.max(0, stock - vendutoIeri);

      // cPerDow per ogni giorno
      const cPerDow = (dow, date) => {
        if(dow==='Sunday') return 0;
        if(closedDates.has(toISO(date))) return 0;
        let c=0;
        for(const pn of pns){
          const avg=avgForDow(pn,dow);
          if(avg>0){
            if(isPz&&sq&&sq>0) c+=avg*sq;
            else if(isPz&&bs&&bs>1) c+=avg/bs;
            else if(sw&&sw>0) c+=avg*sw;
            else if(bw&&bs&&bs>0) c+=avg*(bw/bs);
            else c+=avg;
          }
        }
        return c * BUFFER;
      };

      // coverDays = giorni aperti dentro finestra sl calendar days
      const shelfWindow = calDays(nowCDT, sl);
      const coverDays = shelfWindow.filter(d=>d.getDay()!==0&&!closedDates.has(toISO(d)));

      // Logica copertura (usa stock presunto)
      let remaining = stockPresunto;
      let coverLog = [];
      for(const d of shelfWindow){
        const dow = DOW_EN[d.getDay()];
        const cons = cPerDow(dow, d);
        const isOpen = d.getDay()!==0 && !closedDates.has(toISO(d));
        const label = DOW_IT[d.getDay()]+' '+d.getDate()+'/'+String(d.getMonth()+1).padStart(2,'0');
        if(!isOpen){
          coverLog.push(`${label}: chiuso`);
        } else {
          remaining -= cons;
          const ok = remaining > 0;
          coverLog.push(`${label}: -${fmtN(cons)} → ${fmtN(Math.max(0,remaining))} ${ok?'✓':'✗ ESAURITO'}`);
        }
      }

      // fabbisogno
      const totalForCover = coverDays.reduce((s,d)=>s+cPerDow(DOW_EN[d.getDay()],d),0);
      const needed = Math.max(0, totalForCover - stockPresunto);

      // pill
      const hasDOWdata = coverDays.some(d=>cPerDow(DOW_EN[d.getDay()],d)>0);
      let pill;
      if(stockPresunto <= 0 && hasDOWdata) pill='🔴';
      else if(needed > 0 && hasDOWdata) pill='🔴';
      else if(!hasDOWdata && stockPresunto<=0) pill='🔴';
      else pill='🟢';

      // suggestion
      let fin = needed;
      if(isPz){ fin=Math.ceil(needed); if(bs&&bs>1) fin=Math.ceil(needed/bs)*bs; }
      else if(bw&&bw>0) fin=Math.ceil(needed/bw)*bw;
      else fin=Math.ceil(needed);

      rows.push({
        name: task.name,
        cat: task.category||'',
        stock: fmtN(stock),
        vendutoIeri: fmtN(vendutoIeri),
        stockPresunto: fmtN(stockPresunto),
        sl,
        coverDays: coverDays.length,
        fabbisogno: fmtN(totalForCover),
        suggestion: fin>0 ? fmtN(fin)+' '+tu : '—',
        pill,
        logicaEsplosa: coverLog.join('<br>'),
        logicaSugg: fin>0
          ? `${hasDOWdata?'storico DOW':'no dati'} · finestra ${sl}gg cal · ${coverDays.length} giorni aperti · fabb ${fmtN(totalForCover)} · stock ${fmtN(stockPresunto)} → mancano ${fmtN(needed)}`
          : `stock presunto ${fmtN(stockPresunto)} copre i ${coverDays.length} giorni aperti`
      });
    }

    // Ordina: rossi prima, poi per nome
    rows.sort((a,b)=>(a.pill===b.pill?a.name.localeCompare(b.name):a.pill==='🔴'?-1:1));

    // ── Render tabella ──────────────────────────────────────────
    const tdS = 'padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;vertical-align:top;white-space:nowrap;';
    const thS = 'padding:8px;background:#f8fafc;font-size:11px;font-weight:700;color:#64748b;text-align:left;border-bottom:2px solid #e2e8f0;white-space:nowrap;';

    const thead = `<tr>
      <th style="${thS}">Prep</th>
      <th style="${thS}">Stock</th>
      <th style="${thS}">Venduto ieri</th>
      <th style="${thS}">Stock presunto</th>
      <th style="${thS}">Logica copertura (${sl_placeholder}gg cal)</th>
      <th style="${thS}">Suggestion</th>
      <th style="${thS}">Perché</th>
    </tr>`.replace('${sl_placeholder}','sl');

    const tbody = rows.map(r=>`<tr style="${r.pill==='🔴'?'background:#fff5f5;':''}">
      <td style="${tdS}font-weight:600;color:#1e3a5f;">${r.pill} ${escHtml(r.name)}<br><span style="font-size:10px;color:#94a3b8;">${escHtml(r.cat)}</span></td>
      <td style="${tdS}text-align:right;">${r.stock} ${escHtml(r.stock!=='—'?r.cat.includes('g')?'':'':'')}</td>
      <td style="${tdS}text-align:right;color:#dc2626;">${r.vendutoIeri!=='0'&&r.vendutoIeri!=='—'?'-'+r.vendutoIeri:'—'}</td>
      <td style="${tdS}text-align:right;font-weight:600;">${r.stockPresunto}</td>
      <td style="${tdS}font-size:11px;color:#475569;white-space:normal;min-width:180px;">${r.logicaEsplosa}</td>
      <td style="${tdS}font-weight:700;color:${r.pill==='🔴'?'#dc2626':'#059669'};">${escHtml(r.suggestion)}</td>
      <td style="${tdS}font-size:11px;color:#64748b;white-space:normal;min-width:200px;">${escHtml(r.logicaSugg)}</td>
    </tr>`).join('');

    const ieri = yesterday.toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long'});

    document.getElementById('botDebugBody').innerHTML = `
      <div style="font-size:12px;color:#64748b;margin-bottom:12px;">
        Simulazione bot per <b>oggi ${nowCDT.toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long'})}</b> ·
        Venduto ieri: <b>${ieri}</b> · Buffer +10%
      </div>
      <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
        <table style="width:100%;border-collapse:collapse;min-width:700px;">
          <thead>${thead}</thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>
      <div style="margin-top:12px;font-size:11px;color:#94a3b8;">
        Stock presunto = stock attuale − venduto ieri (scarico che il bot fa stanotte) ·
        Logica copertura = simulazione giorno per giorno dentro la finestra shelf life in calendar days
      </div>`;

  } catch(err) {
    document.getElementById('botDebugBody').innerHTML =
      `<div style="color:#ef4444;">Errore: ${err.message}</div>`;
  }
};
