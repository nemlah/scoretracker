import { test, expect } from './fixtures.js';
import { closeAll, get, resetAll, seed, update } from './helpers.js';
import { CODE, HOME_URL, TRACKER_URL, collectProblems, reloadTracker, unlockTracker, waitForTrackerControl } from './tracker-helpers.js';

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

const luRow = (page, id) => page.locator(`[data-testid="lu-row"][data-player-id="${id}"]`);
const selRow = (page, id) => page.locator(`[data-testid="sel-row"][data-player-id="${id}"]`);

async function currentGameId() {
  await expect.poll(async () => (await get('team/main'))?.currentGameId).toBeTruthy();
  return (await get('team/main')).currentGameId;
}

test('a roster player can be marked goalie when added or later', async ({ page }) => {
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await page.getByTestId('home-roster').click();
  await expect(page.getByTestId('roster-add-btn')).toBeEnabled();

  await page.getByTestId('roster-add-name').fill('Nikolaou');
  await page.getByTestId('roster-add-cap').fill('1');
  await page.getByTestId('roster-add-goalie').check();
  await page.getByTestId('roster-add-btn').click();
  await expect(page.getByTestId('roster-add-goalie')).not.toBeChecked();
  await expect(page.getByTestId('roster-goalie')).toBeChecked();
  await expect(page.getByTestId('roster-row').first()).toContainText('GK');
  await expect.poll(async () => (await get('team/main'))?.roster[0]).toMatchObject({ name: 'Nikolaou', goalie: true });

  await page.getByTestId('roster-goalie').uncheck();
  await expect.poll(async () => (await get('team/main'))?.roster[0].goalie).toBe(false);
  await expect(page.getByTestId('roster-goalie')).not.toBeChecked();

  await page.getByTestId('roster-goalie').check();
  await expect.poll(async () => (await get('team/main'))?.roster[0].goalie).toBe(true);
  await reloadTracker(page, problems);
  await expect(page.getByTestId('roster-goalie')).toBeChecked();
});

test('a new game copies goalies into the lineup', async ({ page }) => {
  await seed('team/main', {
    roster: [
      { id: 'g1', name: 'Nikolaou', cap: 1, archived: false, goalie: true },
      { id: 'p5', name: 'Alexiou', cap: 5, archived: false },
    ],
  });
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await page.getByTestId('home-new').click();
  await expect(page.getByTestId('start-game')).toBeVisible();
  await expect(selRow(page, 'g1')).toContainText('GK');
  await expect(selRow(page, 'p5')).not.toContainText('GK');
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('score-us')).toHaveText('0');

  const game = await get(`games/${await currentGameId()}`);
  const byId = Object.fromEntries(game.lineup.map(entry => [entry.playerId, entry]));
  expect(byId.g1.goalie).toBe(true);
  expect(byId.p5).toEqual({ playerId: 'p5', name: 'Alexiou', cap: 5 });
  expect('goalie' in byId.p5).toBe(false);
});

test('the lineup sheet can mark a goalie and writes it back to the roster', async ({ page }) => {
  await seed('team/main', {
    roster: [
      { id: 'g1', name: 'Nikolaou', cap: 1, archived: false, goalie: true },
      { id: 'p5', name: 'Alexiou', cap: 5, archived: false },
      { id: 'p7', name: 'Georgiou', cap: 7, archived: false },
    ],
  });
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await page.getByTestId('home-new').click();
  await selRow(page, 'p7').getByTestId('sel-check').uncheck();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('score-us')).toHaveText('0');
  const id = await currentGameId();

  await page.getByTestId('events-open').click();
  await page.getByTestId('open-lineup').click();
  await expect(page.getByTestId('lineup-sheet')).toBeVisible();
  await expect(luRow(page, 'g1').getByTestId('lu-goalie')).toBeChecked();
  await expect(luRow(page, 'p5').getByTestId('lu-goalie')).not.toBeChecked();
  await luRow(page, 'g1').getByTestId('lu-goalie').uncheck();
  await luRow(page, 'p5').getByTestId('lu-goalie').check();
  // A player added mid-game brings the roster's flag.
  await page.getByTestId('lu-add').selectOption('p7');
  await expect(luRow(page, 'p7').getByTestId('lu-goalie')).not.toBeChecked();
  await luRow(page, 'p7').getByTestId('lu-goalie').check();
  await page.getByTestId('lu-save').click();
  await expect(page.getByTestId('lineup-sheet')).toBeHidden();

  await expect.poll(async () => (await get(`games/${id}`)).lineup.filter(p => p.goalie).map(p => p.playerId).sort())
    .toEqual(['p5', 'p7']);
  const game = await get(`games/${id}`);
  expect('goalie' in game.lineup.find(p => p.playerId === 'g1')).toBe(false);
  await expect.poll(async () => (await get('team/main')).roster
    .map(p => [p.id, p.goalie === true]).sort()).toEqual([['g1', false], ['p5', true], ['p7', true]]);

  // Added later with the roster flag set, the tick starts ticked.
  await page.getByTestId('open-lineup').click();
  await luRow(page, 'p7').getByTestId('lu-remove').click();
  await expect(page.getByTestId('lu-add')).toBeVisible();
  await page.getByTestId('lu-add').selectOption('p7');
  await expect(luRow(page, 'p7').getByTestId('lu-goalie')).toBeChecked();
});

