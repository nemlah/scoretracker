import { test, expect } from '@playwright/test';
import { seasonFor, todayIso, formatDate } from '../../js/model.js';
import { closeAll, get, resetAll, seed, update } from './helpers.js';
import { CODE, HOME_URL, TRACKER_URL, collectProblems, dropNetworkNoise, unlockTracker } from './tracker-helpers.js';

const ORIGIN = 'http://127.0.0.1:4173';
const SEASON = seasonFor(todayIso());
const roster = [
  { id: 'p2', name: 'Papadakis', cap: 2, archived: false },
  { id: 'p5', name: 'Alexiou', cap: 5, archived: false },
  { id: 'p7', name: 'Georgiou', cap: 7, archived: false },
];

let problems;
test.beforeEach(async ({ page }) => {
  problems = [];
  collectProblems(page, problems);
  await resetAll();
  await seed('secrets/editCode', { code: CODE });
  await seed('team/main', { roster });
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});
test.afterAll(closeAll);

const tile = (page, cap) => page.locator(`[data-testid="tile"][data-cap="${cap}"]`);
const sheet = page => page.getByTestId('events-sheet');
const luRow = (page, id) => page.locator(`[data-testid="lu-row"][data-player-id="${id}"]`);
const journalOf = page => page.evaluate(() => localStorage.getItem('wp-journal'));
const dirtyOf = page => page.evaluate(() => localStorage.getItem('wp-stats-dirty'));

async function currentGameId() {
  await expect.poll(async () => (await get('team/main'))?.currentGameId).toBeTruthy();
  return (await get('team/main')).currentGameId;
}

async function startGame(page, { skip = [] } = {}) {
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await page.getByTestId('home-new').click();
  await expect(page.getByTestId('start-game')).toBeVisible();
  await page.getByTestId('opponent-input').fill('Opponent FC');
  for (const id of skip) await page.locator(`[data-testid="sel-row"][data-player-id="${id}"]`).getByTestId('sel-check').uncheck();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('score-us')).toHaveText('0');
  await currentGameId();
}

async function goals(page, caps) {
  for (const cap of caps) await tile(page, cap).getByTestId('tile-goal').click();
  await expect(page.getByTestId('score-us')).toHaveText(String(caps.length));
}

async function openEvents(page) {
  await page.getByTestId('events-open').click();
  await expect(sheet(page)).toBeVisible();
}

// A confirming tap right after arming counts as a double tap and is ignored, so wait it out.
async function armThenConfirm(page, testid) {
  const button = page.getByTestId(testid);
  await button.click();
  await expect(button).toHaveText('Tap again to confirm');
  await page.waitForTimeout(700);
  await button.click();
}

async function endGameFromSheet(page) {
  await openEvents(page);
  await armThenConfirm(page, 'end-game');
}

async function withViewer(browser, fn) {
  const context = await browser.newContext({ baseURL: ORIGIN });
  try {
    const viewer = await context.newPage();
    collectProblems(viewer, problems);
    await viewer.goto('/index.html?emulator=1');
    await fn(viewer);
  } finally {
    await context.close();
  }
}

test('delete an earlier event', async ({ page, browser }) => {
  await startGame(page);
  await goals(page, [2, 5, 7]);
  await openEvents(page);
  // Focus moves into the dialog; newest event first.
  await expect(page.locator('[data-testid="events-sheet"]:focus-within')).toHaveCount(1);
  await expect(sheet(page)).toHaveAttribute('role', 'dialog');
  await expect(page.getByTestId('ev-row')).toHaveCount(3);
  await expect(page.getByTestId('ev-row').first()).toContainText('Georgiou');
  await expect(page.getByTestId('ev-row').last()).toContainText('Papadakis');
  await page.getByTestId('ev-row').last().getByTestId('ev-delete').click();
  await expect(page.getByTestId('ev-row')).toHaveCount(2);
  await expect(page.getByTestId('score-us')).toHaveText('2');
  await expect(tile(page, 2).getByTestId('tile-goals')).toHaveText('0');
  await expect.poll(() => journalOf(page)).toBe('[]');
  await withViewer(browser, async viewer => {
    await expect(viewer.getByTestId('score-us')).toHaveText('2');
    await expect(viewer.getByTestId('timeline-item')).toHaveCount(2);
  });
  // Escape closes the sheet and focus goes back to the button that opened it.
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeHidden();
  await expect(page.getByTestId('events-open')).toBeFocused();
  await openEvents(page);
  await page.getByTestId('events-close').click();
  await expect(sheet(page)).toBeHidden();
});

