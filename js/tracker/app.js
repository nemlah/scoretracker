import { team as teamConfig } from '../config.js';
import { initFirebase, signIn } from '../firebase.js';
import { createJournal } from '../journal.js';
import { createRepo } from '../repo.js';
import { t } from '../strings.js';
import { clear, h } from '../ui/dom.js';
import { createTapper } from './taps.js';
import { createStatsQueue } from './statsQueue.js';
import * as games from './views/games.js';
import * as home from './views/home.js';
import * as live from './views/live.js';
import * as newgame from './views/newgame.js';
import * as roster from './views/roster.js';
import * as unlock from './views/unlock.js';

// Views by first route segment.
const ROUTES = { '': home, roster, new: newgame, live, games };
const TOAST_MS = 5000;

document.documentElement.style.setProperty('--accent', teamConfig.accent);
document.title = t('trackerTitle', { team: teamConfig.name });

function safeStorage() {
  try {
    return globalThis.localStorage ?? unavailableStorage();
  } catch {
    return unavailableStorage();
  }
}

function unavailableStorage() {
  const fail = () => { throw new Error('Storage unavailable'); };
  return { getItem: fail, setItem: fail };
}

const state = {
  uid: null,
  editor: 'unknown', // 'unknown' until the first confirmed snapshot of our own editor document
  active: false,
  online: navigator.onLine,
  team: null,
  control: null,
  failedTaps: [],
  // The game team.currentGameId points at. null until its first snapshot (see gameLoaded).
  game: null,
  gameLoaded: false,
  // True once the server has answered and Firestore has since fallen back to its cache.
  gameOffline: false,
  route: '/',
  notice: null,
};

// Inputs to the derived fields above.
let editorLoaded = false;
let editorDoc = null;
let revoked = false;
let teamLoaded = false;
let controlLoaded = false;
let bootFailed = false;

let repo = null;
let journal = null;
let tapper = null;
let gameUnsub = null;
let watchedGameId = null;
// Event writes the server has not answered yet. While any is in flight a snapshot cannot be
// trusted to say whether a journalled tap reached the server, so reconciling waits for them.
let writesInFlight = 0;
// One record per open game subscription (the app's own, plus a past-game view's), each holding
// its latest { game, meta } snapshot. Every one of them can settle that game's journal entries.
const gameWatches = new Set();
let stats = null;
let wasActive = false;
let current = { slot: null, view: null };
let toastTimer = null;
const unsubscribers = [];

const root = document.getElementById('app');
const backButton = h('button', {
  type: 'button', class: 'btn btn--ghost', 'data-testid': 'nav-home', hidden: true,
  onclick: () => navigate('/'),
}, t('navHome'));
const takeoverBanner = h('div', { class: 'banner banner--takeover', 'data-testid': 'takeover-banner', hidden: true },
  h('p', {}, t('takeoverBanner')),
  h('button', { type: 'button', class: 'btn btn--small', 'data-testid': 'take-over', onclick: () => takeOver() },
    t('takeoverButton')));
const offlineBanner = h('div', { class: 'banner', 'data-testid': 'offline-banner', hidden: true },
  h('p', {}, t('offlineBanner')));
const failedText = h('p', {});
const failedBanner = h('div', { class: 'banner banner--failed', 'data-testid': 'failed-banner', role: 'alert', hidden: true },
  failedText,
  h('span', { class: 'banner-actions' },
    h('button', { type: 'button', class: 'btn btn--small', 'data-write': true, 'data-testid': 'retry-failed', onclick: () => retryFailed() },
      t('retryFailed')),
    h('button', { type: 'button', class: 'btn btn--small', 'data-testid': 'discard-failed', onclick: () => discardFailed() },
      t('discardFailed'))));
const banners = h('div', { class: 'banners' }, takeoverBanner, failedBanner, offlineBanner);
const view = h('main', { class: 'view' });
const toast = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite', 'data-testid': 'toast', hidden: true });
root.append(
  h('header', { class: 'bar' }, h('h1', { class: 'brand' }, teamConfig.name), backButton),
  banners, view, toast,
);

function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, TOAST_MS);
}

function markRevoked() {
  revoked = true;
  state.notice = t('codeChanged');
  render();
}

function onWriteError(err) {
  if (err?.code === 'permission-denied') {
    // Not active: the takeover banner already explains why the write was refused.
    if (state.active) markRevoked();
    return;
  }
  showToast(t('writeFailed'));
}

