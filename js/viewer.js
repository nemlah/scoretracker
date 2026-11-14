import './sw-register.js';
import { team as teamConfig } from './config.js';
import { initFirebase } from './firebase.js';
import {
  deriveScore, foulOutIds, formatDate, hasShootout, playerLines, scoringLines, seasonFor, timeline, todayIso,
} from './model.js';
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
  stats: undefined,
  offline: !navigator.onLine,
  stale: false,
};

// Subscriptions keyed by what they watch, so a stale one is dropped when the key changes.
const subs = { game: { key: null, off: null }, stats: { key: null, off: null } };
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
  sub.off = subscribe((data, meta) => {
    if (sub.key !== key) return;
    state[name] = data;
    if (name === 'game') state.gameMeta = meta;
    trackConnection(name, meta);
    if (name === 'game') followSeason();
    render();
  });
}

function followSeason() {
  const season = state.game ? state.game.season : seasonFor(todayIso());
  resubscribe('stats', season, cb => repo.watchStats(season, cb));
}

function followTeam() {
  const gameId = state.team?.currentGameId ?? null;
  resubscribe('game', gameId, cb => repo.watchGame(gameId, cb));
  if (gameId === null) followSeason();
}

repo.watchTeam((data, meta) => {
  state.team = data;
  state.teamMeta = meta;
  trackConnection('team', meta);
  followTeam();
  render();
});

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
  h('div', { class: 'board-row' }, opponent, gameDate),
  h('div', { class: 'situation-figures' }, gameManUp, gameManDown));
const empty = h('section', { class: 'empty', 'data-testid': 'empty-state', hidden: true },
  h('h2', {}, t('emptyTitle')), h('p', {}, t('emptyBody')));
const gameSections = h('div', { class: 'stack' });
const seasonSection = h('div', { class: 'stack' });
root.append(note, scoreboard, empty, gameSections, seasonSection);

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

function viewMode() {
  const settled = (data, meta) => data !== undefined && (data !== null || !meta?.fromCache || isOffline());
  if (state.team === undefined) return 'loading';
  if (state.team === null || state.team.currentGameId == null) return settled(state.team, state.teamMeta) ? 'empty' : 'loading';
  if (state.game === undefined) return 'loading';
  if (state.game === null) return settled(state.game, state.gameMeta) ? 'empty' : 'loading';
  return 'game';
}

const isOffline = () => state.offline || state.stale;

function render() {
  const mode = viewMode();
  note.hidden = !isOffline();
  empty.hidden = mode !== 'empty';
  scoreboard.hidden = mode !== 'game';
  if (mode === 'game') renderGame(state.game);
  else clear(gameSections), signatures.delete(gameSections);
  renderSeason(state.stats);
}

function renderGame(game) {
  const score = deriveScore(game.events);
  const so = hasShootout(game.period, game.events);
  const text = scoreText(score, so);
  const live = game.status === 'live';
  setScore(scoreUs, score.us);
  setScore(scoreThem, score.them);
  shootout.hidden = text.shootout === null;
  shootout.textContent = text.shootout ?? '';
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
  renderIfChanged(gameSections, [game.lineup, game.events, game.situations === true, game.opponent], () => [
    timelineSection(game),
    playersSection(scoringLines(playerLines(game.lineup, game.events))),
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

function timelineSection(game) {
  const groups = timeline(game.events);
  const manUpGoals = manUpGoalIds(game);
  const outIds = foulOutIds(game.events);
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

function renderSeason(stats) {
  renderIfChanged(seasonSection, stats ?? null, () => {
    const results = stats?.results ?? [];
    const players = Object.entries(stats?.players ?? {})
      .map(([id, player]) => ({ id, ...player }))
      .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name));
    if (!results.length && !players.length) return [];
    return [h('section', { class: 'section' },
      h('h2', {}, t('seasonHeading')),
      stats?.situations ? h('p', { class: 'situation-figures', 'data-testid': 'season-situations' },
        h('span', { class: 'situation-figure' }, manUpText(stats.situations.manUp)),
        h('span', { class: 'situation-figure' }, manDownText(stats.situations.manDown))) : null,
      results.length ? resultsTable(results) : null,
      players.length ? totalsTable(players) : null)];
  });
}

function resultsTable(results) {
  return h('table', { class: 'results', 'aria-label': t('resultsHeading') }, h('tbody', {}, results.map(result => {
    const text = scoreText(result, result.soUs != null);
    return h('tr', { 'data-testid': 'result-row' },
      h('td', { class: 'muted' }, formatDate(result.date)),
      h('td', {}, result.opponent),
      h('td', { class: 'result-score' }, text.main,
        text.shootout ? h('span', { class: 'pen' }, text.shootout) : null),
      h('td', { class: 'muted result-situations', 'data-testid': 'result-situations' },
        situationShort(result.manUp ? { manUp: result.manUp, manDown: result.manDown } : null)));
  })));
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
