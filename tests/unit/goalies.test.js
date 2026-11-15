import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEvent } from '../../js/model.js';
import * as gk from '../../js/goalies.js';

const ev = (type, period, playerId, ts, id = `e${ts}`) => makeEvent(type, period, playerId, ts, id);
const lineup = [
  { playerId: 'g13', name: 'Nikolaou', cap: 13, goalie: true },
  { playerId: 'p5', name: 'Field', cap: 5 },
  { playerId: 'g1', name: 'Georgiou', cap: 1, goalie: true },
];
const g = (events, extra = {}) => ({ lineup, events, ...extra });
const line = (game, id) => gk.goalieStats(game).goalies.find(player => player.playerId === id);
const empty = player => ({ playerId: player.playerId, name: player.name, cap: player.cap,
  saves: 0, penSaves: 0, goalsAgainst: 0, soSaves: 0, soConceded: 0 });

test('no lineup goalie gives null', () => {
  const game = g([ev('oppGoal', 1, null, 1), ev('save', 1, 'p5', 2)], {
    lineup: lineup.map(({ goalie, ...player }) => player),
  });
  assert.equal(gk.goalieStats(game), null);
  assert.equal(gk.inGoalAt(game, 'e1'), null);
});

test('the lowest cap starts in goal and concedes', () => {
  assert.deepEqual(gk.goalieStats(g([])), {
    goalies: [empty(lineup[2]), empty(lineup[0])], inGoal: 'g1',
  });
  const game = g([ev('oppGoal', 1, null, 1)]);
  assert.equal(line(game, 'g1').goalsAgainst, 1);
  assert.equal(gk.goalieStats(game).inGoal, 'g1');
});

test('save and penSave put that goalie in goal', () => {
  for (const type of ['save', 'penSave']) {
    const game = g([ev(type, 1, 'g13', 1), ev('oppGoal', 1, null, 2)]);
    assert.deepEqual(line(game, 'g13'), { ...empty(lineup[0]),
      [type === 'save' ? 'saves' : 'penSaves']: 1, goalsAgainst: 1 });
    assert.equal(line(game, 'g1').goalsAgainst, 0);
    assert.equal(gk.goalieStats(game).inGoal, 'g13');
  }
});

test('gkIn switches without a save', () => {
  const game = g([ev('gkIn', 1, 'g13', 1), ev('oppGoal', 1, null, 2),
    ev('gkIn', 1, 'g1', 3), ev('oppGoal', 1, null, 4)]);
  assert.deepEqual(gk.goalieStats(game), {
    goalies: [ { ...empty(lineup[2]), goalsAgainst: 1 }, { ...empty(lineup[0]), goalsAgainst: 1 } ],
    inGoal: 'g1',
  });
});

test('removing a gkIn restores the previous goalie', () => {
  const events = [ev('gkIn', 1, 'g13', 1), ev('oppGoal', 1, null, 2)];
  assert.equal(line(g(events), 'g13').goalsAgainst, 1);
  const game = g(events.filter(event => event.type !== 'gkIn'));
  assert.equal(line(game, 'g1').goalsAgainst, 1);
  assert.equal(line(game, 'g13').goalsAgainst, 0);
});

test('shootout is kept apart', () => {
  const game = g([ev('penSave', 'SO', 'g1', 1), ev('oppGoal', 'SO', null, 2)]);
  assert.deepEqual(line(game, 'g1'), { ...empty(lineup[2]), soSaves: 1, soConceded: 1 });
  assert.equal(gk.savePct(line(game, 'g1')), null);
  const switched = g([ev('penSave', 'SO', 'g13', 1), ev('oppGoal', 'SO', null, 2)]);
  assert.equal(line(switched, 'g13').soConceded, 1);
  assert.equal(gk.goalieStats(switched).inGoal, 'g13');
});

test('savePct', () => {
  assert.equal(gk.savePct({ saves: 7, penSaves: 1, goalsAgainst: 5 }), 62);
  assert.equal(gk.savePct({ saves: 0, penSaves: 0, goalsAgainst: 0 }), null);
  assert.equal(gk.savePct({ saves: 0, penSaves: 0, goalsAgainst: 2 }), 0);
});

