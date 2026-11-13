// Offline app shell. Classic script: service workers are not loaded as modules here.
const CACHE = 'wp-shell-v1';

// SHELL-START
const SHELL = [
  './',
  './index.html',
  './track.html',
  './css/base.css',
  './css/tracker.css',
  './css/viewer.css',
  './js/config.js',
  './js/firebase.js',
  './js/journal.js',
  './js/model.js',
  './js/repo.js',
  './js/strings.js',
  './js/sw-register.js',
  './js/viewer.js',
  './js/tracker/app.js',
  './js/tracker/recount.js',
  './js/tracker/statsQueue.js',
  './js/tracker/taps.js',
  './js/tracker/views/events.js',
  './js/tracker/views/games.js',
  './js/tracker/views/home.js',
  './js/tracker/views/live.js',
  './js/tracker/views/lineup.js',
  './js/tracker/views/newgame.js',
  './js/tracker/views/roster.js',
  './js/tracker/views/unlock.js',
  './js/ui/confirm.js',
  './js/ui/dom.js',
  './js/ui/overlay.js',
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js',
];
// SHELL-END

// Longest a same-origin request may take before the cached copy is served instead.
const NETWORK_TIMEOUT_MS = 3000;
// A page loads in a chain (html, then the modules each module imports). Once one request has
// timed out, the rest of the chain is served from the cache straight away for this long instead
// of waiting out the timeout again at every level. A request that succeeds ends this early.
const SLOW_NETWORK_MS = 20000;
let slowUntil = 0;

// Pinned SDK files and the Google Fonts CSS and font files never change under one URL, so they
// are served from the cache first and stored on their first use.
const CACHE_FIRST_PREFIXES = [
  'https://www.gstatic.com/firebasejs/',
  'https://fonts.googleapis.com/',
  'https://fonts.gstatic.com/',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// Opaque responses (cross-origin stylesheets and fonts loaded without CORS) are cacheable too.
const storable = response => response.ok || response.type === 'opaque';

// Signal bars but no data is the normal state at a pool deck: a request that has not answered
// by then is served from the cache while it carries on in the background.
async function networkFirst(event) {
  const { request } = event;
  const cache = await caches.open(CACHE);
  const cachedCopy = () => cache.match(request, { ignoreSearch: true });
  const network = fetch(request).then(response => {
    slowUntil = 0;
    if (storable(response)) cache.put(request, response.clone()).catch(() => {});
    return response;
  });
  let timer;
  const wait = Date.now() < slowUntil ? 0 : NETWORK_TIMEOUT_MS;
  const timeout = new Promise(resolve => { timer = setTimeout(resolve, wait, null); });
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
    const cached = await cachedCopy();
    if (cached) {
      slowUntil = Date.now() + SLOW_NETWORK_MS;
      // Let the slow request finish, so a success still refreshes the cache entry.
      event.waitUntil(network.catch(() => {}));
      return cached;
    }
    return await network;
  } catch (err) {
    const cached = await cachedCopy();
    if (cached) return cached;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (storable(response)) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (CACHE_FIRST_PREFIXES.some(prefix => request.url.startsWith(prefix))) {
    event.respondWith(cacheFirst(request));
  } else if (new URL(request.url).origin === self.location.origin) {
    event.respondWith(networkFirst(event));
  }
  // Anything else (Firestore, Auth) goes straight to the network.
});
