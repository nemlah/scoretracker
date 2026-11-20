import '../sw-register.js';
import { team as teamConfig } from '../config.js';
import { initFirebase, signIn } from '../firebase.js';
import { createJournal } from '../journal.js';
import { formatDate } from '../model.js';
import { createRepo } from '../repo.js';
import { eventLabel, t } from '../strings.js';
import { clear, h } from '../ui/dom.js';
import { createWriteErrorHandler } from './ownership.js';
import * as ownership from './ownership.js';
import { createRecovery } from './recovery.js';
import { createStatsQueue } from './statsQueue.js';
import { createTapper } from './taps.js';
import * as games from './views/games.js';
import * as home from './views/home.js';
import * as live from './views/live.js';
import * as newgame from './views/newgame.js';
import * as roster from './views/roster.js';
import * as unlock from './views/unlock.js';

// Views by first route segment.
const ROUTES = { '': home, roster, new: newgame, live, games };
const TOAST_MS = 5000;
// A write that is still unanswered after this long is shown as "not synced yet"; the usual
// round trip is well under it, so an ordinary tap does not flash the offline text.
const PENDING_GRACE_MS = 2000;

document.documentElement.style.setProperty('--accent', teamConfig.accent);
import('../accent.js').then(accent => accent.applyAccentPair(document.documentElement.style, teamConfig.accent)).catch(() => {});
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
  // True while the current game is live, or not loaded yet: control then moves only through the
  // banner's Take over button.
  gameLive: true,
  // Whether this device's controls are enabled: in control, or able to take control by itself
  // on the first touch (valid editor, online, no live game, everything on screen confirmed by the
  // server, nothing waiting to be saved).
  writable: false,
  // True while the team, control and current game on screen each come from a server snapshot
  // (not just the local cache) and the page has not been in the background since.
  confirmed: false,
  online: navigator.onLine,
  // True once any snapshot has come from the server (not just the local cache) since the page opened.
  synced: false,
  // True when writes have waited for the server longer than PENDING_GRACE_MS.
  pendingWrites: false,
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
// Whether the latest snapshot of each listener came from the server (meta.fromCache === false).
// A cold open shows the cache first, and a page back from the background holds listeners that
// went stale; neither says who holds control or whether a game is live.
let teamConfirmed = false;
let controlConfirmed = false;
let gameConfirmed = false;
// Counts trips to the background, so a server read started before one cannot confirm after it.
let backgrounds = 0;
let bootFailed = false;
// The default route is replaced by the live screen on the first load only.
let landingChecked = false;

let repo = null;
let journal = null;
let tapper = null;
let recovery = null;
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
let repairPending = false;
let couldReconcile = false;
let current = { slot: null, view: null };
let toastTimer = null;
const unsubscribers = [];

const root = document.getElementById('app');
const backButton = h('button', {
  type: 'button', class: 'btn btn--ghost', 'data-testid': 'nav-home', hidden: true,
  onclick: () => navigate('/'),
}, t('navHome'));
const takeoverBanner = h('div', {
  class: 'banner banner--takeover banner--moved', 'data-testid': 'takeover-banner', role: 'alert', hidden: true,
},
  h('p', { class: 'takeover-copy' },
    h('strong', { 'data-testid': 'takeover-title' }, t('takeoverBanner')), ' ',
    h('span', { class: 'takeover-paused', 'data-testid': 'takeover-paused' }, t('takeoverPaused'))),
  h('button', { type: 'button', class: 'btn btn--small', 'data-testid': 'take-over', onclick: () => takeOver() },
    t('takeoverButton')));
const offlineBanner = h('div', { class: 'banner', 'data-testid': 'offline-banner', hidden: true },
  h('p', {}, t('offlineBanner')));
// One row per game with unsaved taps, whichever game is on screen.
const failedList = h('ul', { class: 'failed-list' });
const failedBanner = h('div', { class: 'banner banner--failed banner--unsaved', 'data-testid': 'failed-banner', role: 'alert', hidden: true },
  failedList);
