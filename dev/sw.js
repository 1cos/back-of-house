// BR-FIX02: la copia /dev/ e' ritirata. Chi aveva registrato questo service worker lo riceve aggiornato:
// cancella la cache boh-dev, si disinstalla e non intercetta piu' nessuna richiesta.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('boh-dev')).map(k => caches.delete(k))))
      .then(() => self.registration.unregister())
  );
});
