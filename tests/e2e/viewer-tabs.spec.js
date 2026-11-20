import { test, expect } from '@playwright/test';
import { closeAll, get, resetAll, seed, update } from './helpers.js';
import { contrastRatio } from '../../js/accent.js';

const roster = [
  { id: 'p5', name: 'Alexiou', cap: 5, archived: false },
  { id: 'p2', name: 'Papadakis', cap: 2, archived: false },
  { id: 'p12', name: 'Κωνσταντινίδης', cap: 12, archived: false },
];
const lineup = roster.map(({ id, name, cap }) => ({ playerId: id, name, cap }));

let clock = 1000;
const ev = (type, period, playerId) => ({
  id: `e${clock}`, type, period, ts: (clock += 10), ...(playerId ? { playerId } : {}),
});

// A live game: goals for caps 5 and 12, and cap 2 out with three exclusions.
const liveEvents = () => [
  ev('goal', 1, 'p5'), ev('goal', 1, 'p12'), ev('oppGoal', 1),
  ev('excl', 2, 'p2'), ev('excl', 2, 'p2'), ev('excl', 2, 'p2'),
];

const seedAll = () => Promise.all([
  seed('team/main', { currentGameId: 'g1', roster }),
  seed('games/g1', {
    opponent: 'Opponent FC', date: '2026-11-08', season: '2026-27', status: 'live', period: 2, lineup, events: liveEvents(),
  }),
  seed('games/g0', {
    opponent: 'Rivals', date: '2026-11-01', season: '2026-27', status: 'final', period: 4, lineup,
    events: [ev('goal', 1, 'p5'), ev('oppGoal', 2)],
  }),
  seed('stats/2026-27', {
    players: { p5: { name: 'Alexiou', games: 2, goals: 3, excl: 0, pens: 0 } },
    goalies: {},
    results: [
      { gameId: 'g1', date: '2026-11-08', opponent: 'Opponent FC', us: 2, them: 1 },
      { gameId: 'g0', date: '2026-11-01', opponent: 'Rivals', us: 1, them: 1 },
    ],
  }),
]);

const screens = [
  { name: 'a game', hash: '#/game/g1', tabs: ['timeline', 'players', 'team'], labels: ['Timeline', 'Players', 'Team'], ready: 'score-us' },
  { name: 'home', hash: '#/', tabs: ['results', 'players', 'team'], labels: ['Results', 'Players', 'Team'], ready: 'result-row' },
];

let problems;
// Set by a test that intercepts a module: the one console error the browser logs for that URL is expected.
let blockedUrl;
let blockedErrors;
test.beforeEach(async ({ page }) => {
  problems = [];
  blockedUrl = null;
  blockedErrors = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    // Only an error whose own location (or text) names the intercepted URL; anything else still fails the test.
    // Only the browser's own resource-load failure for the intercepted request: that URL as its location, and
    // its text. An error the app logs about the same file is not it.
    if (blockedUrl && message.location()?.url === blockedUrl && /^Failed to load resource/.test(message.text())) {
      blockedErrors.push(message.text());
      return;
    }
    problems.push(`console: ${message.text()}`);
  });
  await resetAll();
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});
test.afterAll(closeAll);

const open = (page, hash = '') => page.goto(`/index.html?emulator=1${hash}`);
const tab = (page, name) => page.getByTestId(`tab-${name}`);
const selectedTabs = page => page.evaluate(() => [...document.querySelectorAll('[role="tab"]')]
  .filter(el => el.getAttribute('aria-selected') === 'true').map(el => el.dataset.testid));
// A panel that is on show. Not toBeVisible: the Team panel is empty until Task 9 and an empty box is "hidden" to it.
const panelOnShow = (page, name) => page.getByTestId(`panel-${name}`).evaluate(el => !el.hidden && getComputedStyle(el).display !== 'none');
const focused = page => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);

