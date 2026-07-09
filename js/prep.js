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

// ── WAKE LOCK ──
let _wakeLock = null;
async function requestWakeLock(){
  if(!('wakeLock' in navigator)) return;
  try{ _wakeLock = await navigator.wakeLock.request('screen'); }catch(e){}
}
function releaseWakeLock(){
  if(_wakeLock){ _wakeLock.release().catch(()=>{}); _wakeLock=null; }
}
// Se il wake lock viene rilasciato dal sistema (es. tab in background), lo annulliamo
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible' && _activeTimerCount>0) requestWakeLock();
});

// Contatore timer attivi — gestisce wake lock automaticamente
let _activeTimerCount = 0;
window._prepTimerStarted = function(){
  _activeTimerCount++;
  requestWakeLock();
};
window._prepTimerStopped = function(){
  _activeTimerCount = Math.max(0, _activeTimerCount-1);
  if(_activeTimerCount===0) releaseWakeLock();
};

// ── STEP TRACKING (memoria locale per sessione) ──
// _taskStep[prepTaskId] = indice step corrente
// _taskStepTotal[prepTaskId] = numero totale step della ricetta
window._taskStep = {};
window._taskStepTotal = {};
var _startTimes = {}; // traccia quando il cuoco ha premuto START per ogni task

// Chiamato da recipe-modal.js quando l'utente naviga tra gli step
window.prepOnStepChange = function(prepTaskId, currentStep, totalSteps){
  if(!prepTaskId) return;
  _taskStep[prepTaskId] = currentStep;
  _taskStepTotal[prepTaskId] = totalSteps;
  renderM();
  if(typeof renderFocusFeed==='function') renderFocusFeed();
};

// Chiamato da recipe-modal.js quando il modal viene chiuso
window.prepOnModalClose = function(prepTaskId){
  // non resettiamo lo step — vogliamo ricordarlo per SEE STEPS
};

// ── CHECK URGENTI SCADUTE (14:30) ──
function startUrgencyCheck(){
  setInterval(()=>{
    const dn=getNowDallas();
    if(dn.getHours()===14&&dn.getMinutes()===30){
      const urgent=items.filter(i=>i.need_tomorrow);
      if(urgent.length>0&&isAdmin()){
        fetch(`${SUPABASE_URL}/functions/v1/send-push`,{
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':`Bearer ${SUPABASE_ANON_KEY}`},
          body:JSON.stringify({
            title:tr('urgentPrepTitle'),
            body:`${tr('urgentPrepBody').replace('{n}',urgent.length)}: ${urgent.slice(0,3).map(i=>i.name).join(', ')}`,
            target_user: user?.name
          })
        }).catch(()=>{});
      }
    }
  }, 60000);
}

// ── STAZIONE CHIUSURA ──
async function ensureChiusuraStation(){
  const exists = items.some(i=>i.category==='Chiusura');
  if(!exists && isAdmin()){}
}

// ── AVVISO INTELLIGENTE ──
async function loadItemAlerts(){
  try{
    const{data}=await supa.from('v_item_alerts').select('*');
    itemAlerts={};
    (data||[]).forEach(r=>itemAlerts[r.name]=r);
  }catch(e){}
}

// Set di prep_task_id che hanno almeno uno step
window.prepTasksWithSteps = new Set();
async function loadStepsMap(){
  try{
    const{data}=await supa.from('prep_steps').select('prep_task_id');
    window.prepTasksWithSteps = new Set((data||[]).map(r=>String(r.prep_task_id)));
  }catch(e){}
}

// ── TODAY LOGS — cache log di oggi per ogni item ──
// Struttura: { 'Item Name': [{user_name, qty, unit, created_at}, ...] }
window._todayLogs = {};
async function loadTodayLogs(){
  try{
    const tz = 'America/Chicago';
    const today = new Date().toLocaleDateString('en-CA', {timeZone: tz}); // YYYY-MM-DD in CDT
    const{data}=await supa.from('prep_log')
      .select('item,qty,unit,user_name,created_at')
      .gte('created_at', today+'T00:00:00-05:00')
      .order('created_at',{ascending:true});
    window._todayLogs = {};
    (data||[]).forEach(r=>{
      if(!window._todayLogs[r.item]) window._todayLogs[r.item]=[];
      window._todayLogs[r.item].push(r);
    });
    // Re-render dopo che i log sono pronti
    if(typeof renderM==='function') renderM();
    if(typeof renderS==='function') renderS();
  }catch(e){}
}
function getTodayLogsFor(itemName){
  return window._todayLogs[itemName]||[];
}

// ── RECENT KITCHEN COUNTS ─────────────────────────────────────────────────
// Carica i prep_stock_counts delle ultime 24h in window._recentCounts
// Struttura: { [prep_task_id]: { ...row } }
// La UI usa questi per dare priorità al count reale rispetto alla bot suggestion
window._recentCounts = window._recentCounts || {};
async function loadRecentCounts() {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supa
      .from('prep_stock_counts')
      .select('id,prep_task_id,counted_qty,unit,counted_by,counted_at,reconcile_status,reconciled_qty,reconciled_note,expires_at,prev_bot_stock,prev_bot_suggestion,prev_suggested_by')
      .gte('counted_at', cutoff)
      .order('counted_at', { ascending: false });
    window._recentCounts = {};
    for (const row of (data || [])) {
      // Per ogni task_id teniamo solo il count più recente (order DESC già fatto)
      if (!window._recentCounts[row.prep_task_id]) {
        window._recentCounts[row.prep_task_id] = row;
      }
    }
  } catch(e) {
    window._recentCounts = {};
  }
}

// Helper: ritorna il count recente valido per un task (non expired)
function getValidCount(taskId) {
  const row = window._recentCounts[taskId];
  if (!row) return null;
  // Controlla expires_at
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
  return row;
}
function fmtLogTime(isoStr){
  try{
    return new Date(isoStr).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:true,timeZone:'America/Chicago'});
  }catch(e){ return ''; }
}

function getAlertLevel(itemName){
  const a=itemAlerts[itemName];
  if(!a) return null;
  const today=new Date().toISOString().slice(0,10);
  const madeToday = a.last_made_at && a.last_made_at.slice(0,10)===today;
  if(!madeToday) return null;
  const qty = a.last_made_qty||0;
  const avgQty = a.average_qty||qty;
  const duration = a.expected_duration_days||1;
  if(qty >= avgQty*0.8 && duration > 1) return {level:'high', a};
  if(qty >= avgQty*0.5) return {level:'medium', a};
  return {level:'low', a};
}

async function checkBeforeMissing(id, itemName){
  const alert = getAlertLevel(itemName);
  if(!alert) return true;
  const a = alert.a;
  const _locale = {it:'it-IT',en:'en-US',es:'es-MX'}[window.user?.lang||'en']||'en-US';
  const madeAt = new Date(a.last_made_at).toLocaleTimeString(_locale,{hour:'2-digit',minute:'2-digit'});
  const _byWord = {it:'da',en:'by',es:'por'}[window.user?.lang||'en']||'by';
  const madeQty = a.last_made_qty ? `${a.last_made_qty} ${a.last_made_by?_byWord+' '+a.last_made_by:''}` : '';
  const colors = {high:'🟢', medium:'🟡', low:'🔴'};
  const confidenceText = {high:tr('confidenceHigh'), medium:tr('confidenceMedium'), low:tr('confidenceLow')};
  return new Promise(resolve=>{
    const popup=document.createElement('div');
    popup.className='fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4';
    popup.innerHTML=`
      <div class="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl" style="animation:slideUp .2s ease">
        <div class="text-center mb-4">
          <div class="text-4xl mb-2">🤔</div>
          <h3 class="font-bold text-lg">${tr('sureItsMissing')}</h3>
        </div>
        <div class="bg-slate-50 rounded-2xl p-3 mb-4 space-y-2">
          <div class="flex items-center gap-2 text-sm">
            <span>🧑‍🍳</span>
            <span><b>${a.last_made_by||tr('somebodyMade')}</b> ${tr('madeThisMorning')} <b>${madeAt}</b></span>
          </div>
          ${madeQty?`<div class="flex items-center gap-2 text-sm"><span>⚖️</span><span>${tr('qty')}: <b>${madeQty}</b></span></div>`:''}
          ${a.missing_count_week>1?`<div class="flex items-center gap-2 text-sm text-amber-700"><span>⚠️</span><span>${tr('reportedMissingWeek').replace('{n}', a.missing_count_week)}</span></div>`:''}
          <div class="flex items-center gap-2 text-xs text-slate-500 pt-1 border-t">
            <span>${colors[alert.level]}</span>
            <span>${confidenceText[alert.level]}</span>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <button id="alertCancel" class="py-3 rounded-xl bg-slate-100 font-semibold text-sm">${tr('checkAgain')}</button>
          <button id="alertConfirm" class="py-3 rounded-xl bg-red-500 text-white font-semibold text-sm">${tr('yesMissing')}</button>
        </div>
      </div>`;
    document.body.appendChild(popup);
    popup.querySelector('#alertCancel').onclick=()=>{
      popup.remove();
      supa.from('alerts_log').insert({item:itemName,user_name:user?.name,was_really_missing:false,qty_made_that_day:a.last_made_qty,made_by:a.last_made_by,made_at:a.last_made_at});
      resolve(false);
    };
    popup.querySelector('#alertConfirm').onclick=()=>{
      popup.remove();
      supa.from('alerts_log').insert({item:itemName,user_name:user?.name,was_really_missing:true,qty_made_that_day:a.last_made_qty,made_by:a.last_made_by,made_at:a.last_made_at});
      resolve(true);
    };
  });
}

// ── PILL STOCK — testo human-readable ──
function buildStockPill(i){
  if(i.prep_type==='checklist') return '';
  if(i.current_stock===null||i.current_stock===undefined) return '';
  // Se il bot ha già scritto suggested_note, non mostrare la stock pill — evita tre pill
  if(i.suggested_note) return '';
  const stock = parseFloat(i.current_stock);
  const sq = parseFloat(i.suggested_qty||0);
  const unit = i.unit||'';
  const stockLabel = stock + (unit?' '+unit:'');
  const lang = window.user?.lang||'en';
  const inHouse = {it:'hai '+stockLabel+' in casa', en:'you have '+stockLabel+' in stock', es:'tienes '+stockLabel+' en casa'}[lang]||'you have '+stockLabel+' in stock';
  if(stock===0){
    return '<div style="margin-top:4px;"><span style="font-size:11px;font-weight:700;color:#a32d2d;background:#fcebeb;border:0.5px solid #f7c1c1;border-radius:6px;padding:2px 7px;">🤖 '+({it:'Prepara oggi · hai 0 in casa',en:'Prep today · nothing in stock',es:'Prepara hoy · nada en casa'}[lang]||'Prep today · nothing in stock')+'</span></div>';
  } else if(sq>0 && stock<=sq*0.5){
    return '<div style="margin-top:4px;"><span style="font-size:11px;font-weight:700;color:#854f0b;background:#faeeda;border:0.5px solid #fac775;border-radius:6px;padding:2px 7px;">🤖 '+({it:'Quasi finito · ',en:'Running low · ',es:'Casi agotado · '}[lang]||'Running low · ')+inHouse+'</span></div>';
  } else {
    return '<div style="margin-top:4px;"><span style="font-size:11px;font-weight:600;color:#3b6d11;background:#eaf3de;border:0.5px solid #c0dd97;border-radius:6px;padding:2px 7px;">🤖 '+({it:'Stock ok · ',en:'Stock ok · ',es:'Stock ok · '}[lang]||'Stock ok · ')+inHouse+'</span></div>';
  }
}

// ── AUDIT PANEL — Guardian Mode ──
// Caricato su richiesta la prima volta, poi cachato in window._auditCache
window._auditCache = window._auditCache || {};
window._auditMode  = window._auditMode  || false;

// ── MOTORE AUDIT — legge i dati dell'ultimo run reale del PrepBot ────────────
//
// PRINCIPIO: il bot ha già girato e ha già scritto i risultati su prep_tasks:
//   suggested_qty    → quantità calcolata dal bot
//   suggested_note   → pill + testo (color|it|en|es)
//   suggested_by     → 'bot-preplist-builder-v41'
//   suggested_at     → timestamp UTC del run (es. 2026-07-04 11:23 UTC = 6:23 CDT)
//
// L'audit NON rifà il calcolo. Legge quello che il bot ha effettivamente deciso
// e spiega perché. Nessuna query live su pos_sales_by_item.
//
// Per capire il PATH (come il bot ha trovato le vendite) fa una query leggera
// sulla struttura: recipe join + subMap + ingredient links.

