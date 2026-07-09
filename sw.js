const CACHE_NAME = 'boh-v616';
// ↑ Incrementa questo questo numero ad ogni deploy — es. v31, v32...
// Il browser vede la versione diversa e aggiorna automaticamente

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Non intercettare — sempre fresh
});
