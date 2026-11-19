import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { seasonFor, todayIso } from '../../js/model.js';
import { closeAll, get, remove, resetAll, seed, update } from './helpers.js';

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

// Seasons far from the calendar one, so a calendar season showing up in the record is told apart.
const OLD = '2019-20';
const NEW = '2020-21';
const CALENDAR = seasonFor(todayIso());

const game = (id, { opponent, season = OLD, status = 'final', date = '2019-11-01', events = pastEvents, period = 4 }) =>
  seed(`games/${id}`, { opponent, date, season, status, period, lineup, events });
const stats = (season, results) => seed(`stats/${season}`, {
  players: { p5: { name: 'Alexiou', games: results.length, goals: results.length, excl: 0 } },
  results: results.map(([gameId, opponent, date]) => ({ gameId, date, opponent, us: 2, them: 1 })),
});
const team = currentGameId => seed('team/main', { currentGameId, roster });

// g1 finished, g2 the current game, both in OLD and in OLD's results.
const seedSeason = ({ liveOpponent = 'Waves', currentStatus = 'live' } = {}) => Promise.all([
  team('g2'),
  game('g1', { opponent: 'Rivals' }),
  game('g2', { opponent: liveOpponent, status: currentStatus, date: '2019-11-08', events: liveEvents, period: 1 }),
  stats(OLD, [['g1', 'Rivals', '2019-11-01'], ['g2', liveOpponent, '2019-11-08']]),
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
const home = page => page.getByTestId('games-list');
const allGames = page => page.getByTestId('all-games');
const banner = page => page.getByTestId('live-banner');
const rows = page => page.getByTestId('result-row');

// Chromium and WebKit word a request that the test aborted or cut off differently, and Firestore logs
// its own transport errors and that it cannot reach its backend. None of that is an app error.
const NETWORK_NOISE = /ERR_FAILED|ERR_INTERNET_DISCONNECTED|Load failed|Could not reach Cloud Firestore|transport errored|WebKit encountered|due to access control checks/;
const dropNoise = () => { problems = problems.filter(problem => !NETWORK_NOISE.test(problem)); };

// Removes the one console warning an injected failure is expected to print, and proves it was printed.
function expectWarning(pattern) {
  const found = problems.filter(problem => pattern.test(problem));
  expect(found).toHaveLength(1);
  problems = problems.filter(problem => !pattern.test(problem));
}

// Records each distinct (season, results state, first result's opponent) the home element shows, in a
// MutationObserver so that a state shown for a single frame is still caught.
const recordHome = page => page.addInitScript(() => {
  window.__home = [];
  const read = () => {
    const el = document.querySelector('[data-testid="games-list"]');
    if (!el) return;
    const first = document.querySelector('[data-testid="result-row"] td:nth-child(2)')?.textContent ?? '';
    const entry = [el.dataset.season ?? '', el.dataset.results ?? '', first].join('|');
    if (window.__home.at(-1) !== entry) window.__home.push(entry);
  };
  new MutationObserver(read).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
});
// Whether the celebration was ever shown. The overlay hides itself after 2.5 s, so checking it at the end
// of a wait would miss a celebration that came and went.
const recordCelebration = page => page.addInitScript(() => {
  window.__celebrated = false;
  new MutationObserver(() => {
    const overlay = document.querySelector('[data-testid="celebration"]');
    if (overlay && !overlay.hidden) window.__celebrated = true;
  }).observe(document, { subtree: true, attributes: true, childList: true });
});
const celebrated = page => page.evaluate(() => window.__celebrated);
const recorded = async page => (await page.evaluate(() => window.__home))
  .map(entry => {
    const [season, results, first] = entry.split('|');
    return { season, results, first };
  })
  .filter(entry => entry.season !== '');
const seasonsOf = record => [...new Set(record.map(entry => entry.season))];

test('home with a live current game shows the header and the banner, and the banner opens the game', async ({ page }) => {
  await Promise.all([
    team('g1'),
    game('g1', { opponent: 'Rivals', status: 'live', events: liveEvents, period: 1 }),
    stats(OLD, [['g0', 'Earlier', '2019-10-01']]),
  ]);
  await open(page);
  await expect(home(page)).toBeVisible();
  await expect(home(page).locator('h1')).toHaveText('ANOG');
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toHaveText(/^LIVE · Q1 · ANOG 1–0 Rivals\s*Watch$/);
  await expect(banner(page)).toHaveAttribute('href', '#/game/g1');
  await expect(page.getByTestId('live-banner-text')).toHaveText('LIVE · Q1 · ANOG 1–0 Rivals');
  await expect(page.getByTestId('watch-live')).toHaveText('Watch');
  await expect(page.getByTestId('score-us')).toHaveCount(1);
  await expect(page.getByTestId('score-us')).toBeHidden();
  await expect(allGames(page)).toBeHidden();
  await expect(home(page)).toHaveAttribute('data-season', OLD);
  await expect(home(page)).toHaveAttribute('data-results', 'ready');

  await banner(page).click();
  await expect.poll(() => hashOf(page)).toBe('#/game/g1');
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await expect(page.getByTestId('live-badge')).toBeVisible();
  await expect(opponentName(page)).toHaveText('Rivals');
  await expect(allGames(page)).toHaveText('This season');
  await expect(allGames(page)).toHaveAttribute('href', '#/');
  await expect(banner(page)).toBeHidden();
  await expect(home(page)).toBeHidden();
  await expect(page.getByTestId('season-row')).toHaveCount(0);

  await allGames(page).click();
  await expect.poll(() => hashOf(page)).toBe('#/');
  await expect(home(page)).toBeVisible();
  await expect(banner(page)).toBeVisible();
});

test('#/games renders the same home as #/', async ({ page }) => {
  await seedSeason();
  await open(page, '#/games');
  await expect(home(page)).toBeVisible();
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toContainText('LIVE · Q1 · ANOG 1–0 Waves');
  await expect(home(page)).toHaveAttribute('data-season', OLD);
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByTestId('score-us')).toBeHidden();
  await expect(allGames(page)).toBeHidden();
  await open(page, '#/');
  await expect(home(page)).toBeVisible();
  await expect(home(page)).toHaveAttribute('data-season', OLD);
  await expect(rows(page)).toHaveCount(2);
});

test('home with a final current game shows its season and no banner', async ({ page }) => {
  await seedSeason({ currentStatus: 'final' });
  await open(page);
  await expect(home(page)).toHaveAttribute('data-results', 'ready');
  await expect(page.getByTestId('result-link')).toHaveCount(2);
  await expect(banner(page)).toBeHidden();
  await expect(allGames(page)).toBeHidden();
  await expect(page.locator('[data-testid="result-row"][aria-current="page"]')).toHaveCount(0);
  await expect(page.getByTestId('season-situations')).toHaveCount(0);
});

test('home with no games says so', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('results-empty')).toBeVisible();
  await expect(page.getByTestId('results-empty')).toHaveText('No games yet this season.');
  await expect(page.getByTestId('empty-state')).toHaveCount(0);
  await expect(home(page)).toHaveAttribute('data-season', CALENDAR);
  await expect(home(page)).toHaveAttribute('data-results', 'empty');
  await expect(banner(page)).toBeHidden();
  await open(page, '#/games');
  await expect(page.getByTestId('results-empty')).toBeVisible();
});

