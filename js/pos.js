// ── POS Analytics ──────────────────────────────────────────────────
let posDateMode = 'day_0';
let posCustomFrom = null;
let posCustomTo   = null;

function toISO(d) { return d.toISOString().slice(0,10); }
function addDays(d,n) { const r=new Date(d); r.setDate(r.getDate()+n); return r; }
function dayNameIT(iso) {
  return ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'][new Date(iso+'T12:00:00').getDay()];
}
function fmt(n)  { return '$'+Number(n).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}); }
function fmtD(n) { return '$'+Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }

function getPeriod(mode) {
  const today = new Date(); today.setHours(0,0,0,0);
  const todayISO = toISO(today);
  const dow = today.getDay();

  // day_0 = ieri, day_1 = 2 giorni fa, ... day_5 = 6 giorni fa
  if (mode && mode.startsWith('day_')) {
    const offset = parseInt(mode.split('_')[1]) + 1;
    const d = addDays(today, -offset);
    const dISO = toISO(d);
    const cmp = [];
    for (let w=1; w<=12 && cmp.length<8; w++) cmp.push(toISO(addDays(d,-7*w)));
    return { from:dISO, to:dISO, label:dayNameIT(dISO)+' '+dISO.slice(5), compareLabel:'Avg '+dayNameIT(dISO), compareDates:cmp, singleDay:true };
  }
  if (mode === 'weekend') {
    const lastFri = addDays(today,-(((dow+2)%7)+1));
    const lastSun = addDays(lastFri,2);
    const cmp = [];
    for (let w=1; w<=8; w++) {
      cmp.push(toISO(addDays(lastFri,-7*w)));
      cmp.push(toISO(addDays(lastFri,-7*w+1)));
      cmp.push(toISO(addDays(lastFri,-7*w+2)));
    }
    return { from:toISO(lastFri), to:toISO(lastSun), label:'Weekend '+toISO(lastFri).slice(5)+'-'+toISO(lastSun).slice(5), compareLabel:'Avg weekend', compareDates:cmp };
  }
  if (mode === 'lastweek') {
    // Lunedì-Sabato della settimana scorsa
    const dayOfWeek = today.getDay(); // 0=Dom, 1=Lun...
    const daysToLastMon = dayOfWeek === 0 ? 6 : dayOfWeek + 6;
    const lastMon = addDays(today, -daysToLastMon);
    const lastSat = addDays(lastMon, 5);
    return { from:toISO(lastMon), to:toISO(lastSat), label:'Last week ('+toISO(lastMon).slice(5)+' – '+toISO(lastSat).slice(5)+')', compareDates:[] };
  }
  if (mode === 'week')  return { from:toISO(addDays(today,-6)), to:todayISO, label:'Ultimi 7 giorni', compareDates:[] };
  if (mode === 'month') return { from:toISO(addDays(today,-29)), to:todayISO, label:'Ultimi 30 giorni', compareDates:[] };
  if (mode === 'custom' && posCustomFrom && posCustomTo) {
    const label = posCustomFrom === posCustomTo
      ? dayNameIT(posCustomFrom)+' '+posCustomFrom.slice(5)
      : posCustomFrom.slice(5)+' - '+posCustomTo.slice(5);
    return { from:posCustomFrom, to:posCustomTo, label, compareDates:[], singleDay: posCustomFrom === posCustomTo };
  }
  return { from:toISO(addDays(today,-1)), to:toISO(addDays(today,-1)), label:'Ieri', compareDates:[], singleDay:true };
}

