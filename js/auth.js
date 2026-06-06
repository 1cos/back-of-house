// ── CAMBIO PASSWORD ──
function openChangePassword(){
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4';
  modal.innerHTML=`
    <div class="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-5">
      <h3 class="font-bold text-lg mb-4">🔑 Cambia Password</h3>
      <div class="space-y-3">
        <input id="pwdCurrent" type="password" placeholder="Password attuale" class="w-full px-3 py-2.5 border rounded-xl text-sm">
        <input id="pwdNew" type="password" placeholder="Nuova password" class="w-full px-3 py-2.5 border rounded-xl text-sm">
        <input id="pwdConfirm" type="password" placeholder="Conferma nuova password" class="w-full px-3 py-2.5 border rounded-xl text-sm">
        <p id="pwdErr" class="text-red-600 text-xs hidden"></p>
      </div>
      <div class="flex gap-2 mt-4">
        <button onclick="this.closest('.fixed').remove()" class="flex-1 py-2.5 border rounded-xl text-sm">Annulla</button>
        <button onclick="saveNewPassword(this)" class="flex-1 py-2.5 bg-slate-900 text-white rounded-xl font-semibold text-sm">Salva</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

async function saveNewPassword(btn){
  const current=document.getElementById('pwdCurrent').value;
  const newPwd=document.getElementById('pwdNew').value;
  const confirm=document.getElementById('pwdConfirm').value;
  const err=document.getElementById('pwdErr');
  err.classList.add('hidden');
  if(!current||!newPwd||!confirm){err.textContent='Compila tutti i campi';err.classList.remove('hidden');return}
  if(newPwd!==confirm){err.textContent='Le password non coincidono';err.classList.remove('hidden');return}
  if(newPwd.length<4){err.textContent='Minimo 4 caratteri';err.classList.remove('hidden');return}
  const hashCurrent=await hashPassword(current);
  if(hashCurrent!==user.password_hash){err.textContent='Password attuale errata';err.classList.remove('hidden');return}
  btn.disabled=true; btn.textContent='Salvataggio...';
  const hashNew=await hashPassword(newPwd);
  const{error}=await supa.from('users').update({password_hash:hashNew,first_login:false}).eq('id',parseInt(user.id));
  if(error){err.textContent='Errore: '+error.message;err.classList.remove('hidden');btn.disabled=false;btn.textContent='Salva';return}
  user.password_hash=hashNew;
  user.first_login=false;
  btn.closest('.fixed').remove();
  alert('Password aggiornata!');
}

async function hashPassword(pwd){
  const hashBuffer=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pwd));
  return Array.from(new Uint8Array(hashBuffer)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// ── PRIMO ACCESSO ──
async function checkFirstLogin(){
  if(!user||!user.first_login) return;
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4';
  modal.innerHTML=`
    <div class="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-6">
      <div class="text-center mb-5">
        <div class="text-4xl mb-2">👋</div>
        <h3 class="font-bold text-xl">Benvenuto ${user.name}!</h3>
        <p class="text-sm text-slate-500 mt-1">Choose your language and set your password</p>
      </div>
      <div class="space-y-3">
        <div>
          <label class="text-xs font-semibold text-slate-500 mb-1 block">Language / Lingua / Idioma</label>
          <div class="grid grid-cols-3 gap-2">
            <button type="button" data-fl-lang="it" class="fl-lang-btn py-2 rounded-xl bg-slate-900 text-white text-sm">🇮🇹 IT</button>
            <button type="button" data-fl-lang="es" class="fl-lang-btn py-2 rounded-xl bg-slate-100 text-sm">🇪🇸 ES</button>
            <button type="button" data-fl-lang="en" class="fl-lang-btn py-2 rounded-xl bg-slate-100 text-sm">🇬🇧 EN</button>
          </div>
        </div>
        <div>
          <label class="text-xs font-semibold text-slate-500 mb-1 block">New password</label>
          <input id="fl_pwd" type="password" placeholder="Choose a password" class="w-full px-3 py-2.5 border rounded-xl text-sm">
        </div>
        <div>
          <label class="text-xs font-semibold text-slate-500 mb-1 block">Confirm password</label>
          <input id="fl_pwd2" type="password" placeholder="Repeat password" class="w-full px-3 py-2.5 border rounded-xl text-sm">
        </div>
        <div>
          <label class="text-xs font-semibold text-slate-500 mb-1 block">Date of birth <span class="text-slate-400 font-normal">(optional)</span></label>
          <input id="fl_birth" type="date" class="w-full px-3 py-2.5 border rounded-xl text-sm">
        </div>
        <p id="fl_err" class="text-red-600 text-xs hidden"></p>
      </div>
      <button onclick="saveFirstLogin(this)" class="w-full mt-4 py-3 bg-slate-900 text-white rounded-xl font-semibold">Let's go →</button>
    </div>`;
  document.body.appendChild(modal);
  // gestione selezione lingua nel modale
  document.querySelectorAll('.fl-lang-btn').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('.fl-lang-btn').forEach(x=>{x.classList.remove('bg-slate-900','text-white');x.classList.add('bg-slate-100')});
    b.classList.add('bg-slate-900','text-white');
    b.classList.remove('bg-slate-100');
  });
}

async function saveFirstLogin(btn){
  const pwd=document.getElementById('fl_pwd').value;
  const pwd2=document.getElementById('fl_pwd2').value;
  const birth=document.getElementById('fl_birth').value;
  const err=document.getElementById('fl_err');
  // lingua selezionata
  const selectedLangBtn=document.querySelector('.fl-lang-btn.bg-slate-900');
  const selectedLang=selectedLangBtn?selectedLangBtn.dataset.flLang:(user.lang||'it');
  err.classList.add('hidden');
  if(!pwd||pwd.length<4){err.textContent='Password min 4 characters';err.classList.remove('hidden');return}
  if(pwd!==pwd2){err.textContent='Passwords do not match';err.classList.remove('hidden');return}
  btn.disabled=true; btn.textContent='Saving...';
  const hashNew=await hashPassword(pwd);
  const updates={password_hash:hashNew,first_login:false,lang:selectedLang};
  if(birth) updates.birth_date=birth;
  const{error}=await supa.from('users').update(updates).eq('id',parseInt(user.id));
  if(error){
    err.textContent='Error: '+error.message;
    err.classList.remove('hidden');
    btn.disabled=false;btn.textContent="Let's go →";
    return;
  }
  user.password_hash=hashNew;
  user.first_login=false;
  user.lang=selectedLang;
  if(birth) user.birth_date=birth;
  btn.closest('.fixed').remove();
  // applica lingua scelta
  applyLang();
  // messaggio benvenuto in chat
  await supa.from('messages').insert({
    text:`👋 ${user.name} joined the crew!`,
    user_name:'Sistema',
    lang:'en'
  });
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
            <div class="text-xs text-slate-500">${u.role||'staff'} • ${u.lang||'it'} ${u.default_station?'• '+u.default_station:''}</div>
            ${u.birth_date?`<div class="text-[10px] text-slate-400">🎂 ${new Date(u.birth_date).toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit'})}</div>`:''}
          </div>
          <div class="flex gap-1 flex-shrink-0">
            <button onclick="openEditUser(${u.id})" class="p-1.5 bg-slate-100 rounded-lg text-xs">✏️</button>
            <button onclick="resetUserPassword(${u.id},'${u.name}')" class="p-1.5 bg-amber-100 rounded-lg text-xs">🔑</button>
            <button onclick="toggleUserActive(${u.id},${u.active!==false})" class="p-1.5 ${u.active===false?'bg-green-100':'bg-red-100'} rounded-lg text-xs">${u.active===false?'✅':'🚫'}</button>
          </div>
        </div>`).join('')}
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function openAddUser(){
  const STATIONS=['Oven Station','Pasta Station','Plating Station','Salad Station','Freezer','Chiusura'];
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4';
  modal.innerHTML=`
    <div class="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-5">
      <h3 class="font-bold text-lg mb-4">➕ Nuovo Utente</h3>
      <div class="space-y-3">
        <input id="nu_name" placeholder="Nome" class="w-full px-3 py-2.5 border rounded-xl text-sm">
        <input id="nu_pwd" placeholder="Password temporanea" class="w-full px-3 py-2.5 border rounded-xl text-sm">
        <select id="nu_lang" class="w-full px-3 py-2.5 border rounded-xl text-sm bg-white">
          <option value="it">🇮🇹 Italiano</option>
          <option value="en">🇬🇧 English</option>
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
        <input id="nu_birth" type="date" class="w-full px-3 py-2.5 border rounded-xl text-sm">
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
  const pwd=document.getElementById('nu_pwd').value.trim();
  const lang=document.getElementById('nu_lang').value;
  const role=document.getElementById('nu_role').value;
  const station=document.getElementById('nu_station').value;
  const birth=document.getElementById('nu_birth').value;
  const err=document.getElementById('nu_err');
  err.classList.add('hidden');
  if(!name||!pwd){err.textContent='Nome e password obbligatori';err.classList.remove('hidden');return}
  if(pwd.length<4){err.textContent='Password minimo 4 caratteri';err.classList.remove('hidden');return}
  btn.disabled=true; btn.textContent='Creazione...';
  const hash=await hashPassword(pwd);
  const newUser={name,password_hash:hash,lang,role,active:true,first_login:true};
  if(station) newUser.default_station=station;
  if(birth) newUser.birth_date=birth;
  const{error}=await supa.from('users').insert(newUser);
  if(error){err.textContent='Errore: '+error.message;err.classList.remove('hidden');btn.disabled=false;btn.textContent='Crea';return}
  btn.closest('.fixed').remove();
  // riapri user manager aggiornato
  document.querySelector('.fixed')?.remove();
  openUserManager();
}

async function openEditUser(userId){
  const{data:u}=await supa.from('users').select('*').eq('id',userId).single();
  if(!u) return;
  const STATIONS=['Oven Station','Pasta Station','Plating Station','Salad Station','Freezer','Chiusura'];
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4';
  modal.innerHTML=`
    <div class="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-5">
      <h3 class="font-bold text-lg mb-4">✏️ Modifica ${u.name}</h3>
      <div class="space-y-3">
        <input id="eu_name" placeholder="Nome" class="w-full px-3 py-2.5 border rounded-xl text-sm" value="${u.name||''}">
        <input id="eu_photo" placeholder="URL foto profilo" class="w-full px-3 py-2.5 border rounded-xl text-sm" value="${u.photo_url||''}">
        <select id="eu_lang" class="w-full px-3 py-2.5 border rounded-xl text-sm bg-white">
          <option value="it" ${u.lang==='it'?'selected':''}>🇮🇹 Italiano</option>
          <option value="en" ${u.lang==='en'?'selected':''}>🇬🇧 English</option>
          <option value="es" ${u.lang==='es'?'selected':''}>🇪🇸 Español</option>
        </select>
        <select id="eu_role" class="w-full px-3 py-2.5 border rounded-xl text-sm bg-white">
          <option value="staff" ${u.role==='staff'?'selected':''}>Staff</option>
          <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
        </select>
        <select id="eu_station" class="w-full px-3 py-2.5 border rounded-xl text-sm bg-white">
          <option value="">— Stazione default —</option>
          ${STATIONS.map(s=>`<option value="${s}" ${u.default_station===s?'selected':''}>${s}</option>`).join('')}
        </select>
        <input id="eu_birth" type="date" class="w-full px-3 py-2.5 border rounded-xl text-sm" value="${u.birth_date||''}">
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
  const photo_url=document.getElementById('eu_photo').value.trim();
  const lang=document.getElementById('eu_lang').value;
  const role=document.getElementById('eu_role').value;
  const default_station=document.getElementById('eu_station').value;
  const birth_date=document.getElementById('eu_birth').value;
  const err=document.getElementById('eu_err');
  if(!name){err.textContent='Nome obbligatorio';err.classList.remove('hidden');return}
  btn.disabled=true; btn.textContent='Salvataggio...';
  const updates={name,lang,role};
  if(photo_url) updates.photo_url=photo_url;
  if(default_station) updates.default_station=default_station;
  if(birth_date) updates.birth_date=birth_date;
  const{error}=await supa.from('users').update(updates).eq('id',userId);
  if(error){err.textContent='Errore: '+error.message;err.classList.remove('hidden');btn.disabled=false;btn.textContent='Salva';return}
  btn.closest('.fixed').remove();
  document.querySelector('.fixed')?.remove();
  openUserManager();
}

async function resetUserPassword(userId, userName){
  const newPwd=prompt(`Reset password per ${userName}.\nInserisci nuova password temporanea:`);
  if(!newPwd||newPwd.length<4){alert('Password minimo 4 caratteri');return}
  const hash=await hashPassword(newPwd);
  const{error}=await supa.from('users').update({password_hash:hash,first_login:true}).eq('id',userId);
  if(error){alert('Errore: '+error.message);return}
  alert(`✅ Password di ${userName} resettata a: ${newPwd}\nAl prossimo accesso dovrà cambiarla.`);
}

async function toggleUserActive(userId, currentlyActive){
  const action=currentlyActive?'disattivare':'riattivare';
  if(!confirm(`Vuoi ${action} questo utente?`)) return;
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
    const d=u.birth_date.slice(5); // MM-DD
    return d===`${mm}-${dd}`;
  });
  if(bday.length>0){
    const names=bday.map(u=>u.name).join(', ');
    // mostra banner compleanno
    const bar=document.getElementById('newsBar');
    const scroll=document.getElementById('newsScroll');
    if(scroll) scroll.textContent=`🎂 Oggi è il compleanno di ${names}! Auguri! 🎉`;
    if(bar) bar.classList.remove('hidden');
  }
}
