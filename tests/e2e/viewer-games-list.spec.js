import { test, expect } from '@playwright/test';
import { seasonFor, todayIso } from '../../js/model.js';
import { closeAll, resetAll, seed, update } from './helpers.js';
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
const ev = (type, period = 1, playerId) => ({
  id: `e${clock}`, type, period, ts: (clock += 10), ...(playerId ? { playerId } : {}),
});

const pastEvents = [ev('goal', 1, 'p5'), ev('goal', 2, 'p2'), ev('oppGoal', 2)];
const liveEvents = [ev('goal', 1, 'p5')];

// g1 is a finished game; g2 is the current game, live or final; both are in the season results.
const seedGames = ({ liveOpponent = 'Waves', currentStatus = 'live' } = {}) => Promise.all([
  seed('team/main', { currentGameId: 'g2', roster }),
  seed('games/g1', {
    opponent: 'Rivals', date: '2026-11-01', season: '2026-27', status: 'final', period: 4, lineup, events: pastEvents,
  }),
  seed('games/g2', {
    opponent: liveOpponent, date: '2026-11-08', season: '2026-27', status: currentStatus, period: 1, lineup, events: liveEvents,
  }),
  seed('stats/2026-27', {
    players: { p5: { name: 'Alexiou', games: 2, goals: 2, excl: 0 } },
    results: [
      { gameId: 'g1', date: '2026-11-01', opponent: 'Rivals', us: 2, them: 1 },
      { gameId: 'g2', date: '2026-11-08', opponent: liveOpponent, us: 1, them: 0 },
    ],
  }),
]);

let problems;
test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(`console: ${message.text()}`);
  });
  await resetAll();
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});
test.afterAll(closeAll);

const open = (page, hash = '') => page.goto(`/index.html?emulator=1${hash}`);
const hashOf = page => page.evaluate(() => location.hash);
const opponentName = page => page.locator('p.team-name');
const gamesList = page => page.getByTestId('games-list');
const allGames = page => page.getByTestId('all-games');
const banner = page => page.getByTestId('live-banner');

test('home with a final current game shows the games list', async ({ page }) => {
  await seedGames({ currentStatus: 'final' });
  await open(page);
  await expect(gamesList(page)).toBeVisible();
  await expect(gamesList(page).locator('h1')).toHaveText('ANOG');
  await expect(page.getByTestId('score-us')).toBeHidden();
  await expect(page.getByTestId('result-link')).toHaveCount(2);
  await expect(allGames(page)).toBeHidden();
  await expect(banner(page)).toBeHidden();
  await expect(page.getByTestId('result-row').filter({ has: page.locator('[aria-current="page"]') })).toHaveCount(0);
});

test('home with a live current game shows the live game', async ({ page }) => {
  await seedGames();
  await open(page);
  await expect(opponentName(page)).toHaveText('Waves');
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await expect(page.getByTestId('live-badge')).toBeVisible();
  await expect(allGames(page)).toBeVisible();
  await expect(allGames(page)).toHaveText('← All games');
  await expect(allGames(page)).toHaveAttribute('href', '#/games');
  await expect(banner(page)).toBeHidden();
  await expect(gamesList(page)).toBeHidden();
});

test('home with a live game never flashes the list', async ({ page }) => {
  await seedGames();
  await page.addInitScript(() => {
    window.__listShown = false;
    setInterval(() => {
      const list = document.querySelector('[data-testid="games-list"]');
      if (list && !list.hidden) window.__listShown = true;
    }, 50);
  });
  await open(page);
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__listShown)).toBe(false);
});

test('home with no current game but past results shows the list', async ({ page }) => {
  await Promise.all([
    seed('team/main', { roster }),
    seed(`stats/${seasonFor(todayIso())}`, { results: [{ gameId: 'g1', date: '2026-11-01', opponent: 'Rivals', us: 2, them: 1 }] }),
  ]);
  await open(page);
  await expect(gamesList(page)).toBeVisible();
  await expect(page.getByTestId('result-link')).toHaveCount(1);
  await expect(page.getByTestId('empty-state')).toBeHidden();
});

test('#/games shows the list and the live banner while a game is live', async ({ page }) => {
  await seedGames();
  await open(page, '#/games');
  await expect(gamesList(page)).toBeVisible();
  await expect(page.getByTestId('score-us')).toBeHidden();
  await expect(allGames(page)).toBeHidden();
  await expect(page.getByTestId('result-link')).toHaveCount(2);
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toContainText('Live: Waves 1–0 · Q1');
  await expect(page.getByTestId('watch-live')).toHaveAttribute('href', '#/');
  await page.getByTestId('watch-live').click();
  await expect.poll(() => hashOf(page)).toBe('#/');
  await expect(opponentName(page)).toHaveText('Waves');
  await expect(page.getByTestId('live-badge')).toBeVisible();
  await expect(gamesList(page)).toBeHidden();
  await expect(banner(page)).toBeHidden();
});

