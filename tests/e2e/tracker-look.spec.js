import { execFileSync } from 'node:child_process';
import { test, expect } from './fixtures.js';
import { isPlaywrightServiceWorkerBlock } from './network-noise.js';
import { closeAll, cssColour, resetAll, seed, update } from './helpers.js';
import { CODE, HOME_URL, collectProblems, formatConsoleProblem, otherDeviceTakesControl, unlockTracker } from './tracker-helpers.js';
import { team } from '../../js/config.js';
import { contrastRatio } from '../../js/accent.js';

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
  expect(await cssColour(goal, 'backgroundColor')).toBe('rgb(11, 19, 32)');
  expect(await cssColour(goal, 'color')).toBe('rgb(255, 194, 61)');
  // The header and the score row are the board too, with amber digits.
  expect(await cssColour(page.locator('.live-head'), 'backgroundColor')).toBe('rgb(11, 19, 32)');
  expect(await cssColour(page.locator('.live-top'), 'backgroundColor')).toBe('rgb(11, 19, 32)');
  expect(await cssColour(page.getByTestId('score-us'), 'color')).toBe('rgb(255, 194, 61)');
});

test('the live screen has no lane rope', async ({ page }) => {
  await openGame(page, { events: [] });
  await expect(page.getByTestId('score-us')).toBeVisible();
  await expect(page.locator('.rope')).toHaveCount(0);
});

test('PEN is a purple fill, EXCL a red outline', async ({ page }) => {
  await openGame(page, { events: [] });
  const pen = tile(page, 5).getByTestId('tile-pen');
  expect(await cssColour(pen, 'backgroundColor')).toBe('rgb(107, 63, 181)');
  expect(await cssColour(pen, 'color')).toBe('rgb(255, 255, 255)');
  const excl = tile(page, 5).getByTestId('tile-excl');
  expect(await cssColour(excl, 'backgroundColor')).not.toBe('rgb(215, 38, 61)');
  expect(await cssColour(excl, 'borderTopColor')).toBe('rgb(215, 38, 61)');
  expect(await cssColour(excl, 'color')).toBe('rgb(215, 38, 61)');
});

test('SAVE is a teal fill, Pen save a teal outline, ⋯ an ink outline', async ({ page }) => {
  await openGame(page, { events: [ev('gkIn', 1, 'g1')] });
  const goalie = tile(page, 1);
  const save = goalie.getByTestId('tile-save');
  expect(await cssColour(save, 'backgroundColor')).toBe('rgb(11, 110, 127)');
  expect(await cssColour(save, 'color')).toBe('rgb(255, 255, 255)');
  const penSave = goalie.getByTestId('tile-pen-save');
  expect(await cssColour(penSave, 'borderTopColor')).toBe('rgb(11, 110, 127)');
  expect(await cssColour(penSave, 'backgroundColor')).toBe('rgb(255, 255, 255)');
  const more = goalie.getByTestId('tile-more');
  expect(await cssColour(more, 'borderTopColor')).toBe('rgb(11, 19, 32)');
  expect(await cssColour(more, 'backgroundColor')).toBe('rgb(255, 255, 255)');
});

test('foul pips: red for a foul, purple for a penalty foul, grey outline when empty', async ({ page }) => {
  await openGame(page, { events: [ev('pen', 1, 'p5'), ev('excl', 1, 'p5')] });
  const pips = tile(page, 5).locator('.pip');
  await expect(pips).toHaveCount(3);
  // A penalty foul counts toward the limit, so its pip is both on and penalty.
  await expect(tile(page, 5).locator('.pip.is-on')).toHaveCount(2);
  await expect(tile(page, 5).locator('.pip.is-pen')).toHaveCount(1);
  expect(await cssColour(tile(page, 5).locator('.pip.is-on:not(.is-pen)'), 'backgroundColor')).toBe('rgb(215, 38, 61)');
  expect(await cssColour(tile(page, 5).locator('.pip.is-pen'), 'backgroundColor')).toBe('rgb(107, 63, 181)');
  const empty = tile(page, 5).locator('.pip:not(.is-on):not(.is-pen)').first();
  expect(await cssColour(empty, 'backgroundColor')).toBe('rgba(0, 0, 0, 0)');
  expect(await cssColour(empty, 'borderTopColor')).toBe('rgb(122, 135, 150)');
});

