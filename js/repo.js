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

// Key-sorted JSON, so two entries with the same fields compare equal whatever their key order.
const canonical = value => JSON.stringify(value, (_key, v) => (
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : v
));

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

function checkedListName(raw, message = 'invalid name') {
  if (typeof model.listName !== 'function') throw new Error('stale model');
  const name = model.listName(raw);
  if (name === null) throw new Error(message);
  return name;
}

const listEntryData = (list, id, value) => ({ [list]: { [id]: value } });

// Callers that omit competition leave the stored competition fields alone.
function checkedCompetition(competition, competitionName, { tournamentId, phaseId, newEntry }) {
  let entry;
  if (newEntry != null) {
    const { list } = newEntry;
    const matches = (list === 'tournaments' && competition === 'tournament')
      || (list === 'phases' && competition === 'league');
    if (!matches) throw new Error('invalid competition');
    const name = checkedListName(newEntry.name, 'invalid competition');
    const id = crypto.randomUUID();
    entry = listEntryData(list, id, { name });
    if (list === 'tournaments') {
      tournamentId = id;
      competitionName = name;
    } else {
      phaseId = id;
    }
  }
  if (competition === undefined) return { fields: null };
  if (typeof model.competitionFields !== 'function') throw new Error('stale model');
  const fields = model.competitionFields(competition, competitionName ?? '', { tournamentId, phaseId });
  if (fields === null) throw new Error('invalid competition');
  return { fields, entry };
}

