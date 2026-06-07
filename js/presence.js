// ── PRESENZA REALTIME ──
let presenceInterval = null;
let presenceChannel = null;

async function updatePresence(){
  if(!user) return;
  const st2 = (typeof station2 !== 'undefined' ? station2 : 'All');
  const st = (typeof station !== 'undefined' ? station : 'All');
  const stationVal = st2 !== 'All' ? st2 : (st !== 'All' ? st : null);
  await supa.from('user_presence').upsert(
    {
      user_name: user.name,
      last_seen:  new Date().toISOString(),
      role:       user.role||'staff',
      station:    stationVal||null,
      photo_url:  user.photo_url||null
    },
    {onConflict: 'user_name'}
  );
}

async function loadPresence(){
  const{data}=await supa.from('user_presence').select('*').order('last_seen',{ascending:false});
  if(!data) return;
  const now = Date.now();
  const online = data.filter(u => (now - new Date(u.last_seen).getTime()) < 2*60*1000);
  const el = document.getElementById('online');
  el.innerHTML = online.map(u => {
    const initials = u.user_name.slice(0,2).toUpperCase();
    const isMe = u.user_name === user?.name;
    const bgColors = ['#10b981','#3b82f6','#8b5cf6','#f59e0b','#ef4444','#14b8a6'];
    const colorIdx = u.user_name.charCodeAt(0) % bgColors.length;
    const bg = bgColors[colorIdx];
    const ring = isMe ? 'box-shadow:0 0 0 2px #6ee7b7;' : '';
    const inner = u.photo_url
      ? `<img src="${u.photo_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
      : initials;
    return `<div onclick="showPresenceTooltip('${u.user_name}','${u.station||''}',this)"
      style="width:36px;height:36px;border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;color:white;font-size:13px;font-weight:700;border:2.5px solid white;cursor:pointer;overflow:hidden;flex-shrink:0;${ring}"
      title="${u.user_name}${u.station?' • '+u.station:''}">
      ${inner}
    </div>`;
  }).join('');
}

function showPresenceTooltip(name, station, el){
  // rimuovi tooltip esistenti
  document.querySelectorAll('.presence-tooltip').forEach(t=>t.remove());
  const tip = document.createElement('div');
  tip.className = 'presence-tooltip fixed z-50 bg-slate-900 text-white text-xs px-3 py-2 rounded-xl shadow-xl';
  tip.innerHTML = `<div class="font-semibold">${name}</div>${station?`<div class="text-slate-300">${station}</div>`:''}`;
  const rect = el.getBoundingClientRect();
  tip.style.top = (rect.bottom + 6) + 'px';
  tip.style.left = Math.max(8, rect.left - 40) + 'px';
  document.body.appendChild(tip);
  setTimeout(()=>tip.remove(), 2500);
}

function startPresence(){
  updatePresence();
  loadPresence();
  presenceInterval = setInterval(()=>{updatePresence();loadPresence();}, 60000);
  // realtime
  presenceChannel = supa.channel('presence-rt')
    .on('postgres_changes',{event:'*',schema:'public',table:'user_presence'},loadPresence)
    .subscribe();
}

function stopPresence(){
  if(presenceInterval) clearInterval(presenceInterval);
  if(presenceChannel) supa.removeChannel(presenceChannel);
}

// ── LOG PRESENZE (solo Max) ──
async function loadPresenceLog(){
  const out = document.getElementById('presenceLogOut');
  if(!out) return;
  out.innerHTML = `<p class="text-slate-400 text-xs">${tr('loading')}</p>`;
  const since = new Date(Date.now() - 7*24*60*60*1000).toISOString();
  const{data} = await supa.from('user_presence').select('*').order('last_seen',{ascending:false});
  if(!data||!data.length){out.innerHTML=`<p class="text-slate-400 text-xs">${tr('noData2')}</p>`;return}
  const now = Date.now();
  out.innerHTML = `<table class="w-full text-xs"><thead><tr class="border-b font-semibold"><td class="py-1">Name</td><td>${tr("station")}</td><td>${tr("role")}</td><td>${tr("lastAccess")}</td><td>${tr("status")}</td></tr></thead><tbody>`+
    data.map(u=>{
      const diff = now - new Date(u.last_seen).getTime();
      const isOnline = diff < 2*60*1000;
      const mins = Math.floor(diff/60000);
      const hours = Math.floor(mins/60);
      const timeAgo = isOnline ? tr('online') : hours>0 ? `${hours}h fa` : `${mins}m fa`;
      return `<tr class="border-b">
        <td class="py-1 font-medium">${u.user_name}</td>
        <td>${u.station||'—'}</td>
        <td>${u.role||'staff'}</td>
        <td>${new Date(u.last_seen).toLocaleString('it-IT',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
        <td><span class="px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${isOnline?'bg-green-100 text-green-700':'bg-slate-100 text-slate-500'}">${timeAgo}</span></td>
      </tr>`;
    }).join('')+`</tbody></table>`;
}



async function showAlertsLogTab(){
  ['btnToday','btnWeek','btnPresence'].forEach(id=>{
    const b=document.getElementById(id);
    if(b){b.classList.remove('bg-slate-900','text-white');b.classList.add('bg-slate-200');}
  });
  document.getElementById('btnAlertsLog').classList.add('bg-slate-900','text-white');
  document.getElementById('btnAlertsLog').classList.remove('bg-slate-200');
  document.getElementById('reportOut').classList.add('hidden');
  document.getElementById('presenceLogOut').classList.add('hidden');
  document.getElementById('alertsLogOut').classList.remove('hidden');
  loadAlertsLog();
}

async function loadAlertsLog(){
  const out=document.getElementById('alertsLogOut');
  out.innerHTML='<p class="text-slate-400 text-xs">Caricamento...</p>';
  const{data}=await supa.from('alerts_log').select('*').order('created_at',{ascending:false}).limit(50);
  if(!data||!data.length){out.innerHTML='<p class="text-slate-400 text-xs">Nessun avviso registrato</p>';return}
  out.innerHTML=`<table class="w-full text-xs"><thead><tr class="border-b font-semibold"><td class="py-1">Item</td><td>Chi</td><td>Esito</td><td>Qty fatta</td><td>Ora</td></tr></thead><tbody>`+
    data.map(r=>{
      const t=new Date(r.created_at).toLocaleString('it-IT',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
      return`<tr class="border-b"><td class="py-1 font-medium">${r.item}</td><td>${r.user_name||'—'}</td><td><span class="px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${r.was_really_missing?'bg-red-100 text-red-700':'bg-green-100 text-green-700'}">${r.was_really_missing?'Mancava':'Falso allarme'}</span></td><td>${r.qty_made_that_day||'—'}</td><td>${t}</td></tr>`;
    }).join('')+`</tbody></table>`;
}

function showPresenceTab(){
  document.getElementById('btnToday').classList.remove('bg-slate-900','text-white');
  document.getElementById('btnToday').classList.add('bg-slate-200');
  document.getElementById('btnWeek').classList.remove('bg-slate-900','text-white');
  document.getElementById('btnWeek').classList.add('bg-slate-200');
  document.getElementById('btnPresence').classList.add('bg-slate-900','text-white');
  document.getElementById('btnPresence').classList.remove('bg-slate-200');
  document.getElementById('reportOut').classList.add('hidden');
  document.getElementById('presenceLogOut').classList.remove('hidden');
  loadPresenceLog();
}