const failedRows = new Map();
const banners = h('div', { class: 'banners' }, takeoverBanner, failedBanner, offlineBanner);
const view = h('main', { class: 'view' });
const toast = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite', 'data-testid': 'toast', hidden: true });
const crest = teamConfig.crest ? h('img', {
  class: 'bar-crest', 'data-testid': 'tracker-crest', width: 32, height: 32, alt: '',
  onerror: event => { event.currentTarget.hidden = true; },
  src: teamConfig.crest,
}) : null;
root.append(
  h('header', { class: 'bar bar--team' },
    h('div', { class: 'bar-brand' }, crest, h('h1', { class: 'brand' }, teamConfig.name)),
    backButton),
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

// A refused write only means "code revoked" once the server confirms this device still holds control.
const onWriteError = createWriteErrorHandler({
  getState: () => state,
  readControl: () => repo.readControlFromServer(),
  onRevoked: markRevoked,
  onFailure: () => showToast(t('writeFailed')),
});

// Resolves true once the takeover write was accepted.
async function takeOver() {
  if (!state.online) {
    showToast(t('takeoverNeedsConnection'));
    return false;
  }
  try {
    await repo.takeOver(state.uid);
    return true;
  } catch (err) {
    // A refused takeover by a signed-in editor means the code itself is no longer valid.
    if (err?.code === 'permission-denied') markRevoked();
    else onWriteError(err);
    return false;
  }
}

// createControlClaim was added after the previous release. A phone can briefly hold that release's
// cached ownership.js beside this file; without it snapshots simply apply unmasked.
const claim = ownership.createControlClaim?.() ?? unmaskedClaim();
function unmaskedClaim() {
  let busy = false;
  return {
    get active() { return busy; },
    begin(uid, control) { busy = true; return { ...(control ?? {}), activeUid: uid }; },
    receive: doc => doc,
    end() { busy = false; },
  };
}
// Keys that do nothing in the tracker by themselves, or are shortcuts of the browser or system
// (Cmd+Tab, Cmd+R): they must not move control.
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS']);

// With no live game, the first touch or key press on a device not in control takes control, so
// the change it starts is saved normally. The takeover write is issued synchronously, before the
// click or key press does its own write: the rules refuse writes from a device not in control.
// state.writable says the screen is trustworthy: confirmed by the server, online, no game live.
function claimControl(event) {
  if (event.type === 'keydown' && (MODIFIER_KEYS.has(event.key) || event.ctrlKey || event.metaKey || event.altKey)) return;
  if (claim.active || state.active || !state.writable || !isInRoute()) return;
  const done = takeOver();
  // Shown as in control at once, so the click that follows passes its guards. Control snapshots
  // that were already on their way (old holder) are held off until the write settles.
  state.control = claim.begin(state.uid, state.control);
  done.then(succeeded => {
    const restore = claim.end(succeeded);
    if (restore !== undefined) {
      state.control = restore;
      render();
    }
  });
  render();
}
root.addEventListener('pointerdown', claimControl, true);
root.addEventListener('keydown', claimControl, true);

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
  state.failedTaps = journal ? journal.failed() : [];
}

function failedGroups() {
  const groups = new Map();
  for (const entry of state.failedTaps) {
    const group = groups.get(entry.gameId) ?? { count: 0, gone: false, events: [], more: 0 };
    group.count += 1;
    group.gone ||= entry.gone === true;
    if (group.events.length < 2) group.events.push(entry.event);
    else group.more += 1;
    groups.set(entry.gameId, group);
  }
  return groups;
}

async function retryGame(gameId) {
  const outcome = await recovery.retry(gameId);
  if (outcome === 'gone') showToast(t('retryGameGone'));
  else if (outcome === 'unavailable') showToast(t('retryNeedsConnection'));
  refreshFailed();
  render();
}

function discardGame(gameId) {
  recovery.discard(gameId);
}

function failedIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(ns, 'svg');
  const attrs = {
    class: 'failed-icon', 'data-testid': 'failed-icon', 'aria-hidden': 'true',
    width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  };
  for (const [name, value] of Object.entries(attrs)) icon.setAttribute(name, value);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M12 9v4M12 17h.01M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z');
  icon.append(path);
  return icon;
}

