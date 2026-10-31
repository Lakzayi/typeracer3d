/* TypeRacer 3D service worker — makes the installed app work offline.
 * Static assets: stale-while-revalidate. /api/* always hits the network
 * (real TypeRacer data must never be served stale). */
const CACHE = 'tr3d-v1';
const ASSETS = [
  './', './index.html', './style.css', './manifest.webmanifest', './favicon.svg',
  './vendor/three.module.js', './fonts/inter-var.woff2',
  './js/main.js', './js/api.js', './js/race.js', './js/typing.js', './js/world.js',
  './js/hud.js', './js/sound.js', './js/demo-data.js',
  './js/themes/index.js', './js/themes/shared.js',
  './js/themes/car.js', './js/themes/boat.js', './js/themes/horse.js', './js/themes/rocket.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return; // live data only

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request);
    const refresh = fetch(e.request)
      .then((res) => { if (res && res.ok) cache.put(e.request, res.clone()); return res; })
      .catch(() => null);
    return cached || (await refresh) || cache.match('./index.html');
  })());
});
