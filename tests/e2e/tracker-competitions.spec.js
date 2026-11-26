import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.js';
import { closeAll, get, noSideScroll, resetAll, seed, update } from './helpers.js';
import {
  CODE, HOME_URL, SERVER_WAIT, TRACKER_URL, collectProblems, dropNetworkNoise, otherDeviceTakesControl, unlockTracker,
} from './tracker-helpers.js';

// 40 characters, no break opportunity, Greek, the widest glyph.
const LONG_NAME = 'Φ'.repeat(40);

// Route interception needs the service worker out of the way.
test.use({ serviceWorkers: 'block' });

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

const tournaments = page => page.getByTestId('competitions-tournaments');
const phases = page => page.getByTestId('competitions-phases');
const entries = section => section.getByTestId('list-entry');
const entry = (section, id) => section.locator(`[data-entry-id="${id}"]`);

async function openCompetitions(page, url = TRACKER_URL) {
  await page.goto(url);
  await unlockTracker(page);
  await page.getByTestId('home-competitions').click();
  await expect(tournaments(page)).toBeVisible();
}

async function seedFinal(id, extra = {}) {
  await seed(`games/${id}`, {
    opponent: 'Old FC', date: '2026-10-01', season: '2026-27', status: 'final', period: 4, lineup: [], events: [], ...extra,
  });
}

async function seedLiveGame() {
  await seed('games/live1', {
    opponent: 'Live FC', date: '2026-11-01', season: '2026-27', status: 'live', period: 1, lineup: [], events: [],
  });
  await update('team/main', { currentGameId: 'live1' });
}

async function addTo(section, name) {
  await section.getByTestId('list-add-input').fill(name);
  await section.getByTestId('list-add').click();
}

