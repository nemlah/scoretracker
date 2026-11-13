import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTapper } from '../../js/tracker/taps.js';
import { makeEvent } from '../../js/model.js';

const lineup = [
  { playerId: 'p2', name: 'Papadakis', cap: 2 },
  { playerId: 'p5', name: 'Alexiou', cap: 5 },
];

// Fakes record every call, in order, in one shared log.
function setup({ game, active = true, now = () => 0 } = {}) {
  const calls = [];
  const errors = [];
  const vibrations = [];
  const state = {
    game: game === undefined ? { id: 'g1', status: 'live', period: 2, lineup, events: [] } : game,
    active,
    reject: null,
  };
  const write = name => (...args) => {
    calls.push([`repo.${name}`, ...args]);
    return state.reject ? Promise.reject(state.reject) : Promise.resolve();
  };
  const repo = { addEvent: write('addEvent'), removeEvent: write('removeEvent'), replaceEvent: write('replaceEvent') };
  const failedEntries = [];
  const journal = {
    record: (gameId, op, event) => { calls.push(['journal.record', gameId, op, event]); return { id: 'j', gameId, op, event, status: 'pending' }; },
    failed: gameId => failedEntries.filter(entry => entry.gameId === gameId),
    markRetried: id => calls.push(['journal.markRetried', id]),
    discard: id => calls.push(['journal.discard', id]),
  };
  const tapper = createTapper({
    repo, journal,
    getGame: () => state.game,
    isActive: () => state.active,
    onError: err => errors.push(err),
    now: () => now(),
    vibrate: ms => vibrations.push(ms),
  });
  return { tapper, calls, errors, vibrations, state, failedEntries };
}

const names = calls => calls.map(call => call[0]);

test('records journal entry before calling repo.addEvent', () => {
  const { tapper, calls, vibrations } = setup({ now: () => 1234 });
  const event = tapper.tap('goal', 'p5');
  assert.deepEqual(event, { id: event.id, type: 'goal', period: 2, ts: 1234, playerId: 'p5' });
  assert.deepEqual(names(calls), ['journal.record', 'repo.addEvent']);
  assert.deepEqual(calls[0], ['journal.record', 'g1', 'add', event]);
  assert.deepEqual(calls[1], ['repo.addEvent', 'g1', event]);
  assert.deepEqual(vibrations, [30]);
});

test('opponent goal carries no player', () => {
  const { tapper } = setup();
  const event = tapper.tap('oppGoal', null);
  assert.equal(Object.hasOwn(event, 'playerId'), false);
});

test('ignores duplicate tap within 1000 ms, accepts after', () => {
  let clock = 0;
  const { tapper, calls } = setup({ now: () => clock });
  assert.ok(tapper.tap('goal', 'p5'));
  assert.equal(calls.filter(call => call[0] === 'repo.addEvent').length, 1);
  clock = 500;
  assert.equal(tapper.tap('goal', 'p5'), null);
  assert.equal(calls.filter(call => call[0] === 'repo.addEvent').length, 1);
  clock = 1000;
  assert.ok(tapper.tap('goal', 'p5'));
  assert.equal(calls.filter(call => call[0] === 'repo.addEvent').length, 2);
});

test('a different player or type is not a duplicate', () => {
  const { tapper, calls } = setup({ now: () => 10 });
  assert.ok(tapper.tap('goal', 'p5'));
  assert.ok(tapper.tap('goal', 'p2'));
  assert.ok(tapper.tap('excl', 'p5'));
  assert.ok(tapper.tap('oppGoal', null));
  assert.equal(calls.filter(call => call[0] === 'repo.addEvent').length, 4);
});

test('no-op when inactive or no live game', () => {
  for (const options of [
    { active: false },
    { game: null },
    { game: { id: 'g1', status: 'final', period: 4, lineup, events: [] } },
  ]) {
    const { tapper, calls, vibrations } = setup(options);
    assert.equal(tapper.tap('goal', 'p5'), null);
    assert.equal(tapper.tap('oppGoal', null), null);
    assert.equal(tapper.undo(), null);
    assert.deepEqual(calls, []);
    assert.deepEqual(vibrations, []);
  }
});

