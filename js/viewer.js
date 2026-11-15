import './sw-register.js';
import { team as teamConfig } from './config.js';
import { initFirebase } from './firebase.js';
import {
  deriveScore, formatDate, hasShootout, playerLines, scoringLines, seasonFor, timeline, todayIso,
} from './model.js';
// Added after the previous release. A phone can briefly hold that release's cached model.js beside
// this file, so these are read off the namespace and fall back instead of failing the module link.
import * as model from './model.js';
import { goalieStats, savePct } from './goalies.js';
import { createRepo } from './repo.js';
import { manUpGoalIds, replaySituations, situationCounts } from './situations.js';
import {
  manDownText, manUpText, periodLabel, scoreText, situationShort, t, timelineEntry,
} from './strings.js';
import { clear, h } from './ui/dom.js';

const STALE_MS = 6000;

document.documentElement.style.setProperty('--accent', teamConfig.accent);
document.title = t('viewerTitle', { team: teamConfig.name });

const repo = createRepo(initFirebase().db);
const root = document.getElementById('app');

// undefined = no snapshot yet, null = document absent.
const state = {
  team: undefined, teamMeta: null,
  game: undefined, gameMeta: null,
  live: undefined, // the current game, watched only for the banner while another game is open
  stats: undefined,
  offline: !navigator.onLine,
  stale: false,
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
    if (state.game) goals.next(state.game, state.gameMeta ?? {});
  } catch (err) {
    console.warn('Goal celebration unavailable', err);
  }
})();

// Subscriptions keyed by what they watch, so a stale one is dropped when the key changes.
const subs = { game: { key: null, off: null }, stats: { key: null, off: null }, live: { key: null, off: null } };
const awaitingServer = new Set();
let staleTimer = null;

function trackConnection(name, meta) {
  if (meta?.fromCache) awaitingServer.add(name);
  else awaitingServer.delete(name);
  syncStaleTimer();
}

function syncStaleTimer() {
  if (awaitingServer.size === 0) {
    clearTimeout(staleTimer);
    staleTimer = null;
    if (state.stale) { state.stale = false; render(); }
  } else if (staleTimer === null) {
    staleTimer = setTimeout(() => {
      staleTimer = null;
      if (awaitingServer.size) { state.stale = true; render(); }
    }, STALE_MS);
  }
}

function resubscribe(name, key, subscribe) {
  const sub = subs[name];
  if (sub.key === key) return;
  sub.off?.();
  sub.key = key;
  sub.off = null;
  awaitingServer.delete(name);
  state[name] = undefined;
  if (key === null) { syncStaleTimer(); return; }
  try {
    sub.off = subscribe((data, meta) => {
      if (sub.key !== key) return;
      // Seen before the new snapshot replaces it: the live game on the landing page has just ended.
      // The key must be the current game: right after the hash changes to home, before hashchange has
      // run follow(), this subscription can still be the game the visitor just left.
      const ended = name === 'game' && parseRoute(location.hash).kind === 'home' && key === currentGameId()
        && state.game?.status === 'live' && data?.status === 'final';
      state[name] = data;
      if (name === 'game') state.gameMeta = meta;
      if (name !== 'live') trackConnection(name, meta);
      if (name === 'game') followSeason();
      if (ended) stayOnGame(key);
      render();
    });
  } catch (err) {
    // A subscription that cannot start must not stop the rest of the viewer.
    console.warn(`Could not watch ${name}`, err);
  }
}

function followSeason() {
  const season = state.game ? state.game.season : seasonFor(todayIso());
  resubscribe('stats', season, cb => repo.watchStats(season, cb));
}

// '#/game/<id>' opens that game and '#/games' the games list; any other hash is the landing page,
// which shows the live game, or the list when no game is live. A game route whose id could not be a
// Firestore document id is 'invalid' ('/' can never be an id): it is shown as unavailable and never
// reaches Firestore.
function validDocId(id) {
  return id !== '' && !id.includes('/') && id !== '.' && id !== '..'
    && !/^__.*__$/.test(id) && new TextEncoder().encode(id).length <= 1500;
}

function parseRoute(hash) {
  if (hash === '#/games') return { kind: 'games' };
  const match = /^#\/game\/(.*)$/.exec(hash);
  if (!match) return { kind: 'home' };
  try {
    const id = decodeURIComponent(match[1]);
    return validDocId(id) ? { kind: 'game', id } : { kind: 'invalid' };
  } catch {
    return { kind: 'invalid' };
  }
}

