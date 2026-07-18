const CACHE_NAME = 'boh-v703';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== 'boh-v703').map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => { if(e.request.method !== 'GET') return; e.respondWith(caches.open(CACHE_NAME).then(c => c.match(e.request).then(r => r || fetch(e.request).then(res => { if(res && res.status === 200 && res.type === 'basic') { const clone = res.clone(); c.put(e.request, clone); } return res; })))); });


