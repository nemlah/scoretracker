import { test, expect } from '@playwright/test';
import { closeAll, remove, resetAll, seed, update } from './helpers.js';
import { dropNetworkNoise } from './tracker-helpers.js';

const roster = [
  { id: 'p5', name: 'Alexiou', cap: 5, archived: false },
  { id: 'p2', name: 'Papadakis', cap: 2, archived: false },
];
const lineup = [
  { playerId: 'p5', name: 'Alexiou', cap: 5 },
  { playerId: 'p2', name: 'Papadakis', cap: 2 },
];
let clock = 1000;
const ev = (type, period, playerId) => ({
  id: `e${clock}`, type, period, ts: (clock += 10), ...(playerId ? { playerId } : {}),
});

const liveEvents = () => [
  ev('goal', 1, 'p5'), ev('goal', 1, 'p2'), ev('oppGoal', 1),
  ev('goal', 2, 'p5'), ev('oppGoal', 2),
  ev('excl', 2, 'p2'), ev('excl', 2, 'p2'), ev('excl', 2, 'p2'),
];

const seedLive = (events = liveEvents()) => Promise.all([
  seed('team/main', { currentGameId: 'g1', roster }),
  seed('games/g1', {
    opponent: 'Opponent FC', date: '2026-11-08', season: '2026-27',
    status: 'live', period: 2, lineup, events,
  }),
]);

let problems;
test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  await resetAll();
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});
test.afterAll(closeAll);

const open = page => page.goto('/index.html?emulator=1');

test('empty state when there is no team or game', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('empty-state')).toBeVisible();
});

