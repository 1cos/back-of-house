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
  // verifica password attuale
  const hashCurrent=await hashPassword(current);
  if(hashCurrent!==user.password_hash){err.textContent='Password attuale errata';err.classList.remove('hidden');return}
  btn.disabled=true; btn.textContent='Salvataggio...';
  const hashNew=await hashPassword(newPwd);
  const{error}=await supa.from('users').update({password_hash:hashNew}).eq('id',user.id);
  if(error){err.textContent='Errore: '+error.message;err.classList.remove('hidden');btn.disabled=false;btn.textContent='Salva';return}
  user.password_hash=hashNew;
  btn.closest('.fixed').remove();
  alert('Password aggiornata!');
}

async function hashPassword(pwd){
  const hashBuffer=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pwd));
  return Array.from(new Uint8Array(hashBuffer)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

