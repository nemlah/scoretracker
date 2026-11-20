import { test, expect } from './fixtures.js';
import { closeAll, get, openLiveGame, recordedHome, recordHome, resetAll, seed, update } from './helpers.js';
import { CODE, HOME_URL, TRACKER_URL, collectProblems, dropNetworkNoise, reloadTracker, unlockTracker } from './tracker-helpers.js';

const ORIGIN = 'http://127.0.0.1:4173';
const VIEWER_URL = '/index.html?emulator=1';
const roster = [
  { id: 'p2', name: 'Papadakis', cap: 2, archived: false },
  { id: 'p5', name: 'Alexiou', cap: 5, archived: false },
];
const OFFLINE_TEXT = 'offline — taps saved, will sync';

// Service workers and offline emulation are only exercised meaningfully in Chromium.
test.skip(({ browserName }) => browserName !== 'chromium', 'service worker + offline emulation are verified in chromium only');

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
const goal = page => tile(page, 5).getByTestId('tile-goal');
const swReady = page => page.evaluate(async () => { await navigator.serviceWorker.ready; });
const activeUid = async () => (await get('control/tracker'))?.activeUid;

async function waitForHolder() {
  await expect.poll(activeUid).toBeTruthy();
  return activeUid();
}

async function waitForTakeover(aUid) {
  await expect.poll(async () => {
    const uid = await activeUid();
    return Boolean(uid) && uid !== aUid;
  }).toBe(true);
}

// Google Fonts is answered by the test, so these tests never wait for (or fail on) the real service. The
// stylesheet is a plain @font-face on a system font, so no font file is asked for; the font host answers an
// empty file all the same, if one ever is. `hits` lists every request that reached the stub, whoever made it:
// the page on its first load, the worker when it fetches for its cache. After the page has gone offline a
// new hit would mean the network was asked again, so the cache did not serve it.
const FONT_STYLES = "@font-face { font-family: 'Sofia Sans'; font-weight: 400 700; src: local('Arial'), local('Helvetica'); }";
async function stubFonts(context) {
  const hits = [];
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => {
    const url = route.request().url();
    hits.push(url);
    return url.startsWith('https://fonts.googleapis.com/')
      ? route.fulfill({ contentType: 'text/css', body: FONT_STYLES })
      : route.fulfill({ contentType: 'font/woff2', headers: { 'access-control-allow-origin': '*' }, body: '' });
  });
  return hits;
}
// The worker stores a Google Fonts file only when a page it controls asks for it, and it answers before
// its cache write is done. Everything the page asked for from Google Fonts must be in the shell cache before
// the test goes offline, so this polls the shell cache itself.
const watchFonts = page => {
  const urls = new Set();
  page.on('request', request => { if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(request.url())) urls.add(request.url()); });
  return urls;
};
const fontsCached = (page, urls) => expect.poll(async () => {
  // A font asked for while the page loads fonts is recorded before this wait returns, so the list is
  // taken after it, on every round.
  await page.evaluate(() => document.fonts.ready);
  const list = [...urls];
  if (list.length === 0) return 'no font request';
  return page.evaluate(async wanted => {
    const shell = await Promise.all((await caches.keys()).filter(name => name.startsWith('wp-shell-')).map(name => caches.open(name)));
    const missing = [];
    for (const url of wanted) {
      const hits = await Promise.all(shell.map(cache => cache.match(url, { ignoreVary: true })));
      if (!hits.some(Boolean)) missing.push(url);
    }
    return missing.length === 0 ? 'cached' : `not cached: ${missing.join(' ')}`;
  }, list);
}, { message: 'everything the page asked for from Google Fonts is in the shell cache' }).toBe('cached');

async function startGame(page, date) {
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await page.getByTestId('home-new').click();
  await page.getByTestId('opponent-input').fill('Opponent FC');
  if (date) await page.getByTestId('date-input').fill(date);
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('score-us')).toHaveText('0');
  await expect.poll(async () => (await get('team/main'))?.currentGameId).toBeTruthy();
  return (await get('team/main')).currentGameId;
}

