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

const seedGame = (events, { status = 'final', opponent = 'Rivals', period = status === 'live' ? 2 : 4 } = {}) => Promise.all([
  seed('team/main', { currentGameId: 'g1', roster }),
  seed('games/g1', {
    opponent, date: '2026-11-01', season: '2026-27', status, period, lineup, events,
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
const grid = page => page.getByTestId('quarter-scores');
const heads = page => grid(page).locator('thead th');
const goalsOf = (page, row) => page.getByTestId(row).locator('td');
const longGreek = 'Πανελλήνιος Γυμναστικός Σύλλογος Πειραιώς Ολυμπιακός';

test('the grid is a table: Q1 to Q4 in the head, our row, then theirs, labelled', async ({ page }) => {
  await seedGame([...quarter(1, 2, 1), ...quarter(2, 0, 1), ...quarter(4, 1, 2)]);
  await open(page, '#/game/g1');
  await expect(grid(page)).toBeVisible();
  expect(await grid(page).evaluate(el => el.tagName)).toBe('TABLE');
  await expect(heads(page)).toHaveText(['Q1', 'Q2', 'Q3', 'Q4']);
  await expect(goalsOf(page, 'quarter-us')).toHaveText(['2', '0', '0', '1']);
  await expect(goalsOf(page, 'quarter-them')).toHaveText(['1', '1', '0', '2']);
  await expect(page.getByTestId('quarter-us').locator('th')).toHaveText('ANOG');
  await expect(page.getByTestId('quarter-them').locator('th')).toHaveText('RIV');
  await expect(page.getByTestId('score-us')).toHaveText('3');
  await expect(page.getByTestId('score-them')).toHaveText('4');
  // Each head's text sits over its own column of numbers (the text, not the cell: a left-aligned head
  // has the same cell centre).
  const centres = await grid(page).evaluate(table => [...table.querySelectorAll('thead th')].map((head, i) => {
    const centre = el => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      return (r.left + r.right) / 2;
    };
    return Math.abs(centre(head) - centre(table.querySelectorAll('[data-testid="quarter-us"] td')[i]));
  }));
  expect(Math.max(...centres)).toBeLessThanOrEqual(1.5);
});

test('the grid label for an opponent starting with an accent drops it, in Greek capitals', async ({ page }) => {
  await seedGame([...quarter(1, 1, 1)], { opponent: 'Άρης Θεσσαλονίκης' });
  await open(page, '#/game/g1');
  await expect(page.getByTestId('quarter-them').locator('th')).toHaveText('ΑΡΗ');
});

test('a final game has all four numbers and no current quarter', async ({ page }) => {
  await seedGame([...quarter(1, 2, 1), ...quarter(2, 0, 1)]);
  await open(page, '#/game/g1');
  await expect(goalsOf(page, 'quarter-us')).toHaveText(['2', '0', '0', '0']);
  await expect(goalsOf(page, 'quarter-them')).toHaveText(['1', '1', '0', '0']);
  await expect(grid(page).locator('[aria-current]')).toHaveCount(0);
  await expect(page.getByTestId('final-badge')).toBeVisible();
});

test('a live game in Q3 marks Q3 as current and shows a dash for Q4', async ({ page }) => {
  await seedGame([...quarter(1, 2, 1), ...quarter(2, 1, 2), ...quarter(3, 1, 0)], { status: 'live', period: 3 });
  await open(page, '#/game/g1');
  await expect(page.getByTestId('live-badge')).toBeVisible();
  await expect(grid(page)).toBeVisible();
  await expect(goalsOf(page, 'quarter-us')).toHaveText(['2', '1', '1', '–']);
  await expect(goalsOf(page, 'quarter-them')).toHaveText(['1', '2', '0', '–']);
  await expect(grid(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(heads(page).nth(2)).toHaveAttribute('aria-current', 'true');
  await expect(heads(page).nth(0)).not.toHaveAttribute('aria-current', 'true');
  await expect(heads(page).nth(3)).not.toHaveAttribute('aria-current', 'true');
  // The current head is in the amber of the score.
  await expect(heads(page).nth(2)).toHaveCSS('color', 'rgb(255, 194, 61)');
  await expect(heads(page).nth(0)).not.toHaveCSS('color', 'rgb(255, 194, 61)');
});

test('a goal recorded in a quarter after the current one shows its count, so the grid still adds up', async ({ page }) => {
  // Live in Q3, with a goal in Q4 (the tracker can step the period back). Quarters after the current one
  // show a dash only while they have no goals.
  await seedGame([...quarter(1, 1, 0), ...quarter(3, 1, 1), ...quarter(4, 1, 0)], { status: 'live', period: 3 });
  await open(page, '#/game/g1');
  await expect(page.getByTestId('live-badge')).toBeVisible();
  await expect(grid(page)).toBeVisible();
  await expect(page.getByTestId('score-us')).toHaveText('3');
  await expect(heads(page).nth(2)).toHaveAttribute('aria-current', 'true');
  await expect(grid(page).locator('[aria-current]')).toHaveCount(1);
  await expect(goalsOf(page, 'quarter-us')).toHaveText(['1', '0', '1', '1']);
  await expect(goalsOf(page, 'quarter-them')).toHaveText(['0', '0', '1', '0']);
  // With the Q4 goal gone, the same quarter is a dash again.
  await update('games/g1', { events: [...quarter(1, 1, 0), ...quarter(3, 1, 1)] });
  await expect(goalsOf(page, 'quarter-us')).toHaveText(['1', '0', '1', '–'], { timeout: 5000 });
  await expect(goalsOf(page, 'quarter-them')).toHaveText(['0', '0', '1', '–']);
});

test('in the shootout no quarter is current and the four quarters show their goals', async ({ page }) => {
  await seedGame([...quarter(1, 1, 0), ...quarter(2, 0, 1), ...quarter(3, 1, 1), ...quarter(4, 0, 0), ev('goal', 'SO')],
    { status: 'live', period: 'SO' });
  await open(page, '#/game/g1');
  await expect(page.getByTestId('shootout')).toBeVisible();
  await expect(goalsOf(page, 'quarter-us')).toHaveText(['1', '0', '1', '0']);
  await expect(grid(page).locator('[aria-current]')).toHaveCount(0);
});

test('shootout goals are not in the grid', async ({ page }) => {
  await seedGame([
    ...quarter(1, 1, 0), ...quarter(2, 0, 1), ...quarter(3, 1, 1), ...quarter(4, 0, 0),
    ev('goal', 'SO'), ev('goal', 'SO'), ev('oppGoal', 'SO'),
  ]);
  await open(page, '#/game/g1');
  await expect(goalsOf(page, 'quarter-us')).toHaveText(['1', '0', '1', '0']);
  await expect(goalsOf(page, 'quarter-them')).toHaveText(['0', '1', '1', '0']);
  await expect(page.getByTestId('shootout')).toBeVisible();
});

test('the grid follows a watched game: Q2 becomes current, then the game ends', async ({ page }) => {
  await seedGame([...quarter(1, 1, 0), ...quarter(2, 1, 2)], { status: 'live' });
  await open(page, '#/game/g1');
  await expect(page.getByTestId('live-badge')).toBeVisible();
  await expect(grid(page)).toBeVisible();
  await expect(heads(page).nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(goalsOf(page, 'quarter-us')).toHaveText(['1', '1', '–', '–']);
  await update('games/g1', { period: 3 });
  await expect(heads(page).nth(2)).toHaveAttribute('aria-current', 'true', { timeout: 5000 });
  await expect(goalsOf(page, 'quarter-them')).toHaveText(['0', '2', '0', '–']);
  await update('games/g1', { status: 'final', period: 4 });
  await expect(page.getByTestId('final-badge')).toBeVisible({ timeout: 5000 });
  await expect(grid(page).locator('[aria-current]')).toHaveCount(0);
  await expect(goalsOf(page, 'quarter-us')).toHaveText(['1', '1', '0', '0']);
});

test('a goal in period 5 hides the grid, live or final', async ({ page }) => {
  // A goal in a period outside Q1-Q4 still counts in the score but belongs to no quarter.
  await seedGame([...quarter(1, 1, 1), ev('goal', 5)]);
  await open(page, '#/game/g1');
  await expect(page.getByTestId('final-badge')).toBeVisible();
  await expect(page.getByTestId('score-us')).toHaveText('2');
  await expect(page.getByTestId('score-them')).toHaveText('1');
  await expect(grid(page)).toBeHidden();
  await expect(grid(page)).toHaveText('');
  await update('games/g1', { status: 'live', period: 3 });
  await expect(page.getByTestId('live-badge')).toBeVisible({ timeout: 5000 });
  await expect(grid(page)).toBeHidden();
});

test('a goal whose period is the text "2" is no quarter goal: the grid hides, as for period 5', async ({ page }) => {
  // The model and the Team figures take only a number from 1 to 4; the grid must not read "2" - 1 as Q2.
  await seedGame([...quarter(1, 1, 1), { ...ev('goal', 2), period: '2' }]);
  await open(page, '#/game/g1');
  await expect(page.getByTestId('final-badge')).toBeVisible();
  await expect(page.getByTestId('score-us')).toHaveText('2');
  await expect(page.getByTestId('score-them')).toHaveText('1');
  await expect(grid(page)).toBeHidden();
});

for (const scheme of ['light', 'dark']) {
  test.describe(`360 px, ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test('a long Greek opponent is cut in its score row and its grid label, with no sideways scroll', async ({ page }) => {
      await seedGame([...quarter(1, 10, 11), ...quarter(2, 12, 10), ...quarter(3, 11, 12), ...quarter(4, 10, 10)],
        { opponent: longGreek });
      await page.setViewportSize({ width: 360, height: 740 });
      await open(page, '#/game/g1');
      await expect(page.getByTestId('score-us')).toHaveText('43');
      await expect(goalsOf(page, 'quarter-us')).toHaveText(['10', '12', '11', '10']);
      // Greek capitals through toLocaleUpperCase('el'): the accent goes, three characters stay.
      await expect(page.getByTestId('quarter-them').locator('th')).toHaveText('ΠΑΝ');
      // First the Greek faces, so the widths below are the real ones.
      await page.evaluate(async text => {
        await document.fonts.ready;
        await Promise.all([
          document.fonts.load('700 22px "Sofia Sans"', text), document.fonts.load('800 76px "Sofia Sans Extra Condensed"', '43'),
        ]);
      }, longGreek);
      const opponent = page.locator('.board-opp');
      await expect(opponent).toHaveText(longGreek);
      const cut = await opponent.evaluate(el => ({
        ellipsis: getComputedStyle(el).textOverflow, wrap: getComputedStyle(el).whiteSpace,
        cut: el.scrollWidth > el.clientWidth, lines: el.getClientRects().length, height: el.getBoundingClientRect().height,
      }));
      expect(cut.ellipsis).toBe('ellipsis');
      expect(cut.wrap).toBe('nowrap');
      expect(cut.cut, 'the name is longer than its box').toBe(true);
      expect(cut.height, 'one line').toBeLessThan(40);
      const label = await page.getByTestId('quarter-them').locator('th').evaluate(el => {
        const style = getComputedStyle(el);
        const table = el.closest('table').getBoundingClientRect();
        const box = el.getBoundingClientRect();
        return { ellipsis: style.textOverflow, overflow: style.overflow, inside: box.right <= table.right + 0.5, fits: el.scrollWidth <= el.clientWidth + 1 };
      });
      expect(label).toEqual({ ellipsis: 'ellipsis', overflow: 'hidden', inside: true, fits: true });
      // The numbers are in their own columns: each score is wholly inside the board, the grid inside the board.
      const inside = await page.evaluate(() => {
        const board = document.querySelector('.board').getBoundingClientRect();
        return ['score-us', 'score-them', 'quarter-scores'].map(id => {
          const box = document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect();
          return box.left >= board.left - 0.5 && box.right <= board.right + 0.5;
        });
      });
      expect(inside).toEqual([true, true, true]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  });
}

test('the grid stays inside the board at 240 px and its cells stay on one line', async ({ page }) => {
  await seedGame([...quarter(1, 10, 11), ...quarter(2, 12, 10), ...quarter(3, 11, 12), ...quarter(4, 10, 10)]);
  await page.setViewportSize({ width: 240, height: 740 });
  await open(page, '#/game/g1');
  await expect(goalsOf(page, 'quarter-us')).toHaveText(['10', '12', '11', '10']);
  const tall = await grid(page).locator('td, th').evaluateAll(cells => cells.filter(cell => cell.getClientRects().length > 1
    || cell.getBoundingClientRect().height > 40).length);
  expect(tall).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
