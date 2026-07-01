// ── CONFETTI ──
function showConfetti(){
  const colors=['#059669','#10b981','#34d399','#6ee7b7'];
  for(let i=0;i<18;i++){
    const el=document.createElement('div');
    el.style.cssText=`position:fixed;top:-10px;left:${Math.random()*100}%;width:8px;height:8px;background:${colors[i%colors.length]};border-radius:${Math.random()>0.5?'50%':'2px'};z-index:9999;animation:confettiFall ${1+Math.random()*2}s ease-in ${Math.random()*0.5}s forwards`;
    document.body.appendChild(el);
    setTimeout(()=>el.remove(),3000);
  }
}

// ── WAKE LOCK ──
let _wakeLock = null;
async function requestWakeLock(){
  if(!('wakeLock' in navigator)) return;
  try{ _wakeLock = await navigator.wakeLock.request('screen'); }catch(e){}
}
function releaseWakeLock(){
  if(_wakeLock){ _wakeLock.release().catch(()=>{}); _wakeLock=null; }
}
// Se il wake lock viene rilasciato dal sistema (es. tab in background), lo annulliamo
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible' && _activeTimerCount>0) requestWakeLock();
});

// Contatore timer attivi — gestisce wake lock automaticamente
let _activeTimerCount = 0;
window._prepTimerStarted = function(){
  _activeTimerCount++;
  requestWakeLock();
};
window._prepTimerStopped = function(){
  _activeTimerCount = Math.max(0, _activeTimerCount-1);
  if(_activeTimerCount===0) releaseWakeLock();
};

// ── STEP TRACKING (memoria locale per sessione) ──
// _taskStep[prepTaskId] = indice step corrente
// _taskStepTotal[prepTaskId] = numero totale step della ricetta
window._taskStep = {};
window._taskStepTotal = {};
var _startTimes = {}; // traccia quando il cuoco ha premuto START per ogni task

// Chiamato da recipe-modal.js quando l'utente naviga tra gli step
window.prepOnStepChange = function(prepTaskId, currentStep, totalSteps){
  if(!prepTaskId) return;
  _taskStep[prepTaskId] = currentStep;
  _taskStepTotal[prepTaskId] = totalSteps;
  renderM();
  if(typeof renderFocusFeed==='function') renderFocusFeed();
};

// Chiamato da recipe-modal.js quando il modal viene chiuso
window.prepOnModalClose = function(prepTaskId){
  // non resettiamo lo step — vogliamo ricordarlo per SEE STEPS
};

// ── CHECK URGENTI SCADUTE (14:30) ──
function startUrgencyCheck(){
  setInterval(()=>{
    const dn=getNowDallas();
    if(dn.getHours()===14&&dn.getMinutes()===30){
      const urgent=items.filter(i=>i.need_tomorrow);
      if(urgent.length>0&&isAdmin()){
        fetch(`${SUPABASE_URL}/functions/v1/send-push`,{
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':`Bearer ${SUPABASE_ANON_KEY}`},
          body:JSON.stringify({
            title:tr('urgentPrepTitle'),
            body:`${tr('urgentPrepBody').replace('{n}',urgent.length)}: ${urgent.slice(0,3).map(i=>i.name).join(', ')}`,
            target_user: user?.name
          })
        }).catch(()=>{});
      }
    }
  }, 60000);
}

// ── STAZIONE CHIUSURA ──
async function ensureChiusuraStation(){
  const exists = items.some(i=>i.category==='Chiusura');
  if(!exists && isAdmin()){}
}

// ── AVVISO INTELLIGENTE ──
async function loadItemAlerts(){
  try{
    const{data}=await supa.from('v_item_alerts').select('*');
    itemAlerts={};
    (data||[]).forEach(r=>itemAlerts[r.name]=r);
  }catch(e){}
}

// Set di prep_task_id che hanno almeno uno step
window.prepTasksWithSteps = new Set();
async function loadStepsMap(){
  try{
    const{data}=await supa.from('prep_steps').select('prep_task_id');
    window.prepTasksWithSteps = new Set((data||[]).map(r=>String(r.prep_task_id)));
  }catch(e){}
}

