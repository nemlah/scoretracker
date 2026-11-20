import { execFileSync } from 'node:child_process';
import { test, expect } from './fixtures.js';
import { seasonFor, todayIso } from '../../js/model.js';
import { closeAll, get, openLiveGame, resetAll, seed, update } from './helpers.js';
import { CODE, HOME_URL, TRACKER_URL, collectProblems, dropNetworkNoise, otherDeviceTakesControl, unlockTracker } from './tracker-helpers.js';

const ORIGIN = 'http://127.0.0.1:4173';
const roster = [
  { id: 'p2', name: 'Papadakis', cap: 2, archived: false },
  { id: 'p5', name: 'Alexiou', cap: 5, archived: false },
  { id: 'p7', name: 'Georgiou', cap: 7, archived: false },
];

let problems;
test.beforeEach(async ({ page }) => {
  problems = [];
  collectProblems(page, problems);
  await resetAll();
  await seed('secrets/editCode', { code: CODE });
  await seed('team/main', { roster });
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});
test.afterAll(closeAll);

const row = (page, id) => page.locator(`[data-testid="sel-row"][data-player-id="${id}"]`);
const tile = (page, cap) => page.locator(`[data-testid="tile"][data-cap="${cap}"]`);
// The new game reaches the server a moment after the screen shows it.
async function currentGameId() {
  await expect.poll(async () => (await get('team/main'))?.currentGameId).toBeTruthy();
  return (await get('team/main')).currentGameId;
}
const journalOf = page => page.evaluate(() => localStorage.getItem('wp-journal'));

async function openNewGame(page) {
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await page.getByTestId('home-new').click();
  await expect(page.getByTestId('start-game')).toBeVisible();
}

async function startGame(page, opponent = 'Opponent FC') {
  await openNewGame(page);
  await page.getByTestId('opponent-input').fill(opponent);
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('score-us')).toHaveText('0');
}

test('new game: all ticked, cap swap, duplicate blocked, start', async ({ page }) => {
  await openNewGame(page);
  await expect(page.getByTestId('date-input')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByTestId('sel-row')).toHaveCount(3);
  await expect(page.getByTestId('sel-check')).toHaveCount(3);
  for (const check of await page.getByTestId('sel-check').all()) await expect(check).toBeChecked();

  // Giving Alexiou cap 2 swaps with Papadakis, who held it.
  await row(page, 'p5').getByTestId('sel-cap').fill('2');
  await expect(row(page, 'p2').getByTestId('sel-cap')).toHaveValue('5');
  await expect(row(page, 'p5').getByTestId('sel-cap')).toHaveValue('2');

  // Untick Georgiou, hand his cap 7 to Papadakis, tick him again: the clash empties his cap.
  await row(page, 'p7').getByTestId('sel-check').uncheck();
  await row(page, 'p2').getByTestId('sel-cap').fill('7');
  await row(page, 'p7').getByTestId('sel-check').check();
  await expect(row(page, 'p7').getByTestId('sel-cap')).toHaveValue('');
  await expect(row(page, 'p7').getByTestId('sel-error')).toBeVisible();
  await expect(row(page, 'p2').getByTestId('sel-error')).toBeHidden();
  await expect(page.getByTestId('start-game')).toBeDisabled();

  await row(page, 'p7').getByTestId('sel-cap').fill('5');
  await expect(row(page, 'p7').getByTestId('sel-error')).toBeHidden();
  await expect(page.getByTestId('start-game')).toBeEnabled();
  await page.getByTestId('opponent-input').fill('Opponent FC');
  await page.getByTestId('start-game').click();

  await expect(page.getByTestId('score-us')).toHaveText('0');
  await expect(page.getByTestId('tile')).toHaveCount(3);
  await expect(page.getByTestId('tile').nth(0)).toHaveAttribute('data-cap', '2');
  await expect(page.getByTestId('tile').nth(1)).toHaveAttribute('data-cap', '5');
  await expect(page.getByTestId('tile').nth(2)).toHaveAttribute('data-cap', '7');
  await expect(page.getByTestId('period-next')).toHaveText('Q1');
});

test('typing a two digit cap does not scramble other players', async ({ page }) => {
  await openNewGame(page);
  await row(page, 'p5').getByTestId('sel-cap').fill('');
  await row(page, 'p5').getByTestId('sel-cap').pressSequentially('12');
  await expect(row(page, 'p5').getByTestId('sel-cap')).toHaveValue('12');
  await expect(row(page, 'p2').getByTestId('sel-cap')).toHaveValue('2');
  await expect(row(page, 'p7').getByTestId('sel-cap')).toHaveValue('7');
  await expect(page.getByTestId('start-game')).toBeEnabled();
});

