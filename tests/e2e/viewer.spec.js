import { execSync } from 'node:child_process';
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
    status: 'live', period: 2, lineup: [...lineup, { playerId: 'p9', name: 'Bench', cap: 9 }], events,
  }),
]);

let problems;
// Set by a test that intercepts a module: the browser's own resource-load failure for that URL is expected.
let blockedUrl;
test.beforeEach(async ({ page }) => {
  problems = [];
  blockedUrl = null;
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    // Only the browser's resource-load failure for the intercepted URL (its location and its text); an
    // error the app logs about the same file, or any other, still fails the test.
    if (blockedUrl && message.location()?.url === blockedUrl && /^Failed to load resource/.test(message.text())) return;
    problems.push(`console: ${message.text()}`);
  });
  await resetAll();
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});
test.afterAll(closeAll);

const open = (page, hash = '') => page.goto(`/index.html?emulator=1${hash}`);

// A timeline row's text box (its name line) and the x of the centre line in that row, in the viewport.
const textAgainstLine = row => row.evaluate(el => {
  const mid = el.querySelector('.tl-mid').getBoundingClientRect();
  const box = el.querySelector('.tl-name').getBoundingClientRect();
  return { line: mid.left + mid.width / 2, text: { left: box.left, right: box.right, centre: box.left + box.width / 2 } };
});

test('home says there are no games when there is no team or game', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('results-empty')).toBeVisible();
  await expect(page.getByTestId('empty-state')).toHaveCount(0);
  await expect(page.getByTestId('score-us')).toBeHidden();
});

test('live game', async ({ page }) => {
  await seedLive();
  await open(page, '#/game/g1');
  await expect(page.getByTestId('score-us')).toHaveText('3');
  await expect(page.getByTestId('score-them')).toHaveText('2');
  await expect(page.getByTestId('period')).toHaveText('Q2');
  await expect(page.getByTestId('live-badge')).toBeVisible();
  await expect(page.getByTestId('final-badge')).toBeHidden();
  // The date is for a finished game; a live one is today's.
  await expect(page.getByTestId('game-date')).toBeHidden();
  await expect(page.getByTestId('timeline-item').first()).toContainText('Q2');
  await expect(page.getByTestId('timeline-item')).toHaveCount(8);

  // Theirs sit right of the centre line, ours left: the text box, not the row box, against the line.
  const them = page.locator('[data-testid="timeline-item"][data-side="them"]').first();
  await expect(them.getByTestId('tl-name')).toHaveText('Opponent FC');
  await expect(them.locator('.tl-what')).toHaveText('Goal');
  const us = page.locator('[data-testid="timeline-item"][data-side="us"]', { hasText: '#5' }).first();
  for (const [row, side] of [[them, 'them'], [us, 'us']]) {
    const g = await textAgainstLine(row);
    if (side === 'them') {
      expect(g.text.left, 'their text starts right of the line').toBeGreaterThan(g.line);
      expect(g.text.centre, 'their text is centred right of the line').toBeGreaterThan(g.line + 20);
    } else {
      expect(g.text.right, 'our text ends left of the line').toBeLessThan(g.line);
      expect(g.text.centre, 'our text is centred left of the line').toBeLessThan(g.line - 20);
    }
  }
  // The name line is the cap and name; the word "Goal" is the line under it, and the pill is the running score.
  await expect(us.getByTestId('tl-name')).toHaveText('#5 Alexiou');
  await expect(us.locator('.tl-what')).toHaveText('Goal');
  await expect(us.getByTestId('tl-score')).toHaveText('3–1');
  await expect(them.getByTestId('tl-score')).toHaveText('3–2');
  await expect(page.getByTestId('tl-icon').first()).toBeVisible();
  // The third foul: the out tag, the red exclusion icon and data-out.
  await expect(page.locator('[data-testid="timeline-item"][data-out="true"]')).toHaveCount(1);
  await expect(page.getByTestId('tl-out')).toHaveText('· out');
  await expect(page.locator('[data-testid="timeline-item"][data-out="true"]')).toContainText('#2 Papadakis');
  await expect(page.locator('.tl-icon--excl')).toHaveCount(3);
  // A quarter marker is a board chip with the quarter's goals; it is not the old 24 px sticky heading.
  const marker = page.getByTestId('tl-quarter').first();
  await expect(marker).toHaveText('Q2 1–1');
  expect(await marker.locator('h3').evaluate(el => {
    const style = getComputedStyle(el);
    return [style.fontSize, style.position, style.backgroundColor];
  })).toEqual(['17px', 'static', 'rgb(11, 19, 32)']);
  // As the VGame board draws it: the quarter in amber, the digits white. Each span is sampled itself.
  await expect(marker.locator('.tl-quarter-label')).toHaveText('Q2');
  await expect(marker.locator('.tl-quarter-label')).toHaveCSS('color', 'rgb(255, 194, 61)');
  await expect(marker.locator('.tl-quarter-score')).toHaveText('1–1');
  await expect(marker.locator('.tl-quarter-score')).toHaveCSS('color', 'rgb(255, 255, 255)');

  // The players are under their own tab.
  await page.getByTestId('tab-players').click();
  const rows = page.getByTestId('player-row');
  await expect(rows).toHaveCount(2); // the bench player in the lineup has no goals or exclusions
  await expect(page.locator('[data-testid="player-row"][data-cap="9"]')).toHaveCount(0);
  await expect(rows.first()).toHaveAttribute('data-cap', '2');
  const papadakis = page.locator('[data-testid="player-row"][data-cap="2"]');
  await expect(papadakis.getByTestId('player-out')).toBeVisible();
  await expect(papadakis.getByTestId('player-excl')).toHaveText('3');
  await expect(papadakis.getByTestId('player-goals')).toHaveText('1');
  await expect(page.locator('[data-testid="player-row"][data-cap="5"]').getByTestId('player-out')).toHaveCount(0);
});

