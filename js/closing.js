// ── CHIUSURA OQR ──
function renderS(){
  const list=items.filter(i=>station2==='All'||i.category?.includes(station2));
  const counts=['Oven','Pasta','Plating','Salad','Freezer'].map(s=>{
    const c=items.filter(i=>i.need_tomorrow&&i.category?.includes(s)).length;
    return c?`${s}: ${c} ${tr('closeCount')}`:null;
  }).filter(Boolean).join(' • ');
  checks.innerHTML=(counts?`<div class="text-xs text-amber-700 mb-2 font-medium">${counts}</div>`:'')+
    list.map(i=>{
      const ans=closingAnswers[i.id];
      const isChiusura=i.category==='Chiusura';
      if(isChiusura){
        // spunta semplice per stazione Chiusura
        return `<label class="flex items-center gap-3 p-3 bg-white rounded-2xl border ${ans===true?'border-green-300 bg-green-50':'border-slate-200'} shadow-sm cursor-pointer active:scale-[0.99] transition">
          <div onclick="setClosing('${i.id}',${ans===true?'false':'true'})" class="w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition ${ans===true?'bg-green-600 border-green-600':'border-slate-300'}">
            ${ans===true?'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>':''}
          </div>
          <span class="font-semibold text-[14px] flex-1">${i.name}</span>
          <span class="text-[10px] text-slate-400">Chiusura</span>
        </label>`;
      }
      return `<div class="bg-white p-3 rounded-2xl border ${ans===false?'border-red-300 bg-red-50':ans===true?'border-green-300 bg-green-50':'border-slate-200'} shadow-sm">
        <div class="flex items-center justify-between mb-2">
          <span class="font-semibold text-[14px]">${i.name}</span>
          <span class="text-[10px] text-slate-400">${i.category||''}</span>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <button onclick="setClosing('${i.id}',true)" class="py-2.5 rounded-xl text-sm font-semibold transition active:scale-95 ${ans===true?'bg-green-600 text-white':'bg-slate-100 text-slate-700'}">${tr('thereIs')}</button>
          <button onclick="setClosing('${i.id}',false)" class="py-2.5 rounded-xl text-sm font-semibold transition active:scale-95 ${ans===false?'bg-red-500 text-white':getAlertLevel(i.name)?'bg-amber-100 text-amber-800 border border-amber-300':'bg-slate-100 text-slate-700'}">${tr('missing')}${getAlertLevel(i.name)&&ans!==false?' ⚠️':''}</button>
        </div>
      </div>`;
    }).join('');
}

window.setClosing=async(id,value)=>{
  if(value===false){
    // controlla se prodotto stamani
    const proceed = await checkBeforeMissing(id, tasks[id]?.name||'');
    if(!proceed) return;
  }
  closingAnswers[id]=value;
  await supa.from('prep_tasks').update({need_tomorrow:!value}).eq('id',id);
  tasks[id].need_tomorrow=!value;
  renderS(); renderM(); renderHomeStations();
};

async function closeTurn(){
  const list=items.filter(i=>station2==='All'||i.category?.includes(station2));
  const forgotten=list.filter(i=>closingAnswers[i.id]===undefined);
  if(forgotten.length>0){
    showForgottenPopup(forgotten);
  } else {
    doCloseTurn();
  }
}

