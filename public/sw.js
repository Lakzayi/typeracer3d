/* TypeRacer 3D service worker — offline support + fresh-after-deploy.
 *
 * - navigations (HTML): network-first — the page shell is ~12 KB, so every
 *   visit checks the server and a deploy is seen immediately
 * - other static assets: stale-while-revalidate — served instantly from the
 *   cache, then revalidated with cache:'no-cache' in the background. With the
 *   server's ETags an unchanged file costs a ~300 B 304; only genuinely
 *   changed files come back with a body. When bytes actually changed the page
 *   gets a TR3D_UPDATED message and reloads itself when idle (no hard refresh).
 * - /api/* always hits the network (real TypeRacer data must never be stale).
 */
const CACHE = 'tr3d-v1';
const ASSETS = [
  './', './index.html', './style.css', './manifest.webmanifest', './favicon.svg',
  './vendor/three.module.js', './fonts/inter-var.woff2',
  './js/main.js', './js/api.js', './js/race.js', './js/typing.js', './js/world.js',
  './js/hud.js', './js/sound.js', './js/demo-data.js', './js/modes.js', './js/drills.js', './js/stats.js',
  './js/ghost.js', './js/daily.js', './js/achievements.js', './js/paints.js',
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

/* revalidate one asset; notify pages when the bytes actually changed */
function revalidate(request, cache) {
  return fetch(request, { cache: 'no-cache' })
    .then(async (res) => {
      if (!res || !res.ok) return; // offline / 304-without-body: keep what we have
      const old = await cache.match(request);
      const changed = !old ||
        (await old.clone().arrayBuffer()).byteLength !== (await res.clone().arrayBuffer()).byteLength;
      await cache.put(request, res);
      if (changed) {
        const clients = await self.clients.matchAll({ includeUncontrolled: true });
        clients.forEach((c) => c.postMessage('TR3D_UPDATED'));
      }
    })
    .catch(() => {}); // offline: cached copy stays authoritative
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return; // cross-origin: browser handles it
  if (url.pathname.startsWith('/api/')) return; // live data only, never cached

  // page shell — always fresh from the network, cached copy for offline
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request, { cache: 'no-cache' });
        if (res && res.ok) {
          const cache = await caches.open(CACHE);
          cache.put('./index.html', res.clone());
        }
        return res;
      } catch (err) {
        const cache = await caches.open(CACHE);
        return (await cache.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // static assets — instant from cache, quietly refreshed in the background
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request);
    if (cached) {
      e.waitUntil(revalidate(e.request, cache));
      return cached;
    }
    // first sighting: go to the network, then keep it
    try {
      const res = await fetch(e.request, { cache: 'no-cache' });
      if (res && res.ok) await cache.put(e.request, res.clone());
      return res || Response.error();
    } catch (err) {
      return Response.error();
    }
  })());
});
