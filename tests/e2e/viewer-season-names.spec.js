import { test, expect } from './fixtures.js';
import { aggregateSeason, seasonFor, todayIso } from '../../js/model.js';
import { closeAll, consoleProblems, get, open, resetAll, seed, tab, update } from './helpers.js';
import { formatConsoleProblem } from './tracker-helpers.js';
import { isFirestoreChannelLoss } from './network-noise.js';

const SEASON = seasonFor(todayIso());
const roster = [
  { id: 'p1', name: 'Νέο', cap: 1, archived: false },
  { id: 'p2', name: 'Βήτα', cap: 2, archived: false },
  { id: 'g1', name: 'Άλφα Τερματοφύλακας', cap: 13, archived: false },
  { id: 'g2', name: 'Βήτα Τερματοφύλακας', cap: 1, archived: false },
];
const lineup = [
  { playerId: 'p1', name: 'Παλιό', cap: 1 },
  { playerId: 'p2', name: 'Βήτα', cap: 2 },
];
const finalGame = {
  id: 'g', opponent: 'Alpha FC', date: '2026-10-03', season: SEASON, status: 'final', period: 4, lineup,
  events: [
    { id: 'o', type: 'oppGoal', period: 1, ts: 1 },
    { id: 'a', type: 'goal', period: 1, ts: 10, playerId: 'p1' },
    { id: 'b', type: 'goal', period: 1, ts: 11, playerId: 'p2' },
    { id: 'c', type: 'goal', period: 1, ts: 12, playerId: 'p1' },
  ],
};
const line = { games: 1, goals: 1, saves: 0, penSaves: 0, goalsAgainst: 0 };
const goalie = name => ({ name, games: 1, saves: 5, penSaves: 0, goalsAgainst: 2 });

// Season totals with the names as they were stored. Ties are exact on goals and on saves + penalty saves.
async function seedAll({ stored, rosterNow = roster }) {
  const base = aggregateSeason([finalGame], roster);
  await seed('team/main', { roster: rosterNow });
  await seed(`stats/${SEASON}`, {
    ...base,
    players: {
      p1: { ...line, name: stored.p1 },
      p2: { ...line, name: stored.p2 },
      gone: { ...line, name: 'Ξένος' },
    },
    goalies: { g1: goalie(stored.g1), g2: goalie(stored.g2) },
  });
}
const names = (page, id) => page.getByTestId(id).locator('.who-name');

let problems;
test.beforeEach(async ({ page }) => {
  problems = consoleProblems(page, { ignore: isFirestoreChannelLoss, format: formatConsoleProblem });
  await resetAll();
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});
test.afterAll(closeAll);

async function openPlayers(page) {
  await open(page);
  await expect(page.getByTestId('result-row')).not.toHaveCount(0);
  await tab(page, 'players').click();
}

test('season totals show the roster\'s current name, falling back to the stored one', async ({ page }) => {
  await seedAll({ stored: { p1: 'Παλιό', p2: 'Βήτα', g1: 'Παλιός Γκολκίπερ', g2: 'Βήτα Τερματοφύλακας' } });
  await openPlayers(page);
  await expect(names(page, 'season-row')).toHaveText(['Βήτα', 'Νέο', 'Ξένος']);
  await expect(page.getByTestId('season-row').filter({ hasText: 'Παλιό' })).toHaveCount(0);
  await expect(names(page, 'season-goalie-row')).toHaveText(['Άλφα Τερματοφύλακας', 'Βήτα Τερματοφύλακας']);
});

test('a rename redraws the totals and goalies and their order without a stats write', async ({ page }) => {
  // Tied: p1 and p2 on one goal each, g1 and g2 on five saves each. Stored names sort A before B.
  await seedAll({ stored: { p1: 'Άλφα', p2: 'Βήτα', g1: 'Άλφα', g2: 'Βήτα' }, rosterNow: [
    { id: 'p1', name: 'Άλφα', cap: 1, archived: false },
    { id: 'p2', name: 'Βήτα', cap: 2, archived: false },
    { id: 'g1', name: 'Άλφα', cap: 13, archived: false },
    { id: 'g2', name: 'Βήτα', cap: 1, archived: false },
  ] });
  await openPlayers(page);
  await expect(names(page, 'season-row')).toHaveText(['Άλφα', 'Βήτα', 'Ξένος']);
  await expect(names(page, 'season-goalie-row')).toHaveText(['Άλφα', 'Βήτα']);
  const before = await get(`stats/${SEASON}`);

  await update('team/main', { roster: [
    { id: 'p1', name: 'Ωμέγα', cap: 1, archived: false },
    { id: 'p2', name: 'Βήτα', cap: 2, archived: false },
    { id: 'g1', name: 'Ωμέγα', cap: 13, archived: false },
    { id: 'g2', name: 'Βήτα', cap: 1, archived: false },
  ] });
  await expect(names(page, 'season-row')).toHaveText(['Βήτα', 'Ξένος', 'Ωμέγα']);
  await expect(names(page, 'season-goalie-row')).toHaveText(['Βήτα', 'Ωμέγα']);
  expect(await get(`stats/${SEASON}`)).toEqual(before);
});

test('a scoped Players view uses the current names too', async ({ page }) => {
  await seed('team/main', {
    roster, phases: { f1: { name: 'Regular season' } }, tournaments: { t1: { name: 'Spring Cup' } },
  });
  const games = [
    { ...finalGame, phaseId: 'f1' },
    { ...finalGame, id: 'h', opponent: 'Bravo FC', date: '2026-10-10', competition: 'tournament', tournamentId: 't1' },
  ];
  await seed(`stats/${SEASON}`, aggregateSeason(games, [
    { id: 'p1', name: 'Παλιό', cap: 1 }, { id: 'p2', name: 'Βήτα', cap: 2 },
  ]));
  await openPlayers(page);
  await page.getByTestId('scope-select').selectOption('tournament:t1');
  await expect(page.getByTestId('season-row')).toHaveCount(2);
  await expect(names(page, 'season-row')).toHaveText(['Νέο', 'Βήτα']);
});
