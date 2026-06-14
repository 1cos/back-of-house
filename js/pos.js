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
    const dayOfWeek = today.getDay();
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
    const dayName = t.label.replace(/\s*\d+/,'');
    return '<button onclick="posSetMode(\'' + t.mode + '\')"' +
      ' style="flex:1;border-radius:10px;border:0.5px solid ' + (a?'#2563eb':'rgba(59,130,246,0.15)') + ';' +
      'background:' + (a?'#3b82f6':'white') + ';' +
      'box-shadow:0 1px 4px rgba(30,58,95,' + (a?'0.18':'0.05') + ');' +
      'cursor:pointer;padding:5px 2px;text-align:center;-webkit-tap-highlight-color:transparent;">' +
      '<div style="font-size:9px;font-weight:500;color:' + (a?'rgba(255,255,255,0.8)':'#94a3b8') + ';line-height:1.2;">' + (t.mode==='day_0'?'Yest.':dayName) + '</div>' +
      '<div style="font-size:14px;font-weight:700;color:' + (a?'white':'#1e3a5f') + ';line-height:1.3;">' + num + '</div>' +
      '</button>';
  }).join('');

  const row2 = fixedTabs.map(function(t) {
    const a = posDateMode === t.mode;
    return '<button onclick="posSetMode(\'' + t.mode + '\')"' +
      ' style="flex:1;font-size:12px;font-weight:600;padding:8px 4px;border-radius:10px;' +
      'border:0.5px solid ' + (a?'#2563eb':'rgba(59,130,246,0.15)') + ';' +
      'background:' + (a?'#3b82f6':'white') + ';' +
      'color:' + (a?'white':'#1e3a5f') + ';' +
      'box-shadow:0 1px 4px rgba(30,58,95,' + (a?'0.18':'0.05') + ');' +
      'cursor:pointer;text-align:center;-webkit-tap-highlight-color:transparent;">' +
      t.label + '</button>';
  }).join('');

  const customPicker = posDateMode === 'custom' ? (
    '<div style="display:flex;gap:8px;margin-top:8px;align-items:center;">' +
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

  return '<div style="background:white;border-radius:14px;border:0.5px solid rgba(59,130,246,0.1);box-shadow:0 2px 8px rgba(30,58,95,0.07);padding:8px 8px 6px;margin-bottom:6px;">' +
           '<div style="font-size:10px;font-weight:600;color:#60a5fa;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Recent days</div>' +
           '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px;">' + row1 + '</div>' +
           '</div>' +
           '<div style="background:white;border-radius:14px;border:0.5px solid rgba(59,130,246,0.1);box-shadow:0 2px 8px rgba(30,58,95,0.07);padding:8px;margin-bottom:10px;">' +
           '<div style="font-size:10px;font-weight:600;color:#60a5fa;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Periods</div>' +
           '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 44px;gap:5px;">' + row2 + '</div>' +
           '</div>' +
           customPicker;
}

async function loadPOS() {
  if (!isAdmin()) { loadPOSStaff(); return; }
  const sec = document.getElementById('vx');
  if (!sec || sec.classList.contains('hidden')) return;
  sec.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:200px;color:#94a3b8;font-size:13px;">Caricamento\u2026</div>';

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

    if (d.length === 0) {
      const msgs = {
        today:    '\uD83D\uDCED Nessun dato per oggi.<br><small style="color:#94a3b8">I CSV arrivano via email la mattina seguente.</small>',
        yesterday:'\uD83D\uDCED Nessun dato per ieri.<br><small style="color:#94a3b8">Possibile giorno di chiusura o CSV non ancora arrivato.</small>',
        weekend:  '\uD83D\uDCED Nessun dato per il weekend scorso.<br><small style="color:#94a3b8">I CSV arrivano il lunedì mattina.</small>',
        week:     '\uD83D\uDCED Nessun dato per gli ultimi 7 giorni.',
        month:    '\uD83D\uDCED Nessun dato per gli ultimi 30 giorni.',
      };
      sec.innerHTML = '<div style="padding:12px;">' +
        posSelectors(period) +
        '<p style="font-size:11px;color:#64748b;font-weight:500;margin-bottom:16px;">' + period.label + '</p>' +
        '<div style="background:rgba(255,255,255,0.7);border-radius:16px;padding:40px 20px;text-align:center;font-size:13px;color:#475569;line-height:1.6;">' +
        (msgs[posDateMode]||'Nessun dato per questo periodo.') +
        '</div></div>';
      return;
    }

    const totalRevenue  = d.reduce((s,x)=>s+(x.net_sales||0),0);
    const totalCovers   = d.reduce((s,x)=>s+(x.bill_count||0),0);
    const totalDisc     = d.reduce((s,x)=>s+(x.discounts||0),0);
    const totalFoodCost = d.reduce((s,x)=>s+(x.food_cost||0),0);
    const avgCheck      = totalCovers>0 ? totalRevenue/totalCovers : 0;
    const foodCostPct   = totalRevenue>0 ? (totalFoodCost/totalRevenue)*100 : 0;
    const nDays         = d.length||1;

    let cmpHtml = '';
    if (compareDays.length > 0) {
      const div = period.singleDay ? compareDays.length : Math.max(compareDays.length/3,1);
      const cRev = compareDays.reduce((s,x)=>s+(x.net_sales||0),0)/div;
      const cCov = compareDays.reduce((s,x)=>s+(x.bill_count||0),0)/div;
      const cChk = cCov>0 ? cRev/cCov : 0;
      const cFcP = cRev>0 ? (compareDays.reduce((s,x)=>s+(x.food_cost||0),0)/div/cRev)*100 : 0;
      const arrow = (cur,ref) => ref>0 ? ((cur-ref)/ref*100) : null;
      const arrowHtml = (v) => v===null ? '' : '<span style="font-size:10px;color:'+(v>=0?'#059669':'#dc2626')+'">'+(v>=0?'\u25B2':'\u25BC')+' '+Math.abs(v).toFixed(0)+'%</span>';
      cmpHtml = '<div style="background:rgba(255,255,255,0.7);border-radius:16px;padding:14px 16px;">' +
        '<p style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;font-weight:600;margin-bottom:10px;">'+period.compareLabel+' \u00B7 '+compareDays.length+' date</p>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center;">' +
        '<div><p style="font-size:9px;color:#94a3b8;">Revenue avg</p><p style="font-size:14px;font-weight:700;color:#475569;">'+fmt(cRev)+'</p>'+arrowHtml(arrow(totalRevenue,cRev))+'</div>' +
        '<div><p style="font-size:9px;color:#94a3b8;">Coperti avg</p><p style="font-size:14px;font-weight:700;color:#475569;">'+Math.round(cCov)+'</p>'+arrowHtml(arrow(totalCovers,cCov))+'</div>' +
        '<div><p style="font-size:9px;color:#94a3b8;">Check avg</p><p style="font-size:14px;font-weight:700;color:#475569;">'+fmtD(cChk)+'</p></div>' +
        '</div>' +
        '<p style="font-size:10px;color:#94a3b8;text-align:center;margin-top:8px;">Food cost avg: '+cFcP.toFixed(1)+'%</p>' +
        '</div>';
    }

    const itemMap = {};
    (items||[]).forEach(r => {
      if (!itemMap[r.menu_item]) itemMap[r.menu_item]={name:r.menu_item,cat:r.sales_category,qty:0,rev:0};
      itemMap[r.menu_item].qty += Number(r.quantity)||0;
      itemMap[r.menu_item].rev += Number(r.gross_sales)||0;
    });
    const topItems = Object.values(itemMap).filter(x=>x.rev>0).sort((a,b)=>b.rev-a.rev).slice(0,10);
    const catColors = {Food:'#059669',Alcohol:'#7c3aed',Wine:'#dc2626',Beer:'#d97706'};

    const catMap = {};
    (items||[]).forEach(r => { const c=r.sales_category||'Other'; catMap[c]=(catMap[c]||0)+(Number(r.gross_sales)||0); });
    const cats = Object.entries(catMap).sort((a,b)=>b[1]-a[1]);

    let trendHtml = '';
    if (['week','month','weekend'].includes(posDateMode) && d.length>1) {
      const sorted = [...d].sort((a,b)=>a.sale_date.localeCompare(b.sale_date));
      const maxR = Math.max(...sorted.map(x=>x.net_sales||0));
      trendHtml = '<div style="background:rgba(255,255,255,0.7);border-radius:16px;padding:14px 16px;">' +
        '<p style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;font-weight:600;margin-bottom:10px;">Andamento Revenue</p>' +
        '<div style="display:flex;align-items:flex-end;gap:3px;height:64px;">' +
        sorted.map(x => {
          const h=maxR>0?Math.round(((x.net_sales||0)/maxR)*60):3;
          return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;">' +
            '<div style="height:'+h+'px;background:#059669;border-radius:2px 2px 0 0;width:100%;min-height:2px;"></div>' +
            '<span style="font-size:7px;color:#94a3b8;">'+x.sale_date.slice(5)+'</span>' +
            '</div>';
        }).join('') +
        '</div></div>';
    }

    const topHtml = topItems.length>0 ?
      '<div style="background:rgba(255,255,255,0.7);border-radius:16px;padding:14px 16px;margin-bottom:8px;">' +
      '<p style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;font-weight:600;margin-bottom:10px;">Top 10 per Revenue</p>' +
      '<div style="display:flex;flex-direction:column;gap:8px;">' +
      topItems.map(function(it,i) {
        const bw=topItems[0].rev>0?Math.round((it.rev/topItems[0].rev)*100):0;
        const col=catColors[it.cat]||'#64748b';
        return '<div>' +
          '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px;">' +
          '<span style="font-size:12px;font-weight:500;color:#1e293b;max-width:62%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+(i+1)+'. '+it.name+'</span>' +
          '<span style="font-size:12px;font-weight:700;color:#1e293b;">'+fmt(it.rev)+'</span>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
          '<div style="flex:1;height:4px;background:#f1f5f9;border-radius:2px;overflow:hidden;">' +
          '<div style="width:'+bw+'%;height:100%;background:'+col+';border-radius:2px;"></div>' +
          '</div>' +
          '<span style="font-size:10px;color:#94a3b8;width:32px;text-align:right;">'+it.qty+'x</span>' +
          '</div></div>';
      }).join('') +
      '</div></div>' : '';

    const catsHtml = cats.length>0 ?
      '<div style="background:rgba(255,255,255,0.7);border-radius:16px;padding:14px 16px;margin-bottom:8px;">' +
      '<p style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;font-weight:600;margin-bottom:10px;">Per categoria</p>' +
      '<div style="display:flex;flex-direction:column;gap:6px;">' +
      cats.map(function(entry) {
        const cat=entry[0]; const rev=entry[1];
        const col=catColors[cat]||'#64748b';
        const pct=totalRevenue>0?((rev/totalRevenue)*100).toFixed(1):0;
        return '<div style="display:flex;align-items:center;gap:8px;">' +
          '<span style="font-size:10px;color:#64748b;width:52px;flex-shrink:0;">'+cat+'</span>' +
          '<div style="flex:1;height:6px;background:#f1f5f9;border-radius:3px;overflow:hidden;">' +
          '<div style="width:'+pct+'%;height:100%;background:'+col+';border-radius:3px;"></div>' +
          '</div>' +
          '<span style="font-size:11px;font-weight:600;color:#1e293b;width:52px;text-align:right;">'+fmt(rev)+'</span>' +
          '</div>';
      }).join('') +
      '</div></div>' : '';

    const daysHtml = d.length>0 ?
      '<div style="background:rgba(255,255,255,0.7);border-radius:16px;padding:14px 16px;">' +
      '<p style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;font-weight:600;margin-bottom:10px;">Giornate</p>' +
      '<div>' +
      d.map(function(x) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f8fafc;">' +
          '<div>' +
          '<p style="font-size:12px;font-weight:500;color:#1e293b;">'+dayNameIT(x.sale_date)+' '+x.sale_date.slice(5)+'</p>' +
          '<p style="font-size:10px;color:#94a3b8;">'+(x.bill_count||'\u2014')+' cop \u00B7 check '+(x.bill_count?fmtD((x.net_sales||0)/x.bill_count):'\u2014')+'</p>' +
          '</div>' +
          '<p style="font-size:15px;font-weight:700;color:#059669;">'+fmt(x.net_sales||0)+'</p>' +
          '</div>';
      }).join('') +
      '</div></div>' : '';

    sec.innerHTML = '<div style="padding:12px 12px 100px;">' +
      posSelectors(period) +
      '<p style="font-size:11px;color:#64748b;font-weight:500;margin-bottom:12px;">' + period.label + '</p>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">' +
        '<div style="background:rgba(255,255,255,0.7);border-radius:16px;padding:12px;">' +
          '<p style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;">Revenue netto</p>' +
          '<p style="font-size:22px;font-weight:700;color:#059669;">'+fmt(totalRevenue)+'</p>' +
          (nDays>1?'<p style="font-size:10px;color:#94a3b8;">avg/gg '+fmt(totalRevenue/nDays)+'</p>':'') +
        '</div>' +
        '<div style="background:rgba(255,255,255,0.7);border-radius:16px;padding:12px;">' +
          '<p style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;">Coperti</p>' +
          '<p style="font-size:22px;font-weight:700;color:#1e293b;">'+totalCovers+'</p>' +
          '<p style="font-size:10px;color:#94a3b8;">check '+fmtD(avgCheck)+'</p>' +
        '</div>' +
        '<div style="background:rgba(255,255,255,0.7);border-radius:16px;padding:12px;">' +
          '<p style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;">Food cost</p>' +
          '<p style="font-size:22px;font-weight:700;color:'+(foodCostPct>35?'#dc2626':'#1e293b')+';">'+foodCostPct.toFixed(1)+'%</p>' +
          '<p style="font-size:10px;color:#94a3b8;">'+fmt(totalFoodCost)+'</p>' +
        '</div>' +
        '<div style="background:rgba(255,255,255,0.7);border-radius:16px;padding:12px;">' +
          '<p style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;">Sconti</p>' +
          '<p style="font-size:22px;font-weight:700;color:#d97706;">'+fmt(totalDisc)+'</p>' +
          '<p style="font-size:10px;color:#94a3b8;">'+(totalRevenue>0?((totalDisc/(totalRevenue+totalDisc))*100).toFixed(1)+'%':'\u2014')+' del lordo</p>' +
        '</div>' +
      '</div>' +
      (cmpHtml ? cmpHtml+'<div style="height:8px;"></div>' : '') +
      (trendHtml ? trendHtml+'<div style="height:8px;"></div>' : '') +
      topHtml +
      catsHtml +
      daysHtml +
      '<div style="height:16px;"></div>' +
      '<button onclick="openDeepAnalysis()" style="width:100%;padding:15px;border-radius:16px;border:none;background:linear-gradient(135deg,#1e293b,#334155);color:white;font-size:14px;font-weight:700;cursor:pointer;letter-spacing:.03em;display:flex;align-items:center;justify-content:center;gap:8px;"><span style="font-size:18px;">🔍</span> Deep Analysis</button>' +
    '</div>';

  } catch(err) {
    console.error('POS error:',err);
    document.getElementById('vx').innerHTML = '<div style="padding:16px;color:#dc2626;font-size:13px;">Errore: '+err.message+'</div>';
  }
}

function posSetMode(m) {
  posDateMode = m;
  loadPOS();
}


// ── Deep Analysis Modal ─────────────────────────────────────────────

