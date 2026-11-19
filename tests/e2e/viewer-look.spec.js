import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { closeAll, resetAll, seed, update } from './helpers.js';
import { contrastRatio } from '../../js/accent.js';

// The longest seeded Greek names (see tracker-roster), two-digit caps, a two-digit score, every badge.
const longOpponent = 'Πανελλήνιος Γυμναστικός Σύλλογος Πειραιώς Ολυμπιακός';
const roster = [
  { id: 'p13', name: 'Κωνσταντινίδης', cap: 13, archived: false, goalie: true },
  { id: 'p1', name: 'Γεωργίου', cap: 1, archived: false, goalie: true },
  { id: 'p11', name: 'Παπαδόπουλος-Αθανασίου', cap: 11, archived: false },
  { id: 'p10', name: 'Αλεξίου', cap: 10, archived: false },
];
const lineup = roster.map(({ id, name, cap, goalie }) => ({
  playerId: id, name, cap, ...(goalie ? { goalie: true } : {}),
}));

let clock = 1000;
const ev = (type, period, playerId) => ({
  id: `e${clock}`, type, period, ts: (clock += 10), ...(playerId ? { playerId } : {}),
});

// 12–11 after three quarters, a man-up still open, a foul-out, saves from both goalkeepers.
function richEvents() {
  const events = [ev('gkIn', 1, 'p1')];
  for (let i = 0; i < 12; i += 1) events.push(ev('goal', 1 + (i % 3), i % 2 ? 'p11' : 'p10'));
  for (let i = 0; i < 11; i += 1) events.push(ev('oppGoal', 1 + (i % 3)));
  events.push(ev('save', 2, 'p1'), ev('gkIn', 3, 'p13'), ev('save', 3, 'p13'));
  events.push(ev('excl', 3, 'p11'), ev('excl', 3, 'p11'), ev('excl', 3, 'p11'));
  events.push(ev('manUp', 3));
  return events;
}

const seedLive = () => Promise.all([
  seed('team/main', { currentGameId: 'g1', roster }),
  seed('games/g1', {
    opponent: longOpponent, date: '2026-11-08', season: '2026-27', status: 'live', period: 3,
    situations: true, lineup, events: richEvents(),
  }),
  seed('stats/2026-27', {
    situations: { manUp: { played: 90, scored: 44 }, manDown: { played: 88, stopped: 55 } },
    players: { p11: { name: 'Παπαδόπουλος-Αθανασίου', games: 12, goals: 27, excl: 11, pens: 12 } },
    goalies: { p13: { name: 'Κωνσταντινίδης', games: 12, saves: 88, penSaves: 12, goalsAgainst: 77 } },
    results: [
      {
        gameId: 'g0', date: '2026-11-01', opponent: longOpponent, us: 10, them: 10, soUs: 14, soThem: 13,
        manUp: { played: 17, scored: 12 }, manDown: { played: 16, stopped: 11 },
      },
      { gameId: 'g1', date: '2026-11-08', opponent: longOpponent, us: 12, them: 11 },
      // A one-line name: its link must still be a 44 px target.
      { gameId: 'g5', date: '2026-10-18', opponent: 'Rivals', us: 8, them: 7 },
      // Shorter still: narrower than 44 px by its text alone.
      { gameId: 'g6', date: '2026-10-11', opponent: 'OFI', us: 5, them: 4 },
    ],
  }),
]);

// A finished game beside the live one, so a past game can be opened with the live banner above it.
const seedPast = () => Promise.all([
  seedLive(),
  seed('games/g0', {
    opponent: longOpponent, date: '2026-11-01', season: '2026-27', status: 'final', period: 4, lineup,
    events: [ev('goal', 1, 'p10'), ev('oppGoal', 2)],
  }),
]);

let problems;
test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  await resetAll();
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});
test.afterAll(closeAll);

const open = (page, hash = '') => page.goto(`/index.html?emulator=1${hash}`);
const rootProperty = (page, name) => page.evaluate(
  property => getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
  name,
);

test('the page is set in Sofia Sans', async ({ page }) => {
  await seedLive();
  await open(page, '#/game/g1');
  await expect(page.getByTestId('score-us')).toHaveText('12');
  await expect(page.locator('body')).toHaveCSS('font-family', /Sofia Sans/);
});

