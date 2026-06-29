// ── RICETTE ──────────────────────────────────────────────────

const MENU_GROUPS = ['Antipasti','Primi','Secondi','Table Side','Salads','Sides','Soups','Desserts','Sauces','Bases','Finger Food','Catering','Add-ons'];

async function openRecipeForItem(itemId){
  const task = tasks[itemId];

  // ── STEPS: se la prep ha step sequenziali, espandi inline ──
  const {data: steps} = await supa.from('prep_steps')
    .select('*').eq('prep_task_id', itemId).order('sort_order');
  if(steps && steps.length > 0){
    togglePrepStepsExpand(itemId, steps);
    return;
  }

  if(task?.recipe_id){
    const{data:recipe} = await supa.from('recipes').select('*').eq('id',task.recipe_id).maybeSingle();
    if(recipe){ recipeModal.open(recipe.id, itemId); return; }
  }
  const linked = recipeLinks[itemId];
  if(linked){
    const rec = SHOP_RECIPES.find(r=>r.id==linked||r.title===linked);
    if(rec){
      const {data:fresh} = await supa.from('recipes').select('*').eq('id',rec.id).maybeSingle();
      showRecipeSheet(fresh||rec);
      return;
    }
  }
  if(task?.note){ showNoteSheet(task.name,task.note); return; }
  if(isAdmin()){
    if(confirm(tr('prep_no_recipe_note'))) openPrepEditor(task);
  }
}

function showNoteSheet(name, note){
  const sheet = document.createElement('div');
  sheet.className = 'fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm flex items-end';
  sheet.innerHTML = `<div class="bg-white w-full max-w-md mx-auto rounded-t-[28px] p-5 max-h-[70vh] overflow-auto" style="animation:slideUp .25s ease">
    <div class="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4"></div>
    <h3 class="text-xl font-bold mb-3">📝 ${name}</h3>
    <div class="bg-slate-50 rounded-2xl p-4 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">${note}</div>
    <button onclick="this.closest('.fixed').remove()" class="w-full mt-4 py-3 bg-slate-900 text-white rounded-xl">${tr("close")}</button>
  </div>`;
  sheet.onclick = e=>{ if(e.target===sheet) sheet.remove(); };
  document.body.appendChild(sheet);
  addSwipeToClose(sheet.querySelector('div'), ()=>sheet.remove());

}
window.openRecipeForItem = openRecipeForItem;