var DA_CATEGORIES = {
  'Primi': [
    { id:'p01', label:'Pasta più venduta nel periodo', query:'top_item', filter:{cat:'Food',groups:['Pasta','Kids menu']} },
    { id:'p02', label:'Porzioni totali Cacio e Pepe (tutte le versioni)', query:'cacio_pepe_total' },
    { id:'p03', label:'Porzioni totali Ragù (tutte le versioni)', query:'dish_total', filter:{name:'Ragu'} },
    { id:'p04', label:'Porzioni totali Lobster Fettuccine', query:'dish_total', filter:{name:'Lobster Fettuc'} },
    { id:'p05', label:'Porzioni totali Wheel Pasta', query:'dish_total', filter:{name:'Wheel Pasta'} },
    { id:'p06', label:'Pasta più venduta il venerdì', query:'top_item_dow', filter:{cat:'Food',groups:['Pasta'],dow:5} },
    { id:'p07', label:'Pasta più venduta il sabato', query:'top_item_dow', filter:{cat:'Food',groups:['Pasta'],dow:6} },
    { id:'p08', label:'Pasta più venduta weekend vs feriali', query:'weekend_vs_week', filter:{groups:['Pasta']} },
    { id:'p09', label:'Proteine aggiunte sulla pasta — totale', query:'modifier_total', filter:{modifiers:['Add chicken','Add shrimp','Meatballs','Scallops','Lobsters']} },
    { id:'p10', label:'Add chicken — su quali paste viene chiesto di più?', query:'modifier_by_parent', filter:{modifier:'Add chicken',groups:['Pasta']} },
    { id:'p11', label:'Add shrimp — su quali paste viene chiesto di più?', query:'modifier_by_parent', filter:{modifier:'Add shrimp',groups:['Pasta']} },
    { id:'p12', label:'Meatballs — su quali paste viene chiesto di più?', query:'modifier_by_parent', filter:{modifier:'Meatballs',groups:['Pasta']} },
    { id:'p13', label:'Scallops — su quali paste viene chiesto di più?', query:'modifier_by_parent', filter:{modifier:'Scallops',groups:['Pasta']} },
    { id:'p14', label:'Lobsters come modifier — su quali paste?', query:'modifier_by_parent', filter:{modifier:'Lobsters',groups:['Pasta']} },
    { id:'p15', label:'Richieste gluten free pasta — totale', query:'modifier_total', filter:{modifiers:['gluten free pasta','Gluten free pasta','Gluten Free Pasta']} },
    { id:'p16', label:'Gluten free — su quali paste viene chiesta di più?', query:'modifier_by_parent', filter:{modifier:'gluten free pasta',groups:['Pasta']} },
    { id:'p17', label:'Paste vendute come half/mezza porzione', query:'half_portions', filter:{groups:['Pasta','Kids menu']} },
    { id:'p18', label:'Pasta Kids vs Pasta adulti — distribuzione', query:'kids_vs_adult_pasta' },
    { id:'p19', label:'Quale pasta ha più modifier aggiuntivi?', query:'most_modifiers_dish', filter:{groups:['Pasta']} },
    { id:'p20', label:'Add truffle — su quali paste viene richiesto?', query:'modifier_by_parent', filter:{modifier:'Fresh truffle',groups:['Pasta']} },
    { id:'p21', label:'Classifica pasta per giorno della settimana', query:'top_item_by_dow', filter:{groups:['Pasta']} },
    { id:'p22', label:'Trend Wheel Pasta — quantità a settimana', query:'trend_dish', filter:{name:'Wheel Pasta'} },
    { id:'p23', label:'Trend Lobster Fettuccine — quantità a settimana', query:'trend_dish', filter:{name:'Lobster Fettuc'} },
    { id:'p24', label:'Paste vendute to go', query:'modifier_total', filter:{modifiers:['To go','TO GO','Togo','to go']} },
    { id:'p25', label:'Burrata come upgrade — su quali paste?', query:'modifier_by_parent', filter:{modifier:'Burrata',groups:['Pasta']} }
  ],
  'Secondi': [
    { id:'s01', label:'Secondo più venduto nel periodo', query:'top_item', filter:{cat:'Food',groups:['Secondi/entrees','Secondi']} },
    { id:'s02', label:'Quante Siciliane vendute?', query:'dish_total', filter:{name:'Siciliana'} },
    { id:'s03', label:'Quante Ribeye vendute?', query:'dish_total', filter:{name:'Ribeye'} },
    { id:'s04', label:'Quante Scallops Chefs Way vendute?', query:'dish_total', filter:{name:'Scallops Chefs'} },
    { id:'s05', label:'Quanti Filetto venduti?', query:'dish_total', filter:{name:'Filetto'} },
    { id:'s06', label:'Quante Chicken Piccata vendute?', query:'dish_total', filter:{name:'Piccata'} },
    { id:'s07', label:'Quante Chicken Parm vendute?', query:'dish_total', filter:{name:'Chicken Parm'} },
    { id:'s08', label:'Secondo più venduto il venerdì', query:'top_item_dow', filter:{groups:['Secondi/entrees','Secondi'],dow:5} },
    { id:'s09', label:'Secondo più venduto il sabato', query:'top_item_dow', filter:{groups:['Secondi/entrees','Secondi'],dow:6} },
    { id:'s10', label:'Cotture sul Filetto — Medium vs Medium Rare vs Well Done', query:'cotture_piatto', filter:{name:'Filetto'} },
    { id:'s11', label:'Cotture sulla Ribeye — distribuzione', query:'cotture_piatto', filter:{name:'Ribeye'} },
    { id:'s12', label:'Cotture sul Wagyu — distribuzione', query:'cotture_piatto', filter:{name:'Wagyu'} },
    { id:'s13', label:'Contorni più ordinati sul Filetto', query:'contorni_piatto', filter:{name:'Filetto'} },
    { id:'s14', label:'Contorni più ordinati sulla Ribeye', query:'contorni_piatto', filter:{name:'Ribeye'} },
    { id:'s15', label:'Contorni più ordinati sulla Siciliana', query:'contorni_piatto', filter:{name:'Siciliana'} },
    { id:'s16', label:'Contorni più ordinati su Scallops Chefs Way', query:'contorni_piatto', filter:{name:'Scallops Chefs'} },
    { id:'s17', label:'Contorni più ordinati su Chicken Piccata', query:'contorni_piatto', filter:{name:'Piccata'} },
    { id:'s18', label:'Brussels — secondi vs pasta a confronto', query:'modifier_split', filter:{modifier:'Brussels'} },
    { id:'s19', label:'Rosemary potato — su quali secondi viene chiesta di più?', query:'modifier_by_parent', filter:{modifier:'Rosemary potato',groups:['Secondi/entrees','Secondi']} },
    { id:'s20', label:'Sautéed Spinach — su quali secondi viene chiesta di più?', query:'modifier_by_parent', filter:{modifier:'Sautéed Spinach',groups:['Secondi/entrees','Secondi']} },
    { id:'s21', label:'Asparagus — su quali secondi viene chiesta di più?', query:'modifier_by_parent', filter:{modifier:'Asparagus',groups:['Secondi/entrees','Secondi']} },
    { id:'s22', label:'Green Beans — su quali secondi viene chiesta di più?', query:'modifier_by_parent', filter:{modifier:'Green Beans',groups:['Secondi/entrees','Secondi']} },
    { id:'s23', label:'Secondi venduti con pasta aggiunta (add spaghetti half)', query:'modifier_by_parent', filter:{modifier:'Add spaghetti half',groups:['Secondi/entrees','Secondi']} },
    { id:'s24', label:'Quale secondo ha più modifier cucina per piatto?', query:'most_modifiers_dish', filter:{groups:['Secondi/entrees','Secondi']} },
    { id:'s25', label:'Trend Siciliana — quantità a settimana', query:'trend_dish', filter:{name:'Siciliana'} }
  ],
  'Antipasti': [
    { id:'a01', label:'Antipasto più venduto nel periodo', query:'top_item', filter:{cat:'Food',groups:['Antipasti/appetizer','Antipasti']} },
    { id:'a02', label:'Quanti Fried Calamari venduti?', query:'dish_total', filter:{name:'Calamari'} },
    { id:'a03', label:'Quante Bresaole vendute?', query:'dish_total', filter:{name:'Bresaola'} },
    { id:'a04', label:'Quante Meatball Appetizer vendute?', query:'dish_total', filter:{name:'Meatball App'} },
    { id:'a05', label:'Quante Bruschetta Board vendute?', query:'dish_total', filter:{name:'Bruschetta'} },
    { id:'a06', label:'Quante Caprese vendute?', query:'dish_total', filter:{name:'Caprese'} },
    { id:'a07', label:'Antipasto più venduto il sabato', query:'top_item_dow', filter:{groups:['Antipasti/appetizer','Antipasti'],dow:6} },
    { id:'a08', label:'Antipasto più venduto weekend vs feriali', query:'weekend_vs_week', filter:{groups:['Antipasti/appetizer','Antipasti']} },
    { id:'a09', label:'Burrata come aggiunta — su quali antipasti?', query:'modifier_by_parent', filter:{modifier:'Burrata',groups:['Antipasti/appetizer','Antipasti']} },
    { id:'a10', label:'Gluten allergy — su quali antipasti viene segnalata di più?', query:'modifier_by_parent', filter:{modifier:'Gluten allergy',groups:['Antipasti/appetizer','Antipasti']} },
    { id:'a11', label:'Antipasti venduti to go', query:'modifier_by_parent', filter:{modifier:'To go',groups:['Antipasti/appetizer','Antipasti']} },
    { id:'a12', label:'Antipasto più ordinato come course 1', query:'modifier_by_parent', filter:{modifier:'course 1'} },
    { id:'a13', label:'Tuscany Road Trip — quante volte venduta?', query:'dish_total', filter:{name:'Tuscany Road'} },
    { id:'a14', label:'Salmon Cakes — quante volte vendute?', query:'dish_total', filter:{name:'Salmon Cakes'} },
    { id:'a15', label:'Shrimp Cocktail — quante volte venduto?', query:'dish_total', filter:{name:'Shrimp Cocktail'} },
    { id:'a16', label:'Coccoli Toscani — quante volte venduti?', query:'dish_total', filter:{name:'Coccoli'} },
    { id:'a17', label:'Artichoke — modifier più richiesti', query:'contorni_piatto', filter:{name:'Artichoke'} },
    { id:'a18', label:'Trend Bresaola nell ultimo mese', query:'trend_dish', filter:{name:'Bresaola'} },
    { id:'a19', label:'Trend Calamari nell ultimo mese', query:'trend_dish', filter:{name:'Calamari'} },
    { id:'a20', label:'Quale giorno si vendono più antipasti?', query:'top_item_by_dow', filter:{groups:['Antipasti/appetizer','Antipasti']} },
    { id:'a21', label:'Antipasto medio per coperto (antipasti totali / coperti)', query:'items_per_cover', filter:{groups:['Antipasti/appetizer','Antipasti']} },
    { id:'a22', label:'Nut allergy — quante volte sugli antipasti?', query:'modifier_by_parent', filter:{modifier:'Nut Allergy',groups:['Antipasti/appetizer','Antipasti']} },
    { id:'a23', label:'Gluten free — su quali antipasti viene chiesto di più?', query:'modifier_by_parent', filter:{modifier:'Gluten free',groups:['Antipasti/appetizer','Antipasti']} },
    { id:'a24', label:'Caprese — modifier più richiesti', query:'contorni_piatto', filter:{name:'Caprese'} },
    { id:'a25', label:'Meatball Appetizer — modifier più richiesti', query:'contorni_piatto', filter:{name:'Meatball App'} }
  ],
  'Contorni e Modifier': [
    { id:'c01', label:'Contorno più ordinato in totale (side + modifier)', query:'contorno_totale_combinato', filter:{modifier:'Brussels'} },
    { id:'c02', label:'Brussels — side + modifier separati e totale', query:'contorno_split_detail', filter:{modifier:'Brussels',item:'Brussels'} },
    { id:'c03', label:'Rosemary potato — side + modifier separati e totale', query:'contorno_split_detail', filter:{modifier:'Rosemary potato',item:'Rosemary'} },
    { id:'c04', label:'Asparagus — side + modifier separati e totale', query:'contorno_split_detail', filter:{modifier:'Asparagus',item:'Asparagus'} },
    { id:'c05', label:'Green Beans — side + modifier separati e totale', query:'contorno_split_detail', filter:{modifier:'Green Beans',item:'Green Beans'} },
    { id:'c06', label:'Sautéed Spinach — side + modifier separati e totale', query:'contorno_split_detail', filter:{modifier:'Sautéed Spinach',item:'Spinach'} },
    { id:'c07', label:'Contorno più ordinato il sabato', query:'top_modifier_dow', filter:{kitchen_cat:'Contorni',dow:6} },
    { id:'c08', label:'Contorno più ordinato il weekend', query:'top_modifier_weekend', filter:{kitchen_cat:'Contorni'} },
    { id:'c09', label:'Classifica completa contorni per quantità', query:'classifica_modifier', filter:{kitchen_cat:'Contorni'} },
    { id:'c10', label:'Add chicken — quante volte in totale', query:'modifier_total', filter:{modifiers:['Add chicken']} },
    { id:'c11', label:'Add shrimp — quante volte in totale', query:'modifier_total', filter:{modifiers:['Add shrimp']} },
    { id:'c12', label:'Meatballs come modifier — quante volte', query:'modifier_total', filter:{modifiers:['Meatballs']} },
    { id:'c13', label:'Scallops come modifier — quante volte', query:'modifier_total', filter:{modifiers:['Scallops']} },
    { id:'c14', label:'Fresh truffle — su quali piatti viene richiesto?', query:'modifier_by_parent', filter:{modifier:'Fresh truffle'} },
    { id:'c15', label:'Burrata come aggiunta — quante volte e su cosa?', query:'modifier_by_parent', filter:{modifier:'Burrata'} },
    { id:'c16', label:'Gorgonzola olives — su quali piatti?', query:'modifier_by_parent', filter:{modifier:'Gorgonzola olives'} },
    { id:'c17', label:'Proteine aggiunte totali nel periodo', query:'modifier_total', filter:{modifiers:['Add chicken','Add shrimp','Meatballs','Scallops','Add mussels','Add salmon whole']} },
    { id:'c18', label:'Contorno medio per coperto nel periodo', query:'items_per_cover', filter:{kitchen_cat:'Contorni'} },
    { id:'c19', label:'Trend Brussels — settimana per settimana', query:'trend_modifier', filter:{modifier:'Brussels'} },
    { id:'c20', label:'Trend Add chicken — settimana per settimana', query:'trend_modifier', filter:{modifier:'Add chicken'} },
    { id:'c21', label:'Proteina aggiuntiva più venduta il venerdì', query:'top_modifier_dow', filter:{kitchen_cat:'Proteine',dow:5} },
    { id:'c22', label:'Proteina aggiuntiva più venduta il sabato', query:'top_modifier_dow', filter:{kitchen_cat:'Proteine',dow:6} },
    { id:'c23', label:'Gluten free pasta — quante richieste totali', query:'modifier_total', filter:{modifiers:['gluten free pasta','Gluten free pasta','Gluten Free Pasta','gluten free']} },
    { id:'c24', label:'Add spaghetti half — su quali piatti viene chiesto?', query:'modifier_by_parent', filter:{modifier:'Add spaghetti half'} },
    { id:'c25', label:'Modifier cucina totali per giorno — media', query:'modifier_avg_per_day', filter:{} }
  ],
  'Riepilogo': [
    { id:'r01', label:'Coperti totali nel periodo', query:'summary_covers' },
    { id:'r02', label:'Fatturato totale nel periodo', query:'summary_revenue' },
    { id:'r03', label:'Check medio nel periodo', query:'summary_check_avg' },
    { id:'r04', label:'Giorno con più coperti nel periodo', query:'best_day_covers' },
    { id:'r05', label:'Giorno con meno coperti nel periodo', query:'worst_day_covers' },
    { id:'r06', label:'Giorno con fatturato più alto nel periodo', query:'best_day_revenue' },
    { id:'r07', label:'Media coperti per giorno della settimana', query:'avg_by_dow_covers' },
    { id:'r08', label:'Media fatturato per giorno della settimana', query:'avg_by_dow_revenue' },
    { id:'r09', label:'Confronto coperti questo mese vs mese scorso', query:'mom_covers' },
    { id:'r10', label:'Confronto fatturato questo mese vs mese scorso', query:'mom_revenue' },
    { id:'r11', label:'Piatto più venduto in assoluto nel periodo', query:'top_item_all' },
    { id:'r12', label:'Piatto meno venduto nel periodo', query:'bottom_item_all' },
    { id:'r13', label:'Categoria Food più venduta (Pasta vs Secondi vs Antipasti)', query:'cat_ranking' },
    { id:'r14', label:'Coperti weekend vs feriali', query:'weekend_vs_weekday_covers' },
    { id:'r15', label:'Fatturato weekend vs feriali', query:'weekend_vs_weekday_revenue' },
    { id:'r16', label:'Piatti Food totali venduti nel periodo', query:'total_food_items' },
    { id:'r17', label:'Modifier cucina totali nel periodo', query:'total_kitchen_modifiers' },
    { id:'r18', label:'Sconto medio applicato nel periodo', query:'avg_discount' },
    { id:'r19', label:'Piatto con più tipi di personalizzazione nel periodo', query:'most_modifiers_dish', filter:{} },
    { id:'r20', label:'Richieste to go totali nel periodo', query:'modifier_total', filter:{modifiers:['To go','TO GO','Togo','to go','Togo please']} },
    { id:'r21', label:'Gluten allergy nel periodo — quante volte', query:'modifier_total', filter:{modifiers:['Gluten allergy','Gluten Allergy','Gluten free','Gluten Free']} },
    { id:'r22', label:'Nut allergy nel periodo — quante volte', query:'modifier_total', filter:{modifiers:['Nut Allergy','Nut allergy','Pine nut allergy']} },
    { id:'r23', label:'Giorno più redditizio per giorno della settimana (media storica)', query:'best_dow_historical' },
    { id:'r24', label:'Trend coperti — crescita o calo vs mese scorso?', query:'trend_covers_mom' },
    { id:'r25', label:'Record assoluto di coperti — quando?', query:'record_covers' }
  ],
  'Insalate e Zuppe': [
    { id:'i01', label:'Insalata più venduta nel periodo', query:'top_item', filter:{cat:'Food',groups:['Insalate/salad']} },
    { id:'i02', label:'Quante Mini Caesar Salad vendute?', query:'dish_total', filter:{name:'Caesar Salad'} },
    { id:'i03', label:'Quante House Salad vendute?', query:'dish_total', filter:{name:'House Salad'} },
    { id:'i04', label:'Quante Pere e Pecorino vendute?', query:'dish_total', filter:{name:'Pere E Pecorino'} },
    { id:'i05', label:'Quante Salmon Salad vendute?', query:'dish_total', filter:{name:'Salmon Salad'} },
    { id:'i06', label:'Quante Mediterranean Salad vendute?', query:'dish_total', filter:{name:'Mediterranean'} },
    { id:'i07', label:'Dressing più richiesto in totale', query:'classifica_modifier', filter:{modifiers:['Caesar','citronette','Balsamic','Ranch','balsamic','ranch','Caesar dressing']} },
    { id:'i08', label:'Caesar dressing — quante volte?', query:'modifier_total', filter:{modifiers:['Caesar','Caesar dressing']} },
    { id:'i09', label:'Citronette — quante volte?', query:'modifier_total', filter:{modifiers:['citronette','Citronette']} },
    { id:'i10', label:'Balsamic — quante volte?', query:'modifier_total', filter:{modifiers:['Balsamic','balsamic','BALSAMIC ON SIDE']} },
    { id:'i11', label:'Ranch — quante volte?', query:'modifier_total', filter:{modifiers:['Ranch','ranch']} },
    { id:'i12', label:'Add chicken sulle insalate — quante volte e su quale?', query:'modifier_by_parent', filter:{modifier:'Add chicken',groups:['Insalate/salad']} },
    { id:'i13', label:'No croutons — su quali insalate?', query:'modifier_by_parent', filter:{modifier:'No croutons',groups:['Insalate/salad']} },
    { id:'i14', label:'Gluten allergy sulle insalate', query:'modifier_by_parent', filter:{modifier:'Gluten allergy',groups:['Insalate/salad']} },
    { id:'i15', label:'Insalate ordinate come course 1', query:'modifier_by_parent', filter:{modifier:'course 1',groups:['Insalate/salad']} },
    { id:'i16', label:'Insalata più venduta il sabato', query:'top_item_dow', filter:{groups:['Insalate/salad'],dow:6} },
    { id:'i17', label:'Texana Soup — quante volte venduta?', query:'dish_total', filter:{name:'Texana'} },
    { id:'i18', label:'Tomato Basil Soup — quante volte venduta?', query:'dish_total', filter:{name:'Tomato And Basil'} },
    { id:'i19', label:'Insalata media per coperto nel periodo', query:'items_per_cover', filter:{groups:['Insalate/salad']} },
    { id:'i20', label:'Trend Caesar Salad — settimana per settimana', query:'trend_dish', filter:{name:'Caesar Salad'} },
    { id:'i21', label:'Insalate vendute to go', query:'modifier_by_parent', filter:{modifier:'To go',groups:['Insalate/salad']} },
    { id:'i22', label:'Salmon Salad — modifier più richiesti', query:'contorni_piatto', filter:{name:'Salmon Salad'} },
    { id:'i23', label:'Pere e Pecorino — dressing più richiesto', query:'contorni_piatto', filter:{name:'Pere E Pecorino'} },
    { id:'i24', label:'Quale giorno si vendono più insalate?', query:'top_item_by_dow', filter:{groups:['Insalate/salad']} },
    { id:'i25', label:'Mini Caesar — richieste speciali più frequenti', query:'contorni_piatto', filter:{name:'Mini Caesar'} }
  ],
  'Dolci': [
    { id:'d01', label:'Dolce più venduto nel periodo', query:'top_item', filter:{cat:'Food',groups:['Dolcezze/dessert','Dolcezze']} },
    { id:'d02', label:'Quanti Tiramisu venduti?', query:'dish_total', filter:{name:'Tiramisu'} },
    { id:'d03', label:'Quante Cheesecake vendute?', query:'dish_total', filter:{name:'Cheesecake'} },
    { id:'d04', label:'Quanti Limoncello Cake venduti?', query:'dish_total', filter:{name:'Limoncello'} },
    { id:'d05', label:'Quante Crème Brûlée vendute?', query:'dish_total', filter:{name:'Br\u00FBl\u00E9e'} },
    { id:'d06', label:'Quante Italian Marble Cake vendute?', query:'dish_total', filter:{name:'Marble'} },
    { id:'d07', label:'Quante Panna Cotta vendute?', query:'dish_total', filter:{name:'Panna Cotta'} },
    { id:'d08', label:'Quante Mint Bavarese vendute?', query:'dish_total', filter:{name:'Bavarese'} },
    { id:'d09', label:'Berry Coulis — su quali dolci viene chiesto?', query:'modifier_by_parent', filter:{modifier:'Berry Coulis',groups:['Dolcezze/dessert','Dolcezze']} },
    { id:'d10', label:'Nutella — su quali dolci viene chiesta?', query:'modifier_by_parent', filter:{modifier:'Nutella',groups:['Dolcezze/dessert','Dolcezze']} },
    { id:'d11', label:'Dolce più venduto il sabato', query:'top_item_dow', filter:{groups:['Dolcezze/dessert','Dolcezze'],dow:6} },
    { id:'d12', label:'Dolce più venduto il weekend', query:'weekend_vs_week', filter:{groups:['Dolcezze/dessert','Dolcezze']} },
    { id:'d13', label:'Dolci venduti to go', query:'modifier_by_parent', filter:{modifier:'TO GO',groups:['Dolcezze/dessert','Dolcezze']} },
    { id:'d14', label:'Dolci per coperto — media nel periodo', query:'items_per_cover', filter:{groups:['Dolcezze/dessert','Dolcezze']} },
    { id:'d15', label:'Nut allergy sui dolci — quante volte?', query:'modifier_by_parent', filter:{modifier:'Nut Allergy',groups:['Dolcezze/dessert','Dolcezze']} },
    { id:'d16', label:'Gluten allergy sui dolci — quante volte?', query:'modifier_by_parent', filter:{modifier:'Gluten Allergy',groups:['Dolcezze/dessert','Dolcezze']} },
    { id:'d17', label:'Trend Tiramisu — settimana per settimana', query:'trend_dish', filter:{name:'Tiramisu'} },
    { id:'d18', label:'Trend Cheesecake — settimana per settimana', query:'trend_dish', filter:{name:'Cheesecake'} },
    { id:'d19', label:'Quale dolce ha più richieste speciali?', query:'most_modifiers_dish', filter:{groups:['Dolcezze/dessert','Dolcezze']} },
    { id:'d20', label:'Compleanno (birthday) — quante volte sul dolce?', query:'modifier_by_parent', filter:{modifier:'Birthday',groups:['Dolcezze/dessert','Dolcezze']} },
    { id:'d21', label:'Dolci condivisi (shared) — quante volte?', query:'modifier_by_parent', filter:{modifier:'Shared',groups:['Dolcezze/dessert','Dolcezze']} },
    { id:'d22', label:'Quale giorno si vendono più dolci?', query:'top_item_by_dow', filter:{groups:['Dolcezze/dessert','Dolcezze']} },
    { id:'d23', label:'Limoncello Cake — richieste speciali più frequenti', query:'contorni_piatto', filter:{name:'Limoncello'} },
    { id:'d24', label:'Panna Cotta — quale salsa viene richiesta di più?', query:'contorni_piatto', filter:{name:'Panna Cotta'} },
    { id:'d25', label:'Cheesecake — quale topping viene richiesto di più?', query:'contorni_piatto', filter:{name:'Cheesecake'} }
  ],
  'Confronti Temporali': [
    { id:'t01', label:'Stesso giorno dell anno scorso — confronto coperti e revenue', query:'yoy_same_day' },
    { id:'t02', label:'Questa settimana vs settimana scorsa', query:'wow_comparison' },
    { id:'t03', label:'Questo mese vs stesso mese anno scorso', query:'yoy_month' },
    { id:'t04', label:'Questo weekend vs weekend scorso', query:'weekend_vs_prev' },
    { id:'t05', label:'Questo weekend vs stesso weekend anno scorso', query:'yoy_weekend' },
    { id:'t06', label:'Ultimi 30 giorni vs 30 giorni precedenti', query:'rolling_30_comparison' },
    { id:'t07', label:'Migliore sabato di sempre — quando?', query:'best_ever_dow', filter:{dow:6} },
    { id:'t08', label:'Migliore venerdì di sempre — quando?', query:'best_ever_dow', filter:{dow:5} },
    { id:'t09', label:'Record assoluto di coperti — quando?', query:'record_covers' },
    { id:'t10', label:'Record assoluto di fatturato — quando?', query:'record_revenue' },
    { id:'t11', label:'Mese migliore di sempre', query:'best_ever_month' },
    { id:'t12', label:'Mese peggiore di sempre', query:'worst_ever_month' },
    { id:'t13', label:'Trend ultimi 90 giorni — crescita o calo?', query:'trend_90d' },
    { id:'t14', label:'Estate 2025 vs estate 2026 — confronto', query:'season_comparison', filter:{season:'estate'} },
    { id:'t15', label:'Dicembre — confronto anno su anno', query:'yoy_month_fixed', filter:{month:12} },
    { id:'t16', label:'Il check medio sta crescendo o calando? (ultimi 3 mesi)', query:'trend_check_avg' },
    { id:'t17', label:'I coperti del lunedì sono aumentati negli ultimi 6 mesi?', query:'trend_dow', filter:{dow:1} },
    { id:'t18', label:'Quale mese è storicamente il più forte?', query:'best_month_historical' },
    { id:'t19', label:'Quale mese è storicamente il più debole?', query:'worst_month_historical' },
    { id:'t20', label:'C è un pattern stagionale? Estate vs inverno', query:'seasonal_pattern' },
    { id:'t21', label:'La pasta è in crescita o calo — ultimi 3 mesi?', query:'trend_category', filter:{groups:['Pasta']} },
    { id:'t22', label:'Quale settimana dell anno è storicamente la più forte?', query:'best_week_historical' },
    { id:'t23', label:'Trend add chicken — crescita negli ultimi 3 mesi?', query:'trend_modifier', filter:{modifier:'Add chicken'} },
    { id:'t24', label:'Piatto con crescita più rapida negli ultimi 30 giorni', query:'fastest_growing_dish' },
    { id:'t25', label:'Piatto in calo più marcato negli ultimi 30 giorni', query:'fastest_declining_dish' }
  ],
  'Performance e Record': [
    { id:'pr01', label:'Giorni con più di 120 coperti — quante volte è successo?', query:'days_above_threshold', filter:{threshold:120,field:'bill_count'} },
    { id:'pr02', label:'Giorni con meno di 30 coperti — quando?', query:'days_below_threshold', filter:{threshold:30,field:'bill_count'} },
    { id:'pr03', label:'Il sabato scorso era sopra o sotto la media degli ultimi 4 sabati?', query:'vs_recent_avg', filter:{dow:6,weeks:4} },
    { id:'pr04', label:'Il venerdì scorso era sopra o sotto la media degli ultimi 4 venerdì?', query:'vs_recent_avg', filter:{dow:5,weeks:4} },
    { id:'pr05', label:'Quante volte abbiamo superato $15.000 in un giorno?', query:'days_above_threshold', filter:{threshold:15000,field:'net_sales'} },
    { id:'pr06', label:'Quante volte abbiamo superato $10.000 in un giorno feriale?', query:'weekday_above_threshold', filter:{threshold:10000} },
    { id:'pr07', label:'Check medio del sabato vs lunedì — differenza', query:'check_avg_compare_dow', filter:{dow1:6,dow2:1} },
    { id:'pr08', label:'I coperti del martedì sono stabili o variabili?', query:'variability_dow', filter:{dow:2} },
    { id:'pr09', label:'Peggior weekend degli ultimi 6 mesi', query:'worst_weekend_6m' },
    { id:'pr10', label:'Miglior weekend degli ultimi 6 mesi', query:'best_weekend_6m' },
    { id:'pr11', label:'Giorni con sconti anomali (>10% del fatturato)', query:'high_discount_days' },
    { id:'pr12', label:'Il Wheel Pasta è il piatto più venduto ogni sabato?', query:'dish_consistency_dow', filter:{name:'Wheel Pasta',dow:6} },
    { id:'pr13', label:'Lobster Fettuccine — c è un giorno dove va di più?', query:'dish_best_dow', filter:{name:'Lobster Fettuc'} },
    { id:'pr14', label:'Siciliana — va meglio d estate o d inverno?', query:'dish_seasonal', filter:{name:'Siciliana'} },
    { id:'pr15', label:'Top 10 piatti più venduti di sempre', query:'top_10_all_time' },
    { id:'pr16', label:'Top 5 sabati per coperti di sempre', query:'best_ever_dow_list', filter:{dow:6} },
    { id:'pr17', label:'Top 5 venerdì per fatturato di sempre', query:'best_ever_dow_revenue', filter:{dow:5} },
    { id:'pr18', label:'Classifica pasta per quantità venduta (storico)', query:'ranking_by_group', filter:{groups:['Pasta']} },
    { id:'pr19', label:'Classifica secondi per quantità venduta (storico)', query:'ranking_by_group', filter:{groups:['Secondi/entrees','Secondi']} },
    { id:'pr20', label:'Classifica antipasti per quantità venduta (storico)', query:'ranking_by_group', filter:{groups:['Antipasti/appetizer','Antipasti']} },
    { id:'pr21', label:'Modifier cucina più richiesto di sempre', query:'top_modifier_all_time' },
    { id:'pr22', label:'Contorno più ordinato di sempre', query:'top_modifier_all_time_cat', filter:{kitchen_cat:'Contorni'} },
    { id:'pr23', label:'Proteina aggiunta più richiesta di sempre', query:'top_modifier_all_time_cat', filter:{kitchen_cat:'Proteine'} },
    { id:'pr24', label:'Giorno della settimana con check medio più alto (storico)', query:'best_dow_check_historical' },
    { id:'pr25', label:'Mese con check medio più alto (storico)', query:'best_month_check_historical' }
  ]
};