function failedRow(gameId) {
  const title = h('span', { 'data-testid': 'failed-title' });
  const titleCopy = h('span', {}, title, ' ');
  const desc = h('p', { class: 'failed-desc', 'data-testid': 'failed-desc', hidden: true });
  const gone = h('span', { 'data-testid': 'failed-gone' }, t('failedGameGone'));
  const link = h('a', { href: `#/games/${encodeURIComponent(gameId)}`, 'data-testid': 'failed-game-link' }, t('failedGameLink'));
  let note = null;
  const element = h('li', { class: 'failed-row', 'data-testid': 'failed-row', 'data-game-id': gameId },
    h('p', { class: 'failed-title' }, failedIcon(), titleCopy),
    desc,
    h('span', { class: 'banner-actions' },
      h('button', {
        type: 'button', class: 'btn btn--small', 'data-write': true, 'data-testid': 'retry-failed',
        onclick: () => retryGame(gameId),
      }, t('retryFailed')),
      h('button', {
        type: 'button', class: 'btn btn--small', 'data-testid': 'discard-failed',
        onclick: () => discardGame(gameId),
      }, t('discardFailed'))));

  function update(group) {
    const heading = group.count === 1 ? t('tapNotSaved') : t('tapsNotSaved', { n: group.count });
    if (title.textContent !== heading) title.textContent = heading;

    const game = !group.gone && state.game?.id === gameId ? state.game : null;
    const nextNote = group.gone ? gone : game ? null : link;
    if (note !== nextNote) {
      note?.remove();
      if (nextNote) titleCopy.append(nextNote);
      note = nextNote;
    }

    let description = '';
    if (game) {
      const datePrefix = typeof game.date === 'string' && game.date ? `${formatDate(game.date)} · ` : '';
      const labels = group.events.map(event => eventLabel(event, game.lineup ?? []));
      const more = group.more > 0 ? ` ${t('failedMore', { n: group.more })}` : '';
      description = `${datePrefix}${game.opponent}: ${labels.join(', ')}${more}`;
    }
    if (desc.textContent !== description) desc.textContent = description;
    const hideDescription = !game;
    if (desc.hidden !== hideDescription) desc.hidden = hideDescription;
  }
  return { element, update };
}

function renderFailed() {
  const groups = failedGroups();
  for (const [id, row] of failedRows) {
    if (groups.has(id)) continue;
    row.element.remove();
    failedRows.delete(id);
  }
  // A game snapshot can change the description between pointerdown and click.
  // Keep the existing controls and only insert or move rows when the group order changes.
  let next = failedList.firstElementChild;
  for (const [id, group] of groups) {
    let row = failedRows.get(id);
    if (!row) {
      row = failedRow(id);
      failedRows.set(id, row);
    }
    row.update(group);
    if (row.element !== next) failedList.insertBefore(row.element, next);
    next = row.element.nextElementSibling;
  }
}

function isConfirmed(meta) {
  return !meta.fromCache && !meta.hasPendingWrites;
}

function reconcileWatch(watch) {
  const last = watch.last;
  if (!journal || !last || !isConfirmed(last.meta) || writesInFlight > 0) return;
  // The server answered and the game is not there (deleted, or its creation was refused).
  if (last.game === null) journal.markGone(watch.gameId);
  else journal.reconcile(watch.gameId, last.game.events ?? []);
  refreshFailed();
}

function reconcileLast() {
  for (const watch of gameWatches) reconcileWatch(watch);
}

