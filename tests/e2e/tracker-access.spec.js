import { execSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { closeAll, get, remove, resetAll, seed, update } from './helpers.js';
import { CODE, HOME_URL, TRACKER_URL, collectProblems, dropNetworkNoise, reloadTracker, unlockTracker } from './tracker-helpers.js';

const ORIGIN = 'http://127.0.0.1:4173';

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

test('code input upper-cases and keeps only 6 of 0-9A-Z', async ({ page }) => {
  await page.goto(TRACKER_URL);
  const input = page.getByTestId('code-input');
  await input.pressSequentially('ab1-2cdx');
  await expect(input).toHaveValue('AB12CD');
  await input.fill('zz-9!');
  await expect(input).toHaveValue('ZZ9');
});

test('wrong code shows error and stays locked', async ({ page }) => {
  await page.goto(TRACKER_URL);
  await page.getByTestId('code-input').fill('ZZ99ZZ');
  await page.getByTestId('unlock-btn').click();
  await expect(page.getByTestId('unlock-error')).toContainText('not right');
  await expect(page.getByTestId('code-input')).toBeVisible();
  await expect(page.getByTestId('home-new')).toHaveCount(0);
});

test('right code unlocks and survives reload', async ({ page }) => {
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await expect(page.getByTestId('takeover-banner')).toBeHidden();
  await expect(page.getByTestId('home-new')).toBeEnabled();
  await reloadTracker(page, problems);
  await expect(page.getByTestId('home-new')).toBeVisible();
  await expect(page.getByTestId('code-input')).toHaveCount(0);
});

// The viewer never signs in. If both pages shared one Firestore cache, the viewer tab opened
// first would run the tracker's listeners without its sign-in and the tracker would hang on
// "Loading…" with permission-denied.
test('a viewer tab opened first in the same browser does not block the tracker', async ({ page, context }) => {
  await page.goto('/index.html?emulator=1');
  await expect(page.getByTestId('empty-state')).toBeVisible();

  const tracker = await context.newPage();
  collectProblems(tracker, problems);
  await tracker.goto(TRACKER_URL);
  await unlockTracker(tracker);
  await expect(page.getByTestId('empty-state')).toBeVisible();
});

const roster = [
  { id: 'p5', name: 'Alexiou', cap: 5, archived: false },
  { id: 'p7', name: 'Georgiou', cap: 7, archived: false },
];

async function startGame(page) {
  await seed('team/main', { roster });
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await page.getByTestId('home-new').click();
  await page.getByTestId('opponent-input').fill('Opponent FC');
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('score-us')).toHaveText('0');
}

// Device A unlocks first and holds control; then device B unlocks and takes it. Returns once the
// server says B holds control. With no live game A shows nothing when it learns of that, so there
// is no page signal to wait for on A; its control listener gets the change within milliseconds of
// the server holding it, while every step below that follows on A is a user action on A.
async function withTwoDevices(page, browser, body) {
  const aUid = await activeUid();
  expect(aUid).toBeTruthy();
  const contextB = await browser.newContext({ baseURL: ORIGIN });
  try {
    const pageB = await contextB.newPage();
    collectProblems(pageB, problems);
    await pageB.goto(HOME_URL);
    await unlockTracker(pageB);
    await expect.poll(activeUid).not.toBe(aUid);
    await body(pageB);
  } finally {
    await contextB.close();
  }
}

// Moves to the roster without a touch or key press, which would take control.
const openRosterQuietly = page => page.evaluate(() => { location.hash = '#/roster'; });
const activeUid = async () => (await get('control/tracker'))?.activeUid;
const rosterNames = async () => ((await get('team/main'))?.roster ?? []).map(player => player.name);

test('second device takes over; first becomes read-only and can take back', async ({ page, browser }) => {
  await startGame(page);
  await withTwoDevices(page, browser, async pageB => {
    await expect(page.getByTestId('takeover-banner')).toBeVisible();
    await expect(page.getByTestId('takeover-banner')).toContainText('Tracking moved to another device');
    await expect(page.getByTestId('take-over')).toHaveText('Take over');
    await expect(page.getByTestId('opp-goal')).toBeDisabled();
    await expect(pageB.getByTestId('takeover-banner')).toBeHidden();

    // A touch on a live game does not take control; only Take over does.
    const holder = await activeUid();
    await page.getByTestId('score-us').click();
    // A negative check has no event to wait for: give a takeover write time to show up.
    await page.waitForTimeout(500);
    expect(await activeUid()).toBe(holder);
    await expect(page.getByTestId('takeover-banner')).toBeVisible();

    await page.getByTestId('take-over').click();
    await expect(page.getByTestId('takeover-banner')).toBeHidden();
    await expect(page.getByTestId('opp-goal')).toBeEnabled();
    await expect(pageB.getByTestId('takeover-banner')).toBeVisible();
  });
});

