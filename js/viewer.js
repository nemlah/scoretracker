import './sw-register.js';
import { team as teamConfig } from './config.js';
import { initFirebase } from './firebase.js';
import {
  deriveScore, formatDate, foulOutIds, hasShootout, playerLines, resultOutcome, scoringLines,
  seasonFor, timelineRows, todayIso, viewerState,
} from './model.js';
import { goalieStats, savePct } from './goalies.js';
import { createRepo } from './repo.js';
import { manUpGoalIds, replaySituations } from './situations.js';
import {
  periodLabel, scoreText, t, timelineEntry,
} from './strings.js';
import { clear, h } from './ui/dom.js';

const STALE_MS = 6000;

document.documentElement.style.setProperty('--accent', teamConfig.accent);
import('./accent.js').then(accent => accent.applyAccentPair(document.documentElement.style, teamConfig.accent)).catch(() => {});
document.title = t('viewerTitle', { team: teamConfig.name });

// Its own app name keeps the viewer's Firestore cache apart from the tracker's (see firebase.js).
// A phone still holding the previous firebase.js ignores the name and shares the cache as before.
const repo = createRepo(initFirebase({ name: 'viewer' }).db);
const root = document.getElementById('app');

// Every watch stores { key, data, meta }: data undefined = no snapshot yet, null = document absent. A failed
// watch (an error callback, a subscribe that threw, or no first snapshot in time) stores data null with
// meta.error, which is never read as a confirmed absence. `viewerState` decides from these what to watch
// and what to show.
const state = {
  team: { key: 'main', data: undefined, meta: null },
  game: { key: null, data: undefined, meta: null }, // the routed game
  live: { key: null, data: undefined, meta: null }, // the current game, for the banner
  stats: { key: null, data: undefined, meta: null }, // the home season's results
  offline: !navigator.onLine,
  teamView: null, // js/teamView.js, once it has loaded
  teamViewStatus: 'pending', // 'pending' | 'ready' | 'failed': a string, so it survives JSON.stringify
  icons: null, // js/icons.js, once it has loaded
  iconsStatus: 'pending', // as teamViewStatus
};

// The celebration is optional and loaded off the critical path: if either module fails to load
// (a mixed old/new cache), the viewer renders without it.
let celebration = null;
let goals = null;
let celebratingId = null; // the game whose goal is being celebrated
(async () => {
  try {
    const [{ createCelebration }, { createGoalWatcher }] = await Promise.all([
      import('./celebrate.js'), import('./goalWatch.js'),
    ]);
    // Mounted on the body: the game sections are rebuilt on every change and would wipe it mid-animation.
    celebration = createCelebration(document.body);
    goals = createGoalWatcher();
    // Loaded after the first snapshot: take the baseline now so the goals already shown are not "new".
    if (state.game.data) goals.next(state.game.data, state.game.meta ?? {});
  } catch (err) {
    console.warn('Goal celebration unavailable', err);
  }
})();

// The Team panels are optional and loaded off the critical path, once. Until the module is in the panel is
// empty; if it fails to load (a mixed old/new cache, a lost connection) the panel says so and the rest of the
// viewer is unaffected.
import('./teamView.js').then(module => {
  state.teamView = module;
  state.teamViewStatus = 'ready';
  update();
}, err => {
  console.warn('Team stats unavailable', err);
  state.teamViewStatus = 'failed';
  update();
});

// The timeline's stroke icons are optional too: until icons.js is in, or if it never loads, the rows show their
// glyph strings instead.
import('./icons.js').then(module => {
  state.icons = module;
  state.iconsStatus = 'ready';
  update();
}, err => {
  console.warn('Timeline icons unavailable', err);
  state.iconsStatus = 'failed';
  update();
});

// '#/game/<id>' opens that game; every other hash, '#/games' included, is home, the current season. A
// game route whose id could not be a Firestore document id is 'invalid' ('/' can never be an id): it is
// shown as unavailable and never reaches Firestore.
function validDocId(id) {
  return id !== '' && !id.includes('/') && id !== '.' && id !== '..'
    && !/^__.*__$/.test(id) && new TextEncoder().encode(id).length <= 1500;
}

function parseRoute(hash) {
  const match = /^#\/game\/(.*)$/.exec(hash);
  if (!match) return { kind: 'home' };
  try {
    const id = decodeURIComponent(match[1]);
    return validDocId(id) ? { kind: 'game', id } : { kind: 'invalid' };
  } catch {
    return { kind: 'invalid' };
  }
}

// Subscriptions keyed by what they watch. A token tells a replaced subscription's late callbacks apart.
const subs = {
  team: { key: null, off: null, token: 0, deadline: null, stale: false, staleTimer: null },
  game: { key: null, off: null, token: 0, deadline: null, stale: false, staleTimer: null },
  live: { key: null, off: null, token: 0, deadline: null, stale: false, staleTimer: null },
  stats: { key: null, off: null, token: 0, deadline: null, stale: false, staleTimer: null },
};
const openers = {
  team: (key, next, fail) => repo.watchTeam(next, fail),
  game: (key, next, fail) => repo.watchGame(key, next, fail),
  live: (key, next, fail) => repo.watchGame(key, next, fail),
  stats: (key, next, fail) => repo.watchStats(key, next, fail),
};
let lastToken = 0;
let lastSeason = null; // the home season last published
let lastShown = null; // what the last render showed
let updating = false;
let updateAgain = false;

// A watch is stale when it has waited STALE_MS for a server answer. That belongs to the watch's own key:
// replacing a watch (a new season, a new game) starts it afresh, and one watch's silence is not another's.
const isStale = () => Object.values(subs).some(sub => sub.stale);
const isOffline = () => state.offline || isStale();

