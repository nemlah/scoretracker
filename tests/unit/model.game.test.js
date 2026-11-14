import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../../js/model.js';
const ev = (type, period, playerId, ts, id = `e${ts}`) => m.makeEvent(type, period, playerId, ts, id);

test('makeEvent omits playerId when null', () => {
  const e = m.makeEvent('oppGoal', 2, null, 1000, 'x');
  assert.deepEqual(e, { id: 'x', type: 'oppGoal', period: 2, ts: 1000 });
  assert.equal('playerId' in e, false);
  assert.deepEqual(m.makeEvent('goal', 1, 'p1', 5, 'y'), { id: 'y', type: 'goal', period: 1, ts: 5, playerId: 'p1' });
  assert.match(m.makeEvent('goal', 1, 'p1').id, /^[0-9a-f-]{36}$/);
});
test('withPlayer reassigns or clears the scorer, keeps id/ts', () => {
  const e = ev('goal', 1, null, 10, 'g');
  assert.deepEqual(m.withPlayer(e, 'p2'), { id: 'g', type: 'goal', period: 1, ts: 10, playerId: 'p2' });
  assert.equal('playerId' in m.withPlayer(m.withPlayer(e, 'p2'), null), false);
});
test('nextPeriod / prevPeriod', () => {
  assert.equal(m.nextPeriod(1), 2); assert.equal(m.nextPeriod(4), 'SO'); assert.equal(m.nextPeriod('SO'), null);
  assert.equal(m.prevPeriod('SO'), 4); assert.equal(m.prevPeriod(1), null);
});
test('deriveScore splits shootout and ignores exclusions', () => {
  const events = [ev('goal',1,'p1',1), ev('oppGoal',1,null,2), ev('excl',2,'p2',3), ev('goal',4,null,4),
                  ev('goal','SO','p1',5), ev('oppGoal','SO',null,6), ev('oppGoal','SO',null,7)];
  assert.deepEqual(m.deriveScore(events), { us: 2, them: 1, soUs: 1, soThem: 2 });
  assert.deepEqual(m.deriveScore([]), { us: 0, them: 0, soUs: 0, soThem: 0 });
});
test('hasShootout', () => {
  assert.equal(m.hasShootout('SO', []), true);
  assert.equal(m.hasShootout(4, [ev('goal','SO','a',1)]), true);
  assert.equal(m.hasShootout(4, [ev('goal',4,'a',1)]), false);
});
test('playerLines: per-player counts, sorted by cap, OUT at 3 exclusions', () => {
  const lineup = [{ playerId:'a', name:'Alexiou', cap:5 }, { playerId:'b', name:'Papadakis', cap:2 }];
  const events = [ev('goal',1,'a',1), ev('goal','SO','a',2), ev('excl',1,'b',3), ev('excl',2,'b',4), ev('excl',3,'b',5), ev('goal',2,null,6)];
  assert.deepEqual(m.playerLines(lineup, events), [
    { playerId:'b', name:'Papadakis', cap:2, goals:0, soGoals:0, excl:3, pens:0, out:true },
    { playerId:'a', name:'Alexiou',   cap:5, goals:1, soGoals:1, excl:0, pens:0, out:false },
  ]);
});
test('scoringLines keeps only players with a goal, shootout goal or exclusion, in order', () => {
  const line = (playerId, goals, soGoals, excl) => ({ playerId, name: playerId, cap: 1, goals, soGoals, excl, pens: 0, out: excl >= 3 });
  const lines = [line('a', 0, 0, 0), line('b', 1, 0, 0), line('c', 0, 0, 1), line('d', 0, 0, 0), line('e', 0, 2, 0), line('f', 0, 0, 3)];
  assert.deepEqual(m.scoringLines(lines).map(l => l.playerId), ['b', 'c', 'e', 'f']);
  assert.equal(m.scoringLines(lines)[3], lines[5]);
  assert.deepEqual(m.scoringLines([line('a', 0, 0, 0)]), []);
  assert.deepEqual(m.scoringLines([]), []);
});
test('lastEvent: highest ts, ties to later index', () => {
  assert.equal(m.lastEvent([]), null);
  assert.equal(m.lastEvent([ev('goal',1,'a',5,'x'), ev('goal',1,'a',3,'y')]).id, 'x');
  assert.equal(m.lastEvent([ev('goal',1,'a',5,'x'), ev('goal',1,'a',5,'y')]).id, 'y');
});
test('timeline: newest period first, newest event first', () => {
  const t = m.timeline([ev('goal',1,'a',1,'1'), ev('oppGoal',2,null,3,'3'), ev('goal',1,'a',2,'2')]);
  assert.deepEqual(t.map(g => [g.period, g.events.map(e => e.id)]), [[2, ['3']], [1, ['2', '1']]]);
});
test('isDuplicateTap: same type + player within the window', () => {
  const prev = ev('goal', 1, 'a', 1000);
  assert.equal(m.isDuplicateTap(prev, 'goal', 'a', 1999), true);
  assert.equal(m.isDuplicateTap(prev, 'goal', 'a', 2000), false);
  assert.equal(m.isDuplicateTap(prev, 'excl', 'a', 1500), false);
  assert.equal(m.isDuplicateTap(prev, 'goal', 'b', 1500), false);
  assert.equal(m.isDuplicateTap(null, 'goal', 'a', 1500), false);
  assert.equal(m.isDuplicateTap(ev('oppGoal', 1, null, 1000), 'oppGoal', null, 1500), true);
});
test('playerHasEvents', () => {
  assert.equal(m.playerHasEvents([ev('excl',1,'a',1)], 'a'), true);
  assert.equal(m.playerHasEvents([ev('goal',1,null,1)], 'a'), false);
});

