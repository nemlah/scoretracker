import { test, expect } from '@playwright/test';
import {
  closeAll, delivered, instrumentRepo, resetAll, seed, update,
} from './helpers.js';
import { teamGame } from '../fixtures/team-game.js';
import { seasonStatsFull, seasonStatsOld } from '../fixtures/season-stats.js';

const roster = [
  { id: 'p1', name: 'Νίκος Λέκκας', cap: 1, archived: false },
  { id: 'p7', name: 'Άρης Λάμπρου', cap: 7, archived: false },
  { id: 'p12', name: 'Αλέξανδρος Κωνσταντίνος Παπαγεωργίου', cap: 12, archived: false },
];

let problems;
// Set by a test that intercepts a module: the browser's own resource-load failure for that URL is expected.
let blockedUrl;
let blockedErrors;
test.beforeEach(async ({ page }) => {
  problems = [];
  blockedUrl = null;
  blockedErrors = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    // Only the browser's resource-load failure for the intercepted URL (its location and its text); an error the
    // app logs about the same file, or any other, still fails the test.
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

// The fixture game is the current game, so home shows its season (2026-27) on any run date.
const seedGame = (game = teamGame) => Promise.all([
  seed('team/main', { currentGameId: 'team-g1', roster }),
  seed(`games/${game.id}`, game),
]);
const seedHome = stats => Promise.all([seedGame(), seed('stats/2026-27', stats)]);

const openGameTeam = async (page, game = teamGame, score = '5') => {
  await seedGame(game);
  await open(page, `#/game/${game.id}`);
  await expect(page.getByTestId('score-us')).toHaveText(score);
  await tab(page, 'team').click();
};
const openHomeTeam = async (page, stats) => {
  await seedHome(stats);
  await open(page);
  await expect(page.getByTestId('result-row')).toHaveCount(stats.results.length);
  await tab(page, 'team').click();
};

const noBadText = page => expect(page.getByTestId('panel-team')).not.toContainText(/NaN|undefined|null/);

test.describe('the game Team tab', () => {
  test('man-up and man-down by quarter, with totals and percentages', async ({ page }) => {
    await openGameTeam(page);
    await expect(page.getByTestId('team-situations')).toBeVisible();
    await expect(page.getByTestId('team-situations').locator('thead th')).toHaveText(['Q1', 'Q2', 'Q3', 'Q4', 'Total']);
    const up = page.getByTestId('team-manup');
    await expect(up.locator('th')).toContainText(['Man-up']);
    await expect(up).toContainText('scored');
    await expect(up.getByTestId('team-q')).toHaveText(['1/1', '0/1', '–', '–']);
    await expect(up.getByTestId('team-total')).toHaveText('1/2');
    await expect(up.getByTestId('team-pct')).toHaveText('50%');
    const down = page.getByTestId('team-mandown');
    await expect(down).toContainText('Man-down');
    await expect(down).toContainText('stopped');
    await expect(down.getByTestId('team-q')).toHaveText(['0/1', '1/1', '1/1', '–']);
    await expect(down.getByTestId('team-total')).toHaveText('2/3');
    await expect(down.getByTestId('team-pct')).toHaveText('67%');
    // A quarter with none played is drawn dim.
    const dash = up.getByTestId('team-q').nth(2);
    await expect(dash).toHaveClass(/is-none/);
    await expect(up.getByTestId('team-q').nth(0)).not.toHaveClass(/is-none/);
    await expect(page.getByTestId('team-untracked')).toHaveCount(0);
    await noBadText(page);
  });

  test('goals for and against, each a bar and a legend', async ({ page }) => {
    await openGameTeam(page);
    const bars = [
      ['team-goals-for', 'Goals for', '5', '1', 'man-up', '4', 0.2],
      ['team-goals-against', 'Goals against', '3', '1', 'while a man down', '2', 1 / 3],
    ];
    for (const [id, label, total, part, partLabel, rest, share] of bars) {
      const goals = page.getByTestId(id);
      await expect(goals).toContainText(label);
      await expect(goals.getByTestId('team-goals-total')).toHaveText(total);
      await expect(goals.getByTestId('team-goals-part')).toHaveText(`${part} ${partLabel}`);
      await expect(goals.getByTestId('team-goals-rest')).toHaveText(`${rest} other`);
      await expect(goals.locator('.team-bar')).toHaveAttribute('aria-label', `${total} · ${part} ${partLabel}`);
      const widths = await goals.evaluate(el => ({
        fill: el.querySelector('.team-bar-fill').getBoundingClientRect().width,
        bar: el.querySelector('.team-bar').getBoundingClientRect().width,
      }));
      expect(widths.fill / widths.bar, `${id} fill share`).toBeCloseTo(share, 1);
    }
  });

  test('fouls by quarter and the penalty fouls', async ({ page }) => {
    await openGameTeam(page);
    await expect(page.getByTestId('team-fouls').locator('thead th')).toHaveText(['Q1', 'Q2', 'Q3', 'Q4', 'Total']);
    const excl = page.getByTestId('team-fouls-excl');
    await expect(excl).toContainText('Exclusions');
    await expect(excl.getByTestId('team-q')).toHaveText(['1', '1', '1', '–']);
    await expect(excl.getByTestId('team-total')).toHaveText('3');
    const pens = page.getByTestId('team-fouls-pens');
    await expect(pens).toContainText('Penalty fouls');
    await expect(pens.getByTestId('team-q')).toHaveText(['–', '–', '1', '1']);
    await expect(pens.getByTestId('team-total')).toHaveText('2');
  });

  test('foul trouble: the order, the pips and the text', async ({ page }) => {
    await openGameTeam(page);
    const rows = page.getByTestId('foul-trouble-row');
    await expect(rows).toHaveCount(2);
    // Not out first, then out, each by cap: the order teamStats gives.
    await expect(rows.nth(0)).toHaveAttribute('data-cap', '7');
    await expect(rows.nth(0).locator('.cap')).toHaveText('7');
    await expect(rows.nth(0).getByTestId('foul-trouble-name')).toHaveText('Άρης Λάμπρου');
    await expect(rows.nth(0).getByTestId('foul-trouble-note')).toHaveText('2 of 3 fouls · one more and out');
    await expect(rows.nth(1)).toHaveAttribute('data-cap', '12');
    await expect(rows.nth(1).locator('.cap')).toHaveText('12');
    await expect(rows.nth(1).getByTestId('foul-trouble-name')).toHaveText('Αλέξανδρος Κωνσταντίνος Παπαγεωργίου');
    await expect(rows.nth(1).getByTestId('foul-trouble-note')).toHaveText('Out');
    // Three 12 px pips each: exclusions, then penalty fouls, then what is left.
    const pips = row => row.locator('.team-pip').evaluateAll(els => els.map(el => {
      const box = el.getBoundingClientRect();
      return { kind: el.className.replace('team-pip team-pip--', ''), w: box.width, h: box.height };
    }));
    expect(await pips(rows.nth(0))).toEqual([
      { kind: 'excl', w: 12, h: 12 }, { kind: 'excl', w: 12, h: 12 }, { kind: 'empty', w: 12, h: 12 },
    ]);
    expect(await pips(rows.nth(1))).toEqual([
      { kind: 'excl', w: 12, h: 12 }, { kind: 'pen', w: 12, h: 12 }, { kind: 'pen', w: 12, h: 12 },
    ]);
    // What a reader of the pips hears.
    await expect(rows.nth(0).locator('.team-pips')).toHaveAttribute('aria-label', 'Exclusions: 2, penalty fouls: 0');
    await expect(rows.nth(1).locator('.team-pips')).toHaveAttribute('aria-label', 'Exclusions: 1, penalty fouls: 2');
    // The out note is in the out colour; the other is muted.
    const colours = await rows.evaluateAll(els => els.map(el => getComputedStyle(el.querySelector('.team-trouble-note')).color));
    expect(colours[0]).not.toBe(colours[1]);
    await expect(page.getByTestId('team-pens-against')).toHaveText('2 faced · 1 saved');
  });

  test('game flow', async ({ page }) => {
    await openGameTeam(page);
    await expect(page.getByTestId('flow-lead')).toHaveText('+2');
    await expect(page.getByTestId('flow-run')).toHaveText('2–0');
    await expect(page.getByTestId('flow-ties')).toHaveText('2 · never behind');
    await expect(page.getByTestId('flow-scorers')).toHaveText('2');
  });

  test('a game never ahead, behind in its longest run, with no goals of its own to count', async ({ page }) => {
    // Opponent leads 0-3, then we score once: never ahead, the longest run is theirs, a tie is never reached.
    const events = [
      { id: 'a1', type: 'oppGoal', period: 1, ts: 1000 },
      { id: 'a2', type: 'oppGoal', period: 1, ts: 2000 },
      { id: 'a3', type: 'oppGoal', period: 2, ts: 3000 },
      { id: 'a4', type: 'goal', period: 3, ts: 4000 },
    ];
    await openGameTeam(page, { ...teamGame, events, situations: false }, '1');
    await expect(page.getByTestId('flow-lead')).toHaveText('never ahead');
    await expect(page.getByTestId('flow-run')).toHaveText('0–3');
    await expect(page.getByTestId('flow-ties')).toHaveText('0');
    await expect(page.getByTestId('flow-scorers')).toHaveText('0');
    await expect(page.getByTestId('foul-trouble-row')).toHaveCount(0);
    await expect(page.getByTestId('team-pens-against')).toHaveText('0 faced · 0 saved');
  });

  test('a game with no goals shows a dash for the run', async ({ page }) => {
    // The score is 0–0, so the score-us wait of the helper is different here.
    await seedGame({ ...teamGame, events: [], situations: false });
    await open(page, '#/game/team-g1');
    await expect(page.getByTestId('score-us')).toHaveText('0');
    await tab(page, 'team').click();
    await expect(page.getByTestId('flow-run')).toHaveText('–');
    await expect(page.getByTestId('flow-lead')).toHaveText('never ahead');
    await noBadText(page);
  });

  test('untracked: the line replaces the table and the goals are totals only', async ({ page }) => {
    await openGameTeam(page, { ...teamGame, situations: false });
    await expect(page.getByTestId('team-untracked')).toHaveText("Man-up and man-down weren't tracked in this game");
    await expect(page.getByTestId('team-situations')).toHaveCount(0);
    await expect(page.getByTestId('team-manup')).toHaveCount(0);
    await expect(page.getByTestId('team-goals-for').getByTestId('team-goals-total')).toHaveText('5');
    await expect(page.getByTestId('team-goals-against').getByTestId('team-goals-total')).toHaveText('3');
    await expect(page.locator('.team-bar')).toHaveCount(0);
    await expect(page.getByTestId('team-goals-part')).toHaveCount(0);
    // The fouls, trouble and flow do not depend on it.
    await expect(page.getByTestId('team-fouls-excl').getByTestId('team-total')).toHaveText('3');
    await expect(page.getByTestId('foul-trouble-row')).toHaveCount(2);
    await expect(page.getByTestId('flow-lead')).toHaveText('+2');
  });

  test('the panel follows the game: a new goal changes the figures', async ({ page }) => {
    await openGameTeam(page);
    await expect(page.getByTestId('team-goals-for').getByTestId('team-goals-total')).toHaveText('5');
    await update('games/team-g1', {
      events: [...teamGame.events, { id: 'e19', type: 'goal', period: 4, ts: 19000, playerId: 'p7' }],
    });
    await expect(page.getByTestId('team-goals-for').getByTestId('team-goals-total')).toHaveText('6');
    await expect(page.getByTestId('flow-scorers')).toHaveText('2');
    await expect(page.getByTestId('flow-lead')).toHaveText('+3');
  });
});

// The by-game rows and the totals the full fixture gives (tests/fixtures/season-stats.js).
const fullRows = [
  ['Harbour WPC', '16/11/2026', '1/2', '2/3', '3'],
  ['Marina WP', '09/11/2026', '2/3', '1/2', '2'],
  ['Northside WPC', '02/11/2026', '–', '–', '1'],
  ['Bay Aquatics', '26/10/2026', '0/1', '0/0', '0'],
];

async function rowTexts(page) {
  return page.getByTestId('season-team-game-row').evaluateAll(rows => rows.map(row => [
    row.querySelector('.team-label').textContent,
    row.querySelector('.team-sub').textContent,
    row.querySelector('[data-testid="season-team-mu"]').textContent,
    row.querySelector('[data-testid="season-team-md"]').textContent,
    row.querySelector('[data-testid="season-team-excl"]').textContent,
  ]));
}

test.describe('the season Team tab', () => {
  test('by game, with the season total and the legend', async ({ page }) => {
    await openHomeTeam(page, seasonStatsFull);
    expect(await rowTexts(page)).toEqual(fullRows);
    const total = page.getByTestId('season-team-total');
    await expect(total).toContainText('Season');
    await expect(total.getByTestId('season-team-mu-total')).toHaveText('3/6');
    await expect(total.getByTestId('season-team-mu-pct')).toHaveText('50%');
    await expect(total.getByTestId('season-team-md-total')).toHaveText('3/5');
    await expect(total.getByTestId('season-team-md-pct')).toHaveText('60%');
    await expect(total.getByTestId('season-team-excl-total')).toHaveText('6');
    await expect(total.getByTestId('season-team-excl-avg')).toHaveText('1.5/game');
    await expect(page.locator('.team-legend-note')).toHaveText(
      'MU: man-up goals / man-ups · MD: man-downs stopped / man-downs · EXCL: our exclusions');
    await noBadText(page);
  });

  test('goals by quarter: the rows, the total, a loss in the difference, the note and the coverage', async ({ page }) => {
    await openHomeTeam(page, seasonStatsFull);
    await expect(page.getByTestId('season-quarters').locator('thead th')).toHaveText(['Q1', 'Q2', 'Q3', 'Q4', 'Total']);
    const forRow = page.getByTestId('sq-for');
    const against = page.getByTestId('sq-against');
    const diff = page.getByTestId('sq-diff');
    await expect(forRow).toContainText('For');
    await expect(forRow.getByTestId('team-q')).toHaveText(['3', '1', '4', '3']);
    await expect(forRow.getByTestId('team-total')).toHaveText('11');
    await expect(against).toContainText('Against');
    await expect(against.getByTestId('team-q')).toHaveText(['2', '3', '2', '3']);
    await expect(against.getByTestId('team-total')).toHaveText('10');
    await expect(diff).toContainText('Difference');
    await expect(diff.getByTestId('team-q')).toHaveText(['+1', '−2', '+2', '0']);
    await expect(diff.getByTestId('team-total')).toHaveText('+1');
    // A loss is in the out colour (and so is nothing else in the row).
    const colours = await diff.getByTestId('team-q').evaluateAll(els => els.map(el => getComputedStyle(el).color));
    const outColour = await page.evaluate(() => {
      const probe = document.createElement('i');
      probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--out-text');
      document.body.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    });
    expect(colours[1]).toBe(outColour);
    expect(colours[0]).not.toBe(outColour);
    expect(colours[2]).not.toBe(outColour);
    expect(colours[3]).not.toBe(outColour);
    await expect(page.getByTestId('season-quarters-note')).toHaveText('Q2 is the only quarter we lose.');
    await expect(page.getByTestId('season-quarters-coverage')).toHaveText('Covers 3 of 4 games');
  });

  test('goals: for and against with the man-up and man-down split, and what the split covers', async ({ page }) => {
    await openHomeTeam(page, seasonStatsFull);
    const goals = page.getByTestId('season-goals');
    const forGoals = goals.getByTestId('team-goals-for');
    await expect(forGoals.getByTestId('team-goals-total')).toHaveText('14');
    await expect(forGoals.getByTestId('team-goals-part')).toHaveText('3 man-up');
    await expect(forGoals.getByTestId('team-goals-rest')).toHaveText('11 other');
    const against = goals.getByTestId('team-goals-against');
    await expect(against.getByTestId('team-goals-total')).toHaveText('14');
    await expect(against.getByTestId('team-goals-part')).toHaveText('2 while a man down');
    await expect(against.getByTestId('team-goals-rest')).toHaveText('12 other');
    await expect(page.getByTestId('season-goals-coverage')).toHaveText('Man-up figures cover 3 of 4 games');
  });

  test('two losing quarters, and none', async ({ page }) => {
    // Q1 and Q3 lost: the note names both. Every game has everything: no coverage lines.
    const quarters = [{ us: 0, them: 1 }, { us: 2, them: 0 }, { us: 0, them: 2 }, { us: 1, them: 1 }];
    const results = [
      {
        gameId: 'team-g1', date: '2026-11-16', opponent: 'Harbour WPC', us: 3, them: 4, excl: 1, quarters,
        manUp: { played: 2, scored: 1 }, manDown: { played: 3, stopped: 2 },
      },
    ];
    await openHomeTeam(page, { ...seasonStatsFull, results });
    await expect(page.getByTestId('sq-diff').getByTestId('team-q')).toHaveText(['−1', '+2', '−2', '0']);
    await expect(page.getByTestId('season-quarters-note')).toHaveText('We lose Q1 and Q3.');
    await expect(page.getByTestId('season-quarters-coverage')).toHaveCount(0);
    await expect(page.getByTestId('season-goals-coverage')).toHaveCount(0);
    // The same season, now winning every quarter or level: no note at all.
    await update('stats/2026-27', {
      results: [{ ...results[0], quarters: [{ us: 1, them: 0 }, { us: 2, them: 0 }, { us: 1, them: 1 }, { us: 1, them: 1 }] }],
    });
    await expect(page.getByTestId('sq-diff').getByTestId('team-q')).toHaveText(['+1', '+2', '0', '0']);
    await expect(page.getByTestId('season-quarters-note')).toHaveCount(0);
  });

  test('three losing quarters read as a list', async ({ page }) => {
    const quarters = [{ us: 0, them: 1 }, { us: 0, them: 1 }, { us: 2, them: 0 }, { us: 0, them: 2 }];
    await openHomeTeam(page, {
      ...seasonStatsFull,
      results: [{ gameId: 'team-g1', date: '2026-11-16', opponent: 'Harbour WPC', us: 2, them: 4, quarters }],
    });
    await expect(page.getByTestId('season-quarters-note')).toHaveText('We lose Q1, Q2 and Q4.');
  });

  test('an older stats document: dashes, the coverage lines, and no NaN or undefined', async ({ page }) => {
    await openHomeTeam(page, seasonStatsOld);
    // The man-up and man-down figures are there; EXCL is not.
    expect((await rowTexts(page)).map(row => row.slice(2))).toEqual([
      ['1/2', '2/3', '–'], ['2/3', '1/2', '–'], ['–', '–', '–'], ['0/1', '0/0', '–'],
    ]);
    const total = page.getByTestId('season-team-total');
    await expect(total.getByTestId('season-team-excl-total')).toHaveText('–');
    await expect(total.getByTestId('season-team-excl-avg')).toHaveText('–');
    await expect(total.getByTestId('season-team-mu-total')).toHaveText('3/6');
    // No game has its quarters: every cell is a dash, with the coverage line saying why.
    for (const row of ['sq-for', 'sq-against', 'sq-diff']) {
      await expect(page.getByTestId(row).getByTestId('team-q')).toHaveText(['–', '–', '–', '–']);
      await expect(page.getByTestId(row).getByTestId('team-total')).toHaveText('–');
    }
    await expect(page.getByTestId('season-quarters-coverage')).toHaveText('Covers 0 of 4 games');
    await expect(page.getByTestId('season-quarters-note')).toHaveCount(0);
    await expect(page.getByTestId('season-goals-coverage')).toHaveText('Man-up figures cover 3 of 4 games');
    await noBadText(page);
  });

  test('no game with man-up figures: dashes in the total, goals without the split', async ({ page }) => {
    await openHomeTeam(page, {
      ...seasonStatsFull,
      results: seasonStatsFull.results.map(({ manUp, manDown, ...result }) => result),
    });
    const total = page.getByTestId('season-team-total');
    await expect(total.getByTestId('season-team-mu-total')).toHaveText('–');
    await expect(total.getByTestId('season-team-md-total')).toHaveText('–');
    await expect(total.getByTestId('season-team-mu-pct')).toHaveCount(0);
    await expect(total.getByTestId('season-team-md-pct')).toHaveCount(0);
    await expect(total.getByTestId('season-team-excl-total')).toHaveText('6');
    const goals = page.getByTestId('season-goals');
    await expect(goals.getByTestId('team-goals-for').getByTestId('team-goals-total')).toHaveText('14');
    await expect(goals.locator('.team-bar')).toHaveCount(0);
    await expect(page.getByTestId('season-goals-coverage')).toHaveText('Man-up figures cover 0 of 4 games');
    await noBadText(page);
  });

  test('a stats document with a malformed result still renders the others', async ({ page }) => {
    await openHomeTeam(page, {
      ...seasonStatsFull,
      results: [
        { gameId: 'x1', opponent: 'Broken FC', date: '2026-11-01', us: 4, them: 3, excl: -2, quarters: [{ us: 1 }], manUp: { played: 1, scored: 3 } },
        seasonStatsFull.results[0],
      ],
    });
    expect((await rowTexts(page))[0]).toEqual(['Broken FC', '01/11/2026', '–', '–', '–']);
    expect((await rowTexts(page))[1]).toEqual(fullRows[0]);
    await noBadText(page);
  });

  test('a season with no results says so', async ({ page }) => {
    await seedGame();
    await open(page);
    await expect(page.getByTestId('results-empty')).toBeVisible();
    await tab(page, 'team').click();
    await expect(page.getByTestId('season-team-empty')).toHaveText('No games yet this season.');
    await expect(page.getByTestId('season-team-game-row')).toHaveCount(0);
  });
});

test.describe('the stats module fails to load', () => {
  test.use({ serviceWorkers: 'block' });

  for (const screen of [
    { name: 'a game', hash: '#/game/team-g1', ready: 'score-us', other: 'timeline-item', first: 'timeline' },
    { name: 'home', hash: '', ready: 'result-row', other: 'season-row', first: 'results' },
  ]) {
    test(`on ${screen.name} the Team tab says so and the other tabs work`, async ({ page, baseURL, browserName }) => {
      blockedUrl = new URL('/js/teamStats.js', baseURL).href;
      await page.route('**/js/teamStats.js', route => route.abort());
      await seedHome(seasonStatsFull);
      await open(page, screen.hash);
      await expect(page.getByTestId(screen.ready).first()).toBeVisible();
      await tab(page, 'team').click();
      await expect(page.getByTestId('team-unavailable')).toBeVisible();
      await expect(page.getByTestId('team-unavailable')).toHaveText("Team stats aren't available right now.");
      await tab(page, 'players').click();
      await expect(page.getByTestId('team-unavailable')).toBeHidden();
      await expect(page.getByTestId(screen.name === 'home' ? 'season-row' : 'player-row').first()).toBeVisible();
      await tab(page, screen.first).click();
      await expect(page.getByTestId(screen.name === 'home' ? 'result-row' : 'timeline-item').first()).toBeVisible();
      // The failure was the one the test injected: Chromium reports it as a console error (filtered above), WebKit
      // does not log it at all.
      if (browserName === 'chromium') expect(blockedErrors.length).toBeGreaterThan(0);
    });
  }
});

// A game with figures at their widest: ten of twelve man-ups, twelve man-downs, a dozen exclusions, a Greek name
// as long as any seeded, and every row of foul trouble.
const longName = 'Αλέξανδρος Κωνσταντίνος Παπαγεωργίου';
const worstLineup = [
  { playerId: 'p1', name: 'Νίκος Λέκκας', cap: 1, goalie: true },
  { playerId: 'p7', name: 'Άρης Λάμπρου', cap: 7 },
  { playerId: 'p12', name: longName, cap: 12 },
  { playerId: 'p13', name: 'Παπαδόπουλος-Αθανασίου', cap: 13 },
];
function worstEvents() {
  let ts = 1000;
  const next = (type, period, playerId) => ({ id: `w${ts}`, type, period, ts: (ts += 10), ...(playerId ? { playerId } : {}) });
  const events = [];
  for (let quarter = 1; quarter <= 2; quarter += 1) {
    for (let i = 0; i < 10; i += 1) events.push(next('manUp', quarter), next('goal', quarter, 'p13'));
    for (let i = 0; i < 2; i += 1) events.push(next('manUp', quarter), next('manUpEnd', quarter));
    for (let i = 0; i < 12; i += 1) events.push(next('excl', quarter, 'p7'), next('manDownEnd', quarter));
  }
  events.push(next('excl', 3, 'p13'), next('pen', 3, 'p13'), next('oppGoal', 3));
  events.push(next('excl', 4, 'p12'), next('excl', 4, 'p12'), next('excl', 4, 'p12'));
  return events;
}
const worstGame = {
  ...teamGame, lineup: worstLineup, events: worstEvents(), opponent: 'Πανελλήνιος Γυμναστικός Σύλλογος Πειραιώς',
};
const worstResults = Array.from({ length: 8 }, (_, i) => ({
  gameId: `w${i}`, date: `2026-11-${String(20 - i).padStart(2, '0')}`,
  opponent: 'Πανελλήνιος Γυμναστικός Σύλλογος Πειραιώς Ολυμπιακός', us: 12, them: 11, excl: 12,
  quarters: [{ us: 12, them: 11 }, { us: 12, them: 11 }, { us: 12, them: 11 }, { us: 12, them: 11 }],
  manUp: { played: 17, scored: 12 }, manDown: { played: 16, stopped: 11 },
}));

// What a card's rows and cells do against the card they sit in, in CSS pixels.
const geometry = page => page.evaluate(() => {
  const box = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height }; };
  const cards = [...document.querySelectorAll('[data-testid="panel-team"] .panel-card')];
  return {
    scroll: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
    cards: cards.map(card => ({
      box: box(card),
      overflowing: [...card.querySelectorAll('*')].filter(el => box(el).right > box(card).right + 0.5 || box(el).left < box(card).left - 0.5)
        .map(el => `${el.tagName}.${el.className}`),
      rows: [...card.querySelectorAll('tr')].map(row => ({
        cells: [...row.children].map(cell => ({ ...box(cell), text: cell.textContent })),
      })),
    })),
  };
});

