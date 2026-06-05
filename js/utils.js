const SUPABASE_URL = 'https://ydqmumpytgrlceuinoqt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlkcW11bXB5dGdybGNldWlub3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MzcyOTUsImV4cCI6MjA5NDUxMzI5NX0.MSIKL4nCOxK8YFFTkt9AbFGViiwl-KEhHy6cL25gnKc';
const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentNews=[], user=null, items=[], tasks={}, station='All', station2='All', loginLang='it', lastReport=[], recipeCat='All';
let closingAnswers={};
let itemAlerts={}; // cache avvisi intelligenti

const CONTAINERS=['1/9 pan','1/6 pan','1/4 pan','1/3 pan','1/2 pan','2/3 pan','Full pan','Bowl','Bac','Sacchetto'];
const UNITS=['pz','g','kg','ml','lt','porz'];
const QTYS=['0.25','0.5','0.75','1','1.5','2','3','4','5','6','8','10'];

const T={
  it:{home:'Home',prep:'Prep',evening:'Chiusura',recipes:'Ricette',logout:'Esci',login:'Entra',name:'Nome',pass:'Password',write:'Scrivi...',send:'Invia',save:'Salva',ok:'OK',report:'Report',today:'Oggi',week:'Settimana',pdf:'PDF',noData:'Nessun dato oggi',item:'Item',unit:'Unità',prepBy:'Preparazioni per persona',toDo:'DA PREPARARE — segnati in chiusura',closeCount:'da fare',selectReport:'Seleziona Oggi o Settimana',closeTurn:'Chiudi Turno',thereIs:"C'è ✓",missing:'Manca ✗',forgottenAlert:'Hai dimenticato questi item:',closeTurnDone:'Turno chiuso.',goCheck:'Go Check →',briefingLoading:'Caricamento briefing...',briefingEmpty:'Nessun dato disponibile.',briefingError:'Errore nel caricamento.',homeChecklist:'Checklist chiusura',homeOpen:'Apri →',homePrepSub:'Preparazioni mattina',homeCloseSub:'Checklist sera',homeRecSub:'Tutte le ricette',homeChatSub:'Brigata',translating:'...',briefingRefresh:'Aggiorna',quickComment:'Commento rapido',skipComment:'Salta'},
  en:{home:'Home',prep:'Prep',evening:'Closing',recipes:'Recipes',logout:'Logout',login:'Enter',name:'Name',pass:'Password',write:'Write...',send:'Send',save:'Save',ok:'OK',report:'Report',today:'Today',week:'Week',pdf:'PDF',noData:'No data today',item:'Item',unit:'Unit',prepBy:'Preparations by person',toDo:'TO PREPARE — flagged at close',closeCount:'to do',selectReport:'Select Today or Week',closeTurn:'Close Shift',thereIs:'In stock ✓',missing:'Missing ✗',forgottenAlert:'You forgot these items:',closeTurnDone:'Shift closed.',goCheck:'Go Check →',briefingLoading:'Loading briefing...',briefingEmpty:'No data available.',briefingError:'Error loading briefing.',homeChecklist:'Closing checklist',homeOpen:'Open →',homePrepSub:'Morning prep',homeCloseSub:'Evening checklist',homeRecSub:'All recipes',homeChatSub:'Crew',translating:'...',briefingRefresh:'Refresh',quickComment:'Quick note',skipComment:'Skip'},
  es:{home:'Home',prep:'Prep',evening:'Cierre',recipes:'Recetas',logout:'Salir',login:'Entrar',name:'Nombre',pass:'Contraseña',write:'Escribe...',send:'Enviar',save:'Guardar',ok:'OK',report:'Informe',today:'Hoy',week:'Semana',pdf:'PDF',noData:'Sin datos hoy',item:'Artículo',unit:'Unidad',prepBy:'Preparaciones por persona',toDo:'POR PREPARAR — marcado al cierre',closeCount:'por hacer',selectReport:'Selecciona Hoy o Semana',closeTurn:'Cerrar Turno',thereIs:'Hay ✓',missing:'Falta ✗',forgottenAlert:'Olvidaste estos items:',closeTurnDone:'Turno cerrado.',goCheck:'Go Check →',briefingLoading:'Cargando briefing...',briefingEmpty:'Sin datos disponibles.',briefingError:'Error al cargar.',homeChecklist:'Lista de cierre',homeOpen:'Abrir →',homePrepSub:'Preparaciones mañana',homeCloseSub:'Lista de cierre',homeRecSub:'Todas las recetas',homeChatSub:'Brigada',translating:'...',briefingRefresh:'Actualizar',quickComment:'Nota rápida',skipComment:'Omitir'}
};
function tr(k){return (T[user?.lang||loginLang]||T.it)[k]||k}

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
  document.getElementById('out').textContent=tr('logout');
  document.getElementById('loginBtn').textContent=tr('login');
  document.getElementById('name').placeholder=tr('name');
  document.getElementById('pass').placeholder=tr('pass');
  document.getElementById('txt').placeholder=tr('write');
  document.querySelector('#f button').textContent=tr('send');
  document.getElementById('btnToday').textContent=tr('today');
  document.getElementById('btnWeek').textContent=tr('week');
  document.getElementById('btnPDF').textContent=tr('pdf');
  document.getElementById('reportTitle').textContent=tr('report');
  document.getElementById('reportOut').textContent=tr('selectReport');
  const ctb=document.getElementById('closeTurnBtn');
  if(ctb) ctb.textContent=tr('closeTurn');
  // Home card labels
  const hPrep=document.getElementById('homePrep'); if(hPrep) hPrep.textContent=tr('prep');
  const hPrepS=document.getElementById('homePrepSub'); if(hPrepS) hPrepS.textContent=tr('homePrepSub');
  const hClose=document.getElementById('homeClose'); if(hClose) hClose.textContent=tr('evening');
  const hCloseS=document.getElementById('homeCloseSub'); if(hCloseS) hCloseS.textContent=tr('homeCloseSub');
  const hRec=document.getElementById('homeRec'); if(hRec) hRec.textContent=tr('recipes');
  const hRecS=document.getElementById('homeRecSub'); if(hRecS) hRecS.textContent=tr('homeRecSub');
  const hChat=document.getElementById('homeChat'); if(hChat) hChat.textContent='Chat';
  const hChatS=document.getElementById('homeChatSub'); if(hChatS) hChatS.textContent=tr('homeChatSub');
  // Checklist header e open button
  const hChkL=document.getElementById('homeChecklistLabel'); if(hChkL) hChkL.textContent=tr('homeChecklist');
  const hOpenB=document.getElementById('homeOpenBtn'); if(hOpenB) hOpenB.textContent=tr('homeOpen');
  // Briefing refresh button
  const brBtn=document.getElementById('briefingRefreshBtn'); if(brBtn) brBtn.textContent=tr('briefingRefresh');
  // Add prep button
  const apBtn=document.getElementById('addPrepBtn'); if(apBtn){ apBtn.classList.toggle('hidden',!isAdmin()); }
}

const isAdmin=()=>user&&(user.is_admin===true||user.role==='admin');
