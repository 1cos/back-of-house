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

// ── CHECK URGENTI SCADUTE (14:30) ──
function startUrgencyCheck(){
  setInterval(()=>{
    const now=new Date();
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
  // verifica se esiste già almeno un item con category 'Chiusura'
  const exists = items.some(i=>i.category==='Chiusura');
  if(!exists && isAdmin()){
    // non creare item automaticamente, ma aggiungi Chiusura alla lista stazioni
  }
  // la stazione Chiusura appare nella lista anche se vuota
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
  // calcola confidenza
  const qty = a.last_made_qty||0;
  const avgQty = a.average_qty||qty;
  const duration = a.expected_duration_days||1;
  const missingWeek = a.missing_count_week||0;
  // se prodotto oggi con quantità normale e durata attesa > 1 giorno → alta confidenza che ci sia
  if(qty >= avgQty*0.8 && duration > 1) return {level:'high', a};
  if(qty >= avgQty*0.5) return {level:'medium', a};
  return {level:'low', a};
}

async function checkBeforeMissing(id, itemName){
  const alert = getAlertLevel(itemName);
  if(!alert) return true; // nessun avviso, procedi
  const a = alert.a;
  const madeAt = new Date(a.last_made_at).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
  const madeQty = a.last_made_qty ? `${a.last_made_qty} ${a.last_made_by?'da '+a.last_made_by:''}` : '';
  const missingNote = a.missing_count_week>1 ? `\n⚠️ Segnalato mancante ${a.missing_count_week} volte questa settimana.` : '';
  
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
      // log falso allarme
      supa.from('alerts_log').insert({item:itemName,user_name:user?.name,was_really_missing:false,qty_made_that_day:a.last_made_qty,made_by:a.last_made_by,made_at:a.last_made_at});
      resolve(false);
    };
    popup.querySelector('#alertConfirm').onclick=()=>{
      popup.remove();
      // log conferma
      supa.from('alerts_log').insert({item:itemName,user_name:user?.name,was_really_missing:true,qty_made_that_day:a.last_made_qty,made_by:a.last_made_by,made_at:a.last_made_at});
      resolve(true);
    };
  });
}