test('the scoreboard is two rows: the team, its crest and score above the opponent and its score', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedLive();
  await open(page, '#/game/g1');
  const us = page.getByTestId('score-us');
  const them = page.getByTestId('score-them');
  await expect(us).toHaveText('3');
  const box = async locator => locator.evaluate(el => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
  });
  const [usBox, themBox, teamBox, oppBox, crestBox, barBox, boardBox] = await Promise.all([
    box(us), box(them), box(page.locator('.board h1')), box(page.locator('.board-opp')), box(page.getByTestId('crest')),
    box(page.locator('.board-bar')), box(page.locator('.board')),
  ]);
  expect(usBox.bottom, 'our score row is above theirs').toBeLessThanOrEqual(themBox.top + 1);
  expect(Math.abs((teamBox.top + teamBox.bottom) / 2 - (usBox.top + usBox.bottom) / 2), 'name and score share row 1').toBeLessThan(8);
  expect(Math.abs((oppBox.top + oppBox.bottom) / 2 - (themBox.top + themBox.bottom) / 2), 'opponent and score share row 2').toBeLessThan(8);
  expect(crestBox.left, 'the crest follows the team name').toBeGreaterThanOrEqual(teamBox.right - 1);
  expect(crestBox.width).toBe(40);
  expect(crestBox.height).toBe(40);
  // The club-colour bar is 52 px tall, beside the first row, and is the club colour on the board.
  expect(barBox.height).toBe(52);
  expect(barBox.bottom).toBeLessThanOrEqual(oppBox.top + 1);
  expect(Math.abs((barBox.top + barBox.bottom) / 2 - (usBox.top + usBox.bottom) / 2)).toBeLessThan(8);
  // A full-bleed board: the page's gutter does not show on either side of it.
  expect(boardBox.left).toBe(0);
  expect(Math.round(boardBox.right)).toBe(await page.evaluate(() => document.documentElement.clientWidth));
  const crest = page.getByTestId('crest');
  await expect(crest).toBeVisible();
  await expect(crest).toHaveAttribute('alt', '');
  await expect(page.getByTestId('crest')).toHaveCount(1);
  await expect.poll(() => crest.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);

  // Two digits over one: the digits themselves line up on the right (the cells share a column, so their
  // boxes always do).
  await update('games/g1', { events: [...liveEvents(), ...Array.from({ length: 7 }, () => ev('goal', 2, 'p5'))] });
  await expect(us).toHaveText('10', { timeout: 5000 });
  const edges = await page.evaluate(() => ['score-us', 'score-them'].map(id => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(`[data-testid="${id}"]`));
    return range.getBoundingClientRect().right;
  }));
  expect(Math.abs(edges[0] - edges[1]), 'digits share a right edge').toBeLessThanOrEqual(1);
});

test('the top row has the LIVE badge, the period box and no date while live; a final game has FINAL and its date', async ({ page }) => {
  await seedLive();
  await open(page, '#/game/g1');
  await expect(page.getByTestId('live-badge')).toBeVisible();
  await expect(page.getByTestId('live-badge')).toHaveText('LIVE', { useInnerText: true });
  await expect(page.getByTestId('period')).toHaveText('Q2');
  await expect(page.getByTestId('game-date')).toBeHidden();
  await expect(page.getByTestId('final-badge')).toBeHidden();
  const order = await page.evaluate(() => ['live-badge', 'period'].map(id => document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect().left));
  expect(order[0], 'LIVE is left of the period box').toBeLessThan(order[1]);

  await update('games/g1', { status: 'final', period: 4 });
  await expect(page.getByTestId('final-badge')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('game-date')).toBeVisible();
  await expect(page.getByTestId('game-date')).toHaveText('08/11/2026');
  await expect(page.getByTestId('live-badge')).toBeHidden();
  await expect(page.getByTestId('period')).toBeHidden();
  await expect(page.getByTestId('situation-badge')).toBeHidden();
  const final = await page.evaluate(() => ['final-badge', 'game-date'].map(id => document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect().left));
  expect(final[0], 'FINAL is left of the date').toBeLessThan(final[1]);
});

test('there is no lane rope on the viewer, on the game screen or on home', async ({ page }) => {
  await seedLive();
  await open(page, '#/game/g1');
  await expect(page.getByTestId('score-us')).toBeVisible();
  await expect(page.locator('.rope')).toHaveCount(0);
  await open(page);
  await expect(page.getByTestId('games-list')).toBeVisible();
  await expect(page.locator('.rope')).toHaveCount(0);
  // Opening home after the game aborts the streams that were open; that is not an app error.
  dropNetworkNoise(problems);
});

test('the game screen has the timeline, players and team tabs in that order, and no season block', async ({ page }) => {
  await seedLive();
  await seed('stats/2026-27', {
    players: { p5: { name: 'Alexiou', games: 3, goals: 7, excl: 1 } },
    results: [{ gameId: 'p1', date: '2026-10-25', opponent: 'North Pool', us: 11, them: 6 }],
  });
  await open(page, '#/game/g1');
  await expect(page.getByTestId('timeline-heading')).toBeVisible();
  await expect(page.getByTestId('panel-timeline')).toBeVisible();
  await expect(page.getByTestId('player-row').first()).toBeHidden(); // under the Players tab, not the Timeline one
  const lefts = await page.evaluate(() => ['timeline', 'players', 'team'].map(name => document.querySelector(`[data-testid="tab-${name}"]`).getBoundingClientRect().left));
  expect(lefts[0]).toBeLessThan(lefts[1]);
  expect(lefts[1]).toBeLessThan(lefts[2]);
  await page.getByTestId('tab-players').click();
  await expect(page.getByTestId('player-row').first()).toBeVisible();
  // The season's tables belong to home, not under a game.
  await expect(page.getByTestId('season-row')).toHaveCount(0);
  await expect(page.getByTestId('result-row')).toHaveCount(0);
});

const manyEvents = (length = 30) => Array.from({ length }, (_, i) => (i % 3 === 2 ? ev('oppGoal', (i % 4) + 1)
  : ev('goal', (i % 4) + 1, i % 2 ? 'p5' : 'p2')));

test('the timeline has no scroll box: a long game grows the page, and the page scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedLive(manyEvents(40));
  await open(page, '#/game/g1');
  await expect(page.getByTestId('timeline-item')).toHaveCount(40);
  await expect(page.getByTestId('timeline-scroll')).toHaveCount(0);
  await expect(page.locator('.timeline-scroll')).toHaveCount(0);
  const m = await page.evaluate(() => {
    const list = document.querySelector('.tl-list');
    return {
      list: list.getBoundingClientRect().height,
      page: document.documentElement.scrollHeight,
      // Nothing in the panel scrolls on its own.
      scrollers: [...document.querySelectorAll('[data-testid="panel-timeline"], [data-testid="panel-timeline"] *')]
        .filter(el => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY)).length,
    };
  });
  expect(m.list, '40 rows of at least 48 px are all in the page').toBeGreaterThan(40 * 48);
  expect(m.page, 'the page is taller than the list').toBeGreaterThan(m.list);
  expect(m.scrollers, 'nothing in the timeline panel is a scroll box').toBe(0);
  await page.evaluate(() => window.scrollTo(0, 600));
  expect(await page.evaluate(() => window.scrollY)).toBe(600);
});

test('the page keeps its scroll position when a new event arrives', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const events = manyEvents();
  await seedLive(events);
  await open(page, '#/game/g1');
  await expect(page.getByTestId('timeline-item')).toHaveCount(30);
  await page.evaluate(() => window.scrollTo(0, 400));
  expect(await page.evaluate(() => window.scrollY)).toBe(400);
  await update('games/g1', { events: [...events, ev('goal', 2, 'p5')] });
  await expect(page.getByTestId('timeline-item')).toHaveCount(31, { timeout: 5000 });
  expect(Math.abs(await page.evaluate(() => window.scrollY) - 400)).toBeLessThanOrEqual(2);
});