var daFromDate = null;
var daToDate = null;

function openDeepAnalysis() {
  var today = new Date();
  today.setHours(0,0,0,0);
  var yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate()-1);
  daFromDate = toISO(yesterday);
  daToDate   = toISO(yesterday);

  var catOptions = Object.keys(DA_CATEGORIES).map(function(cat) {
    return '<option value="'+cat+'">'+cat+'</option>';
  }).join('');

  var html =
    '<div id="da-modal" style="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.55);display:flex;align-items:flex-end;">' +
    '<div style="background:#f0f4ff;border-radius:24px 24px 0 0;width:100%;max-height:92vh;overflow-y:auto;padding:20px 16px 40px;">' +

    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">' +
    '<div>' +
    '<div style="font-size:10px;font-weight:700;color:#6366f1;text-transform:uppercase;letter-spacing:.08em;">Admin</div>' +
    '<div style="font-size:20px;font-weight:800;color:#1e293b;">Deep Analysis</div>' +
    '</div>' +
    '<button onclick="closeDeepAnalysis()" style="width:36px;height:36px;border-radius:50%;border:none;background:rgba(100,116,139,0.12);font-size:18px;cursor:pointer;color:#475569;">✕</button>' +
    '</div>' +

    '<div style="background:white;border-radius:16px;padding:14px;margin-bottom:12px;">' +
    '<div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Periodo</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">' +
    '<div>' +
    '<div style="font-size:11px;color:#64748b;margin-bottom:4px;">Dal</div>' +
    '<input type="date" id="da-from" value="'+daFromDate+'" onchange="daFromDate=this.value" style="width:100%;padding:8px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;">' +
    '</div>' +
    '<div>' +
    '<div style="font-size:11px;color:#64748b;margin-bottom:4px;">Al</div>' +
    '<input type="date" id="da-to" value="'+daToDate+'" onchange="daToDate=this.value" style="width:100%;padding:8px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;">' +
    '</div>' +
    '</div>' +
    '<div style="display:flex;gap:6px;">' +
    '<button onclick="daSetPeriod(\'ieri\')" style="flex:1;padding:7px 4px;border-radius:8px;border:1px solid #e2e8f0;background:white;font-size:11px;font-weight:600;color:#475569;cursor:pointer;">Ieri</button>' +
    '<button onclick="daSetPeriod(\'weekend\')" style="flex:1;padding:7px 4px;border-radius:8px;border:1px solid #e2e8f0;background:white;font-size:11px;font-weight:600;color:#475569;cursor:pointer;">Weekend</button>' +
    '<button onclick="daSetPeriod(\'settimana\')" style="flex:1;padding:7px 4px;border-radius:8px;border:1px solid #e2e8f0;background:white;font-size:11px;font-weight:600;color:#475569;cursor:pointer;">Sett.</button>' +
    '<button onclick="daSetPeriod(\'mese\')" style="flex:1;padding:7px 4px;border-radius:8px;border:1px solid #e2e8f0;background:white;font-size:11px;font-weight:600;color:#475569;cursor:pointer;">Mese</button>' +
    '<button onclick="daSetPeriod(\'anno\')" style="flex:1;padding:7px 4px;border-radius:8px;border:1px solid #e2e8f0;background:white;font-size:11px;font-weight:600;color:#475569;cursor:pointer;">Anno</button>' +
    '</div>' +
    '</div>' +

    '<div style="background:white;border-radius:16px;padding:14px;margin-bottom:12px;">' +
    '<div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Categoria</div>' +
    '<select id="da-cat" onchange="daPopulateDomande()" style="width:100%;padding:10px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:14px;color:#1e293b;background:white;appearance:none;-webkit-appearance:none;">' +
    '<option value="">— Seleziona categoria —</option>' +
    catOptions +
    '</select>' +
    '</div>' +

    '<div style="background:white;border-radius:16px;padding:14px;margin-bottom:16px;">' +
    '<div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Domanda</div>' +
    '<select id="da-q" style="width:100%;padding:10px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;color:#1e293b;background:white;appearance:none;-webkit-appearance:none;">' +
    '<option value="">— Prima seleziona la categoria —</option>' +
    '</select>' +
    '</div>' +

    '<button onclick="runDeepAnalysis()" style="width:100%;padding:14px;border-radius:14px;border:none;background:linear-gradient(135deg,#6366f1,#4f46e5);color:white;font-size:15px;font-weight:700;cursor:pointer;letter-spacing:.02em;">→ Analizza</button>' +

    '<div id="da-result" style="margin-top:16px;"></div>' +

    '</div></div>';

  document.body.insertAdjacentHTML('beforeend', html);
}

