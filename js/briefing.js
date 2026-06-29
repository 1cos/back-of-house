// ── BRIEFING AI ──
async function loadBriefing(){
  const el=document.getElementById('briefingContent');
  if(!el) return;
  el.innerHTML='<div class="animate-pulse h-4 bg-slate-100 rounded w-3/4"></div><div class="animate-pulse h-4 bg-slate-100 rounded w-full mt-2"></div><div class="animate-pulse h-4 bg-slate-100 rounded w-2/3 mt-2"></div>';
  try{
    const today=getNowDallas().toLocaleDateString('en-CA');
    const{data:briefing}=await supa.from('briefing').select('*').eq('date',today).maybeSingle();
    if(!briefing||!briefing.points||!briefing.points.length){
      el.innerHTML='<p class="text-sm text-slate-400">'+tr('briefingEmpty')+'</p>';
      return;
    }
    const icons=['🔴','🟡','🔵'];
    const lang=user&&user.lang?user.lang:'it';
    const isAdmin_flag=typeof isAdmin==='function'&&isAdmin();
    // Legge colonna gia tradotta dal DB --- zero chiamate ai-translate
    var points;
    if(isAdmin_flag){
      if(lang==='en'&&briefing.points_en&&briefing.points_en.length) points=briefing.points_en;
      else if(lang==='es'&&briefing.points_es&&briefing.points_es.length) points=briefing.points_es;
      else points=briefing.points;
    } else {
      const staffPts=briefing.points_staff&&briefing.points_staff.length?briefing.points_staff:briefing.points;
      if(lang==='en'&&briefing.points_staff_en&&briefing.points_staff_en.length) points=briefing.points_staff_en;
      else if(lang==='es'&&briefing.points_staff_es&&briefing.points_staff_es.length) points=briefing.points_staff_es;
      else points=staffPts;
    }
    el.innerHTML=(points||[]).map(function(p,i){
      return '<div class="flex gap-2 items-start py-1">'+
      '<span class="text-sm mt-0.5 flex-shrink-0">'+(icons[i]||'•')+'</span>'+
      '<p class="text-sm text-slate-700 leading-snug">'+p+'</p>'+
      '</div>';
    }).join('');
  }catch(e){
    el.innerHTML='<p class="text-sm text-red-500">'+tr('briefingError')+'</p>';
  }
}

async function refreshBriefing(){
  const today=new Date().toISOString().slice(0,10);
  await supa.from('briefing').delete().eq('date',today);
  loadBriefing();
}

// ── HOME STATIONS ──
// Admin: tutte le stazioni in pill (#homeStations) — verdi/rosse
// Staff: top 3 propria stazione (#homeStationItems) + altre stazioni con item da fare (#homeOtherStations)
function renderHomeStations(){
  // Tutte le categorie presenti in prep_tasks
  const allCats=[...new Set(items.map(i=>i.category).filter(Boolean))].sort();

  if(isAdmin()){
    // ── ADMIN: pill tutte le stazioni ──
    const el=document.getElementById('homeStations');
    if(!el) return;
    if(!allCats.length){
      el.innerHTML='<p class="text-xs text-slate-400">'+tr('noStation')+'</p>';
      return;
    }
    el.innerHTML=allCats.map(s=>{
      const missing=items.filter(i=>i.need_tomorrow&&i.category===s).length;
      const label=s.replace(' Station','').replace('Station','');
      return '<div onclick="goToStation(\'' + s + '\')" class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer active:scale-95 transition ' + (missing>0?'bg-red-100 text-red-700 border border-red-200':'bg-green-100 text-green-700 border border-green-200') + '">' +
        '<span>'+label+'</span>' +
        (missing>0?'<span class="bg-red-500 text-white text-[10px] w-4 h-4 flex items-center justify-center rounded-full">'+missing+'</span>':'<span>✓</span>')+
        '</div>';
    }).join('');

  } else {
    // ── STAFF: Your Station (top 3 item) ──
    renderHomeStationItems();

    // ── STAFF: Other Stations — solo quelle con item da fare ──
    const otherEl=document.getElementById('homeOtherStations');
    if(!otherEl) return;

    const userStation=user?.default_station||null;

    // Tutte le stazioni esclusa la propria, con almeno 1 item need_tomorrow
    const otherCats=allCats.filter(s=>{
      if(s===userStation) return false;
      if(s==='Chiusura') return false;
      const hasTodo=items.some(i=>i.need_tomorrow&&i.category===s);
      return hasTodo;
    });

    if(!otherCats.length){
      otherEl.innerHTML='';
      otherEl.style.display='none';
      // Nascondi anche il label "Other Stations" se esiste
      const otherLabel=document.getElementById('homeOtherStationsLabel');
      if(otherLabel) otherLabel.style.display='none';
      return;
    }

    // Mostra label e pill
    const otherLabel=document.getElementById('homeOtherStationsLabel');
    if(otherLabel) otherLabel.style.display='block';
    otherEl.style.display='flex';

    otherEl.innerHTML=otherCats.map(s=>{
      const missing=items.filter(i=>i.need_tomorrow&&i.category===s).length;
      const label=s.replace(' Station','').replace('Station','');
      return '<div onclick="goToStation(\'' + s + '\')" class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer active:scale-95 transition bg-red-100 text-red-700 border border-red-200">' +
        '<span>'+label+'</span>' +
        '<span class="bg-red-500 text-white text-[10px] w-4 h-4 flex items-center justify-center rounded-full">'+missing+'</span>'+
        '</div>';
    }).join('');
  }
}