async function computePrepBotDecision(taskId) {
  // 1. Fetch prep_task con join recipe (stesso join del bot) + campi run
  const { data: rows } = await supa
    .from('prep_tasks')
    .select('id,name,category,prep_type,unit,current_stock,recipe_id,ingredient_id,pack_label,min_cover_days,expected_duration_days,suggested_qty,suggested_note,suggested_by,suggested_at,recipes:recipe_id(id,title,pos_name,base_weight_g,base_servings,shelf_life_days,serving_weight_g,serving_unit,serving_qty)')
    .eq('id', taskId)
    .limit(1);

  if (!rows || !rows.length) return null;
  const task = rows[0];
  const rec  = task.recipes || null;

  // 2. Metadati del run
  const runAt     = task.suggested_at ? new Date(task.suggested_at) : null;
  const runBy     = task.suggested_by || null;
  // La sales window del bot è "ieri rispetto al momento del run"
  // Il bot gira alle 4AM CDT (9AM UTC) — ieri = runAt - 1 giorno
  const salesDate = runAt ? (() => {
    const d = new Date(runAt);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })() : null;

  // Formattazione CDT (UTC-5)
  const runAtCDT = runAt ? (() => {
    const cdt = new Date(runAt.getTime() - 5 * 60 * 60 * 1000);
    const mm = String(cdt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(cdt.getUTCDate()).padStart(2, '0');
    const hh = String(cdt.getUTCHours()).padStart(2, '0');
    const mn = String(cdt.getUTCMinutes()).padStart(2, '0');
    return `${cdt.getUTCFullYear()}-${mm}-${dd} ${hh}:${mn} CDT`;
  })() : '—';

  // 3. Parametri ricetta
  const unit  = (task.unit || '').toLowerCase().trim();
  const isPz  = ['pezzi','pz'].includes(unit);
  const isCup = unit === 'cup';
  const isPhys = ['cup','nests','pezzi','pz','buste','cartocci','filetto','porzione'].includes(unit);
  const bw = rec?.base_weight_g  ? parseFloat(rec.base_weight_g)  : null;
  const bs = rec?.base_servings  ? parseInt(rec.base_servings)    : null;
  const sw = (!isPhys && rec?.serving_weight_g) ? parseFloat(rec.serving_weight_g) : null;
  const sq = rec?.serving_qty    ? parseFloat(rec.serving_qty)    : null;
  const su = rec?.serving_unit   || null;

  // 4. pns — DALLA RICETTA (join), come fa il bot
  const pns = rec?.pos_name
    ? rec.pos_name.split('|').map(s => s.trim()).filter(Boolean)
    : [];
  const hasPosName = pns.length > 0;

  // 5. PATH — come il bot ha trovato le vendite (solo struttura, nessuna query POS)
  let consumoPath = 'none';

  if (hasPosName) {
    consumoPath = 'direct_pos';
  }

  // Sub-recipe path: questa ricetta è usata come componente da altre
  let subParents = [];
  const recipeId = task.recipe_id || null;
  if (recipeId) {
    const { data: subRows } = await supa.from('recipe_bom')
      .select('quantity,unit,parent:parent_recipe_id(title,pos_name)')
      .eq('sub_recipe_id', recipeId)
      .eq('component_type', 'RECIPE');
    subParents = (subRows || []).filter(r => r.parent?.pos_name);
    if (subParents.length) {
      consumoPath = hasPosName ? 'direct_pos+sub_recipe' : 'sub_recipe';
    }
  }

  // Ingredient path
  let ingId = task.ingredient_id || null;
  let ingParentCount = 0;
  if (ingId && consumoPath === 'none') {
    const { data: ingRecs } = await supa.from('recipe_bom')
      .select('parent_recipe_id')
      .eq('item_id', ingId)
      .eq('component_type', 'ITEM')
      .not('parent_recipe_id', 'is', null)
      .limit(10);
    ingParentCount = (ingRecs || []).length;
    if (ingParentCount > 0) consumoPath = 'ingredient_id';
  }

  // 6. Cosa ha calcolato il bot (leggere da suggested_note e suggested_qty)
  const suggestedNote = task.suggested_note || null;
  const suggestedQty  = task.suggested_qty  != null ? parseFloat(task.suggested_qty) : null;

  let botPill = null, botNoteIT = null, botNoteEN = null;
  if (suggestedNote && suggestedNote.includes('|')) {
    const parts = suggestedNote.split('|');
    botPill   = parts[0] || null;
    botNoteIT = parts[1] || null;
    botNoteEN = parts[2] || null;
  }

  // 7. Consumo teorico per porzione
  const consumoTeorico = sw > 0 ? sw + 'g per vendita'
    : (bw && bs) ? Math.round(bw / bs) + 'g per vendita'
    : (hasPosName || subParents.length) ? 'calcolato via ' + (suggestedQty != null ? suggestedQty + ' ' + unit : 'blended DOW')
    : '—';

  // 8. BOM della ricetta + link audit (strutturale — no query POS)
  let bomItems = [];
  if (recipeId) {
    const { data: bom } = await supa.from('recipe_bom')
      .select('quantity,unit,component_type,item_id,sub_recipe_id,ingredients:item_id(name),sub:sub_recipe_id(title)')
      .eq('parent_recipe_id', recipeId).order('sort_order');
    bomItems = bom || [];
  }
  const hasBom = bomItems.filter(b => b.component_type === 'ITEM').length > 0;

  // Ricette che la usano come RECIPE (corretto)
  let recipeLinks = [];
  if (recipeId) {
    const { data: rl } = await supa.from('recipe_bom')
      .select('bom_id,quantity,unit,parent:parent_recipe_id(id,title,pos_name)')
      .eq('sub_recipe_id', recipeId).eq('component_type', 'RECIPE');
    recipeLinks = (rl || []).filter(r => r.parent);
  }

  // Ricette che usano l'ingrediente come ITEM (sbagliato)
  let itemLinks = [];
  if (!ingId && task.name) {
    const { data: im } = await supa.from('ingredients')
      .select('id').ilike('name', task.name).eq('active', true).limit(1);
    if (im && im.length) ingId = im[0].id;
  }
  if (ingId) {
    const { data: il } = await supa.from('recipe_bom')
      .select('bom_id,quantity,unit,parent:parent_recipe_id(id,title,pos_name)')
      .eq('item_id', ingId).eq('component_type', 'ITEM');
    itemLinks = (il || []).filter(r => r.parent);
  }

  // Ricette sospette senza link — filtrate per parole chiave del task
  // Solo ricette il cui titolo contiene un termine semanticamente legato a questa prep.
  // Evita di mostrare 24+ ricette generiche non correlate.
  const allLinkedIds = new Set([
    ...recipeLinks.map(r => r.parent?.id).filter(Boolean),
    ...itemLinks.map(r => r.parent?.id).filter(Boolean)
  ]);
  let missingLinks = [];
  if (recipeId || ingId) {
    // Keyword set: derivate dal nome prep task + nome ingrediente (se disponibile)
    // Tokenizziamo il nome e usiamo solo token >= 4 caratteri per evitare falsi positivi
    const taskTokens = (task.name || '').toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 4);
    // Aggiungi keyword implicite per prep note come "croutons" → cerca ricette con insalate/zuppe
    const impliedGroups = [];
    const impliedTitleKw = [];
    // Se la prep è tipicamente una guarnizione di insalate/zuppe, cerca in quelle categorie
    const garnishKeywords = ['crouton','dressing','cheese','parmesan','pecorino','bacon','herb'];
    const saladKeywords   = ['salad','caesar','house','mediterranean','tuscany','pear','caprese'];
    const soupKeywords    = ['soup','broth','zuppa','texana','tomato'];
    const isGarnish = taskTokens.some(t => garnishKeywords.some(k => t.includes(k)));
    const isSaladPrep = taskTokens.some(t => saladKeywords.some(k => t.includes(k)));
    const isSoupPrep  = taskTokens.some(t => soupKeywords.some(k => t.includes(k)));

    if (isGarnish || isSaladPrep) {
      impliedGroups.push('Salads', 'Antipasti');
      impliedTitleKw.push(...saladKeywords);
    }
    if (isGarnish || isSoupPrep) {
      impliedGroups.push('Soups');
      impliedTitleKw.push(...soupKeywords);
    }
    // Aggiunge i token del task stesso come keyword di ricerca titolo
    impliedTitleKw.push(...taskTokens);

    // Costruisce il filtro OR per ilike sul titolo (solo keyword rilevanti, dedup)
    const titleKwUniq = [...new Set(impliedTitleKw)].filter(k => k.length >= 4).slice(0, 8);
    const orFilter = titleKwUniq.map(k => `title.ilike.%${k}%`).join(',');

    if (titleKwUniq.length || impliedGroups.length) {
      const queries = [];
      if (impliedGroups.length && orFilter) {
        // Ricette nelle categorie rilevanti il cui titolo matcha almeno una keyword
        const { data: c1 } = await supa.from('recipes')
          .select('id,title,pos_name,menu_group')
          .not('pos_name', 'is', null)
          .in('menu_group', impliedGroups)
          .or(orFilter)
          .order('title');
        queries.push(...(c1 || []));
      }
      if (orFilter) {
        // Ricette senza menu_group il cui titolo matcha
        const { data: c2 } = await supa.from('recipes')
          .select('id,title,pos_name,menu_group')
          .not('pos_name', 'is', null)
          .is('menu_group', null)
          .or(orFilter)
          .order('title');
        queries.push(...(c2 || []));
      }
      const seen = new Set();
      queries.forEach(r => {
        if (!allLinkedIds.has(r.id) && !seen.has(r.id)) {
          seen.add(r.id);
          missingLinks.push(r);
        }
      });
    }
  }

  return {
    taskId, taskName: task.name,
    recipeId, recipePosName: rec?.pos_name || null,
    pns, hasPosName, hasBom,
    consumoPath, subParents, ingParentCount,
    bw, bs, sw, sq, su, unit,
    // Run metadata
    runAt: runAtCDT, salesDate, runBy,
    // Decisione già scritta dal bot
    botPill, botNoteIT, botNoteEN,
    suggestedQty, suggestedNote,
    consumoTeorico,
    bomItems, recipeLinks, itemLinks, missingLinks
  };
}

async function loadAuditData(taskId) {
  if (window._auditCache[taskId]) return window._auditCache[taskId];
  const result = await computePrepBotDecision(taskId);
  if (result) window._auditCache[taskId] = result;
  return result;
}

function auditDiagnose(task, data) {
  if (!data) return {
    badge: '⚠️ Errore', color: '#854f0b', bg: '#faeeda',
    causa: 'Caricamento dati fallito.', action: 'Riprova'
  };

  const unit = data.unit || '';
  const isCup   = unit === 'cup';
  const isBuste  = unit === 'buste';
  const nRecipe  = data.recipeLinks.length;
  const nItem    = data.itemLinks.length;
  const nMissing = data.missingLinks.length;
  const bw = data.bw || 0;
  const bs = data.bs || 0;

  const consumoCalcolato = data.suggestedQty != null
    ? data.suggestedQty + ' ' + unit + (data.botNoteEN ? ' — ' + data.botNoteEN : '')
    : (data.suggestedNote ? data.botNoteEN || data.botNoteIT || '—' : '—');

  if (task.current_stock === null || task.current_stock === undefined)
    return { badge: '🚫 Stock NULL', color: '#a32d2d', bg: '#fcebeb',
      causa: 'current_stock=NULL — il bot ha saltato questa prep.',
      action: 'Imposta stock', consumoTeorico: data.consumoTeorico, consumoCalcolato };

  if (!task.recipe_id && !task.ingredient_id)
    return { badge: '🔗 Missing link', color: '#533ab7', bg: '#eeedfe',
      causa: 'Nessuna recipe_id né ingredient_id.',
      action: 'Collega una ricetta o un ingrediente',
      consumoTeorico: data.consumoTeorico, consumoCalcolato };

  if (!data.hasPosName && nRecipe === 0 && data.consumoPath === 'none')
    return { badge: '📭 POS name mancante', color: '#533ab7', bg: '#eeedfe',
      causa: 'La ricetta non ha pos_name e non è sub-recipe di nessuna ricetta POS. Il bot non trova vendite.',
      action: 'Aggiungi pos_name alla ricetta oppure aggiungila come RECIPE nel BOM di un piatto POS',
      consumoTeorico: data.consumoTeorico, consumoCalcolato };

  if (data.hasPosName && !data.hasBom)
    return { badge: '📋 BOM vuoto', color: '#993c1d', bg: '#faece7',
      causa: 'La ricetta ha pos_name ma BOM vuoto — il bot non conosce il peso per porzione.',
      action: 'Compila il BOM della ricetta',
      consumoTeorico: data.consumoTeorico, consumoCalcolato };

  if (isCup && bw > 0 && bs > 0 && bw > 100)
    return { badge: '⚙️ Motore: cup', color: '#854f0b', bg: '#faeeda',
      causa: 'base_weight_g=' + bw + 'g letto come numero di cup — conflitto unità.',
      action: 'Usare serving_qty × vendite invece di bw/bs',
      consumoTeorico: data.consumoTeorico, consumoCalcolato };

  if (isBuste && !bw && !data.sw)
    return { badge: '⚙️ Motore: buste', color: '#854f0b', bg: '#faeeda',
      causa: 'unit=buste ma base_weight_g=null — calcolo qty errato.',
      action: 'Imposta base_weight_g (peso di 1 busta in grammi)',
      consumoTeorico: data.consumoTeorico, consumoCalcolato };

  if (nRecipe === 0 && nItem > 0)
    return { badge: '🔴 ITEM sbagliato', color: '#a32d2d', bg: '#fcebeb',
      causa: `Salvato come ITEM (ingrediente) in ${nItem} ricett${nItem > 1 ? 'e' : 'a'} invece che come RECIPE.`,
      action: 'Converti da ITEM → RECIPE nel BOM delle ricette indicate',
      consumoTeorico: data.consumoTeorico, consumoCalcolato };

  // PARTIAL LINK: distingni tra "bot OK ma link strutturali da completare" e "bot NON scala"
  if (nRecipe > 0 && nMissing > 0) {
    // Se il bot ha già scalato questa prep (consumoPath != none), il badge è ✅ OK
    // con una nota informativa sui link strutturali mancanti — non è un errore bot.
    if (data.consumoPath !== 'none') {
      return { badge: '✅ OK (link da completare)', color: '#3b6d11', bg: '#eaf3de',
        causa: `Il bot scala correttamente via ${data.consumoPath}. ${nMissing} ricett${nMissing > 1 ? 'e' : 'a'} nella lista sospette potrebbero usare questa prep ma non sono ancora collegate.`,
        action: `Audit strutturale: verifica le ${nMissing} ricette in lista e decidi se aggiungere come sub-recipe`,
        consumoTeorico: data.consumoTeorico, consumoCalcolato };
    }
    // Bot non scala (consumoPath === none): link mancanti sono il problema
    return { badge: '⚠️ PARTIAL LINK', color: '#854f0b', bg: '#faeeda',
      causa: `Collegato a ${nRecipe} ricett${nRecipe > 1 ? 'e' : 'a'} come sub-recipe, ma il bot non scala (path=none). ${nMissing} ricett${nMissing > 1 ? 'e' : 'a'} sospett${nMissing > 1 ? 'e' : 'a'} senza link.`,
      action: 'Verifica le ricette sospette e decidi se aggiungere come sub-recipe',
      consumoTeorico: data.consumoTeorico, consumoCalcolato };
  }

  if ((data.hasPosName || nRecipe > 0) && nMissing === 0 && nItem === 0)
    return { badge: '✅ OK', color: '#3b6d11', bg: '#eaf3de',
      causa: 'Il bot ha scalato correttamente via ' + data.consumoPath + '.',
      action: 'Nessuna azione necessaria',
      consumoTeorico: data.consumoTeorico, consumoCalcolato };

  return { badge: '📊 Zero vendite', color: '#3b6d11', bg: '#eaf3de',
    causa: 'Struttura OK — nessuna vendita nel sales window del run.',
    action: 'Normale se il ristorante era chiuso quel giorno',
    consumoTeorico: data.consumoTeorico, consumoCalcolato };
}

