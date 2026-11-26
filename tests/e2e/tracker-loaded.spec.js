import { test, expect } from './fixtures.js';
import { closeAll, instrumentRepo, remove, resetAll, seed } from './helpers.js';
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

// What New Game renders while the current game is not loaded: its heading and a loading line, no form.
const loadingLine = page => page.locator('.new-game .status-line');

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
  // New Game is mounted and waiting (not Home, which has no opponent input either).
  await expect(loadingLine(page)).toBeVisible();
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
  // The server's answer for games/gone (recorded with its real fromCache false, though the rule delivers it as
  // cached) has been handled. An early cached miss from the SDK is recorded fromCache true and does not count.
  await page.waitForFunction(() => window.__snaps?.some(snap => snap.path === 'games/gone' && !snap.exists && snap.fromCache === false));
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  await expect(loadingLine(page)).toBeVisible();
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

// The game was shown from the server; a later cached null (the listener fell back to a cache that lacks it) only says
// the cache lacks the game. The live game stays on screen and New Game stays closed.
test('a cached null after the live game was shown keeps the game and New Game closed', async ({ page }) => {
  await seed('team/main', { roster, currentGameId: 'g1' });
  await seed('games/g1', liveGame);
  await openTracker(page, { 'games/g1': { cachedNullAfterServer: true } });
  await page.waitForFunction(() => window.__snaps?.some(snap => snap.path === 'games/g1' && snap.injected));
  await go(page, '#/new');
  await expect(page.getByTestId('resume-live')).toBeVisible({ timeout: SERVER_WAIT });
  await expect(page.getByTestId('opponent-input')).toBeHidden();
  await go(page, '#/live');
  await expect(page.getByTestId('score-us')).toBeVisible();
});

// A game stored without a status compares equal to an absent one's status, so reconfirm must treat the
// server's absence first, or the stale game stays and New Game prefills from its competition.
test('a current game without a status that the server no longer has is cleared by the reconfirm', async ({ page }) => {
  const { status, ...noStatus } = { ...liveGame, competition: 'cup' };
  expect(status).toBe('live');
  await seed('team/main', { roster, currentGameId: 'g1' });
  await seed('games/g1', noStatus);
  // Holding the server's snapshots keeps the page on the game it already has, as when the stream is stale.
  await openTracker(page, { 'games/g1': { hold: true } });
  await expect.poll(() => page.evaluate(() => window.__queued?.['games/g1'])).toBe(1);
  await remove('games/g1');
  await expect.poll(() => page.evaluate(() => window.__queued?.['games/g1'])).toBe(2);

  await setVisibility(page, 'hidden');
  await setVisibility(page, 'visible');
  // New Game starts from the previous game's competition, so a stale game shows as Cup. It is read afresh
  // each time New Game is opened, until the reconfirm has cleared the game and it shows the default.
  const competitionOnOpen = async () => {
    await go(page, '#/');
    await expect(page.getByTestId('home-new')).toBeVisible();
    await go(page, '#/new');
    await expect(page.getByTestId('competition-select')).toBeVisible();
    return page.getByTestId('competition-select').inputValue();
  };
  await expect.poll(competitionOnOpen, { timeout: SERVER_WAIT }).toBe('league');
});
