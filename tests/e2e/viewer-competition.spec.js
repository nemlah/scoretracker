import { test, expect } from './fixtures.js';
import { aggregateSeason, seasonFor, todayIso } from '../../js/model.js';
import {
  closeAll, consoleProblems, get, open, resetAll, seed, tab, update,
} from './helpers.js';
import {
  CODE, HOME_URL, collectProblems, formatConsoleProblem, unlockTracker,
} from './tracker-helpers.js';
import { isFirestoreChannelLoss } from './network-noise.js';

const roster = [
  { id: 'p2', name: 'Papadakis', cap: 2, archived: false },
  { id: 'p5', name: 'Alexiou', cap: 5, archived: false },
];
const lineup = [{ playerId: 'p5', name: 'Alexiou', cap: 5 }];
const SEASON = seasonFor(todayIso());
const TOURNAMENT = 'Κύπελλο Άνοιξης';
// 40 characters, no break opportunity, Greek.
const LONG_NAME = 'Τουρνουά'.repeat(5);

const goal = (id, ts) => ({ id, type: 'goal', period: 1, ts, playerId: 'p5' });
const oppGoal = (id, ts) => ({ id, type: 'oppGoal', period: 1, ts });

const league = { gameId: 'l1', date: '2026-10-03', opponent: 'League FC', us: 10, them: 5, excl: 0, pens: 0 };
const friendly = {
  gameId: 'f1', date: '2026-10-10', opponent: 'Friendly FC', us: 4, them: 9, excl: 0, pens: 0, competition: 'friendly',
};
const tournament = {
  gameId: 't1', date: '2026-10-17', opponent: 'Tournament FC', us: 8, them: 7, excl: 0, pens: 0,
  competition: 'tournament', competitionName: TOURNAMENT,
};
const statsDoc = results => ({
  players: { p5: { name: 'Alexiou', games: 2, goals: 18, excl: 0, pens: 0 } },
  results,
});

let problems;
let viewerProblems;
let blocked;
test.beforeEach(async ({ page }) => {
  blocked = { url: null, errors: [] };
  viewerProblems = [];
  problems = consoleProblems(page, {
    blocked, ignore: isFirestoreChannelLoss, format: formatConsoleProblem,
  });
  await resetAll();
  await seed('team/main', { roster });
});
test.afterEach(() => {
  expect(problems).toEqual([]);
  expect(viewerProblems).toEqual([]);
});
test.afterAll(closeAll);

const row = (page, opponent) => page.getByTestId('result-row').filter({ hasText: opponent });
const seedSeason = (results = [league, friendly, tournament]) => seed(`stats/${SEASON}`, statsDoc(results));
const noSideScroll = page => page.evaluate(() => ({
  scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth,
}));

// The tag is fully visible: every line rectangle of its text lies inside the container's rectangle on all four
// sides, and inside the rectangle of the tag and any ancestors up to the container if they clip (overflow-x or
// overflow-y not visible). The nearest block holding it must also not overflow (an inline element has no scrollWidth of its own).
async function expectTagFits(tag, container) {
  await expect(tag).toBeVisible();
  const fit = await tag.evaluate((el, containerEl) => {
    const within = (r, box) => r.left >= box.left - 0.5 && r.right <= box.right + 0.5
      && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5;
    const range = document.createRange();
    range.selectNodeContents(el);
    const lines = [...range.getClientRects()];
    const boxes = [containerEl.getBoundingClientRect()];
    for (let node = el; node && node !== containerEl; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible') boxes.push(node.getBoundingClientRect());
    }
    let block = el;
    while (block && block.clientWidth === 0) block = block.parentElement;
    return {
      lines: lines.length,
      inside: lines.every(r => boxes.every(box => within(r, box))),
      holderFits: block.scrollWidth <= block.clientWidth,
    };
  }, await container.elementHandle());
  expect(fit.lines).toBeGreaterThan(0);
  expect(fit.inside).toBe(true);
  expect(fit.holderFits).toBe(true);
}