window.toggleAuditPanel = async function(taskId) {
  const card  = document.querySelector('[data-audit-id="' + taskId + '"]');
  if (!card) return;
  const panel = card.querySelector('.audit-detail');
  if (!panel) return;
  const btn   = card.querySelector('.audit-toggle-btn');

  if (panel.style.display === 'none' || !panel.style.display) {
    panel.style.display = 'block';
    if (btn) btn.textContent = '🔍 Nascondi audit';
    panel.innerHTML = '<div style="padding:10px;font-size:11px;color:#64748b;">Caricamento dal run del bot...</div>';

    const task = tasks[taskId];
    const data = await loadAuditData(taskId);
    const diag = auditDiagnose(task, data);

    if (!data) {
      panel.innerHTML = '<div style="padding:10px;font-size:12px;color:#dc2626;">Errore caricamento.</div>';
      return;
    }

    // ── Run header ──
    const pillColors = {
      green:  { bg: '#f0fdf4', border: '#bbf7d0', color: '#3b6d11', label: '🟢 OK' },
      yellow: { bg: '#fffbeb', border: '#fde68a', color: '#854f0b', label: '🟡 Controlla' },
      red:    { bg: '#fef2f2', border: '#fca5a5', color: '#a32d2d', label: '🔴 Prepara' }
    };
    const pc = pillColors[data.botPill] || pillColors['green'];

    const runHeader = `<div style="background:#f8fafc;border:0.5px solid #e2e8f0;border-radius:8px;padding:7px 10px;margin-bottom:10px;">
      <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;">Audit basato su run</div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <div>
          <div style="font-size:11px;color:#334155;font-weight:500;">${data.runAt}</div>
          <div style="font-size:10px;color:#94a3b8;">Sales window: ${data.salesDate || '—'} · ${data.runBy || '—'}</div>
        </div>
        ${data.botPill ? `<span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:5px;background:${pc.bg};border:0.5px solid ${pc.border};color:${pc.color};">${pc.label}</span>` : ''}
      </div>
      ${data.botNoteEN ? `<div style="font-size:11px;color:#475569;margin-top:4px;font-style:italic;">"${data.botNoteEN}"</div>` : ''}
      ${data.suggestedQty != null ? `<div style="font-size:11px;color:#185fa5;font-weight:700;margin-top:2px;">→ Suggerisce: ${data.suggestedQty} ${data.unit}</div>` : ''}
    </div>`;

    // ── Percorso del bot ──
    const pathLabels = {
      'direct_pos':           '📍 POS diretto — vendite trovate per pos_name della ricetta',
      'sub_recipe':           '📦 Sub-recipe — usata come componente di ricette POS',
      'direct_pos+sub_recipe':'📍+📦 POS diretto + sub-recipe',
      'ingredient_id':        '🔗 Ingredient ID — consumo da BOM di ricette che usano questo ingrediente',
      'none':                 '❌ Nessun percorso trovato — il bot non ha scalato questa prep'
    };
    const pathLabel = pathLabels[data.consumoPath] || data.consumoPath;
    const pathColor = data.consumoPath === 'none' ? '#991b1b' : '#334155';

    let pathRows = '';
    if (data.pns.length) {
      pathRows = data.pns.map(pn =>
        `<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;color:#334155;">
          <span style="font-family:monospace;">${pn}</span>
          <span style="color:#94a3b8;font-size:10px;">nel sales window del run</span>
        </div>`
      ).join('');
    }
    if (data.subParents.length) {
      pathRows += data.subParents.map(p =>
        `<div style="font-size:11px;padding:2px 0;color:#334155;">
          <span style="font-family:monospace;">📦 ${p.parent.title} × ${p.quantity}${p.unit || 'g'}</span>
        </div>`
      ).join('');
    }

    const pathSection = `<div style="margin-bottom:10px;">
      <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Percorso usato dal bot</div>
      <div style="font-size:11px;color:${pathColor};background:#f8fafc;border-radius:6px;padding:5px 8px;margin-bottom:4px;">${pathLabel}</div>
      ${pathRows ? `<div style="padding:0 4px;">${pathRows}</div>` : ''}
    </div>`;

    // ── Diagnosi strutturale ──
    const diagSection = `<div style="margin-bottom:10px;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
        <span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:6px;background:${diag.bg};color:${diag.color};">${diag.badge}</span>
        <span style="font-size:10px;color:#94a3b8;font-weight:500;">Diagnosi strutturale</span>
      </div>
      <div style="font-size:12px;color:#334155;line-height:1.5;margin-bottom:3px;">${diag.causa}</div>
      <div style="font-size:12px;color:#059669;font-weight:600;">${diag.action}</div>
    </div>`;

    // ── Tabella ricette ──
    function _recRow(r, type) {
      const title = r.parent?.title || r.title || '?';
      const pos   = r.parent?.pos_name || r.pos_name || '—';
      const qty   = r.quantity ? ` · ${r.quantity}${r.unit || 'g'}` : '';
      const s = {
        RECIPE:  'background:#eff6ff;border:0.5px solid #bfdbfe;color:#1e40af;',
        ITEM:    'background:#fef2f2;border:0.5px solid #fca5a5;color:#991b1b;',
        MISSING: 'background:#fafafa;border:0.5px solid #e2e8f0;color:#475569;'
      };
      const l = { RECIPE: '✅ RECIPE', ITEM: '⚠ ITEM', MISSING: '❓ mancante' };
      return `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:0.5px solid #f1f5f9;flex-wrap:wrap;">
        <span style="font-size:10px;font-weight:700;padding:1px 5px;border-radius:4px;flex-shrink:0;${s[type]}">${l[type]}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:600;color:#0f172a;">${title}${qty}</div>
          <div style="font-size:10px;color:#94a3b8;">POS: ${pos.split('|')[0]}</div>
        </div>
      </div>`;
    }

    const rL = data.recipeLinks || [], iL = data.itemLinks || [], mL = data.missingLinks || [];
    const hasRows = rL.length || iL.length || mL.length;
    const recipeSection = hasRows ? `<div style="margin-bottom:10px;">
      <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px;">
        Ricette · ${rL.length} RECIPE ✅ · ${iL.length} ITEM ⚠ · ${mL.length} mancanti ❓
      </div>
      ${rL.map(r => _recRow(r, 'RECIPE')).join('')}
      ${iL.map(r => _recRow(r, 'ITEM')).join('')}
      ${mL.map(r => _recRow({ title: r.title, pos_name: r.pos_name }, 'MISSING')).join('')}
    </div>` : '';

    // ── BOM ──
    const bomHTML = data.bomItems.length
      ? data.bomItems.map(b => {
          const n = b.component_type === 'ITEM'
            ? (b.ingredients?.name || '?')
            : ('📦 ' + (b.sub?.title || 'sub'));
          return `<span style="font-size:11px;background:#f1f5f9;border-radius:4px;padding:1px 6px;margin:2px;display:inline-block;">${n} ${b.quantity}${b.unit}</span>`;
        }).join('')
      : (task.recipe_id
          ? '<span style="font-size:11px;color:#dc2626;">BOM vuoto</span>'
          : '<span style="font-size:11px;color:#94a3b8;">Nessuna ricetta collegata</span>');

    const bomSection = `<div>
      <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;">BOM trovati</div>
      <div style="display:flex;flex-wrap:wrap;margin-bottom:6px;">${bomHTML}</div>
      <div style="font-size:10px;color:#cbd5e1;">recipe_id: ${task.recipe_id || '—'} · pos_name: ${data.recipePosName || '—'} · path: ${data.consumoPath}</div>
    </div>`;

    panel.innerHTML = `<div style="padding:10px 12px;border-top:0.5px dashed #e2e8f0;">
      ${runHeader}
      ${pathSection}
      ${diagSection}
      ${recipeSection}
      ${bomSection}
    </div>`;

  } else {
    panel.style.display = 'none';
    if (btn) btn.textContent = '🔍 Audit';
  }
};


window.toggleAllAudit = function(){
  window._auditMode = !window._auditMode;
  const btn = document.getElementById('auditModeBtn');
  if(btn){
    btn.style.background = window._auditMode ? '#533ab7' : '';
    btn.style.color = window._auditMode ? '#fff' : '';
    btn.textContent = window._auditMode ? '🔍 Audit ON' : '🔍 Audit';
  }
  renderM();
};

// ── COLORE BORDO card ──
function cardBorderColor(i){
  if(i.in_progress) return '#2563eb';
  if(i.prep_type==='checklist') return '#94a3b8';
  // Colore bordo dal cardType calcolato, non solo dal pill
  const ct = classifyCard(i);
  if(ct==='COUNT_FIRST') return '#dc2626';
  if(ct==='STAGED_CHECK') return '#ca8a04';
  if(ct==='LARGE_BATCH')  return '#d97706';
  if(ct==='BLOCKED')      return '#94a3b8';
  if(ct==='WATCH')        return '#cbd5e1';
  if(ct==='CHEF_REVIEW')  return '#bfdbfe';
  // TRUSTED: usa il colore del pill
  if(i.suggested_note && i.suggested_note.includes('|')){
    const col = i.suggested_note.split('|')[0];
    if(col==='red') return '#dc2626';
    if(col==='yellow') return '#d97706';
    if(col==='green') return '#16a34a';
  }
  return '#cbd5e1';
}

// ── BOTTONE card ──
function cardButton(i){
  const iid = i.id;
  const lang = window.user?.lang||'en';
  if(i.in_progress){
    const currentStep = _taskStep[iid]||0;
    const totalSteps = _taskStepTotal[iid]||0;
    const hasStepsInDB = window.prepTasksWithSteps?.has(String(iid));
    const isLastStep = totalSteps>0 && currentStep>=totalSteps-1;
    // Nessuno step configurato → DONE diretto
    if(!hasStepsInDB || totalSteps===0 && !hasStepsInDB){
      return `<button onclick="prepDone(${JSON.stringify(iid)})" style="height:40px;padding:0 18px;border-radius:10px;font-size:13px;font-weight:600;background:#059669;color:white;border:none;white-space:nowrap;flex-shrink:0;">DONE</button>`;
    }
    if(isLastStep){
      return `<button onclick="prepDone(${JSON.stringify(iid)})" style="height:40px;padding:0 18px;border-radius:10px;font-size:13px;font-weight:600;background:#059669;color:white;border:none;white-space:nowrap;flex-shrink:0;">DONE</button>`;
    }
    const seeLabel = {it:'VEDI STEPS',en:'SEE STEPS',es:'VER PASOS'}[lang]||'SEE STEPS';
    return `<button onclick="prepSeeSteps(${JSON.stringify(iid)})" style="height:40px;padding:0 18px;border-radius:10px;font-size:13px;font-weight:600;background:#378add;color:white;border:none;white-space:nowrap;flex-shrink:0;">${seeLabel}</button>`;
  }
  // ── Bottone per card type ──────────────────────────────────────
  // START: solo su card di produzione reale (red/yellow TRUSTED)
  // COUNT_FIRST / STAGED_CHECK: Save count è già nel renderChefAiBlock — nessun bottone extra
  // LARGE_BATCH: "Start normal batch" — azione esplicita, non generica
  // WATCH / BLOCKED / CHEF_REVIEW / green: nessun bottone
  const _ct2     = classifyCard(i);
  const _botCol2 = (i.suggested_note||'').split('|')[0];

  // Nessun bottone
  if (_ct2 === 'TRUSTED' && _botCol2 === 'green') {
    // Looks okay — bottone discreto "Log anyway" per chi ha fatto prep ugualmente
    const lang2 = window.user?.lang||'en';
    const lbls = {it:'Preparo ugualmente',en:'Prep anyway',es:'Preparar igual'};
    const lbl2 = lbls[lang2] || lbls.en;
    return `<button onclick="prepStart(${JSON.stringify(iid)})" style="width:100%;height:46px;border-radius:12px;font-size:14px;font-weight:600;background:transparent;color:#059669;border:1.5px solid #bbf7d0;letter-spacing:0.02em;">${lbl2}</button>`;
  }
  if (_ct2 === 'WATCH')       return '';                       // dati incerti non critici
  if (_ct2 === 'BLOCKED')     return '';                       // setup mancante
  if (_ct2 === 'CHEF_REVIEW') return '';                       // nessun dato
  if (_ct2 === 'COUNT_FIRST') return '';                       // Save count è nel card block
  if (_ct2 === 'STAGED_CHECK') return '';                      // Save count è nel card block

  // LARGE_BATCH: label diversa per evitare "Start full batch" inconsapevole
  if (_ct2 === 'LARGE_BATCH') {
    return `<button onclick="prepStart(${JSON.stringify(iid)})" style="width:100%;height:46px;border-radius:12px;font-size:14px;font-weight:700;background:#b45309;color:white;border:none;letter-spacing:0.03em;">Start normal batch</button>`;
  }

  // DO_FIRST (red TRUSTED) / PREP_TODAY (yellow TRUSTED) / COUNT_RECONCILED → START
  return `<button onclick="prepStart(${JSON.stringify(iid)})" style="width:100%;height:46px;border-radius:12px;font-size:15px;font-weight:700;background:#1e3a5f;color:white;border:none;letter-spacing:0.03em;">START</button>`;
}

// ── CHEF AI CARD SYSTEM ──────────────────────────────────────────────────────
//
// Tre modalità card:
//   TRUSTED    → dati affidabili, mostra quantità consigliata + contesto numeri
//   COUNT_FIRST → stock 0 sospetto o confidence low — chiede conteggio fisico
//   BLOCKED     → dati strutturali mancanti — solo admin/office
//
// Non tocca bot, cron, edge functions.
// Il save count scrive su prep_stock_counts (nuova tabella) + aggiorna current_stock.

// ── CHEF NAME ──
function chefFirstName() {
  const name = window.user?.name || '';
  if (!name) return null;
  // Prende il primo token (es. "Rachel" da "Rachel Baquero", "Max" da "Max")
  const first = name.trim().split(/\s+/)[0];
  return first || null;
}
function chefGreeting() {
  const first = chefFirstName();
  if (!first) return 'Chef';
  return 'Chef ' + first;
}

// ── CLASSIFICA CARD ──
// Ritorna: 'TRUSTED' | 'COUNT_FIRST' | 'BLOCKED'
function classifyCard(i) {
  // Checklist: sempre trusted
  if (i.prep_type === 'checklist') return 'TRUSTED';
  // Dati strutturali mancanti → BLOCKED
  if (!i.recipe_id && !i.ingredient_id) return 'BLOCKED';

  // ── Priorità 0: kitchen count recente e reconciled ─────────────
  const validCount = getValidCount(i.id);
  if (validCount && validCount.reconcile_status) return 'COUNT_RECONCILED';

  // Bot non ancora girato → TRUSTED
  if (!i.suggested_note) return 'TRUSTED';

  const note       = i.suggested_note;
  const botColor   = note.includes('|') ? note.split('|')[0] : null;
  const isUncertain = note.includes('uncertain data') || note.includes('incerti') || note.includes('datos inciertos');
  const stock  = parseFloat(i.current_stock) || 0;
  const qty    = parseFloat(i.suggested_qty) || 0;
  const unit   = (i.unit || '').toLowerCase().trim();
  const isPz   = ['pezzi', 'pz'].includes(unit);
  const isG    = unit === 'g';
  const nameLC = (i.name || '').toLowerCase();

  // avg_daily da sources_json
  let avgDaily = 0;
  try {
    const src = typeof i.sources_json === 'string' ? JSON.parse(i.sources_json) : i.sources_json;
    if (src && src.length > 0) {
      avgDaily = src.reduce((s, x) => s + (parseFloat(x.avg_daily_portions) || 0), 0);
    }
  } catch(e) {}

  // ── R1: WATCH invece di COUNT_FIRST per uncertain generico ─────
  // uncertain da solo NON basta. COUNT_FIRST solo se c'è un rischio reale.
  // Il resto va a WATCH (check only if you're already working on it).

  // ── R2: stock=0 + pezzi>50 → COUNT_FIRST sempre ───────────────
  // Salmon 117pz, Scallops 127pz, GF sponge 161pz
  if (stock === 0 && isPz && qty > 50) return 'COUNT_FIRST';

  // ── R3: uncertain + carni pregiate → COUNT_FIRST ───────────────
  // Wagyu, Porterhouse — errore costoso se sbagliato
  const PRECIOUS_MEATS = ['wagyu', 'porterhouse', 'tomahawk'];
  if (isUncertain && PRECIOUS_MEATS.some(p => nameLC.includes(p))) return 'COUNT_FIRST';

  // ── R4: uncertain + stock=0 + alta rotazione + qty grande ──────
  // Solo se avg>=5/gg E qty>=2kg — altrimenti WATCH
  if (isUncertain && stock === 0 && isG && avgDaily >= 5 && qty >= 2000) return 'COUNT_FIRST';

  // ── R5: uncertain + stock presente ma << qty + alta rotazione ──
  // stock < 20% della qty richiesta + avg>=5 + qty>=3kg
  if (isUncertain && stock > 0 && isG && avgDaily >= 5 && qty >= 3000 && stock < qty * 0.20) return 'COUNT_FIRST';

  // ── R6: uncertain senza sources + qty=1 → CHEF_REVIEW ──────────
  // Bot completamente cieco (Lemon Zest, Powder sugar, ecc.)
  if (isUncertain && !i.sources_json && qty <= 1) return 'CHEF_REVIEW';

  // ── R7: suggested_qty null + non-green → WATCH (non più CF) ────
  // Il bot non ha calcolato niente — non è necessariamente un'emergenza
  if (!i.suggested_qty && botColor !== 'green') return 'WATCH';

  // ── R8: uncertain residuo → WATCH ──────────────────────────────
  // Tutto il resto uncertain non critico
  if (isUncertain) return 'WATCH';

  // ── R9: stock=0 + red + g>5000 + no sources → COUNT_FIRST ─────
  if (stock === 0 && botColor === 'red') {
    if (isG && qty > 5000 && !i.sources_json) return 'COUNT_FIRST';
  }

  // ── R10: STAGED_CHECK — stock=0 + red + avgDaily basso ─────────
  if (stock === 0 && botColor === 'red' && avgDaily > 0 && avgDaily < 5) return 'STAGED_CHECK';

  // ── R11: LARGE BATCH ───────────────────────────────────────────
  const LARGE_BATCH_EXCEPTIONS = new Set([
    'ragu','ragu sauce','cacio e pepe sauce','pomodoro sauce',
    'mash potato','risotto base','diced butter','garlic oil'
  ]);
  if (!LARGE_BATCH_EXCEPTIONS.has(nameLC)) {
    if (isG && qty > 15000) return 'LARGE_BATCH';
    if (isPz && qty > 50 && stock > 0 && botColor !== 'green') return 'LARGE_BATCH';
  }

  return 'TRUSTED';
}

// ── KITCHEN UNIT DISPLAY ────────────────────────────────────────────────────
// Per COUNT_FIRST: invece di "g", usa unità da cucina quando possibile
function kitchenCountUnit(item) {
  const unit = (item.unit || '').toLowerCase().trim();
  const name = (item.name || '').toLowerCase();
  // Grammi/kg → converti in unità cucina per il conteggio
  if (unit === 'g' || unit === 'kg') {
    if (name.includes('soup') || name.includes('sauce') || name.includes('demi') ||
        name.includes('coulis') || name.includes('cream') || name.includes('liquid') ||
        name.includes('oil') || name.includes('dressing') || name.includes('vinaigrette') ||
        name.includes('mix') || name.includes('batter')) {
      return { unit: 'qt', hint: '(approx. 1 qt = 950g)' };
    }
    if (name.includes('par cook') || name.includes('sprout') || name.includes('potato') ||
        name.includes('mushroom') || name.includes('onion') || name.includes('asparagus') ||
        name.includes('spinach') || name.includes('calamari')) {
      return { unit: 'lb', hint: '(approx. 1 lb = 450g)' };
    }
    if (name.includes('pasta') || name.includes('dough') || name.includes('gnocco')) {
      return { unit: 'portions', hint: '' };
    }
    // Default per grammi non riconosciuti: lascia g ma spiega
    return { unit: unit, hint: '' };
  }
  // Unità già umane
  if (['pezzi','pz'].includes(unit)) return { unit: 'pieces', hint: '' };
  if (unit === 'cup')   return { unit: 'cups', hint: '' };
  if (unit === 'nests') return { unit: 'nests', hint: '' };
  if (unit === 'buste') return { unit: 'bags', hint: '' };
  return { unit: unit, hint: '' };
}

// ── PARSE SOURCES_JSON per numeri "Sold yesterday / Expected today" ──
// avgDaily è SEMPRE in PORZIONI (vendite POS), NON nelle unità della prep task.
// avgDailyG è il consumo reale in grammi — somma di avg_daily_g da ogni source row.
// È QUESTO il numero che spiega il suggested_qty al cuoco.
function parseSourcesNumbers(i) {
  let avgDaily = null;
  let avgDailyG = null;
  try {
    const src = typeof i.sources_json === 'string' ? JSON.parse(i.sources_json) : i.sources_json;
    if (src && src.length > 0) {
      // Porzioni POS vendute al giorno (somma su tutti i piatti che usano questo prep)
      const totalPortions = src.reduce((sum, s) => sum + (parseFloat(s.avg_daily_portions) || 0), 0);
      if (totalPortions > 0) avgDaily = Math.round(totalPortions * 10) / 10;
      // Consumo in grammi/giorno — questo è avg_daily_g già calcolato dal bot
      const totalG = src.reduce((sum, s) => sum + (parseFloat(s.avg_daily_g) || 0), 0);
      if (totalG > 0) avgDailyG = Math.round(totalG);
    }
  } catch(e) {}
  return { avgDaily, avgDailyG };
}

// ── FORMAT avg_daily per display — SEMPRE in porzioni, mai in unità prep ──
function fmtAvgDaily(avgDaily) {
  if (!avgDaily || avgDaily <= 0) return null;
  const n = Math.round(avgDaily * 10) / 10;
  return (Number.isInteger(n) ? n : n) + ' portions/day';
}

// ── FORMAT avg_daily_g — SEMPRE in grammi assoluti, indipendente da prep_task.unit ──
// avg_daily_g è sempre grammi. Non usare humanQty(avgDailyG, prep_unit).
function fmtMassG(grams) {
  if (!grams || grams <= 0) return null;
  if (grams >= 1000) return (grams / 1000).toFixed(2).replace(/\.?0+$/, '') + ' kg';
  return Math.round(grams) + ' g';
}

// ── isPieceUnit — unità contabili, Bot usage non ha senso in grammi ──
// Copre varianti EN/IT/abbrev per evitare falsi negativi
function isPieceUnit(u) {
  return ['pezzi','pz','piece','pieces','pcs','ea','each'].includes(String(u||'').toLowerCase().trim());
}

// ── HUMANIZE QTY per display ──
function humanQty(qty, unit) {
  if (!qty || qty <= 0) return null;
  const u = (unit || '').toLowerCase().trim();
  if (u === 'g') {
    if (qty >= 1000) return (qty / 1000).toFixed(1).replace(/\.0$/, '') + ' kg';
    return Math.round(qty) + ' g';
  }
  if (['pezzi','pz'].includes(u)) return Math.ceil(qty) + ' ' + (qty === 1 ? 'piece' : 'pieces');
  if (u === 'cup') return Math.ceil(qty) + ' cup' + (qty > 1 ? 's' : '');
  if (u === 'nests') return Math.ceil(qty) + ' nests';
  return Math.ceil(qty) + (unit ? ' ' + unit : '');
}

// ── CHEF AI NOTE — testo della card basato sul tipo ──
// Status/testo COERENTI:
//   🟢 Looks okay     → no prep, usa batch esistente
//   🟠 Prep today     → quantità affidabile, produci
//   🟠 Large batch    → quantità grande, verifica prima
//   🔴 Do first       → urgente affidabile, produci subito
//   🔴 Count first    → stock sospetto, conta prima
//   ⚠️ Needs setup   → problema strutturale
function buildChefAiNote(i, cardType) {
  const chef  = chefGreeting();
  const name  = i.name;
  const stock = parseFloat(i.current_stock) || 0;
  const qty   = parseFloat(i.suggested_qty) || 0;
  const unit  = i.unit || '';
  const { avgDaily, avgDailyG } = parseSourcesNumbers(i);
  const note     = i.suggested_note || '';
  const botColor = note.includes('|') ? note.split('|')[0] : null;

  const qtyHuman      = humanQty(qty, unit);
  const stockHuman    = (stock > 0) ? humanQty(stock, unit) : null;
  // expectedToday / botUsageToday non usati nel body (numeri sono in numbersHtml) — rimossi

  function goodThroughDay() {
    const rawEN = note.split('|')[2] || '';
    const m = rawEN.match(/good through (\w+)/i) || rawEN.match(/enough through (\w+)/i);
    return m ? m[1] : null;
  }

  // ── COUNT RECONCILED — kitchen count recente e valido ────────
  // Priorità assoluta: se esiste count valido, la card usa quello.
  // headline = messaggio corto. body = nota del reconciler (no duplicati).
  // action = solo se c'è qualcosa da fare.
  if (cardType === 'COUNT_RECONCILED') {
    const row = getValidCount(i.id);
    if (row) {
      const countedHuman = humanQty(parseFloat(row.counted_qty), row.unit || unit);
      // reconciled_note è già il testo completo prodotto dal bot ("Stock confirmed: X. ...")
      // Non ripetere info nell'headline — headline è solo il contesto personale
      if (row.reconcile_status === 'sufficient') {
        return {
          headline: chef + ', ' + name + ' — count confirmed.',
          body: row.reconciled_note || ('Stock confirmed: ' + countedHuman + '. Enough for today — no urgent prep needed.'),
          action: null  // "no urgent prep" è già nel body, non serve ripeterlo
        };
      }
      if (row.reconcile_status === 'prep_more') {
        return {
          headline: chef + ', ' + name + ' needs a bit more prep.',
          body: row.reconciled_note || ('Stock confirmed: ' + countedHuman + '.'),
          action: null  // la qty da fare è già nel reconciled_note
        };
      }
      // manual_review — Chef deve decidere
      return {
        headline: chef + ', ' + name + ' — count saved.',
        body: row.reconciled_note || ('Stock confirmed: ' + countedHuman + '. Chef will review the final prep amount.'),
        action: null
      };
    }
  }

  // ── COUNT FIRST ─────────────────────────────────────────────
  if (cardType === 'COUNT_FIRST') {
    const { unit: kUnit, hint } = kitchenCountUnit(i);
    const stockSays = stock === 0 ? 'zero' : stockHuman;
    return {
      headline: chef + ', Chef AI is not sure about this count.',
      body: 'The system shows ' + stockSays + ' for ' + name + ' — but that may not be right. Can you do a quick count before prepping more?',
      action: null,
      countUnit: kUnit,
      countHint: hint
    };
  }

  // ── STAGED_CHECK ────────────────────────────────────────────
  // Vendite basse + stock ready-to-sell=0 → controlla batch staged prima
  if (cardType === 'STAGED_CHECK') {
    // Stats (Avg sales / Bot usage / Stock) are shown in numbersHtml — body = operational text only
    const { unit: kUnit } = kitchenCountUnit(i);
    return {
      headline: chef + ', ' + name + ' — check staged stock first.',
      body: 'Before prepping more, check the seasoned and par-cooked stock. Use what you have, rotate batches.',
      action: 'Use seasoned first, then par-cooked. No fresh prep unless both are low.',
      countUnit: kUnit,
      isStaged: true
    };
  }

  // ── LARGE BATCH ─────────────────────────────────────────────
  if (cardType === 'LARGE_BATCH') {
    // Stats in numbersHtml — body = operational warning only
    return {
      headline: chef + ', ' + name + ' may need a large batch today.',
      body: 'Chef AI suggests ' + (qtyHuman || qty + ' ' + unit) + ' — that is a large amount. Verify with Chef before making the full batch.',
      action: 'Make normal batch first / Check with Chef.'
    };
  }

  // ── WATCH ───────────────────────────────────────────────────
  // Uncertain ma non critico — non interrompere la cucina
  if (cardType === 'WATCH') {
    // Stats in numbersHtml — body = status text only
    return {
      headline: chef + ', ' + name + ' — low data, no action needed.',
      body: 'Only check this if you are already working on it today.',
      action: null
    };
  }

  // ── CHEF_REVIEW ──────────────────────────────────────────────
  // Bot completamente cieco — non chiedere alla cucina, passa all'office
  if (cardType === 'CHEF_REVIEW') {
    return {
      headline: name + ' — needs data setup.',
      body: 'Chef AI has no sales data for this item yet. No action needed from kitchen.',
      action: null
    };
  }

  // ── BLOCKED ─────────────────────────────────────────────────
  if (cardType === 'BLOCKED') {
    return {
      headline: 'Needs setup',
      body: "Missing recipe or ingredient link. Chef review needed in L'Ufficio.",
      action: null
    };
  }

  // ── No bot data yet ──────────────────────────────────────────
  if (!botColor) {
    return {
      headline: chef + ', ' + name + ' — no suggestion yet.',
      body: stockHuman ? 'Stock: ' + stockHuman + '.' : 'No stock count available.',
      action: null
    };
  }

  // ── 🟢 Looks okay ────────────────────────────────────────────
  if (botColor === 'green') {
    // Stats (Avg sales / Bot usage / In stock) shown in numbersHtml
    // "Enough through X" stays in body — it's the key operational message for green cards
    const goodThrough = goodThroughDay();
    return {
      headline: chef + ', ' + name + ' looks okay for today.',
      body: goodThrough ? 'Enough through ' + goodThrough + '.' : 'Stock looks good for today.',
      action: 'No prep needed. Use existing batch.'
    };
  }

  // ── 🟠 Prep today ────────────────────────────────────────────
  // "Good through Wednesday" rimosso dalla card principale — va solo nei Details
  if (botColor === 'yellow') {
    // Stats in numbersHtml — body = status fallback only
    return {
      headline: chef + ', ' + name + ' needs prep today.',
      body: 'Stock is getting low.',
      action: qtyHuman ? 'Make about ' + qtyHuman + ' today.' : 'Prep when you can.'
    };
  }

  // ── 🔴 Do first ──────────────────────────────────────────────
  // Tono: sous-chef calmo, non sirena
  if (botColor === 'red') {
    // Stats in numbersHtml — body = status fallback for when stock info isn't in numbersHtml
    return {
      headline: chef + ', I would start ' + name + ' early today.',
      body: stockHuman ? 'Running low.' : 'Stock is at zero.',
      action: qtyHuman ? 'Make ' + qtyHuman + ' first thing.' : 'Prep this first.'
    };
  }

  return {
    headline: chef + ', check ' + name + '.',
    body: 'No suggestion data available.',
    action: null
  };
}

// ── RENDER CHEF AI BLOCK (dentro la card) ──
function renderChefAiBlock(i, cardType) {
  const { headline, body, action } = buildChefAiNote(i, cardType);
  const iid = i.id;

  // STATUS PILL
  const statusMap = {
    TRUSTED: {
      green:  { emoji: '🟢', label: 'Looks okay',   bg: 'rgba(5,150,105,0.08)',   border: '#bbf7d0', color: '#059669' },
      yellow: { emoji: '🟠', label: 'Prep today',   bg: 'rgba(217,119,6,0.08)',   border: '#fde68a', color: '#d97706' },
      red:    { emoji: '🔴', label: 'Do first',     bg: 'rgba(220,38,38,0.08)',   border: '#fca5a5', color: '#dc2626' },
      '':     { emoji: '⚪', label: 'Watch',        bg: 'rgba(100,116,139,0.06)', border: '#e2e8f0', color: '#64748b' },
    },
    COUNT_RECONCILED: { emoji: '✅', label: 'Count confirmed', bg: 'rgba(5,150,105,0.08)', border: '#bbf7d0', color: '#059669' },
    COUNT_RECONCILED_MORE: { emoji: '🟠', label: 'Prep today', bg: 'rgba(217,119,6,0.08)', border: '#fde68a', color: '#d97706' },
    COUNT_RECONCILED_REVIEW: { emoji: '🔵', label: 'Count saved', bg: 'rgba(37,99,235,0.08)', border: '#bfdbfe', color: '#1d4ed8' },
    STAGED_CHECK: { emoji: '🟡', label: 'Check staged stock',  bg: 'rgba(234,179,8,0.08)',   border: '#fef08a', color: '#854d0e' },
    LARGE_BATCH:  { emoji: '🟠', label: 'Large batch — verify', bg: 'rgba(217,119,6,0.1)',   border: '#fde68a', color: '#b45309' },
    COUNT_FIRST:  { emoji: '🔴', label: 'Count first',          bg: 'rgba(220,38,38,0.08)',  border: '#fca5a5', color: '#dc2626' },
    WATCH:         { emoji: '⚪',  label: 'Watch',               bg: 'rgba(100,116,139,0.06)', border: '#e2e8f0', color: '#64748b' },
    CHEF_REVIEW:  { emoji: '🔵',  label: 'Chef review',         bg: 'rgba(37,99,235,0.06)',   border: '#bfdbfe', color: '#1d4ed8' },
    BLOCKED:      { emoji: '⚠️',  label: 'Needs setup',          bg: 'rgba(100,100,100,0.06)', border: '#e2e8f0', color: '#64748b' },
  };

  let statusCfg;
  if (cardType === 'TRUSTED') {
    const note = i.suggested_note || '';
    const col = note.includes('|') ? note.split('|')[0] : '';
    statusCfg = statusMap.TRUSTED[col] || statusMap.TRUSTED[''];
  } else if (cardType === 'COUNT_RECONCILED') {
    // Scegli sub-stato da reconcile_status
    const row = getValidCount(i.id);
    const rs = row?.reconcile_status || 'manual_review';
    statusCfg = rs === 'sufficient'     ? statusMap.COUNT_RECONCILED
              : rs === 'prep_more'      ? statusMap.COUNT_RECONCILED_MORE
              : statusMap.COUNT_RECONCILED_REVIEW;
  } else if (cardType === 'WATCH') {
    statusCfg = statusMap.WATCH;
  } else if (cardType === 'CHEF_REVIEW') {
    statusCfg = statusMap.CHEF_REVIEW;
  } else {
    statusCfg = statusMap[cardType] || statusMap.BLOCKED;
  }

  const statusPill = `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:${statusCfg.color};background:${statusCfg.bg};border:1px solid ${statusCfg.border};border-radius:20px;padding:3px 9px;letter-spacing:0.02em;">${statusCfg.emoji} ${statusCfg.label}</span>`;

  // NUMBERS SECTION — solo se abbiamo dati
  // avgDaily = porzioni/giorno POS  |  avgDailyG = consumo g/giorno (dal bot)
  const { avgDaily, avgDailyG } = parseSourcesNumbers(i);
  const stock = parseFloat(i.current_stock);
  const qty = parseFloat(i.suggested_qty) || 0;
  const unit = i.unit || '';
  const stockHuman = (stock > 0) ? humanQty(stock, unit) : null;
  const avgDailyHuman = avgDaily ? fmtAvgDaily(avgDaily) : null;  // "N portions/day"
  // fmtMassG: avgDailyG è SEMPRE grammi assoluti — non dipendere da prep_task.unit
  const botUsageHuman = avgDailyG ? fmtMassG(avgDailyG) + '/day' : null; // "460 g/day" o "1.45 kg/day"
  const suggHuman = humanQty(qty, unit);

  let numbersHtml = '';
  const nums = [];
  if (avgDailyHuman) nums.push(`<span>Avg sales: <b>${avgDailyHuman}</b></span>`);
  // Bot usage — mostra solo se è significativo e diverso dalle porzioni
  // isPieceUnit: non mostrare Bot usage su unità contabili (pezzi/pz/piece/pieces/pcs/ea/each)
  if (botUsageHuman && !isPieceUnit(unit))
    nums.push(`<span>Bot usage: <b>~${botUsageHuman}</b></span>`);
  if (stockHuman)    nums.push(`<span>In stock: <b>${stockHuman}</b></span>`);
  if (suggHuman && (cardType === 'TRUSTED') && (i.suggested_note||'').split('|')[0] !== 'green')
    nums.push(`<span>Suggested: <b>${suggHuman}</b></span>`);
  if (nums.length > 0) {
    numbersHtml = `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:5px;font-size:12px;color:#475569;">${nums.join('')}</div>`;
  }

  // HEADLINE
  const headlineHtml = `<div style="font-size:13px;font-weight:600;color:#1e3a5f;margin-top:6px;line-height:1.4;">${headline}</div>`;

  // BODY
  const bodyHtml = body ? `<div style="font-size:12px;color:#475569;margin-top:3px;line-height:1.5;">${body}</div>` : '';

  // ACTION
  const actionHtml = action ? `<div style="font-size:12px;font-weight:700;color:#1e3a5f;margin-top:4px;">${action}</div>` : '';

  // COUNT FIRST INPUT — usa unità da cucina (qt, lb, pieces) non g raw
  let countInputHtml = '';
  if (cardType === 'COUNT_FIRST' || cardType === 'STAGED_CHECK') {
    const { unit: kUnit, hint: kHint } = kitchenCountUnit(i);
    const displayUnit = kUnit || unit || 'units';
    const hintSpan = kHint ? `<span style="font-size:11px;color:#94a3b8;margin-left:4px;">${kHint}</span>` : '';
    const isPiecesUnit = ['pezzi','pz','pieces'].includes((kUnit||'').toLowerCase());
    const countQuestion = isPiecesUnit
      ? 'How many do we actually have?'
      : ((i.name||'').toLowerCase().includes('brussels') || (i.name||'').toLowerCase().includes('sprout'))
        ? 'How much seasoned / ready-to-sell do we have?'
        : 'How much do we actually have?';
    countInputHtml = `
      <div style="margin-top:10px;">
        <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;">${countQuestion}</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <input
            id="count-input-${iid}"
            type="number"
            min="0"
            step="0.5"
            placeholder="0"
            style="width:80px;height:40px;border:2px solid #cbd5e1;border-radius:10px;font-size:18px;font-weight:700;text-align:center;color:#1e3a5f;background:#f8fafc;outline:none;"
            onclick="event.stopPropagation();"
            onfocus="this.style.borderColor='#2563eb';"
            onblur="this.style.borderColor='#cbd5e1';"
          >
          <span style="font-size:13px;color:#64748b;font-weight:500;">${displayUnit}${hintSpan}</span>
          <button
            onclick="event.stopPropagation();saveKitchenCount(${JSON.stringify(iid)})"
            style="height:40px;padding:0 16px;border-radius:10px;font-size:13px;font-weight:700;background:#1e3a5f;color:white;border:none;cursor:pointer;flex-shrink:0;"
          >Save count</button>
        </div>
      </div>`;
  }

  // DETAILS COLLAPSED — debug tecnico
  const botColor = (i.suggested_note||'').split('|')[0] || '—';
  const rawNote  = (i.suggested_note||'').split('|').slice(1).join(' | ') || '—';
  const detailsHtml = `
    <details style="margin-top:8px;">
      <summary style="font-size:11px;color:#94a3b8;cursor:pointer;user-select:none;list-style:none;">
        <span style="font-size:10px;font-weight:600;color:#94a3b8;letter-spacing:0.5px;text-transform:uppercase;">Details ↓</span>
      </summary>
      <div style="margin-top:6px;background:#f8fafc;border-radius:8px;padding:8px 10px;font-size:11px;color:#64748b;line-height:1.7;font-family:monospace;">
        <div>Bot stock: ${i.current_stock ?? '—'} ${unit}</div>
        <div>Bot suggestion: ${i.suggested_qty ?? '—'} ${unit}</div>
        <div>Pill: ${botColor}</div>
        <div>Source: ${i.suggested_by || '—'}</div>
        <div>Note: ${rawNote}</div>
      </div>
    </details>`;

  return `<div style="margin-top:6px;">${statusPill}${headlineHtml}${bodyHtml}${numbersHtml}${actionHtml}${countInputHtml}${detailsHtml}</div>`;
}

// ── SAVE KITCHEN COUNT ──
window.saveKitchenCount = async function(id) {
  const it = tasks[id];
  if (!it) return;
  const input = document.getElementById('count-input-' + id);
  if (!input) return;
  const val = parseFloat(input.value);
  if (isNaN(val) || val < 0) {
    input.style.borderColor = '#ef4444';
    setTimeout(() => input.style.borderColor = '#cbd5e1', 1200);
    return;
  }

  const unit = it.unit || '';
  const prevStock = parseFloat(it.current_stock) || 0;
  const prevSugg  = parseFloat(it.suggested_qty) || null;
  const prevBy    = it.suggested_by || null;
  const userName  = window.user?.name || 'unknown';

  // 1. Salva in prep_stock_counts — NON in prep_tasks.suggested_*
  const { data: countRows, error: countErr } = await supa.from('prep_stock_counts').insert({
    prep_task_id:        id,
    counted_qty:         val,
    unit:                unit,
    counted_by:          userName,
    source:              'kitchen_count',
    prev_bot_stock:      prevStock,
    prev_bot_suggestion: prevSugg,
    prev_suggested_by:   prevBy
  }).select('id');

  const countId = countRows?.[0]?.id || null;

  // 2. Aggiorna current_stock (loggato in prev_bot_stock — non distruttivo)
  await supa.from('prep_tasks').update({ current_stock: val }).eq('id', id);
  tasks[id].current_stock = val;
  if (items) {
    const idx = items.findIndex(x => x.id === id);
    if (idx >= 0) items[idx].current_stock = val;
  }

  // 3. Mostra feedback immediato "saving..."
  const cardEl = document.querySelector('[data-audit-id="' + id + '"]');
  const confirmBlock = cardEl?.querySelector('.chef-ai-card-block');
  if (confirmBlock) {
    confirmBlock.innerHTML = '<div style="margin-top:8px;font-size:13px;color:#64748b;">⏳ Chef AI is reconciling the count…</div>';
  }

  // 4. Chiama il reconciler on-demand
  let reconcilerResult = null;
  if (countId) {
    try {
      const resp = await fetch(
        `${SUPABASE_URL}/functions/v1/bot-prep-count-reconciler`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY },
          body: JSON.stringify({ prep_task_id: id, count_id: countId })
        }
      );
      if (resp.ok) reconcilerResult = await resp.json();
    } catch(e) {
      // Reconciler fallito — mostra comunque "count saved"
    }
  }

  // 5. Aggiorna _recentCounts locale con il risultato del reconciler
  if (reconcilerResult?.ok) {
    window._recentCounts[id] = {
      id:                countId,
      prep_task_id:      id,
      counted_qty:       val,
      unit:              unit,
      counted_by:        userName,
      counted_at:        new Date().toISOString(),
      reconcile_status:  reconcilerResult.reconcile_status,
      reconciled_qty:    reconcilerResult.reconciled_qty,
      reconciled_note:   reconcilerResult.reconciled_note,
      expires_at:        reconcilerResult.expires_at,
      prev_bot_stock:    prevStock,
      prev_bot_suggestion: prevSugg,
      prev_suggested_by: prevBy,
    };
  }

  // 6. Aggiorna card inline con il risultato
  if (confirmBlock) {
    const confirmQty = humanQty(val, unit) || val + ' ' + unit;
    let statusEmoji = '✅';
    let statusLabel = 'Count confirmed';
    let msg = reconcilerResult?.reconciled_note
      || (val > 0
        ? 'Stock confirmed: ' + confirmQty + '. Chef AI will update the prep suggestion next run.'
        : 'Stock confirmed: 0. You may need to prep today. Chef will review.');
    // Colore in base al reconcile_status
    const rs = reconcilerResult?.reconcile_status;
    const statusColor = rs === 'sufficient' ? '#059669'
                      : rs === 'prep_more'   ? '#d97706'
                      : '#1d4ed8';
    const statusBg    = rs === 'sufficient' ? 'rgba(5,150,105,0.08)'
                      : rs === 'prep_more'   ? 'rgba(217,119,6,0.08)'
                      : 'rgba(37,99,235,0.08)';
    const statusBorder = rs === 'sufficient' ? '#bbf7d0'
                       : rs === 'prep_more'   ? '#fde68a'
                       : '#bfdbfe';
    if (rs === 'prep_more') { statusEmoji = '🟠'; statusLabel = 'Prep more'; }
    else if (rs === 'manual_review') { statusEmoji = '🔵'; statusLabel = 'Count saved'; }

    // Debug da mostrare nei Details
    const debugHtml = isAdmin() ? `
      <details style="margin-top:8px;">
        <summary style="font-size:10px;font-weight:600;color:#94a3b8;cursor:pointer;text-transform:uppercase;letter-spacing:0.5px;">Details ↓</summary>
        <div style="margin-top:4px;background:#f8fafc;border-radius:8px;padding:8px 10px;font-size:11px;color:#64748b;line-height:1.7;font-family:monospace;">
          <div>Bot stock before: ${prevStock} ${unit}</div>
          <div>Bot suggestion: ${prevSugg || '—'} ${unit}</div>
          <div>Kitchen count: ${val} ${unit}</div>
          <div>Reconcile: ${rs || 'pending'}</div>
          <div>Counted by: ${userName}</div>
        </div>
      </details>` : '';

    confirmBlock.innerHTML = `
      <div style="margin-top:6px;">
        <span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:${statusColor};background:${statusBg};border:1px solid ${statusBorder};border-radius:20px;padding:3px 9px;">${statusEmoji} ${statusLabel}</span>
        <div style="font-size:13px;font-weight:600;color:#1e3a5f;margin-top:6px;">${msg}</div>
        ${debugHtml}
      </div>`;
  }
};

