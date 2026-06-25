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

// ── STAFF TAB BAR — logica oraria 20:00 CDT ──
function updateStaffTabs() {
  var h = parseInt(new Date().toLocaleString('en-US', {timeZone: 'America/Chicago', hour: 'numeric', hour12: false}));
  var isEvening = h >= 20 || h < 2;
  var tabChiusura = document.getElementById('tabChiusura');
  var otherLabel = document.getElementById('otherStationsLabel');
  if (tabChiusura) tabChiusura.style.display = isEvening ? 'flex' : 'none';
  if (otherLabel) otherLabel.textContent = 'Stations';
}

window.showOtherStationsTab = function() {
  var h = parseInt(new Date().toLocaleString('en-US', {timeZone: 'America/Chicago', hour: 'numeric', hour12: false}));
  var isEvening = h >= 20 || h < 2;
  var existing = document.getElementById('otherStationsSheet');
  if (existing) existing.remove();
  var sheet = document.createElement('div');
  sheet.id = 'otherStationsSheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:70;display:flex;flex-direction:column;justify-content:flex-end;';
  var title = isEvening ? 'Closing — Altre Stazioni' : 'Prep — Altre Stazioni';
  sheet.innerHTML = '<div style="flex:1;background:rgba(0,0,0,0.4);" id="otherSheetBg"></div>' +
    '<div style="background:white;border-radius:20px 20px 0 0;max-height:80vh;overflow-y:auto;padding:16px;">' +
      '<div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 16px;"></div>' +
      '<div style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:12px;">' + title + '</div>' +
      '<div id="otherStationsSheetContent" style="display:flex;flex-direction:column;gap:8px;">' +
        '<div style="color:#94a3b8;font-size:13px;">Caricamento...</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(sheet);
  document.getElementById('otherSheetBg').onclick = function() { sheet.remove(); };
  var stationsEl = document.getElementById('homeOtherStations');
  var contentEl = document.getElementById('otherStationsSheetContent');
  if (stationsEl && contentEl) {
    var pills = stationsEl.querySelectorAll('button,[data-station]');
    if (pills.length > 0) {
      contentEl.innerHTML = '';
      pills.forEach(function(p) {
        var btn = document.createElement('button');
        btn.textContent = p.textContent.trim();
        btn.style.cssText = 'width:100%;padding:14px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;text-align:left;font-size:14px;font-weight:500;cursor:pointer;';
        btn.onclick = function() { sheet.remove(); p.click(); };
        contentEl.appendChild(btn);
      });
    } else {
      contentEl.innerHTML = '<div style="color:#94a3b8;font-size:13px;">Nessuna altra stazione attiva.</div>';
    }
  }
};

// ── HOME TIME CHECK — logica oraria 20:00 ──
let _homeTimeCheckInterval = null;

function startHomeTimeCheck(){
  _applyHomeTimeLayout();
  if(_homeTimeCheckInterval) clearInterval(_homeTimeCheckInterval);
  _homeTimeCheckInterval = setInterval(_applyHomeTimeLayout, 60000);
}

