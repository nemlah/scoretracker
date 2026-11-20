import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.js';
import { isPlaywrightServiceWorkerBlock } from './network-noise.js';
import { seasonFor, todayIso } from '../../js/model.js';
import {
  closeAll, delivered, get, instrumentRepo, recordedHome, recordHome, remove, resetAll, restartHomeRecord, seed, update,
} from './helpers.js';

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
    if (isPlaywrightServiceWorkerBlock(message.text())) return;
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
const opponentName = page => page.locator('.board-opp');
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

// What the first result row says for each season in the transition tests.
const OPPONENT = { [OLD]: 'Rivals', [NEW]: 'Waves' };
const firstReady = list => list.findIndex(entry => entry.results === 'ready');

// A recording of home taken from the moment the old season's results showed, while it moved to a season that
// also has results. Every entry counts, from the first: it starts on the old season's results; only those two
// seasons ever show (never the calendar one, never none); never 'empty'; the old season keeps its results (no
// loading); and the rows always belong to the season shown (none while loading).
function expectNoForbiddenState({ pairs, states }) {
  expect(pairs[0], 'recording starts on the old results').toEqual({ season: OLD, results: 'ready' });
  expect(states[0], 'recording starts on the old rows').toEqual({ season: OLD, results: 'ready', first: OPPONENT[OLD] });
  for (const entry of pairs) {
    expect([OLD, NEW], `season of ${JSON.stringify(entry)}`).toContain(entry.season);
    expect(entry.results, `results of ${JSON.stringify(entry)}`).not.toBe('empty');
    if (entry.season === OLD) expect(entry.results, `results of ${JSON.stringify(entry)}`).toBe('ready');
  }
  for (const entry of states) {
    expect([OLD, NEW], `season of ${JSON.stringify(entry)}`).toContain(entry.season);
    expect(entry.results, `results of ${JSON.stringify(entry)}`).not.toBe('empty');
    expect(entry.first, `first row of ${JSON.stringify(entry)}`).toBe(entry.results === 'ready' ? OPPONENT[entry.season] : '');
  }
}

// A switch within one season changes nothing the visitor can see.
function expectUnchanged({ pairs, states }) {
  for (const list of [pairs, states]) {
    expect(firstReady(list), 'home showed results').toBeGreaterThanOrEqual(0);
    const after = list.slice(firstReady(list));
    expect(after, JSON.stringify(after)).toEqual([after[0]]);
  }
}

test('home with a live current game shows the header and the banner, and the banner opens the game', async ({ page }) => {
  await Promise.all([
    team('g1'),
    game('g1', { opponent: 'Rivals', status: 'live', events: liveEvents, period: 1 }),
    stats(OLD, [['g0', 'Earlier', '2019-10-01']]),
  ]);
  await open(page);
  await expect(home(page)).toBeVisible();
  await expect(home(page).locator('h1')).toHaveText('This season');
  await expect(home(page).locator('.season-team')).toHaveText('ANOG');
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toHaveText(/^LIVE · Q1\s+ANOG 1–0 Rivals\s+Watch$/);
  await expect(banner(page)).toHaveAttribute('href', '#/game/g1');
  // The pill, then the team, the score and the opponent, each in an element of its own.
  await expect(banner(page).locator('.home-live-pill')).toHaveText('LIVE · Q1');
  await expect(page.getByTestId('live-banner-text')).toHaveText('ANOG 1–0 Rivals');
  await expect(banner(page).locator('.home-live-score')).toHaveText('1–0');
  await expect(banner(page).locator('.home-live-opp')).toHaveText('Rivals');
  await expect(page.getByTestId('watch-live')).toHaveText('Watch');
  await expect(page.getByTestId('score-us')).toHaveCount(0);
  await expect(allGames(page)).toBeHidden();
  await expect(home(page)).toHaveAttribute('data-season', OLD);
  await expect(home(page)).toHaveAttribute('data-results', 'ready');

  await banner(page).click();
  await expect.poll(() => hashOf(page)).toBe('#/game/g1');
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await expect(page.getByTestId('live-badge')).toBeVisible();
  await expect(opponentName(page)).toHaveText('Rivals');
  await expect(page.getByTestId('score-us')).toHaveCount(1);
  await expect(allGames(page)).toHaveText('This season');
  await expect(allGames(page)).toHaveAttribute('href', '#/');
  await expect(banner(page)).toBeHidden();
  await expect(home(page)).toBeHidden();
  await expect(page.getByTestId('season-row')).toHaveCount(0);

  await allGames(page).click();
  await expect.poll(() => hashOf(page)).toBe('#/');
  await expect(home(page)).toBeVisible();
  await expect(banner(page)).toBeVisible();
  // The scoreboard leaves the page with the game screen.
  await expect(page.getByTestId('score-us')).toHaveCount(0);
});