// A new game with situations tracked, started through the UI, so the open states are reached by real taps.
async function startGame(page) {
  await seed('team/main', { roster });
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await page.getByTestId('home-new').click();
  await page.getByTestId('opponent-input').fill('Opponent FC');
  await page.getByTestId('newgame-next').click();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('score-us')).toHaveText('0');
  await expect(page.getByTestId('live-situations')).toHaveText('MU 0/0 · MD 0/0');
  await expect(situation(page)).toHaveAttribute('data-state', 'none');
}

test('a man-up is a solid green band with white text on a green page', async ({ page }) => {
  await startGame(page);
  // Nothing open yet: the page is the plain deck.
  expect(await cssColour(page.locator('body'), 'backgroundColor')).toBe('rgb(244, 246, 248)');
  await situation(page).click();
  await expect(situation(page)).toHaveAttribute('data-state', 'manUp');
  expect(await cssColour(situation(page), 'backgroundColor')).toBe('rgb(14, 122, 78)');
  expect(await cssColour(situation(page), 'color')).toBe('rgb(255, 255, 255)');
  expect(await cssColour(situation(page), 'backgroundImage')).toBe('none');
  expect(await cssColour(page.locator('body'), 'backgroundColor')).toBe('rgb(198, 240, 217)');
});

test('a man-down is a hatched orange band with ink text on an orange page', async ({ page }) => {
  await startGame(page);
  await tile(page, 5).getByTestId('tile-excl').click();
  await expect(situation(page)).toHaveAttribute('data-state', 'manDown');
  expect(await cssColour(situation(page), 'backgroundImage')).toContain('repeating-linear-gradient');
  expect(await cssColour(situation(page), 'color')).toBe('rgb(11, 19, 32)');
  expect(await cssColour(page.locator('body'), 'backgroundColor')).toBe('rgb(240, 138, 75)');
  await expect(page.getByTestId('situation-band')).toHaveAttribute('data-state', 'manDown');
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
  await otherDeviceTakesControl();
  const banner = page.getByTestId('takeover-banner');
  await expect(banner).toBeVisible();
  expect(await cssColour(banner, 'backgroundColor')).toBe('rgb(255, 244, 214)');
  expect(await cssColour(page.getByTestId('take-over'), 'backgroundColor')).toBe('rgb(11, 19, 32)');
  expect(await cssColour(page.getByTestId('take-over'), 'color')).toBe('rgb(255, 194, 61)');
  // The banner and its button stay at full strength; the score row (not a write control) and a tile are at 0.4.
  expect(await effectiveOpacity(banner)).toBe(1);
  expect(await effectiveOpacity(page.getByTestId('take-over'))).toBe(1);
  expect(await effectiveOpacity(page.locator('.live-score'))).toBe(0.4);
  expect(await effectiveOpacity(tile(page, 5))).toBe(0.4);
  // A disabled write control is dimmed once, not twice.
  await expect(tile(page, 5).getByTestId('tile-goal')).toBeDisabled();
  expect(await effectiveOpacity(tile(page, 5).getByTestId('tile-goal'))).toBe(0.4);
  // The Events button stays at full strength, and so does the sheet it opens (a sibling of the dimmed content).
  expect(await effectiveOpacity(page.getByTestId('events-open'))).toBe(1);
  await page.getByTestId('events-open').click();
  await expect(page.getByTestId('events-sheet')).toBeVisible();
  expect(await effectiveOpacity(page.getByTestId('events-sheet'))).toBe(1);
  expect(await effectiveOpacity(page.getByTestId('events-close'))).toBe(1);
  // A disabled button in the sheet keeps the normal disabled look (0.4, once), not full strength.
  const sheetDisabled = page.getByTestId('events-sheet').locator('button:disabled:visible');
  expect(await sheetDisabled.count(), 'the sheet has a visible disabled button while tracking is elsewhere').toBeGreaterThan(0);
  expect(await effectiveOpacity(sheetDisabled.first())).toBe(0.4);
  await page.getByTestId('events-close').click();
  await expect(page.getByTestId('events-sheet')).toBeHidden();
  // Take over still works through the dimmed screen: control comes back and the dimming goes.
  await page.getByTestId('take-over').click();
  await expect(banner).toBeHidden();
  await expect.poll(() => effectiveOpacity(page.locator('.live-score'))).toBe(1);
});