export function createRepo(db) {
  const teamRef = doc(db, 'team/main');
  const controlRef = doc(db, 'control/tracker');
  const gamesRef = collection(db, 'games');
  const gameRef = id => doc(gamesRef, id);
  const updated = data => ({ ...data, updatedAt: serverTimestamp() });

  // Every raw events array this repo decoded, per game: the latest one, and the latest one the
  // server confirmed. A game can hold two entries with one event id; the screen shows one, and a
  // removal must clear every version this client has seen or the hidden one resurfaces.
  const rawEvents = new Map();

  function remember(snapshot) {
    const events = snapshot.data()?.events;
    if (!Array.isArray(events)) return;
    const { fromCache, hasPendingWrites } = snapshot.metadata;
    const known = rawEvents.get(snapshot.id) ?? { latest: [], confirmed: [] };
    known.latest = events;
    if (!fromCache && !hasPendingWrites) known.confirmed = events;
    rawEvents.set(snapshot.id, known);
  }

  function gameData(snapshot) {
    const data = { ...snapshot.data(), id: snapshot.id };
    if (!Array.isArray(data.events)) return data;
    remember(snapshot);
    return { ...data, events: model.uniqueEvents?.(data.events) ?? data.events };
  }

  // The entries to remove with this event: itself, and every other remembered version of its id.
  function versionsOf(gameId, event) {
    const known = rawEvents.get(gameId);
    if (!known || typeof event?.id !== 'string') return [event];
    const seen = new Set([canonical(event)]);
    const others = [];
    for (const entry of [...known.latest, ...known.confirmed]) {
      if (entry?.id !== event.id) continue;
      const key = canonical(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      others.push(entry);
    }
    return [event, ...others];
  }

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

  function setListEntry(list, id, value) {
    if (list !== 'tournaments' && list !== 'phases') throw new Error('invalid list');
    return setDoc(teamRef, updated(listEntryData(list, id, value)), { merge: true });
  }

  // The id of the newest game when it is newer than this one; null otherwise or when unreachable.
  // With the game's date, games on that date or later are compared as the model orders them
  // (date, then creation), so a later-created game on the same date counts as newer. Without it,
  // or with a model that lacks newerThan, only a strictly later date counts.
  async function newerGameId(gameId, date) {
    try {
      const newerThan = model.newerThan;
      if (typeof date === 'string' && newerThan) {
        const [game, later] = await Promise.all([
          getDocFromServer(gameRef(gameId)),
          getDocsFromServer(query(gamesRef, where('date', '>=', date))),
        ]);
        if (!game.exists()) return null;
        const plain = snapshot => ({ ...snapshot.data(), id: snapshot.id });
        return newerThan(plain(game), later.docs.map(plain));
      }
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
    competitionLists: true,

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

    /** All server games after this client's pending writes, for checking list entry use. */
    async listGamesFromServer() {
      requireOnline();
      await waitForPendingWrites(db);
      const snapshot = await getDocsFromServer(gamesRef);
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

    addListEntry(list, name) {
      const id = crypto.randomUUID();
      return { id, done: setListEntry(list, id, { name: checkedListName(name) }) };
    },

    renameListEntry(list, id, name) {
      return setListEntry(list, id, { name: checkedListName(name) });
    },

    removeListEntry(list, id) {
      return setListEntry(list, id, deleteField());
    },

    createGame({
      opponent, date, season = seasonFor(date), lineup, roster, competition, competitionName, tournamentId, phaseId, newEntry,
    }) {
      const { fields, entry } = checkedCompetition(competition, competitionName, { tournamentId, phaseId, newEntry });
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
        ...entry,
      }), { merge: true });
      return { id: ref.id, done: batch.commit() };
    },

    addEvent(gameId, event) {
      return updateDoc(gameRef(gameId), updated({ events: arrayUnion(event) }));
    },

    removeEvent(gameId, event) {
      return updateDoc(gameRef(gameId), updated({ events: arrayRemove(...versionsOf(gameId, event)) }));
    },

    replaceEvent(gameId, oldEvent, newEvent) {
      const batch = writeBatch(db);
      const ref = gameRef(gameId);
      batch.update(ref, updated({ events: arrayRemove(...versionsOf(gameId, oldEvent)) }));
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
     * A competition edit clears fields that no longer apply. Omitting the applicable id keeps
     * the existing link for older forms, and a league form can explicitly clear its phase.
     */
    updateGameInfo(gameId, info) {
      const { opponent, date, season, competition, competitionName, tournamentId, phaseId, newEntry } = info;
      const { fields, entry } = competition === undefined
        ? { fields: null }
        : checkedCompetition(competition, competitionName, { tournamentId, phaseId, newEntry });
      const changes = { opponent, date, season, ...fields };
      if (fields !== null) {
        changes.competitionName ??= deleteField();
        if (competition !== 'tournament') changes.tournamentId = deleteField();
        if (competition !== 'league' || (phaseId === null && fields.phaseId === undefined)) {
          changes.phaseId = deleteField();
        }
      }
      const batch = writeBatch(db);
      batch.update(gameRef(gameId), updated(changes));
      if (entry) batch.set(teamRef, updated(entry), { merge: true });
      return batch.commit();
    },

    // date is optional: an older caller passes only the id.
    async endGame(gameId, date) {
      const batch = writeBatch(db);
      batch.update(gameRef(gameId), updated({ status: 'final' }));
      // Reopening an older game made it current; once it ends again the team should point at the
      // newest game, which is what the viewer shows.
      const newer = globalThis.navigator?.onLine === false ? null : await withinMs(newerGameId(gameId, date), END_LOOKUP_MS);
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
        // Two candidates suffice for the newest date because only the deleted game is excluded.
        const candidates = await getDocsFromServer(query(gamesRef, orderBy('date', 'desc'), limit(2)));
        let replacement = candidates.docs.find(game => game.id !== gameId);
        const newestGame = model.newestGame;
        if (replacement && newestGame) {
          // Several games can share that date: take the one the model orders last.
          const sameDate = await getDocsFromServer(query(gamesRef, where('date', '==', replacement.data().date)));
          const newest = newestGame(sameDate.docs.map(game => ({ ...game.data(), id: game.id })), gameId);
          replacement = newest ?? replacement;
        }
        batch.set(teamRef, updated({ currentGameId: replacement?.id ?? null }), { merge: true });
      }
      await batch.commit();
      // Only a committed delete retires the remembered versions.
      rawEvents.delete(gameId);
    },

    async recomputeSeason(season) {
      // An old model might count friendlies or omit per-game lines. The stats queue keeps the
      // season dirty and retries on the next drain.
      if (typeof model.competitionOf !== 'function' || typeof model.sumLines !== 'function') {
        throw new Error('stale model');
      }
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
