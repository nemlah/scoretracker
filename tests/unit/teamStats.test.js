import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEvent } from '../../js/model.js';
import { replaySituations } from '../../js/situations.js';
import { gameTeamStats, pct, seasonTeamStats } from '../../js/teamStats.js';
import { teamGame, teamGameExpected } from '../fixtures/team-game.js';
import {
  seasonStatsFull, seasonStatsFullExpected, seasonStatsOld, seasonStatsOldExpected,
} from '../fixtures/season-stats.js';

const ev = (type, period, ts, playerId = null, id = `e${ts}`) => makeEvent(type, period, playerId, ts, id);
const game = (events, extra = {}) => ({ ...teamGame, events, ...extra });

test('a tracked game without events has zero counts and no runs or trouble', () => {
  assert.deepEqual(gameTeamStats(game([])), {
    tracked: true,
    manUp: { quarters: Array.from({ length: 4 }, () => ({ played: 0, scored: 0 })), played: 0, scored: 0 },
    manDown: { quarters: Array.from({ length: 4 }, () => ({ played: 0, stopped: 0 })), played: 0, stopped: 0 },
    goals: { for: 0, against: 0, manUpFor: 0, manDownAgainst: 0 },
    fouls: { quarters: Array.from({ length: 4 }, () => ({ excl: 0, pens: 0 })), excl: 0, pens: 0 },
    trouble: [],
    pensAgainst: { faced: 0, saved: 0 },
    flow: { biggestLead: 0, longestRun: null, ties: 0, neverBehind: true, scorers: 0 },
  });
});

test('a 0–3 loss never leads and gives the opponent the longest run', () => {
  const stats = gameTeamStats(game([ev('oppGoal', 1, 1), ev('oppGoal', 2, 2), ev('oppGoal', 2, 3)]));
  assert.deepEqual(stats.goals, { for: 0, against: 3, manUpFor: 0, manDownAgainst: 0 });
  assert.deepEqual(stats.flow, {
    biggestLead: 0, longestRun: { us: 0, them: 3 }, ties: 0, neverBehind: false, scorers: 0,
  });
});

test('an untracked game still counts goals and fouls', () => {
  const { situations, ...untracked } = teamGame;
  const stats = gameTeamStats(untracked);
  assert.equal(stats.tracked, false);
  assert.equal(stats.manUp, null);
  assert.equal(stats.manDown, null);
  assert.deepEqual(stats.goals, { for: 5, against: 3, manUpFor: null, manDownAgainst: null });
  assert.deepEqual(stats.fouls, teamGameExpected.fouls);
});

test('shootout goals, fouls and penalty saves are excluded from regulation figures', () => {
  const regulation = [ev('goal', 4, 1, 'p7'), ev('oppGoal', 4, 2)];
  const shootout = [
    ev('manUp', 'SO', 3), ev('goal', 'SO', 4, 'p12'), ev('goal', 'SO', 5, 'p12'),
    ev('excl', 'SO', 6, 'p7'), ev('oppGoal', 'SO', 7),
    ev('pen', 'SO', 8, 'p12'), ev('penSave', 'SO', 9, 'p1'),
  ];
  assert.deepEqual(gameTeamStats(game([...regulation, ...shootout], { period: 'SO' })),
    gameTeamStats(game(regulation)));
});

test('a third foul in the shootout fouls out the player without adding to quarter fouls', () => {
  const stats = gameTeamStats(game([
    ev('excl', 1, 1, 'p7'), ev('pen', 4, 2, 'p7'), ev('excl', 'SO', 3, 'p7'),
  ], { period: 'SO' }));
  assert.deepEqual(stats.trouble, [{ playerId: 'p7', name: 'Άρης Λάμπρου', cap: 7, fouls: 3, out: true }]);
  assert.deepEqual(stats.fouls, {
    quarters: [{ excl: 1, pens: 0 }, { excl: 0, pens: 0 }, { excl: 0, pens: 0 }, { excl: 0, pens: 1 }],
    excl: 1,
    pens: 1,
  });
});

