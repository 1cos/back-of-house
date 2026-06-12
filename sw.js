const CACHE_NAME = 'boh-v51';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

// ── Network-first per JS/CSS — mai servire vecchi file dalla cache ──
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Solo file JS e CSS del nostro sito
  if (url.hostname === '1cos.github.io' && (url.pathname.endsWith('.js') || url.pathname.endsWith('.css'))) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).catch(() =>
        caches.match(e.request)
      )
    );
    return;
  }
  // Tutto il resto: normale
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
