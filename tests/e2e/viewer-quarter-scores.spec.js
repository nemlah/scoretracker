import { test, expect } from '@playwright/test';
import { closeAll, resetAll, seed, update } from './helpers.js';

const roster = [{ id: 'p5', name: 'Alexiou', cap: 5, archived: false }];
const lineup = [{ playerId: 'p5', name: 'Alexiou', cap: 5 }];
let clock = 1000;
const ev = (type, period) => ({
  id: `e${clock}`, type, period, ts: (clock += 10), ...(type === 'goal' ? { playerId: 'p5' } : {}),
});
// quarter(period, us, them): that many goals for each side in one period.
const quarter = (period, us, them) => [
  ...Array.from({ length: us }, () => ev('goal', period)),
  ...Array.from({ length: them }, () => ev('oppGoal', period)),
];

const seedGame = (events, { status = 'final', opponent = 'Rivals' } = {}) => Promise.all([
  seed('team/main', { currentGameId: 'g1', roster }),
  seed('games/g1', {
    opponent, date: '2026-11-01', season: '2026-27', status, period: status === 'live' ? 2 : 4, lineup, events,
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
const line = page => page.getByTestId('quarter-scores');

test('quarter scores on a final game', async ({ page }) => {
  await seedGame([...quarter(1, 2, 1), ...quarter(2, 0, 1), ...quarter(4, 1, 2)]);
  await open(page, '#/game/g1');
  await expect(line(page)).toBeVisible();
  await expect(line(page)).toHaveText('Q1 2–1 · Q2 0–1 · Q3 0–0 · Q4 1–2');
  await expect(page.getByTestId('score-us')).toHaveText('3');
  await expect(page.getByTestId('score-them')).toHaveText('4');
});

test('shootout goals are not in the quarter line', async ({ page }) => {
  await seedGame([
    ...quarter(1, 1, 0), ...quarter(2, 0, 1), ...quarter(3, 1, 1), ...quarter(4, 0, 0),
    ev('goal', 'SO'), ev('goal', 'SO'), ev('oppGoal', 'SO'),
  ]);
  await open(page, '#/game/g1');
  await expect(line(page)).toHaveText('Q1 1–0 · Q2 0–1 · Q3 1–1 · Q4 0–0');
  await expect(page.getByTestId('shootout')).toBeVisible();
});

test('no quarter line on a live game', async ({ page }) => {
  await seedGame([...quarter(1, 2, 1)], { status: 'live' });
  await open(page, '#/game/g1');
  await expect(page.getByTestId('live-badge')).toBeVisible();
  await expect(page.getByTestId('score-us')).toHaveText('2');
  await expect(line(page)).toBeHidden();
  await expect(line(page)).toHaveText('');
});

test('quarter scores appear when a watched game ends', async ({ page }) => {
  await seedGame([...quarter(1, 1, 0), ...quarter(2, 1, 2)], { status: 'live' });
  await open(page, '#/game/g1');
  await expect(page.getByTestId('live-badge')).toBeVisible();
  await expect(line(page)).toBeHidden();
  await update('games/g1', { status: 'final', period: 4 });
  await expect(line(page)).toBeVisible({ timeout: 5000 });
  await expect(line(page)).toHaveText('Q1 1–0 · Q2 1–2 · Q3 0–0 · Q4 0–0');
  await expect(page.getByTestId('final-badge')).toBeVisible();
});

test('quarter scores wrap between quarters, never inside one', async ({ page }) => {
  await seedGame([...quarter(1, 10, 11), ...quarter(2, 12, 10), ...quarter(3, 11, 12), ...quarter(4, 10, 10)],
    { opponent: 'Panathinaikos Water Polo Club Of Athens' });
  await page.setViewportSize({ width: 360, height: 740 });
  await open(page, '#/game/g1');
  await expect(line(page)).toHaveText('Q1 10–11 · Q2 12–10 · Q3 11–12 · Q4 10–10');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  // Narrow further: at 360 px and even 300 px the condensed font keeps the line on one row.
  await page.setViewportSize({ width: 240, height: 740 });
  const quarters = line(page).locator('span');
  await expect(quarters).toHaveCount(4);
  const measure = () => page.evaluate(() => {
    const items = [...document.querySelector('[data-testid="quarter-scores"]').children];
    return {
      rects: items.map(item => item.getClientRects().length),
      tops: items.map(item => Math.round(item.getBoundingClientRect().top)),
    };
  });
  // The quarters sit on at least two distinct rows, and none is split across rows.
  await expect.poll(async () => new Set((await measure()).tops).size).toBeGreaterThan(1);
  expect((await measure()).rects).toEqual([1, 1, 1, 1]);
  // A separator is bound to the quarter before it: no loose text between the quarters, so a row
  // can end with the dot but never starts with one.
  const loose = await page.evaluate(() => [...document.querySelector('[data-testid="quarter-scores"]').childNodes]
    .filter(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '').length);
  expect(loose).toBe(0);
  const texts = await page.evaluate(() => [...document.querySelector('[data-testid="quarter-scores"]').children].map(item => item.textContent));
  expect(texts).toEqual(['Q1 10–11 ·', 'Q2 12–10 ·', 'Q3 11–12 ·', 'Q4 10–10']);
});

test('no quarter line when the quarters do not add up to the score', async ({ page }) => {
  // A goal in a period outside Q1-Q4 still counts in the score but belongs to no quarter.
  await seedGame([...quarter(1, 1, 1), ev('goal', 5)]);
  await open(page, '#/game/g1');
  await expect(page.getByTestId('final-badge')).toBeVisible();
  await expect(page.getByTestId('score-us')).toHaveText('2');
  await expect(page.getByTestId('score-them')).toHaveText('1');
  await expect(line(page)).toBeHidden();
  await expect(line(page)).toHaveText('');
});