test('with no live game the device not in control shows no banner and keeps its buttons', async ({ page, browser }) => {
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await withTwoDevices(page, browser, async () => {
    await expect(page.getByTestId('takeover-banner')).toBeHidden();
    await expect(page.getByTestId('home-new')).toBeEnabled();
    await openRosterQuietly(page);
    await expect(page.getByTestId('roster-add-name')).toBeEnabled();
    await expect(page.getByTestId('roster-add-cap')).toBeEnabled();
    await expect(page.getByTestId('roster-add-btn')).toBeEnabled();
    await expect(page.getByTestId('takeover-banner')).toBeHidden();
  });
});

test('with no live game the first touch takes control and the change is saved', async ({ page, browser }) => {
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await withTwoDevices(page, browser, async pageB => {
    const holder = await activeUid();
    await openRosterQuietly(page);
    await page.getByTestId('roster-add-name').fill('Quiet');
    await page.getByTestId('roster-add-cap').fill('9');
    await page.getByTestId('roster-add-btn').click();
    // The write itself is checked, not only the move of control: the rules refuse it without control.
    await expect.poll(rosterNames).toContain('Quiet');
    const taken = await activeUid();
    expect(taken).not.toBe(holder);
    await expect(page.getByTestId('takeover-banner')).toBeHidden();
    await expect(pageB.getByTestId('takeover-banner')).toBeHidden();
    await expect(page.getByTestId('failed-banner')).toBeHidden();
  });
});

test('the first touch on a roster row button is not lost to the render it causes', async ({ page, browser }) => {
  await seed('team/main', { roster: [{ id: 'a', name: 'Alexiou', cap: 5, archived: false }] });
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await withTwoDevices(page, browser, async () => {
    await openRosterQuietly(page);
    await page.getByTestId('roster-archive').click();
    await expect.poll(async () => (await get('team/main'))?.roster?.[0]?.archived).toBe(true);
  });
});

test('a first key press takes control and the change is saved', async ({ page, browser }) => {
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await withTwoDevices(page, browser, async pageB => {
    const holder = await activeUid();
    await openRosterQuietly(page);
    const name = page.getByTestId('roster-add-name');
    await expect(name).toBeEnabled();
    await name.fill('Keys');
    await page.getByTestId('roster-add-cap').fill('8');
    // Enter is the first key: its keydown must take control before the form submits.
    await page.getByTestId('roster-add-cap').press('Enter');
    await expect.poll(rosterNames).toContain('Keys');
    expect(await activeUid()).not.toBe(holder);
    await expect(page.getByTestId('takeover-banner')).toBeHidden();
    await expect(pageB.getByTestId('takeover-banner')).toBeHidden();
  });
});

test('two open devices do not take control from each other without input', async ({ page, browser }) => {
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await withTwoDevices(page, browser, async () => {
    const holder = await activeUid();
    await page.waitForTimeout(2000);
    expect(await activeUid()).toBe(holder);
  });
});

test('offline with no live game the device not in control stays read-only', async ({ page, context, browser }) => {
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await withTwoDevices(page, browser, async () => {
    await context.setOffline(true);
    try {
      await expect(page.getByTestId('takeover-banner')).toBeVisible();
      await expect(page.getByTestId('home-new')).toBeDisabled();
    } finally {
      await context.setOffline(false);
    }
    await expect(page.getByTestId('takeover-banner')).toBeHidden();
  });
  dropNetworkNoise(problems);
});

// A phone holding the previous release can pair the new app.js with a cached ownership.js that
// lacks createControlClaim. The tracker must still start and save changes.
test.describe('mixed module cache', () => {
  test.use({ serviceWorkers: 'block' });

  test('the tracker still unlocks and saves when ownership.js is the previous release', async ({ page }) => {
    const previous = execSync('git show 7e9461a:js/tracker/ownership.js', { encoding: 'utf8', maxBuffer: 1 << 20 });
    await page.route('**/js/tracker/ownership.js', route => route.fulfill({ contentType: 'text/javascript', body: previous }));
    await page.goto(TRACKER_URL);
    await expect(page.getByTestId('code-input')).toBeVisible();
    await unlockTracker(page);
    await page.getByTestId('home-roster').click();
    await page.getByTestId('roster-add-name').fill('Cached');
    await page.getByTestId('roster-add-cap').fill('4');
    await page.getByTestId('roster-add-btn').click();
    await expect.poll(rosterNames).toContain('Cached');
  });
});

