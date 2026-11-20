import { test, expect } from './fixtures.js';
import { closeAll, instrumentRepo, open, resetAll, seed, update } from './helpers.js';

// The test helper itself: a held path keeps the order of its snapshots.
test.use({ serviceWorkers: 'block' });
test.beforeEach(resetAll);
test.afterAll(closeAll);

test('a snapshot that arrives while another of its path is held is delivered after it, in order', async ({ page }) => {
  await seed('team/main', { currentGameId: 'g1', roster: [] });
  await instrumentRepo(page, { 'team/main': { miss: true, hold: true } });
  await open(page);
  await expect(page.getByTestId('games-list')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__queued?.['team/main'])).toBe(1);
  // The server's next snapshot (g2) arrives during the hold.
  await update('team/main', { currentGameId: 'g2' });
  await expect.poll(() => page.evaluate(() => window.__queued?.['team/main'])).toBe(2);
  const deliveredPointers = () => page.evaluate(() => (window.__snaps ?? [])
    .filter(snap => snap.path === 'team/main' && !snap.fromCache).map(snap => snap.pointer));
  expect(await deliveredPointers()).toEqual([]);
  await page.evaluate(() => window.__releaseHeld('team/main'));
  expect(await deliveredPointers()).toEqual(['g1', 'g2']);
});
