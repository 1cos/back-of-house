const SUPABASE_URL = 'https://ydqmumpytgrlceuinoqt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlkcW11bXB5dGdybGNldWlub3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MzcyOTUsImV4cCI6MjA5NDUxMzI5NX0.MSIKL4nCOxK8YFFTkt9AbFGViiwl-KEhHy6cL25gnKc';
const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.supa = supa;
window.supabaseClient = supa;

const DEFAULT_LANG = 'en';
function normalizeLang(lang){
  return String(lang || DEFAULT_LANG).trim().toLowerCase().slice(0,2) || DEFAULT_LANG;
}

let currentNews=[], user=null, items=[], tasks={}, station='All', station2='All', loginLang='en', lastReport=[], recipeCat='All';
let closingAnswers={};
let itemAlerts={}; // cache avvisi intelligenti

const CONTAINERS=['1/9 pan','1/6 pan','1/4 pan','1/3 pan','1/2 pan','2/3 pan','Full pan','Bowl','Bac','Sacchetto'];
const UNITS=['pz','g','kg','ml','lt','porz'];
const QTYS=['0.25','0.5','0.75','1','1.5','2','3','4','5','6','8','10'];

const T={
  it:{home:'Home',prep:'Prep',evening:'Chiusura',recipes:'Ricette',logout:'Esci',login:'Entra',name:'Nome',pass:'Password',write:'Scrivi...',send:'Invia',save:'Salva',ok:'OK',report:'Report',today:'Oggi',week:'Settimana',pdf:'PDF',noData:'Nessun dato oggi',item:'Item',unit:'Unità',prepBy:'Preparazioni per persona',toDo:'DA PREPARARE — segnati in chiusura',closeCount:'da fare',selectReport:'Seleziona Oggi o Settimana',closeTurn:'Chiudi Turno',thereIs:"C'è ✓",missing:'Manca ✗',forgottenAlert:'Hai dimenticato questi item:',closeTurnDone:'Turno chiuso.',alreadyClosed:'Hai già chiuso stasera 👌',goCheck:'Go Check →',briefingLoading:'Caricamento briefing...',briefingEmpty:'Nessun dato disponibile.',briefingError:'Errore nel caricamento.',homeChecklist:'Checklist chiusura',homeOpen:'Apri →',homePrepSub:'Preparazioni mattina',homeCloseSub:'Checklist sera',homeRecSub:'Tutte le ricette',homeChatSub:'Brigata',translating:'...',briefingRefresh:'Aggiorna',quickComment:'Commento rapido',skipComment:'Salta',
    daFare:'da fare',inProgress:'in progress',noStation:'Nessuna stazione',
    close:'Chiudi',cancel:'Annulla',send:'Invia al team',writePlaceholder:'Scrivi il messaggio per il team...',
    ingredients:'Ingredienti',loading:'Caricamento...',noData2:'Nessun dato',
    station:'Stazione',role:'Ruolo',lastAccess:'Ultimo accesso',status:'Stato',
    online:'Online',shiftClosed:'Turno chiuso da',missing2:'Manca',allGood:'Tutto ok',
    noActivenews:'Nessuna comunicazione attiva',closeAll:'Chiudi tutte',answerAll:'Rispondi a tutte le voci prima di chiudere',searchRecipe:'Cerca ricetta...',yourStation:'La tua stazione',otherStations:'Altre stazioni',goToPrep:'Vai alla prep →',upcomingDemand:'Prossimi eventi',yesterdayHL:'Highlights di ieri',viewAll:'Vedi tutti',noRecipe:'⚪ nessuna ricetta',stations:'Stazioni',nothingToDo:'Niente da fare ✅',recipe:'Ricetta',note:'Nota',covers:'coperti',kitchen:'Cucina',kitchenModifiers:'Modifier cucina',yesterday:'Ieri',weekShort:'Sett.',avgPerDay:'media',day:'giorno'},
  en:{home:'Home',prep:'Prep',evening:'Closing',recipes:'Recipes',logout:'Logout',login:'Enter',name:'Name',pass:'Password',write:'Write...',send:'Send',save:'Save',ok:'OK',report:'Report',today:'Today',week:'Week',pdf:'PDF',noData:'No data today',item:'Item',unit:'Unit',prepBy:'Preparations by person',toDo:'TO PREPARE — flagged at close',closeCount:'to do',selectReport:'Select Today or Week',closeTurn:'Close Shift',thereIs:'In stock ✓',missing:'Missing ✗',forgottenAlert:'You forgot these items:',closeTurnDone:'Shift closed.',alreadyClosed:'You already closed tonight 👌',goCheck:'Go Check →',briefingLoading:'Loading briefing...',briefingEmpty:'No data available.',briefingError:'Error loading briefing.',homeChecklist:'Closing checklist',homeOpen:'Open →',homePrepSub:'Morning prep',homeCloseSub:'Evening checklist',homeRecSub:'All recipes',homeChatSub:'Crew',translating:'...',briefingRefresh:'Refresh',quickComment:'Quick note',skipComment:'Skip',
    daFare:'to do',inProgress:'in progress',noStation:'No stations',
    close:'Close',cancel:'Cancel',send:'Send to team',writePlaceholder:'Write a message for the team...',
    ingredients:'Ingredients',loading:'Loading...',noData2:'No data',
    station:'Station',role:'Role',lastAccess:'Last seen',status:'Status',
    online:'Online',shiftClosed:'Shift closed by',missing2:'Missing',allGood:'All good',
    noActivenews:'No active announcements',closeAll:'Close all',answerAll:'Answer all items before closing',searchRecipe:'Search recipe...',yourStation:'Your Station',otherStations:'Other Stations',goToPrep:'Go to prep →',upcomingDemand:'Upcoming Demand',yesterdayHL:"Yesterday's Highlights",viewAll:'View all',noRecipe:'⚪ no recipe',stations:'Stations',nothingToDo:'Nothing to do ✅',recipe:'Recipe',note:'Note',covers:'covers',kitchen:'Kitchen',kitchenModifiers:'Kitchen modifiers',yesterday:'Yesterday',weekShort:'Week',avgPerDay:'avg',day:'day'},
  es:{home:'Home',prep:'Prep',evening:'Cierre',recipes:'Recetas',logout:'Salir',login:'Entrar',name:'Nombre',pass:'Contraseña',write:'Escribe...',send:'Enviar',save:'Guardar',ok:'OK',report:'Informe',today:'Hoy',week:'Semana',pdf:'PDF',noData:'Sin datos hoy',item:'Artículo',unit:'Unidad',prepBy:'Preparaciones por persona',toDo:'POR PREPARAR — marcado al cierre',closeCount:'por hacer',selectReport:'Selecciona Hoy o Semana',closeTurn:'Cerrar Turno',thereIs:'Hay ✓',missing:'Falta ✗',forgottenAlert:'Olvidaste estos items:',closeTurnDone:'Turno cerrado.',alreadyClosed:'Ya cerraste esta noche 👌',goCheck:'Go Check →',briefingLoading:'Cargando briefing...',briefingEmpty:'Sin datos disponibles.',briefingError:'Error al cargar.',homeChecklist:'Lista de cierre',homeOpen:'Abrir →',homePrepSub:'Preparaciones mañana',homeCloseSub:'Lista de cierre',homeRecSub:'Todas las recetas',homeChatSub:'Brigada',translating:'...',briefingRefresh:'Actualizar',quickComment:'Nota rápida',skipComment:'Omitir',
    daFare:'por hacer',inProgress:'en progreso',noStation:'Sin estaciones',
    close:'Cerrar',cancel:'Cancelar',send:'Enviar al equipo',writePlaceholder:'Escribe un mensaje para el equipo...',
    ingredients:'Ingredientes',loading:'Cargando...',noData2:'Sin datos',
    station:'Estación',role:'Rol',lastAccess:'Último acceso',status:'Estado',
    online:'En línea',shiftClosed:'Turno cerrado por',missing2:'Falta',allGood:'Todo bien',
    noActivenews:'Sin anuncios activos',closeAll:'Cerrar todo',answerAll:'Responde todos los items antes de cerrar',searchRecipe:'Buscar receta...',yourStation:'Tu estación',otherStations:'Otras estaciones',goToPrep:'Ir a prep →',upcomingDemand:'Próximos eventos',yesterdayHL:'Resumen de ayer',viewAll:'Ver todo',noRecipe:'⚪ sin receta',stations:'Estaciones',nothingToDo:'Nada por hacer ✅',recipe:'Receta',note:'Nota'}
};
function tr(k){
  const lang=normalizeLang(user?.lang||loginLang||DEFAULT_LANG);
  return (T[lang]||T[DEFAULT_LANG]||{})[k]||k;
}