test('scorer-unknown goal, then assign scorer', async ({ page }) => {
  await startGame(page);
  await openEvents(page);
  await page.getByTestId('add-unknown-goal').click();
  await expect(page.getByTestId('score-us')).toHaveText('1');
  for (const goalsText of await page.getByTestId('tile-goals').allTextContents()) expect(goalsText).toBe('0');
  await expect(page.getByTestId('ev-row')).toHaveCount(1);
  await expect(page.getByTestId('ev-scorer')).toHaveValue('');
  await page.getByTestId('ev-scorer').selectOption('p5');
  await expect(tile(page, 5).getByTestId('tile-goals')).toHaveText('1');
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await expect.poll(() => journalOf(page)).toBe('[]');
  await expect(page.getByTestId('failed-banner')).toBeHidden();
  const game = await get(`games/${await currentGameId()}`);
  expect(game.events).toHaveLength(1);
  expect(game.events[0].playerId).toBe('p5');
  // And back to unknown.
  await page.getByTestId('ev-scorer').selectOption('');
  await expect(tile(page, 5).getByTestId('tile-goals')).toHaveText('0');
  await expect.poll(async () => (await get(`games/${await currentGameId()}`)).events[0].playerId).toBeUndefined();
  await expect.poll(() => journalOf(page)).toBe('[]');
});

test('lineup: add forgotten player and swap caps mid-game', async ({ page }) => {
  await startGame(page, { skip: ['p7'] });
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await goals(page, [5]);
  await openEvents(page);
  await page.getByTestId('open-lineup').click();
  await expect(page.getByTestId('lineup-sheet')).toBeVisible();
  await expect(page.getByTestId('lu-row')).toHaveCount(2);
  // Alexiou scored, so he cannot be removed; Papadakis can.
  await expect(luRow(page, 'p5').getByTestId('lu-remove')).toHaveCount(0);
  await expect(luRow(page, 'p2').getByTestId('lu-remove')).toHaveCount(1);

  await page.getByTestId('lu-add').selectOption('p7');
  await expect(page.getByTestId('lu-row')).toHaveCount(3);
  await expect(luRow(page, 'p7').getByTestId('lu-cap')).toHaveValue('7');
  // Giving Alexiou cap 2 swaps it with Papadakis.
  await luRow(page, 'p5').getByTestId('lu-cap').fill('2');
  await expect(luRow(page, 'p2').getByTestId('lu-cap')).toHaveValue('5');
  // A clashing cap blocks saving.
  await luRow(page, 'p7').getByTestId('lu-cap').fill('2');
  await expect(luRow(page, 'p5').getByTestId('lu-cap')).toHaveValue('7');
  await luRow(page, 'p7').getByTestId('lu-cap').fill('');
  await expect(page.getByTestId('lu-save')).toBeDisabled();
  await luRow(page, 'p7').getByTestId('lu-cap').fill('7');
  await luRow(page, 'p5').getByTestId('lu-cap').fill('2');
  await expect(page.getByTestId('lu-save')).toBeEnabled();
  await page.getByTestId('lu-save').click();
  await expect(page.getByTestId('lineup-sheet')).toBeHidden();

  await expect(page.getByTestId('tile')).toHaveCount(3);
  await expect(tile(page, 7)).toContainText('Georgiou');
  await expect(tile(page, 2)).toContainText('Alexiou');
  await expect(tile(page, 5)).toContainText('Papadakis');
  await expect(tile(page, 2).getByTestId('tile-goals')).toHaveText('1');
  const saved = await get('team/main');
  expect(saved.roster.find(player => player.id === 'p5').cap).toBe(2);
  const game = await get(`games/${await currentGameId()}`);
  expect(game.lineup.map(player => [player.playerId, player.cap]).sort()).toEqual([['p2', 5], ['p5', 2], ['p7', 7]]);

  // A player without events can be taken out again.
  await page.getByTestId('open-lineup').click();
  await luRow(page, 'p7').getByTestId('lu-remove').click();
  await expect(page.getByTestId('lu-row')).toHaveCount(2);
  await page.getByTestId('lu-save').click();
  await expect(page.getByTestId('tile')).toHaveCount(2);
});