test('the page keeps its scroll position on a metadata-only update', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedLive(manyEvents());
  await open(page, '#/game/g1');
  await expect(page.getByTestId('timeline-item')).toHaveCount(30);
  await page.evaluate(() => window.scrollTo(0, 400));
  await update('games/g1', { period: 3 });
  await expect(page.getByTestId('period')).toHaveText('Q3', { timeout: 5000 });
  expect(Math.abs(await page.evaluate(() => window.scrollY) - 400)).toBeLessThanOrEqual(2);
});

test('keyboard focus on the Timeline tab stays there when a new event arrives', async ({ page }) => {
  const events = manyEvents();
  await seedLive(events);
  await open(page, '#/game/g1');
  await expect(page.getByTestId('timeline-item')).toHaveCount(30);
  await page.getByTestId('tab-timeline').focus();
  await update('games/g1', { events: [...events, ev('goal', 2, 'p5')] });
  await expect(page.getByTestId('timeline-item')).toHaveCount(31, { timeout: 5000 });
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('tab-timeline');
});

test('updates live without reload', async ({ page }) => {
  const events = liveEvents();
  await seedLive(events);
  await open(page, '#/game/g1');
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
  await open(page, '#/game/g1');
  await expect(page.getByTestId('final-badge')).toBeVisible();
  await expect(page.getByTestId('live-badge')).toBeHidden();
  await expect(page.getByTestId('score-us')).toHaveText('9');
  await expect(page.getByTestId('score-them')).toHaveText('9');
  await expect(page.getByTestId('shootout')).toHaveText('(4 – 3 pen.)');
  await expect(page.getByTestId('result-row')).toHaveCount(0);
  await open(page);
  await expect(page.getByTestId('result-row')).toHaveCount(2);
  await expect(page.getByTestId('result-row').first()).toContainText('Opponent FC');
  await page.getByTestId('tab-players').click();
  const seasonRows = page.getByTestId('season-row');
  await expect(seasonRows).toHaveCount(2);
  await expect(seasonRows.first()).toContainText('Alexiou');
  await expect(seasonRows.last()).toContainText('Papadakis');
  // Opening home again aborts the streams that were open; that is not an app error.
  dropNetworkNoise(problems);
});

test('game deleted while watching says it is no longer available', async ({ page }) => {
  await seedLive();
  await open(page, '#/game/g1');
  await expect(page.getByTestId('score-us')).toHaveText('3');
  await remove('games/g1');
  await expect(page.getByTestId('game-unavailable')).toBeVisible();
  await expect(page.getByTestId('score-us')).toBeHidden();
  await expect(page.getByTestId('all-games')).toHaveText('This season');
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
  // Between games home is the season, not last week's final.
  await expect(page.getByTestId('games-list')).toBeVisible();
  await expect(page.getByTestId('score-us')).toBeHidden();
  await expect(page.getByTestId('live-banner')).toBeHidden();

  // The new game shows as the banner; its screen is one tap away.
  await update('team/main', { currentGameId: 'g2' });
  await expect(page.getByTestId('live-banner')).toContainText('This Week FC', { timeout: 5000 });
  await expect(page.getByTestId('score-us')).toBeHidden();
  await page.getByTestId('live-banner').click();
  await expect(page.getByTestId('live-badge')).toBeVisible();
  await expect(page.getByTestId('final-badge')).toBeHidden();
  await expect(page.locator('.board-opp')).toHaveText('This Week FC');
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
  await page.getByTestId('tab-players').click();
  await expect(page.getByTestId('season-row')).toContainText('Alexiou');

  await update('team/main', { currentGameId: 'g2' });
  await expect(page.getByTestId('result-row')).toContainText('New Season FC');
  await expect(page.getByTestId('result-row')).toHaveCount(1);
  // The Players tab stays selected while the season changes under it.
  await expect(page.getByTestId('tab-players')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('season-row')).toHaveCount(1);
  await expect(page.getByTestId('season-row')).toContainText('Papadakis');
  // The previous season's document is no longer followed.
  await update('stats/2025-26', { players: { p5: { name: 'Changed', games: 5, goals: 12, excl: 2 } } });
  await page.waitForTimeout(300);
  await expect(page.getByTestId('season-row')).toContainText('Papadakis');
});

