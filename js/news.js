// ── NEWS / ALERTS ──
// Read:  tutti gli utenti vedono gli alert attivi, tradotti nella propria lingua
// Write: solo admin puo creare, modificare, chiudere/disattivare
//
// ARCHITETTURA TRADUZIONI (v269):
// Le traduzioni vengono generate UNA VOLTA al momento della creazione dell'alert
// e salvate in alerts.translations = { "it": "...", "en": "...", "es": "..." }
// loadNews() legge direttamente dal DB — zero chiamate ai-translate in lettura.

// Traccia l'ID dell'ultima news vista per il flash staff
let _lastNewsId = null;

// Lingue supportate — si traduce in tutte al momento della creazione
const ALERT_LANGS = ['it', 'en', 'es'];

async function loadNews(){
  const{data}=await supa.from('alerts').select('*').eq('is_active',true).order('created_at',{ascending:false});
  currentNews=data||[];
  const bar=document.getElementById('newsBar');

  // bellDot — solo admin
  const bellDot = document.getElementById('bellDot');
  if(bellDot) bellDot.style.display = (isAdmin() && currentNews.length) ? 'block' : 'none';

  if(!currentNews.length){bar.classList.add('hidden');_lastNewsId=null;return;}

  // Flash news bar per staff quando arriva una news nuova
  const latestId = currentNews[0]&&currentNews[0].id || null;
  const isNewForStaff = !isAdmin() && latestId && latestId !== _lastNewsId && _lastNewsId !== null;
  if(isNewForStaff) _triggerNewsFlash();
  _lastNewsId = latestId;

  bar.classList.remove('hidden');
  const viewerLang = normalizeLang(user&&user.lang);

  // Nessuna chiamata ai-translate qui — leggiamo solo dal DB
  const texts = currentNews.map(function(n){
    const t = new Date(n.created_at).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
    const suf = ' \u2022 ' + (n.created_by||'Crew') + ' ' + t;
    const sourceText = n.message||'';
    if(!sourceText.trim()) return sourceText + suf;
    // Usa traduzione pre-salvata se disponibile, altrimenti testo originale
    const tr_text = n.translations && n.translations[viewerLang] ? n.translations[viewerLang] : sourceText;
    return tr_text + suf;
  });

  document.getElementById('newsScroll').textContent = texts.join(' \u2756 ');
}

// ── Flash news bar per staff ──
function _triggerNewsFlash(){
  const bar = document.getElementById('newsBar');
  if(!bar) return;
  const inner = bar.querySelector('div');
  if(!inner) return;
  const origBorder = inner.style.border;
  const origBg = inner.style.background;
  inner.style.transition = 'border 0.2s, background 0.2s';
  inner.style.border = '1.5px solid rgba(59,130,246,0.7)';
  inner.style.background = 'rgba(59,130,246,0.14)';
  setTimeout(function(){
    inner.style.border = origBorder;
    inner.style.background = origBg;
  }, 2000);
}

// ── Genera traduzioni per un testo in tutte le lingue (chiamata al momento della creazione) ──
async function _generateAlertTranslations(text, sourceLang){
  var translations = {};
  // Copia il testo originale nella lingua sorgente — nessuna chiamata necessaria
  if(sourceLang) translations[sourceLang] = text;

  var otherLangs = ALERT_LANGS.filter(function(l){ return l !== sourceLang; });
  await Promise.all(otherLangs.map(async function(lang){
    try{
      var r = await fetch(SUPABASE_URL + '/functions/v1/ai-translate',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer ' + SUPABASE_ANON_KEY},
        body:JSON.stringify({text:text, targetLang:lang})
      });
      var j = await r.json();
      if(j.translated) translations[lang] = j.translated;
    }catch(e){}
  }));
  return translations;
}

// Realtime — tutti ascoltano, solo il canale e condiviso
let newsChannel=null;
function startNewsRealtime(){
  if(newsChannel) supa.removeChannel(newsChannel);
  newsChannel=supa.channel('news-rt-'+Date.now())
    .on('postgres_changes',{event:'*',schema:'public',table:'alerts'},function(){
      setTimeout(loadNews,300);
    })
    .subscribe(function(status){
      if(status==='CLOSED'||status==='CHANNEL_ERROR'){
        setTimeout(startNewsRealtime,5000);
      }
    });
}

function initNews(){
  startNewsRealtime();
  setInterval(loadNews,60000);
}

// ── ADMIN ONLY — UI controls ──
function updateAlertBtn(){
  if(document.getElementById('alertBtn')) document.getElementById('alertBtn').style.display='none';
  const bell = document.getElementById('bellBtn');
  if(bell) bell.style.display = isAdmin() ? 'flex' : 'none';
  document.getElementById('newsManage').classList.toggle('hidden',!isAdmin());
  const pb=document.getElementById('btnPresence'); if(pb) pb.classList.toggle('hidden',!isAdmin());
  const ab=document.getElementById('btnAlertsLog'); if(ab) ab.classList.toggle('hidden',!isAdmin());
  const ub=document.getElementById('userMgrBtn'); if(ub) ub.classList.toggle('hidden',!isAdmin());
  const pwdB=document.getElementById('pwdBtn'); if(pwdB) pwdB.classList.toggle('hidden',!isAdmin());
}

document.getElementById('alertBtn').onclick=function(){
  if(!isAdmin()) return;
  showNewsModal();
};