function closeDeepAnalysis() {
  var m = document.getElementById('da-modal');
  if (m) m.remove();
}

function daSetPeriod(p) {
  var today = new Date(); today.setHours(0,0,0,0);
  var from, to;
  if (p === 'ieri') {
    var d = new Date(today); d.setDate(d.getDate()-1);
    from = to = toISO(d);
  } else if (p === 'weekend') {
    var dow = today.getDay();
    var lastSat = new Date(today); lastSat.setDate(today.getDate() - ((dow+1)%7) - 1);
    var lastFri = new Date(lastSat); lastFri.setDate(lastSat.getDate()-1);
    from = toISO(lastFri); to = toISO(lastSat);
  } else if (p === 'settimana') {
    var d2 = new Date(today); d2.setDate(d2.getDate()-7);
    from = toISO(d2); to = toISO(addDays(today,-1));
  } else if (p === 'mese') {
    var d3 = new Date(today); d3.setDate(d3.getDate()-29);
    from = toISO(d3); to = toISO(addDays(today,-1));
  } else if (p === 'anno') {
    var d4 = new Date(today); d4.setFullYear(d4.getFullYear()-1);
    from = toISO(d4); to = toISO(addDays(today,-1));
  }
  daFromDate = from; daToDate = to;
  var fi = document.getElementById('da-from');
  var ti = document.getElementById('da-to');
  if (fi) fi.value = from;
  if (ti) ti.value = to;
}

function daPopulateDomande() {
  var cat = document.getElementById('da-cat').value;
  var sel = document.getElementById('da-q');
  if (!cat || !DA_CATEGORIES[cat]) {
    sel.innerHTML = '<option value="">— Prima seleziona la categoria —</option>';
    return;
  }
  sel.innerHTML = '<option value="">— Seleziona domanda —</option>' +
    DA_CATEGORIES[cat].map(function(q,i) {
      return '<option value="'+i+'">'+(i+1)+'. '+q.label+'</option>';
    }).join('');
}

async function runDeepAnalysis() {
  var fromVal = document.getElementById('da-from').value || daFromDate;
  var toVal   = document.getElementById('da-to').value   || daToDate;
  var catVal  = document.getElementById('da-cat').value;
  var qIdx    = document.getElementById('da-q').value;
  var res     = document.getElementById('da-result');

  if (!catVal || qIdx === '' || qIdx === null || qIdx === undefined) {
    res.innerHTML = '<div style="background:#fef3c7;border-radius:12px;padding:14px;font-size:13px;color:#92400e;">Seleziona categoria e domanda prima di analizzare.</div>';
    return;
  }
  if (!fromVal || !toVal) {
    res.innerHTML = '<div style="background:#fef3c7;border-radius:12px;padding:14px;font-size:13px;color:#92400e;">Seleziona il periodo.</div>';
    return;
  }

  var q = DA_CATEGORIES[catVal][parseInt(qIdx)];
  if (!q) return;

  res.innerHTML = '<div style="text-align:center;padding:24px;color:#94a3b8;font-size:13px;">Analisi in corso\u2026</div>';

  try {
    var sb = window.supabaseClient;
    var html = await daExecuteQuery(sb, q, fromVal, toVal);
    res.innerHTML = html;
  } catch(e) {
    res.innerHTML = '<div style="background:#fee2e2;border-radius:12px;padding:14px;font-size:13px;color:#991b1b;">Errore: '+e.message+'</div>';
  }
}

