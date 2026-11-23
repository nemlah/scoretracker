import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.js';
import { aggregateSeason } from '../../js/model.js';
import {
  closeAll, expectTagFits, get, instrumentRepo, noSideScroll, resetAll, seed, update,
} from './helpers.js';
import { CODE, HOME_URL, TRACKER_URL, collectProblems, unlockTracker } from './tracker-helpers.js';

const roster = [
  { id: 'p2', name: 'Papadakis', cap: 2, archived: false },
  { id: 'p5', name: 'Alexiou', cap: 5, archived: false },
];
const lineupP5 = [{ playerId: 'p5', name: 'Alexiou', cap: 5 }];
const goal = id => ({ id, type: 'goal', period: 1, ts: 1000, playerId: 'p5' });
// 40 characters, no break opportunity, Greek, the widest glyph (about 453 px at 14 px).
const LONG_NAME = 'Φ'.repeat(40);

// instrumentRepo serves its own copy of repo.js, which the service worker must not replace.
test.use({ serviceWorkers: 'block' });

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
const tournamentSelect = page => page.getByTestId('tournament-select');
const tournamentNew = page => page.getByTestId('tournament-new-name');
const phaseSelect = page => page.getByTestId('phase-select');
const phaseNew = page => page.getByTestId('phase-new-name');
const NEW = '__new';
const SPLASH = { t1: { name: 'Splash - Volos' } };
const PHASES = { p1: { name: 'Regular season' }, p2: { name: 'Play-offs' } };

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

// The select sits fully inside the viewport and shows the whole of its width.
async function expectSelectFits(locator, page) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const width = page.viewportSize().width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
}

async function openDetail(page) {
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await page.getByTestId('home-games').click();
  await page.getByTestId('game-row').first().click();
  await expect(page.getByTestId('info-competition')).toBeVisible();
}

test('a new game defaults to league; a tournament with no list entries needs a new name, which is saved with the game', async ({ page }) => {
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await page.getByTestId('home-new').click();
  await expect(select(page)).toHaveValue('league');
  await expect(tournamentSelect(page)).toBeHidden();
  await expect(page.getByTestId('newgame-next')).toBeEnabled();

  await select(page).selectOption('tournament');
  await expect(tournamentSelect(page)).toBeVisible();
  // Only "Add new…" exists, and it is selected.
  await expect(tournamentSelect(page)).toHaveValue(NEW);
  await expect(tournamentNew(page)).toBeVisible();
  await expect(page.getByTestId('newgame-next')).toBeDisabled();
  await expect(page.getByTestId('competition-error')).toHaveText('Enter a name (up to 40 characters)');
  await tournamentNew(page).fill('   ');
  await expect(page.getByTestId('newgame-next')).toBeDisabled();
  await tournamentNew(page).fill('Splash - Volos');
  await expect(page.getByTestId('competition-error')).toBeHidden();
  await expect(page.getByTestId('newgame-next')).toBeEnabled();

  await page.getByTestId('newgame-next').click();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('score-us')).toHaveText('0');
  const id = await currentGameId();
  const game = await get(`games/${id}`);
  expect(game).toMatchObject({ competition: 'tournament', competitionName: 'Splash - Volos' });
  expect(typeof game.tournamentId).toBe('string');
  expect((await get('team/main')).tournaments).toEqual({ [game.tournamentId]: { name: 'Splash - Volos' } });
});

test('the next new game starts from the previous tournament entry and switching away drops it', async ({ page }) => {
  await seed('team/main', { roster, tournaments: { ...SPLASH, t2: { name: 'Aegean Cup' } } });
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  const first = await startFromNewGame(page, async () => {
    await select(page).selectOption('tournament');
    // The entries are sorted by name, so "Aegean Cup" comes first; pick the other one.
    await tournamentSelect(page).selectOption('t1');
    await expect(tournamentNew(page)).toBeHidden();
  });
  expect(await get(`games/${first}`)).toMatchObject({ competition: 'tournament', competitionName: 'Splash - Volos', tournamentId: 't1' });
  await update(`games/${first}`, { status: 'final' });

  await page.goto(HOME_URL);
  await expect(page.getByTestId('home-new')).toBeVisible();
  await page.getByTestId('home-new').click();
  await expect(select(page)).toHaveValue('tournament');
  await expect(tournamentSelect(page)).toHaveValue('t1');
  await expect(tournamentNew(page)).toBeHidden();
  await select(page).selectOption('cup');
  await expect(tournamentSelect(page)).toBeHidden();
  await expect(page.getByTestId('newgame-next')).toBeEnabled();
  await page.getByTestId('newgame-next').click();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('score-us')).toHaveText('0');
  await expect.poll(async () => (await get('team/main')).currentGameId).not.toBe(first);
  const second = await currentGameId();
  const game = await get(`games/${second}`);
  expect(game.competition).toBe('cup');
  for (const key of ['competitionName', 'tournamentId', 'phaseId']) expect(key in game).toBe(false);
});

