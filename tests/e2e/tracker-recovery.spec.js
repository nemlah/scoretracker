import { execSync } from 'node:child_process';
import { test, expect } from './fixtures.js';
import {
  closeAll, consoleProblems, get, instrumentRepo, resetAll, seed, update,
} from './helpers.js';
import { isFirestoreChannelLoss, isPlaywrightServiceWorkerBlock } from './network-noise.js';
import {
  CODE, HOME_URL, SERVER_WAIT, dropNetworkNoise, editEvent, formatConsoleProblem, otherDeviceTakesControl,
  reloadTracker, unlockTracker, waitForTrackerControl,
} from './tracker-helpers.js';

// A listener the server ended (code `unavailable`, a rejected target) used to stay dead while the screen looked
// confirmed. instrumentRepo's `fail` rule ends a listener after its first server snapshot, as the SDK would, and
// `holdReopen` keeps the reopened listener's first server answer back until the test releases it.
test.use({ serviceWorkers: 'block' });

const roster = [
  { id: 'p5', name: 'Alexiou', cap: 5, archived: false },
  { id: 'p7', name: 'Georgiou', cap: 7, archived: false },
];
const lineup = [{ playerId: 'p5', name: 'Alexiou', cap: 5 }, { playerId: 'p7', name: 'Georgiou', cap: 7 }];
const liveGame = events => ({
  opponent: 'Live FC', date: '2026-11-16', season: '2026-27', status: 'live', situations: true, period: 1, lineup, events,
});
const goal = (id, ts, playerId = 'p5') => ({ id, type: 'goal', period: 1, ts, playerId });
const seedLive = (events = []) => Promise.all([
  seed('team/main', { roster, currentGameId: 'g1' }),
  seed('games/g1', liveGame(events)),
]);

const previous = path => execSync(`git show 67cd574:${path}`, { encoding: 'utf8', maxBuffer: 1 << 20 });
const tile = (page, cap) => page.locator(`[data-testid="tile"][data-cap="${cap}"]`);
const counter = (page, name, path) => page.evaluate(([n, p]) => window[n]?.[p] ?? 0, [name, path]);
const journalOf = page => page.evaluate(() => JSON.parse(localStorage.getItem('wp-journal') ?? '[]'));
// Moves without a tap, which could claim control.
const go = (page, hash) => page.evaluate(value => { location.hash = value; }, hash);
// The page cannot be backgrounded in a test; replay what the browser reports.
const setVisibility = (page, visibility) => page.evaluate(value => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
  document.dispatchEvent(new Event('visibilitychange'));
}, visibility);
// The held first server answer of the reopened listener is queued once the reopen has made it.
const reopenHeld = (page, path) => expect.poll(() => counter(page, '__queued', path), { timeout: SERVER_WAIT }).toBe(1);
const release = (page, path) => page.evaluate(p => window.__releaseHeld(p), path);

// The first tap arms the button. A confirming tap too soon after arming counts as a double tap and is ignored (the
// button stays armed), and nothing on the page says when the guard has passed. So the confirming tap is retried while
// the button is still visible and armed. A confirming tap closes the sheet (or disarms the button): from then on nothing
// is clicked again, and only the outcome is waited for, however long the server takes.
async function armThenConfirm(page, testid, confirmed) {
  const button = page.getByTestId(testid);
  await button.click();
  await expect(button).toHaveText('Tap again to confirm');
  await expect(async () => {
    if (await button.isVisible()) await button.click({ timeout: 1000 });
    const armed = await button.isVisible() && ((await button.getAttribute('class', { timeout: 500 }).catch(() => '')) ?? '').includes('is-armed');
    expect(armed, 'the confirming tap was ignored').toBe(false);
  }).toPass({ timeout: SERVER_WAIT });
  await expect.poll(confirmed, { timeout: SERVER_WAIT }).toBe(true);
}

let problems;
let blocked;
test.beforeEach(async ({ page }) => {
  blocked = { url: null, errors: [] };
  problems = consoleProblems(page, { blocked, ignore: isFirestoreChannelLoss, format: formatConsoleProblem });
  await resetAll();
  await seed('secrets/editCode', { code: CODE });
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});
test.afterAll(closeAll);

// The device is unlocked and in control first (no failure rule yet), then the page reloads with the rules. The failure
// a rule injects at boot, right after the first server answer, then meets a screen that is ready to be used, and a test
// can act inside the first backoff step (2 s, at least 1.6 s) before the listener is reopened.
async function openTracker(page, rules, hash = '#/live') {
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await go(page, hash);
  await instrumentRepo(page, rules);
  await reloadTracker(page, problems);
}