test('the live game ending on home removes the banner and its result arrives with the stats', async ({ page }) => {
  await Promise.all([
    team('g2'),
    game('g1', { opponent: 'Rivals' }),
    game('g2', { opponent: 'Waves', status: 'live', date: '2019-11-08', events: liveEvents, period: 1 }),
    stats(OLD, [['g1', 'Rivals', '2019-11-01']]),
  ]);
  await recordHome(page);
  await open(page);
  await expect(banner(page)).toContainText('Waves');
  await expect(rows(page)).toHaveCount(1);
  await update('games/g2', { status: 'final' });
  await expect.poll(async () => (await get('games/g2')).status).toBe('final');
  await expect(banner(page)).toBeHidden({ timeout: 5000 });
  await expect(home(page)).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
  expect(await hashOf(page)).toBe('');
  // The tracker's recount writes the stats document after the game ends.
  await update('stats/' + OLD, {
    results: [
      { gameId: 'g1', date: '2019-11-01', opponent: 'Rivals', us: 2, them: 1 },
      { gameId: 'g2', date: '2019-11-08', opponent: 'Waves', us: 1, them: 0 },
    ],
  });
  await expect(rows(page)).toHaveCount(2, { timeout: 5000 });
  const record = await recorded(page);
  expect(seasonsOf(record)).toEqual([OLD]);
  const firstReady = record.findIndex(entry => entry.results === 'ready');
  expect(firstReady).toBeGreaterThanOrEqual(0);
  expect(record.slice(firstReady).map(entry => entry.results)).not.toContain('loading');
  expect(record.slice(firstReady).map(entry => entry.results)).not.toContain('empty');
});

