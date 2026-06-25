// ── CHAT — Glass Effect Apple ──
const REACTIONS = ['👍','✅','👀','🔥','❤️','😂','🙏'];

// Pulizia automatica overlay Focus Chat (Focus Mode disabilitato)
document.addEventListener('DOMContentLoaded', function() {
  var ov = document.getElementById('_focusChatOverlay');
  if (ov) ov.remove();
});

// ── FOTO IN CHAT ─────────────────────────────────────────────
var _chatPendingImageFile = null;  // file selezionato, in attesa di invio

window.onChatImgSelected = function(input) {
  const file = input.files[0];
  if (!file) return;
  _chatPendingImageFile = file;
  // Mostra thumbnail preview
  const reader = new FileReader();
  reader.onload = function(e) {
    const thumb = document.getElementById('chatImgThumb');
    const preview = document.getElementById('chatImgPreview');
    if (thumb) thumb.src = e.target.result;
    if (preview) preview.style.display = 'block';
  };
  reader.readAsDataURL(file);
};

window.clearChatImg = function() {
  _chatPendingImageFile = null;
  const preview = document.getElementById('chatImgPreview');
  const input = document.getElementById('chatImgInput');
  if (preview) preview.style.display = 'none';
  if (input) input.value = '';
};

async function uploadChatImage(file) {
  const ext = file.name.split('.').pop() || 'jpg';
  const path = 'chat/' + Date.now() + '_' + Math.random().toString(36).slice(2,7) + '.' + ext;
  const { data, error } = await supa.storage.from('chat-images').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type
  });
  if (error) throw error;
  const { data: urlData } = supa.storage.from('chat-images').getPublicUrl(path);
  return urlData.publicUrl;
}

function _renderChatImg(imageUrl, hasText) {
  if (!imageUrl) return '';
  var mt = hasText ? '8px' : '0';
  return '<img src="' + imageUrl + '" onclick="openChatImg(this.src)" style="max-width:200px;max-height:200px;border-radius:10px;display:block;margin-top:' + mt + ';cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.15);" />';
}




// Traccia se Focus Mode era attiva prima di aprire la chat
var _chatOpenedFromFocus = false;

function showChat(){
  // Rimuovi sempre l'overlay Focus Chat se esiste (Focus Mode disabilitato)
  var _existingOverlay = document.getElementById('_focusChatOverlay');
  if (_existingOverlay) { _existingOverlay.remove(); }

  const fm = document.getElementById('focusMode');
  const focusActive = fm && fm.style.display !== 'none';

  if (focusActive) {
    // Nascondi Focus Mode temporaneamente — ricorda di tornare
    _chatOpenedFromFocus = true;
    fm.style.display = 'none';
  } else {
    _chatOpenedFromFocus = false;
  }

  // Nascondi mic Chef AI — sovrappone il bottone invio su iPhone
  var scBtn = document.getElementById('scBtn');
  if (scBtn) scBtn.style.display = 'none';
  // Resetta navigazione tab
  document.querySelectorAll('.tab').forEach(x=>{
    x.classList.remove('tab-active');x.classList.add('text-slate-500');
    const svg=x.querySelector('svg');if(svg)svg.style.stroke='';
    const sp=x.querySelector('.tab-label');if(sp)sp.style.color='';
  });
  ['vh','vm','vs','vr','vp','vi'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.classList.add('hidden');
  });
  document.getElementById('vc').classList.remove('hidden');
  loadChat();
  startChatRealtime();
  loadPinnedMessages();
  // Azzera badge chat e badge Focus Mode
  var badge = document.getElementById('badge');
  if(badge){badge.style.display='none';badge.textContent='0';}
  var focusBadge = document.getElementById('focusChatBadge');
  if(focusBadge){focusBadge.style.display='none';focusBadge.textContent='0';}
  // Mostra/nascondi bottone ← in base alla provenienza
  var backBtn = document.getElementById('chatBackBtn');
  if(backBtn) backBtn.style.display = _chatOpenedFromFocus ? 'flex' : 'none';
}