test('the tracker header shows a 32 px decorative team crest before the name', async ({ page }) => {
  await openGame(page, { events: [] });
  const crest = page.getByTestId('tracker-crest');
  await expect(crest).toBeVisible();
  await expect(crest).toHaveAttribute('src', team.crest);
  await expect(crest).toHaveAttribute('alt', '');
  await expect(crest).toHaveAttribute('width', '32');
  await expect(crest).toHaveAttribute('height', '32');
  expect(await crest.boundingBox()).toMatchObject({ width: 32, height: 32 });
  const brand = page.locator('header.bar > .bar-brand');
  await expect(brand.locator('img.bar-crest + h1.brand')).toHaveText(team.name);
  await expect(page.locator('header.bar > .bar-brand + [data-testid="nav-home"]')).toHaveText('Home');
  await crest.dispatchEvent('error');
  await expect(crest).toBeHidden();
});

test('the unlock crest is 120 px above the existing heading', async ({ page }) => {
  await page.goto(HOME_URL);
  const crest = page.getByTestId('unlock-crest');
  await expect(crest).toBeVisible();
  await expect(crest).toHaveAttribute('src', team.crest);
  await expect(crest).toHaveAttribute('alt', '');
  const crestBox = await crest.boundingBox();
  expect(crestBox).toMatchObject({ width: 120, height: 120 });
  const heading = page.getByRole('heading', { name: 'Enter the tracker code', exact: true });
  expect((await heading.boundingBox()).y).toBeGreaterThanOrEqual(crestBox.y + crestBox.height);
  await expect(page.getByText('The code is 6 letters and digits.', { exact: true })).toBeVisible();
  await crest.dispatchEvent('error');
  await expect(crest).toBeHidden();
});

test('the toast is the board', async ({ page }) => {
  await openGame(page, { events: [] });
  await page.evaluate(() => {
    const toast = document.querySelector('[data-testid="toast"]');
    toast.textContent = 'Retrying';
    toast.hidden = false;
  });
  expect(await cssColour(page.getByTestId('toast'), 'backgroundColor')).toBe('rgb(11, 19, 32)');
  expect(await cssColour(page.getByTestId('toast'), 'color')).toBe('rgb(255, 255, 255)');
});

const viewports = [[360, 740, 'portrait'], [740, 360, 'landscape']];
for (const [width, height, name] of viewports) {
  for (const blockFonts of [false, true]) {
    test(`${width} x ${height} (${name}): no sideways scroll, controls 44 px${blockFonts ? ', fonts blocked' : ''}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      // Open with failed taps from an earlier session so the real banner is laid out under the moved banner.
      await page.addInitScript(() => {
        const entries = Array.from({ length: 12 }, (_, i) => ({
          id: `failed-${i}`, gameId: 'g1', op: 'add', status: 'failed',
          event: { id: `offline-${i}`, type: 'goal', period: 3, ts: i, playerId: 'p11' },
        }));
        localStorage.setItem('wp-journal', JSON.stringify(entries));
      });
      const blockedUrls = [];
      const fontErrors = [];
      if (blockFonts) {
        await page.route('https://fonts.googleapis.com/**', route => {
          blockedUrls.push(route.request().url());
          return route.abort();
        });
        // Chromium logs an aborted stylesheet as a console error whose location is the blocked URL.
        page.on('console', message => {
          const text = message.text();
          if (isPlaywrightServiceWorkerBlock(text)) return;
          const { url } = message.location();
          if (message.type() === 'error' && /ERR_FAILED/.test(text)
            && /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url)) fontErrors.push(formatConsoleProblem(text, url));
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
      await otherDeviceTakesControl();
      await expect(page.getByTestId('takeover-banner')).toBeVisible();
      await expect(page.getByTestId('failed-desc')).toHaveText(
        `08/11/2026 · ${longOpponent}: Goal · #11 Παπαδόπουλος-Αθανασίου, Goal · #11 Παπαδόπουλος-Αθανασίου +10 more`,
      );
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
        for (const error of fontErrors) {
          const index = problems.indexOf(error);
          if (index !== -1) problems.splice(index, 1);
        }
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
  expect(await cssColour(page.locator('body'), 'backgroundColor')).toBe('rgb(11, 19, 32)');
  expect(await cssColour(page.getByTestId('code-input'), 'color')).toBe('rgb(255, 194, 61)');
  expect(await cssColour(page.getByTestId('code-input'), 'borderTopColor')).toBe('rgb(255, 194, 61)');
  expect(await page.evaluate(() => document.scrollingElement.scrollWidth)).toBeLessThanOrEqual(360);
});

