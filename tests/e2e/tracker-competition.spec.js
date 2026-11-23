import { test, expect } from './fixtures.js';
import { aggregateSeason } from '../../js/model.js';
import { closeAll, get, resetAll, seed, update } from './helpers.js';
import { CODE, HOME_URL, TRACKER_URL, collectProblems, unlockTracker } from './tracker-helpers.js';

const roster = [
  { id: 'p2', name: 'Papadakis', cap: 2, archived: false },
  { id: 'p5', name: 'Alexiou', cap: 5, archived: false },
];
const lineupP5 = [{ playerId: 'p5', name: 'Alexiou', cap: 5 }];
const goal = id => ({ id, type: 'goal', period: 1, ts: 1000, playerId: 'p5' });
// 40 characters, no break opportunity, Greek.
const LONG_NAME = 'Τουρνουά'.repeat(5);

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

const select = page => page.getByTestId('competition-select');
const nameInput = page => page.getByTestId('competition-name-input');

async function currentGameId() {
  await expect.poll(async () => (await get('team/main'))?.currentGameId).toBeTruthy();
  return (await get('team/main')).currentGameId;
}

// Details step to the live screen. `choose` runs on the details step before Next.
async function startFromNewGame(page, choose) {
  await page.getByTestId('home-new').click();
  await page.getByTestId('opponent-input').fill('Opponent FC');
  await choose?.();
  await page.getByTestId('newgame-next').click();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('score-us')).toHaveText('0');
  return currentGameId();
}

async function seedFinal(id, extra = {}) {
  await seed(`games/${id}`, {
    opponent: 'Old FC', date: '2026-10-01', season: '2026-27', status: 'final', period: 4, lineup: lineupP5, events: [], ...extra,
  });
}

async function openDetail(page) {
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await page.getByTestId('home-games').click();
  await page.getByTestId('game-row').first().click();
  await expect(page.getByTestId('info-competition')).toBeVisible();
}

test('a new game defaults to league and a tournament needs its name', async ({ page }) => {
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await page.getByTestId('home-new').click();
  await expect(select(page)).toHaveValue('league');
  await expect(page.getByTestId('competition-name-field')).toBeHidden();
  await expect(page.getByTestId('newgame-next')).toBeEnabled();

  await select(page).selectOption('tournament');
  await expect(page.getByTestId('competition-name-field')).toBeVisible();
  await expect(page.getByTestId('newgame-next')).toBeDisabled();
  await expect(page.getByTestId('competition-error')).toHaveText('Enter the tournament name');
  await nameInput(page).fill('   ');
  await expect(page.getByTestId('newgame-next')).toBeDisabled();
  await nameInput(page).fill('Summer Cup');
  await expect(page.getByTestId('competition-error')).toBeHidden();
  await expect(page.getByTestId('newgame-next')).toBeEnabled();

  await page.getByTestId('newgame-next').click();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('score-us')).toHaveText('0');
  const id = await currentGameId();
  expect(await get(`games/${id}`)).toMatchObject({ competition: 'tournament', competitionName: 'Summer Cup' });
});

test('the next new game starts from the previous competition and switching away drops the name', async ({ page }) => {
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  const first = await startFromNewGame(page, async () => {
    await select(page).selectOption('tournament');
    await nameInput(page).fill('Summer Cup');
  });
  expect(await get(`games/${first}`)).toMatchObject({ competition: 'tournament', competitionName: 'Summer Cup' });
  await update(`games/${first}`, { status: 'final' });

  await page.goto(HOME_URL);
  await expect(page.getByTestId('home-new')).toBeVisible();
  await page.getByTestId('home-new').click();
  await expect(select(page)).toHaveValue('tournament');
  await expect(nameInput(page)).toHaveValue('Summer Cup');
  await select(page).selectOption('cup');
  await expect(page.getByTestId('competition-name-field')).toBeHidden();
  await expect(page.getByTestId('newgame-next')).toBeEnabled();
  await page.getByTestId('newgame-next').click();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('score-us')).toHaveText('0');
  await expect.poll(async () => (await get('team/main')).currentGameId).not.toBe(first);
  const second = await currentGameId();
  const game = await get(`games/${second}`);
  expect(game.competition).toBe('cup');
  expect('competitionName' in game).toBe(false);
});

