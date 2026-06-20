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

// ── SERVICE UPDATES — Yesterday's Highlights ──
// Admin: bills + net sales + top 3 piatti
// Staff: solo top 3 piatti (zero dati finanziari — regola ferrea)
async function loadServiceUpdates(){
  const el=document.getElementById('serviceUpdatesList');
  if(!el) return;
  try{
    // Trova la data di ieri CDT
    const now=getNowDallas();
    const yesterday=new Date(now);
    yesterday.setDate(yesterday.getDate()-1);
    const yStr=yesterday.toLocaleDateString('en-CA');

    // Query 1: summary di ieri
    const{data:summary}=await supa.from('pos_daily_summary')
      .select('sale_date,bill_count,net_sales')
      .eq('sale_date',yStr)
      .maybeSingle();

    // Query 2: top 3 piatti di ieri (escludi bevande e dati corrotti)
    const{data:items}=await supa.from('pos_sales_by_item')
      .select('menu_item,quantity')
      .eq('sale_date',yStr)
      .not('menu_group','in','("NA Beverages","Beverages","Mocktail","Beer","Common Cocktails","House Cocktails","Gin","Rum","Scotch","Tequila","Liqueurs","The Bar","Sparkling Wine BOTTLE","Sparkling Wine GLASS")')
      .not('sales_category','in','("Alcohol","Beer","Wine")')
      .lt('quantity',1000)
      .order('quantity',{ascending:false})
      .limit(3);

    // Se nessun dato POS: fallback su service_updates
    if(!summary&&(!items||!items.length)){
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

    // Admin: mostra dati finanziari
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
    if(items&&items.length){
      items.forEach(function(item,i){
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

  }catch(e){
    el.innerHTML='<div style="font-size:12px;color:#93c5fd;padding:4px 0;">No updates</div>';
  }
}

// ── UPCOMING DEMAND — legge tabella events (TripleSeat) ──
async function loadUpcomingDemand(){
  const el=document.getElementById('upcomingDemand');
  const widget=el?el.closest('[id]'):null;
  // Trova il widget padre (homeHighlightsWidget contiene anche questa sezione)
  const section=document.getElementById('upcomingDemandSection');
  if(!el) return;
  try{
    const today=getNowDallas().toLocaleDateString('en-CA');
    const{data}=await supa.from('events')
      .select('name,event_date,event_time,guest_count,menu_type,location')
      .gte('event_date',today)
      .order('event_date',{ascending:true})
      .limit(5);
    // Se nessun evento: nascondi tutta la sezione
    if(!data||!data.length){
      // Nascondi il widget padre se esiste come sezione separata
      if(section) section.style.display='none';
      else el.closest('div[style]') && (el.style.display='none');
      return;
    }
    // Mostra sezione e popola
    if(section) section.style.display='';
    el.style.display='';
    el.innerHTML=data.map(e=>{
      const d=new Date(e.event_date+'T12:00:00');
      const dayStr=d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
      const timeStr=e.event_time?e.event_time.slice(0,5):'';
      return '<div style="display:flex;align-items:flex-start;gap:10px;padding:5px 0;border-bottom:0.5px solid rgba(59,130,246,0.08);">'+
        '<div style="flex-shrink:0;text-align:center;min-width:38px;">'+
          '<div style="font-size:10px;color:#60a5fa;font-weight:600;">'+dayStr.split(',')[0]+'</div>'+
          '<div style="font-size:13px;color:#1e3a5f;font-weight:700;">'+d.getDate()+'</div>'+
        '</div>'+
        '<div style="flex:1;">'+
          '<div style="font-size:13px;color:#1e3a5f;font-weight:500;">'+e.name+'</div>'+
          '<div style="font-size:11px;color:#93c5fd;margin-top:1px;">'+
            (e.guest_count?e.guest_count+' guests':'')+
            (e.guest_count&&e.menu_type?' · ':'')+
            (e.menu_type||'')+
            (timeStr?' · '+timeStr:'') +
          '</div>'+
        '</div>'+
      '</div>';
    }).join('');
  }catch(e){
    el.style.display='none';
  }
}

// ── SERVICE UPDATES MODAL ──
async function openServiceUpdates(){
  // Top food di ieri — no drink, no alcol, no dati finanziari
  const now=getNowDallas();
  const yesterday=new Date(now);
  yesterday.setDate(yesterday.getDate()-1);
  const yStr=yesterday.toLocaleDateString('en-CA');

  const EXCLUDED_GROUPS=['NA Beverages','Beverages','Mocktail','Lunch','Soup'];
  const EXCLUDED_KEYWORDS=['tea','water','coffee','pepsi','coke','soda','beer','wine','liquor','spirit','cocktail','margarita','michelob','modelo','corona','seltzr','seltzer','lemonade','juice','milk','espresso','cappuccino'];

  const{data:items}=await supa.from('pos_sales_by_item')
    .select('menu_item,quantity,menu_group')
    .eq('sale_date',yStr)
    .not('menu_group','in','("'+EXCLUDED_GROUPS.join('","')+'")')
    .lt('quantity',1000)
    .order('quantity',{ascending:false})
    .limit(20);

  // Filtra per keyword bevande
  const filtered=(items||[]).filter(i=>{
    const name=(i.menu_item||'').toLowerCase();
    return !EXCLUDED_KEYWORDS.some(k=>name.includes(k));
  }).slice(0,10);

  const medals=['🥇','🥈','🥉'];
  const dayLabel=yesterday.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});

  const rows=filtered.length
    ? filtered.map((item,i)=>
        '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid rgba(59,130,246,0.08);">'+
        '<span style="font-size:18px;min-width:28px;">'+(medals[i]||'·')+'</span>'+
        '<span style="font-size:14px;color:#1e3a5f;font-weight:500;flex:1;">'+item.menu_item+'</span>'+
        '<span style="font-size:13px;color:#60a5fa;font-weight:600;">'+item.quantity+' pcs</span>'+
        '</div>'
      ).join('')
    : '<div style="font-size:13px;color:#93c5fd;padding:8px 0;">No food data for yesterday</div>';

  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-50 flex items-end';
  modal.style.background='rgba(0,0,0,0.3)';
  modal.innerHTML='<div style="background:rgba(255,255,255,0.97);backdrop-filter:blur(20px);border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;max-height:75vh;overflow-y:auto;animation:slideUp .25s ease">'+
    '<div style="width:36px;height:4px;background:rgba(59,130,246,0.15);border-radius:2px;margin:0 auto 14px;"></div>'+
    '<div style="font-size:14px;font-weight:600;color:#1e3a5f;margin-bottom:4px;">Yesterday\'s Highlights</div>'+
    '<div style="font-size:11px;color:#93c5fd;margin-bottom:14px;">'+dayLabel+'</div>'+
    '<div>'+rows+'</div>'+
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

