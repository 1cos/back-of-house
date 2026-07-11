// ── CHIUSURA OQR ──

function renderS(){
  var list=closingItems.filter(function(i){return station2==='All'||i.station===station2;});
  var allStations=Array.from(new Set(closingItems.map(function(i){return i.station;}))).sort();

  // Contatore completamento
  var total=list.length;
  var done=list.filter(function(i){return closingAnswers[i.id]===true;}).length;
  var progressBar='';
  if(total>0){
    var pct=Math.round(done/total*100);
    var barColor=done===total?'#16a34a':'#3b82f6';
    progressBar='<div style="margin-bottom:12px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
        '<span style="font-size:12px;font-weight:600;color:#64748b;">'+done+' / '+total+' completed</span>' +
        '<span style="font-size:12px;font-weight:700;color:'+barColor+';">'+pct+'%</span>' +
      '</div>' +
      '<div style="height:6px;background:#e2e8f0;border-radius:99px;overflow:hidden;">' +
        '<div style="height:100%;width:'+pct+'%;background:'+barColor+';border-radius:99px;transition:width .3s;"></div>' +
      '</div>' +
    '</div>';
  }

  checks.innerHTML=progressBar+
    list.map(function(i){
      var ans=closingAnswers[i.id];
      var isChiusura=i.station==='Chiusura';

      var checked=ans===true;
      var bgColor=checked?'rgba(240,253,244,0.95)':'rgba(255,255,255,0.95)';
      var nameColor=checked?'#14532d':'#0f172a';
      var leftBorder=checked?'#16a34a':'#e2e8f0';
      var checkBg=checked?'background:#16a34a;border-color:#16a34a;':'background:white;border-color:#cbd5e1;';
      var checkInner=checked?'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>':'';
      var nameStyle=checked?'text-decoration:line-through;opacity:0.6;':'';

      var stationLabel=isChiusura?'<span style="font-size:10px;color:#94a3b8;font-weight:500;text-transform:uppercase;letter-spacing:.04em;">Task</span>':'';

      return '<div onclick="setClosing(\''+i.id+'\','+(checked?'false':'true')+')" style="margin-bottom:8px;cursor:pointer;background:'+bgColor+';border-radius:16px;border-left:4px solid '+leftBorder+';box-shadow:0 1px 4px rgba(15,23,42,0.08);padding:12px 14px;display:flex;align-items:center;gap:12px;">' +
        '<div style="width:26px;height:26px;border-radius:50%;border:2px solid;'+checkBg+'display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .2s;">'+checkInner+'</div>' +
        '<span style="font-size:15px;font-weight:600;color:'+nameColor+';flex:1;'+nameStyle+'">'+i.name+'</span>' +
        stationLabel+
      '</div>';
    }).join('');
}

window.setClosing=async function(id,value){
  id=Number(id);
  closingAnswers[id]=value;

  // Salva in closing_log
  var checkItem=closingItems.find(function(i){return i.id===id;});
  if(checkItem){
    await supa.from('closing_log').insert({
      check_id: id,
      user_name: user?user.name:'unknown',
      answer: value
    });
  }

  renderS(); renderM(); renderHomeStations();

  // Auto-close se tutti completati
  var list=closingItems.filter(function(i){return station2==='All'||i.station===station2;});
  if(list.length>0 && list.every(function(i){return closingAnswers[i.id]===true;})){
    doCloseTurn();
  }
};

async function closeTurn(){
  var list=closingItems.filter(function(i){return station2==='All'||i.station===station2;});
  var pending=list.filter(function(i){return closingAnswers[i.id]!==true;});
  if(pending.length>0){
    var t=document.createElement('div');
    t.className='fixed top-20 left-1/2 -translate-x-1/2 z-[70] bg-red-600 text-white text-sm px-5 py-3 rounded-2xl shadow-xl text-center max-w-[280px]';
    t.textContent=pending.length+' item'+(pending.length>1?'s':'')+' not checked yet';
    document.body.appendChild(t);
    setTimeout(function(){t.remove();},3000);
    return;
  }
  doCloseTurn();
}

async function doCloseTurn(){
  await supa.from('messages').insert({
    text: '\uD83D\uDD12 '+tr('shiftClosed')+' '+user.name+'. '+tr('allGood')+'.',
    user_name:'Sistema',
    lang:user.lang||'it'
  });

  closingAnswers={};

  var todayCDT = getNowCDT().toISOString().slice(0,10);
  var todayKey='boh_closed_'+todayCDT+'_'+(user?user.name:'');
  localStorage.setItem(todayKey, '1');

  renderS(); renderHomeStations();
  updateCloseTurnBtn();

  if (typeof window.checkOperationNotePrompt === 'function') {
    window.checkOperationNotePrompt(true);
  }
}

function updateCloseTurnBtn(){
  var btn=document.getElementById('closeTurnBtn');
  if(!btn) return;
  var todayCDT = getNowCDT().toISOString().slice(0,10);
  var todayKey='boh_closed_'+todayCDT+'_'+(user?user.name:'');
  var alreadyClosed=localStorage.getItem(todayKey)==='1';
  if(alreadyClosed){
    btn.textContent='\u2713 '+tr('closeTurnDone');
    btn.style.background='#16a34a';
    btn.onclick=function(){
      var t=document.createElement('div');
      t.className='fixed top-16 left-1/2 -translate-x-1/2 z-[70] bg-slate-800 text-white text-sm px-4 py-2.5 rounded-2xl shadow-xl';
      t.textContent=tr('alreadyClosed')||'You already closed tonight \uD83D\uDC4C';
      document.body.appendChild(t);
      setTimeout(function(){t.remove();},2500);
    };
  } else {
    btn.textContent=tr('closeTurn');
    btn.style.background='';
    btn.onclick=closeTurn;
  }
}