const goalieRoster = [
  { id: 'g1', name: 'Nikolaou', cap: 1, archived: false, goalie: true },
  { id: 'g13', name: 'Georgiou', cap: 13, archived: false, goalie: true },
  { id: 'p5', name: 'Alexiou', cap: 5, archived: false },
];
const tile = (page, cap) => page.locator(`[data-testid="tile"][data-cap="${cap}"]`);
const tileCaps = page => page.getByTestId('tile').evaluateAll(tiles => tiles.map(el => el.dataset.cap));
const boxes = page => page.getByTestId('tile').evaluateAll(tiles => tiles.map(el => {
  const rect = el.getBoundingClientRect();
  return [rect.x + scrollX, rect.y + scrollY, rect.width, rect.height]; // page coordinates: a tap may scroll
}));

async function waitForCreatedGame(roster) {
  const lineup = roster.map(({ id, name, cap, goalie }) => ({
    playerId: id, name, cap, ...(goalie === true ? { goalie: true } : {}),
  })).sort((a, b) => a.cap - b.cap);
  // Both callers seed team/main without a pointer before starting the game.
  const id = await currentGameId();
  await expect.poll(async () => {
    const game = await get(`games/${id}`);
    return game && { status: game.status, period: game.period, lineup: game.lineup };
  }).toEqual({ status: 'live', period: 1, lineup });
}

async function startGoalieGame(page, roster = goalieRoster) {
  await seed('team/main', { roster });
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await page.getByTestId('home-new').click();
  await page.getByTestId('opponent-input').fill('Opponent FC');
  await page.getByTestId('start-game').click();
  await waitForCreatedGame(roster);
  await expect(page.getByTestId('score-us')).toHaveText('0');
  await expect(page.getByTestId('score-us')).toBeVisible();
}

// A game written straight to the server, opened through Home.
async function openSeeded(page, game) {
  const lineup = goalieRoster.map(({ id, name, cap, goalie }) => ({
    playerId: id, name, cap, ...(goalie ? { goalie: true } : {}),
  }));
  await seed('team/main', { roster: goalieRoster, currentGameId: 'g-seed' });
  await seed('games/g-seed', {
    opponent: 'Seeded FC', date: '2026-11-01', season: '2026-27', status: 'live', period: 1, lineup, events: [], ...game,
  });
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await page.getByTestId('home-resume').click();
  await expect(page.getByTestId('score-us')).toBeVisible();
}

test('the goalie in goal comes first, field players next, the other goalie last', async ({ page }) => {
  await startGoalieGame(page);
  await expect(page.getByTestId('tile')).toHaveCount(3);
  expect(await tileCaps(page)).toEqual(['1', '5', '13']);
  await expect(tile(page, 1)).toHaveAttribute('data-goalie', 'true');
  await expect(tile(page, 13)).toHaveAttribute('data-goalie', 'true');
  await expect(tile(page, 5)).not.toHaveAttribute('data-goalie', 'true');
  await expect(tile(page, 1)).toHaveAttribute('data-in-goal', 'true');
  await expect(tile(page, 1)).toHaveClass(/is-in-goal/);
  await expect(tile(page, 1)).toContainText('In goal');
  await expect(tile(page, 1).getByTestId('tile-in-goal')).toBeHidden();
  await expect(tile(page, 13)).not.toHaveAttribute('data-in-goal', 'true');
  await expect(tile(page, 13).getByTestId('tile-in-goal')).toBeVisible();
  await expect(tile(page, 13).locator('.in-goal-badge')).toBeHidden();
  await expect(tile(page, 13).getByTestId('tile-save')).toBeVisible();
  await expect(tile(page, 13).getByTestId('tile-pen-save')).toBeVisible();
  await expect(tile(page, 5).getByTestId('tile-save')).toHaveCount(0);
  await expect(tile(page, 1).getByTestId('tile-saves')).toHaveText('0 saves');
});

