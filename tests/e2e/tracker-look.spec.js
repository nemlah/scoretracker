import { test, expect } from '@playwright/test';
import { closeAll, resetAll, seed, update } from './helpers.js';
import { CODE, HOME_URL, collectProblems, unlockTracker } from './tracker-helpers.js';

// The longest seeded Greek names (see tracker-roster), two-digit caps, a two-digit score, every badge.
const longOpponent = 'Πανελλήνιος Γυμναστικός Σύλλογος Πειραιώς Ολυμπιακός';
const roster = [
  { id: 'g13', name: 'Κωνσταντινίδης', cap: 13, archived: false, goalie: true },
  { id: 'g1', name: 'Γεωργίου', cap: 1, archived: false, goalie: true },
  { id: 'p11', name: 'Παπαδόπουλος-Αθανασίου', cap: 11, archived: false },
  { id: 'p10', name: 'Αλεξίου', cap: 10, archived: false },
  { id: 'p5', name: 'Alexiou', cap: 5, archived: false },
  { id: 'p2', name: 'Papadakis', cap: 2, archived: false },
];
const lineup = roster.map(({ id, name, cap, goalie }) => ({
  playerId: id, name, cap, ...(goalie ? { goalie: true } : {}),
}));

let clock = 1000;
const ev = (type, period, playerId) => ({
  id: `e${clock}`, type, period, ts: (clock += 10), ...(playerId ? { playerId } : {}),
});

let problems;
test.beforeEach(async ({ page }) => {
  problems = [];
  collectProblems(page, problems);
  await resetAll();
  await seed('secrets/editCode', { code: CODE });
  await seed('team/main', { roster, currentGameId: 'g1' });
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});
test.afterAll(closeAll);

const tile = (page, cap) => page.locator(`[data-testid="tile"][data-cap="${cap}"]`);
const situation = page => page.getByTestId('situation');
const css = (locator, property) => locator.evaluate((el, name) => getComputedStyle(el)[name], property);

async function openGame(page, game) {
  await seed('games/g1', {
    opponent: 'Seeded FC', date: '2026-11-08', season: '2026-27', status: 'live', period: 1, situations: true, lineup, events: [], ...game,
  });
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await page.getByTestId('home-resume').click();
  await expect(page.getByTestId('score-us')).toBeVisible();
}

// 12-11 after three quarters, caps of two digits, a foul-out, a penalty foul, saves from both goalkeepers.
function richEvents(open) {
  const events = [ev('gkIn', 1, 'g1')];
  for (let i = 0; i < 12; i += 1) events.push(ev('goal', 1 + (i % 3), i % 2 ? 'p11' : 'p10'));
  for (let i = 0; i < 11; i += 1) events.push(ev('oppGoal', 1 + (i % 3)));
  for (let i = 0; i < 14; i += 1) events.push(ev('save', 2, 'g1'));
  events.push(ev('gkIn', 3, 'g13'), ev('save', 3, 'g13'), ev('penSave', 3, 'g13'));
  events.push(ev('excl', 3, 'p11'), ev('excl', 3, 'p11'), ev('excl', 3, 'p11'));
  events.push(ev('pen', 3, 'p5'), ev('excl', 3, 'p5'));
  if (open === 'up') events.push({ id: 'open', type: 'manUp', period: 3, ts: Date.now() - 5000 });
  return events;
}

test('GOAL is the board with amber text', async ({ page }) => {
  await openGame(page, { events: [] });
  const goal = tile(page, 5).getByTestId('tile-goal');
  expect(await css(goal, 'backgroundColor')).toBe('rgb(11, 19, 32)');
  expect(await css(goal, 'color')).toBe('rgb(255, 194, 61)');
  // The header and the score row are the board too, with amber digits.
  expect(await css(page.locator('.live-head'), 'backgroundColor')).toBe('rgb(11, 19, 32)');
  expect(await css(page.locator('.live-top'), 'backgroundColor')).toBe('rgb(11, 19, 32)');
  expect(await css(page.getByTestId('score-us'), 'color')).toBe('rgb(255, 194, 61)');
});

