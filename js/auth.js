// ── AUTH.JS ──
// PIN-only authentication. No passwords, no hashes.
// Admin: openUserManager, openAddUser, openEditUser, resetUserPIN, toggleUserActive
// User: openChangePIN, openProfile, changeAvatar

// ── CAMBIO PIN (utente corrente) ──
function openChangePIN(){
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4';
  modal.innerHTML=`
    <div class="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-5">
      <h3 class="font-bold text-lg mb-4">🔑 Cambia PIN</h3>
      <div class="space-y-3">
        <input id="pinCurrent" type="password" inputmode="numeric" maxlength="4" placeholder="PIN attuale" class="w-full px-3 py-2.5 border rounded-xl text-sm text-center tracking-widest text-lg">
        <input id="pinNew" type="password" inputmode="numeric" maxlength="4" placeholder="Nuovo PIN (4 cifre)" class="w-full px-3 py-2.5 border rounded-xl text-sm text-center tracking-widest text-lg">
        <input id="pinConfirm" type="password" inputmode="numeric" maxlength="4" placeholder="Conferma nuovo PIN" class="w-full px-3 py-2.5 border rounded-xl text-sm text-center tracking-widest text-lg">
        <p id="pinErr" class="text-red-600 text-xs hidden"></p>
      </div>
      <div class="flex gap-2 mt-4">
        <button onclick="this.closest('.fixed').remove()" class="flex-1 py-2.5 border rounded-xl text-sm">Annulla</button>
        <button onclick="saveNewPIN(this)" class="flex-1 py-2.5 bg-slate-900 text-white rounded-xl font-semibold text-sm">Salva</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

async function saveNewPIN(btn){
  const current=document.getElementById('pinCurrent').value.trim();
  const newPin=document.getElementById('pinNew').value.trim();
  const confirm=document.getElementById('pinConfirm').value.trim();
  const err=document.getElementById('pinErr');
  err.classList.add('hidden');
  if(!current||!newPin||!confirm){err.textContent='Compila tutti i campi';err.classList.remove('hidden');return}
  if(!/^\d{4}$/.test(newPin)){err.textContent='Il PIN deve essere 4 cifre';err.classList.remove('hidden');return}
  if(newPin!==confirm){err.textContent='I PIN non coincidono';err.classList.remove('hidden');return}
  if(current!==String(user.pin)){err.textContent='PIN attuale errato';err.classList.remove('hidden');return}
  btn.disabled=true; btn.textContent='Salvataggio...';
  const{error}=await supa.from('users').update({pin:newPin}).eq('id',user.id);
  if(error){err.textContent='Errore: '+error.message;err.classList.remove('hidden');btn.disabled=false;btn.textContent='Salva';return}
  user.pin=newPin;
  btn.closest('.fixed').remove();
  showScToast('✓ PIN aggiornato');
}

// ── GESTIONE UTENTI (solo admin) ──
async function openUserManager(){
  const{data:users_list}=await supa.from('users').select('*').order('name');
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4';
  modal.innerHTML=`
    <div class="bg-white w-full max-w-lg rounded-3xl shadow-2xl max-h-[90vh] flex flex-col">
      <div class="p-4 border-b flex items-center justify-between">
        <h3 class="font-bold text-lg">👥 Brigata</h3>
        <div class="flex gap-2">
          <button onclick="openAddUser()" class="px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-semibold">+ Nuovo</button>
          <button onclick="this.closest('.fixed').remove()" class="text-slate-400 text-xl">✕</button>
        </div>
      </div>
      <div class="p-4 overflow-auto flex-1 space-y-2">
        ${(users_list||[]).map(u=>`
        <div class="flex items-center gap-3 p-3 rounded-2xl border ${u.active===false?'bg-slate-50 opacity-60':'bg-white'}">
          <div class="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center font-bold text-sm overflow-hidden flex-shrink-0">
            ${u.photo_url?`<img src="${u.photo_url}" class="w-full h-full object-cover">`:(u.name||'?').slice(0,2).toUpperCase()}
          </div>
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-sm">${u.name} ${u.active===false?'<span class="text-[10px] text-slate-400">(disattivato)</span>':''}</div>
            <div class="text-xs text-slate-500">${u.role||'staff'} • ${u.lang||'en'} ${u.default_station?'• '+u.default_station:''}</div>
          </div>
          <div class="flex gap-1 flex-shrink-0">
            <button onclick="openEditUser(${u.id})" class="p-1.5 bg-slate-100 rounded-lg text-xs">✏️</button>
            <button onclick="resetUserPIN(${u.id},'${(u.name||'').replace(/'/g,"\\'")}')" class="p-1.5 bg-amber-100 rounded-lg text-xs">🔑</button>
            <button onclick="toggleUserActive(${u.id},${u.active!==false})" class="p-1.5 ${u.active===false?'bg-green-100':'bg-red-100'} rounded-lg text-xs">${u.active===false?'✅':'🚫'}</button>
          </div>
        </div>`).join('')}
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function openAddUser(){
  const STATIONS=['Oven Station','Fresh Pasta Station','Pasta Station','Sauté Station','Saucier Station','Plating Station','Salad Station','Pastry Station','Tableside','Freezer'];
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4';
  modal.innerHTML=`
    <div class="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-5">
      <h3 class="font-bold text-lg mb-4">➕ Nuovo cuoco</h3>
      <div class="space-y-3">
        <input id="nu_name" placeholder="Nome" class="w-full px-3 py-2.5 border rounded-xl text-sm">
        <input id="nu_pin" type="password" inputmode="numeric" maxlength="4" placeholder="PIN 4 cifre"
          class="w-full px-3 py-2.5 border rounded-xl text-sm text-center tracking-widest text-lg">
        <select id="nu_lang" class="w-full px-3 py-2.5 border rounded-xl text-sm bg-white">
          <option value="en">🇬🇧 English</option>
          <option value="it">🇮🇹 Italiano</option>
          <option value="es">🇪🇸 Español</option>
        </select>
        <select id="nu_role" class="w-full px-3 py-2.5 border rounded-xl text-sm bg-white">
          <option value="staff">Staff</option>
          <option value="admin">Admin</option>
        </select>
        <select id="nu_station" class="w-full px-3 py-2.5 border rounded-xl text-sm bg-white">
          <option value="">— Stazione default —</option>
          ${STATIONS.map(s=>`<option value="${s}">${s}</option>`).join('')}
        </select>
        <p id="nu_err" class="text-red-600 text-xs hidden"></p>
      </div>
      <div class="flex gap-2 mt-4">
        <button onclick="this.closest('.fixed').remove()" class="flex-1 py-2.5 border rounded-xl text-sm">Annulla</button>
        <button onclick="saveNewUser(this)" class="flex-1 py-2.5 bg-slate-900 text-white rounded-xl font-semibold text-sm">Crea</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

async function saveNewUser(btn){
  const name=document.getElementById('nu_name').value.trim();
  const pin=document.getElementById('nu_pin').value.trim();
  const lang=document.getElementById('nu_lang').value;
  const role=document.getElementById('nu_role').value;
  const station=document.getElementById('nu_station').value;
  const err=document.getElementById('nu_err');
  err.classList.add('hidden');
  if(!name){err.textContent='Nome obbligatorio';err.classList.remove('hidden');return}
  if(!/^\d{4}$/.test(pin)){err.textContent='PIN deve essere 4 cifre numeriche';err.classList.remove('hidden');return}
  btn.disabled=true; btn.textContent='Creazione...';
  const newUser={name,pin,lang,role,active:true,is_admin:role==='admin'};
  if(station) newUser.default_station=station;
  const{error}=await supa.from('users').insert(newUser);
  if(error){err.textContent='Errore: '+error.message;err.classList.remove('hidden');btn.disabled=false;btn.textContent='Crea';return}
  btn.closest('.fixed').remove();
  document.querySelector('.fixed')?.remove();
  openUserManager();
}

async function openEditUser(userId){
  const{data:u}=await supa.from('users').select('*').eq('id',userId).single();
  if(!u) return;
  const STATIONS=['Oven Station','Fresh Pasta Station','Pasta Station','Sauté Station','Saucier Station','Plating Station','Salad Station','Pastry Station','Tableside','Freezer'];
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4';
  modal.innerHTML=`
    <div class="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-5">
      <h3 class="font-bold text-lg mb-4">✏️ Modifica ${u.name}</h3>
      <div class="space-y-3">
        <input id="eu_name" placeholder="Nome" class="w-full px-3 py-2.5 border rounded-xl text-sm" value="${(u.name||'').replace(/"/g,'&quot;')}">
        <input id="eu_pin" type="password" inputmode="numeric" maxlength="4"
          placeholder="Nuovo PIN (lascia vuoto per non cambiare)"
          class="w-full px-3 py-2.5 border rounded-xl text-sm text-center tracking-widest text-lg">
        <select id="eu_lang" class="w-full px-3 py-2.5 border rounded-xl text-sm bg-white">
          <option value="en" ${u.lang==='en'?'selected':''}>🇬🇧 English</option>
          <option value="it" ${u.lang==='it'?'selected':''}>🇮🇹 Italiano</option>
          <option value="es" ${u.lang==='es'?'selected':''}>🇪🇸 Español</option>
        </select>
        <select id="eu_role" class="w-full px-3 py-2.5 border rounded-xl text-sm bg-white">
          <option value="staff" ${u.role==='staff'?'selected':''}>Staff</option>
          <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
        </select>
        <select id="eu_station" class="w-full px-3 py-2.5 border rounded-xl text-sm bg-white">
          <option value="">— Nessuna stazione —</option>
          ${STATIONS.map(s=>`<option value="${s}" ${u.default_station===s?'selected':''}>${s}</option>`).join('')}
        </select>
        <p id="eu_err" class="text-red-600 text-xs hidden"></p>
      </div>
      <div class="flex gap-2 mt-4">
        <button onclick="this.closest('.fixed').remove()" class="flex-1 py-2.5 border rounded-xl text-sm">Annulla</button>
        <button onclick="saveEditUser(${userId},this)" class="flex-1 py-2.5 bg-slate-900 text-white rounded-xl font-semibold text-sm">Salva</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