// ── PREP ──
// ── PREP FEED VIEW MODE — default: actionable only ──────────────────────────
// 'actionable' = default (nasconde looks_ok, watch, blocked, chef_review)
// 'all'        = mostra tutto (attivato da admin col toggle)
window._prepViewAll = window._prepViewAll || false;

// Controlla se una card è visibile nel default feed
function isActionableCard(i) {
  const ct = classifyCard(i);
  if (ct === 'TRUSTED') {
    const col = (i.suggested_note||'').split('|')[0];
    if (col === 'green') return false; // Looks okay — nascosta per default
    return true; // red, yellow, no-note → actionable
  }
  if (ct === 'WATCH')      return false;
  if (ct === 'BLOCKED')    return false;
  if (ct === 'CHEF_REVIEW') return false;
  // COUNT_FIRST, STAGED_CHECK, LARGE_BATCH, COUNT_RECONCILED → sempre visibili
  return true;
}

function renderM(){
  const _pq=(window._prepSearchQuery||'').toLowerCase().trim();
  const base=items.filter(i=>{
    if(station!=='All'&&i.category!==station) return false;
    if(_pq && !i.name.toLowerCase().includes(_pq)) return false;
    return true;
  });
  // ── FILTRO DEFAULT: solo card actionable (nascondi Looks okay / Watch / Setup) ──
  const actionableBase = window._prepViewAll ? base : base.filter(isActionableCard);
  const hiddenCount = base.length - actionableBase.length;

  // ordinamento: in_progress > urgenti > gialli > normali
  const list=actionableBase.sort((a,b)=>{
    const score=i=>{
      if(i.in_progress) return 5;
      if(i.prep_type==='checklist') return 1; // checklist: sempre sotto le prep urgenti
      // Urgenza da bot (suggested_note)
      if(i.suggested_note && i.suggested_note.includes('|')){
        const col=i.suggested_note.split('|')[0];
        if(col==='red') return 4;
        if(col==='yellow') return 3;
        if(col==='green') return 2;
      }
      return 0; // nessun dato bot
    };
    if(score(b)!==score(a)) return score(b)-score(a);
    return a.name.localeCompare(b.name);
  });
  const pc=base.filter(i=>i.need_tomorrow&&!i.in_progress).length;
  const total=base.length;

  // barra progresso urgenti
  const prog=document.getElementById('urgentProgress');
  const bar=document.getElementById('urgentBar');
  const cnt=document.getElementById('urgentCount');
  const done=document.getElementById('urgentDone');
  const timeEl=document.getElementById('urgentTime');
  if(prog){
    if(total>0){
      prog.classList.remove('hidden');
      const completed=total-pc;
      const pct=Math.round((completed/total)*100);
      if(bar) bar.style.width=pct+'%';
      if(cnt) cnt.textContent=pc;
      const dn=getNowDallas();
      const deadline=getNowDallas(); deadline.setHours(14,30,0,0);
      const diffMs=deadline-dn;
      if(timeEl){
        if(diffMs>0){
          const h=Math.floor(diffMs/3600000);
          const m=Math.floor((diffMs%3600000)/60000);
          timeEl.textContent=h>0?`${h}h ${m}m `+tr('timeLimit'):`${m}m `+tr('timeLimit');
          timeEl.className=diffMs<3600000?'text-xs text-red-500 font-semibold':'text-xs text-slate-400';
        } else {
          timeEl.textContent=tr('timeExpired');
          timeEl.className='text-xs text-red-600 font-bold';
        }
      }
      if(done) done.classList.toggle('hidden',pc>0);
      if(pc===0&&total>0) showConfetti();
    } else {
      prog.classList.add('hidden');
    }
  }

  // station note
  const stationKey = station==='All'?null:station;
  const stNote = stationKey && stationNotes[stationKey] ? stationNotes[stationKey] : null;

  grid.innerHTML=(stNote?`<div class="col-span-2 mb-2 px-3 py-2 rounded-xl text-[11px]" style="background:rgba(251,191,36,0.15);border-left:4px solid #f59e0b;color:#92400e;">${stNote}</div>`:'')+
    list.map(i=>{
      const iid = i.id;
      const borderColor = cardBorderColor(i);
      const isWip = i.in_progress;
      // URGENT solo se il bot dice red — mai sui checklist
      const botColor = i.suggested_note && i.suggested_note.includes('|') ? i.suggested_note.split('|')[0] : null;
      const isUrgent = !i.in_progress && i.prep_type!=='checklist' && botColor==='red';
      const nameColor = isWip?'#1e40af':isUrgent?'#991b1b':'#0f172a';

      const badge = isWip
        ? '<span style="font-size:10px;font-weight:600;color:#185fa5;background:rgba(55,138,221,0.12);padding:2px 6px;border-radius:6px;">'+tr('inProgress')+'</span>'
        : ''; // URGENT badge rimosso — bordo colorato è sufficiente

      // Chef AI card block — sostituisce botPill con sistema nuovo
      // classifyCard e renderChefAiBlock definiti sopra nella sezione CHEF AI CARD SYSTEM
      const _ct = classifyCard(i); // FIX boh-v605: cardType was undefined in map scope
      const botPill = isWip ? '' : '<div class="chef-ai-card-block">' + renderChefAiBlock(i, _ct) + '</div>';

      // Today log strip — ultimi log di oggi per questo item
      let todayLogStrip = '';
      if(i.prep_type !== 'checklist'){
        const tlogs = getTodayLogsFor(i.name);
        if(tlogs.length > 0){
          const logEntries = tlogs.slice(-3).map(l=>{
            const qty = parseFloat(l.qty);
            const qtyStr = Number.isInteger(qty) ? qty : parseFloat(qty.toFixed(1));
            const unit = l.unit||'';
            const timeStr = fmtLogTime(l.created_at);
            return '<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(5,150,105,0.08);border:0.5px solid rgba(5,150,105,0.2);border-radius:10px;padding:2px 8px;font-size:12px;color:#374151;white-space:nowrap;"><b style="color:#1e3a5f">'+l.user_name+'</b>&nbsp;'+qtyStr+unit+'&nbsp;<span style="color:#9ca3af">'+timeStr+'</span></span>';
          }).join('');
          todayLogStrip = '<div style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;"><span style="font-size:10px;font-weight:700;color:#9ca3af;letter-spacing:0.8px;text-transform:uppercase;">Today</span>'+logEntries+'</div>';
        }
      }

      const stockPill = buildStockPill(i);
      // Audit toggle — solo admin, visibile sempre ma il panel si apre on-demand
      const auditBtn = isAdmin()
        ? '<div style="margin-top:6px;"><button class="audit-toggle-btn" onclick="event.stopPropagation();toggleAuditPanel('+JSON.stringify(iid)+')" style="font-size:11px;font-weight:600;color:#7c3aed;background:rgba(124,58,237,0.08);border:0.5px solid rgba(124,58,237,0.25);border-radius:6px;padding:2px 8px;cursor:pointer;">🔍 Audit</button></div>'
        : '';

      // Chef AI buttons — solo admin
      const hasBotNote = !!(i.suggested_note && i.suggested_note.includes('|'));
      const chefAiBtns = isAdmin()
        ? '<div style="margin-top:5px;display:flex;gap:4px;flex-wrap:wrap;">'
          + '<button class="chef-ai-prep-btn" onclick="event.stopPropagation();chefAiAuditPrep('+JSON.stringify(iid)+')" style="font-size:11px;font-weight:700;color:#1e40af;background:linear-gradient(135deg,rgba(239,246,255,0.9),rgba(219,234,254,0.9));border:1px solid #93c5fd;border-radius:6px;padding:2px 8px;cursor:pointer;">🧠 Controlla prep</button>'
          + (hasBotNote ? '<button class="chef-ai-explain-btn" onclick="event.stopPropagation();chefAiExplainBot('+JSON.stringify(iid)+')" style="font-size:11px;font-weight:700;color:#7c3aed;background:linear-gradient(135deg,rgba(245,243,255,0.9),rgba(237,233,254,0.9));border:1px solid #c4b5fd;border-radius:6px;padding:2px 8px;cursor:pointer;">📉 Spiega suggerimento bot</button>' : '')
          + '</div>'
        : '';
      const btn = cardButton(i);
      // recipeTag solo admin
      const recipeTag = !isAdmin() ? ''
        : i.recipe_id ? '<span style="font-size:11px;color:#059669;font-weight:500;">'+tr('recipe')+'</span>'
        : window.prepTasksWithSteps?.has(String(iid)) ? '<span style="font-size:11px;color:#7c3aed;font-weight:500;">▶ steps</span>'
        : i.note ? '<span style="font-size:11px;color:#d97706;">'+tr('note')+'</span>'
        : '<span style="font-size:11px;color:#94a3b8;">'+tr('noRecipeLink')+'</span>';

      const adminIcons = isAdmin()
        ? '<span style="display:flex;gap:4px;align-items:center;"><button onclick="adminRename('+JSON.stringify(iid)+')" style="font-size:14px;color:#94a3b8;background:none;border:none;padding:4px;">✏</button><button onclick="adminDel('+JSON.stringify(iid)+')" style="font-size:14px;color:#94a3b8;background:none;border:none;padding:4px;">🗑</button></span>'
        : '';
      const btnBelow = !isWip; // bottone largo sotto solo se non in progress
      return '<div class="col-span-2 mb-2 active:scale-[0.98] transition-transform" data-audit-id="'+iid+'" style="background:rgba(255,255,255,0.60);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-radius:16px;border-left:6px solid '+borderColor+';box-shadow:0 2px 8px rgba(30,58,95,0.06),0 8px 24px rgba(30,58,95,0.04),inset 0 1px 0 rgba(255,255,255,0.9);">'
        +'<div style="padding:12px 12px '+(btnBelow?'8':'12')+'px 14px;">'
          +'<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">'
            +'<div style="flex:1;min-width:0;cursor:pointer;" onclick="prepOpenRecipe('+JSON.stringify(iid)+')">'
              +'<div style="font-size:17px;font-weight:700;color:'+nameColor+';line-height:1.3;">'+i.name+'</div>'
              +(badge?'<div style="margin-top:4px;">'+badge+'</div>':'')
              +(recipeTag?'<div style="margin-top:3px;">'+recipeTag+'</div>':'')
              +botPill
              +auditBtn
              +chefAiBtns
              +todayLogStrip
              +stockPill
            +'</div>'
            +'<div style="display:flex;gap:4px;flex-shrink:0;align-items:center;">'
              +(isWip?btn:'')
              +adminIcons
            +'</div>'
          +'</div>'
          +(btnBelow?'<div style="margin-top:10px;padding-bottom:4px;">'+btn+'</div>':'')
        +'</div>'
        +'<div class=\"audit-detail\" style=\"display:none;\"></div>'
        +'<div class=\"chef-ai-panel\" id=\"chef-ai-panel-'+iid+'\" style=\"display:none;\"></div>'
      +'</div>';
    }).join('');

  // ── BANNER "items nascosti" — mostra solo se ci sono card filtrate ──
  if (hiddenCount > 0 && !window._prepViewAll) {
    const existingBanner = document.getElementById('prepHiddenBanner');
    const banner = existingBanner || document.createElement('div');
    banner.id = 'prepHiddenBanner';
    banner.style.cssText = 'margin-top:10px;padding:10px 14px;border-radius:12px;background:rgba(100,116,139,0.07);border:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;gap:8px;';
    banner.innerHTML = `
      <span style="font-size:12px;color:#64748b;">
        <b>${hiddenCount}</b> item${hiddenCount>1?'s':''} hidden (Looks okay / Watch)
      </span>
      <button onclick="window._prepViewAll=true;renderM();"
        style="font-size:12px;font-weight:700;color:#1e3a5f;background:rgba(30,58,95,0.08);border:1px solid rgba(30,58,95,0.2);border-radius:8px;padding:4px 12px;cursor:pointer;">
        Show all
      </button>`;
    if (!existingBanner) grid.after(banner);
  } else {
    const b = document.getElementById('prepHiddenBanner');
    if (b) b.remove();
  }

  // Se _prepViewAll è attivo, mostra banner "Back to actionable"
  if (window._prepViewAll) {
    const existingAll = document.getElementById('prepShowAllBanner');
    const allBanner = existingAll || document.createElement('div');
    allBanner.id = 'prepShowAllBanner';
    allBanner.style.cssText = 'margin-bottom:8px;padding:8px 14px;border-radius:12px;background:rgba(30,58,95,0.06);border:1px solid rgba(30,58,95,0.15);display:flex;align-items:center;justify-content:space-between;gap:8px;';
    allBanner.innerHTML = `
      <span style="font-size:12px;color:#475569;">Showing all ${base.length} items</span>
      <button onclick="window._prepViewAll=false;renderM();"
        style="font-size:12px;font-weight:700;color:#059669;background:rgba(5,150,105,0.08);border:1px solid rgba(5,150,105,0.25);border-radius:8px;padding:4px 12px;cursor:pointer;">
        Show actionable only
      </button>`;
    if (!existingAll) grid.before(allBanner);
  } else {
    const b = document.getElementById('prepShowAllBanner');
    if (b) b.remove();
  }
}

