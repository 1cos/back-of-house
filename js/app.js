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
  // se l'utente ha selezionato una lingua diversa al login
  if(loginLang && loginLang !== user.lang){
    user.lang = loginLang;
    // salva su Supabase solo per staff, non per admin
    if(user.role !== 'admin' && !user.is_admin){
      supa.from('users').update({lang:loginLang}).eq('id',parseInt(user.id)).then(()=>{});
    }
  }
  // applica stazione default se presente
  if(user.default_station){
    station=user.default_station.replace(' Station','');
    station2=user.default_station.replace(' Station','');
  }
  document.getElementById('login').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('who').textContent=user.name;
  // ruolo sotto il nome
  const roleEl = document.getElementById('topbarRole');
  if(roleEl) roleEl.textContent = user.role==='admin' ? 'Admin' : (user.default_station||'Staff');
  setTimeout(()=>updateTopBarAvatar(), 100); // aggiorna avatar top bar
  init(); applyLang(); updateAlertBtn(); setupPush();
  if(isAdmin()){ loadNews(); initNews(); } // News solo per admin
  loadBriefing(); startPresence(); startUrgencyCheck();
  // avvia realtime chat subito al login
  setTimeout(()=>startChatRealtime(), 500);
  // mostra/nascondi sezioni in base al ruolo
  const checklistSection=document.getElementById('homeChecklistSection');
  if(checklistSection) checklistSection.style.display=isAdmin()?'block':'none';
  const invoiceSection=document.getElementById('invoiceSection');
  if(invoiceSection) invoiceSection.style.display=isAdmin()?'block':'none';

  // ── RUOLI: admin vs staff ──
  const admin = isAdmin();

  // Tab Ingredients — solo admin
  const tabIngr = document.getElementById('tabIngredients');
  if(tabIngr) tabIngr.style.display = admin ? 'flex' : 'none';

  // Tab Menu ••• — solo admin
  const tabMenu = document.getElementById('tabMenu');
  if(tabMenu) tabMenu.style.display = admin ? 'flex' : 'none';

  // Staff: Prep e Chiusura in bottom bar
  // Admin: Prep e Chiusura nel menu tendina — li nascondiamo dalla bottom
  const tabPrep = document.getElementById('tabPrep');
  if(tabPrep) tabPrep.style.display = admin ? 'none' : 'flex';
  const tabChiusura = document.getElementById('tabChiusura');
  if(tabChiusura) tabChiusura.style.display = admin ? 'none' : 'flex';

  // News bar — solo admin
  if(!admin){
    const newsBar = document.getElementById('newsBar');
    if(newsBar) newsBar.style.display = 'none';
  }

  // check primo accesso e compleanni
  setTimeout(()=>{checkFirstLogin(); checkBirthdays(); initSousChef();}, 1000);
}

document.getElementById('out').onclick=()=>{user=null;location.reload()};

// ── ADMIN MENU ───────────────────────────────────────────────
function showAdminMenu(){
  const sheet = document.getElementById('adminMenuSheet');
  if(!sheet) return;
  sheet.classList.remove('hidden');
  const content = document.getElementById('adminMenuContent');
  if(content){
    content.style.transform = 'translateX(-50%) translateY(20px)';
    content.style.opacity = '0';
    content.style.transition = 'all .25s ease';
    requestAnimationFrame(()=>{
      content.style.transform = 'translateX(-50%) translateY(0)';
      content.style.opacity = '1';
    });
  }
}

function hideAdminMenu(){
  const sheet = document.getElementById('adminMenuSheet');
  if(sheet) sheet.classList.add('hidden');
}

// ── TRADUZIONI TAB INGREDIENTS ──
// Viene chiamata da applyLang() già esistente
function applyIngredientsLang(){
  const lang = user?.lang || 'it';
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
  if(t==='c') renderRecipes();
  if(t==='s') renderS();
  if(t==='h') renderHomeStations();
  if(t==='r') loadReport('today');
  if(t==='i') loadIngredientsTab();
});

