// ── LOGIN ──
document.querySelectorAll('.lang-btn').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.lang-btn').forEach(x=>{x.classList.remove('bg-slate-900','text-white');x.classList.add('bg-slate-100')});
  b.classList.add('bg-slate-900','text-white');
  loginLang=b.dataset.lang;
});

// ── PIN LOGIN ──
let pinBuffer = '';

function pinPress(digit){
  if(pinBuffer.length >= 4) return;
  pinBuffer += digit;
  updatePinDots();
  if(pinBuffer.length === 4) setTimeout(()=>attemptPinLogin(), 150);
}

function pinDel(){
  pinBuffer = pinBuffer.slice(0,-1);
  updatePinDots();
}

function updatePinDots(){
  const dots = document.querySelectorAll('.pin-dot');
  dots.forEach((d,i)=>{
    d.style.background = i < pinBuffer.length ? 'white' : 'transparent';
    d.style.borderColor = i < pinBuffer.length ? 'white' : 'rgba(255,255,255,0.4)';
  });
}

async function attemptPinLogin(){
  const err = document.getElementById('err');
  err.classList.add('hidden');
  const{data:profile, error} = await supa.from('users')
    .select('*')
    .eq('pin', pinBuffer)
    .eq('active', true)
    .single();
  if(error || !profile){
    err.textContent = 'PIN non valido';
    err.classList.remove('hidden');
    // shake e reset
    const dots = document.getElementById('pinDots');
    dots.style.animation = 'shake .3s ease';
    setTimeout(()=>{ dots.style.animation=''; pinBuffer=''; updatePinDots(); err.classList.add('hidden'); }, 600);
    return;
  }
  doLogin(profile);
}

// Register pin functions on window for HTML onclick
window._pinPress = pinPress;
window._pinDel = pinDel;

// Shake animation
const shakeStyle = document.createElement('style');
shakeStyle.textContent = '@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}';
document.head.appendChild(shakeStyle);

function doLogin(profile){
  user=profile;
  // lingua: usa sempre user.lang dal DB — non sovrascrivere mai automaticamente
  // loginLang usato solo come display fallback se user.lang è null
  // applica stazione default se presente
  if(user.default_station){
    station=user.default_station;
    station2=user.default_station;
  }
  document.getElementById('login').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('who').textContent=user.name;
  // greeting dinamico basato sull'ora CDT
  const greetEl = document.getElementById('topbarGreeting');
  if(greetEl){
    const h = parseInt(new Date().toLocaleString('en-US',{timeZone:'America/Chicago',hour:'numeric',hour12:false}));
    if(h>=5&&h<12) greetEl.textContent='Good morning,';
    else if(h>=12&&h<17) greetEl.textContent='Good afternoon,';
    else if(h>=17&&h<21) greetEl.textContent='Good evening,';
    else greetEl.textContent='Good night,';
  }
  // Ricarica photo_url dal DB per assicurarsi che sia aggiornata
  supa.from('users').select('photo_url').eq('id', user.id).single().then(({data})=>{
    if(data?.photo_url) user.photo_url = data.photo_url;
    updateTopBarAvatar();
  });
  init(); applyLang(); updateAlertBtn(); setupPush();
  loadNews(); initNews(); // News per tutti — tradotte nella propria lingua
  loadBriefing(); startPresence(); startUrgencyCheck(); if(typeof startUsersRealtime==='function') startUsersRealtime();
  // avvia realtime chat subito al login
  setTimeout(()=>startChatRealtime(), 500);
  // mostra/nascondi sezioni in base al ruolo
  const checklistSection=document.getElementById('homeChecklistSection');
  if(checklistSection) checklistSection.style.display=isAdmin()?'block':'none';
  const invoiceSection=document.getElementById('invoiceSection');
  if(invoiceSection) invoiceSection.style.display=isAdmin()?'block':'none';
  // Load pending vendor documents badge
  if(isAdmin()) vdrLoadBadge();

  // ── RUOLI: admin vs staff ──
  const admin = isAdmin();

  // Tab Ingredients — solo admin
  const tabIngr = document.getElementById('tabIngredients');
  if(tabIngr) tabIngr.style.display = admin ? 'flex' : 'none';

  // Tab Sales — solo admin
  const tabSales = document.getElementById('tabSales');
  if(tabSales) tabSales.style.display = admin ? 'flex' : 'none';

  // Tab Menu ••• — solo admin
  const tabMenu = document.getElementById('tabMenu');
  if(tabMenu) tabMenu.style.display = admin ? 'flex' : 'none';

  // Staff: Prep e Chiusura in bottom bar
  // Admin: Prep e Chiusura nel menu tendina — li nascondiamo dalla bottom
  const tabPrep = document.getElementById('tabPrep');
  if(tabPrep) tabPrep.style.display = admin ? 'none' : 'flex';
  const tabChiusura = document.getElementById('tabChiusura');
  if(tabChiusura) tabChiusura.style.display = admin ? 'none' : 'flex';

  // News bar — visibile a tutti (tradotta nella propria lingua)
  // La barra viene nascosta da loadNews() se non ci sono news attive

  // check primo accesso e compleanni
  setTimeout(()=>{checkBirthdays(); initSousChef();}, 1000);
}

document.getElementById('out').onclick=()=>{user=null;location.reload()};

