// ── CHAT ──
function showChat(){
  document.querySelectorAll('.tab').forEach(x=>{x.classList.remove('tab-active');x.classList.add('text-slate-500');const svg=x.querySelector('svg');if(svg)svg.style.stroke='';const sp=x.querySelector('.tab-label');if(sp)sp.style.color=''});
  ['vh','vm','vs','vr','vp'].forEach(id=>document.getElementById(id).classList.add('hidden'));
  document.getElementById('vc').classList.remove('hidden');
  loadChat();startChatRealtime();loadPinnedMessages();
  document.getElementById('badge').classList.add('hidden');
  document.getElementById('badge').textContent='0';
}
async function loadChat(){
  const{data}=await supa.from('messages').select('*').order('created_at',{ascending:true}).limit(100);
  msgs.innerHTML='';(data||[]).forEach(m=>addMsg(m,true));
}
function addMsg(m,init){
  const me=m.user_name===user?.name;
  const d=document.createElement('div');
  d.className='flex '+(me?'justify-end':'');
  // traduce se la lingua del messaggio è diversa da quella dell'utente
  const needs=m.lang&&user&&user.lang&&m.lang!==user.lang&&m.user_name!==user?.name;
  const isPinned = m.pinned && isAdmin();
  d.innerHTML=`<div class="max-w-[75%]">
    ${m.pinned?'<div class="text-[10px] text-amber-600 font-semibold mb-0.5">📌 Pinnato</div>':''}
    <div class="text-xs text-slate-500">${m.user_name}</div>
    <div class="${me?'bg-slate-900 text-white':'bg-white border'} px-3 py-2 rounded-2xl text-sm">${m.text}</div>
    ${needs?'<div class="text-xs text-slate-500 italic mt-1" data-tr>...</div>':''}
    <div class="flex gap-1 mt-1 flex-wrap">
      ${(m.reactions||[]).map(r=>`<span class="text-sm bg-white border rounded-full px-1.5 py-0.5 text-xs">${r.emoji} ${r.count}</span>`).join('')}
      <button onclick="addReaction('${m.id}')" class="text-[10px] text-slate-400 px-1.5 py-0.5 bg-slate-100 rounded-full hover:bg-slate-200">+😊</button>
      ${isAdmin()&&!m.pinned?`<button onclick="pinMessage('${m.id}')" class="text-[10px] text-amber-600 px-1.5 py-0.5 bg-amber-50 rounded-full">📌</button>`:''}
    </div>
  </div>`;
  msgs.appendChild(d);msgs.scrollTop=99999;
  if(needs){
    const targetLang=user.lang||'it';
    fetch(`${SUPABASE_URL}/functions/v1/ai-translate`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${SUPABASE_ANON_KEY}`},body:JSON.stringify({text:m.text,targetLang})})
    .then(r=>r.json()).then(j=>{const el=d.querySelector('[data-tr]');if(el&&j.translated&&j.translated!==m.text)el.textContent='🌐 '+j.translated;else if(el)el.remove()});
  }
  if(!init&&!me){const badge=document.getElementById('badge');badge.textContent=(parseInt(badge.textContent||'0')+1);badge.classList.remove('hidden')}
}

// ── REAZIONI MESSAGGI (35) ──
const REACTIONS = ['👍','✅','👀','🔥','❤️'];
function addReaction(msgId){
  const picker=document.createElement('div');
  picker.className='fixed inset-0 z-50 bg-black/30 flex items-end justify-center';
  picker.innerHTML=`<div class="bg-white rounded-t-3xl p-4 w-full max-w-md" style="animation:slideUp .2s ease">
    <p class="text-xs text-slate-500 mb-3 text-center">${user?.lang==='en'?'Choose reaction':user?.lang==='es'?'Elige reacción':'Scegli reazione'}</p>
    <div class="flex justify-around">${REACTIONS.map(e=>`<button onclick="saveReaction('${msgId}','${e}');this.closest('.fixed').remove()" class="text-3xl active:scale-90 transition">${e}</button>`).join('')}</div>
  </div>`;
  picker.onclick=e=>{if(e.target===picker)picker.remove()};
  document.body.appendChild(picker);
}

async function saveReaction(msgId, emoji){
  // salva in tabella message_reactions se esiste, altrimenti aggiorna campo reactions
  try{
    await supa.from('message_reactions').upsert({message_id:msgId, user_name:user.name, emoji},{onConflict:'message_id,user_name'});
  }catch(e){
    // tabella non esiste ancora — mostra solo localmente
    console.log('reactions non disponibili');
  }
}

// ── PINNED MESSAGES (36) ──
async function pinMessage(msgId){
  try{
    await supa.from('messages').update({pinned:true}).eq('id',msgId);
    loadChat();
  }catch(e){}
}

async function loadPinnedMessages(){
  try{
    const{data}=await supa.from('messages').select('*').eq('pinned',true).order('created_at',{ascending:false}).limit(3);
    if(!data||!data.length) return;
    const banner=document.createElement('div');
    banner.className='bg-amber-50 border-b border-amber-200 px-3 py-2';
    banner.innerHTML=`<div class="flex items-center gap-2 text-xs text-amber-800"><span>📌</span><span class="font-semibold">Pinnati:</span><span>${data.map(m=>m.text.slice(0,40)+'...').join(' • ')}</span></div>`;
    const msgsEl=document.getElementById('msgs');
    if(msgsEl&&msgsEl.parentElement) msgsEl.parentElement.insertBefore(banner,msgsEl);
  }catch(e){}
}

let chatChannel=null;
function startChatRealtime(){
  if(chatChannel)return;
  chatChannel=supa.channel('public:messages').on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},p=>addMsg(p.new,false)).subscribe();
}
document.getElementById('f').onsubmit=async e=>{
  e.preventDefault();
  const v=document.getElementById('txt').value.trim();
  if(!v)return;
  document.getElementById('txt').value='';
  await supa.from('messages').insert({text:v,user_name:user.name,lang:user.lang||'it'});
};

// AUTO-LOGIN via auth_id rimosso — login solo nome+password

// ── REPORT ──
async function loadReport(type){
  document.getElementById('reportOut').classList.remove('hidden');
  document.getElementById('presenceLogOut').classList.add('hidden');
  document.getElementById('alertsLogOut').classList.add('hidden');
  document.getElementById('btnPresence')?.classList.remove('bg-slate-900','text-white');
  document.getElementById('btnPresence')?.classList.add('bg-slate-200');
  document.getElementById('btnAlertsLog')?.classList.remove('bg-slate-900','text-white');
  document.getElementById('btnAlertsLog')?.classList.add('bg-slate-200');
  const out=document.getElementById('reportOut');out.innerHTML='...';
  document.getElementById('btnToday').classList.toggle('bg-slate-900',type==='today');document.getElementById('btnToday').classList.toggle('text-white',type==='today');
  document.getElementById('btnWeek').classList.toggle('bg-slate-900',type==='week');document.getElementById('btnWeek').classList.toggle('text-white',type==='week');
  try{
    if(type==='today'){
      const now=new Date();
      const startUTC=new Date(now.getFullYear(),now.getMonth(),now.getDate()).toISOString();
      const{data:logs}=await supa.from('prep_log').select('item,qty,unit,container,user_name,created_at').gte('created_at',startUTC).order('created_at',{ascending:false});
      lastReport=logs||[];
      const by={};logs.forEach(l=>by[l.user_name]=(by[l.user_name]||0)+1);
      const byHtml=Object.keys(by).length?`<div class="mb-3 p-2 bg-slate-50 rounded-lg text-xs"><div class="font-semibold mb-1">${tr('prepBy')}</div>${Object.entries(by).map(([u,c])=>`${u}: ${c}`).join(' • ')}</div>`:'';
      if(!logs.length){out.innerHTML=byHtml+`<p class="text-slate-500">${tr('noData')}</p>`;return}
      out.innerHTML=byHtml+`<table class="w-full text-xs"><thead><tr class="border-b font-semibold"><td class="py-1">${tr('item')}</td><td>Qty</td><td>${tr('unit')}</td><td>Cont.</td><td>Chi</td><td>Ora</td></tr></thead><tbody>`+logs.map(r=>{const t=formatTimeDallas(r.created_at);return`<tr class="border-b"><td class="py-1">${r.item}</td><td>${r.qty}</td><td>${r.unit||''}</td><td>${r.container||''}</td><td>${r.user_name}</td><td>${t}</td></tr>`}).join('')+`</tbody></table>`;
    }else{
      // lunedì di questa settimana — compatibile Safari
      const today=new Date();
      const yyyy=today.getUTCFullYear();
      const mm=String(today.getUTCMonth()+1).padStart(2,'0');
      const dd=String(today.getUTCDate()).padStart(2,'0');
      const todayStr=`${yyyy}-${mm}-${dd}`;
      // calcola lunedì
      const dow=today.getUTCDay();
      const daysBack=dow===0?6:dow-1;
      const monDate=new Date(today);
      monDate.setUTCDate(today.getUTCDate()-daysBack);
      const my=monDate.getUTCFullYear();
      const mmm=String(monDate.getUTCMonth()+1).padStart(2,'0');
      const mdd=String(monDate.getUTCDate()).padStart(2,'0');
      const monStr=`${my}-${mmm}-${mdd}`;
      const{data}=await supa.from('v_prep_weekly').select('*').eq('settimana_lun',monStr);
      const map={};(data||[]).forEach(r=>{if(!map[r.item])map[r.item]=Array(7).fill('');map[r.item][r.giorno_num-1]=`${r.totale}`});
      lastReport=Object.entries(map).map(([item,vals])=>({item,vals}));
      const days=user?.lang==='en'?['Mon','Tue','Wed','Thu','Fri','Sat','Sun']:user?.lang==='es'?['Lun','Mar','Mié','Jue','Vie','Sáb','Dom']:['Lun','Mar','Mer','Gio','Ven','Sab','Dom'];
      out.innerHTML=`<table class="w-full text-xs"><thead><tr class="border-b font-semibold"><td>${tr('item')}</td>${days.map(d=>`<td>${d}</td>`).join('')}</tr></thead><tbody>`+lastReport.map(r=>`<tr class="border-b"><td class="py-1">${r.item}</td>${r.vals.map(v=>`<td>${v||''}</td>`).join('')}</tr>`).join('')+`</tbody></table>`;
    }
  }catch(e){out.innerHTML=`<p class="text-red-600">${e.message}</p>`}
}
function exportPDF(){
  if(!lastReport.length)return;
  const{jsPDF}=window.jspdf;const doc=new jsPDF();
  doc.text(tr('report'),14,15);doc.autoTable({html:'#reportOut table',startY:20});doc.save('report.pdf');
}


