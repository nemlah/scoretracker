import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { doc, getDocFromServer, setDoc, Timestamp } from 'firebase/firestore';
import { makeEvent, withPlayer } from '../../js/model.js';
import { makeClient, testEnv } from './helpers.js';

const roster = [
  { id: 'a', name: 'Alexiou', cap: 5, archived: false },
  { id: 'b', name: 'Papadakis', cap: 2, archived: false },
];
const lineup = [{ playerId: 'a', name: 'Alexiou', cap: 11 }];
const gameInput = { opponent: 'Rivals', date: '2026-11-08', lineup, roster };
let clientNumber = 0;
const client = () => makeClient(`repo-${++clientNumber}`);
const read = async (db, path) => (await getDocFromServer(doc(db, path))).data();

async function activeClient() {
  const result = await client();
  await result.repo.unlock(result.uid, 'AB12CD');
  return result;
}

async function createGame(repo, input = gameInput) {
  const result = repo.createGame(input);
  assert.equal(typeof result.id, 'string');
  assert.ok(result.done instanceof Promise);
  await result.done;
  return result.id;
}

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'secrets/editCode'), { code: 'AB12CD' });
  });
});

test('unlock rejects a wrong code with permission-denied and leaves control untouched', async () => {
  const { db, uid, repo } = await client();
  await assert.rejects(repo.unlock(uid, 'ZZZZZZ'), { code: 'permission-denied' });
  assert.equal(await read(db, 'control/tracker'), undefined);
  assert.equal(await read(db, `editors/${uid}`), undefined);
});

test('unlock with the right code makes this uid the active tracker', async () => {
  const { db, uid } = await activeClient();
  const control = await read(db, 'control/tracker');
  const editor = await read(db, `editors/${uid}`);
  assert.equal(control.activeUid, uid);
  assert.ok(control.claimedAt instanceof Timestamp);
  assert.equal(editor.code, 'AB12CD');
  assert.ok(editor.claimedAt instanceof Timestamp);
});

test('createGame writes a live game, sets team.currentGameId and roster caps', async () => {
  const { db, repo } = await activeClient();
  const id = await createGame(repo);
  const game = await read(db, `games/${id}`);
  const team = await read(db, 'team/main');
  assert.equal(game.opponent, 'Rivals');
  assert.equal(game.date, '2026-11-08');
  assert.equal(game.season, '2026-27');
  assert.equal(game.status, 'live');
  assert.equal(game.period, 1);
  assert.deepEqual(game.lineup, lineup);
  assert.deepEqual(game.events, []);
  assert.ok(game.createdAt instanceof Timestamp);
  assert.ok(game.updatedAt instanceof Timestamp);
  assert.equal(team.currentGameId, id);
  assert.equal(team.roster.find(player => player.id === 'a').cap, 11);
  assert.equal(team.roster.find(player => player.id === 'b').cap, 2);
  assert.ok(team.updatedAt instanceof Timestamp);
});

test('add, replace, remove events round-trip; unknown-scorer goal has no playerId field', async () => {
  const { db, repo } = await activeClient();
  const id = await createGame(repo);
  const event = makeEvent('goal', 1, null, 1000, 'goal-1');
  await repo.addEvent(id, event);
  await repo.addEvent(id, event);
  let game = await read(db, `games/${id}`);
  assert.deepEqual(game.events, [event]);
  assert.equal('playerId' in game.events[0], false);
  const other = makeEvent('oppGoal', 1, null, 2000, 'goal-2');
  await repo.addEvent(id, other);
  const replacement = withPlayer(event, 'a');
  await repo.replaceEvent(id, event, replacement);
  game = await read(db, `games/${id}`);
  assert.deepEqual(game.events, [other, replacement]);
  await repo.removeEvent(id, replacement);
  await repo.removeEvent(id, other);
  assert.deepEqual((await read(db, `games/${id}`)).events, []);
});

test('endGame marks final and writes stats/{season}', async () => {
  const { db, repo } = await activeClient();
  const id = await createGame(repo);
  await repo.addEvent(id, makeEvent('goal', 1, 'a', 1000, 'goal-1'));
  await repo.endGame(id);
  await repo.recomputeSeason('2026-27');
  assert.equal((await read(db, `games/${id}`)).status, 'final');
  const stats = await read(db, 'stats/2026-27');
  assert.equal(stats.players.a.goals, 1);
  assert.equal(stats.results.length, 1);
  assert.equal(stats.results[0].gameId, id);
  assert.ok(stats.updatedAt instanceof Timestamp);
});

test("after takeover by a second client, the first client's addEvent rejects with permission-denied", async () => {
  const first = await activeClient();
  const id = await createGame(first.repo);
  const second = await activeClient();
  const event = makeEvent('goal', 1, 'a', 1000, 'goal-1');
  await assert.rejects(first.repo.addEvent(id, event), { code: 'permission-denied' });
  assert.deepEqual((await read(second.db, `games/${id}`)).events, []);
  await first.repo.takeOver(first.uid);
  await first.repo.addEvent(id, event);
  assert.deepEqual((await read(first.db, `games/${id}`)).events, [event]);
});

