import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://pool.example';
const SCOPE = `${ORIGIN}/`;
const CACHE_NAME = `wp-shell-v1::${SCOPE}`;
const keyOf = (input, ignoreSearch) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (ignoreSearch) url.search = '';
  return url.href;
};

// Runs sw.js against in-memory stand-ins for the worker globals.
function boot({ fetchImpl, putImpl, scope = SCOPE, cacheNames = [] } = {}) {
  const store = new Map();
  const opened = [];
  const deleted = [];
  const warnings = [];
  const listeners = {};
  const cache = {
    put: async (key, response) => { await putImpl?.(key, response); store.set(keyOf(key), response); },
    match: async (key, options = {}) => {
      for (const [url, response] of store) {
        if (url === keyOf(key, options.ignoreSearch) || (options.ignoreSearch && keyOf(url, true) === keyOf(key, true))) {
          return response.clone();
        }
      }
      return undefined;
    },
    addAll: async () => {},
  };
  const sandbox = {
    self: {
      addEventListener: (type, fn) => { listeners[type] = fn; },
      location: { origin: ORIGIN },
      registration: { scope },
      clients: { claim: async () => {} },
    },
    caches: {
      open: async name => { opened.push(name); return cache; },
      keys: async () => cacheNames,
      delete: async name => { deleted.push(name); return true; },
    },
    fetch: (...args) => fetchImpl(...args),
    console: { warn: (...args) => warnings.push(args.join(' ')), error: () => {} },
    URL, Response, Promise, Date, setTimeout, clearTimeout,
  };
  vm.runInNewContext(source, sandbox);

  async function dispatch(url) {
    const waits = [];
    let responded;
    listeners.fetch({
      request: { url, method: 'GET' },
      respondWith: promise => { responded = promise; },
      waitUntil: promise => { waits.push(promise); },
    });
    assert.ok(responded, `${url} is intercepted`);
    return { response: responded, settled: () => Promise.all(waits) };
  }
  async function activate() {
    const waits = [];
    listeners.activate({ waitUntil: promise => waits.push(promise) });
    await Promise.all(waits);
  }
  return { dispatch, activate, store, warnings, opened, deleted };
}

const page = `${ORIGIN}/track.html`;

test('a fast 503 is replaced by the cached copy and never cached', async () => {
  const sw = boot({ fetchImpl: async () => new Response('down', { status: 503 }) });
  sw.store.set(page, new Response('cached shell'));
  const { response, settled } = await sw.dispatch(`${page}?emulator=1`);
  assert.equal(await (await response).text(), 'cached shell');
  await settled();
  assert.equal(await sw.store.get(page).text(), 'cached shell');
});

test('a 404 with nothing cached is returned as it is', async () => {
  const sw = boot({ fetchImpl: async () => new Response('missing', { status: 404 }) });
  const { response, settled } = await sw.dispatch(`${ORIGIN}/js/other.js`);
  const result = await response;
  assert.equal(result.status, 404);
  assert.equal(await result.text(), 'missing');
  await settled();
  assert.equal(sw.store.size, 0);
});

test('a good response is returned and replaces the entry under the query-free key', async () => {
  const sw = boot({ fetchImpl: async () => new Response('fresh shell') });
  sw.store.set(page, new Response('old shell'));
  const { response, settled } = await sw.dispatch(`${page}?emulator=1`);
  assert.equal(await (await response).text(), 'fresh shell');
  await settled();
  assert.equal(await sw.store.get(page).text(), 'fresh shell');
  assert.equal(sw.store.size, 1);
});

test('the worker stays alive until the copy is stored, and a failed write is logged, not thrown', async () => {
  let finishWrite;
  const sw = boot({
    fetchImpl: async () => new Response('fresh shell'),
    putImpl: () => new Promise((resolve, reject) => { finishWrite = reject; }),
  });
  const { response, settled } = await sw.dispatch(page);
  assert.equal(await (await response).text(), 'fresh shell');
  let done = false;
  settled().then(() => { done = true; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(done, false, 'waitUntil still pending while the cache write is running');
  finishWrite(new Error('quota'));
  await settled();
  assert.equal(sw.warnings.length, 1);
  assert.match(sw.warnings[0], /could not cache/);
});

test('a cache write failure does not fail an SDK or font fetch', async () => {
  const sw = boot({
    fetchImpl: async () => new Response('sdk code'),
    putImpl: async () => { throw new Error('quota'); },
  });
  for (const url of ['https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js', 'https://fonts.gstatic.com/s/fira.woff2']) {
    const { response, settled } = await sw.dispatch(url);
    assert.equal(await (await response).text(), 'sdk code');
    await settled();
  }
  assert.equal(sw.warnings.length, 2);
});

test('cache-first keeps the query of font CSS URLs and serves from the cache next time', async () => {
  let fetched = 0;
  const sw = boot({ fetchImpl: async () => { fetched += 1; return new Response('css'); } });
  const url = 'https://fonts.googleapis.com/css2?family=Fira+Sans';
  const first = await sw.dispatch(url);
  await first.response;
  await first.settled();
  assert.ok(sw.store.has(url));
  const { response } = await sw.dispatch(url);
  assert.equal(await (await response).text(), 'css');
  assert.equal(fetched, 1);
});

test('the shell cache is named after the worker scope, so sibling sites keep their own', async () => {
  const sw = boot({ fetchImpl: async () => new Response('x') });
  await (await sw.dispatch(page)).response;
  assert.deepEqual([...new Set(sw.opened)], [CACHE_NAME]);
  const project = boot({ scope: `${ORIGIN}/scoretracker/`, fetchImpl: async () => new Response('x') });
  await (await project.dispatch(page)).response;
  assert.deepEqual([...new Set(project.opened)], [`wp-shell-v1::${ORIGIN}/scoretracker/`]);
});

test('activation deletes only this scope\'s obsolete shell caches', async () => {
  const sw = boot({
    cacheNames: [
      CACHE_NAME,
      `wp-shell-v0::${SCOPE}`, // an older version of this app: removed
      `wp-shell-v1::${ORIGIN}/sibling/`, // another project on the same origin
      'wp-shell-v1', // legacy unscoped name: not provably ours
      'sibling-app-cache', // an unrelated cache
      `other-prefix-v1::${SCOPE}`, // not a shell cache
    ],
  });
  await sw.activate();
  assert.deepEqual(sw.deleted, [`wp-shell-v0::${SCOPE}`]);
});

test('a font stylesheet that is not cached and does not answer in time becomes an empty stylesheet', async () => {
  let release;
  const sw = boot({
    fetchImpl: () => new Promise(resolve => { release = resolve; }),
  });
  const url = 'https://fonts.googleapis.com/css2?family=Fira+Sans';
  const { response, settled } = await sw.dispatch(url);
  const result = await response;
  assert.equal(result.status, 200);
  assert.match(result.headers.get('content-type'), /^text\/css/);
  assert.equal(await result.text(), '');
  assert.equal(sw.store.has(url), false, 'the placeholder is not cached');
  // The real answer, when it arrives, is stored for next time.
  release(new Response('real css', { headers: { 'content-type': 'text/css' } }));
  await settled();
  assert.equal(await sw.store.get(url).text(), 'real css');
});

test('a font stylesheet that answers in time is returned as it is', async () => {
  const sw = boot({ fetchImpl: async () => new Response('real css') });
  const { response, settled } = await sw.dispatch('https://fonts.googleapis.com/css2?family=Fira+Sans');
  assert.equal(await (await response).text(), 'real css');
  await settled();
});
