import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.js';
import { closeAll, get, noSideScroll, resetAll, seed, update } from './helpers.js';
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

// Wraps listGamesPage: logs each call ({ after, pageSize }) and, for a call that has a gate in window.__gates, keeps
// the answer back (after the read is made) until the test opens the gate. The log gets fromCache when it is delivered.
async function stubPages(page) {
  const real = readFileSync('js/repo.js', 'utf8');
  const head = 'async listGamesPage(';
  expect(real).toContain(head);
  await page.route('**/js/repo.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: real.replace(head, `async listGamesPage(options = {}) {
      const entry = { after: options.after != null, pageSize: options.pageSize ?? 20 };
      (window.__pageLog ??= []).push(entry);
      const gate = window.__gates?.shift();
      const before = window.__befores?.shift(); // holds the read itself, so the server can change first
      if (before) await before;
      const page = await this.__realListGamesPage(options);
      // A test can have the next reads reported as cache answers, to stand for a connection that has not come back yet.
      if (window.__forceCached > 0) { window.__forceCached -= 1; page.fromCache = true; }
      if (gate) await gate;
      entry.fromCache = page.fromCache;
      return page;
    },
    async __realListGamesPage(`),
  }));
}

// 23 games, every one in the cache; then the device goes offline on Home, so the next visit to Past games reads the cache.
async function cacheAllThenGoOffline(page, context) {
  await seedGames();
  await openGames(page);
  await page.getByTestId('games-more').click();
  await expect(rows(page)).toHaveCount(23);
  await page.getByTestId('nav-home').click();
  await context.setOffline(true);
  await expect(page.getByTestId('offline-banner')).toBeVisible();
  await page.getByTestId('home-games').click();
  await expect(rows(page)).toHaveCount(20, { timeout: SERVER_WAIT });
  expect((await page.evaluate(() => window.__pageLog)).at(-1)).toMatchObject({ after: false, fromCache: true });
}

const newGame = () => seed('games/g99', {
  opponent: 'Brand New FC', date: '2026-11-30', season: '2026-27', status: 'final', period: 4, lineup: [], events: [],
});
const expectedIds = (from, to) => Array.from({ length: from - to + 1 }, (_, i) => `#/games/g${pad(from - i)}`);

test('a list with a cached second page reloads when back online: the new game on top, every shown row kept', async ({ page, context }) => {
  await stubPages(page);
  await cacheAllThenGoOffline(page, context);
  await page.getByTestId('games-more').click();
  await expect(rows(page)).toHaveCount(23);
  expect((await page.evaluate(() => window.__pageLog)).at(-1)).toMatchObject({ after: true, fromCache: true });

  await newGame();
  await context.setOffline(false);
  await expect(rows(page).first()).toContainText('Brand New FC', { timeout: SERVER_WAIT });
  // The re-read asked for the 23 rows shown and 20 more, and was cut after the game that was last on screen, so
  // the new game on top pushed nothing out of view and there is nothing more to load.
  const reread = (await page.evaluate(() => window.__pageLog)).filter(call => !call.after).at(-1);
  expect(reread).toMatchObject({ pageSize: 43, fromCache: false });
  expect(await hrefs(page)).toEqual(['#/games/g99', ...expectedIds(23, 1)]);
  await expect(page.getByTestId('games-more')).toBeHidden();
  dropNetworkNoise(problems);
});

test('a cached Show more answer that arrives just after the connection returns still reloads the list', async ({ page, context }) => {
  await stubPages(page);
  await seedGames();
  await openGames(page);
  await page.getByTestId('games-more').click();
  await expect(rows(page)).toHaveCount(23);
  // Back to page one from the server, with every game already in the cache; the connection then drops on the list.
  await page.getByTestId('nav-home').click();
  await page.getByTestId('home-games').click();
  await expect(rows(page)).toHaveCount(20);
  expect((await page.evaluate(() => window.__pageLog)).at(-1)).toMatchObject({ after: false, fromCache: false });
  await context.setOffline(true);
  await expect(page.getByTestId('offline-banner')).toBeVisible();
  // The cached read is made now but its answer is held until after the online event, so the list has no cached page at that moment.
  await page.evaluate(() => { window.__gates = [new Promise(resolve => { window.__open = resolve; })]; });
  await page.getByTestId('games-more').click();
  await newGame();
  await context.setOffline(false);
  await expect(page.getByTestId('offline-banner')).toBeHidden();
  await page.evaluate(() => window.__open());
  await expect(page.getByTestId('game-row').first()).toContainText('Brand New FC', { timeout: SERVER_WAIT });
  expect((await page.evaluate(() => window.__pageLog)).filter(call => call.after).at(-1)).toMatchObject({ fromCache: true });
  dropNetworkNoise(problems);
});

test('a reload that meets a Show more in flight waits for it and keeps the rows it asked for', async ({ page, context }) => {
  await stubPages(page);
  await cacheAllThenGoOffline(page, context);
  await page.evaluate(() => { window.__gates = [new Promise(resolve => { window.__open = resolve; })]; });
  await page.getByTestId('games-more').click();
  await newGame();
  // The connection returns while Show more is still in flight: the reload is due now, not dropped, and does not drop Show more.
  await context.setOffline(false);
  await expect(page.getByTestId('offline-banner')).toBeHidden();
  expect((await page.evaluate(() => window.__pageLog)).filter(call => !call.after)).toHaveLength(2); // one online, one cached
  await page.evaluate(() => window.__open());
  await expect(rows(page).first()).toContainText('Brand New FC', { timeout: SERVER_WAIT });
  const log = await page.evaluate(() => window.__pageLog);
  // The Show more answer was used (23 rows), so the re-read asked for those and 20 more.
  expect(log.at(-1)).toMatchObject({ after: false, pageSize: 43, fromCache: false });
  expect(await hrefs(page)).toEqual(['#/games/g99', ...expectedIds(23, 1)]);
  dropNetworkNoise(problems);
});

test('a cached Show more answer still reloads after the retries ran out and a server answer came', async ({ page }) => {
  test.setTimeout(90000);
  await stubPages(page);
  await seedGames(45);
  await openGames(page);
  await expect(rows(page)).toHaveCount(20);
  // Show more and the first four re-reads are reported as cache answers; the fifth (the last retry) is the server's.
  await page.evaluate(() => { window.__forceCached = 5; });
  await page.getByTestId('games-more').click();
  await expect(rows(page)).toHaveCount(40);
  await expect.poll(() => page.evaluate(() => window.__pageLog.length), { timeout: 30000 }).toBe(7);
  await expect.poll(() => page.evaluate(() => window.__pageLog.at(-1).fromCache), { timeout: 30000 }).toBe(false);
  await expect(page.getByTestId('games-more')).toBeEnabled();
  // The list is complete and the budget is spent. A new game, then a cached Show more answer while online.
  await newGame();
  await page.evaluate(() => { window.__forceCached = 1; });
  await page.getByTestId('games-more').click();
  await expect(rows(page).first()).toContainText('Brand New FC', { timeout: SERVER_WAIT });
  await expect(rows(page)).toHaveCount(46);
});

test('a reload keeps every shown row when the last one moved to the top', async ({ page }) => {
  await stubPages(page);
  await seedGames(45);
  await openGames(page);
  // Show more answers as if from the cache, so the list re-reads from page one; that re-read waits until the test lets it go.
  await page.evaluate(() => {
    window.__forceCached = 1;
    window.__befores = [null, new Promise(resolve => { window.__go = resolve; })];
  });
  await page.getByTestId('games-more').click();
  await expect(rows(page)).toHaveCount(40);
  const shown = await hrefs(page);
  expect(shown.at(-1)).toBe('#/games/g06');
  // The last shown game gets the newest date on the server, then the re-read goes ahead.
  await update('games/g06', { date: '2026-12-31' });
  await page.evaluate(() => window.__go());
  await expect(rows(page).first()).toHaveAttribute('href', '#/games/g06', { timeout: SERVER_WAIT });
  await expect(rows(page)).toHaveCount(40);
  expect(await hrefs(page)).toEqual(['#/games/g06', ...shown.slice(0, -1)]);
  await expect(page.getByTestId('games-more')).toBeVisible();
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

  test('with the previous repo.js the Home count is hidden offline, never read offline, and read again on reconnect', async ({ page, context }) => {
    const old = previous('js/repo.js');
    const head = 'async listGames() {';
    expect(old).toContain(head);
    await serve(page, 'js/repo.js', old.replace(head, `${head} window.__listCalls = (window.__listCalls ?? 0) + 1;`));
    await seedGames();
    await page.goto(HOME_URL);
    await unlockTracker(page);
    const count = page.getByTestId('home-games-count');
    await expect(count).toHaveText('23');
    const online = await page.evaluate(() => window.__listCalls);

    await context.setOffline(true);
    await expect(page.getByTestId('offline-banner')).toBeVisible();
    // The disconnect hides it at once.
    await expect(count).toBeHidden();
    // Home mounted again offline asks for nothing: the previous repo.js would answer from its cache.
    await page.getByTestId('home-roster').click();
    await page.getByTestId('nav-home').click();
    await expect(page.getByTestId('home-roster-count')).toBeVisible();
    expect(await page.evaluate(() => window.__listCalls)).toBe(online);
    await expect(count).toBeHidden();

    await context.setOffline(false);
    await expect(count).toHaveText('23', { timeout: SERVER_WAIT });
    dropNetworkNoise(problems);
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