// Replaces a watch: drops the old subscription, forgets its data and, for a key, subscribes. Returns
// nothing; a subscribe that throws leaves the watch in its error state.
function startWatch(name, key) {
  const sub = subs[name];
  sub.off?.();
  clearTimeout(sub.deadline);
  clearTimeout(sub.staleTimer);
  const token = ++lastToken;
  Object.assign(sub, { key, off: null, token, deadline: null, stale: false, staleTimer: null });
  state[name] = { key, data: undefined, meta: null };
  if (key === null) return;
  const store = (data, meta) => {
    if (sub.token !== token) return;
    clearTimeout(sub.deadline);
    state[name] = { key, data, meta };
    update();
  };
  const fail = err => {
    console.warn(`Could not watch ${name}`, err);
    store(null, { error: true });
  };
  try {
    sub.off = openers[name](key, store, fail);
  } catch (err) {
    // A subscription that cannot start must not stop the rest of the viewer.
    console.warn(`Could not watch ${name}`, err);
    state[name] = { key, data: null, meta: { error: true } };
    return;
  }
  // A watch that never answers is a failed watch, so nothing waits for it forever. A later snapshot
  // replaces the error.
  sub.deadline = setTimeout(() => {
    if (sub.token !== token || state[name].data !== undefined) return;
    state[name] = { key, data: null, meta: { error: true } };
    update();
  }, STALE_MS);
}

// Makes the watches match the plan. True when any changed, which changes what the plan should say.
function applyWatches(want) {
  let changed = false;
  for (const name of ['game', 'live', 'stats']) {
    if (subs[name].key === want[name]) continue;
    startWatch(name, want[name]);
    changed = true;
  }
  return changed;
}

// A watch that has waited STALE_MS for the server carries `meta.stale` into the plan, so only its own cache
// miss counts as absence. `offline` in the plan is the browser's own state.
const withStale = name => {
  const watch = state[name];
  return subs[name].stale ? { ...watch, meta: { ...watch.meta, stale: true } } : watch;
};

function planFor(route) {
  return viewerState({
    route,
    team: withStale('team'),
    game: withStale('game'),
    live: withStale('live'),
    stats: withStale('stats'),
    offline: state.offline,
    calendarSeason: seasonFor(todayIso()),
    lastSeason,
    lastShown,
  });
}

// Each watch the plan tracks and has no server answer for yet runs its own stale timer; a watch that
// is answered, replaced or no longer tracked loses its stale status. True when a status was cleared,
// which can change the plan.
function syncStale(plan) {
  let cleared = false;
  for (const name of ['team', 'game', 'live', 'stats']) {
    const sub = subs[name];
    const watch = state[name];
    const awaiting = plan.tracked[name] && sub.key !== null
      && (watch.data === undefined || watch.meta?.fromCache === true || watch.meta?.error === true);
    if (awaiting) {
      if (!sub.stale && sub.staleTimer === null) {
        const { token } = sub;
        sub.staleTimer = setTimeout(() => {
          if (sub.token !== token) return;
          sub.staleTimer = null;
          sub.stale = true;
          update();
        }, STALE_MS);
      }
    } else {
      clearTimeout(sub.staleTimer);
      sub.staleTimer = null;
      if (sub.stale) {
        sub.stale = false;
        cleared = true;
      }
    }
  }
  return cleared;
}

// The one loop: every event ends here. A change of watches or of stale status can change the plan, so the
// plan is recomputed until it holds still (five passes is far more than needed), and only then rendered:
// one event, one render.
function runUpdate() {
  const route = parseRoute(location.hash);
  let plan;
  for (let pass = 0; pass < 5; pass += 1) {
    plan = planFor(route);
    const watchesChanged = applyWatches(plan.watch);
    const staleChanged = syncStale(plan);
    if (!watchesChanged && !staleChanged) break;
    if (pass === 4) plan = planFor(route);
  }
  if (plan.season !== null) lastSeason = plan.season;
  lastShown = {
    gameKey: plan.watch.game, mode: plan.mode, statsKey: plan.watch.stats, results: plan.results,
  };
  render(plan, route);
}

// An event that arrives while an update runs (a snapshot delivered synchronously) runs after it.
function update() {
  if (updating) {
    updateAgain = true;
    return;
  }
  updating = true;
  try {
    do {
      updateAgain = false;
      runUpdate();
    } while (updateAgain);
  } finally {
    updating = false;
  }
}

window.addEventListener('hashchange', () => {
  window.scrollTo(0, 0);
  update();
});
window.addEventListener('online', () => { state.offline = false; update(); });
window.addEventListener('offline', () => { state.offline = true; update(); });
// A page restored from the back/forward cache holds a Firestore client that shut itself down when
// the page was hidden, so its score would stay frozen. Reloading starts a fresh client.
window.addEventListener('pageshow', event => {
  if (event.persisted) location.reload();
});

const SVG_NS = 'http://www.w3.org/2000/svg';
// A stroke icon on the 24 grid, 2 px, round caps; built with createElementNS, never innerHTML.
const icon = path => {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [name, value] of [['viewBox', '0 0 24 24'], ['width', '18'], ['height', '18'], ['fill', 'none'],
    ['stroke', 'currentColor'], ['stroke-width', '2'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'],
    ['aria-hidden', 'true']]) svg.setAttribute(name, value);
  const shape = document.createElementNS(SVG_NS, 'path');
  shape.setAttribute('d', path);
  svg.append(shape);
  return svg;
};
const chevron = () => icon('M9 18l6-6-6-6');
const chevronBack = () => icon('M15 18l-6-6 6-6');
const refresh = () => icon('M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5');

