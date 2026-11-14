import { test, expect } from '@playwright/test';
import { closeAll, get, resetAll, seed } from './helpers.js';
import { CODE, HOME_URL, TRACKER_URL, collectProblems, unlockTracker } from './tracker-helpers.js';

const roster = [
  { id: 'p2', name: 'Papadakis', cap: 2, archived: false },
  { id: 'p5', name: 'Alexiou', cap: 5, archived: false },
  { id: 'p7', name: 'Georgiou', cap: 7, archived: false },
];
const lineup = roster.map(player => ({ playerId: player.id, name: player.name, cap: player.cap }));

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
const situation = page => page.getByTestId('situation');
const body = page => page.locator('body');
async function currentGameId() {
  await expect.poll(async () => (await get('team/main'))?.currentGameId).toBeTruthy();
  return (await get('team/main')).currentGameId;
}

async function startGame(page) {
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await page.getByTestId('home-new').click();
  await page.getByTestId('opponent-input').fill('Opponent FC');
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('score-us')).toHaveText('0');
}

// A game written straight to the server, opened through Home so the unlock step still works.
async function openSeeded(page, game) {
  await seed('team/main', { roster, currentGameId: 'g1' });
  await seed('games/g1', {
    opponent: 'Seeded FC', date: '2026-11-01', season: '2026-27', status: 'live', period: 1, lineup, ...game,
  });
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await page.getByTestId('home-resume').click();
  await expect(page.getByTestId('score-us')).toBeVisible();
}

test('PEN counts toward the foul limit and does not open a man-down', async ({ page }) => {
  await startGame(page);
  await expect(page.getByTestId('live-situations')).toHaveText('MU 0/0 · MD 0/0');
  await tile(page, 2).getByTestId('tile-pen').click();
  await expect(tile(page, 2).locator('.pip.is-pen')).toHaveCount(1);
  await expect(tile(page, 2).locator('.pip.is-on')).toHaveCount(1);
  await expect(situation(page)).toHaveAttribute('data-state', 'none');
  await expect(body(page)).not.toHaveClass(/sit-down/);
  await expect(page.getByTestId('undo')).toHaveText('Undo: Penalty foul · #2 Papadakis (Q1)');

  await tile(page, 2).getByTestId('tile-excl').click();
  await expect(situation(page)).toHaveAttribute('data-state', 'manDown');
  await page.waitForTimeout(1100);
  await tile(page, 2).getByTestId('tile-excl').click();
  await expect(tile(page, 2).getByTestId('tile-out')).toBeVisible();
  await expect(tile(page, 2).getByTestId('tile-pen')).toBeDisabled();
  await expect(tile(page, 2).getByTestId('tile-excl')).toBeDisabled();
  await expect(tile(page, 2).getByTestId('tile-excl-count')).toHaveAttribute('aria-label', 'Exclusions: 2, penalty fouls: 1');

  await expect.poll(async () => (await get(`games/${await currentGameId()}`)).events.map(event => event.type))
    .toEqual(['pen', 'excl', 'excl']);
});

test('man-up opens, tints the page, and our goal closes it as scored', async ({ page }) => {
  await startGame(page);
  await expect(situation(page)).toHaveAttribute('data-state', 'none');
  await expect(situation(page)).toContainText('Man-up');
  await expect(body(page)).not.toHaveClass(/sit-/);
  await situation(page).click();
  await expect(situation(page)).toHaveAttribute('data-state', 'manUp');
  await expect(body(page)).toHaveClass(/sit-up/);
  await expect(situation(page)).toContainText('End man-up · no goal');
  await expect(page.getByTestId('situation-seconds')).toHaveText(/^\d+ s$/);
  await tile(page, 5).getByTestId('tile-goal').click();
  await expect(situation(page)).toHaveAttribute('data-state', 'none');
  await expect(body(page)).not.toHaveClass(/sit-/);
  await expect(page.getByTestId('live-situations')).toHaveText('MU 1/1 · MD 0/0');
});

test('ending a man-up counts it as missed; a double tap does not end it', async ({ page }) => {
  await startGame(page);
  await situation(page).dblclick();
  await expect(situation(page)).toHaveAttribute('data-state', 'manUp');
  await expect(situation(page)).toBeDisabled();
  await page.waitForTimeout(300);
  await expect(situation(page)).toHaveAttribute('data-state', 'manUp');
  const events = (await get(`games/${await currentGameId()}`)).events;
  expect(events.filter(event => event.type === 'manUp')).toHaveLength(1);
  expect(events.filter(event => event.type === 'manUpEnd')).toHaveLength(0);
  await page.waitForTimeout(1100);
  await expect(situation(page)).toBeEnabled();
  await situation(page).click();
  await expect(situation(page)).toHaveAttribute('data-state', 'none');
  await expect(page.getByTestId('live-situations')).toHaveText('MU 0/1 · MD 0/0');
});