function goToStation(s){
  station=s;
  station2=s;
  document.querySelector('[data-t=m]').click();
}

// ── HOME STATION ITEMS (top 3 propria stazione — solo staff) ──
function renderHomeStationItems(){
  const el=document.getElementById('homeStationItems');
  if(!el) return;
  const userStation=user?.default_station||null;
  const stationFilter=userStation?userStation.replace(' Station',''):null;
  const stationItems=stationFilter
    ?items.filter(i=>i.category?.includes(stationFilter))
    :items.filter(i=>station!=='All'?i.category?.includes(station):true);

  if(!stationItems.length){
    el.innerHTML='<div style="font-size:12px;color:#93c5fd;padding:4px 0;">No items for your station</div>';
    return;
  }

  const sorted=stationItems.sort((a,b)=>(b.need_tomorrow?1:0)-(a.need_tomorrow?1:0)).slice(0,3);
  el.style.maxHeight='120px';
  el.style.overflowY='auto';
  el.innerHTML=sorted.map(i=>{
    const color=i.need_tomorrow?'#b91c1c':i.in_progress?'#1d4ed8':'#1e3a5f';
    const dot=i.need_tomorrow?'#ef4444':i.in_progress?'#3B82F6':'transparent';
    const dotBorder=i.need_tomorrow||i.in_progress?'none':'0.5px solid #93c5fd';
    return '<div onclick="document.querySelector(\"[data-t=m]\").click()" style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer;border-bottom:0.5px solid rgba(59,130,246,0.08);">'+
      '<div style="width:7px;height:7px;border-radius:50%;background:'+dot+';border:'+dotBorder+';flex-shrink:0;"></div>'+
      '<span style="font-size:14px;color:'+color+';font-weight:'+(i.need_tomorrow?'500':'400')+';">'+i.name+'</span>'+
      (i.need_tomorrow?'<span style="margin-left:auto;font-size:10px;color:#ef4444;background:rgba(239,68,68,0.1);padding:2px 7px;border-radius:20px;">'+tr('daFare')+'</span>':'')+
      (i.in_progress&&!i.need_tomorrow?'<span style="margin-left:auto;font-size:10px;color:#3B82F6;">'+tr('inProgress')+'</span>':'')+
      '</div>';
  }).join('');
}

// ── Helpers comuni per filtro bevande ──
const _EXCL_GROUPS='("NA Beverages","Beverages","Mocktail","Beer","Common Cocktails","House Cocktails","Gin","Rum","Scotch","Tequila","Liqueurs","The Bar","Sparkling Wine BOTTLE","Sparkling Wine GLASS")';
const _EXCL_SALES_CAT='("Alcohol","Beer","Wine")';
const _EXCL_KEYWORDS=['tea','water','coffee','pepsi','coke','soda','beer','wine','liquor','spirit','cocktail','margarita','michelob','modelo','corona','seltzr','seltzer','lemonade','juice','milk','espresso','cappuccino'];

