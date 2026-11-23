import { execFileSync } from 'node:child_process';
import { test, expect } from './fixtures.js';
import { aggregateSeason, seasonFor, todayIso } from '../../js/model.js';
import {
  closeAll, consoleProblems, expectTagFits, noSideScroll, open, resetAll, seed, tab, update,
} from './helpers.js';
import { formatConsoleProblem } from './tracker-helpers.js';
import { isFirestoreChannelLoss } from './network-noise.js';

const SEASON = seasonFor(todayIso());
const roster = [
  { id: 'p2', name: 'Papadakis', cap: 2, archived: false },
  { id: 'p5', name: 'Alexiou', cap: 5, archived: false },
];
const lineup = [
  { playerId: 'p5', name: 'Alexiou', cap: 5 },
  { playerId: 'p2', name: 'Papadakis', cap: 2 },
];
// 40 characters, no break opportunity, Greek, the widest glyph.
const LONG_NAME = 'Φ'.repeat(40);
const lists = {
  tournaments: { t1: { name: 'Spring Cup' } },
  phases: { p1: { name: 'Regular season' }, p2: { name: 'Play-offs' } },
};

// One final game: `p5` goals for Alexiou, `p2` for Papadakis (who is in the lineup only when he scores) and one
// goal against, so every game is a win.
function game(id, opponent, date, p5, p2, extra = {}) {
  const events = [{ id: `${id}-o`, type: 'oppGoal', period: 1, ts: 1 }];
  for (let i = 0; i < p5; i++) events.push({ id: `${id}-a${i}`, type: 'goal', period: 1, ts: 10 + i, playerId: 'p5' });
  for (let i = 0; i < p2; i++) events.push({ id: `${id}-b${i}`, type: 'goal', period: 1, ts: 100 + i, playerId: 'p2' });
  return {
    id, opponent, date, season: SEASON, status: 'final', period: 4, lineup: p2 > 0 ? lineup : lineup.slice(0, 1), events, ...extra,
  };
}
const games = (overrides = {}) => [
  game('a1', 'Alpha FC', '2026-10-03', 2, 1, { phaseId: 'p1' }),
  game('a2', 'Bravo FC', '2026-10-10', overrides.bravo ?? 3, 0, { phaseId: overrides.bravoPhase ?? 'p2' }),
  game('a3', 'Charlie FC', '2026-10-17', 4, 0, { competition: 'tournament', tournamentId: 't1', competitionName: 'Spring Cup' }),
  game('a4', 'Delta FC', '2026-10-24', 5, 0, { competition: 'cup' }),
  game('a5', 'Echo FC', '2026-10-31', 6, 0, { competition: 'friendly' }),
];
const seedStats = list => seed(`stats/${SEASON}`, aggregateSeason(list, roster));
// The games' own competition fields are what gameResult reads.
const seedTeam = (extra = lists) => seed('team/main', { roster, ...extra });

let problems;
test.beforeEach(async ({ page }) => {
  problems = consoleProblems(page, { ignore: isFirestoreChannelLoss, format: formatConsoleProblem });
  await resetAll();
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});
test.afterAll(closeAll);

const select = page => page.getByTestId('scope-select');
const row = (page, opponent) => page.getByTestId('result-row').filter({ hasText: opponent });
const note = page => page.locator('[role=tabpanel]:not([hidden])').getByTestId('friendlies-note');
const goalsOf = (page, name) => page.getByTestId('season-row').filter({ hasText: name }).locator('td').nth(2);

async function openPlayers(page) {
  await open(page);
  await expect(page.getByTestId('result-row')).not.toHaveCount(0);
  await tab(page, 'players').click();
}

