import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { EMULATOR } from '../../js/config.js';
import { isPlaywrightServiceWorkerBlock } from './network-noise.js';

export function e2eProjectId() {
  return `demo-scoretracker-${process.env.TEST_PARALLEL_INDEX ?? 0}`;
}

// Runs in the Playwright (Node) process; seeds Firestore with rules disabled.
let envPromise = null;

function env() {
  envPromise ??= initializeTestEnvironment({
    projectId: e2eProjectId(),
    firestore: {
      host: EMULATOR.host,
      port: EMULATOR.firestorePort,
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });
  return envPromise;
}

async function admin(fn) {
  const testEnv = await env();
  let result;
  await testEnv.withSecurityRulesDisabled(async context => { result = await fn(context.firestore()); });
  return result;
}

export const seed = (path, data) => admin(db => db.doc(path).set(data));
export const update = (path, data) => admin(db => db.doc(path).update(data));
export const get = path => admin(async db => (await db.doc(path).get()).data());
export const remove = path => admin(db => db.doc(path).delete());

export async function resetAll() {
  // Auth is shared across workers. Deleting accounts would sign out other workers' devices on reload.
  // Anonymous UIDs are unique per browser context, and Auth starts empty on every emulators:exec.
  const testEnv = await env();
  await testEnv.clearFirestore();
}

export async function closeAll() {
  if (!envPromise) return;
  const pending = envPromise;
  envPromise = null;
  await (await pending).cleanup();
}

export const open = (page, hash = '') => page.goto(`/index.html?emulator=1${hash}`);
export const tab = (page, name) => page.getByTestId(`tab-${name}`);
export const cssColour = (locator, property) => locator.evaluate((el, name) => {
  const style = getComputedStyle(el);
  return name.startsWith('--') ? style.getPropertyValue(name).trim() : style[name];
}, property);

export const cssVariableColour = (page, property) => page.evaluate(name => {
  const probe = document.createElement('i');
  probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(name);
  document.body.append(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}, property);

// Normalise browser-serialised colours for contrast measurements.
export const hexOf = (page, colour) => page.evaluate(value => {
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#000000';
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  return `#${[...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(c => c.toString(16).padStart(2, '0')).join('')}`;
}, colour);

export function consoleProblems(page, {
  problems = [],
  consoleTypes = ['error'],
  blocked,
  ignore,
  format = text => `console: ${text}`,
} = {}) {
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  if (consoleTypes.length > 0) page.on('console', message => {
    const type = message.type();
    if (!consoleTypes.includes(type)) return;
    const text = message.text();
    if (isPlaywrightServiceWorkerBlock(text)) return;
    const url = message.location()?.url;
    // Only the browser's resource-load failure for the intercepted URL is expected.
    // An error the app logs about the same file still fails the test.
    if (type === 'error' && blocked?.url && url === blocked.url && /^Failed to load resource/.test(text)) {
      blocked.errors.push(text);
      return;
    }
    if (!ignore?.(text, url)) problems.push(format(text, url));
  });
  return problems;
}

// The live game is reached from the home banner, as a visitor would. For games the tracker created.
export async function openLiveGame(page) {
  await open(page);
  await page.getByTestId('live-banner').click();
  await expect(page.getByTestId('score-us')).toBeVisible();
}

// Records what the home element shows, for transition tests. Two lists, both only while home is visible:
// `pairs` holds each (season, results) the attributes take, caught as they are set, so two renders in one
// task are both seen; `states` holds each (season, results, first result's opponent) the DOM shows once a
// render is done, caught by a MutationObserver. Entries with no season are kept.
export const recordHome = page => page.addInitScript(() => {
  window.__pairs = [];
  window.__states = [];
  const push = (list, entry) => {
    if (JSON.stringify(list.at(-1)) !== JSON.stringify(entry)) list.push(entry);
  };
  const isHome = el => el.dataset?.testid === 'games-list';
  const snapshot = el => {
    if (!el.hidden) push(window.__pairs, { season: el.getAttribute('data-season') ?? '', results: el.getAttribute('data-results') ?? '' });
  };
  const { setAttribute, removeAttribute } = Element.prototype;
  Element.prototype.setAttribute = function set(name, value) {
    setAttribute.call(this, name, value);
    if (isHome(this) && (name === 'data-season' || name === 'data-results')) snapshot(this);
  };
  Element.prototype.removeAttribute = function remove(name) {
    removeAttribute.call(this, name);
    if (isHome(this) && (name === 'data-season' || name === 'data-results')) snapshot(this);
  };
  new MutationObserver(() => {
    const el = document.querySelector('[data-testid="games-list"]');
    if (!el || el.hidden) return;
    const first = document.querySelector('[data-testid="result-row"] .result-opp')?.textContent ?? '';
    push(window.__states, { season: el.getAttribute('data-season') ?? '', results: el.getAttribute('data-results') ?? '', first });
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
});
// Starts the recording over from what home shows now, so a test can judge only what happens after a point
// it has waited for.
export const restartHomeRecord = page => page.evaluate(() => {
  const el = document.querySelector('[data-testid="games-list"]');
  const season = el.getAttribute('data-season') ?? '';
  const results = el.getAttribute('data-results') ?? '';
  const first = document.querySelector('[data-testid="result-row"] .result-opp')?.textContent ?? '';
  window.__pairs.splice(0, window.__pairs.length, { season, results });
  window.__states.splice(0, window.__states.length, { season, results, first });
});
export const recordedHome = async page => ({
  pairs: await page.evaluate(() => window.__pairs),
  states: await page.evaluate(() => window.__states),
});

// Serves a copy of repo.js that tells the page when each snapshot has been delivered AND processed
// (`window.__snaps`), so a test can wait for the viewer to handle one write before making the next.
// `slow` shapes a document's answers: { holdMs, miss } first delivers a cached snapshot (a cache miss when
// `miss`), then the real one after holdMs, and any later snapshot of that path waits behind the held one and
// arrives right after it, in order. { hold: true, miss } does the same for the first server snapshot
// until the test calls window.__releaseHeld(path). { withhold: true } delivers nothing at all for the first
// snapshot of that path (cached or server) until window.__releaseHeld(path), so a view waiting on it stays in
// its loading state. window.__queued counts each snapshot put on hold.
// { cached: true } delivers every snapshot as if from the cache,
// so the server never seems to confirm it (the record still says what the server really sent).
// window.__infoCalls lists the arguments of every repo.updateGameInfo call.
// Needs `test.use({ serviceWorkers: 'block' })`, so the worker cannot serve the real file.
export async function instrumentRepo(page, slow = {}) {
  const real = readFileSync('js/repo.js', 'utf8');
  const call = 'cb(data, { fromCache, hasPendingWrites });';
  if (!real.includes(call)) throw new Error('repo.js changed: update instrumentRepo');
  const infoHead = 'updateGameInfo(gameId, { opponent, date, season, competition, competitionName }) {';
  if (!real.includes(infoHead)) throw new Error('repo.js changed: update instrumentRepo');
  // Records what each updateGameInfo call was given (window.__infoCalls: { gameId, info }), before it is destructured.
  const recorded = real.replace(infoHead, `updateGameInfo(gameId, info) {
      (window.__infoCalls ??= []).push({ gameId, info: { ...info } });
      const { opponent, date, season, competition, competitionName } = info;`);
  const body = recorded.replace(call, `{
      const record = () => (window.__snaps ??= []).push({
        path: ref.path, exists: data !== null, status: data?.status, pointer: data?.currentGameId, fromCache,
      });
      const rule = window.__slow?.[ref.path];
      const seen = (window.__seen ??= new Set());
      const held = (window.__held ??= {});
      const meta = { fromCache: rule?.cached ? true : fromCache, hasPendingWrites };
      const deliver = () => { cb(data, meta); record(); };
      const enqueue = () => {
        (held[ref.path] ??= []).push(deliver);
        const queued = (window.__queued ??= {});
        queued[ref.path] = (queued[ref.path] ?? 0) + 1;
      };
      if (held[ref.path]) {
        // A hold is pending on this path: a later snapshot waits behind it and arrives after it, in order.
        enqueue();
      } else if (rule?.withhold && !seen.has(ref.path)) {
        seen.add(ref.path);
        enqueue();
      } else if ((rule?.holdMs || (rule?.hold && !fromCache)) && !seen.has(ref.path)) {
        seen.add(ref.path);
        enqueue();
        cb(rule.miss ? null : data, { fromCache: true, hasPendingWrites });
        if (rule.holdMs) setTimeout(() => window.__releaseHeld(ref.path), rule.holdMs);
      } else {
        deliver();
      }
    }`);
  await page.addInitScript(rules => {
    window.__slow = rules;
    window.__releaseHeld = path => {
      const queue = window.__held[path];
      delete window.__held[path];
      for (const next of queue) next();
    };
  }, slow);
  await page.route('**/js/repo.js', route => route.fulfill({ contentType: 'text/javascript', body }));
}

// Resolves once a server snapshot of `path` with `field` equal to `value` has been delivered and handled.
export const delivered = (page, path, field, value) => page.waitForFunction(
  ([p, f, v]) => window.__snaps?.some(snap => snap.path === p && snap[f] === v && snap.fromCache === false),
  [path, field, value],
);
