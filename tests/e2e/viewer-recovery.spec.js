import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.js';
import { seasonFor, todayIso } from '../../js/model.js';
import {
  closeAll, consoleProblems, instrumentRepo, open, resetAll, seed, update,
} from './helpers.js';

// A watch the server ended (code `unavailable`, a rejected target) used to stay dead until the page was reloaded.
// instrumentRepo's `fail` rule ends a listener after its first server snapshot, as the SDK would.
test.use({ serviceWorkers: 'block' });

const roster = [{ id: 'p5', name: 'Alexiou', cap: 5, archived: false }];
const lineup = [{ playerId: 'p5', name: 'Alexiou', cap: 5 }];
const SEASON = seasonFor(todayIso());
const goal = (id, ts) => ({ id, type: 'goal', period: 1, ts, playerId: 'p5' });

const seedLive = () => Promise.all([
  seed('team/main', { currentGameId: 'g1', roster }),
  seed('games/g1', {
    opponent: 'Opponent FC', date: '2026-11-08', season: SEASON, status: 'live', period: 1, lineup, events: [goal('e1', 1000)],
  }),
]);
const result = (gameId, opponent) => ({ gameId, date: '2026-11-08', opponent, us: 2, them: 1 });
const statsDoc = results => ({ players: { p5: { name: 'Alexiou', games: 1, goals: 2, excl: 0, pens: 0 } }, results });
const counter = (page, name, path) => page.evaluate(([n, p]) => window[n]?.[p] ?? 0, [name, path]);
const POLL = { timeout: 10000 };

let problems;
let blocked;
test.beforeEach(async ({ page }) => {
  blocked = { url: null, errors: [] };
  problems = consoleProblems(page, { blocked });
  await resetAll();
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});
test.afterAll(closeAll);

test('a failed live game watch comes back without a reload', async ({ page }) => {
  await seedLive();
  await instrumentRepo(page, { 'games/g1': { fail: 1 } });
  await open(page, '#/game/g1');
  await expect.poll(() => counter(page, '__failures', 'games/g1'), POLL).toBe(1);
  await expect(page.getByTestId('game-unavailable')).toBeVisible();
  // A goal after the failure reaches the screen through the reopened listener.
  await update('games/g1', { events: [goal('e1', 1000), goal('e2', 1010)] });
  await expect(page.getByTestId('score-us')).toHaveText('2', { timeout: 15000 });
  expect(await counter(page, '__attempts', 'games/g1')).toBe(2);
  expect(await counter(page, '__failures', 'games/g1')).toBe(1);
});