// ── AZIONI CARD ──

// OPEN RECIPE — sola lettura, senza avviare la prep
window.prepOpenRecipe = function(id){
  const it = tasks[id];
  if(!it) return;
  if(typeof recipeModal!=='undefined'){
    recipeModal.open(it.recipe_id||null, id);
  }
};

// START — primo avvio: apre ricetta, segna in_progress
window.prepStart = async function(id){
  const it = tasks[id];
  if(!it) return;
  // Se già in progress → SEE STEPS
  if(it.in_progress){ prepSeeSteps(id); return; }
  // Segna in_progress nel DB (optimistic) + traccia orario start
  tasks[id].in_progress = true;
  _startTimes[id] = new Date();
  supa.from('prep_tasks').update({in_progress:true}).eq('id',id).then(()=>{}).catch(()=>{});
  renderM();
  // Apre il recipe modal con tracking dello step (funziona anche senza recipe_id)
  if(typeof recipeModal!=='undefined'){
    recipeModal.open(it.recipe_id||null, id);
  }
};

// SEE STEPS — riapre la ricetta allo step dove eri
window.prepSeeSteps = function(id){
  const it = tasks[id];
  if(!it) return;
  recipeModal.open(it.recipe_id||null, id);
};

// DONE — apre modal quantità
window.prepDone = function(id){
  openDoneSheet(id);
};

