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

// ── HIGHLIGHTS TITLE — Yesterday's vs Weekly ──
function getHighlightsTitle(){
  const dow = new Date().toLocaleString('en-US',{timeZone:'America/Chicago',weekday:'long'});
  return dow === 'Monday' ? "Weekly Highlights" : "Yesterday's Highlights";
}

// ── HOME TIME CHECK — logica oraria 20:00 ──
let _homeTimeCheckInterval = null;

function startHomeTimeCheck(){
  _applyHomeTimeLayout();
  if(_homeTimeCheckInterval) clearInterval(_homeTimeCheckInterval);
  _homeTimeCheckInterval = setInterval(_applyHomeTimeLayout, 60000);
}

function _applyHomeTimeLayout(){
  const h = parseInt(new Date().toLocaleString('en-US',{timeZone:'America/Chicago',hour:'numeric',hour12:false}));
  const isEvening = h >= 20;
  const closingWidget = document.getElementById('homeClosingWidget');
  const checklistSection = document.getElementById('homeChecklistSection');

  if(isEvening){
    // Dopo le 20:00 — closing sale in cima per tutti
    if(closingWidget){
      closingWidget.style.display = 'block';
      // Popola le stazioni nella closing widget in cima
      const stEl = document.getElementById('homeClosingStations');
      const srcEl = document.getElementById('homeStations');
      if(stEl && srcEl) stEl.innerHTML = srcEl.innerHTML;
    }
    // Nascondi closing section in fondo (era solo admin)
    if(checklistSection) checklistSection.style.display = 'none';
  } else {
    // Prima delle 20:00 — closing widget in cima nascosto
    if(closingWidget) closingWidget.style.display = 'none';
    // Closing section in fondo — solo admin
    if(checklistSection) checklistSection.style.display = isAdmin() ? 'block' : 'none';
  }
}

// ── SAVE EVENING NOTE ──
window.saveEveningNote = async function(){
  const text = document.getElementById('homeEveningNoteText')?.value?.trim();
  if(!text) return;
  const btn = document.querySelector('#homeClosingWidget button[onclick="saveEveningNote()"]');
  if(btn){ btn.textContent = '...'; btn.disabled = true; }
  try{
    const todayCDT = new Date().toLocaleString('en-CA',{timeZone:'America/Chicago'}).slice(0,10);
    await supa.from('operation_notes').upsert({
      note_date: todayCDT,
      user_name: user?.name || '',
      note: text,
      submitted_at: new Date().toISOString()
    },{onConflict:'note_date,user_name'});
    document.getElementById('homeEveningNoteText').value = '';
    showScToast('Note saved — thanks!');
    // Segna che ha già risposto oggi — la push delle 22:30 non arriverà
    localStorage.setItem('operation_note_date', todayCDT);
  }catch(e){
    showScToast('Error saving note');
  }
  if(btn){ btn.textContent = 'Save note'; btn.disabled = false; }
};

