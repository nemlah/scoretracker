import { test, expect } from '@playwright/test';
import { closeAll, instrumentRepo, resetAll, seed, update } from './helpers.js';

// The test helper itself: a held path keeps the order of its snapshots.
test.use({ serviceWorkers: 'block' });
test.beforeEach(resetAll);
test.afterAll(closeAll);

test('a snapshot that arrives while another of its path is held is delivered after it, in order', async ({ page }) => {
  await seed('team/main', { currentGameId: 'g1', roster: [] });
  await instrumentRepo(page, { 'team/main': { miss: true, holdMs: 3000 } });
  await page.goto('/index.html?emulator=1');
  // The viewer is up and asking: the held server snapshot (g1) is still pending, so nothing is recorded yet.
  await expect(page.getByTestId('games-list')).toBeVisible();
  expect(await page.evaluate(() => window.__snaps?.filter(snap => snap.path === 'team/main') ?? [])).toEqual([]);
  // The server's next snapshot (g2) arrives during the hold.
  await update('team/main', { currentGameId: 'g2' });
  await page.waitForFunction(() => window.__snaps?.some(snap => snap.path === 'team/main' && snap.pointer === 'g2'),
    null, { timeout: 8000 });
  const order = await page.evaluate(() => window.__snaps.filter(snap => snap.path === 'team/main').map(snap => snap.pointer));
  expect(order).toEqual(['g1', 'g2']);
});