function posSelectors(period) {
  const today = new Date(); today.setHours(0,0,0,0);

  // 6 giorni precedenti: ieri -> 6 giorni fa
  const dayTabs = Array.from({length:6}, function(_,i) {
    const d = addDays(today, -(i+1));
    const iso = toISO(d);
    const short = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'][d.getDay()];
    return { mode:'day_'+i, label:short+' '+iso.slice(8) };
  });

  const fixedTabs = [
    { mode:'weekend',  label:'Weekend' },
    { mode:'lastweek', label:'Last week' },
    { mode:'month',    label:'30 days' },
    { mode:'custom',   label:'📅' },
  ];

  const row1 = dayTabs.map(function(t) {
    const a = posDateMode === t.mode;
    const d = addDays(today, -(parseInt(t.mode.split('_')[1])+1));
    const num = toISO(d).slice(8);
    const dayName = t.label.replace(/\s*\d+/,''); // solo nome giorno
    return '<button onclick="posSetMode(\'' + t.mode + '\')"' +
      ' style="flex:1;border-radius:12px;border:0.5px solid ' + (a?'#2563eb':'rgba(59,130,246,0.15)') + ';' +
      'background:' + (a?'#3b82f6':'white') + ';' +
      'box-shadow:0 2px 6px rgba(30,58,95,' + (a?'0.2':'0.07') + ');' +
      'cursor:pointer;padding:8px 2px;text-align:center;-webkit-tap-highlight-color:transparent;">' +
      '<div style="font-size:9px;font-weight:500;color:' + (a?'rgba(255,255,255,0.8)':'#94a3b8') + ';line-height:1.2;">' + (t.mode==='day_0'?'Yest.':dayName) + '</div>' +
      '<div style="font-size:14px;font-weight:700;color:' + (a?'white':'#1e3a5f') + ';line-height:1.3;">' + num + '</div>' +
      '</button>';
  }).join('');

  const row2 = fixedTabs.map(function(t) {
    const a = posDateMode === t.mode;
    return '<button onclick="posSetMode(\'' + t.mode + '\')"' +
      ' style="flex:1;font-size:12px;font-weight:600;padding:11px 4px;border-radius:12px;' +
      'border:0.5px solid ' + (a?'#2563eb':'rgba(59,130,246,0.15)') + ';' +
      'background:' + (a?'#3b82f6':'white') + ';' +
      'color:' + (a?'white':'#1e3a5f') + ';' +
      'box-shadow:0 2px 6px rgba(30,58,95,' + (a?'0.2':'0.07') + ');' +
      'cursor:pointer;text-align:center;-webkit-tap-highlight-color:transparent;">' +
      t.label + '</button>';
  }).join('');

  const customPicker = posDateMode === 'custom' ? (
    '<div style="display:flex;gap:8px;margin-top:10px;align-items:center;">' +
    '<div style="display:flex;align-items:center;gap:6px;flex:1;">' +
    '<span style="font-size:11px;color:#64748b;">Dal</span>' +
    '<input type="date" id="_posFrom" value="' + (posCustomFrom||'') + '"' +
    ' style="flex:1;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;color:#1e293b;"' +
    ' onchange="posCustomFrom=this.value;if(posCustomTo&&posCustomFrom)loadPOS();">' +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:6px;flex:1;">' +
    '<span style="font-size:11px;color:#64748b;">Al</span>' +
    '<input type="date" id="_posTo" value="' + (posCustomTo||'') + '"' +
    ' style="flex:1;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;color:#1e293b;"' +
    ' onchange="posCustomTo=this.value;if(posCustomFrom&&posCustomTo)loadPOS();">' +
    '</div>' +
    '</div>'
  ) : '';

  return '<div style="background:white;border-radius:16px;border:0.5px solid rgba(59,130,246,0.1);box-shadow:0 2px 8px rgba(30,58,95,0.07);padding:10px 10px 10px;margin-bottom:10px;">' +
           '<div style="font-size:10px;font-weight:600;color:#60a5fa;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">Recent days</div>' +
           '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:5px;">' + row1 + '</div>' +
           '</div>' +
           '<div style="background:white;border-radius:16px;border:0.5px solid rgba(59,130,246,0.1);box-shadow:0 2px 8px rgba(30,58,95,0.07);padding:10px;margin-bottom:10px;">' +
           '<div style="font-size:10px;font-weight:600;color:#60a5fa;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">Periods</div>' +
           '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 44px;gap:6px;">' + row2 + '</div>' +
           '</div>' +
           customPicker;
}