// Short landscape (a phone on its side): the header, the score, the band and the dock stand in a left column
// of at most 300 px; the tiles fill the rest in two columns and scroll on their own.
for (const [width, height] of [[844, 390], [667, 375]]) {
  test(`${width} x ${height} landscape: left column of header, score, band and dock; two columns of tiles`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openGame(page, { period: 3, events: richEvents('up') });
    await expect(page.getByTestId('score-us')).toHaveText('12');
    await expect(page.getByTestId('situation-band')).toBeVisible();
    await expect(page.getByTestId('tile')).toHaveCount(6);
    const left = {
      bar: await page.locator('header.bar').boundingBox(),
      top: await page.locator('.live-top--board').boundingBox(),
      band: await page.getByTestId('situation-band').boundingBox(),
      dock: await page.locator('.dock').boundingBox(),
    };
    for (const [name, box] of Object.entries(left)) {
      expect(box.x, `${name} starts at the left edge`).toBeLessThanOrEqual(0.5);
      expect(box.x + box.width, `${name} is no wider than 300 px`).toBeLessThanOrEqual(300.5);
    }
    // One stack: header, then the score row (with the band inside it), then the dock at the foot.
    expect(left.top.y).toBeGreaterThanOrEqual(left.bar.y + left.bar.height - 0.5);
    expect(left.band.y).toBeGreaterThan(left.top.y);
    expect(left.band.y + left.band.height).toBeLessThanOrEqual(left.top.y + left.top.height + 0.5);
    expect(left.dock.y).toBeGreaterThanOrEqual(left.top.y + left.top.height - 0.5);
    expect(left.dock.y + left.dock.height).toBeLessThanOrEqual(height + 0.5);
    // The R2 strips drawn over the score row and the dock are not the band's duplicate.
    for (const [selector, pseudo] of [['.live-top--board', '::after'], ['.dock', '::before']]) {
      expect(await page.locator(selector).evaluate((el, p) => getComputedStyle(el, p).content, pseudo), `${selector}${pseudo}`).toBe('none');
    }
    // The tiles sit to the right of the column, two to a row.
    const field = [tile(page, 10), tile(page, 5), tile(page, 2), tile(page, 11)];
    const boxes = [];
    for (const locator of field) boxes.push(await locator.boundingBox());
    for (const box of boxes) expect(box.x).toBeGreaterThanOrEqual(left.dock.x + left.dock.width - 0.5);
    expect(boxes.filter(box => Math.abs(box.y - boxes[0].y) < 1).length, 'tiles sharing the first row').toBe(2);
    expect(new Set(boxes.map(box => Math.round(box.x))).size, 'two columns').toBe(2);
    expect(Math.max(...boxes.map(box => box.x + box.width)), 'tiles stay inside the screen').toBeLessThanOrEqual(width);

    const controls = await page.evaluate(() => ({
      scroll: document.scrollingElement.scrollWidth,
      docks: ['situation', 'opp-goal', 'undo', 'events-open', 'period-next'].map(id => {
        const rect = document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect();
        return { id, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, height: rect.height };
      }),
    }));
    expect(controls.scroll, 'scrollWidth').toBeLessThanOrEqual(width);
    for (const control of controls.docks) {
      expect(control.height, `${control.id} height`).toBeGreaterThanOrEqual(44);
      expect(control.left, `${control.id} left`).toBeGreaterThanOrEqual(0);
      expect(control.right, `${control.id} right`).toBeLessThanOrEqual(300.5);
      expect(control.top, `${control.id} top`).toBeGreaterThanOrEqual(0);
      expect(control.bottom, `${control.id} bottom`).toBeLessThanOrEqual(height + 0.5);
    }
    // Every tile button, on a goalie and on a field tile, is a 44 px target in both directions.
    const narrow = await page.getByTestId('tiles').evaluate(el => [...el.querySelectorAll('button')]
      .filter(button => getComputedStyle(button).visibility !== 'hidden' && button.getBoundingClientRect().width > 0)
      .map(button => ({ name: `${button.dataset.testid}:${button.closest('.tile').dataset.cap}`, ...button.getBoundingClientRect().toJSON() }))
      .filter(({ width, height }) => width < 43.5 || height < 43.5)
      .map(({ name, width, height }) => `${name} ${Math.round(width)}x${Math.round(height)}`));
    expect(narrow, 'tile buttons under 44 px').toEqual([]);
    expect(await tile(page, 13).getByTestId('tile-pen-save').count(), 'a goalie tile is checked').toBe(1);
    // The tile list scrolls inside its own pane, and a tile at the end can be brought fully into view.
    const pane = await page.getByTestId('tiles').evaluate(el => ({ scrolls: el.scrollHeight > el.clientHeight, overflow: getComputedStyle(el).overflowY }));
    expect(pane.overflow).toBe('auto');
    expect(pane.scrolls, 'six tiles do not fit one screen height').toBe(true);
    await tile(page, 1).scrollIntoViewIfNeeded();
    const last = await tile(page, 1).boundingBox();
    expect(last.y).toBeGreaterThanOrEqual(0);
    expect(last.y + last.height).toBeLessThanOrEqual(height + 0.5);
    expect(await page.evaluate(() => document.scrollingElement.scrollHeight), 'the page itself does not scroll').toBeLessThanOrEqual(height);
  });
}

