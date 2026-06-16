// ── BRIEFING AI ──
async function loadBriefing(){
  const el=document.getElementById('briefingContent');
  if(!el) return;
  el.innerHTML='<div class="animate-pulse h-4 bg-slate-100 rounded w-3/4"></div><div class="animate-pulse h-4 bg-slate-100 rounded w-full mt-2"></div><div class="animate-pulse h-4 bg-slate-100 rounded w-2/3 mt-2"></div>';
  try{
    const today=getNowDallas().toLocaleDateString('en-CA');
    let{data:briefing}=await supa.from('briefing').select('*').eq('date',today).maybeSingle();
    if(!briefing){
      const res=await fetch(`${SUPABASE_URL}/functions/v1/generate-briefing`,{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${SUPABASE_ANON_KEY}`}
      });
      const json=await res.json();
      if(json.points) briefing={points:json.points};
    }
    if(!briefing||!briefing.points||!briefing.points.length){
      el.innerHTML='<p class="text-sm text-slate-400">'+tr('briefingEmpty')+'</p>';
      return;
    }
    const icons=['🔴','🟡','🔵'];
    let points=briefing.points;
    if(user?.lang&&user.lang!=='it'){
      try{
        points=await Promise.all(points.map(p=>
          fetch(`${SUPABASE_URL}/functions/v1/ai-translate`,{
            method:'POST',
            headers:{'Content-Type':'application/json','Authorization':`Bearer ${SUPABASE_ANON_KEY}`},
            body:JSON.stringify({text:p,targetLang:user.lang})
          }).then(r=>r.json()).then(j=>j.translated||p).catch(()=>p)
        ));
      }catch(e){}
    }
    el.innerHTML=points.map((p,i)=>
      '<div class="flex gap-2 items-start py-1">'+
      '<span class="text-sm mt-0.5 flex-shrink-0">'+(icons[i]||'•')+'</span>'+
      '<p class="text-sm text-slate-700 leading-snug">'+p+'</p>'+
      '</div>'
    ).join('');
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

// ── SERVICE UPDATES ──
async function loadServiceUpdates(){
  try{
    const{data}=await supa.from('service_updates').select('*').order('created_at',{ascending:false}).limit(3);
    const el=document.getElementById('serviceUpdatesList');
    if(!el) return;
    if(!data||!data.length){
      el.innerHTML='<div style="font-size:12px;color:#93c5fd;padding:4px 0;">No updates</div>';
      return;
    }
    el.innerHTML=data.map(u=>{
      const color=u.level==='urgent'?'#ef4444':u.level==='warning'?'#f59e0b':'#3B82F6';
      const t=new Date(u.created_at).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',timeZone:'America/Chicago'});
      return '<div style="display:flex;align-items:flex-start;gap:8px;padding:4px 0;">'+
        '<div style="width:7px;height:7px;border-radius:50%;background:'+color+';flex-shrink:0;margin-top:4px;"></div>'+
        '<span style="font-size:13px;color:#1e3a5f;flex:1;line-height:1.4;">'+u.message+'</span>'+
        '<span style="font-size:10px;color:#93c5fd;white-space:nowrap;">'+t+'</span>'+
        '</div>';
    }).join('');
  }catch(e){}
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
  const{data}=await supa.from('service_updates').select('*').order('created_at',{ascending:false}).limit(20);
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-50 flex items-end';
  modal.style.background='rgba(0,0,0,0.3)';
  modal.innerHTML='<div style="background:rgba(255,255,255,0.95);backdrop-filter:blur(20px);border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;max-height:70vh;overflow-y:auto;animation:slideUp .25s ease">'+
    '<div style="width:36px;height:4px;background:rgba(59,130,246,0.15);border-radius:2px;margin:0 auto 14px;"></div>'+
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'+
    '<div style="font-size:14px;font-weight:500;color:#1e3a5f;">Yesterday\'s Highlights</div>'+
    (isAdmin()?'<button onclick="addServiceUpdate()" style="font-size:12px;color:#3B82F6;background:rgba(59,130,246,0.1);border:none;padding:4px 10px;border-radius:8px;cursor:pointer;">+ Add</button>':'')+
    '</div><div>'+
    (data||[]).map(u=>{
      const color=u.level==='urgent'?'#ef4444':u.level==='warning'?'#f59e0b':'#3B82F6';
      const t=new Date(u.created_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'America/Chicago'});
      return '<div style="display:flex;align-items:flex-start;gap:8px;padding:8px 0;border-bottom:0.5px solid rgba(59,130,246,0.08);">'+
        '<div style="width:7px;height:7px;border-radius:50%;background:'+color+';flex-shrink:0;margin-top:5px;"></div>'+
        '<div style="flex:1;"><div style="font-size:13px;color:#1e3a5f;line-height:1.4;">'+u.message+'</div>'+
        '<div style="font-size:10px;color:#93c5fd;margin-top:2px;">'+(u.created_by||'System')+' · '+t+'</div></div>'+
        '</div>';
    }).join('')+
    '</div><button onclick="this.closest(\'.fixed\').remove()" style="width:100%;height:40px;border-radius:14px;background:#1e3a5f;color:white;font-size:13px;margin-top:14px;">Close</button>'+
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