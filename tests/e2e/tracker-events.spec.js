import { test, expect } from '@playwright/test';
import { seasonFor, todayIso, formatDate } from '../../js/model.js';
import { closeAll, get, resetAll, seed, update } from './helpers.js';
import { CODE, TRACKER_URL, collectProblems, dropNetworkNoise, unlockTracker } from './tracker-helpers.js';

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

async function endGameFromSheet(page) {
  await openEvents(page);
  await page.getByTestId('end-game').click();
  await expect(page.getByTestId('end-game')).toHaveText('Tap again to confirm');
  await page.getByTestId('end-game').click();
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
  await page.getByTestId('end-game').click();
  await page.getByTestId('end-game').click();

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
  await page.getByTestId('delete-game').click();
  await expect(page.getByTestId('delete-game')).toHaveText('Tap again to confirm');
  await page.getByTestId('delete-game').click();
  await expect(page.getByTestId('games-empty')).toBeVisible();
  await expect.poll(async () => (await get('team/main')).currentGameId).toBeNull();
  await expect.poll(async () => (await get(`stats/${SEASON}`)).results).toEqual([]);
  expect((await get(`stats/${SEASON}`)).players).toEqual({});
  await withViewer(browser, async viewer => {
    await expect(viewer.getByTestId('empty-state')).toBeVisible();
  });
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
  await page.goto(TRACKER_URL);
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
