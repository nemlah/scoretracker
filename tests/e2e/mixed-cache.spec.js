import { execSync } from 'node:child_process';
import { test, expect } from './fixtures.js';
import { seasonFor, todayIso } from '../../js/model.js';
import {
  closeAll, consoleProblems, get, open, resetAll, seed, update,
} from './helpers.js';
import { isFirestoreChannelLoss } from './network-noise.js';
import {
  CODE, HOME_URL, SERVER_WAIT, dropNetworkNoise, formatConsoleProblem, unlockTracker,
} from './tracker-helpers.js';

// A phone mixing releases holds files of the release before this fix (67cd574) beside this branch's. Each test serves
// one such file, whole, and checks an outcome a person would see or the server would store, not only that the page loads.
const PREVIOUS = '67cd574';
const previous = path => execSync(`git show ${PREVIOUS}:${path}`, { encoding: 'utf8', maxBuffer: 1 << 20 });
test.use({ serviceWorkers: 'block' });

const roster = [
  { id: 'p5', name: 'Alexiou', cap: 5, archived: false },
  { id: 'p7', name: 'Georgiou', cap: 7, archived: false },
];
const lineup = [{ playerId: 'p5', name: 'Alexiou', cap: 5 }, { playerId: 'p7', name: 'Georgiou', cap: 7 }];
const SEASON = seasonFor(todayIso());
const goal = (id, ts) => ({ id, type: 'goal', period: 1, ts, playerId: 'p5' });
const oppGoal = (id, ts) => ({ id, type: 'oppGoal', period: 1, ts });
const game = (status, events) => ({
  opponent: 'Opponent FC', date: '2026-11-08', season: SEASON, status, period: status === 'final' ? 4 : 1, lineup, events,
});

const serve = (page, path, body) => page.route(`**/${path}`, route => route.fulfill({ contentType: 'text/javascript', body }));
const tile = (page, cap) => page.locator(`[data-testid="tile"][data-cap="${cap}"]`);
const setVisibility = (page, visibility) => page.evaluate(value => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
  document.dispatchEvent(new Event('visibilitychange'));
}, visibility);

let problems;
test.beforeEach(async ({ page }) => {
  problems = consoleProblems(page, { ignore: isFirestoreChannelLoss, format: formatConsoleProblem });
  await resetAll();
  await seed('secrets/editCode', { code: CODE });
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});
test.afterAll(closeAll);

test('the tracker unlocks, records a goal and ends the game when app.js is the previous release', async ({ page }) => {
  await serve(page, 'js/tracker/app.js', previous('js/tracker/app.js'));
  await seed('team/main', { roster, currentGameId: 'g1' });
  await seed('games/g1', game('live', []));
  await page.goto(HOME_URL);
  await expect(page.getByTestId('code-input')).toBeVisible();
  await unlockTracker(page);
  await page.evaluate(() => { location.hash = '#/live'; });
  await tile(page, 5).getByTestId('tile-goal').click();
  await expect.poll(async () => (await get('games/g1')).events.length).toBe(1);
  expect((await get('games/g1')).status).toBe('live');

  // Back from the background the previous app reads the server itself and keeps working.
  await setVisibility(page, 'hidden');
  await setVisibility(page, 'visible');
  await expect(page.getByTestId('takeover-banner')).toBeHidden();
  await tile(page, 7).getByTestId('tile-goal').click();
  await expect.poll(async () => (await get('games/g1')).events.length).toBe(2);

  await page.getByTestId('events-open').click();
  const end = page.getByTestId('end-game');
  await end.click();
  await expect(end).toHaveText('Tap again to confirm');
  // A confirming tap right after arming counts as a double tap and is ignored: retry until the button is no longer armed.
  await expect(async () => {
    if (await end.isVisible()) await end.click({ timeout: 1000 });
    expect(await end.isVisible() && (await end.getAttribute('class') ?? '').includes('is-armed'), 'the confirming tap was ignored').toBe(false);
  }).toPass({ timeout: SERVER_WAIT });
  await expect.poll(async () => (await get('games/g1')).status, { timeout: SERVER_WAIT }).toBe('final');
});

test.describe('the viewer', () => {
  const stats = results => seed(`stats/${SEASON}`, {
    players: { p5: { name: 'Alexiou', games: 1, goals: 3, excl: 0, pens: 0 } }, results,
  });

  test('shows a game and the home list when model.js is the previous release', async ({ page }) => {
    await serve(page, 'js/model.js', previous('js/model.js'));
    await seed('team/main', { roster });
    await seed('games/g1', game('final', [goal('e1', 1000), goal('e2', 1010), goal('e3', 1020), oppGoal('e4', 1030)]));
    await stats([{ gameId: 'g1', date: '2026-11-08', opponent: 'Opponent FC', us: 3, them: 1 }]);
    await open(page, '#/game/g1');
    await expect(page.getByTestId('score-us')).toHaveText('3');
    await expect(page.getByTestId('score-them')).toHaveText('1');
    await open(page);
    const row = page.getByTestId('result-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Opponent FC');
    await expect(row).toContainText('3');
    await expect(row).toContainText('1');
    // Opening home again aborts the streams that were open; that is not an app error.
    dropNetworkNoise(problems);
  });

  test('shows a live score and follows it when repo.js is the previous release', async ({ page }) => {
    await serve(page, 'js/repo.js', previous('js/repo.js'));
    const events = [goal('e1', 1000), goal('e2', 1010), oppGoal('e3', 1020)];
    await seed('team/main', { roster, currentGameId: 'g1' });
    await seed('games/g1', game('live', events));
    await open(page, '#/game/g1');
    await expect(page.getByTestId('score-us')).toHaveText('2');
    await expect(page.getByTestId('score-them')).toHaveText('1');
    await update('games/g1', { events: [...events, goal('e4', 1030)] });
    await expect(page.getByTestId('score-us')).toHaveText('3', { timeout: SERVER_WAIT });
  });
});