function applyLang(){
  document.querySelectorAll('.tab[data-t]').forEach(btn=>{
    const t=btn.dataset.t;
    const span=btn.querySelector('.tab-label');
    if(!span) return;
    if(t==='h') span.textContent=tr('home');
    else if(t==='m') span.textContent=tr('prep');
    else if(t==='s') span.textContent=tr('evening');
    else if(t==='c') span.textContent=tr('recipes');
    else if(t==='r') span.textContent=tr('report');
  });
  const _out=document.getElementById('out'); if(_out)_out.textContent=tr('logout');
  const _txt=document.getElementById('txt'); if(_txt)_txt.placeholder=tr('write');
  const _fBtn=document.querySelector('#f button'); if(_fBtn)_fBtn.textContent=tr('send');
  const _btnToday=document.getElementById('btnToday'); if(_btnToday)_btnToday.textContent=tr('today');
  const _btnWeek=document.getElementById('btnWeek'); if(_btnWeek)_btnWeek.textContent=tr('week');
  const _btnPDF=document.getElementById('btnPDF'); if(_btnPDF)_btnPDF.textContent=tr('pdf');
  const _repTitle=document.getElementById('reportTitle'); if(_repTitle)_repTitle.textContent=tr('report');
  const _repOut=document.getElementById('reportOut'); if(_repOut)_repOut.textContent=tr('selectReport');
  const ctb=document.getElementById('closeTurnBtn');
  if(ctb) ctb.textContent=tr('closeTurn');
  // Labels — con null check per elementi rimossi
  ['homePrep','homePrepSub','homeClose','homeCloseSub','homeRec','homeRecSub','homeChat','homeChatSub'].forEach(id=>{
    const el=document.getElementById(id); // elementi rimossi dalla nuova home
    // non fa nulla se non esiste
  });
  const hChkL=document.getElementById('homeChecklistLabel'); if(hChkL) hChkL.textContent=tr('homeChecklist');
  const hOpenB=document.getElementById('homeOpenBtn'); if(hOpenB) hOpenB.textContent=tr('homeOpen');
  const brBtn=document.getElementById('briefingRefreshBtn'); if(brBtn) brBtn.textContent=tr('briefingRefresh');
  const recH=document.getElementById('recipesHeading'); if(recH) recH.textContent=tr('recipes');
  const apBtn=document.getElementById('addPrepBtn'); if(apBtn){ apBtn.classList.toggle('hidden',!isAdmin()); }
  const recSearch=document.getElementById('recipeSearch'); if(recSearch) recSearch.placeholder=tr('searchRecipe');
  const goPrep=document.getElementById('homeStationsGoBtn'); if(goPrep) goPrep.textContent=tr('goToPrep');
  const otherStLbl=document.getElementById('homeOtherStationsLabel'); if(otherStLbl){ const sp=otherStLbl.querySelector('span'); if(sp) sp.textContent=tr('otherStations'); }
  const yourStTitle=document.getElementById('homeYourStationTitle'); if(yourStTitle) yourStTitle.textContent=tr('yourStation');
  const yourStGoBtn=document.getElementById('homeYourStationGoBtn'); if(yourStGoBtn) yourStGoBtn.textContent=tr('goToPrep');
  const otherStTab=document.getElementById('otherStationsLabel'); if(otherStTab) otherStTab.textContent=tr('stations');
}