// ── DONE SHEET ──
// ── TODAY LOG HELPERS ──
function buildTodayLogBanner(tlogs){
  if(!tlogs||!tlogs.length) return '';
  const rows = tlogs.slice(-3).map(l=>{
    const qty = parseFloat(l.qty);
    const qtyStr = Number.isInteger(qty) ? qty : parseFloat(qty.toFixed(1));
    const unit = l.unit||'';
    const timeStr = fmtLogTime(l.created_at);
    return `<div style="display:flex;align-items:center;gap:6px;font-size:13px;color:#374151;"><span style="font-size:14px;">🧑‍🍳</span><b style="color:#1e3a5f">${l.user_name}</b><span style="color:#6b7280">${timeStr}</span><span style="font-weight:600;color:#059669">${qtyStr} ${unit}</span></div>`;
  }).join('');
  return `<div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.3);border-radius:12px;padding:10px 12px;margin-bottom:10px;">
    <div style="font-size:11px;font-weight:700;color:#92400e;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:6px;">⚠️ Already logged today</div>
    ${rows}
  </div>`;
}

// Intercetta il Done — se ci sono log di oggi chiede conferma
window.doneSheetConfirm = function(id, btn){
  const tlogs = getTodayLogsFor(tasks[id]?.name||'');
  if(tlogs.length === 0){
    detailSave(id, btn, false);
    return;
  }
  const sheet = btn.closest('.fixed');
  const qtyInput = document.getElementById('dsc-qty-'+id);
  const unitInput = document.getElementById('dsc-unit-'+id);
  const qty = parseFloat(qtyInput?.value);
  if(!qty || qty <= 0){
    if(qtyInput) { qtyInput.style.borderBottom='2px solid #ef4444'; setTimeout(()=>qtyInput.style.borderBottom='2px solid #1e3a5f',1000); }
    return;
  }
  const unit = unitInput?.value||tasks[id]?.unit||'';
  const prevSummary = tlogs.slice(-3).map(l=>{
    const q = parseFloat(l.qty);
    return `${l.user_name}: ${Number.isInteger(q)?q:parseFloat(q.toFixed(1))} ${l.unit||''}`;
  }).join(' · ');
  const popup = document.createElement('div');
  popup.className = 'fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-4';
  popup.innerHTML = `<div style="background:#fff;border-radius:20px;padding:22px 20px;max-width:320px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.3);animation:slideUp .2s ease">
    <div style="font-size:28px;text-align:center;margin-bottom:8px;">⚠️</div>
    <div style="font-size:16px;font-weight:700;color:#1e3a5f;text-align:center;margin-bottom:8px;">${tasks[id]?.name||''}</div>
    <div style="font-size:12px;color:#6b7280;text-align:center;margin-bottom:14px;">${prevSummary}</div>
    <div style="font-size:14px;color:#374151;text-align:center;margin-bottom:18px;">Add <b style="color:#059669">${qty} ${unit}</b> more?</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <button onclick="this.closest('.fixed').remove()" style="height:46px;border-radius:14px;background:#f1f5f9;color:#64748b;font-size:14px;font-weight:600;border:none;">Cancel</button>
      <button onclick="this.closest('.fixed').remove();detailSave('${id}',null,false)" style="height:46px;border-radius:14px;background:#059669;color:white;font-size:14px;font-weight:600;border:none;">Yes, add it</button>
    </div>
  </div>`;
  document.body.appendChild(popup);
};

function openDoneSheet(id){
  const it=tasks[id];
  // Build today log banner if needed
  const tlogs = getTodayLogsFor(it.name);
  const todayBanner = tlogs.length > 0 ? buildTodayLogBanner(tlogs) : '';

  if(it.suggested_qty && parseFloat(it.suggested_qty)>0){
    const sqRaw = parseFloat(it.suggested_qty);
    const sqUnit = it.unit||tr('prep_portions');
    const sqLabel = sqRaw+' '+sqUnit;
    const modal=document.createElement('div');
    modal.className='fixed inset-0 z-50 flex items-end';
    modal.style.background='rgba(0,0,0,0.35)';
    modal.innerHTML=`<div style="background:rgba(255,255,255,0.96);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-radius:24px 24px 0 0;border-top:0.5px solid rgba(5,150,105,0.3);padding:20px 16px 28px;width:100%;max-width:480px;margin:0 auto;animation:slideUp .25s ease">
      <div style="width:36px;height:4px;background:rgba(5,150,105,0.2);border-radius:2px;margin:0 auto 16px;"></div>
      <div style="font-size:16px;font-weight:700;color:#1e3a5f;margin-bottom:4px;">${it.name}</div>
      ${todayBanner}
      <div style="font-size:13px;color:#6b7280;margin-bottom:18px;">${tlogs.length>0?tr('prep_already_today'):tr('prep_how_much')}</div>
      <button onclick="suggestedSave('${it.id}',this.closest('.fixed'))" style="width:100%;height:52px;border-radius:16px;background:#059669;color:white;font-size:15px;font-weight:600;border:none;margin-bottom:10px;">
        ✅ ${sqLabel} — ${tr('prep_suggested_label')}
      </button>
      <button onclick="this.closest('.fixed').remove();openDoneSheetCustom('${it.id}')" style="width:100%;height:44px;border-radius:14px;background:rgba(59,130,246,0.08);color:#1d4ed8;font-size:14px;border:0.5px solid rgba(59,130,246,0.2);">
        ${tr('prep_custom_qty')}
      </button>
    </div>`;
    modal.onclick=e=>{if(e.target===modal)modal.remove();};
    document.body.appendChild(modal);
  } else {
    openDoneSheetCustom(id);
  }
}

