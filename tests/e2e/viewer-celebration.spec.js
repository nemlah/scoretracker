import { test, expect } from '@playwright/test';
import { closeAll, resetAll, seed, update } from './helpers.js';
import { dropNetworkNoise } from './tracker-helpers.js';

const roster = [
  { id: 'p5', name: 'Alexiou', cap: 5, archived: false },
  { id: 'p2', name: 'Papadakis', cap: 2, archived: false },
];
const lineup = [
  { playerId: 'p2', name: 'Papadakis', cap: 2 },
  { playerId: 'p5', name: 'Alexiou', cap: 5 },
];

let clock = 1000;
const ev = (type, period = 1, playerId) => ({
  id: `e${clock}`, type, period, ts: (clock += 10), ...(playerId ? { playerId } : {}),
});

const seedGame = (events = [], extra = {}) => Promise.all([
  seed('team/main', { currentGameId: 'g1', roster }),
  seed('games/g1', {
    opponent: 'Opponent FC', date: '2026-11-08', season: '2026-27',
    status: 'live', period: 1, lineup, events, ...extra,
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
const celebration = page => page.getByTestId('celebration');

test('a new goal of ours celebrates with the scorer, then hides', async ({ page }) => {
  await seedGame();
  await open(page);
  await expect(page.getByTestId('score-us')).toHaveText('0');
  await expect(celebration(page)).toBeHidden();
  await update('games/g1', { events: [ev('goal', 1, 'p5')] });
  await expect(celebration(page)).toBeVisible();
  await expect(page.getByTestId('celebration-goal')).toHaveText('GOAL!');
  await expect(page.getByTestId('celebration-scorer')).toHaveText('#5 Alexiou');
  await expect(celebration(page)).toBeHidden({ timeout: 4000 });
});

test('a man-up goal says so; an unknown scorer shows GOAL! alone', async ({ page }) => {
  await seedGame([], { situations: true });
  await open(page);
  await expect(page.getByTestId('score-us')).toHaveText('0');
  const events = [ev('manUp'), ev('goal', 1, 'p5')];
  await update('games/g1', { events });
  await expect(page.getByTestId('celebration-scorer')).toHaveText('#5 Alexiou · man-up');
  await expect(celebration(page)).toBeHidden({ timeout: 4000 });
  await update('games/g1', { events: [...events, ev('goal', 1)] });
  await expect(page.getByTestId('celebration-goal')).toHaveText('GOAL!');
  await expect(page.getByTestId('celebration-scorer')).toBeHidden();
});

test('no celebration on load, on Undo, on a scorer change, for opponent goals, or on a final game', async ({ page }) => {
  const first = ev('goal', 1, 'p5');
  const second = ev('goal', 1, 'p2');
  await seedGame([first, second]);
  await open(page);
  await expect(page.getByTestId('score-us')).toHaveText('2');
  await page.waitForTimeout(1500);
  await expect(celebration(page)).toBeHidden();

  await update('games/g1', { events: [first] }); // Undo
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await page.waitForTimeout(300);
  await expect(celebration(page)).toBeHidden();

  await update('games/g1', { events: [{ ...first, playerId: 'p2' }] }); // scorer change, same id
  await expect(page.getByTestId('timeline-item')).toContainText('#2 Papadakis');
  await page.waitForTimeout(300);
  await expect(celebration(page)).toBeHidden();

  await update('games/g1', { events: [{ ...first, playerId: 'p2' }, ev('oppGoal', 1)] });
  await expect(page.getByTestId('score-them')).toHaveText('1');
  await page.waitForTimeout(300);
  await expect(celebration(page)).toBeHidden();

  await update('games/g1', { status: 'final', events: [{ ...first, playerId: 'p2' }, ev('oppGoal', 1), ev('goal', 1, 'p5')] });
  await expect(page.getByTestId('final-badge')).toBeVisible();
  await expect(page.getByTestId('score-us')).toHaveText('2');
  await page.waitForTimeout(300);
  await expect(celebration(page)).toBeHidden();
});

test('reopening the viewer after goals were scored does not celebrate', async ({ page }) => {
  await seedGame([ev('goal', 1, 'p5')]);
  await open(page);
  await expect(page.getByTestId('score-us')).toHaveText('1');
  const context = page.context();
  await page.close();
  await update('games/g1', { events: [ev('goal', 1, 'p5'), ev('goal', 1, 'p2')] });
  const again = await context.newPage();
  again.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  await open(again);
  await expect(again.getByTestId('score-us')).toHaveText('2');
  await again.waitForTimeout(1500);
  await expect(celebration(again)).toBeHidden();
  dropNetworkNoise(problems);
});

test('a second goal restarts the celebration with the new scorer', async ({ page }) => {
  const first = ev('goal', 1, 'p5');
  await seedGame();
  await open(page);
  await expect(page.getByTestId('score-us')).toHaveText('0');
  await update('games/g1', { events: [first] });
  await expect(page.getByTestId('celebration-scorer')).toHaveText('#5 Alexiou');
  await page.waitForTimeout(800);
  await update('games/g1', { events: [first, ev('goal', 1, 'p2')] });
  await expect(page.getByTestId('celebration-scorer')).toHaveText('#2 Papadakis');
  await page.waitForTimeout(2000);
  await expect(celebration(page)).toBeVisible();
  await expect(celebration(page)).toBeHidden({ timeout: 3000 });
});

test('the celebration survives a following update', async ({ page }) => {
  const first = ev('goal', 1, 'p5');
  await seedGame();
  await open(page);
  await expect(page.getByTestId('score-us')).toHaveText('0');
  await update('games/g1', { events: [first] });
  await expect(celebration(page)).toBeVisible();
  await page.waitForTimeout(500);
  await update('games/g1', { events: [first, ev('oppGoal', 1)] });
  await expect(page.getByTestId('score-them')).toHaveText('1');
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await expect(celebration(page)).toBeVisible();
});

test('the overlay does not block the page', async ({ page }) => {
  await seedGame();
  await open(page);
  await expect(page.getByTestId('score-us')).toHaveText('0');
  await update('games/g1', { events: [ev('goal', 1, 'p5')] });
  await expect(celebration(page)).toBeVisible();
  const blocked = await page.evaluate(() => {
    const name = [...document.querySelectorAll('.scoreboard .team-name')].find(el => el.textContent === 'Opponent FC');
    const box = name.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return Boolean(hit?.closest('[data-testid="celebration"]'));
  });
  expect(blocked).toBe(false);
  await page.getByTestId('celebration-banner').click();
  await expect(celebration(page)).toBeHidden();
});

test('reduced motion shows only the banner', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedGame();
  await open(page);
  await expect(page.getByTestId('score-us')).toHaveText('0');
  await update('games/g1', { events: [ev('goal', 1, 'p5')] });
  await expect(page.getByTestId('celebration-banner')).toBeVisible();
  await expect(page.locator('.celebration-wave')).toBeHidden();
  await expect(page.locator('.celebration-ball')).toBeHidden();
});

test('no sideways scroll at 360 px during a celebration', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await seedGame();
  await open(page);
  await expect(page.getByTestId('score-us')).toHaveText('0');
  await update('games/g1', { events: [ev('goal', 1, 'p5')] });
  await expect(celebration(page)).toBeVisible();
  for (const wait of [100, 500, 700]) {
    await page.waitForTimeout(wait);
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(fits).toBe(true);
  }
});

test('on a short landscape screen the banner never covers the score and the net stays on screen', async ({ page }) => {
  await page.setViewportSize({ width: 740, height: 360 });
  await seedGame();
  await open(page);
  await expect(page.getByTestId('score-us')).toHaveText('0');
  await update('games/g1', { events: [ev('goal', 1, 'p5')] });
  await expect(celebration(page)).toBeVisible();
  let elapsed = 0;
  for (const at of [300, 1000, 2000]) {
    await page.waitForTimeout(at - elapsed);
    elapsed = at;
    const result = await page.evaluate(() => {
      const box = el => el.getBoundingClientRect();
      const banner = box(document.querySelector('[data-testid="celebration-banner"]'));
      const net = box(document.querySelector('.celebration-net'));
      const overlaps = el => {
        const b = box(el);
        return b.left < banner.right && b.right > banner.left && b.top < banner.bottom && b.bottom > banner.top;
      };
      return {
        score: ['score-us', 'score-them'].map(id => overlaps(document.querySelector(`[data-testid="${id}"]`))),
        net: net.left >= 0 && net.top >= 0 && net.right <= innerWidth && net.bottom <= innerHeight,
        banner: banner.left >= 0 && banner.top >= 0 && banner.right <= innerWidth && banner.bottom <= innerHeight,
      };
    });
    expect(result, `at ${at} ms`).toEqual({ score: [false, false], net: true, banner: true });
  }
});