function getAlertLevel(itemName){
  const a=itemAlerts[itemName];
  if(!a) return null;
  const today=new Date().toISOString().slice(0,10);
  const madeToday = a.last_made_at && a.last_made_at.slice(0,10)===today;
  if(!madeToday) return null;
  const qty = a.last_made_qty||0;
  const avgQty = a.average_qty||qty;
  const duration = a.expected_duration_days||1;
  if(qty >= avgQty*0.8 && duration > 1) return {level:'high', a};
  if(qty >= avgQty*0.5) return {level:'medium', a};
  return {level:'low', a};
}

async function checkBeforeMissing(id, itemName){
  const alert = getAlertLevel(itemName);
  if(!alert) return true;
  const a = alert.a;
  const _locale = {it:'it-IT',en:'en-US',es:'es-MX'}[window.user?.lang||'en']||'en-US';
  const madeAt = new Date(a.last_made_at).toLocaleTimeString(_locale,{hour:'2-digit',minute:'2-digit'});
  const _byWord = {it:'da',en:'by',es:'por'}[window.user?.lang||'en']||'by';
  const madeQty = a.last_made_qty ? `${a.last_made_qty} ${a.last_made_by?_byWord+' '+a.last_made_by:''}` : '';
  const colors = {high:'🟢', medium:'🟡', low:'🔴'};
  const confidenceText = {high:tr('confidenceHigh'), medium:tr('confidenceMedium'), low:tr('confidenceLow')};
  return new Promise(resolve=>{
    const popup=document.createElement('div');
    popup.className='fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4';
    popup.innerHTML=`
      <div class="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl" style="animation:slideUp .2s ease">
        <div class="text-center mb-4">
          <div class="text-4xl mb-2">🤔</div>
          <h3 class="font-bold text-lg">${tr('sureItsMissing')}</h3>
        </div>
        <div class="bg-slate-50 rounded-2xl p-3 mb-4 space-y-2">
          <div class="flex items-center gap-2 text-sm">
            <span>🧑‍🍳</span>
            <span><b>${a.last_made_by||tr('somebodyMade')}</b> ${tr('madeThisMorning')} <b>${madeAt}</b></span>
          </div>
          ${madeQty?`<div class="flex items-center gap-2 text-sm"><span>⚖️</span><span>${tr('qty')}: <b>${madeQty}</b></span></div>`:''}
          ${a.missing_count_week>1?`<div class="flex items-center gap-2 text-sm text-amber-700"><span>⚠️</span><span>${tr('reportedMissingWeek').replace('{n}', a.missing_count_week)}</span></div>`:''}
          <div class="flex items-center gap-2 text-xs text-slate-500 pt-1 border-t">
            <span>${colors[alert.level]}</span>
            <span>${confidenceText[alert.level]}</span>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <button id="alertCancel" class="py-3 rounded-xl bg-slate-100 font-semibold text-sm">${tr('checkAgain')}</button>
          <button id="alertConfirm" class="py-3 rounded-xl bg-red-500 text-white font-semibold text-sm">${tr('yesMissing')}</button>
        </div>
      </div>`;
    document.body.appendChild(popup);
    popup.querySelector('#alertCancel').onclick=()=>{
      popup.remove();
      supa.from('alerts_log').insert({item:itemName,user_name:user?.name,was_really_missing:false,qty_made_that_day:a.last_made_qty,made_by:a.last_made_by,made_at:a.last_made_at});
      resolve(false);
    };
    popup.querySelector('#alertConfirm').onclick=()=>{
      popup.remove();
      supa.from('alerts_log').insert({item:itemName,user_name:user?.name,was_really_missing:true,qty_made_that_day:a.last_made_qty,made_by:a.last_made_by,made_at:a.last_made_at});
      resolve(true);
    };
  });
}