// A phone can hold the previous release's live.js next to this stylesheet. The landscape rules are scoped to
// body.live-r3, which only the new live.js sets, so the old module keeps its one-row dock and reaches every control.
test.describe('mixed cache: R2 live.js under the R3 stylesheet, landscape', () => {
  test.use({ serviceWorkers: 'block' });
  for (const [width, height] of [[844, 390], [667, 375]]) {
    test(`${width} x ${height}: the dock buttons are visible and 44 px, and the last tile clears the dock`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      let served = 0;
      const previous = execFileSync('git', ['show', '720f124:js/tracker/views/live.js'], { encoding: 'utf8' });
      await page.route('**/js/tracker/views/live.js*', route => {
        served += 1;
        return route.fulfill({ contentType: 'text/javascript', body: previous });
      });
      await openGame(page, { period: 3, events: richEvents('up') });
      await expect(page.getByTestId('score-us')).toHaveText('12');
      expect(served, 'the R2 live.js was served').toBeGreaterThan(0);
      await expect(page.locator('.live-top--board'), 'the R2 markup has no board header').toHaveCount(0);
      await expect(page.locator('body.live-r3')).toHaveCount(0);
      await expect(page.locator('.dock')).toHaveCSS('position', 'fixed');
      for (const id of ['situation', 'opp-goal', 'undo', 'events-open']) {
        const button = page.getByTestId(id);
        await expect(button, id).toBeVisible();
        const box = await button.boundingBox();
        expect(box.height, `${id} height`).toBeGreaterThanOrEqual(44);
        expect(box.x, `${id} left`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${id} right`).toBeLessThanOrEqual(width);
        expect(box.y + box.height, `${id} bottom`).toBeLessThanOrEqual(height + 0.5);
        await button.click({ trial: true });
      }
      // Scrolled to the end, the last tile ends above the dock.
      await tile(page, 1).scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
      const lastTile = await tile(page, 1).boundingBox();
      const dock = await page.locator('.dock').boundingBox();
      expect(lastTile.y + lastTile.height).toBeLessThanOrEqual(dock.y + 0.5);
      expect(await page.evaluate(() => document.scrollingElement.scrollWidth), 'scrollWidth').toBeLessThanOrEqual(width);
    });
  }
});

// ---- 360 px worst case, light, in every club colour --------------------------------------------------------
const greekName = 'Παναγιώτης Παπαδόπουλος';
const worstLineup = [
  { playerId: 'g13', name: greekName, cap: 13, goalie: true },
  { playerId: 'p11', name: greekName, cap: 11 },
  { playerId: 'p10', name: 'Αλεξίου', cap: 10 },
];
const ACCENTS = ['#0057b8', '#c8102e', '#f2b705', '#00843d'];

// Every box that has width stays left of the viewport edge, nothing scrolls sideways.
const overflowing = (page, width) => page.evaluate(limit => ({
  scroll: document.scrollingElement.scrollWidth,
  outside: [...document.querySelectorAll('body *')]
    .filter(el => el.getBoundingClientRect().width > 0 && getComputedStyle(el).position !== 'fixed' && el.getBoundingClientRect().right > limit + 0.5
      && !el.closest('.sheet-backdrop[hidden]'))
    .map(el => `${el.className || el.tagName}:${Math.round(el.getBoundingClientRect().right)}`),
}), width);

// A name that is cut with an ellipsis on one line: it has more text than room, one line of height, and it ends before the box beside it.
async function expectEllipsised(locator, label, beside = null) {
  const m = await locator.evaluate(el => {
    const style = getComputedStyle(el);
    return {
      cut: el.scrollWidth > el.clientWidth,
      ellipsis: style.textOverflow === 'ellipsis' && style.whiteSpace === 'nowrap' && style.overflow !== 'visible',
      lines: el.getBoundingClientRect().height / parseFloat(style.lineHeight),
      right: el.getBoundingClientRect().right,
    };
  });
  expect(m.cut, `${label}: scrollWidth > clientWidth`).toBe(true);
  expect(m.ellipsis, `${label}: ellipsis on one line`).toBe(true);
  expect(m.lines, `${label}: one line`).toBeLessThan(1.5);
  if (beside) expect(m.right, `${label} ends before the next box`).toBeLessThanOrEqual((await beside.boundingBox()).x + 0.5);
}

async function expectButtons44(page) {
  const short = await page.evaluate(() => [...document.querySelectorAll('button, a.btn, .game-row')]
    .filter(el => el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden')
    .map(el => ({ name: `${el.dataset.testid ?? el.className}:${el.textContent.trim().slice(0, 12)}`, height: el.getBoundingClientRect().height }))
    .filter(({ height }) => height < 44));
  expect(short, 'buttons under 44 px').toEqual([]);
}

test('360 px live worst case: two-digit caps, a long Greek name, three pips, a two-digit goal count, man-down band, unsaved banner', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.addInitScript(() => {
    const entries = Array.from({ length: 12 }, (_, i) => ({
      id: `failed-${i}`, gameId: 'g1', op: 'add', status: 'failed',
      event: { id: `offline-${i}`, type: 'goal', period: 3, ts: i, playerId: 'p11' },
    }));
    localStorage.setItem('wp-journal', JSON.stringify(entries));
  });
  const events = [ev('gkIn', 3, 'g13')];
  for (let i = 0; i < 12; i += 1) events.push(ev('goal', 1 + (i % 3), 'p11'));
  for (let i = 0; i < 14; i += 1) events.push(ev('save', 3, 'g13'));
  events.push(ev('penSave', 3, 'g13'), ev('excl', 3, 'p11'), ev('excl', 3, 'p11'), ev('pen', 3, 'p11'));
  events.push({ id: 'down', type: 'manDown', period: 3, ts: Date.now() - 5000 });
  await openGame(page, { opponent: longOpponent, period: 3, lineup: worstLineup, events });
  await expect(page.getByTestId('score-us')).toHaveText('12');
  await expect(page.getByTestId('situation-band')).toHaveAttribute('data-state', 'manDown');
  await expect(page.getByTestId('failed-banner')).toBeVisible();
  await expect(tile(page, 11).locator('.pip.is-on')).toHaveCount(3);
  await expect(tile(page, 11).getByTestId('tile-goals')).toHaveText('12');
  await expect(tile(page, 11).getByTestId('tile-out')).toBeVisible();
  await expect(tile(page, 13).getByTestId('tile-saves')).toContainText('14');
  await page.evaluate(() => document.fonts.ready);

  const measured = await overflowing(page, 360);
  expect(measured.scroll, 'scrollWidth').toBeLessThanOrEqual(360);
  expect(measured.outside, 'boxes past the right edge').toEqual([]);
  await expectEllipsised(tile(page, 11).locator('.tile-name'), 'field tile name', tile(page, 11).locator('.tile-stats'));
  await expectEllipsised(tile(page, 13).locator('.tile-name'), 'goalie tile name', tile(page, 13).locator('.in-goal-slot'));
  // The longest saves line stays on one line inside the goalie tile.
  const saves = await tile(page, 13).getByTestId('tile-saves').evaluate(el => ({
    lines: el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight), right: el.getBoundingClientRect().right,
  }));
  expect(saves.lines, 'saves line height in lines').toBeLessThan(1.5);
  expect(saves.right, 'saves line ends inside the tile').toBeLessThanOrEqual((await tile(page, 13).boundingBox()).x + (await tile(page, 13).boundingBox()).width);
  await expectButtons44(page);
  // The tile's own buttons are all inside the tile.
  const tileBox = await tile(page, 11).boundingBox();
  for (const id of ['tile-goal', 'tile-excl', 'tile-pen']) {
    const box = await tile(page, 11).getByTestId(id).boundingBox();
    expect(box.x, `${id} left`).toBeGreaterThanOrEqual(tileBox.x);
    expect(box.x + box.width, `${id} right`).toBeLessThanOrEqual(tileBox.x + tileBox.width + 0.5);
  }
  // The cap chip reads at 4.5:1 in every club colour; the layout does not depend on the colour.
  for (const accent of ACCENTS) {
    await page.evaluate(async value => {
      document.documentElement.style.setProperty('--accent', value);
      const { applyAccentPair } = await import('/js/accent.js');
      applyAccentPair(document.documentElement.style, value);
    }, accent);
    const cap = tile(page, 10).locator('.cap--tile');
    const [fill, text] = await Promise.all([cssColour(cap, 'backgroundColor'), cssColour(cap, 'color')]);
    const rgb = value => value.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    const hex = value => `#${rgb(value).map(c => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
    expect(hex(fill), `cap fill is ${accent}`).toBe(accent);
    expect(contrastRatio(hex(text), hex(fill)), `cap text on ${accent}`).toBeGreaterThanOrEqual(4.5);
    expect((await overflowing(page, 360)).scroll, `scrollWidth with ${accent}`).toBeLessThanOrEqual(360);
  }
});

test('360 px events sheet: a long Greek goal label is cut and Change scorer stays at 44 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const events = [ev('gkIn', 1, 'g13'), ev('goal', 1, 'p11'), ev('goal', 2, 'p11')];
  await openGame(page, { opponent: longOpponent, period: 2, lineup: worstLineup, events });
  await page.getByTestId('events-open').click();
  const sheet = page.getByTestId('events-sheet');
  await expect(sheet).toBeVisible();
  const rows = sheet.getByTestId('ev-row');
  await expect(rows).toHaveCount(3);
  const row = rows.filter({ hasText: greekName }).first();
  await expectEllipsised(row.locator('.ev-label'), 'event label', row.getByTestId('ev-edit'));
  const edit = row.getByTestId('ev-edit');
  await expect(edit).toBeVisible();
  const box = await edit.boundingBox();
  expect(box.height, 'Change scorer height').toBeGreaterThanOrEqual(44);
  expect(box.x + box.width, 'Change scorer stays on screen').toBeLessThanOrEqual(360);
  await edit.click();
  await expect(row.getByTestId('ev-scorer')).toBeVisible();
  const panel = await sheet.evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(panel.scroll, 'the sheet does not scroll sideways').toBeLessThanOrEqual(panel.client);
  expect((await overflowing(page, 360)).scroll).toBeLessThanOrEqual(360);
  await expectButtons44(page);
});

test('360 px home: the live card cuts a long Greek opponent; nav rows and New game are 44 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await seed('games/g1', {
    opponent: `${greekName} ${longOpponent}`, date: '2026-11-08', season: '2026-27', status: 'live', period: 3, lineup: worstLineup, events: richEvents(),
  });
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await expect(page.getByTestId('home-live')).toBeVisible();
  // The same page at 360 and 390 px (resized, not reloaded).
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 740 });
    await expectEllipsised(page.locator('.home-live-opponent'), `home live opponent at ${width}`);
    await expect(page.getByTestId('home-live-score')).toBeVisible();
    for (const id of ['home-new', 'home-roster', 'home-games', 'home-resume']) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box.height, `${id} height at ${width}`).toBeGreaterThanOrEqual(44);
    }
    const measured = await overflowing(page, width);
    expect(measured.scroll, `scrollWidth at ${width}`).toBeLessThanOrEqual(width);
    expect(measured.outside, `boxes past the right edge at ${width}`).toEqual([]);
    await expectButtons44(page);
  }
});