test('start works with a blank opponent and no players ticked is refused', async ({ page }) => {
  await openNewGame(page);
  for (const check of await page.getByTestId('sel-check').all()) await check.uncheck();
  await expect(page.getByTestId('start-game')).toBeDisabled();
  await expect(page.getByTestId('lineup-error')).toBeVisible();
  await row(page, 'p5').getByTestId('sel-check').check();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('score-us')).toHaveText('0');
  await expect(page.getByTestId('tile')).toHaveCount(1);
});

test('goal, exclusion, opponent goal, undo label', async ({ page }) => {
  await page.addInitScript(() => {
    window.__vibrations = [];
    navigator.vibrate = ms => { window.__vibrations.push(ms); return true; };
  });
  await startGame(page);
  await expect(page.getByTestId('undo')).toBeDisabled();
  await expect(page.getByTestId('sync-status')).toHaveText('online');

  await tile(page, 5).getByTestId('tile-goal').click();
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await expect(tile(page, 5).getByTestId('tile-goals')).toHaveText('1');
  await expect(tile(page, 5).getByTestId('tile-goals')).toHaveAttribute('aria-label', '1 goal');
  await expect(page.getByTestId('undo')).toHaveText('Undo: Goal · #5 Alexiou (Q1)');
  expect(await page.evaluate(() => window.__vibrations)).toEqual([30]);

  await page.getByTestId('opp-goal').click();
  await expect(page.getByTestId('score-them')).toHaveText('1');
  await expect(page.getByTestId('undo')).toHaveText('Undo: Opponent goal (Q1)');

  await tile(page, 2).getByTestId('tile-excl').click();
  await expect(tile(page, 2).getByTestId('tile-excl-count')).toHaveText('1');
  await expect(page.getByTestId('undo')).toHaveText('Undo: Exclusion · #2 Papadakis (Q1)');
  await expect(page.getByTestId('score-us')).toHaveText('1');

  await page.getByTestId('undo').click();
  await expect(tile(page, 2).getByTestId('tile-excl-count')).toHaveText('0');
  await expect(page.getByTestId('undo')).toHaveText('Undo: Opponent goal (Q1)');
  // Right after an Undo the button is visibly disabled for a moment, then usable again.
  await expect(page.getByTestId('undo')).toBeDisabled();
  await expect(page.getByTestId('undo')).toBeEnabled();
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('score-them')).toHaveText('0');
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await expect(page.getByTestId('undo')).toHaveText('Undo: Goal · #5 Alexiou (Q1)');
  // Every tap was confirmed by the server, so nothing is left in the local journal.
  await expect.poll(() => journalOf(page)).toBe('[]');
  await expect(page.getByTestId('failed-banner')).toBeHidden();
});

test('a double tap on Undo removes one event; the next tap after it re-enables works', async ({ page }) => {
  await startGame(page);
  await tile(page, 5).getByTestId('tile-goal').click();
  await tile(page, 2).getByTestId('tile-goal').click();
  await expect(page.getByTestId('score-us')).toHaveText('2');
  await page.getByTestId('undo').dblclick();
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await expect(page.getByTestId('undo')).toBeDisabled();
  await page.waitForTimeout(300);
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await expect(page.getByTestId('undo')).toBeEnabled();
  await expect(page.getByTestId('undo')).toHaveText('Undo: Goal · #5 Alexiou (Q1)');
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('score-us')).toHaveText('0');
  await expect(page.getByTestId('undo')).toBeDisabled();
});

test('third exclusion marks OUT and disables tile buttons', async ({ page }) => {
  await startGame(page);
  // Alternate players so no tap repeats the previous one inside the duplicate window.
  for (const cap of [5, 2, 5, 2, 5]) await tile(page, cap).getByTestId('tile-excl').click();
  await expect(tile(page, 5).getByTestId('tile-excl-count')).toHaveText('3');
  await expect(tile(page, 5).getByTestId('tile-out')).toBeVisible();
  await expect(tile(page, 5).getByTestId('tile-goal')).toBeDisabled();
  await expect(tile(page, 5).getByTestId('tile-excl')).toBeDisabled();
  await expect(tile(page, 2).getByTestId('tile-out')).toBeHidden();
  await expect(tile(page, 2).getByTestId('tile-goal')).toBeEnabled();

  await page.getByTestId('undo').click();
  await expect(tile(page, 5).getByTestId('tile-out')).toBeHidden();
  await expect(tile(page, 5).getByTestId('tile-goal')).toBeEnabled();
});