// Chiudi chat e torna dove si era
window.closeChat = function() {
  if (_chatOpenedFromFocus) {
    // Torna in Focus Mode
    _chatOpenedFromFocus = false;
    ['vh','vm','vs','vr','vp','vi','vc'].forEach(id=>{
      var el=document.getElementById(id);if(el)el.classList.add('hidden');
    });
    var fm = document.getElementById('focusMode');
    if (fm) fm.style.display = 'flex';
    // Ripristina mic Chef AI
    var scBtn = document.getElementById('scBtn');
    if (scBtn) scBtn.style.display = '';
  }
  // Se non era Focus Mode, il bottone ← normale gestisce il ritorno alla home
};

function _showChatOverlay(){
  // Rimuovi overlay esistente se c'e'
  const existing = document.getElementById('_focusChatOverlay');
  if (existing) { existing.remove(); return; }

  const overlay = document.createElement('div');
  overlay.id = '_focusChatOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:200;background:#f1f5f9;display:flex;flex-direction:column;';
  overlay.innerHTML =
    '<div style="display:flex;align-items:center;padding:14px 16px 10px;background:white;border-bottom:1px solid #e2e8f0;gap:12px;flex-shrink:0;">' +
      '<button onclick="_closeFocusChatOverlay()" style="width:36px;height:36px;border-radius:50%;background:#f1f5f9;border:none;font-size:18px;cursor:pointer;">&#8592;</button>' +
      '<div style="font-size:16px;font-weight:700;color:#1e3a5f;">💬 Chat Brigata</div>' +
    '</div>' +
    '<div id="_focusChatBody" style="flex:1;overflow-y:auto;padding:12px;"></div>' +
    '<div style="padding:12px;background:white;border-top:1px solid #e2e8f0;display:flex;gap:8px;flex-shrink:0;">' +
      '<input id="_focusChatInput" type="text" placeholder="Scrivi un messaggio..." style="flex:1;height:44px;border-radius:12px;border:1px solid #e2e8f0;padding:0 14px;font-size:15px;outline:none;" />' +
      '<button onclick="_focusChatSend()" style="height:44px;padding:0 18px;border-radius:12px;background:#1e3a5f;color:white;font-size:15px;font-weight:600;border:none;cursor:pointer;">Invia</button>' +
    '</div>';

  document.body.appendChild(overlay);

  // Azzera badge
  const badge = document.getElementById('badge');
  if(badge){badge.style.display='none';badge.textContent='0';}

  // Carica messaggi nel body dell'overlay
  _loadFocusChatMessages();
  _focusChatRealtime();

  // Invio con Enter
  overlay.querySelector('#_focusChatInput').addEventListener('keydown', function(e){
    if(e.key === 'Enter') _focusChatSend();
  });
}

function _closeFocusChatOverlay(){
  const el = document.getElementById('_focusChatOverlay');
  if (el) el.remove();
  if (_focusChatChannel) { supa.removeChannel(_focusChatChannel); _focusChatChannel = null; }
}

async function _loadFocusChatMessages(){
  const body = document.getElementById('_focusChatBody');
  if (!body) return;
  const { data } = await supa.from('messages').select('*').order('created_at', {ascending: true}).limit(80);
  if (!data) return;
  body.innerHTML = data.map(function(m){
    const mine = m.user_name === user.name;
    return '<div style="display:flex;justify-content:' + (mine?'flex-end':'flex-start') + ';margin-bottom:10px;">' +
      '<div style="max-width:75%;padding:10px 14px;border-radius:' + (mine?'18px 18px 4px 18px':'18px 18px 18px 4px') + ';background:' + (mine?'#1e3a5f':'white') + ';color:' + (mine?'white':'#1e293b') + ';font-size:14px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">' +
        (mine?'':'<div style="font-size:11px;font-weight:700;color:#94a3b8;margin-bottom:2px;">' + m.user_name + '</div>') +
        m.text +
      '</div></div>';
  }).join('');
  body.scrollTop = body.scrollHeight;
}