// Ending a reopened older game also moves currentGameId to the newest game, in one batch; the viewer's
// team and game listeners can fire in either order. Two sequential writes pin each order.
const seedReopened = () => Promise.all([
  team('g1'),
  game('g1', { opponent: 'Rivals', status: 'live', period: 4 }),
  game('g2', { opponent: 'Waves', season: NEW, status: 'final', date: '2020-11-08', events: liveEvents }),
  stats(OLD, [['g1', 'Rivals', '2019-11-01']]),
  stats(NEW, [['g2', 'Waves', '2020-11-08']]),
]);

for (const order of ['the team first', 'the game first']) {
  test(`ending the live game on home while the pointer moves to a newer game (${order}) settles on the newer season`, async ({ page }) => {
    await seedReopened();
    await recordHome(page);
    await open(page);
    await expect(banner(page)).toContainText('Rivals');
    await expect(home(page)).toHaveAttribute('data-season', OLD);
    if (order === 'the team first') {
      await update('team/main', { currentGameId: 'g2' });
      // g1 is no longer the current game, so its banner goes while g1 is still live.
      await expect(banner(page)).toBeHidden({ timeout: 5000 });
      await update('games/g1', { status: 'final' });
    } else {
      await update('games/g1', { status: 'final' });
      await expect(banner(page)).toBeHidden({ timeout: 5000 });
      await update('team/main', { currentGameId: 'g2' });
    }
    await expect(home(page)).toHaveAttribute('data-season', NEW, { timeout: 5000 });
    await expect(home(page)).toHaveAttribute('data-results', 'ready');
    await expect(rows(page).first().locator('td').nth(1)).toHaveText('Waves');
    expect((await get('games/g1')).status).toBe('final');
    expect((await get('team/main')).currentGameId).toBe('g2');
    const record = await recorded(page);
    expect(seasonsOf(record).sort()).toEqual([OLD, NEW]);
    // Both seasons have results: neither may show as empty at any point.
    expect(record.map(entry => entry.results)).not.toContain('empty');
    // Once the old season's results showed, nothing but the new season's loading may replace them.
    const oldEntries = record.filter(entry => entry.season === OLD).map(entry => entry.results);
    expect(oldEntries.slice(oldEntries.indexOf('ready')).every(state => state === 'ready')).toBe(true);
    await expect(banner(page)).toBeHidden();
  });

  test(`ending the game while on its screen with the pointer moved (${order}) stays on the final score`, async ({ page }) => {
    await Promise.all([
      team('g1'),
      game('g1', { opponent: 'Rivals', status: 'live', period: 4 }),
      game('g2', { opponent: 'Waves', season: NEW, status: 'live', date: '2020-11-08', events: liveEvents, period: 1 }),
    ]);
    await open(page, '#/game/g1');
    await expect(opponentName(page)).toHaveText('Rivals');
    await expect(page.getByTestId('live-badge')).toBeVisible();
    await page.evaluate(() => {
      window.__gone = false;
      new MutationObserver(() => {
        const home = document.querySelector('[data-testid="games-list"]');
        const unavailable = document.querySelector('[data-testid="game-unavailable"]');
        if ((home && !home.hidden) || (unavailable && !unavailable.hidden)) window.__gone = true;
      }).observe(document.body, { subtree: true, attributes: true, childList: true });
    });
    const before = await page.evaluate(() => history.length);
    if (order === 'the team first') {
      await update('team/main', { currentGameId: 'g2' });
      // The team snapshot has arrived once the banner shows the newer game.
      await expect(banner(page)).toContainText('Waves', { timeout: 5000 });
      await update('games/g1', { status: 'final' });
    } else {
      await update('games/g1', { status: 'final' });
      await expect(page.getByTestId('final-badge')).toBeVisible({ timeout: 5000 });
      await update('team/main', { currentGameId: 'g2' });
      await expect(banner(page)).toContainText('Waves', { timeout: 5000 });
    }
    await expect(page.getByTestId('final-badge')).toBeVisible({ timeout: 5000 });
    await expect(opponentName(page)).toHaveText('Rivals');
    await expect(page.getByTestId('score-us')).toHaveText('2');
    expect(await hashOf(page)).toBe('#/game/g1');
    expect(await page.evaluate(() => history.length)).toBe(before);
    expect(await page.evaluate(() => window.__gone)).toBe(false);
    expect((await get('games/g1')).status).toBe('final');
    expect((await get('team/main')).currentGameId).toBe('g2');
  });
}