// Taps a goal as soon as the game listener's failure has landed, and says the listener had not been reopened yet: a
// tap after the reopen could show through the reopened listener's cached snapshot and prove nothing.
async function tapWhileDown(page) {
  await page.waitForFunction(() => window.__failures?.['games/g1'] === 1, null, { polling: 'raf' });
  await tile(page, 5).getByTestId('tile-goal').click();
  expect(await counter(page, '__attempts', 'games/g1'), 'the tap came after the listener was reopened').toBe(1);
  // The tap is in the journal at once, with no server answer yet.
  expect(await journalOf(page)).toHaveLength(1);
}

test('a failed team listener shows the offline banner and recovers', async ({ page }) => {
  await seed('team/main', { roster });
  // Records each state the offline banner takes (shown or hidden), so a stay of any length is seen.
  await page.addInitScript(() => {
    window.__bannerLog = [];
    const seen = () => {
      const banner = document.querySelector('[data-testid="offline-banner"]');
      if (!banner) return;
      const state = banner.hidden ? 'hidden' : 'shown';
      if (window.__bannerLog.at(-1) !== state) window.__bannerLog.push(state);
    };
    new MutationObserver(seen).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
  });
  // The bare rule: the listener fails after its first server answer and the automatic reopen brings it back.
  await openTracker(page, { 'team/main': { fail: 1 } }, '#/');
  await expect.poll(() => counter(page, '__failures', 'team/main'), { timeout: SERVER_WAIT }).toBe(1);
  // A rename while the listener is down or being reopened.
  await update('team/main', { roster: [{ ...roster[0], name: 'Renamed' }, roster[1]] });
  await expect.poll(() => counter(page, '__attempts', 'team/main'), { timeout: SERVER_WAIT }).toBe(2);
  // Hidden, then shown for the outage, then hidden again once the server has answered the reopened listener.
  await expect.poll(() => page.evaluate(() => window.__bannerLog), { timeout: SERVER_WAIT }).toEqual(['hidden', 'shown', 'hidden']);
  await page.getByTestId('home-roster').click();
  await expect(page.getByTestId('roster-list').getByTestId('roster-row').filter({ hasText: 'Renamed' })).toBeVisible();
  dropNetworkNoise(problems);
});

test('a failed game listener keeps a tap pending until the reopened server answer, then confirms it', async ({ page }) => {
  await seedLive();
  await openTracker(page, { 'games/g1': { fail: 1, holdReopen: true } });
  await tapWhileDown(page);
  await expect.poll(async () => (await get('games/g1')).events.length).toBe(1);
  await reopenHeld(page, 'games/g1');
  // The reopened listener has not answered yet: the tap is neither confirmed nor failed.
  const held = await journalOf(page);
  expect(held).toHaveLength(1);
  expect(held[0]).toMatchObject({ gameId: 'g1', op: 'add', status: 'pending' });
  await expect(page.getByTestId('failed-banner')).toBeHidden();

  await release(page, 'games/g1');
  await expect.poll(() => journalOf(page)).toEqual([]);
  await expect(page.getByTestId('failed-banner')).toBeHidden();
  expect((await get('games/g1')).events).toHaveLength(1);
  expect((await get('games/g1')).events[0]).toMatchObject({ type: 'goal', playerId: 'p5' });
  dropNetworkNoise(problems);
});

test('back from the background, a failed control listener keeps a non-active device unconfirmed', async ({ page }) => {
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await otherDeviceTakesControl();
  // Every control listener ends right after its first server answer. No game is live.
  await instrumentRepo(page, { 'control/tracker': { fail: 99 } });
  await reloadTracker(page, problems);
  await expect.poll(() => counter(page, '__failures', 'control/tracker'), { timeout: SERVER_WAIT }).toBeGreaterThan(0);
  await expect(page.getByTestId('home-new')).toBeVisible({ timeout: SERVER_WAIT });
  await expect(page.getByTestId('takeover-banner')).toBeVisible();

  await setVisibility(page, 'hidden');
  await setVisibility(page, 'visible');
  // The server read behind the return has been answered and handled.
  await page.waitForFunction(() => window.__confirmed >= 1);
  // isVisible() answers at once. toBeVisible() would retry and pass once the next reopen failed again, which hides
  // exactly the stretch in which the read had marked the screen confirmed.
  const bannerShown = () => page.getByTestId('takeover-banner').isVisible();
  expect(await bannerShown()).toBe(true);
  await page.locator('.brand').click();
  expect(await bannerShown()).toBe(true);
  // Nothing-happened check: a takeover would be written at once, and there is nothing to wait on when it is refused.
  // The window is longer than the first backoff step (2 s, at most 2.4 s), and the end condition is the banner still
  // shown and the other device still holding control.
  await page.waitForTimeout(3000);
  expect(await bannerShown()).toBe(true);
  expect((await get('control/tracker')).activeUid).toBe('another-device');
  // The reload cut the first page's open channels off.
  dropNetworkNoise(problems);
});