test('the scoreboard is a dark board with amber digits', async ({ page }) => {
  await seedLive();
  await open(page, '#/game/g1');
  await expect(page.getByTestId('score-us')).toHaveText('12');
  await expect(page.locator('.scoreboard')).toHaveCSS('background-color', 'rgb(11, 19, 32)');
  await expect(page.locator('.score')).toHaveCSS('color', 'rgb(255, 194, 61)');
  // The opponent reads quieter than ANOG, in the board's muted colour.
  await expect(page.locator('p.team-name')).toHaveCSS('color', 'rgb(169, 180, 194)');
});

test('the club colour pair is set on the page', async ({ page }) => {
  await seedLive();
  await open(page, '#/game/g1');
  await expect(page.getByTestId('score-us')).toHaveText('12');
  // accent.js is imported dynamically: both properties arrive a moment after first paint.
  await expect.poll(() => rootProperty(page, '--on-accent')).toBe('#ffffff');
  await expect.poll(() => rootProperty(page, '--accent-on-board')).toMatch(/^#[0-9a-f]{6}$/);
  await expect.poll(() => rootProperty(page, '--accent-on-board')).not.toBe('#0057b8');
  // The 6 px bar before ANOG paints it.
  const bar = await page.locator('.scoreboard h1.team-name').evaluate(el => {
    const style = getComputedStyle(el, '::before');
    return { width: style.width, background: style.backgroundColor };
  });
  expect(bar.width).toBe('6px');
  expect(bar.background).toBe(await page.evaluate(() => {
    const probe = document.createElement('i');
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--accent-on-board');
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }));
});

test.describe('viewer dark', () => {
  test.use({ colorScheme: 'dark' });

  test('the deck is the dark page, a section is a dark card, the board is darker still', async ({ page }) => {
    await seedLive();
    await open(page, '#/game/g1');
    await expect(page.getByTestId('score-us')).toHaveText('12');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(11, 19, 32)');
    await expect(page.locator('.section').first()).toHaveCSS('background-color', 'rgb(19, 30, 46)');
    await expect(page.locator('.scoreboard')).toHaveCSS('background-color', 'rgb(5, 9, 15)');
    await expect(page.locator('.score')).toHaveCSS('color', 'rgb(255, 194, 61)');
  });
});

for (const blockFonts of [false, true]) {
  test(`360 px: no sideways scroll, nothing outside the screen${blockFonts ? ', fonts blocked' : ''}`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    if (blockFonts) await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await seedLive();
    for (const hash of ['#/game/g1', '#/games']) {
      await open(page, hash);
      // First the seeded content, so the Greek text is on the page: Google Fonts splits each family into
      // unicode-range subsets and the browser fetches the greek one only once Greek text needs it.
      const onHome = hash === '#/games';
      if (!onHome) {
        await expect(page.getByTestId('score-us')).toHaveText('12');
        await expect(page.locator('p.team-name')).toHaveText(longOpponent);
        await expect(page.getByTestId('situation-badge')).toBeVisible();
        await expect(page.getByTestId('goalie-row')).toHaveCount(2);
      } else {
        await expect(page.getByTestId('games-list')).toBeVisible();
        await expect(page.getByTestId('result-link').first().locator('.result-opp')).toHaveText(longOpponent);
        await expect(page.getByTestId('season-row').first()).toBeVisible();
      }
      if (!blockFonts) {
        // Then the fonts, for that very text. check() alone is true when no face matches, so also require a
        // loaded face whose unicode-range covers Greek (U+0370-03FF) in both families.
        const greek = `${longOpponent} Παπαδόπουλος-Αθανασίου Κωνσταντινίδης`;
        await page.evaluate(() => document.fonts.ready);
        await expect.poll(() => page.evaluate(async text => {
          await Promise.all([
            document.fonts.load('800 16px "Sofia Sans Extra Condensed"', text),
            document.fonts.load('400 16px "Sofia Sans"', text),
          ]);
          const greekFace = family => [...document.fonts].some(face => face.family.replace(/"/g, '') === family
            && face.status === 'loaded' && /U\+0?370/i.test(face.unicodeRange));
          return greekFace('Sofia Sans Extra Condensed') && greekFace('Sofia Sans')
            && document.fonts.check('800 16px "Sofia Sans Extra Condensed"', text)
            && document.fonts.check('400 16px "Sofia Sans"', text);
        }, greek)).toBe(true);
      }
      const overflow = await page.evaluate(() => ({
        scroll: document.scrollingElement.scrollWidth,
        outside: [...document.querySelectorAll('.scoreboard, .season-head, .section, .score, table, .result-link')]
          .filter(el => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().right > 360.5)
          .map(el => `${el.className || el.tagName}:${Math.round(el.getBoundingClientRect().right)}`),
      }));
      if (onHome) {
        const links = await page.getByTestId('result-link').evaluateAll(els => els.map(el => el.getBoundingClientRect().height));
        expect(links.length, 'home: result links').toBeGreaterThan(0);
        expect(Math.min(...links), 'home: shortest result-link target').toBeGreaterThanOrEqual(44);
      }
      expect(overflow.outside, `${hash}: boxes past 360 px`).toEqual([]);
      expect(overflow.scroll, `${hash}: scrollWidth`).toBeLessThanOrEqual(360);
    }
  });
}

const celebrationGame = () => Promise.all([
  seed('team/main', { currentGameId: 'g1', roster }),
  seed('games/g1', {
    opponent: 'Opponent FC', date: '2026-11-08', season: '2026-27', status: 'live', period: 1, lineup, events: [],
  }),
]);

for (const [scheme, board] of [['light', 'rgb(11, 19, 32)'], ['dark', 'rgb(5, 9, 15)']]) {
  test.describe(`celebration, ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test('the banner is the board with an amber GOAL', async ({ page }) => {
      await celebrationGame();
      await open(page, '#/game/g1');
      await expect(page.getByTestId('score-us')).toHaveText('0');
      await update('games/g1', { events: [ev('goal', 1, 'p10')] });
      await expect(page.getByTestId('celebration')).toBeVisible();
      await expect(page.getByTestId('celebration-banner')).toHaveCSS('background-color', board);
      await expect(page.getByTestId('celebration-goal')).toHaveCSS('color', 'rgb(255, 194, 61)');
    });
  });
}

// "rgb(...)", "color(srgb ...)" or any other computed colour as #rrggbb, read back through a canvas.
const hexOf = (page, colour) => page.evaluate(value => {
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#000000';
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  return `#${[...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(c => c.toString(16).padStart(2, '0')).join('')}`;
}, colour);

for (const scheme of ['light', 'dark']) {
  test.describe(`past game beside the live one, ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test('the live banner link shows an ink focus ring on the amber banner', async ({ page, browserName }) => {
      await seedPast();
      await open(page, '#/game/g0');
      const watch = page.getByTestId('live-banner');
      await expect(watch).toBeVisible();
      // Real keyboard Tab from a known start (nothing focused), however many stops come before the link.
      await page.evaluate(() => document.activeElement?.blur());
      let presses = 0;
      while (!(await watch.evaluate(el => el === document.activeElement))) {
        expect(presses, 'Tab reached the live banner within 15 presses').toBeLessThan(15);
        // Safari/WebKit leaves links out of the Tab order unless Option is held.
        await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
        presses += 1;
      }
      expect(await watch.evaluate(el => el.matches(':focus-visible')), 'focus-visible applies').toBe(true);
      const ring = await watch.evaluate(el => {
        const style = getComputedStyle(el);
        return { style: style.outlineStyle, width: style.outlineWidth, colour: style.outlineColor };
      });
      expect(ring.style).toBe('solid');
      expect(ring.width).toBe('3px');
      expect(ring.colour).toBe('rgb(11, 19, 32)');
      expect(contrastRatio(await hexOf(page, ring.colour), '#ffc23d')).toBeGreaterThanOrEqual(3);
    });
  });
}

for (const [width, height] of [[360, 740], [1280, 800]]) {
  test(`${width} px: a result link for a short opponent is a 44 x 44 target`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await seedLive();
    await open(page, '#/games');
    for (const name of ['OFI', 'Rivals']) {
      const link = page.getByTestId('result-link').filter({ has: page.locator('.result-opp', { hasText: new RegExp(`^${name}$`) }) });
      await expect(link).toHaveCount(1);
      const box = await link.boundingBox();
      expect(box.width, `${name} width`).toBeGreaterThanOrEqual(44);
      expect(box.height, `${name} height`).toBeGreaterThanOrEqual(44);
    }
  });
}

// Home look: the LIVE banner, the season header and the result rows.
// The seeded season has a win on a shootout, a win, a loss and a level final, all against long Greek names;
// the live game (12-11 in the third quarter) is the banner's worst case.
const seedHome = async () => {
  await seedLive();
  await seed('stats/2026-27', {
    players: { p11: { name: 'Παπαδόπουλος-Αθανασίου', games: 4, goals: 27, excl: 11, pens: 12 } },
    results: [
      { gameId: 'g1', date: '2026-11-08', opponent: longOpponent, us: 12, them: 11 },
      { gameId: 'g0', date: '2026-11-01', opponent: longOpponent, us: 10, them: 10, soUs: 14, soThem: 13 },
      { gameId: 'g5', date: '2026-10-18', opponent: 'Rivals', us: 8, them: 9 },
      { gameId: 'g6', date: '2026-10-11', opponent: 'OFI', us: 5, them: 5 },
    ],
  });
};

// The text is on one line and set to cut with an ellipsis, never to wrap; with `mustCut` the long name is
// really cut (on a screen too narrow to hold it).
const expectCutOnOneLine = async (locator, what, mustCut) => {
  const box = await locator.evaluate(el => {
    const style = getComputedStyle(el);
    const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
    return {
      whiteSpace: style.whiteSpace, overflow: style.overflow, textOverflow: style.textOverflow,
      cut: el.scrollWidth > el.clientWidth, lines: Math.round(el.getBoundingClientRect().height / line),
    };
  });
  expect(box.whiteSpace, `${what}: white-space`).toBe('nowrap');
  expect(box.textOverflow, `${what}: text-overflow`).toBe('ellipsis');
  expect(box.overflow, `${what}: overflow`).toBe('hidden');
  if (mustCut) expect(box.cut, `${what}: the long name is cut`).toBe(true);
  expect(box.lines, `${what}: one line`).toBe(1);
};

// `inner` lies whole inside `outer`'s box.
// The element's text is not cut by its own box.
const expectWhole = async (locator, what) => {
  const { scroll, client } = await locator.evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(scroll, `${what}: nothing cut`).toBeLessThanOrEqual(client + 1);
};
const expectInside = async (inner, outer, what) => {
  const [a, b] = await Promise.all([inner.boundingBox(), outer.boundingBox()]);
  expect(a, `${what}: inner is on the page`).not.toBeNull();
  expect(a.x, `${what}: left`).toBeGreaterThanOrEqual(b.x - 0.5);
  expect(a.x + a.width, `${what}: right`).toBeLessThanOrEqual(b.x + b.width + 0.5);
};

for (const scheme of ['light', 'dark']) {
  for (const [shape, width, height] of [['portrait', 360, 740], ['landscape', 844, 390]]) {
    test.describe(`home look, ${shape}, ${scheme}`, () => {
      test.use({ colorScheme: scheme });

      test('the banner keeps its score and is 56 px tall, the rows keep theirs, only the names are cut, no sideways scroll', async ({ page }) => {
        await page.setViewportSize({ width, height });
        await seedHome();
        await open(page);
        const banner = page.getByTestId('live-banner');
        await expect(banner).toBeVisible();
        await expect(page.getByTestId('live-banner-text')).toContainText('ANOG 12–11');
        await expect(page.getByTestId('result-row')).toHaveCount(4);
        const box = await banner.boundingBox();
        expect(box.height, 'banner height').toBeGreaterThanOrEqual(56);
        const watch = await page.getByTestId('watch-live').boundingBox();
        expect(watch.x + watch.width, 'Watch is on the screen').toBeLessThanOrEqual(width);
        expect(box.x + box.width, 'banner right edge').toBeLessThanOrEqual(width);
        // The pill, the team and the score are whole inside the banner's text box; only the opponent is cut.
        await expect(banner.locator('.home-live-pill')).toHaveText('LIVE · Q3');
        await expectInside(banner.locator('.home-live-pill'), banner, 'pill in banner');
        await expectWhole(banner.locator('.home-live-pill'), 'pill');
        const text = page.getByTestId('live-banner-text');
        await expectInside(banner.locator('.home-live-team'), text, 'team in banner text');
        await expectInside(banner.locator('.home-live-score'), text, 'score in banner text');
        await expectCutOnOneLine(banner.locator('.home-live-opp'), 'banner opponent', width === 360);
        await expectCutOnOneLine(page.getByTestId('result-row').first().locator('.result-opp'), 'row opponent', width === 360);
        // The shootout row: its score, date and "pen. 14–13" are whole while the opponent is cut.
        const shootout = page.getByTestId('result-row').nth(1);
        await expect(shootout.locator('.result-pen')).toHaveText('pen. 14–13');
        const main = shootout.locator('.result-main');
        await expectInside(shootout.locator('.result-tally'), shootout, 'shootout score in row');
        await expectInside(shootout.locator('.result-date'), main, 'shootout date in its column');
        await expectInside(shootout.locator('.result-pen'), main, 'shootout suffix in its column');
        await expectCutOnOneLine(shootout.locator('.result-opp'), 'shootout opponent', width === 360);
        const rowBox = await page.getByTestId('result-row').first().boundingBox();
        expect(rowBox.x + rowBox.width, 'row right edge').toBeLessThanOrEqual(width);
        const scroll = await page.evaluate(() => [document.scrollingElement.scrollWidth, document.scrollingElement.clientWidth]);
        expect(scroll[0], 'scrollWidth').toBeLessThanOrEqual(scroll[1]);
      });

      test('in the shootout the pill and the two-digit score stay whole, and the team name and the opponent give way', async ({ page }) => {
        await page.setViewportSize({ width, height });
        await seedHome();
        await update('games/g1', { period: 'SO' });
        await open(page);
        const banner = page.getByTestId('live-banner');
        await expect(banner.locator('.home-live-pill')).toHaveText('LIVE · Shootout');
        await expect(banner.locator('.home-live-score')).toHaveText('12–11');
        const text = page.getByTestId('live-banner-text');
        await expectInside(banner.locator('.home-live-pill'), banner, 'pill in banner');
        await expectWhole(banner.locator('.home-live-pill'), 'pill');
        await expectInside(banner.locator('.home-live-score'), text, 'score in banner text');
        const watch = await page.getByTestId('watch-live').boundingBox();
        expect(watch.x + watch.width, 'Watch is on the screen').toBeLessThanOrEqual(width);
        await expectCutOnOneLine(banner.locator('.home-live-opp'), 'opponent', width === 360);
        const scroll = await page.evaluate(() => [document.scrollingElement.scrollWidth, document.scrollingElement.clientWidth]);
        expect(scroll[0], 'scrollWidth').toBeLessThanOrEqual(scroll[1]);
      });

      test('the banner texts, the chip letters, the chip fills, the card border and the dividers clear their contrast floors', async ({ page }) => {
        await seedHome();
        await open(page);
        // A win on a shootout, a win, a loss and a level final: all three chips.
        await expect(page.getByTestId('result-chip')).toHaveText(['W', 'W', 'L', 'D']);
        const bannerBg = await page.getByTestId('live-banner').evaluate(el => getComputedStyle(el).backgroundColor);
        const banner = page.getByTestId('live-banner');
        const card = await page.locator('.result-card').evaluate(el => ({
          bg: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderTopColor,
          divider: getComputedStyle(el.querySelectorAll('.result-item')[1]).borderTopColor,
          page: getComputedStyle(document.body).backgroundColor,
        }));
        const texts = [];
        for (const [name, locator] of [
          ['banner', banner],
          // "Watch" and the text have no fill of their own: they sit on the banner.
          ['watch', page.getByTestId('watch-live')],
          ['banner text', page.getByTestId('live-banner-text')],
          ['banner score', banner.locator('.home-live-score')],
          ['banner opponent', banner.locator('.home-live-opp')],
          ['pill', banner.locator('.home-live-pill')],
          ...['W', 'L', 'D'].map(letter => [`chip ${letter}`, page.getByTestId('result-chip').filter({ hasText: letter }).first()]),
        ]) {
          const colours = await locator.evaluate(el => {
            const style = getComputedStyle(el);
            return { fg: style.color, bg: style.backgroundColor };
          });
          const bg = colours.bg === 'rgba(0, 0, 0, 0)' ? bannerBg : colours.bg;
          texts.push([name, await hexOf(page, colours.fg), await hexOf(page, bg)]);
        }
        for (const [name, fg, bg] of texts) {
          expect(contrastRatio(fg, bg), `${name}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
        // Fills and lines: 3:1 against what they sit on.
        const cardBg = await hexOf(page, card.bg);
        const shapes = [
          ['card border on the card', card.border, cardBg],
          ['card border on the page', card.border, await hexOf(page, card.page)],
          ['row divider on the card', card.divider, cardBg],
        ];
        for (const letter of ['W', 'L', 'D']) {
          const fill = await page.getByTestId('result-chip').filter({ hasText: letter }).first()
            .evaluate(el => getComputedStyle(el).backgroundColor);
          shapes.push([`chip ${letter} fill on the card`, fill, cardBg]);
        }
        for (const [name, fg, bg] of shapes) {
          const a = fg.startsWith('#') ? fg : await hexOf(page, fg);
          expect(contrastRatio(a, bg), `${name}: ${a} on ${bg}`).toBeGreaterThanOrEqual(3);
        }
      });
    });
  }
}

