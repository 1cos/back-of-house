/* Daily Operations Journal — Service Worker
   Scoped to /back-of-house/daily-journal/
   Separate from Brigade sw.js — no conflict */
const CACHE_NAME = 'doj-v0.2';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});
// Pass-through fetch — no offline caching for now (AI calls need network)
self.addEventListener('fetch', e => {});
