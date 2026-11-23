import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../../js/model.js';

const league = { date: '2026-10-01' };
const phase1 = { date: '2026-11-01', competition: 'league', phaseId: 'p1' };
const phase2 = { date: '2026-12-01', competition: 'league', phaseId: 'p2' };
const tournament = { date: '2026-11-14', competition: 'tournament', tournamentId: 't1' };
const cup = { date: '2026-11-08', competition: 'cup' };
const friendly = { date: '2026-12-02', competition: 'friendly' };

test('seasonScopes orders league, phases, tournaments and cup after season', () => {
  const rows = [friendly, phase2, tournament, cup, phase1, league];
  assert.deepEqual(model.seasonScopes(rows),
    ['season', 'league', 'phase:p1', 'phase:p2', 'tournament:t1', 'cup']);
  assert.deepEqual(model.scopeRows(rows, 'league'), [phase2, phase1, league]);
  assert.deepEqual(model.scopeRows(rows, 'phase:p1'), [phase1]);
  assert.deepEqual(model.scopeRows(rows, 'cup'), [cup]);
  assert.deepEqual(model.scopeRows(rows, 'unknown'), []);
});

test('seasonScopes orders each phase and tournament by its earliest row', () => {
  const newerPhase1 = { ...phase1, date: '2026-12-20' };
  const newerTournament = { ...tournament, date: '2026-12-15' };
  const tournament2 = { ...tournament, date: '2026-11-15', tournamentId: 't2' };
  assert.deepEqual(model.seasonScopes(
    [newerPhase1, newerTournament, phase2, tournament2, tournament, phase1],
  ), ['season', 'league', 'phase:p1', 'phase:p2', 'tournament:t1', 'tournament:t2']);
});

test('seasonScopes omits scopes with the same rows as season', () => {
  assert.deepEqual(model.seasonScopes([league, { ...league, date: '2026-10-08' }]), ['season']);
  assert.deepEqual(model.seasonScopes([phase1, { ...phase1, date: '2026-11-02' }]), ['season']);
});

test('scopeRows keeps a legacy tournament row only in season', () => {
  const legacy = { date: '2026-11-10', competition: 'tournament', competitionName: 'Splash - Volos' };
  const linked = { ...tournament, competitionName: 'Splash - Volos' };
  const rows = [linked, legacy, friendly];
  assert.deepEqual(model.scopeRows(rows, 'tournament:t1'), [linked]);
  assert.deepEqual(model.scopeRows(rows, 'season'), [linked, legacy]);
});

test('countedRows excludes friendlies and handles absent results', () => {
  assert.deepEqual(model.countedRows([friendly, league, cup]), [league, cup]);
  for (const results of [null, undefined, {}, 'results']) {
    assert.deepEqual(model.countedRows(results), []);
  }
  assert.deepEqual(model.seasonScopes([friendly]), []);
});

test('hasLines requires a plain player map on each counted row', () => {
  const withLines = { ...league, players: {} };
  assert.equal(model.hasLines([withLines, cup]), false);
  assert.equal(model.hasLines([withLines, friendly]), true);
  for (const players of [null, [], new Map()]) {
    assert.equal(model.hasLines([withLines, { ...cup, players }]), false);
  }
});

test('sumLines counts each player only for rows that include them', () => {
  const rows = [
    { players: { a: { name: 'Alexiou', goals: 2, excl: 1, pens: 0 } }, goalies: {} },
    { ...friendly, players: {
      a: { name: 'Alex', goals: 1, excl: 0, pens: 1 },
      b: { name: 'Guest', goals: 0, excl: 0, pens: 0 },
    }, goalies: {} },
  ];
  assert.deepEqual(model.sumLines(rows), {
    players: {
      a: { name: 'Alexiou', games: 2, goals: 3, excl: 1, pens: 1 },
      b: { name: 'Guest', games: 1, goals: 0, excl: 0, pens: 0 },
    },
    goalies: {},
  });
});

test('listName trims names and rejects blanks and names over 40 characters', () => {
  assert.equal(model.listName(' ' + 'x'.repeat(40) + ' '), 'x'.repeat(40));
  assert.equal(model.listName(''), null);
  assert.equal(model.listName('x'.repeat(41)), null);
});

test('sameListName compares trimmed names with Greek-aware lowercasing', () => {
  assert.equal(model.sameListName('Splash - Volos', '  SPLASH - VOLOS '), true);
  assert.equal(model.sameListName("Α' ΦΆΣΗ", "α' φάση"), true);
  assert.equal(model.sameListName('Splash - Volos', 'Splash - Athens'), false);
});

test('listEntries skips invalid entries and sorts valid names', () => {
  assert.deepEqual(model.listEntries({ b: { name: 'Β' }, a: { name: 'Α' }, bad: {} }),
    [{ id: 'a', name: 'Α' }, { id: 'b', name: 'Β' }]);
});
