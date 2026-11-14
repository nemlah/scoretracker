import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEvent } from '../../js/model.js';
import * as s from '../../js/situations.js';

const ev = (type, period, playerId, ts, id = `e${ts}`) => makeEvent(type, period, playerId, ts, id);
const g = (events, extra = {}) => ({ situations: true, status: 'live', period: 4, events, ...extra });
const outcomes = game => s.replaySituations(game).closed.map(s => [s.kind, s.outcome, s.closedBy]);
const counts = (upPlayed = 0, scored = 0, downPlayed = 0, stopped = 0) => ({
  manUp: { played: upPlayed, scored }, manDown: { played: downPlayed, stopped },
});

test('situation constants and strict tracking marker', () => {
  assert.deepEqual(s.SITUATION_TYPES, ['manUp', 'manUpEnd', 'manDownEnd']);
  assert.equal(Object.isFrozen(s.SITUATION_TYPES), true);
  assert.equal(s.SITUATION_REMIND_MS, 40000);
  assert.equal(s.isTracked({ situations: true }), true);
  for (const game of [null, undefined, {}, { situations: false }, { situations: 1 }]) {
    assert.equal(s.isTracked(game), false);
  }
});

test('untracked game has no situations', () => {
  const game = { status: 'live', period: 4, events: [ev('excl', 4, 'p1', 1)] };
  assert.deepEqual(s.replaySituations(game), { closed: [], open: null });
  assert.equal(s.situationCounts(game), null);
  assert.deepEqual(s.manUpGoalIds(game), new Set());
});

test('man-up: our goal scores it', () => {
  for (const playerId of ['p1', null]) {
    const game = g([ev('manUp', 4, null, 1), ev('goal', 4, playerId, 2)]);
    assert.deepEqual(outcomes(game), [['manUp', 'scored', 'e2']]);
    assert.deepEqual(s.replaySituations(game), {
      closed: [{ kind: 'manUp', startId: 'e1', startTs: 1, period: 4, outcome: 'scored', closedBy: 'e2' }],
      open: null,
    });
    assert.deepEqual(s.situationCounts(game), counts(1, 1));
  }
});

test('man-up: end tap or opponent goal misses it', () => {
  for (const type of ['manUpEnd', 'oppGoal']) {
    const game = g([ev('manUp', 4, null, 1), ev(type, 4, null, 2)]);
    assert.deepEqual(outcomes(game), [['manUp', 'missed', 'e2']]);
    assert.equal(s.replaySituations(game).open, null);
    assert.deepEqual(s.situationCounts(game), counts(1));
  }
});

test('our exclusion during a man-up misses it and opens a man-down', () => {
  const game = g([ev('manUp', 4, null, 1), ev('excl', 4, 'p1', 2)]);
  assert.deepEqual(outcomes(game), [['manUp', 'missed', 'e2']]);
  assert.deepEqual(s.replaySituations(game).open, { kind: 'manDown', startId: 'e2', startTs: 2, period: 4 });
  assert.deepEqual(s.situationCounts(game), counts(1));
});

test('man-down: opponent goal concedes; our goal or the end tap stops it', () => {
  for (const [type, outcome] of [['oppGoal', 'conceded'], ['goal', 'stopped'], ['manDownEnd', 'stopped']]) {
    const game = g([ev('excl', 4, 'p1', 1), ev(type, 4, null, 2)]);
    assert.deepEqual(outcomes(game), [['manDown', outcome, 'e2']]);
    assert.equal(s.replaySituations(game).open, null);
    assert.deepEqual(s.situationCounts(game), counts(0, 0, 1, outcome === 'stopped' ? 1 : 0));
  }
});

test('a second exclusion keeps the same man-down', () => {
  const events = [ev('excl', 4, 'p1', 1), ev('excl', 4, 'p2', 2)];
  assert.deepEqual(s.replaySituations(g(events)).open, { kind: 'manDown', startId: 'e1', startTs: 1, period: 4 });
  assert.deepEqual(outcomes(g([...events, ev('oppGoal', 4, null, 3)])), [['manDown', 'conceded', 'e3']]);
});