async function daExecuteQuery(sb, q, from, to) {
  var f = q.filter || {};
  var qtype = q.query;

  // ── Helper: blocco risultato ────────────────────────────────────────
  function resultBlock(title, content) {
    return '<div style="background:white;border-radius:16px;padding:16px;margin-top:4px;">' +
      '<div style="font-size:10px;font-weight:700;color:#6366f1;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">'+title+'</div>' +
      content +
      '</div>';
  }

  function rowItem(label, val, sub) {
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f8fafc;">' +
      '<div>' +
      '<div style="font-size:13px;font-weight:500;color:#1e293b;">'+label+'</div>' +
      (sub ? '<div style="font-size:10px;color:#94a3b8;">'+sub+'</div>' : '') +
      '</div>' +
      '<div style="font-size:15px;font-weight:700;color:#1e293b;">'+val+'</div>' +
      '</div>';
  }

  function barList(items, labelKey, valKey, maxVal) {
    if (!items || items.length === 0) return '<div style="color:#94a3b8;font-size:13px;text-align:center;padding:16px;">Nessun dato nel periodo selezionato.</div>';
    var max = maxVal || Math.max.apply(null, items.map(function(x){return Number(x[valKey])||0;}));
    return items.map(function(x,i) {
      var v = Number(x[valKey])||0;
      var pct = max>0 ? Math.round((v/max)*100) : 0;
      return '<div style="margin-bottom:10px;">' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:3px;">' +
        '<span style="font-size:12px;font-weight:500;color:#1e293b;max-width:72%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+(i+1)+'. '+x[labelKey]+'</span>' +
        '<span style="font-size:13px;font-weight:700;color:#1e293b;">'+v+'x</span>' +
        '</div>' +
        '<div style="height:5px;background:#f1f5f9;border-radius:3px;overflow:hidden;">' +
        '<div style="width:'+pct+'%;height:100%;background:#6366f1;border-radius:3px;"></div>' +
        '</div></div>';
    }).join('');
  }

  var FOOD_EXCL = ['NA Beverages','The Bar','Mocktail','Happy hours','Wine dinner','Testing menu','Catering','Peach Festival','Resturant week'];

  // ── QUERY: top_item ─────────────────────────────────────────────────
  if (qtype === 'top_item') {
    var groups = f.groups || [];
    var r = await sb.from('pos_sales_by_item').select('menu_item,menu_group,quantity').gte('sale_date',from).lte('sale_date',to).eq('is_historical',false).eq('sales_category','Food');
    var data = (r.data||[]).filter(function(x){ return groups.length===0 || groups.indexOf(x.menu_group)>=0; });
    var agg = {}; data.forEach(function(x){ agg[x.menu_item]=(agg[x.menu_item]||0)+Number(x.quantity); });
    var sorted = Object.entries(agg).sort(function(a,b){return b[1]-a[1];}).slice(0,10);
    var items = sorted.map(function(e){return {menu_item:e[0],qty:e[1]};});
    return resultBlock(q.label, barList(items,'menu_item','qty'));
  }

  // ── QUERY: dish_total ───────────────────────────────────────────────
  if (qtype === 'dish_total') {
    var name = f.name || '';
    var r = await sb.from('pos_sales_by_item').select('menu_item,quantity').gte('sale_date',from).lte('sale_date',to).eq('is_historical',false).ilike('menu_item','%'+name+'%');
    var agg = {}; (r.data||[]).forEach(function(x){ agg[x.menu_item]=(agg[x.menu_item]||0)+Number(x.quantity); });
    var sorted = Object.entries(agg).sort(function(a,b){return b[1]-a[1];});
    var total = sorted.reduce(function(s,e){return s+e[1];},0);
    var rows = sorted.map(function(e){ return rowItem(e[0], e[1]+'x'); }).join('');
    if (!rows) rows = '<div style="color:#94a3b8;font-size:13px;text-align:center;padding:16px;">Nessun dato nel periodo.</div>';
    return resultBlock(q.label, '<div style="background:#f0f4ff;border-radius:10px;padding:12px;text-align:center;margin-bottom:12px;"><span style="font-size:28px;font-weight:800;color:#6366f1;">'+total+'</span><span style="font-size:12px;color:#6366f1;margin-left:6px;">porzioni totali</span></div>'+rows);
  }

  // ── QUERY: cacio_pepe_total ─────────────────────────────────────────
  if (qtype === 'cacio_pepe_total') {
    var r1 = await sb.from('pos_sales_by_item').select('menu_item,quantity').gte('sale_date',from).lte('sale_date',to).eq('is_historical',false).ilike('menu_item','%Cacio%');
    var r2 = await sb.from('pos_modifier_by_item').select('modifier,parent_item,quantity_sold').gte('sale_date',from).lte('sale_date',to).ilike('modifier','%Cacio%');
    var rows1 = (r1.data||[]);
    var agg = {}; rows1.forEach(function(x){ agg[x.menu_item]=(agg[x.menu_item]||0)+Number(x.quantity); });
    var totalIntere = 0; var totalMezze = 0;
    Object.entries(agg).forEach(function(e){
      var name2 = e[0].toLowerCase();
      if (name2.indexOf('half')>=0 || name2.indexOf('child')>=0) totalMezze += e[1];
      else totalIntere += e[1];
    });
    var totalModMezze = (r2.data||[]).reduce(function(s,x){return s+Number(x.quantity_sold);},0);
    totalMezze += totalModMezze;
    var totale = Math.ceil(totalIntere + totalMezze*0.5);
    var dettaglio = Object.entries(agg).map(function(e){
      var isMezza = e[0].toLowerCase().indexOf('half')>=0 || e[0].toLowerCase().indexOf('child')>=0;
      return rowItem(e[0], e[1]+'x', isMezza?'mezza porzione':'porzione intera');
    }).join('');
    if (totalModMezze > 0) dettaglio += rowItem('Come modifier su altri piatti', totalModMezze+'x','mezza porzione');
    return resultBlock('Cacio e Pepe — tutte le versioni',
      '<div style="background:#f0f4ff;border-radius:10px;padding:12px;text-align:center;margin-bottom:12px;"><span style="font-size:28px;font-weight:800;color:#6366f1;">'+totale+'</span><span style="font-size:12px;color:#6366f1;margin-left:6px;">porzioni equivalenti</span></div>'+
      dettaglio);
  }

  // ── QUERY: modifier_total ───────────────────────────────────────────
  if (qtype === 'modifier_total') {
    var mods = f.modifiers || [];
    var r = await sb.from('pos_modifiers').select('modifier,quantity_sold').gte('sale_date',from).lte('sale_date',to).eq('is_historical',false);
    var data = (r.data||[]).filter(function(x){
      return mods.some(function(m){ return x.modifier && x.modifier.toLowerCase().indexOf(m.toLowerCase())>=0; });
    });
    var agg = {}; data.forEach(function(x){ agg[x.modifier]=(agg[x.modifier]||0)+Number(x.quantity_sold); });
    var total = Object.values(agg).reduce(function(s,v){return s+v;},0);
    var rows = Object.entries(agg).sort(function(a,b){return b[1]-a[1];}).map(function(e){ return rowItem(e[0], e[1]+'x'); }).join('');
    if (!rows) rows = '<div style="color:#94a3b8;font-size:13px;text-align:center;padding:16px;">Nessun dato nel periodo.</div>';
    return resultBlock(q.label, '<div style="background:#f0f4ff;border-radius:10px;padding:12px;text-align:center;margin-bottom:12px;"><span style="font-size:28px;font-weight:800;color:#6366f1;">'+total+'</span><span style="font-size:12px;color:#6366f1;margin-left:6px;">volte</span></div>'+rows);
  }

  // ── QUERY: modifier_by_parent ───────────────────────────────────────
  if (qtype === 'modifier_by_parent') {
    var mod = f.modifier || '';
    var r = await sb.from('pos_modifier_by_item').select('modifier,parent_item,quantity_sold').gte('sale_date',from).lte('sale_date',to).ilike('modifier','%'+mod+'%');
    var agg = {}; (r.data||[]).forEach(function(x){ agg[x.parent_item]=(agg[x.parent_item]||0)+Number(x.quantity_sold); });
    var sorted = Object.entries(agg).sort(function(a,b){return b[1]-a[1];}).slice(0,15);
    var items = sorted.map(function(e){return{menu_item:e[0],qty:e[1]};});
    var total = sorted.reduce(function(s,e){return s+e[1];},0);
    var content = '<div style="background:#f0f4ff;border-radius:10px;padding:12px;text-align:center;margin-bottom:12px;"><span style="font-size:28px;font-weight:800;color:#6366f1;">'+total+'</span><span style="font-size:12px;color:#6366f1;margin-left:6px;">volte in totale</span></div>'+barList(items,'menu_item','qty');
    return resultBlock(q.label, content);
  }

  // ── QUERY: contorni_piatto ──────────────────────────────────────────
  if (qtype === 'contorni_piatto') {
    var name2 = f.name || '';
    var r = await sb.from('pos_modifier_by_item').select('modifier,parent_item,quantity_sold').gte('sale_date',from).lte('sale_date',to).ilike('parent_item','%'+name2+'%');
    var agg = {}; (r.data||[]).forEach(function(x){
      var m = x.modifier || '';
      if (m.toLowerCase().indexOf('fired at')>=0) return;
      if (m.toLowerCase().indexOf('room temp')>=0) return;
      agg[m]=(agg[m]||0)+Number(x.quantity_sold);
    });
    var sorted = Object.entries(agg).sort(function(a,b){return b[1]-a[1];}).slice(0,15);
    var items = sorted.map(function(e){return{menu_item:e[0],qty:e[1]};});
    return resultBlock('Richieste su '+name2, barList(items,'menu_item','qty'));
  }

  // ── QUERY: contorno_split_detail ───────────────────────────────────
  if (qtype === 'contorno_split_detail') {
    var mod2 = f.modifier || '';
    var itemName = f.item || mod2;
    var r1 = await sb.from('pos_sales_by_item').select('menu_item,quantity').gte('sale_date',from).lte('sale_date',to).eq('is_historical',false).ilike('menu_item','%'+itemName+'%');
    var r2 = await sb.from('pos_modifiers').select('modifier,quantity_sold').gte('sale_date',from).lte('sale_date',to).eq('is_historical',false).ilike('modifier','%'+mod2+'%');
    var sideQty = (r1.data||[]).reduce(function(s,x){return s+Number(x.quantity);},0);
    var modQty  = (r2.data||[]).reduce(function(s,x){return s+Number(x.quantity_sold);},0);
    var totale  = Math.ceil(sideQty + modQty*0.5);
    return resultBlock(mod2+' — side vs modifier',
      rowItem('Come side (porzione intera)', sideQty+'x') +
      rowItem('Come modifier (mezza porzione)', modQty+'x') +
      '<div style="background:#f0f4ff;border-radius:10px;padding:12px;text-align:center;margin-top:12px;"><span style="font-size:24px;font-weight:800;color:#6366f1;">'+totale+'</span><span style="font-size:12px;color:#6366f1;margin-left:6px;">porzioni equivalenti da preparare</span></div>');
  }

  // ── QUERY: cotture_piatto ───────────────────────────────────────────
  if (qtype === 'cotture_piatto') {
    var name3 = f.name || '';
    var cotture = ['Medium Rare','Medium','Well Done','Medium Well','Med Well','Rare'];
    var r = await sb.from('pos_modifier_by_item').select('modifier,parent_item,quantity_sold').gte('sale_date',from).lte('sale_date',to).ilike('parent_item','%'+name3+'%');
    var agg = {}; (r.data||[]).forEach(function(x){
      var m = x.modifier||'';
      cotture.forEach(function(c){ if (m.toLowerCase().indexOf(c.toLowerCase())>=0) agg[c]=(agg[c]||0)+Number(x.quantity_sold); });
    });
    var total = Object.values(agg).reduce(function(s,v){return s+v;},0);
    var rows = cotture.filter(function(c){return agg[c];}).map(function(c){
      var pct = total>0?((agg[c]/total)*100).toFixed(0):0;
      return rowItem(c, agg[c]+'x', pct+'% delle richieste');
    }).join('');
    if (!rows) rows = '<div style="color:#94a3b8;font-size:13px;text-align:center;padding:16px;">Nessuna cottura specificata nel periodo.</div>';
    return resultBlock('Cotture richieste — '+name3, rows);
  }

  // ── QUERY: summary_covers ──────────────────────────────────────────
  if (qtype === 'summary_covers') {
    var r = await sb.from('pos_daily_summary').select('sale_date,bill_count').gte('sale_date',from).lte('sale_date',to).order('sale_date',{ascending:false});
    var total = (r.data||[]).reduce(function(s,x){return s+(x.bill_count||0);},0);
    var days2 = (r.data||[]).length;
    var rows = (r.data||[]).map(function(x){ return rowItem(dayNameIT(x.sale_date)+' '+x.sale_date.slice(5), (x.bill_count||0)+''); }).join('');
    return resultBlock('Coperti nel periodo',
      '<div style="background:#f0f4ff;border-radius:10px;padding:12px;text-align:center;margin-bottom:12px;"><span style="font-size:36px;font-weight:800;color:#6366f1;">'+total+'</span><span style="font-size:12px;color:#6366f1;margin-left:6px;">coperti · media '+Math.round(total/(days2||1))+'/giorno</span></div>'+rows);
  }

  // ── QUERY: summary_revenue ─────────────────────────────────────────
  if (qtype === 'summary_revenue') {
    var r = await sb.from('pos_daily_summary').select('sale_date,net_sales,bill_count').gte('sale_date',from).lte('sale_date',to).order('sale_date',{ascending:false});
    var total = (r.data||[]).reduce(function(s,x){return s+(Number(x.net_sales)||0);},0);
    var days2 = (r.data||[]).length;
    var rows = (r.data||[]).map(function(x){ return rowItem(dayNameIT(x.sale_date)+' '+x.sale_date.slice(5), fmt(x.net_sales||0)); }).join('');
    return resultBlock('Fatturato nel periodo',
      '<div style="background:#f0f4ff;border-radius:10px;padding:12px;text-align:center;margin-bottom:12px;"><span style="font-size:32px;font-weight:800;color:#6366f1;">'+fmt(total)+'</span><span style="font-size:12px;color:#6366f1;margin-left:6px;">media '+fmt(total/(days2||1))+'/giorno</span></div>'+rows);
  }

  // ── QUERY: summary_check_avg ───────────────────────────────────────
  if (qtype === 'summary_check_avg') {
    var r = await sb.from('pos_daily_summary').select('sale_date,net_sales,bill_count').gte('sale_date',from).lte('sale_date',to);
    var totRev = (r.data||[]).reduce(function(s,x){return s+(Number(x.net_sales)||0);},0);
    var totCov = (r.data||[]).reduce(function(s,x){return s+(Number(x.bill_count)||0);},0);
    var avg = totCov>0 ? totRev/totCov : 0;
    var rows = (r.data||[]).filter(function(x){return x.bill_count;}).sort(function(a,b){
      var ca=(a.net_sales||0)/(a.bill_count||1); var cb=(b.net_sales||0)/(b.bill_count||1); return cb-ca;
    }).map(function(x){
      var chk=(x.net_sales||0)/(x.bill_count||1);
      return rowItem(dayNameIT(x.sale_date)+' '+x.sale_date.slice(5), fmtD(chk), x.bill_count+' coperti');
    }).join('');
    return resultBlock('Check medio nel periodo',
      '<div style="background:#f0f4ff;border-radius:10px;padding:12px;text-align:center;margin-bottom:12px;"><span style="font-size:36px;font-weight:800;color:#6366f1;">'+fmtD(avg)+'</span></div>'+rows);
  }

  // ── QUERY: best_day_covers / worst_day_covers ──────────────────────
  if (qtype === 'best_day_covers' || qtype === 'worst_day_covers') {
    var r = await sb.from('pos_daily_summary').select('sale_date,bill_count,net_sales').gte('sale_date',from).lte('sale_date',to);
    var data = (r.data||[]).filter(function(x){return x.bill_count;}).sort(function(a,b){
      return qtype==='best_day_covers' ? b.bill_count-a.bill_count : a.bill_count-b.bill_count;
    });
    var rows = data.slice(0,10).map(function(x){ return rowItem(dayNameIT(x.sale_date)+' '+x.sale_date.slice(5), x.bill_count+'', fmt(x.net_sales||0)); }).join('');
    return resultBlock(q.label, rows||'<div style="color:#94a3b8;text-align:center;padding:16px;">Nessun dato.</div>');
  }

  // ── QUERY: best_day_revenue ────────────────────────────────────────
  if (qtype === 'best_day_revenue') {
    var r = await sb.from('pos_daily_summary').select('sale_date,bill_count,net_sales').gte('sale_date',from).lte('sale_date',to);
    var data = (r.data||[]).sort(function(a,b){return (b.net_sales||0)-(a.net_sales||0);});
    var rows = data.slice(0,10).map(function(x){ return rowItem(dayNameIT(x.sale_date)+' '+x.sale_date.slice(5), fmt(x.net_sales||0), x.bill_count+' coperti'); }).join('');
    return resultBlock(q.label, rows||'<div style="color:#94a3b8;text-align:center;padding:16px;">Nessun dato.</div>');
  }

  // ── QUERY: yoy_same_day ────────────────────────────────────────────
  if (qtype === 'yoy_same_day') {
    var r1 = await sb.from('pos_daily_summary').select('*').gte('sale_date',from).lte('sale_date',to);
    var prevFrom = from.replace(/^(\d{4})/,function(m,y){return (parseInt(y)-1)+'';});
    var prevTo   = to.replace(/^(\d{4})/,function(m,y){return (parseInt(y)-1)+'';});
    var r2 = await sb.from('pos_daily_summary').select('*').gte('sale_date',prevFrom).lte('sale_date',prevTo);
    var cur = r1.data||[]; var prev = r2.data||[];
    var cRev=(cur.reduce(function(s,x){return s+(x.net_sales||0);},0));
    var pRev=(prev.reduce(function(s,x){return s+(x.net_sales||0);},0));
    var cCov=(cur.reduce(function(s,x){return s+(x.bill_count||0);},0));
    var pCov=(prev.reduce(function(s,x){return s+(x.bill_count||0);},0));
    var revDiff = pRev>0?((cRev-pRev)/pRev*100):null;
    var covDiff = pCov>0?((cCov-pCov)/pCov*100):null;
    function pct(v) { if(v===null) return '—'; return (v>=0?'+':'')+v.toFixed(0)+'%'; }
    function col(v) { if(v===null) return '#94a3b8'; return v>=0?'#059669':'#dc2626'; }
    return resultBlock('Confronto anno su anno',
      rowItem('Fatturato '+from.slice(0,4), fmt(cRev), 'Anno scorso: '+fmt(pRev)+'  <span style="color:'+col(revDiff)+'">'+pct(revDiff)+'</span>') +
      rowItem('Coperti '+from.slice(0,4), cCov+'', 'Anno scorso: '+pCov+'  <span style="color:'+col(covDiff)+'">'+pct(covDiff)+'</span>'));
  }

  // ── QUERY: record_covers ───────────────────────────────────────────
  if (qtype === 'record_covers') {
    var r = await sb.from('pos_daily_summary').select('sale_date,bill_count,net_sales').order('bill_count',{ascending:false}).limit(10);
    var rows = (r.data||[]).map(function(x,i){ return rowItem((i+1)+'. '+dayNameIT(x.sale_date)+' '+x.sale_date, x.bill_count+'', fmt(x.net_sales||0)); }).join('');
    return resultBlock('Record assoluti di coperti', rows);
  }

  // ── QUERY: record_revenue ──────────────────────────────────────────
  if (qtype === 'record_revenue') {
    var r = await sb.from('pos_daily_summary').select('sale_date,bill_count,net_sales').order('net_sales',{ascending:false}).limit(10);
    var rows = (r.data||[]).map(function(x,i){ return rowItem((i+1)+'. '+dayNameIT(x.sale_date)+' '+x.sale_date, fmt(x.net_sales||0), x.bill_count+' coperti'); }).join('');
    return resultBlock('Record assoluti di fatturato', rows);
  }

  // ── QUERY: trend_dish ─────────────────────────────────────────────
  if (qtype === 'trend_dish') {
    var name4 = f.name || '';
    var r = await sb.from('pos_sales_by_item').select('sale_date,menu_item,quantity').gte('sale_date',from).lte('sale_date',to).eq('is_historical',false).ilike('menu_item','%'+name4+'%');
    var byDate = {}; (r.data||[]).forEach(function(x){ byDate[x.sale_date]=(byDate[x.sale_date]||0)+Number(x.quantity); });
    var sorted = Object.entries(byDate).sort(function(a,b){return a[0].localeCompare(b[0]);});
    var rows = sorted.map(function(e){ return rowItem(dayNameIT(e[0])+' '+e[0].slice(5), e[1]+'x'); }).join('');
    var total = sorted.reduce(function(s,e){return s+e[1];},0);
    if (!rows) rows = '<div style="color:#94a3b8;text-align:center;padding:16px;">Nessun dato nel periodo.</div>';
    return resultBlock('Trend: '+name4,
      '<div style="background:#f0f4ff;border-radius:10px;padding:12px;text-align:center;margin-bottom:12px;"><span style="font-size:28px;font-weight:800;color:#6366f1;">'+total+'x</span><span style="font-size:12px;color:#6366f1;margin-left:6px;">totale nel periodo</span></div>'+rows);
  }

  // ── QUERY: trend_modifier ─────────────────────────────────────────
  if (qtype === 'trend_modifier') {
    var mod3 = f.modifier || '';
    var r = await sb.from('pos_modifiers').select('sale_date,modifier,quantity_sold').gte('sale_date',from).lte('sale_date',to).eq('is_historical',false).ilike('modifier','%'+mod3+'%');
    var byDate = {}; (r.data||[]).forEach(function(x){ byDate[x.sale_date]=(byDate[x.sale_date]||0)+Number(x.quantity_sold); });
    var sorted = Object.entries(byDate).sort(function(a,b){return a[0].localeCompare(b[0]);});
    var rows = sorted.map(function(e){ return rowItem(dayNameIT(e[0])+' '+e[0].slice(5), e[1]+'x'); }).join('');
    var total = sorted.reduce(function(s,e){return s+e[1];},0);
    if (!rows) rows = '<div style="color:#94a3b8;text-align:center;padding:16px;">Nessun dato nel periodo.</div>';
    return resultBlock('Trend: '+mod3, '<div style="background:#f0f4ff;border-radius:10px;padding:12px;text-align:center;margin-bottom:12px;"><span style="font-size:28px;font-weight:800;color:#6366f1;">'+total+'x</span></div>'+rows);
  }

  // ── QUERY: ranking_by_group ────────────────────────────────────────
  if (qtype === 'ranking_by_group') {
    var groups2 = f.groups || [];
    var r = await sb.from('pos_sales_by_item').select('menu_item,menu_group,quantity').gte('sale_date',from).lte('sale_date',to).eq('is_historical',false).eq('sales_category','Food');
    var data = (r.data||[]).filter(function(x){ return groups2.indexOf(x.menu_group)>=0; });
    var agg = {}; data.forEach(function(x){ agg[x.menu_item]=(agg[x.menu_item]||0)+Number(x.quantity); });
    var sorted = Object.entries(agg).sort(function(a,b){return b[1]-a[1];});
    var items = sorted.map(function(e){return{menu_item:e[0],qty:e[1]};});
    return resultBlock(q.label, barList(items,'menu_item','qty'));
  }

  // ── QUERY: classifica_modifier ────────────────────────────────────
  if (qtype === 'classifica_modifier') {
    var mods2 = f.modifiers || [];
    var r = await sb.from('pos_modifiers').select('modifier,quantity_sold').gte('sale_date',from).lte('sale_date',to).eq('is_historical',false);
    var data = mods2.length>0 ? (r.data||[]).filter(function(x){
      return mods2.some(function(m){ return x.modifier && x.modifier.toLowerCase().indexOf(m.toLowerCase())>=0; });
    }) : (r.data||[]);
    var agg = {}; data.forEach(function(x){ agg[x.modifier]=(agg[x.modifier]||0)+Number(x.quantity_sold); });
    var sorted = Object.entries(agg).sort(function(a,b){return b[1]-a[1];}).slice(0,15);
    var items = sorted.map(function(e){return{menu_item:e[0],qty:e[1]};});
    return resultBlock(q.label, barList(items,'menu_item','qty'));
  }

  // ── QUERY: items_per_cover ────────────────────────────────────────
  if (qtype === 'items_per_cover') {
    var groups3 = f.groups || []; var kitchen_cat = f.kitchen_cat || '';
    var rCov = await sb.from('pos_daily_summary').select('bill_count').gte('sale_date',from).lte('sale_date',to);
    var totalCovers2 = (rCov.data||[]).reduce(function(s,x){return s+(x.bill_count||0);},0);
    var totalItems = 0;
    if (groups3.length > 0) {
      var rI = await sb.from('pos_sales_by_item').select('quantity,menu_group').gte('sale_date',from).lte('sale_date',to).eq('is_historical',false).eq('sales_category','Food');
      totalItems = (rI.data||[]).filter(function(x){return groups3.indexOf(x.menu_group)>=0;}).reduce(function(s,x){return s+Number(x.quantity);},0);
    }
    var avg = totalCovers2>0 ? (totalItems/totalCovers2).toFixed(2) : '—';
    return resultBlock(q.label,
      '<div style="background:#f0f4ff;border-radius:10px;padding:16px;text-align:center;">' +
      '<div style="font-size:36px;font-weight:800;color:#6366f1;">'+avg+'</div>' +
      '<div style="font-size:12px;color:#6366f1;margin-top:4px;">per coperto</div>' +
      '<div style="font-size:11px;color:#94a3b8;margin-top:8px;">'+totalItems+' totali · '+totalCovers2+' coperti</div>' +
      '</div>');
  }

  // ── QUERY: best_month_historical / worst_month_historical ──────────
  if (qtype === 'best_month_historical' || qtype === 'worst_month_historical') {
    var r = await sb.from('pos_daily_summary').select('sale_date,net_sales,bill_count');
    var byMonth = {}; (r.data||[]).forEach(function(x){
      var m = x.sale_date.slice(0,7);
      if (!byMonth[m]) byMonth[m]={rev:0,cov:0};
      byMonth[m].rev += Number(x.net_sales)||0;
      byMonth[m].cov += Number(x.bill_count)||0;
    });
    var sorted = Object.entries(byMonth).sort(function(a,b){
      return qtype==='best_month_historical' ? b[1].rev-a[1].rev : a[1].rev-b[1].rev;
    }).slice(0,10);
    var rows = sorted.map(function(e,i){ return rowItem((i+1)+'. '+e[0], fmt(e[1].rev), e[1].cov+' coperti'); }).join('');
    return resultBlock(q.label, rows);
  }

  // ── QUERY: avg_by_dow_covers / avg_by_dow_revenue ─────────────────
  if (qtype === 'avg_by_dow_covers' || qtype === 'avg_by_dow_revenue') {
    var r = await sb.from('pos_daily_summary').select('sale_date,net_sales,bill_count').gte('sale_date',from).lte('sale_date',to);
    var dow_names = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
    var byDow = {}; (r.data||[]).forEach(function(x){
      var d = new Date(x.sale_date+'T12:00:00').getDay();
      if (!byDow[d]) byDow[d]={sum:0,cnt:0};
      byDow[d].sum += qtype==='avg_by_dow_covers' ? (Number(x.bill_count)||0) : (Number(x.net_sales)||0);
      byDow[d].cnt++;
    });
    var rows = [1,2,3,4,5,6,0].filter(function(d){return byDow[d];}).map(function(d){
      var avg2 = byDow[d].cnt>0 ? byDow[d].sum/byDow[d].cnt : 0;
      return rowItem(dow_names[d], qtype==='avg_by_dow_covers' ? Math.round(avg2)+'' : fmt(avg2), byDow[d].cnt+' giorni');
    }).join('');
    return resultBlock(q.label, rows||'<div style="color:#94a3b8;text-align:center;padding:16px;">Nessun dato.</div>');
  }

  // ── QUERY: top_10_all_time ────────────────────────────────────────
  if (qtype === 'top_10_all_time') {
    var r = await sb.from('pos_sales_by_item').select('menu_item,quantity,sales_category').eq('is_historical',false);
    var agg = {}; (r.data||[]).forEach(function(x){ agg[x.menu_item]=(agg[x.menu_item]||0)+Number(x.quantity); });
    var sorted = Object.entries(agg).sort(function(a,b){return b[1]-a[1];}).slice(0,10);
    var items = sorted.map(function(e){return{menu_item:e[0],qty:e[1]};});
    return resultBlock('Top 10 piatti di sempre', barList(items,'menu_item','qty'));
  }

  // ── QUERY: best_dow_historical ────────────────────────────────────
  if (qtype === 'best_dow_historical') {
    var r = await sb.from('pos_daily_summary').select('sale_date,net_sales,bill_count');
    var dow_names = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
    var byDow2 = {};
    (r.data||[]).forEach(function(x){
      var d = new Date(x.sale_date+'T12:00:00').getDay();
      if (!byDow2[d]) byDow2[d]={rev:0,cov:0,cnt:0};
      byDow2[d].rev += Number(x.net_sales)||0;
      byDow2[d].cov += Number(x.bill_count)||0;
      byDow2[d].cnt++;
    });
    var rows = [1,2,3,4,5,6,0].filter(function(d){return byDow2[d];}).sort(function(a,b){
      var ra=byDow2[a].rev/byDow2[a].cnt; var rb=byDow2[b].rev/byDow2[b].cnt; return rb-ra;
    }).map(function(d,i){
      var avgR=byDow2[d].rev/byDow2[d].cnt; var avgC=byDow2[d].cov/byDow2[d].cnt;
      return rowItem((i+1)+'. '+dow_names[d], fmt(avgR)+' avg', Math.round(avgC)+' coperti avg · '+byDow2[d].cnt+' date');
    }).join('');
    return resultBlock(q.label, rows);
  }

  // ── QUERY: days_above_threshold ────────────────────────────────────
  if (qtype === 'days_above_threshold') {
    var thresh = f.threshold || 0; var field = f.field || 'bill_count';
    var r = await sb.from('pos_daily_summary').select('sale_date,bill_count,net_sales,discounts').order('sale_date',{ascending:false});
    var data = (r.data||[]).filter(function(x){ return (Number(x[field])||0) > thresh; });
    var rows = data.slice(0,20).map(function(x){
      var val = field==='bill_count' ? x.bill_count+' coperti' : fmt(x.net_sales||0);
      var sub = field==='bill_count' ? fmt(x.net_sales||0) : x.bill_count+' coperti';
      return rowItem(dayNameIT(x.sale_date)+' '+x.sale_date, val, sub);
    }).join('');
    return resultBlock(q.label,
      '<div style="background:#f0f4ff;border-radius:10px;padding:12px;text-align:center;margin-bottom:12px;"><span style="font-size:36px;font-weight:800;color:#6366f1;">'+data.length+'</span><span style="font-size:12px;color:#6366f1;margin-left:6px;">volte</span></div>'+
      (rows||'<div style="color:#94a3b8;text-align:center;padding:16px;">Mai successo nel periodo.</div>'));
  }

  // ── QUERY: days_below_threshold ────────────────────────────────────
  if (qtype === 'days_below_threshold') {
    var thresh = f.threshold || 30; var field = f.field || 'bill_count';
    var r = await sb.from('pos_daily_summary').select('sale_date,bill_count,net_sales').order('sale_date',{ascending:false});
    var data = (r.data||[]).filter(function(x){ return (Number(x[field])||0) > 0 && (Number(x[field])||0) < thresh; });
    var rows = data.slice(0,20).map(function(x){
      return rowItem(dayNameIT(x.sale_date)+' '+x.sale_date, x.bill_count+' coperti', fmt(x.net_sales||0));
    }).join('');
    return resultBlock(q.label,
      '<div style="background:#f0f4ff;border-radius:10px;padding:12px;text-align:center;margin-bottom:12px;"><span style="font-size:36px;font-weight:800;color:#6366f1;">'+data.length+'</span><span style="font-size:12px;color:#6366f1;margin-left:6px;">giorni sotto soglia</span></div>'+
      (rows||'<div style="color:#94a3b8;text-align:center;padding:16px;">Nessun giorno sotto la soglia.</div>'));
  }

  // ── QUERY: vs_recent_avg ───────────────────────────────────────────
  if (qtype === 'vs_recent_avg') {
    var dow = f.dow || 6; var weeks = f.weeks || 4;
    var today = new Date(); today.setHours(0,0,0,0);
    var dowNames = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
    var daysBack = ((today.getDay() - dow + 7) % 7) || 7;
    var lastDate = new Date(today); lastDate.setDate(today.getDate()-daysBack);
    var lastISO = toISO(lastDate);
    var prevDates = [];
    for (var w=1; w<=weeks; w++) { var pd=new Date(lastDate); pd.setDate(lastDate.getDate()-7*w); prevDates.push(toISO(pd)); }
    var r1 = await sb.from('pos_daily_summary').select('sale_date,bill_count,net_sales').eq('sale_date',lastISO);
    var r2 = await sb.from('pos_daily_summary').select('sale_date,bill_count,net_sales').in('sale_date',prevDates);
    var cur = (r1.data||[])[0]; var prev = r2.data||[];
    if (!cur) return resultBlock(q.label,'<div style="color:#94a3b8;text-align:center;padding:16px;">Nessun dato per '+dowNames[dow]+' scorso.</div>');
    var avgCov = prev.length>0 ? prev.reduce(function(s,x){return s+(x.bill_count||0);},0)/prev.length : 0;
    var avgRev = prev.length>0 ? prev.reduce(function(s,x){return s+(x.net_sales||0);},0)/prev.length : 0;
    var diffCov = avgCov>0 ? ((cur.bill_count-avgCov)/avgCov*100) : null;
    var diffRev = avgRev>0 ? ((cur.net_sales-avgRev)/avgRev*100) : null;
    function arrow(v) { if(v===null) return '—'; var c=v>=0?'#059669':'#dc2626'; return '<span style="color:'+c+'">'+(v>=0?'▲':'▼')+' '+Math.abs(v).toFixed(0)+'%</span>'; }
    return resultBlock(dowNames[dow]+' scorso vs media '+weeks+' '+dowNames[dow]+' precedenti',
      rowItem('Coperti '+dowNames[dow]+' scorso', cur.bill_count+'', 'Media: '+Math.round(avgCov)+'  '+arrow(diffCov))+
      rowItem('Fatturato '+dowNames[dow]+' scorso', fmt(cur.net_sales||0), 'Media: '+fmt(avgRev)+'  '+arrow(diffRev)));
  }

  // ── QUERY: weekday_above_threshold ─────────────────────────────────
  if (qtype === 'weekday_above_threshold') {
    var thresh = f.threshold || 10000;
    var r = await sb.from('pos_daily_summary').select('sale_date,bill_count,net_sales').order('net_sales',{ascending:false});
    var data = (r.data||[]).filter(function(x){
      var dow2 = new Date(x.sale_date+'T12:00:00').getDay();
      return dow2>=1 && dow2<=4 && (Number(x.net_sales)||0) > thresh;
    });
    var rows = data.slice(0,15).map(function(x){
      return rowItem(dayNameIT(x.sale_date)+' '+x.sale_date, fmt(x.net_sales||0), x.bill_count+' coperti');
    }).join('');
    return resultBlock(q.label,
      '<div style="background:#f0f4ff;border-radius:10px;padding:12px;text-align:center;margin-bottom:12px;"><span style="font-size:36px;font-weight:800;color:#6366f1;">'+data.length+'</span><span style="font-size:12px;color:#6366f1;margin-left:6px;">volte</span></div>'+
      (rows||'<div style="color:#94a3b8;text-align:center;padding:16px;">Mai successo.</div>'));
  }

  // ── QUERY: check_avg_compare_dow ───────────────────────────────────
  if (qtype === 'check_avg_compare_dow') {
    var dow1 = f.dow1 || 6; var dow2 = f.dow2 || 1;
    var dowNames = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
    var r = await sb.from('pos_daily_summary').select('sale_date,bill_count,net_sales').gte('sale_date',from).lte('sale_date',to);
    var g1=[],g2=[];
    (r.data||[]).forEach(function(x){
      var dw=new Date(x.sale_date+'T12:00:00').getDay();
      if(dw===dow1 && x.bill_count) g1.push(x);
      if(dw===dow2 && x.bill_count) g2.push(x);
    });
    function avgChk(g){ var r=g.reduce(function(s,x){return s+(x.net_sales||0);},0); var c=g.reduce(function(s,x){return s+(x.bill_count||0);},0); return c>0?r/c:0; }
    var a1=avgChk(g1); var a2=avgChk(g2);
    var diff=a2>0?((a1-a2)/a2*100):null;
    function arrow2(v){if(v===null)return '—';var c=v>=0?'#059669':'#dc2626';return '<span style="color:'+c+'">'+(v>=0?'▲':'▼')+' '+Math.abs(v).toFixed(0)+'%</span>';}
    return resultBlock('Check medio: '+dowNames[dow1]+' vs '+dowNames[dow2],
      rowItem(dowNames[dow1]+' ('+g1.length+' date)', fmtD(a1))+
      rowItem(dowNames[dow2]+' ('+g2.length+' date)', fmtD(a2))+
      '<div style="background:#f0f4ff;border-radius:10px;padding:12px;text-align:center;margin-top:12px;"><span style="font-size:13px;color:#6366f1;">Differenza: '+fmtD(Math.abs(a1-a2))+' '+arrow2(diff)+'</span></div>');
  }

  // ── QUERY: variability_dow ─────────────────────────────────────────
  if (qtype === 'variability_dow') {
    var dow = f.dow || 2;
    var dowNames = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
    var r = await sb.from('pos_daily_summary').select('sale_date,bill_count,net_sales').gte('sale_date',from).lte('sale_date',to);
    var data = (r.data||[]).filter(function(x){ return new Date(x.sale_date+'T12:00:00').getDay()===dow && x.bill_count; });
    if (data.length<2) return resultBlock(q.label,'<div style="color:#94a3b8;text-align:center;padding:16px;">Dati insufficienti (servono almeno 2 '+dowNames[dow]+').</div>');
    var vals = data.map(function(x){return x.bill_count||0;});
    var avg = vals.reduce(function(s,v){return s+v;},0)/vals.length;
    var min = Math.min.apply(null,vals); var max = Math.max.apply(null,vals);
    var variance = vals.reduce(function(s,v){return s+Math.pow(v-avg,2);},0)/vals.length;
    var std = Math.sqrt(variance);
    var rows = data.sort(function(a,b){return b.bill_count-a.bill_count;}).map(function(x){
      return rowItem(dayNameIT(x.sale_date)+' '+x.sale_date, x.bill_count+' cop');
    }).join('');
    return resultBlock(dowNames[dow]+' — variabilità coperti ('+data.length+' date)',
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center;margin-bottom:12px;">'+
      '<div style="background:#f0f4ff;border-radius:10px;padding:10px;"><div style="font-size:10px;color:#94a3b8;">Media</div><div style="font-size:20px;font-weight:800;color:#6366f1;">'+Math.round(avg)+'</div></div>'+
      '<div style="background:#f0f4ff;border-radius:10px;padding:10px;"><div style="font-size:10px;color:#94a3b8;">Min</div><div style="font-size:20px;font-weight:800;color:#dc2626;">'+min+'</div></div>'+
      '<div style="background:#f0f4ff;border-radius:10px;padding:10px;"><div style="font-size:10px;color:#94a3b8;">Max</div><div style="font-size:20px;font-weight:800;color:#059669;">'+max+'</div></div>'+
      '</div>'+
      '<div style="font-size:11px;color:#94a3b8;text-align:center;margin-bottom:12px;">Dev. standard: '+std.toFixed(1)+' coperti</div>'+rows);
  }

  // ── QUERY: worst_weekend_6m / best_weekend_6m ──────────────────────
  if (qtype === 'worst_weekend_6m' || qtype === 'best_weekend_6m') {
    var sixMoAgo = new Date(); sixMoAgo.setMonth(sixMoAgo.getMonth()-6);
    var r = await sb.from('pos_daily_summary').select('sale_date,bill_count,net_sales').gte('sale_date',toISO(sixMoAgo));
    var weekends = {};
    (r.data||[]).forEach(function(x){
      var dw = new Date(x.sale_date+'T12:00:00').getDay();
      if (dw!==5 && dw!==6) return;
      var d = new Date(x.sale_date+'T12:00:00');
      var fri = new Date(d); fri.setDate(d.getDate()-(dw===5?0:1));
      var key = toISO(fri);
      if (!weekends[key]) weekends[key]={rev:0,cov:0};
      weekends[key].rev += Number(x.net_sales)||0;
      weekends[key].cov += Number(x.bill_count)||0;
    });
    var sorted = Object.entries(weekends).sort(function(a,b){
      return qtype==='best_weekend_6m' ? b[1].rev-a[1].rev : a[1].rev-b[1].rev;
    }).slice(0,5);
    var rows = sorted.map(function(e,i){
      return rowItem((i+1)+'. Weekend '+e[0].slice(5), fmt(e[1].rev), e[1].cov+' coperti totali');
    }).join('');
    return resultBlock(q.label, rows||'<div style="color:#94a3b8;text-align:center;padding:16px;">Nessun dato.</div>');
  }

  // ── QUERY: high_discount_days ──────────────────────────────────────
  if (qtype === 'high_discount_days') {
    var r = await sb.from('pos_daily_summary').select('sale_date,bill_count,net_sales,discounts').gte('sale_date',from).lte('sale_date',to);
    var data = (r.data||[]).filter(function(x){
      var gross = (Number(x.net_sales)||0)+(Number(x.discounts)||0);
      return gross>0 && (Number(x.discounts)||0)/gross > 0.10;
    }).sort(function(a,b){
      var ga=(Number(a.net_sales)||0)+(Number(a.discounts)||0);
      var gb=(Number(b.net_sales)||0)+(Number(b.discounts)||0);
      var pa=ga>0?(Number(a.discounts)||0)/ga:0;
      var pb=gb>0?(Number(b.discounts)||0)/gb:0;
      return pb-pa;
    });
    var rows = data.map(function(x){
      var gross=(Number(x.net_sales)||0)+(Number(x.discounts)||0);
      var pct=gross>0?((Number(x.discounts)||0)/gross*100).toFixed(0):0;
      return rowItem(dayNameIT(x.sale_date)+' '+x.sale_date, fmt(x.discounts||0)+' sconto', pct+'% del lordo · '+x.bill_count+' cop');
    }).join('');
    return resultBlock(q.label,
      '<div style="background:#fef3c7;border-radius:10px;padding:12px;text-align:center;margin-bottom:12px;"><span style="font-size:28px;font-weight:800;color:#d97706;">'+data.length+'</span><span style="font-size:12px;color:#d97706;margin-left:6px;">giorni con sconto anomalo (>10%)</span></div>'+
      (rows||'<div style="color:#94a3b8;text-align:center;padding:16px;">Nessun giorno con sconti anomali.</div>'));
  }

  // ── QUERY: dish_consistency_dow ────────────────────────────────────
  if (qtype === 'dish_consistency_dow') {
    var name5=f.name||''; var dow=f.dow||6;
    var dowNames=['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
    var r1=await sb.from('pos_sales_by_item').select('sale_date,menu_item,quantity').gte('sale_date',from).lte('sale_date',to).eq('is_historical',false).ilike('menu_item','%'+name5+'%');
    var r2=await sb.from('pos_sales_by_item').select('sale_date,menu_item,quantity').gte('sale_date',from).lte('sale_date',to).eq('is_historical',false).eq('sales_category','Food');
    var targetDates={};
    (r1.data||[]).forEach(function(x){
      if(new Date(x.sale_date+'T12:00:00').getDay()===dow){
        targetDates[x.sale_date]=(targetDates[x.sale_date]||0)+Number(x.quantity);
      }
    });
    var allDowDates={};
    (r2.data||[]).forEach(function(x){
      if(new Date(x.sale_date+'T12:00:00').getDay()===dow){
        if(!allDowDates[x.sale_date])allDowDates[x.sale_date]={};
        allDowDates[x.sale_date][x.menu_item]=(allDowDates[x.sale_date][x.menu_item]||0)+Number(x.quantity);
      }
    });
    var n1stDates=0;
    Object.entries(allDowDates).forEach(function(e){
      var sorted=Object.entries(e[1]).sort(function(a,b){return b[1]-a[1];});
      if(sorted.length>0 && sorted[0][0].toLowerCase().indexOf(name5.toLowerCase())>=0) n1stDates++;
    });
    var totalDow=Object.keys(allDowDates).length;
    var rows=Object.entries(targetDates).sort(function(a,b){return b[1]-a[1];}).map(function(e){
      return rowItem(dayNameIT(e[0])+' '+e[0].slice(5),e[1]+'x');
    }).join('');
    return resultBlock(name5+' — consistenza il '+dowNames[dow],
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">'+
      '<div style="background:#f0f4ff;border-radius:10px;padding:10px;text-align:center;"><div style="font-size:10px;color:#94a3b8;">Presenze</div><div style="font-size:24px;font-weight:800;color:#6366f1;">'+Object.keys(targetDates).length+'/'+totalDow+'</div><div style="font-size:10px;color:#94a3b8;">'+dowNames[dow]+'</div></div>'+
      '<div style="background:#f0f4ff;border-radius:10px;padding:10px;text-align:center;"><div style="font-size:10px;color:#94a3b8;">#1 il '+dowNames[dow]+'</div><div style="font-size:24px;font-weight:800;color:#6366f1;">'+n1stDates+'/'+totalDow+'</div><div style="font-size:10px;color:#94a3b8;">volte primo</div></div>'+
      '</div>'+rows);
  }

  // ── QUERY: dish_best_dow ───────────────────────────────────────────
  if (qtype === 'dish_best_dow') {
    var name6=f.name||'';
    var dowNames=['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
    var r=await sb.from('pos_sales_by_item').select('sale_date,menu_item,quantity').gte('sale_date',from).lte('sale_date',to).eq('is_historical',false).ilike('menu_item','%'+name6+'%');
    var byDow={};
    (r.data||[]).forEach(function(x){
      var dw=new Date(x.sale_date+'T12:00:00').getDay();
      if(!byDow[dw])byDow[dw]={sum:0,cnt:0};
      byDow[dw].sum+=Number(x.quantity)||0;
      byDow[dw].cnt++;
    });
    var rows=[0,1,2,3,4,5,6].filter(function(d){return byDow[d];}).sort(function(a,b){
      var ra=byDow[a].sum/byDow[a].cnt; var rb=byDow[b].sum/byDow[b].cnt; return rb-ra;
    }).map(function(d,i){
      var avg=(byDow[d].sum/byDow[d].cnt).toFixed(1);
      return rowItem((i+1)+'. '+dowNames[d],avg+'x avg',byDow[d].cnt+' date · '+byDow[d].sum+'x totale');
    }).join('');
    return resultBlock(name6+' — giorno migliore', rows||'<div style="color:#94a3b8;text-align:center;padding:16px;">Nessun dato.</div>');
  }

  // ── QUERY: dish_seasonal ───────────────────────────────────────────
  if (qtype === 'dish_seasonal') {
    var name7=f.name||'';
    var r=await sb.from('pos_sales_by_item').select('sale_date,menu_item,quantity').eq('is_historical',false).ilike('menu_item','%'+name7+'%');
    var seasons={estate:{sum:0,cnt:0},autunno:{sum:0,cnt:0},inverno:{sum:0,cnt:0},primavera:{sum:0,cnt:0}};
    (r.data||[]).forEach(function(x){
      var mo=new Date(x.sale_date+'T12:00:00').getMonth();
      var s=mo>=5&&mo<=7?'estate':mo>=8&&mo<=10?'autunno':mo>=11||mo<=1?'inverno':'primavera';
      seasons[s].sum+=Number(x.quantity)||0; seasons[s].cnt++;
    });
    var rows=['estate','primavera','autunno','inverno'].map(function(s){
      var avg=seasons[s].cnt>0?(seasons[s].sum/seasons[s].cnt).toFixed(1):'—';
      var emoji={estate:'☀️',primavera:'🌸',autunno:'🍂',inverno:'❄️'}[s];
      return rowItem(emoji+' '+s.charAt(0).toUpperCase()+s.slice(1),avg+'x avg',seasons[s].sum+'x totale · '+seasons[s].cnt+' serate');
    }).join('');
    return resultBlock(name7+' — stagionalità', rows);
  }

  // ── QUERY: best_ever_dow_list ──────────────────────────────────────
  if (qtype === 'best_ever_dow_list') {
    var dow=f.dow||6;
    var dowNames=['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
    var r=await sb.from('pos_daily_summary').select('sale_date,bill_count,net_sales').order('bill_count',{ascending:false});
    var data=(r.data||[]).filter(function(x){return new Date(x.sale_date+'T12:00:00').getDay()===dow;}).slice(0,5);
    var rows=data.map(function(x,i){return rowItem((i+1)+'. '+dayNameIT(x.sale_date)+' '+x.sale_date,x.bill_count+' coperti',fmt(x.net_sales||0));}).join('');
    return resultBlock('Top 5 '+dowNames[dow]+' per coperti di sempre', rows||'<div style="color:#94a3b8;text-align:center;padding:16px;">Nessun dato.</div>');
  }

  // ── QUERY: best_ever_dow_revenue ──────────────────────────────────
  if (qtype === 'best_ever_dow_revenue') {
    var dow=f.dow||5;
    var dowNames=['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
    var r=await sb.from('pos_daily_summary').select('sale_date,bill_count,net_sales').order('net_sales',{ascending:false});
    var data=(r.data||[]).filter(function(x){return new Date(x.sale_date+'T12:00:00').getDay()===dow;}).slice(0,5);
    var rows=data.map(function(x,i){return rowItem((i+1)+'. '+dayNameIT(x.sale_date)+' '+x.sale_date,fmt(x.net_sales||0),x.bill_count+' coperti');}).join('');
    return resultBlock('Top 5 '+dowNames[dow]+' per fatturato di sempre', rows||'<div style="color:#94a3b8;text-align:center;padding:16px;">Nessun dato.</div>');
  }

  // ── QUERY: top_modifier_all_time ───────────────────────────────────
  if (qtype === 'top_modifier_all_time') {
    var r=await sb.from('pos_modifiers').select('modifier,quantity_sold').eq('is_historical',false);
    var agg={};
    (r.data||[]).forEach(function(x){agg[x.modifier]=(agg[x.modifier]||0)+Number(x.quantity_sold);});
    var sorted=Object.entries(agg).sort(function(a,b){return b[1]-a[1];}).slice(0,15);
    var items=sorted.map(function(e){return{menu_item:e[0],qty:e[1]};});
    return resultBlock(q.label, barList(items,'menu_item','qty'));
  }

  // ── QUERY: top_modifier_all_time_cat ──────────────────────────────
  if (qtype === 'top_modifier_all_time_cat') {
    var kcat=f.kitchen_cat||'Contorni';
    var rCfg=await sb.from('modifier_config').select('modifier,kitchen_cat').eq('is_kitchen',true).eq('kitchen_cat',kcat);
    var modNames=(rCfg.data||[]).map(function(x){return x.modifier;});
    var r=await sb.from('pos_modifiers').select('modifier,quantity_sold').eq('is_historical',false);
    var agg={};
    (r.data||[]).forEach(function(x){
      if(modNames.some(function(m){return x.modifier&&x.modifier.toLowerCase().indexOf(m.toLowerCase())>=0;}))
        agg[x.modifier]=(agg[x.modifier]||0)+Number(x.quantity_sold);
    });
    var sorted=Object.entries(agg).sort(function(a,b){return b[1]-a[1];}).slice(0,10);
    var items=sorted.map(function(e){return{menu_item:e[0],qty:e[1]};});
    return resultBlock(q.label+' ('+kcat+')', barList(items,'menu_item','qty'));
  }

  // ── QUERY: best_dow_check_historical ──────────────────────────────
  if (qtype === 'best_dow_check_historical') {
    var dowNames=['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
    var r=await sb.from('pos_daily_summary').select('sale_date,bill_count,net_sales');
    var byDow={};
    (r.data||[]).forEach(function(x){
      if(!x.bill_count) return;
      var dw=new Date(x.sale_date+'T12:00:00').getDay();
      if(!byDow[dw])byDow[dw]={rev:0,cov:0,cnt:0};
      byDow[dw].rev+=Number(x.net_sales)||0;
      byDow[dw].cov+=Number(x.bill_count)||0;
      byDow[dw].cnt++;
    });
    var rows=[0,1,2,3,4,5,6].filter(function(d){return byDow[d];}).sort(function(a,b){
      var ca=byDow[a].rev/byDow[a].cov; var cb=byDow[b].rev/byDow[b].cov; return cb-ca;
    }).map(function(d,i){
      var chk=byDow[d].rev/byDow[d].cov;
      return rowItem((i+1)+'. '+dowNames[d],fmtD(chk),byDow[d].cnt+' date');
    }).join('');
    return resultBlock(q.label, rows);
  }

  // ── QUERY: best_month_check_historical ────────────────────────────
  if (qtype === 'best_month_check_historical') {
    var r=await sb.from('pos_daily_summary').select('sale_date,bill_count,net_sales');
    var byMonth={};
    (r.data||[]).forEach(function(x){
      if(!x.bill_count) return;
      var m=x.sale_date.slice(0,7);
      if(!byMonth[m])byMonth[m]={rev:0,cov:0,cnt:0};
      byMonth[m].rev+=Number(x.net_sales)||0;
      byMonth[m].cov+=Number(x.bill_count)||0;
      byMonth[m].cnt++;
    });
    var sorted=Object.entries(byMonth).sort(function(a,b){
      var ca=a[1].rev/a[1].cov; var cb=b[1].rev/b[1].cov; return cb-ca;
    }).slice(0,12);
    var rows=sorted.map(function(e,i){
      var chk=e[1].rev/e[1].cov;
      return rowItem((i+1)+'. '+e[0],fmtD(chk),e[1].cnt+' giorni · '+fmt(e[1].rev));
    }).join('');
    return resultBlock(q.label, rows);
  }

  // ── Fallback ───────────────────────────────────────────────────────
  return resultBlock(q.label,
    '<div style="background:#fef3c7;border-radius:12px;padding:16px;text-align:center;color:#92400e;font-size:13px;">' +
    'Analisi <strong>'+qtype+'</strong> in arrivo nel prossimo aggiornamento.<br>' +
    '<span style="font-size:11px;color:#b45309;">Usa Sous Chef AI per questa domanda nel frattempo.</span>' +
    '</div>');
}

// ── POS Staff View ──────────────────────────────────────────────────
// Solo per utenti non-admin. Zero prezzi, zero incassi, solo quantità cibo.

var staffDateMode = 'ieri';

var STAFF_FOOD_GROUPS = ['Pasta','Secondi/entrees','Secondi','Antipasti/appetizer','Antipasti','Insalate/salad','Dolcezze/dessert','Dolcezze','Kids menu','Soup','Sides','Lunch'];
var STAFF_GROUP_LABELS = {'Pasta':'Pasta','Secondi/entrees':'Secondi','Secondi':'Secondi','Antipasti/appetizer':'Antipasti','Antipasti':'Antipasti','Insalate/salad':'Insalate','Dolcezze/dessert':'Dolcezze','Dolcezze':'Dolcezze','Kids menu':'Kids','Soup':'Zuppe','Sides':'Contorni','Lunch':'Pranzo'};
var STAFF_EXCL = ['NA Beverages','The Bar','Mocktail','Happy hours','Wine dinner','Testing menu','Catering','Peach Festival','Resturant week'];
var STAFF_GROUP_EMOJI = {'Pasta':'🍝','Secondi':'🥩','Antipasti':'🫙','Insalate':'🥗','Dolcezze':'🍮','Kids':'👶','Zuppe':'🍲','Contorni':'🥦','Pranzo':'🌞'};

function staffGetPeriod() {
  var today = new Date(); today.setHours(0,0,0,0);
  var dow = today.getDay();
  if (staffDateMode === 'ieri') {
    var d = new Date(today); d.setDate(d.getDate()-1);
    var iso = toISO(d);
    return { from:iso, to:iso, label:dayNameIT(iso)+' '+iso.slice(5) };
  }
  if (staffDateMode === 'weekend') {
    var daysToSat = (dow + 1) % 7;
    if (daysToSat === 0) daysToSat = 7;
    var lastSat = new Date(today); lastSat.setDate(today.getDate()-daysToSat);
    var lastFri = new Date(lastSat); lastFri.setDate(lastSat.getDate()-1);
    return { from:toISO(lastFri), to:toISO(lastSat), label:'Weekend '+toISO(lastFri).slice(5)+'-'+toISO(lastSat).slice(5) };
  }
  if (staffDateMode === 'settimana') {
    var daysToLastTue = ((dow + 5) % 7) + 2;
    var lastTue = new Date(today); lastTue.setDate(today.getDate()-daysToLastTue);
    var lastSat2 = new Date(lastTue); lastSat2.setDate(lastTue.getDate()+4);
    return { from:toISO(lastTue), to:toISO(lastSat2), label:'Sett. '+toISO(lastTue).slice(5)+'-'+toISO(lastSat2).slice(5) };
  }
  var d2 = new Date(today); d2.setDate(d2.getDate()-1);
  var iso2 = toISO(d2);
  return { from:iso2, to:iso2, label:dayNameIT(iso2)+' '+iso2.slice(5) };
}

function staffSetMode(m) {
  staffDateMode = m;
  loadPOSStaff();
}

async function loadPOSStaff() {
  var sec = document.getElementById('vx');
  if (!sec || sec.classList.contains('hidden')) return;
  sec.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:200px;color:#94a3b8;font-size:13px;">Caricamento\u2026</div>';

  try {
    var sb = window.supabaseClient;
    var period = staffGetPeriod();

    // Selettori
    var modes = [
      {mode:'ieri',label:'Ieri'},
      {mode:'weekend',label:'Weekend'},
      {mode:'settimana',label:'Sett.'}
    ];
    var selHtml = '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px;">' +
      modes.map(function(m) {
        var a = staffDateMode === m.mode;
        return '<button onclick="staffSetMode(\''+m.mode+'\')" style="padding:10px 4px;border-radius:12px;border:0.5px solid '+(a?'#6366f1':'rgba(99,102,241,0.15)')+';background:'+(a?'#6366f1':'white')+';color:'+(a?'white':'#1e293b')+';font-size:13px;font-weight:700;cursor:pointer;-webkit-tap-highlight-color:transparent;">'+m.label+'</button>';
      }).join('') +
      '</div>';

    // Coperti (solo numero, niente fatturato)
    var rCov = await sb.from('pos_daily_summary').select('bill_count,sale_date').gte('sale_date',period.from).lte('sale_date',period.to);
    var totalCovers = (rCov.data||[]).reduce(function(s,x){return s+(x.bill_count||0);},0);
    var nDays = (rCov.data||[]).filter(function(x){return x.bill_count>0;}).length;

    var coverHtml = '<div style="background:white;border-radius:16px;padding:14px 16px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;">' +
      '<div>' +
      '<div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;">'+period.label+'</div>' +
      '<div style="font-size:28px;font-weight:800;color:#1e293b;line-height:1.1;">'+totalCovers+' <span style="font-size:14px;font-weight:500;color:#64748b;">coperti</span></div>' +
      (nDays>1?'<div style="font-size:11px;color:#94a3b8;">media '+Math.round(totalCovers/nDays)+'/giorno</div>':'') +
      '</div>' +
      '<div style="font-size:40px;">🍽️</div>' +
      '</div>';

    if (totalCovers === 0) {
      // Calcola offset per newsBar se visibile
    var newsBar = document.getElementById('newsBar');
    var newsOffset = (newsBar && !newsBar.classList.contains('hidden')) ? (newsBar.offsetHeight + 4) : 0;

    sec.innerHTML = '<div style="padding:'+(12+newsOffset)+'px 12px 100px;">'+selHtml+coverHtml+
        '<div style="background:white;border-radius:16px;padding:40px 20px;text-align:center;color:#94a3b8;font-size:13px;">Nessun dato per questo periodo.</div></div>';
      return;
    }

    // Piatti Food
    var rItems = await sb.from('pos_sales_by_item')
      .select('menu_item,menu_group,quantity,sales_category')
      .gte('sale_date',period.from).lte('sale_date',period.to)
      .eq('sales_category','Food').eq('is_historical',false);

    var items = (rItems.data||[]).filter(function(x){ return STAFF_EXCL.indexOf(x.menu_group)<0; });

    // Aggrega per gruppo canonico
    var groupMap = {};
    items.forEach(function(x) {
      var label = STAFF_GROUP_LABELS[x.menu_group] || x.menu_group;
      if (!groupMap[label]) groupMap[label] = {qty:0,items:{}};
      groupMap[label].qty += Number(x.quantity)||0;
      var it = x.menu_item;
      groupMap[label].items[it] = (groupMap[label].items[it]||0) + (Number(x.quantity)||0);
    });

    var groupOrder = ['Pasta','Secondi','Antipasti','Insalate','Dolcezze','Kids','Zuppe','Contorni','Pranzo'];
    var groupsSorted = groupOrder.filter(function(g){return groupMap[g] && groupMap[g].qty>0;});
    var maxGroupQty = Math.max.apply(null, groupsSorted.map(function(g){return groupMap[g].qty;}));

    var groupsHtml = groupsSorted.map(function(g) {
      var data = groupMap[g];
      var emoji = STAFF_GROUP_EMOJI[g]||'🍴';
      var pct = maxGroupQty>0 ? Math.round((data.qty/maxGroupQty)*100) : 0;
      return '<div onclick="staffOpenGroup(\''+g+'\')" style="background:white;border-radius:14px;padding:12px 14px;margin-bottom:8px;cursor:pointer;-webkit-tap-highlight-color:transparent;active:opacity:0.7;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">' +
        '<div style="display:flex;align-items:center;gap:8px;">' +
        '<span style="font-size:20px;">'+emoji+'</span>' +
        '<span style="font-size:15px;font-weight:700;color:#1e293b;">'+g+'</span>' +
        '</div>' +
        '<span style="font-size:18px;font-weight:800;color:#6366f1;">'+data.qty+'<span style="font-size:11px;font-weight:500;color:#94a3b8;">x</span></span>' +
        '</div>' +
        '<div style="height:4px;background:#f1f5f9;border-radius:2px;overflow:hidden;">' +
        '<div style="width:'+pct+'%;height:100%;background:#6366f1;border-radius:2px;"></div>' +
        '</div>' +
        '</div>';
    }).join('');

    // Modifier cucina
    var rModCfg = await sb.from('modifier_config').select('modifier,kitchen_cat,portion_note').eq('is_kitchen',true);
    var rModSales = await sb.from('pos_modifiers').select('modifier,quantity_sold').gte('sale_date',period.from).lte('sale_date',period.to).eq('is_historical',false);

    var kitchenMods = (rModCfg.data||[]).map(function(x){return x.modifier.toLowerCase();});
    var modAgg = {};
    (rModSales.data||[]).forEach(function(x) {
      if (!x.modifier) return;
      var low = x.modifier.toLowerCase();
      if (kitchenMods.some(function(m){return low.indexOf(m)>=0 || m.indexOf(low)>=0;})) {
        modAgg[x.modifier] = (modAgg[x.modifier]||0) + (Number(x.quantity_sold)||0);
      }
    });
    var modSorted = Object.entries(modAgg).sort(function(a,b){return b[1]-a[1];});
    var maxMod = modSorted.length>0 ? modSorted[0][1] : 1;

    var modHtml = '';
    if (modSorted.length > 0) {
      modHtml = '<div style="background:white;border-radius:16px;padding:14px 16px;margin-bottom:12px;">' +
        '<div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Modifier cucina</div>' +
        modSorted.map(function(e) {
          var pct = Math.round((e[1]/maxMod)*100);
          var cfg = (rModCfg.data||[]).find(function(x){return x.modifier.toLowerCase()===e[0].toLowerCase();});
          var cat = cfg ? cfg.kitchen_cat : '';
          var catColors = {Contorni:'#059669',Proteine:'#dc2626',Upgrade:'#d97706',Extra:'#6366f1'};
          var col = catColors[cat]||'#6366f1';
          return '<div onclick="staffOpenModifier(\''+e[0].replace(/'/g,"\\'")+'\',\''+period.from+'\',\''+period.to+'\')" style="margin-bottom:10px;cursor:pointer;-webkit-tap-highlight-color:transparent;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">' +
            '<span style="font-size:13px;font-weight:600;color:#1e293b;">'+e[0]+'</span>' +
            '<span style="font-size:14px;font-weight:800;color:'+col+';">'+e[1]+'<span style="font-size:10px;font-weight:500;color:#94a3b8;">x</span></span>' +
            '</div>' +
            '<div style="height:3px;background:#f1f5f9;border-radius:2px;overflow:hidden;">' +
            '<div style="width:'+pct+'%;height:100%;background:'+col+';border-radius:2px;"></div>' +
            '</div>' +
            '</div>';
        }).join('') +
        '</div>';
    }

    // Salvo i dati nel DOM per uso successivo
    window._staffData = { groupMap:groupMap, period:period, modCfg:rModCfg.data||[] };

    sec.innerHTML = '<div style="padding:12px 12px 100px;">' +
      selHtml + coverHtml +
      '<div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">Cucina</div>' +
      groupsHtml +
      modHtml +
      '</div>';

  } catch(err) {
    console.error('POS Staff error:',err);
    document.getElementById('vx').innerHTML = '<div style="padding:16px;color:#dc2626;font-size:13px;">Errore: '+err.message+'</div>';
  }
}

function staffOpenGroup(groupName) {
  if (!window._staffData) return;
  var gd = window._staffData.groupMap[groupName];
  var period = window._staffData.period;
  if (!gd) return;

  var items = Object.entries(gd.items).sort(function(a,b){return b[1]-a[1];});
  var max = items.length>0 ? items[0][1] : 1;
  var emoji = STAFF_GROUP_EMOJI[groupName]||'🍴';

  var html = '<div id="sg-modal" style="position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,0.5);display:flex;align-items:flex-end;">' +
    '<div style="background:#f8faff;border-radius:24px 24px 0 0;width:100%;max-height:88vh;overflow-y:auto;padding:20px 16px 40px;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">' +
    '<div style="display:flex;align-items:center;gap:10px;">' +
    '<span style="font-size:28px;">'+emoji+'</span>' +
    '<div>' +
    '<div style="font-size:18px;font-weight:800;color:#1e293b;">'+groupName+'</div>' +
    '<div style="font-size:11px;color:#94a3b8;">'+period.label+' · '+gd.qty+'x totali</div>' +
    '</div>' +
    '</div>' +
    '<button onclick="document.getElementById(\'sg-modal\').remove()" style="width:34px;height:34px;border-radius:50%;border:none;background:rgba(100,116,139,0.12);font-size:18px;cursor:pointer;color:#475569;">✕</button>' +
    '</div>' +
    items.map(function(e,i) {
      var pct = Math.round((e[1]/max)*100);
      var isHalf = e[0].toLowerCase().indexOf('half')>=0 || e[0].toLowerCase().indexOf('child')>=0;
      return '<div onclick="staffOpenDishModal(\''+e[0].replace(/'/g,"\\'")+'\',\''+period.from+'\',\''+period.to+'\')" style="background:white;border-radius:12px;padding:11px 14px;margin-bottom:7px;cursor:pointer;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
        '<span style="font-size:13px;font-weight:600;color:#1e293b;max-width:75%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+(i+1)+'. '+e[0]+'</span>' +
        '<span style="font-size:15px;font-weight:800;color:#6366f1;">'+e[1]+'<span style="font-size:10px;color:#94a3b8;">x</span>'+(isHalf?' <span style="font-size:9px;color:#d97706;">½</span>':'')+'</span>' +
        '</div>' +
        '<div style="height:3px;background:#f1f5f9;border-radius:2px;overflow:hidden;">' +
        '<div style="width:'+pct+'%;height:100%;background:#6366f1;border-radius:2px;"></div>' +
        '</div>' +
        '</div>';
    }).join('') +
    '</div></div>';

  document.body.insertAdjacentHTML('beforeend', html);
}

async function staffOpenDishModal(dishName, from, to) {
  // Rimuovi eventuali modal precedenti dello stesso tipo
  var old = document.getElementById('sd-modal');
  if (old) old.remove();

  var sb = window.supabaseClient;

  // Mostra loading
  var loadHtml = '<div id="sd-modal" style="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.55);display:flex;align-items:flex-end;">' +
    '<div style="background:#f8faff;border-radius:24px 24px 0 0;width:100%;padding:24px 16px 40px;text-align:center;color:#94a3b8;font-size:13px;">Caricamento\u2026</div></div>';
  document.body.insertAdjacentHTML('beforeend', loadHtml);

  try {
    // Vendite come piatto
    var r1 = await sb.from('pos_sales_by_item')
      .select('menu_item,quantity').gte('sale_date',from).lte('sale_date',to)
      .eq('is_historical',false).ilike('menu_item','%'+dishName+'%');

    // Vendite come modifier su altri piatti
    var r2 = await sb.from('pos_modifier_by_item')
      .select('modifier,parent_item,quantity_sold').gte('sale_date',from).lte('sale_date',to)
      .ilike('modifier','%'+dishName+'%');

    var piatti = (r1.data||[]);
    var modItems = (r2.data||[]);

    // Calcolo porzioni
    var totalePortioni = 0;
    var righe = [];

    piatti.forEach(function(x) {
      var isHalf = x.menu_item.toLowerCase().indexOf('half')>=0 || x.menu_item.toLowerCase().indexOf('child')>=0;
      var mult = isHalf ? 0.5 : 1;
      var qty = Number(x.quantity)||0;
      totalePortioni += qty * mult;
      righe.push({label:x.menu_item, qty:qty, note:isHalf?'mezza porzione':'porzione intera', mult:mult});
    });

    var modQty = modItems.reduce(function(s,x){return s+Number(x.quantity_sold);},0);
    if (modQty > 0) {
      // Controlla se è proteina (porzione intera) o contorno (mezza)
      var cfg = window._staffData && window._staffData.modCfg.find(function(c){
        return c.modifier.toLowerCase() === dishName.toLowerCase();
      });
      var isIntera = cfg && cfg.portion_note && cfg.portion_note.indexOf('intera')>=0;
      var modMult = isIntera ? 1 : 0.5;
      totalePortioni += modQty * modMult;
      righe.push({label:'Come modifier su altri piatti', qty:modQty, note:isIntera?'porzione intera':'mezza porzione', mult:modMult});
    }

    totalePortioni = Math.ceil(totalePortioni);

    var emojis = {'Pasta':'🍝','Secondi':'🥩','chicken':'🍗','shrimp':'🦐','brussels':'🥦','asparagus':'🌿','meatball':'🍖','truffle':'🍄','burrata':'🧀','scallop':'🫧','salmon':'🐟','beef':'🥩'};
    var emoji = '🍴';
    Object.keys(emojis).forEach(function(k){if(dishName.toLowerCase().indexOf(k)>=0) emoji=emojis[k];});

    // Periodo leggibile
    var periodLabel = from===to ? (dayNameIT(from)+' '+from.slice(5)) : (from.slice(5)+' → '+to.slice(5));

    var modal = document.getElementById('sd-modal');
    if (!modal) return;
    modal.innerHTML = '<div style="background:#f8faff;border-radius:24px 24px 0 0;width:100%;max-height:85vh;overflow-y:auto;padding:20px 16px 40px;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">' +
      '<div style="display:flex;align-items:center;gap:10px;">' +
      '<span style="font-size:32px;">'+emoji+'</span>' +
      '<div>' +
      '<div style="font-size:17px;font-weight:800;color:#1e293b;">'+dishName+'</div>' +
      '<div style="font-size:11px;color:#94a3b8;">'+periodLabel+'</div>' +
      '</div>' +
      '</div>' +
      '<button onclick="document.getElementById(\'sd-modal\').remove()" style="width:34px;height:34px;border-radius:50%;border:none;background:rgba(100,116,139,0.12);font-size:18px;cursor:pointer;color:#475569;">✕</button>' +
      '</div>' +
      '<div style="background:white;border-radius:14px;padding:14px;margin-bottom:14px;">' +
      righe.map(function(r) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid #f1f5f9;">' +
          '<div>' +
          '<div style="font-size:13px;font-weight:500;color:#1e293b;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+r.label+'</div>' +
          '<div style="font-size:10px;color:#94a3b8;">'+r.note+'</div>' +
          '</div>' +
          '<span style="font-size:15px;font-weight:700;color:#475569;">'+r.qty+'x</span>' +
          '</div>';
      }).join('') +
      '</div>' +
      '<div style="background:linear-gradient(135deg,#6366f1,#4f46e5);border-radius:14px;padding:18px;text-align:center;">' +
      '<div style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">Da preparare</div>' +
      '<div style="font-size:48px;font-weight:900;color:white;line-height:1;">'+totalePortioni+'</div>' +
      '<div style="font-size:13px;color:rgba(255,255,255,0.8);margin-top:2px;">porzioni</div>' +
      '</div>' +
      '</div>';

  } catch(e) {
    var modal2 = document.getElementById('sd-modal');
    if (modal2) modal2.innerHTML = '<div style="background:#f8faff;border-radius:24px 24px 0 0;width:100%;padding:24px;color:#dc2626;">Errore: '+e.message+'</div>';
  }
}

async function staffOpenModifier(modName, from, to) {
  var old = document.getElementById('sd-modal');
  if (old) old.remove();
  await staffOpenDishModal(modName, from, to);
}