document.getElementById('newsManage').onclick=function(){
  if(!isAdmin()) return;
  showNewsManageModal();
};

function showNewsModal(){
  if(!isAdmin()) return;
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-[70] flex items-center justify-center';
  modal.style.background='rgba(0,0,0,0.4)';
  modal.innerHTML='<div style="background:white;border-radius:20px;padding:20px;width:88%;max-width:360px;box-shadow:0 20px 60px rgba(0,0,0,0.2);">' +
    '<div style="font-size:15px;font-weight:600;color:#1e293b;margin-bottom:12px;">' + String.fromCodePoint(0x1F4E2) + ' ' + (tr('quickComment')||'New alert') + '</div>' +
    '<textarea id="newsInputText" rows="3" placeholder="' + tr('writePlaceholder') + '" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:12px;font-size:14px;resize:none;box-sizing:border-box;outline:none;font-family:inherit;"></textarea>' +
    '<div style="display:grid;grid-template-columns:1fr 2fr;gap:8px;margin-top:12px;">' +
    '<button onclick="this.closest(\'.fixed\').remove()" style="height:42px;border-radius:12px;background:#f1f5f9;color:#64748b;font-size:13px;border:none;cursor:pointer;">' + tr('cancel') + '</button>' +
    '<button onclick="sendNews(this)" style="height:42px;border-radius:12px;background:#1e293b;color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;">' + tr('send') + '</button>' +
    '</div></div>';
  modal.onclick=function(e){if(e.target===modal)modal.remove();};
  document.body.appendChild(modal);
  setTimeout(function(){var el=document.getElementById('newsInputText');if(el)el.focus();},100);
}

window.sendNews=async function(btn){
  if(!isAdmin()) return;
  const text=(document.getElementById('newsInputText')&&document.getElementById('newsInputText').value||'').trim();
  if(!text) return;
  btn.textContent='...';
  btn.disabled=true;

  // 1. Detect lingua sorgente
  var source_lang = null;
  try{
    var dr = await fetch(SUPABASE_URL + '/functions/v1/ai-translate',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer ' + SUPABASE_ANON_KEY},
      body:JSON.stringify({text:text, targetLang:'__detect__'})
    });
    var dd = await dr.json();
    source_lang = normalizeLang(dd.detected||'')||null;
  }catch(e){}

  // 2. Genera traduzioni in tutte le lingue — UNA VOLTA SOLA qui
  var translations = await _generateAlertTranslations(text, source_lang);

  // 3. Salva alert con traduzioni gia pronte
  await supa.from('alerts').insert({
    message: text,
    created_by: user&&user.name||'Admin',
    is_active: true,
    source_lang: source_lang||undefined,
    translations: translations
  });

  btn.closest('.fixed').remove();
  loadNews();
};

function showNewsManageModal(){
  if(!isAdmin()) return;
  if(!currentNews||!currentNews.length){
    const t=document.createElement('div');
    t.className='fixed top-16 left-1/2 -translate-x-1/2 z-[70] bg-slate-800 text-white text-sm px-4 py-2 rounded-xl';
    t.textContent=tr('noActivenews');
    document.body.appendChild(t);
    setTimeout(function(){t.remove();},2000);
    return;
  }
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-[70] flex items-end';
  modal.style.background='rgba(0,0,0,0.3)';
  modal.innerHTML='<div style="background:white;border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;max-height:70vh;overflow-y:auto;">' +
    '<div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 14px;"></div>' +
    '<div style="font-size:15px;font-weight:600;color:#1e293b;margin-bottom:12px;">' + String.fromCodePoint(0x1F4CB) + ' ' + (tr('homeChecklist')||'Active alerts') + '</div>' +
    currentNews.map(function(n){
      return '<div style="display:flex;justify-content:space-between;align-items:start;padding:10px 0;border-bottom:1px solid #f1f5f9;">' +
        '<div style="flex:1;font-size:13px;color:#1e293b;margin-right:10px;">' + n.message +
        '<div style="font-size:11px;color:#94a3b8;margin-top:2px;">' + (n.created_by||'Admin') + '</div></div>' +
        '<button onclick="closeNews(\'' + n.id + '\',this)" style="flex-shrink:0;padding:5px 10px;border-radius:8px;background:#fee2e2;color:#dc2626;font-size:12px;border:none;cursor:pointer;">' + tr('close') + '</button>' +
        '</div>';
    }).join('') +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px;">' +
    '<button onclick="this.closest(\'.fixed\').remove()" style="height:42px;border-radius:12px;background:#f1f5f9;color:#64748b;font-size:13px;border:none;cursor:pointer;">' + tr('cancel') + '</button>' +
    '<button onclick="closeAllNews(this)" style="height:42px;border-radius:12px;background:#dc2626;color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;">' + tr('closeAll') + '</button>' +
    '</div></div>';
  modal.onclick=function(e){if(e.target===modal)modal.remove();};
  document.body.appendChild(modal);
}

window.closeNews=async function(id,btn){
  if(!isAdmin()) return;
  btn.textContent='...';
  await supa.from('alerts').update({is_active:false}).eq('id',id);
  btn.closest('.fixed').remove();
  setTimeout(loadNews,300);
};

window.closeAllNews=async function(btn){
  if(!isAdmin()) return;
  btn.textContent='...';
  await supa.from('alerts').update({is_active:false}).eq('is_active',true);
  btn.closest('.fixed').remove();
  setTimeout(loadNews,300);
};
