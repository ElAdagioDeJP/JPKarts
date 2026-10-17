// JP Kart PWA worker (M0): cache-first solo para el shell; la red del juego
// (/health, /socket y ws/wss) siempre va a red. Sin cambios en DEPLOY.
const CACHE = 'jpkart-shell-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Red del juego: siempre red (el server es autoritativo; nada de caché).
  if (url.pathname === '/health' || url.pathname === '/socket' || url.pathname.startsWith('/socket')) return;
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return;
  if (e.request.method !== 'GET') return;
  // Solo mismo origen; el resto (CDN, QR) va directo.
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: false }).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('./index.html'));
    }),
  );
});
