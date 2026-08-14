// Minimal app-shell service worker -- what makes "Add to Home Screen"
// actually install as a standalone app (Chrome/Android's install criteria
// require a manifest with icons *and* a controlling service worker with a
// fetch handler), and as a side effect makes the shell load offline too.
// This app's real content (the word deck, conjugation engine) is already
// bundled into bundle.js rather than fetched at runtime, and progress lives
// in IndexedDB -- so caching just the shell files below is everything the
// board needs to keep working offline.
//
// The cache name below gets a build id spliced into it at build time (see
// scripts/build.mjs) so this file's bytes change on every build, which is
// what makes the browser notice there's a new service worker to install and
// old caches to drop -- a static name here would never trigger an update.
const CACHE_NAME = 'vocab-matcher-__BUILD_ID__';
const SHELL_FILES = [
  '.',
  'index.html',
  'bundle.js',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate: serve instantly from cache when we have it (so a
// repeat visit, online or off, never blocks on the network), while always
// refreshing the cache in the background so the next visit picks up
// whatever changed.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