test('revoked code: next write shows unlock with code-changed notice', async ({ page }) => {
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await page.getByTestId('home-roster').click();
  await update('secrets/editCode', { code: 'NEW999' });
  await page.getByTestId('roster-add-name').fill('Nikos');
  await page.getByTestId('roster-add-cap').fill('7');
  await page.getByTestId('roster-add-btn').click();
  await expect(page.getByTestId('code-input')).toBeVisible();
  await expect(page.getByText('The code was changed')).toBeVisible();

  await page.getByTestId('code-input').fill('NEW999');
  await page.getByTestId('unlock-btn').click();
  await expect(page.getByTestId('roster-add-btn')).toBeEnabled();
  await expect(page.getByText('The code was changed')).toHaveCount(0);
});

test('a page restored from the back/forward cache is reloaded; an ordinary pageshow is not', async ({ page }) => {
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await page.evaluate(() => { window.__sameDocument = true; });

  // Playwright cannot drive a real bfcache round trip, so replay the event the browser sends.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })));
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__sameDocument)).toBe(true);

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await page.waitForFunction(() => window.__sameDocument === undefined);
  await expect(page.getByTestId('home-new')).toBeVisible();
  await expect(page.getByTestId('takeover-banner')).toBeHidden();
  dropNetworkNoise(problems);
});

test('pasting a formatted code keeps every character', async ({ page }) => {
  await page.goto(TRACKER_URL);
  const input = page.getByTestId('code-input');
  await input.focus();
  await page.keyboard.insertText('AB12-CD');
  await expect(input).toHaveValue('AB12CD');
  await input.fill('');
  await page.keyboard.insertText(' ab12cd ');
  await expect(input).toHaveValue('AB12CD');
  await page.getByTestId('unlock-btn').click();
  await expect(page.getByTestId('home-new')).toBeVisible();
});

test('unlock stops waiting after 10 seconds when the server does not answer, and unlocks when it does', async ({ page, context, browserName }) => {
  // Holding Firestore's stream requests is only reliable in Chromium; WebKit routes them differently.
  test.skip(browserName !== 'chromium', 'request holding is verified in chromium only');
  test.setTimeout(60000);
  await page.goto(TRACKER_URL);
  const held = [];
  const writes = '**/google.firestore.v1.Firestore/Write/**';
  await context.route(writes, route => { held.push(route); });
  await page.getByTestId('code-input').fill(CODE);
  await page.getByTestId('unlock-btn').click();
  await expect(page.getByTestId('unlock-btn')).toBeDisabled();
  await expect(page.getByTestId('unlock-error')).toContainText('needs a connection', { timeout: 15000 });
  await expect(page.getByTestId('unlock-btn')).toBeEnabled();
  await expect(page.getByTestId('code-input')).toBeVisible();

  // The queued write lands later; the editor listener unlocks the page by itself.
  await context.unroute(writes);
  for (const route of held) await route.continue().catch(() => {});
  await expect(page.getByTestId('home-new')).toBeVisible({ timeout: 20000 });
  dropNetworkNoise(problems);
});

test('a device that becomes active recounts the season of the current game', async ({ page }) => {
  const game = {
    opponent: 'Old FC', date: '2026-11-01', season: '2026-27', status: 'final', period: 4,
    lineup: [{ playerId: 'p5', name: 'Alexiou', cap: 5 }],
    events: [{ id: 'goal-1', type: 'goal', period: 1, ts: 1000, playerId: 'p5' }],
  };
  await seed('team/main', { roster: [{ id: 'p5', name: 'Alexiou', cap: 5, archived: false }], currentGameId: 'g1' });
  await seed('games/g1', game);
  // Another device finished the game but never got to the recount: no stats document exists.
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await expect.poll(async () => (await get('stats/2026-27'))?.results?.[0]?.us).toBe(1);

  // Taking over from another device repairs it too: with no live game the first touch does it.
  await update('control/tracker', { activeUid: 'another-device' });
  await remove('stats/2026-27');
  // Nothing on the page shows that this device learned of it, so touch until control moves: the
  // first touch after it learned takes control (earlier ones find the device still in control).
  await expect(async () => {
    await page.locator('.brand').click();
    expect(await activeUid()).not.toBe('another-device');
  }).toPass();
  await expect.poll(async () => (await get('stats/2026-27'))?.results?.[0]?.us).toBe(1);
});

test('unlock offline shows the connection message without trying', async ({ page, context }) => {
  await page.goto(TRACKER_URL);
  await expect(page.getByTestId('code-input')).toBeVisible();
  await context.setOffline(true);
  await page.getByTestId('code-input').fill(CODE);
  await page.getByTestId('unlock-btn').click();
  await expect(page.getByTestId('unlock-error')).toContainText('needs a connection');
  await expect(page.getByTestId('home-new')).toHaveCount(0);
  await context.setOffline(false);
  await expect(page.getByTestId('unlock-error')).toBeHidden();
  await page.getByTestId('unlock-btn').click();
  await expect(page.getByTestId('home-new')).toBeVisible();
  dropNetworkNoise(problems);
});