test('reloads offline into the live game with all taps', async ({ page, context, browser }) => {
  await startGame(page);
  // Different players: the same player tapped twice in a row is treated as a double tap.
  await tile(page, 2).getByTestId('tile-goal').click();
  await goal(page).click();
  await expect(page.getByTestId('score-us')).toHaveText('2');
  await swReady(page);
  // The first load is not controlled until the worker claims it; a reload hands the shell to it.
  await reloadTracker(page, problems);
  await expect(page.getByTestId('score-us')).toHaveText('2');
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await context.setOffline(true);
  await tile(page, 2).getByTestId('tile-goal').click();
  await expect(page.getByTestId('sync-status')).toHaveText(OFFLINE_TEXT);
  await expect(page.getByTestId('score-us')).toHaveText('3');

  await reloadTracker(page, problems);
  await expect(page.getByTestId('score-us')).toHaveText('3');
  await expect(page.getByTestId('sync-status')).toHaveText(OFFLINE_TEXT);

  await context.setOffline(false);
  const viewerContext = await browser.newContext({ baseURL: ORIGIN });
  try {
    const viewer = await viewerContext.newPage();
    collectProblems(viewer, problems);
    await openLiveGame(viewer);
    await expect(viewer.getByTestId('score-us')).toHaveText('3', { timeout: 10000 });
  } finally {
    await viewerContext.close();
  }
  dropNetworkNoise(problems);
});

test('the viewer shows the connection note offline and hides it after reconnecting', async ({ page, context }) => {
  await seed('team/main', { roster, currentGameId: 'g1' });
  await seed('games/g1', {
    opponent: 'Opponent FC', date: '2026-11-08', season: '2026-27', status: 'live', period: 1,
    lineup: [{ playerId: 'p5', name: 'Alexiou', cap: 5 }], events: [],
  });
  await openLiveGame(page);
  await expect(page.getByTestId('score-us')).toHaveText('0');
  await expect(page.getByTestId('connection-note')).toBeHidden();
  await context.setOffline(true);
  await expect(page.getByTestId('connection-note')).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByTestId('connection-note')).toBeHidden();
  dropNetworkNoise(problems);
});

test('the viewer reopens offline from the cached shell', async ({ page, context }) => {
  const stubbed = await stubFonts(context);
  const fonts = watchFonts(page);
  await page.goto(VIEWER_URL);
  await expect(page.getByTestId('results-empty')).toBeVisible();
  await swReady(page);
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expect(page.getByTestId('results-empty')).toBeVisible();
  await fontsCached(page, fonts);
  const asked = stubbed.length;
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('connection-note')).toBeVisible();
  // The stylesheet came from the shell cache: nothing asked the stub again.
  expect(stubbed.length, 'Google Fonts was not asked again offline').toBe(asked);
  await context.setOffline(false);
  dropNetworkNoise(problems);
});

