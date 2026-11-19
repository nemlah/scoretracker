import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewerState } from '../../js/model.js';

const calendarSeason = '2026-27';
const pastSeason = '2025-26';
const homeRoute = { kind: 'home' };
const gameRoute = id => ({ kind: 'game', id });
const cached = { fromCache: true };
const failed = { error: true };
const watch = (key, data, meta) => ({ key, data, meta });
const teamWatch = (data, meta) => ({ data, meta });
const pointsTo = id => teamWatch({ currentGameId: id });
const liveGame = (id, season = pastSeason) => ({ id, season, status: 'live' });
const finalGame = (id, season = pastSeason) => ({ id, season, status: 'final' });
const statsWith = gameId => ({ results: [{ gameId }] });

function homePlan({ mode = 'home', live = null, season = null, results = 'loading', banner = null } = {}) {
  return {
    watch: { game: null, live, stats: season },
    tracked: { team: true, game: false, live: true, stats: true },
    mode, season, results, banner,
  };
}

function gamePlan(id, mode, { live = null, banner = null } = {}) {
  return {
    watch: { game: id, live, stats: null },
    tracked: { team: true, game: true, live: false, stats: false },
    mode, season: null, results: null, banner,
  };
}

function sequence() {
  let input = {
    route: homeRoute,
    team: teamWatch(undefined),
    game: watch(null, undefined),
    live: watch(null, undefined),
    stats: watch(null, undefined),
    offline: false,
    calendarSeason,
    lastSeason: null,
    lastShown: null,
  };

  return (event, updates, expected) => {
    input = { ...input, ...updates };
    const plan = viewerState(input);
    assert.deepEqual(plan, expected, event);
    input.lastSeason = plan.season ?? input.lastSeason;
    input.lastShown = {
      gameKey: plan.watch.game,
      mode: plan.mode,
      statsKey: plan.watch.stats,
      results: plan.results,
    };
  };
}

test('a direct game link opens independently of the team snapshot', () => {
  const step = sequence();
  step('open #/game/g1', { route: gameRoute('g1') }, gamePlan('g1', 'loading'));
  step('game arrives first', { game: watch('g1', liveGame('g1')) }, gamePlan('g1', 'game'));
  step('team points to the routed game', { team: pointsTo('g1') }, gamePlan('g1', 'game'));
});

test('a failed routed-game watch settles as unavailable and can recover', () => {
  const step = sequence();
  step('open #/game/g1', { route: gameRoute('g1') }, gamePlan('g1', 'loading'));
  step('routed-game watch fails', { game: watch('g1', null, failed) }, gamePlan('g1', 'unavailable'));
  step('game arrives', { game: watch('g1', finalGame('g1')) }, gamePlan('g1', 'game'));
});

test('a failed current-game watch keeps the published season', () => {
  const step = sequence();
  step('current game establishes its season', {
    team: pointsTo('g1'), live: watch('g1', liveGame('g1')),
    stats: watch(pastSeason, statsWith('g0')),
  }, homePlan({ live: 'g1', season: pastSeason, results: 'ready', banner: { gameId: 'g1' } }));
  step('current-game watch fails', { live: watch('g1', null, { ...cached, ...failed }) },
    homePlan({ live: 'g1', season: pastSeason, results: 'ready' }));
});

test('a failed current-game watch uses the calendar season on a cold start', () => {
  const step = sequence();
  step('team pointer arrives', { team: pointsTo('g1') }, homePlan({ live: 'g1' }));
  step('current-game watch fails', { live: watch('g1', null, failed) },
    homePlan({ live: 'g1', season: calendarSeason }));
  step('calendar stats arrive', { stats: watch(calendarSeason, null) },
    homePlan({ live: 'g1', season: calendarSeason, results: 'empty' }));
});

test('a cached current game resolves the season immediately', () => {
  const step = sequence();
  step('team waits for its first snapshot', {}, homePlan({ mode: 'loading' }));
  step('cached pointer arrives', { team: teamWatch({ currentGameId: 'g1' }, cached) },
    homePlan({ live: 'g1' }));
  step('cached game arrives', { live: watch('g1', liveGame('g1'), cached) },
    homePlan({ live: 'g1', season: pastSeason, banner: { gameId: 'g1' } }));
  step('cached stats arrive', { stats: watch(pastSeason, statsWith('g0'), cached) },
    homePlan({ live: 'g1', season: pastSeason, results: 'ready', banner: { gameId: 'g1' } }));
});

