import { test, expect } from './fixtures.js';
import { closeAll, instrumentRepo, resetAll, seed } from './helpers.js';
import { CODE, HOME_URL, SERVER_WAIT, collectProblems, unlockTracker } from './tracker-helpers.js';

// A current game the local cache lacks first reads as a cached null. That is not "no live game":
// New Game stays closed until the server has answered for that game.
test.use({ serviceWorkers: 'block' });

let problems;
test.beforeEach(async ({ page }) => {
  problems = [];
  collectProblems(page, problems);
  await resetAll();
  await seed('secrets/editCode', { code: CODE });
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});
test.afterAll(closeAll);

const roster = [{ id: 'p5', name: 'Alexiou', cap: 5, archived: false }];
const liveGame = {
  opponent: 'Live FC', date: '2026-11-16', season: '2026-27', status: 'live', situations: true, period: 1,
  lineup: [{ playerId: 'p5', name: 'Alexiou', cap: 5 }], events: [],
};

// Moves without a tap, which could claim control.
const go = (page, hash) => page.evaluate(value => { location.hash = value; }, hash);
// The page cannot be backgrounded in a test; replay what the browser reports.
const setVisibility = (page, visibility) => page.evaluate(value => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
  document.dispatchEvent(new Event('visibilitychange'));
}, visibility);

async function openTracker(page, rules) {
  await instrumentRepo(page, rules);
  await page.goto(HOME_URL);
  await unlockTracker(page);
}

test('a current game the cache lacks keeps New Game closed until the server answers', async ({ page }) => {
  await seed('team/main', { roster, currentGameId: 'g1' });
  await seed('games/g1', liveGame);
  await openTracker(page, { 'games/g1': { miss: true, hold: true } });
  // The cached miss has been delivered; the server's answer is held.
  await expect.poll(() => page.evaluate(() => window.__queued?.['games/g1'])).toBe(1);
  await go(page, '#/new');
  await expect(page.getByTestId('opponent-input')).toBeHidden();
  await expect(page.getByTestId('resume-live')).toBeHidden();

  await page.evaluate(() => window.__releaseHeld('games/g1'));
  await expect(page.getByTestId('resume-live')).toBeVisible({ timeout: SERVER_WAIT });
  await expect(page.getByTestId('opponent-input')).toBeHidden();
});

test('a pointer whose game the server never confirms keeps New Game closed (signal bars, no data)', async ({ page }) => {
  await seed('team/main', { roster, currentGameId: 'gone' });
  await openTracker(page, { 'games/gone': { cached: true } });
  await go(page, '#/new');
  // The server's absence of games/gone is delivered as a cached null; the end condition is that snapshot being handled.
  await page.waitForFunction(() => window.__snaps?.some(snap => snap.path === 'games/gone' && !snap.exists));
  // Nothing happened is the expected outcome, so there is no event to wait on: give a wrongly opened form time to show.
  await page.waitForTimeout(500);
  await expect(page.getByTestId('opponent-input')).toBeHidden();

  // Back from the background, the server's read says the game is absent.
  await setVisibility(page, 'hidden');
  await setVisibility(page, 'visible');
  await expect(page.getByTestId('opponent-input')).toBeVisible({ timeout: SERVER_WAIT });
});

// Baseline: passes on the previous release too. It guards the rule "once the server has answered,
// the game stays loaded" against a later cached null re-closing New Game.
test('once the server confirmed the game absent, a later cached null keeps New Game open', async ({ page }) => {
  await seed('team/main', { roster, currentGameId: 'gone' });
  await openTracker(page, { 'games/gone': { cachedNullAfterServer: true } });
  await page.waitForFunction(() => window.__snaps?.some(snap => snap.path === 'games/gone' && snap.injected));
  await go(page, '#/new');
  await expect(page.getByTestId('opponent-input')).toBeVisible({ timeout: SERVER_WAIT });
});
