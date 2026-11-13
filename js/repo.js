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

// Ending a game looks for a newer game first. With signal bars but no data that look must not
// hold the end back: past this the game ends without it.
const END_LOOKUP_MS = 2000;

const gameData = snapshot => ({ ...snapshot.data(), id: snapshot.id });

async function withinMs(promise, ms) {
  let timer;
  try {
    return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(resolve, ms, null); })]);
  } finally {
    clearTimeout(timer);
  }
}

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

  // The id of the newest game when it is newer than this one; null otherwise or when unreachable.
  async function newerGameId(gameId) {
    try {
      const [game, newest] = await Promise.all([
        getDocFromServer(gameRef(gameId)),
        getDocsFromServer(query(gamesRef, orderBy('date', 'desc'), limit(1))),
      ]);
      const top = newest.docs[0];
      return top && top.id !== gameId && top.data().date > game.data()?.date ? top.id : null;
    } catch {
      return null;
    }
  }

  return {
    watchTeam: cb => watch(teamRef, cb),
    watchGame: (gameId, cb) => watch(gameRef(gameId), cb, true),
    watchStats: (season, cb) => watch(doc(db, 'stats', season), cb),
    watchControl: cb => watch(controlRef, cb),
    watchOwnEditor: (uid, cb) => watch(doc(db, 'editors', uid), cb),

    /** The control document as the server has it; rejects when the server cannot be reached. */
    async readControlFromServer() {
      return (await getDocFromServer(controlRef)).data() ?? null;
    },

    /**
     * A game as the server has it (null when it does not exist), after this client's own queued
     * writes have been answered. Rejects when offline.
     */
    async readGameFromServer(gameId) {
      requireOnline();
      await waitForPendingWrites(db);
      const snapshot = await getDocFromServer(gameRef(gameId));
      return snapshot.exists() ? gameData(snapshot) : null;
    },

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

    createGame({ opponent, date, season = seasonFor(date), lineup, roster }) {
      const ref = doc(gamesRef);
      const batch = writeBatch(db);
      batch.set(ref, updated({
        opponent,
        date,
        season,
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

    /** Opponent, date and season are editable after the game has started. */
    updateGameInfo(gameId, { opponent, date, season }) {
      return updateDoc(gameRef(gameId), updated({ opponent, date, season }));
    },

    async endGame(gameId) {
      const batch = writeBatch(db);
      batch.update(gameRef(gameId), updated({ status: 'final' }));
      // Reopening an older game made it current; once it ends again the team should point at the
      // newest game, which is what the viewer shows.
      const newer = globalThis.navigator?.onLine === false ? null : await withinMs(newerGameId(gameId), END_LOOKUP_MS);
      if (newer) batch.set(teamRef, updated({ currentGameId: newer }), { merge: true });
      await batch.commit();
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