async function loadPOS() {
  const sec = document.getElementById('vx');
  if (!sec || sec.classList.contains('hidden')) return;
  sec.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:200px;color:#94a3b8;font-size:13px;">Caricamento…</div>';

  try {
    const sb = window.supabaseClient;
    const period = getPeriod(posDateMode);

    const { data: days } = await sb.from('pos_daily_summary')
      .select('*').gte('sale_date',period.from).lte('sale_date',period.to)
      .order('sale_date',{ascending:false});

    let compareDays = [];
    if (period.compareDates && period.compareDates.length > 0) {
      const { data: cd } = await sb.from('pos_daily_summary').select('*').in('sale_date',period.compareDates);
      compareDays = cd || [];
    }

    const { data: items } = await sb.from('pos_sales_by_item')
      .select('menu_item,sales_category,menu_group,quantity,gross_sales,net_sales')
      .gte('sale_date',period.from).lte('sale_date',period.to).eq('is_historical',false);

    const d = days || [];

    // ── Empty state
    if (d.length === 0) {
      const msgs = {
        today:    '📭 Nessun dato per oggi.<br><small style="color:#94a3b8">I CSV arrivano via email la mattina seguente.</small>',
        yesterday:'📭 Nessun dato per ieri.<br><small style="color:#94a3b8">Possibile giorno di chiusura o CSV non ancora arrivato.</small>',
        weekend:  '📭 Nessun dato per il weekend scorso.<br><small style="color:#94a3b8">I CSV arrivano il lunedì mattina.</small>',
        week:     '📭 Nessun dato per gli ultimi 7 giorni.',
        month:    '📭 Nessun dato per gli ultimi 30 giorni.',
      };
      sec.innerHTML = `<div style="padding:12px;">
        <div style="display:flex;gap:6px;margin-bottom:12px;">${posSelectors(period)}</div>
        <p style="font-size:11px;color:#64748b;font-weight:500;margin-bottom:16px;">${period.label}</p>
        <div style="background:rgba(255,255,255,0.7);border-radius:16px;padding:40px 20px;text-align:center;font-size:13px;color:#475569;line-height:1.6;">
          ${msgs[posDateMode]||'Nessun dato per questo periodo.'}
        </div>
      </div>`;
      return;
    }

    // ── Aggregate
    const totalRevenue  = d.reduce((s,x)=>s+(x.net_sales||0),0);
    const totalCovers   = d.reduce((s,x)=>s+(x.bill_count||0),0);
    const totalDisc     = d.reduce((s,x)=>s+(x.discounts||0),0);
    const totalFoodCost = d.reduce((s,x)=>s+(x.food_cost||0),0);
    const avgCheck      = totalCovers>0 ? totalRevenue/totalCovers : 0;
    const foodCostPct   = totalRevenue>0 ? (totalFoodCost/totalRevenue)*100 : 0;
    const nDays         = d.length||1;

    // ── Compare block
    let cmpHtml = '';
    if (compareDays.length > 0) {
      const div = period.singleDay ? compareDays.length : Math.max(compareDays.length/3,1);
      const cRev = compareDays.reduce((s,x)=>s+(x.net_sales||0),0)/div;
      const cCov = compareDays.reduce((s,x)=>s+(x.bill_count||0),0)/div;
      const cChk = cCov>0 ? cRev/cCov : 0;
      const cFcP = cRev>0 ? (compareDays.reduce((s,x)=>s+(x.food_cost||0),0)/div/cRev)*100 : 0;
      const arrow = (cur,ref) => ref>0 ? ((cur-ref)/ref*100) : null;
      const arrowHtml = (v) => v===null ? '' : `<span style="font-size:10px;color:${v>=0?'#059669':'#dc2626'};">${v>=0?'▲':'▼'} ${Math.abs(v).toFixed(0)}%</span>`;
      cmpHtml = `<div style="background:rgba(255,255,255,0.7);border-radius:16px;padding:14px 16px;">
        <p style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;font-weight:600;margin-bottom:10px;">${period.compareLabel} · ${compareDays.length} date</p>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center;">
          <div><p style="font-size:9px;color:#94a3b8;">Revenue avg</p><p style="font-size:14px;font-weight:700;color:#475569;">${fmt(cRev)}</p>${arrowHtml(arrow(totalRevenue,cRev))}</div>
          <div><p style="font-size:9px;color:#94a3b8;">Coperti avg</p><p style="font-size:14px;font-weight:700;color:#475569;">${Math.round(cCov)}</p>${arrowHtml(arrow(totalCovers,cCov))}</div>
          <div><p style="font-size:9px;color:#94a3b8;">Check avg</p><p style="font-size:14px;font-weight:700;color:#475569;">${fmtD(cChk)}</p></div>
        </div>
        <p style="font-size:10px;color:#94a3b8;text-align:center;margin-top:8px;">Food cost avg: ${cFcP.toFixed(1)}%</p>
      </div>`;
    }

    // ── Top sellers
    const itemMap = {};
    (items||[]).forEach(r => {
      if (!itemMap[r.menu_item]) itemMap[r.menu_item]={name:r.menu_item,cat:r.sales_category,qty:0,rev:0};
      itemMap[r.menu_item].qty += Number(r.quantity)||0;
      itemMap[r.menu_item].rev += Number(r.gross_sales)||0;
    });
    const topItems = Object.values(itemMap).filter(x=>x.rev>0).sort((a,b)=>b.rev-a.rev).slice(0,10);
    const catColors = {Food:'#059669',Alcohol:'#7c3aed',Wine:'#dc2626',Beer:'#d97706'};

    // ── Category
    const catMap = {};
    (items||[]).forEach(r => { const c=r.sales_category||'Other'; catMap[c]=(catMap[c]||0)+(Number(r.gross_sales)||0); });
    const cats = Object.entries(catMap).sort((a,b)=>b[1]-a[1]);

    // ── Trend bars
    let trendHtml = '';
    if (['week','month','weekend'].includes(posDateMode) && d.length>1) {
      const sorted = [...d].sort((a,b)=>a.sale_date.localeCompare(b.sale_date));
      const maxR = Math.max(...sorted.map(x=>x.net_sales||0));
      trendHtml = `<div style="background:rgba(255,255,255,0.7);border-radius:16px;padding:14px 16px;">
        <p style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;font-weight:600;margin-bottom:10px;">Andamento Revenue</p>
        <div style="display:flex;align-items:flex-end;gap:3px;height:64px;">
          ${sorted.map(x=>{
            const h=maxR>0?Math.round(((x.net_sales||0)/maxR)*60):3;
            return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;">
              <div style="height:${h}px;background:#059669;border-radius:2px 2px 0 0;width:100%;min-height:2px;"></div>
              <span style="font-size:7px;color:#94a3b8;">${x.sale_date.slice(5)}</span>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }

    // ── Build HTML
    sec.innerHTML = `<div style="padding:12px 12px 100px;">

      <div style="display:flex;gap:6px;margin-bottom:12px;">${posSelectors(period)}</div>
      <p style="font-size:11px;color:#64748b;font-weight:500;margin-bottom:12px;">${period.label}</p>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
        <div style="background:rgba(255,255,255,0.7);border-radius:16px;padding:12px;">
          <p style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;">Revenue netto</p>
          <p style="font-size:22px;font-weight:700;color:#059669;">${fmt(totalRevenue)}</p>
          ${nDays>1?`<p style="font-size:10px;color:#94a3b8;">avg/gg ${fmt(totalRevenue/nDays)}</p>`:''}
        </div>
        <div style="background:rgba(255,255,255,0.7);border-radius:16px;padding:12px;">
          <p style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;">Coperti</p>
          <p style="font-size:22px;font-weight:700;color:#1e293b;">${totalCovers}</p>
          <p style="font-size:10px;color:#94a3b8;">check ${fmtD(avgCheck)}</p>
        </div>
        <div style="background:rgba(255,255,255,0.7);border-radius:16px;padding:12px;">
          <p style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;">Food cost</p>
          <p style="font-size:22px;font-weight:700;color:${foodCostPct>35?'#dc2626':'#1e293b'};">${foodCostPct.toFixed(1)}%</p>
          <p style="font-size:10px;color:#94a3b8;">${fmt(totalFoodCost)}</p>
        </div>
        <div style="background:rgba(255,255,255,0.7);border-radius:16px;padding:12px;">
          <p style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;">Sconti</p>
          <p style="font-size:22px;font-weight:700;color:#d97706;">${fmt(totalDisc)}</p>
          <p style="font-size:10px;color:#94a3b8;">${totalRevenue>0?((totalDisc/(totalRevenue+totalDisc))*100).toFixed(1)+'%':'—'} del lordo</p>
        </div>
      </div>

      ${cmpHtml ? cmpHtml+'<div style="height:8px;"></div>' : ''}
      ${trendHtml ? trendHtml+'<div style="height:8px;"></div>' : ''}

      ${topItems.length>0?`<div style="background:rgba(255,255,255,0.7);border-radius:16px;padding:14px 16px;margin-bottom:8px;">
        <p style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;font-weight:600;margin-bottom:10px;">Top 10 per Revenue</p>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${topItems.map((it,i)=>{
            const bw=topItems[0].rev>0?Math.round((it.rev/topItems[0].rev)*100):0;
            const col=catColors[it.cat]||'#64748b';
            return `<div>
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px;">
                <span style="font-size:12px;font-weight:500;color:#1e293b;max-width:62%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${i+1}. ${it.name}</span>
                <span style="font-size:12px;font-weight:700;color:#1e293b;">${fmt(it.rev)}</span>
              </div>
              <div style="display:flex;align-items:center;gap:8px;">
                <div style="flex:1;height:4px;background:#f1f5f9;border-radius:2px;overflow:hidden;">
                  <div style="width:${bw}%;height:100%;background:${col};border-radius:2px;"></div>
                </div>
                <span style="font-size:10px;color:#94a3b8;width:32px;text-align:right;">${it.qty}x</span>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>`:''}

      ${cats.length>0?`<div style="background:rgba(255,255,255,0.7);border-radius:16px;padding:14px 16px;margin-bottom:8px;">
        <p style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;font-weight:600;margin-bottom:10px;">Per categoria</p>
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${cats.map(([cat,rev])=>{
            const col=catColors[cat]||'#64748b';
            const pct=totalRevenue>0?((rev/totalRevenue)*100).toFixed(1):0;
            return `<div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:10px;color:#64748b;width:52px;flex-shrink:0;">${cat}</span>
              <div style="flex:1;height:6px;background:#f1f5f9;border-radius:3px;overflow:hidden;">
                <div style="width:${pct}%;height:100%;background:${col};border-radius:3px;"></div>
              </div>
              <span style="font-size:11px;font-weight:600;color:#1e293b;width:52px;text-align:right;">${fmt(rev)}</span>
            </div>`;
          }).join('')}
        </div>
      </div>`:''}

      ${d.length>0?`<div style="background:rgba(255,255,255,0.7);border-radius:16px;padding:14px 16px;">
        <p style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;font-weight:600;margin-bottom:10px;">Giornate</p>
        <div>
          ${d.map(x=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f8fafc;">
            <div>
              <p style="font-size:12px;font-weight:500;color:#1e293b;">${dayNameIT(x.sale_date)} ${x.sale_date.slice(5)}</p>
              <p style="font-size:10px;color:#94a3b8;">${x.bill_count||'—'} cop · check ${x.bill_count?fmtD((x.net_sales||0)/x.bill_count):'—'}</p>
            </div>
            <p style="font-size:15px;font-weight:700;color:#059669;">${fmt(x.net_sales||0)}</p>
          </div>`).join('')}
        </div>
      </div>`:''}

    </div>`;

  } catch(err) {
    console.error('POS error:',err);
    document.getElementById('vx').innerHTML = `<div style="padding:16px;color:#dc2626;font-size:13px;">Errore: ${err.message}</div>`;
  }
}

function posSetMode(m) {
  posDateMode = m;
  loadPOS();
}
