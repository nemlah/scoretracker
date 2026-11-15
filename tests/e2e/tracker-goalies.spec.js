import { test, expect } from '@playwright/test';
import { closeAll, get, resetAll, seed } from './helpers.js';
import { CODE, TRACKER_URL, collectProblems, reloadTracker, unlockTracker } from './tracker-helpers.js';

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

const luRow = (page, id) => page.locator(`[data-testid="lu-row"][data-player-id="${id}"]`);
const selRow = (page, id) => page.locator(`[data-testid="sel-row"][data-player-id="${id}"]`);

async function currentGameId() {
  await expect.poll(async () => (await get('team/main'))?.currentGameId).toBeTruthy();
  return (await get('team/main')).currentGameId;
}

test('a roster player can be marked goalie when added or later', async ({ page }) => {
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await page.getByTestId('home-roster').click();
  await expect(page.getByTestId('roster-add-btn')).toBeEnabled();

  await page.getByTestId('roster-add-name').fill('Nikolaou');
  await page.getByTestId('roster-add-cap').fill('1');
  await page.getByTestId('roster-add-goalie').check();
  await page.getByTestId('roster-add-btn').click();
  await expect(page.getByTestId('roster-add-goalie')).not.toBeChecked();
  await expect(page.getByTestId('roster-goalie')).toBeChecked();
  await expect(page.getByTestId('roster-row').first()).toContainText('GK');
  await expect.poll(async () => (await get('team/main'))?.roster[0]).toMatchObject({ name: 'Nikolaou', goalie: true });

  await page.getByTestId('roster-goalie').uncheck();
  await expect.poll(async () => (await get('team/main'))?.roster[0].goalie).toBe(false);
  await expect(page.getByTestId('roster-goalie')).not.toBeChecked();

  await page.getByTestId('roster-goalie').check();
  await expect.poll(async () => (await get('team/main'))?.roster[0].goalie).toBe(true);
  await reloadTracker(page, problems);
  await expect(page.getByTestId('roster-goalie')).toBeChecked();
});

test('a new game copies goalies into the lineup', async ({ page }) => {
  await seed('team/main', {
    roster: [
      { id: 'g1', name: 'Nikolaou', cap: 1, archived: false, goalie: true },
      { id: 'p5', name: 'Alexiou', cap: 5, archived: false },
    ],
  });
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await page.getByTestId('home-new').click();
  await expect(page.getByTestId('start-game')).toBeVisible();
  await expect(selRow(page, 'g1')).toContainText('GK');
  await expect(selRow(page, 'p5')).not.toContainText('GK');
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('score-us')).toHaveText('0');

  const game = await get(`games/${await currentGameId()}`);
  const byId = Object.fromEntries(game.lineup.map(entry => [entry.playerId, entry]));
  expect(byId.g1.goalie).toBe(true);
  expect(byId.p5).toEqual({ playerId: 'p5', name: 'Alexiou', cap: 5 });
  expect('goalie' in byId.p5).toBe(false);
});

test('the lineup sheet can mark a goalie and writes it back to the roster', async ({ page }) => {
  await seed('team/main', {
    roster: [
      { id: 'g1', name: 'Nikolaou', cap: 1, archived: false, goalie: true },
      { id: 'p5', name: 'Alexiou', cap: 5, archived: false },
      { id: 'p7', name: 'Georgiou', cap: 7, archived: false },
    ],
  });
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await page.getByTestId('home-new').click();
  await selRow(page, 'p7').getByTestId('sel-check').uncheck();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('score-us')).toHaveText('0');
  const id = await currentGameId();

  await page.getByTestId('events-open').click();
  await page.getByTestId('open-lineup').click();
  await expect(page.getByTestId('lineup-sheet')).toBeVisible();
  await expect(luRow(page, 'g1').getByTestId('lu-goalie')).toBeChecked();
  await expect(luRow(page, 'p5').getByTestId('lu-goalie')).not.toBeChecked();
  await luRow(page, 'g1').getByTestId('lu-goalie').uncheck();
  await luRow(page, 'p5').getByTestId('lu-goalie').check();
  // A player added mid-game brings the roster's flag.
  await page.getByTestId('lu-add').selectOption('p7');
  await expect(luRow(page, 'p7').getByTestId('lu-goalie')).not.toBeChecked();
  await luRow(page, 'p7').getByTestId('lu-goalie').check();
  await page.getByTestId('lu-save').click();
  await expect(page.getByTestId('lineup-sheet')).toBeHidden();

  await expect.poll(async () => (await get(`games/${id}`)).lineup.filter(p => p.goalie).map(p => p.playerId).sort())
    .toEqual(['p5', 'p7']);
  const game = await get(`games/${id}`);
  expect('goalie' in game.lineup.find(p => p.playerId === 'g1')).toBe(false);
  await expect.poll(async () => (await get('team/main')).roster
    .map(p => [p.id, p.goalie === true]).sort()).toEqual([['g1', false], ['p5', true], ['p7', true]]);

  // Added later with the roster flag set, the tick starts ticked.
  await page.getByTestId('open-lineup').click();
  await luRow(page, 'p7').getByTestId('lu-remove').click();
  await expect(page.getByTestId('lu-add')).toBeVisible();
  await page.getByTestId('lu-add').selectOption('p7');
  await expect(luRow(page, 'p7').getByTestId('lu-goalie')).toBeChecked();
});