test('a previous legacy tournament game matches its list entry by name, else prefills Add new', async ({ page }) => {
  // The previous game is the team's current game.
  await seed('team/main', { roster, tournaments: SPLASH, currentGameId: 'g1' });
  await seedFinal('g1', { competition: 'tournament', competitionName: 'SPLASH - VOLOS', date: '2026-10-02' });
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await page.getByTestId('home-new').click();
  await expect(select(page)).toHaveValue('tournament');
  await expect(tournamentSelect(page)).toHaveValue('t1');

  await update('games/g1', { competitionName: 'Unlisted Cup' });
  await page.goto(HOME_URL);
  await page.getByTestId('home-new').click();
  await expect(tournamentSelect(page)).toHaveValue(NEW);
  await expect(tournamentNew(page)).toHaveValue('Unlisted Cup');
});

test('a league game takes a new phase or no phase', async ({ page }) => {
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await page.getByTestId('home-new').click();
  await expect(phaseSelect(page)).toBeVisible();
  await expect(phaseSelect(page)).toHaveValue('');
  await expect(phaseNew(page)).toBeHidden();
  await expect(page.getByTestId('newgame-next')).toBeEnabled();
  await phaseSelect(page).selectOption(NEW);
  await expect(phaseNew(page)).toBeVisible();
  await expect(page.getByTestId('competition-error')).toHaveText('Enter a name (up to 40 characters)');
  await expect(page.getByTestId('newgame-next')).toBeDisabled();
  await phaseNew(page).fill('Regular season');
  await page.getByTestId('newgame-next').click();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('score-us')).toHaveText('0');
  const first = await currentGameId();
  const game = await get(`games/${first}`);
  expect(game.competition).toBe('league');
  expect(typeof game.phaseId).toBe('string');
  expect((await get('team/main')).phases).toEqual({ [game.phaseId]: { name: 'Regular season' } });
  await update(`games/${first}`, { status: 'final' });

  // The next game defaults to that phase; "No phase" writes no phaseId.
  await page.goto(HOME_URL);
  await page.getByTestId('home-new').click();
  await expect(phaseSelect(page)).toHaveValue(game.phaseId);
  await phaseSelect(page).selectOption('');
  await page.getByTestId('newgame-next').click();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('score-us')).toHaveText('0');
  await expect.poll(async () => (await get('team/main')).currentGameId).not.toBe(first);
  const second = await currentGameId();
  const plain = await get(`games/${second}`);
  expect(plain.competition).toBe('league');
  expect('phaseId' in plain).toBe(false);
});

test('a duplicate new tournament or phase name is refused and Next stays disabled', async ({ page }) => {
  await seed('team/main', { roster, tournaments: SPLASH, phases: PHASES });
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await page.getByTestId('home-new').click();
  await select(page).selectOption('tournament');
  await tournamentSelect(page).selectOption(NEW);
  await tournamentNew(page).fill('SPLASH - VOLOS');
  await expect(page.getByTestId('competition-error')).toHaveText('That name is already in the list');
  await expect(page.getByTestId('newgame-next')).toBeDisabled();
  await tournamentNew(page).fill('Splash - Patras');
  await expect(page.getByTestId('competition-error')).toBeHidden();
  await expect(page.getByTestId('newgame-next')).toBeEnabled();

  await select(page).selectOption('league');
  await phaseSelect(page).selectOption(NEW);
  await phaseNew(page).fill(' play-offs ');
  await expect(page.getByTestId('competition-error')).toHaveText('That name is already in the list');
  await expect(page.getByTestId('newgame-next')).toBeDisabled();
  // Nothing was written: the lists are as seeded and there is no game.
  expect((await get('team/main')).tournaments).toEqual(SPLASH);
  expect((await get('team/main')).currentGameId).toBeUndefined();
});