function _filterDrinks(itemsArr){
  return (itemsArr||[]).filter(i=>{
    const name=(i.menu_item||'').toLowerCase();
    return !_EXCL_KEYWORDS.some(k=>name.includes(k));
  });
}

// ── SERVICE UPDATES — Yesterday's Highlights (lun-sab) / Weekly Highlights (lunedì) ──
// Admin: bills + net sales (solo yesterday) + top piatti
// Staff: solo top piatti — zero dati finanziari — regola ferrea
// Lunedì: dati aggregati 7 giorni (lun precedente → dom)
async function loadServiceUpdates(){
  const el=document.getElementById('serviceUpdatesList');
  if(!el) return;
  try{
    const now=getNowDallas();
    const dow=now.toLocaleString('en-US',{timeZone:'America/Chicago',weekday:'long'});
    const isMonday=dow==='Monday';

    if(isMonday){
      await _loadWeeklyHighlights(el);
    } else {
      await _loadYesterdayHighlights(el);
    }
  }catch(e){
    el.innerHTML='<div style="font-size:12px;color:#93c5fd;padding:4px 0;">No updates</div>';
  }
}

// ── YESTERDAY highlights (martedì–sabato) ──
async function _loadYesterdayHighlights(el){
  const now=getNowDallas();
  const yesterday=new Date(now);
  yesterday.setDate(yesterday.getDate()-1);
  const yStr=yesterday.toLocaleDateString('en-CA');

  const{data:summary}=await supa.from('pos_daily_summary')
    .select('sale_date,bill_count,net_sales')
    .eq('sale_date',yStr)
    .maybeSingle();

  const{data:posItems}=await supa.from('pos_sales_by_item')
    .select('menu_item,quantity')
    .eq('sale_date',yStr)
    .not('menu_group','in',_EXCL_GROUPS)
    .not('sales_category','in',_EXCL_SALES_CAT)
    .lt('quantity',1000)
    .order('quantity',{ascending:false})
    .limit(3);

  // Fallback su service_updates se nessun dato POS
  if(!summary&&(!posItems||!posItems.length)){
    const{data:updates}=await supa.from('service_updates')
      .select('*').order('created_at',{ascending:false}).limit(3);
    if(!updates||!updates.length){
      el.innerHTML='<div style="font-size:12px;color:#93c5fd;padding:4px 0;">No updates</div>';
      return;
    }
    el.innerHTML=updates.map(u=>{
      const color=u.level==='urgent'?'#ef4444':u.level==='warning'?'#f59e0b':'#3B82F6';
      return '<div style="display:flex;align-items:flex-start;gap:8px;padding:4px 0;">'+
        '<div style="width:7px;height:7px;border-radius:50%;background:'+color+';flex-shrink:0;margin-top:4px;"></div>'+
        '<span style="font-size:13px;color:#1e3a5f;flex:1;line-height:1.4;">'+u.message+'</span>'+
        '</div>';
    }).join('');
    return;
  }

  const rows=[];
  const medals=['🥇','🥈','🥉'];

  // Admin: finanziari ieri
  if(typeof isAdmin==='function'&&isAdmin()&&summary){
    const sales=parseFloat(summary.net_sales||0).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
    rows.push(
      '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:0.5px solid rgba(59,130,246,0.08);">'+
      '<span style="font-size:15px;">💰</span>'+
      '<span style="font-size:13px;color:#1e3a5f;font-weight:600;">'+sales+'</span>'+
      '<span style="font-size:12px;color:#64748b;">·</span>'+
      '<span style="font-size:13px;color:#64748b;">'+summary.bill_count+' bills</span>'+
      '</div>'
    );
  }

  // Tutti: top 3 piatti
  if(posItems&&posItems.length){
    posItems.forEach(function(item,i){
      rows.push(
        '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:0.5px solid rgba(59,130,246,0.08);">'+
        '<span style="font-size:15px;">'+medals[i]+'</span>'+
        '<span style="font-size:13px;color:#1e3a5f;font-weight:500;">'+item.menu_item+'</span>'+
        '<span style="margin-left:auto;font-size:12px;color:#60a5fa;font-weight:600;">'+item.quantity+' pcs</span>'+
        '</div>'
      );
    });
  }

  el.innerHTML=rows.length?rows.join(''):'<div style="font-size:12px;color:#93c5fd;padding:4px 0;">No updates</div>';
}