test('EVENT_TYPES contains all seven event types and is frozen', () => {
  assert.deepEqual(m.EVENT_TYPES, ['goal', 'excl', 'oppGoal', 'pen', 'manUp', 'manUpEnd', 'manDownEnd']);
  assert.equal(Object.isFrozen(m.EVENT_TYPES), true);
});
test('playerLines counts penalty fouls toward OUT', () => {
  const lineup = [{ playerId: 'p1', name: 'Alexiou', cap: 5 }];
  const events = [ev('excl', 1, 'p1', 1), ev('excl', 2, 'p1', 2), ev('pen', 3, 'p1', 3)];
  assert.deepEqual(m.playerLines(lineup, events), [
    { ...lineup[0], goals: 0, soGoals: 0, excl: 2, pens: 1, out: true },
  ]);
  assert.equal(m.playerLines(lineup, events.slice(0, 2))[0].out, false);
  assert.equal(m.playerLines(lineup, [...events, ev('pen', 4, 'p1', 4)])[0].out, true);
});
test('scoringLines keeps a player with only a penalty foul', () => {
  const lineup = [{ playerId: 'p1', name: 'Alexiou', cap: 5 }];
  const lines = m.playerLines(lineup, [ev('pen', 1, 'p1', 1)]);
  assert.deepEqual(m.scoringLines(lines).map(line => line.playerId), ['p1']);
  assert.equal(m.scoringLines(lines)[0], lines[0]);
});
test('timeline leaves out man-up and man-down events', () => {
  const goal = ev('goal', 1, 'p1', 4);
  const pen = ev('pen', 1, 'p2', 5);
  const events = [ev('manUp', 1, null, 1), ev('manUpEnd', 1, null, 2), ev('manDownEnd', 2, null, 3), goal, pen];
  assert.deepEqual(m.timeline(events), [{ period: 1, events: [pen, goal] }]);
});

test('foulOutIds marks the foul that reaches 3', () => {
  const events = [ev('excl',1,'a',1), ev('excl',1,'a',2), ev('excl',1,'b',3), ev('pen',1,'a',4), ev('excl',1,'a',5)];
  assert.deepEqual(m.foulOutIds(events), new Set(['e4']));
});
test('foulOutIds counts in ts order, not array order', () => {
  const events = Object.freeze([ev('excl',1,'a',30), ev('excl',1,'a',10), ev('excl',1,'a',20)]);
  assert.deepEqual(m.foulOutIds(events), new Set(['e30']));
});
test('foulOutIds ignores fouls without a player', () => {
  assert.deepEqual(m.foulOutIds([ev('excl',1,null,1), ev('pen',1,null,2), ev('excl',1,null,3)]), new Set());
});
test('foulOutIds keeps array order for timestamp ties and counts each player separately', () => {
  assert.deepEqual(m.foulOutIds([
    ev('excl',1,'a',1,'a1'), ev('pen',1,'a',1,'a2'), ev('excl',1,'a',1,'a3'),
    ev('pen',1,'b',1,'b1'), ev('goal',1,'b',1,'g'), ev('excl',1,'b',1,'b2'), ev('pen',1,'b',1,'b3'),
  ]), new Set(['a3', 'b3']));
});
test('latestNewGoal returns the newest new goal of ours', () => {
  const first = ev('goal',1,'a',1);
  const newest = ev('goal',1,'a',4);
  assert.equal(m.latestNewGoal([first], [first, ev('oppGoal',1,null,2), newest, ev('goal',1,'a',3)]), newest);
  assert.equal(m.latestNewGoal([first], [first, ev('oppGoal',1,null,2)]), null);
  assert.equal(m.latestNewGoal([first], []), null);
  assert.equal(m.latestNewGoal([first], [m.withPlayer(first, 'b')]), null);
  assert.equal(m.latestNewGoal([], []), null);
});
test('latestNewGoal breaks timestamp ties with the later index, including shootout', () => {
  const later = ev('goal','SO',null,1,'later');
  assert.equal(m.latestNewGoal([], [ev('goal',1,'a',1,'first'), later]), later);
});