test('a shared link opens the game before the team document exists, and seeding the team changes nothing', async ({ page }) => {
  await game('g1', { opponent: 'Rivals', status: 'live', period: 1, events: liveEvents });
  await open(page, '#/game/g1');
  await expect(opponentName(page)).toHaveText('Rivals');
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await page.evaluate(() => {
    window.__gone = false;
    new MutationObserver(() => {
      const unavailable = document.querySelector('[data-testid="game-unavailable"]');
      const board = document.querySelector('.scoreboard');
      if ((unavailable && !unavailable.hidden) || (board && board.hidden)) window.__gone = true;
    }).observe(document.body, { subtree: true, attributes: true, childList: true });
  });
  await team('g1');
  // The team document has no visible effect on a game route, so prove the page is still live instead.
  await update('games/g1', { events: [...liveEvents, ev('goal', 2, 'p2')] });
  await expect(page.getByTestId('score-us')).toHaveText('2', { timeout: 5000 });
  expect(await page.evaluate(() => window.__gone)).toBe(false);
  await expect(allGames(page)).toBeVisible();
  await expect(banner(page)).toBeHidden();
});

for (const order of ['the game first', 'the team first']) {
  test(`the current game deleted while on home with the pointer moving to another season (${order})`, async ({ page }) => {
    await Promise.all([
      team('g1'),
      game('g1', { opponent: 'Rivals' }),
      game('g2', { opponent: 'Waves', season: NEW, date: '2020-11-08', events: liveEvents }),
      stats(OLD, [['g1', 'Rivals', '2019-11-01']]),
      stats(NEW, [['g2', 'Waves', '2020-11-08']]),
    ]);
    await recordHome(page);
    await open(page);
    await expect(home(page)).toHaveAttribute('data-season', OLD);
    await expect(home(page)).toHaveAttribute('data-results', 'ready');
    if (order === 'the game first') {
      await remove('games/g1');
      await update('team/main', { currentGameId: 'g2' });
    } else {
      await update('team/main', { currentGameId: 'g2' });
      await remove('games/g1');
    }
    await expect(home(page)).toHaveAttribute('data-season', NEW, { timeout: 5000 });
    await expect(home(page)).toHaveAttribute('data-results', 'ready');
    await expect(rows(page).first().locator('td').nth(1)).toHaveText('Waves');
    expect(await get('games/g1')).toBeUndefined();
    const record = await recorded(page);
    expect(seasonsOf(record).sort()).toEqual([OLD, NEW]);
    expect(seasonsOf(record)).not.toContain(CALENDAR);
    expect(record.map(entry => entry.results)).not.toContain('empty');
    const oldEntries = record.filter(entry => entry.season === OLD).map(entry => entry.results);
    expect(oldEntries.slice(oldEntries.indexOf('ready')).every(state => state === 'ready')).toBe(true);
  });
}

test('offline on home keeps the cached results with the connection note, and reconnecting does not flash', async ({ page, context }) => {
  await Promise.all([
    team('g1'),
    game('g1', { opponent: 'Rivals' }),
    stats(OLD, [['g1', 'Rivals', '2019-11-01']]),
  ]);
  await recordHome(page);
  await open(page);
  await expect(home(page)).toHaveAttribute('data-results', 'ready');
  await expect(page.getByTestId('connection-note')).toBeHidden();
  await context.setOffline(true);
  await expect(page.getByTestId('connection-note')).toBeVisible();
  await expect(home(page)).toHaveAttribute('data-results', 'ready');
  await expect(rows(page)).toHaveCount(1);
  await context.setOffline(false);
  await expect(page.getByTestId('connection-note')).toBeHidden({ timeout: 15000 });
  await expect(rows(page)).toHaveCount(1);
  const record = await recorded(page);
  const firstReady = record.findIndex(entry => entry.results === 'ready');
  expect(firstReady).toBeGreaterThanOrEqual(0);
  expect(record.slice(firstReady)).toEqual(record.slice(firstReady).map(() => ({ season: OLD, results: 'ready', first: 'Rivals' })));
  dropNoise();
});

