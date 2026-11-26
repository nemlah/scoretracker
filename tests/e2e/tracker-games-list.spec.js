import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.js';
import { closeAll, get, noSideScroll, resetAll, seed } from './helpers.js';
import {
  CODE, HOME_URL, SERVER_WAIT, collectProblems, dropNetworkNoise, unlockTracker,
} from './tracker-helpers.js';

// Paths are read from the release before this fix, for the tests of a phone that mixes releases.
const PREVIOUS = '67cd574';
const previous = path => execSync(`git show ${PREVIOUS}:${path}`, { encoding: 'utf8', maxBuffer: 1 << 20 });

const LONG_OPPONENT = 'Ολυμπιακός Σύνδεσμος Φιλάθλων Πειραιώς';
const pad = n => String(n).padStart(2, '0');

// Route interception and the per-file stubs need the service worker out of the way.
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

// g01..g23, the highest id the newest.
async function seedGames(count = 23, extra = () => ({})) {
  for (let i = 1; i <= count; i += 1) {
    await seed(`games/g${pad(i)}`, {
      opponent: `Rival ${pad(i)}`, date: `2026-10-${pad(i)}`, season: '2026-27', status: 'final', period: 4,
      lineup: [], events: [], ...extra(i),
    });
  }
}

async function openGames(page) {
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await page.getByTestId('home-games').click();
  await expect(page.getByTestId('games-list')).toBeVisible();
}

const rows = page => page.getByTestId('game-row');
const hrefs = page => rows(page).evaluateAll(list => list.map(el => el.getAttribute('href')));

test('Past games shows 20 games and Show more loads the rest', async ({ page }) => {
  await seedGames();
  await openGames(page);
  await expect(rows(page)).toHaveCount(20);
  const more = page.getByTestId('games-more');
  await expect(more).toBeVisible();
  await expect(more).toHaveText('Show more');
  await expect(rows(page).first()).toContainText('Rival 23');
  await more.click();
  await expect(rows(page)).toHaveCount(23);
  await expect(more).toBeHidden();
  await expect(rows(page).last()).toContainText('Rival 01');
});

test('a double click on Show more adds each game once', async ({ page }) => {
  await seedGames();
  await openGames(page);
  await expect(rows(page)).toHaveCount(20);
  await page.getByTestId('games-more').dblclick();
  await expect(rows(page)).toHaveCount(23);
  await expect(page.getByTestId('games-more')).toBeHidden();
  const links = await hrefs(page);
  expect(new Set(links).size).toBe(23);
});

for (const scheme of ['light', 'dark']) {
  test.describe(`${scheme} colour scheme`, () => {
    test.use({ colorScheme: scheme });

    test('Past games with Show more fits 360 px', async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await seedGames(23, i => (i === 23 ? { opponent: LONG_OPPONENT } : {}));
      await openGames(page);
      const long = rows(page).first();
      await expect(long).toContainText(LONG_OPPONENT);
      await expect(long).toBeVisible();
      const more = page.getByTestId('games-more');
      await more.scrollIntoViewIfNeeded();
      await expect(more).toBeVisible();
      const box = await more.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(360);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(740);
      const rowBox = await long.boundingBox();
      expect(rowBox.x).toBeGreaterThanOrEqual(0);
      expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(360);
      expect(await noSideScroll(page)).toEqual({ scroll: 360, client: 360 });
      await more.click();
      await expect(rows(page)).toHaveCount(23);
      expect(await noSideScroll(page)).toEqual({ scroll: 360, client: 360 });
    });
  });
}