async function takeOver() {
  if (!state.online) {
    showToast(t('takeoverNeedsConnection'));
    return;
  }
  try {
    await repo.takeOver(state.uid);
  } catch (err) {
    // A refused takeover by a signed-in editor means the code itself is no longer valid.
    if (err?.code === 'permission-denied') markRevoked();
    else onWriteError(err);
  }
}

function parseRoute() {
  const hash = location.hash.replace(/^#/, '');
  return hash.startsWith('/') ? hash : '/';
}

function navigate(route) {
  if (parseRoute() === route) render();
  else location.hash = route;
}

const noDrain = { done: [], failed: [] };
const ctx = {
  repo: null,
  journal: null,
  tapper: null,
  // Seasons whose stats need recounting. Only the active tracker can write them, so draining
  // waits until this device is active; whatever is left stays queued for the next drain.
  stats: {
    markDirty: season => stats?.markDirty(season),
    drain: () => (stats && state.active ? stats.drain() : Promise.resolve(noDrain)),
  },
  navigate,
  getState: () => state,
  onWriteError,
};

function refreshFailed() {
  state.failedTaps = journal && watchedGameId !== null ? journal.failed(watchedGameId) : [];
}

function retryFailed() {
  if (watchedGameId === null) return;
  tapper.retryFailed(watchedGameId);
  // The game stays current after it ends, so a retried change may belong to a final game.
  if (state.game?.id === watchedGameId && state.game.status === 'final') {
    ctx.stats.markDirty(state.game.season);
    ctx.stats.drain();
  }
  refreshFailed();
  render();
}

function discardFailed() {
  if (watchedGameId === null) return;
  tapper.discardFailed(watchedGameId);
  refreshFailed();
  render();
}

function isConfirmed(meta) {
  return !meta.fromCache && !meta.hasPendingWrites;
}

function reconcileWatch(watch) {
  const last = watch.last;
  if (!journal || !last?.game || !isConfirmed(last.meta)) return;
  if (writesInFlight > 0) return;
  journal.reconcile(watch.gameId, last.game.events ?? []);
  refreshFailed();
}

function reconcileLast() {
  for (const watch of gameWatches) reconcileWatch(watch);
}

// Counts event writes in flight, then reconciles again once the last one has settled.
function trackWrite(write) {
  return (...args) => {
    writesInFlight += 1;
    let promise;
    try {
      promise = Promise.resolve(write(...args));
    } catch (err) {
      promise = Promise.reject(err);
    }
    const settle = () => {
      writesInFlight -= 1;
      if (writesInFlight === 0) {
        reconcileLast();
        render();
      }
    };
    promise.then(settle, settle);
    return promise;
  };
}

// repo.watchGame plus the journal: a server-confirmed snapshot settles every pending journal
// entry of this game (confirmed, or failed if the server does not have it).
function watchGameWithJournal(gameId, cb) {
  const watch = { gameId, last: null };
  gameWatches.add(watch);
  const off = repo.watchGame(gameId, (game, meta) => {
    watch.last = { game, meta };
    reconcileWatch(watch);
    cb(game, meta);
  });
  return () => {
    gameWatches.delete(watch);
    off();
  };
}
ctx.watchGame = watchGameWithJournal;

let serverSeen = false;
let gameWatchReady = false; // false until the watched game has been chosen since (re)subscribing

function syncGameWatch() {
  if (!repo || unsubscribers.length === 0 || !teamLoaded) return;
  const wanted = state.team?.currentGameId ?? null;
  if (gameWatchReady && wanted === watchedGameId && (wanted === null || gameUnsub)) return;
  gameWatchReady = true;
  gameUnsub?.();
  gameUnsub = null;
  watchedGameId = wanted;
  serverSeen = false;
  state.game = null;
  state.gameLoaded = wanted === null;
  state.gameOffline = false;
  refreshFailed();
  if (wanted === null) return;
  gameUnsub = watchGameWithJournal(wanted, (game, meta) => {
    if (!meta.fromCache) serverSeen = true;
    state.game = game;
    state.gameLoaded = true;
    state.gameOffline = serverSeen && meta.fromCache;
    refreshFailed();
    render();
  });
}

function derive() {
  state.route = parseRoute();
  state.editor = editorDoc && !revoked ? 'valid' : editorLoaded ? 'none' : 'unknown';
  state.active = state.editor === 'valid' && state.control?.activeUid === state.uid;
  // Boot, and taking over from another device, are both moments to catch up on stats recounts.
  if (state.active && !wasActive) ctx.stats.drain();
  wasActive = state.active;
}

function pickSlot() {
  if (bootFailed) return { slot: 'error', view: statusView(t('trackerUnavailable')) };
  if (state.uid === null || state.editor === 'unknown') return { slot: 'loading', view: statusView(t('trackerLoading')) };
  if (state.editor === 'none') return { slot: 'unlock', view: unlock };
  if (!teamLoaded || !controlLoaded) return { slot: 'loading', view: statusView(t('trackerLoading')) };
  const key = state.route.split('/')[1] ?? '';
  if (!Object.hasOwn(ROUTES, key)) {
    location.replace('#/');
    return { slot: 'home', view: home };
  }
  return { slot: key || 'home', view: ROUTES[key] ?? home };
}

function statusView(text) {
  return {
    mount(el) {
      el.append(h('p', { class: 'status-line' }, text));
      return { update() {}, unmount() {} };
    },
  };
}

function render() {
  syncGameWatch();
  derive();
  const next = pickSlot();
  if (next.slot !== current.slot) {
    current.view?.unmount();
    clear(view);
    current = { slot: next.slot, view: next.view.mount(view, ctx) };
  }
  current.view.update(state);
  syncChrome();
}

function syncChrome() {
  const inRoute = current.slot !== 'unlock' && current.slot !== 'loading' && current.slot !== 'error';
  const readOnly = inRoute && !state.active;
  backButton.hidden = !inRoute || current.slot === 'home';
  takeoverBanner.hidden = !readOnly;
  offlineBanner.hidden = state.online || current.slot === 'unlock';
  failedBanner.hidden = !inRoute || state.failedTaps.length === 0;
  if (state.failedTaps.length > 0) {
    failedText.textContent = state.failedTaps.length === 1
      ? t('tapNotSaved') : t('tapsNotSaved', { n: state.failedTaps.length });
  }
  root.classList.toggle('is-readonly', readOnly);
  applyReadOnly();
}

// Write controls stay in the DOM but are disabled while this device is not the active tracker.
function applyReadOnly() {
  const readOnly = root.classList.contains('is-readonly');
  for (const control of root.querySelectorAll('[data-write]')) control.disabled = readOnly;
}

new MutationObserver(applyReadOnly).observe(view, { childList: true, subtree: true });

function unsubscribeAll() {
  for (const off of unsubscribers) off();
  unsubscribers.length = 0;
  gameUnsub?.();
  gameUnsub = null;
  watchedGameId = null;
  gameWatchReady = false;
}

async function boot() {
  try {
    const { db, auth } = initFirebase();
    repo = createRepo(db);
    journal = createJournal(safeStorage());
    stats = createStatsQueue(safeStorage(), season => repo.recomputeSeason(season));
    // Unlocking also clears any "code changed" state, whichever view asked for it.
    ctx.repo = {
      ...repo,
      addEvent: trackWrite(repo.addEvent),
      removeEvent: trackWrite(repo.removeEvent),
      replaceEvent: trackWrite(repo.replaceEvent),
      async unlock(uid, code) {
        await repo.unlock(uid, code);
        revoked = false;
        state.notice = null;
        render();
      },
    };
    ctx.journal = journal;
    tapper = createTapper({
      repo: ctx.repo,
      journal,
      getGame: () => state.game,
      isActive: () => state.active,
      onError: onWriteError,
    });
    ctx.tapper = tapper;
    state.uid = await signIn(auth);
  } catch (err) {
    console.warn('Tracker failed to start', err);
    bootFailed = true;
    render();
    return;
  }
  subscribe();
  render();
}

// Our three watchers. Dropped on pagehide and re-attached on pageshow so a page restored from
// the back/forward cache does not keep acting on stale ownership and roster state.
function subscribe() {
  if (unsubscribers.length > 0) return;
  unsubscribers.push(
    repo.watchOwnEditor(state.uid, (doc, meta) => {
      // An unconfirmed local write (e.g. a code the server may still reject) must not unlock the UI.
      if (meta.hasPendingWrites) return;
      editorDoc = doc;
      editorLoaded = true;
      render();
    }),
    repo.watchControl(doc => { state.control = doc; controlLoaded = true; render(); }),
    repo.watchTeam(doc => { state.team = doc; teamLoaded = true; render(); }),
  );
  syncGameWatch();
}

window.addEventListener('hashchange', render);
window.addEventListener('online', () => { state.online = true; ctx.stats.drain(); render(); });
window.addEventListener('offline', () => { state.online = false; render(); });
window.addEventListener('pagehide', unsubscribeAll);
window.addEventListener('pageshow', () => {
  if (state.uid !== null) subscribe();
});

render();
boot();
