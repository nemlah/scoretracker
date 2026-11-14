import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEvent } from '../../js/model.js';
import { createGoalWatcher } from '../../js/goalWatch.js';

const ev = (type, period, playerId, ts, id = `e${ts}`) => makeEvent(type, period, playerId, ts, id);
const goal = ts => ev('goal', 1, 'a', ts);
const live = events => ({ id: 'g1', status: 'live', events });
const server = { fromCache: false };
const cache = { fromCache: true };

test('the first snapshot never celebrates', () => {
  for (const meta of [undefined, cache, server]) {
    assert.equal(createGoalWatcher().next(live([goal(1)]), meta), null);
  }
});
test('a new goal on a confirmed live game celebrates', () => {
  const watcher = createGoalWatcher();
  watcher.next(live([]), server);
  const event = goal(1);
  assert.equal(watcher.next(live([event]), server), event);
});
test("a reload's cache-then-server snapshots don't celebrate", () => {
  const watcher = createGoalWatcher();
  watcher.next(live([goal(1)]), cache);
  assert.equal(watcher.next(live([goal(1), goal(2)]), server), null);
  const event = goal(3);
  assert.equal(watcher.next(live([goal(1), goal(2), event]), server), event);
});
test('after a reconnect the newest new goal celebrates once', () => {
  const watcher = createGoalWatcher();
  watcher.next(live([goal(1)]), server);
  assert.equal(watcher.next(live([goal(1)]), cache), null);
  const event = goal(6);
  const game = live([goal(1), goal(5), event]);
  assert.equal(watcher.next(game, server), event);
  assert.equal(watcher.next(game, server), null);
});
test('no celebration on a final game, a game switch, or null', () => {
  const watcher = createGoalWatcher();
  watcher.next(live([]), server);
  assert.equal(watcher.next({ ...live([goal(1)]), status: 'final' }, server), null);
  assert.equal(watcher.next(live([goal(1)]), server), null);
  assert.equal(watcher.next({ ...live([goal(2)]), id: 'g2' }, server), null);
  assert.equal(watcher.next(null), null);
  assert.equal(watcher.next(live([goal(3)]), server), null);
});
test('missing metadata stays unconfirmed until a server snapshot has been seen', () => {
  const watcher = createGoalWatcher();
  watcher.next(live([]));
  assert.equal(watcher.next(live([goal(1)])), null);
  assert.equal(watcher.next(live([goal(1), goal(2)]), server), null);
  const event = goal(3);
  assert.equal(watcher.next(live([goal(1), goal(2), event])), event);
});
