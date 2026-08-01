/* ============================================================
   FORGE — service worker
   ⚠️ BUMP `VERSION` EVERY SINGLE TIME YOU DEPLOY A CHANGE.
      If you don't, your iPhone will keep serving the old files
      and you will lose an hour wondering why nothing updated.
   ============================================================ */

const VERSION = 'v13';
const CACHE   = `forge-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './app.css',
  './store.js',
  './calc.js',
  './food.js',
  './train.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

/* ---------- install: pre-cache the shell ---------- */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

/* ---------- activate: delete old versions ---------- */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('forge-') && k !== CACHE)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ---------- fetch ---------- */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Cross-origin (e.g. the Open Food Facts API in Phase 3):
  // don't touch it — let it hit the network normally.
  if (url.origin !== self.location.origin) return;

  // Page loads: try network so you get fresh HTML, fall back to cache offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Everything else: cache-first (instant), refresh cache in the background.
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

/* ---------- allow the page to trigger an immediate update ---------- */
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