// ── WEEKLY highlights (lunedì) — ultimi 7 giorni aggregati ──
async function _loadWeeklyHighlights(el){
  const now=getNowDallas();
  // Domenica scorsa (ieri) → lunedì scorso (7 giorni fa)
  const endDate=new Date(now);
  endDate.setDate(endDate.getDate()-1); // ieri = domenica
  const startDate=new Date(endDate);
  startDate.setDate(startDate.getDate()-6); // 7 giorni totali lun–dom
  const startStr=startDate.toLocaleDateString('en-CA');
  const endStr=endDate.toLocaleDateString('en-CA');

  // Admin: totale bills settimana (no net_sales — troppo finanziario per il widget)
  // Tutti: top 3 piatti aggregati
  const[summaryRes, posRes]=await Promise.all([
    supa.from('pos_daily_summary')
      .select('bill_count')
      .gte('sale_date',startStr)
      .lte('sale_date',endStr),
    supa.from('pos_sales_by_item')
      .select('menu_item,quantity')
      .gte('sale_date',startStr)
      .lte('sale_date',endStr)
      .not('menu_group','in',_EXCL_GROUPS)
      .not('sales_category','in',_EXCL_SALES_CAT)
      .lt('quantity',1000)
  ]);

  const summaryRows=summaryRes.data||[];
  const posItems=_filterDrinks(posRes.data||[]);

  // Aggrega quantità per piatto
  const totals={};
  posItems.forEach(function(r){
    totals[r.menu_item]=(totals[r.menu_item]||0)+Number(r.quantity||0);
  });
  const sorted=Object.entries(totals)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,3);

  const rows=[];
  const medals=['🥇','🥈','🥉'];

  // Admin: totale bills settimana
  if(typeof isAdmin==='function'&&isAdmin()&&summaryRows.length){
    const totalBills=summaryRows.reduce((s,r)=>s+(r.bill_count||0),0);
    rows.push(
      '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:0.5px solid rgba(59,130,246,0.08);">'+
      '<span style="font-size:15px;">🧾</span>'+
      '<span style="font-size:13px;color:#1e3a5f;font-weight:600;">'+totalBills+' bills</span>'+
      '<span style="font-size:12px;color:#64748b;">this week</span>'+
      '</div>'
    );
  }

  // Tutti: top 3 piatti settimana
  if(sorted.length){
    sorted.forEach(function([name,qty],i){
      rows.push(
        '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:0.5px solid rgba(59,130,246,0.08);">'+
        '<span style="font-size:15px;">'+medals[i]+'</span>'+
        '<span style="font-size:13px;color:#1e3a5f;font-weight:500;">'+name+'</span>'+
        '<span style="margin-left:auto;font-size:12px;color:#60a5fa;font-weight:600;">'+qty+' pcs</span>'+
        '</div>'
      );
    });
  }

  el.innerHTML=rows.length?rows.join(''):'<div style="font-size:12px;color:#93c5fd;padding:4px 0;">No data this week</div>';
}