async function openRecipeByData(idx){
  const stale = SHOP_RECIPES[idx];
  if(!stale?.id){ showRecipeSheet(stale); return; }

  const {data:fresh} = await supa.from('recipes').select('*').eq('id',stale.id).maybeSingle();
  const rec = fresh || stale;

  // Translation: procedure and equipment only — NEVER ingredient names
  // Fast path: use pre-translated columns if available (procedure_en / procedure_es)
  if(user?.lang === 'en' && rec.procedure_en) rec.procedure = rec.procedure_en;
  if(user?.lang === 'es' && rec.procedure_es) rec.procedure = rec.procedure_es;
  // Slow path: use recipe_translations cache or Groq (only if no pre-translated column)
  const _hasPretranslated = (user?.lang === 'en' && rec.procedure_en) || (user?.lang === 'es' && rec.procedure_es);
  if(user?.lang && user.lang!=='it' && rec.id && !_hasPretranslated){
    let {data:translation} = await supa
      .from('recipe_translations')
      .select('title,procedure,equipment')
      .eq('recipe_id', rec.id)
      .eq('lang', user.lang)
      .maybeSingle();

    if(!translation){
      try{
        const translatedProcedure = rec.procedure ? await groqTranslate(rec.procedure, user.lang) : '';
        const translatedEquipment = rec.equipment ? await groqTranslate(rec.equipment, user.lang) : '';
        const translatedTitle     = rec.title; // titolo non si traduce — è un nome proprio
        const newTr = {
          recipe_id: rec.id,
          lang:      user.lang,
          title:     translatedTitle,
          procedure: translatedProcedure,
          equipment: translatedEquipment,
        };
        await supa.from('recipe_translations').upsert(newTr);
        translation = newTr;
      }catch(e){ /* Translation failed — use original */ }
    }

    if(translation){
      // rec.title non si aggiorna dalla traduzione — è un nome proprio
      rec.procedure = translation.procedure || rec.procedure;
      rec.equipment = translation.equipment || rec.equipment;
    }
  }

  recipeModal.open(rec.id);
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

// ── RENDER INGREDIENT LINE (used by preview + scaled view) ──
function renderIngLine(i, scaleFactor, trMap, uLang){
  // Section header — bold label, no bullet, no qty
  if(i.type === 'section'){
    return `<li style="list-style:none;font-weight:700;font-size:16px;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;padding:12px 0 4px 0;margin-top:6px;">${i.name||''}</li>`;
  }
  const rawQty = parseFloat(i.qty);
  let qtyDisplay = i.qty || '';
  if(!isNaN(rawQty)){
    const scaled = rawQty * (scaleFactor || 1);
    // Smart rounding: keep decimals only when meaningful
    qtyDisplay = scaled >= 100 ? Math.round(scaled).toString()
               : scaled >= 10  ? (Math.round(scaled * 10) / 10).toFixed(1).replace(/\.0$/,'')
               :                  (Math.round(scaled * 100) / 100).toFixed(2).replace(/\.?0+$/,'');
  }
  const unit = i.unit || '';
  const qtyStr = qtyDisplay && unit ? `<b>${qtyDisplay} ${unit}</b>` : qtyDisplay ? `<b>${qtyDisplay}</b>` : '';
  // Pick translated name from DB if available, else capitalize English name
  const nameKey = (i.name||'').toLowerCase();
  const trEntry = trMap && trMap[nameKey];
  let displayName;
  if(trEntry && uLang === 'it' && trEntry.it) displayName = trEntry.it;
  else if(trEntry && uLang === 'es' && trEntry.es) displayName = trEntry.es;
  else displayName = (i.name||'').replace(/\b\w/g, c => c.toUpperCase());
  // Show Italian comment only for Italian users
  const showComment = i.comment && uLang === 'it';
  return `<li style="list-style:none;padding:8px 0;font-size:19px;">• ${qtyStr}${qtyStr?' ':''}<span>${displayName}</span>${showComment?` <span style="color:#94a3b8;">(${i.comment})</span>`:''}</li>`;
}

// ── INGREDIENT TRANSLATION CACHE ──
let _ingTranslations = null; // {name_en: {it: name_it, es: name_es}}

async function loadIngTranslations(){
  if(_ingTranslations) return _ingTranslations;
  const {data} = await supa.from('ingredients').select('name,name_it,name_es').not('name_it','is',null);
  _ingTranslations = {};
  (data||[]).forEach(r=>{
    _ingTranslations[r.name.toLowerCase()] = {it: r.name_it, es: r.name_es};
  });
  return _ingTranslations;
}

// ── RECIPE PREVIEW SHEET ─────────────────────────────────────
async function showRecipeSheet(rec){
  const sheet = document.createElement('div');
  sheet.id = '_recipeDetailSheet';
  sheet.className = 'fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm flex items-end';

  // Load ingredient translations for current user language
  const _trMap = await loadIngTranslations();
  const _uLang = user?.lang || 'en';

  // Scaling state
  const baseServings   = rec.base_servings   || null;
  const baseWeightG    = rec.base_weight_g   || null;
  const servingWeightG = rec.serving_weight_g || (baseServings && baseWeightG ? baseWeightG / baseServings : null);

  const canScale = baseServings || servingWeightG;

  const sellingInfo = rec.selling_price ? `$${parseFloat(rec.selling_price).toFixed(2)}` : '';
  const fcInfo      = rec.food_cost_pct ? `${parseFloat(rec.food_cost_pct).toFixed(1)}% FC` : '';
  // Translate category
  const CAT_MAP = {
    it:{ Antipasti:'Antipasti', Primi:'Primi', Secondi:'Secondi', 'Table Side':'Table Side', Salads:'Insalate', Sides:'Contorni', Soups:'Zuppe', Desserts:'Dolci', Sauces:'Salse', Bases:'Basi', 'Finger Food':'Finger Food', Catering:'Catering', 'Add-ons':'Aggiunte' },
    en:{ Antipasti:'Appetizers', Primi:'Pasta', Secondi:'Mains', 'Table Side':'Table Side', Salads:'Salads', Sides:'Sides', Soups:'Soups', Desserts:'Desserts', Sauces:'Sauces', Bases:'Bases', 'Finger Food':'Finger Food', Catering:'Catering', 'Add-ons':'Add-ons' },
    es:{ Antipasti:'Aperitivos', Primi:'Pasta', Secondi:'Platos principales', 'Table Side':'Table Side', Salads:'Ensaladas', Sides:'Guarniciones', Soups:'Sopas', Desserts:'Postres', Sauces:'Salsas', Bases:'Bases', 'Finger Food':'Finger Food', Catering:'Catering', 'Add-ons':'Extras' }
  };
  const lang = user?.lang || 'en';
  const rawCat = rec.menu_group || rec.category || '';
  const dispCat = (CAT_MAP[lang]||CAT_MAP.en)[rawCat] || rawCat;
  // Translate yield text (e.g. "1 porzione" → "1 serving")
  const YIELD_MAP = { it:'porzione', en:'serving', es:'porción' };
  const YIELD_MAP_PL = { it:'porzioni', en:'portions', es:'porciones' };
  const yieldRaw = rec.yield_text || rec.yield || '';
  const yieldTr = yieldRaw
    .replace(/porzioni|portions|porciones/gi, YIELD_MAP_PL[lang]||'portions')
    .replace(/porzione|serving|porción/gi, YIELD_MAP[lang]||'serving');
  const headerMeta  = [
    dispCat,
    yieldTr,
    (rec.prep_time_minutes||rec.prep_time) ? ((rec.prep_time_minutes||rec.prep_time)+' min') : null,
    sellingInfo,
    fcInfo
  ].filter(Boolean).join(' · ');

  // Initial ingredients render (scale = 1)
  const renderIngs = (factor) => (rec.ingredients||[]).map(i => renderIngLine(i, factor, _trMap, _uLang)).join('');

  const scalingUI = canScale ? `
    <div id="recipeScaler" style="background:#f8fafc;border-radius:12px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:12px;">
      <span style="font-size:13px;font-weight:600;color:#94a3b8;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;">${tr('scaleRecipe')}</span>
      <div style="display:flex;align-items:center;gap:6px;">
        <button id="scaleMinus" style="width:32px;height:32px;border-radius:8px;border:1px solid #e2e8f0;background:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">−</button>
        <input id="scaleServings" type="number" min="1" value="${baseServings||1}" style="width:68px;text-align:center;border:1px solid #e2e8f0;border-radius:8px;padding:5px 6px;font-size:18px;font-weight:700;">
        <button id="scalePlus" style="width:32px;height:32px;border-radius:8px;border:1px solid #e2e8f0;background:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">+</button>
      </div>
      ${servingWeightG ? `
      <div style="color:#cbd5e1;font-size:16px;">|</div>
      <div style="display:flex;align-items:center;gap:4px;">
        <input id="scaleWeight" type="number" min="0.1" step="0.1" value="${baseWeightG ? (baseWeightG/1000).toFixed(2).replace(/\.?0+$/,'') : ''}" style="width:68px;text-align:center;border:1px solid #e2e8f0;border-radius:8px;padding:5px 6px;font-size:18px;font-weight:700;">
        <span style="font-size:13px;color:#64748b;">kg</span>
      </div>` : ''}
      <span id="scaleNote" style="font-size:12px;color:#94a3b8;margin-left:auto;white-space:nowrap;">× ${baseServings||1}</span>
    </div>` : '';

  sheet.innerHTML = `
    <div class="bg-white w-full max-w-md mx-auto rounded-t-[28px] p-5 max-h-[85vh] overflow-auto" style="animation:slideUp .25s ease;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding-bottom:env(safe-area-inset-bottom,24px);">
      <div class="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4"></div>
      <h3 class="text-3xl font-bold mb-2">${rec.title||rec.name||''}</h3>
      <p class="text-base text-slate-500 mb-3">${headerMeta}</p>
      ${rec.pos_name ? '<div id="recipeSalesStats" style="margin-bottom:12px;"></div>' : ''}
      ${!rec.pos_name && rec.base_weight_g ? '<div id="recipePrepStats" style="margin-bottom:12px;"></div>' : ''}
      ${(rec.prep_frequency_days || rec.shelf_life_days) ? `<div style="display:flex;gap:8px;margin-bottom:12px;">${rec.prep_frequency_days ? '<span style="font-size:11px;background:#f0f4ff;color:#6366f1;border:1px solid #e0e7ff;border-radius:8px;padding:4px 10px;font-weight:600;">'+tr('every')+' '+rec.prep_frequency_days+' '+(rec.prep_frequency_days===1?tr('dayS'):tr('daysS'))+'</span>' : ''}${rec.shelf_life_days ? '<span style="font-size:11px;background:#f0fdf4;color:#059669;border:1px solid #bbf7d0;border-radius:8px;padding:4px 10px;font-weight:600;">'+tr('lastsWord')+' '+rec.shelf_life_days+' '+(rec.shelf_life_days===1?tr('dayS'):tr('daysS'))+'</span>' : ''}</div>` : ''}
      ${rec.image_url ? `<img src="${rec.image_url}" class="w-full h-40 object-cover rounded-xl mb-3">` : ''}
      ${rec.photo_url ? `<img src="${rec.photo_url}" class="w-full h-40 object-cover rounded-xl mb-3">` : ''}
      ${scalingUI}
      ${(rec.ingredients||[]).length ? `
      <div id="recipeModeToggle" style="display:flex;gap:0;margin-bottom:12px;border-radius:12px;overflow:hidden;border:1.5px solid #e2e8f0;background:#f8fafc;">
        <button id="modeOriginal" onclick="setRecipeMode('original')" style="flex:1;padding:9px 0;font-size:13px;font-weight:700;background:#1e293b;color:white;border:none;cursor:pointer;transition:all .2s;">${tr('recipe_original')}</button>
        <button id="modeSmart" onclick="setRecipeMode('smart')" style="flex:1;padding:9px 0;font-size:13px;font-weight:700;background:transparent;color:#94a3b8;border:none;cursor:pointer;transition:all .2s;">🤖 Smart</button>
      </div>
      <p class="text-lg font-semibold mb-2">${tr("ingredients")}</p><ul id="ingDisplay" class="mb-4" style="padding:0;">${renderIngs(1)}</ul>` : ''}
      ${rec.equipment ? `<p class="text-lg font-semibold mb-2">${tr('recipe_equipment')}</p><p class="text-base text-slate-600 mb-4 whitespace-pre-wrap">${rec.equipment}</p>` : ''}
      ${rec.procedure ? `<p class="text-lg font-semibold mb-2">${tr('recipe_procedure')}</p><p class="text-lg text-slate-700 whitespace-pre-wrap mb-5 leading-relaxed">${rec.procedure}</p>` : ''}
      ${isAdmin() ? `<button id="recipeEditBtn" class="w-full mt-2 py-2.5 bg-amber-500 text-white rounded-xl font-semibold text-sm">${tr('recipe_edit_btn')}</button>` : ''}
      <button onclick="this.closest('.fixed').remove()" class="w-full mt-2 mb-6 py-3 bg-slate-900 text-white rounded-xl">${tr("close")}</button>
    </div>`;

  sheet.onclick = e=>{ if(e.target===sheet) sheet.remove(); };
  document.body.appendChild(sheet);
  addSwipeToClose(sheet.querySelector('div'), ()=>sheet.remove(), 280);

  // Edit button — needs rec in closure
  const editBtn = sheet.querySelector('#recipeEditBtn');
  if(editBtn){
    editBtn.onclick = ()=>{ sheet.remove(); openRecipeEditor(rec); };
  }

  if(rec.pos_name) loadRecipeSalesStats(rec, sheet);
  if(!rec.pos_name && rec.base_weight_g) loadRecipePrepStats(rec, sheet);

  // ── ORIGINALE / SMART TOGGLE ──
  (async function initModeToggle(){
    const inputWeight = sheet.querySelector('#scaleWeight');
    const inputServ   = sheet.querySelector('#scaleServings');
    const btnOrig     = sheet.querySelector('#modeOriginal');
    const btnSmart    = sheet.querySelector('#modeSmart');
    if(!btnOrig || !btnSmart) return;

    // baseKg = peso base della ricetta
    const baseKg = baseWeightG ? (baseWeightG / 1000).toFixed(2).replace(/\.?0+$/, '') : null;

    // Leggi suggested_qty direttamente dal DB — nessun timing issue
    let smartKg = null;
    if(rec?.id){
      try{
        const {data: ptRows} = await supa.from('prep_tasks')
          .select('suggested_qty')
          .eq('recipe_id', rec.id)
          .not('suggested_qty','is',null)
          .limit(1);
        if(ptRows && ptRows.length){
          const sugG = parseFloat(ptRows[0].suggested_qty);
          const bwg  = parseFloat(rec.base_weight_g);
          if(sugG && bwg){
            // Converti grammi → kg di prodotto finito considerando yield
            const yieldPct = rec.yield_pct ? parseFloat(rec.yield_pct)/100 : 1;
            const finishedKg = (sugG / 1000) * yieldPct;
            smartKg = finishedKg.toFixed(2).replace(/\.?0+$/,'');
          } else if(sugG){
            smartKg = (sugG/1000).toFixed(2).replace(/\.?0+$/,'');
          }
        }
      }catch(e){ /* silenzioso */ }
    }

    // Se non c'è suggested_qty nascondi il toggle
    if(!smartKg){
      const toggleEl = sheet.querySelector('#recipeModeToggle');
      if(toggleEl) toggleEl.style.display = 'none';
      return;
    }

    // Scala ingredienti via applyScale passando il fattore rispetto a base_weight_g
    function scaleToKg(targetKg){
      const baseG = parseFloat(rec.base_weight_g) || 0;
      if(!baseG) return;
      const factor = (targetKg * 1000) / baseG;
      const ingDisplay = sheet.querySelector('#ingDisplay');
      const scaleNote  = sheet.querySelector('#scaleNote');
      if(ingDisplay) ingDisplay.innerHTML = renderIngs(factor);
      if(scaleNote)  scaleNote.textContent = targetKg + ' kg';
      if(inputWeight) inputWeight.value = targetKg.toFixed ? targetKg.toFixed(2).replace(/\.?0+$/,'') : targetKg;
      if(inputServ && servingWeightG){
        inputServ.value = Math.max(1, Math.round((targetKg*1000)/servingWeightG));
      }
    }

    function applyMode(mode){
      if(mode === 'original'){
        btnOrig.style.background = '#1e293b';
        btnOrig.style.color = 'white';
        btnSmart.style.background = 'transparent';
        btnSmart.style.color = '#94a3b8';
        const bkg = parseFloat(baseKg) || parseFloat(rec.base_weight_g)/1000;
        if(bkg) scaleToKg(bkg);
        else if(inputServ){ inputServ.value = baseServings||1; inputServ.dispatchEvent(new Event('input')); }
      } else {
        btnSmart.style.background = '#059669';
        btnSmart.style.color = 'white';
        btnOrig.style.background = 'transparent';
        btnOrig.style.color = '#94a3b8';
        scaleToKg(parseFloat(smartKg));
      }
    }

    window.setRecipeMode = (mode) => applyMode(mode);
  })();

  // Scaling logic
  if(canScale){
    const ingDisplay   = sheet.querySelector('#ingDisplay');
    const inputServ    = sheet.querySelector('#scaleServings');
    const inputWeight  = sheet.querySelector('#scaleWeight');
    const scaleNote    = sheet.querySelector('#scaleNote');
    const btnMinus     = sheet.querySelector('#scaleMinus');
    const btnPlus      = sheet.querySelector('#scalePlus');

    let _updating = false;

    function applyScale(factor, servings, weightKg){
      if(!ingDisplay) return;
      ingDisplay.innerHTML = renderIngs(factor);
      scaleNote.textContent = `${servings} ${servings!==1?tr('servingPlural'):tr('servingSingle')}${weightKg ? ' · '+weightKg+'kg' : ''}`;
    }

    function onServingsChange(){
      if(_updating) return;
      _updating = true;
      const s = Math.max(1, parseInt(inputServ.value)||1);
      inputServ.value = s;
      const base = baseServings || 1;
      const factor = s / base;
      if(servingWeightG && inputWeight){
        const wkg = (s * servingWeightG / 1000);
        inputWeight.value = wkg.toFixed(2).replace(/\.?0+$/,'');
      }
      applyScale(factor, s, inputWeight ? inputWeight.value : null);
      _updating = false;
    }

    function onWeightChange(){
      if(_updating || !servingWeightG || !inputWeight) return;
      _updating = true;
      const wkg = parseFloat(inputWeight.value)||0;
      const wg = wkg * 1000;
      const s = Math.max(1, Math.round(wg / servingWeightG));
      inputServ.value = s;
      const base = baseServings || 1;
      const factor = s / base;
      applyScale(factor, s, wkg.toFixed(2).replace(/\.?0+$/,''));
      _updating = false;
    }

    btnMinus.onclick = ()=>{ inputServ.value = Math.max(1,(parseInt(inputServ.value)||1)-1); onServingsChange(); };
    btnPlus.onclick  = ()=>{ inputServ.value = (parseInt(inputServ.value)||1)+1; onServingsChange(); };
    inputServ.oninput = onServingsChange;
    if(inputWeight) inputWeight.oninput = onWeightChange;
  }
}

// ── RECIPE GRID ──────────────────────────────────────────────
function renderRecipes(){
  // Use menu_group if available, fall back to category
  const getCats = r => (r.menu_group || r.category || '').split('|').map(s=>s.trim()).filter(Boolean);
  const cats = ['All'].concat([...new Set(SHOP_RECIPES.flatMap(getCats))].sort());
  document.getElementById('recipeCats').innerHTML = cats.map(c=>`<button onclick="recipeCat='${c.replace(/'/g,"\\'")}';renderRecipes()" class="px-3 py-1.5 rounded-full border text-xs whitespace-nowrap ${recipeCat===c?'bg-slate-900 text-white':'bg-white'}">${c}</button>`).join('');

  const search = (document.getElementById('recipeSearch')?.value||'').toLowerCase();
  const filtered = SHOP_RECIPES.filter(r=>{
    const cats = getCats(r);
    const matchCat = recipeCat==='All' || cats.includes(recipeCat);
    const matchSearch = !search || r.title.toLowerCase().includes(search) || cats.join('|').toLowerCase().includes(search);
    return matchCat && matchSearch;
  });

  document.getElementById('recipeGrid').innerHTML = filtered.map((r,idx)=>{
    const realIdx = SHOP_RECIPES.indexOf(r);
    const dispCat = r.menu_group || r.category || 'General';
    const badges = [
      r.selling_price ? `<span style="font-size:10px;color:#64748b;">$${parseFloat(r.selling_price).toFixed(2)}</span>` : ''
    ].filter(Boolean).join('');
    return `<div class="bg-white p-3 rounded-2xl border shadow-sm cursor-pointer active:scale-[0.98] transition" onclick="openRecipeByData(${realIdx})">
      <div class="font-semibold text-[15px] leading-tight mb-1">${r.title}</div>
      <div class="text-xs text-slate-500">${dispCat} · ${(r.yield_text||r.yield||'1 serving').replace(/porzioni|portions|porciones/gi,{'it':'porzioni','en':'portions','es':'porciones'}[user?.lang||'en']||'portions').replace(/porzione|serving|porción/gi,{'it':'porzione','en':'serving','es':'porción'}[user?.lang||'en']||'serving')}${(r.prep_time_minutes||r.prep_time)?' · '+(r.prep_time_minutes||r.prep_time)+'m':''}</div>
      ${badges?`<div class="flex gap-2 mt-1">${badges}</div>`:''}
      ${isAdmin()?`<div class="flex gap-1 mt-2" onclick="event.stopPropagation()"><button onclick="openRecipeEditor(SHOP_RECIPES[${realIdx}])" class="px-2 py-1 bg-amber-500 text-white rounded-lg text-[10px]">Edit</button><button onclick="linkRecipeToItem('${r.title.replace(/'/g,"\\'")}') " class="px-2 py-1 bg-emerald-600 text-white rounded-lg text-[10px]">Link</button></div>`:''}</div>`;
  }).join('');
}

