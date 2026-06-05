// ── RICETTE ──
async function openRecipeForItem(itemId){
  const task = tasks[itemId];
  // prima controlla recipe_id su prep_tasks
  if(task?.recipe_id){
    const{data:recipe}=await supa.from('recipes').select('*').eq('id',task.recipe_id).maybeSingle();
    if(recipe){showRecipeSheet(recipe);return}
  }
  // fallback a recipeLinks legacy
  const linked=recipeLinks[itemId];
  if(linked){
    const rec=SHOP_RECIPES.find(r=>r.id==linked||r.title===linked);
    if(rec){showRecipeSheet(rec);return}
  }
  // fallback a nota
  if(task?.note){
    showNoteSheet(task.name, task.note);
    return;
  }
  // niente
  if(isAdmin()){
    if(confirm('Nessuna ricetta o nota. Vuoi aggiungere una nota adesso?')) openPrepEditor(task);
  }
}

function showNoteSheet(name, note){
  const sheet=document.createElement('div');
  sheet.className='fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end';
  sheet.innerHTML=`<div class="bg-white w-full max-w-md mx-auto rounded-t-[28px] p-5 max-h-[70vh] overflow-auto" style="animation:slideUp .25s ease">
    <div class="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4"></div>
    <h3 class="text-xl font-bold mb-3">📝 ${name}</h3>
    <div class="bg-slate-50 rounded-2xl p-4 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">${note}</div>
    <button onclick="this.closest('.fixed').remove()" class="w-full mt-4 py-3 bg-slate-900 text-white rounded-xl">Chiudi</button>
  </div>`;
  sheet.onclick=e=>{if(e.target===sheet)sheet.remove()};
  document.body.appendChild(sheet);
}