for (const screen of screens) {
  test.describe(screen.name, () => {
    test('one tab bar with its three tabs in order, each at least 50 px tall and labelled', async ({ page }) => {
      await seedAll();
      await open(page, screen.hash);
      await expect(page.getByTestId(screen.ready).first()).toBeVisible();
      await expect(page.locator('[role="tablist"]')).toHaveCount(1);
      const bar = page.getByTestId('tabs');
      await expect(bar).toHaveAttribute('role', 'tablist');
      expect(await bar.getAttribute('aria-label'), 'an accessible label').toBeTruthy();
      await expect(page.locator('[role="tab"]')).toHaveText(screen.labels);
      await expect(page.locator('[role="tab"]')).toHaveCount(3);
      expect(await page.locator('[role="tab"]').evaluateAll(els => els.map(el => el.dataset.testid)))
        .toEqual(screen.tabs.map(name => `tab-${name}`));
      for (const name of screen.tabs) {
        const box = await tab(page, name).boundingBox();
        expect(box.height, `${name} tab height`).toBeGreaterThanOrEqual(50);
      }
    });

    test('every tab names an existing panel and every panel names its tab', async ({ page }) => {
      await seedAll();
      await open(page, screen.hash);
      await expect(page.getByTestId(screen.ready).first()).toBeVisible();
      const wiring = await page.evaluate(names => names.map(name => {
        const button = document.querySelector(`[data-testid="tab-${name}"]`);
        const panel = document.getElementById(button?.getAttribute('aria-controls') ?? '');
        return {
          name,
          buttonId: button?.id,
          panelId: panel?.id,
          panelTestId: panel?.dataset.testid,
          panelRole: panel?.getAttribute('role'),
          labelledBy: panel?.getAttribute('aria-labelledby'),
        };
      }), screen.tabs);
      expect(wiring).toEqual(screen.tabs.map(name => ({
        name, buttonId: `tab-${name}`, panelId: `panel-${name}`, panelTestId: `panel-${name}`, panelRole: 'tabpanel', labelledBy: `tab-${name}`,
      })));
      await expect(page.locator('[role="tabpanel"]')).toHaveCount(3);
    });

    test('clicking a tab selects it and shows only its panel', async ({ page }) => {
      await seedAll();
      await open(page, screen.hash);
      await expect(page.getByTestId(screen.ready).first()).toBeVisible();
      // The first tab is selected on arrival.
      await expect(tab(page, screen.tabs[0])).toHaveAttribute('aria-selected', 'true');
      for (const name of [screen.tabs[1], screen.tabs[2], screen.tabs[0]]) {
        await tab(page, name).click();
        for (const other of screen.tabs) {
          await expect(tab(page, other)).toHaveAttribute('aria-selected', other === name ? 'true' : 'false');
          await expect(tab(page, other)).toHaveAttribute('tabindex', other === name ? '0' : '-1');
          expect(await panelOnShow(page, other), `panel ${other} on show`).toBe(other === name);
        }
      }
    });

    test('the arrow keys, Home and End move the selection and the focus, wrapping at both ends', async ({ page }) => {
      await seedAll();
      await open(page, screen.hash);
      await expect(page.getByTestId(screen.ready).first()).toBeVisible();
      const [first, middle, last] = screen.tabs;
      await tab(page, last).click();
      await page.keyboard.press('ArrowRight');
      expect(await selectedTabs(page)).toEqual([`tab-${first}`]);
      expect(await focused(page)).toBe(`tab-${first}`);
      await page.keyboard.press('ArrowLeft');
      expect(await selectedTabs(page)).toEqual([`tab-${last}`]);
      expect(await focused(page)).toBe(`tab-${last}`);
      await page.keyboard.press('Home');
      expect(await selectedTabs(page)).toEqual([`tab-${first}`]);
      expect(await focused(page)).toBe(`tab-${first}`);
      await page.keyboard.press('ArrowRight');
      expect(await selectedTabs(page)).toEqual([`tab-${middle}`]);
      expect(await focused(page)).toBe(`tab-${middle}`);
      await page.keyboard.press('End');
      expect(await selectedTabs(page)).toEqual([`tab-${last}`]);
      expect(await focused(page)).toBe(`tab-${last}`);
      expect(await panelOnShow(page, last)).toBe(true);
      expect(await panelOnShow(page, first)).toBe(false);
    });

    test('the tab bar fits at 360 px with no sideways scroll', async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await seedAll();
      await open(page, screen.hash);
      await expect(page.getByTestId(screen.ready).first()).toBeVisible();
      const fit = await page.evaluate(() => {
        const edges = [...document.querySelectorAll('[role="tab"]')].map(el => el.getBoundingClientRect());
        return {
          scroll: [document.scrollingElement.scrollWidth, document.scrollingElement.clientWidth],
          left: Math.min(...edges.map(r => r.left)),
          right: Math.max(...edges.map(r => r.right)),
        };
      });
      expect(fit.scroll[0], 'scrollWidth').toBeLessThanOrEqual(fit.scroll[1]);
      expect(fit.left).toBeGreaterThanOrEqual(0);
      expect(fit.right).toBeLessThanOrEqual(360);
    });
  });
}