// ── RECIPE MANAGER (link prep → recipe) ─────────────────────
function openRecipeManager(){
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-[150] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4';
  modal.innerHTML = `<div class="bg-white w-full max-w-lg rounded-3xl shadow-2xl max-h-[85vh] flex flex-col">
    <div class="p-4 border-b flex items-center justify-between"><h3 class="font-bold text-lg">${tr('recipe_link_recipes')}</h3><button onclick="this.closest('.fixed').remove()" class="text-slate-400">✕</button></div>
    <div class="p-4 overflow-auto flex-1">
      <p class="text-xs text-slate-500 mb-3">${tr('linkEachPrep')}</p>
      <div id="linkList" class="space-y-2"></div>
      <button id="newRecipeBtn" class="mt-4 w-full py-2.5 bg-emerald-600 text-white rounded-xl font-semibold text-sm">${tr('newRecipeBtn')}</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  const list = document.getElementById('linkList');
  items.forEach(it=>{
    const sel = document.createElement('div');
    sel.className = 'flex items-center gap-2 p-2 bg-slate-50 rounded-xl';
    sel.innerHTML = `<div class="flex-1 text-sm font-medium">${it.name}</div><select data-id="${it.id}" class="text-xs border rounded-lg px-2 py-1.5 bg-white max-w-[180px]"><option value="">— none —</option>${SHOP_RECIPES.map(r=>`<option ${recipeLinks[it.id]===r.title?'selected':''}>${r.title}</option>`).join('')}</select>`;
    list.appendChild(sel);
  });
  list.querySelectorAll('select').forEach(s=>s.onchange=e=>{recipeLinks[e.target.dataset.id]=e.target.value;localStorage.setItem('recipeLinks',JSON.stringify(recipeLinks));});
  document.getElementById('newRecipeBtn').onclick = ()=>openRecipeEditor();
}

// ── RECIPE EDITOR (admin only) ───────────────────────────────
function openRecipeEditor(rec=null){
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-[150] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4';
  modal.innerHTML = `<div class="bg-white w-full max-w-lg rounded-3xl shadow-2xl max-h-[90vh] flex flex-col">
    <div class="p-4 border-b"><h3 class="font-bold">${rec?tr('editRecipe'):tr('newRecipe')}</h3></div>
    <div class="p-4 overflow-auto space-y-3 text-sm">

      <input id="rTitle" placeholder="Title" class="w-full px-3 py-2 border rounded-xl" value="${rec?.title||''}">
      <div>
        <div class="text-xs text-slate-500 mb-1">${tr('photo')}</div>
        <div style="display:flex;gap:8px;align-items:center;">
          <div id="rImgPreview" style="width:56px;height:56px;border-radius:10px;border:1.5px solid #e2e8f0;overflow:hidden;flex-shrink:0;background:#f8fafc;display:flex;align-items:center;justify-content:center;">
            ${rec?.image_url ? `<img src="${rec.image_url}" style="width:100%;height:100%;object-fit:cover;">` : `<span style="font-size:22px;">📷</span>`}
          </div>
          <div style="flex:1;">
            <input type="file" id="rImgFile" accept="image/*" style="display:none;">
            <button id="rImgBtn" type="button" class="w-full px-3 py-2 border rounded-xl text-sm text-slate-600 text-left" style="background:#f8fafc;">
              ${rec?.image_url ? tr('changePhoto') : tr('choosePhoto')}
            </button>
            <input id="rImg" type="hidden" value="${rec?.image_url||''}">
          </div>
        </div>
        <div id="rImgProgress" style="display:none;font-size:11px;color:#6366f1;margin-top:4px;">Uploading…</div>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div>
          <div class="text-xs text-slate-500 mb-1">${tr('menuGroup')}</div>
          <select id="rMenuGroup" class="w-full px-3 py-2 border rounded-xl bg-white text-sm">
            <option value="">— select —</option>
            ${MENU_GROUPS.map(g=>`<option value="${g}" ${(rec?.menu_group||'')===g?'selected':''}>${g}</option>`).join('')}
          </select>
        </div>
        <div>
          <div class="text-xs text-slate-500 mb-1">${tr('posName')}</div>
          <input id="rPosName" placeholder="e.g. Lobster Fettucine" class="w-full px-3 py-2 border rounded-xl" value="${rec?.pos_name||''}">
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div>
          <div class="text-xs text-slate-500 mb-1">${tr('baseServings')}</div>
          <input id="rServings" type="number" min="1" placeholder="e.g. 20" class="w-full px-3 py-2 border rounded-xl" value="${rec?.base_servings||''}">
        </div>
        <div>
          <div class="text-xs text-slate-500 mb-1">${tr('totalWeight')}</div>
          <input id="rWeightKg" type="number" min="0" step="0.01" placeholder="e.g. 5.5" class="w-full px-3 py-2 border rounded-xl" value="${rec?.base_weight_g ? (rec.base_weight_g/1000).toFixed(3).replace(/\.?0+$/,'') : ''}">
        </div>
      </div>
      <div id="servingWeightNote" class="text-xs text-slate-400 -mt-1"></div>

      <div class="grid grid-cols-3 gap-2">
        <div>
          <div class="text-xs text-slate-500 mb-1">${tr('prepTime')}</div>
          <input id="rTime" type="number" placeholder="60" class="w-full px-3 py-2 border rounded-xl" value="${rec?.prep_time_minutes||rec?.prep_time||''}">
        </div>
        <div>
          <div class="text-xs text-slate-500 mb-1">${tr('sellingPrice')}</div>
          <input id="rPrice" type="number" step="0.01" placeholder="0.00" class="w-full px-3 py-2 border rounded-xl" value="${rec?.selling_price||''}">
        </div>
        <div>
          <div class="text-xs text-slate-500 mb-1">${tr('yieldText')}</div>
          <input id="rYield" placeholder="e.g. 5.5 kg" class="w-full px-3 py-2 border rounded-xl" value="${rec?.yield_text||rec?.yield||''}">
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div>
          <div class="text-xs text-slate-500 mb-1">${tr('prepEvery')}</div>
          <input id="rPrepFreq" type="number" min="1" placeholder="es. 7" class="w-full px-3 py-2 border rounded-xl" value="${rec?.prep_frequency_days||''}">
        </div>
        <div>
          <div class="text-xs text-slate-500 mb-1">${tr('shelfLife')}</div>
          <input id="rShelfLife" type="number" min="1" placeholder="es. 7" class="w-full px-3 py-2 border rounded-xl" value="${rec?.shelf_life_days||''}">
        </div>
      </div>

      <div>
        <div class="flex items-center justify-between mb-1">
          <div class="font-semibold">Ingredients <span class="text-xs text-slate-400 font-normal">qty · unit · name · note</span></div>
          <div class="flex gap-2">
            <button id="addSection" class="text-xs text-slate-500 border rounded-lg px-2 py-1">+ section</button>
            <button id="addIng" class="text-xs text-emerald-600 border border-emerald-200 rounded-lg px-2 py-1">+ ingredient</button>
          </div>
        </div>
        <div id="ingList" class="space-y-1"></div>
      </div>

      <div><div class="font-semibold mb-1">${tr('equipment')}</div><textarea id="rEquip" class="w-full px-3 py-2 border rounded-xl h-16">${rec?.equipment||''}</textarea></div>
      <div><div class="font-semibold mb-1">${tr('procedure')}</div><textarea id="rProc" class="w-full px-3 py-2 border rounded-xl h-32">${rec?.procedure||''}</textarea></div>
    </div>
    <div class="p-3 border-t">
      <div style="display:flex;gap:8px;margin-bottom:8px;">
        <button onclick="this.closest('.fixed').remove()" class="flex-1 py-2.5 border rounded-xl">${tr("cancel")}</button>
        <button id="saveR" class="flex-1 py-2.5 bg-slate-900 text-white rounded-xl font-semibold">${tr("save")}</button>
      </div>
      ${rec?.id ? `<button id="deleteR" class="w-full py-2.5 text-red-500 border border-red-200 rounded-xl text-sm font-medium" style="background:#fff5f5;">${tr('deleteRecipe')}</button>` : ''}
    </div>
  </div>`;
  document.body.appendChild(modal);

  // Block horizontal swipe only — let vertical scroll work freely
  modal.addEventListener('touchmove', function(e){
    if(e.touches.length === 1){
      const dx = Math.abs(e.touches[0].clientX - (modal._tx||e.touches[0].clientX));
      const dy = Math.abs(e.touches[0].clientY - (modal._ty||e.touches[0].clientY));
      if(dx > dy) e.preventDefault();
    }
  }, {passive:false});
  modal.addEventListener('touchstart', function(e){
    if(e.touches.length===1){ modal._tx=e.touches[0].clientX; modal._ty=e.touches[0].clientY; }
  }, {passive:true});
  // Tap backdrop to close
  modal.addEventListener('click', function(e){ if(e.target===modal) modal.remove(); });

  // ── Photo upload logic ──
  (function initPhotoUpload(){
    const fileInput = modal.querySelector('#rImgFile');
    const imgBtn    = modal.querySelector('#rImgBtn');
    const hiddenUrl = modal.querySelector('#rImg');
    const preview   = modal.querySelector('#rImgPreview');
    const progress  = modal.querySelector('#rImgProgress');
    if(!fileInput || !imgBtn) return;

    imgBtn.onclick = ()=> fileInput.click();

    fileInput.addEventListener('change', async()=>{
      const file = fileInput.files[0];
      if(!file) return;

      // Comprimi a max 800px
      const compressed = await compressImage(file, 800);

      progress.style.display = 'block';
      imgBtn.disabled = true;

      try {
        const ext  = file.name.split('.').pop().toLowerCase() || 'jpg';
        const path = `recipes/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const { data, error } = await supa.storage.from('app').upload(path, compressed, {
          contentType: compressed.type,
          upsert: false
        });
        if(error) throw error;
        const { data: urlData } = supa.storage.from('app').getPublicUrl(path);
        const publicUrl = urlData.publicUrl;
        hiddenUrl.value = publicUrl;
        preview.innerHTML = `<img src="${publicUrl}" style="width:100%;height:100%;object-fit:cover;">`;
        imgBtn.textContent = tr('changePhoto');
      } catch(e) {
        alert(tr('uploadFailed') + ': ' + e.message);
      } finally {
        progress.style.display = 'none';
        imgBtn.disabled = false;
      }
    });
  })();

  // Serving weight hint
  const servInput  = modal.querySelector('#rServings');
  const weightInput = modal.querySelector('#rWeightKg');
  const swNote     = modal.querySelector('#servingWeightNote');
  function updateSwNote(){
    const s = parseInt(servInput.value)||0;
    const w = parseFloat(weightInput.value)||0;
    if(s > 0 && w > 0){
      const gPerServing = (w * 1000 / s);
      swNote.textContent = `= ${gPerServing >= 1000 ? (gPerServing/1000).toFixed(2).replace(/\.?0+$/,'')+'kg' : Math.round(gPerServing)+'g'} ${tr('perServing')}`;
    } else { swNote.textContent = ''; }
  }
  servInput.oninput  = updateSwNote;
  weightInput.oninput = updateSwNote;
  updateSwNote();

  // Ingredient rows
  const ingList = modal.querySelector('#ingList');
  const UNITS = ['g','kg','ml','l','oz','lb','cup','tbsp','tsp','each'];

  function addIngRow(d={qty:'',unit:'g',name:'',comment:'',type:'ingredient',ingredient_id:null,sub_recipe_id:null}){
    const row = document.createElement('div');
    row.dataset.type = 'ingredient';
    row.dataset.ingredientId = d.ingredient_id || '';
    row.dataset.subRecipeId  = d.sub_recipe_id  || '';
    row.draggable = true;
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '20px 56px 66px 1fr 80px auto';
    row.style.gap = '4px';
    row.style.alignItems = 'center';
    row.style.cursor = 'default';

    const linkedColor = d.ingredient_id ? '#10b981' : d.sub_recipe_id ? '#3b82f6' : '';
    const linkedBg    = d.ingredient_id ? '#f0fdf4' : d.sub_recipe_id ? '#eff6ff' : '';
    const safeName    = (d.name||'').replace(/"/g,'&quot;');

    row.innerHTML = `
      <div class="drag-handle" style="display:flex;align-items:center;justify-content:center;height:100%;cursor:grab;color:#cbd5e1;font-size:14px;user-select:none;-webkit-user-select:none;touch-action:none;">⠿</div>
      <input placeholder="200" class="px-2 py-1.5 border rounded text-xs" value="${d.qty||''}" type="number" min="0" step="any">
      <select class="px-1 py-1.5 border rounded text-xs bg-white">
        ${UNITS.map(u=>`<option ${(d.unit||'g')===u?'selected':''}>${u}</option>`).join('')}
      </select>
      <div style="position:relative;">
        <input placeholder="${tr('ingOrSubRecipe')}" class="ing-name-input w-full px-2 py-1.5 border rounded text-xs"
          value="${safeName}"
          style="border-color:${linkedColor};background:${linkedBg};">
        <div class="ing-ac-drop" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:9999;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);max-height:200px;overflow-y:auto;"></div>
      </div>
      <input placeholder="note" class="px-2 py-1.5 border rounded text-xs" value="${(d.comment||'').replace(/"/g,'&quot;')}">
      <button class="text-red-400 text-base" style="min-width:36px;min-height:36px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">✕</button>`;
    row.querySelector('button').onclick = ()=>row.remove();

    // ── Autocomplete ──
    const nameInput = row.querySelector('.ing-name-input');
    const drop      = row.querySelector('.ing-ac-drop');
    let _t = null;

    function resetLink(){
      row.dataset.ingredientId = '';
      row.dataset.subRecipeId  = '';
      nameInput.style.borderColor = '';
      nameInput.style.background  = '';
    }

    function selectItem(name, iid, rid){
      nameInput.value = name;
      row.dataset.ingredientId = iid || '';
      row.dataset.subRecipeId  = rid || '';
      nameInput.style.borderColor = iid ? '#10b981' : '#3b82f6';
      nameInput.style.background  = iid ? '#f0fdf4' : '#eff6ff';
      drop.style.display = 'none';
    }

    nameInput.addEventListener('input', ()=>{
      clearTimeout(_t);
      resetLink();
      const q = nameInput.value.trim();
      if(q.length < 2){ drop.style.display='none'; return; }
      _t = setTimeout(async()=>{
        const [ri, rr] = await Promise.all([
          supa.from('ingredients').select('id,name,category').ilike('name',`%${q}%`).eq('active',true).order('name').limit(8),
          supa.from('recipes').select('id,title,menu_group').ilike('title',`%${q}%`).order('title').limit(4)
        ]);
        const ings = ri.data||[], recs = rr.data||[];
        drop.innerHTML = [
          ...ings.map(i=>`<div class="ac-opt" data-iid="${i.id}" data-name="${i.name.replace(/"/g,'&quot;')}"
            style="padding:7px 10px;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #f8fafc;">
            <span><b>${i.name}</b> <span style="color:#94a3b8;font-size:10px;">${i.category||''}</span></span>
            <span style="font-size:9px;background:#f0fdf4;color:#059669;padding:1px 6px;border-radius:4px;flex-shrink:0;">ingredient</span>
          </div>`),
          ...recs.map(r=>`<div class="ac-opt" data-rid="${r.id}" data-name="${r.title.replace(/"/g,'&quot;')}"
            style="padding:7px 10px;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #f8fafc;">
            <span><b>${r.title}</b> <span style="color:#94a3b8;font-size:10px;">${r.menu_group||''}</span></span>
            <span style="font-size:9px;background:#eff6ff;color:#3b82f6;padding:1px 6px;border-radius:4px;flex-shrink:0;">sub-recipe</span>
          </div>`),
          `<div class="ac-create" data-q="${q.replace(/"/g,'&quot;')}"
            style="padding:8px 10px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px;border-top:1px solid #e2e8f0;color:#6366f1;font-weight:600;">
            <span style="font-size:14px;">＋</span> Create &ldquo;${q}&rdquo;
          </div>`
        ].join('');
        drop.style.display = 'block';
        drop.querySelectorAll('.ac-opt').forEach(el=>{
          el.addEventListener('mousedown', e=>{
            e.preventDefault();
            selectItem(el.dataset.name, el.dataset.iid||'', el.dataset.rid||'');
          });
        });
        drop.querySelectorAll('.ac-create').forEach(el=>{
          el.addEventListener('mousedown', e=>{
            e.preventDefault();
            drop.style.display = 'none';
            openCreateIngredientModal(el.dataset.q, (newIng)=>{
              selectItem(newIng.name, newIng.id, '');
            });
          });
        });
      }, 220);
    });

    nameInput.addEventListener('blur', ()=>{ setTimeout(()=>{ drop.style.display='none'; }, 160); });
    ingList.appendChild(row);
  }

  function addSectionRow(d={name:''}){
    const row = document.createElement('div');
    row.dataset.type = 'section';
    row.draggable = true;
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '20px 1fr auto';
    row.style.gap = '4px';
    row.style.alignItems = 'center';
    row.innerHTML = `
      <div class="drag-handle" style="display:flex;align-items:center;justify-content:center;height:100%;cursor:grab;color:#cbd5e1;font-size:14px;user-select:none;-webkit-user-select:none;touch-action:none;">⠿</div>
      <input placeholder="${tr('sectionLabel')}" class="px-2 py-1.5 border-2 border-dashed border-slate-200 rounded text-xs font-semibold text-slate-500 bg-slate-50" value="${d.name||''}">
      <button class="text-red-400 text-base" style="min-width:36px;min-height:36px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">✕</button>`;
    row.querySelector('button').onclick = ()=>row.remove();
    ingList.appendChild(row);
  }

  // Populate existing ingredients — legge dal BOM se ricetta esistente
  async function populateIngredients(){
    if(rec?.id){
      // Ricetta esistente: legge dal BOM (ha UUID reali → bordo verde → BOM al salvataggio)
      const {data: bomRows} = await supa
        .from('recipe_bom')
        .select('bom_id, item_id, sub_recipe_id, quantity, unit, notes, component_type, sort_order, ingredients(name), recipes!recipe_bom_sub_recipe_id_fkey(title)')
        .eq('parent_recipe_id', rec.id)
        .order('sort_order', {nullsFirst: false})
        .order('bom_id');

      if(bomRows && bomRows.length > 0){
        bomRows.forEach(b => {
          const isSubRecipe = b.component_type === 'RECIPE';
          addIngRow({
            qty:           b.quantity,
            unit:          b.unit || 'g',
            name:          isSubRecipe ? (b.recipes?.title || '') : (b.ingredients?.name || ''),
            comment:       b.notes || '',
            ingredient_id: isSubRecipe ? null : (b.item_id || null),
            sub_recipe_id: isSubRecipe ? (b.sub_recipe_id || null) : null
          });
        });
        return;
      }
      // BOM vuoto — fallback al JSON (ricetta nuova o senza BOM ancora)
    }
    // Nuova ricetta: 3 righe vuote
    const fallback = rec?.ingredients || [{},{},{}];
    fallback.forEach(i=>{
      if(i.type === 'section') addSectionRow(i);
      else addIngRow({
        qty:           i.qty,
        unit:          i.unit,
        name:          i.name,
        comment:       i.comment,
        ingredient_id: i.ingredient_id || null,
        sub_recipe_id: i.sub_recipe_id  || null
      });
    });
  }
  populateIngredients();

  // ── Drag & drop riordinamento ingredienti ──
  (function initIngDragDrop(){
    let _dragging = null;
    let _touchDrag = null;

    function getDragAfterElement(container, y){
      const els = [...container.querySelectorAll('[draggable="true"]:not(.dragging-ghost)')];
      return els.reduce((closest, el)=>{
        const box = el.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if(offset < 0 && offset > closest.offset) return {offset, element: el};
        return closest;
      }, {offset: Number.NEGATIVE_INFINITY}).element;
    }

    // Mouse / pointer drag (desktop)
    ingList.addEventListener('dragstart', e=>{
      const handle = e.target.closest('.drag-handle');
      const row = e.target.closest('[draggable="true"]');
      if(!handle || !row){ e.preventDefault(); return; }
      _dragging = row;
      row.classList.add('dragging-ghost');
      row.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
    });
    ingList.addEventListener('dragend', e=>{
      if(_dragging){ _dragging.style.opacity = ''; _dragging.classList.remove('dragging-ghost'); }
      _dragging = null;
      ingList.querySelectorAll('.drag-over-indicator').forEach(el=>el.remove());
    });
    ingList.addEventListener('dragover', e=>{
      e.preventDefault();
      if(!_dragging) return;
      const after = getDragAfterElement(ingList, e.clientY);
      ingList.querySelectorAll('.drag-over-indicator').forEach(el=>el.remove());
      const ind = document.createElement('div');
      ind.className = 'drag-over-indicator';
      ind.style.cssText = 'height:2px;background:#6366f1;border-radius:2px;margin:1px 0;';
      if(after) ingList.insertBefore(ind, after);
      else ingList.appendChild(ind);
    });
    ingList.addEventListener('drop', e=>{
      e.preventDefault();
      if(!_dragging) return;
      const after = getDragAfterElement(ingList, e.clientY);
      if(after) ingList.insertBefore(_dragging, after);
      else ingList.appendChild(_dragging);
      ingList.querySelectorAll('.drag-over-indicator').forEach(el=>el.remove());
    });

    // Touch drag (iPhone)
    ingList.addEventListener('touchstart', e=>{
      const handle = e.target.closest('.drag-handle');
      if(!handle) return;
      const row = handle.closest('[draggable="true"]');
      if(!row) return;
      _touchDrag = {row, startY: e.touches[0].clientY};
      row.style.opacity = '0.5';
      e.stopPropagation();
    }, {passive: true});

    ingList.addEventListener('touchmove', e=>{
      if(!_touchDrag) return;
      e.preventDefault();
      e.stopPropagation();
      const y = e.touches[0].clientY;
      const after = getDragAfterElement(ingList, y);
      ingList.querySelectorAll('.drag-over-indicator').forEach(el=>el.remove());
      const ind = document.createElement('div');
      ind.className = 'drag-over-indicator';
      ind.style.cssText = 'height:2px;background:#6366f1;border-radius:2px;margin:1px 0;';
      if(after) ingList.insertBefore(ind, after);
      else ingList.appendChild(ind);
    }, {passive: false});

    ingList.addEventListener('touchend', e=>{
      if(!_touchDrag) return;
      const y = e.changedTouches[0].clientY;
      const after = getDragAfterElement(ingList, y);
      if(after) ingList.insertBefore(_touchDrag.row, after);
      else ingList.appendChild(_touchDrag.row);
      _touchDrag.row.style.opacity = '';
      ingList.querySelectorAll('.drag-over-indicator').forEach(el=>el.remove());
      _touchDrag = null;
    }, {passive: true});
  })();

  modal.querySelector('#addIng').onclick     = ()=>addIngRow();
  modal.querySelector('#addSection').onclick = ()=>addSectionRow();

  // Save
  modal.querySelector('#saveR').onclick = async()=>{
    const t = modal.querySelector('#rTitle').value.trim();
    if(!t){ alert(tr('titleRequired')); return; }

    const bs       = parseInt(servInput.value)||null;
    const wkg      = parseFloat(weightInput.value)||null;
    const bwg      = wkg ? Math.round(wkg * 1000) : null;
    const swg      = (bs && bwg) ? Math.round(bwg / bs) : null;
    const sp       = parseFloat(modal.querySelector('#rPrice')?.value)||null;

    // Collect ingredients — both section headers and ingredient rows
    // Retrocompatibile: righe vecchie non hanno .ing-name-input — fallback su tutti gli input testo
    const ingredients = [...ingList.children].map(row=>{
      if(row.dataset.type === 'section'){
        return { type:'section', name: row.querySelector('input').value.trim() };
      }
      const qtyEl  = row.querySelector('input[type="number"]');
      const unitEl = row.querySelector('select');
      // Nome: preferisce .ing-name-input (righe nuove), fallback primo input testo (righe vecchie)
      const nameEl = row.querySelector('.ing-name-input') ||
                     [...row.querySelectorAll('input')].find(el => el.type !== 'number');
      // Note: ultimo input testo che non è il nome
      const allTextInputs = [...row.querySelectorAll('input')].filter(el => el.type !== 'number' && el !== nameEl);
      const commentEl = allTextInputs[allTextInputs.length - 1] || null;
      return {
        qty:           parseFloat(qtyEl?.value)||qtyEl?.value||'',
        unit:          unitEl?.value||'g',
        name:          nameEl?.value.trim()||'',
        comment:       commentEl?.value.trim()||'',
        ingredient_id: row.dataset.ingredientId || null,
        sub_recipe_id: row.dataset.subRecipeId  || null
      };
    }).filter(i=> i.type==='section' ? i.name : i.name);

    const newRec = {
      title:             t,
      menu_group:        modal.querySelector('#rMenuGroup').value || null,
      pos_name:          modal.querySelector('#rPosName').value.trim() || null,
      prep_frequency_days: parseInt(modal.querySelector('#rPrepFreq').value) || null,
      shelf_life_days:     parseInt(modal.querySelector('#rShelfLife').value) || null,
      yield_text:        modal.querySelector('#rYield').value,
      prep_time_minutes: parseInt(modal.querySelector('#rTime').value)||null,
      image_url:         modal.querySelector('#rImg').value.trim() || null,
      equipment:         modal.querySelector('#rEquip').value,
      procedure:         modal.querySelector('#rProc').value,
      selling_price:     sp,
      base_servings:     bs,
      base_weight_g:     bwg,
      serving_weight_g:  swg
      // NOTE: ingredients NON va nel payload recipes — stanno in recipe_bom
    };

    try{
      let savedId = rec?.id;
      if(rec?.id){
        const {error: updErr} = await supa.from('recipes').update(newRec).eq('id',rec.id);
        if(updErr) throw updErr;
        await supa.from('recipe_translations').delete().eq('recipe_id',rec.id);
      } else {
        const {data:inserted} = await supa.from('recipes').insert(newRec).select('id').single();
        savedId = inserted?.id;
      }
      if(savedId) await saveRecipeBOM(savedId, ingredients);
      if(savedId) translateAndSaveRecipe(savedId, newRec); // fire-and-forget — non blocca il save
      modal.remove();
      await init();
      renderRecipes();
      // Riapri la detail sheet con dati freschi se era aperta
      if(savedId) {
        const oldSheet = document.getElementById('_recipeDetailSheet');
        if(oldSheet) {
          oldSheet.remove();
          const freshRec = SHOP_RECIPES.find(r=>r.id===savedId);
          if(freshRec) showRecipeSheet(freshRec);
        }
      }
    }catch(e){ alert(tr('error_prefix2')+e.message); }
  };

  // ── Delete recipe button ──
  const deleteBtn = modal.querySelector('#deleteR');
  if(deleteBtn && rec?.id){
    deleteBtn.onclick = async()=>{
      const confirmed = confirm(`${tr('deleteRecipe')} "${rec.title}"?`);
      if(!confirmed) return;
      try {
        await supa.from('recipe_bom').delete().eq('parent_recipe_id', rec.id);
        await supa.from('recipe_translations').delete().eq('recipe_id', rec.id);
        await supa.from('recipes').delete().eq('id', rec.id);
        modal.remove();
        await init();
        renderRecipes();
      } catch(e){ alert(tr('error_deleting') + e.message); }
    };
  }
}