test('home reopens offline from cached results, with the connection note and no empty or loading flash', async ({ page, context }) => {
  await seed('team/main', { roster, currentGameId: 'g1' });
  await seed('games/g1', {
    opponent: 'Rivals', date: '2019-11-01', season: '2019-20', status: 'final', period: 4,
    lineup: [{ playerId: 'p5', name: 'Alexiou', cap: 5 }], events: [],
  });
  await seed('stats/2019-20', { results: [{ gameId: 'g1', date: '2019-11-01', opponent: 'Rivals', us: 2, them: 1 }] });
  const stubbed = await stubFonts(context);
  const fonts = watchFonts(page);
  await page.goto(VIEWER_URL);
  await expect(page.getByTestId('games-list')).toHaveAttribute('data-results', 'ready');
  await swReady(page);
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expect(page.getByTestId('games-list')).toHaveAttribute('data-results', 'ready');
  await fontsCached(page, fonts);
  const asked = stubbed.length;
  // Firestore keeps what it has seen; the page after this reload is a new load with no connection.
  await context.setOffline(true);
  await recordHome(page);
  await page.reload();
  await expect(page.getByTestId('connection-note')).toBeVisible();
  await expect(page.getByTestId('games-list')).toHaveAttribute('data-results', 'ready');
  await expect(page.getByTestId('games-list')).toHaveAttribute('data-season', '2019-20');
  await expect(page.getByTestId('result-row')).toHaveCount(1);
  const { pairs, states } = await recordedHome(page);
  // A new load starts on loading; from the first results on nothing else may be shown.
  for (const list of [pairs, states]) {
    const first = list.findIndex(entry => entry.results === 'ready');
    expect(first, JSON.stringify(list)).toBeGreaterThanOrEqual(0);
    expect(list.slice(first), JSON.stringify(list)).toEqual([list[first]]);
    // (The attributes are set one at a time, so a loading entry can briefly have no results value yet.)
    expect(list.slice(0, first).every(entry => ['', 'loading'].includes(entry.results)), JSON.stringify(list)).toBe(true);
  }
  expect(states.at(-1)).toEqual({ season: '2019-20', results: 'ready', first: 'Rivals' });
  expect(stubbed.length, 'Google Fonts was not asked again offline').toBe(asked);
  await context.setOffline(false);
  dropNetworkNoise(problems);
});

test('taps after losing control are flagged, retried after taking back', async ({ page, context, browser }) => {
  const gameId = await startGame(page, '2026-11-16');
  const aUid = await waitForHolder();
  const contextB = await browser.newContext({ baseURL: ORIGIN });
  const viewerContext = await browser.newContext({ baseURL: ORIGIN });
  try {
    const viewer = await viewerContext.newPage();
    collectProblems(viewer, problems);
    await openLiveGame(viewer);
    await expect(viewer.getByTestId('score-us')).toHaveText('0');

    // Device A loses its signal and taps. The three taps are only in A's cache and journal.
    await context.setOffline(true);
    await expect(page.getByTestId('sync-status')).toHaveText(OFFLINE_TEXT);
    await goal(page).click();
    await tile(page, 2).getByTestId('tile-goal').click();
    await page.getByTestId('opp-goal').click();
    await expect(page.getByTestId('score-us')).toHaveText('2');
    await expect(page.getByTestId('score-them')).toHaveText('1');

    // Device B unlocks and takes over while A is away.
    const pageB = await contextB.newPage();
    collectProblems(pageB, problems);
    await pageB.goto(HOME_URL);
    await unlockTracker(pageB);
    await waitForTakeover(aUid);

    // A comes back: its queued write is refused by the rules.
    await context.setOffline(false);
    await expect(page.getByTestId('takeover-banner')).toBeVisible();
    const row = page.getByTestId('failed-row');
    const desc = row.getByTestId('failed-desc');
    const retry = row.getByTestId('retry-failed');
    const discard = row.getByTestId('discard-failed');
    await expect(row.getByTestId('failed-title')).toHaveText('3 taps not saved', { timeout: 15000 });
    await expect(row.getByTestId('failed-icon')).toHaveAttribute('aria-hidden', 'true');
    await expect(row.getByTestId('failed-game-link')).toHaveCount(0);
    const labels = 'Goal · #5 Alexiou, Goal · #2 Papadakis +1 more';
    await expect(desc).toHaveText(`16/11/2026 · Opponent FC: ${labels}`);
    await expect(retry).toBeDisabled();
    await expect(discard).toBeEnabled();
    const retryBox = await retry.boundingBox();
    const discardBox = await discard.boundingBox();
    expect(retryBox.height).toBeGreaterThanOrEqual(47.5);
    expect(retryBox.height).toBeLessThanOrEqual(48.5);
    expect(discardBox.height).toBeGreaterThanOrEqual(47.5);
    expect(discardBox.height).toBeLessThanOrEqual(48.5);
    expect(retryBox.width).toBeCloseTo(discardBox.width, 0);
    expect(retryBox.y).toBe(discardBox.y);
    const rowBox = await row.boundingBox();
    expect(retryBox.x).toBeCloseTo(rowBox.x, 0);
    expect(discardBox.x + discardBox.width).toBeCloseTo(rowBox.x + rowBox.width, 0);
    await expect(viewer.getByTestId('score-us')).toHaveText('0');
    expect((await get(`games/${gameId}`)).events).toEqual([]);

    // A fresh game snapshot changes the description while both action buttons stay in the DOM.
    const buttons = { retry: await retry.elementHandle(), discard: await discard.elementHandle() };
    await update(`games/${gameId}`, { opponent: 'Corrected FC' });
    await expect(desc).toHaveText(`16/11/2026 · Corrected FC: ${labels}`);
    expect(await retry.evaluate((el, before) => el === before, buttons.retry)).toBe(true);
    expect(await discard.evaluate((el, before) => el === before, buttons.discard)).toBe(true);

    // A takes control back and retries the refused taps.
    await page.getByTestId('take-over').click();
    await expect(page.getByTestId('takeover-banner')).toBeHidden();
    await retry.click();
    await expect.poll(async () => (await get(`games/${gameId}`)).events.map(e => [e.type, e.playerId ?? null])).toEqual([
      ['goal', 'p5'], ['goal', 'p2'], ['oppGoal', null],
    ]);
    await expect(viewer.getByTestId('score-us')).toHaveText('2', { timeout: 10000 });
    await expect(viewer.getByTestId('score-them')).toHaveText('1');
    await expect(page.getByTestId('failed-banner')).toBeHidden();
    await expect(page.getByTestId('score-us')).toHaveText('2');
  } finally {
    await contextB.close();
    await viewerContext.close();
  }
  dropNetworkNoise(problems);
});