// ── UPCOMING DEMAND — legge tabella events (TripleSeat) ──
async function loadUpcomingDemand(){
  const el=document.getElementById('upcomingDemand');
  const section=document.getElementById('upcomingDemandSection');
  const headerEl=document.getElementById('homeUpcomingLabel');
  if(!el) return;
  try{
    const today=getNowDallas().toLocaleDateString('en-CA');
    const{data}=await supa.from('events')
      .select('id,name,event_date,event_time,guest_count,service_style,location,room_name,event_recipes,status')
      .gte('event_date',today)
      .order('event_date',{ascending:true})
      .limit(5);
    if(!data||!data.length){
      if(section) section.style.display='none';
      else el.closest('div[style]') && (el.style.display='none');
      return;
    }
    if(section) section.style.display='';
    el.style.display='';
    // Header cliccabile — apre il calendario completo
    if(headerEl){
      headerEl.style.cursor='pointer';
      headerEl.title=tr('view_all_arrow');
      headerEl.onclick=()=>{ if(typeof showCalendar==='function') showCalendar(); };
    }
    const isAdm=typeof isAdmin==='function'&&isAdmin();
    el.innerHTML=data.map(e=>{
      const d=new Date(e.event_date+'T12:00:00');
      const dayStr=d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
      const timeStr=e.event_time?e.event_time.slice(0,5):'';
      const loc=e.location||e.room_name||'';
      const svc=e.service_style||'';
      const recipes=Array.isArray(e.event_recipes)?e.event_recipes:[];
      const statusColor={confirmed:'#059669',tentative:'#f59e0b',cancelled:'#ef4444'}[e.status]||'#94a3b8';
      let recHtml='';
      if(recipes.length){
        recHtml='<div style="margin-top:4px;padding-top:4px;border-top:0.5px solid rgba(59,130,246,0.06);">'+
          recipes.slice(0,3).map(r=>
            '<div style="font-size:11px;color:#475569;padding:1px 0;">• '+
            (r.recipe_title||r.name||'')+
            (r.portions?' <span style="color:#94a3b8;">'+r.portions+' portions</span>':'')+
            '</div>'
          ).join('')+
          (recipes.length>3?'<div style="font-size:10px;color:#94a3b8;">+'+( recipes.length-3)+' more…</div>':'')+
        '</div>';
      }
      return '<div style="padding:6px 0;border-bottom:0.5px solid rgba(59,130,246,0.08);display:flex;gap:10px;">'+
        '<div style="flex-shrink:0;text-align:center;min-width:34px;">'+
          '<div style="font-size:10px;color:#60a5fa;font-weight:600;">'+dayStr.split(',')[0]+'</div>'+
          '<div style="font-size:14px;color:#1e3a5f;font-weight:800;">'+d.getDate()+'</div>'+
        '</div>'+
        '<div style="flex:1;">'+
          '<div style="font-size:13px;color:#1e3a5f;font-weight:600;display:flex;align-items:center;gap:6px;">'+
            e.name+
            '<span style="font-size:9px;font-weight:700;color:'+statusColor+';background:'+
              (e.status==='confirmed'?'#f0fdf4':e.status==='tentative'?'#fffbeb':'#fff5f5')+
              ';border-radius:4px;padding:1px 5px;">'+
              (e.status||'').charAt(0).toUpperCase()+(e.status||'').slice(1)+
            '</span>'+
          '</div>'+
          '<div style="font-size:11px;color:#93c5fd;margin-top:1px;">'+
            (e.guest_count?e.guest_count+' guests':'')+
            (e.guest_count&&(loc||svc||timeStr)?' · ':'')+
            (loc?loc:'')+(loc&&(svc||timeStr)?' · ':'')+
            (svc?svc:'')+(svc&&timeStr?' · ':'')+
            (timeStr?timeStr:'')+
          '</div>'+
          recHtml+
          (isAdm?'<div style="margin-top:4px;"><button onclick="openEventEditor()" style="font-size:10px;color:#3b82f6;background:none;border:none;padding:0;cursor:pointer;">'+tr('add_event')+'</button></div>':'')+
        '</div>'+
      '</div>';
    }).join('')+
    '<div style="text-align:right;padding-top:6px;">'+
      '<button onclick="showCalendar()" '+
        'style="font-size:11px;color:#3b82f6;background:none;border:none;cursor:pointer;font-weight:600;">'+
        tr('view_all_arrow')+
      '</button>'+
    '</div>';
  }catch(e){
    el.style.display='none';
  }
}