function linkRecipeToItem(title){
  const name = prompt('Link "'+title+'" to which prep item?\n'+items.map(i=>i.name).join(', '));
  if(!name) return;
  const it = items.find(i=>i.name.toLowerCase()===name.toLowerCase());
  if(it){ recipeLinks[it.id]=title; alert(tr('linked_to')+it.name); }
  else alert(tr('item_not_found'));
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
  // Exact match
  const r1 = await supa.from('ingredients').select('id,name').eq('name',name).eq('active',true).maybeSingle();
  if(r1.data) return r1.data;
  // Case-insensitive exact match
  const r2 = await supa.from('ingredients').select('id,name').ilike('name',name).eq('active',true).limit(1);
  if(r2.data?.length) return r2.data[0];
  // Fuzzy only if first word is 4+ chars AND name has only one word (avoid "cacio e pepe" → wrong match)
  const words = name.trim().split(/\s+/);
  if(words.length === 1 && words[0].length >= 4){
    const r3 = await supa.from('ingredients').select('id,name').ilike('name',`%${words[0]}%`).eq('active',true).limit(1);
    if(r3.data?.length) return r3.data[0];
  }
  return null;
}

async function calcRecipeFoodCost(rec){
  const el = document.getElementById(`recipeFoodCost_${rec.id||'x'}`);
  if(!el) return;

  // Skip section headers for food cost
  const ings = (rec.ingredients||[]).filter(i=>i.name && i.type !== 'section');
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
    if(!ingr || !ingr.id || !/^[0-9a-f-]{36}$/i.test(ingr.id))
      return {name:ing.name, qty:ing.qty, unit:ing.unit, qtyG, issue:'Ingredient not linked — name does not match ingredients table'};

    const {data:prices} = await supa.from('ingredient_vendors')
      .select('price_per_100g,vendor,unit_price,purchase_unit,conversion_to_base,pack_description,price_type')
      .eq('ingredient_id', ingr.id)
      .eq('active', true)
      .order('price_per_100g', {ascending: true})
      .limit(1);

    if(!prices?.length)
      return {name:ing.name, qty:ing.qty, unit:ing.unit, qtyG, issue:'No vendor data — add a vendor or import an invoice'};

    const p = prices[0];
    const p100 = p.price_per_100g || (()=>{
      const base = p.conversion_to_base
        || (p.purchase_unit ? LOCAL_CONV[p.purchase_unit.toLowerCase()] : null);
      return p.unit_price && base ? (p.unit_price/base)*100 : null;
    })();

    if(!p100)
      return {name:ing.name, qty:ing.qty, unit:ing.unit, qtyG,
        issue:`Missing price_per_100g for ${p.vendor} — edit vendor row to add weight/conversion`};

    return {name:ing.name, qty:ing.qty, unit:ing.unit, qtyG, price_per_100g:p100, vendor:p.vendor, lineCost:(qtyG/100)*p100};
  }));

  const costed         = resolved.filter(r=>r.lineCost!=null);
  const issues         = resolved.filter(r=>r.issue);
  const totalCost      = costed.reduce((s,r)=>s+r.lineCost, 0);
  const servings       = rec.base_servings||1;
  const costPerServing = totalCost/servings;
  const fcPct          = rec.selling_price ? (costPerServing/parseFloat(rec.selling_price))*100 : null;
  const fcColor        = fcPct ? (fcPct<28?'#10b981':fcPct<35?'#f59e0b':'#ef4444') : '#94a3b8';

  if(fcPct && rec.id){
    supa.from('recipes').update({food_cost_pct:parseFloat(fcPct.toFixed(1))}).eq('id',rec.id).then(()=>{});
  }

  el.innerHTML = `
    <div style="background:#f8fafc;border-radius:14px;padding:12px;margin-bottom:8px;">
      <div style="font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin-bottom:10px;">${tr('recipe_food_cost')}</div>

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
          <div style="font-size:13px;font-weight:600;color:#1e293b;">${tr('costPerServing')}</div>
          ${servings>1?`<div style="font-size:10px;color:#94a3b8;">${servings} servings · total $${totalCost.toFixed(2)}</div>`:''}
        </div>
        <div style="text-align:right;">
          <div style="font-size:16px;font-weight:700;color:#1e293b;">$${costPerServing.toFixed(2)}</div>
          ${fcPct!=null
            ? `<div style="font-size:12px;font-weight:600;color:${fcColor};">${fcPct.toFixed(1)}% FC</div>`
            : `<div style="font-size:10px;color:#94a3b8;">${tr('setSellingPrice')}</div>`}
        </div>
      </div>` : ''}

      ${issues.length ? `
      <div style="margin-top:8px;padding-top:8px;border-top:0.5px dashed #e2e8f0;">
        <div style="font-size:10px;font-weight:600;color:#94a3b8;margin-bottom:4px;">${tr('whyCostsMissing')}</div>
        ${issues.map(r=>`<div style="font-size:10px;color:#f59e0b;margin-bottom:2px;">· <b>${r.name}</b>: ${r.issue}</div>`).join('')}
      </div>` : ''}
    </div>`;
}

// ── RECIPE SALES STATS (opzione B — pillole) ─────────────────────────
async function loadRecipeSalesStats(rec, sheetEl) {
  const el = sheetEl.querySelector('#recipeSalesStats');
  if (!el) return;

  try {
    const sb = supa;

    // Date ultima settimana (lun→sab scorsi)
    const today = new Date(); today.setHours(0,0,0,0);
    const dow = today.getDay(); // 0=dom, 1=lun...6=sab
    const daysToThisMon = (dow + 6) % 7;
    const thisMon = new Date(today); thisMon.setDate(today.getDate() - daysToThisMon);
    const lastMon = new Date(thisMon); lastMon.setDate(thisMon.getDate() - 7);
    const lastSat = new Date(lastMon); lastSat.setDate(lastMon.getDate() + 5);

    const isoFrom = lastMon.toISOString().slice(0,10);
    const isoTo   = lastSat.toISOString().slice(0,10);

    // pos_name può contenere pipe-separated (es. "Brussel Sprouts|Brussels")
    const posNames = rec.pos_name.split('|').map(s => s.trim()).filter(Boolean);
    const isSide = rec.menu_group === 'Sides';

    // Fattore porzione per ogni variante: half/child/modifier aggiunta = 0.5, full = 1
    const portionFactor = (name) => {
      const low = name.toLowerCase();
      if (low.includes('half') || low.includes('child')) return 0.5;
      if (low.startsWith('add ') || low.startsWith('sub ') || low === 'spaghetti' || low === 'fettuccine' || low === 'fettuccine pasta') return 0.5;
      return 1;
    };

    // Vendite come piatto (pos_sales_by_item)
    let allItemRows = [];
    for (const pn of posNames) {
      const { data } = await sb.from('pos_sales_by_item')
        .select('sale_date,quantity')
        .gte('sale_date', isoFrom).lte('sale_date', isoTo)
        .eq('is_historical', false).ilike('menu_item', '%' + pn + '%');
      if (data) allItemRows = allItemRows.concat(data);
    }

    // Vendite come modifier (pos_modifiers) — per Sides E per ricette con modifier nel pos_name
    let allModRows = [];
    const modNames = posNames.filter(pn => {
      const low = pn.toLowerCase();
      return isSide || low.startsWith('add ') || low.startsWith('sub ') || low === 'spaghetti' || low === 'fettuccine' || low === 'fettuccine pasta' || low.includes('half') && !low.includes('al ');
    });
    for (const pn of (isSide ? posNames : modNames)) {
        const { data } = await sb.from('pos_modifiers')
          .select('sale_date,quantity_sold')
          .gte('sale_date', isoFrom).lte('sale_date', isoTo)
          .eq('is_historical', false).ilike('modifier', '%' + pn + '%');
        if (data) allModRows = allModRows.concat(data);
    }

    // Calcola feriali (lun→gio = dow 1,2,3,4) e weekend (ven+sab = dow 5,6)
    let ferC = 0, ferDays = 0, wkC = 0, wkDays = 0;
    const counted = {};

    allItemRows.forEach(r => {
      const dw = new Date(r.sale_date + 'T12:00:00').getDay();
      // Trova il pos_name che ha matchato questa voce per applicare il fattore corretto
      const matchedName = posNames.find(pn => r.menu_item && r.menu_item.toLowerCase().includes(pn.toLowerCase())) || posNames[0];
      const factor = portionFactor(matchedName);
      const q = (Number(r.quantity) || 0) * factor;
      if (dw >= 1 && dw <= 4) { ferC += q; if (!counted['fer_' + r.sale_date]) { counted['fer_' + r.sale_date] = 1; ferDays++; } }
      if (dw === 5 || dw === 6) { wkC += q; if (!counted['wk_' + r.sale_date]) { counted['wk_' + r.sale_date] = 1; wkDays++; } }
    });

    // Modifier: Brussels modifier = 0.5 (aggiunta su piatto), Brussels side item = 1.0
    // Regola Zenos: modifier = mezza porzione, side = porzione intera
    allModRows.forEach(r => {
      const dw = new Date(r.sale_date + 'T12:00:00').getDay();
      const q = (Number(r.quantity_sold) || 0) * 0.5;
      if (dw >= 1 && dw <= 4) { ferC += q; if (!counted['fer_' + r.sale_date]) { counted['fer_' + r.sale_date] = 1; ferDays++; } }
      if (dw === 5 || dw === 6) { wkC += q; if (!counted['wk_' + r.sale_date]) { counted['wk_' + r.sale_date] = 1; wkDays++; } }
    });

    // Nessun dato
    if (ferC === 0 && wkC === 0) { el.innerHTML = ''; return; }

    // Media giornaliera (per stima prep today) e totali del periodo
    const ferAvg = ferDays > 0 ? ferC / ferDays : 0;
    const wkAvg  = wkDays  > 0 ? wkC  / wkDays  : 0;
    const ferTotal = Math.ceil(ferC);
    const wkTotal  = Math.ceil(wkC);

    // Oggi è feriale o weekend?
    const todayDow = today.getDay();
    const isWeekendToday = todayDow === 5 || todayDow === 6;
    const baseAvg = isWeekendToday ? wkAvg : ferAvg;
    const prepSuggested = Math.ceil(baseAvg * 1.15);

    // Testi localizzati
    const lang = window.user?.lang || 'en';
    const portionWord = { it: 'porzioni', en: 'portions', es: 'porciones' }[lang] || 'portions';
    const fmtTotal = v => v > 0 ? v + ' ' + portionWord : '—';

    // Frase contestuale Chef AI sotto il prep today
    const refTotal = isWeekendToday ? wkTotal : ferTotal;
    const refPeriod = isWeekendToday
      ? { it: 'ven+sab scorsi', en: 'last Fri+Sat', es: 'vie+sáb pasados' }[lang]
      : { it: 'lun→gio scorsi', en: 'last Mon→Thu', es: 'lun→jue pasados' }[lang];
    const aiHint = refTotal > 0
      ? { it: refPeriod + ' ne hai vendute ' + refTotal + ' — tieniti pronto.',
          en: refPeriod + ' you sold ' + refTotal + ' — stay ready.',
          es: refPeriod + ' vendiste ' + refTotal + ' — estate listo.' }[lang]
      : '';

    // Render pillole
    const hasVariants = posNames.length > 1;

    el.innerHTML =
      '<div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;">Last week · total' + (hasVariants ? ' · equiv. portions' : '') + '</div>' +
      '<div style="display:flex;gap:8px;">' +

      '<div style="flex:1;background:#f8faff;border:1px solid #e0e7ff;border-radius:10px;padding:8px 10px;text-align:center;">' +
        '<div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px;">Mon→Thu</div>' +
        '<div style="font-size:16px;font-weight:900;color:#6366f1;line-height:1;">' + fmtTotal(ferTotal) + '</div>' +
      '</div>' +

      '<div style="flex:1;background:#f8faff;border:1px solid #e0e7ff;border-radius:10px;padding:8px 10px;text-align:center;">' +
        '<div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px;">Fri+Sat</div>' +
        '<div style="font-size:16px;font-weight:900;color:#059669;line-height:1;">' + fmtTotal(wkTotal) + '</div>' +
      '</div>' +

      (prepSuggested > 0 ?
      '<div style="flex:1;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:8px 10px;text-align:center;">' +
        '<div style="font-size:9px;font-weight:700;color:#059669;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px;">'+tr('recipe_prep_today')+'</div>' +
        '<div style="font-size:16px;font-weight:900;color:#059669;line-height:1;">' + prepSuggested + ' ' + portionWord + '</div>' +
        (aiHint ? '<div style="font-size:8px;color:#059669;margin-top:4px;line-height:1.3;">' + aiHint + '</div>' : '') +
      '</div>' : '') +

      '</div>';

  } catch(e) {
    // Silenzioso — non mostrare errori nella preview
    console.warn('recipeSalesStats error:', e.message);
  }
}


// ── RECIPE PREP STATS (pill suggested_qty per ricette prep senza pos_name) ──
async function loadRecipePrepStats(rec, sheetEl) {
  const el = sheetEl.querySelector('#recipePrepStats');
  if (!el) return;

  try {
    const sb = supa;

    // Cerca prep_task collegata direttamente (prep_tasks.recipe_id = rec.id)
    let ptDirect = null;
    const { data: ptRows } = await sb.from('prep_tasks')
      .select('id, name, suggested_qty, suggested_by, suggested_at')
      .eq('recipe_id', rec.id)
      .not('suggested_qty', 'is', null)
      .limit(1);
    if (ptRows && ptRows.length) ptDirect = ptRows[0];

    // Se non trovata, cerca tramite recipe_bom (questa ricetta è sub_recipe_id di qualcuno,
    // e quel bom_id ha prep_task_id con suggested_qty)
    // Oppure: recipe_bom.sub_recipe_id = rec.id AND prep_task_id IS NOT NULL
    let ptVia = null;
    if (!ptDirect) {
      const { data: bomRows } = await sb.from('recipe_bom')
        .select('prep_task_id, prep_tasks(id, name, suggested_qty, suggested_by, suggested_at)')
        .eq('sub_recipe_id', rec.id)
        .not('prep_task_id', 'is', null)
        .limit(1);
      if (bomRows && bomRows.length && bomRows[0].prep_tasks?.suggested_qty) {
        ptVia = bomRows[0].prep_tasks;
      }
    }

    const pt = ptDirect || ptVia;
    if (!pt || !pt.suggested_qty) { el.innerHTML = ''; return; }

    const sugG = parseFloat(pt.suggested_qty);   // grammi
    const baseG = parseFloat(rec.base_weight_g);  // grammi per batch
    const sugKg = (sugG / 1000).toFixed(2).replace(/\.?0+$/, '');
    const batches = baseG ? (sugG / baseG).toFixed(2).replace(/\.?0+$/, '') : null;
    const batchLabel = batches && baseG ? ` (≈ ${batches} ${tr('batchOf')} ${(baseG/1000).toFixed(1).replace(/\.?0+$/,'')}kg)` : '';

    // Aggiorna lo scaler per partire da suggested_qty
    const inputWeight = sheetEl.querySelector('#scaleWeight');
    const inputServ   = sheetEl.querySelector('#scaleServings');
    const scaleNote   = sheetEl.querySelector('#scaleNote');
    if (inputWeight && sugKg) {
      inputWeight.value = sugKg;
      // Triggera il cambio peso per scalare gli ingredienti
      inputWeight.dispatchEvent(new Event('input'));
    }

    el.innerHTML =
      `<div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;">${tr('botSuggestion')} · ${tr('thisWeek')}</div>` +
      '<div style="display:flex;gap:8px;">' +
        '<div style="flex:1;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px 12px;display:flex;align-items:center;gap:8px;">' +
          '<span style="font-size:18px;">🤖</span>' +
          '<div>' +
            '<div style="font-size:17px;font-weight:900;color:#059669;line-height:1;">' + sugKg + ' kg</div>' +
            `<div style="font-size:10px;color:#6b7280;margin-top:2px;">${tr('recommended')}</div>` +
          '</div>' +
        '</div>' +
      '</div>';

  } catch(e) {
    console.warn('recipePrepStats error:', e.message);
  }
}

