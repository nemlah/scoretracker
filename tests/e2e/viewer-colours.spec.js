import { test, expect } from './fixtures.js';
import { closeAll, consoleProblems, cssColour, open, resetAll, seed, tab } from './helpers.js';
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
  problems = consoleProblems(page);
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

// The page's own accent.js import sets its pair a moment after first paint: wait for it, then override.
async function paint(page, accent) {
  await expect.poll(() => cssColour(page.locator('html'), '--on-accent')).not.toBe('');
  await page.evaluate(async value => {
    document.documentElement.style.setProperty('--accent', value);
    const { applyAccentPair } = await import('/js/accent.js');
    applyAccentPair(document.documentElement.style, value);
  }, accent);
}

// A computed colour as { r, g, b, a } (0-255, a in 0-1). Chromium and WebKit write rgb()/rgba(); a mixed colour
// may come back as color(srgb ...). Anything else is an error, never a guess.
function parseColour(text) {
  const rgb = /^rgba?\(([^)]+)\)$/.exec(text);
  if (rgb) {
    const [r, g, b, a = '1'] = rgb[1].split(/[\s,/]+/).filter(Boolean);
    return { r: Number(r), g: Number(g), b: Number(b), a: Number(a) };
  }
  const srgb = /^color\(srgb ([^)]+)\)$/.exec(text);
  if (srgb) {
    const [r, g, b, a = '1'] = srgb[1].split(/[\s/]+/).filter(Boolean);
    return { r: Number(r) * 255, g: Number(g) * 255, b: Number(b) * 255, a: Number(a) };
  }
  throw new Error(`cannot read the colour ${text}`);
}
const toHex = ({ r, g, b }) => `#${[r, g, b].map(c => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
// `top` painted over the opaque `under`.
const over = (top, under) => ({
  r: top.r * top.a + under.r * (1 - top.a),
  g: top.g * top.a + under.g * (1 - top.a),
  b: top.b * top.a + under.b * (1 - top.a),
  a: 1,
});

// A fill that must be opaque: a transparent or translucent one is a failure, never measured.
async function opaque(page, selector, property, label) {
  const colour = parseColour(await cssColour(page.locator(selector).first(), property));
  expect(colour.a, `${label}: ${selector} ${property} is opaque`).toBe(1);
  return toHex(colour);
}
const fromHex = hexColour => {
  const value = parseInt(hexColour.slice(1), 16);
  return { r: value >> 16, g: (value >> 8) & 255, b: value & 255, a: 1 };
};
// A text colour, composited over the fill it is drawn on.
async function textOn(page, selector, fillHex) {
  return toHex(over(parseColour(await cssColour(page.locator(selector).first(), 'color')), fromHex(fillHex)));
}
// The fill of one element of a locator, which must be opaque.
async function fillOf(locator, label) {
  const colour = parseColour(await cssColour(locator, 'backgroundColor'));
  expect(colour.a, `${label} is opaque`).toBe(1);
  return toHex(colour);
}

async function chip(page, selector, accent, label) {
  const bg = await opaque(page, selector, 'backgroundColor', label);
  const fg = await textOn(page, selector, bg);
  expect(bg, `${label}: the chip is the club colour`).toBe(accent);
  expect(contrastRatio(fg, bg), `${label}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
}

for (const scheme of ['light', 'dark']) {
  test.describe(`club colours, ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    for (const accent of ACCENTS) {
      test(`${accent}: the game's chips, board bar and Team bars meet their thresholds`, async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 844 });
        await open(page, '#/game/team-g1');
        await expect(page.getByTestId('score-us')).toHaveText('5');
        await paint(page, accent);

        // The 52 px bar on the board, against the board.
        const bar = await opaque(page, '.board-bar', 'backgroundColor', 'board bar');
        const board = await opaque(page, '.board', 'backgroundColor', 'board');
        expect(contrastRatio(bar, board), `board bar ${bar} on ${board}`).toBeGreaterThanOrEqual(3);

        await expect(page.locator('.tl-quarter h3').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        const goalPill = page.locator('.tl-goal[data-side="us"]').getByTestId('tl-score').first();
        expect(await fillOf(goalPill, 'our goal pill')).toBe(board);

        // Players: the cap chip's number.
        await tab(page, 'players').click();
        await chip(page, '[data-testid="player-row"][data-cap="7"] .cap', accent, 'Players cap 7');

        // Team: the foul-trouble chip, and every bar against the card it is on.
        await tab(page, 'team').click();
        await expect(page.getByTestId('foul-trouble-row')).toHaveCount(2);
        await chip(page, '[data-testid="foul-trouble-row"][data-cap="7"] .cap', accent, 'Team cap 7');
        const cardBehind = await opaque(page, '.team-goals-card', 'backgroundColor', 'Team card');
        const bars = page.locator('.team-bar-fill');
        await expect(bars).toHaveCount(2);
        for (const index of [0, 1]) {
          const fill = await fillOf(bars.nth(index), `Team bar ${index}`);
          expect(contrastRatio(fill, cardBehind), `Team bar ${index} ${fill} on ${cardBehind}`).toBeGreaterThanOrEqual(3);
        }
        const track = await opaque(page, '.team-bar', 'backgroundColor', 'Team track');
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
        const card = await opaque(page, '.team-goals-card', 'backgroundColor', 'season Team card');
        const bars = page.locator('[data-testid="season-goals"] .team-bar-fill');
        await expect(bars).toHaveCount(2);
        for (const index of [0, 1]) {
          const fill = await fillOf(bars.nth(index), `season Team bar ${index}`);
          expect(contrastRatio(fill, card), `season Team bar ${index} ${fill} on ${card}`).toBeGreaterThanOrEqual(3);
        }
        const track = await opaque(page, '[data-testid="season-goals"] .team-bar', 'backgroundColor', 'season track');
        expect(contrastRatio(track, card), `season track ${track} on ${card}`).toBeGreaterThanOrEqual(3);
      });
    }
  });
}
