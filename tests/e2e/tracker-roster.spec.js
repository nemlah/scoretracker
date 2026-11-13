import { test, expect } from '@playwright/test';
import { closeAll, resetAll, seed } from './helpers.js';
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

async function openRoster(page) {
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await page.getByTestId('home-roster').click();
  await expect(page.getByTestId('roster-add-btn')).toBeEnabled();
}

async function addPlayer(page, name, cap) {
  await page.getByTestId('roster-add-name').fill(name);
  await page.getByTestId('roster-add-cap').fill(String(cap));
  await page.getByTestId('roster-add-btn').click();
}

const activeRows = page => page.getByTestId('roster-list').getByTestId('roster-row');
const archivedRows = page => page.getByTestId('roster-archived').getByTestId('roster-row');

async function expectFinalState(page) {
  await expect(activeRows(page)).toHaveCount(1);
  await expect(activeRows(page).first()).toContainText('Papadopoulos');
  await expect(activeRows(page).first()).toContainText('2');
  await page.getByTestId('roster-archived').locator('summary').click();
  await expect(archivedRows(page)).toHaveCount(1);
  await expect(archivedRows(page).first()).toContainText('Alexiou');
}

test('add, edit, archive players; persists across reload', async ({ page }) => {
  await openRoster(page);
  await addPlayer(page, 'Alexiou', 5);
  await expect(activeRows(page)).toHaveCount(1);
  await addPlayer(page, 'Papadakis', 2);
  await expect(activeRows(page)).toHaveCount(2);
  await expect(activeRows(page).nth(0)).toContainText('Papadakis');
  await expect(activeRows(page).nth(1)).toContainText('Alexiou');
  await expect(page.getByTestId('roster-add-name')).toHaveValue('');

  await activeRows(page).nth(0).getByTestId('roster-edit').click();
  await page.getByTestId('roster-edit-name').fill('Papadopoulos');
  await page.getByTestId('roster-save').click();
  await expect(activeRows(page).nth(0)).toContainText('Papadopoulos');

  await activeRows(page).nth(1).getByTestId('roster-archive').click();
  await expect(activeRows(page)).toHaveCount(1);
  await expectFinalState(page);

  await reloadTracker(page, problems);
  await expectFinalState(page);

  await archivedRows(page).first().getByTestId('roster-unarchive').click();
  await expect(activeRows(page)).toHaveCount(2);
  await expect(page.getByTestId('roster-archived')).toBeHidden();
});

test('rejects empty name and cap outside 1–99', async ({ page }) => {
  await openRoster(page);
  const rejected = async (name, cap, message) => {
    await addPlayer(page, name, cap);
    await expect(page.getByTestId('roster-error')).toContainText(message);
    await expect(activeRows(page)).toHaveCount(0);
  };
  await rejected('', 5, 'Enter a name');
  await rejected('Nikos', 0, 'from 1 to 99');
  await rejected('Nikos', 100, 'from 1 to 99');
  await rejected('Nikos', 'x', 'from 1 to 99');
  await rejected('Nikos', '', 'from 1 to 99');
  await addPlayer(page, '  Nikos  ', 99);
  await expect(activeRows(page)).toHaveCount(1);
  await expect(page.getByTestId('roster-error')).toBeHidden();
});
