import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.js';
import {
  closeAll, consoleProblems, cssVariableColour, delivered, instrumentRepo, open, resetAll, seed, tab, update,
} from './helpers.js';
import { teamGame, teamGameExpected } from '../fixtures/team-game.js';
import {
  seasonStatsFull, seasonStatsFullExpected, seasonStatsOld, seasonStatsOldExpected,
} from '../fixtures/season-stats.js';

const roster = [
  { id: 'p1', name: 'Νίκος Λέκκας', cap: 1, archived: false },
  { id: 'p7', name: 'Άρης Λάμπρου', cap: 7, archived: false },
  { id: 'p12', name: 'Αλέξανδρος Κωνσταντίνος Παπαγεωργίου', cap: 12, archived: false },
];

let problems;
let blocked;
test.beforeEach(async ({ page }) => {
  blocked = { url: null, errors: [] };
  problems = consoleProblems(page, { blocked });
  await resetAll();
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});
test.afterAll(closeAll);

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


// Figures are the fixtures' expected values (the unit tests' source too); only how they are written is literal here.
const dashed = count => (count > 0 ? String(count) : '–');
const outOf = (quarter, key) => (quarter.played > 0 ? `${quarter[key]}/${quarter.played}` : '–');
const expected = teamGameExpected;

test.describe('the game Team tab', () => {
  test('man-up and man-down by quarter, with totals and percentages', async ({ page }) => {
    await openGameTeam(page);
    await expect(page.getByTestId('team-situations')).toBeVisible();
    await expect(page.getByTestId('team-situations').locator('thead th')).toHaveText(['Q1', 'Q2', 'Q3', 'Q4', 'Total']);
    const up = page.getByTestId('team-manup');
    await expect(up.locator('th')).toContainText(['Man-up']);
    await expect(up).toContainText('scored');
    await expect(up.getByTestId('team-q')).toHaveText(expected.manUp.quarters.map(quarter => outOf(quarter, 'scored')));
    await expect(up.getByTestId('team-total')).toHaveText(`${expected.manUp.scored}/${expected.manUp.played}`);
    await expect(up.getByTestId('team-pct')).toHaveText('50%');
    const down = page.getByTestId('team-mandown');
    await expect(down).toContainText('Man-down');
    await expect(down).toContainText('stopped');
    await expect(down.getByTestId('team-q')).toHaveText(expected.manDown.quarters.map(quarter => outOf(quarter, 'stopped')));
    await expect(down.getByTestId('team-total')).toHaveText(`${expected.manDown.stopped}/${expected.manDown.played}`);
    await expect(down.getByTestId('team-pct')).toHaveText('67%');
    // A quarter with none played is drawn dim.
    await expect(up.getByTestId('team-q').nth(2)).toHaveClass(/is-none/);
    await expect(up.getByTestId('team-q').nth(0)).not.toHaveClass(/is-none/);
    await expect(page.getByTestId('team-untracked')).toHaveCount(0);
    await noBadText(page);
  });

  test('goals for and against, each a bar and a legend', async ({ page }) => {
    await openGameTeam(page);
    const { goals } = expected;
    const bars = [
      ['team-goals-for', 'Goals for', goals.for, goals.manUpFor, 'man-up'],
      ['team-goals-against', 'Goals against', goals.against, goals.manDownAgainst, 'while a man down'],
    ];
    for (const [id, label, total, part, partLabel] of bars) {
      const block = page.getByTestId(id);
      await expect(block).toContainText(label);
      await expect(block.getByTestId('team-goals-total')).toHaveText(String(total));
      await expect(block.getByTestId('team-goals-part')).toHaveText(`${part} ${partLabel}`);
      await expect(block.getByTestId('team-goals-rest')).toHaveText(`${total - part} other`);
      await expect(block.locator('.team-bar')).toHaveAttribute('aria-label', `${total} · ${part} ${partLabel}`);
      const widths = await block.evaluate(el => ({
        fill: el.querySelector('.team-bar-fill').getBoundingClientRect().width,
        bar: el.querySelector('.team-bar').getBoundingClientRect().width,
      }));
      expect(widths.fill / widths.bar, `${id} fill share`).toBeCloseTo(part / total, 1);
    }
  });

  test('fouls by quarter and the penalty fouls', async ({ page }) => {
    await openGameTeam(page);
    await expect(page.getByTestId('team-fouls').locator('thead th')).toHaveText(['Q1', 'Q2', 'Q3', 'Q4', 'Total']);
    const excl = page.getByTestId('team-fouls-excl');
    await expect(excl).toContainText('Exclusions');
    await expect(excl.getByTestId('team-q')).toHaveText(expected.fouls.quarters.map(quarter => dashed(quarter.excl)));
    await expect(excl.getByTestId('team-total')).toHaveText(String(expected.fouls.excl));
    const pens = page.getByTestId('team-fouls-pens');
    await expect(pens).toContainText('Penalty fouls');
    await expect(pens.getByTestId('team-q')).toHaveText(expected.fouls.quarters.map(quarter => dashed(quarter.pens)));
    await expect(pens.getByTestId('team-total')).toHaveText(String(expected.fouls.pens));
  });

  test('foul trouble: the order, the pips and the text', async ({ page }) => {
    await openGameTeam(page);
    const rows = page.getByTestId('foul-trouble-row');
    await expect(rows).toHaveCount(expected.trouble.length);
    // Not out first, then out, each by cap: the order teamStats gives.
    for (const [index, player] of expected.trouble.entries()) {
      await expect(rows.nth(index)).toHaveAttribute('data-cap', String(player.cap));
      await expect(rows.nth(index).locator('.cap')).toHaveText(String(player.cap));
      await expect(rows.nth(index).getByTestId('foul-trouble-name')).toHaveText(player.name);
      await expect(rows.nth(index).getByTestId('foul-trouble-note')).toHaveText(
        player.out ? 'Out' : `${player.fouls} of 3 fouls · one more and out`);
    }
    // Three 12 px pips each: exclusions, then penalty fouls, then what is left.
    const pips = row => row.locator('.team-pip').evaluateAll(els => els.map(el => {
      const box = el.getBoundingClientRect();
      return { kind: el.className.replace('team-pip team-pip--', ''), w: box.width, h: box.height };
    }));
    const pip = kind => ({ kind, w: 12, h: 12 });
    // p7: two exclusions; p12: an exclusion and two penalty fouls (from the fixture's events).
    expect(await pips(rows.nth(0))).toEqual([pip('excl'), pip('excl'), pip('empty')]);
    expect(await pips(rows.nth(1))).toEqual([pip('excl'), pip('pen'), pip('pen')]);
    await expect(rows.nth(0).locator('.team-pips')).toHaveAttribute('aria-label', 'Exclusions: 2, penalty fouls: 0');
    await expect(rows.nth(1).locator('.team-pips')).toHaveAttribute('aria-label', 'Exclusions: 1, penalty fouls: 2');
    // The out note is in the out colour; the other is muted.
    const colours = await rows.evaluateAll(els => els.map(el => getComputedStyle(el.querySelector('.team-trouble-note')).color));
    expect(colours[0]).not.toBe(colours[1]);
    await expect(page.getByTestId('team-pens-against')).toHaveText(
      `${expected.pensAgainst.faced} faced · ${expected.pensAgainst.saved} saved`);
  });

  test('game flow', async ({ page }) => {
    await openGameTeam(page);
    const { flow } = expected;
    await expect(page.getByTestId('flow-lead')).toHaveText(`+${flow.biggestLead}`);
    await expect(page.getByTestId('flow-run')).toHaveText(`${flow.longestRun.us}–${flow.longestRun.them}`);
    await expect(page.getByTestId('flow-ties')).toHaveText(`${flow.ties} · never behind`);
    expect(flow.neverBehind).toBe(true);
    await expect(page.getByTestId('flow-scorers')).toHaveText(String(flow.scorers));
  });

  test('penalties faced and saved, and the scorer count, follow the game', async ({ page }) => {
    await openGameTeam(page);
    const { faced, saved } = expected.pensAgainst;
    const text = (facedCount, savedCount) => `${facedCount} faced · ${savedCount} saved`;
    await expect(page.getByTestId('team-pens-against')).toHaveText(text(faced, saved));
    await expect(page.getByTestId('flow-scorers')).toHaveText(String(expected.flow.scorers));
    // A save of the other penalty, a goal by cap 1, who has not scored (a new scorer), and one with no scorer.
    await update('games/team-g1', {
      events: [
        ...teamGame.events,
        { id: 'e19', type: 'penSave', period: 4, ts: 19000, playerId: 'p1' },
        { id: 'e20', type: 'goal', period: 4, ts: 20000, playerId: 'p1' },
        { id: 'e21', type: 'goal', period: 4, ts: 21000 },
      ],
    });
    // Faced is unchanged, saved is one more; the scorer count counts the new scorer once, not the goal with none.
    await expect(page.getByTestId('team-pens-against')).toHaveText(text(faced, saved + 1));
    await expect(page.getByTestId('flow-scorers')).toHaveText(String(expected.flow.scorers + 1));
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
    await expect(page.getByTestId('team-goals-for').getByTestId('team-goals-total')).toHaveText(String(expected.goals.for));
    await expect(page.getByTestId('team-goals-against').getByTestId('team-goals-total')).toHaveText(String(expected.goals.against));
    await expect(page.locator('.team-bar')).toHaveCount(0);
    await expect(page.getByTestId('team-goals-part')).toHaveCount(0);
    // The fouls, trouble and flow do not depend on it.
    await expect(page.getByTestId('team-fouls-excl').getByTestId('team-total')).toHaveText(String(expected.fouls.excl));
    await expect(page.getByTestId('foul-trouble-row')).toHaveCount(expected.trouble.length);
    await expect(page.getByTestId('flow-lead')).toHaveText(`+${expected.flow.biggestLead}`);
  });

  // A tracked side with no goals still has known counts: they are zeros, not "untracked".
  test('tracked, our side scoreless: its legend and an empty bar stay', async ({ page }) => {
    const events = [
      { id: 'z1', type: 'manUp', period: 1, ts: 1000 },
      { id: 'z2', type: 'manUpEnd', period: 1, ts: 2000 },
      { id: 'z3', type: 'oppGoal', period: 1, ts: 3000 },
      { id: 'z4', type: 'oppGoal', period: 2, ts: 4000 },
    ];
    await openGameTeam(page, { ...teamGame, events }, '0');
    const forGoals = page.getByTestId('team-goals-for');
    await expect(forGoals.getByTestId('team-goals-total')).toHaveText('0');
    await expect(forGoals.getByTestId('team-goals-part')).toHaveText('0 man-up');
    await expect(forGoals.getByTestId('team-goals-rest')).toHaveText('0 other');
    await expect(forGoals.locator('.team-bar')).toHaveAttribute('aria-label', '0 · 0 man-up');
    await expect(forGoals.locator('.team-bar')).toBeVisible();
    await expect(forGoals.locator('.team-bar-fill')).toHaveCount(0);
    // The other side is tracked too: two goals against, none while a man down.
    const against = page.getByTestId('team-goals-against');
    await expect(against.getByTestId('team-goals-total')).toHaveText('2');
    await expect(against.getByTestId('team-goals-part')).toHaveText('0 while a man down');
    await expect(against.getByTestId('team-goals-rest')).toHaveText('2 other');
    await expect(against.locator('.team-bar-fill')).toHaveCount(0);
    await noBadText(page);
  });

  test('tracked shutout: the goals against show a known 0 while a man down', async ({ page }) => {
    const events = [
      { id: 's1', type: 'manUp', period: 1, ts: 1000 },
      { id: 's2', type: 'goal', period: 1, ts: 2000, playerId: 'p7' },
      { id: 's3', type: 'goal', period: 2, ts: 3000, playerId: 'p7' },
    ];
    await openGameTeam(page, { ...teamGame, events }, '2');
    const against = page.getByTestId('team-goals-against');
    await expect(against.getByTestId('team-goals-total')).toHaveText('0');
    await expect(against.getByTestId('team-goals-part')).toHaveText('0 while a man down');
    await expect(against.getByTestId('team-goals-rest')).toHaveText('0 other');
    await expect(against.locator('.team-bar')).toHaveAttribute('aria-label', '0 · 0 while a man down');
    await expect(against.locator('.team-bar-fill')).toHaveCount(0);
    // Our side keeps its bar: 2 goals, 1 of them on a man-up.
    const forGoals = page.getByTestId('team-goals-for');
    await expect(forGoals.getByTestId('team-goals-part')).toHaveText('1 man-up');
    await expect(forGoals.locator('.team-bar-fill')).toHaveCount(1);
  });

  test('a tracked 0–0 game: both sides keep their zero legends', async ({ page }) => {
    await openGameTeam(page, { ...teamGame, events: [{ id: 'q1', type: 'manUp', period: 1, ts: 1000 }, { id: 'q2', type: 'manUpEnd', period: 1, ts: 2000 }] }, '0');
    for (const [id, label] of [['team-goals-for', 'man-up'], ['team-goals-against', 'while a man down']]) {
      const block = page.getByTestId(id);
      await expect(block.getByTestId('team-goals-total')).toHaveText('0');
      await expect(block.getByTestId('team-goals-part')).toHaveText(`0 ${label}`);
      await expect(block.getByTestId('team-goals-rest')).toHaveText('0 other');
      await expect(block.locator('.team-bar')).toBeVisible();
      await expect(block.locator('.team-bar-fill')).toHaveCount(0);
    }
    await noBadText(page);
  });

  test('the panel follows the game: a new goal changes the figures', async ({ page }) => {
    await openGameTeam(page);
    await expect(page.getByTestId('team-goals-for').getByTestId('team-goals-total')).toHaveText(String(expected.goals.for));
    await update('games/team-g1', {
      events: [...teamGame.events, { id: 'e19', type: 'goal', period: 4, ts: 19000, playerId: 'p7' }],
    });
    await expect(page.getByTestId('team-goals-for').getByTestId('team-goals-total')).toHaveText(String(expected.goals.for + 1));
    await expect(page.getByTestId('flow-scorers')).toHaveText(String(expected.flow.scorers));
    await expect(page.getByTestId('flow-lead')).toHaveText(`+${expected.flow.biggestLead + 1}`);
  });
});

