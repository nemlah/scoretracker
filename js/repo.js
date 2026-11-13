import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  FirestoreError,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  waitForPendingWrites,
  where,
  writeBatch,
} from 'firebase/firestore';
import { aggregateSeason, rosterWithCaps, seasonFor } from './model.js';

const gameData = snapshot => ({ ...snapshot.data(), id: snapshot.id });

function requireOnline() {
  if (globalThis.navigator?.onLine === false) {
    throw new FirestoreError('unavailable', 'This operation requires a connection.');
  }
}

export function createRepo(db) {
  const teamRef = doc(db, 'team/main');
  const controlRef = doc(db, 'control/tracker');
  const gamesRef = collection(db, 'games');
  const gameRef = id => doc(gamesRef, id);
  const updated = data => ({ ...data, updatedAt: serverTimestamp() });

  function watch(ref, cb, isGame = false) {
    return onSnapshot(ref, { includeMetadataChanges: true }, snapshot => {
      const data = snapshot.exists() ? (isGame ? gameData(snapshot) : snapshot.data()) : null;
      const { fromCache, hasPendingWrites } = snapshot.metadata;
      cb(data, { fromCache, hasPendingWrites });
    });
  }

  function takeOver(uid) {
    // Security rules deliberately restrict this document to these two keys.
    return setDoc(controlRef, { activeUid: uid, claimedAt: serverTimestamp() });
  }

  return {
    watchTeam: cb => watch(teamRef, cb),
    watchGame: (gameId, cb) => watch(gameRef(gameId), cb, true),
    watchStats: (season, cb) => watch(doc(db, 'stats', season), cb),
    watchControl: cb => watch(controlRef, cb),
    watchOwnEditor: (uid, cb) => watch(doc(db, 'editors', uid), cb),

    async listGames() {
      const snapshot = await getDocs(query(gamesRef, orderBy('date', 'desc')));
      return snapshot.docs.map(gameData);
    },

    async unlock(uid, code) {
      requireOnline();
      // Editor documents accept only code and claimedAt under the rules.
      await setDoc(doc(db, 'editors', uid), { code, claimedAt: serverTimestamp() });
      await takeOver(uid);
    },

    takeOver,

    saveRoster(roster) {
      return setDoc(teamRef, updated({ roster }), { merge: true });
    },

    createGame({ opponent, date, lineup, roster }) {
      const ref = doc(gamesRef);
      const batch = writeBatch(db);
      batch.set(ref, updated({
        opponent,
        date,
        season: seasonFor(date),
        status: 'live',
        period: 1,
        lineup,
        events: [],
        createdAt: serverTimestamp(),
      }));
      batch.set(teamRef, updated({
        currentGameId: ref.id,
        roster: rosterWithCaps(roster, lineup),
      }), { merge: true });
      return { id: ref.id, done: batch.commit() };
    },

    addEvent(gameId, event) {
      return updateDoc(gameRef(gameId), updated({ events: arrayUnion(event) }));
    },

    removeEvent(gameId, event) {
      return updateDoc(gameRef(gameId), updated({ events: arrayRemove(event) }));
    },

    replaceEvent(gameId, oldEvent, newEvent) {
      const batch = writeBatch(db);
      const ref = gameRef(gameId);
      batch.update(ref, updated({ events: arrayRemove(oldEvent) }));
      batch.update(ref, updated({ events: arrayUnion(newEvent) }));
      return batch.commit();
    },

    setPeriod(gameId, period) {
      return updateDoc(gameRef(gameId), updated({ period }));
    },

    setLineup(gameId, lineup, roster) {
      const batch = writeBatch(db);
      batch.update(gameRef(gameId), updated({ lineup }));
      batch.set(teamRef, updated({ roster: rosterWithCaps(roster, lineup) }), { merge: true });
      return batch.commit();
    },

    endGame(gameId) {
      return updateDoc(gameRef(gameId), updated({ status: 'final' }));
    },

    reopenGame(gameId) {
      const batch = writeBatch(db);
      batch.update(gameRef(gameId), updated({ status: 'live' }));
      batch.set(teamRef, updated({ currentGameId: gameId }), { merge: true });
      return batch.commit();
    },

    async deleteGame(gameId) {
      const batch = writeBatch(db);
      batch.delete(gameRef(gameId));
      // The pointer only moves when it points at the game being deleted; deleting any other
      // game must not detach the current (possibly live) one.
      const team = await getDocFromServer(teamRef);
      if (team.data()?.currentGameId === gameId) {
        // Two candidates suffice because only the deleted game is excluded.
        const candidates = await getDocsFromServer(query(gamesRef, orderBy('date', 'desc'), limit(2)));
        const replacement = candidates.docs.find(game => game.id !== gameId);
        batch.set(teamRef, updated({ currentGameId: replacement?.id ?? null }), { merge: true });
      }
      await batch.commit();
    },

    async recomputeSeason(season) {
      requireOnline();
      // Our own queued writes (an offline end or edit) must reach the server first, or the
      // server read below would aggregate games as they were before them.
      await waitForPendingWrites(db);
      const [games, team] = await Promise.all([
        getDocsFromServer(query(gamesRef, where('season', '==', season))),
        getDocFromServer(teamRef),
      ]);
      const agg = aggregateSeason(games.docs.map(gameData), team.data()?.roster ?? []);
      await setDoc(doc(db, 'stats', season), updated(agg));
    },
  };
}
