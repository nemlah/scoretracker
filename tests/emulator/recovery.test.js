import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  disableNetwork, doc, enableNetwork, getDocFromServer, setDoc,
} from 'firebase/firestore';
import { createJournal } from '../../js/journal.js';
import { makeEvent, withPlayer } from '../../js/model.js';
import { createRecovery } from '../../js/tracker/recovery.js';
import { createStatsQueue } from '../../js/tracker/statsQueue.js';
import { createTapper } from '../../js/tracker/taps.js';
import { makeClient, testEnv } from './helpers.js';

const roster = [
  { id: 'a', name: 'Alexiou', cap: 5, archived: false },
  { id: 'b', name: 'Papadakis', cap: 2, archived: false },
];
const lineup = [{ playerId: 'a', name: 'Alexiou', cap: 11 }, { playerId: 'b', name: 'Papadakis', cap: 2 }];
let clientNumber = 0;
const read = async (db, path) => (await getDocFromServer(doc(db, path))).data();
const fakeStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

async function activeClient() {
  const result = await makeClient(`recovery-${++clientNumber}`);
  await result.repo.unlock(result.uid, 'AB12CD');
  return result;
}

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'secrets/editCode'), { code: 'AB12CD' });
  });
});

test('a refused scorer change followed by a refused delete is retried against the version the server holds', async () => {
  const first = await activeClient();
  const created = first.repo.createGame({ opponent: 'Rivals', date: '2026-11-08', lineup, roster });
  await created.done;
  const id = created.id;
  const p1 = makeEvent('goal', 1, 'a', 1000, 'goal-1');
  await first.repo.addEvent(id, p1);
  await first.repo.endGame(id);
  await first.repo.recomputeSeason('2026-27');
  assert.equal((await read(first.db, 'stats/2026-27')).players.a.goals, 1);

  const journal = createJournal(fakeStorage());
  const dirty = createStatsQueue(fakeStorage(), season => first.repo.recomputeSeason(season));
  const errors = [];
  const tapper = createTapper({
    repo: first.repo, journal, getGame: () => null, isActive: () => true, onError: err => errors.push(err),
  });

  // Offline, the scorer is changed to player b and the goal is then deleted. Another device takes
  // over before the writes arrive, so both are refused.
  await disableNetwork(first.db);
  const p2 = withPlayer(p1, 'b');
  journal.record(id, 'replace', p2);
  const replaced = first.repo.replaceEvent(id, p1, p2);
  journal.record(id, 'remove', p2);
  const removed = first.repo.removeEvent(id, p2);
  const second = await activeClient();
  await enableNetwork(first.db);
  await assert.rejects(replaced, { code: 'permission-denied' });
  await assert.rejects(removed, { code: 'permission-denied' });

  const server = await read(second.db, `games/${id}`);
  assert.deepEqual(server.events, [p1]);
  assert.equal(journal.reconcile(id, server.events).failed.length, 1);

  await first.repo.takeOver(first.uid);
  const recovery = createRecovery({
    repo: first.repo, journal, tapper, stats: dirty,
    watchedIds: () => new Set(), snapshotOf: () => undefined, onChange() {},
  });
  assert.equal(await recovery.retry(id), 'retried');
  await dirty.drain();

  // The version the server held (player a) is gone; retrying the remembered one would not have removed it.
  assert.deepEqual(errors, []);
  assert.deepEqual((await read(first.db, `games/${id}`)).events, []);
  const stats = await read(first.db, 'stats/2026-27');
  assert.equal(stats.players.a?.goals ?? 0, 0);
  assert.equal(stats.results[0].us, 0);
  assert.deepEqual(dirty.dirty(), []);
});
