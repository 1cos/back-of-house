// ── ADMIN PREP TASKS ──
// Gestione prep tasks: aggiungi, modifica, archivia, ripristina.

async function adminAdd(){ openPrepEditor(null); }
async function adminRename(id){ openPrepEditor(tasks[id]); }
async function adminDel(id){
  const choice = confirm('Archivia questa prep? (OK=Archivia, Annulla=Elimina definitivamente)');
  if(choice===null) return;
  if(choice){
    await supa.from('prep_tasks').update({archived:true,need_tomorrow:false}).eq('id',id);
  } else {
    if(!confirm('Eliminare definitivamente?')) return;
    await supa.from('prep_tasks').delete().eq('id',id);
  }
  location.reload();
}

async function showArchivedPreps(){
  const{data}=await supa.from('prep_tasks').select('*').eq('archived',true).order('name');
  if(!data||!data.length){alert('Nessuna prep archiviata');return}
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4';
  modal.innerHTML=`<div class="bg-white w-full max-w-lg rounded-3xl shadow-2xl max-h-[80vh] flex flex-col">
    <div class="p-4 border-b flex items-center justify-between"><h3 class="font-bold">📦 Prep Archiviate</h3><button onclick="this.closest('.fixed').remove()" class="text-slate-400">✕</button></div>
    <div class="p-4 overflow-auto space-y-2 flex-1">
      ${data.map(p=>`<div class="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
        <div><div class="font-medium text-sm">${p.name}</div><div class="text-xs text-slate-400">${p.category||''}</div></div>
        <button onclick="restorePrep('${p.id}')" class="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold">Riattiva</button>
      </div>`).join('')}
    </div>
  </div>`;
  document.body.appendChild(modal);
}

async function restorePrep(id){
  await supa.from('prep_tasks').update({archived:false}).eq('id',id);
  location.reload();
}
window.adminRename=adminRename; window.adminDel=adminDel;

const STATION_OPTIONS = ['Oven Station','Fresh Pasta Station','Pasta Station','Sauté Station','Saucier Station','Plating Station','Salad Station','Pastry Station','Tableside','Freezer'];