for (const scheme of ['light', 'dark']) {
  for (const [width, height] of [[360, 740], [740, 360]]) {
    test.describe(`Team tab at ${width} x ${height}, ${scheme}`, () => {
      test.use({ colorScheme: scheme, viewport: { width, height } });

      test('the game panel fits: nothing leaves its card, the long name is cut on one line', async ({ page }) => {
        await seedGame(worstGame);
        await open(page, '#/game/team-g1');
        await expect(page.getByTestId('score-us')).toHaveText('20');
        await tab(page, 'team').click();
        await expect(page.getByTestId('team-situations')).toBeVisible();
        // The widest figures are really there.
        await expect(page.getByTestId('team-manup').getByTestId('team-q').first()).toHaveText('10/12');
        await expect(page.getByTestId('team-mandown').getByTestId('team-q').first()).toHaveText('12/12');
        await expect(page.getByTestId('team-fouls-excl').getByTestId('team-total')).toHaveText('28');
        const g = await geometry(page);
        expect(g.scroll[0], 'no sideways scroll').toBeLessThanOrEqual(g.scroll[1]);
        for (const card of g.cards) expect(card.overflowing, 'nothing leaves its card').toEqual([]);
        // In the situations table the label column keeps room for its word.
        const first = g.cards[0].rows[1].cells[0];
        expect(first.w, 'the label column').toBeGreaterThanOrEqual(64);
        // Cells in a row never overlap.
        for (const card of g.cards) {
          for (const row of card.rows) {
            for (let i = 1; i < row.cells.length; i += 1) {
              expect(row.cells[i].left, `${row.cells[i].text} against ${row.cells[i - 1].text}`).toBeGreaterThanOrEqual(row.cells[i - 1].right - 0.5);
            }
          }
        }
        const trouble = page.getByTestId('foul-trouble-row');
        await expect(trouble).toHaveCount(3);
        const rows = await trouble.evaluateAll(els => els.map(el => {
          const name = el.querySelector('.team-trouble-name');
          const note = el.querySelector('.team-trouble-note');
          const row = el.getBoundingClientRect();
          const cap = el.querySelector('.cap').getBoundingClientRect();
          const pips = el.querySelector('.team-pips').getBoundingClientRect();
          const style = getComputedStyle(name);
          return {
            text: name.textContent,
            nameHeight: name.getBoundingClientRect().height,
            cut: name.scrollWidth > name.clientWidth + 0.5,
            ellipsis: style.textOverflow === 'ellipsis' && style.whiteSpace === 'nowrap',
            noteCut: note.scrollWidth > note.clientWidth + 0.5,
            noteHeight: note.getBoundingClientRect().height,
            rowHeight: row.height,
            capInside: cap.left >= row.left && cap.right <= row.right,
            pipsInside: pips.right <= row.right + 0.5 && pips.left >= cap.right,
            pips: pips.width,
          };
        }));
        for (const row of rows) {
          expect(row.ellipsis, `${row.text}: ellipsis on one line`).toBe(true);
          expect(row.nameHeight, `${row.text}: one line`).toBeLessThanOrEqual(21);
          expect(row.noteCut, `${row.text}: note whole`).toBe(false);
          expect(row.noteHeight, `${row.text}: note on one line`).toBeLessThanOrEqual(19);
          expect(row.capInside && row.pipsInside, `${row.text}: chip and pips inside the row`).toBe(true);
          expect(row.pips, 'three 12 px pips and two gaps').toBe(42);
          expect(row.rowHeight, `${row.text}: row height`).toBeLessThanOrEqual(60);
        }
        const long = rows.find(row => row.text === longName);
        // At 360 the long name does not fit and is cut; in landscape it has room.
        expect(long.cut, 'the long name is cut at 360 only').toBe(width === 360);
      });

      test('the season panel fits: rows keep their figures, the opponent is cut on one line', async ({ page }) => {
        await openHomeTeam(page, { ...seasonStatsFull, results: worstResults });
        await expect(page.getByTestId('season-team-game-row')).toHaveCount(8);
        await expect(page.getByTestId('season-team-total').getByTestId('season-team-mu-total')).toHaveText('96/136');
        const g = await geometry(page);
        expect(g.scroll[0], 'no sideways scroll').toBeLessThanOrEqual(g.scroll[1]);
        for (const card of g.cards) expect(card.overflowing, 'nothing leaves its card').toEqual([]);
        for (const card of g.cards) {
          for (const row of card.rows) {
            for (let i = 1; i < row.cells.length; i += 1) {
              expect(row.cells[i].left, `${row.cells[i].text} against ${row.cells[i - 1].text}`).toBeGreaterThanOrEqual(row.cells[i - 1].right - 0.5);
            }
          }
        }
        const labels = await page.getByTestId('season-team-game-row').first().evaluate(row => {
          const label = row.querySelector('.team-label');
          const style = getComputedStyle(label);
          return {
            height: label.getBoundingClientRect().height,
            width: label.getBoundingClientRect().width,
            cut: label.scrollWidth > label.clientWidth + 0.5,
            ellipsis: style.textOverflow === 'ellipsis' && style.whiteSpace === 'nowrap',
            dateCut: (() => { const sub = row.querySelector('.team-sub'); return sub.scrollWidth > sub.clientWidth + 0.5; })(),
            rowHeight: row.getBoundingClientRect().height,
          };
        });
        expect(labels.ellipsis, 'the opponent has an ellipsis').toBe(true);
        expect(labels.height, 'on one line').toBeLessThanOrEqual(20);
        expect(labels.dateCut, 'the date is whole').toBe(false);
        expect(labels.rowHeight, 'one name line and a date line').toBeLessThanOrEqual(56);
        expect(labels.width, 'the name keeps a usable width').toBeGreaterThanOrEqual(width === 360 ? 80 : 200);
        // At 360 the name is cut; in landscape this one is longer than the row too, so only the portrait claim is made.
        if (width === 360) expect(labels.cut, 'the name is cut at 360').toBe(true);
        // The quarter table with two-digit goals.
        await expect(page.getByTestId('sq-for').getByTestId('team-q').first()).toHaveText('96');
      });
    });
  }
}