// ── PILL STOCK — testo human-readable ──
function buildStockPill(i){
  if(i.current_stock===null||i.current_stock===undefined) return '';
  const stock = parseFloat(i.current_stock);
  const sq = parseFloat(i.suggested_qty||0);
  const unit = i.unit||'';
  const stockLabel = stock + (unit?' '+unit:'');
  const lang = window.user?.lang||'en';
  const inHouse = {it:'hai '+stockLabel+' in casa', en:'you have '+stockLabel+' in stock', es:'tienes '+stockLabel+' en casa'}[lang]||'you have '+stockLabel+' in stock';
  if(stock===0){
    return '<div style="margin-top:4px;"><span style="font-size:11px;font-weight:700;color:#a32d2d;background:#fcebeb;border:0.5px solid #f7c1c1;border-radius:6px;padding:2px 7px;">🤖 '+({it:'Prepara oggi · hai 0 in casa',en:'Prep today · nothing in stock',es:'Prepara hoy · nada en casa'}[lang]||'Prep today · nothing in stock')+'</span></div>';
  } else if(sq>0 && stock<=sq*0.5){
    return '<div style="margin-top:4px;"><span style="font-size:11px;font-weight:700;color:#854f0b;background:#faeeda;border:0.5px solid #fac775;border-radius:6px;padding:2px 7px;">🤖 '+({it:'Quasi finito · ',en:'Running low · ',es:'Casi agotado · '}[lang]||'Running low · ')+inHouse+'</span></div>';
  } else {
    return '<div style="margin-top:4px;"><span style="font-size:11px;font-weight:600;color:#3b6d11;background:#eaf3de;border:0.5px solid #c0dd97;border-radius:6px;padding:2px 7px;">🤖 '+({it:'Stock ok · ',en:'Stock ok · ',es:'Stock ok · '}[lang]||'Stock ok · ')+inHouse+'</span></div>';
  }
}

// ── COLORE BORDO card ──
function cardBorderColor(i){
  if(i.in_progress) return '#378add'; // blu
  if(i.need_tomorrow){
    // rosso se stock=0 o non noto, giallo se quasi finito
    const stock = parseFloat(i.current_stock);
    const sq = parseFloat(i.suggested_qty||0);
    if(!isNaN(stock) && stock>0 && sq>0 && stock<=sq*0.5) return '#ef9f27'; // giallo
    return '#e24b4a'; // rosso
  }
  return '#94a3b8'; // grigio
}

// ── BOTTONE card ──
function cardButton(i){
  const iid = i.id;
  const lang = window.user?.lang||'en';
  if(i.in_progress){
    const currentStep = _taskStep[iid]||0;
    const totalSteps = _taskStepTotal[iid]||0;
    const hasStepsInDB = window.prepTasksWithSteps?.has(String(iid));
    const isLastStep = totalSteps>0 && currentStep>=totalSteps-1;
    // Nessuno step configurato → DONE diretto
    if(!hasStepsInDB || totalSteps===0 && !hasStepsInDB){
      return `<button onclick="prepDone(${JSON.stringify(iid)})" style="height:40px;padding:0 18px;border-radius:10px;font-size:13px;font-weight:600;background:#059669;color:white;border:none;white-space:nowrap;flex-shrink:0;">DONE</button>`;
    }
    if(isLastStep){
      return `<button onclick="prepDone(${JSON.stringify(iid)})" style="height:40px;padding:0 18px;border-radius:10px;font-size:13px;font-weight:600;background:#059669;color:white;border:none;white-space:nowrap;flex-shrink:0;">DONE</button>`;
    }
    const seeLabel = {it:'VEDI STEPS',en:'SEE STEPS',es:'VER PASOS'}[lang]||'SEE STEPS';
    return `<button onclick="prepSeeSteps(${JSON.stringify(iid)})" style="height:40px;padding:0 18px;border-radius:10px;font-size:13px;font-weight:600;background:#378add;color:white;border:none;white-space:nowrap;flex-shrink:0;">${seeLabel}</button>`;
  }
  if(i.need_tomorrow){
    return `<button onclick="prepStart(${JSON.stringify(iid)})" style="height:40px;padding:0 20px;border-radius:10px;font-size:13px;font-weight:600;background:#1e3a5f;color:white;border:none;white-space:nowrap;flex-shrink:0;">START</button>`;
  }
  return ''; // grigio — nessun bottone
}