const isAdmin=()=>user&&(user.is_admin===true||user.role==='admin');

// ── TIMEZONE DALLAS (America/Chicago) ──
// Weatherford TX usa CDT (UTC-5) estate, CST (UTC-6) inverno
const DALLAS_TZ = 'America/Chicago';

function getNowDallas(){
  return new Date(new Date().toLocaleString('en-US', {timeZone: DALLAS_TZ}));
}

function getTodayDallas(){
  // ritorna mezzanotte di oggi in Dallas come ISO string UTC
  const now = new Date();
  const dallasMidnight = new Date(now.toLocaleDateString('en-US', {timeZone: DALLAS_TZ}));
  // calcola offset
  const dallasMidnightStr = dallasMidnight.toLocaleString('en-US', {timeZone: DALLAS_TZ});
  const utcMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // usa Intl per trovare mezzanotte Dallas in UTC
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: DALLAS_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const parts = formatter.formatToParts(now);
  const year = parts.find(p=>p.type==='year').value;
  const month = parts.find(p=>p.type==='month').value;
  const day = parts.find(p=>p.type==='day').value;
  // mezzanotte Dallas = `${year}-${month}-${day}T00:00:00` nel timezone Dallas
  const midnightDallas = new Date(`${year}-${month}-${day}T00:00:00`);
  // converti in UTC aggiungendo l'offset Dallas
  const offsetMs = midnightDallas.getTime() - new Date(midnightDallas.toLocaleString('en-US', {timeZone: 'UTC'})).getTime();
  const tzOffset = new Date(midnightDallas.toLocaleString('en-US', {timeZone: DALLAS_TZ})).getTime() - new Date(midnightDallas.toLocaleString('en-US', {timeZone: 'UTC'})).getTime();
  return new Date(midnightDallas.getTime() - tzOffset).toISOString();
}

