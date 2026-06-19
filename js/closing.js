// ── CHIUSURA OQR ──

function renderS(){
  const list=items.filter(i=>station2==='All'||i.category?.includes(station2));
  const allStations=['Oven Station','Fresh Pasta Station','Pasta Station','Sauté Station','Saucier Station','Plating Station','Salad Station','Pastry Station','Tableside','Freezer'];
  const counts=allStations.map(s=>{
    const c=items.filter(i=>i.need_tomorrow&&i.category?.includes(s)).length;
    return c?`${s}: ${c} ${tr('closeCount')}`:null;
  }).filter(Boolean).join(' • ');
  checks.innerHTML=(counts?`<div class="text-xs text-amber-700 mb-2 font-medium">${counts}</div>`:'')+
    list.map(i=>{
      const ans=closingAnswers[i.id];
      const isChiusura=i.category==='Chiusura';
      if(isChiusura){
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
    const t=document.createElement('div');
    t.className='fixed top-20 left-1/2 -translate-x-1/2 z-[70] bg-red-600 text-white text-sm px-5 py-3 rounded-2xl shadow-xl text-center max-w-[280px]';
    t.textContent=tr('answerAll');
    document.body.appendChild(t);
    setTimeout(()=>t.remove(),3000);
    return;
  }
  doCloseTurn();
}

async function doCloseTurn(){
  const missing=items.filter(i=>closingAnswers[i.id]===false);
  const missingList=missing.map(i=>i.name).join(', ');
  await supa.from('messages').insert({
    text: missingList
      ? `🔒 ${tr("shiftClosed")} ${user.name}. ${tr("missing2")}: ${missingList}.`
      : `🔒 ${tr("shiftClosed")} ${user.name}. ${tr("allGood")}.`,
    user_name:'Sistema',
    lang:user.lang||'it'
  });
  // Push gestita automaticamente dal webhook su messages — non chiamare notifications manualmente

  closingAnswers={};

  // Salva chiusura per oggi (CDT)
  const todayCDT = getNowCDT().toISOString().slice(0,10);
  const todayKey='boh_closed_'+todayCDT+'_'+(user?.name||'');
  localStorage.setItem(todayKey, '1');

  renderS(); renderHomeStations();
  updateCloseTurnBtn();

  // Prompt note serale — appare 800ms dopo la chiusura turno
  if (typeof window.checkOperationNotePrompt === 'function') {
    window.checkOperationNotePrompt(true);
  }
}

function updateCloseTurnBtn(){
  const btn=document.getElementById('closeTurnBtn');
  if(!btn) return;
  const todayCDT = getNowCDT().toISOString().slice(0,10);
  const todayKey='boh_closed_'+todayCDT+'_'+(user?.name||'');
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
