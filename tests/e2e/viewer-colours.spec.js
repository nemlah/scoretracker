import { test, expect } from '@playwright/test';
import { closeAll, resetAll, seed } from './helpers.js';
import { contrastRatio } from '../../js/accent.js';
import { teamGame } from '../fixtures/team-game.js';
import { seasonStatsFull } from '../fixtures/season-stats.js';

// Every element that is drawn in the club colour, for each club colour in each scheme: text on a chip at 4.5:1,
// bars at 3:1 against what they sit on. (Neutral card and table rules follow the boards and are not in this.)
const roster = [
  { id: 'p1', name: 'Νίκος Λέκκας', cap: 1, archived: false },
  { id: 'p7', name: 'Άρης Λάμπρου', cap: 7, archived: false },
  { id: 'p12', name: 'Αλέξανδρος Κωνσταντίνος Παπαγεωργίου', cap: 12, archived: false },
];
const ACCENTS = ['#0057b8', '#c8102e', '#f2b705', '#00843d'];

let problems;
test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  await resetAll();
  await Promise.all([
    seed('team/main', { currentGameId: 'team-g1', roster }),
    seed('games/team-g1', teamGame),
    seed('stats/2026-27', {
      ...seasonStatsFull,
      players: { p7: { name: 'Άρης Λάμπρου', games: 4, goals: 4, excl: 3, pens: 1 } },
    }),
  ]);
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});
test.afterAll(closeAll);

const open = (page, hash = '') => page.goto(`/index.html?emulator=1${hash}`);
const tab = (page, name) => page.getByTestId(`tab-${name}`);

// The page's own accent.js import sets its pair a moment after first paint: wait for it, then override.
async function paint(page, accent) {
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--on-accent').trim())).not.toBe('');
  await page.evaluate(async value => {
    document.documentElement.style.setProperty('--accent', value);
    const { applyAccentPair } = await import('/js/accent.js');
    applyAccentPair(document.documentElement.style, value);
  }, accent);
}

// A computed colour as #rrggbb.
const hexOf = (page, colour) => page.evaluate(value => {
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#000000';
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  return `#${[...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(c => c.toString(16).padStart(2, '0')).join('')}`;
}, colour);

const colours = (page, selector, property) => page.locator(selector).first().evaluate(
  (el, name) => getComputedStyle(el)[name],
  property,
);
const hex = async (page, selector, property) => hexOf(page, await colours(page, selector, property));

async function chip(page, selector, accent, label) {
  const fg = await hex(page, selector, 'color');
  const bg = await hex(page, selector, 'backgroundColor');
  expect(bg, `${label}: the chip is the club colour`).toBe(accent);
  expect(contrastRatio(fg, bg), `${label}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
}

for (const scheme of ['light', 'dark']) {
  test.describe(`club colours, ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    for (const accent of ACCENTS) {
      test(`${accent}: the game's chips, board bar and Team bars meet their thresholds`, async ({ page }) => {
        await open(page, '#/game/team-g1');
        await expect(page.getByTestId('score-us')).toHaveText('5');
        await paint(page, accent);

        // The 52 px bar on the board, against the board.
        const bar = await hex(page, '.board-bar', 'backgroundColor');
        const board = await hex(page, '.board', 'backgroundColor');
        expect(contrastRatio(bar, board), `board bar ${bar} on ${board}`).toBeGreaterThanOrEqual(3);

        // Players: the cap chip's number.
        await tab(page, 'players').click();
        await chip(page, '[data-testid="player-row"][data-cap="7"] .cap', accent, 'Players cap 7');

        // Team: the foul-trouble chip, and every bar against the card it is on.
        await tab(page, 'team').click();
        await expect(page.getByTestId('foul-trouble-row')).toHaveCount(2);
        await chip(page, '[data-testid="foul-trouble-row"][data-cap="7"] .cap', accent, 'Team cap 7');
        const cardBehind = await hex(page, '.team-goals-card', 'backgroundColor');
        const bars = page.locator('.team-bar-fill');
        await expect(bars).toHaveCount(2);
        for (const index of [0, 1]) {
          const fill = await hexOf(page, await bars.nth(index).evaluate(el => getComputedStyle(el).backgroundColor));
          expect(contrastRatio(fill, cardBehind), `Team bar ${index} ${fill} on ${cardBehind}`).toBeGreaterThanOrEqual(3);
        }
        const track = await hex(page, '.team-bar', 'backgroundColor');
        expect(contrastRatio(track, cardBehind), `Team bar track ${track} on ${cardBehind}`).toBeGreaterThanOrEqual(3);
      });

      test(`${accent}: home's cap chips and season Team bars meet their thresholds`, async ({ page }) => {
        await open(page);
        await expect(page.getByTestId('result-row')).toHaveCount(4);
        await paint(page, accent);
        await tab(page, 'players').click();
        await chip(page, '[data-testid="season-row"] .cap', accent, 'season cap');
        await tab(page, 'team').click();
        await expect(page.getByTestId('season-goals')).toBeVisible();
        const card = await hex(page, '.team-goals-card', 'backgroundColor');
        const bars = page.locator('[data-testid="season-goals"] .team-bar-fill');
        await expect(bars).toHaveCount(2);
        for (const index of [0, 1]) {
          const fill = await hexOf(page, await bars.nth(index).evaluate(el => getComputedStyle(el).backgroundColor));
          expect(contrastRatio(fill, card), `season Team bar ${index} ${fill} on ${card}`).toBeGreaterThanOrEqual(3);
        }
        const track = await hex(page, '[data-testid="season-goals"] .team-bar', 'backgroundColor');
        expect(contrastRatio(track, card), `season track ${track} on ${card}`).toBeGreaterThanOrEqual(3);
      });
    }
  });
}