test('a newly written goal keeps Team selected and focused on a live game', async ({ page }) => {
  await seedAll();
  await open(page, '#/game/g1');
  await expect(page.getByTestId('score-us')).toHaveText('2');
  await tab(page, 'team').click();
  await tab(page, 'team').focus();
  await update('games/g1', { events: [...liveEvents(), ev('goal', 2, 'p5')] });
  await expect(page.getByTestId('score-us')).toHaveText('3', { timeout: 5000 });
  // The write is in Firestore: the goal is the last event of the game.
  const saved = await get('games/g1');
  expect(saved.events).toHaveLength(liveEvents().length + 1);
  expect(saved.events.at(-1)).toMatchObject({ type: 'goal', period: 2, playerId: 'p5' });
  expect(await selectedTabs(page)).toEqual(['tab-team']);
  expect(await focused(page)).toBe('tab-team');
  expect(await panelOnShow(page, 'team')).toBe(true);
});

test('the selection starts again on the first tab when the screen changes', async ({ page }) => {
  await seedAll();
  await open(page, '#/game/g1');
  await expect(page.getByTestId('score-us')).toHaveText('2');
  await tab(page, 'team').click();
  await page.getByTestId('all-games').click();
  await expect(page.getByTestId('games-list')).toBeVisible();
  await expect(page.getByTestId('result-row')).toHaveCount(2);
  expect(await selectedTabs(page)).toEqual(['tab-results']);
  expect(await panelOnShow(page, 'results')).toBe(true);
  // Players on home, then the next game straight from there: it opens on the timeline.
  await tab(page, 'players').click();
  expect(await selectedTabs(page)).toEqual(['tab-players']);
  await page.evaluate(() => { location.hash = '#/game/g0'; });
  await expect(page.getByTestId('score-us')).toHaveText('1');
  expect(await selectedTabs(page)).toEqual(['tab-timeline']);
  expect(await panelOnShow(page, 'timeline')).toBe(true);
});

test('the reconnecting note sits below the scoreboard and the tab strip', async ({ page }) => {
  await seedAll();
  await open(page, '#/game/g1');
  await expect(page.getByTestId('score-us')).toHaveText('2');
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByTestId('connection-note')).toBeVisible();
  const tops = await page.evaluate(() => ['.board', '[data-testid="tabs"]', '[data-testid="connection-note"]', '[data-testid="panel-timeline"]']
    .map(selector => document.querySelector(selector).getBoundingClientRect().top));
  expect(tops[0]).toBeLessThan(tops[1]);
  expect(tops[1]).toBeLessThan(tops[2]);
  expect(tops[2]).toBeLessThan(tops[3]);
});

test.describe('the Team module fails to load', () => {
  test.use({ serviceWorkers: 'block' });

  for (const screen of screens) {
    test(`on ${screen.name} the Team tab says so and the other tabs still work`, async ({ page, baseURL }) => {
      blockedUrl = new URL('/js/teamView.js', baseURL).href;
      await page.route('**/js/teamView.js', route => route.abort());
      await seedAll();
      await open(page, screen.hash);
      await expect(page.getByTestId(screen.ready).first()).toBeVisible();
      await tab(page, 'team').click();
      await expect(page.getByTestId('team-unavailable')).toBeVisible();
      await expect(page.getByTestId('team-unavailable')).toHaveText("Team stats aren't available right now.");
      await tab(page, 'players').click();
      await expect(page.getByTestId('team-unavailable')).toBeHidden();
      await expect(page.getByTestId(screen.name === 'home' ? 'season-row' : 'player-row').first()).toBeVisible();
      await tab(page, screen.tabs[0]).click();
      await expect(page.getByTestId(screen.name === 'home' ? 'result-row' : 'timeline-item').first()).toBeVisible();
    });
  }
});

