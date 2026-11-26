const CACHE_NAME = 'jetlag-sydney-v11';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './assets/icon.svg',
  './css/styles.css?v=11',
  './data/sydney-network.js',
  './data/challenges.js?v=11',
  './js/icons.js?v=11',
  './js/state.js?v=11',
  './js/modes.js?v=11',
  './js/map.js?v=11',
  './js/wheel.js?v=11',
  './js/multiplayer.js?v=11',
  './js/app.js?v=11'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== 'jetlag-tiles-v1').map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never intercept localhost dev traffic
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return;

  // Cache map tiles opportunistically for Sydney tunnel resilience
  const isTile =
    url.hostname.includes('tile.openstreetmap.org') ||
    url.hostname.includes('arcgisonline.com');

  if (isTile) {
    event.respondWith(
      caches.open('jetlag-tiles-v1').then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.ok) cache.put(req, fresh.clone());
          return fresh;
        } catch {
          return cached || new Response('', { status: 504 });
        }
      })
    );
    return;
  }

  // Strict network-first (bypassing HTTP cache) for app assets so GitHub Pages updates appear immediately, falling back to cache offline
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
  }
});
