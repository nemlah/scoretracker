import './sw-register.js';
import { team as teamConfig } from './config.js';
import { initFirebase } from './firebase.js';
import {
  deriveScore, formatDate, hasShootout, playerLines, scoringLines, seasonFor, timeline, todayIso,
} from './model.js';
// Added after the previous release. A phone can briefly hold that release's cached model.js beside
// this file, so these are read off the namespace and fall back instead of failing the module link.
import * as model from './model.js';
import * as strings from './strings.js';
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
// The error callback is a new, optional argument: a cached previous repo.js ignores it, and the deadline
// in startWatch covers that case.
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

// The previous release's model.js has no viewerState. This keeps the same plan shape with fewer rules:
// it never guesses a season (the calendar one only when the team document is server-confirmed to have no
// current game), so results stay 'loading' rather than show the wrong season, and has no hold rule.
function fallbackState({ route, team, game, live, stats, offline, calendarSeason, lastSeason: retained }) {
  const settled = watch => watch?.data !== undefined
    && (watch.data !== null || !watch.meta?.fromCache || watch.meta?.error || offline);
  const matching = (watch, key) => key !== null && watch.key === key ? watch : undefined;
  const isHome = route.kind === 'home';
  const isGame = route.kind === 'game';
  const gameKey = isGame ? route.id : null;
  const currentId = team.data?.currentGameId ?? null;
  const liveKey = gameKey === currentId ? null : currentId;
  const routedGame = matching(game, gameKey);
  const currentGame = gameKey === currentId ? routedGame : matching(live, liveKey);

  let season = isHome ? retained : null;
  if (isHome && team.data !== undefined) {
    if (currentId === null) {
      if (!team.meta?.fromCache && !team.meta?.error) season = calendarSeason;
    } else if (currentGame?.data) {
      season = currentGame.data.season;
    }
  }

  let mode = 'unavailable';
  if (isHome) mode = team.data === undefined ? 'loading' : 'home';
  else if (isGame) mode = routedGame?.data ? 'game' : settled(routedGame) ? 'unavailable' : 'loading';

  let results = isHome ? 'loading' : null;
  const seasonStats = season === null ? undefined : matching(stats, season);
  if (seasonStats?.data !== undefined) {
    if (seasonStats.meta?.error) results = 'failed';
    else if (settled(seasonStats)) results = seasonStats.data?.results?.length ? 'ready' : 'empty';
  }

  const banner = liveKey !== null && mode !== 'loading' && currentGame?.data?.status === 'live'
    ? { gameId: liveKey } : null;
  return {
    watch: { game: gameKey, live: liveKey, stats: season },
    tracked: { team: true, game: isGame, live: isHome, stats: isHome && season !== null },
    mode, season, results, banner,
  };
}

// A watch that has waited STALE_MS for the server carries `meta.stale` into the plan, so only its own cache
// miss counts as absence. `offline` in the plan is the browser's own state.
const withStale = name => {
  const watch = state[name];
  return subs[name].stale ? { ...watch, meta: { ...watch.meta, stale: true } } : watch;
};