// ── PREP ──
function renderM(){
  const base=items.filter(i=>station==='All'||i.category?.includes(station));
  // ordinamento: rossi (need_tomorrow) > blu (in_progress) > normali
  const list=base.sort((a,b)=>{
    const aScore=(a.need_tomorrow?2:0)+(a.in_progress?1:0);
    const bScore=(b.need_tomorrow?2:0)+(b.in_progress?1:0);
    if(bScore!==aScore) return bScore-aScore;
    return a.name.localeCompare(b.name);
  });
  const pc=base.filter(i=>i.need_tomorrow).length;
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
      const isUrgent=i.need_tomorrow;
      const isWip=i.in_progress&&!i.need_tomorrow;
      const accentColor=isUrgent?'#ef4444':isWip?'#3b82f6':'#94a3b8';
      const nameColor=isUrgent?'#991b1b':isWip?'#1e40af':'#0f172a';
      const badge=isUrgent?'<span style="font-size:10px;font-weight:700;color:#ef4444;background:rgba(239,68,68,0.1);padding:2px 6px;border-radius:6px;letter-spacing:.04em;">'+tr('urgent')+'</span>':
                   isWip?'<span style="font-size:10px;font-weight:600;color:#3b82f6;background:rgba(59,130,246,0.1);padding:2px 6px;border-radius:6px;">'+tr('inProgress')+'</span>':'';
      const iid = i.id;
      return '<div class="col-span-2 mb-2 cursor-pointer active:scale-[0.98] transition-transform" style="background:rgba(255,255,255,0.60);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-radius:16px;border-left:4px solid ' + accentColor + ';box-shadow:0 2px 8px rgba(30,58,95,0.06),0 8px 24px rgba(30,58,95,0.04),inset 0 1px 0 rgba(255,255,255,0.9);">' +
        '<div style="padding:12px 12px 12px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
          '<div style="flex:1;min-width:0;" onclick="openRecipeForItem(' + JSON.stringify(iid) + ')">' +
            '<div style="font-size:15px;font-weight:600;color:' + nameColor + ';line-height:1.3;">' + i.name + '</div>' +
            (badge ? '<div style="margin-top:4px;">' + badge + '</div>' : '') +
            '<div style="margin-top:3px;">' +
              (i.recipe_id ? '<span style="font-size:11px;color:#059669;font-weight:500;">'+tr('recipe')+'</span>' :
               window.prepTasksWithSteps?.has(String(iid)) ? '<span style="font-size:11px;color:#7c3aed;font-weight:500;">▶ steps</span>' :
               i.note ? '<span style="font-size:11px;color:#d97706;">'+tr('note')+'</span>' :
               isAdmin() ? '<span style="font-size:11px;color:#94a3b8;">'+tr('noRecipeLink')+'</span>' : '') +
            '</div>' +
            (i.suggested_note ? (()=>{
              // Bot v18: formato "color|testo" — green/yellow/red
              const note = i.suggested_note;
              if (note && note.includes('|')) {
                const [col, ...rest] = note.split('|');
                const txt = rest.join('|');
                const styles = {
                  green:  {bg:'rgba(5,150,105,0.1)',  border:'#bbf7d0', color:'#059669'},
                  yellow: {bg:'rgba(217,119,6,0.1)',   border:'#fde68a', color:'#d97706'},
                  red:    {bg:'rgba(220,38,38,0.1)',   border:'#fca5a5', color:'#dc2626'}
                };
                const s = styles[col] || styles.yellow;
                return '<div style="margin-top:5px;"><span style="font-size:11px;font-weight:700;color:'+s.color+';background:'+s.bg+';border:1px solid '+s.border+';border-radius:6px;padding:2px 7px;">🤖 '+txt+'</span></div>';
              }
              // Fallback: nota senza formato color| — mostrala come verde
              return '<div style="margin-top:5px;"><span style="font-size:11px;font-weight:700;color:#059669;background:rgba(5,150,105,0.1);border:1px solid #bbf7d0;border-radius:6px;padding:2px 7px;">🤖 '+note+'</span></div>';
            })() : '') +
            (i.current_stock !== null && i.current_stock !== undefined ? (()=>{
              const stock = parseFloat(i.current_stock);
              const sq = parseFloat(i.suggested_qty||0);
              const unit = i.unit||'';
              const stockLabel = stock + (unit?' '+unit:'');
              if (stock === 0) {
                return '<div style="margin-top:4px;"><span style="font-size:11px;font-weight:700;color:#059669;background:rgba(5,150,105,0.1);border-radius:6px;padding:2px 7px;">🟢 Prepara oggi</span></div>';
              } else if (sq > 0 && stock <= sq * 0.5) {
                return '<div style="margin-top:4px;"><span style="font-size:11px;font-weight:700;color:#dc2626;background:rgba(220,38,38,0.1);border-radius:6px;padding:2px 7px;">🔴 Quasi finito · '+stockLabel+' rimaste</span></div>';
              } else {
                return '<div style="margin-top:4px;"><span style="font-size:11px;font-weight:600;color:#d97706;background:rgba(217,119,6,0.1);border-radius:6px;padding:2px 7px;">🟡 Stock ok · '+stockLabel+'</span></div>';
              }
            })() : '') +
          '</div>' +
          '<div style="display:flex;gap:6px;flex-shrink:0;">' +
            (isUrgent||!isWip ? '<button onpointerdown="startWipPress(' + JSON.stringify(iid) + ',this)" onpointerup="endWipPress()" onpointerleave="endWipPress()" style="height:36px;padding:0 14px;border-radius:10px;font-size:12px;font-weight:600;background:white;color:#1d4ed8;border:1.5px solid #3b82f6;white-space:nowrap;">'+tr('laterBtn')+'</button>' : '') +
            '<button onpointerdown="startDonePress(' + JSON.stringify(iid) + ',this)" onpointerup="endDonePress(' + JSON.stringify(iid) + ')" onpointerleave="endDonePress(' + JSON.stringify(iid) + ')" style="height:36px;padding:0 16px;border-radius:10px;font-size:12px;font-weight:700;background:#059669;color:white;border:none;white-space:nowrap;box-shadow:0 2px 6px rgba(5,150,105,0.35);">'+tr('doneBtn')+'</button>' +
            (isUrgent ? '<button onclick="noNeed(' + JSON.stringify(iid) + ')" style="height:36px;padding:0 12px;border-radius:10px;font-size:12px;font-weight:600;background:rgba(234,179,8,0.15);color:#92400e;border:1.5px solid rgba(234,179,8,0.5);white-space:nowrap;">'+tr('noNeedBtn')+'</button>' : '') +
            (isAdmin() ? '<span style="display:flex;gap:4px;align-items:center;"><button onclick="adminRename(' + JSON.stringify(iid) + ')" style="font-size:14px;color:#94a3b8;background:none;border:none;padding:4px;">✏</button><button onclick="adminDel(' + JSON.stringify(iid) + ')" style="font-size:14px;color:#94a3b8;background:none;border:none;padding:4px;">🗑</button></span>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
}

// ── NUOVI HANDLER FATTA / DA FINIRE ──

// Tap veloce Fatta → salva con default
// Tap lungo Fatta → apre bottom sheet dettagli
function startDonePress(id, btn){
  doneTarget=id;
  donePressTimer=setTimeout(()=>{
    donePressTimer=null;
    openDoneSheet(id);
  }, 600);
}
function endDonePress(id){
  if(donePressTimer){
    clearTimeout(donePressTimer);
    donePressTimer=null;
    // tap veloce — salva con default
    quickSave(id);
  }
}

// Tap veloce Da finire → segna WIP
// Tap lungo Da finire → apre note
function startWipPress(id, btn){
  wipPressTimer=setTimeout(()=>{
    wipPressTimer=null;
    openWipNoteSheet(id);
  }, 600);
}
function endWipPress(){
  if(wipPressTimer){
    clearTimeout(wipPressTimer);
    wipPressTimer=null;
    // tap veloce — segna in progress
    const id=doneTarget; // usa last target
  }
}

window.setWip=async(id)=>{
  tasks[id].in_progress=true;
  await supa.from('prep_tasks').update({in_progress:true}).eq('id',id);
  renderM();
};

// Override startWipPress to capture id
window.startWipPress=function(id,btn){
  doneTarget=id;
  wipPressTimer=setTimeout(()=>{
    wipPressTimer=null;
    openWipNoteSheet(id);
  },600);
};
window.endWipPress=function(){
  if(wipPressTimer){
    clearTimeout(wipPressTimer);
    wipPressTimer=null;
    setWip(doneTarget);
  }
};

async function quickSave(id){
  const it=tasks[id];
  const qty=it.average_qty||1;
  const unit='kg';
  const container='1/4 pan';
  // Usa suggested_qty come current_stock se disponibile
  const newStock = it.suggested_qty ? parseFloat(it.suggested_qty) : qty;
  // ── Optimistic update: aggiorna UI subito, DB in background ──
  tasks[id].need_tomorrow=false;
  tasks[id].in_progress=false;
  tasks[id].current_stock=newStock;
  showConfetti();
  renderM();renderS();renderHomeStations();
  // DB in background — non blocca la UI
  Promise.all([
    supa.from('prep_log').insert({item:it.name,station:it.category||tr('generale'),qty,unit,container,user_name:user.name,is_suggested_qty:false}),
    supa.from('prep_tasks').update({need_tomorrow:false,in_progress:false,current_stock:newStock}).eq('id',id)
  ]).then(()=>{
    loadItemAlerts();
    loadStepsMap();
  }).catch(e=>console.error('quickSave DB error:',e));
}

function openDoneSheet(id){
  const it=tasks[id];
  // Se c'è una dose consigliata dal bot, mostra prima il mini-modal di scelta
  if(it.suggested_qty && parseFloat(it.suggested_qty) > 0){
    const sqRaw = parseFloat(it.suggested_qty);
    const sqUnit = it.unit||'porzioni';
    const sqLabel = sqRaw + ' ' + sqUnit;
    const modal=document.createElement('div');
    modal.className='fixed inset-0 z-50 flex items-end';
    modal.style.background='rgba(0,0,0,0.35)';
    modal.innerHTML=`<div style="background:rgba(255,255,255,0.96);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-radius:24px 24px 0 0;border-top:0.5px solid rgba(5,150,105,0.3);padding:20px 16px 28px;width:100%;max-width:480px;margin:0 auto;animation:slideUp .25s ease">
      <div style="width:36px;height:4px;background:rgba(5,150,105,0.2);border-radius:2px;margin:0 auto 16px;"></div>
      <div style="font-size:15px;font-weight:600;color:#1e3a5f;margin-bottom:4px;">${it.name}</div>
      <div style="font-size:12px;color:#6b7280;margin-bottom:18px;">Quanto hai preparato?</div>
      <button onclick="suggestedSave('${it.id}',this.closest('.fixed'))" style="width:100%;height:52px;border-radius:16px;background:#059669;color:white;font-size:14px;font-weight:600;border:none;margin-bottom:10px;">
        ✅ ${sqLabel} — dose suggerita
      </button>
      <button onclick="this.closest('.fixed').remove();openDoneSheetCustom('${it.id}')" style="width:100%;height:44px;border-radius:14px;background:rgba(59,130,246,0.08);color:#1d4ed8;font-size:13px;border:0.5px solid rgba(59,130,246,0.2);">
        ✏️ Quantità diversa
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
  const sheet=document.createElement('div');
  sheet.className='fixed inset-0 z-50 flex items-end';
  sheet.style.background='rgba(0,0,0,0.3)';
  sheet.innerHTML=`<div style="background:rgba(255,255,255,0.92);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-radius:24px 24px 0 0;border-top:0.5px solid rgba(59,130,246,0.2);padding:16px;width:100%;max-width:480px;margin:0 auto;animation:slideUp .25s ease">
    <div style="width:36px;height:4px;background:rgba(59,130,246,0.15);border-radius:2px;margin:0 auto 14px;"></div>
    <div style="font-size:14px;font-weight:500;color:#1e3a5f;margin-bottom:12px;">${it.name}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px;">
      <div>
        <div style="font-size:9px;color:#93c5fd;font-weight:500;margin-bottom:3px;text-transform:uppercase;letter-spacing:.04em;">Qty</div>
        <select class="ds-qty" style="width:100%;font-size:11px;color:#1e3a5f;background:rgba(59,130,246,0.06);border:0.5px solid rgba(59,130,246,0.2);border-radius:8px;padding:4px 5px;">
          ${QTYS.map(o=>`<option ${o===(it.average_qty||1).toString()?'selected':''}>${o}</option>`).join('')}
        </select>
      </div>
      <div>
        <div style="font-size:9px;color:#93c5fd;font-weight:500;margin-bottom:3px;text-transform:uppercase;letter-spacing:.04em;">Unità</div>
        <select class="ds-unit" style="width:100%;font-size:11px;color:#1e3a5f;background:rgba(59,130,246,0.06);border:0.5px solid rgba(59,130,246,0.2);border-radius:8px;padding:4px 5px;">
          ${UNITS.map(o=>`<option>${o}</option>`).join('')}
        </select>
      </div>
      <div>
        <div style="font-size:9px;color:#93c5fd;font-weight:500;margin-bottom:3px;text-transform:uppercase;letter-spacing:.04em;">Contenitore</div>
        <select class="ds-cont" style="width:100%;font-size:11px;color:#1e3a5f;background:rgba(59,130,246,0.06);border:0.5px solid rgba(59,130,246,0.2);border-radius:8px;padding:4px 5px;">
          ${CONTAINERS.map(o=>`<option>${o}</option>`).join('')}
        </select>
      </div>
    </div>
    <textarea class="ds-note" placeholder="${tr('quickNotePlaceholder')}" style="width:100%;font-size:12px;color:#1e3a5f;background:rgba(59,130,246,0.04);border:0.5px solid rgba(59,130,246,0.15);border-radius:10px;padding:7px 10px;margin-bottom:10px;resize:none;height:38px;"></textarea>
    <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px;">
      <button onclick="this.closest('.fixed').remove()" style="height:40px;border-radius:14px;background:rgba(59,130,246,0.08);color:#1d4ed8;font-size:13px;border:0.5px solid rgba(59,130,246,0.2);">${tr('cancel')}</button>
      <button onclick="detailSave('${it.id}',this,false)" style="height:40px;border-radius:14px;background:#1e3a5f;color:white;font-size:13px;font-weight:500;">${tr('confirm')}</button>
    </div>
  </div>`;
  sheet.onclick=e=>{if(e.target===sheet)sheet.remove();};
  document.body.appendChild(sheet);
}

// Salva con la dose suggerita dal bot
async function suggestedSave(id, modal){
  const it=tasks[id];
  const qty=parseFloat(it.suggested_qty)||1;
  const unit=it.unit||'porzioni';
  modal.remove();
  tasks[id].need_tomorrow=false;
  tasks[id].in_progress=false;
  tasks[id].current_stock=qty;
  showConfetti();
  renderM();renderS();renderHomeStations();
  Promise.all([
    supa.from('prep_log').insert({item:it.name,station:it.category||tr('generale'),qty,unit,container:'',user_name:user.name,is_suggested_qty:true}),
    supa.from('prep_tasks').update({need_tomorrow:false,in_progress:false,current_stock:qty}).eq('id',id)
  ]).then(()=>{loadItemAlerts();loadStepsMap();})
  .catch(e=>console.error('suggestedSave error:',e));
}

function openWipNoteSheet(id){
  const it=tasks[id];
  const sheet=document.createElement('div');
  sheet.className='fixed inset-0 z-50 flex items-end';
  sheet.style.background='rgba(0,0,0,0.3)';
  sheet.innerHTML=`<div style="background:rgba(255,255,255,0.92);backdrop-filter:blur(20px);border-radius:24px 24px 0 0;border-top:0.5px solid rgba(59,130,246,0.2);padding:16px;width:100%;max-width:480px;margin:0 auto;animation:slideUp .25s ease">
    <div style="width:36px;height:4px;background:rgba(59,130,246,0.15);border-radius:2px;margin:0 auto 14px;"></div>
    <div style="font-size:14px;font-weight:500;color:#1e3a5f;margin-bottom:10px;">${it.name} — '+tr('laterBtn')+'</div>
    <textarea id="wipNote" placeholder="es. manca solo il basilico..." style="width:100%;font-size:13px;color:#1e3a5f;background:rgba(59,130,246,0.04);border:0.5px solid rgba(59,130,246,0.15);border-radius:12px;padding:10px 12px;resize:none;height:70px;margin-bottom:10px;"></textarea>
    <button onclick="saveWip('${id}',document.getElementById('wipNote').value);this.closest('.fixed').remove()" 
      style="width:100%;height:40px;border-radius:14px;background:#3B82F6;color:white;font-size:13px;font-weight:500;">'+tr('markInProgress')+'</button>
  </div>`;
  sheet.onclick=e=>{if(e.target===sheet)sheet.remove()};
  document.body.appendChild(sheet);
}


// -- NO NEED --
window.noNeed = async function(id) {
  const it = tasks[id];
  if (!it) return;
  const msg = it.name + ' — No Need: '+tr('noNeedConfirm');
  if (!confirm(msg)) return;
  await supa.from('prep_log').insert({
    item: it.name,
    station: it.category || tr('generale'),
    qty: 0,
    unit: 'no_need',
    container: '',
    user_name: user.name,
    started_at: new Date().toISOString()
  });
  await supa.from('prep_tasks').update({need_tomorrow: false, in_progress: false}).eq('id', id);
  tasks[id].need_tomorrow = false;
  tasks[id].in_progress = false;
  renderM();
  renderS();
  renderHomeStations();
  // Aggiorna anche Focus Mode se attiva
  if (typeof buildFocusList === 'function') buildFocusList();
  if (typeof window.renderFocusFeed === 'function') window.renderFocusFeed();
};

async function saveWip(id, note){
  tasks[id].in_progress=true;
  await supa.from('prep_tasks').update({in_progress:true}).eq('id',id);
  if(note) await supa.from('prep_tasks').update({note}).eq('id',id);
  renderM();
}

async function detailSave(id, btn, isSuggested){
  const sheet=btn.closest('.fixed');
  const qty=parseFloat(sheet.querySelector('.ds-qty').value);
  const unit=sheet.querySelector('.ds-unit').value;
  const cont=sheet.querySelector('.ds-cont').value;
  const note=sheet.querySelector('.ds-note').value;
  btn.textContent='...'; btn.disabled=true;
  const it=tasks[id];
  await supa.from('prep_log').insert({item:it.name,station:it.category||tr('generale'),qty,unit,container:cont,user_name:user.name,is_suggested_qty:!!isSuggested});
  await supa.from('prep_tasks').update({need_tomorrow:false,in_progress:false,current_stock:qty}).eq('id',id);
  tasks[id].need_tomorrow=false;
  tasks[id].in_progress=false;
  tasks[id].current_stock=qty;
  await loadItemAlerts();
  await loadStepsMap();
  sheet.remove();
  showConfetti();
  setTimeout(()=>{renderM();renderS();renderHomeStations();if(!document.getElementById('vr').classList.contains('hidden'))loadReport('today');},300);
}

async function loadStationNotes(){
  try{
    const{data}=await supa.from('station_notes').select('*');
    stationNotes={};
    (data||[]).forEach(r=>stationNotes[r.station]=r.note);
  }catch(e){}
}

// legacy save — kept for compatibility
window.save=async(id,btn)=>{
  quickSave(id);
};

// ── COMMENTO RAPIDO (punto 30) ──
function askQuickComment(){
  return new Promise(resolve=>{
    const popup=document.createElement('div');
    popup.className='fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end';
    popup.innerHTML=`
      <div class="bg-white w-full max-w-md mx-auto rounded-t-[28px] p-5" style="animation:slideUp .2s ease">
        <div class="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-3"></div>
        <p class="text-sm font-semibold mb-2">💬 Commento rapido <span class="text-slate-400 font-normal">(opzionale)</span></p>
        <input id="quickComment" placeholder="${tr('quickCommentPlaceholder')}" class="w-full px-3 py-2.5 border rounded-xl text-sm mb-3">
        <div class="grid grid-cols-2 gap-2">
          <button onclick="this.closest('.fixed').remove();document.dispatchEvent(new CustomEvent('quickCommentDone',{detail:''}))" class="py-2.5 border rounded-xl text-sm">Salta</button>
          <button onclick="const v=document.getElementById('quickComment').value;this.closest('.fixed').remove();document.dispatchEvent(new CustomEvent('quickCommentDone',{detail:v}))" class="py-2.5 bg-slate-900 text-white rounded-xl text-sm font-semibold">Salva</button>
        </div>
      </div>`;
    document.body.appendChild(popup);
    document.addEventListener('quickCommentDone',e=>{resolve(e.detail)},{once:true});
  });
}

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
          <button onclick="openRecipeForItem('${i.id}')" class="text-[13px] text-slate-600 flex items-center gap-1.5">📖 '+tr('recipe')+'</button>
        </div>
      </div>
    </div>`).join('');
}

async function feedSave(id,qty,btn){
  const it=tasks[id];
  btn.disabled=true; btn.innerHTML='✓ Salvato';
  btn.classList.add('bg-emerald-600','text-white','border-emerald-600');
  await supa.from('prep_log').insert({item:it.name,station:it.category||tr('generale'),qty:parseFloat(qty),unit:'kg',container:'1/4 pan',user_name:user.name});
  await supa.from('prep_tasks').update({need_tomorrow:false}).eq('id',id);
  tasks[id].need_tomorrow=false;
  setTimeout(()=>{document.getElementById('feed').scrollBy({top:window.innerHeight*0.8,behavior:'smooth'});renderM();renderS();renderHomeStations()},600);
}




// Carica steps map all'avvio
loadStepsMap();

