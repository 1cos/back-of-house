// ── NEWS ──
async function loadNews(){
  const{data}=await supa.from('alerts').select('*').eq('is_active',true).order('created_at',{ascending:false});
  currentNews=data||[];
  const bar=document.getElementById('newsBar');
  if(!currentNews.length){bar.classList.add('hidden');return}
  bar.classList.remove('hidden');
  const base=currentNews.map(n=>{
    const t=new Date(n.created_at).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
    return{txt:n.message,suf:` • ${n.created_by||'Crew'} ${t}`};
  });
  // traduce sempre nella lingua dell'utente, indipendentemente dalla lingua originale
  const targetLang=user?.lang||'it';
  const trs=await Promise.all(base.map(b=>
    fetch(`${SUPABASE_URL}/functions/v1/ai-translate`,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${SUPABASE_ANON_KEY}`},
      body:JSON.stringify({text:b.txt,targetLang})
    }).then(r=>r.json()).then(j=>j.translated||b.txt).catch(()=>b.txt)
  ));
  const out=trs.map((t,i)=>t+base[i].suf).join(' ✦ ');
  document.getElementById('newsScroll').textContent=out;
}
// Realtime news con reconnect automatico
let newsChannel = null;
function startNewsRealtime(){
  if(newsChannel) supa.removeChannel(newsChannel);
  newsChannel = supa.channel('news-rt-'+Date.now())
    .on('postgres_changes',{event:'*',schema:'public',table:'alerts'},()=>{
      setTimeout(loadNews, 300);
    })
    .subscribe((status)=>{
      if(status==='CLOSED'||status==='CHANNEL_ERROR'){
        setTimeout(startNewsRealtime, 5000);
      }
    });
}
startNewsRealtime();
// poll ogni 60s come fallback
setInterval(loadNews, 60000);
if('Notification'in window&&Notification.permission==='default') Notification.requestPermission();

function updateAlertBtn(){
  if(isAdmin()){
    document.getElementById('alertBtn').classList.remove('hidden');
    document.getElementById('newsManage').classList.remove('hidden');
    const pb = document.getElementById('btnPresence');
    if(pb) pb.classList.remove('hidden');
    const ab = document.getElementById('btnAlertsLog');
    if(ab) ab.classList.remove('hidden');
    // bottone gestione utenti
    const ub = document.getElementById('userMgrBtn');
    if(ub) ub.classList.remove('hidden');
    // chiave password solo per admin
    const pwdB = document.getElementById('pwdBtn');
    if(pwdB) pwdB.classList.remove('hidden');
  }
}
document.getElementById('alertBtn').onclick=async()=>{
  const m=prompt('Nuova comunicazione:');
  if(m){await supa.from('alerts').insert({message:m,created_by:user?.name||'Admin',is_active:true});loadNews()}
};
document.getElementById('newsManage').onclick=async()=>{
  if(!currentNews.length)return;
  const list=currentNews.map((n,i)=>`${i+1}. ${n.message}`).join('\n');
  const num=prompt('Chiudi quale? (0=tutte)\n'+list);
  const idx=parseInt(num);
  if(idx===0) await supa.from('alerts').update({is_active:false}).eq('is_active',true);
  else if(currentNews[idx-1]) await supa.from('alerts').update({is_active:false}).eq('id',currentNews[idx-1].id);
  setTimeout(loadNews,300);
};