function planFor(route) {
  const input = {
    route,
    team: withStale('team'),
    game: withStale('game'),
    live: withStale('live'),
    stats: withStale('stats'),
    offline: state.offline,
    calendarSeason: seasonFor(todayIso()),
    lastSeason,
    lastShown,
  };
  // The inline rules of an R1 model.js have no per-watch staleness: any stale watch means offline there.
  return model.viewerState?.(input) ?? fallbackState({ ...input, offline: state.offline || isStale() });
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
  render(plan);
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

// A string added in this release: a phone holding the previous strings.js gets the fallback, not a key name.
const tOr = (key, fallback, params) => (strings.hasString?.(key) ? t(key, params) : fallback);
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
const shootout = h('p', { class: 'shootout', 'data-testid': 'shootout', hidden: true });
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
const gameSections = h('div', { class: 'stack' });
const seasonSection = h('div', { class: 'stack' });
root.append(note, pastNav, gamesList, unavailable, gameSections, seasonSection);

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

function render(plan) {
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
    if (!scoreboard.isConnected) unavailable.before(scoreboard);
  } else {
    scoreboard.remove();
  }
  // One crest element, in the place the screen has for it.
  if (crest) {
    const home = mode === 'game' ? boardTeam : seasonBrand;
    if (crest.parentElement !== home) (mode === 'game' ? home.append(crest) : home.prepend(crest));
  }
  renderPastNav(plan);
  if (game) {
    renderGame(game);
    celebrateIfNew();
  } else {
    clear(gameSections), signatures.delete(gameSections);
    goals?.next(null);
  }
  // A celebration belongs to the live game on screen: leaving that game ends it.
  if (celebratingId !== null && game?.id !== celebratingId) {
    celebration?.hide();
    celebratingId = null;
  }
  renderSeason(plan);
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
  renderIfChanged(liveBanner, [teamConfig.name, live.opponent, us, them, period, strings.hasString?.('liveBadge') === true],
    () => liveBannerContent({ team: teamConfig.name, opponent: live.opponent, us, them, period }));
}

// The score and the quarter keep their room; the opponent's name is cut first, with an ellipsis. With this
// release's strings the banner is a LIVE · Qn pill, the team, an emphasised score and the opponent. A
// previous strings.js has only the old one-line template ("Live: {opponent} {us}–{them} · {period}"): it is
// laid out slot by slot, so the same rule holds.
const BANNER_SLOTS = { team: '\u0001', opponent: '\u0002', us: '\u0003', them: '\u0004', period: '\u0005' };
function liveBannerContent(values) {
  const watch = h('span', { class: 'home-live-watch', 'data-testid': 'watch-live' }, t('watchLive'), chevron());
  const dot = () => h('span', { class: 'live-dot', 'aria-hidden': 'true' });
  if (strings.hasString?.('liveBadge')) {
    return [
      h('span', { class: 'home-live-pill' }, dot(), t('liveBadge', { period: values.period })),
      ' ',
      h('span', { class: 'home-live-text', 'data-testid': 'live-banner-text' },
        h('span', { class: 'home-live-team' }, values.team), ' ',
        h('span', { class: 'home-live-score' }, `${values.us}–${values.them}`), ' ',
        h('span', { class: 'home-live-opp' }, values.opponent)),
      ' ', watch,
    ];
  }
  const parts = t('liveBanner', BANNER_SLOTS).split(/([\u0001-\u0005])/).filter(part => part !== '').map(part => {
    const slot = Object.keys(BANNER_SLOTS).find(name => BANNER_SLOTS[name] === part);
    if (!slot) return h('span', { class: 'home-live-gap' }, part);
    return h('span', { class: slot === 'opponent' ? 'home-live-opp' : slot === 'team' ? 'home-live-team' : 'home-live-score' }, values[slot]);
  });
  return [dot(), ' ', h('span', { class: 'home-live-text home-live-text-slots', 'data-testid': 'live-banner-text' }, parts), ' ', watch];
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
    const slot = quarters[event.period - 1];
    if (!slot) continue;
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
    h('caption', { class: 'sr-only' }, tOr('quarterGrid', 'Goals by quarter')),
    h('thead', {}, h('tr', {}, h('td', { 'aria-hidden': 'true' }), heads)),
    h('tbody', {},
      h('tr', { 'data-testid': 'quarter-us' }, h('th', { scope: 'row' }, teamConfig.name), cells(0)),
      h('tr', { 'data-testid': 'quarter-them' }, h('th', { scope: 'row', class: 'is-them' }, opponentLabel(game.opponent)), cells(1))),
  ]);
}