test('a page restored from the back/forward cache is reloaded', async ({ page }) => {
  await seedLive();
  await open(page, '#/game/g1');
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

// Man-up / man-down figures, penalty fouls and the season trend.
const trackedEvents = () => [
  { id: 's1', type: 'manUp', period: 1, ts: 1000 },
  { id: 's2', type: 'goal', period: 1, ts: 2000, playerId: 'p5' },
  { id: 's3', type: 'excl', period: 1, ts: 3000, playerId: 'p2' },
];
const seedTracked = (events = trackedEvents(), tracked = true) => Promise.all([
  seed('team/main', { currentGameId: 'g1', roster }),
  seed('games/g1', {
    opponent: 'Opponent FC', date: '2026-11-08', season: '2026-27',
    status: 'live', period: 1, lineup, events, ...(tracked ? { situations: true } : {}),
  }),
]);

test('live man-up shows the badge and the game figures', async ({ page }) => {
  await seedTracked();
  await open(page, '#/game/g1');
  await expect(page.getByTestId('situation-badge')).toHaveText('Man-down');
  // The per-game man-up and man-down figures (game-manup, game-mandown) left the scoreboard: they are the
  // Team tab's rows now, quarter by quarter.
  await expect(page.getByTestId('game-manup')).toHaveCount(0);
  await expect(page.getByTestId('game-mandown')).toHaveCount(0);
  await page.getByTestId('tab-team').click();
  const manUp = page.getByTestId('team-manup');
  const manDown = page.getByTestId('team-mandown');
  // Man-up 1/1 in Q1; the man-down the exclusion opened is still open, so it is not counted yet.
  await expect(manUp.getByTestId('team-q')).toHaveText(['1/1', '–', '–', '–']);
  await expect(manUp.getByTestId('team-total')).toHaveText('1/1');
  await expect(manUp.getByTestId('team-pct')).toHaveText('100%');
  await expect(manDown.getByTestId('team-q')).toHaveText(['–', '–', '–', '–']);
  await expect(manDown.getByTestId('team-total')).toHaveText('–');
  await expect(manDown.getByTestId('team-pct')).toHaveCount(0);
  // The opponent's goal ends it unstopped.
  await update('games/g1', { events: [...trackedEvents(), { id: 's4', type: 'oppGoal', period: 1, ts: 4000 }] });
  await expect(page.getByTestId('situation-badge')).toBeHidden();
  await expect(manDown.getByTestId('team-q')).toHaveText(['0/1', '–', '–', '–']);
  await expect(manDown.getByTestId('team-total')).toHaveText('0/1');
  await expect(manDown.getByTestId('team-pct')).toHaveText('0%');
});

test('the situation chip is green for man-up and orange for man-down, and absent with nothing open', async ({ page }) => {
  await seedTracked([{ id: 's1', type: 'manUp', period: 1, ts: 1000 }]);
  await open(page, '#/game/g1');
  const chip = page.getByTestId('situation-badge');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute('data-kind', 'manUp');
  await expect(chip).toHaveClass(/board-chip--manUp/);
  // The text is set in capitals by the style; innerText is what a reader sees.
  await expect(chip).toHaveText('MAN-UP', { useInnerText: true });
  await expect(chip).toHaveCSS('background-color', 'rgb(14, 122, 78)');
  await expect(chip).toHaveCSS('color', 'rgb(255, 255, 255)');

  // Our man-up ends, then one of ours is excluded: the chip turns to man-down.
  await update('games/g1', { events: [
    { id: 's1', type: 'manUp', period: 1, ts: 1000 }, { id: 's2', type: 'manUpEnd', period: 1, ts: 2000 },
    { id: 's3', type: 'excl', period: 1, ts: 3000, playerId: 'p2' },
  ] });
  await expect(chip).toHaveAttribute('data-kind', 'manDown', { timeout: 5000 });
  await expect(chip).toHaveClass(/board-chip--manDown/);
  await expect(chip).not.toHaveClass(/board-chip--manUp/);
  await expect(chip).toHaveText('MAN-DOWN', { useInnerText: true });
  await expect(chip).toHaveCSS('background-color', 'rgb(232, 89, 12)');
  await expect(chip).toHaveCSS('color', 'rgb(11, 19, 32)');

  // Nothing open: no chip, and no stale kind left on it.
  await update('games/g1', { events: [
    { id: 's1', type: 'manUp', period: 1, ts: 1000 }, { id: 's2', type: 'manUpEnd', period: 1, ts: 2000 },
  ] });
  await expect(chip).toBeHidden({ timeout: 5000 });
  await expect(chip).not.toHaveAttribute('data-kind', /.+/);
});

test('goals scored on a man-up are tagged; situation events are not listed; penalty fouls are', async ({ page }) => {
  const events = [
    ...trackedEvents(),
    { id: 's4', type: 'oppGoal', period: 1, ts: 4000 },
    { id: 's5', type: 'pen', period: 1, ts: 5000, playerId: 'p2' },
    { id: 's6', type: 'manUp', period: 1, ts: 6000 },
    { id: 's7', type: 'manUpEnd', period: 1, ts: 7000 },
    { id: 's8', type: 'goal', period: 1, ts: 8000, playerId: 'p2' },
  ];
  await seedTracked(events);
  await open(page, '#/game/g1');
  // goals (2) + oppGoals (1) + excl (1) + pen (1)
  await expect(page.getByTestId('timeline-item')).toHaveCount(5);
  await expect(page.getByTestId('tl-manup')).toHaveCount(1);
  await expect(page.getByTestId('tl-manup')).toHaveText('man-up');
  const tagged = page.getByTestId('timeline-item').filter({ has: page.getByTestId('tl-manup') });
  await expect(tagged).toContainText('#5 Alexiou');
  const pen = page.getByTestId('timeline-item').filter({ has: page.locator('.tl-icon--pen') });
  await expect(pen).toHaveCount(1);
  await expect(pen).toContainText('#2 Papadakis');
  await page.getByTestId('tab-players').click();
  await expect(page.getByTestId('player-pen')).toHaveCount(2);
  await expect(page.locator('[data-testid="player-row"][data-cap="2"]').getByTestId('player-pen')).toHaveText('1');
  await expect(page.locator('[data-testid="player-row"][data-cap="5"]').getByTestId('player-pen')).toHaveText('0');
});

test('fouls show the exclusion and penalty icons; the third foul adds the out tag', async ({ page }) => {
  await seedLive([
    ev('excl', 1, 'p2'), ev('excl', 1, 'p2'), ev('pen', 2, 'p2'), ev('pen', 2, 'p5'),
  ]);
  await open(page, '#/game/g1');
  const items = page.getByTestId('timeline-item');
  await expect(items).toHaveCount(4);
  const p2 = items.filter({ hasText: '#2 Papadakis' });
  await expect(p2).toHaveCount(3);
  // The timeline lists newest first: the fouling-out pen, then the two exclusions.
  for (const i of [1, 2]) {
    const icon = p2.nth(i).getByTestId('tl-icon');
    await expect(icon).toHaveClass(/tl-icon--excl/);
    await expect(icon.locator('svg')).toBeVisible();
    await expect(p2.nth(i).locator('.tl-what')).toHaveText('Exclusion');
    await expect(p2.nth(i).getByTestId('tl-out')).toHaveCount(0);
  }
  const out = p2.first();
  await expect(out).toHaveAttribute('data-out', 'true');
  await expect(out.getByTestId('tl-icon')).toHaveClass(/tl-icon--pen/);
  await expect(out.locator('.tl-what')).toHaveText('Penalty foul · out');
  await expect(out.getByTestId('tl-out')).toHaveText('· out');
  expect(await out.getByTestId('tl-out').evaluate(el => getComputedStyle(el).color)).toBe('rgb(179, 32, 47)');
  const p5 = items.filter({ hasText: '#5 Alexiou' });
  await expect(p5.getByTestId('tl-icon')).toHaveClass(/tl-icon--pen/);
  await expect(p5.getByTestId('tl-icon').locator('svg')).toBeVisible();
  await expect(p5.getByTestId('tl-out')).toHaveCount(0);
  // The icon fills: red for an exclusion, purple for a penalty foul.
  const fills = await page.evaluate(() => ['excl', 'pen'].map(kind => getComputedStyle(document.querySelector(`.tl-icon--${kind}`)).backgroundColor));
  expect(fills).toEqual(['rgb(215, 38, 61)', 'rgb(107, 63, 181)']);
});

test('an opponent-only change updates opponent-goal timeline rows', async ({ page }) => {
  await seedLive([ev('oppGoal', 1)]);
  await open(page, '#/game/g1');
  const row = page.locator('[data-testid="timeline-item"][data-side="them"]');
  await expect(row).toContainText('Opponent FC');
  await update('games/g1', { opponent: 'New Name' });
  await expect(row).toContainText('New Name');
  await expect(row).not.toContainText('Opponent FC');
});

test('untracked game shows no badge', async ({ page }) => {
  await seedTracked([ev('goal', 1, 'p5')], false);
  await open(page, '#/game/g1');
  await expect(page.getByTestId('score-us')).toHaveText('1');
  // game-manup / game-mandown ('Man-up —') are the Team tab's untracked line now.
  await page.getByTestId('tab-team').click();
  await expect(page.getByTestId('team-untracked')).toHaveText("Man-up and man-down weren't tracked in this game");
  await expect(page.getByTestId('team-manup')).toHaveCount(0);
  await expect(page.getByTestId('situation-badge')).toBeHidden();
  await expect(page.getByTestId('situation-badge')).not.toHaveAttribute('data-kind', /.+/);
});

test('per-game figures and Pen. columns on the season', async ({ page }) => {
  await Promise.all([
    seedTracked(),
    seed('stats/2026-27', {
      situations: { manUp: { played: 9, scored: 4 }, manDown: { played: 8, stopped: 5 } },
      players: {
        p5: { name: 'Alexiou', games: 3, goals: 7, excl: 1, pens: 2 },
        p2: { name: 'Papadakis', games: 3, goals: 4, excl: 2, pens: 0 },
      },
      results: [
        {
          gameId: 'g0', date: '2026-11-01', opponent: 'Tracked FC', us: 9, them: 7,
          manUp: { played: 7, scored: 3 }, manDown: { played: 6, stopped: 4 },
        },
        { gameId: 'gx', date: '2026-10-25', opponent: 'Untracked FC', us: 6, them: 10 },
      ],
    }),
  ]);
  await open(page);
  // The rows are on the page before anything is said to be gone from them.
  await expect(page.getByTestId('result-row')).toHaveCount(2);
  // The season's man-up and man-down line is gone from the season block.
  await expect(page.getByTestId('season-situations')).toHaveCount(0);
  await expect(page.getByTestId('result-situations')).toHaveCount(0); // retired; the season Team tab carries the figures
  await page.getByTestId('tab-players').click();
  await expect(page.getByTestId('season-pen')).toHaveText(['2', '0']);
  // The per-game figures ('MU 3/7 · MD 4/6', '—') are the Team tab's rows; a game without them shows dashes.
  // The season total sums the games' own figures (3/7, 4/6), not the stats document's situations field.
  await page.getByTestId('tab-team').click();
  const gameRows = page.getByTestId('season-team-game-row');
  await expect(gameRows).toHaveCount(2);
  await expect(gameRows.nth(0).getByTestId('season-team-mu')).toHaveText('3/7');
  await expect(gameRows.nth(0).getByTestId('season-team-md')).toHaveText('4/6');
  await expect(gameRows.nth(1).getByTestId('season-team-mu')).toHaveText('–');
  await expect(gameRows.nth(1).getByTestId('season-team-md')).toHaveText('–');
  const total = page.getByTestId('season-team-total');
  await expect(total.getByTestId('season-team-mu-total')).toHaveText('3/7');
  await expect(total.getByTestId('season-team-mu-pct')).toHaveText('43%');
  await expect(total.getByTestId('season-team-md-total')).toHaveText('4/6');
  await expect(total.getByTestId('season-team-md-pct')).toHaveText('67%');
});

test('an old stats document without the new fields still renders', async ({ page }) => {
  await Promise.all([
    seedTracked(),
    seed('stats/2026-27', {
      players: { p5: { name: 'Alexiou', games: 3, goals: 7, excl: 1 } },
      results: [{ gameId: 'g0', date: '2026-11-01', opponent: 'Old FC', us: 9, them: 7 }],
    }),
  ]);
  await open(page);
  await expect(page.getByTestId('result-row')).toHaveCount(1);
  await expect(page.getByTestId('season-situations')).toHaveCount(0);
  await page.getByTestId('tab-players').click();
  await expect(page.getByTestId('season-pen')).toHaveText('0');
  // On the Team tab the missing figures are dashes, never undefined or NaN.
  await page.getByTestId('tab-team').click();
  const row = page.getByTestId('season-team-game-row');
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('season-team-mu')).toHaveText('–');
  await expect(row.getByTestId('season-team-md')).toHaveText('–');
  await expect(row.getByTestId('season-team-excl')).toHaveText('–');
  await expect(page.getByTestId('panel-team')).not.toContainText(/NaN|undefined/);
});

test('narrow screens: long opponent, shootout and figures do not cause sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const figures = { manUp: { played: 17, scored: 12 }, manDown: { played: 16, stopped: 11 } };
  await Promise.all([
    seedTracked(),
    seed('stats/2026-27', {
      situations: { manUp: { played: 90, scored: 44 }, manDown: { played: 88, stopped: 55 } },
      players: { p5: { name: 'Alexiou', games: 3, goals: 7, excl: 1, pens: 2 } },
      results: [
        {
          gameId: 'g0', date: '2026-11-01', opponent: 'Panathinaikos Athletic Club Water Polo', us: 10, them: 10, soUs: 14, soThem: 13, ...figures,
        },
        {
          gameId: 'g1x', date: '2026-10-25', opponent: 'Panathinaikosathleticclubwaterpolofederation', us: 10, them: 10, soUs: 14, soThem: 13, ...figures,
        },
      ],
    }),
  ]);
  await open(page);
  await expect(page.getByTestId('result-row')).toHaveCount(2);
  await expect(page.getByTestId('result-link').first()).toBeVisible();
  await expect(page.getByTestId('result-link').last()).toBeVisible();
  const [scrollWidth, clientWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  // And the same on home's Players tab.
  await page.getByTestId('tab-players').click();
  await expect(page.getByTestId('season-row')).toBeVisible();
  const [playersScroll, playersClient] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(playersScroll).toBeLessThanOrEqual(playersClient);
});

// Goalkeepers
const goalieLineup = [
  { playerId: 'g1', name: 'Georgiou', cap: 1, goalie: true },
  { playerId: 'g13', name: 'Nikolaou', cap: 13, goalie: true },
  { playerId: 'p5', name: 'Alexiou', cap: 5 },
];
const seedGoalieGame = (events, { status = 'live', period = 2, lineup: gameLineup = goalieLineup } = {}) => Promise.all([
  seed('team/main', { currentGameId: 'g1', roster }),
  seed('games/g1', {
    opponent: 'Opponent FC', date: '2026-11-08', season: '2026-27', status, period, lineup: gameLineup, events,
  }),
]);
const goalieEvents = () => [
  ev('save', 1, 'g1'), ev('save', 1, 'g1'), ev('oppGoal', 1), ev('penSave', 1, 'g1'),
  ev('gkIn', 2, 'g13'), ev('oppGoal', 2), ev('save', 2, 'g13'),
];
const goalieRow = (page, cap) => page.locator(`[data-testid="goalie-row"][data-cap="${cap}"]`);

test('the Goalkeepers table shows saves, pen saves, GA and save %, and the in-goal dot while live', async ({ page }) => {
  await seedGoalieGame(goalieEvents());
  await open(page, '#/game/g1');
  await page.getByTestId('tab-players').click();
  const table = page.getByTestId('game-goalies');
  await expect(table).toBeVisible();
  await expect(table).toContainText('Goalkeepers');
  await expect(page.getByTestId('goalie-row')).toHaveCount(2);
  const georgiou = goalieRow(page, 1);
  await expect(georgiou).toContainText('Georgiou');
  await expect(georgiou.getByTestId('goalie-saves')).toHaveText('2');
  await expect(georgiou.getByTestId('goalie-pen-saves')).toHaveText('1');
  await expect(georgiou.getByTestId('goalie-ga')).toHaveText('1');
  await expect(georgiou.getByTestId('goalie-pct')).toHaveText('75%');
  const nikolaou = goalieRow(page, 13);
  await expect(nikolaou.getByTestId('goalie-saves')).toHaveText('1');
  await expect(nikolaou.getByTestId('goalie-pen-saves')).toHaveText('0');
  await expect(nikolaou.getByTestId('goalie-ga')).toHaveText('1');
  await expect(nikolaou.getByTestId('goalie-pct')).toHaveText('50%');
  await expect(page.getByTestId('goalie-in-goal')).toHaveCount(1);
  await expect(nikolaou.getByTestId('goalie-in-goal')).toHaveCount(1);
  await expect(nikolaou.getByTestId('goalie-in-goal')).toContainText('in goal');
  await expect(georgiou.getByTestId('goalie-in-goal')).toHaveCount(0);
  await expect(page.getByTestId('goalie-shootout')).toHaveCount(0);

  // A switch of the goalie in goal moves the dot; a goalie without shots shows a dash.
  await update('games/g1', { events: [...goalieEvents(), ev('gkIn', 2, 'g1')] });
  await expect(georgiou.getByTestId('goalie-in-goal')).toHaveCount(1);
  await expect(nikolaou.getByTestId('goalie-in-goal')).toHaveCount(0);

  // Once the game is final nobody is in goal any more.
  await update('games/g1', { status: 'final' });
  await expect(page.getByTestId('final-badge')).toBeVisible();
  await expect(page.getByTestId('goalie-in-goal')).toHaveCount(0);
  await expect(page.getByTestId('goalie-row')).toHaveCount(2);
});

test('a goalie with no shots faced shows a dash for save %', async ({ page }) => {
  await seedGoalieGame([ev('save', 1, 'g1')]);
  await open(page, '#/game/g1');
  await page.getByTestId('tab-players').click();
  await expect(goalieRow(page, 1).getByTestId('goalie-pct')).toHaveText('100%');
  await expect(goalieRow(page, 13).getByTestId('goalie-pct')).toHaveText('—');
});

test('saves and penalty saves appear in the timeline; In goal does not', async ({ page }) => {
  await seedGoalieGame(goalieEvents());
  await open(page, '#/game/g1');
  // 3 saves, oppGoal x2 and the one penSave; gkIn stays out
  const items = page.getByTestId('timeline-item');
  await expect(items).toHaveCount(6);
  // "Penalty saved" also contains "save", and hasText is a case-insensitive substring match: select on the text span.
  const saves = items.filter({ has: page.locator('.tl-what', { hasText: /^Save$/ }) });
  await expect(saves).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await expect(saves.nth(i).getByTestId('tl-icon')).toHaveClass(/tl-icon--save/);
    await expect(saves.nth(i).getByTestId('tl-icon').locator('svg')).toBeVisible();
    await expect(saves.nth(i)).toHaveClass(/tl-minor/);
  }
  await expect(items.filter({ hasText: '#13 Nikolaou' })).toHaveCount(1);
  const penSave = page.locator('[data-testid="timeline-item"]', { hasText: 'Penalty saved' });
  await expect(penSave).toHaveCount(1);
  await expect(penSave.getByTestId('tl-icon')).toHaveClass(/tl-icon--save/);
  await expect(penSave.locator('.tl-what')).toHaveText('Penalty saved');
  await expect(penSave).toContainText('#1 Georgiou');
  await expect(penSave).not.toHaveClass(/tl-minor/);
  await expect(page.locator('[data-testid="timeline-item"]', { hasText: 'In goal' })).toHaveCount(0);
});

