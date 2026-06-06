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
            title:'⚠️ Prep urgenti non completate',
            body:`${urgent.length} prep non ancora fatte: ${urgent.slice(0,3).map(i=>i.name).join(', ')}`,
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
  const confidenceText = {high:'Alta confidenza che ci sia', medium:'Potrebbe essere finito', low:'Probabile che sia finito'};
  
  return new Promise(resolve=>{
    const popup=document.createElement('div');
    popup.className='fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4';
    popup.innerHTML=`
      <div class="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl" style="animation:slideUp .2s ease">
        <div class="text-center mb-4">
          <div class="text-4xl mb-2">🤔</div>
          <h3 class="font-bold text-lg">Sicuro che manca?</h3>
        </div>
        <div class="bg-slate-50 rounded-2xl p-3 mb-4 space-y-2">
          <div class="flex items-center gap-2 text-sm">
            <span>🧑‍🍳</span>
            <span><b>${a.last_made_by||'Qualcuno'}</b> l'ha fatto stamani alle <b>${madeAt}</b></span>
          </div>
          ${madeQty?`<div class="flex items-center gap-2 text-sm"><span>⚖️</span><span>Quantità: <b>${madeQty}</b></span></div>`:''}
          ${a.missing_count_week>1?`<div class="flex items-center gap-2 text-sm text-amber-700"><span>⚠️</span><span>Segnalato mancante <b>${a.missing_count_week}x</b> questa settimana</span></div>`:''}
          <div class="flex items-center gap-2 text-xs text-slate-500 pt-1 border-t">
            <span>${colors[alert.level]}</span>
            <span>${confidenceText[alert.level]}</span>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <button id="alertCancel" class="py-3 rounded-xl bg-slate-100 font-semibold text-sm">Ricontrolla</button>
          <button id="alertConfirm" class="py-3 rounded-xl bg-red-500 text-white font-semibold text-sm">Sì, manca</button>
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
  const list=base.sort((a,b)=>(b.need_tomorrow?1:0)-(a.need_tomorrow?1:0));
  const pc=base.filter(i=>i.need_tomorrow).length;
  const total=base.length;
  // aggiorna barra progresso urgenti
  const prog=document.getElementById('urgentProgress');
  const bar=document.getElementById('urgentBar');
  const cnt=document.getElementById('urgentCount');
  const done=document.getElementById('urgentDone');
  const timeEl=document.getElementById('urgentTime');
  if(prog){
    if(pc>0||total>0){
      prog.classList.remove('hidden');
      const completed=total-pc;
      const pct=total>0?Math.round((completed/total)*100):100;
      if(bar) bar.style.width=pct+'%';
      if(cnt) cnt.textContent=pc;
      // timer 14:30
      const now=new Date();
      const deadline=new Date(); deadline.setHours(14,30,0,0);
      const diffMs=deadline-now;
      if(timeEl){
        if(diffMs>0){
          const h=Math.floor(diffMs/3600000);
          const m=Math.floor((diffMs%3600000)/60000);
          timeEl.textContent=h>0?`${h}h ${m}m al limite`:`${m}m al limite`;
          timeEl.className=diffMs<3600000?'text-xs text-red-500 font-semibold':'text-xs text-slate-400';
        } else {
          timeEl.textContent='⚠️ Tempo scaduto';
          timeEl.className='text-xs text-red-600 font-bold';
        }
      }
      if(done) done.classList.toggle('hidden', pc>0);
      if(pc===0&&total>0) showConfetti();
    } else {
      prog.classList.add('hidden');
    }
  }
  grid.innerHTML=(pc?`<div class="col-span-2 text-[11px] font-bold text-red-600 mb-1 px-1">🔴 ${pc} ${tr('toDo')}</div>`:'')+
    list.map(i=>`<div class="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm ${i.need_tomorrow?'ring-2 ring-red-500 bg-red-50/70':''}">
      <div class="flex justify-between items-start mb-2">
        <span class="font-semibold text-[14px] leading-tight ${i.need_tomorrow?'text-red-700':''} cursor-pointer" onclick="showTranslation('${i.name}',this)">${i.name} <span class="text-[10px] text-slate-400">🌐</span></span>
        ${(i.recipe_id||i.note)?`<span class="text-[10px] ${i.recipe_id?'text-emerald-600':'text-amber-600'}">${i.recipe_id?'📖':'📝'}</span>`:''}

        ${isAdmin()?`<span class="flex gap-1.5 text-slate-400"><button onclick="adminRename('${i.id}')" class="text-[13px]">✏</button><button onclick="adminDel('${i.id}')" class="text-[13px]">🗑</button></span>`:''}
      </div>
      <div class="grid grid-cols-3 gap-1.5">
        <select class="c border border-slate-200 rounded-lg px-1.5 py-1.5 text-[11px] bg-slate-50">${CONTAINERS.map(o=>`<option>${o}</option>`).join('')}</select>
        <select class="u border border-slate-200 rounded-lg px-1.5 py-1.5 text-[11px] bg-slate-50">${UNITS.map(o=>`<option>${o}</option>`).join('')}</select>
        <select class="q border border-slate-200 rounded-lg px-1.5 py-1.5 text-[11px] bg-slate-50">${QTYS.map(o=>`<option>${o}</option>`).join('')}</select>
      </div>
      <button onclick="save('${i.id}',this)" class="w-full mt-2.5 bg-slate-900 text-white py-2 rounded-xl text-[12px] font-semibold active:scale-[0.98] transition">${tr('save')}</button>
    </div>`).join('');
}

window.save=async(id,btn)=>{
  const p=btn.parentElement;
  const c=p.querySelector('.c').value;
  const u=p.querySelector('.u').value;
  const q=parseFloat(p.querySelector('.q').value);
  
  // modale commento rapido (30)
  const comment = await askQuickComment();
  
  btn.disabled=true; btn.textContent=tr('ok');
  // animazione card
  const card=p.closest('.bg-white');
  if(card) card.classList.add('fly-out');
  
  await supa.from('prep_log').insert({item:tasks[id].name,station:tasks[id].category||'Generale',qty:q,unit:u,container:c,user_name:user.name,comment:comment||null});
  await supa.from('prep_tasks').update({need_tomorrow:false}).eq('id',id);
  tasks[id].need_tomorrow=false;
  await loadItemAlerts();
  setTimeout(()=>{
    renderM(); renderS(); renderHomeStations();
    if(!document.getElementById('vr').classList.contains('hidden')) loadReport('today');
  },500);
  setTimeout(()=>{btn.textContent=tr('save');btn.disabled=false},700);
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
        <input id="quickComment" placeholder="es. fatto con meno burro oggi..." class="w-full px-3 py-2.5 border rounded-xl text-sm mb-3">
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
        <div class="text-[11px] font-bold ${i.need_tomorrow?'text-red-600':'text-slate-400'}">${i.need_tomorrow?'🔴 DA FARE':''}</div>
        <div class="text-[12px] text-slate-500 mt-1">${idx+1} / ${list.length}</div>
      </div>
      <div class="bg-white rounded-[28px] shadow-xl border border-slate-100 p-6">
        <h2 class="text-[32px] font-bold text-center leading-tight mb-1">${i.name}</h2>
        <p class="text-center text-sm text-slate-500 mb-5">${i.category||'Generale'}</p>
        <div class="grid grid-cols-3 gap-2 mb-4">
          ${['1','2','2.5'].map(q=>`<button onclick="feedSave('${i.id}','${q}',this)" class="h-[70px] rounded-2xl border-2 border-slate-200 bg-slate-50 font-semibold text-lg active:scale-95 transition">${q}</button>`).join('')}
        </div>
        <div class="flex items-center justify-between mt-4 pt-4 border-t">
          <button onclick="openRecipeForItem('${i.id}')" class="text-[13px] text-slate-600 flex items-center gap-1.5">📖 Ricetta</button>
        </div>
      </div>
    </div>`).join('');
}

async function feedSave(id,qty,btn){
  const it=tasks[id];
  btn.disabled=true; btn.innerHTML='✓ Salvato';
  btn.classList.add('bg-emerald-600','text-white','border-emerald-600');
  await supa.from('prep_log').insert({item:it.name,station:it.category||'Generale',qty:parseFloat(qty),unit:'kg',container:'1/4 pan',user_name:user.name});
  await supa.from('prep_tasks').update({need_tomorrow:false}).eq('id',id);
  tasks[id].need_tomorrow=false;
  setTimeout(()=>{document.getElementById('feed').scrollBy({top:window.innerHeight*0.8,behavior:'smooth'});renderM();renderS();renderHomeStations()},600);
}