var _focusChatChannel = null;
function _focusChatRealtime(){
  if (_focusChatChannel) supa.removeChannel(_focusChatChannel);
  _focusChatChannel = supa.channel('focus-chat-overlay')
    .on('postgres_changes', {event:'INSERT', schema:'public', table:'messages'}, function(){
      _loadFocusChatMessages();
    }).subscribe();
}

async function _focusChatSend(){
  const input = document.getElementById('_focusChatInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  await supa.from('messages').insert({
    text: text,
    user_name: user.name,
    station: user.station || ''
  });
}

async function loadChat(){
  const el=document.getElementById('msgs');
  if(el) el.innerHTML='';
  const{data}=await supa.from('messages').select('*').order('created_at',{ascending:true}).limit(100);
  (data||[]).forEach(m=>addMsg(m,true));
}

function isChatOpen(){
  const vc=document.getElementById('vc');
  return vc && !vc.classList.contains('hidden');
}

function addMsg(m,init){
  const me=m.user_name===user?.name;
  const isSystem=m.user_name==='Sistema';
  const msgs=document.getElementById('msgs');
  if(!msgs) return;

  // Traduci se: lingua messaggio diversa dalla lingua del viewer
  const msgLang = normalizeLang(m.lang);
  const viewerLang = normalizeLang(user?.lang);
  const needs = m.user_name !== user?.name && msgLang !== viewerLang;
  const d=document.createElement('div');

  if(isSystem){
    // Sistema — pill centrata
    d.style.cssText='display:flex;justify-content:center;margin:6px 0;';
    d.innerHTML=`<div style="
      font-size:11px;color:#64748b;
      background:rgba(241,245,249,0.8);
      backdrop-filter:blur(8px);
      padding:4px 14px;border-radius:20px;
      max-width:85%;text-align:center;
      border:0.5px solid rgba(148,163,184,0.2);
    ">${m.text}</div>`;

  } else if(me){
    // Mio messaggio — destra, glass celeste
    d.style.cssText='display:flex;justify-content:flex-end;margin:3px 0;padding:0 4px;';
    d.innerHTML=`
      <div style="max-width:78%;">
        <div style="
          background:linear-gradient(135deg,rgba(3,105,161,0.92),rgba(2,132,199,0.88));
          backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
          color:white;padding:11px 15px;
          border-radius:20px 20px 5px 20px;
          font-size:14px;line-height:1.45;
          box-shadow:0 4px 20px rgba(3,105,161,0.25),inset 0 1px 0 rgba(255,255,255,0.15);
          border:0.5px solid rgba(255,255,255,0.15);
        ">${m.text||''}${_renderChatImg(m.image_url, !!(m.text))}</div>
        <div style="font-size:10px;color:#94a3b8;text-align:right;margin-top:4px;padding-right:4px;">
          ${formatTimeDallas(m.created_at)}
        </div>
        <div style="display:flex;gap:4px;margin-top:4px;justify-content:flex-end;flex-wrap:wrap;">
          ${(m.reactions||[]).map(r=>`<span style="font-size:12px;background:rgba(255,255,255,0.8);backdrop-filter:blur(8px);border:0.5px solid rgba(0,0,0,0.08);border-radius:20px;padding:2px 8px;">${r.emoji} ${r.count}</span>`).join('')}
          <button onclick="addReaction('${m.id}')" style="font-size:11px;color:#94a3b8;background:rgba(241,245,249,0.8);border:0.5px solid rgba(148,163,184,0.2);border-radius:20px;padding:2px 8px;cursor:pointer;">+😊</button>
        </div>
      </div>`;

  } else {
    // Messaggio altrui — sinistra, glass bianco
    d.style.cssText='display:flex;align-items:flex-end;gap:8px;margin:3px 0;padding:0 4px;';
    d.innerHTML=`
      <div style="
        width:32px;height:32px;border-radius:50%;
        background:linear-gradient(135deg,#3B82F6,#0369a1);
        display:flex;align-items:center;justify-content:center;
        font-size:12px;font-weight:700;color:white;flex-shrink:0;
        box-shadow:0 2px 8px rgba(59,130,246,0.3);
      ">${(m.user_name||'?').slice(0,2).toUpperCase()}</div>
      <div style="max-width:72%;">
        <div style="font-size:11px;color:#60a5fa;font-weight:600;margin-bottom:4px;letter-spacing:.01em;">${m.user_name}</div>
        <div style="
          background:rgba(255,255,255,0.75);
          backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
          border:0.5px solid rgba(255,255,255,0.9);
          padding:11px 15px;border-radius:20px 20px 20px 5px;
          font-size:14px;line-height:1.45;color:#1e293b;
          box-shadow:0 4px 20px rgba(0,0,0,0.06),inset 0 1px 0 rgba(255,255,255,0.8);
        ">${m.text||''}${_renderChatImg(m.image_url, !!(m.text))}</div>
        ${needs?`<div style="font-size:11px;color:#94a3b8;font-style:italic;margin-top:4px;padding-left:4px;" data-tr>⏳ traduzione...</div>`:''}
        <div style="font-size:10px;color:#94a3b8;margin-top:4px;padding-left:4px;">${formatTimeDallas(m.created_at)}</div>
        <div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap;">
          ${(m.reactions||[]).map(r=>`<span style="font-size:12px;background:rgba(255,255,255,0.8);backdrop-filter:blur(8px);border:0.5px solid rgba(0,0,0,0.08);border-radius:20px;padding:2px 8px;">${r.emoji} ${r.count}</span>`).join('')}
          <button onclick="addReaction('${m.id}')" style="font-size:11px;color:#94a3b8;background:rgba(241,245,249,0.8);border:0.5px solid rgba(148,163,184,0.2);border-radius:20px;padding:2px 8px;cursor:pointer;">+😊</button>
          ${isAdmin()&&!m.pinned?`<button onclick="pinMessage('${m.id}')" style="font-size:11px;color:#d97706;background:rgba(254,243,199,0.8);border:0.5px solid rgba(217,119,6,0.2);border-radius:20px;padding:2px 8px;cursor:pointer;">📌</button>`:''}
        </div>
      </div>`;
  }

  msgs.appendChild(d);
  msgs.scrollTop=99999;

  // Long press su bubble messaggio
  if (!isSystem) {
    var bubble = d.querySelector('div[style*="border-radius"]');
    if (bubble) attachLongPress(bubble, m.id, m.text || '', me);
  }

  // Traduzione
  if(needs){
    const targetLang=normalizeLang(user?.lang);
    fetch(`${SUPABASE_URL}/functions/v1/ai-translate`,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${SUPABASE_ANON_KEY}`},
      body:JSON.stringify({text:m.text,targetLang})
    }).then(r=>r.json()).then(j=>{
      const el=d.querySelector('[data-tr]');
      if(el&&j.translated&&j.translated!==m.text) el.textContent='🌐 '+j.translated;
      else if(el) el.remove();
    });
  }

  // Badge — solo se chat è chiusa e messaggio non mio
  if(!init && !me && !isSystem && !isChatOpen()){
    const badge=document.getElementById('badge');
    if(badge){
      const count=(parseInt(badge.textContent||'0')+1);
      badge.textContent=count;
      badge.style.display='flex';
    }
    // Badge anche sul bottone Chat in Focus Mode
    var focusBadge = document.getElementById('focusChatBadge');
    if(focusBadge){
      var fc=(parseInt(focusBadge.textContent||'0')+1);
      focusBadge.textContent=fc;
      focusBadge.style.display='flex';
    }
  }
}

// ── REACTION PICKER ──────────────────────────────────────────
window.addReaction = function(msgId){
  const picker=document.createElement('div');
  picker.style.cssText='position:fixed;inset:0;z-index:70;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0.2);backdrop-filter:blur(4px);';
  picker.innerHTML=`
    <div style="
      background:rgba(255,255,255,0.92);backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);
      border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;
      box-shadow:0 -8px 40px rgba(0,0,0,0.12);
      border-top:0.5px solid rgba(255,255,255,0.8);
      animation:slideUp .2s ease;
    ">
      <div style="width:36px;height:4px;background:rgba(0,0,0,0.1);border-radius:2px;margin:0 auto 16px;"></div>
      <div style="display:flex;justify-content:space-around;padding:0 8px;">
        ${REACTIONS.map(e=>`
          <button onclick="saveReaction('${msgId}','${e}');this.closest('[style*=fixed]').remove()"
            style="font-size:32px;background:none;border:none;cursor:pointer;padding:8px;border-radius:16px;transition:transform .15s;"
            onmousedown="this.style.transform='scale(0.85)'" onmouseup="this.style.transform='scale(1)'">
            ${e}
          </button>`).join('')}
      </div>
    </div>`;
  picker.onclick=e=>{if(e.target===picker)picker.remove()};
  document.body.appendChild(picker);
};

window.saveReaction = async function(msgId, emoji){
  try{
    await supa.from('message_reactions').upsert(
      {message_id:msgId, user_name:user.name, emoji},
      {onConflict:'message_id,user_name'}
    );
  }catch(e){
    console.log('reactions non disponibili:', e.message);
  }
};

// ── PINNED MESSAGES ──────────────────────────────────────────
window.pinMessage = async function(msgId){
  try{
    await supa.from('messages').update({pinned:true}).eq('id',msgId);
    loadChat();
  }catch(e){}
};

async function loadPinnedMessages(){
  try{
    const{data}=await supa.from('messages').select('*').eq('pinned',true).order('created_at',{ascending:false}).limit(3);
    if(!data||!data.length) return;
    // Rimuovi banner precedente
    document.getElementById('pinnedBanner')?.remove();
    const banner=document.createElement('div');
    banner.id='pinnedBanner';
    banner.style.cssText='background:rgba(254,243,199,0.8);backdrop-filter:blur(10px);border-bottom:0.5px solid rgba(217,119,6,0.15);padding:8px 16px;';
    banner.innerHTML=`<div style="display:flex;align-items:center;gap:8px;font-size:12px;color:#92400e;">
      <span>📌</span>
      <span style="font-weight:600;">Pinnati:</span>
      <span style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${data.map(m=>m.text.slice(0,30)).join(' • ')}</span>
    </div>`;
    const msgsEl=document.getElementById('msgs');
    if(msgsEl&&msgsEl.parentElement) msgsEl.parentElement.insertBefore(banner,msgsEl);
  }catch(e){}
}

// ── REALTIME ─────────────────────────────────────────────────
let chatChannel=null;
function startChatRealtime(){
  if(chatChannel) return;
  chatChannel=supa.channel('public:messages')
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},p=>addMsg(p.new,false))
    .subscribe();
}

// ── INVIA MESSAGGIO ──────────────────────────────────────────
document.getElementById('f').onsubmit=async e=>{
  e.preventDefault();
  const input=document.getElementById('txt');
  const v=input.value.trim();
  const hasImg = !!_chatPendingImageFile;
  if(!v && !hasImg) return;
  input.value='';
  // Upload immagine se presente
  let imageUrl = null;
  if(hasImg){
    try{
      imageUrl = await uploadChatImage(_chatPendingImageFile);
    }catch(err){
      console.error('Upload foto fallito:', err);
    }
    clearChatImg();
  }
  // Detect lingua PRIMA di inserire — await garantisce che lang sia corretto
  let detectedLang = normalizeLang(user.lang);
  if(v){
    try{
      const r = await fetch(`${SUPABASE_URL}/functions/v1/ai-translate`,{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${SUPABASE_ANON_KEY}`},
        body:JSON.stringify({text:v, targetLang:'__detect__'})
      });
      const j = await r.json();
      if(j.detected) detectedLang = normalizeLang(j.detected);
    }catch(e){ console.warn('detect failed, using profile lang:', e.message); }
  }
  const payload = {text:v||'', user_name:user.name, lang:detectedLang};
  if(imageUrl) payload.image_url = imageUrl;
  await supa.from('messages').insert(payload);
};

