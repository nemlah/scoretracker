import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJournal } from '../../js/journal.js';
import * as m from '../../js/model.js';

const { makeEvent } = m;

function fakeStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}
const e1 = makeEvent('goal', 1, 'p1', 1000, 'e1');
const stored = storage => JSON.parse(storage.getItem('wp-journal'));

test('entries of every event type load; an unknown type still empties the journal', () => {
  const storage = fakeStorage();
  const entries = m.EVENT_TYPES.map((type, index) => ({
    id: `j${index}`, gameId: 'g', op: 'add',
    event: makeEvent(type, 1, null, index, `e${index}`), status: 'failed',
  }));
  storage.setItem('wp-journal', JSON.stringify(entries));
  assert.deepEqual(createJournal(storage).failed('g'), entries);
  storage.setItem('wp-journal', JSON.stringify([...entries, {
    id: 'unknown', gameId: 'g', op: 'add', event: makeEvent('shot', 1, null, 10, 'shot'), status: 'failed',
  }]));
  assert.deepEqual(createJournal(storage).failed('g'), []);
});

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

const scorer = playerId => makeEvent('goal', 1, playerId, 1000, 'e1');

test('a later replace of the same event supersedes earlier pending and failed replaces', () => {
  const journal = createJournal(fakeStorage());
  journal.record('g', 'replace', scorer('p1'));
  journal.record('g', 'replace', scorer('p2'));
  const second = journal.record('g', 'replace', scorer('p3'));
  // A different event's replace and another game's replace are not touched.
  const other = journal.record('g', 'replace', makeEvent('goal', 1, 'p1', 1000, 'e2'));
  journal.record('h', 'replace', scorer('p1'));
  assert.deepEqual(journal.reconcile('g', [scorer('p3'), makeEvent('goal', 1, 'p1', 1000, 'e2')]), { confirmed: 2, failed: [] });
  assert.deepEqual(journal.failed('g'), []);
  assert.equal(second.event.playerId, 'p3');
  assert.equal(other.event.id, 'e2');

  // A failed earlier replace is dropped too, so Retry cannot undo the latest correction.
  const again = createJournal(fakeStorage());
  again.record('g', 'replace', scorer('p1'));
  again.reconcile('g', [scorer('p9')]);
  assert.equal(again.failed('g').length, 1);
  again.record('g', 'replace', scorer('p2'));
  assert.deepEqual(again.failed('g'), []);
});

test('a remove drops the pending and failed adds and replaces of that event', () => {
  const storage = fakeStorage();
  const journal = createJournal(storage);
  journal.record('g', 'replace', scorer('p1'));
  journal.reconcile('g', []); // failed
  journal.record('g', 'replace', scorer('p2')); // supersedes the failed one
  journal.record('g', 'add', makeEvent('goal', 1, null, 1000, 'e1'));
  journal.record('g', 'replace', makeEvent('goal', 1, 'p4', 1000, 'e9'));
  const removal = journal.record('g', 'remove', scorer('p2'));
  assert.deepEqual(stored(storage).map(entry => [entry.op, entry.event.id]), [['replace', 'e9'], ['remove', 'e1']]);
  assert.equal(removal.status, 'pending');
  journal.reconcile('g', [makeEvent('goal', 1, 'p4', 1000, 'e9')]);
  assert.deepEqual(journal.failed('g'), []);
  assert.deepEqual(stored(storage), []);
});

test('two instances sharing one storage never overwrite each other', () => {
  const storage = fakeStorage();
  const a = createJournal(storage);
  const b = createJournal(storage);
  const first = a.record('g', 'add', e1);
  const second = b.record('g', 'add', makeEvent('goal', 1, 'p2', 2000, 'e2'));
  assert.deepEqual(stored(storage).map(entry => entry.id), [first.id, second.id]);

  // Reconcile, retry and discard in one tab are seen by the other, and nothing else is lost.
  assert.equal(a.reconcile('g', []).failed.length, 2);
  assert.equal(b.failed('g').length, 2);
  b.markRetried(first.id);
  assert.deepEqual(a.failed('g').map(entry => entry.id), [second.id]);
  const third = a.record('h', 'add', e1);
  a.discard(second.id);
  assert.deepEqual(stored(storage).map(entry => entry.id), [first.id, third.id]);
  assert.deepEqual(b.pendingGameIds().sort(), ['g', 'h']);
});

test('a stale in-memory copy is never written back after another tab changed storage', () => {
  const storage = fakeStorage();
  const a = createJournal(storage);
  const entry = a.record('g', 'add', e1);
  // Another tab clears the journal (everything confirmed); this tab must not resurrect the entry.
  storage.setItem('wp-journal', '[]');
  a.markRetried(entry.id);
  a.record('h', 'add', e1);
  assert.deepEqual(stored(storage).map(item => item.gameId), ['h']);
});

test('pendingGameIds lists games with pending entries, markGone fails them as gone', () => {
  const storage = fakeStorage();
  const journal = createJournal(storage);
  journal.record('g', 'add', e1);
  journal.record('h', 'add', e1);
  journal.reconcile('h', []);
  assert.deepEqual(journal.pendingGameIds(), ['g']);
  const gone = journal.markGone('g');
  assert.equal(gone.length, 1);
  assert.equal(gone[0].gone, true);
  assert.deepEqual(journal.pendingGameIds(), []);
  assert.equal(journal.failed('g')[0].gone, true);
  assert.equal(createJournal(storage).failed('g')[0].gone, true);
  assert.equal(createJournal(storage).failed('h')[0].gone, undefined);
});