test('360 px past games: a shootout row keeps its chip, cut name and score on screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const shootout = Array.from({ length: 7 }, (_, i) => ev(i < 4 ? 'goal' : 'oppGoal', 'SO', i < 4 ? 'p11' : undefined));
  await seed('games/g1', {
    opponent: `${greekName} ${longOpponent}`, date: '2026-11-08', season: '2026-27', status: 'final', period: 'SO', lineup: worstLineup,
    events: [ev('goal', 4, 'p11'), ev('oppGoal', 4), ...shootout],
  });
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await page.evaluate(() => { location.hash = '#/games'; });
  const row = page.getByTestId('game-row').first();
  await expect(row).toBeVisible();
  await expect(row.locator('.game-date')).toContainText('pen. 4–3');
  await expect(row.getByTestId('game-chip')).toHaveText('W');
  await expectEllipsised(row.locator('.game-opponent'), 'past game opponent', row.locator('.game-score'));
  const rowBox = await row.boundingBox();
  const score = await row.locator('.game-score').boundingBox();
  expect(score.x + score.width, 'score inside the row').toBeLessThanOrEqual(rowBox.x + rowBox.width);
  expect((await overflowing(page, 360)).scroll).toBeLessThanOrEqual(360);
  expect((await overflowing(page, 360)).outside).toEqual([]);
  await expectButtons44(page);
});