// Fullscreen viewer immagine chat
window.openChatImg = function(urlOrEl){
  const url = (typeof urlOrEl === 'string') ? urlOrEl : urlOrEl;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:999;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;';
  overlay.onclick = function(){ overlay.remove(); };
  overlay.innerHTML = '<img src="'+url+'" style="max-width:95vw;max-height:90vh;border-radius:12px;object-fit:contain;" />';
  document.body.appendChild(overlay);
};

// ── REPORT ───────────────────────────────────────────────────
async function loadReport(type){
  document.getElementById('reportOut').classList.remove('hidden');
  document.getElementById('presenceLogOut').classList.add('hidden');
  document.getElementById('alertsLogOut').classList.add('hidden');
  document.getElementById('btnPresence')?.classList.remove('bg-slate-900','text-white');
  document.getElementById('btnPresence')?.classList.add('bg-slate-200');
  document.getElementById('btnAlertsLog')?.classList.remove('bg-slate-900','text-white');
  document.getElementById('btnAlertsLog')?.classList.add('bg-slate-200');
  const out=document.getElementById('reportOut');out.innerHTML='...';
  document.getElementById('btnToday').classList.toggle('bg-slate-900',type==='today');
  document.getElementById('btnToday').classList.toggle('text-white',type==='today');
  document.getElementById('btnWeek').classList.toggle('bg-slate-900',type==='week');
  document.getElementById('btnWeek').classList.toggle('text-white',type==='week');
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
      const today=new Date();
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
  if(!lastReport.length) return;
  const{jsPDF}=window.jspdf;
  const doc=new jsPDF();
  doc.text(tr('report'),14,15);
  doc.autoTable({html:'#reportOut table',startY:20});
  doc.save('report.pdf');
}