// Counts event writes in flight, then reconciles again once the last one has settled.
function trackWrite(write) {
  return (...args) => {
    writesInFlight += 1;
    syncPending();
    let promise;
    try {
      promise = Promise.resolve(write(...args));
    } catch (err) {
      promise = Promise.reject(err);
    }
    const settle = () => {
      writesInFlight -= 1;
      syncPending();
      if (writesInFlight === 0) {
        reconcileLast();
        reconcileOrphans();
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

// Whether writes are waiting for the server: ours in flight, or the game snapshot says so. The
// flag only turns on after PENDING_GRACE_MS, so a normal round trip never flashes the offline text.
let gamePending = false;
let pendingTimer = null;

function syncPending() {
  const waiting = writesInFlight > 0 || gamePending;
  if (!waiting) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
    state.pendingWrites = false;
  } else if (!state.pendingWrites && pendingTimer === null) {
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      if (writesInFlight > 0 || gamePending) {
        state.pendingWrites = true;
        render();
      }
    }, PENDING_GRACE_MS);
  }
}

function noteServer(meta) {
  if (!meta.fromCache) state.synced = true;
}

// Games with unsaved taps that no open watch covers are checked against the server once.
function reconcileOrphans() {
  if (!recovery || !state.online || state.editor !== 'valid') return;
  recovery.reconcileOrphans();
}

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
  gameConfirmed = false;
  state.game = null;
  state.gameLoaded = wanted === null;
  state.gameOffline = false;
  gamePending = false;
  syncPending();
  refreshFailed();
  reconcileOrphans();
  if (wanted === null) return;
  gameUnsub = watchGameWithJournal(wanted, (game, meta) => {
    if (!meta.fromCache) serverSeen = true;
    gameConfirmed = !meta.fromCache;
    noteServer(meta);
    state.game = game;
    state.gameLoaded = true;
    state.gameOffline = serverSeen && meta.fromCache;
    gamePending = meta.hasPendingWrites;
    syncPending();
    refreshFailed();
    render();
  });
}

function derive() {
  state.route = parseRoute();
  state.editor = editorDoc && !revoked ? 'valid' : editorLoaded ? 'none' : 'unknown';
  state.active = state.editor === 'valid' && state.control?.activeUid === state.uid;
  // A current game that has not loaded yet counts as live, so nothing is taken over blindly.
  state.gameLive = !state.gameLoaded || state.game?.status === 'live';
  state.confirmed = teamConfirmed && controlConfirmed && (watchedGameId === null || gameConfirmed);
  // Not in control, the first touch may take control only on a screen that can be trusted: no
  // game live, the server has confirmed every piece of it, and no write is waiting for the server.
  state.writable = state.active
    || (state.editor === 'valid' && teamLoaded && controlLoaded && state.online && !state.gameLive
      && state.confirmed && !state.pendingWrites && !state.gameOffline);
  // Boot, unlocking and taking over from another device are all moments to catch up on stats
  // recounts. The device that held control before may have left a recount unfinished, and its
  // dirty marker lives only in its own storage, so the current game's season is recounted too.
  if (state.active && !wasActive) {
    repairPending = true;
    ctx.stats.drain();
  }
  wasActive = state.active;
  if (state.active && repairPending && state.gameLoaded) {
    repairPending = false;
    if (state.game?.season) ctx.stats.markDirty(state.game.season);
    ctx.stats.drain();
  }
  const canReconcile = state.online && state.editor === 'valid';
  if (canReconcile && !couldReconcile) reconcileOrphans();
  couldReconcile = canReconcile;
}