test('changing a counted game to friendly recounts the season without it and tags it', async ({ page }) => {
  const game = { id: 'g1', opponent: 'Old FC', date: '2026-10-01', season: '2026-27', status: 'final', period: 4, lineup: lineupP5, events: [goal('g-1'), goal('g-2')] };
  await seedFinal('g1', { events: game.events });
  await seed('stats/2026-27', aggregateSeason([game], roster));
  expect((await get('stats/2026-27')).players.p5.goals).toBe(2);

  await openDetail(page);
  await expect(page.getByTestId('info-competition')).toHaveValue('league');
  await expect(page.getByTestId('game-meta')).toHaveText('01/10/2026 · 2026-27 · League');
  await page.getByTestId('info-competition').selectOption('friendly');
  await page.getByTestId('info-save').click();

  await expect(page.getByTestId('game-meta')).toHaveText('01/10/2026 · 2026-27 · Friendly');
  expect(await get('games/g1')).toMatchObject({ competition: 'friendly' });
  await expect.poll(async () => (await get('stats/2026-27')).players).toEqual({});
  const stats = await get('stats/2026-27');
  expect(stats.results).toHaveLength(1);
  expect(stats.results[0]).toMatchObject({ gameId: 'g1', us: 2, competition: 'friendly' });

  await page.getByTestId('games-back').click();
  await expect(page.getByTestId('game-row')).toContainText('01/10/2026 · Friendly');
});

test('a snapshot does not overwrite a competition being edited', async ({ page }) => {
  await seedFinal('g1');
  await openDetail(page);
  await page.getByTestId('info-competition').selectOption('tournament');
  await page.getByTestId('info-competition-name').pressSequentially('Sum');
  await expect(page.getByTestId('info-competition-name')).toHaveValue('Sum');
  await update('games/g1', { opponent: 'Harbour WPC' });
  await expect(page.locator('h2.detail-team').last()).toHaveText('Harbour WPC');
  await expect(page.getByTestId('info-competition-name')).toHaveValue('Sum');
  await expect(page.getByTestId('info-competition')).toHaveValue('tournament');
  // The stored game is still a league game.
  await expect(page.getByTestId('game-meta')).toHaveText('01/10/2026 · 2026-27 · League');
});

test('an untouched competition follows the game and is not sent by an opponent-only save', async ({ page }) => {
  await seedFinal('g1');
  await openDetail(page);
  await expect(page.getByTestId('info-competition')).toHaveValue('league');
  await update('games/g1', { competition: 'cup' });
  await expect(page.getByTestId('info-competition')).toHaveValue('cup');
  await expect(page.getByTestId('game-meta')).toHaveText('01/10/2026 · 2026-27 · Cup');

  await page.getByTestId('info-opponent').fill('Harbour WPC');
  await page.getByTestId('info-save').click();
  await expect.poll(async () => (await get('games/g1')).opponent).toBe('Harbour WPC');
  expect((await get('games/g1')).competition).toBe('cup');
});

test('a 40-character Greek tournament name fits at 360 px in the list and the form', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await seedFinal('g1', { competition: 'tournament', competitionName: LONG_NAME });
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await page.getByTestId('home-games').click();
  await expect(page.getByTestId('game-row')).toContainText(LONG_NAME);
  await page.getByTestId('game-row').click();
  await expect(page.getByTestId('info-competition-name')).toHaveValue(LONG_NAME);
  await expect(page.getByTestId('game-meta')).toContainText(LONG_NAME);
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  await page.getByTestId('games-back').click();
  await expect(page.getByTestId('game-row')).toContainText(LONG_NAME);
  const listWidths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth,
  }));
  expect(listWidths.scroll).toBeLessThanOrEqual(listWidths.client);
});