// ── LONG PRESS + EDIT MESSAGGIO ──────────────────────────────

// Menu contestuale su long press
window.showMsgMenu = function(msgId, msgText, isMine) {
  var existing = document.getElementById('_msgMenu');
  if (existing) existing.remove();

  var menu = document.createElement('div');
  menu.id = '_msgMenu';
  menu.style.cssText = 'position:fixed;inset:0;z-index:9000;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0.3);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);';

  var editBtn = isMine ? `
    <button onclick="openEditMsg('${msgId}',decodeURIComponent('${encodeURIComponent(msgText)}'));document.getElementById('_msgMenu').remove();"
      style="width:100%;padding:16px;background:none;border:none;border-bottom:0.5px solid rgba(0,0,0,0.08);font-size:16px;color:#1e293b;cursor:pointer;text-align:left;display:flex;align-items:center;gap:12px;">
      <span style="font-size:20px;">✏️</span> Modifica
    </button>` : '';

  menu.innerHTML = `
    <div style="background:rgba(255,255,255,0.95);backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);border-radius:24px 24px 0 0;width:100%;max-width:480px;padding-bottom:max(16px,env(safe-area-inset-bottom));box-shadow:0 -8px 40px rgba(0,0,0,0.15);">
      <div style="width:36px;height:4px;background:rgba(0,0,0,0.1);border-radius:2px;margin:12px auto 4px;"></div>
      ${editBtn}
      <button onclick="addReaction('${msgId}');document.getElementById('_msgMenu').remove();"
        style="width:100%;padding:16px;background:none;border:none;font-size:16px;color:#1e293b;cursor:pointer;text-align:left;display:flex;align-items:center;gap:12px;">
        <span style="font-size:20px;">😊</span> Reaction
      </button>
      <button onclick="document.getElementById('_msgMenu').remove();"
        style="width:100%;padding:14px;background:none;border:none;border-top:0.5px solid rgba(0,0,0,0.08);font-size:15px;color:#94a3b8;cursor:pointer;">
        Annulla
      </button>
    </div>`;

  menu.onclick = function(e) { if (e.target === menu) menu.remove(); };
  document.body.appendChild(menu);
};

