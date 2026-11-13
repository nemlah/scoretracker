import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJournal } from '../../js/journal.js';
import { makeEvent } from '../../js/model.js';

function fakeStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}
const e1 = makeEvent('goal', 1, 'p1', 1000, 'e1');
const stored = storage => JSON.parse(storage.getItem('wp-journal'));

test('add confirmed when server has the event', () => {
  const storage = fakeStorage();
  const journal = createJournal(storage);
  const entry = journal.record('g', 'add', e1);
  assert.match(entry.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(entry, { id: entry.id, gameId: 'g', op: 'add', event: e1, status: 'pending' });
  assert.deepEqual(stored(storage), [entry]);
  assert.deepEqual(journal.reconcile('g', [e1]), { confirmed: 1, failed: [] });
  assert.deepEqual(journal.failed(), []);
  assert.deepEqual(stored(storage), []);
});

test('add failed when server lacks it, and it persists', () => {
  const storage = fakeStorage();
  const journal = createJournal(storage);
  journal.record('g', 'add', e1);
  const result = journal.reconcile('g', []);
  assert.equal(result.confirmed, 0);
  assert.equal(result.failed[0].event.id, e1.id);
  assert.equal(createJournal(storage).failed('g').length, 1);
  assert.deepEqual(journal.reconcile('g', [e1]), { confirmed: 0, failed: [] });
  assert.equal(journal.failed('g').length, 1);
});

test('remove semantics', () => {
  const journal = createJournal(fakeStorage());
  journal.record('g', 'remove', e1);
  assert.deepEqual(journal.reconcile('g', []), { confirmed: 1, failed: [] });
  journal.record('g', 'remove', e1);
  const result = journal.reconcile('g', [e1]);
  assert.equal(result.confirmed, 0);
  assert.equal(result.failed[0].event.id, e1.id);
});

test('replace semantics', () => {
  const journal = createJournal(fakeStorage());
  const replacement = { ...e1, playerId: 'p2' };
  journal.record('g', 'replace', replacement);
  assert.deepEqual(journal.reconcile('g', [replacement]), { confirmed: 1, failed: [] });
  journal.record('g', 'replace', replacement);
  assert.equal(journal.reconcile('g', [e1]).failed.length, 1);
  const unassigned = makeEvent('goal', 1, null, 1000, 'e2');
  journal.record('g', 'replace', unassigned);
  assert.deepEqual(journal.reconcile('g', [unassigned]), { confirmed: 1, failed: [] });
  journal.record('g', 'replace', unassigned);
  assert.equal(journal.reconcile('g', []).failed.length, 1);
});

test('reconcile only touches the given game', () => {
  const storage = fakeStorage();
  const journal = createJournal(storage);
  journal.record('g', 'add', e1);
  const other = journal.record('h', 'add', e1);
  journal.reconcile('g', []);
  assert.deepEqual(stored(storage).find(entry => entry.id === other.id), other);
  assert.deepEqual(journal.failed('h'), []);
  assert.equal(journal.failed('g').length, 1);
});

test('markRetried and discard', () => {
  const storage = fakeStorage();
  const journal = createJournal(storage);
  const entry = journal.record('g', 'add', e1);
  journal.reconcile('g', []);
  journal.markRetried(entry.id);
  assert.deepEqual(journal.failed(), []);
  assert.equal(stored(storage)[0].status, 'pending');
  journal.discard(entry.id);
  assert.deepEqual(stored(storage), []);
  journal.markRetried('missing');
  journal.discard('missing');
  assert.deepEqual(stored(storage), []);
});

test('corrupt storage starts empty', () => {
  const storage = fakeStorage();
  storage.setItem('wp-journal', '{not json');
  let journal;
  assert.doesNotThrow(() => { journal = createJournal(storage); });
  assert.deepEqual(journal.failed(), []);
  for (const value of ['null', '{}', '[null]', '[{}]']) {
    storage.setItem('wp-journal', value);
    assert.deepEqual(createJournal(storage).failed(), []);
  }
});

test('throwing storage falls back to memory', () => {
  let writes = 0;
  const storage = {
    getItem: () => null,
    setItem: () => { writes += 1; throw new Error('unavailable'); },
  };
  const journal = createJournal(storage);
  const entry = journal.record('g', 'add', e1);
  assert.equal(journal.reconcile('g', []).failed[0].id, entry.id);
  assert.equal(journal.failed('g').length, 1);
  journal.markRetried(entry.id);
  assert.deepEqual(journal.failed(), []);
  assert.deepEqual(journal.reconcile('g', [e1]), { confirmed: 1, failed: [] });
  journal.discard(entry.id);
  assert.equal(writes, 1);
  const readFailure = createJournal({
    getItem: () => { throw new Error('unavailable'); },
    setItem: () => assert.fail('must stay in memory after a failed read'),
  });
  const memoryEntry = readFailure.record('g', 'add', e1);
  readFailure.reconcile('g', []);
  readFailure.discard(memoryEntry.id);
  assert.deepEqual(readFailure.failed(), []);
});

test('a remove cancels the pending add of the same event, so a later retry cannot bring it back', () => {
  const storage = fakeStorage();
  const journal = createJournal(storage);
  const other = makeEvent('goal', 1, 'p2', 2000, 'e2');
  journal.record('g', 'add', e1);
  journal.record('g', 'add', other);
  journal.record('other-game', 'add', e1);
  const removal = journal.record('g', 'remove', e1);
  const ops = stored(storage).map(entry => [entry.gameId, entry.op, entry.event.id]);
  assert.deepEqual(ops, [['g', 'add', 'e2'], ['other-game', 'add', 'e1'], ['g', 'remove', 'e1']]);
  // The server has e2 only: the add of e1 is gone, the remove is confirmed, nothing fails.
  assert.deepEqual(journal.reconcile('g', [other]), { confirmed: 2, failed: [] });
  assert.deepEqual(journal.failed('g'), []);
  assert.equal(removal.op, 'remove');
});

test('a remove also cancels a failed add of the same event', () => {
  const journal = createJournal(fakeStorage());
  journal.record('g', 'add', e1);
  assert.equal(journal.reconcile('g', []).failed.length, 1);
  journal.record('g', 'remove', e1);
  assert.deepEqual(journal.failed('g'), []);
  assert.deepEqual(journal.reconcile('g', []), { confirmed: 1, failed: [] });
});