test('a past game while another is live shows the banner, which opens the live game', async ({ page }) => {
  await seedSeason();
  await open(page, '#/game/g1');
  await expect(opponentName(page)).toHaveText('Rivals');
  await expect(allGames(page)).toBeVisible();
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toContainText('LIVE · Q1 · ANOG 1–0 Waves');
  await banner(page).click();
  await expect.poll(() => hashOf(page)).toBe('#/game/g2');
  await expect(opponentName(page)).toHaveText('Waves');
  await expect(page.getByTestId('live-badge')).toBeVisible();
  await expect(banner(page)).toBeHidden();
  await expect(allGames(page)).toBeVisible();
});

test('a route to the live game shows it with the back link and no banner', async ({ page }) => {
  await seedSeason();
  await open(page, '#/game/g2');
  await expect(opponentName(page)).toHaveText('Waves');
  await expect(page.getByTestId('live-badge')).toBeVisible();
  await expect(allGames(page)).toHaveText('This season');
  await expect(banner(page)).toBeHidden();
});

test('an unavailable game has the back link to the season', async ({ page }) => {
  await open(page, '#/game/missing');
  await expect(page.getByTestId('game-unavailable')).toBeVisible();
  await expect(allGames(page)).toHaveText('This season');
  await expect(allGames(page)).toHaveAttribute('href', '#/');
});

test('a game starting while on home shows the banner', async ({ page }) => {
  await Promise.all([
    team('g1'),
    game('g1', { opponent: 'Rivals' }),
    game('g2', { opponent: 'Waves', status: 'live', date: '2019-11-08', events: liveEvents, period: 1 }),
    stats(OLD, [['g1', 'Rivals', '2019-11-01']]),
  ]);
  await open(page);
  await expect(home(page)).toHaveAttribute('data-results', 'ready');
  await expect(banner(page)).toBeHidden();
  await update('team/main', { currentGameId: 'g2' });
  await expect(banner(page)).toBeVisible({ timeout: 5000 });
  await expect(banner(page)).toContainText('LIVE · Q1 · ANOG 1–0 Waves');
  await expect(home(page)).toBeVisible();
});

// The bound for a celebration to appear after the goal is on screen.
const CELEBRATION_MS = 2500;

test('a goal written while on home does not celebrate', async ({ page }) => {
  await seedSeason();
  await recordCelebration(page);
  await open(page);
  await expect(banner(page)).toContainText('ANOG 1–0 Waves');
  // The celebration module loads off the critical path; its baseline is taken on the first render after it.
  await page.waitForFunction(() => document.querySelector('[data-testid="celebration"]') !== null);
  await update('games/g2', { events: [...liveEvents, ev('goal', 1, 'p2')] });
  // A celebration would be shown in the same render that shows the new score.
  await expect(banner(page)).toContainText('ANOG 2–0 Waves', { timeout: 5000 });
  expect(await celebrated(page)).toBe(false);
});

test('the same goal on the game screen celebrates within the bound', async ({ page }) => {
  await seedSeason();
  await open(page, '#/game/g2');
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await update('games/g2', { events: [...liveEvents, ev('goal', 1, 'p2')] });
  await expect(page.getByTestId('celebration')).toBeVisible({ timeout: CELEBRATION_MS });
});

test('arriving at the live game from the banner does not celebrate its goals, and a new goal does', async ({ page }) => {
  await seedSeason();
  await recordCelebration(page);
  await open(page);
  await expect(banner(page)).toContainText('ANOG 1–0 Waves');
  await update('games/g2', { events: [...liveEvents, ev('goal', 1, 'p2')] });
  await expect(banner(page)).toContainText('ANOG 2–0 Waves', { timeout: 5000 });
  await banner(page).click();
  await expect(page.getByTestId('score-us')).toHaveText('2');
  // Nothing to wait on: this checks that something did not happen, for as long as a celebration would play.
  await page.waitForTimeout(CELEBRATION_MS);
  expect(await celebrated(page)).toBe(false);
  await update('games/g2', { events: [...liveEvents, ev('goal', 1, 'p2'), ev('goal', 2, 'p5')] });
  await expect(page.getByTestId('celebration')).toBeVisible({ timeout: CELEBRATION_MS });
});