test('360 px game detail: the events panel has no second border inside its card', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await seed('games/g1', {
    opponent: longOpponent, date: '2026-11-08', season: '2026-27', status: 'final', period: 4, lineup: worstLineup,
    events: [ev('goal', 1, 'p11'), ev('oppGoal', 2)],
  });
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await page.evaluate(() => { location.hash = '#/games/g1'; });
  const card = page.locator('.detail-card').first();
  await expect(card.getByTestId('ev-row').first()).toBeVisible();
  // Only the card draws a frame: no wrapper between it and the rows adds a border, so two lines never run side by side.
  const borders = await card.evaluate(el => {
    const widths = node => ['Top', 'Right', 'Bottom', 'Left'].map(side => parseFloat(getComputedStyle(node)[`border${side}Width`]));
    const chain = [];
    for (let node = el.querySelector('[data-testid="ev-row"]').parentElement; node && node !== el; node = node.parentElement) {
      chain.push({ tag: `${node.tagName}.${node.className}`, widths: widths(node) });
    }
    return { card: widths(el), chain };
  });
  expect(borders.card, 'the card has its border').toEqual([1, 1, 1, 1]);
  expect(borders.chain.length, 'the rows sit inside wrappers').toBeGreaterThan(0);
  for (const link of borders.chain) expect(link.widths, `${link.tag} has no border`).toEqual([0, 0, 0, 0]);
  expect((await overflowing(page, 360)).scroll).toBeLessThanOrEqual(360);
});