test('a failed stats watch shows Failed until the server answers, never a cached result', async ({ page }) => {
  const path = `stats/${SEASON}`;
  await seed('team/main', { roster });
  await seed(path, statsDoc([result('g1', 'Before FC')]));
  // From the moment the failure shows, records any visible Loading line and any row from before the failure.
  await page.addInitScript(() => {
    const flash = { failedSeen: false, loading: 0, rows: [] };
    window.__flash = flash;
    const visible = el => el.getClientRects().length > 0;
    new MutationObserver(() => {
      if ([...document.querySelectorAll('[data-testid="results-failed"]')].some(visible)) flash.failedSeen = true;
      if (!flash.failedSeen) return;
      for (const el of document.querySelectorAll('[data-testid="results-loading"]')) if (visible(el)) flash.loading += 1;
      for (const el of document.querySelectorAll('[data-testid="result-row"]')) {
        if (visible(el) && el.textContent.includes('Before FC')) flash.rows.push(el.textContent);
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  await instrumentRepo(page, { [path]: { fail: 1, holdReopen: true } });
  await open(page);
  await expect.poll(() => counter(page, '__failures', path), POLL).toBe(1);
  await expect(page.getByTestId('results-failed')).toBeVisible();
  // The reopened listener has a cached answer (the old row) that must stay out, and its server answer is held.
  await expect.poll(() => counter(page, '__queued', path), POLL).toBe(1);
  await update(path, statsDoc([result('g2', 'After FC')]));
  // The new server answer queues behind the held one: both are still on hold.
  await expect.poll(() => counter(page, '__queued', path), POLL).toBeGreaterThanOrEqual(2);
  // The reopened attempt (the second watch() call) really delivered its cached answer, the old row, to the viewer
  // before the release: only holdCached keeps it off the screen. The first attempt's answers do not count.
  const reopenedCached = await page.evaluate(p => window.__snaps
    .filter(snap => snap.path === p && snap.attempt === 2 && snap.fromCache && snap.exists).length, path);
  expect(reopenedCached, 'the reopened attempt delivered its cached answer').toBeGreaterThan(0);
  const reopenedServer = await page.evaluate(p => window.__snaps
    .filter(snap => snap.path === p && snap.attempt === 2 && !snap.fromCache).length, path);
  expect(reopenedServer, 'the reopened attempt has no server answer on record before the release').toBe(0);
  // Nothing-happened check, ended by the release below: the cached answer arrived and nothing showed it, so the
  // record is read now. It must hold neither a Loading line nor the old row.
  await expect(page.getByTestId('results-failed')).toBeVisible();
  expect(await page.evaluate(() => window.__flash)).toEqual({ failedSeen: true, loading: 0, rows: [] });
  await page.evaluate(p => window.__releaseHeld(p), path);
  await expect(page.getByTestId('result-row').filter({ hasText: 'After FC' })).toBeVisible();
  await expect(page.getByTestId('results-failed')).toHaveCount(0);
});

test('the viewer starts and shows the score when watchRetry.js fails to load', async ({ page, baseURL }) => {
  const path = `stats/${SEASON}`;
  blocked.url = new URL('/js/watchRetry.js', baseURL).href;
  await page.route('**/js/watchRetry.js', route => route.abort());
  await seedLive();
  await seed(path, statsDoc([result('g1', 'Opponent FC')]));
  await instrumentRepo(page, { [path]: { fail: 1 } });
  await open(page);
  // Without the module a failure leaves today's state, as on the previous release: the results stay failed.
  await expect.poll(() => counter(page, '__failures', path), POLL).toBe(1);
  await expect(page.getByTestId('results-failed')).toBeVisible();
  // Nothing-happened check: a reopen would come after the first backoff step (2 s, at most 2.4 s) and there is
  // nothing to wait on when nothing opens. The end condition is the state still shown, with no second watch.
  await page.waitForTimeout(3500);
  await expect(page.getByTestId('results-failed')).toBeVisible();
  expect(await counter(page, '__attempts', path)).toBe(1);
  // The rest of the viewer works: the live game opens and shows its score.
  await page.getByTestId('live-banner').click();
  await expect(page.getByTestId('score-us')).toHaveText('1');
});

test('a watch that fails before watchRetry.js has loaded is retried once per failure after it loads', async ({ page }) => {
  const path = 'games/g1';
  let openGate;
  const gate = new Promise(resolve => { openGate = resolve; });
  const module = readFileSync('js/watchRetry.js', 'utf8');
  await page.route('**/js/watchRetry.js', async route => {
    await gate;
    await route.fulfill({ contentType: 'text/javascript', body: module });
  });
  try {
    await seedLive();
    // The first two attempts fail: the original watch, then the first reopen. The second reopen is the one that works.
    await instrumentRepo(page, { [path]: { fail: 2 } });
    // WebKit holds the load event for the module that is still out, so the page is not waited for.
    await page.goto('/index.html?emulator=1#/game/g1', { waitUntil: 'commit' });
    await expect.poll(() => counter(page, '__failures', path), POLL).toBe(1);
    await expect(page.getByTestId('game-unavailable')).toBeVisible();
    await update(path, { events: [goal('e1', 1000), goal('e2', 1010)] });
    // Nothing-happened check: with the module still out nothing reopens the watch. There is nothing to wait on;
    // the window is the 2.4 s jitter ceiling of the first backoff step plus margin, and the end condition is the
    // counter read after it.
    await page.waitForTimeout(3000);
    expect(await counter(page, '__attempts', path)).toBe(1);
  } finally {
    openGate();
  }
  // Step 1: the module arrives, takes the failed watch over, and reopens it once (after about 2 s). That reopen fails.
  // Waited for in the page itself (a frame at a time), so the window below starts at the failure.
  await page.waitForFunction(p => window.__failures?.[p] === 2, path, { timeout: 10000 });
  expect(await counter(page, '__attempts', path)).toBe(2);
  // Nothing-happened check: the injected failure comes after a server answer, which resets the keeper's backoff,
  // so the next reopen is 2 s away (1.6 s at the least with jitter). 0.8 s later there is still exactly one reopen
  // for this failure, not an early one. This window is deliberately shorter than that delay: it guards against a
  // reopen BEFORE the step, and a duplicate one is caught by the later windows. Ended by the counter and the
  // screen below.
  await page.waitForTimeout(800);
  expect(await counter(page, '__attempts', path)).toBe(2);
  await expect(page.getByTestId('game-unavailable')).toBeVisible();
  // Step 2: one more reopen, which works and shows the goal.
  await expect.poll(() => counter(page, '__attempts', path), POLL).toBe(3);
  await expect(page.getByTestId('score-us')).toHaveText('2', { timeout: 15000 });
  // Nothing-happened check: once recovered the watch stays as it is. A leftover or duplicate retry would fire one
  // first-step delay after the recovery, 1.6 to 2.4 s with jitter, so the window is the 2.4 s ceiling plus margin.
  // Ended by the counters below.
  await page.waitForTimeout(3000);
  expect(await counter(page, '__attempts', path)).toBe(3);
  expect(await counter(page, '__failures', path)).toBe(2);
  await expect(page.getByTestId('score-us')).toHaveText('2');
});