// ── ADMIN MENU ───────────────────────────────────────────────
// ── ADMIN MENU SHEET — soluzione iOS Safari (Gemini) ──
const _amSheet  = () => document.getElementById('adminMenuSheet');
const _amPanel  = () => document.getElementById('adminMenuContent');

let _amStartY=0, _amCurrentY=0, _amDragging=false;

function _amTouchStart(e){
  _amStartY = e.touches[0].clientY;
  _amDragging = true;
  _amPanel().style.transition = 'none';
}
function _amTouchMove(e){
  if(!_amDragging) return;
  _amCurrentY = e.touches[0].clientY;
  const dY = _amCurrentY - _amStartY;
  if(dY > 0){
    e.preventDefault();
    _amPanel().style.transform = `translateY(${dY}px)`;
  }
}
function _amTouchEnd(){
  if(!_amDragging) return;
  _amDragging = false;
  const panel = _amPanel();
  panel.style.transition = 'transform 0.3s cubic-bezier(0.25,1,0.5,1)';
  const dY = _amCurrentY - _amStartY;
  if(dY > 100){
    hideAdminMenu();
  } else {
    panel.style.transform = 'translateY(0)';
  }
  _amStartY=0; _amCurrentY=0;
}

function showAdminMenu(){
  const sheet = _amSheet();
  const panel = _amPanel();
  if(!sheet||!panel) return;

  sheet.classList.remove('hidden');

  // Anima da fuori schermo verso su
  panel.style.transition = 'none';
  panel.style.transform = 'translateY(100%)';
  // Due frame per garantire che Safari veda la posizione iniziale
  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{
      panel.style.transition = 'transform 0.3s cubic-bezier(0.25,1,0.5,1)';
      panel.style.transform = 'translateY(0)';
    });
  });

  // Listener swipe — aggiunti una volta sola
  panel.removeEventListener('touchstart', _amTouchStart);
  panel.removeEventListener('touchmove',  _amTouchMove);
  panel.removeEventListener('touchend',   _amTouchEnd);
  panel.addEventListener('touchstart', _amTouchStart, {passive:true});
  panel.addEventListener('touchmove',  _amTouchMove,  {passive:false});
  panel.addEventListener('touchend',   _amTouchEnd,   {passive:true});

  // Chiudi su tap backdrop
  if(!sheet._backdropBound){
    sheet.addEventListener('click', e => { if(e.target===sheet) hideAdminMenu(); });
    sheet._backdropBound = true;
  }
}

function hideAdminMenu(){
  const sheet = _amSheet();
  const panel = _amPanel();
  if(!panel||!sheet) return;

  panel.style.transition = 'transform 0.3s cubic-bezier(0.25,1,0.5,1)';
  panel.style.transform = 'translateY(100%)';
  // scroll ripristinato

  setTimeout(()=>{
    sheet.classList.add('hidden');
    panel.style.transform = ''; // reset per prossima apertura
  }, 300);
}

// ── TRADUZIONI TAB INGREDIENTS ──
// Viene chiamata da applyLang() già esistente
function applyIngredientsLang(){
  const lang = user?.lang || 'en';
  const labels = { it:'Ingredienti', en:'Ingredients', es:'Ingredientes' };
  const el = document.querySelector('[data-i18n="ingredients"]');
  if(el) el.textContent = labels[lang] || 'Ingredients';
}

// ── TAB NAVIGATION ──
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>{x.classList.remove('tab-active');x.classList.add('text-slate-500');const svg=x.querySelector('svg');if(svg)svg.style.stroke='';const sp=x.querySelector('.tab-label');if(sp)sp.style.color=''});
  b.classList.add('tab-active');b.classList.remove('text-slate-500');
  const svg=b.querySelector('svg');if(svg)svg.style.stroke='#059669';
  const sp=b.querySelector('.tab-label');if(sp)sp.style.color='#059669';
  const t=b.dataset.t;
  document.getElementById('vh').classList.toggle('hidden',t!=='h');
  document.getElementById('vm').classList.toggle('hidden',t!=='m');
  document.getElementById('vs').classList.toggle('hidden',t!=='s');
  document.getElementById('vc').classList.add('hidden');
  document.getElementById('vr').classList.toggle('hidden',t!=='r');
  document.getElementById('vp').classList.toggle('hidden',t!=='c');
  document.getElementById('vi').classList.toggle('hidden',t!=='i');
  const vx = document.getElementById('vx');
  if (vx) { vx.classList.toggle('hidden', t!=='x'); if (t==='x') loadPOS(); }
  if(t==='c') renderRecipes();
  if(t==='s'){ renderS(); if(typeof updateCloseTurnBtn==='function') updateCloseTurnBtn(); }
  if(t==='h') renderHomeStations();
  if(t==='r') loadReport('today');
  if(t==='i') loadIngredientsTab();
});



// ── Vendor Documents pending badge ───────────────────────────
async function vdrLoadBadge() {
  const el = document.getElementById('vdrPendingBadge');
  if (!el) return;
  try {
    const sb = window.supabaseClient;
    if (!sb) return;
    const { count, error } = await sb
      .from('vendor_documents')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    if (error) return;
    if (count === 0) {
      el.textContent = '✓ Clear';
      el.style.color = '#10b981';
    } else {
      el.textContent = count + ' Pending';
      el.style.color = '#f59e0b';
    }
  } catch(e) { /* silent — badge is non-critical */ }
}