async function saveEditUser(userId, btn){
  const name=document.getElementById('eu_name').value.trim();
  const pin=document.getElementById('eu_pin').value.trim();
  const lang=document.getElementById('eu_lang').value;
  const role=document.getElementById('eu_role').value;
  const default_station=document.getElementById('eu_station').value||null;
  const err=document.getElementById('eu_err');
  err.classList.add('hidden');
  if(!name){err.textContent='Nome obbligatorio';err.classList.remove('hidden');return}
  if(pin&&!/^\d{4}$/.test(pin)){err.textContent='PIN deve essere 4 cifre numeriche';err.classList.remove('hidden');return}
  btn.disabled=true; btn.textContent='Salvataggio...';
  const updates={name,lang,role,default_station,is_admin:role==='admin'};
  if(pin) updates.pin=pin;
  const{error}=await supa.from('users').update(updates).eq('id',userId);
  if(error){err.textContent='Errore: '+error.message;err.classList.remove('hidden');btn.disabled=false;btn.textContent='Salva';return}
  if(user && String(user.id)===String(userId)){
    user={...user,...updates};
    if(user.lang) user.lang=normalizeLang(user.lang);
    applyLang();
    updateTopBarAvatar();
  }
  btn.closest('.fixed').remove();
  document.querySelector('.fixed')?.remove();
  openUserManager();
}