async function openPrepEditor(prep=null){
  const isNew = !prep;
  // Assicurati che le ricette siano caricate
  if(!window.SHOP_RECIPES || !window.SHOP_RECIPES.length){
    const {data:recs} = await supa.from('recipes').select('id,title').order('title');
    if(recs) window.SHOP_RECIPES = recs;
  }
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4';
  const currentRecipeId = prep ? (prep.recipe_id||null) : null;
  modal.innerHTML = `
    <div class="bg-white w-full max-w-lg rounded-3xl shadow-2xl max-h-[90vh] flex flex-col">
      <div class="p-4 border-b flex items-center justify-between">
        <h3 class="font-bold">${isNew?'Nuova Prep':'Modifica Prep'}</h3>
        <button onclick="this.closest('.fixed').remove()" class="text-slate-400 text-xl">✕</button>
      </div>
      <div class="p-4 overflow-auto space-y-3 text-sm flex-1">
        <div>
          <label class="text-xs font-semibold text-slate-500 mb-1 block">Nome preparazione</label>
          <input id="pepName" placeholder="es. Salsa Arrabbiata" class="w-full px-3 py-2.5 border rounded-xl" value="${prep?.name||''}">
        </div>
        <div>
          <label class="text-xs font-semibold text-slate-500 mb-1 block">Stazione</label>
          <select id="pepStation" class="w-full px-3 py-2.5 border rounded-xl bg-white">
            ${STATION_OPTIONS.map(s=>`<option ${(prep?.category||'Plating Station')===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="text-xs font-semibold text-slate-500 mb-1 block">Collega ricetta</label>
          <select id="pepRecipe" class="w-full px-3 py-2.5 border rounded-xl bg-white">
            <option value="">— nessuna ricetta —</option>
            ${(window.SHOP_RECIPES||[]).map(r=>`<option value="${r.id}" ${currentRecipeId==r.id?'selected':''}>${r.title}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="text-xs font-semibold text-slate-500 mb-1 block">Nota / Procedimento rapido</label>
          <textarea id="pepNote" class="w-full px-3 py-2.5 border rounded-xl h-28 resize-none" placeholder="Scrivi un procedimento rapido se non hai una ricetta collegata...">${prep?.note||''}</textarea>
          <p class="text-[10px] text-slate-400 mt-1">Se colleghi una ricetta, questa nota viene ignorata al tap.</p>
        </div>
        ${!isNew?`<div>
          <label class="text-xs font-semibold text-slate-500 mb-1 block">Durata attesa (giorni)</label>
          <input id="pepDuration" type="number" min="1" max="30" placeholder="es. 3" class="w-full px-3 py-2.5 border rounded-xl" value="${prep?.expected_duration_days||''}">
        </div>`:''}
        ${!isNew?`<div>
          <div class="flex items-center justify-between mb-2">
            <label class="text-xs font-semibold text-slate-500">Steps sequenziali</label>
            <button type="button" id="pepAddStep" class="text-xs font-semibold text-white bg-slate-800 px-3 py-1.5 rounded-lg">+ Aggiungi step</button>
          </div>
          <div id="pepStepsList" class="space-y-2"></div>
          <p class="text-[10px] text-slate-400 mt-1">Se aggiungi steps, la nota viene ignorata al tap. Gli steps sono sequenziali: lo step 2 si sblocca solo dopo il completamento dello step 1.</p>
        </div>`:''}
      </div>
      <div class="p-4 border-t flex gap-2">
        <button onclick="this.closest('.fixed').remove()" class="flex-1 py-2.5 border rounded-xl text-sm">Annulla</button>
        <button id="pepSave" class="flex-1 py-2.5 bg-slate-900 text-white rounded-xl font-semibold text-sm">Salva</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  // ── GESTIONE STEPS ──
  let pepSteps = []; // array locale step {id?, title, note, timer_minutes, sort_order}

  if(!isNew){
    // carica step esistenti
    const {data: existingSteps} = await supa.from('prep_steps')
      .select('*').eq('prep_task_id', prep.id).order('sort_order');
    pepSteps = (existingSteps||[]).map(s=>({...s}));
    renderPepSteps();

    modal.querySelector('#pepAddStep').onclick = () => {
      pepSteps.push({title:'', note:'', timer_minutes:null, sort_order: pepSteps.length});
      renderPepSteps();
    };
  }

  function renderPepSteps(){
    const list = modal.querySelector('#pepStepsList');
    if(!list) return;
    if(!pepSteps.length){
      list.innerHTML = '<div class="text-xs text-slate-400 text-center py-2">Nessuno step — la prep usa ricetta o nota.</div>';
      return;
    }
    list.innerHTML = pepSteps.map((s,idx)=>`
      <div class="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2" data-step-idx="${idx}">
        <div class="flex items-center gap-2">
          <span class="text-xs font-bold text-slate-400 w-5">${idx+1}.</span>
          <input class="step-title flex-1 px-2 py-1.5 border rounded-lg text-sm" placeholder="Titolo step (es. Scongela i calamari)" value="${s.title||''}">
          <button type="button" class="step-del text-slate-300 hover:text-red-400 text-lg font-bold leading-none">×</button>
        </div>
        <textarea class="step-note w-full px-2 py-1.5 border rounded-lg text-xs resize-none h-14" placeholder="Nota/spiegazione (opzionale — es. In acqua fredda, pitcher da 5L)">${s.note||''}</textarea>
        <div class="flex items-center gap-2">
          <span class="text-xs text-slate-400">⏱ Timer:</span>
          <input class="step-timer w-20 px-2 py-1 border rounded-lg text-sm text-center" type="number" min="1" max="240" placeholder="min" value="${s.timer_minutes||''}">
          <span class="text-xs text-slate-400">minuti (vuoto = nessun timer)</span>
        </div>
      </div>`).join('');

    // bind events
    list.querySelectorAll('.step-del').forEach((btn,idx)=>{
      btn.onclick = ()=>{ pepSteps.splice(idx,1); renderPepSteps(); };
    });
    list.querySelectorAll('.step-title').forEach((inp,idx)=>{
      inp.oninput = ()=>{ pepSteps[idx].title = inp.value; };
    });
    list.querySelectorAll('.step-note').forEach((inp,idx)=>{
      inp.oninput = ()=>{ pepSteps[idx].note = inp.value; };
    });
    list.querySelectorAll('.step-timer').forEach((inp,idx)=>{
      inp.oninput = ()=>{ pepSteps[idx].timer_minutes = inp.value ? parseInt(inp.value) : null; };
    });
  }

  modal.querySelector('#pepSave').onclick = async() => {
    const name = modal.querySelector('#pepName').value.trim();
    if(!name){ alert('Nome obbligatorio'); return; }
    const category = modal.querySelector('#pepStation').value;
    const recipe_id = modal.querySelector('#pepRecipe').value || null;
    const note = modal.querySelector('#pepNote').value.trim() || null;
    const duration = modal.querySelector('#pepDuration')?.value ? parseInt(modal.querySelector('#pepDuration').value) : null;
    const btn = modal.querySelector('#pepSave');
    btn.disabled = true; btn.textContent = 'Salvataggio...';
    try{
      if(isNew){
        const{error} = await supa.from('prep_tasks').insert({name, category, note, recipe_id, need_tomorrow: false}).select().single();
        if(error) throw error;
      } else {
        const updates = {name, category, note, recipe_id};
        if(duration) updates.expected_duration_days = duration;
        const{error} = await supa.from('prep_tasks').update(updates).eq('id', prep.id);
        if(error) throw error;

        // salva steps: elimina tutti e reinserisce (semplice e sicuro)
        if(pepSteps.length > 0){
          // valida che tutti gli step abbiano un titolo
          const invalid = pepSteps.find(s=>!s.title.trim());
          if(invalid){ alert('Ogni step deve avere un titolo.'); btn.disabled=false; btn.textContent='Salva'; return; }
          await supa.from('prep_steps').delete().eq('prep_task_id', prep.id);
          const toInsert = pepSteps.map((s,i)=>({
            prep_task_id: prep.id,
            sort_order: i,
            title: s.title.trim(),
            note: s.note?.trim()||null,
            timer_minutes: s.timer_minutes||null
          }));
          const {error:se} = await supa.from('prep_steps').insert(toInsert);
          if(se) throw se;
        } else if(!isNew){
          // nessun step — elimina eventuali step precedenti
          await supa.from('prep_steps').delete().eq('prep_task_id', prep.id);
        }
      }
      modal.remove();
      await init();
      if(typeof renderRecipes === 'function') renderRecipes();
    }catch(e){
      alert('Errore: '+e.message);
      btn.disabled=false; btn.textContent='Salva';
    }
  };
}