test('an entry removed after Next sends the form back to the details step with the message', async ({ page }) => {
  await seed('team/main', { roster, tournaments: SPLASH });
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await page.getByTestId('home-new').click();
  await select(page).selectOption('tournament');
  await expect(tournamentSelect(page)).toHaveValue('t1');
  await page.getByTestId('newgame-next').click();
  await expect(page.getByTestId('start-game')).toBeVisible();

  await seed('team/main', { roster });
  await expect(page.getByTestId('opponent-input')).toBeVisible();
  await expect(page.getByTestId('start-game')).toBeHidden();
  await expect(page.getByTestId('competition-error')).toHaveText('That entry was removed. Pick again');
  await expect(tournamentSelect(page)).toHaveValue('t1');
  await expect(tournamentSelect(page).locator('option[value="t1"]')).toContainText('(removed)');
  await expect(page.getByTestId('newgame-next')).toBeDisabled();
  expect((await get('team/main')).currentGameId).toBeUndefined();
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
  // The meta follows the local write; the server may not have it yet.
  await expect.poll(async () => (await get('games/g1')).competition).toBe('friendly');
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
  await page.getByTestId('info-tournament-new-name').pressSequentially('Sum');
  await expect(page.getByTestId('info-tournament-new-name')).toHaveValue('Sum');
  await update('games/g1', { opponent: 'Harbour WPC' });
  await expect(page.locator('h2.detail-team').last()).toHaveText('Harbour WPC');
  // A team-list snapshot arrives too; the draft survives both.
  await seed('team/main', { roster, tournaments: SPLASH });
  await expect(page.getByTestId('info-tournament').locator('option[value="t1"]')).toHaveCount(1);
  await expect(page.getByTestId('info-tournament')).toHaveValue(NEW);
  await expect(page.getByTestId('info-tournament-new-name')).toHaveValue('Sum');
  await expect(page.getByTestId('info-competition')).toHaveValue('tournament');
  // The stored game is still a league game.
  await expect(page.getByTestId('game-meta')).toHaveText('01/10/2026 · 2026-27 · League');
});

test('an untouched competition follows the game and is not sent by an opponent-only save', async ({ page }) => {
  await instrumentRepo(page);
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
  // The form sent the opponent change only: neither competition key was in the payload.
  const calls = await page.evaluate(() => window.__infoCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0].info.opponent).toBe('Harbour WPC');
  expect(Object.keys(calls[0].info)).not.toContain('competition');
  expect(Object.keys(calls[0].info)).not.toContain('competitionName');
  for (const key of ['tournamentId', 'phaseId', 'newEntry']) expect(Object.keys(calls[0].info)).not.toContain(key);
});

test('a 40-character Greek tournament name fits at 360 px in the list, the meta, the info form and the new-game form', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await seed('team/main', { roster, tournaments: { t1: { name: LONG_NAME } }, phases: { p1: { name: LONG_NAME } } });
  await seedFinal('g1', { competition: 'tournament', competitionName: LONG_NAME, tournamentId: 't1' });
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await page.getByTestId('home-games').click();
  const row = page.getByTestId('game-row');
  await expect(row).toContainText(LONG_NAME);
  await expectTagFits(row.locator('.game-date'), row);
  const listWidths = await noSideScroll(page);
  expect(listWidths.scroll).toBeLessThanOrEqual(listWidths.client);

  await row.click();
  await expect(page.getByTestId('info-tournament')).toBeVisible();
  await expect(page.getByTestId('info-tournament')).toHaveValue('t1');
  await expect(page.getByTestId('info-tournament').locator('option:checked')).toHaveText(LONG_NAME);
  await expect(page.getByTestId('game-meta')).toContainText(LONG_NAME);
  await expectTagFits(page.getByTestId('game-meta'), page.locator('form.info-form'));
  await expectSelectFits(page.getByTestId('info-tournament'), page);
  await page.getByTestId('info-competition').selectOption('league');
  await page.getByTestId('info-phase').selectOption('p1');
  await expectSelectFits(page.getByTestId('info-phase'), page);
  const detailWidths = await noSideScroll(page);
  expect(detailWidths.scroll).toBeLessThanOrEqual(detailWidths.client);

  await page.goto(HOME_URL);
  await page.getByTestId('home-new').click();
  await select(page).selectOption('tournament');
  await tournamentSelect(page).selectOption('t1');
  await expectSelectFits(tournamentSelect(page), page);
  await select(page).selectOption('league');
  await phaseSelect(page).selectOption('p1');
  await expectSelectFits(phaseSelect(page), page);
  const newWidths = await noSideScroll(page);
  expect(newWidths.scroll).toBeLessThanOrEqual(newWidths.client);
});