test('a list built offline reloads from page one when back online', async ({ page, context }) => {
  const real = readFileSync('js/repo.js', 'utf8');
  const head = 'async listGamesPage(';
  expect(real).toContain(head);
  // Records, per call, whether the first page came from the cache.
  await page.route('**/js/repo.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: real.replace(head, `async listGamesPage(...args) {
      const page = await this.__realListGamesPage(...args);
      (window.__pageCalls ??= []).push({ after: args[0]?.after != null, fromCache: page.fromCache });
      return page;
    },
    async __realListGamesPage(`),
  }));
  await seedGames(5);
  await openGames(page);
  await expect(rows(page)).toHaveCount(5);
  await page.getByTestId('nav-home').click();

  await context.setOffline(true);
  await expect(page.getByTestId('offline-banner')).toBeVisible();
  await page.getByTestId('home-games').click();
  await expect(rows(page)).toHaveCount(5, { timeout: SERVER_WAIT });
  const calls = await page.evaluate(() => window.__pageCalls);
  expect(calls.at(-1)).toEqual({ after: false, fromCache: true });

  await seed('games/g99', {
    opponent: 'Brand New FC', date: '2026-11-30', season: '2026-27', status: 'final', period: 4, lineup: [], events: [],
  });
  await context.setOffline(false);
  await expect(rows(page).first()).toContainText('Brand New FC', { timeout: SERVER_WAIT });
  await expect(rows(page)).toHaveCount(6);
  expect((await page.evaluate(() => window.__pageCalls)).at(-1)).toEqual({ after: false, fromCache: false });
  dropNetworkNoise(problems);
});

test('an invalid game route shows the not-found state without an error', async ({ page }) => {
  await page.goto(HOME_URL);
  await unlockTracker(page);
  for (const hash of ['#/games/a%2Fb', '#/games/a/b']) {
    await page.evaluate(h => { location.hash = h; }, hash);
    await expect(page.getByText('This game no longer exists.')).toBeVisible();
    await expect(page.getByTestId('game-score')).toBeHidden();
    await page.evaluate(() => { location.hash = '#/'; });
    await expect(page.getByTestId('home-new')).toBeVisible();
  }
  // A real game whose id is a word the view also uses still opens as that game.
  await seed('games/list', {
    opponent: 'Word FC', date: '2026-10-05', season: '2026-27', status: 'final', period: 4, lineup: [], events: [],
  });
  await page.evaluate(() => { location.hash = '#/games/list'; });
  await expect(page.getByTestId('game-score')).toBeVisible();
  await expect(page.getByTestId('games-list')).toBeHidden();
});

test.describe('mixed module cache', () => {
  async function serve(page, path, body) {
    await page.route(`**/${path}`, route => route.fulfill({ contentType: 'text/javascript', body }));
  }

  test('with the previous repo.js: Past games lists all 23, Home counts 23, Competitions checks entries', async ({ page }) => {
    await serve(page, 'js/repo.js', previous('js/repo.js'));
    await seed('team/main', { roster: [], tournaments: { t1: { name: 'Linked Cup' }, t2: { name: 'Free Cup' } } });
    await seedGames(23, i => (i === 1 ? { competition: 'tournament', competitionName: 'Linked Cup', tournamentId: 't1' } : {}));
    await page.goto(HOME_URL);
    await unlockTracker(page);
    await expect(page.getByTestId('home-games-count')).toHaveText('23');

    await page.getByTestId('home-competitions').click();
    const tournaments = page.getByTestId('competitions-tournaments');
    const linked = tournaments.locator('[data-entry-id="t1"]');
    const free = tournaments.locator('[data-entry-id="t2"]');
    await expect(linked.getByTestId('list-in-use')).toBeVisible({ timeout: SERVER_WAIT });
    await expect(linked.getByTestId('list-remove')).toBeDisabled();
    await expect(free.getByTestId('list-remove')).toBeEnabled({ timeout: SERVER_WAIT });
    await free.getByTestId('list-remove').click();
    await expect.poll(async () => (await get('team/main')).tournaments).toEqual({ t1: { name: 'Linked Cup' } });

    await page.getByTestId('nav-home').click();
    await page.getByTestId('home-games').click();
    await expect(rows(page)).toHaveCount(23);
    await expect(page.getByTestId('games-more')).toBeHidden();
  });

  test('with the previous games.js: Past games lists all 23', async ({ page }) => {
    await serve(page, 'js/tracker/views/games.js', previous('js/tracker/views/games.js'));
    await seedGames();
    await openGames(page);
    await expect(rows(page)).toHaveCount(23);
  });

  test('with the previous strings.js: Show more still reads Show more, with no missing-string warning', async ({ page }) => {
    const warnings = [];
    page.on('console', message => { if (message.type() === 'warning' && /Missing string/.test(message.text())) warnings.push(message.text()); });
    await serve(page, 'js/strings.js', previous('js/strings.js'));
    await seedGames();
    await openGames(page);
    await expect(rows(page)).toHaveCount(20);
    await expect(page.getByTestId('games-more')).toHaveText('Show more');
    expect(warnings).toEqual([]);
  });

  test('with the previous model.js: an invalid game route is still not found', async ({ page }) => {
    await serve(page, 'js/model.js', previous('js/model.js'));
    await page.goto(HOME_URL);
    await unlockTracker(page);
    await page.evaluate(() => { location.hash = '#/games/a%2Fb'; });
    await expect(page.getByText('This game no longer exists.')).toBeVisible();
    await page.evaluate(() => { location.hash = '#/games/a/b'; });
    await expect(page.getByText('This game no longer exists.')).toBeVisible();
  });
});