test.describe('the Showing selector', () => {
  test.beforeEach(async () => {
    await seedTeam();
    await seedStats(games());
  });

  test('offers Season, League, each phase, each tournament and Cup in order, on Players and Team only', async ({ page }) => {
    await open(page);
    await expect(page.getByTestId('result-row')).toHaveCount(5);
    await expect(select(page)).toBeHidden();
    await tab(page, 'players').click();
    await expect(select(page)).toBeVisible();
    await expect(select(page).locator('option')).toHaveText([
      'Season', 'League', 'League – Regular season', 'League – Play-offs', 'Spring Cup', 'Cup',
    ]);
    await expect(select(page).locator('option')).toHaveCount(6);
    await expect(select(page)).toHaveValue('season');
    await expect(page.getByTestId('scope-label')).toHaveText('Showing');
    await tab(page, 'team').click();
    await expect(select(page)).toBeVisible();
    await tab(page, 'results').click();
    await expect(select(page)).toBeHidden();
  });

  test('picking a phase narrows Players and Team, the choice follows the tab, and Season brings everything back', async ({ page }) => {
    await openPlayers(page);
    await expect(goalsOf(page, 'Alexiou')).toHaveText('14');
    await expect(goalsOf(page, 'Papadakis')).toHaveText('1');
    await expect(note(page)).toHaveText('Friendlies not counted (1)');

    await select(page).selectOption('phase:p2');
    await expect(page.getByTestId('season-row')).toHaveCount(1);
    await expect(goalsOf(page, 'Alexiou')).toHaveText('3');
    await expect(note(page)).toHaveCount(0);
    // The header record and the Results tab stay whole-season.
    await expect(page.getByTestId('season-record')).toHaveText('4 W · 0 L');

    await tab(page, 'team').click();
    await expect(select(page)).toHaveValue('phase:p2');
    await expect(page.getByTestId('season-team-game-row')).toHaveCount(1);
    await expect(page.getByTestId('season-team-game-row')).toContainText('Bravo FC');
    await expect(note(page)).toHaveCount(0);

    await tab(page, 'results').click();
    await expect(page.getByTestId('result-row')).toHaveCount(5);

    await tab(page, 'team').click();
    await select(page).selectOption('league');
    await expect(page.getByTestId('season-team-game-row')).toHaveCount(2);
    await tab(page, 'players').click();
    await expect(select(page)).toHaveValue('league');
    await expect(goalsOf(page, 'Alexiou')).toHaveText('5');

    await select(page).selectOption('tournament:t1');
    await expect(page.getByTestId('season-row')).toHaveCount(1);
    await expect(goalsOf(page, 'Alexiou')).toHaveText('4');
    await select(page).selectOption('cup');
    await expect(goalsOf(page, 'Alexiou')).toHaveText('5');

    await select(page).selectOption('season');
    await expect(goalsOf(page, 'Alexiou')).toHaveText('14');
    await expect(goalsOf(page, 'Papadakis')).toHaveText('1');
    await expect(note(page)).toHaveText('Friendlies not counted (1)');
    await tab(page, 'team').click();
    await expect(page.getByTestId('season-team-game-row')).toHaveCount(4);
  });

  test('when the selected phase disappears the selection falls back to Season', async ({ page }) => {
    await openPlayers(page);
    await select(page).selectOption('phase:p2');
    await expect(goalsOf(page, 'Alexiou')).toHaveText('3');
    // Bravo, the only Play-offs game, moves to Regular season.
    await seedStats(games({ bravoPhase: 'p1' }));
    await expect(goalsOf(page, 'Alexiou')).toHaveText('14');
    await expect(select(page)).toHaveValue('season');
    await expect(select(page).locator('option')).toHaveText([
      'Season', 'League', 'League – Regular season', 'Spring Cup', 'Cup',
    ]);
    await tab(page, 'team').click();
    await expect(page.getByTestId('season-team-game-row')).toHaveCount(4);
  });

  test('a scope that is gone does not come back with a later snapshot', async ({ page }) => {
    await openPlayers(page);
    await select(page).selectOption('phase:p2');
    await expect(goalsOf(page, 'Alexiou')).toHaveText('3');
    // Only league games with no phase: Season is the one scope left and the selector goes.
    await seedStats(games().map(({
      phaseId, tournamentId, competitionName, competition, ...g
    }) => g));
    await expect(select(page)).toBeHidden();
    await expect(goalsOf(page, 'Alexiou')).toHaveText('20');
    // The old scopes return: the selection was Season's since the selector went.
    await seedStats(games());
    await expect(select(page)).toBeVisible();
    await expect(select(page)).toHaveValue('season');
    await expect(goalsOf(page, 'Alexiou')).toHaveText('14');
    await tab(page, 'team').click();
    await expect(page.getByTestId('season-team-game-row')).toHaveCount(4);
  });

  test('a scope renamed in the team document updates the selector and keeps the selection', async ({ page }) => {
    await openPlayers(page);
    await select(page).selectOption('phase:p2');
    await expect(goalsOf(page, 'Alexiou')).toHaveText('3');
    await update('team/main', { 'phases.p2.name': 'Finals' });
    await expect(select(page).locator('option').nth(3)).toHaveText('League – Finals');
    await expect(select(page)).toHaveValue('phase:p2');
    await expect(goalsOf(page, 'Alexiou')).toHaveText('3');
  });

  test('a snapshot that changes a figure keeps focus on the select', async ({ page }) => {
    await openPlayers(page);
    await select(page).focus();
    await select(page).selectOption('phase:p2');
    await expect(goalsOf(page, 'Alexiou')).toHaveText('3');
    await expect(select(page)).toBeFocused();
    await seedStats(games({ bravo: 7 }));
    await expect(goalsOf(page, 'Alexiou')).toHaveText('7');
    await expect(select(page)).toBeFocused();
    await expect(select(page)).toHaveValue('phase:p2');
  });
});

