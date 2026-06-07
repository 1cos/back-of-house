// ── PUSH ──
async function setupPush(){
  if(!('serviceWorker' in navigator)) return;
  
  // Registra service worker
  const reg = await navigator.serviceWorker.register('./sw.js');
  
  // Su iOS PWA il permesso va richiesto dopo un gesto utente
  // Aspettiamo che il SW sia pronto
  await navigator.serviceWorker.ready;
  
  // Controlla se già ha una subscription valida
  const existingSub = await reg.pushManager.getSubscription();
  if(existingSub){
    // Aggiorna il DB con la subscription esistente
    await supa.from('push_subscriptions').upsert(
      {user_name: user?.name||'Anonimo', subscription: existingSub.toJSON()},
      {onConflict: 'user_name'}
    );
    return;
  }
  
  // Richiedi permesso — su iOS deve essere dopo un gesto utente
  // Mostriamo un banner che invita a cliccare
  if(Notification.permission === 'default'){
    showPushBanner();
    return;
  }
  
  if(Notification.permission !== 'granted') return;
  
  await subscribePush(reg);
}

function showPushBanner(){
  // Banner discreto in basso — chiede di abilitare notifiche
  const existing = document.getElementById('pushBanner');
  if(existing) return;
  
  const banner = document.createElement('div');
  banner.id = 'pushBanner';
  banner.style.cssText = `
    position:fixed;bottom:84px;left:50%;transform:translateX(-50%);
    z-index:50;width:calc(100% - 32px);max-width:400px;
    background:rgba(30,58,95,0.95);backdrop-filter:blur(10px);
    border-radius:16px;padding:12px 16px;
    display:flex;align-items:center;justify-content:space-between;gap:12px;
    box-shadow:0 4px 20px rgba(0,0,0,0.2);
  `;
  banner.innerHTML = `
    <div style="font-size:13px;color:white;line-height:1.4;">
      🔔 <span style="font-weight:500;">Abilita notifiche</span><br>
      <span style="opacity:.75;font-size:11px;">Ricevi messaggi anche con app chiusa</span>
    </div>
    <div style="display:flex;gap:8px;flex-shrink:0;">
      <button onclick="document.getElementById('pushBanner').remove()" 
        style="padding:6px 10px;border-radius:8px;background:rgba(255,255,255,0.15);color:white;font-size:12px;border:none;cursor:pointer;">
        No
      </button>
      <button onclick="enablePushFromBanner()" 
        style="padding:6px 12px;border-radius:8px;background:white;color:#1e3a5f;font-size:12px;font-weight:600;border:none;cursor:pointer;">
        Sì
      </button>
    </div>
  `;
  document.body.appendChild(banner);
  
  // Auto-rimuovi dopo 8 secondi
  setTimeout(() => banner.remove(), 8000);
}

window.enablePushFromBanner = async function(){
  document.getElementById('pushBanner')?.remove();
  
  const p = await Notification.requestPermission();
  if(p !== 'granted') return;
  
  const reg = await navigator.serviceWorker.ready;
  await subscribePush(reg);
};

async function subscribePush(reg){
  try{
    const key = 'BKPndoZsWXaBIyAbk8fA_t_vD1pAdaTf-ii9gTqwYkPKDbEtKEvqOMTs4nWdxa7nREDxt_ld0IwAenLTIUC57zg';
    const applicationServerKey = Uint8Array.from(
      atob(key.replace(/-/g,'+').replace(/_/g,'/')),
      c => c.charCodeAt(0)
    );
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey
    });
    await supa.from('push_subscriptions').upsert(
      {user_name: user?.name||'Anonimo', subscription: sub.toJSON()},
      {onConflict: 'user_name'}
    );
    console.log('Push subscription OK:', user?.name);
  }catch(e){
    console.warn('Push subscribe failed:', e.message);
  }
}