// Persistent skeleton: score elements survive renders so a change can flash.
const note = h('p', { class: 'connection-note', 'data-testid': 'connection-note', role: 'status', hidden: true },
  refresh(), h('span', {}, t('connectionNote')));
const scoreUs = h('span', { class: 'board-score', 'data-testid': 'score-us' });
const scoreThem = h('span', { class: 'board-score', 'data-testid': 'score-them' });
const shootout = h('p', { class: 'board-shootout', 'data-testid': 'shootout', hidden: true });
const quarterScores = h('table', { class: 'board-quarters', 'data-testid': 'quarter-scores', hidden: true });
const liveBadge = h('span', { class: 'board-live', 'data-testid': 'live-badge', hidden: true },
  h('span', { class: 'live-dot', 'aria-hidden': 'true' }), t('live'));
const finalBadge = h('span', { class: 'board-final', 'data-testid': 'final-badge', hidden: true }, t('final'));
const period = h('span', { class: 'board-period', 'data-testid': 'period', hidden: true });
const situationBadge = h('span', { class: 'board-chip', 'data-testid': 'situation-badge', hidden: true });
const opponent = h('p', { class: 'board-name board-opp' });
const gameDate = h('span', { class: 'board-date', 'data-testid': 'game-date', hidden: true });
// The one crest element: home shows it in the season header, the game screen after the team name.
const crestSrc = teamConfig.crest ?? null;
const crest = crestSrc ? h('img', {
  class: 'season-crest', src: crestSrc, alt: '', width: 40, height: 40, 'data-testid': 'crest',
  onerror: () => { crest.hidden = true; },
}) : null;
const boardTeam = h('div', { class: 'board-team' }, h('h1', { class: 'board-name' }, teamConfig.name));
const scoreboard = h('section', { class: 'board', hidden: true },
  h('div', { class: 'board-top' },
    h('span', { class: 'board-tags' }, liveBadge, finalBadge),
    h('span', { class: 'board-meta' }, situationBadge, period, gameDate)),
  h('div', { class: 'board-teams', 'aria-live': 'polite', 'aria-atomic': 'true' },
    h('span', { class: 'board-bar', 'aria-hidden': 'true' }), boardTeam, scoreUs,
    h('span', { 'aria-hidden': 'true' }), opponent, scoreThem),
  shootout,
  quarterScores);
const unavailable = h('section', { class: 'empty', 'data-testid': 'game-unavailable', hidden: true },
  h('p', {}, t('gameUnavailable')));
// Filled by renderPastNav.
const liveBanner = h('a', { class: 'home-live', href: '#/', 'data-testid': 'live-banner', hidden: true });
const allGamesLink = h('a', { class: 'back-link', href: '#/', 'data-testid': 'all-games' }, chevronBack(), t('allGames'));
const pastNav = h('div', { class: 'past-nav', hidden: true }, liveBanner, allGamesLink);
const seasonRecord = h('p', { class: 'season-record', 'data-testid': 'season-record', hidden: true });
const seasonBrand = h('div', { class: 'season-brand' }, crest, h('p', { class: 'season-team' }, teamConfig.name));
const gamesList = h('header', { class: 'season-head', 'data-testid': 'games-list', hidden: true },
  seasonBrand,
  h('div', { class: 'season-title' }, h('h1', {}, t('seasonHeading')), seasonRecord));
// One tab bar and its panels: the scoreboard (game) or the season header (home) above, the reconnect note
// below. Both are built when the screen changes (see buildTabs); a tab press and a snapshot only update them.
const tabs = h('div', { class: 'tabs', role: 'tablist', 'data-testid': 'tabs', hidden: true });
const panels = h('div', { class: 'stack', hidden: true });
root.append(pastNav, gamesList, tabs, note, unavailable, panels);

const TAB_LABELS = {
  timeline: 'tabTimeline',
  results: 'tabResults',
  players: 'tabPlayers',
  team: 'tabTeam',
};
// The tab state of the screen on show, in memory only: it starts on the first tab whenever the screen
// changes ('home' or 'game:<id>') and a snapshot never touches it.
let tabState = { key: null, names: [], selected: null };
let panelEls = {};

function showSelectedTab() {
  for (const name of tabState.names) {
    const on = name === tabState.selected;
    const button = tabs.querySelector(`#tab-${name}`);
    // The strings "true" and "false": h() would drop a boolean false.
    button.setAttribute('aria-selected', on ? 'true' : 'false');
    button.setAttribute('tabindex', on ? '0' : '-1');
    panelEls[name].hidden = !on;
  }
}

function selectTab(name, focus) {
  tabState.selected = name;
  showSelectedTab();
  if (focus) tabs.querySelector(`#tab-${name}`).focus();
}

function buildTabs(key) {
  const names = key === 'home' ? ['results', 'players', 'team'] : ['timeline', 'players', 'team'];
  tabState = { key, names, selected: names[0] };
  tabs.className = key === 'home' ? 'tabs tabs-home' : 'tabs tabs-game';
  tabs.setAttribute('aria-label', t(key === 'home' ? 'tabsSeason' : 'tabsGame'));
  clear(tabs).append(...names.map(name => h('button', {
    type: 'button',
    role: 'tab',
    id: `tab-${name}`,
    class: 'tab',
    'data-testid': `tab-${name}`,
    'aria-controls': `panel-${name}`,
    // A press focuses the tab itself: Safari does not focus a button it was clicked on.
    onclick: () => selectTab(name, true),
  }, t(TAB_LABELS[name]))));
  panelEls = {};
  clear(panels).append(...names.map(name => {
    panelEls[name] = h('section', {
      role: 'tabpanel', id: `panel-${name}`, tabindex: '0', class: 'panel stack', 'data-testid': `panel-${name}`, 'aria-labelledby': `tab-${name}`, hidden: true,
    });
    return panelEls[name];
  }));
  showSelectedTab();
}