function _applyHomeTimeLayout(){
  const h = parseInt(new Date().toLocaleString('en-US',{timeZone:'America/Chicago',hour:'numeric',hour12:false}));
  const isEvening = h >= 20 || h < 2;
  const closingWidget = document.getElementById('homeClosingWidget');
  const checklistSection = document.getElementById('homeChecklistSection');

  if(isEvening){
    // Dopo le 20:00 — closing sale in cima per tutti
    if(closingWidget){
      closingWidget.style.display = 'block';
      // Popola pill stazioni nella closing (stesse di homeStations per admin)
      const stEl = document.getElementById('homeClosingStations');
      const srcEl = document.getElementById('homeStations');
      if(stEl && srcEl) stEl.innerHTML = srcEl.innerHTML;
      // Your Station nella closing — specchio di homeStationItems (solo staff)
      const closingYours = document.getElementById('homeClosingYourStation');
      const srcYours = document.getElementById('homeStationItems');
      if(closingYours && srcYours) closingYours.innerHTML = srcYours.innerHTML;
      // Other Stations nella closing — specchio di homeOtherStations (solo staff)
      const closingOtherLabel = document.getElementById('homeClosingOtherLabel');
      const closingOther = document.getElementById('homeClosingOtherStations');
      const srcOther = document.getElementById('homeOtherStations');
      if(closingOther && srcOther){
        if(srcOther.innerHTML.trim()){
          closingOther.innerHTML = srcOther.innerHTML;
          closingOther.style.display = 'flex';
          if(closingOtherLabel) closingOtherLabel.style.display = 'block';
        } else {
          closingOther.style.display = 'none';
          if(closingOtherLabel) closingOtherLabel.style.display = 'none';
        }
      }
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
  window.user=profile; // esposto per tell-chef.js e altri moduli
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

  // Schedule — visibile a tutti (popolato via CSV import)
  const tabSchedule = document.getElementById('tabSchedule');
  if(tabSchedule) tabSchedule.style.display = 'flex';

  // Menu ••• — solo admin
  const tabMenu = document.getElementById('tabMenu');
  if(tabMenu) tabMenu.style.display = admin ? 'flex' : 'none';

  // Tell Chef — solo staff (non admin)
  const tabTellChef = document.getElementById('tabTellChef');
  if(tabTellChef) tabTellChef.style.display = (admin||isSupervisor()) ? 'none' : 'flex';

  // Prep — solo staff
  const tabPrep = document.getElementById('tabPrep');
  if(tabPrep) tabPrep.style.display = admin ? 'none' : 'flex';

  // tabChiusura gestita da updateStaffTabs() in base all'orario
  if(!admin) updateStaffTabs();

  // Chat — tutti
  // (gia visibile di default)

  // ── LOGICA ORARIA 20:00 ──
  startHomeTimeCheck();
  if(!admin) setInterval(updateStaffTabs, 60000);

  // ── FOCUS MODE header — solo staff ──
  if (!admin) {
    var fName = document.getElementById('focusUserName');
    var fStation = document.getElementById('focusStation');
    if (fName) fName.textContent = user.name;
    if (fStation) fStation.textContent = user.default_station || '';
  }

  // check primo accesso e compleanni
  setTimeout(()=>{checkBirthdays(); initSousChef();}, 1000);
}

document.getElementById('out').onclick=()=>{user=null;location.reload()};

// ── ADMIN MENU ──────────────────────────────────────────────
// ── ANNOUNCEMENTS ──
async function openAnnouncements() {
  var existing = document.getElementById('announcementsModal');
  if (existing) existing.remove();

  var now = new Date();
  var localStr = now.toLocaleString('en-US', {timeZone:'America/Chicago'});
  var local = new Date(localStr);
  var hh = String(local.getHours()).padStart(2,'0');
  var mm = String(local.getMinutes()).padStart(2,'0');
  var nowTime = hh + ':' + mm;

  var res = await supa.from('announcements').select('*').eq('active', true).order('created_at', {ascending: false});
  var list = res.data || [];

  var listHtml = list.length === 0
    ? '<div style="font-size:13px;color:#94a3b8;padding:12px 0;">No active announcements</div>'
    : list.map(function(a) {
        return '<div style="background:#f8fafc;border-radius:12px;padding:12px 14px;margin-bottom:10px;border:1px solid #e2e8f0;">' +
          '<div style="font-size:15px;font-weight:600;color:#0f172a;margin-bottom:6px;">' + a.text + '</div>' +
          '<div style="font-size:12px;color:#64748b;">' + a.starts_at.slice(0,5) + ' - ' + a.ends_at.slice(0,5) + '</div>' +
          '<button onclick="deleteAnnouncement(' + JSON.stringify(a.id) + ')" style="margin-top:8px;font-size:12px;color:#ef4444;background:none;border:none;padding:0;cursor:pointer;">Remove</button>' +
        '</div>';
      }).join('');

  var modal = document.createElement('div');
  modal.id = 'announcementsModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(15,23,42,0.5);display:flex;align-items:flex-end;';
  modal.innerHTML = '<div style="background:white;border-radius:24px 24px 0 0;padding:20px 16px 40px;width:100%;max-width:448px;margin:0 auto;">' +
    '<div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 16px;"></div>' +
    '<div style="font-size:17px;font-weight:700;color:#0f172a;margin-bottom:16px;">TV Announcement</div>' +
    '<div style="margin-bottom:16px;">' +
      '<textarea id="ann-text" placeholder="Message for the kitchen TV..." style="width:100%;height:80px;border:1.5px solid #e2e8f0;border-radius:12px;padding:10px 12px;font-size:14px;color:#0f172a;resize:none;box-sizing:border-box;"></textarea>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;">' +
      '<div>' +
        '<div style="font-size:11px;font-weight:600;color:#64748b;margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em;">From</div>' +
        '<input id="ann-start" type="time" value="' + nowTime + '" style="width:100%;border:1.5px solid #e2e8f0;border-radius:10px;padding:8px 10px;font-size:14px;box-sizing:border-box;">' +
      '</div>' +
      '<div>' +
        '<div style="font-size:11px;font-weight:600;color:#64748b;margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em;">Until</div>' +
        '<input id="ann-end" type="time" value="14:00" style="width:100%;border:1.5px solid #e2e8f0;border-radius:10px;padding:8px 10px;font-size:14px;box-sizing:border-box;">' +
      '</div>' +
    '</div>' +
    '<button onclick="saveAnnouncement()" style="width:100%;height:48px;border-radius:14px;background:#2563eb;color:white;font-size:15px;font-weight:700;border:none;margin-bottom:12px;">Post to TV</button>' +
    '<div style="font-size:13px;font-weight:600;color:#0f172a;margin-bottom:10px;margin-top:4px;">Active</div>' +
    listHtml +
    '<button onclick="var m=document.getElementById(\'announcementsModal\');if(m)m.remove();" style="width:100%;height:44px;border-radius:14px;background:#f1f5f9;color:#475569;font-size:14px;font-weight:600;border:none;margin-top:8px;">Close</button>' +
  '</div>';
  modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
  document.body.appendChild(modal);
}

async function saveAnnouncement() {
  var text = document.getElementById('ann-text').value.trim();
  var start = document.getElementById('ann-start').value;
  var end = document.getElementById('ann-end').value;
  if (!text || !start || !end) return;
  await supa.from('announcements').insert({text: text, starts_at: start + ':00', ends_at: end + ':00', active: true, created_by: user ? user.name : 'Admin'});
  document.getElementById('announcementsModal').remove();
  openAnnouncements();
}

async function deleteAnnouncement(id) {
  await supa.from('announcements').update({active: false}).eq('id', id);
  document.getElementById('announcementsModal').remove();
  openAnnouncements();
}


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
  var vvdr = document.getElementById('vvdr'); if(vvdr) vvdr.classList.add('hidden');
  var vkal = document.getElementById('vkal'); if(vkal) vkal.classList.add('hidden');
  const vx = document.getElementById('vx');
  if (vx) { vx.classList.toggle('hidden', t!=='x'); if (t==='x') loadPOS(); }
  const vsched = document.getElementById('vsched');
  if (vsched) { vsched.classList.toggle('hidden', t!=='sched'); if (t==='sched') schedLoadData(); }
  if(t==='c') renderRecipes();
  if(t==='s'){ renderS(); if(typeof updateCloseTurnBtn==='function') updateCloseTurnBtn(); }
  if(t==='h') renderHomeStations();
  if(t==='r') loadReport('today');
  if(t==='i') loadIngredientsTab();
  // Nascondi mic Sous Chef nella tab Chat — evita sovrapposizione col send button
  var scBtn = document.getElementById('scBtn');
  if (scBtn) scBtn.style.display = (t === 'm') ? 'none' : '';
});