// ── PREP ──
function renderM(){
  const base=items.filter(i=>station==='All'||i.category?.includes(station));
  // ordinamento: in_progress > urgenti > gialli > normali
  const list=base.sort((a,b)=>{
    const score=i=>(i.in_progress?3:0)+(i.need_tomorrow?2:0);
    if(score(b)!==score(a)) return score(b)-score(a);
    return a.name.localeCompare(b.name);
  });
  const pc=base.filter(i=>i.need_tomorrow&&!i.in_progress).length;
  const total=base.length;

  // barra progresso urgenti
  const prog=document.getElementById('urgentProgress');
  const bar=document.getElementById('urgentBar');
  const cnt=document.getElementById('urgentCount');
  const done=document.getElementById('urgentDone');
  const timeEl=document.getElementById('urgentTime');
  if(prog){
    if(total>0){
      prog.classList.remove('hidden');
      const completed=total-pc;
      const pct=Math.round((completed/total)*100);
      if(bar) bar.style.width=pct+'%';
      if(cnt) cnt.textContent=pc;
      const dn=getNowDallas();
      const deadline=getNowDallas(); deadline.setHours(14,30,0,0);
      const diffMs=deadline-dn;
      if(timeEl){
        if(diffMs>0){
          const h=Math.floor(diffMs/3600000);
          const m=Math.floor((diffMs%3600000)/60000);
          timeEl.textContent=h>0?`${h}h ${m}m `+tr('timeLimit'):`${m}m `+tr('timeLimit');
          timeEl.className=diffMs<3600000?'text-xs text-red-500 font-semibold':'text-xs text-slate-400';
        } else {
          timeEl.textContent=tr('timeExpired');
          timeEl.className='text-xs text-red-600 font-bold';
        }
      }
      if(done) done.classList.toggle('hidden',pc>0);
      if(pc===0&&total>0) showConfetti();
    } else {
      prog.classList.add('hidden');
    }
  }

  // station note
  const stationKey = station==='All'?null:station;
  const stNote = stationKey && stationNotes[stationKey] ? stationNotes[stationKey] : null;

  grid.innerHTML=(stNote?`<div class="col-span-2 mb-2 px-3 py-2 rounded-xl text-[11px]" style="background:rgba(251,191,36,0.15);border-left:4px solid #f59e0b;color:#92400e;">${stNote}</div>`:'')+
    list.map(i=>{
      const iid = i.id;
      const borderColor = cardBorderColor(i);
      const isWip = i.in_progress;
      const isUrgent = i.need_tomorrow && !i.in_progress;
      const nameColor = isWip?'#1e40af':isUrgent?'#991b1b':'#0f172a';

      const badge = isWip
        ? '<span style="font-size:10px;font-weight:600;color:#185fa5;background:rgba(55,138,221,0.12);padding:2px 6px;border-radius:6px;">'+tr('inProgress')+'</span>'
        : isUrgent
          ? '<span style="font-size:10px;font-weight:700;color:#a32d2d;background:rgba(226,75,74,0.1);padding:2px 6px;border-radius:6px;letter-spacing:.04em;">'+tr('urgent')+'</span>'
          : '';

      // pill bot suggested_note (formato color|testo_it|testo_en|testo_es)
      let botPill = '';
      if(i.suggested_note && i.suggested_note.includes('|')){
        const parts = i.suggested_note.split('|');
        const col = parts[0];
        // Scegli testo in base alla lingua utente: 1=IT, 2=EN, 3=ES
        const lang = (window._currentUser?.lang || 'en').toLowerCase();
        const langIdx = lang === 'it' ? 1 : lang === 'es' ? 3 : 2;
        const rawTxt = parts[langIdx] || parts[1] || '';
        const txt = rawTxt.length>60 ? rawTxt.slice(0,57)+'…' : rawTxt;
        const s = {green:{bg:'rgba(5,150,105,0.1)',border:'#bbf7d0',color:'#059669'},yellow:{bg:'rgba(217,119,6,0.1)',border:'#fde68a',color:'#d97706'},red:{bg:'rgba(220,38,38,0.1)',border:'#fca5a5',color:'#dc2626'}}[col]||{bg:'rgba(217,119,6,0.1)',border:'#fde68a',color:'#d97706'};
        botPill = '<div style="margin-top:5px;"><span style="font-size:11px;font-weight:700;color:'+s.color+';background:'+s.bg+';border:1px solid '+s.border+';border-radius:6px;padding:2px 7px;">🤖 '+txt+'</span></div>';
      } else if(i.suggested_note){
        botPill = '<div style="margin-top:5px;"><span style="font-size:11px;font-weight:700;color:#059669;background:rgba(5,150,105,0.1);border:1px solid #bbf7d0;border-radius:6px;padding:2px 7px;">🤖 '+i.suggested_note+'</span></div>';
      }

      const stockPill = buildStockPill(i);
      const btn = cardButton(i);
      const recipeTag = i.recipe_id ? '<span style="font-size:11px;color:#059669;font-weight:500;">'+tr('recipe')+'</span>'
        : window.prepTasksWithSteps?.has(String(iid)) ? '<span style="font-size:11px;color:#7c3aed;font-weight:500;">▶ steps</span>'
        : i.note ? '<span style="font-size:11px;color:#d97706;">'+tr('note')+'</span>'
        : isAdmin() ? '<span style="font-size:11px;color:#94a3b8;">'+tr('noRecipeLink')+'</span>' : '';

      return '<div class="col-span-2 mb-2 active:scale-[0.98] transition-transform" style="background:rgba(255,255,255,0.60);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-radius:16px;border-left:4px solid '+borderColor+';box-shadow:0 2px 8px rgba(30,58,95,0.06),0 8px 24px rgba(30,58,95,0.04),inset 0 1px 0 rgba(255,255,255,0.9);">'
        +'<div style="padding:12px 12px 12px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px;">'
          +'<div style="flex:1;min-width:0;cursor:pointer;" onclick="prepStart('+JSON.stringify(iid)+')">'
            +'<div style="font-size:17px;font-weight:600;color:'+nameColor+';line-height:1.3;">'+i.name+'</div>'
            +(badge?'<div style="margin-top:4px;">'+badge+'</div>':'')
            +'<div style="margin-top:3px;">'+recipeTag+'</div>'
            +botPill
            +stockPill
          +'</div>'
          +'<div style="display:flex;gap:6px;flex-shrink:0;align-items:center;">'
            +btn
            +(isAdmin()?'<span style="display:flex;gap:4px;align-items:center;"><button onclick="adminRename('+JSON.stringify(iid)+')" style="font-size:14px;color:#94a3b8;background:none;border:none;padding:4px;">✏</button><button onclick="adminDel('+JSON.stringify(iid)+')" style="font-size:14px;color:#94a3b8;background:none;border:none;padding:4px;">🗑</button></span>':'')
          +'</div>'
        +'</div>'
      +'</div>';
    }).join('');
}