// Roving tabindex: the arrow keys move the selection (wrapping), Home and End jump to the ends, and focus
// follows the selection.
tabs.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const { names } = tabState;
  const at = names.findIndex(name => `tab-${name}` === event.target.id);
  if (at === -1) return;
  const next = {
    ArrowRight: (at + 1) % names.length,
    ArrowLeft: (at + names.length - 1) % names.length,
    Home: 0,
    End: names.length - 1,
  }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  selectTab(names[next], true);
});

// The tabs and panels for the screen the route names; nothing of them shows on a loading or unavailable
// screen, and then the panels hold no stale content.
function renderTabs(plan, route) {
  const key = route.kind === 'home' ? 'home' : route.kind === 'game' ? `game:${route.id}` : null;
  if (key === null) tabState = { key: null, names: [], selected: null };
  else if (key !== tabState.key) buildTabs(key);
  const shown = key !== null && (plan.mode === 'game' || plan.mode === 'home');
  tabs.hidden = !shown;
  panels.hidden = !shown;
  if (shown) return true;
  for (const el of Object.values(panelEls)) clear(el), signatures.delete(el);
  return false;
}

function setScore(el, value) {
  const next = String(value);
  if (el.textContent === next) return;
  const changed = el.textContent !== '';
  el.textContent = next;
  if (!changed) return;
  el.classList.remove('flash');
  void el.offsetWidth; // restart the animation
  el.classList.add('flash');
}

// Rebuild a container only when its inputs changed, so nothing flickers on metadata-only snapshots.
const signatures = new WeakMap();
function renderIfChanged(container, input, build) {
  const signature = JSON.stringify(input);
  if (signatures.get(container) === signature) return;
  signatures.set(container, signature);
  clear(container).append(...build());
}

