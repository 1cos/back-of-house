const CACHE_NAME = 'boh-v796';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== 'boh-v796').map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// Network-first, cache-fallback (HOTFIX T2E.2): previously cache-first, which
// meant a resource fetched once under a cache name was served from cache for
// the rest of that generation, no matter how many times the underlying file
// changed server-side afterward. Network-first guarantees fresh code whenever
// the network is actually reachable; cache is only a fallback for offline use.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.open(CACHE_NAME).then(c => c.match(e.request)))
  );
});