test.describe('a season change', () => {
  test.use({ serviceWorkers: 'block' });
  const OLD = '2019-20';
  const NEW = '2020-21';
  const seasonOf = (season, opponent) => ({
    ...seasonStatsFull,
    results: seasonStatsFull.results.map(result => ({ ...result, opponent: `${opponent} ${result.gameId}` })),
  });

  test('while the new season loads the Team panel says so, never the previous numbers', async ({ page }) => {
    await Promise.all([
      seed('team/main', { currentGameId: 'old-g', roster }),
      seed('games/old-g', { ...teamGame, id: 'old-g', season: OLD }),
      seed('games/new-g', { ...teamGame, id: 'new-g', season: NEW }),
      seed(`stats/${OLD}`, seasonOf(OLD, 'Rivals')),
      seed(`stats/${NEW}`, seasonOf(NEW, 'Waves')),
    ]);
    // The new season's first answer is a cache miss; the server's follows 3 s later.
    await instrumentRepo(page, { [`stats/${NEW}`]: { miss: true, holdMs: 3000 } });
    await open(page);
    await expect(page.getByTestId('result-row')).toHaveCount(4);
    await tab(page, 'team').click();
    await expect(page.getByTestId('season-team-game-row')).toHaveCount(4);
    await expect(page.getByTestId('season-team-game-row').first()).toContainText('Rivals team-g1');
    // Record the panel from here on.
    await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="panel-team"]');
      window.__team = [];
      new MutationObserver(() => window.__team.push(panel.textContent)).observe(panel, { subtree: true, childList: true, characterData: true });
    });
    await update('team/main', { currentGameId: 'new-g' });
    await delivered(page, 'team/main', 'pointer', 'new-g');
    await expect(page.getByTestId('panel-team')).toContainText('Loading results…');
    await expect(page.getByTestId('season-team-game-row')).toHaveCount(0);
    await expect(page.getByTestId('season-team-game-row').first()).toContainText('Waves team-g1', { timeout: 8000 });
    const seen = await page.evaluate(() => window.__team);
    expect(seen.some(text => text.includes('Loading results…')), 'the loading line was shown').toBe(true);
    expect(seen.filter(text => text.includes('Rivals')), 'the old season after the switch').toEqual([]);
    expect(seen.at(-1)).toContain('Waves team-g1');
  });
});