function doLogin(profile){
  user=profile;
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
  // Ricarica photo_url dal DB
  supa.from('users').select('photo_url').eq('id', user.id).single().then(({data})=>{
    if(data?.photo_url) user.photo_url = data.photo_url;
    updateTopBarAvatar();
  });
  init(); applyLang(); updateAlertBtn(); setupPush();
  loadNews(); initNews();
  loadBriefing(); startPresence(); startUrgencyCheck(); if(typeof startUsersRealtime==='function') startUsersRealtime();
  setTimeout(()=>startChatRealtime(), 500);

  const admin = isAdmin();

  // ── HIGHLIGHTS TITLE ──
  const hlTitle = document.getElementById('homeHighlightsTitle');
  if(hlTitle) hlTitle.textContent = getHighlightsTitle();

  // ── ADMIN HOME ──
  if(admin){
    // Warnings banner — admin vede tutto
    const wb = document.getElementById('warningsBanner');
    if(wb) wb.style.display = '';

    // Invoice section
    const inv = document.getElementById('invoiceSection');
    if(inv) inv.style.display = 'block';
    vdrLoadBadge();

    // Briefing AI
    const brief = document.getElementById('homeBriefingSection');
    if(brief) brief.style.display = 'block';

    // Stations widget — admin: titolo "Stations", mostra pill tutte, nascondi your station e other
    const stTitle = document.getElementById('homeStationsTitle');
    if(stTitle) stTitle.textContent = 'Stations';
    const goBtn = document.getElementById('homeStationsGoBtn');
    if(goBtn) goBtn.style.display = 'none'; // admin non ha "Go to prep"
    const stItems = document.getElementById('homeStationItems');
    if(stItems) stItems.style.display = 'none';
    const otherSt = document.getElementById('homeOtherStations');
    if(otherSt) otherSt.style.display = 'none';
    // homeStations (pill) già visibile di default

  // ── STAFF HOME ──
  } else {
    // Nascondi tutto admin
    const wb = document.getElementById('warningsBanner');
    if(wb) wb.style.display = 'none';
    const inv = document.getElementById('invoiceSection');
    if(inv) inv.style.display = 'none';
    const brief = document.getElementById('homeBriefingSection');
    if(brief) brief.style.display = 'none';

    // Stations widget — staff: titolo "Your Station", nascondi pill admin, mostra your station + altre
    const stTitle = document.getElementById('homeStationsTitle');
    if(stTitle) stTitle.textContent = 'Your Station';
    const adminPills = document.getElementById('homeStations');
    if(adminPills) adminPills.style.display = 'none';
    const stItems = document.getElementById('homeStationItems');
    if(stItems) stItems.style.display = 'block';
    const otherSt = document.getElementById('homeOtherStations');
    if(otherSt) otherSt.style.display = 'flex';
  }

  // ── TAB VISIBILITY ──
  // Ingredients — solo admin
  const tabIngr = document.getElementById('tabIngredients');
  if(tabIngr) tabIngr.style.display = admin ? 'flex' : 'none';

  // Sales — tutti (contenuto diverso gestito da pos.js)
  const tabSales = document.getElementById('tabSales');
  if(tabSales) tabSales.style.display = 'flex';

  // Menu ••• — solo admin
  const tabMenu = document.getElementById('tabMenu');
  if(tabMenu) tabMenu.style.display = admin ? 'flex' : 'none';

  // Prep e Chiusura — solo staff in bottom bar
  const tabPrep = document.getElementById('tabPrep');
  if(tabPrep) tabPrep.style.display = admin ? 'none' : 'flex';
  const tabChiusura = document.getElementById('tabChiusura');
  if(tabChiusura) tabChiusura.style.display = admin ? 'none' : 'flex';

  // Chat — tutti
  // (già visibile di default)

  // ── LOGICA ORARIA 20:00 ──
  startHomeTimeCheck();

  // check primo accesso e compleanni
  setTimeout(()=>{checkBirthdays(); initSousChef();}, 1000);
}

document.getElementById('out').onclick=()=>{user=null;location.reload()};

// ── ADMIN MENU ──────────────────────────────────────────────
function showAdminMenu(){
  const sheet = document.getElementById('adminMenuSheet');
  const content = document.getElementById('adminMenuContent');
  if(!sheet || !content) return;

  sheet.classList.remove('hidden');
  content.style.transition = 'none';
  content.style.transform = 'translateY(0)';

  if(!sheet._backdropBound){
    sheet.addEventListener('click', function(e){ if(e.target===sheet) hideAdminMenu(); });
    sheet._backdropBound = true;
  }

  if(!content._swipeBound){
    var startY = 0;
    var currentY = 0;
    var dragging = false;

    content.addEventListener('touchstart', function(e){
      startY = e.touches[0].clientY;
      currentY = 0;
      dragging = true;
      content.style.transition = 'none';
    }, {passive: true});

    content.addEventListener('touchmove', function(e){
      if(!dragging) return;
      var dy = e.touches[0].clientY - startY;
      if(dy < 0) return;
      currentY = dy;
      content.style.transform = 'translateY(' + dy + 'px)';
    }, {passive: true});

    content.addEventListener('touchend', function(){
      if(!dragging) return;
      dragging = false;
      if(currentY > 80){
        content.style.transition = 'transform 0.25s ease';
        content.style.transform = 'translateY(100%)';
        setTimeout(function(){ hideAdminMenu(); }, 240);
      } else {
        content.style.transition = 'transform 0.3s cubic-bezier(0.34,1.56,0.64,1)';
        content.style.transform = 'translateY(0)';
      }
    }, {passive: true});

    content._swipeBound = true;
  }
}

function hideAdminMenu(){
  const sheet = document.getElementById('adminMenuSheet');
  const content = document.getElementById('adminMenuContent');
  if(sheet) sheet.classList.add('hidden');
  if(content){
    content.style.transition = 'none';
    content.style.transform = 'translateY(0)';
  }
}

window.showAdminMenu = showAdminMenu;
window.hideAdminMenu = hideAdminMenu;

// ── TRADUZIONI TAB INGREDIENTS ──
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

// ── Vendor Documents pending badge ──
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
      el.textContent = 'Clear';
      el.style.color = '#10b981';
    } else {
      el.textContent = count + ' Pending';
      el.style.color = '#f59e0b';
    }
  } catch(e) {}
}