test('deleting a man-up start leaves an orphan end with no effect', () => {
  const goal = ev('goal', 1, 3, 'p7');
  const orphan = game([ev('manUpEnd', 1, 2), goal]);
  assert.deepEqual(replaySituations(orphan).closed, []);
  assert.deepEqual(gameTeamStats(orphan), gameTeamStats(game([goal])));
});

test('two penalty fouls and one exclusion cause a foul-out', () => {
  const stats = gameTeamStats(game([ev('pen', 1, 1, 'p7'), ev('excl', 2, 2, 'p7'), ev('pen', 4, 3, 'p7')]));
  assert.deepEqual(stats.trouble, [{ playerId: 'p7', name: 'Άρης Λάμπρου', cap: 7, fouls: 3, out: true }]);
});

test('trouble lists players on two fouls first and sorts each group by cap', () => {
  const lineup = [
    { playerId: 'p9', name: 'Nine', cap: 9 },
    { playerId: 'p12', name: 'Twelve', cap: 12 },
    { playerId: 'p4', name: 'Four', cap: 4 },
    { playerId: 'p3', name: 'Three', cap: 3 },
  ];
  const fouls = ['p9', 'p9', 'p12', 'p12', 'p12', 'p12', 'p4', 'p4', 'p3', 'p3', 'p3'];
  const stats = gameTeamStats(game(fouls.map((id, index) => ev('excl', 1, index + 1, id)), { lineup }));
  assert.deepEqual(stats.trouble, [
    { playerId: 'p4', name: 'Four', cap: 4, fouls: 2, out: false },
    { playerId: 'p9', name: 'Nine', cap: 9, fouls: 2, out: false },
    { playerId: 'p3', name: 'Three', cap: 3, fouls: 3, out: true },
    { playerId: 'p12', name: 'Twelve', cap: 12, fouls: 4, out: true },
  ]);
});

test('our longest run wins a tie even when the opponent run is first', () => {
  const stats = gameTeamStats(game([
    ev('oppGoal', 1, 1), ev('oppGoal', 1, 2), ev('goal', 2, 3, 'p7'), ev('goal', 2, 4, 'p12'),
  ]));
  assert.deepEqual(stats.flow.longestRun, { us: 2, them: 0 });
});

test('game flow follows quarter order, not recording order', () => {
  const { flow } = gameTeamStats(game([
    ev('goal', 1, 1, 'p7'), ev('oppGoal', 2, 2), ev('oppGoal', 2, 3), ev('goal', 1, 4, 'p12'),
  ]));
  assert.equal(flow.biggestLead, 2);
  assert.equal(flow.ties, 1);
  assert.equal(flow.neverBehind, true);
  assert.deepEqual(flow.longestRun, { us: 2, them: 0 });
});

test('flow follows timestamp order and preserves input order for equal timestamps', () => {
  const events = Object.freeze([
    ev('goal', 1, 30, 'p7'), ev('oppGoal', 1, 10, null, 'z'), ev('goal', 1, 10, 'p7', 'a'), ev('oppGoal', 1, 20),
  ]);
  const stats = gameTeamStats(game(events));
  assert.deepEqual(stats.flow, {
    biggestLead: 0, longestRun: { us: 1, them: 0 }, ties: 2, neverBehind: false, scorers: 1,
  });
});

test('equal ts within a quarter keeps input order', () => {
  const { flow } = gameTeamStats(game([
    ev('oppGoal', 2, 10), ev('goal', 1, 20, 'p7', 'z'), ev('oppGoal', 1, 20, null, 'a'),
  ]));
  assert.deepEqual(flow, {
    biggestLead: 1, longestRun: { us: 0, them: 2 }, ties: 1, neverBehind: false, scorers: 1,
  });
});

test('goals without a regulation quarter do not affect team totals or flow', () => {
  const events = [
    { id: 'missing-period', type: 'goal', ts: 1, playerId: 'p7' },
    ev('oppGoal', 5, 2),
    ev('goal', 1, 3, 'p12'),
  ];
  assert.deepEqual(gameTeamStats(game(events)), gameTeamStats(game([events[2]])));
});

test('the tracked game fixture matches hand-counted team statistics', () => {
  assert.deepEqual(gameTeamStats(teamGame), teamGameExpected);
});