// The moved banner and the unsaved banner together on the shortest screens: they scroll inside the left column,
// so the header, the score row and every dock button stay on screen and the page itself does not scroll.
for (const [width, height] of [[844, 360], [667, 375]]) {
  test(`${width} x ${height} landscape: both banners scroll in the column and the dock stays on screen`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => {
      const entries = Array.from({ length: 12 }, (_, i) => ({
        id: `failed-${i}`, gameId: 'g1', op: 'add', status: 'failed',
        event: { id: `offline-${i}`, type: 'goal', period: 3, ts: i, playerId: 'p11' },
      }));
      localStorage.setItem('wp-journal', JSON.stringify(entries));
    });
    await openGame(page, { opponent: longOpponent, period: 3, events: richEvents('up') });
    await expect(page.getByTestId('tile')).toHaveCount(6);
    await otherDeviceTakesControl();
    await expect(page.getByTestId('takeover-banner')).toBeVisible();
    await expect(page.getByTestId('failed-banner')).toBeVisible();
    const inside = async id => {
      const box = await page.getByTestId(id).boundingBox();
      expect(box.x, `${id} left`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${id} right`).toBeLessThanOrEqual(300.5);
      expect(box.y, `${id} top`).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, `${id} bottom`).toBeLessThanOrEqual(height + 0.5);
      return box;
    };
    expect(await page.evaluate(() => document.scrollingElement.scrollHeight), 'the page does not scroll').toBeLessThanOrEqual(height);
    for (const id of ['situation', 'opp-goal', 'undo', 'events-open', 'period-next']) {
      const box = await inside(id);
      expect(box.height, `${id} height`).toBeGreaterThanOrEqual(44);
    }
    const bar = await page.locator('header.bar').boundingBox();
    expect(bar.y).toBeGreaterThanOrEqual(0);
    await expect(page.getByTestId('score-us')).toBeInViewport();
    // The banners are taller than their share of the column, so they scroll in place...
    const region = await page.locator('.banners').evaluate(el => ({ scrolls: el.scrollHeight > el.clientHeight, overflow: getComputedStyle(el).overflowY }));
    expect(region.overflow).toBe('auto');
    expect(region.scrolls, 'the banners are taller than their room').toBe(true);
    // ...and their buttons can each be brought into view and used.
    for (const id of ['take-over', 'retry-failed', 'discard-failed']) {
      const button = page.getByTestId(id);
      await button.scrollIntoViewIfNeeded();
      await inside(id);
      // Retry and Discard are disabled while tracking is elsewhere, so a click would wait: ask what is under the centre instead.
      expect(await button.evaluate(el => {
        const rect = el.getBoundingClientRect();
        const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return el === top || el.contains(top);
      }), `${id} is not covered`).toBe(true);
    }
    expect(await page.evaluate(() => document.scrollingElement.scrollHeight), 'the page still does not scroll').toBeLessThanOrEqual(height);
    expect(await page.evaluate(() => scrollY)).toBe(0);
  });
}