test('period button advances to Shootout and stops; shootout goal shown separately', async ({ page }) => {
  await startGame(page);
  await expect(page.getByTestId('shootout')).toBeHidden();
  await tile(page, 5).getByTestId('tile-goal').click();
  await expect(page.getByTestId('score-us')).toHaveText('1');
  for (const label of ['Q2', 'Q3', 'Q4', 'Shootout']) {
    await page.getByTestId('period-next').click();
    await expect(page.getByTestId('period-next')).toHaveText(label);
  }
  await expect(page.getByTestId('period-next')).toBeDisabled();
  await tile(page, 2).getByTestId('tile-goal').click();
  await expect(page.getByTestId('shootout')).toHaveText('(1 – 0 pen.)');
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await expect(page.getByTestId('score-them')).toHaveText('0');
  await expect(tile(page, 2).getByTestId('tile-goals')).toHaveText('0');
  await expect(tile(page, 2).getByTestId('tile-so-goals')).toHaveText('+1 pen.');
  await expect(page.getByTestId('undo')).toHaveText('Undo: Goal · #2 Papadakis (Shootout)');
});

test('double tap records one goal', async ({ page }) => {
  await startGame(page);
  await tile(page, 5).getByTestId('tile-goal').dblclick();
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await page.waitForTimeout(400);
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await expect(tile(page, 5).getByTestId('tile-goals')).toHaveText('1');
});

test('the board score and tile counts stay in place and show fouls in event order', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const player = { playerId: 'p12', name: 'Παναγιώτης Παπαδόπουλος', cap: 12 };
  const event = (id, type, ts) => ({ id, type, ts, period: 1, playerId: player.playerId });
  const events = [
    event('goal-1', 'goal', 1000), event('goal-2', 'goal', 2000), event('goal-3', 'goal', 3000),
    event('excl', 'excl', 5000), event('pen', 'pen', 4000),
  ];
  await seed('games/board', {
    opponent: 'Opponent FC', date: '2026-11-20', season: '2026-27', status: 'live', period: 1, lineup: [player], events,
  });
  await update('team/main', { currentGameId: 'board' });
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await page.getByTestId('home-resume').click();
  const score = page.getByTestId('score-us');
  await expect(score).toHaveText('3');
  const bar = score.locator('..').locator('.score-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('aria-hidden', 'true');
  expect((await bar.boundingBox()).y).toBeGreaterThan((await score.boundingBox()).y);
  const separator = page.locator('.live-score .score-dash');
  await expect(separator).toHaveText(':');
  await expect(separator).toHaveAttribute('aria-hidden', 'true');
  const clubHeader = await page.locator('header.bar').boundingBox();
  const scoreHeader = await page.locator('.live-top--board').boundingBox();
  expect(scoreHeader.y).toBeCloseTo(clubHeader.y + clubHeader.height, 0);

  const goals = tile(page, 12).getByTestId('tile-goals');
  await expect(goals).toHaveText('3');
  await expect(goals).toHaveAttribute('aria-label', '3 goals');
  await expect(tile(page, 12).locator('.tile-goals-label')).toBeHidden();
  const fouls = tile(page, 12).getByTestId('tile-excl-count');
  await expect(fouls).toHaveAttribute('role', 'img');
  await expect(fouls).toHaveAttribute('aria-label', 'Exclusions: 1, penalty fouls: 1');
  const pips = fouls.locator('.pip');
  await expect(pips).toHaveCount(3);
  await expect(pips.nth(0)).toHaveClass(/pip--pen/);
  await expect(pips.nth(1)).toHaveClass(/pip--excl/);
  await expect(pips.nth(2)).toHaveClass('pip');
  const name = tile(page, 12).locator('.tile-name');
  await expect(name).toHaveText(player.name);
  await expect(name).toHaveCSS('text-overflow', 'ellipsis');
  await page.getByTestId('events-open').click({ trial: true });

  const retained = [score, goals, pips.nth(0), tile(page, 12).getByTestId('tile-goal')];
  const original = await Promise.all(retained.map(locator => locator.elementHandle()));
  await update('games/board', { events: [...events, event('goal-4', 'goal', 6000)] });
  await expect(score).toHaveText('4');
  await expect(goals).toHaveText('4');
  for (const [index, locator] of retained.entries()) {
    expect(await locator.evaluate((node, previous) => node === previous, original[index])).toBe(true);
  }
});