test('a refused goal and its refused scorer change are retried as one goal with the new scorer', async ({ page, context, browser }) => {
  const gameId = await startGame(page);
  const aUid = await waitForHolder();
  const contextB = await browser.newContext({ baseURL: ORIGIN });
  const viewerContext = await browser.newContext({ baseURL: ORIGIN });
  try {
    const viewer = await viewerContext.newPage();
    collectProblems(viewer, problems);
    await openLiveGame(viewer);
    await expect(viewer.getByTestId('score-us')).toHaveText('0');

    // Device A goes offline, taps a goal for Alexiou, then changes the scorer to Papadakis.
    await context.setOffline(true);
    await expect(page.getByTestId('sync-status')).toHaveText(OFFLINE_TEXT);
    await goal(page).click();
    await expect(page.getByTestId('score-us')).toHaveText('1');
    await page.getByTestId('events-open').click();
    await expect(page.getByTestId('events-sheet')).toBeVisible();
    await expect(page.getByTestId('ev-row')).toHaveCount(1);
    await expect(page.getByTestId('ev-scorer')).toHaveValue('p5');
    await page.getByTestId('ev-scorer').selectOption('p2');
    await expect(page.getByTestId('ev-scorer')).toHaveValue('p2');
    await page.getByTestId('events-close').click();
    await expect(page.getByTestId('events-sheet')).toBeHidden();
    await expect(page.getByTestId('score-us')).toHaveText('1');

    // Device B unlocks and takes over while A is away.
    const pageB = await contextB.newPage();
    collectProblems(pageB, problems);
    await pageB.goto(HOME_URL);
    await unlockTracker(pageB);
    await waitForTakeover(aUid);

    // A comes back: both queued writes are refused by the rules.
    await context.setOffline(false);
    await expect(page.getByTestId('takeover-banner')).toBeVisible();
    await expect(page.getByTestId('failed-banner')).toContainText('1 tap not saved', { timeout: 15000 });
    await expect(viewer.getByTestId('score-us')).toHaveText('0');
    expect((await get(`games/${gameId}`)).events).toEqual([]);

    // A takes control back and retries: one goal, with the new scorer.
    await page.getByTestId('take-over').click();
    await expect(page.getByTestId('takeover-banner')).toBeHidden();
    await page.getByTestId('retry-failed').click();
    await expect(page.getByTestId('failed-banner')).toBeHidden({ timeout: 10000 });
    await expect.poll(async () => (await get(`games/${gameId}`)).events.map(e => [e.type, e.playerId])).toEqual([['goal', 'p2']]);
    await expect(viewer.getByTestId('score-us')).toHaveText('1', { timeout: 10000 });
    await expect(page.getByTestId('score-us')).toHaveText('1');
    await expect.poll(() => journalOf(page)).toBe('[]');
  } finally {
    await contextB.close();
    await viewerContext.close();
  }
  dropNetworkNoise(problems);
});