test.describe('home', () => {
  test('results carry the competition tag and the link name includes it', async ({ page }) => {
    await seedSeason();
    await open(page);
    await expect(page.getByTestId('result-row')).toHaveCount(3);
    const friendlyRow = row(page, 'Friendly FC');
    await expect(friendlyRow.getByTestId('result-competition')).toBeVisible();
    await expect(friendlyRow.getByTestId('result-competition')).toHaveText('Friendly');
    await expect(row(page, 'Tournament FC').getByTestId('result-competition')).toBeVisible();
    await expect(row(page, 'Tournament FC').getByTestId('result-competition')).toHaveText(TOURNAMENT);
    await expect(row(page, 'League FC').getByTestId('result-competition')).toHaveCount(0);
    await expect(friendlyRow.getByTestId('result-link')).toHaveAttribute('aria-label', /Friendly/);
    await expect(row(page, 'Tournament FC').getByTestId('result-link')).toHaveAttribute('aria-label', new RegExp(TOURNAMENT));
    await expect(row(page, 'League FC').getByTestId('result-link')).toHaveAttribute('aria-label', 'Win 10 – 5 against League FC, 03/10/2026');
  });

  test('the record leaves out friendlies', async ({ page }) => {
    await seedSeason();
    await open(page);
    await expect(page.getByTestId('season-record')).toBeVisible();
    await expect(page.getByTestId('season-record')).toHaveText('2 W · 0 L');
  });

  test('Players and Team tabs say how many friendlies are left out; Team lists the counted games only', async ({ page }) => {
    await seedSeason();
    await open(page);
    await expect(page.getByTestId('result-row')).toHaveCount(3);
    await tab(page, 'players').click();
    await expect(page.getByTestId('panel-players').getByTestId('friendlies-note')).toBeVisible();
    await expect(page.getByTestId('panel-players').getByTestId('friendlies-note')).toHaveText('Friendlies not counted (1)');
    await tab(page, 'team').click();
    await expect(page.getByTestId('panel-team').getByTestId('season-team-game-row')).toHaveCount(2);
    await expect(page.getByTestId('panel-team').getByTestId('friendlies-note')).toBeVisible();
    await expect(page.getByTestId('panel-team').getByTestId('friendlies-note')).toHaveText('Friendlies not counted (1)');
  });

  test('without a friendly there is no note', async ({ page }) => {
    await seedSeason([league, tournament]);
    await open(page);
    await expect(page.getByTestId('result-row')).toHaveCount(2);
    await tab(page, 'players').click();
    await expect(page.getByTestId('season-row')).toBeVisible();
    await expect(page.getByTestId('friendlies-note')).toHaveCount(0);
    await tab(page, 'team').click();
    await expect(page.getByTestId('season-team-game-row')).toHaveCount(2);
    await expect(page.getByTestId('friendlies-note')).toHaveCount(0);
  });

  test('a live rewrite without the friendly drops the note and keeps the record', async ({ page }) => {
    await seedSeason();
    await open(page);
    await tab(page, 'players').click();
    const note = page.getByTestId('panel-players').getByTestId('friendlies-note');
    await expect(note).toBeVisible();
    await expect(note).toHaveText('Friendlies not counted (1)');
    await expect(page.getByTestId('season-record')).toHaveText('2 W · 0 L');
    await seedSeason([league, tournament]);
    await expect(page.getByTestId('result-row')).toHaveCount(2);
    await expect(note).toHaveCount(0);
    await expect(page.getByTestId('season-record')).toHaveText('2 W · 0 L');
  });

  test('a 40-character Greek tournament name fits at 360 px in the list and on the board', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await seed('games/t1', {
      opponent: 'Tournament FC', date: '2026-10-17', season: SEASON, status: 'final', period: 4, lineup,
      events: [goal('g1', 1000), oppGoal('o1', 1010)], competition: 'tournament', competitionName: LONG_NAME,
    });
    await seedSeason([{ ...tournament, competitionName: LONG_NAME }]);
    await open(page);
    await expect(row(page, 'Tournament FC').getByTestId('result-competition')).toBeVisible();
    await expect(row(page, 'Tournament FC').getByTestId('result-competition')).toHaveText(LONG_NAME);
    await expectTagFits(row(page, 'Tournament FC').getByTestId('result-competition'), row(page, 'Tournament FC'));
    const listWidths = await noSideScroll(page);
    expect(listWidths.scroll).toBeLessThanOrEqual(listWidths.client);

    await row(page, 'Tournament FC').getByTestId('result-link').click();
    await expect(page.getByTestId('game-competition')).toBeVisible();
    await expect(page.getByTestId('game-competition')).toHaveText(LONG_NAME);
    await expectTagFits(page.getByTestId('game-competition'), page.locator('section.board'));
    const boardWidths = await noSideScroll(page);
    expect(boardWidths.scroll).toBeLessThanOrEqual(boardWidths.client);
  });
});

test.describe('the Team module fails to load', () => {
  test.use({ serviceWorkers: 'block' });

  test('the Team tab says so and still says how many friendlies are left out, once', async ({ page, baseURL, browserName }) => {
    blocked.url = new URL('/js/teamStats.js', baseURL).href;
    await page.route('**/js/teamStats.js', route => route.abort());
    await seedSeason();
    await open(page);
    await expect(page.getByTestId('result-row')).toHaveCount(3);
    await tab(page, 'team').click();
    await expect(page.getByTestId('team-unavailable')).toBeVisible();
    const note = page.getByTestId('panel-team').getByTestId('friendlies-note');
    await expect(note).toBeVisible();
    await expect(note).toHaveText('Friendlies not counted (1)');
    await expect(page.getByTestId('panel-team').getByTestId('friendlies-note')).toHaveCount(1);
    // The failure was the injected one: Chromium reports it as a console error (filtered), WebKit does not log it.
    if (browserName === 'chromium') expect(blocked.errors.length).toBeGreaterThan(0);
  });

  test('with no friendly the unavailable Team tab has no note', async ({ page, baseURL }) => {
    blocked.url = new URL('/js/teamStats.js', baseURL).href;
    await page.route('**/js/teamStats.js', route => route.abort());
    await seedSeason([league, tournament]);
    await open(page);
    await expect(page.getByTestId('result-row')).toHaveCount(2);
    await tab(page, 'team').click();
    await expect(page.getByTestId('team-unavailable')).toBeVisible();
    await expect(page.getByTestId('friendlies-note')).toHaveCount(0);
  });
});