test('the goalie shootout line', async ({ page }) => {
  const so = [ev('penSave', 'SO', 'g1'), ev('oppGoal', 'SO'), ev('penSave', 'SO', 'g1'), ev('oppGoal', 'SO'), ev('oppGoal', 'SO')];
  await seedGoalieGame([ev('save', 1, 'g1'), ev('oppGoal', 1), ...so], { period: 'SO' });
  await open(page, '#/game/g1');
  await page.getByTestId('tab-players').click();
  await expect(page.getByTestId('goalie-shootout')).toHaveText('Shootout: 2 saved, 3 conceded');
  // Shootout events stay out of the regular columns.
  const georgiou = goalieRow(page, 1);
  await expect(georgiou.getByTestId('goalie-saves')).toHaveText('1');
  await expect(georgiou.getByTestId('goalie-pen-saves')).toHaveText('0');
  await expect(georgiou.getByTestId('goalie-ga')).toHaveText('1');
  await expect(page.getByTestId('shootout')).toHaveText('(0 – 3 pen.)');
});

test('the season Goalkeepers table', async ({ page }) => {
  await Promise.all([
    seedGoalieGame(goalieEvents()),
    seed('stats/2026-27', {
      players: { p5: { name: 'Alexiou', games: 3, goals: 7, excl: 1 } },
      goalies: {
        g1: { name: 'Georgiou', games: 3, saves: 20, penSaves: 2, goalsAgainst: 10 },
        g13: { name: 'Nikolaou', games: 1, saves: 0, penSaves: 0, goalsAgainst: 0 },
      },
    }),
  ]);
  await open(page);
  await page.getByTestId('tab-players').click();
  await expect(page.getByTestId('season-goalies')).toBeVisible();
  await expect(page.getByTestId('season-goalie-row')).toHaveCount(2);
  const georgiou = page.locator('[data-testid="season-goalie-row"]', { hasText: 'Georgiou' });
  await expect(georgiou.locator('td')).toHaveText(['Georgiou', '3', '20', '2', '10', '69%']);
  const nikolaou = page.locator('[data-testid="season-goalie-row"]', { hasText: 'Nikolaou' });
  await expect(nikolaou.locator('td')).toHaveText(['Nikolaou', '1', '0', '0', '0', '—']);
  await expect(page.getByTestId('season-row')).toHaveCount(1);
});

