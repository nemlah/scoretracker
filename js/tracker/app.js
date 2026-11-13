import { team as teamConfig } from '../config.js';
import { initFirebase, signIn } from '../firebase.js';
import { createJournal } from '../journal.js';
import { createRepo } from '../repo.js';
import { t } from '../strings.js';
import { clear, h } from '../ui/dom.js';
import * as home from './views/home.js';
import * as roster from './views/roster.js';
import * as unlock from './views/unlock.js';

// Views by first route segment. Later tasks register '/new', '/live' and '/games' here.
const ROUTES = { '': home, roster };
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
const banners = h('div', { class: 'banners' }, takeoverBanner, offlineBanner);
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

const ctx = {
  repo: null,
  journal: null,
  navigate,
  getState: () => state,
  onWriteError,
};

function derive() {
  state.route = parseRoute();
  state.editor = editorDoc && !revoked ? 'valid' : editorLoaded ? 'none' : 'unknown';
  state.active = state.editor === 'valid' && state.control?.activeUid === state.uid;
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
  root.classList.toggle('is-readonly', readOnly);
  applyReadOnly();
}

// Write controls stay in the DOM but are disabled while this device is not the active tracker.
function applyReadOnly() {
  const readOnly = root.classList.contains('is-readonly');
  for (const control of view.querySelectorAll('[data-write]')) control.disabled = readOnly;
}

new MutationObserver(applyReadOnly).observe(view, { childList: true, subtree: true });

function unsubscribeAll() {
  for (const off of unsubscribers) off();
  unsubscribers.length = 0;
}

async function boot() {
  try {
    const { db, auth } = initFirebase();
    repo = createRepo(db);
    journal = createJournal(safeStorage());
    // Unlocking also clears any "code changed" state, whichever view asked for it.
    ctx.repo = {
      ...repo,
      async unlock(uid, code) {
        await repo.unlock(uid, code);
        revoked = false;
        state.notice = null;
        render();
      },
    };
    ctx.journal = journal;
    state.uid = await signIn(auth);
  } catch (err) {
    console.warn('Tracker failed to start', err);
    bootFailed = true;
    render();
    return;
  }
  unsubscribeAll();
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
  render();
}

window.addEventListener('hashchange', render);
window.addEventListener('online', () => { state.online = true; render(); });
window.addEventListener('offline', () => { state.online = false; render(); });
window.addEventListener('pagehide', unsubscribeAll);

render();
boot();