test('a connection with no data serves the cached shell after the timeout', async ({ page, context }) => {
  await startGame(page);
  await tile(page, 2).getByTestId('tile-goal').click();
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await swReady(page);
  await reloadTracker(page, problems);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  // Signal bars but no data: same-origin requests (the worker's own included) never answer.
  const hung = [];
  await context.route(`${ORIGIN}/**`, route => { hung.push(route); });
  await page.reload({ waitUntil: 'commit' });
  await expect(page.getByTestId('score-us')).toHaveText('1', { timeout: 6000 });
  expect(hung.length).toBeGreaterThan(0);
  await context.unroute(`${ORIGIN}/**`);
  for (const route of hung) await route.abort().catch(() => {});
  dropNetworkNoise(problems);
});

// Loads the tracker so the worker has cached the shell and controls the page.
async function cacheShell(page) {
  await startGame(page);
  await tile(page, 2).getByTestId('tile-goal').click();
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await swReady(page);
  await reloadTracker(page, problems);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
}

test('an upstream 503 on a shell file is served from the cache instead', async ({ page, context }) => {
  await cacheShell(page);
  let refused = 0;
  await context.route(`${ORIGIN}/js/tracker/views/live.js`, route => {
    refused += 1;
    return route.fulfill({ status: 503, body: 'unavailable' });
  });
  await context.route(`${ORIGIN}/track.html*`, route => {
    refused += 1;
    return route.fulfill({ status: 503, body: 'unavailable' });
  });
  await page.reload();
  await expect(page.getByTestId('score-us')).toHaveText('1');
  expect(refused).toBeGreaterThan(1);
  await context.unroute(`${ORIGIN}/js/tracker/views/live.js`);
  await context.unroute(`${ORIGIN}/track.html*`);
  dropNetworkNoise(problems);
});

test('a slow successful response is stored and becomes the next offline response', async ({ page, context }) => {
  await page.goto(VIEWER_URL);
  await expect(page.getByTestId('results-empty')).toBeVisible();
  await swReady(page);
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  // The server answers after the worker's timeout, with a visibly newer page.
  await context.route(`${ORIGIN}/index.html*`, async route => {
    const response = await route.fetch();
    await new Promise(resolve => setTimeout(resolve, 4000));
    const body = (await response.text()).replace('<main id="app"', '<main data-shell="refreshed" id="app"');
    await route.fulfill({ response, body });
  });
  await page.reload();
  await expect(page.locator('#app')).not.toHaveAttribute('data-shell', 'refreshed');
  await expect.poll(() => page.evaluate(async () => {
    const { scope } = await navigator.serviceWorker.getRegistration();
    const cached = await (await caches.open(`wp-shell-v3::${scope}`)).match('/index.html');
    return (await cached.text()).includes('data-shell="refreshed"');
  }), { timeout: 10000 }).toBe(true);
  await context.unroute(`${ORIGIN}/index.html*`);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-shell', 'refreshed');
  await context.setOffline(false);
  dropNetworkNoise(problems);
});