test('EXCL opens a man-down; an opponent goal concedes it', async ({ page }) => {
  await startGame(page);
  await tile(page, 2).getByTestId('tile-excl').click();
  await expect(situation(page)).toHaveAttribute('data-state', 'manDown');
  await expect(body(page)).toHaveClass(/sit-down/);
  await expect(situation(page)).toContainText('End man-down · stopped');
  await page.getByTestId('opp-goal').click();
  await expect(situation(page)).toHaveAttribute('data-state', 'none');
  await expect(body(page)).not.toHaveClass(/sit-/);
  await expect(page.getByTestId('live-situations')).toHaveText('MU 0/0 · MD 0/1');
});

test('the period button closes an open man-up as missed', async ({ page }) => {
  await startGame(page);
  await situation(page).click();
  await expect(situation(page)).toHaveAttribute('data-state', 'manUp');
  await page.getByTestId('period-next').click();
  await expect(page.getByTestId('period-next')).toHaveText('Q2');
  await expect(situation(page)).toHaveAttribute('data-state', 'none');
  await expect(body(page)).not.toHaveClass(/sit-/);
  await expect(page.getByTestId('live-situations')).toHaveText('MU 0/1 · MD 0/0');
});

test('Undo of the goal reopens the man-up', async ({ page }) => {
  await startGame(page);
  await situation(page).click();
  await tile(page, 5).getByTestId('tile-goal').click();
  await expect(situation(page)).toHaveAttribute('data-state', 'none');
  await expect(page.getByTestId('live-situations')).toHaveText('MU 1/1 · MD 0/0');
  await page.getByTestId('undo').click();
  await expect(situation(page)).toHaveAttribute('data-state', 'manUp');
  await expect(body(page)).toHaveClass(/sit-up/);
  await expect(page.getByTestId('live-situations')).toHaveText('MU 0/0 · MD 0/0');
});

test('tint is removed when leaving the live screen', async ({ page }) => {
  await startGame(page);
  await situation(page).click();
  await expect(body(page)).toHaveClass(/sit-up/);
  await page.getByTestId('nav-home').click();
  await expect(page.getByTestId('home-resume')).toBeVisible();
  await expect(body(page)).not.toHaveClass(/sit-/);
  await page.getByTestId('home-resume').click();
  await expect(situation(page)).toHaveAttribute('data-state', 'manUp');
  await expect(body(page)).toHaveClass(/sit-up/);
});

test('moving to the shootout closes an open man-up and hides the button', async ({ page }) => {
  await startGame(page);
  await situation(page).click();
  await expect(situation(page)).toHaveAttribute('data-state', 'manUp');
  for (const label of ['Q2', 'Q3', 'Q4', 'Shootout']) {
    await page.getByTestId('period-next').click();
    await expect(page.getByTestId('period-next')).toHaveText(label);
  }
  await expect(situation(page)).toBeHidden();
  await expect(body(page)).not.toHaveClass(/sit-/);
  await expect(page.getByTestId('live-situations')).toHaveText('MU 0/1 · MD 0/0');
});

test('a seeded open man-up shows after load with its seconds and pulses after 40 s', async ({ page }) => {
  await openSeeded(page, {
    situations: true, events: [{ id: 'm', type: 'manUp', period: 1, ts: Date.now() - 41000 }],
  });
  await expect(situation(page)).toHaveAttribute('data-state', 'manUp');
  await expect(page.getByTestId('situation-seconds')).toHaveText(/^(4[1-9]|[5-9]\d) s$/);
  await expect(situation(page)).toHaveClass(/is-late/);
  await expect(body(page)).toHaveClass(/sit-up/);
});

test('a man-up younger than 40 s does not pulse yet', async ({ page }) => {
  await openSeeded(page, {
    situations: true, events: [{ id: 'm', type: 'manUp', period: 1, ts: Date.now() - 5000 }],
  });
  await expect(situation(page)).toHaveAttribute('data-state', 'manUp');
  await expect(situation(page)).not.toHaveClass(/is-late/);
});

test('untracked game: no situation button, PEN still works', async ({ page }) => {
  await openSeeded(page, { events: [] });
  await expect(situation(page)).toBeHidden();
  await expect(page.getByTestId('live-situations')).toBeHidden();
  await tile(page, 5).getByTestId('tile-pen').click();
  await expect(tile(page, 5).locator('.pip.is-pen')).toHaveCount(1);
  await expect.poll(async () => (await get('games/g1')).events.map(event => event.type)).toEqual(['pen']);
  await expect(body(page)).not.toHaveClass(/sit-/);
});

test('read-only device cannot use PEN or the situation button', async ({ page }) => {
  await startGame(page);
  await seed('control/tracker', { activeUid: 'another-device' });
  await expect(page.getByTestId('takeover-banner')).toBeVisible();
  await expect(tile(page, 5).getByTestId('tile-pen')).toBeDisabled();
  await expect(situation(page)).toBeDisabled();
});
