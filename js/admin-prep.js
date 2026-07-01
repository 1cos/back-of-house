// ── ADMIN PREP TASKS ──
// Gestione prep tasks: aggiungi, modifica, archivia, ripristina.

async function adminAdd(){ openPrepEditor(null); }
async function adminRename(id){ openPrepEditor(tasks[id]); }
async function adminDel(id){
  const choice = confirm(tr('adminArchiveConfirm'));
  if(choice===null) return;
  if(choice){
    await supa.from('prep_tasks').update({archived:true,need_tomorrow:false}).eq('id',id);
    await supa.from('closing_checks').update({archived:true}).eq('prep_task_id',id);
  } else {
    if(!confirm('Eliminare definitivamente?')) return;
    await supa.from('closing_checks').delete().eq('prep_task_id',id);
    await supa.from('prep_tasks').delete().eq('id',id);
  }
  // Rimuovi dalla memoria locale e ri-renderizza — niente reload che crashia su iOS
  delete tasks[id];
  items = items.filter(i=>String(i.id)!==String(id));
  renderM();
  if(typeof renderS==='function') renderS();
  if(typeof renderHomeStations==='function') renderHomeStations();
  if(typeof renderFocusFeed==='function') renderFocusFeed();
}

async function showArchivedPreps(){
  const{data}=await supa.from('prep_tasks').select('*').eq('archived',true).order('name');
  if(!data||!data.length){alert(tr('adminNoArchived'));return}
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
  await supa.from('closing_checks').update({archived:false}).eq('prep_task_id',id);
  // Ricarica lista completa e ri-renderizza
  await init();
}
window.adminRename=adminRename; window.adminDel=adminDel;

const STATION_OPTIONS = ['Oven Station','Fresh Pasta Station','Pasta Station','Sauté Station','Saucier Station','Plating Station','Salad Station','Pastry Station','Table Side','Freezer','Manager Station'];

