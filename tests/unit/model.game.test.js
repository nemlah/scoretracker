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
    { playerId:'b', name:'Papadakis', cap:2, goals:0, soGoals:0, excl:3, out:true },
    { playerId:'a', name:'Alexiou',   cap:5, goals:1, soGoals:1, excl:0, out:false },
  ]);
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