// The by-game rows the fixtures expect, as the screen writes them.
const gameRowTexts = games => games.map(game => [
  game.opponent,
  game.date.split('-').reverse().join('/'),
  game.manUp === null ? '–' : `${game.manUp.scored}/${game.manUp.played}`,
  game.manDown === null ? '–' : `${game.manDown.stopped}/${game.manDown.played}`,
  game.excl === null ? '–' : String(game.excl),
]);
const full = seasonStatsFullExpected;
const old = seasonStatsOldExpected;
const quarterText = values => values.map(String);
const signedText = value => (value > 0 ? `+${value}` : value < 0 ? `−${-value}` : '0');

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
    expect(await rowTexts(page)).toEqual(gameRowTexts(full.games));
    const total = page.getByTestId('season-team-total');
    await expect(total).toContainText('Season');
    await expect(total.getByTestId('season-team-mu-total')).toHaveText(`${full.total.manUp.scored}/${full.total.manUp.played}`);
    await expect(total.getByTestId('season-team-mu-pct')).toHaveText('50%');
    await expect(total.getByTestId('season-team-md-total')).toHaveText(`${full.total.manDown.stopped}/${full.total.manDown.played}`);
    await expect(total.getByTestId('season-team-md-pct')).toHaveText('60%');
    await expect(total.getByTestId('season-team-excl-total')).toHaveText(String(full.total.excl));
    await expect(total.getByTestId('season-team-excl-avg')).toHaveText(`${(full.total.excl / full.total.exclGames).toFixed(1)}/game`);
    await expect(page.locator('.team-legend-note')).toHaveText(
      'MU: man-up goals / man-ups · MD: man-downs stopped / man-downs · EXCL: our exclusions');
    await noBadText(page);
  });

  test('goals by quarter: the rows, the total, a loss in the difference, the note and the coverage', async ({ page }) => {
    await openHomeTeam(page, seasonStatsFull);
    const q = full.quarters;
    await expect(page.getByTestId('season-quarters').locator('thead th')).toHaveText(['Q1', 'Q2', 'Q3', 'Q4', 'Total']);
    const forRow = page.getByTestId('sq-for');
    const against = page.getByTestId('sq-against');
    const diff = page.getByTestId('sq-diff');
    await expect(forRow).toContainText('For');
    await expect(forRow.getByTestId('team-q')).toHaveText(quarterText(q.for));
    await expect(forRow.getByTestId('team-total')).toHaveText(String(q.totalFor));
    await expect(against).toContainText('Against');
    await expect(against.getByTestId('team-q')).toHaveText(quarterText(q.against));
    await expect(against.getByTestId('team-total')).toHaveText(String(q.totalAgainst));
    await expect(diff).toContainText('Difference');
    await expect(diff.getByTestId('team-q')).toHaveText(q.diff.map(signedText));
    await expect(diff.getByTestId('team-total')).toHaveText(signedText(q.totalDiff));
    // A loss is in the out colour (and so is nothing else in the row).
    const colours = await diff.getByTestId('team-q').evaluateAll(els => els.map(el => getComputedStyle(el).color));
    const outColour = await cssVariableColour(page, '--out-text');
    q.diff.forEach((value, index) => {
      if (value < 0) expect(colours[index], `quarter ${index + 1} is a loss`).toBe(outColour);
      else expect(colours[index], `quarter ${index + 1} is not a loss`).not.toBe(outColour);
    });
    await expect(page.getByTestId('season-quarters-note')).toHaveText('Q2 is the only quarter we lose.');
    await expect(page.getByTestId('season-quarters-coverage')).toHaveText(`Covers ${q.covered} of ${q.of} games`);
  });

  test('goals: for and against with the man-up and man-down split, and what the split covers', async ({ page }) => {
    await openHomeTeam(page, seasonStatsFull);
    const { goals } = full;
    const card = page.getByTestId('season-goals');
    const forGoals = card.getByTestId('team-goals-for');
    await expect(forGoals.getByTestId('team-goals-total')).toHaveText(String(goals.for));
    await expect(forGoals.getByTestId('team-goals-part')).toHaveText(`${goals.manUpFor} man-up`);
    await expect(forGoals.getByTestId('team-goals-rest')).toHaveText(`${goals.for - goals.manUpFor} other`);
    const against = card.getByTestId('team-goals-against');
    await expect(against.getByTestId('team-goals-total')).toHaveText(String(goals.against));
    await expect(against.getByTestId('team-goals-part')).toHaveText(`${goals.manDownAgainst} while a man down`);
    await expect(against.getByTestId('team-goals-rest')).toHaveText(`${goals.against - goals.manDownAgainst} other`);
    await expect(page.getByTestId('season-goals-coverage')).toHaveText(`Man-up figures cover ${goals.situationGames} of ${goals.of} games`);
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
    expect(await rowTexts(page)).toEqual(gameRowTexts(old.games));
    const total = page.getByTestId('season-team-total');
    await expect(total.getByTestId('season-team-excl-total')).toHaveText('–');
    await expect(total.getByTestId('season-team-excl-avg')).toHaveText('–');
    await expect(total.getByTestId('season-team-mu-total')).toHaveText(`${old.total.manUp.scored}/${old.total.manUp.played}`);
    // No game has its quarters: every cell is a dash, with the coverage line saying why.
    for (const row of ['sq-for', 'sq-against', 'sq-diff']) {
      await expect(page.getByTestId(row).getByTestId('team-q')).toHaveText(['–', '–', '–', '–']);
      await expect(page.getByTestId(row).getByTestId('team-total')).toHaveText('–');
    }
    await expect(page.getByTestId('season-quarters-coverage')).toHaveText(`Covers ${old.quarters.covered} of ${old.quarters.of} games`);
    await expect(page.getByTestId('season-quarters-note')).toHaveCount(0);
    await expect(page.getByTestId('season-goals-coverage')).toHaveText(
      `Man-up figures cover ${old.goals.situationGames} of ${old.goals.of} games`);
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
    await expect(total.getByTestId('season-team-excl-total')).toHaveText(String(full.total.excl));
    const goals = page.getByTestId('season-goals');
    await expect(goals.getByTestId('team-goals-for').getByTestId('team-goals-total')).toHaveText(String(full.goals.for));
    await expect(goals.locator('.team-bar')).toHaveCount(0);
    await expect(page.getByTestId('season-goals-coverage')).toHaveText(`Man-up figures cover 0 of ${full.goals.of} games`);
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
    expect((await rowTexts(page))[1]).toEqual(gameRowTexts(full.games)[0]);
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
      blocked.url = new URL('/js/teamStats.js', baseURL).href;
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
      if (browserName === 'chromium') expect(blocked.errors.length).toBeGreaterThan(0);
    });
  }
});