test.describe('the selector stays hidden', () => {
  test('when every counted game is a league game with no phase', async ({ page }) => {
    await seedTeam();
    await seedStats([game('a1', 'Alpha FC', '2026-10-03', 2, 1), game('a2', 'Bravo FC', '2026-10-10', 3, 0)]);
    await openPlayers(page);
    await expect(goalsOf(page, 'Alexiou')).toHaveText('5');
    await expect(select(page)).toBeHidden();
    await tab(page, 'team').click();
    await expect(page.getByTestId('season-team-game-row')).toHaveCount(2);
    await expect(select(page)).toBeHidden();
  });

  test('when a counted row has no player lines, and Players shows the stored totals', async ({ page }) => {
    await seedTeam();
    const stats = aggregateSeason(games(), roster);
    // An older recount: one row has no lines. The stored totals say 14 goals, and nothing else is known.
    delete stats.results.find(result => result.gameId === 'a2').players;
    await seed(`stats/${SEASON}`, stats);
    await openPlayers(page);
    await expect(goalsOf(page, 'Alexiou')).toHaveText('14');
    await expect(select(page)).toBeHidden();
    await tab(page, 'team').click();
    await expect(page.getByTestId('season-team-game-row')).toHaveCount(4);
    await expect(select(page)).toBeHidden();
  });

  test('labels fall back to the generic phase label before the lists exist, and follow them when they arrive', async ({ page }) => {
    await seedStats(games());
    // A team doc with no lists: phases have the generic label, tournaments their snapshot name.
    await seed('team/main', { roster });
    await openPlayers(page);
    await expect(select(page)).toBeVisible();
    await expect(select(page).locator('option')).toHaveText([
      'Season', 'League', 'League – Phase', 'League – Phase', 'Spring Cup', 'Cup',
    ]);
    await update('team/main', { phases: lists.phases, tournaments: lists.tournaments });
    await expect(select(page).locator('option').nth(2)).toHaveText('League – Regular season');
  });
});

test.describe('tags', () => {
  test('result rows show the phase and the current tournament name, legacy rows their snapshot', async ({ page }) => {
    await seedTeam();
    const legacy = game('a6', 'Legacy FC', '2026-11-07', 1, 0, { competition: 'tournament', competitionName: 'Old Snapshot' });
    await seedStats([...games(), legacy]);
    await open(page);
    await expect(page.getByTestId('result-row')).toHaveCount(6);
    await expect(row(page, 'Bravo FC').getByTestId('result-competition')).toHaveText('Play-offs');
    await expect(row(page, 'Alpha FC').getByTestId('result-competition')).toHaveText('Regular season');
    await expect(row(page, 'Charlie FC').getByTestId('result-competition')).toHaveText('Spring Cup');
    await expect(row(page, 'Legacy FC').getByTestId('result-competition')).toHaveText('Old Snapshot');
    await expect(row(page, 'Bravo FC').getByTestId('result-link')).toHaveAttribute('aria-label', /Play-offs$/);
    // A team-only rename reaches the open Results tab.
    await update('team/main', { 'tournaments.t1.name': 'Summer Cup', 'phases.p2.name': 'Finals' });
    await expect(row(page, 'Charlie FC').getByTestId('result-competition')).toHaveText('Summer Cup');
    await expect(row(page, 'Bravo FC').getByTestId('result-competition')).toHaveText('Finals');
    await expect(row(page, 'Legacy FC').getByTestId('result-competition')).toHaveText('Old Snapshot');
  });

  test('the game board shows the phase name and follows a rename', async ({ page }) => {
    await seedTeam();
    const { id, ...doc } = game('g1', 'Bravo FC', '2026-10-10', 3, 0, { phaseId: 'p2' });
    await seed(`games/${id}`, doc);
    await open(page, '#/game/g1');
    await expect(page.getByTestId('final-badge')).toBeVisible();
    await expect(page.getByTestId('game-competition')).toHaveText('Play-offs');
    await update('team/main', { 'phases.p2.name': 'Finals' });
    await expect(page.getByTestId('game-competition')).toHaveText('Finals');
  });
});

