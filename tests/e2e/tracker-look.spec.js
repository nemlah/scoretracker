import { test, expect } from './fixtures.js';
import { isPlaywrightServiceWorkerBlock } from './network-noise.js';
import { closeAll, cssColour, resetAll, seed, update } from './helpers.js';
import { CODE, HOME_URL, collectProblems, formatConsoleProblem, otherDeviceTakesControl, unlockTracker } from './tracker-helpers.js';
import { team } from '../../js/config.js';

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