function setData(el, name, value) {
  if (value == null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

function render(plan, route) {
  const { mode } = plan;
  const game = mode === 'game' ? state.game.data : null;
  note.hidden = !isOffline();
  unavailable.hidden = mode !== 'unavailable';
  // The home element tells which season's results it holds and in what state, for the tests.
  gamesList.hidden = mode !== 'home';
  setData(gamesList, 'data-season', mode === 'home' ? plan.season : null);
  setData(gamesList, 'data-results', mode === 'home' ? plan.results : null);
  // The scoreboard is in the page only on the game screen; the node is kept for the next game.
  if (mode === 'game') {
    scoreboard.hidden = false;
    if (!scoreboard.isConnected) tabs.before(scoreboard);
  } else {
    scoreboard.remove();
  }
  // One crest element, in the place the screen has for it.
  if (crest) {
    const home = mode === 'game' ? boardTeam : seasonBrand;
    if (crest.parentElement !== home) (mode === 'game' ? home.append(crest) : home.prepend(crest));
  }
  renderPastNav(plan);
  const tabsShown = renderTabs(plan, route);
  if (game) {
    renderGame(game, tabsShown);
    celebrateIfNew();
  } else {
    goals?.next(null);
  }
  // A celebration belongs to the live game on screen: leaving that game ends it.
  if (celebratingId !== null && game?.id !== celebratingId) {
    celebration?.hide();
    celebratingId = null;
  }
  renderSeason(plan, tabsShown);
}

function renderPastNav(plan) {
  const withLink = plan.mode === 'game' || plan.mode === 'unavailable';
  allGamesLink.hidden = !withLink;
  // On the game screen the link and the banner are strips across the page, above the board.
  pastNav.classList.toggle('past-nav-game', plan.mode === 'game');
  // The banner is for a live game the screen is not showing.
  const live = plan.banner !== null && state.live.key === plan.banner.gameId ? state.live.data : null;
  liveBanner.hidden = live === null;
  pastNav.hidden = !withLink && live === null;
  if (live === null) return;
  const { us, them } = deriveScore(live.events);
  liveBanner.setAttribute('href', `#/game/${encodeURIComponent(plan.banner.gameId)}`);
  const period = periodLabel(live.period);
  renderIfChanged(liveBanner, [teamConfig.name, live.opponent, us, them, period],
    () => liveBannerContent({ team: teamConfig.name, opponent: live.opponent, us, them, period }));
}

function liveBannerContent({ team, opponent, us, them, period }) {
  const watch = h('span', { class: 'home-live-watch', 'data-testid': 'watch-live' }, t('watchLive'), chevron());
  return [
    h('span', { class: 'home-live-pill' },
      h('span', { class: 'live-dot', 'aria-hidden': 'true' }), t('liveBadge', { period })),
    ' ',
    h('span', { class: 'home-live-text', 'data-testid': 'live-banner-text' },
      h('span', { class: 'home-live-team' }, team), ' ',
      h('span', { class: 'home-live-score' }, `${us}–${them}`), ' ',
      h('span', { class: 'home-live-opp' }, opponent)),
    ' ', watch,
  ];
}

// A throw here must never skip the rest of the render.
function celebrateIfNew() {
  try {
    if (goals) celebrateGoal(goals.next(state.game.data, state.game.meta ?? {}));
  } catch (err) {
    console.warn('Goal celebration failed', err);
  }
}

function celebrateGoal(goal) {
  if (!goal) return;
  const game = state.game.data;
  celebratingId = game.id;
  const player = game.lineup.find(entry => entry.playerId === goal.playerId);
  celebration.show({
    scorer: player ? t('celebrateScorer', { cap: player.cap, name: player.name }) : null,
    manUp: manUpGoalIds(game).has(goal.id),
  });
}

// Goals per regular quarter, ours first. Shootout events (period 'SO') are not in any quarter.
function quarterGoals(events) {
  const quarters = [1, 2, 3, 4].map(() => [0, 0]);
  for (const event of events) {
    // A number from 1 to 4, as in model.js: a stored "2" is no quarter here either.
    if (!Number.isInteger(event.period) || event.period < 1 || event.period > quarters.length) continue;
    const slot = quarters[event.period - 1];
    if (event.type === 'goal') slot[0] += 1;
    else if (event.type === 'oppGoal') slot[1] += 1;
  }
  return quarters;
}

// The first three characters of the opponent, in Greek-aware capitals (the accent goes: Πανελλήνιος is ΠΑΝ).
const opponentLabel = name => Array.from(name ?? '').slice(0, 3).join('').toLocaleUpperCase('el');

// The goals-by-quarter table, for a live or a final game whose quarters add up to the score on screen. The
// current quarter's head is marked and amber; quarters still to come show a dash. The shootout is no
// quarter, so with it (or a game that is final) nothing is current and every quarter shows its goals.
function renderQuarterScores(game, score, live) {
  const quarters = quarterGoals(game.events);
  const addsUp = quarters.reduce((sum, [us]) => sum + us, 0) === score.us
    && quarters.reduce((sum, [, them]) => sum + them, 0) === score.them;
  quarterScores.hidden = !addsUp;
  if (!addsUp) {
    clear(quarterScores), signatures.delete(quarterScores);
    return;
  }
  const current = live && [1, 2, 3, 4].includes(game.period) ? game.period : null;
  const heads = quarters.map((_, index) => h('th', {
    scope: 'col', class: index + 1 === current ? 'is-current' : null, 'aria-current': index + 1 === current ? 'true' : null,
  }, periodLabel(index + 1)));
  const cells = side => quarters.map((goals, index) => {
    // A quarter after the current one with goals in it anyway (history edited later) shows them.
    const future = current !== null && index + 1 > current && goals[0] + goals[1] === 0;
    return h('td', { class: future ? 'is-future' : index + 1 === current ? 'is-current' : null }, future ? '–' : goals[side]);
  });
  renderIfChanged(quarterScores, [quarters, current, teamConfig.name, game.opponent], () => [
    h('caption', { class: 'sr-only' }, t('quarterGrid')),
    h('thead', {}, h('tr', {}, h('td', { 'aria-hidden': 'true' }), heads)),
    h('tbody', {},
      h('tr', { 'data-testid': 'quarter-us' }, h('th', { scope: 'row' }, teamConfig.name), cells(0)),
      h('tr', { 'data-testid': 'quarter-them' }, h('th', { scope: 'row', class: 'is-them' }, opponentLabel(game.opponent)), cells(1))),
  ]);
}

function renderGame(game, tabsShown) {
  const score = deriveScore(game.events);
  const live = game.status === 'live';
  // A finished game that was merely left on the shootout period has no shootout to show.
  const so = live ? hasShootout(game.period, game.events) : game.events.some(event => event.period === 'SO');
  const text = scoreText(score, so);
  setScore(scoreUs, score.us);
  setScore(scoreThem, score.them);
  shootout.hidden = text.shootout === null;
  shootout.textContent = text.shootout ?? '';
  renderQuarterScores(game, score, live);
  liveBadge.hidden = !live;
  finalBadge.hidden = live;
  period.hidden = !live;
  period.textContent = live ? periodLabel(game.period) : '';
  opponent.textContent = game.opponent;
  // The date is for a finished game; a live one is today's.
  gameDate.hidden = live;
  gameDate.textContent = live ? '' : formatDate(game.date);
  const open = live ? replaySituations(game).open : null;
  situationBadge.hidden = open === null;
  situationBadge.textContent = open === null ? '' : t(open.kind === 'manUp' ? 'situationManUp' : 'situationManDown');
  setData(situationBadge, 'data-kind', open?.kind ?? null);
  situationBadge.className = open === null ? 'board-chip' : `board-chip board-chip--${open.kind}`;

  if (!tabsShown) return;
  // Each panel is rebuilt only when what it shows changed; the tab bar is not rebuilt at all.
  const inputs = [game.lineup, game.events, game.situations === true, game.opponent, game.status, game.period];
  renderIfChanged(panelEls.timeline, [...inputs, game.date, state.iconsStatus], () => timelinePanel(game));
  renderIfChanged(panelEls.players, inputs, () => gamePlayersPanel(game));
  renderIfChanged(panelEls.team, [...inputs, game.date, state.teamViewStatus],
    () => teamPanel(() => state.teamView?.gamePanel?.(game)));
}

// The Team panel: empty until teamView.js is in, a line if it never loads (or its panel throws). The panel's
// own rendering is Task 9's, in teamView.js.
const teamUnavailable = () => [h('p', { class: 'muted', 'data-testid': 'team-unavailable' }, t('teamUnavailable'))];

function teamPanel(make) {
  if (state.teamViewStatus === 'failed') return teamUnavailable();
  if (state.teamViewStatus !== 'ready') return [];
  try {
    const built = make();
    return Array.isArray(built) ? built : built ? [built] : [];
  } catch (err) {
    console.warn('Team stats failed', err);
    return teamUnavailable();
  }
}

function gamePlayersPanel(game) {
  const sections = [
    playersSection(scoringLines(playerLines(game.lineup, game.events))),
    goaliesSection(game),
  ].filter(section => section !== '');
  return sections.length ? sections : [h('p', { class: 'muted' }, t('playersEmpty'))];
}

function capBadge(cap, out) {
  return h('span', { class: out ? 'cap cap--out' : 'cap' }, cap);
}

// A titled card, as the Players tab's blocks are.
const panelBlock = (heading, ...content) => h('section', { class: 'panel-block' },
  h('h2', {}, heading), h('div', { class: 'panel-card' }, ...content));

function playersSection(lines) {
  if (!lines.length) return '';
  return panelBlock(t('playersHeading'),
    h('table', { 'aria-label': t('playersHeading') },
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, t('colPlayer')),
        h('th', { scope: 'col', class: 'num' }, t('colGoals')),
        h('th', { scope: 'col', class: 'num' }, t('colExcl')),
        h('th', { scope: 'col', class: 'num' }, t('colPen')))),
      h('tbody', {}, lines.map(line => h('tr', { 'data-testid': 'player-row', 'data-cap': line.cap },
        h('td', {}, h('span', { class: 'who' },
          capBadge(line.cap, line.out),
          h('span', { class: 'who-name' }, line.name),
          line.out ? h('span', { class: 'out-label', 'data-testid': 'player-out' }, t('out')) : null)),
        h('td', { class: 'num' },
          h('span', { 'data-testid': 'player-goals' }, line.goals),
          line.soGoals ? h('span', { class: 'pen' }, t('penaltyGoals', { n: line.soGoals })) : null),
        h('td', { class: 'num', 'data-testid': 'player-excl' }, line.excl),
        h('td', { class: 'num', 'data-testid': 'player-pen' }, line.pens ?? 0))))));
}