// ── SERVICE UPDATES MODAL (View all) ──
// Lunedì: top 10 piatti della settimana; altri giorni: top 10 di ieri
async function openServiceUpdates(){
  const now=getNowDallas();
  const dow=now.toLocaleString('en-US',{timeZone:'America/Chicago',weekday:'long'});
  const isMonday=dow==='Monday';

  const medals=['🥇','🥈','🥉'];
  let rows=[];
  let headerLabel='';
  let headerTitle='';

  if(isMonday){
    // ── Weekly modal ──
    const endDate=new Date(now);
    endDate.setDate(endDate.getDate()-1);
    const startDate=new Date(endDate);
    startDate.setDate(startDate.getDate()-6);
    const startStr=startDate.toLocaleDateString('en-CA');
    const endStr=endDate.toLocaleDateString('en-CA');

    const{data:posData}=await supa.from('pos_sales_by_item')
      .select('menu_item,quantity')
      .gte('sale_date',startStr)
      .lte('sale_date',endStr)
      .not('menu_group','in',_EXCL_GROUPS)
      .not('sales_category','in',_EXCL_SALES_CAT)
      .lt('quantity',1000);

    const filtered=_filterDrinks(posData||[]);
    const totals={};
    filtered.forEach(function(r){
      totals[r.menu_item]=(totals[r.menu_item]||0)+Number(r.quantity||0);
    });
    const sorted=Object.entries(totals).sort((a,b)=>b[1]-a[1]).slice(0,10);

    headerTitle=tr('weekly_highlights');
    const wStart=startDate.toLocaleDateString('en-US',{month:'short',day:'numeric'});
    const wEnd=endDate.toLocaleDateString('en-US',{month:'short',day:'numeric'});
    headerLabel=wStart+' – '+wEnd;

    rows=sorted.length
      ? sorted.map(([name,qty],i)=>
          '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid rgba(59,130,246,0.08);">'+
          '<span style="font-size:18px;min-width:28px;">'+(medals[i]||'·')+'</span>'+
          '<span style="font-size:14px;color:#1e3a5f;font-weight:500;flex:1;">'+name+'</span>'+
          '<span style="font-size:13px;color:#60a5fa;font-weight:600;">'+qty+' '+tr('pcs')+'</span>'+
          '</div>'
        )
      : ['<div style="font-size:13px;color:#93c5fd;padding:8px 0;">'+tr('no_food_week')+'</div>'];

  } else {
    // ── Yesterday modal ──
    const yesterday=new Date(now);
    yesterday.setDate(yesterday.getDate()-1);
    const yStr=yesterday.toLocaleDateString('en-CA');

    const EXCLUDED_GROUPS_ARR=['NA Beverages','Beverages','Mocktail','Lunch','Soup'];
    const{data:posData}=await supa.from('pos_sales_by_item')
      .select('menu_item,quantity,menu_group')
      .eq('sale_date',yStr)
      .eq('sales_category','Food')
      .not('menu_group','in','("'+EXCLUDED_GROUPS_ARR.join('","')+'")')
      .lt('quantity',1000)
      .order('quantity',{ascending:false})
      .limit(20);

    const filtered=_filterDrinks(posData||[]).slice(0,10);

    headerTitle=tr('yesterday_highlights');
    headerLabel=yesterday.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});

    rows=filtered.length
      ? filtered.map((item,i)=>
          '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid rgba(59,130,246,0.08);">'+
          '<span style="font-size:18px;min-width:28px;">'+(medals[i]||'·')+'</span>'+
          '<span style="font-size:14px;color:#1e3a5f;font-weight:500;flex:1;">'+item.menu_item+'</span>'+
          '<span style="font-size:13px;color:#60a5fa;font-weight:600;">'+item.quantity+' '+tr('pcs')+'</span>'+
          '</div>'
        )
      : ['<div style="font-size:13px;color:#93c5fd;padding:8px 0;">'+tr('no_food_yesterday')+'</div>'];
  }

  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-50 flex items-end';
  modal.style.background='rgba(0,0,0,0.3)';
  modal.innerHTML='<div style="background:rgba(255,255,255,0.97);backdrop-filter:blur(20px);border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;max-height:75vh;overflow-y:auto;animation:slideUp .25s ease">'+
    '<div style="width:36px;height:4px;background:rgba(59,130,246,0.15);border-radius:2px;margin:0 auto 14px;"></div>'+
    '<div style="font-size:14px;font-weight:600;color:#1e3a5f;margin-bottom:4px;">'+headerTitle+'</div>'+
    '<div style="font-size:11px;color:#93c5fd;margin-bottom:14px;">'+headerLabel+'</div>'+
    '<div>'+rows.join('')+'</div>'+
    '<button onclick="this.closest(\'.fixed\').remove()" style="width:100%;height:44px;border-radius:14px;background:#1e3a5f;color:white;font-size:14px;font-weight:600;margin-top:16px;border:none;">Close</button>'+
    '</div>';
  modal.onclick=e=>{if(e.target===modal)modal.remove()};
  document.body.appendChild(modal);
}

async function addServiceUpdate(){
  const msg=prompt('Service update message:');
  if(!msg) return;
  const lvl=prompt('Level (info/warning/urgent/event):','info');
  await supa.from('service_updates').insert({message:msg,level:lvl||'info',created_by:user?.name});
  loadServiceUpdates();
  document.querySelector('.fixed')?.remove();
}