test.describe('mixed cache with R2 live tracker files', () => {
  test.use({ serviceWorkers: 'block' });

  test('the score and controls work with either R2 live.js or R2 tracker.css', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    const pairings = [
      ['js/tracker/views/live.js', 'text/javascript', 'Q2', 2],
      ['css/tracker.css', 'text/css', 'Q3', 3],
    ];
    let gameId;
    for (const [path, contentType, quarter, period] of pairings) {
      const body = execFileSync('git', ['show', `720f124:${path}`], { encoding: 'utf8' });
      const url = `**/${path}*`;
      let served = 0;
      await page.route(url, route => {
        served++;
        return route.fulfill({ contentType, body });
      });
      if (gameId === undefined) {
        await startGame(page);
        gameId = await currentGameId();
      } else {
        await page.reload();
        dropNetworkNoise(problems);
      }
      const score = page.getByTestId('score-us');
      await expect(score).toHaveText('0');
      await expect(score).toBeVisible();
      await score.click({ trial: true });
      expect(served, `R2 ${path} was served`).toBeGreaterThan(0);
      if (period === 2) {
        await expect(page.locator('.live-top--board')).toHaveCount(0);
        await expect(page.locator('.dock')).toHaveCSS('position', 'fixed');
      }

      const next = page.getByTestId('period-next');
      await expect(next).toBeVisible();
      await next.click();
      await expect(next).toHaveText(quarter);
      await expect.poll(async () => (await get(`games/${gameId}`)).period).toBe(period);
      await tile(page, 5).getByTestId('tile-goal').click();
      await expect(score).toHaveText('1');
      await expect.poll(async () => (await get(`games/${gameId}`)).events.map(e => e.type)).toEqual(['goal']);

      const undo = page.getByTestId('undo');
      await expect(undo).toBeVisible();
      await undo.click();
      await expect(score).toHaveText('0');
      await expect.poll(async () => (await get(`games/${gameId}`)).events).toEqual([]);

      const events = page.getByTestId('events-open');
      await expect(events).toBeVisible();
      await events.click();
      await expect(page.getByTestId('events-sheet')).toBeVisible();
      await page.getByTestId('events-close').click();
      await page.unroute(url);
    }
  });
});

test('rapid taps on different players are all kept and none is reported as unsaved', async ({ page }) => {
  await startGame(page);
  for (const cap of [2, 5, 7]) await tile(page, cap).getByTestId('tile-goal').click();
  await page.getByTestId('opp-goal').click();
  await expect(page.getByTestId('score-us')).toHaveText('3');
  await expect(page.getByTestId('score-them')).toHaveText('1');
  await expect.poll(() => journalOf(page)).toBe('[]');
  await page.waitForTimeout(500);
  await expect(page.getByTestId('failed-banner')).toBeHidden();
  await expect(page.getByTestId('score-us')).toHaveText('3');
});

test('viewer updates live from tracker taps', async ({ page, browser }) => {
  await startGame(page);
  const viewerContext = await browser.newContext({ baseURL: ORIGIN });
  try {
    const viewer = await viewerContext.newPage();
    collectProblems(viewer, problems);
    await openLiveGame(viewer);
    await expect(viewer.getByTestId('score-us')).toHaveText('0');
    await tile(page, 5).getByTestId('tile-goal').click();
    await tile(page, 2).getByTestId('tile-goal').click();
    await expect(viewer.getByTestId('score-us')).toHaveText('2', { timeout: 5000 });
    // The viewer reads what the server has: check the game there too.
    const gameId = await currentGameId();
    await expect.poll(async () => (await get(`games/${gameId}`)).events.map(e => [e.type, e.playerId]))
      .toEqual([['goal', 'p5'], ['goal', 'p2']]);
  } finally {
    await viewerContext.close();
  }
});

test('next new game defaults to previous lineup and last caps', async ({ page }) => {
  await openNewGame(page);
  await row(page, 'p5').getByTestId('sel-cap').fill('2');
  await row(page, 'p7').getByTestId('sel-check').uncheck();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('score-us')).toHaveText('0');

  await update(`games/${await currentGameId()}`, { status: 'final' });
  await page.getByTestId('nav-home').click();
  await expect(page.getByTestId('home-resume')).toBeHidden();
  await page.getByTestId('home-new').click();

  await expect(page.getByTestId('sel-row')).toHaveCount(3);
  await expect(row(page, 'p2').getByTestId('sel-check')).toBeChecked();
  await expect(row(page, 'p5').getByTestId('sel-check')).toBeChecked();
  await expect(row(page, 'p7').getByTestId('sel-check')).not.toBeChecked();
  await expect(row(page, 'p5').getByTestId('sel-cap')).toHaveValue('2');
  await expect(row(page, 'p2').getByTestId('sel-cap')).toHaveValue('5');
  await expect(row(page, 'p7').getByTestId('sel-cap')).toHaveValue('7');
});