// ── AZIONI CARD ──

// START — primo avvio: apre ricetta, segna in_progress
window.prepStart = async function(id){
  const it = tasks[id];
  if(!it) return;
  // Se già in progress → SEE STEPS
  if(it.in_progress){ prepSeeSteps(id); return; }
  // Segna in_progress nel DB (optimistic) + traccia orario start
  tasks[id].in_progress = true;
  _startTimes[id] = new Date();
  supa.from('prep_tasks').update({in_progress:true}).eq('id',id).then(()=>{}).catch(()=>{});
  renderM();
  // Apre il recipe modal con tracking dello step (funziona anche senza recipe_id)
  if(typeof recipeModal!=='undefined'){
    recipeModal.open(it.recipe_id||null, id);
  }
};

// SEE STEPS — riapre la ricetta allo step dove eri
window.prepSeeSteps = function(id){
  const it = tasks[id];
  if(!it) return;
  recipeModal.open(it.recipe_id||null, id);
};

// DONE — apre modal quantità
window.prepDone = function(id){
  openDoneSheet(id);
};

// ── DONE SHEET ──
function openDoneSheet(id){
  const it=tasks[id];
  if(it.suggested_qty && parseFloat(it.suggested_qty)>0){
    const sqRaw = parseFloat(it.suggested_qty);
    const sqUnit = it.unit||tr('prep_portions');
    const sqLabel = sqRaw+' '+sqUnit;
    const modal=document.createElement('div');
    modal.className='fixed inset-0 z-50 flex items-end';
    modal.style.background='rgba(0,0,0,0.35)';
    modal.innerHTML=`<div style="background:rgba(255,255,255,0.96);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-radius:24px 24px 0 0;border-top:0.5px solid rgba(5,150,105,0.3);padding:20px 16px 28px;width:100%;max-width:480px;margin:0 auto;animation:slideUp .25s ease">
      <div style="width:36px;height:4px;background:rgba(5,150,105,0.2);border-radius:2px;margin:0 auto 16px;"></div>
      <div style="font-size:15px;font-weight:600;color:#1e3a5f;margin-bottom:4px;">${it.name}</div>
      <div style="font-size:12px;color:#6b7280;margin-bottom:18px;">${tr('prep_how_much')}</div>
      <button onclick="suggestedSave('${it.id}',this.closest('.fixed'))" style="width:100%;height:52px;border-radius:16px;background:#059669;color:white;font-size:14px;font-weight:600;border:none;margin-bottom:10px;">
        ✅ ${sqLabel} — ${tr('prep_suggested_label')}
      </button>
      <button onclick="this.closest('.fixed').remove();openDoneSheetCustom('${it.id}')" style="width:100%;height:44px;border-radius:14px;background:rgba(59,130,246,0.08);color:#1d4ed8;font-size:13px;border:0.5px solid rgba(59,130,246,0.2);">
        ${tr('prep_custom_qty')}
      </button>
    </div>`;
    modal.onclick=e=>{if(e.target===modal)modal.remove();};
    document.body.appendChild(modal);
  } else {
    openDoneSheetCustom(id);
  }
}

