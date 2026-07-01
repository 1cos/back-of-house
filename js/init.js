// ── INIT ──
let SHOP_RECIPES=[];
let feedMode=false;
let recipeLinks={}; // ora su Supabase in prep_tasks.recipe_id
let closingItems=[]; // closing_checks separati da prep_tasks

async function init(){
  const{data}=await supa.from('prep_tasks').select('*').order('name');
  items=(data||[]).filter(i=>!i.archived); tasks={};
  items.forEach(i=>tasks[i.id]=i);
  window._taskNames={}; items.forEach(i=>window._taskNames[i.id]=i.name);
  // Carica closing_checks separati
  const{data:closingData}=await supa.from('closing_checks').select('*').eq('archived',false).order('name');
  closingItems=closingData||[];
  // carica recipe links da prep_tasks
  recipeLinks={};
  items.forEach(i=>{ if(i.recipe_id) recipeLinks[i.id]=i.recipe_id; });
  closingAnswers={};
  try{
    const{data:recs}=await supa.from('recipes').select('*').order('title');
    if(recs) SHOP_RECIPES=recs.map(r=>({...r,ingredients:typeof r.ingredients==='string'?JSON.parse(r.ingredients):(r.ingredients||[]),yield:r.yield_text,prep_time:r.prep_time_minutes}));
  }catch(e){}
  const KITCHEN_STATIONS = ['Oven Station','Fresh Pasta Station','Pasta Station','Sauté Station','Saucier Station','Plating Station','Salad Station','Pastry Station','Table Side','Freezer'];
  const DISH_STATION = 'Dish Crew';
  const isDishCrew = !isAdmin() && user && user.default_station === DISH_STATION;
  // Admin: tutte (cucina + Dish Crew + Chiusura). Dish Crew: solo Dish Crew. Cucina: solo cucina + Chiusura.
  const stationList = isAdmin()
    ? ['All', ...KITCHEN_STATIONS, DISH_STATION, 'Chiusura']
    : (isDishCrew ? [DISH_STATION] : [...KITCHEN_STATIONS, 'Chiusura']);
  if(!isAdmin()){
    if(isDishCrew){
      if(station!==DISH_STATION) station=DISH_STATION;
      if(station2!==DISH_STATION) station2=DISH_STATION;
    } else {
      if(station==='All' || station===DISH_STATION) station='Oven Station';
      if(station2==='All' || station2===DISH_STATION) station2='Oven Station';
    }
  }
  const stationsEl=document.getElementById('stations');
  const stations2El=document.getElementById('stations2');
  stationsEl.innerHTML=stationList.map(s=>`<button onclick="station='${s}';document.querySelectorAll('#stations button').forEach(b=>{b.classList.remove('bg-slate-900','text-white');b.style.cssText='background:rgba(255,255,255,0.55);backdrop-filter:blur(20px) saturate(160%);-webkit-backdrop-filter:blur(20px) saturate(160%);border:1px solid rgba(255,255,255,0.75);box-shadow:0 2px 12px rgba(30,58,95,0.08),inset 0 1px 0 rgba(255,255,255,0.9);';});this.classList.add('bg-slate-900','text-white');this.style.cssText='border:2px solid #1e293b;';feedMode?renderFeed():renderM()" style="${station===s?'border:2px solid #1e293b;':'background:rgba(255,255,255,0.55);backdrop-filter:blur(20px) saturate(160%);-webkit-backdrop-filter:blur(20px) saturate(160%);border:1px solid rgba(255,255,255,0.75);box-shadow:0 2px 12px rgba(30,58,95,0.08),inset 0 1px 0 rgba(255,255,255,0.9);'}" class="px-3 py-1 rounded-full text-sm ${station===s?'bg-slate-900 text-white':''}">${s.replace(" Station","").replace("Chiusura","EOD")}</button>`).join('');
  stations2El.innerHTML=stationList.map(s=>`<button onclick="station2='${s}';document.querySelectorAll('#stations2 button').forEach(b=>{b.classList.remove('bg-slate-900','text-white');b.style.cssText='background:rgba(255,255,255,0.55);backdrop-filter:blur(20px) saturate(160%);-webkit-backdrop-filter:blur(20px) saturate(160%);border:1px solid rgba(255,255,255,0.75);box-shadow:0 2px 12px rgba(30,58,95,0.08),inset 0 1px 0 rgba(255,255,255,0.9);';});this.classList.add('bg-slate-900','text-white');this.style.cssText='border:2px solid #1e293b;';renderS()" style="${station2===s?'border:2px solid #1e293b;':'background:rgba(255,255,255,0.55);backdrop-filter:blur(20px) saturate(160%);-webkit-backdrop-filter:blur(20px) saturate(160%);border:1px solid rgba(255,255,255,0.75);box-shadow:0 2px 12px rgba(30,58,95,0.08),inset 0 1px 0 rgba(255,255,255,0.9);'}" class="px-3 py-1 rounded-full text-sm ${station2===s?'bg-slate-900 text-white':''}">${s.replace(" Station","").replace("Chiusura","EOD")}</button>`).join('');
  if(isAdmin()) stationsEl.insertAdjacentHTML('beforeend',`<button onclick="adminAdd()" class="ml-2 px-2 py-1 rounded-full bg-green-600 text-white text-sm">+ Nuovo</button><button onclick="showArchivedPreps()" class="ml-1 px-2 py-1 rounded-full bg-slate-200 text-slate-700 text-sm">📦</button>`);
  await loadItemAlerts();
  await ensureChiusuraStation();
  renderM(); renderS(); renderHomeStations();
  renderHomeStationItems();
  loadServiceUpdates();
  loadUpcomingDemand();
  // Load warnings banner
  if (typeof loadWarningsBanner === 'function') loadWarningsBanner();
  // Check se mostrare il prompt note serale (dopo le 22:30)
  // Guard: lo chiama solo una volta per sessione, non ad ogni reload/save
  if (typeof checkOperationNotePrompt === 'function' && !window._opNoteScheduled) {
    window._opNoteScheduled = true;
    checkOperationNotePrompt();
  }
  const rb=document.getElementById('recipeAdminBtns');
  if(rb) rb.style.display=isAdmin()?'flex':'none';
  // Focus Mode — attiva dopo che items è caricato
  if (!isAdmin() && !isSupervisor() && typeof initFocusMode === 'function') initFocusMode();
  // Badge L'Ufficio — mostra items aperti nel menu admin
  if (isAdmin() && typeof officeBadgeUpdate === 'function') officeBadgeUpdate();
}

document.getElementById('toggleView').onclick=()=>{
  feedMode=!feedMode;
  document.getElementById('grid').classList.toggle('hidden',feedMode);
  document.getElementById('feed').classList.toggle('hidden',!feedMode);
  document.getElementById('toggleView').textContent=feedMode?'Griglia':'Feed';
  if(feedMode) renderFeed();
};