test.describe('the Players tab', () => {
  test("shows a two-digit cap chip and an out player's Out on a game", async ({ page }) => {
    await seedAll();
    await open(page, '#/game/g1');
    await expect(page.getByTestId('score-us')).toHaveText('2');
    await tab(page, 'players').click();
    const twelve = page.locator('[data-testid="player-row"][data-cap="12"]');
    await expect(twelve.locator('.cap')).toHaveText('12');
    await expect(twelve.locator('.cap')).toBeVisible();
    await expect(twelve).toContainText('Κωνσταντινίδης');
    const papadakis = page.locator('[data-testid="player-row"][data-cap="2"]');
    await expect(papadakis.getByTestId('player-out')).toBeVisible();
    await expect(papadakis.getByTestId('player-out')).toHaveText('Out');
    await expect(twelve.getByTestId('player-out')).toHaveCount(0);
    // The out player's chip is grey; the others carry the club colour. Its "Out" is in the out colour.
    const colours = await page.evaluate(() => {
      const bg = selector => getComputedStyle(document.querySelector(selector)).backgroundColor;
      const probe = document.createElement('i');
      probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--out-text');
      document.body.append(probe);
      const outText = getComputedStyle(probe).color;
      probe.remove();
      return {
        playing: bg('[data-cap="12"] .cap'),
        out: bg('[data-cap="2"] .cap'),
        outText,
        label: getComputedStyle(document.querySelector('[data-testid="player-out"]')).color,
      };
    });
    expect(colours.out).not.toBe(colours.playing);
    expect(colours.label).toBe(colours.outText);
  });

  test('home lists the season players under the tab', async ({ page }) => {
    await seedAll();
    await open(page, '#/');
    await expect(page.getByTestId('result-row')).toHaveCount(2);
    await expect(page.getByTestId('season-row')).toBeHidden();
    await tab(page, 'players').click();
    await expect(page.getByTestId('season-row')).toHaveCount(1);
    await expect(page.getByTestId('season-row')).toBeVisible();
    await expect(page.getByTestId('season-row')).toContainText('Alexiou');
  });

  test('a season row has its cap chip when the roster knows the player, and the name alone when it does not', async ({ page }) => {
    await seedAll();
    // Totals are keyed by player id and carry no cap: it comes from the roster. 'pold' and 'gold' left it.
    await Promise.all([
      seed('team/main', { currentGameId: 'g1', roster: [...roster, { id: 'g1x', name: 'Georgiou', cap: 1, archived: false, goalie: true }] }),
      seed('stats/2026-27', {
        players: {
          p5: { name: 'Alexiou', games: 2, goals: 3, excl: 0, pens: 0 },
          p12: { name: 'Κωνσταντινίδης', games: 2, goals: 2, excl: 0, pens: 0 },
          pold: { name: 'Old Player', games: 1, goals: 1, excl: 0, pens: 0 },
          // An id that is also a property of every object: no roster entry, so no chip.
          constructor: { name: 'Ctor Player', games: 1, goals: 1, excl: 0, pens: 0 },
        },
        goalies: {
          g1x: { name: 'Georgiou', games: 2, saves: 9, penSaves: 1, goalsAgainst: 7 },
          gold: { name: 'Old Keeper', games: 1, saves: 2, penSaves: 0, goalsAgainst: 3 },
        },
        results: [{ gameId: 'g1', date: '2026-11-08', opponent: 'Opponent FC', us: 2, them: 1 }],
      }),
    ]);
    await open(page, '#/');
    await tab(page, 'players').click();
    await expect(page.getByTestId('season-row')).toHaveCount(4);
    const row = name => page.locator('[data-testid="season-row"]', { hasText: name });
    const keeper = name => page.locator('[data-testid="season-goalie-row"]', { hasText: name });
    await expect(row('Alexiou').locator('.cap')).toHaveText('5');
    await expect(row('Κωνσταντινίδης').locator('.cap')).toHaveText('12');
    await expect(row('Old Player').locator('.cap')).toHaveCount(0);
    await expect(row('Old Player').locator('.who-name')).toHaveText('Old Player');
    await expect(row('Ctor Player').locator('.cap')).toHaveCount(0);
    await expect(row('Ctor Player').locator('.who-name')).toHaveText('Ctor Player');
    await expect(keeper('Georgiou').locator('.cap')).toHaveText('1');
    await expect(keeper('Old Keeper').locator('.cap')).toHaveCount(0);
    await expect(keeper('Old Keeper').locator('.who-name')).toHaveText('Old Keeper');
  });
});