test('Save records a save on that goalie', async ({ page }) => {
  await startGoalieGame(page);
  await tile(page, 1).getByTestId('tile-save').click();
  await expect(tile(page, 1).getByTestId('tile-saves')).toHaveText('1 save');
  const id = await currentGameId();
  await expect.poll(async () => (await get(`games/${id}`)).events.map(e => [e.type, e.playerId])).toEqual([['save', 'g1']]);
  await expect(page.getByTestId('undo')).toContainText('Save · #1');
});

test('Pen save shows the pen count next to the saves', async ({ page }) => {
  await startGoalieGame(page);
  await tile(page, 1).getByTestId('tile-save').click();
  await tile(page, 1).getByTestId('tile-pen-save').click();
  await expect(tile(page, 1).getByTestId('tile-saves')).toHaveText('1 save · 1 pen');
  const id = await currentGameId();
  await expect.poll(async () => (await get(`games/${id}`)).events.map(e => e.type)).toEqual(['save', 'penSave']);
});

test('Save on the other goalie puts them in goal and swaps the goalie tiles; the field tile stays put', async ({ page }) => {
  await startGoalieGame(page);
  // Page coordinates: the tap may scroll the window (to the top after a goalie change).
  const field = () => tile(page, 5).evaluate(el => {
    const rect = el.getBoundingClientRect();
    return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
  });
  const before = await field();
  await tile(page, 13).getByTestId('tile-save').click();
  await expect(tile(page, 13)).toHaveAttribute('data-in-goal', 'true');
  await expect(tile(page, 1)).not.toHaveAttribute('data-in-goal', 'true');
  await expect(tile(page, 1).getByTestId('tile-in-goal')).toBeVisible();
  await expect(tile(page, 13).getByTestId('tile-in-goal')).toBeHidden();
  expect(await tileCaps(page)).toEqual(['13', '5', '1']);
  const after = await field();
  for (const key of ['x', 'y', 'width', 'height']) expect(Math.abs(before[key] - after[key])).toBeLessThanOrEqual(0.5);
});

test('In goal switches the goalie in goal', async ({ page }) => {
  await startGoalieGame(page);
  await tile(page, 13).getByTestId('tile-in-goal').click();
  await expect(tile(page, 13)).toHaveAttribute('data-in-goal', 'true');
  await expect(tile(page, 1)).not.toHaveAttribute('data-in-goal', 'true');
  expect(await tileCaps(page)).toEqual(['13', '5', '1']);
  const id = await currentGameId();
  await expect.poll(async () => (await get(`games/${id}`)).events.map(e => [e.type, e.playerId])).toEqual([['gkIn', 'g13']]);
  await expect(page.getByTestId('undo')).toContainText('In goal · #13');
});

const goalieButtons = (page, cap, ids) => ids.map(id => tile(page, cap).getByTestId(id));

test('after a goalie change the goalie buttons pause for a second', async ({ page }) => {
  await startGoalieGame(page);
  await tile(page, 13).getByTestId('tile-in-goal').click();
  const locked = [
    ...goalieButtons(page, 1, ['tile-in-goal', 'tile-save', 'tile-pen-save']),
    ...goalieButtons(page, 13, ['tile-in-goal', 'tile-save', 'tile-pen-save']),
  ];
  for (const button of locked) await expect(button).toBeDisabled({ timeout: 300 });
  await tile(page, 1).getByTestId('tile-in-goal').click({ force: true });
  for (const button of locked) await expect(button).toBeEnabled({ timeout: 2000 });
  const id = await currentGameId();
  await expect.poll(async () => (await get(`games/${id}`)).events.map(e => [e.type, e.playerId])).toEqual([['gkIn', 'g13']]);
  expect((await get(`games/${id}`)).events.map(e => [e.type, e.playerId])).toEqual([['gkIn', 'g13']]);
});