// Apri editor inline per modificare messaggio
window.openEditMsg = function(msgId, currentText) {
  var existing = document.getElementById('_editMsgSheet');
  if (existing) existing.remove();

  var sheet = document.createElement('div');
  sheet.id = '_editMsgSheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:9100;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0.4);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);';
  sheet.innerHTML = `
    <div style="background:rgba(255,255,255,0.97);border-radius:24px 24px 0 0;width:100%;max-width:480px;padding:16px 16px max(24px,env(safe-area-inset-bottom));box-shadow:0 -8px 40px rgba(0,0,0,0.15);">
      <div style="width:36px;height:4px;background:rgba(0,0,0,0.1);border-radius:2px;margin:0 auto 16px;"></div>
      <div style="font-size:14px;font-weight:600;color:#64748b;margin-bottom:10px;">✏️ Modifica messaggio</div>
      <textarea id="_editMsgTxt"
        style="width:100%;min-height:80px;padding:12px 14px;border-radius:16px;border:1.5px solid #e2e8f0;font-size:15px;line-height:1.5;color:#1e293b;outline:none;resize:none;box-sizing:border-box;font-family:inherit;">${currentText}</textarea>
      <div style="display:flex;gap:10px;margin-top:12px;">
        <button onclick="document.getElementById('_editMsgSheet').remove();"
          style="flex:1;height:48px;border-radius:14px;background:#f1f5f9;border:none;font-size:15px;font-weight:600;color:#64748b;cursor:pointer;">Annulla</button>
        <button onclick="saveEditMsg('${msgId}')"
          style="flex:1;height:48px;border-radius:14px;background:#1e3a5f;border:none;font-size:15px;font-weight:600;color:white;cursor:pointer;">Salva</button>
      </div>
    </div>`;
  sheet.onclick = function(e) { if (e.target === sheet) sheet.remove(); };
  document.body.appendChild(sheet);
  // Focus e cursore alla fine
  setTimeout(function() {
    var ta = document.getElementById('_editMsgTxt');
    if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; }
  }, 100);
};

