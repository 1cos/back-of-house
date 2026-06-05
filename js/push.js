// ── PUSH ──
async function setupPush(){
  if(!('serviceWorker'in navigator))return;
  const reg=await navigator.serviceWorker.register('./sw.js');
  const p=await Notification.requestPermission();
  if(p!=='granted')return;
  const key='BL2L-Q7TvbpWQbnUxt-n7MDB552hadn3Ggp2y1Cj8Nq6EVo0v4Fv2Ufy61mDgF6AFtK7NLV0QjwjndXXBpc';
  const applicationServerKey=Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey});
  await supa.from('push_subscriptions').upsert({user_name:user?.name||'Anonimo',subscription:sub.toJSON()},{onConflict:'user_name'});
}