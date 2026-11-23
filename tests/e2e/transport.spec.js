import { test, expect } from './fixtures.js';
import { closeAll, open, resetAll, seed } from './helpers.js';
import { CODE, HOME_URL, collectProblems, unlockTracker } from './tracker-helpers.js';

let problems;
test.beforeEach(async ({ page }) => {
  problems = [];
  collectProblems(page, problems);
  await resetAll();
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});
test.afterAll(closeAll);

function recordListenGets(page) {
  const urls = [];
  page.on('request', request => {
    const url = request.url();
    if (request.method() === 'GET' && url.includes('/Listen/channel')) urls.push(url);
  });
  return urls;
}

async function expectLongPolling(urls) {
  await expect.poll(() => urls.length).toBeGreaterThanOrEqual(2);
  for (const url of urls) {
    expect(new URL(url).searchParams.get('CI')).toBe('1');
  }
}

test('viewer uses long-polling for Firestore listens', async ({ page }) => {
  await seed('team/main', { roster: [] });
  const urls = recordListenGets(page);
  await open(page);
  await expect(page.getByTestId('results-empty')).toBeVisible();
  await expectLongPolling(urls);
});

test('tracker uses long-polling for Firestore listens', async ({ page }) => {
  await seed('secrets/editCode', { code: CODE });
  await seed('team/main', { roster: [] });
  const urls = recordListenGets(page);
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await expectLongPolling(urls);
});