test('#/games without a live game shows the list and no banner', async ({ page }) => {
  await seedGames({ currentStatus: 'final' });
  await open(page, '#/games');
  await expect(gamesList(page)).toBeVisible();
  await expect(banner(page)).toBeHidden();
});

test('the All games link opens the list from a past game and from the live game', async ({ page }) => {
  await seedGames();
  await open(page, '#/game/g1');
  await expect(opponentName(page)).toHaveText('Rivals');
  await expect(allGames(page)).toBeVisible();
  await allGames(page).click();
  await expect.poll(() => hashOf(page)).toBe('#/games');
  await expect(gamesList(page)).toBeVisible();
  await expect(allGames(page)).toBeHidden();

  await page.getByTestId('watch-live').click();
  await expect(opponentName(page)).toHaveText('Waves');
  await allGames(page).click();
  await expect.poll(() => hashOf(page)).toBe('#/games');
  await expect(gamesList(page)).toBeVisible();
  await expect(page.getByTestId('result-link')).toHaveCount(2);
});

test('a route to the live game shows it, with All games and no banner', async ({ page }) => {
  await seedGames();
  await open(page, '#/game/g2');
  await expect(opponentName(page)).toHaveText('Waves');
  await expect(page.getByTestId('live-badge')).toBeVisible();
  await expect(allGames(page)).toBeVisible();
  await expect(banner(page)).toBeHidden();
});

test('a watched game that ends stays on its final score', async ({ page }) => {
  await seedGames();
  await open(page);
  await expect(page.getByTestId('live-badge')).toBeVisible();
  const before = await page.evaluate(() => history.length);
  await update('games/g2', { status: 'final' });
  await expect(page.getByTestId('final-badge')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('live-badge')).toBeHidden();
  await expect(opponentName(page)).toHaveText('Waves');
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await expect(gamesList(page)).toBeHidden();
  await expect(allGames(page)).toBeVisible();
  expect(await hashOf(page)).toBe('#/game/g2');
  expect(await page.evaluate(() => history.length)).toBe(before);
  await page.reload();
  await expect(page.getByTestId('final-badge')).toBeVisible();
  await expect(opponentName(page)).toHaveText('Waves');
  await expect(gamesList(page)).toBeHidden();
  // Reloading aborts the streams that were open; that is not an app error.
  dropNetworkNoise(problems);
});

test('a game starting while on the list shows the banner, and home shows it live', async ({ page }) => {
  await Promise.all([
    seed('team/main', { currentGameId: 'g1', roster }),
    seed('games/g1', {
      opponent: 'Rivals', date: '2026-11-01', season: '2026-27', status: 'final', period: 4, lineup, events: pastEvents,
    }),
    seed('games/g2', {
      opponent: 'Waves', date: '2026-11-08', season: '2026-27', status: 'live', period: 1, lineup, events: liveEvents,
    }),
    seed('stats/2026-27', { results: [{ gameId: 'g1', date: '2026-11-01', opponent: 'Rivals', us: 2, them: 1 }] }),
  ]);
  await open(page, '#/games');
  await expect(gamesList(page)).toBeVisible();
  await expect(banner(page)).toBeHidden();
  await update('team/main', { currentGameId: 'g2' });
  await expect(banner(page)).toBeVisible({ timeout: 5000 });
  await expect(banner(page)).toContainText('Live: Waves 1–0 · Q1');
  await expect(gamesList(page)).toBeVisible();
  await open(page, '#/');
  await expect(opponentName(page)).toHaveText('Waves');
  await expect(page.getByTestId('live-badge')).toBeVisible();
  await expect(banner(page)).toBeHidden();
  await expect(gamesList(page)).toBeHidden();
});

test('no celebration on the list; celebrations still fire on the live game', async ({ page }) => {
  await seedGames();
  await open(page, '#/games');
  await expect(banner(page)).toContainText('Waves 1–0');
  await update('games/g2', { events: [...liveEvents, ev('goal', 1, 'p2')] });
  await expect(banner(page)).toContainText('Waves 2–0', { timeout: 5000 });
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('celebration')).toBeHidden();
  // Arriving at the live game does not celebrate the goals it already has.
  await page.getByTestId('watch-live').click();
  await expect(page.getByTestId('score-us')).toHaveText('2');
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('celebration')).toBeHidden();
  await update('games/g2', { events: [...liveEvents, ev('goal', 1, 'p2'), ev('goal', 2, 'p5')] });
  await expect(page.getByTestId('celebration')).toBeVisible();
});

test('no games at all shows the empty state', async ({ page }) => {
  await open(page, '#/games');
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await expect(gamesList(page)).toBeHidden();
  await expect(banner(page)).toBeHidden();
  await open(page, '#/');
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await expect(gamesList(page)).toBeHidden();
});

test('no sideways scroll at 360 px on the list with the banner', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await seedGames({ liveOpponent: 'Panathinaikos Athletic Club Water Polo Federation' });
  await open(page, '#/games');
  await expect(banner(page)).toBeVisible();
  await expect(gamesList(page)).toBeVisible();
  await expect(page.getByTestId('result-link')).toHaveCount(2);
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
});