const currentGameId = () => state.team?.currentGameId ?? null;

// The game being read: the routed one, else the current game (on the landing page and the list, where
// it decides between the two). Null for an invalid route.
function followedGameId() {
  const route = parseRoute(location.hash);
  if (route.kind === 'game') return route.id;
  return route.kind === 'invalid' ? null : currentGameId();
}

// The current game, as far as it is known: the open one when that is it, else the banner's own watch.
function currentGame() {
  const id = currentGameId();
  if (id === null) return null;
  return followedGameId() === id ? state.game : state.live;
}

function follow() {
  const gameId = followedGameId();
  resubscribe('game', gameId, cb => repo.watchGame(gameId, cb));
  if (gameId === null) followSeason();
  // The banner watches the current game only while the open game is another one.
  const liveId = currentGameId() === gameId ? null : currentGameId();
  resubscribe('live', liveId, cb => repo.watchGame(liveId, cb));
}

// The live game on the landing page has ended: keep showing it, at an address that survives a reload.
// replaceState fires no hashchange, so the follow-up is done here.
function stayOnGame(gameId) {
  history.replaceState(null, '', `#/game/${encodeURIComponent(gameId)}`);
  follow();
}

repo.watchTeam((data, meta) => {
  // Ending a reopened older game also moves the current game on, and its team and game snapshots can
  // arrive in either order: keep the live game on screen until its own final snapshot shows.
  const onLive = parseRoute(location.hash).kind === 'home' && state.game?.status === 'live' ? followedGameId() : null;
  state.team = data;
  state.teamMeta = meta;
  trackConnection('team', meta);
  if (onLive !== null && currentGameId() !== onLive) stayOnGame(onLive);
  else follow();
  render();
});

window.addEventListener('hashchange', () => {
  window.scrollTo(0, 0);
  follow();
  render();
});
// A shared link starts reading the game without waiting for the team document.
if (parseRoute(location.hash).kind === 'game') follow();

window.addEventListener('online', () => { state.offline = false; render(); });
window.addEventListener('offline', () => { state.offline = true; render(); });
// A page restored from the back/forward cache holds a Firestore client that shut itself down when
// the page was hidden, so its score would stay frozen. Reloading starts a fresh client.
window.addEventListener('pageshow', event => {
  if (event.persisted) location.reload();
});

// Persistent skeleton: score elements survive renders so a change can flash.
const note = h('p', { class: 'connection-note', 'data-testid': 'connection-note', role: 'status', hidden: true }, t('connectionNote'));
const scoreUs = h('span', { 'data-testid': 'score-us' });
const scoreThem = h('span', { 'data-testid': 'score-them' });
const shootout = h('p', { class: 'shootout', 'data-testid': 'shootout', hidden: true });
const quarterScores = h('p', { class: 'quarter-scores', 'data-testid': 'quarter-scores', hidden: true });
const liveBadge = h('span', { class: 'live-badge', 'data-testid': 'live-badge', hidden: true },
  h('span', { class: 'live-dot', 'aria-hidden': 'true' }), t('live'));
const finalBadge = h('span', { 'data-testid': 'final-badge', hidden: true }, t('final'));
const period = h('span', { class: 'period', 'data-testid': 'period', hidden: true });
const situationBadge = h('span', { class: 'situation-badge', 'data-testid': 'situation-badge', hidden: true });
const gameManUp = h('p', { class: 'situation-figure', 'data-testid': 'game-manup' });
const gameManDown = h('p', { class: 'situation-figure', 'data-testid': 'game-mandown' });
const opponent = h('p', { class: 'team-name' });
const gameDate = h('p', { class: 'muted', 'data-testid': 'game-date' });
const scoreboard = h('section', { class: 'scoreboard', hidden: true },
  h('div', { class: 'board-row' },
    h('h1', { class: 'team-name' }, teamConfig.name),
    h('p', { class: 'status' }, liveBadge, finalBadge, period, situationBadge)),
  h('p', { class: 'score', 'aria-live': 'polite' }, scoreUs, h('span', { class: 'dash', 'aria-hidden': 'true' }, '–'), scoreThem),
  shootout,
  quarterScores,
  h('div', { class: 'board-row' }, opponent, gameDate),
  h('div', { class: 'situation-figures' }, gameManUp, gameManDown));
const empty = h('section', { class: 'empty', 'data-testid': 'empty-state', hidden: true },
  h('h2', {}, t('emptyTitle')), h('p', {}, t('emptyBody')));