function showForgottenPopup(forgotten){
  const popup=document.createElement('div');
  popup.className='fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end';
  popup.innerHTML=`
    <div class="bg-white w-full max-w-md mx-auto rounded-t-[28px] p-5 max-h-[80vh] overflow-auto" style="animation:slideUp .25s ease">
      <div class="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4"></div>
      <p class="text-sm font-bold text-red-600 mb-3">⚠️ ${tr('forgottenAlert')}</p>
      <div class="space-y-2 mb-4" id="forgottenList">
        ${forgotten.map(i=>`
        <div id="fp_${i.id}" class="bg-slate-50 p-3 rounded-xl">
          <div class="font-medium text-sm mb-2">${i.name} <span class="text-[10px] text-slate-400">${i.category||''}</span></div>
          <div class="grid grid-cols-3 gap-2">
            <button onclick="setFromPopup('${i.id}',true)" class="py-2 rounded-xl text-xs font-semibold bg-slate-100">${tr('thereIs')}</button>
            <button onclick="setFromPopup('${i.id}',false)" class="py-2 rounded-xl text-xs font-semibold bg-slate-100">${tr('missing')}</button>
            <button onclick="goCheckStation('${i.category||''}','${i.id}')" class="py-2 rounded-xl text-xs font-semibold bg-amber-100 text-amber-800">${tr('goCheck')}</button>
          </div>
        </div>`).join('')}
      </div>
      <button id="popupCloseBtn" onclick="tryCloseFromPopup()" class="w-full py-3 bg-slate-900 text-white rounded-xl font-semibold">${tr('closeTurn')}</button>
    </div>`;
  popup.onclick=e=>{if(e.target===popup)popup.remove()};
  document.body.appendChild(popup);

  window._activePopup=popup;

  window.setFromPopup=async(id,value)=>{
    if(value===false){
      const proceed = await checkBeforeMissing(id, tasks[id]?.name||'');
      if(!proceed) return;
    }
    closingAnswers[id]=value;
    await supa.from('prep_tasks').update({need_tomorrow:!value}).eq('id',id);
    tasks[id].need_tomorrow=!value;
    // aggiorna visivamente la card nel popup
    const card=document.getElementById(`fp_${id}`);
    if(card) card.style.opacity='0.4';
    renderS(); renderM(); renderHomeStations();
    // controlla se tutti risposti
    const allList=items.filter(i=>station2==='All'||i.category?.includes(station2));
    const still=allList.filter(i=>closingAnswers[i.id]===undefined);
    if(!still.length){popup.remove();doCloseTurn();}
  };

  window.goCheckStation=async(category,itemId)=>{
    popup.remove();
    // porta alla tab chiusura con la stazione giusta
    const stName=category.replace(' Station','').replace('Station','').trim();
    if(stName) station2=stName;
    document.querySelector('[data-t=s]').click();
    // evidenzia l'item specifico
    setTimeout(()=>{
      const el=document.querySelector(`[onclick*="setClosing('${itemId}'"]`);
      if(el){el.closest('div.bg-white')?.scrollIntoView({behavior:'smooth',block:'center'});el.closest('div.bg-white')?.classList.add('ring-2','ring-amber-400')}
    },300);
  };

  window.tryCloseFromPopup=async()=>{
    const allList=items.filter(i=>station2==='All'||i.category?.includes(station2));
    const still=allList.filter(i=>closingAnswers[i.id]===undefined);
    if(still.length>0){
      const btn=document.getElementById('popupCloseBtn');
      btn.textContent='Rispondi prima a tutti ⬆';
      setTimeout(()=>btn.textContent=tr('closeTurn'),2000);
    } else {
      popup.remove();
      doCloseTurn();
    }
  };
}

async function doCloseTurn(){
  const missing=items.filter(i=>closingAnswers[i.id]===false);
  const missingList=missing.map(i=>i.name).join(', ')||'niente';
  await supa.from('messages').insert({
    text:`🔒 ${tr("shiftClosed")} ${user.name}. ${tr("missing2")}: ${missingList}.`,
    user_name:'Sistema',
    lang:user.lang||'it'
  });
  // invia push alla brigata della mattina
  try{
    await fetch(`${SUPABASE_URL}/functions/v1/send-push`,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${SUPABASE_ANON_KEY}`},
      body:JSON.stringify({
        title:'🔒 Turno chiuso',
        body: missingList==='niente' ? `${user.name} closed. ${tr('allGood')}` : `${user.name} closed. ${tr('daFare')}: ${missingList}`,
        exclude_user: user.name
      })
    });
  }catch(e){}
  closingAnswers={};
  // Salva chiusura per oggi
  const todayKey='boh_closed_'+new Date().toISOString().slice(0,10)+'_'+(user?.name||'');
  localStorage.setItem(todayKey, '1');
  renderS(); renderHomeStations();
  updateCloseTurnBtn();
}

function updateCloseTurnBtn(){
  const btn=document.getElementById('closeTurnBtn');
  if(!btn) return;
  const todayKey='boh_closed_'+new Date().toISOString().slice(0,10)+'_'+(user?.name||'');
  const alreadyClosed=localStorage.getItem(todayKey)==='1';
  if(alreadyClosed){
    btn.textContent='✓ '+tr('closeTurnDone');
    btn.style.background='#16a34a';
    btn.onclick=()=>{
      const t=document.createElement('div');
      t.className='fixed top-16 left-1/2 -translate-x-1/2 z-[70] bg-slate-800 text-white text-sm px-4 py-2.5 rounded-2xl shadow-xl';
      t.textContent=tr('alreadyClosed')||'You already closed tonight 👌';
      document.body.appendChild(t);
      setTimeout(()=>t.remove(),2500);
    };
  } else {
    btn.textContent=tr('closeTurn');
    btn.style.background='';
    btn.onclick=closeTurn;
  }
}