test('games and stats without goalies render as before', async ({ page }) => {
  await Promise.all([
    seedLive(),
    seed('stats/2026-27', {
      players: { p5: { name: 'Alexiou', games: 3, goals: 7, excl: 1 } },
      goalies: {},
    }),
  ]);
  await open(page);
  await page.getByTestId('tab-players').click();
  await expect(page.getByTestId('season-row')).toHaveCount(1);
  await expect(page.getByTestId('game-goalies')).toHaveCount(0);
  await expect(page.getByTestId('season-goalies')).toHaveCount(0);
  await expect(page.getByTestId('goalie-row')).toHaveCount(0);
});

test('no shootout line on a final game without shootout events', async ({ page }) => {
  await Promise.all([
    seedGoalieGame([ev('goal', 1, 'p5'), ev('oppGoal', 1)], { status: 'final', period: 'SO' }),
    seed('stats/2026-27', {
      players: { p5: { name: 'Alexiou', games: 1, goals: 1, excl: 0 } },
      results: [{ gameId: 'g0', date: '2026-11-01', opponent: 'Delfin', us: 9, them: 9, soUs: 0, soThem: 0 }],
    }),
  ]);
  await open(page, '#/game/g1');
  await expect(page.getByTestId('final-badge')).toBeVisible();
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await expect(page.getByTestId('shootout')).toBeHidden();
  // The results row on home does not show a shootout either.
  await open(page);
  await expect(page.getByTestId('result-row')).toHaveCount(1);
  await expect(page.getByTestId('result-row')).not.toContainText('pen.');
  await expect(page.getByTestId('result-row')).toContainText('9 – 9');
  // Opening home again aborts the streams that were open; that is not an app error.
  dropNetworkNoise(problems);
});