test('saving a competition change releases the form, so a remote re-tag shows and an opponent-only save keeps it', async ({ page }) => {
  await instrumentRepo(page);
  await seedFinal('g1');
  await openDetail(page);
  await page.getByTestId('info-competition').selectOption('friendly');
  await page.getByTestId('info-save').click();
  await expect.poll(async () => (await get('games/g1')).competition).toBe('friendly');
  await expect(page.getByTestId('game-meta')).toHaveText('01/10/2026 · 2026-27 · Friendly');

  // An admin re-tags the game elsewhere: the form is no longer holding an edit, so the select follows.
  await update('games/g1', { competition: 'cup' });
  await expect(page.getByTestId('info-competition')).toHaveValue('cup');
  await expect(page.getByTestId('game-meta')).toHaveText('01/10/2026 · 2026-27 · Cup');

  await page.getByTestId('info-opponent').fill('Harbour WPC');
  await page.getByTestId('info-save').click();
  await expect.poll(async () => (await get('games/g1')).opponent).toBe('Harbour WPC');
  expect((await get('games/g1')).competition).toBe('cup');
  const calls = await page.evaluate(() => window.__infoCalls);
  // The first call carried the competition change, the second the opponent only.
  expect(calls).toHaveLength(2);
  expect(calls[0].info.competition).toBe('friendly');
  expect(Object.keys(calls[1].info)).not.toContain('competition');
  expect(Object.keys(calls[1].info)).not.toContain('competitionName');
});

test('a tournament with no name is refused in the details form and nothing is written', async ({ page }) => {
  await instrumentRepo(page);
  await seedFinal('g1');
  await openDetail(page);
  await page.getByTestId('info-competition').selectOption('tournament');
  await expect(page.getByTestId('info-tournament-new-name')).toBeVisible();
  await page.getByTestId('info-save').click();
  await expect(page.getByTestId('info-error')).toBeVisible();
  await expect(page.getByTestId('info-error')).toHaveText('Enter a name (up to 40 characters)');
  await page.getByTestId('info-tournament-new-name').fill('   ');
  await page.getByTestId('info-save').click();
  await expect(page.getByTestId('info-error')).toHaveText('Enter a name (up to 40 characters)');
  // The refusal happens before any repo call, so the recorded calls are the proof; the document is checked too.
  expect(await page.evaluate(() => window.__infoCalls ?? [])).toEqual([]);
  const game = await get('games/g1');
  expect(game.competition).toBeUndefined();
  expect('competitionName' in game).toBe(false);
  expect(game.opponent).toBe('Old FC');
});

test('a duplicate new name in the info form is refused and nothing is written', async ({ page }) => {
  await instrumentRepo(page);
  await seed('team/main', { roster, tournaments: SPLASH });
  await seedFinal('g1');
  await openDetail(page);
  await page.getByTestId('info-competition').selectOption('tournament');
  await page.getByTestId('info-tournament').selectOption(NEW);
  await page.getByTestId('info-tournament-new-name').fill('splash - volos');
  await page.getByTestId('info-save').click();
  await expect(page.getByTestId('info-error')).toHaveText('That name is already in the list');
  expect(await page.evaluate(() => window.__infoCalls ?? [])).toEqual([]);
  expect((await get('team/main')).tournaments).toEqual(SPLASH);
  expect((await get('games/g1')).competition).toBeUndefined();
});

test('a legacy tournament game preselects its list entry and an opponent-only save relinks it', async ({ page }) => {
  await instrumentRepo(page);
  const legacy = { id: 'g1', opponent: 'Old FC', date: '2026-10-01', season: '2026-27', status: 'final', period: 4, lineup: lineupP5, events: [goal('g-1')], competition: 'tournament', competitionName: 'Splash - Volos' };
  await seed('team/main', { roster, tournaments: { t0: { name: 'Aegean Cup' }, ...SPLASH } });
  await seedFinal('g1', { events: legacy.events, competition: 'tournament', competitionName: 'Splash - Volos' });
  await seed('stats/2026-27', aggregateSeason([legacy], roster));
  expect((await get('stats/2026-27')).results[0].tournamentId).toBeUndefined();

  await openDetail(page);
  await expect(page.getByTestId('info-competition')).toHaveValue('tournament');
  await expect(page.getByTestId('info-tournament')).toHaveValue('t1');
  await expect(page.getByTestId('info-tournament-new-name')).toBeHidden();
  expect('tournamentId' in (await get('games/g1'))).toBe(false);
  await page.getByTestId('info-opponent').fill('Harbour WPC');
  await page.getByTestId('info-save').click();
  await expect.poll(async () => (await get('games/g1')).tournamentId).toBe('t1');
  expect(await get('games/g1')).toMatchObject({ opponent: 'Harbour WPC', competitionName: 'Splash - Volos' });
  const calls = await page.evaluate(() => window.__infoCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0].info).toMatchObject({ competition: 'tournament', tournamentId: 't1' });
  await expect.poll(async () => (await get('stats/2026-27')).results[0].tournamentId).toBe('t1');
});