function getWeekStartDallas(){
  // lunedì di questa settimana in timezone Dallas
  const now = getNowDallas();
  const d = now.getDay();
  const diff = d===0?-6:1-d;
  now.setDate(now.getDate()+diff);
  now.setHours(0,0,0,0);
  return now.toISOString().slice(0,10);
}

function formatTimeDallas(isoString){
  return new Date(isoString).toLocaleTimeString('it-IT', {
    timeZone: DALLAS_TZ,
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDateTimeDallas(isoString){
  return new Date(isoString).toLocaleString('it-IT', {
    timeZone: DALLAS_TZ,
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}


let stationNotes={};
let wipPressTimer=null;
let donePressTimer=null;
let doneTarget=null;


// ── SWIPE TO CLOSE ──────────────────────────────────────────────────────────
// Aggiunge swipe-down-to-close su qualsiasi panel o modal.
// panelEl  = l'elemento che si muove visivamente (il panel bianco)
// closeFn  = funzione da chiamare per chiudere (es. ()=>sheet.remove())
// threshold = pixel di swipe per triggare la chiusura (default 120)
window.addSwipeToClose = function(panelEl, closeFn, threshold=120){
  if(!panelEl) return;
  // Rimuovi listener precedenti se ri-chiamato
  if(panelEl._swipeCleanup) panelEl._swipeCleanup();

  let startY=0, currentY=0, dragging=false;

  function onStart(e){
    if(e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
    currentY = 0;
    dragging = true;
    panelEl.style.transition = 'none';
  }

  function onMove(e){
    if(!dragging) return;
    currentY = e.touches[0].clientY - startY;
    if(currentY < 0){ currentY = 0; return; }
    e.preventDefault(); // blocca scroll background solo quando swipe verso il basso
    panelEl.style.transform = `translateY(${currentY}px)`;
    panelEl.style.opacity = String(Math.max(0, 1 - currentY / (threshold * 2)));
  }

  function onEnd(){
    if(!dragging) return;
    dragging = false;
    if(currentY >= threshold){
      panelEl.style.transition = 'transform .22s ease, opacity .22s ease';
      panelEl.style.transform = `translateY(110%)`;
      panelEl.style.opacity = '0';
      setTimeout(closeFn, 220);
    } else {
      panelEl.style.transition = 'transform .2s ease, opacity .2s ease';
      panelEl.style.transform = 'translateY(0)';
      panelEl.style.opacity = '1';
    }
  }

  panelEl.addEventListener('touchstart', onStart, {passive:true});
  panelEl.addEventListener('touchmove',  onMove,  {passive:false}); // passive:false per preventDefault
  panelEl.addEventListener('touchend',   onEnd,   {passive:true});

  // Cleanup per evitare duplicati
  panelEl._swipeCleanup = ()=>{
    panelEl.removeEventListener('touchstart', onStart);
    panelEl.removeEventListener('touchmove',  onMove);
    panelEl.removeEventListener('touchend',   onEnd);
  };
};