function renderGame(game) {
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

  // Rebuilding the sections would reset the timeline box to the top; carry its scroll position over.
  const oldBox = gameSections.querySelector('.timeline-scroll');
  const scrollTop = oldBox?.scrollTop ?? 0;
  const hadFocus = oldBox?.contains(document.activeElement) ?? false;
  renderIfChanged(gameSections, [game.lineup, game.events, game.situations === true, game.opponent, game.status, game.period], () => [
    timelineSection(game),
    playersSection(scoringLines(playerLines(game.lineup, game.events))),
    goaliesSection(game),
  ]);
  const box = gameSections.querySelector('.timeline-scroll');
  if (box && scrollTop) box.scrollTop = scrollTop;
  if (box && hadFocus && box !== oldBox) box.focus({ preventScroll: true });
}

function capBadge(cap, out) {
  return h('span', { class: out ? 'cap cap--out' : 'cap' }, cap);
}

function playersSection(lines) {
  if (!lines.length) return '';
  return h('section', { class: 'section' },
    h('h2', {}, t('playersHeading')),
    h('table', {},
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, t('colPlayer')),
        h('th', { scope: 'col', class: 'num' }, t('colGoals')),
        h('th', { scope: 'col', class: 'num' }, t('colExcl')),
        h('th', { scope: 'col', class: 'num' }, t('colPen')))),
      h('tbody', {}, lines.map(line => h('tr', { 'data-testid': 'player-row', 'data-cap': line.cap },
        h('td', {}, h('span', { class: 'who' },
          capBadge(line.cap, line.out),
          line.name,
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
  return h('section', { class: 'section', 'data-testid': 'game-goalies' },
    h('h2', {}, t('goaliesHeading')),
    h('table', { class: 'goalies', 'aria-label': t('goaliesHeading') },
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, t('colPlayer')),
        h('th', { scope: 'col', class: 'num' }, t('colSaves')),
        h('th', { scope: 'col', class: 'num' }, t('colPenSaves')),
        h('th', { scope: 'col', class: 'num' }, t('colGA')),
        h('th', { scope: 'col', class: 'num' }, t('colSavePct')))),
      h('tbody', {}, stats.goalies.map(line => h('tr', { 'data-testid': 'goalie-row', 'data-cap': line.cap },
        h('td', {}, h('span', { class: 'who' },
          capBadge(line.cap, false),
          line.name,
          live && line.playerId === stats.inGoal ? h('span', { class: 'in-goal', 'data-testid': 'goalie-in-goal' },
            h('span', { class: 'in-goal-dot', 'aria-hidden': 'true' }),
            h('span', { class: 'sr-only' }, t('inGoalSr'))) : null)),
        h('td', { class: 'num', 'data-testid': 'goalie-saves' }, line.saves),
        h('td', { class: 'num', 'data-testid': 'goalie-pen-saves' }, line.penSaves),
        h('td', { class: 'num', 'data-testid': 'goalie-ga' }, line.goalsAgainst),
        h('td', { class: 'num', 'data-testid': 'goalie-pct' }, savePctCell(line)))))),
    soSaved + soConceded > 0
      ? h('p', { class: 'muted', 'data-testid': 'goalie-shootout' }, t('shootoutGoalie', { saved: soSaved, conceded: soConceded }))
      : null);
}

function savePctCell(line) {
  const pct = savePct(line);
  return pct === null ? t('noShots') : t('savePctText', { pct });
}

function timelineSection(game) {
  // Saves get their own, lighter rows, but only when both loaded modules know about them: a cached
  // previous strings.js would draw one as an exclusion, a pre-goalie model.js would list it itself.
  // In goal switches never get a row, and an older cached timeline() would list them as exclusions.
  const savesShown = model.TIMELINE_SAVES === true && strings.TIMELINE_SAVES === true;
  const groups = timeline(game.events.filter(event => event.type !== 'gkIn' && (savesShown || event.type !== 'save')));
  const manUpGoals = manUpGoalIds(game);
  const outIds = model.foulOutIds?.(game.events) ?? new Set();
  return h('section', { class: 'section timeline' },
    h('h2', {}, t('timelineHeading')),
    groups.length ? h('div', {
      class: 'timeline-scroll', tabindex: '0', role: 'region', 'aria-label': t('timelineHeading'), 'data-testid': 'timeline-scroll',
    }, groups.map(group => h('div', {},
      h('h3', {}, periodLabel(group.period)),
      h('ul', {}, group.events.map(event => timelineItem(event, game, manUpGoals, outIds.has(event.id))))))) : h('p', { class: 'muted' }, t('timelineEmpty')));
}

function timelineItem(event, game, manUpGoals, out) {
  const entry = timelineEntry(event, game.lineup, game.opponent, out);
  const icon = h('span', {
    class: entry.badge ? 'tl-icon tl-badge' : 'tl-icon', 'data-testid': 'tl-icon', 'aria-hidden': 'true',
  }, entry.icon);
  const text = h('span', { class: 'tl-text' }, entry.text);
  const tagged = event.type === 'goal' && manUpGoals.has(event.id);
  return h('li', {
    'data-testid': 'timeline-item', 'data-side': entry.side, class: `tl-item tl-${entry.side}${entry.minor ? ' tl-minor' : ''}`, 'data-out': out ? 'true' : null,
  },
    h('span', { class: 'sr-only' }, `${periodLabel(event.period)} · `),
    entry.side === 'them' ? null : icon,
    h('span', { class: 'sr-only' }, `${entry.sr}${tagged ? ` · ${t('tlManUpTag')}` : ''} · `),
    text,
    tagged ? h('span', { class: 'tl-tag', 'data-testid': 'tl-manup', 'aria-hidden': 'true' }, t('tlManUpTag')) : null,
    entry.side === 'them' ? icon : null);
}

// Home: the season's results in the state the plan names. Anything else shows no season block.
function renderSeason(plan) {
  const results = plan.mode === 'home' ? plan.results : null;
  const shown = results === 'ready' || results === 'empty';
  const stats = shown && state.stats.key === plan.season ? state.stats.data : null;
  renderRecord(shown ? stats?.results : null);
  renderIfChanged(seasonSection, [results, stats], () => {
    if (results === 'loading') return [h('p', { class: 'muted', 'data-testid': 'results-loading' }, t('resultsLoading'))];
    if (results === 'failed') return [h('p', { class: 'muted', 'data-testid': 'results-failed' }, t('resultsFailed'))];
    if (!shown) return [];
    const rows = stats?.results ?? [];
    const players = Object.entries(stats?.players ?? {})
      .map(([id, player]) => ({ id, ...player }))
      .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name));
    const goalies = Object.entries(stats?.goalies ?? {})
      .map(([id, goalie]) => ({ id, ...goalie }))
      .sort((a, b) => (b.saves + b.penSaves) - (a.saves + a.penSaves) || a.name.localeCompare(b.name));
    return [
      h('section', { class: 'results-block' },
        h('h2', {}, t('resultsHeading')),
        rows.length ? resultsList(rows)
          : h('p', { class: 'result-card result-empty muted', 'data-testid': 'results-empty' }, t('resultsEmpty'))),
      ...(players.length || goalies.length ? [h('section', { class: 'section' },
        players.length ? totalsTable(players) : null,
        goalies.length ? seasonGoaliesTable(goalies) : null)] : [])];
  });
}

