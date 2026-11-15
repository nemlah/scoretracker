import { test, expect } from '@playwright/test';
import { closeAll, resetAll, seed, update } from './helpers.js';

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

// g1 is a finished game, g2 is the current (live) game; both are in the season results.
const seedBoth = ({ liveOpponent = 'Waves', currentStatus = 'live' } = {}) => Promise.all([
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
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
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
const resultLink = (page, id) => page.locator(`[data-testid="result-link"][href="#/game/${id}"]`);

test('a results row opens that past game and the back link returns', async ({ page }) => {
  await seedBoth();
  await open(page);
  await expect(opponentName(page)).toHaveText('Waves');
  await expect(page.getByTestId('back-to-current')).toBeHidden();
  await resultLink(page, 'g1').click();
  await expect.poll(() => hashOf(page)).toBe('#/game/g1');
  await expect(opponentName(page)).toHaveText('Rivals');
  await expect(page.getByTestId('final-badge')).toBeVisible();
  await expect(page.getByTestId('score-us')).toHaveText('2');
  await expect(page.getByTestId('score-them')).toHaveText('1');
  await expect(page.getByTestId('back-to-current')).toBeVisible();
  await expect(page.getByTestId('back-to-current')).toHaveText('← Back to current game');
  await page.getByTestId('back-to-current').click();
  await expect.poll(() => hashOf(page)).toBe('#/');
  await expect(opponentName(page)).toHaveText('Waves');
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await expect(page.getByTestId('back-to-current')).toBeHidden();
});

test('result links are real links with a descriptive label', async ({ page }) => {
  await seedBoth();
  await open(page);
  const link = resultLink(page, 'g1');
  await expect(link).toHaveText('Rivals');
  await expect(link).toHaveAttribute('aria-label', 'Open the game against Rivals on 01/11/2026');
  expect(await link.evaluate(el => el.tagName)).toBe('A');
});

test('a shared #/game link opens that game directly', async ({ page }) => {
  await seedBoth();
  await open(page, '#/game/g1');
  await expect(opponentName(page)).toHaveText('Rivals');
  await expect(page.getByTestId('final-badge')).toBeVisible();
  await expect(page.getByTestId('timeline-item')).toHaveCount(3);
  await expect(page.getByTestId('back-to-current')).toBeVisible();
});

test('the open game is marked in the results list', async ({ page }) => {
  await seedBoth();
  await open(page, '#/game/g1');
  const rows = page.getByTestId('result-row');
  await expect(rows).toHaveCount(2);
  const marked = rows.filter({ has: resultLink(page, 'g1') });
  await expect(marked).toHaveAttribute('aria-current', 'page');
  await expect(marked).toHaveClass(/is-open/);
  const other = rows.filter({ has: resultLink(page, 'g2') });
  await expect(other).not.toHaveAttribute('aria-current', 'page');
  await resultLink(page, 'g2').click();
  await expect(other).toHaveAttribute('aria-current', 'page');
  await expect(marked).not.toHaveAttribute('aria-current', 'page');
});

test('browser back returns to the current game', async ({ page }) => {
  await seedBoth();
  await open(page);
  await expect(opponentName(page)).toHaveText('Waves');
  await resultLink(page, 'g1').click();
  await expect(opponentName(page)).toHaveText('Rivals');
  await page.goBack();
  await expect(opponentName(page)).toHaveText('Waves');
  await expect(page.getByTestId('back-to-current')).toBeHidden();
  await expect(page.getByTestId('live-badge')).toBeVisible();
});

test('the live banner appears, updates, and leaves when the live game ends', async ({ page }) => {
  await seedBoth();
  await open(page, '#/game/g1');
  const banner = page.getByTestId('live-banner');
  await expect(opponentName(page)).toHaveText('Rivals');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Live: Waves 1–0 · Q1');
  await update('games/g2', { events: [...liveEvents, ev('oppGoal', 1)], period: 2 });
  await expect(banner).toContainText('Live: Waves 1–1 · Q2', { timeout: 5000 });
  await update('games/g2', { status: 'final' });
  await expect(banner).toBeHidden({ timeout: 5000 });
  await expect(opponentName(page)).toHaveText('Rivals');
  await expect(page.getByTestId('back-to-current')).toBeVisible();
});

test('the banner does not cover the scoreboard', async ({ page }) => {
  await seedBoth();
  await open(page, '#/game/g1');
  await expect(page.getByTestId('live-banner')).toBeVisible();
  await expect(page.getByTestId('score-us')).toBeVisible();
  const banner = await page.getByTestId('live-banner').boundingBox();
  const board = await page.getByTestId('score-us').boundingBox();
  expect(banner.y + banner.height).toBeLessThanOrEqual(board.y);
});

test('Watch opens the live game', async ({ page }) => {
  await seedBoth();
  await open(page, '#/game/g1');
  await expect(page.getByTestId('live-banner')).toBeVisible();
  await expect(page.getByTestId('watch-live')).toHaveAttribute('href', '#/');
  await page.getByTestId('watch-live').click();
  await expect.poll(() => hashOf(page)).toBe('#/');
  await expect(opponentName(page)).toHaveText('Waves');
  await expect(page.getByTestId('live-badge')).toBeVisible();
  await expect(page.getByTestId('live-banner')).toBeHidden();
  await expect(page.getByTestId('back-to-current')).toBeHidden();
});

test('no banner when the current game is not live', async ({ page }) => {
  await seedBoth({ currentStatus: 'final' });
  await open(page, '#/game/g1');
  await expect(opponentName(page)).toHaveText('Rivals');
  await expect(page.getByTestId('back-to-current')).toBeVisible();
  await expect(page.getByTestId('live-banner')).toBeHidden();
});

test('a route to the current game shows no back link or banner', async ({ page }) => {
  await seedBoth();
  await open(page, '#/game/g2');
  await expect(opponentName(page)).toHaveText('Waves');
  await expect(page.getByTestId('live-badge')).toBeVisible();
  await expect(page.getByTestId('back-to-current')).toBeHidden();
  await expect(page.getByTestId('live-banner')).toBeHidden();
});

test('a link to a deleted game says it isn\'t available', async ({ page }) => {
  await seedBoth();
  await open(page, '#/game/nope');
  await expect(page.getByTestId('game-unavailable')).toBeVisible();
  await expect(page.getByTestId('game-unavailable')).toContainText('That game isn\'t available.');
  await expect(page.getByTestId('back-to-current')).toBeVisible();
  await expect(page.getByTestId('empty-state')).toBeHidden();
  await page.getByTestId('back-to-current').click();
  await expect(opponentName(page)).toHaveText('Waves');
  await expect(page.getByTestId('game-unavailable')).toBeHidden();
});

for (const hash of ['#/game/a%2Fb', '#/game/%E0%A4%A']) {
  test(`a malformed game link shows the unavailable message (${hash})`, async ({ page }) => {
    await seedBoth();
    await open(page, hash);
    await expect(page.getByTestId('game-unavailable')).toBeVisible();
    await expect(page.getByTestId('back-to-current')).toBeVisible();
    await expect(page.getByTestId('empty-state')).toBeHidden();
    await expect(page.getByTestId('result-link')).toHaveCount(2);
    await page.getByTestId('back-to-current').click();
    await expect(opponentName(page)).toHaveText('Waves');
  });
}

test('returning to the live game does not celebrate old goals', async ({ page }) => {
  await seedBoth();
  await open(page);
  await expect(opponentName(page)).toHaveText('Waves');
  await resultLink(page, 'g1').click();
  await expect(opponentName(page)).toHaveText('Rivals');
  await expect(page.getByTestId('live-banner')).toContainText('Waves 1–0');
  await update('games/g2', { events: [...liveEvents, ev('goal', 1, 'p2')] });
  await expect(page.getByTestId('live-banner')).toContainText('Waves 2–0', { timeout: 5000 });
  await page.getByTestId('watch-live').click();
  await expect(opponentName(page)).toHaveText('Waves');
  await expect(page.getByTestId('score-us')).toHaveText('2');
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('celebration')).toBeHidden();
  await update('games/g2', { events: [...liveEvents, ev('goal', 1, 'p2'), ev('goal', 2, 'p5')] });
  await expect(page.getByTestId('celebration')).toBeVisible();
});

test('opening a past game does not celebrate', async ({ page }) => {
  await seedBoth();
  await open(page);
  await expect(opponentName(page)).toHaveText('Waves');
  await resultLink(page, 'g1').click();
  await expect(opponentName(page)).toHaveText('Rivals');
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('celebration')).toBeHidden();
});

test('opening a game scrolls to the top', async ({ page }) => {
  await seedBoth();
  await page.setViewportSize({ width: 360, height: 400 });
  await open(page);
  await expect(resultLink(page, 'g1')).toBeVisible();
  await resultLink(page, 'g1').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await resultLink(page, 'g1').click();
  await expect(opponentName(page)).toHaveText('Rivals');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test('no sideways scroll at 360 px with the banner and back link showing', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await seedBoth({ liveOpponent: 'Panathinaikos Athletic Club Water Polo Federation' });
  await open(page, '#/game/g1');
  await expect(page.getByTestId('live-banner')).toBeVisible();
  await expect(page.getByTestId('back-to-current')).toBeVisible();
  await expect(page.getByTestId('result-link')).toHaveCount(2);
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
});