test.describe('a tournament without a list name', () => {
  test('is labelled by its newest game only, and by the generic word when that has no name', async ({ page }) => {
    await seedTeam({ phases: lists.phases });
    const older = game('t1a', 'Old FC', '2026-10-03', 1, 0, { competition: 'tournament', tournamentId: 't1', competitionName: 'Old Name' });
    const newer = game('t1b', 'New FC', '2026-10-10', 2, 0, { competition: 'tournament', tournamentId: 't1' });
    await seedStats([older, newer, game('l1', 'Lg FC', '2026-10-17', 3, 0)]);
    await openPlayers(page);
    await expect(select(page).locator('option')).toHaveText(['Season', 'League', 'Tournament']);
    // With a name on the newest game, that name speaks for it.
    await seedStats([older, { ...newer, competitionName: 'New Name' }, game('l1', 'Lg FC', '2026-10-17', 3, 0)]);
    await expect(select(page).locator('option')).toHaveText(['Season', 'League', 'New Name']);
  });
});

test.describe('long Greek names at 360 px', () => {
  for (const scheme of ['light', 'dark']) {
    test(`the select and the tags fit, ${scheme}`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await page.emulateMedia({ colorScheme: scheme });
      await seedTeam({
        tournaments: { t1: { name: LONG_NAME } },
        phases: { p1: { name: 'Regular season' }, p2: { name: LONG_NAME } },
      });
      await seedStats(games());
      await open(page);
      await expect(page.getByTestId('result-row')).toHaveCount(5);
      await expectTagFits(row(page, 'Charlie FC').getByTestId('result-competition'), row(page, 'Charlie FC'));
      await expectTagFits(row(page, 'Bravo FC').getByTestId('result-competition'), row(page, 'Bravo FC'));
      const resultWidths = await noSideScroll(page);
      expect(resultWidths.scroll).toBeLessThanOrEqual(resultWidths.client);

      await tab(page, 'players').click();
      await expect(select(page)).toBeVisible();
      await expect(select(page).locator('option')).toHaveText([
        'Season', 'League', 'League – Regular season', `League – ${LONG_NAME}`, LONG_NAME, 'Cup',
      ]);
      for (const value of ['phase:p2', 'tournament:t1']) {
        await select(page).selectOption(value);
        await expect(select(page)).toHaveValue(value);
        await expect(goalsOf(page, 'Alexiou')).toHaveText(value === 'phase:p2' ? '3' : '4');
        const box = await select(page).boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(360);
        const widths = await noSideScroll(page);
        expect(widths.scroll).toBeLessThanOrEqual(widths.client);
      }
      await tab(page, 'team').click();
      await expect(page.getByTestId('season-team-game-row')).toHaveCount(1);
      const teamBox = await select(page).boundingBox();
      expect(teamBox.x + teamBox.width).toBeLessThanOrEqual(360);
      const teamWidths = await noSideScroll(page);
      expect(teamWidths.scroll).toBeLessThanOrEqual(teamWidths.client);
    });
  }
});

test.describe('a phone with the previous release in its cache', () => {
  test.use({ serviceWorkers: 'block' });
  const previous = file => execFileSync('git', ['show', `main:${file}`], { encoding: 'utf8' });

  test('strings.js without showingLabel: no selector, the stored totals and the friendlies note as before', async ({ page }) => {
    const body = previous('js/strings.js');
    let served = 0;
    await page.route('**/js/strings.js', route => {
      served++;
      return route.fulfill({ contentType: 'text/javascript', body });
    });
    await seedTeam();
    await seedStats(games());
    await openPlayers(page);
    expect(served, 'the previous strings.js was served').toBeGreaterThan(0);
    await expect(goalsOf(page, 'Alexiou')).toHaveText('14');
    await expect(page.getByTestId('panel-players').getByTestId('friendlies-note')).toHaveText('Friendlies not counted (1)');
    await expect(select(page)).toBeHidden();
  });

  test('model.js without the scope functions: no selector and the stored totals', async ({ page }) => {
    const body = previous('js/model.js');
    let served = 0;
    await page.route('**/js/model.js', route => {
      served++;
      return route.fulfill({ contentType: 'text/javascript', body });
    });
    await seedTeam();
    await seedStats(games());
    await openPlayers(page);
    expect(served, 'the previous model.js was served').toBeGreaterThan(0);
    await expect(goalsOf(page, 'Alexiou')).toHaveText('14');
    await expect(select(page)).toBeHidden();
  });
});