const lostGoalIds = journal => JSON.parse(journal ?? '[]').map(entry => entry.gameId);
const journalOf = page => page.evaluate(() => localStorage.getItem('wp-journal'));
const lineupP5 = [{ playerId: 'p5', name: 'Alexiou', cap: 5 }];
const NEXT_GAME = {
  opponent: 'Next FC', date: '2099-01-01', season: '2098-99', status: 'live', period: 1, lineup: lineupP5, events: [],
};

// Device A taps offline on game G while device B takes over; A's writes are refused when it reconnects.
async function refusedWhileAway(page, context, browser) {
  const gameId = await startGame(page);
  const aUid = await waitForHolder();
  const contextB = await browser.newContext({ baseURL: ORIGIN });
  await context.setOffline(true);
  await expect(page.getByTestId('sync-status')).toHaveText(OFFLINE_TEXT);
  await goal(page).click();
  await expect(page.getByTestId('score-us')).toHaveText('1');
  const pageB = await contextB.newPage();
  collectProblems(pageB, problems);
  await pageB.goto(HOME_URL);
  await unlockTracker(pageB);
  await waitForTakeover(aUid);
  return { gameId, contextB };
}

// The game being watched changes while the refused taps wait: a newer game becomes current.
async function startNextGame() {
  await seed('games/next', NEXT_GAME);
  await update('team/main', { currentGameId: 'next' });
}

test('refused taps stay visible and recoverable after the current game has changed and the tracker was reopened', async ({ page, context, browser }) => {
  const { gameId, contextB } = await refusedWhileAway(page, context, browser);
  try {
    await context.setOffline(false);
    await expect(page.getByTestId('failed-banner')).toContainText('1 tap not saved', { timeout: 15000 });
    await page.close();

    await startNextGame();
    const reopened = await context.newPage();
    collectProblems(reopened, problems);
    await reopened.goto(TRACKER_URL);
    // The live game is "next" now, and the refused tap of the earlier game is still offered.
    await expect(reopened.getByTestId('score-us')).toHaveText('0');
    await expect(reopened.getByTestId('failed-banner')).toContainText('1 tap not saved');
    await expect(reopened.getByTestId('failed-desc')).toBeHidden();
    await expect(reopened.getByTestId('failed-game-link')).toHaveAttribute('href', `#/games/${gameId}`);
    // The link is a 44 x 44 target (the banner is the real one, built by a refused tap).
    const linkBox = await reopened.getByTestId('failed-game-link').boundingBox();
    expect(linkBox.width, 'View game width').toBeGreaterThanOrEqual(44);
    expect(linkBox.height, 'View game height').toBeGreaterThanOrEqual(44);
    await reopened.getByTestId('take-over').click();
    await reopened.getByTestId('retry-failed').click();
    await expect.poll(async () => (await get(`games/${gameId}`)).events.length).toBe(1);
    await expect(reopened.getByTestId('failed-banner')).toBeHidden();
    await expect.poll(() => journalOf(reopened)).toBe('[]');
  } finally {
    await contextB.close();
  }
  dropNetworkNoise(problems);
});

test('taps still waiting when the tracker closed are settled on the next start, whichever game is current', async ({ page, context, browser }) => {
  const { gameId, contextB } = await refusedWhileAway(page, context, browser);
  try {
    // Closed while offline: the tap is only in the journal and the SDK's queue.
    expect(lostGoalIds(await journalOf(page))).toEqual([gameId]);
    await page.close();
    await startNextGame();
    await context.setOffline(false);
    const reopened = await context.newPage();
    collectProblems(reopened, problems);
    await reopened.goto(TRACKER_URL);
    await expect(reopened.getByTestId('score-us')).toHaveText('0');
    await expect(reopened.getByTestId('failed-banner')).toContainText('1 tap not saved', { timeout: 20000 });
    await expect(reopened.getByTestId('failed-game-link')).toHaveAttribute('href', `#/games/${gameId}`);
    expect((await get(`games/${gameId}`)).events).toEqual([]);
  } finally {
    await contextB.close();
  }
  dropNetworkNoise(problems);
});

