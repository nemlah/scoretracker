// Offline app shell. Classic script: service workers are not loaded as modules here.
// The Cache Storage is shared by every site on the origin (GitHub Pages project sites included),
// so the name carries this worker's scope and cleanup only ever touches caches of this scope.
const CACHE = `wp-shell-v1::${self.registration.scope}`;

// SHELL-START
const SHELL = [
  './',
  './index.html',
  './track.html',
  './css/base.css',
  './css/tracker.css',
  './css/viewer.css',
  './js/celebrate.js',
  './js/config.js',
  './js/firebase.js',
  './js/journal.js',
  './js/model.js',
  './js/goalWatch.js',
  './js/repo.js',
  './js/situations.js',
  './js/strings.js',
  './js/sw-register.js',
  './js/viewer.js',
  './js/tracker/app.js',
  './js/tracker/ownership.js',
  './js/tracker/recount.js',
  './js/tracker/recovery.js',
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

// Same-origin files are fetched with `reload`, bypassing the HTTP cache: GitHub Pages sends
// max-age=600, and a shell filled from a stale HTTP-cached copy would pair old modules with new
// ones (an import that no longer links). The pinned SDK URLs never change under one URL, so they
// are fetched as they are; forcing them to the network made the offline viewer test flaky.
const fresh = url => (url.startsWith('./') ? new Request(url, { cache: 'reload' }) : url);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL.map(fresh))));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE && key.startsWith('wp-shell-') && key.endsWith(`::${self.registration.scope}`)) {
        await caches.delete(key);
      }
    }
    await self.clients.claim();
  })());
});

// Opaque responses (cross-origin stylesheets and fonts loaded without CORS) are cacheable too.
const storable = response => response.ok || response.type === 'opaque';
// An upstream error must not replace a usable cached copy. Redirects are not errors.
const failed = response => response.type === 'error' || response.status >= 400;

// Same-origin entries are keyed without the query string, so a refreshed `track.html?emulator=1`
// replaces the pre-cached `track.html` instead of sitting beside it. (Cache-first URLs keep
// theirs: the Google Fonts CSS URL is defined by its query.)
function cacheKey(request) {
  const url = new URL(request.url);
  url.search = '';
  return url.href;
}

// Storage can fail (quota, private mode). That must never fail the request: log and go on.
async function store(cache, key, copy) {
  try {
    await cache.put(key, copy);
  } catch (err) {
    console.warn('Service worker could not cache', typeof key === 'string' ? key : key.url, err);
  }
}

// Signal bars but no data is the normal state at a pool deck: a request that has not answered
// by then, or that answered with an error, is served from the cache when there is a copy. A slow
// request carries on in the background, and the worker stays alive until its copy is stored.
async function networkFirst(event) {
  const { request } = event;
  const cache = await caches.open(CACHE);
  const cachedCopy = () => cache.match(cacheKey(request), { ignoreSearch: true });
  let persisted = Promise.resolve();
  const network = fetch(request).then(response => {
    slowUntil = 0;
    if (storable(response) && !failed(response)) persisted = store(cache, cacheKey(request), response.clone());
    return response;
  });
  event.waitUntil(network.then(() => persisted, () => {}));
  let timer;
  const wait = Date.now() < slowUntil ? 0 : NETWORK_TIMEOUT_MS;
  const timeout = new Promise(resolve => { timer = setTimeout(resolve, wait, null); });
  try {
    const first = await Promise.race([network, timeout]);
    if (first && !failed(first)) return first;
    const cached = await cachedCopy();
    if (first) return cached ?? first;
    if (cached) {
      slowUntil = Date.now() + SLOW_NETWORK_MS;
      return cached;
    }
    // Nothing cached: keep waiting for the network, whatever it answers.
    return await network;
  } catch (err) {
    const cached = await cachedCopy();
    if (cached) return cached;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// The Google Fonts stylesheet blocks rendering. If it was never stored and the network does not
// answer in time, the page gets an empty stylesheet (system fonts) instead of a blank screen.
const FONT_CSS_PREFIX = 'https://fonts.googleapis.com/';

async function cacheFirst(event) {
  const { request } = event;
  let cache = null;
  try {
    cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
  } catch (err) {
    console.warn('Service worker cache unavailable', err);
  }
  let persisted = Promise.resolve();
  const network = fetch(request).then(response => {
    if (cache && storable(response) && !failed(response)) persisted = store(cache, request, response.clone());
    return response;
  });
  // A slow answer is still stored for next time; the worker stays alive until then.
  event.waitUntil(network.then(() => persisted, () => {}));
  if (!request.url.startsWith(FONT_CSS_PREFIX)) return network;
  let timer;
  const timeout = new Promise(resolve => { timer = setTimeout(resolve, NETWORK_TIMEOUT_MS, null); });
  try {
    return (await Promise.race([network, timeout]))
      ?? new Response('', { status: 200, headers: { 'Content-Type': 'text/css' } });
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (CACHE_FIRST_PREFIXES.some(prefix => request.url.startsWith(prefix))) {
    event.respondWith(cacheFirst(event));
  } else if (new URL(request.url).origin === self.location.origin) {
    event.respondWith(networkFirst(event));
  }
  // Anything else (Firestore, Auth) goes straight to the network.
});