async function openRecipeByData(idx){
  let rec={...SHOP_RECIPES[idx]};
  async function groqTr(text){
    if(!text)return '';
    const r=await fetch(`${SUPABASE_URL}/functions/v1/ai-translate`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${SUPABASE_ANON_KEY}`},body:JSON.stringify({text,targetLang:user.lang})});
    const j=await r.json();return j.translated||text;
  }
  if(user?.lang&&user.lang!=='it'&&rec.id){
    let{data:tr}=await supa.from('recipe_translations').select('*').eq('recipe_id',rec.id).eq('lang',user.lang).maybeSingle();
    if(!tr){
      try{
        const newTr={recipe_id:rec.id,lang:user.lang,title:rec.title,procedure:await groqTr(rec.procedure||''),equipment:await groqTr(rec.equipment||''),ingredients:await Promise.all((rec.ingredients||[]).map(async i=>({...i,name:await groqTr(i.name),comment:i.comment?await groqTr(i.comment):''}))),};
        await supa.from('recipe_translations').upsert(newTr);tr=newTr;
      }catch(e){}
    }
    if(tr){rec.title=tr.title||rec.title;rec.procedure=tr.procedure;rec.equipment=tr.equipment;rec.ingredients=tr.ingredients;}
  }
  showRecipeSheet(rec);
}

function showRecipeSheet(rec){
  const sheet=document.createElement('div');
  sheet.className='fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end';
  const ings=(rec.ingredients||[]).map(i=>`<li>• <b>${i.qty||''}</b> ${i.name||''} ${i.comment?`<span class="text-slate-500">(${i.comment})</span>`:''}</li>`).join('');
  sheet.innerHTML=`<div class="bg-white w-full max-w-md mx-auto rounded-t-[28px] p-5 max-h-[80vh] overflow-auto" style="animation:slideUp .25s ease">
    <div class="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4"></div>
    <h3 class="text-xl font-bold mb-1">${rec.title||rec.name||''}</h3>
    <p class="text-xs text-slate-500 mb-3">${rec.category||''} • ${rec.yield_text||rec.yield||''}${(rec.prep_time_minutes||rec.prep_time)?' • '+(rec.prep_time_minutes||rec.prep_time)+' min':''}</p>
    ${rec.image_url?`<img src="${rec.image_url}" class="w-full h-40 object-cover rounded-xl mb-3">`:''}
    ${rec.photo_url?`<img src="${rec.photo_url}" class="w-full h-40 object-cover rounded-xl mb-3">`:''}
    ${ings?`<p class="text-sm font-semibold mb-1">Ingredienti</p><ul class="text-sm space-y-1 mb-3">${ings}</ul>`:''}
    ${rec.equipment?`<p class="text-sm font-semibold mb-1">Attrezzatura</p><p class="text-xs text-slate-600 mb-3 whitespace-pre-wrap">${rec.equipment}</p>`:''}
    ${rec.procedure?`<p class="text-sm font-semibold mb-1">Procedimento</p><p class="text-sm text-slate-700 whitespace-pre-wrap mb-4">${rec.procedure}</p>`:''}
    ${rec.note?`<p class="text-xs text-amber-700 bg-amber-50 p-2 rounded-lg mb-3">${rec.note}</p>`:''}
    <button onclick="this.closest('.fixed').remove()" class="w-full mt-2 py-3 bg-slate-900 text-white rounded-xl">Chiudi</button>
  </div>`;
  sheet.onclick=e=>{if(e.target===sheet)sheet.remove()};
  document.body.appendChild(sheet);
}

function renderRecipes(){
  const cats=['All'].concat([...new Set(SHOP_RECIPES.flatMap(r=>(r.category||'').split('|').map(s=>s.trim()).filter(Boolean)))]);
  document.getElementById('recipeCats').innerHTML=cats.map(c=>`<button onclick="recipeCat='${c.replace(/'/g,"\\'")}';renderRecipes()" class="px-3 py-1.5 rounded-full border text-xs whitespace-nowrap ${recipeCat===c?'bg-slate-900 text-white':'bg-white'}">${c}</button>`).join('');
  const search=(document.getElementById('recipeSearch')?.value||'').toLowerCase();
  const filtered=SHOP_RECIPES.filter(r=>(recipeCat==='All'||(r.category||'').includes(recipeCat))&&(!search||r.title.toLowerCase().includes(search)||(r.category||'').toLowerCase().includes(search)));
  document.getElementById('recipeGrid').innerHTML=filtered.map((r,idx)=>{
    const realIdx=SHOP_RECIPES.indexOf(r);
    return `<div class="bg-white p-3 rounded-2xl border shadow-sm cursor-pointer active:scale-[0.98] transition" onclick="openRecipeByData(${realIdx})">
      <div class="font-semibold text-[15px] leading-tight mb-1">${r.title}</div>
      <div class="text-xs text-slate-500">${r.category||'Generale'} • ${r.yield_text||r.yield||'1 porzione'}${(r.prep_time_minutes||r.prep_time)?' • '+(r.prep_time_minutes||r.prep_time)+'m':''}</div>
      ${isAdmin()?`<div class="flex gap-1 mt-2" onclick="event.stopPropagation()"><button onclick="openRecipeEditor(SHOP_RECIPES[${realIdx}])" class="px-2 py-1 bg-amber-500 text-white rounded-lg text-[10px]">Modifica</button><button onclick="linkRecipeToItem('${r.title.replace(/'/g,"\\'")}')" class="px-2 py-1 bg-emerald-600 text-white rounded-lg text-[10px]">Collega</button></div>`:''}
    </div>`;
  }).join('');
}

function openRecipeManager(){
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4';
  modal.innerHTML=`<div class="bg-white w-full max-w-lg rounded-3xl shadow-2xl max-h-[85vh] flex flex-col">
    <div class="p-4 border-b flex items-center justify-between"><h3 class="font-bold text-lg">Collega Ricette</h3><button onclick="this.closest('.fixed').remove()" class="text-slate-400">✕</button></div>
    <div class="p-4 overflow-auto flex-1">
      <p class="text-xs text-slate-500 mb-3">Abbina ogni prep a una ricetta.</p>
      <div id="linkList" class="space-y-2"></div>
      <button id="newRecipeBtn" class="mt-4 w-full py-2.5 bg-emerald-600 text-white rounded-xl font-semibold text-sm">+ Crea Nuova Ricetta</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  const list=document.getElementById('linkList');
  items.forEach(it=>{
    const sel=document.createElement('div');
    sel.className='flex items-center gap-2 p-2 bg-slate-50 rounded-xl';
    sel.innerHTML=`<div class="flex-1 text-sm font-medium">${it.name}</div><select data-id="${it.id}" class="text-xs border rounded-lg px-2 py-1.5 bg-white max-w-[180px]"><option value="">— nessuna —</option>${SHOP_RECIPES.map(r=>`<option ${recipeLinks[it.id]===r.title?'selected':''}>${r.title}</option>`).join('')}</select>`;
    list.appendChild(sel);
  });
  list.querySelectorAll('select').forEach(s=>s.onchange=e=>{recipeLinks[e.target.dataset.id]=e.target.value;localStorage.setItem('recipeLinks',JSON.stringify(recipeLinks))});
  document.getElementById('newRecipeBtn').onclick=()=>openRecipeEditor();
}

function openRecipeEditor(rec=null){
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4';
  modal.innerHTML=`<div class="bg-white w-full max-w-lg rounded-3xl shadow-2xl max-h-[90vh] flex flex-col">
    <div class="p-4 border-b"><h3 class="font-bold">${rec?'Modifica':'Nuova'} Ricetta</h3></div>
    <div class="p-4 overflow-auto space-y-3 text-sm">
      <input id="rTitle" placeholder="Titolo" class="w-full px-3 py-2 border rounded-xl" value="${rec?.title||''}">
      <input id="rImg" placeholder="URL foto" class="w-full px-3 py-2 border rounded-xl" value="${rec?.image_url||''}">
      <div class="grid grid-cols-2 gap-2"><input id="rCat" placeholder="Categoria" class="px-3 py-2 border rounded-xl" value="${rec?.category||''}"><input id="rYield" placeholder="Resa" class="px-3 py-2 border rounded-xl" value="${rec?.yield_text||rec?.yield||''}"></div>
      <input id="rTime" type="number" placeholder="Tempo min" class="w-full px-3 py-2 border rounded-xl" value="${rec?.prep_time_minutes||rec?.prep_time||''}">
      <div><div class="font-semibold mb-1">Ingredienti</div><div id="ingList" class="space-y-1"></div><button id="addIng" class="text-xs text-emerald-600 mt-1">+ ingrediente</button></div>
      <div><div class="font-semibold mb-1">Attrezzatura</div><textarea id="rEquip" class="w-full px-3 py-2 border rounded-xl h-16">${rec?.equipment||''}</textarea></div>
      <div><div class="font-semibold mb-1">Procedimento</div><textarea id="rProc" class="w-full px-3 py-2 border rounded-xl h-32">${rec?.procedure||''}</textarea></div>
    </div>
    <div class="p-3 border-t flex gap-2"><button onclick="this.closest('.fixed').remove()" class="flex-1 py-2.5 border rounded-xl">Annulla</button><button id="saveR" class="flex-1 py-2.5 bg-slate-900 text-white rounded-xl font-semibold">Salva</button></div>
  </div>`;
  document.body.appendChild(modal);
  const ingList=modal.querySelector('#ingList');
  function addRow(d={qty:'',name:'',comment:''}){
    const row=document.createElement('div');
    row.className='grid grid-cols-[80px_1fr_1fr_auto] gap-1';
    row.innerHTML=`<input placeholder="60 gr" class="px-2 py-1.5 border rounded text-xs" value="${d.qty}"><input placeholder="ingrediente" class="px-2 py-1.5 border rounded text-xs" value="${d.name}"><input placeholder="nota" class="px-2 py-1.5 border rounded text-xs" value="${d.comment}"><button class="text-red-500">✕</button>`;
    row.querySelector('button').onclick=()=>row.remove();
    ingList.appendChild(row);
  }
  (rec?.ingredients||[{},{},{}]).forEach(addRow);
  modal.querySelector('#addIng').onclick=()=>addRow();
  modal.querySelector('#saveR').onclick=async()=>{
    const t=modal.querySelector('#rTitle').value.trim();
    if(!t){alert('Nome obbligatorio');return}
    const newRec={title:t,category:modal.querySelector('#rCat').value,yield_text:modal.querySelector('#rYield').value,prep_time_minutes:parseInt(modal.querySelector('#rTime').value)||null,image_url:modal.querySelector('#rImg').value,equipment:modal.querySelector('#rEquip').value,procedure:modal.querySelector('#rProc').value,ingredients:[...ingList.children].map(r=>({qty:r.children[0].value,name:r.children[1].value,comment:r.children[2].value})).filter(i=>i.name)};
    try{
      if(rec?.id){await supa.from('recipes').update(newRec).eq('id',rec.id)}else{await supa.from('recipes').insert(newRec)}
      modal.remove();await init();renderRecipes();
    }catch(e){alert('Errore: '+e.message)}
  };
}

function linkRecipeToItem(title){
  const name=prompt('Collega "'+title+'" a quale item prep?\n'+items.map(i=>i.name).join(', '));
  if(!name)return;
  const it=items.find(i=>i.name.toLowerCase()===name.toLowerCase());
  if(it){recipeLinks[it.id]=title;alert('Collegato a '+it.name);}
  else alert('Item non trovato');
}


// ── TRADUZIONE NOMI PREP (tap) ──
async function showTranslation(name, el){
  if(!user||user.lang==='it') return;
  // se c'è già un tooltip lo rimuovo
  const existing = el.querySelector('.tr-tooltip');
  if(existing){existing.remove();return;}
  const tooltip = document.createElement('span');
  tooltip.className='tr-tooltip text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full ml-1';
  tooltip.textContent='...';
  el.appendChild(tooltip);
  try{
    const r = await fetch(`${SUPABASE_URL}/functions/v1/ai-translate`,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${SUPABASE_ANON_KEY}`},
      body: JSON.stringify({text:name, targetLang:user.lang})
    });
    const j = await r.json();
    tooltip.textContent = j.translated || name;
    setTimeout(()=>tooltip.remove(), 4000);
  }catch(e){ tooltip.remove(); }
}