test('taps on a game whose offline creation was refused can only be discarded', async ({ page, context, browser }) => {
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  const aUid = await waitForHolder();
  await context.setOffline(true);
  await page.getByTestId('home-new').click();
  await page.getByTestId('opponent-input').fill('Ghost FC');
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('score-us')).toHaveText('0');
  await goal(page).click();
  await expect(page.getByTestId('score-us')).toHaveText('1');

  const contextB = await browser.newContext({ baseURL: ORIGIN });
  try {
    const pageB = await contextB.newPage();
    collectProblems(pageB, problems);
    await pageB.goto(HOME_URL);
    await unlockTracker(pageB);
    await waitForTakeover(aUid);
    await context.setOffline(false);

    // The creation is refused, so the game never exists on the server.
    await expect(page.getByTestId('failed-banner')).toContainText('1 tap not saved', { timeout: 20000 });
    await expect(page.getByTestId('failed-gone')).toContainText('no longer exists');
    await expect(page.getByTestId('failed-game-link')).toHaveCount(0);
    // The game does not exist, so none is live: no banner, and the touch on Retry takes control.
    await expect(page.getByTestId('takeover-banner')).toBeHidden();
    await page.getByTestId('retry-failed').click();
    await expect(page.getByTestId('toast')).toContainText('no longer exists');
    await expect(page.getByTestId('failed-banner')).toBeVisible();
    await page.getByTestId('discard-failed').click();
    await expect(page.getByTestId('failed-banner')).toBeHidden();
    await expect.poll(() => journalOf(page)).toBe('[]');
  } finally {
    await contextB.close();
  }
  dropNetworkNoise(problems);
});

// Firestore's streams stay open; holding their requests is "signal bars but no data".
const FIRESTORE_STREAMS = '**/google.firestore.v1.Firestore/**';
const FIRESTORE_WRITES = '**/google.firestore.v1.Firestore/Write/**';
async function releaseHeld(context, pattern, held) {
  await context.unroute(pattern);
  for (const route of held) await route.continue().catch(() => {});
}

test('the sync line says connecting until the server answers, then online', async ({ page, context }) => {
  await startGame(page);
  await tile(page, 2).getByTestId('tile-goal').click();
  await expect.poll(() => journalOf(page)).toBe('[]');
  await expect(page.getByTestId('sync-status')).toHaveText('online');
  await swReady(page);
  await reloadTracker(page, problems);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expect(page.getByTestId('score-us')).toHaveText('1');

  const held = [];
  await context.route(FIRESTORE_STREAMS, route => { held.push(route); });
  await reloadTracker(page, problems);
  // The cached game shows, but nothing has been confirmed by the server yet.
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await expect(page.getByTestId('sync-status')).toHaveText('connecting…');
  await releaseHeld(context, FIRESTORE_STREAMS, held);
  await expect(page.getByTestId('sync-status')).toHaveText('online', { timeout: 20000 });
  dropNetworkNoise(problems);
});

test('writes the server has not answered show the offline text, and online returns once it does', async ({ page, context }) => {
  await startGame(page);
  await expect(page.getByTestId('sync-status')).toHaveText('online');
  const held = [];
  await context.route(FIRESTORE_WRITES, route => { held.push(route); });
  await goal(page).click();
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await expect(page.getByTestId('sync-status')).toHaveText(OFFLINE_TEXT, { timeout: 8000 });
  await releaseHeld(context, FIRESTORE_WRITES, held);
  await expect(page.getByTestId('sync-status')).toHaveText('online', { timeout: 20000 });
  dropNetworkNoise(problems);
});