test('an online current-game cache miss keeps a published season and its results', () => {
  const step = sequence();
  step('season and results are visible', {
    team: pointsTo('g1'), live: watch('g1', finalGame('g1')), stats: watch(pastSeason, statsWith('g1')),
  }, homePlan({ live: 'g1', season: pastSeason, results: 'ready' }));
  step('team points to another game', { team: pointsTo('g2') },
    homePlan({ live: 'g2', season: pastSeason, results: 'ready' }));
  step('new game is missing from cache', { live: watch('g2', null, cached) },
    homePlan({ live: 'g2', season: pastSeason, results: 'ready' }));
});

test('an online current-game cache miss leaves the season unresolved on a cold start', () => {
  const step = sequence();
  step('team pointer arrives', { team: pointsTo('g1') }, homePlan({ live: 'g1' }));
  step('current game is missing from cache', { live: watch('g1', null, cached) }, homePlan({ live: 'g1' }));
  step('server confirms the game is missing', { live: watch('g1', null) },
    homePlan({ live: 'g1', season: calendarSeason }));
});

test('a cached roster-only team waits for a server pointer without publishing the calendar season', () => {
  const step = sequence();
  step('cached roster arrives', { team: teamWatch({ roster: [] }, cached) }, homePlan());
  step('server supplies a current-game pointer', { team: pointsTo('g1') }, homePlan({ live: 'g1' }));
  step('current game arrives from another season', { live: watch('g1', liveGame('g1')) },
    homePlan({ live: 'g1', season: pastSeason, banner: { gameId: 'g1' } }));
});

test('a team watch failure uses the calendar season on a cold start', () => {
  const step = sequence();
  step('team is pending', {}, homePlan({ mode: 'loading' }));
  step('cached team miss is unresolved', { team: teamWatch(null, cached) }, homePlan());
  step('team watch fails', { team: teamWatch(null, failed) }, homePlan({ season: calendarSeason }));
  step('stats settle', { stats: watch(calendarSeason, null) },
    homePlan({ season: calendarSeason, results: 'empty' }));
});

test('a team watch failure keeps the published season and results', () => {
  const step = sequence();
  step('season and results are visible', {
    team: pointsTo('g1'), live: watch('g1', finalGame('g1')), stats: watch(pastSeason, statsWith('g1')),
  }, homePlan({ live: 'g1', season: pastSeason, results: 'ready' }));
  step('team watch fails', { team: teamWatch(null, failed) },
    homePlan({ season: pastSeason, results: 'ready' }));
});

test('offline resolves a cached roster-only team and reconnect holds empty results', () => {
  const step = sequence();
  step('cached roster arrives online', { team: teamWatch({ roster: [] }, cached) }, homePlan());
  step('connection drops', { offline: true }, homePlan({ season: calendarSeason }));
  step('stats miss in cache', { stats: watch(calendarSeason, null, cached) },
    homePlan({ season: calendarSeason, results: 'empty' }));
  step('reconnect before server replies', { offline: false },
    homePlan({ season: calendarSeason, results: 'empty' }));
  step('team confirms there is no pointer', { team: teamWatch({ roster: [] }) },
    homePlan({ season: calendarSeason, results: 'empty' }));
  step('stats arrive from the server', { stats: watch(calendarSeason, statsWith('g1')) },
    homePlan({ season: calendarSeason, results: 'ready' }));
});

test('offline resolves a cached miss for the current game', () => {
  const step = sequence();
  step('game is missing in the online cache', { team: pointsTo('g1'), live: watch('g1', null, cached) },
    homePlan({ live: 'g1' }));
  step('connection drops', { offline: true }, homePlan({ live: 'g1', season: calendarSeason }));
  step('reconnect before server replies', { offline: false }, homePlan({ live: 'g1', season: calendarSeason }));
});

test('reconnect holds an unavailable routed game only for the same id', () => {
  const step = sequence();
  step('game is missing in the online cache', { route: gameRoute('g1'), game: watch('g1', null, cached) },
    gamePlan('g1', 'loading'));
  step('connection drops', { offline: true }, gamePlan('g1', 'unavailable'));
  step('reconnect before server replies', { offline: false }, gamePlan('g1', 'unavailable'));
  step('server confirms the game is missing', { game: watch('g1', null) }, gamePlan('g1', 'unavailable'));
  step('open another id while the old watch is still stored', { route: gameRoute('g2') },
    gamePlan('g2', 'loading'));
  step('new game arrives', { game: watch('g2', finalGame('g2')) }, gamePlan('g2', 'game'));
});

