import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../../js/model.js';

test('competition constants expose the form options in order and the name limit', () => {
  assert.deepEqual(model.COMPETITIONS, ['league', 'cup', 'tournament', 'friendly']);
  assert.equal(Object.isFrozen(model.COMPETITIONS), true);
  assert.equal(model.MAX_COMPETITION_NAME, 40);
});

test('competitionOf normalizes stored competition fields', () => {
  for (const source of [{}, null, undefined, { competition: 'bogus' }]) {
    assert.deepEqual(model.competitionOf(source), { competition: 'league' });
  }
  assert.deepEqual(model.competitionOf({ competition: 'friendly', competitionName: 'x' }),
    { competition: 'friendly' });
  assert.deepEqual(model.competitionOf({ competition: 'tournament', competitionName: '  Summer Cup ' }),
    { competition: 'tournament', competitionName: 'Summer Cup' });
  for (const competitionName of ['  ', 42]) {
    assert.deepEqual(model.competitionOf({ competition: 'tournament', competitionName }),
      { competition: 'tournament' });
  }
});

test('competitionOf enforces the tournament name limit after trimming', () => {
  const maxName = 'x'.repeat(40);
  assert.deepEqual(model.competitionOf({ competition: 'tournament', competitionName: ` ${maxName} ` }),
    { competition: 'tournament', competitionName: maxName });
  assert.deepEqual(model.competitionOf({ competition: 'tournament', competitionName: ` ${maxName}x ` }),
    { competition: 'tournament' });
});

test('isFriendly identifies only friendly games', () => {
  assert.equal(model.isFriendly({ competition: 'friendly' }), true);
  for (const competition of ['league', 'cup', 'tournament', 'bogus', 'Friendly']) {
    assert.equal(model.isFriendly({ competition }), false);
  }
  assert.equal(model.isFriendly({}), false);
  assert.equal(model.isFriendly(null), false);
});

test('competitionFields validates the competition and trimmed tournament name', () => {
  assert.equal(model.competitionFields('tournament', '  '), null);
  assert.equal(model.competitionFields('tournament', 'x'.repeat(41)), null);
  assert.deepEqual(model.competitionFields('tournament', ' Summer Cup '),
    { competition: 'tournament', competitionName: 'Summer Cup' });
  const maxName = 'x'.repeat(40);
  assert.deepEqual(model.competitionFields('tournament', ` ${maxName} `),
    { competition: 'tournament', competitionName: maxName });
  assert.deepEqual(model.competitionFields('cup', 'ignored'), { competition: 'cup' });
  assert.equal(model.competitionFields('bogus', ''), null);
});

const roster = [
  { id: 'p5', name: 'Scorer', cap: 5, archived: false },
  { id: 'g1', name: 'Keeper', cap: 1, archived: false, goalie: true },
];
const lineup = [
  { playerId: 'p5', name: 'Scorer', cap: 5 },
  { playerId: 'g1', name: 'Keeper', cap: 1, goalie: true },
];
const ev = (type, ts, playerId = null) => model.makeEvent(type, 1, playerId, ts, `e${ts}`);
const leagueFinal = {
  id: 'league', date: '2026-11-08', opponent: 'Rivals', season: '2026-27',
  status: 'final', period: 4, competition: 'league', situations: true, lineup,
  events: [ev('manUp', 1), ev('goal', 2, 'p5'), ev('goal', 3, 'p5'), ev('save', 4, 'g1')],
};
const friendlyFinal = {
  ...leagueFinal, id: 'friendly', date: '2026-11-09', competition: 'friendly',
  events: [...leagueFinal.events, ev('goal', 5, 'p5'), ev('save', 6, 'g1'), ev('excl', 7, 'p5'), ev('manDownEnd', 8)],
};

test('gameResult adds competition fields for non-league games', () => {
  const friendly = model.gameResult({ ...friendlyFinal, competitionName: 'ignored' });
  assert.equal(friendly.competition, 'friendly');
  assert.equal('competitionName' in friendly, false);
  const tournament = model.gameResult({
    ...leagueFinal, competition: 'tournament', competitionName: '  Summer Cup ',
  });
  assert.equal(tournament.competition, 'tournament');
  assert.equal(tournament.competitionName, 'Summer Cup');
  const unnamedTournament = model.gameResult({ ...leagueFinal, competition: 'tournament' });
  assert.equal(unnamedTournament.competition, 'tournament');
  assert.equal('competitionName' in unnamedTournament, false);
  for (const result of [
    model.gameResult(leagueFinal),
    model.gameResult({ ...leagueFinal, competition: 'bogus' }),
    model.gameResult({ id: 'legacy', date: leagueFinal.date, opponent: leagueFinal.opponent, period: 4, events: [] }),
  ]) {
    assert.equal('competition' in result, false);
    assert.equal('competitionName' in result, false);
  }
});

test('gameResult preserves tournament metadata within the trimmed name limit', () => {
  const maxName = 'x'.repeat(40);
  const game = { ...leagueFinal, competition: 'tournament' };
  const named = model.gameResult({ ...game, competitionName: ` ${maxName} ` });
  assert.equal(named.competition, 'tournament');
  assert.equal(named.competitionName, maxName);
  const unnamed = model.gameResult({ ...game, competitionName: ` ${maxName}x ` });
  assert.equal(unnamed.competition, 'tournament');
  assert.equal('competitionName' in unnamed, false);
});

test('aggregateSeason keeps friendly results while excluding their players, goalies and situations', () => {
  const season = model.aggregateSeason([leagueFinal, friendlyFinal], roster);
  assert.deepEqual(season.players.p5, { name: 'Scorer', games: 1, goals: 2, excl: 0, pens: 0 });
  assert.deepEqual(season.goalies.g1, { name: 'Keeper', games: 1, saves: 1, penSaves: 0, goalsAgainst: 0 });
  assert.deepEqual(season.situations, { manUp: { played: 1, scored: 1 }, manDown: { played: 0, stopped: 0 } });
  assert.deepEqual(season.results.map(({ gameId, competition, us }) => ({ gameId, competition, us })), [
    { gameId: 'friendly', competition: 'friendly', us: 3 },
    { gameId: 'league', competition: undefined, us: 2 },
  ]);
});

test('aggregateSeason retains results for a season with only friendlies', () => {
  const season = model.aggregateSeason([friendlyFinal], roster);
  assert.deepEqual(season.players, {});
  assert.deepEqual(season.goalies, {});
  assert.equal(season.situations, null);
  assert.equal(season.results.length, 1);
  assert.equal(season.results[0].competition, 'friendly');
});
