import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
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
// A namespace import: a phone can hold this file next to the previous model.js, which lacks the
// competition helpers.
import * as model from './model.js';

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

// Validated and normalised competition fields. Callers that pass no competition (an old form) get
// null and write nothing; an invalid one is refused before anything is written.
function checkedCompetition(competition, competitionName) {
  if (competition === undefined) return null;
  if (typeof model.competitionFields !== 'function') throw new Error('stale model');
  const fields = model.competitionFields(competition, competitionName ?? '');
  if (fields === null) throw new Error('invalid competition');
  return fields;
}

export function createRepo(db) {
  const teamRef = doc(db, 'team/main');
  const controlRef = doc(db, 'control/tracker');
  const gamesRef = collection(db, 'games');
  const gameRef = id => doc(gamesRef, id);
  const updated = data => ({ ...data, updatedAt: serverTimestamp() });

  // onError is optional; without it a failed listener behaves as before.
  function watch(ref, cb, isGame = false, onError) {
    const next = snapshot => {
      const data = snapshot.exists() ? (isGame ? gameData(snapshot) : snapshot.data()) : null;
      const { fromCache, hasPendingWrites } = snapshot.metadata;
      cb(data, { fromCache, hasPendingWrites });
    };
    return onError
      ? onSnapshot(ref, { includeMetadataChanges: true }, next, onError)
      : onSnapshot(ref, { includeMetadataChanges: true }, next);
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
    /** The forms show the competition fields only when this is true; an older repo.js lacks it. */
    competitions: true,

    watchTeam: (cb, onError) => watch(teamRef, cb, false, onError),
    watchGame: (gameId, cb, onError) => watch(gameRef(gameId), cb, true, onError),
    watchStats: (season, cb, onError) => watch(doc(db, 'stats', season), cb, false, onError),
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

    /**
     * Team, control and the current game (when the team has one) as the server has them, for
     * confirming what the screen shows. Each is null when the document does not exist; game is
     * undefined when there is no current game. Rejects when the server cannot be reached.
     */
    async confirmFromServer() {
      const [teamSnapshot, controlSnapshot] = await Promise.all([getDocFromServer(teamRef), getDocFromServer(controlRef)]);
      const team = teamSnapshot.data() ?? null;
      const gameId = team?.currentGameId ?? null;
      let game;
      if (gameId !== null) {
        const gameSnapshot = await getDocFromServer(gameRef(gameId));
        game = gameSnapshot.exists() ? gameData(gameSnapshot) : null;
      }
      return { team, control: controlSnapshot.data() ?? null, game };
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

    createGame({ opponent, date, season = seasonFor(date), lineup, roster, competition, competitionName }) {
      const fields = checkedCompetition(competition, competitionName);
      const ref = doc(gamesRef);
      const batch = writeBatch(db);
      batch.set(ref, updated({
        opponent,
        date,
        season,
        status: 'live',
        situations: true,
        period: 1,
        lineup,
        events: [],
        ...fields,
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

    /** changedGoalieIds: the players whose Goalie tick changed; only those flags reach the roster. */
    setLineup(gameId, lineup, roster, changedGoalieIds = new Set()) {
      const batch = writeBatch(db);
      batch.update(gameRef(gameId), updated({ lineup }));
      batch.set(teamRef, updated({ roster: rosterWithCaps(roster, lineup, changedGoalieIds) }), { merge: true });
      return batch.commit();
    },

    /**
     * Opponent, date and season are editable after the game has started. A given competition is
     * written with its name (removed when it is not a tournament); without one the stored
     * competition stays as it is.
     */
    updateGameInfo(gameId, { opponent, date, season, competition, competitionName }) {
      const fields = checkedCompetition(competition, competitionName);
      const competitionData = fields === null ? {} : {
        competition: fields.competition,
        competitionName: fields.competitionName ?? deleteField(),
      };
      return updateDoc(gameRef(gameId), updated({ opponent, date, season, ...competitionData }));
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
      // Totals written by an old model.js would count friendlies; the stats queue keeps the season
      // dirty and retries on the next drain.
      if (typeof model.competitionOf !== 'function') throw new Error('stale model');
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