function openDoneSheetCustom(id){
  const it=tasks[id];
  const taskUnit=(it.unit||'').toLowerCase();
  const defaultPezzi = ['pezzi','pz','each','pieces','pcs'].includes(taskUnit);
  const defQty = it.suggested_qty!=null ? parseFloat(it.suggested_qty) : (it.average_qty!=null ? parseFloat(it.average_qty) : 0);
  const defUnit = defaultPezzi ? 'pz' : 'g';
  const sheet=document.createElement('div');
  sheet.className='fixed inset-0 z-50 flex items-end';
  sheet.style.background='rgba(0,0,0,0.5)';
  sheet.innerHTML=`<div style="background:#fff;border-radius:24px 24px 0 0;padding:24px 20px 36px;width:100%;max-width:480px;margin:0 auto;animation:slideUp .25s ease">
    <div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 20px;"></div>
    <div style="font-size:16px;font-weight:700;color:#1e3a5f;margin-bottom:6px;">${it.name}</div>
    <div style="font-size:13px;color:#6b7280;margin-bottom:20px;">${tr('prep_how_much')}</div>
    <input id="dsc-qty-${it.id}" type="number" inputmode="decimal" value="${isNaN(defQty)?0:defQty}" placeholder="0"
      style="width:100%;font-size:32px;font-weight:700;color:#1e3a5f;text-align:center;border:none;border-bottom:2px solid #1e3a5f;outline:none;padding:8px 0;margin-bottom:24px;background:transparent;">
    <input type="hidden" id="dsc-unit-${it.id}" value="${defUnit}">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
      <button id="dsc-btn-g-${it.id}" onclick="dscSelect('${it.id}','g')"
        style="height:52px;border-radius:14px;font-size:15px;font-weight:600;border:2px solid ${defaultPezzi?'#e2e8f0':'#059669'};background:${defaultPezzi?'#f8fafc':'#059669'};color:${defaultPezzi?'#94a3b8':'#fff'};">
        ${tr('prep_grams')}
      </button>
      <button id="dsc-btn-pz-${it.id}" onclick="dscSelect('${it.id}','pz')"
        style="height:52px;border-radius:14px;font-size:15px;font-weight:600;border:2px solid ${defaultPezzi?'#059669':'#e2e8f0'};background:${defaultPezzi?'#059669':'#f8fafc'};color:${defaultPezzi?'#fff':'#94a3b8'};">
        ${tr('prep_pieces')}
      </button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 2fr;gap:10px;">
      <button onclick="this.closest('.fixed').remove()" style="height:46px;border-radius:14px;background:#f1f5f9;color:#64748b;font-size:14px;border:none;">${tr('prep_cancel')}</button>
      <button onclick="detailSave('${it.id}',this,false)" style="height:46px;border-radius:14px;background:#1e3a5f;color:white;font-size:14px;font-weight:600;border:none;">${tr('prep_done')}</button>
    </div>
  </div>`;
  sheet.onclick=e=>{if(e.target===sheet)sheet.remove();};
  document.body.appendChild(sheet);
  setTimeout(()=>{const inp=document.getElementById('dsc-qty-'+it.id); if(inp){inp.focus();inp.select();}},150);
}