test('PEN is a purple fill, EXCL a red outline', async ({ page }) => {
  await openGame(page, { events: [] });
  const pen = tile(page, 5).getByTestId('tile-pen');
  expect(await css(pen, 'backgroundColor')).toBe('rgb(107, 63, 181)');
  expect(await css(pen, 'color')).toBe('rgb(255, 255, 255)');
  const excl = tile(page, 5).getByTestId('tile-excl');
  expect(await css(excl, 'backgroundColor')).not.toBe('rgb(215, 38, 61)');
  expect(await css(excl, 'borderTopColor')).toBe('rgb(215, 38, 61)');
  expect(await css(excl, 'color')).toBe('rgb(215, 38, 61)');
});

test('SAVE is a teal fill, Pen save a teal outline, ⋯ an ink outline', async ({ page }) => {
  await openGame(page, { events: [ev('gkIn', 1, 'g1')] });
  const goalie = tile(page, 1);
  const save = goalie.getByTestId('tile-save');
  expect(await css(save, 'backgroundColor')).toBe('rgb(11, 110, 127)');
  expect(await css(save, 'color')).toBe('rgb(255, 255, 255)');
  const penSave = goalie.getByTestId('tile-pen-save');
  expect(await css(penSave, 'borderTopColor')).toBe('rgb(11, 110, 127)');
  expect(await css(penSave, 'backgroundColor')).toBe('rgb(255, 255, 255)');
  const more = goalie.getByTestId('tile-more');
  expect(await css(more, 'borderTopColor')).toBe('rgb(11, 19, 32)');
  expect(await css(more, 'backgroundColor')).toBe('rgb(255, 255, 255)');
});

test('foul pips: red for a foul, purple for a penalty foul, grey outline when empty', async ({ page }) => {
  await openGame(page, { events: [ev('pen', 1, 'p5'), ev('excl', 1, 'p5')] });
  const pips = tile(page, 5).locator('.pip');
  await expect(pips).toHaveCount(3);
  // A penalty foul counts toward the limit, so its pip is both on and penalty.
  await expect(tile(page, 5).locator('.pip.is-on')).toHaveCount(2);
  await expect(tile(page, 5).locator('.pip.is-pen')).toHaveCount(1);
  expect(await css(tile(page, 5).locator('.pip.is-on:not(.is-pen)'), 'backgroundColor')).toBe('rgb(215, 38, 61)');
  expect(await css(tile(page, 5).locator('.pip.is-pen'), 'backgroundColor')).toBe('rgb(107, 63, 181)');
  const empty = tile(page, 5).locator('.pip:not(.is-on):not(.is-pen)').first();
  expect(await css(empty, 'backgroundColor')).toBe('rgba(0, 0, 0, 0)');
  expect(await css(empty, 'borderTopColor')).toBe('rgb(122, 135, 150)');
});

// A new game with situations tracked, started through the UI, so the open states are reached by real taps.
async function startGame(page) {
  await seed('team/main', { roster });
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await page.getByTestId('home-new').click();
  await page.getByTestId('opponent-input').fill('Opponent FC');
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('score-us')).toHaveText('0');
  await expect(page.getByTestId('live-situations')).toHaveText('MU 0/0 · MD 0/0');
  await expect(situation(page)).toHaveAttribute('data-state', 'none');
}

test('a man-up is a solid green band with white text on a green page', async ({ page }) => {
  await startGame(page);
  // Nothing open yet: the page is the plain deck.
  expect(await css(page.locator('body'), 'backgroundColor')).toBe('rgb(244, 246, 248)');
  await situation(page).click();
  await expect(situation(page)).toHaveAttribute('data-state', 'manUp');
  expect(await css(situation(page), 'backgroundColor')).toBe('rgb(14, 122, 78)');
  expect(await css(situation(page), 'color')).toBe('rgb(255, 255, 255)');
  expect(await css(situation(page), 'backgroundImage')).toBe('none');
  expect(await css(page.locator('body'), 'backgroundColor')).toBe('rgb(198, 240, 217)');
});