test('man-up tap during a man-down stops it and opens a man-up', () => {
  const game = g([ev('excl', 4, 'p1', 1), ev('manUp', 4, null, 2)]);
  assert.deepEqual(outcomes(game), [['manDown', 'stopped', 'e2']]);
  assert.deepEqual(s.replaySituations(game).open, { kind: 'manUp', startId: 'e2', startTs: 2, period: 4 });
  assert.deepEqual(s.situationCounts(game), counts(0, 0, 1, 1));
});

test('penalty foul changes nothing', () => {
  const game = g([ev('manUp', 4, null, 1), ev('pen', 4, 'p1', 2), ev('goal', 4, 'p2', 3)]);
  assert.deepEqual(outcomes(game), [['manUp', 'scored', 'e3']]);
  assert.deepEqual(s.replaySituations(g([ev('pen', 4, 'p1', 1)])), { closed: [], open: null });
  const down = g([ev('excl', 4, 'p1', 1), ev('pen', 4, 'p2', 2)]);
  assert.deepEqual(s.replaySituations(down).open, { kind: 'manDown', startId: 'e1', startTs: 1, period: 4 });
});

test('repeated man-up starts and mismatched ends leave the situation open', () => {
  for (const [start, ignored, kind] of [
    ['manUp', 'manUp', 'manUp'], ['manUp', 'manDownEnd', 'manUp'], ['excl', 'manUpEnd', 'manDown'],
  ]) {
    const game = g([ev(start, 4, null, 1), ev(ignored, 4, null, 2)]);
    assert.deepEqual(s.replaySituations(game), {
      closed: [], open: { kind, startId: 'e1', startTs: 1, period: 4 },
    });
  }
});

test('period change closes: next event in another period', () => {
  const game = g([ev('manUp', 1, null, 1), ev('goal', 2, 'p1', 2)]);
  assert.deepEqual(outcomes(game), [['manUp', 'missed', null]]);
  assert.equal(s.replaySituations(game).open, null);
  const down = g([ev('excl', 1, 'p1', 1), ev('manUp', 2, null, 2)], { period: 2 });
  assert.deepEqual(outcomes(down), [['manDown', 'stopped', null]]);
  assert.deepEqual(s.replaySituations(down).open, { kind: 'manUp', startId: 'e2', startTs: 2, period: 2 });
});

test('final game closes an open situation; reopened live game shows it open again', () => {
  for (const [type, kind, outcome] of [['manUp', 'manUp', 'missed'], ['excl', 'manDown', 'stopped']]) {
    const events = [ev(type, 4, null, 1)];
    assert.deepEqual(outcomes(g(events, { status: 'final' })), [[kind, outcome, null]]);
    assert.equal(s.replaySituations(g(events)).open.kind, kind);
    assert.deepEqual(outcomes(g(events, { period: 'SO' })), [[kind, outcome, null]]);
    assert.equal(s.replaySituations(g(events, { period: 'SO' })).open, null);
    assert.deepEqual(outcomes(g(events, { period: 3 })), [[kind, outcome, null]]);
  }
});

test('orphan ends are ignored', () => {
  assert.deepEqual(s.replaySituations(g([ev('manUpEnd', 4, null, 1), ev('manDownEnd', 4, null, 2)])), {
    closed: [], open: null,
  });
});

test('shootout events take no part', () => {
  const events = ['excl', 'manUp', 'goal', 'oppGoal', 'pen', 'manUpEnd', 'manDownEnd']
    .map((type, index) => ev(type, 'SO', null, index));
  assert.deepEqual(s.replaySituations(g(events)), { closed: [], open: null });
  assert.deepEqual(s.situationCounts(g(events)), counts());
  const game = g([ev('manUp', 4, null, 1), ev('oppGoal', 'SO', null, 2)], { period: 'SO' });
  assert.deepEqual(outcomes(game), [['manUp', 'missed', null]]);
});

test('ties in ts keep array order', () => {
  const start = ev('manUp', 4, null, 5, 'a');
  const goal = ev('goal', 4, null, 5, 'b');
  assert.deepEqual(outcomes(g([start, goal])), [['manUp', 'scored', 'b']]);
  assert.deepEqual(s.replaySituations(g([goal, start])), {
    closed: [], open: { kind: 'manUp', startId: 'a', startTs: 5, period: 4 },
  });
});