test('a legacy tournament game with no matching entry preselects Add new with its name, and one Save creates the entry', async ({ page }) => {
  await seed('team/main', { roster, tournaments: SPLASH });
  await seedFinal('g1', { competition: 'tournament', competitionName: 'Unlisted Cup' });
  await openDetail(page);
  await expect(page.getByTestId('info-tournament')).toHaveValue(NEW);
  await expect(page.getByTestId('info-tournament-new-name')).toHaveValue('Unlisted Cup');
  await page.getByTestId('info-save').click();
  await expect.poll(async () => (await get('games/g1')).tournamentId).toBeTruthy();
  const id = (await get('games/g1')).tournamentId;
  expect(await get('games/g1')).toMatchObject({ competition: 'tournament', competitionName: 'Unlisted Cup' });
  expect((await get('team/main')).tournaments).toEqual({ ...SPLASH, [id]: { name: 'Unlisted Cup' } });
});

test('a phase-only edit writes the phaseId and the recount carries it; No phase clears it', async ({ page }) => {
  await instrumentRepo(page);
  const game = { id: 'g1', opponent: 'Old FC', date: '2026-10-01', season: '2026-27', status: 'final', period: 4, lineup: lineupP5, events: [goal('g-1')] };
  await seed('team/main', { roster, phases: PHASES });
  await seedFinal('g1', { events: game.events });
  await seed('stats/2026-27', aggregateSeason([game], roster));
  expect((await get('stats/2026-27')).results[0].phaseId).toBeUndefined();

  await openDetail(page);
  await expect(page.getByTestId('info-phase')).toHaveValue('');
  await expect(page.getByTestId('info-phase-new-name')).toBeHidden();
  await page.getByTestId('info-phase').selectOption('p1');
  await page.getByTestId('info-save').click();
  await expect.poll(async () => (await get('games/g1')).phaseId).toBe('p1');
  await expect.poll(async () => (await get('stats/2026-27')).results[0].phaseId).toBe('p1');
  await expect(page.getByTestId('game-meta')).toHaveText('01/10/2026 · 2026-27 · Regular season');

  await page.getByTestId('info-phase').selectOption('');
  await page.getByTestId('info-save').click();
  await expect.poll(async () => 'phaseId' in (await get('games/g1'))).toBe(false);
  await expect.poll(async () => 'phaseId' in (await get('stats/2026-27')).results[0]).toBe(false);
  const calls = await page.evaluate(() => window.__infoCalls);
  expect(calls).toHaveLength(2);
  expect(calls[0].info).toMatchObject({ competition: 'league', phaseId: 'p1' });
  // "No phase" is sent explicitly, as null.
  expect(calls[1].info.phaseId).toBeNull();
});

test('an entry removed while the info form is open refuses the save, even an opponent-only one, and writes nothing', async ({ page }) => {
  await instrumentRepo(page);
  await seed('team/main', { roster, tournaments: { ...SPLASH, t2: { name: 'Aegean Cup' } } });
  await seedFinal('g1', { competition: 'tournament', competitionName: 'Splash - Volos', tournamentId: 't1' });
  await openDetail(page);
  await expect(page.getByTestId('info-tournament')).toHaveValue('t1');
  await page.getByTestId('info-tournament').selectOption('t2');
  await seed('team/main', { roster, tournaments: SPLASH });
  // The select keeps the picked id and marks it once the snapshot has arrived.
  await expect(page.getByTestId('info-tournament').locator('option[value="t2"]')).toContainText('(removed)');
  await expect(page.getByTestId('info-tournament')).toHaveValue('t2');
  await page.getByTestId('info-opponent').fill('Harbour WPC');
  await page.getByTestId('info-save').click();
  await expect(page.getByTestId('info-error')).toHaveText('That entry was removed. Pick again');
  expect(await page.evaluate(() => window.__infoCalls ?? [])).toEqual([]);
  expect(await get('games/g1')).toMatchObject({ opponent: 'Old FC', tournamentId: 't1' });
  // Picking a live entry clears the refusal on the next Save.
  await page.getByTestId('info-tournament').selectOption('t1');
  await page.getByTestId('info-save').click();
  await expect(page.getByTestId('info-error')).toBeHidden();
  await expect.poll(async () => (await get('games/g1')).opponent).toBe('Harbour WPC');
});

