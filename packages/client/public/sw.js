// JP Kart PWA worker. Navegación y manifest: red primero (así un deploy nuevo se ve al abrir; sin red, el último shell).
// Solo los assets con hash (/assets/*) van cache-first: son inmutables. La red del juego (/health, ws/wss) nunca se toca.
const CACHE = 'jpkart-shell-v2';
const SHELL = ['./', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const put = (req, res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); } return res; };

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname === '/health') return;
  if (url.pathname.includes('/assets/')) {
    // hashed: cache-first, and only keep a response that is really the asset (never an HTML fallback)
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => (res.ok && !(res.headers.get('content-type') || '').includes('text/html') ? put(req, res) : res))));
    return;
  }
  // shell (index, manifest, icons, sw): network-first with the cached copy as offline fallback
  e.respondWith(fetch(req).then((res) => put(req, res)).catch(() => caches.match(req).then((hit) => hit || caches.match('./'))));
});
