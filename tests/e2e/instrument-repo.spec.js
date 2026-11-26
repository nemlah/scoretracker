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

// The fail rules are exercised on the viewer's game screen. The retry module is blocked, so nothing
// reopens the listener on its own and the helper's behaviour is all that is seen.
test.describe('fail rules', () => {
  const roster = [{ id: 'p5', name: 'Alexiou', cap: 5, archived: false }];
  const lineup = [{ playerId: 'p5', name: 'Alexiou', cap: 5 }];
  const goal = (id, ts) => ({ id, type: 'goal', period: 1, ts, playerId: 'p5' });
  const seedGames = () => Promise.all([
    seed('team/main', { currentGameId: 'g1', roster }),
    ...['g1', 'g2'].map(id => seed(`games/${id}`, {
      opponent: `Opponent ${id}`, date: '2026-11-08', season: '2026-27', status: 'live', period: 1, lineup, events: [goal('e1', 1000)],
    })),
  ]);
  const serverSnaps = (page, path) => page.evaluate(
    p => (window.__snaps ?? []).filter(snap => snap.path === p && snap.fromCache === false).length, path,
  );
  const counter = (page, name, path) => page.evaluate(([n, p]) => window[n]?.[p] ?? 0, [name, path]);

  test.beforeEach(async ({ page }) => {
    await page.route('**/js/watchRetry.js', route => route.abort());
  });

  test('a fail rule ends a listener once after its first server snapshot, and later snapshots of that listener are dropped', async ({ page }) => {
    const warnings = [];
    page.on('console', message => { if (message.text().startsWith('Could not watch game')) warnings.push(message.text()); });
    await seedGames();
    await instrumentRepo(page, { 'games/g1': { fail: 1 } });
    await open(page, '#/game/g1');
    await expect.poll(() => counter(page, '__failures', 'games/g1')).toBe(1);
    // The listener delivered its first server snapshot before it failed, and the viewer was told once.
    expect(await serverSnaps(page, 'games/g1')).toBe(1);
    await expect(page.getByTestId('game-unavailable')).toBeVisible();
    expect(warnings).toHaveLength(1);
    expect(await counter(page, '__attempts', 'games/g1')).toBe(1);
    // A write the server pushes to the ended listener is dropped, not delivered.
    await update('games/g1', { events: [goal('e1', 1000), goal('e2', 1010)] });
    await expect.poll(() => counter(page, '__dropped', 'games/g1')).toBeGreaterThan(0);
    expect(await serverSnaps(page, 'games/g1')).toBe(1);
    expect(await counter(page, '__failures', 'games/g1')).toBe(1);
    await expect(page.getByTestId('game-unavailable')).toBeVisible();
    expect(warnings).toHaveLength(1);
  });

  test('holdReopen holds the reopened listener\'s first server answer', async ({ page }) => {
    await seedGames();
    await instrumentRepo(page, { 'games/g1': { fail: 1, holdReopen: true } });
    await open(page, '#/game/g1');
    await expect.poll(() => counter(page, '__failures', 'games/g1')).toBe(1);
    // The next watch() call on the path is the reopen. Routing to another game makes one: g1 is the current
    // game, so the viewer then watches it as the live game.
    await page.evaluate(() => { location.hash = '#/game/g2'; });
    await expect.poll(() => counter(page, '__attempts', 'games/g1')).toBe(2);
    await expect.poll(() => counter(page, '__queued', 'games/g1')).toBe(1);
    // The reopened listener's server answer is on hold, not delivered: only the first listener's is on record.
    expect(await serverSnaps(page, 'games/g1')).toBe(1);
    expect(await counter(page, '__failures', 'games/g1')).toBe(1);
    await page.evaluate(() => window.__releaseHeld('games/g1'));
    expect(await serverSnaps(page, 'games/g1')).toBe(2);
    expect(await counter(page, '__failures', 'games/g1')).toBe(1);
  });
});