test('deleteGame rejects an inactive tracker and leaves the game and team unchanged', async () => {
  const first = await activeClient();
  await createGame(first.repo, { ...gameInput, date: '2026-11-01' });
  const id = await createGame(first.repo);
  const second = await activeClient();
  const gameBefore = await read(second.db, `games/${id}`);
  const teamBefore = await read(second.db, 'team/main');
  assert.equal(teamBefore.currentGameId, id);

  await assert.rejects(first.repo.deleteGame(id), { code: 'permission-denied' });

  assert.deepEqual(await read(second.db, `games/${id}`), gameBefore);
  assert.deepEqual(await read(second.db, 'team/main'), teamBefore);
});

test('deleteGame repoints currentGameId to the newest remaining game and recomputeSeason drops it', async () => {
  const { db, repo } = await activeClient();
  const older = await createGame(repo, { ...gameInput, date: '2026-11-01' });
  const newest = await createGame(repo, { ...gameInput, date: '2026-11-10' });
  const middle = await createGame(repo);
  for (const id of [older, newest, middle]) await repo.endGame(id);
  await repo.recomputeSeason('2026-27');
  assert.equal((await read(db, 'stats/2026-27')).results.length, 3);
  await repo.deleteGame(middle);
  assert.equal(await read(db, `games/${middle}`), undefined);
  assert.equal((await read(db, 'team/main')).currentGameId, newest);
  // Deletion leaves stats for the caller to refresh.
  assert.equal((await read(db, 'stats/2026-27')).results.length, 3);
  await repo.recomputeSeason('2026-27');
  assert.deepEqual((await read(db, 'stats/2026-27')).results.map(result => result.gameId), [newest, older]);
  await repo.deleteGame(newest);
  assert.equal((await read(db, 'team/main')).currentGameId, older);
  await repo.deleteGame(older);
  assert.equal((await read(db, 'team/main')).currentGameId, null);
  await repo.recomputeSeason('2026-27');
  const stats = await read(db, 'stats/2026-27');
  assert.deepEqual(stats.players, {});
  assert.deepEqual(stats.results, []);
});

test('roster, lineup, period and reopen updates preserve team fields; listGames sorts by date', async () => {
  const { db, repo } = await activeClient();
  const newest = await createGame(repo, { ...gameInput, date: '2026-11-10' });
  const older = await createGame(repo);
  const renamedRoster = roster.map(player => ({ ...player, name: `New ${player.name}` }));
  await repo.saveRoster(renamedRoster);
  assert.equal((await read(db, 'team/main')).currentGameId, older);
  const changedLineup = [{ playerId: 'a', name: 'New Alexiou', cap: 7 }];
  await repo.setLineup(older, changedLineup, renamedRoster);
  await repo.setPeriod(older, 'SO');
  const game = await read(db, `games/${older}`);
  assert.deepEqual(game.lineup, changedLineup);
  assert.equal(game.period, 'SO');
  assert.ok(game.updatedAt instanceof Timestamp);
  let team = await read(db, 'team/main');
  assert.equal(team.roster[0].cap, 7);
  assert.equal(team.currentGameId, older);
  await repo.endGame(newest);
  await repo.reopenGame(newest);
  assert.equal((await read(db, `games/${newest}`)).status, 'live');
  team = await read(db, 'team/main');
  assert.equal(team.currentGameId, newest);
  assert.equal(team.roster[0].cap, 7);
  assert.ok(team.updatedAt instanceof Timestamp);
  assert.deepEqual((await repo.listGames()).map(game => game.id), [newest, older]);
});

function nextSnapshot(subscribe, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error('Timed out waiting for repository snapshot'));
    }, 5000);
    const unsubscribe = subscribe((data, meta) => {
      if (!predicate(data, meta)) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve({ data, meta });
    });
  });
}

test('watchers deliver null or document data and metadata; watchGame reports write confirmation', async () => {
  const { uid, repo } = await activeClient();
  const serverConfirmed = (_data, meta) => !meta.fromCache && !meta.hasPendingWrites;
  const emptyTeam = await nextSnapshot(cb => repo.watchTeam(cb), serverConfirmed);
  assert.deepEqual(emptyTeam, { data: null, meta: { fromCache: false, hasPendingWrites: false } });
  const emptyStats = await nextSnapshot(cb => repo.watchStats('2026-27', cb), serverConfirmed);
  assert.equal(emptyStats.data, null);
  const control = await nextSnapshot(cb => repo.watchControl(cb), serverConfirmed);
  assert.equal(control.data.activeUid, uid);
  const editor = await nextSnapshot(cb => repo.watchOwnEditor(uid, cb), serverConfirmed);
  assert.equal(editor.data.code, 'AB12CD');
  const id = await createGame(repo);
  const event = makeEvent('goal', 1, 'a', 1000, 'goal-1');
  const pending = nextSnapshot(cb => repo.watchGame(id, cb), (data, meta) =>
    data?.events.length === 1 && meta.hasPendingWrites);
  const confirmed = nextSnapshot(cb => repo.watchGame(id, cb), (data, meta) =>
    data?.events.length === 1 && serverConfirmed(data, meta));
  await repo.addEvent(id, event);
  const snapshots = await Promise.all([pending, confirmed]);
  for (const snapshot of snapshots) {
    assert.equal(snapshot.data.id, id);
    assert.deepEqual(snapshot.data.events, [event]);
    assert.equal(typeof snapshot.meta.fromCache, 'boolean');
  }
  assert.equal(snapshots[0].meta.hasPendingWrites, true);
  assert.equal(snapshots[1].meta.hasPendingWrites, false);
  await repo.deleteGame(id);
  const deleted = await nextSnapshot(cb => repo.watchGame(id, cb), serverConfirmed);
  assert.equal(deleted.data, null);
});