test('the home row opens the screen and lists the seeded entries sorted by name', async ({ page }) => {
  await seed('team/main', {
    roster: [],
    tournaments: { t1: { name: 'Zeta Cup' }, t2: { name: 'Alpha Open' }, t3: { name: 'Mid Cup' } },
    phases: { p1: { name: 'Regular season' }, p2: { name: 'Play-offs' } },
  });
  await openCompetitions(page);
  await expect(page.getByRole('heading', { name: 'Tournaments' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Phases' })).toBeVisible();
  const names = section => entries(section).locator('.list-name').allTextContents();
  await expect.poll(() => names(tournaments(page))).toEqual(['Alpha Open', 'Mid Cup', 'Zeta Cup']);
  await expect.poll(() => names(phases(page))).toEqual(['Play-offs', 'Regular season']);
  // The row follows Roster on Home.
  await page.getByTestId('nav-home').click();
  await expect(page.getByTestId('home-competitions')).toBeVisible();
  const labels = await page.locator('.home-nav-label').allTextContents();
  expect(labels.indexOf('Competitions')).toBeGreaterThan(0);
  expect(labels.indexOf('Competitions')).toBe(labels.indexOf('Roster') + 1);
});

test('adding to Phases writes one entry to Firestore and clears the field', async ({ page }) => {
  await seed('team/main', { roster: [], tournaments: { t1: { name: 'Splash' } } });
  await openCompetitions(page);
  await addTo(phases(page), '  Play-offs  ');
  await expect(entries(phases(page))).toHaveCount(1);
  await expect(entries(phases(page)).first()).toContainText('Play-offs');
  await expect(phases(page).getByTestId('list-add-input')).toHaveValue('');
  await expect.poll(async () => Object.values((await get('team/main')).phases ?? {})).toEqual([{ name: 'Play-offs' }]);
  const team = await get('team/main');
  expect(Object.keys(team.phases)[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(team.tournaments).toEqual({ t1: { name: 'Splash' } });
});

test('an empty name and a duplicate in another case are refused, and nothing is written', async ({ page }) => {
  await seed('team/main', { roster: [], phases: { p2: { name: 'Play-offs' } }, tournaments: { t1: { name: 'Νικητες' } } });
  await openCompetitions(page);
  await addTo(phases(page), '   ');
  await expect(phases(page).getByTestId('list-error')).toHaveText('Enter a name (up to 40 characters)');
  await addTo(phases(page), 'PLAY-OFFS');
  await expect(phases(page).getByTestId('list-error')).toHaveText('That name is already in the list');
  // The Greek lower-case form of the same name counts as the same name.
  await addTo(tournaments(page), 'ΝΙΚΗΤΕΣ');
  await expect(tournaments(page).getByTestId('list-error')).toHaveText('That name is already in the list');
  // The refusal belongs to its section, and typing clears it.
  await expect(phases(page).getByTestId('list-error')).toBeVisible();
  await phases(page).getByTestId('list-add-input').fill('Final');
  await expect(phases(page).getByTestId('list-error')).toBeHidden();
  await expect(entries(phases(page))).toHaveCount(1);
  // Another case in a different list is allowed.
  await addTo(tournaments(page), 'Play-offs');
  await expect(entries(tournaments(page))).toHaveCount(2);
  await expect.poll(async () => Object.values((await get('team/main')).tournaments).map(item => item.name).sort())
    .toEqual(['Play-offs', 'Νικητες']);
  expect((await get('team/main')).phases).toEqual({ p2: { name: 'Play-offs' } });
});

test('renaming a tournament writes the new name and the past-games tag follows it', async ({ page }) => {
  await seed('team/main', { roster: [], tournaments: { t1: { name: 'Splash - Volos' }, t2: { name: 'Other Cup' } } });
  await seedFinal('g1', { competition: 'tournament', competitionName: 'Splash - Volos', tournamentId: 't1' });
  await openCompetitions(page);
  const row = entry(tournaments(page), 't1');
  await row.getByTestId('list-rename').click();
  await expect(row.getByTestId('list-rename-input')).toHaveValue('Splash - Volos');
  await row.getByTestId('list-rename-input').fill('Splash - Final');
  await row.getByTestId('list-rename-save').click();
  await expect(row).toContainText('Splash - Final');
  await expect(row.getByTestId('list-rename-input')).toHaveCount(0);
  await expect.poll(async () => (await get('team/main')).tournaments).toEqual({
    t1: { name: 'Splash - Final' }, t2: { name: 'Other Cup' },
  });
  // The game keeps its snapshot; the tag follows the list.
  expect((await get('games/g1')).competitionName).toBe('Splash - Volos');
  await page.getByTestId('nav-home').click();
  await page.getByTestId('home-games').click();
  await expect(page.getByTestId('game-row')).toContainText('01/10/2026 · Splash - Final');
});

test('a rename to another entry\'s name is refused; a case change of its own name is allowed; cancel keeps the name', async ({ page }) => {
  await seed('team/main', { roster: [], phases: { p1: { name: 'Regular season' }, p2: { name: 'Play-offs' } } });
  await openCompetitions(page);
  const row = entry(phases(page), 'p1');
  await row.getByTestId('list-rename').click();
  await row.getByTestId('list-rename-input').fill('play-offs');
  await row.getByTestId('list-rename-save').click();
  await expect(row.getByTestId('list-error')).toHaveText('That name is already in the list');
  await row.getByTestId('list-rename-input').fill('');
  await row.getByTestId('list-rename-save').click();
  await expect(row.getByTestId('list-error')).toHaveText('Enter a name (up to 40 characters)');
  expect((await get('team/main')).phases.p1).toEqual({ name: 'Regular season' });

  await row.getByTestId('list-rename-input').fill('REGULAR SEASON');
  await row.getByTestId('list-rename-save').click();
  await expect.poll(async () => (await get('team/main')).phases.p1).toEqual({ name: 'REGULAR SEASON' });

  await row.getByTestId('list-rename').click();
  await row.getByTestId('list-rename-input').fill('Never saved');
  await row.getByTestId('list-rename-cancel').click();
  await expect(row).toContainText('REGULAR SEASON');
  await expect(row.getByTestId('list-rename-input')).toHaveCount(0);
  expect((await get('team/main')).phases.p1).toEqual({ name: 'REGULAR SEASON' });
});

test('saving the name the editor opened with still writes it after a snapshot changed the entry', async ({ page }) => {
  await seed('team/main', { roster: [], phases: { p1: { name: 'Regular season' }, p2: { name: 'Play-offs' } } });
  await openCompetitions(page);
  const row = entry(phases(page), 'p1');
  await row.getByTestId('list-rename').click();
  await expect(row.getByTestId('list-rename-input')).toHaveValue('Regular season');
  // Another device renames p1 and adds p3 in one write; the new row shows that the snapshot has arrived.
  await update('team/main', { 'phases.p1': { name: 'League round' }, 'phases.p3': { name: 'Final round' } });
  await expect(entries(phases(page))).toHaveCount(3);
  // The editor keeps its draft; saving the original name is a change from the entry's current name.
  await expect(row.getByTestId('list-rename-input')).toHaveValue('Regular season');
  await row.getByTestId('list-rename-save').click();
  await expect(row.getByTestId('list-rename-input')).toHaveCount(0);
  await expect.poll(async () => (await get('team/main')).phases.p1).toEqual({ name: 'Regular season' });
});

test('a rename draft survives a snapshot caused by another change', async ({ page }) => {
  await seed('team/main', { roster: [], phases: { p1: { name: 'Regular season' }, p2: { name: 'Play-offs' } } });
  await openCompetitions(page);
  const row = entry(phases(page), 'p1');
  await row.getByTestId('list-rename').click();
  await row.getByTestId('list-rename-input').fill('Draft');
  await page.evaluate(() => { window.__draftInput = document.querySelector('[data-entry-id="p1"] [data-testid="list-rename-input"]'); });
  await update('team/main', { 'phases.p3': { name: 'Final round' } });
  await expect(entries(phases(page))).toHaveCount(3);
  await expect(row.getByTestId('list-rename-input')).toHaveValue('Draft');
  const same = await page.evaluate(() => window.__draftInput === document.querySelector('[data-entry-id="p1"] [data-testid="list-rename-input"]'));
  expect(same).toBe(true);
});

test('Remove is off for an entry a game uses and removes only its own key for an unused one', async ({ page }) => {
  await seed('team/main', {
    roster: [],
    tournaments: { t1: { name: 'Used Cup' }, t2: { name: 'Free Cup' } },
    phases: { p1: { name: 'Used phase' }, p2: { name: 'Free phase' } },
  });
  await seedFinal('g1', { competition: 'tournament', competitionName: 'Used Cup', tournamentId: 't1' });
  await seedFinal('g2', { competition: 'league', phaseId: 'p1' });
  await openCompetitions(page);
  const used = entry(tournaments(page), 't1');
  const free = entry(tournaments(page), 't2');
  await expect(free.getByTestId('list-remove')).toBeEnabled();
  await expect(used.getByTestId('list-remove')).toBeDisabled();
  await expect(used.getByTestId('list-in-use')).toHaveText('Used by games');
  await expect(free.getByTestId('list-in-use')).toBeHidden();
  await expect(entry(phases(page), 'p1').getByTestId('list-remove')).toBeDisabled();
  await expect(entry(phases(page), 'p1').getByTestId('list-in-use')).toBeVisible();
  await expect(entry(phases(page), 'p2').getByTestId('list-remove')).toBeEnabled();

  // A snapshot (here: an unrelated rename elsewhere) must not re-enable the in-use button.
  await update('team/main', { 'phases.p2': { name: 'Free phase 2' } });
  await expect(entry(phases(page), 'p2')).toContainText('Free phase 2');
  await expect(used.getByTestId('list-remove')).toBeDisabled();

  await free.getByTestId('list-remove').click();
  await expect(entries(tournaments(page))).toHaveCount(1);
  await expect.poll(async () => (await get('team/main')).tournaments).toEqual({ t1: { name: 'Used Cup' } });
  expect((await get('team/main')).phases).toEqual({ p1: { name: 'Used phase' }, p2: { name: 'Free phase 2' } });
});

test('Remove checks the server again at the click: an entry a game started to use is kept', async ({ page }) => {
  await seed('team/main', { roster: [], tournaments: { t2: { name: 'Free Cup' } } });
  await openCompetitions(page);
  const row = entry(tournaments(page), 't2');
  await expect(row.getByTestId('list-remove')).toBeEnabled();
  // Another device saves a game with this entry after the screen was opened.
  await seedFinal('g9', { competition: 'tournament', competitionName: 'Free Cup', tournamentId: 't2' });
  await row.getByTestId('list-remove').click();
  await expect(row.getByTestId('list-in-use')).toBeVisible();
  await expect(row.getByTestId('list-remove')).toBeDisabled();
  expect((await get('team/main')).tournaments).toEqual({ t2: { name: 'Free Cup' } });
});

test('every write control is disabled while this device is not in control', async ({ page }) => {
  await seed('team/main', { roster: [], tournaments: { t1: { name: 'Free Cup' } }, phases: { p1: { name: 'Free phase' } } });
  await seedLiveGame();
  await openCompetitions(page, HOME_URL);
  await expect(entry(tournaments(page), 't1').getByTestId('list-remove')).toBeEnabled();
  await otherDeviceTakesControl();
  await expect(page.getByTestId('takeover-banner')).toBeVisible();
  for (const section of [tournaments(page), phases(page)]) {
    await expect(section.getByTestId('list-add-input')).toBeDisabled();
    await expect(section.getByTestId('list-add')).toBeDisabled();
    await expect(entries(section).first().getByTestId('list-rename')).toBeDisabled();
    await expect(entries(section).first().getByTestId('list-remove')).toBeDisabled();
  }
});

test('Remove stays off while offline and comes back with the connection', async ({ page, context }) => {
  await seed('team/main', { roster: [], tournaments: { t1: { name: 'Free Cup' } } });
  await openCompetitions(page);
  const remove = entry(tournaments(page), 't1').getByTestId('list-remove');
  await expect(remove).toBeEnabled();
  await page.getByTestId('nav-home').click();

  // The module is already loaded, so opening the screen offline needs no network for it.
  await context.setOffline(true);
  await expect(page.getByTestId('offline-banner')).toBeVisible();
  await page.getByTestId('home-competitions').click();
  await expect(entry(tournaments(page), 't1')).toBeVisible();
  await expect(remove).toBeDisabled();
  await expect(page.getByTestId('list-check-note')).toBeVisible();

  await context.setOffline(false);
  await expect(remove).toBeEnabled({ timeout: SERVER_WAIT });
  await expect(page.getByTestId('list-check-note')).toBeHidden();
  dropNetworkNoise(problems);
});

test('a check that failed while online is retried without remounting, for the failed entry only', async ({ page }) => {
  const repo = readFileSync('js/repo.js', 'utf8');
  const head = 'async listEntryInUse(';
  expect(repo).toContain(head);
  // The first server check of t1 fails once, as a read error would; every other check is the real thing.
  // Calls are counted per entry id.
  await page.route('**/js/repo.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: repo.replace(head, `async listEntryInUse(list, id) {
      const calls = (window.__useCalls ??= {});
      calls[id] = (calls[id] ?? 0) + 1;
      if (id === 't1' && calls[id] === 1) throw new Error('read failed');
      return this.__realListEntryInUse(list, id);
    },
    async __realListEntryInUse(`),
  }));
  await seed('team/main', { roster: [], tournaments: { t1: { name: 'Free Cup' }, t2: { name: 'Other Cup' } } });
  await openCompetitions(page);
  const remove = entry(tournaments(page), 't1').getByTestId('list-remove');
  await expect(page.getByTestId('list-check-note')).toBeVisible();
  await expect(remove).toBeDisabled();
  // No remount, no offline round trip: the next check succeeds on its own.
  await expect(remove).toBeEnabled({ timeout: SERVER_WAIT });
  await expect(page.getByTestId('list-check-note')).toBeHidden();
  // The retry asked about t1 again and left t2 alone.
  expect(await page.evaluate(() => window.__useCalls)).toEqual({ t1: 2, t2: 1 });
  await remove.click();
  await expect.poll(async () => (await get('team/main')).tournaments).toEqual({ t2: { name: 'Other Cup' } });
});

// A phone holding the previous repo.js has no listEntryInUse: every check reads the whole games list, and what that read
// says replaces what was known for every entry.
test.describe('previous repo.js', () => {
  const previousRepo = () => execSync('git show 67cd574:js/repo.js', { encoding: 'utf8', maxBuffer: 1 << 20 });

  async function serveOld(page, extra = '') {
    const head = 'async listGamesFromServer() {';
    const old = previousRepo();
    expect(old).toContain(head);
    await page.route('**/js/repo.js', route => route.fulfill({
      contentType: 'text/javascript',
      body: old.replace(head, `${head} window.__scans = (window.__scans ?? 0) + 1; ${extra}`),
    }));
  }

  test('a Remove rescans every game, so another entry linked meanwhile shows as in use', async ({ page }) => {
    await serveOld(page);
    await seed('team/main', { roster: [], tournaments: { t1: { name: 'Cup One' }, t2: { name: 'Cup Two' } } });
    await openCompetitions(page);
    const t2 = entry(tournaments(page), 't2');
    await expect(t2.getByTestId('list-remove')).toBeEnabled({ timeout: SERVER_WAIT });
    await expect(entry(tournaments(page), 't1').getByTestId('list-remove')).toBeEnabled();
    // Another device links a game to t2 after the first check.
    await seedFinal('late', { competition: 'tournament', competitionName: 'Cup Two', tournamentId: 't2' });
    await entry(tournaments(page), 't1').getByTestId('list-remove').click();
    await expect.poll(async () => (await get('team/main')).tournaments).toEqual({ t2: { name: 'Cup Two' } });
    await expect(t2.getByTestId('list-in-use')).toBeVisible();
    await expect(t2.getByTestId('list-remove')).toBeDisabled();
  });

  test('a failed scan on Remove turns every removal off and removes nothing', async ({ page }) => {
    // The second scan (the one the click makes) fails; the first and the retry are the real thing.
    await serveOld(page, "if (window.__scans === 2) throw new Error('scan failed');");
    await seed('team/main', { roster: [], tournaments: { t1: { name: 'Cup One' }, t2: { name: 'Cup Two' } } });
    await openCompetitions(page);
    await expect(entry(tournaments(page), 't2').getByTestId('list-remove')).toBeEnabled({ timeout: SERVER_WAIT });
    await entry(tournaments(page), 't1').getByTestId('list-remove').click();
    await expect(page.getByTestId('list-check-note')).toBeVisible();
    await expect(entry(tournaments(page), 't2').getByTestId('list-remove')).toBeDisabled();
    expect(await page.evaluate(() => window.__scans)).toBe(2);
    expect((await get('team/main')).tournaments).toEqual({ t1: { name: 'Cup One' }, t2: { name: 'Cup Two' } });
    // The retry reads again and turns removal back on.
    await expect(entry(tournaments(page), 't2').getByTestId('list-remove')).toBeEnabled({ timeout: SERVER_WAIT });
  });
});

test('at 360 px a 40-character Greek name with Rename and Remove does not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await seed('team/main', { roster: [], tournaments: { t1: { name: LONG_NAME }, t2: { name: 'Free Cup' } }, phases: { p1: { name: LONG_NAME } } });
  await seedFinal('g1', { competition: 'tournament', competitionName: LONG_NAME, tournamentId: 't1' });
  await openCompetitions(page);
  const row = entry(tournaments(page), 't1');
  await expect(row.getByTestId('list-in-use')).toBeVisible();
  const fits = async locator => {
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
  };
  await fits(row.getByTestId('list-rename'));
  await fits(row.getByTestId('list-remove'));
  await fits(row.locator('.list-name'));
  await fits(entry(phases(page), 'p1').getByTestId('list-rename'));
  let scroll = await noSideScroll(page);
  expect(scroll.scroll).toBeLessThanOrEqual(scroll.client);

  await row.getByTestId('list-rename').click();
  await row.getByTestId('list-rename-input').fill(LONG_NAME);
  await fits(row.getByTestId('list-rename-input'));
  await fits(row.getByTestId('list-rename-save'));
  await fits(row.getByTestId('list-rename-cancel'));
  // Layout only: the write of an Add is checked in the Add test.
  await phases(page).getByTestId('list-add-input').fill(LONG_NAME.slice(0, 39));
  await fits(phases(page).getByTestId('list-add-input'));
  await fits(phases(page).getByTestId('list-add'));
  scroll = await noSideScroll(page);
  expect(scroll.scroll).toBeLessThanOrEqual(scroll.client);
});

test('the home row is absent when repo.js lacks competitionLists or app.js lacks the route flag', async ({ page }) => {
  const repo = readFileSync('js/repo.js', 'utf8');
  const app = readFileSync('js/tracker/app.js', 'utf8');
  expect(repo).toContain('competitionLists: true,');
  expect(app).toContain('competitionsRoute: true,');
  await page.route('**/js/repo.js', route => route.fulfill({
    contentType: 'text/javascript', body: repo.replace('competitionLists: true,', ''),
  }));
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await expect(page.getByTestId('home-roster')).toBeVisible();
  await expect(page.getByTestId('home-competitions')).toHaveCount(0);

  await page.unroute('**/js/repo.js');
  await page.route('**/js/tracker/app.js', route => route.fulfill({
    contentType: 'text/javascript', body: app.replace('competitionsRoute: true,', ''),
  }));
  await page.goto(TRACKER_URL);
  await expect(page.getByTestId('home-roster')).toBeVisible();
  await expect(page.getByTestId('home-competitions')).toHaveCount(0);
  dropNetworkNoise(problems); // the second page load aborts the first one's Firestore channels
});

// A fresh page per scenario: a second goto to the same hash would only be a same-document navigation.
async function enterCompetitionsRoute(page) {
  await page.goto(`${TRACKER_URL}#/competitions`);
  await page.getByTestId('code-input').fill(CODE);
  await page.getByTestId('unlock-btn').click();
}

test('entering the route directly shows a muted unavailable line when the gate is off', async ({ page }) => {
  const repo = readFileSync('js/repo.js', 'utf8');
  let served = 0;
  await page.route('**/js/repo.js', route => {
    served += 1;
    return route.fulfill({ contentType: 'text/javascript', body: repo.replace('competitionLists: true,', '') });
  });
  await enterCompetitionsRoute(page);
  await expect(page.getByTestId('competitions-unavailable')).toBeVisible({ timeout: SERVER_WAIT });
  await expect(page.getByTestId('competitions-tournaments')).toHaveCount(0);
  expect(served).toBeGreaterThan(0);
});

test('entering the route directly shows a muted unavailable line when the module fails to load', async ({ page }) => {
  let failed = 0;
  await page.route('**/js/tracker/views/competitions.js', route => {
    failed += 1;
    return route.fulfill({ contentType: 'text/javascript', body: 'throw new Error("module failed");' });
  });
  await enterCompetitionsRoute(page);
  await expect(page.getByTestId('competitions-unavailable')).toBeVisible({ timeout: SERVER_WAIT });
  // The import really went through the failing module, not a cached or never-requested one.
  expect(failed).toBeGreaterThan(0);
  await expect(page.getByTestId('competitions-tournaments')).toHaveCount(0);
  await page.getByTestId('nav-home').click();
  await expect(page.getByTestId('home-roster')).toBeVisible();
  dropNetworkNoise(problems);
});