// The foreground read is made, the server then moves on and a listener delivers the newer state, and only then does
// the read's (older) answer arrive. Each listener's newer snapshot must win over the read.
test('a slow foreground read does not put back a team pointer a listener has since delivered', async ({ page }) => {
  await Promise.all([
    seed('team/main', { roster, currentGameId: 'g1' }),
    seed('games/g1', liveGame([goal('e1', 1000)])),
    seed('games/g2', { ...liveGame([goal('e2', 1000), goal('e3', 1010)]), opponent: 'Second FC' }),
  ]);
  await openTracker(page, { confirmFromServer: { hold: true } });
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await setVisibility(page, 'hidden');
  await setVisibility(page, 'visible');
  // The read has the server's answer for g1 in hand and keeps it back.
  await page.waitForFunction(() => window.__confirmReady === true);
  await update('team/main', { currentGameId: 'g2' });
  await expect(page.getByTestId('score-us')).toHaveText('2', { timeout: SERVER_WAIT });
  expect(await counter(page, '__attempts', 'games/g2')).toBe(1);

  await page.evaluate(() => window.__releaseConfirm());
  await page.waitForFunction(() => window.__confirmed >= 1);
  // The stale pointer would reopen g1 at once (a second watch of it) and show its score.
  expect(await counter(page, '__attempts', 'games/g1')).toBe(1);
  await expect(page.getByTestId('score-us')).toHaveText('2');
  expect(await counter(page, '__attempts', 'games/g2')).toBe(1);
  dropNetworkNoise(problems);
});

test('a slow foreground read does not put back a control document a listener has since delivered', async ({ page }) => {
  await seedLive();
  await openTracker(page, { confirmFromServer: { hold: true } });
  await expect(page.getByTestId('score-us')).toHaveText('0');
  await expect(page.getByTestId('takeover-banner')).toBeHidden();
  await setVisibility(page, 'hidden');
  await setVisibility(page, 'visible');
  await page.waitForFunction(() => window.__confirmReady === true);
  // The read holds the control document as it was: this device in control.
  await otherDeviceTakesControl();
  await expect(page.getByTestId('takeover-banner')).toBeVisible({ timeout: SERVER_WAIT });

  await page.evaluate(() => window.__releaseConfirm());
  await page.waitForFunction(() => window.__confirmed >= 1);
  // isVisible() answers at once: the stale document would have made this device the active one again.
  expect(await page.getByTestId('takeover-banner').isVisible()).toBe(true);
  dropNetworkNoise(problems);
});

// The editor listener is down: whether this device may take control cannot be judged from what it last showed.
test('a failed editor listener keeps a non-active device from taking control by itself', async ({ page }) => {
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await waitForTrackerControl();
  const uid = (await get('control/tracker')).activeUid;
  await otherDeviceTakesControl();
  // Every editor listener of this device ends right after its first server answer. No game is live.
  await instrumentRepo(page, { [`editors/${uid}`]: { fail: 99 } });
  await reloadTracker(page, problems);
  await expect.poll(() => counter(page, '__failures', `editors/${uid}`), { timeout: SERVER_WAIT }).toBeGreaterThan(0);
  await expect(page.getByTestId('home-new')).toBeVisible({ timeout: SERVER_WAIT });
  await setVisibility(page, 'hidden');
  await setVisibility(page, 'visible');
  await page.waitForFunction(() => window.__confirmed >= 1);
  // isVisible() answers at once; see the control-listener test above.
  const bannerShown = () => page.getByTestId('takeover-banner').isVisible();
  expect(await bannerShown()).toBe(true);
  await page.locator('.brand').click();
  // Nothing-happened check: a takeover would be written at once, and there is nothing to wait on when it is refused.
  // The window is longer than the first backoff step (2 s, at most 2.4 s); the end condition is the banner still
  // shown and the other device still holding control.
  await page.waitForTimeout(3000);
  expect(await bannerShown()).toBe(true);
  expect((await get('control/tracker')).activeUid).toBe('another-device');
  dropNetworkNoise(problems);
});

test('a write made while the game listener is failed shows at the next reopen', async ({ page }) => {
  await seedLive();
  await openTracker(page, { 'games/g1': { fail: 1, holdReopen: true } });
  await tapWhileDown(page);
  await expect.poll(async () => (await get('games/g1')).events.length).toBe(1);
  await expect(page.getByTestId('offline-banner')).toBeVisible();
  await reopenHeld(page, 'games/g1');
  await expect(page.getByTestId('offline-banner')).toBeVisible();

  await release(page, 'games/g1');
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await expect(page.getByTestId('offline-banner')).toBeHidden();
  expect(await counter(page, '__attempts', 'games/g1')).toBe(2);
  dropNetworkNoise(problems);
});

