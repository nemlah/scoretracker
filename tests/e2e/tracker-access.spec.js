import { test, expect } from '@playwright/test';
import { closeAll, get, remove, resetAll, seed, update } from './helpers.js';
import { CODE, TRACKER_URL, collectProblems, dropNetworkNoise, reloadTracker, unlockTracker } from './tracker-helpers.js';

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

test('second device takes over; first becomes read-only and can take back', async ({ page, browser }) => {
  await page.goto(TRACKER_URL);
  await unlockTracker(page);

  const contextB = await browser.newContext({ baseURL: ORIGIN });
  try {
    const pageB = await contextB.newPage();
    collectProblems(pageB, problems);
    await pageB.goto(TRACKER_URL);
    await unlockTracker(pageB);

    await expect(page.getByTestId('takeover-banner')).toBeVisible();
    await expect(page.getByTestId('takeover-banner')).toContainText('Tracking moved to another device');
    await expect(page.getByTestId('take-over')).toHaveText('Take over');
    await expect(page.getByTestId('home-new')).toBeDisabled();
    await expect(pageB.getByTestId('takeover-banner')).toBeHidden();
    await expect(pageB.getByTestId('home-new')).toBeEnabled();

    await page.getByTestId('take-over').click();
    await expect(page.getByTestId('takeover-banner')).toBeHidden();
    await expect(page.getByTestId('home-new')).toBeEnabled();
    await expect(pageB.getByTestId('takeover-banner')).toBeVisible();
    await expect(pageB.getByTestId('home-new')).toBeDisabled();
  } finally {
    await contextB.close();
  }
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

  // Taking over from another device repairs it too.
  await update('control/tracker', { activeUid: 'another-device' });
  await expect(page.getByTestId('takeover-banner')).toBeVisible();
  await remove('stats/2026-27');
  await page.getByTestId('take-over').click();
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