test('going back to the season during a celebration ends it', async ({ page }) => {
  await seedSeason();
  await open(page, '#/game/g2');
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await update('games/g2', { events: [...liveEvents, ev('goal', 1, 'p2')] });
  await expect(page.getByTestId('celebration')).toBeVisible({ timeout: CELEBRATION_MS });
  await allGames(page).click();
  await expect(home(page)).toBeVisible();
  await expect(page.getByTestId('celebration')).toBeHidden({ timeout: 500 });
});

test('a current game whose watch throws still shows the calendar season on a cold home', async ({ page }) => {
  await Promise.all([
    seed('team/main', { currentGameId: 'bad/id', roster }),
    stats(CALENDAR, [['g1', 'Rivals', '2019-11-01']]),
  ]);
  await open(page);
  await expect(home(page)).toHaveAttribute('data-season', CALENDAR);
  await expect(home(page)).toHaveAttribute('data-results', 'ready');
  await expect(rows(page)).toHaveCount(1);
  await expect(banner(page)).toBeHidden();
  expectWarning(/^console: Could not watch live /);
});

test('a season whose stats watch throws shows the results as unavailable', async ({ page }) => {
  await Promise.all([team('g1'), game('g1', { opponent: 'Rivals', season: '20/26' })]);
  await open(page);
  await expect(page.getByTestId('results-failed')).toBeVisible();
  await expect(page.getByTestId('results-failed')).toHaveText('Results aren\'t available right now.');
  await expect(home(page)).toHaveAttribute('data-season', '20/26');
  await expect(home(page)).toHaveAttribute('data-results', 'failed');
  await expect(page.getByTestId('results-empty')).toHaveCount(0);
  expectWarning(/^console: Could not watch stats /);
});


test('with the Listen channel blocked, home leaves loading with the connection note', async ({ page, browserName }) => {
  // WebKit does not send Firestore's stream through the page's request interception, so it cannot be blocked there.
  test.skip(browserName !== 'chromium', 'the Listen channel can only be blocked in Chromium');
  await page.route('**/google.firestore.v1.Firestore/Listen/**', route => route.abort());
  await open(page);
  const left = Date.now();
  await expect(home(page)).toHaveAttribute('data-results', /^(empty|failed)$/, { timeout: 15000 });
  await expect(page.getByTestId('connection-note')).toBeVisible({ timeout: 15000 - (Date.now() - left) });
  await expect(page.locator('[data-testid="results-loading"]')).toHaveCount(0);
  dropNoise();
});

test.describe('watches that never answer', () => {
  test.use({ serviceWorkers: 'block' });

  test('the deadline turns them into errors: results unavailable and the connection note', async ({ page }) => {
    const real = readFileSync('js/repo.js', 'utf8');
    let silent = real;
    for (const name of ['watchTeam', 'watchGame', 'watchStats']) {
      const pattern = new RegExp(`${name}: [^\\n]* =>[^\\n]*,\\n`);
      expect(silent).toMatch(pattern);
      silent = silent.replace(pattern, `${name}: () => () => {},\n`);
    }
    expect(silent).not.toBe(real);
    await page.route('**/js/repo.js', route => route.fulfill({ contentType: 'text/javascript', body: silent }));
    await open(page);
    await expect(page.getByTestId('results-failed')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('connection-note')).toBeVisible();
    await expect(home(page)).toHaveAttribute('data-results', 'failed');
    await expect(page.getByTestId('results-loading')).toHaveCount(0);
    // The worker is blocked on purpose; the browser says so once.
    problems = problems.filter(problem => problem !== 'console: Service Worker registration blocked by Playwright');
  });
});

test('no sideways scroll at 360 px on home with the banner', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await seedSeason({ liveOpponent: 'Panathinaikos Athletic Club Water Polo Federation' });
  await open(page);
  await expect(banner(page)).toBeVisible();
  await expect(home(page)).toBeVisible();
  await expect(page.getByTestId('result-link')).toHaveCount(2);
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
});