// The worst row: a very long Greek name, a two-digit cap, a foul-out ("Out"). It must stay one line, cut with an
// ellipsis, with the chip and the badge whole inside the row, at the narrowest portrait width and in landscape.
const LONG = 'Παπαδόπουλος-Αθανασίου-Κωνσταντινίδης-Χατζηγεωργίου-Παπαντωνίου-Οικονομόπουλος';
const worstRoster = [
  { id: 'w12', name: LONG, cap: 12, archived: false },
  { id: 'w13', name: LONG, cap: 13, archived: false, goalie: true },
];
const seedWorst = () => Promise.all([
  seed('team/main', { currentGameId: 'g1', roster: worstRoster }),
  seed('games/g1', {
    opponent: 'Opponent FC', date: '2026-11-08', season: '2026-27', status: 'live', period: 2,
    lineup: [{ playerId: 'w12', name: LONG, cap: 12 }, { playerId: 'w13', name: LONG, cap: 13, goalie: true }],
    events: [ev('gkIn', 1, 'w13'), ev('goal', 1, 'w12'), ev('excl', 2, 'w12'), ev('excl', 2, 'w12'), ev('excl', 2, 'w12'),
      ev('save', 2, 'w13'), ev('oppGoal', 2)],
  }),
  seed('stats/2026-27', {
    players: { w12: { name: LONG, games: 12, goals: 27, excl: 11, pens: 12 } },
    goalies: { w13: { name: LONG, games: 12, saves: 88, penSaves: 12, goalsAgainst: 77 } },
    results: [{ gameId: 'g1', date: '2026-11-08', opponent: 'Opponent FC', us: 1, them: 1 }],
  }),
]);

async function expectWorstRow(row, { out }) {
  await expect(row).toBeVisible();
  await expect(row.locator('.cap')).toBeVisible();
  if (out) await expect(row.getByTestId('player-out')).toBeVisible();
  const g = await row.evaluate(tr => {
    const box = el => {
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height };
    };
    const name = tr.querySelector('.who-name');
    const style = getComputedStyle(name);
    return {
      row: box(tr),
      name: box(name),
      chip: box(tr.querySelector('.cap')),
      badge: tr.querySelector('[data-testid="player-out"]') ? box(tr.querySelector('[data-testid="player-out"]')) : null,
      lineHeight: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5,
      clipped: name.scrollWidth > name.clientWidth,
      cut: [style.overflowX, style.textOverflow],
      scroll: [document.scrollingElement.scrollWidth, document.scrollingElement.clientWidth],
    };
  });
  expect(g.clipped, 'the name is cut (scrollWidth > clientWidth)').toBe(true);
  expect(g.cut, 'the cut is an ellipsis, not an overflow').toEqual(['hidden', 'ellipsis']);
  expect(Math.abs(g.name.height - g.lineHeight), 'the name is one line').toBeLessThanOrEqual(1);
  expect(g.name.width, 'some of the name shows').toBeGreaterThanOrEqual(24);
  const inside = (box, what) => {
    expect(box.left, `${what} left`).toBeGreaterThanOrEqual(g.row.left - 0.5);
    expect(box.right, `${what} right`).toBeLessThanOrEqual(g.row.right + 0.5);
    expect(box.top, `${what} top`).toBeGreaterThanOrEqual(g.row.top - 0.5);
    expect(box.bottom, `${what} bottom`).toBeLessThanOrEqual(g.row.bottom + 0.5);
  };
  inside(g.chip, 'chip');
  expect(g.chip.width, 'the chip is not squeezed').toBeGreaterThanOrEqual(30);
  expect(g.chip.right, 'the chip is left of the name').toBeLessThanOrEqual(g.name.left + 0.5);
  if (out) {
    expect(g.badge, 'Out badge').not.toBeNull();
    inside(g.badge, 'Out');
    expect(g.badge.left, 'Out is right of the name').toBeGreaterThanOrEqual(g.name.right - 0.5);
  }
  expect(g.row.height, 'the row is one line tall').toBeLessThanOrEqual(60);
  expect(g.scroll[0], 'no sideways scroll').toBeLessThanOrEqual(g.scroll[1]);
}