test('a Save on the goalie in goal does not pause anything', async ({ page }) => {
  await startGoalieGame(page);
  await tile(page, 1).getByTestId('tile-save').click();
  await expect(tile(page, 1).getByTestId('tile-saves')).toHaveText('1 save');
  await expect(tile(page, 13).getByTestId('tile-in-goal')).toBeEnabled({ timeout: 300 });
});

test('a goalie change scrolls back to the top', async ({ page }) => {
  await startGoalieGame(page);
  await page.setViewportSize({ width: 360, height: 480 });
  const scrolledY = await page.evaluate(() => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
    return scrollY;
  });
  expect(scrolledY).toBeGreaterThan(0);
  await tile(page, 13).getByTestId('tile-in-goal').click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});

test('a goalie change from Undo reorders without the pause or a scroll', async ({ page }) => {
  await startGoalieGame(page);
  await tile(page, 13).getByTestId('tile-in-goal').click();
  await expect(tile(page, 1).getByTestId('tile-in-goal')).toBeEnabled({ timeout: 2000 });
  await page.setViewportSize({ width: 360, height: 480 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await page.getByTestId('undo').click();
  await expect.poll(() => tileCaps(page)).toEqual(['1', '5', '13']);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await expect(tile(page, 13).getByTestId('tile-in-goal')).toBeEnabled({ timeout: 300 });
});

test('with three goalies the two not in goal come last by cap', async ({ page }) => {
  await startGoalieGame(page, [
    ...goalieRoster,
    { id: 'g7', name: 'Ioannou', cap: 7, archived: false, goalie: true },
  ]);
  await expect(page.getByTestId('tile')).toHaveCount(4);
  expect(await tileCaps(page)).toEqual(['1', '5', '7', '13']);
  await tile(page, 13).getByTestId('tile-in-goal').click();
  await expect.poll(() => tileCaps(page)).toEqual(['13', '5', '1', '7']);
});

const near = (a, b) => Math.abs(a - b) <= 0.5;
const pageBox = (page, cap) => tile(page, cap).evaluate(el => {
  const rect = el.getBoundingClientRect();
  return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
});
const moreSheet = page => page.getByTestId('goalie-more-sheet');

const heights = page => page.getByTestId('tile').evaluateAll(tiles => tiles.map(el => [el.dataset.cap, el.getBoundingClientRect().height]));
async function expectEqualHeights(page) {
  await page.evaluate(() => document.fonts.ready);
  for (const width of [360, 800]) {
    await page.setViewportSize({ width, height: 900 });
    const all = await heights(page);
    const field = all.find(([cap]) => cap === '5')[1];
    expect(all.length).toBeGreaterThan(1);
    for (const [cap, height] of all) expect(near(height, field), `#${cap} at ${width}px: ${height} vs ${field}`).toBe(true);
  }
}

const savesAndPens = [
  ...Array.from({ length: 12 }, (_, n) => ({ id: `s${n}`, type: 'save', period: 1, ts: 1000 + n, playerId: 'g1' })),
  ...[0, 1].map(n => ({ id: `ps${n}`, type: 'penSave', period: 1, ts: 2000 + n, playerId: 'g1' })),
];

test('goalie and player tiles are the same height', async ({ page }) => {
  await startGoalieGame(page);
  await expectEqualHeights(page);
});

test('goalie and player tiles are the same height with a long name on cap 13', async ({ page }) => {
  await startGoalieGame(page, [
    { id: 'g1', name: 'Nikolaou', cap: 1, archived: false, goalie: true },
    { id: 'g13', name: 'Κωνσταντινίδης', cap: 13, archived: false, goalie: true },
    { id: 'p5', name: 'Alexiou', cap: 5, archived: false },
  ]);
  await expectEqualHeights(page);
});

test('goalie and player tiles are the same height with 12 saves · 2 pen showing', async ({ page }) => {
  await openSeeded(page, { events: savesAndPens });
  await expect(tile(page, 1).getByTestId('tile-saves')).toHaveText('12 saves · 2 pen');
  await page.setViewportSize({ width: 360, height: 900 });
  // The text is not cut off by the ellipsis at the narrowest width.
  expect(await tile(page, 1).getByTestId('tile-saves').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  await expectEqualHeights(page);
});

for (const [label, extra] of [['in goal', []], ['not in goal', [{ id: 'gk', type: 'gkIn', period: 1, ts: 5000, playerId: 'g1' }]]]) {
  test(`one goalie tile with a two-digit cap, a long name, 12 saves · 2 pen and three fouls keeps two rows at 360 px (${label})`, async ({ page }) => {
    const long = 'Κωνσταντινίδης';
    const own = events => events.map(event => ({ ...event, playerId: 'g13' }));
    await openSeeded(page, {
      lineup: [
        { playerId: 'g1', name: 'Nikolaou', cap: 1, goalie: true },
        { playerId: 'g13', name: long, cap: 13, goalie: true },
        { playerId: 'p5', name: 'Alexiou', cap: 5 },
      ],
      events: [
        ...own(savesAndPens),
        ...[1, 2, 3].map(n => ({ id: `x${n}`, type: 'excl', period: 1, ts: 3000 + n, playerId: 'g13' })),
        ...extra,
      ],
    });
    await page.setViewportSize({ width: 360, height: 900 });
    const goalie = tile(page, 13);
    await expect(goalie).toHaveClass(/is-out/);
    await expect(goalie.getByTestId('tile-saves')).toHaveText('12 saves · 2 pen');
    expect(await goalie.locator('.pip.is-on').count()).toBe(3);
    const field = (await pageBox(page, 5)).height;
    expect(near((await pageBox(page, 13)).height, field)).toBe(true);
    const nameLine = await goalie.locator('.tile-name').evaluate(el => {
      const style = getComputedStyle(el);
      return {
        height: el.getBoundingClientRect().height, lineHeight: parseFloat(style.lineHeight),
        cut: el.scrollWidth - el.clientWidth, overflow: style.textOverflow,
      };
    });
    expect(nameLine.height).toBeLessThanOrEqual(nameLine.lineHeight + 1);
    expect(nameLine.cut).toBeGreaterThan(0);
    // The cut name does not widen the page: nothing scrolls sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    expect(nameLine.overflow).toBe('ellipsis');
    const savesLine = await goalie.getByTestId('tile-saves').evaluate(el => ({
      height: el.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(el).lineHeight),
    }));
    expect(savesLine.height).toBeLessThanOrEqual(savesLine.lineHeight + 1);
  });
}

test('goalie and player tiles are the same height in the shootout', async ({ page }) => {
  await openSeeded(page, { period: 'SO' });
  await expectEqualHeights(page);
});

test('goalie and player tiles are the same height after #1 fouls out through the sheet', async ({ page }) => {
  await startGoalieGame(page);
  for (let n = 0; n < 3; n += 1) {
    await tile(page, 1).getByTestId('tile-more').click();
    await moreSheet(page).getByTestId('more-excl').click();
    await expect(moreSheet(page)).toBeHidden();
    await page.waitForTimeout(1100); // the tapper refuses a duplicate tap within 1 s
  }
  await expect(tile(page, 1)).toHaveClass(/is-out/);
  await expectEqualHeights(page);
});

test('the head shows IN GOAL or an In goal button, and saves instead of goals', async ({ page }) => {
  await startGoalieGame(page);
  await expect(tile(page, 1).locator('.tile-head .in-goal-badge')).toBeVisible();
  await expect(tile(page, 1).getByTestId('tile-in-goal')).toBeHidden();
  await expect(tile(page, 13).locator('.tile-head').getByTestId('tile-in-goal')).toBeVisible();
  await expect(tile(page, 13).locator('.in-goal-badge')).toBeHidden();
  for (const cap of [1, 13]) {
    await expect(tile(page, cap).locator('.tile-head').getByTestId('tile-saves')).toHaveText('0 saves');
    await expect(tile(page, cap).locator('.tile-goals-label')).toHaveCount(0);
    await expect(tile(page, cap).getByTestId('tile-goals')).toHaveCount(0);
    await expect(tile(page, cap).locator('.gk-badge')).toHaveCount(0);
    await expect(tile(page, cap).locator('.tile-actions .btn')).toHaveCount(3);
    for (const id of ['tile-save', 'tile-pen-save', 'tile-more']) {
      await expect(tile(page, cap).locator('.tile-actions').getByTestId(id)).toHaveCount(1);
    }
    for (const id of ['tile-goal', 'tile-excl', 'tile-pen']) await expect(tile(page, cap).getByTestId(id)).toHaveCount(0);
  }
  // A field player keeps its goals count and Goal / Excl / Pen row.
  await expect(tile(page, 5).getByTestId('tile-goals')).toBeVisible();
  await expect(tile(page, 5).getByTestId('tile-goal')).toBeVisible();
});

test('the ⋯ sheet records a goalie\'s goal, exclusion or penalty', async ({ page }) => {
  await startGoalieGame(page);
  const id = await currentGameId();
  const recorded = async () => (await get(`games/${id}`)).events.map(e => [e.type, e.playerId]);

  await tile(page, 1).getByTestId('tile-more').click();
  await expect(moreSheet(page)).toBeVisible();
  await expect(moreSheet(page)).toContainText('#1');
  await moreSheet(page).getByTestId('goalie-more-close').click();
  await expect(moreSheet(page)).toBeHidden();
  expect(await recorded()).toEqual([]);

  await tile(page, 1).getByTestId('tile-more').click();
  await moreSheet(page).getByTestId('more-excl').click();
  await expect(moreSheet(page)).toBeHidden();
  await expect.poll(recorded).toEqual([['excl', 'g1']]);

  await tile(page, 1).getByTestId('tile-more').click();
  await moreSheet(page).getByTestId('more-goal').click();
  await expect(moreSheet(page)).toBeHidden();
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await expect.poll(recorded).toEqual([['excl', 'g1'], ['goal', 'g1']]);

  await tile(page, 1).getByTestId('tile-more').click();
  await moreSheet(page).getByTestId('more-pen').click();
  await expect(moreSheet(page)).toBeHidden();
  await expect.poll(recorded).toEqual([['excl', 'g1'], ['goal', 'g1'], ['pen', 'g1']]);
});

test('an action chosen after the goalie fouled out is refused', async ({ page }) => {
  const now = Date.now();
  const excl = n => ({ id: `x${n}`, type: 'excl', period: 1, ts: now - 10000 + n, playerId: 'g1' });
  await openSeeded(page, { events: [excl(1), excl(2)] });
  await tile(page, 1).getByTestId('tile-more').click();
  await expect(moreSheet(page)).toBeVisible();
  const goal = await moreSheet(page).getByTestId('more-goal').elementHandle();
  // A third foul lands from elsewhere while the sheet is open: the sheet closes.
  await update('games/g-seed', { events: [excl(1), excl(2), excl(3)] });
  await expect(tile(page, 1)).toHaveClass(/is-out/);
  await expect(moreSheet(page)).toBeHidden();
  // A tap that was already on its way (the button handle outlives the sheet) records nothing.
  await goal.evaluate(el => el.click());
  // Nothing to wait on for a negative check, so order it behind a write that does land: the page's
  // writes reach the server in order, so a refused goal would show before this opponent goal.
  await page.getByTestId('opp-goal').click();
  await expect.poll(async () => (await get('games/g-seed')).events.map(e => e.type)).toEqual(['excl', 'excl', 'excl', 'oppGoal']);
  await expect(page.getByTestId('score-us')).toHaveText('0');
});

test('⋯ is disabled for an OUT goalie and on a device not in control during a live game', async ({ page }) => {
  const now = Date.now();
  await openSeeded(page, {
    events: [1, 2, 3].map(n => ({ id: `x${n}`, type: 'excl', period: 1, ts: now - 10000 + n, playerId: 'g13' })),
  });
  await expect(tile(page, 13).getByTestId('tile-more')).toBeDisabled();
  await expect(tile(page, 1).getByTestId('tile-more')).toBeEnabled();
  await waitForTrackerControl();
  await update('control/tracker', { activeUid: 'another-device' });
  await expect(page.getByTestId('takeover-banner')).toBeVisible();
  await expect(tile(page, 1).getByTestId('tile-more')).toBeDisabled();
});

test('leaving the live screen closes an open ⋯ sheet', async ({ page }) => {
  await startGoalieGame(page);
  await tile(page, 1).getByTestId('tile-more').click();
  await expect(moreSheet(page)).toBeVisible();
  await page.evaluate(() => { location.hash = '#/'; });
  await expect(page.getByTestId('home-resume')).toBeVisible();
  await expect(moreSheet(page)).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/sheet-open/);
});

test('the shootout hides Save and keeps Pen save', async ({ page }) => {
  await openSeeded(page, { period: 'SO' });
  const before = await boxes(page);
  await expect(tile(page, 1).getByTestId('tile-save')).toBeHidden();
  await expect(tile(page, 13).getByTestId('tile-save')).toBeHidden();
  await expect(tile(page, 1).getByTestId('tile-pen-save')).toBeVisible();
  await expect(tile(page, 13).getByTestId('tile-in-goal')).toBeVisible();
  await tile(page, 1).getByTestId('tile-pen-save').click();
  await expect.poll(async () => (await get('games/g-seed')).events.map(e => [e.type, e.period])).toEqual([['penSave', 'SO']]);
  const after = await boxes(page);
  before.forEach((box, i) => box.forEach((value, j) => expect(Math.abs(value - after[i][j])).toBeLessThanOrEqual(0.5)));
});

test('in the shootout Pen save on the other goalie swaps the tiles and pauses', async ({ page }) => {
  await openSeeded(page, { period: 'SO' });
  await tile(page, 13).getByTestId('tile-pen-save').click();
  await expect.poll(() => tileCaps(page)).toEqual(['13', '5', '1']);
  await expect(tile(page, 1).getByTestId('tile-pen-save')).toBeDisabled({ timeout: 300 });
});

test('a shootout penalty save shows on the goalie tile', async ({ page }) => {
  await openSeeded(page, { period: 'SO' });
  await expect(tile(page, 1).getByTestId('tile-saves')).toHaveText('0 saves');
  await tile(page, 1).getByTestId('tile-pen-save').click();
  await expect(tile(page, 1).getByTestId('tile-saves')).toContainText('1 pen');
});

test('editing a cap on a game without goalies keeps the roster goalie ticks', async ({ page }) => {
  await seed('team/main', { roster: goalieRoster });
  await seed('games/g-old', {
    opponent: 'Old FC', date: '2026-10-01', season: '2026-27', status: 'final', period: 4, events: [],
    lineup: [
      { playerId: 'g1', name: 'Nikolaou', cap: 1 },
      { playerId: 'p5', name: 'Alexiou', cap: 5 },
    ],
  });
  await page.goto(HOME_URL);
  await unlockTracker(page);
  await page.getByTestId('home-games').click();
  await page.getByTestId('game-row').click();
  await page.getByTestId('open-lineup').click();
  await expect(page.getByTestId('lineup-sheet')).toBeVisible();
  await expect(luRow(page, 'g1').getByTestId('lu-goalie')).not.toBeChecked();
  await luRow(page, 'p5').getByTestId('lu-cap').fill('6');
  await page.getByTestId('lu-save').click();
  await expect(page.getByTestId('lineup-sheet')).toBeHidden();
  await expect.poll(async () => (await get('games/g-old')).lineup.map(p => [p.playerId, p.cap]))
    .toEqual([['g1', 1], ['p5', 6]]);
  await expect.poll(async () => (await get('team/main')).roster.find(p => p.id === 'p5').cap).toBe(6);
  expect((await get('team/main')).roster.filter(p => p.goalie === true).map(p => p.id).sort()).toEqual(['g1', 'g13']);
});

test('an OUT goalie has every button disabled', async ({ page }) => {
  const now = Date.now();
  await openSeeded(page, {
    events: [1, 2, 3].map(n => ({ id: `x${n}`, type: 'excl', period: 1, ts: now - 10000 + n, playerId: 'g13' })),
  });
  for (const id of ['tile-save', 'tile-pen-save', 'tile-in-goal', 'tile-more']) {
    await expect(tile(page, 13).getByTestId(id)).toBeDisabled();
    await expect(tile(page, 1).getByTestId(id)).toBeEnabled();
  }
});

test('a game without goalies looks as before', async ({ page }) => {
  const roster = goalieRoster.map(({ goalie, ...rest }) => rest);
  await seed('team/main', { roster });
  await page.goto(TRACKER_URL);
  await unlockTracker(page);
  await page.getByTestId('home-new').click();
  await page.getByTestId('start-game').click();
  await waitForCreatedGame(roster);
  await expect(page.getByTestId('score-us')).toHaveText('0');
  await expect(page.getByTestId('score-us')).toBeVisible();
  await expect(page.locator('[data-goalie]')).toHaveCount(0);
  await expect(page.getByTestId('tile-save')).toHaveCount(0);
  await expect(page.getByTestId('tile-in-goal')).toHaveCount(0);
  expect(await tileCaps(page)).toEqual(['1', '5', '13']);
});