test('#/games renders the same home as #/', async ({ page }) => {
  await seedSeason();
  await open(page, '#/games');
  await expect(home(page)).toBeVisible();
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toContainText('LIVE · Q1 ANOG 1–0 Waves');
  await expect(home(page)).toHaveAttribute('data-season', OLD);
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByTestId('score-us')).toHaveCount(0);
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

// Home and the game screen while the current game ends or moves on. The viewer's listeners can fire in
// either order, and a recording only proves an order if the viewer has handled the first write before the
// second is made: `delivered` waits for the snapshot to be delivered and processed in the page.
test.describe('transitions', () => {
  test.use({ serviceWorkers: 'block' });

  test('the live game ending on home removes the banner and its result arrives with the stats', async ({ page }) => {
    await Promise.all([
      team('g2'),
      game('g1', { opponent: 'Rivals' }),
      game('g2', { opponent: 'Waves', status: 'live', date: '2019-11-08', events: liveEvents, period: 1 }),
      stats(OLD, [['g1', 'Rivals', '2019-11-01']]),
    ]);
    await instrumentRepo(page);
    await recordHome(page);
    await open(page);
    await expect(banner(page)).toContainText('Waves');
    await expect(rows(page)).toHaveCount(1);
    await update('games/g2', { status: 'final' });
    expect((await get('games/g2')).status).toBe('final');
    await delivered(page, 'games/g2', 'status', 'final');
    await expect(banner(page)).toBeHidden();
    await expect(home(page)).toBeVisible();
    await expect(rows(page)).toHaveCount(1);
    expect(await hashOf(page)).toBe('');
    // The tracker's recount writes the stats document after the game ends.
    await update(`stats/${OLD}`, {
      results: [
        { gameId: 'g1', date: '2019-11-01', opponent: 'Rivals', us: 2, them: 1 },
        { gameId: 'g2', date: '2019-11-08', opponent: 'Waves', us: 1, them: 0 },
      ],
    });
    await expect(rows(page)).toHaveCount(2, { timeout: 5000 });
    const { pairs, states } = await recordedHome(page);
    // One season, results never leave 'ready' once shown.
    for (const list of [pairs, states]) {
      const after = list.slice(firstReady(list));
      expect(firstReady(list)).toBeGreaterThanOrEqual(0);
      expect(after.every(entry => entry.season === OLD && entry.results === 'ready'), JSON.stringify(after)).toBe(true);
    }
  });

  // Ending a reopened older game also moves currentGameId to the newest game, in one batch.
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
      await instrumentRepo(page);
      await recordHome(page);
      await open(page);
      await expect(banner(page)).toContainText('Rivals');
      await expect(home(page)).toHaveAttribute('data-season', OLD);
      await expect(home(page)).toHaveAttribute('data-results', 'ready');
      await expect(rows(page).first().locator('.result-opp')).toHaveText('Rivals');
      await restartHomeRecord(page);
      if (order === 'the team first') {
        await update('team/main', { currentGameId: 'g2' });
        await delivered(page, 'team/main', 'pointer', 'g2');
        // g1 is no longer the current game, so its banner goes while g1 is still live.
        await expect(banner(page)).toBeHidden();
        await update('games/g1', { status: 'final' });
      } else {
        await update('games/g1', { status: 'final' });
        await delivered(page, 'games/g1', 'status', 'final');
        await expect(banner(page)).toBeHidden();
        await update('team/main', { currentGameId: 'g2' });
      }
      await expect(home(page)).toHaveAttribute('data-season', NEW, { timeout: 5000 });
      await expect(home(page)).toHaveAttribute('data-results', 'ready');
      await expect(rows(page).first().locator('.result-opp')).toHaveText('Waves');
      expect((await get('games/g1')).status).toBe('final');
      expect((await get('team/main')).currentGameId).toBe('g2');
      const record = await recordedHome(page);
      expectNoForbiddenState(record);
      expect(record.pairs.at(-1)).toEqual({ season: NEW, results: 'ready' });
      await expect(banner(page)).toBeHidden();
    });

    test(`ending the game while on its screen with the pointer moved (${order}) stays on the final score`, async ({ page }) => {
      await Promise.all([
        team('g1'),
        game('g1', { opponent: 'Rivals', status: 'live', period: 4 }),
        game('g2', { opponent: 'Waves', season: NEW, status: 'live', date: '2020-11-08', events: liveEvents, period: 1 }),
      ]);
      await instrumentRepo(page);
      await open(page, '#/game/g1');
      await expect(opponentName(page)).toHaveText('Rivals');
      await expect(page.getByTestId('live-badge')).toBeVisible();
      await page.evaluate(() => {
        window.__gone = false;
        new MutationObserver(() => {
          const homeEl = document.querySelector('[data-testid="games-list"]');
          const unavailable = document.querySelector('[data-testid="game-unavailable"]');
          if ((homeEl && !homeEl.hidden) || (unavailable && !unavailable.hidden)
            || !document.querySelector('[data-testid="score-us"]')) window.__gone = true;
        }).observe(document.body, { subtree: true, attributes: true, childList: true });
      });
      const before = await page.evaluate(() => history.length);
      if (order === 'the team first') {
        await update('team/main', { currentGameId: 'g2' });
        await delivered(page, 'team/main', 'pointer', 'g2');
        await expect(banner(page)).toContainText('Waves');
        await update('games/g1', { status: 'final' });
      } else {
        await update('games/g1', { status: 'final' });
        await delivered(page, 'games/g1', 'status', 'final');
        await expect(page.getByTestId('final-badge')).toBeVisible();
        await update('team/main', { currentGameId: 'g2' });
        await delivered(page, 'team/main', 'pointer', 'g2');
        await expect(banner(page)).toContainText('Waves');
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

  for (const order of ['the game first', 'the team first']) {
    test(`the current game deleted while on home with the pointer moving to another season (${order})`, async ({ page }) => {
      await Promise.all([
        team('g1'),
        game('g1', { opponent: 'Rivals' }),
        game('g2', { opponent: 'Waves', season: NEW, date: '2020-11-08', events: liveEvents }),
        stats(OLD, [['g1', 'Rivals', '2019-11-01']]),
        stats(NEW, [['g2', 'Waves', '2020-11-08']]),
      ]);
      await instrumentRepo(page);
      await recordHome(page);
      await open(page);
      await expect(home(page)).toHaveAttribute('data-season', OLD);
      await expect(home(page)).toHaveAttribute('data-results', 'ready');
      await expect(rows(page).first().locator('.result-opp')).toHaveText('Rivals');
      await restartHomeRecord(page);
      if (order === 'the game first') {
        await remove('games/g1');
        await delivered(page, 'games/g1', 'exists', false);
        await update('team/main', { currentGameId: 'g2' });
      } else {
        await update('team/main', { currentGameId: 'g2' });
        await delivered(page, 'team/main', 'pointer', 'g2');
        await remove('games/g1');
      }
      await expect(home(page)).toHaveAttribute('data-season', NEW, { timeout: 5000 });
      await expect(home(page)).toHaveAttribute('data-results', 'ready');
      await expect(rows(page).first().locator('.result-opp')).toHaveText('Waves');
      expect(await get('games/g1')).toBeUndefined();
      const record = await recordedHome(page);
      expectNoForbiddenState(record);
      expect(record.pairs.at(-1)).toEqual({ season: NEW, results: 'ready' });
    });
  }

  test('a pointer switch within one season changes nothing on home', async ({ page }) => {
    await Promise.all([
      team('g1'),
      game('g1', { opponent: 'Rivals' }),
      game('g2', { opponent: 'Waves', date: '2019-11-08', events: liveEvents }),
      stats(OLD, [['g1', 'Rivals', '2019-11-01'], ['g2', 'Waves', '2019-11-08']]),
    ]);
    await instrumentRepo(page);
    await recordHome(page);
    await open(page);
    await expect(home(page)).toHaveAttribute('data-results', 'ready');
    await update('team/main', { currentGameId: 'g2' });
    await delivered(page, 'team/main', 'pointer', 'g2');
    await delivered(page, 'games/g2', 'status', 'final');
    expect((await get('team/main')).currentGameId).toBe('g2');
    await expect(rows(page)).toHaveCount(2);
    expectUnchanged(await recordedHome(page));
  });

  // A watch that started after another had waited for the server in vain must not inherit that wait: its
  // own cache miss is not yet a missing document, and neither may the team watch's silence settle it. Here
  // the team document is never confirmed by the server and the old season's stats are not for 9 s, so both
  // go stale; the new season's first answer is a cache miss, and the server answers 2.5 s later.
  test('a season watch that starts after another went stale does not settle its cache miss as empty', async ({ page }) => {
    await Promise.all([
      team('g1'),
      game('g1', { opponent: 'Rivals' }),
      game('g2', { opponent: 'Waves', season: NEW, date: '2020-11-08', events: liveEvents }),
      stats(OLD, [['g1', 'Rivals', '2019-11-01']]),
      stats(NEW, [['g2', 'Waves', '2020-11-08']]),
    ]);
    await instrumentRepo(page, {
      'team/main': { cached: true },
      [`stats/${OLD}`]: { holdMs: 9000 },
      [`stats/${NEW}`]: { miss: true, holdMs: 2500 },
    });
    await recordHome(page);
    await open(page);
    await expect(home(page)).toHaveAttribute('data-results', 'ready');
    await expect(rows(page).first().locator('.result-opp')).toHaveText('Rivals');
    await expect(page.getByTestId('connection-note')).toBeVisible({ timeout: 10000 });
    await restartHomeRecord(page);
    await update('team/main', { currentGameId: 'g2' });
    await delivered(page, 'team/main', 'pointer', 'g2');
    await expect(home(page)).toHaveAttribute('data-season', NEW, { timeout: 5000 });
    await expect(home(page)).toHaveAttribute('data-results', 'ready', { timeout: 8000 });
    await expect(rows(page).first().locator('.result-opp')).toHaveText('Waves');
    const record = await recordedHome(page);
    expectNoForbiddenState(record);
    // The new season's wait was shown as loading, never as no games.
    expect(record.pairs.filter(entry => entry.season === NEW).map(entry => entry.results)).toContain('loading');
  });
});

test('a shared link opens the game before the team document exists, and seeding the team changes nothing', async ({ page }) => {
  await game('g1', { opponent: 'Rivals', status: 'live', period: 1, events: liveEvents });
  await open(page, '#/game/g1');
  await expect(opponentName(page)).toHaveText('Rivals');
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await page.evaluate(() => {
    window.__gone = false;
    new MutationObserver(() => {
      const unavailable = document.querySelector('[data-testid="game-unavailable"]');
      const board = document.querySelector('.board');
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
  const { pairs, states } = await recordedHome(page);
  for (const list of [pairs, states]) {
    expect(firstReady(list), 'home showed results').toBeGreaterThanOrEqual(0);
    const after = list.slice(firstReady(list));
    expect(after, JSON.stringify(after)).toEqual([after[0]]);
  }
  dropNoise();
});

test('a past game while another is live shows the banner, which opens the live game', async ({ page }) => {
  await seedSeason();
  await open(page, '#/game/g1');
  await expect(opponentName(page)).toHaveText('Rivals');
  await expect(allGames(page)).toBeVisible();
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toContainText('LIVE · Q1 ANOG 1–0 Waves');
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
  await expect(banner(page)).toContainText('LIVE · Q1 ANOG 1–0 Waves');
  await expect(home(page)).toBeVisible();
});

// The bound for a celebration to appear after the goal is on screen.
const CELEBRATION_MS = 2500;
// The celebration module loads off the critical path; a goal that arrives before it is part of its baseline.
const celebrationLoaded = page => page.waitForFunction(() => document.querySelector('[data-testid="celebration"]') !== null);

test('a goal written while on home does not celebrate', async ({ page }) => {
  await seedSeason();
  await recordCelebration(page);
  await open(page);
  await expect(banner(page)).toContainText('ANOG 1–0 Waves');
  // Its baseline is taken on the first render after the module is in.
  await celebrationLoaded(page);
  await update('games/g2', { events: [...liveEvents, ev('goal', 1, 'p2')] });
  // A celebration would be shown in the same render that shows the new score.
  await expect(banner(page)).toContainText('ANOG 2–0 Waves', { timeout: 5000 });
  expect(await celebrated(page)).toBe(false);
});

test('the same goal on the game screen celebrates within the bound', async ({ page }) => {
  await seedSeason();
  await open(page, '#/game/g2');
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await celebrationLoaded(page);
  await update('games/g2', { events: [...liveEvents, ev('goal', 1, 'p2')] });
  // The bound starts once the goal is on screen, not at the write.
  await expect(page.getByTestId('score-us')).toHaveText('2');
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
  await celebrationLoaded(page);
  // Nothing to wait on: this checks that something did not happen, for as long as a celebration would play.
  await page.waitForTimeout(CELEBRATION_MS);
  expect(await celebrated(page)).toBe(false);
  await update('games/g2', { events: [...liveEvents, ev('goal', 1, 'p2'), ev('goal', 2, 'p5')] });
  await expect(page.getByTestId('score-us')).toHaveText('3');
  await expect(page.getByTestId('celebration')).toBeVisible({ timeout: CELEBRATION_MS });
});

test('going back to the season during a celebration ends it', async ({ page }) => {
  await seedSeason();
  await open(page, '#/game/g2');
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await celebrationLoaded(page);
  await update('games/g2', { events: [...liveEvents, ev('goal', 1, 'p2')] });
  await expect(page.getByTestId('score-us')).toHaveText('2');
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

// Season header and results rows (the home look). The results are the calendar season's, so no team document.
const seedResults = results => seed(`stats/${CALENDAR}`, {
  players: { p5: { name: 'Alexiou', games: results.length, goals: 1, excl: 0 } },
  results: results.map(([opponent, us, them, extra = {}], i) => ({
    gameId: `r${i}`, date: `2026-11-${String(20 - i).padStart(2, '0')}`, opponent, us, them, ...extra,
  })),
});

test('the season record and the chips read the results in order', async ({ page }) => {
  await seedResults([['A', 12, 10], ['B', 9, 3], ['C', 7, 6], ['D', 5, 8], ['E', 6, 6]]);
  await open(page);
  await expect(rows(page)).toHaveCount(5);
  await expect(page.getByTestId('season-record')).toHaveText('3 W · 1 L · 1 D');
  await expect(page.getByTestId('result-chip')).toHaveText(['W', 'W', 'W', 'L', 'D']);
  await expect(home(page).locator('h1')).toHaveText('This season');
});

test('the record has no draws part when there are none, and a result without a score has no chip', async ({ page }) => {
  await seedResults([['A', 12, 10], ['B', 9, 3], ['C', 7, 6], ['D', 5, 8], ['Broken', null, 4]]);
  await open(page);
  await expect(rows(page)).toHaveCount(5);
  await expect(page.getByTestId('season-record')).toHaveText('3 W · 1 L');
  await expect(page.getByTestId('result-chip')).toHaveText(['W', 'W', 'W', 'L']);
  await expect(rows(page).last().getByTestId('result-chip')).toHaveCount(0);
  await expect(rows(page).last()).toContainText('–');
  await expect(rows(page).last()).not.toContainText(/undefined|NaN/);
  await expect(rows(page).last().locator('.result-opp')).toHaveText('Broken');
});

test('a level final decided on a shootout shows the shootout and the chip it decides', async ({ page }) => {
  await seedResults([
    ['Won on pens', 10, 10, { soUs: 4, soThem: 3 }],
    ['Lost on pens', 8, 8, { soUs: 2, soThem: 5 }],
    ['No shootout', 7, 7, { soUs: 0, soThem: 0 }],
  ]);
  await open(page);
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByTestId('result-chip')).toHaveText(['W', 'L', 'D']);
  await expect(rows(page).nth(0)).toContainText('pen. 4–3');
  await expect(rows(page).nth(1)).toContainText('pen. 2–5');
  await expect(rows(page).nth(2)).not.toContainText('pen.');
  await expect(page.getByTestId('season-record')).toHaveText('1 W · 1 L · 1 D');
});

test('each result link is named by its outcome, score, shootout, opponent and date', async ({ page }) => {
  await seedResults([
    ['Won on pens', 10, 10, { soUs: 4, soThem: 3 }],
    ['Lost', 5, 8],
    ['Level', 7, 7],
    ['Broken', null, 4],
  ]);
  await open(page);
  await expect(rows(page)).toHaveCount(4);
  const link = i => rows(page).nth(i).getByTestId('result-link');
  await expect(link(0)).toHaveAccessibleName('Win 10 – 10, pen. 4–3 against Won on pens, 20/11/2026');
  await expect(link(1)).toHaveAccessibleName('Loss 5 – 8 against Lost, 19/11/2026');
  await expect(link(2)).toHaveAccessibleName('Draw 7 – 7 against Level, 18/11/2026');
  // No score, no outcome to name: the link still says which game it opens.
  await expect(link(3)).toHaveAccessibleName('Open the game against Broken on 17/11/2026');
});

test('a result with no game id is a row without a link or a chevron; the others keep both', async ({ page }) => {
  await seed(`stats/${CALENDAR}`, {
    players: { p5: { name: 'Alexiou', games: 2, goals: 1, excl: 0 } },
    results: [
      { gameId: 'r0', date: '2026-11-20', opponent: 'Rivals', us: 2, them: 1 },
      { date: '2026-11-19', opponent: 'Legacy', us: 3, them: 3 },
    ],
  });
  await open(page);
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(0).getByTestId('result-link')).toHaveCount(1);
  await expect(rows(page).nth(0).locator('svg')).toHaveCount(1);
  await expect(rows(page).nth(1).locator('.result-opp')).toHaveText('Legacy');
  await expect(rows(page).nth(1).getByTestId('result-link')).toHaveCount(0);
  await expect(rows(page).nth(1).locator('svg')).toHaveCount(0);
});

test('a season with no results shows the empty message and no record', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('results-empty')).toBeVisible();
  await expect(page.getByTestId('season-record')).toHaveAttribute('hidden', '');
  await expect(page.getByTestId('season-record')).toBeHidden();
});

test('the crest is on home with an empty alt', async ({ page }) => {
  await seedResults([['A', 1, 0]]);
  await open(page);
  await expect(page.getByTestId('crest')).toBeVisible();
  await expect(page.getByTestId('crest')).toHaveAttribute('alt', '');
});
