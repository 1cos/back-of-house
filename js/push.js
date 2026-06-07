// ── PUSH ──
async function setupPush(){
  if(!('serviceWorker'in navigator))return;
  const reg=await navigator.serviceWorker.register('./sw.js');
  const p=await Notification.requestPermission();
  if(p!=='granted')return;
  const key='BKPndoZsWXaBIyAbk8fA_t_vD1pAdaTf-ii9gTqwYkPKDbEtKEvqOMTs4nWdxa7nREDxt_ld0IwAenLTIUC57zg';
  const applicationServerKey=Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey});
  await supa.from('push_subscriptions').upsert({user_name:user?.name||'Anonimo',subscription:sub.toJSON()},{onConflict:'user_name'});
}