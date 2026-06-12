// ABUZ8 mobile companion · Service Worker
// Caches the app shell so it installs to the home screen and opens instantly.
// API calls (/api/*) always go to the network — never cached.
const CACHE = 'abuz8-mobile-v2';
const SHELL = ['/m', '/manifest.json'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Never cache API, health, TTS/STT — always live.
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') return;
  // App shell: network-first, fall back to cache (so it opens offline).
  if (e.request.mode === 'navigate' || e.request.destination === 'document' || url.pathname === '/m') {
    e.respondWith(
      fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put('/m', copy)); return r; })
        .catch(() => caches.match('/m'))
    );
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
