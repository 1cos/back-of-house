const CACHE_NAME = 'boh-v389';
// ↑ Incrementa questo numero ad ogni deploy — es. v31, v32...
// Il browser vede la versione diversa e aggiorna automaticamente

self.addEventListener('install', e => {
  self.skipWaiting(); // attiva subito senza aspettare che le tab si chiudano
});

self.addEventListener('activate', e => {
  // Cancella tutte le cache vecchie
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => clients.claim()) // prendi controllo di tutte le tab aperte
  );
});

self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  const title = data.title || 'Back of House';
  const body = data.body || '';
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/back-of-house/icon-192.png',
      badge: '/back-of-house/icon-192.png',
      vibrate: [100, 50, 100],
      data: { url: '/back-of-house/' }
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.openWindow(e.notification.data?.url || '/back-of-house/')
  );
});

