const CACHE_NAME = 'beaver-lake-v4';
const SHELL_ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js',
];

// Install: cache the app shell
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API calls, cache-first for shell
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // API + tile calls: always try network
  if (url.hostname === 'api.weather.gov' || url.hostname === 'waterservices.usgs.gov'
) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Shell assets: cache-first, fall back to network
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