test('a live game blocks the new game form and shows Resume on home', async ({ page }) => {
  await startGame(page);
  await tile(page, 5).getByTestId('tile-goal').click();
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await page.getByTestId('nav-home').click();
  await expect(page.getByTestId('home-resume')).toBeVisible();
  await page.getByTestId('home-new').click();
  await expect(page.getByTestId('resume-live')).toBeVisible();
  await expect(page.getByTestId('opponent-input')).toBeHidden();
  await expect(page.getByTestId('start-game')).toBeHidden();
  await page.getByTestId('resume-live').click();
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await expect(page.getByTestId('tile')).toHaveCount(3);
});

test('the live screen resumes after a reload with the score intact', async ({ page }) => {
  await startGame(page);
  await tile(page, 5).getByTestId('tile-goal').click();
  await page.getByTestId('opp-goal').click();
  await expect(page.getByTestId('score-them')).toHaveText('1');
  await page.reload();
  dropNetworkNoise(problems);
  // The route survives the reload, so the live screen comes straight back.
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await expect(page.getByTestId('score-them')).toHaveText('1');
  await expect(tile(page, 5).getByTestId('tile-goals')).toHaveText('1');
  // Opening the tracker from a bare address (bookmark, home-screen icon) resumes the live game.
  await page.goto(TRACKER_URL);
  dropNetworkNoise(problems);
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await expect(page).toHaveURL(/#\/live$/);
  // Home stays reachable and offers Resume; the redirect happens on the first load only.
  await page.getByTestId('nav-home').click();
  await expect(page.getByTestId('home-resume')).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);
  await page.getByTestId('home-resume').click();
  await expect(page.getByTestId('score-us')).toHaveText('1');
});

test('read-only device cannot tap', async ({ page }) => {
  await startGame(page);
  await currentGameId();
  await otherDeviceTakesControl();
  await expect(page.getByTestId('takeover-banner')).toBeVisible();
  await expect(tile(page, 5).getByTestId('tile-goal')).toBeDisabled();
  await expect(tile(page, 5).getByTestId('tile-excl')).toBeDisabled();
  await expect(page.getByTestId('opp-goal')).toBeDisabled();
  await expect(page.getByTestId('period-next')).toBeDisabled();
  await expect(page.getByTestId('undo')).toBeDisabled();
  await page.getByTestId('take-over').click();
  await expect(tile(page, 5).getByTestId('tile-goal')).toBeEnabled();
  await expect(page.getByTestId('opp-goal')).toBeEnabled();
});

test('taps made offline show on screen, are kept, and sync when the signal returns', async ({ page, context }) => {
  await startGame(page);
  await context.setOffline(true);
  await expect(page.getByTestId('sync-status')).toHaveText('offline — taps saved, will sync');
  await tile(page, 5).getByTestId('tile-goal').click();
  await page.getByTestId('opp-goal').click();
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await expect(page.getByTestId('score-them')).toHaveText('1');
  expect(JSON.parse(await journalOf(page))).toHaveLength(2);
  await context.setOffline(false);
  await expect(page.getByTestId('sync-status')).toHaveText('online');
  await expect.poll(() => journalOf(page)).toBe('[]');
  await expect(page.getByTestId('failed-banner')).toBeHidden();
  const game = await get(`games/${await currentGameId()}`);
  expect(game.events.map(event => event.type).sort()).toEqual(['goal', 'oppGoal']);
  dropNetworkNoise(problems);
});

test('a goal added and undone offline stays removed after reconnecting', async ({ page, context }) => {
  await startGame(page);
  await currentGameId();
  await context.setOffline(true);
  await expect(page.getByTestId('sync-status')).toHaveText('offline — taps saved, will sync');
  await tile(page, 5).getByTestId('tile-goal').click();
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('score-us')).toHaveText('0');
  await context.setOffline(false);
  await expect(page.getByTestId('sync-status')).toHaveText('online');
  await expect.poll(() => journalOf(page)).toBe('[]');
  await page.waitForTimeout(500);
  await expect(page.getByTestId('failed-banner')).toBeHidden();
  await expect(page.getByTestId('score-us')).toHaveText('0');
  const game = await get(`games/${await currentGameId()}`);
  expect(game.events).toEqual([]);
  dropNetworkNoise(problems);
});