window.dscSelect = function(id, unit){
  const unitInput = document.getElementById('dsc-unit-'+id);
  if(unitInput) unitInput.value = unit;
  const btnG = document.getElementById('dsc-btn-g-'+id);
  const btnPz = document.getElementById('dsc-btn-pz-'+id);
  if(!btnG||!btnPz) return;
  if(unit==='g'){
    btnG.style.background='#059669'; btnG.style.color='#fff'; btnG.style.borderColor='#059669';
    btnPz.style.background='#f8fafc'; btnPz.style.color='#94a3b8'; btnPz.style.borderColor='#e2e8f0';
  } else {
    btnPz.style.background='#059669'; btnPz.style.color='#fff'; btnPz.style.borderColor='#059669';
    btnG.style.background='#f8fafc'; btnG.style.color='#94a3b8'; btnG.style.borderColor='#e2e8f0';
  }
};

async function suggestedSave(id, modal){
  const it=tasks[id];
  const qty=parseFloat(it.suggested_qty)||1;
  const unit=it.unit||tr('prep_portions');
  modal.remove();
  _finishTask(id, qty);
  var _sNow = new Date();
  var _sSt = _startTimes[id] || _sNow;
  var _sDur = Math.round((_sNow - _sSt) / 60000);
  delete _startTimes[id];
  Promise.all([
    supa.from('prep_log').insert({item:it.name,station:it.category||tr('generale'),qty,unit,container:'',user_name:user.name,is_suggested_qty:true,started_at:_sSt.toISOString(),duration_minutes:_sDur}),
    supa.from('prep_tasks').update({need_tomorrow:false,in_progress:false,current_stock:(parseFloat(it.current_stock)||0)+qty}).eq('id',id)
  ]).then(()=>{loadItemAlerts();loadStepsMap();})
  .catch(e=>console.error('suggestedSave error:',e));
}

async function detailSave(id, btn, isSuggested){
  const sheet=btn.closest('.fixed');
  const qtyInput=document.getElementById('dsc-qty-'+id)||sheet.querySelector('.ds-qty');
  const unitInput=document.getElementById('dsc-unit-'+id);
  const qty=parseFloat(qtyInput?qtyInput.value:NaN);
  if(isNaN(qty)){qtyInput&&qtyInput.focus();return;}
  const unit=unitInput?unitInput.value:(sheet.querySelector('.ds-unit')?sheet.querySelector('.ds-unit').value:'g');
  const cont='';
  btn.textContent='...'; btn.disabled=true;
  const it=tasks[id];
  var _dNow = new Date();
  var _dSt = _startTimes[id] || _dNow;
  var _dDur = Math.round((_dNow - _dSt) / 60000);
  delete _startTimes[id];
  await supa.from('prep_log').insert({item:it.name,station:it.category||tr('generale'),qty,unit,container:cont,user_name:user.name,is_suggested_qty:!!isSuggested,started_at:_dSt.toISOString(),duration_minutes:_dDur});
  await supa.from('prep_tasks').update({need_tomorrow:false,in_progress:false,current_stock:(parseFloat(it.current_stock)||0)+qty}).eq('id',id);
  sheet.remove();
  _finishTask(id, qty);
  await loadItemAlerts();
  await loadStepsMap();
  setTimeout(()=>{renderM();renderS();renderHomeStations();if(!document.getElementById('vr').classList.contains('hidden'))loadReport('today');},300);
}

// Shared cleanup dopo DONE
function _finishTask(id, qty){
  tasks[id].need_tomorrow=false;
  tasks[id].in_progress=false;
  tasks[id].current_stock=(parseFloat(tasks[id].current_stock)||0)+qty;
  delete _taskStep[id];
  delete _taskStepTotal[id];
  releaseWakeLock();
  showConfetti();
  renderM();renderS();renderHomeStations();
}