test('no-op for goal/excl on an OUT player; oppGoal still works', () => {
  const excl = n => makeEvent('excl', 1, 'p5', n, `x${n}`);
  const { tapper, calls } = setup({
    game: { id: 'g1', status: 'live', period: 2, lineup, events: [excl(1), excl(2), excl(3)] },
    now: () => 10_000,
  });
  assert.equal(tapper.tap('goal', 'p5'), null);
  assert.equal(tapper.tap('excl', 'p5'), null);
  assert.deepEqual(calls, []);
  assert.ok(tapper.tap('oppGoal', null));
  assert.ok(tapper.tap('goal', 'p2'));
  assert.deepEqual(names(calls), ['journal.record', 'repo.addEvent', 'journal.record', 'repo.addEvent']);
});

test('a tap for a player outside the lineup is ignored', () => {
  const { tapper, calls } = setup();
  assert.equal(tapper.tap('goal', 'ghost'), null);
  assert.deepEqual(calls, []);
});

test('undo removes lastEvent and journals remove', () => {
  const first = makeEvent('goal', 1, 'p5', 100, 'a');
  const last = makeEvent('oppGoal', 2, null, 200, 'b');
  const { tapper, calls, state } = setup({
    game: { id: 'g1', status: 'live', period: 2, lineup, events: [last, first] },
  });
  assert.deepEqual(tapper.undo(), last);
  assert.deepEqual(names(calls), ['journal.record', 'repo.removeEvent']);
  assert.deepEqual(calls[0], ['journal.record', 'g1', 'remove', last]);
  assert.deepEqual(calls[1], ['repo.removeEvent', 'g1', last]);
  state.game = { ...state.game, events: [] };
  calls.length = 0;
  assert.equal(tapper.undo(), null);
  assert.deepEqual(calls, []);
});

test('every undo that reaches the tapper is performed, however close together', () => {
  const events = [makeEvent('goal', 1, 'p5', 100, 'a'), makeEvent('oppGoal', 1, null, 200, 'b')];
  const { tapper, calls, state } = setup({
    game: { id: 'g1', status: 'live', period: 1, lineup, events },
    now: () => 5000,
  });
  assert.deepEqual(tapper.undo(), events[1]);
  state.game = { ...state.game, events: [events[0]] };
  assert.deepEqual(tapper.undo(), events[0]);
  assert.equal(calls.filter(call => call[0] === 'repo.removeEvent').length, 2);
});

test('undo lets the same tap be recorded again at once', () => {
  let clock = 0;
  const { tapper, state } = setup({ now: () => clock });
  const goal = tapper.tap('goal', 'p5');
  state.game = { ...state.game, events: [goal] };
  clock = 100;
  assert.ok(tapper.undo());
  state.game = { ...state.game, events: [] };
  clock = 200;
  assert.ok(tapper.tap('goal', 'p5'));
});

test('repo rejection is passed to onError', async () => {
  const { tapper, errors, state } = setup({
    game: { id: 'g1', status: 'live', period: 2, lineup, events: [makeEvent('goal', 1, 'p2', 1, 'a')] },
  });
  const failure = Object.assign(new Error('nope'), { code: 'permission-denied' });
  state.reject = failure;
  tapper.tap('goal', 'p5');
  tapper.tap('oppGoal', null);
  tapper.undo();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(errors, [failure, failure, failure]);
});

test('a synchronous repo throw is passed to onError too', () => {
  const failure = new Error('sync');
  const errors = [];
  const tapper = createTapper({
    repo: { addEvent() { throw failure; } },
    journal: { record: () => ({}) },
    getGame: () => ({ id: 'g1', status: 'live', period: 1, lineup, events: [] }),
    isActive: () => true,
    onError: err => errors.push(err),
    now: () => 0,
    vibrate: () => {},
  });
  assert.ok(tapper.tap('goal', 'p5'));
  assert.deepEqual(errors, [failure]);
});

test('retryFailed re-issues add/remove/replace with the original event objects', () => {
  const addEv = makeEvent('goal', 1, 'p5', 100, 'a');
  const removeEv = makeEvent('oppGoal', 1, null, 200, 'b');
  const replaceEv = makeEvent('goal', 1, 'p2', 300, 'c');
  const oldVersion = makeEvent('goal', 1, 'p5', 300, 'c');
  const { tapper, calls, failedEntries } = setup({
    game: { id: 'g1', status: 'live', period: 1, lineup, events: [oldVersion, removeEv] },
  });
  failedEntries.push(
    { id: 'j1', gameId: 'g1', op: 'add', event: addEv, status: 'failed' },
    { id: 'j2', gameId: 'g1', op: 'remove', event: removeEv, status: 'failed' },
    { id: 'j3', gameId: 'g1', op: 'replace', event: replaceEv, status: 'failed' },
    { id: 'j4', gameId: 'other', op: 'add', event: addEv, status: 'failed' },
  );
  tapper.retryFailed('g1');
  assert.deepEqual(calls, [
    ['journal.markRetried', 'j1'], ['repo.addEvent', 'g1', addEv],
    ['journal.markRetried', 'j2'], ['repo.removeEvent', 'g1', removeEv],
    ['journal.markRetried', 'j3'], ['repo.replaceEvent', 'g1', oldVersion, replaceEv],
  ]);
});