function pickSlot() {
  if (bootFailed) return { slot: 'error', view: statusView(t('trackerUnavailable')) };
  if (state.uid === null || state.editor === 'unknown') return { slot: 'loading', view: statusView(t('trackerLoading')) };
  if (state.editor === 'none') return { slot: 'unlock', view: unlock };
  if (!teamLoaded || !controlLoaded) return { slot: 'loading', view: statusView(t('trackerLoading')) };
  // Opening the tracker (bookmark, home-screen icon) resumes a live game instead of showing Home.
  if (!landingChecked) {
    // Only a bare address counts: an explicit #/ is a deliberate visit to Home.
    if (location.hash !== '' && location.hash !== '#') landingChecked = true;
    else if (state.gameLoaded) {
      landingChecked = true;
      if (state.game?.status === 'live') {
        location.replace('#/live');
        state.route = '/live';
      }
    }
  }
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

function isInRoute() {
  return current.slot !== null && current.slot !== 'unlock' && current.slot !== 'loading' && current.slot !== 'error';
}

function syncChrome() {
  const inRoute = isInRoute();
  // Not in control: read-only unless the first input can take control (see state.writable).
  const readOnly = inRoute && !state.active && !state.writable;
  backButton.hidden = !inRoute || current.slot === 'home';
  takeoverBanner.hidden = !readOnly;
  offlineBanner.hidden = state.online || current.slot === 'unlock';
  failedBanner.hidden = !inRoute || state.failedTaps.length === 0;
  renderFailed();
  root.classList.toggle('is-readonly', readOnly);
  applyReadOnly();
}

// Write controls stay in the DOM but are disabled while this device is not the active tracker.
function applyReadOnly() {
  const readOnly = root.classList.contains('is-readonly');
  for (const control of root.querySelectorAll('[data-write]')) control.disabled = readOnly;
}

new MutationObserver(applyReadOnly).observe(view, { childList: true, subtree: true });

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
    recovery = createRecovery({
      repo, journal, tapper, stats: ctx.stats,
      watchedIds: () => new Set([...gameWatches].map(watch => watch.gameId)),
      // A snapshot the server confirmed; anything else is read from the server when it matters.
      snapshotOf: gameId => {
        const watch = [...gameWatches].find(entry => entry.gameId === gameId && entry.last && isConfirmed(entry.last.meta));
        return watch ? watch.last.game : undefined;
      },
      onChange() { refreshFailed(); render(); },
    });
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

// Our three watchers; the game watcher follows team.currentGameId (see syncGameWatch).
function subscribe() {
  if (unsubscribers.length > 0) return;
  unsubscribers.push(
    repo.watchOwnEditor(state.uid, (doc, meta) => {
      // An unconfirmed local write (e.g. a code the server may still reject) must not unlock the UI.
      if (meta.hasPendingWrites) return;
      noteServer(meta);
      editorDoc = doc;
      editorLoaded = true;
      render();
    }),
    repo.watchControl((doc, meta) => {
      noteServer(meta);
      controlConfirmed = !meta.fromCache;
      state.control = claim.receive(doc);
      controlLoaded = true;
      render();
    }),
    repo.watchTeam((doc, meta) => {
      noteServer(meta);
      teamConfirmed = !meta.fromCache;
      state.team = doc;
      teamLoaded = true;
      render();
    }),
  );
  syncGameWatch();
}

// Back from the background the listeners may be stale until the connection is re-established, so
// nothing on screen counts as confirmed until the server says so. repo.confirmFromServer was
// added after the previous release; a phone can hold that release's repo.js beside this file, in
// which case the mark is simply cleared (the behaviour before it existed).
async function reconfirm() {
  if (!repo) return;
  const trip = backgrounds;
  const read = repo.confirmFromServer?.();
  if (!read) {
    teamConfirmed = true;
    controlConfirmed = true;
    gameConfirmed = true;
    render();
    return;
  }
  let fresh;
  try {
    fresh = await read;
  } catch {
    return; // Stays unconfirmed until a server snapshot arrives or the page is shown again.
  }
  if (trip !== backgrounds) return;
  state.team = fresh.team;
  state.control = claim.receive(fresh.control);
  teamConfirmed = true;
  controlConfirmed = true;
  // The game follows the team's pointer; a pointer that moved is picked up by the next render,
  // and the new game's own snapshot then confirms it. A game that changed is left to its listener.
  if (watchedGameId === (fresh.team?.currentGameId ?? null) && state.gameLoaded && fresh.game?.status === state.game?.status) {
    gameConfirmed = true;
  }
  render();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    backgrounds += 1;
    teamConfirmed = false;
    controlConfirmed = false;
    gameConfirmed = false;
    render();
  } else if (document.visibilityState === 'visible') {
    reconfirm();
  }
});

window.addEventListener('hashchange', render);
window.addEventListener('online', () => { state.online = true; ctx.stats.drain(); render(); });
window.addEventListener('offline', () => { state.online = false; render(); });
// A page restored from the back/forward cache holds a Firestore client that shut itself down
// when the page was hidden. Reloading is the only reliable way back; the service worker serves
// the shell offline and the journal and the SDK's persisted writes survive the reload.
window.addEventListener('pageshow', event => {
  if (event.persisted) location.reload();
});

render();
boot();