function goaliesSection(game) {
  const stats = goalieStats(game);
  if (stats === null) return '';
  const live = game.status === 'live';
  const soSaved = stats.goalies.reduce((sum, line) => sum + line.soSaves, 0);
  const soConceded = stats.goalies.reduce((sum, line) => sum + line.soConceded, 0);
  return h('section', { class: 'panel-block', 'data-testid': 'game-goalies' },
    h('h2', {}, t('goaliesHeading')),
    h('div', { class: 'panel-card' }, h('table', { class: 'goalies', 'aria-label': t('goaliesHeading') },
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, t('colPlayer')),
        h('th', { scope: 'col', class: 'num' }, t('colSaves')),
        h('th', { scope: 'col', class: 'num' }, t('colPenSaves')),
        h('th', { scope: 'col', class: 'num' }, t('colGA')),
        h('th', { scope: 'col', class: 'num' }, t('colSavePct')))),
      h('tbody', {}, stats.goalies.map(line => h('tr', { 'data-testid': 'goalie-row', 'data-cap': line.cap },
        h('td', {}, h('span', { class: 'who' },
          capBadge(line.cap, false),
          h('span', { class: 'who-name' }, line.name),
          live && line.playerId === stats.inGoal ? h('span', { class: 'in-goal', 'data-testid': 'goalie-in-goal' },
            h('span', { class: 'in-goal-dot', 'aria-hidden': 'true' }),
            h('span', { class: 'sr-only' }, t('inGoalSr'))) : null)),
        h('td', { class: 'num', 'data-testid': 'goalie-saves' }, line.saves),
        h('td', { class: 'num', 'data-testid': 'goalie-pen-saves' }, line.penSaves),
        h('td', { class: 'num', 'data-testid': 'goalie-ga' }, line.goalsAgainst),
        h('td', { class: 'num', 'data-testid': 'goalie-pct' }, savePctCell(line))))))),
    soSaved + soConceded > 0
      ? h('p', { class: 'muted', 'data-testid': 'goalie-shootout' }, t('shootoutGoalie', { saved: soSaved, conceded: soConceded }))
      : null);
}

function savePctCell(line) {
  const pct = savePct(line);
  return pct === null ? t('noShots') : t('savePctText', { pct });
}

// What each event type shows under its name, and which stroke icon marks it. A type this file does not know
// (a later release's) gets the label timelineEntry gives it and its glyph.
const EVENT_LINES = {
  goal: 'tlGoalSr', oppGoal: 'tlGoalSr', excl: 'tlExclSr', pen: 'tlPenSr', save: 'tlSaveSr', penSave: 'tlPenSaveSr',
};
const EVENT_ICONS = {
  goal: 'goal', oppGoal: 'goal', excl: 'excl', pen: 'pen', save: 'save', penSave: 'save',
};

// The timeline: the date and its order, then one card. Our events sit left of a centre line and theirs right;
// a goal puts the running score on the line, any other event its icon, and each quarter has a marker.
function timelinePanel(game) {
  const groups = timelineRows(game.events);
  const manUpGoals = manUpGoalIds(game);
  const outIds = foulOutIds(game.events);
  const date = typeof game.date === 'string' ? formatDate(game.date) : null;
  return [h('div', { class: 'tl-panel' },
    h('h2', { class: 'tl-heading', 'data-testid': 'timeline-heading' },
      date === null ? t('timelineNewest') : t('timelineDated', { date })),
    groups.length
      ? h('ol', { class: 'tl-list', 'aria-label': t('timelineHeading') }, groups.flatMap(group => [
        quarterMarker(group),
        ...group.events.map(event => timelineItem(event, game, manUpGoals, outIds.has(event.id))),
      ]))
      : h('p', { class: 'muted' }, t('timelineEmpty')))];
}

function quarterMarker(group) {
  const { goals } = group;
  return h('li', { class: 'tl-quarter', 'data-testid': 'tl-quarter' },
    h('h3', {}, h('span', { class: 'tl-quarter-label' }, periodLabel(group.period)), ' ',
      h('span', { class: 'tl-quarter-score' }, `${goals.us}–${goals.them}`)));
}