test('failed stats report failure and recover through empty to ready', () => {
  const step = sequence();
  step('team resolves the calendar season', { team: teamWatch(null) }, homePlan({ season: calendarSeason }));
  step('stats watch fails', { stats: watch(calendarSeason, null, { ...cached, ...failed }) },
    homePlan({ season: calendarSeason, results: 'failed' }));
  step('server supplies an empty results array', { stats: watch(calendarSeason, { results: [] }) },
    homePlan({ season: calendarSeason, results: 'empty' }));
  step('server supplies results', { stats: watch(calendarSeason, statsWith('g1')) },
    homePlan({ season: calendarSeason, results: 'ready' }));
});

test('each watch can fail on home without putting an established screen back into loading', () => {
  const step = sequence();
  const ready = homePlan({ live: 'g1', season: pastSeason, results: 'ready' });
  step('home is ready', {
    team: pointsTo('g1'), live: watch('g1', finalGame('g1')), stats: watch(pastSeason, statsWith('g1')),
  }, ready);
  step('old routed-game watch fails', { game: watch('g2', null, failed) }, ready);
  step('current-game watch fails', { live: watch('g1', null, failed) }, ready);
  step('team watch fails', { team: teamWatch(null, failed) }, homePlan({ season: pastSeason, results: 'ready' }));
  step('stats watch fails', { stats: watch(pastSeason, null, failed) },
    homePlan({ season: pastSeason, results: 'failed' }));
});

test('each watch can fail on a game route without leaving it loading', () => {
  const step = sequence();
  step('past game and current game are visible', {
    route: gameRoute('g1'), team: pointsTo('g2'),
    game: watch('g1', finalGame('g1')), live: watch('g2', liveGame('g2')),
  }, gamePlan('g1', 'game', { live: 'g2', banner: { gameId: 'g2' } }));
  step('old stats watch fails', { stats: watch(pastSeason, null, failed) },
    gamePlan('g1', 'game', { live: 'g2', banner: { gameId: 'g2' } }));
  step('live watch fails', { live: watch('g2', null, failed) }, gamePlan('g1', 'game', { live: 'g2' }));
  step('team watch fails', { team: teamWatch(null, failed) }, gamePlan('g1', 'game'));
  step('routed-game watch fails', { game: watch('g1', null, failed) }, gamePlan('g1', 'unavailable'));
});

test('team-first pointer moves keep stats until a game from another season arrives', () => {
  const step = sequence();
  step('first game and its season are visible', {
    team: pointsTo('g1'), live: watch('g1', liveGame('g1')), stats: watch(pastSeason, statsWith('g0')),
  }, homePlan({ live: 'g1', season: pastSeason, results: 'ready', banner: { gameId: 'g1' } }));
  step('pointer moves before game in the same season', { team: pointsTo('g2') },
    homePlan({ live: 'g2', season: pastSeason, results: 'ready' }));
  step('same-season game arrives', { live: watch('g2', liveGame('g2')) },
    homePlan({ live: 'g2', season: pastSeason, results: 'ready', banner: { gameId: 'g2' } }));
  step('pointer moves before game in another season', { team: pointsTo('g3') },
    homePlan({ live: 'g3', season: pastSeason, results: 'ready' }));
  step('other-season game arrives while old stats remain stored', { live: watch('g3', liveGame('g3', calendarSeason)) },
    homePlan({ live: 'g3', season: calendarSeason, banner: { gameId: 'g3' } }));
  step('other-season stats arrive', { stats: watch(calendarSeason, statsWith('g4')) },
    homePlan({ live: 'g3', season: calendarSeason, results: 'ready', banner: { gameId: 'g3' } }));
});

test('deletion before the pointer moves keeps the season until the team confirms no pointer', () => {
  const step = sequence();
  step('season and results are visible', {
    team: pointsTo('g1'), live: watch('g1', liveGame('g1')), stats: watch(pastSeason, statsWith('g0')),
  }, homePlan({ live: 'g1', season: pastSeason, results: 'ready', banner: { gameId: 'g1' } }));
  step('server confirms game deletion', { live: watch('g1', null) },
    homePlan({ live: 'g1', season: pastSeason, results: 'ready' }));
  step('team clears the pointer', { team: pointsTo(null) }, homePlan({ season: calendarSeason }));
});

