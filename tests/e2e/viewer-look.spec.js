import { test, expect } from '@playwright/test';
import { closeAll, resetAll, seed, update } from './helpers.js';

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
    ],
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
  await open(page);
  await expect(page.getByTestId('score-us')).toHaveText('12');
  await expect(page.locator('body')).toHaveCSS('font-family', /Sofia Sans/);
});

test('the scoreboard is a dark board with amber digits', async ({ page }) => {
  await seedLive();
  await open(page);
  await expect(page.getByTestId('score-us')).toHaveText('12');
  await expect(page.locator('.scoreboard')).toHaveCSS('background-color', 'rgb(11, 19, 32)');
  await expect(page.locator('.score')).toHaveCSS('color', 'rgb(255, 194, 61)');
  // The opponent reads quieter than ANOG, in the board's muted colour.
  await expect(page.locator('p.team-name')).toHaveCSS('color', 'rgb(169, 180, 194)');
});

test('the club colour pair is set on the page', async ({ page }) => {
  await seedLive();
  await open(page);
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
    await open(page);
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
    for (const hash of ['', '#/games']) {
      await open(page, hash);
      if (hash === '') {
        await expect(page.getByTestId('score-us')).toHaveText('12');
        await expect(page.getByTestId('situation-badge')).toBeVisible();
        await expect(page.getByTestId('goalie-row')).toHaveCount(2);
      } else {
        await expect(page.getByTestId('games-list')).toBeVisible();
        await expect(page.getByTestId('result-situations').first()).toBeVisible();
      }
      await expect(page.getByTestId('season-row').first()).toBeVisible();
      const overflow = await page.evaluate(() => ({
        scroll: document.scrollingElement.scrollWidth,
        outside: [...document.querySelectorAll('.scoreboard, .games-list, .section, .score, table')]
          .filter(el => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().right > 360.5)
          .map(el => `${el.className || el.tagName}:${Math.round(el.getBoundingClientRect().right)}`),
      }));
      expect(overflow.outside, `${hash || 'game'}: boxes past 360 px`).toEqual([]);
      expect(overflow.scroll, `${hash || 'game'}: scrollWidth`).toBeLessThanOrEqual(360);
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
      await open(page);
      await expect(page.getByTestId('score-us')).toHaveText('0');
      await update('games/g1', { events: [ev('goal', 1, 'p10')] });
      await expect(page.getByTestId('celebration')).toBeVisible();
      await expect(page.getByTestId('celebration-banner')).toHaveCSS('background-color', board);
      await expect(page.getByTestId('celebration-goal')).toHaveCSS('color', 'rgb(255, 194, 61)');
    });
  });
}