async function openPrepEditor(prep=null){
  const isNew = !prep;
  if(!window.SHOP_RECIPES || !window.SHOP_RECIPES.length){
    const {data:recs} = await supa.from('recipes').select('id,title').order('title');
    if(recs) window.SHOP_RECIPES = recs;
  }

  // Carica closing_checks esistenti per questa prep (stazioni che controllano)
  let existingCheckStations = [];
  if(!isNew && prep.id){
    const {data:cc} = await supa.from('closing_checks')
      .select('station')
      .eq('prep_task_id', prep.id)
      .eq('archived', false);
    existingCheckStations = (cc||[]).map(r=>r.station);
  }

  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4';
  const currentRecipeId = prep ? (prep.recipe_id||null) : null;

  const checkStationsHTML = STATION_OPTIONS.map(s=>{
    const checked = existingCheckStations.includes(s) ? 'checked' : '';
    return `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;">
      <input type="checkbox" class="pepCheckStation" value="${s}" ${checked}
        style="width:16px;height:16px;accent-color:#059669;cursor:pointer;">
      <span style="font-size:13px;color:#1e293b;">${s.replace(' Station','')}</span>
    </label>`;
  }).join('');

  modal.innerHTML = `
    <div class="bg-white w-full max-w-lg rounded-3xl shadow-2xl max-h-[90vh] flex flex-col">
      <div class="p-4 border-b flex items-center justify-between">
        <h3 class="font-bold">${isNew?tr('adminNewPrep'):tr('adminEditPrep')}</h3>
        <button onclick="this.closest('.fixed').remove()" class="text-slate-400 text-xl">✕</button>
      </div>
      <div class="p-4 overflow-auto space-y-3 text-sm flex-1">
        <div>
          <label class="text-xs font-semibold text-slate-500 mb-1 block">Nome preparazione</label>
          <input id="pepName" placeholder="es. Salsa Arrabbiata" class="w-full px-3 py-2.5 border rounded-xl" value="${prep?.name||''}">
        </div>
        <div>
          <label class="text-xs font-semibold text-slate-500 mb-1 block">🍳 Stazione che produce</label>
          <select id="pepStation" class="w-full px-3 py-2.5 border rounded-xl bg-white">
            ${STATION_OPTIONS.map(s=>`<option ${(prep?.category||'Oven Station')===s?'selected':''}>${s}</option>`).join('')}
          </select>
          <p class="text-[10px] text-slate-400 mt-1">Chi prepara questo item la mattina.</p>
        </div>
        <div>
          <label class="text-xs font-semibold text-slate-500 mb-1 block">👁 Stazioni che controllano la sera</label>
          <div style="border:1px solid #e2e8f0;border-radius:12px;padding:8px 12px;max-height:180px;overflow-y:auto;">
            ${checkStationsHTML}
          </div>
          <p class="text-[10px] text-slate-400 mt-1">Seleziona una o più stazioni che devono verificare questo item nel check serale.</p>
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
          <textarea id="pepNote" class="w-full px-3 py-2.5 border rounded-xl h-24 resize-none" placeholder="${tr('adminProcedurePlaceholder')}">${prep?.note||''}</textarea>
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
          <p class="text-[10px] text-slate-400 mt-1">Se aggiungi steps, la nota viene ignorata al tap. Gli steps sono sequenziali: step 2 si sblocca solo dopo step 1.</p>
        </div>`:''}
      </div>
        ${!isNew?`<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:16px;margin-top:4px;">
          <div style="font-size:11px;font-weight:700;color:#64748b;letter-spacing:0.05em;margin-bottom:12px;">🤖 BOT CONFIG</div>
          <div style="display:grid;gap:10px;">
            <div>
              <label style="font-size:11px;font-weight:600;color:#475569;display:block;margin-bottom:4px;">Nel frigo conto...</label>
              <select id="pepUnit" style="width:100%;padding:8px 12px;border:1px solid #e2e8f0;border-radius:10px;background:white;font-size:13px;">
                <option value="g" ${(prep?.unit||'g')==='g'?'selected':''}>grammi (g)</option>
                <option value="pezzi" ${prep?.unit==='pezzi'?'selected':''}>pezzi</option>
                <option value="cup" ${prep?.unit==='cup'?'selected':''}>cup</option>
                <option value="buste" ${prep?.unit==='buste'?'selected':''}>buste</option>
                <option value="nests" ${prep?.unit==='nests'?'selected':''}>nests</option>
                <option value="cartocci" ${prep?.unit==='cartocci'?'selected':''}>cartocci</option>
                <option value="contenitori" ${prep?.unit==='contenitori'?'selected':''}>contenitori</option>
                <option value="pz" ${prep?.unit==='pz'?'selected':''}>pz</option>
              </select>
            </div>
            <div id="pepConvRow" style="${(prep?.unit&&prep.unit!=='g')?'':'display:none'}">
              <label style="font-size:11px;font-weight:600;color:#475569;display:block;margin-bottom:4px;">1 <span id="pepUnitLabel">${prep?.unit||''}</span> pesa (grammi)</label>
              <input id="pepConversion" type="number" min="1" placeholder="es. 80" style="width:100%;padding:8px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;" value="">
              <p style="font-size:10px;color:#94a3b8;margin-top:3px;">Lascia vuoto se non serve conversione (es. per i grammi).</p>
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;color:#475569;display:block;margin-bottom:4px;">Dura... (giorni)</label>
              <input id="pepShelf" type="number" min="1" max="365" placeholder="es. 3" style="width:100%;padding:8px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;" value="">
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;color:#475569;display:block;margin-bottom:4px;">Prepara quando scende sotto... (giorni coperti)</label>
              <input id="pepMinCover" type="number" min="1" max="14" placeholder="2" style="width:100%;padding:8px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;" value="${prep?.min_cover_days??2}">
              <p style="font-size:10px;color:#94a3b8;margin-top:3px;">Default 2 = prepara solo se non arrivi a dopodomani. Cibo fresco: 1-2. Prep in anticipo (ragu, brisket): 4-5.</p>
            </div>
            ${prep?.suggested_note ? `<div>
              <label style="font-size:11px;font-weight:600;color:#475569;display:block;margin-bottom:4px;">Il bot dice...</label>
              <div style="padding:8px 12px;background:white;border:1px solid #e2e8f0;border-radius:10px;font-size:12px;color:#334155;">
                ${(prep.suggested_note||'').split('|')[1]||'—'}
              </div>
            </div>` : ''}
          </div>
        </div>`:''}
      <div class="p-4 border-t flex gap-2">
        <button onclick="this.closest('.fixed').remove()" class="flex-1 py-2.5 border rounded-xl text-sm">Annulla</button>
        <button id="pepSave" class="flex-1 py-2.5 bg-slate-900 text-white rounded-xl font-semibold text-sm">Salva</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  // ── BOT CONFIG — show/hide conversione + carica shelf_life dalla ricetta ──
  if(!isNew && prep) {
    // Carica shelf_life dalla ricetta collegata
    if(prep.recipe_id) {
      const {data: recData} = await supa.from('recipes').select('shelf_life_days,serving_weight_g,serving_unit').eq('id', prep.recipe_id).single();
      if(recData) {
        const shelfInput = modal.querySelector('#pepShelf');
        if(shelfInput && recData.shelf_life_days) shelfInput.value = recData.shelf_life_days;
        const convInput = modal.querySelector('#pepConversion');
        if(convInput && recData.serving_weight_g) convInput.value = recData.serving_weight_g;
      }
    }
    // Show/hide riga conversione quando cambia unità
    const pepUnitSel = modal.querySelector('#pepUnit');
    const pepConvRow = modal.querySelector('#pepConvRow');
    const pepUnitLabel = modal.querySelector('#pepUnitLabel');
    if(pepUnitSel && pepConvRow) {
      pepUnitSel.onchange = () => {
        const u = pepUnitSel.value;
        pepConvRow.style.display = (u && u !== 'g') ? '' : 'none';
        if(pepUnitLabel) pepUnitLabel.textContent = u;
      };
    }
  }

  // ── GESTIONE STEPS ──
  let pepSteps = [];
  if(!isNew){
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
      list.innerHTML = '<div class="text-xs text-slate-400 text-center py-2">'+tr('adminNoSteps')+'</div>';
      return;
    }
    list.innerHTML = pepSteps.map((s,idx)=>`
      <div class="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
        <div class="flex items-center gap-2">
          <span class="text-xs font-bold text-slate-400 w-5">${idx+1}.</span>
          <input class="step-title flex-1 px-2 py-1.5 border rounded-lg text-sm" placeholder="es. Scongela i calamari" value="${s.title||''}">
          <button type="button" class="step-del text-slate-300 text-lg font-bold leading-none">×</button>
        </div>
        <textarea class="step-note w-full px-2 py-1.5 border rounded-lg text-xs resize-none h-14" placeholder="${tr('adminStepNotePlaceholder')}">${s.note||''}</textarea>
        <div class="flex items-center gap-2">
          <span class="text-xs text-slate-400">⏱ Timer:</span>
          <input class="step-timer w-20 px-2 py-1 border rounded-lg text-sm text-center" type="number" min="1" max="240" placeholder="min" value="${s.timer_minutes||''}">
          <span class="text-xs text-slate-400">minuti (vuoto = nessun timer)</span>
        </div>
      </div>`).join('');
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

    // Stazioni check selezionate
    const selectedCheckStations = Array.from(modal.querySelectorAll('.pepCheckStation:checked')).map(cb=>cb.value);

    const btn = modal.querySelector('#pepSave');
    btn.disabled = true; btn.textContent = 'Salvataggio...';
    try{
      let prepId = prep?.id;
      if(isNew){
        const{data:newPrep, error} = await supa.from('prep_tasks')
          .insert({name, category, note, recipe_id, need_tomorrow: false, unit: modal.querySelector('#pepUnit')?.value || null})
          .select().single();
        if(error) throw error;
        prepId = newPrep.id;
      } else {
        const pepUnit = modal.querySelector('#pepUnit')?.value || null;
        const pepShelf = modal.querySelector('#pepShelf')?.value ? parseInt(modal.querySelector('#pepShelf').value) : null;
        const updates = {name, category, note, recipe_id};
        if(duration) updates.expected_duration_days = duration;
        if(pepUnit) updates.unit = pepUnit;
        const pepMinCoverVal = modal.querySelector('#pepMinCover')?.value;
        if(pepMinCoverVal) updates.min_cover_days = parseInt(pepMinCoverVal);
        // Aggiorna shelf_life e serving_weight_g sulla ricetta collegata se esiste
        const pepShelfVal = modal.querySelector('#pepShelf')?.value;
        const pepConvVal = modal.querySelector('#pepConversion')?.value;
        if(recipe_id && (pepShelfVal || pepConvVal)) {
          const recUpdates = {};
          if(pepShelfVal) recUpdates.shelf_life_days = parseInt(pepShelfVal);
          if(pepConvVal) recUpdates.serving_weight_g = parseFloat(pepConvVal);
          await supa.from('recipes').update(recUpdates).eq('id', recipe_id);
        }
        const{error} = await supa.from('prep_tasks').update(updates).eq('id', prep.id);
        if(error) throw error;

        // Salva steps: elimina tutti e reinserisce
        await supa.from('prep_steps').delete().eq('prep_task_id', prep.id);
        if(pepSteps.length > 0){
          const invalid = pepSteps.find(s=>!s.title.trim());
          if(invalid){ alert('Ogni step deve avere un titolo.'); btn.disabled=false; btn.textContent=tr('saveBtn'); return; }
          const toInsert = pepSteps.map((s,i)=>({
            prep_task_id: prep.id,
            sort_order: i,
            title: s.title.trim(),
            note: s.note?.trim()||null,
            timer_minutes: s.timer_minutes||null
          }));
          const{error:se} = await supa.from('prep_steps').insert(toInsert);
          if(se) throw se;
        }
      }

      // Sincronizza closing_checks:
      // 1. Rimuovi le stazioni deselezionate
      if(!isNew){
        const toRemove = existingCheckStations.filter(s=>!selectedCheckStations.includes(s));
        for(const s of toRemove){
          await supa.from('closing_checks')
            .update({archived:true})
            .eq('prep_task_id', prepId)
            .eq('station', s);
        }
      }
      // 2. Aggiungi le stazioni nuove
      const toAdd = selectedCheckStations.filter(s=>!existingCheckStations.includes(s));
      for(const s of toAdd){
        await supa.from('closing_checks').insert({
          name, station: s, prep_task_id: prepId, archived: false
        });
      }
      // 3. Aggiorna nome se cambiato (su tutte le closing_checks collegate)
      if(!isNew && name !== prep.name){
        await supa.from('closing_checks')
          .update({name})
          .eq('prep_task_id', prepId)
          .eq('archived', false);
      }

      modal.remove();
      await init();
      if(typeof renderRecipes === 'function') renderRecipes();
    }catch(e){
      alert(tr('errorPrefix') +e.message);
      btn.disabled=false; btn.textContent=tr('saveBtn');
    }
  };
}