test('list rows and the detail meta show the phase name and the current list name, and follow a rename', async ({ page }) => {
  await seed('team/main', { roster, tournaments: { t1: { name: 'Splash - Volos' } }, phases: PHASES });
  await seedFinal('g1', { date: '2026-10-01', phaseId: 'p1' });
  await seedFinal('g2', { date: '2026-10-02', competition: 'tournament', competitionName: 'Old snapshot', tournamentId: 't1' });
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await page.getByTestId('home-games').click();
  const rows = page.getByTestId('game-row');
  await expect(rows).toHaveCount(2);
  // Newest first.
  await expect(rows.nth(0)).toContainText('02/10/2026 · Splash - Volos');
  await expect(rows.nth(1)).toContainText('01/10/2026 · Regular season');
  await expect(rows.nth(0)).not.toContainText('Old snapshot');

  // A rename re-tags the loaded rows without reloading the games.
  await update('team/main', { 'tournaments.t1': { name: 'Splash - Volos 2026' }, 'phases.p1': { name: 'League round' } });
  await expect(rows.nth(0)).toContainText('02/10/2026 · Splash - Volos 2026');
  await expect(rows.nth(1)).toContainText('01/10/2026 · League round');

  await rows.nth(0).click();
  await expect(page.getByTestId('game-meta')).toHaveText('02/10/2026 · 2026-27 · Splash - Volos 2026');
  await update('team/main', { 'tournaments.t1': { name: 'Splash - Final' } });
  await expect(page.getByTestId('game-meta')).toHaveText('02/10/2026 · 2026-27 · Splash - Final');
  await page.getByTestId('games-back').click();
  await page.getByTestId('game-row').nth(1).click();
  await expect(page.getByTestId('game-meta')).toHaveText('01/10/2026 · 2026-27 · League round');
});

test('with the lists gate off (a cached repo without competitionLists) the free-text tournament field stays', async ({ page }) => {
  // The previous release's repo.js: no competitionLists flag, so the form must behave as it did.
  const real = readFileSync('js/repo.js', 'utf8');
  expect(real).toContain('competitionLists: true,');
  await page.route('**/js/repo.js', route => route.fulfill({
    contentType: 'text/javascript', body: real.replace('competitionLists: true,', ''),
  }));
  await seed('team/main', { roster, tournaments: SPLASH });
  await seedFinal('g1', { competition: 'tournament', competitionName: 'Free Text Cup' });
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await page.getByTestId('home-new').click();
  await select(page).selectOption('tournament');
  await expect(page.getByTestId('competition-name-input')).toBeVisible();
  await expect(tournamentSelect(page)).toHaveCount(0);
  await expect(page.getByTestId('newgame-next')).toBeDisabled();
  await expect(page.getByTestId('competition-error')).toHaveText('Enter the tournament name');
  await page.getByTestId('competition-name-input').fill('Summer Cup');
  await page.getByTestId('newgame-next').click();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('score-us')).toHaveText('0');
  const id = await currentGameId();
  const created = await get(`games/${id}`);
  expect(created).toMatchObject({ competition: 'tournament', competitionName: 'Summer Cup' });
  for (const key of ['tournamentId', 'phaseId']) expect(key in created).toBe(false);
  expect((await get('team/main')).tournaments).toEqual(SPLASH);

  await update(`games/${id}`, { status: 'final' });
  await page.goto(HOME_URL);
  await page.getByTestId('home-games').click();
  await page.getByTestId('game-row').filter({ hasText: 'Old FC' }).click();
  await expect(page.getByTestId('info-competition-name')).toHaveValue('Free Text Cup');
  await expect(page.getByTestId('info-tournament')).toHaveCount(0);
  await page.getByTestId('info-competition-name').fill('Renamed Cup');
  await page.getByTestId('info-save').click();
  await expect.poll(async () => (await get('games/g1')).competitionName).toBe('Renamed Cup');
  expect('tournamentId' in (await get('games/g1'))).toBe(false);
});
