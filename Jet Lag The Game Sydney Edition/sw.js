const CACHE_NAME = 'jetlag-sydney-v2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './assets/icon.svg',
  './css/styles.css',
  './data/sydney-network.js',
  './data/challenges.js',
  './js/state.js',
  './js/modes.js',
  './js/map.js',
  './js/wheel.js',
  './js/multiplayer.js',
  './js/app.js'
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

  // Network-first for app assets so GitHub Pages updates appear immediately, fallback to cache in tunnels
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
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