test('retryFailed removes the version the server holds, not the one the entry remembers', () => {
  const serverVersion = makeEvent('goal', 1, 'p1', 300, 'c');
  const remembered = makeEvent('goal', 1, 'p2', 300, 'c');
  const { tapper, calls, failedEntries } = setup({
    game: { id: 'g1', status: 'final', period: 4, lineup, events: [serverVersion] },
  });
  failedEntries.push({ id: 'j1', gameId: 'g1', op: 'remove', event: remembered, status: 'failed' });
  tapper.retryFailed('g1');
  assert.deepEqual(calls, [['journal.markRetried', 'j1'], ['repo.removeEvent', 'g1', serverVersion]]);
});

test('retryFailed uses the snapshot it is given for a game that is not the watched one', () => {
  const serverVersion = makeEvent('goal', 1, 'p1', 300, 'c');
  const remembered = makeEvent('goal', 1, 'p2', 300, 'c');
  const { tapper, calls, failedEntries } = setup();
  failedEntries.push({ id: 'j1', gameId: 'old', op: 'remove', event: remembered, status: 'failed' });
  tapper.retryFailed('old', { id: 'old', status: 'final', events: [serverVersion] });
  assert.deepEqual(calls, [['journal.markRetried', 'j1'], ['repo.removeEvent', 'old', serverVersion]]);
});

test('retryFailed drops a remove whose event is already gone, without writing', () => {
  const { tapper, calls, failedEntries } = setup();
  failedEntries.push({ id: 'j1', gameId: 'g1', op: 'remove', event: makeEvent('goal', 1, 'p2', 300, 'c'), status: 'failed' });
  tapper.retryFailed('g1');
  assert.deepEqual(calls, [['journal.discard', 'j1']]);
});

test('retryFailed re-issues a replace as an add when the old version is gone', () => {
  const replaceEv = makeEvent('goal', 1, 'p2', 300, 'c');
  const { tapper, calls, failedEntries } = setup();
  failedEntries.push({ id: 'j3', gameId: 'g1', op: 'replace', event: replaceEv, status: 'failed' });
  tapper.retryFailed('g1');
  assert.deepEqual(calls, [['journal.markRetried', 'j3'], ['repo.addEvent', 'g1', replaceEv]]);
});

test('retryFailed does nothing while this device is not the active tracker', () => {
  const { tapper, calls, failedEntries } = setup({ active: false });
  failedEntries.push({ id: 'j1', gameId: 'g1', op: 'add', event: makeEvent('goal', 1, 'p5', 1, 'a'), status: 'failed' });
  tapper.retryFailed('g1');
  assert.deepEqual(calls, []);
});

test('retry write failures reach onError', async () => {
  const { tapper, errors, state, failedEntries } = setup();
  failedEntries.push({ id: 'j1', gameId: 'g1', op: 'add', event: makeEvent('goal', 1, 'p5', 1, 'a'), status: 'failed' });
  const failure = new Error('still down');
  state.reject = failure;
  tapper.retryFailed('g1');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(errors, [failure]);
});

test('discardFailed drops every failed entry of the game', () => {
  const { tapper, calls, failedEntries } = setup();
  failedEntries.push(
    { id: 'j1', gameId: 'g1', op: 'add', event: makeEvent('goal', 1, 'p5', 1, 'a'), status: 'failed' },
    { id: 'j2', gameId: 'g1', op: 'remove', event: makeEvent('goal', 1, 'p5', 2, 'b'), status: 'failed' },
    { id: 'j3', gameId: 'other', op: 'add', event: makeEvent('goal', 1, 'p5', 3, 'c'), status: 'failed' },
  );
  tapper.discardFailed('g1');
  assert.deepEqual(calls, [['journal.discard', 'j1'], ['journal.discard', 'j2']]);
});
