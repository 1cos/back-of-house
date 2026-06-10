// ── RICETTE ──────────────────────────────────────────────────

async function openRecipeForItem(itemId){
  const task = tasks[itemId];
  if(task?.recipe_id){
    const{data:recipe} = await supa.from('recipes').select('*').eq('id',task.recipe_id).maybeSingle();
    if(recipe){ showRecipeSheet(recipe); return; }
  }
  const linked = recipeLinks[itemId];
  if(linked){
    const rec = SHOP_RECIPES.find(r=>r.id==linked||r.title===linked);
    if(rec){
      // fetch fresh from DB
      const {data:fresh} = await supa.from('recipes').select('*').eq('id',rec.id).maybeSingle();
      showRecipeSheet(fresh||rec);
      return;
    }
  }
  if(task?.note){ showNoteSheet(task.name,task.note); return; }
  if(isAdmin()){
    if(confirm('Nessuna ricetta o nota. Vuoi aggiungere una nota adesso?')) openPrepEditor(task);
  }
}

function showNoteSheet(name, note){
  const sheet = document.createElement('div');
  sheet.className = 'fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end';
  sheet.innerHTML = `<div class="bg-white w-full max-w-md mx-auto rounded-t-[28px] p-5 max-h-[70vh] overflow-auto" style="animation:slideUp .25s ease">
    <div class="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4"></div>
    <h3 class="text-xl font-bold mb-3">📝 ${name}</h3>
    <div class="bg-slate-50 rounded-2xl p-4 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">${note}</div>
    <button onclick="this.closest('.fixed').remove()" class="w-full mt-4 py-3 bg-slate-900 text-white rounded-xl">${tr("close")}</button>
  </div>`;
  sheet.onclick = e=>{ if(e.target===sheet) sheet.remove(); };
  document.body.appendChild(sheet);
}

async function openRecipeByData(idx){
  // Always fetch fresh from DB — never use stale SHOP_RECIPES copy
  const stale = SHOP_RECIPES[idx];
  if(!stale?.id){
    // No id — no DB record, show stale directly
    showRecipeSheet(stale);
    return;
  }

  const {data:fresh} = await supa.from('recipes').select('*').eq('id',stale.id).maybeSingle();
  const rec = fresh || stale;

  // Translation: procedure and equipment only — NEVER ingredient names
  // ingredient names are canonical DB values used for matching/food cost
  if(user?.lang && user.lang!=='it' && rec.id){
    let {data:translation} = await supa
      .from('recipe_translations')
      .select('title,procedure,equipment')  // intentionally NOT selecting ingredients
      .eq('recipe_id', rec.id)
      .eq('lang', user.lang)
      .maybeSingle();

    if(!translation){
      // Generate translation for procedure/equipment only
      try{
        const translatedProcedure = rec.procedure
          ? await groqTranslate(rec.procedure, user.lang)
          : '';
        const translatedEquipment = rec.equipment
          ? await groqTranslate(rec.equipment, user.lang)
          : '';
        const translatedTitle = rec.title
          ? await groqTranslate(rec.title, user.lang)
          : rec.title;

        const newTr = {
          recipe_id: rec.id,
          lang:      user.lang,
          title:     translatedTitle,
          procedure: translatedProcedure,
          equipment: translatedEquipment,
          // ingredients: intentionally omitted — never store translated ingredient names
        };
        await supa.from('recipe_translations').upsert(newTr);
        translation = newTr;
      }catch(e){
        // Translation failed — use original
      }
    }

    if(translation){
      // Apply translated procedure/equipment/title only
      // ingredients ALWAYS come from the fresh DB record — never from translation
      rec.title     = translation.title     || rec.title;
      rec.procedure = translation.procedure || rec.procedure;
      rec.equipment = translation.equipment || rec.equipment;
      // rec.ingredients is intentionally NOT overwritten
    }
  }

  showRecipeSheet(rec);
}