test('the full season fixture aggregates valid fields and reports their coverage', () => {
  const stats = seasonTeamStats(seasonStatsFull);
  assert.deepEqual(stats, seasonStatsFullExpected);
  assert.equal(stats.quarters.covered, 3);
  assert.equal(stats.quarters.of, 4);
  assert.equal(stats.total.situationGames, 3);
});

test('the old season fixture has no exclusion or quarter coverage', () => {
  const stats = seasonTeamStats(seasonStatsOld);
  assert.deepEqual(stats, seasonStatsOldExpected);
  assert.equal(stats.quarters.covered, 0);
  assert.equal(stats.total.exclGames, 0);
});

function assertDefinedStats(value) {
  assert.notEqual(value, undefined);
  assert.equal(Number.isNaN(value), false);
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) assertDefinedStats(child);
  }
}

test('missing and garbage season documents give empty statistics', () => {
  for (const input of [null, undefined, false, {}, { results: {} }]) {
    const stats = seasonTeamStats(input);
    assertDefinedStats(stats);
    assert.deepEqual(stats, {
      games: [],
      total: {
        manUp: { played: 0, scored: 0 }, manDown: { played: 0, stopped: 0 }, situationGames: 0, excl: 0, exclGames: 0,
      },
      quarters: {
        for: [0, 0, 0, 0], against: [0, 0, 0, 0], diff: [0, 0, 0, 0],
        totalFor: 0, totalAgainst: 0, totalDiff: 0, covered: 0, of: 0,
      },
      goals: { for: 0, against: 0, manUpFor: 0, manDownAgainst: 0, situationGames: 0, of: 0 },
    });
  }
});

test('malformed season fields are absent and do not contaminate other totals', () => {
  const unsafeCount = Number.MAX_VALUE;
  const unsafeQuarters = [{ us: unsafeCount, them: unsafeCount }, ...Array.from({ length: 3 }, () => ({ us: 0, them: 0 }))];
  const stats = seasonTeamStats({ results: [
    { us: 3, them: NaN, excl: -1, quarters: [[1, 2]], manUp: { played: 2, scored: 5 }, manDown: { played: 2, stopped: 1 } },
    {
      us: Infinity, them: 2, excl: 1.5,
      quarters: [{ us: 0, them: 0 }, { us: 1, them: 2 }, { us: 1, them: -1 }, { us: 2, them: 0 }],
      manUp: { played: 1, scored: 1 }, manDown: { played: 3, stopped: 1.5 },
    },
    {
      us: unsafeCount, them: unsafeCount, excl: unsafeCount, quarters: unsafeQuarters,
      manUp: { played: unsafeCount, scored: unsafeCount }, manDown: { played: 2, stopped: 1 },
    },
    {
      us: unsafeCount, them: unsafeCount, excl: unsafeCount, quarters: unsafeQuarters,
      manUp: { played: 2, scored: 1 }, manDown: { played: unsafeCount, stopped: unsafeCount },
    },
    null,
  ] });
  assert.deepEqual(stats.quarters, {
    for: [0, 0, 0, 0], against: [0, 0, 0, 0], diff: [0, 0, 0, 0],
    totalFor: 0, totalAgainst: 0, totalDiff: 0, covered: 0, of: 5,
  });
  assertDefinedStats(stats);
  assert.equal(stats.games.length, 5);
  for (const row of stats.games) {
    assert.equal(row.manUp, null);
    assert.equal(row.manDown, null);
    assert.equal(row.excl, null);
  }
  assert.deepEqual(stats.total, {
    manUp: { played: 0, scored: 0 }, manDown: { played: 0, stopped: 0 }, situationGames: 0, excl: 0, exclGames: 0,
  });
  assert.deepEqual(stats.goals, { for: 3, against: 2, manUpFor: 0, manDownAgainst: 0, situationGames: 0, of: 5 });
});

test('pct rounds finite ratios and rejects invalid inputs', () => {
  assert.equal(pct(3, 5), 60);
  assert.equal(pct(2, 3), 67);
  assert.equal(pct(0, 5), 0);
  assert.equal(pct(0, 0), null);
  assert.equal(pct(1, NaN), null);
  assert.equal(pct(-1, 4), null);
  assert.equal(pct(Infinity, 4), null);
});
