import { test, expect } from '@playwright/test';
import { closeAll, resetAll, seed, update } from './helpers.js';
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

test('subscriptions are restored when the page comes back from the back/forward cache', async ({ page }) => {
  // The Firestore SDK has its own pagehide handler that, in WebKit, shuts its listeners down when
  // it sees a synthetic event. Only the app's handlers should react to the replayed events.
  await page.addInitScript(() => {
    const add = window.addEventListener.bind(window);
    window.addEventListener = (type, listener, options) => {
      if (type === 'pagehide' && !new Error().stack.includes('tracker/app.js')) return;
      add(type, listener, options);
    };
  });
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await expect(page.getByTestId('takeover-banner')).toBeHidden();

  // Playwright cannot drive a real bfcache round trip, so replay its two events.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await update('control/tracker', { activeUid: 'another-device' });
  await page.waitForTimeout(500);
  await expect(page.getByTestId('takeover-banner')).toBeHidden();
  await expect(page.getByTestId('home-new')).toBeEnabled();

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.getByTestId('takeover-banner')).toBeVisible();
  await expect(page.getByTestId('home-new')).toBeDisabled();
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