// ── Vendor Documents page navigation ──
window.showVdrSection = function() {
  // Hide all sections
  ['vh','vm','vs','vc','vr','vp','vi','vx','vsched','vkal','vvdr'].forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.classList.add('hidden');
  });
  // Deactivate all tabs
  document.querySelectorAll('.tab').forEach(function(x){
    x.classList.remove('tab-active');
    x.classList.add('text-slate-500');
    var svg=x.querySelector('svg'); if(svg) svg.style.stroke='';
    var sp=x.querySelector('.tab-label'); if(sp) sp.style.color='';
  });
  var el = document.getElementById('vvdr');
  if(el) el.classList.remove('hidden');
  window.scrollTo(0,0);
};

window.showSection = function(id) {
  ['vh','vm','vs','vc','vr','vp','vi','vx','vsched','vkal','vvdr'].forEach(function(sid){
    var el = document.getElementById(sid);
    if(el) el.classList.add('hidden');
  });
  var target = document.getElementById(id);
  if(target) target.classList.remove('hidden');
  // Sync bottom bar active state
  var map = {vh:'h',vm:'m',vs:'s',vp:'c',vi:'i',vx:'x',vsched:'sched'};
  var t = map[id];
  if(t){
    document.querySelectorAll('.tab').forEach(function(x){
      x.classList.remove('tab-active'); x.classList.add('text-slate-500');
      var svg=x.querySelector('svg'); if(svg) svg.style.stroke='';
      var sp=x.querySelector('.tab-label'); if(sp) sp.style.color='';
    });
    var activeTab = document.querySelector('.tab[data-t="'+t+'"]');
    if(activeTab){
      activeTab.classList.add('tab-active'); activeTab.classList.remove('text-slate-500');
      var svg=activeTab.querySelector('svg'); if(svg) svg.style.stroke='#059669';
      var sp=activeTab.querySelector('.tab-label'); if(sp) sp.style.color='#059669';
    }
  }
  window.scrollTo(0,0);
};

window.vdrBack = function() {
  var el = document.getElementById('vvdr');
  if(el) el.classList.add('hidden');
  // Go back to home
  document.getElementById('vh').classList.remove('hidden');
  var homeTab = document.querySelector('.tab[data-t="h"]');
  if(homeTab) homeTab.click();
};

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
      .in('status', ['pending', 'pdf_received']);
    if (error) return;
    if (count === 0) {
      el.textContent = 'Clear';
      el.style.color = '#10b981';
    } else {
      el.textContent = count + ' to review';
      el.style.color = '#f59e0b';
    }
  } catch(e) {}
}