test('the crest is 40 px wide, visible, with no alt text', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await seedHome();
  await open(page);
  const crest = page.getByTestId('crest');
  await expect(crest).toBeVisible();
  await expect(crest).toHaveAttribute('alt', '');
  expect((await crest.boundingBox()).width).toBe(40);
  // It is loaded, not a broken image.
  await expect.poll(() => crest.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
});

test('the banner dot pulses, and stands still with reduced motion', async ({ page }) => {
  await seedHome();
  await open(page);
  const dot = page.getByTestId('live-banner').locator('.live-dot');
  await expect(dot).toBeVisible();
  await expect.poll(() => dot.evaluate(el => getComputedStyle(el).animationName)).not.toBe('none');
  expect(await dot.evaluate(el => getComputedStyle(el).animationPlayState)).toBe('running');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => dot.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
});

test('every result row link is at least 44 x 44, whatever the name', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await seedHome();
  await open(page);
  await expect(page.getByTestId('result-row')).toHaveCount(4);
  const sizes = await page.getByTestId('result-link').evaluateAll(els => els.map(el => {
    const box = el.getBoundingClientRect();
    return [Math.round(box.width), Math.round(box.height)];
  }));
  expect(sizes).toHaveLength(4);
  for (const [w, h] of sizes) {
    expect(w).toBeGreaterThanOrEqual(44);
    expect(h).toBeGreaterThanOrEqual(44);
  }
});

