// ── NEWS — solo admin ──
const DEFAULT_LANG = 'en';
function normalizeLang(lang){
  if(!lang) return DEFAULT_LANG;
  return String(lang).trim().toLowerCase().slice(0,2)||DEFAULT_LANG;
}

async function loadNews(){
  const{data}=await supa.from('alerts').select('*').eq('is_active',true).order('created_at',{ascending:false});
  currentNews=data||[];
  const bar=document.getElementById('newsBar');
  if(!currentNews.length){bar.classList.add('hidden');return}
  bar.classList.remove('hidden');
  const viewerLang = normalizeLang(user?.lang);

  // Per ogni alert: detect lingua originale, poi traduci se necessario
  const translated = await Promise.all(currentNews.map(async n => {
    const t = new Date(n.created_at).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
    const suf = ` • ${n.created_by||'Crew'} ${t}`;
    const sourceText = n.message || '';
    if(!sourceText.trim()) return sourceText + suf;

    try {
      // Detect lingua originale
      const detectRes = await fetch(`${SUPABASE_URL}/functions/v1/ai-translate`,{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${SUPABASE_ANON_KEY}`},
        body:JSON.stringify({text:sourceText, targetLang:'__detect__'})
      });
      const detectData = await detectRes.json();
      const sourceLang = normalizeLang(detectData.detected);

      // Traduci solo se lingua diversa
      if(sourceLang !== viewerLang) {
        const transRes = await fetch(`${SUPABASE_URL}/functions/v1/ai-translate`,{
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':`Bearer ${SUPABASE_ANON_KEY}`},
          body:JSON.stringify({text:sourceText, targetLang:viewerLang})
        });
        const transData = await transRes.json();
        return (transData.translated || sourceText) + suf;
      }
      return sourceText + suf;
    } catch(e) {
      return sourceText + suf; // fallback originale
    }
  }));

  const out = translated.join(' ✦ ');
  document.getElementById('newsScroll').textContent=out;
}

// Realtime news — solo admin
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

// Poll ogni 60s solo dopo login admin
// Non parte automaticamente — viene chiamato da doLogin() se admin
function initNews(){
  startNewsRealtime();
  setInterval(loadNews, 60000);
  if('Notification'in window&&Notification.permission==='default') Notification.requestPermission();
}

function updateAlertBtn(){
  if(!isAdmin()) return;
  document.getElementById('alertBtn').classList.remove('hidden');
  document.getElementById('newsManage').classList.remove('hidden');
  const pb=document.getElementById('btnPresence');
  if(pb) pb.classList.remove('hidden');
  const ab=document.getElementById('btnAlertsLog');
  if(ab) ab.classList.remove('hidden');
  const ub=document.getElementById('userMgrBtn');
  if(ub) ub.classList.remove('hidden');
  const pwdB=document.getElementById('pwdBtn');
  if(pwdB) pwdB.classList.remove('hidden');
}

// ── NUOVA COMUNICAZIONE — modal invece di prompt ──────────────
document.getElementById('alertBtn').onclick=()=>{
  if(!isAdmin()) return;
  showNewsModal();
};

document.getElementById('newsManage').onclick=()=>{
  if(!isAdmin()) return;
  showNewsManageModal();
};

function showNewsModal(){
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-[70] flex items-center justify-center';
  modal.style.background='rgba(0,0,0,0.4)';
  modal.innerHTML=`
    <div style="background:white;border-radius:20px;padding:20px;width:88%;max-width:360px;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
      <div style="font-size:15px;font-weight:600;color:#1e293b;margin-bottom:12px;">📢 Nuova comunicazione</div>
      <textarea id="newsInputText" rows="3" placeholder="Scrivi il messaggio per il team..."
        style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:12px;font-size:14px;resize:none;box-sizing:border-box;outline:none;font-family:inherit;"></textarea>
      <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px;margin-top:12px;">
        <button onclick="this.closest('.fixed').remove()" 
          style="height:42px;border-radius:12px;background:#f1f5f9;color:#64748b;font-size:13px;border:none;cursor:pointer;">
          Annulla
        </button>
        <button onclick="sendNews(this)"
          style="height:42px;border-radius:12px;background:#1e293b;color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;">
          Invia al team
        </button>
      </div>
    </div>`;
  modal.onclick=e=>{if(e.target===modal)modal.remove()};
  document.body.appendChild(modal);
  setTimeout(()=>document.getElementById('newsInputText')?.focus(), 100);
}

window.sendNews=async(btn)=>{
  const text=document.getElementById('newsInputText')?.value?.trim();
  if(!text) return;
  btn.textContent='Invio...';
  btn.disabled=true;
  await supa.from('alerts').insert({
    message:   text,
    created_by: user?.name||'Max',
    is_active:  true
  });
  btn.closest('.fixed').remove();
  loadNews();
};

function showNewsManageModal(){
  if(!currentNews?.length){
    const t=document.createElement('div');
    t.className='fixed top-16 left-1/2 -translate-x-1/2 z-[70] bg-slate-800 text-white text-sm px-4 py-2 rounded-xl';
    t.textContent='Nessuna comunicazione attiva';
    document.body.appendChild(t);
    setTimeout(()=>t.remove(),2000);
    return;
  }

  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-[70] flex items-end';
  modal.style.background='rgba(0,0,0,0.3)';
  modal.innerHTML=`
    <div style="background:white;border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;max-height:70vh;overflow-y:auto;">
      <div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 14px;"></div>
      <div style="font-size:15px;font-weight:600;color:#1e293b;margin-bottom:12px;">📋 Comunicazioni attive</div>
      ${currentNews.map((n,i)=>`
        <div style="display:flex;justify-content:space-between;align-items:start;padding:10px 0;border-bottom:1px solid #f1f5f9;">
          <div style="flex:1;font-size:13px;color:#1e293b;margin-right:10px;">${n.message}
            <div style="font-size:11px;color:#94a3b8;margin-top:2px;">${n.created_by||'Admin'}</div>
          </div>
          <button onclick="closeNews('${n.id}',this)" 
            style="flex-shrink:0;padding:5px 10px;border-radius:8px;background:#fee2e2;color:#dc2626;font-size:12px;border:none;cursor:pointer;">
            Chiudi
          </button>
        </div>`).join('')}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px;">
        <button onclick="this.closest('.fixed').remove()"
          style="height:42px;border-radius:12px;background:#f1f5f9;color:#64748b;font-size:13px;border:none;cursor:pointer;">
          Chiudi
        </button>
        <button onclick="closeAllNews(this)"
          style="height:42px;border-radius:12px;background:#dc2626;color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;">
          Chiudi tutte
        </button>
      </div>
    </div>`;
  modal.onclick=e=>{if(e.target===modal)modal.remove()};
  document.body.appendChild(modal);
}

window.closeNews=async(id, btn)=>{
  btn.textContent='...';
  await supa.from('alerts').update({is_active:false}).eq('id',id);
  btn.closest('.fixed').remove();
  setTimeout(loadNews,300);
};

window.closeAllNews=async(btn)=>{
  btn.textContent='...';
  await supa.from('alerts').update({is_active:false}).eq('is_active',true);
  btn.closest('.fixed').remove();
  setTimeout(loadNews,300);
};
