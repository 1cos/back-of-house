// ── INIT ──
let SHOP_RECIPES=[];
let feedMode=false;
let recipeLinks={}; // ora su Supabase in prep_tasks.recipe_id

async function init(){
  const{data}=await supa.from('prep_tasks').select('*').order('name');
  items=(data||[]).filter(i=>!i.archived); tasks={};
  items.forEach(i=>tasks[i.id]=i);
  // carica recipe links da prep_tasks
  recipeLinks={};
  items.forEach(i=>{ if(i.recipe_id) recipeLinks[i.id]=i.recipe_id; });
  closingAnswers={};
  try{
    const{data:recs}=await supa.from('recipes').select('*').order('title');
    if(recs) SHOP_RECIPES=recs.map(r=>({...r,ingredients:typeof r.ingredients==='string'?JSON.parse(r.ingredients):(r.ingredients||[]),yield:r.yield_text,prep_time:r.prep_time_minutes}));
  }catch(e){}
  const stationList=isAdmin()?['All','Oven','Pasta','Plating','Salad','Freezer','Chiusura']:['Oven','Pasta','Plating','Salad','Freezer','Chiusura'];
  if(!isAdmin()){if(station==='All')station='Oven';if(station2==='All')station2='Oven'}
  const stationsEl=document.getElementById('stations');
  const stations2El=document.getElementById('stations2');
  stationsEl.innerHTML=stationList.map(s=>`<button onclick="station='${s}';document.querySelectorAll('#stations button').forEach(b=>b.classList.remove('bg-slate-900','text-white'));this.classList.add('bg-slate-900','text-white');feedMode?renderFeed():renderM()" class="px-3 py-1 rounded-full border text-sm ${station===s?'bg-slate-900 text-white':''}">${s}</button>`).join('');
  stations2El.innerHTML=stationList.map(s=>`<button onclick="station2='${s}';document.querySelectorAll('#stations2 button').forEach(b=>b.classList.remove('bg-slate-900','text-white'));this.classList.add('bg-slate-900','text-white');renderS()" class="px-3 py-1 rounded-full border text-sm ${station2===s?'bg-slate-900 text-white':''}">${s}</button>`).join('');
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
  if (typeof checkOperationNotePrompt === 'function') checkOperationNotePrompt();
  const rb=document.getElementById('recipeAdminBtns');
  if(rb) rb.style.display=isAdmin()?'flex':'none';
}

document.getElementById('toggleView').onclick=()=>{
  feedMode=!feedMode;
  document.getElementById('grid').classList.toggle('hidden',feedMode);
  document.getElementById('feed').classList.toggle('hidden',!feedMode);
  document.getElementById('toggleView').textContent=feedMode?'Griglia':'Feed';
  if(feedMode) renderFeed();
};