test('replay sorts by timestamp without changing the input', () => {
  const events = Object.freeze([
    Object.freeze(ev('goal', 4, 'p1', 2)), Object.freeze(ev('manUp', 4, null, 1)),
  ]);
  const game = Object.freeze(g(events));
  assert.deepEqual(outcomes(game), [['manUp', 'scored', 'e2']]);
  assert.deepEqual(events.map(event => event.id), ['e2', 'e1']);
});

test('counts count closed situations only', () => {
  assert.deepEqual(s.situationCounts(g([ev('manUp', 4, null, 1)])), counts());
  const game = g([ev('manUp', 4, null, 1), ev('goal', 4, null, 2), ev('excl', 4, 'p1', 3)]);
  assert.deepEqual(s.situationCounts(game), counts(1, 1));
});

test('manUpGoalIds lists only goals that scored a man-up', () => {
  const game = g([
    ev('goal', 4, 'p1', 1), ev('manUp', 4, null, 2), ev('goal', 4, null, 3),
    ev('excl', 4, 'p1', 4), ev('goal', 4, 'p1', 5), ev('manUp', 4, null, 6),
    ev('oppGoal', 4, null, 7), ev('goal', 'SO', 'p1', 8),
  ]);
  assert.deepEqual(s.manUpGoalIds(game), new Set(['e3']));
});

test('manUpSwitch on adds a man-up start just before the goal', () => {
  const game = g([ev('goal', 2, 'p1', 100)]);
  const change = s.manUpSwitch(game, 'e100', true, 'x');
  assert.deepEqual(change, { op: 'add', event: { id: 'x', type: 'manUp', period: 2, ts: 99 } });
  assert.deepEqual(s.situationCounts(g([...game.events, change.event])), counts(1, 1));
  assert.match(s.manUpSwitch(game, 'e100', true).event.id, /^[0-9a-f-]{36}$/);
});

test('manUpSwitch off removes a switch-made start', () => {
  const start = ev('manUp', 2, null, 99);
  const game = g([start, ev('goal', 2, 'p1', 100)]);
  const change = s.manUpSwitch(game, 'e100', false, 'x');
  assert.deepEqual(change, { op: 'remove', event: start });
  assert.equal(change.event, start);
});

test('manUpSwitch off on a live-tapped man-up adds an end', () => {
  const game = g([ev('manUp', 2, null, 50), ev('goal', 2, 'p1', 100)]);
  const change = s.manUpSwitch(game, 'e100', false, 'x');
  assert.deepEqual(change, { op: 'add', event: { id: 'x', type: 'manUpEnd', period: 2, ts: 99 } });
  assert.deepEqual(s.situationCounts(g([...game.events, change.event])), counts(1));
});

test('manUpSwitch on after an off removes the added end', () => {
  const end = ev('manUpEnd', 2, null, 99);
  const game = g([ev('manUp', 2, null, 50), end, ev('goal', 2, 'p1', 100)]);
  const change = s.manUpSwitch(game, 'e100', true, 'x');
  assert.deepEqual(change, { op: 'remove', event: end });
  assert.equal(change.event, end);
  assert.deepEqual(s.situationCounts(g(game.events.filter(event => event !== end))), counts(1, 1));
});

test('manUpSwitch returns null when nothing should change', () => {
  const goal = ev('goal', 2, 'p1', 100);
  assert.equal(s.manUpSwitch(g([goal], { situations: undefined }), goal.id, true, 'x'), null);
  assert.equal(s.manUpSwitch(g([ev('goal', 'SO', 'p1', 100)]), goal.id, true, 'x'), null);
  assert.equal(s.manUpSwitch(g([goal]), 'unknown', true, 'x'), null);
  assert.equal(s.manUpSwitch(g([ev('pen', 2, 'p1', 100)]), goal.id, true, 'x'), null);
  assert.equal(s.manUpSwitch(g([ev('manUp', 2, null, 50), goal]), goal.id, true, 'x'), null);
  assert.equal(s.manUpSwitch(g([goal]), goal.id, false, 'x'), null);
});

test('manUpSwitch on with only an orphan end adds a start', () => {
  const game = g([ev('manUpEnd', 2, null, 99), ev('goal', 2, 'p1', 100)]);
  const change = s.manUpSwitch(game, 'e100', true, 'x');
  assert.deepEqual(change, { op: 'add', event: { id: 'x', type: 'manUp', period: 2, ts: 99 } });
});