// Plants journal entries as an earlier session would have left them. They are written before
// the page's scripts run: the live page may still rewrite its own (empty) journal until it unloads.
async function seedJournal(page, entries) {
  const gameId = await currentGameId();
  const value = JSON.stringify(entries.map((entry, i) => ({
    id: `entry-${i}`, gameId, op: 'add', ...entry,
  })));
  await page.addInitScript(planted => {
    if (sessionStorage.getItem('planted') === null) {
      sessionStorage.setItem('planted', '1');
      localStorage.setItem('wp-journal', planted);
    }
  }, value);
  await page.reload();
  dropNetworkNoise(problems);
  await expect(page.getByTestId('tile')).toHaveCount(3);
}

const lostGoal = status => ({
  status,
  event: { id: 'lost-goal', type: 'goal', period: 1, ts: 1000, playerId: 'p5' },
});

test('unconfirmed taps from an earlier session show a banner; retry saves them', async ({ page }) => {
  await startGame(page);
  await seedJournal(page, [lostGoal('pending')]);
  await expect(page.getByTestId('failed-banner')).toBeVisible();
  await expect(page.getByTestId('failed-banner')).toContainText('1 tap not saved');
  await expect(page.getByTestId('score-us')).toHaveText('0');
  await page.getByTestId('retry-failed').click();
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await expect(page.getByTestId('failed-banner')).toBeHidden();
  await expect.poll(() => journalOf(page)).toBe('[]');
});

test('failed taps can be discarded', async ({ page }) => {
  await startGame(page);
  await seedJournal(page, [lostGoal('failed')]);
  await expect(page.getByTestId('failed-banner')).toContainText('1 tap not saved');
  await expect(page.getByTestId('retry-failed')).toBeVisible();
  await page.getByTestId('discard-failed').click();
  await expect(page.getByTestId('failed-banner')).toBeHidden();
  await expect.poll(() => journalOf(page)).toBe('[]');
  await expect(page.getByTestId('score-us')).toHaveText('0');
});

test('retry is unavailable while another device is tracking', async ({ page }) => {
  await startGame(page);
  await seedJournal(page, [lostGoal('failed')]);
  await currentGameId();
  await otherDeviceTakesControl();
  await expect(page.getByTestId('takeover-banner')).toBeVisible();
  await expect(page.getByTestId('retry-failed')).toBeDisabled();
  await expect(page.getByTestId('failed-banner')).toContainText('1 tap not saved');
});

test('the screen is kept awake while tracking and released when leaving', async ({ page }) => {
  await page.addInitScript(() => {
    window.__wake = [];
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async type => {
          window.__wake.push(`request:${type}`);
          return { release: async () => { window.__wake.push('release'); }, addEventListener() {} };
        },
      },
    });
  });
  await startGame(page);
  await expect.poll(() => page.evaluate(() => window.__wake)).toContain('request:screen');
  await page.getByTestId('nav-home').click();
  await expect.poll(() => page.evaluate(() => window.__wake)).toContain('release');
});

test('new game: the season follows the date until edited, must be YYYY-YY, and is saved with the game', async ({ page }) => {
  await openNewGame(page);
  const season = page.getByTestId('season-input');
  await expect(season).toHaveValue(seasonFor(todayIso()));
  await page.getByTestId('date-input').fill('2027-01-10');
  await expect(season).toHaveValue('2026-27');
  await page.getByTestId('date-input').fill('2027-09-01');
  await expect(season).toHaveValue('2027-28');

  await season.fill('27-28');
  await expect(page.getByTestId('season-error')).toBeVisible();
  await expect(page.getByTestId('start-game')).toBeDisabled();
  await season.fill('2025-26');
  await expect(page.getByTestId('season-error')).toBeHidden();
  // Once edited by hand it no longer follows the date.
  await page.getByTestId('date-input').fill('2027-10-01');
  await expect(season).toHaveValue('2025-26');
  await page.getByTestId('opponent-input').fill('Season FC');
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('score-us')).toHaveText('0');
  const game = await get(`games/${await currentGameId()}`);
  expect(game).toMatchObject({ season: '2025-26', date: '2027-10-01', opponent: 'Season FC' });
});