test('stale stats data and errors are ignored and stats for the retained season are read', () => {
  const step = sequence();
  step('live game resolves a different season than the stored stats', {
    team: pointsTo('g1'), live: watch('g1', finalGame('g1')), stats: watch(calendarSeason, statsWith('g0')),
  }, homePlan({ live: 'g1', season: pastSeason }));
  step('stale stats watch reports an error', { stats: watch(calendarSeason, null, failed) },
    homePlan({ live: 'g1', season: pastSeason }));
  step('matching stats arrive', { stats: watch(pastSeason, statsWith('g1')) },
    homePlan({ live: 'g1', season: pastSeason, results: 'ready' }));
  step('new pointer leaves published season unresolved', { team: pointsTo('g2'), live: watch('g2', undefined) },
    homePlan({ live: 'g2', season: pastSeason, results: 'ready' }));
});

test('a live game finishing on home removes the banner and results follow stats', () => {
  const step = sequence();
  step('live game and empty results are shown', {
    team: pointsTo('g1'), live: watch('g1', liveGame('g1')), stats: watch(pastSeason, null),
  }, homePlan({ live: 'g1', season: pastSeason, results: 'empty', banner: { gameId: 'g1' } }));
  step('game finishes before stats update', { live: watch('g1', finalGame('g1')) },
    homePlan({ live: 'g1', season: pastSeason, results: 'empty' }));
  step('stats include the final', { stats: watch(pastSeason, statsWith('g1')) },
    homePlan({ live: 'g1', season: pastSeason, results: 'ready' }));
});

test('a routed live game stays open when it finishes before the pointer moves', () => {
  const step = sequence();
  step('viewer is on the current game', {
    route: gameRoute('g1'), team: pointsTo('g1'), game: watch('g1', liveGame('g1')),
  }, gamePlan('g1', 'game'));
  step('game finishes first', { game: watch('g1', finalGame('g1')) }, gamePlan('g1', 'game'));
  step('pointer moves next', { team: pointsTo('g2') }, gamePlan('g1', 'game', { live: 'g2' }));
});

test('a routed live game stays open when the pointer moves before the final snapshot', () => {
  const step = sequence();
  step('viewer is on the current game', {
    route: gameRoute('g1'), team: pointsTo('g1'), game: watch('g1', liveGame('g1')),
  }, gamePlan('g1', 'game'));
  step('pointer moves first', { team: pointsTo('g2') }, gamePlan('g1', 'game', { live: 'g2' }));
  step('game finishes next', { game: watch('g1', finalGame('g1')) }, gamePlan('g1', 'game', { live: 'g2' }));
});

test('a past-game route shows the banner for another live game after the routed game loads', () => {
  const step = sequence();
  step('current game is live while the routed game loads', {
    route: gameRoute('g1'), team: pointsTo('g2'), live: watch('g2', liveGame('g2')),
    game: watch('g0', finalGame('g0')),
  }, gamePlan('g1', 'loading', { live: 'g2' }));
  step('routed game arrives', { game: watch('g1', finalGame('g1')) },
    gamePlan('g1', 'game', { live: 'g2', banner: { gameId: 'g2' } }));
});

test('an invalid route is unavailable without requesting a routed game or stats', () => {
  const step = sequence();
  const unavailable = {
    watch: { game: null, live: null, stats: null },
    tracked: { team: true, game: false, live: false, stats: false },
    mode: 'unavailable', season: null, results: null, banner: null,
  };
  step('open an invalid link', { route: { kind: 'invalid' } }, unavailable);
  step('team supplies a live pointer', { team: pointsTo('g1') },
    { ...unavailable, watch: { ...unavailable.watch, live: 'g1' } });
  step('current game arrives', { live: watch('g1', liveGame('g1')) },
    { ...unavailable, watch: { ...unavailable.watch, live: 'g1' }, banner: { gameId: 'g1' } });
});

test('#/ and #/games both enter viewerState as a home route', () => {
  const step = sequence();
  step('open #/', { route: { kind: 'home' } }, homePlan({ mode: 'loading' }));
  step('team and stats are visible', { team: teamWatch(null), stats: watch(calendarSeason, null) },
    homePlan({ season: calendarSeason, results: 'empty' }));
  step('open #/games', { route: { kind: 'home' } }, homePlan({ season: calendarSeason, results: 'empty' }));
});
