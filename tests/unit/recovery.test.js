import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJournal } from '../../js/journal.js';
import { makeEvent } from '../../js/model.js';
import { createRecovery } from '../../js/tracker/recovery.js';
import { createTapper } from '../../js/tracker/taps.js';

function fakeStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

const e1 = makeEvent('goal', 1, 'p1', 1000, 'e1');
const e1Remembered = makeEvent('goal', 1, 'p2', 1000, 'e1');

// Games on the "server" by id; a missing id is a game that does not exist there.
function setup({ games = {}, watched = [], snapshots = {}, offline = false } = {}) {
  const journal = createJournal(fakeStorage());
  const calls = [];
  const reads = [];
  const repo = {
    readGameFromServer: async id => {
      reads.push(id);
      if (offline) throw new Error('offline');
      return games[id] ?? null;
    },
    addEvent: async (...args) => { calls.push(['addEvent', ...args]); },
    removeEvent: async (...args) => { calls.push(['removeEvent', ...args]); },
    replaceEvent: async (...args) => { calls.push(['replaceEvent', ...args]); },
  };
  const tapper = createTapper({
    repo, journal, getGame: () => null, isActive: () => true, onError: err => calls.push(['error', err]),
  });
  const stats = {
    markDirty: season => calls.push(['markDirty', season]),
    drain: () => { calls.push(['drain']); return Promise.resolve(); },
  };
  let changes = 0;
  const recovery = createRecovery({
    repo, journal, tapper, stats,
    watchedIds: () => new Set(watched),
    snapshotOf: id => snapshots[id],
    onChange: () => { changes += 1; },
  });
  return { recovery, journal, calls, reads, changes: () => changes };
}

test('games with pending entries and no watch are reconciled with one server read', async () => {
  const { recovery, journal, reads, changes } = setup({
    games: { saved: { id: 'saved', events: [e1] }, lost: { id: 'lost', events: [] } },
  });
  journal.record('saved', 'add', e1);
  journal.record('lost', 'add', e1);
  await recovery.reconcileOrphans();
  assert.deepEqual(reads.sort(), ['lost', 'saved']);
  assert.deepEqual(journal.failed('saved'), []);
  assert.equal(journal.failed('lost').length, 1);
  assert.equal(journal.failed('lost')[0].gone, undefined);
  assert.equal(changes(), 1);
  // Nothing is pending any more, so nothing is read again.
  await recovery.reconcileOrphans();
  assert.equal(reads.length, 2);
});

test('a game that does not exist on the server fails its entries as gone', async () => {
  const { recovery, journal } = setup();
  journal.record('never-created', 'add', e1);
  await recovery.reconcileOrphans();
  const [entry] = journal.failed('never-created');
  assert.equal(entry.gone, true);
  assert.deepEqual(journal.pendingGameIds(), []);
});

test('watched games are left to their own snapshots, and concurrent runs read once', async () => {
  const { recovery, journal, reads } = setup({ watched: ['current'], games: { old: { id: 'old', events: [e1] } } });
  journal.record('current', 'add', e1);
  journal.record('old', 'add', e1);
  await Promise.all([recovery.reconcileOrphans(), recovery.reconcileOrphans()]);
  assert.deepEqual(reads, ['old']);
  assert.deepEqual(journal.pendingGameIds(), ['current']);
});

test('offline, the entries stay pending for a later attempt', async () => {
  const { recovery, journal } = setup({ offline: true });
  journal.record('old', 'add', e1);
  await recovery.reconcileOrphans();
  assert.deepEqual(journal.pendingGameIds(), ['old']);
  assert.deepEqual(journal.failed(), []);
});

test('retry of a game that is gone writes nothing and reports it', async () => {
  const { recovery, journal, calls } = setup();
  journal.record('never-created', 'add', e1);
  await recovery.reconcileOrphans();
  assert.equal(await recovery.retry('never-created'), 'gone');
  assert.deepEqual(calls, []);
  assert.equal(journal.failed('never-created').length, 1);
  recovery.discard('never-created');
  assert.deepEqual(journal.failed(), []);
});

test('retry reads an unwatched game from the server and removes the version it holds', async () => {
  const final = { id: 'old', status: 'final', season: '2025-26', events: [e1] };
  const { recovery, journal, calls, reads } = setup({ games: { old: final } });
  journal.record('old', 'replace', e1Remembered);
  journal.record('old', 'remove', e1Remembered);
  journal.reconcile('old', final.events);
  assert.equal(await recovery.retry('old'), 'retried');
  assert.deepEqual(reads, ['old']);
  assert.deepEqual(calls, [
    ['removeEvent', 'old', e1],
    ['markDirty', '2025-26'], ['drain'],
    ['markDirty', '2025-26'], ['drain'],
  ]);
});

test('retry uses the snapshot of a watched game without reading, and skips the recount for a live game', async () => {
  const live = { id: 'cur', status: 'live', season: '2026-27', events: [] };
  const { recovery, journal, calls, reads } = setup({ snapshots: { cur: live } });
  journal.record('cur', 'add', e1);
  journal.reconcile('cur', []);
  await recovery.retry('cur');
  assert.deepEqual(reads, []);
  assert.deepEqual(calls, [['addEvent', 'cur', e1]]);
});

test('retry reports an unreachable server and a vanished game', async () => {
  const offline = setup({ offline: true });
  offline.journal.record('old', 'add', e1);
  offline.journal.reconcile('old', []);
  assert.equal(await offline.recovery.retry('old'), 'unavailable');
  assert.equal(offline.journal.failed('old').length, 1);
  assert.deepEqual(offline.calls, []);

  const vanished = setup();
  vanished.journal.record('old', 'add', e1);
  vanished.journal.reconcile('old', []);
  assert.equal(await vanished.recovery.retry('old'), 'gone');
  assert.equal(vanished.journal.failed('old')[0].gone, true);
});