function openDoneSheetCustom(id){
  const it=tasks[id];
  const taskUnit=(it.unit||'').toLowerCase();
  const PIECE_UNITS = ['pezzi','pz','each','pieces','pcs'];
  const WEIGHT_UNITS = ['g','kg','oz','lb'];
  const NATIVE_UNITS = ['nests','buste','cup','filetto','mazzi']; // unità fisiche native non-g non-pz
  const defaultPezzi = PIECE_UNITS.includes(taskUnit);
  const defaultNative = NATIVE_UNITS.includes(taskUnit); // nests, buste, cup, ecc.
  const defQty = it.suggested_qty!=null ? parseFloat(it.suggested_qty) : (it.average_qty!=null ? parseFloat(it.average_qty) : 0);
  // defUnit: usa sempre l'unità del prep_task se riconosciuta, fallback g
  const defUnit = defaultNative ? taskUnit : (defaultPezzi ? 'pz' : 'g');
  // Etichetta leggibile per unità native
  const nativeLabel = taskUnit === 'nests' ? 'Nests' : taskUnit === 'buste' ? 'Buste' : taskUnit === 'cup' ? 'Cup' : taskUnit === 'filetto' ? 'Filetto' : taskUnit;
  // Today log banner
  const tlogs = getTodayLogsFor(it.name);
  const todayBanner = tlogs.length > 0 ? buildTodayLogBanner(tlogs) : '';
  // Layout bottoni: se unità nativa → 3 colonne (g, nativa, pz); altrimenti 2 colonne (g, pz)
  const btnGrid = defaultNative
    ? `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px;">
        <button id="dsc-btn-g-${it.id}" onclick="dscSelect('${it.id}','g')"
          style="height:52px;border-radius:14px;font-size:14px;font-weight:600;border:2px solid #e2e8f0;background:#f8fafc;color:#94a3b8;">
          ${tr('prep_grams')}
        </button>
        <button id="dsc-btn-native-${it.id}" onclick="dscSelect('${it.id}','${taskUnit}')"
          style="height:52px;border-radius:14px;font-size:14px;font-weight:600;border:2px solid #059669;background:#059669;color:#fff;">
          ${nativeLabel}
        </button>
        <button id="dsc-btn-pz-${it.id}" onclick="dscSelect('${it.id}','pz')"
          style="height:52px;border-radius:14px;font-size:14px;font-weight:600;border:2px solid #e2e8f0;background:#f8fafc;color:#94a3b8;">
          ${tr('prep_pieces')}
        </button>
      </div>`
    : `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
        <button id="dsc-btn-g-${it.id}" onclick="dscSelect('${it.id}','g')"
          style="height:52px;border-radius:14px;font-size:15px;font-weight:600;border:2px solid ${defaultPezzi?'#e2e8f0':'#059669'};background:${defaultPezzi?'#f8fafc':'#059669'};color:${defaultPezzi?'#94a3b8':'#fff'};">
          ${tr('prep_grams')}
        </button>
        <button id="dsc-btn-pz-${it.id}" onclick="dscSelect('${it.id}','pz')"
          style="height:52px;border-radius:14px;font-size:15px;font-weight:600;border:2px solid ${defaultPezzi?'#059669':'#e2e8f0'};background:${defaultPezzi?'#059669':'#f8fafc'};color:${defaultPezzi?'#fff':'#94a3b8'};">
          ${tr('prep_pieces')}
        </button>
      </div>`;
  const sheet=document.createElement('div');
  sheet.className='fixed inset-0 z-50 flex items-end';
  sheet.style.background='rgba(0,0,0,0.5)';
  sheet.innerHTML=`<div style="background:#fff;border-radius:24px 24px 0 0;padding:24px 20px 36px;width:100%;max-width:480px;margin:0 auto;animation:slideUp .25s ease">
    <div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 20px;"></div>
    <div style="font-size:16px;font-weight:700;color:#1e3a5f;margin-bottom:6px;">${it.name}</div>
    ${todayBanner}
    <div style="font-size:13px;color:#6b7280;margin-bottom:${tlogs.length>0?'12':'20'}px;">${tlogs.length>0?tr('prep_already_today'):tr('prep_how_much')}</div>
    <input id="dsc-qty-${it.id}" type="number" inputmode="decimal" value="${isNaN(defQty)?0:defQty}" placeholder="0"
      style="width:100%;font-size:32px;font-weight:700;color:#1e3a5f;text-align:center;border:none;border-bottom:2px solid #1e3a5f;outline:none;padding:8px 0;margin-bottom:24px;background:transparent;">
    <input type="hidden" id="dsc-unit-${it.id}" value="${defUnit}">
    ${btnGrid}
    <div style="display:grid;grid-template-columns:1fr 2fr;gap:10px;">
      <button onclick="this.closest('.fixed').remove()" style="height:46px;border-radius:14px;background:#f1f5f9;color:#64748b;font-size:14px;border:none;">${tr('prep_cancel')}</button>
      <button onclick="doneSheetConfirm('${it.id}',this)" style="height:46px;border-radius:14px;background:#1e3a5f;color:white;font-size:14px;font-weight:600;border:none;">${tr('prep_done')}</button>
    </div>
  </div>`;
  sheet.onclick=e=>{if(e.target===sheet)sheet.remove();};
  document.body.appendChild(sheet);
  setTimeout(()=>{const inp=document.getElementById('dsc-qty-'+it.id); if(inp){inp.focus();inp.select();}},150);
}

window.dscSelect = function(id, unit){
  const unitInput = document.getElementById('dsc-unit-'+id);
  if(unitInput) unitInput.value = unit;
  const btnG      = document.getElementById('dsc-btn-g-'+id);
  const btnPz     = document.getElementById('dsc-btn-pz-'+id);
  const btnNative = document.getElementById('dsc-btn-native-'+id);
  const ON  = {background:'#059669', color:'#fff',   borderColor:'#059669'};
  const OFF = {background:'#f8fafc', color:'#94a3b8', borderColor:'#e2e8f0'};
  const applyStyle = (btn, active) => { if(!btn) return; Object.assign(btn.style, active ? ON : OFF); };
  // Tre bottoni possibili — solo uno attivo alla volta
  applyStyle(btnG,      unit==='g');
  applyStyle(btnPz,     unit==='pz');
  applyStyle(btnNative, btnNative && unit !== 'g' && unit !== 'pz');
};

// ── Banner errore salvataggio — visibile a chiunque, non solo in console ──
function _prepSaveError(itemName, detail){
  console.error('[PREP SAVE ERROR]', itemName, detail);
  var old = document.getElementById('prepSaveErrBanner');
  if(old) old.remove();
  var b = document.createElement('div');
  b.id = 'prepSaveErrBanner';
  b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#dc2626;color:#fff;padding:14px 16px;font-size:14px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;justify-content:space-between;align-items:center;gap:10px;';
  b.innerHTML = '<span>⚠️ '+(tr('prepSaveErrorMsg')||'Salvataggio non riuscito')+' — '+itemName+'. '+(tr('prepSaveErrorRetry')||'Riprova, non è stato registrato.')+'</span><button style="background:#fff;color:#dc2626;border:none;border-radius:8px;padding:6px 12px;font-weight:700;" onclick="this.closest(\'div\').remove()">OK</button>';
  document.body.appendChild(b);
  setTimeout(()=>{ if(b && b.parentNode) b.remove(); }, 9000);
}

async function suggestedSave(id, modal){
  const it=tasks[id];
  const qty=parseFloat(it.suggested_qty)||1;
  const unit=it.unit||tr('prep_portions');
  modal.remove();
  var _sNow = new Date();
  var _sSt = _startTimes[id] || _sNow;
  var _sDur = Math.round((_sNow - _sSt) / 60000);
  delete _startTimes[id];
  const [logRes, updRes] = await Promise.all([
    supa.from('prep_log').insert({item:it.name,station:it.category||tr('generale'),qty,unit,container:'',user_name:user.name,is_suggested_qty:true,started_at:_sSt.toISOString(),duration_minutes:_sDur}),
    supa.from('prep_tasks').update({need_tomorrow:false,in_progress:false,current_stock:(parseFloat(it.current_stock)||0)+qty,suggested_note:null,suggested_qty:null}).eq('id',id)
  ]);
  if(logRes.error || updRes.error){
    _prepSaveError(it.name, (updRes.error||logRes.error).message);
    return;
  }
  _finishTask(id, qty);
  loadItemAlerts();loadStepsMap();loadTodayLogs();loadRecentCounts();
}

async function detailSave(id, btn, isSuggested){
  const sheet=btn.closest('.fixed');
  const qtyInput=document.getElementById('dsc-qty-'+id)||sheet.querySelector('.ds-qty');
  const unitInput=document.getElementById('dsc-unit-'+id);
  const qty=parseFloat(qtyInput?qtyInput.value:NaN);
  if(isNaN(qty)){qtyInput&&qtyInput.focus();return;}
  const unit=unitInput?unitInput.value:(sheet.querySelector('.ds-unit')?sheet.querySelector('.ds-unit').value:'g');
  const cont='';
  btn.textContent='...'; btn.disabled=true;
  const it=tasks[id];
  var _dNow = new Date();
  var _dSt = _startTimes[id] || _dNow;
  var _dDur = Math.round((_dNow - _dSt) / 60000);
  delete _startTimes[id];
  const logRes = await supa.from('prep_log').insert({item:it.name,station:it.category||tr('generale'),qty,unit,container:cont,user_name:user.name,is_suggested_qty:!!isSuggested,started_at:_dSt.toISOString(),duration_minutes:_dDur});
  if(logRes.error){
    btn.textContent=tr('prep_done'); btn.disabled=false;
    _prepSaveError(it.name, logRes.error.message);
    return;
  }
  const stockUpdate = qty > 0
    ? {need_tomorrow:false,in_progress:false,current_stock:(parseFloat(it.current_stock)||0)+qty,suggested_note:null,suggested_qty:null}
    : {need_tomorrow:false,in_progress:false,suggested_note:null,suggested_qty:null};
  const updRes = await supa.from('prep_tasks').update(stockUpdate).eq('id',id);
  if(updRes.error){
    btn.textContent=tr('prep_done'); btn.disabled=false;
    _prepSaveError(it.name, updRes.error.message);
    return;
  }
  sheet.remove();
  _finishTask(id, qty);
  await loadItemAlerts();
  await loadStepsMap();
loadRecentCounts();
  setTimeout(()=>{renderM();renderS();renderHomeStations();if(!document.getElementById('vr').classList.contains('hidden'))loadReport('today');},300);
}

// Shared cleanup dopo DONE
function _finishTask(id, qty){
  tasks[id].need_tomorrow=false;
  tasks[id].in_progress=false;
  if(qty > 0) tasks[id].current_stock=(parseFloat(tasks[id].current_stock)||0)+qty;
  tasks[id].suggested_note=null;
  tasks[id].suggested_qty=null;
  delete _taskStep[id];
  delete _taskStepTotal[id];
  releaseWakeLock();
  showConfetti();
  renderM();renderS();renderHomeStations();
}

// ── NO NEED ──
window.noNeed = async function(id) {
  const it = tasks[id];
  if (!it) return;
  const msg = it.name + ' — No Need: '+tr('noNeedConfirm');
  if (!confirm(msg)) return;
  var _nNow = new Date();
  var _nSt = _startTimes[id] || _nNow;
  var _nDur = Math.round((_nNow - _nSt) / 60000);
  delete _startTimes[id];
  await supa.from('prep_log').insert({
    item: it.name,
    station: it.category || tr('generale'),
    qty: 0, unit: 'no_need', container: '',
    user_name: user.name,
    started_at: _nSt.toISOString(),
    duration_minutes: _nDur
  });
  await supa.from('prep_tasks').update({need_tomorrow: false, in_progress: false}).eq('id', id);
  tasks[id].need_tomorrow = false;
  tasks[id].in_progress = false;
  delete _taskStep[id];
  delete _taskStepTotal[id];
  renderM(); renderS(); renderHomeStations();
  if (typeof buildFocusList === 'function') buildFocusList();
  if (typeof window.renderFocusFeed === 'function') window.renderFocusFeed();
};

async function quickSave(id){
  const it=tasks[id];
  const qty=it.average_qty||1;
  const addQty = it.suggested_qty ? parseFloat(it.suggested_qty) : qty;
  const [logRes, updRes] = await Promise.all([
    supa.from('prep_log').insert({item:it.name,station:it.category||tr('generale'),qty,unit:'kg',container:'1/4 pan',user_name:user.name,is_suggested_qty:false}),
    supa.from('prep_tasks').update({need_tomorrow:false,in_progress:false,current_stock:(parseFloat(it.current_stock)||0)+addQty,suggested_note:null,suggested_qty:null}).eq('id',id)
  ]);
  if(logRes.error || updRes.error){
    _prepSaveError(it.name, (updRes.error||logRes.error).message);
    return;
  }
  _finishTask(id, addQty);
  loadItemAlerts();loadStepsMap();loadTodayLogs();loadRecentCounts();
}

async function saveWip(id, note){
  tasks[id].in_progress=true;
  await supa.from('prep_tasks').update({in_progress:true}).eq('id',id);
  if(note) await supa.from('prep_tasks').update({note}).eq('id',id);
  renderM();
}

async function loadStationNotes(){
  try{
    const{data}=await supa.from('station_notes').select('*');
    stationNotes={};
    (data||[]).forEach(r=>stationNotes[r.station]=r.note);
  }catch(e){}
}

// legacy
window.save=async(id,btn)=>{ quickSave(id); };

// ── FEED ──
function renderFeed(){
  const base=items.filter(i=>station==='All'||i.category===station);
  const list=base.sort((a,b)=>(b.need_tomorrow?1:0)-(a.need_tomorrow?1:0));
  const feed=document.getElementById('feed');
  feed.innerHTML=list.map((i,idx)=>`
    <div class="snap-start h-[calc(100vh-170px)] flex flex-col justify-center px-6">
      <div class="text-center mb-4">
        <div class="text-[11px] font-bold ${i.need_tomorrow?'text-red-600':'text-slate-400'}">${i.need_tomorrow?'🔴 '+tr('urgent'):''}</div>
        <div class="text-[12px] text-slate-500 mt-1">${idx+1} / ${list.length}</div>
      </div>
      <div class="bg-white rounded-[28px] shadow-xl border border-slate-100 p-6">
        <h2 class="text-[32px] font-bold text-center leading-tight mb-1">${i.name}</h2>
        <p class="text-center text-sm text-slate-500 mb-5">${i.category||tr('generale')}</p>
        <div class="grid grid-cols-3 gap-2 mb-4">
          ${['1','2','2.5'].map(q=>`<button onclick="feedSave('${i.id}','${q}',this)" class="h-[70px] rounded-2xl border-2 border-slate-200 bg-slate-50 font-semibold text-lg active:scale-95 transition">${q}</button>`).join('')}
        </div>
        <div class="flex items-center justify-between mt-4 pt-4 border-t">
          <button onclick="openRecipeForItem('${i.id}')" class="text-[13px] text-slate-600 flex items-center gap-1.5">📖 ${tr('recipe')}</button>
        </div>
      </div>
    </div>`).join('');
}