// The previous release's strings.js beside this viewer.js: its one-line banner template puts the opponent
// first, so the layout has to keep the score and the quarter in view anyway.
test.describe('banner with the previous strings.js', () => {
  test.use({ serviceWorkers: 'block' });

  test('360 px, long Greek opponent: the score and the quarter are inside the banner, only the opponent is cut', async ({ page }) => {
    const previous = execFileSync('git', ['show', '58f859d:js/strings.js'], { encoding: 'utf8' });
    await page.route('**/js/strings.js*', route => route.fulfill({ contentType: 'text/javascript', body: previous }));
    await page.setViewportSize({ width: 360, height: 740 });
    await seedHome();
    await open(page);
    const banner = page.getByTestId('live-banner');
    await expect(banner).toBeVisible();
    // It really is the old template: no pill, "Live:" first.
    await expect(banner.locator('.home-live-pill')).toHaveCount(0);
    await expect(page.getByTestId('live-banner-text')).toHaveText(`Live: ${longOpponent} 12–11 · Q3`);
    const text = page.getByTestId('live-banner-text');
    const scores = banner.locator('.home-live-score');
    await expect(scores).toHaveText(['12', '11', 'Q3']);
    for (const [i, name] of ['us', 'them', 'quarter'].entries()) {
      await expectInside(scores.nth(i), text, `${name} in banner text`);
      await expectInside(scores.nth(i), banner, `${name} in banner`);
    }
    await expectCutOnOneLine(banner.locator('.home-live-opp'), 'opponent', true);
    expect((await banner.boundingBox()).height).toBeGreaterThanOrEqual(56);
    const scroll = await page.evaluate(() => [document.scrollingElement.scrollWidth, document.scrollingElement.clientWidth]);
    expect(scroll[0], 'scrollWidth').toBeLessThanOrEqual(scroll[1]);
  });
});