// The first line of a row: who. Ours by cap and name, theirs by the opponent's name.
function timelineName(event, game) {
  if (event.type === 'oppGoal') return game.opponent?.trim() || t('tlOpponentFallback');
  if (event.type === 'goal' && event.playerId == null) return t('tlUnknownScorer');
  const player = game.lineup.find(candidate => candidate.playerId === event.playerId);
  return player ? t('celebrateScorer', { cap: player.cap, name: player.name }) : t('unknownPlayer');
}

// The icon box in a row's centre. The glyph stands in until icons.js is in, and for good if it never is.
function timelineIcon(event, glyph) {
  const kind = EVENT_ICONS[event.type] ?? null;
  const box = h('span', {
    class: kind ? `tl-icon tl-icon--${kind}` : 'tl-icon', 'data-testid': 'tl-icon', 'aria-hidden': 'true',
  }, glyph);
  if (kind && state.iconsStatus === 'ready') {
    try {
      box.replaceChildren(state.icons.icon(kind));
    } catch (err) {
      console.warn('Timeline icon failed', err);
    }
  }
  return box;
}

function timelineItem(event, game, manUpGoals, out) {
  const entry = timelineEntry(event, game.lineup, game.opponent, out);
  const theirs = entry.side === 'them';
  const tagged = event.type === 'goal' && manUpGoals.has(event.id);
  const { score } = event;
  const isGoal = event.type === 'goal' || event.type === 'oppGoal';
  const lines = [
    // Blocks, not inline spans: with a stylesheet that lacks the row rules (a cached previous one) the name,
    // the event and the score still read as separate lines.
    h('div', { class: 'tl-name', 'data-testid': 'tl-name' }, timelineName(event, game)),
    h('div', { class: 'tl-what' },
      h('span', { class: 'tl-what-text' },
        EVENT_LINES[event.type] ? t(EVENT_LINES[event.type]) : entry.sr,
        out ? [' ', h('span', { class: 'tl-out', 'data-testid': 'tl-out' }, t('tlOutTag'))] : null),
      // The space is a text node: between flex items it takes no room, without the row rules it separates the tag.
      tagged ? [' ', h('span', { class: 'tl-manup', 'data-testid': 'tl-manup' }, t('tlManUpTag'))] : null),
  ];
  return h('li', {
    'data-testid': 'timeline-item',
    'data-side': entry.side,
    class: `tl-row tl-row--${entry.side}${isGoal ? ' tl-goal' : ''}${entry.minor ? ' tl-minor' : ''}`,
    'data-out': out ? 'true' : null,
  },
    h('span', { class: 'sr-only' }, `${periodLabel(event.period)} · `),
    h('div', { class: 'tl-side tl-side--us' }, theirs ? null : lines),
    h('div', { class: 'tl-mid' }, isGoal
      ? h('span', { class: 'tl-score', 'data-testid': 'tl-score' }, `${score.us}–${score.them}`)
      : timelineIcon(event, entry.icon)),
    h('div', { class: 'tl-side tl-side--them' }, theirs ? lines : null));
}

// Home: the season in the state the plan names, one panel for each tab. Anything but home shows no season.
function renderSeason(plan, tabsShown) {
  const results = plan.mode === 'home' ? plan.results : null;
  const shown = results === 'ready' || results === 'empty';
  const stats = shown && state.stats.key === plan.season ? state.stats.data : null;
  renderRecord(shown ? stats?.results : null);
  if (plan.mode !== 'home' || !tabsShown) return;
  renderIfChanged(panelEls.results, [results, stats], () => resultsPanel(results, stats));
  // The season's totals carry no cap: it comes from the current roster, by player id.
  const caps = rosterCaps();
  renderIfChanged(panelEls.players, [results, stats, [...caps]], () => seasonPlayersPanel(results, stats, caps));
  // Gated on the plan: the season's figures come from the results document, so Team waits for it as well.
  renderIfChanged(panelEls.team, [results, stats, state.teamViewStatus], () => {
    if (results === 'failed') return teamUnavailable();
    if (results === 'loading') return [h('p', { class: 'muted' }, t('resultsLoading'))];
    return teamPanel(() => state.teamView?.seasonPanel?.(stats ?? {}));
  });
}

function resultsPanel(results, stats) {
  if (results === 'loading') return [h('p', { class: 'muted', 'data-testid': 'results-loading' }, t('resultsLoading'))];
  if (results === 'failed') return [h('p', { class: 'muted', 'data-testid': 'results-failed' }, t('resultsFailed'))];
  const rows = stats?.results ?? [];
  return [h('section', { class: 'results-block' },
    h('h2', {}, t('resultsHeading')),
    rows.length ? resultsList(rows)
      : h('p', { class: 'result-card result-empty muted', 'data-testid': 'results-empty' }, t('resultsEmpty')))];
}

// Cap numbers of the current roster, by player id. A player the roster no longer holds has none.
function rosterCaps() {
  const caps = new Map(); // a Map: a historical id like 'constructor' must not find an inherited value
  const roster = state.team.data?.roster;
  for (const player of Array.isArray(roster) ? roster : []) {
    if (typeof player?.id === 'string' && Number.isInteger(player.cap)) caps.set(player.id, player.cap);
  }
  return caps;
}

function seasonPlayersPanel(results, stats, caps) {
  if (results === 'loading') return [h('p', { class: 'muted' }, t('resultsLoading'))];
  if (results === 'failed') return [h('p', { class: 'muted' }, t('resultsFailed'))];
  const players = Object.entries(stats?.players ?? {})
    .map(([id, player]) => ({ id, ...player }))
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name));
  const goalies = Object.entries(stats?.goalies ?? {})
    .map(([id, goalie]) => ({ id, ...goalie }))
    .sort((a, b) => (b.saves + b.penSaves) - (a.saves + a.penSaves) || a.name.localeCompare(b.name));
  if (!players.length && !goalies.length) return [h('p', { class: 'muted' }, t('playersEmpty'))];
  return [
    players.length ? panelBlock(t('totalsHeading'), totalsTable(players, caps)) : null,
    goalies.length ? panelBlock(t('goaliesHeading'), seasonGoaliesTable(goalies, caps)) : null,
  ].filter(block => block !== null);
}