test('Escape closes only the topmost dialog and focus goes back to what opened it', async ({ page }) => {
  await startGame(page);
  await openEvents(page);
  await page.getByTestId('open-lineup').click();
  await expect(page.locator('[data-testid="lineup-sheet"]:focus-within')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('lineup-sheet')).toBeHidden();
  await expect(sheet(page)).toBeVisible();
  await expect(page.getByTestId('open-lineup')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeHidden();
});

test('previous period from the sheet', async ({ page }) => {
  await startGame(page);
  await openEvents(page);
  await expect(page.getByTestId('period-prev')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByTestId('period-next').click();
  await expect(page.getByTestId('period-next')).toHaveText('Q2');
  await expect(page.getByTestId('period-next')).toBeEnabled();
  await page.getByTestId('period-next').click();
  await expect(page.getByTestId('period-next')).toHaveText('Q3');
  await openEvents(page);
  await page.getByTestId('period-prev').click();
  await expect(page.getByTestId('period-next')).toHaveText('Q2');
  await expect.poll(async () => (await get(`games/${await currentGameId()}`)).period).toBe(2);
});

test('a double tap on the period button advances one period only', async ({ page }) => {
  await startGame(page);
  await page.getByTestId('period-next').dblclick();
  await expect(page.getByTestId('period-next')).toHaveText('Q2');
  await page.waitForTimeout(400);
  await expect(page.getByTestId('period-next')).toHaveText('Q2');
  await expect(page.getByTestId('period-next')).toBeDisabled();
  await expect(page.getByTestId('period-next')).toBeEnabled();
  await page.getByTestId('period-next').click();
  await expect(page.getByTestId('period-next')).toHaveText('Q3');
});

test('end game needs a second tap; viewer shows Final and season stats', async ({ page, browser }) => {
  await startGame(page);
  await goals(page, [5, 2]);
  await page.getByTestId('opp-goal').click();
  await expect(page.getByTestId('score-them')).toHaveText('1');
  await openEvents(page);
  await page.getByTestId('end-game').click();
  await expect(page.getByTestId('end-game')).toHaveText('Tap again to confirm');
  await expect(page.getByTestId('end-game')).toHaveClass(/is-armed/);
  expect((await get(`games/${await currentGameId()}`)).status).toBe('live');
  // The armed state lapses after a few seconds.
  await expect(page.getByTestId('end-game')).toHaveText('End game', { timeout: 6000 });
  await expect(page.getByTestId('end-game')).not.toHaveClass(/is-armed/);
  await armThenConfirm(page, 'end-game');

  await expect(page.getByTestId('home-new')).toBeVisible();
  await expect(page.getByTestId('home-resume')).toBeHidden();
  await expect.poll(async () => (await get(`games/${await currentGameId()}`)).status).toBe('final');
  await expect.poll(async () => (await get(`stats/${SEASON}`))?.results?.length).toBe(1);
  const stats = await get(`stats/${SEASON}`);
  expect(stats.results[0]).toMatchObject({ us: 2, them: 1, opponent: 'Opponent FC' });
  expect(stats.players.p5).toMatchObject({ games: 1, goals: 1 });
  await expect.poll(() => dirtyOf(page)).toBe('[]');
  await withViewer(browser, async viewer => {
    await expect(viewer.getByTestId('final-badge')).toBeVisible();
    await expect(viewer.getByTestId('result-row')).toHaveCount(1);
    await expect(viewer.getByTestId('season-row')).toHaveCount(3);
  });
});

test('past games: reopen then delete', async ({ page, browser }) => {
  await startGame(page);
  await goals(page, [5]);
  await endGameFromSheet(page);
  await expect(page.getByTestId('home-new')).toBeVisible();
  await expect.poll(async () => (await get(`stats/${SEASON}`))?.results?.length).toBe(1);

  await page.getByTestId('home-games').click();
  await expect(page.getByTestId('game-row')).toHaveCount(1);
  await expect(page.getByTestId('game-row')).toContainText(formatDate(todayIso()));
  await expect(page.getByTestId('game-row')).toContainText('Opponent FC');
  await expect(page.getByTestId('game-row')).toContainText('1 – 0');
  await page.getByTestId('game-row').click();

  // Reopening puts it back on the live screen and takes it out of the season stats.
  await expect(page.getByTestId('reopen-game')).toBeEnabled();
  await page.getByTestId('reopen-game').click();
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await expect(page.getByTestId('tile')).toHaveCount(3);
  await expect.poll(async () => (await get(`stats/${SEASON}`))?.results?.length).toBe(0);

  // End it again, then delete it from the history.
  await endGameFromSheet(page);
  await expect(page.getByTestId('home-new')).toBeVisible();
  await expect.poll(async () => (await get(`stats/${SEASON}`))?.results?.length).toBe(1);
  await page.getByTestId('home-games').click();
  await page.getByTestId('game-row').click();
  await armThenConfirm(page, 'delete-game');
  await expect(page.getByTestId('games-empty')).toBeVisible();
  await expect.poll(async () => (await get('team/main')).currentGameId).toBeNull();
  await expect.poll(async () => (await get(`stats/${SEASON}`)).results).toEqual([]);
  expect((await get(`stats/${SEASON}`)).players).toEqual({});
  await withViewer(browser, async viewer => {
    await expect(viewer.getByTestId('empty-state')).toBeVisible();
  });
});

test('a double tap does not delete a game; a later second tap does', async ({ page }) => {
  await startGame(page);
  await goals(page, [5]);
  await endGameFromSheet(page);
  await expect(page.getByTestId('home-new')).toBeVisible();
  await page.getByTestId('home-games').click();
  await page.getByTestId('game-row').click();
  const button = page.getByTestId('delete-game');
  await button.dblclick();
  await expect(button).toHaveText('Tap again to confirm');
  await expect(button).toHaveClass(/is-armed/);
  await page.waitForTimeout(500);
  await expect(page.getByTestId('game-meta')).toBeVisible();
  expect((await get(`games/${await currentGameId()}`)).status).toBe('final');
  // Still armed: a deliberate tap inside the window goes through.
  await page.waitForTimeout(300);
  await button.click();
  await expect(page.getByTestId('games-empty')).toBeVisible();
  await expect.poll(async () => (await get('team/main')).currentGameId).toBeNull();
});

test('a double tap does not end a game; a later second tap does', async ({ page }) => {
  await startGame(page);
  await goals(page, [5]);
  await openEvents(page);
  const button = page.getByTestId('end-game');
  await button.dblclick();
  await expect(button).toHaveText('Tap again to confirm');
  await page.waitForTimeout(500);
  await expect(button).toBeVisible();
  expect((await get(`games/${await currentGameId()}`)).status).toBe('live');
  await page.waitForTimeout(300);
  await button.click();
  await expect(page.getByTestId('home-new')).toBeVisible();
  await expect.poll(async () => (await get(`games/${await currentGameId()}`)).status).toBe('final');
});

test('correcting a past game updates the season stats', async ({ page }) => {
  await startGame(page);
  await goals(page, [5, 2]);
  await endGameFromSheet(page);
  await expect(page.getByTestId('home-new')).toBeVisible();
  await expect.poll(async () => (await get(`stats/${SEASON}`))?.results?.[0]?.us).toBe(2);

  await page.getByTestId('home-games').click();
  await page.getByTestId('game-row').click();
  // The events list is inline on the detail view, not a dialog.
  await expect(page.getByTestId('ev-row')).toHaveCount(2);
  await expect(page.getByTestId('events-sheet')).toHaveCount(0);
  await expect(page.getByTestId('end-game')).toBeHidden();
  await page.getByTestId('ev-row').last().getByTestId('ev-delete').click();
  await expect(page.getByTestId('ev-row')).toHaveCount(1);
  await expect.poll(async () => (await get(`stats/${SEASON}`)).results[0].us).toBe(1);
  expect((await get(`stats/${SEASON}`)).players).toMatchObject({ p5: { goals: 0 }, p2: { goals: 1 } });
  await expect.poll(() => journalOf(page)).toBe('[]');

  // Fixing the lineup of a final game is a correction too.
  await page.getByTestId('open-lineup').click();
  await luRow(page, 'p7').getByTestId('lu-remove').click();
  await page.getByTestId('lu-save').click();
  await expect(page.getByTestId('lineup-sheet')).toBeHidden();
  await expect.poll(async () => Object.keys((await get(`stats/${SEASON}`)).players).sort()).toEqual(['p2', 'p5']);
  await expect.poll(() => dirtyOf(page)).toBe('[]');
});

test('reopen is disabled while another game is live', async ({ page }) => {
  await seed('team/main', { roster, currentGameId: 'g2' });
  const lineup = [{ playerId: 'p5', name: 'Alexiou', cap: 5 }];
  await seed('games/g1', { opponent: 'Old FC', date: '2026-10-01', season: '2026-27', status: 'final', period: 4, lineup, events: [] });
  await seed('games/g2', { opponent: 'New FC', date: '2026-11-01', season: '2026-27', status: 'live', period: 1, lineup, events: [] });
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await page.getByTestId('home-games').click();
  await expect(page.getByTestId('game-row')).toHaveCount(2);
  await expect(page.getByTestId('game-row').first()).toContainText('01/11/2026');
  await page.getByTestId('game-row').nth(1).click();
  await expect(page.getByTestId('reopen-game')).toBeDisabled();
  await expect(page.getByTestId('reopen-note')).toBeVisible();
});

test('sheet controls are disabled while another device is tracking', async ({ page }) => {
  await startGame(page);
  await goals(page, [5]);
  await openEvents(page);
  await update('control/tracker', { activeUid: 'another-device' });
  await expect(page.getByTestId('takeover-banner')).toBeVisible();
  await expect(page.getByTestId('ev-delete')).toBeDisabled();
  await expect(page.getByTestId('ev-scorer')).toBeDisabled();
  await expect(page.getByTestId('add-unknown-goal')).toBeDisabled();
  await expect(page.getByTestId('end-game')).toBeDisabled();
  await expect(page.getByTestId('open-lineup')).toBeEnabled();
});

test('ending a game offline is saved, and the season stats follow once back online', async ({ page, context }) => {
  await startGame(page);
  await goals(page, [5]);
  await expect.poll(async () => (await get(`games/${await currentGameId()}`)).events.length).toBe(1);
  await context.setOffline(true);
  await expect(page.getByTestId('sync-status')).toHaveText('offline — taps saved, will sync');
  await endGameFromSheet(page);
  await expect(page.getByTestId('home-new')).toBeVisible();
  // The season is remembered as needing a recount while the write waits for the network.
  await expect.poll(() => dirtyOf(page)).toBe(JSON.stringify([SEASON]));
  await context.setOffline(false);
  await expect.poll(async () => (await get(`games/${await currentGameId()}`)).status).toBe('final');
  await expect.poll(async () => (await get(`stats/${SEASON}`))?.results?.length, { timeout: 15000 }).toBe(1);
  await expect.poll(() => dirtyOf(page)).toBe('[]');
  dropNetworkNoise(problems);
});

const lineupP5 = [{ playerId: 'p5', name: 'Alexiou', cap: 5 }];
async function seedTwoGames() {
  await seed('team/main', { roster, currentGameId: 'g2' });
  await seed('games/g1', { opponent: 'Old FC', date: '2026-10-01', season: '2026-27', status: 'final', period: 4, lineup: lineupP5, events: [] });
  await seed('games/g2', { opponent: 'New FC', date: '2026-11-01', season: '2026-27', status: 'live', period: 1, lineup: lineupP5, events: [] });
}

test('retrying an unsaved correction on a past game recounts the season', async ({ page }) => {
  await seedTwoGames();
  const lost = { id: 'lost-goal', type: 'goal', period: 1, ts: 1000, playerId: 'p5' };
  await page.addInitScript(planted => {
    if (sessionStorage.getItem('planted') === null) {
      sessionStorage.setItem('planted', '1');
      localStorage.setItem('wp-journal', planted);
    }
  }, JSON.stringify([{ id: 'entry-0', gameId: 'g1', op: 'add', status: 'failed', event: lost }]));
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await page.getByTestId('home-games').click();
  await page.getByTestId('game-row').filter({ hasText: 'Old FC' }).click();
  await expect(page.getByTestId('failed-banner')).toContainText('1 tap not saved');
  await expect(page.getByTestId('failed-game-link')).toHaveAttribute('href', '#/games/g1');
  await page.getByTestId('retry-failed').click();
  await expect(page.getByTestId('failed-banner')).toBeHidden();
  await expect.poll(async () => (await get('games/g1')).events.length).toBe(1);
  await expect.poll(async () => (await get(`stats/${SEASON}`))?.results?.find(result => result.gameId === 'g1')?.us).toBe(1);
  await expect.poll(() => journalOf(page)).toBe('[]');
  await expect.poll(() => dirtyOf(page)).toBe('[]');
});

test('deleting a past game leaves the live game current', async ({ page }) => {
  await seedTwoGames();
  await seed('games/g0', { opponent: 'Newest FC', date: '2026-11-10', season: '2026-27', status: 'final', period: 4, lineup: lineupP5, events: [] });
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await page.getByTestId('home-games').click();
  await page.getByTestId('game-row').filter({ hasText: 'Old FC' }).click();
  await armThenConfirm(page, 'delete-game');
  await expect(page.getByTestId('game-row')).toHaveCount(2);
  expect((await get('team/main')).currentGameId).toBe('g2');
  await page.getByTestId('nav-home').click();
  await expect(page.getByTestId('home-resume')).toBeVisible();
});

test('the live screen link on a live game detail is a full-size button', async ({ page }) => {
  await seedTwoGames();
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await page.getByTestId('home-games').click();
  await page.getByTestId('game-row').filter({ hasText: 'New FC' }).click();
  const link = page.getByTestId('game-live-open');
  await expect(link).toBeVisible();
  expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await link.click();
  await expect(page.getByTestId('score-us')).toHaveText('0');
});

test('a past game\'s opponent, date and season can be corrected, and both seasons are recounted', async ({ page }) => {
  await seedTwoGames();
  await seed('games/g1', {
    opponent: 'Old FC', date: '2026-10-01', season: '2026-27', status: 'final', period: 4, lineup: lineupP5,
    events: [{ id: 'goal-1', type: 'goal', period: 1, ts: 1000, playerId: 'p5' }],
  });
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await expect.poll(async () => (await get('stats/2026-27'))?.results?.map(result => result.gameId)).toEqual(['g1']);
  await page.getByTestId('home-games').click();
  await page.getByTestId('game-row').filter({ hasText: 'Old FC' }).click();
  await expect(page.getByTestId('game-meta')).toHaveText('01/10/2026 · 2026-27');
  await expect(page.getByTestId('info-opponent')).toHaveValue('Old FC');
  await expect(page.getByTestId('info-date')).toHaveValue('2026-10-01');
  await expect(page.getByTestId('info-season')).toHaveValue('2026-27');

  // A season that is not YYYY-YY is refused and nothing is written.
  await page.getByTestId('info-season').fill('2026');
  await page.getByTestId('info-save').click();
  await expect(page.getByTestId('info-error')).toContainText('Season must look like');
  expect((await get('games/g1')).season).toBe('2026-27');

  await page.getByTestId('info-opponent').fill('Harbour WPC');
  await page.getByTestId('info-date').fill('2026-07-01');
  // The season follows the date until it has been edited by hand; here it was, so set it explicitly.
  await page.getByTestId('info-season').fill('2025-26');
  await page.getByTestId('info-save').click();
  await expect(page.getByTestId('game-meta')).toHaveText('01/07/2026 · 2025-26');
  await expect(page.getByTestId('info-error')).toBeHidden();
  await expect.poll(async () => (await get('games/g1')).opponent).toBe('Harbour WPC');
  expect(await get('games/g1')).toMatchObject({ date: '2026-07-01', season: '2025-26', status: 'final' });
  // The old season loses the game, the new one gains it.
  await expect.poll(async () => (await get('stats/2026-27')).results).toEqual([]);
  await expect.poll(async () => (await get('stats/2025-26'))?.results?.map(result => result.opponent)).toEqual(['Harbour WPC']);
  await expect.poll(() => dirtyOf(page)).toBe('[]');
});

test('a goal with an unknown scorer added to a past game asks for the period, defaulting to Q4', async ({ page }) => {
  await seedTwoGames();
  await seed('games/g1', {
    opponent: 'Old FC', date: '2026-10-01', season: '2026-27', status: 'final', period: 'SO', lineup: lineupP5, events: [],
  });
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await page.getByTestId('home-games').click();
  await page.getByTestId('game-row').filter({ hasText: 'Old FC' }).click();
  const choice = page.getByTestId('add-goal-period');
  await expect(choice).toBeVisible();
  await expect(choice).toHaveValue('4');
  await page.getByTestId('add-unknown-goal').click();
  await expect.poll(async () => (await get('games/g1')).events.map(event => event.period)).toEqual([4]);
  await choice.selectOption('2');
  await page.getByTestId('add-unknown-goal').click();
  await expect.poll(async () => (await get('games/g1')).events.map(event => event.period).sort()).toEqual([2, 4]);
  await expect.poll(async () => (await get(`stats/${SEASON}`))?.results?.find(result => result.gameId === 'g1')?.us).toBe(2);
});

test('the period choice is not offered while the game is live', async ({ page }) => {
  await startGame(page);
  await openEvents(page);
  await expect(page.getByTestId('add-unknown-goal')).toBeVisible();
  await expect(page.getByTestId('add-goal-period')).toBeHidden();
});

const evRow = (page, label) => page.getByTestId('ev-row').filter({ has: page.locator('.ev-label', { hasText: label }) });
const manUpBox = page => sheet(page).getByTestId('ev-manup');
const figures = page => page.getByTestId('live-situations');

// A live game written straight to the server, resumed through Home so the unlock step still works.
async function openSeeded(page, game) {
  await seed('team/main', { roster, currentGameId: 'g1' });
  await seed('games/g1', {
    opponent: 'Seeded FC', date: '2026-11-01', season: '2026-27', status: 'live', period: 1,
    lineup: roster.map(player => ({ playerId: player.id, name: player.name, cap: player.cap })), ...game,
  });
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await page.getByTestId('home-resume').click();
  await expect(page.getByTestId('score-us')).toBeVisible();
}

test('Man-up goal switch adds and removes a man-up for that goal', async ({ page }) => {
  await startGame(page);
  await goals(page, [5]);
  const gameId = await currentGameId();
  const eventsOf = async () => (await get(`games/${gameId}`)).events;
  await expect(figures(page)).toHaveText('MU 0/0 · MD 0/0');
  await openEvents(page);
  await expect(manUpBox(page)).not.toBeChecked();
  await manUpBox(page).check();
  await expect.poll(async () => (await eventsOf()).filter(event => event.type === 'manUp').length).toBe(1);
  const events = await eventsOf();
  const goal = events.find(event => event.type === 'goal');
  expect(events.find(event => event.type === 'manUp').ts).toBe(goal.ts - 1);
  await expect(figures(page)).toHaveText('MU 1/1 · MD 0/0');
  await expect(manUpBox(page)).toBeChecked();
  await expect(evRow(page, 'Man-up')).toHaveCount(1);

  await manUpBox(page).uncheck();
  await expect.poll(async () => (await eventsOf()).filter(event => event.type === 'manUp').length).toBe(0);
  await expect(figures(page)).toHaveText('MU 0/0 · MD 0/0');
  await expect(manUpBox(page)).not.toBeChecked();
});

test('switching off a live-tapped man-up goal counts the man-up as missed', async ({ page }) => {
  await startGame(page);
  await page.getByTestId('situation').click();
  await expect(page.getByTestId('situation')).toHaveAttribute('data-state', 'manUp');
  await goals(page, [5]);
  await expect(figures(page)).toHaveText('MU 1/1 · MD 0/0');
  const gameId = await currentGameId();
  await openEvents(page);
  await expect(manUpBox(page)).toBeChecked();
  await manUpBox(page).uncheck();
  await expect.poll(async () => (await get(`games/${gameId}`)).events.filter(event => event.type === 'manUpEnd').length).toBe(1);
  const events = (await get(`games/${gameId}`)).events;
  const goal = events.find(event => event.type === 'goal');
  expect(events.find(event => event.type === 'manUpEnd').ts).toBe(goal.ts - 1);
  expect(events.filter(event => event.type === 'manUp')).toHaveLength(1);
  await expect(figures(page)).toHaveText('MU 0/1 · MD 0/0');
  await expect(manUpBox(page)).not.toBeChecked();
});

test('penalty fouls and situation events are labelled and deletable', async ({ page }) => {
  const now = Date.now();
  await openSeeded(page, {
    situations: true,
    events: [
      { id: 'e1', type: 'pen', period: 1, ts: now - 5000, playerId: 'p2' },
      { id: 'e2', type: 'manUp', period: 1, ts: now - 4000 },
      { id: 'e3', type: 'manUpEnd', period: 1, ts: now - 3000 },
    ],
  });
  await openEvents(page);
  await expect(evRow(page, 'Penalty foul · #2 Papadakis')).toHaveCount(1);
  await expect(evRow(page, /^Man-up$/)).toHaveCount(1);
  await expect(evRow(page, 'End man-up · no goal')).toHaveCount(1);
  await evRow(page, /^Man-up$/).getByTestId('ev-delete').click();
  await expect(evRow(page, /^Man-up$/)).toHaveCount(0);
  await expect.poll(async () => (await get('games/g1')).events.map(event => event.id).sort()).toEqual(['e1', 'e3']);
});

test('no Man-up goal switch on untracked games or shootout goals', async ({ page }) => {
  await openSeeded(page, { events: [{ id: 'g', type: 'goal', period: 1, ts: Date.now() - 1000, playerId: 'p5' }] });
  await openEvents(page);
  await expect(page.getByTestId('ev-row')).toHaveCount(1);
  await expect(manUpBox(page)).toBeHidden();
  await sheet(page).getByTestId('events-close').click();
  await update('games/g1', {
    situations: true,
    events: [
      { id: 'g', type: 'goal', period: 1, ts: Date.now() - 1000, playerId: 'p5' },
      { id: 's', type: 'goal', period: 'SO', ts: Date.now() - 500, playerId: 'p5' },
    ],
  });
  await openEvents(page);
  await expect(page.getByTestId('ev-row')).toHaveCount(2);
  await expect(page.getByTestId('ev-row').filter({ hasText: 'Shootout' }).getByTestId('ev-manup')).toBeHidden();
  await expect(page.getByTestId('ev-row').filter({ hasText: 'Q1' }).getByTestId('ev-manup')).toBeVisible();
});