test('events for a player no longer marked goalie still count', () => {
  for (const type of ['save', 'penSave', 'gkIn']) {
    const game = g([ev(type, 1, 'p5', 1), ev('oppGoal', 1, null, 2)]);
    const stats = gk.goalieStats(game);
    assert.deepEqual(stats.goalies.map(player => player.playerId), ['g1', 'p5', 'g13']);
    assert.deepEqual(line(game, 'p5'), { ...empty(lineup[1]), goalsAgainst: 1,
      saves: type === 'save' ? 1 : 0, penSaves: type === 'penSave' ? 1 : 0 });
    assert.equal(stats.inGoal, 'p5');
  }
});

test('ts order with ties in array order', () => {
  const events = Object.freeze([
    ev('oppGoal', 1, null, 3), ev('oppGoal', 1, null, 2, 'before'),
    ev('save', 1, 'g13', 2, 'switch'), ev('oppGoal', 1, null, 2, 'after'),
    ev('goal', 1, 'g1', 1),
  ].map(Object.freeze));
  const game = Object.freeze(g(events, { lineup: Object.freeze(lineup.map(player => Object.freeze({ ...player }))) }));
  assert.equal(line(game, 'g1').goalsAgainst, 1);
  assert.equal(line(game, 'g13').goalsAgainst, 2);
  assert.deepEqual(events.map(event => event.id), ['e3', 'before', 'switch', 'after', 'e1']);
});

test('inGoalAt', () => {
  const game = g([ev('oppGoal', 1, null, 3), ev('oppGoal', 1, null, 1),
    ev('penSave', 1, 'g13', 2), ev('gkIn', 2, 'g1', 4)]);
  assert.equal(gk.inGoalAt(game, 'e1'), 'g1');
  assert.equal(gk.inGoalAt(game, 'e2'), 'g13');
  assert.equal(gk.inGoalAt(game, 'e3'), 'g13');
  assert.equal(gk.inGoalAt(game, 'e4'), 'g1');
  assert.equal(gk.inGoalAt(game, 'missing'), null);
});

test('inGoalSwitch adds a gkIn just before the goal', () => {
  const game = g([ev('oppGoal', 2, null, 100)]);
  const correction = gk.inGoalSwitch(game, 'e100', 'g13', 'x');
  assert.deepEqual(correction, {
    op: 'add', event: { id: 'x', type: 'gkIn', period: 2, ts: 99, playerId: 'g13' },
  });
  assert.equal(line(g([...game.events, correction.event]), 'g13').goalsAgainst, 1);
  assert.equal(game.events.length, 1);
});

test('inGoalSwitch removes its own correction when switching back', () => {
  const correction = ev('gkIn', 2, 'g13', 99);
  const game = g([correction, ev('oppGoal', 2, null, 100)]);
  assert.deepEqual(gk.inGoalSwitch(game, 'e100', 'g1'), { op: 'remove', event: correction });
});

test('inGoalSwitch replaces a correction for a third goalie', () => {
  const correction = Object.freeze(ev('gkIn', 2, 'g13', 99));
  const game = g([correction, ev('oppGoal', 2, null, 100)], {
    lineup: [...lineup, { playerId: 'g15', name: 'Third', cap: 15, goalie: true }],
  });
  assert.deepEqual(gk.inGoalSwitch(game, 'e100', 'g15'), {
    op: 'replace', event: correction, newEvent: { ...correction, playerId: 'g15' },
  });
});

test('inGoalSwitch returns null when nothing changes or the input is invalid', () => {
  const game = g([ev('oppGoal', 2, null, 100), ev('save', 2, 'g13', 101)]);
  for (const [eventId, goalieId] of [['e100', 'g1'], ['missing', 'g13'], ['e101', 'g1'],
    ['e100', 'p5'], ['e100', 'missing'], ['e100', null]]) {
    assert.equal(gk.inGoalSwitch(game, eventId, goalieId), null);
  }
  assert.equal(gk.inGoalSwitch(g(game.events, { lineup: [lineup[1]] }), 'e100', 'g13'), null);
});

test('corrections use the same period and the goalie immediately before the correction', () => {
  const otherPeriod = ev('gkIn', 1, 'g13', 99);
  const game = g([otherPeriod, ev('oppGoal', 2, null, 100)]);
  assert.deepEqual(gk.inGoalSwitch(game, 'e100', 'g1', 'x'), {
    op: 'add', event: ev('gkIn', 2, 'g1', 99, 'x'),
  });
  const correction = ev('gkIn', 2, 'g1', 99, 'correction');
  const previous = g([ev('save', 1, 'g13', 1), ev('oppGoal', 2, null, 100), correction]);
  assert.deepEqual(gk.inGoalSwitch(previous, 'e100', 'g13'), { op: 'remove', event: correction });
});