// ── RESET PIN (admin) ──
async function resetUserPIN(userId, userName){
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4';
  modal.innerHTML=`
    <div style="background:white;border-radius:20px;padding:20px;width:88%;max-width:360px;">
      <div style="font-size:15px;font-weight:600;color:#1e293b;margin-bottom:12px;">🔑 Reset PIN — ${userName}</div>
      <input id="resetPinInput" type="password" inputmode="numeric" maxlength="4" placeholder="Nuovo PIN (4 cifre)"
        style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:12px;font-size:20px;letter-spacing:8px;text-align:center;box-sizing:border-box;margin-bottom:12px;">
      <p id="resetPinErr" style="color:#dc2626;font-size:12px;display:none;margin-bottom:8px;"></p>
      <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px;">
        <button onclick="this.closest('.fixed').remove()"
          style="height:42px;border-radius:12px;background:#f1f5f9;color:#64748b;font-size:13px;border:none;cursor:pointer;">
          Annulla
        </button>
        <button onclick="confirmResetPIN(${userId},this)"
          style="height:42px;border-radius:12px;background:#1e293b;color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;">
          Imposta PIN
        </button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  setTimeout(()=>document.getElementById('resetPinInput')?.focus(),100);
}

window.confirmResetPIN = async(userId, btn) => {
  const pin=document.getElementById('resetPinInput')?.value?.trim();
  const err=document.getElementById('resetPinErr');
  if(!/^\d{4}$/.test(pin)){
    err.textContent='PIN deve essere 4 cifre numeriche';
    err.style.display='block';
    return;
  }
  btn.textContent='...'; btn.disabled=true;
  const{error}=await supa.from('users').update({pin}).eq('id',userId);
  btn.closest('.fixed').remove();
  showScToast(error ? '✗ Errore: '+error.message : '✓ PIN aggiornato');
};

async function toggleUserActive(userId, currentlyActive){
  await supa.from('users').update({active:!currentlyActive}).eq('id',userId);
  document.querySelector('.fixed')?.remove();
  openUserManager();
}

// ── CONTROLLO UTENTE ATTIVO AL LOGIN ──
async function checkUserActive(profile){
  if(profile.active===false){
    document.getElementById('err').textContent='Account disattivato. Contatta il responsabile.';
    document.getElementById('err').classList.remove('hidden');
    return false;
  }
  return true;
}

// ── COMPLEANNI ──
async function checkBirthdays(){
  const todayDallas=getNowDallas();
  const mm=String(todayDallas.getMonth()+1).padStart(2,'0');
  const dd=String(todayDallas.getDate()).padStart(2,'0');
  const{data}=await supa.from('users')
    .select('name,birth_date')
    .not('birth_date','is',null)
    .eq('active',true);
  const bday=(data||[]).filter(u=>{
    if(!u.birth_date) return false;
    const d=u.birth_date.slice(5);
    return d===`${mm}-${dd}`;
  });
  if(bday.length>0){
    const names=bday.map(u=>u.name).join(', ');
    const bar=document.getElementById('newsBar');
    const scroll=document.getElementById('newsScroll');
    if(scroll) scroll.textContent=`🎂 Oggi è il compleanno di ${names}! Auguri! 🎉`;
    if(bar) bar.classList.remove('hidden');
  }
}

// ── PROFILO ──
function initTopBarAvatar(){ updateTopBarAvatar(); }

function openProfile(){
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-50 flex items-end';
  modal.style.background='rgba(0,0,0,0.3)';
  const notifPrefs=JSON.parse(localStorage.getItem('boh_notif_prefs')||'{"chat":true,"news":true,"closing":true}');
  const quietStart=localStorage.getItem('boh_quiet_start')||'22:00';
  const quietEnd=localStorage.getItem('boh_quiet_end')||'07:00';
  modal.innerHTML=`<div style="background:rgba(255,255,255,0.95);backdrop-filter:blur(20px);border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;max-height:85vh;overflow-y:auto;animation:slideUp .25s ease">
    <div style="width:36px;height:4px;background:rgba(59,130,246,0.15);border-radius:2px;margin:0 auto 16px;"></div>
    <!-- Avatar e nome -->
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;padding-bottom:16px;border-bottom:0.5px solid rgba(59,130,246,0.1);">
      <div id="profileAvatar" onclick="changeAvatar()" style="width:60px;height:60px;border-radius:50%;background:#3B82F6;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:500;color:white;cursor:pointer;overflow:hidden;flex-shrink:0;">
        ${user?.photo_url?`<img src="${user.photo_url}" style="width:100%;height:100%;object-fit:cover;">`:(user?.name||'?').slice(0,2).toUpperCase()}
      </div>
      <div style="flex:1;">
        <div style="font-size:17px;font-weight:500;color:#1e3a5f;">${user?.name||''}</div>
        <div style="font-size:12px;color:#93c5fd;margin-top:2px;">${user?.role||'staff'} • ${user?.default_station||'no station'}</div>
        <button onclick="changeAvatar()" style="font-size:11px;color:#3B82F6;background:none;border:none;padding:0;margin-top:4px;cursor:pointer;">Change photo →</button>
      </div>
    </div>
    <!-- Notifiche -->
    <div style="margin-bottom:16px;">
      <div style="font-size:11px;font-weight:500;color:#93c5fd;letter-spacing:.06em;text-transform:uppercase;margin-bottom:10px;">Notifications</div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${[
          {key:'chat',label:'💬 Chat messages'},
          {key:'news',label:'📢 News & alerts'},
          {key:'closing',label:'🔒 Shift closing'}
        ].map(item=>`
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:rgba(59,130,246,0.05);border-radius:12px;border:0.5px solid rgba(59,130,246,0.1);">
          <span style="font-size:13px;color:#1e3a5f;">${item.label}</span>
          <label style="position:relative;display:inline-block;width:44px;height:24px;cursor:pointer;">
            <input type="checkbox" id="notif_${item.key}" ${notifPrefs[item.key]?'checked':''} onchange="saveNotifPref('${item.key}',this.checked)" style="opacity:0;width:0;height:0;">
            <span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:${notifPrefs[item.key]?'#3B82F6':'#cbd5e1'};border-radius:24px;transition:.3s;">
              <span style="position:absolute;height:18px;width:18px;left:${notifPrefs[item.key]?'22px':'3px'};bottom:3px;background:white;border-radius:50%;transition:.3s;"></span>
            </span>
          </label>
        </div>`).join('')}
      </div>
    </div>
    <!-- Quiet Hours -->
    <div style="margin-bottom:16px;">
      <div style="font-size:11px;font-weight:500;color:#93c5fd;letter-spacing:.06em;text-transform:uppercase;margin-bottom:10px;">Quiet Hours</div>
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(59,130,246,0.05);border-radius:12px;border:0.5px solid rgba(59,130,246,0.1);">
        <span style="font-size:13px;color:#1e3a5f;">From</span>
        <input type="time" id="quietStart" value="${quietStart}" style="font-size:13px;color:#1e3a5f;background:none;border:none;flex:1;">
        <span style="font-size:13px;color:#1e3a5f;">to</span>
        <input type="time" id="quietEnd" value="${quietEnd}" style="font-size:13px;color:#1e3a5f;background:none;border:none;flex:1;">
      </div>
    </div>
    <!-- Sicurezza: cambio PIN -->
    <div style="margin-bottom:16px;">
      <div style="font-size:11px;font-weight:500;color:#93c5fd;letter-spacing:.06em;text-transform:uppercase;margin-bottom:10px;">Security</div>
      <button onclick="this.closest('.fixed').remove();openChangePIN()" style="width:100%;padding:10px 12px;background:rgba(59,130,246,0.05);border:0.5px solid rgba(59,130,246,0.1);border-radius:12px;font-size:13px;color:#1e3a5f;text-align:left;cursor:pointer;">🔑 Change PIN</button>
    </div>
    <!-- Salva -->
    <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px;">
      <button onclick="this.closest('.fixed').remove()" style="height:44px;border-radius:14px;background:rgba(59,130,246,0.08);color:#1d4ed8;font-size:13px;border:none;cursor:pointer;">Cancel</button>
      <button onclick="saveProfile(this)" style="height:44px;border-radius:14px;background:#1e3a5f;color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;">Save</button>
    </div>
  </div>`;
  modal.onclick=e=>{if(e.target===modal)modal.remove()};
  document.body.appendChild(modal);
}

function saveNotifPref(key, value){
  const prefs=JSON.parse(localStorage.getItem('boh_notif_prefs')||'{"chat":true,"news":true,"closing":true}');
  prefs[key]=value;
  localStorage.setItem('boh_notif_prefs',JSON.stringify(prefs));
  const cb=document.getElementById('notif_'+key);
  if(!cb) return;
  const track=cb.nextElementSibling;
  const knob=track?.firstElementChild;
  if(track) track.style.background=value?'#3B82F6':'#cbd5e1';
  if(knob)  knob.style.left=value?'22px':'3px';
}

async function saveProfile(btn){
  const quietStart=document.getElementById('quietStart')?.value;
  const quietEnd=document.getElementById('quietEnd')?.value;
  if(quietStart) localStorage.setItem('boh_quiet_start',quietStart);
  if(quietEnd) localStorage.setItem('boh_quiet_end',quietEnd);
  btn.closest('.fixed').remove();
  updateTopBarAvatar();
  if(typeof renderPresence==='function') renderPresence();
  if(typeof loadOnlineUsers==='function') loadOnlineUsers();
}

function changeAvatar(){
  const input=document.createElement('input');
  input.type='file';
  input.accept='image/*';
  input.onchange=async(e)=>{
    const file=e.target.files[0];
    if(!file) return;
    const av=document.getElementById('profileAvatar');
    if(av) av.innerHTML='<span style="font-size:20px;">⏳</span>';
    const ext=file.name.split('.').pop();
    const path=`avatars/${user.id}_${Date.now()}.${ext}`;
    const{data,error}=await supa.storage.from('avatars').upload(path,file,{upsert:true,contentType:file.type});
    if(error){
      const reader=new FileReader();
      reader.onload=async(ev)=>{
        const url=ev.target.result;
        await supa.from('users').update({photo_url:url}).eq('id',user.id);
        user.photo_url=url;
        if(av) av.innerHTML=`<img src="${url}" style="width:100%;height:100%;object-fit:cover;">`;
        updateTopBarAvatar();
        const profAv=document.getElementById('profileAvatar');
        if(profAv) profAv.innerHTML=`<img src="${url}" style="width:100%;height:100%;object-fit:cover;">`;
        if(typeof renderPresence==='function') renderPresence();
        if(typeof loadOnlineUsers==='function') loadOnlineUsers();
      };
      reader.readAsDataURL(file);
      return;
    }
    const{data:urlData}=supa.storage.from('avatars').getPublicUrl(path);
    const url=urlData?.publicUrl;
    if(!url) return;
    await supa.from('users').update({photo_url:url}).eq('id',user.id);
    user.photo_url=url;
    if(av) av.innerHTML=`<img src="${url}" style="width:100%;height:100%;object-fit:cover;">`;
    updateTopBarAvatar();
    const profAv=document.getElementById('profileAvatar');
    if(profAv) profAv.innerHTML=`<img src="${url}" style="width:100%;height:100%;object-fit:cover;">`;
    if(typeof renderPresence==='function') renderPresence();
    if(typeof loadOnlineUsers==='function') loadOnlineUsers();
  };
  input.click();
}

function updateTopBarAvatar(){
  const av=document.getElementById('topbarAvatar');
  if(!av) return;
  if(user?.photo_url){
    av.innerHTML=`<img src="${user.photo_url}" style="width:100%;height:100%;object-fit:cover;">`;
  } else {
    av.innerHTML=(user?.name||'?').slice(0,2).toUpperCase();
    av.style.background='#3B82F6';
  }
}

// ── Realtime sync utenti ──
let usersRealtimeChannel=null;
function startUsersRealtime(){
  if(usersRealtimeChannel) supa.removeChannel(usersRealtimeChannel);
  usersRealtimeChannel=supa.channel('users-rt-'+Date.now())
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'users'},(payload)=>{
      const updated=payload.new;
      if(!updated) return;
      if(user && String(user.id)===String(updated.id)){
        user={...user,...updated};
        if(user.lang) user.lang=normalizeLang(user.lang);
        applyLang();
        updateTopBarAvatar();
      }
      if(typeof renderPresence==='function') renderPresence();
      if(typeof loadOnlineUsers==='function') loadOnlineUsers();
    })
    .subscribe((status)=>{
      if(status==='CLOSED'||status==='CHANNEL_ERROR'){
        setTimeout(startUsersRealtime,5000);
      }
    });
}

function isQuietHours(){
  const start=localStorage.getItem('boh_quiet_start')||'22:00';
  const end=localStorage.getItem('boh_quiet_end')||'07:00';
  const now=getNowDallas();
  const h=now.getHours();
  const m=now.getMinutes();
  const cur=h*60+m;
  const[sh,sm]=start.split(':').map(Number);
  const[eh,em]=end.split(':').map(Number);
  const s=sh*60+sm;
  const e=eh*60+em;
  if(s>e) return cur>=s||cur<e;
  return cur>=s&&cur<e;
}
