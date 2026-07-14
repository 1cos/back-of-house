/* Daily Operations Journal — Service Worker v2
   Scoped to /back-of-house/daily-journal/
   Separate from Brigade sw.js — no conflict.
   Cache name bumped to doj-v2.0 to force fresh fetch of journal-ai.js v2. */
const CACHE_NAME = 'doj-v2.0';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});
// Pass-through fetch — no offline caching (AI calls must reach the network)
self.addEventListener('fetch', e => {});