for (const scheme of ['light', 'dark']) {
  for (const [width, height] of [[360, 740], [844, 390]]) {
    test.describe(`worst Players rows, ${width} x ${height}, ${scheme}`, () => {
      test.use({ colorScheme: scheme });

      test('game Players: the name is one cut line, the chip and Out stay whole', async ({ page }) => {
        await page.setViewportSize({ width, height });
        await seedWorst();
        await open(page, '#/game/g1');
        await expect(page.getByTestId('score-us')).toHaveText('1');
        await tab(page, 'players').click();
        await expectWorstRow(page.locator('[data-testid="player-row"][data-cap="12"]'), { out: true });
        await expectWorstRow(page.locator('[data-testid="goalie-row"][data-cap="13"]'), { out: false });
      });

      test('home Players: the name is one cut line, the chip stays whole', async ({ page }) => {
        await page.setViewportSize({ width, height });
        await seedWorst();
        await open(page, '#/');
        await expect(page.getByTestId('result-row')).toHaveCount(1);
        await tab(page, 'players').click();
        await expectWorstRow(page.getByTestId('season-row'), { out: false });
        await expectWorstRow(page.getByTestId('season-goalie-row'), { out: false });
      });
    });
  }
}

const chipColours = (page, selector) => page.locator(selector).evaluate(el => {
  const style = getComputedStyle(el);
  return { fg: style.color, bg: style.backgroundColor };
});

for (const scheme of ['light', 'dark']) {
  test.describe(`cap chips, ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    for (const accent of ['#0057b8', '#c8102e', '#f2b705', '#00843d']) {
      test(`the cap number clears 4.5:1 on ${accent}, on a game and on home`, async ({ page }) => {
        await seedAll();
        await open(page, '#/game/g1');
        await expect(page.getByTestId('score-us')).toHaveText('2');
        await tab(page, 'players').click();
        // The page's own accent.js import sets its pair a moment after first paint: wait for it, then override.
        await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--on-accent').trim())).not.toBe('');
        const paint = colour => page.evaluate(async value => {
          document.documentElement.style.setProperty('--accent', value);
          const { applyAccentPair } = await import('/js/accent.js');
          applyAccentPair(document.documentElement.style, value);
        }, colour);
        await paint(accent);
        const chip = '[data-testid="player-row"][data-cap="12"] .cap';
        const read = await chipColours(page, chip);
        const fg = await hexOf(page, read.fg);
        const bg = await hexOf(page, read.bg);
        expect(contrastRatio(fg, bg), `cap 12: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        // The playing chip really is the club colour.
        expect(bg).toBe(accent);
        // The same chip on home's season rows (the roster knows cap 5).
        await page.getByTestId('all-games').click();
        await tab(page, 'players').click();
        await paint(accent);
        const season = await chipColours(page, '[data-testid="season-row"] .cap');
        const seasonFg = await hexOf(page, season.fg);
        const seasonBg = await hexOf(page, season.bg);
        expect(contrastRatio(seasonFg, seasonBg), `season cap: ${seasonFg} on ${seasonBg}`).toBeGreaterThanOrEqual(4.5);
        expect(seasonBg).toBe(accent);
      });
    }

    test('the out chip clears 4.5:1', async ({ page }) => {
      await seedAll();
      await open(page, '#/game/g1');
      await expect(page.getByTestId('score-us')).toHaveText('2');
      await tab(page, 'players').click();
      const read = await chipColours(page, '[data-testid="player-row"][data-cap="2"] .cap');
      const fg = await hexOf(page, read.fg);
      const bg = await hexOf(page, read.bg);
      expect(contrastRatio(fg, bg), `out chip: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    });
  });
}

const hexOf = (page, colour) => page.evaluate(value => {
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#000000';
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  return `#${[...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(c => c.toString(16).padStart(2, '0')).join('')}`;
}, colour);