test.describe('mixed module cache', () => {
  // repo.js is the previous release's: watchControl and watchOwnEditor take no onError, so a failure is never
  // reported and those watches behave as before.
  test('the tracker unlocks and records a goal when repo.js is the previous release', async ({ page }) => {
    const old = previous('js/repo.js');
    await page.route('**/js/repo.js', route => route.fulfill({ contentType: 'text/javascript', body: old }));
    await seedLive();
    await page.goto(HOME_URL);
    await expect(page.getByTestId('code-input')).toBeVisible();
    await unlockTracker(page);
    await go(page, '#/live');
    await tile(page, 5).getByTestId('tile-goal').click();
    await expect.poll(async () => (await get('games/g1')).events.length).toBe(1);
    await expect.poll(() => journalOf(page)).toEqual([]);
    // The control watch still delivers: another device taking control shows its banner.
    await otherDeviceTakesControl();
    await expect(page.getByTestId('takeover-banner')).toBeVisible();
  });

  // events.js is the previous release's (its End passes no date).
  test('the previous Events sheet edits a goal, deletes a goal and ends the game', async ({ page }) => {
    const old = previous('js/tracker/views/events.js');
    await page.route('**/js/tracker/views/events.js', route => route.fulfill({ contentType: 'text/javascript', body: old }));
    // Writes leave the page late once `writeDelayMs` is set, so the server answers the End well after a short poll.
    let writeDelayMs = 0;
    await page.route(/\/Write\/channel/, async route => {
      if (writeDelayMs > 0) await new Promise(resolve => setTimeout(resolve, writeDelayMs));
      await route.continue().catch(() => {});
    });
    await seedLive([goal('e1', 1000), goal('e2', 1010)]);
    await page.goto(HOME_URL);
    await unlockTracker(page);
    await go(page, '#/live');
    await page.getByTestId('events-open').click();
    await expect(page.getByTestId('events-sheet')).toBeVisible();
    await expect(page.getByTestId('ev-row')).toHaveCount(2);

    // Newest first: e2 is the first row. Give it to Georgiou.
    const newest = page.getByTestId('ev-row').first();
    await editEvent(newest);
    await newest.getByTestId('ev-scorer').selectOption('p7');
    await expect.poll(async () => (await get('games/g1')).events.find(event => event.id === 'e2').playerId).toBe('p7');

    await page.getByTestId('ev-row').last().getByTestId('ev-delete').click();
    await expect.poll(async () => (await get('games/g1')).events.map(event => event.id)).toEqual(['e2']);

    writeDelayMs = 2500;
    await armThenConfirm(page, 'end-game', async () => (await get('games/g1')).status === 'final');
    writeDelayMs = 0;
    await expect.poll(() => journalOf(page), { timeout: SERVER_WAIT }).toEqual([]);
  });

  // A stalled fetch of the optional module (a v6 worker with no cached copy) must not hold the tracker on Loading.
  test('the tracker starts and records a goal when watchRetry.js never answers', async ({ page }) => {
    await page.route('**/js/watchRetry.js', () => new Promise(() => {}));
    await seedLive();
    await page.goto(HOME_URL);
    await expect(page.getByTestId('code-input')).toBeVisible({ timeout: SERVER_WAIT });
    await unlockTracker(page);
    await go(page, '#/live');
    await tile(page, 5).getByTestId('tile-goal').click();
    await expect.poll(async () => (await get('games/g1')).events.length).toBe(1);
    await expect(page.getByTestId('score-us')).toHaveText('1');
    await expect.poll(() => journalOf(page)).toEqual([]);
  });

  test('the tracker starts and records a goal when watchRetry.js fails to load', async ({ page, baseURL }) => {
    blocked.url = new URL('/js/watchRetry.js', baseURL).href;
    let asked = 0;
    await page.route('**/js/watchRetry.js', route => { asked += 1; return route.abort(); });
    const warnings = [];
    page.on('console', message => { if (message.type() === 'warning' && !isPlaywrightServiceWorkerBlock(message.text())) warnings.push(message.text()); });
    await seedLive();
    await page.goto(HOME_URL);
    await unlockTracker(page);
    await go(page, '#/live');
    await tile(page, 5).getByTestId('tile-goal').click();
    await expect.poll(async () => (await get('games/g1')).events.length).toBe(1);
    await expect(page.getByTestId('score-us')).toHaveText('1');
    await expect.poll(() => journalOf(page)).toEqual([]);
    // The module was asked for, and its loss changed nothing.
    expect(asked).toBeGreaterThan(0);
    // A module missing from a mixed cache is not worth a warning: the tracker simply behaves as it did.
    expect(warnings).toEqual([]);
  });
});