const unavailable = h('section', { class: 'empty', 'data-testid': 'game-unavailable', hidden: true },
  h('p', {}, t('gameUnavailable')));
const bannerText = h('span', { class: 'live-banner-text', 'data-testid': 'live-banner-text' });
const liveBanner = h('div', { class: 'live-banner', 'data-testid': 'live-banner', hidden: true },
  h('span', { class: 'live-dot', 'aria-hidden': 'true' }),
  bannerText,
  h('a', { class: 'watch-live', href: '#/', 'data-testid': 'watch-live' }, t('watchLive')));
const allGamesLink = h('a', { class: 'back-link', href: '#/games', 'data-testid': 'all-games' }, t('allGames'));
const pastNav = h('div', { class: 'past-nav', hidden: true }, liveBanner, allGamesLink);
const gamesList = h('header', { class: 'games-list', 'data-testid': 'games-list', hidden: true },
  h('h1', { class: 'team-name' }, teamConfig.name));
const gameSections = h('div', { class: 'stack' });
const seasonSection = h('div', { class: 'stack' });
root.append(note, pastNav, gamesList, scoreboard, empty, unavailable, gameSections, seasonSection);

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

// 'loading' | 'list' | 'game' | 'unavailable' | 'empty'. The landing page shows the live game; with no
// live game it is the list, which is also '#/games'. The list gives way to the empty state only when
// there is no game to follow and the season has no results.
function viewMode() {
  const settled = (data, meta) => data !== undefined && (data !== null || !meta?.fromCache || isOffline());
  if (state.team === undefined) return 'loading';
  const route = parseRoute(location.hash);
  if (route.kind === 'invalid') return 'unavailable';
  if (route.kind === 'game') {
    if (state.game === undefined) return 'loading';
    if (state.game === null) return settled(state.game, state.gameMeta) ? 'unavailable' : 'loading';
    return 'game';
  }
  if (currentGameId() === null) {
    if (!settled(state.team, state.teamMeta)) return 'loading';
  } else {
    if (state.game === undefined) return 'loading';
    if (state.game === null && !settled(state.game, state.gameMeta)) return 'loading';
    if (state.game !== null) return route.kind === 'home' && state.game.status === 'live' ? 'game' : 'list';
  }
  // No current game, or it no longer exists.
  if (state.stats === undefined) return 'loading';
  return state.stats?.results?.length ? 'list' : 'empty';
}

const isOffline = () => state.offline || state.stale;

function render() {
  const mode = viewMode();
  note.hidden = !isOffline();
  empty.hidden = mode !== 'empty';
  unavailable.hidden = mode !== 'unavailable';
  gamesList.hidden = mode !== 'list';
  scoreboard.hidden = mode !== 'game';
  renderPastNav(mode);
  if (mode === 'game') {
    renderGame(state.game);
    celebrateIfNew();
  } else {
    clear(gameSections), signatures.delete(gameSections);
    goals?.next(null);
  }
  // A celebration belongs to the live game on screen: leaving that game ends it.
  if (celebratingId !== null && (mode !== 'game' || state.game.id !== celebratingId)) {
    celebration?.hide();
    celebratingId = null;
  }
  renderSeason(state.stats, mode === 'game' ? followedGameId() : null);
}

function renderPastNav(mode) {
  const withLink = mode === 'game' || mode === 'unavailable';
  allGamesLink.hidden = !withLink;
  // The banner is for a live game the screen is not showing.
  const current = currentGame();
  const showing = mode === 'game' && followedGameId() === currentGameId();
  const live = mode !== 'loading' && !showing && current?.status === 'live' ? current : null;
  liveBanner.hidden = live === null;
  pastNav.hidden = !withLink && live === null;
  if (live === null) return;
  const { us, them } = deriveScore(live.events);
  bannerText.textContent = t('liveBanner', {
    opponent: live.opponent, us, them, period: periodLabel(live.period),
  });
}

// A throw here must never skip the rest of the render.
function celebrateIfNew() {
  try {
    if (goals) celebrateGoal(goals.next(state.game, state.gameMeta ?? {}));
  } catch (err) {
    console.warn('Goal celebration failed', err);
  }
}