// Salva modifica nel DB
window.saveEditMsg = async function(msgId) {
  var ta = document.getElementById('_editMsgTxt');
  if (!ta) return;
  var newText = ta.value.trim();
  if (!newText) return;
  var btn = ta.closest('div').querySelector('button:last-child');
  if (btn) { btn.textContent = '...'; btn.disabled = true; }
  try {
    await supa.from('messages').update({ text: newText }).eq('id', msgId).eq('user_name', user.name);
    var sheet = document.getElementById('_editMsgSheet');
    if (sheet) sheet.remove();
    // Ricarica chat per mostrare il messaggio aggiornato
    loadChat();
  } catch(e) {
    if (btn) { btn.textContent = 'Salva'; btn.disabled = false; }
  }
};

// Aggiungi long press a un elemento messaggio
function attachLongPress(el, msgId, msgText, isMine) {
  var pressTimer = null;
  var moved = false;

  el.addEventListener('touchstart', function(e) {
    moved = false;
    pressTimer = setTimeout(function() {
      if (!moved) {
        e.preventDefault();
        showMsgMenu(msgId, msgText, isMine);
      }
    }, 500);
  }, { passive: true });

  el.addEventListener('touchmove', function() {
    moved = true;
    clearTimeout(pressTimer);
  }, { passive: true });

  el.addEventListener('touchend', function() {
    clearTimeout(pressTimer);
  }, { passive: true });

  el.addEventListener('touchcancel', function() {
    clearTimeout(pressTimer);
  }, { passive: true });
}