test('a live game in the shootout with no shootout events still shows 0 – 0 pen.', async ({ page }) => {
  await seedGoalieGame([ev('goal', 1, 'p5')], { period: 'SO' });
  await open(page, '#/game/g1');
  await expect(page.getByTestId('shootout')).toHaveText('(0 – 0 pen.)');
});

test('the Goalkeepers table does not cause sideways scrolling at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await seedGoalieGame(goalieEvents(), {
    lineup: [
      { playerId: 'g1', name: 'Konstantinopoulos-Papadimitriou', cap: 1, goalie: true },
      { playerId: 'g13', name: 'Nikolaou', cap: 13, goalie: true },
    ],
  });
  await seed('stats/2026-27', {
    goalies: { g1: { name: 'Konstantinopoulos-Papadimitriou', games: 12, saves: 120, penSaves: 12, goalsAgainst: 100 } },
  });
  for (const [hash, testId, count] of [['#/game/g1', 'goalie-row', 2], ['', 'season-goalie-row', 1]]) {
    await open(page, hash);
    await page.getByTestId('tab-players').click();
    await expect(page.getByTestId(testId)).toHaveCount(count);
    await expect(page.getByTestId(testId).first()).toBeVisible();
    const [scrollWidth, clientWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scrollWidth, hash || 'home').toBeLessThanOrEqual(clientWidth);
  }
  // Opening home after the game aborts the streams that were open; that is not an app error.
  dropNetworkNoise(problems);
});

// The centre-line timeline: running scores, quarter markers, tags, icons and their fallbacks.
const timelineSequence = page => page.locator('.tl-list > li').evaluateAll(items => items.map(item => (item.classList.contains('tl-quarter')
  ? item.textContent.trim()
  : item.querySelector('[data-testid="tl-score"]')?.textContent ?? '(icon)')));

test('goal rows carry the running score, a goal added late to Q1 reads in Q1, and each quarter has its marker', async ({ page }) => {
  // The last goal is stamped long after the Q2 goal but belongs to Q1: Q1 reads 1–0, 1–1, 2–1 and Q2 3–1.
  await seedLive([
    ev('goal', 1, 'p5'), ev('oppGoal', 1), ev('goal', 2, 'p2'),
    { id: 'late', type: 'goal', period: 1, ts: 99999, playerId: 'p2' },
  ]);
  await open(page, '#/game/g1');
  await expect(page.getByTestId('timeline-item')).toHaveCount(4);
  expect(await timelineSequence(page)).toEqual(['Q2 1–0', '3–1', 'Q1 2–1', '2–1', '1–1', '1–0']);
  const late = page.getByTestId('timeline-item').filter({ has: page.getByTestId('tl-name').filter({ hasText: '#2 Papadakis' }) });
  await expect(late).toHaveCount(2);
  // Ours are amber on the board, theirs ink on the card with an outline.
  const styles = await page.evaluate(() => ['us', 'them'].map(side => {
    const style = getComputedStyle(document.querySelector(`[data-side="${side}"] [data-testid="tl-score"]`));
    return [style.backgroundColor, style.color, style.borderTopColor, style.borderTopWidth];
  }));
  expect(styles).toEqual([
    ['rgb(11, 19, 32)', 'rgb(255, 194, 61)', 'rgb(36, 50, 74)', '1px'],
    ['rgb(255, 255, 255)', 'rgb(11, 19, 32)', 'rgb(122, 135, 150)', '1px'],
  ]);
  // A goal row has the score in its centre and no icon box.
  await expect(page.getByTestId('timeline-item').filter({ has: page.getByTestId('tl-score') }).getByTestId('tl-icon')).toHaveCount(0);
});

test('a game with a shootout has a Shootout marker and pills that start from 0', async ({ page }) => {
  await Promise.all([
    seed('team/main', { currentGameId: 'g1', roster }),
    seed('games/g1', {
      opponent: 'Opponent FC', date: '2026-11-08', season: '2026-27', status: 'final', period: 'SO', lineup,
      events: [ev('goal', 4, 'p5'), ev('oppGoal', 4), ev('goal', 'SO', 'p5'), ev('oppGoal', 'SO'), ev('goal', 'SO', 'p2')],
    }),
  ]);
  await open(page, '#/game/g1');
  await expect(page.getByTestId('timeline-item')).toHaveCount(5);
  expect(await timelineSequence(page)).toEqual(['Shootout 2–1', '2–1', '1–1', '1–0', 'Q4 1–1', '1–1', '1–0']);
});

test('the heading shows the date and the order, with or without events', async ({ page }) => {
  await seedLive([]);
  await open(page, '#/game/g1');
  await expect(page.getByTestId('score-us')).toHaveText('0');
  await expect(page.getByTestId('timeline-heading')).toHaveText('08/11/2026 · newest first');
  await expect(page.getByTestId('timeline-item')).toHaveCount(0);
  await expect(page.getByTestId('panel-timeline')).toContainText('No goals or exclusions yet.');
  await update('games/g1', { events: [ev('goal', 1, 'p5')] });
  await expect(page.getByTestId('timeline-item')).toHaveCount(1);
  await expect(page.getByTestId('timeline-heading')).toHaveText('08/11/2026 · newest first');
});

