// ── CHIUSURA OQR ──

function renderS(){
  var list=closingItems.filter(function(i){return station2==='All'||i.station===station2;});
  var allStations=Array.from(new Set(closingItems.map(function(i){return i.station;}))).sort();
  var counts=allStations.map(function(s){
    var c=closingItems.filter(function(i){return closingAnswers[i.id]===false&&i.station===s;}).length;
    return c?s.replace(' Station','')+': '+c+' '+tr('closeCount'):null;
  }).filter(Boolean).join(' \u2022 ');

  checks.innerHTML=(counts?'<div style="font-size:11px;color:#b45309;font-weight:600;margin-bottom:10px;padding:8px 12px;background:rgba(251,191,36,0.12);border-radius:10px;border-left:3px solid #f59e0b;">'+counts+'</div>':'')+
    list.map(function(i){
      var ans=closingAnswers[i.id];
      var isChiusura=i.station==='Chiusura';

      if(isChiusura){
        var checked=ans===true;
        var borderColor=checked?'#16a34a':'#cbd5e1';
        var bgColor=checked?'rgba(240,253,244,0.95)':'rgba(255,255,255,0.95)';
        var nameColor=checked?'#14532d':'#0f172a';
        var leftBorder=checked?'#16a34a':'#cbd5e1';
        var checkInner=checked?'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>':'';
        var checkBg=checked?'background:#16a34a;border-color:#16a34a;':'background:white;border-color:#cbd5e1;';
        return '<div onclick="setClosing(\''+i.id+'\','+(checked?'false':'true')+')" style="margin-bottom:8px;cursor:pointer;background:'+bgColor+';border-radius:16px;border-left:4px solid '+leftBorder+';box-shadow:0 1px 4px rgba(15,23,42,0.08);padding:12px 14px;display:flex;align-items:center;gap:12px;">' +
          '<div style="width:24px;height:24px;border-radius:50%;border:2px solid;'+checkBg+'display:flex;align-items:center;justify-content:center;flex-shrink:0;">'+checkInner+'</div>' +
          '<span style="font-size:15px;font-weight:600;color:'+nameColor+';flex:1;">'+i.name+'</span>' +
          '<span style="font-size:10px;color:#94a3b8;font-weight:500;text-transform:uppercase;letter-spacing:.04em;">Task</span>' +
        '</div>';
      }

      var accentColor = ans===true ? '#16a34a' : ans===false ? '#ef4444' : '#e2e8f0';
      var bgColor = ans===true ? 'rgba(240,253,244,0.95)' : ans===false ? 'rgba(254,242,242,0.95)' : 'rgba(255,255,255,0.95)';
      var nameColor = ans===true ? '#14532d' : ans===false ? '#991b1b' : '#0f172a';

      var badge = ans===true
        ? '<span style="font-size:10px;font-weight:700;color:#16a34a;background:rgba(22,163,74,0.1);padding:2px 6px;border-radius:6px;letter-spacing:.04em;">OK</span>'
        : ans===false
        ? '<span style="font-size:10px;font-weight:700;color:#ef4444;background:rgba(239,68,68,0.1);padding:2px 6px;border-radius:6px;letter-spacing:.04em;">'+tr('missing2')+'</span>'
        : '';

      var btnThere = ans===true
        ? 'background:#16a34a;color:white;border:none;'
        : 'background:white;color:#15803d;border:1.5px solid #16a34a;';

      var hasAlert = getAlertLevel(i.name);
      var btnMissing = ans===false
        ? 'background:#ef4444;color:white;border:none;'
        : hasAlert
        ? 'background:rgba(251,191,36,0.15);color:#92400e;border:1.5px solid rgba(234,179,8,0.5);'
        : 'background:white;color:#b91c1c;border:1.5px solid #fca5a5;';

      var alertWarning = hasAlert && ans!==false ? ' \u26a0\ufe0f' : '';

      // Mostra stazione produttrice se diversa da quella che controlla
      var producerBadge = '';
      if(i.prep_task_id){
        var pt=tasks[i.prep_task_id];
        if(pt && pt.category && pt.category!==i.station){
          producerBadge='<span style="font-size:9px;color:#6366f1;background:rgba(99,102,241,0.1);padding:1px 5px;border-radius:5px;margin-left:4px;">\u2192 '+pt.category.replace(' Station','')+'</span>';
        }
      }

      return '<div style="margin-bottom:8px;background:'+bgColor+';border-radius:16px;border-left:4px solid '+accentColor+';box-shadow:0 1px 4px rgba(15,23,42,0.08);">' +
        '<div style="padding:12px 14px 10px;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
            '<span style="font-size:15px;font-weight:600;color:'+nameColor+';">'+i.name+producerBadge+'</span>' +
            (badge ? '<div>'+badge+'</div>' : '<span style="font-size:10px;color:#94a3b8;">'+(i.station||'')+'</span>') +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
            '<button onclick="setClosing(\''+i.id+'\',true)" style="height:38px;border-radius:10px;font-size:13px;font-weight:700;'+btnThere+'cursor:pointer;white-space:nowrap;">'+tr('thereIs')+'</button>' +
            '<button onclick="setClosing(\''+i.id+'\',false)" style="height:38px;border-radius:10px;font-size:13px;font-weight:700;'+btnMissing+'cursor:pointer;white-space:nowrap;">'+tr('missing')+alertWarning+'</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
}

window.setClosing=async function(id,value){
  id=Number(id);
  if(value===false){
    var checkItem=closingItems.find(function(i){return i.id===id;});
    var proceed = await checkBeforeMissing(id, checkItem?checkItem.name:'');
    if(!proceed) return;
  }
  closingAnswers[id]=value;

  // Salva in closing_log
  var checkItem=closingItems.find(function(i){return i.id===id;});
  if(checkItem){
    await supa.from('closing_log').insert({
      check_id: id,
      user_name: user?user.name:'unknown',
      answer: value
    });

    // Se manca E ha prep_task_id → setta need_tomorrow=true sulla prep task produttrice
    if(value===false && checkItem.prep_task_id){
      await supa.from('prep_tasks').update({need_tomorrow:true}).eq('id',checkItem.prep_task_id);
      if(tasks[checkItem.prep_task_id]) tasks[checkItem.prep_task_id].need_tomorrow=true;
    }
    // Se c'e' → setta need_tomorrow=false sulla prep task produttrice
    if(value===true && checkItem.prep_task_id){
      await supa.from('prep_tasks').update({need_tomorrow:false}).eq('id',checkItem.prep_task_id);
      if(tasks[checkItem.prep_task_id]) tasks[checkItem.prep_task_id].need_tomorrow=false;
    }
  }

  renderS(); renderM(); renderHomeStations();
};

async function closeTurn(){
  var list=closingItems.filter(function(i){return station2==='All'||i.station===station2;});
  var forgotten=list.filter(function(i){return closingAnswers[i.id]===undefined;});
  if(forgotten.length>0){
    var t=document.createElement('div');
    t.className='fixed top-20 left-1/2 -translate-x-1/2 z-[70] bg-red-600 text-white text-sm px-5 py-3 rounded-2xl shadow-xl text-center max-w-[280px]';
    t.textContent=tr('answerAll');
    document.body.appendChild(t);
    setTimeout(function(){t.remove();},3000);
    return;
  }
  doCloseTurn();
}

async function doCloseTurn(){
  var missing=closingItems.filter(function(i){return closingAnswers[i.id]===false;});
  var missingList=missing.map(function(i){return i.name;}).join(', ');
  await supa.from('messages').insert({
    text: missingList
      ? '\uD83D\uDD12 '+tr("shiftClosed")+' '+user.name+'. '+tr("missing2")+': '+missingList+'.'
      : '\uD83D\uDD12 '+tr("shiftClosed")+' '+user.name+'. '+tr("allGood")+'.',
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