// ── RECIPE BOM — save structured links ───────────────────────
// ── Comprimi immagine prima upload (max maxPx lato lungo) ──
function compressImage(file, maxPx = 800){
  return new Promise((resolve)=>{
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = ()=>{
      URL.revokeObjectURL(url);
      let {width: w, height: h} = img;
      if(w > maxPx || h > maxPx){
        if(w >= h){ h = Math.round(h * maxPx / w); w = maxPx; }
        else       { w = Math.round(w * maxPx / h); h = maxPx; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => resolve(blob || file), 'image/jpeg', 0.82);
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// ── PRE-TRANSLATE recipe on save (EN + ES) ───────────────────
// Called after every insert/update so translations are ready in DB
// before any cook opens the recipe. Zero on-demand AI calls needed.
async function translateAndSaveRecipe(recipeId, rec){
  if(!recipeId) return;
  const langs = ['en','es'];
  for(const lang of langs){
    try{
      const translatedProcedure = rec.procedure ? await groqTranslate(rec.procedure, lang) : '';
      const translatedEquipment = rec.equipment ? await groqTranslate(rec.equipment, lang) : '';
      await supa.from('recipe_translations').upsert({
        recipe_id: recipeId,
        lang,
        title:     rec.title,   // titolo non si traduce — nome proprio
        procedure: translatedProcedure,
        equipment: translatedEquipment,
      });
    }catch(e){
      console.warn('translateAndSaveRecipe failed for lang='+lang, e);
    }
  }
}

async function saveRecipeBOM(recipeId, ingredientRows){
  // Delete existing BOM rows for this recipe
  await supa.from('recipe_bom').delete().eq('parent_recipe_id', recipeId);

  const rows = ingredientRows
    .filter(i => i.type !== 'section' && (i.ingredient_id || i.sub_recipe_id))
    .map((i, idx) => ({
      parent_recipe_id: recipeId,
      component_type:   i.sub_recipe_id ? 'RECIPE' : 'ITEM',
      item_id:          i.ingredient_id || null,
      sub_recipe_id:    i.sub_recipe_id || null,
      quantity:         parseFloat(i.qty) || null,
      unit:             i.unit || null,
      notes:            i.comment || null,
      sort_order:       idx + 1
    }));

  if(!rows.length) return;
  const {error} = await supa.from('recipe_bom').insert(rows);
  if(error) console.error('[BOM] insert error:', error);
}




// ── CREA NUOVO INGREDIENTE DA RICETTA ────────────────────────
function openCreateIngredientModal(prefillName, onCreated){
  const CATEGORIES = ['Produce','Dairy','Meat','Seafood','Dry Goods','Oil & Vinegar','Spices & Herbs','Beverages & Spirits','Prepared','Bakery','Frozen','Supply'];
  const UNITS = [{v:'g',l:'g — grams (weight)'},{v:'ml',l:'ml — milliliters (volume)'},{v:'each',l:'each — count'}];

  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-[300] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4';
  modal.innerHTML = `
    <div style="background:white;border-radius:20px;padding:20px;width:100%;max-width:340px;box-shadow:0 8px 32px rgba(0,0,0,.18);">
      <div style="font-size:16px;font-weight:700;color:#1e293b;margin-bottom:16px;">✨ New Ingredient</div>

      <div style="margin-bottom:12px;">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px;">Name</div>
        <input id="ciName" value="${(prefillName||'').replace(/"/g,'&quot;')}"
          style="width:100%;border:1.5px solid #e2e8f0;border-radius:10px;padding:9px 12px;font-size:14px;box-sizing:border-box;">
      </div>

      <div style="margin-bottom:12px;">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px;">Category</div>
        <select id="ciCat" style="width:100%;border:1.5px solid #e2e8f0;border-radius:10px;padding:9px 12px;font-size:14px;background:white;box-sizing:border-box;">
          <option value="">— select —</option>
          ${CATEGORIES.map(c=>`<option value="${c}">${c}</option>`).join('')}
        </select>
      </div>

      <div style="margin-bottom:20px;">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px;">Base Unit</div>
        <select id="ciUnit" style="width:100%;border:1.5px solid #e2e8f0;border-radius:10px;padding:9px 12px;font-size:14px;background:white;box-sizing:border-box;">
          <option value="">— select —</option>
          ${UNITS.map(u=>`<option value="${u.v}">${u.l}</option>`).join('')}
        </select>
      </div>

      <div style="display:flex;gap:8px;">
        <button id="ciCancel" style="flex:1;padding:11px;border:1.5px solid #e2e8f0;border-radius:12px;font-size:14px;font-weight:600;color:#64748b;background:white;cursor:pointer;">Cancel</button>
        <button id="ciSave" style="flex:2;padding:11px;background:#6366f1;border:none;border-radius:12px;font-size:14px;font-weight:700;color:white;cursor:pointer;">Create Ingredient</button>
      </div>
      <div id="ciError" style="color:#ef4444;font-size:12px;margin-top:8px;display:none;"></div>
    </div>`;

  document.body.appendChild(modal);

  modal.querySelector('#ciCancel').onclick = ()=>modal.remove();

  modal.querySelector('#ciSave').onclick = async()=>{
    const name = modal.querySelector('#ciName').value.trim();
    const cat  = modal.querySelector('#ciCat').value;
    const unit = modal.querySelector('#ciUnit').value;
    const errEl = modal.querySelector('#ciError');

    if(!name){ errEl.textContent='Name is required'; errEl.style.display='block'; return; }
    if(!cat){  errEl.textContent='Select a category'; errEl.style.display='block'; return; }
    if(!unit){ errEl.textContent='Select a base unit'; errEl.style.display='block'; return; }

    const measureType = unit==='g' ? 'weight' : unit==='ml' ? 'volume' : 'count';

    const btn = modal.querySelector('#ciSave');
    btn.textContent = 'Creating...';
    btn.disabled = true;

    const {data, error} = await supa.from('ingredients')
      .insert({name, category:cat, base_unit:unit, measure_type:measureType, active:true})
      .select('id,name')
      .single();

    if(error){
      errEl.textContent = 'Error: '+error.message;
      errEl.style.display='block';
      btn.textContent='Create Ingredient';
      btn.disabled=false;
      return;
    }

    modal.remove();
    if(onCreated) onCreated(data);
  };
}


// ── PREP STEPS — espansione inline nella card ──────────────────────────
window._prepStepTimers = window._prepStepTimers || {};

async function togglePrepStepsExpand(taskId, steps){
  const expandId = 'prep-steps-expand-' + taskId;
  const existing = document.getElementById(expandId);
  if(existing){ existing.remove(); return; }

  // Chiudi altri pannelli aperti
  document.querySelectorAll('[id^="prep-steps-expand-"]').forEach(el=>el.remove());

  // Trova la card nel DOM
  let parentCard = null;
  document.querySelectorAll('[style*="border-radius:16px"]').forEach(el=>{
    if(el.innerHTML.includes(`openRecipeForItem(${JSON.stringify(taskId)})`)) parentCard = el;
  });
  if(!parentCard) return;

  // Carica log step di oggi
  const today = new Date().toISOString().slice(0,10);
  const {data: logs} = await supa.from('prep_step_log')
    .select('*').eq('prep_task_id', taskId).eq('log_date', today);
  const logMap = {};
  (logs||[]).forEach(l=>{ logMap[l.step_id] = l; });

  const activeIdx = steps.findIndex(s => !logMap[s.id]?.completed_at);

  const panel = document.createElement('div');
  panel.id = expandId;
  panel.style.cssText = 'overflow:hidden;transition:max-height .3s ease;max-height:0;';

  const inner = document.createElement('div');
  inner.style.cssText = 'padding:8px 14px 12px 14px;border-top:1px solid rgba(0,0,0,0.06);';

  inner.innerHTML = steps.map((s,idx)=>{
    const log = logMap[s.id];
    const isDone = !!log?.completed_at;
    const isActive = idx === activeIdx;
    const isLocked = !isDone && idx > activeIdx;
    const timer = window._prepStepTimers[taskId+'_'+s.id];

    let timerHtml = '';
    if(s.timer_minutes && !isLocked){
      if(isDone) timerHtml = `<span style="font-size:10px;color:#059669;font-weight:600;">⏱ ${s.timer_minutes}min — completato</span>`;
      else if(timer) timerHtml = `<span id="step-timer-${s.id}" style="font-size:11px;color:#f59e0b;font-weight:700;">⏱ --:--</span>`;
      else timerHtml = `<span style="font-size:10px;color:#94a3b8;">⏱ ${s.timer_minutes} min</span>`;
    }

    const statusColor = isDone?'#059669':isActive?'#7c3aed':'#cbd5e1';
    const bgColor = isDone?'rgba(5,150,105,0.06)':isActive?'rgba(124,58,237,0.06)':'rgba(0,0,0,0.02)';
    const isLast = idx === steps.length-1;

    return `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px;margin-bottom:6px;
      background:${bgColor};border-radius:12px;border:1.5px solid ${statusColor}22;
      opacity:${isLocked?'0.4':'1'};cursor:${isLocked?'default':'pointer'};"
      onclick="${isLocked?'':` handleStepTap(${taskId},${s.id},${idx},${isLast},${activeIdx})`}">
      <div style="width:24px;height:24px;border-radius:50%;border:2px solid ${statusColor};
        display:flex;align-items:center;justify-content:center;flex-shrink:0;
        background:${isDone?statusColor:'transparent'};font-size:12px;color:${isDone?'#fff':statusColor};font-weight:700;">
        ${isDone?'✓':idx+1}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;color:${isDone?'#059669':isActive?'#1e0a3c':'#94a3b8'};
          ${isDone?'text-decoration:line-through;text-decoration-color:#05996944;':''}">
          ${s.title}
        </div>
        ${s.note?`<div style="font-size:11px;color:#94a3b8;margin-top:2px;line-height:1.4;">${s.note}</div>`:''}
        ${timerHtml?`<div style="margin-top:4px;">${timerHtml}</div>`:''}
        ${isDone&&isLast?`<button onclick="event.stopPropagation();completePrepWithSteps(${taskId})"
          style="margin-top:8px;width:100%;padding:10px;background:#059669;color:#fff;border:none;
          border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;">✓ Done — Segna come fatto</button>`:''}
      </div>
    </div>`;
  }).join('');

  panel.appendChild(inner);
  parentCard.appendChild(panel);
  requestAnimationFrame(()=>{ panel.style.maxHeight = inner.scrollHeight+40+'px'; });
}

window.handleStepTap = async function(taskId, stepId, stepIdx, isLast, activeIdx){
  if(stepIdx !== activeIdx) return;
  const today = new Date().toISOString().slice(0,10);
  const {data: existingLog} = await supa.from('prep_step_log')
    .select('*').eq('step_id', stepId).eq('log_date', today).maybeSingle();
  if(existingLog){
    await supa.from('prep_step_log').update({
      completed_by: user?.name, completed_at: new Date().toISOString()
    }).eq('id', existingLog.id);
  } else {
    await supa.from('prep_step_log').insert({
      prep_task_id: taskId, step_id: stepId, log_date: today,
      started_by: user?.name, started_at: new Date().toISOString(),
      completed_by: user?.name, completed_at: new Date().toISOString()
    });
  }
  const {data: step} = await supa.from('prep_steps').select('*').eq('id', stepId).maybeSingle();
  if(step?.timer_minutes) startPrepStepTimer(taskId, stepId, step.timer_minutes, step.title);

  const {data: steps} = await supa.from('prep_steps')
    .select('*').eq('prep_task_id', taskId).order('sort_order');
  const panel = document.getElementById('prep-steps-expand-'+taskId);
  if(panel) panel.remove();
  togglePrepStepsExpand(taskId, steps);
};

function startPrepStepTimer(taskId, stepId, minutes, stepTitle){
  const key = taskId+'_'+stepId;
  if(window._prepStepTimers[key]) return;
  const endTime = Date.now() + minutes*60*1000;
  const intervalId = setInterval(async()=>{
    const remaining = endTime - Date.now();
    const el = document.getElementById('step-timer-'+stepId);
    if(el){
      if(remaining > 0){
        const m = Math.floor(remaining/60000);
        const s = Math.floor((remaining%60000)/1000);
        el.textContent = `⏱ ${m}:${s.toString().padStart(2,'0')}`;
      } else {
        el.textContent = '⏱ Scaduto!';
        el.style.color = '#ef4444';
      }
    }
    if(remaining <= 0){
      clearInterval(intervalId);
      delete window._prepStepTimers[key];
      await supa.from('prep_step_log').update({timer_fired:true})
        .eq('step_id', stepId).eq('log_date', new Date().toISOString().slice(0,10));
      try{
        await fetch(`${SUPABASE_URL}/functions/v1/notifications`,{
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':`Bearer ${SUPABASE_ANON_KEY}`},
          body: JSON.stringify({title:`⏱ ${stepTitle}`, body:`Timer scaduto — prossimo step pronto`, target:'all'})
        });
      }catch(e){}
    }
  }, 1000);
  window._prepStepTimers[key] = {intervalId, endTime, stepId};
}

window.completePrepWithSteps = async function(taskId){
  const panel = document.getElementById('prep-steps-expand-'+taskId);
  if(panel) panel.remove();
  openDoneSheet(taskId);
};