// "3 W · 1 L", with "· 1 D" when a game was level. Results without a score count for nothing; without
// model.resultOutcome (the previous model.js) there is no record.
function renderRecord(results) {
  const tally = { W: 0, L: 0, D: 0 };
  for (const result of Array.isArray(results) ? results : []) {
    const outcome = model.resultOutcome?.(result);
    if (outcome in tally) tally[outcome] += 1;
  }
  const played = tally.W + tally.L + tally.D;
  seasonRecord.hidden = played === 0;
  seasonRecord.textContent = played === 0 ? '' : tally.D > 0
    ? tOr('seasonRecordDraws', `${tally.W} W · ${tally.L} L · ${tally.D} D`, { w: tally.W, l: tally.L, d: tally.D })
    : tOr('seasonRecord', `${tally.W} W · ${tally.L} L`, { w: tally.W, l: tally.L });
}

function resultsList(results) {
  return h('ul', { class: 'result-list result-card', 'aria-label': t('resultsHeading') }, results.map(resultItem));
}

function resultItem(result) {
  const scored = Number.isFinite(result.us) && Number.isFinite(result.them);
  // A 0 – 0 shootout means none was played (older games recorded it that way).
  const shootedOut = Number.isFinite(result.soUs) && Number.isFinite(result.soThem)
    && !(result.soUs === 0 && result.soThem === 0);
  const outcome = scored ? model.resultOutcome?.(result) ?? null : null;
  const date = typeof result.date === 'string' ? formatDate(result.date) : '';
  const pen = shootedOut
    ? tOr('resultPen', scoreText(result, true).shootout, { us: result.soUs, them: result.soThem }) : null;
  const body = [
    outcome ? h('span', { class: `result-chip result-chip-${outcome}`, 'data-testid': 'result-chip' },
      tOr(`result${outcome}`, outcome)) : null,
    h('span', { class: 'result-main' },
      h('span', { class: 'result-opp' }, result.opponent),
      h('span', { class: 'result-meta' },
        h('span', { class: 'result-date' }, date), pen ? [' · ', h('span', { class: 'result-pen' }, pen)] : null)),
    h('span', { class: 'result-tally' }, scored ? scoreText(result, false).main : tOr('resultNoScore', '–')),
  ];
  const link = result.gameId == null ? h('div', { class: 'result-open' }, body, chevron()) : h('a', {
    class: 'result-open',
    href: `#/game/${encodeURIComponent(result.gameId)}`,
    'data-testid': 'result-link',
    'aria-label': t('openGameFor', { opponent: result.opponent, date }),
  }, body, chevron());
  return h('li', { class: 'result-item', 'data-testid': 'result-row' }, link);
}

