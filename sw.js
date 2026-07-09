const CACHE_NAME = 'boh-v614';
// ↑ Incrementa questo questo numero ad ogni deploy — es. v31, v32...
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
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Non intercettare — passa tutto al network
  // (strategia: sempre fresh, nessuna cache offline)
});