// Translate procedure/equipment text only — not ingredient names
async function groqTranslate(text, targetLang){
  if(!text || !targetLang) return text;
  const r = await fetch(`${SUPABASE_URL}/functions/v1/ai-translate`,{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${SUPABASE_ANON_KEY}`},
    body:JSON.stringify({text, targetLang})
  });
  const j = await r.json();
  return j.translated || text;
}

function showRecipeSheet(rec){
  const sheet = document.createElement('div');
  sheet.className = 'fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end';

  // Ingredients — always from DB canonical data, unit always visible
  const ings = (rec.ingredients||[]).map(i=>{
    const qty  = i.qty  || '';
    const unit = i.unit || '';
    const qtyStr = qty && unit ? `<b>${qty} ${unit}</b>` : qty ? `<b>${qty}</b>` : '';
    return `<li>• ${qtyStr}${qtyStr?' ':''}<span>${i.name||''}</span>${i.comment?` <span class="text-slate-500">(${i.comment})</span>`:''}</li>`;
  }).join('');

  const sellingInfo = rec.selling_price ? `$${parseFloat(rec.selling_price).toFixed(2)}` : '';
  const fcInfo      = rec.food_cost_pct ? `${parseFloat(rec.food_cost_pct).toFixed(1)}% FC` : '';
  const headerMeta  = [
    rec.category,
    rec.yield_text||rec.yield,
    (rec.prep_time_minutes||rec.prep_time) ? ((rec.prep_time_minutes||rec.prep_time)+' min') : null,
    sellingInfo,
    fcInfo
  ].filter(Boolean).join(' · ');

  sheet.innerHTML = `
    <div class="bg-white w-full max-w-md mx-auto rounded-t-[28px] p-5 max-h-[85vh] overflow-auto" style="animation:slideUp .25s ease">
      <div class="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4"></div>
      <h3 class="text-xl font-bold mb-1">${rec.title||rec.name||''}</h3>
      <p class="text-xs text-slate-500 mb-3">${headerMeta}</p>
      ${rec.image_url ? `<img src="${rec.image_url}" class="w-full h-40 object-cover rounded-xl mb-3">` : ''}
      ${rec.photo_url ? `<img src="${rec.photo_url}" class="w-full h-40 object-cover rounded-xl mb-3">` : ''}
      ${ings ? `<p class="text-sm font-semibold mb-1">${tr("ingredients")}</p><ul class="text-sm space-y-1 mb-3">${ings}</ul>` : ''}
      ${rec.equipment ? `<p class="text-sm font-semibold mb-1">Attrezzatura</p><p class="text-xs text-slate-600 mb-3 whitespace-pre-wrap">${rec.equipment}</p>` : ''}
      ${rec.procedure ? `<p class="text-sm font-semibold mb-1">Procedimento</p><p class="text-sm text-slate-700 whitespace-pre-wrap mb-4">${rec.procedure}</p>` : ''}
      ${rec.note ? `<p class="text-xs text-amber-700 bg-amber-50 p-2 rounded-lg mb-3">${rec.note}</p>` : ''}
      <div id="recipeFoodCost_${rec.id||'x'}" class="mb-3">
        <div style="font-size:11px;color:#94a3b8;padding:6px 0;">Loading food cost...</div>
      </div>
      <button onclick="this.closest('.fixed').remove()" class="w-full mt-2 py-3 bg-slate-900 text-white rounded-xl">${tr("close")}</button>
    </div>`;
  sheet.onclick = e=>{ if(e.target===sheet) sheet.remove(); };
  document.body.appendChild(sheet);
  calcRecipeFoodCost(rec);
}

function renderRecipes(){
  const cats = ['All'].concat([...new Set(SHOP_RECIPES.flatMap(r=>(r.category||'').split('|').map(s=>s.trim()).filter(Boolean)))]);
  document.getElementById('recipeCats').innerHTML = cats.map(c=>`<button onclick="recipeCat='${c.replace(/'/g,"\\'")}';renderRecipes()" class="px-3 py-1.5 rounded-full border text-xs whitespace-nowrap ${recipeCat===c?'bg-slate-900 text-white':'bg-white'}">${c}</button>`).join('');
  const search = (document.getElementById('recipeSearch')?.value||'').toLowerCase();
  const filtered = SHOP_RECIPES.filter(r=>(recipeCat==='All'||(r.category||'').includes(recipeCat))&&(!search||r.title.toLowerCase().includes(search)||(r.category||'').toLowerCase().includes(search)));
  document.getElementById('recipeGrid').innerHTML = filtered.map((r,idx)=>{
    const realIdx = SHOP_RECIPES.indexOf(r);
    const fcColor = r.food_cost_pct ? (r.food_cost_pct<28?'#10b981':r.food_cost_pct<35?'#f59e0b':'#ef4444') : null;
    const badges = [
      r.selling_price ? `<span style="font-size:10px;color:#64748b;">$${parseFloat(r.selling_price).toFixed(2)}</span>` : '',
      r.food_cost_pct && fcColor ? `<span style="font-size:10px;color:${fcColor};font-weight:600;">${parseFloat(r.food_cost_pct).toFixed(1)}% FC</span>` : ''
    ].filter(Boolean).join('');
    return `<div class="bg-white p-3 rounded-2xl border shadow-sm cursor-pointer active:scale-[0.98] transition" onclick="openRecipeByData(${realIdx})">
      <div class="font-semibold text-[15px] leading-tight mb-1">${r.title}</div>
      <div class="text-xs text-slate-500">${r.category||'Generale'} · ${r.yield_text||r.yield||'1 porzione'}${(r.prep_time_minutes||r.prep_time)?' · '+(r.prep_time_minutes||r.prep_time)+'m':''}</div>
      ${badges?`<div class="flex gap-2 mt-1">${badges}</div>`:''}
      ${isAdmin()?`<div class="flex gap-1 mt-2" onclick="event.stopPropagation()"><button onclick="openRecipeEditor(SHOP_RECIPES[${realIdx}])" class="px-2 py-1 bg-amber-500 text-white rounded-lg text-[10px]">Modifica</button><button onclick="linkRecipeToItem('${r.title.replace(/'/g,"\\'")}') " class="px-2 py-1 bg-emerald-600 text-white rounded-lg text-[10px]">Collega</button></div>`:''}</div>`;
  }).join('');
}

function openRecipeManager(){
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4';
  modal.innerHTML = `<div class="bg-white w-full max-w-lg rounded-3xl shadow-2xl max-h-[85vh] flex flex-col">
    <div class="p-4 border-b flex items-center justify-between"><h3 class="font-bold text-lg">Collega Ricette</h3><button onclick="this.closest('.fixed').remove()" class="text-slate-400">✕</button></div>
    <div class="p-4 overflow-auto flex-1">
      <p class="text-xs text-slate-500 mb-3">Abbina ogni prep a una ricetta.</p>
      <div id="linkList" class="space-y-2"></div>
      <button id="newRecipeBtn" class="mt-4 w-full py-2.5 bg-emerald-600 text-white rounded-xl font-semibold text-sm">+ Crea Nuova Ricetta</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  const list = document.getElementById('linkList');
  items.forEach(it=>{
    const sel = document.createElement('div');
    sel.className = 'flex items-center gap-2 p-2 bg-slate-50 rounded-xl';
    sel.innerHTML = `<div class="flex-1 text-sm font-medium">${it.name}</div><select data-id="${it.id}" class="text-xs border rounded-lg px-2 py-1.5 bg-white max-w-[180px]"><option value="">— nessuna —</option>${SHOP_RECIPES.map(r=>`<option ${recipeLinks[it.id]===r.title?'selected':''}>${r.title}</option>`).join('')}</select>`;
    list.appendChild(sel);
  });
  list.querySelectorAll('select').forEach(s=>s.onchange=e=>{recipeLinks[e.target.dataset.id]=e.target.value;localStorage.setItem('recipeLinks',JSON.stringify(recipeLinks));});
  document.getElementById('newRecipeBtn').onclick = ()=>openRecipeEditor();
}

function openRecipeEditor(rec=null){
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4';
  modal.innerHTML = `<div class="bg-white w-full max-w-lg rounded-3xl shadow-2xl max-h-[90vh] flex flex-col">
    <div class="p-4 border-b"><h3 class="font-bold">${rec?'Modifica':'Nuova'} Ricetta</h3></div>
    <div class="p-4 overflow-auto space-y-3 text-sm">
      <input id="rTitle" placeholder="Titolo" class="w-full px-3 py-2 border rounded-xl" value="${rec?.title||''}">
      <input id="rImg" placeholder="URL foto" class="w-full px-3 py-2 border rounded-xl" value="${rec?.image_url||''}">
      <div class="grid grid-cols-2 gap-2">
        <input id="rCat" placeholder="Categoria" class="px-3 py-2 border rounded-xl" value="${rec?.category||''}">
        <input id="rYield" placeholder="Resa" class="px-3 py-2 border rounded-xl" value="${rec?.yield_text||rec?.yield||''}">
      </div>
      <div class="grid grid-cols-3 gap-2">
        <input id="rTime" type="number" placeholder="Tempo min" class="px-3 py-2 border rounded-xl" value="${rec?.prep_time_minutes||rec?.prep_time||''}">
        <input id="rServings" type="number" placeholder="Porzioni" class="px-3 py-2 border rounded-xl" value="${rec?.base_servings||''}">
        <input id="rPrice" type="number" step="0.01" placeholder="Prezzo $" class="px-3 py-2 border rounded-xl" value="${rec?.selling_price||''}">
      </div>
      <div>
        <div class="font-semibold mb-1">Ingredienti <span class="text-xs text-slate-400 font-normal">qty · unit · nome · nota</span></div>
        <div id="ingList" class="space-y-1"></div>
        <button id="addIng" class="text-xs text-emerald-600 mt-1">+ ingrediente</button>
      </div>
      <div><div class="font-semibold mb-1">Attrezzatura</div><textarea id="rEquip" class="w-full px-3 py-2 border rounded-xl h-16">${rec?.equipment||''}</textarea></div>
      <div><div class="font-semibold mb-1">Procedimento</div><textarea id="rProc" class="w-full px-3 py-2 border rounded-xl h-32">${rec?.procedure||''}</textarea></div>
    </div>
    <div class="p-3 border-t flex gap-2">
      <button onclick="this.closest('.fixed').remove()" class="flex-1 py-2.5 border rounded-xl">${tr("cancel")}</button>
      <button id="saveR" class="flex-1 py-2.5 bg-slate-900 text-white rounded-xl font-semibold">${tr("save")}</button>
    </div>
  </div>`;
  document.body.appendChild(modal);

  const ingList = modal.querySelector('#ingList');
  const UNITS = ['g','kg','ml','l','oz','lb','cup','tbsp','tsp','each'];

  function addRow(d={qty:'',unit:'g',name:'',comment:''}){
    const row = document.createElement('div');
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '60px 70px 1fr 90px auto';
    row.style.gap = '4px';
    row.innerHTML = `
      <input placeholder="200" class="px-2 py-1.5 border rounded text-xs" value="${d.qty||''}" type="number" min="0" step="any">
      <select class="px-1 py-1.5 border rounded text-xs bg-white">
        ${UNITS.map(u=>`<option ${(d.unit||'g')===u?'selected':''}>${u}</option>`).join('')}
      </select>
      <input placeholder="ingrediente" class="px-2 py-1.5 border rounded text-xs" value="${d.name||''}">
      <input placeholder="nota" class="px-2 py-1.5 border rounded text-xs" value="${d.comment||''}">
      <button class="text-red-500 px-1">✕</button>`;
    row.querySelector('button').onclick = ()=>row.remove();
    ingList.appendChild(row);
  }

  (rec?.ingredients||[{},{},{}]).forEach(addRow);
  modal.querySelector('#addIng').onclick = ()=>addRow();

  modal.querySelector('#saveR').onclick = async()=>{
    const t = modal.querySelector('#rTitle').value.trim();
    if(!t){ alert('Nome obbligatorio'); return; }
    const sp = parseFloat(modal.querySelector('#rPrice')?.value)||null;
    const bs = parseInt(modal.querySelector('#rServings')?.value)||null;
    const ingredients = [...ingList.children].map(r=>({
      qty:     parseFloat(r.children[0].value)||r.children[0].value||'',
      unit:    r.children[1].value||'g',
      name:    r.children[2].value,
      comment: r.children[3].value
    })).filter(i=>i.name);
    const newRec = {
      title:             t,
      category:          modal.querySelector('#rCat').value,
      yield_text:        modal.querySelector('#rYield').value,
      prep_time_minutes: parseInt(modal.querySelector('#rTime').value)||null,
      image_url:         modal.querySelector('#rImg').value,
      equipment:         modal.querySelector('#rEquip').value,
      procedure:         modal.querySelector('#rProc').value,
      selling_price:     sp,
      base_servings:     bs,
      ingredients
    };
    try{
      if(rec?.id){
        await supa.from('recipes').update(newRec).eq('id',rec.id);
        // Invalidate any existing translations so they get regenerated fresh
        await supa.from('recipe_translations').delete().eq('recipe_id',rec.id);
      } else {
        await supa.from('recipes').insert(newRec);
      }
      modal.remove();
      await init();
      renderRecipes();
    }catch(e){ alert('Errore: '+e.message); }
  };
}

function linkRecipeToItem(title){
  const name = prompt('Collega "'+title+'" a quale item prep?\n'+items.map(i=>i.name).join(', '));
  if(!name) return;
  const it = items.find(i=>i.name.toLowerCase()===name.toLowerCase());
  if(it){ recipeLinks[it.id]=title; alert('Collegato a '+it.name); }
  else alert('Item non trovato');
}

async function showTranslation(name, el){
  if(!user||user.lang==='it') return;
  const existing = el.querySelector('.tr-tooltip');
  if(existing){ existing.remove(); return; }
  const tooltip = document.createElement('span');
  tooltip.className = 'tr-tooltip text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full ml-1';
  tooltip.textContent = '...';
  el.appendChild(tooltip);
  try{
    const translated = await groqTranslate(name, user.lang);
    tooltip.textContent = translated;
    setTimeout(()=>tooltip.remove(), 4000);
  }catch(e){ tooltip.remove(); }
}

// ── FOOD COST CALCULATOR ──────────────────────────────────────
const LOCAL_CONV = {
  lb:453.592, oz:28.3495, kg:1000, g:1,
  gal:3785.41, l:1000, ml:1,
  cup:236.588, tbsp:14.7868, tsp:4.92892,
};

let _unitConvCache = null;
async function getUnitConversions(){
  if(_unitConvCache) return _unitConvCache;
  const{data} = await supa.from('unit_conversion_table').select('from_unit,to_unit,factor');
  _unitConvCache = {};
  (data||[]).forEach(r=>{
    if(!_unitConvCache[r.from_unit]) _unitConvCache[r.from_unit]={};
    _unitConvCache[r.from_unit][r.to_unit] = r.factor;
  });
  return _unitConvCache;
}

async function convertQtyToG(qty, unit){
  const q = parseFloat(qty);
  if(isNaN(q)||!unit) return null;
  if(unit==='g'||unit==='ml') return q;
  const conv = await getUnitConversions();
  if(conv[unit]?.['g'])  return q * conv[unit]['g'];
  if(conv[unit]?.['ml']) return q * conv[unit]['ml'];
  if(LOCAL_CONV[unit]) return q * LOCAL_CONV[unit];
  return null;
}

async function findIngredientByName(name){
  if(!name) return null;
  const r1 = await supa.from('ingredients').select('id,name').eq('name',name).eq('active',true).maybeSingle();
  if(r1.data) return r1.data;
  const r2 = await supa.from('ingredients').select('id,name').ilike('name',name).eq('active',true).limit(1);
  if(r2.data?.length) return r2.data[0];
  const first = name.split(' ')[0];
  if(first.length > 2){
    const r3 = await supa.from('ingredients').select('id,name').ilike('name',`%${first}%`).eq('active',true).limit(1);
    if(r3.data?.length) return r3.data[0];
  }
  return null;
}

async function calcRecipeFoodCost(rec){
  const el = document.getElementById(`recipeFoodCost_${rec.id||'x'}`);
  if(!el) return;

  const ings = (rec.ingredients||[]).filter(i=>i.name);
  if(!ings.length){
    el.innerHTML = '<div style="font-size:11px;color:#94a3b8;padding:6px 0;">No ingredients in this recipe</div>';
    return;
  }

  const resolved = await Promise.all(ings.map(async ing=>{
    if(!ing.unit)
      return {name:ing.name, qty:ing.qty, unit:ing.unit, issue:'Missing unit'};

    const qtyG = await convertQtyToG(ing.qty, ing.unit);
    if(qtyG==null)
      return {name:ing.name, qty:ing.qty, unit:ing.unit, issue:`Cannot convert "${ing.unit}" to grams`};

    const ingr = await findIngredientByName(ing.name);
    if(!ingr)
      return {name:ing.name, qty:ing.qty, unit:ing.unit, qtyG, issue:'Ingredient not linked — name does not match ingredients table'};

    const {data:prices} = await supa.from('ingredient_vendors')
      .select('price_per_100g,vendor,unit_price,purchase_unit,conversion_to_base,last_total_weight_g,unit_weight_g')
      .eq('ingredient_id', ingr.id)
      .eq('active', true)
      .order('price_per_100g',{ascending:true,nullsLast:true})
      .limit(1);

    if(!prices?.length)
      return {name:ing.name, qty:ing.qty, unit:ing.unit, qtyG, issue:'No vendor data — add a vendor or import an invoice'};

    const p = prices[0];
    const p100 = p.price_per_100g || (()=>{
      const base = p.conversion_to_base || p.last_total_weight_g || p.unit_weight_g
        || (p.purchase_unit ? LOCAL_CONV[p.purchase_unit.toLowerCase()] : null);
      return p.unit_price && base ? (p.unit_price/base)*100 : null;
    })();

    if(!p100)
      return {name:ing.name, qty:ing.qty, unit:ing.unit, qtyG,
        issue:`Missing price_per_100g for ${p.vendor} — edit vendor row to add weight/conversion`};

    return {name:ing.name, qty:ing.qty, unit:ing.unit, qtyG, price_per_100g:p100, vendor:p.vendor, lineCost:(qtyG/100)*p100};
  }));

  const costed      = resolved.filter(r=>r.lineCost!=null);
  const issues      = resolved.filter(r=>r.issue);
  const totalCost   = costed.reduce((s,r)=>s+r.lineCost, 0);
  const servings    = rec.base_servings||1;
  const costPerServing = totalCost/servings;
  const fcPct       = rec.selling_price ? (costPerServing/parseFloat(rec.selling_price))*100 : null;
  const fcColor     = fcPct ? (fcPct<28?'#10b981':fcPct<35?'#f59e0b':'#ef4444') : '#94a3b8';

  if(fcPct && rec.id){
    supa.from('recipes').update({food_cost_pct:parseFloat(fcPct.toFixed(1))}).eq('id',rec.id).then(()=>{});
  }

  el.innerHTML = `
    <div style="background:#f8fafc;border-radius:14px;padding:12px;margin-bottom:8px;">
      <div style="font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin-bottom:10px;">Food Cost</div>

      ${resolved.map(r=>`
        <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:0.5px solid #f1f5f9;">
          <div>
            <span style="font-size:12px;color:#1e293b;">${r.name}</span>
            <span style="font-size:10px;color:#94a3b8;margin-left:4px;">${r.qty||''} ${r.unit||''}</span>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            ${r.lineCost!=null
              ? `<span style="font-size:12px;font-weight:500;color:#1e293b;">$${r.lineCost.toFixed(3)}</span>`
              : `<span style="font-size:10px;color:#f59e0b;">⚠️</span>`}
          </div>
        </div>`).join('')}

      ${costed.length>0 ? `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid #e2e8f0;">
        <div>
          <div style="font-size:13px;font-weight:600;color:#1e293b;">Cost / serving</div>
          ${servings>1?`<div style="font-size:10px;color:#94a3b8;">${servings} servings · total $${totalCost.toFixed(2)}</div>`:''}
        </div>
        <div style="text-align:right;">
          <div style="font-size:16px;font-weight:700;color:#1e293b;">$${costPerServing.toFixed(2)}</div>
          ${fcPct!=null
            ? `<div style="font-size:12px;font-weight:600;color:${fcColor};">${fcPct.toFixed(1)}% FC</div>`
            : `<div style="font-size:10px;color:#94a3b8;">Set selling price to see %</div>`}
        </div>
      </div>` : ''}

      ${issues.length ? `
      <div style="margin-top:8px;padding-top:8px;border-top:0.5px dashed #e2e8f0;">
        <div style="font-size:10px;font-weight:600;color:#94a3b8;margin-bottom:4px;">WHY SOME COSTS ARE MISSING</div>
        ${issues.map(r=>`<div style="font-size:10px;color:#f59e0b;margin-bottom:2px;">· <b>${r.name}</b>: ${r.issue}</div>`).join('')}
      </div>` : ''}
    </div>`;
}