// ── NO NEED ──
window.noNeed = async function(id) {
  const it = tasks[id];
  if (!it) return;
  const msg = it.name + ' — No Need: '+tr('noNeedConfirm');
  if (!confirm(msg)) return;
  var _nNow = new Date();
  var _nSt = _startTimes[id] || _nNow;
  var _nDur = Math.round((_nNow - _nSt) / 60000);
  delete _startTimes[id];
  await supa.from('prep_log').insert({
    item: it.name,
    station: it.category || tr('generale'),
    qty: 0, unit: 'no_need', container: '',
    user_name: user.name,
    started_at: _nSt.toISOString(),
    duration_minutes: _nDur
  });
  await supa.from('prep_tasks').update({need_tomorrow: false, in_progress: false}).eq('id', id);
  tasks[id].need_tomorrow = false;
  tasks[id].in_progress = false;
  delete _taskStep[id];
  delete _taskStepTotal[id];
  renderM(); renderS(); renderHomeStations();
  if (typeof buildFocusList === 'function') buildFocusList();
  if (typeof window.renderFocusFeed === 'function') window.renderFocusFeed();
};

async function quickSave(id){
  const it=tasks[id];
  const qty=it.average_qty||1;
  const newStock = it.suggested_qty ? parseFloat(it.suggested_qty) : qty;
  _finishTask(id, newStock);
  Promise.all([
    supa.from('prep_log').insert({item:it.name,station:it.category||tr('generale'),qty,unit:'kg',container:'1/4 pan',user_name:user.name,is_suggested_qty:false}),
    supa.from('prep_tasks').update({need_tomorrow:false,in_progress:false,current_stock:newStock}).eq('id',id)
  ]).then(()=>{loadItemAlerts();loadStepsMap();}).catch(e=>console.error('quickSave DB error:',e));
}

async function saveWip(id, note){
  tasks[id].in_progress=true;
  await supa.from('prep_tasks').update({in_progress:true}).eq('id',id);
  if(note) await supa.from('prep_tasks').update({note}).eq('id',id);
  renderM();
}

async function loadStationNotes(){
  try{
    const{data}=await supa.from('station_notes').select('*');
    stationNotes={};
    (data||[]).forEach(r=>stationNotes[r.station]=r.note);
  }catch(e){}
}

// legacy
window.save=async(id,btn)=>{ quickSave(id); };

// ── FEED ──
function renderFeed(){
  const base=items.filter(i=>station==='All'||i.category?.includes(station));
  const list=base.sort((a,b)=>(b.need_tomorrow?1:0)-(a.need_tomorrow?1:0));
  const feed=document.getElementById('feed');
  feed.innerHTML=list.map((i,idx)=>`
    <div class="snap-start h-[calc(100vh-170px)] flex flex-col justify-center px-6">
      <div class="text-center mb-4">
        <div class="text-[11px] font-bold ${i.need_tomorrow?'text-red-600':'text-slate-400'}">${i.need_tomorrow?'🔴 '+tr('urgent'):''}</div>
        <div class="text-[12px] text-slate-500 mt-1">${idx+1} / ${list.length}</div>
      </div>
      <div class="bg-white rounded-[28px] shadow-xl border border-slate-100 p-6">
        <h2 class="text-[32px] font-bold text-center leading-tight mb-1">${i.name}</h2>
        <p class="text-center text-sm text-slate-500 mb-5">${i.category||tr('generale')}</p>
        <div class="grid grid-cols-3 gap-2 mb-4">
          ${['1','2','2.5'].map(q=>`<button onclick="feedSave('${i.id}','${q}',this)" class="h-[70px] rounded-2xl border-2 border-slate-200 bg-slate-50 font-semibold text-lg active:scale-95 transition">${q}</button>`).join('')}
        </div>
        <div class="flex items-center justify-between mt-4 pt-4 border-t">
          <button onclick="openRecipeForItem('${i.id}')" class="text-[13px] text-slate-600 flex items-center gap-1.5">📖 ${tr('recipe')}</button>
        </div>
      </div>
    </div>`).join('');
}

async function feedSave(id,qty,btn){
  const it=tasks[id];
  btn.disabled=true; btn.innerHTML=tr('prep_saved');
  btn.classList.add('bg-emerald-600','text-white','border-emerald-600');
  await supa.from('prep_log').insert({item:it.name,station:it.category||tr('generale'),qty:parseFloat(qty),unit:'kg',container:'1/4 pan',user_name:user.name});
  await supa.from('prep_tasks').update({need_tomorrow:false}).eq('id',id);
  tasks[id].need_tomorrow=false;
  setTimeout(()=>{document.getElementById('feed').scrollBy({top:window.innerHeight*0.8,behavior:'smooth'});renderM();renderS();renderHomeStations();},600);
}

// Carica steps map all'avvio
loadStepsMap();





