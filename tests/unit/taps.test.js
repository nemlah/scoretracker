import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createJournal } from '../../js/journal.js';
import { createTapper } from '../../js/tracker/taps.js';
import { deriveScore, makeEvent } from '../../js/model.js';

const lineup = [
  { playerId: 'p2', name: 'Papadakis', cap: 2 },
  { playerId: 'p5', name: 'Alexiou', cap: 5 },
];

// Fakes record every call, in order, in one shared log.
function setup({ game, active = true, now = () => 0, eventTypes } = {}) {
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
    ...(eventTypes ? { eventTypes } : {}),
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

test('retryFailed sends only the latest intent for a failed add and replace absent from the snapshot', async () => {
  const v1 = makeEvent('goal', 1, 'p5', 300, 'c');
  const v2 = { ...v1, playerId: 'p2' };
  const { tapper, calls, failedEntries } = setup();
  failedEntries.push(
    { id: 'j1', gameId: 'g1', op: 'add', event: v1, status: 'failed' },
    { id: 'j2', gameId: 'g1', op: 'replace', event: v2, status: 'failed' },
  );
  await tapper.retryFailed('g1');
  assert.deepEqual(calls, [
    ['journal.discard', 'j1'], ['journal.markRetried', 'j2'],
    ['repo.addEvent', 'g1', v2],
  ]);
});

test('retryFailed sends one replace for a failed add and replace present in the snapshot', async () => {
  const v1 = makeEvent('goal', 1, 'p5', 300, 'c');
  const v2 = { ...v1, playerId: 'p2' };
  const { tapper, calls, failedEntries } = setup({
    game: { id: 'g1', status: 'live', period: 1, lineup, events: [v1] },
  });
  failedEntries.push(
    { id: 'j1', gameId: 'g1', op: 'add', event: v1, status: 'failed' },
    { id: 'j2', gameId: 'g1', op: 'replace', event: v2, status: 'failed' },
  );
  await tapper.retryFailed('g1');
  assert.deepEqual(calls, [
    ['journal.discard', 'j1'], ['journal.markRetried', 'j2'],
    ['repo.replaceEvent', 'g1', v1, v2],
  ]);
});

test('retryFailed discards a lone failed add already present in the snapshot without writing', async () => {
  const event = makeEvent('goal', 1, 'p5', 300, 'c');
  const serverVersion = { ...event, playerId: 'p2' };
  const { tapper, calls, failedEntries } = setup({
    game: { id: 'g1', status: 'live', period: 1, lineup, events: [serverVersion] },
  });
  failedEntries.push({ id: 'j1', gameId: 'g1', op: 'add', event, status: 'failed' });
  await tapper.retryFailed('g1');
  assert.deepEqual(calls, [
    ['journal.discard', 'j1'],
  ]);
});

test('retryFailed discards a failed remove before retrying its later correction', async () => {
  const v1 = makeEvent('goal', 1, 'p5', 300, 'c');
  const v2 = { ...v1, playerId: 'p2' };
  const { tapper, calls, failedEntries } = setup({
    game: { id: 'g1', status: 'live', period: 1, lineup, events: [v1] },
  });
  failedEntries.push(
    { id: 'j1', gameId: 'g1', op: 'remove', event: v1, status: 'failed' },
    { id: 'j2', gameId: 'g1', op: 'replace', event: v2, status: 'failed' },
  );
  await tapper.retryFailed('g1');
  assert.deepEqual(calls, [
    ['journal.discard', 'j1'], ['journal.markRetried', 'j2'],
    ['repo.replaceEvent', 'g1', v1, v2],
  ]);
});

test('retryFailed reconciles a real journal without duplicate goals and is idempotent', async () => {
  const values = new Map();
  const journal = createJournal({
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  });
  let serverEvents = [];
  const calls = [];
  const union = event => {
    if (!serverEvents.some(existing => isDeepStrictEqual(existing, event))) serverEvents.push({ ...event });
  };
  const remove = event => {
    serverEvents = serverEvents.filter(existing => !isDeepStrictEqual(existing, event));
  };
  const repo = {
    async addEvent(gameId, event) {
      calls.push(['repo.addEvent', gameId, event]);
      union(event);
    },
    async removeEvent(gameId, event) {
      calls.push(['repo.removeEvent', gameId, event]);
      remove(event);
    },
    async replaceEvent(gameId, before, after) {
      calls.push(['repo.replaceEvent', gameId, before, after]);
      remove(before);
      union(after);
    },
  };
  const errors = [];
  const tapper = createTapper({
    repo, journal,
    getGame: () => ({ id: 'g1', events: [...serverEvents] }),
    isActive: () => true,
    onError: err => errors.push(err),
  });
  const v1 = makeEvent('goal', 1, 'p5', 300, 'c');
  const v2 = { ...v1, playerId: 'p2' };
  journal.record('g1', 'add', v1);
  journal.record('g1', 'replace', v2);
  assert.equal(journal.reconcile('g1', serverEvents).failed.length, 1);
  await tapper.retryFailed('g1');
  assert.deepEqual(serverEvents, [v2]);
  assert.equal(deriveScore(serverEvents).us, 1);
  assert.deepEqual(calls, [['repo.addEvent', 'g1', v2]]);
  assert.deepEqual(journal.reconcile('g1', serverEvents), { confirmed: 1, failed: [] });
  assert.deepEqual(journal.failed('g1'), []);
  assert.deepEqual(journal.pendingGameIds(), []);
  await tapper.retryFailed('g1');
  assert.deepEqual(calls, [['repo.addEvent', 'g1', v2]]);
  assert.deepEqual(errors, []);
});

test('retryFailed keeps a corrected event after its refused delete with a real journal', async () => {
  const values = new Map();
  const journal = createJournal({
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  });
  const v1 = makeEvent('goal', 1, 'p5', 300, 'c');
  const v2 = { ...v1, playerId: 'p2' };
  let serverEvents = [v1];
  const calls = [];
  const repo = {
    async addEvent(gameId, event) {
      calls.push(['repo.addEvent', gameId, event]);
      if (!serverEvents.some(existing => isDeepStrictEqual(existing, event))) serverEvents.push({ ...event });
    },
    async removeEvent(gameId, event) {
      calls.push(['repo.removeEvent', gameId, event]);
      serverEvents = serverEvents.filter(existing => !isDeepStrictEqual(existing, event));
    },
    async replaceEvent(gameId, before, after) {
      calls.push(['repo.replaceEvent', gameId, before, after]);
      serverEvents = serverEvents.filter(existing => !isDeepStrictEqual(existing, before));
      if (!serverEvents.some(existing => isDeepStrictEqual(existing, after))) serverEvents.push({ ...after });
    },
  };
  const tapper = createTapper({
    repo, journal,
    getGame: () => ({ id: 'g1', events: [...serverEvents] }),
    isActive: () => true,
    onError: err => assert.fail(err),
  });
  journal.record('g1', 'remove', v1);
  assert.equal(journal.reconcile('g1', serverEvents).failed.length, 1);
  const correction = journal.record('g1', 'replace', v2);
  assert.deepEqual(journal.failed('g1'), []);
  assert.deepEqual(JSON.parse(values.get('wp-journal')), [correction]);
  assert.equal(correction.status, 'pending');
  assert.equal(journal.reconcile('g1', serverEvents).failed.length, 1);
  await tapper.retryFailed('g1');
  assert.deepEqual(serverEvents, [v2]);
  assert.deepEqual(calls, [['repo.replaceEvent', 'g1', v1, v2]]);
  assert.deepEqual(journal.reconcile('g1', serverEvents), { confirmed: 1, failed: [] });
  assert.deepEqual(JSON.parse(values.get('wp-journal')), []);
  await tapper.retryFailed('g1');
  assert.deepEqual(calls, [['repo.replaceEvent', 'g1', v1, v2]]);
  assert.deepEqual(serverEvents, [v2]);
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

test('pen is journaled and written like an exclusion; refused for an OUT player', () => {
  const { tapper, calls, vibrations, state } = setup({ now: () => 1234 });
  const event = tapper.tap('pen', 'p2');
  assert.deepEqual(event, { id: event.id, type: 'pen', period: 2, ts: 1234, playerId: 'p2' });
  assert.deepEqual(calls, [['journal.record', 'g1', 'add', event], ['repo.addEvent', 'g1', event]]);
  assert.deepEqual(vibrations, [30]);
  calls.length = 0;
  state.game.events = ['excl', 'pen', 'pen'].map((type, i) => makeEvent(type, 1, 'p5', i, `f${i}`));
  for (const playerId of ['p5', 'ghost', null]) assert.equal(tapper.tap('pen', playerId), null);
  assert.deepEqual(names(calls), []);
  assert.deepEqual(vibrations, [30]);
});

test('situation taps are refused on an untracked game and in the shootout', () => {
  for (const situations of [undefined, false, 'true', true]) {
    for (const period of [0, 1, 2, 3, 4, 5, 'SO']) {
      if (situations === true && [1, 2, 3, 4].includes(period)) continue;
      for (const type of ['manUp', 'manUpEnd', 'manDownEnd']) {
        const { tapper, calls, vibrations, state } = setup();
        Object.assign(state.game, { situations, period });
        assert.equal(tapper.tap(type, 'p2'), null);
        assert.deepEqual(names(calls), []);
        assert.deepEqual(vibrations, []);
      }
    }
  }
});

test('manUp is refused while a man-up or man-down is open; manUpEnd only while a man-up is open; manDownEnd only while a man-down is open', () => {
  for (const period of [1, 2, 3, 4]) {
    for (const start of [null, 'manUp', 'excl']) {
      for (const type of ['manUp', 'manUpEnd', 'manDownEnd']) {
        const { tapper, calls, vibrations, state } = setup({ now: () => 100 });
        Object.assign(state.game, { situations: true, period, events: start ? [makeEvent(start, period, start === 'excl' ? 'p2' : null, 1, 'start')] : [] });
        const accepted = type === (start === null ? 'manUp' : start === 'manUp' ? 'manUpEnd' : 'manDownEnd');
        const event = tapper.tap(type, 'p2');
        if (accepted) {
          assert.deepEqual(event, { id: event.id, type, period, ts: 100 });
          assert.deepEqual(names(calls), ['journal.record', 'repo.addEvent']);
          assert.deepEqual(vibrations, [30]);
          assert.equal(tapper.tap(type, 'p5'), null);
          assert.equal(calls.length, 2);
        } else {
          assert.equal(event, null);
          assert.deepEqual(names(calls), []);
          assert.deepEqual(vibrations, []);
        }
      }
    }
  }
});

const goalieLineup = [
  { playerId: 'g1', name: 'Georgiou', cap: 1, goalie: true },
  { playerId: 'g13', name: 'Nikolaou', cap: 13, goalie: true },
  ...lineup,
];

test('save and penSave are journaled for a goalie and refused for a field player', () => {
  for (const type of ['save', 'penSave']) {
    const { tapper, calls, vibrations, state } = setup({ now: () => 1234 });
    state.game.lineup = goalieLineup;
    for (const id of ['p2', 'ghost', null]) assert.equal(tapper.tap(type, id), null);
    assert.deepEqual(calls, []);
    assert.deepEqual(vibrations, []);
    const event = tapper.tap(type, 'g1');
    assert.deepEqual(event, { id: event.id, type, period: 2, ts: 1234, playerId: 'g1' });
    assert.deepEqual(calls, [['journal.record', 'g1', 'add', event], ['repo.addEvent', 'g1', event]]);
    assert.deepEqual(vibrations, [30]);
  }
});

test('a goalie tap is refused when the type is not a known event type', () => {
  // An old cached model.js lists no goalie types; the journal would drop the whole journal on load.
  const oldTypes = ['goal', 'excl', 'oppGoal', 'pen', 'manUp', 'manUpEnd', 'manDown', 'manDownEnd'];
  for (const type of ['save', 'penSave', 'gkIn']) {
    const { tapper, calls, vibrations, state } = setup({ eventTypes: oldTypes });
    state.game.lineup = goalieLineup;
    assert.equal(tapper.tap(type, 'g1'), null);
    assert.deepEqual(calls, []);
    assert.deepEqual(vibrations, []);
  }
  const { tapper, calls, state } = setup({ eventTypes: oldTypes });
  state.game.lineup = goalieLineup;
  assert.ok(tapper.tap('goal', 'p5'));
  assert.equal(calls.length, 2);
});

test('gkIn is refused for the goalie already in goal', () => {
  const { tapper, calls, vibrations, state } = setup();
  state.game.lineup = goalieLineup;
  assert.equal(tapper.tap('gkIn', 'g1'), null);
  assert.deepEqual(calls, []);
  assert.deepEqual(vibrations, []);
  const event = tapper.tap('gkIn', 'g13');
  assert.deepEqual(event, { id: event.id, type: 'gkIn', period: 2, ts: 0, playerId: 'g13' });
  assert.deepEqual(names(calls), ['journal.record', 'repo.addEvent']);
  assert.deepEqual(vibrations, [30]);
  state.game.events = [event];
  assert.equal(tapper.tap('gkIn', 'g13'), null);
  assert.ok(tapper.tap('gkIn', 'g1'));
});

test('save is refused in the shootout; penSave is allowed', () => {
  const { tapper, calls, vibrations, state } = setup();
  Object.assign(state.game, { lineup: goalieLineup, period: 'SO' });
  assert.equal(tapper.tap('save', 'g1'), null);
  assert.deepEqual(calls, []);
  assert.deepEqual(vibrations, []);
  assert.equal(tapper.tap('penSave', 'g1').period, 'SO');
  assert.ok(tapper.tap('gkIn', 'g13'));
});

test('goalie taps are refused for an OUT goalie', () => {
  const { tapper, calls, vibrations, state } = setup();
  Object.assign(state.game, { lineup: goalieLineup, events: ['excl', 'pen', 'excl'].map((type, i) => makeEvent(type, 1, 'g13', i)) });
  for (const type of ['save', 'penSave', 'gkIn']) assert.equal(tapper.tap(type, 'g13'), null);
  assert.deepEqual(calls, []);
  assert.deepEqual(vibrations, []);
});

test('goalie taps preserve duplicate protection and live-tracker guards', () => {
  for (const type of ['save', 'penSave', 'gkIn']) {
    let clock = 0;
    const { tapper, calls, vibrations, state } = setup({ now: () => clock });
    state.game.lineup = goalieLineup;
    assert.ok(tapper.tap(type, 'g13'));
    clock = 500;
    assert.equal(tapper.tap(type, 'g13'), null);
    assert.equal(calls.length, 2);
    assert.deepEqual(vibrations, [30]);
    clock = 1000;
    assert.ok(tapper.tap(type, 'g13'));
    state.active = false;
    assert.equal(tapper.tap(type, 'g1'), null);
    state.active = true;
    state.game.status = 'final';
    assert.equal(tapper.tap(type, 'g1'), null);
    assert.equal(calls.length, 4);
  }
});