test.describe('game screen', () => {
  const seedGame = (id, extra) => seed(`games/${id}`, {
    opponent: 'Board FC', date: '2026-10-17', season: SEASON, status: 'final', period: 4, lineup,
    events: [goal('g1', 1000), oppGoal('o1', 1010)], ...extra,
  });

  test('a final friendly shows its tag', async ({ page }) => {
    await seedGame('g1', { competition: 'friendly' });
    await open(page, '#/game/g1');
    await expect(page.getByTestId('final-badge')).toBeVisible();
    await expect(page.getByTestId('game-competition')).toBeVisible();
    await expect(page.getByTestId('game-competition')).toHaveText('Friendly');
  });

  test('a live tournament game shows its name', async ({ page }) => {
    await seedGame('g1', { status: 'live', period: 1, competition: 'tournament', competitionName: TOURNAMENT });
    await open(page, '#/game/g1');
    await expect(page.getByTestId('live-badge')).toBeVisible();
    await expect(page.getByTestId('game-competition')).toBeVisible();
    await expect(page.getByTestId('game-competition')).toHaveText(TOURNAMENT);
  });

  test('a league game shows no tag', async ({ page }) => {
    await seedGame('g1', {});
    await open(page, '#/game/g1');
    await expect(page.getByTestId('final-badge')).toBeVisible();
    await expect(page.getByTestId('game-competition')).toBeHidden();
  });

  test('the tag follows a competition change on the open game', async ({ page }) => {
    await seedGame('g1', {});
    await open(page, '#/game/g1');
    await expect(page.getByTestId('final-badge')).toBeVisible();
    await expect(page.getByTestId('game-competition')).toBeHidden();
    await update('games/g1', { competition: 'cup' });
    await expect(page.getByTestId('game-competition')).toBeVisible();
    await expect(page.getByTestId('game-competition')).toHaveText('Cup');
  });
});

test.describe('tracker to viewer', () => {
  test.beforeEach(async () => {
    await seed('secrets/editCode', { code: CODE });
  });
  test('marking a counted game friendly in the tracker recounts the season the viewer shows', async ({ page, context }) => {
    const g1 = {
      id: 'g1', opponent: 'First FC', date: '2026-10-01', season: SEASON, status: 'final', period: 4, lineup,
      events: [goal('a1', 1000), goal('a2', 1010)],
    };
    const g2 = {
      id: 'g2', opponent: 'Second FC', date: '2026-10-08', season: SEASON, status: 'final', period: 4, lineup,
      events: [goal('b1', 2000), goal('b2', 2010), goal('b3', 2020)],
    };
    await seed('games/g1', g1);
    await seed('games/g2', g2);
    await seed(`stats/${SEASON}`, aggregateSeason([g1, g2], roster));
    expect((await get(`stats/${SEASON}`)).players.p5.goals).toBe(5);

    await page.goto(HOME_URL);
    await unlockTracker(page);
    await page.getByTestId('home-games').click();
    await page.getByTestId('game-row').filter({ hasText: 'Second FC' }).click();
    await expect(page.getByTestId('info-competition')).toBeVisible();
    await page.getByTestId('info-competition').selectOption('friendly');
    await page.getByTestId('info-save').click();
    await expect.poll(async () => (await get('games/g2')).competition).toBe('friendly');
    await expect.poll(async () => (await get(`stats/${SEASON}`)).players.p5?.goals).toBe(2);

    // The viewer opens in a second page, so the tracker keeps its channels and nothing is filtered out of its run.
    const viewer = await context.newPage();
    collectProblems(viewer, viewerProblems);
    await open(viewer);
    await expect(viewer.getByTestId('result-row')).toHaveCount(2);
    await expect(row(viewer, 'Second FC').getByTestId('result-competition')).toBeVisible();
    await expect(row(viewer, 'Second FC').getByTestId('result-competition')).toHaveText('Friendly');
    await tab(viewer, 'players').click();
    const p5 = viewer.getByTestId('season-row').filter({ hasText: 'Alexiou' });
    await expect(p5).toBeVisible();
    await expect(p5.locator('td').nth(1)).toHaveText('1');
    await expect(p5.locator('td').nth(2)).toHaveText('2');
  });
});