test('the pills and the card follow the dark scheme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await seedLive([ev('goal', 1, 'p5'), ev('oppGoal', 1)]);
  await open(page, '#/game/g1');
  await expect(page.getByTestId('tl-score')).toHaveCount(2);
  const styles = await page.evaluate(() => [
    ...['us', 'them'].map(side => {
      const style = getComputedStyle(document.querySelector(`[data-side="${side}"] [data-testid="tl-score"]`));
      return [style.backgroundColor, style.color, style.borderTopColor];
    }),
    getComputedStyle(document.querySelector('.tl-list')).backgroundColor,
    getComputedStyle(document.querySelector('.tl-quarter h3')).backgroundColor,
  ]);
  expect(styles).toEqual([
    ['rgb(5, 9, 15)', 'rgb(255, 194, 61)', 'rgb(31, 43, 61)'],
    ['rgb(19, 30, 46)', 'rgb(232, 238, 245)', 'rgb(93, 107, 125)'],
    'rgb(19, 30, 46)',
    'rgb(5, 9, 15)',
  ]);
});

const iconLineup = [...goalieLineup, { playerId: 'p2', name: 'Papadakis', cap: 2 }];
const iconEvents = () => [
  ev('goal', 1, 'p5'), ev('oppGoal', 1), ev('excl', 1, 'p2'), ev('excl', 1, 'p2'), ev('excl', 1, 'p2'),
  ev('pen', 1, 'p5'), ev('save', 1, 'g1'), ev('penSave', 1, 'g1'),
];
// Newest first. A goal's centre is its score, so its row has no icon: these are the icons of the other rows.
const GLYPHS = ['✋', '✋', 'P', '🟥', 'E', 'E'];

test.describe('the stroke icons', () => {
  test.use({ serviceWorkers: 'block' });

  test('a row\'s centre is a stroke svg once icons.js is in', async ({ page }) => {
    await seedGoalieGame(iconEvents(), { period: 1, lineup: iconLineup });
    await open(page, '#/game/g1');
    const icons = page.getByTestId('tl-icon');
    await expect(icons).toHaveCount(6);
    await expect(icons.locator('svg')).toHaveCount(6);
    expect(await icons.locator('svg').first().evaluate(svg => [
      svg.getAttribute('aria-hidden'), svg.getAttribute('viewBox'), svg.getAttribute('stroke-width'),
      svg.getAttribute('stroke-linecap'), svg.getAttribute('stroke-linejoin'), svg.querySelectorAll('path').length,
    ])).toEqual(['true', '0 0 24 24', '2', 'round', 'round', 1]);
    // No glyph text beside the svg.
    expect(await icons.evaluateAll(els => els.map(el => el.textContent))).toEqual(['', '', '', '', '', '']);
    await expect(page.getByTestId('tl-score')).toHaveCount(2);
  });

  test('with icons.js missing every icon box shows its glyph and the pills still show', async ({ page, baseURL }) => {
    blockedUrl = new URL('/js/icons.js', baseURL).href;
    await page.route('**/js/icons.js', route => route.abort());
    await seedGoalieGame(iconEvents(), { period: 1, lineup: iconLineup });
    await open(page, '#/game/g1');
    await expect(page.getByTestId('timeline-item')).toHaveCount(8);
    await expect(page.getByTestId('tl-score')).toHaveText(['1–1', '1–0']);
    await expect(page.getByTestId('tl-icon')).toHaveText(GLYPHS);
    await expect(page.locator('[data-testid="tl-icon"] svg')).toHaveCount(0);
    // The failure does not leave the page waiting: the other tabs work.
    await page.getByTestId('tab-players').click();
    await expect(page.getByTestId('player-row').first()).toBeVisible();
  });

  test('with the previous model.js there are no pills: goal rows show the goal icon and the markers only the quarter', async ({ page }) => {
    const previous = execSync('git show 58f859d:js/model.js', { encoding: 'utf8', maxBuffer: 1 << 20 });
    await page.route('**/js/model.js', route => route.fulfill({ contentType: 'text/javascript', body: previous }));
    await seedLive([ev('goal', 1, 'p5'), ev('oppGoal', 1), ev('goal', 2, 'p2')]);
    await open(page, '#/game/g1');
    await expect(page.getByTestId('timeline-item')).toHaveCount(3);
    await expect(page.getByTestId('tl-score')).toHaveCount(0);
    await expect(page.getByTestId('tl-icon')).toHaveCount(3);
    await expect(page.locator('.tl-icon--goal')).toHaveCount(3);
    await expect(page.locator('.tl-icon--goal svg')).toHaveCount(3);
    await expect(page.getByTestId('tl-quarter')).toHaveText(['Q2', 'Q1']);
    await expect(page.getByTestId('timeline-item').first().getByTestId('tl-name')).toHaveText('#2 Papadakis');
  });

  test('with the previous model.js and no icons.js the goal rows show the ball glyph', async ({ page, baseURL }) => {
    const previous = execSync('git show 58f859d:js/model.js', { encoding: 'utf8', maxBuffer: 1 << 20 });
    blockedUrl = new URL('/js/icons.js', baseURL).href;
    await page.route('**/js/icons.js', route => route.abort());
    await page.route('**/js/model.js', route => route.fulfill({ contentType: 'text/javascript', body: previous }));
    await seedLive([ev('goal', 1, 'p5'), ev('oppGoal', 1)]);
    await open(page, '#/game/g1');
    await expect(page.getByTestId('tl-icon')).toHaveText(['🏐', '🏐']);
    await expect(page.getByTestId('tl-score')).toHaveCount(0);
  });

  test('with the previous strings.js each label shows once and the name line is intact', async ({ page }) => {
    const previous = execSync('git show 58f859d:js/strings.js', { encoding: 'utf8', maxBuffer: 1 << 20 });
    await page.route('**/js/strings.js', route => route.fulfill({ contentType: 'text/javascript', body: previous }));
    await seedGoalieGame([ev('excl', 1, 'p2'), ev('excl', 1, 'p2'), ev('excl', 1, 'p2'), ev('save', 1, 'g1')], { period: 1, lineup: iconLineup });
    await open(page, '#/game/g1');
    await expect(page.getByTestId('timeline-item')).toHaveCount(4);
    const save = page.getByTestId('timeline-item').filter({ hasText: 'Georgiou' });
    await expect(save).toHaveCount(1);
    await expect(save.getByTestId('tl-name')).toHaveText('#1 Georgiou');
    const out = page.locator('[data-testid="timeline-item"][data-out="true"]');
    await expect(out).toHaveCount(1);
    await expect(out.getByTestId('tl-name')).toHaveText('#2 Papadakis');
    // The label is on the row once: not again as screen-reader text or as the old one-line text.
    const count = (row, word) => row.evaluate((el, w) => el.textContent.split(w).length - 1, word);
    expect(await count(save, 'Save')).toBe(1);
    expect(await count(out, 'Exclusion')).toBe(1);
    // The out tag falls back to its English text without the new key.
    await expect(out.getByTestId('tl-out')).toHaveText('· out');
    expect(await out.evaluate(el => el.textContent.includes('tlOutTag'))).toBe(false);
  });
});
