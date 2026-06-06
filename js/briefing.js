// ── BRIEFING AI ──
async function loadBriefing(){
  const el=document.getElementById('briefingContent');
  el.innerHTML=`<div class="animate-pulse h-4 bg-slate-100 rounded w-3/4"></div><div class="animate-pulse h-4 bg-slate-100 rounded w-full mt-2"></div><div class="animate-pulse h-4 bg-slate-100 rounded w-2/3 mt-2"></div>`;
  try{
    const today=getNowDallas().toLocaleDateString('en-CA'); // YYYY-MM-DD Dallas time
    let{data:briefing}=await supa.from('briefing').select('*').eq('date',today).maybeSingle();
    if(!briefing){
      // genera al momento
      const res=await fetch(`${SUPABASE_URL}/functions/v1/generate-briefing`,{
        method:'POST',
        headers:{'Authorization':`Bearer ${SUPABASE_ANON_KEY}`}
      });
      const json=await res.json();
      if(json.points) briefing={points:json.points};
    }
    if(!briefing||!briefing.points||!briefing.points.length){
      el.innerHTML=`<p class="text-sm text-slate-400">${tr('briefingEmpty')}</p>`;
      return;
    }
    const icons=['🔴','🟡','🔵'];
    let points = briefing.points;
    // traduci se necessario
    if(user?.lang && user.lang !== 'it'){
      try{
        points = await Promise.all(points.map(p=>
          fetch(`${SUPABASE_URL}/functions/v1/ai-translate`,{
            method:'POST',
            headers:{'Content-Type':'application/json','Authorization':`Bearer ${SUPABASE_ANON_KEY}`},
            body:JSON.stringify({text:p,targetLang:user.lang})
          }).then(r=>r.json()).then(j=>j.translated||p).catch(()=>p)
        ));
      }catch(e){}
    }
    el.innerHTML=points.map((p,i)=>`
      <div class="flex gap-2 items-start py-1">
        <span class="text-sm mt-0.5 flex-shrink-0">${icons[i]||'•'}</span>
        <p class="text-sm text-slate-700 leading-snug">${p}</p>
      </div>`).join('');
  }catch(e){
    el.innerHTML=`<p class="text-sm text-red-500">${tr('briefingError')}</p>`;
  }
}

async function refreshBriefing(){
  // cancella il briefing di oggi e rigenera
  const today=new Date().toISOString().slice(0,10);
  await supa.from('briefing').delete().eq('date',today);
  loadBriefing();
}

// ── HOME STATIONS (pill per stazione con count) ──
function renderHomeStations(){
  // usa le categorie reali dal database
  const allCats=[...new Set(items.map(i=>i.category).filter(Boolean))].sort();
  const el=document.getElementById('homeStations');
  if(!allCats.length){el.innerHTML='<p class="text-xs text-slate-400">Nessuna stazione</p>';return}
  el.innerHTML=allCats.map(s=>{
    const missing=items.filter(i=>i.need_tomorrow&&i.category===s).length;
    const label=s.replace(' Station','').replace('Station','');
    return `<div onclick="goToStation('${s}')" class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer active:scale-95 transition ${missing>0?'bg-red-100 text-red-700 border border-red-200':'bg-green-100 text-green-700 border border-green-200'}">
      <span>${label}</span>
      ${missing>0?`<span class="bg-red-500 text-white text-[10px] w-4 h-4 flex items-center justify-center rounded-full">${missing}</span>`:`<span>✓</span>`}
    </div>`;
  }).join('');
}

function goToStation(s){
  station2=s;
  document.querySelector('[data-t=s]').click();
}