async function feedSave(id,qty,btn){
  const it=tasks[id];
  btn.disabled=true; btn.innerHTML=tr('prep_saved');
  btn.classList.add('bg-emerald-600','text-white','border-emerald-600');
  await supa.from('prep_log').insert({item:it.name,station:it.category||tr('generale'),qty:parseFloat(qty),unit:'kg',container:'1/4 pan',user_name:user.name});
  await supa.from('prep_tasks').update({need_tomorrow:false}).eq('id',id);
  tasks[id].need_tomorrow=false;
  setTimeout(()=>{document.getElementById('feed').scrollBy({top:window.innerHeight*0.8,behavior:'smooth'});renderM();renderS();renderHomeStations();},600);
}

// Carica steps map all'avvio
loadStepsMap();

// ── Chef AI — Controlla prep ──────────────────────────────────
window.chefAiAuditPrep = async function(taskId){
  const panel = document.getElementById('chef-ai-panel-'+taskId);
  if(!panel) return;

  // Toggle: se aperto, chiudi
  if(panel.style.display !== 'none'){
    panel.style.display = 'none';
    panel.innerHTML = '';
    return;
  }

  panel.style.display = 'block';
  panel.innerHTML = '<div style="padding:10px 14px;font-size:12px;color:#6b7280;border-top:1px solid #f1f5f9;">🧠 Chef AI sta analizzando...</div>';

  try {
    const it = tasks[taskId];
    if(!it){ panel.innerHTML = '<div style="padding:10px 14px;font-size:12px;color:#dc2626;">Task non trovato.</div>'; return; }

    // Raccoglie dati
    const [recRes, bomRes, stockRes, tellChefRes, posRes] = await Promise.all([
      it.recipe_id ? supa.from('recipes').select('id,title,pos_name,base_servings,base_weight_g,serving_weight_g,serving_qty,serving_unit,shelf_life_days,menu_group').eq('id',it.recipe_id).maybeSingle() : Promise.resolve({data:null}),
      it.recipe_id ? supa.from('recipe_bom').select('bom_id,component_type,quantity,unit,notes,ingredients(name,category),recipes!recipe_bom_sub_recipe_id_fkey(title)').eq('parent_recipe_id',it.recipe_id).order('sort_order',{nullsFirst:false}).limit(50) : Promise.resolve({data:[]}),
      it.ingredient_id ? supa.from('ingredients').select('id,name,category,base_unit,measure_type').eq('id',it.ingredient_id).maybeSingle() : Promise.resolve({data:null}),
      supa.from('chef_reports').select('message,station,created_at').ilike('message','%'+it.name+'%').order('created_at',{ascending:false}).limit(3),
      it.recipe_id ? supa.from('pos_sales_by_item').select('menu_item,quantity,sale_date').ilike('menu_item','%'+(it.name.split(' ')[0])+'%').order('sale_date',{ascending:false}).limit(7) : Promise.resolve({data:[]})
    ]);

    const payload = {
      prep_task: {
        id: it.id,
        name: it.name,
        category: it.category,
        prep_type: it.prep_type,
        unit: it.unit,
        current_stock: it.current_stock,
        suggested_qty: it.suggested_qty,
        suggested_note: it.suggested_note,
        expected_duration_days: it.expected_duration_days,
        min_cover_days: it.min_cover_days,
        ingredient_id: it.ingredient_id,
        recipe_id: it.recipe_id,
        daily_reset: it.daily_reset
      },
      linked_recipe: recRes.data || null,
      bom_rows: (bomRes.data||[]).map(b=>({
        component_type: b.component_type,
        quantity: b.quantity,
        unit: b.unit,
        notes: b.notes,
        ingredient: b.component_type==='ITEM' ? (b.ingredients ? b.ingredients.name : null) : null,
        sub_recipe: b.component_type==='RECIPE' ? (b.recipes ? b.recipes.title : null) : null
      })),
      linked_ingredient: stockRes.data || null,
      recent_tell_chef: (tellChefRes.data||[]).map(t=>t.message),
      recent_pos_sales: posRes.data || []
    };

    const systemPrompt = `Sei Chef AI, il sous-chef digitale operativo di Zenos on the Square (Weatherford TX).
Il tuo compito e' un AUDIT OPERATIVO di un prep task Brigade. Non sei un chatbot — sei un controllore tecnico.

REGOLE:
- Rispondi SOLO in JSON valido, niente altro.
- Usa linguaggio da cucina, non da consulente.
- Non scrivere mai nel DB — solo analisi.

CONTROLLA:
1. Il prep e' collegato a recipe_id o ingredient_id? Se no — il bot non puo' calcolare.
2. recipe_bom presente se e' un prep finale con pos_name?
3. pos_name presente sulla ricetta se prep_type=finale o venduto al POS?
4. Le unita' (unit) sono fisiche e convertibili (g/kg/ml/l/oz/lb/cup/nests/pezzi/buste)?
5. shelf_life_days o expected_duration_days comprensibili e plausibili per questo tipo di prep?
6. suggested_qty e' spiegabile dai dati? Sembra logico per il livello di stock?
7. Ingredienti duplicati o ambigui nel BOM?
8. Sub-recipe mancante di base_weight_g (necessario per il bot)?
9. Tell Chef recenti segnalano problemi su questo prep?
10. Vendite POS recenti coerenti con il livello di stock attuale?

REGOLE ZENOS:
- min_cover_days e' una soglia di alert, NON un orizzonte di pianificazione
- expected_duration_days e' la shelf_life del PREP (priorita' su shelf_life_days della ricetta)
- prep_type=finale -> collegato al POS; prep_type=supporto -> non ha pos_name
- Unita' sopra 100g usano kg, sotto usano g

Rispondi ESATTAMENTE con questo JSON (niente markdown, niente backtick):
{
  "status": "ok|warning|critical",
  "understood": ["lista di cose capite e corrette su questo prep"],
  "issues": [{"severity":"info|warning|critical","field":"campo","message":"descrizione problema in italiano cucina"}],
  "bot_impact": ["impatti sul bot-preplist-builder se ci sono problemi"],
  "suggested_fixes": [{"action":"cosa fare","detail":"dettaglio operativo"}],
  "follow_up_question": "domanda per Max (stringa vuota se non serve)",
  "follow_up_options": ["opzione 1","opzione 2"],
  "write_plan": null,
  "confidence": 0.0
}`;

    const r = await fetch(`${SUPABASE_URL}/functions/v1/souschef-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        message: 'AUDIT PREP TASK:\n' + JSON.stringify(payload, null, 2),
        user_name: window.user?.name || 'Max',
        user_role: 'admin',
        user_station: 'Admin',
        system_override: systemPrompt
      })
    });

    const raw = await r.json();
    const replyText = raw.reply || raw.message || raw.text || (typeof raw === 'string' ? raw : JSON.stringify(raw));

    let audit;
    try {
      const cleaned = replyText.replace(/```json|```/g,'').trim();
      audit = JSON.parse(cleaned);
    } catch(e){
      panel.innerHTML = _chefAiPrepPanelError('Risposta non JSON: '+replyText.slice(0,200));
      return;
    }
    panel.innerHTML = _chefAiPrepPanelHtml(audit, it.name);

  } catch(err){
    panel.innerHTML = _chefAiPrepPanelError(err.message);
  }
};

// ── Chef AI — Spiega suggerimento bot ────────────────────────
window.chefAiExplainBot = async function(taskId){
  const panel = document.getElementById('chef-ai-panel-'+taskId);
  if(!panel) return;

  if(panel.style.display !== 'none' && panel.dataset.mode === 'explain'){
    panel.style.display = 'none';
    panel.innerHTML = '';
    return;
  }
  panel.dataset.mode = 'explain';
  panel.style.display = 'block';
  panel.innerHTML = '<div style="padding:10px 14px;font-size:12px;color:#6b7280;border-top:1px solid #f1f5f9;">📉 Chef AI sta spiegando il suggerimento...</div>';

  try {
    const it = tasks[taskId];
    if(!it){ panel.innerHTML = '<div style="padding:10px 14px;font-size:12px;color:#dc2626;">Task non trovato.</div>'; return; }

    const payload = {
      prep_task_name: it.name,
      category: it.category,
      prep_type: it.prep_type,
      unit: it.unit,
      current_stock: it.current_stock,
      suggested_qty: it.suggested_qty,
      suggested_note: it.suggested_note,
      expected_duration_days: it.expected_duration_days,
      min_cover_days: it.min_cover_days,
      shelf_life_days_recipe: null
    };

    // Try to get shelf_life from linked recipe
    if(it.recipe_id){
      const {data:rr} = await supa.from('recipes').select('shelf_life_days').eq('id',it.recipe_id).maybeSingle();
      if(rr) payload.shelf_life_days_recipe = rr.shelf_life_days;
    }

    const systemPrompt = `Sei Chef AI, il sous-chef digitale operativo di Zenos on the Square.
Spiega in linguaggio cucina (italiano) perche' il bot-preplist-builder ha dato questa raccomandazione.
NON inventare dati. Usa solo i dati forniti.
Sii conciso — massimo 3-4 frasi come un sous chef direbbe a Max.
Rispondi SOLO in JSON valido:
{
  "status": "ok|warning|critical",
  "understood": ["ho visto questi dati chiave"],
  "issues": [],
  "bot_impact": ["spiegazione logica del suggerimento bot in 2-3 frasi"],
  "suggested_fixes": [],
  "follow_up_question": "",
  "follow_up_options": [],
  "write_plan": null,
  "confidence": 0.0
}`;

    const r = await fetch(`${SUPABASE_URL}/functions/v1/souschef-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        message: 'SPIEGA SUGGERIMENTO BOT:\n' + JSON.stringify(payload, null, 2),
        user_name: window.user?.name || 'Max',
        user_role: 'admin',
        user_station: 'Admin',
        system_override: systemPrompt
      })
    });

    const raw = await r.json();
    const replyText = raw.reply || raw.message || raw.text || (typeof raw === 'string' ? raw : JSON.stringify(raw));

    let audit;
    try {
      const cleaned = replyText.replace(/```json|```/g,'').trim();
      audit = JSON.parse(cleaned);
    } catch(e){
      panel.innerHTML = _chefAiPrepPanelError('Risposta non JSON: '+replyText.slice(0,200));
      return;
    }

    // Spiega: mostra solo bot_impact in un panel semplice
    const statusColor = audit.status==='ok'?'#059669':audit.status==='critical'?'#dc2626':'#d97706';
    const statusBg    = audit.status==='ok'?'#f0fdf4':audit.status==='critical'?'#fff5f5':'#fffbeb';
    const statusBorder= audit.status==='ok'?'#bbf7d0':audit.status==='critical'?'#fca5a5':'#fde68a';
    const explains = (audit.bot_impact||[]);
    panel.innerHTML = '<div style="border-top:1px solid #f1f5f9;padding:12px 14px;">'
      +'<div style="background:'+statusBg+';border:1.5px solid '+statusBorder+';border-radius:10px;padding:10px 12px;">'
        +'<div style="font-size:10px;font-weight:700;color:'+statusColor+';letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">📉 PERCHE IL BOT DICE COSI</div>'
        + explains.map(e=>'<div style="font-size:13px;color:#1e293b;line-height:1.5;margin-bottom:4px;">'+e+'</div>').join('')
        + (audit.understood&&audit.understood.length ? '<div style="margin-top:8px;font-size:11px;color:#6b7280;">'+(audit.understood.join(' · '))+'</div>' : '')
        +'<div style="margin-top:8px;font-size:10px;color:#9ca3af;">Chef AI · '+Math.round((audit.confidence||0)*100)+'% confidenza</div>'
      +'</div>'
    +'</div>';

  } catch(err){
    panel.innerHTML = _chefAiPrepPanelError(err.message);
  }
};

// ── Chef AI Prep Panel Render Helpers ────────────────────────
function _chefAiPrepPanelError(msg){
  return '<div style="border-top:1px solid #f1f5f9;padding:10px 14px;"><div style="background:#fff5f5;border:1.5px solid #fca5a5;border-radius:8px;padding:10px;font-size:12px;color:#991b1b;">Errore Chef AI: '+msg+'</div></div>';
}

function _chefAiPrepPanelHtml(a, prepName){
  const statusColor = a.status==='ok'?'#059669':a.status==='critical'?'#dc2626':'#d97706';
  const statusBg    = a.status==='ok'?'#f0fdf4':a.status==='critical'?'#fff5f5':'#fffbeb';
  const statusBorder= a.status==='ok'?'#bbf7d0':a.status==='critical'?'#fca5a5':'#fde68a';
  const statusLabel = a.status==='ok'?'OK':a.status==='critical'?'CRITICO':'ATTENZIONE';
  const s = 'font-size:11px;color:#1e293b;padding:3px 0;border-bottom:0.5px solid #f1f5f9;';
  const lbl = 'font-size:9px;font-weight:700;color:#6b7280;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:3px;';

  let issuesHtml = '';
  if(a.issues && a.issues.length){
    issuesHtml = '<div style="margin-top:8px;"><div style="'+lbl+'">PROBLEMI TROVATI</div>'
      +a.issues.map(iss=>{
        const ic=iss.severity==='critical'?'#dc2626':iss.severity==='warning'?'#d97706':'#6b7280';
        const ib=iss.severity==='critical'?'#fff5f5':iss.severity==='warning'?'#fffbeb':'#f8fafc';
        return '<div style="'+s+';background:'+ib+';border-left:3px solid '+ic+';border-radius:3px;padding:3px 7px;margin-bottom:2px;">'
          +'<b style="color:'+ic+';">'+(iss.severity==='critical'?'Critico':iss.severity==='warning'?'Attenzione':'Info')+'</b>'
          +(iss.field?' · <span style="color:#94a3b8;">'+iss.field+'</span>':'')
          +' — '+iss.message+'</div>';
      }).join('')+'</div>';
  }
  let botHtml = '';
  if(a.bot_impact && a.bot_impact.length){
    botHtml='<div style="margin-top:8px;"><div style="'+lbl+'">IMPATTO SUL BOT</div>'
      +a.bot_impact.map(b=>'<div style="'+s+';color:#7c3aed;">'+b+'</div>').join('')+'</div>';
  }
  let fixesHtml = '';
  if(a.suggested_fixes && a.suggested_fixes.length){
    fixesHtml='<div style="margin-top:8px;"><div style="'+lbl+'">PROPOSTA CHEF AI</div>'
      +a.suggested_fixes.map(f=>'<div style="'+s+'"><b>'+f.action+'</b>'+(f.detail?' — <span style="color:#64748b;">'+f.detail+'</span>':'')+'</div>').join('')+'</div>';
  }
  let fqHtml = '';
  if(a.follow_up_question){
    fqHtml='<div style="margin-top:8px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:7px;padding:8px 10px;">'
      +'<div style="'+lbl+'">DOMANDA PER MAX</div>'
      +'<div style="font-size:12px;font-weight:600;color:#0c4a6e;">'+a.follow_up_question+'</div>'
      +((a.follow_up_options||[]).length?'<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px;">'+(a.follow_up_options.map(o=>'<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:5px;border:1px solid #93c5fd;color:#1e40af;background:#eff6ff;">'+o+'</span>').join(''))+'</div>':'')
    +'</div>';
  }

  return '<div style="border-top:1px solid #f1f5f9;padding:10px 14px;">'
    +'<div style="background:'+statusBg+';border:1.5px solid '+statusBorder+';border-radius:10px;padding:10px 12px;">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">'
        +'<span style="font-size:11px;font-weight:700;color:'+statusColor+';">🧠 CHEF AI · '+statusLabel+'</span>'
        +'<span style="font-size:10px;color:#9ca3af;">'+Math.round((a.confidence||0)*100)+'%</span>'
      +'</div>'
      + issuesHtml
      + botHtml
      + fixesHtml
      + fqHtml
    +'</div>'
  +'</div>';
}