test.describe('R2 model.js beside the Team tab', () => {
  test.use({ serviceWorkers: 'block' });

  for (const screen of [
    { name: 'a game', hash: '#/game/team-g1', ready: 'score-us' },
    { name: 'home', hash: '', ready: 'result-row' },
  ]) {
    test(`on ${screen.name} the Team tab has real figures and no undefined`, async ({ page }) => {
      const previous = execFileSync('git', ['show', '720f124:js/model.js'], { encoding: 'utf8', maxBuffer: 1 << 20 });
      let served = 0;
      await page.route('**/js/model.js*', route => {
        served++;
        return route.fulfill({ contentType: 'text/javascript', body: previous });
      });
      await seedHome(seasonStatsFull);
      await open(page, screen.hash);
      await expect(page.getByTestId(screen.ready).first()).toBeVisible();
      expect(served, 'R2 model.js was served').toBeGreaterThan(0);
      await tab(page, 'team').click();
      if (screen.name === 'a game') {
        await expect(page.getByTestId('team-fouls-excl').getByTestId('team-total')).toHaveText(String(expected.fouls.excl));
        await expect(page.getByTestId('team-fouls-pens').getByTestId('team-total')).toHaveText(String(expected.fouls.pens));
        await expect(page.getByTestId('team-fouls-excl').getByTestId('team-q'))
          .toHaveText(expected.fouls.quarters.map(quarter => dashed(quarter.excl)));
        await expect(page.getByTestId('team-pens-against')).toHaveText(
          `${expected.pensAgainst.faced} faced · ${expected.pensAgainst.saved} saved`);
        await expect(page.getByTestId('team-goals-for').getByTestId('team-goals-total')).toHaveText(String(expected.goals.for));
      } else {
        const total = page.getByTestId('season-team-total');
        await expect(total.getByTestId('season-team-excl-total')).toHaveText(String(seasonStatsFullExpected.total.excl));
      }
      await noBadText(page);
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
function worstEvents(opponentGoals = 0) {
  let ts = 1000;
  const next = (type, period, playerId) => ({ id: `w${ts}`, type, period, ts: (ts += 10), ...(playerId ? { playerId } : {}) });
  const events = [];
  for (let quarter = 1; quarter <= 2; quarter += 1) {
    for (let i = 0; i < 10; i += 1) events.push(next('manUp', quarter), next('goal', quarter, 'p13'));
    for (let i = 0; i < 2; i += 1) events.push(next('manUp', quarter), next('manUpEnd', quarter));
    for (let i = 0; i < 12; i += 1) events.push(next('excl', quarter, 'p7'), next('manDownEnd', quarter));
  }
  // `opponentGoals` more in Q3 level a 20-1 game: 20-20 after regulation, so a shootout decides it.
  for (let i = 0; i < opponentGoals; i += 1) events.push(next('oppGoal', 3));
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


// Whether the page, and every card on the Team panel, holds together; and whether the named elements are on show
// and inside the viewport, side to side.
async function expectFits(page) {
  const g = await geometry(page);
  expect(g.scroll[0], 'no sideways scroll').toBeLessThanOrEqual(g.scroll[1]);
  for (const card of g.cards) {
    expect(card.overflowing, 'nothing leaves its card').toEqual([]);
    for (const row of card.rows) {
      for (let i = 1; i < row.cells.length; i += 1) {
        expect(row.cells[i].left, `${row.cells[i].text} against ${row.cells[i - 1].text}`).toBeGreaterThanOrEqual(row.cells[i - 1].right - 0.5);
      }
    }
  }
}
async function expectInView(page, ids) {
  for (const id of ids) {
    await expect(page.getByTestId(id), `${id} is shown`).toBeVisible();
    const box = await page.getByTestId(id).evaluate(el => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height, vw: document.documentElement.clientWidth };
    });
    expect(box.w, `${id} has a width`).toBeGreaterThan(0);
    expect(box.h, `${id} has a height`).toBeGreaterThan(0);
    expect(box.left, `${id} starts inside the viewport`).toBeGreaterThanOrEqual(-0.5);
    expect(box.right, `${id} ends inside the viewport`).toBeLessThanOrEqual(box.vw + 0.5);
  }
}

// The screens' own badges with the Team tab selected: a live game (LIVE, the quarter, the open man-down), a live
// game in its shootout (LIVE, the Shootout pill, the shootout score), a final decided on a shootout; and home with
// the live banner over a season whose record a shootout decides. Shootout games are level after regulation (20-20).
const liveWorst = { ...worstGame, status: 'live', period: 4 };
const soEvents = [
  { id: 'so1', type: 'goal', period: 'SO', ts: 90000, playerId: 'p13' },
  { id: 'so2', type: 'oppGoal', period: 'SO', ts: 90010 },
  { id: 'so3', type: 'goal', period: 'SO', ts: 90020, playerId: 'p13' },
];
const shootoutWorst = { ...worstGame, status: 'final', period: 'SO', events: [...worstEvents(19), ...soEvents] };
const liveShootoutWorst = { ...worstGame, status: 'live', period: 'SO', events: [...worstEvents(19), ...soEvents] };
// Eight results: three level after regulation and decided on penalties (two won, one lost), five won in the water.
// Without the shootout the record would be 5 W · 3 D.
const shootoutResults = worstResults.map((result, index) => {
  if (index < 2) return { ...result, us: 12, them: 12, soUs: 14, soThem: 13 };
  if (index === 2) return { ...result, us: 12, them: 12, soUs: 12, soThem: 13 };
  return result;
});

for (const scheme of ['light', 'dark']) {
  for (const [width, height] of [[360, 740], [844, 390]]) {
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

      test('a live game keeps LIVE, the quarter and the open man-down in view over the Team figures', async ({ page }) => {
        await seedGame(liveWorst);
        await open(page, '#/game/team-g1');
        await expect(page.getByTestId('score-us')).toHaveText('20');
        await tab(page, 'team').click();
        await expect(page.getByTestId('team-manup').getByTestId('team-q').first()).toHaveText('10/12');
        await expectInView(page, ['live-badge', 'period', 'situation-badge', 'score-us', 'score-them', 'tab-team']);
        await expect(page.getByTestId('period')).toHaveText('Q4');
        await expect(page.getByTestId('situation-badge')).toHaveText('Man-down');
        await expect(page.getByTestId('final-badge')).toBeHidden();
        await expectFits(page);
      });

      test('a live game in its shootout keeps LIVE, the Shootout pill and the shootout score in view over the Team figures', async ({ page }) => {
        await seedGame(liveShootoutWorst);
        await open(page, '#/game/team-g1');
        await expect(page.getByTestId('score-us')).toHaveText('20');
        await tab(page, 'team').click();
        await expect(page.getByTestId('team-manup').getByTestId('team-q').first()).toHaveText('10/12');
        await expectInView(page, ['live-badge', 'period', 'shootout', 'score-us', 'score-them', 'tab-team']);
        await expect(page.getByTestId('period')).toHaveText('Shootout');
        await expect(page.getByTestId('shootout')).toHaveText('(2 – 1 pen.)');
        await expect(page.getByTestId('final-badge')).toBeHidden();
        await expect(page.getByTestId('team-goals-for').getByTestId('team-goals-total')).toHaveText('20');
        await expectFits(page);
      });

      test('a final decided on a shootout keeps FINAL and the shootout score in view over the Team figures', async ({ page }) => {
        await seedGame(shootoutWorst);
        await open(page, '#/game/team-g1');
        await expect(page.getByTestId('score-us')).toHaveText('20');
        await tab(page, 'team').click();
        await expect(page.getByTestId('team-manup').getByTestId('team-q').first()).toHaveText('10/12');
        await expectInView(page, ['final-badge', 'shootout', 'score-us', 'score-them', 'tab-team']);
        await expect(page.getByTestId('shootout')).toHaveText('(2 – 1 pen.)');
        await expect(page.getByTestId('live-badge')).toBeHidden();
        // The shootout is no part of the Team figures: goals stay the regulation 20.
        await expect(page.getByTestId('team-goals-for').getByTestId('team-goals-total')).toHaveText('20');
        await expectFits(page);
      });

      test('home keeps the live banner and the record in view over the season Team figures', async ({ page }) => {
        await Promise.all([seedGame(liveWorst), seed('stats/2026-27', { ...seasonStatsFull, results: shootoutResults })]);
        await open(page);
        await expect(page.getByTestId('result-row')).toHaveCount(8);
        await tab(page, 'team').click();
        await expect(page.getByTestId('season-team-total').getByTestId('season-team-mu-total')).toHaveText('96/136');
        await expectInView(page, ['live-banner', 'season-record', 'tab-team']);
        // The shootouts decide three of the games: 7 W · 1 L, not 5 W · 0 L · 3 D.
        await expect(page.getByTestId('season-record')).toHaveText('7 W · 1 L');
        await expectFits(page);
      });
    });
  }
}

test.describe('a season change', () => {
  test.use({ serviceWorkers: 'block' });
  const OLD = '2019-20';
  const NEW = '2020-21';
  const seasonOf = (opponent, exclusions) => ({
    ...seasonStatsFull,
    results: seasonStatsFull.results.map(result => ({
      ...result, opponent: `${opponent} ${result.gameId}`, excl: exclusions,
    })),
  });
  const oldStats = seasonOf('Rivals', 1);
  const newStats = seasonOf('Waves', 2);

  test('while the new season loads the Team panel says so, never the previous numbers', async ({ page }) => {
    await Promise.all([
      seed('team/main', { currentGameId: 'old-g', roster }),
      seed('games/old-g', { ...teamGame, id: 'old-g', season: OLD }),
      seed('games/new-g', { ...teamGame, id: 'new-g', season: NEW }),
      seed(`stats/${OLD}`, oldStats),
      seed(`stats/${NEW}`, newStats),
    ]);
    // Show the old stats from a simulated cache hit while its server callback is held.
    // For the new season, show a cache miss until the test releases its server callback.
    const oldPath = `stats/${OLD}`;
    const newPath = `stats/${NEW}`;
    await instrumentRepo(page, { [oldPath]: { hold: true }, [newPath]: { miss: true, hold: true } });
    await open(page);
    await expect(page.getByTestId('result-row')).toHaveCount(4);
    await tab(page, 'team').click();
    await expect(page.getByTestId('season-team-game-row')).toHaveCount(4);
    await expect(page.getByTestId('season-team-game-row').first()).toContainText('Rivals team-g1');
    const exclusions = page.getByTestId('season-team-total').getByTestId('season-team-excl-total');
    await expect(exclusions).toHaveText('4');
    await expect.poll(() => page.evaluate(path => window.__queued?.[path], oldPath)).toBe(1);
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
    await expect.poll(() => page.evaluate(path => window.__queued?.[path], newPath)).toBe(1);
    await page.evaluate(path => window.__releaseHeld(path), newPath);
    await expect(page.getByTestId('season-team-game-row').first()).toContainText('Waves team-g1');
    await expect(exclusions).toHaveText('8');
    const oldDeliveries = () => page.evaluate(path => window.__snaps
      .filter(snap => snap.path === path && !snap.fromCache).length, oldPath);
    expect(await oldDeliveries()).toBe(0);
    await page.evaluate(path => window.__releaseHeld(path), oldPath);
    expect(await oldDeliveries()).toBe(1);
    await expect(page.getByTestId('season-team-game-row').first()).toContainText('Waves team-g1');
    await expect(exclusions).toHaveText('8');
    const seen = await page.evaluate(() => window.__team);
    expect(seen.some(text => text.includes('Loading results…')), 'the loading line was shown').toBe(true);
    expect(seen.filter(text => text.includes('Rivals')), 'the old season after the switch').toEqual([]);
    expect(seen.at(-1)).toContain('Waves team-g1');
  });

  test('the Team panel ignores a stats snapshot whose key differs from the shown season', async ({ page }) => {
    const viewer = readFileSync('js/viewer.js', 'utf8');
    // Keep the ready home plan and call its real renderer with a mismatched snapshot.
    // A late repo callback alone would stop at the subscription token check.
    await page.route('**/js/viewer.js', route => route.fulfill({
      contentType: 'text/javascript',
      body: `${viewer}
        window.__renderWithStats = (key, data) => {
          const plan = planFor(parseRoute(location.hash));
          const stats = state.stats;
          try {
            state.stats = { ...stats, key, data };
            renderSeason(plan, true);
          } finally {
            state.stats = stats;
          }
          return { season: plan.season, results: plan.results };
        };
      `,
    }));
    await Promise.all([
      seed('team/main', { currentGameId: 'new-g', roster }),
      seed('games/new-g', { ...teamGame, id: 'new-g', season: NEW }),
      seed(`stats/${NEW}`, newStats),
    ]);
    await open(page);
    await tab(page, 'team').click();
    await expect(page.getByTestId('season-team-game-row').first()).toContainText('Waves team-g1');
    const plan = await page.evaluate(({ key, data }) => window.__renderWithStats(key, data), { key: OLD, data: oldStats });
    expect(plan).toEqual({ season: NEW, results: 'ready' });
    await expect(page.getByTestId('season-team-empty')).toBeVisible();
    await expect(page.getByTestId('season-team-game-row')).toHaveCount(0);
  });
});