function celebrateGoal(goal) {
  if (!goal) return;
  celebratingId = state.game.id;
  const player = state.game.lineup.find(entry => entry.playerId === goal.playerId);
  celebration.show({
    scorer: player ? t('celebrateScorer', { cap: player.cap, name: player.name }) : null,
    manUp: manUpGoalIds(state.game).has(goal.id),
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

// One element per quarter so the line wraps only between quarters.
function renderQuarterScores(game) {
  const final = game.status === 'final';
  quarterScores.hidden = !final;
  if (!final) {
    clear(quarterScores), signatures.delete(quarterScores);
    return;
  }
  const quarters = quarterGoals(game.events);
  renderIfChanged(quarterScores, quarters, () => quarters.flatMap(([us, them], index) => [
    ...(index > 0 ? [' · '] : []),
    h('span', { class: 'quarter' }, `${periodLabel(index + 1)} ${us}–${them}`),
  ]));
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
  renderQuarterScores(game);
  liveBadge.hidden = !live;
  finalBadge.hidden = live;
  period.hidden = !live;
  period.textContent = live ? periodLabel(game.period) : '';
  opponent.textContent = game.opponent;
  gameDate.textContent = formatDate(game.date);
  const open = live ? replaySituations(game).open : null;
  situationBadge.hidden = open === null;
  situationBadge.textContent = open === null ? '' : t(open.kind === 'manUp' ? 'situationManUp' : 'situationManDown');
  const counts = situationCounts(game);
  gameManUp.textContent = manUpText(counts?.manUp ?? null);
  gameManDown.textContent = manDownText(counts?.manDown ?? null);

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
  // An older cached timeline() would list these as exclusions.
  const groups = timeline(game.events.filter(event => event.type !== 'save' && event.type !== 'gkIn'));
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
    'data-testid': 'timeline-item', 'data-side': entry.side, class: `tl-item tl-${entry.side}`, 'data-out': out ? 'true' : null,
  },
    h('span', { class: 'sr-only' }, `${periodLabel(event.period)} · `),
    entry.side === 'them' ? null : icon,
    h('span', { class: 'sr-only' }, `${entry.sr}${tagged ? ` · ${t('tlManUpTag')}` : ''} · `),
    text,
    tagged ? h('span', { class: 'tl-tag', 'data-testid': 'tl-manup', 'aria-hidden': 'true' }, t('tlManUpTag')) : null,
    entry.side === 'them' ? icon : null);
}

function renderSeason(stats, openId) {
  renderIfChanged(seasonSection, [stats ?? null, openId], () => {
    const results = stats?.results ?? [];
    const players = Object.entries(stats?.players ?? {})
      .map(([id, player]) => ({ id, ...player }))
      .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name));
    const goalies = Object.entries(stats?.goalies ?? {})
      .map(([id, goalie]) => ({ id, ...goalie }))
      .sort((a, b) => (b.saves + b.penSaves) - (a.saves + a.penSaves) || a.name.localeCompare(b.name));
    if (!results.length && !players.length && !goalies.length) return [];
    return [h('section', { class: 'section' },
      h('h2', {}, t('seasonHeading')),
      stats?.situations ? h('p', { class: 'situation-figures', 'data-testid': 'season-situations' },
        h('span', { class: 'situation-figure' }, manUpText(stats.situations.manUp)),
        h('span', { class: 'situation-figure' }, manDownText(stats.situations.manDown))) : null,
      results.length ? resultsTable(results, openId) : null,
      players.length ? totalsTable(players) : null,
      goalies.length ? seasonGoaliesTable(goalies) : null)];
  });
}

function resultsTable(results, openId) {
  return h('table', { class: 'results', 'aria-label': t('resultsHeading') }, h('tbody', {}, results.map(result => {
    // A 0 – 0 shootout means none was played (older games recorded it that way).
    const text = scoreText(result, result.soUs != null && !(result.soUs === 0 && result.soThem === 0));
    const isOpen = result.gameId != null && result.gameId === openId;
    return h('tr', {
      'data-testid': 'result-row', class: isOpen ? 'is-open' : null, 'aria-current': isOpen ? 'page' : null,
    },
      h('td', { class: 'muted' }, formatDate(result.date)),
      h('td', {}, result.gameId == null ? result.opponent : h('a', {
        class: 'result-link',
        href: `#/game/${encodeURIComponent(result.gameId)}`,
        'data-testid': 'result-link',
        'aria-label': t('openGameFor', { opponent: result.opponent, date: formatDate(result.date) }),
      }, result.opponent)),
      h('td', { class: 'result-score' }, text.main,
        text.shootout ? h('span', { class: 'pen' }, text.shootout) : null),
      h('td', { class: 'muted result-situations', 'data-testid': 'result-situations' },
        situationShort(result.manUp ? { manUp: result.manUp, manDown: result.manDown } : null)));
  })));
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

render();