// "3 W · 1 L", with "· 1 D" when a game was level. Only scored results count toward the record.
function renderRecord(results) {
  const tally = { W: 0, L: 0, D: 0 };
  for (const result of Array.isArray(results) ? results : []) {
    const outcome = resultOutcome(result);
    if (outcome in tally) tally[outcome] += 1;
  }
  const played = tally.W + tally.L + tally.D;
  seasonRecord.hidden = played === 0;
  seasonRecord.textContent = played === 0 ? '' : tally.D > 0
    ? t('seasonRecordDraws', { w: tally.W, l: tally.L, d: tally.D })
    : t('seasonRecord', { w: tally.W, l: tally.L });
}

function resultsList(results) {
  return h('ul', { class: 'result-list result-card', 'aria-label': t('resultsHeading') }, results.map(resultItem));
}

function resultItem(result) {
  const scored = Number.isFinite(result.us) && Number.isFinite(result.them);
  // A 0 – 0 shootout means none was played (older games recorded it that way).
  const shootedOut = Number.isFinite(result.soUs) && Number.isFinite(result.soThem)
    && !(result.soUs === 0 && result.soThem === 0);
  const outcome = resultOutcome(result);
  const date = typeof result.date === 'string' ? formatDate(result.date) : '';
  const pen = shootedOut
    ? t('resultPen', { us: result.soUs, them: result.soThem }) : null;
  const body = [
    outcome ? h('span', { class: `result-chip result-chip-${outcome}`, 'data-testid': 'result-chip' },
      t(`result${outcome}`)) : null,
    h('span', { class: 'result-main' },
      h('span', { class: 'result-opp' }, result.opponent),
      h('span', { class: 'result-meta' },
        h('span', { class: 'result-date' }, date), pen ? [' · ', h('span', { class: 'result-pen' }, pen)] : null)),
    h('span', { class: 'result-tally' }, scored ? scoreText(result, false).main : t('resultNoScore')),
  ];
  // The link's name has what the row shows: the outcome as a word (the chip's "W" alone is not one), the score
  // with its shootout, the opponent and the date. Without a score there is no outcome to name.
  const score = pen ? `${scoreText(result, false).main}, ${pen}` : scoreText(result, false).main;
  const word = outcome ? t(`resultName${outcome}`) : null;
  const label = outcome
    ? [t('resultLabel', { outcome: word, score, opponent: result.opponent }), date]
      .filter(Boolean).join(', ')
    : t('openGameFor', { opponent: result.opponent, date });
  // A row with no game to open (data from before results kept the id) is not a link, so it has no chevron.
  const link = result.gameId == null ? h('div', { class: 'result-open' }, body) : h('a', {
    class: 'result-open',
    href: `#/game/${encodeURIComponent(result.gameId)}`,
    'data-testid': 'result-link',
    'aria-label': label,
  }, body, chevron());
  return h('li', { class: 'result-item', 'data-testid': 'result-row' }, link);
}

// A season row's name, with the cap chip when the roster still knows the player.
const seasonWho = (player, caps) => h('span', { class: 'who' },
  caps.has(player.id) ? capBadge(caps.get(player.id), false) : null,
  h('span', { class: 'who-name' }, player.name));

function seasonGoaliesTable(goalies, caps) {
  return h('table', { class: 'goalies', 'aria-label': t('goaliesHeading'), 'data-testid': 'season-goalies' },
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col' }, t('colPlayer')),
      h('th', { scope: 'col', class: 'num' }, t('colGames')),
      h('th', { scope: 'col', class: 'num' }, t('colSaves')),
      h('th', { scope: 'col', class: 'num' }, t('colPenSaves')),
      h('th', { scope: 'col', class: 'num' }, t('colGA')),
      h('th', { scope: 'col', class: 'num' }, t('colSavePct')))),
    h('tbody', {}, goalies.map(goalie => h('tr', { 'data-testid': 'season-goalie-row' },
      h('td', {}, seasonWho(goalie, caps)),
      h('td', { class: 'num' }, goalie.games),
      h('td', { class: 'num' }, goalie.saves),
      h('td', { class: 'num' }, goalie.penSaves),
      h('td', { class: 'num' }, goalie.goalsAgainst),
      h('td', { class: 'num' }, savePctCell({
        saves: goalie.saves, penSaves: goalie.penSaves, goalsAgainst: goalie.goalsAgainst,
      }))))));
}

function totalsTable(players, caps) {
  return h('table', { 'aria-label': t('totalsHeading') },
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col' }, t('colPlayer')),
      h('th', { scope: 'col', class: 'num' }, t('colGames')),
      h('th', { scope: 'col', class: 'num' }, t('colGoals')),
      h('th', { scope: 'col', class: 'num' }, t('colExcl')),
      h('th', { scope: 'col', class: 'num' }, t('colPen')))),
    h('tbody', {}, players.map(player => h('tr', { 'data-testid': 'season-row' },
      h('td', {}, seasonWho(player, caps)),
      h('td', { class: 'num' }, player.games),
      h('td', { class: 'num' }, player.goals),
      h('td', { class: 'num' }, player.excl),
      h('td', { class: 'num', 'data-testid': 'season-pen' }, player.pens ?? 0)))));
}

startWatch('team', 'main');
update();