function seasonGoaliesTable(goalies) {
  return h('table', { class: 'goalies', 'aria-label': t('goaliesHeading'), 'data-testid': 'season-goalies' },
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col' }, t('goaliesHeading')),
      h('th', { scope: 'col', class: 'num' }, t('colGames')),
      h('th', { scope: 'col', class: 'num' }, t('colSaves')),
      h('th', { scope: 'col', class: 'num' }, t('colPenSaves')),
      h('th', { scope: 'col', class: 'num' }, t('colGA')),
      h('th', { scope: 'col', class: 'num' }, t('colSavePct')))),
    h('tbody', {}, goalies.map(goalie => h('tr', { 'data-testid': 'season-goalie-row' },
      h('td', {}, goalie.name),
      h('td', { class: 'num' }, goalie.games),
      h('td', { class: 'num' }, goalie.saves),
      h('td', { class: 'num' }, goalie.penSaves),
      h('td', { class: 'num' }, goalie.goalsAgainst),
      h('td', { class: 'num' }, savePctCell({
        saves: goalie.saves, penSaves: goalie.penSaves, goalsAgainst: goalie.goalsAgainst,
      }))))));
}

function totalsTable(players) {
  return h('table', { 'aria-label': t('totalsHeading') },
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col' }, t('colPlayer')),
      h('th', { scope: 'col', class: 'num' }, t('colGames')),
      h('th', { scope: 'col', class: 'num' }, t('colGoals')),
      h('th', { scope: 'col', class: 'num' }, t('colExcl')),
      h('th', { scope: 'col', class: 'num' }, t('colPen')))),
    h('tbody', {}, players.map(player => h('tr', { 'data-testid': 'season-row' },
      h('td', {}, player.name),
      h('td', { class: 'num' }, player.games),
      h('td', { class: 'num' }, player.goals),
      h('td', { class: 'num' }, player.excl),
      h('td', { class: 'num', 'data-testid': 'season-pen' }, player.pens ?? 0)))));
}

startWatch('team', 'main');
update();