test('a man-down is a hatched orange band with ink text on an orange page', async ({ page }) => {
  await startGame(page);
  await tile(page, 5).getByTestId('tile-excl').click();
  await expect(situation(page)).toHaveAttribute('data-state', 'manDown');
  expect(await css(situation(page), 'backgroundImage')).toContain('repeating-linear-gradient');
  expect(await css(situation(page), 'color')).toBe('rgb(11, 19, 32)');
  expect(await css(page.locator('body'), 'backgroundColor')).toBe('rgb(240, 138, 75)');
  // The band over the board is hatched too, and never moves a box.
  const band = await page.locator('.live-top').evaluate(el => getComputedStyle(el, '::after').backgroundImage);
  expect(band).toContain('repeating-linear-gradient');
});

// The opacity a user sees: an element's own opacity times that of every ancestor.
const effectiveOpacity = locator => locator.evaluate(el => {
  let opacity = 1;
  for (let node = el; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
  return opacity;
});

test('the moved banner is pale amber and the live screen under it is dimmed', async ({ page }) => {
  await openGame(page, { events: [ev('gkIn', 1, 'g1')] });
  // Before the banner nothing is dimmed, so the assertion below can only pass because of it.
  expect(await effectiveOpacity(page.locator('.live-score'))).toBe(1);
  await update('control/tracker', { activeUid: 'another-device' });
  const banner = page.getByTestId('takeover-banner');
  await expect(banner).toBeVisible();
  expect(await css(banner, 'backgroundColor')).toBe('rgb(255, 244, 214)');
  expect(await css(page.getByTestId('take-over'), 'backgroundColor')).toBe('rgb(11, 19, 32)');
  expect(await css(page.getByTestId('take-over'), 'color')).toBe('rgb(255, 194, 61)');
  // The banner and its button stay at full strength; the score row (not a write control) and a tile are at 0.4.
  expect(await effectiveOpacity(banner)).toBe(1);
  expect(await effectiveOpacity(page.getByTestId('take-over'))).toBe(1);
  expect(await effectiveOpacity(page.locator('.live-score'))).toBe(0.4);
  expect(await effectiveOpacity(tile(page, 5))).toBe(0.4);
  // A disabled write control is dimmed once, not twice.
  await expect(tile(page, 5).getByTestId('tile-goal')).toBeDisabled();
  expect(await effectiveOpacity(tile(page, 5).getByTestId('tile-goal'))).toBe(0.4);
  // Take over still works through the dimmed screen: control comes back and the dimming goes.
  await page.getByTestId('take-over').click();
  await expect(banner).toBeHidden();
  await expect.poll(() => effectiveOpacity(page.locator('.live-score'))).toBe(1);
});

test('the unsaved banner is pale red with Retry and Discard', async ({ page }) => {
  await openGame(page, { events: [] });
  // Real failed taps need an offline write that is refused (offline.spec); here the markup app.js builds is put in place.
  await page.evaluate(() => {
    const banner = document.querySelector('[data-testid="failed-banner"]');
    banner.querySelector('.failed-list').innerHTML = `<li class="failed-row" data-testid="failed-row"><p>2 taps not saved <a href="#/games/g1">Open game</a></p><span class="banner-actions"><button type="button" class="btn btn--small" data-testid="retry-failed">Retry</button><button type="button" class="btn btn--small" data-testid="discard-failed">Discard</button></span></li>`;
    banner.hidden = false;
  });
  const banner = page.getByTestId('failed-banner');
  await expect(banner).toBeVisible();
  expect(await css(banner, 'backgroundColor')).toBe('rgb(253, 236, 238)');
  expect(await css(banner, 'borderBottomColor')).toBe('rgb(215, 38, 61)');
  expect(await css(page.getByTestId('retry-failed'), 'backgroundColor')).toBe('rgb(11, 19, 32)');
  expect(await css(page.getByTestId('discard-failed'), 'color')).toBe('rgb(179, 32, 47)');
});

test('the toast is the board', async ({ page }) => {
  await openGame(page, { events: [] });
  await page.evaluate(() => {
    const toast = document.querySelector('[data-testid="toast"]');
    toast.textContent = 'Retrying';
    toast.hidden = false;
  });
  expect(await css(page.getByTestId('toast'), 'backgroundColor')).toBe('rgb(11, 19, 32)');
  expect(await css(page.getByTestId('toast'), 'color')).toBe('rgb(255, 255, 255)');
});

const viewports = [[360, 740, 'portrait'], [740, 360, 'landscape']];
for (const [width, height, name] of viewports) {
  for (const blockFonts of [false, true]) {
    test(`${width} x ${height} (${name}): no sideways scroll, controls 44 px${blockFonts ? ', fonts blocked' : ''}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const blockedUrls = [];
      const fontErrors = [];
      if (blockFonts) {
        await page.route('https://fonts.googleapis.com/**', route => {
          blockedUrls.push(route.request().url());
          return route.abort();
        });
        // Chromium logs an aborted stylesheet as a console error whose location is the blocked URL.
        page.on('console', message => {
          if (message.type() === 'error' && /ERR_FAILED/.test(message.text())
            && /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(message.location().url)) fontErrors.push(`console: ${message.text()}`);
        });
      }
      await openGame(page, { opponent: longOpponent, period: 3, events: richEvents('up') });
      // First the seeded content, so the Greek text is on the page: Google Fonts splits each family into
      // unicode-range subsets and the browser fetches the greek one only once Greek text needs it.
      await expect(page.getByTestId('score-us')).toHaveText('12');
      await expect(page.getByTestId('score-them')).toHaveText('11');
      await expect(page.getByTestId('tile')).toHaveCount(6);
      await expect(situation(page)).toHaveAttribute('data-state', 'manUp');
      await expect(tile(page, 11).getByTestId('tile-out')).toBeVisible();
      await expect(tile(page, 1).getByTestId('tile-save')).toBeVisible();
      await update('control/tracker', { activeUid: 'another-device' });
      await expect(page.getByTestId('takeover-banner')).toBeVisible();
      // Both banners at once, the failed one with its longest wording.
      await page.evaluate(() => {
        const banner = document.querySelector('[data-testid="failed-banner"]');
        banner.querySelector('.failed-list').innerHTML = `<li class="failed-row"><p>12 taps not saved <a href="#/games/g1">Open game</a></p><span class="banner-actions"><button type="button" class="btn btn--small">Retry</button><button type="button" class="btn btn--small">Discard</button></span></li>`;
        banner.hidden = false;
      });
      if (!blockFonts) {
        // Then the fonts, for that very text. check() alone is true when no face matches, so also require a
        // loaded face whose unicode-range covers Greek (U+0370-03FF) in both families.
        const greek = `${longOpponent} Παπαδόπουλος-Αθανασίου Κωνσταντινίδης Γεωργίου Αλεξίου`;
        await page.evaluate(() => document.fonts.ready);
        await expect.poll(() => page.evaluate(async text => {
          await Promise.all([
            document.fonts.load('800 16px "Sofia Sans Extra Condensed"', text),
            document.fonts.load('700 16px "Sofia Sans Extra Condensed"', text),
            document.fonts.load('400 16px "Sofia Sans"', text),
            document.fonts.load('700 16px "Sofia Sans"', text),
          ]);
          const greekFace = family => [...document.fonts].some(face => face.family.replace(/"/g, '') === family
            && face.status === 'loaded' && /U\+0?370/i.test(face.unicodeRange));
          return greekFace('Sofia Sans Extra Condensed') && greekFace('Sofia Sans')
            && document.fonts.check('700 16px "Sofia Sans Extra Condensed"', text)
            && document.fonts.check('400 16px "Sofia Sans"', text);
        }, greek)).toBe(true);
      }
      const measured = await page.evaluate(limit => ({
        scroll: document.scrollingElement.scrollWidth,
        outside: [...document.querySelectorAll('.bar, .banner, .live-top, .live-score, .tile, .tile *, .dock, .dock *')]
          .filter(el => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().right > limit + 0.5)
          .map(el => `${el.className || el.tagName}:${Math.round(el.getBoundingClientRect().right)}`),
        short: [...document.querySelectorAll('button')]
          .filter(el => el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden')
          .map(el => ({ name: `${el.dataset.testid ?? el.className}:${el.textContent.trim().slice(0, 12)}`, height: el.getBoundingClientRect().height }))
          .filter(({ height }) => height < 44),
      }), width);
      expect(measured.outside, 'boxes past the right edge').toEqual([]);
      expect(measured.short, 'buttons under 44 px').toEqual([]);
      expect(measured.scroll, 'scrollWidth').toBeLessThanOrEqual(width);
      if (blockFonts) {
        // The block really happened, and only the failures it caused are forgiven (each by its own URL).
        expect(blockedUrls.length, 'font requests aborted').toBeGreaterThan(0);
        for (const error of fontErrors) problems.splice(problems.indexOf(error), 1);
      }
    });
  }
}

// Every other tracker screen at 360 px: no sideways scroll, controls 44 px.
const screens = [
  ['home', '#/', 'home-new'],
  ['roster', '#/roster', 'roster-list'],
  ['new game', '#/new', 'opponent-input'],
  ['past games', '#/games', 'games-list'],
];
for (const [label, hash, ready] of screens) {
  test(`360 px ${label}: no sideways scroll, controls 44 px`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await seed('games/g1', {
      opponent: longOpponent, date: '2026-11-08', season: '2026-27', status: 'final', period: 4, lineup, events: richEvents(),
    });
    await seed('games/g2', {
      opponent: longOpponent, date: '2026-11-01', season: '2026-27', status: 'live', period: 2, lineup, events: [],
    });
    // A live game blocks "New game", so only the other screens get one.
    if (label !== 'new game') await update('team/main', { currentGameId: 'g2' });
    await page.goto(HOME_URL);
    await unlockTracker(page);
    await page.evaluate(next => { location.hash = next; }, hash);
    await expect(page.getByTestId(ready)).toBeVisible();
    if (hash === '#/games') await expect(page.getByTestId('game-row').first()).toContainText('Πανελλήνιος');
    if (hash === '#/roster') await expect(page.getByTestId('roster-row')).toHaveCount(6);
    const measured = await page.evaluate(() => ({
      scroll: document.scrollingElement.scrollWidth,
      short: [...document.querySelectorAll('button, a.btn, .game-row')]
        .filter(el => el.getBoundingClientRect().width > 0)
        .map(el => ({ name: `${el.dataset.testid ?? el.className}`, height: el.getBoundingClientRect().height }))
        .filter(({ height }) => height < 44),
    }));
    expect(measured.short, 'controls under 44 px').toEqual([]);
    expect(measured.scroll, 'scrollWidth').toBeLessThanOrEqual(360);
  });
}

test('the unlock screen is the board with an amber code field', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(HOME_URL);
  await expect(page.getByTestId('code-input')).toBeVisible();
  expect(await css(page.locator('body'), 'backgroundColor')).toBe('rgb(11, 19, 32)');
  expect(await css(page.getByTestId('code-input'), 'color')).toBe('rgb(255, 194, 61)');
  expect(await css(page.getByTestId('code-input'), 'borderTopColor')).toBe('rgb(255, 194, 61)');
  expect(await page.evaluate(() => document.scrollingElement.scrollWidth)).toBeLessThanOrEqual(360);
});