test('live game', async ({ page }) => {
  await seedLive();
  await open(page);
  await expect(page.getByTestId('score-us')).toHaveText('3');
  await expect(page.getByTestId('score-them')).toHaveText('2');
  await expect(page.getByTestId('period')).toHaveText('Q2');
  await expect(page.getByTestId('live-badge')).toBeVisible();
  await expect(page.getByTestId('final-badge')).toBeHidden();
  await expect(page.getByTestId('game-date')).toHaveText('08/11/2026');
  await expect(page.getByTestId('empty-state')).toBeHidden();
  const rows = page.getByTestId('player-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toHaveAttribute('data-cap', '2');
  const papadakis = page.locator('[data-testid="player-row"][data-cap="2"]');
  await expect(papadakis.getByTestId('player-out')).toBeVisible();
  await expect(papadakis.getByTestId('player-excl')).toHaveText('3');
  await expect(papadakis.getByTestId('player-goals')).toHaveText('1');
  await expect(page.locator('[data-testid="player-row"][data-cap="5"]').getByTestId('player-out')).toHaveCount(0);
  await expect(page.getByTestId('timeline-item').first()).toContainText('Q2');
  await expect(page.getByTestId('timeline-item')).toHaveCount(8);
});

test('updates live without reload', async ({ page }) => {
  const events = liveEvents();
  await seedLive(events);
  await open(page);
  await expect(page.getByTestId('score-us')).toHaveText('3');
  await update('games/g1', { events: [...events, ev('goal', 2, 'p5')] });
  await expect(page.getByTestId('score-us')).toHaveText('4', { timeout: 5000 });
  await expect(page.getByTestId('timeline-item')).toHaveCount(9);
});

test('final with shootout and season tables', async ({ page }) => {
  const events = [];
  for (let i = 0; i < 9; i += 1) events.push(ev('goal', (i % 4) + 1, i % 2 ? 'p5' : 'p2'), ev('oppGoal', (i % 4) + 1));
  for (let i = 0; i < 4; i += 1) events.push(ev('goal', 'SO', 'p5'));
  for (let i = 0; i < 3; i += 1) events.push(ev('oppGoal', 'SO'));
  await Promise.all([
    seed('team/main', { currentGameId: 'g1', roster }),
    seed('games/g1', {
      opponent: 'Opponent FC', date: '2026-11-08', season: '2026-27',
      status: 'final', period: 'SO', lineup, events,
    }),
    seed('stats/2026-27', {
      players: {
        p2: { name: 'Papadakis', games: 2, goals: 3, excl: 1 },
        p5: { name: 'Alexiou', games: 2, goals: 8, excl: 0 },
      },
      results: [
        { gameId: 'g1', date: '2026-11-08', opponent: 'Opponent FC', us: 9, them: 9, soUs: 4, soThem: 3 },
        { gameId: 'g0', date: '2026-11-01', opponent: 'Harbour WPC', us: 7, them: 5 },
      ],
    }),
  ]);
  await open(page);
  await expect(page.getByTestId('final-badge')).toBeVisible();
  await expect(page.getByTestId('live-badge')).toBeHidden();
  await expect(page.getByTestId('score-us')).toHaveText('9');
  await expect(page.getByTestId('score-them')).toHaveText('9');
  await expect(page.getByTestId('shootout')).toHaveText('(4 – 3 pen.)');
  await expect(page.getByTestId('result-row')).toHaveCount(2);
  await expect(page.getByTestId('result-row').first()).toContainText('Opponent FC');
  const seasonRows = page.getByTestId('season-row');
  await expect(seasonRows).toHaveCount(2);
  await expect(seasonRows.first()).toContainText('Alexiou');
  await expect(seasonRows.last()).toContainText('Papadakis');
});

test('game deleted while watching shows the empty state', async ({ page }) => {
  await seedLive();
  await open(page);
  await expect(page.getByTestId('score-us')).toHaveText('3');
  await remove('games/g1');
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await expect(page.getByTestId('score-us')).toBeHidden();
});

const finalGame = (season, opponent, date) => ({
  opponent, date, season, status: 'final', period: 4, lineup,
  events: [ev('goal', 1, 'p5'), ev('goal', 2, 'p2'), ev('oppGoal', 3)],
});

test('the viewer follows currentGameId from last week\'s final to a new live game', async ({ page }) => {
  await Promise.all([
    seed('team/main', { currentGameId: 'g1', roster }),
    seed('games/g1', finalGame('2026-27', 'Last Week FC', '2026-11-01')),
    seed('games/g2', {
      opponent: 'This Week FC', date: '2026-11-08', season: '2026-27', status: 'live', period: 1,
      lineup, events: [ev('goal', 1, 'p5')],
    }),
  ]);
  await open(page);
  await expect(page.getByTestId('final-badge')).toBeVisible();
  await expect(page.getByText('Last Week FC')).toBeVisible();
  await expect(page.getByTestId('score-us')).toHaveText('2');
  await expect(page.getByTestId('score-them')).toHaveText('1');

  await update('team/main', { currentGameId: 'g2' });
  await expect(page.getByTestId('live-badge')).toBeVisible();
  await expect(page.getByTestId('final-badge')).toBeHidden();
  await expect(page.getByText('This Week FC')).toBeVisible();
  await expect(page.getByText('Last Week FC')).toHaveCount(0);
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await expect(page.getByTestId('score-them')).toHaveText('0');
  // Updates of the new game arrive; the dropped one is no longer listened to.
  await update('games/g2', { events: [ev('goal', 1, 'p5'), ev('goal', 1, 'p2')] });
  await expect(page.getByTestId('score-us')).toHaveText('2');
  await update('games/g1', { events: [] });
  await page.waitForTimeout(300);
  await expect(page.getByTestId('score-us')).toHaveText('2');
});

test('the viewer switches the season tables when the game it shows belongs to another season', async ({ page }) => {
  await Promise.all([
    seed('team/main', { currentGameId: 'g1', roster }),
    seed('games/g1', finalGame('2025-26', 'Old Season FC', '2026-06-01')),
    seed('games/g2', finalGame('2026-27', 'New Season FC', '2026-11-08')),
    seed('stats/2025-26', {
      players: { p5: { name: 'Alexiou', games: 5, goals: 11, excl: 2 } },
      results: [{ gameId: 'g1', date: '2026-06-01', opponent: 'Old Season FC', us: 2, them: 1 }],
    }),
    seed('stats/2026-27', {
      players: { p2: { name: 'Papadakis', games: 1, goals: 4, excl: 0 } },
      results: [{ gameId: 'g2', date: '2026-11-08', opponent: 'New Season FC', us: 2, them: 1 }],
    }),
  ]);
  await open(page);
  await expect(page.getByTestId('result-row')).toHaveCount(1);
  await expect(page.getByTestId('result-row')).toContainText('Old Season FC');
  await expect(page.getByTestId('season-row')).toContainText('Alexiou');

  await update('team/main', { currentGameId: 'g2' });
  await expect(page.getByTestId('result-row')).toContainText('New Season FC');
  await expect(page.getByTestId('result-row')).toHaveCount(1);
  await expect(page.getByTestId('season-row')).toHaveCount(1);
  await expect(page.getByTestId('season-row')).toContainText('Papadakis');
  // The previous season's document is no longer followed.
  await update('stats/2025-26', { players: { p5: { name: 'Changed', games: 5, goals: 12, excl: 2 } } });
  await page.waitForTimeout(300);
  await expect(page.getByTestId('season-row')).toContainText('Papadakis');
});

test('a page restored from the back/forward cache is reloaded', async ({ page }) => {
  await seedLive();
  await open(page);
  await expect(page.getByTestId('score-us')).toHaveText('3');
  await page.evaluate(() => { window.__sameDocument = true; });
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })));
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await page.waitForFunction(() => window.__sameDocument === undefined);
  await expect(page.getByTestId('score-us')).toHaveText('3');
  // Reloading aborts the streams that were open; that is not an app error.
  dropNetworkNoise(problems);
});
