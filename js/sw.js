const CACHE_NAME = 'boh-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
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
