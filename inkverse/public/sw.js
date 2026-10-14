// Minimal PWA service worker: cache the app shell, network-first for API, cache-first for generated/uploaded images.
const SHELL = 'iv-shell-v3', IMG = 'iv-img-v1', OFFLINE = 'iv-offline';   // OFFLINE holds chapters the reader saved on purpose
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(['/', '/css/styles.css', '/js/app.js', '/js/reader.js', '/js/studio.js', '/js/pages.js', '/icon.svg'])).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => ![SHELL, IMG, OFFLINE].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url); if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.startsWith('/api/')) return; // never cache authenticated/dynamic data
  if (u.pathname.startsWith('/gen/') || u.pathname.startsWith('/uploads/')) {
    e.respondWith(caches.open(IMG).then(async c => (await c.match(e.request)) || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }))); return;
  }
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('/'))));
});
